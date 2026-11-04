// The helper keeps DNS answers for a minute, so channel changes don't wait for the TV's resolver
// each time, and forgets a host when connecting to it fails.  Counts the lookups it makes.
const http = require('http'), path = require('path'), dns = require('dns');
let lookups = [];
const realLookup = dns.lookup;
dns.lookup = function (host, opts, cb) { lookups.push(host + (opts && opts.all ? ' (all)' : '')); return realLookup.apply(dns, arguments); };
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const get = (url) => new Promise((res) => http.get(url, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', e => res({ status: 0, body: e.message })));
(async () => {
  const up = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' }); res.end('ok'); });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const port = up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;
  // "localhost" needs a lookup; 127.0.0.1 would not.
  let a = await get(B + '/x/http/localhost:' + port + '/one');
  ok('relays through a name that needs a lookup', a.status === 200 && a.body === 'ok', a.status + ' ' + a.body);
  const first = lookups.filter(h => /^localhost/.test(h)).length;
  for (let i = 0; i < 4; i++) await get(B + '/x/http/localhost:' + port + '/again' + i);
  const after = lookups.filter(h => /^localhost/.test(h)).length;
  ok('four more channel starts reuse the answer', first >= 1 && after === first, first + ' then ' + after + ' lookups  ' + lookups.join(', '));
  // A refused connection forgets the host, so a moved provider is looked up again.
  up.close(); await new Promise(f => setTimeout(f, 50));
  a = await get(B + '/x/http/localhost:' + port + '/gone');
  ok('a refused connection is reported', a.status === 502, a.status + ' ' + a.body.slice(0, 50));
  await get(B + '/x/http/localhost:' + port + '/gone2');
  const final = lookups.filter(h => /^localhost/.test(h)).length;
  ok('and the host is looked up again afterwards', final > after, after + ' then ' + final);
  // An answer older than a minute is still used at once, and a fresh one is asked for in the background.
  const D = proxy._dns;
  await new Promise(f => D.lookup('localhost', {}, f));
  Object.keys(D.cache).forEach(k => { if (/^localhost\|0\|0$/.test(k)) D.cache[k].t = Date.now() - 5 * 60000; });
  const n0 = lookups.length, t0 = Date.now();
  const ans = await new Promise(f => D.lookup('localhost', {}, (e, a) => f({ e, a, ms: Date.now() - t0, asked: lookups.length - n0 })));
  ok('an older answer is used at once', !ans.e && ans.a && ans.ms < 50, JSON.stringify(ans));
  ok('and refreshed in the background', ans.asked === 1, ans.asked);
  await new Promise(f => setTimeout(f, 100));
  const fresh = D.cache['localhost|0|0'];
  ok('the refreshed answer replaces it', fresh && Date.now() - fresh.t < 5000 && !fresh.refreshing, fresh && (Date.now() - fresh.t));
  Object.keys(D.cache).forEach(k => { if (/^localhost\|0\|0$/.test(k)) D.cache[k].t = Date.now() - 2 * 3600e3; });
  const n1 = lookups.length;
  await new Promise(f => D.lookup('localhost', {}, f));
  ok('an answer older than half an hour is asked for again first', lookups.length === n1 + 1);
  r.server.close();
  console.log(fail ? fail + ' failures' : 'all helper DNS tests passed');
  process.exit(fail ? 1 : 0);
})();
