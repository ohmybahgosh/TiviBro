/* TiviBro's screensaver (saver.js): when it starts (never over a playing video, over a paused one on its own
   clock, on other screens after "Starts after"), and which looks it shows (those turned on that have something). */
'use strict';
const fs = require('fs'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const ctx = { console, setInterval: () => 0, clearInterval: () => {}, Date, Math, String, JSON,
  document: { body: { classList: { contains: () => false } }, hidden: false, getElementById: () => null, querySelectorAll: () => [] },
  Store: { settings: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/js/saver.js', 'utf8') + '\nthis.Saver = Saver;', ctx);
const S = ctx.Saver, base = { enabled: true, hidden: false, full: false, paused: false, idle: 0, after: 300000, pausedAfter: 300000 };
ok('a menu left alone: on after "Starts after"', S._due(Object.assign({}, base, { idle: 300000 })) && !S._due(Object.assign({}, base, { idle: 299000 })));
ok('never over a video that plays', !S._due(Object.assign({}, base, { full: true, idle: 9e6 })));
ok('over a paused video: after its own wait', S._due(Object.assign({}, base, { full: true, paused: true, idle: 300000 })));
ok('…and never when that is "Never"', !S._due(Object.assign({}, base, { full: true, paused: true, idle: 9e6, pausedAfter: 0 })));
ok('turned off, or TiviBro in the background: never', !S._due(Object.assign({}, base, { enabled: false, idle: 9e6 })) && !S._due(Object.assign({}, base, { hidden: true, idle: 9e6 })));
ok('by default: clock and aurora (no Plex, no games to show)', S._ready().join() === 'clock,aurora', S._ready().join());
ctx.Store.settings.saverLooks = { clock: false, aurora: true };
ok('a look turned off is left out', S._ready().join() === 'aurora', S._ready().join());
ctx.Store.settings.saverLooks = { clock: false, aurora: false, library: false, teams: false };
ok('all turned off: the clock anyway', S._ready().join() === 'clock', S._ready().join());
ok('family-friendly: PG-13 and TV-14 in, R, TV-MA and no rating out', S._rated({ contentRating: 'PG-13' }) && S._rated({ contentRating: 'TV-14' }) && !S._rated({ contentRating: 'R' }) && !S._rated({ contentRating: 'TV-MA' }) && !S._rated({}));
ctx.Store.settings.saverRated = false;
ok('…and with the switch off, everything', S._rated({ contentRating: 'R' }) && S._rated({}));
ctx.Store.settings.saver = 'off';
ok('Screensaver off: it never holds the TV\'s back', !S.holds() && !S.enabled());
if (fail) { console.log(fail + ' screensaver test(s) failed'); process.exit(1); }
console.log('all screensaver tests passed');
