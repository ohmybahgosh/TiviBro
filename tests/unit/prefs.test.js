// Preferred audio language, the language reader behind it, and the watchlist's whole-word match.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const ctx = {
  console, Math, JSON, Object, Array, String, RegExp, isFinite, Infinity, Promise, Date, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { userAgent: 'Web0S Chrome/87' }, MediaSource: { isTypeSupported: () => true },
  document: { createElement: () => ({ canPlayType: () => 'maybe' }), getElementById: () => null, addEventListener() {} },
  Store: { settings: {}, edits: { display: {}, reminders: [], hiddenChannels: {}, hiddenGroups: {} } },
  Source: {}, Net: { wrap: u => u }, Log: { info() {}, warn() {}, error() {}, debug() {} }, addEventListener() {}
};
ctx.window = ctx;
vm.createContext(ctx);
const load = (f, name) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + name + ' = ' + name + ';', ctx);
load('util.js', 'U'); load('caps.js', 'Caps'); load('player.js', 'Player');
const U = ctx.U, P = ctx.Player;

// Track names the way streams send them.
[['eng', 'en'], ['en-US', 'en'], ['English', 'en'], ['ENG 5.1', 'en'], ['Español (Latino)', 'es'], ['spa', 'es'], ['Deutsch', 'de'], ['ger', 'de'],
 ['nld', 'nl'], ['dut', 'nl'], ['nl-NL', 'nl'], ['Nederlands', 'nl'], ['fre', 'fr'], ['Audio Description (English)', 'en'], ['und', ''], ['Track 2', ''], ['', '']].forEach(function (c) {
  ok('language of "' + c[0] + '"', U.lang(c[0]) === c[1], U.lang(c[0]));
});

const pick = (list, want, surround, fallback) => { const b = P.bestAudio(list, want, surround, fallback); return b ? b.id : null; };
const tracks = [{ id: 0, label: 'Spanish', lang: 'spa', on: true }, { id: 1, label: 'English', lang: 'eng', on: false },
  { id: 2, label: 'English AD', lang: 'eng', on: false }, { id: 3, label: 'English 5.1', lang: 'eng', ch: 6, on: false }];
ok('nothing chosen: leave the stream alone', pick(tracks, '', false) === null);
ok('English picked over the playing Spanish', pick(tracks, 'en', false) === 1, pick(tracks, 'en', false));
ok('surround in that language when asked', pick(tracks, 'en', true) === 3, pick(tracks, 'en', true));
ok('audio description skipped', pick(tracks.slice(0, 3).reverse(), 'en', false) === 1);
ok('only described in that language: still that language', pick([{ id: 0, label: 'French', lang: 'fra', on: true }, { id: 1, label: 'English AD', lang: 'eng' }], 'en', false) === 1);
ok('no track in that language: keeps what plays', pick([{ id: 0, label: 'French', lang: 'fra', on: true }, { id: 1, label: 'German', lang: 'deu' }], 'en', false) === 0);
ok('Dutch takes priority over the English fallback', pick([{ id: 0, lang: 'eng', on: true, ch: 6 }, { id: 1, lang: 'dut' }], 'nl', true, 'en') === 1);
ok('missing Dutch falls back to English ahead of the active Spanish', pick(tracks, 'nl', false, 'en') === 1);
ok('fallback language can be changed', pick(tracks, 'nl', false, 'es') === 0);
ok('no fallback (the default): missing Dutch keeps the track playing', pick([{ id: 0, lang: 'fra' }, { id: 1, lang: 'deu', on: true }], 'nl', false) === 1);
ok('neither language there: keeps the track playing', pick([{ id: 0, lang: 'fra' }, { id: 1, lang: 'deu', on: true }], 'nl', false, 'en') === 1);
ok('a preferred described track still beats another language', pick([{ id: 0, lang: 'eng' }, { id: 1, lang: 'nld', label: 'Dutch AD' }], 'nl', false) === 1);
ok('Dolby named in the label counts as surround', P.describeTrack({ label: 'English Dolby Digital Plus' }).surround && !P.describeTrack({ label: 'English Stereo' }).surround);

// The watchlist's whole-word match (search.js).
ctx.Library = { data: { channels: [] } }; ctx.Epg = {}; ctx.Events = {}; ctx.Views = {}; ctx.UI = {}; ctx.VList = function () {};
load('search.js', 'Search');
const m = ctx.Search.matcher('cars', true), any = ctx.Search.matcher('cars', false);
ok('whole word: "Cars 3" matches', m('Cars 3'));
ok('whole word: "Oscars" does not', !m('The Oscars'));
ok('whole word: punctuation is a boundary', m('Fast: Cars!') && ctx.Search.matcher('yankees', true)('MLB: Yankees @ Red Sox'));
ok('typed search: anywhere in the title', any('The Oscars'));
ok('whole phrase', ctx.Search.matcher('premier league', true)('Premier League: Arsenal v Spurs') && !ctx.Search.matcher('premier league', true)('Premier Leagues'));

console.log(fail ? fail + ' failures' : 'all preference tests passed');
process.exit(fail ? 1 : 0);
