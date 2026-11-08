// Live channels through the helper (service/proxy.js), for the provider's connection limit and the TV's CPU:
// - a new live channel on the same account lets go of an older one that has gone quiet (a stalled stream the
//   app is reconnecting, whose request is still open), before it asks the provider for the new one; one still
//   streaming is left alone;
// - another account's channel is left alone;
// - a live channel that goes quiet is given up sooner than other requests;
// - HLS segments (they say how long they are) pass straight through with their length, not resynced;
// - TsSync keeps packets whole when chunks end mid-packet (service/tssync.js), without copying each chunk.
//   node tests/unit/proxy-live.test.js
'use strict';
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
const TsSync = require(path.join(__dirname, '../../service/tssync.js')).TsSync;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PKT = 188;
const T0 = Date.now();
let SEG = null;
// n packets on PID 0x100; the first starts a video PES (PTS = time since the test began) with an H.264 SPS, as
// a keyframe would: the helper starts a reconnected stream at one, and holds back a frame until the next starts.
function packets(n, seq, shift) {
  const b = Buffer.alloc(PKT * n, 0xff);
  for (let i = 0; i < n; i++) { b[i * PKT] = 0x47; b[i * PKT + 1] = 0x01; b[i * PKT + 2] = 0x00; b[i * PKT + 3] = 0x10 | (seq & 0x0f); }
  const pts = Math.max(0, Math.round((Date.now() - T0) * 90) + 90000 * 100 - (shift || 0) * 90000);
  b[1] = 0x41;                                                     // payload_unit_start
  Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5,
    0x21 | ((Math.floor(pts / 1073741824) & 7) << 1), (pts >> 22) & 0xff, (((pts >> 15) & 0x7f) << 1) | 1, (pts >> 7) & 0xff, ((pts & 0x7f) << 1) | 1,
    0, 0, 0, 1, 0x67, 0x42]).copy(b, 4);
  return b;
}

(async () => {
  SEG = packets(40, 1);
  // liveKey
  const k = (u) => proxy.liveKey(require('url').parse(u));
  ok('liveKey: /live/user/pass/123.ts', k('http://Host:8080/live/bob/pw/123.ts') === 'host:8080|bob', k('http://Host:8080/live/bob/pw/123.ts'));
  ok('liveKey: the short form, and without .ts', k('http://h/bob/pw/123.ts') === 'h|bob' && k('http://h/live/bob/pw/123') === 'h|bob');
  ok('liveKey: not movies, series, playlists or segments', !k('http://h/movie/bob/pw/12.mkv') && !k('http://h/series/bob/pw/12.mp4') && !k('http://h/live/bob/pw/12.m3u8') && !k('http://h/hls/abc/0.ts'));

  // The "provider": live channels that send packets every 50 ms until the viewer goes; one that goes quiet;
  // and an HLS segment.
  const open = {}, closed = {}, stalled = {};
  const up = http.createServer((req, res) => {
    const p = req.url;
    if (/\/seg\.ts$/.test(p)) { const b = SEG; res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': b.length }); return res.end(b); }
    open[p] = (open[p] || 0) + 1;
    req.on('close', () => { closed[p] = (closed[p] || 0) + 1; });
    if (/\/live\/redir\//.test(p)) { res.writeHead(302, { Location: '/edge/tok' + open[p] + '.ts' }); return res.end(); }
    if (/\/edge\//.test(p)) { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); res.write(packets(10, 7)); res.write(packets(10, 7)); res.write(packets(10, 7)); return setTimeout(() => res.end(), 150); }
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    if (/\/quiet\//.test(p)) { res.write(packets(10, 2)); return; }          // then nothing
    if (/\/back\//.test(p)) {                                        // a channel restarted: its clock went back a minute
      const sh = open[p] > 1 ? 60 : 0;
      res.write(packets(10, 5, sh)); res.write(packets(10, 5, sh)); res.write(packets(10, 5, sh));
      return setTimeout(() => res.end(), 150);
    }
    if (/\/drop\//.test(p)) { res.write(packets(30, 4)); return setTimeout(() => res.end(packets(3, 4)), 150); }    // hangs up
    const t = setInterval(() => { if (stalled[p]) return; try { res.write(packets(20, 3)); } catch (e) { clearInterval(t); } }, 50);
    res.on('close', () => clearInterval(t));
  });
  await new Promise((f) => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({ liveTimeout: 5000, liveGiveUp: 2500, timeout: 8000 });
  await new Promise((f) => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port + '/x/http/' + U;
  // A helper that gives up on a quiet channel sooner (600 ms), for the quiet channel below.
  const r2 = proxy.create({ liveTimeout: 600, liveGiveUp: 2500, timeout: 8000 });
  await new Promise((f) => r2.server.listen(0, '127.0.0.1', f));
  const B2 = 'http://127.0.0.1:' + r2.server.address().port + '/x/http/' + U;

  // A client that keeps reading and notes how its response ended.
  function watch(url) {
    const w = { bytes: 0, ended: false, status: 0, headers: null };
    w.req = http.get(url, (rs) => {
      w.status = rs.statusCode; w.headers = rs.headers;
      rs.on('data', (d) => { w.bytes += d.length; });
      rs.on('end', () => { w.ended = true; });
      rs.on('aborted', () => { w.ended = true; });
      rs.on('error', () => { w.ended = true; });
      rs.on('close', () => { w.ended = true; });
    });
    w.req.on('error', () => { w.ended = true; });
    return w;
  }

  const a = watch(B + '/live/bob/pw/1.ts');
  await wait(400);
  ok('a live channel streams through', a.status === 200 && a.bytes > 0 && !a.ended, JSON.stringify({ s: a.status, b: a.bytes }));
  const other = watch(B + '/live/amy/pw/7.ts');
  await wait(300);
  const b0 = watch(B + '/live/bob/pw/4.ts');           // a second one on the account while the first streams
  await wait(400);
  ok('a second channel on the same account leaves the first alone while it streams', !closed['/live/bob/pw/1.ts'] && !a.ended && b0.bytes > 0, JSON.stringify(closed));
  try { b0.req.destroy(); } catch (x) {}
  // The first one stalls (its client never closes it): after 3 s it is fair game.
  stalled['/live/bob/pw/1.ts'] = 1;
  await wait(3300);
  const b = watch(B + '/live/bob/pw/2.ts');
  await wait(500);
  ok('a new channel on the same account lets go of an older one that has stalled, provider side', closed['/live/bob/pw/1.ts'] === 1, JSON.stringify(closed));
  ok('and the older one\'s client sees it end', a.ended);
  ok('the new one streams', b.status === 200 && b.bytes > 0 && !b.ended, JSON.stringify({ s: b.status, b: b.bytes }));
  ok('another account\'s channel is left alone', !closed['/live/amy/pw/7.ts'] && !other.ended && other.bytes > 0, JSON.stringify(closed));

  // The provider hangs up: the helper connects again by itself and the app's response carries on.
  const d = watch(B + '/live/drop/pw/5.ts');
  await wait(1600);
  ok('a live channel the provider hangs up on: the helper reconnects, the app\'s stream carries on', open['/live/drop/pw/5.ts'] >= 3 && !d.ended && d.bytes >= 33 * 3 * PKT && d.bytes % PKT === 0, JSON.stringify({ opens: open['/live/drop/pw/5.ts'], bytes: d.bytes, ended: d.ended }));
  try { d.req.destroy(); } catch (e) {}

  // A panel that answers with a redirect to a tokenized edge address: the app follows it (307 to the relayed
  // edge address), and when the edge hangs up the helper asks the panel's own address again (a new token).
  const first = await new Promise((res) => http.get(B + '/live/redir/pw/3.ts', (rs) => { rs.resume(); res(rs); }));
  ok('a redirect comes back as the relayed edge address', (first.statusCode === 302 || first.statusCode === 307) && /\/edge\/tok1\.ts$/.test(first.headers.location || ''), first.statusCode + ' ' + first.headers.location);
  const e = watch(first.headers.location);
  await wait(1500);
  ok('the edge hanging up: the helper goes back to the panel for a fresh address, the app\'s stream carries on', open['/live/redir/pw/3.ts'] >= 2 && (open['/edge/tok2.ts'] || 0) >= 1 && !e.ended && e.bytes >= 60 * PKT, JSON.stringify({ open, bytes: e.bytes, ended: e.ended }));
  try { e.req.destroy(); } catch (x) {}

  // The provider restarted the channel (its clock went back): the helper ends the response, the app starts afresh.
  const bk = watch(B + '/live/back/pw/8.ts');
  await wait(1500);
  ok('a channel whose clock went back on reconnecting: the response ends, so the app starts it afresh', bk.ended && open['/live/back/pw/8.ts'] === 2, JSON.stringify({ ended: bk.ended, opens: open['/live/back/pw/8.ts'] }));

  // A frame cut off by a broken connection is never passed on (FrameHold).
  const FH = require(path.join(__dirname, '../../service/tssync.js')).FrameHold;
  const fh = new FH(), outB = [];
  fh.on('data', (x) => outB.push(x));
  fh.write(packets(5, 1)); fh.write(packets(5, 2)); fh.write(packets(3, 3));
  const dropped = fh.drop();
  ok('FrameHold: the frame still coming in when the connection broke is dropped, the whole ones pass', Buffer.concat(outB).length === 10 * PKT && dropped === 3 * PKT, Buffer.concat(outB).length + ' ' + dropped);
  const kp = packets(2, 1);
  ok('keyStart and pesPts find a keyframe and its time', proxy.keyStart(kp) === 0 && proxy.pesPts(kp, 0) > 0 && proxy.lastPts(kp) === proxy.pesPts(kp, 0));

  // Goes quiet: the helper tries again after the live timeout (600 ms here, not the general 5 s), and gives up
  // when nothing has come for a while (2.5 s here, 12 s normally): then the app reconnects itself.
  const q = watch(B2 + '/live/quiet/pw/9.ts');
  await wait(1500);
  const qMid = { ended: q.ended, opens: open['/live/quiet/pw/9.ts'] };
  for (let i = 0; i < 40 && !q.ended; i++) await wait(250);
  ok('a live channel that goes quiet is asked for again', qMid.opens >= 2 && !qMid.ended, JSON.stringify(qMid));
  ok('and let go when it keeps going quiet (6 tries a minute; then the app reconnects)', q.ended && open['/live/quiet/pw/9.ts'] <= 8, JSON.stringify({ ended: q.ended, opens: open['/live/quiet/pw/9.ts'] }));

  // An HLS segment: its length kept, bytes as they were.
  const s = await new Promise((res) => http.get(B + '/hls/seg.ts', (rs) => { const bufs = []; rs.on('data', (d) => bufs.push(d)); rs.on('end', () => res({ h: rs.headers, b: Buffer.concat(bufs) })); }));
  ok('an HLS segment keeps its length and its bytes', +s.h['content-length'] === 40 * PKT && s.b.equals(SEG), JSON.stringify(s.h));

  [a, b, other, q].forEach((w) => { try { w.req.destroy(); } catch (e) {} });
  await wait(200);
  r.server.close(); r2.server.close(); up.close();

  // TsSync: chunks that end mid-packet come out as whole packets, in order, nothing dropped.
  const src = Buffer.concat([packets(50, 5), packets(50, 6)]);
  const out = await new Promise((res) => {
    const sync = new TsSync(), bufs = [];
    sync.on('data', (d) => bufs.push(d)); sync.on('end', () => res(Buffer.concat(bufs)));
    let i = 0; const sizes = [1000, 777, 188, 5, 3000, 4100];
    while (i < src.length) { const n = sizes[i % sizes.length]; sync.write(src.slice(i, i + n)); i += n; }
    sync.end();
  });
  ok('TsSync: chunks split mid-packet come out whole and unchanged', out.equals(src), out.length + ' of ' + src.length);
  const parts = [];
  await new Promise((res) => {
    const sync = new TsSync(); sync.on('data', (d) => parts.push(d.length)); sync.on('end', res);
    sync.write(src.slice(0, 1000)); sync.write(src.slice(1000, 3000)); sync.end();
  });
  ok('TsSync: every piece it passes on is whole packets', parts.every((n) => n % PKT === 0), JSON.stringify(parts));

  console.log(fails ? fails + ' FAILED' : 'all live relay checks passed');
  process.exit(fails ? 1 : 0);
})();
