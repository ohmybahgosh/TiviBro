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
  ok('a "|" that is part of the address stays', list[4].url === 'http://tv.example/a|b/five.ts?x=1|2', list[4].url);

  const up = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(req.url + ' ' + (req.headers['user-agent'] || '')); });
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

  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all M3U address option tests passed');
  process.exit(fail ? 1 : 0);
})();
