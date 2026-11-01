/* TiviBro phone app connection (the "companion").
   Lets the TiviBro phone app find this TV on the network, pair with it once, and then wake TiviBro,
   open the web editor full screen and (later) act as a remote, even while TiviBro is closed.

   Off until the user switches it on in TiviBro (Settings, Phone app).  While on, the helper keeps
   running in the background with a small LAN server on port 47810 (TCP) and answers discovery on
   47810 (UDP).

   Security, with no certificates on a plain-http LAN:
   - Pairing needs the TV in hand: TiviBro shows a one-time code (and a QR code carrying it) for ten
     minutes.  The code itself never crosses the network.  The phone proves it knows it with an HMAC
     under a key stretched from the code (PBKDF2-SHA256, 100,000 rounds, salted with this TV's id);
     the TV answers with a fresh random key for that phone, encrypted under the same stretched key
     (AES-256-GCM), plus its own HMAC proof, so each side knows the other saw the code.  Someone
     listening on the network learns nothing they can use; five wrong tries close the pairing.
   - After that every request is signed with the phone's key (HMAC-SHA256 over the method, path,
     time, a random nonce and the body), checked against the TV's clock and a nonce list (no replay),
     and every answer is signed back, so the phone can tell a forged or altered answer.
   - Phones are listed in TiviBro and can be removed there; a removed phone's key stops working at
     once.  Keys stay in companion.json next to the helper, never in a backup.
   See docs/wiki/Phone-app-protocol.md.  Plain ES5 and callbacks for the old Node on webOS (compat.js). */
'use strict';
require('./compat');
var http = require('http');
var dgram = require('dgram');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');

var API = 1;
var PORT = 47810;                      // TCP: the phone API.  UDP: discovery.
var PORTS = [47810, 47816, 47817, 47818];
var DISCOVER = 'tivibro-discover-v1';
var KDF_ITER = 100000;
var PAIR_MS = 10 * 60000;              // a pairing code lasts ten minutes
var PAIR_TRIES = 5;                    // wrong tries before the code stops working
var SKEW_MS = 5 * 60000;               // signed requests: how far the phone's time may be from the TV's
var MAX_BODY = 64 * 1024;
var MAX_PHONES = 12;
var CODE_ABC = 'ACDEFHJKMNPQRTWXY3479';   // nothing that can be misread: no 0/O, 1/I/L, 2/Z, 5/S, 6/G, 8/B, U/V
var APP_ID = 'app.tivibro.tv';

function hex(b) { return b.toString('hex'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf || '').digest('hex'); }
function hmac(key, text) { return crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex'); }
function same(a, b) {
  var x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function randomCode() {
  var b = crypto.randomBytes(12), out = '';
  for (var i = 0; i < 12; i++) out += CODE_ABC[b[i] % CODE_ABC.length];
  return out;
}
// What the user may type: any case, with spaces and dashes.
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function showCode(c) { return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8); }
function cleanText(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 40); }
function pairKey(code, tvId, cb) { crypto.pbkdf2(normCode(code), 'tivibro-pair-v1:' + tvId, KDF_ITER, 32, 'sha256', cb); }

function ips() {
  var out = [], ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (n) {
    (ifs[n] || []).forEach(function (a) { if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ ip: a.address, mac: a.mac || '', ifname: n }); });
  });
  return out;
}

/* opts: dir (where companion.json lives), log, version,
   launch(params, cb(err)): open TiviBro,
   sysinfo(cb({ model, webos, name })): what the TV says about itself (best effort),
   app(): { open, visible }: is TiviBro running and on screen,
   editor(): the running web editor (editor.js instance) or null,
   onChange(): the state changed (pairing done, phone removed). */
function create(opts) {
  opts = opts || {};
  var log = opts.log || function () {};
  var FILE = path.join(opts.dir || __dirname, 'companion.json');
  var st = load();
  var server = null, udp = null, port = 0, pairing = null, nonces = {}, fails = {}, sys = null, wantEditor = 0, udpCount = { t: 0, n: 0 };
  /* The remote and Play on TV (phase 2).  Phones queue commands, which TiviBro on the TV picks up with
     a long poll (/companion/next) and carries out; TiviBro sends what it is playing (/companion/state)
     and, when a phone asks, its channel list (/companion/lineup).  Phones wait for changes with a
     long poll too (/v1/state).  Volume goes straight to the TV, with or without TiviBro. */
  var cmds = [], cmdSeq = 0, appWait = [], phoneWait = [], tvState = { rev: 0, data: null, at: 0 }, lineup = null, lineupRev = 0, wantLineup = false, launchedAt = 0;

  function load() {
    var s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    if (!/^[0-9a-f]{16}$/.test(s.id || '')) s.id = hex(crypto.randomBytes(8));
    s.on = !!s.on;
    s.name = cleanText(s.name, 40);
    s.phones = Array.isArray(s.phones) ? s.phones.filter(function (p) { return p && /^[0-9a-f]{12}$/.test(p.id) && typeof p.key === 'string'; }) : [];
    return s;
  }
  function save() {
    var tmp = FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(st), { mode: 384 });   // 0600: phone keys
      fs.renameSync(tmp, FILE);
      return true;
    } catch (e) { log({ lv: 'error', event: 'companion: could not save', e: e.message }); return false; }
  }
  function changed() { if (opts.onChange) try { opts.onChange(); } catch (e) {} }

  function version() { return st.version || opts.version || ''; }
  function tvName() { return st.name || (sys && sys.name) || (sys && sys.model ? 'LG ' + sys.model : 'LG TV'); }
  function phoneView(p) { return { id: p.id, name: p.name, model: p.model, platform: p.platform, added: p.added, seen: p.seen || 0, ip: p.ip || '' }; }
  function addresses() { return ips().map(function (a) { return a.ip; }); }

  // For TiviBro on the TV (over the localhost relay).
  function status() {
    var pr = pairing && pairing.until > Date.now() ? pairing : null;
    var a = addresses();
    return {
      on: st.on, running: !!server, port: port || PORT, id: st.id, name: tvName(), ownName: st.name, ips: a,
      phones: st.phones.map(phoneView),
      pairing: pr ? { code: showCode(pr.code), until: pr.until, left: PAIR_MS - (Date.now() - pr.at), tries: pr.tries, paired: pr.paired || null,
        link: 'https://tivibro.app/pair#v=1&h=' + encodeURIComponent((a[0] || '') + ':' + (port || PORT)) + '&id=' + st.id + '&c=' + pr.code + '&n=' + encodeURIComponent(tvName()) } : null,
      lastPaired: pairing && pairing.paired ? pairing.paired : null,
      wantEditor: wantEditor
    };
  }

  /* ---------- the phone API (LAN) ---------- */
  function send(res, code, obj, key, nonce) {
    var body = JSON.stringify(obj);
    var h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (key && nonce) h['X-TiviBro-Sig'] = hmac(key, 'tivibro-res-v1\n' + nonce + '\n' + code + '\n' + sha256(Buffer.from(body, 'utf8')));
    res.writeHead(code, h);
    res.end(body);
  }
  function readBody(req, cb, max) {
    var chunks = [], size = 0, done = false;
    max = max || MAX_BODY;
    req.on('data', function (d) {
      size += d.length;
      if (size > max && !done) { done = true; cb(new Error('too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', function () { if (!done) { done = true; cb(null, Buffer.concat(chunks)); } });
    req.on('error', function (e) { if (!done) { done = true; cb(e); } });
  }
  function parse(buf) { try { var j = JSON.parse(buf.toString('utf8') || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return null; } }
  // Too many requests from one address in a minute (pairing guesses, or a phone gone wrong).
  function limited(who, n) {
    var t = Date.now(), f = fails[who];
    if (!f && Object.keys(fails).length > 500) for (var k in fails) if (t - fails[k].t > 60000) delete fails[k];
    if (!f || t - f.t > 60000) f = fails[who] = { t: t, n: 0 };
    f.n++;
    return f.n > n;
  }

  function hello() {
    return { app: 'TiviBro', api: API, id: st.id, name: tvName(), version: version(), pairing: !!(pairing && !pairing.paired && pairing.until > Date.now()), now: Date.now() };
  }

  function pair(req, res, buf, who) {
    if (limited(who, 20)) return send(res, 429, { error: 'Too many tries.  Wait a minute.', code: 'busy' });
    var j = parse(buf);
    if (!j || typeof j.nonce !== 'string' || !/^[A-Za-z0-9+/=_-]{16,64}$/.test(j.nonce) || typeof j.proof !== 'string' || !j.phone || typeof j.phone !== 'object') return send(res, 400, { error: 'bad request', code: 'bad' });
    var pr = pairing;
    if (!pr || pr.paired || pr.until <= Date.now()) return send(res, 403, { error: 'Pairing is not open on this TV.  In TiviBro on the TV: Settings, Phone app, Pair a phone.', code: 'closed' });
    var name = cleanText(j.phone.name, 40) || 'Phone', model = cleanText(j.phone.model, 40), platform = cleanText(j.phone.platform, 20) || 'android';
    pairKey(pr.code, st.id, function (err, kp) {
      if (err) return send(res, 500, { error: 'server error', code: 'error' });
      if (pairing !== pr || pr.paired) return send(res, 403, { error: 'Pairing is not open on this TV.', code: 'closed' });
      var want = hmac(kp, 'tivibro-pair-v1\n' + st.id + '\n' + j.nonce + '\n' + name);
      if (!same(want, String(j.proof).toLowerCase())) {
        pr.tries++;
        log({ lv: 'warn', event: 'companion: wrong pairing code', from: who, tries: pr.tries });
        if (pr.tries >= PAIR_TRIES) { pairing = null; changed(); return send(res, 403, { error: 'Too many wrong codes.  Start pairing again on the TV.', code: 'closed' }); }
        changed();
        return send(res, 401, { error: 'That code is not right.  Check it on the TV.', code: 'wrong', left: PAIR_TRIES - pr.tries });
      }
      if (st.phones.length >= MAX_PHONES) return send(res, 409, { error: 'This TV already has ' + MAX_PHONES + ' phones.  Remove one in TiviBro on the TV first.', code: 'full' });
      var key = crypto.randomBytes(32), id = hex(crypto.randomBytes(6)), iv = crypto.randomBytes(12);
      var c = crypto.createCipheriv('aes-256-gcm', kp, iv);
      c.setAAD(Buffer.from('tivibro-key-v1\n' + id, 'utf8'));
      var data = Buffer.concat([c.update(key), c.final()]);
      var phone = { id: id, name: name, model: model, platform: platform, key: key.toString('base64'), added: Date.now(), seen: Date.now(), ip: who };
      st.phones.push(phone);
      if (!save()) { st.phones.pop(); return send(res, 500, { error: 'The TV could not store the pairing.', code: 'error' }); }
      pr.paired = { id: id, name: name, at: Date.now() };
      log({ lv: 'info', event: 'companion: phone paired', phone: name, from: who });
      changed();
      send(res, 200, {
        ok: true, tv: { id: st.id, name: tvName(), api: API, version: version() }, phone: id,
        key: { iv: iv.toString('base64'), data: data.toString('base64'), tag: c.getAuthTag().toString('base64') },
        proof: hmac(kp, 'tivibro-paired-v1\n' + id + '\n' + j.nonce)
      });
    });
  }

  // A signed request: X-TiviBro-Phone, -Time, -Nonce and -Sig.  Calls back with the phone and its key, or answers.
  function verify(req, res, buf, u, who, cb) {
    var h = req.headers, id = String(h['x-tivibro-phone'] || ''), t = +h['x-tivibro-time'], nonce = String(h['x-tivibro-nonce'] || ''), sig = String(h['x-tivibro-sig'] || '').toLowerCase();
    var p = null;
    for (var i = 0; i < st.phones.length; i++) if (st.phones[i].id === id) p = st.phones[i];
    if (!p) { if (limited(who, 60)) return send(res, 429, { error: 'busy', code: 'busy' }); return send(res, 401, { error: 'This TV doesn\'t know this phone (it may have been removed).  Pair again.', code: 'unpaired' }); }
    if (!/^[A-Za-z0-9+/=_-]{16,64}$/.test(nonce) || !t) return send(res, 400, { error: 'bad request', code: 'bad' });
    var key = Buffer.from(p.key, 'base64');
    var want = hmac(key, 'tivibro-req-v1\n' + req.method + '\n' + u + '\n' + t + '\n' + nonce + '\n' + sha256(buf));
    if (!same(want, sig)) { log({ lv: 'warn', event: 'companion: bad signature', phone: p.name, from: who }); return send(res, 401, { error: 'bad signature', code: 'signature' }); }
    var now = Date.now();
    if (Math.abs(now - t) > SKEW_MS) return send(res, 401, { error: 'clock', code: 'clock', now: now }, key, nonce);
    if (nonces[nonce]) return send(res, 401, { error: 'replayed', code: 'replay' }, key, nonce);
    nonces[nonce] = now;
    for (var n in nonces) if (now - nonces[n] > 2 * SKEW_MS) delete nonces[n];
    if (now - (p.seen || 0) > 60000 || p.ip !== who) { p.seen = now; p.ip = who; save(); changed(); } else p.seen = now;
    cb(p, key, nonce);
  }

  function info(p) {
    var a = ips(), app = opts.app ? opts.app() : {}, ed = opts.editor && opts.editor();
    return {
      ok: true, app: 'TiviBro', api: API, id: st.id, name: tvName(), version: version(),
      model: sys && sys.model || '', webos: sys && sys.webos || '',
      mac: a.length ? a[0].mac : '', macs: a.map(function (x) { return x.mac; }).filter(Boolean),
      ips: a.map(function (x) { return x.ip; }), port: port,
      tivibro: { open: !!app.open, visible: !!app.visible, editor: !!(ed && ed.status().running) },
      phone: phoneView(p), now: Date.now()
    };
  }

  function openApp(params, cb) {
    if (!opts.launch) return cb(new Error('TiviBro can\'t be opened from here.'));
    opts.launch(params || {}, cb);
  }

  // The web editor for this phone, signed in.  Starts TiviBro (which starts the editor) if needed.
  function editor(req, p, cb) {
    var ed = opts.editor && opts.editor(), s = ed && ed.status();
    if (s && s.running) {
      var host = String(req.headers.host || '').replace(/:\d+$/, '') || (addresses()[0] || '');
      if (!/^[0-9a-zA-Z.\-]+$/.test(host)) host = addresses()[0] || '';
      return cb(null, { ok: true, state: 'ready', url: 'http://' + host + ':' + s.port + '/#t=' + ed.grant('phone ' + p.name) });
    }
    wantEditor = Date.now();
    changed();
    var app = opts.app ? opts.app() : {};
    if (app.open) return cb(null, { ok: true, state: 'starting', message: 'Starting the editor on the TV…' });
    openApp({ companion: { editor: true } }, function (e) {
      if (e) return cb(null, { ok: false, state: 'off', error: 'Could not open TiviBro on the TV: ' + e.message });
      cb(null, { ok: true, state: 'starting', message: 'Opening TiviBro on the TV…' });
    });
  }


  /* ---------- remote and Play on TV ---------- */
  var KEYS = ['ok', 'hold', 'up', 'down', 'left', 'right', 'back', 'chup', 'chdown', 'playpause', 'stop', 'rew', 'ff', 'info', 'red', 'green', 'yellow', 'blue',
    'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9'];
  var ACTIONS = ['guide', 'search', 'settings', 'live', 'movies', 'shows', 'last', 'fav', 'favorites', 'recents', 'audio', 'picture', 'exit', 'restart', 'reconnect', 'list', 'panel', 'osd', 'menu'];
  var CMD_TTL = 40000, HOLD = 20000;

  function appOpen() { var a = opts.app ? opts.app() : {}; return !!a.open; }
  function flushApp() {
    var w = appWait; appWait = [];
    w.forEach(function (x) { clearTimeout(x.timer); x.go(); });
  }
  function flushPhones() {
    var w = phoneWait; phoneWait = [];
    w.forEach(function (x) { clearTimeout(x.timer); x.go(); });
  }
  // A command for TiviBro.  If TiviBro is closed, it is opened first and finds the command waiting.
  function queue(cmd, from) {
    var t = Date.now();
    cmds = cmds.filter(function (c) { return t - c.at < CMD_TTL; });
    cmdSeq++;
    cmd.id = cmdSeq; cmd.at = t; cmd.from = from;
    cmds.push(cmd);
    if (cmds.length > 50) cmds.splice(0, cmds.length - 50);
    flushApp();
    if (!appOpen() && t - launchedAt > 15000) {
      launchedAt = t;
      openApp({ companion: { open: true } }, function (e) { if (e) log({ lv: 'warn', event: 'companion: could not open TiviBro', e: e.message }); });
      return 'opening';
    }
    return appOpen() ? 'sent' : 'opening';
  }
  function stateView() {
    return { ok: true, rev: tvState.rev, open: appOpen(), state: tvState.data, lineupRev: lineup ? lineup.rev : 0, now: Date.now() };
  }
  function phoneState(res, u, reply) {
    var since = +((/[?&]since=(\d+)/.exec(u) || [])[1] || 0), waitOk = /[?&]wait=1/.test(u);
    if (!waitOk || since !== tvState.rev) return reply(200, stateView());
    var x = { go: function () { reply(200, stateView()); } };
    x.timer = setTimeout(function () { phoneWait = phoneWait.filter(function (y) { return y !== x; }); x.go(); }, HOLD);
    phoneWait.push(x);
    res.on('close', function () { clearTimeout(x.timer); phoneWait = phoneWait.filter(function (y) { return y !== x; }); });
  }
  function phoneLineup(u, reply) {
    var have = +((/[?&]rev=(\d+)/.exec(u) || [])[1] || 0), fresh = lineup && Date.now() - lineup.at < 120000;
    if (!fresh && appOpen()) { wantLineup = true; flushApp(); }
    if (!lineup) return reply(200, { ok: true, pending: appOpen(), closed: !appOpen() });
    if (lineup.rev === have) return reply(200, { ok: true, rev: lineup.rev, same: true, pending: !fresh && appOpen() });
    reply(200, { ok: true, rev: lineup.rev, at: lineup.at, groups: lineup.data.groups || [], channels: lineup.data.channels || [], pending: !fresh && appOpen() });
  }
  function phoneCommand(path, buf, p, reply) {
    var j = parse(buf) || {}, cmd = null;
    if (path === '/v1/key') { if (KEYS.indexOf(j.key) < 0) return reply(400, { error: 'unknown key', code: 'bad' }); cmd = { type: 'key', key: j.key }; }
    else if (path === '/v1/action') { if (ACTIONS.indexOf(j.action) < 0) return reply(400, { error: 'unknown action', code: 'bad' }); cmd = { type: 'action', action: j.action }; }
    else if (path === '/v1/play') { if (typeof j.k !== 'string' || !j.k || j.k.length > 300) return reply(400, { error: 'bad channel', code: 'bad' }); cmd = { type: 'play', k: j.k }; }
    else if (path === '/v1/text') { if (typeof j.text !== 'string') return reply(400, { error: 'bad text', code: 'bad' }); cmd = { type: 'text', text: cleanText(j.text, 100) }; }
    var how = queue(cmd, p.name);
    reply(200, { ok: true, id: cmd.id, state: how });
  }
  function volume(dir, reply) {
    if (['up', 'down', 'mute'].indexOf(dir) < 0) return reply(400, { error: 'bad volume', code: 'bad' });
    if (!opts.volume) return reply(501, { error: 'The TV\'s volume can\'t be changed from here.', code: 'volume' });
    opts.volume(dir, function (e, v) {
      if (e) return reply(502, { error: 'The TV refused: ' + e.message, code: 'volume' });
      reply(200, { ok: true, volume: v || null });
    });
  }

  function lan(req, res) {
    var u = req.url.split('#')[0], pathOnly = u.split('?')[0], who = String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (pathOnly === '/v1/hello' && req.method === 'GET') return send(res, 200, hello());
    if (pathOnly === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('TiviBro on this TV.  Use the TiviBro phone app to connect.\n'); }
    readBody(req, function (err, buf) {
      if (err) return send(res, 413, { error: 'too large', code: 'bad' });
      if (pathOnly === '/v1/pair' && req.method === 'POST') return pair(req, res, buf, who);
      verify(req, res, buf, u, who, function (p, key, nonce) {
        var reply = function (code, obj) { send(res, code, obj, key, nonce); };
        if (pathOnly === '/v1/info' && req.method === 'GET') return reply(200, info(p));
        if (pathOnly === '/v1/open' && req.method === 'POST') {
          return openApp({ companion: { open: true } }, function (e) { if (e) return reply(502, { error: 'Could not open TiviBro on the TV: ' + e.message, code: 'launch' }); reply(200, { ok: true }); });
        }
        if (pathOnly === '/v1/editor' && req.method === 'POST') return editor(req, p, function (e, r) { reply(r.ok ? 200 : 502, r); });
        if (pathOnly === '/v1/state' && req.method === 'GET') return phoneState(res, u, reply);
        if (pathOnly === '/v1/lineup' && req.method === 'GET') return phoneLineup(u, reply);
        if (/^\/v1\/(key|action|play|text)$/.test(pathOnly) && req.method === 'POST') return phoneCommand(pathOnly, buf, p, reply);
        if (pathOnly === '/v1/volume' && req.method === 'POST') return volume((parse(buf) || {}).dir, reply);
        if (pathOnly === '/v1/forget' && req.method === 'POST') {
          st.phones = st.phones.filter(function (x) { return x.id !== p.id; }); save(); changed();
          log({ lv: 'info', event: 'companion: phone removed itself', phone: p.name });
          return reply(200, { ok: true });
        }
        reply(404, { error: 'not found', code: 'missing' });
      });
    });
  }

  /* ---------- discovery (UDP) ---------- */
  function onDiscover(msg, rinfo) {
    if (String(msg).slice(0, DISCOVER.length) !== DISCOVER || !server) return;
    var t = Date.now();
    if (t - udpCount.t > 1000) udpCount = { t: t, n: 0 };
    if (++udpCount.n > 20) return;
    var out = Buffer.from(JSON.stringify({ app: 'TiviBro', api: API, id: st.id, name: tvName(), port: port, version: version() }), 'utf8');
    try { udp.send(out, 0, out.length, rinfo.port, rinfo.address); } catch (e) {}
  }

  /* ---------- start and stop ---------- */
  function listen(i, cb) {
    if (i >= PORTS.length) return cb(new Error('No free port for the phone app (tried ' + PORTS.join(', ') + ').'));
    var srv = http.createServer(function (req, res) {
      try { lan(req, res); } catch (e) { log({ lv: 'error', event: 'companion request failed', e: e.message }); try { send(res, 500, { error: 'server error', code: 'error' }); } catch (x) {} }
    });
    srv.timeout = 30000;
    srv.once('error', function (e) { log({ lv: 'warn', event: 'companion listen failed', port: PORTS[i], e: e.code || e.message }); listen(i + 1, cb); });
    srv.listen(PORTS[i], '0.0.0.0', function () { server = srv; port = PORTS[i]; cb(null); });
  }
  function startUdp() {
    try {
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('error', function (e) { log({ lv: 'warn', event: 'companion discovery off', e: e.code || e.message }); try { udp.close(); } catch (x) {} udp = null; });
      udp.on('message', onDiscover);
      udp.bind(PORT, function () { try { udp.setBroadcast(true); } catch (e) {} });
    } catch (e) { log({ lv: 'warn', event: 'companion discovery off', e: e.message }); udp = null; }
  }
  function start(cb) {
    cb = cb || function () {};
    if (!st.on) return cb(null, status());
    if (server) return cb(null, status());
    if (opts.sysinfo && !sys) opts.sysinfo(function (s) { sys = s || {}; });
    listen(0, function (e) {
      if (e) { log({ lv: 'error', event: 'companion could not start', e: e.message }); return cb(e); }
      startUdp();
      log({ lv: 'info', event: 'companion listening', port: port, ips: addresses() });
      cb(null, status());
    });
  }
  function stop() {
    if (server) { try { server.close(); } catch (e) {} log({ lv: 'info', event: 'companion stopped' }); }
    if (udp) { try { udp.close(); } catch (e) {} }
    server = null; udp = null; port = 0; pairing = null; nonces = {};
  }

  /* ---------- control from TiviBro (localhost relay only) ---------- */
  function control(req, res, u) {
    var reply = function (code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    var done = function (e) { if (e) return reply(409, { error: e.message }); reply(200, status()); };
    if (u === '/companion/status') return reply(200, status());
    // TiviBro waits here for commands from phones (and for a phone wanting the channel list).
    if (u === '/companion/next') {
      var since = +((/[?&]since=(\d+)/.exec(req.url) || [])[1] || 0);
      var answer = function () {
        var t = Date.now(), list = cmds.filter(function (c) { return c.id > since && t - c.at < CMD_TTL; });
        cmds = cmds.filter(function (c) { return list.indexOf(c) < 0; });      // each command is carried out once
        reply(200, { cmds: list, seq: cmdSeq, wantLineup: wantLineup, on: st.on });
      };
      if (cmds.length || wantLineup || !st.on || since > cmdSeq) return answer();
      // One TiviBro waits at a time: an older poll (from before a reload) is answered empty, so a
      // command can never go to a page that is gone.
      var old = appWait; appWait = [];
      old.forEach(function (y) { clearTimeout(y.timer); y.empty(); });
      var x = { go: answer, empty: function () { reply(200, { cmds: [], seq: cmdSeq, wantLineup: false, on: st.on }); } };
      x.timer = setTimeout(function () { appWait = appWait.filter(function (y) { return y !== x; }); answer(); }, HOLD);
      appWait.push(x);
      res.on('close', function () { clearTimeout(x.timer); appWait = appWait.filter(function (y) { return y !== x; }); });
      return;
    }
    readBody(req, function (err, buf) {
      var j = !err && parse(buf);
      if (!j) return reply(400, { error: 'bad request' });
      if (u === '/companion/set' && req.method === 'POST') {
        if (typeof j.name === 'string') st.name = cleanText(j.name, 40);
        if (typeof j.version === 'string') st.version = cleanText(j.version, 40);
        if (typeof j.on === 'boolean' && j.on !== st.on) {
          st.on = j.on;
          log({ lv: 'info', event: 'companion turned ' + (j.on ? 'on' : 'off') });
          if (!j.on) stop();
        }
        save();
        if (opts.onSwitch) try { opts.onSwitch(st.on); } catch (e) {}
        return st.on ? start(done) : done();
      }
      if (u === '/companion/pair' && req.method === 'POST') {
        if (j.open === false) { pairing = null; return done(); }
        if (!st.on) return reply(409, { error: 'Turn on the phone app connection first.' });
        return start(function (e) {
          if (e) return done(e);
          pairing = { code: randomCode(), at: Date.now(), until: Date.now() + PAIR_MS, tries: 0, paired: null };
          log({ lv: 'info', event: 'companion pairing open' });
          done();
        });
      }
      if (u === '/companion/forget' && req.method === 'POST') {
        var before = st.phones.length;
        st.phones = st.phones.filter(function (x) { return x.id !== j.id; });
        if (st.phones.length !== before) { save(); log({ lv: 'info', event: 'companion: phone removed on the TV' }); }
        return done();
      }
      if (u === '/companion/editor-done' && req.method === 'POST') { wantEditor = 0; return done(); }
      if (u === '/companion/state' && req.method === 'POST') {
        var was = JSON.stringify(tvState.data), now = JSON.stringify(j.state || null);
        if (was !== now) { tvState = { rev: tvState.rev + 1, data: j.state || null, at: Date.now() }; flushPhones(); }
        return reply(200, { ok: true, rev: tvState.rev });
      }
      if (u === '/companion/lineup' && req.method === 'POST') {
        lineupRev++;
        lineup = { rev: lineupRev, at: Date.now(), data: { groups: Array.isArray(j.groups) ? j.groups : [], channels: Array.isArray(j.channels) ? j.channels : [] } };
        wantLineup = false;
        return reply(200, { ok: true, rev: lineupRev });
      }
      reply(404, { error: 'not found' });
    }, 16 * 1024 * 1024);      // the channel list can be large
  }

  return {
    control: control, start: start, stop: stop, status: status,
    closePairing: function () { pairing = null; },
    // TiviBro closed: phones see it at once; its long polls are over.
    appGone: function () { tvState = { rev: tvState.rev + 1, data: null, at: Date.now() }; flushPhones(); appWait.forEach(function (x) { clearTimeout(x.timer); }); appWait = []; },
    get on() { return st.on; }, get running() { return !!server; }, get port() { return port; }, get id() { return st.id; }
  };
}

module.exports = { create: create, API: API, PORT: PORT, DISCOVER: DISCOVER, KDF_ITER: KDF_ITER, normCode: normCode, pairKey: pairKey, hmac: hmac, sha256: sha256 };
