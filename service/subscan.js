/* Subtitle lines of an MKV whose index (Cues) points only at the video, read from the bytes the TV is
   already downloading: no second download.

   Most WEB-DL episodes and movies are muxed so: every subtitle line is in the file, but nothing says
   where, and reading the file again to find them would double the data (a movie is gigabytes).  But
   the TV's player fetches the file through this helper (proxy.js, for HTTPS and custom headers), so
   the helper looks at those bytes on their way past: from the first Cluster in each answer on, the
   subtitle blocks of the asked tracks are kept and everything else streams by untouched.  The player
   reads ahead of the picture, so a line is here before it's due, and a seek's new reads bring the
   lines from there.

     POST /media/subs/scan   { size, scale, tracks: [number...], clusters: [byte offset...] }  -> { key }
     POST /media/subs/lines  { key, since: { track: count } }
                             -> { lines: { track: [[s, e, text]...] }, covered: [[fromSec, toSec]...], seen, done }

   size is the file's (it picks out the file's answers in the proxy), clusters the Cluster offsets the
   Cues name (where an answer that starts mid-Cluster can start reading), scale the TimecodeScale.
   Text comes back as stored (the app turns ASS/SSA and tags into plain text). */
'use strict';

var JOBS = {}, BYSIZE = {}, ORDER = [], KEEP = 3;           // the last three files asked for, like the app's own cache
var MAX_CHARS = 4000000;                       // text kept per file (every language of a long movie fits)

// EBML: the length of an ID or size from its first byte (the number of leading zero bits, plus one).
function vlen(b) { for (var n = 1, m = 0x80; n <= 8; n++, m >>= 1) if (b & m) return n; return 0; }
var CLUSTER = 0x1F43B675, TIMECODE = 0xE7, SIMPLEBLOCK = 0xA3, BLOCKGROUP = 0xA0, BLOCK = 0xA1, DURATION = 0x9B, SEGMENT = 0x18538067;

/* A streaming reader of Matroska elements from a Cluster boundary on.  Clusters and BlockGroups are
   entered (their children follow); the cluster timestamp, subtitle blocks and block durations are read;
   everything else (video and audio blocks, Cues, Tags) is skipped as it streams by.  onLine(track, s, e,
   text) for each line; onTime(sec) as Clusters go by, for what is covered. */
function Reader(tracks, scale, onLine, onTime) {
  var pos = 0, need = null, blk = null, skip = 0, buf = Buffer.concat([]), stamp = 0, groupEnd = -1, pending = null, want = {};
  tracks.forEach(function (t) { want[t] = true; });
  function flush() {
    if (!pending) return;
    var p = pending; pending = null;
    var s = (stamp + p.rel) * scale / 1e9, e = s + (p.dur != null ? p.dur * scale / 1e9 : 2);
    onLine(p.track, s, e, p.text);
  }
  // One element header at the front of buf, or null when more bytes are needed.
  function header() {
    if (buf.length < 1) return null;
    var il = vlen(buf[0]); if (!il || il > 4) throw new Error('not a Matroska element');
    if (buf.length < il + 1) return null;
    var sl = vlen(buf[il]); if (!sl) throw new Error('bad element size');
    if (buf.length < il + sl) return null;
    var id = 0, size = buf[il] & (0xFF >> sl), unknown = size === (0xFF >> sl);
    for (var i = 0; i < il; i++) id = id * 256 + buf[i];
    for (var j = 1; j < sl; j++) { size = size * 256 + buf[il + j]; if (buf[il + j] !== 0xFF) unknown = false; }
    return { id: id, size: unknown ? -1 : size, len: il + sl };
  }
  function take(n) { var out = buf.slice(0, n); buf = buf.slice(n); pos += n; return out; }
  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (skip) { var k = Math.min(skip, buf.length); buf = buf.slice(k); pos += k; skip -= k; if (skip) return; }
      if (groupEnd >= 0 && pos >= groupEnd) { groupEnd = -1; flush(); }
      // A block's track is in its first byte or two: keep it only if it's a subtitle track asked for.
      if (blk) {
        if (buf.length < Math.min(blk.size, 4)) return;
        var tl0 = vlen(buf[0]), tn0 = buf[0] & (0xFF >> tl0);
        for (var z = 1; z < tl0; z++) tn0 = tn0 * 256 + buf[z];
        if (want[tn0] && blk.size <= 262144) need = { id: blk.id, size: blk.size }; else skip = blk.size;
        blk = null; continue;
      }
      if (need) {
        if (buf.length < need.size) return;
        var body = take(need.size), what = need; need = null;
        if (what.id === TIMECODE) { flush(); stamp = 0; for (var a = 0; a < body.length; a++) stamp = stamp * 256 + body[a]; onTime(stamp * scale / 1e9); }
        else if (what.id === DURATION) { var d = 0; for (var b = 0; b < body.length; b++) d = d * 256 + body[b]; if (pending) pending.dur = d; }
        else if (what.id === SIMPLEBLOCK || what.id === BLOCK) {
          var tl = vlen(body[0]), tn = body[0] & (0xFF >> tl);
          for (var c = 1; c < tl; c++) tn = tn * 256 + body[c];
          var rel = body.readInt16BE(tl), flags = body[tl + 2];
          if (want[tn] && !(flags & 0x06)) {
            flush();
            pending = { track: tn, rel: rel, dur: null, text: body.slice(tl + 3).toString('utf8') };
            if (what.id === SIMPLEBLOCK || groupEnd < 0) flush();
          }
        }
        continue;
      }
      var h = header(); if (!h) return;
      take(h.len);
      if (h.id === CLUSTER || h.id === SEGMENT) continue;                       // entered
      if (h.id === BLOCKGROUP) { flush(); groupEnd = h.size < 0 ? -1 : pos + h.size; continue; }
      if (h.size < 0) throw new Error('an element of unknown size');
      if (h.id === TIMECODE || h.id === DURATION) { need = { id: h.id, size: h.size }; continue; }
      if (h.id === SIMPLEBLOCK || h.id === BLOCK) { blk = h; continue; }     // decided once its first bytes are in
      skip = h.size;
    }
  };
}

// The file to watch for: one job per file (by size) and set of tracks; the oldest beyond KEEP go.
function scan(q, cb) {
  var size = +q.size, scale = +q.scale || 1000000;
  var tracks = (Array.isArray(q.tracks) ? q.tracks : []).map(Number).filter(function (n) { return n > 0 && n < 128; }).slice(0, 64);
  var clusters = (Array.isArray(q.clusters) ? q.clusters : []).map(Number).filter(function (n) { return n >= 0 && n < size; }).sort(function (a, b) { return a - b; });
  if (!(size > 0) || !tracks.length || !clusters.length) return cb({ error: 'bad request' });
  var key = size + '|' + tracks.join(',');
  if (!JOBS[key]) {
    var job = JOBS[key] = { size: size, scale: scale, tracks: tracks, clusters: clusters, lines: {}, have: {}, covered: [], chars: 0, seen: 0 };
    tracks.forEach(function (t) { job.lines[t] = []; });
    BYSIZE[size] = job;
    ORDER.push(key);
    while (ORDER.length > KEEP) { var old = JOBS[ORDER.shift()]; if (old) { if (BYSIZE[old.size] === old) delete BYSIZE[old.size]; delete JOBS[old.size + '|' + old.tracks.join(',')]; } }
  }
  cb({ key: key });
}
/* For the proxy: every part of a large file it passes on ("bytes 1000-1999/123456789") gets a watcher that only
   counts bytes until the app asks for that file (by size): the player starts the video before the app has read
   the file's index, and its first answer can run for the whole film.  From then on, from the first Cluster at
   or after the current position, the subtitle blocks are kept.  It never throws (the video comes first): a
   problem stops looking at that answer. */
function tap(contentRange) {
  var m = /^bytes (\d+)-\d+\/(\d+)$/i.exec(String(contentRange || ''));
  if (!m || +m[2] < 1048576) return null;
  var pos = +m[1], total = +m[2], job = null, from = -1, feed = null, span = null, dead = false;
  function start() {
    var lo = 0, hi = job.clusters.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (job.clusters[mid] < pos) lo = mid + 1; else hi = mid; }
    if (lo >= job.clusters.length) { dead = true; return; }
    from = job.clusters[lo];
    feed = Reader(job.tracks, job.scale, function (t, s, e, text) {
      var k = t + '|' + Math.round(s * 100) + '|' + text;
      if (job.have[k] || job.chars > MAX_CHARS) return;
      job.have[k] = 1; job.chars += text.length; job.lines[t].push([s, e, text]);
    }, function (sec) {
      if (!span) { span = [sec, sec]; job.covered.push(span); if (job.covered.length > 400) job.covered.shift(); } else span[1] = Math.max(span[1], sec);
    });
  }
  return function (chunk) {
    if (dead) return;
    try {
      if (!job) { job = BYSIZE[total] || null; if (job) start(); if (dead) return; }
      if (!job) { pos += chunk.length; return; }
      job.seen += chunk.length;
      if (pos + chunk.length <= from) { pos += chunk.length; return; }
      if (pos < from) { chunk = chunk.slice(from - pos); pos = from; }
      pos += chunk.length;
      feed(chunk);
    } catch (e) { dead = true; }
  };
}
// The lines found since the app last asked (per track, by count), and what is covered so far.
function lines(q, cb) {
  var job = JOBS[String(q.key || '')];
  if (!job) return cb({ error: 'gone' });
  var since = q.since && typeof q.since === 'object' ? q.since : {}, out = {};
  Object.keys(job.lines).forEach(function (t) { out[t] = job.lines[t].slice(Math.max(0, +since[t] || 0), (+since[t] || 0) + 3000); });
  cb({ lines: out, covered: job.covered.map(function (c) { return [c[0], c[1]]; }), seen: job.seen, done: false });
}

module.exports = { scan: scan, lines: lines, tap: tap, _test: { Reader: Reader } };
