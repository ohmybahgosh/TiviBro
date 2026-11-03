/* My media storage (service/media-library.js): real disk round trips, atomic writes, no rewrite of an
   unchanged file, corrupt files refused (never silently emptied), and a memo that is capped and
   expires. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const Store = require('../../service/media-library');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-library-'));
const call = (target, method, ...args) => new Promise((resolve, reject) => target[method](...args, (e, value) => e ? reject(e) : resolve(value)));
const wait = ms => new Promise(f => setTimeout(f, ms));
(async function () {
 try {
  fs.writeFileSync(path.join(root, '.left.json.abc.tmp'), 'half');
  const store = new Store(root, { maxBytes: 4096, idleMs: 30 }); await call(store, 'open');
  assert(!fs.existsSync(path.join(root, '.left.json.abc.tmp')), 'a temporary file from an interrupted write is cleared');
  const fresh = await call(store, 'read', 'a.json', () => ({ rows: [] }));
  assert.deepEqual(fresh, { rows: [] }, 'a missing file starts empty');
  fresh.rows.push(1);
  assert.equal(await call(store, 'write', 'a.json', fresh), true);
  assert.equal(store.writes, 1);
  assert.equal(await call(store, 'write', 'a.json', { rows: [1] }), false, 'the same content is not written again');
  assert.equal(store.writes, 1);
  assert.deepEqual(fs.readdirSync(root).filter(n => /\.tmp$/.test(n)), [], 'no temporary files stay behind');
  const reopened = new Store(root); await call(reopened, 'open');
  assert.deepEqual(await call(reopened, 'read', 'a.json', null), { rows: [1] }, 'saved to disk');
  // A file that does not parse is an error, never an empty library.
  fs.writeFileSync(path.join(root, 'b.json'), '{"broken');
  await assert.rejects(call(new Store(root), 'read', 'b.json', () => ({})), { code: 'CORRUPT_LIBRARY' });
  await assert.rejects(call(store, 'read', '../x.json', null), { code: 'INVALID_NAME' });
  // A failed rename keeps the old file and forgets the unsaved copy.
  const rename = fs.rename;
  fs.rename = (from, to, cb) => process.nextTick(() => cb(Object.assign(new Error('full'), { code: 'ENOSPC' })));
  try { await assert.rejects(call(store, 'write', 'a.json', { rows: [2] }), { code: 'ENOSPC' }); } finally { fs.rename = rename; }
  assert.deepEqual(await call(store, 'read', 'a.json', null), { rows: [1] }, 'the committed file survives a full disk');
  assert.deepEqual(fs.readdirSync(root).filter(n => /\.tmp$/.test(n)), [], 'the failed temporary file is removed');
  // The memo is capped by size, skips files read in passing, and empties when idle.
  for (let i = 0; i < 6; i++) await call(store, 'write', 'big' + i + '.json', { text: 'x'.repeat(1500) });
  assert(store.memoBytes <= 4096 + 1600, 'memo stays near its cap: ' + store.memoBytes);
  const passer = new Store(root); await call(passer, 'open');
  await new Promise((resolve, reject) => passer.read('big0.json', null, (e, r) => e ? reject(e) : resolve(r), true));
  assert.equal(passer.stats().memoFiles, 0, 'a passing read leaves the memo alone');
  assert.equal(await new Promise((resolve, reject) => passer.write('big0.json', { text: 'x'.repeat(1500) }, (e, r) => e ? reject(e) : resolve(r), true)), false, 'a passing read still knows the file is unchanged');
  await wait(1200);
  assert.equal(store.stats().memoFiles, 0, 'nothing stays in memory after the idle time');
  console.log('PASS library files: atomic writes, unchanged files kept, corrupt files refused, full disk, memo cap, passing reads and idle expiry');
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
