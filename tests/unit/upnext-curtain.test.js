/* Up next's curtain (upnext.js): the dark screen that keeps the show's page from flashing by between an episode
   ending and Up next, and between Play and the next one starting.  Shown by hold(), gone once Up next has faded in, when
   you go back, when the player plays or errors, and after HOLD_MAX at the latest. */
'use strict';
const assert = require('assert'), vm = require('vm'), fs = require('fs');

// A tiny DOM: elements with a class list, and a body that holds them.
function el(cls) {
  const set = new Set(String(cls || '').split(/\s+/).filter(Boolean));
  return { children: [], parentNode: null, style: {}, innerHTML: '', textContent: '',
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); } },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, querySelector: () => null, remove() {} };
}

// Loads upnext.js with stand-ins for U, UI, Player and the timers, and returns what the test needs to drive it.
function world() {
  const body = el(), timers = [], listeners = [], panels = [];
  const ctx = {
    console, Math, String,
    document: { body: { appendChild: c => body.appendChild(c), contains: () => true } },
    U: { el: (tag, cls, text) => { const e = el(cls); e.textContent = text || ''; return e; } },
    UI: { panel: (title, b, buttons, back) => panels.push({ buttons, back }), close() {} },
    Player: { on: (name, fn) => listeners.push(fn) },
    Store: { settings: { autoNext: false } },
    setTimeout: (f, ms) => { const t = { f, ms, off: false }; timers.push(t); return t; },
    clearTimeout: t => { if (t) t.off = true; },
    setInterval: () => 0, clearInterval() {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app/js/upnext.js', 'utf8'), ctx);
  const curtain = () => body.children.find(c => c.classList.contains('un-hold'));
  const up = () => { const c = curtain(); return !!c && !c.classList.contains('hidden'); };
  return { U: ctx.UpNext, panels, timers, listeners, up };
}

let w = world();
w.U.hold();
assert.ok(w.up(), 'hold() puts the curtain up');
w.U.show({ title: 'Two', play() {}, cancel() {}, auto: false });
assert.ok(w.up(), 'it stays while Up next fades in, so the page never shows through the fade');
const fade = w.timers.filter(t => !t.off && t.ms < 1000).pop();
assert.ok(fade, 'a short wait for the fade');
fade.f();
assert.ok(!w.up(), 'then Up next covers the screen and the curtain goes');

// Play pressed during the fade: the curtain stays for the player, the fade's end doesn't take it away.
w = world();
w.U.hold();
w.U.show({ title: 'Two', play() {}, cancel() {}, auto: false });
w.panels[0].buttons[0].action();
w.timers.filter(t => !t.off && t.ms < 1000).forEach(t => t.f());
assert.ok(w.up(), 'Play during the fade keeps the curtain up');

w = world();
let played = 0;
w.U.show({ title: 'Two', play: () => played++, cancel() {}, auto: false });
w.panels[0].buttons[0].action();
assert.equal(played, 1);
assert.ok(w.up(), 'Play keeps it up until the player takes over');
w.listeners.forEach(f => f('playing'));
assert.ok(!w.up(), 'playing takes it away');

w = world();
w.U.show({ title: 'Two', play() {}, cancel() {}, auto: false });
w.U.hold();
w.panels[0].back();
assert.ok(!w.up(), 'going back takes it away');

w = world();
w.U.hold();
const last = w.timers.filter(t => !t.off).pop();
assert.ok(last && last.ms <= 15000, 'it has a time limit');
last.f();
assert.ok(!w.up(), 'and is gone after it, whatever happened');

console.log('PASS Up next curtain: up on hold, gone once Up next has faded in, back, playing and the time limit');
