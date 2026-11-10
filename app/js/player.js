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
   otherwise; codecs MSE can't take go to the TV player.

   Sound the TV can't play (DTS on 2020 to 2022 TVs, TrueHD, surround FLAC): Convert.plan() is asked
   before a movie starts.  It may pick another audio track, or have the helper convert the sound
   (cur.conv).  A converted movie is a stream, not a file: a seek starts a new conversion at that time
   (conv.t), and position = conv.base + video.currentTime, where conv.base is conv.t unless the TV's
   player already shows the movie's own times.  Everything outside asks Player.position, and
   subtitles add video._tbOffset (the same base) to the video's clock. */
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

  function cfg(preview, url) {
    var s = Store.settings, p;
    if (s.buffer === 'auto' && window.PlayMemo) {
      // Automatic: what this provider has shown so far (playmemo.js).
      p = PlayMemo.auto(hostOf(url || ''));
      p.label = 'Automatic (' + p.why + ')'; p.chase = false;
    } else if (s.buffer === 'custom') {
      var c = s.custom;
      p = { label: 'Custom', prebuffer: +c.prebuffer, ahead: +c.ahead, back: +c.back, stall: +c.stall, retries: +c.retries,
        stash: Math.round(U.clamp(c.prebuffer * 160, 128, 2048)), chase: c.prebuffer < 1 };
    } else p = PRESETS[s.buffer === 'auto' ? 'balanced' : s.buffer] || PRESETS.balanced;
    p = Object.assign({}, p);
    // Previews should appear fast; the full preset applies once you go fullscreen.
    if (preview) p.prebuffer = Math.min(p.prebuffer, 1.2);
    p.refill = Math.max(2, p.prebuffer * 1.5);
    // Memory-safe (issues #42, #46): on a TV that closed TiviBro while it played, or one with 1 GB of
    // memory or less, the video held in memory is capped whatever the profile asks.  On a small TV,
    // a minute of 1080p read ahead plus a big cushion, and a reconnect building a new player while the
    // old one's memory is still being freed, was enough for webOS to close TiviBro.
    if (memSafe()) {
      p.ahead = Math.min(p.ahead, 20); p.back = Math.min(p.back, 4); p.stash = Math.min(p.stash, 384);
      p.label += ', memory-safe';
    }
    return p;
  }
  var safeWhy = '';
  function lowMemory() {
    var m = typeof navigator !== 'undefined' && navigator.deviceMemory;
    if (m) return m <= 1;
    return !!(typeof Caps !== 'undefined' && Caps.small);       // not reported: an LG HD or Full HD set (caps.js)
  }
  function memSafe() { return !!safeWhy || lowMemory(); }
  /** Called at start when TiviBro closed while playing lately (app.js). */
  function memorySafe(why) { safeWhy = why || ''; if (why) Log.warn('player', 'Holding less video in memory: ' + why); }

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
  /* The playlist a stream belongs to: with several playlists on, its User-Agent goes with every
     request (Net.wrap's pl), whatever host the segments come from. */
  function plWrap() { return { pl: Store.plOf ? Store.plOf(cur && cur.ch) : Store.playlist }; }
  function hlsEngine(url, p, preview, fail, media, tracks) {
    var live = cur.live && !cur.timeshift, pw = plWrap();
    url = Net.wrap(url, pw);
    var h = new Hls({
      // Every playlist, key and segment request goes through the relay when it is in use.
      xhrSetup: function (xhr, u) { xhr.open('GET', Net.wrap(u, pw), true); },
      debug: false, enableWorker: workerOk, lowLatencyMode: false, startFragPrefetch: true,
      liveSyncDurationCount: p.chase ? 2 : Math.round(U.clamp(p.prebuffer / 2 + 2, 3, 6)),
      liveMaxLatencyDurationCount: p.chase ? 5 : Infinity,
      maxBufferLength: p.ahead, maxMaxBufferLength: p.ahead * 2, backBufferLength: p.back,
      // Memory-safe TVs (1 GB) keep less in memory here too.
      maxBufferSize: (memSafe() ? 40 : 80) * 1000 * 1000, maxBufferHole: 0.5, nudgeMaxRetry: 6, highBufferWatchdogPeriod: 2,
      /* Not capped on dropped frames: TVs report drops that aren't (the decoder is the TV's), and the picture
         then stayed at a low quality for the rest of the channel. */
      capLevelToPlayerSize: preview, capLevelOnFPSDrop: false,
      manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 400,
      manifestLoadingTimeOut: 12000, levelLoadingTimeOut: 10000, fragLoadingTimeOut: 20000,
      liveDurationInfinity: live, enableWebVTT: true, enableCEA708Captions: true, renderTextTracksNatively: true
    });
    // Media errors: recover, then recover with the audio codec swapped.  The count resets once
    // playback has run clean for a while, so one bad patch an hour in still gets recovered.
    var mediaErrs = 0, lastMediaErr = 0, netRecovers = 0, lastNetErr = 0;
    /* Start where it played last time, or at the best picture that fits the screen (1080 lines, and not
       Dolby Vision, which this pipeline can't play), like TiviMate: hls.js would start from a bandwidth
       guess, usually low, and climb.  Automatic quality carries on from there. */
    var chMemo = cur.ch;
    h.on(Hls.Events.MANIFEST_PARSED, function (e, d) {
      var lv = (d && d.levels) || [];
      if (!preview && lv.length > 1) {
        var want = window.PlayMemo && PlayMemo.level ? PlayMemo.level(chMemo) : 0, pick = -1, best = -1;
        lv.forEach(function (l, i) {
          var ht = +l.height || 0, hdr = /^(dvh|dvav)/i.test(l.videoCodec || '');
          if (want && ht === want) pick = i;
          if (!hdr && ht <= 1080 && (best < 0 || ht > (+lv[best].height || 0) || (ht === (+lv[best].height || 0) && (l.bitrate || 0) > (lv[best].bitrate || 0)))) best = i;
        });
        var start = pick >= 0 ? pick : best;
        if (start >= 0) { h.startLevel = start; Log.debug('player', 'HLS starting at ' + (lv[start].height || '?') + 'p' + (pick >= 0 ? ' (as last time)' : '')); }
      }
      media(Caps.bestHlsLevel(lv));
    });
    h.on(Hls.Events.LEVEL_SWITCHED, function (e, d) {
      var l = h.levels && h.levels[d.level];
      if (l && l.height && !preview && window.PlayMemo && PlayMemo.setLevel && st && st.started) PlayMemo.setLevel(chMemo, l.height);
    });
    h.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { tracks(); });
    // The first piece was read and its tracks are known (like the demuxer's media info): from here, nothing
    // buffered after 8 s is the format, not the connection (issue #65).
    h.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, function () { if (st) st.gotInfo = true; });
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
      /* An answer that isn't an HLS playlist (manifestParsingError with HTTP 200: a web page, an error text, a
         TS stream at an .m3u8 address) won't become one on a retry (issue #56): not HLS, on to the next. */
      if (!(st && st.started) && /^(manifestParsingError|levelEmptyError|manifestIncompatibleCodecsError)$/.test(d.details) && !(code >= 400)) {
        if (cur) { cur.bad = cur.bad || {}; cur.bad.hls = 1; }
        return fail('media', 'not an HLS playlist (' + d.details + (code ? ', HTTP ' + code : '') + ')', false, false, 0);
      }
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
    url = Net.wrap(url, plWrap());
    /* Audio-only (radio) or video-only channels: mpegts waits for the missing track for ever, and the picture
       never started until a fallback 8 to 15 s later.  The tracks the stream really has (its media info) go
       into a new player at once (cur.tsTracks), kept for this channel's reconnects. */
    var tr = cur.tsTracks || { a: true, v: true };
    /* Live: start dispatching data almost at once.  mpegts holds the first bytes until its stash fills (up to
       1.5 MB with the bigger buffer settings, seconds of a low-bitrate channel) and sizes it from the speed
       after the first half second anyway; the app's own prebuffer is what keeps the cushion. */
    var m = mpegts.createPlayer({ type: 'mpegts', isLive: live, url: url, hasAudio: tr.a, hasVideo: tr.v }, {
      enableWorker: workerOk, enableStashBuffer: true, stashInitialSize: (live ? Math.min(p.stash, 64) : p.stash) * 1024,
      lazyLoad: false, deferLoadAfterSourceOpen: false, seekType: 'range',
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: p.back, autoCleanupMinBackwardDuration: Math.max(2, p.back / 2),
      liveBufferLatencyChasing: p.chase, liveBufferLatencyMaxLatency: p.chase ? 3 : 60, liveBufferLatencyMinRemain: p.chase ? 0.8 : 3,
      fixAudioTimestampGap: true, reuseRedirectedURL: true
    });
    var gotData = false;
    m.on(mpegts.Events.MEDIA_INFO, function (mi) {
      gotData = true; if (st) st.gotInfo = true; if (mi && mi.mimeType) Log.debug('player', 'Stream codecs: ' + mi.mimeType);
      var has = { a: !!(mi && mi.hasAudio !== false), v: !!(mi && mi.hasVideo !== false) };
      if (mi && (has.a || has.v) && (has.a !== tr.a || has.v !== tr.v) && !cur.tsTracks) {
        cur.tsTracks = has;
        Log.info('player', 'This stream has ' + (has.v ? 'no sound' : 'no picture') + ': playing what it has');
        return fail('net', 'tracks', false, true);
      }
      media(Caps.fromMpegts(mi));
    });
    m.on(mpegts.Events.ERROR, function (type, detail, info) {
      // Only a fetch the browser refused outright ("Exception": CORS, TLS) says the host needs the
      // TV player.  An HTTP error before data is usually the provider's connection limit while
      // the last channel hangs up, and a reconnect a moment later fixes it.
      var net = type === mpegts.ErrorTypes.NETWORK_ERROR;
      fail(net ? 'net' : 'media', detail + (info && info.code ? ' (HTTP ' + info.code + ')' : '') + (info && info.msg ? ' (' + info.msg + ')' : ''), !gotData && net && detail === 'Exception', false, !gotData && info && info.code >= 400 ? info.code : 0);
    });
    // Live TS that "completes" means the server hung up.  Reconnect right away.
    if (live) m.on(mpegts.Events.LOADING_COMPLETE, function () { fail('net', 'server closed stream', false, true); });
    // Closed captions: the caption SEIs the patched demuxer hands over (vendor/PATCHES.md).
    m.on(mpegts.Events.PES_PRIVATE_DATA_ARRIVED, function (d) { if (d && d.pid === -608 && ccDec) ccDec.feed(d.data, d.pts); });
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
      /* Every step on its own (issue #70): one try for all four left the player half alive when unload threw (a
         sound or picture buffer the browser had already dropped).  Its stream kept loading from the provider
         after the channel changed, a second connection, and each piece it read threw an error.  Letting go of
         the picture first (detach) means destroy's own unload has nothing left to trip on. */
      destroy: function () {
        try { m.pause(); } catch (e) {}
        var fine = true;
        try { m.unload(); } catch (e) { fine = false; Log.debug('player', 'MPEG-TS player unload: ' + e.message); }
        try { m.detachMediaElement(); } catch (e) { fine = false; Log.debug('player', 'MPEG-TS player detach: ' + e.message); }
        try { m.destroy(); } catch (e) { Log.warn('player', 'MPEG-TS player did not close' + (fine ? '' : ' after an error') + ': ' + e.message); }
      }
    };
  }

  // Blob workers should work in webOS apps; if one ever fails, demux on the main thread instead.
  var workerOk = (function () {
    try { var u = URL.createObjectURL(new Blob(['0'], { type: 'text/javascript' })); var w = new Worker(u); w.terminate(); URL.revokeObjectURL(u); return true; }
    catch (e) { return false; }
  })();

  function nativeEngine(url, tracks, conv) {
    // HTTPS on the TV's own player can fail on self-signed or unusual certificates, which IPTV
    // panels often have.  The helper accepts them and passes Range requests through for seeking.
    // A conversion link (conv) is the helper's already; its subtitles come from the movie itself.
    var play = url, pw = plWrap(), ua = Net.uaFor ? Net.uaFor(pw.pl) : Net.ua;
    if (conv) { url = conv.src; if ((/^https:/i.test(url) || ua) && Net.active) url = Net.wrap(url, pw); }
    else if ((/^https:/i.test(url) || ua) && Net.active) { url = Net.wrap(url, pw); play = url; Log.info('player', 'TV player using the helper' + (ua ? ' (custom User-Agent)' : ' for HTTPS')); }
    function loadNative(resolved) { video.src = conv ? play : resolved; video.load(); }
    // Resolve the provider entry URL once. Both playback and subtitle ranges use
    // the same resulting session URL; opening the entry separately can evict video.
    // MKV and MP4 files carry subtitles the TV's player doesn't show: their reader finds them.
    var subs = null, reader = null;
    var item = cur.meta && cur.meta.item || {}, container = item.ext || item.container_extension || '';
    if (!cur.live && (/\.mkv(\?|#|$)/i.test(url) || /^mkv$/i.test(container)) && typeof MkvSubs !== 'undefined') reader = MkvSubs;
    else if (!cur.live && typeof Mp4Subs !== 'undefined' && Mp4Subs.isMp4(url, container)) reader = Mp4Subs;
    if (reader) subs = reader.extract(url, video, loadNative, container);
    else loadNative(play);
    var at0 = video.audioTracks, onAdd = at0 && at0.addEventListener ? U.debounce(tracks, 300) : null;
    if (onAdd) at0.addEventListener('addtrack', onAdd);
    return { name: 'Native', recover: function () {}, info: function () { return ''; },
      // Abort reads at the old position and replay cached cues while extraction
      // waits for the seek to finish and the playback buffer to refill.
      reanchor: function () { if (subs) { subs.cancel(); subs = reader ? reader.extract(url, video, null, container) : null; } },
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
      holdEl.style.transform = video.style.transform || '';
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

  /* ---------- closed captions ----------
     CEA-608 captions in the video (US channels).  The built-in demuxer: decoded by Captions
     (captions.js) and drawn here over the picture.  The HLS engine: hls.js makes a "captions" text
     track that the TV draws; this shows or hides it.  The TV player: not possible from an app.
     Shown only fullscreen, when Settings > Playback > Closed captions (or the quick menu) is on. */
  var ccDec = null, ccEl = null, ccLast = '', ccStarted = 0;
  var CC_SIZE = { s: 0.040, m: 0.048, l: 0.060 };
  function ccOn() { return !!Store.settings.cc; }
  function ccTracks() { var t = video && video.textTracks, out = []; for (var i = 0; t && i < t.length; i++) if (t[i].kind === 'captions') out.push(t[i]); return out; }
  function ccDraw() {
    if (!video) return;
    var stage = video.parentNode, full = stage && stage.classList && stage.classList.contains('full'), kind = st && st.kind;
    var want = ccOn() && full && st && st.started;
    // hls.js: its own captions track.
    ccTracks().forEach(function (t, i) { var m = want && kind === 'hls' && i === 0 ? 'showing' : 'hidden'; if (t.mode !== m) t.mode = m; });
    var lines = want && kind === 'ts' && ccDec ? ccDec.screenAt(video.currentTime * 1000) : null;
    var key = lines ? lines.key + '|' + (Store.settings.ccSize || 'm') : '';
    if (key === ccLast) return;
    ccLast = key;
    if (!ccEl) { ccEl = document.createElement('div'); ccEl.className = 'cc'; }
    if (ccEl.parentNode !== stage && stage) stage.appendChild(ccEl);
    ccEl.innerHTML = '';
    if (!lines || !lines.lines.length) { ccEl.style.display = 'none'; return; }
    ccEl.style.display = '';
    ccEl.style.fontSize = Math.round((stage.clientHeight || 1080) * (CC_SIZE[Store.settings.ccSize] || CC_SIZE.m)) + 'px';
    lines.lines.forEach(function (l) {
      var d = document.createElement('div'), sp = document.createElement('span');
      d.className = 'cc-line';
      d.style.top = (10 + (l.row - 1) * 80 / 15) + '%';
      d.style.left = (10 + l.col * 80 / 32) + '%';
      sp.textContent = l.text;
      d.appendChild(sp); ccEl.appendChild(d);
    });
  }
  setInterval(function () { try { ccDraw(); } catch (e) {} if (ccDec && video && st && st.started) ccDec.trim(video.currentTime * 1000 - 5000); }, 200);
  // What the quick menu says: on or off, and whether this channel sends any.
  function ccState() {
    var kind = st && st.kind, found = kind === 'ts' ? !!(ccDec && ccDec.seen) : kind === 'hls' ? ccTracks().length > 0 : false;
    return { on: ccOn(), engine: kind || '', found: found, possible: kind === 'ts' || kind === 'hls', waited: ccStarted && Date.now() - ccStarted > 12000 };
  }

  /* ---------- lifecycle ---------- */
  function teardown() {
    clearInterval(wd); wd = 0;
    if (video) video._tbOffset = 0;
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
    var url = cur.url, p = cur.p, conv = cur.conv;
    var kind = cur.forceKind || (cur.forceNative ? 'native' : pickEngine(url));
    if (conv) {
      // A converted movie starts where it should be (resume, reconnect, seek): the stream begins there.
      if (cur.startAt) { conv.t = cur.startAt; cur.startAt = 0; }
      conv.base = conv.t || 0; conv.checked = false;
      url = Convert.link(conv);
      kind = conv.fmt === 'ts' && window.mpegts && mse() && Caps.probe().mse.ac3 ? 'ts' : 'native';
    }
    // Known codecs up front (a movie's details): route before anything loads.
    if (!conv && !cur.forceKind && !cur.forceNative && kind !== 'native' && cur.media && !cur.routed) {
      var r0 = Caps.route(cur.media, hdrPolicy());
      if (r0.engine === 'native') { cur.routed = true; Log.info('player', r0.reason); useEngine('native'); kind = 'native'; }
    }
    Log.state('player', 'playing ' + (cur.ch && cur.ch.n ? '"' + cur.ch.n + '"' : 'a video') + ' with the ' + kind + ' engine');
    Log.info('player', 'Start ' + (cur.ch && cur.ch.n ? '"' + cur.ch.n + '" ' : '') + 'with ' + kind + ' engine' + (kind !== 'native' && Net.active ? ' via helper' : '') + ', profile ' + p.label + ' (prebuffer ' + p.prebuffer + 's)' + (cur.retries ? ', attempt ' + (cur.retries + 1) : '') + (cur.startAt ? ', from ' + Math.round(cur.startAt) + 's' : '') + (conv ? ', sound converted from ' + Math.round(conv.t) + 's' : '') + '  ' + (conv ? cur.url : url));
    var gen = cur.gen = (cur.gen || 0) + 1;     // a torn-down engine's late events are ignored
    ccDec = window.Captions ? Captions.create() : null; ccStarted = Date.now();
    st = { state: 'loading', started: false, lastT: -1, lastMove: Date.now(), refilling: false, refillSince: 0,
      kind: kind, at: Date.now(), healthySince: 0, userPaused: isFile() && !!cur.userPaused };
    state(cur.slow ? 'buffering' : 'loading', cur.slow ? cur.slow : holding ? 'Reconnecting' : undefined);

    var fail = function (type, detail, earlyNet, ended, http) {
      // Provider status (provstatus.js): a stream the provider's server refused, errored or never answered.
      if (window.ProvStatus && cur.live && (http || /timeout|upstream|ENOTFOUND|ECONNREFUSED/i.test(String(detail || '')))) ProvStatus.note(cur.origUrl || cur.url, false, http || ((/E[A-Z]{3,}[A-Z_]*/.exec(String(detail)) || [])[0] || 'timeout'), 'stream');
      if (myToken !== token || gen !== cur.gen) return;
      if (conv && !st.started && !conv.played) return convFailed(myToken, kind + ' ' + type + ': ' + detail);
      Log.warn('player', kind + ' engine ' + type + ' error: ' + (detail && detail.message ? detail.message : detail) + (st.started ? '' : ' (before first frame)') + '  ' + cur.url);
      // The server answered with an error before any video.  Twice is worth a quick retry (a
      // connection limit while the last channel hangs up clears in a second or two); after that
      // the next pipeline gets a go rather than a minute of retries on a dead link.
      cur.lastFailHttp = !!http;
      // A channel that has played here before and now gets an HTTP error is the provider having
      // trouble (outage, connection limit), not the pipeline: keep retrying the same way.
      if (http && cur.everPlayed) { cur.lastHttp = http; return reconnect(myToken, 'The provider answered ' + http + ', retrying'); }
      /* "Not found" for a live channel that hasn't played: the provider doesn't have it, and asking again,
         or with another player for the same address, gets the same answer (issue #56: three MPEG-TS tries,
         the TV player and two HLS tries, about 15 s each, before "No player could open this channel").  Its
         HLS version is another address, so that is tried once; otherwise it's marked not playing at once. */
      if ((http === 404 || http === 410) && !st.started && cur.live && !cur.timeshift && !cur.everPlayed) {
        cur.lastHttp = http; cur.tried = cur.tried || {};
        cur.tried.ts = cur.tried.native = 1;
        if (kind !== 'hls' && !(cur.bad && cur.bad.hls) && window.Hls && Hls.isSupported() && hlsVariant(cur.origUrl || cur.url) && !cur.tried.hls) {
          Log.info('player', 'HTTP ' + http + ': the provider doesn\'t have this channel at that address; trying its HLS version once'); useEngine('hls'); return start(myToken);
        }
        Log.warn('player', 'HTTP ' + http + ': the provider doesn\'t have this channel; not retrying');
        return giveUp(myToken);
      }
      if (http && !st.started && kind !== 'native') {
        cur.httpFails = (cur.httpFails || 0) + 1;
        cur.lastHttp = http;
        // "Busy" answers (connection limit, rate limit, overloaded) clear once the last channel's
        // connection is let go, which can take a few seconds: give those more tries than a 404.
        var busy = busyHttp(http);
        if (cur.httpFails > (busy ? 5 : 2)) {
          var nx = nextEngine(kind);
          if (nx) { Log.info('player', 'Trying the ' + ENGINE_NAMES[nx] + ' after HTTP ' + http); useEngine(nx); return start(myToken); }
          return giveUp(myToken);
        }
      }
      // Before the first frame, a failure in the built-in demuxer (unsupported codec, or a fetch
      // the browser refused) goes straight to the next pipeline.  No retry loop first.  Not for a
      // movie that has played on this pipeline already: that is the connection again (issue #34).
      if ((earlyNet || type === 'media') && kind !== 'native' && !st.started && !(isFile() && cur.everPlayed)) {
        // A fetch the demuxer could not make is about the host (CORS etc.), so remember it for
        // the host.  A codec problem is about this one channel only.
        // Not when the fetch went through the helper: then it is the helper that didn't answer (it is started
        // again, Net.restart), and pinning the provider to the TV player would move every channel there for the
        // rest of the session.  This channel tries the next pipeline all the same.
        if (earlyNet && !Net.active) fallbackHosts[hostOf(url)] = 'native';
        else if (earlyNet) Net.ping(3000).then(function (ok) { if (!ok) Net.restart('a stream could not reach it'); });
        var alt = nextEngine(kind);
        if (alt) { Log.info('player', 'Trying the ' + ENGINE_NAMES[alt] + ' after a ' + type + ' error'); useEngine(alt); return start(myToken); }
        return giveUp(myToken);
      }
      // Provider hung up but we still hold a good cushion: keep watching it and reconnect only
      // when it runs low, instead of throwing away buffered video.
      if (ended && st.started && bufferedAhead() > 4) { st.pendingReconnect = true; Log.info('player', 'Provider closed the stream; playing the remaining ' + bufferedAhead().toFixed(1) + 's then reconnecting'); return; }
      reconnect(myToken, ended ? 'Stream ended, reconnecting' : busyHttp(http) ? 'Provider busy (still counting the last channel), trying again' : 'Connection dropped, reconnecting');
    };
    // Codec facts from the stream itself, before the first frame: the HLS master playlist or the
    // TS demuxer's media info.  Switch pipeline once if the stream belongs on the TV player.
    var media = function (m) {
      if (myToken !== token || gen !== cur.gen || !m) return;
      if (conv) return;                                  // the converter's output: AC-3, known
      cur.media = merge(cur.media, m);
      var r = Caps.route(cur.media, hdrPolicy());
      // A live channel whose sound this TV can't play: the converter, if it's on.
      if (r.unplayable && cur.live && !cur.timeshift && !cur.convTried && window.Convert && Convert.on()) {
        cur.convTried = true;
        Convert.planLive(cur.origUrl || cur.url, r.unplayable, cur.media.channels, cur.media.rate).then(function (pl) { livePlan(pl, myToken, r.unplayable); });
        return;
      }
      if (r.warn && r.unplayable && !cur.warned && lateConvert(r.unplayable, myToken)) cur.warned = true;
      if (r.warn && !cur.warned) { cur.warned = true; Log.warn('player', r.warn); notice(r.unplayable && window.Convert ? Convert.noSound(Caps.unplayable(r.unplayable, cur.media.channels, null, cur.media.rate) || r.unplayable) : r.warn); }
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
      else eng = nativeEngine(url, tracks, conv);
    } catch (e) {
      Log.warn('player', kind + ' engine could not start: ' + e.message);
      if (conv) return convFailed(myToken, e.message);
      if (kind === 'native') return giveUp(myToken);
      useEngine('native');
      return start(myToken);
    }
    if (conv) {
      video._tbOffset = conv.base;
      // The audio menu lists the movie's own tracks; another one is a new conversion from here.
      eng.audio = function () { return (conv.tracks || []).map(function (t, i) { return { id: i, label: trackLabel(t, i, conv.bad && conv.bad[i]), lang: t.lang || '', ch: t.channels || 0, on: i === conv.a }; }); };
      eng.setAudio = function (i) { var t = conv.tracks && conv.tracks[i]; if (!t || i === conv.a) return; switchConv(i, t); };
      if (cur.convNotice) { notice(cur.convNotice); cur.convNotice = ''; }
    }
    if (cur.noSound && !cur.warned) { cur.warned = true; Log.warn('player', 'No converter: ' + cur.noSound + ' sound will be silent'); notice(Convert.noSound(cur.noSound)); }
    if (kind === 'native' && cur.media && !conv) { var rn = Caps.route(cur.media, hdrPolicy()); if (rn.warn && rn.unplayable && !cur.warned && lateConvert(rn.unplayable, myToken)) cur.warned = true; if (rn.warn && !cur.warned) { cur.warned = true; notice(rn.unplayable && window.Convert ? Convert.noSound(Caps.unplayable(rn.unplayable, cur.media.channels, null, cur.media.rate) || rn.unplayable) : rn.warn); } }
    wd = setInterval(function () { tick(myToken); }, 400);
    // Until the first frame, check every 50ms: the video is often ready to play within 100-200ms
    // of a channel change, and waiting for the 400ms watchdog added up to a third of a second.
    fastWd = setInterval(function () {
      if (myToken !== token || !st || st.started) { clearInterval(fastWd); fastWd = 0; return; }
      tick(myToken);
    }, 50);
  }
  /* Preferred audio: the language chosen in Settings > Playback, and with "Prefer surround sound"
     a 5.1 or Dolby track in it.  When that language is missing, the fallback language (Settings >
     Playback, off by default), else the track already playing stays.  Audio description tracks only when nothing else matches.  A
     track picked by hand from the quick menu wins until the channel changes. */
  var SURROUND = /5\.1|7\.1|\b[68] ?ch\b|\bac-?3\b|e-?ac-?3|\bdd\+?|dolby|atmos|surround|dts/i;
  var DESCRIBED = /\b(ad|audio ?desc\w*|descriptive|description|visually impaired|vi)\b/i;
  function describeTrack(t) {
    var text = (t.label || '') + ' ' + (t.lang || '');
    return { lang: U.lang(t.lang) || U.lang(t.label), surround: t.ch > 2 || SURROUND.test(text), ad: /desc/i.test(t.kind || '') || DESCRIBED.test(text) };
  }
  function bestAudio(list, want, surround, fallback) {
    fallback = fallback || '';
    if (!want && !surround) return null;
    var best = null, bestScore = -1e9;
    list.forEach(function (t) {
      var d = describeTrack(t), sc = (want && d.lang === want ? 200 : want && fallback && d.lang === fallback ? 100 : 0) + (surround && d.surround ? 10 : 0) - (d.ad ? 50 : 0) + (t.on ? 1 : 0);
      if (sc > bestScore) { best = t; bestScore = sc; }
    });
    return best;
  }
  function preferAudio() {
    if (!eng || !eng.audio || !cur || cur.userAudio || cur.conv) return;
    var list = eng.audio(), s = Store.settings;
    if (list.length < 2) return;
    // The track Convert picked because this TV plays it (the default one it can't).
    if (cur.preferTrack != null) {
      var pt = list[cur.preferTrack];
      if (pt && !pt.on) { Log.info('player', 'Audio: track ' + (cur.preferTrack + 1) + ', which this TV can play'); eng.setAudio(cur.preferTrack); }
      return;
    }
    if (cur.badTracks) list = list.filter(function (t) { return !cur.badTracks[t.id]; });
    var b = bestAudio(list, s.audioLang || '', !!s.audioSurround, s.audioFallback || '');
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
  /** Can this TV use pipeline [k] for the current channel? */
  function engineOk(k) {
    var u = cur.origUrl || cur.url, isHlsUrl = /\.m3u8(\?|$)/i.test(u);
    if (k === 'native') return true;
    if (k === 'ts') return !isHlsUrl && !!(window.mpegts && mse());
    if (k === 'hls') return !!(window.Hls && Hls.isSupported() && (isHlsUrl || hlsVariant(u)));
    return false;
  }
  /** The provider this channel comes from, for what playmemo.js learns about it. */
  function memoHost() { return cur ? hostOf(cur.origUrl || cur.url) : ''; }
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
    // Counted for the warning that most of a playlist will not play, and for the "not playing lately"
    // mark on a channel that fails again and again (deadlist.js).  Once per try.
    if (cur.live && !cur.timeshift && !cur.deadCounted && window.DeadList) { cur.deadCounted = cur.deadFailed = true; try { DeadList.failed(cur.ch, cur.origUrl || cur.url, cur.lastHttp || 0); } catch (e) {} }
    // A movie that was playing here a moment ago is not a format the TV can't decode (issue #34).
    if (isFile() && cur.everPlayed) return state('error', CLOSED);
    if (cur.lastHttp) return state('error', 'The provider is not sending this ' + (isFile() ? 'video' : 'channel') + ' right now (error ' + cur.lastHttp + ').  Press OK to try again, or try ' + (isFile() ? 'again later.' : 'another channel.'));
    state('error', isFile() ? 'This video will not play on this TV.  It may use a format the TV cannot decode.' : 'This channel will not play on this TV.  It may use a format the TV cannot decode, or the provider may be having trouble with it.');
  }

  /* After the reconnect budget is spent: another pipeline first (each gets half a budget), then
     for a live channel that has played before, a slow retry every 15s for up to 20 minutes with
     a message on screen.  Providers do come back, and a TV left on a channel should recover by
     itself rather than sit on an error. */
  // Slow retries: every 6s for the first 3 minutes (most outages are short, and the picture should
  // be back within seconds of the provider), then every 15s.
  var CLOSED = 'The provider closed the connection to this video and did not let TiviBro back in.  Press OK to try again from where you were.';
  var SLOW_EVERY = 15000, SLOW_FAST = 6000, SLOW_FAST_FOR = 3 * 60000, SLOW_FOR = 20 * 60000;
  function lateEngine(failed, format) {
    if (isFile() && !/\.m3u8(\?|$)/i.test(cur.origUrl || cur.url)) return null;   // a movie file has one pipeline
    cur.late = cur.late || {};
    cur.late[failed] = 1;
    var isHlsUrl = /\.m3u8(\?|$)/i.test(cur.origUrl || cur.url);
    // After a channel has played, a pipeline failing is mostly the connection: its HLS version before the TV player.
    var order = isHlsUrl ? ['hls', 'native'] : !format && cur.live && !cur.timeshift && cur.everPlayed && hlsVariant(cur.origUrl || cur.url) ? ['ts', 'hls', 'native'] : ['ts', 'native', 'hls'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (cur.late[k] || (cur.tried && cur.tried[k]) || (cur.bad && cur.bad[k])) continue;
      if (k === 'ts' && !(window.mpegts && mse())) continue;
      if (k === 'hls' && !(window.Hls && Hls.isSupported() && (isHlsUrl || hlsVariant(cur.origUrl || cur.url)))) continue;
      return k;
    }
    return null;
  }

  /* A movie that fails again and again at the same spot (issue #51: every reconnect resumed at 2835 s and
     dropped 5 s later, only skipping ahead got past it) has a damaged part, or one the provider can't
     send.  Tries that fail before they play (the provider gone) don't count.  The third failure within 20 s of the same spot skips 10 s past it, and each one after that
     twice as far (up to 2 minutes), never into the last 30 s. */
  function skipBadSpot() {
    if (!isFile() || !cur.everPlayed || !st || !st.started) return;   // only tries that played, then failed
    if (cur.badAt != null && Math.abs(cur.pos - cur.badAt) < 20 + (cur.badSkip || 0)) cur.badN = (cur.badN || 0) + 1;
    else { cur.badAt = cur.pos; cur.badN = 1; cur.badSkip = 0; }
    if (cur.badN < 3) return;
    var skip = Math.min(120, 10 * Math.pow(2, cur.badN - 3)), dur = video && isFinite(video.duration) ? video.duration : 0;
    if (dur && cur.pos + skip > dur - 30) return;
    cur.badSkip = (cur.badSkip || 0) + skip;
    cur.startAt = cur.pos + skip;
    Log.warn('player', 'Failed ' + cur.badN + ' times near ' + Math.round(cur.badAt) + 's; skipping ' + skip + 's ahead');
    notice('Skipped ' + skip + ' seconds past a part of this video that won\'t play');
  }

  function reconnect(myToken, why) {
    if (myToken !== token || !cur) return;
    var now = Date.now();
    // Movies and catch-up continue from where they got to, not from the start.
    if (!cur.live && !cur.timeshift && isFile() && !cur.conv && st && st.started && st.from != null) {
      // Never behind where this try started (a reconnect went back 280 s, issue #57), and by the clock when
      // the TV player's own time lags far behind what has played.
      var clock = st.from + (st.playMs || 0) / 1000;
      if (clock > cur.pos + 20) { Log.warn('player', 'The TV player says ' + Math.round(cur.pos) + 's but it has played to about ' + Math.round(clock) + 's; continuing from there'); cur.pos = clock; }
      if (cur.floor && cur.pos < cur.floor) cur.pos = cur.floor;
    }
    if (!cur.live && !cur.timeshift && cur.pos > 5) { cur.startAt = cur.pos; skipBadSpot(); }
    if (!holding && cur.everPlayed) holdFrame();
    teardown();
    clearTimeout(cur.timer);              // several error events for one failure = one reconnect
    /* MPEG-TS or HLS, per channel, whichever holds up (issue #47).  A live channel that drops twice in three
       minutes on one, or trickles in too slowly to keep up (early()), switches to the other: HLS comes in
       short pieces and often rides out a shaky connection better, and some channels are the other way
       round.  At most 3 switches in 10 minutes, so a channel bad on both settles instead of bouncing.  A
       switch starts a fresh reconnect budget on the new format (before, a switch on the last reconnect of
       the budget was overridden by "Still failing", which went to the TV player and back to MPEG-TS).
       Remembered for this channel (preferHls, and playmemo.js across restarts). */
    // (Not when the provider answered with an error: that is the provider having trouble, not the stream format.)
    // The format just switched to fails before it ever played (no HLS version at this provider, or one
    // that never shows a picture): back to the one that played, and no more switching for this channel.
    if (cur.swapFrom && !cur.swapPlayed && st && !st.started && st.kind !== cur.swapFrom) {
      var http = /^The provider answered (\d+)/.exec(why);
      Log.info('player', (st.kind === 'native' ? 'The TV player doesn\'t play it' : 'Its ' + (st.kind === 'hls' ? 'HLS' : 'MPEG-TS') + ' version doesn\'t play') + ' here (' + (http ? 'HTTP ' + http[1] : why.replace(/, (retrying|reconnecting)$/, '').toLowerCase()) + '); back to ' + (cur.swapFrom === 'ts' ? 'MPEG-TS' : cur.swapFrom === 'hls' ? 'HLS' : 'the TV player'));
      if (st.kind === 'hls') delete preferHls[cur.origUrl || cur.url];
      cur.bad = cur.bad || {}; cur.bad[st.kind] = 1;
      useEngine(cur.swapFrom); cur.swapFrom = null; cur.noSwap = true; cur.tried = null; cur.late = null; cur.retries = 0;
    }
    /* (Nor a try that never showed a picture: the no-picture steps in tick() pick the next pipeline, and a
       format that had no picture on this channel is not switched back to (issue #66: HLS no picture counted as
       a drop and went back to MPEG-TS, which had just shown no picture either).) */
    else if (cur.live && !cur.timeshift && cur.everPlayed && !cur.noSwap && st && (st.kind === 'ts' || st.kind === 'hls') && !/^The provider answered/.test(why) && !(!st.started && /^No video yet/.test(why))) {
      var orig = cur.origUrl || cur.url, frozen = /keeps freezing/.test(why), trickle = frozen || /slowed down/.test(why), other = st.kind === 'ts' ? 'hls' : 'ts';
      cur.drops = (cur.drops || []).filter(function (x) { return now - x < 180000; }); cur.drops.push(now);
      cur.swaps = (cur.swaps || []).filter(function (x) { return now - x < 600000; });
      if ((trickle || cur.drops.length >= 2) && cur.swaps.length < 3 && engineOk(other) && !(cur.bad && cur.bad[other]) && !(cur.noPic && cur.noPic[other]) && (other === 'ts' || hlsVariant(orig) || /\.m3u8(\?|$)/i.test(orig))) {
        Log.info('player', 'This channel ' + (frozen ? 'keeps freezing' : trickle ? 'is trickling in' : 'dropped ' + cur.drops.length + ' times in 3 minutes') + ' on ' + (st.kind === 'ts' ? 'MPEG-TS' : 'HLS') + '; switching to its ' + (other === 'ts' ? 'MPEG-TS' : 'HLS') + ' version');
        useEngine(other); cur.swapFrom = st.kind; cur.swapPlayed = false;
        if (other === 'hls') preferHls[orig] = 1; else delete preferHls[orig];
        cur.drops = []; cur.swaps.push(now);
        cur.tried = null; cur.late = null; cur.retries = 0;
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
        if (cur.live && !cur.timeshift && cur.everPlayed && st) { cur.swapFrom = st.kind; cur.swapPlayed = false; }
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
        state('error', isFile() ? (cur.everPlayed ? CLOSED : 'This video stopped loading.  Press OK to try again.') : 'This channel stopped responding.  Press OK to try again, or try another channel.');
        cur.failed = true;
        return;
      }
    }
    state('buffering', why);
    // Exponential backoff with jitter, so a TV and its neighbours don't all hit the provider at once.
    delay = Math.min(5000, 300 * Math.pow(2, Math.max(0, cur.retries - 1))) * (0.8 + Math.random() * 0.4);
    // Memory-safe: give the old player's video memory a moment to go before the new one fills up.
    if (memSafe()) delay = Math.max(delay, 1000);
    cur.timer = setTimeout(function () { start(myToken); }, delay);
  }

  /* The cushion a refill aims for: the profile's refill target plus what this channel has earned
     by running dry before (kept across reconnects of the same channel). */
  function capFor(p) { return Math.max(p.refill, Math.min(p.ahead * 0.6, 20)); }
  function refillGoal() { var p = cur.p; return Math.min(capFor(p), p.refill + (cur.boost || 0)); }
  /* Is the stream trickling in too slowly to ever keep up?  The end of what is buffered is sampled every
     tick; over the last 30 seconds it should move about as fast as the clock.  Only a steady trickle
     counts: data that keeps coming, at under half of real time, with the cushion nearly gone.  A stall
     (nothing for 6 seconds or more) or a slow patch that catches up again is left to the refill, which
     keeps the burst that usually follows (the chaos soak showed reconnecting then loses it). */
  var freezes = {};             // channel -> when its picture froze with data in hand, the last 10 minutes
  var EARLY_RATE = 0.5, EARLY_WIN = 30000, EARLY_GAP = 6000, EARLY_EVERY = 120000;
  function early(now, ahead, p) {
    if (!st.started || st.refilling || video.seeking || video.paused || st.userPaused) { st.arr = null; return false; }
    var arr = st.arr || (st.arr = []), end = bufferEnd();
    arr.push([now, end]);
    while (arr.length > 2 && now - arr[1][0] >= EARLY_WIN) arr.shift();
    if (now - arr[0][0] < EARLY_WIN || now - (cur.earlyAt || 0) < EARLY_EVERY || now - st.at < EARLY_WIN) return false;
    // An HLS stream with several qualities lowers its own quality instead.
    if (st.kind === 'hls' && eng && eng.levels && eng.levels().length > 1 && eng.auto && eng.auto()) return false;
    var rate = (end - arr[0][1]) / ((now - arr[0][0]) / 1000);
    if (rate >= EARLY_RATE || rate < 0.05 || ahead > Math.max(2.5, p.refill) || ahead < 0.8) return false;
    // A trickle, not a stall: something arrived at least every few seconds the whole time.
    for (var i = 1, since = arr[0][0]; i < arr.length; i++) {
      if (arr[i][1] > arr[i - 1][1] + 0.01) since = arr[i][0];
      else if (arr[i][0] - since > EARLY_GAP) return false;
    }
    cur.earlyAt = now; st.arr = null;
    Log.warn('player', 'The stream is arriving at ' + Math.round(rate * 100) + '% of real time with ' + ahead.toFixed(1) + 's left; reconnecting before it runs out');
    if (window.PlayMemo) PlayMemo.ranDry(memoHost());
    grow(p);
    return true;
  }
  function grow(p) {
    if (cur.preview) return;
    var before = cur.boost || 0;
    cur.boost = Math.min(capFor(p) - p.refill, before + Math.max(1.5, p.refill * 0.75));
    cur.boostAt = Date.now();
    if (cur.boost > before) Log.info('player', 'This channel keeps running dry; cushion raised to ' + refillGoal().toFixed(1) + 's');
    if (cur.live && !cur.timeshift && window.PlayMemo) PlayMemo.boost(cur.ch, cur.boost);
  }

  function tick(myToken) {
    if (myToken !== token || !st || !video) return;
    var now = Date.now(), ahead = bufferedAhead(), t = video.currentTime;
    var p = cur.p;
    // A converted movie: does the TV's player show the movie's own times, or count from the seek?
    if (cur.conv && st.started && !cur.conv.checked && t > 0) {
      cur.conv.checked = true; cur.conv.played = true;
      if (cur.conv.t > 5 && t > cur.conv.t / 2) { cur.conv.base = 0; video._tbOffset = 0; Log.info('player', 'The TV player shows the movie\'s own times'); }
    }
    if (st.started && video.readyState > 0 && !video.seeking) cur.pos = t + base();
    /* A movie's place by the clock too: how long it has been playing since this try started there.  The TV
       player can report a time that lags far behind on a file it can't seek in precisely (issue #57: a
       resume at 3110 s reported 2828 s, and every reconnect after went back there), or stop updating it. */
    if (isFile() && !cur.conv && st.started && st.from != null) {
      if (st.lastTick && !video.paused && !st.userPaused && video.readyState >= 3 && now - st.lastTick < 2000) st.playMs = (st.playMs || 0) + (now - st.lastTick);
      st.lastTick = now;
    }
    applyDisplay();               // the picture's own size arrives with the first frame (Aspect)
    var goal = refillGoal();
    var endNow = bufferEnd();
    if (endNow > (st.growEnd || 0) + 0.05) { st.growEnd = endNow; st.growAt = now; } else if (endNow < (st.growEnd || 0) - 1) { st.growEnd = endNow; st.growAt = now; }
    // The most this stream has held: a live channel only banks what the provider sends ahead of real time
    // (often well under the profile's read-ahead), so buffer info shows what this one really reaches.
    if (st.started && ahead > (st.most || 0)) st.most = ahead;
    emit('stats', lastStats = { ahead: ahead, target: st.started ? goal : p.prebuffer, cushion: cur.boost || 0, engine: eng ? eng.name : '', info: eng ? eng.info() : '',
      res: video.videoHeight ? video.videoHeight + 'p' : '', state: st.state, most: st.most || 0, cap: p.ahead,
      profile: p.label, startMs: cur.startMs || 0, dataMs: cur.dataMs || 0, picMs: cur.picMs || 0 });

    // 1. Prebuffer before the first frame.
    if (!st.started) {
      // Where a start spends its time: the first video data, the first picture, then the buffer.
      if (!st.tData && video.buffered.length && bufferEnd() > 0) st.tData = now;
      if (!st.tPic && video.readyState >= 2) st.tPic = now;
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
        if (cur.conv) Log.info('player', 'Converted sound playing from ' + Math.round(cur.conv.t) + 's');
        if (cur.slow) { Log.info('player', 'Channel is back after ' + Math.round((now - cur.slowSince) / 1000) + 's'); notice('Back on air'); }
        // Playing: clears the "not playing lately" mark.  Also when it plays again after a failure was counted in
        // this same session (OK on "try again", or it came back by itself), not only on the first start (#36).
        if (cur.live && (!cur.everPlayed || cur.deadFailed) && window.DeadList) { DeadList.played(cur.ch, cur.origUrl || cur.url); cur.deadFailed = false; }
        if (cur.swapFrom) cur.swapPlayed = true;
        cur.slow = ''; cur.everPlayed = true; cur.failed = false; cur.httpFails = 0; cur.lastHttp = 0; cur.starved = false; cur.lastFailHttp = false;
        cur.startMs = now - st.at; cur.dataMs = st.tData ? st.tData - st.at : 0; cur.picMs = st.tPic ? st.tPic - st.at : 0;
        if (window.ProvStatus) ProvStatus.note(cur.origUrl || cur.url, true);
        Log.info('player', 'Playing after ' + (now - st.at) + 'ms with ' + ahead.toFixed(1) + 's buffered' + (ahead < p.prebuffer ? ' (prebuffer timed out)' : '') + (video.videoHeight ? ', ' + video.videoWidth + 'x' + video.videoHeight : '') +
          (cur.dataMs ? ' (first data ' + cur.dataMs + 'ms, first picture ' + (cur.picMs || cur.dataMs) + 'ms)' : ''));
        if (cur.live && !cur.timeshift && window.PlayMemo) { PlayMemo.worked(cur.ch, st.kind, cur.usual); PlayMemo.started(memoHost()); }
        if (bf.length && video.currentTime < first && !cur.startAt) { try { video.currentTime = first + 0.05; } catch (e) {} }
        st.growAt = now;
        if (!cur.live) { st.from = cur.startAt || cur.pos || 0; st.playMs = 0; }
        if (cur.startAt && !cur.live) { try { video.currentTime = cur.startAt; } catch (e) {} cur.pos = cur.startAt; cur.floor = Math.max(cur.floor || 0, cur.startAt); cur.startAt = 0; }
        if (st.userPaused) return;
        var pr = video.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else if (now - st.at > (cur.swapFrom && !cur.swapPlayed ? 8000 : 15000 + need * 1000) ||
          // The demuxer knows what the stream is (its codecs came) but after 8 s nothing it made could be
          // buffered: a format this pipeline can't play here, not a slow connection (issue #56: ESPN 3 ARG,
          // MP3 sound, 17 s twice on MPEG-TS, then the TV player played it in 1.3 s).  The same for HLS once its
          // first piece is read (issue #65: 17 s twice on HLS for each of several channels, then the TV player in 1.5 s).
          ((st.kind === 'ts' || st.kind === 'hls') && st.gotInfo && video.readyState >= 1 && ahead === 0 && !video.buffered.length && now - st.at > 8000)) {
        var fmtFail = (st.kind === 'ts' || st.kind === 'hls') && st.gotInfo && !video.buffered.length;
        if (fmtFail) { cur.noPic = cur.noPic || {}; cur.noPic[st.kind] = Math.max(1, cur.noPic[st.kind] || 0); }
        Log.warn('player', 'No playable video after ' + (now - st.at) + 'ms (readyState ' + video.readyState + ', buffered ' + ahead.toFixed(1) + 's)');
        /* No picture twice in a row on one pipeline is the stream's format, not the connection (issue #53: a
           channel whose sound only the TV's own player could play took nine tries, two and a half minutes,
           before TiviBro tried another pipeline).  The next one is tried straight away; whichever plays is
           remembered for the channel (playmemo.js). */
        cur.noPic = cur.noPic || {};
        cur.noPic[st.kind] = (cur.noPic[st.kind] || 0) + 1;
        if (cur.noPic[st.kind] >= 2 && !cur.swapFrom) {
          // A format the built-in pipelines can't show goes to the TV player first, also for a channel that is
          // back from its other versions (issue #66: HLS, MPEG-TS and HLS again, 53 s, before the TV player).
          var np = lateEngine(st.kind, fmtFail);
          if (np) { Log.info('player', 'No picture twice on the ' + ENGINE_NAMES[st.kind] + '; trying the ' + ENGINE_NAMES[np]); useEngine(np); cur.retries = Math.max(0, cur.retries - 2); }
        }
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
        st.arr = null;
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
      var d = cur.conv ? cur.conv.dur : video.duration, te = t + base();
      if (isFinite(d) && d > 120 && te < d - 30) { Log.warn('player', 'Video ended at ' + Math.round(te) + 's of ' + Math.round(d) + 's; treating it as a dropped connection'); cur.pos = te; reconnect(myToken, 'Connection dropped, reconnecting'); return; }
      clearInterval(wd); wd = 0; state('ended'); return;
    }
    // 5. Arriving slower than it plays: reconnect while there is still a cushion (the last picture
    //    stays on screen), rather than playing it down to nothing and then waiting for data that
    //    isn't coming.  Live channels only, a while after the start, at most once every 2 minutes.
    if (cur.live && !cur.timeshift && early(now, ahead, p)) {
      cur.starved = true;
      return reconnect(myToken, 'The stream slowed down, reconnecting before it runs out');
    }
    if (t !== st.lastT && !video.paused) {
      if (cur.live && !cur.timeshift && window.PlayMemo && st.watchAt && now - st.watchAt < 2000) PlayMemo.watched(memoHost(), now - st.watchAt);
      st.watchAt = now;
      st.lastT = t; st.lastMove = now;
      if (st.state !== 'playing') state('playing');
      if (!st.healthySince) st.healthySince = now;
      // 30s of clean playback earns the retry budget back; 3 clean minutes halve the extra cushion.
      if (now - st.healthySince > 30000 && (cur.retries || cur.slowSince)) { cur.retries = 0; cur.triedNative = false; cur.slowSince = 0; cur.late = null; }
      if (cur.boost && now - st.healthySince > 180000 && now - (cur.boostAt || 0) > 180000) { cur.boost = Math.round(cur.boost * 5) / 10; cur.boostAt = now; if (cur.boost < 0.5) cur.boost = 0; Log.info('player', 'Clean for 3 minutes; extra cushion now ' + cur.boost + 's'); if (cur.live && !cur.timeshift && window.PlayMemo) PlayMemo.boost(cur.ch, cur.boost); }
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
      if (gap > 0) { st.arr = null; Log.debug('player', 'Jumped a ' + (gap - t).toFixed(2) + 's gap in the buffer'); video.currentTime = gap + 0.05; st.lastMove = now; return; }
    }
    // Ran dry: start a proper refill instead of stutter-playing.
    if (stuck > 600 && ahead < 0.3) {
      st.refilling = true; st.refillSince = now; st.refills = (st.refills || 0) + 1; st.arr = null;
      if (cur.live && !cur.timeshift && window.PlayMemo) PlayMemo.ranDry(memoHost());
      grow(p);
      Log.info('player', 'Buffer ran dry (' + st.refills + ' times this stream); refilling to ' + refillGoal().toFixed(1) + 's');
      video.pause();
      state('buffering', 'Buffering');
      return;
    }
    /* 4. Clock stopped with data in hand: decoder problem.  Nudge, recover, then reconnect.  With a second or
       more buffered it is the decoder, not the network, so 3 s is enough to say so (the stall setting, up to
       12 s, is for a buffer that is running low). */
    var frozeAfter = (ahead > 1 ? Math.min(p.stall, 3) : p.stall) * 1000;
    if (stuck > frozeAfter) {
      if (!st.nudged) {
        var froze = 'Picture froze for ' + (stuck / 1000).toFixed(1) + 's with ' + ahead.toFixed(1) + 's buffered';
        /* The picture freezing again and again with plenty buffered (a live channel whose MPEG-TS has
           timestamp jumps, issue: Nick Jr. on a C2 froze on every profile) is the stream, not the buffer:
           the second time in 10 minutes, even after switching away and back, its other format is tried
           (reconnect(), as for a channel that keeps dropping). */
        var fk = (cur.ch && cur.ch.k) || cur.origUrl || cur.url, fl = freezes[fk] = (freezes[fk] || []).filter(function (x) { return now - x < 600000; });
        fl.push(now);
        if (fl.length >= 2 && cur.live && !cur.timeshift && !cur.noSwap && (st.kind === 'ts' || st.kind === 'hls')) {
          Log.warn('player', froze + ', the second time in 10 minutes');
          freezes[fk] = []; return reconnect(myToken, 'The picture keeps freezing on this channel, reconnecting');
        }
        Log.warn('player', froze + '; nudging the decoder');
        st.nudged = 1; video.currentTime = t + 0.1; if (eng) eng.recover(); st.lastMove = now; return;
      }
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
      /* A movie or episode that already played here and fails to open again (after a pause, the provider
         closed the connection; the link it handed out may have expired, or it still counts the old
         connection): that is the connection, not the format.  Reconnect at the same spot, never fall
         through to "a format the TV cannot decode" (issue #34). */
      if (cur.conv && !st.started && !cur.conv.played) return convFailed(my, 'TV player error ' + video.error.code);
      if (isFile() && cur.everPlayed) return reconnect(my, 'The provider closed the connection, reconnecting');
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
    var fmt = Store.settings.format, url0 = opts.url || Source.streamUrl(ch, fmt);
    cur = { ch: ch, url: url0, p: cfg(opts.preview, url0), preview: !!opts.preview, retries: 0,
      forceNative: false, triedNative: false, live: opts.live !== false, startAt: opts.startAt || 0, meta: opts.meta || null,
      timeshift: !!opts.timeshift, urlFn: opts.urlFn || null, pos: opts.startAt || 0,
      media: opts.media || (opts.meta && opts.meta.media) || null, opts: opts };
    // keepTrying: a channel known to work here (back from its backups during an outage) retries
    // like one that has played, instead of giving up after the first round.
    if (opts.keepTrying) cur.everPlayed = true;
    applyDisplay();
    releaseFrame();                         // a new channel never shows the last one's picture
    if (video) video.playbackRate = 1;
    cur.usual = pickEngine(cur.url);
    // Stream format chosen for this channel (Hold OK > Stream format): HLS or MPEG-TS whatever the
    // playlist's setting, before what playback learnt.  The other pipelines stay as fallbacks.
    var want = cur.live && !cur.timeshift ? streamFormat(ch) : '';
    if (want === 'ts' && /\/live\/[^?]+\.m3u8(\?|$)/i.test(cur.url)) { cur.url = cur.url.replace(/\.m3u8(\?|$)/i, '.ts$1'); cur.usual = pickEngine(cur.url); }
    if (want) Log.info('player', 'Stream format for this channel: ' + (want === 'hls' ? 'HLS' : 'MPEG-TS') + ' (chosen for it)');
    if (want === 'hls' && !/\.m3u8(\?|$)/i.test(cur.url) && window.Hls && Hls.isSupported() && hlsVariant(cur.url)) useEngine('hls');
    if (!want && cur.live && !cur.timeshift && preferHls[cur.url] && window.Hls && Hls.isSupported() && hlsVariant(cur.url)) { Log.info('player', 'Using the HLS version of this channel, which played better earlier'); useEngine('hls'); }
    // What this channel needed last time (playmemo.js): its pipeline (unless a format was chosen for it),
    // and the cushion it earned.
    else if (cur.live && !cur.timeshift && window.PlayMemo && Store.settings.engine !== 'native') {
      var memo = PlayMemo.get(ch);
      if (!want && memo.engine && memo.engine !== cur.usual && engineOk(memo.engine)) { Log.info('player', 'Starting with the ' + (memo.engine === 'hls' ? 'HLS version' : ENGINE_NAMES[memo.engine]) + ', which played this channel last time'); useEngine(memo.engine); }
      if (memo.boost && !cur.preview) { cur.boost = memo.boost; cur.boostAt = Date.now(); }
    }
    // Movies, episodes and My media files: is the sound one this TV plays?  (convert.js)
    if (window.Convert && !cur.live && !cur.timeshift && !cur.preview && Convert.on()) {
      var my = token, item = cur.meta && cur.meta.item || {};
      teardown(); st = null;
      state('loading');
      Convert.plan({ url: cur.url, media: cur.media, title: (cur.meta && cur.meta.title) || '', container: item.ext || item.container_extension || '' })
        .then(function (r) { applyPlan(r, my); }, function () { if (my === token) start(my); });
      return;
    }
    start(token);
  }

  /* ---------- sound the TV can't play (convert.js) ---------- */
  function base() { return cur && cur.conv ? cur.conv.base || 0 : 0; }
  function trackLabel(t, i, bad) {
    var ch = t.channels >= 8 ? ' 7.1' : t.channels >= 6 ? ' 5.1' : t.channels === 2 ? ' stereo' : '';
    var code = t.lang ? U.lang(t.lang) : '', name = code ? (U.LANGS.filter(function (l) { return l[0] === code; })[0] || [])[1] : '';
    return (t.title || name || (t.lang ? t.lang.toUpperCase() : 'Track ' + (i + 1))) + '  ' + (Convert.NAMES[t.codec] || String(t.codec || '').toUpperCase()) + ch + (bad ? ' (converted)' : '');
  }
  function useConv(conv, why) {
    cur.conv = conv; cur.convNotice = why || ''; cur.audioPicked = true;
    cur.forceKind = null; cur.forceNative = false; cur.tried = null;
    if (!conv.t) conv.t = 0;
    Log.info('player', 'Sound: ' + (conv.codec || '?') + ' track ' + (conv.a + 1) + ' through the audio converter (' + conv.fmt + ')');
  }
  /* A movie whose sound turns out, once it plays, to be one this TV can't play (the file's own tracks,
     not known before it started): offer the converter there, or use it, and carry on from the same
     point.  Once per movie; true when it took over the warning. */
  function lateConvert(codec, my) {
    if (!cur || cur.live || cur.timeshift || cur.preview || cur.conv || cur.lateConv || cur.noSound || !window.Convert || !Convert.on()) return false;
    cur.lateConv = true;
    var what = Caps.unplayable(codec, cur.media && cur.media.channels, null, cur.media && cur.media.rate) || String(codec).toUpperCase(), item = cur.meta && cur.meta.item || {};
    function silent() { if (my === token && cur) notice(Convert.noSound(what)); }
    function again() {
      if (my !== token || !cur) return;
      var at = Math.max(0, position());
      Convert.plan({ url: cur.url, media: cur.media, title: (cur.meta && cur.meta.title) || '', container: item.ext || item.container_extension || '' }).then(function (r) {
        if (my !== token || !cur) return;
        if (!r || r.offer) return silent();
        Log.info('player', 'Sound: ' + what + ' found while playing; restarting at ' + Math.round(at) + 's with the converter');
        teardown(); st = null; state('loading');
        cur.startAt = at; cur.retries = 0;
        applyPlan(r, my);
      }, silent);
    }
    Convert.status(true).then(function (s) {
      if (my !== token || !cur) return;
      if (s.state === 'ready') return again();
      Convert.offer(what, false, function (got) { if (got) again(); else { if (cur) cur.noSound = what; silent(); } });
    });
    return true;
  }
  /* The movie file's own audio tracks, read by the subtitle reader (mkvsubs.js) as it starts: when none
     of them is one this TV plays, the converter is offered (or used) from here. */
  function heardAudio(codecs) {
    if (!cur || !codecs || !codecs.length || cur.live || cur.conv) return;
    var c = Caps.probe(), bad = codecs.filter(function (a) { return Caps.unplayable(a, 0, c); });
    if (bad.length < codecs.length) return;
    cur.media = merge(cur.media, { audio: codecs });
    if (!cur.warned && lateConvert(bad[0], token)) cur.warned = true;
  }
  function applyPlan(r, my) {
    if (my !== token || !cur) return;
    if (r && r.offer) {
      return Convert.offer(r.offer, r.guessed, function (got) {
        if (my !== token || !cur) return;
        if (!got) { cur.noSound = r.offer; return start(my); }
        Convert.plan({ url: cur.url, media: cur.media, title: (cur.meta && cur.meta.title) || '' }).then(function (r2) { applyPlan(r2 && r2.offer ? null : r2, my); });
      });
    }
    if (r && r.conv) useConv(r.conv, r.notice);
    else if (r && r.track != null) {
      cur.badTracks = r.bad; cur.probe = { tracks: r.tracks, dur: r.dur || 0, video: r.video || '' };
      var t = r.tracks[r.track] || {};
      // The TV's player switches tracks itself where it can; without that, the helper copies just
      // that track into a stream (no conversion, nearly no work).
      if (video && video.audioTracks) cur.preferTrack = r.track;
      else useConv({ src: cur.url, a: r.track, fmt: Convert.fmtFor(r.video), codec: t.codec, channels: t.channels || 0, tracks: r.tracks, bad: r.bad, dur: r.dur || 0 }, '');
    }
    start(my);
  }
  // A track picked from the audio menu: converted sound restarts with it, from where playback is.
  function switchConv(i, t) {
    var conv = cur.conv;
    conv.a = i; conv.codec = t.codec; conv.channels = t.channels || 0;
    cur.startAt = Math.max(0.1, position()); cur.retries = 0;
    Log.info('player', 'Audio track ' + (i + 1) + ' (' + t.codec + '): restarting the stream at ' + Math.round(cur.startAt) + 's');
    start(token);
  }
  // The converter didn't get going: play the movie as it is, and say why there's no sound.
  function convFailed(my, why) {
    if (my !== token || !cur || !cur.conv) return;
    var conv = cur.conv;
    Log.warn('player', 'Converted sound did not start (' + why + '); playing the movie as it is');
    if (!conv.played && conv.t && !cur.startAt) cur.startAt = conv.t;
    cur.conv = null; cur.convNotice = ''; cur.noSound = Caps.unplayable(conv.codec, conv.channels, null, conv.rate) || '';
    if (cur.live) cur.convTried = true;
    start(my);
  }
  function livePlan(pl, my, codec) {
    if (my !== token || !cur) return;
    if (pl && pl.conv) { useConv(pl.conv, pl.notice); return start(my); }
    if (pl && pl.offer) {
      return Convert.offer(pl.offer, false, function (got) {
        if (my !== token || !cur) return;
        if (got) return Convert.planLive(cur.origUrl || cur.url, codec, cur.media && cur.media.channels, cur.media && cur.media.rate).then(function (p2) { livePlan(p2 && p2.conv ? p2 : null, my, codec); });
        if (!cur.warned) { cur.warned = true; notice(Convert.noSound(Caps.unplayable(codec, cur.media && cur.media.channels, null, cur.media && cur.media.rate) || codec)); }
      });
    }
    if (!cur.warned) { cur.warned = true; notice(Convert.noSound(Caps.unplayable(codec, cur.media && cur.media.channels, null, cur.media && cur.media.rate) || codec)); }
  }
  /* Aspect (discussion #31): this channel's or movie's own choice if it has one (Store.edits.display,
     by channel key, or "vod:<id>" for a movie or episode), otherwise the global setting.
     Original, Fill and Zoom are object-fit.  The others draw the picture stretched to the screen
     (object-fit: fill) and scale it with a CSS transform to the shape wanted; the stage clips what
     falls outside.  Works on Chromium 53. */
  var ASPECTS = [['contain', 'Original'], ['fill', 'Fill'], ['cover', 'Zoom'], ['4:3', '4:3'], ['16:9', '16:9'], ['21:9', '21:9'], ['stretch43', '4:3 to 16:9']];
  var ASPECT_NAMES = {};
  ASPECTS.forEach(function (a) { ASPECT_NAMES[a[0]] = a[1]; });
  /* A film shape of your own (discussion #31): 'film:2.39' grows a letterboxed film of that shape until it
     fills the screen's height, sides cropped, as 21:9 does for 2.35.  From 1.5 to 3. */
  function filmShape(mode) { var m = /^film:(\d(?:\.\d{1,3})?)$/.exec(String(mode || '')), r = m ? +m[1] : 0; return r >= 1.5 && r <= 3 ? r : 0; }
  function validAspect(mode) { return !!(ASPECT_NAMES[mode] || filmShape(mode)); }
  function aspectName(mode) { var r = filmShape(mode); return r ? 'Film ' + r.toFixed(2) + ':1' : ASPECT_NAMES[mode] || ''; }
  /* Stream format per channel: '' (the playlist's setting and what playback learns), 'hls' or 'ts'.
     Kept with the playlist's edits (backups too), by channel. */
  // "Busy" answers: connection limit, rate limit, overloaded.
  function busyHttp(code) { return [403, 429, 456, 458, 502, 503, 504, 509, 551].indexOf(+code) >= 0; }
  function streamFormat(ch) { var m = ch && Store.edits.streamFmt; return m && (m[ch.k] === 'hls' || m[ch.k] === 'ts') ? m[ch.k] : ''; }
  function setStreamFormat(ch, v) {
    if (!ch) return;
    var m = Store.edits.streamFmt || (Store.edits.streamFmt = {});
    if (v === 'hls' || v === 'ts') m[ch.k] = v; else delete m[ch.k];
    Store.saveEdits();
  }
  /** Whether a channel comes both ways: an Xtream Codes live channel (/live/…/123.ts or .m3u8). */
  function canSwitchFormat(ch) {
    if (!ch) return false;
    var u = ch.url || (Source.streamUrl ? Source.streamUrl(ch, Store.settings.format) : '');
    return /\/live\/[^?]+\.(ts|m3u8)(\?|$)/i.test(u || '');
  }
  function displayFor(ch) { var d = ch && Store.edits.display && Store.edits.display[ch.k]; d = d || Store.settings.display; return validAspect(d) ? d : 'contain'; }
  /* How to draw a vw x vh picture on a W x H screen for an aspect mode: { fit, sx, sy }.  The element
     always fills the screen; sx and sy scale it from its centre. */
  function aspectFit(mode, vw, vh, W, H) {
    var out = { fit: mode === 'fill' || mode === 'cover' ? mode : 'contain', sx: 1, sy: 1 };
    if (!W || !H) { W = 1920; H = 1080; }
    var A = vw > 0 && vh > 0 ? vw / vh : 16 / 9, S = W / H, fw, fh;
    function box(a) { return a > S ? { w: W, h: W / a } : { w: H * a, h: H }; }
    if (mode === '4:3' || mode === '16:9') {
      // Show the whole picture as this shape: a squashed 16:9 film sent as 4:3, or the other way.
      var b = box(mode === '4:3' ? 4 / 3 : 16 / 9); fw = b.w; fh = b.h;
    } else if (mode === '21:9' || filmShape(mode)) {
      // A 2.35:1 film (or the film shape chosen) letterboxed inside the picture: grow it until the film
      // fills the screen's height and crop the sides.  A picture already that wide fills the screen the same way.
      var band = Math.max(filmShape(mode) || 2.35, A);
      fw = band >= S ? band * H : W; fh = fw / A;
    } else if (mode === 'stretch43') {
      // A 4:3 picture (or a 4:3 picture with black bars at the sides) stretched out to 16:9.
      var r = Math.min(4 / 3, A), wide = box(16 / 9);
      fw = wide.w * A / r; fh = wide.h;
    } else return out;
    out.fit = 'fill';
    out.sx = Math.round(fw / W * 10000) / 10000; out.sy = Math.round(fh / H * 10000) / 10000;
    return out;
  }
  var fitKey = '';
  function applyDisplay() {
    if (!video) return;
    var mode = displayFor(cur && cur.ch), W = video.clientWidth || 0, H = video.clientHeight || 0;
    var key = mode + '|' + video.videoWidth + 'x' + video.videoHeight + '|' + W + 'x' + H;
    if (key === fitKey && video.style.objectFit) return;
    fitKey = key;
    var f = aspectFit(mode, video.videoWidth, video.videoHeight, W, H);
    video.style.objectFit = f.fit;
    video.style.transform = f.sx === 1 && f.sy === 1 ? '' : 'scale(' + f.sx + ',' + f.sy + ')';
  }
  function setAspect(mode, ch) {
    if (!validAspect(mode)) return;
    if (ch) { Store.edits.display = Store.edits.display || {}; Store.edits.display[ch.k] = mode; Store.saveEdits(); }
    else { Store.settings.display = mode; Store.saveSettings(); }
    fitKey = ''; applyDisplay();
  }
  function playing() { return !!(st && st.started && video && video.readyState > 0); }
  function seekTo(t) {
    if (!video || !cur || cur.live) return;
    var d = cur.conv ? cur.conv.dur : video.duration;
    if (isFinite(d) && d > 0) t = U.clamp(t, 0, Math.max(0, d - 2));
    t = Math.max(0, t);
    cur.pos = t; cur.floor = t;                          // you chose the place: reconnects start from here
    if (st) { st.from = t; st.playMs = 0; }
    if (!playing()) { cur.startAt = t; return; }        // reconnecting: the new connection starts there
    // Converted sound is a stream: a new conversion from there.
    if (cur.conv) { cur.startAt = Math.max(0.1, t); cur.retries = 0; Log.info('player', 'Seek to ' + Math.round(t) + 's: restarting the converted stream there'); start(token); return; }
    if (st) st.lastMove = Date.now();
    video.currentTime = t;
    if (eng && eng.reanchor) eng.reanchor();
  }
  function seek(delta) { if (cur && !cur.live) seekTo(position() + delta); }
  // Same channel, new mode (preview -> fullscreen): keep the stream, just widen the policy.
  function upgrade(preview) {
    if (!cur) return;
    cur.preview = preview;
    cur.p = cfg(preview, cur.origUrl || cur.url);
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
      /* A movie on the TV player paused for minutes: providers close quiet connections, and the link
         they handed out can expire meanwhile.  Open it again at the same spot rather than find out
         on play (issue #34). */
      if (isFile() && st.kind === 'native' && st.started && st.pausedAt && Date.now() - st.pausedAt > LONG_PAUSE) {
        cur.startAt = Math.max(0.1, position()); cur.pos = cur.startAt; cur.retries = 0;
        Log.info('player', 'Paused for ' + Math.round((Date.now() - st.pausedAt) / 1000) + 's; opening the video again at ' + Math.round(cur.startAt) + 's');
        start(token);
        return;
      }
      var r = video.play(); if (r && r.catch) r.catch(function () {});
    } else {
      st.userPaused = true; st.pausedAt = Date.now();
      video.pause();
    }
  }
  var LONG_PAUSE = 3 * 60000;
  function togglePause() { if (video && st) setPaused(!st.userPaused); }
  // A fresh go from the top: every pipeline gets another chance.
  function retryNow() {
    if (!cur) return;
    if (cur.origUrl) cur.url = cur.origUrl;
    cur.retries = 0; cur.triedNative = false; cur.failed = false; cur.slowSince = 0; cur.slow = ''; cur.deadCounted = false;   // a try of its own
    cur.tried = null; cur.late = null; cur.forceKind = null; cur.forceNative = false; cur.routed = false; cur.httpFails = 0; cur.lastHttp = 0;
    if (isFile() && !cur.startAt && cur.pos > 5) cur.startAt = cur.pos;      // a movie tries again where it was
    start(token);
  }

  // The helper started again after it stopped answering (net.js): what was playing through it starts again.
  if (typeof Net !== 'undefined' && Net.onRestart) Net.onRestart(function () { if (cur && Net.active) { Log.info('player', 'The network helper is back: starting the stream again'); retryNow(); } });

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
    if (playing()) return video.seeking && cur && cur.pos != null ? cur.pos : video.currentTime + base();
    return cur ? cur.pos || 0 : 0;
  }

  return {
    _test: { reconnect: function (why) { reconnect(token, why || 'test'); }, get holding() { return holding; }, get kind() { return st && st.kind; } },
    PRESETS: PRESETS, memorySafe: memorySafe, get memSafe() { return memSafe() ? (safeWhy || (navigator.deviceMemory ? 'this TV has 1 GB of memory or less' : 'an HD or Full HD TV, with about 1 GB of memory')) : ''; }, bind: bind, play: play, heardAudio: heardAudio, stop: stop, upgrade: upgrade, togglePause: togglePause, setPaused: setPaused, retryNow: retryNow, on: on,
    seek: seek, seekTo: seekTo, applyDisplay: applyDisplay, suspend: suspend, resume: resume,
    audioTracks: function () { return eng && eng.audio ? eng.audio() : []; },
    qualities: function () { return eng && eng.levels ? eng.levels() : []; },
    qualityAuto: function () { return !!(eng && eng.auto && eng.auto()); },
    setQuality: function (i) { if (eng && eng.setLevel) eng.setLevel(i); },
    setRate: function (r) { if (video) video.playbackRate = r; },
    get rate() { return video ? video.playbackRate : 1; },
    streamFormat: streamFormat, setStreamFormat: setStreamFormat, canSwitchFormat: canSwitchFormat,
    displayFor: displayFor, setAspect: setAspect, aspectName: aspectName, filmShape: filmShape, aspectFit: aspectFit, ASPECTS: ASPECTS, ASPECT_NAMES: ASPECT_NAMES,
    setAudio: function (i) {
      if (!eng || !eng.setAudio) return;
      if (cur) cur.userAudio = true;
      // A track this TV can't play, picked by hand: convert it (when the converter is there).
      if (cur && !cur.conv && cur.badTracks && cur.badTracks[i] && cur.probe && window.Convert && Convert.key) {
        var t = cur.probe.tracks[i] || {};
        useConv({ src: cur.origUrl || cur.url, a: i, fmt: Convert.fmtFor(cur.probe.video), codec: t.codec, channels: t.channels || 0, tracks: cur.probe.tracks, bad: cur.badTracks, dur: cur.probe.dur }, 'Converting ' + (Convert.NAMES[t.codec] || t.codec) + ' audio for this TV');
        cur.startAt = Math.max(0.1, position()); cur.retries = 0;
        return start(token);
      }
      eng.setAudio(i);
    },
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
    get duration() { return cur && cur.conv && cur.conv.dur ? cur.conv.dur : video && isFinite(video.duration) ? video.duration : 0; },
    // Sound being converted right now: { codec, track, from } (Stream info, tests).
    get converting() { return cur && cur.conv ? { codec: cur.conv.codec, track: cur.conv.a, from: cur.conv.t, base: cur.conv.base, fmt: cur.conv.fmt, url: st && st.state !== 'idle' && video ? video.getAttribute('src') || '' : '' } : null; },
    get paused() { return !video || video.paused; },
    get userPaused() { return !!(st && st.userPaused); },
    get playing() { return !!(st && st.state === 'playing'); },
    get state() { return st ? st.state || 'idle' : 'idle'; },        // loading, buffering, playing, error, ended, idle
    get cc() { return ccState(); },
    setCC: function (on) { Store.settings.cc = !!on; Store.saveSettings(); ccLast = '-'; try { ccDraw(); } catch (e) {} }
  };
})();
