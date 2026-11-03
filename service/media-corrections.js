/* My media corrections: a preview, then a commit; folder rules saved with their source; undo.
   A preview covers at most PREVIEW_CAP files and only the files it names are read again on commit.
   Previews live in memory for 15 minutes (at most 4), undos in undo.json (at most 10, 30 days).
   ES5 / Node 0.12. */
'use strict';
var crypto = require('crypto'), Classifier = require('./media-classify');
var PREVIEW_CAP = 2000, PREVIEWS = 4, UNDOS = 10, UNDO = 'undo.json';
function M() { return require('./media-catalog'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function error(message, code) { var e = new Error(message); e.code = code || 'INVALID_EDIT'; return e; }
function matches(rule, file) { return rule.type === 'folderRule' && rule.sourceId === file.sourceId && Array.isArray(rule.ancestors) && rule.ancestors.every(function (name, i) { return (file.ancestors || [])[i] === name; }); }
function classify(file, rules) {
  var applicable = (rules || []).filter(function (r) { return matches(r, file); }).sort(function (a, b) { return a.ancestors.length - b.ancestors.length || a.sequence - b.sequence; }).map(function (r) { return r.fields; });
  if (file.override) applicable.push(file.override);
  return Classifier.classify({ basename: file.file, ancestors: file.ancestors, server: file.server }, { order: file.classification && file.classification.order }, applicable);
}
function fields(input) {
  var out = {};
  ['kind', 'showTitle', 'season', 'numbers', 'order', 'airDate', 'absoluteNumber', 'absolutePart', 'title'].forEach(function (k) { if (Object.prototype.hasOwnProperty.call(input || {}, k)) out[k] = clone(input[k]); });
  return out;
}
function state(f) { return { override: f.override || null, classification: f.classification, kind: f.kind }; }

/* Read the files behind handles, one shard at a time: cb(error, [{ file, name }]). */
function filesByHandle(c, ctx, handles, cb) {
  var byShard = {}, out = [];
  handles.forEach(function (h) { var name = ctx.handles[String(h)]; if (name) (byShard[name] = byShard[name] || {})[h] = true; });
  M().series(Object.keys(byShard).sort(), function (name, next) {
    c.readShard(name, function (e, shard) {
      if (e) return next(e);
      shard.files.forEach(function (f) { if (byShard[name][f.handle]) out.push({ file: f, name: name }); });
      next();
    });
  }, function (e) { cb(e, out); });
}
// Whether a show may hold files under the folder ancestors (its saved folder list says so).
function mayHold(show, ancestors) {
  if (!show.folders) return true;
  var prefix = JSON.stringify(ancestors).slice(0, -1);
  return show.folders.some(function (folder) { return folder.indexOf(prefix) === 0 && (prefix.length === 1 || folder.charAt(prefix.length) === ']' || folder.charAt(prefix.length) === ','); });
}
/* The files of one source under a folder, a shard at a time: visit(file, shardName). */
function eachSourceFile(c, ctx, sourceId, ancestors, visit, cb) {
  var names = [M().headName(sourceId)].concat(Object.keys(ctx.shows).filter(function (sid) { var s = ctx.shows[sid]; return (s.sourceIds || []).indexOf(sourceId) >= 0 && mayHold(s, ancestors); }).sort());
  M().series(names, function (name, next) {
    c.readShard(name, function (e, shard) {
      if (e) return next(e);
      shard.files.forEach(function (f) { if (f.sourceId === sourceId) visit(f, name); });
      next();
    }, true);
  }, cb);
}
function rulesOf(c, sourceIds, cb) {
  var out = {};
  M().series(sourceIds, function (sid, next) { c.readShard(M().headName(sid), function (e, head) { if (e) return next(e); out[sid] = head.rules || []; next(); }); }, function (e) { cb(e, out); });
}

function run(catalog, q, cb) {
  catalog.serial(function (done) {
    var now = Date.now(), revision = catalog.revision;
    Object.keys(catalog.previews).forEach(function (k) { if (catalog.previews[k].expires < now) delete catalog.previews[k]; });
    if (q.expectedRevision !== revision) return done(error('The library changed.  Refresh the preview.', 'CONFLICT'));
    catalog.context(function (e, ctx) {
      if (e) return done(e);
      if (q.operation === 'previewCorrection') return preview(catalog, ctx, q, now, done);
      if (q.operation === 'commitPreview') {
        var saved = catalog.previews[q.previewToken];
        if (!saved || saved.expires < now || saved.revision !== revision) return done(error('This preview expired.  Refresh it.', 'CONFLICT'));
        return commit(catalog, ctx, { patches: saved.patches, addRule: saved.rule, removeRuleIds: (saved.removedRules || []).map(function (r) { return r.id; }), rulesSource: saved.rulesSource }, now, function (err, result) {
          if (!err) delete catalog.previews[q.previewToken];
          done(err, result);
        });
      }
      if (q.operation === 'undoEdit') return undo(catalog, ctx, q, now, done);
      done(error('Unknown correction operation.'));
    });
  }, cb);
}
function preview(catalog, ctx, q, now, done) {
  var selected = q.handles || [], normalized = fields(q.fields), rule = null, removed = [], patches = [], invalid = null;
  if (!Array.isArray(selected) || selected.length > 1000) return done(error('Select at most 1,000 files at a time.'));
  var build = function (list, rules) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i], after = { file: f.file, ancestors: f.ancestors, server: f.server, sourceId: f.sourceId, classification: f.classification, override: rule ? f.override : normalized };
      if (!after.override) delete after.override;
      var applicable = (rules[f.sourceId] || []).filter(function (r) { return removed.indexOf(r) < 0; });
      if (rule && !q.resetFolder) applicable = applicable.concat([rule]);
      var cls = classify(after, applicable);
      if (cls.review.some(function (r) { return /^invalid/.test(r); })) invalid = error('One or more files would have invalid coordinates.');
      if (patches.length >= PREVIEW_CAP) return error('This change covers more than 2,000 files.  Correct a smaller folder.');
      patches.push({ handle: f.handle, before: state(f), after: { override: after.override || null, classification: cls, kind: cls.kind } });
    }
    return null;
  };
  var finish = function () {
    if (invalid) return done(invalid);
    if (!patches.length) return done(error('No files match this selection.'));
    var token = crypto.randomBytes(16).toString('hex'), keys;
    catalog.previews[token] = { revision: catalog.revision, patches: patches, rule: q.resetFolder ? null : rule, removedRules: removed, rulesSource: rule ? rule.sourceId : null, expires: now + 900000, at: now };
    keys = Object.keys(catalog.previews).sort(function (a, b) { return catalog.previews[a].at - catalog.previews[b].at; });
    while (keys.length > PREVIEWS) delete catalog.previews[keys.shift()];
    done(null, { revision: catalog.revision, previewToken: token, count: patches.length, examples: patches.slice(0, 10).map(function (p) { return { handle: p.handle, before: p.before.classification, after: p.after.classification }; }) });
  };
  if (q.folderOf) {
    return catalog.findFile(ctx, q.folderOf, function (err, anchor) {
      if (err) return done(err);
      if (!anchor) return done(error('That folder is no longer available.'));
      rule = { type: 'folderRule', id: 'rule_' + crypto.randomBytes(16).toString('hex'), sourceId: anchor.sourceId, ancestors: clone(anchor.ancestors || []), fields: normalized, sequence: now };
      rulesOf(catalog, [anchor.sourceId], function (rulesError, rules) {
        if (rulesError) return done(rulesError);
        if (q.resetFolder) {
          removed = rules[anchor.sourceId].filter(function (r) { return r.type === 'folderRule' && JSON.stringify(r.ancestors) === JSON.stringify(anchor.ancestors || []); });
          if (!removed.length) return done(error('This folder has no saved correction.'));
        }
        var list = [], over = null;
        // Folder rules never overwrite a more specific correction of one file.
        eachSourceFile(catalog, ctx, anchor.sourceId, rule.ancestors, function (f) { if (!over && matches(rule, f) && !f.override) { list.push(f); if (list.length > PREVIEW_CAP) over = true; } }, function (walkError) {
          if (walkError) return done(walkError);
          if (over) return done(error('This change covers more than 2,000 files.  Correct a smaller folder.'));
          var tooMany = build(list, rules);
          if (tooMany) return done(tooMany);
          finish();
        });
      });
    });
  }
  filesByHandle(catalog, ctx, selected, function (err, found) {
    if (err) return done(err);
    var list = found.map(function (x) { return x.file; }), sources = [];
    list.forEach(function (f) { if (sources.indexOf(f.sourceId) < 0) sources.push(f.sourceId); });
    rulesOf(catalog, sources, function (rulesError, rules) {
      if (rulesError) return done(rulesError);
      var tooMany = build(list, rules);
      if (tooMany) return done(tooMany);
      finish();
    });
  });
}
/* Put patches into effect, change the folder rules of their source, and save an undo for them.
   o: { patches, addRule, removeRuleIds, restoreRules, rulesSource, verify, consumedUndo } */
function commit(catalog, ctx, o, now, done) {
  var byHandle = {}, patches = o.patches;
  patches.forEach(function (p) { byHandle[p.handle] = p; });
  filesByHandle(catalog, ctx, Object.keys(byHandle), function (err, found) {
    if (err) return done(err);
    if (o.verify) {
      var stale = found.length !== patches.length || found.some(function (x) { return JSON.stringify(state(x.file)) !== JSON.stringify(byHandle[x.file.handle].before); });
      if (stale) return done(error('These fields changed again.  Review before undoing.', 'CONFLICT'));
    }
    var changes = [], extra = [], head = o.rulesSource ? M().headName(o.rulesSource) : null, removedNow = [];
    found.forEach(function (x) {
      var p = byHandle[x.file.handle], next = M().copy(x.file);
      if (p.after.override) next.override = p.after.override; else delete next.override;
      next.classification = p.after.classification; next.kind = p.after.kind;
      changes.push({ id: next.id, from: x.name, to: M().targetOf(ctx, next, null), make: function () { return next; } });
    });
    if (head) extra.push(head);
    catalog.store.read(UNDO, function () { return { undos: [] }; }, function (undoError, undoDoc) {
      if (undoError) return done(undoError);
      if (!Array.isArray(undoDoc.undos)) undoDoc.undos = [];
      var undoId = 'undo_' + crypto.randomBytes(16).toString('hex'), remove = o.removeRuleIds || [];
      catalog.apply(ctx, { changes: changes, extra: extra, prepare: function (name, shard) {
        if (name !== head) return;
        shard.rules = shard.rules.filter(function (r) { if (remove.indexOf(r.id) >= 0) { removedNow.push(r); return false; } return true; });
        (o.restoreRules || []).forEach(function (r) { if (!shard.rules.some(function (x) { return x.id === r.id; })) shard.rules.push(r); });
        if (o.addRule) shard.rules.push(o.addRule);
      } }, function (applyError) {
        if (applyError) return done(applyError);
        undoDoc.undos = undoDoc.undos.filter(function (u) { return u.expires > now && u.id !== o.consumedUndo; });
        undoDoc.undos.push({ id: undoId, rulesSource: o.rulesSource || null, ruleIds: o.addRule ? [o.addRule.id] : (o.restoreRules || []).map(function (r) { return r.id; }), removedRules: removedNow,
          expires: now + 30 * 86400000, patches: patches.map(function (p) { return { handle: p.handle, before: p.before, after: p.after }; }) });
        while (undoDoc.undos.length > UNDOS) undoDoc.undos.shift();
        if (catalog.command) catalog.command.extra = { undoHandle: undoId, changed: patches.length };
        catalog.store.write(UNDO, undoDoc, function (writeError) {
          if (writeError) return done(writeError);
          catalog.commit(ctx, function (commitError, revision) { done(commitError, { revision: revision, undoHandle: undoId, changed: patches.length }); });
        });
      });
    });
  });
}
/* Undo: the files go back if nobody changed them since; the rule it added goes, the rules it
   replaced come back.  Undoing saves an undo of its own. */
function undo(catalog, ctx, q, now, done) {
  catalog.store.read(UNDO, function () { return { undos: [] }; }, function (e, doc) {
    if (e) return done(e);
    var entry = null;
    (doc.undos || []).some(function (u) { if (u.id === q.undoHandle) { entry = u; return true; } return false; });
    if (!entry || entry.expires < now) return done(error('This undo is no longer available.'));
    commit(catalog, ctx, { patches: entry.patches.map(function (p) { return { handle: p.handle, before: p.after, after: p.before }; }), verify: true, consumedUndo: entry.id,
      rulesSource: entry.rulesSource, removeRuleIds: entry.ruleIds || [], restoreRules: entry.removedRules || [] }, now, done);
  });
}
module.exports = { run: run, classify: classify, matches: matches };
