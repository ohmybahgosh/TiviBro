/* Movies saved before the TV-show library (kv media:lib) into the catalogue, once.
   The old list is copied to a snapshot first and read from the copy in pages of 256, so the app can
   keep writing its list meanwhile.  Until a migration succeeds the snapshot is copied again on each
   try, so a retry never migrates an older list.  Files already in the catalogue win on the same id.
   App credentials are never part of these records.  ES5 / Node 0.12. */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto'), Reader = require('./media-legacy-reader'), M = require('./media-catalog');
var SNAPSHOT = 'legacy-movies.snapshot.json';
function snapshot(file, destination, cb) {
  var temporary = destination + '.' + crypto.randomBytes(8).toString('hex') + '.tmp', done = false, input = fs.createReadStream(file), output = fs.createWriteStream(temporary, { flags: 'wx', mode: 384 });
  function fail(error) { if (done) return; done = true; input.destroy(); output.destroy(); fs.unlink(temporary, function () { cb(error); }); }
  input.on('error', fail); output.on('error', fail);
  output.on('finish', function () { if (done) return; fs.rename(temporary, destination, function (renameError) { if (renameError) return fail(renameError); done = true; cb(null); }); });
  input.pipe(output);
}
function migrate(c, q, cb) {
  c.serial(function (done) {
    if (c.index.legacyMigrated) return done(null, { migrated: true, revision: c.revision });
    var legacy;
    try { legacy = require('./kv').fileOf('media:lib'); } catch (e) { return done(e); }
    fs.stat(legacy, function (error) {
      if (error && error.code === 'ENOENT') return done(null, { migrated: false, revision: c.revision });
      if (error) return done(error);
      var copyAt = path.join(c.root, SNAPSHOT);
      snapshot(legacy, copyAt, function (snapshotError) {
        if (snapshotError) return done(snapshotError);
        c.context(function (e, ctx) {
          if (e) return done(e);
          var reader = new Reader(copyAt), bySource = {}, seen = {}, count = 0;
          var stop = function (err) { reader.close(); done(err); };
          (function nextPage() {
            reader.next(function (readError, rows) {
              if (readError) return stop(readError);
              if (!rows) return publish();
              for (var i = 0; i < rows.length; i++) {
                var m = rows[i];
                if (typeof m.id !== 'string' || typeof m.src !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.src)) return stop(M.failure('Legacy media identity is invalid.  The original snapshot is kept.', 'INVALID_LEGACY'));
                var handle = M.fileHandle(m.id);
                if (seen[handle] || ctx.handles[handle]) continue;
                seen[handle] = true;
                var file = { id: m.id, handle: handle, sourceId: m.src, kind: 'movie', file: m.file || m.title, title: m.title || m.file, year: m.year || '', size: m.size || 0, ext: m.ext || '', info: m.info || [], ancestors: [], addedAt: m.addedAt || 0, availability: 'available', classification: { kind: 'movie', title: m.title, review: [] } };
                if (m.path) file.path = m.path;
                if (m.url) file.url = m.url;
                if (m.metadata) {
                  file.metadata = M.clone(m.metadata); file.metadata.legacyId = file.metadata.id;
                  if (/^tmdb:[0-9]+$/.test(file.metadata.id || '')) file.metadata.id = file.metadata.id.replace('tmdb:', 'tmdb:movie:');
                  file.metadata.matchOrigin = 'legacyUnknown';
                }
                (bySource[m.src] = bySource[m.src] || []).push(file); count++;
              }
              nextPage();
            });
          })();
          function publish() {
            reader.close();
            M.series(Object.keys(bySource).sort(), function (sourceId, next) {
              var name = M.headName(sourceId);
              c.readShard(name, function (readError, shard) {
                if (readError) return next(readError);
                bySource[sourceId].forEach(function (f) { shard.files.push(f); ctx.handles[f.handle] = name; });
                ctx.dirtyHandles = true; delete bySource[sourceId];
                c.writeShard(ctx, name, shard, next);
              });
            }, function (writeError) {
              if (writeError) return done(writeError);
              ctx.index.legacyMigrated = true; ctx.index.legacyFileCount = count;
              c.commit(ctx, function (commitError, revision) { done(commitError, { migrated: !commitError, revision: revision, count: count }); });
            });
          }
        });
      });
    });
  }, cb);
}
module.exports = { migrate: migrate };
