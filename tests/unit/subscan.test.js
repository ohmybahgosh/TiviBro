/* The helper's subtitle pass (service/subscan.js): Matroska Clusters streamed in pieces of any size, video
   and audio blocks skipped, subtitle blocks (SimpleBlock, and Block inside a BlockGroup with its duration)
   read with their times, and what the pass has covered.
     node tests/unit/subscan.test.js */
'use strict';
const { Reader } = require('../../service/subscan.js')._test;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

// EBML element: id bytes, a size as an 8-byte vint, then the payload.
function el(id, payload) {
  const ids = []; let v = id; while (v > 0) { ids.unshift(v & 0xFF); v = Math.floor(v / 256); }
  const size = Buffer.alloc(8); let n = payload.length;
  for (let i = 7; i >= 1; i--) { size[i] = n & 0xFF; n = Math.floor(n / 256); }
  size[0] = 0x01;
  return Buffer.concat([Buffer.from(ids), size, payload]);
}
function uint(n) { return Buffer.from([n >> 8 & 0xFF, n & 0xFF]); }
function block(track, rel, data) { const h = Buffer.from([0x80 | track, (rel >> 8) & 0xFF, rel & 0xFF, 0x00]); return Buffer.concat([h, Buffer.from(data)]); }
const video = Buffer.alloc(300000, 7);
const cluster = (tc, inner) => el(0x1F43B675, Buffer.concat([el(0xE7, uint(tc))].concat(inner)));
const file = Buffer.concat([
  cluster(1000, [el(0xA3, block(1, 0, video)), el(0xA0, Buffer.concat([el(0xA1, block(7, 500, 'Hello')), el(0x9B, uint(1500))])), el(0xA3, block(2, 10, 'audio'))]),
  el(0x1C53BB6B, Buffer.alloc(50, 1)),                     // something that isn't a Cluster (Cues): skipped
  cluster(5000, [el(0xA3, block(7, 0, 'Second line')), el(0xA3, block(1, 5, video))]),
]);
for (const piece of [1, 7, 4096, 1e9]) {
  const lines = [], times = [];
  const feed = Reader([7], 1000000, (t, s, e, text) => lines.push([t, s, e, text]), (sec) => times.push(sec));
  for (let i = 0; i < file.length; i += piece) feed(file.slice(i, i + piece));
  ok('pieces of ' + piece + ' bytes: both lines, with their times and duration', lines.length === 2 && lines[0][3] === 'Hello' && lines[0][1] === 1.5 && lines[0][2] === 3 &&
    lines[1][3] === 'Second line' && lines[1][1] === 5 && lines[1][2] === 7, lines);
  ok('pieces of ' + piece + ' bytes: the clusters\' times, for what is covered', times.join() === '1,5', times);
}
const other = [];
const feed2 = Reader([3], 1000000, (t, s, e, text) => other.push(text), () => {});
feed2(file);
ok('a track not asked for: nothing', other.length === 0, other);
// The whole pass over HTTP: from the second Cluster to the end, then the first; lines and what's covered.
const http = require('http'), S = require('../../service/subscan.js');
const c1 = cluster(1000, [el(0xA3, block(1, 0, video)), el(0xA3, block(7, 100, 'One'))]), c2 = cluster(5000, [el(0xA3, block(7, 0, 'Two')), el(0xA3, block(1, 5, video))]);
const body = Buffer.concat([Buffer.alloc(40, 0xEC), c1, c2]);         // 40 bytes standing in for the header
const srv = http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || ''), a = +m[1], b = Math.min(+m[2], body.length - 1);
  res.writeHead(206, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + body.length, 'Content-Length': b - a + 1 });
  res.end(body.slice(a, b + 1));
}).listen(0, () => {
  const url = 'http://127.0.0.1:' + srv.address().port + '/ep.mkv';
  S.scan({ url, size: body.length, from: 40 + c1.length, first: 40, scale: 1000000, tracks: [7] }, (r) => {
    const wait = () => S.lines({ key: r.key, since: {} }, (j) => {
      if (!j.done) return setTimeout(wait, 20);
      const got = (j.lines[7] || []).map(l => l[2]).sort().join();
      ok('the pass over HTTP: both Clusters\' lines, the playing one first', got === 'One,Two' && j.lines[7][0][2] === 'Two', j);
      ok('covered: from the playing position to the end, and the start', j.covered.length === 2 && j.covered[0][1] === 1e9 && j.covered[1][0] === 1 && j.covered[1][1] === 5, j.covered);
      S.lines({ key: r.key, since: { 7: 2 } }, (k) => {
        ok('asked again with what it has: nothing new', k.lines[7].length === 0, k);
        srv.close();
        console.log(fails ? fails + ' subscan test(s) failed' : 'all subscan tests passed');
        process.exit(fails ? 1 : 0);
      });
    });
    wait();
  });
});
