/* Big things TiviBro keeps, on the TV's storage instead of the browser's.
   An old TV gives the web app only a small share of its storage (issue #18: a 51,000-channel list
   on a 2019 C9 did not fit), so the playlist itself is kept here, beside the guide, and the app reads
   it back when it starts.  Only TiviBro can use these: they hold stream addresses with the login, so
   proxy.js checks TiviBro's secret on them like the web editor's and the phone app's controls.

   Routes (on the relay, 127.0.0.1 only, with TiviBro's secret):
     GET  /kv/get?k=<key>     the stored JSON, or 404
     POST /kv/put?k=<key>     body: the JSON to keep (written to a new file, then swapped in)
     POST /kv/del?k=<key>
   Keys: letters, digits, ":", "_" and "-", up to 80.  Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path');
var Guide = require('./guide');

var MAX = 512 * 1024 * 1024;
/* Where: the TV's user storage first, which keeps it when TiviBro is updated (an update replaces the
   helper's own folder, and with it the guide); then the guide's folder.  /tmp is memory and would
   vanish with the TV, so there the app keeps using its own storage. */
var ROOT = null;
function root() {
  if (ROOT) return ROOT;
  var tries = [process.env.TIVIBRO_KV_DIR, '/media/internal/.tivibro', path.join(Guide.root(), 'kv')];
  for (var i = 0; i < tries.length; i++) {
    var d = tries[i];
    if (!d) continue;
    try { try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } var t = path.join(d, '.w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); ROOT = d; return d; } catch (e2) {}
  }
  throw new Error('no place to keep it');
}
function sub(name) { var d = path.join(root(), name); try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } return d; }
function onDisk() { return root().indexOf(path.join(require('os').tmpdir(), 'tivibro-guide')) !== 0; }
function fileOf(k) { return path.join(sub('kv'), k.replace(/:/g, '~') + '.json'); }

function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var x in ALLOW) h[x] = ALLOW[x];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

function handle(req, res, ALLOW, log) {
  var u = req.url.split('?'), route = u[0], m = /(?:^|&)k=([^&]*)/.exec(u[1] || ''), k = m ? decodeURIComponent(m[1]) : '';
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(k)) return send(res, ALLOW, 400, { error: 'bad key' });
  var f;
  try { if (!onDisk()) return send(res, ALLOW, 507, { error: 'no storage for this on the TV' }); f = fileOf(k); } catch (e) { return send(res, ALLOW, 507, { error: e.message }); }
  if (req.method === 'GET' && route === '/kv/get') {
    fs.stat(f, function (e, st) {
      if (e) return send(res, ALLOW, 404, { error: 'none' });
      var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': st.size };
      for (var x in ALLOW) h[x] = ALLOW[x];
      res.writeHead(200, h);
      fs.createReadStream(f).on('error', function () { res.end(); }).pipe(res);
    });
    return;
  }
  if (req.method === 'POST' && route === '/kv/del') { req.resume(); fs.unlink(f, function () { send(res, ALLOW, 200, { ok: true }); }); return; }
  if (req.method === 'POST' && route === '/kv/put') {
    var tmp = f + '.' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.tmp', out = fs.createWriteStream(tmp), size = 0, failed = false;
    var fail = function (code, why) {
      if (failed) return; failed = true;
      req.unpipe(out); out.destroy(); req.resume();
      fs.unlink(tmp, function () {});
      if (log) log({ lv: 'warn', event: 'kv put failed', k: k, e: why });
      send(res, ALLOW, code, { error: why });
    };
    req.on('data', function (c) { size += c.length; if (size > MAX) fail(413, 'too large'); });
    out.on('error', function (e) { fail(e.code === 'ENOSPC' ? 507 : 500, e.code === 'ENOSPC' ? 'the TV is out of storage' : e.message); });
    out.on('finish', function () {
      if (failed) return;
      if (!size) { fs.unlink(tmp, function () {}); return send(res, ALLOW, 400, { error: 'empty' }); }
      fs.rename(tmp, f, function (e) { if (e) return fail(500, e.message); send(res, ALLOW, 200, { ok: true, size: size }); });
    });
    req.pipe(out);
    return;
  }
  send(res, ALLOW, 404, { error: 'unknown kv route' });
}

module.exports = { handle: handle, root: root, sub: sub };
