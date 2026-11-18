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
  for (var v = 1; v <= (+o.titles || 30); v++) vods.push({ id: String(500 + v), name: 'Portal Title ' + v, category_id: v <= 15 ? '10' : '11', cmd: o.xtreamVod ? Buffer.from('{"type":"movie","stream_id":"' + (500 + v) + '","stream_source":null}').toString('base64') : v === 3 ? 'eyJ0eXBlIjoibW92aWUiLCJpZCI6NTAzfQ==' : '/media/file_' + (500 + v) + '.mpg',
    screenshot_uri: 'http://img.example/' + v + '.jpg', rating_imdb: '7.' + (v % 10), added: '2026-10-' + ('0' + (v % 28 + 1)).slice(-2) + ' 12:00:00', is_series: v === 5 || v === 20 ? '1' : '0',
    year: '2020', description: 'About title ' + v, director: 'A. Director', actors: 'Someone', genres_str: 'Drama', time: 95 });
  /* o.series: a portal with a shows module of its own (type=series, issue #113): 40 shows in two categories,
     posters as paths on the portal.  o.limit: answer HTTP 429 to that many requests after the sign-in. */
  var shows = [];
  for (var w = 1; w <= 40; w++) shows.push({ id: String(900 + w), name: 'Serial ' + w, category_id: w <= 30 ? '70' : '71', cmd: '', screenshot_uri: '/stalker_portal/screenshots/' + w + '.jpg', added: '2026-10-01 12:00:00', year: '2024', description: 'About serial ' + w });
  var limit = +o.limit || 0;
  var now0 = Math.floor(Date.now() / 1000);
  // o.pageMs: every page after the first that slow (a big portal, issue #118); o.titles: that many movies.
  function page(list, p, res) { var per = 14, pg = Math.max(1, +p || 1); seen.vodPages = (seen.vodPages || 0) + 1; if (o.pageMs && pg > 1) return setTimeout(function () { js(res, { total_items: list.length, max_page_items: per, data: list.slice((pg - 1) * per, pg * per) }); }, o.pageMs); js(res, { total_items: list.length, max_page_items: per, data: list.slice((pg - 1) * per, pg * per) }); }
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
    if (limit > 0 && seen.profile && q.action !== 'handshake' && q.action !== 'get_profile') { limit--; seen.limited = (seen.limited || 0) + 1; res.writeHead(429, { 'Retry-After': '1' }); return res.end('slow down'); }
    if (o.series && q.type === 'series' && q.action === 'get_categories') return js(res, [{ id: '*', title: 'All' }, { id: '70', title: 'HINDI | TV SERIALS' }, { id: '71', title: 'URDU | TV SERIALS' }]);
    if (o.series && q.type === 'series' && q.action === 'get_ordered_list' && q.movie_id && q.movie_id !== '0') return js(res, { total_items: 1, data: [{ id: q.movie_id + ':1', name: 'Season 1', series: [1, 2], cmd: 'c2Vhc29uMQ==' }] });
    /* o.genreStrict (issue #118): a category's shows only with genre=* (genre=<the category> finds none). */
    if (o.series && q.type === 'series' && q.action === 'get_ordered_list') { seen.seriesPages = (seen.seriesPages || 0) + 1; seen.seriesGenres = (seen.seriesGenres || []).concat([q.genre]); if (o.genreStrict && q.category !== '*' && q.genre !== '*') return page([], q.p, res); return page(shows.filter(function (x) { return q.category === '*' || !q.category || x.category_id === q.category; }), q.p, res); }
    if (q.type === 'vod' && q.action === 'get_ordered_list' && q.movie_id && q.movie_id !== '0') {
      // o.files (issue #118): a movie past 525 plays only from its own file's command (newer portals).
      // A file row with protocol "custom" has a raw address; it plays as "/media/file_<its id>.mpg".
      if (o.files && +q.movie_id > 525) return js(res, { total_items: 2, data: [{ id: '8' + q.movie_id, name: 'subs', cmd: 'http://h.example/x.srt' }, { id: '9' + q.movie_id, name: 'HD', protocol: 'custom', cmd: 'http://storage.example/raw/' + q.movie_id + '.mkv' }] });
      if (q.movie_id !== '505' && q.movie_id !== '520') return js(res, { total_items: 0, data: [] });
      return js(res, { total_items: 2, data: [{ id: q.movie_id + ':1', name: 'Season 1', series: [1, 2, 3], cmd: 'eyJzZWFzb24iOjF9' }, { id: q.movie_id + ':2', name: 'Season 2', series: [1, 2], cmd: 'eyJzZWFzb24iOjJ9' }] });
    }
    if (q.type === 'vod' && q.action === 'get_ordered_list') return page(vods.filter(function (x) { return q.category === '*' || !q.category || x.category_id === q.category; }), q.p, res);
    /* xtreamVod: a portal built on an Xtream panel (issue #118): its movies' commands are base64 JSON with the
       stream_id, and "/media/file_<id>.mpg" gets no link ("nothing_to_play"), as do titles past 520. */
    if (o.xtreamVod && q.type === 'vod' && q.action === 'create_link') {
      seen.vodLinks = (seen.vodLinks || []).concat([q.cmd + '|' + (q.series || '')]);
      var sid = ''; try { sid = String(JSON.parse(Buffer.from(String(q.cmd), 'base64').toString('utf8')).stream_id || ''); } catch (e) {}
      var fm = /^\/media\/file_9(\d+)\.mpg$/.exec(String(q.cmd));
      if (o.files && fm) return js(res, { id: 1, cmd: 'ffmpeg http://127.0.0.1:1/movie/u/p/' + fm[1] + '.mp4' });
      if (!sid || +sid > 520) return js(res, { id: 1, cmd: '/media/file_' + (sid || '0') + '.mpg', error: 'nothing_to_play' });
      return js(res, { id: 1, cmd: 'ffmpeg http://127.0.0.1:1/movie/u/p/' + sid + '.mp4' });
    }
    // o.vodHls (issue #118): movie links that are HLS playlists.
    if (o.vodHls && q.type === 'vod' && q.action === 'create_link') { seen.vodLinks = (seen.vodLinks || []).concat([q.cmd]); return js(res, { id: 1, cmd: 'http://127.0.0.1:1/5e9ab/playlist.m3u8?token=t&vtt_mode=standard' }); }
    /* As stalker_portal's Master::play: a forced_storage that names no storage leaves none ("undefined" did, issue #118);
       o.vodAds: the answer is a list, the ad first. */
    if (q.type === 'vod' && q.action === 'create_link' && q.forced_storage) return js(res, { id: 0, cmd: '', error: 'nothing_to_play' });
    if (o.vodAds && q.type === 'vod' && q.action === 'create_link' && q.disable_ad !== '1') return js(res, [{ id: 0, media_type: 'vclub_ad', cmd: 'http://ads.example/ad.mp4' }, { id: 1, cmd: 'ffmpeg http://127.0.0.1:1/vod/' + encodeURIComponent(q.cmd) + '.mp4' }]);
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
  // setStream: what create_link links from then on (a portal whose links are HLS playlists, issue #88).
  return { server: server, seen: seen, MAC: MAC, setStream: function (x) { stream = x; } };
}

if (require.main === module) {
  var m = create(), port = +process.env.STALKER_PORT || 8095;
  m.server.listen(port, '127.0.0.1', function () { console.log('Mock Stalker portal on http://127.0.0.1:' + port + '/stalker_portal/c/  MAC ' + m.MAC); });
}
module.exports = { create: create };
