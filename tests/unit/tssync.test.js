// service/tssync.js: keeps live MPEG-TS aligned when stray bytes get into the stream.
'use strict';
const path = require('path');
const { TsSync } = require(path.join(__dirname, '../../service/tssync.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

function packets(count, seed) {
  const b = Buffer.alloc(count * 188);
  for (let i = 0; i < count; i++) { b[i * 188] = 0x47; for (let k = 1; k < 188; k++) b[i * 188 + k] = (i * 7 + k * 13 + seed) & 255 || 1; b[i * 188 + 1] = i & 0x1f; b[i * 188 + 2] = (i >> 5) & 255; }
  // keep stray 0x47 inside payloads, like real data
  for (let i = 0; i < count; i += 3) b[i * 188 + 50] = 0x47;
  return b;
}
function run(buf, chunkSizes) {
  return new Promise(res => {
    const drops = []; const s = new TsSync(n => drops.push(n)); const out = [];
    s.on('data', d => out.push(d)); s.on('end', () => res({ out: Buffer.concat(out), drops, s }));
    let i = 0, k = 0;
    while (i < buf.length) { const n = chunkSizes[k++ % chunkSizes.length]; s.write(buf.slice(i, i + n)); i += n; }
    s.end();
  });
}
const aligned = b => { if (b.length % 188) return false; for (let i = 0; i < b.length; i += 188) if (b[i] !== 0x47) return false; return true; };
const ids = b => { const o = []; for (let i = 0; i < b.length; i += 188) o.push(b[i + 1] | (b[i + 2] << 5)); return o; };

(async () => {
  const clean = packets(2000, 1);
  let r = await run(clean, [1000, 7, 4096, 188, 65536, 333]);
  ok('a clean stream passes through byte for byte, whatever the chunking', r.out.equals(clean) && r.drops.length === 0);

  const junk = Buffer.from(Array.from({ length: 5003 }, (_, i) => (i * 31 + 7) & 255));
  const parts = [clean.slice(0, 188 * 500), junk, clean.slice(188 * 500, 188 * 1200), Buffer.alloc(77, 0x47), clean.slice(188 * 1200)];
  const dirty = Buffer.concat(parts);
  r = await run(dirty, [1316, 4096, 1000, 99]);
  ok('stray bytes are dropped and every packet after them is aligned', aligned(r.out), r.out.length % 188);
  const got = ids(r.out), lost = 2000 - got.length;
  ok('only packets touching the junk are lost', lost <= 4 && got[got.length - 1] === ids(clean)[1999], 'lost ' + lost);
  ok('drops are reported', r.drops.reduce((a, b) => a + b, 0) >= 5003 + 77);

  r = await run(Buffer.concat([Buffer.from('xx garbage header '), clean]), [500]);
  ok('junk before the first packet is skipped', aligned(r.out) && r.out.length === clean.length);

  const html = Buffer.from('<html><body>' + 'Service unavailable. '.repeat(5000) + '</body></html>');
  r = await run(html, [4096]);
  ok('something that is not TS passes through untouched', r.out.equals(html));

  const m2ts = Buffer.alloc(192 * 600); for (let i = 0; i < 600; i++) { m2ts[i * 192 + 4] = 0x47; }
  r = await run(m2ts, [8192]);
  ok('192-byte packets (M2TS) pass through untouched', r.out.equals(m2ts));

  r = await run(clean.slice(0, 188 * 10 + 100), [188 * 10 + 100]);
  ok('a partial last packet is not invented or lost silently', r.out.length === 188 * 10 + 100 || r.out.length === 188 * 10);

  console.log(fail ? fail + ' failures' : 'all TS resync tests passed');
  process.exit(fail ? 1 : 0);
})();
