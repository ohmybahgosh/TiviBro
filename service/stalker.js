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
     Movies, shows and catch-up: /stalker/xc/, /stalker/vod/ and /stalker/archive/ (below).
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
   anything else).  Kept 30 minutes, made again when the portal stops taking it.
   Requests at the same moment (the guide asks for many channels at once) share one sign-in: a portal often
   keeps one token per MAC, so parallel handshakes would undo each other.  fresh: the session that failed
   (its time), made again only if no newer one came meanwhile. */
var sessions = {}, pending = {}, SESSION_FOR = 30 * 60000;
function keyOf(L) { return L.portal + '|' + L.mac; }
function session(L, fresh, cb0) {
  var k = keyOf(L), s = sessions[k];
  if (s && (!fresh || s.at > fresh) && Date.now() - s.at < SESSION_FOR) return cb0(null, s);
  if (pending[k]) return pending[k].push(cb0);
  pending[k] = [cb0];
  function cb(e, t) { var l = pending[k] || []; delete pending[k]; for (var n = 0; n < l.length; n++) l[n](e, t); }
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
  session(L, 0, function (e, s) {
    if (e) return cb(e);
    call(L, s, params, function (e2, js) {
      if (!e2 || !e2.auth) return cb(e2, js);
      session(L, s.at, function (e3, s2) { if (e3) return cb(e3); call(L, s2, params, cb); });
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
      epg: String(c.xmltv_id || ''), url: 'stalker:' + String(c.cmd), sid: String(c.id), arch: archDays(c) };
    chans.push(ch);
  });
  return { groups: groups, channels: chans };
}

// Catch-up days: tv_archive_duration is in hours on Ministra portals (168 for a week).
function archDays(c) {
  if (!(+c.tv_archive || +c.enable_tv_archive || c.tv_archive === 'true')) return 0;
  var h = +c.tv_archive_duration || 0;
  return h > 0 ? Math.max(1, Math.min(30, Math.round(h / 24))) : 3;
}

function b64(s) { return buf(String(s || ''), 'utf8').toString('base64'); }
function b64u(s) { return buf(String(s || ''), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { try { return buf(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { return ''; } }

/* ---------- Movies, shows and catch-up ----------
   The app reads a portal's movies and shows as an Xtream panel's (vod.js, the helper's service/vod.js): these
   answer Xtream's player_api.php actions from the portal's VOD lists.  A title the portal marks is_series is a
   show; its seasons each carry one command, and an episode is that command with its number (create_link's
   "series"), as on a MAG box.  An episode's id carries its season's command, so it plays without the list.
     GET /stalker/xc/player_api.php?stb=<login>&action=get_vod_categories|get_vod_streams|get_series_categories|
         get_series|get_vod_info&vod_id=|get_series_info&series_id=  [&category_id=]
     GET /stalker/vod/<id>.<ext>?stb=<login>         a movie (its portal id) or an episode ("e<n>x<season cmd>")
     GET /stalker/archive/<channel id>.ts?stb=<login>&start=<unix s>&end=<unix s>   a programme of the archive */
var vodMem = {}, VOD_FOR = 3 * 3600e3, PAGES_MAX = 700;
function vodOf(L) { var k = keyOf(L); return vodMem[k] || (vodMem[k] = { cats: null, catsAt: 0, lists: {}, cmd: {} }); }
function when(s) { var t = Date.parse(String(s || '').replace(' ', 'T')); return isNaN(t) ? (+s || 0) : Math.floor(t / 1000); }
function extOf(cmd) { var m = /\.(mp4|mkv|avi|m4v|mov|ts|m3u8|mpg)(?:[?\s]|$)/i.exec(String(cmd || '')); return m && !/mpg/i.test(m[1]) ? m[1].toLowerCase() : 'mp4'; }
function slim(x) {
  return { id: String(x.id), name: String(x.name || x.o_name || 'Untitled'), cover: /^https?:/i.test(x.screenshot_uri || '') ? x.screenshot_uri : /^https?:/i.test(x.cover || '') ? x.cover : '',
    rating: String(x.rating_imdb || x.rating_kinopoisk || x.rating || ''), cat: String(x.category_id || ''), added: when(x.added), series: +x.is_series === 1 || x.is_series === true,
    year: String(x.year || '').slice(0, 4), plot: String(x.description || '').slice(0, 1500), cmd: String(x.cmd || ''), director: String(x.director || ''), cast: String(x.actors || ''),
    genre: String(x.genres_str || x.genre || ''), mins: +x.time || 0 };
}
function vodCats(L, cb) {
  var V = vodOf(L);
  if (V.cats && Date.now() - V.catsAt < VOD_FOR) return cb(null, V.cats);
  act(L, { type: 'vod', action: 'get_categories' }, function (e, js) {
    if (e) return cb(e);
    V.cats = (Array.isArray(js) ? js : []).filter(function (c) { return c && c.id != null && String(c.id) !== '*'; })
      .map(function (c) { return { category_id: String(c.id), category_name: String(c.title || c.name || 'Movies'), parent_id: 0 }; });
    V.catsAt = Date.now(); cb(null, V.cats);
  });
}
// A category's titles ('*': every one), page by page (a portal sends a dozen or so at a time), four at once.
function vodPages(L, cat, cb) {
  function page(n, then) { act(L, { type: 'vod', action: 'get_ordered_list', category: cat, genre: cat, sortby: 'added', fav: 0, p: n }, then); }
  page(1, function (e, js) {
    if (e) return cb(e);
    var first = js && Array.isArray(js.data) ? js.data : [], total = +(js && js.total_items) || first.length, per = +(js && js.max_page_items) || first.length || 1;
    var pages = Math.min(PAGES_MAX, Math.ceil(total / per)), got = {}, next = 2, running = 0, stop = false, finished = false;
    if (pages <= 1 || !first.length) return cb(null, first);
    (function pump() {
      while (running < 4 && next <= pages && !stop) {
        (function (n) {
          running++;
          page(n, function (e2, j2) { running--; if (e2) stop = true; else got[n] = j2 && Array.isArray(j2.data) ? j2.data : []; pump(); });
        })(next++);
      }
      if (running || finished || (next <= pages && !stop)) return;
      finished = true;
      var out = first; for (var i = 2; i < next; i++) if (got[i]) out = out.concat(got[i]);   // a page that failed: the rest still count
      cb(null, out);
    })();
  });
}
function vodItems(L, cat, cb) {
  var V = vodOf(L), key = cat || '*', hit = V.lists[key];
  if (hit && Date.now() - hit.at < VOD_FOR) return cb(null, hit.items);
  vodPages(L, key, function (e, list) {
    if (e) return cb(e);
    var items = list.filter(function (x) { return x && x.id != null; }).map(slim);
    items.forEach(function (x) { if (x.cmd) V.cmd[x.id] = x.cmd; });
    V.lists[key] = { at: Date.now(), items: items };
    cb(null, items);
  });
}
function findItem(L, id) {
  var V = vodOf(L), hit = null;
  Object.keys(V.lists).some(function (k) { return V.lists[k].items.some(function (x) { if (x.id === id) { hit = x; return true; } return false; }); });
  return hit;
}
function asMovie(x) { return { stream_id: x.id, num: 0, name: x.name, stream_type: 'movie', stream_icon: x.cover, rating: x.rating, added: String(x.added || ''), category_id: x.cat, container_extension: extOf(x.cmd) }; }
function asShow(x) { return { series_id: x.id, num: 0, name: x.name, cover: x.cover, plot: x.plot, rating: x.rating, releaseDate: x.year, category_id: x.cat, last_modified: String(x.added || '') }; }
function infoOf(x) {
  return { name: x.name, plot: x.plot, description: x.plot, movie_image: x.cover, cover_big: x.cover, cover: x.cover, rating: x.rating, releasedate: x.year, director: x.director, cast: x.cast,
    genre: x.genre, duration_secs: x.mins * 60, duration: x.mins ? Math.floor(x.mins / 60) + ':' + ('0' + x.mins % 60).slice(-2) + ':00' : '' };
}
// A show's seasons (get_ordered_list with its movie_id), as Xtream's get_series_info.
function seasons(L, x, cb) {
  act(L, { type: 'vod', action: 'get_ordered_list', movie_id: x.id, season_id: 0, episode_id: 0, category: x.cat || '*', fav: 0, p: 1 }, function (e, js) {
    if (e) return cb(e);
    var list = js && Array.isArray(js.data) ? js.data : [], eps = {}, out = [];
    list.forEach(function (sz, i) {
      if (!sz || !sz.cmd) return;
      var n = +((/(\d+)/.exec(String(sz.name || '')) || [])[1]) || i + 1, nums = Array.isArray(sz.series) ? sz.series : [];
      out.push({ season_number: n, name: String(sz.name || 'Season ' + n), cover: x.cover });
      eps[n] = nums.map(function (en) {
        en = +en;
        return { id: 'e' + en + 'x' + b64u(sz.cmd), episode_num: en, title: 'Episode ' + en, container_extension: extOf(sz.cmd), season: n, info: {} };
      });
    });
    cb(null, { seasons: out, info: infoOf(x), episodes: eps });
  });
}
function xc(L, q, res, ALLOW) {
  var a = String(q.action || ''), cat = q.category_id ? String(q.category_id) : '*';
  function fail(e) { send(res, ALLOW, e.auth ? 401 : 502, { error: e.message }); }
  if (a === 'get_vod_categories' || a === 'get_series_categories') return vodCats(L, function (e, c) { e ? fail(e) : send(res, ALLOW, 200, c); });
  if (a === 'get_vod_streams' || a === 'get_series') {
    return vodItems(L, cat, function (e, items) {
      if (e) return fail(e);
      var show = a === 'get_series';
      send(res, ALLOW, 200, items.filter(function (x) { return x.series === show; }).map(show ? asShow : asMovie));
    });
  }
  if (a === 'get_vod_info' || a === 'get_series_info') {
    var id = String(q.vod_id || q.series_id || ''), x = findItem(L, id);
    var answer = function (it) {
      if (a === 'get_vod_info') return send(res, ALLOW, 200, { info: infoOf(it), movie_data: { stream_id: it.id, name: it.name, container_extension: extOf(it.cmd), category_id: it.cat } });
      seasons(L, it, function (e, d) { e ? fail(e) : send(res, ALLOW, 200, d); });
    };
    if (x) return answer(x);
    return vodItems(L, '*', function (e) { if (e) return fail(e); var y = findItem(L, id); y ? answer(y) : send(res, ALLOW, 404, { error: 'no such title' }); });
  }
  send(res, ALLOW, 400, { error: 'not a Stalker action TiviBro knows' });
}
// To the stream the portal linked, through the relay with the box's User-Agent.
function sendOn(res, ALLOW, port, to) {
  var m = /^(https?):\/\/(.*)$/i.exec(to), ua = b64u(UA);
  var h = { 'Location': 'http://127.0.0.1:' + port + '/ua/' + ua + '/x/' + m[1].toLowerCase() + '/' + m[2], 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(302, h); res.end();
}
function linkFail(res, ALLOW, log, e, what) {
  if (log) log({ lv: 'warn', event: 'stalker ' + what + ' failed', e: e ? e.message : 'no link' });
  res.writeHead(e && e.auth ? 403 : e && e.missing ? 404 : 502, ALLOW); res.end(e ? e.message : 'the portal gave no link');
}
function vodPlay(L, id, res, ALLOW, log, port) {
  var em = /^e(\d+)x([A-Za-z0-9_-]+)$/.exec(id), cmd, series = '';
  if (em) { cmd = unb64u(em[2]); series = em[1]; }
  else cmd = vodOf(L).cmd[id] || '/media/file_' + id + '.mpg';         // the usual command when the list is gone (a helper restart)
  act(L, { type: 'vod', action: 'create_link', cmd: cmd, series: series, forced_storage: 'undefined', disable_ad: 0, download: 0 }, function (e, js) {
    var to = linkOf(js && js.cmd);
    if (e || !to) return linkFail(res, ALLOW, log, e, 'movie link');
    sendOn(res, ALLOW, port, to);
  });
}
/* Catch-up: the programme of the channel's archive that starts at that time (the portal's own guide, by day:
   the day in UTC and the ones each side, since the portal's days are in its own time zone), then its link. */
function archive(L, sid, start, res, ALLOW, log, port) {
  var days = [-1, 0, 1].map(function (d) { return new Date((start + d * 86400) * 1000).toISOString().slice(0, 10); }), i = 0;
  (function day() {
    if (i >= days.length) { var e = err('the portal\'s archive has no programme at that time'); e.missing = true; return linkFail(res, ALLOW, log, e, 'archive'); }
    var date = days[i++], pg = 1;
    (function page() {
      act(L, { type: 'epg', action: 'get_simple_data_table', ch_id: sid, date: date, p: pg }, function (e, js) {
        if (e) return linkFail(res, ALLOW, log, e, 'archive');
        var d = js && Array.isArray(js.data) ? js.data : [], hit = null;
        d.forEach(function (p) { var s = +p.start_timestamp || when(p.time), en = +p.stop_timestamp || when(p.time_to); if (!hit && s <= start + 90 && en > start) hit = p; });
        if (hit) {
          return act(L, { type: 'tv_archive', action: 'create_link', cmd: 'auto /media/' + hit.id + '.mpg', series: '', forced_storage: 'undefined', disable_ad: 0, download: 0 }, function (e2, j2) {
            var to = linkOf(j2 && j2.cmd);
            if (e2 || !to) return linkFail(res, ALLOW, log, e2, 'archive');
            sendOn(res, ALLOW, port, to);
          });
        }
        var total = +(js && js.total_items) || 0, per = +(js && js.max_page_items) || d.length || 1;
        if (d.length && pg * per < total && pg < 20) { pg++; return page(); }
        day();
      });
    })();
  })();
}

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
      sendOn(res, ALLOW, port, to);
    });
    return;
  }
  if (route === '/stalker/xc/player_api.php') return xc(L2, u.query, res, ALLOW);
  var vm = /^\/stalker\/vod\/([A-Za-z0-9_-]{1,1200})\.[a-z0-9]{2,5}$/.exec(route);
  if (vm) return vodPlay(L2, vm[1], res, ALLOW, log, port);
  var am = /^\/stalker\/archive\/([A-Za-z0-9_-]{1,40})\.[a-z0-9]{2,5}$/.exec(route);
  if (am) { var st = +u.query.start || 0; if (!st) return send(res, ALLOW, 400, { error: 'no start time' }); return archive(L2, am[1], st, res, ALLOW, log, port); }
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

module.exports = { handle: handle, _login: login, _apis: apis, _linkOf: linkOf, _archDays: archDays };
