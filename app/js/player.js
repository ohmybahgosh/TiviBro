/* Playback, built around one idea: IPTV streams are bursty, so the player should hold a
   cushion and refill it properly instead of stuttering on every hiccup.

   Engines
     ts     mpegts.js in a worker   (raw MPEG-TS, most Xtream live)
     hls    hls.js in a worker      (.m3u8)
     native the TV's own pipeline   (zero JS demux cost, least control, ignores CORS)

   Smoothness layers
     1. Prebuffer:   don't start until N seconds are buffered.
     2. Refill goal: when the buffer runs dry, pause and refill to a target instead of
                     the browser's default of resuming at ~0.1s and stuttering again.
     3. Gap jumping: hop over small holes in the buffer that freeze live TS streams, and follow
                     the stream when its timestamps jump (an encoder restart upstream).
     3b. Growing cushion: every time a channel runs dry, the next refill aims higher, so a
                     sloppy channel settles a few seconds further behind live and stops
                     stuttering.  It shrinks again after a long clean run.
     4. Watchdog:    if the clock stops, recover in steps (nudge, decoder recover,
                     reconnect with backoff), then fall back to another engine.
     5. Memory:      back buffer trimmed so long sessions don't starve the TV.
     6. Never silent: offline waits for the network, a channel that keeps failing tries every
                     other pipeline, then keeps retrying slowly with a message on screen
                     instead of dying.  Movies and catch-up resume where they dropped.

   Routing: HDR and codec facts (Caps) decide the pipeline before the first frame.  Dolby
   Vision goes to the TV player; HDR10/HLG stays on the built-in player unless Settings say
   otherwise; codecs MSE can't take go to the TV player. */
var Player = (function () {
  'use strict';

  var PRESETS = {
    low:      { label: 'Fast zapping',  prebuffer: 0.5, ahead: 10, back: 4,  stall: 4,  retries: 6,  stash: 128,  chase: true },
    balanced: { label: 'Balanced',      prebuffer: 2,   ahead: 30, back: 8,  stall: 6,  retries: 8,  stash: 384,  chase: false },
    stable:   { label: 'Smooth',        prebuffer: 4,   ahead: 45, back: 10, stall: 8,  retries: 10, stash: 768,  chase: false },
    max:      { label: 'Rock solid',    prebuffer: 8,   ahead: 60, back: 12, stall: 10, retries: 12, stash: 1536, chase: false }
  };

  var video = null, eng = null, cur = null, token = 0;
  var listeners = { state: [], stats: [], notice: [], trouble: [] };
  var wd = 0, fastWd = 0, st = null;
  var lastStats = null;
  var fallbackHosts = {};        // host -> 'native' after MSE could not fetch it
  var preferHls = {};            // live channels that played better as HLS this session (see reconnect)

  function on(ev, fn) { listeners[ev].push(fn); }
  function emit(ev, a, b) { var l = listeners[ev]; for (var i = 0; i < l.length; i++) l[i](a, b); }

  function cfg(preview) {
    var s = Store.settings, p;
    if (s.buffer === 'custom') {
      var c = s.custom;
      p = { label: 'Custom', prebuffer: +c.prebuffer, ahead: +c.ahead, back: +c.back, stall: +c.stall, retries: +c.retries,
        stash: Math.round(U.clamp(c.prebuffer * 160, 128, 2048)), chase: c.prebuffer < 1 };
    } else p = PRESETS[s.buffer] || PRESETS.balanced;
    p = Object.assign({}, p);
    // Previews should appear fast; the full preset applies once you go fullscreen.
    if (preview) p.prebuffer = Math.min(p.prebuffer, 1.2);
    p.refill = Math.max(2, p.prebuffer * 1.5);
    return p;
  }

  function bufferedAhead() {
    if (!video) return 0;
    var b = video.buffered, t = video.currentTime;
    for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t) return b.end(i) - t;
    return 0;
  }
  function nextRangeStart() {
    var b = video.buffered, t = video.currentTime;
    for (var i = 0; i < b.length; i++) if (b.start(i) > t && b.start(i) - t < 6) return b.start(i);
    return -1;
  }
  function bufferEnd() {
    if (!video) return 0;
    var b = video.buffered, e = 0;
    for (var i = 0; i < b.length; i++) if (b.end(i) > e) e = b.end(i);
    return e;
  }
  /* Timestamp jumps: when the provider's encoder restarts, new video arrives at a completely
     different time position (often back near zero, or far ahead), as a separate buffered range.
     Find a range the playhead is not in that is growing: that is where the stream went. */
  function jumpTarget(t) {
    var b = video.buffered, best = null, other = 0;
    for (var i = 0; i < b.length; i++) {
      var s0 = b.start(i), e0 = b.end(i);
      if (t >= s0 - 0.3 && t <= e0 + 0.3) continue;
      if (e0 > other) other = e0;
      if (e0 - s0 >= 0.4 && st.otherEnd && e0 > st.otherEnd + 0.05 && (!best || e0 > best.end)) best = { start: s0, end: e0 };
    }
    st.otherEnd = other;
    return best;
  }
  function hostOf(url) { var m = /^https?:\/\/([^/]+)/i.exec(url); return m ? m[1] : ''; }
  function mse() { return !!(window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')); }

  function pickEngine(url) {
    var s = Store.settings.engine;
    var isHls = /\.m3u8(\?|$)/i.test(url);
    // Files (movies, episodes) belong to the TV's own player: it seeks and handles MKV/MP4 natively.
    if (cur && !cur.live && !cur.timeshift && !isHls && !/\.ts(\?|$)/i.test(url)) return 'native';
    if (s === 'native' || !mse() || fallbackHosts[hostOf(url)] === 'native') return 'native';
    if (isHls) return window.Hls && Hls.isSupported() ? 'hls' : 'native';
    if (window.mpegts && mpegts.getFeatureList().mseLivePlayback) return 'ts';
    return 'native';
  }

  /* ---------- engines ---------- */
  function hlsEngine(url, p, preview, fail, media, tracks) {
    var live = cur.live && !cur.timeshift;
    url = Net.wrap(url);
    var h = new Hls({
      // Every playlist, key and segment request goes through the relay when it is in use.
      xhrSetup: function (xhr, u) { xhr.open('GET', Net.wrap(u), true); },
      debug: false, enableWorker: workerOk, lowLatencyMode: false, startFragPrefetch: true,
      liveSyncDurationCount: p.chase ? 2 : Math.round(U.clamp(p.prebuffer / 2 + 2, 3, 6)),
      liveMaxLatencyDurationCount: p.chase ? 5 : Infinity,
      maxBufferLength: p.ahead, maxMaxBufferLength: p.ahead * 2, backBufferLength: p.back,
      maxBufferSize: 80 * 1000 * 1000, maxBufferHole: 0.5, nudgeMaxRetry: 6, highBufferWatchdogPeriod: 2,
      capLevelToPlayerSize: preview, capLevelOnFPSDrop: true,
      manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 400,
      manifestLoadingTimeOut: 12000, levelLoadingTimeOut: 10000, fragLoadingTimeOut: 20000,
      liveDurationInfinity: live, enableWebVTT: true, enableCEA708Captions: true, renderTextTracksNatively: true
    });
    // Media errors: recover, then recover with the audio codec swapped.  The count resets once
    // playback has run clean for a while, so one bad patch an hour in still gets recovered.
    var mediaErrs = 0, lastMediaErr = 0, netRecovers = 0, lastNetErr = 0;
    h.on(Hls.Events.MANIFEST_PARSED, function (e, d) { media(Caps.bestHlsLevel(d && d.levels)); });
    h.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { tracks(); });
    h.on(Hls.Events.ERROR, function (e, d) {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (Date.now() - lastMediaErr > 20000) mediaErrs = 0;
        lastMediaErr = Date.now();
        if (mediaErrs < 2) {
          if (mediaErrs++ === 1) h.swapAudioCodec();
          h.recoverMediaError();
          return;
        }
      }
      // A segment or playlist that kept failing mid-stream: ask hls.js to carry on loading before
      // throwing away what is buffered.  Twice per 30s, and only once it has played.
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && st && st.started) {
        if (Date.now() - lastNetErr > 30000) netRecovers = 0;
        lastNetErr = Date.now();
        if (netRecovers++ < 2) { Log.warn('player', 'HLS ' + d.details + '; resuming loading'); try { h.startLoad(); } catch (e) {} return; }
      }
      // A response code of 0 is a request the browser blocked (CORS), not the provider failing.
      var code = d.response && d.response.code;
      fail(d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'net' : 'media', d.details + (code ? ' (HTTP ' + code + ')' : ''), code === 0, false, code >= 400 ? code : 0);
    });
    h.loadSource(url);
    h.attachMedia(video);
    return {
      name: 'HLS',
      recover: function () { h.recoverMediaError(); },
      info: function () { var l = h.levels && h.levels[h.currentLevel]; return l ? Math.round((l.bitrate || 0) / 1000) + ' kbps' : ''; },
      audio: function () { return (h.audioTracks || []).map(function (t, i) { return { id: i, label: t.name || t.lang || ('Track ' + (i + 1)), lang: t.lang || '', ch: +(t.attrs && t.attrs.CHANNELS || '').split('/')[0] || 0, on: i === h.audioTrack }; }); },
      setAudio: function (i) { h.audioTrack = i; },
      // Video quality (TiviMate's "Video tracks"): the HLS variants, or Automatic.
      levels: function () { return (h.levels || []).map(function (l, i) { return { id: i, label: (l.height ? l.height + 'p' : 'Level ' + (i + 1)) + (l.bitrate ? '  ' + (l.bitrate / 1e6).toFixed(1) + ' Mbps' : ''), on: !h.autoLevelEnabled && i === h.currentLevel }; }); },
      auto: function () { return h.autoLevelEnabled; },
      setLevel: function (i) { h.currentLevel = i; },
      // After a long refill a live stream can sit far behind the edge; go back to it.
      edge: function () { var e = h.liveSyncPosition; if (e && video.currentTime < e - 30) video.currentTime = e; },
      destroy: function () { try { h.destroy(); } catch (e) {} }
    };
  }

  function tsEngine(url, p, preview, fail, media) {
    var live = cur.live || !!cur.timeshift;
    url = Net.wrap(url);
    var m = mpegts.createPlayer({ type: 'mpegts', isLive: live, url: url, hasAudio: true, hasVideo: true }, {
      enableWorker: workerOk, enableStashBuffer: true, stashInitialSize: p.stash * 1024,
      lazyLoad: false, deferLoadAfterSourceOpen: false, seekType: 'range',
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: p.back, autoCleanupMinBackwardDuration: Math.max(2, p.back / 2),
      liveBufferLatencyChasing: p.chase, liveBufferLatencyMaxLatency: p.chase ? 3 : 60, liveBufferLatencyMinRemain: p.chase ? 0.8 : 3,
      fixAudioTimestampGap: true, reuseRedirectedURL: true
    });
    var gotData = false;
    m.on(mpegts.Events.MEDIA_INFO, function (mi) { gotData = true; if (mi && mi.mimeType) Log.debug('player', 'Stream codecs: ' + mi.mimeType); media(Caps.fromMpegts(mi)); });
    m.on(mpegts.Events.ERROR, function (type, detail, info) {
      // Only a fetch the browser refused outright ("Exception": CORS, TLS) says the host needs the
      // TV player.  An HTTP error before data is usually the provider's connection limit while
      // the last channel hangs up, and a reconnect a moment later fixes it.
      var net = type === mpegts.ErrorTypes.NETWORK_ERROR;
      fail(net ? 'net' : 'media', detail + (info && info.code ? ' (HTTP ' + info.code + ')' : '') + (info && info.msg ? ' (' + info.msg + ')' : ''), !gotData && net && detail === 'Exception', false, !gotData && info && info.code >= 400 ? info.code : 0);
    });
    // Live TS that "completes" means the server hung up.  Reconnect right away.
    if (live) m.on(mpegts.Events.LOADING_COMPLETE, function () { fail('net', 'server closed stream', false, true); });
    m.attachMediaElement(video);
    m.load();
    return {
      name: 'TS',
      recover: function () {
        // Jump to near the live edge of what we have; mpegts has no decoder reset of its own.
        var b = video.buffered;
        if (b.length) { var end = b.end(b.length - 1); if (end - video.currentTime > 1.5) video.currentTime = end - 1; }
      },
      info: function () { var s = m.statisticsInfo; return s && s.speed ? Math.round(s.speed * 8) + ' kbps' : ''; },
      destroy: function () { try { m.pause(); m.unload(); m.detachMediaElement(); m.destroy(); } catch (e) {} }
    };
  }

  // Blob workers should work in webOS apps; if one ever fails, demux on the main thread instead.
  var workerOk = (function () {
    try { var u = URL.createObjectURL(new Blob(['0'], { type: 'text/javascript' })); var w = new Worker(u); w.terminate(); URL.revokeObjectURL(u); return true; }
    catch (e) { return false; }
  })();

  function nativeEngine(url, tracks) {
    // HTTPS on the TV's own player can fail on self-signed or unusual certificates, which IPTV
    // panels often have.  The helper accepts them and passes Range requests through for seeking.
    if ((/^https:/i.test(url) || Net.ua) && Net.active) { url = Net.wrap(url); Log.info('player', 'TV player using the helper' + (Net.ua ? ' (custom User-Agent)' : ' for HTTPS')); }
    function loadNative(resolved) { video.src = resolved; video.load(); }
    // Resolve the provider entry URL once. Both playback and subtitle ranges use
    // the same resulting session URL; opening the entry separately can evict video.
    var subs = null;
    if (!cur.live && /\.mkv(\?|#|$)/i.test(url) && typeof MkvSubs !== 'undefined')
      subs = MkvSubs.extract(url, video, loadNative);
    else loadNative(url);
    var at0 = video.audioTracks, onAdd = at0 && at0.addEventListener ? U.debounce(tracks, 300) : null;
    if (onAdd) at0.addEventListener('addtrack', onAdd);
    return { name: 'Native', recover: function () {}, info: function () { return ''; },
      // Abort reads at the old position and replay cached cues while extraction
      // waits for the seek to finish and the playback buffer to refill.
      reanchor: function () { if (subs) { subs.cancel(); subs = (!cur.live && typeof MkvSubs !== 'undefined') ? MkvSubs.extract(url, video) : null; } },
      destroy: function () { if (subs) subs.cancel(); if (onAdd) { onAdd.cancel(); at0.removeEventListener('addtrack', onAdd); } },
      audio: function () {
        var at = video.audioTracks, out = [];
        if (at) for (var i = 0; i < at.length; i++) out.push({ id: i, label: at[i].label || at[i].language || ('Track ' + (i + 1)), lang: at[i].language || '', kind: at[i].kind || '', on: at[i].enabled });
        return out;
      },
      setAudio: function (i) { var at = video.audioTracks; if (at) for (var j = 0; j < at.length; j++) at[j].enabled = j === i; } };
  }

  /* ---------- holding the last picture while a live channel reconnects ----------
     A reconnect tears the player down, which left a black screen and "Tuning" for a few seconds.  The
     last frame is copied to a canvas over the video and stays until the picture is back, with a small
     "Reconnecting" in the corner instead.  Only when the frame can really be read: video the TV draws on
     its own plane, or from another site, can't be copied, and then it is the black screen as before. */
  var holdEl = null, holding = false;
  function holdFrame() {
    if (!video || !cur || !cur.live || cur.timeshift || !video.videoWidth || video.readyState < 2 || Store.settings.holdFrame === false) return false;
    try {
      if (!holdEl) { holdEl = document.createElement('canvas'); holdEl.className = 'vid-hold'; video.parentNode.insertBefore(holdEl, video.nextSibling); }
      var sc = Math.min(1, 960 / video.videoWidth), w = Math.max(2, Math.round(video.videoWidth * sc)), h = Math.max(2, Math.round(video.videoHeight * sc));
      holdEl.width = w; holdEl.height = h;
      var g = holdEl.getContext('2d');
      g.drawImage(video, 0, 0, w, h);
      // A picture the TV keeps on its own plane draws as black: then there is nothing to hold.
      var d = g.getImageData(0, 0, w, h).data, lit = 0, step = Math.max(4, Math.floor(d.length / 4 / 400)) * 4;
      for (var i = 0; i < d.length; i += step) if (d[i] + d[i + 1] + d[i + 2] > 48) { lit++; if (lit > 8) break; }
      if (lit <= 8) return false;
      holdEl.style.objectFit = video.style.objectFit || 'contain';
      holdEl.classList.add('on');
      if (video.parentNode.classList) video.parentNode.classList.add('holding');
      holding = true;
      return true;
    } catch (e) { return false; }
  }
  function releaseFrame() {
    if (!holding) return;
    holding = false;
    if (holdEl) holdEl.classList.remove('on');
    if (video && video.parentNode && video.parentNode.classList) video.parentNode.classList.remove('holding');
  }

  /* ---------- lifecycle ---------- */
  function teardown() {
    clearInterval(wd); wd = 0;
    clearInterval(fastWd); fastWd = 0;
    if (eng) { eng.destroy(); eng = null; }
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}       // releases the hardware decoder on webOS
    }
  }

  function state(s, msg) { if (s === 'playing' || s === 'error' || s === 'idle' || s === 'ended') releaseFrame(); if (st) st.state = s; if (lastStats) lastStats.state = s; emit('state', s, msg); }
  function notice(msg) { emit('notice', msg); }
  function isFile() { return cur && !cur.live && !cur.timeshift; }
  function hdrPolicy() { return Store.settings.hdrRoute || 'auto'; }

  function start(myToken) {
    if (myToken !== token || !cur) return;
    clearTimeout(cur.timer);
    teardown();
    if (cur.urlFn) { cur.url = cur.urlFn(); cur.pos = 0; }  // catch-up: every reconnect resumes where playback got to
    var url = cur.url, p = cur.p;
    var kind = cur.forceKind || (cur.forceNative ? 'native' : pickEngine(url));
    // Known codecs up front (a movie's details): route before anything loads.
    if (!cur.forceKind && !cur.forceNative && kind !== 'native' && cur.media && !cur.routed) {
      var r0 = Caps.route(cur.media, hdrPolicy());
      if (r0.engine === 'native') { cur.routed = true; Log.info('player', r0.reason); useEngine('native'); kind = 'native'; }
    }
    Log.state('player', 'playing ' + (cur.ch && cur.ch.n ? '"' + cur.ch.n + '"' : 'a video') + ' with the ' + kind + ' engine');
    Log.info('player', 'Start ' + (cur.ch && cur.ch.n ? '"' + cur.ch.n + '" ' : '') + 'with ' + kind + ' engine' + (kind !== 'native' && Net.active ? ' via helper' : '') + ', profile ' + p.label + ' (prebuffer ' + p.prebuffer + 's)' + (cur.retries ? ', attempt ' + (cur.retries + 1) : '') + (cur.startAt ? ', from ' + Math.round(cur.startAt) + 's' : '') + '  ' + url);
    var gen = cur.gen = (cur.gen || 0) + 1;     // a torn-down engine's late events are ignored
    st = { state: 'loading', started: false, lastT: -1, lastMove: Date.now(), refilling: false, refillSince: 0,
      kind: kind, at: Date.now(), healthySince: 0, userPaused: isFile() && !!cur.userPaused };
    state(cur.slow ? 'buffering' : 'loading', cur.slow ? cur.slow : holding ? 'Reconnecting' : undefined);

    var fail = function (type, detail, earlyNet, ended, http) {
      if (myToken !== token || gen !== cur.gen) return;
      Log.warn('player', kind + ' engine ' + type + ' error: ' + (detail && detail.message ? detail.message : detail) + (st.started ? '' : ' (before first frame)') + '  ' + cur.url);
      // The server answered with an error before any video.  Twice is worth a quick retry (a
      // connection limit while the last channel hangs up clears in a second or two); after that
      // the next pipeline gets a go rather than a minute of retries on a dead link.
      cur.lastFailHttp = !!http;
      // A channel that has played here before and now gets an HTTP error is the provider having
      // trouble (outage, connection limit), not the pipeline: keep retrying the same way.
      if (http && cur.everPlayed) { cur.lastHttp = http; return reconnect(myToken, 'The provider answered ' + http + ', retrying'); }
      if (http && !st.started && kind !== 'native') {
        cur.httpFails = (cur.httpFails || 0) + 1;
        cur.lastHttp = http;
        // "Busy" answers (connection limit, rate limit, overloaded) clear once the last channel's
        // connection is let go, which can take a few seconds: give those more tries than a 404.
        var busy = [403, 429, 456, 458, 502, 503, 504, 509, 551].indexOf(http) >= 0;
        if (cur.httpFails > (busy ? 5 : 2)) {
          var nx = nextEngine(kind);
          if (nx) { Log.info('player', 'Trying the ' + ENGINE_NAMES[nx] + ' after HTTP ' + http); useEngine(nx); return start(myToken); }
          return giveUp(myToken);
        }
      }
      // Before the first frame, a failure in the built-in demuxer (unsupported codec, or a fetch
      // the browser refused) goes straight to the next pipeline.  No retry loop first.
      if ((earlyNet || type === 'media') && kind !== 'native' && !st.started) {
        // A fetch the demuxer could not make is about the host (CORS etc.), so remember it for
        // the host.  A codec problem is about this one channel only.
        if (earlyNet) fallbackHosts[hostOf(url)] = 'native';
        var alt = nextEngine(kind);
        if (alt) { Log.info('player', 'Trying the ' + ENGINE_NAMES[alt] + ' after a ' + type + ' error'); useEngine(alt); return start(myToken); }
        return giveUp(myToken);
      }
      // Provider hung up but we still hold a good cushion: keep watching it and reconnect only
      // when it runs low, instead of throwing away buffered video.
      if (ended && st.started && bufferedAhead() > 4) { st.pendingReconnect = true; Log.info('player', 'Provider closed the stream; playing the remaining ' + bufferedAhead().toFixed(1) + 's then reconnecting'); return; }
      reconnect(myToken, ended ? 'Stream ended, reconnecting' : 'Connection dropped, reconnecting');
    };
    // Codec facts from the stream itself, before the first frame: the HLS master playlist or the
    // TS demuxer's media info.  Switch pipeline once if the stream belongs on the TV player.
    var media = function (m) {
      if (myToken !== token || gen !== cur.gen || !m) return;
      cur.media = merge(cur.media, m);
      var r = Caps.route(cur.media, hdrPolicy());
      if (r.warn && !cur.warned) { cur.warned = true; Log.warn('player', r.warn); notice(r.warn); }
      if (r.engine === 'native' && kind !== 'native' && !st.started && !cur.routed && !(cur.tried && cur.tried.native)) {
        cur.routed = true;
        Log.info('player', r.reason + '; switching to the TV player');
        useEngine('native');
        setTimeout(function () { start(myToken); }, 0);   // not from inside the engine's own event
      }
    };

    // Audio tracks known: pick the preferred language (Settings > Playback).
    var tracks = function () { if (myToken === token && cur && gen === cur.gen) preferAudio(); };
    try {
      if (kind === 'hls') eng = hlsEngine(url, p, cur.preview, fail, media, tracks);
      else if (kind === 'ts') eng = tsEngine(url, p, cur.preview, fail, media);
      else eng = nativeEngine(url, tracks);
    } catch (e) {
      Log.warn('player', kind + ' engine could not start: ' + e.message);
      if (kind === 'native') return giveUp(myToken);
      useEngine('native');
      return start(myToken);
    }
    if (kind === 'native' && cur.media) { var rn = Caps.route(cur.media, hdrPolicy()); if (rn.warn && !cur.warned) { cur.warned = true; notice(rn.warn); } }
    wd = setInterval(function () { tick(myToken); }, 400);
    // Until the first frame, check every 50ms: the video is often ready to play within 100-200ms
    // of a channel change, and waiting for the 400ms watchdog added up to a third of a second.
    fastWd = setInterval(function () {
      if (myToken !== token || !st || st.started) { clearInterval(fastWd); fastWd = 0; return; }
      tick(myToken);
    }, 50);
  }
  /* Preferred audio: the language chosen in Settings > Playback, and with "Prefer surround sound"
     a 5.1 or Dolby track in it.  Audio description tracks only when nothing else matches.  A
     track picked by hand from the quick menu wins until the channel changes. */
  var SURROUND = /5\.1|7\.1|\b[68] ?ch\b|\bac-?3\b|e-?ac-?3|\bdd\+?|dolby|atmos|surround|dts/i;
  var DESCRIBED = /\b(ad|audio ?desc\w*|descriptive|description|visually impaired|vi)\b/i;
  function describeTrack(t) {
    var text = (t.label || '') + ' ' + (t.lang || '');
    return { lang: U.lang(t.lang) || U.lang(t.label), surround: t.ch > 2 || SURROUND.test(text), ad: /desc/i.test(t.kind || '') || DESCRIBED.test(text) };
  }
  function bestAudio(list, want, surround) {
    if (!want && !surround) return null;
    var best = null, bestScore = -1e9;
    list.forEach(function (t) {
      var d = describeTrack(t), sc = (want && d.lang === want ? 100 : 0) + (surround && d.surround ? 10 : 0) - (d.ad ? 50 : 0) + (t.on ? 1 : 0);
      if (sc > bestScore) { best = t; bestScore = sc; }
    });
    return best;
  }
  function preferAudio() {
    if (!eng || !eng.audio || !cur || cur.userAudio) return;
    var list = eng.audio(), s = Store.settings;
    if (list.length < 2) return;
    var b = bestAudio(list, s.audioLang || '', !!s.audioSurround);
    if (b && !b.on) { Log.info('player', 'Audio: "' + b.label + '" (preferred language' + (s.audioSurround ? ', surround' : '') + ')'); eng.setAudio(b.id); }
  }

  // Stream facts arrive in pieces (movie details, then the stream); later, more specific wins.
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b) if (b[k] != null && b[k] !== '' && !(Array.isArray(b[k]) && !b[k].length) && !(k === 'range' && (b[k] === 'SDR' || b[k] === 'HDR?') && a.range && a.range !== 'SDR')) o[k] = b[k];
    return o;
  }

  /* Before the first frame each pipeline gets one try: built-in demuxer (ts), the TV player
     (native, decodes AC-3 and raw TS), and for Xtream live channels the provider's HLS version
     of the same channel.  Once all have failed there is no point in eight reconnects. */
  var ENGINE_NAMES = { ts: 'built-in demuxer', native: 'TV player', hls: 'HLS version of this channel' };
  function hlsVariant(url) { return cur && cur.live && !cur.timeshift && /\/live\/[^?]+\.ts(\?|$)/i.test(url) ? url.replace(/\.ts(\?|$)/i, '.m3u8$1') : null; }
  function nextEngine(failed) {
    cur.tried = cur.tried || {};
    cur.tried[failed] = 1;
    var isHlsUrl = /\.m3u8(\?|$)/i.test(cur.url);
    var order = isHlsUrl ? ['hls', 'native'] : ['ts', 'native', 'hls'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (cur.tried[k]) continue;
      if (k === 'ts' && !(window.mpegts && mse())) continue;
      if (k === 'hls' && !(window.Hls && Hls.isSupported() && (isHlsUrl || hlsVariant(cur.origUrl || cur.url)))) continue;
      return k;
    }
    return null;
  }
  function useEngine(k) {
    if (!cur.origUrl) cur.origUrl = cur.url;
    if (k === 'hls' && !/\.m3u8(\?|$)/i.test(cur.url)) cur.url = hlsVariant(cur.origUrl);
    else if (k !== 'hls') cur.url = cur.origUrl;
    cur.forceKind = k; cur.forceNative = k === 'native';
  }
  function giveUp(myToken) {
    if (myToken !== token) return;
    // A live channel that has played here before is not a format problem: keep it coming back.
    if (cur.live && !cur.timeshift && cur.everPlayed) { cur.tried = null; return reconnect(myToken, 'Channel not responding, reconnecting'); }
    Log.error('player', 'No player could open this channel (tried ' + Object.keys(cur.tried || {}).join(', ') + ')  ' + (cur.origUrl || cur.url));
    teardown();
    cur.failed = true;
    if (cur.lastHttp) return state('error', 'The provider is not sending this ' + (isFile() ? 'video' : 'channel') + ' right now (error ' + cur.lastHttp + ').  Press OK to try again, or try ' + (isFile() ? 'again later.' : 'another channel.'));
    state('error', isFile() ? 'This video will not play on this TV.  It may use a format the TV cannot decode.' : 'This channel will not play on this TV.  It may use a format the TV cannot decode, or the provider may be having trouble with it.');
  }

  /* After the reconnect budget is spent: another pipeline first (each gets half a budget), then
     for a live channel that has played before, a slow retry every 15s for up to 20 minutes with
     a message on screen.  Providers do come back, and a TV left on a channel should recover by
     itself rather than sit on an error. */
  // Slow retries: every 6s for the first 3 minutes (most outages are short, and the picture should
  // be back within seconds of the provider), then every 15s.
  var SLOW_EVERY = 15000, SLOW_FAST = 6000, SLOW_FAST_FOR = 3 * 60000, SLOW_FOR = 20 * 60000;
  function lateEngine(failed) {
    if (isFile() && !/\.m3u8(\?|$)/i.test(cur.origUrl || cur.url)) return null;   // a movie file has one pipeline
    cur.late = cur.late || {};
    cur.late[failed] = 1;
    var isHlsUrl = /\.m3u8(\?|$)/i.test(cur.origUrl || cur.url);
    var order = isHlsUrl ? ['hls', 'native'] : ['ts', 'native', 'hls'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (cur.late[k] || (cur.tried && cur.tried[k])) continue;
      if (k === 'ts' && !(window.mpegts && mse())) continue;
      if (k === 'hls' && !(window.Hls && Hls.isSupported() && (isHlsUrl || hlsVariant(cur.origUrl || cur.url)))) continue;
      return k;
    }
    return null;
  }

  function reconnect(myToken, why) {
    if (myToken !== token || !cur) return;
    var now = Date.now();
    // Movies and catch-up continue from where they got to, not from the start.
    if (!cur.live && !cur.timeshift && cur.pos > 5) cur.startAt = cur.pos;
    if (!holding && cur.everPlayed) holdFrame();
    teardown();
    clearTimeout(cur.timer);              // several error events for one failure = one reconnect
    /* A live channel that keeps dropping on the MPEG-TS stream (three reconnects in three minutes)
       tries the provider's HLS version of it now, rather than after the whole reconnect budget: HLS
       comes in short pieces and often rides out a shaky connection better.  Remembered for this
       channel until TiviBro closes. */
    // (Not when the provider answered with an error: that is the provider having trouble, not the stream format.)
    if (cur.live && !cur.timeshift && cur.everPlayed && st && st.kind === 'ts' && !/^The provider answered/.test(why)) {
      cur.drops = (cur.drops || []).filter(function (x) { return now - x < 180000; }); cur.drops.push(now);
      if (cur.drops.length >= 3 && !(cur.late && cur.late.hls) && !(cur.tried && cur.tried.hls) && window.Hls && Hls.isSupported() && hlsVariant(cur.origUrl || cur.url)) {
        Log.info('player', 'This channel dropped ' + cur.drops.length + ' times in 3 minutes on MPEG-TS; trying its HLS version');
        cur.late = cur.late || {}; cur.late.ts = 1;
        useEngine('hls'); preferHls[cur.origUrl || cur.url] = 1; cur.drops = [];
      }
    }
    // No network: don't spend the budget.  Wait for it to come back, checking every few seconds.
    if (navigator.onLine === false) {
      Log.warn('player', 'Network is down; waiting for it before reconnecting');
      cur.offline = true;
      state('buffering', 'No network.  Waiting for it to come back');
      cur.timer = setTimeout(function () { if (myToken === token && cur) { if (navigator.onLine === false) reconnect(myToken, why); else { cur.offline = false; start(myToken); } } }, 3000);
      return;
    }
    cur.offline = false;
    cur.retries++;
    Log.warn('player', 'Reconnect ' + cur.retries + '/' + cur.p.retries + ': ' + why);
    var delay;
    if (cur.retries > cur.p.retries) {
      var alt = cur.slow || cur.lastFailHttp ? null : lateEngine(st ? st.kind : '');
      if (alt) {
        Log.info('player', 'Still failing; trying the ' + ENGINE_NAMES[alt]);
        useEngine(alt); cur.retries = Math.floor(cur.p.retries / 2);
      } else if (cur.live && !cur.timeshift && cur.everPlayed && now - (cur.slowSince || now) < SLOW_FOR) {
        if (!cur.slowSince) { cur.slowSince = now; Log.warn('player', 'Channel keeps failing; retrying every ' + SLOW_EVERY / 1000 + 's'); emit('trouble', 'stopped'); }
        releaseFrame();                    // a long outage: no frozen picture for minutes
        cur.slow = 'The channel stopped.  Still trying to get it back';
        state('buffering', cur.slow);
        cur.timer = setTimeout(function () { start(myToken); }, now - cur.slowSince < SLOW_FAST_FOR ? SLOW_FAST : SLOW_EVERY);
        return;
      } else {
        Log.error('player', 'Gave up after ' + cur.p.retries + ' reconnects' + (cur.slowSince ? ' and ' + Math.round((now - cur.slowSince) / 60000) + ' minutes of retrying' : '') + '  ' + cur.url);
        state('error', isFile() ? 'This video stopped loading.  Press OK to try again.' : 'This channel stopped responding.  Press OK to try again, or try another channel.');
        cur.failed = true;
        return;
      }
    }
    state('buffering', why);
    // Exponential backoff with jitter, so a TV and its neighbours don't all hit the provider at once.
    delay = Math.min(5000, 300 * Math.pow(2, Math.max(0, cur.retries - 1))) * (0.8 + Math.random() * 0.4);
    cur.timer = setTimeout(function () { start(myToken); }, delay);
  }

  /* The cushion a refill aims for: the profile's refill target plus what this channel has earned
     by running dry before (kept across reconnects of the same channel). */
  function capFor(p) { return Math.max(p.refill, Math.min(p.ahead * 0.6, 20)); }
  function refillGoal() { var p = cur.p; return Math.min(capFor(p), p.refill + (cur.boost || 0)); }
  function grow(p) {
    if (cur.preview) return;
    var before = cur.boost || 0;
    cur.boost = Math.min(capFor(p) - p.refill, before + Math.max(1.5, p.refill * 0.75));
    cur.boostAt = Date.now();
    if (cur.boost > before) Log.info('player', 'This channel keeps running dry; cushion raised to ' + refillGoal().toFixed(1) + 's');
  }

  function tick(myToken) {
    if (myToken !== token || !st || !video) return;
    var now = Date.now(), ahead = bufferedAhead(), t = video.currentTime;
    var p = cur.p;
    if (st.started && video.readyState > 0 && !video.seeking) cur.pos = t;
    var goal = refillGoal();
    var endNow = bufferEnd();
    if (endNow > (st.growEnd || 0) + 0.05) { st.growEnd = endNow; st.growAt = now; } else if (endNow < (st.growEnd || 0) - 1) { st.growEnd = endNow; st.growAt = now; }
    emit('stats', lastStats = { ahead: ahead, target: st.started ? goal : p.prebuffer, cushion: cur.boost || 0, engine: eng ? eng.name : '', info: eng ? eng.info() : '',
      res: video.videoHeight ? video.videoHeight + 'p' : '', state: st.state });

    // 1. Prebuffer before the first frame.
    if (!st.started) {
      // Live streams often buffer from a timestamp after 0 (e.g. 1.4s).  Measure from the start of
      // what is buffered, and move the playhead there before playing.
      var bf = video.buffered, first = bf.length ? bf.start(0) : 0;
      if (bf.length && video.currentTime < first) ahead = bf.end(0) - first;
      // After this channel has run dry, reconnects wait for the bigger cushion too (capped so a
      // reconnect never sits for long).
      var need = cur.boost && cur.everPlayed && cur.starved ? Math.min(Math.max(p.prebuffer, refillGoal()), p.prebuffer + 2) : p.prebuffer;
      var ready = video.readyState >= 2 && (ahead >= need || now - st.at > 4000 + need * 1000);
      // A movie resuming part way through: the TV player buffers at the new spot after the seek.
      if (cur.startAt && isFile() && video.readyState >= 1) ready = true;
      if (ready) {
        st.started = true; st.lastMove = now;
        if (!cur.audioPicked) { cur.audioPicked = true; preferAudio(); }
        if (cur.slow) { Log.info('player', 'Channel is back after ' + Math.round((now - cur.slowSince) / 1000) + 's'); notice('Back on air'); }
        cur.slow = ''; cur.everPlayed = true; cur.failed = false; cur.httpFails = 0; cur.lastHttp = 0; cur.starved = false; cur.lastFailHttp = false;
        Log.info('player', 'Playing after ' + (now - st.at) + 'ms with ' + ahead.toFixed(1) + 's buffered' + (ahead < p.prebuffer ? ' (prebuffer timed out)' : '') + (video.videoHeight ? ', ' + video.videoWidth + 'x' + video.videoHeight : ''));
        if (bf.length && video.currentTime < first && !cur.startAt) { try { video.currentTime = first + 0.05; } catch (e) {} }
        st.growAt = now;
        if (cur.startAt && !cur.live) { try { video.currentTime = cur.startAt; } catch (e) {} cur.pos = cur.startAt; cur.startAt = 0; }
        if (st.userPaused) return;
        var pr = video.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else if (now - st.at > 15000 + need * 1000) {
        Log.warn('player', 'No playable video after ' + (now - st.at) + 'ms (readyState ' + video.readyState + ', buffered ' + ahead.toFixed(1) + 's)');
        reconnect(myToken, 'No video yet, retrying');
      }
      return;
    }

    // Seeking a movie: the TV player is fetching the new spot, which is not a stall.
    if (video.seeking) {
      if (!st.seekSince) st.seekSince = now;
      if (now - st.seekSince < 15000) { st.lastMove = now; return; }
    } else st.seekSince = 0;

    // 3. Timestamp jump: new video is arriving somewhere else on the timeline.  Follow it.
    if (!isFile() && !st.userPaused && (now - st.lastMove > 500 || ahead < 0.5)) {
      var jt = jumpTarget(t);
      if (jt) {
        Log.info('player', 'Stream timestamps jumped by ' + (jt.start - t).toFixed(1) + 's; following the stream');
        try { video.currentTime = jt.start + 0.05; } catch (e) {}
        st.lastMove = now; st.lastT = -1; st.jumps = (st.jumps || 0) + 1;
        if (st.refilling) { st.refillSince = now; }
        return;
      }
    } else if (!isFile() && video.buffered.length > 1) jumpTarget(t);    // keep the growth baseline current

    // Live TV paused longer than the buffer can hold: let the connection go rather than have it
    // time out or overflow, and come back at the live edge on play.
    if (st.userPaused && cur.live && !cur.timeshift && !st.parked && now - st.pausedAt > Math.max(30, p.ahead) * 1000) {
      Log.info('player', 'Live TV paused for ' + Math.round((now - st.pausedAt) / 1000) + 's; closing the stream until play');
      st.parked = true;
      teardown();
      return;
    }

    // 2. Refill goal: once dry, stay paused until there's a real cushion.
    if (st.refilling) {
      // Resume at the full goal, or after 4s once the profile's own target is there: a refill
      // should never become a long wait just because the cushion grew.
      if (ahead >= goal || (ahead >= p.refill && now - st.refillSince > 4000) || now - st.refillSince > 6000 + goal * 1000) {
        st.refilling = false; st.lastMove = now;
        if (eng && eng.edge && cur.live && !cur.timeshift) eng.edge();
        var pr2 = video.play(); if (pr2 && pr2.catch) pr2.catch(function () {});
        state('playing');
      } else if (now - st.refillSince > 3000 && now - (st.growAt || st.refillSince) > 4000) {
        // Nothing has arrived for 4s: the provider stopped sending.  A fresh connection usually
        // comes with a burst, so reconnect rather than wait it out.
        st.refilling = false;
        cur.starved = true;
        reconnect(myToken, 'No data from the provider, reconnecting');
      } else if (now - st.refillSince > p.stall * 1000 && ahead < 0.2) {
        st.refilling = false;
        cur.starved = true;
        reconnect(myToken, 'Stream stalled, reconnecting');
      }
      return;
    }

    if (st.pendingReconnect && ahead < Math.max(2, p.prebuffer)) { st.pendingReconnect = false; reconnect(myToken, 'Reconnecting'); return; }
    if (isFile() && video.ended) {
      // The TV player sometimes reports "ended" when the connection drops mid-film.
      var d = video.duration;
      if (isFinite(d) && d > 120 && t < d - 30) { Log.warn('player', 'Video ended at ' + Math.round(t) + 's of ' + Math.round(d) + 's; treating it as a dropped connection'); cur.pos = t; reconnect(myToken, 'Connection dropped, reconnecting'); return; }
      clearInterval(wd); wd = 0; state('ended'); return;
    }
    if (t !== st.lastT && !video.paused) {
      st.lastT = t; st.lastMove = now;
      if (st.state !== 'playing') state('playing');
      if (!st.healthySince) st.healthySince = now;
      // 30s of clean playback earns the retry budget back; 3 clean minutes halve the extra cushion.
      if (now - st.healthySince > 30000 && (cur.retries || cur.slowSince)) { cur.retries = 0; cur.triedNative = false; cur.slowSince = 0; cur.late = null; }
      if (cur.boost && now - st.healthySince > 180000 && now - (cur.boostAt || 0) > 180000) { cur.boost = Math.round(cur.boost * 5) / 10; cur.boostAt = now; if (cur.boost < 0.5) cur.boost = 0; Log.info('player', 'Clean for 3 minutes; extra cushion now ' + cur.boost + 's'); }
      return;
    }
    if (video.paused && !st.refilling) {
      // Paused but not by the viewer: a play() the TV rejected, or a decoder hiccup.  Kick it.
      if (!st.userPaused && now - (st.kicked || 0) > 1000) {
        st.kicked = now;
        var pk = video.play(); if (pk && pk.catch) pk.catch(function () {});
      }
      if (st.userPaused) { st.lastMove = now; return; }
    }

    var stuck = now - st.lastMove;
    st.healthySince = 0;
    // 3. Gap jump: a hole just ahead of the playhead.
    if (stuck > 800) {
      var gap = nextRangeStart();
      if (gap > 0) { Log.debug('player', 'Jumped a ' + (gap - t).toFixed(2) + 's gap in the buffer'); video.currentTime = gap + 0.05; st.lastMove = now; return; }
    }
    // Ran dry: start a proper refill instead of stutter-playing.
    if (stuck > 600 && ahead < 0.3) {
      st.refilling = true; st.refillSince = now; st.refills = (st.refills || 0) + 1;
      grow(p);
      Log.info('player', 'Buffer ran dry (' + st.refills + ' times this stream); refilling to ' + refillGoal().toFixed(1) + 's');
      video.pause();
      state('buffering', 'Buffering');
      return;
    }
    // 4. Clock stopped with data in hand: decoder problem.  Nudge, recover, then reconnect.
    if (stuck > p.stall * 1000) {
      if (!st.nudged) { Log.warn('player', 'Picture froze for ' + (stuck / 1000).toFixed(1) + 's with ' + ahead.toFixed(1) + 's buffered; nudging the decoder'); st.nudged = 1; video.currentTime = t + 0.1; if (eng) eng.recover(); st.lastMove = now; return; }
      st.nudged = 0;
      reconnect(myToken, 'Picture froze, reconnecting');
    }
  }

  function bind(v) {
    video = v;
    // Console logging is real CPU on a TV.  Keep only errors.
    if (window.mpegts && mpegts.LoggingControl) { mpegts.LoggingControl.enableVerbose = false; mpegts.LoggingControl.enableDebug = false; mpegts.LoggingControl.enableInfo = false; mpegts.LoggingControl.enableWarn = false; }
    video.muted = false;
    video.removeAttribute('muted');
    video.addEventListener('error', function () {
      // MSE engines report their own errors; this listener is for the native pipeline.
      if (!cur || !st || st.kind !== 'native' || !video.error || !video.getAttribute('src')) return;
      Log.warn('player', 'TV player error code ' + video.error.code + (video.error.message ? ': ' + video.error.message : '') + '  ' + cur.url);
      var my = token;
      if (st.kind === 'native' && !st.started) {
        // Native refused the container or codec: try the next pipeline, once each.
        fallbackHosts[hostOf(cur.url)] = '';
        var alt = nextEngine('native');
        if (alt) { Log.info('player', 'Trying the ' + ENGINE_NAMES[alt] + ' after the TV player refused it'); useEngine(alt); return start(my); }
        return giveUp(my);
      }
      reconnect(my, 'Playback error, reconnecting');
    });
    // The network coming back is the best moment to retry: don't wait out a backoff timer, and
    // pick a channel that gave up back up by itself.
    window.addEventListener('online', function () {
      if (!cur) return;
      if (cur.offline || cur.failed || cur.slow) {
        Log.info('player', 'Network is back; reconnecting now');
        cur.offline = false; cur.failed = false; cur.retries = 0; cur.slowSince = 0; cur.slow = '';
        start(token);
      }
    });
    window.addEventListener('offline', function () { if (cur) Log.warn('player', 'Network went down'); });
  }

  // opts: preview, url (override: catch-up / VOD), live (default true), startAt (seconds, VOD resume),
  //       media (codec facts known up front, Caps shape), urlFn (catch-up: a new URL per connect)
  function play(ch, opts) {
    opts = opts || {};
    token++;
    if (cur) clearTimeout(cur.timer);
    lastStats = null;                       // no stale numbers from the last channel in Stream info
    var fmt = Store.settings.format;
    cur = { ch: ch, url: opts.url || Source.streamUrl(ch, fmt), p: cfg(opts.preview), preview: !!opts.preview, retries: 0,
      forceNative: false, triedNative: false, live: opts.live !== false, startAt: opts.startAt || 0, meta: opts.meta || null,
      timeshift: !!opts.timeshift, urlFn: opts.urlFn || null, pos: opts.startAt || 0,
      media: opts.media || (opts.meta && opts.meta.media) || null, opts: opts };
    // keepTrying: a channel known to work here (back from its backups during an outage) retries
    // like one that has played, instead of giving up after the first round.
    if (opts.keepTrying) cur.everPlayed = true;
    applyDisplay();
    releaseFrame();                         // a new channel never shows the last one's picture
    if (video) video.playbackRate = 1;
    if (cur.live && !cur.timeshift && preferHls[cur.url] && window.Hls && Hls.isSupported() && hlsVariant(cur.url)) { Log.info('player', 'Using the HLS version of this channel, which played better earlier'); useEngine('hls'); }
    start(token);
  }
  // Picture size: this channel's own choice if it has one, otherwise the global setting.
  function displayFor(ch) { var d = ch && Store.edits.display && Store.edits.display[ch.k]; return d || Store.settings.display || 'contain'; }
  function applyDisplay() { if (video) video.style.objectFit = displayFor(cur && cur.ch); }
  function playing() { return !!(st && st.started && video && video.readyState > 0); }
  function seekTo(t) {
    if (!video || !cur || cur.live) return;
    var d = video.duration;
    if (isFinite(d) && d > 0) t = U.clamp(t, 0, Math.max(0, d - 2));
    t = Math.max(0, t);
    cur.pos = t;
    if (!playing()) { cur.startAt = t; return; }        // reconnecting: the new connection starts there
    if (st) st.lastMove = Date.now();
    video.currentTime = t;
    if (eng && eng.reanchor) eng.reanchor();
  }
  function seek(delta) { if (cur && !cur.live) seekTo(position() + delta); }
  // Same channel, new mode (preview -> fullscreen): keep the stream, just widen the policy.
  function upgrade(preview) {
    if (!cur) return;
    cur.preview = preview;
    cur.p = cfg(preview);
  }
  function stop() { token++; if (cur) clearTimeout(cur.timer); cur = null; held = null; teardown(); state('idle'); Log.state('player', ''); }

  function setPaused(want) {
    if (!video || !st || !cur) return;
    cur.userPaused = want;
    if (!want) {
      st.userPaused = false; st.lastMove = Date.now();
      if (st.parked) {
        // Paused live TV whose connection was let go: back to the live edge.
        cur.retries = 0;
        notice('Back to live');
        start(token);
        return;
      }
      var r = video.play(); if (r && r.catch) r.catch(function () {});
    } else {
      st.userPaused = true; st.pausedAt = Date.now();
      video.pause();
    }
  }
  function togglePause() { if (video && st) setPaused(!st.userPaused); }
  // A fresh go from the top: every pipeline gets another chance.
  function retryNow() {
    if (!cur) return;
    if (cur.origUrl) cur.url = cur.origUrl;
    cur.retries = 0; cur.triedNative = false; cur.failed = false; cur.slowSince = 0; cur.slow = '';
    cur.tried = null; cur.late = null; cur.forceKind = null; cur.forceNative = false; cur.routed = false; cur.httpFails = 0; cur.lastHttp = 0;
    start(token);
  }

  /* The app going to the background (Home, another input): let the stream go so the decoder and
     the provider connection are free, and pick up where it was on return. */
  var held = null;
  function suspend() {
    if (!cur) return false;
    held = cur;
    held.pos = position();
    token++;
    clearTimeout(cur.timer);
    teardown();
    Log.info('player', 'App hidden; stream closed' + (isFile() ? ' at ' + Math.round(held.pos) + 's' : ''));
    return true;
  }
  function resume() {
    if (!held || cur !== held) { held = null; return false; }
    held = null;
    if (!cur.live && !cur.timeshift && cur.pos > 5) cur.startAt = cur.pos;
    cur.retries = 0; cur.failed = false; cur.slowSince = 0; cur.slow = '';
    if (st) st.parked = false;
    token++;
    start(token);
    return true;
  }
  function position() {
    if (playing()) return video.seeking && cur && cur.pos != null ? cur.pos : video.currentTime;
    return cur ? cur.pos || 0 : 0;
  }

  return {
    _test: { reconnect: function (why) { reconnect(token, why || 'test'); }, get holding() { return holding; }, get kind() { return st && st.kind; } },
    PRESETS: PRESETS, bind: bind, play: play, stop: stop, upgrade: upgrade, togglePause: togglePause, setPaused: setPaused, retryNow: retryNow, on: on,
    seek: seek, seekTo: seekTo, applyDisplay: applyDisplay, suspend: suspend, resume: resume,
    audioTracks: function () { return eng && eng.audio ? eng.audio() : []; },
    qualities: function () { return eng && eng.levels ? eng.levels() : []; },
    qualityAuto: function () { return !!(eng && eng.auto && eng.auto()); },
    setQuality: function (i) { if (eng && eng.setLevel) eng.setLevel(i); },
    setRate: function (r) { if (video) video.playbackRate = r; },
    get rate() { return video ? video.playbackRate : 1; },
    displayFor: displayFor,
    setAudio: function (i) { if (eng && eng.setAudio) { if (cur) cur.userAudio = true; eng.setAudio(i); } },
    bestAudio: bestAudio, describeTrack: describeTrack,
    get stats() { return lastStats; },
    get current() { return cur && cur.ch; },
    get live() { return !cur || cur.live; },
    get meta() { return cur && cur.meta; },
    // What the stream is: "4K  HEVC  Dolby Vision 8  E-AC-3 5.1", once known.
    get media() { return cur && cur.media ? Caps.label(cur.media) : ''; },
    get mediaInfo() { return cur && cur.media; },
    get engine() { return st ? ENGINE_NAMES[st.kind] || st.kind : ''; },
    get position() { return position(); },
    get duration() { return video && isFinite(video.duration) ? video.duration : 0; },
    get paused() { return !video || video.paused; },
    get userPaused() { return !!(st && st.userPaused); },
    get playing() { return !!(st && st.state === 'playing'); }
  };
})();
