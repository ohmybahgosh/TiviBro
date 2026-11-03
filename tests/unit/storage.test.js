/* Where the helper keeps big things (service/storage.js): one folder, private to the helper, that
   stays put; and the room left there.
     node tests/unit/storage.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-store-'));
const A = path.join(tmp, 'a'), B = path.join(tmp, 'b');
// Each choice in its own process: the module picks once.
function pick(places) {
  const env = Object.assign({}, process.env, { TIVIBRO_STORAGE_PLACES: JSON.stringify(places) }); delete env.TIVIBRO_KV_DIR;
  return JSON.parse(cp.execFileSync(process.execPath, ['-e', "var S=require(" + JSON.stringify(path.join(__dirname, '../../service/storage.js')) + ");S.base();process.stdout.write(JSON.stringify(S.info()))"], { env }).toString());
}
let r = pick([{ dir: A, where: 'first' }, { dir: B, where: 'second' }]);
ok('a fresh TV: a place that can be written, with its free room', (r.dir === A || r.dir === B) && r.freeMB > 0 && r.kept, JSON.stringify(r));
const other = r.dir === A ? B : A;
ok('the folder only made to test the other place is removed again', !fs.existsSync(other));
fs.writeFileSync(path.join(other === A ? B : A, 'marker'), 'x');
const chosen = r.dir;
fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'nothing-of-ours-yet'), '');
fs.unlinkSync(path.join(other, 'nothing-of-ours-yet')); fs.rmdirSync(other);
r = pick([{ dir: other, where: 'x' }, { dir: chosen, where: 'y' }]);
ok('a place that already holds TiviBro\'s data keeps being used (nothing moves)', r.dir === chosen, JSON.stringify(r));
// Files an older version left readable by everyone are locked down.
const old = path.join(tmp, 'old'); fs.mkdirSync(old); fs.mkdirSync(path.join(old, 'kv'));
fs.writeFileSync(path.join(old, 'kv', 'playlist~p1.json'), '{"user":"u","pass":"p"}'); fs.chmodSync(path.join(old, 'kv', 'playlist~p1.json'), 0o644); fs.chmodSync(path.join(old, 'kv'), 0o755); fs.chmodSync(old, 0o755);
r = pick([{ dir: old, where: 'TV storage' }]);
const mode = (p) => fs.statSync(p).mode & 0o777;
ok('older files are the helper\'s only now', mode(old) === 0o700 && mode(path.join(old, 'kv')) === 0o700 && mode(path.join(old, 'kv', 'playlist~p1.json')) === 0o600, [mode(old), mode(path.join(old, 'kv')), mode(path.join(old, 'kv', 'playlist~p1.json'))].map(m => m.toString(8)).join());
// New files are private too (umask 077).
const S = require('../../service/storage.js');
const f = path.join(tmp, 'new.json'); fs.writeFileSync(f, '{}');
ok('new files are readable by the helper only', mode(f) === 0o600, mode(f).toString(8));
ok('free room is read from df', S._freeMB(tmp) > 0);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? fails + ' FAILED' : 'all storage checks passed');
process.exit(fails ? 1 : 0);
