// Sloppy provider responses through the helper.  Node 12 and newer (webOS 22 and later) parse HTTP
// strictly and reject replies that older TVs' Node accepted: a stray control character in a
// header, or bare LF line endings.  Cheap IPTV panels send both, so the helper asks Node for its
// lenient parser.  (Content-Length sent twice is refused even by the lenient parser on current
// Node; that one still fails on webOS 22 and later.)
// Self-contained: a raw TCP "provider" writes the broken replies byte for byte.
const net = require('net'), http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const get = (url) => new Promise((res) => http.get(url, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', e => res({ status: 0, body: e.message })));
const REPLIES = {
  '/ctrl': 'HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nX-Panel: a\x01b\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello',
  '/lf': 'HTTP/1.1 200 OK\nContent-Type: text/plain\nContent-Length: 5\nConnection: close\n\nhello',
  '/clean': 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello'
};
(async () => {
  const up = net.createServer(sock => {
    let buf = '';
    sock.on('data', d => {
      buf += d;
      if (buf.indexOf('\r\n\r\n') < 0) return;
      const p = (/^GET (\S+)/.exec(buf) || [])[1];
      sock.end(REPLIES[p] || 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n', 'latin1');
    });
    sock.on('error', () => {});
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;
  for (const [p, what] of [['/clean', 'a clean reply'], ['/ctrl', 'a control character in a header'], ['/lf', 'bare LF line endings']]) {
    const a = await get(B + '/x/http/' + U + p);
    ok('relays ' + what, a.status === 200 && a.body === 'hello', a.status + ' ' + a.body.slice(0, 60));
  }
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all lenient relay tests passed');
  process.exit(fail ? 1 : 0);
})();
