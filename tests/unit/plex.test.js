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

    const logged = JSON.stringify(m.state.seen.map((s) => s.path));
    assert(!/mock-account-token|mock-server-token/.test(logged), 'tokens go in headers, never in addresses');
    console.log('PASS tokens never in an address');
  } finally { T.loopback(false); m.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
