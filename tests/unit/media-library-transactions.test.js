/* The My media catalogue's write queue and commits: a job that throws gives the queue back, a full disk
   keeps the committed library, retried commands are not applied twice, and playback progress stays
   out of the revision (written at most once a minute and when playback stops). */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog, C = require('../../service/media-classify');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-transactions-'));
const call = (o, m, ...args) => new Promise((resolve, reject) => o[m](...args, (e, r) => e ? reject(e) : resolve(r)));
const wait = ms => new Promise(f => setTimeout(f, ms));
function ep(n) { const name = 'Harbour.S01E0' + n + '.mkv'; return { id: 'w:/Harbour/' + name, file: name, kind: 'episode', ancestors: ['Harbour'], classification: C.classify({ basename: name, ancestors: ['Harbour'] }) }; }
(async () => {
 try {
  const c = new Catalog(root, { progressMs: 2000, progressIdleMs: 300 }); await call(c, 'open');
  // A job that throws synchronously must not freeze the queue.
  await assert.rejects(new Promise((resolve, reject) => c.serial(() => { throw new Error('boom'); }, (e, r) => e ? reject(e) : resolve(r))), /boom/);
  let doneTwice = 0;
  await new Promise(resolve => c.serial(done => { done(null, 1); done(null, 2); }, () => { doneTwice++; resolve(); }));
  assert.equal(doneTwice, 1, 'a job ends once');
  await call(c, 'importScan', 'demo', { files: [ep(1), ep(2)] });
  assert.equal((await call(c, 'query', { kind: 'show' })).total, 1, 'writes still work after a failed job');
  // A failed import leaves its scan whole, so it can be tried again.
  const scan = { files: [ep(1), ep(2), ep(3)] }, before = JSON.stringify(scan);
  const rename = fs.rename;
  fs.rename = (from, to, cb) => process.nextTick(() => cb(Object.assign(new Error('full'), { code: 'ENOSPC' })));
  try { await assert.rejects(call(c, 'importScan', 'demo', scan), { code: 'ENOSPC' }); } finally { fs.rename = rename; }
  assert.equal(JSON.stringify(scan), before, 'the scan is not consumed by a failed import');
  const reopened = new Catalog(root); await call(reopened, 'open');
  const shows = await call(reopened, 'query', { kind: 'show' });
  assert.equal((await call(reopened, 'query', { kind: 'episode', show: shows.items[0].handle })).total, 2, 'the committed library survives a full disk');
  await call(c, 'importScan', 'demo', scan);
  assert.equal((await call(c, 'query', { kind: 'episode', show: shows.items[0].handle })).total, 3, 'the same scan imports on retry');
  // Idempotent commands.
  const q = { operation: 'setFavourite', handle: shows.items[0].handle, favourite: true, expectedRevision: c.revision, idempotencyKey: 'favourite_demo' };
  const saved = await call(c, 'edit', q), again = await call(c, 'edit', q);
  assert(again.duplicate); assert.equal(again.revision, saved.revision); assert.equal(c.revision, saved.revision, 'idempotent retry does not publish twice');
  await assert.rejects(call(c, 'edit', Object.assign({}, q, { favourite: false })), { code: 'CONFLICT' });
  // Progress: no revision change, no list invalidation, debounced writes, flushed when playback stops.
  const page = await call(c, 'query', { kind: 'episode', show: shows.items[0].handle, limit: 1 });
  const detail = await call(c, 'detail', { kind: 'episode', handle: page.items[0].handle }), handle = detail.versions[0].handle, revision = c.revision;
  const progressFile = path.join(root, 'progress.json'), started = Date.now();
  for (let i = 1; i <= 5; i++) await call(c, 'progress', { handle, position: 10 * i, duration: 1500, session: 's', sequence: i, startedAt: started });
  assert.equal(c.revision, revision, 'progress leaves the revision alone');
  assert(!fs.existsSync(progressFile), 'progress is not written on every report');
  await call(c, 'query', { kind: 'episode', show: shows.items[0].handle, cursor: page.nextCursor });
  await wait(600);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(progressFile, 'utf8')).p)[0].position, 50, 'written soon after reports stop');
  const writes = c.store.writes;
  for (let i = 6; i <= 9; i++) { await call(c, 'progress', { handle, position: 10 * i, duration: 1500, session: 's', sequence: i, startedAt: started }); await wait(60); }
  assert(c.store.writes - writes <= 1, 'at most one write per interval while playing');
  await call(c, 'progress', { handle, position: 200, duration: 1500, session: 's', sequence: 10, startedAt: started, final: true });
  assert.equal(Object.values(JSON.parse(fs.readFileSync(progressFile, 'utf8')).p)[0].position, 200, 'written at once when playback stops');
  assert.equal((await call(c, 'progress', { handle, position: 5, duration: 1500, session: 's', sequence: 3, startedAt: started })).ignored, true, 'an older report is ignored');
  assert.equal((await call(c, 'continuing')).items.length, 1);
  console.log('PASS robust write queue, full-disk rollback, retryable imports, idempotent commands and progress outside the revision');
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
