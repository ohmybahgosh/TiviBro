/* What a stream's server hands out on its first answer and expects back on the next ones (issue #202: Jio's
   channels, whose video pieces came back "not available").  A player like TiviMate's keeps both; the helper does
   it for the TV, which can't (the browser keeps no cookies for the helper's addresses, and dash.js drops a
   manifest link's query when it works out its pieces' links):
     cookies   a Set-Cookie on a stream's manifest goes back with the later requests to that host (and, with a
               Domain, the hosts under it), for 30 minutes, but never to a provider's API or portal;
     tokens    a manifest (.mpd, .m3u8) asked for with a CDN token in its query (Akamai's __hdnea__, hdntl, hdnts
               and the like) passes that query on to the requests for the same host and folder that carry none.
   Kept in memory only, for at most 200 hosts, never written anywhere or logged.  Plain ES5 (Node 0.12). */
'use strict';
var TTL = 30 * 60000, MAX = 200;
var jar = {}, tokens = {};
var TOKEN = /(^|&)(__hdnea__|hdnea|hdntl|hdnts|__token__|hdnts|token|auth|wmsAuthSign|st|e|md5)=/i;
var STRONG = /(^|&)(__hdnea__|hdnea|hdntl|hdnts|__token__|wmsAuthSign)=/i;

function prune(o) {
  var keys = Object.keys(o), now = Date.now();
  keys.forEach(function (k) { if (now - o[k].at > TTL) delete o[k]; });
  keys = Object.keys(o);
  if (keys.length > MAX) keys.sort(function (a, b) { return o[a].at - o[b].at; }).slice(0, keys.length - MAX).forEach(function (k) { delete o[k]; });
}
function hostOf(h) { return String(h || '').toLowerCase().replace(/:\d+$/, ''); }

// The cookies a response sets: name=value, kept under its Domain (without the dot) or the host that sent it.
function remember(host, setCookie) {
  if (!setCookie) return;
  host = hostOf(host);
  [].concat(setCookie).forEach(function (c) {
    var parts = String(c).split(';'), nv = parts[0].trim(), eq = nv.indexOf('=');
    if (eq <= 0 || nv.length > 4096) return;
    var dom = host;
    parts.slice(1).forEach(function (p) { var m = /^\s*domain\s*=\s*\.?([^;\s]+)/i.exec(p); if (m) dom = m[1].toLowerCase(); });
    // A Domain must be the host itself or one it's under (a server can't set cookies for someone else).
    if (dom !== host && host.slice(-dom.length - 1) !== '.' + dom) dom = host;
    var expired = parts.slice(1).some(function (p) { return /^\s*max-age\s*=\s*0/i.test(p); });
    var e = jar[dom] || (jar[dom] = { at: 0, c: {} });
    if (expired) delete e.c[nv.slice(0, eq)]; else e.c[nv.slice(0, eq)] = nv.slice(eq + 1);
    e.at = Date.now();
  });
  prune(jar);
}
// The Cookie header for a request to host, joined with one the playlist gave (its own come first).
function cookieFor(host, own) {
  host = hostOf(host);
  var out = [], seen = {};
  String(own || '').split(';').forEach(function (p) { var n = p.split('=')[0].trim(); if (n) { seen[n] = 1; out.push(p.trim()); } });
  Object.keys(jar).forEach(function (d) {
    if (d !== host && host.slice(-d.length - 1) !== '.' + d) return;
    var c = jar[d].c;
    Object.keys(c).forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n + '=' + c[n]); } });
  });
  return out.join('; ');
}

// The folder of a path: "/bpk-tv/Star/WDVLive/dash/" for ".../dash/index.mpd".
function folder(p) { var q = String(p || '').split('?')[0]; return q.slice(0, q.lastIndexOf('/') + 1); }
/* A request: a manifest with a token in its query is remembered; a piece of the same host and folder (or a folder
   under it) without a query gets that query.  Returns the path to ask for (path: "/a/b.dash?x=1"). */
function pathFor(host, path) {
  host = hostOf(host);
  var i = path.indexOf('?'), q = i < 0 ? '' : path.slice(i + 1), bare = i < 0 ? path : path.slice(0, i);
  if (/\.(mpd|m3u8)$/i.test(bare)) {
    if (q && STRONG.test(q)) { tokens[host + '|' + folder(bare)] = { at: Date.now(), q: q, dir: folder(bare) }; prune(tokens); }
    return path;
  }
  if (q && TOKEN.test(q)) return path;
  var best = null;
  Object.keys(tokens).forEach(function (k) {
    var t = tokens[k];
    if (k.indexOf(host + '|') !== 0 || bare.indexOf(t.dir) !== 0) return;
    if (!best || t.dir.length > best.dir.length) best = t;
  });
  if (!best) return path;
  best.at = Date.now();
  return bare + '?' + (q ? q + '&' : '') + best.q;
}
// A stream's manifest, by its path or its type: the only answers whose cookies are kept.
function isManifest(path, type) { return /\.(mpd|m3u8)$/i.test(String(path || '')) || /dash\+xml|mpegurl/i.test(String(type || '')); }
// A provider's API, a portal or a guide: never sent kept cookies (one account's session isn't another's).
function api(path) { return /player_api\.php|get\.php|xmltv\.php|portal\.php|\/c\/|stalker_portal|\/server\/load\.php/i.test(String(path || '')); }
function reset() { jar = {}; tokens = {}; }
module.exports = { remember: remember, cookieFor: cookieFor, pathFor: pathFor, isManifest: isManifest, api: api, _reset: reset };
