// M3U addresses with request options after a "|" (the Kodi and TiviMate way to give a channel
// its own User-Agent): the options are taken off the address, and the channel's User-Agent goes
// to the provider through the helper.  Runs the real plshape.js, net.js and helper against its
// own tiny upstream server, no mock provider needed (issue #78).
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
const PlShape = require(path.join(__dirname, '../../app/js/plshape.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const get = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));

async function netFor(port, playlist) {
  const ctx = { console, fetch, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Promise,
    localStorage: { getItem: k => (k === 'tivibro.devRelay' ? String(port) : null) },
    Log: { info() {}, warn() {}, error() {}, debug() {} },
    Store: { settings: { network: 'auto' }, playlist: playlist },
    btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/net.js'), 'utf8') + '\nthis.Net = Net;', ctx);
  await ctx.Net.start();
  return ctx.Net;
}

(async () => {
  const list = PlShape.parseM3U([
    '#EXTM3U',
    '#EXTINF:-1 group-title="TV",One', 'http://tv.example/one.ts|User-Agent=viu',
    '#EXTINF:-1 group-title="TV",Two', 'http://tv.example/two.ts|User-Agent=My%20Agent%2F1.0&Referer=http://tv.example/',
    '#EXTINF:-1 group-title="TV",Three', 'http://tv.example/three.ts|referer=http://tv.example/',
    '#EXTINF:-1 group-title="TV",Four', 'http://tv.example/four.ts',
    '#EXTINF:-1 group-title="TV",Five', 'http://tv.example/a|b/five.ts?x=1|2'
  ].join('\n')).channels;
  ok('the options are taken off the address', list[0].url === 'http://tv.example/one.ts', list[0].url);
  ok('and the channel keeps its User-Agent', list[0].ua === 'viu', list[0].ua);
  ok('a User-Agent written with % codes is read, other options are dropped', list[1].url === 'http://tv.example/two.ts' && list[1].ua === 'My Agent/1.0', list[1].url + ' ' + list[1].ua);
  ok('options without a User-Agent: just the address', list[2].url === 'http://tv.example/three.ts' && !('ua' in list[2]), JSON.stringify(list[2]));
  ok('a plain address is untouched, with no User-Agent field', list[3].url === 'http://tv.example/four.ts' && !('ua' in list[3]));
  ok('Referer goes with the channel (issue #78 follow-up)', list[1].hdr && list[1].hdr.Referer === 'http://tv.example/' && list[2].hdr && list[2].hdr.Referer === 'http://tv.example/', JSON.stringify([list[1].hdr, list[2].hdr]));
  ok('a plain address has no headers field', !('hdr' in list[3]));
  ok('a "|" that is part of the address stays', list[4].url === 'http://tv.example/a|b/five.ts?x=1|2', list[4].url);

  const up = http.createServer((req, res) => {
    if (req.method === 'POST') { let n = 0; req.on('data', (d) => n += d.length); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('POST ' + req.url + ' ' + n + ' ' + (req.headers['user-agent'] || '') + (req.headers['x-custom-data'] ? ' X=' + req.headers['x-custom-data'] : '') + (req.headers.host && !/^127\.0\.0\.1:/.test(req.headers.host) ? ' HOST=' + req.headers.host : '')); }); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(req.url + ' ' + (req.headers['user-agent'] || '') + (req.headers.referer ? ' R=' + req.headers.referer : '') + (req.headers.origin ? ' O=' + req.headers.origin : '') + (req.headers.cookie ? ' C=' + req.headers.cookie : '')); });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = 'http://127.0.0.1:' + up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const pl = { id: 'p1', type: 'm3u', m3u: U + '/list.m3u', ua: 'PlaylistAgent' };
  const Net = await netFor(r.server.address().port, pl);

  const ch = PlShape.parseM3U('#EXTM3U\n#EXTINF:-1,One\n' + U + '/one.ts|User-Agent=viu\n#EXTINF:-1,Two\n' + U + '/two.ts\n').channels;
  let a = await get(Net.wrap(ch[0].url, { pl: pl, ua: ch[0].ua }));
  ok('the provider gets the clean address and the channel\'s User-Agent', a.status === 200 && a.body === '/one.ts viu', a.body);
  a = await get(Net.wrap(ch[1].url, { pl: pl, ua: ch[1].ua }));
  ok('a channel without its own keeps the playlist\'s User-Agent', a.body === '/two.ts PlaylistAgent', a.body);

  const ch2 = PlShape.parseM3U('#EXTM3U\n#EXTINF:-1,Three\n' + U + '/three.ts|User-Agent=viu&Referer=https%3A%2F%2Fsite.example%2Fplay&Origin=https://site.example&Cookie=x=1\n').channels;
  ok('Origin is kept, anything else (a cookie) is not', ch2[0].hdr && ch2[0].hdr.Origin === 'https://site.example' && !ch2[0].hdr.Cookie, JSON.stringify(ch2[0].hdr));
  a = await get(Net.wrap(ch2[0].url, { pl: pl, ua: ch2[0].ua, hdr: ch2[0].hdr }));
  ok('the helper sends the channel\'s Referer and Origin, nothing else', a.body === '/three.ts viu R=https://site.example/play O=https://site.example', a.body);
  ok('and the address unwraps back to the provider\'s', Net.unwrap(Net.wrap(ch2[0].url, { pl: pl, hdr: ch2[0].hdr })) === ch2[0].url);

  // A DRM licence request (a DASH channel's #KODIPROP licence server) is a POST: the helper relays its body.
  const lic = await new Promise((done, bad) => {
    const body = Buffer.from([1, 2, 3, 4, 5, 250]);
    const q = http.request(Net.wrap(U + '/license?id=2', { pl: pl, ua: 'LicAgent' }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } }, (rs) => { let b = ''; rs.on('data', (d) => b += d); rs.on('end', () => done({ status: rs.statusCode, body: b })); });
    q.on('error', bad); q.end(body);
  });
  ok('a licence request is relayed as a POST with its body and the User-Agent', lic.status === 200 && lic.body === 'POST /license?id=2 6 LicAgent', lic.body);

  // A licence server's own headers (license_key "URL|X-Custom-Data=..."): carried by the helper, not the browser.
  const lic2 = await new Promise((done, bad) => {
    const q = http.request(Net.wrap(U + '/license?id=3', { pl: pl, ua: 'LicAgent', hdr: { H: { 'X-Custom-Data': 'token=abc', Host: 'evil.example' } } }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 2 } }, (rs) => { let b = ''; rs.on('data', (d) => b += d); rs.on('end', () => done({ status: rs.statusCode, body: b })); });
    q.on('error', bad); q.end(Buffer.from([7, 8]));
  });
  ok('the licence server\'s own header goes through the helper, a Host header does not', lic2.status === 200 && lic2.body === 'POST /license?id=3 2 LicAgent X=token=abc', lic2.body);

  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all M3U address option tests passed');
  process.exit(fail ? 1 : 0);
})();
