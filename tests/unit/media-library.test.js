/* Real disk round trips and corrupt-generation recovery for the paged library primitive. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const Library = require('../../service/media-library');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-library-'));
const call = (target, method, ...args) => new Promise((resolve, reject) => target[method](...args, (e, value) => e ? reject(e) : resolve(value)));
(async function () {
 try {
  const lib = new Library(root); await call(lib, 'open');
  assert.equal(lib.manifest.revision, 0);
  await call(lib, 'append', 'episodes', Array.from({length: 256}, (_, i) => ({ id: 'e' + i })), 0);
  let page = await call(lib, 'query', 'episodes', { limit: 200 });
  assert.equal(page.items.length, 200);
  const cursor = page.nextCursor;
  page = await call(lib, 'query', 'episodes', { limit: 200, cursor });
  assert.equal(page.items.length, 56); assert.equal(page.nextCursor, null);
  await assert.rejects(call(lib, 'append', 'episodes', [{id:'new'}], 0), {code:'CONFLICT'});
  await assert.rejects(call(lib, 'append', 'episodes', Array(257).fill({}), 1), {code:'INVALID_BATCH'});
  await call(lib, 'append', 'episodes', [{ id: 'new' }], 1);
  await assert.rejects(call(lib, 'query', 'episodes', { cursor }), {code:'STALE_CURSOR'});
  const reopened = new Library(root); await call(reopened, 'open'); assert.equal(reopened.manifest.revision, 2);
  // A committed manifest with corrupt page content is rejected in favour of its valid predecessor.
  fs.writeFileSync(path.join(root, reopened.manifest.pages.episodes[1].name), 'broken');
  const recovered = new Library(root); await call(recovered, 'open'); assert.equal(recovered.manifest.revision, 1);
  await assert.rejects(call(recovered, 'query', 'episodes', { cursor: {page:-1,row:0,revision:1,family:'episodes'} }), {code:'INVALID_QUERY'});
  fs.writeFileSync(path.join(root, 'previous.json'), '{}');
  await assert.rejects(call(new Library(root), 'open'), {code:'CORRUPT_LIBRARY'});
  console.log('PASS library persistence, page limits, revisions, corruption recovery and cursor validation');
 } finally { fs.rmSync(root, {recursive:true, force:true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
