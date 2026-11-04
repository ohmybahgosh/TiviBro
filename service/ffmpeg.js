/* The audio converter: a tiny static ffmpeg (docs/FFMPEG.md, scripts/ffmpeg/build.sh).  Release builds of
   TiviBro carry it (service/ffmpeg-bundle/, put there by scripts/ffmpeg/bundle.sh): the helper unpacks it
   onto the TV's storage a few seconds after it starts, with no download and nothing to ask.  A build
   without it downloads the same file the first time a movie needs it, or when the viewer asks in
   Settings > Playback.

   Where it lives: Storage.sub('bin'), on the TV's big app storage (allows running programs, nosuid),
   named with its version (ffmpeg-7.1-tb1-armv7).  Never in memory (/tmp): if the helper's storage is
   only memory, there is no converter.  Older versions are removed when a new one is in place.

   The bundled .gz or the download: the .gz for this TV's userland from the GitHub release below, checked against the
   SHA-256 written here (never run anything whose hash doesn't match), unpacked with Node's zlib,
   chmod 700, and tried with -version before it counts as ready.

   Which build: armv7 unless the helper's own Node is a 64-bit ARM program.  A 2022 C2 has an aarch64
   kernel (uname -m says so) but a 32-bit userland, and its Node is 32-bit.

   TIVIBRO_FFMPEG=<path> uses that program instead (tests, a computer running the dev helper).

   Routes (proxy.js, behind TiviBro's secret):
     GET  /ffmpeg/status    { state: none | downloading | ready | failed, percent, version, size, where, error, bundled }
     POST /ffmpeg/get       start the download (answers at once with the status)
     POST /ffmpeg/remove    delete it
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), URL_ = require('url');
var crypto = require('crypto'), zlib = require('zlib'), cp = require('child_process');
var Storage = require('./storage');

/* ---------- the release (the lead fills in the hashes after running the build) ---------- */
var TAG = 'ffmpeg-7.1-tb1';
var BASE = 'https://github.com/ohmybahgosh/TiviBro/releases/download/' + TAG + '/';
var SHA256 = {
  armv7: 'bc13c7d8d729d3677d81d946b062ab265b04cf1b21e4d1f37ca8254292fbea6a',
  aarch64: 'a174526b256281865d16cb69d4b84225a3bcc6d03a02a882641c81f5c085fde2'
};
var MAX_BYTES = 16 * 1024 * 1024;           // the .gz is about 1.6 MB; anything far bigger is not it

var st = { state: 'none', percent: 0, error: '' }, busy = false, cbs = [];
var BUNDLE = path.join(__dirname, 'ffmpeg-bundle');
var cfg = { base: BASE, sums: SHA256, bundle: BUNDLE };     // tests point these at a local server and folder (_config)
function bundled(a) { a = a || thisArch(); if (!a) return ''; var f = path.join(cfg.bundle, 'tivibro-ffmpeg-' + a + '.gz'); try { return fs.statSync(f).isFile() ? f : ''; } catch (e) { return ''; } }

var logFn = null;                           // proxy.js hands over its log (setLog)
function log(o) { try { if (logFn) logFn(o); } catch (e) {} }

/* ---------- which build ---------- */
var machine = null;
function unameM() {
  if (machine !== null) return machine;
  try { machine = String(cp.execFileSync('uname', ['-m'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).trim(); } catch (e) { machine = ''; }
  return machine;
}
/* 'armv7', 'aarch64' or '' (not an ARM TV: only TIVIBRO_FFMPEG works there).  The kernel (uname -m)
   only says the TV is ARM; the helper's own Node says whether its programs are 32-bit or 64-bit. */
function arch(pa, um) {
  pa = pa || process.arch;
  if (um === undefined) um = /^arm/.test(pa) ? unameM() : '';
  if (pa === 'arm64') return 'aarch64';                       // a 64-bit Node: the userland is 64-bit too
  if (pa === 'arm') return um && !/^(arm|aarch64)/i.test(um) ? '' : 'armv7';   // 32-bit, even on an aarch64 kernel (C2)
  return '';
}
function thisArch() { return cfg.arch || arch(); }

/* ---------- where ---------- */
function dir() {
  if (Storage.memory()) throw new Error('the helper has no storage on the TV for it, only memory');
  return Storage.sub('bin');
}
function nameFor(a) { return TAG + '-' + a; }
function override() { return process.env.TIVIBRO_FFMPEG || ''; }

// The program to run, or '' when there is none yet.
function binary() {
  if (override()) return override();
  var a = thisArch();
  if (!a) return '';
  try { var f = path.join(dir(), nameFor(a)); fs.accessSync(f, fs.X_OK || 1); return f; } catch (e) { return ''; }
}

function where() {
  if (override()) return 'set by TIVIBRO_FFMPEG';
  var info = Storage.info();
  return info && info.where ? info.where : 'the TV\'s storage';
}

// The version line ffmpeg prints first, checked once per program and size.
var verCache = {};
function version(bin, cb) {
  var size = 0; try { size = fs.statSync(bin).size; } catch (e) { return cb(e); }
  var key = bin + '|' + size;
  if (verCache[key]) return cb(null, verCache[key], size);
  var run = function (cb2) { try { cp.execFile(bin, ['-hide_banner', '-version'], { timeout: 15000 }, cb2); } catch (e) { cb2(e); } };
  run(function (e, out) {
    var line = String(out || '').split('\n')[0];
    if (e || !/^ffmpeg version /.test(line)) return cb(new Error('the converter did not start' + (e ? ': ' + (e.code || e.message) : '')));
    verCache[key] = line.replace(/^ffmpeg version /, '').split(' ')[0];
    cb(null, verCache[key], size);
  });
}

/* ---------- status ---------- */
function status(cb) {
  if (st.state === 'downloading') return cb(copy(st));
  var bin = binary();
  if (!bin) {
    var out = copy(st);
    if (out.state !== 'failed') out.state = 'none';
    if (!override() && !thisArch()) { out.state = 'failed'; out.error = 'this is not an LG TV the converter is built for (' + process.arch + ')'; }
    out.where = where();
    if (bundled()) out.bundled = true;
    return cb(out);
  }
  version(bin, function (e, v, size) {
    if (e) return cb({ state: 'failed', error: e.message, where: where() });
    cb({ state: 'ready', version: v, size: size, where: where(), path: bin, arch: override() ? process.arch : thisArch(), machine: unameM(), bundled: !override() && !!bundled() || undefined });
  });
}
function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

/* ---------- download ---------- */
function fetchTo(url, file, left, onProgress, cb, withCa) {
  var u = URL_.parse(url), lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
  if (!lib) return cb(new Error('not a web address'));
  var opts = { hostname: u.hostname, port: u.port || (lib === https ? 443 : 80), path: u.path, method: 'GET', agent: false,
    headers: { 'User-Agent': 'TiviBro helper', Accept: '*/*', 'Accept-Encoding': 'identity' } };
  if (withCa) opts.ca = require('./media-ca');
  var done = false;
  function finish(e) { if (done) return; done = true; cb(e); }
  var req = lib.request(opts, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      if (left <= 0) return finish(new Error('too many redirects'));
      return fetchTo(URL_.resolve(url, res.headers.location), file, left - 1, onProgress, function (e) { finish(e); }, false);
    }
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('the download server answered ' + res.statusCode)); }
    var total = +res.headers['content-length'] || 0, got = 0, out = fs.createWriteStream(file);
    if (total > MAX_BYTES) { res.resume(); return finish(new Error('the download is far too big')); }
    res.on('data', function (d) {
      got += d.length;
      if (got > MAX_BYTES) { req.abort(); out.destroy(); return finish(new Error('the download is far too big')); }
      onProgress(got, total);
    });
    res.on('error', function (e) { out.destroy(); finish(e); });
    out.on('error', function (e) { finish(e.code === 'ENOSPC' ? new Error('the TV is out of storage') : e); });
    out.on('finish', function () { finish(null); });
    res.pipe(out);
  });
  req.setTimeout(60000, function () { req.abort(); finish(new Error('the download server stopped answering')); });
  req.on('error', function (e) {
    // Old TVs' Node doesn't trust today's certificates: try once more with the bundled roots.
    if (!done && !withCa && u.protocol === 'https:' && /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(e.code || '')) {
      done = true;
      return fetchTo(url, file, left, onProgress, cb, true);
    }
    finish(e);
  });
  req.end();
}
function sha256(file, cb) {
  var h = crypto.createHash('sha256'), s = fs.createReadStream(file);
  s.on('data', function (d) { h.update(d); });
  s.on('error', cb);
  s.on('end', function () { cb(null, h.digest('hex')); });
}
function gunzip(src, dst, cb) {
  var done = false;
  function finish(e) { if (!done) { done = true; cb(e); } }
  var out = fs.createWriteStream(dst, { mode: parseInt('700', 8) }), z = zlib.createGunzip();
  z.on('error', function (e) { out.destroy(); finish(new Error('the download is not a valid .gz file: ' + e.message)); });
  out.on('error', function (e) { finish(e.code === 'ENOSPC' ? new Error('the TV is out of storage') : e); });
  out.on('close', function () { finish(null); });           // 'close': the file is shut, so it can run (no ETXTBSY)
  fs.createReadStream(src).on('error', finish).pipe(z).pipe(out);
}
function rm(f) { try { fs.unlinkSync(f); } catch (e) {} }
// Every other ffmpeg-* in the folder: older versions, and leftovers from a failed try.
function removeOthers(d, keep) {
  var names = []; try { names = fs.readdirSync(d); } catch (e) {}
  names.forEach(function (n) { if (/^ffmpeg-/.test(n) && n !== keep) rm(path.join(d, n)); });
}

// Download, check, unpack and test.  cb(err, status) once it is ready or has failed.
function get(cb) {
  if (cb) cbs.push(cb);
  if (busy) return;
  function end(err) {
    busy = false;
    if (err) { st = { state: 'failed', percent: 0, error: err.message }; log({ lv: 'error', event: 'converter download failed', e: err.message }); }
    else st = { state: 'none', percent: 0, error: '' };
    var list = cbs; cbs = [];
    status(function (s) { list.forEach(function (f) { f(err || null, s); }); });
  }
  if (override()) return end(null);
  var a = thisArch();
  if (!a) return end(new Error('this is not an LG TV the converter is built for (' + process.arch + ')'));
  var want = String(cfg.sums[a] || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return end(new Error('the converter has not been published yet'));
  var d; try { d = dir(); } catch (e) { return end(e); }
  var final = path.join(d, nameFor(a)), gz = final + '.gz.part', tmp = final + '.part';
  busy = true; st = { state: 'downloading', percent: 0, error: '' };
  var from = bundled(a);
  log({ lv: 'info', event: from ? 'converter unpack' : 'converter download', arch: a, tag: TAG });
  var t0 = Date.now();
  var fetch = from ? function (u, file, left, onProgress, cb) { copyFile(from, file, cb); } : fetchTo;
  fetch(cfg.base + 'tivibro-ffmpeg-' + a + '.gz', gz, 5, function (got, total) { st.percent = total ? Math.min(99, Math.floor(got * 100 / total)) : 0; st.bytes = got; }, function (e) {
    if (e) { rm(gz); return end(e); }
    sha256(gz, function (e2, hex) {
      if (e2) { rm(gz); return end(e2); }
      if (hex !== want) { rm(gz); log({ lv: 'error', event: 'converter hash mismatch', got: hex }); return end(new Error('the download did not match its checksum, so it was thrown away')); }
      gunzip(gz, tmp, function (e3) {
        rm(gz);
        if (e3) { rm(tmp); return end(e3); }
        try { fs.chmodSync(tmp, parseInt('700', 8)); } catch (e4) { rm(tmp); return end(e4); }
        version(tmp, function (e5, v) {
          if (e5) { rm(tmp); return end(new Error('the converter does not run on this TV (' + e5.message + ')')); }
          try { fs.renameSync(tmp, final); } catch (e6) { rm(tmp); return end(e6); }
          removeOthers(d, nameFor(a));
          log({ lv: 'info', event: 'converter ready', version: v, ms: Date.now() - t0 });
          end(null);
        });
      });
    });
  });
}

function copyFile(a, b, cb) {
  var done = false, r = fs.createReadStream(a), w = fs.createWriteStream(b);
  function end(e) { if (!done) { done = true; cb(e || null); } }
  r.on('error', end); w.on('error', function (e) { end(e.code === 'ENOSPC' ? new Error('the TV is out of storage') : e); }); w.on('finish', function () { end(null); });
  r.pipe(w);
}
// The helper just started: unpack the bundled converter if it isn't on the TV's storage yet.
function prepare(delayMs) {
  if (override() || !bundled()) return;
  var t = setTimeout(function () { if (!binary() && !busy) get(function (e) { if (e) log({ lv: 'warn', event: 'converter unpack failed', e: e.message }); }); }, delayMs == null ? 5000 : delayMs);
  if (t && t.unref) t.unref();
}

function remove(cb) {
  if (busy) return cb(new Error('it is downloading right now'));
  if (override()) return cb(new Error('set by TIVIBRO_FFMPEG; nothing to remove'));
  try { removeOthers(dir(), ''); } catch (e) {}
  verCache = {};
  st = { state: 'none', percent: 0, error: '' };
  log({ lv: 'info', event: 'converter removed' });
  status(function (s) { cb(null, s); });
}

/* ---------- routes ---------- */
function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var x in ALLOW) h[x] = ALLOW[x];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
function handle(req, res, ALLOW) {
  var route = req.url.split('?')[0];
  if (req.method === 'GET' && route === '/ffmpeg/status') return status(function (s) { send(res, ALLOW, 200, s); });
  if (req.method === 'POST' && route === '/ffmpeg/get') {
    req.resume();
    get(null);
    return status(function (s) { send(res, ALLOW, 200, s); });
  }
  if (req.method === 'POST' && route === '/ffmpeg/remove') {
    req.resume();
    return remove(function (e, s) { send(res, ALLOW, e ? 409 : 200, e ? { error: e.message } : s); });
  }
  send(res, ALLOW, 404, { error: 'unknown converter route' });
}

module.exports = {
  setLog: function (f) { logFn = f; }, TAG: TAG, BASE: BASE, SHA256: SHA256, arch: arch, binary: binary, status: status, get: get, remove: remove, handle: handle, prepare: prepare, bundled: bundled,
  _config: function (o) { if (o.base) cfg.base = o.base; if (o.sums) cfg.sums = o.sums; if (o.bundle !== undefined) cfg.bundle = o.bundle; if (o.arch !== undefined) cfg.arch = o.arch; if (o.reset) { cfg = { base: BASE, sums: SHA256, bundle: BUNDLE }; st = { state: 'none', percent: 0, error: '' }; verCache = {}; } }
};
