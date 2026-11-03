/* My media storage: small JSON files in one folder, read when needed and kept in memory only briefly.

   Why this shape: the helper runs on small TVs (webOS kills it around 500 MB), and flash storage
   wears out with frequent rewrites of big files.  So the library is split into many small files and
   nothing reads the whole library at once:
     catalog.json        the index: revision, sources, saved command ids, row counts per file
     shows.json          every show's own record (title, match, favourite, order)
     handles.json        which file holds each media file (file handle -> shard name)
     progress.json       playback positions (outside the revision, see media-catalog.js)
     undo.json           the last few correction undos
     src_<hash>.json     one per source: its movies, extras and files that need review, and its folder rules
     show_<hex>.json     one per show: its episodes, the files they play from, season details, merges
   Each file is written whole to a temporary file and renamed over the old one (atomic on the TV's
   file system), and only when its content changed (a digest of each file's last known content is
   kept, a few bytes per file).  A read keeps the parsed file in a memo for a minute after its last
   use, and the memo is capped by size; work that goes through many files (an import, a list of every
   file) reads them "passing", without filling the memo.

   Plain ES5 with callbacks for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var IDLE_MS = 60000, MEMO_BYTES = 6 * 1048576, MAX_FILE = 96 * 1048576;
var CORE = { 'shows.json': true, 'handles.json': true, 'progress.json': true };

function failure(code, message) { var e = new Error(message); e.code = code; return e; }
function digest(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }
function validName(name) { return typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,80}\.json$/.test(name) && name.indexOf('..') < 0; }

/* Write name in root atomically: a new temporary file, then a rename over the old one. */
function atomic(root, name, body, cb) {
  var temporary = path.join(root, '.' + name + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  fs.writeFile(temporary, body, function (e) {
    if (e) return fs.unlink(temporary, function () { cb(e); });
    fs.rename(temporary, path.join(root, name), function (renameError) {
      if (renameError) return fs.unlink(temporary, function () { cb(renameError); });
      cb(null);
    });
  });
}

function Store(root, opts) {
  opts = opts || {};
  this.root = root;
  this.memo = {};
  this.memoBytes = 0;
  this.sigs = {};
  this.idleMs = opts.idleMs || IDLE_MS;
  this.maxBytes = opts.maxBytes || MEMO_BYTES;
  this.reads = 0;
  this.writes = 0;
  this.timer = null;
}
Store.prototype.open = function (cb) {
  var self = this;
  fs.mkdir(self.root, function (e) {
    if (e && e.code !== 'EEXIST') return cb(e);
    // Temporary files left by a write that never finished.
    fs.readdir(self.root, function (err, names) {
      if (err) return cb(err);
      var left = (names || []).filter(function (n) { return /\.tmp$/.test(n); }), at = 0;
      (function next() {
        if (at >= left.length) return cb(null, self);
        fs.unlink(path.join(self.root, left[at++]), function () { next(); });
      })();
    });
  });
};
Store.prototype.sweepSoon = function () {
  var self = this;
  if (self.timer) return;
  self.timer = setTimeout(function () {
    self.timer = null;
    var now = Date.now(), any = false;
    Object.keys(self.memo).forEach(function (k) {
      if (now - self.memo[k].used >= self.idleMs) { self.memoBytes -= self.memo[k].bytes; delete self.memo[k]; } else any = true;
    });
    if (any) self.sweepSoon();
  }, Math.max(1000, Math.min(30000, self.idleMs)));
  if (self.timer.unref) self.timer.unref();
};
Store.prototype.remember = function (name, data, bytes, sig) {
  if (sig) this.sigs[name] = sig;
  var old = this.memo[name];
  if (old) this.memoBytes -= old.bytes;
  this.memo[name] = { data: data, bytes: bytes, sig: sig, used: Date.now() };
  this.memoBytes += bytes;
  // Over the cap: the least recently used shard files leave first (the small core files stay until idle).
  if (this.memoBytes > this.maxBytes) {
    var self = this, keys = Object.keys(self.memo).filter(function (k) { return k !== name && !CORE[k]; });
    keys.sort(function (a, b) { return self.memo[a].used - self.memo[b].used; });
    while (self.memoBytes > self.maxBytes && keys.length) { var k = keys.shift(); self.memoBytes -= self.memo[k].bytes; delete self.memo[k]; }
  }
  this.sweepSoon();
};
/* The parsed file, or fallback() when it does not exist yet.  A file that does not parse is an error:
   only a missing file may become an empty one.  passing: do not keep it in the memo. */
Store.prototype.read = function (name, fallback, cb, passing) {
  var self = this;
  if (!validName(name)) return cb(failure('INVALID_NAME', 'Invalid library file.'));
  var hit = self.memo[name];
  if (hit) { hit.used = Date.now(); return cb(null, hit.data); }
  var file = path.join(self.root, name);
  fs.stat(file, function (statError, st) {
    if (statError && statError.code === 'ENOENT') { var fresh = fallback ? fallback() : null; delete self.sigs[name]; if (fresh && !passing) self.remember(name, fresh, 64, null); return cb(null, fresh); }
    if (statError) return cb(statError);
    if (st.size > MAX_FILE) return cb(failure('CORRUPT_LIBRARY', 'A library file is too large.'));
    fs.readFile(file, 'utf8', function (e, body) {
      if (e) return cb(e);
      var data;
      self.reads++;
      try { data = JSON.parse(body); } catch (parseError) { return cb(failure('CORRUPT_LIBRARY', 'A library file could not be read.')); }
      if (!data || typeof data !== 'object') return cb(failure('CORRUPT_LIBRARY', 'A library file could not be read.'));
      // Another read may have finished first; keep one object per file.
      if (self.memo[name]) { self.memo[name].used = Date.now(); return cb(null, self.memo[name].data); }
      if (passing) self.sigs[name] = digest(body); else self.remember(name, data, body.length, digest(body));
      cb(null, data);
    });
  });
};
/* Save data as name, unless it is exactly what the file already holds.  passing: as for read. */
Store.prototype.write = function (name, data, cb, passing) {
  var self = this, body;
  if (!validName(name)) return cb(failure('INVALID_NAME', 'Invalid library file.'));
  try { body = JSON.stringify(data); } catch (e) { return cb(e); }
  var sig = digest(body), hit = self.memo[name];
  if (self.sigs[name] === sig) { if (hit) { hit.data = data; hit.used = Date.now(); } return cb(null, false); }
  if (passing && !hit) data = null;      // not needed once serialised; let it go while the disk works
  atomic(self.root, name, body, function (e) {
    if (e) { self.forget(name); delete self.sigs[name]; return cb(e); }
    self.writes++;
    if (passing && !hit) self.sigs[name] = sig; else self.remember(name, data, body.length, sig);
    cb(null, true);
  });
};
Store.prototype.remove = function (name, cb) {
  var self = this;
  if (!validName(name)) return cb(failure('INVALID_NAME', 'Invalid library file.'));
  self.forget(name);
  delete self.sigs[name];
  fs.unlink(path.join(self.root, name), function (e) { cb(e && e.code !== 'ENOENT' ? e : null); });
};
Store.prototype.forget = function (name) {
  if (this.memo[name]) { this.memoBytes -= this.memo[name].bytes; delete this.memo[name]; }
};
Store.prototype.forgetAll = function () { this.memo = {}; this.memoBytes = 0; this.sigs = {}; };
Store.prototype.stats = function () { return { memoBytes: this.memoBytes, memoFiles: Object.keys(this.memo).length, reads: this.reads, writes: this.writes }; };

/* Work that reads many files (an import, a list of every file) makes a lot of short-lived garbage, and
   V8 lets its heap grow to about twice what is alive before collecting it.  On a TV that headroom is
   what gets the app killed, so such work asks for a collection every RELIEVE_EVERY files.  Uses V8's
   gc where the Node has the v8 module (webOS 5 and later); a no-op on Node 0.12. */
var RELIEVE_EVERY = 48, collect = null, relieved = 0;
try { require('v8').setFlagsFromString('--expose_gc'); collect = require('vm').runInNewContext('gc'); if (typeof collect !== 'function') collect = null; } catch (e) { collect = null; }
Store.prototype.relieve = function (force) {
  this.passed = (this.passed || 0) + 1;
  if (!collect || (!force && this.passed % RELIEVE_EVERY)) return;
  var now = Date.now();
  if (now - relieved < 250) return;
  relieved = now;
  try { collect(); } catch (e) { collect = null; }
};

Store.atomic = atomic;
Store.validName = validName;
module.exports = Store;
