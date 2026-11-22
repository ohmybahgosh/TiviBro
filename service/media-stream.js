/* Authenticated WebDAV and Google Drive files, and files read by a program (SMB shares, smb.js), streamed
   through localhost with Range/HEAD support.
   The player gets a random, temporary address; credentials stay in bounded memory.
   Redirects keep the login only on its original origin.  TLS is always verified,
   including the bundled root fallback needed by Node 0.12 on older TVs. */
'use strict';
require('./compat');
var http = require('http'), https = require('https'), URL_ = require('url');
var crypto = require('crypto'), CA = require('./media-ca');
var sessions = {}, TTL = 24 * 3600000, MAX = 16, WAIT = 20000;
var PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

function origin(u) { return u.protocol + '//' + u.host; }
// A new session's address, with room made for it (expired ones, then the oldest, go).
function add(session, ext) {
  var now = Date.now();
  Object.keys(sessions).forEach(function (k) { if (sessions[k].until < now) delete sessions[k]; });
  var keys = Object.keys(sessions).sort(function (a, b) { return sessions[a].until - sessions[b].until; });
  while (keys.length >= MAX) delete sessions[keys.shift()];
  var token = crypto.randomBytes(24).toString('hex');
  session.until = now + TTL;
  sessions[token] = session;
  ext = /^(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i.test(ext || '') ? ext.toLowerCase() : 'bin';
  return '/media-stream/' + token + '/movie.' + ext;
}
function create(url, authorization, ext) {
  return add({ url: url, authorization: authorization, origin: origin(URL_.parse(url)) }, ext);
}
/* A file a program reads (smb.js reader): reader.size(cb(err, { size, mtime })) and
   reader.open(start, end, cb(err, readable, stop)). */
function createReader(reader, ext) { return add({ reader: reader }, ext); }

var TYPES = { mkv: 'video/x-matroska', mp4: 'video/mp4', m4v: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime', m2ts: 'video/mp2t', ts: 'video/mp2t', webm: 'video/webm' };
/* The byte range asked for ("bytes=a-b", "bytes=a-" or "bytes=-n"), clamped to the file: { start, end }
   (inclusive), null for the whole file, or false when it can't be served (416). */
function rangeOf(header, size) {
  var m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!header || !m || (m[1] === '' && m[2] === '')) return header && !m ? false : null;
  var start, end;
  if (m[1] === '') { start = Math.max(0, size - (+m[2])); end = size - 1; }
  else { start = +m[1]; end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1); }
  return start > end || start >= size ? false : { start: start, end: end };
}
/* Serves a reader session: HEAD answers from the size alone; GET runs one read for the range, piped to
   the player, and stopped as soon as the player hangs up (it seeked, or closed the movie). */
function serveReader(s, req, res, allow, ext, end) {
  s.reader.size(function (e, st) {
    if (e || !st) return end(e && (e.kind === 'notfound' || e.kind === 'address') ? 404 : 502);
    var size = st.size, r = rangeOf(req.headers.range, size), h = Object.assign({ 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Type': TYPES[ext] || 'application/octet-stream' }, allow);
    if (st.mtime) h['Last-Modified'] = new Date(st.mtime).toUTCString();
    if (r === false) { h['Content-Range'] = 'bytes */' + size; res.writeHead(416, h); return res.end(); }
    var from = r ? r.start : 0, to = r ? r.end : size - 1;
    h['Content-Length'] = size ? to - from + 1 : 0;
    if (r) h['Content-Range'] = 'bytes ' + from + '-' + to + '/' + size;
    if (req.method === 'HEAD' || !size) { res.writeHead(r ? 206 : 200, h); return res.end(); }
    var stop = null, closed = false;
    res.on('close', function () { closed = true; if (stop) stop(); });
    s.reader.open(from, to, function (e2, stream, stopIt) {
      if (e2) return end(502);
      stop = stopIt;
      if (closed) return stop();
      res.writeHead(r ? 206 : 200, h);
      stream.on('error', function () { res.destroy(); });
      stream.pipe(res);
    });
  });
}

function handle(req, res, allow) {
  var match = /^\/media-stream\/([a-f0-9]{48})\/movie\.[a-z0-9]+$/.exec(req.url), s = match && sessions[match[1]];
  function end(code) { if (!res.headersSent) { res.writeHead(code, allow); res.end(); } else res.destroy(); }
  if (!s || s.until < Date.now()) return end(404);
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(405);
  s.until = Date.now() + TTL;
  if (s.reader) return serveReader(s, req, res, allow, req.url.split('.').pop(), end);
  var up = null, stopped = false;
  res.on('close', function () { stopped = true; if (up) up.abort(); });
  /* The login for the source's own origin: a fixed header (WebDAV), or a function that gives a fresh one
     (Google Drive's hour-long tokens: asked before each read, and once more, fresh, after a 401). */
  function login(url, fresh, cb) {
    var u; try { u = URL_.parse(url); } catch (e) { return cb(null); }
    if (origin(u) !== s.origin) return cb(null);
    if (typeof s.authorization !== 'function') return cb(s.authorization);
    s.authorization(function (e, h) { cb(e ? null : h); }, fresh);
  }
  function open(url, left, withCa, fresh, retried) {
    if (stopped) return;
    login(url, !!fresh, function (auth) { if (!stopped) send(url, left, withCa, auth, retried); });
  }
  function send(url, left, withCa, auth, retried) {
    var u; try { u = URL_.parse(url); } catch (e) { return end(502); }
    var tls = u.protocol === 'https:';
    if (!u.hostname || (!tls && u.protocol !== 'http:')) return end(502);
    if (u.port && (!/^\d+$/.test(u.port) || +u.port < 1 || +u.port > 65535)) return end(502);
    var headers = { Accept: '*/*', 'Accept-Encoding': 'identity' };
    if (auth) headers.Authorization = auth;
    if (req.headers.range) headers.Range = req.headers.range;
    if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
    var opts = { hostname: u.hostname, port: u.port || (tls ? 443 : 80), path: u.path || '/', method: req.method, headers: headers, agent: false };
    if (tls && withCa) opts.ca = CA;
    var attempt, waiting = null;
    try { attempt = (tls ? https : http).request(opts, onResponse); }
    catch (e) { return end(502); }
    function onResponse(remote) {
      clearTimeout(waiting);
      if (stopped) { remote.destroy(); return; }
      var code = remote.statusCode;
      if (code === 401 && typeof s.authorization === 'function' && !retried) { remote.resume(); return open(url, left, withCa, true, true); }
      if (code >= 300 && code < 400 && remote.headers.location) {
        remote.resume();
        if (!left) return end(502);
        var next; try { next = URL_.resolve(url, remote.headers.location); } catch (e) { return end(502); }
        return open(next, left - 1, false, false, retried);
      }
      var h = Object.assign({ 'Cache-Control': 'no-store' }, allow);
      PASS.forEach(function (k) { if (remote.headers[k] != null) h[k] = remote.headers[k]; });
      res.writeHead(code, h);
      remote.on('error', function () { res.destroy(); });
      remote.pipe(res);
    }
    up = attempt;
    attempt.on('error', function (e) {
      clearTimeout(waiting);
      if (stopped) return;
      if (tls && !withCa && !res.headersSent && /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(e.code || '')) return send(url, left, true, auth, retried);
      end(502);
    });
    /* 20 s for the server to answer.  Only until it does: once the movie is streaming, a pause on the TV
       stops reading and the connection goes quiet for as long as the pause, which must not end it. */
    waiting = setTimeout(function () { if (!stopped) { end(504); attempt.abort(); } }, WAIT);
    attempt.end();
  }
  open(s.url, 5, false);
}
module.exports = { create: create, createReader: createReader, rangeOf: rangeOf, handle: handle, _wait: function (ms) { WAIT = ms; } };
