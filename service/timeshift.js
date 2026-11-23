/* Live pause and rewind (timeshift) to a USB drive, or to a network share (WebDAV or Windows / Samba).  record.js's routes hand /record/ts/ here, so on a rooted TV it
   runs in the recording agent (root, outside the jail, where the drive is).
   A session reads a channel through the helper's relay (one connection to the provider, the same as watching) and
   keeps it on the drive as short pieces, offered to the player as a live HLS playlist whose window grows from the
   moment it started (up to its limit; the oldest pieces are dropped after that).  The player plays that playlist
   instead of the channel, so pause holds the place, ◀ goes back as far as the window and ▶ comes back to live.
   - MPEG-TS from the provider: cut into pieces of about 4 s, each at a keyframe (H.264, HEVC, MPEG-2), each
     starting with the stream's PAT and PMT so it plays on its own; a piece's length is from its timestamps.
   - HLS from the provider: its pieces, kept as they come (fMP4 with its init segment).
   A dropped connection is asked for again; the playlist marks the join (#EXT-X-DISCONTINUITY).
   A session nobody asked about for 30 s (the player gone, TiviBro closed) stops and its pieces are deleted.
   Pieces live in "<drive>/TiviBro Recordings/.timeshift/<id>/"; whatever an earlier run left there is cleared.
   On a network share (no USB drive, a share chosen for recordings: record.js passes { t, M }, the share and
   recdav.js or recsmb.js) the same folder is on the share: each piece is written there (one at a time, in order)
   and listed once it's written, read back from there when played, and old ones are deleted a batch at a time.
   A share keeps hours where the TV's own storage keeps 10 minutes, on any TV, rooted or not.
     POST /record/ts/start { url, max? }  -> { id, playlist }   (the same url again: the session running for it)
     POST /record/ts/ping  { id }         -> { id, sec, pieces, ready, error }
     POST /record/ts/stop  { id }
     GET  /record/ts/<id>/live.m3u8, /record/ts/<id>/<n>.ts|.m4s, /record/ts/<id>/init.mp4   (no secret: the player)
   Plain ES5 for Node 0.12. */
'use strict';
var fs = require('fs'), path = require('path');

var PIECE = +(process.env.TIVIBRO_TS_PIECE || 4), MAX_SEC = 2 * 3600, IDLE_MS = +(process.env.TIVIBRO_TS_IDLE_MS || 30000);
var MIN_FREE_MB = 1024, MAX_SESSIONS = 2, SMALL_SEC = 10 * 60, SMALL_FREE_MB = +(process.env.TIVIBRO_TS_SMALL_FREE_MB || 400);
var WAIT_MS = +(process.env.TIVIBRO_TS_WAIT_MS || 10000), NET_QUEUE = 6;
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
/* The same on a share, once per share while the helper runs: each folder an earlier run left, emptied and gone. */
function clearOldNet(net, base) {
  var k = 'net:' + (net.t.address || ''); if (cleared[k]) return; cleared[k] = 1;
  net.M.names(net.t, base, function (list) {
    (list || []).forEach(function (f) { if (!sessions[f]) dropNetDir(net, base + '/' + f, null); });
  });
}
// A folder on a share and what's in it: WebDAV deletes a folder whole; SMB deletes the files, then the folder.
function dropNetDir(net, dir, known) {
  if (!net.M.delMany) return net.M.del(net.t, dir, function () {});
  var gone = function (names) { net.M.delMany(net.t, (names || []).map(function (n) { return dir + '/' + n; }).concat([dir])); };
  if (known) return gone(known);
  net.M.names(net.t, dir, gone);
}

/* ---------- where the pieces go: the drive (or the TV's storage), or a share ---------- */
/* Keeps piece f (its bytes buf); done(err) once it's written.  On a drive that's at once; on a share they're written
   one after another, and a share that falls behind (more than a few waiting) drops the newest, marked as a join. */
function keep(S, f, buf, done) {
  if (!S.net) {
    try { fs.writeFileSync(path.join(S.dir, f), buf); } catch (e) { return done(e); }
    return done(null);
  }
  if (S.queue.length >= NET_QUEUE) { S.cutDisc = true; if (!S.behind++) note('warn', 'timeshift: the share is behind, a piece skipped', { id: S.id }); return; }
  S.queue.push({ f: f, buf: buf, done: done });
  if (S.queue.length === 1) nextPut(S);
}
function nextPut(S) {
  var job = S.queue[0]; if (!job || S.stopped) return;
  S.net.M.put(S.net.t, S.rdir + '/' + job.f, job.buf, 'application/octet-stream', function (e) {
    S.queue.shift();
    if (!S.stopped) job.done(e);
    nextPut(S);
  });
}
// A piece no longer wanted: deleted now on a drive, in batches of 20 on a share (one run of tivibro-smb for each).
function drop(S, f) {
  if (!S.net) { try { fs.unlinkSync(path.join(S.dir, f)); } catch (e) {} return; }
  S.toDel.push(S.rdir + '/' + f);
  if (S.toDel.length >= 20) flushDel(S);
}
function flushDel(S) {
  var list = S.toDel; S.toDel = []; if (!list.length) return;
  if (S.net.M.delMany) return S.net.M.delMany(S.net.t, list);
  list.forEach(function (r) { S.net.M.del(S.net.t, r, function () {}); });
}
// All of a session's pieces, once it's over.
function dropAll(S) {
  if (!S.net) return rmrf(S.dir);
  // Listed on the share rather than from memory: a piece still on its way when it stopped is caught too.
  S.toDel = [];
  dropNetDir(S.net, S.rdir, null);
}
// The room left, for keeping well clear of a full drive: df on a drive (every 30 s), the share's own answer (every minute).
function roomCheck(S) {
  if (S.net) {
    if (!S.net.M.free || (S.freeAt && Date.now() - S.freeAt < 60000)) return;
    S.freeAt = Date.now();
    S.net.M.free(S.net.t, function (mb) { S.free = mb >= 0 ? mb : 1e9; });
    return;
  }
  if (io.freeMB && (!S.freeAt || Date.now() - S.freeAt > 30000)) { S.freeAt = Date.now(); S.free = io.freeMB(S.folder); }
}

/* ---------- a session ---------- */
function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
/* A pause session for a channel (the one running for it, if there is one): its pieces under folder on the drive,
   or on the share when net is given; small: the TV's own storage, 10 minutes at most. */
function begin(url, max, folder, key, alt, small, net) {
  key = String(key || url);
  for (var k in sessions) if (sessions[k].key === key && !sessions[k].stopped) { sessions[k].seen = Date.now(); return sessions[k]; }
  // The oldest goes when there are too many (a channel change leaves one behind until it idles out).
  var ids = Object.keys(sessions).sort(function (a, b) { return sessions[a].born - sessions[b].born; });
  while (ids.length >= MAX_SESSIONS) stop(sessions[ids.shift()], 'another channel');
  // small: the TV's own storage (no USB drive): a short pause, and more room left free (webOS needs it too).
  var S = { id: newId(), key: key, url: url, max: Math.min(Math.max(+max || MAX_SEC, 60), small ? SMALL_SEC : 6 * 3600), born: Date.now(), seen: Date.now(),
    pieces: [], n: 0, disc: 0, cutDisc: false, stopped: false, error: '', kind: '', init: null, folder: folder, alt: alt || '', minFree: small ? SMALL_FREE_MB : MIN_FREE_MB, small: !!small,
    net: net || null, queue: [], toDel: [], free: -1 };
  if (net) {
    // On a share: "<recordings folder>/.timeshift/<id>", made with the first piece (its folders are made as it's written).
    var nbase = folder + '/.timeshift'; clearOldNet(net, nbase);
    S.rdir = nbase + '/' + S.id; S.dir = '';
  } else {
    var base = baseOn(folder); clearOld(base);
    S.dir = path.join(base, S.id);
    try { fs.mkdirSync(S.dir); } catch (e) { S.error = 'the drive refused it: ' + e.message; }
  }
  sessions[S.id] = S;
  if (!reaper) { reaper = setInterval(reap, 10000); if (reaper.unref) reaper.unref(); }
  if (!S.error) listen(S);
  note('info', 'timeshift started', { id: S.id, shared: !!(S.feed && S.feed.shared) });
  return S;
}
function reap() {
  var now = Date.now();
  Object.keys(sessions).forEach(function (k) { var S = sessions[k]; if (now - S.seen > IDLE_MS) stop(S, 'nobody watching'); else if (S.net) flushDel(S); });
  if (!Object.keys(sessions).length && reaper) { clearInterval(reaper); reaper = null; }
}
function stop(S, why) {
  if (!S) return;
  S.stopped = true;
  try { if (S.feed) S.feed.close(); } catch (e) {}
  delete sessions[S.id];
  note('info', 'timeshift stopped', { id: S.id, why: why || '', sec: Math.round(total(S)) });
  setTimeout(function () { dropAll(S); }, S.net ? 4000 : 1500);       // after a read (or a write to a share) in flight
}
function total(S) { var t = 0; S.pieces.forEach(function (p) { t += p.dur; }); return t; }
/* What arrives on the channel's feed (feed.js: one connection per channel, shared with a recording of it):
   MPEG-TS bytes are cut into pieces here, HLS pieces are kept as they come. */
function listen(S) {
  S.feed = io.feed.open(S.key, S.url, S.alt, {
    kind: function (k) { S.kind = k; },
    init: function (b) { S.init = b; keep(S, 'init.mp4', b, function () {}); },
    data: function (c) { if (S.stopped) return; if (!S.cutter) S.cutter = cutter(S); S.cutter.push(c); },
    piece: function (pc) {
      if (S.stopped) return;
      if (!pc.buf) { S.cutDisc = true; return; }
      if (pc.disc) S.cutDisc = true;
      var n = S.n++, f = n + (S.init ? '.m4s' : '.ts'), at = Date.now();
      keep(S, f, pc.buf, function (e) { if (e) return refused(S, e); added(S, { n: n, f: f, dur: pc.dur, bytes: pc.buf.length, at: at }); });
    },
    // A dropped connection: what's half cut is let go, and the playlist marks the join.
    down: function () { S.cutDisc = true; S.cutter = null; S.gaps = (S.gaps || 0) + 1; },
    fatal: function (why) { S.error = why; stop(S, why); }
  });
}
// A piece the drive or share wouldn't take: on a drive, the pause ends; on a share, a few misses are a join, more end it.
function refused(S, e) {
  if (S.net && (S.misses = (S.misses || 0) + 1) < 4) { S.cutDisc = true; note('warn', 'timeshift: a piece didn\'t reach the share', { id: S.id, e: e.message }); return; }
  S.error = (S.net ? 'the share refused it: ' : 'the drive refused it: ') + e.message;
  stop(S, S.error);
}
/* A finished piece: listed, and the oldest dropped past the limit or when the drive is nearly full. */
function added(S, p) {
  if (S.stopped) return;
  S.misses = 0;
  if (S.cutDisc && S.pieces.length) { p.disc = true; S.cutDisc = false; }
  S.pieces.push(p);
  roomCheck(S);
  var free = S.free >= 0 ? S.free - p.bytes / 1048576 : 1e9; S.free = free;
  while (S.pieces.length > 2 && (total(S) - S.pieces[0].dur > S.max || free < S.minFree)) {
    var old = S.pieces.shift();
    if (old.disc || (S.pieces[0] && S.pieces[0].disc)) S.disc++;
    drop(S, old.f);
    if (free < S.minFree) free += old.bytes / 1048576;
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
    var n = S.n++, f = n + '.ts', data = Buffer.concat(C.buf, C.bytes), at = C.startAt;
    keep(S, f, data, function (e) { if (e) return refused(S, e); added(S, { n: n, f: f, dur: dur, bytes: data.length, at: at }); });
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
function status(S) { return { small: S.small, share: !!S.net, id: S.id, playlist: '/record/ts/' + S.id + '/live.m3u8', sec: Math.round(total(S)), pieces: S.pieces.length, ready: S.pieces.length >= 1, error: S.error, kind: S.kind, max: S.max }; }

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
    h['Content-Type'] = /\.ts$/.test(m[2]) ? 'video/mp2t' : 'video/mp4';
    if (S.net) return serveNet(S, m[2], req, res, h, ALLOW, send);
    var file = path.join(S.dir, m[2]), size = 0;
    try { size = fs.statSync(file).size; } catch (e) { return send(res, ALLOW, 404, { error: 'gone' }); }
    h['Content-Length'] = size;
    res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    var rs = fs.createReadStream(file); rs.on('error', function () { res.end(); }); return rs.pipe(res);
  }
  return null;
}
/* A piece from the share: its size is known from when it was kept (init.mp4 is in memory), and the bytes are read
   back from the share as the player asks. */
function serveNet(S, name, req, res, h, ALLOW, send) {
  if (name === 'init.mp4') {
    if (!S.init) return send(res, ALLOW, 404, { error: 'gone' });
    h['Content-Length'] = S.init.length; res.writeHead(200, h); return res.end(req.method === 'HEAD' ? '' : S.init);
  }
  var pc = null; S.pieces.forEach(function (x) { if (x.f === name) pc = x; });
  if (!pc) return send(res, ALLOW, 404, { error: 'gone' });
  h['Content-Length'] = pc.bytes;
  if (req.method === 'HEAD') { res.writeHead(200, h); return res.end(); }
  var started = false;
  var g = S.net.M.get(S.net.t, S.rdir + '/' + name, 0, pc.bytes - 1, function (e, sr) {
    if (e || !sr || sr.statusCode >= 300) { if (sr && sr.resume) sr.resume(); return started ? res.end() : send(res, ALLOW, 404, { error: 'the share didn\'t give it back' }); }
    started = true; res.writeHead(200, h);
    sr.on('error', function () { res.end(); });
    sr.pipe(res);
  });
  res.on('close', function () { try { if (g && g.abort) g.abort(); } catch (x) {} });
}
function post(p, q, folder, small, net) {
  if (p === '/record/ts/start') return status(begin(String(q.url), q.max, folder, q.key, q.alt, small, net));
  var S = sessions[String(q.id || '')];
  if (p === '/record/ts/ping') { if (!S) return { error: 'gone', gone: true }; S.seen = Date.now(); return status(S); }
  if (p === '/record/ts/stop') { if (S) stop(S, 'asked'); return { ok: true }; }
  return null;
}

// At start: whatever an earlier run left in a folder's .timeshift (nothing can resume it).
function clearAll(folder) { var base = path.join(folder, '.timeshift'); if (fs.existsSync(base)) clearOld(base); }
module.exports = { clearAll: clearAll, setup: setup, route: route, post: post, _sessions: sessions, _stopAll: function () { Object.keys(sessions).forEach(function (k) { stop(sessions[k], 'test'); }); }, _playlist: playlist };
