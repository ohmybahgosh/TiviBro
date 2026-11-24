/* Burn-in protection's dimming (burnin.js): an episode watched to the end with no key press must not leave the
   screen dimmed, and the dim never stays once video is fullscreen. */
'use strict';
const assert = require('assert'), vm = require('vm'), fs = require('fs');

// burnin.js with a body whose classes the test sets, and its veil element kept to look at.
function world() {
  const cls = new Set(), made = [];
  const el = () => { const c = new Set(); const e = { id: '', style: {}, classList: { toggle: (k, on) => on ? c.add(k) : c.delete(k), contains: k => c.has(k) } }; made.push(e); return e; };
  const ctx = { Date, Store: { settings: {} }, setInterval: () => 0,
    document: { body: { classList: { contains: k => cls.has(k) }, appendChild() {} }, createElement: el, getElementById: () => null, addEventListener() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app/js/burnin.js', 'utf8'), ctx);
  return { B: ctx.Burnin, full: on => on ? cls.add('full') : cls.delete('full') };
}

let w = world();
w.B._idle(11 * 60000); w.B._check();
assert.ok(w.B.isDimmed(), 'a menu left alone 10 minutes dims');
w.full(true); w.B._check();
assert.ok(!w.B.isDimmed(), 'going fullscreen lifts the dim at once');

w = world();
w.full(true); w.B._idle(45 * 60000); w.B._check();            // a 45-minute episode, no key pressed
w.full(false); w.B._check();                                  // it ended: Up next, the page
assert.ok(!w.B.isDimmed(), 'watching counts as use: no dim right after an episode ends');

w = world();
w.B._idle(11 * 60000); w.B._check(); assert.ok(w.B.isDimmed());
assert.equal(w.B.activity(), true, 'the first key only wakes it');
assert.ok(!w.B.isDimmed());

console.log('PASS burn-in dimming: menus dim after 10 minutes, never right after watching, never over fullscreen');
