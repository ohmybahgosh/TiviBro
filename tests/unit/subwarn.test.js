// A warning before a provider's subscription ends (app/js/subwarn.js): which playlists are due, once a day,
// muted for one end date only, and the words for days left, today and ended.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const DAY = 86400000, now = new Date(2026, 10, 23, 12).getTime();

// subwarn.js with a Store of its own: playlists ending at the given offsets from now (in days).
function load(settings) {
  const ctx = {
    console, setTimeout, clearInterval, setInterval: () => 0,
    Store: { settings, saveSettings() {} },
    I18n: { t: (s, v) => String(s).replace(/\{(\w+)\}/g, (a, k) => (v && v[k] != null ? v[k] : a)) },
    U: { loc: () => 'en-US', el: () => ({ appendChild() {} }) }, Log: { info() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/subwarn.js'), 'utf8') + '\nthis.SubWarn = SubWarn;', ctx);
  return ctx.SubWarn;
}
const pl = (id, days, extra) => Object.assign({ id, name: 'List ' + id, exp: now + days * DAY - 1000 }, extra || {});

let s = { subWarnDays: 3, subWarned: {}, playlists: [pl('a', 2), pl('b', 10), pl('c', -3), pl('d', 1, { off: true }), pl('e', -45), { id: 'f', name: 'No date' }] };
let W = load(s);
let due = W.due(now).map((x) => x.p.id + ':' + x.days);
ok('within 3 days and just ended are due; later, off, long gone and no date are not', due.join() === 'a:2,c:-3', due);
s.subWarned = { a: new Date(now).getFullYear() + '-' + (new Date(now).getMonth() + 1) + '-' + new Date(now).getDate() };
ok('told today: not again today', W.due(now).map((x) => x.p.id).join() === 'c');
ok('but again tomorrow', W.due(now + DAY).some((x) => x.p.id === 'a'));
s.playlists[0].subWarnMuted = s.playlists[0].exp;
ok('"Not for this playlist" mutes that end date', !W.due(now + DAY).some((x) => x.p.id === 'a'));
s.playlists[0].exp += 30 * DAY;
s.playlists[0].exp -= 29 * DAY;
ok('a renewal (a new end date) brings the warnings back', W.due(now + DAY).some((x) => x.p.id === 'a'));
s.subWarnDays = 0;
ok('Off: nothing is due', W.due(now).length === 0);

const text = (days) => W.text({ p: pl('x', days), days });
ok('days left, with the date', /ends in 2 days \(/.test(text(2)), text(2));
ok('one day left', /ends in 1 day \(/.test(text(1)), text(1));
ok('today', /ends today/.test(text(0)), text(0));
ok('ended', /ended on /.test(text(-3)), text(-3));

console.log(fails ? fails + ' failures' : 'all subscription warning tests passed');
process.exit(fails ? 1 : 0);
