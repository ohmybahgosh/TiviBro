/* A small Stalker (Ministra) portal for tests (service/stalker.js): handshake, get_profile, genres, the
   channel list, create_link and the short guide, answering only a registered MAC with its token, as a
   portal does.  Links point at the mock provider's streams.
     node tests/mock/stalker_mock.js            (port 8095; STALKER_PORT, MOCK=<the mock provider>)
   Or require() it: create({ mac, stream, oneToken }) -> { server, seen } */
'use strict';
var http = require('http'), url = require('url');

function create(o) {
  o = o || {};
  // oneToken: a new token on every handshake, the older ones refused from then on (as many portals do).
  var MAC = (o.mac || '00:1A:79:00:00:01').toUpperCase(), TOKEN = 'TOK' + Date.now().toString(36), n = 0;
  var stream = o.stream || ((process.env.MOCK || 'http://127.0.0.1:8077') + '/live/demo/demo/1.ts');
  var seen = { ua: '', xua: '', actions: [], links: 0, profile: false, refused: 0 };
  var chans = [
    { id: '101', name: 'Portal News', number: '1', cmd: 'ffmpeg http://localhost/ch/101', tv_genre_id: '1', logo: '', xmltv_id: 'news.portal', tv_archive: '1', tv_archive_duration: '168' },
    { id: '102', name: 'Portal Sports', number: '2', cmd: 'ffmpeg http://localhost/ch/102', tv_genre_id: '2', logo: '', xmltv_id: '' },
    { id: '103', name: 'Portal Movies', number: '3', cmd: 'auto http://localhost/ch/103', tv_genre_id: '2', logo: '', xmltv_id: '' }
  ];
  // Movies and shows: 30 titles in two categories, sent 14 to a page as portals do; titles 5 and 20 are shows.
  var vods = [];
  for (var v = 1; v <= 30; v++) vods.push({ id: String(500 + v), name: 'Portal Title ' + v, category_id: v <= 15 ? '10' : '11', cmd: v === 3 ? 'eyJ0eXBlIjoibW92aWUiLCJpZCI6NTAzfQ==' : '/media/file_' + (500 + v) + '.mpg',
    screenshot_uri: 'http://img.example/' + v + '.jpg', rating_imdb: '7.' + (v % 10), added: '2026-10-' + ('0' + (v % 28 + 1)).slice(-2) + ' 12:00:00', is_series: v === 5 || v === 20 ? '1' : '0',
    year: '2020', description: 'About title ' + v, director: 'A. Director', actors: 'Someone', genres_str: 'Drama', time: 95 });
  var now0 = Math.floor(Date.now() / 1000);
  function page(list, p, res) { var per = 14, pg = Math.max(1, +p || 1); seen.vodPages = (seen.vodPages || 0) + 1; js(res, { total_items: list.length, max_page_items: per, data: list.slice((pg - 1) * per, pg * per) }); }
  function js(res, v) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ js: v })); }
  var server = http.createServer(function (req, res) {
    var u = url.parse(req.url, true), q = u.query;
    if (!/\/server\/load\.php$/.test(u.pathname)) { res.writeHead(404); return res.end('no portal here'); }
    seen.ua = req.headers['user-agent'] || ''; seen.xua = req.headers['x-user-agent'] || '';
    seen.actions.push(q.action);
    var mac = decodeURIComponent((/mac=([^;]+)/.exec(req.headers.cookie || '') || [])[1] || '').toUpperCase();
    if (mac !== MAC) { seen.refused++; res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('Authorization failed.'); }
    if (q.action === 'handshake') { seen.handshakes = (seen.handshakes || 0) + 1; if (o.oneToken) TOKEN = 'TOK' + (++n); return js(res, { token: TOKEN, random: 'x' }); }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) { seen.refused++; res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('Authorization failed.'); }
    if (q.action === 'get_profile') { seen.profile = true; return js(res, { id: 1, status: 0, name: 'box' }); }
    if (q.action === 'get_genres') return js(res, [{ id: '*', title: 'All' }, { id: '1', title: 'News' }, { id: '2', title: 'Sports' }]);
    if (q.action === 'get_all_channels') return js(res, { total_items: chans.length, data: chans });
    if (q.type === 'vod' && q.action === 'get_categories') return js(res, [{ id: '*', title: 'All' }, { id: '10', title: 'Films' }, { id: '11', title: 'More films' }]);
    if (q.type === 'vod' && q.action === 'get_ordered_list' && q.movie_id) {
      if (q.movie_id !== '505' && q.movie_id !== '520') return js(res, { total_items: 0, data: [] });
      return js(res, { total_items: 2, data: [{ id: q.movie_id + ':1', name: 'Season 1', series: [1, 2, 3], cmd: 'eyJzZWFzb24iOjF9' }, { id: q.movie_id + ':2', name: 'Season 2', series: [1, 2], cmd: 'eyJzZWFzb24iOjJ9' }] });
    }
    if (q.type === 'vod' && q.action === 'get_ordered_list') return page(vods.filter(function (x) { return q.category === '*' || !q.category || x.category_id === q.category; }), q.p, res);
    if (q.type === 'vod' && q.action === 'create_link') { seen.vodLinks = (seen.vodLinks || []).concat([q.cmd + '|' + (q.series || '')]); return js(res, { id: 1, cmd: 'ffmpeg http://127.0.0.1:1/vod/' + encodeURIComponent(q.cmd) + '.mp4?series=' + (q.series || '') }); }
    if (q.type === 'epg' && q.action === 'get_simple_data_table') {
      seen.epgDays = (seen.epgDays || []).concat([q.date]);
      var day = Date.parse(q.date + 'T00:00:00Z') / 1000, out = [];
      for (var h = 0; h < 24; h++) { var st = day + h * 3600; if (st < now0 - 7 * 86400 || st > now0) continue; out.push({ id: '9' + st, name: 'Archived ' + h, start_timestamp: String(st), stop_timestamp: String(st + 3600), mark_archive: 1 }); }
      return js(res, { total_items: out.length, max_page_items: 50, data: out });
    }
    if (q.type === 'tv_archive' && q.action === 'create_link') { seen.archive = q.cmd; return js(res, { id: 1, cmd: 'ffmpeg http://127.0.0.1:1/archive/' + encodeURIComponent(q.cmd) + '.ts' }); }
    if (q.action === 'create_link') { seen.links++; seen.lastCmd = q.cmd; return js(res, { id: 1, cmd: 'ffmpeg ' + stream }); }
    if (q.action === 'get_short_epg') {
      var now = Math.floor(Date.now() / 1000);
      return js(res, [0, 1, 2].map(function (i) { return { id: i, name: 'Show ' + (i + 1) + ' on ' + q.ch_id, descr: 'About show ' + (i + 1), start_timestamp: String(now - 1800 + i * 3600), stop_timestamp: String(now + 1800 + i * 3600) }; }));
    }
    js(res, null);
  });
  return { server: server, seen: seen, MAC: MAC };
}

if (require.main === module) {
  var m = create(), port = +process.env.STALKER_PORT || 8095;
  m.server.listen(port, '127.0.0.1', function () { console.log('Mock Stalker portal on http://127.0.0.1:' + port + '/stalker_portal/c/  MAC ' + m.MAC); });
}
module.exports = { create: create };
