// The helper's /live/xtream and /live/m3u routes (service/live.js): the channel list shaped on the TV
// with the app's own code (app/js/plshape.js), so the keys match what the app makes itself.
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
const PlShape = require(path.join(__dirname, '../../app/js/plshape.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fail++; };
const post = (url, body, h) => new Promise((res, rej) => {
  const u = new URL(url), b = JSON.stringify(body);
  const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }, h || {}) }, (r) => {
    let t = ''; r.on('data', d => t += d); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(t); } catch (e) { return null; } })() }));
  });
  q.on('error', rej); q.end(b);
});
const CATS = [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }];
const STREAMS = [];
for (let i = 0; i < 20000; i++) STREAMS.push({ num: i + 1, name: 'Channel ' + i, stream_id: 1000 + i, stream_icon: 'http://img/' + i + '.png', epg_channel_id: 'c' + i + '.us', category_id: i % 3 ? '1' : '9', tv_archive: i % 5 ? 0 : 1, tv_archive_duration: 4, added: '1', custom_sid: '', direct_source: 'x'.repeat(80) });
let M3U = '#EXTM3U url-tvg="http://g/guide.xml"\n';
for (let i = 0; i < 3000; i++) M3U += '#EXTINF:-1 tvg-id="m' + i + '" tvg-logo="http://l/' + i + '.png" group-title="' + (i % 2 ? 'Films' : 'News') + '",Name ' + (i % 1500) + '\nhttp://s/' + i + '.ts\n';
(async () => {
  const up = http.createServer((req, res) => {
    if (/notm3u/.test(req.url)) { res.writeHead(200); return res.end('<html>nope</html>'); }
    if (/list\.m3u/.test(req.url)) { res.writeHead(200); return res.end(M3U); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(/get_live_categories/.test(req.url) ? CATS : STREAMS));
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({ ctl: 's3' }); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port, H = { 'X-TiviBro-Ctl': 's3' };
  const api = a => B + '/x/http/' + U + '/player_api.php?username=u&password=p&action=' + a;
  let a = await post(B + '/live/xtream', { u: api('get_live_streams'), uc: api('get_live_categories') }, H);
  const want = PlShape.xtream(CATS, STREAMS);
  ok('Xtream: the helper\'s channel list is the app\'s own, key for key', a.status === 200 && JSON.stringify(a.json.channels) === JSON.stringify(want.channels) && JSON.stringify(a.json.groups) === JSON.stringify(want.groups), a.status);
  ok('and much smaller than the provider\'s answer', JSON.stringify(a.json).length < JSON.stringify(STREAMS).length * 0.6);
  a = await post(B + '/live/m3u', { u: B + '/x/http/' + U + '/list.m3u' }, H);
  const wm = PlShape.parseM3U(M3U);
  ok('M3U: the same channels and keys as the app parses, duplicates too', a.status === 200 && JSON.stringify(a.json.channels) === JSON.stringify(wm.channels) && a.json.epgUrl === 'http://g/guide.xml', a.status);
  ok('the duplicate names got their own keys', new Set(a.json.channels.map(c => c.k)).size === 3000);
  a = await post(B + '/live/m3u', { u: B + '/x/http/' + U + '/notm3u' }, H);
  ok('not a playlist: said so, for the app\'s message', a.status === 422 && a.json.kind === 'parse');
  a = await post(B + '/live/m3u', { u: 'http://' + U + '/list.m3u' }, H);
  ok('only relay addresses on this helper', a.status === 400);
  a = await post(B + '/live/xtream', { u: api('get_live_streams'), uc: api('get_live_categories') });
  ok('only TiviBro can ask (the lists can hold logins)', a.status === 403, a.status);
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all live list tests passed');
  process.exit(fail ? 1 : 0);
})();
