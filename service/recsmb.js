/* Recording and live pause to a Windows or Samba share (SMB), for TVs that aren't rooted (no USB drive for the app)
   and for anyone who'd rather keep recordings on a PC or NAS.  The same calls as recdav.js (WebDAV), so record.js and
   timeshift.js use either one the same way; the work is done by tivibro-smb through smb.js (version 3 writes).

   A target: { type: 'smb', server: 'host' or 'host:port', host (its name, when server is an address), share,
   folder ('/' or '/TV'), user, pass, domain, name }.  Its address, the key a recording keeps to find it again, is
   smb://server/share/folder.  Paths given here ("TiviBro Recordings/TV/x.ts") are under the target's folder.
   A part of a recording is one long run of "put" that writes it as it arrives; record.js starts a new part every
   few minutes, so a dropped connection loses the end of one part, not the recording.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var Smb = require('./smb');

function str(v) { return v == null ? '' : String(v); }
// The key a recording keeps: smb://server/share/folder (the same target gives the same key).
function addressOf(t) {
  var folder = Smb.cleanPath(t && t.folder || '/') || '/';
  return 'smb://' + str(t && t.server).trim() + '/' + str(t && t.share).trim() + (folder === '/' ? '' : folder);
}
// The target as smb.js wants it (its folder is the top; paths are added to it here), or null when it can't be used.
function base(t) {
  if (!t || !str(t.server).trim() || !str(t.share).trim()) {
    // A recording that only kept the address: server, share and folder from it (a guest login).
    var m = /^smb:\/\/([^\/]+)\/([^\/]+)(\/.*)?$/.exec(str(t && t.address));
    if (!m) return null;
    t = { server: m[1], share: m[2], folder: m[3] || '/', user: t.user, pass: t.pass, domain: t.domain, host: t.host };
  }
  var p = Smb.parts({ server: t.server, share: t.share, folder: t.folder || '/', user: t.user, pass: t.pass, domain: t.domain });
  return p instanceof Error ? null : t;
}
// A path inside the share for rel under the target's folder.
function full(t, rel) {
  var b = base(t), f = Smb.cleanPath(b && b.folder || '/') || '/', r = Smb.cleanPath(rel) || '/';
  return f === '/' ? r : r === '/' ? f : f + r;
}
// The source smb.js runs against: the share, its login, and the server's name for finding it if its address changed.
function src(t) { var b = base(t) || {}; return { type: 'smb', server: b.server, host: b.host, share: b.share, folder: '/', user: b.user, pass: b.pass, domain: b.domain }; }
// An smb.js error as recdav.js words it.
function said(e) { if (!e) return null; var f = Smb.failure(e); var x = new Error(f.message); x.kind = f.error; return x; }

function mkdirs(t, rel, cb) { Smb.mkdirs(src(t), full(t, rel), function (e) { cb(said(e)); }); }
/* A part written as it comes: write(buf), end(cb), abort(); onFail(err) once if the share stops taking it. */
function upload(t, rel, onFail) { return Smb.writer(src(t), full(t, rel), function (e) { if (onFail) onFail(said(e)); }); }
function put(t, rel, buf, type, cb) { Smb.put(src(t), full(t, rel), buf, function (e) { cb(said(e)); }); }
// Moving or deleting a file a player is still reading fails on the server (the read holds it open): reads stop first.
function move(t, from, to, cb) { Smb.stopReads(full(t, from)); setTimeout(function () { Smb.move(src(t), full(t, from), full(t, to), function (e) { cb(said(e)); }); }, 300); }
function del(t, rel, cb) { Smb.stopReads(full(t, rel)); setTimeout(function () { Smb.remove(src(t), [full(t, rel)], function (e, stayed) { cb(said(e) || (stayed && stayed.length ? new Error('the share kept it') : null)); }); }, 300); }
// Several at once (old live-pause pieces): one run.
function delMany(t, rels, cb) { Smb.remove(src(t), rels.map(function (r) { return full(t, r); }), function (e) { if (cb) cb(said(e)); }); }
// The names in a folder; null when it can't tell.
function names(t, rel, cb) { Smb.list(src(t), full(t, rel), function (e, l) { cb(e ? null : l.map(function (x) { return x.name; })); }); }
function count(t, rel, cb) { names(t, rel, function (l) { cb(l ? l.length : -1); }); }
// A file's size, or -1.
function size(t, rel, cb) { Smb.stat(src(t), full(t, rel), function (e, st) { cb(e || !st || st.dir ? -1 : st.size); }); }
/* Bytes from..to (inclusive) of a file, for the player: cb(err, res) where res is a stream with statusCode 206, as
   recdav.js's get gives, and the return value has abort(). */
function get(t, rel, from, to, cb) {
  var stopper = null, aborted = false;
  Smb.reader(src(t), full(t, rel)).open(from, to, function (e, stream, stop) {
    if (e) return cb(said(e));
    if (aborted) { stop(); return; }
    stopper = stop;
    stream.statusCode = 206;
    stream.resume = stream.resume || function () {};
    cb(null, stream);
  });
  return { abort: function () { aborted = true; if (stopper) stopper(); } };
}
// The room on the share: cb(freeMB) (-1 when it can't tell).
function free(t, cb) { Smb.space(src(t), function (e, sp) { cb(e || !sp ? -1 : sp.freeMB); }); }
// Can it sign in and write?  A small file put and taken away again.
function check(t, folder, cb) {
  if (!base(t)) return cb(new Error('Enter the server and the share.'));
  var f = folder + '/.tivibro-check';
  put(t, f, 'TiviBro checks it can write here.', 'text/plain', function (e) { if (e) return cb(e); del(t, f, function () { cb(null); }); });
}

module.exports = { base: base, addressOf: addressOf, mkdirs: mkdirs, upload: upload, put: put, move: move, del: del, delMany: delMany, count: count, names: names, size: size, get: get, free: free, check: check, _full: full };
