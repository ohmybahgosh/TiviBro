/* Plex through the helper.  The TV app's page can't reach plex.tv or a Plex Media Server itself (no CORS for a
   file:// app, and old TVs' certificate lists), so app/js/plex.js asks here:
     POST /media/plex { op: 'pin', cid }                         -> { id, code, expires }  the plex.tv/link code
     POST /media/plex { op: 'poll', cid, id }                    -> { token } once signed in, { pending: true } until then
     POST /media/plex { op: 'user', cid, token }                 -> { user }  who is signed in, and whether they have Plex Pass
     POST /media/plex { op: 'servers', cid, token }              -> { servers }  owned and shared, with their connections
     POST /media/plex { op: 'pick', cid, server }                -> { uri, local, relay }  the first connection that answers
     POST /media/plex { op: 'home', cid, token }                 -> { users }  Plex Home people
     POST /media/plex { op: 'switch', cid, token, uuid, pin }    -> { token, user }  sign in as another Plex Home person
     POST /media/plex { op: 'get'|'put'|'post'|'delete', cid, base, path, token } -> { status, data }  a server call
     POST /media/plex { op: 'door', cid, base, token }          -> { key }  a door for pictures and video (below)
     GET  /plex/<key>/<path>                                     pictures (/photo/:/transcode) and video (a part's
                                                                file, the converter's playlist and pieces) from that
                                                                server, Range passed on; the TV's img and video tags
                                                                can't send the token, so it stays here.
   cid is the TV's own X-Plex-Client-Identifier (made once by the app).  Only plex.tv, and only servers on a home
   network address or a plex.direct name, are ever called, and only the server paths in SERVER_PATHS.  Tokens and
   PINs pass through and are never logged (media.js logs the op alone).  ES5 / Node 0.12. */
'use strict';
require('./compat');
var http = require('http');
var https = require('https');
var URL = require('url');
var CA = require('./media-ca');

var PLEX_TV = 'https://clients.plex.tv';
var LOOPBACK = false;   // tests only: lets the mock server on 127.0.0.1 stand in for a home server
var VERSION = '0.6.0';
try { VERSION = require('../package.json').version; } catch (e) {}

// Server paths TiviBro uses (official API, developer.plex.tv/pms), and the methods each may use.
var SERVER_PATHS = [
  [/^\/identity$/, 'GET'],
  [/^\/library\/sections(\/[0-9]+(\/(all|filters|sorts|collections|firstCharacter|autocomplete|categories|genre|year|decade|contentRating))?)?$/, 'GET'],
  [/^\/library\/metadata\/[0-9]+(\/(children|allLeaves|extras|related|similar|grandchildren))?$/, 'GET'],
  [/^\/library\/collections\/[0-9]+(\/children)?$/, 'GET'],
  [/^\/library\/parts\/[0-9]+$/, 'PUT'],
  [/^\/library\/parts\/[0-9]+\/indexes\/sd$/, 'GET'],
  [/^\/library\/streams\/[0-9]+$/, 'GET'],
  [/^\/library\/metadata\/[0-9]+\/subtitles$/, 'GET|PUT'],
  [/^\/hubs(\/(continueWatching|promoted|search|sections\/[0-9]+|metadata\/[0-9]+\/related))?$/, 'GET'],
  [/^\/playlists(\/[0-9]+(\/items)?)?$/, 'GET'],
  [/^\/playlists\/[0-9]+\/items(\/[0-9]+(\/move)?)?$/, 'PUT|DELETE'],
  [/^\/:\/(timeline|scrobble|unscrobble|rate)$/, 'GET|PUT|POST'],
  [/^\/actions\/removeFromContinueWatching$/, 'PUT'],
  [/^\/video\/:\/transcode\/universal\/(decision|ping|stop)$/, 'GET'],
  [/^\/photo\/:\/transcode$/, 'GET']
];

/* The headers Plex asks every app to send.  cid must be the TV's own id; the name is the TV's (shown in Plex's
   dashboard as the player). */
function headers(q) {
  var h = {
    Accept: 'application/json',
    'X-Plex-Product': 'TiviBro',
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': q.cid,
    'X-Plex-Platform': 'webOS',
    'X-Plex-Device': 'LG TV',
    'X-Plex-Device-Name': cleanName(q.name) || 'TiviBro',
    'X-Plex-Provides': 'player'
  };
  if (q.token) h['X-Plex-Token'] = q.token;
  return h;
}
function cleanName(v) { return v == null ? '' : String(v).replace(/[^\w .'()-]/g, '').slice(0, 64); }
function validCid(v) { return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v); }
function validToken(v) { return typeof v === 'string' && /^[A-Za-z0-9_.~-]{8,4096}$/.test(v); }

/* One HTTP(S) call.  A certificate the TV's own list can't check gets one more try against media-ca.js (still
   checked, never skipped).  The X-TiviBro-Quick header (not sent) asks for a 3 s limit instead of 20 s.
   cb(err, { status, json, text }).  Answers over 16 MB are refused. */
function call(method, url, h, body, cb, tried) {
  var ms = h['X-TiviBro-Quick'] ? 3000 : 20000;
  delete h['X-TiviBro-Quick'];
  var u = URL.parse(url), lib = u.protocol === 'http:' ? http : https, done = false, data = body != null ? JSON.stringify(body) : null;
  var opts = { hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h };
  if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
  if (tried && lib === https) opts.ca = CA;
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var req = lib.request(opts, function (res) { collect(req, res, finish); });
  req.on('error', function (e) {
    if (!tried && lib === https && certError(e)) { done = true; if (ms < 20000) h['X-TiviBro-Quick'] = '1'; return call(method, url, h, body, cb, true); }
    finish(e);
  });
  req.setTimeout(ms, function () { req.abort(); finish(new Error('timeout')); });
  if (data) req.write(data);
  req.end();
}
function certError(e) { var c = (e && e.code) || ''; return /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(c); }

// Reads an answer, at most 16 MB, as JSON when it is JSON.
function collect(req, res, finish) {
  var chunks = [], n = 0;
  res.on('data', function (b) { n += b.length; if (n > 16e6) { req.abort(); return finish(new Error('too much')); } chunks.push(b); });
  res.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8'), json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    finish(null, { status: res.statusCode, json: json, text: json ? null : text.slice(0, 2000) });
  });
  res.on('error', finish);
}

// A failure the app can show: login (sign in again), unreachable, or plex (Plex said no).
function failure(kind, status) { return { error: kind, status: status || 0 }; }
function fromStatus(r) { return r.status === 401 || r.status === 403 ? failure('login', r.status) : failure('plex', r.status); }
function plexTv(method, path, q, body, cb) {
  call(method, PLEX_TV + path, headers(q), body, function (e, r) {
    if (e) return cb(failure('unreachable'));
    if (r.status >= 400) return cb(fromStatus(r));
    cb(null, r.json || {});
  });
}

/* plex.tv/link: a 4-character code (strong=false) the user types at plex.tv/link while signed in. */
function pin(q, cb) {
  plexTv('POST', '/api/v2/pins?strong=false', q, null, function (f, j) {
    if (f) return cb(f);
    cb({ id: j.id, code: j.code, expires: Date.parse(j.expiresAt) || Date.now() + 15 * 60000 });
  });
}
function poll(q, cb) {
  if (!/^[0-9]{1,15}$/.test(String(q.id))) return cb(failure('bad'));
  plexTv('GET', '/api/v2/pins/' + q.id, q, null, function (f, j) {
    if (f) return cb(f);
    cb(j.authToken ? { token: j.authToken } : { pending: true, expires: Date.parse(j.expiresAt) || 0 });
  });
}

/* Who is signed in: name, picture, and Plex Pass (which decides playing away from home). */
function user(q, cb) {
  plexTv('GET', '/api/v2/user', q, null, function (f, j) {
    if (f) return cb(f);
    var sub = j.subscription || {};
    cb({ user: { uuid: j.uuid, name: j.username || j.title || '', thumb: j.thumb || '', pass: !!sub.active, home: !!j.home, admin: !!j.homeAdmin, restricted: !!j.restricted } });
  });
}

/* The servers this account can use (resources that provide "server"), each with its own token and connections. */
function servers(q, cb) {
  plexTv('GET', '/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1', q, null, function (f, j) {
    if (f) return cb(f);
    var list = (Array.isArray(j) ? j : []).filter(function (r) { return String(r.provides || '').split(',').indexOf('server') >= 0; });
    cb({ servers: list.map(serverOf) });
  });
}
function serverOf(r) {
  return {
    id: r.clientIdentifier, name: r.name || '', owned: !!r.owned, home: !!r.home, token: r.accessToken || '',
    version: r.productVersion || '', online: !!r.presence, httpsRequired: !!r.httpsRequired,
    connections: (r.connections || []).map(function (c) { return { uri: c.uri, address: c.address, port: c.port, protocol: c.protocol, local: !!c.local, relay: !!c.relay }; })
  };
}

/* Tries a server's connections in the order Plex users expect (on the network, then remote, relay last), a few
   seconds each, and answers with the first whose /identity is this server.  Local ones are also tried as plain
   http when the server allows it, since old TVs can't check plex.direct certificates. */
function pick(q, cb) {
  var s = q.server || {}, tries = order(s), i = 0;
  if (!validToken(s.token) || !tries.length) return cb(failure('bad'));
  (function next() {
    if (i >= tries.length) return cb(failure('unreachable'));
    var t = tries[i++];
    if (!allowedBase(t.uri)) return next();
    var h = headers({ cid: q.cid, token: s.token, name: q.name }); h['X-TiviBro-Quick'] = '1';
    call('GET', t.uri + '/identity', h, null, function (e, r) {
      var mc = r && r.json && r.json.MediaContainer;
      if (e || !mc || (s.id && mc.machineIdentifier !== s.id)) return next();
      cb({ uri: t.uri, local: t.local, relay: t.relay });
    });
  })();
}
function order(s) {
  var c = (s.connections || []).filter(function (x) { return x && typeof x.uri === 'string'; }), out = [];
  c.filter(function (x) { return x.local && !x.relay; }).forEach(function (x) {
    out.push(x);
    if (!s.httpsRequired && x.address && x.port) out.push({ uri: 'http://' + x.address + ':' + x.port, local: true, relay: false });
  });
  c.filter(function (x) { return !x.local && !x.relay; }).forEach(function (x) { out.push(x); });
  c.filter(function (x) { return x.relay; }).forEach(function (x) { out.push(x); });
  return out;
}

/* Only a server on a home network address, or a plex.direct name (Plex's own secure names), may be called. */
function allowedBase(uri) {
  var u = URL.parse(String(uri || ''));
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || (u.path && u.path !== '/')) return false;
  var host = u.hostname.toLowerCase();
  return /\.plex\.direct$/.test(host) || homeAddress(host);
}
function homeAddress(h) {
  var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) { var a = +m[1], b = +m[2]; return a === 10 || (LOOPBACK && a === 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
  h = h.replace(/^\[|\]$/g, '');
  return /^(fe80:|fc|fd)/.test(h);
}
function allowedPath(method, path) {
  var p = String(path || '').split('?')[0];
  if (/(^|\/)\.\.?(\/|$)|%2e|%2f/i.test(p)) return false;
  return SERVER_PATHS.some(function (x) { return x[0].test(p) && x[1].split('|').indexOf(method) >= 0; });
}

/* A call to the user's server, on an allowed path. */
function server(q, cb) {
  var method = String(q.op).toUpperCase(), path = String(q.path || '');
  if (!allowedBase(q.base) || !allowedPath(method, path) || !validToken(q.token)) return cb(failure('bad'));
  call(method, String(q.base).replace(/\/$/, '') + path, headers(q), null, function (e, r) {
    if (e) return cb(failure('unreachable'));
    if (r.status >= 400) return cb(fromStatus(r));
    cb({ status: r.status, data: r.json });
  });
}

/* Plex Home: the people, and signing in as one (with their PIN when they have one). */
function home(q, cb) {
  plexTv('GET', '/api/v2/home/users', q, null, function (f, j) {
    if (f) return cb(f);
    cb({ users: (j.users || []).map(function (u) { return { uuid: u.uuid, name: u.title || u.username || '', thumb: u.thumb || '', admin: !!u.admin, pin: !!u.protected, restricted: !!u.restricted }; }) });
  });
}
function switchUser(q, cb) {
  if (!/^[A-Za-z0-9-]{4,64}$/.test(String(q.uuid))) return cb(failure('bad'));
  var pinPart = q.pin != null && /^[0-9]{4}$/.test(String(q.pin)) ? '?pin=' + q.pin : '';
  plexTv('POST', '/api/v2/home/users/' + q.uuid + '/switch' + pinPart, q, null, function (f, j) {
    if (f) return cb(f.status === 403 || f.status === 401 ? failure('pin', f.status) : f);
    cb(j.authToken ? { token: j.authToken } : failure('plex'));
  });
}

/* ---------- Doors: pictures and video by a random key, the token kept here ---------- */
var crypto = require('crypto');
var doors = {}, DOOR_TTL = 24 * 3600000, DOOR_MAX = 16;
var DOOR_PATHS = /^\/(photo\/:\/transcode\?|library\/parts\/[0-9]+\/[0-9]+\/[^/?]+|library\/parts\/[0-9]+\/indexes\/sd\/[0-9]+|library\/streams\/[0-9]+|video\/:\/transcode\/universal\/(start\.m3u8|session\/[A-Za-z0-9-]+\/[A-Za-z0-9_/.-]+)|library\/metadata\/[0-9]+\/(thumb|art|clearLogo|theme)\/[0-9]+)/;
// A door to one server (same server and token: the same door), oldest let go past 16.
function door(q, cb) {
  if (!allowedBase(q.base) || !validToken(q.token)) return cb(failure('bad'));
  var base = String(q.base).replace(/\/$/, ''), now = Date.now(), have = null;
  Object.keys(doors).forEach(function (k) { if (doors[k].until < now) delete doors[k]; else if (doors[k].base === base && doors[k].token === q.token) have = k; });
  if (have) { doors[have].until = now + DOOR_TTL; return cb({ key: have }); }
  var keys = Object.keys(doors).sort(function (a, b) { return doors[a].until - doors[b].until; });
  while (keys.length >= DOOR_MAX) delete doors[keys.shift()];
  var key = crypto.randomBytes(24).toString('hex');
  doors[key] = { base: base, token: q.token, cid: q.cid, until: now + DOOR_TTL };
  cb({ key: key });
}
/* GET /plex/<key>/<path>: passed on to the server with the token in a header, the answer streamed back as it comes
   (Range for seeking).  Only the picture and video paths in DOOR_PATHS. */
function doorGet(req, res, ALLOW) {
  var m = /^\/plex\/([0-9a-f]{48})(\/.*)$/.exec(req.url), d = m && doors[m[1]];
  if (!d || d.until < Date.now() || !DOOR_PATHS.test(m[2]) || /(^|\/)\.\.?(\/|\?|$)|%2e%2e/i.test(m[2])) { res.writeHead(404, ALLOW); return res.end(); }
  var u = URL.parse(d.base + m[2]), lib = u.protocol === 'http:' ? http : https;
  var h = headers({ cid: d.cid, token: d.token }); delete h.Accept;
  if (req.headers.range) h.Range = req.headers.range;
  var out = lib.request({ hostname: u.hostname, port: u.port, path: u.path, method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: h }, function (up) {
    var head = {}; ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag'].forEach(function (k) { if (up.headers[k] != null) head[k] = up.headers[k]; });
    res.writeHead(up.statusCode, Object.assign(head, ALLOW));
    up.pipe(res);
  });
  out.on('error', function () { if (!res.headersSent) res.writeHead(502, ALLOW); res.end(); });
  req.on('close', function () { out.abort(); });
  out.end();
}
function isDoor(url) { return String(url || '').indexOf('/plex/') === 0; }

var OPS = { door: door, pin: pin, poll: poll, user: user, servers: servers, pick: pick, home: home, 'switch': switchUser, get: server, put: server, post: server, 'delete': server };

/* The /media/plex route: checks the TV id and the token shape, then runs the op. */
function handle(q, cb) {
  if (!q || !Object.prototype.hasOwnProperty.call(OPS, q.op)) return cb(failure('bad'));
  if (!validCid(q.cid)) return cb(failure('bad'));
  if (q.op !== 'pin' && q.op !== 'poll' && q.op !== 'pick' && !validToken(q.token)) return cb(failure('bad'));
  OPS[q.op](q, cb);
}

module.exports = { handle: handle, isDoor: isDoor, doorGet: doorGet, _test: { allowedBase: allowedBase, allowedPath: allowedPath, order: order, setPlexTv: function (u) { PLEX_TV = u; }, loopback: function (on) { LOOPBACK = !!on; } } };
