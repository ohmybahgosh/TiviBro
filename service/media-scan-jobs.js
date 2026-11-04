/* Where a paused My media scan goes on from, saved in the helper's own storage (never sent anywhere).
   A checkpoint belongs to one source as it was set up: its fingerprint is an HMAC, with a random key
   made once on this TV, of the address, user name and scan settings.  The password is not part of it
   and is never saved.  Checkpoints are capped (CAP_ITEMS records, CAP_BYTES on disk): a bigger one is
   not saved, and an unreadable or oversized one is ignored, so the next scan simply starts fresh.
   ES5 / Node 0.12. */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto'), Store = require('./media-library');
var CAP_ITEMS = 40000, CAP_BYTES = 8 * 1048576, secret = null;
function root() { return require('./kv').sub('media-scan-jobs'); }
function key(directory) {
  if (secret) return secret;
  var file = path.join(directory, 'checkpoint.key');
  try { var saved = fs.readFileSync(file, 'utf8').trim(); if (/^[a-f0-9]{64}$/.test(saved)) return (secret = saved); } catch (e) {}
  var made = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, made, { mode: 384 }); } catch (e2) {}
  return (secret = made);
}
function fingerprint(directory, source) {
  var clean = {};
  ['type', 'address', 'control', 'user', 'contentMode', 'maxDepth'].forEach(function (k) { clean[k] = source[k] || ''; });
  if (source.type === 'dropbox') clean.root = String(source.root || '').toLowerCase();   // its folder (the refresh token, like a password, is left out)
  return crypto.createHmac('sha256', key(directory)).update(JSON.stringify(clean)).digest('hex');
}
function name(id) { return 'scan_' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 40) + '.json'; }
function size(state) {
  var n = 0;
  function count(v) { if (!v) return 0; if (Array.isArray(v)) return v.length; return typeof v === 'object' ? Object.keys(v).length : 0; }
  ['queue', 'visited', 'byPath', 'discovered', 'pathOwners', 'movies', 'entries'].forEach(function (k) { n += count(state[k]); });
  return n;
}
/* The source to scan, with _continuation when a matching checkpoint exists.  Never fails: a
   checkpoint that cannot be used means a fresh scan. */
function prepare(source, restart, cb) {
  if (!source || !source.id) return cb(null, source);
  var directory, file;
  try { directory = root(); file = path.join(directory, name(source.id)); } catch (e) { return cb(null, source); }
  if (restart) return fs.unlink(file, function () { cb(null, source); });
  fs.stat(file, function (statError, st) {
    if (statError) return cb(null, source);
    if (st.size > CAP_BYTES) return fs.unlink(file, function () { cb(null, source, 'too large'); });
    fs.readFile(file, 'utf8', function (e, body) {
      if (e) return cb(null, source, 'unreadable');
      var job;
      try { job = JSON.parse(body); } catch (error) { return fs.unlink(file, function () { cb(null, source, 'unreadable'); }); }
      if (!job || job.version !== 3 || !job.state || job.fingerprint !== fingerprint(directory, source)) return cb(null, source);
      var next = {};
      Object.keys(source).forEach(function (k) { next[k] = source[k]; });
      next._continuation = job.state;
      cb(null, next);
    });
  });
}
/* Save (or with no state, drop) a source's checkpoint.  cb(error, saved). */
function save(source, state, cb) {
  if (!source || !source.id) return cb(null, false);
  var directory;
  try { directory = root(); } catch (e) { return cb(e, false); }
  var file = name(source.id);
  if (!state || size(state) > CAP_ITEMS) return fs.unlink(path.join(directory, file), function (e) { cb(e && e.code !== 'ENOENT' ? e : null, false); });
  var body;
  try { body = JSON.stringify({ version: 3, fingerprint: fingerprint(directory, source), state: state, at: Date.now() }); } catch (e2) { return cb(e2, false); }
  if (Buffer.byteLength(body, 'utf8') > CAP_BYTES) return fs.unlink(path.join(directory, file), function () { cb(null, false); });
  Store.atomic(directory, file, body, function (e3) { cb(e3, !e3); });
}
module.exports = { prepare: prepare, save: save, CAP_ITEMS: CAP_ITEMS, CAP_BYTES: CAP_BYTES };
