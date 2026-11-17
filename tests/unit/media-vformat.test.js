// A movie's picture from its file's headers (service/media-vformat.js): MKV Colour and Dolby Vision mapping, MP4 boxes.
'use strict';
const assert = require('assert'), F = require('../../service/media-vformat');
function vint(n) { if (n < 127) return Buffer.from([0x80 | n]); if (n < 16383) return Buffer.from([0x40 | (n >> 8), n & 255]); const b = Buffer.alloc(4); b.writeUInt32BE(n); b[0] |= 0x10; return b; }
function idb(id) { const h = id.toString(16); return Buffer.from(h.length % 2 ? '0' + h : h, 'hex'); }
function E(id, ...parts) { const body = Buffer.concat(parts.map((p) => typeof p === 'number' ? Buffer.from([p]) : p)); return Buffer.concat([idb(id), vint(body.length), body]); }
function U(id, v, n) { const b = Buffer.alloc(n || 2); b.writeUIntBE(v, 0, n || 2); return E(id, b); }
function mkv(trc, dv, pad, deep) {
  const video = E(0xe0, U(0xba, 2160), U(0xb0, deep ? 3840 : 0), trc ? E(0x55b0, U(0x55ba, trc, 1)) : Buffer.alloc(0));
  const entry = E(0xae, U(0x83, 1, 1), video, dv ? E(0x41e4, U(0x41e7, 0x64766343, 4)) : Buffer.alloc(0), deep ? E(0x63a2, Buffer.from([1, 0x22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 153, 0xf0, 0, 0xfc, 0xfd, 0xf8 | deep, 0xf8 | deep, 0, 0, 0x0f, 0])) : Buffer.alloc(0));
  if (!pad) return Buffer.concat([E(0x1a45dfa3, U(0x4286, 1, 1)), E(0x18538067, E(0x1654ae6b, entry))]);
  // Far into the file, as Radarr's often are: the SeekHead says where.
  const seek = (off) => E(0x114d9b74, E(0x4dbb, E(0x53ab, idb(0x1654ae6b)), U(0x53ac, off, 4)));
  const head = seek(0), voidEl = E(0xec, Buffer.alloc(pad)), off = head.length + voidEl.length;
  return Buffer.concat([E(0x1a45dfa3, U(0x4286, 1, 1)), E(0x18538067, seek(off), voidEl, E(0x1654ae6b, entry))]);
}
function run(buf, ext) { return new Promise((res, rej) => F.inspect((o, l, cb) => cb(null, buf.slice(o, o + l)), buf.length, ext, (e, r) => e ? rej(e) : res(r))); }
(async () => {
  assert.deepEqual(await run(mkv(16, true), 'mkv'), { height: 2160, range: 'DV', width: 0 });
  assert.deepEqual(await run(mkv(16, false), 'mkv'), { height: 2160, range: 'HDR10', width: 0 });
  assert.deepEqual(await run(mkv(18, false), 'mkv'), { height: 2160, range: 'HLG', width: 0 });
  assert.deepEqual(await run(mkv(1, false), 'mkv'), { height: 2160, range: 'SDR', width: 0 });
  assert.deepEqual(await run(mkv(0, false), 'mkv'), { height: 2160, range: '', width: 0 }, 'no Colour: not known');
  assert.equal((await run(mkv(16, true, 600000), 'mkv')).range, 'DV', 'Tracks past the first read');
  assert.deepEqual(await run(mkv(0, false, 0, 2), 'mkv'), { height: 2160, width: 3840, range: 'HDR' }, '10-bit 4K HEVC, no Colour: HDR');
  assert.equal((await run(mkv(0, false, 0, 0), 'mkv')).range, '', '8-bit: not known');
  const moov = Buffer.concat([Buffer.from('....colrnclx'), Buffer.from([0, 9, 0, 16, 0, 9])]); moov.writeUInt32BE(18, 0);
  const box = (t, b) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + b.length); h.write(t, 4, 'binary'); return Buffer.concat([h, b]); };
  const mp4 = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(1000)), box('moov', Buffer.concat([Buffer.from('xxxx'), moov]))]);
  assert.equal((await run(mp4, 'mp4')).range, 'HDR10', 'moov at the end');
  const mp4dv = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', Buffer.from('....dvh1....dvcC....'))]);
  assert.equal((await run(mp4dv, 'mp4')).range, 'DV');
  // tkhd (version 0): width and height are its last 8 bytes; a wide 1080p film is 1920 x 800.
  const tk = Buffer.alloc(88); tk.write('tkhd', 0, 'binary'); tk.writeUInt32BE(1920 << 16, 80); tk.writeUInt32BE(800 << 16, 84);
  const mp4w = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', Buffer.concat([Buffer.from('xxxx'), tk]))]);
  const w = await run(mp4w, 'mp4'); assert.equal(w.width, 1920); assert.equal(w.height, 800);
  assert.deepEqual(await run(Buffer.alloc(100), 'avi'), { height: 0, range: '' });
  console.log('PASS media vformat');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
