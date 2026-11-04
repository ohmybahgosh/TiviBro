// What playback learns across restarts (app/js/playmemo.js): limits, forgetting, and the Automatic levels.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
let now = 1.8e12;
const ls = {};
const ctx = { Date: { now: () => now, parse: Date.parse }, JSON, Math, Object, Array, String, setTimeout: () => 1, clearTimeout() {},
  localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
  Store: { playlist: { id: 'p1' } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/playmemo.js'), 'utf8') + '\nthis.PlayMemo = PlayMemo;', ctx);
const M = ctx.PlayMemo;

M.worked({ k: 'a' }, 'hls', 'ts');
ok('an unusual pipeline is kept', M.get({ k: 'a' }).engine === 'hls');
ok('per playlist', (ctx.Store.playlist = { id: 'p2' }, M.get({ k: 'a' }).engine === '') && (ctx.Store.playlist = { id: 'p1' }, true));
M.worked({ k: 'a' }, 'ts', 'ts');
ok('playing the usual way again forgets it', M.get({ k: 'a' }).engine === '');
M.boost({ k: 'b' }, 3.14159);
ok('the cushion is kept, rounded', M.get({ k: 'b' }).boost === 3.1);
now += 31 * 86400e3;
ok('forgotten after 30 days unused', M.get({ k: 'b' }).boost === 0);
for (let i = 0; i < 1600; i++) { now += 1000; M.boost({ k: 'c' + i }, 2); }
M.flush();
const kept = Object.keys(JSON.parse(ls['tivibro.playMemo']).ch);
ok('at most 1,500 channels, the newest kept', kept.length === 1500 && kept.indexOf('p1:c1599') >= 0 && kept.indexOf('p1:c0') < 0, kept.length);

ok('a new provider is still being learned', M.auto('new.example').why === 'still learning' && M.dryRate('new.example') === null);
for (let i = 0; i < 3; i++) M.started('x.example');
for (let i = 0; i < 20; i++) M.watched('x.example', 60000);                  // 20 minutes
M.ranDry('x.example'); M.ranDry('x.example');                                 // 6 an hour
ok('six dry spells an hour is shaky', M.auto('x.example').why === 'shaky' && M.auto('x.example').prebuffer === 4, JSON.stringify(M.auto('x.example')));
ok('a huge time step is ignored', (M.watched('x.example', 3600e3), Math.round(M.dryRate('x.example')) === 6));
for (let i = 0; i < 1200; i++) M.watched('x.example', 60000);                 // 20 hours more, never dry
ok('the counts halve as it goes, so a provider that calmed down is seen as steady', M.auto('x.example').why === 'steady', M.dryRate('x.example'));
M.reset();
ok('Start learning again forgets everything', M.summary().length === 0 && !ls['tivibro.playMemo'] && M.get({ k: 'c1599' }).boost === 0);
console.log(fail ? fail + ' failures' : 'all playback memory tests passed');
process.exit(fail ? 1 : 0);
