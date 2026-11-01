/* Public guide fill-in (app/js/pubepg.js): matching keys, country choice and which files to try. */
'use strict';
const assert = require('assert');
global.Tidy = require('../../app/js/tidy.js');
Object.defineProperty(global, 'navigator', { value: { language: 'en-US' }, configurable: true, writable: true });
const P = require('../../app/js/pubepg.js');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok ' + name); }
const K = s => P.keys(s).keys.map(x => x[0]);

t('local stations match by call sign, in every style', () => {
  [['ABC (WOTV) Battle Creek MI', 'cs:WOTV'], ['US - ABC WOTV Grand Rapids Battle Creek MI', 'cs:WOTV'], ['WOTV-DT', 'cs:WOTV'], ['ABC | DETROIT | WXYZ', 'cs:WXYZ'],
    ['US - CBS WBZ Boston', 'cs:WBZ'], ['CBS (WBZ) Boston MA', 'cs:WBZ'], ['US - ABC East WABC', 'cs:WABC'], ['CW (WISH-TV) Indianapolis IN', 'cs:WISH'], ['WBMA-LD', 'cs:WBMA']]
    .forEach(([s, k]) => assert.ok(K(s).indexOf(k) >= 0, s + ' -> ' + K(s)));
});
t('subchannels stay apart from the main station', () => {
  assert.ok(K('NBC (KADNDT2) Lafayette LA').indexOf('cs:KADN:2') >= 0);
  assert.ok(K('US - CW WOTV-DT2 Grand Rapids').indexOf('cs:WOTV:2') >= 0);
  assert.ok(K('KCOP-DT').indexOf('cs:KCOP') >= 0);
});
t('words are not call signs', () => {
  ['DIGI WORLD', 'KBS World 24', 'Pink World Cinema', 'Oxygen (West)', 'WWE Network', 'KIDS TV', 'Weather Channel'].forEach(s => assert.ok(!K(s).some(k => /^cs:/.test(k)), s + ' -> ' + K(s)));
});
t('names match across the projects\' styles, keeping East and West apart', () => {
  assert.strictEqual(K('A&E (East) US').pop(), K('US - A&amp;E Network').pop());
  assert.strictEqual(K('A&E (West) US').pop(), K('US - A&E Network West').pop());
  assert.notStrictEqual(K('A&E (West) US').pop(), K('A&E (East) US').pop());
  assert.strictEqual(K('HGTV (West) US').pop(), K('US - HGTV WEST').pop());
  assert.strictEqual(K('Heroes & Icons Network').pop(), K('Heroes and Icons').pop());
  assert.ok(K('USA Network (East)').length, 'all-stop-word names still get a key');
});
t('a "prefix" that was the whole name still gives a key', () => {
  assert.deepStrictEqual(K('CNN - HD'), ['n:cnn']);
  assert.strictEqual(P.keys('CNN - HD').country, '');
});
t('a service prefix is read as the country', () => {
  assert.strictEqual(P.keys('US - CNN').country, 'US');
  assert.strictEqual(P.keys('PLUTO - CNN Headlines').country, 'PLUTO');
});
t('countries: the ones the channels needing a guide belong to, up to four, plus the TV\'s', () => {
  const groups = [{ id: 'g1', name: 'USA | Entertainment' }, { id: 'g2', name: 'USA | Sports' }, { id: 'g3', name: 'UK | Entertainment' }, { id: 'g4', name: 'UK | News' }, { id: 'g5', name: 'PPV Events' }];
  const ch = (g, i) => ({ k: g + i, n: 'Channel ' + i, g: g });
  const channels = [].concat(...['g1', 'g2', 'g3', 'g4', 'g5'].map(g => [1, 2, 3, 4].map(i => ch(g, i))));
  const data = { groups, channels };
  assert.deepStrictEqual(P.countriesFor({}, channels, data), ['US', 'GB']);
  assert.deepStrictEqual(P.countriesFor({}, channels.filter(c => c.g === 'g3'), data), ['GB']);
  assert.deepStrictEqual(P.countriesFor({ pubEpg: { cc: ['ca', 'UK', 'XX'] } }, channels, data), ['CA', 'GB']);
  assert.deepStrictEqual(P.countriesFor({}, [], data), []);
});
t('on unless turned off', () => {
  assert.strictEqual(P.conf({}).on, true);
  assert.strictEqual(P.conf({ pubEpg: { on: false } }).on, false);
});
t('files: lighter project first; iptv-epg.org only through the helper; plain files when the TV can\'t unzip', () => {
  const f = P.files(['US', 'AR'], true, true);
  assert.deepStrictEqual(f.map(x => x.name + ' ' + x.cc), ['epg.pw US', 'iptv-epg.org US', 'iptv-epg.org AR']);
  assert.strictEqual(f[0].url, 'https://epg.pw/xmltv/epg_US.xml.gz');
  assert.strictEqual(f[1].url, 'https://iptv-epg.org/files/epg-us.xml.gz');
  assert.deepStrictEqual(P.files(['US'], false, false).map(x => x.url), ['https://epg.pw/xmltv/epg_US.xml']);
  assert.strictEqual(P.sourceOf('iptvepg:US/AMC.us').name, 'iptv-epg.org');
  assert.strictEqual(P.sourceOf('AMC.us'), null);
});
t('the helper\'s guide reader normalises names exactly like the app (service/guide.js and epg.js)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/js/epg.js'), 'utf8');
  const m = /function norm\(s\) \{[\s\S]*?\n  \}/.exec(src);
  const appNorm = new Function('return ' + m[0].replace(/\n  /g, '\n'))();
  const G = require('../../service/guide.js');
  ['CNN HD', 'US: A&E (East) FHD', 'BBC One [UK]', 'ESPN 2 4K', 'Télé-Québec', ''].forEach(x => assert.strictEqual(G.norm(x), appNorm(x), x));
});
t('Pluto channels match Pluto\'s own guide by id', () => {
  assert.strictEqual(P.appId('US_5ca525b650be2571e3943c63'), '5ca525b650be2571e3943c63');
  assert.strictEqual(P.appId('CNN.us'), '');
  assert.strictEqual(P.appId('XX_5ca525b650be2571e3943c63'), '');
  const miss = ['US_5ca525b650be2571e3943c63', 'US_5ca525b650be2571e3943c64', 'US_5ca525b650be2571e3943c65', 'CA_5ca525b650be2571e3943c66'].map((e, i) => ({ k: 'k' + i, n: 'Pluto ' + i, epg: e }));
  const f = P.appFiles(miss, true);
  assert.strictEqual(f.length, 1, 'only regions with three or more channels');
  assert.strictEqual(f[0].url, 'https://i.mjh.nz/PlutoTV/us.xml.gz');
  assert.strictEqual(f[0].prefix, 'mjhpluto:US/');
  assert.strictEqual(P.appFiles(miss, false).length, 0, 'gzip only: TVs that cannot unzip skip it');
  assert.strictEqual(P.sourceOf('mjhpluto:US/abc').name, 'i.mjh.nz Pluto TV');
});
console.log(n + ' passed');
