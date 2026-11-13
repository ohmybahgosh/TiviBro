/* Embedded subtitles, the part every container shares.  The TV's own <video> plays MKV and MP4
   files but never exposes the text subtitle tracks inside them, so a format reader (mkvsubs.js,
   and later others) finds the tracks and where their lines sit, and this core does the rest:
   HTTP Range reads on the playing file's own session URL (the provider sees one session), reads
   paused while the playback buffer is low and aborted when the player waits, retries with backoff,
   a per-file cache that survives seeks and reconnects, real <track>s for the subtitle menu, and an
   overlay that draws the one selected track (webOS can draw ::cue badly or not at all).

   EmbedSubs.run(url, video, onResolved, adapter) -> { cancel }.  onResolved(sessionUrl) is called
   once, after the first read resolved the provider's redirect, and the video must start on that
   URL; null for a reanchor (seek), which keeps the video as it is.  An adapter is a container:
     id, headBytes                  name for logs, size of the first (session-resolving) read
     startupDelayMs                 optional delay before the first read (tests, diagnostics)
     retryBaseMs                    optional first wait after a refused read (1000; shorter in tests)
     startupDeadlineMs              0, or how long the video may wait for the first read: after it the
                                    video starts on the original URL and subtitles give up for this play
     lazy                           reads only tracks asked for (ctx.demand(i): null, 'now', { from, to }
                                    or a list of those): each track gets
                                    _embedLoad(fromSec, toSec, timeoutMs) -> Promise, which asks for
                                    that window until nothing in it is left to read (Line up's reference)
     describe() entries may carry forced: true.  Every attached track has _embedded = true and
     _forced, set before it is attached (the addtrack handler reads them).
     discover(head, range, rec, alive) -> Promise of the format's index, null (tracks, none usable)
                                    or { none: 'empty' } (no subtitle tracks at all: the menu says so)
     describe(index)                -> [{ label, srclang }] in attach order
     candidates(rec, now, ctx)      -> ordered work items { id, keys? } not yet fetched, near now.
                                    ctx.demand(i): null, or 'now' while track i is showing; ctx.timing(i):
                                    { scale, off, delay }, how Subs shows track i's lines (shown =
                                    source * scale + off + delay).  Formats that read every track ignore it
     complete(rec, now)             -> true when nothing is left anywhere in the file
     read(rec, item, range, alive)  -> Promise of [{ track, s, e, text }], track = index into describe()
   range(start, end, metadata) reads bytes [start, end] into a Uint8Array whose .total is the file
   size from Content-Range (NaN if unknown); metadata reads skip the buffer wait.  alive()
   is false once cancelled: check it before parsing a response, so a stopped player costs no work. */
var EmbedSubs = (function () {
  'use strict';

  // Extracted cues live longer than one playback instance. Reconnects tear down the
  // engine and call extract() afresh; retain cues so they do not disappear and get
  // fetched again on each reconnect. Keyed by
  // the file URL: { tracks: [{label, srclang}], cues: [[{s,e,text}]...] (per track),
  // fetched: {workItemKey: true}, done: bool }.  Cues replay instantly on reconnect
  // and only not-yet-fetched work is requested, so extraction converges rather than
  // restarting, and the provider sees far fewer requests overall.
  var subCache = {};
  // The session the newest play resolved, before its file has a cache record: a seek during discovery
  // restarts the reader on it instead of opening the provider's entry link next to the video.
  var lastSession = null;
  // Only the playing file and the two before it keep their cache: a seek or reconnect needs it, an
  // evening of episodes shouldn't pile up indexes and lines in the TV's memory.
  var CACHE_FILES = 3, cacheOrder = [];
  function touch(url) {
    cacheOrder = cacheOrder.filter(function (u) { return u !== url; });
    cacheOrder.push(url);
    while (cacheOrder.length > CACHE_FILES) delete subCache[cacheOrder.shift()];
  }
  // Lines kept per file for replays (the live track keeps them all).
  var MAX_TEXT_CHARS = 2000000;

  /* Text.  TextDecoder exists on every webOS TV (Chromium 38+); the fallback is a complete decoder for
     the hosts without it: U+FFFD for malformed or cut-off sequences (as TextDecoder does), surrogate
     pairs for characters past U+FFFF. */
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8(buf, start, end) {
    if (decoder) return decoder.decode(buf.subarray(start, end));
    var out = '', i = start;
    if (end - start >= 3 && buf[i] === 0xEF && buf[i + 1] === 0xBB && buf[i + 2] === 0xBF) i += 3;   // BOM, as TextDecoder drops it
    while (i < end) {
      var b = buf[i], need, cp, lower = 0x80, upper = 0xBF;
      if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
      if (b >= 0xC2 && b <= 0xDF) { need = 1; cp = b & 0x1F; }
      else if (b >= 0xE0 && b <= 0xEF) { need = 2; cp = b & 0x0F; if (b === 0xE0) lower = 0xA0; if (b === 0xED) upper = 0x9F; }
      else if (b >= 0xF0 && b <= 0xF4) { need = 3; cp = b & 0x07; if (b === 0xF0) lower = 0x90; if (b === 0xF4) upper = 0x8F; }
      else { out += '\uFFFD'; i++; continue; }
      var j = i + 1, good = true;
      for (var k = 0; k < need; k++, j++) {
        var c = j < end ? buf[j] : -1;
        if (c < (k ? 0x80 : lower) || c > (k ? 0xBF : upper)) { good = false; break; }
        cp = cp * 64 + (c & 0x3F);
      }
      i = j;                                 // a bad byte is read again as the start of the next character
      if (!good) { out += '\uFFFD'; continue; }
      if (cp > 0xFFFF) { cp -= 0x10000; out += String.fromCharCode(0xD800 + Math.floor(cp / 1024), 0xDC00 + cp % 1024); }
      else out += String.fromCharCode(cp);
    }
    return out;
  }
  function utf16(buf, start, end, littleEndian) {
    var out = '';
    for (var i = start; i + 1 < end; i += 2) out += String.fromCharCode(littleEndian ? buf[i] + buf[i + 1] * 256 : buf[i] * 256 + buf[i + 1]);
    if ((end - start) % 2) out += '\uFFFD';
    return out;
  }

  function run(url, video, onResolved, adapter) {
    var tag = adapter.id + 'subs';
    function shown(none) { return none === 'empty' ? '' : none; }   // 'empty': the menu says the video has none
    var cancelled = false, started = false;
    function startVideo(resolved) { if (!cancelled && !started && onResolved) { started = true; onResolved(resolved); } }
    video._mkvSubsState = 'discovering';
    /* The movie's own time.  Converted sound (player.js) plays a stream that starts at the seek, so the
       video's clock is behind the movie by video._tbOffset. */
    function vnow() { return (video.currentTime || 0) + (video._tbOffset || 0); }
    var overlay = null, lastText = '', selectedTrack = null;
    if (video.parentNode && video.style) {
      overlay = document.createElement('div');
      overlay.className = 'mkv-captions';
      video.parentNode.appendChild(overlay);
    }
    function paint() {
      if (!overlay || cancelled) return;
      // Track updates must not leave more than one subtitle language enabled.
      // Keep the current choice until it is switched off (as the subtitle menu
      // does when choosing a different track), rather than stacking languages.
      var tracks = video.textTracks || liveTracks;
      if (!selectedTrack || selectedTrack.mode !== 'showing' || Array.prototype.indexOf.call(tracks, selectedTrack) < 0) {
        selectedTrack = null;
        for (var n = 0; n < tracks.length; n++) {
          if (tracks[n].kind && tracks[n].kind !== 'subtitles') continue;
          if (tracks[n].mode === 'showing') { selectedTrack = tracks[n]; break; }
        }
      }
      for (var m = 0; selectedTrack && m < tracks.length; m++) {
        if (tracks[m] !== selectedTrack && (!tracks[m].kind || tracks[m].kind === 'subtitles') && tracks[m].mode === 'showing')
          tracks[m].mode = 'disabled';
      }
      var lines = [], selected = false;
      for (var a = 0; a < liveTracks.length; a++) {
        if (liveTracks[a].mode !== 'showing') continue;
        selected = true;
        // Subs timing and alignment change live cue times.  Some native players
        // clear a <track>'s cues when enabling it; retain the text cache fallback.
        var live = liveTracks[a].cues, useLive = live && live.length;
        var list = useLive ? live : rec && rec.cues[a] || [];
        // The text cache holds file times: show them where Subs shows this track (Line up, Timing).
        var tm = useLive ? null : ctx.timing(a), scale = tm ? tm.scale || 1 : 1, delay = tm ? (tm.off || 0) + (tm.delay || 0) : 0;
        // A track's cue list is in start order: find where "now" falls instead of walking every cue
        // each frame (some native players leave activeCues empty, so it can't be used).
        var from = 0;
        if (useLive) {
          var lo = 0, hi = list.length, t = vnow();
          while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].startTime <= t) lo = mid + 1; else hi = mid; }
          from = Math.max(0, lo - 12);           // a few earlier ones that may still be on screen
        }
        for (var b = from; b < (useLive ? Math.min(list.length, from + 13) : list.length); b++) {
          var s = useLive ? list[b].startTime : list[b].s * scale + delay, e = useLive ? list[b].endTime : list[b].e * scale + delay;
          if (!useLive) { s = Math.max(0, s); e = Math.max(s + 0.05, e); }      // as Subs places a moved line (subs.js placed())
          if (s <= vnow() && e > vnow())
            lines.push(list[b].text.replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi, ''));
        }
      }
      if (video.classList) video.classList.toggle('mkv-captions-active', selected);
      var text = lines.join('\n');
      if (text !== lastText) { if (typeof U !== 'undefined' && U.lines) U.lines(overlay, text); else overlay.textContent = text; lastText = text; }
    }
    var addedEls = [];        // <track> elements this call appended, so cancel() can undo them
    var liveTracks = [];      // the live TextTrack per track index, parallel to a rec's tracks/cues
    var wrapped = Net.wrap(url);
    var activeRequest = null, gateTimer = null, rejectGate = null, pump = null, retryTimer = null;
    var timedOut = false, deadline = null;     // the startup deadline (adapter.startupDeadlineMs)
    function hasBuffer() {
      if (!video.buffered) return true; // non-media test hosts
      if (video.seeking || video.readyState < 3) return false;
      for (var b = 0; b < video.buffered.length; b++) {
        // (half a second of slack: some TV players report a range starting a hair after the playing position)
        if (video.buffered.start(b) <= video.currentTime + 0.5 && video.buffered.end(b) - video.currentTime >= 2) return true;
      }
      return video.ended || (isFinite(video.duration) && video.duration - video.currentTime < 2 && video.readyState >= 3);
    }
    function waitForBuffer() {
      return new Promise(function (resolve, reject) {
        rejectGate = reject;
        function check() {
          if (cancelled || timedOut) { rejectGate = null; reject(new Error('cancelled')); }
          else if (hasBuffer()) { rejectGate = null; resolve(); }
          else gateTimer = setTimeout(check, 1000);
        }
        check();
      });
    }
    // XHR can abort on Chromium 53, where fetch's AbortController is unavailable.
    // Reject a server ignoring Range before it downloads the whole movie.
    function fetchRange(unused, start, end, metadata) {
      return (metadata ? Promise.resolve() : waitForBuffer()).then(function () {
        if (cancelled || timedOut) throw new Error('cancelled');
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest(), settled = false, expected = 0, total = NaN;
          function finish(err, data) {
            if (settled) return;
            settled = true; activeRequest = null;
            if (err) reject(err); else resolve(data);
          }
          activeRequest = xhr;
          xhr.open('GET', wrapped, true);
          xhr.responseType = 'arraybuffer'; xhr.timeout = 10000;
          xhr.setRequestHeader('Range', 'bytes=' + start + '-' + end);
          xhr.onreadystatechange = function () {
            if (xhr.readyState !== 2) return;
            var m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(xhr.getResponseHeader('Content-Range') || '');
            if (xhr.status !== 206 || !m || +m[1] !== start || +m[2] > end || +m[2] < start) {
              // Not a part of the file at all: the provider (or the network) refused this read.
              var err = new Error('invalid range response (HTTP ' + xhr.status + ')');
              if (xhr.status !== 206) err.refused = true;
              finish(err); xhr.abort();
            } else { expected = +m[2] - start + 1; total = m[3] === '*' ? NaN : +m[3]; }
          };
          xhr.onprogress = function (e) { if (e.loaded > end - start + 1) { finish(new Error('oversized range response')); xhr.abort(); } };
          xhr.onload = function () {
            var data = xhr.response && new Uint8Array(xhr.response);
            if (!data || !expected || data.length !== expected) finish(new Error('invalid range length'));
            else { if (xhr.responseURL) wrapped = xhr.responseURL; data.total = total; finish(null, data); }
          };
          xhr.onerror = xhr.ontimeout = function () { var err = new Error('range request failed'); err.refused = true; finish(err); };
          xhr.onabort = function () { finish(new Error(xhr.yieldToPlayback ? 'buffer low' : 'cancelled')); };
          xhr.send();
        });
      }).catch(function (e) {
        if (!cancelled && !timedOut && e.message === 'buffer low') return waitForBuffer().then(function () { return fetchRange(unused, start, end, metadata); });
        throw e;
      });
    }
    function range(start, end, metadata) { return fetchRange(wrapped, start, end, metadata); }
    function alive() { return !cancelled; }
    function onWaiting() {
      if (activeRequest) { activeRequest.yieldToPlayback = true; activeRequest.abort(); }
    }
    function onTime() { paint(); if (pump) pump(); }
    // A track switched on (or off) is read at once, even while paused, rather than at the next timeupdate.
    function onTracks() { paint(); if (pump) pump(); }
    // What the format asks before choosing what to read next.
    var loads = {};               // track index -> { from, to, settle }: an _embedLoad in progress
    var settleTimers = [];        // putting the track modes back after the browser's own pick
    var ctx = {
      // A shown track that Line up also reads asks for both windows, as a list (nothing in between).
      demand: function (i) {
        var t = liveTracks[i], on = t && t.mode === 'showing', l = loads[i];
        if (!l) return on ? 'now' : null;
        return on ? ['now', l] : l;
      },
      timing: function (i) {
        var has = typeof Subs !== 'undefined', m = has && Subs.timingOf ? Subs.timingOf(liveTracks[i]) : null;
        return m || { scale: 1, off: 0, delay: has ? Subs.delay || 0 : 0 };
      }
    };
    if (video.addEventListener) {
      video.addEventListener('timeupdate', onTime); video.addEventListener('waiting', onWaiting);
      video.addEventListener('seeking', paint); video.addEventListener('seeked', paint);
    }
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('change', onTracks);
    var rec = subCache[url];
    if (rec) touch(url);
    // A file found to have no usable subtitles is remembered for seeks and reconnects (no more
    // header reads); a fresh start of the file looks again.
    if (rec && rec.none && onResolved) rec = subCache[url] = null;
    // A play that gave up (startup deadline, failed first read) stays given up for its seeks; the
    // next engine start tries again.
    if (rec && rec.failed && onResolved) delete rec.failed;
    // Refusals are counted, and waited out, across the seeks of a play; the next engine start begins afresh.
    if (rec && onResolved) delete rec.retry;
    // Items whose lines didn't fit the text cap are read again in this play.
    if (rec && rec.unretained) { for (var uk in rec.unretained) delete rec.fetched[uk]; rec.unretained = null; rec.done = false; }
    if (!onResolved && rec && rec.resolved) wrapped = rec.resolved;
    else if (!onResolved && lastSession && lastSession.url === url) wrapped = lastSession.resolved;

    // Line up asks for a window of a track nobody is watching: read it, then stop asking.
    function loadFor(k) {
      return function (from, to, ms) {
        return new Promise(function (resolve, reject) {
          if (cancelled) return reject(new Error('cancelled'));
          if (rec && rec.failed) return reject(new Error('unavailable'));
          if (loads[k]) loads[k].settle(new Error('replaced'));
          var timer = setTimeout(function () { load.settle(new Error('timeout')); }, ms);
          var load = loads[k] = { from: from, to: to, settle: function (err) {
            if (loads[k] !== load) return;
            delete loads[k]; clearTimeout(timer);
            if (err) reject(err); else resolve();
          } };
          checkLoads();
          if (loads[k] && pump) pump();
        });
      };
    }
    // A load is done when the format has nothing left to read for that track in that window.
    function checkLoads() {
      for (var k in loads) {
        if (!rec || !rec.index) continue;
        var one = loads[k], only = { demand: function (i) { return String(i) === k ? one : null; }, timing: ctx.timing };
        if (rec.done || !adapter.candidates(rec, vnow(), only).length) one.settle(null);
      }
    }
    function ensureTracks(trackMeta) {
      if (liveTracks.length) return;              // already attached (from cache or a prior call in this instance)
      for (var k = 0; k < trackMeta.length; k++) {
        var trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = trackMeta[k].label;
        trackEl.srclang = trackMeta[k].srclang;
        trackEl.track._embedded = true;
        trackEl.track._tbMkv = true;            // drawn here (and by the TV), not by Subs' own drawing (subs.js)
        trackEl.track._forced = !!trackMeta[k].forced;
        if (adapter.lazy) trackEl.track._embedLoad = loadFor(k);
        video.appendChild(trackEl);
        addedEls.push(trackEl);
        liveTracks.push(trackEl.track);
        if (rec && rec.modes && rec.modes[k]) trackEl.track.mode = rec.modes[k];
      }
      // Chromium switches on a newly added track by itself (the browser's language) once any track was
      // shown on this video, whatever the script set, so the saved choice comes back just after it.
      // With no saved choice and none made in this playback, Subs.autoOn picks (Settings > Playback);
      // views.js leaves these tracks to this.
      // A subtitle already on that isn't one of these (a download from Find subtitles) stays the one shown.
      var intent = liveTracks.map(function (t, i) { return rec && rec.modes && rec.modes[i] || 'disabled'; });
      /* The viewer's pick in the Subtitles menu, by name and language (issue #51): a reconnect or a new
         engine makes new track objects, so the pick itself no longer matches any of them. */
      var wantKey = video._subsChoice && typeof video._subsWantKey === 'string' ? video._subsWantKey : null;
      if (wantKey != null && !otherShowing()) intent = liveTracks.map(function (t) { return wantKey && keyOf(t) === wantKey ? 'showing' : 'disabled'; });
      if (intent.indexOf('showing') < 0 && !video._subsChoice && !otherShowing() && typeof Subs !== 'undefined' && Subs.autoOn) {
        for (var a = 0; a < liveTracks.length; a++) if (Subs.autoOn(liveTracks[a], video)) { intent[a] = 'showing'; break; }
      }
      // A choice in the Subtitles menu meanwhile (views.js counts them in video._subsRev and keeps the
      // chosen track in video._subsWant, null for Off) is what gets put back instead.
      var rev0 = video._subsRev;
      function settle() {
        if (cancelled) return;
        var want = video._subsRev === rev0 ? intent : liveTracks.map(function (t) { return t === video._subsWant || (video._subsWantKey && keyOf(t) === video._subsWantKey) ? 'showing' : 'disabled'; });
        for (var i = 0; i < liveTracks.length; i++) if (liveTracks[i].mode !== want[i]) liveTracks[i].mode = want[i];
        paint();
        if (pump) pump();
      }
      settleTimers.push(setTimeout(settle, 0), setTimeout(settle, 60));
    }
    function keyOf(t) { return (t.label || '') + '|' + (t.language || ''); }
    function otherShowing() {
      var all = video.textTracks || [];
      for (var i = 0; i < all.length; i++) {
        var t = all[i];
        if (liveTracks.indexOf(t) < 0 && t.kind === 'subtitles' && t.mode === 'showing' && !(typeof Subs !== 'undefined' && Subs.gone && Subs.gone(t))) return true;
      }
      return false;
    }
    function replayCached(r) {
      for (var k = 0; k < r.cues.length; k++) {
        var list = r.cues[k];
        for (var j = 0; j < list.length; j++) liveTracks[k].addCue(new VTTCue(list[j].s, list[j].e, list[j].text));
        if (typeof Subs !== 'undefined' && Subs.fresh) Subs.fresh(liveTracks[k]);    // a Line up or Timing done before the seek
      }
    }

    // Fast path: this file was (at least partly) extracted before.  Re-attach its tracks
    // and replay its cues synchronously -- no network, no await -- so a reconnect shows
    // subtitles instantly instead of blanking them.
    if (rec && rec.tracks.length) { ensureTracks(rec.tracks); replayCached(rec); }
    if (rec && rec.tracks.length) { video._mkvSubsState = 'ready'; paint(); }
    if (rec && rec.none) video._mkvSubsState = shown(rec.none);
    if (rec && rec.failed) { video._mkvSubsState = 'error'; return cancelHandle(); }   // cached lines only, no reads
    if (rec && rec.done && !onResolved) return cancelHandle();   // fully cached: nothing left to fetch

    var timer = setTimeout(function () { if (!cancelled) runExtraction(); }, adapter.startupDelayMs || 0);

    // Reads the format's work items near the playing position, one at a time.
    //   A read the provider refuses (an HTTP error, or no answer) is about the session, not the item:
    //   every read waits together, longer each time (1, 2, 4... s, at most 30 s).  Providers' session
    //   links can stop taking new requests mid-play (HTTP 509 after about ten minutes on one) while the
    //   video's open connection carries on, so every second refusal in a row asks the movie's own link
    //   for a new session first (16 bytes; the video keeps its connection).  Six in a row: subtitles
    //   give up for this play.  The count and the wait carry over seeks (they live in the file's record);
    //   a new engine start begins afresh.  A new session that serves another size is a different file:
    //   subtitles stop there.  Bad data in an answer (a wrong range) backs off only that item.
    function startPump() {
      var busy = false, failures = {}, retryAt = {}, base = adapter.retryBaseMs || 1000;
      var R = rec.retry || (rec.retry = { refused: 0, pausedUntil: 0, fresh: false });
      // A seek's reader takes the session when it starts reading, not when it was made: the player
      // makes it in the same step as cancelling the old one, before a renewal just answered is saved.
      if (!onResolved && rec.resolved) wrapped = rec.resolved;
      function stop() { video._mkvSubsState = 'error'; giveUp(); paint(); }
      function refusedBy(e) {
        busy = false;
        if (cancelled) return;
        R.refused++;
        if (R.refused >= 6) {
          Log.warn(tag, 'Subtitles gave up: the provider keeps refusing the reads (' + (e && e.message) + ')');
          stop();
          return;
        }
        if (R.refused === 1) Log.warn(tag, 'Subtitle read refused; all reads wait, then try again: ' + (e && e.message));
        R.fresh = R.refused % 2 === 0;
        R.pausedUntil = Date.now() + Math.min(30000, base * Math.pow(2, R.refused - 1));
        video._mkvSubsState = 'recovering';
        pump();
      }
      // Resolves to false when the link now serves another file (another size): its offsets don't fit.
      // The answer is kept even if a seek cancelled this pump meanwhile (the seek reads on it), but not
      // once a new engine start has begun a new play (it has its own session).
      function newSession() {
        var old = wrapped;
        wrapped = Net.wrap(url);
        return fetchRange(wrapped, 0, 15).then(function (bytes) {
          if (rec.retry !== R) { wrapped = old; return null; }
          R.fresh = false;
          if (rec.size !== undefined && isFinite(bytes.total) && bytes.total !== rec.size) {
            wrapped = old;
            Log.warn(tag, 'Subtitles stopped: the movie\'s link now serves a different file');
            giveUp();
            return false;
          }
          rec.resolved = wrapped;
          lastSession = { url: url, resolved: wrapped };
          Log.info(tag, 'The provider stopped taking subtitle reads on its session: reading on a new one');
          return true;
        }, function (e) { wrapped = old; throw e; });
      }
      /* A read that never ends (no answer, no error, no timeout: seen as subtitles stopping partway, issue #86)
         would hold every later read for the rest of the play.  After two minutes it is let go of. */
      var busyAt = 0, gen = 0;
      pump = function () {
        if (busy && Date.now() - busyAt > 120000) { Log.warn(tag, 'A subtitle read never finished; reading on'); busy = false; gen++; if (activeRequest) { try { activeRequest.abort(); } catch (e) {} } }
        if (cancelled || busy || (rec && rec.failed)) return;
        clearTimeout(retryTimer); retryTimer = null;
        if (!hasBuffer()) { retryTimer = setTimeout(pump, 1000); return; }
        var wait = R.pausedUntil - Date.now();
        if (wait > 0) { retryTimer = setTimeout(pump, wait); return; }
        var now = vnow();
        var items = adapter.candidates(rec, now, ctx);
        if (!items.length) { rec.done = adapter.complete(rec, now); checkLoads(); return; }
        var clock = Date.now(), earliest = Infinity;
        items = items.filter(function (it) {
          if (!retryAt[it.id] || retryAt[it.id] <= clock) return true;
          earliest = Math.min(earliest, retryAt[it.id]);
          return false;
        });
        if (!items.length) { retryTimer = setTimeout(pump, Math.max(1, earliest - clock)); return; }
        busy = true; busyAt = Date.now();
        // The renewal stays owed until it is answered: a seek that cancels it asks again.
        var mine = ++gen;
        if (R.fresh) {
          newSession().then(function (same) {
            if (mine !== gen) return;
            busy = false;
            if (cancelled) return;
            if (same) pump(); else stop();
          }, function (e) { if (mine === gen) refusedBy(e); });
          return;
        }
        var item = items[0];
        adapter.read(rec, item, function (start, end) { return fetchRange(wrapped, start, end); }, alive).then(function (found) {
          if (cancelled || mine !== gen) return;
          // An item's lines are kept for replays whole or not at all, so one that didn't fit the text
          // cap can be read again after a seek without doubling the lines that were kept.
          var chars = 0;
          for (var f = 0; f < found.length; f++) chars += found[f].text.length;
          var keep = (rec.textChars || 0) + chars <= MAX_TEXT_CHARS;
          if (keep) rec.textChars = (rec.textChars || 0) + chars;
          for (f = 0; f < found.length; f++) {
            var c = found[f];
            liveTracks[c.track].addCue(new VTTCue(c.s, c.e, c.text));
            if (keep) rec.cues[c.track].push({ s: c.s, e: c.e, text: c.text });
          }
          if (typeof Subs !== 'undefined' && Subs.fresh) liveTracks.forEach(function (t) { Subs.fresh(t); });
          var keys = item.keys || [item.id];
          for (var k = 0; k < keys.length; k++) {
            rec.fetched[keys[k]] = true;
            if (!keep) (rec.unretained = rec.unretained || {})[keys[k]] = true;
          }
          delete failures[item.id]; delete retryAt[item.id];
          R.refused = 0;
          video._mkvSubsState = 'ready';
          busy = false;
          paint();
          checkLoads();
          pump();
        }).catch(function (e) {
          if (mine !== gen) return;
          busy = false;
          if (cancelled) return;
          if (e && e.refused) return refusedBy(e);
          // A transient range failure must not disable extraction for the rest
          // of the movie. Back off this item while other nearby cues load.
          failures[item.id] = (failures[item.id] || 0) + 1;
          var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(failures[item.id] - 1, 5)));
          retryAt[item.id] = Date.now() + delay;
          video._mkvSubsState = 'recovering';
          if (failures[item.id] === 1) Log.warn(tag, 'Subtitle read failed; retrying: ' + e.message);
          pump();
        });
      };
      pump();
    }

    function runExtraction() {
    // The index read before for this file: straight to the subtitle lines.  A seek keeps the video's
    // session.  A new engine start (a reconnect, or play after a long pause) asks the movie's own link
    // again for the provider's current session, with a 16-byte read: the one from before can have
    // expired or been closed meanwhile (issue #34).
    if (!onResolved && rec && rec.index && rec.resolved && liveTracks.length) return startPump();
    var reopen = !!(rec && rec.index && liveTracks.length);
    if (adapter.startupDeadlineMs > 0 && onResolved) deadline = setTimeout(function () {
      if (cancelled || started) return;
      // A provider this slow to answer would keep the picture waiting: play now, on the original link,
      // and do without subtitles this time rather than open a second session next to the video's.
      timedOut = true;
      Log.warn(tag, 'Subtitles gave up: the file took too long to answer');
      startVideo(url);
      video._mkvSubsState = 'error'; giveUp();
      clearTimeout(gateTimer);
      if (rejectGate) { rejectGate(new Error('cancelled')); rejectGate = null; }
      if (activeRequest) activeRequest.abort();
    }, adapter.startupDeadlineMs);
    fetchRange(wrapped, 0, (reopen ? 16 : adapter.headBytes) - 1, true).then(function (head) {
      clearTimeout(deadline);
      if (cancelled || timedOut) return;
      if (onResolved) lastSession = { url: url, resolved: wrapped };
      startVideo(wrapped);
      // The same link now serving a different file (a different size) starts over.
      if (rec && rec.size !== undefined && isFinite(head.total) && head.total !== rec.size) {
        dropTracks(); rec = subCache[url] = null;
        video._mkvSubsState = 'discovering'; paint();          // the old file's lines leave the screen
      }
      if (rec) rec.resolved = wrapped;
      if (rec && rec.done) return;
      if (cancelled) return;                  // stopped as the video started (inside onResolved)
      if (rec && rec.index && liveTracks.length) return startPump();     // fresh session, index kept
      // A reopen read only the first bytes: discovery needs the whole head.
      var whole = head.length < adapter.headBytes && !(isFinite(head.total) && head.length >= head.total)
        ? fetchRange(wrapped, 0, adapter.headBytes - 1, true) : Promise.resolve(head);
      return whole.then(function (h) { return adapter.discover(h, range, rec, alive); }).then(function (index) {
        if (cancelled || !index) return;
        if (index.none) { video._mkvSubsState = shown(index.none); remember(index.none, head.total); return; }
        // Create (or reuse) this URL's cache record, then attach tracks if not already.
        if (!rec) {
          var meta = adapter.describe(index);
          rec = subCache[url] = { tracks: meta, cues: meta.map(function () { return []; }), fetched: {}, done: false, size: head.total };
          touch(url);
        }
        rec.resolved = wrapped;
        ensureTracks(rec.tracks);
        video._mkvSubsState = 'ready';
        if (cancelled) return;

        // Kept with the file, so a seek or reconnect starts reading subtitles at once instead of
        // reading the index again.
        rec.index = index;
        startPump();
      });
    }).then(function () {
      startVideo(wrapped);
      if (!cancelled && video._mkvSubsState === 'discovering') { video._mkvSubsState = 'unavailable'; remember('unavailable'); }
    }).catch(function (e) {
      clearTimeout(deadline);
      if (timedOut) return;
      startVideo(url);
      if (!cancelled) { video._mkvSubsState = 'error'; giveUp(); }
      if (typeof Log !== 'undefined' && Log.debug) Log.debug(tag, 'giving up: ' + (e && e.message));
    });
    }

    function remember(state, size) {
      if (!subCache[url]) { subCache[url] = { tracks: [], cues: [], fetched: {}, done: true, none: state, resolved: wrapped, size: size }; touch(url); }
    }
    // This play is on the original link, not the session the cached index was read through: no reads
    // until the next engine start.
    function giveUp() { if (subCache[url]) subCache[url].failed = true; else remember('error'); }
    function dropTracks() {
      for (var i = 0; i < addedEls.length; i++) { try { video.removeChild(addedEls[i]); } catch (e) {} }
      addedEls.length = 0; liveTracks.length = 0;
    }
    function cancelHandle() {
      return { cancel: function () {
        paint(); // Normalize late track changes before a seek/reconnect saves the selection.
        if (rec && liveTracks.length) rec.modes = liveTracks.map(function (t) { return t.mode; });
        cancelled = true;
        clearTimeout(timer);
        clearTimeout(gateTimer);
        clearTimeout(retryTimer);
        clearTimeout(deadline);
        if (rejectGate) { rejectGate(new Error('cancelled')); rejectGate = null; }
        if (activeRequest) activeRequest.abort();
        for (var lk in loads) loads[lk].settle(new Error('cancelled'));
        settleTimers.forEach(clearTimeout);
        if (video.removeEventListener) {
          video.removeEventListener('timeupdate', onTime); video.removeEventListener('waiting', onWaiting);
          video.removeEventListener('seeking', paint); video.removeEventListener('seeked', paint);
        }
        if (video.textTracks && video.textTracks.removeEventListener) video.textTracks.removeEventListener('change', onTracks);
        dropTracks();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (video.classList) video.classList.remove('mkv-captions-active');
        video._mkvSubsState = '';
      } };
    }
    return cancelHandle();
  }

  return { run: run, utf8: utf8, utf16: utf16 };
})();
