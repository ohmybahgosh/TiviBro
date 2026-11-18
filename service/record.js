/* Recording live channels to a USB drive (the recording plan, discussion #94).
   The helper does it, not the app: it reads the channel through its own relay (the same address the player uses,
   so the playlist's User-Agent, headers and a Stalker portal's links all apply) and writes what arrives straight
   to a file, without decoding.  A few MB of memory and almost no CPU, and it carries on with TiviBro closed or in
   another app, as long as the TV is on and the helper runs (webOS wakes it every 5 minutes).

   - MPEG-TS: the bytes as they come, into "<title> <date>.ts".  A dropped connection is asked for again and the
     recording carries on in the same file.  A file stops at 3.9 GB and the next part starts (FAT32 drives).
   - HLS: its playlist is followed (the best quality of a master playlist), and each new piece is added to the
     file in order: .ts pieces as one .ts, fMP4 pieces after their init segment as one .mp4.  Encrypted
     playlists are refused (not yet).
   Drives: what webOS mounted under /tmp/usb/<disk>/<partition> (gid 5000, group-writable).  The helper runs in
   webOS's developer-mode jail, and that jail leaves USB drives out (its "mountusbdir" line is commented out in
   /etc/jail_native_devmode.conf; entering the jail's mount namespace from outside fails too), so the helper sees no
   drive.  On a rooted TV the recording agent does the work instead: this same file run as root outside the jail
   (record-agent.js), started through the Homebrew Channel's root exec, on 127.0.0.1:47820.  The helper hands it
   every /record/ request.  Without root, recording to USB isn't possible from a developer-mode app.  TV storage is
   never used: about 1 GB free, 15 to 30 minutes of HD, and it is webOS's too.
   The list of recordings (scheduled, recording, done, failed) is kept in the helper's storage (storage.js).

   Routes (on the relay, with TiviBro's secret like /kv/):
     GET  /record/drives                      -> { drives: [{ dir, name, freeMB }] }
     GET  /record/list                        -> { recs: [...] }
     POST /record/start    { url, title, channel, end, drive? }        -> { id }   (now, until end)
     POST /record/schedule { url, title, channel, start, end, drive? } -> { id }
     POST /record/stop     { id }    (a scheduled one is cancelled)
     POST /record/delete   { id }    (its files too)
     GET  /record/file/<id>[?part=n]  the recording, with Range, for the player
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), URL_ = require('url');

var ROOTS = process.env.TIVIBRO_USB_DIR ? [process.env.TIVIBRO_USB_DIR] : ['/tmp/usb'];
var AGENT = process.env.TIVIBRO_REC_AGENT === '1', AGENT_PORT = +(process.env.TIVIBRO_REC_AGENT_PORT || 47820);
var lcall = null, agentSaid = '', agentStarting = null, agentCtl = '';
function setCall(f) { lcall = f; }
/* The agent's secret: kept in the helper's storage, so an agent still running from an earlier helper is the same. */
function agentKey() {
  if (agentCtl) return agentCtl;
  var f = ''; try { f = path.join(require('./storage').sub('rec'), 'agent.key'); agentCtl = fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  if (!/^[0-9a-f]{32}$/.test(agentCtl)) { agentCtl = require('crypto').randomBytes(16).toString('hex'); try { fs.writeFileSync(f, agentCtl); } catch (e) {} }
  return agentCtl;
}
var FOLDER = 'TiviBro Recordings', PART_MAX = +(process.env.TIVIBRO_REC_PART_MAX || 3900 * 1024 * 1024);
var RETRY_MS = +(process.env.TIVIBRO_REC_RETRY_MS || 3000), TICK_MS = +(process.env.TIVIBRO_REC_TICK_MS || 15000), BODY_MAX = 64 * 1024;

var state = null, run = {}, logf = function () {}, timer = null, listFile = '';

function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h); res.end(JSON.stringify(obj));
}
function note(lv, event, more) { var o = { lv: lv, event: event }; for (var k in more || {}) o[k] = more[k]; logf(o); }

/* ---------- the list ---------- */
function load() {
  if (state) return state;
  state = { recs: [] };
  if (process.env.TIVIBRO_REC_LIST) listFile = process.env.TIVIBRO_REC_LIST;          // the agent: never the helper's storage (root would lock the helper out of it)
  else { try { listFile = path.join(require('./storage').sub('rec'), 'recordings.json'); } catch (e) { listFile = ''; } }
  try { var j = JSON.parse(fs.readFileSync(listFile, 'utf8')); if (j && Array.isArray(j.recs)) state = j; } catch (e) {}
  // Recording when the helper stopped (webOS closed it, the TV turned off): carries on if its time isn't over.
  state.recs.forEach(function (r) { if (r.status === 'recording') r.status = r.end > Date.now() ? 'scheduled' : 'done'; });
  return state;
}
var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    if (!listFile) return;
    fs.writeFile(listFile + '.tmp', JSON.stringify(state), function (e) { if (!e) fs.rename(listFile + '.tmp', listFile, function () {}); });
  }, 300);
}
function byId(id) { var hit = null; load().recs.forEach(function (r) { if (r.id === id) hit = r; }); return hit; }
function pub(r) {
  return { id: r.id, title: r.title, channel: r.channel, start: r.start, end: r.end, status: r.status, bytes: r.bytes || 0, parts: (r.parts || []).length,
    kind: r.kind || '', error: r.error || '', drive: r.driveName || '', startedAt: r.startedAt || 0, gaps: r.gaps || 0 };
}

/* ---------- drives ---------- */
var seen = [];      // what drives() looked at and why it was left out, for /record/drives and the log
function writable(d) { try { var t = path.join(d, '.tivibro-w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); return true; } catch (e) { seen.push(d + ': ' + e.code); return false; } }
function drives() {
  var out = [];
  seen = [];
  ROOTS.forEach(function (USB) {
    var disks = []; try { disks = fs.readdirSync(USB); } catch (e) { return; }
    disks.forEach(function (d) {
      var parts = []; try { parts = fs.readdirSync(path.join(USB, d)); } catch (e) {}
      parts.forEach(function (p) {
        var dir = path.join(USB, d, p);
        try { if (!fs.statSync(dir).isDirectory()) return; } catch (e) { return; }
        if (out.some(function (o) { return o.name === p; })) return;      // the same drive seen twice (/tmp/usb and /tmp/tvusb)
        if (writable(dir)) out.push({ dir: dir, name: p, freeMB: require('./storage')._freeMB(dir) });
      });
    });
  });
  return out;
}
function folderOn(drive) {
  var dir = path.join(drive, FOLDER);
  try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  return dir;
}
// A file name from the title and the time: "Hockey Night 2026-11-18 19.30.ts" (no characters FAT/exFAT refuse).
function nameFor(r, ext, n) {
  var d = new Date(r.startedAt || Date.now()), p = function (x) { return (x < 10 ? '0' : '') + x; };
  var t = String(r.title || r.channel || 'Recording').replace(/[\\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Recording';
  return t + ' ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '.' + p(d.getMinutes()) + (n > 1 ? ' part ' + n : '') + '.' + ext;
}

/* ---------- fetching through the relay ---------- */
function get(u, cb) {
  var o = URL_.parse(u);
  var req = http.get({ hostname: o.hostname, port: o.port, path: o.path, headers: { 'User-Agent': 'TiviBro recorder', 'Connection': 'close' } }, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return get(URL_.resolve(u, res.headers.location), cb); }
    cb(null, res, u);
  });
  req.on('error', function (e) { cb(e); });
  req.setTimeout(20000, function () { req.abort(); });
  return req;
}
function getText(u, cb) {
  get(u, function (e, res, at) {
    if (e) return cb(e);
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode)); }
    var chunks = [], n = 0;
    res.on('data', function (c) { n += c.length; if (n < 4 * 1024 * 1024) chunks.push(c); });
    res.on('end', function () { cb(null, Buffer.concat(chunks).toString('utf8'), at); });
    res.on('error', cb);
  });
}
function isPlaylist(res, u) { return /mpegurl/i.test(res.headers['content-type'] || '') || /\.m3u8(\?|$)/i.test(u); }

/* ---------- writing ---------- */
function openPart(r, R) {
  if (R.out) { try { R.out.end(); } catch (e) {} }
  var n = (r.parts || []).length + 1, file = path.join(R.dir, nameFor(r, r.kind === 'mp4' ? 'mp4' : 'ts', n));
  r.parts = (r.parts || []).concat([file]);
  R.out = fs.createWriteStream(file, { flags: 'a' }); R.partBytes = 0;
  R.out.on('error', function (e) { fail(r, 'the drive refused it: ' + e.message); });
  if (R.init) { R.out.write(R.init); R.partBytes += R.init.length; }
  save();
}
function write(r, R, buf) {
  if (!R.out || R.stopped) return true;
  if (R.partBytes + buf.length > PART_MAX && R.partBytes > 0) openPart(r, R);
  R.partBytes += buf.length; r.bytes = (r.bytes || 0) + buf.length;
  return R.out.write(buf);
}

/* ---------- a recording ---------- */
function begin(r) {
  if (run[r.id]) return;
  var drive = r.drive, all = drives();
  if (!drive || !all.some(function (d) { return d.dir === drive; })) drive = all.length ? all[0].dir : '';
  if (!drive) return fail(r, 'no USB drive TiviBro can write to');
  var R = run[r.id] = { dir: folderOn(drive), out: null, req: null, stopped: false, seen: {}, init: null };
  r.driveName = path.basename(drive); r.status = 'recording'; r.startedAt = r.startedAt || Date.now();
  note('info', 'recording started', { title: r.title, drive: r.driveName });
  connect(r, R);
  save();
}
function connect(r, R) {
  if (R.stopped) return;
  R.req = get(r.url, function (e, res, at) {
    if (R.stopped) { if (res) res.resume(); return; }
    if (e || res.statusCode !== 200) { if (res) res.resume(); return again(r, R, e ? e.message : 'HTTP ' + res.statusCode); }
    if (isPlaylist(res, at)) { res.resume(); return hls(r, R, at); }
    if (!r.kind) r.kind = 'ts';
    if (!R.out) openPart(r, R);
    res.on('data', function (c) { if (!write(r, R, c)) { res.pause(); R.out.once('drain', function () { res.resume(); }); } });
    res.on('end', function () { again(r, R, 'the provider closed the stream'); });
    res.on('error', function (e2) { again(r, R, e2.message); });
  });
}
function again(r, R, why) {
  if (R.stopped) return;
  if (Date.now() >= r.end) return finish(r);
  r.gaps = (r.gaps || 0) + 1;
  if (r.gaps === 1 || r.gaps % 10 === 0) note('warn', 'recording reconnecting', { title: r.title, e: why, gaps: r.gaps });
  R.retry = setTimeout(function () { connect(r, R); }, RETRY_MS);
}
/* HLS: the playlist, again and again; each new piece once, in order. */
function hls(r, R, u) {
  getText(u, function (e, text) {
    if (R.stopped) return;
    if (e) return again(r, R, e.message);
    var lines = text.split(/\r?\n/), best = null, bw = -1;
    for (var i = 0; i < lines.length; i++) {
      var m = /^#EXT-X-STREAM-INF:(.*)$/.exec(lines[i]);
      if (m) { var b = +((/BANDWIDTH=(\d+)/.exec(m[1]) || [])[1]) || 0, next = (lines[i + 1] || '').trim(); if (next && b > bw) { bw = b; best = next; } }
    }
    if (best) return hls(r, R, URL_.resolve(u, best));                 // a master playlist: its best quality
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) return fail(r, 'this channel is encrypted HLS, which TiviBro can\'t record yet');
    var seq = +((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text) || [])[1]) || 0, target = +((/#EXT-X-TARGETDURATION:(\d+)/.exec(text) || [])[1]) || 6;
    var map = (/#EXT-X-MAP:.*URI="([^"]+)"/.exec(text) || [])[1], segs = [];
    lines.forEach(function (l) { l = l.trim(); if (l && l.charAt(0) !== '#') segs.push(l); });
    if (!r.kind) r.kind = map ? 'mp4' : 'ts';
    var queue = [];
    segs.forEach(function (s, k) { var n = seq + k; if (!R.seen[n]) queue.push({ n: n, u: URL_.resolve(u, s) }); });
    // The first look: only the newest few pieces (live, not the whole window behind).
    if (R.lastSeq == null && queue.length > 3) queue = queue.slice(-3);
    var ended = /#EXT-X-ENDLIST/.test(text);
    (function initThen(go) {
      if (!map || R.init) return go();
      fetchAll(URL_.resolve(u, map), function (e2, buf) { if (e2) return again(r, R, 'init: ' + e2.message); R.init = buf; go(); });
    })(function () {
      if (!R.out) openPart(r, R);
      (function step() {
        if (R.stopped) return;
        if (Date.now() >= r.end) return finish(r);
        var s = queue.shift();
        if (!s) {
          if (ended) return finish(r);
          R.poll = setTimeout(function () { hls(r, R, u); }, Math.max(1000, target * 500));
          return;
        }
        R.seen[s.n] = 1; R.lastSeq = s.n;
        fetchAll(s.u, function (e3, buf) {
          if (R.stopped) return;
          if (e3) { r.gaps = (r.gaps || 0) + 1; return step(); }        // a lost piece is a short gap, not the end
          write(r, R, buf); step();
        });
      })();
    });
  });
}
function fetchAll(u, cb) {
  get(u, function (e, res) {
    if (e) return cb(e);
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode)); }
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () { cb(null, Buffer.concat(chunks)); });
    res.on('error', cb);
  });
}
function halt(r) {
  var R = run[r.id]; if (!R) return;
  R.stopped = true; clearTimeout(R.retry); clearTimeout(R.poll);
  try { if (R.req) R.req.abort(); } catch (e) {}
  try { if (R.out) R.out.end(); } catch (e) {}
  delete run[r.id];
}
function finish(r) {
  halt(r);
  r.status = r.bytes > 0 ? 'done' : 'failed';
  if (!r.bytes && !r.error) r.error = 'nothing arrived from the provider';
  note('info', 'recording ' + r.status, { title: r.title, mb: Math.round((r.bytes || 0) / 1048576), gaps: r.gaps || 0 });
  save();
}
function fail(r, why) {
  halt(r);
  r.status = r.bytes > 0 ? 'done' : 'failed'; r.error = why;
  note('warn', 'recording failed', { title: r.title, e: why });
  save();
}

/* ---------- the clock: scheduled ones start, recording ones end ---------- */
function tick() {
  var now = Date.now();
  load().recs.forEach(function (r) {
    if (r.status === 'scheduled' && r.start <= now && r.end > now) begin(r);
    else if (r.status === 'scheduled' && r.end <= now) { r.status = 'missed'; r.error = 'TiviBro\'s helper wasn\'t running at that time'; save(); }
    else if (r.status === 'recording' && r.end <= now) finish(r);
    else if (r.status === 'recording' && !run[r.id]) begin(r);
  });
}
function start(opts) {
  logf = opts && opts.log || logf;
  load();
  if (!timer) { timer = setInterval(tick, TICK_MS); if (timer.unref) timer.unref(); }
  setTimeout(tick, 500);
}

/* ---------- routes ---------- */
function body(req, cb) {
  var b = '', over = false;
  req.on('data', function (c) { if (over) return; b += c; if (b.length > BODY_MAX) over = true; });
  req.on('end', function () { if (over) return cb(new Error('too large')); try { cb(null, JSON.parse(b || '{}')); } catch (e) { cb(e); } });
}
function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function okUrl(u) { return /^http:\/\/127\.0\.0\.1:\d+\//.test(String(u || '')); }     // the relay only: no recording of arbitrary addresses
function add(q, scheduled) {
  var now = Date.now(), r = { id: newId(), url: String(q.url), title: String(q.title || q.channel || 'Recording').slice(0, 200), channel: String(q.channel || '').slice(0, 200),
    start: scheduled ? +q.start : now, end: +q.end, status: 'scheduled', drive: q.drive ? String(q.drive) : '', bytes: 0, parts: [] };
  load().recs.push(r); save();
  if (!scheduled || r.start <= now) begin(r);
  return r;
}
/* The recording as one file, its parts end to end (a recording split at 3.9 GB plays through), with Range.
   ?part=n serves one part alone. */
function serveFile(req, res, ALLOW, r, part) {
  var files = part != null && !isNaN(part) ? [(r.parts || [])[part]].filter(Boolean) : (r.parts || []).slice();
  if (!files.length) return send(res, ALLOW, 404, { error: 'no such part' });
  var sizes = [], size = 0;
  for (var i = 0; i < files.length; i++) {
    try { var sz = fs.statSync(files[i]).size; sizes.push(sz); size += sz; } catch (e) { return send(res, ALLOW, 404, { error: 'a file is gone (the drive unplugged?)' }); }
  }
  var m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''), s = 0, en = size - 1, code = 200;
  if (m) { s = m[1] ? +m[1] : Math.max(0, size - +m[2]); en = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1; code = 206; }
  if (s > en || s >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
  var h = { 'Content-Type': r.kind === 'mp4' ? 'video/mp4' : 'video/mp2t', 'Accept-Ranges': 'bytes', 'Content-Length': en - s + 1 };
  if (code === 206) h['Content-Range'] = 'bytes ' + s + '-' + en + '/' + size;
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h);
  if (req.method === 'HEAD') return res.end();
  // Each part's share of the range, in turn.
  var at = 0, jobs = [];
  for (var j = 0; j < files.length; j++) {
    var a = Math.max(s, at), b = Math.min(en, at + sizes[j] - 1);
    if (a <= b) jobs.push({ f: files[j], start: a - at, end: b - at });
    at += sizes[j];
  }
  (function next() {
    var jb = jobs.shift();
    if (!jb) return res.end();
    var rs = fs.createReadStream(jb.f, { start: jb.start, end: jb.end });
    rs.on('error', function () { res.end(); });
    rs.on('end', next);
    rs.pipe(res, { end: false });
  })();
}
/* ---------- the agent (rooted TVs) ---------- */
function agentUp(cb) {
  var r = http.get({ hostname: '127.0.0.1', port: AGENT_PORT, path: '/record/ping', headers: { 'X-TiviBro-Ctl': agentKey() } }, function (res) { res.resume(); cb(res.statusCode === 200, res.statusCode); });
  r.on('error', function () { cb(false); }); r.setTimeout(1500, function () { r.abort(); });
}
function ensureAgent(cb) {
  agentUp(function (up, code) {
    if (up) return cb(true);
    if (!lcall) return cb(false);
    if (agentStarting) return agentStarting.push(cb);
    agentStarting = [cb];
    var done = function (ok) { var l = agentStarting || []; agentStarting = null; l.forEach(function (f) { f(ok); }); };
    // One with another secret (its key file was lost): stopped first.  Then ours, in the background.
    var pidf = '/media/developer/.tivibro-rec/agent.pid';
    var cmd = (code === 403 ? 'kill $(cat ' + pidf + ') 2>/dev/null; sleep 1; ' : '') + 'TIVIBRO_REC_CTL=' + agentKey() + ' nohup /usr/bin/node ' + path.join(__dirname, 'record-agent.js') + ' >/dev/null 2>&1 &';
    lcall('luna://org.webosbrew.hbchannel.service/exec', { command: cmd }, function (r) {
      var ok0 = r && r.returnValue !== false, tries = 0;
      if (!ok0) { var s0 = 'not possible: ' + (r && (r.errorText || r.stderrString) || 'no Homebrew Channel'); if (s0 !== agentSaid) { agentSaid = s0; note('warn', 'recording agent ' + s0); } return done(false); }
      (function wait() {
        agentUp(function (up) {
          if (up) { if (agentSaid !== 'up') { agentSaid = 'up'; note('info', 'recording agent started (root, for USB drives)'); } return done(true); }
          if (++tries > 10) { agentSaid = 'did not start'; note('warn', 'recording agent did not start'); return done(false); }
          setTimeout(wait, 300);
        });
      })();
    });
  });
}
// The request as it came, to the agent, and its answer back.
function toAgent(req, res, ALLOW) {
  var h = {}; for (var k in req.headers) h[k] = req.headers[k];
  h['x-tivibro-ctl'] = agentKey();
  var up = http.request({ hostname: '127.0.0.1', port: AGENT_PORT, path: req.url, method: req.method, headers: h }, function (ar) {
    var oh = {}; for (var k2 in ar.headers) oh[k2] = ar.headers[k2];
    for (var k3 in ALLOW) oh[k3] = ALLOW[k3];
    res.writeHead(ar.statusCode, oh); ar.pipe(res);
  });
  up.on('error', function (e) { send(res, ALLOW, 502, { error: 'the recording agent didn\'t answer: ' + e.message }); });
  req.pipe(up);
}
function handle(req, res, ALLOW, log) {
  if (log) logf = log;
  /* In the helper (jailed): its own drives when it sees any (a test, or a future webOS that shares them), else
     the agent on a rooted TV, else the answer that there's no drive. */
  if (!AGENT && !drives().length && lcall) {
    req.pause();
    return ensureAgent(function (ok) {
      if (ok) return toAgent(req, res, ALLOW);            // pipe() resumes it
      handleHere(req, res, ALLOW); req.resume();
    });
  }
  handleHere(req, res, ALLOW);
}
function handleHere(req, res, ALLOW) {
  var u = URL_.parse(req.url, true), p = u.pathname;
  if (req.method === 'GET' && p === '/record/ping') return send(res, ALLOW, 200, { ok: true, agent: AGENT });
  if (req.method === 'GET' && p === '/record/drives') { var dv = drives(); return send(res, ALLOW, 200, { drives: dv, skipped: seen, uid: process.getuid ? process.getuid() : null, gids: process.getgroups ? process.getgroups() : null }); }
  if (req.method === 'GET' && p === '/record/list') { tick(); return send(res, ALLOW, 200, { recs: load().recs.map(pub) }); }
  var fm = /^\/record\/file\/([A-Za-z0-9]+)(?:\/[^\/]*)?$/.exec(p);       // "/rec.ts" after the id tells the player what it is
  if (fm && (req.method === 'GET' || req.method === 'HEAD')) { var fr = byId(fm[1]); return fr ? serveFile(req, res, ALLOW, fr, u.query.part != null ? +u.query.part : null) : send(res, ALLOW, 404, { error: 'no such recording' }); }
  if (req.method !== 'POST') return send(res, ALLOW, 404, { error: 'no such route' });
  body(req, function (e, q) {
    if (e) return send(res, ALLOW, 400, { error: 'bad request' });
    if (p === '/record/start' || p === '/record/schedule') {
      if (!okUrl(q.url)) return send(res, ALLOW, 400, { error: 'not a relayed address' });
      if (!(+q.end > Date.now())) return send(res, ALLOW, 400, { error: 'it ends in the past' });
      if (p === '/record/schedule' && !(+q.start > 0)) return send(res, ALLOW, 400, { error: 'no start time' });
      if (!drives().length) return send(res, ALLOW, 409, { error: 'Plug in a USB drive to record to.', code: 'nodrive' });
      return send(res, ALLOW, 200, pub(add(q, p === '/record/schedule')));
    }
    var r = byId(String(q.id || ''));
    if (!r) return send(res, ALLOW, 404, { error: 'no such recording' });
    if (p === '/record/stop') {
      if (r.status === 'scheduled') { r.status = 'cancelled'; save(); }
      else if (r.status === 'recording') { r.end = Date.now(); finish(r); }
      return send(res, ALLOW, 200, pub(r));
    }
    if (p === '/record/delete') {
      halt(r);
      (r.parts || []).forEach(function (f) { try { fs.unlinkSync(f); } catch (x) {} });
      state.recs = state.recs.filter(function (x) { return x !== r; }); save();
      return send(res, ALLOW, 200, { ok: true });
    }
    send(res, ALLOW, 404, { error: 'no such route' });
  });
}

module.exports = { handle: handle, start: start, drives: drives, setCall: setCall, _tick: tick, _reset: function () { Object.keys(run).forEach(function (k) { halt(byId(k) || { id: k }); }); state = null; }, _nameFor: nameFor };
