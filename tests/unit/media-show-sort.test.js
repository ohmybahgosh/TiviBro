/* Settings > My media > Sort TV shows by: the helper's show list by name, first aired or date added.
     node tests/unit/media-show-sort.test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-showsort-'));
const call = (o, m, ...a) => new Promise((ok, no) => o[m](...a, (e, r) => e ? no(e) : ok(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ep(show, n) { return { id: 'w:/' + show + '/S01E' + n + '.mkv', path: '/' + show + '/S01E' + n + '.mkv', file: show + '.S01E' + n + '.mkv', kind: 'episode', title: show, ancestors: [show, 'Season 1'], classification: { showTitle: show, season: 1, numbers: [n], order: 'aired', title: show, review: [] } }; }
(async function () {
  try {
    const c = new Catalog(root); await call(c, 'open');
    const files = [];
    // Added in this order: Middle, Zebra, Apple (each a moment later).
    for (const s of ['Middle', 'Zebra', 'Apple']) { files.push(ep(s, 1)); await call(c, 'importScan', 'demo', { files: files.slice(), partial: false }); await wait(15); }
    const names = async (q) => (await call(c, 'query', Object.assign({ kind: 'show' }, q))).items.map((x) => x.title).join(',');
    assert.equal(await names({}), 'Apple,Middle,Zebra', 'by name when no sort is asked for');
    assert.equal(await names({ sort: 'name' }), 'Apple,Middle,Zebra');
    assert.equal(await names({ sort: 'added' }), 'Apple,Zebra,Middle', 'newest added first');
    const first = { Apple: '1999-01-01', Middle: '2024-05-01', Zebra: '2010-03-02' }, ids = { Apple: 1, Middle: 2, Zebra: 3 };
    for (const it of (await call(c, 'query', { kind: 'show' })).items) await call(c, 'edit', { operation: 'setMetadata', handle: it.handle, expectedRevision: c.revision, metadata: { provider: 'TMDB', id: 'tmdb:tv:' + ids[it.title], title: it.title, releaseDate: first[it.title], year: first[it.title].slice(0, 4) } });
    assert.equal(await names({ sort: 'release' }), 'Middle,Zebra,Apple', 'first aired, newest first');
    console.log('PASS shows sort by name, first aired and date added');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
