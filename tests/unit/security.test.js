// Security checks (the audit of alpha 124): the relay turns away other origins and hosts (a web page in the TV's
// browser, DNS rebinding), and an update installs only with the release build's signature (service/updatesig.js).
'use strict';
const http = require('http'), path = require('path'), crypto = require('crypto');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
const Sig = require(path.join(__dirname, '../../service/updatesig.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const get = (port, p, headers) => new Promise((res) => {
  const q = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: headers || {} }, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); });
  q.on('error', (e) => res({ status: 0, body: e.message })); q.end();
});
(async () => {
  // The update signature.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const m = { version: '0.5.10124', ipkUrl: 'https://github.com/ohmybahgosh/TiviBro/releases/download/v0.6.0-alpha.124/app.tivibro.tv_0.5.10124_all.ipk', sha256: 'ab'.repeat(32) };
  m.sig = Sig.sign(m, privateKey);
  ok('a signed manifest checks out', Sig.verify(m, publicKey));
  ok('another IPK address does not', !Sig.verify(Object.assign({}, m, { ipkUrl: 'https://evil.example/x.ipk' }), publicKey));
  ok('another checksum does not', !Sig.verify(Object.assign({}, m, { sha256: 'cd'.repeat(32) }), publicKey));
  ok('another version does not', !Sig.verify(Object.assign({}, m, { version: '0.5.10999' }), publicKey));
  ok('nor a signature from another key (the one built in)', !Sig.verify(m));
  ok('nor no signature', !Sig.verify(Object.assign({}, m, { sig: '' }), publicKey) && !Sig.verify(null));

  // Secrets never reach a log or a problem report: the helper's redaction and the app's (log.js, the same rules).
  const fs = require('fs'), vm = require('vm');
  const ctx = { localStorage: { getItem: () => null, setItem() {} }, document: { hidden: false, addEventListener() {} }, window: { addEventListener() {} }, navigator: {}, location: { href: '' },
    U: { debounce: (f) => f }, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, console: { log() {}, warn() {}, error() {} }, Date, JSON, Math };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/log.js'), 'utf8') + '\nthis.Log = Log;', ctx);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxMjM0NTY3ODkwYWJjZGVmIn0.abcdEFGHijklMNOP1234';
  const leaks = ['Authorization: Bearer sl.u.ABCDEFGHIJKLMNOP1234567890', 'token ' + jwt, '{"credential":"0123456789abcdef0123456789abcdef","x":1}', '{"refresh_token":"ABCDEFGH12345678"}'];
  for (const [who, f] of [['the helper', proxy.redact], ['the app', ctx.Log.redact]]) {
    const out = leaks.map((x) => f(x)).join(' | ');
    ok(who + ': Bearer tokens, JWTs and secret JSON fields are masked', !/ABCDEFGHIJKLMNOP|eyJhdWQ|0123456789abcdef0123|ABCDEFGH12345678/.test(out) && /"x":1/.test(out), out);
  }

  // The relay: TiviBro and the TV's player, at 127.0.0.1, and nothing else.
  const r = proxy.create({}); await new Promise((f) => r.server.listen(0, '127.0.0.1', f));
  const port = r.server.address().port;
  let a = await get(port, '/log');
  ok('the TV\'s player and the helper (no Origin) are served', a.status === 200, a.status);
  a = await get(port, '/log', { Origin: 'null' });
  ok('TiviBro\'s own page (a file:// page, Origin null) is served', a.status === 200, a.status);
  a = await get(port, '/log', { Origin: 'http://127.0.0.1:8078' });
  ok('and a page on this TV itself', a.status === 200, a.status);
  for (const o of ['file://', 'app://app.tivibro.tv', 'webos-app://app.tivibro.tv', 'http://127.0.0.1/']) {
    a = await get(port, '/log', { Origin: o });
    ok('TiviBro\'s own page as some webOS versions name it (' + o + ') is served (issue #89)', a.status === 200, a.status);
  }
  a = await get(port, '/log', { Origin: 'https://evil.example' });
  ok('a web page opened in the TV\'s browser is turned away', a.status === 403, a.status);
  a = await get(port, '/x/http/192.168.1.1/', { Origin: 'http://192.168.1.50:8080' });
  ok('including the relay to the home network', a.status === 403, a.status);
  a = await get(port, '/log', { Host: 'rebind.evil.example:' + port });
  ok('a name pointed at 127.0.0.1 (DNS rebinding) is turned away by its Host', a.status === 403, a.status);
  a = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port, path: '/log', method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } }, (rs) => { rs.resume(); res(rs.statusCode); }); q.end(); });
  ok('its CORS preflight too', a === 403, a);
  r.server.close();
  console.log(fail ? fail + ' failures' : 'all security checks passed');
  process.exit(fail ? 1 : 0);
})();
