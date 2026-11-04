/* Embedded text subtitles in MKV movies/series: the MKV reader.  The native engine's <video>
   decodes an MKV's video/audio fine but never exposes its embedded subtitle tracks
   through video.textTracks -- that's a near-universal limitation of browser <video>
   elements, not a webOS quirk.  This reads just enough of the MKV container itself
   (Tracks, then SeekHead -> Cues -> the handful of Clusters a subtitle track's cues
   actually live in) to pull the subtitle text out.  EmbedSubs (embedsubs.js) does the
   HTTP Range reads, the cache, the <track>s and the overlay, so the app's existing subtitle
   UI (auto-on, the in-player Subtitles menu) works on its own.  SRT, ASS/SSA and WebVTT as
   plain text; if a file's Cues doesn't index its subtitle track, this gives up rather than
   scanning the file. */
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
        var t = { number: 0, type: 0, codecId: '', language: 'eng', name: '', forced: false }, languageBCP47 = '';
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
          else if (cidr.value === 0x22B59D) languageBCP47 = bytesToAscii(buf, vstart, vend);
          else if (cidr.value === 0x536E) t.name = utf8Decode(buf, vstart, vend);
          else if (cidr.value === FLAGFORCED) t.forced = bytesToUint(buf, vstart, vend) !== 0;
          p = vend;
        }
        if (languageBCP47) t.language = languageBCP47;
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
            var track = null, clusterPos = null, relativePos = null, duration = null;
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
              else if (qidr.value === 0xB2) duration = bytesToUint(buf, qvstart, qvend);   // CueDuration
              q = qvend;
            }
            if (track === trackNumber && clusterPos !== null) {
              var cue = { timeSec: cueTime * timecodeScale / 1e9, clusterPos: clusterPos };
              if (relativePos !== null) cue.relativePos = relativePos;
              if (duration !== null) cue.endSec = (cueTime + duration) * timecodeScale / 1e9;
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
  // Some releases tag an S_TEXT/UTF8 track as plain SRT, but the text still carries ASS
  // override codes like {\an8} (position), {\pos(x,y)}, etc. -- strip them rather than
  // display the literal markup.
  var ASS_OVERRIDE = /\{\\[^}]*\}/g;
  function utf8Decode(buf, start, end, raw) {
    var s = EmbedSubs.utf8(buf, start, end);    // TextDecoder, or a complete fallback without it
    return raw ? s : s.replace(ASS_OVERRIDE, '');
  }
  // Matroska ASS/SSA blocks contain eight comma-separated metadata fields, then text
  // (which may itself contain commas).  Timing comes from the block, not Dialogue lines.
  function subtitleText(text, codec) {
    if (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA') {
      var at = 0;
      for (var i = 0; i < 8; i++) { at = text.indexOf(',', at); if (at < 0) return ''; at++; }
      var drawing = false, plain = '';
      text.slice(at).replace(/\{[^}]*\}|[^{}]+|[{}]/g, function (part) {
        if (part.charAt(0) === '{' && part.charAt(part.length - 1) === '}') {
          var re = /\\p(\d+)(?=\\|\s|\}|$)/g, m;
          while ((m = re.exec(part))) drawing = +m[1] > 0;
        } else if (!drawing) plain += part;
        return part;
      });
      text = plain.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, '\u00a0');
    } else text = text.replace(ASS_OVERRIDE, '');
    // The TV overlay draws textContent.  Strip cue markup and decode only text entities,
    // so voice names, styles and timestamps never become visible words or HTML.
    return text.replace(/<\/?(?:b|i|u|font|v|c|lang|ruby|rt)(?=[\s.>])[^>]*>|<(?:\d+:)?\d{2}:\d{2}\.\d{3}>/gi, '').replace(/&(?:amp|lt|gt|nbsp|quot|apos);/g, function (s) {
      return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0', '&quot;': '"', '&apos;': "'" }[s];
    });
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

  // ---- discovery: the one-off lookups in the file's first bytes ----
  var SEGMENT = 0x18538067, INFO = 0x1549A966, TIMECODESCALE = 0x2AD7B1, TRACKS_EL = 0x1654AE6B, SEEKHEAD = 0x114D9B74;

  // Finds the first direct child of the given type within [offset, end); returns its
  // content bounds, or null.  Used for the one-off lookups discovery needs (Segment's
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
          return { track: bh.track, rel: bh.relTimecode, text: utf8Decode(body, bh.payloadStart, body.length, true) };
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

  // A movie with many languages can have an index larger than 1 MB.  Bound only
  // the index read, independently of file size; never fall back to reading media.
  var MAX_CUES_BYTES = 8 * 1024 * 1024;

  /* ---- the MKV format for EmbedSubs (embedsubs.js runs the network, tracks and overlay) ----
     Index (kept with the file in rec.index): { perTrackCues: [{ track, cues }], timecodeScale,
     segmentDataStart }.  A work item is one Cluster, by its absolute offset; every subtitle track
     with a cue in that Cluster is read from it at once. */
  // Matroska audio codec ids, in the names Caps uses.
  function audioCodec(id) {
    id = String(id || '');
    var map = [[/^A_DTS/, 'dts'], [/^A_TRUEHD/, 'truehd'], [/^A_EAC3/, 'eac3'], [/^A_AC3/, 'ac3'], [/^A_AAC/, 'aac'], [/^A_FLAC/, 'flac'], [/^A_OPUS/, 'opus'], [/^A_MPEG\/L3/, 'mp3'], [/^A_MPEG\/L2/, 'mp2'], [/^A_VORBIS/, 'vorbis']];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(id)) return map[i][1];
    return '';
  }
  var MKV = {
    id: 'mkv',
    headBytes: 262144,
    lazy: true,                         // only the tracks being shown, or Line up's reference, are read
    get startupDelayMs() { return startupDelayMs; },
    discover: function (head, range, rec, alive) {
      if (head.length < 4 || head[0] !== 0x1A || head[1] !== 0x45 || head[2] !== 0xDF || head[3] !== 0xA3) return Promise.resolve(null);
      var seg = findChild(head, 0, head.length, SEGMENT);
      if (!seg) return Promise.resolve(null);
      var segmentDataStart = seg.start;
      var tracksChild = findChild(head, seg.start, seg.end, TRACKS_EL);
      if (!tracksChild) return Promise.resolve(null);
      var allTracks = readTracks(head, tracksChild.start, tracksChild.end);
      // The movie's sound, for the player (player.js heardAudio): DTS or TrueHD the TV can't play gets the converter.
      try { if (typeof Player !== 'undefined' && Player.heardAudio) Player.heardAudio(allTracks.filter(function (t) { return t.type === 2; }).map(function (t) { return audioCodec(t.codecId); }).filter(Boolean)); } catch (e) {}
      var subTracks = [];
      for (var i = 0; i < allTracks.length; i++) if (allTracks[i].type === 17 && /^(S_TEXT\/(UTF8|ASS|SSA|WEBVTT))$/.test(allTracks[i].codecId)) subTracks.push(allTracks[i]);
      if (!subTracks.length) return Promise.resolve(null);
      var seekChild = findChild(head, seg.start, seg.end, SEEKHEAD);
      if (!seekChild) return Promise.resolve(null);
      var seekMap = readSeekHead(head, seekChild.start, seekChild.end);
      var cuesRel = seekMap['1C53BB6B'];
      if (cuesRel === undefined) return Promise.resolve(null);
      var timecodeScale = 1000000;
      var infoChild = findChild(head, seg.start, seg.end, INFO);
      if (infoChild) {
        var tcChild = findChild(head, infoChild.start, infoChild.end, TIMECODESCALE);
        if (tcChild) timecodeScale = bytesToUint(head, tcChild.start, tcChild.end);
      }
      if (!alive()) return Promise.resolve(null);
      var cuesAbs = segmentDataStart + cuesRel;
      return range(cuesAbs, cuesAbs + 15, true).then(function (peek) {
        var id = readId(peek, 0), size = readVint(peek, id.next);
        if (id.value !== 0x1C53BB6B || size.value === null || size.value > MAX_CUES_BYTES) throw new Error('invalid Cues');
        return range(cuesAbs, cuesAbs + size.next + size.value - 1, true);
      }).then(function (cuesBuf) {
        if (!alive()) return null;
        // The fetched range starts exactly at the Cues element itself; peel its own
        // id+size header before handing its content to readCuesForTrack, same as every
        // other reader above expects content bounds, not an element including its header.
        var cuesIdr = readId(cuesBuf, 0);
        if (cuesIdr.value === null) return null;
        var cuesSz = readVint(cuesBuf, cuesIdr.next);
        if (cuesSz.value === null) return null;
        var cuesContentStart = cuesSz.next, cuesContentEnd = Math.min(cuesContentStart + cuesSz.value, cuesBuf.length);
        var perTrackCues = [];
        for (var j = 0; j < subTracks.length; j++) {
          var trk = subTracks[j];
          var trkCues = readCuesForTrack(cuesBuf, cuesContentStart, cuesContentEnd, trk.number, timecodeScale);
          if (trkCues.length) perTrackCues.push({ track: trk, cues: trkCues });
        }
        if (!perTrackCues.length) return null;
        return { perTrackCues: perTrackCues, timecodeScale: timecodeScale, segmentDataStart: segmentDataStart };
      });
    },
    describe: function (index) {
      var meta = [];
      for (var k = 0; k < index.perTrackCues.length; k++) {
        var tr = index.perTrackCues[k].track;
        var langCode = (typeof U !== 'undefined' && U.lang) ? U.lang(tr.language) : '';
        var rawLang = tr.language !== 'und' ? tr.language : '';
        meta.push({ label: String(tr.name || '').slice(0, 60) || langDisplayName(langCode) || rawLang || ('Subtitle track ' + (k + 1)), srclang: langCode || rawLang });
      }
      return meta;
    },
    // Reads the shown tracks' blocks near the playing position (and Line up's window), cluster by
    // cluster, from the file's index.  A file can carry dozens of languages, each with a block in every
    // cluster: reading them all can't keep up with the picture, so a track is read only while it is
    // asked for, as MP4 files are.  Fetched is kept per track and cluster ('track:offset').
    candidates: function (rec, now, ctx) {
      var ix = rec.index, byCluster = {}, items = [];
      for (var i = 0; ctx && i < ix.perTrackCues.length; i++) {
        var want = ctx.demand(i);
        if (!want) continue;
        // The windows are in shown time; the index is in the file's time.
        var tm = ctx.timing(i) || { scale: 1, off: 0, delay: 0 }, scale = tm.scale > 0 ? tm.scale : 1, shift = (tm.off || 0) + (tm.delay || 0);
        var wins = [].concat(want), here = (now - shift) / scale, cues = ix.perTrackCues[i].cues;
        for (var w = 0; w < wins.length; w++) {
          var from = wins[w] === 'now' ? now - 30 : wins[w].from, to = wins[w] === 'now' ? now + 60 : wins[w].to;
          var a = (from - shift) / scale, b = (to - shift) / scale;
          for (var c = 0; c < cues.length; c++) {
            // A line overlapping the window counts (as for MP4), so one still on screen when its track
            // is switched on is read too.  Without a CueDuration only the start is known: a line that
            // started more than 30 s back is then left out (subtitle lines last seconds, not minutes).
            var s0 = cues[c].timeSec, e0 = cues[c].endSec !== undefined ? cues[c].endSec : s0;
            if (e0 < a || s0 > b) continue;
            var abs = ix.segmentDataStart + cues[c].clusterPos, key = i + ':' + abs;
            if (rec.fetched[key]) continue;
            var it = byCluster[abs];
            if (!it) { it = byCluster[abs] = { off: abs, tracks: [], keys: [], dist: Infinity }; items.push(it); }
            if (it.keys.indexOf(key) < 0) { it.keys.push(key); it.tracks.push(i); }
            it.dist = Math.min(it.dist, s0 > here ? s0 - here : e0 < here ? here - e0 : 0);
          }
        }
      }
      items.forEach(function (it) { it.id = it.off + ':' + it.tracks.join(','); });
      return items.sort(function (x, y) { return x.dist - y.dist || x.off - y.off; });
    },
    complete: function (rec) {
      var ix = rec.index;
      return ix.perTrackCues.every(function (t, i) {
        return t.cues.every(function (c) { return rec.fetched[i + ':' + (ix.segmentDataStart + c.clusterPos)]; });
      });
    },
    read: function (rec, item, range, alive) {
      var ix = rec.index, off = item.off, positions = [], indexed = true;
      var perTrackCues = item.tracks.map(function (i) { return ix.perTrackCues[i]; });
      perTrackCues.forEach(function (t) { t.cues.forEach(function (c) {
        if (ix.segmentDataStart + c.clusterPos !== off) return;
        if (c.relativePos === undefined) indexed = false;
        else if (positions.indexOf(c.relativePos) < 0) positions.push(c.relativePos);
      }); });
      return readSparseCluster(range, off, perTrackCues.map(function (t) { return t.track.number; }), ix.timecodeScale, indexed ? positions : null).then(function (found) {
        var out = [];
        if (!alive()) return out;
        for (var a = 0; a < perTrackCues.length; a++) {
          for (var f = 0; f < found.length; f++) {
            if (found[f].track !== perTrackCues[a].track.number) continue;
            var text = subtitleText(found[f].text, perTrackCues[a].track.codecId);
            if (!text.trim()) continue;
            out.push({ track: item.tracks[a], s: found[f].startSec, e: found[f].endSec, text: text });
          }
        }
        return out;
      });
    }
  };

  function extract(url, video, onResolved, container) {
    if (!/\.mkv(\?|#|$)/i.test(url) && !/^mkv$/i.test(container || '')) { if (onResolved) onResolved(url); return { cancel: function () {} }; }
    return EmbedSubs.run(url, video, onResolved, MKV);
  }

  return {
    readVint: readVint,
    readId: readId,
    readTracks: readTracks,
    readSeekHead: readSeekHead,
    readCuesForTrack: readCuesForTrack,
    readClusterBlocks: readClusterBlocks,
    readSparseCluster: readSparseCluster,
    MKV: MKV,
    extract: extract,
    get startupDelayMs() { return startupDelayMs; },
    set startupDelayMs(v) { startupDelayMs = v; }
  };
})();
