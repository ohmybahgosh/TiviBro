/* Stalker (Ministra) portals: the "MAC address" logins of MAG boxes (discussion #60).
   The portal wants a box: a MAG User-Agent, its MAC in a cookie, a token from a handshake.  A browser can't
   send those, so the helper talks to the portal and hands the app channels in the same shape as an M3U list.

   Routes (127.0.0.1 only):
     POST /stalker/channels   { stb: <the login, below> }  (with TiviBro's secret, like /live/)
       -> { groups, channels, portal }   each channel's url is "stalker:<cmd>"
     GET  /stalker/play/<id>.<ext>?stb=<login>&cmd=<cmd>
       -> 302 to the stream, through the relay with the box's User-Agent: the portal makes a fresh link
          (create_link) every time a channel starts, as a box does.
     GET  /stalker/epg?stb=<login>&ch=<channel id>&limit=<n>
       -> the next programmes, in Xtream's get_short_epg shape (epg.js reads it as it is).
   <login> is base64url JSON { portal, mac, sn, id1, id2, sig }: the portal address and the box's MAC,
   with the serial and device ids some portals check.  Logs never carry it (proxy.js and log.js redact
   "stb=").  Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), https = require('https'), URL_ = require('url'), crypto = require('crypto');

var UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
var BODY_MAX = 16 * 1024, TEXT_MAX = 200 * 1024 * 1024;

function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
function b64urlJSON(s) {
  try { return JSON.parse(buf(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; }
}
function err(msg, auth) { var e = new Error(msg); if (auth) e.auth = true; return e; }
function buf(s, enc) { return Buffer.from(s, enc); }      // compat.js gives Node 0.12 Buffer.from
function hex(alg, s) { return crypto.createHash(alg).update(String(s)).digest('hex').toUpperCase(); }

/* The login, checked: a portal address and a MAC like 00:1A:79:12:34:56.  The serial and device ids a box
   would send are made from the MAC when the playlist doesn't give them, the way most players do. */
function login(o) {
  if (!o || typeof o !== 'object') return null;
  var portal = String(o.portal || '').trim(), mac = String(o.mac || '').trim().toUpperCase().replace(/-/g, ':');
  if (!/^https?:\/\/[^\s]+$/i.test(portal) || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return null;
  return {
    portal: portal.replace(/\/+$/, ''), mac: mac,
    sn: String(o.sn || hex('md5', mac).slice(0, 13)), id1: String(o.id1 || hex('sha256', mac)), id2: String(o.id2 || o.id1 || hex('sha256', mac)),
    sig: String(o.sig || hex('sha256', mac + (o.sn || ''))), tz: String(o.tz || 'UTC')
  };
}
/* Where the portal answers: "http://host/c/" is the box's address for "http://host/server/load.php";
   others answer at /portal.php or /stalker_portal/server/load.php. */
function apis(portal) {
  var m = /^(.*?)\/c\/?$/.exec(portal), base = m ? m[1] : portal.replace(/\/(?:portal\.php|server\/load\.php)$/, '');
  if (/\/(?:portal\.php|server\/load\.php)$/.test(portal)) return [portal];
  var out = [base + '/server/load.php', base + '/portal.php', base + '/stalker_portal/server/load.php'];
  if (/\/stalker_portal$/.test(base)) out.unshift(base + '/server/load.php');
  return out.filter(function (u, i) { return out.indexOf(u) === i; });
}

function headersFor(L, s) {
  var h = { 'User-Agent': UA, 'X-User-Agent': 'Model: MAG250; Link: WiFi', 'Accept': '*/*',
    'Cookie': 'mac=' + encodeURIComponent(L.mac) + '; stb_lang=en; timezone=' + encodeURIComponent(L.tz),
    'Referer': (s && s.api ? s.api.replace(/\/(?:server\/load\.php|portal\.php)$/, '') : L.portal) + '/c/' };
  if (s && s.token) h.Authorization = 'Bearer ' + s.token;
  return h;
}
function get(url, headers, cb) {
  var done = false, finish = function (e, t, code) { if (!done) { done = true; cb(e, t, code); } };
  var u = URL_.parse(url), lib = u.protocol === 'https:' ? https : http;
  var req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: 'GET', headers: headers, rejectUnauthorized: false }, function (res) {
    var parts = [], size = 0;
    res.on('data', function (c) { size += c.length; if (size > TEXT_MAX) { req.abort(); return finish(new Error('too big')); } parts.push(c); });
    res.on('end', function () { finish(null, Buffer.concat(parts, size).toString('utf8'), res.statusCode); });
    res.on('error', finish);
  });
  req.on('error', finish);
  req.setTimeout(30000, function () { req.abort(); finish(new Error('timed out')); });
  req.end();
}
// The portal's answer to one action: its "js" part, or an error saying what went wrong.
function call(L, s, params, cb) {
  var q = []; for (var k in params) q.push(k + '=' + encodeURIComponent(params[k]));
  get(s.api + '?' + q.join('&') + '&JsHttpRequest=1-xml', headersFor(L, s), function (e, t, code) {
    if (e) return cb(e);
    if (code === 401 || code === 403) return cb(err('the portal refused this box (HTTP ' + code + ')', true));
    if (code !== 200) return cb(new Error('the portal answered HTTP ' + code));
    var j; try { j = JSON.parse(t); } catch (x) { return cb(err(/authoriz/i.test(t) ? 'the portal refused this box' : 'the portal did not answer like a Stalker portal', /authoriz/i.test(t))); }
    if (j && j.js === undefined && /authoriz/i.test(t)) return cb(err('the portal refused this box', true));
    cb(null, j && j.js !== undefined ? j.js : j);
  });
}

/* A session per portal and MAC: the handshake's token, then get_profile (which many portals need before
   anything else).  Kept 30 minutes, made again when the portal stops taking it. */
var sessions = {}, SESSION_FOR = 30 * 60000;
function keyOf(L) { return L.portal + '|' + L.mac; }
function session(L, fresh, cb) {
  var k = keyOf(L), s = sessions[k];
  if (s && !fresh && Date.now() - s.at < SESSION_FOR) return cb(null, s);
  var list = s && s.api ? [s.api] : apis(L.portal), i = 0, lastErr = null;
  (function next() {
    if (i >= list.length) return cb(lastErr || new Error('no Stalker portal at that address'));
    var t = { api: list[i++], token: '', at: Date.now() };
    call(L, t, { type: 'stb', action: 'handshake', token: '', prehash: '' }, function (e, js) {
      if (e || !js || !js.token) { lastErr = e || new Error('the portal gave no token'); return next(); }
      t.token = String(js.token);
      call(L, t, { type: 'stb', action: 'get_profile', hd: 1, ver: 'ImageDescription: 0.2.18-r23-250; ImageDate: Wed Aug 29 10:49:53 EEST 2018; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c',
        num_banks: 2, sn: L.sn, stb_type: 'MAG250', client_type: 'STB', image_version: 218, video_out: 'hdmi', device_id: L.id1, device_id2: L.id2, signature: L.sig,
        auth_second_step: 1, hw_version: '1.7-BD-00', not_valid_token: 0, api_signature: 262, timestamp: Math.floor(Date.now() / 1000) }, function (e2, prof) {
        if (e2 && e2.auth) return cb(e2);
        if (prof && (prof.status === 2 || /block|disabled|expired/i.test(String(prof.msg || '')))) return cb(err('the portal says this box is not allowed' + (prof.msg ? ': ' + String(prof.msg).slice(0, 120) : ''), true));
        sessions[k] = t;
        cb(null, t);
      });
    });
  })();
}
// An action, with the session made again once when the portal stopped taking the old token.
function act(L, params, cb) {
  session(L, false, function (e, s) {
    if (e) return cb(e);
    call(L, s, params, function (e2, js) {
      if (!e2 || !e2.auth) return cb(e2, js);
      session(L, true, function (e3, s2) { if (e3) return cb(e3); call(L, s2, params, cb); });
    });
  });
}

// A box command ("ffmpeg http://host/ch/123", sometimes "auto http://...") to the address in it.
function linkOf(cmd) { var m = /(https?:\/\/\S+)/i.exec(String(cmd || '')); return m ? m[1] : ''; }
function hash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

/* Channels: every channel (get_all_channels, or page by page with get_ordered_list on portals without it),
   in groups from get_genres. */
function channels(L, cb) {
  act(L, { type: 'itv', action: 'get_genres' }, function (e, genres) {
    if (e) return cb(e);
    var gname = {}; (Array.isArray(genres) ? genres : []).forEach(function (g) { if (g && g.id != null) gname[String(g.id)] = String(g.title || g.name || 'Channels'); });
    act(L, { type: 'itv', action: 'get_all_channels' }, function (e2, all) {
      var list = all && Array.isArray(all.data) ? all.data : Array.isArray(all) ? all : null;
      if (!e2 && list && list.length) return cb(null, shape(list, gname));
      var out = [], page = 1;
      (function more() {
        act(L, { type: 'itv', action: 'get_ordered_list', genre: '*', fav: 0, sortby: 'number', p: page }, function (e3, js) {
          if (e3) return out.length ? cb(null, shape(out, gname)) : cb(e2 || e3);
          var d = js && Array.isArray(js.data) ? js.data : [];
          out = out.concat(d);
          var total = +(js && js.total_items) || 0, per = +(js && js.max_page_items) || d.length || 1;
          if (!d.length || out.length >= total || page * per >= total || page >= 500) return cb(null, shape(out, gname));
          page++; more();
        });
      })();
    });
  });
}
function shape(list, gname) {
  var groups = [], gid = {}, chans = [];
  list.forEach(function (c) {
    if (!c || !c.cmd) return;
    var gn = gname[String(c.tv_genre_id)] || 'Channels', g = gid[gn];
    if (!g) { g = gid[gn] = 'k' + hash(gn); groups.push({ id: g, name: gn }); }
    var k = 'k' + hash(String(c.id) + '|' + (c.name || '') + '|' + gn);
    var ch = { k: k, id: k, n: String(c.name || 'Channel'), g: g, logo: /^https?:/i.test(c.logo || '') ? c.logo : '', num: +c.number || 0,
      epg: String(c.xmltv_id || ''), url: 'stalker:' + String(c.cmd), sid: String(c.id), arch: 0 };          // a portal's archive has its own API (not yet)
    chans.push(ch);
  });
  return { groups: groups, channels: chans };
}

function b64(s) { return buf(String(s || ''), 'utf8').toString('base64'); }

function handle(req, res, ALLOW, log, port) {
  var u = URL_.parse(req.url, true), route = u.pathname;
  if (req.method === 'POST' && route === '/stalker/channels') {
    var body = '', over = false;
    req.on('data', function (c) { if (over) return; body += c; if (body.length > BODY_MAX) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
    req.on('end', function () {
      if (over) return;
      var q; try { q = JSON.parse(body); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
      var L = login(q && (q.stb && typeof q.stb === 'object' ? q.stb : b64urlJSON(q && q.stb)));
      if (!L) return send(res, ALLOW, 400, { error: 'Enter the portal address (http://...) and the MAC address (00:1A:79:12:34:56).' });
      var t0 = Date.now();
      channels(L, function (e, d) {
        if (e) { if (log) log({ lv: 'warn', event: 'stalker list failed', e: e.message }); return send(res, ALLOW, e.auth ? 401 : 502, { error: e.message, auth: !!e.auth }); }
        if (log) log({ lv: 'info', event: 'stalker list', n: d.channels.length, groups: d.groups.length, ms: Date.now() - t0 });
        send(res, ALLOW, 200, { groups: d.groups, channels: d.channels, portal: (sessions[keyOf(L)] || {}).api ? 'found' : '' });
      });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, ALLOW, 405, { error: 'GET' });
  var L2 = login(b64urlJSON(u.query.stb));
  if (!L2) return send(res, ALLOW, 400, { error: 'no portal login' });
  if (/^\/stalker\/play\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(route)) {
    var cmd = String(u.query.cmd || '');
    if (!cmd) return send(res, ALLOW, 400, { error: 'no channel' });
    act(L2, { type: 'itv', action: 'create_link', cmd: cmd, series: '', forced_storage: 'undefined', disable_ad: 0, download: 0 }, function (e, js) {
      var to = linkOf(js && js.cmd) || (/^https?:\/\//i.test(linkOf(cmd)) && !/localhost|127\.0\.0\.1/.test(linkOf(cmd)) ? linkOf(cmd) : '');
      if (e || !to) {
        if (log) log({ lv: 'warn', event: 'stalker link failed', e: e ? e.message : 'no link' });
        res.writeHead(e && e.auth ? 403 : 502, ALLOW); return res.end(e ? e.message : 'the portal gave no link');
      }
      var m = /^(https?):\/\/(.*)$/i.exec(to), ua = buf(UA, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      var h = { 'Location': 'http://127.0.0.1:' + port + '/ua/' + ua + '/x/' + m[1].toLowerCase() + '/' + m[2], 'Cache-Control': 'no-store' };
      for (var k in ALLOW) h[k] = ALLOW[k];
      res.writeHead(302, h); res.end();
    });
    return;
  }
  if (route === '/stalker/epg') {
    var limit = Math.max(1, Math.min(48, +u.query.limit || 10));
    act(L2, { type: 'itv', action: 'get_short_epg', ch_id: String(u.query.ch || ''), size: limit }, function (e, js) {
      if (e) return send(res, ALLOW, e.auth ? 401 : 502, { error: e.message });
      var list = Array.isArray(js) ? js : js && Array.isArray(js.data) ? js.data : [];
      send(res, ALLOW, 200, { epg_listings: list.slice(0, limit).map(function (p) {
        var s = +p.start_timestamp || Math.floor(Date.parse(p.time) / 1000) || 0, en = +p.stop_timestamp || Math.floor(Date.parse(p.time_to) / 1000) || 0;
        return { start_timestamp: String(s), stop_timestamp: String(en), title: b64(p.name || p.title || ''), description: b64(p.descr || p.description || '') };
      }).filter(function (p) { return +p.start_timestamp > 0 && +p.stop_timestamp > +p.start_timestamp; }) });
    });
    return;
  }
  send(res, ALLOW, 404, { error: 'unknown stalker route' });
}

module.exports = { handle: handle, _login: login, _apis: apis, _linkOf: linkOf };
