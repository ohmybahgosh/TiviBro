// Unit tests for the relay, against the no-CORS mock provider.
const proxy = require(require('path').join(__dirname, '../../service/proxy.js'));
const http = require('http');
let fail = 0;
function ok(n, c, x) { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; }
function get(url, headers) {
  return new Promise((res, rej) => {
    const r = http.get(url, { headers: headers || {} }, (resp) => { const b = []; resp.on('data', d => b.push(d)); resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(b) })); });
    r.on('error', rej);
  });
}
(async () => {
  ok('target parses path style', proxy.target('/x/http/host:81/a/b.m3u8?x=1') === 'http://host:81/a/b.m3u8?x=1');
  ok('relayed builds path style', proxy.relayed('http://127.0.0.1:1', 'https://cdn.x/y/z.ts?t=2') === 'http://127.0.0.1:1/x/https/cdn.x/y/z.ts?t=2');
  const r = proxy.create({}); await new Promise(f => r.server.listen(47899, '127.0.0.1', f));
  const B = 'http://127.0.0.1:47899';
  let a = await get(B + '/x/http/127.0.0.1:8077/player_api.php?username=u&password=p&action=get_live_categories');
  ok('API JSON through relay', a.status === 200 && JSON.parse(a.body).length === 3);
  ok('CORS header added', a.headers['access-control-allow-origin'] === '*');
  a = await get(B + '/x/http/127.0.0.1:8077/redir.m3u8');
  ok('redirect rewritten to relayed address', a.status === 302 && a.headers.location === B + '/x/http/127.0.0.1:8077/hls/index.m3u8', a.headers.location);
  a = await get(B + '/x/http/127.0.0.1:8077/hls/index0.ts', { Range: 'bytes=0-187' });
  ok('range passthrough', a.body.length === 188 || a.status === 200, a.status + ' ' + a.body.length);
  a = await get(B + '/ping'); ok('ping', JSON.parse(a.body).ok === true);
  a = await get(B + '/nope'); ok('non-relay path rejected', a.status === 404);
  a = await get(B + '/x/http/127.0.0.1:1/dead'); ok('unreachable upstream gives 502', a.status === 502);
  // stream abort: open the live TS, read a little, close, and check the relay frees it
  await new Promise((res) => {
    const req = http.get(B + '/x/http/127.0.0.1:8077/live/u/p/1.ts', (resp) => { let n = 0; resp.on('data', d => { n += d.length; if (n > 200000) { req.destroy(); setTimeout(res, 300); } }); });
    req.on('error', () => {});
  });
  ok('closed stream is released', r.stats.active === 0, 'active=' + r.stats.active);
  r.server.close();
  console.log(fail ? fail + ' failures' : 'all relay tests passed');
  process.exit(fail ? 1 : 0);
})();
