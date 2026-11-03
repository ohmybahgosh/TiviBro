// Mp4Subs: the MP4 (ISO BMFF) subtitle reader.  Box walking, track headers and sample tables
// are checked against real ffmpeg output (tests/lib/mp4/, offsets and times from ffprobe) and
// against synthetic files for the edge cases (tests/lib/mp4-fixture.js).
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

const ctx = { console, Promise, setTimeout, clearTimeout, Date, Net: { wrap: u => u }, Log: { debug() {}, warn() {}, info() {} } };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'embedsubs.js', 'mp4subs.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8'), ctx);   // top-level vars land on ctx
const Mp4Subs = ctx.Mp4Subs;
const { buildMp4, box, u32, u64 } = require('../lib/mp4-fixture');
const LIMITS = size => ({ maxSamples: 100000, maxSampleBytes: 4096, fileSize: size });
const near = (a, b) => Math.abs(a - b) < 1e-6;

// The test's own walk to moov (discovery proper is the adapter's job): returns the movie
// timescale and every trak as readTrak sees it.
function movie(buf, fileOffset) {
  fileOffset = fileOffset || 0;
  let p = fileOffset, moov = null;
  const end = fileOffset + buf.length;
  while (p < end) { const b = Mp4Subs.box(buf, p, end, fileOffset); if (!b) return null; if (b.type === 'moov') { moov = b; break; } p = b.end; }
  if (!moov) return null;
  let ts = 0; const traks = [];
  for (let q = moov.start + moov.headerSize; q < moov.end;) {
    const c = Mp4Subs.box(buf, q, moov.end, fileOffset);
    if (!c) return null;
    const s = c.start - fileOffset + c.headerSize;
    if (c.type === 'mvhd') ts = buf[s] === 1 ? buf.readUInt32BE(s + 20) : buf.readUInt32BE(s + 12);
    if (c.type === 'trak') traks.push(Mp4Subs.readTrak(buf, c.start - fileOffset, c.end - fileOffset));
    q = c.end;
  }
  return { ts, traks };
}
const asBuf = u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.length);
const subs = m => m.traks.filter(t => t && t.handler === 'sbtl');

// ffmpeg files: every subtitle packet ffprobe lists, at its offset, size and time.
for (const name of ['faststart', 'moovend']) {
  const buf = fs.readFileSync(path.join(__dirname, '../lib/mp4', name + '.mp4'));
  const want = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/mp4', name + '.expected.json'), 'utf8'));
  const m = movie(buf);
  const tr = m ? subs(m) : [];
  let good = tr.length === 2 && tr[0].lang === 'eng' && tr[1].lang === 'nld' && tr.every(t => t.format === 'tx3g' && t.editOk);
  const detail = { found: tr.map(t => t && [t.lang, t.format, t.editOk, t.name]) };
  [1, 2].forEach((streamIndex, k) => {
    const pk = want.packets.filter(p => p.stream_index === streamIndex);
    const s = tr[k] && Mp4Subs.samples(tr[k], m.ts, LIMITS(buf.length));
    const same = s && s.n === pk.length && pk.every((p, i) => s.off[i] === +p.pos && s.size[i] === +p.size &&
      near(s.s[i], +p.pts_time) && near(s.e[i], +p.pts_time + +p.duration_time));
    if (!same) { good = false; detail['track' + k] = s ? { n: s.n, off: Array.from(s.off), s: Array.from(s.s) } : null; }
  });
  ok('ffmpeg ' + name + ': two tx3g tracks found with eng/nld and sample offsets/times equal to expected.json', good, good ? undefined : detail);
}

{
  // size==1 with a 64-bit largesize, then size==0 running to the end; an overrun and an unsafe size.
  const free = u32(1).concat([0x66, 0x72, 0x65, 0x65], u64(24), [1, 2, 3, 4, 5, 6, 7, 8]);
  const mdat = u32(0).concat([0x6d, 0x64, 0x61, 0x74], [9, 9, 9, 9]);
  const buf = Uint8Array.from(free.concat(mdat));
  const a = Mp4Subs.box(buf, 0, buf.length, 0), b = a && Mp4Subs.box(buf, a.end, buf.length, 0);
  const over = Uint8Array.from(u32(100).concat([0x66, 0x72, 0x65, 0x65]));
  const huge = Uint8Array.from(u32(1).concat([0x66, 0x72, 0x65, 0x65], [0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  const tiny = Uint8Array.from(u32(5).concat([0x66, 0x72, 0x65, 0x65]));
  // A box far into the file: positions are absolute, the buffer holds just its header.
  const far = Mp4Subs.box(Uint8Array.from(u32(16).concat([0x6d, 0x6f, 0x6f, 0x76])), 5e9, 5e9 + 16, 5e9);
  ok('largesize and size==0 boxes walk',
    a && a.type === 'free' && a.headerSize === 16 && a.size === 24 && a.end === 24 &&
    b && b.type === 'mdat' && b.headerSize === 8 && b.end === buf.length &&
    Mp4Subs.box(over, 0, over.length, 0) === null && Mp4Subs.box(huge, 0, 1e18, 0) === null && Mp4Subs.box(tiny, 0, 99, 0) === null &&
    far && far.type === 'moov' && far.start === 5e9 && far.end === 5e9 + 16,
    { a, b, far });
}
{
  // Track timescale 90000, movie timescale 600, version 1 mdhd and mvhd.
  const f = buildMp4({ movieTimescale: 600, mvhdV1: true, tracks: [{ lang: 'deu', timescale: 90000, mdhdV1: true, cues: [[1, 2.5, 'Eins'], [4, 5, 'Zwei']] }] });
  const m = movie(asBuf(f.bytes)), t = m && subs(m)[0], s = t && Mp4Subs.samples(t, m.ts, LIMITS(f.size));
  ok('mdhd v1 and differing movie/track timescales', t && t.lang === 'deu' && t.mediaTimescale === 90000 && m.ts === 600 &&
    s && s.n === 4 && near(s.s[1], 1) && near(s.e[1], 2.5) && near(s.s[3], 4) && near(s.e[3], 5), s && { s: Array.from(s.s), e: Array.from(s.e) });
}
{
  const base = 4294967296 + 4096;
  const f = buildMp4({ co64: true, virtualBase: base, tracks: [{ lang: 'eng', cues: [[1, 2, 'Far away']] }] });
  const head = f.read(0, f.dataStart > 65536 ? 65535 : f.dataStart - 1);
  const m = movie(asBuf(head)), t = m && subs(m)[0], s = t && Mp4Subs.samples(t, m.ts, LIMITS(f.size));
  const want = f.sampleData[1].map(o => f.dataStart + o);
  ok('co64 offsets above 2^32 are exact', t && t.tables.co64 && s && s.n === 2 && s.off[0] === want[0] && s.off[1] === want[1] && s.off[1] > 4294967296,
    s && { off: Array.from(s.off), want });
}
const one = (opts, limits) => {
  const f = buildMp4(opts), m = movie(asBuf(f.bytes)), t = m && subs(m)[0];
  return { f, m, t, s: t && Mp4Subs.samples(t, m.ts, Object.assign(LIMITS(f.size), limits || {})) };
};
const rows = s => s ? Array.from(s.s).map((x, i) => [+x.toFixed(3), +s.e[i].toFixed(3), s.size[i]]) : null;
{
  // Movie timescale 1000.  A 2 s empty edit, then the media from 0.5 s on for 6 s: presentation
  // time is 2 + (media - 0.5), shown from 2 s to 8 s.  "gone" (media 0.2-0.4) falls before the edit,
  // "Early" (media 1-2) shows at 2.5-3.5, "Crosses" (media 5-7) is cut at 8 s, "After" (9-10) is dropped.
  const { t, s } = one({ tracks: [{ lang: 'eng', edits: [[2000, -1, 1], [6000, 500, 1]],
    cues: [[0.2, 0.4, 'gone'], [1, 2, 'Early'], [5, 7, 'Crosses'], [9, 10, 'After']] }] });
  const r = rows(s) || [];
  const by = size => r.filter(x => x[2] === size);
  ok('leading empty edit delays cues; media_time trims; cue crossing edit end is clipped',
    t && t.editOk && by(6).length === 0 && by(7).length === 1 && by(7)[0][0] === 2.5 && by(7)[0][1] === 3.5 &&
    by(9).length === 1 && by(9)[0][0] === 6.5 && by(9)[0][1] === 8 &&
    r.every(x => x[0] >= 2 && x[1] <= 8 && x[0] < x[1]), r);
}
{
  const multi = one({ tracks: [{ lang: 'eng', edits: [[3000, 0, 1], [3000, 5000, 1]], cues: [[1, 2, 'A']] }] }).t;
  const fast = one({ tracks: [{ lang: 'eng', edits: [[3000, 0, 2]], cues: [[1, 2, 'A']] }] }).t;
  const twoEmpty = one({ tracks: [{ lang: 'eng', edits: [[1000, -1, 1], [1000, -1, 1], [3000, 0, 1]], cues: [[1, 2, 'A']] }] }).t;
  const plain = one({ tracks: [{ lang: 'eng', edits: [[3000, 0, 1]], cues: [[1, 2, 'A']] }] }).t;
  ok('multi-edit track rejected (editOk false)', multi && multi.editOk === false && fast && fast.editOk === false &&
    twoEmpty && twoEmpty.editOk === false && plain && plain.editOk === true,
    { multi: multi && multi.editOk, fast: fast && fast.editOk, twoEmpty: twoEmpty && twoEmpty.editOk, plain: plain && plain.editOk });
}
{
  const { s } = one({ tracks: [{ lang: 'eng', ctts: [[2, 500]], cues: [[1, 2, 'A']] }] });
  ok('ctts offsets applied', s && s.n === 2 && near(s.s[0], 0.5) && near(s.e[0], 1.5) && near(s.s[1], 1.5) && near(s.e[1], 2.5), rows(s));
}
{
  const a = one({ tracks: [{ lang: 'eng', sdi: 2, cues: [[1, 2, 'A']] }] }), b = one({ tracks: [{ lang: 'eng', stsdCount: 2, cues: [[1, 2, 'A']] }] });
  ok('stsc description index 2 rejected', a.t && a.s === null && b.t && b.t.tables.stsdCount === 2 && b.s === null);
}
{
  const { t, s } = one({ tracks: [{ lang: 'eng', externalDref: true, cues: [[1, 2, 'A']] }] });
  ok('external dref rejected', t && t.tables.dref === 'external' && s === null);
}
{
  const { t, s } = one({ tracks: [{ lang: 'eng', stz2: true, cues: [[1, 2, 'A']] }] });
  ok('stz2 rejected', t && s === null);
}
{
  // stts and stsz are 24 and 20 bytes but claim ten million samples.
  // Count what samples() allocates: a cap checked after allocating would already have cost 80 MB per array.
  const F = vm.runInContext("Float64Array", ctx); let biggest = 0;
  ctx.Float64Array = function (n) { biggest = Math.max(biggest, n); return new F(n); };
  const { t, s } = one({ tracks: [{ lang: 'eng', hugeCount: 1e7, cues: [[1, 2, 'A']] }] });
  const atCap = one({ tracks: [{ lang: 'eng', hugeCount: 100000, cues: [[1, 2, 'A']] }] }, { fileSize: 1e12 }).s;
  const overCap = one({ tracks: [{ lang: 'eng', hugeCount: 100002, cues: [[1, 2, 'A']] }] }, { fileSize: 1e12 }).s;
  ctx.Float64Array = F;
  ok('compact tables claiming 10^7 samples rejected before allocation', t && s === null && biggest <= 100000 &&
    atCap && atCap.n === 100000 && overCap === null, { biggest, atCap: atCap && atCap.n, overCap: overCap && overCap.n });
}
{
  const { t, s } = one({ tracks: [{ lang: 'eng', cues: [[1, 2, 'x'.repeat(5000)]] }] });
  const fine = one({ tracks: [{ lang: 'eng', cues: [[1, 2, 'x'.repeat(4000)]] }] }).s;
  ok('sample larger than 4096 rejected', t && s === null && fine && fine.n === 2);
}
{
  // A child box of a valid trak claims more bytes than its parent has; a cut-off trak; random bytes.
  const f = buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 2, 'A']] }] });
  const buf = asBuf(f.bytes), find = (b, type, from) => { for (let p = from || 0; p + 8 <= b.length; p++) if (b.toString('latin1', p + 4, p + 8) === type) return p; return -1; };   // a box's start, by its type
  const subTrak = (() => { let p = -1, n = 0; while ((p = find(buf, 'trak', p + 1)) >= 0) if (++n === 2) return p; return -1; })();
  const len = buf.readUInt32BE(subTrak), trak = Buffer.from(buf.subarray(subTrak, subTrak + len));
  const bad = Buffer.from(trak), stbl = find(bad, 'stbl'); bad.writeUInt32BE(len * 2, stbl);
  let threw = false, results = [];
  try {
    results.push(Mp4Subs.readTrak(bad, 0, bad.length));
    results.push(Mp4Subs.readTrak(trak, 0, len - 30));
    for (let k = 0; k < 200; k++) {
      const junk = Buffer.from(trak); for (let z = 0; z < 6; z++) junk[8 + Math.floor(Math.random() * (len - 8))] = Math.floor(Math.random() * 256);
      const r = Mp4Subs.readTrak(junk, 0, junk.length); if (r) Mp4Subs.samples(r, 1000, LIMITS(f.size));
    }
  } catch (e) { threw = e.stack; }
  ok('malformed nesting returns null without throwing', !threw && results[0] === null && results[1] === null && Mp4Subs.readTrak(trak, 0, len) !== null,
    threw || undefined);
}
{
  const f = buildMp4({ tracks: [{ lang: 'eng', handler: 'text', chapter: true, cues: [[0, 5, 'Chapter 1']] }, { lang: 'eng', cues: [[1, 2, 'A']] }] });
  const m = movie(asBuf(f.bytes));
  ok('chapter text track ignored', m && m.traks[0].handler === 'vide' && m.traks[0].chap.join() === '2' && m.traks[1].handler === 'text' &&
    m.traks[1].id === 2 && m.traks[2].chap.length === 0, m && m.traks.map(t => t && [t.id, t.handler, t.chap]));
}
if (fail) { console.log(fail + ' mp4subs test(s) failed'); process.exit(1); }
console.log('all mp4subs tests passed');
