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
    U: { debounce: (f) => f }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, console: { log() {}, warn() {}, error() {} }, Date, JSON, Math
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
console.log(fails ? fails + ' failures' : 'all unclean close tests passed');
process.exit(fails ? 1 : 0);
