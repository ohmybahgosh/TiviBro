/* Live channel lists, downloaded and shaped by the helper instead of the app.
   A big provider's get_live_streams answer (or M3U file) is tens of MB; parsed in the app it costs
   several times that for a moment (a 180,000-channel list took the app to about 270 MB while it
   loaded, and webOS closes an app at about 500 MB).  The helper is a separate process: it downloads
   the list through its own relay, shapes it with the app's own code (app/js/plshape.js, so channel
   keys and every edit stay the same) and hands the app only the channel list it keeps.

   Routes (on the relay, 127.0.0.1 only, with TiviBro's secret like /kv/):
     POST /live/xtream  { u: <relayed get_live_streams address>, uc: <relayed get_live_categories> }
       -> { groups, channels, n, cats }
     POST /live/m3u     { u: <relayed playlist address> }
       -> { groups, channels, epgUrl, bytes }, or 422 { kind: 'parse' } when it isn't an M3U playlist
     Either with keep: true also answers live: <id>, and the answer is kept for /kv/put?from=<id> (kv.js).
   Any other failure answers 502 and the app loads the list itself, as before.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http');
var PlShape = (function () {
  try { return require('./editor/plshape.js'); } catch (e) {}
  return require('../app/js/plshape.js');                     // the dev relay, from the repository
})();

var BODY_MAX = 64 * 1024, TEXT_MAX = 400 * 1024 * 1024;

function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
// A relay address on this helper, read whole as text.
function getText(url, cb) {
  var done = false;
  var finish = function (e, v, n) { if (!done) { done = true; cb(e, v, n); } };
  var req = http.get(url, function (res) {
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
    var parts = [], size = 0;
    res.on('data', function (c) { size += c.length; if (size > TEXT_MAX) { req.abort(); return finish(new Error('too big')); } parts.push(c); });
    res.on('end', function () {
      var t;
      try { t = Buffer.concat(parts, size).toString('utf8'); parts = null; } catch (e) { return finish(new Error('too big to read: ' + e.message)); }
      finish(null, t, size);
    });
    res.on('error', finish);
  });
  req.on('error', finish);
  req.setTimeout(180000, function () { req.abort(); finish(new Error('timed out')); });
}
function getJSON(url, cb) {
  getText(url, function (e, t) {
    if (e) return cb(e);
    var j; try { j = JSON.parse(t); } catch (x) { return cb(new Error('not JSON (' + t.length + ' characters)')); }
    cb(null, j);
  });
}

/* The answer, also kept as a file (live~<id>.json beside the kv store) when the app asks (keep), so the
   app can save it as the playlist's cache with /kv/put?from=<id> instead of turning tens of MB of
   channels back into text itself: on a small TV that copy was the moment memory ran out (issues #24,
   #25: 187,000 channels).  The id comes back in the answer (live); no file, no id. */
var KEEP_FOR = 15 * 60000;
function reply(res, ALLOW, obj, keep, log) {
  if (!keep) return send(res, ALLOW, 200, obj);
  var dir = null, id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try { var Kv = require('./kv'); dir = Kv.liveDir(); } catch (e) { dir = null; }
  if (!dir) return send(res, ALLOW, 200, obj);
  obj.live = id;
  var text = JSON.stringify(obj), f = require('path').join(dir, 'live~' + id + '.json');
  obj = null;
  // Old ones nobody claimed (the app closed meanwhile).
  try { require('fs').readdirSync(dir).forEach(function (n) { if (/^live~[a-z0-9]+\.json$/.test(n)) { var q = require('path').join(dir, n); try { if (Date.now() - require('fs').statSync(q).mtime.getTime() > KEEP_FOR) require('fs').unlinkSync(q); } catch (e) {} } }); } catch (e) {}
  require('fs').writeFile(f, text, function (e) {
    if (e) { require('fs').unlink(f, function () {}); if (log) log({ lv: 'warn', event: 'live list not kept', e: e.message }); text = text.replace('"live":"' + id + '"', '"live":""'); }
    var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    for (var k in ALLOW) h[k] = ALLOW[k];
    res.writeHead(200, h);
    res.end(text);
    text = null;
  });
}

function handle(req, res, ALLOW, log, port) {
  var route = req.url.split('?')[0];
  if (req.method !== 'POST' || (route !== '/live/xtream' && route !== '/live/m3u')) return send(res, ALLOW, 404, { error: 'unknown live route' });
  var body = '', over = false;
  req.on('data', function (c) { if (over) return; body += c; if (body.length > BODY_MAX) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q; try { q = JSON.parse(body); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    // Only this helper's own relay addresses: never a way to reach anything else.
    var mine = new RegExp('^http://127\\.0\\.0\\.1:' + port + '/(?:ua/[A-Za-z0-9_-]+/)?x/https?/');
    var u = String(q && q.u || ''), uc = String(q && q.uc || '');
    if (!mine.test(u) || (route === '/live/xtream' && !mine.test(uc))) return send(res, ALLOW, 400, { error: 'not a relay address' });
    var t0 = Date.now();
    if (route === '/live/xtream') {
      getJSON(uc, function (e1, cats) {
        if (e1) return send(res, ALLOW, 502, { error: 'categories: ' + e1.message });
        getJSON(u, function (e, streams) {
          if (e) { if (log) log({ lv: 'warn', event: 'live list failed', e: e.message }); return send(res, ALLOW, 502, { error: e.message }); }
          if (!Array.isArray(streams)) return send(res, ALLOW, 502, { error: 'the provider did not send a list' });
          var d = PlShape.xtream(cats, streams), n = streams.length, nc = Array.isArray(cats) ? cats.length : 0;
          streams = null; cats = null;
          if (log) log({ lv: 'info', event: 'live list', n: n, ms: Date.now() - t0 });
          reply(res, ALLOW, { groups: d.groups, channels: d.channels, n: n, cats: nc }, !!q.keep, log);
        });
      });
      return;
    }
    getText(u, function (e, t, size) {
      if (e) { if (log) log({ lv: 'warn', event: 'live list failed', e: e.message }); return send(res, ALLOW, 502, { error: e.message }); }
      if (t.indexOf('#EXTM3U') < 0 && t.indexOf('#EXTINF') < 0) return send(res, ALLOW, 422, { kind: 'parse', error: 'not an M3U playlist', head: t.slice(0, 200) });
      var d = PlShape.parseM3U(t);
      t = null;
      if (log) log({ lv: 'info', event: 'live m3u', n: d.channels.length, ms: Date.now() - t0 });
      reply(res, ALLOW, { groups: d.groups, channels: d.channels, epgUrl: d.epgUrl, bytes: size }, !!q.keep, log);
    });
  });
}

module.exports = { handle: handle };
