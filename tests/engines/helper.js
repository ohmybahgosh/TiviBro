/* The helper on the real Node versions of webOS TVs.
     node tests/engines/helper.js                 (any Node from 0.12 to current)
     bash tests/engines/run.sh                    (every webOS Node version, see that file)
   Plain ES5 and callbacks only, so the same file runs on Node 0.12 (webOS 4) and Node 20 (webOS 26).
   Self-contained: local "provider" servers, no network.  Covers everything the helper does:
   relaying with CORS, HEAD, Range, redirects, custom User-Agent, unzipping guides, MPEG-TS resync,
   sloppy provider replies, the DNS cache, errors and timeouts, a viewer zapping away, the web
   editor (login, snapshot, save, encrypted backup and restore) and the webOS service wrapper. */
'use strict';
var http = require('http'), net = require('net'), zlib = require('zlib'), path = require('path'), dns = require('dns'), Module = require('module');

var lookups = 0, realLookup = dns.lookup;
dns.lookup = function (host) { if (host === 'localhost') lookups++; return realLookup.apply(dns, arguments); };

var SVC = path.join(__dirname, '../../service');
var proxy = require(path.join(SVC, 'proxy.js'));
var Editor = require(path.join(SVC, 'editor.js'));
// Buffer.from and alloc on every Node (service/compat.js adds from on 0.12)
function alloc(n) { if (Buffer.alloc) return Buffer.alloc(n); var b = new Buffer(n); b.fill(0); return b; }   // eslint-disable-line no-buffer-constructor
var major = +process.version.replace(/^v/, '').split('.')[0], minor = +process.version.split('.')[1];

var fails = 0, passes = 0, notes = [];
function ok(name, cond, extra) {
  if (cond) passes++; else fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
}
function note(s) { notes.push(s); console.log('NOTE ' + s); }

function request(method, url, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  var u = require('url').parse(url), done = false;
  var r = http.request({ method: method, hostname: u.hostname, port: u.port, path: u.path, headers: opts.headers || {}, agent: false }, function (res) {
    var chunks = [];
    res.on('data', function (d) { chunks.push(d); });
    res.on('end', function () { if (!done) { done = true; cb(null, res, Buffer.concat(chunks)); } });
    res.on('error', function (e) { if (!done) { done = true; cb(e); } });
  });
  r.on('error', function (e) { if (!done) { done = true; cb(e); } });
  if (opts.body) r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  r.end();
  return r;
}
function json(b) { try { return JSON.parse(b.toString('utf8')); } catch (e) { return null; } }

/* ---------- the "provider" ---------- */
var XML = '<?xml version="1.0"?><tv><channel id="a"><display-name>A</display-name></channel></tv>';
var GZ = zlib.gzipSync ? zlib.gzipSync(Buffer.from(XML)) : null;
var GZ2 = GZ && zlib.gzipSync(GZ);
var seenUA = '', closedEarly = false;
function tsPackets(n) {
  var out = [];
  for (var i = 0; i < n; i++) { var p = alloc(188); p.fill(i & 0xff); p[0] = 0x47; out.push(p); }
  return out;
}
var provider = http.createServer(function (req, res) {
  var p = req.url.split('?')[0];
  seenUA = req.headers['user-agent'] || '';
  if (p === '/plain') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 5 }); return res.end(req.method === 'HEAD' ? undefined : 'hello'); }
  if (p === '/range') {
    var body = Buffer.from('0123456789'), m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Length': 10, 'Accept-Ranges': 'bytes' }); return res.end(body); }
    res.writeHead(206, { 'Content-Length': +m[2] - +m[1] + 1, 'Content-Range': 'bytes ' + m[1] + '-' + m[2] + '/10', 'Accept-Ranges': 'bytes' });
    return res.end(body.slice(+m[1], +m[2] + 1));
  }
  if (p === '/moved') { res.writeHead(302, { Location: '/plain?x=1' }); return res.end(); }
  if (p === '/perm') { res.writeHead(301, { Location: 'http://127.0.0.1:' + provider.address().port + '/plain' }); return res.end(); }
  if (p === '/ce-gzip') { res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Encoding': 'gzip' }); return res.end(GZ); }
  if (p === '/file.xml.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': GZ.length }); return res.end(GZ); }
  if (p === '/double.gz') { res.writeHead(200, { 'Content-Type': 'application/x-gzip', 'Content-Encoding': 'gzip' }); return res.end(GZ2); }
  if (p === '/files/guide.xml.gz') { res.writeHead(302, { Location: '/files/t0k3n/guide.xml.gz' }); return res.end(); }     // as iptv-epg.org does
  if (p === '/guide.xml.gz' || p === '/files/t0k3n/guide.xml.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(zlib.gzipSync ? zlib.gzipSync(Buffer.from(GUIDE)) : GUIDE); }
  if (p === '/xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(XML); }
  if (p === '/broken.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(GZ.slice(0, 20)); }
  if (p === '/live.ts') {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    var pk = tsPackets(40), junk = Buffer.from([1, 2, 3, 4, 5, 6, 7]);
    var out = [Buffer.from([9, 9, 9])].concat(pk.slice(0, 10), [junk], pk.slice(10, 25), [junk], pk.slice(25));
    var all = Buffer.concat(out), i = 0;
    (function next() { if (i >= all.length) return res.end(); res.write(all.slice(i, i + 500)); i += 500; setTimeout(next, 2); })();
    return;
  }
  if (p === '/endless.ts') {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    var iv = setInterval(function () { res.write(Buffer.concat(tsPackets(7))); }, 20);
    req.on('close', function () { clearInterval(iv); closedEarly = true; });
    res.on('close', function () { clearInterval(iv); closedEarly = true; });
    return;
  }
  if (p === '/ch.m3u8') {           // a panel's HLS playlist with root-relative and absolute links
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\n/hlsr/a.ts?t=1\n#EXTINF:6.0,\nb.ts\n#EXTINF:6.0,\nhttp://127.0.0.1:' + provider.address().port + '/abs/c.ts\n');
  }
  if (p === '/hang') return;        // never answers
  res.writeHead(404); res.end('nope');
});

/* Raw replies that a strict HTTP parser refuses. */
var RAW = {
  '/ctrl': 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Panel: a\x01b\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello',
  '/lf': 'HTTP/1.1 200 OK\nContent-Type: text/plain\nContent-Length: 5\nConnection: close\n\nhello',
  '/dupcl': 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello',
  '/chunked': 'HTTP/1.1 200 OK\nContent-Type: text/plain\nX-Panel: a\x02b\nTransfer-Encoding: chunked\n\n2\r\nhe\r\n3;x=1\r\nllo\r\n0\r\n\r\n'
};
var rawProvider = net.createServer(function (sock) {
  var buf = '';
  sock.on('data', function (d) {
    buf += d;
    if (buf.indexOf('\r\n\r\n') < 0) return;
    var p = (/^GET (\S+)/.exec(buf) || [])[1];
    sock.end(RAW[p] || 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n', 'binary');
  });
  sock.on('error', function () {});
});

/* ---------- tests, run one after another ---------- */
var R, B, P, Q, steps = [];
function step(fn) { steps.push(fn); }
function run() {
  var fn = steps.shift();
  if (!fn) return finish();
  var called = false, timer = setTimeout(function () { if (!called) { called = true; ok('step finished in time', false, fn.name || ''); run(); } }, 20000);
  try { fn(function () { if (called) return; called = true; clearTimeout(timer); setImmediate(run); }); }
  catch (e) { called = true; clearTimeout(timer); ok('step threw', false, e && (e.stack || e.message)); setImmediate(run); }
}

step(function ping(next) {
  request('GET', B + '/ping', function (e, r, b) {
    var j = b && json(b);
    ok('ping answers with the Node version', !e && r.statusCode === 200 && j && j.node === process.version, j && j.node);
    next();
  });
});
step(function plain(next) {
  request('GET', B + '/x/http/' + P + '/plain', function (e, r, b) {
    ok('relays a plain reply with CORS', !e && r.statusCode === 200 && String(b) === 'hello' && r.headers['access-control-allow-origin'] === '*', e ? e.message : r.statusCode + ' ' + b);
    request('HEAD', B + '/x/http/' + P + '/plain', function (e2, r2, b2) {
      ok('HEAD', !e2 && r2.statusCode === 200 && b2.length === 0 && r2.headers['content-length'] === '5', e2 ? e2.message : r2.statusCode);
      request('OPTIONS', B + '/x/http/' + P + '/plain', function (e3, r3) {
        ok('CORS preflight', !e3 && r3.statusCode === 204 && /Range/.test(r3.headers['access-control-allow-headers'] || ''));
        next();
      });
    });
  });
});
step(function range(next) {
  request('GET', B + '/x/http/' + P + '/range', { headers: { Range: 'bytes=2-5' } }, function (e, r, b) {
    ok('Range passes through (seeking)', !e && r.statusCode === 206 && String(b) === '2345' && r.headers['content-range'] === 'bytes 2-5/10', e ? e.message : r.statusCode + ' ' + b);
    next();
  });
});
step(function redirects(next) {
  request('GET', B + '/x/http/' + P + '/moved', function (e, r) {
    ok('302 comes back as the relayed address', !e && r.statusCode === 302 && r.headers.location === B + '/x/http/' + P + '/plain?x=1', r && r.headers.location);
    request('GET', B + '/x/http/' + P + '/perm', function (e2, r2) {
      ok('301 becomes 307', !e2 && r2.statusCode === 307 && r2.headers.location === B + '/x/http/' + P + '/plain', r2 && r2.statusCode + ' ' + r2.headers.location);
      next();
    });
  });
});
step(function hlsLinks(next) {
  request('GET', B + '/x/http/' + P + '/ch.m3u8', function (e, r, b) {
    var l = String(b || '').split('\n');
    ok('HLS playlist links are kept on the helper', !e && r.statusCode === 200 && l.indexOf(B + '/x/http/' + P + '/hlsr/a.ts?t=1') >= 0 && l.indexOf('b.ts') >= 0 && l.indexOf(B + '/x/http/' + P + '/abs/c.ts') >= 0, e ? e.message : l.slice(3).join(' '));
    next();
  });
});
step(function userAgent(next) {
  var ua = 'TiviMate/4.7.0 (test)', b64 = Buffer.from(ua).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  request('GET', B + '/ua/' + b64 + '/x/http/' + P + '/plain', function (e, r) {
    ok('custom User-Agent reaches the provider', !e && r.statusCode === 200 && seenUA === ua, seenUA);
    next();
  });
});
step(function unzip(next) {
  var cases = [['/ce-gzip', 'gzip'], ['/file.xml.gz', 'gzip'], ['/double.gz', 'gzip+gzip'], ['/xml', '']], i = 0;
  (function one() {
    if (i >= cases.length) {
      request('GET', B + '/xfer/t3', function (e, r, b) {
        var j = b && json(b);
        ok('download progress readable', !e && j && j.done === true && j.raw > 0, b && String(b));
        request('GET', B + '/unz/t9/x/http/' + P + '/broken.gz', function (e2, r2, b2) {
          ok('a cut-off .gz is an error, not a hang', !!e2 || r2.statusCode === 502 || b2.length < XML.length, e2 ? e2.code || e2.message : r2.statusCode + ' ' + b2.length + ' bytes');
          next();
        });
      });
      return;
    }
    var c = cases[i++];
    request('GET', B + '/unz/t' + i + '/x/http/' + P + c[0], function (e, r, b) {
      ok('guide unzipped: ' + c[0], !e && r.statusCode === 200 && String(b) === XML && (r.headers['x-unzipped'] || '') === c[1], e ? e.message : r.statusCode + ' ' + (r.headers['x-unzipped'] || '-') + ' ' + b.length + 'B');
      one();
    });
  })();
});
// Big guides kept by the helper (guide.js): read through the relay, stored, read back.
var GUIDE = (function () {
  var t0 = Date.now() - Date.now() % 3600e3 - 3600e3, o = '<?xml version="1.0"?><tv>';
  function xd(t) { var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000'; }
  ['a', 'b', 'c'].forEach(function (id) { o += '<channel id="' + id + '.us"><display-name>Chan ' + id.toUpperCase() + '</display-name><icon src="http://x/' + id + '.png"/></channel>'; });
  o += '<channel id=""><display-name>Chan D</display-name><icon src="http://x/d.png"/></channel>';    // a blank id: no programme can use it
  ['a', 'b', 'c'].forEach(function (id) { for (var i = 0; i < 6; i++) o += '<programme start="' + xd(t0 + i * 1800e3) + '" stop="' + xd(t0 + (i + 1) * 1800e3) + '" channel="' + id + '.us"><title>Show ' + id + i + ' &amp; more</title><desc>About ' + id + i + '</desc></programme>'; });
  return o + '</tv>';
})();
step(function guide(next) {
  var dir = path.join(require('os').tmpdir(), 'tivibro-guide-test-' + process.pid);
  process.env.TIVIBRO_GUIDE_DIR = dir;
  var now = Date.now();
  var msg = { sources: [{ url: B + '/unz/gt1/x/http/' + P + '/files/guide.xml.gz', unz: 'gt1', label: 'test guide', host: P, offset: 0 }],
    ids: ['a.us'], past: {}, names: { chanb: 0, chand: 0 }, from: now - 86400e3, recent: now - 3 * 3600e3, to: now + 2 * 86400e3 };
  request('POST', B + '/guide/load', { body: { pl: 'p1', kind: 'main', sig: 's1', msg: msg } }, function (e, r, b) {
    ok('guide: the helper takes a load', !e && json(b) && json(b).ok, b && String(b));
    var tries = 0;
    (function poll() {
      request('GET', B + '/guide/status?pl=p1&kind=main', function (e2, r2, b2) {
        var st = json(b2) || {};
        if ((st.phase === 'download' || st.phase === 'save') && ++tries < 100) return setTimeout(poll, 100);
        ok('guide: read and stored, through a redirect', st.phase === 'stored' && st.stored && st.stored.sig === 's1' && st.stored.kept === 2, String(b2));
        request('GET', B + '/guide/titles?pl=p1&kind=main', function (e3, r3, b3) {
          var lines = String(b3 || '').split('\n').filter(Boolean);
          ok('guide: titles for the wanted id and the name match, not the others', lines.length >= 8 && lines.every(function (l) { return /^(a|b)\.us\t\d+\t\d+\tShow /.test(l); }) && lines.some(function (l) { return /Show a0 & more$/.test(l) || /Show a\d & more$/.test(l); }), lines.slice(0, 2).join(' | '));
          request('GET', B + '/guide/desc?pl=p1&kind=main&id=a.us', function (e4, r4, b4) {
            var d = json(b4);
            ok('guide: one channel\'s descriptions, in order', Array.isArray(d) && d.length >= 4 && /^About a\d$/.test(d[0]), String(b4));
            request('GET', B + '/guide/meta?pl=p1&kind=main', function (e5, r5, b5) {
              var m = json(b5) || {};
              ok('guide: name match and icon reported', m.matches && m.matches.chanb === 'b.us' && m.icons && m.icons['a.us'] === 'http://x/a.png', String(b5).slice(0, 200));
              ok('guide: a guide channel with a blank id is left out', !(m.matches && 'chand' in m.matches) && (m.channels || []).every(function (x) { return x[0]; }) && !(m.icons && '' in m.icons), JSON.stringify(m.channels));
              try { require('fs').readdirSync(dir).forEach(function (sub) { var d2 = path.join(dir, sub); require('fs').readdirSync(d2).forEach(function (f) { require('fs').unlinkSync(path.join(d2, f)); }); require('fs').rmdirSync(d2); }); require('fs').rmdirSync(dir); } catch (x) {}
              next();
            });
          });
        });
      });
    })();
  });
});
step(function tsResync(next) {
  request('GET', B + '/x/http/' + P + '/live.ts', function (e, r, b) {
    var aligned = b && b.length % 188 === 0;
    for (var i = 0; aligned && i < b.length; i += 188) if (b[i] !== 0x47) aligned = false;
    // The packet just before stray bytes may be cut short, so it goes too: 40 sent, 2 junk runs, 38 out.
    ok('live MPEG-TS realigned after stray bytes', !e && aligned && b.length === 38 * 188, e ? e.message : b.length + ' bytes, ' + (b.length / 188) + ' packets');
    next();
  });
});
step(function sloppy(next) {
  var keys = ['/ctrl', '/lf', '/dupcl', '/chunked'], i = 0, res = {};
  (function one() {
    if (i >= keys.length) {
      // Node's lenient parser where it has one, the forgiving reader (rawhttp.js) for the rest.
      ok('stray control character in a header', res['/ctrl'], String(res['/ctrl']));
      ok('bare LF line endings', res['/lf'], String(res['/lf']));
      ok('Content-Length sent twice', res['/dupcl'], String(res['/dupcl']));
      ok('chunked reply with a control character and bare LF', res['/chunked'], String(res['/chunked']));
      next();
      return;
    }
    var k = keys[i++];
    request('GET', B + '/x/http/' + Q + k, function (e, r, b) { res[k] = !e && r.statusCode === 200 && String(b) === 'hello'; one(); });
  })();
});
step(function dnsCache(next) {
  var before = lookups, n = 0;
  (function one() {
    if (n++ < 5) return request('GET', B + '/x/http/localhost:' + provider.address().port + '/plain', function () { one(); });
    var used = lookups - before;
    if (major === 0) { ok('DNS: requests by name work', used >= 1, used + ' lookups for 5 requests (Node 0.12 ignores the cache, as documented)'); }
    else ok('DNS answer reused (5 requests by name)', used === 1, used + ' lookups');
    next();
  })();
});
step(function refused(next) {
  var s = net.createServer(); s.listen(0, '127.0.0.1', function () {
    var port = s.address().port; s.close(function () {
      request('GET', B + '/x/http/127.0.0.1:' + port + '/x', function (e, r, b) {
        ok('provider down: 502 with the reason', !e && r.statusCode === 502 && /ECONNREFUSED/.test(String(b)), e ? e.message : r.statusCode + ' ' + b);
        next();
      });
    });
  });
});
step(function timeout(next) {
  var r2 = proxy.create({ timeout: 400 });
  r2.server.listen(0, '127.0.0.1', function () {
    var t0 = Date.now();
    request('GET', 'http://127.0.0.1:' + r2.server.address().port + '/x/http/' + P + '/hang', function (e, r, b) {
      ok('provider that never answers: 502 after the timeout', !e && r.statusCode === 502 && Date.now() - t0 < 3000, e ? e.message : r.statusCode + ' ' + b + ' in ' + (Date.now() - t0) + 'ms');
      r2.server.close(); next();
    });
  });
});
step(function zapAway(next) {
  closedEarly = false;
  var got = 0, req = request('GET', B + '/x/http/' + P + '/endless.ts', function () {});
  req.on('response', function (res) {
    res.on('data', function (d) {
      got += d.length;
      if (got > 5000 && !req._gone) { req._gone = true; req.abort(); setTimeout(function () {
        ok('zapping away closes the provider stream', closedEarly, 'got ' + got + ' bytes first');
        next();
      }, 500); }
    });
  });
});
step(function stats(next) {
  request('GET', B + '/log', function (e, r, b) {
    var j = b && json(b);
    ok('log readable, nothing still open', j && j.stats && j.stats.active === 0 && j.log.length > 10, j && JSON.stringify(j.stats));
    var leaked = j && j.log.filter(function (l) { return /pass(word)?=(?!\*\*\*)/i.test(l.u || ''); }).length;
    ok('no passwords in the log', leaked === 0);
    next();
  });
});
step(function editor(next) {
  var E = 'http://127.0.0.1:' + R.server.address().port, L, tok;
  // A free port for the editor, so a running TiviBro or another test can't get in the way.
  var probe = net.createServer(); probe.listen(0, '127.0.0.1', function () { var free = probe.address().port; probe.close(function () {
  request('POST', E + '/editor/start', { body: { port: free, password: 'ABCD-2345' } }, function (e, r, b) {
    var s = b && json(b);
    if (!s || !s.running) { ok('web editor starts', false, b && String(b)); return next(); }
    L = 'http://127.0.0.1:' + s.port;
    ok('web editor starts', s.running, 'port ' + s.port);
    request('GET', L + '/', function (e1, r1, b1) {
      ok('editor page served', !e1 && r1.statusCode === 200 && /<html/i.test(String(b1)));
      request('POST', L + '/api/login', { body: { password: 'wrong1' } }, function (e2, r2) {
        ok('wrong password refused', r2 && r2.statusCode === 401);
        request('POST', L + '/api/login', { body: { password: 'abcd 2345' } }, function (e3, r3, b3) {
          tok = (json(b3) || {}).token;
          ok('right password (any case, spaces) logs in', r3 && r3.statusCode === 200 && !!tok);
          var H = { 'X-Token': tok };
          request('GET', L + '/api/state', { headers: H }, function (e4, r4) {
            ok('no list yet: says so', r4 && r4.statusCode === 503);
            request('POST', E + '/editor/snapshot', { body: { groups: [{ n: 'News' }] } }, function () {
              request('GET', L + '/api/state', { headers: H }, function (e5, r5, b5) {
                var st = json(b5);
                ok('reads the list the TV sent', st && st.data && st.data.groups[0].n === 'News');
                request('POST', L + '/api/save', { headers: H, body: { edits: { hidden: ['x'] } } }, function () {
                  request('GET', E + '/editor/pending?since=0', function (e6, r6, b6) {
                    var p = json(b6);
                    ok('the TV picks up the edits', p && p.edits && p.edits.hidden[0] === 'x');
                    backup(E, L, H, function () { request('POST', E + '/editor/stop', function () { next(); }); });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
  }); });
});
function backup(E, L, H, done) {
  request('POST', L + '/api/command', { headers: H, body: { type: 'backup', args: { passphrase: 'correct horse' } } }, function (e, r, b) {
    var id = (json(b) || {}).id;
    var data = { app: 'TiviBro', kind: 'backup', version: 'test', settings: { playlists: [{ name: 'P', type: 'xtream', server: 'http://prov.example:8080', user: 'u', pass: 'secret' }] } };
    request('POST', E + '/editor/result', { body: { id: id, ok: true, data: data } }, function () {
      var tries = 0;
      (function poll() {
        request('GET', L + '/api/result?id=' + id, { headers: H }, function (e2, r2, b2) {
          var res = json(b2);
          if (!res || !res.done) { if (tries++ < 100) return setTimeout(poll, 100); ok('backup encrypted', false, 'not done'); return done(); }
          var env = res.data;
          ok('backup encrypted (AES-256-GCM), no login visible', env && env.kind === 'backup-encrypted' && String(b2).indexOf('secret') < 0, env && env.cipher);
          request('POST', L + '/api/restore', { headers: H, body: { file: env, passphrase: 'wrong pass', check: true } }, function (e3, r3) {
            ok('restore with a wrong passphrase refused', r3 && r3.statusCode === 400);
            request('POST', L + '/api/restore', { headers: H, body: { file: env, passphrase: 'correct horse', check: true } }, function (e4, r4, b4) {
              var s = json(b4);
              ok('restore decrypts it', s && s.ok && s.summary.playlists[0].host === 'prov.example', b4 && String(b4).slice(0, 80));
              done();
            });
          });
        });
      })();
    });
  });
}
step(function companion(next) {
  // The phone app connection (companion.js): pairing and signed requests with this Node's crypto.
  var Companion = require(path.join(SVC, 'companion.js')), crypto = require('crypto'), fs = require('fs'), os = require('os'), dgram = require('dgram');
  var dir = path.join(os.tmpdir(), 'tb-comp-' + process.pid);
  try { fs.mkdirSync(dir); } catch (e) {}
  var launched = [];
  var c = Companion.create({ dir: dir, version: 'engine', log: function () {}, launch: function (p, cb) { launched.push(p); cb(null); }, app: function () { return { open: false }; }, editor: function () { return null; } });
  function ctl(u, body, cb) {
    var res = { writeHead: function (code) { this.code = code; }, end: function (b) { cb(this.code, json(Buffer.from(b))); } };
    var req = new (require('events').EventEmitter)();
    req.method = body ? 'POST' : 'GET';
    c.control(req, res, u);
    setTimeout(function () { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }, 1);
  }
  function hm(k, t) { return crypto.createHmac('sha256', k).update(t, 'utf8').digest('hex'); }
  function sh(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
  function finish(msg) { if (msg) ok(msg, false); c.stop(); try { fs.unlinkSync(path.join(dir, 'companion.json')); fs.rmdirSync(dir); } catch (e) {} next(); }
  ctl('/companion/set', { on: true }, function (code, s) {
    ok('companion: starts on ' + process.version, code === 200 && s.running && s.port >= 47810, JSON.stringify(s));
    if (!s || !s.running) return finish();
    var T = 'http://127.0.0.1:' + s.port;
    // Discovery
    var u = dgram.createSocket('udp4'), heard = null;
    u.on('message', function (m) { heard = json(m); });
    u.bind(0, function () {
      var msg = Buffer.from(Companion.DISCOVER);
      u.send(msg, 0, msg.length, 47810, '127.0.0.1');
    });
    setTimeout(function () {
      try { u.close(); } catch (e) {}
      ok('companion: answers discovery', heard && heard.app === 'TiviBro' && heard.id === s.id, JSON.stringify(heard));
      ctl('/companion/pair', { open: true }, function (code2, s2) {
        var codeTxt = s2.pairing && s2.pairing.code, nonce = crypto.randomBytes(18).toString('base64');
        var kp = crypto.pbkdf2Sync(codeTxt.replace(/-/g, ''), 'tivibro-pair-v1:' + s.id, Companion.KDF_ITER, 32, 'sha256');
        request('POST', T + '/v1/pair', { body: { nonce: nonce, phone: { name: 'Engine' }, proof: hm(kp, 'tivibro-pair-v1\n' + s.id + '\n' + nonce + '\nEngine') } }, function (err, res, b) {
          var j = json(b) || {};
          ok('companion: pairs', !err && res.statusCode === 200 && j.proof === hm(kp, 'tivibro-paired-v1\n' + j.phone + '\n' + nonce), err ? err.message : String(b));
          if (err || res.statusCode !== 200) return finish();
          var d = crypto.createDecipheriv('aes-256-gcm', kp, Buffer.from(j.key.iv, 'base64'));
          d.setAAD(Buffer.from('tivibro-key-v1\n' + j.phone, 'utf8'));
          d.setAuthTag(Buffer.from(j.key.tag, 'base64'));
          var key = Buffer.concat([d.update(Buffer.from(j.key.data, 'base64')), d.final()]);
          ok('companion: the phone key arrives encrypted', key.length === 32);
          var t = Date.now(), n2 = crypto.randomBytes(18).toString('base64'), body = '{}';
          var hdr = { 'Content-Type': 'application/json', 'X-TiviBro-Phone': j.phone, 'X-TiviBro-Time': String(t), 'X-TiviBro-Nonce': n2, 'X-TiviBro-Sig': hm(key, 'tivibro-req-v1\nPOST\n/v1/open\n' + t + '\n' + n2 + '\n' + sh(body)) };
          request('POST', T + '/v1/open', { headers: hdr, body: body }, function (e3, r3, b3) {
            ok('companion: a signed request works, and the answer is signed', !e3 && r3.statusCode === 200 && launched.length === 1 && r3.headers['x-tivibro-sig'] === hm(key, 'tivibro-res-v1\n' + n2 + '\n200\n' + sh(b3)), e3 ? e3.message : String(b3));
            request('POST', T + '/v1/open', { headers: hdr, body: body }, function (e4, r4) {
              ok('companion: a replayed request is refused', !e4 && r4.statusCode === 401 && launched.length === 1);
              finish();
            });
          });
        });
      });
    }, 300);
  });
});
step(function service(next) {
  // service.js with a stand-in for webOS's webos-service module
  var handlers = {}, origResolve = Module._resolveFilename;
  var lunaCalls = [];
  function Stub() { this.activityManager = { create: function (n, cb) { cb({ id: 1 }); }, complete: function () {} }; }
  Stub.prototype.call = function (uri, params, cb) { lunaCalls.push({ uri: uri, params: params }); setTimeout(function () { cb({ payload: { returnValue: true } }); }, 1); };
  Stub.prototype.register = function (name, fn, cancel) { handlers[name] = { fn: fn, cancel: cancel }; };
  // The TV's power state: goes to standby once (the app then knows a closed session was the TV going off).
  Stub.prototype.subscribe = function (uri) {
    var em = new (require('events').EventEmitter)();
    if (/getPowerState/.test(uri)) setTimeout(function () { em.emit('response', { payload: { state: 'Active' } }); em.emit('response', { payload: { state: 'Active Standby' } }); }, 5);
    return em;
  };
  require.cache['webos-service-stub'] = { id: 'webos-service-stub', filename: 'webos-service-stub', loaded: true, exports: Stub };
  Module._resolveFilename = function (req) { if (req === 'webos-service') return 'webos-service-stub'; return origResolve.apply(this, arguments); };
  try { require(path.join(SVC, 'service.js')); } catch (e) { ok('service wrapper loads', false, e.message); Module._resolveFilename = origResolve; return next(); }
  Module._resolveFilename = origResolve;
  ok('service wrapper loads', !!handlers.start && !!handlers.status);
  handlers.start.fn({ isSubscription: true, respond: function (m) {
    ok('start: the relay is listening', m.returnValue && m.port >= 47811 && m.port <= 47815, JSON.stringify(m));
    ok('start: hands TiviBro the control secret, and the relay wants it', /^[0-9a-f]{32}$/.test(m.ctl || '') && !!handlers.wake, JSON.stringify(m));
    setTimeout(function () { request('GET', 'http://127.0.0.1:' + m.port + '/ping', function (e, r, pb) {
      ok('and answers', !e && r.statusCode === 200);
      var sy = (json(pb) || {}).sys || {};
      ok('ping: when the TV started and its power changes', Math.abs(sy.bootAt - (Date.now() - require('os').uptime() * 1000)) < 5000 && sy.power && sy.power.length >= 1 && sy.power[sy.power.length - 1].state === 'Active Standby', JSON.stringify(sy));
      try { require('fs').unlinkSync(path.join(SVC, 'power.json')); } catch (x) {}
      handlers.status.fn({ respond: function (s) {
        ok('status reports Node and subscribers', s.node === process.version && s.subscribers === 1);
        // Reminders while TiviBro is closed (remind.js): scheduled with the activity manager, then an alert.
        var t = Date.now() + 3600e3;
        handlers.reminders.fn({ payload: { pid: 'p1', before: 2, visible: false, list: [{ k: 'k1', s: t, e: t + 3600e3, t: 'Show', ch: 'Chan' }] }, respond: function (r) {
          var made = lunaCalls.filter(function (c) { return /activitymanager\/create$/.test(c.uri); })[0];
          ok('reminders: scheduled with the activity manager', r.returnValue && r.scheduled === 1 && made && made.params.activity.callback.method === 'luna://app.tivibro.tv.service/fire', JSON.stringify(r));
          handlers.fire.fn({ payload: made.params.activity.callback.params, respond: function (f) {
            ok('reminders: at reminder time the TV shows an alert', f.result === 'shown' && lunaCalls.some(function (c) { return /createAlert$/.test(c.uri); }), JSON.stringify(f));
            try { require('fs').unlinkSync(path.join(SVC, 'reminders.json')); } catch (e) {}
            next();
          } });
        } });
      } });
    }); }, 50);
  } });
});

function finish() {
  console.log((fails ? fails + ' failed, ' : '') + passes + ' passed on Node ' + process.version + (notes.length ? '  (' + notes.length + ' note' + (notes.length > 1 ? 's' : '') + ')' : ''));
  process.exit(fails ? 1 : 0);
}

R = proxy.create({});
var pending = 3;
function ready() {
  if (--pending) return;
  B = 'http://127.0.0.1:' + R.server.address().port;
  P = '127.0.0.1:' + provider.address().port;
  Q = '127.0.0.1:' + rawProvider.address().port;
  ok('helper modules load on ' + process.version, !!proxy.create && !!Editor.seal);
  if (!GZ) { ok('zlib.gzipSync available', false); }
  run();
}
R.server.listen(0, '127.0.0.1', ready);
provider.listen(0, '127.0.0.1', ready);
rawProvider.listen(0, '127.0.0.1', ready);
