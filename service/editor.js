/* TiviBro web editor server.
   Lets someone edit groups, channels and name rules from a browser on a computer on the same
   network, at http://<TV address>:<port>, protected by a password shown on the TV.

   The app stays the source of truth:
   - The app (on the TV) sends a snapshot of its playlist and edits over localhost
     (POST /editor/snapshot on the relay) and polls for changes (GET /editor/pending).
   - The browser logs in (POST /api/login), reads the snapshot (GET /api/state), and saves its
     edited copy (POST /api/save).  The app applies it and sends a fresh snapshot.
   Only editing data travels: group and channel names, logos and the user's edits.  Never the
   provider username, password or stream links (playlists show their host name only).
   Actions the app must carry out (add or change a playlist, guide sources, backup, restore)
   go through a small command queue: the browser posts a command, the app picks it up with
   its next check, runs it, and posts the result, which the browser polls for.  A backup is
   the one thing that contains logins, and only when the user asks to download it.

   The LAN server only runs while the user has switched it on in the app, and stops with the
   app.  Logins are rate limited per address.  Plain ES5 for the old Node on webOS TVs (see compat.js). */
'use strict';
require('./compat');                 // older Node on older webOS: fill in what is missing
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');

/* Backups hold provider logins, so they are encrypted here, in the helper, before they leave the TV.
   AES-256-GCM with a key from PBKDF2-SHA256 (200,000 rounds) over a passphrase the user picks.
   The browser only ever sees the encrypted file; on restore it sends the file and the passphrase,
   and the helper decrypts and hands the backup to the app over localhost. */
var KDF_ITER = 200000;
function b64(b) { return b.toString('base64'); }
function seal(obj, pass, cb) {
  var salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  crypto.pbkdf2(String(pass), salt, KDF_ITER, 32, 'sha256', function (err, key) {
    if (err) return cb(err);
    try {
      var c = crypto.createCipheriv('aes-256-gcm', key, iv);
      var data = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
      cb(null, { app: 'TiviBro', kind: 'backup-encrypted', format: 2, version: obj.version || '', created: obj.created || new Date().toISOString(),
        playlists: (obj.settings && obj.settings.playlists || []).length,
        kdf: 'pbkdf2-sha256', iter: KDF_ITER, cipher: 'aes-256-gcm', salt: b64(salt), iv: b64(iv), tag: b64(c.getAuthTag()), data: b64(data) });
    } catch (e) { cb(e); }
  });
}
function open_(env, pass, cb) {
  var iter = +env.iter || KDF_ITER;
  if (env.kdf !== 'pbkdf2-sha256' || env.cipher !== 'aes-256-gcm' || iter < 10000 || iter > 5000000) return cb(new Error('This backup uses a format this version cannot read.'));
  crypto.pbkdf2(String(pass), Buffer.from(env.salt || '', 'base64'), iter, 32, 'sha256', function (err, key) {
    if (err) return cb(err);
    try {
      var d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv || '', 'base64'));
      d.setAuthTag(Buffer.from(env.tag || '', 'base64'));
      var out = Buffer.concat([d.update(Buffer.from(env.data || '', 'base64')), d.final()]);
      cb(null, JSON.parse(out.toString('utf8')));
    } catch (e) { cb(new Error('Wrong passphrase, or the file was changed.')); }
  });
}
// What the browser may see about a backup: names and servers, never logins.
function summary(b) {
  var hostOf = function (u) { var m = /^(?:https?:\/\/)?(?:[^@/]*@)?([^/:?#]+)/i.exec(u || ''); return m ? m[1] : ''; };
  return { created: b.created, version: b.version, playlists: (b.settings.playlists || []).map(function (p) { return { name: p.name || p.type, type: p.type, host: hostOf(p.type === 'm3u' ? p.m3u : p.server) }; }),
    restorePoints: Object.keys(b.snaps || {}).reduce(function (n, k) { return n + ((b.snaps[k] || []).length || 0); }, 0) };
}
function isBackup(b) { return !!(b && b.app === 'TiviBro' && b.kind === 'backup' && b.settings && Array.isArray(b.settings.playlists)); }

var STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/names.js': ['names.js', 'application/javascript; charset=utf-8'],
  '/favicon.png': ['favicon.png', 'image/png'], '/favicon.ico': ['favicon.png', 'image/png'], '/wordmark.png': ['wordmark.png', 'image/png'], '/mark.png': ['mark.png', 'image/png'] };
var MAX_BODY = 25 * 1024 * 1024;

function create(log) {
  log = log || function () {};
  var st = {
    server: null, port: 0, password: '', tokens: {},
    snapshot: null, snapRev: 0,          // what the app last sent
    pending: null, pendingRev: 0,        // what a browser last saved, not yet applied by the app
    appliedRev: 0,                       // newest browser save the app has applied
    fails: {}, seen: {},
    commands: [], cmdSeq: 0, results: {},  // browser -> app actions and their outcomes
    seal: {},                            // command id -> passphrase for a backup being made (never sent to the app)
    progress: null                       // live guide download progress from the app
  };
  var dir = path.join(__dirname, 'editor');

  function ips() {
    var out = [], ifs = os.networkInterfaces();
    Object.keys(ifs).forEach(function (n) {
      (ifs[n] || []).forEach(function (a) { if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address); });
    });
    return out;
  }
  function clients() {
    var now = Date.now(), n = 0;
    Object.keys(st.seen).forEach(function (t) { if (now - st.seen[t] < 15000) n++; else delete st.seen[t]; });
    return n;
  }
  function status() {
    return { running: !!st.server, port: st.port, ips: ips(), clients: clients(), snapRev: st.snapRev, pendingRev: st.pendingRev, appliedRev: st.appliedRev };
  }

  function send(res, code, obj, type) {
    var body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  }
  function readJSON(req, cb) {
    var chunks = [], size = 0, done = false;
    req.on('data', function (d) {
      size += d.length;
      if (size > MAX_BODY && !done) { done = true; cb(new Error('too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', function () {
      if (done) return; done = true;
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { cb(e); }
    });
  }
  function same(a, b) {
    var x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  /* ---------- LAN server (the browser) ---------- */
  function lan(req, res) {
    var u = req.url.split('?')[0];
    var who = req.socket.remoteAddress || '?';
    if (req.method === 'GET' && STATIC[u]) {
      var f = STATIC[u];
      return fs.readFile(path.join(dir, f[0]), function (err, buf) { if (err) return send(res, 404, 'missing ' + f[0], 'text/plain'); send(res, 200, buf, f[1]); });
    }
    if (u === '/api/login' && req.method === 'POST') {
      var fl = st.fails[who] || { n: 0, until: 0 };
      if (fl.until > Date.now()) return send(res, 429, { error: 'Too many wrong passwords.  Wait ' + Math.ceil((fl.until - Date.now()) / 1000) + ' seconds.' });
      return readJSON(req, function (err, j) {
        if (err || !j || typeof j.password !== 'string') return send(res, 400, { error: 'bad request' });
        var typed = j.password.replace(/[\s-]/g, '').toUpperCase(), real = st.password.replace(/[\s-]/g, '').toUpperCase();
        if (!real || !same(typed, real)) {
          fl.n++; if (fl.n >= 5) { fl.until = Date.now() + 60000; fl.n = 0; }
          st.fails[who] = fl;
          log({ lv: 'warn', event: 'editor login failed', from: who });
          return send(res, 401, { error: 'Wrong password.  It is shown on the TV under Settings, Edit on a computer.' });
        }
        delete st.fails[who];
        var token = crypto.randomBytes(24).toString('hex');
        st.tokens[token] = Date.now();
        st.seen[token] = Date.now();
        log({ lv: 'info', event: 'editor login', from: who });
        send(res, 200, { token: token });
      });
    }
    var tok = req.headers['x-token'];
    if (!tok || !st.tokens[tok]) return send(res, 401, { error: 'Please log in' });
    st.seen[tok] = Date.now();
    if (u === '/api/state' && req.method === 'GET') {
      if (!st.snapshot) return send(res, 503, { error: 'The TV has not sent its channel list yet.  Keep TiviBro open on the TV.' });
      return send(res, 200, { rev: st.snapRev, appliedRev: st.appliedRev, data: st.snapshot });
    }
    if (u === '/api/rev' && req.method === 'GET') return send(res, 200, { rev: st.snapRev, pendingRev: st.pendingRev, appliedRev: st.appliedRev, progress: st.progress, tvSeen: st.tvSeen || 0, now: Date.now() });
    if (u === '/api/save' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j || !j.edits) return send(res, 400, { error: 'bad request' });
        st.pendingRev++;
        st.pending = { rev: st.pendingRev, edits: j.edits, names: j.names || null, at: Date.now() };
        log({ lv: 'info', event: 'editor save', rev: st.pendingRev, from: who });
        send(res, 200, { ok: true, pendingRev: st.pendingRev });
      });
    }
    if (u === '/api/restore' && req.method === 'POST') {
      // { file, passphrase, check }: decrypt (or accept an old plain backup), then either describe it or restore it.
      return readJSON(req, function (err, j) {
        if (err || !j || !j.file) return send(res, 400, { error: 'That file could not be read.' });
        function go(b) {
          if (!isBackup(b)) return send(res, 400, { error: 'That is not a TiviBro backup file.' });
          if (j.check) return send(res, 200, { ok: true, summary: summary(b), encrypted: j.file.kind === 'backup-encrypted' });
          st.cmdSeq++;
          st.commands.push({ id: st.cmdSeq, type: 'restore', args: { data: b }, at: Date.now() });
          log({ lv: 'info', event: 'editor restore queued', id: st.cmdSeq, from: who });
          send(res, 200, { ok: true, id: st.cmdSeq, summary: summary(b) });
        }
        if (j.file.kind === 'backup-encrypted') {
          if (typeof j.passphrase !== 'string' || !j.passphrase) return send(res, 400, { error: 'Enter the passphrase you chose when you made this backup.' });
          return open_(j.file, j.passphrase, function (e, b) { if (e) { log({ lv: 'warn', event: 'editor restore: could not decrypt', from: who }); return send(res, 400, { error: e.message }); } go(b); });
        }
        go(j.file);
      });
    }
    if (u === '/api/command' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j || typeof j.type !== 'string') return send(res, 400, { error: 'bad request' });
        if (j.type === 'restore') return send(res, 400, { error: 'Use /api/restore.' });
        var pass = null;
        if (j.type === 'backup') {
          pass = j.args && j.args.passphrase;
          if (typeof pass !== 'string' || pass.length < 8) return send(res, 400, { error: 'Pick a passphrase of at least 8 characters to protect the backup.' });
          j.args = {};
        }
        st.cmdSeq++;
        if (pass) st.seal[st.cmdSeq] = pass;
        st.commands.push({ id: st.cmdSeq, type: j.type, args: j.args || {}, at: Date.now() });
        if (st.commands.length > 30) st.commands.splice(0, st.commands.length - 30);
        log({ lv: 'info', event: 'editor command', type: j.type, id: st.cmdSeq, from: who });
        send(res, 200, { ok: true, id: st.cmdSeq });
      });
    }
    if (u === '/api/result' && req.method === 'GET') {
      var id = +((/id=(\d+)/.exec(req.url) || [])[1] || 0), r = st.results[id];
      return send(res, 200, r ? Object.assign({ done: true }, r) : { done: false });
    }
    if (u === '/api/logout' && req.method === 'POST') { delete st.tokens[tok]; delete st.seen[tok]; return send(res, 200, { ok: true }); }
    send(res, 404, { error: 'not found' });
  }

  function start(port, password, cb) {
    if (!/^[A-Z0-9]{6,16}$/i.test(String(password || '').replace(/-/g, ''))) return cb(new Error('password missing'));
    st.password = String(password);
    if (st.server && st.port === port) return cb(null, status());
    stop();
    var srv = http.createServer(function (req, res) {
      try { lan(req, res); } catch (e) { log({ lv: 'error', event: 'editor request failed', e: e.message }); try { send(res, 500, { error: 'server error' }); } catch (x) {} }
    });
    srv.once('error', function (e) { log({ lv: 'error', event: 'editor listen failed', port: port, e: e.code || e.message }); st.server = null; cb(new Error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use.  Pick another port.' : e.message)); });
    srv.listen(port, '0.0.0.0', function () {
      st.server = srv; st.port = port;
      log({ lv: 'info', event: 'editor listening', port: port, ips: ips() });
      cb(null, status());
    });
  }
  function stop() {
    if (st.server) { try { st.server.close(); } catch (e) {} log({ lv: 'info', event: 'editor stopped' }); }
    st.server = null; st.port = 0; st.tokens = {}; st.seen = {};
    // Nothing from this session may reach the TV later: a TiviBro that restarts (switching playlist,
    // a restore) starts counting from zero and would otherwise apply a stale save to the wrong list.
    st.pending = null; st.appliedRev = st.pendingRev; st.commands = []; st.results = {}; st.seal = {}; st.progress = null;
  }

  /* ---------- control from the app (localhost relay only) ---------- */
  function control(req, res, u) {
    st.tvSeen = Date.now();
    if (u === '/editor/status') return send(res, 200, status());
    if (u === '/editor/progress' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j) return send(res, 400, { error: 'bad progress' });
        st.progress = Object.assign({}, j, { at: Date.now() });
        send(res, 200, { ok: true });
      });
    }
    if (u === '/editor/stop' && req.method === 'POST') { stop(); return send(res, 200, status()); }
    if (u === '/editor/start' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j) return send(res, 400, { error: 'bad request' });
        start(+j.port || 8787, j.password, function (e, s) { if (e) return send(res, 409, { error: e.message }); send(res, 200, s); });
      });
    }
    if (u === '/editor/snapshot' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j) return send(res, 400, { error: 'bad snapshot' });
        st.snapshot = j; st.snapRev++;
        if (j.appliedRev) st.appliedRev = Math.max(st.appliedRev, +j.appliedRev);
        send(res, 200, { ok: true, rev: st.snapRev });
      });
    }
    if (u === '/editor/pending') {
      var since = +((/since=(\d+)/.exec(req.url) || [])[1] || 0), csince = +((/csince=(\d+)/.exec(req.url) || [])[1] || 0);
      var cmds = st.commands.filter(function (c) { return c.id > csince; });
      if (st.pending && st.pending.rev > since) return send(res, 200, Object.assign({ commands: cmds }, st.pending));
      return send(res, 200, { rev: st.pendingRev, none: true, commands: cmds });
    }
    if (u === '/editor/result' && req.method === 'POST') {
      return readJSON(req, function (err, j) {
        if (err || !j || !j.id) return send(res, 400, { error: 'bad result' });
        var pass = st.seal[j.id]; delete st.seal[j.id];
        if (pass && j.ok && j.data) {
          // A backup: encrypt before the browser can fetch it.  The answer shows up once sealed.
          st.commands = st.commands.filter(function (c) { return c.id !== j.id; });
          send(res, 200, { ok: true });
          return seal(j.data, pass, function (e, env) {
            st.results[j.id] = e ? { ok: false, msg: 'Could not encrypt the backup: ' + e.message, data: null, at: Date.now() } : { ok: true, msg: String(j.msg || ''), data: env, at: Date.now() };
          });
        }
        if (pass && j.ok) j = { id: j.id, ok: false, msg: 'The TV sent no backup data.' };
        st.results[j.id] = { ok: !!j.ok, msg: String(j.msg || ''), data: j.data === undefined ? null : j.data, at: Date.now() };
        st.commands = st.commands.filter(function (c) { return c.id !== j.id; });
        var keys = Object.keys(st.results).map(Number).sort(function (a, b) { return a - b; });
        while (keys.length > 30) delete st.results[keys.shift()];
        send(res, 200, { ok: true });
      });
    }
    send(res, 404, { error: 'not found' });
  }

  return { control: control, start: start, stop: stop, status: status };
}

module.exports = { create: create, seal: seal, open: open_ };
