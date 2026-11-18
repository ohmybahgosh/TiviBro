/* The movie playing, as ffmpeg reads it for seek previews (seekprev.js), kept in small pieces in memory.

   Each preview runs ffmpeg once, and each run reads the file's start, its index (an MKV's Cues are often at the
   end, an MP4's moov at either end) and then the keyframe.  Over Google Drive or a slow server, those reads were
   most of the 2 to 3 seconds a picture took.  Here they are read once and kept: ffmpeg reads this file
   (GET /preview/<key>/src?u=<movie>, with Range), and only the pieces nobody read yet are asked from the source.
   Each answer is at most 256 KB (WINDOW), and ffmpeg asks again from where it got to (-reconnect_at_eof,
   seekprev.js args): without that, the TV's network buffers let ffmpeg's connection swallow many MB it never
   needed, all of it read from the source.  One request of ffmpeg's is at most one to the source (the pieces of
   its window not kept yet, in one Range request).  The second picture on reads only around its keyframe.

   Memory: at most 16 MB of pieces (4 MB on a TV short of memory: seekprev's &l=1), the least recently read go
   first, so the start and the index, read by every run, stay.  Another movie, or 10 minutes without a read,
   empties it.  A source that doesn't answer a Range request (rare) is read directly as before (noRange).
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), https = require('https'), URL_ = require('url');

var BLOCK = 131072, WINDOW = 262144, IDLE = 600000;
var st = fresh('', 0);

function fresh(origin, cap) { return { origin: origin, size: -1, blocks: {}, order: [], bytes: 0, cap: cap || 16 << 20, noRange: false, pending: {}, timer: null, reads: 0, misses: 0 }; }
// The movie this cache is for (another one empties it), and how much it may keep.
function use(origin, cap) {
  if (st.origin !== origin) { clearTimeout(st.timer); st = fresh(origin, cap); }
  st.cap = cap;
  clearTimeout(st.timer); st.timer = setTimeout(function () { st = fresh('', 0); }, IDLE);
  trim();
  return st;
}
function touch(i) { var k = st.order.indexOf(i); if (k >= 0) st.order.splice(k, 1); st.order.push(i); }
function trim() { while (st.bytes > st.cap && st.order.length > 1) { var i = st.order.shift(); if (st.blocks[i]) { st.bytes -= st.blocks[i].length; delete st.blocks[i]; } } }

// Ask the source for pieces [i, i + n) in one Range request; each waiting callback gets its piece or an error.
function fetchRun(s, i, n, cb) {
  if (s.size >= 0) n = Math.max(1, Math.min(n, Math.ceil(s.size / BLOCK) - i));
  var from = i * BLOCK, to = (i + n) * BLOCK - 1, idx = [];
  for (var j = i; j < i + n; j++) { if (s.blocks[j] || s.pending[j]) { n = j - i; break; } s.pending[j] = []; idx.push(j); }
  if (!idx.length) return cb();
  to = (i + idx.length) * BLOCK - 1;
  if (s.size > 0) to = Math.min(to, s.size - 1);   // never past the end (a server that doesn't cut it short sends less than it says)
  var p = URL_.parse(s.origin), lib = p.protocol === 'https:' ? https : http, done = false;
  s.misses++;
  var finish = function (err) {
    if (done) return; done = true;
    idx.forEach(function (j) { var w = s.pending[j] || []; delete s.pending[j]; w.forEach(function (f) { f(err); }); });
    cb(err);
  };
  var req = lib.request({ hostname: p.hostname, port: p.port, path: p.path, method: 'GET', agent: false, rejectUnauthorized: false, headers: { Range: 'bytes=' + from + '-' + to, Accept: '*/*' } }, function (r) {
    var cr = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/.exec(r.headers['content-range'] || '');
    if (r.statusCode !== 206 || !cr || +cr[1] !== from) {
      r.resume();
      if (r.statusCode === 200 || r.statusCode === 206) s.noRange = true;   // a whole file for a piece: read it directly instead
      if (r.statusCode === 416 && s.size < 0) s.size = from;
      return finish(new Error('the source answered ' + r.statusCode));
    }
    if (cr[3] !== '*') s.size = +cr[3];
    var chunks = [], got = 0;
    r.on('data', function (d) { chunks.push(d); got += d.length; });
    r.on('error', function (e) { finish(e); });
    r.on('end', function () {
      if (s !== st) return finish(new Error('another movie'));
      var all = Buffer.concat(chunks, got);
      idx.forEach(function (j, k) { var part = all.slice(k * BLOCK, (k + 1) * BLOCK); if (part.length) { s.blocks[j] = part; s.bytes += part.length; touch(j); } });
      trim();
      finish(null);
    });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(20000, function () { req.abort(); });
  req.end();
}
// Piece i: kept, being fetched (wait for it), or fetched now with the n - 1 after it.
function piece(s, i, n, cb) {
  if (s.blocks[i]) { touch(i); s.reads++; return cb(null, s.blocks[i], true); }
  if (s.pending[i]) return s.pending[i].push(function (e) { cb(e, s.blocks[i], false); });
  fetchRun(s, i, n, function (e) { cb(e || (s.blocks[i] ? null : new Error('missing piece')), s.blocks[i], false); });
}

/* GET /preview/<key>/src: what ffmpeg reads.  origin: the movie's link through the helper (convert.js inputFor). */
function serve(req, res, origin, cap) {
  var s = use(origin, cap);
  var rg = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''), from = rg ? +rg[1] : 0, gone = false;
  req.on('close', function () { gone = true; });
  // The size comes with the first piece.
  piece(s, Math.floor(from / BLOCK), 2, function (e) {
    if (gone) return;
    if (e || s.size < 0) { res.writeHead(s.size >= 0 && from >= s.size ? 416 : 502, { 'Content-Range': 'bytes */' + Math.max(0, s.size) }); return res.end(); }
    var last = Math.min(rg && rg[2] ? +rg[2] : s.size - 1, s.size - 1, from + WINDOW - 1);
    if (from > last) { res.writeHead(416, { 'Content-Range': 'bytes */' + s.size }); return res.end(); }
    res.writeHead(rg ? 206 : 200, Object.assign({ 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': last - from + 1 }, rg ? { 'Content-Range': 'bytes ' + from + '-' + last + '/' + s.size } : {}));
    if (req.method === 'HEAD') return res.end();
    var pos = from, lastPiece = Math.floor(last / BLOCK);
    (function more() {
      if (gone || s !== st) return res.end();
      if (pos > last) return res.end();
      var i = Math.floor(pos / BLOCK);
      piece(s, i, lastPiece - i + 1, function (err, buf) {   // a missing piece comes with the rest of the window
        if (gone) return;
        if (err || !buf) return res.destroy();
        var part = buf.slice(pos - i * BLOCK, Math.min(buf.length, last - i * BLOCK + 1));
        pos += part.length;
        if (!part.length) return res.end();
        if (res.write(part)) more(); else res.once('drain', more);
      });
    })();
  });
}

module.exports = { serve: serve, get noRange() { return st.noRange; }, stats: function () { return { bytes: st.bytes, pieces: st.order.length, reads: st.reads, misses: st.misses, size: st.size }; }, _reset: function () { clearTimeout(st.timer); st = fresh('', 0); }, BLOCK: BLOCK };
