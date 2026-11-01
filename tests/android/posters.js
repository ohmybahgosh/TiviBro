/* Posters for the stand-in TV (fake-tv.js), so the phone app's screenshots show artwork rather than
   empty tiles.  Drawn here as PNG (the app's image loader reads PNG, not SVG): a diagonal gradient in
   the demo provider's colours, a soft ring and a darker foot, like the TV demo's posters.  No text: the
   app writes the title under each poster.  Plain Node, no packages. */
'use strict';
const zlib = require('zlib');

const PALETTE = [['#ff5e62', '#ff9966'], ['#36d1dc', '#5b86e5'], ['#a770ef', '#fdb99b'], ['#11998e', '#38ef7d'], ['#f7971e', '#ffd200'],
  ['#ee0979', '#ff6a00'], ['#4568dc', '#b06ab3'], ['#00b09b', '#96c93d'], ['#e96443', '#904e95'], ['#43cea2', '#185a9d']];
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// Poster n (any number; the colours repeat), w x h pixels.
function poster(n, w = 300, h = 450) {
  const [a, b] = PALETTE[n % PALETTE.length].map(rgb);
  const cx = w * 0.62, cy = h * 0.3, r = w * 0.24, ring = w * 0.025;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, Math.max(0, (x / w + y / h) / 2));
      let px = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
      const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
      if (d < ring) px = px.map((v) => v + (255 - v) * 0.35 * (1 - d / ring));       // the ring
      const foot = Math.max(0, (y / h - 0.55) / 0.45);                                // darker toward the bottom
      px = px.map((v) => v * (1 - 0.6 * foot) + 14 * 0.6 * foot);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* Serve them: GET /p/<n>.png.  On all addresses, since the emulator reaches the host as 10.0.2.2. */
function serve(port) {
  const cache = {};
  return new Promise((resolve) => {
    require('http').createServer((req, res) => {
      const m = /^\/p\/(\d{1,3})\.png$/.exec(req.url);
      if (!m) { res.writeHead(404); return res.end(); }
      const png = cache[m[1]] || (cache[m[1]] = poster(+m[1]));
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'max-age=3600' });
      res.end(png);
    }).listen(port, '0.0.0.0', resolve);
  });
}

module.exports = { poster, serve };
