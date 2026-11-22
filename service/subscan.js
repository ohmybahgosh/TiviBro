/* Subtitle lines of an MKV whose index (Cues) points only at the video, read by the helper in one pass.

   Most WEB-DL episodes are muxed so: every subtitle line is in the file, but nothing says where.  The
   app's own reader (app/js/mkvsubs.js, "scan") walks the Clusters near the picture, and that is slow
   to come back after a seek over the internet.  So the helper also reads the file through, from the
   Cluster at the playing position to the end, then from the first Cluster up to it, and keeps every
   line of the asked subtitle tracks.  Once a stretch is read, the app shows its lines at once, seeks
   included.  The video frames are streamed past, not kept: memory holds only the text.

     POST /media/subs/scan   { url, size, from, first, scale, tracks: [number...] }  -> { key }
     POST /media/subs/lines  { key, since: { track: count } }
                             -> { lines: { track: [[s, e, text]...] }, covered: [[fromSec, toSec]...], done, error }

   url is the file's address as the app plays it (the helper's own /x/ link for HTTPS).  from and first
   are byte offsets of Clusters (the one at the playing position, and the first); scale is the
   TimecodeScale.  Text comes back as stored (the app turns ASS/SSA and tags into plain text). */
'use strict';
var http = require('http'), https = require('https'), URL_ = require('url');

var JOBS = {}, ORDER = [], KEEP = 3;           // the last three files read, like the app's own cache
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

// GET bytes [from, to) of url, following redirects; onData(chunk) as it streams; done(err).
function stream(url, from, to, onData, done, hops) {
  var u = URL_.parse(url), lib = u.protocol === 'https:' ? https : http, finished = false;
  function end(e) { if (!finished) { finished = true; done(e); } }
  var req = lib.get({ hostname: u.hostname, port: u.port, path: u.path, headers: { Range: 'bytes=' + from + '-' + (to - 1), 'User-Agent': 'TiviBro' } }, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 4) { res.resume(); return stream(URL_.resolve(url, res.headers.location), from, to, onData, end, (hops || 0) + 1); }
    if (res.statusCode !== 206) { res.resume(); return end(new Error('HTTP ' + res.statusCode + ' for a part of the file')); }
    res.on('data', function (c) { try { onData(c); } catch (e) { req.abort(); end(e); } });
    res.on('end', function () { end(null); });
    res.on('error', end);
  });
  req.on('error', end);
  req.setTimeout(30000, function () { req.abort(); end(new Error('the file stopped answering')); });
  return req;
}

// Starts (or finds) the read of one file.  One job per file and set of tracks; the oldest beyond KEEP go.
function scan(q, cb) {
  var url = String(q.url || ''), size = +q.size, from = +q.from, first = +q.first, scale = +q.scale || 1000000;
  var tracks = (Array.isArray(q.tracks) ? q.tracks : []).map(Number).filter(function (n) { return n > 0 && n < 128; }).slice(0, 64);
  if (!/^https?:\/\//.test(url) || !(size > 0) || !(from >= 0) || !(first >= 0) || from > size || !tracks.length) return cb({ error: 'bad request' });
  var key = url.split('?')[0].slice(-200) + '|' + size + '|' + tracks.join(',');
  var job = JOBS[key];
  if (!job) {
    job = JOBS[key] = { lines: {}, covered: [], done: false, error: '', chars: 0 };
    tracks.forEach(function (t) { job.lines[t] = []; });
    ORDER.push(key);
    while (ORDER.length > KEEP) { var old = JOBS[ORDER.shift()]; if (old && old.req) old.req.abort(); }
    Object.keys(JOBS).forEach(function (k) { if (ORDER.indexOf(k) < 0) delete JOBS[k]; });
    run(job, url, size, from, first, scale, tracks);
  }
  cb({ key: key });
}
// The two passes: the playing position to the end, then the start to the playing position.
function run(job, url, size, from, first, scale, tracks) {
  var passes = [[from, size]];
  if (first < from) passes.push([first, from]);
  (function next(i) {
    if (i >= passes.length) { job.done = true; job.req = null; return; }
    var span = null;
    var feed = Reader(tracks, scale, function (t, s, e, text) {
      if (job.chars > MAX_CHARS) return;
      job.chars += text.length; job.lines[t].push([s, e, text]);
    }, function (sec) {
      if (!span) { span = [sec, sec]; job.covered.push(span); } else span[1] = Math.max(span[1], sec);
    });
    job.req = stream(url, passes[i][0], passes[i][1], feed, function (e) {
      if (e && !job.aborted) { job.error = e.message; job.done = true; return; }
      // A pass read to its end: the first covers the rest of the file, the second everything up to the first's start.
      if (span) span[1] = i === 0 ? Infinity : Math.max(span[1], job.covered[0] ? job.covered[0][0] : span[1]);
      next(i + 1);
    });
  })(0);
}
// The lines found since the app last asked (per track, by count), and what is covered so far.
function lines(q, cb) {
  var job = JOBS[String(q.key || '')];
  if (!job) return cb({ error: 'gone' });
  var since = q.since && typeof q.since === 'object' ? q.since : {}, out = {};
  Object.keys(job.lines).forEach(function (t) { out[t] = job.lines[t].slice(Math.max(0, +since[t] || 0), (+since[t] || 0) + 3000); });
  cb({ lines: out, covered: job.covered.map(function (c) { return [c[0], c[1] === Infinity ? 1e9 : c[1]]; }), done: job.done, error: job.error });
}

module.exports = { scan: scan, lines: lines, _test: { Reader: Reader } };
