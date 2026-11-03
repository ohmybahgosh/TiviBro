/* Small My media edits: watched, favourite, preferred version, matches, season details, episode
   ranges, and correcting one file.  Each reads and writes only the show or source file that holds the
   item (media-catalog.js), never the whole library.  ES5 / Node 0.12. */
'use strict';
var M = require('./media-catalog');
var failure = M.failure;
function conflict() { return failure('The library changed.  Refresh this item.', 'CONFLICT'); }
function invalid(message) { return failure(message, 'INVALID_EDIT'); }

/* The record behind a handle: cb(error, record, family, shard, shardName). */
function find(c, ctx, handle, cb) {
  handle = String(handle || '');
  if (/^show_[a-f0-9]{32}$/.test(handle)) { var show = ctx.shows[handle]; return cb(null, show && !show.orphaned ? show : null, 'shows', null, null); }
  var sid = M.showOfEpisode(handle);
  if (sid) {
    if (!ctx.shows[sid]) return cb(null, null);
    return c.readShard(sid, function (e, shard) {
      if (e) return cb(e);
      var found = null;
      shard.episodes.some(function (ep) { if (ep.id === handle) { found = ep; return true; } return false; });
      cb(null, found, 'episodes', shard, sid);
    });
  }
  c.findFile(ctx, handle, function (e, file, name, shard) { cb(e, file, 'files', shard, name); });
}
function run(c, q, cb) {
  c.serial(function (done) {
    if (q.expectedRevision !== c.revision) return done(conflict());
    c.context(function (e, ctx) {
      if (e) return done(e);
      find(c, ctx, q.handle, function (err, target, family, shard, name) {
        if (err || !target) return done(err || failure('This item is no longer in the library.', 'NOT_FOUND'));
        var revision = c.revision + 1, changed = false, op = q.operation;
        var publish = function (writeError) {
          if (writeError) return done(writeError);
          c.commit(ctx, function (commitError, newRevision) { done(commitError, { revision: newRevision }); });
        };
        var watch = function (ep, watched) {
          if (q.playback && ep.watchOrigin === 'manual' && (ep.watchRevision || 0) > (q.baseWatchRevision || 0) && (ep.watchManualAt || 0) >= (q.playStartedAt || 0)) return;
          ep.watchState = watched ? 'watched' : 'unwatched'; ep.watchOrigin = q.playback ? 'playback' : 'manual'; ep.watchRevision = revision; ep.completedAt = watched ? Date.now() : null;
          if (!q.playback) ep.watchManualAt = Date.now();
          changed = true;
        };
        if (op === 'setWatched' && family === 'episodes') { watch(target, !!q.watched); changed = true; }
        else if (op === 'setFavourite') { target.favourite = !!q.favourite; changed = true; }
        else if (op === 'markMetadataChecked' && family === 'shows') {
          if (!/^(en|nl|de|fr|es|it)$/.test(q.language || '') || typeof q.startedAt !== 'number' || !isFinite(q.startedAt) || q.startedAt <= 0 || q.startedAt > Date.now()) return done(invalid('Choose a valid metadata check.'));
          target.metadataCheckedAt = q.startedAt; target.metadataCheckLanguage = q.language; target.metadataMissAt = q.missed ? Date.now() : 0; changed = true;
        } else if (op === 'setPreferredVersion' && family === 'episodes') {
          if (!(target.fileIds || []).some(function (id) { return M.fileHandle(id) === q.version; })) return done(invalid('Choose a version belonging to this episode.'));
          target.preferredVersion = q.version; changed = true;
        } else if (op === 'setMetadata') {
          if (q.metadata !== null && (!q.metadata || typeof q.metadata !== 'object' || !/^tmdb:tv:[1-9][0-9]*(?::season:[0-9]+(?::episode:[1-9][0-9]*)?)?$/.test(q.metadata.id || ''))) return done(invalid('Choose a valid metadata match.'));
          target.metadata = q.metadata; changed = true;
        } else if (op === 'completeFile' && family === 'files') {
          var wanted = target.episodeIds || [], found = false;
          (shard.episodes || []).forEach(function (ep) { if (!ep.orphaned && (wanted.indexOf(ep.id) >= 0 || (ep.fileIds || []).indexOf(target.id) >= 0)) { found = true; watch(ep, true); } });
          if (!found) return done(failure('No matching records could be updated.', 'NOT_FOUND'));
          changed = true;
        } else if (op === 'setBoundaries' && family === 'files') {
          if (!Array.isArray(q.ranges) || q.ranges.length > 50) return done(invalid('Choose valid episode ranges.'));
          try { require('./media-chapters').validate(q.ranges, q.durationSec); } catch (rangeError) { rangeError.code = 'INVALID_EDIT'; return done(rangeError); }
          if (q.ranges.some(function (range) { return (target.episodeIds || []).indexOf(range.episode) < 0; })) return done(invalid('Episode does not belong to this file.'));
          target.boundaries = q.ranges.map(function (range) { return { episode: range.episode, startSec: range.startSec, endSec: range.endSec == null ? null : range.endSec, origin: 'user' }; });
          changed = true;
        } else if (op === 'setSeasonMetadata' && family === 'shows') {
          var match = /^tmdb:tv:[0-9]+:season:([0-9]+)$/.exec(q.metadata && q.metadata.id || '');
          if (!match || !target.metadata || q.metadata.id.indexOf(target.metadata.id + ':season:') !== 0 || !Array.isArray(q.metadata.episodes)) return done(invalid('Choose a season belonging to this show.'));
          return c.readShard(target.id, function (readError, showShard) {
            if (readError) return done(readError);
            var remote = {}, value = {};
            q.metadata.episodes.slice(0, 5000).forEach(function (ep) { if (ep && typeof ep === 'object') remote[ep.season + ':' + ep.number] = ep; });
            ['title', 'plot', 'poster', 'releaseDate', 'year'].forEach(function (k) { if (q.metadata[k] !== undefined) value[k] = q.metadata[k]; });
            showShard.seasonMetadata[match[1]] = value;
            showShard.episodes.forEach(function (ep) { var m = remote[ep.season + ':' + ep.number]; if (m) ep.metadata = m; });
            c.writeShard(ctx, target.id, showShard, publish);
          });
        } else return done(invalid('That change is not valid for this item.'));
        if (!changed) return done(failure('No matching records could be updated.', 'NOT_FOUND'));
        if (family === 'shows') { ctx.dirtyShows = true; return publish(null); }
        c.writeShard(ctx, name, shard, publish);
      });
    });
  }, cb);
}
/* Correct one file (or drop its correction): its classification is worked out again with its
   source's folder rules, and it moves to the show it now belongs to. */
function reclassify(c, q, cb) {
  c.serial(function (done) {
    if (q.expectedRevision !== c.revision) return done(conflict());
    c.context(function (e, ctx) {
      if (e) return done(e);
      c.findFile(ctx, q.handle, function (err, file, name) {
        if (err || !file) return done(err || invalid('Choose a file to correct.'));
        var normalized = null;
        if (q.operation === 'classifyFile') {
          normalized = {};
          ['kind', 'showTitle', 'season', 'numbers', 'order', 'airDate', 'absoluteNumber', 'absolutePart', 'title'].forEach(function (k) { if (Object.prototype.hasOwnProperty.call(q.fields || {}, k)) normalized[k] = M.clone(q.fields[k]); });
          var result = require('./media-classify').classify({ basename: file.file, ancestors: file.ancestors, server: file.server }, {}, [normalized]);
          if (result.review.some(function (reason) { return /^invalid/.test(reason); })) return done(invalid('Choose valid episode coordinates.'));
        }
        c.readShard(M.headName(file.sourceId), function (headError, head) {
          if (headError) return done(headError);
          var next = M.copy(file);
          if (normalized) next.override = normalized; else delete next.override;
          next.classification = require('./media-corrections').classify(next, head.rules);
          next.kind = next.classification.kind;
          var to = M.targetOf(ctx, next, null);
          c.apply(ctx, { changes: [{ id: file.id, from: name, to: to, make: function () { return next; } }] }, function (applyError) {
            if (applyError) return done(applyError);
            c.commit(ctx, function (commitError, revision) { done(commitError, { revision: revision, files: 1 }); });
          });
        });
      });
    });
  }, cb);
}
module.exports = { run: run, reclassify: reclassify, find: find };
