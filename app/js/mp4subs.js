/* Mp4Subs: subtitles stored inside MP4 files (3GPP timed text, the 'tx3g' tracks that ffmpeg's
 * mov_text, HandBrake and most MP4 muxers write).  The TV's own player doesn't expose them, so
 * TiviBro reads them itself, the way MkvSubs does for MKV, and hands them to the shared core
 * (EmbedSubs) for Range transport, caching and the overlay.
 *
 * This part reads the file's structure:
 * - box(): one box header (ISO/IEC 14496-12 §4.2): 32-bit size, 64-bit largesize (size 1), or
 *   size 0 (to the end of its parent).  Positions are absolute file offsets; files past 4 GB are
 *   normal, so offsets and sizes are plain numbers checked against Number.MAX_SAFE_INTEGER, never
 *   bit operators.
 * - readTrak(): what a 'trak' says about itself: track header (§8.3.2), media header with its
 *   timescale and packed ISO-639-2/T language (§8.4.2), handler (§8.4.3), the first sample
 *   description (§8.5.2; for tx3g the display flags of 3GPP TS 26.245 §5.16), data references
 *   (§8.7.2), the edit list (§8.6.6), chapter references (tref/chap, §8.3.3) and udta/name.
 * - samples(): each sample's file offset, size and time on the presentation timeline from the
 *   sample tables: stts (§8.6.1.2), ctts (§8.6.1.3), stsc (§8.7.4), stsz (§8.7.3.2) and
 *   stco/co64 (§8.7.5), with the track's own edit list applied.
 *
 * Rejected (the track is left out rather than shown wrong): more than one sample description or
 * a chunk using another one, samples in another file (external dref), compact sample sizes
 * (stz2), tables that disagree on the sample count, more than limits.maxSamples samples, a sample
 * over limits.maxSampleBytes, data past the end of the file, and edit lists other than none or
 * one optional leading empty edit followed by one normal rate-1 edit.  Malformed or truncated
 * boxes give null, never an exception.
 */
var Mp4Subs = (function () {
  var MAX_SAFE = 9007199254740991, TWO32 = 4294967296;

  function u16(b, p) { return b[p] * 256 + b[p + 1]; }
  function u32(b, p) { return b[p] * 16777216 + b[p + 1] * 65536 + b[p + 2] * 256 + b[p + 3]; }
  function i32(b, p) { var v = u32(b, p); return v >= 2147483648 ? v - TWO32 : v; }
  function u64(b, p) {          // NaN when it doesn't fit a safe integer
    var hi = u32(b, p);
    return hi >= 2097152 ? NaN : hi * TWO32 + u32(b, p + 4);
  }
  function fourcc(b, p) { return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); }

  // One box header at absolute file position pos, inside a parent that ends at end.  buf[0] sits at
  // absolute position fileOffset; the header must be in buf, the body needn't be.
  function box(buf, pos, end, fileOffset) {
    var i = pos - (fileOffset || 0);
    if (!(i >= 0) || i + 8 > buf.length || pos + 8 > end) return null;
    var size = u32(buf, i), type = fourcc(buf, i + 4), headerSize = 8;
    if (size === 1) {
      if (i + 16 > buf.length || pos + 16 > end) return null;
      size = u64(buf, i + 8); headerSize = 16;
    } else if (size === 0) size = end - pos;
    if (!(size >= headerSize) || pos + size > end || pos + size > MAX_SAFE) return null;
    return { type: type, start: pos, headerSize: headerSize, size: size, end: pos + size };
  }

  // The child boxes of [start, end) of buf by type (first of each), or null if any is malformed.
  // A few trailing bytes too short for a box are tolerated (QuickTime ends some lists with a zero).
  function children(buf, start, end) {
    var out = {}, p = start;
    while (end - p >= 8) {
      var b = box(buf, p, end, 0);
      if (!b) return null;
      if (!out[b.type]) out[b.type] = b;
      p = b.end;
    }
    return out;
  }
  function body(b) { return b.start + b.headerSize; }
  function fits(b, n) { return body(b) + n <= b.end; }        // the box holds n payload bytes

  // Lists of fixed-size entries after a full box header (and `skip` more bytes): the bounds samples() reads.
  function table(buf, b, skip, entrySize) {
    if (!b || !fits(b, 8 + skip)) return null;
    var p = body(b), count = u32(buf, p + 4 + skip);
    if (count * entrySize > b.end - (p + 8 + skip)) return null;
    return { version: buf[p], p: p, count: count, at: p + 8 + skip };
  }

  function lang(packed) {
    if (packed < 0x400) return 'und';          // a QuickTime Macintosh language code, not ISO 639
    var s = '';
    for (var k = 2; k >= 0; k--) {
      var c = Math.floor(packed / Math.pow(32, k)) % 32;
      if (c < 1 || c > 26) return 'und';
      s += String.fromCharCode(c + 0x60);
    }
    return s;
  }

  // Supported edit lists: none, or one optional leading empty edit plus one normal edit at rate 1.
  // Units as stored: empty and seg in the movie timescale, mediaTime in the track's.
  function readEdits(buf, elst) {
    var v = buf[body(elst)], size = v === 1 ? 20 : 12, t = table(buf, elst, 0, size);
    if (!t) return null;
    var list = [];
    for (var k = 0; k < t.count; k++) {
      var q = t.at + k * size, dur, mt;
      if (v === 1) {
        dur = u64(buf, q);
        mt = u32(buf, q + 8) === 0xFFFFFFFF && u32(buf, q + 12) === 0xFFFFFFFF ? -1 : u64(buf, q + 8);
      } else { dur = u32(buf, q); mt = i32(buf, q + 4); }
      list.push({ dur: dur, mt: mt, rate: i32(buf, q + size - 4) });   // rate: 16.16, 1.0 = 0x10000
    }
    return list;
  }
  function editRule(list) {
    if (!list || !list.length) return { ok: !!list, edit: null };
    var empty = 0, k = 0;
    if (list[0].mt === -1) { empty = list[0].dur; k = 1; }
    var e = list[k];
    if (list.length !== k + 1 || !e || !(e.mt >= 0) || e.rate !== 0x10000 || !(empty >= 0) || !(e.dur >= 0)) return { ok: false, edit: null };
    return { ok: true, edit: { empty: empty, mediaTime: e.mt, seg: e.dur } };
  }

  // TrakInfo for the trak box at [start, end) of buf, or null when it is malformed.
  function readTrak(buf, start, end) {
    var trak = box(buf, start, end, 0);
    if (!trak || trak.type !== 'trak') return null;
    var k = children(buf, body(trak), trak.end);
    if (!k || !k.tkhd || !k.mdia || !fits(k.tkhd, 4)) return null;
    var tv = buf[body(k.tkhd)];
    if (!fits(k.tkhd, tv === 1 ? 24 : 16)) return null;
    var info = {
      id: u32(buf, body(k.tkhd) + (tv === 1 ? 20 : 12)),
      enabled: buf[body(k.tkhd) + 3] % 2 === 1,
      handler: '', format: '', lang: 'und', name: '', displayFlags: 0, mediaTimescale: 0,
      edit: null, editOk: true, chap: [],
      tables: { buf: buf, stts: null, stsc: null, stsz: null, stz2: false, stco: null, co64: null, ctts: null, dref: 'self', stsdCount: 0 }
    };
    var m = children(buf, body(k.mdia), k.mdia.end);
    if (!m || !m.mdhd || !m.hdlr || !fits(m.hdlr, 12) || !fits(m.mdhd, 4)) return null;
    var mv = buf[body(m.mdhd)], mp = body(m.mdhd) + 4;
    if (!fits(m.mdhd, mv === 1 ? 34 : 22)) return null;
    info.mediaTimescale = u32(buf, mp + (mv === 1 ? 16 : 8));
    info.lang = lang(u16(buf, mp + (mv === 1 ? 28 : 16)));
    info.handler = fourcc(buf, body(m.hdlr) + 8);

    if (k.edts) {
      var ed = children(buf, body(k.edts), k.edts.end);
      if (!ed) return null;
      if (ed.elst) {
        var rule = editRule(readEdits(buf, ed.elst));
        info.edit = rule.edit; info.editOk = rule.ok;
      }
    }
    if (k.tref) {
      var tr = children(buf, body(k.tref), k.tref.end);
      if (!tr) return null;
      if (tr.chap) for (var c = body(tr.chap); c + 4 <= tr.chap.end; c += 4) info.chap.push(u32(buf, c));
    }
    if (k.udta) {
      var ud = children(buf, body(k.udta), k.udta.end);
      if (ud && ud.name) info.name = EmbedSubs.utf8(buf, body(ud.name), ud.name.end).replace(/\u0000+$/, '');
    }

    var minf = m.minf && children(buf, body(m.minf), m.minf.end);
    if (m.minf && !minf) return null;
    if (minf && minf.dinf) {
      var di = children(buf, body(minf.dinf), minf.dinf.end);
      if (!di) return null;
      if (di.dref) {
        var dr = table(buf, di.dref, 0, 0);
        var entry = dr && dr.count ? box(buf, dr.at, di.dref.end, 0) : null;
        if (!dr || (dr.count && (!entry || !fits(entry, 4)))) return null;
        if (entry && buf[body(entry) + 3] % 2 !== 1) info.tables.dref = 'external';   // flag 1: data in this file
      }
    }
    var st = minf && minf.stbl && children(buf, body(minf.stbl), minf.stbl.end);
    if (minf && minf.stbl && !st) return null;
    if (st) {
      var T = info.tables;
      if (st.stsd) {
        var sd = table(buf, st.stsd, 0, 0), first = sd && sd.count ? box(buf, sd.at, st.stsd.end, 0) : null;
        if (!sd || (sd.count && !first)) return null;
        T.stsdCount = sd.count;
        if (first) {
          info.format = first.type;
          if (first.type === 'tx3g' && fits(first, 12)) info.displayFlags = u32(buf, body(first) + 8);
        }
      }
      T.stts = st.stts ? table(buf, st.stts, 0, 8) : null;
      T.stsc = st.stsc ? table(buf, st.stsc, 0, 12) : null;
      T.ctts = st.ctts ? table(buf, st.ctts, 0, 8) : null;
      T.stco = st.stco ? table(buf, st.stco, 0, 4) : null;
      T.co64 = st.co64 ? table(buf, st.co64, 0, 8) : null;
      T.stz2 = !!st.stz2;
      if (st.stsz) {
        // [version/flags][sample_size][sample_count][sizes, only when sample_size is 0]
        T.stsz = fits(st.stsz, 12) ? { p: body(st.stsz), fixed: u32(buf, body(st.stsz) + 4), count: u32(buf, body(st.stsz) + 8), at: body(st.stsz) + 12 } : null;
        if (T.stsz && !T.stsz.fixed && T.stsz.count * 4 > st.stsz.end - T.stsz.at) T.stsz = null;
      }
      if ((st.stts && !T.stts) || (st.stsc && !T.stsc) || (st.ctts && !T.ctts) || (st.stco && !T.stco) || (st.co64 && !T.co64) || (st.stsz && !T.stsz)) return null;
    }
    return info;
  }

  // Every sample's offset, size and presentation time in seconds, or null when the tables can't
  // be trusted.  limits = { maxSamples, maxSampleBytes, fileSize }.
  function samples(trak, movieTimescale, limits) {
    var T = trak && trak.tables, chunks = T && (T.stco || T.co64);
    if (!T || !T.stts || !T.stsc || !T.stsz || !chunks || T.stz2 || T.dref !== 'self' || T.stsdCount !== 1) return null;
    var ts = trak.mediaTimescale, edit = trak.edit;
    if (!trak.editOk || !(ts > 0) || (edit && !(movieTimescale > 0))) return null;
    var buf = T.buf, n = T.stsz.count, fileSize = limits.fileSize > 0 ? limits.fileSize : MAX_SAFE;
    if (n > limits.maxSamples || (T.stsz.fixed && T.stsz.fixed > limits.maxSampleBytes)) return null;
    // The counts must agree before anything is allocated.
    var sum = 0, k;
    for (k = 0; k < T.stts.count; k++) { sum += u32(buf, T.stts.at + k * 8); if (sum > n) return null; }
    if (sum !== n) return null;
    if (T.ctts) {
      for (sum = 0, k = 0; k < T.ctts.count; k++) { sum += u32(buf, T.ctts.at + k * 8); if (sum > n) return null; }
      if (sum !== n) return null;
    }
    var nChunks = chunks.count, sc = T.stsc;
    if (!sc.count || u32(buf, sc.at) !== 1) return null;
    for (sum = 0, k = 0; k < sc.count; k++) {
      var q = sc.at + k * 12, firstChunk = u32(buf, q), next = k + 1 < sc.count ? u32(buf, q + 12) : nChunks + 1;
      var perChunk = u32(buf, q + 4);
      if (u32(buf, q + 8) !== 1 || !perChunk || next <= firstChunk || firstChunk > nChunks || next > nChunks + 1) return null;
      sum += (next - firstChunk) * perChunk;
      if (sum > n) return null;
    }
    if (sum !== n) return null;

    var off = new Float64Array(n), size = new Uint32Array(n), s = new Float64Array(n), e = new Float64Array(n);
    // Offsets: chunk by chunk, samples packed one after another inside a chunk.
    var i = 0;
    for (k = 0; k < sc.count; k++) {
      var r = sc.at + k * 12, from = u32(buf, r), to = k + 1 < sc.count ? u32(buf, r + 12) : nChunks + 1, per = u32(buf, r + 4);
      for (var ch = from; ch < to; ch++) {
        var at = T.co64 ? u64(buf, chunks.at + (ch - 1) * 8) : u32(buf, chunks.at + (ch - 1) * 4);
        for (var j = 0; j < per; j++, i++) {
          var sz = T.stsz.fixed || u32(buf, T.stsz.at + i * 4);
          if (sz > limits.maxSampleBytes || !(at >= 0) || at + sz > fileSize) return null;
          off[i] = at; size[i] = sz; at += sz;
        }
      }
    }
    // Times: decode time from stts, plus the ctts offset, then the edit list onto the movie timeline.
    var base = edit ? edit.empty / movieTimescale : 0, shift = edit ? edit.mediaTime : 0;
    var segEnd = edit && edit.seg > 0 ? base + edit.seg / movieTimescale : Infinity;
    var dts = 0, kept = 0, ci = 0, cLeft = T.ctts ? u32(buf, T.ctts.at) : 0;
    i = 0;
    for (k = 0; k < T.stts.count; k++) {
      var count = u32(buf, T.stts.at + k * 8), delta = u32(buf, T.stts.at + k * 8 + 4);
      for (var c = 0; c < count; c++, i++, dts += delta) {
        var cts = dts;
        if (T.ctts) {
          while (!cLeft) { ci++; cLeft = u32(buf, T.ctts.at + ci * 8); }
          cts += i32(buf, T.ctts.at + ci * 8 + 4); cLeft--;
        }
        var start = base + (cts - shift) / ts, stop = start + delta / ts;
        if (start < base) start = base;
        if (stop > segEnd) stop = segEnd;
        if (!(stop > start)) continue;
        off[kept] = off[i]; size[kept] = size[i]; s[kept] = start; e[kept] = stop; kept++;
      }
    }
    if (kept < n) { off = off.subarray(0, kept); size = size.subarray(0, kept); s = s.subarray(0, kept); e = e.subarray(0, kept); }
    return { n: kept, off: off, size: size, s: s, e: e };
  }

  return { box: box, readTrak: readTrak, samples: samples };
})();
