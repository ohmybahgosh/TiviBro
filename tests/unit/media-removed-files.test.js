/* A file a complete scan no longer finds is hidden at once (no Needs review ghost, no episode in its show)
   but kept, with everything the viewer set on it, so a server that briefly lists less (a DLNA server
   re-indexing, a disk not mounted, a listing cut short) loses nothing.  After 30 days of being missing a
   complete scan removes it for good.  Partial and empty scans change nothing.  Synthetic records only. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-removed-'));
const call = (object, method, ...args) => new Promise((resolve, reject) => object[method](...args, (e, r) => e ? reject(e) : resolve(r)));
function movie(name) { return { id: 'w:/Movies/' + name + '.mkv', path: '/Movies/' + name + '.mkv', file: name + '.mkv', kind: 'movie', title: name, ancestors: ['Movies'], classification: { kind: 'movie', title: name, review: [] } }; }
function ep(n) { return { id: 'w:/Harbour/S01E' + n + '.mkv', path: '/Harbour/S01E' + n + '.mkv', file: 'Harbour.S01E' + n + '.mkv', kind: 'episode', title: 'Harbour', ancestors: ['Harbour', 'Season 1'], classification: { showTitle: 'Harbour', season: 1, numbers: [n], order: 'aired', title: 'Harbour', review: [] } }; }
const DAY = 86400000, realNow = Date.now;
let clock = Date.parse('2026-11-01T12:00:00Z');
Date.now = () => clock;
const movies = async c => (await call(c, 'query', { kind: 'movie', limit: 60 })).items.filter(i => i.availability === 'available').map(i => i.title).sort();
const reviews = async c => (await call(c, 'query', { kind: 'review', limit: 60 })).total;
const episodes = async (c, show) => (await call(c, 'query', { kind: 'episode', show })).items.map(e => e.number);
(async function () {
  try {
    const c = new Catalog(root); await call(c, 'open');
    await call(c, 'importScan', 'demo', { files: [movie('Alpha'), movie('Bravo'), ep(1), ep(2)], partial: false });
    const bravo = (await call(c, 'query', { kind: 'movie', limit: 60 })).items.filter(i => i.title === 'Bravo')[0];
    await call(c, 'edit', { operation: 'setFavourite', handle: bravo.handle, expectedRevision: c.revision, favourite: true });
    const show = (await call(c, 'query', { kind: 'show' })).items[0].handle;
    const second = (await call(c, 'query', { kind: 'episode', show })).items.filter(e => e.number === 2)[0];
    await call(c, 'edit', { operation: 'setWatched', handle: second.handle, expectedRevision: c.revision, watched: true });

    await call(c, 'importScan', 'demo', { files: [movie('Alpha'), ep(1)], partial: true });
    await call(c, 'importScan', 'demo', { files: [], partial: false });
    assert.deepEqual(await movies(c), ['Alpha', 'Bravo'], 'partial and empty scans change nothing');

    clock += DAY;
    await call(c, 'importScan', 'demo', { files: [movie('Alpha'), ep(1)], partial: false });
    assert.deepEqual(await movies(c), ['Alpha'], 'a file the scan no longer finds is not available');
    assert.equal(await reviews(c), 0, 'it does not wait in Needs review');
    assert.deepEqual(await episodes(c, show), [1], 'a missing episode file leaves its show');

    clock += 10 * DAY;
    const reopened = new Catalog(root); await call(reopened, 'open');
    assert.equal(await reviews(reopened), 0, 'still hidden after a restart');
    await call(reopened, 'importScan', 'demo', { files: [movie('Alpha'), movie('Bravo'), ep(1), ep(2)], partial: false });
    const back = (await call(reopened, 'query', { kind: 'movie', limit: 60 })).items.filter(i => i.title === 'Bravo')[0];
    assert(back && back.availability === 'available' && back.handle === bravo.handle, 'a file that comes back is the same record');
    assert.equal(back.favourite, true, 'and keeps what the viewer set on it');
    assert.equal((await call(reopened, 'file', bravo.handle)).missingSince, undefined, 'and is no longer counted as missing');
    const again = (await call(reopened, 'query', { kind: 'episode', show })).items.filter(e => e.number === 2)[0];
    assert.equal(again && again.watchState, 'watched', 'an episode that comes back keeps its watched state');

    clock += DAY;
    await call(reopened, 'importScan', 'demo', { files: [movie('Alpha'), ep(1)], partial: false });
    clock += 29 * DAY;
    await call(reopened, 'importScan', 'demo', { files: [movie('Alpha'), ep(1)], partial: false });
    assert(await call(reopened, 'file', bravo.handle), 'kept while missing for less than 30 days');
    clock += 2 * DAY;
    await call(reopened, 'importScan', 'demo', { files: [movie('Alpha'), ep(1)], partial: false });
    assert.equal(await call(reopened, 'file', bravo.handle), null, 'removed by a complete scan after 30 days missing');
    assert(!fs.readFileSync(path.join(root, 'handles.json'), 'utf8').includes(bravo.handle), 'and its handle is forgotten');
    assert.equal(await reviews(reopened), 0);
    console.log('PASS missing files are hidden but kept, come back intact, and leave after 30 days; partial and empty scans change nothing');
  } finally { Date.now = realNow; fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
