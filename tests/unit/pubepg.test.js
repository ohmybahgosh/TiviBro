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
  assert.deepStrictEqual(f.map(x => x.name + ' ' + x.cc), ['epg.pw US', 'iptv-epg.org US', 'iptv-epg.org AR', 'epgshare01 AR']);
  assert.strictEqual(f[0].url, 'https://epg.pw/xmltv/epg_US.xml.gz');
  assert.strictEqual(f[1].url, 'https://iptv-epg.org/files/epg-us.xml.gz');
  assert.deepStrictEqual(P.files(['US'], false, false).map(x => x.url), ['https://epg.pw/xmltv/epg_US.xml']);
  assert.strictEqual(P.sourceOf('iptvepg:US/AMC.us').name, 'iptv-epg.org');
  assert.strictEqual(P.sourceOf('AMC.us'), null);
});
t('epgshare01: third, through the helper, a country in several files gets each, the UK is UK1, not the US', () => {
  const f = P.files(['IN', 'GB', 'US'], true, true).filter(x => x.src === 'epgshare01');
  assert.deepStrictEqual(f.map(x => x.url.split('/').pop()), ['epg_ripper_IN1.xml.gz', 'epg_ripper_IN2.xml.gz', 'epg_ripper_IN4.xml.gz', 'epg_ripper_UK1.xml.gz']);
  assert.strictEqual(f[0].prefix, 'epgshare01:IN/');
  assert.strictEqual(P.files(['IN'], false, true).filter(x => x.src === 'epgshare01').length, 0, 'not without the helper');
  assert.strictEqual(P.sourceOf('epgshare01:GR/ERT1.gr').name, 'epgshare01');
  assert.strictEqual(P.supported('JM'), true);
});
t('the helper\'s guide reader normalises names exactly like the app (service/guide.js and epg.js)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/js/epg.js'), 'utf8');
  const m = /function norm\(s\) \{[\s\S]*?\n  \}/.exec(src);
  const appNorm = new Function('return ' + m[0].replace(/\n  /g, '\n'))();
  const G = require('../../service/guide.js');
  ['CNN HD', 'US: A&E (East) FHD', 'BBC One [UK]', 'ESPN 2 4K', 'Télé-Québec', ''].forEach(x => assert.strictEqual(G.norm(x), appNorm(x), x));
});
t('regional versions share their broadcaster\'s guide as a last key, the same in the helper and the app (issue #131)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/js/epg.js'), 'utf8');
  const G = require('../../service/guide.js');
  const m = /function regional\(s\) \{[\s\S]*?\n  \}/.exec(src);
  const appRg = new Function('norm', 'unprefixed', 'return ' + m[0].replace(/\n  /g, '\n'))(G.norm, G.unprefixed);
  const names = ['NDR Fernsehen HH', 'DE: NDR FERNSEHEN MV', 'NDR SH', 'NDR Fernsehen', 'MDR Thüringen', 'BR Fernsehen Süd', 'WDR Köln', 'ORF 2 Wien', 'UK: BBC 1 London', 'BBC One Scotland HD', 'NDR Info', 'BR24', 'Sky Sport 1', 'Brazil TV', ''];
  names.forEach((x) => assert.strictEqual(G.regional(x), appRg(x), x));
  ['NDR Fernsehen HH', 'DE: NDR FERNSEHEN MV', 'NDR SH'].forEach((x) => assert.strictEqual(G.regional(x), G.regional('NDR Fernsehen'), x));
  assert.strictEqual(G.regional('UK: BBC 1 London'), G.regional('BBC One Scotland HD'));
  ['NDR Info', 'BR24', 'Sky Sport 1', 'Brazil TV'].forEach((x) => assert.strictEqual(G.regional(x), '', x + ' is no regional version'));
});
t('a name without its prefix is the second key, the same in the helper and the app (issue #131)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/js/epg.js'), 'utf8');
  const m = /function unprefixed\(s\) \{[\s\S]*?\n  \}/.exec(src);
  const appUn = new Function('return ' + m[0].replace(/\n  /g, '\n'))();
  const G = require('../../service/guide.js');
  const key = (n) => G.norm(G.unprefixed(n));
  assert.strictEqual(key('PRIME: ZDFINFO ᴿᴬᵂ'), key('DE: ZDFINFO HD'));
  assert.strictEqual(key('JOYN: BR FERNSEHEN SÜD ᴿᴬᵂ'), key('DE: BR FERNSEHEN HD SÜD'));
  assert.strictEqual(key('PLAY+: ZDF INFO ᴿᴬᵂ'), 'zdfinfo');
  assert.strictEqual(G.unprefixed('Mr. Bean: The Show'), '', 'only a short capitals tag is a prefix');
  assert.strictEqual(G.unprefixed('NBA: Game 1'), '', 'an event\'s number alone is no name');
  ['PRIME: ZDFINFO ᴿᴬᵂ', 'DE| 3SAT', 'Mr. Bean: The Show', 'NBA: Game 1', 'CNN', ''].forEach(x => assert.strictEqual(G.unprefixed(x), appUn(x), x));
  const t = /function tagCountry\(s\) \{[\s\S]*?\n  \}/.exec(src);
  const appCc = new Function('return ' + t[0].replace(/\n  /g, '\n'))();
  // A channel tagged with a country asks for "~cc:name"; a guide channel gives "~name", and "~cc:name" when it has a country too.
  const chKey = (n) => '~' + (G.tagCountry(n) ? G.tagCountry(n) + ':' : '') + key(n);
  const guideKeys = (n) => ['~' + key(n)].concat(G.tagCountry(n) ? ['~' + G.tagCountry(n) + ':' + key(n)] : []);
  assert.ok(guideKeys('DE: ZDFINFO HD').includes(chKey('PRIME: ZDFINFO ᴿᴬᵂ')), 'a service tag finds a country\'s channel');
  assert.ok(guideKeys('DE: 3SAT HD').includes(chKey('DE| 3SAT')), 'the same country finds it');
  assert.ok(!guideKeys('US: TNT HD').includes(chKey('AR: TNT')), 'another country\'s channel is not it');
  assert.ok(!guideKeys('PLAY+: 3SAT').includes(chKey('AT| 3SAT')), 'a country\'s channel needs a guide channel of that country');
  ['DE: X', 'AR| TNT', 'PRIME: X', 'CNN', ''].forEach(x => assert.strictEqual(G.tagCountry(x), appCc(x), x));
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
  // Samsung TV Plus, Plex and Roku: the channel's own id is the guide's, as it is; Plex and Roku have one file for every country.
  assert.strictEqual(P.appId('USBA370000104'), 'USBA370000104');
  assert.strictEqual(P.appId('6a1610bebdf296985fd95603-66635fc0ca7b22f4c3a2d743'), '6a1610bebdf296985fd95603-66635fc0ca7b22f4c3a2d743');
  assert.strictEqual(P.appId('483af83e821059b8b3f0825ae2d43e31'), '483af83e821059b8b3f0825ae2d43e31');
  assert.strictEqual(P.appId('ESPNHD'), '', 'an ordinary id is not Samsung\'s');
  assert.strictEqual(P.appId('XXBA370000104'), '', 'a country Samsung has no guide for');
  const f2 = P.appFiles(['USBA370000101', 'USBA370000102', 'USBA370000103', '483af83e821059b8b3f0825ae2d43e31', '483af83e821059b8b3f0825ae2d43e32', '483af83e821059b8b3f0825ae2d43e33'].map(epg => ({ epg })), true);
  assert.deepStrictEqual(f2.map(x => x.url), ['https://i.mjh.nz/SamsungTVPlus/us.xml.gz', 'https://i.mjh.nz/Roku/all.xml.gz']);
  assert.strictEqual(f2[1].cc, '');
});
console.log(n + ' passed');
