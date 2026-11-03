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
     reuseSession                   a cached index may start the video with no new read
     discover(head, range, rec, alive) -> Promise of the format's index, or null (no usable tracks)
     describe(index)                -> [{ label, srclang }] in attach order
     candidates(rec, now)           -> ordered work items { id, keys? } not yet fetched, near now
     complete(rec, now)             -> true when nothing is left anywhere in the file
     read(rec, item, range, alive)  -> Promise of [{ track, s, e, text }], track = index into describe()
   range(start, end, metadata) reads bytes [start, end]; metadata reads skip the buffer wait.  alive()
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

  function run(url, video, onResolved, adapter) {
    var tag = adapter.id + 'subs';
    var cancelled = false, started = false;
    function startVideo(resolved) { if (!cancelled && !started && onResolved) { started = true; onResolved(resolved); } }
    video._mkvSubsState = 'discovering';
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
        var delay = !useLive && typeof Subs !== 'undefined' ? Subs.delay || 0 : 0;
        // A track's cue list is in start order: find where "now" falls instead of walking every cue
        // each frame (some native players leave activeCues empty, so it can't be used).
        var from = 0;
        if (useLive) {
          var lo = 0, hi = list.length, t = video.currentTime;
          while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].startTime <= t) lo = mid + 1; else hi = mid; }
          from = Math.max(0, lo - 12);           // a few earlier ones that may still be on screen
        }
        for (var b = from; b < (useLive ? Math.min(list.length, from + 13) : list.length); b++) {
          var s = useLive ? list[b].startTime : list[b].s + delay, e = useLive ? list[b].endTime : list[b].e + delay;
          if (s <= video.currentTime && e > video.currentTime)
            lines.push(list[b].text.replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi, ''));
        }
      }
      if (video.classList) video.classList.toggle('mkv-captions-active', selected);
      var text = lines.join('\n');
      if (text !== lastText) { overlay.textContent = text; lastText = text; }
    }
    var addedEls = [];        // <track> elements this call appended, so cancel() can undo them
    var liveTracks = [];      // the live TextTrack per track index, parallel to a rec's tracks/cues
    var wrapped = Net.wrap(url);
    var activeRequest = null, gateTimer = null, rejectGate = null, pump = null, retryTimer = null;
    function hasBuffer() {
      if (!video.buffered) return true; // non-media test hosts
      if (video.seeking || video.readyState < 3) return false;
      for (var b = 0; b < video.buffered.length; b++) {
        if (video.buffered.start(b) <= video.currentTime && video.buffered.end(b) - video.currentTime >= 2) return true;
      }
      return video.ended || (isFinite(video.duration) && video.duration - video.currentTime < 2 && video.readyState >= 3);
    }
    function waitForBuffer() {
      return new Promise(function (resolve, reject) {
        rejectGate = reject;
        function check() {
          if (cancelled) { rejectGate = null; reject(new Error('cancelled')); }
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
        if (cancelled) throw new Error('cancelled');
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest(), settled = false, expected = 0;
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
            var m = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/i.exec(xhr.getResponseHeader('Content-Range') || '');
            if (xhr.status !== 206 || !m || +m[1] !== start || +m[2] > end || +m[2] < start) {
              finish(new Error('invalid range response (HTTP ' + xhr.status + ')')); xhr.abort();
            } else expected = +m[2] - start + 1;
          };
          xhr.onprogress = function (e) { if (e.loaded > end - start + 1) { finish(new Error('oversized range response')); xhr.abort(); } };
          xhr.onload = function () {
            var data = xhr.response && new Uint8Array(xhr.response);
            if (!data || !expected || data.length !== expected) finish(new Error('invalid range length'));
            else { if (xhr.responseURL) wrapped = xhr.responseURL; finish(null, data); }
          };
          xhr.onerror = xhr.ontimeout = function () { finish(new Error('range request failed')); };
          xhr.onabort = function () { finish(new Error(xhr.yieldToPlayback ? 'buffer low' : 'cancelled')); };
          xhr.send();
        });
      }).catch(function (e) {
        if (!cancelled && e.message === 'buffer low') return waitForBuffer().then(function () { return fetchRange(unused, start, end, metadata); });
        throw e;
      });
    }
    function range(start, end, metadata) { return fetchRange(wrapped, start, end, metadata); }
    function alive() { return !cancelled; }
    function onWaiting() {
      if (activeRequest) { activeRequest.yieldToPlayback = true; activeRequest.abort(); }
    }
    function onTime() { paint(); if (pump) pump(); }
    if (video.addEventListener) {
      video.addEventListener('timeupdate', onTime); video.addEventListener('waiting', onWaiting);
      video.addEventListener('seeking', paint); video.addEventListener('seeked', paint);
    }
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('change', paint);
    var rec = subCache[url];
    // A file found to have no usable subtitles is remembered for seeks and reconnects (no more
    // header reads); a fresh start of the file looks again.
    if (rec && rec.none && onResolved) rec = subCache[url] = null;
    if (!onResolved && rec && rec.resolved) wrapped = rec.resolved;

    function ensureTracks(trackMeta) {
      if (liveTracks.length) return;              // already attached (from cache or a prior call in this instance)
      for (var k = 0; k < trackMeta.length; k++) {
        var trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = trackMeta[k].label;
        trackEl.srclang = trackMeta[k].srclang;
        video.appendChild(trackEl);
        addedEls.push(trackEl);
        liveTracks.push(trackEl.track);
        if (rec && rec.modes && rec.modes[k]) trackEl.track.mode = rec.modes[k];
      }
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
    if (rec && rec.none) video._mkvSubsState = rec.none;
    if (rec && rec.done && !onResolved) return cancelHandle();   // fully cached: nothing left to fetch

    var timer = setTimeout(function () { if (!cancelled) runExtraction(); }, adapter.startupDelayMs || 0);

    // Reads the format's work items near the playing position, one at a time.
    function startPump() {
      var busy = false, failures = {}, retryAt = {};
      pump = function () {
        if (cancelled || busy) return;
        clearTimeout(retryTimer); retryTimer = null;
        if (!hasBuffer()) { retryTimer = setTimeout(pump, 1000); return; }
        var now = video.currentTime || 0;
        var items = adapter.candidates(rec, now);
        if (!items.length) { rec.done = adapter.complete(rec, now); return; }
        var clock = Date.now(), earliest = Infinity;
        items = items.filter(function (it) {
          if (!retryAt[it.id] || retryAt[it.id] <= clock) return true;
          earliest = Math.min(earliest, retryAt[it.id]);
          return false;
        });
        if (!items.length) { retryTimer = setTimeout(pump, Math.max(1, earliest - clock)); return; }
        busy = true;
        var item = items[0];
        adapter.read(rec, item, function (start, end) { return fetchRange(wrapped, start, end); }, alive).then(function (found) {
          if (cancelled) return;
          for (var f = 0; f < found.length; f++) {
            var c = found[f];
            liveTracks[c.track].addCue(new VTTCue(c.s, c.e, c.text));
            rec.cues[c.track].push({ s: c.s, e: c.e, text: c.text });
          }
          if (typeof Subs !== 'undefined' && Subs.fresh) liveTracks.forEach(function (t) { Subs.fresh(t); });
          var keys = item.keys || [item.id];
          for (var k = 0; k < keys.length; k++) rec.fetched[keys[k]] = true;
          delete failures[item.id]; delete retryAt[item.id];
          video._mkvSubsState = 'ready';
          busy = false;
          paint();
          pump();
        }).catch(function (e) {
          busy = false;
          if (cancelled) return;
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
    // The index read before for this file: straight to the subtitle lines.
    if (adapter.reuseSession && rec && rec.index && rec.resolved && liveTracks.length) {
      startVideo(rec.resolved);
      return startPump();
    }
    fetchRange(wrapped, 0, adapter.headBytes - 1, true).then(function (head) {
      if (cancelled) return;
      startVideo(wrapped);
      if (rec) rec.resolved = wrapped;
      if (rec && rec.done) return;
      if (cancelled) return;                  // stopped as the video started (inside onResolved)
      return adapter.discover(head, range, rec, alive).then(function (index) {
        if (cancelled || !index) return;
        // Create (or reuse) this URL's cache record, then attach tracks if not already.
        if (!rec) {
          var meta = adapter.describe(index);
          rec = subCache[url] = { tracks: meta, cues: meta.map(function () { return []; }), fetched: {}, done: false };
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
      startVideo(url);
      if (!cancelled) { video._mkvSubsState = 'error'; remember('error'); }
      if (typeof Log !== 'undefined' && Log.debug) Log.debug(tag, 'giving up: ' + (e && e.message));
    });
    }

    function remember(state) {
      if (!subCache[url]) subCache[url] = { tracks: [], cues: [], fetched: {}, done: true, none: state, resolved: wrapped };
    }
    function cancelHandle() {
      return { cancel: function () {
        paint(); // Normalize late track changes before a seek/reconnect saves the selection.
        if (rec && liveTracks.length) rec.modes = liveTracks.map(function (t) { return t.mode; });
        cancelled = true;
        clearTimeout(timer);
        clearTimeout(gateTimer);
        clearTimeout(retryTimer);
        if (rejectGate) { rejectGate(new Error('cancelled')); rejectGate = null; }
        if (activeRequest) activeRequest.abort();
        if (video.removeEventListener) {
          video.removeEventListener('timeupdate', onTime); video.removeEventListener('waiting', onWaiting);
          video.removeEventListener('seeking', paint); video.removeEventListener('seeked', paint);
        }
        if (video.textTracks && video.textTracks.removeEventListener) video.textTracks.removeEventListener('change', paint);
        for (var i = 0; i < addedEls.length; i++) { try { video.removeChild(addedEls[i]); } catch (e) {} }
        addedEls.length = 0;
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (video.classList) video.classList.remove('mkv-captions-active');
        video._mkvSubsState = '';
      } };
    }
    return cancelHandle();
  }

  return { run: run };
})();
