/* Movie and show lists, slimmed by the helper instead of the app.
   A big provider's get_vod_streams answer can be 60 MB or more (160,000 movies, each with a dozen
   fields the lists never use).  Parsing that in the app costs several times its size for a moment,
   on top of the live channels, and webOS closes an app that passes roughly 500 MB.  The helper is a
   separate process, so it downloads and parses the list here and hands the app only what the Movies
   and Shows screens show, as compact rows.

   Route (on the relay, 127.0.0.1 only):
     POST /vod/slim   { kind: 'movie'|'series', u: <relayed player_api address> }
       -> { v: 1, kind, n, rows }   movie  rows: [id, name, cover, rating, ext, cat, added]
                                    series rows: [id, name, cover, plot, rating, year, cat, added]
     POST /vod/list   { pl, sig, kind, u, uc, maxAge, refresh, picked, navLang, hidden }
       -> { v: 2, kind, at, cats, langs, keep, total, adultCat, rows }
       The full list (u: the titles, uc: the categories) is kept on the TV's storage, not in the app,
       so an old TV's small browser storage never fills up and the app never holds every language.
       Each call answers from the copy kept here (memory for a few minutes, then the file) until it
       is maxAge old (0: until refresh), and returns only what shows: the languages picked, without
       hidden categories (vodview.js, shared with the app).  Rows are the slim rows plus
       [lang, q (4K), adult, p (the code taken off the name)].
     POST /vod/list   { pl, sig, kind, m3u: 1, picked, navLang, hidden }
       An M3U playlist's movies and shows: the same answer, from what the helper kept when it read the
       list (saveM3u, called by live.js).  Nothing is downloaded here.
     POST /vod/m3u    { pl, op: 'series', id }  -> the show's episodes, shaped like Xtream's get_series_info
                      { pl, op: 'url', id }     -> { url } for a movie
   The address goes in the body, not the query, so it never shows in a log line.  It must be a relay
   address on this TV, so the download gets the playlist's User-Agent and the relay's DNS cache.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var VodView = (function () {
  try { return require('./editor/vodview.js'); } catch (e) {}
  return require('../app/js/vodview.js');                       // the dev relay, from the repository
})();
var Kv = require('./kv');

var PLOT_MAX = 300;
var BODY_MAX = 64 * 1024;

function str(v) { return v == null ? '' : String(v); }
function slim(kind, list) {
  var rows = [];
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (!x || typeof x !== 'object') continue;
    if (kind === 'series') {
      rows.push([x.series_id, str(x.name), str(x.cover), str(x.plot).slice(0, PLOT_MAX), str(x.rating),
        str(x.releaseDate || x.release_date).slice(0, 4), str(x.category_id), +x.last_modified || 0]);
    } else {
      rows.push([x.stream_id, str(x.name), str(x.stream_icon), str(x.rating), str(x.container_extension) || 'mp4', str(x.category_id), +x.added || 0]);
    }
  }
  return rows;
}

function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

// Fetches a relay address on this helper and parses the JSON answer.
function getJSON(url, cb) {
  var done = false;
  function finish(e, v) { if (!done) { done = true; cb(e, v); } }
  var req = http.get(url, function (res) {
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
    var parts = [], size = 0;
    res.on('data', function (c) { parts.push(c); size += c.length; });
    res.on('end', function () {
      var text;
      try { text = Buffer.concat(parts, size).toString('utf8'); parts = null; } catch (e) { return finish(new Error('too big to read: ' + e.message)); }
      try { finish(null, JSON.parse(text)); } catch (e2) { finish(new Error('not JSON (' + size + ' bytes)')); }
    });
    res.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(180000, function () { req.abort(); finish(new Error('timed out')); });
}

/* ---------- the full lists, kept here ---------- */
var memo = {}, MEMO_MS = 3 * 60000;
function dir() { return Kv.sub('vod'); }
function fileOf(pl, kind) { return path.join(dir(), String(pl || 'p').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) + '-' + kind + '.json'); }
function readList(pl, kind, cb) {
  var m = memo[pl + '|' + kind];
  if (m) { m.used = Date.now(); return cb(m.d); }
  var f; try { f = fileOf(pl, kind); } catch (e) { return cb(null); }
  fs.readFile(f, 'utf8', function (e, text) {
    if (e) return cb(null);
    var d = null; try { d = JSON.parse(text); } catch (e2) {}
    text = null;
    cb(d && d.v === 2 && Array.isArray(d.rows) ? keep(pl, kind, d) : null);
  });
}
function keep(pl, kind, d) {
  memo[pl + '|' + kind] = { d: d, used: Date.now() };
  return d;
}
function writeList(pl, kind, d, cb) {
  var f;
  try { f = fileOf(pl, kind); } catch (e) { return cb(e); }
  var tmp = f + '.' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.tmp';    // two saves at once never share one
  fs.writeFile(tmp, JSON.stringify(d), function (e) {
    if (e) { fs.unlink(tmp, function () {}); return cb(e); }
    fs.rename(tmp, f, cb);
  });
}
// Lists not asked for in a while leave memory (the file stays).
setInterval(function () { var now = Date.now(); Object.keys(memo).forEach(function (k) { if (now - memo[k].used > MEMO_MS) delete memo[k]; }); }, 60000).unref();
function forget(pl) {
  Object.keys(memo).forEach(function (k) { if (k.indexOf(pl + '|') === 0) delete memo[k]; });
  ['movie', 'series', 'm3u'].forEach(function (kind) { try { fs.unlinkSync(fileOf(pl, kind)); } catch (e) {} });
  delete links[pl];
}

/* An M3U playlist's library (PlShape.parseM3U with { vod: true }): the movie and show lists in the same
   files as an Xtream login's, marked m3u, and the links in a third file, read when a title is opened. */
var links = {};          // pl -> { at, used, urls } for a few minutes
function saveM3u(pl, sig, vod, log, cb) {
  var at = Date.now(), left = 3, failed = null;
  function one(e) { if (e && !failed) failed = e; if (--left === 0) { if (failed && log) log({ lv: 'warn', event: 'm3u library not saved', e: failed.message }); if (cb) cb(failed); } }
  Object.keys(memo).forEach(function (k) { if (k.indexOf(pl + '|') === 0) delete memo[k]; });
  delete links[pl];
  ['movie', 'series'].forEach(function (kind) {
    var d = { v: 2, at: at, sig: sig, m3u: 1, rows: vod[kind].rows, cats: vod[kind].cats };
    writeList(pl, kind, d, one);
    keep(pl, kind, d);
  });
  writeList(pl, 'm3u', { at: at, sig: sig, urls: vod.urls }, one);
}
function readLinks(pl, cb) {
  var c = links[pl];
  if (c) { c.used = Date.now(); return cb(c.urls); }
  var f; try { f = fileOf(pl, 'm3u'); } catch (e) { return cb(null); }
  fs.readFile(f, 'utf8', function (e, text) {
    var d = null; try { d = !e && JSON.parse(text); } catch (x) {}
    if (!d || !d.urls) return cb(null);
    links[pl] = { used: Date.now(), urls: d.urls };
    cb(d.urls);
  });
}
setInterval(function () { var now = Date.now(); Object.keys(links).forEach(function (k) { if (now - links[k].used > MEMO_MS) delete links[k]; }); }, 60000).unref();
function m3u(q, res, ALLOW) {
  var pl = str(q.pl), id = str(q.id);
  if (!pl || !id) return send(res, ALLOW, 400, { error: 'bad request' });
  readLinks(pl, function (u) {
    if (!u) return send(res, ALLOW, 404, { error: 'This playlist\'s movies and shows are not on the TV yet.  Reload the channel list.' });
    function link(x) { return x && u.p[x[0]] != null ? u.p[x[0]] + x[1] : ''; }
    if (q.op === 'url') {
      var url = link(u.m[id]);
      return url ? send(res, ALLOW, 200, { url: url }) : send(res, ALLOW, 404, { error: 'That movie is no longer in this playlist.' });
    }
    var eps = u.s[id];
    if (!eps) return send(res, ALLOW, 404, { error: 'That show is no longer in this playlist.' });
    var by = {}, seen = {};
    eps.forEach(function (e) {
      var r = e[3] || '', m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(r), eid = id + '_' + e[0] + '_' + e[1];
      if (seen[eid]) eid += '_' + (seen[eid]++); else seen[eid] = 1;            // the same episode twice: both kept
      (by[e[0]] = by[e[0]] || []).push({ id: eid, episode_num: e[1], title: 'Episode ' + e[1],
        container_extension: m ? m[1].toLowerCase() : 'mp4', direct_source: link([e[2], r]) });
    });
    Object.keys(by).forEach(function (sn) { by[sn].sort(function (a, b) { return a.episode_num - b.episode_num; }); });
    send(res, ALLOW, 200, { info: {}, episodes: by });
  });
}

// What shows: the shared view over objects made from the rows, then back to rows with the tags.
function shown(kind, d, q) {
  var base = kind === 'series' ? 8 : 7, items = d.items;
  if (!items) {
    items = d.items = d.rows.map(function (r) { return { r: r, name: r[1], cat: String(r[base - 2]) }; });
  }
  var v = VodView.view({ cats: d.cats, items: items }, { picked: Array.isArray(q.picked) ? q.picked : undefined, navLang: str(q.navLang), hidden: Array.isArray(q.hidden) ? q.hidden.map(String) : [] });
  return { v: 2, kind: kind, at: d.at, cats: d.cats, langs: v.langs, keep: v.keep, total: v.total, adultCat: v.adultCat,
    rows: v.items.map(function (it) { var r = it.r.slice(0, base); r[1] = it.name; r.push(it.lang || '', it.q || '', it.adult ? 1 : 0, it.p || ''); return r; }) };
}

function list(q, res, ALLOW, log, port) {
  var kind = q.kind === 'series' ? 'series' : 'movie', pl = str(q.pl), sig = str(q.sig), maxAge = +q.maxAge || 0;
  if (q.m3u) {
    if (!pl) return send(res, ALLOW, 400, { error: 'bad request' });
    return readList(pl, kind, function (d) {
      if (!d || !d.m3u) return send(res, ALLOW, 404, { error: 'This playlist\'s movies and shows are not on the TV yet.  Reload the channel list.' });
      send(res, ALLOW, 200, shown(kind, d, q));
    });
  }
  var mine = new RegExp('^http://127\\.0\\.0\\.1:' + port + '/(?:(?:ua/[A-Za-z0-9_-]+/)?x/https?/|stalker/xc/player_api\\.php\\?)');   // a Stalker portal's, as Xtream (stalker.js)
  if (!pl || !mine.test(str(q.u)) || !mine.test(str(q.uc))) return send(res, ALLOW, 400, { error: 'not a relay address' });
  readList(pl, kind, function (d) { got(d && d.sig === sig ? d : null); });
  function got(d) {
  var fresh = d && !q.refresh && (maxAge <= 0 || Date.now() - d.at < maxAge);
  if (fresh) return send(res, ALLOW, 200, shown(kind, d, q));
  var t0 = Date.now();
  getJSON(str(q.uc), function (e1, cats) {
    getJSON(str(q.u), function (e, j) {
      if (e || !Array.isArray(j)) {
        var why = e ? e.message : 'the provider did not send a list';
        if (log) log({ lv: 'warn', event: 'vod list failed', kind: kind, e: why });
        if (d) return send(res, ALLOW, 200, shown(kind, d, q));               // the copy kept here, however old
        return send(res, ALLOW, 502, { error: why });
      }
      var nd = { v: 2, at: Date.now(), sig: sig, rows: slim(kind, j),
        cats: (Array.isArray(cats) ? cats : []).map(function (x) { return { id: str(x && x.category_id), name: str(x && x.category_name) || 'Other' }; }) };
      j = null;
      if (e1 && d) nd.cats = d.cats;                                          // keep the old categories over none
      if (log) log({ lv: 'info', event: 'vod list', kind: kind, n: nd.rows.length, ms: Date.now() - t0 });
      writeList(pl, kind, { v: 2, at: nd.at, sig: sig, rows: nd.rows, cats: nd.cats }, function (we) { if (we && log) log({ lv: 'warn', event: 'vod list not saved', kind: kind, e: we.message }); });
      keep(pl, kind, nd);
      send(res, ALLOW, 200, shown(kind, nd, q));
    });
  });
  }
}

function handle(req, res, ALLOW, log, port) {
  var route = req.url.split('?')[0];
  if (req.method === 'POST' && route === '/vod/list') return readBody(req, res, ALLOW, function (q) { list(q || {}, res, ALLOW, log, port); });
  if (req.method === 'POST' && route === '/vod/m3u') return readBody(req, res, ALLOW, function (q) { m3u(q || {}, res, ALLOW); });
  if (req.method === 'POST' && route === '/vod/forget') return readBody(req, res, ALLOW, function (q) { if (q && q.pl) forget(str(q.pl)); send(res, ALLOW, 200, { ok: true }); });
  if (req.method !== 'POST' || route !== '/vod/slim') return send(res, ALLOW, 404, { error: 'unknown vod route' });
  var body = '', over = false;
  req.on('data', function (c) { if (over) return; body += c; if (body.length > BODY_MAX) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q;
    try { q = JSON.parse(body); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    var kind = q && q.kind === 'series' ? 'series' : 'movie', u = str(q && q.u);
    // Only this helper's own relay addresses: never a way to reach anything else.
    var mine = new RegExp('^http://127\\.0\\.0\\.1:' + port + '/(?:(?:ua/[A-Za-z0-9_-]+/)?x/https?/|stalker/xc/player_api\\.php\\?)');   // a Stalker portal's, as Xtream (stalker.js)
    if (!mine.test(u)) return send(res, ALLOW, 400, { error: 'not a relay address' });
    var t0 = Date.now();
    getJSON(u, function (e, j) {
      if (e) { if (log) log({ lv: 'warn', event: 'vod list failed', kind: kind, e: e.message }); return send(res, ALLOW, 502, { error: e.message }); }
      if (!Array.isArray(j)) return send(res, ALLOW, 502, { error: 'the provider did not send a list' });
      var rows = slim(kind, j);
      j = null;
      if (log) log({ lv: 'info', event: 'vod list', kind: kind, n: rows.length, ms: Date.now() - t0 });
      send(res, ALLOW, 200, { v: 1, kind: kind, n: rows.length, rows: rows });
    });
  });
}

function readBody(req, res, ALLOW, cb) {
  var b = '', over = false;
  req.on('data', function (c) { if (over) return; b += c; if (b.length > BODY_MAX) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q; try { q = JSON.parse(b); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    cb(q);
  });
}

module.exports = { handle: handle, slim: slim, shown: shown, forget: forget, saveM3u: saveM3u };
