// Small synthetic MP4 (ISO BMFF) files for the MP4 subtitle reader's unit and browser tests: edge
// cases ffmpeg won't easily write (64-bit offsets past 4 GB, edit lists, version 1 boxes, rejected
// layouts).  tests/lib/mp4/ has real muxer output for the ordinary cases.  No real media.
//
// buildMp4(opts) -> { size, bytes (Uint8Array when the file is small enough to hold), read(start, end) }
//   opts.tracks: [{ lang: 'eng', name, enabled: true, displayFlags: 0, cues: [[startSec, endSec, text]],
//                   handler: 'sbtl', format: 'tx3g', timescale: 1000, mdhdV1, edits: [[segmentDurationMovie,
//                   mediaTime, rate]], ctts: [[count, offset]], chapter (a 'chap' target of the video
//                   track), stsdCount, externalDref, drefs: [[type, self]], dri (the entry's
//                   data_reference_index), noDinf, cttsVersion, stz2, sdi, sizeOverride: { index: bytes } }]
//   opts.video (default true): a video track first, with one 1000-byte chunk
//   opts.moovAtEnd, opts.co64, opts.mvex, opts.movieTimescale (1000), opts.mvhdV1, opts.videoPadding (bytes
//   of 'free' inside the video track's stbl, like its real sample tables); the result has moovStart
//   opts.virtualBase: absolute offset where sample data starts (> 2^32 for co64 tests); the gap reads
//                     as zeros and lives inside one mdat with a 64-bit size
//   track.hugeCount: stts/stsz/stsc that agree on this many samples (rounded up to even; tables stay tiny)
//   track.padding: bytes of 'free' inside the track's stbl (a big subtitle track)
'use strict';
const u8 = a => Uint8Array.from(a);
const u16 = n => [(n >>> 8) & 255, n & 255];
const u32 = n => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256];
const u64 = n => u32(Math.floor(n / 4294967296)).concat(u32(n % 4294967296));
const i32 = n => u32(n < 0 ? 4294967296 + n : n);
const i64 = n => n < 0 ? u32(0xFFFFFFFF).concat(u32(4294967296 + n)) : u64(n);
const ascii = s => Array.from(s).map(c => c.charCodeAt(0));
const cat = parts => [].concat.apply([], parts);
function box(type, ...parts) { const body = cat(parts); return u32(8 + body.length).concat(ascii(type), body); }
function full(type, version, flags, ...parts) { return box(type, [version], [(flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts); }
function lang3(code) { const c = (code || 'und').split('').map(x => x.charCodeAt(0) - 0x60); return u16((c[0] << 10) | (c[1] << 5) | c[2]); }
function textSample(text) { const b = Array.from(Buffer.from(text, 'utf8')); return u16(b.length).concat(b); }

// One track's samples: an empty sample before and between cues, so times line up the way muxers write them.
function samplesOf(t) {
  const ts = t.timescale || 1000, out = [];
  let at = 0;
  for (const [s, e, text] of t.cues || []) {
    if (s > at) out.push({ bytes: u16(0), dur: Math.round((s - at) * ts) });
    out.push({ bytes: textSample(text), dur: Math.round((e - s) * ts) });
    at = e;
  }
  return out;
}

function trakBox(t, id, offsets, opts) {
  const ts = t.timescale || 1000, smp = t.samples, mts = opts.movieTimescale || 1000;
  const dur = smp.reduce((n, s) => n + s.dur, 0);
  const tkhd = full('tkhd', 0, t.enabled === false ? 2 : 3, u32(0), u32(0), u32(id), u32(0), u32(Math.round(dur / ts * mts)), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), Array(36).fill(0), u32(0), u32(0));
  const edts = t.edits ? box('edts', full('elst', t.elstV1 ? 1 : 0, 0, u32(t.edits.length), cat(t.edits.map(([d, m, r]) => (t.elstV1 ? u64(d).concat(i64(m)) : u32(d).concat(i32(m))).concat(u16(r === undefined ? 1 : Math.floor(r)), u16(0)))))) : [];
  const tref = t.chapterTargets && t.chapterTargets.length ? box('tref', box('chap', cat(t.chapterTargets.map(u32)))) : [];
  const mdhd = t.mdhdV1 ? full('mdhd', 1, 0, u64(0), u64(0), u32(ts), u64(dur), lang3(t.lang), u16(0))
                        : full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(dur), lang3(t.lang), u16(0));
  const handler = t.handler || (t.video ? 'vide' : 'sbtl');
  const hdlr = full('hdlr', 0, 0, u32(0), ascii(handler), u32(0), u32(0), u32(0), ascii('Handler'), [0]);
  // drefs: [[type, selfContained]] replaces the single self-contained 'url ' entry; noDinf leaves dinf out.
  const drefs = t.drefs || [['url ', !t.externalDref]];
  const dref = t.noDinf ? [] : box('dinf', full('dref', 0, 0, u32(drefs.length), cat(drefs.map(([ty, self]) => self ? full(ty, 0, 1) : full(ty, 0, 0, ascii('http://x/y'), [0])))));
  const fmt = t.video ? 'avc1' : (t.format || 'tx3g');
  const entry = t.video ? box(fmt, Array(6).fill(0), u16(1), Array(70).fill(0))
    : box(fmt, Array(6).fill(0), u16(t.dri || 1), u32(t.displayFlags || 0), [0, 0], [0, 0, 0, 0], u16(0), u16(0), u16(0), u16(0), u16(0), u16(1), [0, 0x10], [255, 255, 255, 255], box('ftab', u16(1), u16(1), [5], ascii('Arial')));
  const stsd = full('stsd', 0, 0, u32(t.stsdCount || 1), cat(Array(t.stsdCount || 1).fill(entry)));
  const n = t.hugeCount || smp.length;
  const stts = t.hugeCount ? full('stts', 0, 0, u32(1), u32(Math.ceil(n / 2) * 2), u32(1000)) : full('stts', 0, 0, u32(smp.length), cat(smp.map(s => u32(1).concat(u32(s.dur)))));
  const ctts = t.ctts ? full('ctts', t.cttsVersion || 0, 0, u32(t.ctts.length), cat(t.ctts.map(([c, o]) => u32(c).concat(i32(o))))) : [];
  // hugeCount: consistent tables (two chunks of hugeCount / 2), so only the sample cap can reject them.
  const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(t.hugeCount ? Math.ceil(n / 2) : 1), u32(t.sdi || 1));
  const sizes = smp.map((s, i) => (t.sizeOverride && t.sizeOverride[i]) || s.bytes.length);
  const stsz = t.hugeCount ? full('stsz', 0, 0, u32(2), u32(Math.ceil(n / 2) * 2))
    : t.stz2 ? full('stz2', 0, 0, [0, 0, 0], [16], u32(sizes.length), cat(sizes.map(u16)))
    : full('stsz', 0, 0, u32(0), u32(sizes.length), cat(sizes.map(u32)));
  const co = opts.co64 ? full('co64', 0, 0, u32(offsets.length), cat(offsets.map(u64))) : full('stco', 0, 0, u32(offsets.length), cat(offsets.map(u32)));
  // A video track's tables are megabytes in real files: opts.videoPadding stands in for them.
  // track.padding does the same for a subtitle track (a big one, past the 1 MiB read cap).
  const padBytes = t.video ? opts.videoPadding : t.padding;
  const pad = padBytes ? box('free', Array(padBytes).fill(0)) : [];
  const stbl = box('stbl', stsd, stts, ctts, stsc, stsz, co, pad);
  const minf = box('minf', t.video ? full('vmhd', 0, 1, Array(8).fill(0)) : full('nmhd', 0, 0), dref, stbl);
  const udta = t.name ? box('udta', box('name', Array.from(Buffer.from(t.name, 'utf8')))) : [];
  return box('trak', tkhd, edts, tref, box('mdia', mdhd, hdlr, minf), udta);
}

function buildMp4(opts) {
  opts = opts || {};
  const tracks = (opts.video === false ? [] : [{ video: true, timescale: 1000, samples: [{ bytes: Array(1000).fill(0), dur: 10000 }] }])
    .concat((opts.tracks || []).map(t => Object.assign({}, t, { samples: samplesOf(t) })));
  const firstSub = opts.video === false ? 1 : 2;
  if (opts.video !== false) tracks[0].chapterTargets = (opts.tracks || []).map((t, i) => t.chapter ? firstSub + i : 0).filter(Boolean);
  const mts = opts.movieTimescale || 1000;
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2mp41'));
  // Sample data, track by track, one sample per chunk.
  const data = [], rel = tracks.map(() => []);
  tracks.forEach((t, k) => t.samples.forEach(s => { rel[k].push(data.length); data.push.apply(data, s.bytes); }));
  function moovFor(dataStart) {
    const mvhd = opts.mvhdV1 ? full('mvhd', 1, 0, u64(0), u64(0), u32(mts), u64(10 * mts), u32(0x10000), u16(0x100), Array(10).fill(0), Array(36).fill(0), Array(24).fill(0), u32(99))
                             : full('mvhd', 0, 0, u32(0), u32(0), u32(mts), u32(10 * mts), u32(0x10000), u16(0x100), Array(10).fill(0), Array(36).fill(0), Array(24).fill(0), u32(99));
    const traks = tracks.map((t, k) => trakBox(t, k + 1, rel[k].map(o => dataStart + o), opts));
    return box('moov', mvhd, cat(traks), opts.mvex ? box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0))) : []);
  }
  const base = opts.virtualBase || 0;
  // mdat header: 8 bytes, or 16 (64-bit size) when the data sits far away.
  const mdatHdr = base ? 16 : 8;
  let moovLen = moovFor(0).length;                 // offsets have fixed widths: the length doesn't change
  const lead = ftyp.length + (opts.moovAtEnd ? 0 : moovLen);
  const dataStart = base || lead + mdatHdr;
  const moov = moovFor(dataStart);
  const mdatEnd = dataStart + data.length;
  const mdatSize = mdatEnd - lead;
  const mdatHead = base ? u32(1).concat(ascii('mdat'), u64(mdatSize)) : u32(mdatSize).concat(ascii('mdat'));
  const segs = [{ at: 0, bytes: ftyp }];
  if (!opts.moovAtEnd) segs.push({ at: ftyp.length, bytes: moov });
  segs.push({ at: lead, bytes: mdatHead }, { at: dataStart, bytes: data });
  if (opts.moovAtEnd) segs.push({ at: mdatEnd, bytes: moov });
  const size = opts.moovAtEnd ? mdatEnd + moov.length : mdatEnd;
  function read(start, end) {
    end = Math.min(end, size - 1);
    const out = new Uint8Array(Math.max(0, end - start + 1));
    for (const s of segs) {
      const a = Math.max(start, s.at), b = Math.min(end + 1, s.at + s.bytes.length);
      for (let p = a; p < b; p++) out[p - start] = s.bytes[p - s.at];
    }
    return out;
  }
  return { size, read, bytes: size < 64 * 1024 * 1024 ? read(0, size - 1) : null, sampleData: rel, dataStart, moovStart: opts.moovAtEnd ? mdatEnd : ftyp.length };
}

module.exports = { buildMp4, box, full, u8, u16, u32, u64, textSample, lang3 };
