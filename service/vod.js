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
  ['movie', 'series'].forEach(function (kind) { try { fs.unlinkSync(fileOf(pl, kind)); } catch (e) {} });
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
  var mine = new RegExp('^http://127\\.0\\.0\\.1:' + port + '/(?:ua/[A-Za-z0-9_-]+/)?x/https?/');
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
    var mine = new RegExp('^http://127\\.0\\.0\\.1:' + port + '/(?:ua/[A-Za-z0-9_-]+/)?x/https?/');
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

module.exports = { handle: handle, slim: slim, shown: shown, forget: forget };
