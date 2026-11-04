/* Turning the TV on over Bluetooth (service/blewake.js): registering, checking and removing a phone's
   wake address with a fake luna service, the address matching, and the signed /v1/blewake request.
     node tests/unit/blewake.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const B = require('../../service/blewake.js');
const Companion = require('../../service/companion.js');
const C = require('../../scripts/companion/tb-phone.js');

let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// A fake asc service, printing addresses the way the TV does (no leading zeros).
function fakeTv(o) {
  o = o || {};
  const tv = { devices: [], calls: [], logs: [], setting: o.setting === undefined ? 'on' : o.setting };
  const print = (a) => ':' + a.split(':').map((x) => x.replace(/^0+/, '')).join(':');
  tv.call = (uri, params, cb) => {
    tv.calls.push({ uri, params });
    const m = uri.replace(/^luna:\/\/[^/]+\//, '');
    setImmediate(() => {
      if (uri.indexOf('settingsservice') > 0) return cb(tv.setting == null ? { returnValue: true, settings: {} } : { returnValue: true, settings: { bleAdvertisingOnOff: tv.setting } });
      if (o.noAsc) return cb({ returnValue: false, errorCode: -1, errorText: 'Unknown service' });
      if (m === 'registerDevice') {
        if (params.type !== 'ThinQ') return cb({ returnValue: false, errorText: 'bad type' });
        if (!tv.devices.some((d) => d.address === print(params.address))) tv.devices.push({ address: print(params.address), name: 'ThinQ', user_selection: true });
        return cb({ returnValue: true });
      }
      if (m === 'readBleDevices') return cb({ returnValue: true, count: tv.devices.length, devices: tv.devices.slice() });
      if (m === 'unRegisterDevice') {
        // Only the second shape works on this fake TV, so the fallback is covered.
        if (o.unregKey && !(o.unregKey in params && params.type)) return cb({ returnValue: false, errorText: 'missing parameter' });
        tv.devices = tv.devices.filter((d) => d.address !== print(params.address));
        return cb({ returnValue: true });
      }
      cb({ returnValue: false, errorText: 'unknown method' });
    });
  };
  tv.bw = B.create({ call: tv.call, log: (x) => tv.logs.push(x) });
  tv.ask = (j) => new Promise((resolve) => tv.bw.handle(j, (e, r) => resolve(e ? { error: e.message } : r)));
  return tv;
}

(async () => {
  // Address matching.
  ok('octets are padded back to two digits', B.norm('2:a:B:0:5:ff') === '02:0a:0b:00:05:ff');
  ok('the TV\'s colon in front is dropped', B.norm(':3a:7e:4b:5d:57:9f') === '3a:7e:4b:5d:57:9f');
  ok('an empty octet is a zero', B.norm(':3a:0:4b::57:9') === '3a:00:4b:00:57:09' && B.norm('3a::4b:5:57:9f') === '3a:00:4b:05:57:9f');
  ok('not six octets is nothing', B.norm('02:11:22:33:44') === '' && B.norm('02:11:22:33:44:5g') === '' && B.norm('') === '');
  ok('the same address printed without zeros is listed', B.listed([{ address: '2:11:22:3:44:55' }], '02:11:22:03:44:55'));
  ok('the TV\'s own listing matches', B.listed([{ address: ':3a:7e:4b:5d:57:9f', name: 'ThinQ' }], '3a:7e:4b:5d:57:9f') && B.listed([{ address: ':2:a:4b:5d:57:9f' }], '02:0a:4b:5d:57:9f'));
  ok('seven octets is not an address', B.norm('00:3a:7e:4b:5d:57:9f') === '' && !B.listed([{ address: ':3a:7e:4b:5d:57:9f' }], '06:3a:7e:4b:5d:57'));
  ok('another address is not listed', !B.listed([{ address: '2:11:22:3:44:55' }], '02:11:22:03:44:56') && !B.listed([], '02:11:22:03:44:55') && !B.listed(null, '02:11:22:03:44:55'));

  // Register, status, unregister.
  let tv = fakeTv();
  let r = await tv.ask({ op: 'status', address: '02:11:22:33:44:55' });
  ok('status before registering: not registered, Bluetooth advertising on', r.registered === false && r.woble === true, JSON.stringify(r));
  r = await tv.ask({ op: 'register', address: '02:0A:22:03:44:55' });
  const reg = tv.calls.find((c) => /registerDevice$/.test(c.uri) && !/unRegister/.test(c.uri));
  ok('register calls asc/registerDevice as ThinQ with the address in lowercase', reg && reg.uri === 'luna://com.webos.service.asc/registerDevice' && reg.params.type === 'ThinQ' && reg.params.address === '02:0a:22:03:44:55', JSON.stringify(reg));
  ok('and confirms with readBleDevices', r.registered === true && /Bluetooth/.test(r.msg) && tv.calls.some((c) => c.uri === 'luna://com.webos.service.asc/readBleDevices'), JSON.stringify(r));
  ok('each call is logged', tv.logs.some((l) => l.event === 'blewake: registerDevice' && l.reply.returnValue === true) && tv.logs.some((l) => l.event === 'blewake: readBleDevices'));
  r = await tv.ask({ op: 'status', address: '02:0a:22:03:44:55' });
  ok('status after registering', r.registered === true && r.woble === true, JSON.stringify(r));
  r = await tv.ask({ op: 'unregister', address: '02:0a:22:03:44:55' });
  const un = tv.calls.find((c) => /unRegisterDevice$/.test(c.uri));
  ok('unregister calls asc/unRegisterDevice with { address }', un && un.params.address === '02:0a:22:03:44:55' && r.ok === true, JSON.stringify(un));
  r = await tv.ask({ op: 'status', address: '02:0a:22:03:44:55' });
  ok('and the phone is gone', r.registered === false);

  tv = fakeTv({ unregKey: 'address' });
  await tv.ask({ op: 'register', address: '02:11:22:33:44:55' });
  r = await tv.ask({ op: 'unregister', address: '02:11:22:33:44:55' });
  const uns = tv.calls.filter((c) => /unRegisterDevice$/.test(c.uri));
  ok('a refused { address } is tried again as { type, address }', uns.length === 2 && uns[1].params.type === 'ThinQ' && r.ok === true, JSON.stringify(uns));
  ok('both replies are logged', tv.logs.filter((l) => /unRegisterDevice/.test(l.event)).length === 2);

  tv = fakeTv({ setting: 'off' });
  r = await tv.ask({ op: 'status', address: '02:11:22:33:44:55' });
  ok('Bluetooth advertising off shows as woble false', r.woble === false);
  tv = fakeTv({ setting: null });
  r = await tv.ask({ op: 'status', address: '02:11:22:33:44:55' });
  ok('a TV without the setting leaves woble unknown', r.woble === undefined && r.registered === false);

  tv = fakeTv({ noAsc: true });
  r = await tv.ask({ op: 'register', address: '02:11:22:33:44:55' });
  ok('a TV without the service says so', r.registered === false && /refused: Unknown service/.test(r.msg), JSON.stringify(r));

  tv = fakeTv();
  r = await tv.ask({ op: 'register', address: '02:11:22:33:44' });
  ok('a bad address is refused before any call', r.error === 'bad address' && tv.calls.length === 0);
  r = await tv.ask({ op: 'register', address: '02:11:22:33:44:55; rm -rf' });
  ok('so is anything around an address', r.error === 'bad address');
  r = await tv.ask({ op: 'wipe', address: '02:11:22:33:44:55' });
  ok('an unknown op is refused', r.error === 'unknown op' && tv.calls.length === 0);

  // Through the phone API: signed, paired phones only, with TiviBro closed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-blewake-'));
  tv = fakeTv();
  const c = Companion.create({
    dir, version: 'test', log: () => {}, launch: (p, cb) => cb(null), app: () => ({ open: false }), editor: () => null,
    sysinfo: (cb) => cb({ model: 'OLED55C2', webos: '25', name: 'Livingroom TV', wol: true, macs: [], bt: '80:5b:65:a8:f5:c1', woble: true }),
    blewake: tv.bw.handle,
  });
  const ctl = (u, body) => new Promise((resolve) => {
    const res = Object.assign(new (require('events'))(), { code: 0, writeHead(x) { this.code = x; }, end(b) { resolve({ code: this.code, j: JSON.parse(b) }); } });
    const req = new (require('events'))(); req.method = 'POST'; req.url = u;
    c.control(req, res, u);
    process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
  await ctl('/companion/set', { on: true });
  const s = (await ctl('/companion/pair', { open: true })).j;
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Pixel' });
  const info = await C.call(cred, 'GET', '/v1/info');
  ok('info has the TV\'s Bluetooth address and setting', info.bt === '80:5b:65:a8:f5:c1' && info.woble === true, JSON.stringify(info));
  r = await C.call(cred, 'POST', '/v1/blewake', { op: 'register', address: '02:11:22:33:44:55' });
  ok('a paired phone registers with TiviBro closed', r.ok === true && r.registered === true, JSON.stringify(r));
  r = await C.call(cred, 'POST', '/v1/blewake', { op: 'status', address: '02:11:22:33:44:55' });
  ok('and sees it registered', r.registered === true && r.woble === true);
  let e = await C.call(cred, 'POST', '/v1/blewake', { op: 'register', address: 'nope' }).catch((x) => x);
  ok('a bad address is a bad request', e.code === 'bad');
  r = await C.call(cred, 'POST', '/v1/blewake', { op: 'unregister', address: '02:11:22:33:44:55' });
  ok('unregister answers ok', r.ok === true && tv.devices.length === 0);
  const before = tv.calls.length;
  const raw = await C.call(Object.assign({}, cred, { key: Buffer.alloc(32).toString('base64') }), 'POST', '/v1/blewake', { op: 'register', address: '02:11:22:33:44:66' }, { raw: true });
  ok('a request with the wrong key registers nothing', raw.status === 401 && tv.calls.length === before);

  c.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all blewake checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
