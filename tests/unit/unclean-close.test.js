// A session that ended still open (app/js/log.js settle): a crash, unless the TV went off, restarted or
// TiviBro was updated.  Without the helper (no word on the TV's power), a long gap is not called a crash
// (issue #82: the helper didn't start, and the last session ended five hours before).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const src = fs.readFileSync(path.join(__dirname, '../../app/js/log.js'), 'utf8');
function boot(run) {
  const store = { 'tivibro.alive': JSON.stringify(run) };
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { hidden: false, addEventListener() {} }, window: { addEventListener() {} }, navigator: {}, location: { href: '' },
    U: { debounce: (f) => f, pad: (n) => String(n).padStart(2, '0') }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, console: { log() {}, warn() {}, error() {} }, Date, JSON, Math
  };
  ctx.window = Object.assign(ctx.window, { console: ctx.console });
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.Log = Log;', ctx);
  return ctx.Log;
}
const base = { open: true, s: 'old', v: '0.6.0', doing: { play: 'TVN HD', engine: 'ts' } };
let L = boot(Object.assign({ t: Date.now() - 5 * 3600e3 }, base));
ok('no helper, the last session five hours ago: not a crash', L.settle(null) === null && !L.unclean, L.unclean);
L = boot(Object.assign({ t: Date.now() - 2 * 60000 }, base));
ok('no helper, two minutes ago: a crash', !!L.settle(null));
L = boot(Object.assign({ t: Date.now() - 5 * 3600e3 }, base));
ok('with the helper and no power-off seen, a long gap is still a crash', !!L.settle({ bootAt: 0, power: [] }));
L = boot(Object.assign({ t: Date.now() - 2 * 60000, t0: Date.now() - 2 * 60000 - 45000 }, base));
ok('how long after starting it closed (issues #194, #195: an early close while playing waits with the last channel)', L.settle(null).up === 45000);
// The log is kept at most 1.5 s after a line comes, even with a line every second (issues #140 to #167: a start that
// kept logging pushed the save back until the TV closed TiviBro, and the report stopped at its first second).
{
  const store = {}, timers = []; let now = 0;
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { hidden: false, addEventListener() {} }, window: { addEventListener() {} }, navigator: {}, location: { href: '' },
    U: { debounce: (f, ms) => { let t = null; return () => { if (t) t.done = true; timers.push(t = { f, at: now + ms }); }; }, pad: (n) => String(n).padStart(2, '0') }, setInterval: () => 0, clearInterval() {}, setTimeout: (f, ms) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout() {},
    console: { log() {}, warn() {}, error() {} }, Date: { now: () => 1795000000000 + now }, JSON, Math,
    fetch: () => new Promise(() => {}), AbortController: function () { this.abort = () => {}; }
  };
  ctx.Date = Object.assign(function (x) { return new Date(x == null ? 1795000000000 + now : x); }, { now: () => 1795000000000 + now });
  ctx.window = Object.assign(ctx.window, { console: ctx.console });
  vm.createContext(ctx); vm.runInContext(src + '\nthis.Log = Log;', ctx);
  const run = (ms) => { const end = now + ms; while (now < end) { now += 100; timers.filter((t) => !t.done && t.at <= now).forEach((t) => { t.done = true; t.f(); }); } };
  for (let i = 0; i < 10; i++) { ctx.Log.info('app', 'step ' + i); run(1000); }
  ok('a line every second: the log is kept as it goes, not only once it goes quiet', /step 8/.test(store['tivibro.log'] || ''), (store['tivibro.log'] || '').slice(-200));
}
// The phone's live log (Log.since): only the lines after the number it had, and a gap when some left memory first.
{
  const L2 = boot({ t: Date.now(), s: 'old', open: false });
  L2.info('app', 'one'); const at = L2.seq; L2.warn('player', 'two'); L2.error('net', 'three');
  const t = L2.since(at);
  ok('since() gives only the lines written after it', t.lines.length === 2 && /WARN\s+player\s+two/.test(t.lines[0]) && /ERROR\s+net\s+three/.test(t.lines[1]) && t.seq === at + 2 && !t.gap, t);
  ok('nothing new: no lines and no gap', L2.since(L2.seq).lines.length === 0 && !L2.since(L2.seq).gap);
  for (let i = 0; i < 900; i++) L2.info('app', 'x' + i);
  ok('lines dropped from memory before they were asked for: a gap, so the phone reads it all again', L2.since(at).gap === true);
}
console.log(fails ? fails + ' failures' : 'all unclean close tests passed');
process.exit(fails ? 1 : 0);
