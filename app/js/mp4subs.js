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
 * a chunk using another one, samples not proven to be in this file (the sample entry's data
 * reference must be a self-contained 'url ', or 'alis' in QuickTime files), compact sample sizes
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
      tables: { buf: buf, stts: null, stsc: null, stsz: null, stz2: false, stco: null, co64: null, ctts: null, dref: 'external', stsdCount: 0 }
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
    var refs = null;                  // the data references: [{ type, self }]
    if (minf && minf.dinf) {
      var di = children(buf, body(minf.dinf), minf.dinf.end);
      if (!di) return null;
      if (di.dref) {
        var dr = table(buf, di.dref, 0, 0);
        if (!dr) return null;
        refs = [];
        for (var rp = dr.at, rn = 0; rn < dr.count; rn++) {
          var ref = box(buf, rp, di.dref.end, 0);
          if (!ref || !fits(ref, 4)) return null;
          refs.push({ type: ref.type, self: buf[body(ref) + 3] % 2 === 1 });   // flag 1: the data is in this file
          rp = ref.end;
        }
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
          // The entry names its data reference (1-based).  Only one that says "this file" is read:
          // 'url ' per ISO, or QuickTime's 'alis' in .mov files.  No reference at all is not proof.
          var use = refs && fits(first, 8) ? refs[u16(buf, body(first) + 6) - 1] : null;
          T.dref = use && use.self && (use.type === 'url ' || use.type === 'alis') ? 'self' : 'external';
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
    // Composition offsets are read signed in both versions, as ffmpeg does: old muxers write
    // negative ones in version 0.
    if (T.ctts && T.ctts.version > 1) return null;
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

  // One 3GPP text sample (TS 26.245 §5.17): a 16-bit length, then the text in UTF-8, or UTF-16
  // when it starts with a byte order mark.  Style boxes (styl, hlit...) after the text are ignored.
  function text(buf, start, end) {
    if (end - start < 2) return '';
    var len = u16(buf, start), p = start + 2, stop = p + len, out;
    if (!len || stop > end) return '';
    if (len >= 2 && buf[p] === 0xFE && buf[p + 1] === 0xFF) out = EmbedSubs.utf16(buf, p + 2, stop, false);
    else if (len >= 2 && buf[p] === 0xFF && buf[p + 1] === 0xFE) out = EmbedSubs.utf16(buf, p + 2, stop, true);
    else out = EmbedSubs.utf8(buf, len >= 3 && buf[p] === 0xEF && buf[p + 1] === 0xBB && buf[p + 2] === 0xBF ? p + 3 : p, stop);
    return out.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  }

  // English names for ISO 639-2 codes (both the /B and /T forms), for labels.  U.LANGS stays the
  // short list behind Settings; this one only names tracks.  Unlisted codes show as themselves.
  var LANG_NAMES = Object.create(null);
  (function (rows) {
    for (var i = 0; i < rows.length; i++) {
      var codes = rows[i][0].split(' ');
      for (var j = 0; j < codes.length; j++) LANG_NAMES[codes[j]] = rows[i][1];
    }
  })([['eng', 'English'], ['spa', 'Spanish'], ['por', 'Portuguese'], ['fra fre', 'French'], ['deu ger', 'German'], ['ita', 'Italian'],
    ['nld dut', 'Dutch'], ['pol', 'Polish'], ['ara', 'Arabic'], ['tur', 'Turkish'], ['hin', 'Hindi'], ['rus', 'Russian'], ['ell gre', 'Greek'],
    ['swe', 'Swedish'], ['ron rum', 'Romanian'], ['ukr', 'Ukrainian'], ['heb', 'Hebrew'], ['jpn', 'Japanese'], ['kor', 'Korean'],
    ['zho chi', 'Chinese'], ['bul', 'Bulgarian'], ['dan', 'Danish'], ['est', 'Estonian'], ['fin', 'Finnish'], ['hrv', 'Croatian'],
    ['hun', 'Hungarian'], ['ind', 'Indonesian'], ['nor nob nno', 'Norwegian'], ['srp', 'Serbian'], ['tha', 'Thai'], ['vie', 'Vietnamese'],
    ['ces cze', 'Czech'], ['slk slo', 'Slovak'], ['slv', 'Slovenian'], ['lit', 'Lithuanian'], ['lav', 'Latvian'], ['isl ice', 'Icelandic'],
    ['cat', 'Catalan'], ['eus baq', 'Basque'], ['glg', 'Galician'], ['msa may', 'Malay'], ['fil', 'Filipino'], ['tam', 'Tamil'],
    ['tel', 'Telugu'], ['ben', 'Bengali'], ['urd', 'Urdu'], ['fas per', 'Persian'], ['kat geo', 'Georgian']]);

  var MAX_LABEL = 60;
  // Forced: every sample is forced (display flags bit 0x80000000; Apple also sets 0x40000000,
  // "some samples forced", which alone is an ordinary track).
  function isForced(t) { return t.displayFlags >= 0x80000000; }
  // A track name that only says the language again ("Nederlands" on a Dutch track) adds nothing.
  // U.LANGS also knows regional variants as ways to spell a language; on a track those tell two
  // tracks of one language apart, so they stay.
  var VARIANTS = Object.create(null);
  VARIANTS.latino = VARIANTS.castellano = VARIANTS.mandarin = VARIANTS.cantonese = 1;
  function restates(name, code) {
    var n = name.toLowerCase();
    if (VARIANTS[n]) return false;
    if (n === code || n === String(LANG_NAMES[code] || '').toLowerCase()) return true;
    var two = U.lang(code);
    for (var i = 0; two && i < U.LANGS.length; i++) {
      if (U.LANGS[i][0] !== two) continue;
      for (var j = 0; j < U.LANGS[i].length; j++) if (n === U.LANGS[i][j].toLowerCase()) return true;
    }
    return false;
  }
  function cut(s, n) { return s.length > n ? s.slice(0, n).replace(/\s+$/, '') : s; }

  // The tracks as the menu lists them: { label, srclang, forced, trakIndex } in attach order.
  // Within a language (fre and fra are one), the track the file marks enabled and isn't forced comes
  // first and forced tracks last, so turning subtitles on by language picks an ordinary track; the
  // rest keep file order, and other languages keep their places.
  function describe(traks) {
    var order = traks.map(function (t, i) { return i; }), byLang = Object.create(null);
    order.forEach(function (i) {
      var c = traks[i].lang || 'und', key = U.lang(c) || LANG_NAMES[c] || c;
      (byLang[key] = byLang[key] || []).push(i);
    });
    function rank(i) { return isForced(traks[i]) ? 2 : traks[i].enabled ? 0 : 1; }
    for (var code in byLang) {
      var places = byLang[code], sorted = places.slice().sort(function (a, b) { return rank(a) - rank(b) || a - b; });
      for (var k = 0; k < places.length; k++) order[places[k]] = sorted[k];
    }
    var used = Object.create(null);
    return order.map(function (i, at) {
      var t = traks[i], code = t.lang || 'und', name = String(t.name || '').replace(/^\s+|\s+$/g, '');
      var base = code === 'und' ? name || 'Subtitle track ' + (at + 1)
        : (LANG_NAMES[code] || code) + (name && !restates(name, code) ? ' · ' + name : '');
      var forced = isForced(t), tail = forced ? ' (forced)' : '', label, n = 1;
      // Labels are unique within the file (Subs keys Line up and Timing by label and language).
      do {
        var num = n > 1 ? ' ' + n : '';
        label = cut(base, MAX_LABEL - tail.length - num.length) + tail + num;
        n++;
      } while (used[label]);
      used[label] = true;
      return { label: label, srclang: U.lang(code) || code, forced: forced, trakIndex: i };
    });
  }

  /* ---- the MP4 format for EmbedSubs (embedsubs.js runs the network, tracks and overlay) ----
     Finding the tracks without downloading moov: hop top-level box headers to moov (a few 16-byte
     reads even when it sits at the end of an 18 GB file), walk moov's children by their declared
     sizes, read small tracks whole and big ones (video, audio: megabytes of tables) only as far as
     their handler, then keep the tx3g subtitle tracks.  Every read is counted against the caps
     below; going over gives up on subtitles for the file rather than reading on.
     Index (kept with the file in rec.index): { meta: [{ label, srclang, forced }], tracks: [{ n, off,
     size, s, e }] in attach order, total: samples with text }.  A work item is a run of samples
     close together in the file (across the tracks being shown), read in one request. */
  var HEAD_BYTES = 65536, WINDOW = 65536, RUN_WINDOW = 262144, HEADER_WINDOW = 1024;
  var MAX_REQUESTS = 32, MAX_BYTES = 16 * 1048576, MAX_MS = 20000, MAX_TRAK = 4 * 1048576, MAX_TRACKS = 64;
  var MAX_GAP = 65536, MAX_JOIN = 262144, MAX_SAMPLES = 100000, MAX_SAMPLE_BYTES = 4096;
  var TOP_LEVEL = Object.create(null);
  'ftyp moov mdat free skip wide pdin uuid'.split(' ').forEach(function (t) { TOP_LEVEL[t] = 1; });
  function isSubtitleHandler(h) { return h === 'sbtl' || h === 'subt' || h === 'text'; }
  function capped(why) { var e = new Error(why); e.capped = true; return e; }

  function discover(head, range, rec, alive) {
    var total = isFinite(head.total) ? head.total : head.length < HEAD_BYTES ? head.length : MAX_SAFE;
    var first = box(head, 0, total, 0);
    if (!first || !TOP_LEVEL[first.type]) return Promise.resolve(null);
    var windows = [{ start: 0, bytes: head }], requests = 0, bytes = 0, began = Date.now();
    // Bytes [pos, pos + len) from what was read already, or one read of at least `win` bytes (never
    // past `limit`).  Resolves to { start, bytes } with bytes[0] at absolute position start.
    function get(pos, len, win, limit) {
      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (pos >= w.start && pos + len <= w.start + w.bytes.length) return Promise.resolve(w);
      }
      var end = Math.min(limit, pos + Math.max(len, win));
      if (end < pos + len) return Promise.reject(capped('box past the end of the file'));
      if (++requests > MAX_REQUESTS || (bytes += end - pos) > MAX_BYTES || Date.now() - began > MAX_MS)
        return Promise.reject(capped('the subtitle index is too big to look through'));
      return range(pos, end - 1).then(function (b) {
        if (!alive()) throw new Error('cancelled');
        var got = { start: pos, bytes: b };
        windows.push(got);
        return got;
      });
    }
    function header(pos, end, win) {
      return get(pos, Math.min(16, end - pos), win, end).then(function (w) { return box(w.bytes, pos, end, w.start); });
    }
    // Top level: hop from box to box until moov.
    function toMoov(pos) {
      if (pos + 8 > total) return Promise.resolve(null);
      return header(pos, total, 16).then(function (b) {
        if (!b) return null;
        return b.type === 'moov' ? b : toMoov(b.end);
      });
    }
    // The wanted children of [start, end), by type, reading headers only.
    function kids(start, end, want) {
      var found = {}, left = want.length;
      function step(pos) {
        if (!left || pos + 8 > end) return Promise.resolve(found);
        return header(pos, end, HEADER_WINDOW).then(function (b) {
          if (!b) throw capped('malformed box');
          if (want.indexOf(b.type) >= 0 && !found[b.type]) { found[b.type] = b; left--; }
          return step(b.end);
        });
      }
      return step(start);
    }

    var timescale = 0, candidates = [], chapters = Object.create(null), lastWasSub = false;
    function noteChapters(list) { for (var i = 0; i < list.length; i++) chapters[list[i]] = true; }
    function wholeTrak(t, win, moov) {
      return get(t.start, t.size, win, moov.end).then(function (w) {
        var info = readTrak(w.bytes, t.start - w.start, t.end - w.start);
        if (!info) return;
        noteChapters(info.chap);
        lastWasSub = isSubtitleHandler(info.handler);
        if (lastWasSub && candidates.length < MAX_TRACKS) candidates.push(info);
      });
    }
    // A big track: its handler and chapter references from headers, the whole of it only if it's text.
    function bigTrak(t, moov) {
      lastWasSub = false;
      return kids(t.start + t.headerSize, t.end, ['tref', 'mdia']).then(function (k) {
        var chap = !k.tref || k.tref.size > 4096 ? Promise.resolve() : get(k.tref.start, k.tref.size, 0, k.tref.end).then(function (w) {
          var at = k.tref.start - w.start, c = children(w.bytes, at + k.tref.headerSize, at + k.tref.size);
          if (c && c.chap) for (var q = c.chap.start + c.chap.headerSize; q + 4 <= c.chap.end; q += 4) chapters[u32(w.bytes, q)] = true;
        });
        return chap.then(function () {
          if (!k.mdia) return null;
          return kids(k.mdia.start + k.mdia.headerSize, k.mdia.end, ['hdlr']);
        }).then(function (m) {
          if (!m || !m.hdlr || m.hdlr.size < m.hdlr.headerSize + 12) return null;
          return get(m.hdlr.start, m.hdlr.headerSize + 12, HEADER_WINDOW, m.hdlr.end).then(function (w) {
            var handler = fourcc(w.bytes, m.hdlr.start - w.start + m.hdlr.headerSize + 8);
            if (isSubtitleHandler(handler) && t.size <= MAX_TRAK) return wholeTrak(t, 0, moov);
          });
        });
      });
    }
    function walk(moov, pos) {
      if (!alive()) return Promise.reject(new Error('cancelled'));
      if (pos + 8 > moov.end) return Promise.resolve(true);
      return header(pos, moov.end, HEADER_WINDOW).then(function (b) {
        if (!b) throw capped('malformed box');
        if (b.type === 'mvex') return false;             // fragmented: not supported
        var next;
        if (b.type === 'mvhd') next = get(b.start, b.headerSize + 24, HEADER_WINDOW, b.end).then(function (w) {
          var p = b.start - w.start + b.headerSize;
          timescale = w.bytes[p] === 1 ? u32(w.bytes, p + 20) : u32(w.bytes, p + 12);
        });
        else if (b.type === 'trak') next = b.size <= WINDOW ? wholeTrak(b, lastWasSub ? RUN_WINDOW : WINDOW, moov) : bigTrak(b, moov);
        else next = Promise.resolve();
        return next.then(function () { return walk(moov, b.end); });
      });
    }

    return toMoov(0).then(function (moov) {
      if (!moov) throw capped('no movie header');
      return walk(moov, moov.start + moov.headerSize);
    }).then(function (whole) {
      if (!whole) { Log.debug('mp4subs', 'Fragmented MP4: subtitles not supported'); return null; }
      var listed = candidates.filter(function (t) { return t.handler !== 'text' || !chapters[t.id]; });
      if (!listed.length) return { none: 'empty' };
      var usable = [], smp = [];
      listed.forEach(function (t) {
        var s = t.format === 'tx3g' && t.editOk ? samples(t, timescale, { maxSamples: MAX_SAMPLES, maxSampleBytes: MAX_SAMPLE_BYTES, fileSize: total }) : null;
        if (s) { usable.push(t); smp.push(s); }
        else Log.debug('mp4subs', 'Subtitle track ' + t.id + ' (' + t.format + ') left out');
      });
      if (!usable.length) return null;
      var meta = describe(usable), count = 0;
      var tracks = meta.map(function (m) {
        var s = smp[m.trakIndex];
        for (var k = 0; k < s.n; k++) if (s.size[k] > 2) count++;
        return s;
      });
      return { meta: meta.map(function (m) { return { label: m.label, srclang: m.srclang, forced: m.forced }; }), tracks: tracks, total: count };
    }).catch(function (e) {
      if (e && e.capped) { Log.debug('mp4subs', 'Subtitles not read: ' + e.message); return null; }
      throw e;
    });
  }

  // The first sample whose end is after t (ends only grow in a text track).
  function firstEndingAfter(T, t) {
    var lo = 0, hi = T.n;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (T.e[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function candidatesOf(rec, now, ctx) {
    var ix = rec.index, picks = [];
    for (var i = 0; ctx && i < ix.tracks.length; i++) {
      var want = ctx.demand(i);
      if (!want) continue;
      // The window is in shown time; samples are in the file's time.
      var tm = ctx.timing(i) || { scale: 1, off: 0, delay: 0 }, scale = tm.scale > 0 ? tm.scale : 1, shift = (tm.off || 0) + (tm.delay || 0);
      var from = want === 'now' ? now - 30 : want.from, to = want === 'now' ? now + 60 : want.to;
      var a = (from - shift) / scale, b = (to - shift) / scale, here = (now - shift) / scale, T = ix.tracks[i];
      for (var k = firstEndingAfter(T, a); k < T.n && T.s[k] < b; k++) {
        if (T.size[k] <= 2 || rec.fetched[i + ':' + k]) continue;
        picks.push({ t: i, k: k, start: T.off[k], end: T.off[k] + T.size[k], dist: T.s[k] > here ? T.s[k] - here : T.e[k] < here ? here - T.e[k] : 0 });
      }
    }
    // Samples close together in the file go in one read.
    picks.sort(function (x, y) { return x.start - y.start; });
    var items = [], run = null;
    for (var p = 0; p < picks.length; p++) {
      var s = picks[p];
      if (run && s.start - run.end <= MAX_GAP && Math.max(run.end, s.end) - run.start <= MAX_JOIN) {
        run.end = Math.max(run.end, s.end); run.members.push([s.t, s.k]); run.keys.push(s.t + ':' + s.k); run.dist = Math.min(run.dist, s.dist);
      } else {
        run = { start: s.start, end: s.end, members: [[s.t, s.k]], keys: [s.t + ':' + s.k], dist: s.dist };
        items.push(run);
      }
    }
    items.forEach(function (it) { it.id = it.start + '-' + it.end; });
    return items.sort(function (x, y) { return x.dist - y.dist || x.start - y.start; });
  }

  var MP4 = {
    id: 'mp4',
    headBytes: HEAD_BYTES,
    startupDeadlineMs: 3000,
    reuseSession: false,
    lazy: true,                         // only the tracks being shown, or Line up's reference, are read
    discover: discover,
    describe: function (index) { return index.meta; },
    candidates: candidatesOf,
    complete: function (rec) { var n = 0; for (var key in rec.fetched) n++; return n >= rec.index.total; },
    read: function (rec, item, range, alive) {
      return range(item.start, item.end - 1).then(function (buf) {
        var out = [];
        if (!alive()) return out;
        for (var m = 0; m < item.members.length; m++) {
          var t = item.members[m][0], k = item.members[m][1], T = rec.index.tracks[t], at = T.off[k] - item.start;
          var line = text(buf, at, at + T.size[k]);
          if (line) out.push({ track: t, s: T.s[k], e: T.e[k], text: line });
        }
        return out;
      });
    }
  };

  // MP4, M4V and QuickTime files, by the link's path or the container My media or the provider names.
  function isMp4(url, container) {
    return /\.(mp4|m4v|mov)$/i.test(String(url || '').split(/[?#]/)[0]) || /^(mp4|m4v|mov)$/i.test(container || '');
  }
  function extract(url, video, onResolved, container) {
    if (!isMp4(url, container)) { if (onResolved) onResolved(url); return { cancel: function () {} }; }
    return EmbedSubs.run(url, video, onResolved, MP4);
  }

  return { box: box, readTrak: readTrak, samples: samples, text: text, describe: describe, MP4: MP4, isMp4: isMp4, extract: extract };
})();
