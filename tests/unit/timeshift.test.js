/* Live pause (service/timeshift.js, through record.js's routes): an MPEG-TS channel cut into pieces at keyframes,
   each starting with PAT and PMT, their lengths from the timestamps; a live HLS playlist of them that grows, keeps
   to its limit and marks a reconnect; an HLS channel's own pieces kept; nobody asking: stopped and deleted. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-ts-'));
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_TS_IDLE_MS = '1500';
process.env.TIVIBRO_TS_RETRY_MS = '100';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
const R = require('../../service/record');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
function call(method, url, body) {
  return new Promise((resolve) => {
    const req = { method, url, headers: {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); }, pause() {}, resume() {} };
    let code = 0, hdr = {}, chunks = [];
    const res = { writeHead(c, h) { code = c; hdr = h || {}; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true; }, end(c) { if (c) chunks.push(Buffer.from(c)); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, hdr, body: b, j }); },
      on() {}, once() {}, emit() {}, removeListener() {} };
    R.handle(req, res, {}, () => {});
  });
}

/* ---- a little MPEG-TS muxer: PAT, PMT (H.264 on 0x100), one PES per frame at 25 fps, an IDR every 2 s ---- */
let cc = {};
function pkt(pid, pusi, payload) {
  const p = Buffer.alloc(188, 0xff);
  p[0] = 0x47; p[1] = (pusi ? 0x40 : 0) | (pid >> 8); p[2] = pid & 0xff;
  cc[pid] = ((cc[pid] || 0) + 1) & 15;
  const room = 184;
  if (payload.length < room) {                      // stuffing in an adaptation field
    const stuff = room - payload.length;
    p[3] = 0x30 | cc[pid]; p[4] = stuff - 1; if (stuff > 1) p[5] = 0;
    payload.copy(p, 4 + stuff);
  } else { p[3] = 0x10 | cc[pid]; payload.copy(p, 4, 0, room); }
  return p;
}
function psi(table) { return Buffer.concat([Buffer.from([0]), table]); }
const PAT = pkt(0, true, psi(Buffer.from([0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xf0, 0x00, 0, 0, 0, 0])));
const PMT = pkt(0x1000, true, psi(Buffer.from([0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00, 0x1b, 0xe1, 0x00, 0xf0, 0x00, 0, 0, 0, 0])));
function ptsBytes(t) { return Buffer.from([0x21 | ((t / 536870912 & 7) << 1), (t >> 22) & 0xff, ((t >> 14) & 0xfe) | 1, (t >> 7) & 0xff, ((t << 1) & 0xfe) | 1]); }
function frame(i) {
  const pts = 90000 + i * 3600, key = i % 50 === 0;
  const es = Buffer.concat([Buffer.from([0, 0, 1, 0x09, 0xf0]), key ? Buffer.from([0, 0, 1, 0x67, 1, 2, 3, 0, 0, 1, 0x65]) : Buffer.from([0, 0, 1, 0x41]), Buffer.alloc(300, 0xaa)]);
  const pes = Buffer.concat([Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5]), ptsBytes(pts), es]);
  const out = [pkt(0x100, true, pes.slice(0, 184))];
  for (let o = 184; o < pes.length; o += 184) out.push(pkt(0x100, false, pes.slice(o, o + 184)));
  return Buffer.concat(out);
}
function stream(from, to) { const parts = []; for (let i = from; i < to; i++) { if (i % 25 === 0) parts.push(PAT, PMT); parts.push(frame(i)); } return Buffer.concat(parts); }

(async () => {
  let hangup = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      // The first connection: 40 s of picture in bursts, then a hang-up; the second carries on from 40 s.
      const first = hangup++ === 0, from = first ? 0 : 1000, to = first ? 1000 : 2400;
      let i = from;
      const iv = setInterval(() => { if (i >= to) { clearInterval(iv); if (first) res.destroy(); return; } res.write(stream(i, Math.min(to, i + 100))); i += 100; }, 15);
      req.on('close', () => clearInterval(iv));
      return;
    }
    if (req.url === '/live.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      const s = Math.floor(Date.now() / 1000);
      return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:' + s + '\n' + [0, 1, 2].map((k) => '#EXTINF:2.0,\nseg' + (s + k) + '.ts\n').join(''));
    }
    const m = /^\/seg(\d+)\.ts$/.exec(req.url);
    if (m) { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end('[' + m[1] + ']'); }
    res.writeHead(404); res.end();
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const base = 'http://127.0.0.1:' + srv.address().port;

  let r = await call('POST', '/record/ts/start', { url: base + '/ts' });
  ok('no USB drive: refused with code nodrive', r.code === 409 && r.j.code === 'nodrive', r.code);
  const drive = path.join(tmp, 'usb', 'sda', 'sda1'); fs.mkdirSync(drive, { recursive: true });

  r = await call('POST', '/record/ts/start', { url: base + '/ts', max: 60 });
  const id = r.j.id;
  ok('a session starts', r.code === 200 && /^t/.test(id) && r.j.playlist === '/record/ts/' + id + '/live.m3u8', JSON.stringify(r.j));
  const again = await call('POST', '/record/ts/start', { url: base + '/ts' });
  ok('the same channel again: the same session', again.j.id === id);
  await wait(1200);
  r = await call('POST', '/record/ts/ping', { id });
  ok('pieces arrive', r.j.pieces >= 5, JSON.stringify(r.j));
  let pl = (await call('GET', '/record/ts/' + id + '/live.m3u8')).body.toString();
  const durs = (pl.match(/#EXTINF:([\d.]+)/g) || []).map((x) => +x.slice(8));
  ok('an HLS playlist, no end while running', /^#EXTM3U/.test(pl) && !/ENDLIST/.test(pl) && /#EXT-X-PROGRAM-DATE-TIME:/.test(pl), pl.slice(0, 200));
  ok('pieces of 4 s, cut at keyframes (2 s apart), from the timestamps', durs.length >= 5 && durs.slice(0, -1).every((d) => Math.abs(d - 4) < 0.01), durs.join(' '));
  const first = pl.split('\n').filter((l) => /^\d+\.ts$/.test(l))[0];
  const piece = (await call('GET', '/record/ts/' + id + '/' + first)).body;
  const pid = (b, o) => ((b[o + 1] & 0x1f) << 8) | b[o + 2];
  ok('a piece starts with PAT and PMT', piece.length % 188 === 0 && pid(piece, 0) === 0 && pid(piece, 188) === 0x1000, piece.length);
  let keyAt = -1; for (let o = 376; o < piece.length; o += 188) if (pid(piece, o) === 0x100 && piece[o + 1] & 0x40) { keyAt = o; break; }
  ok('then a keyframe', keyAt > 0 && piece.indexOf(Buffer.from([0, 0, 1, 0x65]), keyAt) > keyAt && piece.indexOf(Buffer.from([0, 0, 1, 0x65]), keyAt) < keyAt + 188, keyAt);

  // The hang-up: a reconnect, marked; past 60 s the oldest pieces go.
  await wait(2500);
  pl = (await call('GET', '/record/ts/' + id + '/live.m3u8')).body.toString();
  const seq = +(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(pl) || [])[1];
  const sum = (pl.match(/#EXTINF:([\d.]+)/g) || []).map((x) => +x.slice(8)).reduce((a, b) => a + b, 0);
  ok('a reconnect is marked in the playlist', /#EXT-X-DISCONTINUITY\n/.test(pl), pl.length);
  ok('kept to its limit: the oldest pieces dropped', seq > 0 && sum <= 64 && sum >= 50, seq + ' / ' + sum.toFixed(1) + ' s');
  const files = fs.readdirSync(path.join(drive, 'TiviBro Recordings', '.timeshift', id)).length;
  ok('and deleted from the drive', files <= (pl.match(/^\d+\.ts$/mg) || []).length + 1, files);
  r = await call('GET', '/record/ts/' + id + '/0.ts');
  ok('a dropped piece is gone', r.code === 404);

  // HLS from the provider: its pieces kept as they come.
  r = await call('POST', '/record/ts/start', { url: base + '/live.m3u8' });
  const hid = r.j.id;
  await wait(3500);
  pl = (await call('GET', '/record/ts/' + hid + '/live.m3u8')).body.toString();
  const segs = pl.split('\n').filter((l) => /^\d+\.ts$/.test(l));
  const bodies = await Promise.all(segs.map((s) => call('GET', '/record/ts/' + hid + '/' + s).then((x) => x.body.toString())));
  const nums = bodies.map((b) => +b.slice(1, -1));
  ok('HLS: the provider\'s pieces, in order, none twice', nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), nums.join(' '));
  ok('HLS: their lengths from the provider\'s playlist', /#EXTINF:2\.000,/.test(pl));

  // Two at most: a third pushes out the oldest.
  r = await call('POST', '/record/ts/start', { url: base + '/live.m3u8?x=2' });
  ok('a third session: the oldest stops', (await call('POST', '/record/ts/ping', { id })).code === 404);

  // Stop: gone, and its pieces deleted; nobody asking: stopped too.
  await call('POST', '/record/ts/stop', { id: hid });
  await wait(1700);
  ok('stop deletes its pieces', !fs.existsSync(path.join(drive, 'TiviBro Recordings', '.timeshift', hid)));
  await wait(11000);
  ok('nobody asking for a while: stopped', (await call('POST', '/record/ts/ping', { id: r.j.id })).code === 404);
  ok('the player\'s addresses need no secret (proxy and agent)', /\/record\/ts\/.*!== 'POST'/.test(fs.readFileSync(path.join(__dirname, '../../service/proxy.js'), 'utf8')) && /\/record\/ts\/.*!== 'POST'/.test(fs.readFileSync(path.join(__dirname, '../../service/record-agent.js'), 'utf8')));

  R._reset(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fail) { console.log(fail + ' timeshift test(s) failed'); process.exit(1); }
  console.log('all timeshift tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
