/* My media from Windows and Samba shares (SMB), helper side.  webOS won't let an app mount a share, so the
   helper runs a tiny static program for each thing it needs: tivibro-smb (scripts/smb/tivibro-smb.c, on
   libsmb2), which speaks SMB 2 and 3 with NTLMv2, signing and encryption, and never SMB1.

   What it does here:
     check / shares / list / stat   one short run each, answers as JSON lines
     reader                         a movie read with Range for media-stream.js: each range is one run of
                                    "cat", so seeking simply starts another one and the old one is stopped
     put / writer                   a file written: a small one at once, or a recording's part as it comes
     mkdirs / remove / move / space folders, deleting, renaming and free room (recordings and live pause,
                                    recsmb.js)

   A source is { type: 'smb', server: 'host' or 'host:port', host (the server's name, when server is an
   address), share, folder ('/' or '/Movies'), user, pass, domain }.  The login goes to the program on its stdin, never on its command line (other programs on
   the TV can read those), and never into a log.  An empty user signs in as a guest.

   Memory: the program holds at most 1.5 MB while it reads, and the helper runs at most MAX_RUNS of the
   short ones at a time (and MAX_READS reads), so a TV with 1 GB isn't pushed by a big scan.

   The program: TIVIBRO_SMB=<path> (tests, a computer running the dev helper), else the one bundled with a
   release (service/smb-bundle/tivibro-smb-<arch>.gz), unpacked onto the TV's storage the first time it's
   needed, checked against the SHA-256 written below, and tried with -version before it is used.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
require('./compat');
var fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto'), zlib = require('zlib');
var Storage = require('./storage');

var VERSION = '3';
/* The release the bundled programs come from (.github/workflows/smb.yml, scripts/smb/bundle.sh), and the
   SHA-256 of each .gz there. */
var TAG = 'smb-1-tb2';
var SHA256 = { armv7: '26387ede8e1585d18fe97c27f1b5e046171629ed69a623442ff692f7f6091ef8', aarch64: 'f57f1a4b583427c05f2fda9400e0f0f60a5b67c7bb064cb3b21c495bb23fc10f' };
var BUNDLE = path.join(__dirname, 'smb-bundle');
var cfg = { sums: SHA256, bundle: BUNDLE, arch: null, dir: '' };
var RUN_MS = 30000, OUT_MAX = 8 * 1024 * 1024, ERR_MAX = 4096, MAX_RUNS = 2, MAX_READS = 4;

var logFn = null;
function log(o) { try { if (logFn) logFn(o); } catch (e) {} }
function str(v) { return v == null ? '' : String(v); }

/* ---------- the source, checked before anything runs ---------- */

// host, host:port, or [IPv6]:port.  Nothing that could start with "-" (it goes on a command line).
var SERVER = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,252}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
function bad(kind) { var e = new Error(kind); e.kind = kind; return e; }
// A path inside the share: forward slashes, starting with one, no empty, "." or ".." parts.
function cleanPath(p) {
  var parts = str(p).replace(/\\/g, '/').split('/').filter(function (x) { return x !== '' && x !== '.'; });
  if (parts.some(function (x) { return x === '..' || /[\x00-\x1f]/.test(x); })) return null;
  return '/' + parts.join('/');
}
/* ---------- a server whose address changed ----------
   A source keeps the server's name (host: the name it was found under, or the name typed) as well as the
   address.  When the address stops answering, the server is looked for on the network by that name
   (smb-discover.js) and, if it answers somewhere else now, used there: here until the helper restarts,
   and saved with the source by the app (movedTo, sent back with scans and checks).  One look per name a
   minute, so a server that is simply off doesn't slow every ask. */
var moved = {}, lastLook = {};
function isAddress(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[/.test(h); }
// The server's name for looking it up, lower case, without :port or .local; '' when there's only an address.
function hostKey(s) {
  var h = str(s && s.host).trim() || str(s && s.server).trim().replace(/:\d+$/, '');
  return !h || isAddress(h) ? '' : h.toLowerCase().replace(/\.local\.?$/, '');
}
function whereNow(s) { var k = hostKey(s); return k && moved[k] ? moved[k] : ''; }
// Where a source's server answers now, when that isn't its saved address (else '').
function movedTo(s) { var w = whereNow(s); return w && w !== str(s && s.server).trim() ? w : ''; }
/* Looks for the server by name (cb(true) when it moved, so the ask is worth trying again).  The port the
   source had is kept unless the network says another. */
function relocate(s, cb) {
  var k = hostKey(s), now = Date.now();
  if (!k || now - (lastLook[k] || 0) < 60000) return cb(false);
  lastLook[k] = now;
  (cfg.locate || require('./smb-discover').locate)(k, function (found) {
    if (!found) return cb(false);
    var port = /:(\d+)$/.exec(str(s.server)), to = /:\d+$/.test(found) || !port || port[1] === '445' ? found : found + ':' + port[1];
    if (to === (whereNow(s) || str(s.server).trim())) return cb(false);
    moved[k] = to;
    log({ lv: 'info', event: 'smb server moved', host: k });
    cb(true);
  });
}

// The checked parts of a source, or an Error with kind 'address' or 'login'.
function parts(source) {
  var s = source || {}, server = whereNow(s) || str(s.server).trim(), share = str(s.share).trim().replace(/^[\\/]+|[\\/]+$/g, '');
  var port = /:(\d+)$/.exec(server.replace(/^\[[^\]]*\]/, ''));
  if (!SERVER.test(server) || (port && (+port[1] < 1 || +port[1] > 65535))) return bad('address');
  if (share && (!/^[^\\/\x00-\x1f"*:<>?|]{1,80}$/.test(share) || share.charAt(0) === '-')) return bad('address');
  var login = [str(s.user), str(s.pass), str(s.domain)];
  if (login.some(function (x) { return /[\r\n]/.test(x) || x.length > 400; })) return bad('login');
  var folder = cleanPath(s.folder || '/');
  if (folder === null) return bad('address');
  return { server: server, share: share, folder: folder, login: login.join('\n') + '\n' };
}

/* ---------- the program ---------- */

function override() { return process.env.TIVIBRO_SMB || ''; }
/* The builds to try, best first.  A TV with a 64-bit kernel under a 32-bit userland (a C2: uname says
   aarch64, its Node is 32-bit) runs the static 64-bit build too, and that one has the ARMv8 AES
   instructions, which makes the signing and encryption of every read several times cheaper.  If it
   doesn't start there, the 32-bit build is used. */
function arches() {
  if (cfg.archList) return cfg.archList;
  if (cfg.arch != null) return cfg.arch ? [cfg.arch] : [];
  var a = require('./ffmpeg').arch(), m = '';
  if (a !== 'armv7') return a ? [a] : [];
  try { m = str(cp.execFileSync('uname', ['-m'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).trim(); } catch (e) {}
  return m === 'aarch64' ? ['aarch64', 'armv7'] : ['armv7'];
}
// The unpacked program's name carries its release, so a new release is unpacked again.
function nameFor(a) { return TAG + '-' + a; }
// Older unpacked programs in the folder, once a new one runs.
function removeOld(dir) { try { fs.readdirSync(dir).forEach(function (n) { if (/^smb-/.test(n) && n.indexOf(TAG + '-') !== 0) rm(path.join(dir, n)); }); } catch (e) {} }
function sha256(file, cb) {
  var h = crypto.createHash('sha256'), s = fs.createReadStream(file);
  s.on('data', function (d) { h.update(d); }); s.on('error', cb); s.on('end', function () { cb(null, h.digest('hex')); });
}
function rm(f) { try { fs.unlinkSync(f); } catch (e) {} }

var ready = '', preparing = null;
/* cb(err, path): the program to run.  The first call on a TV unpacks the bundled one (about 100 KB):
   checked, unpacked, made runnable and tried, then kept for every later call. */
function program(cb) {
  if (override()) return cb(null, override());
  if (ready) return cb(null, ready);
  if (preparing) return preparing.push(cb);
  preparing = [cb];
  function end(e, file) {
    var list = preparing; preparing = null;
    if (!e) ready = file;
    else log({ lv: 'warn', event: 'smb program', e: e.message });
    list.forEach(function (f) { f(e, file); });
  }
  var list = arches();
  if (!list.length) return end(new Error('Windows shares need an LG TV (' + process.arch + ')'));
  // The recording agent (root, rooted TVs) keeps its own copy (binDir), so root never writes into the helper's folder.
  var dir; try { dir = cfg.dir || Storage.sub('bin'); if (cfg.dir) { try { fs.mkdirSync(cfg.dir); } catch (x) {} } } catch (e) { return end(e); }
  (function next(i, firstErr) {
    if (i >= list.length) return end(firstErr);
    prepareOne(dir, list[i], function (e, file) { if (!e) return end(null, file); next(i + 1, firstErr || e); });
  })(0, null);
}
/* One build (a = armv7 or aarch64): the copy already on the TV's storage if it runs, else the bundled .gz,
   checked against its SHA-256, unpacked, made runnable and tried.  cb(err, path). */
function prepareOne(dir, a, cb) {
  var final = path.join(dir, nameFor(a)), gz = path.join(cfg.bundle, 'tivibro-smb-' + a + '.gz'), tmp = final + '.part';
  try { fs.accessSync(final, fs.X_OK || 1); return tryRun(final, function (e) { if (!e) return cb(null, final); rm(final); unpack(); }); } catch (e) { unpack(); }
  function unpack() {
    var want = str(cfg.sums[a]).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return cb(new Error('this TiviBro doesn\'t carry the program for Windows shares yet'));
    sha256(gz, function (e, hex) {
      if (e) return cb(new Error('this TiviBro doesn\'t carry the program for Windows shares'));
      if (hex !== want) return cb(new Error('the program for Windows shares didn\'t match its checksum'));
      var out = fs.createWriteStream(tmp, { mode: parseInt('700', 8) }), z = zlib.createGunzip(), done = false;
      function fin(err) {
        if (done) return; done = true;
        if (err) { rm(tmp); return cb(err); }
        try { fs.chmodSync(tmp, parseInt('700', 8)); fs.renameSync(tmp, final); } catch (e2) { rm(tmp); return cb(e2); }
        tryRun(final, function (e3) { if (e3) { rm(final); return cb(e3); } removeOld(dir); log({ lv: 'info', event: 'smb program ready', arch: a }); cb(null, final); });
      }
      z.on('error', fin); out.on('error', fin); out.on('close', function () { fin(null); });
      fs.createReadStream(gz).on('error', fin).pipe(z).pipe(out);
    });
  }
}
// Runs it once with -version: a program that doesn't start on this TV is never used.
function tryRun(file, cb) {
  try {
    cp.execFile(file, ['-version'], { timeout: 10000 }, function (e, out) {
      cb(e || !/^tivibro-smb /.test(str(out)) ? new Error('the program for Windows shares doesn\'t run on this TV') : null);
    });
  } catch (e) { cb(e); }
}

/* ---------- running it ---------- */

var running = 0, waiting = [];
// At most MAX_RUNS short runs at a time; the rest wait their turn.
function slot(fn) {
  if (running < MAX_RUNS) { running++; return fn(function () { running--; var next = waiting.shift(); if (next) slot(next); }); }
  waiting.push(fn);
}
/* The error the program printed on stderr ({"error": kind, ...}), or a general one.  kind is one of
   login, denied, noshare, notfound, unreachable, timeout, signing, smb1, other. */
function errorFrom(code, stderr) {
  var line = str(stderr).trim().split('\n').pop(), j = null;
  try { j = JSON.parse(line); } catch (e) {}
  var e = new Error(j && j.detail ? j.detail : 'exit ' + code);
  e.kind = j && j.error ? j.error : 'other';
  e.status = j && j.status;
  return e;
}
/* One short run: cb(err, rows), rows being the JSON lines it printed.  Stopped after RUN_MS, and its
   output is capped (a folder of a few thousand files is well under it). */
function run(p, args, cb, input) {
  program(function (e, prog) {
    if (e) { e.kind = e.kind || 'program'; return cb(e); }
    slot(function (free) {
      var child, out = [], outLen = 0, err = '', done = false, timer;
      function finish(e2, rows) { if (done) return; done = true; clearTimeout(timer); free(); cb(e2, rows); }
      try { child = cp.spawn(prog, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e3) { return finish(e3); }
      timer = setTimeout(function () { try { child.kill('SIGKILL'); } catch (x) {} finish(bad('timeout')); }, RUN_MS);
      child.stdout.on('data', function (d) { outLen += d.length; if (outLen > OUT_MAX) { try { child.kill('SIGKILL'); } catch (x) {} return finish(bad('other')); } out.push(d); });
      child.stderr.on('data', function (d) { if (err.length < ERR_MAX) err += d; });
      child.on('error', function (e4) { finish(e4); });
      child.on('close', function (code) {
        if (code !== 0) return finish(errorFrom(code, err));
        var rows = [];
        Buffer.concat(out).toString('utf8').split('\n').forEach(function (l) { if (l) { try { rows.push(JSON.parse(l)); } catch (x) {} } });
        finish(null, rows);
      });
      child.stdin.on('error', function () {});
      child.stdin.end(input ? Buffer.concat([Buffer.from(p.login), input]) : p.login);
    });
  });
}

/* ---------- what My media asks ---------- */

/* One run for a source: build(p) gives the program's arguments from the checked parts, input what follows the
   login on its stdin (a file put).  A server that doesn't answer is looked for by name and, found elsewhere, asked
   once more there. */
function runFor(source, build, cb, input) {
  var p = parts(source); if (p instanceof Error) return cb(p);
  var args = build(p); if (args instanceof Error) return cb(args);
  run(p, args, function (e, rows) {
    if (!e || (e.kind !== 'unreachable' && e.kind !== 'timeout')) return cb(e, rows, p);
    relocate(source, function (again) {
      if (!again) return cb(e, rows, p);
      var p2 = parts(source);
      run(p2, build(p2), function (e2, rows2) { cb(e2, rows2, p2); }, input);
    });
  }, input);
}

// Signs in and opens the share: cb(err, { dialect }).
function check(source, cb) {
  runFor(source, function (p) { return p.share ? ['check', p.server, p.share] : bad('noshare'); }, function (e, rows) { cb(e, e ? null : { dialect: rows[0] && rows[0].dialect }); });
}
// The disk shares on the source's server (hidden ones like C$ left out): cb(err, [{ name, comment }]).
function shares(source, cb) {
  runFor(source, function (p) { return ['shares', p.server]; }, function (e, rows) {
    cb(e, e ? null : rows.filter(function (r) { return r && typeof r.name === 'string'; }).map(function (r) { return { name: r.name, comment: str(r.comment) }; }));
  });
}
/* One folder (a path inside the share; the source's folder when empty): cb(err, entries), each
   { name, dir, size, mtime (ms), path }. */
function list(source, folder, cb) {
  var f = null;
  runFor(source, function (p) { f = cleanPath(folder || p.folder); return f === null || !p.share ? bad('address') : ['ls', p.server, p.share, f]; }, function (e, rows) {
    if (e) return cb(e);
    cb(null, rows.filter(function (r) { return r && typeof r.name === 'string' && r.name.indexOf('/') < 0; }).map(function (r) {
      return { name: r.name, dir: !!r.dir, size: +r.size || 0, mtime: (+r.mtime || 0) * 1000, path: (f === '/' ? '' : f) + '/' + r.name };
    }));
  });
}
// One file: cb(err, { size, mtime, dir }).
function stat(source, file, cb) {
  var f = cleanPath(file);
  runFor(source, function (p) { return !f || f === '/' || !p.share ? bad('address') : ['stat', p.server, p.share, f]; }, function (e, rows) {
    if (e || !rows[0]) return cb(e || bad('notfound'));
    cb(null, { size: +rows[0].size || 0, mtime: (+rows[0].mtime || 0) * 1000, dir: !!rows[0].dir });
  });
}

/* The source's folder and its folders down to depth (at most 4): cb(err, [{ path, mtime (ms), files }]), for
   the check for new media.  A program from before tree (tivibro-smb 1) answers 'other'. */
function tree(source, depth, cb) {
  runFor(source, function (p) { return p.share ? ['tree', p.server, p.share, p.folder, String(Math.max(0, Math.min(4, depth | 0)))] : bad('noshare'); }, function (e, rows) {
    if (e) return cb(e);
    cb(null, rows.filter(function (r) { return r && typeof r.path === 'string'; }).map(function (r) { return { path: r.path, mtime: (+r.mtime || 0) * 1000, files: +r.files || 0 }; }));
  });
}

// The reads running now (cat runs), oldest first.
var reads = [];
/* A movie for media-stream.js: size(cb) once, then open(start, end, cb(err, stream, stop)) for each
   range the player asks.  Reads don't wait behind scans; at most MAX_READS at once (a player, its
   subtitle reader and a seek preview), the oldest stopped to make room. */
function reader(source, file) {
  var f = cleanPath(file), known = null;
  return {
    size: function (cb) {
      if (known) return cb(null, known);
      stat(source, file, function (e, st) { if (!e) known = st; cb(e, st); });
    },
    open: function (start, end, cb) {
      var p = parts(source);              // here, not before: the size check may have found the server elsewhere
      if (p instanceof Error || !f) return cb(p instanceof Error ? p : bad('address'));
      program(function (e, prog) {
        if (e) return cb(e);
        while (reads.length >= MAX_READS) { try { reads.shift().kill('SIGKILL'); } catch (x) {} }
        var child, err = '';
        try { child = cp.spawn(prog, ['cat', p.server, p.share, f, String(start), String(end - start + 1)], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e2) { return cb(e2); }
        reads.push(child);
        child.on('close', function () { var i = reads.indexOf(child); if (i >= 0) reads.splice(i, 1); });
        child.on('error', function () {});
        child.stderr.on('data', function (d) { if (err.length < ERR_MAX) err += d; });
        child.on('exit', function (code) { if (code) log({ lv: 'warn', event: 'smb read', e: errorFrom(code, err).kind }); });
        child.stdin.on('error', function () {});
        child.stdin.end(p.login);
        cb(null, child.stdout, function () { try { child.kill('SIGKILL'); } catch (x) {} });
      });
    }
  };
}

/* ---------- writing (version 3): recordings and live pause on a share ---------- */

// A file inside the share for writing: never the share itself.
function fileOf(file) { var f = cleanPath(file); return f && f !== '/' ? f : null; }
/* A small file (a live-pause piece, a poster, an .nfo) written whole: its folders are made first.  cb(err, size). */
function put(source, file, data, cb) {
  var f = fileOf(file), buf = Buffer.isBuffer(data) ? data : Buffer.from(str(data));
  runFor(source, function (p) { return f && p.share ? ['put', p.server, p.share, f, '0'] : bad('address'); }, function (e, rows) {
    cb(e, e ? 0 : +(rows[0] && rows[0].size) || 0);
  }, buf);
}
// Folder and the ones above it, made when they aren't there.  cb(err).
function mkdirs(source, folder, cb) {
  var f = cleanPath(folder);
  if (f === '/') return cb(null);
  runFor(source, function (p) { return f && p.share ? ['mkdir', p.server, p.share, f] : bad('address'); }, function (e) { cb(e); });
}
/* Files, and folders once empty, deleted; one that isn't there counts as done.  cb(err, [paths that stayed]).
   Many at once go in runs of 50, so the command line stays short. */
function remove(source, files, cb) {
  var list = (files || []).map(fileOf).filter(Boolean), stayed = [];
  (function next() {
    if (!list.length) return cb(null, stayed);
    var batch = list.splice(0, 50);
    runFor(source, function (p) { return p.share ? ['rm', p.server, p.share].concat(batch) : bad('address'); }, function (e, rows) {
      if (e) return cb(e, stayed.concat(batch, list));
      rows.forEach(function (r) { if (r && r.ok === false) stayed.push('/' + str(r.path)); });
      next();
    });
  })();
}
// Renamed or moved (its new folder made); never over a file that's there.  cb(err).
function move(source, from, to, cb) {
  var a = fileOf(from), b = fileOf(to);
  runFor(source, function (p) { return a && b && p.share ? ['mv', p.server, p.share, a, b] : bad('address'); }, function (e) { cb(e); });
}
// The room on the share for this login: cb(err, { freeMB, totalMB }).
function space(source, cb) {
  runFor(source, function (p) { return p.share ? ['df', p.server, p.share] : bad('noshare'); }, function (e, rows) {
    if (e || !rows[0]) return cb(e || bad('other'));
    cb(null, { freeMB: Math.round((+rows[0].free || 0) / 1048576), totalMB: Math.round((+rows[0].total || 0) / 1048576) });
  });
}
/* A recording's part, written as it arrives: write(buf) and end(cb), as recdav.js's upload.  One run of "put" that
   lasts the whole part, outside the queue of short runs.  onFail(err) once if it stops early (the share went away,
   it's full); what was written before that stays on the share. */
function writer(source, file, onFail) {
  var f = fileOf(file), p = parts(source), child = null, failed = false, ended = false, endCb = null, err = '', pending = [];
  function fail(e) {
    if (failed) return; failed = true;
    if (endCb) { var c = endCb; endCb = null; c(e); } else if (onFail) onFail(e);
  }
  if (p instanceof Error || !f || !p.share) { setTimeout(function () { fail(p instanceof Error ? p : bad('address')); }, 0); }
  else program(function (e, prog) {
    if (e) return fail(e);
    if (failed) return;
    try { child = cp.spawn(prog, ['put', p.server, p.share, f, '0'], { stdio: ['pipe', 'ignore', 'pipe'] }); } catch (e2) { return fail(e2); }
    child.on('error', function (e3) { fail(e3); });
    child.stderr.on('data', function (d) { if (err.length < ERR_MAX) err += d; });
    child.stdin.on('error', function () {});
    child.on('close', function (code) {
      if (code) return fail(errorFrom(code, err));
      if (!ended) return fail(bad('other'));
      if (endCb) { var c = endCb; endCb = null; c(null); }
    });
    child.stdin.write(p.login);
    pending.forEach(function (b) { child.stdin.write(b); }); pending = null;
    if (ended) child.stdin.end();
  });
  return {
    write: function (buf) { if (failed || ended) return true; if (!child || pending) { (pending = pending || []).push(buf); return true; } return child.stdin.write(buf); },
    end: function (cb) {
      if (ended) return cb && cb(null);
      ended = true;
      if (failed) return cb && cb(bad('other'));
      endCb = cb || function () {};
      if (child && !pending) child.stdin.end();
    },
    abort: function () { failed = true; try { if (child) child.kill('SIGKILL'); } catch (e) {} },
    get failed() { return failed; }
  };
}

// What a failure says to the viewer, by kind.
var MESSAGES = {
  login: 'The share didn\'t accept that user name and password.  On a Windows PC, use the PC\'s account (or Microsoft account email) and its password.',
  denied: 'That user can\'t open this share or folder.  Check its sharing permissions.',
  noshare: 'There\'s no share by that name on the server.',
  notfound: 'That folder or file isn\'t on the share.',
  unreachable: 'The server didn\'t answer.  Check its name or address, and that file sharing is on.',
  timeout: 'The server took too long to answer.',
  signing: 'The server only lets signed-in users in: guests can\'t sign their connection.  Enter a user name and password.',
  smb1: 'This server only speaks SMB1, which is unsafe and not supported.  Turn on SMB2 or SMB3 on it.',
  full: 'The share is full.',
  exists: 'There\'s already a file by that name on the share.',
  address: 'That isn\'t a server name or address TiviBro can use.',
  program: 'This TiviBro can\'t open Windows shares on this TV yet.',
  other: 'The share couldn\'t be read.'
};
function failure(e) {
  var kind = e && e.kind && MESSAGES[e.kind] ? e.kind : 'other';
  return { error: kind, message: kind === 'program' && e.message ? MESSAGES.program + '  (' + e.message + ')' : MESSAGES[kind] };
}

module.exports = {
  setLog: function (f) { logFn = f; }, VERSION: VERSION, TAG: TAG, SHA256: SHA256,
  check: check, shares: shares, list: list, stat: stat, tree: tree, reader: reader, put: put, writer: writer, mkdirs: mkdirs, remove: remove, move: move, space: space,
  binDir: function (d) { cfg.dir = d; ready = ''; }, movedTo: movedTo, hostKey: hostKey, failure: failure, parts: parts, cleanPath: cleanPath, program: program,
  _config: function (o) { if (o.sums) cfg.sums = o.sums; if (o.bundle !== undefined) cfg.bundle = o.bundle; if (o.arch !== undefined) cfg.arch = o.arch; if (o.archList) cfg.archList = o.archList; if (o.reset) { cfg = { sums: SHA256, bundle: BUNDLE, arch: null, dir: '', locate: cfg.locate }; ready = ''; } if (o.runMs) RUN_MS = o.runMs; if (o.locate !== undefined) cfg.locate = o.locate; if (o.forget) { moved = {}; lastLook = {}; } }
};
