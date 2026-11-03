/* Show merge and split, episode orders, and relinking a missing file.  History follows the physical
   files; nothing guesses a rename from equal names or sizes.  Each operation reads only the shows and
   files it names (media-catalog.js apply).  ES5 / Node 0.12. */
'use strict';
var M = require('./media-catalog');
var clone = M.clone, copy = M.copy;
function err(message, code) { var e = new Error(message); e.code = code || 'INVALID_MAPPING'; return e; }
function finish(c, ctx, done, extra) {
  c.commit(ctx, function (e, revision) { var out = extra || {}; out.revision = revision; done(e, e ? null : out); });
}
function run(c, q, cb) {
  c.serial(function (done) {
    if (q.expectedRevision !== c.revision) return done(err('The library changed.  Reload before changing grouping.', 'CONFLICT'));
    c.context(function (e, ctx) {
      if (e) return done(e);
      var show = ctx.shows[String(q.handle)];
      if (show && show.orphaned) show = null;
      if (q.operation === 'mergeShows') return merge(c, ctx, q, show, done);
      if (q.operation === 'unmergeShows') return unmerge(c, ctx, q, show, done);
      if (q.operation === 'setEpisodeGroup' || q.operation === 'setOrder') return order(c, ctx, q, show, done);
      if (q.operation === 'relinkFile') return relink(c, ctx, q, done);
      done(err('Unknown grouping operation.'));
    });
  }, cb);
}
function merge(c, ctx, q, show, done) {
  var target = ctx.shows[String(q.target)];
  if (target && target.orphaned) target = null;
  if (!show || !target || show.id === target.id) return done(err('Choose two different shows.'));
  if (show.order !== target.order) return done(err('Choose compatible episode orders before merging.'));
  c.readShard(show.id, function (e, from) {
    if (e) return done(e);
    var members = from.files.slice();
    if (q.preview) return done(null, { revision: c.revision, count: members.length, from: show.title, to: target.title });
    var history = from.episodes.filter(function (ep) { return !ep.orphaned; }).map(clone), operationId = 'merge_' + require('crypto').randomBytes(16).toString('hex');
    var operation = { type: 'showMerge', id: operationId, source: clone(show), episodeHistory: history, revision: c.revision + 1, target: target.id, files: members.map(function (f) { return { id: f.id, before: f.showOverride || null }; }), at: Date.now() };
    var changes = members.map(function (f) {
      var next = copy(f); next.showOverride = target.id;
      return { id: f.id, from: show.id, to: target.id, make: function () { return next; } };
    });
    c.apply(ctx, { changes: changes, prepare: function (name, shard) {
      if (name !== target.id) return;
      // Watch history of the merged show lands on the same episodes of the target.
      var byId = {};
      shard.episodes.forEach(function (ep) { byId[ep.id] = ep; });
      history.forEach(function (ep) {
        var canonical = M.epId(target.id, ep.order, M.episodeCoordinate(ep)), existing = byId[canonical];
        if (!existing) { existing = clone(ep); existing.id = canonical; existing.showId = target.id; existing.fileIds = []; shard.episodes.push(existing); byId[canonical] = existing; }
        else if ((ep.watchRevision || 0) > (existing.watchRevision || 0)) { existing.watchState = ep.watchState; existing.watchRevision = ep.watchRevision; existing.watchOrigin = ep.watchOrigin; existing.completedAt = ep.completedAt; }
      });
      shard.merges.push(operation);
    } }, function (applyError) {
      if (applyError) return done(applyError);
      target.favourite = !!(target.favourite || show.favourite);
      target.mergedFrom = (target.mergedFrom || []).concat([{ id: show.id, title: show.title, operation: operationId }]);
      ctx.dirtyShows = true;
      finish(c, ctx, done);
    });
  });
}
function unmerge(c, ctx, q, show, done) {
  if (!show) return done(err('This merge is not available.'));
  c.readShard(show.id, function (e, shard) {
    if (e) return done(e);
    var op = null, byId = {};
    shard.merges.some(function (m) { if (m.id === q.mergeHandle) { op = m; return true; } return false; });
    if (!op) return done(err('This merge is not available.'));
    shard.files.forEach(function (f) { byId[f.id] = f; });
    if (op.files.some(function (p) { return !byId[p.id] || byId[p.id].showOverride !== show.id; })) return done(err('Some files were regrouped again.  Review them before splitting.', 'CONFLICT'));
    // Manual watch changes made on the merged show after the merge go back with the episodes.
    var later = {};
    shard.episodes.forEach(function (ep) { if (ep.watchOrigin === 'manual' && (ep.watchRevision || 0) > op.revision) later[M.episodeCoordinate(ep)] = M.watchFields(ep); });
    var source = op.source, plan = { changes: [], forceShow: {} };
    if (!ctx.shows[source.id]) ctx.shows[source.id] = clone(source);
    op.files.forEach(function (p) {
      var next = copy(byId[p.id]);
      if (p.before) next.showOverride = p.before; else { delete next.showOverride; plan.forceShow[p.id] = source.id; }
      plan.changes.push({ id: p.id, from: show.id, to: M.targetOf(ctx, next, plan), make: function () { return next; } });
    });
    ctx.dirtyShows = true;
    plan.prepare = function (name, target) {
      if (name === show.id) { target.merges = target.merges.filter(function (m) { return m.id !== op.id; }); return; }
      if (name !== source.id) return;
      var have = {};
      target.episodes.forEach(function (ep, i) { have[ep.id] = i; });
      (op.episodeHistory || []).forEach(function (original) {
        var restored = clone(original), newer = later[M.episodeCoordinate(original)];
        if (newer) Object.keys(newer).forEach(function (k) { if (newer[k] !== undefined) restored[k] = newer[k]; });
        restored.fileIds = [];
        if (have[restored.id] != null) target.episodes[have[restored.id]] = restored; else target.episodes.push(restored);
      });
    };
    plan.extra = [source.id];
    c.apply(ctx, plan, function (applyError) {
      if (applyError) return done(applyError);
      show.mergedFrom = (show.mergedFrom || []).filter(function (m) { return m.operation !== op.id; });
      ctx.dirtyShows = true;
      finish(c, ctx, done);
    });
  });
}
function order(c, ctx, q, show, done) {
  if (q.operation === 'setEpisodeGroup' && (!show || !show.metadata || !q.group || !Array.isArray(q.group.groups) || typeof q.group.id !== 'string')) return done(err('Match the show and choose a valid episode group.'));
  if (q.operation === 'setOrder' && (!show || ['aired', 'date', 'absolute', 'custom', 'group'].indexOf(q.order) < 0)) return done(err('Choose a valid show order.'));
  if (q.operation === 'setOrder' && (!Array.isArray(q.mapping) || q.mapping.length > 10000)) return done(err('Supply a valid episode mapping.'));
  c.readShard(show.id, function (e, shard) {
    if (e) return done(e);
    var owned = shard.episodes.filter(function (ep) { return !ep.orphaned; }), byId = {};
    owned.forEach(function (ep) { byId[ep.id] = ep; });
    if (q.operation === 'setEpisodeGroup') {
      var ordered = [], coordinateMap = {}, dateMap = {}, positions = {}, updates = [];
      q.group.groups.slice(0, 500).sort(function (a, b) { return a.order - b.order; }).forEach(function (bucket) {
        if (!bucket || !Array.isArray(bucket.episodes)) return;
        bucket.episodes.slice(0, 10000).sort(function (a, b) { return a.order - b.order; }).forEach(function (remote) {
          if (!remote || ordered.length >= 20000) return;
          var position = ordered.length, key = remote.season_number + ':' + remote.episode_number;
          ordered.push(remote);
          coordinateMap[key] = coordinateMap[key] != null ? -1 : position;
          if (remote.air_date) dateMap[remote.air_date] = dateMap[remote.air_date] != null ? -1 : position;
        });
      });
      for (var i = 0; i < owned.length; i++) {
        var local = owned[i], position = null;
        if (local.order === 'aired') position = coordinateMap[local.season + ':' + local.number];
        else if (local.order === 'date') position = dateMap[local.airDate];
        else if (local.order === 'absolute' && q.group.type === 2 && !local.absolutePart) position = local.absoluteNumber - 1;
        if (position == null || position < 0 || position >= ordered.length || positions[position]) return done(err('This group does not uniquely map every owned episode.  Correct the unmatched items first.'));
        positions[position] = true; updates.push([local, position]);
      }
      updates.forEach(function (u) { u[0].orderPosition = u[1]; u[0].canonicalSeason = ordered[u[1]].season_number; u[0].canonicalNumber = ordered[u[1]].episode_number; });
      show.displayOrder = 'group'; show.orderMappingOrigin = 'tmdbGroup'; show.episodeGroupId = q.group.id;
    } else {
      var seen = {}, mapped = {};
      for (var j = 0; j < q.mapping.length; j++) {
        var map = q.mapping[j] || {};
        if (!byId[map.episode] || seen[map.episode] || !isFinite(map.position) || map.position < 0 || Math.floor(map.position) !== map.position) return done(err('The mapping contains an unknown episode or duplicate.'));
        if (mapped[map.position]) return done(err('Two episodes have the same order position.'));
        seen[map.episode] = true; mapped[map.position] = true;
      }
      if (q.mapping.length !== owned.length) return done(err('Map every owned episode before saving this order.'));
      q.mapping.forEach(function (m) { byId[m.episode].orderPosition = m.position; });
      show.displayOrder = q.order; show.orderMappingOrigin = q.groupId ? 'tmdbGroup' : 'user';
      if (q.groupId) show.episodeGroupId = q.groupId;
    }
    shard.episodes.sort(M.sortEpisodes);
    ctx.dirtyShows = true;
    c.writeShard(ctx, show.id, shard, function (writeError) { if (writeError) return done(writeError); finish(c, ctx, done); });
  });
}
function relink(c, ctx, q, done) {
  c.findFile(ctx, q.handle, function (e, missing, missingAt) {
    if (e) return done(e);
    c.findFile(ctx, q.target, function (e2, replacement, replacementAt) {
      if (e2) return done(e2);
      if (!missing || !replacement || missing.id === replacement.id || missing.availability !== 'missing' || replacement.availability !== 'available') return done(err('Select a missing file and its available replacement.'));
      c.hasProgress(replacement.id, function (e3, progress) {
        if (e3) return done(e3);
        if (progress && !q.replaceHistory && !q.preview) return done(err('The replacement already has progress.  Choose which history to keep.', 'CONFLICT'));
        if (q.preview) return done(null, { revision: c.revision, from: missing.file, to: replacement.file, historyConflict: !!progress });
        var next = copy(missing);
        ['path', 'url', 'file', 'size', 'ext', 'info', 'ancestors', 'sourceId', 'etag', 'modified'].forEach(function (k) { if (replacement[k] !== undefined) next[k] = replacement[k]; else delete next[k]; });
        if (missing.showId) next.showOverride = missing.showId;
        next.availability = 'available'; next.locatorAliases = (missing.locatorAliases || []).concat([replacement.id]);
        c.apply(ctx, { changes: [
          { id: replacement.id, from: replacementAt, to: replacementAt, make: function () { return null; } },
          { id: missing.id, from: missingAt, to: M.targetOf(ctx, next, null), make: function () { return next; } }
        ] }, function (applyError) { if (applyError) return done(applyError); finish(c, ctx, done); });
      });
    });
  });
}
module.exports = { run: run };
