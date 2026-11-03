/* Big things TiviBro keeps, on the TV's storage instead of the browser's.
   An old TV gives the web app only a small share of its storage (issue #18: a 51,000-channel list
   on a 2019 C9 did not fit), so the playlist itself is kept here, beside the guide, and the app reads
   it back when it starts.  Only TiviBro can use these: they hold stream addresses with the login, so
   proxy.js checks TiviBro's secret on them like the web editor's and the phone app's controls.

   Routes (on the relay, 127.0.0.1 only, with TiviBro's secret):
     GET  /kv/get?k=<key>     the stored JSON, or 404
     POST /kv/put?k=<key>     body: the JSON to keep (written to a new file, then swapped in)
     POST /kv/put?k=<key>&from=<id>   body: a few fields; the channel list comes from live.js (keep)
     POST /kv/del?k=<key>
   Keys: letters, digits, ":", "_" and "-", up to 80.  Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path');

var MAX = 512 * 1024 * 1024;
/* Where: storage.js picks one folder for everything big (TV storage that survives updates, on the
   partition with the most room, private to the helper).  In memory (/tmp) it would vanish with the TV,
   so there the app keeps using its own storage. */
var Storage = require('./storage');
function root() { return Storage.base(); }
function sub(name) { return Storage.sub(name); }
function onDisk() { return !Storage.memory(); }
function fileOf(k) { return path.join(sub('kv'), k.replace(/:/g, '~') + '.json'); }

// Where live.js keeps a channel list it just made, until the app saves it (/kv/put?from=); null when
// there is no storage for the kv store on this TV.
function liveDir() { try { return onDisk() ? sub('kv') : null; } catch (e) { return null; } }

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
  /* /kv/put?k=<key>&from=<id>: the channel list live.js kept (live~<id>.json), saved as <key> with the
     fields in the body (small: when it was loaded, its signature, recently added channels…) put in
     front.  The app never has to turn the whole list back into text.  404 when there's no such file:
     the app then sends the whole thing as before. */
  var from = /(?:^|&)from=([a-z0-9]{6,24})(?:&|$)/.exec(u[1] || '');
  if (req.method === 'POST' && route === '/kv/put' && from) {
    var src = path.join(sub('kv'), 'live~' + from[1] + '.json'), body = '', big = false;
    req.on('data', function (c) { if (big) return; body += c; if (body.length > 4 * 1024 * 1024) { big = true; send(res, ALLOW, 413, { error: 'too large' }); } });
    req.on('end', function () {
      if (big) return;
      var extra; try { extra = JSON.parse(body || '{}'); } catch (e) { return send(res, ALLOW, 400, { error: 'bad body' }); }
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return send(res, ALLOW, 400, { error: 'bad body' });
      delete extra.groups; delete extra.channels;
      fs.stat(src, function (e, st) {
        if (e || !st.size) return send(res, ALLOW, 404, { error: 'no such list' });
        var inner = JSON.stringify(extra).slice(1, -1), tmp2 = f + '.' + process.pid + '-' + Date.now() + '.tmp', out2 = fs.createWriteStream(tmp2), done2 = false;
        function fail2(code, why) { if (done2) return; done2 = true; out2.destroy(); fs.unlink(tmp2, function () {}); if (log) log({ lv: 'warn', event: 'kv keep failed', k: k, e: why }); send(res, ALLOW, code, { error: why }); }
        out2.on('error', function (er) { fail2(er.code === 'ENOSPC' ? 507 : 500, er.code === 'ENOSPC' ? 'the TV is out of storage' : er.message); });
        out2.on('finish', function () {
          if (done2) return; done2 = true;
          fs.rename(tmp2, f, function (er) {
            if (er) { fs.unlink(tmp2, function () {}); return send(res, ALLOW, 500, { error: er.message }); }
            fs.unlink(src, function () {});
            send(res, ALLOW, 200, { ok: true, size: st.size + inner.length + 1 });
          });
        });
        // { extra fields , rest of the kept list without its own "{"
        out2.write('{' + inner + (inner ? ',' : ''));
        var rd = fs.createReadStream(src, { start: 1 });
        rd.on('error', function (er) { fail2(500, er.message); });
        rd.pipe(out2);
      });
    });
    return;
  }
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

module.exports = { handle: handle, root: root, sub: sub, liveDir: liveDir, fileOf: fileOf };
