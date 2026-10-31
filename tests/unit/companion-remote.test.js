/* The remote and Play on TV (service/companion.js, phase 2), with the reference client.
     node tests/unit/companion-remote.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Companion = require('../../service/companion.js');
const C = require('../../scripts/companion/tb-phone.js');

let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-remote-'));
const launched = [], vol = { level: 10, muted: false };
let open = false;
const c = Companion.create({
  dir, version: 'test', log: () => {}, launch: (p, cb) => { launched.push(p); cb(null); }, sysinfo: (cb) => cb({ model: 'X', webos: '1', name: 'Den' }),
  app: () => ({ open }), editor: () => null,
  volume: (d, cb) => { if (d === 'up') vol.level++; else if (d === 'down') vol.level--; else vol.muted = !vol.muted; cb(null, Object.assign({}, vol)); },
});
function ctl(u, body) {
  return new Promise((resolve) => {
    const events = new (require('events'))();
    const res = Object.assign(events, { code: 0, writeHead(x) { this.code = x; }, end(b) { resolve({ code: this.code, j: JSON.parse(b) }); } });
    const req = new (require('events'))(); req.method = body ? 'POST' : 'GET'; req.url = u;
    c.control(req, res, u.split('?')[0]);
    process.nextTick(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await ctl('/companion/set', { on: true });
  const s = (await ctl('/companion/pair', { open: true })).j;
  const T = { host: '127.0.0.1', port: s.port };
  const cred = await C.pair(T, s.pairing.code, { name: 'Remote' });

  // TiviBro closed: a key opens it, and the key waits for it.
  let r = await C.call(cred, 'POST', '/v1/key', { key: 'ok' });
  ok('a key with TiviBro closed opens TiviBro', r.state === 'opening' && launched.length === 1 && launched[0].companion.open);
  r = await C.call(cred, 'POST', '/v1/key', { key: 'down' });
  ok('and does not open it twice in a row', launched.length === 1);
  open = true;
  let n = (await ctl('/companion/next?since=0')).j;
  ok('TiviBro then finds both keys waiting, in order', n.cmds.length === 2 && n.cmds[0].key === 'ok' && n.cmds[1].key === 'down' && n.cmds[0].from === 'Remote', JSON.stringify(n));
  n = (await ctl('/companion/next?since=' + n.seq + '&x=1', null).then ? await Promise.race([ctl('/companion/next?since=' + n.seq), wait(300).then(() => null)]) : null);
  ok('each command is carried out once (the next poll waits)', n === null);

  // A long poll wakes the moment a phone presses something.
  const t0 = Date.now();
  const pending = ctl('/companion/next?since=2');
  await wait(150);
  await C.call(cred, 'POST', '/v1/play', { k: 'abc|123' });
  n = (await pending).j;
  ok('a waiting TiviBro gets Play on TV at once', n.cmds.length === 1 && n.cmds[0].type === 'play' && n.cmds[0].k === 'abc|123' && Date.now() - t0 < 2000, JSON.stringify(n));
  await C.call(cred, 'POST', '/v1/action', { action: 'guide' });
  await C.call(cred, 'POST', '/v1/text', { text: 'michigan <b>' });
  n = (await ctl('/companion/next?since=3')).j;
  ok('actions and text go through, text cleaned', n.cmds.length === 2 && n.cmds[0].action === 'guide' && n.cmds[1].text === 'michigan b', JSON.stringify(n.cmds));
  let e = await C.call(cred, 'POST', '/v1/key', { key: 'power' }).catch((x) => x);
  ok('keys TiviBro doesn\'t know are refused', e.code === 'bad');
  e = await C.call(cred, 'POST', '/v1/action', { action: 'exit-app-and-format' }).catch((x) => x);
  ok('so are actions', e.code === 'bad');

  // Now playing: the phone waits for a change and gets it the moment TiviBro sends it.
  let st0 = await C.call(cred, 'GET', '/v1/state');
  ok('state: TiviBro open, nothing sent yet', st0.open === true && st0.state === null);
  const waiting = C.call(cred, 'GET', '/v1/state?since=' + st0.rev + '&wait=1');
  await wait(150);
  await ctl('/companion/state', { state: { tab: 'live', full: true, playing: { k: 'abc|123', name: 'Big Ten 10' }, now: { t: 'Michigan vs Ohio State', s: 1, e: 2 } } });
  const st1 = await waiting;
  ok('a waiting phone gets what is playing at once', st1.rev === st0.rev + 1 && st1.state.playing.name === 'Big Ten 10' && st1.state.now.t === 'Michigan vs Ohio State', JSON.stringify(st1));
  await ctl('/companion/state', { state: { tab: 'live', full: true, playing: { k: 'abc|123', name: 'Big Ten 10' }, now: { t: 'Michigan vs Ohio State', s: 1, e: 2 } } });
  ok('the same state again is not a change', (await C.call(cred, 'GET', '/v1/state')).rev === st1.rev);
  c.appGone();
  open = false;
  const st2 = await C.call(cred, 'GET', '/v1/state');
  ok('TiviBro closing shows at once', st2.open === false && st2.state === null && st2.rev > st1.rev);

  // The channel list: asked for, sent by TiviBro, then only when it changed.
  open = true;
  let l = await C.call(cred, 'GET', '/v1/lineup');
  ok('the channel list is asked of TiviBro', l.pending === true && !l.channels);
  n = (await ctl('/companion/next?since=99')).j;
  ok('TiviBro is told a phone wants it', n.wantLineup === true);
  const big = Array.from({ length: 6000 }, (_, i) => ({ k: 'k' + i, n: 'Channel ' + i, num: i + 1, logo: 'http://logos.example/' + i + '.png', now: { t: 'Programme ' + i, s: 1, e: 2 } }));
  const sent = await ctl('/companion/lineup', { groups: [{ id: 'g1', name: 'Sports', keys: ['k1', 'k2'] }], channels: big });
  ok('TiviBro can send a big list (6,000 channels)', sent.code === 200);
  l = await C.call(cred, 'GET', '/v1/lineup');
  ok('the phone gets it', l.channels.length === 6000 && l.groups[0].name === 'Sports' && !l.pending, JSON.stringify(Object.assign({}, l, { channels: l.channels && l.channels.length })));
  const l2 = await C.call(cred, 'GET', '/v1/lineup?rev=' + l.rev);
  ok('and next time only hears it is the same', l2.same === true && !l2.channels);

  // Volume: straight to the TV.
  let v = await C.call(cred, 'POST', '/v1/volume', { dir: 'up' });
  ok('volume up', v.volume.level === 11);
  v = await C.call(cred, 'POST', '/v1/volume', { dir: 'mute' });
  ok('mute', v.volume.muted === true);
  e = await C.call(cred, 'POST', '/v1/volume', { dir: 'max' }).catch((x) => x);
  ok('nothing else', e.code === 'bad');

  // Unsigned: nothing.
  const raw = await C.call(Object.assign({}, cred, { key: Buffer.alloc(32).toString('base64') }), 'POST', '/v1/key', { key: 'ok' }, { raw: true });
  n = await Promise.race([ctl('/companion/next?since=99'), wait(300).then(() => null)]);
  ok('a request with the wrong key presses nothing', raw.status === 401 && (n === null || !n.j.cmds.length));

  c.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all remote checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
