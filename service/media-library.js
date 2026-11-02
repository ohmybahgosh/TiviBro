/* Durable v2 library pages.  Immutable pages become visible only after an atomic manifest commit.
   This storage primitive does not migrate legacy data or expose routes until those adapters exist.
   ES5 callbacks for Node 0.12.  Callers submit bounded batches; queries read one page at a time. */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var FAMILIES = ['files', 'shows', 'episodes', 'memberships', 'overrides', 'progress', 'metadata'];
function Library(root) { this.root = root; this.manifest = null; this.busy = false; }
function failure(code, message) { var e = new Error(message); e.code = code; return e; }
function valid(m) { return m && m.schema === 2 && typeof m.revision === 'number' && m.pages && typeof m.pages === 'object'; }
Library.prototype.open = function (cb) {
  var self = this;
  fs.mkdir(self.root, function (e) {
    if (e && e.code !== 'EEXIST') return cb(e);
    function load(name, done) {
      fs.readFile(path.join(self.root, name), 'utf8', function (err, body) {
        var m;
        if (err) return done(err);
        try { m = JSON.parse(body); } catch (ex) { return done(ex); }
        if (!valid(m)) return done(failure('CORRUPT_LIBRARY', 'Invalid library manifest.'));
        var pages = [], family;
        for (family in m.pages) {
          if (FAMILIES.indexOf(family) < 0 || !Array.isArray(m.pages[family])) return done(failure('CORRUPT_LIBRARY', 'Invalid page family.'));
          pages = pages.concat(m.pages[family]);
        }
        var at = 0;
        function next(err2) {
          if (err2) return done(err2);
          if (at === pages.length) return done(null, m);
          self.readPage(pages[at++], function (err3) { next(err3); });
        }
        next();
      });
    }
    load('manifest.json', function (err, m) {
      if (!err) { self.manifest = m; return cb(null, self); }
      load('previous.json', function (oldErr, old) {
        if (!oldErr) { self.manifest = old; return cb(null, self); }
        // Only genuinely fresh storage may become an empty library.
        if (err.code !== 'ENOENT' || oldErr.code !== 'ENOENT') return cb(failure('CORRUPT_LIBRARY', 'No valid library generation could be recovered.'));
        self.manifest = { schema: 2, revision: 0, pages: {} }; cb(null, self);
      });
    });
  });
};
Library.prototype.readPage = function (descriptor, cb) {
  if (!descriptor || !/^[a-f0-9]{32}\.json$/.test(descriptor.name) || descriptor.count < 0 || descriptor.count > 256) return cb(failure('CORRUPT_LIBRARY', 'Invalid page descriptor.'));
  fs.readFile(path.join(this.root, descriptor.name), function (e, data) {
    if (e) return cb(e);
    if (data.length > 1048576 || crypto.createHash('sha256').update(data).digest('hex') !== descriptor.hash) return cb(failure('CORRUPT_LIBRARY', 'Invalid library page.'));
    var rows;
    try { rows = JSON.parse(data.toString('utf8')); } catch (err) { return cb(err); }
    if (!Array.isArray(rows) || rows.length !== descriptor.count) return cb(failure('CORRUPT_LIBRARY', 'Invalid page row count.'));
    cb(null, rows);
  });
};
function atomic(root, name, body, cb) {
  var temporary = path.join(root, crypto.randomBytes(16).toString('hex') + '.tmp');
  fs.open(temporary, 'wx', function (e, fd) {
    if (e) return cb(e);
    var data = new Buffer(body, 'utf8'), offset = 0;
    function finish(err) {
      fs.close(fd, function (closeErr) {
        if (err || closeErr) return fs.unlink(temporary, function () { cb(err || closeErr); });
        fs.rename(temporary, path.join(root, name), function (renameErr) {
          if (renameErr) return fs.unlink(temporary, function () { cb(renameErr); });
          cb(null);
        });
      });
    }
    function write() {
      fs.write(fd, data, offset, data.length - offset, offset, function (err, written) {
        if (err) return finish(err);
        if (!written) return finish(failure('WRITE_FAILED', 'Library write made no progress.'));
        offset += written;
        if (offset < data.length) return write();
        fs.fsync(fd, finish);
      });
    }
    write();
  });
}
// Append immutable pages to a family; replacement/overlay/index layers build on this primitive.
Library.prototype.append = function (family, rows, expectedRevision, cb) {
  var self = this;
  if (!self.manifest) return cb(failure('NOT_OPEN', 'Open the library first.'));
  if (self.busy || self.manifest.revision !== expectedRevision) return cb(failure('CONFLICT', 'The library changed.'));
  if (FAMILIES.indexOf(family) < 0 || !Array.isArray(rows) || !rows.length || rows.length > 256) return cb(failure('INVALID_BATCH', 'Use a supported family and 1 to 256 rows.'));
  var body;
  try { body = JSON.stringify(rows); } catch (e) { return cb(e); }
  if (Buffer.byteLength(body, 'utf8') > 1048576) return cb(failure('INVALID_BATCH', 'Library page is too large.'));
  var next = JSON.parse(JSON.stringify(self.manifest)), name = crypto.randomBytes(16).toString('hex') + '.json';
  var descriptor = { name: name, count: rows.length, hash: crypto.createHash('sha256').update(body, 'utf8').digest('hex') };
  if (!next.pages[family]) next.pages[family] = [];
  next.pages[family].push(descriptor); next.revision++;
  self.busy = true;
  function done(err) { self.busy = false; if (!err) self.manifest = next; cb(err, err ? null : next.revision); }
  atomic(self.root, name, body, function (err) {
    if (err) return done(err);
    atomic(self.root, 'previous.json', JSON.stringify(self.manifest), function (oldErr) {
      if (oldErr) return done(oldErr);
      atomic(self.root, 'manifest.json', JSON.stringify(next), done);
    });
  });
};
Library.prototype.query = function (family, options, cb) {
  var self = this, opts = options || {}, snapshot = self.manifest;
  if (!snapshot) return cb(failure('NOT_OPEN', 'Open the library first.'));
  if (FAMILIES.indexOf(family) < 0) return cb(failure('INVALID_QUERY', 'Unknown library family.'));
  var revision = snapshot.revision, cursor = opts.cursor || { page: 0, row: 0, revision: revision, family: family };
  if (cursor.revision !== revision || cursor.family !== family) return cb(failure('STALE_CURSOR', 'Reload this list.'));
  if (cursor.page < 0 || cursor.row < 0 || Math.floor(cursor.page) !== cursor.page || Math.floor(cursor.row) !== cursor.row) return cb(failure('INVALID_QUERY', 'Invalid cursor.'));
  var pages = snapshot.pages[family] || [], limit = Math.max(1, Math.min(200, Math.floor(+opts.limit || 60))), output = [], page = cursor.page, row = cursor.row;
  function next() {
    if (page >= pages.length) return cb(null, { items: output, nextCursor: null, revision: revision });
    self.readPage(pages[page], function (err, rows) {
      if (err) return cb(err);
      while (row < rows.length && output.length < limit) output.push(rows[row++]);
      if (row >= rows.length) { page++; row = 0; }
      if (output.length === limit) return cb(null, { items: output, revision: revision, nextCursor: page < pages.length ? { page: page, row: row, revision: revision, family: family } : null });
      next();
    });
  }
  next();
};
module.exports = Library;
