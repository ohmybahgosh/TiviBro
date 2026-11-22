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
// Read from the bytes passing through the proxy: an answer that began before the app asked (the player's
// first read), one starting mid-Cluster (a seek), and a file nobody asked for.
const S = require('../../service/subscan.js');
const c1 = cluster(1000, [el(0xA3, block(1, 0, video)), el(0xA3, block(7, 100, 'One'))]), c2 = cluster(5000, [el(0xA3, block(7, 0, 'Two')), el(0xA3, block(1, 5, video))]);
const body = Buffer.concat([Buffer.alloc(40, 0xEC), c1, c2, Buffer.alloc(800000, 3)]);   // header, two Clusters, the rest of a big file
const total = body.length, cr = (a) => 'bytes ' + a + '-' + (total - 1) + '/' + total;
const pass = (t, a, step) => { for (let i = a; i < total; i += step) t(body.slice(i, Math.min(total, i + step))); };
const early = S.tap(cr(0));                                  // the player's first answer, before the app asks
early(body.slice(0, 30));
S.scan({ size: total, scale: 1000000, tracks: [7], clusters: [40, 40 + c1.length] }, (r) => {
  pass(early, 30, 777);
  S.lines({ key: r.key, since: {} }, (j) => {
    ok('an answer under way when the app asked: its lines from the next Cluster on', (j.lines[7] || []).map(l => l[2]).join() === 'One,Two' && j.seen > 0, j);
    const seek = S.tap(cr(40 + 20));                         // mid-Cluster: starts at the next one
    pass(seek, 60, 4096);
    S.lines({ key: r.key, since: { 7: 2 } }, (k) => {
      ok('a seek mid-Cluster: nothing doubled, the next Cluster read', k.lines[7].length === 0 && k.covered.length === 2 && k.covered[1][0] === 5, k);
      ok('a file nobody asked for is not watched', S.tap('bytes 0-99/' + (total + 1))(Buffer.alloc(10)) === undefined && S.tap('bytes 0-9/500') === null);
      console.log(fails ? fails + ' subscan test(s) failed' : 'all subscan tests passed');
      process.exit(fails ? 1 : 0);
    });
  });
});
