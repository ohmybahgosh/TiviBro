/* The helper's modules on every Node a webOS TV runs (0.12 on webOS 4, 8.12 on 5 and 6, then 12, 16
   and 20), plus this one.  Each engine loads every service/*.js file (a syntax Node 0.12 does not
   know, like a function declared inside a block in strict mode, fails here) and runs a small My media
   catalogue: a library, an import, shows and episodes, an edit, a correction, playback progress.
   Engines come from bash tests/engines/run.sh (.engines/ in this checkout, in the checkout that
   node_modules points to, or TIVIBRO_ENGINES); missing ones are skipped.
   Plain ES5 and callbacks: this same file is the child that runs on Node 0.12. */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), childProcess = require('child_process');
var ROOT = path.join(__dirname, '../..'), SVC = path.join(ROOT, 'service');
var VERSIONS = ['0.12.2', '8.12.0', '12.22.12', '16.20.2', '20.18.0'];

function rmrf(p) {
  var st; try { st = fs.lstatSync(p); } catch (e) { return; }
  if (st.isDirectory()) { fs.readdirSync(p).forEach(function (n) { rmrf(path.join(p, n)); }); fs.rmdirSync(p); } else fs.unlinkSync(p);
}
function tempDir(prefix) {
  var d = path.join(os.tmpdir(), prefix + process.pid + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6));
  fs.mkdirSync(d); return d;
}

/* ---------- child: runs on the engine under test ---------- */
function child(dir) {
  var Module = require('module'), origResolve = Module._resolveFilename;
  process.env.TIVIBRO_KV_DIR = dir;
  function Stub() { this.activityManager = { create: function (n, cb) { cb({ id: 1 }); }, complete: function () {} }; }
  Stub.prototype.call = function (uri, params, cb) { if (cb) setTimeout(function () { cb({ payload: { returnValue: true } }); }, 1); };
  Stub.prototype.register = function () {};
  Stub.prototype.subscribe = function () { return new (require('events').EventEmitter)(); };
  require.cache['webos-service-stub'] = { id: 'webos-service-stub', filename: 'webos-service-stub', loaded: true, exports: Stub };
  Module._resolveFilename = function (req) { if (req === 'webos-service') return 'webos-service-stub'; return origResolve.apply(this, arguments); };
  var failed = [];
  fs.readdirSync(SVC).filter(function (n) { return /\.js$/.test(n); }).sort().forEach(function (n) {
    try { require(path.join(SVC, n)); } catch (e) { failed.push(n + ': ' + (e && e.message)); }
  });
  Module._resolveFilename = origResolve;
  if (failed.length) { console.log('LOAD FAIL ' + failed.join(' | ')); return process.exit(1); }
  console.log('LOADED ' + fs.readdirSync(SVC).filter(function (n) { return /\.js$/.test(n); }).length);

  var Catalog = require(path.join(SVC, 'media-catalog')).Catalog, C = require(path.join(SVC, 'media-classify'));
  var c = new Catalog(path.join(dir, 'library'), { progressMs: 50, progressIdleMs: 20 });
  function obs(file, ancestors) { var cls = C.classify({ basename: file, ancestors: ancestors }, { compact: true }); return { id: 'w:/' + ancestors.concat([file]).join('/'), path: '/' + ancestors.concat([file]).join('/'), file: file, title: cls.title, kind: cls.kind, size: 5e8, ancestors: ancestors, classification: cls }; }
  function fail(step, e) { console.log('SMOKE FAIL ' + step + ': ' + (e && (e.stack || e.message) || e)); process.exit(1); }
  function check(step, cond) { if (!cond) fail(step, 'unexpected result'); }
  var files = [obs('Harbour.S01E01.mkv', ['TV', 'Harbour', 'Season 1']), obs('Harbour.S01E02.mkv', ['TV', 'Harbour', 'Season 1']), obs('E03 - Storm.mkv', ['TV', 'Harbour', 'Season 1']),
    obs('Unsorted Clip.mkv', ['TV', 'Harbour', 'Season 2']), obs('Amber.Road.2021.mkv', ['Movies'])];
  c.open(function (e) {
    if (e) return fail('open', e);
    c.source({ action: 'configure', sourceId: 'demo', contentMode: 'automatic' }, function (e0) {
      if (e0) return fail('configure', e0);
      c.importScan('demo', { files: files, partial: false, contentMode: 'automatic' }, function (e1, imported) {
        if (e1) return fail('import', e1);
        check('import count', imported.files === 5 && imported.shows === 1);
        c.query({ kind: 'show' }, function (e2, shows) {
          if (e2) return fail('shows', e2);
          check('one show', shows.total === 1 && shows.items[0].title === 'Harbour');
          c.query({ kind: 'episode', show: shows.items[0].handle }, function (e3, eps) {
            if (e3) return fail('episodes', e3);
            check('three episodes in order', eps.total === 3 && eps.items[0].number === 1 && eps.items[2].number === 3);
            check('no locators in lists', JSON.stringify(eps).indexOf('"path"') < 0 && JSON.stringify(eps).indexOf('w:/') < 0);
            c.edit({ operation: 'setWatched', handle: eps.items[0].handle, watched: true, expectedRevision: c.revision }, function (e4) {
              if (e4) return fail('watched', e4);
              c.detail({ kind: 'episode', handle: eps.items[1].handle }, function (e5, detail) {
                if (e5) return fail('detail', e5);
                var rev = c.revision;
                c.progress({ handle: detail.versions[0].handle, position: 120, duration: 1500, session: 's1', sequence: 1, startedAt: Date.now(), final: true }, function (e6) {
                  if (e6) return fail('progress', e6);
                  check('progress leaves the revision alone', c.revision === rev);
                  c.continuing(function (e7, cont) {
                    if (e7) return fail('continue', e7);
                    check('continue watching', cont.items.length === 1 && cont.items[0].continueEpisode === eps.items[1].handle);
                    c.query({ kind: 'review' }, function (e8, review) {
                      if (e8) return fail('review', e8);
                      check('one file to review', review.total === 1);
                      c.edit({ operation: 'classifyFile', handle: review.items[0].handle, expectedRevision: c.revision, fields: { kind: 'episode', showTitle: 'Harbour', season: 2, numbers: [1], order: 'aired' } }, function (e9) {
                        if (e9) return fail('correct', e9);
                        c.query({ kind: 'episode', show: shows.items[0].handle }, function (e10, after) {
                          if (e10) return fail('after correction', e10);
                          check('corrected file joined the show', after.total === 4 && after.items[0].watchState === 'watched');
                          console.log('SMOKE OK ' + process.version);
                          process.exit(0);
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

/* ---------- parent: finds the engines and runs the child on each ---------- */
function engineDirs() {
  var out = [];
  if (process.env.TIVIBRO_ENGINES) out.push(process.env.TIVIBRO_ENGINES);
  out.push(path.join(ROOT, '.engines'));
  try { out.push(path.join(path.dirname(fs.realpathSync(path.join(ROOT, 'node_modules'))), '.engines')); } catch (e) {}
  return out;
}
function findNode(version) {
  var dirs = engineDirs();
  for (var i = 0; i < dirs.length; i++) {
    var base = path.join(dirs[i], 'node-' + version);
    var tries = [path.join(base, 'package', 'bin', 'node'), path.join(base, 'package', 'node-v' + version + '-linux-x64', 'bin', 'node')];
    for (var j = 0; j < tries.length; j++) { try { if (fs.statSync(tries[j]).isFile()) return tries[j]; } catch (e) {} }
  }
  return null;
}
function parent() {
  var runs = [{ name: 'this Node ' + process.version, bin: process.execPath }], fails = 0, skipped = [];
  VERSIONS.forEach(function (v) { var bin = findNode(v); if (bin) runs.push({ name: 'Node ' + v, bin: bin }); else skipped.push(v); });
  runs.forEach(function (r) {
    var dir = tempDir('tivibro-engines-');
    var res = childProcess.spawnSync(r.bin, [__filename, '--child', dir], { encoding: 'utf8', timeout: 120000, env: process.env });
    rmrf(dir);
    var out = (res.stdout || '') + (res.stderr || ''), ok = res.status === 0 && /SMOKE OK/.test(out) && /LOADED \d+/.test(out);
    console.log((ok ? 'PASS ' : 'FAIL ') + r.name + ': every service module loads and the media catalogue works' + (ok ? '' : '\n' + out.slice(-2000)));
    if (!ok) fails++;
  });
  if (skipped.length) console.log('SKIP Node ' + skipped.join(', ') + ' (not downloaded; bash tests/engines/run.sh helper fetches them)');
  if (fails) { console.log(fails + ' FAILED'); process.exitCode = 1; } else console.log('ALL PASS');
}

if (process.argv[2] === '--child') child(process.argv[3]);
else parent();
