/* Seek previews: a small picture of the movie at the time you are seeking to, made on the TV from the movie
   playing now (never the library).  ffmpeg jumps to the keyframe at or before that time (the file's own index:
   Matroska Cues, an MP4's sample table), decodes the first frame from there (that keyframe) in software, makes it small and sends it as a
   JPEG.  Only the frame's own bytes and the index are read, not the movie.

     GET /preview/<key>/frame.jpg?u=<movie link>&t=<seconds>&w=<width>[&ua=<User-Agent>][&p=1]
         the picture (image/jpeg), or 204 when there is none (no converter with video decoders, not a movie it
         can read, too slow).  p=1: a picture asked ahead (the spread over the movie, or the next presses): it waits
         behind the pictures asked for now, and is dropped when a newer request for now comes.
     GET /preview/<key>/status   { ok: can it make pictures, made, cached }
     GET /preview/<key>/chapters?u=<movie link>[&ua=]   { chapters: [{ s, e, t }] } (seconds, title): the file's own
         chapters (Matroska, MP4), read by ffmpeg from the file's header (any converter will do, no decoders
         needed).  For chapter marks on the player's bar, Skip intro and the next-episode card at the credits.

   The key is the converter's (convert.js: random each start, only TiviBro has it), since an <img> can't send the
   helper's secret.  One ffmpeg at a time, at a low priority (nice 15), one decoding thread: on a 4K HEVC movie a
   frame costs a few hundred MB of the TV's memory for a moment, so TiviBro asks only for movies up to 1080p when
   Memory-safe playback is on (app/js/seekprev.js).  Pictures are kept in memory for the movie playing (up to
   200, about 3 MB), and forgotten when another movie asks.  Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var cp = require('child_process');
var Ffmpeg = require('./ffmpeg');
var Convert = require('./convert');
var BlockCache = require('./blockcache');

var MAX_KEEP = 200, MAX_WAIT = 6, TIMEOUT = 20000;
var cache = {}, order = [], movie = '', queue = [], running = null, made = 0, can = null, canCbs = [];

function stopProc(p) { try { p.kill('SIGTERM'); } catch (e) {} setTimeout(function () { try { p.kill('SIGKILL'); } catch (e) {} }, 2000); }

// Does this TV's ffmpeg have the video decoders and the JPEG encoder (ffmpeg-7.1-tb2 and later)?  Asked once.
function capable(cb) {
  if (can !== null) return cb(can);
  canCbs.push(cb);
  if (canCbs.length > 1) return;
  var bin = Ffmpeg.binary();
  var done = function (v) { if (bin) can = v; var c = canCbs; canCbs = []; c.forEach(function (f) { f(v); }); };
  if (!bin) return done(false);
  var out = '', p;
  try { p = cp.spawn(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return done(false); }
  p.stdout.on('data', function (d) { if (out.length < 100000) out += d; });
  p.on('error', function () { done(false); });
  p.on('close', function () { done(/\bmjpeg\b/.test(out)); });
}

function remember(k, buf) {
  if (!cache[k]) order.push(k);
  cache[k] = buf;
  while (order.length > MAX_KEEP) delete cache[order.shift()];
}
function query(url) {
  var q = {}, s = url.split('?')[1] || '';
  s.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i); try { q[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' ')); } catch (e) {} });
  return q;
}
function args(input, t, w) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '1', '-protocol_whitelist', 'http,tcp,file',
    '-probesize', '2000000', '-analyzeduration', '0'].concat(
    // Through the piece cache (blockcache.js), whose answers are 256 KB at most: ask again from there, at once.
    input.indexOf('/preview/') >= 0 ? ['-reconnect', '1', '-reconnect_at_eof', '1', '-reconnect_delay_max', '0'] : [],
    ['-noaccurate_seek', '-ss', String(t), '-i', input,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-frames:v', '1', '-fps_mode', 'passthrough', '-vf', 'scale=' + w + ':-2:flags=fast_bilinear,format=yuvj420p',
    '-q:v', '5', '-f', 'mjpeg', 'pipe:1']);
}

/* ---------- chapters ---------- */
var chapterCache = {}, chapterOrder = [];
function parseChapters(text) {
  var out = [], cur = null;
  String(text).split('\n').forEach(function (l) {
    var m = /^\s*Chapter #\d+:\d+: start (-?[\d.]+), end (-?[\d.]+)/.exec(l);
    if (m) { cur = { s: Math.max(0, +m[1]), e: Math.max(0, +m[2]), t: '' }; out.push(cur); return; }
    var t = /^\s*title\s*:\s*(.*)$/.exec(l);
    if (t && cur && !cur.t) cur.t = t[1].trim().slice(0, 120);
    if (/^\s*Stream #/.test(l)) cur = null;
  });
  return out.filter(function (c) { return c.e > c.s; }).slice(0, 200);
}
function chapters(input, cb) {
  if (chapterCache[input]) return cb(chapterCache[input]);
  var bin = Ffmpeg.binary(); if (!bin) return cb([]);
  var err = '', p, done = false;
  try { p = cp.spawn(bin, ['-hide_banner', '-nostdin', '-protocol_whitelist', 'http,tcp,file', '-probesize', '2000000', '-analyzeduration', '0', '-i', input], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { return cb([]); }
  var timer = setTimeout(function () { stopProc(p); }, 15000);
  p.stderr.on('data', function (d) { if (err.length < 400000) err += d; });
  var end = function () { if (done) return; done = true; clearTimeout(timer); var c = parseChapters(err); chapterCache[input] = c; chapterOrder.push(input); while (chapterOrder.length > 20) delete chapterCache[chapterOrder.shift()]; cb(c); };
  p.on('error', end); p.on('close', end);
}

function next() {
  if (running || !queue.length) return;
  var job = queue.shift(), bin = Ffmpeg.binary();
  if (!bin) { job.cbs.forEach(function (f) { f(null); }); return next(); }
  var chunks = [], size = 0, p;
  try { p = cp.spawn('nice', ['-n', '15', bin].concat(args(job.input, job.t, job.w)), { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { try { p = cp.spawn(bin, args(job.input, job.t, job.w), { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e2) { job.cbs.forEach(function (f) { f(null); }); return next(); } }
  running = { job: job, p: p };
  var timer = setTimeout(function () { stopProc(p); }, TIMEOUT), t0 = Date.now();
  p.stdout.on('data', function (d) { size += d.length; if (size < 2000000) chunks.push(d); else stopProc(p); });
  var end = function () {
    clearTimeout(timer); if (!running || running.p !== p) return;
    running = null;
    var buf = size > 200 && size < 2000000 ? Buffer.concat(chunks) : null;
    if (buf && job.movie === movie) { remember(job.k, buf); made++; }
    job.ms = Date.now() - t0;
    job.cbs.forEach(function (f) { f(buf, job.ms); });
    next();
  };
  p.on('error', end); p.on('close', end);
}

// A picture for (input, t, w): from memory, or queued (now first, ahead behind; a newer "now" drops the older ones).
function picture(input, t, w, ahead, cb) {
  var k = input + '|' + t + '|' + w;
  if (cache[k]) return cb(cache[k], 0, true);
  if (running && running.job.k === k) return running.job.cbs.push(cb);
  for (var i = 0; i < queue.length; i++) if (queue[i].k === k) {
    var found = queue[i];
    if (!ahead && found.ahead) { queue.splice(i, 1); found.ahead = false; queue.unshift(found); }   // asked for now: first
    found.cbs.push(cb); return;
  }
  var job = { k: k, input: input, t: t, w: w, ahead: ahead, movie: movie, cbs: [cb] };
  if (ahead) queue.push(job);
  else {
    // Seeking moved on: what was asked for earlier "now" is no longer wanted (its requests get no picture).
    queue = queue.filter(function (x) { if (!x.ahead) { x.cbs.forEach(function (f) { f(null); }); return false; } return true; });
    queue.unshift(job);
  }
  while (queue.length > MAX_WAIT) { var drop = queue.pop(); drop.cbs.forEach(function (f) { f(null); }); }
  next();
}

function handle(req, res, ALLOW, log, port) {
  var m = /^\/preview\/([a-f0-9]{32})\/(frame\.jpg|status|chapters|src)/.exec(req.url);
  if (!m || m[1] !== Convert.key) { res.writeHead(403, ALLOW); return res.end(); }
  if (m[2] === 'status') return capable(function (ok) { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, ALLOW)); res.end(JSON.stringify({ ok: ok, made: made, cached: order.length })); });
  var q = query(req.url), t = Math.max(0, Math.round(+q.t || 0)), w = Math.max(96, Math.min(640, +q.w | 0 || 320));
  var input = Convert.inputFor(q.u, q.ua || '', port);
  if (!input) { res.writeHead(400, ALLOW); return res.end('not a web address'); }
  var lean = q.l === '1', cap = lean ? 4 << 20 : 16 << 20;
  // What ffmpeg reads for a picture: the movie through the piece cache (blockcache.js).
  if (m[2] === 'src') return BlockCache.serve(req, res, input, cap);
  if (m[2] === 'chapters') return chapters(input, function (c) { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, ALLOW)); res.end(JSON.stringify({ chapters: c })); });
  capable(function (ok) {
    if (!ok) { res.writeHead(204, ALLOW); return res.end(); }
    // Another movie: the last one's pictures go.
    if (q.u !== movie) { movie = q.u; cache = {}; order = []; BlockCache._reset(); queue.forEach(function (x) { x.cbs.forEach(function (f) { f(null); }); }); queue = []; if (running) stopProc(running.p); }
    var gone = false; req.on('close', function () { gone = true; });
    // ffmpeg reads the movie through the piece cache, so the start and the index are fetched once, not per picture.
    var via = BlockCache.noRange ? input : 'http://127.0.0.1:' + port + '/preview/' + m[1] + '/src?u=' + encodeURIComponent(q.u) + (q.ua ? '&ua=' + encodeURIComponent(q.ua) : '') + (lean ? '&l=1' : '');
    picture(via, t, w, q.p === '1', function (buf, ms, hit) {
      if (gone) return;
      if (!buf) { res.writeHead(204, ALLOW); return res.end(); }
      if (!hit && log) log({ lv: 'debug', event: 'seek preview', t: t, ms: ms, b: buf.length, cache: BlockCache.stats() });
      res.writeHead(200, Object.assign({ 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' }, ALLOW));
      res.end(buf);
    });
  });
}
function isRoute(url) { return url.indexOf('/preview/') === 0; }

module.exports = { handle: handle, isRoute: isRoute, args: args, parseChapters: parseChapters, _reset: function () { cache = {}; order = []; movie = ''; queue = []; can = null; made = 0; } };
