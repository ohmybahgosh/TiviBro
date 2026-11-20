/* Recording to a WebDAV share (discussion #130): for TVs that aren't rooted, which can't reach a USB drive.
   Synology, QNAP, TrueNAS, Unraid, Nextcloud and rclone all serve WebDAV; plain SMB isn't possible from a
   developer-mode app (no mounting without root, and no SMB client for the TV's Node).

   A target: { type: 'webdav', address: 'https://nas:5006/video', user, pass, name }.  Recordings go under
   <address>/TiviBro Recordings/... as on a USB drive.  Each part of a recording is one upload (PUT, sent as it's
   recorded, chunked), so a dropped connection loses the end of one part, not the recording; record.js starts a new
   part every few minutes.  Old TVs' Node predates today's Let's Encrypt roots: a certificate it can't check is
   tried again with the chain in media-ca.js (still checked, never skipped), as My media does.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), https = require('https'), URL_ = require('url');
var CA = null;
function ca() { if (CA === null) { try { CA = require('./media-ca'); } catch (e) { CA = ''; } } return CA || undefined; }

function base(t) {
  var u; try { u = URL_.parse(String(t && t.address || '')); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return { u: u, tls: u.protocol === 'https:', root: (u.pathname || '/').replace(/\/+$/, '') };
}
function enc(rel) { return rel.split('/').map(function (p) { return encodeURIComponent(p); }).join('/'); }
// The full path on the server of a path relative to the target ("TiviBro Recordings/TV/x.ts").
function full(t, rel) { var b = base(t); return b.root + '/' + enc(String(rel).replace(/^\/+/, '')); }
function urlOf(t, rel) { var b = base(t); return b.u.protocol + '//' + b.u.host + full(t, rel); }
function auth(t) { return t.user || t.pass ? 'Basic ' + Buffer.from(String(t.user || '') + ':' + String(t.pass || '')).toString('base64') : ''; }
function certErr(e) { return /certificate|self.signed|unable to verify|UNABLE_TO_GET_ISSUER|CERT_/i.test(String(e && (e.code || e.message))); }

/* One request.  opts: { method, rel, headers, body, stream: true (the response handed over as it comes), timeout }.
   cb(err, res, body). */
function req(t, opts, cb, withCa) {
  var b = base(t); if (!b) return cb(new Error('not a WebDAV address'));
  var h = {}; for (var k in opts.headers || {}) h[k] = opts.headers[k];
  var a = auth(t); if (a) h.Authorization = a;
  if (opts.body != null) h['Content-Length'] = Buffer.byteLength(opts.body);
  var o = { hostname: b.u.hostname, port: b.u.port || (b.tls ? 443 : 80), path: opts.path || full(t, opts.rel || ''), method: opts.method || 'GET', headers: h, agent: false };
  if (b.tls && withCa) o.ca = ca();
  var done = false;
  function end(e, res, body) { if (done) return; done = true; if (e && b.tls && !withCa && certErr(e)) return req(t, opts, cb, true); cb(e, res, body); }
  var r = (b.tls ? https : http).request(o, function (res) {
    if (opts.stream) return end(null, res);
    var chunks = [], n = 0;
    res.on('data', function (d) { n += d.length; if (n < 2 * 1024 * 1024) chunks.push(d); });
    res.on('end', function () { end(null, res, Buffer.concat(chunks).toString('utf8')); });
    res.on('error', end);
  });
  r.on('error', end);
  r.setTimeout(opts.timeout || 20000, function () { try { r.abort(); } catch (e) {} end(new Error('the share didn\'t answer')); });
  if (opts.body != null) r.write(opts.body);
  r.end();
  return r;
}
function said(res) { var c = res && res.statusCode; return c === 401 || c === 403 ? 'the share turned down the login (' + c + ')' : c === 507 ? 'the share is full' : 'the share said ' + c; }

// Each folder of rel, made if it isn't there (MKCOL; 405 means it is).
function mkdirs(t, rel, cb) {
  var parts = String(rel).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean), i = 0;
  (function next() {
    if (i >= parts.length) return cb(null);
    var p = parts.slice(0, ++i).join('/');
    req(t, { method: 'MKCOL', rel: p }, function (e, res) {
      if (e) return cb(e);
      if (res.statusCode >= 300 && res.statusCode !== 405 && res.statusCode !== 301) return cb(new Error(said(res)));
      next();
    });
  })();
}

/* An upload that's written as it comes: write(buf) and end(cb).  onFail(err) once, if the server refuses it or the
   connection drops; what was sent before that is usually kept by the server (a shorter part). */
function upload(t, rel, onFail) {
  var b = base(t), failed = false, ended = false, endCb = null, gotRes = null;
  var h = { 'Content-Type': 'video/mp2t', 'Transfer-Encoding': 'chunked' }, a = auth(t); if (a) h.Authorization = a;
  var o = { hostname: b.u.hostname, port: b.u.port || (b.tls ? 443 : 80), path: full(t, rel), method: 'PUT', headers: h, agent: false };
  if (b.tls) o.ca = t._ca ? ca() : undefined;
  function fail(e) { if (failed) return; failed = true; if (endCb) { var c = endCb; endCb = null; c(e); } else if (onFail) onFail(e); }
  var r = (b.tls ? https : http).request(o, function (res) {
    gotRes = res; res.resume();
    res.on('end', function () {
      if (res.statusCode >= 300) return fail(new Error(said(res)));
      if (endCb) { var c = endCb; endCb = null; c(null); }
    });
  });
  r.on('error', function (e) { if (b.tls && !t._ca && certErr(e)) t._ca = true; fail(e); });
  // A server that stops taking data for a minute: gone.
  r.setTimeout(60000, function () { try { r.abort(); } catch (e) {} fail(new Error('the share stopped taking the recording')); });
  return {
    write: function (buf) { if (failed || ended) return true; return r.write(buf); },
    end: function (cb) { if (ended) return cb && cb(null); ended = true; if (failed) return cb && cb(new Error('failed')); endCb = cb || function () {}; r.end(); if (gotRes && gotRes.complete) { var c = endCb; endCb = null; c(gotRes.statusCode >= 300 ? new Error(said(gotRes)) : null); } },
    abort: function () { failed = true; try { r.abort(); } catch (e) {} },
    get failed() { return failed; }
  };
}

function put(t, rel, buf, type, cb) { req(t, { method: 'PUT', rel: rel, body: buf, headers: { 'Content-Type': type || 'application/octet-stream' } }, function (e, res) { cb(e || (res.statusCode >= 300 ? new Error(said(res)) : null)); }); }
function move(t, from, to, cb) {
  req(t, { method: 'MOVE', rel: from, headers: { Destination: urlOf(t, to), Overwrite: 'F' } }, function (e, res) { cb(e || (res.statusCode >= 300 ? new Error(said(res)) : null)); });
}
function del(t, rel, cb) { req(t, { method: 'DELETE', rel: rel }, function (e, res) { cb(e || (res.statusCode >= 300 && res.statusCode !== 404 ? new Error(said(res)) : null)); }); }
// How many entries a folder holds (PROPFIND, depth 1, less the folder itself); -1 when it can't tell.
function count(t, rel, cb) {
  req(t, { method: 'PROPFIND', rel: rel, headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>' }, function (e, res, body) {
    if (e || res.statusCode !== 207) return cb(-1);
    cb(Math.max(0, (String(body).match(/<([A-Za-z0-9_-]+:)?response[\s>]/g) || []).length - 1));
  });
}
// A file's size on the share (HEAD), or -1.
function size(t, rel, cb) { req(t, { method: 'HEAD', rel: rel }, function (e, res) { cb(e || res.statusCode >= 300 ? -1 : +(res.headers['content-length'] || -1)); }); }
// The names in a folder (PROPFIND, depth 1, without the folder itself); null when it can't tell.
function names(t, rel, cb) {
  var self = full(t, rel).replace(/\/+$/, '');
  req(t, { method: 'PROPFIND', rel: rel, headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>' }, function (e, res, body) {
    if (e || res.statusCode !== 207) return cb(null);
    var out = [], re = /<(?:[A-Za-z0-9_-]+:)?href>([^<]*)<\/(?:[A-Za-z0-9_-]+:)?href>/g, m;
    while ((m = re.exec(String(body)))) {
      var h = m[1].replace(/^https?:\/\/[^\/]+/, '').replace(/\/+$/, ''), d; try { d = decodeURIComponent(h); } catch (x) { d = h; }
      var mine; try { mine = decodeURIComponent(self); } catch (x) { mine = self; }
      if (d === mine) continue;
      out.push(d.split('/').pop());
    }
    cb(out);
  });
}
// A part of a recording, for the player: from..to (inclusive), handed over as the server sends it.
function get(t, rel, from, to, cb) { return req(t, { rel: rel, stream: true, timeout: 30000, headers: { Range: 'bytes=' + from + '-' + to } }, cb); }
// Can it log in and write?  A small file put and taken away again.
function check(t, folder, cb) {
  mkdirs(t, folder, function (e) {
    if (e) return cb(e);
    var f = folder + '/.tivibro-check';
    put(t, f, 'TiviBro checks it can write here.', 'text/plain', function (e2) { if (e2) return cb(e2); del(t, f, function () { cb(null); }); });
  });
}

module.exports = { base: base, mkdirs: mkdirs, upload: upload, put: put, move: move, del: del, count: count, names: names, size: size, get: get, check: check, urlOf: urlOf };
