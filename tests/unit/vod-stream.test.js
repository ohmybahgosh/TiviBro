// The helper reads a provider's movie or show list as it arrives (service/vod.js streamArray): each title cut out
// of the stream and parsed alone, so a 60 MB list is never one string and one huge array at once (issue #166, the
// 1 GB TVs of #140 to #167).  Pieces split anywhere: inside a word, inside a UTF-8 character, inside an escape.
'use strict';
const http = require('http');
const V = require('../../service/vod.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
// A server that sends body in pieces of `size` bytes, a moment apart.
function serve(body, size, status) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      r.writeHead(status || 200, { 'Content-Type': 'application/json' });
      const b = Buffer.from(body, 'utf8'); let i = 0;
      (function next() { if (i >= b.length) return r.end(); r.write(b.slice(i, i += size)); setImmediate(next); })();
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}
function read(body, size, status) {
  return serve(body, size, status).then((s) => new Promise((res) => {
    const items = [];
    V._streamArray('http://127.0.0.1:' + s.address().port + '/', (x) => items.push(x), (e, got) => { s.close(); res({ e, got, items }); });
  }));
}
(async () => {
  const titles = [
    { stream_id: 1, name: 'Amélie [4K] {x}', stream_icon: 'http://i/1.jpg' },
    { stream_id: 2, name: 'Quote \\"inside\\" and ] } [ {', rating: '7' },
    { stream_id: 3, name: '日本の映画 🎬', category_id: '9', nested: { a: [1, { b: '}' }] } }
  ];
  const body = '﻿  ' + JSON.stringify(titles);
  for (const size of [1, 2, 3, 7, 64, 100000]) {
    const r = await read(body, size);
    ok('pieces of ' + size + ' bytes: every title, exactly', !r.e && r.got.array && r.got.n === 3 && JSON.stringify(r.items) === JSON.stringify(titles), JSON.stringify(r));
  }
  let r = await read('[]', 1);
  ok('an empty list is a list of none', !r.e && r.got.array && r.got.n === 0);
  r = await read('{"user_info":{"auth":0}}', 3);
  ok('an answer that is not a list comes back whole', !r.e && !r.got.array && r.got.value.user_info.auth === 0);
  r = await read(JSON.stringify(titles).slice(0, 60), 5);
  ok('a list cut off part way is an error, not a short list', !!r.e && /part way/.test(r.e.message), r.e && r.e.message);
  r = await read('[]', 1, 503);
  ok('an HTTP error is an error', !!r.e && /503/.test(r.e.message));
  r = await read('[{"stream_id":1},{"stream_id":2,"ok":tru},{"stream_id":3}]', 4);
  ok('one broken title is left out, the rest kept', !r.e && r.items.length === 2 && r.items[1].stream_id === 3, JSON.stringify(r));

  // A big list: 160,000 movies.  Read as it arrives, the helper never holds the whole answer as one string.
  const big = '[' + Array.from({ length: 160000 }, (_, i) => JSON.stringify({ num: i, name: 'Movie number ' + i + ' (2020)', stream_type: 'movie', stream_id: i, stream_icon: 'http://img.example/' + i + '.jpg', rating: '6.5', rating_5based: 3.2, added: '1700000000', category_id: String(i % 300), container_extension: 'mkv', custom_sid: '', direct_source: '' })).join(',') + ']';
  /* The old way first, for comparison: the whole answer as one string, then JSON.parse.  The heap is read where
     each way holds the most (a timer can't run while JSON.parse holds the thread): right after the parse, with
     the string and the titles both alive; and as each title arrives when read as it comes. */
  const heap = () => process.memoryUsage().heapUsed;
  const measure = async (read) => {
    if (global.gc) global.gc();
    const sv = await serve(big, 65536), b0 = heap();
    const r = await read('http://127.0.0.1:' + sv.address().port + '/', b0);
    sv.close(); return r;
  };
  const whole = await measure((u, b0) => new Promise((res) => http.get(u, (rs) => { const parts = []; rs.on('data', (c) => parts.push(c)); rs.on('end', () => { const t = Buffer.concat(parts).toString('utf8'); const j = JSON.parse(t); res({ k: j.length, pk: Math.round((heap() - b0) / 1048576) }); }); })));
  const streamed = await measure((u, b0) => new Promise((res) => { let k = 0, pk = 0; V._streamArray(u, () => { k++; if (k % 1000 === 0) pk = Math.max(pk, heap() - b0); }, () => res({ k, pk: Math.round(pk / 1048576) })); }));
  console.log('read whole: ' + whole.pk + ' MB above the start at its peak; read as it arrives: ' + streamed.pk + ' MB');
  ok('read as it arrives holds far less than read whole', streamed.k === 160000 && streamed.pk < whole.pk * 0.6, streamed.pk + ' vs ' + whole.pk);
  const s = await serve(big, 65536);
  let peak = 0, n = 0; const base = process.memoryUsage().heapUsed;
  const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed - base); }, 5);
  let ticks = 0; const tick = setInterval(() => ticks++, 10);           // the helper answering other things meanwhile
  await new Promise((res) => V._streamArray('http://127.0.0.1:' + s.address().port + '/', () => n++, (e) => { s.close(); res(e); }));
  clearInterval(t); clearInterval(tick);
  console.log('160,000 titles (' + Math.round(big.length / 1048576) + ' MB): ' + n + ' read, heap at most ' + Math.round(peak / 1048576) + ' MB above the start, ' + ticks + ' timer ticks while reading');
  ok('160,000 titles, all of them', n === 160000, n);
  ok('the helper kept answering while it read (timers ran)', ticks > 20, ticks);
  console.log(fails ? fails + ' FAILED' : 'all list stream checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
