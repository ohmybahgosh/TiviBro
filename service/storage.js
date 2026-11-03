/* Where the helper keeps big things on the TV: playlists, movie and show lists, My media and the guide.
   One folder for all of it, chosen once:
     - on the TV's storage that survives a TiviBro update (the helper's own folder is replaced by every
       update, which used to throw the guide away each time), and on the partition with the most free
       room.  On recent LG TVs /media/internal and /media/developer sit on app storage (/mnt/lg/appstore,
       2.7 GB on a C2), not on user data (720 MB, shared with webOS); older TVs may differ, so the free
       space decides;
     - sticky: a folder that already holds TiviBro's data keeps being used, so nothing moves around;
     - private: /media/internal is shared into other apps' jails (YouTube, Netflix, the browser...), and
       playlists hold logins, so everything here is readable by the helper only (umask 077, and files
       left by older versions are locked down at start).
   Falls back to the helper's own folder, then to memory (/tmp), which vanishes with the TV.
   TIVIBRO_KV_DIR overrides it (tests and the dev relay).  Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os');

try { process.umask(parseInt('077', 8)); } catch (e) {}

var BASE = null, INFO = null;
var PLACES = [
  { dir: '/media/internal/.tivibro', where: 'TV storage' },
  { dir: '/media/developer/.tivibro', where: 'developer storage' }
];
try { if (process.env.TIVIBRO_STORAGE_PLACES) PLACES = JSON.parse(process.env.TIVIBRO_STORAGE_PLACES); } catch (e) {}   // tests

function mkdir(d) { try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
function writable(d) {
  try { mkdir(d); var t = path.join(d, '.w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); return true; } catch (e) { return false; }
}
// Free MB on the partition holding d, from df (Node has no statfs before 18); -1 when it can't tell.
function freeMB(d) {
  try {
    var out = String(require('child_process').execFileSync('df', ['-k', d], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }));
    var cols = out.trim().split('\n').pop().trim().split(/\s+/), avail = +cols[cols.length - 3];
    return isFinite(avail) && avail >= 0 ? Math.round(avail / 1024) : -1;
  } catch (e) { return -1; }
}
function hasData(d) { try { return fs.readdirSync(d).length > 0; } catch (e) { return false; } }

// Files an older TiviBro left readable by everyone: the helper's only, from now on.
function lockDown(d) {
  var left = 20000;
  function walk(p, depth) {
    if (left-- <= 0 || depth > 5) return;
    var st; try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isSymbolicLink()) return;
    if (process.getuid && st.uid !== process.getuid()) return;          // only what is ours
    try { fs.chmodSync(p, st.isDirectory() ? parseInt('700', 8) : parseInt('600', 8)); } catch (e) {}
    if (st.isDirectory()) { var names = []; try { names = fs.readdirSync(p); } catch (e) {} names.forEach(function (n) { walk(path.join(p, n), depth + 1); }); }
  }
  walk(d, 0);
}

function choose() {
  if (process.env.TIVIBRO_KV_DIR) {
    if (writable(process.env.TIVIBRO_KV_DIR)) return { dir: process.env.TIVIBRO_KV_DIR, where: 'set by TIVIBRO_KV_DIR', kept: true };
  }
  var ok = PLACES.filter(function (p) { return writable(p.dir); }).map(function (p) { return { dir: p.dir, where: p.where, kept: true, data: hasData(p.dir), free: freeMB(p.dir) }; });
  var withData = ok.filter(function (p) { return p.data; }), pool = withData.length ? withData : ok;
  var best = null;
  pool.forEach(function (p) { if (!best || p.free > best.free) best = p; });   // ties: the first, TV storage
  if (best) {
    ok.forEach(function (p) { if (p !== best && !p.data) { try { fs.rmdirSync(p.dir); } catch (e) {} } });   // only made to test it
    return best;
  }
  var own = path.join(__dirname, 'data');
  if (writable(own)) return { dir: own, where: 'the helper\'s own folder (replaced by updates)', kept: false };
  var mem = path.join(os.tmpdir(), 'tivibro');
  if (writable(mem)) return { dir: mem, where: 'memory (lost when the TV turns off)', kept: false, memory: true };
  throw new Error('no place to keep it');
}

function base() {
  if (BASE) return BASE;
  var c = choose();
  BASE = c.dir;
  lockDown(BASE);
  INFO = { dir: c.dir, where: c.where, kept: !!c.kept, memory: !!c.memory, freeMB: c.free != null ? c.free : freeMB(c.dir) };
  return BASE;
}
function sub(name) { var d = path.join(base(), name); mkdir(d); return d; }
// For /ping and Diagnostics: where, and how much room is left (refreshed at most every 10 minutes).
var freeAt = 0;
function info() {
  try { base(); } catch (e) { return { where: 'none', error: e.message }; }
  if (Date.now() - freeAt > 600000) { freeAt = Date.now(); INFO.freeMB = freeMB(BASE); }
  return INFO;
}
function memory() { try { base(); return !!INFO.memory; } catch (e) { return true; } }

module.exports = { base: base, sub: sub, info: info, memory: memory, _lockDown: lockDown, _freeMB: freeMB };
