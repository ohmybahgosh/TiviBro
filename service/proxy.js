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
var dns = require('dns');
var RawHttp = require('./rawhttp');
var Guide = require('./guide');
var Vod = require('./vod');
var Kv = require('./kv');
var Live = require('./live');
var Media = require('./media');

/* DNS answers kept for a minute.  Node asks the system for every new connection, and each channel
   start (and each redirect to a provider's streaming server) is a new connection; on a TV with a
   slow resolver that is up to a few hundred milliseconds per channel change.  An answer is
   dropped when a connection to it fails, so a provider that moves is followed at once.  Node 20
   (webOS 26) asks with all: true and wants a list back; older Node asks for one address.  Node
   0.12 ignores custom lookups and keeps asking the system. */
var dnsCache = {};
function cachedLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (typeof opts === 'number') opts = { family: opts };
  opts = opts || {};
  var key = host + '|' + (opts.family || 0) + '|' + (opts.all ? 1 : 0), hit = dnsCache[key];
  if (hit && Date.now() - hit.t < 60000) return process.nextTick(function () { cb.apply(null, [null].concat(hit.r)); });
  dns.lookup(host, opts, function (err, a, f) {
    if (!err && a) dnsCache[key] = { t: Date.now(), r: opts.all ? [a] : [a, f] };
    cb(err, a, f);
  });
}
function forgetHost(host) { for (var k in dnsCache) if (k.indexOf(host + '|') === 0) delete dnsCache[k]; }

var ALLOW = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, X-TiviBro-Ctl',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Unzipped, X-Raw-Length',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS'
};
var PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding', 'last-modified', 'etag', 'cache-control'];

// Shared ring buffer: relay requests and service lifecycle events, readable at /log.
var LOG = [], LOG_MAX = 300;
/* What the app needs to tell a crash from the TV being turned off or restarted (app/js/log.js): when
   the TV started (from Node's uptime), and the TV's recent power changes (service.js records them). */
var SYS = { power: [] };
function sys() { return { bootAt: Math.round(Date.now() - require('os').uptime() * 1000), power: SYS.power.slice(-10) }; }
/* Like Log.redact in the app.  Hosts whose links are signed (My media's file servers, learned as
   service/media.js resolves a movie) keep only their host. */
function escRx(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function redact(u) {
  var s = String(u);
  (Media.signedHosts || []).forEach(function (h) { s = s.replace(new RegExp('(' + escRx(h) + ')[/?][^\\s"\'<>\\\\]*', 'gi'), '$1/***'); });
  return s.replace(/([?&](?:sig|signature|token|auth|key|expires|hash)=)[^&\s]*/gi, '$1***')
      .replace(/((?:password|pass|pwd|api_key|access_token)=)[^&\s]*/gi, '$1***').replace(/(username=)([^&\s]{0,2})[^&\s]*/gi, '$1$2***')
    .replace(/\/(live|movie|series|timeshift)\/([^/\s]{0,2})[^/\s]*\/[^/\s]+\//gi, '/$1/$2***/***/');
}
/* The helper's own errors (an uncaught exception, a failed guide load) are also kept on the TV's
   storage, last 30, so a report made after the helper restarted still has them (/log "earlier"). */
var ERRS = require('path').join(__dirname, 'helper-errors.json'), EARLIER = [];
try { EARLIER = JSON.parse(require('fs').readFileSync(ERRS, 'utf8')) || []; } catch (e) {}
function log(entry) {
  entry.t = Date.now();
  LOG.push(entry);
  if (LOG.length > LOG_MAX) LOG.splice(0, LOG.length - LOG_MAX);
  if (entry.e || entry.lv === 'error') console.error('[tivibro-helper]', JSON.stringify(entry));
  if (entry.lv === 'error' && entry.event) {
    EARLIER.push({ t: entry.t, event: entry.event, e: String(entry.e || '').slice(0, 600) });
    EARLIER = EARLIER.slice(-30);
    try { require('fs').writeFile(ERRS, JSON.stringify(EARLIER), function () {}); } catch (x) {}
  }
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

/* HLS playlists: links that start with "/" or carry their own host would leave the relay (a
   root-relative "/hlsr/..." resolves to 127.0.0.1/hlsr/... and fails with 404; a full address
   skips the helper and meets CORS).  Many Xtream panels answer .m3u8 with a redirect to a
   tokenized edge server whose segments are exactly such links, so the helper rewrites them to
   their relayed form.  Plain relative links already resolve through the relay and are left alone. */
var HLS_MAX = 2 * 1024 * 1024;
function isHlsRequest(path, ctype) { return /mpegurl/i.test(ctype || '') || /\.m3u8$/i.test(path || ''); }
function rewriteHls(text, src, base) {
  if (!/#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|MEDIA:|I-FRAME-STREAM-INF)/.test(text)) return null;
  function fix(link) {
    if (!/^(\/[^/]|https?:\/\/)/i.test(link)) return link;
    var abs = URL_.resolve(src, link);
    return /^https?:/i.test(abs) ? relayed(base, abs) : link;
  }
  var changed = false;
  var out = text.split(/\r?\n/).map(function (line) {
    var l = line.trim(), n;
    if (!l) return line;
    if (l.charAt(0) === '#') {
      n = line.replace(/URI="([^"]+)"/g, function (m, u) { return 'URI="' + fix(u) + '"'; });
      if (n !== line) changed = true;
      return n;
    }
    n = fix(l);
    if (n !== l) changed = true;
    return n;
  }).join('\n');
  return changed ? out : null;
}

function sameText(a, b) {
  var x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && require('crypto').timingSafeEqual(x, y);
}

function create(opts) {
  opts = opts || {};
  var stats = { requests: 0, errors: 0, active: 0 };
  var agentHttp = new http.Agent({ keepAlive: true, maxSockets: 16 });
  var agentHttps = new https.Agent({ keepAlive: true, maxSockets: 16 });
  var editor = Editor.create(log);      // web editor: LAN server is off until the app turns it on

  var server = http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') { res.writeHead(204, ALLOW); return res.end(); }
    if (req.url === '/ping') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ ok: true, node: process.version, stats: stats, guide: 2, vod: 2, kv: 1, live: 1, sys: sys() })); }
    /* The web editor and the phone app connection are switched on and off from TiviBro only.  On the
       TV the helper hands TiviBro a secret with its start reply (service.js, over luna, which only
       TiviBro may call); without it, a web page in the TV's browser could reach these over localhost. */
    var ctlRoute = req.url.indexOf('/editor/') === 0 ? 'editor' : req.url.indexOf('/companion/') === 0 ? 'companion' : req.url.indexOf('/kv/') === 0 ? 'kv' : req.url.indexOf('/live/') === 0 ? 'live' : req.url.indexOf('/media/') === 0 ? 'media' : '';
    if (ctlRoute) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (opts.ctl && !sameText(req.headers['x-tivibro-ctl'], opts.ctl)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"not allowed"}'); }
      if (ctlRoute === 'editor') return editor.control(req, res, req.url.split('?')[0]);
      if (ctlRoute === 'kv') return Kv.handle(req, res, ALLOW, log);
      if (ctlRoute === 'live') return Live.handle(req, res, ALLOW, log, server.address().port);
      if (ctlRoute === 'media') return Media.handle(req, res, ALLOW, log);
      if (!opts.companion) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no phone app connection in this helper"}'); }
      return opts.companion.control(req, res, req.url.split('?')[0]);
    }
    if (req.url.indexOf('/guide/') === 0) return Guide.handle(req, res, ALLOW, log);
    if (req.url.indexOf('/vod/') === 0) return Vod.handle(req, res, ALLOW, log, server.address().port);
    if (req.url === '/log') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ node: process.version, stats: stats, log: LOG, earlier: EARLIER })); }
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
      // HLS playlists are read here (see rewriteHls), so ask for them unzipped.
      if (req.headers['accept-encoding'] && !/\.m3u8$/i.test(path.split('?')[0])) headers['Accept-Encoding'] = req.headers['accept-encoding'];
    }
    var done = false, aborted = false, t0 = Date.now(), bytes = 0, rec = { m: req.method, u: redact(t), range: req.headers.range || undefined };
    function finish() {
      if (done) return;
      done = true; stats.active--;
      rec.ms = Date.now() - t0; rec.b = bytes; if (aborted) rec.aborted = true;
      log(rec);
    }
    var reqOpts = {
      protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: headers, agent: u.protocol === 'https:' ? agentHttps : agentHttp, rejectUnauthorized: false,
      // Node 12.15 and newer (webOS 22 on) reject sloppy replies unless asked for the lenient parser:
      // stray control characters in headers, bare LF line endings.  Older Node ignores the option.
      // What even that refuses (Content-Length twice; control characters on Node 8) goes through
      // the forgiving reader in rawhttp.js instead, see onUpError.
      insecureHTTPParser: true, lookup: cachedLookup
    };
    var up = lib.request(reqOpts, onResponse), triedRaw = false;
    function onResponse(ur) {
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
      if (!unz && code === 200 && req.method !== 'HEAD' && !req.headers.range && isHlsRequest(u.pathname, ur.headers['content-type']) &&
          !(ur.headers['content-encoding'] && ur.headers['content-encoding'] !== 'identity') && !(+ur.headers['content-length'] > HLS_MAX)) {
        var parts = [], size = 0, passed = false;
        ur.on('data', function (d) {
          if (passed) return;
          parts.push(d); size += d.length;
          if (size > HLS_MAX) {              // not a playlist after all: hand over what we have and stream the rest
            passed = true; res.writeHead(code, h);
            parts.forEach(function (p) { res.write(p); }); parts = null;
            ur.pipe(res);
          }
        });
        ur.on('end', function () {
          if (!passed) {
            var body = Buffer.concat(parts).toString('utf8'), fixed = rewriteHls(body, t, base);
            if (fixed !== null) { rec.hlsRewritten = true; delete h['content-length']; h['content-type'] = h['content-type'] || 'application/vnd.apple.mpegurl'; }
            res.writeHead(code, h);
            res.end(fixed !== null ? fixed : Buffer.concat(parts));
          }
          finish();
        });
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
    }
    function onTimeout() { up.destroy(new Error('upstream timeout')); }
    function onUpError(e) {
      // Node's parser refused the reply: ask again with the forgiving reader.
      if (!aborted && !triedRaw && !res.headersSent && /^HPE_/.test(e.code || '')) {
        triedRaw = true; rec.lenient = e.code;
        up = RawHttp.request(reqOpts, onResponse);
        up.setTimeout(opts.timeout || 30000, onTimeout);
        up.on('error', onUpError);
        return;
      }
      if (!aborted) { stats.errors++; rec.e = (e.code ? e.code + ' ' : '') + e.message; }
      if (!aborted && /^(ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET)$/.test(e.code || '')) forgetHost(u.hostname);
      finish();
      if (!res.headersSent) { res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, ALLOW)); res.end('relay error: ' + e.message); }
      else res.destroy();
    }
    up.setTimeout(opts.timeout || 30000, onTimeout);
    up.on('error', onUpError);
    // Viewer zapped away: stop pulling the stream from the provider at once.
    req.on('close', function () { if (!res.writableEnded && !res.finished) { aborted = true; up.destroy(); } finish(); });
    up.end();
  });
  server.keepAliveTimeout = 30000;
  server.on('close', function () { editor.stop(); });
  return { server: server, stats: stats, editor: editor };
}

module.exports = { SYS: SYS, sys: sys, create: create, target: target, relayed: relayed, rewriteHls: rewriteHls, log: log, redact: redact, LOG: LOG };
