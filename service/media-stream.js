/* Authenticated WebDAV files, streamed through localhost with Range/HEAD support.
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
function create(url, authorization, ext) {
  var now = Date.now();
  Object.keys(sessions).forEach(function (k) { if (sessions[k].until < now) delete sessions[k]; });
  var keys = Object.keys(sessions).sort(function (a, b) { return sessions[a].until - sessions[b].until; });
  while (keys.length >= MAX) delete sessions[keys.shift()];
  var token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { url: url, authorization: authorization, origin: origin(URL_.parse(url)), until: now + TTL };
  ext = /^(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i.test(ext || '') ? ext.toLowerCase() : 'bin';
  return '/media-stream/' + token + '/movie.' + ext;
}

function handle(req, res, allow) {
  var match = /^\/media-stream\/([a-f0-9]{48})\/movie\.[a-z0-9]+$/.exec(req.url), s = match && sessions[match[1]];
  function end(code) { if (!res.headersSent) { res.writeHead(code, allow); res.end(); } else res.destroy(); }
  if (!s || s.until < Date.now()) return end(404);
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(405);
  s.until = Date.now() + TTL;
  var up = null, stopped = false;
  res.on('close', function () { stopped = true; if (up) up.abort(); });
  function open(url, left, withCa) {
    if (stopped) return;
    var u; try { u = URL_.parse(url); } catch (e) { return end(502); }
    var tls = u.protocol === 'https:';
    if (!u.hostname || (!tls && u.protocol !== 'http:')) return end(502);
    if (u.port && (!/^\d+$/.test(u.port) || +u.port < 1 || +u.port > 65535)) return end(502);
    var headers = { Accept: '*/*', 'Accept-Encoding': 'identity' };
    if (origin(u) === s.origin) headers.Authorization = s.authorization;
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
      if (code >= 300 && code < 400 && remote.headers.location) {
        remote.resume();
        if (!left) return end(502);
        var next; try { next = URL_.resolve(url, remote.headers.location); } catch (e) { return end(502); }
        return open(next, left - 1, false);
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
      if (tls && !withCa && !res.headersSent && /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(e.code || '')) return open(url, left, true);
      end(502);
    });
    /* 20 s for the server to answer.  Only until it does: once the movie is streaming, a pause on the TV
       stops reading and the connection goes quiet for as long as the pause, which must not end it. */
    waiting = setTimeout(function () { if (!stopped) { end(504); attempt.abort(); } }, WAIT);
    attempt.end();
  }
  open(s.url, 5, false);
}
module.exports = { create: create, handle: handle, _wait: function (ms) { WAIT = ms; } };
