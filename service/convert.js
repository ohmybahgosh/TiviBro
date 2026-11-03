/* Converting sound the TV can't play (DTS on 2020 to 2022 LG TVs, Dolby TrueHD, surround FLAC) to
   Dolby Digital (AC-3), with the bundled ffmpeg (ffmpeg.js).  Video is copied, never decoded.

   Routes (proxy.js):
     GET  /convert/key                 (TiviBro's secret) { key }: the key the app puts in conversion links
     GET  /convert/probe?u=<url>[&ua=] (TiviBro's secret) what the file holds: audio tracks (codec,
                                       channels, language, default), video codec, duration.  Kept per url.
     GET  /convert/<key>/movie.mkv?u=<url>&t=<seconds>&a=<audio track>[&ua=<agent>][&in=pipe]
     GET  /convert/<key>/movie.ts?...  the converted stream, for the TV's own player (MKV) or the
                                       built-in player (MPEG-TS, live channels).  No Content-Length, not
                                       byte-seekable: a seek is a new request with another t.
   The <video> element can't send TiviBro's secret, so conversion links carry a key instead: random per
   helper start and handed only to TiviBro (over the secret-protected /convert/key).  Other apps on the
   TV or the network can't use the converter without it.

   How ffmpeg reads the movie: through the helper's own relay (http://127.0.0.1:<port>/ua/.../x/...), so
   the playlist's User-Agent, redirects, odd provider replies and certificates are handled exactly as for
   every other stream, and ffmpeg itself only ever talks plain http to this TV.  Range requests pass
   through, so a seek doesn't download the movie up to that point.  &in=pipe instead has the helper
   fetch the movie itself and feed it to ffmpeg's stdin (no seeking in the source: kept for servers that
   refuse Range).  A movie link that is already the helper's (My media) is read as it is.

   One conversion at a time: a new one stops the last (TERM, then KILL after 2 s), and so does the
   player hanging up.  ffmpeg runs under "nice -n 10" when the TV has nice, so the TV stays responsive.
   The output is piped with backpressure (when the player reads slowly, ffmpeg waits), never buffered.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var cp = require('child_process'), fs = require('fs'), crypto = require('crypto'), http = require('http'), https = require('https'), URL_ = require('url');
var Ffmpeg = require('./ffmpeg');

var KEY = crypto.randomBytes(16).toString('hex');
var PLAYABLE = { ac3: 1, eac3: 1, aac: 1, mp3: 1, mp2: 1 };   // copied as they are, never re-encoded

/* ---------- reading ffmpeg's description of a file ----------
   "ffmpeg -hide_banner -i <url>" exits with an error (no output given) after printing the streams:
     Duration: 01:52:03.20, start: 0.000000, bitrate: 21000 kb/s
     Stream #0:1(eng): Audio: dts (DTS-HD MA), 48000 Hz, 7.1, s32p (24 bit) (default)
       Metadata:
         title           : English DTS-HD MA 7.1
   Newer ffmpeg puts the container id in brackets: Stream #0:1[0x2](eng): Audio: truehd (mlpa / ...) */
var LAYOUTS = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, '3.0(back)': 3, '4.0': 4, quad: 4, 'quad(side)': 4, '3.1': 4, '4.1': 5, '5.0': 5, '5.0(side)': 5,
  '5.1': 6, '5.1(side)': 6, '6.0': 6, '6.0(front)': 6, hexagonal: 6, '6.1': 7, '6.1(back)': 7, '6.1(front)': 7, '7.0': 7, '7.0(front)': 7, '7.1': 8, '7.1(wide)': 8, '7.1(wide-side)': 8, '7.1(top)': 8, octagonal: 8 };
function channelsOf(rest) {
  var parts = rest.split(',').map(function (x) { return x.trim(); });
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (LAYOUTS[p]) return LAYOUTS[p];
    var n = /^(\d+) channels?/.exec(p); if (n) return +n[1];
    var l = /^(\d+\.\d)(\(|$)/.exec(p); if (l && LAYOUTS[l[1]]) return LAYOUTS[l[1]];
  }
  return 0;
}
function seconds(hms) { var m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(hms || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; }
function parseProbe(text) {
  var out = { format: '', duration: 0, video: '', audio: [], subs: 0 };
  var lines = String(text || '').split(/\r?\n/), last = null, input = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var inp = /^Input #0, ([^,]+(?:,[^,\s]+)*), from/.exec(line);
    if (inp) { out.format = inp[1]; input = true; continue; }
    if (/^(Output|Input #[1-9])/.test(line)) input = false;
    if (!input) continue;
    var d = /^\s+Duration: (\d+:\d+:\d+(?:\.\d+)?|N\/A)/.exec(line);
    if (d) { out.duration = d[1] === 'N/A' ? 0 : seconds(d[1]); continue; }
    var s = /^\s+Stream #0:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\(([A-Za-z]{2,3})\))?[^:]*: (Video|Audio|Subtitle|Data|Attachment): ([A-Za-z0-9_]+)(.*)$/.exec(line);
    if (s) {
      last = null;
      if (s[3] === 'Video' && !out.video && !/attached pic/.test(s[5])) out.video = s[4].toLowerCase();
      else if (s[3] === 'Audio') {
        var rest = s[5], prof = /^\s*\(([^)]*)\)/.exec(rest);
        last = { index: out.audio.length, stream: +s[1], codec: s[4].toLowerCase(), profile: prof && !/\//.test(prof[1]) ? prof[1] : '', channels: channelsOf(rest),
          lang: s[2] && s[2] !== 'und' ? s[2].toLowerCase() : '', def: /\(default\)/.test(rest), title: '' };
        out.audio.push(last);
      } else if (s[3] === 'Subtitle') out.subs++;
      continue;
    }
    var t = /^\s+title\s*: (.*)$/.exec(line);
    if (t && last && !last.title) last.title = t[1].trim().slice(0, 80);
  }
  // A file with no track marked default plays its first.
  if (out.audio.length && !out.audio.some(function (x) { return x.def; })) out.audio[0].def = true;
  return out;
}

/* ---------- the arguments ---------- */
/* What the chosen track becomes: copied when the TV plays it already, otherwise AC-3.  ffmpeg's E-AC-3
   encoder can't make 7.1 (it quietly drops channels), so 7.1 is mixed down to 5.1 AC-3. */
function audioArgs(track) {
  var codec = track && track.codec || '';
  if (PLAYABLE[codec]) return { args: ['-c:a', 'copy'], out: codec + ' (copied)' };
  var ch = track && track.channels || 6;
  if (ch > 6) return { args: ['-c:a', 'ac3', '-b:a', '640k', '-ac', '6'], out: 'ac3 640k 5.1 (mixed down from ' + ch + ' channels)' };
  if (ch <= 2) return { args: ['-c:a', 'ac3', '-b:a', '224k'], out: 'ac3 224k ' + (ch === 1 ? 'mono' : 'stereo') };
  return { args: ['-c:a', 'ac3', '-b:a', '640k'], out: 'ac3 640k ' + ch + ' channels' };
}
// o: { input, pipe, t, a, fmt, track }
function args(o) {
  var a = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', '-stats_period', '5'];
  var t = o.t > 0 ? String(Math.round(o.t * 1000) / 1000) : '';
  if (!o.pipe) a.push('-protocol_whitelist', 'http,tcp');
  if (t && !o.pipe) a.push('-ss', t);                 // before -i: ffmpeg asks the server for that part (Range)
  a.push('-i', o.pipe ? 'pipe:0' : o.input);
  if (t && o.pipe) a.push('-ss', t);                  // from a pipe: read and drop up to t
  // Movies keep their own times (a seek to 1:00:00 starts the stream at 1:00:00, see app/js/player.js).
  // Live channels start at zero.
  if (o.fmt !== 'ts') a.push('-copyts', '-start_at_zero');
  a.push('-map', '0:v:0?', '-map', '0:a:' + (o.a | 0), '-c:v', 'copy');
  a = a.concat(audioArgs(o.track).args);
  a.push('-sn', '-dn', '-max_muxing_queue_size', '1024');
  if (o.fmt === 'ts') a.push('-f', 'mpegts', 'pipe:1');
  else a.push('-f', 'matroska', '-live', '1', 'pipe:1');
  return a;
}

/* ---------- running ffmpeg ---------- */
var NICE = null;
function nice() {
  if (NICE !== null) return NICE;
  NICE = '';
  ['/usr/bin/nice', '/bin/nice'].forEach(function (p) { if (!NICE) { try { fs.accessSync(p, fs.X_OK || 1); NICE = p; } catch (e) {} } });
  return NICE;
}
function spawn(bin, list) {
  var n = nice();
  return n ? cp.spawn(n, ['-n', '10', bin].concat(list), { stdio: ['pipe', 'pipe', 'pipe'] }) : cp.spawn(bin, list, { stdio: ['pipe', 'pipe', 'pipe'] });
}
function stopProc(p) {
  if (!p || p.exitCode !== null && p.exitCode !== undefined || p._tbKilled) return;
  p._tbKilled = true;
  try { p.kill('SIGTERM'); } catch (e) {}
  var k = setTimeout(function () { try { p.kill('SIGKILL'); } catch (e) {} }, 2000);
  p.on('exit', function () { clearTimeout(k); });
}

/* ---------- probing ---------- */
var probes = {}, probeOrder = [];
function remember(k, v) {
  if (!probes[k]) probeOrder.push(k);
  probes[k] = v;
  while (probeOrder.length > 50) delete probes[probeOrder.shift()];
}
function probe(input, key, cb) {
  if (probes[key]) return cb(null, probes[key], true);
  var bin = Ffmpeg.binary();
  if (!bin) return cb(new Error('no converter'));
  var p, err = '', done = false;
  try { p = cp.spawn(bin, ['-hide_banner', '-nostdin', '-protocol_whitelist', 'http,tcp', '-probesize', '5000000', '-analyzeduration', '5000000', '-i', input], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { return cb(e); }
  var timer = setTimeout(function () { stopProc(p); }, 20000);
  p.stderr.on('data', function (d) { if (err.length < 200000) err += d; });
  p.on('error', function (e) { if (!done) { done = true; clearTimeout(timer); cb(e); } });
  p.on('close', function () {
    if (done) return; done = true; clearTimeout(timer);
    var r = parseProbe(err);
    if (!r.audio.length && !r.video) {
      var why = (err.split('\n').filter(function (l) { return /error|failed|refused|not found|denied|Invalid/i.test(l); }).pop() || 'nothing readable').trim().slice(0, 200);
      return cb(new Error('could not read the file: ' + why));
    }
    remember(key, r);
    cb(null, r, false);
  });
}

/* ---------- where ffmpeg reads from ---------- */
function b64url(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function inputFor(u, ua, port) {
  if (!/^https?:\/\/[^\s]+$/i.test(u || '')) return null;
  var p = URL_.parse(u);
  if (!p.host) return null;
  if ((p.hostname === '127.0.0.1' || p.hostname === 'localhost') && +(p.port || 80) === +port) return u;   // already the helper's
  return 'http://127.0.0.1:' + port + (ua ? '/ua/' + b64url(ua) : '') + '/x/' + p.protocol.replace(':', '') + '/' + p.host + (p.path || '/');
}
function query(url) {
  var q = {}, s = url.split('?')[1] || '';
  s.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i); try { q[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' ')); } catch (e) {} });
  return q;
}
function sameText(a, b) {
  var x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// &in=pipe: the helper reads the movie itself and hands it to ffmpeg.
function feed(u, ua, stdin, onErr, left) {
  var p = URL_.parse(u), lib = p.protocol === 'https:' ? https : http;
  var req = lib.request({ hostname: p.hostname, port: p.port, path: p.path, method: 'GET', rejectUnauthorized: false, agent: false,
    headers: { 'User-Agent': ua || 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0 Safari/537.36', Accept: '*/*' } }, function (r) {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && left > 0) { r.resume(); req2 = feed(URL_.resolve(u, r.headers.location), ua, stdin, onErr, left - 1); return; }
    if (r.statusCode >= 400) { r.resume(); return onErr(new Error('the provider answered ' + r.statusCode)); }
    r.on('error', onErr);
    r.pipe(stdin);
  });
  var req2 = null;
  req.on('error', onErr);
  req.end();
  return { abort: function () { try { req.abort(); } catch (e) {} if (req2) req2.abort(); } };
}

/* ---------- the routes ---------- */
var current = null, stats = { started: 0, failed: 0 };
function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var x in ALLOW) h[x] = ALLOW[x];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
// Behind TiviBro's secret (proxy.js checks it): the key, and probes.
function control(req, res, ALLOW, log, port, redact) {
  var route = req.url.split('?')[0], q = query(req.url);
  if (route === '/convert/key') return send(res, ALLOW, 200, { key: KEY });
  if (route === '/convert/probe') {
    var input = inputFor(q.u, q.ua, port);
    if (!input) return send(res, ALLOW, 400, { error: 'not a web address' });
    var t0 = Date.now();
    return probe(input, q.u + '|' + (q.ua || ''), function (e, r, cached) {
      if (e) { log({ lv: 'warn', event: 'convert probe failed', u: redact(q.u), e: e.message }); return send(res, ALLOW, e.message === 'no converter' ? 409 : 502, { error: e.message }); }
      if (!cached) log({ lv: 'info', event: 'convert probe', u: redact(q.u), ms: Date.now() - t0, video: r.video, audio: r.audio.map(function (x) { return x.codec + ' ' + x.channels + 'ch' + (x.lang ? ' ' + x.lang : ''); }).join(', ') });
      send(res, ALLOW, 200, r);
    });
  }
  send(res, ALLOW, 404, { error: 'unknown convert route' });
}

function isStream(url) { return /^\/convert\/[a-f0-9]{32}\/movie\.(mkv|ts)(\?|$)/.test(url); }
function stream(req, res, ALLOW, log, port, redact) {
  var m = /^\/convert\/([a-f0-9]{32})\/movie\.(mkv|ts)/.exec(req.url);
  if (!m || !sameText(m[1], KEY)) { res.writeHead(403, ALLOW); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, ALLOW); return res.end(); }
  var fmt = m[2], q = query(req.url), t = Math.max(0, +q.t || 0), a = Math.max(0, Math.min(63, +q.a | 0)), pipe = q['in'] === 'pipe';
  if (!/^https?:\/\//i.test(q.u || '')) { res.writeHead(400, ALLOW); return res.end('not a web address'); }
  // Not byte-seekable: a player asking for a later byte gets told so, and the running conversion stays.
  var rg = /bytes=(\d+)-/.exec(req.headers.range || '');
  if (rg && +rg[1] > 0) { res.writeHead(416, Object.assign({ 'Content-Range': 'bytes */*' }, ALLOW)); return res.end(); }
  var h = Object.assign({ 'Content-Type': fmt === 'ts' ? 'video/mp2t' : 'video/x-matroska', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' }, ALLOW);
  if (req.method === 'HEAD') { res.writeHead(200, h); return res.end(); }
  var bin = Ffmpeg.binary();
  if (!bin) { res.writeHead(409, ALLOW); return res.end('no converter'); }
  var input = pipe ? 'pipe:0' : inputFor(q.u, q.ua, port);
  if (!input) { res.writeHead(400, ALLOW); return res.end('not a web address'); }

  // One at a time: this one replaces whatever was converting.
  if (current) current.stop('replaced by a new conversion');
  // What the track is: from the probe, else as the app says (&c=dts&ch=6), else taken as 5.1 to convert.
  var info = probes[q.u + '|' + (q.ua || '')], track = info && info.audio[a];
  if (!track && /^[a-z0-9_]{1,20}$/i.test(q.c || '')) track = { codec: q.c.toLowerCase(), channels: Math.max(0, Math.min(16, +q.ch | 0)) };
  var list = args({ input: input, pipe: pipe, t: t, a: a, fmt: fmt, track: track });
  var p;
  try { p = spawn(bin, list); } catch (e) { res.writeHead(500, ALLOW); return res.end('could not start the converter'); }
  stats.started++;
  var me = { p: p, at: Date.now(), bytes: 0, speed: '', stopped: '', feeder: null };
  current = me;
  me.stop = function (why) {
    if (!me.stopped) me.stopped = why;
    if (me.feeder) me.feeder.abort();
    stopProc(p);
    if (current === me) current = null;
    try { res.end(); } catch (e) {}
  };
  var choice = audioArgs(track);
  log({ lv: 'info', event: 'convert start', u: redact(q.u), from_s: t, a: a, fmt: fmt, from: track ? track.codec + ' ' + track.channels + 'ch' : 'not probed', to: choice.out, nice: !!nice(), pipe: pipe, pid: p.pid });
  var errTail = '', lastLog = Date.now();
  p.stderr.on('data', function (d) {
    var s = String(d), sp = /speed=\s*([\d.]+)x/.exec(s.split(/\r|\n/).filter(function (l) { return /speed=/.test(l); }).pop() || '');
    if (sp) {
      me.speed = sp[1];
      if (Date.now() - lastLog > 30000) { lastLog = Date.now(); log({ lv: 'info', event: 'convert speed', speed: me.speed + 'x', mb: Math.round(me.bytes / 1048576) }); }
    }
    errTail = (errTail + s.replace(/[^\n]*speed=[^\r\n]*[\r\n]?/g, '')).slice(-1500);
  });
  p.on('error', function (e) { me.stopped = me.stopped || 'could not start: ' + (e.code || e.message); try { res.destroy(); } catch (x) {} });
  p.stdin.on('error', function () {});
  if (pipe) me.feeder = feed(q.u, q.ua, p.stdin, function (e) { log({ lv: 'warn', event: 'convert input failed', e: e.message }); stopProc(p); }, 5);
  res.writeHead(200, h);
  p.stdout.on('data', function (d) { me.bytes += d.length; });
  p.stdout.pipe(res);                                 // backpressure: a slow player pauses ffmpeg
  p.on('exit', function (code, sig) {
    if (current === me) current = null;
    if (me.feeder) me.feeder.abort();
    var ok = !me.stopped && code === 0, rec = { lv: ok || me.stopped ? 'info' : 'error', event: ok ? 'convert done' : me.stopped ? 'convert stopped' : 'convert failed',
      why: me.stopped || undefined, code: code, signal: sig || undefined, s: Math.round((Date.now() - me.at) / 1000), mb: Math.round(me.bytes / 1048576 * 10) / 10, speed: me.speed ? me.speed + 'x' : undefined };
    if (!ok && !me.stopped) { stats.failed++; rec.e = errTail.trim().split('\n').slice(-3).join(' | ').slice(0, 500); }
    log(rec);
  });
  // The player hung up (seek, stop, another movie): stop converting at once.
  res.on('close', function () { if (!me.stopped && !res.finished) me.stop('the player closed the connection'); });
  req.on('close', function () { if (!me.stopped && !res.finished) me.stop('the player closed the connection'); });
}

function busy() { return current ? { pid: current.p.pid, since: current.at, speed: current.speed, bytes: current.bytes } : null; }

module.exports = { parseProbe: parseProbe, args: args, audioArgs: audioArgs, inputFor: inputFor, isStream: isStream, stream: stream, control: control,
  busy: busy, stats: stats, get key() { return KEY; }, _forget: function () { probes = {}; probeOrder = []; } };
