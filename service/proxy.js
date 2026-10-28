/* TiviBro network helper: a tiny localhost HTTP relay.
   webOS enforces CORS on installed apps, and most IPTV providers send no CORS headers, so the
   app sends its provider requests here instead and this relay adds the headers.

   URL scheme (path style, so relative links inside HLS playlists keep resolving):
     http://127.0.0.1:PORT/x/<http|https>/<host[:port]>/<path>?<query>
   Optional custom User-Agent for providers that require one (TiviMate's "User-Agent" setting):
     http://127.0.0.1:PORT/ua/<base64url of the agent>/x/<http|https>/<host>/<path>
   The prefix sits in front, so relative links inside HLS playlists keep it automatically.
   Upstream redirects are returned as redirects to the relayed form of the new address, so the
   browser always knows the real location.  Bodies are streamed, never buffered, and Range
   requests pass through for seeking.  Plain ES5 for the old Node versions on webOS (see compat.js). */
'use strict';
require('./compat');                 // older Node on older webOS: fill in what is missing
var http = require('http');
var https = require('https');
var URL_ = require('url');
var Editor = require('./editor');
var Unzip = require('./unzip');
var TsSync = require('./tssync').TsSync;

var ALLOW = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Unzipped, X-Raw-Length',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS'
};
var PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding', 'last-modified', 'etag', 'cache-control'];

// Shared ring buffer: relay requests and service lifecycle events, readable at /log.
var LOG = [], LOG_MAX = 300;
function redact(u) {
  return String(u).replace(/((?:password|pass|pwd)=)[^&\s]*/gi, '$1***').replace(/(username=)([^&\s]{0,2})[^&\s]*/gi, '$1$2***')
    .replace(/\/(live|movie|series|timeshift)\/([^/\s]{0,2})[^/\s]*\/[^/\s]+\//gi, '/$1/$2***/***/');
}
function log(entry) {
  entry.t = Date.now();
  LOG.push(entry);
  if (LOG.length > LOG_MAX) LOG.splice(0, LOG.length - LOG_MAX);
  if (entry.e || entry.lv === 'error') console.error('[tivibro-helper]', JSON.stringify(entry));
}

function target(reqUrl) {
  var m = /^\/x\/(https?)\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?/.exec(reqUrl);
  if (!m) return null;
  return m[1] + '://' + m[2] + (m[3] || '/') + (m[4] || '');
}
function relayed(base, abs) {
  var u = URL_.parse(abs);
  return base + '/x/' + u.protocol.replace(':', '') + '/' + u.host + (u.path || '/');
}

function create(opts) {
  opts = opts || {};
  var stats = { requests: 0, errors: 0, active: 0 };
  var agentHttp = new http.Agent({ keepAlive: true, maxSockets: 16 });
  var agentHttps = new https.Agent({ keepAlive: true, maxSockets: 16 });
  var editor = Editor.create(log);      // web editor: LAN server is off until the app turns it on

  var server = http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') { res.writeHead(204, ALLOW); return res.end(); }
    if (req.url === '/ping') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ ok: true, node: process.version, stats: stats })); }
    if (req.url.indexOf('/editor/') === 0) { res.setHeader('Access-Control-Allow-Origin', '*'); return editor.control(req, res, req.url.split('?')[0]); }
    if (req.url === '/log') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ node: process.version, stats: stats, log: LOG })); }
    var xm = /^\/xfer\/([A-Za-z0-9_-]{1,40})$/.exec(req.url);
    if (xm) { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, ALLOW)); return res.end(JSON.stringify(Unzip.progress(xm[1]) || { raw: 0, total: 0, done: false, unknown: true })); }
    // Optional prefixes, in this order: /ua/<base64url user agent>, then /unz/<id> (unzip, see unzip.js).
    var ua = null, unz = null, path = req.url, prefix = '';
    var um = /^\/ua\/([A-Za-z0-9_-]+)(\/.*)$/.exec(path);
    if (um) { try { ua = Buffer.from(um[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { ua = null; } path = um[2]; prefix += '/ua/' + um[1]; }
    var zm = /^\/unz\/([A-Za-z0-9_-]{1,40})(\/.*)$/.exec(path);
    if (zm) { unz = zm[1]; path = zm[2]; prefix += '/unz/' + unz; }
    var t = target(path);
    if (!t) { res.writeHead(404, ALLOW); return res.end('not a relay address'); }
    stats.requests++; stats.active++;
    var base = 'http://' + (req.headers.host || ('127.0.0.1:' + server.address().port)) + prefix;
    var u = URL_.parse(t);
    var lib = u.protocol === 'https:' ? https : http;
    var headers = { 'User-Agent': ua || opts.userAgent || 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0 Safari/537.36', 'Accept': '*/*' };
    if (unz) headers['Accept-Encoding'] = 'gzip, deflate';      // the helper unzips, so ask for the smallest transfer
    else {
      if (req.headers.range) headers.Range = req.headers.range;
      if (req.headers['accept-encoding']) headers['Accept-Encoding'] = req.headers['accept-encoding'];
    }
    var done = false, aborted = false, t0 = Date.now(), bytes = 0, rec = { m: req.method, u: redact(t), range: req.headers.range || undefined };
    function finish() {
      if (done) return;
      done = true; stats.active--;
      rec.ms = Date.now() - t0; rec.b = bytes; if (aborted) rec.aborted = true;
      log(rec);
    }
    var up = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: headers, agent: u.protocol === 'https:' ? agentHttps : agentHttp, rejectUnauthorized: false
    }, function (ur) {
      var code = ur.statusCode || 502;
      rec.s = code; rec.ct = ur.headers['content-type'];
      rec.firstByteMs = Date.now() - t0;
      if (code >= 300 && code < 400 && ur.headers.location) {
        var next = URL_.resolve(t, ur.headers.location);
        rec.redirect = redact(next);
        res.writeHead(code === 301 || code === 308 ? 307 : code, Object.assign({ Location: relayed(base, next) }, ALLOW));
        ur.resume(); res.end(); return finish();
      }
      var h = Object.assign({}, ALLOW);
      PASS.forEach(function (k) { if (ur.headers[k] != null) h[k] = ur.headers[k]; });
      if (code >= 400) rec.lv = 'error';
      var xfer = unz ? Unzip.track(unz, +ur.headers['content-length'] || 0) : null;
      ur.on('data', function (d) { bytes += d.length; if (xfer) xfer.raw = bytes; });
      ur.on('error', function (e) { if (!aborted) { stats.errors++; rec.e = 'response: ' + (e.code || e.message); } finish(); res.destroy(); });
      // Live MPEG-TS: keep it aligned if stray bytes get in (see tssync.js).  Whole-file and Range
      // requests (movies, seeking) are left alone.
      var ts = !unz && code === 200 && req.method !== 'HEAD' && !req.headers.range &&
        (/mp2t|mpegts|mpeg-ts/i.test(ur.headers['content-type'] || '') || /\.ts$/i.test((u.pathname || '')));
      if (ts) {
        delete h['content-length'];
        var sync = new TsSync(function (n) { rec.tsDropped = (rec.tsDropped || 0) + n; if (!rec.lv) rec.lv = 'warn'; });
        res.writeHead(code, h);
        sync.on('error', function () { res.destroy(); });
        ur.pipe(sync).pipe(res);
        ur.on('end', function () { if (xfer) xfer.done = true; finish(); });
        return;
      }
      if (!unz || code >= 300 || req.method === 'HEAD') {
        res.writeHead(code, h);
        ur.pipe(res);
        ur.on('end', function () { if (xfer) xfer.done = true; finish(); });
        return;
      }
      Unzip.decode(ur, ur.headers['content-encoding'], function (err, body, how) {
        if (err) {
          stats.errors++; rec.e = 'unzip: ' + (err.code || err.message); rec.lv = 'error'; if (xfer) xfer.done = true; finish();
          if (!res.headersSent) { res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, ALLOW)); res.end('could not unzip: ' + err.message); } else res.destroy();
          return;
        }
        if (how) {
          rec.unzipped = how;
          delete h['content-length']; delete h['content-encoding']; delete h['content-range']; delete h['accept-ranges'];
          h['X-Unzipped'] = how;
          if (ur.headers['content-length']) h['X-Raw-Length'] = ur.headers['content-length'];
          if (!h['content-type'] || /gzip|octet-stream|x-compressed/i.test(h['content-type'])) h['content-type'] = 'application/xml';
        } else delete h['content-encoding'];
        res.writeHead(code, h);
        body.on('error', function (e) { if (!aborted) { stats.errors++; rec.e = 'unzip: ' + (e.code || e.message); } if (xfer) xfer.done = true; finish(); res.destroy(); });
        body.on('end', function () { if (xfer) xfer.done = true; finish(); });
        body.pipe(res);
      });
    });
    up.setTimeout(opts.timeout || 30000, function () { up.destroy(new Error('upstream timeout')); });
    up.on('error', function (e) {
      if (!aborted) { stats.errors++; rec.e = (e.code ? e.code + ' ' : '') + e.message; }
      finish();
      if (!res.headersSent) { res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, ALLOW)); res.end('relay error: ' + e.message); }
      else res.destroy();
    });
    // Viewer zapped away: stop pulling the stream from the provider at once.
    req.on('close', function () { if (!res.writableEnded && !res.finished) { aborted = true; up.destroy(); } finish(); });
    up.end();
  });
  server.keepAliveTimeout = 30000;
  server.on('close', function () { editor.stop(); });
  return { server: server, stats: stats, editor: editor };
}

module.exports = { create: create, target: target, relayed: relayed, log: log, redact: redact, LOG: LOG };
