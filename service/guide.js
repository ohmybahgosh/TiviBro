/* Big guides, read and kept by the helper instead of the app.
   webOS closes an app that passes roughly 500 MB, and a full XMLTV guide on top of a provider's can
   take more than that while it is parsed (a 64 MB iptv-epg.org file did on a 2 GB C2).  The helper is
   a separate process, so here the guide is streamed, trimmed to the playlist's channels and the
   time window, and written to the TV's storage.  The app then reads back only:
     titles   every programme's start, end and title (small: search, the watchlist and the grid),
     desc     one channel's descriptions when it shows them,
     meta     the guide's channel list, icons, name matches and how each source went.
   The matching is the same as the app's worker (epg.js workerMain): guide ids, names, and for the
   public guide pass (pubepg.js) call signs and names by country.  Keep the two in step.

   Routes (on the relay, 127.0.0.1 only):
     POST /guide/load            { pl, kind: 'main'|'pub', sig, msg }   starts a load (replaces one running)
     GET  /guide/status?pl&kind  progress, or what is stored
     GET  /guide/meta?pl&kind    GET /guide/titles?pl&kind    GET /guide/desc?pl&kind&id
   Downloads go through the relay itself (msg.sources[].url are relay addresses with /unz/<id>), so
   custom User-Agents, unzipping, the DNS cache and the lenient parser all apply.
   Plain ES5 and callbacks for Node 0.12 (webOS 4). */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
var StringDecoder = require('string_decoder').StringDecoder;
var Unzip = require('./unzip');
var PubEpg = (function () {
  try { return require('./editor/pubepg.js'); } catch (e) {}
  try { return require('../app/js/pubepg.js'); } catch (e2) {}            // the dev relay, from the repository
  return null;
})();

var NB = 32;                       // bucket files while parsing (programmes grouped by channel later)
var DESC_MAX = 1000;

// Same as Epg.norm in app/js/epg.js (tests compare them).
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|raw|east|west|backup|us|usa|uk|ca)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}
function ts(s) {
  var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s || '');
  if (!m) return 0;
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { var sign = m[7][0] === '-' ? -1 : 1; t -= sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000; }
  return t;
}
function unesc(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, function (a, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (a, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
}
function flat(s) { return String(s || '').replace(/[\t\r\n]+/g, ' '); }

/* ---------- where the guide lives ---------- */
var ROOT = null;
function mkdir(d) { try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
function root() {
  if (ROOT) return ROOT;
  // The service's own folder is on the TV's storage; /tmp is memory, so it comes last.
  var tries = [process.env.TIVIBRO_GUIDE_DIR, path.join(__dirname, 'guide-data'), '/media/internal/.tivibro-guide', path.join(os.tmpdir(), 'tivibro-guide')];
  for (var i = 0; i < tries.length; i++) {
    var d = tries[i];
    if (!d) continue;
    try { mkdir(d); var t = path.join(d, '.w'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); ROOT = d; return d; } catch (e) {}
  }
  throw new Error('no place to keep the guide');
}
function rmdir(d) {
  try { fs.readdirSync(d).forEach(function (f) { try { fs.unlinkSync(path.join(d, f)); } catch (e) {} }); fs.rmdirSync(d); } catch (e) {}
}
function keyOf(pl, kind) { return String(pl || 'p').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) + '-' + (kind === 'pub' ? 'pub' : 'main'); }
function dirOf(k) { return path.join(root(), k); }
function readMeta(k) { try { return JSON.parse(fs.readFileSync(path.join(dirOf(k), 'meta.json'), 'utf8')); } catch (e) { return null; } }

/* ---------- one load ---------- */
var jobs = {}, descIdx = {};

function start(body, log) {
  var k = keyOf(body.pl, body.kind), old = jobs[k];
  if (old && old.cancel) old.cancel();
  var d = body.msg || {}, pub = !!d.pub;
  var job = jobs[k] = { k: k, sig: body.sig, phase: 'download', src: 1, of: (d.sources || []).length, host: '', bytes: 0, total: 0, est: false, programmes: 0, channels: 0, started: Date.now() };
  var stopped = false, current = null;
  job.cancel = function () { stopped = true; if (current) { try { current.abort(); } catch (e) {} } };

  var tmp = path.join(root(), k + '.tmp');
  rmdir(tmp); mkdir(tmp);
  var buckets = [], waiting = 0, onDrained = null;
  function bucketStream(b) {
    var w = fs.createWriteStream(path.join(tmp, 'b' + b));
    w.full = false;
    w.on('drain', function () { if (!w.full) return; w.full = false; waiting--; if (!waiting && onDrained) { var f = onDrained; onDrained = null; f(); } });
    w.on('error', function (e) { fail(e); });
    return w;
  }
  for (var b = 0; b < NB; b++) buckets.push(bucketStream(b));

  // What to keep (as in the worker).
  var want = {}, names = d.names || {}, from = d.from, to = d.to, past = d.past || {}, recent = d.recent || from;
  (d.ids || []).forEach(function (i) { want[i] = 1; });
  var since = {};
  function sinceOf(id) { var v = since[id]; if (v === undefined) v = since[id] = past[id] ? Math.max(from, Date.now() - past[id] * 86400e3) : recent; return v; }
  var idx = {}, ids = [], firstSrc = [], count = [];
  var icons = {}, chans = [], matches = {}, report = [], total = 0;
  var pk = d.pk || {}, best = {}, claimed = {}, pubMatch = {}, pubWant = {};
  (d.pubWant || []).forEach(function (i) { pubWant[i] = 1; });
  var keys = PubEpg ? PubEpg.keys : function () { return { keys: [], country: '' }; };

  function slot(id) { var i = idx[id]; if (i === undefined) { i = idx[id] = ids.length; ids.push(id); count.push(0); firstSrc.push(-1); } return i; }

  function one(src, si, next) {
    var got = {}, buf = '', n = 0, off = (+src.offset || 0) * 60000, P = src.pub, wantP = {};
    var RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    var CH = /<channel\b[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
    function eat(final) {
      CH.lastIndex = 0;
      var c, lastC = 0;
      while ((c = CH.exec(buf))) {
        lastC = CH.lastIndex;
        var id = unesc(c[1]);
        var dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/.exec(c[2]);
        var name = dn ? unesc(dn[1]).trim() : id;
        if (chans.length < 30000) chans.push([id, name]);
        if (P) {
          var pid = P.prefix + id;
          if (chans.length < 30000) chans.push([pid, name]);
          if (pubWant[pid]) wantP[id] = 1;
          var kk = keys(name, id), pc = kk.country === 'UK' ? 'GB' : kk.country;
          kk.keys.push(['id:' + id, 0]);
          for (var q = 0; q < kk.keys.length; q++) {
            var cs = pk[kk.keys[q][0]];
            if (!cs) continue;
            var r = kk.keys[q][1] * 10 + (pc && pc !== P.cc ? 5 : 0);
            for (var z = 0; z < cs.length; z++) {
              var ck = cs[z][0], bb = best[ck];
              if (claimed[ck] || (bb && bb.r <= r) || (cs[z][2] && cs[z][2] !== P.cc)) continue;
              best[ck] = { id: id, r: r }; wantP[id] = 1;
              if (!(pid in past) || past[pid] < cs[z][1]) past[pid] = cs[z][1];
            }
          }
          if (wantP[id] && !icons[pid]) { var pi = /<icon[^>]*src="([^"]+)"/.exec(c[2]); if (pi) icons[pid] = unesc(pi[1]); }
          continue;
        }
        var nk = norm(name);
        if (!want[id] && nk && names[nk] != null && !matches[nk]) { matches[nk] = id; want[id] = 1; if (!(id in past) || past[id] < names[nk]) past[id] = names[nk]; }
        if (want[id] && !icons[id]) { var ic = /<icon[^>]*src="([^"]*)"/.exec(c[2]); if (ic) icons[id] = unesc(ic[1]); }
      }
      RE.lastIndex = 0;
      var m, last = lastC, full = false;
      while ((m = RE.exec(buf))) {
        last = RE.lastIndex;
        var a = m[1];
        var ch = /channel="([^"]*)"/.exec(a); ch = ch && unesc(ch[1]);
        if (!ch) continue;
        if (P) { if (!wantP[ch]) continue; ch = P.prefix + ch; } else if (!want[ch]) continue;
        var ix = idx[ch];
        if (ix !== undefined && firstSrc[ix] !== -1 && firstSrc[ix] !== si) continue;     // a higher-priority source has it
        var s = ts((/start="([^"]*)"/.exec(a) || [])[1]) + off, e = ts((/stop="([^"]*)"/.exec(a) || [])[1]) + off;
        if (!s || !e || e < sinceOf(ch) || s > to) continue;
        var t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
        var de = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
        ix = slot(ch); firstSrc[ix] = si; count[ix]++;
        got[ch] = 1;
        var bw = buckets[ix % NB];
        if (!bw.write(ix + '\t' + s + '\t' + e + '\t' + flat(t ? unesc(t[1]) : '') + '\t' + flat(de ? unesc(de[1]).slice(0, DESC_MAX) : '') + '\n') && !bw.full) { bw.full = true; waiting++; }
        if (bw.full) full = true;
        n++; total++;
      }
      buf = final ? '' : buf.slice(last);
      if (buf.length > 4e6) buf = buf.slice(-1e6);
      return full;
    }
    var unz = src.unz || '', done = false;
    function finish(err) {
      if (done) return;
      done = true; current = null;
      if (err) report.push({ url: src.label || src.url, ok: false, error: String(err && err.message || err), filled: settle() });
      else {
        var x = unz && Unzip.progress(unz), bytes = x ? (x.total || x.raw) : job.bytes;
        report.push({ url: src.label || src.url, key: src.key, bytes: bytes, ok: true, programmes: n, channels: Object.keys(got).length, filled: settle() });
      }
      next();
    }
    function settle() {
      if (!P) return undefined;
      var f = 0;
      for (var ck in best) { if (claimed[ck]) continue; var sid = P.prefix + best[ck].id, ix = idx[sid]; if (ix !== undefined && count[ix]) { pubMatch[ck] = sid; claimed[ck] = 1; f++; } }
      best = {};
      return f;
    }
    job.src = si + 1; job.host = src.host || ''; job.bytes = 0; job.total = 0; job.est = false;
    var req = current = http.get(src.url, function (res) {
      if ((res.statusCode || 0) >= 400) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
      var size = +(res.headers['x-raw-length'] || res.headers['content-length']) || 0, dec = new StringDecoder('utf8');
      job.est = !size && src.known > 0; job.total = job.est ? src.known : size;
      var tick = setInterval(function () {
        var x = unz && Unzip.progress(unz);
        if (x) { if (x.total) size = x.total; job.bytes = x.raw; }
        job.est = !size && src.known > 0; job.total = job.est ? Math.max(src.known, job.bytes) : size;
        job.programmes = total; job.channels = chans.length;
      }, 400);
      res.on('data', function (chunk) {
        if (stopped) return;
        if (!unz) job.bytes += chunk.length;
        buf += dec.write(chunk);
        if (buf.length > 512 * 1024 && eat(false) && waiting) {
          res.pause();
          onDrained = function () { if (!stopped) res.resume(); };
        }
      });
      res.on('end', function () { clearInterval(tick); if (stopped) return finish(new Error('stopped')); buf += dec.end(); eat(true); job.programmes = total; finish(); });
      res.on('error', function (e) { clearInterval(tick); finish(e); });
    });
    req.on('error', function (e) { finish(e); });
    req.setTimeout(120000, function () { try { req.abort(); } catch (e) {} finish(new Error('timed out')); });
  }

  // Public pass: a file is only worth downloading while some channel it could match is still open.
  function worth(src) {
    if (!src.pub) return true;
    for (var key in pk) for (var j = 0; j < pk[key].length; j++) { var e = pk[key][j]; if (!claimed[e[0]] && (!e[2] || e[2] === src.pub.cc)) return true; }
    for (var w in pubWant) if (w.indexOf(src.pub.prefix) === 0) return true;
    return false;
  }

  var failed = false;
  function fail(e) {
    if (failed) return;
    failed = true; stopped = true;
    job.phase = 'error'; job.error = String(e && e.message || e); job.at = Date.now();
    buckets.forEach(function (w) { try { w.end(); } catch (x) {} });
    log({ lv: 'error', event: 'guide load failed', kind: k, e: job.error });
  }

  var srcs = d.sources || [], si = -1;
  function next() {
    if (stopped) return;
    si++;
    if (si >= srcs.length) return close();
    if (!worth(srcs[si])) { report.push({ url: srcs[si].label || srcs[si].url, ok: true, programmes: 0, channels: 0, filled: 0, skipped: true }); return next(); }
    one(srcs[si], si, next);
  }
  function close() {
    job.phase = 'save';
    var left = NB;
    buckets.forEach(function (w) { w.end(function () { if (!--left) build(); }); });
  }

  // Group each bucket's programmes by channel and write titles, descriptions and the index.
  function build() {
    if (stopped) return;
    var keep = null;
    if (pub) { keep = {}; var u; for (u in pubMatch) keep[pubMatch[u]] = 1; for (u in pubWant) keep[u] = 1; }
    var titles = fs.createWriteStream(path.join(tmp, 'titles.tsv')), descF = path.join(tmp, 'desc.json'), dIdx = {}, off = 0, kept = 0, b = 0;
    titles.on('error', fail);
    fs.writeFileSync(descF, '');
    function bucket() {
      if (stopped) return;
      if (b >= NB) return titles.end(finishBuild);
      fs.readFile(path.join(tmp, 'b' + b), 'utf8', function (err, text) {
        if (err) return fail(err);
        var by = {}, lines = text.split('\n');
        text = null;
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i]; if (!l) continue;
          var p = l.split('\t'), ix = +p[0];
          (by[ix] || (by[ix] = [])).push([+p[1], +p[2], p[3] || '', p[4] || '']);
        }
        lines = null;
        var tOut = [], dOut = [];
        Object.keys(by).forEach(function (ixs) {
          var id = ids[+ixs], list = by[ixs];
          if (keep && !keep[id]) return;
          list.sort(function (x, y) { return x[0] - y[0]; });
          var sid = flat(id);
          for (var j = 0; j < list.length; j++) tOut.push(sid + '\t' + list[j][0] + '\t' + list[j][1] + '\t' + list[j][2]);
          var dj = JSON.stringify(list.map(function (x) { return x[3]; })), len = Buffer.byteLength(dj);
          dIdx[id] = [off, len]; off += len; dOut.push(dj);
          kept++;
        });
        by = null;
        fs.unlink(path.join(tmp, 'b' + b), function () {});
        fs.appendFile(descF, dOut.join(''), function (e2) {
          if (e2) return fail(e2);
          var ok = tOut.length ? titles.write(tOut.join('\n') + '\n') : true;
          b++;
          if (ok) setImmediate(bucket); else titles.once('drain', bucket);
        });
      });
    }
    function finishBuild() {
      if (stopped) return;
      // Every file failed (offline, a site down): keep the guide already stored rather than an empty one.
      if (report.length && report.every(function (x) { return !x.ok; })) {
        rmdir(tmp);
        job.phase = 'failed'; job.error = report[0].error; job.report = report; job.at = Date.now();
        log({ lv: 'warn', event: 'guide load failed, kept the stored one', kind: k, e: job.error });
        return;
      }
      var meta = { sig: job.sig, at: Date.now(), extra: body.extra || null, report: report, matches: matches, icons: pub ? keepIcons(icons, keep) : icons, channels: chans, pubMatch: pubMatch,
        kept: kept, programmes: total, took: Date.now() - job.started };
      try {
        fs.writeFileSync(path.join(tmp, 'desc.idx'), JSON.stringify(dIdx));
        fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta));
        var dir = dirOf(k), old = dir + '.old';
        rmdir(old);
        try { fs.renameSync(dir, old); } catch (e) {}
        fs.renameSync(tmp, dir);
        rmdir(old);
      } catch (e) { return fail(e); }
      delete descIdx[k];
      job.phase = 'done'; job.at = meta.at; job.programmes = total; job.channels = kept;
      log({ lv: 'info', event: 'guide stored', kind: k, channels: kept, programmes: total, ms: meta.took });
    }
    bucket();
  }
  function keepIcons(all, keep) { var o = {}; for (var i in all) if (keep[i]) o[i] = all[i]; return o; }

  next();
  return job;
}

/* ---------- reading it back ---------- */
// What the app needs: a load in progress (job) and the guide stored now (stored), either or both.
function status(k) {
  var j = jobs[k], m = readMeta(k);
  var o = { phase: m ? 'stored' : 'none', stored: m ? { sig: m.sig, at: m.at, kept: m.kept, programmes: m.programmes } : null };
  if (j && j.phase !== 'done') {
    o.phase = j.phase;
    o.job = { sig: j.sig, src: j.src, of: j.of, host: j.host, bytes: j.bytes, total: j.total, est: j.est, programmes: j.programmes, channels: j.channels, started: j.started, at: j.at || 0, error: j.error || '', report: j.report || null };
  }
  return o;
}
function desc(k, id, cb) {
  var ix = descIdx[k];
  if (!ix) { try { ix = descIdx[k] = JSON.parse(fs.readFileSync(path.join(dirOf(k), 'desc.idx'), 'utf8')); } catch (e) { return cb(null, []); } }
  var at = ix[id];
  if (!at) return cb(null, []);
  fs.open(path.join(dirOf(k), 'desc.json'), 'r', function (err, fd) {
    if (err) return cb(err);
    var b = new Buffer(at[1]);                                // eslint-disable-line no-buffer-constructor
    fs.read(fd, b, 0, at[1], at[0], function (e2) { fs.close(fd, function () {}); if (e2) return cb(e2); try { cb(null, JSON.parse(b.toString('utf8'))); } catch (e3) { cb(e3); } });
  });
}

function send(res, code, body, type, h) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }, h || {}));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function query(url) {
  var q = {}, i = url.indexOf('?');
  if (i >= 0) url.slice(i + 1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); });
  return q;
}
// The app's /guide/... requests.  allow: the relay's CORS headers.
function handle(req, res, allow, log) {
  var p = req.url.split('?')[0], q = query(req.url), k = keyOf(q.pl, q.kind);
  try {
    if (p === '/guide/load' && req.method === 'POST') {
      var chunks = [], size = 0;
      req.on('data', function (c) { size += c.length; if (size > 64e6) { req.destroy(); return; } chunks.push(c); });
      req.on('end', function () {
        var body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(res, 400, { ok: false, error: 'bad request' }, null, allow); }
        try { start(body, log || function () {}); send(res, 200, { ok: true }, null, allow); }
        catch (e) { send(res, 500, { ok: false, error: e.message }, null, allow); }
      });
      return;
    }
    if (p === '/guide/status') return send(res, 200, status(k), null, allow);
    if (p === '/guide/cancel') { if (jobs[k] && jobs[k].cancel) jobs[k].cancel(); delete jobs[k]; return send(res, 200, { ok: true }, null, allow); }
    if (p === '/guide/meta' || p === '/guide/titles') {
      var f = path.join(dirOf(k), p === '/guide/meta' ? 'meta.json' : 'titles.tsv');
      fs.stat(f, function (err, st) {
        if (err) return send(res, 404, { ok: false, error: 'no guide stored' }, null, allow);
        res.writeHead(200, Object.assign({ 'Content-Type': p === '/guide/meta' ? 'application/json' : 'text/plain; charset=utf-8', 'Content-Length': st.size, 'Cache-Control': 'no-store' }, allow || {}));
        fs.createReadStream(f).pipe(res);
      });
      return;
    }
    if (p === '/guide/desc') return desc(k, q.id || '', function (err, list) { send(res, err ? 500 : 200, err ? { ok: false, error: err.message } : list, null, allow); });
    if (p === '/guide/drop') { if (jobs[k] && jobs[k].cancel) jobs[k].cancel(); delete jobs[k]; rmdir(dirOf(k)); delete descIdx[k]; return send(res, 200, { ok: true }, null, allow); }
  } catch (e) { return send(res, 500, { ok: false, error: e.message }, null, allow); }
  send(res, 404, { ok: false, error: 'unknown guide request' }, null, allow);
}

module.exports = { handle: handle, norm: norm, start: start, status: status, keyOf: keyOf, root: root };
