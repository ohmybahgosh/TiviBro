// Plex through the helper (service/plex.js) against the mock plex.tv and server (tests/mock/mock_plex.js):
// the link-code sign-in, the account and its servers, picking a connection that answers, Plex Home with a PIN,
// server calls on allowed paths only, and the headers every call carries.
const assert = require('assert');
const Plex = require('../../service/plex');
const Mock = require('../mock/mock_plex');
const T = Plex._test;
const ask = (q) => new Promise((ok) => Plex.handle(Object.assign({ cid: 'tv-0123456789' }, q), ok));

(async () => {
  // Addresses: home networks and plex.direct only; paths: only the ones TiviBro uses.
  assert(T.allowedBase('https://10-0-0-5.abc123.plex.direct:32400'));
  assert(T.allowedBase('http://192.168.1.40:32400'));
  assert(!T.allowedBase('http://8.8.8.8:32400'));
  assert(!T.allowedBase('http://example.com:32400'));
  assert(!T.allowedBase('http://127.0.0.1:32400'), 'not the TV itself');
  assert(!T.allowedBase('http://192.168.1.40:32400/x'), 'a base is an origin');
  assert(T.allowedPath('GET', '/library/sections/3/all?type=1'));
  assert(T.allowedPath('PUT', '/library/parts/77'));
  assert(!T.allowedPath('DELETE', '/library/metadata/10'), 'TiviBro never deletes media');
  assert(!T.allowedPath('GET', '/:/prefs'), 'no server settings');
  assert(!T.allowedPath('GET', '/library/sections/%2e%2e/all'));
  console.log('PASS only home or plex.direct servers, and only the paths TiviBro uses');

  // Connections in the order Plex users expect, with a plain local http one for old TVs.
  const o = T.order({ connections: [{ uri: 'https://r', relay: true }, { uri: 'https://w', local: false }, { uri: 'https://l', local: true, address: '192.168.1.40', port: 32400 }] });
  assert.deepEqual(o.map((c) => c.uri), ['https://l', 'http://192.168.1.40:32400', 'https://w', 'https://r']);
  assert.equal(T.order({ httpsRequired: true, connections: [{ uri: 'https://l', local: true, address: 'a', port: 1 }] }).length, 1, 'no plain http when the server needs https');
  console.log('PASS connections: on the network first, relay last');

  const m = await new Promise((ok) => Mock.start(ok));
  T.setPlexTv('http://127.0.0.1:' + m.port); T.loopback(true);
  try {
    assert.deepEqual(await ask({ op: 'nope' }), { error: 'bad', status: 0 });
    assert.equal((await ask({ op: 'pin', cid: 'x' })).error, 'bad', 'the TV id is checked');
    const pin = await ask({ op: 'pin', name: 'Living room TV' });
    assert.equal(pin.code, 'K7QX'); assert.equal(pin.id, 4242);
    const h = m.state.seen[m.state.seen.length - 1].headers;
    assert.equal(h['x-plex-product'], 'TiviBro'); assert.equal(h['x-plex-client-identifier'], 'tv-0123456789'); assert.equal(h['x-plex-device-name'], 'Living room TV');
    assert.equal(h['x-plex-provides'], 'player');
    assert.equal((await ask({ op: 'poll', id: 4242 })).pending, true);
    m.state.signedIn = true;
    const token = (await ask({ op: 'poll', id: 4242 })).token;
    assert.equal(token, Mock.TOKEN);
    console.log('PASS the plex.tv/link code, then the token once signed in, with Plex\'s headers');

    assert.deepEqual((await ask({ op: 'user', token })).user, { uuid: 'u1', name: 'hometheater', thumb: '', pass: true, home: true, admin: true, restricted: false });
    assert.equal((await ask({ op: 'user', token: 'wrong-token-1' })).error, 'login', 'a removed sign-in asks to sign in again');
    const list = (await ask({ op: 'servers', token })).servers;
    assert.equal(list.length, 1, 'players are not servers'); assert.equal(list[0].name, 'Home server'); assert.equal(list[0].token, Mock.SERVER_TOKEN);
    console.log('PASS the account (with Plex Pass) and its servers');

    // The plex.direct connection doesn't answer here; the next one does, and is this server.
    const picked = await ask({ op: 'pick', server: list[0] });
    assert.equal(picked.uri, 'http://127.0.0.1:' + m.port);
    assert.equal((await ask({ op: 'pick', server: Object.assign({}, list[0], { id: 'someone-else' }) })).error, 'unreachable', 'another server at that address is not it');
    console.log('PASS picks the first connection that answers as this server');

    const base = picked.uri, st = Mock.SERVER_TOKEN;
    const secs = await ask({ op: 'get', base, path: '/library/sections', token: st });
    assert.equal(secs.data.MediaContainer.Directory[0].title, 'Movies');
    const all = await ask({ op: 'get', base, path: '/library/sections/1/all?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=50', token: st });
    assert.equal(all.data.MediaContainer.Metadata[0].title, 'Copper Sky');
    assert.equal((await ask({ op: 'get', base, path: '/:/prefs', token: st })).error, 'bad');
    assert.equal((await ask({ op: 'get', base: 'http://8.8.8.8:32400', path: '/identity', token: st })).error, 'bad');
    await ask({ op: 'get', base, path: '/:/scrobble?identifier=com.plexapp.plugins.library&key=10', token: st });
    assert.equal(m.state.scrobbled, 'identifier=com.plexapp.plugins.library&key=10');
    console.log('PASS server calls on allowed paths, and a watched mark reaches the server');

    const users = (await ask({ op: 'home', token })).users;
    assert.deepEqual(users.map((u) => [u.name, u.pin]), [['hometheater', false], ['Kids', true]]);
    assert.equal((await ask({ op: 'switch', token, uuid: 'kid1', pin: '0000' })).error, 'pin');
    assert.equal((await ask({ op: 'switch', token, uuid: 'kid1', pin: '1234' })).token, 'mock-kid-token');
    console.log('PASS Plex Home: a wrong PIN says so, the right one signs in as that person');

    // Doors: a random key in the link stands for the server and its token (the TV's img and video tags can't send it).
    const d1 = await ask({ op: 'door', base, token: st }), d2 = await ask({ op: 'door', base, token: st });
    assert(/^[0-9a-f]{48}$/.test(d1.key)); assert.equal(d1.key, d2.key, 'one door a server');
    assert.equal((await ask({ op: 'door', base: 'http://8.8.8.8:32400', token: st })).error, 'bad');
    const http = require('http');
    const front = http.createServer((req, res) => Plex.doorGet(req, res, {}));
    await new Promise((ok) => front.listen(0, '127.0.0.1', ok));
    const get = (path, h) => new Promise((ok) => http.get({ host: '127.0.0.1', port: front.address().port, path, headers: h || {} }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => ok({ status: r.statusCode, body: b, type: r.headers['content-type'] })); }));
    const pic = await get('/plex/' + d1.key + '/photo/:/transcode?width=300&height=450&url=%2Flibrary%2Fmetadata%2F10%2Fthumb%2F1');
    assert.equal(pic.status, 200); assert.equal(pic.type, 'image/png'); assert(/width=300/.test(pic.body));
    const vid = await get('/plex/' + d1.key + '/library/parts/7/1700000000/file.mkv', { Range: 'bytes=100-' });
    assert.equal(vid.status, 206); assert.equal(vid.body, 'MKVBYTES'); assert.equal(m.state.range, 'bytes=100-', 'seeking passes on');
    assert.equal((await get('/plex/' + d1.key + '/:/prefs')).status, 404, 'only pictures and video');
    assert.equal((await get('/plex/' + 'f'.repeat(48) + '/photo/:/transcode?url=x')).status, 404, 'an unknown key');
    front.close();
    console.log('PASS pictures and video through a door, the token kept in the helper');

    const wl = await ask({ op: 'watchlist', token: 'mock-account-token-123', act: 'list' });
    assert.deepEqual(wl.items.map((x) => x.title), ['Northbound', 'Not on the server']); assert(/^plex:\/\/movie\//.test(wl.items[0].guid));
    assert.deepEqual(await ask({ op: 'watchlist', token: 'mock-account-token-123', act: 'add', key: '5d776b59ad5437001f79c6f8' }), {});
    assert(/addToWatchlist\?ratingKey=5d776b59ad5437001f79c6f8/.test(m.state.watchlisted));
    assert.equal((await ask({ op: 'watchlist', token: 'mock-account-token-123', act: 'add', key: '../x' })).error, 'bad', 'only a catalogue key');
    assert.equal((await ask({ op: 'watchlist', token: 'mock-account-token-123', act: 'clear' })).error, 'bad');
    console.log('PASS the Watchlist: read, and a title added by its catalogue key only');

    const logged = JSON.stringify(m.state.seen.map((s) => s.path));
    assert(!/mock-account-token|mock-server-token/.test(logged), 'tokens go in headers, never in addresses');
    console.log('PASS tokens never in an address');
  } finally { T.loopback(false); m.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
