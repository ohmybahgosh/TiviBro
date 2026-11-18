/* Mark a whole season or show watched or not watched (Plex's Hold OK on a season or a show): every episode of it
   in one edit, and which ones changed ([season, number]) for Trakt.  Synthetic records only. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-markshow-'));
const call = (object, method, ...args) => new Promise((resolve, reject) => object[method](...args, (e, r) => e ? reject(e) : resolve(r)));
function ep(s, n) { const f = 'Harbour.S0' + s + 'E0' + n + '.mkv'; return { id: 'w:/Harbour/' + f, path: '/Harbour/' + f, file: f, kind: 'episode', title: 'Harbour', modified: new Date(Date.UTC(2026, 0, n)).toISOString(), ancestors: ['Harbour', 'Season ' + s], classification: { showTitle: 'Harbour', season: s, numbers: [n], order: 'aired' } }; }
(async function () {
  try {
    const c = new Catalog(root); await call(c, 'open');
    await call(c, 'importScan', 'demo', { files: [ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)], partial: false });
    const handle = (await call(c, 'query', { kind: 'show' })).items[0].handle;
    const watched = async () => (await call(c, 'query', { kind: 'episode', show: handle, limit: 50 })).items.filter((e) => e.watchState === 'watched').map((e) => e.season + 'x' + e.number).sort().join(',');
    let r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: true, season: '1' });
    assert.deepStrictEqual(r.episodes, [[1, 1], [1, 2], [1, 3]], 'season 1: its three episodes changed');
    assert.equal(await watched(), '1x1,1x2,1x3', 'season 1 watched, season 2 not');
    r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: true });
    assert.deepStrictEqual(r.episodes, [[2, 1], [2, 2]], 'the whole show: only the ones not watched yet changed');
    assert.equal(await watched(), '1x1,1x2,1x3,2x1,2x2', 'the whole show watched');
    r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: false, season: '2' });
    assert.deepStrictEqual(r.episodes, [[2, 1], [2, 2]], 'season 2 not watched');
    assert.equal(await watched(), '1x1,1x2,1x3', 'season 1 still watched');
    const same = c.revision;
    r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: false, season: '2' });
    assert.deepStrictEqual(r.episodes, [], 'nothing to change: nothing changed');
    assert.equal(c.revision, same, '...and no new revision');
    // Just some episodes of a show (Trakt's history, in): one edit for all of them.
    r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: true, episodes: [[2, 2], [9, 9]] });
    assert.deepStrictEqual(r.episodes, [[2, 2]], 'only the episodes asked for (and that the library has)');
    r = await call(c, 'edit', { operation: 'setWatched', handle, expectedRevision: c.revision, watched: false, episodes: [[2, 2]] });
    const again = new Catalog(root); await call(again, 'open');
    assert.equal((await call(again, 'query', { kind: 'episode', show: handle, limit: 50 })).items.filter((e) => e.watchState === 'watched').length, 3, 'kept after a restart');
    console.log('PASS marking a season or a show watched or not watched, and what changed for Trakt');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
