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
  function utf8Decode(buf, start, end) {
    var slice = buf.subarray ? buf.subarray(start, end) : buf.slice(start, end);
    if (decoder) return decoder.decode(slice);
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return s;
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

  function fetchRange(url, start, end) {
    return fetch(url, { headers: { Range: 'bytes=' + start + '-' + end } }).then(function (r) {
      if (!r.ok && r.status !== 206) throw new Error('bad range response ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) { return new Uint8Array(ab); });
  }

  function extract(url, video) {
    if (!/\.mkv(\?|#|$)/i.test(url)) return { cancel: function () {} };
    var cancelled = false;
    var wrapped = Net.wrap(url);

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

        var attached = [];
        for (var k = 0; k < perTrackCues.length; k++) {
          var entry = perTrackCues[k];
          var trackEl = document.createElement('track');
          trackEl.kind = 'subtitles';
          trackEl.label = entry.track.language || ('Subtitle track ' + (k + 1));
          trackEl.srclang = entry.track.language || '';
          video.appendChild(trackEl);
          attached.push({ textTrack: trackEl.track });
        }
        if (cancelled) return;

        var offsetSet = {};
        for (var m = 0; m < perTrackCues.length; m++) {
          var mcues = perTrackCues[m].cues;
          for (var n = 0; n < mcues.length; n++) offsetSet[segmentDataStart + mcues[n].clusterPos] = true;
        }
        var offsets = [];
        for (var key in offsetSet) offsets.push(+key);

        var chain = Promise.resolve();
        offsets.forEach(function (off) {
          chain = chain.then(function () {
            if (cancelled) return;
            return fetchRange(wrapped, off, off + 15).then(function (peek) {
              if (cancelled) return;
              var idr = readId(peek, 0);
              if (idr.value === null) return;
              var sz = readVint(peek, idr.next);
              if (sz.value === null) return;
              var headerLen = sz.next;
              return fetchRange(wrapped, off, off + headerLen + sz.value - 1).then(function (clusterBuf) {
                if (cancelled) return;
                for (var a = 0; a < attached.length; a++) {
                  var trackNumber = perTrackCues[a].track.number;
                  var found = readClusterBlocks(clusterBuf, headerLen, clusterBuf.length, trackNumber, timecodeScale);
                  for (var f = 0; f < found.length; f++) {
                    if (cancelled) return;
                    attached[a].textTrack.addCue(new VTTCue(found[f].startSec, found[f].endSec, found[f].text));
                  }
                }
              });
            });
          });
        });
        return chain;
      });
    }).catch(function (e) {
      if (typeof Log !== 'undefined' && Log.debug) Log.debug('mkvsubs', 'giving up: ' + (e && e.message));
    });

    return { cancel: function () { cancelled = true; } };
  }

  return {
    readVint: readVint,
    readId: readId,
    readTracks: readTracks,
    readSeekHead: readSeekHead,
    readCuesForTrack: readCuesForTrack,
    readClusterBlocks: readClusterBlocks,
    extract: extract
  };
})();
