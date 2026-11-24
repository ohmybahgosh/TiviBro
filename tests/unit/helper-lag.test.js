// What held the helper up (service/lag.js, issue #172): a late timer is logged with how long and what the helper
// was doing; 20 s or more as an error (kept for the next report); on time, nothing.
'use strict';
const Lag = require('../../service/lag');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };

let clock = 1000, logs = [];
const l = Lag.create({ timer: false, now: () => clock, log: (o) => logs.push(o), doing: () => ({ requests: 2, guide: [{ k: 'main', phase: 'download', mb: 120 }] }) });
clock += 1000; l.tick();
clock += 1500; l.tick();
ok('on time (or a little late): nothing logged', logs.length === 0, logs);
clock += 6000; l.tick();
ok('5 s late: a warning with how long and what it was doing', logs.length === 1 && logs[0].lv === 'warn' && logs[0].held === '5 s' && logs[0].doing.guide[0].phase === 'download', logs);
clock += 31000; l.tick();
ok('30 s late: an error, with the reason in e (kept in helper-errors.json)', logs.length === 2 && logs[1].lv === 'error' && /held up 30 s/.test(logs[1].e) && /download/.test(logs[1].e), logs[1]);
const bad = Lag.create({ timer: false, now: () => clock, log: (o) => logs.push(o), doing: () => { throw new Error('boom'); } });
clock += 10000; bad.tick();
ok('what it was doing failing to say is logged, not thrown', logs[2] && logs[2].doing.error === 'boom', logs[2]);
ok('memory in MB', typeof Lag.mem().heapMB === 'number' && typeof Lag.mem().rssMB === 'number', Lag.mem());

console.log(fails ? fails + ' failures' : 'all helper lag tests passed');
process.exit(fails ? 1 : 0);
