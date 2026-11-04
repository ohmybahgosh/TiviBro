// A guide that lists two programmes at the same start (CNN on election night: "CNN Special Program" and
// "Election Day In America" both at 9:00).  untangle() leaves the first with no time of its own; nothing
// shows it as "next", and the phone's schedule never gets two programmes at one start (that crashed the app).
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), acorn = require('acorn');
const src = fs.readFileSync('app/js/epg.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2016 });
const body = ast.body.find(n => n.type === 'VariableDeclaration').declarations[0].init.callee.body.body;
const code = body.filter(n => n.type === 'FunctionDeclaration' && ['untangle', 'after'].includes(n.id.name)).map(n => src.slice(n.start, n.end)).join('\n');
let fails = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { fails++; console.error('FAIL ' + name + ': ' + e.message); } }
const c = {}; vm.createContext(c); vm.runInContext(code, c);
const H = 3600e3;
const guide = () => [
  { s: 8 * H, e: 9 * H, t: 'CNN Special Program' },
  { s: 9 * H, e: 10 * H, t: 'CNN Special Program' },
  { s: 9 * H, e: 10 * H, t: 'Election Day In America' },
  { s: 10 * H, e: 11 * H, t: 'CNN Special Program' },
  { s: 10 * H, e: 11 * H, t: 'Election Day In America' }
];
check('untangle keeps every programme in place, the first of a pair with no time of its own', () => {
  const l = c.untangle(guide());
  assert.equal(l.length, 5);
  assert.deepEqual(l.map(p => (p.e - p.s) / H), [1, 0, 1, 0, 1]);
});
check('what comes next passes over the empty ones', () => {
  const l = c.untangle(guide());
  assert.equal(c.after(l, 0).t, 'Election Day In America');
  assert.equal(c.after(l, 0).s, 9 * H);
  assert.equal(c.after(l, 2).s, 10 * H);
  assert.equal(c.after(l, 4), null);
});
check('the phone schedule filter: one programme per start, none empty', () => {
  const l = c.untangle(guide()), seen = {};
  const out = l.filter(p => { if (!(p.e > p.s) || seen[p.s]) return false; seen[p.s] = 1; return true; });
  assert.deepEqual(out.map(p => p.s / H), [8, 9, 10]);
});
if (fails) process.exitCode = 1; else console.log('all empty-programme checks passed');
