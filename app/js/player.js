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
     3. Gap jumping: hop over small holes in the buffer that freeze live TS streams.
     4. Watchdog:    if the clock stops, recover in steps (nudge, decoder recover,
                     reconnect with backoff), then fall back to another engine.
     5. Memory:      back buffer trimmed so long sessions don't starve the TV. */
var Player = (function () {
  'use strict';

  var PRESETS = {
    low:      { label: 'Fast zapping',  prebuffer: 0.5, ahead: 10, back: 4,  stall: 4,  retries: 6,  stash: 128,  chase: true },
    balanced: { label: 'Balanced',      prebuffer: 2,   ahead: 30, back: 8,  stall: 6,  retries: 8,  stash: 384,  chase: false },
    stable:   { label: 'Smooth',        prebuffer: 4,   ahead: 45, back: 10, stall: 8,  retries: 10, stash: 768,  chase: false },
    max:      { label: 'Rock solid',    prebuffer: 8,   ahead: 60, back: 12, stall: 10, retries: 12, stash: 1536, chase: false }
  };

  var video = null, eng = null, cur = null, token = 0;
  var listeners = { state: [], stats: [] };
  var wd = 0, st = null;
  var lastStats = null;
  var fallbackHosts = {};        // host -> 'native' after MSE could not fetch it

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
  function hlsEngine(url, p, preview, fail) {
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
      manifestLoadingTimeOut: 12000, fragLoadingTimeOut: 20000
    });
    var mediaErrs = 0;
    h.on(Hls.Events.ERROR, function (e, d) {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrs < 2) {
        if (mediaErrs++ === 1) h.swapAudioCodec();
        h.recoverMediaError();
        return;
      }
      fail(d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'net' : 'media', d.details, !!(d.response && d.response.code === 0));
    });
    h.loadSource(url);
    h.attachMedia(video);
    return {
      name: 'HLS',
      recover: function () { h.recoverMediaError(); },
      info: function () { var l = h.levels && h.levels[h.currentLevel]; return l ? Math.round((l.bitrate || 0) / 1000) + ' kbps' : ''; },
      audio: function () { return (h.audioTracks || []).map(function (t, i) { return { id: i, label: t.name || t.lang || ('Track ' + (i + 1)), on: i === h.audioTrack }; }); },
      setAudio: function (i) { h.audioTrack = i; },
      // Video quality (TiviMate's "Video tracks"): the HLS variants, or Automatic.
      levels: function () { return (h.levels || []).map(function (l, i) { return { id: i, label: (l.height ? l.height + 'p' : 'Level ' + (i + 1)) + (l.bitrate ? '  ' + (l.bitrate / 1e6).toFixed(1) + ' Mbps' : ''), on: !h.autoLevelEnabled && i === h.currentLevel }; }); },
      auto: function () { return h.autoLevelEnabled; },
      setLevel: function (i) { h.currentLevel = i; },
      destroy: function () { try { h.destroy(); } catch (e) {} }
    };
  }

  function tsEngine(url, p, preview, fail) {
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
    m.on(mpegts.Events.MEDIA_INFO, function (mi) { gotData = true; if (mi && mi.mimeType) Log.debug('player', 'Stream codecs: ' + mi.mimeType); });
    m.on(mpegts.Events.ERROR, function (type, detail, info) {
      fail(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'net' : 'media', detail + (info && info.msg ? ' (' + info.msg + ')' : ''), !gotData && type === mpegts.ErrorTypes.NETWORK_ERROR);
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

  function nativeEngine(url) {
    // HTTPS on the TV's own player can fail on self-signed or unusual certificates, which IPTV
    // panels often have.  The helper accepts them and passes Range requests through for seeking.
    if ((/^https:/i.test(url) || Net.ua) && Net.active) { url = Net.wrap(url); Log.info('player', 'TV player using the helper' + (Net.ua ? ' (custom User-Agent)' : ' for HTTPS')); }
    video.src = url;
    video.load();
    return { name: 'Native', recover: function () {}, info: function () { return ''; }, destroy: function () {},
      audio: function () {
        var at = video.audioTracks, out = [];
        if (at) for (var i = 0; i < at.length; i++) out.push({ id: i, label: at[i].label || at[i].language || ('Track ' + (i + 1)), on: at[i].enabled });
        return out;
      },
      setAudio: function (i) { var at = video.audioTracks; if (at) for (var j = 0; j < at.length; j++) at[j].enabled = j === i; } };
  }

  /* ---------- lifecycle ---------- */
  function teardown() {
    clearInterval(wd); wd = 0;
    if (eng) { eng.destroy(); eng = null; }
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}       // releases the hardware decoder on webOS
    }
  }

  function state(s, msg) { if (st) st.state = s; emit('state', s, msg); }

  function start(myToken) {
    if (myToken !== token || !cur) return;
    clearTimeout(cur.timer);
    teardown();
    if (cur.urlFn) cur.url = cur.urlFn();       // catch-up: every reconnect resumes where playback got to
    var url = cur.url, p = cur.p;
    var kind = cur.forceKind || (cur.forceNative ? 'native' : pickEngine(url));
    Log.info('player', 'Start ' + (cur.ch && cur.ch.n ? '"' + cur.ch.n + '" ' : '') + 'with ' + kind + ' engine' + (kind !== 'native' && Net.active ? ' via helper' : '') + ', profile ' + p.label + ' (prebuffer ' + p.prebuffer + 's)' + (cur.retries ? ', attempt ' + (cur.retries + 1) : '') + '  ' + url);
    st = { state: 'loading', started: false, lastT: -1, lastMove: Date.now(), refilling: false, refillSince: 0,
      kind: kind, at: Date.now(), healthySince: 0 };
    state('loading');

    var fail = function (type, detail, earlyNet, ended) {
      if (myToken !== token) return;
      Log.warn('player', kind + ' engine ' + type + ' error: ' + (detail && detail.message ? detail.message : detail) + (st.started ? '' : ' (before first frame)') + '  ' + cur.url);
      // Before the first frame, a failure in the built-in demuxer (unsupported codec such as
      // AC-3 audio, or a fetch the relay could not make) goes straight to the TV's own player,
      // which decodes AC-3/E-AC-3 and raw TS natively.  No retry loop first.
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

    try {
      if (kind === 'hls') eng = hlsEngine(url, p, cur.preview, fail);
      else if (kind === 'ts') eng = tsEngine(url, p, cur.preview, fail);
      else eng = nativeEngine(url);
    } catch (e) {
      Log.warn('player', kind + ' engine could not start: ' + e.message);
      if (kind === 'native') return giveUp(myToken);
      useEngine('native');
      return start(myToken);
    }
    wd = setInterval(function () { tick(myToken); }, 400);
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
    Log.error('player', 'No player could open this channel (tried ' + Object.keys(cur.tried || {}).join(', ') + ')  ' + (cur.origUrl || cur.url));
    teardown();
    state('error', 'This channel will not play on this TV.  It may use a format the TV cannot decode, or the provider may be having trouble with it.');
  }

  function reconnect(myToken, why) {
    if (myToken !== token || !cur) return;
    cur.retries++;
    Log.warn('player', 'Reconnect ' + cur.retries + '/' + cur.p.retries + ': ' + why);
    if (cur.retries > cur.p.retries) {
      // Last resort: try the other pipeline once before giving up.
      if (!cur.triedNative && st && st.kind !== 'native') { cur.triedNative = true; useEngine('native'); cur.retries = Math.floor(cur.p.retries / 2); }
      else { Log.error('player', 'Gave up after ' + cur.p.retries + ' reconnects  ' + cur.url); teardown(); state('error', 'This channel stopped responding.  Try another channel, or switch the stream format in Settings.'); return; }
    }
    state('buffering', why);
    teardown();
    var delay = Math.min(8000, 300 * Math.pow(2, cur.retries - 1));
    clearTimeout(cur.timer);              // several error events for one failure = one reconnect
    cur.timer = setTimeout(function () { start(myToken); }, delay);
  }

  function tick(myToken) {
    if (myToken !== token || !st || !video) return;
    var now = Date.now(), ahead = bufferedAhead(), t = video.currentTime;
    var p = cur.p;
    emit('stats', lastStats = { ahead: ahead, target: st.started ? p.refill : p.prebuffer, engine: eng ? eng.name : '', info: eng ? eng.info() : '',
      res: video.videoHeight ? video.videoHeight + 'p' : '', state: st.state });

    // 1. Prebuffer before the first frame.
    if (!st.started) {
      // Live streams often buffer from a timestamp after 0 (e.g. 1.4s).  Measure from the start of
      // what is buffered, and move the playhead there before playing.
      var bf = video.buffered, first = bf.length ? bf.start(0) : 0;
      if (bf.length && video.currentTime < first) ahead = bf.end(0) - first;
      var ready = video.readyState >= 2 && (ahead >= p.prebuffer || now - st.at > 4000 + p.prebuffer * 1000);
      if (ready) {
        st.started = true; st.lastMove = now;
        Log.info('player', 'Playing after ' + (now - st.at) + 'ms with ' + ahead.toFixed(1) + 's buffered' + (ahead < p.prebuffer ? ' (prebuffer timed out)' : '') + (video.videoHeight ? ', ' + video.videoWidth + 'x' + video.videoHeight : ''));
        if (bf.length && video.currentTime < first && !cur.startAt) { try { video.currentTime = first + 0.05; } catch (e) {} }
        if (cur.startAt && !cur.live) { try { video.currentTime = cur.startAt; } catch (e) {} cur.startAt = 0; }
        var pr = video.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else if (now - st.at > 15000 + p.prebuffer * 1000) {
        Log.warn('player', 'No playable video after ' + (now - st.at) + 'ms (readyState ' + video.readyState + ', buffered ' + ahead.toFixed(1) + 's)');
        reconnect(myToken, 'No video yet, retrying');
      }
      return;
    }

    // 2. Refill goal: once dry, stay paused until there's a real cushion.
    if (st.refilling) {
      if (ahead >= p.refill || now - st.refillSince > 6000 + p.refill * 1000) {
        st.refilling = false; st.lastMove = now;
        var pr2 = video.play(); if (pr2 && pr2.catch) pr2.catch(function () {});
        state('playing');
      } else if (now - st.refillSince > p.stall * 1000 && ahead < 0.2) {
        st.refilling = false;
        reconnect(myToken, 'Stream stalled, reconnecting');
      }
      return;
    }

    if (st.pendingReconnect && ahead < Math.max(2, p.prebuffer)) { st.pendingReconnect = false; reconnect(myToken, 'Reconnecting'); return; }
    if (!cur.live && !cur.timeshift && video.ended) { clearInterval(wd); wd = 0; state('ended'); return; }
    if (t !== st.lastT && !video.paused) {
      st.lastT = t; st.lastMove = now;
      if (st.state !== 'playing') state('playing');
      if (!st.healthySince) st.healthySince = now;
      // 30s of clean playback earns the retry budget back.
      if (now - st.healthySince > 30000 && cur.retries) { cur.retries = 0; cur.triedNative = false; }
      return;
    }
    if (video.paused && !st.refilling) {
      // Paused but not by the viewer: a play() the TV rejected, or a decoder hiccup.  Kick it.
      if (!st.userPaused && now - (st.kicked || 0) > 1000) {
        st.kicked = now;
        var pk = video.play(); if (pk && pk.catch) pk.catch(function () {});
      }
      if (st.userPaused) return;
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
      Log.info('player', 'Buffer ran dry (' + st.refills + ' times this stream); refilling to ' + p.refill + 's');
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
      if (!cur || !st || st.kind !== 'native' || !video.error) return;
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
  }

  // opts: preview, url (override: catch-up / VOD), live (default true), startAt (seconds, VOD resume)
  function play(ch, opts) {
    opts = opts || {};
    token++;
    if (cur) clearTimeout(cur.timer);
    var fmt = Store.settings.format;
    cur = { ch: ch, url: opts.url || Source.streamUrl(ch, fmt), p: cfg(opts.preview), preview: !!opts.preview, retries: 0,
      forceNative: false, triedNative: false, live: opts.live !== false, startAt: opts.startAt || 0, meta: opts.meta || null,
      timeshift: !!opts.timeshift, urlFn: opts.urlFn || null };
    applyDisplay();
    if (video) video.playbackRate = 1;
    start(token);
  }
  // Picture size: this channel's own choice if it has one, otherwise the global setting.
  function displayFor(ch) { var d = ch && Store.edits.display && Store.edits.display[ch.k]; return d || Store.settings.display || 'contain'; }
  function applyDisplay() { if (video) video.style.objectFit = displayFor(cur && cur.ch); }
  function seek(delta) {
    if (!video || !cur || cur.live) return;
    var d = video.duration;
    var t = video.currentTime + delta;
    if (isFinite(d)) t = U.clamp(t, 0, Math.max(0, d - 2));
    video.currentTime = Math.max(0, t);
  }
  // Same channel, new mode (preview -> fullscreen): keep the stream, just widen the policy.
  function upgrade(preview) {
    if (!cur) return;
    cur.preview = preview;
    cur.p = cfg(preview);
  }
  function stop() { token++; if (cur) clearTimeout(cur.timer); cur = null; teardown(); state('idle'); }
  function togglePause() {
    if (!video || !st) return;
    if (video.paused) { st.userPaused = false; st.lastMove = Date.now(); var r = video.play(); if (r && r.catch) r.catch(function () {}); }
    else { st.userPaused = true; video.pause(); }
  }
  function retryNow() { if (cur) { cur.retries = 0; cur.triedNative = false; start(token); } }

  return {
    PRESETS: PRESETS, bind: bind, play: play, stop: stop, upgrade: upgrade, togglePause: togglePause, retryNow: retryNow, on: on,
    seek: seek, applyDisplay: applyDisplay,
    audioTracks: function () { return eng && eng.audio ? eng.audio() : []; },
    qualities: function () { return eng && eng.levels ? eng.levels() : []; },
    qualityAuto: function () { return !!(eng && eng.auto && eng.auto()); },
    setQuality: function (i) { if (eng && eng.setLevel) eng.setLevel(i); },
    setRate: function (r) { if (video) video.playbackRate = r; },
    get rate() { return video ? video.playbackRate : 1; },
    displayFor: displayFor,
    setAudio: function (i) { if (eng && eng.setAudio) eng.setAudio(i); },
    get stats() { return lastStats; },
    get current() { return cur && cur.ch; },
    get live() { return !cur || cur.live; },
    get meta() { return cur && cur.meta; },
    get position() { return video ? video.currentTime : 0; },
    get duration() { return video && isFinite(video.duration) ? video.duration : 0; },
    get paused() { return !video || video.paused; },
    get playing() { return !!(st && st.state === 'playing'); }
  };
})();
