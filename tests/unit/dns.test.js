// Settings > Playlists > DNS (service/dns.js, discussion #60): with a DNS picked, the helper finds providers' servers
// with it (every request, through dns.lookup), keeps the TV's DNS for addresses and local names, falls back to the
// TV's DNS when the picked one can't answer, and only TiviBro may change it.
'use strict';
const dgram = require('dgram'), dns = require('dns'), http = require('http'), path = require('path');
const D = require(path.join(__dirname, '../../service/dns.js'));
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const look = (h, o) => new Promise((res) => dns.lookup(h, o || {}, (e, a, f) => res(e ? { e: e.code || e.message } : { a, f })));
// A DNS server that answers every A question with 10.20.30.40, and refuses "nope.example".
function server() {
  const s = dgram.createSocket('udp4'), asked = [];
  s.on('message', (q, from) => {
    let i = 12, name = [];
    while (q[i]) { name.push(q.slice(i + 1, i + 1 + q[i]).toString()); i += q[i] + 1; }
    const qEnd = i + 5, n = name.join('.'); asked.push(n);
    const head = Buffer.from(q.slice(0, 12)); head[2] = 0x81; head[3] = n === 'nope.example' ? 0x83 : 0x80; head.writeUInt16BE(n === 'nope.example' ? 0 : 1, 6);
    const ans = n === 'nope.example' ? Buffer.alloc(0) : Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 20, 30, 40]);
    s.send(Buffer.concat([head, q.slice(12, qEnd), ans]), from.port, from.address);
  });
  return new Promise((r) => s.bind(0, '127.0.0.1', () => r({ s, port: s.address().port, asked })));
}
(async () => {
  const srv = await server();
  let r = await look('provider.example');
  ok('the TV\'s own DNS by default', D.mode === 'tv' && dns.lookup === dns.lookup && (r.e || r.a !== '10.20.30.40'), r);
  D.set('cloudflare'); D._servers(['127.0.0.1:' + srv.port]);
  r = await look('provider.example');
  ok('a picked DNS finds the provider', r.a === '10.20.30.40' && r.f === 4 && srv.asked.indexOf('provider.example') >= 0, r);
  r = await new Promise((res) => dns.lookup('provider.example', { all: true }, (e, a) => res(a)));
  ok('also when every address is asked for', Array.isArray(r) && r[0].address === '10.20.30.40', r);
  const before = srv.asked.length;
  await look('provider.example');
  ok('the answer is kept for a while (not asked again)', srv.asked.length === before);
  r = await look('localhost');
  ok('local names and addresses stay with the TV', r.a === '127.0.0.1' || r.a === '::1', r);
  r = await look('nope.example');
  ok('a name the picked DNS can\'t answer goes to the TV\'s DNS instead', srv.asked.indexOf('nope.example') >= 0 && r.a !== '10.20.30.40', r);
  // Every helper request goes through it: a provider "at" provider.example reaches this machine's 10.20.30.40.
  const port = await new Promise((res) => { const h = http.createServer((q, s) => s.end('ok')).listen(0, '127.0.0.1', () => res(h)); });
  D._servers(null); D.set('custom', '127.0.0.1');
  ok('a typed DNS server is used as typed', D.mode === 'custom');
  D.set('custom', 'not an address');
  ok('a typed one that isn\'t an address leaves the TV\'s own', D.mode === 'tv');
  D.set('nonsense');
  ok('an unknown choice is the TV\'s own', D.mode === 'tv');
  port.close();
  // Only TiviBro changes it: the helper's secret.
  const r2 = proxy.create({ ctl: 'secret' }); await new Promise((f) => r2.server.listen(0, '127.0.0.1', f));
  const post = (h) => new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: r2.server.address().port, path: '/net/dns', method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h) }, (rs) => { let b = ''; rs.on('data', (d) => b += d); rs.on('end', () => res({ s: rs.statusCode, b })); }); q.end(JSON.stringify({ mode: 'google' })); });
  r = await post({});
  ok('changing the DNS needs TiviBro\'s secret', r.s === 403 && D.mode === 'tv', r);
  r = await post({ 'X-TiviBro-Ctl': 'secret' });
  ok('with it, the helper switches', r.s === 200 && JSON.parse(r.b).mode === 'google' && D.mode === 'google', r);
  D.set('tv');
  ok('and back to the TV\'s own puts the TV\'s lookup back', D.mode === 'tv');
  r2.server.close(); srv.s.close();

  // DNS over HTTPS, the standard form (RFC 8484), the next address when the first doesn't answer (discussion #60:
  // 1.1.1.1 blocked, 1.0.0.1 answering).  A local HTTPS server with its own certificate (skipped without openssl).
  const q = D._question('provider.example'), qb = Buffer.from(q.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  ok('the question is a DNS message for one A record', qb.readUInt16BE(4) === 1 && qb.slice(12).toString('latin1').indexOf('provider') > 0 && qb.readUInt16BE(qb.length - 4) === 1);
  const reply = (qq, ip) => { const h = Buffer.from(qq.slice(0, 12)); h[2] = 0x81; h[3] = 0x80; h.writeUInt16BE(2, 6); return Buffer.concat([h, qq.slice(12), Buffer.from([0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 9, 0, 2, 0xc0, 0x0c, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 1, 44, 0, 4].concat(ip))]); };
  const a1 = D._answer(reply(qb, [10, 9, 8, 7]).slice(0)) ;
  ok('the answer is read: the A record past another record, with its TTL', a1 && a1.ip === '10.9.8.7' && a1.ttl === 300, a1);
  let tls = null;
  try {
    const os = require('os'), fs = require('fs'), cp = require('child_process'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-doh-'));
    cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    tls = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { console.log('SKIP DoH server: no openssl'); }
  if (tls) {
    const asked = [];
    const hs = require('https').createServer(tls, (req, res) => {
      const m = /[?&]dns=([A-Za-z0-9_-]+)/.exec(req.url); asked.push(req.url.split('?')[0] + ' ' + req.headers.accept);
      const qq = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      res.writeHead(200, { 'Content-Type': 'application/dns-message' }); res.end(reply(qq, [10, 1, 2, 3]));
    });
    await new Promise((f) => hs.listen(0, '127.0.0.1', f));
    D.set('doh-cloudflare'); D._doh({ hosts: ['127.0.0.2', '127.0.0.1'], port: hs.address().port, path: '/dns-query', ca: tls.cert });
    r = await look('doh.example');
    ok('over HTTPS: the first address refuses, the next one answers', r.a === '10.1.2.3' && asked[0] === '/dns-query application/dns-message', { r, asked });
    D._doh({ hosts: ['127.0.0.1'], port: hs.address().port, path: '/dns-query' });
    r = await look('doh2.example');
    ok('a server whose certificate isn\'t trusted is not believed (the TV\'s DNS instead)', r.a !== '10.1.2.3', r);
    D._doh(null); D.set('tv'); hs.close();
  }
  ok('ControlD and Quad9 can be picked', ['controld', 'controld-uncensored', 'doh-quad9', 'doh-controld', 'doh-controld-uncensored'].every((m) => D.set(m).mode === m));
  D.set('tv');
  console.log(fail ? fail + ' failures' : 'all DNS checks passed');
  process.exit(fail ? 1 : 0);
})();
