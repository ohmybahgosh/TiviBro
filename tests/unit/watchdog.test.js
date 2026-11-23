// The helper's check on itself (service/watchdog.js, issue #153): a relay that stops answering, uncaught errors
// close together or a full heap end the helper, so webOS starts a fresh one; an idle helper is left alone.
'use strict';
const assert = require('assert');
const W = require('../../service/watchdog.js');
let fails = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { fails++; console.error('FAIL ' + name + ': ' + e.message); } }
function make(opts) {
  const s = { exits: [], logs: [], answer: true, heap: 0, port: 47811, busy: true };
  s.w = W.create(Object.assign({ timer: false, port: () => s.port, busy: () => s.busy, log: (o) => s.logs.push(o), exit: (c) => s.exits.push(c),
    ping: (p, ms, cb) => cb(s.answer), heap: () => s.heap }, opts || {}));
  return s;
}
const realSet = setTimeout;
global.setTimeout = (f) => { f(); return 0; };      // quit's short wait runs at once here

check('answering: nothing happens', () => { const s = make(); for (let i = 0; i < 10; i++) s.w.tick(); assert.strictEqual(s.exits.length, 0); });
check('four missed self-checks in a row: exits once, saying why', () => {
  const s = make(); s.answer = false;
  for (let i = 0; i < 3; i++) s.w.tick();
  assert.strictEqual(s.exits.length, 0);
  s.w.tick(); s.w.tick();
  assert.deepStrictEqual(s.exits, [1]);
  assert.ok(s.logs.some((l) => l.event === 'helper restarts itself' && /over a minute/.test(l.why)));
});
check('a miss then an answer starts the count again', () => {
  const s = make(); s.answer = false; s.w.tick(); s.w.tick(); s.w.tick(); s.answer = true; s.w.tick(); s.answer = false; s.w.tick(); s.w.tick(); s.w.tick();
  assert.strictEqual(s.exits.length, 0);
});
check('nobody subscribed (TiviBro closed) or no relay: not checked', () => {
  const s = make(); s.answer = false; s.busy = false; for (let i = 0; i < 6; i++) s.w.tick();
  s.busy = true; s.port = 0; for (let i = 0; i < 6; i++) s.w.tick();
  assert.strictEqual(s.exits.length, 0);
});
check('three uncaught errors within a minute: exits; two do not', () => {
  const s = make(); s.w.error(); s.w.error(); assert.strictEqual(s.exits.length, 0); s.w.error(); assert.deepStrictEqual(s.exits, [1]);
});
check('heap over 92 % for three checks: exits', () => {
  const s = make(); s.heap = 0.95; s.w.tick(); s.w.tick(); assert.strictEqual(s.exits.length, 0); s.w.tick(); assert.deepStrictEqual(s.exits, [1]);
});
global.setTimeout = realSet;
// The real /ping against a listening server and a closed port.
const http = require('http');
const srv = http.createServer((q, r) => { r.writeHead(q.url === '/ping' ? 200 : 404); r.end('{}'); }).listen(0, '127.0.0.1', () => {
  const port = srv.address().port;
  const w = W.create({ timer: false, port: () => port, busy: () => true, log: () => {}, exit: () => { fails++; console.error('FAIL exited while answering'); } });
  w.tick();
  setTimeout(() => {
    srv.close();
    console.log(fails ? fails + ' failed' : 'all watchdog checks passed');
    process.exit(fails ? 1 : 0);
  }, 500);
});
