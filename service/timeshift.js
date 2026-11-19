/* Live pause and rewind (timeshift) to a USB drive.  record.js's routes hand /record/ts/ here, so on a rooted TV it
   runs in the recording agent (root, outside the jail, where the drive is).
   A session reads a channel through the helper's relay (one connection to the provider, the same as watching) and
   keeps it on the drive as short pieces, offered to the player as a live HLS playlist whose window grows from the
   moment it started (up to its limit; the oldest pieces are dropped after that).  The player plays that playlist
   instead of the channel, so pause holds the place, ◀ goes back as far as the window and ▶ comes back to live.
   - MPEG-TS from the provider: cut into pieces of about 4 s, each at a keyframe (H.264, HEVC, MPEG-2), each
     starting with the stream's PAT and PMT so it plays on its own; a piece's length is from its timestamps.
   - HLS from the provider: its pieces, kept as they come (fMP4 with its init segment).
   A dropped connection is asked for again; the playlist marks the join (#EXT-X-DISCONTINUITY).
   A session nobody asked about for 90 s (the player gone, TiviBro closed) stops and its pieces are deleted.
   Pieces live in "<drive>/TiviBro Recordings/.timeshift/<id>/"; whatever an earlier run left there is cleared.
     POST /record/ts/start { url, max? }  -> { id, playlist }   (the same url again: the session running for it)
     POST /record/ts/ping  { id }         -> { id, sec, pieces, ready, error }
     POST /record/ts/stop  { id }
     GET  /record/ts/<id>/live.m3u8, /record/ts/<id>/<n>.ts|.m4s, /record/ts/<id>/init.mp4   (no secret: the player)
   Plain ES5 for Node 0.12. */
'use strict';
var fs = require('fs'), path = require('path');

var PIECE = +(process.env.TIVIBRO_TS_PIECE || 4), MAX_SEC = 2 * 3600, IDLE_MS = +(process.env.TIVIBRO_TS_IDLE_MS || 90000);
var MIN_FREE_MB = 1024, MAX_SESSIONS = 2;
var WAIT_MS = +(process.env.TIVIBRO_TS_WAIT_MS || 10000);
var sessions = {}, reaper = null, io = null, logf = function () {};

function note(lv, event, more) { var o = { lv: lv, event: event }; for (var k in more || {}) o[k] = more[k]; logf(o); }
function setup(o) { io = o; if (o.log) logf = o.log; }
function rmrf(d) {
  var list = []; try { list = fs.readdirSync(d); } catch (e) { return; }
  list.forEach(function (f) { var p = path.join(d, f); try { if (fs.statSync(p).isDirectory()) rmrf(p); else fs.unlinkSync(p); } catch (e) {} });
  try { fs.rmdirSync(d); } catch (e) {}
}
function baseOn(folder) { var d = path.join(folder, '.timeshift'); try { fs.mkdirSync(d); } catch (e) {} return d; }
var cleared = {};
function clearOld(base) {
  if (cleared[base]) return; cleared[base] = 1;
  var list = []; try { list = fs.readdirSync(base); } catch (e) {}
  list.forEach(function (f) { if (!sessions[f]) rmrf(path.join(base, f)); });
}

/* ---------- a session ---------- */
function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function begin(url, max, folder, key, alt) {
  key = String(key || url);
  for (var k in sessions) if (sessions[k].key === key && !sessions[k].stopped) { sessions[k].seen = Date.now(); return sessions[k]; }
  // The oldest goes when there are too many (a channel change leaves one behind until it idles out).
  var ids = Object.keys(sessions).sort(function (a, b) { return sessions[a].born - sessions[b].born; });
  while (ids.length >= MAX_SESSIONS) stop(sessions[ids.shift()], 'another channel');
  var base = baseOn(folder); clearOld(base);
  var S = { id: newId(), key: key, url: url, max: Math.min(Math.max(+max || MAX_SEC, 60), 6 * 3600), born: Date.now(), seen: Date.now(),
    pieces: [], n: 0, disc: 0, cutDisc: false, stopped: false, error: '', kind: '', init: null, folder: folder, alt: alt || '' };
  S.dir = path.join(base, S.id);
  try { fs.mkdirSync(S.dir); } catch (e) { S.error = 'the drive refused it: ' + e.message; }
  sessions[S.id] = S;
  if (!reaper) { reaper = setInterval(reap, 10000); if (reaper.unref) reaper.unref(); }
  if (!S.error) listen(S);
  note('info', 'timeshift started', { id: S.id, shared: !!(S.feed && S.feed.shared) });
  return S;
}
function reap() {
  var now = Date.now();
  Object.keys(sessions).forEach(function (k) { var S = sessions[k]; if (now - S.seen > IDLE_MS) stop(S, 'nobody watching'); });
  if (!Object.keys(sessions).length && reaper) { clearInterval(reaper); reaper = null; }
}
function stop(S, why) {
  if (!S) return;
  S.stopped = true;
  try { if (S.feed) S.feed.close(); } catch (e) {}
  delete sessions[S.id];
  note('info', 'timeshift stopped', { id: S.id, why: why || '', sec: Math.round(total(S)) });
  setTimeout(function () { rmrf(S.dir); }, 1500);       // after a read in flight
}
function total(S) { var t = 0; S.pieces.forEach(function (p) { t += p.dur; }); return t; }
/* What arrives on the channel's feed (feed.js: one connection per channel, shared with a recording of it):
   MPEG-TS bytes are cut into pieces here, HLS pieces are kept as they come. */
function listen(S) {
  S.feed = io.feed.open(S.key, S.url, S.alt, {
    kind: function (k) { S.kind = k; },
    init: function (b) { S.init = b; try { fs.writeFileSync(path.join(S.dir, 'init.mp4'), b); } catch (e) {} },
    data: function (c) { if (S.stopped) return; if (!S.cutter) S.cutter = cutter(S); S.cutter.push(c); },
    piece: function (pc) {
      if (S.stopped) return;
      if (!pc.buf) { S.cutDisc = true; return; }
      if (pc.disc) S.cutDisc = true;
      var n = S.n++, f = n + (S.init ? '.m4s' : '.ts');
      try { fs.writeFileSync(path.join(S.dir, f), pc.buf); } catch (x) { S.error = 'the drive refused it: ' + x.message; return stop(S, S.error); }
      added(S, { n: n, f: f, dur: pc.dur, bytes: pc.buf.length, at: Date.now() });
    },
    // A dropped connection: what's half cut is let go, and the playlist marks the join.
    down: function () { S.cutDisc = true; S.cutter = null; S.gaps = (S.gaps || 0) + 1; },
    fatal: function (why) { S.error = why; stop(S, why); }
  });
}
/* A finished piece: listed, and the oldest dropped past the limit or when the drive is nearly full. */
function added(S, p) {
  if (S.cutDisc && S.pieces.length) { p.disc = true; S.cutDisc = false; }
  S.pieces.push(p);
  // Room on the drive, looked at every 30 s (df is a process).
  if (io.freeMB && (!S.freeAt || Date.now() - S.freeAt > 30000)) { S.freeAt = Date.now(); S.free = io.freeMB(S.folder); }
  var free = S.free >= 0 ? S.free - p.bytes / 1048576 : 1e9; S.free = free;
  while (S.pieces.length > 2 && (total(S) - S.pieces[0].dur > S.max || free < MIN_FREE_MB)) {
    var old = S.pieces.shift();
    if (old.disc || (S.pieces[0] && S.pieces[0].disc)) S.disc++;
    try { fs.unlinkSync(path.join(S.dir, old.f)); } catch (e) {}
    if (free < MIN_FREE_MB) free += old.bytes / 1048576;
  }
  if (S.free < 1e9) S.free = free;
}

/* ---------- MPEG-TS: pieces cut at keyframes ---------- */
var VIDEO = { 0x01: 'm2', 0x02: 'm2', 0x1b: 'avc', 0x24: 'hevc', 0x10: 'm4' };
var AUDIO = { 0x03: 1, 0x04: 1, 0x0f: 1, 0x11: 1, 0x81: 1, 0x87: 1 };
function pesPts(b, o) {
  // b[o..] is the start of a PES packet's header.
  if (b[o] !== 0 || b[o + 1] !== 0 || b[o + 2] !== 1) return -1;
  var sid = b[o + 3]; if (sid === 0xbc || sid === 0xbe || sid === 0xbf || sid === 0xf0 || sid === 0xf1 || sid === 0xff || sid === 0xf2 || sid === 0xf8) return -1;
  if (!(b[o + 7] & 0x80)) return -1;
  var p = o + 9;
  return ((b[p] & 0x0e) * 536870912) + (b[p + 1] * 4194304) + ((b[p + 2] & 0xfe) * 16384) + (b[p + 3] * 128) + ((b[p + 4] & 0xfe) >> 1);
}
function isKey(codec, b, from, to) {
  for (var i = from; i + 4 < to; i++) {
    if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) continue;
    var x = b[i + 3];
    if (codec === 'avc') { var t = x & 0x1f; if (t === 5 || t === 7) return true; }
    else if (codec === 'hevc') { var h = (x >> 1) & 0x3f; if ((h >= 16 && h <= 21) || h === 32 || h === 33) return true; }
    else if (codec === 'm2') { if (x === 0xb3 || x === 0xb8) return true; }
    else if (codec === 'm4') { if (x === 0xb0 || x === 0xb3) return true; }
  }
  return false;
}
function cutter(S) {
  var C = { carry: null, pmtPid: -1, pat: null, pmt: null, vpid: -1, apid: -1, codec: '', buf: [], bytes: 0, startPts: -1, lastPts: -1, startAt: 0, started: false };
  function open(pts) {
    C.buf = []; C.bytes = 0; C.startPts = pts; C.lastPts = pts; C.startAt = Date.now();
    if (C.pat) { C.buf.push(C.pat); C.bytes += 188; }
    if (C.pmt) { C.buf.push(C.pmt); C.bytes += 188; }
  }
  function close(endPts) {
    if (!C.started || C.bytes <= 376) return;
    var d = endPts >= 0 && C.startPts >= 0 ? endPts - C.startPts : -1;
    if (d < 0) d += 8589934592;                                   // the 33-bit clock wrapped
    var dur = d / 90000;
    if (!(dur > 0.2 && dur < 60)) dur = Math.max(0.5, (Date.now() - C.startAt) / 1000);   // timestamps jumped: by the clock
    var n = S.n++, f = n + '.ts', data = Buffer.concat(C.buf, C.bytes);
    try { fs.writeFileSync(path.join(S.dir, f), data); } catch (e) { S.error = 'the drive refused it: ' + e.message; return stop(S, S.error); }
    added(S, { n: n, f: f, dur: dur, bytes: data.length, at: C.startAt });
  }
  function packet(p) {
    var pid = ((p[1] & 0x1f) << 8) | p[2], pusi = !!(p[1] & 0x40), afc = (p[3] >> 4) & 3, o = 4;
    if (afc === 2 || afc === 3) o = 5 + p[4];
    if (pid === 0 && pusi && o < 188) {
      C.pat = new Buffer(p);
      var q = o + 1 + p[o];                                          // pointer field
      var secLen = ((p[q + 1] & 0x0f) << 8) | p[q + 2], end = Math.min(q + 3 + secLen - 4, 188);
      for (var i = q + 8; i + 4 <= end; i += 4) { var prog = (p[i] << 8) | p[i + 1]; if (prog !== 0) { C.pmtPid = ((p[i + 2] & 0x1f) << 8) | p[i + 3]; break; } }
    } else if (pid === C.pmtPid && pusi && o < 188) {
      C.pmt = new Buffer(p);
      var r = o + 1 + p[o], sl = ((p[r + 1] & 0x0f) << 8) | p[r + 2], e2 = Math.min(r + 3 + sl - 4, 188);
      var pil = ((p[r + 10] & 0x0f) << 8) | p[r + 11], j = r + 12 + pil;
      C.vpid = -1; C.apid = -1;
      while (j + 5 <= e2) {
        var type = p[j], epid = ((p[j + 1] & 0x1f) << 8) | p[j + 2], il = ((p[j + 3] & 0x0f) << 8) | p[j + 4];
        if (VIDEO[type] && C.vpid < 0) { C.vpid = epid; C.codec = VIDEO[type]; }
        else if (AUDIO[type] && C.apid < 0) C.apid = epid;
        j += 5 + il;
      }
    }
    var lead = C.vpid >= 0 ? C.vpid : C.apid;
    if (pid === lead && pusi && o < 180) {
      var pts = pesPts(p, o);
      if (pts >= 0) {
        var key = C.vpid < 0 || isKey(C.codec, p, o + 9 + p[o + 8], 188) || (afc >= 2 && p[4] > 0 && (p[5] & 0x40));
        if (!C.started) { if (key) { C.started = true; open(pts); } }
        else {
          // Frames come in decode order, so a B-frame's time is a little before the keyframe's: not a wrap.
          var since = pts - C.startPts; if (since < -4294967296) since += 8589934592; if (since < 0) since = 0;
          var jumped = Math.abs(pts - C.lastPts) > 90000 * 10 && Math.abs(pts - C.lastPts) < 8589934592 - 90000 * 10;
          if (jumped) { close(C.lastPts); S.cutDisc = true; open(pts); }
          // The first piece is cut at the first keyframe after a second, so playing can start that soon; the rest
          // at about PIECE seconds.
          else if ((key && since >= (S.n === 0 ? 1 : PIECE) * 90000) || since >= PIECE * 3 * 90000) { close(pts); open(pts); }
          C.lastPts = pts;
        }
      }
    }
    if (C.started) { C.buf.push(p); C.bytes += 188; }
  }
  C.push = function (chunk) {
    if (S.stopped) return;
    var b = C.carry ? Buffer.concat([C.carry, chunk]) : chunk, i = 0;
    while (i < b.length && b[i] !== 0x47) i++;                     // find the sync byte
    for (; i + 188 <= b.length; i += 188) {
      if (b[i] !== 0x47) { while (i < b.length && b[i] !== 0x47) i++; if (i + 188 > b.length) break; }
      packet(b.slice(i, i + 188));
    }
    C.carry = i < b.length ? new Buffer(b.slice(i)) : null;
    if (C.bytes > 64 * 1024 * 1024) { close(C.lastPts); open(C.lastPts); }   // no keyframe found in a long while: cut anyway
  };
  return C;
}

/* ---------- the playlist ---------- */
function playlist(S) {
  var ps = S.pieces, td = 1;
  ps.forEach(function (p) { td = Math.max(td, Math.ceil(p.dur)); });
  var out = ['#EXTM3U', '#EXT-X-VERSION:' + (S.init ? 7 : 3), '#EXT-X-TARGETDURATION:' + td, '#EXT-X-MEDIA-SEQUENCE:' + (ps.length ? ps[0].n : 0), '#EXT-X-DISCONTINUITY-SEQUENCE:' + S.disc];
  if (S.init) out.push('#EXT-X-MAP:URI="init.mp4"');
  ps.forEach(function (p, i) {
    if (p.disc && i > 0) out.push('#EXT-X-DISCONTINUITY');
    out.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(p.at).toISOString());
    out.push('#EXTINF:' + p.dur.toFixed(3) + ',');
    out.push(p.f);
  });
  if (S.stopped) out.push('#EXT-X-ENDLIST');
  return out.join('\n') + '\n';
}
function status(S) { return { id: S.id, playlist: '/record/ts/' + S.id + '/live.m3u8', sec: Math.round(total(S)), pieces: S.pieces.length, ready: S.pieces.length >= 1, error: S.error, kind: S.kind, max: S.max }; }

/* ---------- routes (from record.js) ---------- */
function route(req, res, ALLOW, p, q, send) {
  var m = /^\/record\/ts\/([A-Za-z0-9]+)\/(live\.m3u8|init\.mp4|\d+\.(?:ts|m4s))$/.exec(p);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    var S = sessions[m[1]];
    if (!S) return send(res, ALLOW, 404, { error: 'no such pause buffer' });
    S.seen = Date.now();
    var h = { 'Cache-Control': 'no-store' }; for (var k in ALLOW) h[k] = ALLOW[k];
    if (m[2] === 'live.m3u8') {
      // Nothing kept yet (just started): the answer waits for the first piece (10 s at most), so the player opens
      // the moment there's something to play instead of failing on an empty playlist.
      var t0 = Date.now();
      return (function answer() {
        if (!S.pieces.length && !S.stopped && !S.error && Date.now() - t0 < WAIT_MS) return setTimeout(answer, 100);
        var txt = playlist(S); h['Content-Type'] = 'application/vnd.apple.mpegurl';
        res.writeHead(200, h); res.end(req.method === 'HEAD' ? '' : txt);
      })();
    }
    var file = path.join(S.dir, m[2]), size = 0;
    try { size = fs.statSync(file).size; } catch (e) { return send(res, ALLOW, 404, { error: 'gone' }); }
    h['Content-Type'] = /\.ts$/.test(m[2]) ? 'video/mp2t' : 'video/mp4'; h['Content-Length'] = size;
    res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    var rs = fs.createReadStream(file); rs.on('error', function () { res.end(); }); return rs.pipe(res);
  }
  return null;
}
function post(p, q, folder) {
  if (p === '/record/ts/start') return status(begin(String(q.url), q.max, folder, q.key, q.alt));
  var S = sessions[String(q.id || '')];
  if (p === '/record/ts/ping') { if (!S) return { error: 'gone', gone: true }; S.seen = Date.now(); return status(S); }
  if (p === '/record/ts/stop') { if (S) stop(S, 'asked'); return { ok: true }; }
  return null;
}

module.exports = { setup: setup, route: route, post: post, _sessions: sessions, _stopAll: function () { Object.keys(sessions).forEach(function (k) { stop(sessions[k], 'test'); }); }, _playlist: playlist };
