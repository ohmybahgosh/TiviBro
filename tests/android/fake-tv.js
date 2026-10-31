/* A stand-in TV for the Android app's tests: the real phone app connection (service/companion.js) with
   pairing open.  Prints "host:port:CODE" once ready, and keeps running.
     node tests/android/fake-tv.js > /tmp/fake-tv.txt & */
'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
const Companion = require('../../service/companion.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-fake-tv-'));
const c = Companion.create({ dir, version: 'fake-tv', log: () => {}, launch: (p, cb) => cb(null), sysinfo: (cb) => cb({ model: 'FAKE', webos: '0', name: 'Fake TV' }), app: () => ({ open: true }), editor: () => null });
function ctl(u, body) {
  return new Promise((resolve) => {
    const res = { writeHead() {}, end(b) { resolve(JSON.parse(b)); } };
    const req = new (require('events'))(); req.method = 'POST';
    c.control(req, res, u);
    process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
(async () => {
  await ctl('/companion/set', { on: true });
  const s = await ctl('/companion/pair', { open: true });
  console.log('127.0.0.1:' + s.port + ':' + s.pairing.code.replace(/-/g, ''));
})();
