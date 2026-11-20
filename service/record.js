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
     POST /record/convert  { id }    (to one .mp4, or .mkv, with the details inside; progress in its conv)
     GET  /record/file/<id>[?part=n]  the recording, with Range, for the player
     /record/ts/...                           live pause (timeshift.js)
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var http = require('http'), cp = require('child_process'), fs = require('fs'), path = require('path'), URL_ = require('url'), TS = require('./timeshift'), Feed = require('./feed');

var ROOTS = process.env.TIVIBRO_USB_DIR ? [process.env.TIVIBRO_USB_DIR] : ['/tmp/usb'];
var AGENT = process.env.TIVIBRO_REC_AGENT === '1', AGENT_PORT = +(process.env.TIVIBRO_REC_AGENT_PORT || 47820);
var agentNoUntil = 0, lcall = null, agentSaid = '', agentStarting = null, agentCtl = '';
function setCall(f) { lcall = f; }
/* The agent's secret: kept in the helper's storage, so an agent still running from an earlier helper is the same. */
function agentKey() {
  if (agentCtl) return agentCtl;
  var f = ''; try { f = path.join(require('./storage').sub('rec'), 'agent.key'); agentCtl = fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  if (!/^[0-9a-f]{32}$/.test(agentCtl)) { agentCtl = require('crypto').randomBytes(16).toString('hex'); try { fs.writeFileSync(f, agentCtl); } catch (e) {} }
  return agentCtl;
}
var FOLDER = 'TiviBro Recordings', PART_MAX = +(process.env.TIVIBRO_REC_PART_MAX || 3900 * 1024 * 1024);
var TICK_MS = +(process.env.TIVIBRO_REC_TICK_MS || 15000), BODY_MAX = 64 * 1024;

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
  state.recs.forEach(function (r) {
    if (r.status === 'recording') r.status = r.end > Date.now() ? 'scheduled' : 'done';
    // Converting when it stopped: the half-made file goes, the recording is as it was.
    if (r.conv && r.conv.running) { try { if (r.conv.tmp) fs.unlinkSync(r.conv.tmp); } catch (e) {} r.conv = { error: 'stopped before it finished (the TV turned off?)', at: Date.now() }; }
  });
  return state;
}
var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    if (!listFile) return;
    fs.writeFile(listFile + '.tmp', JSON.stringify(state), function (e) { if (!e) fs.rename(listFile + '.tmp', listFile, function () {}); });
    needed();
  }, 300);
}
/* The agent says until when it's needed (the end of the last recording scheduled or running), in a small file the
   helper can read (TIVIBRO_REC_NEEDED, in the helper's storage): the helper starts it again if it stopped (a crash,
   webOS ending it) while a recording is still due.  Readable by everyone, so root's file doesn't lock the helper out. */
function needed() {
  var f = process.env.TIVIBRO_REC_NEEDED; if (!AGENT || !f) return;
  var until = 0; (state && state.recs || []).forEach(function (r) { if ((r.status === 'scheduled' || r.status === 'recording') && r.end > until) until = r.end; });
  try { fs.writeFileSync(f, JSON.stringify({ until: until, at: Date.now() })); fs.chmodSync(f, 420); } catch (e) {}
}
function neededFile() { try { return path.join(require('./storage').sub('rec'), 'needed.json'); } catch (e) { return ''; } }
// In the helper: once a minute, the agent is started again when a recording still needs it and it isn't answering.
var watchT = null;
function watchAgent() {
  if (AGENT || !lcall || watchT) return;
  watchT = setInterval(function () {
    var n = null; try { n = JSON.parse(fs.readFileSync(neededFile(), 'utf8')); } catch (e) { return; }
    if (!n || !(n.until > Date.now())) return;
    agentUp(function (up) { if (!up) { note('warn', 'recording agent not answering with a recording due: starting it again'); ensureAgent(function () {}); } });
  }, +(process.env.TIVIBRO_REC_WATCH_MS || 60000));
  if (watchT.unref) watchT.unref();
}
function byId(id) { var hit = null; load().recs.forEach(function (r) { if (r.id === id) hit = r; }); return hit; }
/* How long it is to watch: the time it was recording, less the time a dropped connection took to come back. */
function lengthOf(r) {
  if (!r.startedAt) return 0;
  var to = r.status === 'recording' ? Date.now() : (r.endedAt || Math.min(r.end, Date.now()));
  var down = (r.down || 0) + (r.status === 'recording' && run[r.id] && run[r.id].downSince ? Date.now() - run[r.id].downSince : 0);
  return Math.max(0, Math.round((to - r.startedAt - down) / 1000));
}
function pub(r) {
  return { id: r.id, title: r.title, channel: r.channel, start: r.start, end: r.end, status: r.status, bytes: r.bytes || 0, parts: (r.parts || []).length,
    kind: r.kind || '', error: r.error || '', drive: r.driveName || '', startedAt: r.startedAt || 0, gaps: r.gaps || 0, dur: lengthOf(r), endedAt: r.endedAt || 0, logo: r.logo || '', key: r.key || '', desc: r.desc || '', ep: r.ep || '', meta: r.meta || null,
    conv: r.conv ? { running: !!r.conv.running, pct: r.conv.pct || 0, done: r.conv.done || '', error: r.conv.error || '' } : null, folder: r.parts && r.parts[0] ? path.dirname(r.parts[0]).split(FOLDER).pop().replace(/^\//, '') : '' };
}
/* The drive's room (df), looked at every 30 s at most: free and total MB. */
var spaceAt = 0, spaceWas = null;
function space(dir) {
  if (spaceWas && spaceWas.dir === dir && Date.now() - spaceAt < 30000) return spaceWas;
  var out = { dir: dir, freeMB: -1, totalMB: -1 };
  try {
    var t = String(require('child_process').execFileSync('df', ['-k', dir], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }));
    var c = t.trim().split('\n').pop().trim().split(/\s+/);
    out.freeMB = Math.round(+c[c.length - 3] / 1024); out.totalMB = Math.round(+c[c.length - 5] / 1024);
  } catch (e) {}
  spaceAt = Date.now(); spaceWas = out;
  return out;
}
var LOW_MB = 500;
/* No USB drive: live pause can still use a little of the TV's own storage (a 10-minute pause at most, and only
   while it has room to spare: webOS needs it, and the always-on rewind buffer never goes there, to spare the flash).
   The helper's own folder (or the agent's, as root), with 700 MB free at least (a C2 has about 1 GB); 400 MB is always left. */
var TV_ROOM_MB = +(process.env.TIVIBRO_TS_TV_ROOM_MB || 700);
function tvRoom() {
  var d = '';
  try { d = AGENT ? path.join('/media/developer/.tivibro-rec', 'pause') : require('./storage').sub('pause'); if (AGENT) { try { fs.mkdirSync(d); } catch (e) {} } } catch (e) { return ''; }
  var sp = space(d);
  return sp.freeMB < 0 || sp.freeMB >= TV_ROOM_MB ? d : '';
}
// A drive's write error, said the way a person would.
function driveError(e) {
  if (e && e.code === 'ENOSPC') return 'the USB drive is full';
  if (e && /^(ENOENT|EIO|EROFS|ENODEV|ENXIO)$/.test(e.code)) return 'the USB drive was unplugged or stopped working';
  return 'the drive refused it: ' + (e && e.message || e);
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
// A playlist by its type, or by its name when the type says nothing useful (a .m3u8 that answers video/mp2t is a stream).
function isPlaylist(res, u) { var ct = res.headers['content-type'] || ''; return /mpegurl/i.test(ct) || (/\.m3u8(\?|$)/i.test(u) && !/^video\/|octet-stream/i.test(ct)); }

Feed.setup({ get: get, getText: getText, fetchAll: function (u, cb) { fetchAll(u, cb); }, isPlaylist: isPlaylist, log: function (o) { logf(o); } });

/* ---------- writing ---------- */
function openPart(r, R) {
  if (R.out) { try { R.out.end(); } catch (e) {} }
  var n = (r.parts || []).length + 1, file = path.join(R.dir, nameFor(r, r.kind === 'mp4' ? 'mp4' : 'ts', n));
  r.parts = (r.parts || []).concat([file]);
  R.out = fs.createWriteStream(file, { flags: 'a' }); R.partBytes = 0;
  R.out.on('error', function (e) { fail(r, driveError(e)); });
  if (R.init) { R.out.write(R.init); R.partBytes += R.init.length; }
  save();
}
function write(r, R, buf) {
  if (!R.out || R.stopped) return true;
  if (R.partBytes + buf.length > PART_MAX && R.partBytes > 0) openPart(r, R);
  R.partBytes += buf.length; r.bytes = (r.bytes || 0) + buf.length; R.fails = 0;
  return R.out.write(buf);
}

/* ---------- a recording ---------- */
/* What arrives on the channel's feed (feed.js: one connection to the provider per channel, shared with live pause
   of the same channel), written as it comes. */
function begin(r) {
  if (run[r.id]) return;
  var drive = r.drive, all = drives();
  if (!drive || !all.some(function (d) { return d.dir === drive; })) drive = all.length ? all[0].dir : '';
  if (!drive) return fail(r, 'no USB drive TiviBro can write to');
  var sp = space(drive);
  if (sp.freeMB >= 0 && sp.freeMB < LOW_MB) return fail(r, 'the USB drive is full');
  var fdir; try { fdir = folderOn(drive); } catch (e) { return fail(r, driveError(e)); }
  var R = run[r.id] = { dir: fdir, out: null, stopped: false, init: null };
  r.driveName = path.basename(drive); r.status = 'recording'; r.startedAt = r.startedAt || Date.now();
  note('info', 'recording started', { title: r.title, drive: r.driveName });
  R.feed = Feed.open(r.key || r.url, r.url, r.alt, {
    kind: function (k) { if (!r.bytes) r.kind = k; },
    init: function (b) { R.init = b; },
    data: function (c) { if (R.stopped) return; if (!R.out) openPart(r, R); write(r, R, c); },
    piece: function (pc) { if (R.stopped) return; if (!pc.buf) { r.gaps = (r.gaps || 0) + 1; return; } if (!R.out) openPart(r, R); write(r, R, pc.buf); },
    down: function (why) {
      r.gaps = (r.gaps || 0) + 1;
      if (!R.downSince) R.downSince = Date.now();
      if (r.gaps === 1 || r.gaps % 10 === 0) note('warn', 'recording reconnecting', { title: r.title, e: why, gaps: r.gaps });
    },
    up: function () { back(r, R); },
    fatal: function (why) { fail(r, why); },
    ended: function () { finish(r); }
  });
  if (R.feed.shared) note('info', 'recording: sharing the channel\'s connection', { title: r.title });
  R.endT = setTimeout(function () { if (run[r.id] === R) finish(r); }, Math.max(0, r.end - Date.now()));
  save();
}
// Connected again: the time it was down doesn't count in its length.
function back(r, R) { if (R.downSince) { r.down = (r.down || 0) + (Date.now() - R.downSince); R.downSince = 0; } }

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
  R.stopped = true; clearTimeout(R.endT);
  try { if (R.feed) R.feed.close(); } catch (e) {}
  try { if (R.out) R.out.end(); } catch (e) {}
  delete run[r.id];
}
function finish(r) {
  var R0 = run[r.id]; if (R0) back(r, R0);
  r.endedAt = Date.now();
  halt(r);
  r.status = r.bytes > 0 ? 'done' : 'failed';
  if (!r.bytes && !r.error) r.error = 'nothing arrived from the provider';
  note('info', 'recording ' + r.status, { title: r.title, mb: Math.round((r.bytes || 0) / 1048576), gaps: r.gaps || 0 });
  save(); tidy(r);
}
function fail(r, why) {
  if (!r.endedAt && r.startedAt) r.endedAt = Date.now();
  halt(r);
  r.status = r.bytes > 0 ? 'done' : 'failed'; r.error = why;
  note('warn', 'recording failed', { title: r.title, e: why });
  save(); tidy(r);
}

/* ---------- for Plex, Jellyfin, Kodi and Infuse (discussion #94) ---------- */
/* A finished recording is moved where a media server finds it, under names it reads, with what TMDB knows beside it:
     TiviBro Recordings/TV/<Show>/<Show> - s01e02.ts          (the guide's episode number)
     TiviBro Recordings/TV/<Show>/<Show> - 2026-11-20 10.00.ts (no number: Plex's date-based episodes)
     TiviBro Recordings/Movies/<Title> (Year)/<Title> (Year).ts (TMDB says it's a movie)
   A recording in parts gets " - pt1", " - pt2" (Plex plays them as one).  Beside it: a .nfo with the title, plot,
   year, genre, rating and channel (Jellyfin, Emby, Kodi, Infuse; Plex with an agent), and the poster as poster.jpg
   in its folder (all of them, Plex too).  Done when it finishes and again when TMDB's details arrive.  So a "TV" and a
   "Movies" library on the drive's folder is all a media server needs. */
function clean(s) { return String(s || '').replace(/[\\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80); }
function metaOf(r) { return r.meta && !r.meta.miss ? r.meta : null; }
function epOf(r) { var m = /S(\d{1,3})\s*E(\d{1,4})/i.exec(r.ep || ''); return m ? { s: +m[1], e: +m[2] } : null; }
// TMDB's answer is a movie unless it says show (its shows carry kind "show"; movies none).
function isMovie(r) { var m = metaOf(r); return !!m && !r.ep && !/show|season|episode|tv/i.test(m.kind || ''); }
function pad2(x) { return (x < 10 ? '0' : '') + x; }
function libPlace(r) {
  var m = metaOf(r), d = new Date(r.startedAt || r.start || Date.now());
  var date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  if (isMovie(r)) {
    var t = clean(m.title || r.title) || 'Recording', y = /^\d{4}$/.test(String(m.year || '')) ? ' (' + m.year + ')' : '';
    return { dir: ['Movies', t + y], base: t + y, movie: true };
  }
  var show = clean(r.title) || clean(r.channel) || 'Recording', ep = epOf(r);
  return { dir: ['TV', show], show: show, base: show + ' - ' + (ep ? 's' + pad2(ep.s) + 'e' + pad2(ep.e) : date + ' ' + pad2(d.getHours()) + '.' + pad2(d.getMinutes())), ep: ep };
}
function mkdirp(d) { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); fs.mkdirSync(d); }
// The recordings folder a part sits in: what's above "TiviBro Recordings".
function rootOf(f) { var i = f.lastIndexOf(path.sep + FOLDER + path.sep); return i < 0 ? '' : f.slice(0, i + FOLDER.length + 1); }
// Empty folders a move or delete left (TV/<Show>, Movies/<Title>), never the recordings folder itself.
function prune(dir, root) {
  while (root && dir.length > root.length && dir.indexOf(root) === 0) {
    try { var left = fs.readdirSync(dir).filter(function (n) { return n !== '.DS_Store'; }); if (left.length) return; fs.rmdirSync(dir); } catch (e) { return; }
    dir = path.dirname(dir);
  }
}
function xml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function nfo(r, pl) {
  var m = metaOf(r) || {}, d = new Date(r.startedAt || r.start || Date.now());
  var aired = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), plot = m.plot || r.desc || '';
  var tag = function (k, v) { return v || v === 0 ? '  <' + k + '>' + xml(v) + '</' + k + '>\n' : ''; };
  var body = pl.movie
    ? tag('title', m.title || r.title) + tag('year', m.year) + tag('plot', plot) + tag('genre', m.genre) + tag('rating', m.rating) + tag('runtime', m.runtime) + tag('studio', r.channel) + tag('dateadded', aired)
    : tag('title', pl.ep ? r.title + ' ' + (r.ep || '') : r.title + ' ' + aired) + tag('showtitle', r.title) + (pl.ep ? tag('season', pl.ep.s) + tag('episode', pl.ep.e) : '') + tag('plot', r.desc || plot) + tag('aired', aired) + tag('genre', m.genre) + tag('studio', r.channel);
  var root = pl.movie ? 'movie' : 'episodedetails';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- Recorded by TiviBro from ' + xml(r.channel) + ' -->\n<' + root + '>\n' + body + '</' + root + '>\n';
}
function fetchTo(u, file, cb) {
  var done = false, end = function (e) { if (done) return; done = true; if (e) { try { fs.unlinkSync(file + '.tmp'); } catch (x) {} } cb(e); };
  var req = require('https').get(u, function (res) {
    if (res.statusCode !== 200) { res.resume(); return end(new Error('HTTP ' + res.statusCode)); }
    var out = fs.createWriteStream(file + '.tmp'), n = 0;
    res.on('data', function (c) { n += c.length; if (n > 4 * 1024 * 1024) { req.abort(); out.end(); end(new Error('too big')); } });
    res.pipe(out);
    out.on('finish', function () { if (done) return; fs.rename(file + '.tmp', file, end); });
    out.on('error', end);
  });
  req.on('error', end); req.setTimeout(20000, function () { req.abort(); end(new Error('timeout')); });
}
function sides(r) { return (r.side || []).slice(); }
// Moves the parts (and anything beside them) and writes the details.  Only for a finished one, not while it converts.
function tidy(r) {
  if (r.status !== 'done' || !(r.parts || []).length || (r.conv && r.conv.running) || process.env.TIVIBRO_REC_TIDY === '0') return;
  var pl = libPlace(r), m = metaOf(r), key = JSON.stringify([pl.dir, pl.base, m && m.poster, m && m.plot, (r.parts || []).length]);
  if (r.tidied === key) return;
  var root = rootOf(r.parts[0]); if (!root) return;
  var dir = path.join.apply(path, [root].concat(pl.dir)), many = r.parts.length > 1, ext = path.extname(r.parts[0]) || '.ts';
  try { mkdirp(dir); } catch (e) { return note('warn', 'recording: could not make its folder', { title: r.title, e: e.code || e.message }); }
  var olds = r.parts.map(function (f) { return path.dirname(f); }).concat(sides(r).map(function (f) { return path.dirname(f); }));
  // Its files beside it before: gone (written again below).
  sides(r).forEach(function (f) { try { fs.unlinkSync(f); } catch (e) {} });
  r.side = [];
  // A name taken by another recording (the same film twice): " (2)".
  var base = pl.base, n = 2, taken = function (b) { return r.parts.some(function (f, i) { var t = path.join(dir, b + (many ? ' - pt' + (i + 1) : '') + ext); return t !== f && fs.existsSync(t); }); };
  while (taken(base) && n < 50) base = pl.base + ' (' + n++ + ')';
  r.parts = r.parts.map(function (f, i) {
    var to = path.join(dir, base + (many ? ' - pt' + (i + 1) : '') + ext);
    if (to === f) return f;
    try { fs.renameSync(f, to); return to; } catch (e) { note('warn', 'recording: could not move it', { title: r.title, e: e.code || e.message }); return f; }
  });
  olds.forEach(function (d) { if (d !== dir) prune(d, root); });
  var nf = path.join(dir, base + '.nfo');
  try { fs.writeFileSync(nf, nfo(r, pl)); r.side.push(nf); } catch (e) {}
  r.tidied = key; save();
  // The poster, larger than the list's (w500): the folder's poster.jpg, kept if one is there (a show's earlier episode).
  if (m && m.poster) {
    var pf = path.join(dir, 'poster.jpg');
    if (fs.existsSync(pf)) { if (pl.movie) r.side.push(pf); return; }
    fetchTo(String(m.poster).replace(/\/t\/p\/w\d+\//, '/t/p/w500/'), pf, function (e) {
      if (e) return note('warn', 'recording: poster not saved', { title: r.title, e: e.message });
      if (pl.movie) { r.side.push(pf); save(); }
    });
  }
}

/* ---------- Convert to MP4 (or MKV) ---------- */
/* On a finished recording, from the Recordings screen: ffmpeg copies it (no re-encoding: a few minutes of disk work,
   little CPU) into one .mp4 with TMDB's details inside (title, plot, year, genre, show, season and episode, channel),
   which Plex, Infuse and Apple TV apps read.  When MP4 can't hold the channel's sound or picture, MKV instead, with
   the poster inside too.  The new file replaces the parts only once it's whole, and plays in TiviBro like before.
   Needs as much free room as the recording on the drive while it runs. */
var conv = {}, watched = {};
// Watched now, or in the last half minute (a player asks for the next piece every few seconds).
function inUse(id) { var w = watched[id]; return !!w && (w.n > 0 || Date.now() - w.at < +(process.env.TIVIBRO_REC_INUSE_MS || 30000)); }
function tagsFor(r, mkv) {
  var m = metaOf(r) || {}, pl = libPlace(r), d = new Date(r.startedAt || r.start || Date.now()), t = [];
  var add = function (k, v) { if (v || v === 0) t.push('-metadata', k + '=' + String(v).slice(0, 1000)); };
  add('title', pl.movie ? (m.title || r.title) : pl.ep ? r.title + ' ' + r.ep : r.title + ' ' + d.toDateString());
  add('date', m.year || d.getFullYear()); add('genre', m.genre); add('comment', 'Recorded by TiviBro from ' + r.channel);
  add('description', String(m.plot || r.desc || '').slice(0, 250)); add('synopsis', m.plot || r.desc);
  if (!pl.movie) { add('show', r.title); add('network', r.channel); if (pl.ep) { add('season_number', pl.ep.s); add('episode_sort', pl.ep.e); add('episode_id', r.ep); } }
  if (!mkv) add('media_type', pl.movie ? 9 : 10);
  return t;
}
function convArgs(r, tmp, mkv, poster, hevc, fromFile) {
  var a = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-fflags', '+genpts+discardcorrupt'];
  a = a.concat(fromFile ? ['-i', fromFile] : ['-f', 'mpegts', '-i', 'pipe:0']);
  a = a.concat(['-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-sn', '-dn', '-avoid_negative_ts', 'make_zero']).concat(tagsFor(r, mkv));
  if (mkv) { if (poster) a = a.concat(['-attach', poster, '-metadata:s:t', 'mimetype=image/jpeg', '-metadata:s:t', 'filename=cover.jpg']); a.push('-f', 'matroska'); }
  else { if (hevc) a.push('-tag:v', 'hvc1'); a.push('-movflags', '+faststart', '-f', 'mp4'); }
  return a.concat(['-y', tmp]);
}
function convert(r) {
  if (r.status !== 'done' || !(r.parts || []).length) return 'only a finished recording';
  if (r.conv && r.conv.running) return '';
  if (r.kind === 'mkv' || (r.kind === 'mp4' && r.conv && r.conv.done)) return 'it\'s converted already';
  if (r.kind === 'mp4' && r.parts.length > 1) return 'a recording in parts from an MP4 channel can\'t be joined';
  var Ff = require('./ffmpeg'), bin = Ff.binary();
  if (!bin) return 'TiviBro\'s converter isn\'t on this TV yet (it unpacks a minute after the start)';
  var dir = path.dirname(r.parts[0]), sp = space(dir);
  if (sp.freeMB >= 0 && sp.freeMB < (r.bytes || 0) / 1048576 + LOW_MB) return 'not enough room on the drive: it needs ' + Math.ceil((r.bytes || 0) / 1073741824 * 10) / 10 + ' GB free while it converts';
  var pl = libPlace(r), base = path.basename(r.parts[0], path.extname(r.parts[0])).replace(/ - pt1$/, '');
  var poster = path.join(dir, 'poster.jpg'); if (!fs.existsSync(poster)) poster = '';
  r.conv = { running: true, pct: 0, at: Date.now() }; save();
  note('info', 'recording: converting', { title: r.title, mb: Math.round((r.bytes || 0) / 1048576) });
  // Is the picture HEVC?  Apple's players want it marked hvc1 in an MP4.
  var probe = cp.spawn(bin, ['-hide_banner', '-nostdin', '-i', r.parts[0]], { stdio: ['ignore', 'ignore', 'pipe'] }), info = '';
  var pt = setTimeout(function () { try { probe.kill(); } catch (e) {} }, 20000);
  probe.stderr.on('data', function (d) { if (info.length < 20000) info += d; });
  probe.on('error', function () {});
  probe.on('close', function () { clearTimeout(pt); attempt(false, /Video: hevc/.test(info)); });
  function attempt(mkv, hevc) {
    if (!byId(r.id)) return;
    var ext = mkv ? '.mkv' : '.mp4', tmp = path.join(dir, '.' + base + ext + '.part'), err = '';
    r.conv.tmp = tmp; r.conv.as = mkv ? 'mkv' : 'mp4';
    var fromFile = r.kind === 'mp4' ? r.parts[0] : '';
    var p; try { p = cp.spawn('nice', ['-n', '10', bin].concat(convArgs(r, tmp, mkv, poster, hevc, fromFile)), { stdio: [fromFile ? 'ignore' : 'pipe', 'ignore', 'pipe'] }); }
    catch (e) { return end('the converter didn\'t start: ' + e.message); }
    conv[r.id] = p;
    p.stderr.on('data', function (d) { if (err.length < 4000) err += d; });
    p.on('error', function (e) { err += e.message; });
    var total = r.bytes || 1, sent = 0;
    if (!fromFile) {
      var files = r.parts.slice();
      p.stdin.on('error', function () {});
      (function next() {
        var f = files.shift(); if (!f) return p.stdin.end();
        var rs = fs.createReadStream(f);
        rs.on('data', function (c) { sent += c.length; var pc = Math.min(99, Math.floor(sent * 100 / total)); if (pc !== r.conv.pct) { r.conv.pct = pc; } });
        rs.on('error', function () { p.stdin.end(); });
        rs.on('end', next);
        rs.pipe(p.stdin, { end: false });
      })();
    }
    p.on('close', function (code) {
      delete conv[r.id];
      if (!byId(r.id) || r.conv.cancelled) { try { fs.unlinkSync(tmp); } catch (e) {} return; }
      var size = 0; try { size = fs.statSync(tmp).size; } catch (e) {}
      if (code !== 0 || size < 1024) {
        try { fs.unlinkSync(tmp); } catch (e) {}
        var why = err.trim().split('\n').pop().slice(0, 200) || 'ffmpeg stopped (' + code + ')';
        if (!mkv) { note('info', 'recording: MP4 didn\'t take it, MKV instead', { title: r.title, e: why }); return attempt(true, hevc); }
        return end('it couldn\'t be converted: ' + why);
      }
      // Someone is watching it: the swap waits until they stop (the TV's player would get the new file mid-way).
      if (inUse(r.id)) { r.conv.pct = 99; r.conv.waiting = true; return setTimeout(function () { p.emit('close', 0); }, 5000); }
      var final = path.join(dir, base + ext), n = 2;
      while (fs.existsSync(final) && r.parts.indexOf(final) < 0 && n < 50) final = path.join(dir, base + ' (' + n++ + ')' + ext);
      var olds = r.parts.slice();
      // The new file first, then the old parts: a failure in between leaves both, never neither.
      try { if (olds.indexOf(final) >= 0) fs.unlinkSync(final); fs.renameSync(tmp, final); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} return end('the new file couldn\'t be put in place: ' + (e.code || e.message)); }
      olds.forEach(function (f) { if (f !== final) { try { fs.unlinkSync(f); } catch (e) {} } });
      r.parts = [final]; r.kind = mkv ? 'mkv' : 'mp4'; r.bytes = size;
      r.conv = { done: r.kind, at: Date.now() };
      // tidy's names follow the new extension.
      r.tidied = ''; save(); tidy(r);
      note('info', 'recording converted', { title: r.title, as: r.kind, mb: Math.round(size / 1048576) });
    });
  }
  function end(why) { r.conv = { error: why, at: Date.now() }; save(); note('warn', 'recording: convert failed', { title: r.title, e: why }); }
  return '';
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
  // Pause buffers an earlier run left (TiviBro or the agent stopped with one open): cleared, they can't be resumed.
  try { drives().forEach(function (d) { TS.clearAll(path.join(d.dir, FOLDER)); }); if (!AGENT) TS.clearAll(require('./storage').sub('pause')); } catch (e) {}
  watchAgent();
  if (!timer) { timer = setInterval(tick, TICK_MS); if (timer.unref) timer.unref(); }
  setTimeout(tick, 500);
}

/* ---------- routes ---------- */
function body(req, cb) {
  var b = '', over = false;
  req.on('data', function (c) { if (over) return; b += c; if (b.length > BODY_MAX) over = true; });
  req.on('end', function () { if (over) return cb(new Error('too large')); try { cb(null, JSON.parse(b || '{}')); } catch (e) { cb(e); } });
}
function cleanMeta(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.miss) return { miss: true, at: Date.now() };
  var out = {}, url = function (u) { u = String(u || ''); return /^https:\/\/[^\s"']{1,500}$/.test(u) ? u : ''; };
  ['title', 'year', 'genre', 'runtime', 'rating', 'kind'].forEach(function (k) { if (m[k] != null) out[k] = String(m[k]).slice(0, 120); });
  out.plot = String(m.plot || '').slice(0, 1200);
  ['poster', 'backdrop', 'backdropHd', 'logo'].forEach(function (k) { var u = url(m[k]); if (u) out[k] = u; });
  out.at = Date.now();
  return out;
}
function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function okUrl(u) { return /^http:\/\/127\.0\.0\.1:\d+\//.test(String(u || '')); }     // the relay only: no recording of arbitrary addresses
function add(q, scheduled) {
  var now = Date.now(), r = { id: newId(), url: String(q.url), alt: okUrl(q.alt) && q.alt !== q.url ? String(q.alt) : '', key: String(q.key || '').slice(0, 200), desc: String(q.desc || '').slice(0, 1500), ep: String(q.ep || '').slice(0, 40), logo: String(q.logo || '').slice(0, 500), title: String(q.title || q.channel || 'Recording').slice(0, 200), channel: String(q.channel || '').slice(0, 200),
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
  var h = { 'Content-Type': r.kind === 'mp4' ? 'video/mp4' : r.kind === 'mkv' ? 'video/x-matroska' : 'video/mp2t', 'Accept-Ranges': 'bytes', 'Content-Length': en - s + 1 };
  // Being watched: a finished conversion waits until it isn't (convert, below), so the player never gets the new file
  // in the middle of the old one.
  var w = watched[r.id] = watched[r.id] || { n: 0, at: 0 }; w.n++; w.at = Date.now();
  var left = false; function gone() { if (left) return; left = true; w.n--; w.at = Date.now(); }
  res.on('close', gone); res.on('finish', gone);
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
/* Raised whenever record-agent.js or what it runs changes in a way an old agent would miss (2: it keeps the helper up
   for the phone app; 3: recordings filed for media servers, Convert to MP4).  The version can't tell: every alpha is 0.6.0 to the helper. */
var AGENT_REV = 3;
function agentUp(cb) {
  var r = http.get({ hostname: '127.0.0.1', port: AGENT_PORT, path: '/record/ping', headers: { 'X-TiviBro-Ctl': agentKey() } }, function (res) {
    var b = ''; res.on('data', function (d) { b += d; });
    res.on('end', function () { var j = {}; try { j = JSON.parse(b); } catch (e) {} cb(res.statusCode === 200, res.statusCode, j); });
  });
  r.on('error', function () { cb(false); }); r.setTimeout(1500, function () { r.abort(); });
}
var agentRenewed = false;
function ensureAgent(cb) {
  agentUp(function (up, code, j) {
    /* An agent from an older TiviBro (it keeps running through an update): replaced, once it isn't recording or
       buffering, so its fixes (the helper watchdog) take effect.  code 403 below stops it first. */
    if (up && j && (+j.rev || 1) < AGENT_REV && !j.busy && !agentRenewed) { agentRenewed = true; note('info', 'recording agent is an older one (' + (+j.rev || 1) + '): starting this one'); up = false; code = 403; }
    if (up) return cb(true);
    if (!lcall) return cb(false);
    // No Homebrew Channel (a TV that isn't rooted): not asked again for 10 minutes.
    if (agentNoUntil > Date.now()) return cb(false);
    if (agentStarting) return agentStarting.push(cb);
    agentStarting = [cb];
    var done = function (ok) { var l = agentStarting || []; agentStarting = null; l.forEach(function (f) { f(ok); }); };
    // One with another secret (its key file was lost): stopped first.  Then ours, in the background.
    var pidf = '/media/developer/.tivibro-rec/agent.pid';
    var cmd = (code === 403 ? 'kill $(cat ' + pidf + ') 2>/dev/null; sleep 1; ' : '') + 'TIVIBRO_REC_CTL=' + agentKey() + ' TIVIBRO_REC_NEEDED=' + neededFile() + ' nohup /usr/bin/node ' + path.join(__dirname, 'record-agent.js') + ' >/dev/null 2>&1 &';
    lcall('luna://org.webosbrew.hbchannel.service/exec', { command: cmd }, function (r) {
      var ok0 = r && r.returnValue !== false, tries = 0;
      if (!ok0) { agentNoUntil = Date.now() + 600000; var s0 = 'not possible: ' + (r && (r.errorText || r.stderrString) || 'no Homebrew Channel'); if (s0 !== agentSaid) { agentSaid = s0; note('warn', 'recording agent ' + s0); } return done(false); }
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
  // rev: what the agent does (AGENT_REV), so a helper from a newer TiviBro restarts an old agent; busy: not while it records or buffers.
  if (req.method === 'GET' && p === '/record/ping') return send(res, ALLOW, 200, { ok: true, agent: AGENT, rev: AGENT_REV,
    busy: load().recs.some(function (r) { return r.status === 'recording'; }) || Object.keys(TS._sessions).some(function (k) { return !TS._sessions[k].stopped; }) });
  if (req.method === 'GET' && p === '/record/drives') { var dv = drives(); return send(res, ALLOW, 200, { drives: dv, skipped: seen, uid: process.getuid ? process.getuid() : null, gids: process.getgroups ? process.getgroups() : null }); }
  if (req.method === 'GET' && p === '/record/list') {
    tick();
    var dl = drives(), sp0 = dl.length ? space(dl[0].dir) : null;
    return send(res, ALLOW, 200, { recs: load().recs.map(pub), drive: sp0 ? { name: dl[0].name, freeMB: sp0.freeMB, totalMB: sp0.totalMB, low: sp0.freeMB >= 0 && sp0.freeMB < LOW_MB } : null,
      pauseHere: !dl.length && !!tvRoom() });
  }
  var fm = /^\/record\/file\/([A-Za-z0-9]+)(?:\/[^\/]*)?$/.exec(p);       // "/rec.ts" after the id tells the player what it is
  if (fm && (req.method === 'GET' || req.method === 'HEAD')) { var fr = byId(fm[1]); return fr ? serveFile(req, res, ALLOW, fr, u.query.part != null ? +u.query.part : null) : send(res, ALLOW, 404, { error: 'no such recording' }); }
  if (p.indexOf('/record/ts/') === 0 && req.method !== 'POST') { if (TS.route(req, res, ALLOW, p, u.query, send) !== null) return; return send(res, ALLOW, 404, { error: 'no such route' }); }
  if (req.method !== 'POST') return send(res, ALLOW, 404, { error: 'no such route' });
  body(req, function (e, q) {
    if (e) return send(res, ALLOW, 400, { error: 'bad request' });
    // Live pause (timeshift.js): a buffer on the drive the player plays from.
    if (p.indexOf('/record/ts/') === 0) {
      TS.setup({ feed: Feed, freeMB: function (d) { return require('./storage')._freeMB(d); }, log: logf });
      if (p === '/record/ts/start') {
        if (!okUrl(q.url)) return send(res, ALLOW, 400, { error: 'not a relayed address' });
        var dv = drives(), small = !dv.length, where = dv.length ? folderOn(dv[0].dir) : tvRoom();
        if (!where) return send(res, ALLOW, 409, { error: 'Plug in a USB drive to pause live TV.', code: 'nodrive' });
        var tsr = TS.post(p, q, where, small);
        return send(res, ALLOW, tsr.error && !tsr.id ? 500 : 200, tsr);
      }
      var tr = TS.post(p, q);
      return tr ? send(res, ALLOW, tr.gone ? 404 : 200, tr) : send(res, ALLOW, 404, { error: 'no such route' });
    }
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
    // What TMDB knows about it (the app asks, with your token): poster, backdrop, plot, year, genre, rating.
    if (p === '/record/meta') { r.meta = cleanMeta(q.meta); save(); tidy(r); return send(res, ALLOW, 200, pub(r)); }
    if (p === '/record/convert') { var cw = convert(r); return cw ? send(res, ALLOW, 409, { error: cw }) : send(res, ALLOW, 200, pub(r)); }
    if (p === '/record/delete') {
      halt(r);
      if (conv[r.id]) { r.conv.cancelled = true; try { conv[r.id].kill('SIGKILL'); } catch (x) {} }
      if (r.conv && r.conv.tmp) { try { fs.unlinkSync(r.conv.tmp); } catch (x) {} }
      var droot = r.parts && r.parts[0] ? rootOf(r.parts[0]) : '', ddirs = {};
      (r.parts || []).concat(sides(r)).forEach(function (f) { ddirs[path.dirname(f)] = 1; try { fs.unlinkSync(f); } catch (x) {} });
      // The folder's poster.jpg goes with the last recording in it.
      Object.keys(ddirs).forEach(function (d) { try { var l = fs.readdirSync(d); if (l.length === 1 && l[0] === 'poster.jpg') fs.unlinkSync(path.join(d, 'poster.jpg')); } catch (x) {} prune(d, droot); });
      state.recs = state.recs.filter(function (x) { return x !== r; }); save();
      return send(res, ALLOW, 200, { ok: true });
    }
    send(res, ALLOW, 404, { error: 'no such route' });
  });
}

module.exports = { handle: handle, start: start, drives: drives, setCall: setCall, _tick: tick, _reset: function () { TS._stopAll(); Object.keys(run).forEach(function (k) { halt(byId(k) || { id: k }); }); state = null; }, _nameFor: nameFor, _libPlace: libPlace, _tidy: tidy, _convArgs: convArgs };
