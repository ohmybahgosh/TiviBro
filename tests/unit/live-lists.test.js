// The helper's /live/xtream and /live/m3u routes (service/live.js): the channel list shaped on the TV
// with the app's own code (app/js/plshape.js), so the keys match what the app makes itself.
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-live-')); process.env.TIVIBRO_GUIDE_DIR = DIR; process.env.TIVIBRO_KV_DIR = DIR;
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
  // keep: the helper keeps its answer, and saves it as the playlist's cache with the app's few fields
  // in front (issues #24, #25: the app never turns the whole list back into text).
  const raw = (m, u, body, h) => new Promise((res, rej) => { const x = new URL(u); const rq = http.request({ host: x.hostname, port: x.port, path: x.pathname + x.search, method: m, headers: h || {} }, (rs) => { let t = ''; rs.on('data', (d) => t += d); rs.on('end', () => res({ status: rs.statusCode, text: t })); }); rq.on('error', rej); rq.end(body); });
  a = await post(B + '/live/m3u', { u: B + '/x/http/' + U + '/list.m3u', keep: true }, H);
  const id = a.json && a.json.live;
  ok('keep: the answer says which kept copy it is', a.status === 200 && /^[a-z0-9]{6,24}$/.test(id || '') && a.json.channels.length === 3000, a.json && a.json.live);
  ok('and the size in the log is a number now (was NaN KB)', a.json.bytes === Buffer.byteLength(M3U), a.json.bytes);
  ok('the copy is on the TV\'s storage', fs.existsSync(path.join(DIR, 'kv', 'live~' + id + '.json')));
  const extra = { epgUrl: 'http://g/guide.xml', at: 123, sig: 'abc', added: { x: 5 }, fixed: null, m3u: 'http://s/list.m3u' };
  let k = await raw('POST', B + '/kv/put?k=playlist:p9&from=' + id, JSON.stringify(extra), H);
  ok('saved from the kept copy with the app\'s fields', k.status === 200, k.status + ' ' + k.text);
  k = await raw('GET', B + '/kv/get?k=playlist:p9', undefined, H);
  const back = JSON.parse(k.text);
  ok('read back: the whole list and the app\'s fields', back.channels.length === 3000 && JSON.stringify(back.channels) === JSON.stringify(wm.channels) && back.at === 123 && back.sig === 'abc' && back.added.x === 5 && back.m3u === 'http://s/list.m3u' && back.groups.length === wm.groups.length);
  ok('the kept copy is gone once saved', !fs.existsSync(path.join(DIR, 'kv', 'live~' + id + '.json')));
  k = await raw('POST', B + '/kv/put?k=playlist:p9&from=' + id, '{}', H);
  ok('a second save from it: 404 (the app then sends the list itself)', k.status === 404);
  k = await raw('POST', B + '/kv/put?k=playlist:p9&from=' + id, '{}');
  ok('only TiviBro can', k.status === 403);
  a = await post(B + '/live/xtream', { u: api('get_live_streams'), uc: api('get_live_categories'), keep: true }, H);
  ok('Xtream keeps its answer too', a.status === 200 && !!a.json.live && fs.existsSync(path.join(DIR, 'kv', 'live~' + a.json.live + '.json')));
  a = await post(B + '/live/m3u', { u: B + '/x/http/' + U + '/list.m3u' }, H);
  ok('without keep: nothing kept, no id', a.status === 200 && !a.json.live);
  // A list bigger than a TV can hold because it carries a whole film and series library (issue #26):
  // its live channels are kept, the movies and episodes left out and counted.  Small lists stay whole.
  let big = '#EXTM3U\n', live = 0;
  for (let i = 0; i < PlShape.BIG + 50; i++) {
    const kind = i % 40 === 0 ? 'live' : i % 2 ? 'series' : 'movie';
    if (kind === 'live') live++;
    big += '#EXTINF:-1 tvg-id="b' + i + '" group-title="' + (kind === 'live' ? 'TV' : 'Séries | ' + (i % 7)) + '",B ' + i + '\nhttp://p.example:80/' + (kind === 'live' ? 'u/p/' + i : kind + '/u/p/' + i + '.mp4') + '\n';
  }
  const bp = PlShape.parseM3U(big);
  ok('a huge list with a film library keeps its live channels only', bp.channels.length === live && bp.vodSkipped === PlShape.BIG + 50 - live && bp.groups.length === 1, bp.channels.length + ' ' + bp.vodSkipped + ' ' + bp.groups.length);
  const sm = PlShape.parseM3U('#EXTM3U\r\n#EXTINF:-1 group-title="TV",A\r\nhttp://x/1\r\n#EXTINF:-1 group-title="Films",F\r\nhttp://x/movie/u/p/2.mp4\r\n');
  ok('a small list keeps its movies, as before (and \\r\\n lines)', sm.channels.length === 2 && sm.vodSkipped === 0 && sm.channels[0].url === 'http://x/1' && sm.channels[0].n === 'A');
  // With { vod: true } (the helper): films and series become a library, not channels.
  const lib = PlShape.parseM3U('#EXTM3U\n#EXTINF:-1 group-title="TV",News\nhttp://p.example:80/u/p/1\n' +
    '#EXTINF:-1 tvg-logo="http://i/f.jpg" group-title="Films",Film (2020)\nhttp://p.example:80/movie/u/p/9.mkv\n' +
    '#EXTINF:-1 group-title="Séries | Drama",Show S01 E02\nhttp://p.example:80/series/u/p/22.mp4\n#EXTINF:-1 group-title="Séries | Drama",Show S01 E01\nhttp://p.example:80/series/u/p/21.mp4\n' +
    '#EXTINF:-1 group-title="Séries | Legendado",Show S01E01\nhttp://p.example:80/series/u/p/41.mp4\n', { vod: true });
  const v = lib.vod, u = v.urls;
  ok('films and series leave the channel list', lib.channels.length === 1 && lib.channels[0].n === 'News');
  ok('a film: its row and its link', v.movie.rows.length === 1 && v.movie.rows[0][1] === 'Film (2020)' && v.movie.rows[0][2] === 'http://i/f.jpg' && v.movie.rows[0][4] === 'mkv' && u.p[u.m[v.movie.rows[0][0]][0]] + u.m[v.movie.rows[0][0]][1] === 'http://p.example:80/movie/u/p/9.mkv');
  ok('episodes gather under their show, one show per group', v.series.rows.length === 2 && v.series.rows[0][1] === 'Show' && u.s[v.series.rows[0][0]].map((e) => e[0] + '.' + e[1] + '=' + e[3]).join() === '1.2=22.mp4,1.1=21.mp4' && u.s[v.series.rows[1][0]].length === 1);
  ok('links share their prefix', u.p.length === 2);
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all live list tests passed');
  process.exit(fail ? 1 : 0);
})();
