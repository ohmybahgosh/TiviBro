/* The phone app connection (service/companion.js), end to end with the reference client
   (scripts/companion/tb-phone.js), including what an attacker on the network would try.
     node tests/unit/companion.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const Companion = require('../../service/companion.js');
const Editor = require('../../service/editor.js');
const proxy = require('../../service/proxy.js');
const C = require('../../scripts/companion/tb-phone.js');

let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-companion-'));
const launched = [];
let appOpen = false;
const editor = Editor.create(() => {});

function make() {
  return Companion.create({ dir, version: 'test', log: () => {}, launch: (p, cb) => { launched.push(p); cb(null); }, sysinfo: (cb) => cb({ model: 'OLED55C2', webos: '7.3.0', name: 'Living room' }), app: () => ({ open: appOpen, visible: appOpen }), editor: () => editor });
}
function ctl(c, u, body) {
  return new Promise((resolve) => {
    const res = { code: 0, writeHead(c) { this.code = c; }, end(b) { resolve({ code: this.code, j: JSON.parse(b) }); } };
    const req = new (require('events'))();
    req.method = body ? 'POST' : 'GET';
    c.control(req, res, u);
    process.nextTick(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let c = make();
  let s = (await ctl(c, '/companion/status')).j;
  ok('off until the user switches it on, and no server', !s.on && !s.running && !c.running);
  ok('a TV id is made once', /^[0-9a-f]{16}$/.test(s.id));
  s = (await ctl(c, '/companion/set', { on: true, version: '0.6.0-alpha.30' })).j;
  ok('switching it on starts the LAN server', s.on && s.running && s.port === 47810, JSON.stringify(s));
  await wait(100);
  const T = { host: '127.0.0.1', port: s.port };

  const h = await C.hello(T);
  ok('hello: name, version, no secrets', h.app === 'TiviBro' && h.name === 'Living room' && h.version === '0.6.0-alpha.30' && h.pairing === false && !('phones' in h) && !('mac' in h), JSON.stringify(h));
  const found = await C.discover(600, { host: '127.0.0.1' });
  ok('discovery answers on UDP 47810', found.length === 1 && found[0].id === s.id && found[0].port === 47810, JSON.stringify(found));

  // Pairing only while the TV shows a code.
  let e = await C.pair(T, 'AAAA-BBBB-CCCC', { name: 'Pixel' }).catch((x) => x);
  ok('no pairing unless opened on the TV', e.code === 'closed', e.message);
  s = (await ctl(c, '/companion/pair', { open: true })).j;
  ok('pairing gives a 12-character code and a link with it', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(s.pairing.code) && s.pairing.link.indexOf('https://tivibro.app/pair#') === 0 && s.pairing.link.indexOf('c=' + s.pairing.code.replace(/-/g, '')) > 0, JSON.stringify(s.pairing));
  ok('hello says pairing is open', (await C.hello(T)).pairing === true);
  for (let i = 1; i <= 4; i++) {
    e = await C.pair(T, 'WRNG-WRNG-WRN' + i, { name: 'Attacker' }).catch((x) => x);
    if (i === 1) ok('a wrong code is refused', e.code === 'wrong' && /not right/.test(e.message), e.message);
  }
  ok('the TV shows the wrong tries', (await ctl(c, '/companion/status')).j.pairing.tries === 4);
  e = await C.pair(T, 'WRNG-WRNG-WRN5', { name: 'Attacker' }).catch((x) => x);
  ok('five wrong codes close pairing', e.code === 'closed' && !(await ctl(c, '/companion/status')).j.pairing, e.message);
  e = await C.pair(T, s.pairing.code, { name: 'Pixel' }).catch((x) => x);
  ok('and the right code no longer works after that', e.code === 'closed');

  s = (await ctl(c, '/companion/pair', { open: true })).j;
  const code = s.pairing.code.toLowerCase().replace(/-/g, ' ');
  const cred = await C.pair(T, code, { name: 'Pixel 8', model: 'Pixel 8', platform: 'android' });
  ok('the right code pairs (typed any way) and the TV proves it knows the code', cred.phone && cred.tv.id === s.id && Buffer.from(cred.key, 'base64').length === 32);
  s = (await ctl(c, '/companion/status')).j;
  ok('the TV lists the phone, says it paired, and stores no code', s.phones.length === 1 && s.phones[0].name === 'Pixel 8' && s.pairing.paired.name === 'Pixel 8' && !('key' in s.phones[0]));
  e = await C.pair(T, s.pairing.code, { name: 'Second' }).catch((x) => x);
  ok('a code pairs one phone only', e.code === 'closed');
  const file = path.join(dir, 'companion.json');
  ok('keys are kept in a file only the helper can read', (fs.statSync(file).mode & 0o777) === 0o600, (fs.statSync(file).mode & 0o777).toString(8));

  // Signed requests.
  const info = await C.call(cred, 'GET', '/v1/info');
  ok('info: model, webOS, MAC for waking, TiviBro state', info.model === 'OLED55C2' && info.webos === '7.3.0' && Array.isArray(info.ips) && info.tivibro.open === false && info.phone.name === 'Pixel 8', JSON.stringify(info));
  let r = await C.call(cred, 'GET', '/v1/info', undefined, { raw: true, sig: 'f'.repeat(64) });
  ok('a wrong signature is refused', r.status === 401 && r.json.code === 'signature');
  const nonce = crypto.randomBytes(18).toString('base64');
  await C.call(cred, 'GET', '/v1/info', undefined, { nonce });
  r = await C.call(cred, 'GET', '/v1/info', undefined, { raw: true, nonce });
  ok('a replayed request is refused', r.status === 401 && r.json.code === 'replay' && r.signed);
  r = await C.call(cred, 'GET', '/v1/info', undefined, { raw: true, time: Date.now() - 60 * 60000 });
  ok('an old request is refused, with the TV\'s time to correct the clock', r.status === 401 && r.json.code === 'clock' && r.json.now > 0 && r.signed);
  const other = Object.assign({}, cred, { key: crypto.randomBytes(32).toString('base64') });
  r = await C.call(other, 'POST', '/v1/open', {}, { raw: true });
  ok('a key that is not this phone\'s is refused, and nothing is opened', r.status === 401 && launched.length === 0);
  r = await C.call(Object.assign({}, cred, { phone: 'abcdefabcdef' }), 'GET', '/v1/info', undefined, { raw: true });
  ok('an unknown phone is told to pair again', r.status === 401 && r.json.code === 'unpaired');
  // A changed answer: the phone notices.
  const forged = Object.assign({}, cred, { key: crypto.randomBytes(32).toString('base64') });
  r = await C.call(forged, 'GET', '/v1/hello', undefined, { raw: true }).catch((x) => x);
  ok('the phone can tell an answer the TV did not sign', r && r.signed === false);

  // Open TiviBro, and the editor for this phone.
  await C.call(cred, 'POST', '/v1/open', {});
  ok('open: TiviBro is launched', launched.length === 1 && launched[0].companion && launched[0].companion.open);
  let ed = await C.call(cred, 'POST', '/v1/editor', {});
  ok('editor with TiviBro closed: TiviBro opens for the editor', ed.state === 'starting' && launched[1] && launched[1].companion.editor === true, JSON.stringify(ed));
  s = (await ctl(c, '/companion/status')).j;
  ok('and TiviBro is asked to start it', s.wantEditor > 0);
  appOpen = true;
  await new Promise((res) => editor.start(18787, 'ABCD-EFGH', res));
  await ctl(c, '/companion/editor-done', {});
  ed = await C.call(cred, 'POST', '/v1/editor', {});
  ok('editor running: a signed-in address for this phone', ed.state === 'ready' && /^http:\/\/127\.0\.0\.1:18787\/#t=[0-9a-f]{48}$/.test(ed.url), JSON.stringify(ed));
  const tok = ed.url.split('#t=')[1];
  const st = await new Promise((res) => http.get({ host: '127.0.0.1', port: 18787, path: '/api/rev', headers: { 'X-Token': tok } }, (x) => { x.resume(); res(x.statusCode); }));
  ok('the editor accepts that session', st === 200, st);
  editor.stop();

  // Removed on the TV: the key stops working at once.
  const c2 = await C.pair(T, (await ctl(c, '/companion/pair', { open: true })).j.pairing.code, { name: 'Tablet' });
  await ctl(c, '/companion/forget', { id: cred.phone });
  e = await C.call(cred, 'GET', '/v1/info').catch((x) => x);
  ok('a phone removed on the TV can no longer connect (told so, unsigned)', e.code === 'unpaired' && e.unsigned === true, e.message);
  ok('the other phone still can', (await C.call(c2, 'GET', '/v1/info')).phone.name === 'Tablet');

  // Restart: same id, still on, still paired.
  c.stop();
  c = make();
  s = (await ctl(c, '/companion/status')).j;
  ok('after a restart: still on, same TV, the phone still paired', s.on && s.id === cred.tv.id && s.phones.length === 1 && s.phones[0].name === 'Tablet');
  await new Promise((res) => c.start(res));
  ok('and the phone connects again', (await C.call(c2, 'GET', '/v1/info')).ok === true);
  await C.call(c2, 'POST', '/v1/forget', {});
  ok('a phone can remove itself', (await ctl(c, '/companion/status')).j.phones.length === 0);

  // Only TiviBro may switch it, through the relay.
  const relay = proxy.create({ companion: c, ctl: 'secret123' });
  await new Promise((res) => relay.server.listen(0, '127.0.0.1', res));
  const rp = relay.server.address().port;
  const get = (h) => new Promise((res) => http.get({ host: '127.0.0.1', port: rp, path: '/companion/status', headers: h }, (x) => { x.resume(); res(x.statusCode); }));
  ok('the relay refuses control without the helper\'s secret', (await get({})) === 403 && (await get({ 'X-TiviBro-Ctl': 'wrong' })) === 403);
  ok('and allows it with it', (await get({ 'X-TiviBro-Ctl': 'secret123' })) === 200);
  const eget = await new Promise((res) => http.get({ host: '127.0.0.1', port: rp, path: '/editor/status' }, (x) => { x.resume(); res(x.statusCode); }));
  ok('the web editor\'s control too', eget === 403);
  relay.server.close();

  s = (await ctl(c, '/companion/set', { on: false })).j;
  ok('switching it off stops the server', !s.on && !s.running);
  e = await C.hello(T).catch((x) => x);
  ok('and nothing answers any more', e instanceof Error);
  c.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all phone app connection checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
