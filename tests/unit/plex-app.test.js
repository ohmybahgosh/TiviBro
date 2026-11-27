// The app's side of Plex (app/js/plex.js) with the helper stood in for: signing in with the plex.tv/link code,
// servers picked for a start, Plex staying out of the menu until a library is added, a server reached once and
// tried again only when a call fails, Plex Home switching, and a refused sign-in signing out.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const asked = [], store = {};
let answers = {}, unreachableOnce = false;
const c = { Promise, setTimeout: (f) => setTimeout(f, 1), clearTimeout, Date, JSON, Math, console,
  localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  Store: { settings: { deviceName: 'Living room TV' } },
  Media: { request: (route, q) => { asked.push(JSON.parse(JSON.stringify(q))); assert.equal(route, 'plex'); return Promise.resolve(typeof answers[q.op] === 'function' ? answers[q.op](q) : answers[q.op]); } } };
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/plex.js', 'utf8') + '\nthis.Plex = Plex;', c);
const P = c.Plex;

(async () => {
  let polls = 0;
  answers = {
    pin: { id: 7, code: 'K7QX', expires: Date.now() + 9e5 },
    poll: () => (++polls < 2 ? { pending: true } : { token: 'acct-token-1' }),
    user: (q) => ({ user: { name: q.token === 'kid-token-1' ? 'Kids' : 'hometheater', pass: true, home: true } }),
    servers: { servers: [{ id: 'srv1', name: 'Home server', owned: true, token: 'srv-token-1', online: true, connections: [] }, { id: 'srv2', name: 'Jamie', owned: false, token: 'srv-token-2', connections: [] }] },
    pick: { uri: 'http://192.168.1.40:32400', local: true, relay: false },
    get: (q) => (unreachableOnce ? (unreachableOnce = false, { error: 'unreachable' }) : { status: 200, data: { MediaContainer: { Directory: [{ key: 1, title: 'Movies', type: 'movie' }, { key: 2, title: 'Music', type: 'artist' }] } } }),
    home: { users: [{ uuid: 'kid1', name: 'Kids', pin: true }] },
    switch: { token: 'kid-token-1' }
  };
  let drawn = 0;
  assert.equal(P.signedIn(), false); assert.equal(P.added(), false);
  const name = await P.connect(() => drawn++);
  assert.equal(name, 'hometheater'); assert(drawn >= 1); assert.equal(P.pendingCode(), null);
  assert(asked.every((q) => /^tivibro-/.test(q.cid) && q.name === 'Living room TV'), 'every call carries the TV id and name');
  assert.deepEqual(P.chosen().map((s) => s.id), ['srv1'], 'a first sign-in picks the servers you own');
  assert.equal(P.added(), false, 'signed in, but no library yet: still not in the menu');
  console.log('PASS signing in with the code, your own servers picked, nothing in the menu yet');

  const secs = await P.sections('srv1');
  assert.deepEqual(secs.map((s) => s.title), ['Movies'], 'music and photos are left out');
  P.setLib('srv1', '1', true);
  assert.equal(P.added(), true);
  console.log('PASS a library added puts Plex in the menu');

  const before = asked.filter((q) => q.op === 'pick').length;
  await P.call('srv1', '/hubs');
  assert.equal(asked.filter((q) => q.op === 'pick').length, before, 'the address that worked is kept');
  unreachableOnce = true; await P.call('srv1', '/hubs');
  assert.equal(asked.filter((q) => q.op === 'pick').length, before + 1, 'a failed call looks for the server again, once');
  assert.equal(asked[asked.length - 1].token, 'srv-token-1', 'a server call uses the server\'s own token');
  console.log('PASS a server is reached once, and looked for again only after a failed call');

  assert.equal(await P.switchUser('kid1', '1234'), 'Kids');
  assert.equal(asked.filter((q) => q.op === 'switch')[0].pin, '1234');
  assert.equal(P._test.state().accountToken, 'acct-token-1', 'the account sign-in is kept to switch back');
  console.log('PASS Plex Home: signing in as another person with their PIN');

  answers.servers = { error: 'login' };
  await P.loadServers().then(() => assert.fail('should refuse'), (e) => assert.equal(e.kind, 'login'));
  assert.equal(P.signedIn(), false); assert.equal(P.added(), false);
  assert(/^tivibro-/.test(P._test.state().cid), 'the TV id stays');
  console.log('PASS a refused sign-in signs out, and Plex leaves the menu');
})().catch((e) => { console.error(e); process.exit(1); });
