/* A source scan into the catalogue.  The scan's own list is the only large thing in memory: the
   source's existing files are read one shard at a time, once, as each shard is rewritten.
   The scan list is never changed, so a failed import can be retried with the same scan.
   Existing records keep the viewer's overlays (corrections, matches, favourites, ranges, first-seen
   time); a full scan marks files it no longer found as missing (a partial or empty one never does).
   ES5 / Node 0.12. */
'use strict';
var M = require('./media-catalog'), Corrections = require('./media-corrections');
var SCAN_FIELDS = ['file', 'title', 'year', 'size', 'ext', 'info', 'path', 'url', 'etag', 'modified', 'ancestors', 'server'];
var OWN = { id: 1, handle: 1, sourceId: 1, kind: 1, classification: 1, override: 1, showOverride: 1, groupKey: 1, showId: 1, episodeIds: 1, availability: 1, addedAt: 1 };
SCAN_FIELDS.forEach(function (k) { OWN[k] = 1; });

function compactEvidence(c) {
  if (!c || !c.evidence || (c.review || []).length) return c;
  var out = M.copy(c);
  out.evidence = c.evidence.map(function (e) { return { origin: e.origin }; });
  return out;
}
function run(c, sourceId, scan, cb) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sourceId || '') || !scan || !Array.isArray(scan.files)) return cb(M.failure('Invalid source scan.', 'INVALID_SCAN'));
  c.serial(function (done) {
    if (scan.expectedRevision != null && scan.expectedRevision !== c.revision) return done(M.failure('The library changed.  Refresh this item.', 'CONFLICT'));
    c.context(function (e, ctx) {
      if (e) return done(e);
      var source = ctx.index.sources[sourceId];
      if (source && source.active === false) return done(M.failure('This source was removed.', 'INVALID_SCAN'));
      if (scan.contentMode && source && source.contentMode && source.contentMode !== scan.contentMode) return done(M.failure('Source settings changed.  Rescan using the new settings.', 'STALE_SCOPE'));
      importInto(c, ctx, sourceId, scan, done);
    });
  }, cb);
}
/* One scanned file is one small object for the whole import: it is also the change handed to apply()
   (id, from, to, make), so nothing else is kept per file. */
function Entry(obs, id, job) { this.obs = obs; this.id = id; this.job = job; this.from = null; this.to = null; this.oldId = null; this.showOverride = null; this.override = null; this.cls = null; this.kind = null; this.key = null; }
Entry.prototype.make = function (old) { return compose(this, old); };

/* Where each scanned file is now comes from the handle map, so the existing files are read once, when
   they are rewritten.  Only files with a correction or a pinned show (flagged in the map, rare) are
   read before that, because their correction decides where they go. */
function importInto(c, ctx, sourceId, scan, done) {
  var job = { sourceId: sourceId, now: Date.now() }, input = {}, entries = [], head = M.headName(sourceId), flaggedShards = {};
  scan.files.forEach(function (f) {
    if (!f || typeof f.id !== 'string') return;
    var id = scan.idsAreFull ? f.id : sourceId + '|' + f.id;
    if (input[id]) return;
    var en = input[id] = new Entry(f, id, job), h = M.fileHandle(id);
    entries.push(en);
    if (!ctx.handles[h] && ctx.aliases[h]) { var oldId = ctx.aliases[h], oh = M.fileHandle(oldId); if (ctx.handles[oh] && !input[oldId]) { en.oldId = oldId; input[oldId] = en; h = oh; } }
    en.from = ctx.handles[h] || null;
    if (en.from && ctx.flagged[h]) (flaggedShards[en.from] = flaggedShards[en.from] || {})[en.oldId || id] = en;
  });
  var count = entries.length;
  c.readShard(head, function (e, headShard) {
    if (e) return done(e);
    var rules = (headShard.rules || []).slice();
    M.series(Object.keys(flaggedShards).sort(), function (name, next) {
      c.readShard(name, function (err, shard) {
        if (err) return next(err);
        shard.files.forEach(function (r) { var en = flaggedShards[name][r.id]; if (en) { en.override = r.override || null; en.showOverride = r.showOverride || null; } });
        next();
      }, true);
    }, function (err) {
      if (err) return done(err);
      plan(c, ctx, scan, job, input, entries, rules, count, done);
    });
  });
}
function plan(c, ctx, scan, job, input, entries, rules, count, done) {
  var persistent = {}, cohorts = {}, scratch = { sourceId: job.sourceId }, changes = [];
  function probe(en) {
    var f = en.obs;
    scratch.id = en.oldId || en.id; scratch.file = f.file; scratch.ancestors = f.ancestors; scratch.server = f.server; scratch.classification = en.cls; scratch.kind = en.kind; scratch.showOverride = en.showOverride;
    return scratch;
  }
  entries.forEach(function (en) {
    var f = en.obs;
    if (scan.edits && scan.edits[en.id]) en.override = scan.edits[en.id].override || null;
    en.cls = f.classification; en.kind = f.kind;
    if (en.override || rules.length) {
      var p = probe(en); if (en.override) p.override = en.override;
      en.cls = Corrections.classify(p, rules); en.kind = en.cls.kind; delete p.override;
    }
    if (M.eligible(probe(en))) M.addAnchor(ctx, M.group(scratch));
  });
  // A show keeps its id when all of its files (as found by this scan) now group under one new key:
  // a renamed folder keeps its watch history and match.
  entries.forEach(function (en) {
    en.key = M.eligible(probe(en)) ? M.resolveKey(ctx, M.group(scratch)) : null;
    if (!en.key || en.showOverride || !M.isShowShard(en.from)) return;
    var cohort = cohorts[en.from] || (cohorts[en.from] = { keys: {}, n: 0 });
    if (!cohort.keys[en.key]) { cohort.keys[en.key] = true; cohort.n++; }
  });
  var keyMap = {};
  Object.keys(ctx.shows).forEach(function (sid) { (ctx.shows[sid].orphaned ? [] : ctx.shows[sid].keys || []).forEach(function (k) { if (!keyMap[k]) keyMap[k] = sid; }); });
  Object.keys(cohorts).sort().forEach(function (sid) {
    if (cohorts[sid].n !== 1) return;
    var key = Object.keys(cohorts[sid].keys)[0];
    if (!persistent[key] && (!keyMap[key] || keyMap[key] === sid)) persistent[key] = sid;
  });
  var shape = { persistent: persistent, scanSource: job.sourceId, changes: changes, passing: true };
  entries.forEach(function (en) {
    en.to = M.targetOf(ctx, probe(en), shape);
    if (en.oldId) en.id = en.oldId;
    changes.push(en);
  });
  // A complete scan that found nothing proves nothing: only a scan that found files marks others missing.
  if (!scan.partial && count) {
    shape.extra = [M.headName(job.sourceId)].concat(Object.keys(ctx.shows).filter(function (sid) { return (ctx.shows[sid].sourceIds || []).indexOf(job.sourceId) >= 0; }));
    shape.untouched = function (name, f) {
      if (f.sourceId !== job.sourceId || input[f.id] || f.availability === 'missing') return f;
      var r = M.copy(f); r.availability = 'missing'; return r;
    };
  }
  entries = null;
  c.apply(ctx, shape, function (err) {
    if (err) return done(err);
    var shows = Object.keys(ctx.shows).filter(function (sid) { var s = ctx.shows[sid]; return !s.orphaned && (s.sourceIds || []).indexOf(job.sourceId) >= 0; }).length;
    c.commit(ctx, function (e, revision) { done(e, e ? null : { revision: revision, files: count, shows: shows }); });
  });
}
/* The new record of one scanned file: what the scan saw, plus what the viewer kept on the old one.
   Fields come in a fixed order, so an unchanged file serialises the same and its shard is not
   written again. */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) { if (!Array.isArray(b) || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false; return true; }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) if (ka[j] !== kb[j] || !same(a[ka[j]], b[ka[j]])) return false;
  return true;
}
/* A file the scan saw exactly as before keeps its record object (no new one per file on a rescan). */
function unchanged(en, old) {
  var f = en.obs;
  if (!old || old.availability !== 'available' || old.kind !== en.kind || (old.groupKey || null) !== (en.key || null) || !same(old.override || null, en.override || null)) return false;
  for (var i = 0; i < SCAN_FIELDS.length; i++) { var k = SCAN_FIELDS[i]; if (!same(f[k], old[k])) return false; }
  return same(compactEvidence(en.cls), old.classification);
}
function compose(en, old) {
  if (unchanged(en, old)) return old;
  var f = en.obs, out = {};
  out.id = old ? old.id : en.id; out.handle = old && old.handle || M.fileHandle(out.id); out.sourceId = en.job.sourceId; out.kind = en.kind;
  for (var i = 0; i < SCAN_FIELDS.length; i++) if (f[SCAN_FIELDS[i]] !== undefined) out[SCAN_FIELDS[i]] = f[SCAN_FIELDS[i]];
  out.classification = compactEvidence(en.cls);
  if (en.override) out.override = en.override;
  out.showOverride = old && old.showOverride || null;
  out.groupKey = en.key || null;
  out.showId = old ? old.showId || null : null; out.episodeIds = old && old.episodeIds || [];
  out.availability = 'available'; out.addedAt = old && old.addedAt || en.job.now;
  if (old) Object.keys(old).forEach(function (k) { if (!OWN[k] && k.charAt(0) !== '_') out[k] = old[k]; });
  if (old && old.kind && old.kind !== out.kind && out.metadata) { out.legacyMetadata = out.metadata; out.metadata = null; }
  if (old && ((old.size && out.size && old.size !== out.size) || (old.etag && out.etag && old.etag !== out.etag) || (old.modified && out.modified && old.modified !== out.modified))) out.boundaries = null;
  return out;
}
module.exports = { run: run };
