/* My media helper with a big library: 50,000 episodes in 500 shows and 5,000 movies on one source.
   Measures time and peak memory (RSS, sampled every few milliseconds) of each step: import, a second
   unchanged import, list pages, a correction, a merge, playback progress.  No provider or TV is
   contacted.  Run on a TV's Node with: node --expose-gc tests/soak/media-library-large.js
   (bash tests/engines/run.sh downloads Node 8.12, the one of webOS 5 and 6).  Budget: peak RSS under
   about 200 MB, and memory back near the start once a step is done. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Catalog = require('../../service/media-catalog').Catalog, C = require('../../service/media-classify');
const root = process.argv[2] === '--rescan' ? process.argv[3] : fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-large-'));
const call = (o, m, ...args) => new Promise((resolve, reject) => o[m](...args, (e, r) => e ? reject(e) : resolve(r)));
function rmrf(p) { let st; try { st = fs.lstatSync(p); } catch (e) { return; } if (st.isDirectory()) { fs.readdirSync(p).forEach(n => rmrf(path.join(p, n))); fs.rmdirSync(p); } else fs.unlinkSync(p); }
const MiB = n => Math.round(n / 1048576);
let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
function gc() { if (global.gc) { global.gc(); global.gc(); } }
const report = [];
async function step(name, run) {
  gc(); const before = process.memoryUsage().rss; peak = before;
  const t0 = Date.now(), result = await run();
  const ms = Date.now() - t0; peak = Math.max(peak, process.memoryUsage().rss); gc();
  const row = { step: name, ms, rssBeforeMiB: MiB(before), peakRssMiB: MiB(peak), rssAfterMiB: MiB(process.memoryUsage().rss) };
  report.push(row); console.log(JSON.stringify(row));
  return result;
}
function corpus() {
  const files = [], folders = {}, movieFolder = ['Movies'];
  for (let i = 0; i < 50000; i++) {
    const show = 'Show ' + Math.floor(i / 100), season = 'Season ' + (Math.floor((i % 100) / 25) + 1), file = show + '.S0' + (Math.floor((i % 100) / 25) + 1) + 'E' + (i % 25 + 1) + '.1080p.WEB-DL.mkv';
    // A scan shares one ancestors list per folder, as media.js does.
    const ancestors = folders[show + '/' + season] || (folders[show + '/' + season] = ['TV', show, season]);
    files.push({ id: 'w:/TV/' + show + '/' + season + '/' + file, path: '/TV/' + encodeURIComponent(show) + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(file), file, kind: 'episode', title: show, size: 1500000000 + i, ext: 'mkv', info: ['1080p'], ancestors, classification: C.classify({ basename: file, ancestors }, { compact: true }) });
  }
  for (let i = 0; i < 5000; i++) { const file = 'Movie ' + i + ' (' + (1950 + i % 70) + ').mkv'; files.push({ id: 'w:/Movies/' + file, path: '/Movies/' + encodeURIComponent(file), file, kind: 'movie', title: 'Movie ' + i, size: 4000000000, ext: 'mkv', info: [], ancestors: movieFolder, classification: C.classify({ basename: file, ancestors: movieFolder }, { compact: true }) }); }
  return files;
}
async function rescan(dir) {
  const c = new Catalog(dir); await call(c, 'open');
  const files = await step('fresh helper: build the scan', async () => corpus());
  await step('fresh helper: rescan, unchanged', () => call(c, 'importScan', 'demo', { files, partial: false }));
  clearInterval(sampler);
}
if (process.argv[2] === '--rescan') rescan(process.argv[3]).catch(e => { console.error(e); process.exit(1); });
else (async () => {
  try {
    const c = new Catalog(root); await call(c, 'open');
    gc(); const start = process.memoryUsage().rss;
    console.log(JSON.stringify({ node: process.version, startRssMiB: MiB(start) }));
    let files = await step('build the scan (55,000 observations)', async () => corpus());
    const imported = await step('import', () => call(c, 'importScan', 'demo', { files, partial: false }));
    assert.equal(imported.shows, 500);
    const writesBefore = c.store.writes;
    await step('import again, unchanged (same process)', () => call(c, 'importScan', 'demo', { files, partial: false }));
    const rescanWrites = c.store.writes - writesBefore;
    files = null;
    // What a TV does on a later day: a fresh helper (no heap left over from the first import) rescans.
    const fresh = require('child_process').spawnSync(process.execPath, process.execArgv.concat([__filename, '--rescan', root]), { encoding: 'utf8' });
    (fresh.stdout || '').split('\n').filter(Boolean).forEach(line => { console.log(line); try { const row = JSON.parse(line); if (row.step) report.push(row); } catch (e) {} });
    if (fresh.status !== 0) throw new Error('fresh rescan failed: ' + fresh.stderr);
    c.store.forgetAll();
    const shows = await step('shows page (cold)', () => call(c, 'query', { kind: 'show', limit: 60 }));
    assert.equal(shows.total, 500); assert.equal(shows.items.length, 60);
    const eps = await step('episode page of one show', () => call(c, 'query', { kind: 'episode', show: shows.items[0].handle, limit: 60 }));
    assert.equal(eps.total, 100);
    await step('episodes of every show (no show filter, page 300)', () => call(c, 'query', { kind: 'episode', limit: 60, cursor: { offset: 18000, revision: c.revision } }));
    const all = await step('all files, last page', () => call(c, 'query', { kind: 'files', limit: 60, cursor: { offset: 54960, revision: c.revision } }));
    assert.equal(all.total, 55000); assert.equal(all.items.length, 40);
    const detail = await step('episode detail', () => call(c, 'detail', { kind: 'episode', handle: eps.items[0].handle }));
    await step('correction of one file', () => call(c, 'edit', { operation: 'classifyFile', handle: detail.versions[0].handle, expectedRevision: c.revision, fields: { kind: 'episode', showTitle: shows.items[0].title, order: 'aired', season: 9, numbers: [1] } }));
    const folder = await step('folder correction preview (25 files)', () => call(c, 'edit', { operation: 'previewCorrection', folderOf: detail.versions[0].handle, expectedRevision: c.revision, fields: { season: 7 } }));
    await step('folder correction commit', () => call(c, 'edit', { operation: 'commitPreview', previewToken: folder.previewToken, expectedRevision: folder.revision }));
    await step('merge two shows', () => call(c, 'edit', { operation: 'mergeShows', handle: shows.items[1].handle, target: shows.items[2].handle, expectedRevision: c.revision }));
    const before = c.revision;
    await step('progress save', () => call(c, 'progress', { handle: detail.versions[0].handle, position: 300, duration: 2700, session: 'soak', sequence: 1, startedAt: Date.now(), final: true }));
    assert.equal(c.revision, before, 'progress does not change the revision');
    await step('continue watching', () => call(c, 'continuing'));
    clearInterval(sampler); gc();
    const worst = report.reduce((m, r) => Math.max(m, r.peakRssMiB), 0);
    console.log(JSON.stringify({ episodes: 50000, movies: 5000, shows: shows.total, startRssMiB: MiB(start), worstPeakRssMiB: worst, endRssMiB: MiB(process.memoryUsage().rss), rescanShardWrites: rescanWrites, memo: c.store.stats() }));
    // The scan list itself (built by media.js from what the server sent) is about 2.6 KB a file here; what
    // the library adds on top of what each step starts with is the part it controls.
    const added = report.filter((r) => !/build the scan/.test(r.step)).reduce((m, r) => Math.max(m, r.peakRssMiB - r.rssBeforeMiB), 0);
    assert(added < 100, 'no step adds more than 100 MB (' + added + ')');
    assert(MiB(process.memoryUsage().rss) < 150, 'memory comes back down once the work is done');
  } finally { clearInterval(sampler); rmrf(root); }
})().catch(e => { console.error(e); process.exitCode = 1; });
