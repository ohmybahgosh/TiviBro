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
console.log('PASS helper black box: a frozen helper\'s last looks reach the next start, a normal end says nothing, a locked folder uses the spare');
