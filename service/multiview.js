/* Multiview: more than one channel on screen at once.
   A webOS app gets one hardware video decoder: a second <video> stops the first.  So only the channel you
   picked plays as video (with its sound); the others are live pictures made here.  ffmpeg reads each one through
   the relay, decodes it in software (the frames no other frame needs are skipped: about 15 to 20 pictures a
   second for a little over half the work; skipping every B-frame was lighter still, but broke up the picture on
   channels whose B-frames other frames use), makes it small and sends it on
   as JPEGs, one after the other (multipart/x-mixed-replace), which an <img> shows as moving pictures.

     GET /mv/<key>/tile.mjpg?u=<channel link>&w=<width>&f=<pictures a second>[&s=1][&ua=<User-Agent>][&id=<tile>]
         s=1: every frame decoded (smooth, about twice the work), for one box of pictures beside the video.
         the pictures, until the app closes the connection.  A new picture is dropped, not queued, while the
         last one is still on its way (the TV keeps up or skips, it never falls behind).
     GET /mv/<key>/status    { ok, tiles: [{ id, w, f, frames, dropped, kbps, secs }] }

   Each picture uses a connection to the provider of its own, as the channel playing does.  At most MAX tiles at
   once; a new one beyond that stops the oldest.  ffmpeg runs at a low priority (nice 10), so the video playing
   and the app come first.  The key is the converter's (convert.js), as for seek previews: an <img> can't send the
   helper's secret.  Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var cp = require('child_process');
var Ffmpeg = require('./ffmpeg');
var Convert = require('./convert');

var MAX = 3, BOUNDARY = 'tivibroframe';
var tiles = [], seq = 0;

function stopProc(p) { try { p.kill('SIGTERM'); } catch (e) {} setTimeout(function () { try { p.kill('SIGKILL'); } catch (e) {} }, 2000); }
function query(url) {
  var q = {}, s = url.split('?')[1] || '';
  s.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i); try { q[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' ')); } catch (e) {} });
  return q;
}
function args(input, w, f, smooth) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'http,tcp',
    '-fflags', 'nobuffer', '-probesize', '1500000', '-analyzeduration', '1500000',
  ].concat(smooth ? [] : ['-skip_frame', 'noref', '-skip_loop_filter', 'noref']).concat([
    '-i', input, '-an', '-sn', '-dn',
    '-vf', 'scale=' + w + ':-2', '-pix_fmt', 'yuvj420p',
    '-c:v', 'mjpeg', '-q:v', '7', '-r', String(f),
    '-f', 'mjpeg', 'pipe:1']);
}

// The JPEGs in ffmpeg's output: each from FF D8 to FF D9 (an encoded picture never has FF D9 inside: 0xFF is stuffed).
function splitter(onFrame) {
  var buf = null;
  return function (d) {
    buf = buf ? Buffer.concat([buf, d]) : d;
    for (;;) {
      var s = -1, e = -1, i;
      for (i = 0; i + 1 < buf.length; i++) if (buf[i] === 0xFF && buf[i + 1] === 0xD8) { s = i; break; }
      if (s < 0) { buf = buf.length ? buf.slice(buf.length - 1) : null; return; }
      for (i = s + 2; i + 1 < buf.length; i++) if (buf[i] === 0xFF && buf[i + 1] === 0xD9) { e = i + 2; break; }
      if (e < 0) { buf = buf.slice(s); if (buf.length > 4 << 20) buf = null; return; }
      onFrame(buf.slice(s, e));
      buf = buf.slice(e);
    }
  };
}

function tile(req, res, ALLOW, log, port, q) {
  var w = Math.max(160, Math.min(960, (+q.w | 0) || 640)) & ~1, f = Math.max(1, Math.min(30, +q.f || 12)), smooth = q.s === '1';
  var input = Convert.inputFor(q.u, q.ua || '', port), bin = Ffmpeg.binary();
  if (!input) { res.writeHead(400, ALLOW); return res.end('not a web address'); }
  if (!bin) { res.writeHead(503, ALLOW); return res.end('no converter on this TV yet'); }
  while (tiles.length >= MAX) { var old = tiles.shift(); if (log) log({ lv: 'info', event: 'multiview tile stopped for a newer one', id: old.id }); old.end(); }
  var t = { id: String(q.id || ++seq).slice(0, 20), w: w, f: f, frames: 0, dropped: 0, bytes: 0, t0: Date.now(), p: null, closed: false };
  var h = { 'Content-Type': 'multipart/x-mixed-replace; boundary=' + BOUNDARY, 'Cache-Control': 'no-store', 'Connection': 'close' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(200, h);
  try { t.p = cp.spawn('nice', ['-n', '10', bin].concat(args(input, w, f, smooth)), { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { try { t.p = cp.spawn(bin, args(input, w, f, smooth), { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e2) { return res.end(); } }
  var err = '', busy = false;
  t.p.stderr.on('data', function (d) { if (err.length < 2000) err += d; });
  t.p.stdout.on('data', splitter(function (jpg) {
    if (t.closed) return;
    if (busy) { t.dropped++; return; }
    t.frames++; t.bytes += jpg.length;
    if (t.frames === 1 && log) log({ lv: 'info', event: 'multiview tile first picture', id: t.id, ms: Date.now() - t.t0, w: w });
    busy = !res.write('--' + BOUNDARY + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpg.length + '\r\n\r\n');
    busy = !res.write(jpg) || busy;
    busy = !res.write('\r\n') || busy;
  }));
  res.on('drain', function () { busy = false; });
  t.end = function () {
    if (t.closed) return; t.closed = true;
    var i = tiles.indexOf(t); if (i >= 0) tiles.splice(i, 1);
    if (t.p) stopProc(t.p);
    try { res.end(); } catch (e) {}
  };
  t.p.on('close', function (code) {
    if (!t.closed && log) log({ lv: code ? 'warn' : 'info', event: 'multiview tile ended', id: t.id, code: code, frames: t.frames, e: err.trim().split('\n').pop().slice(0, 200) });
    t.end();
  });
  t.p.on('error', function () { t.end(); });
  req.on('close', function () { t.end(); });
  res.on('close', function () { t.end(); });
  tiles.push(t);
}

function isRoute(url) { return /^\/mv\//.test(url); }
function handle(req, res, ALLOW, log, port) {
  var m = /^\/mv\/([a-f0-9]{32})\/(tile\.mjpg|status)/.exec(req.url);
  if (!m || m[1] !== Convert.key) { res.writeHead(403, ALLOW); return res.end(); }
  if (m[2] === 'status') {
    var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; for (var k in ALLOW) h[k] = ALLOW[k];
    res.writeHead(200, h);
    return res.end(JSON.stringify({ ok: !!Ffmpeg.binary(), max: MAX, tiles: tiles.map(function (t) {
      var secs = Math.max(1, (Date.now() - t.t0) / 1000);
      return { id: t.id, w: t.w, f: t.f, frames: t.frames, dropped: t.dropped, fps: Math.round(t.frames / secs * 10) / 10, kbps: Math.round(t.bytes * 8 / secs / 1000), secs: Math.round(secs) };
    }) }));
  }
  tile(req, res, ALLOW, log, port, query(req.url));
}
function stopAll() { tiles.slice().forEach(function (t) { t.end(); }); }

module.exports = { isRoute: isRoute, handle: handle, stopAll: stopAll, _splitter: splitter, _args: args };
