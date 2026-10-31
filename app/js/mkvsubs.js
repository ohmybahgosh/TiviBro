/* Embedded SRT subtitle extraction for MKV movies/series.  The native engine's <video>
   decodes an MKV's video/audio fine but never exposes its embedded subtitle tracks
   through video.textTracks -- that's a near-universal limitation of browser <video>
   elements, not a webOS quirk.  This reads just enough of the MKV container itself
   (Tracks, then SeekHead -> Cues -> the handful of Clusters a subtitle track's cues
   actually live in) over HTTP Range requests to pull the subtitle text out, and adds
   it as real VTTCue objects on a <track> so the app's existing subtitle UI (auto-on,
   the in-player Subtitles menu) works on its own.  SRT (S_TEXT/UTF8) only; if a file's
   Cues doesn't index its subtitle track, this gives up rather than scanning the file. */
var MkvSubs = (function () {
  'use strict';

  // EBML variable-length integers.  Both element IDs and sizes are encoded the same
  // way: the number of leading zero bits in the first byte before the first 1 bit
  // gives the total length (1 lost bit = that marker '1' itself).  Sizes mask the
  // marker bits out of the value; IDs keep them.
  function vintLen(first) {
    if (first === 0) return 0;
    var len = 1, mask = 0x80;
    while (!(first & mask)) { len++; mask >>= 1; }
    return len;
  }
  function readVint(buf, pos) {
    if (pos >= buf.length) return { value: null, next: pos + 1 };
    var first = buf[pos], len = vintLen(first);
    if (!len || pos + len > buf.length) return { value: null, next: pos + 1 };
    var mask = 0x80 >> (len - 1);
    var value = first & (mask - 1);
    for (var i = 1; i < len; i++) value = value * 256 + buf[pos + i];
    return { value: value, next: pos + len };
  }
  function readId(buf, pos) {
    if (pos >= buf.length) return { value: null, next: pos + 1 };
    var first = buf[pos], len = vintLen(first);
    if (!len || pos + len > buf.length) return { value: null, next: pos + 1 };
    var value = first;
    for (var i = 1; i < len; i++) value = value * 256 + buf[pos + i];
    return { value: value, next: pos + len };
  }
  function idHex(v) { return v.toString(16).toUpperCase(); }

  var TRACKNUMBER = 0xD7, TRACKTYPE = 0x83, CODECID = 0x86, LANGUAGE = 0x22B59C, FLAGFORCED = 0x55AA;
  var TRACKENTRY = 0xAE;

  function readTracks(buf, offset, end) {
    var tracks = [];
    var pos = offset;
    while (pos < end) {
      var idr = readId(buf, pos);
      if (idr.value === null) break;
      var sz = readVint(buf, idr.next);
      if (sz.value === null) break;
      var cstart = sz.next, cend = Math.min(cstart + sz.value, end);
      if (idr.value === TRACKENTRY) {
        var t = { number: 0, type: 0, codecId: '', language: '', forced: false };
        var p = cstart;
        while (p < cend) {
          var cidr = readId(buf, p);
          if (cidr.value === null) break;
          var csz = readVint(buf, cidr.next);
          if (csz.value === null) break;
          var vstart = csz.next, vend = Math.min(vstart + csz.value, cend);
          if (cidr.value === TRACKNUMBER) t.number = bytesToUint(buf, vstart, vend);
          else if (cidr.value === TRACKTYPE) t.type = bytesToUint(buf, vstart, vend);
          else if (cidr.value === CODECID) t.codecId = bytesToAscii(buf, vstart, vend);
          else if (cidr.value === LANGUAGE) t.language = bytesToAscii(buf, vstart, vend);
          else if (cidr.value === FLAGFORCED) t.forced = bytesToUint(buf, vstart, vend) !== 0;
          p = vend;
        }
        tracks.push(t);
      }
      pos = cend;
    }
    return tracks;
  }

  function bytesToUint(buf, start, end) {
    var v = 0;
    for (var i = start; i < end; i++) v = v * 256 + buf[i];
    return v;
  }
  function bytesToAscii(buf, start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return s;
  }

  var SEEK = 0x4DBB, SEEKID = 0x53AB, SEEKPOSITION = 0x53AC;

  function readSeekHead(buf, offset, end) {
    var map = {};
    var pos = offset;
    while (pos < end) {
      var idr = readId(buf, pos);
      if (idr.value === null) break;
      var sz = readVint(buf, idr.next);
      if (sz.value === null) break;
      var cstart = sz.next, cend = Math.min(cstart + sz.value, end);
      if (idr.value === SEEK) {
        var seekId = null, seekPos = null;
        var p = cstart;
        while (p < cend) {
          var cidr = readId(buf, p);
          if (cidr.value === null) break;
          var csz = readVint(buf, cidr.next);
          if (csz.value === null) break;
          var vstart = csz.next, vend = Math.min(vstart + csz.value, cend);
          if (cidr.value === SEEKID) seekId = bytesToHex(buf, vstart, vend);
          else if (cidr.value === SEEKPOSITION) seekPos = bytesToUint(buf, vstart, vend);
          p = vend;
        }
        if (seekId !== null && seekPos !== null) map[seekId] = seekPos;
      }
      pos = cend;
    }
    return map;
  }

  var CUEPOINT = 0xBB, CUETIME = 0xB3, CUETRACKPOSITIONS = 0xB7, CUETRACK = 0xF7, CUECLUSTERPOSITION = 0xF1;

  function readCuesForTrack(buf, offset, end, trackNumber, timecodeScale) {
    var cues = [];
    var pos = offset;
    while (pos < end) {
      var idr = readId(buf, pos);
      if (idr.value === null) break;
      var sz = readVint(buf, idr.next);
      if (sz.value === null) break;
      var cstart = sz.next, cend = Math.min(cstart + sz.value, end);
      if (idr.value === CUEPOINT) {
        var cueTime = 0;
        var p = cstart;
        while (p < cend) {
          var cidr = readId(buf, p);
          if (cidr.value === null) break;
          var csz = readVint(buf, cidr.next);
          if (csz.value === null) break;
          var vstart = csz.next, vend = Math.min(vstart + csz.value, cend);
          if (cidr.value === CUETIME) cueTime = bytesToUint(buf, vstart, vend);
          else if (cidr.value === CUETRACKPOSITIONS) {
            var track = null, clusterPos = null, relativePos = null;
            var q = vstart;
            while (q < vend) {
              var qidr = readId(buf, q);
              if (qidr.value === null) break;
              var qsz = readVint(buf, qidr.next);
              if (qsz.value === null) break;
              var qvstart = qsz.next, qvend = Math.min(qvstart + qsz.value, vend);
              if (qidr.value === CUETRACK) track = bytesToUint(buf, qvstart, qvend);
              else if (qidr.value === CUECLUSTERPOSITION) clusterPos = bytesToUint(buf, qvstart, qvend);
              else if (qidr.value === 0xF0) relativePos = bytesToUint(buf, qvstart, qvend);
              q = qvend;
            }
            if (track === trackNumber && clusterPos !== null) {
              var cue = { timeSec: cueTime * timecodeScale / 1e9, clusterPos: clusterPos };
              if (relativePos !== null) cue.relativePos = relativePos;
              cues.push(cue);
            }
          }
          p = vend;
        }
      }
      pos = cend;
    }
    return cues;
  }

  function bytesToHex(buf, start, end) {
    var s = '';
    for (var i = start; i < end; i++) { var h = buf[i].toString(16).toUpperCase(); s += h.length < 2 ? '0' + h : h; }
    return s;
  }

  var TIMECODE = 0xE7, BLOCKGROUP = 0xA0, BLOCK = 0xA1, SIMPLEBLOCK = 0xA3, BLOCKDURATION = 0x9B;
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  // Some releases tag an S_TEXT/UTF8 track as plain SRT, but the text still carries ASS
  // override codes like {\an8} (position), {\pos(x,y)}, etc. -- strip them rather than
  // display the literal markup.
  var ASS_OVERRIDE = /\{\\[^}]*\}/g;
  function utf8Decode(buf, start, end) {
    var slice = buf.subarray ? buf.subarray(start, end) : buf.slice(start, end);
    var s = decoder ? decoder.decode(slice) : '';
    if (!decoder) for (var i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return s.replace(ASS_OVERRIDE, '');
  }
  // A Block/SimpleBlock's own content: track number as a size-style vint (marker bits
  // stripped, same rule as an element size -- NOT an element ID), then a 2-byte signed
  // big-endian relative timecode, then one flags byte.  Bits 1-2 (0x06) of the flags
  // byte are the lacing type; 0 means unlaced.  Returns null for a laced block.
  function readBlockHeader(buf, start, end) {
    var tv = readVint(buf, start);
    if (tv.value === null || tv.next + 3 > end) return null;
    var hi = buf[tv.next], lo = buf[tv.next + 1];
    var rel = (hi << 8) | lo;
    if (rel & 0x8000) rel -= 0x10000;
    var flags = buf[tv.next + 2];
    if (flags & 0x06) return null; // laced; not supported
    return { track: tv.value, relTimecode: rel, payloadStart: tv.next + 3 };
  }

  function readClusterBlocks(buf, offset, end, trackNumber, timecodeScale) {
    var cues = [];
    var clusterTimecode = 0;
    var pos = offset;
    while (pos < end) {
      var idr = readId(buf, pos);
      if (idr.value === null) break;
      var sz = readVint(buf, idr.next);
      if (sz.value === null) break;
      var cstart = sz.next, cend = Math.min(cstart + sz.value, end);
      if (idr.value === TIMECODE) {
        clusterTimecode = bytesToUint(buf, cstart, cend);
      } else if (idr.value === SIMPLEBLOCK) {
        var hdr = readBlockHeader(buf, cstart, cend);
        if (hdr && hdr.track === trackNumber) {
          var startSec = (clusterTimecode + hdr.relTimecode) * timecodeScale / 1e9;
          cues.push({ startSec: startSec, endSec: startSec + 2, text: utf8Decode(buf, hdr.payloadStart, cend) });
        }
      } else if (idr.value === BLOCKGROUP) {
        var blockHdr = null, blockEnd = 0, duration = null;
        var p = cstart;
        while (p < cend) {
          var cidr = readId(buf, p);
          if (cidr.value === null) break;
          var csz = readVint(buf, cidr.next);
          if (csz.value === null) break;
          var vstart = csz.next, vend = Math.min(vstart + csz.value, cend);
          if (cidr.value === BLOCK) { blockHdr = readBlockHeader(buf, vstart, vend); blockEnd = vend; }
          else if (cidr.value === BLOCKDURATION) duration = bytesToUint(buf, vstart, vend);
          p = vend;
        }
        if (blockHdr && blockHdr.track === trackNumber) {
          var bStart = (clusterTimecode + blockHdr.relTimecode) * timecodeScale / 1e9;
          var bEnd = duration !== null ? bStart + duration * timecodeScale / 1e9 : bStart + 2;
          cues.push({ startSec: bStart, endSec: bEnd, text: utf8Decode(buf, blockHdr.payloadStart, blockEnd) });
        }
      }
      pos = cend;
    }
    return cues;
  }

  // ---- extract(): network orchestration, ties the readers above to a <video> ----
  var SEGMENT = 0x18538067, INFO = 0x1549A966, TIMECODESCALE = 0x2AD7B1, TRACKS_EL = 0x1654AE6B, SEEKHEAD = 0x114D9B74;

  // Finds the first direct child of the given type within [offset, end); returns its
  // content bounds, or null.  Used for the one-off lookups extract() needs (Segment's
  // Tracks/SeekHead/Info, Info's TimecodeScale) -- not exported, every reader above
  // already takes its own pre-bounded content.
  function findChild(buf, offset, end, wantId) {
    var pos = offset;
    while (pos < end) {
      var idr = readId(buf, pos);
      if (idr.value === null) break;
      var sz = readVint(buf, idr.next);
      if (sz.value === null) break;
      var cstart = sz.next, cend = Math.min(cstart + sz.value, end);
      if (idr.value === wantId) return { start: cstart, end: cend };
      pos = cend;
    }
    return null;
  }

  // Reconnects restart extraction from scratch, and a resumed/seeked movie can be far
  // into the file -- fetching clusters in file-chronological order would mean subtitles
  // near "now" only show up after crawling through everything before them.  Order by
  // distance from the current playback position instead, nearest first, so whatever's
  // about to be seen populates before anything else.  Dedupes (several cues can share
  // one cluster), keeping each cluster's first (nearest) occurrence.
  function clusterFetchOrder(perTrackCues, currentTimeSec, segmentDataStart) {
    var best = {}; // absolute cluster offset -> smallest distance seen for it
    for (var i = 0; i < perTrackCues.length; i++) {
      var cues = perTrackCues[i].cues;
      for (var j = 0; j < cues.length; j++) {
        var abs = segmentDataStart + cues[j].clusterPos;
        var dist = Math.abs(cues[j].timeSec - currentTimeSec);
        if (!(abs in best) || dist < best[abs]) best[abs] = dist;
      }
    }
    var offsets = [];
    for (var key in best) offsets.push(+key);
    offsets.sort(function (a, b) { return best[a] - best[b]; });
    return offsets;
  }

  // MKV Language tags are raw codes ('dut', 'nl', 'nld' all mean Dutch) -- U.lang()
  // normalizes any of them to the 2-letter code; this looks up the display name the
  // same way settings.js's local langName() does for the same U.LANGS table.
  function langDisplayName(code) {
    if (!code || typeof U === 'undefined' || !U.LANGS) return '';
    for (var i = 0; i < U.LANGS.length; i++) if (U.LANGS[i][0] === code) return U.LANGS[i][1];
    return '';
  }

  // Walk element headers and skip media payloads by their declared size. A cluster
  // commonly contains megabytes of video for only a few bytes of subtitle text.
  function readSparseCluster(range, off, trackNumbers, scale, positions) {
    var cache = null, cacheStart = 0, clusterEnd, stamp = 0, found = [];
    function read(pos, size) {
      if (size > 65536) return Promise.reject(new Error('oversized subtitle element'));
      if (cache && pos >= cacheStart && pos + size <= cacheStart + cache.length)
        return Promise.resolve(cache.subarray(pos - cacheStart, pos - cacheStart + size));
      return range(pos, Math.min(pos + Math.max(size, 4096) - 1, clusterEnd === undefined ? off + 15 : clusterEnd - 1)).then(function (buf) {
        cache = buf; cacheStart = pos;
        if (buf.length < size) throw new Error('truncated cluster');
        return buf.subarray(0, size);
      });
    }
    function header(pos, end) {
      return read(pos, Math.min(12, end - pos)).then(function (buf) {
        var id = readId(buf, 0), sz = readVint(buf, id.next);
        var start = pos + sz.next, stop = start + sz.value;
        if (id.value === null || sz.value === null || stop > end || stop <= pos) throw new Error('invalid cluster element');
        return { id: id.value, start: start, end: stop };
      });
    }
    function block(h) {
      return read(h.start, Math.min(12, h.end - h.start)).then(function (buf) {
        var bh = readBlockHeader(buf, 0, buf.length);
        if (!bh || trackNumbers.indexOf(bh.track) < 0) return null;
        return read(h.start, h.end - h.start).then(function (body) {
          return { track: bh.track, rel: bh.relTimecode, text: utf8Decode(body, bh.payloadStart, body.length) };
        });
      });
    }
    function group(pos, end, result) {
      if (pos >= end) return Promise.resolve(result);
      return header(pos, end).then(function (h) {
        var work = Promise.resolve();
        if (h.id === BLOCK) work = block(h).then(function (b) { result.block = b; });
        else if (h.id === BLOCKDURATION) work = read(h.start, h.end - h.start).then(function (b) { result.duration = bytesToUint(b, 0, b.length); });
        return work.then(function () { return group(h.end, end, result); });
      });
    }
    function walk(pos) {
      if (pos >= clusterEnd) return Promise.resolve();
      return header(pos, clusterEnd).then(function (h) {
        var work = Promise.resolve();
        if (h.id === TIMECODE) work = read(h.start, h.end - h.start).then(function (b) { stamp = bytesToUint(b, 0, b.length); });
        else if (h.id === SIMPLEBLOCK) work = block(h).then(function (b) { if (b) found.push({ block: b }); });
        else if (h.id === BLOCKGROUP) work = group(h.start, h.end, {}).then(function (g) { if (g.block) found.push(g); });
        return work.then(function () { return walk(h.end); });
      });
    }
    return range(off, off + 15).then(function (buf) {
      var id = readId(buf, 0), sz = readVint(buf, id.next);
      if (id.value !== 0x1F43B675 || sz.value === null || sz.value > 64 * 1024 * 1024) throw new Error('invalid cluster');
      clusterEnd = off + sz.next + sz.value;
      var contentStart = off + sz.next;
      if (!positions || !positions.length) return walk(contentStart);
      // CueRelativePosition addresses the BlockGroup/SimpleBlock from the start
      // of the Cluster payload. With it we need no intervening media headers.
      function timestamp(pos) {
        if (pos >= clusterEnd) throw new Error('missing cluster timestamp');
        return header(pos, clusterEnd).then(function (h) {
          if (h.id !== TIMECODE) return timestamp(h.end);
          return read(h.start, h.end - h.start).then(function (b) { stamp = bytesToUint(b, 0, b.length); });
        });
      }
      var chain = timestamp(contentStart);
      positions.forEach(function (pos) {
        chain = chain.then(function () {
          if (pos < 0 || contentStart + pos >= clusterEnd) throw new Error('invalid cue position');
          return header(contentStart + pos, clusterEnd).then(function (h) {
            if (h.id === BLOCKGROUP) return group(h.start, h.end, {}).then(function (g) { if (g.block) found.push(g); });
            if (h.id === SIMPLEBLOCK) return block(h).then(function (b) { if (b) found.push({ block: b }); });
            throw new Error('cue does not address a block');
          });
        });
      });
      return chain;
    }).then(function () {
      return found.map(function (g) {
        var start = (stamp + g.block.rel) * scale / 1e9;
        return { track: g.block.track, startSec: start, endSec: start + (g.duration === undefined ? 2 : g.duration * scale / 1e9), text: g.block.text };
      });
    });
  }

  // Discover the small track/index metadata immediately; only cue reads wait for
  // playback buffer. Keep the delay override for tests and diagnostics.
  var startupDelayMs = 0;

  // Extracted cues live longer than one playback instance. Reconnects tear down the
  // engine and call extract() afresh; retain cues so they do not disappear and get
  // fetched again on each reconnect. Keyed by
  // the file URL: { tracks: [{label, srclang}], cues: [[{s,e,text}]...] (per track),
  // fetched: {absClusterOffset: true}, done: bool }.  Cues replay instantly on reconnect
  // and only not-yet-fetched clusters are requested, so extraction converges rather than
  // restarting, and the provider sees far fewer requests overall.
  var subCache = {};

  function extract(url, video, onResolved) {
    if (!/\.mkv(\?|#|$)/i.test(url)) { if (onResolved) onResolved(url); return { cancel: function () {} }; }
    var cancelled = false, started = false;
    function startVideo(resolved) { if (!cancelled && !started && onResolved) { started = true; onResolved(resolved); } }
    video._mkvSubsState = 'discovering';
    var overlay = null, lastText = '';
    if (video.parentNode && video.style) {
      overlay = document.createElement('div');
      overlay.className = 'mkv-captions';
      video.parentNode.appendChild(overlay);
    }
    function paint() {
      if (!overlay || cancelled) return;
      var lines = [], selected = false;
      for (var a = 0; a < liveTracks.length; a++) {
        if (liveTracks[a].mode !== 'showing') continue;
        selected = true;
        var list = rec && rec.cues[a] || [];
        for (var b = 0; b < list.length; b++) {
          if (list[b].s <= video.currentTime && list[b].e > video.currentTime)
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
    var activeRequest = null, gateTimer = null, rejectGate = null, pump = null;
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
              finish(new Error('invalid range response')); xhr.abort();
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
    function onWaiting() {
      if (activeRequest) { activeRequest.yieldToPlayback = true; activeRequest.abort(); }
    }
    function onTime() { paint(); if (pump) pump(); }
    if (video.addEventListener) { video.addEventListener('timeupdate', onTime); video.addEventListener('waiting', onWaiting); }
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('change', paint);
    var rec = subCache[url];
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
      }
    }

    // Fast path: this file was (at least partly) extracted before.  Re-attach its tracks
    // and replay its cues synchronously -- no network, no await -- so a reconnect shows
    // subtitles instantly instead of blanking them.
    if (rec && rec.tracks.length) { ensureTracks(rec.tracks); replayCached(rec); }
    if (rec && rec.tracks.length) { video._mkvSubsState = 'ready'; paint(); }
    if (rec && rec.done && !onResolved) return cancelHandle();   // fully cached: nothing left to fetch

    var timer = setTimeout(function () { if (!cancelled) runExtraction(); }, startupDelayMs);

    function runExtraction() {
    fetchRange(wrapped, 0, 262143, true).then(function (head) {
      if (cancelled) return;
      startVideo(wrapped);
      if (rec) rec.resolved = wrapped;
      if (rec && rec.done) return;
      if (head.length < 4 || head[0] !== 0x1A || head[1] !== 0x45 || head[2] !== 0xDF || head[3] !== 0xA3) return;
      var seg = findChild(head, 0, head.length, SEGMENT);
      if (!seg) return;
      var segmentDataStart = seg.start;
      var tracksChild = findChild(head, seg.start, seg.end, TRACKS_EL);
      if (!tracksChild) return;
      var allTracks = readTracks(head, tracksChild.start, tracksChild.end);
      var subTracks = [];
      for (var i = 0; i < allTracks.length; i++) if (allTracks[i].type === 17 && allTracks[i].codecId === 'S_TEXT/UTF8') subTracks.push(allTracks[i]);
      if (!subTracks.length) return;
      var seekChild = findChild(head, seg.start, seg.end, SEEKHEAD);
      if (!seekChild) return;
      var seekMap = readSeekHead(head, seekChild.start, seekChild.end);
      var cuesRel = seekMap['1C53BB6B'];
      if (cuesRel === undefined) return;
      var timecodeScale = 1000000;
      var infoChild = findChild(head, seg.start, seg.end, INFO);
      if (infoChild) {
        var tcChild = findChild(head, infoChild.start, infoChild.end, TIMECODESCALE);
        if (tcChild) timecodeScale = bytesToUint(head, tcChild.start, tcChild.end);
      }
      if (cancelled) return;
      var cuesAbs = segmentDataStart + cuesRel;
      return fetchRange(wrapped, cuesAbs, cuesAbs + 15, true).then(function (peek) {
        var id = readId(peek, 0), size = readVint(peek, id.next);
        if (id.value !== 0x1C53BB6B || size.value === null || size.value > 1048576) throw new Error('invalid Cues');
        return fetchRange(wrapped, cuesAbs, cuesAbs + size.next + size.value - 1, true);
      }).then(function (cuesBuf) {
        if (cancelled) return;
        // The fetched range starts exactly at the Cues element itself; peel its own
        // id+size header before handing its content to readCuesForTrack, same as every
        // other reader above expects content bounds, not an element including its header.
        var cuesIdr = readId(cuesBuf, 0);
        if (cuesIdr.value === null) return;
        var cuesSz = readVint(cuesBuf, cuesIdr.next);
        if (cuesSz.value === null) return;
        var cuesContentStart = cuesSz.next, cuesContentEnd = Math.min(cuesContentStart + cuesSz.value, cuesBuf.length);
        var perTrackCues = [];
        for (var j = 0; j < subTracks.length; j++) {
          var trk = subTracks[j];
          var trkCues = readCuesForTrack(cuesBuf, cuesContentStart, cuesContentEnd, trk.number, timecodeScale);
          if (trkCues.length) perTrackCues.push({ track: trk, cues: trkCues });
        }
        if (!perTrackCues.length) return;

        // Create (or reuse) this URL's cache record, then attach tracks if not already.
        if (!rec) {
          var meta = [];
          for (var k = 0; k < perTrackCues.length; k++) {
            var langCode = (typeof U !== 'undefined' && U.lang) ? U.lang(perTrackCues[k].track.language) : '';
            meta.push({ label: langDisplayName(langCode) || ('Subtitle track ' + (k + 1)), srclang: langCode || '' });
          }
          rec = subCache[url] = { tracks: meta, cues: meta.map(function () { return []; }), fetched: {}, done: false };
        }
        rec.resolved = wrapped;
        ensureTracks(rec.tracks);
        video._mkvSubsState = 'ready';
        if (cancelled) return;

        var busy = false;
        pump = function () {
          if (cancelled || busy || !hasBuffer()) return;
          var now = video.currentTime || 0;
          var nearby = perTrackCues.map(function (t) {
            return { cues: t.cues.filter(function (c) { return c.timeSec >= now - 30 && c.timeSec <= now + 60; }) };
          });
          var offsets = clusterFetchOrder(nearby, now, segmentDataStart).filter(function (o) { return !rec.fetched[o]; });
          if (!offsets.length) {
            rec.done = clusterFetchOrder(perTrackCues, now, segmentDataStart).every(function (o) { return rec.fetched[o]; });
            return;
          }
          busy = true;
          var off = offsets[0], positions = [], indexed = true;
          perTrackCues.forEach(function (t) { t.cues.forEach(function (c) {
            if (segmentDataStart + c.clusterPos !== off) return;
            if (c.relativePos === undefined) indexed = false;
            else if (positions.indexOf(c.relativePos) < 0) positions.push(c.relativePos);
          }); });
          readSparseCluster(function (start, end) { return fetchRange(wrapped, start, end); }, off,
            perTrackCues.map(function (t) { return t.track.number; }), timecodeScale, indexed ? positions : null).then(function (found) {
            if (cancelled) return;
            for (var a = 0; a < perTrackCues.length; a++) {
              for (var f = 0; f < found.length; f++) {
                if (found[f].track !== perTrackCues[a].track.number) continue;
                liveTracks[a].addCue(new VTTCue(found[f].startSec, found[f].endSec, found[f].text));
                rec.cues[a].push({ s: found[f].startSec, e: found[f].endSec, text: found[f].text });
              }
            }
            rec.fetched[off] = true;
            busy = false;
            paint();
            pump();
          }).catch(function (e) { busy = false; pump = null; if (!cancelled) { video._mkvSubsState = 'error'; Log.warn('mkvsubs', 'Subtitle read failed: ' + e.message); } });
        };
        pump();
      });
    }).then(function () { startVideo(wrapped); if (!cancelled && video._mkvSubsState === 'discovering') video._mkvSubsState = 'unavailable'; }).catch(function (e) {
      startVideo(url);
      if (!cancelled) video._mkvSubsState = 'error';
      if (typeof Log !== 'undefined' && Log.debug) Log.debug('mkvsubs', 'giving up: ' + (e && e.message));
    });
    }

    function cancelHandle() {
      return { cancel: function () {
        if (rec && liveTracks.length) rec.modes = liveTracks.map(function (t) { return t.mode; });
        cancelled = true;
        clearTimeout(timer);
        clearTimeout(gateTimer);
        if (rejectGate) { rejectGate(new Error('cancelled')); rejectGate = null; }
        if (activeRequest) activeRequest.abort();
        if (video.removeEventListener) { video.removeEventListener('timeupdate', onTime); video.removeEventListener('waiting', onWaiting); }
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

  return {
    readVint: readVint,
    readId: readId,
    readTracks: readTracks,
    readSeekHead: readSeekHead,
    readCuesForTrack: readCuesForTrack,
    readClusterBlocks: readClusterBlocks,
    readSparseCluster: readSparseCluster,
    clusterFetchOrder: clusterFetchOrder,
    extract: extract,
    get startupDelayMs() { return startupDelayMs; },
    set startupDelayMs(v) { startupDelayMs = v; }
  };
})();
