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
})().catch((e) => { console.error(e); process.exitCode = 1; });
