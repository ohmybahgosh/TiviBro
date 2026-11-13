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
var TsSync = require('./tssync').TsSync, FrameHold = require('./tssync').FrameHold;
var dns = require('dns');
var RawHttp = require('./rawhttp');
var Guide = require('./guide');
var Vod = require('./vod');
var Kv = require('./kv');
var Live = require('./live');
var Stalker = require('./stalker');
var Media = require('./media');
var Convert = require('./convert');
var Ffmpeg = require('./ffmpeg');
var Pace = require('./pace');

/* DNS answers.  Node asks the system for every new connection, and each channel start (and each
   redirect to a provider's streaming server) is a new connection; on a TV with a slow resolver that is
   up to a few hundred milliseconds per channel change.  An answer is used as it is for a minute; after
   that, for up to half an hour, it is still used at once while a fresh one is asked for in the
   background, so a channel change after a while away doesn't wait for the resolver either.  An answer
   is dropped when a connection to it fails, so a provider that moves is followed at once.  Node 20
   (webOS 26) asks with all: true and wants a list back; older Node asks for one address.  Node 0.12
   ignores custom lookups and keeps asking the system. */
var dnsCache = {}, DNS_FRESH = 60000, DNS_STALE = 30 * 60000;
function cachedLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (typeof opts === 'number') opts = { family: opts };
  opts = opts || {};
  var key = host + '|' + (opts.family || 0) + '|' + (opts.all ? 1 : 0), hit = dnsCache[key], age = hit ? Date.now() - hit.t : Infinity;
  function ask(done) {
    dns.lookup(host, opts, function (err, a, f) {
      if (!err && a) dnsCache[key] = { t: Date.now(), r: opts.all ? [a] : [a, f] };
      else if (dnsCache[key]) dnsCache[key].refreshing = false;
      if (done) done(err, a, f);
    });
  }
  if (hit && age < DNS_FRESH) return process.nextTick(function () { cb.apply(null, [null].concat(hit.r)); });
  if (hit && age < DNS_STALE) {
    if (!hit.refreshing) { hit.refreshing = true; ask(null); }
    return process.nextTick(function () { cb.apply(null, [null].concat(hit.r)); });
  }
  ask(cb);
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
// Who may use the relay (create's server): TiviBro's own pages and the TV's player, at the TV's own address.
function ownOrigin(o) {
  if (o == null || o === '') return true;                    // the player, the helper's own requests, curl
  o = String(o);
  return o === 'null' || o === 'file://' || /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(o);
}
function sameHost(h) {
  if (!h) return true;                                       // HTTP/1.0 tools send none
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(String(h));
}
function redact(u) {
  var s = String(u);
  (Media.signedHosts || []).forEach(function (h) { s = s.replace(new RegExp('(' + escRx(h) + ')[/?][^\\s"\'<>\\\\]*', 'gi'), '$1/***'); });
  return s.replace(/\/media-stream\/[a-f0-9]{48}/gi, '/media-stream/***').replace(/([?&](?:sig|signature|token|auth|key|expires|hash|stb|play_token|stream_token)=)[^&\s]*/gi, '$1***')
      .replace(/((?:password|pass|pwd|api_key|access_token)=)[^&\s]*/gi, '$1***').replace(/(username=)([^&\s]{0,2})[^&\s]*/gi, '$1$2***')
      // Tokens in headers and JSON: "Bearer …", a JWT (TMDB's read token is one), and named fields.
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}=*/gi, '$1***').replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, 'eyJ***')
      .replace(/("(?:credential|token|access_token|refresh_token|password|pass|secret|api_key)"\s*:\s*")[^"]{4,}(")/gi, '$1***$2')
    .replace(/\/(live|movie|series|timeshift)\/([^/\s]{0,2})[^/\s]*\/[^/\s]+\//gi, '/$1/$2***/***/')
    // The short Xtream link, http://server/user/pass/12345.ts (issue #25); the same rule as app/js/log.js.
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\/\s"'<>]+)\/([^\/\s"'<>?#]{0,2})[^\/\s"'<>?#]*\/[^\/\s"'<>?#]+\/(\d+(?:\.[a-z0-9]{2,5})?)(?=[\s"'<>?#]|$)/gi, '$1/$2***/***/$3');
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

Ffmpeg.setLog(log);
Ffmpeg.prepare();                         // a release carries the converter: onto the TV's storage, no download

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

/* A live Xtream channel's account: "host|user" from http://host/live/user/pass/123.ts (or the short
   http://host/user/pass/123.ts, or without .ts).  TiviBro plays one live channel at a time, so a new one
   on the same account replaces an older one still open (see liveOf in create). */
function liveKey(u) {
  var m = /^\/(?:live\/)?([^\/]+)\/[^\/]+\/\d+(?:\.ts)?$/.exec(u.pathname || '');
  return m && !/^(movie|series|hls|timeshift|streaming)$/i.test(m[1]) ? (u.host || '').toLowerCase() + '|' + m[1] : '';
}
/* Where a picture can start in a TS stream: a packet that starts a PES (payload_unit_start) carrying an
   H.264 SPS (NAL type 7) or an H.265 VPS/SPS (32, 33), which encoders send just before every keyframe.  Joined
   anywhere else (the middle of a group of pictures), the TV's decoder errs on frames that need the ones it never
   got.  -1: none in buf (whole packets only where it can tell: a 0x47 every 188 bytes). */
function keyStart(buf) {
  for (var i = 0; i + 188 <= buf.length; i++) {
    if (buf[i] !== 0x47 || !(buf[i + 1] & 0x40) || (i + 188 < buf.length && buf[i + 188] !== 0x47)) continue;
    var end = i + 188;
    for (var j = i + 4; j + 4 < end; j++) {
      if (buf[j] !== 0 || buf[j + 1] !== 0 || buf[j + 2] !== 1) continue;
      var n = buf[j + 3], h264 = n & 0x1f, h265 = (n >> 1) & 0x3f;
      if ((h264 === 7 && !(n & 0x80)) || ((h265 === 32 || h265 === 33) && !(n & 0x81))) return i;
    }
  }
  return -1;
}

/* The presentation time (90 kHz) of the PES that the packet at i starts, or -1. */
function pesPts(b, i) {
  if (b[i] !== 0x47 || !(b[i + 1] & 0x40)) return -1;
  var p = i + 4;
  if (b[i + 3] & 0x20) p += 1 + b[i + 4];
  if (p + 14 > i + 188 || p + 14 > b.length || b[p] !== 0 || b[p + 1] !== 0 || b[p + 2] !== 1 || !(b[p + 7] & 0x80)) return -1;
  var x = p + 9;
  return ((b[x] >> 1) & 7) * 1073741824 + b[x + 1] * 4194304 + (b[x + 2] >> 1) * 32768 + b[x + 3] * 128 + (b[x + 4] >> 1);
}
// The latest presentation time in buf (whole packets, found by their sync bytes from the end), or -1.
function lastPts(b) {
  for (var i = b.length - 188; i >= 0; i--) {
    if (b[i] !== 0x47 || (i + 188 < b.length && b[i + 188] !== 0x47)) continue;
    var t = pesPts(b, i);
    if (t >= 0) return t;
  }
  return -1;
}

// A whole file (an HLS segment, a movie) rather than a live stream: it says how long it is, and isn't huge.
var SEGMENT_MAX = 64 * 1024 * 1024;

function create(opts) {
  var pace = Pace.create();            // image hosts that said 429 (pace.js)
  opts = opts || {};
  var stats = { requests: 0, errors: 0, active: 0 };
  var agentHttp = new http.Agent({ keepAlive: true, maxSockets: 16 });
  var agentHttps = new https.Agent({ keepAlive: true, maxSockets: 16 });
  var editor = Editor.create(log);      // web editor: LAN server is off until the app turns it on
  /* Live channels being relayed now, by account (liveKey).  When a new one starts, an older one on the same
     account that has gone quiet (nothing from the provider for 3 s, or still not answered) is let go first:
     a stalled stream the app is reconnecting, whose request the TV's browser hasn't closed yet.  Left open, it
     holds one of the provider's connections while the new one asks for another, and a provider that allows
     one or two answers "busy".  One still streaming is left alone: someone is watching it (a second window,
     another device on this helper), and the app closes its own when it zaps. */
  var liveOf = {};
  /* Where a live channel's tokenized address came from (a panel that answers /live/... with a redirect to an
     edge server): its account, and the address to ask again when the helper reconnects it (feed below). */
  var originOf = {}, originList = [];
  function rememberOrigin(next, o) { originOf[next] = o; originList.push(next); if (originList.length > 50) delete originOf[originList.shift()]; }

  /* The port this helper listens on.  server.address() is null once the server is closing (a restart), and a
     request still arriving then threw "Cannot read property 'port' of null" and took the helper down (issue #64). */
  var myPort = 0;
  function ownPort() { var a = server.address(); if (a && a.port) myPort = a.port; return myPort; }
  var server = http.createServer(function handle(req, res) {
    /* Only TiviBro itself (a file:// page: Origin "null"; tests on 127.0.0.1) and the TV's player (no Origin).  A web
       page opened in the TV's browser could otherwise use the relay to reach the home network through the TV and
       read the answers, or read the log; and a name made to point at 127.0.0.1 (DNS rebinding) is turned away by
       its Host. */
    if (req.body === undefined && (!sameHost(req.headers.host) || !ownOrigin(req.headers.origin))) {
      log({ lv: 'warn', event: 'refused a request from elsewhere', origin: String(req.headers.origin || '').slice(0, 80), host: String(req.headers.host || '').slice(0, 80), u: redact(req.url).slice(0, 120) });
      res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Not from TiviBro');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, ALLOW); return res.end(); }
    /* A POST through the relay: a DRM licence request (a DASH channel's #KODIPROP licence server, player.js).
       The body is small (a licence challenge): read it whole, then relay it like any request. */
    if (req.method === 'POST' && req.body === undefined && /^\/(?:ua|hd|x)\//.test(req.url)) {
      var chunks = [], size = 0;
      req.on('data', function (c) { size += c.length; if (size > 262144) { res.writeHead(413, ALLOW); res.end(); req.destroy(); return; } chunks.push(c); });
      req.on('end', function () { if (size > 262144) return; req.body = Buffer.concat(chunks); handle(req, res); });
      return;
    }
    if (req.url.indexOf('/media-stream/') === 0) return require('./media-stream').handle(req, res, ALLOW);
    // Converted sound (convert.js): the link carries its own key, since the TV's player can't send the secret.
    if (Convert.isStream(req.url)) return Convert.stream(req, res, ALLOW, log, ownPort(), redact);
    if (req.url === '/ping') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ ok: true, node: process.version, stats: stats, guide: 2, vod: 2, kv: 1, live: 1, convert: 1, sys: sys(), store: require('./storage').info() })); }
    /* The web editor and the phone app connection are switched on and off from TiviBro only.  On the
       TV the helper hands TiviBro a secret with its start reply (service.js, over luna, which only
       TiviBro may call); without it, a web page in the TV's browser could reach these over localhost. */
    // Stalker portals (stalker.js): the channel list with the secret like /live/; a channel's link and guide
    // without it, since the TV's player can't send one (they carry the login, and only reach the portal).
    if (req.url.indexOf('/stalker/') === 0 && req.method !== 'POST') return Stalker.handle(req, res, ALLOW, log, ownPort());
    var ctlRoute = req.url.indexOf('/stalker/') === 0 ? 'stalker' : req.url.indexOf('/editor/') === 0 ? 'editor' : req.url.indexOf('/companion/') === 0 ? 'companion' : req.url.indexOf('/kv/') === 0 ? 'kv' : req.url.indexOf('/live/') === 0 ? 'live' : req.url.indexOf('/media/') === 0 ? 'media' :
      req.url.indexOf('/convert/') === 0 ? 'convert' : req.url.indexOf('/ffmpeg/') === 0 ? 'ffmpeg' : req.url.indexOf('/net/dns') === 0 ? 'dns' : '';
    if (ctlRoute) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (opts.ctl && !sameText(req.headers['x-tivibro-ctl'], opts.ctl)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"not allowed"}'); }
      if (ctlRoute === 'editor') return editor.control(req, res, req.url.split('?')[0]);
      if (ctlRoute === 'kv') return Kv.handle(req, res, ALLOW, log);
      if (ctlRoute === 'live') return Live.handle(req, res, ALLOW, log, ownPort());
      if (ctlRoute === 'stalker') return Stalker.handle(req, res, ALLOW, log, ownPort());
      if (ctlRoute === 'dns') return require('./dns').handle(req, res, ALLOW, log);      // the DNS for providers (dns.js)
      if (ctlRoute === 'media') return Media.handle(req, res, ALLOW, log);
      if (ctlRoute === 'convert') return Convert.control(req, res, ALLOW, log, ownPort(), redact);
      if (ctlRoute === 'ffmpeg') return Ffmpeg.handle(req, res, ALLOW);
      if (!opts.companion) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no phone app connection in this helper"}'); }
      return opts.companion.control(req, res, req.url.split('?')[0]);
    }
    if (req.url.indexOf('/guide/') === 0) return Guide.handle(req, res, ALLOW, log);
    // An update's signature, checked before the app installs it (updatesig.js).
    if (req.url === '/update/verify' && req.method === 'POST') return require('./updatesig').handle(req, res, ALLOW);
    if (req.url.indexOf('/vod/') === 0) return Vod.handle(req, res, ALLOW, log, ownPort());
    if (req.url === '/log') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ALLOW)); return res.end(JSON.stringify({ node: process.version, stats: stats, log: LOG, earlier: EARLIER })); }
    var xm = /^\/xfer\/([A-Za-z0-9_-]{1,40})$/.exec(req.url);
    if (xm) { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, ALLOW)); return res.end(JSON.stringify(Unzip.progress(xm[1]) || { raw: 0, total: 0, done: false, unknown: true })); }
    // Optional prefixes, in this order: /ua/<base64url user agent>, /hd/<base64url Referer and Origin>, then /unz/<id> (unzip, see unzip.js).
    var ua = null, unz = null, path = req.url, prefix = '';
    var um = /^\/ua\/([A-Za-z0-9_-]+)(\/.*)$/.exec(path);
    if (um) { try { ua = Buffer.from(um[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { ua = null; } path = um[2]; prefix += '/ua/' + um[1]; }
    // /hd/<base64url JSON>: a channel's own Referer and Origin (an M3U line's "|Referer=...", issue #78).
    // H: a DRM licence server's own headers (#KODIPROP license_key "URL|X-Custom-Data=..."), by name, but never
    // the ones that steer the connection itself.
    var hd = null, hm = /^\/hd\/([A-Za-z0-9_-]{1,8000})(\/.*)$/.exec(path);
    if (hm) {
      try {
        var hj = JSON.parse(Buffer.from(hm[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); hd = {};
        ['Referer', 'Origin'].forEach(function (k) { if (typeof hj[k] === 'string' && /^https?:\/\//i.test(hj[k])) hd[k] = hj[k].slice(0, 500); });
        if (hj.H && typeof hj.H === 'object') Object.keys(hj.H).slice(0, 20).forEach(function (k) {
          if (/^[A-Za-z0-9-]{1,60}$/.test(k) && !/^(host|content-length|connection|transfer-encoding|te|trailer|upgrade|keep-alive|expect|range|accept-encoding|proxy-.*)$/i.test(k) && typeof hj.H[k] === 'string') hd[k] = hj.H[k].replace(/[\r\n]/g, '').slice(0, 4000);
        });
      } catch (e) { hd = null; }
      path = hm[2]; prefix += '/hd/' + hm[1];
    }
    var zm = /^\/unz\/([A-Za-z0-9_-]{1,40})(\/.*)$/.exec(path);
    if (zm) { unz = zm[1]; path = zm[2]; prefix += '/unz/' + unz; }
    var t = target(path);
    if (!t) { res.writeHead(404, ALLOW); return res.end('not a relay address'); }
    stats.requests++; stats.active++;
    var base = 'http://' + (req.headers.host || ('127.0.0.1:' + ownPort())) + prefix;
    var u = URL_.parse(t);
    var lib = u.protocol === 'https:' ? https : http;
    /* A live channel asked for "from the start" (the audio converter's reader sends Range: bytes=0-): a live
       stream has no start, and some providers refuse the Range (416).  Asked as the player asks, it is the live
       channel like any other. */
    if (/^bytes=0-$/i.test(req.headers.range || '') && liveKey(u)) delete req.headers.range;
    var headers = { 'User-Agent': ua || opts.userAgent || 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0 Safari/537.36', 'Accept': '*/*' };
    if (hd) Object.keys(hd).forEach(function (k) { headers[k] = hd[k]; });
    if (req.body) { headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream'; headers['Content-Length'] = req.body.length; }
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
      protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: req.method === 'HEAD' ? 'HEAD' : req.body ? 'POST' : 'GET',
      headers: headers, agent: u.protocol === 'https:' ? agentHttps : agentHttp, rejectUnauthorized: false,
      // Node 12.15 and newer (webOS 22 on) reject sloppy replies unless asked for the lenient parser:
      // stray control characters in headers, bare LF line endings.  Older Node ignores the option.
      // What even that refuses (Content-Length twice; control characters on Node 8) goes through
      // the forgiving reader in rawhttp.js instead, see onUpError.
      insecureHTTPParser: true, lookup: cachedLookup
    };
    var up = null, firstUp = null, triedRaw = false, reading = false, retried429 = false, busyTries = 0;
    // A live channel: let go of an older one on the same account, and give up on it sooner when it goes quiet.
    var og = originOf[t];
    var lk = req.method === 'GET' && !req.headers.range && !unz ? (liveKey(u) || (og && og.lk) || '') : '';
    var idle = lk ? (opts.liveTimeout || 15000) : (opts.timeout || 30000);
    function stale() { return Date.now() - (lastData || t0) > 3000; }
    function release() { aborted = true; rec.replaced = true; clearTimeout(feedTimer); if (up) up.destroy(); if (!res.headersSent) { res.writeHead(409, ALLOW); res.end(); } else res.destroy(); finish(); }
    if (lk) {
      var mine = { release: release, stale: stale }, list = liveOf[lk] || (liveOf[lk] = []);
      list.slice().forEach(function (o) { if (o.stale()) { rec.replacedOlder = (rec.replacedOlder || 0) + 1; o.release(); } });
      list.push(mine);
      var drop = function () { var l = liveOf[lk]; if (!l) return; var i = l.indexOf(mine); if (i >= 0) l.splice(i, 1); if (!l.length) delete liveOf[lk]; };
      res.on('close', drop); res.on('finish', drop);
    }
    // Images from a host that said "too many requests" wait their turn (pace.js, issue #45).
    var img = req.method !== 'HEAD' && pace.isImage(u.pathname), host = u.host;
    function send() {
      if (aborted) return finish();
      up = firstUp = lib.request(reqOpts, onResponse);
      up.setTimeout(idle, onTimeout);
      up.on('error', onUpError);
      up.end(req.body || undefined);
    }
    function onResponse(ur) {
      var code = ur.statusCode || 502;
      /* A live channel the provider says it's too busy for (503 and the like) right after another one: it is
         still counting the connection just let go, for a second or two.  Asked again here, quietly, for up to
         about 5 s, so the app gets its channel a moment later instead of "Connection dropped" over and over. */
      if (lk && !aborted && [429, 456, 458, 503, 509].indexOf(code) >= 0 && busyTries < 6 && Date.now() - t0 < 5000) {
        ur.resume();
        rec.busy = ++busyTries;
        setTimeout(function () { if (!aborted) send(); else finish(); }, [300, 500, 700, 900, 1200, 1500][busyTries - 1]);
        return;
      }
      // An image the host turned away for asking too often: wait as long as it asks, then ask once more.
      if (code === 429 && img && !retried429 && !aborted) {
        retried429 = true; ur.resume();
        rec.waited = pace.backoff(host, ur.headers['retry-after']);
        pace.wait(host, true, send);
        return;
      }
      /* A movie being read with Range (the TV's player always asks that way) goes quiet for as long as
         the viewer pauses: the player stops reading, so the provider stops sending.  That is not a dead
         server, and cutting it after 30 s made a paused movie fail on play (issue #34).  The player's
         own watchdog notices a provider that stops sending while it plays. */
      if (req.headers.range && (code === 200 || code === 206)) reading = true;
      rec.s = code; rec.ct = ur.headers['content-type'];
      rec.firstByteMs = Date.now() - t0;
      if (code >= 300 && code < 400 && ur.headers.location) {
        var next = URL_.resolve(t, ur.headers.location);
        rec.redirect = redact(next);
        if (lk) rememberOrigin(next, { lk: lk, url: og ? og.url : t });
        res.writeHead(code === 301 || code === 308 ? 307 : code, Object.assign({ Location: relayed(base, next) }, ALLOW));
        ur.resume(); res.end(); return finish();
      }
      var h = Object.assign({}, ALLOW);
      PASS.forEach(function (k) { if (ur.headers[k] != null) h[k] = ur.headers[k]; });
      if (code >= 400) rec.lv = 'error';
      var xfer = unz ? Unzip.track(unz, +ur.headers['content-length'] || 0) : null;
      ur.on('data', function (d) { bytes += d.length; lastData = Date.now(); if (xfer) xfer.raw = bytes; });
      ur.on('error', function (e) { if (feedSync) return; if (!aborted) { stats.errors++; rec.e = 'response: ' + (e.code || e.message); } finish(); res.destroy(); });
      // Live MPEG-TS: keep it aligned if stray bytes get in (see tssync.js).  Whole-file and Range
      // requests (movies, seeking) are left alone.
      // HLS segments say how long they are and come whole, aligned: those pass straight through, keeping their
      // length (resyncing them only cost the TV's CPU).
      var len = +ur.headers['content-length'] || 0;
      var ts = !unz && code === 200 && req.method !== 'HEAD' && !req.headers.range && !(len > 0 && len < SEGMENT_MAX) &&
        (/mp2t|mpegts|mpeg-ts/i.test(ur.headers['content-type'] || '') || /\.ts$/i.test((u.pathname || '')));
      if (ts && lk && !opts.noLiveFeed) { delete h['content-length']; res.writeHead(code, h); return feed(ur); }
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
    /* A live channel, kept going through trouble upstream (TiviMate's player does the same underneath).
       When the provider's connection ends, errs or goes quiet, the helper connects again by itself and carries
       on into the same response: the app sees a short gap in the data, which its buffer usually covers, not
       an ended stream it has to tear down and rebuild (losing its whole buffer).  TsSync realigns the packets
       where the two connections meet, and the app follows the timestamps if the provider restarted them.
       Up to 6 reconnects a minute, sooner first (0.25, 0.5, 1, 2, 3 s); if nothing comes for 12 s or the
       budget runs out, the response ends and the app reconnects itself, as before. */
    var feedTimes = [], feedSync = null, feedUr = null, feedFirst = null, feedDown = false, lastData = 0, feedTimer = 0, feedTries = 0;
    /* After a reconnect the new connection starts anywhere in the picture stream: what comes before its first
       keyframe (keyStart) is left out, so the app's decoder carries on from a picture it can show.  Not for
       ever: after 4 MB or 6 s without one (an encoder that doesn't send SPS with keyframes), everything passes. */
    var gate = null, tail = [], feedHold = null;
    function feed(first) {
      feedFirst = first;
      feedSync = new TsSync(function (n) { rec.tsDropped = (rec.tsDropped || 0) + n; if (!rec.lv) rec.lv = 'warn'; });
      feedSync.on('error', function () { res.destroy(); });
      feedHold = new FrameHold();
      feedHold.on('error', function () { res.destroy(); });
      feedSync.pipe(feedHold).pipe(res);
      feedSync.on('drain', function () { if (feedUr) feedUr.resume(); });
      lastData = Date.now();
      attach(first);
    }
    function attach(ur) {
      feedUr = ur; feedDown = false;
      ur.on('data', function (d) {
        if (feedUr !== ur || aborted) return;
        if (ur !== feedFirst) bytes += d.length;
        lastData = Date.now(); feedTries = 0;
        if (gate) {
          var buf = gate.held ? Buffer.concat([gate.held, d]) : d, k = keyStart(buf);
          /* A provider's new connection usually starts a few seconds back (its restreamer hands out a burst of
             the recent past): keyframes from before where the last connection left off are passed over too,
             so the stream carries on from the next new picture instead of repeating seconds. */
          while (k >= 0 && gate.last >= 0) {
            var pk = pesPts(buf, k), back = pk >= 0 ? gate.last - pk : 0;
            if (back > 8589934592 / 2) back -= 8589934592;
            if (pk < 0 || back <= 0.2 * 90000 || back > 30 * 90000) break;
            var nk = keyStart(buf.slice(k + 188));
            k = nk < 0 ? -1 : k + 188 + nk;
          }
          if (k < 0) {
            gate.n += d.length;
            if (gate.n < 4 * 1048576 && Date.now() - gate.t < 6000) { gate.held = buf.slice(Math.max(0, buf.length - 400)); return; }
            k = 0; rec.noKeyframe = true;
          }
          /* Carry on only if the new connection picks up where the last left off, later by up to two minutes
             (the time it was away).  Timestamps that went back, or leapt, mean the provider restarted the
             channel: then the response ends and the app starts it afresh, as it always did; appending them
             to what it has buffered makes the TV's decoder fail. */
          var now2 = pesPts(buf, k), d90 = gate.last >= 0 && now2 >= 0 ? now2 - gate.last : 0;
          if (d90 < -8589934592 / 2) d90 += 8589934592;               // the 33-bit clock wrapped
          if (gate.last >= 0 && now2 >= 0 && (d90 < -0.2 * 90000 || d90 > 120 * 90000)) {
            rec.e = 'live: the provider restarted the channel (timestamps ' + (d90 < 0 ? 'went back ' : 'leapt ') + Math.round(Math.abs(d90) / 90000) + ' s)'; rec.lv = 'warn';
            gate = null; feedDown = true; feedUr = null; try { up.destroy(); } catch (e) {}
            feedSync.end(); finish(); return;
          }
          rec.skippedToKeyframe = (rec.skippedToKeyframe || 0) + gate.n;
          gate = null; d = buf.slice(k);
        }
        tail = [tail[tail.length - 1], d];
        if (!feedSync.write(d)) ur.pause();
      });
      ur.on('end', function () { if (feedUr === ur) feedLost('ended'); });
      ur.on('error', function (e) { if (feedUr === ur) feedLost(e.code || e.message); });
    }
    function feedLost(why) {
      if (aborted || done || feedDown) return;
      feedDown = true; feedUr = null;
      try { if (up) up.destroy(); } catch (e) {}
      var now = Date.now();
      feedTimes = feedTimes.filter(function (x) { return now - x < 60000; });
      if (feedTimes.length >= 6 || now - lastData > (opts.liveGiveUp || 12000)) {
        rec.e = 'live: gave up reconnecting (' + why + ')'; rec.lv = 'warn';
        feedSync.end(); finish(); return;
      }
      feedTimes.push(now);
      rec.reconnects = (rec.reconnects || 0) + 1; rec.lastLoss = why;
      // The frame that was coming in when it broke is incomplete: not sent on (see FrameHold).  What TsSync still
      // holds of a half packet goes too.
      if (feedSync) feedSync.carry = null;
      if (feedHold) rec.halfFrames = (rec.halfFrames || 0) + (feedHold.drop() ? 1 : 0);
      var wait = [250, 500, 1000, 2000, 3000][Math.min(feedTries, 4)];
      feedTries++;
      clearTimeout(feedTimer);
      feedTimer = setTimeout(function () { if (!aborted && !done) again(og ? og.url : t, 0); }, wait);
    }
    // Ask the provider again (following its redirects here: the app has its answer already).
    function again(addr, hops) {
      var uu = URL_.parse(addr), l2 = uu.protocol === 'https:' ? https : http;
      var o2 = Object.assign({}, reqOpts, { protocol: uu.protocol, hostname: uu.hostname, port: uu.port, path: uu.path, agent: uu.protocol === 'https:' ? agentHttps : agentHttp });
      var r2 = up = l2.request(o2, function (ur) {
        var c = ur.statusCode || 0;
        if (c >= 300 && c < 400 && ur.headers.location && hops < 3) { ur.resume(); return again(URL_.resolve(addr, ur.headers.location), hops + 1); }
        if (c !== 200) { ur.resume(); return feedLost('HTTP ' + c); }
        if (aborted || done) { ur.resume(); r2.destroy(); return; }
        var tb = tail.filter(Boolean);
        gate = { n: 0, t: Date.now(), held: null, last: tb.length ? lastPts(tb.length > 1 ? Buffer.concat(tb) : tb[0]) : -1 };
        attach(ur);
      });
      r2.setTimeout(idle, function () { r2.destroy(new Error('quiet')); });
      r2.on('error', function (e) { if (up === r2) feedLost(e.code || e.message); });
      r2.end();
    }
    function onTimeout() { if (!reading) up.destroy(new Error('upstream timeout')); }
    function onUpError(e) {
      // Feeding a live channel: only the request in use now counts (an earlier one let go errs late).
      if (feedSync) { if (!aborted && up === firstUp) feedLost(e.code || e.message); return; }
      // Node's parser refused the reply: ask again with the forgiving reader.
      if (!aborted && !triedRaw && !res.headersSent && /^HPE_/.test(e.code || '')) {
        triedRaw = true; rec.lenient = e.code;
        up = firstUp = RawHttp.request(reqOpts, onResponse);
        up.setTimeout(idle, onTimeout);
        up.on('error', onUpError);
        return;
      }
      // Node's parser errors (HPE_INVALID_CONSTANT, "Expected HTTP/"): the provider's server sent something that
      // wasn't an HTTP reply.  Said plainly in the log, with the code kept for anyone looking it up (issue #57).
      if (!aborted) { stats.errors++; rec.e = /^HPE_/.test(e.code || '') ? 'the provider\'s server sent a broken reply (not HTTP; ' + e.code + ')' : (e.code ? e.code + ' ' : '') + e.message; }
      if (!aborted && /^(ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET)$/.test(e.code || '')) forgetHost(u.hostname);
      finish();
      if (!res.headersSent) { res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, ALLOW)); res.end('relay error: ' + e.message); }
      else res.destroy();
    }
    // Viewer zapped away: stop pulling the stream from the provider at once.
    /* The player hanging up.  A POST's request was read whole before (a licence request), and newer Node
       says 'close' for it then: the answer's connection is what tells. */
    (req.body ? res : req).on('close', function () { if (!res.writableEnded && !res.finished) { aborted = true; clearTimeout(feedTimer); if (up) up.destroy(); } finish(); });
    var held = pace.wait(host, img, send);
    if (held) rec.paced = held;
  });
  server.keepAliveTimeout = 30000;
  server.on('listening', ownPort);
  server.on('close', function () { editor.stop(); });
  return { server: server, stats: stats, editor: editor };
}

module.exports = { _ownOrigin: ownOrigin, _sameHost: sameHost, SYS: SYS, sys: sys, create: create, target: target, liveKey: liveKey, keyStart: keyStart, pesPts: pesPts, lastPts: lastPts, relayed: relayed, rewriteHls: rewriteHls, log: log, redact: redact, LOG: LOG,
  _dns: { lookup: cachedLookup, cache: dnsCache, forget: forgetHost } };
