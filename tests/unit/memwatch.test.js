/* Lists big for the TV's memory, noticed before the TV closes TiviBro: asks once to turn on Memory-safe
   playback, never while something plays fullscreen, and points to what helps once memory-safe is on.
     node tests/unit/memwatch.test.js */
'use strict';
const assert = require('assert'), vm = require('vm'), fs = require('fs');
function make(o) {
  const store = {}, menus = [], classes = new Set(o.full ? ['full'] : []);
  const c = { console, JSON, Date, Math, setInterval() {}, setTimeout() {},
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    navigator: { deviceMemory: o.gb }, performance: {},
    document: { body: { classList: { contains: (x) => classes.has(x) } }, getElementById: () => null },
    Store: { playlist: { epgSources: o.sources || [] }, settings: { memSafe: o.setting }, saveSettings() {} },
    Library: { count: () => o.channels }, Vod: { titleCount: () => o.titles || 0 },
    Player: { memSafe: !!o.safe }, UI: { modalOpen: false, menu: (t, items) => menus.push({ t, items }) },
    Log: { warn() {}, info() {} }, U: { toast() {} }, Views: {}, Settings: {} };
  vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/memwatch.js', 'utf8') + ';this.Memwatch = Memwatch;', c);
  return { c, menus, store };
}
let t = make({ gb: 2, channels: 20000, sources: [1, 2, 3], setting: 'auto' });
t.c.Memwatch.check();
assert.equal(t.menus.length, 1); assert.match(t.menus[0].t, /big for this TV/);
assert.match(t.menus[0].items[0].sub, /20000 channels, 4 guide sources on a TV with 2 GB/);
t.menus[0].items[0].action();
assert.equal(t.c.Store.settings.memSafe, 'on', 'Turn on sets Always on');
t.c.Memwatch.check(); assert.equal(t.menus.length, 1, 'asked once');

t = make({ gb: 4, channels: 3000, setting: 'auto' }); t.c.Memwatch.check();
assert.equal(t.menus.length, 0, 'a small list on a 4 GB TV: nothing');

t = make({ gb: 2, channels: 20000, setting: 'auto', full: true }); t.c.Memwatch.check();
assert.equal(t.menus.length, 0, 'never over fullscreen video');

t = make({ gb: 1, channels: 10000, titles: 41000, sources: [1, 2, 3], setting: 'auto', safe: true }); t.c.Memwatch.check();
assert.equal(t.menus.length, 1); assert.match(t.menus[0].t, /very big/, 'memory-safe already: what helps');

t = make({ gb: 2, channels: 20000, setting: 'off' }); t.c.Memwatch.check();
assert.equal(t.menus.length, 0, 'turned off on purpose: not asked');
console.log('PASS memwatch: asks once, not over video, what helps when memory-safe is on, respects Off');
