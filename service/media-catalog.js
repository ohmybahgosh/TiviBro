/* My media catalogue, helper side: files, shows and episodes, and every change to them.

   Storage is media-library.js (small JSON files, see there).  This file holds the rules:
     - One queue runs every read and change in order (serial).  A job that throws or fails gives
       the queue back and drops what it had in memory, so the next job reads the files again.
     - One revision counts changes to the catalogue.  Lists and edits carry it, so a stale list or
       edit is refused instead of overwriting newer work.  Playback progress is not part of it: it
       is saved on its own (at most once a minute while something plays, and when playback stops),
       so watching never invalidates lists or the web editor's edits.
     - Work is per show: a show's episodes and the files they play from live in that show's own
       file.  A change reads and writes only the shows and sources it touches (apply, below), and a
       list reads one file at a time and keeps only the page it returns.
     - Private locators (paths, links, logins) never leave through project(): only file() hands a
       whole record to media.js, to play it.
   Plain ES5 with callbacks for Node 0.12 (webOS 4). */
'use strict';
var Store = require('./media-library'), crypto = require('crypto');
var INDEX = 'catalog.json', SHOWS = 'shows.json', HANDLES = 'handles.json', PROGRESS = 'progress.json';
var CLEAN = /^(CONFLICT|STALE_CURSOR|STALE_SCOPE|INVALID_EDIT|INVALID_QUERY|INVALID_SCAN|INVALID_MAPPING|NOT_FOUND|TOO_MANY)$/;
var JOB_MS = 10 * 60000, EPISODE_CAP = 20000, PROGRESS_CAP = 1000, PROGRESS_MS = 60000, PROGRESS_IDLE_MS = 25000;

function hash(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 32); }
function failure(message, code) { var e = new Error(message); e.code = code || 'LIBRARY_ERROR'; return e; }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function copy(r) { var out = {}; Object.keys(r || {}).forEach(function (k) { out[k] = r[k]; }); return out; }
function headName(sourceId) { return 'src_' + hash('source|' + sourceId).slice(0, 24); }
function isShowShard(name) { return /^show_[a-f0-9]{32}$/.test(String(name)); }
function isHeadShard(name) { return /^src_[a-f0-9]{24}$/.test(String(name)); }
function epId(sid, order, coordinate) { return 'ep_' + String(sid).slice(5) + '_' + hash(sid + '|' + order + '|' + coordinate).slice(0, 16); }
function showOfEpisode(id) { var m = /^ep_([a-f0-9]{32})_[a-f0-9]{16}$/.exec(String(id)); return m ? 'show_' + m[1] : null; }
function fileHandle(id) { return 'file_' + hash(id); }
function series(list, step, cb) {
  var at = 0;
  (function next(e) {
    if (e) return cb(e);
    if (at >= list.length) return cb(null);
    var item = list[at++];
    setImmediate(function () { step(item, next); });
  })();
}
function freshIndex() { return { schema: 3, revision: 0, sources: {}, commands: {}, counts: {} }; }
function freshShard(name) { return isShowShard(name) ? { id: name, files: [], episodes: [], seasonMetadata: {}, merges: [] } : { id: name, files: [], rules: [] }; }

/* ---------- identity ---------- */
function coords(c) {
  if (c.order === 'date') return [c.airDate];
  if (c.order === 'absolute') return [String(c.absoluteNumber) + (c.absolutePart ? '.' + c.absolutePart : '')];
  return (c.numbers || []).map(function (n) { return String(c.season) + ':' + n; });
}
function episodeCoordinate(ep) { return ep.order === 'date' ? ep.airDate : ep.order === 'absolute' ? String(ep.absoluteNumber) + (ep.absolutePart ? '.' + ep.absolutePart : '') : String(ep.season) + ':' + ep.number; }
// A show folder is stronger evidence than a normalised title; flat files use the parsed title.
function group(file) {
  var c = file.classification || {}, ancestors = file.ancestors || [], anchor = '';
  ancestors.some(function (name, i) { if (String(name).toLowerCase() === String(c.showTitle).toLowerCase()) { anchor = JSON.stringify(ancestors.slice(0, i + 1)); return true; } return false; });
  return file.sourceId + '|' + (anchor || c.showTitle || '').toLowerCase();
}
function eligible(file) { var c = file.classification || {}; return file.kind === 'episode' && !!c.showTitle && !(c.review || []).length; }
function titleKeyOf(key) {
  var at = String(key).indexOf('|[');
  if (at < 0) return key;
  try { var list = JSON.parse(key.slice(at + 1)); return key.slice(0, at) + '|' + String(list[list.length - 1]).toLowerCase(); } catch (e) { return key; }
}
function sortEpisodes(a, b) {
  if (a.showId !== b.showId) return a.showId < b.showId ? -1 : 1;
  if (a.orderPosition != null && b.orderPosition != null && a.orderPosition !== b.orderPosition) return a.orderPosition - b.orderPosition;
  var d = 0;
  if (a.order === 'date') d = String(a.airDate).localeCompare(String(b.airDate));
  else if (a.order === 'absolute') d = (a.absoluteNumber - b.absoluteNumber) || String(a.absolutePart || '').localeCompare(String(b.absolutePart || ''));
  else d = (a.season - b.season) || (a.number - b.number);
  if (d) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ---------- public shapes ---------- */
function project(r) {
  var out = {};
  ['sourceIds','displayOrder','mergedFrom','preferredVersion','orderPosition','watchRevision','watchOrigin','watchManualAt','boundaries','favourite','sourceId','kind','title','season','number','airDate','absoluteNumber','absolutePart','order','watchState','availability','metadata','addedAt','showId'].forEach(function (k) { if (r[k] !== undefined) out[k] = r[k]; });
  out.handle = r.handle || r.id; if (r.episodeIds) out.coveredEpisodes = r.episodeIds.slice();
  if (r.kind === 'episode') out.label = r.airDate || (r.absoluteNumber != null ? String(r.absoluteNumber) + (r.absolutePart ? '.' + r.absolutePart : '') : 'S' + r.season + 'E' + r.number);
  if (r.fileIds) out.versionCount = r.fileIds.length;
  if (r.classification) {
    out.review = (r.classification.review || []).slice(); if (r.availability === 'missing') out.review.push('missingFile');
    out.label = r.file; out.detected = {};
    ['kind','showTitle','season','numbers','order','airDate','absoluteNumber','absolutePart'].forEach(function (k) { if (r.classification[k] !== undefined) out.detected[k] = r.classification[k]; });
  }
  return out;
}
function needsReview(r) { return !!((r.classification && (r.classification.review || []).length) || r.availability === 'missing'); }
function countShard(shard) {
  var out = {}, any = false;
  (shard.files || []).forEach(function (f) {
    var c = out[f.sourceId] || (out[f.sourceId] = [0, 0, 0, 0]); any = true;
    c[0]++; if (needsReview(f)) c[1]++; if (f.kind === 'movie') c[2]++; if (f.kind === 'extra') c[3]++;
  });
  return any ? out : null;
}
function disabledSources(index, kind) {
  var d = {};
  Object.keys(index.sources || {}).forEach(function (id) {
    var s = index.sources[id];
    if (s.active === false || ((kind === 'show' || kind === 'episode') && s.contentMode === 'movies') || (kind === 'movie' && s.contentMode === 'shows')) d[id] = true;
  });
  return d;
}
function sourceOfFileId(id) { return String(id).split('|')[0]; }
function textMatch(r, q) {
  if (!q.q) return true;
  var needle = String(q.q).toLowerCase();
  return String(r.title).toLowerCase().indexOf(needle) >= 0 || String(r.metadata && r.metadata.title || '').toLowerCase().indexOf(needle) >= 0;
}
function metadataPending(r, q) {
  var checked = r.metadataCheckedAt || 0, language = q.language || 'en';
  if (q.metadataSince) return !(checked >= q.metadataSince && r.metadataCheckLanguage === language);
  return !(r.metadataCheckLanguage === language && ((r.metadataMissAt && Date.now() - r.metadataMissAt < 604800000) || (r.metadata && checked && checked >= (r.metadataScanAt || 0) && (r.metadata.requestedLanguage || r.metadata.language) === language)));
}
// The filters every list shares.  kind and disabled sources are checked by the caller.
function matches(r, q) {
  if (q.availableOnly && r.availability !== 'available') return false;
  if (q.favourite && !r.favourite) return false;
  if (q.favourite === false && r.favourite) return false;
  if (q.metadataPending && !metadataPending(r, q)) return false;
  if (q.season != null && r.season !== q.season) return false;
  if (q.bucket && q.bucket !== 'Episodes' && (r.order === 'date' ? String(r.airDate).slice(0, 4) !== q.bucket : String(r.season) !== q.bucket)) return false;
  return textMatch(r, q);
}

/* ---------- the catalogue ---------- */
function Catalog(root, opts) {
  this.root = root;
  this.store = new Store(root, opts);
  this.jobs = [];
  this.working = false;
  this.index = null;
  this.revision = 0;
  this.previews = {};
  this.command = null;
  this.progressStore = new Progress(this, opts);
}
Catalog.prototype.open = function (cb) {
  var self = this;
  self.store.open(function (e) {
    if (e) return cb(e);
    self.store.read(INDEX, freshIndex, function (err, index) {
      if (err) return cb(err);
      if (index.schema !== 3 || typeof index.revision !== 'number' || !index.sources || typeof index.sources !== 'object') return cb(failure('The media library index is not valid.', 'CORRUPT_LIBRARY'));
      if (!index.commands) index.commands = {};
      if (!index.counts) index.counts = {};
      self.index = index; self.revision = index.revision;
      cb(null, self);
    });
  });
};
/* One job at a time.  A job ends exactly once: by its callback, by throwing, or by the watchdog. */
Catalog.prototype.serial = function (run, cb, command) {
  this.jobs.push({ run: run, cb: cb || function () {}, command: command || (cb && cb.command) || null });
  this.pump();
};
Catalog.prototype.pump = function () {
  var self = this;
  if (self.working || !self.jobs.length) return;
  var job = self.jobs.shift(), finished = false, watchdog = null;
  self.working = true; self.command = job.command;
  function finish(e, result) {
    if (finished) return;
    finished = true;
    if (watchdog) clearTimeout(watchdog);
    // A failed job may have changed records in memory that never reached the disk (refusals made
    // before any change, like a stale revision, leave the memory as it is).
    if (e && !CLEAN.test(e.code || '')) self.store.forgetAll();
    self.working = false; self.command = null;
    setImmediate(function () { self.pump(); });
    job.cb(e || null, e ? undefined : result);
  }
  watchdog = setTimeout(function () { finish(failure('The media library took too long.  Try again.', 'TIMEOUT')); }, JOB_MS);
  if (watchdog.unref) watchdog.unref();
  try { job.run(finish); } catch (e) { finish(e); }
};
/* passing: for work that visits many shards once, so they do not crowd the memo. */
Catalog.prototype.readShard = function (name, cb, passing) {
  if (!isShowShard(name) && !isHeadShard(name)) return cb(failure('Invalid library location.', 'CORRUPT_LIBRARY'));
  this.store.read(name + '.json', function () { return freshShard(name); }, function (e, shard) {
    if (e) return cb(e);
    if (!Array.isArray(shard.files)) shard.files = [];
    if (isShowShard(name)) { if (!Array.isArray(shard.episodes)) shard.episodes = []; if (!shard.seasonMetadata) shard.seasonMetadata = {}; if (!Array.isArray(shard.merges)) shard.merges = []; }
    else if (!Array.isArray(shard.rules)) shard.rules = [];
    cb(null, shard);
  }, passing);
};
Catalog.prototype.writeShard = function (ctx, name, shard, cb, passing) {
  var counts = countShard(shard);
  if (counts) ctx.index.counts[name] = counts; else delete ctx.index.counts[name];
  var empty = !shard.files.length && (isShowShard(name) ? !shard.episodes.length && !shard.merges.length : !shard.rules.length);
  if (empty) return this.store.remove(name + '.json', cb);
  this.store.write(name + '.json', shard, function (e) { cb(e); }, passing);
};
/* What one job works on: a copy of the small index, and the show and handle maps (shared, in memory). */
Catalog.prototype.context = function (cb) {
  var self = this, ctx = { index: clone(self.index), shows: null, showsDoc: null, handles: null, handlesDoc: null, dirtyShows: false, dirtyHandles: false, keyMap: null };
  self.store.read(SHOWS, function () { return { shows: {} }; }, function (e, doc) {
    if (e) return cb(e);
    if (!doc.shows || typeof doc.shows !== 'object') doc.shows = {};
    ctx.showsDoc = doc; ctx.shows = doc.shows;
    self.store.read(HANDLES, function () { return { f: {} }; }, function (e2, h) {
      if (e2) return cb(e2);
      if (!h.f || typeof h.f !== 'object') h.f = {};
      if (!h.o || typeof h.o !== 'object') h.o = {};
      if (!h.a || typeof h.a !== 'object') h.a = {};
      if (!h.interned) {
        // One string per shard name, not one per file (the map can hold tens of thousands of files).
        var names = {};
        Object.keys(h.f).forEach(function (k) { var v = h.f[k]; h.f[k] = names[v] || (names[v] = v); });
        Object.defineProperty(h, 'interned', { value: true, enumerable: false });
      }
      ctx.handlesDoc = h; ctx.handles = h.f; ctx.flagged = h.o; ctx.aliases = h.a;
      cb(null, ctx);
    });
  });
};
/* Publish a change: shows and handles first, the index (with the new revision) last. */
Catalog.prototype.commit = function (ctx, cb) {
  var self = this, store = self.store;
  function shows(next) { if (!ctx.dirtyShows) return next(null); store.write(SHOWS, ctx.showsDoc, function (e) { next(e); }); }
  function handles(next) { if (!ctx.dirtyHandles) return next(null); store.write(HANDLES, ctx.handlesDoc, function (e) { next(e); }); }
  shows(function (e) {
    if (e) return cb(e);
    handles(function (e2) {
      if (e2) return cb(e2);
      var next = ctx.index;
      next.revision = self.index.revision + 1;
      var command = self.command;
      if (command) {
        next.commands['c_' + command.key] = { hash: command.hash, revision: next.revision, at: Date.now(), extra: command.extra || null };
        var keys = Object.keys(next.commands).sort(function (a, b) { return next.commands[a].at - next.commands[b].at; });
        while (keys.length > 64) delete next.commands[keys.shift()];
      }
      store.write(INDEX, next, function (e3) {
        if (e3) return cb(e3);
        self.index = next; self.revision = next.revision;
        cb(null, next.revision);
      });
    });
  });
};

/* ---------- where a file belongs ---------- */
function keyMap(ctx) {
  if (ctx.keyMap) return ctx.keyMap;
  var map = {}, anchors = {};
  Object.keys(ctx.shows).forEach(function (sid) {
    var s = ctx.shows[sid];
    if (s.orphaned) return;
    (s.keys || []).forEach(function (k) {
      if (!map[k]) map[k] = sid;
      if (k.indexOf('|[') >= 0) { var t = titleKeyOf(k); if (!anchors[t]) anchors[t] = []; if (anchors[t].indexOf(k) < 0) anchors[t].push(k); }
    });
  });
  ctx.keyMap = map; ctx.anchors = anchors;
  return map;
}
function addAnchor(ctx, key) {
  keyMap(ctx);
  if (key && key.indexOf('|[') >= 0) { var t = titleKeyOf(key); if (!ctx.anchors[t]) ctx.anchors[t] = []; if (ctx.anchors[t].indexOf(key) < 0) ctx.anchors[t].push(key); }
}
// A flat file joins the one show folder of the same title on its source.
function resolveKey(ctx, key) {
  keyMap(ctx);
  if (!key || key.indexOf('|[') >= 0) return key;
  var candidates = ctx.anchors[key] || [];
  return candidates.length === 1 ? candidates[0] : key;
}
/* The shard a record goes to: its source's own file, or a show.  Sets record.groupKey. */
function targetOf(ctx, rec, plan) {
  if (!eligible(rec)) { rec.groupKey = null; return headName(rec.sourceId); }
  var key = resolveKey(ctx, group(rec)); rec.groupKey = key;
  if (rec.showOverride && ctx.shows[rec.showOverride]) return rec.showOverride;
  if (plan && plan.forceShow && plan.forceShow[rec.id]) return plan.forceShow[rec.id];
  if (plan && plan.persistent && plan.persistent[key]) return plan.persistent[key];
  return keyMap(ctx)[key] || 'show_' + hash(key);
}
function watchFields(ep) { return { watchState: ep.watchState, watchRevision: ep.watchRevision, watchOrigin: ep.watchOrigin, completedAt: ep.completedAt, watchManualAt: ep.watchManualAt }; }

/* Episodes of one show, from the files now in its shard.  Episode records are kept by id, so watch
   state, matches and order survive; ones no file covers any more stay as orphaned history. */
function derive(ctx, sid, shard, plan) {
  var now = Date.now(), show = ctx.shows[sid], existing = {}, coordIndex = {}, multi = {}, members = {}, live = 0, sourceIds = [], keys = [], folders = [];
  shard.episodes.forEach(function (ep) {
    existing[ep.id] = ep;
    var normal = epId(sid, ep.order, episodeCoordinate(ep));
    if (normal !== ep.id && !coordIndex[normal]) coordIndex[normal] = ep.id;
    if ((ep.fileIds || []).length > 1) multi[ep.id] = true;
  });
  shard.files.forEach(function (f) {
    var c = f.classification || {}, carry = f._carry;
    delete f._carry;
    if (!eligible(f)) return;
    if (!show) { show = ctx.shows[sid] = { id: sid, kind: 'show', title: c.showTitle, order: c.order, createdAt: now, sourceIds: [], keys: [] }; }
    var previousIds = f.showId === sid ? (f.episodeIds || []) : [];
    f.showId = sid; f.episodeIds = [];
    if (!f.showOverride) { show.title = c.showTitle; if (f.groupKey && keys.indexOf(f.groupKey) < 0) keys.push(f.groupKey); }
    if (sourceIds.indexOf(f.sourceId) < 0) sourceIds.push(f.sourceId);
    if (folders) { var folder = JSON.stringify(f.ancestors || []); if (folders.indexOf(folder) < 0) { if (folders.length >= 32) folders = null; else folders.push(folder); } }
    if (plan && plan.scanSource === f.sourceId) show.metadataScanAt = now;
    coords(c).forEach(function (coordinate, i) {
      var normal = epId(sid, c.order, coordinate), id = coordIndex[normal] || normal, candidate = previousIds[i];
      if (!members[id] && candidate && !multi[candidate] && showOfEpisode(candidate) === sid) { id = candidate; if (id !== normal) coordIndex[normal] = id; }
      var ep = members[id];
      if (!ep) {
        ep = existing[id];
        if (!ep) { ep = existing[id] = { id: id, kind: 'episode', showId: sid, watchState: 'unwatched' }; shard.episodes.push(ep); }
        members[id] = ep;
        ep.showId = sid; ep.season = c.season; ep.number = c.numbers && c.numbers[i] || null; ep.airDate = c.airDate || null;
        ep.absoluteNumber = c.absoluteNumber || null; ep.absolutePart = c.absolutePart || null; ep.order = c.order; ep.title = c.title || f.title;
        ep.fileIds = []; ep.orphaned = false; live++;
      }
      if (ep.fileIds.indexOf(f.id) < 0) ep.fileIds.push(f.id);
      f.episodeIds.push(id);
      var before = carry && carry[i];
      if (before && (before.watchRevision || 0) > (ep.watchRevision || 0)) Object.keys(before).forEach(function (k) { if (before[k] !== undefined) ep[k] = before[k]; });
    });
  });
  shard.episodes.forEach(function (ep) { if (!members[ep.id]) ep.orphaned = true; });
  shard.episodes.sort(sortEpisodes);
  if (show) {
    show.orphaned = !live;
    // keys: how files find this show again; folders: where its files are (a folder correction reads only these shows).
    if (live) { show.sourceIds = sourceIds; show.keys = keys; show.folders = folders; } else { show.keys = []; show.folders = []; }
    ctx.dirtyShows = true; ctx.keyMap = null;
  }
}

/* Apply a set of file changes.  plan.changes: [{ id, from, to, make(oldRecord) -> record or null }]:
   from is the shard the file is in now (null for a new file), to where it goes.  Shards are read one
   at a time and written as soon as they are done; only files that move are kept in between.
   plan.prepare(name, shard) may change a shard first (rules, merged episode history); plan.extra
   names shards to visit without file changes, and plan.untouched(name, file) may replace (or drop,
   with null) a file the plan does not change.  plan.passing: read and write without the memo. */
Catalog.prototype.apply = function (ctx, plan, cb) {
  var self = this, byTo = {}, outgoing = {}, receives = {}, touched = {}, stash = {}, carry = {};
  function touch(name) { if (name) touched[name] = true; }
  plan.changes.forEach(function (c) {
    touch(c.to); touch(c.from);
    (byTo[c.to] = byTo[c.to] || []).push(c);
    if (c.from !== c.to) { receives[c.to] = true; if (c.from) (outgoing[c.from] = outgoing[c.from] || {})[c.id] = true; }
  });
  (plan.extra || []).forEach(touch);
  var names = Object.keys(touched).sort(function (a, b) { return ((receives[b] ? 1 : 0) - (receives[a] ? 1 : 0)) || (a < b ? -1 : a > b ? 1 : 0); });
  // Files that move: keep their old record (and the watch state of their episodes) until they land.
  series(Object.keys(outgoing), function (name, next) {
    self.readShard(name, function (e, shard) {
      if (e) return next(e);
      var out = outgoing[name], eps = {};
      (shard.episodes || []).forEach(function (ep) { eps[ep.id] = ep; });
      shard.files.forEach(function (f) {
        if (!out[f.id] || stash[f.id]) return;
        stash[f.id] = f;
        carry[f.id] = (f.episodeIds || []).map(function (id) { return eps[id] && (eps[id].fileIds || []).length <= 1 ? watchFields(eps[id]) : null; });
      });
      next();
    }, plan.passing);
  }, function (e) {
    if (e) return cb(e);
    series(names, visit, cb);
  });
  function visit(name, next) {
    self.readShard(name, function (e, shard) {
      if (e) return next(e);
      var gone = outgoing[name] || {}, changes = byTo[name] || [], inPlace = {}, kept = [], at = {};
      changes.forEach(function (c) { if (c.from === name) inPlace[c.id] = c; });
      shard.files.forEach(function (f) {
        if (at[f.id] != null) return;                     // the same file twice in one shard
        var c = inPlace[f.id], h = ctx.handles[f.handle];
        if (c) { delete inPlace[f.id]; var r = c.make(f); if (r) { at[r.id] = kept.length; kept.push(r); } else forgetHandle(f, name); return; }
        if (gone[f.id]) { forgetHandle(f, name); return; }
        if (h && h !== name) return;                      // a stale copy: the file lives in another shard
        if (plan.untouched) { f = plan.untouched(name, f); if (!f) return; }
        at[f.id] = kept.length; kept.push(f);
      });
      changes.forEach(function (c) {
        if (c.from === name && !inPlace[c.id]) return;
        var old = c.from && c.from !== name ? stash[c.id] || null : null;
        if (!old && at[c.id] != null) old = kept[at[c.id]];
        var r = c.make(old);
        if (!r) return;
        if (old && carry[c.id]) r._carry = carry[c.id];
        if (at[r.id] != null) kept[at[r.id]] = r; else { at[r.id] = kept.length; kept.push(r); }
      });
      shard.files = kept;
      try {
        if (plan.prepare) plan.prepare(name, shard);
        if (isShowShard(name)) derive(ctx, name, shard, plan);
        else kept.forEach(function (f) { delete f._carry; f.showId = null; f.episodeIds = []; });
      } catch (err) { return next(err); }
      kept.forEach(function (f) {
        var h = f.handle;
        if (ctx.handles[h] !== name) { ctx.handles[h] = name; ctx.dirtyHandles = true; }
        // Files with a correction or a pinned show, and old names of relinked files: an import reads only these.
        if (f.override || f.showOverride) { if (!ctx.flagged[h]) { ctx.flagged[h] = 1; ctx.dirtyHandles = true; } } else if (ctx.flagged[h]) { delete ctx.flagged[h]; ctx.dirtyHandles = true; }
        (f.locatorAliases || []).forEach(function (alias) { var ah = fileHandle(alias); if (ctx.aliases[ah] !== f.id) { ctx.aliases[ah] = f.id; ctx.dirtyHandles = true; } });
      });
      if (plan.passing) self.store.relieve();
      self.writeShard(ctx, name, shard, next, plan.passing);
    }, plan.passing);
  }
  function forgetHandle(f, name) {
    if (ctx.handles[f.handle] === name) { delete ctx.handles[f.handle]; delete ctx.flagged[f.handle]; ctx.dirtyHandles = true; }
  }
};

/* ---------- reads ---------- */
Catalog.prototype.importScan = function (sourceId, scan, cb) { return require('./media-import').run(this, sourceId, scan, cb); };
function checkCursor(self, q) {
  var offset = q.cursor ? +q.cursor.offset : 0;
  if (q.cursor && q.cursor.revision !== self.revision) return failure('Reload this list.', 'STALE_CURSOR');
  if (!isFinite(offset) || offset < 0 || Math.floor(offset) !== offset) return failure('Invalid cursor.', 'INVALID_QUERY');
  return offset;
}
function page(rows, total, offset, revision) {
  return { items: rows, total: total, revision: revision, nextCursor: offset + rows.length < total ? { offset: offset + rows.length, revision: revision } : null };
}
Catalog.prototype.query = function (q, cb) {
  var self = this;
  self.serial(function (done) {
    var offset = checkCursor(self, q), limit = Math.max(1, Math.min(200, Math.floor(+q.limit || 60)));
    if (offset instanceof Error) return done(offset);
    self.context(function (e, ctx) {
      if (e) return done(e);
      if (q.kind === 'show') return done(null, queryShows(self, ctx, q, offset, limit));
      if (q.kind === 'episode') return queryEpisodes(self, ctx, q, offset, limit, done);
      queryFiles(self, ctx, q, offset, limit, done);
    });
  }, cb);
};
function queryShows(self, ctx, q, offset, limit) {
  var disabled = disabledSources(ctx.index, 'show'), revision = self.revision, afterFound = !q.after, rows = [], total = 0;
  var list = Object.keys(ctx.shows).map(function (k) { return ctx.shows[k]; }).filter(function (s) {
    if (s.orphaned) return false;
    if (s.sourceIds && s.sourceIds.length && s.sourceIds.every(function (id) { return disabled[id]; })) return false;
    return matches(s, q);
  });
  list.sort(function (a, b) { var x = String(a.title).toLowerCase(), y = String(b.title).toLowerCase(); return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  list.forEach(function (s) {
    if (!afterFound) { if (s.id === q.after) afterFound = true; return; }
    if (total >= offset && rows.length < limit) { var item = project(s); item.revision = revision; rows.push(item); }
    total++;
  });
  return page(rows, total, offset, revision);
}
/* One show's episodes for a list, in order, with the "gap before" flags. */
function showEpisodes(self, shard, q, disabled, revision) {
  var list = [];
  for (var i = 0; i < shard.episodes.length; i++) {
    var r = shard.episodes[i];
    if (r.orphaned) continue;
    if (r.fileIds && r.fileIds.length && r.fileIds.every(function (id) { return disabled[sourceOfFileId(id)]; })) continue;
    if (!matches(r, q)) continue;
    if (list.length >= EPISODE_CAP) return failure('Narrow this list to a season.', 'TOO_MANY');
    var slim = project(r);
    if (slim.metadata) { var brief = {}; ['id','title','poster','still','year','runtime'].forEach(function (k) { if (slim.metadata[k] !== undefined) brief[k] = slim.metadata[k]; }); slim.metadata = brief; }
    slim.revision = revision;
    slim._covered = !!(q.excludeFile && r.fileIds && r.fileIds.some(function (id) { return fileHandle(id) === q.excludeFile; }));
    list.push(slim);
  }
  list.sort(sortEpisodes);
  var start = 0;
  if (q.after) { start = list.length; list.some(function (item, at) { if (item.handle === q.after) { start = at + 1; return true; } return false; }); }
  var previous = start > 0 ? list[start - 1] : null, gap = false;
  return list.slice(start).filter(function (item) {
    if (previous && item.order === 'aired' && previous.order === 'aired' && ((item.season === previous.season && item.number > previous.number + 1) || (item.season === previous.season + 1 && item.number > 1))) gap = true;
    previous = item;
    if (item._covered || (q.skipWatched && item.watchState === 'watched')) return false;
    delete item._covered; item.gapBefore = gap; gap = false;
    return true;
  });
}
function queryEpisodes(self, ctx, q, offset, limit, done) {
  var disabled = disabledSources(ctx.index, 'episode'), revision = self.revision, rows = [], total = 0;
  var showDisabled = function (s) { return !s || s.orphaned || (s.sourceIds && s.sourceIds.length && s.sourceIds.every(function (id) { return disabled[id]; })); };
  var sids;
  if (q.show) sids = [String(q.show)];
  else {
    sids = Object.keys(ctx.shows).filter(function (sid) { return !showDisabled(ctx.shows[sid]); }).sort();
    var from = q.after ? showOfEpisode(q.after) : null;
    if (from) sids = sids.filter(function (sid) { return sid >= from; });
  }
  series(sids, function (sid, next) {
    if (showDisabled(ctx.shows[sid])) return next();
    self.readShard(sid, function (e, shard) {
      if (e) return next(e);
      var sub = q;
      if (!q.show && q.after && showOfEpisode(q.after) !== sid) { sub = copy(q); delete sub.after; }
      var list = showEpisodes(self, shard, sub, disabled, revision);
      if (list instanceof Error) return next(list);
      list.forEach(function (item) { if (total >= offset && rows.length < limit) rows.push(item); total++; });
      if (!q.show) self.store.relieve();
      next();
    }, !q.show);
  }, function (e) { done(e, e ? null : page(rows, total, offset, revision)); });
}
function queryFiles(self, ctx, q, offset, limit, done) {
  var disabled = disabledSources(ctx.index, q.kind), revision = self.revision, rows = [], total = 0, afterFound = !q.after;
  var slot = q.kind === 'review' ? 1 : q.kind === 'movie' ? 2 : q.kind === 'extra' ? 3 : 0;
  // Without other filters the saved counts say how many rows a file holds, so files before the page
  // and after it are not read at all.
  var simple = !q.q && !q.availableOnly && q.favourite == null && !q.metadataPending && !q.show && q.season == null && !q.bucket && !q.after && !q.excludeFile;
  var names = Object.keys(ctx.index.counts).sort(function (a, b) { var x = isHeadShard(a) ? 0 : 1, y = isHeadShard(b) ? 0 : 1; return (x - y) || (a < b ? -1 : a > b ? 1 : 0); });
  function countOf(name) { var c = ctx.index.counts[name] || {}, n = 0; Object.keys(c).forEach(function (sid) { if (!disabled[sid]) n += c[sid][slot] || 0; }); return n; }
  function wanted(r) {
    if (disabled[r.sourceId]) return false;
    if (slot === 1 && !needsReview(r)) return false;
    if (slot === 2 && r.kind !== 'movie') return false;
    if (slot === 3 && r.kind !== 'extra') return false;
    if (q.show && r.showId !== q.show) return false;
    if (q.excludeFile && r.fileIds && r.fileIds.some(function (id) { return fileHandle(id) === q.excludeFile; })) return false;
    return matches(r, q);
  }
  series(names, function (name, next) {
    var n = countOf(name);
    if (!n) return next();
    if (simple && (total + n <= offset || rows.length >= limit)) { total += n; return next(); }
    self.readShard(name, function (e, shard) {
      if (e) return next(e);
      shard.files.forEach(function (r) {
        if (!wanted(r)) return;
        if (!afterFound) { if (r.id === q.after || r.handle === q.after) afterFound = true; return; }
        if (total >= offset && rows.length < limit) { var item = project(r); item.revision = revision; rows.push(item); }
        total++;
      });
      if (!simple) self.store.relieve();
      next();
    }, !simple);
  }, function (e) { done(e, e ? null : page(rows, total, offset, revision)); });
}
/* A file's whole private record, for playing it (media.js).  Never sent to the app as is. */
Catalog.prototype.file = function (handle, cb) {
  var self = this;
  self.serial(function (done) {
    self.context(function (e, ctx) {
      if (e) return done(e);
      self.findFile(ctx, handle, function (err, f) {
        if (err || !f) return done(err, null);
        var s = ctx.index.sources[f.sourceId];
        done(null, s && s.active === false ? null : f);
      });
    });
  }, cb);
};
Catalog.prototype.findFile = function (ctx, handle, cb) {
  var name = ctx.handles[String(handle)];
  if (!name) return cb(null, null, null);
  this.readShard(name, function (e, shard) {
    if (e) return cb(e);
    var found = null;
    shard.files.some(function (f) { if (f.handle === handle) { found = f; return true; } return false; });
    cb(null, found, found ? name : null, shard);
  });
};
Catalog.prototype.detail = function (q, cb) {
  var self = this;
  self.serial(function (done) {
    self.context(function (e, ctx) {
      if (e) return done(e);
      var disabled = {};
      Object.keys(ctx.index.sources).forEach(function (id) { var s = ctx.index.sources[id]; if (s.active === false || s.contentMode === 'movies') disabled[id] = true; });
      var gone = function (s) { return !s || s.orphaned || (s.sourceIds && s.sourceIds.length && s.sourceIds.every(function (id) { return disabled[id]; })); };
      var missing = failure('This item is no longer in the library.', 'NOT_FOUND');
      if (q.kind === 'show') {
        var show = ctx.shows[String(q.handle)];
        if (gone(show)) return done(missing);
        return self.readShard(show.id, function (err, shard) {
          if (err) return done(err);
          var result = project(show), buckets = {};
          result.revision = self.revision;
          shard.episodes.forEach(function (r) {
            if (r.orphaned) return;
            var bucket = show.displayOrder && show.displayOrder !== 'aired' ? 'Episodes' : r.order === 'date' ? String(r.airDate).slice(0, 4) : r.order === 'absolute' ? 'Episodes' : String(r.season);
            buckets[bucket] = (buckets[bucket] || 0) + 1;
          });
          result.buckets = Object.keys(buckets).sort(function (a, b) { return (+a - +b) || (a < b ? -1 : a > b ? 1 : 0); }).map(function (k) { var m = shard.seasonMetadata && shard.seasonMetadata[k] || {}; return { key: k, count: buckets[k], title: m.title || null, plot: m.plot || null, poster: m.poster || null }; });
          done(null, result);
        });
      }
      var sid = showOfEpisode(q.handle);
      if (!sid || gone(ctx.shows[sid])) return done(missing);
      self.readShard(sid, function (err, shard) {
        if (err) return done(err);
        var ep = null;
        shard.episodes.some(function (r) { if (r.id === q.handle) { ep = r; return true; } return false; });
        if (!ep || ep.orphaned) return done(missing);
        var result = project(ep);
        result.revision = self.revision;
        result.versions = shard.files.filter(function (f) { return ep.fileIds.indexOf(f.id) >= 0 && !disabled[f.sourceId]; }).map(project);
        if (!result.versions.length) return done(failure('This episode has no active source.', 'NOT_FOUND'));
        done(null, result);
      });
    });
  }, cb);
};

/* ---------- changes ---------- */
Catalog.prototype.edit = function (q, cb) {
  if (q.idempotencyKey && !q._commandPrepared && !q.preview && q.operation !== 'previewCorrection') {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(q.idempotencyKey)) return cb(failure('Invalid command identity.', 'INVALID_EDIT'));
    var canonical = {};
    Object.keys(q).sort().forEach(function (k) { if (k !== 'idempotencyKey' && k !== 'expectedRevision' && k.charAt(0) !== '_') canonical[k] = q[k]; });
    var digest = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), entry = this.index.commands['c_' + q.idempotencyKey];
    if (entry) {
      if (entry.hash !== digest) return cb(failure('This command identity was used for a different change.', 'CONFLICT'));
      var duplicate = { revision: entry.revision, duplicate: true };
      Object.keys(entry.extra || {}).forEach(function (k) { duplicate[k] = entry.extra[k]; });
      return cb(null, duplicate);
    }
    var original = cb; cb = function (e, r) { original(e, r); }; cb.command = { key: q.idempotencyKey, hash: digest };
    q = copy(q); q._commandPrepared = true;
  }
  if (q.operation === 'setMetadata' && q.metadata && /^tmdb:tv:[1-9][0-9]*$/.test(q.metadata.id || '') && !q._single) return this.setShowMetadata(q, cb);
  if (/^(classifyFile|resetOverride)$/.test(q.operation)) return require('./media-fast-edit').reclassify(this, q, cb);
  if (/^(setWatched|setFavourite|setPreferredVersion|setMetadata|completeFile|setSeasonMetadata|setBoundaries|markMetadataChecked)$/.test(q.operation)) return require('./media-fast-edit').run(this, q, cb);
  if (/^(mergeShows|unmergeShows|setOrder|setEpisodeGroup|relinkFile)$/.test(q.operation)) return require('./media-grouping').run(this, q, cb);
  if (/^(previewCorrection|commitPreview|undoEdit)$/.test(q.operation)) return require('./media-corrections').run(this, q, cb);
  return cb(failure('Unknown library edit.', 'INVALID_EDIT'));
};
// A show matched to the same TMDB show as another one joins it (same order and episode group).
Catalog.prototype.setShowMetadata = function (q, cb) {
  var self = this, request = copy(q);
  request._single = true;
  var saved = function (error, result) {
    if (error) return cb(error);
    self.serial(function (done) {
      self.context(function (e, ctx) {
        if (e) return done(e);
        var current = ctx.shows[q.handle];
        if (!current || current.orphaned) return done(null, null);
        var peers = Object.keys(ctx.shows).map(function (k) { return ctx.shows[k]; }).filter(function (s) { return !s.orphaned && s.id !== current.id && s.metadata && s.metadata.id === q.metadata.id && (s.displayOrder || s.order) === (current.displayOrder || current.order) && (!s.episodeGroupId || s.episodeGroupId === current.episodeGroupId); });
        if (!peers.length) return done(null, null);
        var candidates = peers.concat([current]).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1); }), survivor = candidates[0];
        done(null, { survivor: survivor.id, other: survivor.id === current.id ? peers[0].id : current.id });
      });
    }, function (e, pair) {
      if (e || !pair) return cb(null, result);
      self.edit({ operation: 'mergeShows', handle: pair.other, target: pair.survivor, expectedRevision: self.revision }, function (mergeError, merged) {
        if (mergeError) { result.mergePending = true; return cb(null, result); }
        merged.mergedInto = pair.survivor; cb(null, merged);
      });
    });
  };
  saved.command = cb.command;
  return self.edit(request, saved);
};
Catalog.prototype.source = function (q, cb) {
  var self = this;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(q.sourceId || '')) return cb(failure('Invalid source.', 'INVALID_EDIT'));
  self.serial(function (done) {
    self.context(function (e, ctx) {
      if (e) return done(e);
      var target = ctx.index.sources[q.sourceId];
      if (!target) target = ctx.index.sources[q.sourceId] = { id: q.sourceId, active: true, revision: 0 };
      if (q.action === 'configure') {
        if (target.active === false) return done(failure('This source was removed.', 'INVALID_EDIT'));
        if (['automatic', 'movies', 'shows'].indexOf(q.contentMode) < 0) return done(failure('Choose a content mode.', 'INVALID_EDIT'));
        if (target.contentMode === q.contentMode) return done(null, { revision: self.revision });
        target.contentMode = q.contentMode;
      } else if (q.action === 'remove') target.active = false;
      else if (q.action === 'activate') target.active = true;
      else return done(failure('Choose a source action.', 'INVALID_EDIT'));
      target.revision = (target.revision || 0) + 1;
      self.commit(ctx, function (err, revision) { done(err, { revision: revision }); });
    });
  }, cb);
};

/* ---------- playback progress ----------
   Kept apart from the catalogue: no revision, its own small file, written at most once a minute
   while something plays, and soon after playback stops (no report for PROGRESS_IDLE_MS) or when the
   app says it stopped (final). */
function Progress(cat, opts) {
  opts = opts || {};
  this.cat = cat; this.doc = null; this.dirty = false; this.timer = null; this.idle = null; this.writing = false; this.again = false; this.lastWrite = 0;
  this.everyMs = opts.progressMs || PROGRESS_MS; this.idleMs = opts.progressIdleMs || PROGRESS_IDLE_MS; this.waiters = [];
}
Progress.prototype.load = function (cb) {
  var self = this;
  if (self.doc) return cb(null, self.doc);
  self.cat.store.read(PROGRESS, function () { return { p: {} }; }, function (e, doc) {
    if (e) return cb(e);
    if (!doc.p || typeof doc.p !== 'object') doc.p = {};
    self.doc = doc; cb(null, doc);
  });
};
Progress.prototype.put = function (id, entry, now) {
  var p = this.doc.p, keys;
  p[id] = entry;
  keys = Object.keys(p);
  if (keys.length > PROGRESS_CAP) { keys.sort(function (a, b) { return p[a].at - p[b].at; }); while (keys.length > PROGRESS_CAP) delete p[keys.shift()]; }
  this.dirty = true;
  var self = this;
  if (!self.timer) { self.timer = setTimeout(function () { self.timer = null; self.flush(); }, self.everyMs); if (self.timer.unref) self.timer.unref(); }
  if (self.idle) clearTimeout(self.idle);
  self.idle = setTimeout(function () { self.idle = null; self.flush(); }, self.idleMs);
  if (self.idle.unref) self.idle.unref();
};
Progress.prototype.flush = function (cb) {
  var self = this;
  if (cb) self.waiters.push(cb);
  if (self.writing) { self.again = true; return; }
  if (self.timer) { clearTimeout(self.timer); self.timer = null; }
  if (self.idle) { clearTimeout(self.idle); self.idle = null; }
  if (!self.dirty || !self.doc) { var w = self.waiters; self.waiters = []; return w.forEach(function (f) { f(null); }); }
  self.writing = true; self.dirty = false;
  self.cat.store.write(PROGRESS, self.doc, function (e) {
    self.writing = false; self.lastWrite = Date.now();
    if (e) self.dirty = true;
    if (self.again) { self.again = false; if (self.dirty) return self.flush(); }
    if (!self.dirty) self.doc = null;      // the memo keeps it a minute; this copy can go
    var waiting = self.waiters; self.waiters = [];
    waiting.forEach(function (f) { f(e || null); });
  });
};
Catalog.prototype.progress = function (q, cb) {
  var self = this;
  if (!q || !isFinite(q.position) || q.position < 0 || !isFinite(q.duration) || q.duration <= 0 || q.position > q.duration + 5 || typeof q.session !== 'string' || q.session.length > 100 || !isFinite(q.sequence) || q.sequence < 0 || !isFinite(q.startedAt)) return cb(failure('Invalid progress event.', 'INVALID_EDIT'));
  self.serial(function (done) {
    self.context(function (e, ctx) {
      if (e) return done(e);
      self.findFile(ctx, q.handle, function (err, file) {
        if (err || !file) return done(err || failure('File unavailable.', 'NOT_FOUND'));
        self.progressStore.load(function (loadError, doc) {
          if (loadError) return done(loadError);
          var previous = doc.p[file.id], now = Date.now();
          if (previous && ((previous.session === q.session && previous.sequence >= q.sequence) || (previous.session !== q.session && previous.startedAt > q.startedAt))) return done(null, { ignored: true, revision: self.revision });
          self.progressStore.put(file.id, { id: file.id, handle: file.handle, sourceId: file.sourceId, session: q.session, sequence: q.sequence, startedAt: q.startedAt, position: q.position, duration: q.duration, at: now }, now);
          if (!q.final) return done(null, { revision: self.revision });
          self.progressStore.flush(function (flushError) { done(flushError, { revision: self.revision }); });
        });
      });
    });
  }, cb);
};
Catalog.prototype.continuing = function (cb) {
  var self = this;
  self.serial(function (done) {
    self.context(function (e, ctx) {
      if (e) return done(e);
      self.progressStore.load(function (err, doc) {
        if (err) return done(err);
        var disabled = {}, cards = {}, count = 0;
        Object.keys(ctx.index.sources).forEach(function (id) { var s = ctx.index.sources[id]; if (s.active === false || s.contentMode === 'movies') disabled[id] = true; });
        var list = Object.keys(doc.p).map(function (k) { return doc.p[k]; }).filter(function (p) { return p.position >= 5 && p.position < p.duration - 1 && !disabled[p.sourceId || sourceOfFileId(p.id)]; });
        list.sort(function (a, b) { return b.at - a.at; });
        series(list.slice(0, 300), function (p, next) {
          if (count >= 60) return next();
          var sid = ctx.handles[p.handle], show = sid && ctx.shows[sid];
          if (!isShowShard(sid) || !show || show.orphaned || cards[sid]) return next();
          self.readShard(sid, function (e2, shard) {
            if (e2) return next(e2);
            shard.episodes.some(function (ep) {
              if (ep.orphaned || ep.watchState === 'watched' || (ep.fileIds || []).indexOf(p.id) < 0) return false;
              var card = project(show); card.at = p.at; card.continueEpisode = ep.id; card.continueFile = p.handle; card.progressPercent = Math.round(100 * p.position / p.duration);
              cards[sid] = card; count++;
              return true;
            });
            next();
          });
        }, function (e3) {
          done(e3, e3 ? null : { items: Object.keys(cards).map(function (k) { return cards[k]; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 60), revision: self.revision });
        });
      });
    });
  }, cb);
};
// Whether a file has saved playback (relinking asks before replacing it).
Catalog.prototype.hasProgress = function (id, cb) { this.progressStore.load(function (e, doc) { cb(e, !e && !!doc.p[id]); }); };

module.exports = {
  Catalog: Catalog, project: project, hash: hash, headName: headName, isShowShard: isShowShard, isHeadShard: isHeadShard, epId: epId, showOfEpisode: showOfEpisode,
  fileHandle: fileHandle, coords: coords, episodeCoordinate: episodeCoordinate, group: group, eligible: eligible, targetOf: targetOf, resolveKey: resolveKey, addAnchor: addAnchor,
  series: series, failure: failure, clone: clone, copy: copy, watchFields: watchFields, sortEpisodes: sortEpisodes
};
