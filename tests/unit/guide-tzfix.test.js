// The full guide's time zone (epg.js tzCheck, discussion #36): an Xtream provider's XMLTV in the server's own zone
// but marked UTC is found by comparing it with the per-channel listings (true times), and corrected once it's sure.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), acorn = require('acorn');
const src = fs.readFileSync('app/js/epg.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2016 });
const body = ast.body.find((n) => n.type === 'VariableDeclaration').declarations[0].init.callee.body.body;
const code = body.filter((n) => (n.type === 'FunctionDeclaration' && ['tzNorm', 'tzCheck'].includes(n.id.name)) ||
  (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === 'tzSeen'))).map((n) => src.slice(n.start, n.end)).join('\n');
let fails = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { fails++; console.error('FAIL ' + name + ': ' + e.message); } }
function world(p) {
  const c = { p, saved: 0, reloaded: 0, toasts: [], PL: () => p, Store: { upsertPlaylist() { c.saved++; } }, Log: { info() {} }, U: { toast: (m) => c.toasts.push(m), pad: (n) => (n < 10 ? '0' : '') + n },
    I18n: { t: (s, v) => s.replace(/\{(\w)\}/g, (a, k) => v[k]) }, Library: {}, init() { c.reloaded++; }, setTimeout: (f) => f() };
  vm.createContext(c); vm.runInContext(code, c); return c;
}
const H = 3600e3, T0 = Date.UTC(2026, 10, 23, 18);
const short = [{ s: T0, t: 'Evening News' }, { s: T0 + H, t: 'Jeopardy!' }, { s: T0 + 2 * H, t: 'The Late Show' }];
const xmlAt = (shift) => short.map((x) => ({ s: x.s + shift, t: x.t }));

check('five hours ahead on one channel (three programmes): corrected by -300 minutes', () => {
  const c = world({ id: 'a', type: 'xtream', providerEpg: 'xmltv' });
  c.tzCheck({ k: 'c1' }, short, xmlAt(5 * H));
  assert.strictEqual(c.p.epgXmlFix, -300); assert.strictEqual(c.saved, 1); assert.strictEqual(c.reloaded, 1);
  assert.ok(/off by 5:00/.test(c.toasts[0]), c.toasts[0]);
});
check('one programme on one channel is not enough; a second channel agreeing is', () => {
  const c = world({ id: 'a', type: 'xtream', providerEpg: 'xmltv' });
  c.tzCheck({ k: 'c1' }, short.slice(0, 1), xmlAt(-H).slice(0, 1));
  assert.strictEqual(c.p.epgXmlFix, undefined);
  c.tzCheck({ k: 'c2' }, short.slice(1, 2), xmlAt(-H).slice(1, 2));
  assert.strictEqual(c.p.epgXmlFix, 60);
});
check('times that already agree, or channels that disagree, change nothing', () => {
  const c = world({ id: 'a', type: 'xtream', providerEpg: 'xmltv' });
  c.tzCheck({ k: 'c1' }, short, xmlAt(0));
  c.tzCheck({ k: 'c2' }, short.slice(0, 1), xmlAt(2 * H).slice(0, 1));
  c.tzCheck({ k: 'c3' }, short.slice(0, 1), xmlAt(3 * H).slice(0, 1));
  assert.strictEqual(c.p.epgXmlFix, undefined);
});
check('switched off, or an M3U, or the per-channel guide: never', () => {
  for (const p of [{ id: 'a', type: 'xtream', providerEpg: 'xmltv', epgTzAuto: false }, { id: 'b', type: 'm3u', providerEpg: 'xmltv' }, { id: 'c', type: 'xtream', providerEpg: 'short' }]) {
    const c = world(p); c.tzCheck({ k: 'c1' }, short, xmlAt(5 * H)); assert.strictEqual(p.epgXmlFix, undefined);
  }
});
check('a correction already made is followed back when the provider fixes its file', () => {
  const c = world({ id: 'a', type: 'xtream', providerEpg: 'xmltv', epgXmlFix: -300 });
  c.tzCheck({ k: 'c1' }, short, xmlAt(-5 * H));
  assert.strictEqual(c.p.epgXmlFix, 0);
});
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all guide time zone checks passed');
