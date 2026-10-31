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
            var track = null, clusterPos = null;
            var q = vstart;
            while (q < vend) {
              var qidr = readId(buf, q);
              if (qidr.value === null) break;
              var qsz = readVint(buf, qidr.next);
              if (qsz.value === null) break;
              var qvstart = qsz.next, qvend = Math.min(qvstart + qsz.value, vend);
              if (qidr.value === CUETRACK) track = bytesToUint(buf, qvstart, qvend);
              else if (qidr.value === CUECLUSTERPOSITION) clusterPos = bytesToUint(buf, qvstart, qvend);
              q = qvend;
            }
            if (track === trackNumber && clusterPos !== null) cues.push({ timeSec: cueTime * timecodeScale / 1e9, clusterPos: clusterPos });
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

  function fetchRange(url, start, end) {
    return fetch(url, { headers: { Range: 'bytes=' + start + '-' + end } }).then(function (r) {
      if (!r.ok && r.status !== 206) throw new Error('bad range response ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) { return new Uint8Array(ab); });
  }

  // Right after a (re)connect is the worst moment for extraction to start its own
  // requests to the same host: the video's own connection is still establishing and
  // has no cushion yet.  Give it a head start before competing for the connection pool.
  var startupDelayMs = 3000;

  // Extracted cues live longer than one playback instance.  A flaky provider cuts the
  // stream every ~40s, and each cut tears down the engine and calls extract() afresh --
  // without this cache every cut would wipe all subtitles and re-fetch them from zero
  // (the "subtitles vanish on every buffer, then slowly come back" symptom).  Keyed by
  // the file URL: { tracks: [{label, srclang}], cues: [[{s,e,text}]...] (per track),
  // fetched: {absClusterOffset: true}, done: bool }.  Cues replay instantly on reconnect
  // and only not-yet-fetched clusters are requested, so extraction converges rather than
  // restarting, and the provider sees far fewer requests overall.
  var subCache = {};

  function extract(url, video) {
    if (!/\.mkv(\?|#|$)/i.test(url)) return { cancel: function () {} };
    var cancelled = false;
    var addedEls = [];        // <track> elements this call appended, so cancel() can undo them
    var liveTracks = [];      // the live TextTrack per track index, parallel to a rec's tracks/cues
    var wrapped = Net.wrap(url);
    var rec = subCache[url];

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
    if (rec && rec.done) return cancelHandle();   // fully cached: nothing left to fetch

    var timer = setTimeout(function () { if (!cancelled) runExtraction(); }, startupDelayMs);

    function runExtraction() {
    fetchRange(wrapped, 0, 262143).then(function (head) {
      if (cancelled) return;
      if (head.length < 4 || head[0] !== 0x1A || head[1] !== 0x45 || head[2] !== 0xDF || head[3] !== 0xA3) return;
      var seg = findChild(head, 0, head.length, SEGMENT);
      if (!seg) return;
      var segmentDataStart = seg.start;
      var tracksChild = findChild(head, seg.start, seg.end, TRACKS_EL);
      if (!tracksChild) return;
      var allTracks = readTracks(head, tracksChild.start, tracksChild.end);
      var subTracks = [];
      for (var i = 0; i < allTracks.length; i++) if (allTracks[i].type === 17) subTracks.push(allTracks[i]);
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
      return fetchRange(wrapped, cuesAbs, cuesAbs + 1048575).then(function (cuesBuf) {
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
        ensureTracks(rec.tracks);
        if (cancelled) return;

        var offsets = clusterFetchOrder(perTrackCues, video.currentTime || 0, segmentDataStart);
        var pending = 0;
        var chain = Promise.resolve();
        offsets.forEach(function (off) {
          if (rec.fetched[off]) return;           // already fetched (this instance or a prior one): skip
          pending++;
          chain = chain.then(function () {
            if (cancelled || rec.fetched[off]) return;
            return fetchRange(wrapped, off, off + 15).then(function (peek) {
              if (cancelled) return;
              var idr = readId(peek, 0);
              if (idr.value === null) return;
              var sz = readVint(peek, idr.next);
              if (sz.value === null) return;
              var headerLen = sz.next;
              return fetchRange(wrapped, off, off + headerLen + sz.value - 1).then(function (clusterBuf) {
                if (cancelled) return;
                rec.fetched[off] = true;
                for (var a = 0; a < perTrackCues.length; a++) {
                  var trackNumber = perTrackCues[a].track.number;
                  var found = readClusterBlocks(clusterBuf, headerLen, clusterBuf.length, trackNumber, timecodeScale);
                  for (var f = 0; f < found.length; f++) {
                    if (cancelled) return;
                    liveTracks[a].addCue(new VTTCue(found[f].startSec, found[f].endSec, found[f].text));
                    rec.cues[a].push({ s: found[f].startSec, e: found[f].endSec, text: found[f].text });
                  }
                }
              });
            });
          });
        });
        return chain.then(function () { if (!cancelled && !pending) rec.done = true; else if (!cancelled) { rec.done = offsets.every(function (o) { return rec.fetched[o]; }); } });
      });
    }).catch(function (e) {
      if (typeof Log !== 'undefined' && Log.debug) Log.debug('mkvsubs', 'giving up: ' + (e && e.message));
    });
    }

    function cancelHandle() {
      return { cancel: function () {
        cancelled = true;
        clearTimeout(timer);
        for (var i = 0; i < addedEls.length; i++) { try { video.removeChild(addedEls[i]); } catch (e) {} }
        addedEls.length = 0;
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
    clusterFetchOrder: clusterFetchOrder,
    extract: extract,
    get startupDelayMs() { return startupDelayMs; },
    set startupDelayMs(v) { startupDelayMs = v; }
  };
})();
