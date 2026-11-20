/* Search on a TV short of memory (issue #116): the helper looks through the movie list it keeps and hands
   over only the titles with every word.
     node tests/unit/vod-find.test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-find-'));
const Vod = require('../../service/vod.js');
const port = 47811, u = 'http://127.0.0.1:' + port + '/x/http/provider/player_api.php?action=get_vod_streams', uc = u.replace('get_vod_streams', 'get_vod_categories');
// A kept list (as /vod/list writes it): rows [id, name, cover, rating, ext, cat, added].
const rows = [];
for (let i = 0; i < 3000; i++) rows.push([i, 'Film ' + i, '', '', 'mp4', '1', 0]);
rows.push([9001, 'The Lord of the Rings', '', '8', 'mkv', '1', 0], [9002, 'Lord of War', '', '7', 'mp4', '1', 0], [9003, 'Amélie', '', '8', 'mp4', '1', 0]);
fs.mkdirSync(path.join(process.env.TIVIBRO_KV_DIR, 'vod'), { recursive: true });
const file = path.join(process.env.TIVIBRO_KV_DIR, 'vod', 'p1-movie.json');
fs.writeFileSync(file, JSON.stringify({ v: 2, at: Date.now(), sig: 's1', rows, cats: [{ id: '1', name: 'Movies' }] }));
function ask(body) {
  return new Promise((resolve) => {
    const res = { writeHead(code) { this.code = code; }, end(b) { resolve({ code: this.code, body: JSON.parse(b) }); } };
    Vod.find(Object.assign({ pl: 'p1', sig: 's1', kind: 'movie', u, uc, maxAge: 0 }, body), res, {}, null, port);
  });
}
(async () => {
  let r = await ask({ words: ['lord'] });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.rows.map((x) => x[1]).sort(), ['Lord of War', 'The Lord of the Rings'], 'every title with the word');
  assert.equal(r.body.of, 3003, 'out of the whole list');
  r = await ask({ words: ['lord', 'rings'] });
  assert.deepEqual(r.body.rows.map((x) => x[1]), ['The Lord of the Rings'], 'every word must be there');
  r = await ask({ words: ['amelie'] });
  assert.equal(r.body.rows.length, 1, 'accents do not matter');
  r = await ask({ words: ['film'], max: 50 });
  assert.equal(r.body.rows.length, 50); assert.equal(r.body.total, 3000, 'at most max rows, and how many there were');
  r = await ask({ words: [] });
  assert.equal(r.code, 400);
  r = await ask({ words: ['lord'], u: 'http://example.com/x' });
  assert.equal(r.code, 400, 'only this helper\'s own relay addresses');
  console.log('PASS vod find: words, accents, max, relay addresses only');
  // Two searches at once with nothing kept (issue #132): one download, and both get their answer.
  const http = require('http');
  let hits = 0;
  const srv = http.createServer((req, res) => {
    const cats = /get_vod_categories/.test(req.url);
    if (!cats) hits++;
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cats ? [{ category_id: '1', category_name: 'Movies' }] : [{ stream_id: 1, name: 'Lord of War', category_id: '1' }, { stream_id: 2, name: 'War Horse', category_id: '1' }])); }, 300);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const sp = srv.address().port, su = 'http://127.0.0.1:' + sp + '/x/http/provider/player_api.php?action=get_vod_streams';
  const two = (words) => new Promise((resolve) => {
    const res = { writeHead(code) { this.code = code; }, end(b) { resolve({ code: this.code, body: JSON.parse(b) }); } };
    Vod.find({ pl: 'p2', sig: 's2', kind: 'movie', u: su, uc: su.replace('get_vod_streams', 'get_vod_categories'), maxAge: 0, words }, res, {}, null, sp);
  });
  const both = await Promise.all([two(['lord']), two(['war'])]);
  srv.close();
  assert.equal(hits, 1, 'one download for two searches at once');
  assert.deepEqual(both.map((x) => x.body.total), [1, 2], 'each search gets its own answer');
  console.log('PASS vod find: two searches at once share one download');
})().catch((e) => { console.error(e); process.exitCode = 1; });
