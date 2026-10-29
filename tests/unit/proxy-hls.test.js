// HLS playlists through the helper.  Many Xtream panels answer /live/u/p/1.m3u8 with a redirect to
// a tokenized edge server whose playlist lists segments as root-relative links ("/hlsr/...").
// Relative to the relayed address those resolve to 127.0.0.1/hlsr/... and fail with 404, so the
// helper rewrites root-relative and absolute links to their relayed form.  Found on a real provider.
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 200) : '')); if (!c) fail++; };
const get = (url, hdr) => new Promise(res => http.get(url, { headers: hdr || {} }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })); }).on('error', e => res({ status: 0, body: e.message })));
async function follow(url) { for (let i = 0; i < 5; i++) { const r = await get(url); if (r.status >= 300 && r.status < 400) url = r.headers.location; else return Object.assign(r, { url }); } }

(async () => {
  let edge;
  const big = '#EXTM3U\n' + '#EXTINF:-1 tvg-id="a",Channel\nhttp://example.invalid/1.ts\n'.repeat(60000);   // an IPTV list, about 3 MB
  const panel = http.createServer((q, s) => {
    if (q.url === '/live/u/p/1.m3u8') { s.writeHead(302, { Location: 'http://' + edge + '/live/u/p/1.m3u8?token=abc' }); return s.end(); }
    if (q.url === '/get.php') { s.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }); return s.end(big); }
    s.writeHead(404); s.end();
  });
  const edgeSrv = http.createServer((q, s) => {
    if (q.url.indexOf('/live/u/p/1.m3u8') === 0) {
      s.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return s.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="/keys/k1"\n#EXTINF:6.0,\n/hlsr/seg7.ts?t=1\n#EXTINF:6.0,\nseg8.ts\n#EXTINF:6.0,\nhttp://' + edge + '/abs/seg9.ts\n');
    }
    if (q.url === '/master.m3u8') { s.writeHead(200, { 'Content-Type': 'application/x-mpegurl' }); return s.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n'); }
    if (/^\/(hlsr|abs|keys|live)\//.test(q.url)) { s.writeHead(200); return s.end('SEG ' + q.url); }
    s.writeHead(404); s.end();
  });
  await new Promise(f => panel.listen(0, '127.0.0.1', f));
  await new Promise(f => edgeSrv.listen(0, '127.0.0.1', f));
  edge = '127.0.0.1:' + edgeSrv.address().port;
  const P = '127.0.0.1:' + panel.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;

  const pl = await follow(B + '/ua/YWJj/x/http/' + P + '/live/u/p/1.m3u8');
  ok('playlist arrives after the redirect', pl.status === 200 && /#EXTM3U/.test(pl.body), pl.status);
  const lines = pl.body.split('\n');
  const seg7 = lines.find(l => /seg7/.test(l)), seg8 = lines.find(l => /seg8/.test(l)), seg9 = lines.find(l => /seg9/.test(l)), key = lines.find(l => /EXT-X-KEY/.test(l));
  ok('a root-relative segment becomes a relayed address on the edge server', seg7 === B + '/ua/YWJj/x/http/' + edge + '/hlsr/seg7.ts?t=1', seg7);
  ok('a relative segment is left alone', seg8 === 'seg8.ts', seg8);
  ok('an absolute segment is relayed too', seg9 === B + '/ua/YWJj/x/http/' + edge + '/abs/seg9.ts', seg9);
  ok('a key URI is relayed', key.indexOf('URI="' + B + '/ua/YWJj/x/http/' + edge + '/keys/k1"') > 0, key);
  const s7 = await get(new URL(seg7, pl.url).href), s8 = await get(new URL(seg8, pl.url).href);
  ok('and both segments load', s7.body === 'SEG /hlsr/seg7.ts?t=1' && s8.body === 'SEG /live/u/p/seg8.ts', s7.body + ' | ' + s8.body);

  const m = await get(B + '/x/http/' + edge + '/master.m3u8');
  ok('a master playlist with relative links passes unchanged', m.body === '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n', m.body);
  const iptv = await get(B + '/x/http/' + P + '/get.php');
  ok('a large IPTV channel list is not touched', iptv.status === 200 && iptv.body.length === big.length && iptv.body === big, iptv.body.length + ' of ' + big.length);
  ok('rewriteHls ignores channel lists', proxy.rewriteHls('#EXTM3U\n#EXTINF:-1,A\nhttp://x/1.ts\n', 'http://p/get.php', B) === null);

  r.server.close(); panel.close(); edgeSrv.close();
  console.log(fail ? fail + ' failures' : 'all HLS relay tests passed');
  process.exit(fail ? 1 : 0);
})();
