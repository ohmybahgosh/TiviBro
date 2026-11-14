// Stalker portals through the helper (service/stalker.js, discussion #60): the box's login, the channel
// list in groups, a fresh link when a channel starts (sent on through the relay with the box's
// User-Agent), the short guide in Xtream's shape, and a MAC the portal doesn't know.
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
const Mock = require(path.join(__dirname, '../mock/stalker_mock.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fail++; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const req = (method, u, body, headers) => new Promise((res, rej) => {
  const q = http.request(u, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })); });
  q.on('error', rej); q.end(body ? JSON.stringify(body) : undefined);
});
(async () => {
  const S = require(path.join(__dirname, '../../service/stalker.js'));
  ok('a MAC is read with dashes or colons', S._login({ portal: 'http://p.example/c/', mac: '00-1a-79-00-00-01' }).mac === '00:1A:79:00:00:01');
  ok('no login without a portal address or a MAC', !S._login({ portal: 'p.example', mac: '00:1A:79:00:00:01' }) && !S._login({ portal: 'http://p.example', mac: 'nope' }));
  ok('"/c/" is the box address for /server/load.php', S._apis('http://p.example/stalker_portal/c/')[0] === 'http://p.example/stalker_portal/server/load.php' && S._apis('http://p.example:8080/c/')[0] === 'http://p.example:8080/server/load.php');
  ok('a box command to its address', S._linkOf('ffmpeg http://h.example/ch/1?play_token=x') === 'http://h.example/ch/1?play_token=x' && S._linkOf('auto https://h.example/a.m3u8') === 'https://h.example/a.m3u8');
  const F = S._fillStream;
  ok('a link with the channel left out gets it from the command (issue #88)', F('http://h.example/play/live.php?mac=00:1A&stream=&extension=ts&play_token=t', 'ffrt http://localhost/ch/12345_', '9') === 'http://h.example/play/live.php?mac=00:1A&stream=12345&extension=ts&play_token=t');
  ok('…or from the channel when the command has none', F('http://h.example/play/live.php?stream=', 'ffrt http://localhost/x', '777') === 'http://h.example/play/live.php?stream=777');
  ok('a link with its channel is left alone', F('http://h.example/play/live.php?stream=55&x=1', 'ffrt http://localhost/ch/1', '2') === 'http://h.example/play/live.php?stream=55&x=1' && F('http://h.example/a.ts', '', '2') === 'http://h.example/a.ts');

  const m = Mock.create({ stream: 'http://127.0.0.1:1/live/stream.ts' });
  await new Promise((f) => m.server.listen(0, '127.0.0.1', f));
  const portal = 'http://127.0.0.1:' + m.server.address().port + '/stalker_portal/c/';
  const r = proxy.create({ ctl: 'secret' }); await new Promise((f) => r.server.listen(0, '127.0.0.1', f));
  const H = 'http://127.0.0.1:' + r.server.address().port;
  const login = b64({ portal, mac: '00:1a:79:00:00:01' });

  let a = await req('POST', H + '/stalker/channels', { stb: login });
  ok('the channel list needs TiviBro\'s secret', a.status === 403, a.status);
  a = await req('POST', H + '/stalker/channels', { stb: login }, { 'X-TiviBro-Ctl': 'secret' });
  const d = JSON.parse(a.body || '{}');
  ok('the portal\'s channels, in its genres', a.status === 200 && d.channels.length === 3 && d.groups.map((g) => g.name).join(',') === 'News,Sports', a.body);
  ok('each channel keeps the box command and the portal\'s id', d.channels[0].url === 'stalker:ffmpeg http://localhost/ch/101' && d.channels[0].sid === '101' && d.channels[0].epg === 'news.portal' && d.channels[0].num === 1);
  ok('it logged in as a MAG box: handshake, then get_profile', m.seen.actions[0] === 'handshake' && m.seen.profile && /MAG200/.test(m.seen.ua) && /MAG250/.test(m.seen.xua), JSON.stringify(m.seen));

  a = await req('GET', H + '/stalker/play/101.ts?stb=' + login + '&cmd=' + encodeURIComponent('ffmpeg http://localhost/ch/101'));
  const loc = a.headers.location || '';
  ok('a channel starting: the portal makes a link, the player goes there through the relay with the box\'s User-Agent', a.status === 302 && m.seen.links === 1 && m.seen.lastCmd === 'ffmpeg http://localhost/ch/101' && /^http:\/\/127\.0\.0\.1:\d+\/ua\/[A-Za-z0-9_-]+\/x\/http\/127\.0\.0\.1:1\/live\/stream\.ts$/.test(loc), a.status + ' ' + loc);
  ok('the User-Agent in that link is the box\'s', Buffer.from(loc.split('/ua/')[1].split('/')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().indexOf('MAG200') >= 0);

  a = await req('GET', H + '/stalker/epg?stb=' + login + '&ch=101&limit=2');
  const e = JSON.parse(a.body || '{}');
  ok('the portal\'s guide in Xtream\'s get_short_epg shape (titles in base64)', a.status === 200 && e.epg_listings.length === 2 && Buffer.from(e.epg_listings[0].title, 'base64').toString() === 'Show 1 on 101' && +e.epg_listings[0].stop_timestamp > +e.epg_listings[0].start_timestamp, a.body);

  const bad = b64({ portal, mac: '00:1A:79:99:99:99' });
  a = await req('POST', H + '/stalker/channels', { stb: bad }, { 'X-TiviBro-Ctl': 'secret' });
  ok('a MAC the portal doesn\'t know: said so, as a login problem', a.status === 401 && JSON.parse(a.body).auth === true, a.status + ' ' + a.body);
  a = await req('GET', H + '/stalker/play/1.ts?stb=nonsense&cmd=x');
  ok('a link without a login is refused', a.status === 400);
  // Catch-up: the channel's archive days, and a programme's link from the portal's archive.
  ok('a channel with a week of archive has catch-up for 7 days', d.channels[0].arch === 7 && d.channels[1].arch === 0, JSON.stringify(d.channels.map((c) => c.arch)));
  const hourAgo = Math.floor(Date.now() / 1000 / 3600) * 3600 - 3600;
  a = await req('GET', H + '/stalker/archive/101.ts?stb=' + login + '&start=' + hourAgo + '&end=' + (hourAgo + 3600));
  ok('a programme of the archive: the portal links it, the player goes there through the relay', a.status === 302 && m.seen.archive === 'auto /media/9' + hourAgo + '.mpg' && /\/x\/http\/127\.0\.0\.1:1\/archive\//.test(a.headers.location || ''), a.status + ' ' + m.seen.archive + ' ' + a.headers.location);
  a = await req('GET', H + '/stalker/archive/101.ts?stb=' + login + '&start=' + (Math.floor(Date.now() / 1000) - 30 * 86400));
  ok('a time the archive no longer has: said so', a.status === 404, a.status);

  // Movies and shows, as an Xtream panel's.
  const X = (q) => req('GET', H + '/stalker/xc/player_api.php?stb=' + login + '&action=' + q).then((r) => ({ status: r.status, j: JSON.parse(r.body || 'null') }));
  let x = await X('get_vod_categories');
  ok('movie categories', x.status === 200 && x.j.map((c) => c.category_id + ':' + c.category_name).join() === '10:Films,11:More films', JSON.stringify(x.j));
  const pagesBefore = m.seen.vodPages || 0;
  x = await X('get_vod_streams');
  ok('every movie, from every page (shows left out)', x.status === 200 && x.j.length === 28 && x.j[0].stream_id && x.j[0].container_extension === 'mp4' && x.j[0].stream_icon === 'http://img.example/1.jpg' && (m.seen.vodPages - pagesBefore) === 3, x.j.length + ' ' + (m.seen.vodPages - pagesBefore));
  x = await X('get_vod_streams&category_id=11');
  ok('one category\'s movies', x.j.length === 14 && x.j.every((t) => t.category_id === '11'), x.j.length);
  x = await X('get_series');
  ok('the shows', x.j.map((t) => t.series_id).join() === '505,520', JSON.stringify(x.j.map((t) => t.series_id)));
  x = await X('get_vod_info&vod_id=503');
  ok('a movie\'s details', x.status === 200 && x.j.info.plot === 'About title 3' && x.j.movie_data.stream_id === '503', JSON.stringify(x.j).slice(0, 200));
  x = await X('get_series_info&series_id=505');
  const eps = x.j && x.j.episodes;
  ok('a show\'s seasons and episodes', x.status === 200 && x.j.seasons.length === 2 && eps['1'].length === 3 && eps['2'].length === 2 && eps['2'][1].episode_num === 2, JSON.stringify(x.j).slice(0, 300));
  a = await req('GET', H + '/stalker/vod/503.mp4?stb=' + login);
  ok('a movie plays from its own command', a.status === 302 && m.seen.vodLinks.slice(-1)[0] === 'eyJ0eXBlIjoibW92aWUiLCJpZCI6NTAzfQ==|' && /\/x\/http\/127\.0\.0\.1:1\/vod\//.test(a.headers.location || ''), a.status + ' ' + m.seen.vodLinks);
  a = await req('GET', H + '/stalker/vod/' + eps['2'][1].id + '.mp4?stb=' + login);
  ok('an episode is its season\'s command with its number', a.status === 302 && m.seen.vodLinks.slice(-1)[0] === 'eyJzZWFzb24iOjJ9|2', m.seen.vodLinks.slice(-1)[0]);

  // The guide asking for many channels at once on a portal it hasn't signed in to yet: one sign-in for all of
  // them, on a portal that keeps only the newest token.
  const m2 = Mock.create({ stream: 'http://127.0.0.1:1/live/stream.ts', oneToken: true });
  await new Promise((f) => m2.server.listen(0, '127.0.0.1', f));
  const login2 = b64({ portal: 'http://127.0.0.1:' + m2.server.address().port + '/stalker_portal/c/', mac: '00:1a:79:00:00:01' });
  const many = await Promise.all([101, 102, 103, 101, 102, 103, 101, 102].map((c) => req('GET', H + '/stalker/epg?stb=' + login2 + '&ch=' + c + '&limit=2')));
  ok('many guide requests at once share one sign-in', many.every((x) => x.status === 200) && m2.seen.handshakes === 1 && !m2.seen.refused, JSON.stringify({ st: many.map((x) => x.status), hs: m2.seen.handshakes, refused: m2.seen.refused }));
  m2.server.close();

  r.server.close(); m.server.close();
  console.log(fail ? fail + ' failures' : 'all Stalker portal tests passed');
  process.exit(fail ? 1 : 0);
})();
