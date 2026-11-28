/* TiviBro's screensaver (saver.js): when it starts (never while a video plays anywhere, over a paused one on its own
   clock, with nothing playing after "Starts after"), and which looks it shows (those turned on that have something). */
'use strict';
const fs = require('fs'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
let tick = null;
const ctx = { console, setInterval: (f) => { if (!tick) tick = f; return 0; }, clearInterval: () => {}, Date, Math, String, JSON,
  document: { body: { classList: { contains: () => false }, appendChild: () => {} }, hidden: false, getElementById: () => null, querySelectorAll: () => [],
    createElement: () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '' }) },
  Store: { settings: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/js/saver.js', 'utf8') + '\nthis.Saver = Saver;', ctx);
const S = ctx.Saver, base = { enabled: true, hidden: false, playing: false, paused: false, idle: 0, after: 300000, pausedAfter: 300000 };
ok('a menu left alone: on after "Starts after"', S._due(Object.assign({}, base, { idle: 300000 })) && !S._due(Object.assign({}, base, { idle: 299000 })));
ok('never over a video that plays', !S._due(Object.assign({}, base, { playing: true, idle: 9e6 })));
ok('…full screen or not: a paused one counts wherever it is', S._due(Object.assign({}, base, { paused: true, idle: 300000 })) && !S._due(Object.assign({}, base, { paused: true, idle: 299000 })));
ok('over a paused video: after its own wait', S._due(Object.assign({}, base, { paused: true, idle: 300000 })));
ok('…and never when that is "Never"', !S._due(Object.assign({}, base, { paused: true, idle: 9e6, pausedAfter: 0 })));
ok('turned off, or TiviBro in the background: never', !S._due(Object.assign({}, base, { enabled: false, idle: 9e6 })) && !S._due(Object.assign({}, base, { hidden: true, idle: 9e6 })));
ok('by default: clock, aurora and the bouncing logo (no Plex, no games to show)', S._ready().join() === 'clock,aurora,bounce', S._ready().join());
ctx.Store.settings.saverLooks = { clock: false, aurora: true, bounce: false };
ok('a look turned off is left out', S._ready().join() === 'aurora', S._ready().join());
ctx.Store.settings.saverLooks = { clock: false, aurora: false, library: false, teams: false, bounce: false };
ok('all turned off: the clock anyway', S._ready().join() === 'clock', S._ready().join());
ok('family-friendly: PG-13 and TV-14 in, R, TV-MA and no rating out', S._rated({ contentRating: 'PG-13' }) && S._rated({ contentRating: 'TV-14' }) && !S._rated({ contentRating: 'R' }) && !S._rated({ contentRating: 'TV-MA' }) && !S._rated({}));
ctx.Store.settings.saverRated = false;
ok('…and with the switch off, everything', S._rated({ contentRating: 'R' }) && S._rated({}));
(async () => {
/* Turn the screen off instead (discussion #184): with nothing playing the helper is asked to turn it off; the first
   button turns it on again and is used up; where the TV refuses, the looks show instead. */
const asked = []; let refuse = false;
ctx.Net = { port: 1, ctlFetch: (u, o) => { asked.push(JSON.parse(o.body).on); return Promise.resolve({ ok: !refuse, status: refuse ? 409 : 200, json: () => Promise.resolve(refuse ? { error: 'refused' } : { ok: true }) }); } };
ctx.Store.settings.saverScreenOff = true; ctx.Store.settings.saverAfter = 2;
S.start(); S.activity();
const realNow = Date.now; let fake = realNow();
ctx.Date = class extends Date {}; ctx.Date.now = () => fake;
const wait = () => new Promise((r) => setTimeout(r, 5));
fake += 3 * 60000; tick(); await wait();
ok('nothing playing: the screen is turned off, not a look', S.dark && !S.on && asked.join() === 'false', asked.join());
ok('the first button only turns it on again', S.activity() === true && !S.dark && asked.join() === 'false,true');
ctx.Player = { current: { n: 'x' }, userPaused: true }; ctx.Store.settings.saverPaused = 2;
fake += 3 * 60000; tick(); await wait();
ok('over a paused video: the looks, not the screen off', S.on && !S.dark);
S.activity(); ctx.Player = { current: null, userPaused: false }; refuse = true;
fake += 3 * 60000; tick(); await wait(); await wait();
ok('the TV refuses: the looks show instead', S.on && !S.dark);
S.activity();
ctx.Store.settings.saver = 'off';
ok('Screensaver off: it never holds the TV\'s back', !S.holds() && !S.enabled());
if (fail) { console.log(fail + ' screensaver test(s) failed'); process.exit(1); }
console.log('all screensaver tests passed');
})();
