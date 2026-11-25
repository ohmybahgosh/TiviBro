/* Updating never loses what a TV had saved (beta plan, "Upgrades and data"): the real store.js loads saves shaped
   like older versions' and keeps everything in them, upgrades the few settings whose defaults changed (and only
   the old defaults, never a choice made by hand), carries v0.1's single playlist over with its edits, and keeps
   keys it doesn't know (a newer version's, after going back).  A restored file can't reshape objects, and a backup
   from an older alpha restores whole and upgrades the same way.
     node tests/unit/upgrade-saves.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fail++; };
const SRC = fs.readFileSync(path.join(__dirname, '../../app/js/store.js'), 'utf8');

// The store on a TV whose browser storage holds mem (key -> string).
function boot(mem) {
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; },
    get length() { return Object.keys(mem).length; }, key: (i) => Object.keys(mem)[i] };
  const ctx = { console, localStorage, setTimeout, clearTimeout, Log: { info() {}, warn() {}, error() {}, debug() {} }, window: {},
    U: { debounce: (fn) => { const d = function () { fn.apply(this, arguments); }; d.cancel = () => {}; return d; }, hash: (s) => String(s.length) } };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.Store = Store;', ctx);
  return ctx.Store;
}
const J = (o) => JSON.stringify(o);

// v0.1: one "playlist" object and one set of edits, before there were several playlists.
{
  const mem = { 'tivibro.settings': J({ playlist: { type: 'xtream', server: 'http://old.example', user: 'me', pass: 'pw' }, accent: '#f2b33d' }),
    'tivibro.edits': J({ custom: [{ id: 'c_fav', name: 'Favorites', items: ['x1', 'x2'] }], hiddenGroups: { g9: 1 }, renames: { x1: 'My news' } }) };
  const S = boot(mem), p = S.settings.playlists[0];
  ok('v0.1: the single playlist becomes the first of the list, with its login', S.settings.playlists.length === 1 && p.server === 'http://old.example' && p.user === 'me' && p.pass === 'pw' && S.settings.active === p.id, S.settings.playlists);
  ok('v0.1: named after its login', p.name === 'me', p.name);
  const moved = JSON.parse(mem['tivibro.edits.' + p.id] || 'null');
  ok('v0.1: its edits go with it (Favorites, hidden groups, names)', moved && moved.custom[0].items.join() === 'x1,x2' && moved.hiddenGroups.g9 === 1 && moved.renames.x1 === 'My news', mem['tivibro.edits.' + p.id]);
  ok('v0.1: the old "playlist" key is gone from the settings', !('playlist' in S.settings));
  ok('the old amber colour becomes the 0.6 blue', S.settings.accent === '#5b8cff', S.settings.accent);
}

// Settings from the alphas: the old defaults move on, anything chosen by hand stays.
{
  const old = { playlists: [{ id: 'pA', type: 'm3u', m3u: 'http://a.example/a.m3u', name: 'A' }, { id: 'pB', type: 'stalker', portal: 'http://b.example/c/', mac: '00:1A:79:00:00:01', name: 'B', off: true }],
    active: 'pA', buffer: 'balanced', remindTimeout: 20, nowStyle: 'tint', startTab: 'live', rewindBuffer: 30, subWarnDays: 7, vodLangFolders: true, dns: 'custom', dnsServer: '1.1.1.1' };
  const S = boot({ 'tivibro.settings': J(old) }), s = S.settings;
  ok('alpha 78: the old Balanced buffer becomes Automatic', s.buffer === 'auto', s.buffer);
  ok('alpha 110: reminders that closed after 20 s close after 10', +s.remindTimeout === 10, s.remindTimeout);
  ok('alpha 94: the old now-tint becomes the now line', s.nowStyle === 'line', s.nowStyle);
  ok('every playlist kept as it was, the off one still off', s.playlists.length === 2 && s.playlists[1].off === true && s.playlists[1].mac === '00:1A:79:00:00:01' && s.active === 'pA', s.playlists);
  ok('everything else as it was set', s.startTab === 'live' && s.rewindBuffer === 30 && s.subWarnDays === 7 && s.vodLangFolders === true && s.dns === 'custom' && s.dnsServer === '1.1.1.1', s);
  ok('settings added since then get their defaults', Object.keys(S.DEFAULTS).every((k) => k in s));
}
{
  const S = boot({ 'tivibro.settings': J({ buffer: 'smooth', remindTimeout: 30, accent: '#e0457b', nowStyle: 'color', buf2: 0 }) }), s = S.settings;
  ok('chosen by hand: the buffer, reminder time, colour and now style stay', s.buffer === 'smooth' && +s.remindTimeout === 30 && s.accent === '#e0457b' && s.nowStyle === 'color', [s.buffer, s.remindTimeout, s.accent, s.nowStyle]);
}
{
  // Each upgrade runs once: a later change back to an old default is the viewer's and is kept.
  const mem = { 'tivibro.settings': J({ buffer: 'balanced' }) };
  let S = boot(mem); S.settings.buffer = 'balanced'; S.saveSettings();
  S = boot(mem);
  ok('an upgrade runs once: Balanced picked again later stays Balanced', S.settings.buffer === 'balanced', S.settings.buffer);
}

// A newer version's settings, after going back to this one: kept, so going forward again finds them.
{
  const mem = { 'tivibro.settings': J({ futureThing: { a: 1 }, playlists: [{ id: 'p1', type: 'm3u', m3u: 'http://x/x.m3u' }], active: 'p1' }) };
  const S = boot(mem);
  ok('a key this version doesn\'t know is kept', S.settings.futureThing && S.settings.futureThing.a === 1);
  S.saveSettings();
  ok('...and saved again with the rest', JSON.parse(mem['tivibro.settings']).futureThing.a === 1, mem['tivibro.settings']);
}

// The first playlist's edits: watched marks, resume points, My list, reminders and Favorites all load.
{
  const ed = { custom: [{ id: 'c_fav', name: 'Favorites', items: ['k1'] }, { id: 'c_2', name: 'Sports', items: ['k2', 'k3'] }], watched: { 'm:1': 1 }, resume: { 'm:2': { pos: 300, dur: 6000, at: 1 } },
    myList: ['m:3'], reminders: [{ k: 'k1', s: 1, e: 2, t: 'Game' }], hiddenChannels: { k9: 1 }, epgMap: { k1: 'news.us' } };
  const S = boot({ 'tivibro.settings': J({ playlists: [{ id: 'p1', type: 'm3u', m3u: 'http://x/x.m3u' }], active: 'p1' }), 'tivibro.edits.p1': J(ed) });
  const e = S.edits;
  ok('edits load whole: Favorites and your groups', e.custom.length === 2 && e.custom[1].items.join() === 'k2,k3', e.custom);
  ok('watched marks, resume points, My list, reminders, hidden channels and guide matches', e.watched['m:1'] === 1 && e.resume['m:2'].pos === 300 && e.myList[0] === 'm:3' && e.reminders[0].t === 'Game' && e.hiddenChannels.k9 === 1 && e.epgMap.k1 === 'news.us', e);
}

// A restored file can't reshape objects (a backup from anywhere goes through the same merge).
{
  const S = boot({ 'tivibro.settings': '{"__proto__":{"polluted":1},"constructor":{"x":1},"startTab":"guide"}' });
  ok('__proto__ and constructor in a saved file are ignored', !({}).polluted && S.settings.startTab === 'guide' && !Object.prototype.hasOwnProperty.call(S.settings, '__proto__'));
}
// Broken storage never stops TiviBro: defaults, and the file isn't overwritten until something is saved.
{
  const mem = { 'tivibro.settings': '{not json' };
  const S = boot(mem);
  ok('unreadable settings: TiviBro starts on the defaults', S.settings.playlists.length === 0 && S.settings.buffer === 'auto', S.settings);
  ok('...and the file is left as it was until something is saved', mem['tivibro.settings'] === '{not json', mem['tivibro.settings']);
}

// A backup made by an older alpha, restored through the real Backup.restore (app/js/webedit.js), then the store
// starting on what it wrote: the upgrades apply, nothing in the backup is lost, and this TV's own keys stay.
(async () => {
  const web = fs.readFileSync(path.join(__dirname, '../../app/js/webedit.js'), 'utf8');
  const from = web.indexOf('var Backup = (function'), to = web.indexOf('})();', from) + 5;
  const mem = { 'tivibro.settings': J({ playlists: [{ id: 'now', type: 'm3u', m3u: 'http://now.example/a.m3u' }], active: 'now', editorPass: 'this-tv', editorPort: 8090 }),
    'tivibro.edits.keep': J({ myList: ['m:keep'] }) };
  const bigs = {};
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const ctx = { console, localStorage, Promise, JSON, Log: { info() {} },
    Store: { settings: JSON.parse(mem['tivibro.settings']), freeze() {}, bigSet: (k, v) => { bigs[k] = v; return Promise.resolve(); } } };
  vm.createContext(ctx);
  vm.runInContext(web.slice(from, to) + '\nthis.Backup = Backup;', ctx);
  const backup = { app: 'TiviBro', kind: 'backup', format: 2, version: '0.6.0-alpha.120', created: '2026-11-10T20:00:00.000Z',
    settings: { playlists: [{ id: 'p1', type: 'xtream', server: 'http://prov.example', user: 'u', pass: 'p', name: 'Home' }, { id: 'p2', type: 'm3u', m3u: 'http://two.example/b.m3u', name: 'Two', off: true }],
      active: 'gone', buffer: 'balanced', remindTimeout: 20, startTab: 'live', editorPass: 'from-the-backup' },
    edits: { p1: { custom: [{ id: 'c_fav', name: 'Favorites', items: ['k1', 'k2'] }], watched: { 'm:1': 1 }, reminders: [{ k: 'k1', s: 1, e: 2, t: 'Game' }] }, p2: { hiddenGroups: { g: 1 } } },
    snaps: { p1: [{ name: 'Before the cleanup', at: 1 }] } };
  const r = await ctx.Backup.restore(backup);
  ok('an older alpha\'s backup restores: both playlists', r.playlists === 2, r);
  const S = boot(mem), s = S.settings;
  ok('...the playlist it was on is gone: the first one is used', s.active === 'p1', s.active);
  ok('...its old defaults upgrade on the next start, its choices stay', s.buffer === 'auto' && +s.remindTimeout === 10 && s.startTab === 'live' && s.playlists[1].off === true, s);
  ok('...this TV\'s own web editor password and port stay', s.editorPass === 'this-tv' && s.editorPort === 8090, [s.editorPass, s.editorPort]);
  ok('...each playlist\'s Favorites, watched marks, reminders and hidden groups', S.edits.custom[0].items.join() === 'k1,k2' && S.edits.watched['m:1'] === 1 && S.edits.reminders[0].t === 'Game' && JSON.parse(mem['tivibro.edits.p2']).hiddenGroups.g === 1, S.edits);
  ok('...its restore points', bigs['snaps:p1'] && bigs['snaps:p1'][0].name === 'Before the cleanup', bigs);
  ok('...edits of a playlist not in the backup are left alone', JSON.parse(mem['tivibro.edits.keep']).myList[0] === 'm:keep');
  let refused = ''; try { ctx.Backup.check({ app: 'TiviBro', kind: 'backup', settings: {} }); } catch (e) { refused = e.message; }
  ok('a file that isn\'t a whole backup is refused before anything changes', /no playlists/.test(refused), refused);
})().catch((e) => { ok('restore: ' + e.message, false); }).then(() => {
  console.log(fail ? fail + ' upgrade check(s) failed' : 'all upgrade checks passed');
  process.exit(fail ? 1 : 0);
});
