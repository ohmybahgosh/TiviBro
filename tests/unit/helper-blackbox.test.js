/* The helper's black box (service/lag.js blackbox, issues #176-#178): what a helper that froze for good was doing,
   told by the next one.
     node tests/unit/helper-blackbox.test.js */
'use strict';
const assert = require('assert');
const Lag = require('../../service/lag.js');

// A file system in memory, and a clock.
const files = {}, fs = { readFileSync: (f) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; }, writeFileSync: (f, d) => { files[f] = d; } };
let t = 1000000;
const logs = [], log = (o) => logs.push(o);
let mem = 100;
const box = (o) => Lag.blackbox(Object.assign({ file: 'state.json', fs, log, now: () => t, timer: false, doing: () => ({ rssMB: mem, guide: ['public 3 of 6'] }), recent: () => ['guide read', 'start'] }, o || {}));

// A helper that runs, then freezes (its writes stop) and is killed: no close.
let a = box();
assert.equal(logs.length, 0, 'nothing from before on a first start');
for (let i = 0; i < 8; i++) { t += 5000; mem += 40; a.write(); }
const saved = JSON.parse(files['state.json']);
assert.ok(saved.open && saved.shots.length === 6, 'only the last six looks are kept');
assert.equal(saved.shots[0].up, 15, 'each look says how long the helper had been up');
// The next helper, 30 s later.
t += 30000;
box();
assert.equal(logs.length, 1, 'the next helper says the one before ended without closing');
const e = logs[0];
assert.equal(e.lv, 'error', 'as an error, so it is kept for the next problem report');
assert.ok(/ended without closing/.test(e.e) && /30 s ago/.test(e.e), e.e);
assert.ok(e.shots[0].rssMB < e.shots[5].rssMB && /public 3 of 6/.test(e.e) && /guide read/.test(e.e), 'memory climbing and what it was doing: ' + e.e);

// A helper that ends normally: nothing said next time.
const b = box(); b.write(); b.close();
logs.length = 0;
box();
assert.equal(logs.length, 0, 'a normal end is not reported');
// A TV where the helper's folder can't be written: the spare (a temp folder) holds it, and is read next time.
const ro = { readFileSync: fs.readFileSync, writeFileSync: (f, d) => { if (f === 'locked.json') throw new Error('EROFS'); files[f] = d; } };
logs.length = 0;
box({ file: 'locked.json', spare: 'tmp.json', fs: ro }).write();
assert.ok(JSON.parse(files['tmp.json']).open, 'written to the spare');
box({ file: 'locked.json', spare: 'tmp.json', fs: ro });
assert.equal(logs.length, 1, 'and read from it by the next helper');
// Issue #178: a helper that froze 13 s after starting.  The first two minutes look every 2 s and whenever it logs, so
// the box holds what it did last, not only its first look.
{
  for (const k of Object.keys(files)) delete files[k];
  logs.length = 0; t = 5000000;
  const c = box({ recent: () => [step] });
  let step = 'start';
  t += 1000; step = 'relay listening'; c.mark();
  t += 400; step = 'too soon'; c.mark();
  assert.equal(JSON.parse(files['state.json']).shots.length, 2, 'a mark within a second of the last look waits');
  t += 1600; step = 'guide read'; c.tick();
  t += 1000; c.tick();
  assert.equal(JSON.parse(files['state.json']).shots.length, 3, 'early on, the timer looks every 2 s');
  t += 9000; step = '200 player_api.php?action=get_live_streams'; c.mark();
  const last = JSON.parse(files['state.json']).shots.pop();
  assert.ok(last.up === 13 && last.last[0] === step, 'the last look before the freeze names the request: ' + JSON.stringify(last));
  t += 20 * 60000; step = 'later'; const n = JSON.parse(files['state.json']).shots.length; c.mark();
  assert.equal(JSON.parse(files['state.json']).shots.length, n, 'after ten minutes, logging no longer writes (the TV\'s flash)');
  c.tick();
  assert.equal(JSON.parse(files['state.json']).shots.pop().last[0], 'later', '...the 15 s looks carry on');
}
console.log('PASS helper black box: a frozen helper\'s last looks reach the next start, a normal end says nothing, a locked folder uses the spare');
