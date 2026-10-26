// The helper sends a playlist's custom User-Agent upstream (/ua/<base64url>/x/... prefix),
// keeps the prefix on redirects, and uses its default agent otherwise.  Self-contained: runs
// its own tiny upstream server, no mock provider needed.
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const get = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', rej));
const b64 = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
(async () => {
  const up = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { Location: '/echo' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(req.headers['user-agent'] || '');
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;
  const ua = 'TiviMate/5.1.6 (Android 12)';
  let a = await get(B + '/ua/' + b64(ua) + '/x/http/' + U + '/echo');
  ok('custom User-Agent reaches the provider', a.body === ua, a.body);
  a = await get(B + '/x/http/' + U + '/echo');
  ok('default User-Agent without the prefix', /Web0S/.test(a.body), a.body);
  a = await get(B + '/ua/' + b64(ua) + '/x/http/' + U + '/redir');
  ok('redirect keeps the User-Agent prefix', a.status === 302 && a.headers.location === B + '/ua/' + b64(ua) + '/x/http/' + U + '/echo', a.headers.location);
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all User-Agent relay tests passed');
  process.exit(fail ? 1 : 0);
})();
