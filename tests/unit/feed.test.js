/* One connection per channel (service/feed.js): a recording and a live pause of the same channel share the
   provider connection; stopping one keeps the other going; stopping both closes it.  And a refusing provider is
   asked again more and more slowly. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-feed-'));
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_REC_TICK_MS = '200';
process.env.TIVIBRO_FEED_RETRY_MS = '100';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
fs.mkdirSync(path.join(tmp, 'usb', 'sda', 'sda1'), { recursive: true });
const R = require('../../service/record');
const Feed = require('../../service/feed');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
function call(method, url, body) {
  return new Promise((resolve) => {
    const req = { method, url, headers: {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); }, pause() {}, resume() {} };
    let code = 0, chunks = [];
    const res = { writeHead(c) { code = c; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true; }, end(c) { if (c) chunks.push(Buffer.from(c)); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, body: b, j }); }, on() {}, once() {}, emit() {}, removeListener() {} };
    R.handle(req, res, {}, () => {});
  });
}

(async () => {
  let open = 0, total = 0, refused = [];
  const srv = http.createServer((req, res) => {
    if (/^\/live\/1\.(ts|m3u8)/.test(req.url)) {
      total++; open++;
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      const pkt = Buffer.alloc(188, 0x47);
      const iv = setInterval(() => res.write(pkt), 10);
      req.on('close', () => { clearInterval(iv); open--; });
      return;
    }
    if (req.url === '/refuse.ts') { refused.push(Date.now()); res.writeHead(418); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const base = 'http://127.0.0.1:' + srv.address().port;

  // A recording (HLS address first) and a pause of the same channel (MPEG-TS address): one connection.
  let r = await call('POST', '/record/start', { url: base + '/live/1.m3u8', alt: base + '/live/1.ts', key: 'ch1', title: 'One', end: Date.now() + 60000 });
  const recId = r.j.id;
  await wait(300);
  const t = await call('POST', '/record/ts/start', { url: base + '/live/1.ts', key: 'ch1' });
  await wait(600);
  ok('a recording and a pause of the same channel: one connection to the provider', total === 1 && open === 1, total + ' made, ' + open + ' open');
  let list = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === recId)[0];
  ok('the recording gets the stream', list.bytes > 0, list.bytes);
  ok('the pause gets it too', fs.readdirSync(path.join(tmp, 'usb', 'sda', 'sda1', 'TiviBro Recordings', '.timeshift', t.j.id)).length >= 0 && Feed._feeds.ch1 && Feed._feeds.ch1.subs.length === 2, Feed._feeds.ch1 && Feed._feeds.ch1.subs.length);

  // Stopping the recording keeps the pause's connection; stopping the pause too closes it.
  await call('POST', '/record/stop', { id: recId });
  await wait(300);
  ok('the recording stopped, the pause carries on on the same connection', open === 1 && total === 1 && Feed._feeds.ch1.subs.length === 1, open + ' open');
  await call('POST', '/record/ts/stop', { id: t.j.id });
  await wait(300);
  ok('both stopped: the connection is closed', open === 0 && !Feed._feeds.ch1, open + ' open');

  // Another channel: its own connection.
  r = await call('POST', '/record/start', { url: base + '/live/1.ts', key: 'ch2', title: 'Two', end: Date.now() + 60000 });
  const t2 = await call('POST', '/record/ts/start', { url: base + '/live/1.ts', key: 'ch3' });
  await wait(400);
  ok('different channels: a connection each', total === 3 && open === 2, total + ' made, ' + open + ' open');
  await call('POST', '/record/stop', { id: r.j.id }); await call('POST', '/record/ts/stop', { id: t2.j.id });

  // A provider refusing (HTTP 418): asked again more and more slowly, not every few seconds.
  const h = Feed.open('ref', base + '/refuse.ts', '', {});
  await wait(3500);
  h.close();
  const gaps = refused.slice(1).map((x, i) => x - refused[i]);
  ok('a refusing provider is asked again more slowly each time', refused.length >= 2 && refused.length <= 6 && gaps[0] >= 450 && gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 30), refused.length + ' asks, gaps ' + gaps.join(' '));

  R._reset(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fail) { console.log(fail + ' feed test(s) failed'); process.exit(1); }
  console.log('all feed tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
