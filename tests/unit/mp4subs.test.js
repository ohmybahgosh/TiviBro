// Mp4Subs: the MP4 (ISO BMFF) subtitle reader.  Box walking, track headers and sample tables
// are checked against real ffmpeg output (tests/lib/mp4/, offsets and times from ffprobe) and
// against synthetic files for the edge cases (tests/lib/mp4-fixture.js).
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

// A Range server for the adapter tests: files by name (bytes, or { size, read } for sparse ones past
// 4 GB), with faults per file: ignoreRange (200, whole body), fail: [status...] for sample reads,
// wrongRange / truncate once for sample reads, delay ms, redirect (the session URL).
const files = {}, faults = {};
let requests = [];
class FakeXHR {
  open(method, url) { this.url = url; }
  setRequestHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; }
  getResponseHeader(h) { return h === 'Content-Range' ? this.contentRange : null; }
  send() {
    const name = /\/([^/?]+)(?:\?.*)?$/.exec(this.url)[1], f = files[name], fl = faults[name] || {};
    const rm = /bytes=(\d+)-(\d+)/.exec(this.headers.Range), start = +rm[1], end = +rm[2];
    requests.push({ name, start, end, url: this.url });
    const sample = start > 0 && fl.sampleFrom !== undefined && start >= fl.sampleFrom;
    setTimeout(() => {
      if (this.aborted) return;
      if (!f) { this.status = 404; this.readyState = 2; this.onreadystatechange(); return this.onload(); }
      const size = f.size !== undefined ? f.size : f.length, read = (a, b) => f.read ? f.read(a, b) : f.slice(a, b + 1);
      if (fl.ignoreRange) {
        this.status = 200; this.contentRange = null; this.readyState = 2; this.onreadystatechange();
        if (this.aborted) return;
        const all = read(0, size - 1); this.response = all.buffer.slice(all.byteOffset, all.byteOffset + all.length); return this.onload();
      }
      if (sample && fl.fail && fl.fail.length) { this.status = fl.fail.shift(); this.readyState = 2; this.onreadystatechange(); return this.onload && this.onload(); }
      const last = Math.min(end, size - 1);
      let data = read(start, last);
      this.responseURL = fl.redirect || this.url;
      this.status = 206; this.contentRange = 'bytes ' + start + '-' + last + '/' + size;
      if (sample && fl.wrongRange) { fl.wrongRange = false; this.contentRange = 'bytes ' + (start + 1) + '-' + last + '/' + size; }
      if (sample && fl.truncate) { fl.truncate = false; data = data.slice(0, data.length - 1); }
      this.readyState = 2; this.onreadystatechange();
      if (this.aborted) return;
      this.response = data.buffer.slice(data.byteOffset, data.byteOffset + data.length); this.onload();
    }, fl.delay || 1);
  }
  abort() { this.aborted = true; if (this.onabort) this.onabort(); }
}
const ctx = { console, Promise, setTimeout, clearTimeout, Date, XMLHttpRequest: FakeXHR, Net: { wrap: u => u },
  Log: { debug() {}, warn() {}, info() {} },
  document: { createElement: tag => (tag === 'track' ? makeTrackElement() : { textContent: '', className: '' }) },
  VTTCue: function (start, end, text) { this.startTime = start; this.endTime = end; this.text = text; } };
function makeTrackElement() { const cues = []; return { kind: '', label: '', srclang: '', track: { kind: 'subtitles', mode: 'disabled', cues, addCue(c) { cues.push(c); } } }; }
function makeVideo(extra) {
  const listeners = {};
  return Object.assign({
    children: [], listeners, currentTime: 0,
    appendChild(el) { this.children.push(el); },
    removeChild(el) { this.children.splice(this.children.indexOf(el), 1); },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(g => g !== f); },
    fire(t) { (listeners[t] || []).forEach(f => f()); }
  }, extra || {});
}
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
  // Signed in both versions, as ffmpeg reads them (old muxers write negative offsets in version 0).
  const neg0 = one({ tracks: [{ lang: 'eng', ctts: [[2, -250]], cues: [[1, 2, 'A']] }] }).s;
  const neg1 = one({ tracks: [{ lang: 'eng', ctts: [[2, -250]], cttsVersion: 1, cues: [[1, 2, 'A']] }] }).s;
  const v2 = one({ tracks: [{ lang: 'eng', ctts: [[2, 0]], cttsVersion: 2, cues: [[1, 2, 'A']] }] });
  ok('ctts offsets applied', s && s.n === 2 && near(s.s[0], 0.5) && near(s.e[0], 1.5) && near(s.s[1], 1.5) && near(s.e[1], 2.5) &&
    neg0 && neg0.n === 2 && near(neg0.s[0], 0) && near(neg0.e[0], 0.75) && near(neg0.s[1], 0.75) && neg1 && near(neg1.s[1], 0.75) &&
    v2.t && v2.s === null, { s: rows(s), neg0: rows(neg0), neg1: rows(neg1), v2: v2.s && v2.s.n });
}
{
  const a = one({ tracks: [{ lang: 'eng', sdi: 2, cues: [[1, 2, 'A']] }] }), b = one({ tracks: [{ lang: 'eng', stsdCount: 2, cues: [[1, 2, 'A']] }] });
  ok('stsc description index 2 rejected', a.t && a.s === null && b.t && b.t.tables.stsdCount === 2 && b.s === null);
}
{
  const cue = [[1, 2, 'A']], dref = o => one({ tracks: [Object.assign({ lang: 'eng', cues: cue }, o)] });
  const cases = {
    external: dref({ externalDref: true }), missing: dref({ noDinf: true }), outOfRange: dref({ dri: 2 }),
    secondExternal: dref({ drefs: [['url ', true], ['url ', false]], dri: 2 }), urn: dref({ drefs: [['urn ', true]] }),
    secondSelf: dref({ drefs: [['url ', false], ['url ', true]], dri: 2 }), alias: dref({ drefs: [['alis', true]] })
  };
  const got = {}; for (const k in cases) got[k] = cases[k].t ? [cases[k].t.tables.dref, !!cases[k].s] : null;
  ok('external dref rejected', ['external', 'missing', 'outOfRange', 'secondExternal', 'urn'].every(k => got[k] && got[k][0] === 'external' && !got[k][1]) &&
    got.secondSelf[0] === 'self' && got.secondSelf[1] && got.alias[0] === 'self' && got.alias[1], got);
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

// --- 3GPP text samples (TS 26.245 §5.17) and track labels.
const T = bytes => Uint8Array.from(bytes);
const utf8 = str => Array.from(Buffer.from(str, 'utf8'));
const txt = (b) => Mp4Subs.text(b, 0, b.length);
ok('text: "00 05 Snel." → "Snel."', txt(T([0, 5].concat(utf8('Snel.')))) === 'Snel.');
{
  const styl = box('styl', u32(1).slice(2), [0, 0, 0, 4, 0, 1, 1, 0x12, 255, 255, 255, 255]);
  const b = T([0, 10].concat(utf8('Two\r\nlines'), styl));
  const crOnly = T([0, 7].concat(utf8(' a\rb c ')));
  ok('text with trailing styl box', txt(b) === 'Two\nlines' && txt(crOnly) === 'a\nb c', [txt(b), txt(crOnly)]);
}
{
  const be = [0xFE, 0xFF].concat(...Array.from('Héllo').map(c => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]));
  const le = [0xFF, 0xFE].concat(...Array.from('日本').map(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]));
  const bom8 = [0xEF, 0xBB, 0xBF].concat(utf8('Café'));
  ok('text UTF-16 BOM', txt(T([0, be.length].concat(be))) === 'Héllo' && txt(T([0, le.length].concat(le))) === '日本' &&
    txt(T([0, bom8.length].concat(bom8))) === 'Café', [txt(T([0, be.length].concat(be))), txt(T([0, le.length].concat(le)))]);
}
ok('empty sample → ""', txt(T([0, 0])) === '' && txt(T([0, 0, 0x00, 0x00, 0x00, 0x0c])) === '' && txt(T([0, 9, 0x41])) === '' && txt(T([0])) === '',
  [txt(T([0, 9, 0x41]))]);

const trk = (lang, name, o) => Object.assign({ lang, name: name || '', enabled: false, displayFlags: 0 }, o || {});
const labels = list => Mp4Subs.describe(list).map(d => d.label);
{
  const got = labels([trk('eng', 'BTM', { enabled: true }), trk('spa', 'BTM LA'), trk('spa', 'BTM ES'), trk('dan', 'BTM'), trk('tha', 'BTM')]);
  ok('labels for file B shape: "English · BTM", "Spanish · BTM LA", "Spanish · BTM ES", "Danish · BTM", "Thai · BTM"',
    got.join('|') === 'English · BTM|Spanish · BTM LA|Spanish · BTM ES|Danish · BTM|Thai · BTM', got);
}
{
  const d = Mp4Subs.describe([trk('nld', 'Nederlands'), trk('eng', 'english'), trk('deu', 'Deutsch'), trk('fre', 'French'), trk('nld', 'Dutch SDH')]);
  ok('file A shape: nld + "Nederlands" → "Dutch"', d[0].label === 'Dutch' && d.map(x => x.label).join('|') === 'Dutch|English|German|French|Dutch · Dutch SDH',
    d.map(x => x.label));
}
{
  const got = labels([trk('eng', 'BTM'), trk('eng', 'BTM'), trk('eng', 'BTM'), trk('und', ''), trk('und', 'Commentary')]);
  ok('duplicate labels get " 2"', got.join('|') === 'English · BTM|English · BTM 2|English · BTM 3|Subtitle track 4|Commentary', got);
}
{
  const long = 'A very long release group description that goes on and on';
  const d = Mp4Subs.describe([trk('eng', long, { displayFlags: 0xC0000000 }), trk('eng', long, { displayFlags: 0xC0000000 })]);
  const l = d.map(x => x.label);
  ok('60-char cut keeps " (forced) 2" suffix', l[0].length <= 60 && l[1].length <= 60 && /^English · A very long.* \(forced\)$/.test(l[0]) &&
    / \(forced\) 2$/.test(l[1]) && l[0] !== l[1] && !/ {2}/.test(l[0]) && !/ \(forced\)/.test(l[0].slice(0, -9)), l);
}
{
  const d = Mp4Subs.describe([trk('eng', '', { displayFlags: 0xC0000000, enabled: true }), trk('eng', '', { displayFlags: 0x40000000 }), trk('fra', '', { displayFlags: 0x80000000 })]);
  const f = d.map(x => [x.label, x.forced, x.trakIndex]);
  ok('0xC0000000 → forced, label "(forced)"; 0x40000000 → not forced',
    JSON.stringify(f) === JSON.stringify([['English', false, 1], ['English (forced)', true, 0], ['French (forced)', true, 2]]), f);
}
{
  const d = Mp4Subs.describe([trk('eng', 'SDH'), trk('spa', ''), trk('eng', '', { enabled: true }), trk('spa', 'Latino', { enabled: true })]);
  const variants = labels([trk('spa', 'Castellano'), trk('zho', 'Cantonese'), trk('zho', 'Mandarin')]).join('|');
  const f = d.map(x => [x.label, x.trakIndex]);
  ok('enabled English attached before a second English',
    JSON.stringify(f) === JSON.stringify([['English', 2], ['Spanish · Latino', 3], ['English · SDH', 0], ['Spanish', 1]]) &&
    variants === 'Spanish · Castellano|Chinese · Cantonese|Chinese · Mandarin', { f, variants });
}
{
  const d = Mp4Subs.describe([trk('xyz', '')]);
  ok('unknown "xyz" → label "xyz", srclang "xyz"', d[0].label === 'xyz' && d[0].srclang === 'xyz', d[0]);
}
{
  const d = Mp4Subs.describe([trk('nld', ''), trk('ger', ''), trk('bul', ''), trk('und', '')]);
  ok('srclang uses U.lang when known ("nld" → "nl")', d.map(x => x.srclang).join() === 'nl,de,bul,und' && d[2].label === 'Bulgarian', d);
}
{
  // fre and fra are one language; forced tracks keep file order among themselves.
  const alias = Mp4Subs.describe([trk('fre', 'Old'), trk('fra', 'Main', { enabled: true })]).map(x => x.trakIndex).join();
  const forced = Mp4Subs.describe([trk('eng', 'F1', { displayFlags: 0xC0000000 }), trk('eng', 'F2', { displayFlags: 0xC0000000, enabled: true }), trk('eng', 'Plain')])
    .map(x => x.trakIndex).join();
  ok('language aliases group; forced tracks after ordinary ones, in file order', alias === '1,0' && forced === '2,0,1', { alias, forced });
}
{
  const got = labels([trk('und', 'constructor'), trk('und', '__proto__'), trk('und', 'toString'), trk('constructor', ''), trk('__proto__', '')]);
  ok('labels named like object properties stay as they are', got.join('|') === 'constructor|__proto__|toString|constructor 2|__proto__ 2', got);
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms) => { for (let t = 0; t < (ms || 2000) && !cond(); t += 5) await wait(5); return cond(); };
const tracksOf = v => v.children.map(c => c.track);
const textsOf = tr => tr.cues.map(c => c.text);
// Turn track i on and let the core notice (as a playing video's timeupdate would): a moment after the
// tracks appear, as a viewer would, once the core has settled their modes (60 ms).
const show = (v, i) => setTimeout(() => { tracksOf(v).forEach((t, k) => { t.mode = k === i ? 'showing' : 'disabled'; }); v.fire('timeupdate'); }, 80);
const fasts = fs.readFileSync(path.join(__dirname, '../lib/mp4/faststart.mp4'));
const asU8 = b => new Uint8Array(b.buffer, b.byteOffset, b.length);
const twoParts = (late, extra) => buildMp4(Object.assign({ tracks: [{ lang: 'eng', cues: [[1, 3, 'early'], [100, 103, 'late']].concat(late || []) }] }, extra || {}));

(async () => {
  {
    files['fast.mp4'] = asU8(fasts); faults['fast.mp4'] = { redirect: 'http://cdn/session/fast.mp4' }; requests = [];
    const v = makeVideo({ currentTime: 1.5 }), resolved = [];
    const h = Mp4Subs.extract('http://p/movie/u/p/fast.mp4', v, u => resolved.push(u), '');
    await until(() => v.children.length === 2);
    const listed = v.children.map(c => c.label + '/' + c.srclang).join();
    show(v, 1);
    await until(() => tracksOf(v)[1].cues.length >= 2);
    ok('faststart: tracks listed, Dutch cues near 1.5 s read, onResolved once with session URL',
      listed === 'English/en,Dutch/nl' && textsOf(tracksOf(v)[1]).join('|') === 'Hallo|Tot ziens' && tracksOf(v)[0].cues.length === 0 &&
      resolved.length === 1 && resolved[0] === 'http://cdn/session/fast.mp4' && requests.slice(1).every(r => r.url === 'http://cdn/session/fast.mp4') &&
      v._mkvSubsState === 'ready', { listed, texts: textsOf(tracksOf(v)[1]), resolved, requests: requests.length });
    h.cancel();
  }
  {
    const f = buildMp4({ moovAtEnd: true, virtualBase: 5e6, videoPadding: 300000, tracks: [{ lang: 'eng', cues: [[1, 2, 'One']] }, { lang: 'nld', cues: [[1, 2, 'Een']] }] });
    files['end.mp4'] = f; requests = [];
    const v = makeVideo();
    const h = Mp4Subs.extract('http://p/movie/end.mp4', v, () => {}, '');
    await until(() => v.children.length === 2);
    const m = movie(Buffer.from(f.read(f.moovStart, f.size - 1)), f.moovStart);
    // The video trak, as absolute positions: the walk above in file coordinates.
    let p = f.moovStart + 8, vt = null;
    const mb = Buffer.from(f.read(f.moovStart, f.size - 1));
    while (p < f.size) { const b = Mp4Subs.box(mb, p, f.size, f.moovStart); if (b.type === 'trak') { vt = b; break; } p = b.end; }
    const inVideo = requests.reduce((n, r) => n + Math.max(0, Math.min(r.end + 1, vt.end) - Math.max(r.start, vt.start)), 0);
    ok('moov at end: request count for discovery ≤ 8 and no byte of video trak tables requested (≤ 2 KB of its 300 KB)',
      m && m.traks.length === 3 && requests.length <= 8 && inVideo <= 2048 && vt.size > 300000, { requests: requests.length, inVideo, vt: vt && vt.size });
    h.cancel();
  }
  {
    files['frag.mp4'] = buildMp4({ mvex: true, tracks: [{ lang: 'eng', cues: [[1, 2, 'A']] }] }).bytes; requests = [];
    const v = makeVideo();
    Mp4Subs.extract('http://p/movie/frag.mp4', v, () => {}, '');
    await until(() => v._mkvSubsState === 'unavailable');
    ok('fragmented (mvex) settles unavailable, no sample reads', v._mkvSubsState === 'unavailable' && v.children.length === 0 && requests.length === 1,
      { s: v._mkvSubsState, requests: requests.length });
  }
  {
    files['chap.mp4'] = buildMp4({ tracks: [{ lang: 'eng', handler: 'text', chapter: true, cues: [[0, 5, 'Chapter 1']] }] }).bytes;
    files['none.mp4'] = buildMp4({ tracks: [] }).bytes;
    files['bad.mp4'] = buildMp4({ tracks: [{ lang: 'eng', format: 'wvtt', cues: [[1, 2, 'A']] }] }).bytes;
    const a = makeVideo(), b = makeVideo(), c = makeVideo();
    Mp4Subs.extract('http://p/movie/chap.mp4', a, () => {}, ''); Mp4Subs.extract('http://p/movie/none.mp4', b, () => {}, '');
    Mp4Subs.extract('http://p/movie/bad.mp4', c, () => {}, '');
    await until(() => a._mkvSubsState === '' && b._mkvSubsState === '' && c._mkvSubsState === 'unavailable');
    ok('chapter-only file shows empty state', a._mkvSubsState === '' && b._mkvSubsState === '' && c._mkvSubsState === 'unavailable' && a.children.length === 0,
      { chap: a._mkvSubsState, none: b._mkvSubsState, wvtt: c._mkvSubsState });
  }
  {
    files['quiet.mp4'] = asU8(fasts); requests = [];
    const v = makeVideo({ currentTime: 2 });
    const h = Mp4Subs.extract('http://p/movie/quiet.mp4', v, () => {}, '');
    await until(() => v.children.length === 2);
    tracksOf(v).forEach(t => { t.mode = 'hidden'; });
    for (let i = 0; i < 5; i++) { v.fire('timeupdate'); await wait(10); }
    ok('disabled tracks never requested', requests.length === 1 && tracksOf(v).every(t => t.cues.length === 0), { requests: requests.length });
    h.cancel();
  }
  {
    files['seek.mp4'] = twoParts(null, { moovAtEnd: true, virtualBase: 2e6, videoPadding: 100000 }); faults['seek.mp4'] = { delay: 15 }; requests = [];
    const v = makeVideo();
    const h1 = Mp4Subs.extract('http://p/movie/seek.mp4', v, () => {}, '');
    await wait(40);                      // the head is in, the moov walk is under way
    const mid = requests.length;
    h1.cancel();
    v.currentTime = 101;
    const h2 = Mp4Subs.extract('http://p/movie/seek.mp4', v, null, '');
    await until(() => v.children.length >= 1, 3000);
    show(v, 0);
    await until(() => tracksOf(v)[0].cues.length >= 1, 3000);
    ok('seek during discovery: no duplicate tracks, reads resume at the new time', mid >= 2 && v.children.length === 1 &&
      textsOf(tracksOf(v)[0]).join() === 'late', { mid, tracks: v.children.length, texts: textsOf(tracksOf(v)[0]) });
    h2.cancel();
  }
  {
    files['norange.mp4'] = asU8(fasts); faults['norange.mp4'] = { ignoreRange: true };
    const v = makeVideo(), resolved = [];
    Mp4Subs.extract('http://p/movie/norange.mp4', v, u => resolved.push(u), '');
    await until(() => v._mkvSubsState === 'error');
    ok('ignored Range on head read: video starts on original URL, state error', resolved.join() === 'http://p/movie/norange.mp4' && v._mkvSubsState === 'error',
      { resolved, s: v._mkvSubsState });
  }
  {
    files['slow.mp4'] = asU8(fasts); faults['slow.mp4'] = { delay: 400 }; requests = [];
    const MP4 = Mp4Subs.MP4, was = MP4.startupDeadlineMs;
    const isDefault = was === 3000;
    MP4.startupDeadlineMs = 60;
    const v = makeVideo(), resolved = [];
    const h = Mp4Subs.extract('http://p/movie/slow.mp4', v, u => resolved.push(u), '');
    await wait(500); h.cancel();
    const v2 = makeVideo(), n = requests.length;
    const h2 = Mp4Subs.extract('http://p/movie/slow.mp4', v2, null, '');
    await wait(50);
    MP4.startupDeadlineMs = was;
    ok('head read slower than 3000 ms: video on original URL, error remembered for reanchor', isDefault && resolved.join() === 'http://p/movie/slow.mp4' &&
      v2._mkvSubsState === 'error' && requests.length === n, { isDefault, resolved, s2: v2._mkvSubsState });
    h2.cancel();
  }
  {
    // Sample reads failing once each way: the track backs off and then fills in.
    const names = ['s416', 's429', 's503', 'trunc', 'wrong'];
    const vids = names.map(n => {
      files[n + '.mp4'] = asU8(fasts);
      faults[n + '.mp4'] = { sampleFrom: 1, fail: /^s\d/.test(n) ? [+n.slice(1)] : [], truncate: n === 'trunc', wrongRange: n === 'wrong' };
      const v = makeVideo({ currentTime: 2 });
      v.h = Mp4Subs.extract('http://p/movie/' + n + '.mp4', v, () => {}, '');
      return v;
    });
    await until(() => vids.every(v => v.children.length === 2));
    vids.forEach(v => show(v, 1));
    await wait(150);
    const early = vids.map(v => [v._mkvSubsState, tracksOf(v)[1].cues.length]);
    await until(() => vids.every(v => tracksOf(v)[1].cues.length === 2), 2500);
    const later = vids.map(v => [v._mkvSubsState, textsOf(tracksOf(v)[1]).join('|')]);
    const statuses = early.slice(0, 3), bodies = early.slice(3);
    ok('416/429/503 on a sample read back off and recover', statuses.every(x => x[0] === 'recovering' && x[1] === 0) &&
      later.slice(0, 3).every(x => x[0] === 'ready' && x[1] === 'Hallo|Tot ziens'), { early: statuses, later: later.slice(0, 3) });
    ok('truncated body and wrong Content-Range rejected', bodies.every(x => x[0] === 'recovering' && x[1] === 0) &&
      later.slice(3).every(x => x[1] === 'Hallo|Tot ziens'), { early: bodies, later: later.slice(3) });
    vids.forEach(v => v.h.cancel());
  }
  {
    files['again.mp4'] = buildMp4({ moovAtEnd: true, virtualBase: 3e6, videoPadding: 100000, tracks: [{ lang: 'eng', cues: [[1, 2, 'One'], [4, 5, 'Two']] }] });
    faults['again.mp4'] = { redirect: 'http://cdn/s1/again.mp4' };
    const v = makeVideo({ currentTime: 1 });
    const h1 = Mp4Subs.extract('http://p/movie/again.mp4', v, () => {}, '');
    await until(() => v.children.length === 1); show(v, 0);
    await until(() => tracksOf(v)[0].cues.length === 2);
    h1.cancel();
    faults['again.mp4'].redirect = 'http://cdn/s2/again.mp4'; requests = [];
    const v2 = makeVideo({ currentTime: 1 }), resolved = [];
    const h2 = Mp4Subs.extract('http://p/movie/again.mp4', v2, u => resolved.push(u), '');
    await until(() => resolved.length === 1); await wait(30);
    ok('reconnect re-resolves, keeps index', resolved[0] === 'http://cdn/s2/again.mp4' && requests.length === 1 && requests[0].start === 0 &&
      textsOf(tracksOf(v2)[0]).join('|') === 'One|Two' && tracksOf(v2)[0].mode === 'showing', { resolved, requests: requests.map(r => r.start), texts: textsOf(tracksOf(v2)[0]) });
    h2.cancel();
  }
  {
    // At 100 s only the empty gap sample (size 2) between the lines is in the window: nothing to read.
    files['gap.mp4'] = buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 2, 'A'], [200, 201, 'B']] }] }).bytes; requests = [];
    const v = makeVideo({ currentTime: 100 });
    const h = Mp4Subs.extract('http://p/movie/gap.mp4', v, () => {}, '');
    await until(() => v.children.length === 1); show(v, 0);
    for (let i = 0; i < 5; i++) { v.fire('timeupdate'); await wait(10); }
    ok('empty samples are never read', requests.length === 1 && tracksOf(v)[0].cues.length === 0, { requests: requests.length });
    h.cancel();
    // Not an MP4 after all (the first box isn't one an MP4 starts with): no reads past the head.
    const odd = Buffer.from(buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 2, 'A']] }] }).bytes); odd.write('abcd', 4, 'latin1');
    files['odd.mp4'] = asU8(odd); requests = [];
    const w = makeVideo();
    Mp4Subs.extract('http://p/movie/odd.mp4', w, () => {}, '');
    await until(() => w._mkvSubsState !== 'discovering');
    ok('a file that does not start like an MP4 settles unavailable', w._mkvSubsState === 'unavailable' && w.children.length === 0 && requests.length === 1,
      { s: w._mkvSubsState, requests: requests.length });
  }
  {
    // Two English tracks, the second marked enabled: it is attached first, so turning subtitles on by
    // language (the first match wins) picks it; forced ones are marked before they're attached.
    files['two.mp4'] = buildMp4({ tracks: [{ lang: 'eng', name: 'SDH', enabled: false, cues: [[1, 2, 'a']] }, { lang: 'eng', enabled: true, cues: [[1, 2, 'b']] },
      { lang: 'eng', enabled: true, displayFlags: 0xC0000000, cues: [[1, 2, 'c']] }] }).bytes;
    const v = makeVideo();
    const h = Mp4Subs.extract('http://p/movie/two.mp4', v, () => {}, '');
    await until(() => v.children.length === 3);
    ok('autoSubs picks the enabled English first when two match', v.children.map(c => c.label).join('|') === 'English|English · SDH|English (forced)' &&
      tracksOf(v).map(t => !!t._forced).join() === 'false,false,true' && tracksOf(v).every(t => t._embedded && typeof t._embedLoad === 'function'),
      v.children.map(c => c.label));
    h.cancel();
  }
  const timed = async (name, fixture, now, timing) => {
    files[name] = fixture.bytes;
    ctx.Subs = { delay: 0, timingOf: () => timing };
    const v = makeVideo({ currentTime: now });
    const h = Mp4Subs.extract('http://p/movie/' + name, v, () => {}, '');
    await until(() => v.children.length === 1); show(v, 0);
    await until(() => tracksOf(v)[0].cues.length > 0, 500); await wait(30);
    const got = textsOf(tracksOf(v)[0]);
    h.cancel(); delete ctx.Subs;
    return got;
  };
  {
    const got = await timed('shift.mp4', twoParts([[300, 302, 'far']]), 140, { scale: 1, off: 40, delay: 0 });
    ok('timing shift of +40 s fetches samples at source time now−40', got.join() === 'late', got);
  }
  {
    // Shown at source × 23.976/25: the line at 7000 s in the file shows at 6713 s.
    const scale = 23.976 / 25;
    const got = await timed('scale.mp4', buildMp4({ tracks: [{ lang: 'eng', cues: [[6500, 6502, 'before'], [7000, 7003, 'right'], [7400, 7402, 'after']] }] }), 7000 * scale + 1, { scale, off: 0, delay: 0 });
    ok('frame-rate scale 25/23.976 late in a 2 h file fetches the right samples', got.join() === 'right', got);
  }
  {
    const got = await timed('long.mp4', buildMp4({ tracks: [{ lang: 'eng', cues: [[0, 120, 'long'], [200, 201, 'later']] }] }), 90, { scale: 1, off: 0, delay: 0 });
    ok('long cue (0–120 s) found when seeking to 90 s', got.join() === 'long', got);
  }
  {
    // Container gate: path extension or the known container, nothing else.
    const calls = [];
    const g = (u, c) => { const v = makeVideo(), h = Mp4Subs.extract(u, v, x => calls.push(x), c), st = v._mkvSubsState; h.cancel(); return st; };
    const off = [g('http://p/movie/a.mkv', ''), g('http://p/x?name=a.mp4', ''), g('http://p/movie/a.avi', 'mkv')];
    const on = [g('http://p/movie/a.MP4?t=1', ''), g('http://p/movie/a.m4v#x', ''), g('http://p/movie/a.mov', ''), g('http://p/signed', 'mp4')];
    ok('extract gates on .mp4/.m4v/.mov or the container', off.every(x => x === undefined) && on.every(x => x === 'discovering') && calls.length === 3 &&
      Mp4Subs.isMp4('http://p/signed', 'M4V') && !Mp4Subs.isMp4('http://p/a.mkv', ''), { off, on, calls: calls.length });
  }
  {
    // A seek before discovery is done: the restarted reader stays on the session the video plays from.
    files['seekr.mp4'] = twoParts(null, { moovAtEnd: true, virtualBase: 2e6, videoPadding: 100000 });
    faults['seekr.mp4'] = { delay: 15, redirect: 'http://cdn/s1/seekr.mp4' }; requests = [];
    const v = makeVideo();
    const h1 = Mp4Subs.extract('http://p/movie/seekr.mp4', v, () => {}, '');
    await wait(40);
    h1.cancel();
    v.currentTime = 101;
    const h2 = Mp4Subs.extract('http://p/movie/seekr.mp4', v, null, '');
    await until(() => v.children.length >= 1, 3000);
    show(v, 0);
    await until(() => tracksOf(v)[0] && tracksOf(v)[0].cues.length >= 1, 3000);
    const entry = requests.filter(r => r.url === 'http://p/movie/seekr.mp4').length;
    ok('seek during discovery keeps the resolved session (entry link read once)', entry === 1 && textsOf(tracksOf(v)[0]).join() === 'late',
      { entry, urls: requests.map(r => r.url.slice(0, 18)), texts: tracksOf(v)[0] && textsOf(tracksOf(v)[0]) });
    h2.cancel();
  }
  {
    // Composition offsets out of order: shown times 200, 1 and 2 s.  The lines at 1 and 2 s still come.
    files['ctts.mp4'] = asU8(buildMp4({ tracks: [{ lang: 'eng', cues: [[0, 1, 'first'], [1, 2, 'second'], [2, 3, 'third']], ctts: [[1, 200000], [2, 0]] }] }).bytes);
    requests = [];
    const v = makeVideo({ currentTime: 2 });
    const h = Mp4Subs.extract('http://p/movie/ctts.mp4', v, () => {}, '');
    await until(() => v.children.length === 1);
    show(v, 0);
    await until(() => tracksOf(v)[0].cues.length >= 2, 1500);
    const got = textsOf(tracksOf(v)[0]).sort().join();
    ok('composition offsets out of order still find the lines near now', got === 'second,third', got);
    h.cancel();
  }
  {
    // A subtitle track bigger than 1 MiB (allowed up to 4 MiB) is read in pieces of at most 1 MiB.
    files['bigtrak.mp4'] = asU8(buildMp4({ moovAtEnd: true, tracks: [{ lang: 'eng', padding: 1100000, cues: [[1, 3, 'big']] }] }).bytes);
    requests = [];
    const v = makeVideo({ currentTime: 1 });
    const h = Mp4Subs.extract('http://p/movie/bigtrak.mp4', v, () => {}, '');
    await until(() => v.children.length === 1, 3000);
    const biggest = Math.max.apply(null, requests.map(r => r.end - r.start + 1));
    ok('a big subtitle track is read in pieces of at most 1 MiB', v.children.length === 1 && biggest <= 1048576, { tracks: v.children.length, biggest, n: requests.length });
    h.cancel();
  }
  {
    // A shown track that Line up also reads: its playback window and Line up's, nothing in between.
    files['twowin.mp4'] = asU8(buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 3, 'now'], [200, 202, 'between'], [400, 402, 'lineup']] }] }).bytes);
    requests = [];
    const v = makeVideo({ currentTime: 0 });
    const h = Mp4Subs.extract('http://p/movie/twowin.mp4', v, () => {}, '');
    await until(() => v.children.length === 1);
    await wait(100);
    const t = tracksOf(v)[0];
    t.mode = 'showing';
    await t._embedLoad(380, 420, 3000);
    await wait(30);
    const got = textsOf(t).sort().join();
    ok('showing plus Line up reads both windows and nothing between', got === 'lineup,now', got);
    h.cancel();
    // Windows that overlap: a line in both is read once.
    files['overlap.mp4'] = asU8(buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 3, 'both']] }] }).bytes);
    const v2 = makeVideo({ currentTime: 0 });
    const h2 = Mp4Subs.extract('http://p/movie/overlap.mp4', v2, () => {}, '');
    await until(() => v2.children.length === 1);
    await wait(100);
    const t2 = tracksOf(v2)[0];
    t2.mode = 'showing';
    await t2._embedLoad(0, 10, 3000);
    await wait(30);
    ok('a line in both windows is read once', textsOf(t2).join() === 'both', textsOf(t2));
    h2.cancel();
  }
  {
    // Embedded tracks are drawn by the reader (and the TV), not by Subs' own drawing (subs.js drawLines).
    const v = makeVideo({ currentTime: 0 });
    const h = Mp4Subs.extract('http://p/movie/fast.mp4', v, () => {}, '');
    await until(() => v.children.length >= 1);
    ok('MP4 tracks are marked for the reader\'s own drawing', tracksOf(v).every(t => t._tbMkv === true), tracksOf(v).map(t => t._tbMkv));
    h.cancel();
  }
  {
    // A reconnect asks the link again with a small read (issue #34); a link now serving another file
    // (another size) is read from the start, with a whole head.
    files['swap.mp4'] = asU8(buildMp4({ tracks: [{ lang: 'eng', cues: [[1, 3, 'old']] }] }).bytes);
    faults['swap.mp4'] = { redirect: 'http://cdn/a/swap.mp4' }; requests = [];
    const v1 = makeVideo({ currentTime: 0 }), seen = [];
    const h1 = Mp4Subs.extract('http://p/movie/swap.mp4', v1, u => seen.push(u), '');
    await until(() => v1.children.length === 1); h1.cancel();
    faults['swap.mp4'].redirect = 'http://cdn/b/swap.mp4'; requests = [];
    const v2 = makeVideo({ currentTime: 0 });
    const h2 = Mp4Subs.extract('http://p/movie/swap.mp4', v2, u => seen.push(u), '');
    await wait(60);
    const reopen = requests.slice(); h2.cancel();
    ok('a reconnect re-opens the link with a 16-byte read and plays on the new session', reopen.length === 1 && reopen[0].url === 'http://p/movie/swap.mp4' &&
      reopen[0].end - reopen[0].start + 1 === 16 && seen.join() === 'http://cdn/a/swap.mp4,http://cdn/b/swap.mp4', { reopen, seen });
    files['swap.mp4'] = asU8(buildMp4({ tracks: [{ lang: 'nld', cues: [[1, 3, 'new']] }, { lang: 'eng', cues: [[5, 6, 'x']] }] }).bytes); requests = [];
    const v3 = makeVideo({ currentTime: 0 });
    const h3 = Mp4Subs.extract('http://p/movie/swap.mp4', v3, () => {}, '');
    await until(() => v3.children.length === 2, 3000);
    ok('a different file on the same link is found again from a whole head', v3.children.length === 2 && requests.some(r => r.start === 0 && r.end === 65535), { tracks: v3.children.length, reqs: requests.map(r => r.start + '-' + r.end) });
    h3.cancel();
  }
  if (fail) { console.log(fail + ' mp4subs test(s) failed'); process.exit(1); }
  console.log('all mp4subs tests passed');
})().catch(e => { console.error(e); process.exit(1); });
