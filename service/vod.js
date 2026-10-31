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
   The address goes in the body, not the query, so it never shows in a log line.  It must be a relay
   address on this TV, so the download gets the playlist's User-Agent and the relay's DNS cache.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http');

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

function handle(req, res, ALLOW, log, port) {
  if (req.method !== 'POST' || req.url.split('?')[0] !== '/vod/slim') return send(res, ALLOW, 404, { error: 'unknown vod route' });
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

module.exports = { handle: handle, slim: slim };
