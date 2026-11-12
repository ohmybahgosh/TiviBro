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
