/* My media from Windows and Samba shares (SMB), helper side.  webOS won't let an app mount a share, so the
   helper runs a tiny static program for each thing it needs: tivibro-smb (scripts/smb/tivibro-smb.c, on
   libsmb2), which speaks SMB 2 and 3 with NTLMv2, signing and encryption, and never SMB1.

   What it does here:
     check / shares / list / stat   one short run each, answers as JSON lines
     reader                         a movie read with Range for media-stream.js: each range is one run of
                                    "cat", so seeking simply starts another one and the old one is stopped

   A source is { type: 'smb', server: 'host' or 'host:port', share, folder ('/' or '/Movies'), user, pass,
   domain }.  The login goes to the program on its stdin, never on its command line (other programs on
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

var VERSION = '1';
/* The release the bundled programs come from (.github/workflows/smb.yml, scripts/smb/bundle.sh), and the
   SHA-256 of each .gz there, filled in once it is published.  Empty: this build carries none. */
var TAG = 'smb-1-tb1';
var SHA256 = { armv7: '', aarch64: '' };
var BUNDLE = path.join(__dirname, 'smb-bundle');
var cfg = { sums: SHA256, bundle: BUNDLE, arch: null };
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
// The checked parts of a source, or an Error with kind 'address' or 'login'.
function parts(source) {
  var s = source || {}, server = str(s.server).trim(), share = str(s.share).trim().replace(/^[\\/]+|[\\/]+$/g, '');
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
function thisArch() { return cfg.arch != null ? cfg.arch : require('./ffmpeg').arch(); }
function nameFor(a) { return 'smb-' + VERSION + '-' + a; }
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
  var a = thisArch();
  if (!a) return end(new Error('Windows shares need an LG TV (' + process.arch + ')'));
  var dir; try { dir = Storage.sub('bin'); } catch (e) { return end(e); }
  var final = path.join(dir, nameFor(a)), gz = path.join(cfg.bundle, 'tivibro-smb-' + a + '.gz'), tmp = final + '.part';
  try { fs.accessSync(final, fs.X_OK || 1); return tryRun(final, function (e) { if (!e) return end(null, final); rm(final); program2(); }); } catch (e) { program2(); }
  function program2() {
    var want = str(cfg.sums[a]).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return end(new Error('this TiviBro doesn\'t carry the program for Windows shares yet'));
    sha256(gz, function (e, hex) {
      if (e) return end(new Error('this TiviBro doesn\'t carry the program for Windows shares'));
      if (hex !== want) return end(new Error('the program for Windows shares didn\'t match its checksum'));
      var out = fs.createWriteStream(tmp, { mode: parseInt('700', 8) }), z = zlib.createGunzip(), done = false;
      function fin(err) {
        if (done) return; done = true;
        if (err) { rm(tmp); return end(err); }
        try { fs.chmodSync(tmp, parseInt('700', 8)); fs.renameSync(tmp, final); } catch (e2) { rm(tmp); return end(e2); }
        tryRun(final, function (e3) { if (e3) { rm(final); return end(e3); } log({ lv: 'info', event: 'smb program ready', arch: a }); end(null, final); });
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
function run(p, args, cb) {
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
      child.stdin.end(p.login);
    });
  });
}

/* ---------- what My media asks ---------- */

// Signs in and opens the share: cb(err, { dialect }).
function check(source, cb) {
  var p = parts(source); if (p instanceof Error) return cb(p);
  if (!p.share) return cb(bad('noshare'));
  run(p, ['check', p.server, p.share], function (e, rows) { cb(e, e ? null : { dialect: rows[0] && rows[0].dialect }); });
}
// The disk shares on the source's server (hidden ones like C$ left out): cb(err, [{ name, comment }]).
function shares(source, cb) {
  var p = parts(source); if (p instanceof Error) return cb(p);
  run(p, ['shares', p.server], function (e, rows) {
    cb(e, e ? null : rows.filter(function (r) { return r && typeof r.name === 'string'; }).map(function (r) { return { name: r.name, comment: str(r.comment) }; }));
  });
}
/* One folder (a path inside the share; the source's folder when empty): cb(err, entries), each
   { name, dir, size, mtime (ms), path }. */
function list(source, folder, cb) {
  var p = parts(source); if (p instanceof Error) return cb(p);
  var f = cleanPath(folder || p.folder);
  if (f === null || !p.share) return cb(bad('address'));
  run(p, ['ls', p.server, p.share, f], function (e, rows) {
    if (e) return cb(e);
    cb(null, rows.filter(function (r) { return r && typeof r.name === 'string' && r.name.indexOf('/') < 0; }).map(function (r) {
      return { name: r.name, dir: !!r.dir, size: +r.size || 0, mtime: (+r.mtime || 0) * 1000, path: (f === '/' ? '' : f) + '/' + r.name };
    }));
  });
}
// One file: cb(err, { size, mtime, dir }).
function stat(source, file, cb) {
  var p = parts(source); if (p instanceof Error) return cb(p);
  var f = cleanPath(file);
  if (!f || f === '/' || !p.share) return cb(bad('address'));
  run(p, ['stat', p.server, p.share, f], function (e, rows) {
    if (e || !rows[0]) return cb(e || bad('notfound'));
    cb(null, { size: +rows[0].size || 0, mtime: (+rows[0].mtime || 0) * 1000, dir: !!rows[0].dir });
  });
}

// The reads running now (cat runs), oldest first.
var reads = [];
/* A movie for media-stream.js: size(cb) once, then open(start, end, cb(err, stream, stop)) for each
   range the player asks.  Reads don't wait behind scans; at most MAX_READS at once (a player, its
   subtitle reader and a seek preview), the oldest stopped to make room. */
function reader(source, file) {
  var p = parts(source), f = cleanPath(file), known = null;
  return {
    size: function (cb) {
      if (known) return cb(null, known);
      stat(source, file, function (e, st) { if (!e) known = st; cb(e, st); });
    },
    open: function (start, end, cb) {
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
  check: check, shares: shares, list: list, stat: stat, reader: reader, failure: failure, parts: parts, cleanPath: cleanPath, program: program,
  _config: function (o) { if (o.sums) cfg.sums = o.sums; if (o.bundle !== undefined) cfg.bundle = o.bundle; if (o.arch !== undefined) cfg.arch = o.arch; if (o.reset) { cfg = { sums: SHA256, bundle: BUNDLE, arch: null }; ready = ''; } if (o.runMs) RUN_MS = o.runMs; }
};
