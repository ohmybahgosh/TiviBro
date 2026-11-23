// The logo index builder (scripts/logos/build-index.js) on a few sample entries from both projects.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-logos-')), out = path.join(dir, 'out');
const w = (n, x) => fs.writeFileSync(path.join(dir, n), JSON.stringify(x));
w('channels.json', [
  { id: 'CNN.us', name: 'CNN', alt_names: ['Cable News Network'], country: 'US' },
  { id: 'AE.us', name: 'A&E', alt_names: [], country: 'US' },
  { id: 'WXYZTV.us', name: 'WXYZ-TV', alt_names: [], country: 'US' },
  { id: 'BBCOne.uk', name: 'BBC One', alt_names: [], country: 'UK' },
  { id: 'Gone.us', name: 'Gone TV', alt_names: [], country: 'US', closed: '2020-01-01' },
  { id: 'France3.fr', name: 'France 3', alt_names: [], country: 'FR' }]);
w('logos.json', [
  { channel: 'CNN.us', feed: null, in_use: true, format: 'PNG', width: 512, url: 'https://example.org/cnn.png' },
  { channel: 'CNN.us', feed: 'East', in_use: true, format: 'PNG', width: 512, url: 'https://example.org/cnn-east.png' },
  { channel: 'AE.us', feed: null, in_use: true, format: 'SVG', width: 300, url: 'https://example.org/ae.svg' },
  { channel: 'WXYZTV.us', feed: null, in_use: true, format: 'PNG', width: 400, url: 'https://example.org/wxyz.png' },
  { channel: 'BBCOne.uk', feed: null, in_use: false, format: 'PNG', width: 400, url: 'https://example.org/old.png' },
  { channel: 'Gone.us', feed: null, in_use: true, format: 'PNG', width: 400, url: 'https://example.org/gone.png' }]);
w('tvlogos-tree.json', { tree: [
  { type: 'blob', path: 'countries/united-states/cnn-us.png' }, { type: 'blob', path: 'countries/united-states/cnn-light-us.png' },
  { type: 'blob', path: 'countries/united-states/a-and-e-hz-us.png' }, { type: 'blob', path: 'countries/united-states/a-and-e-us.png' },
  { type: 'blob', path: 'countries/united-states/us-local/abc-7-wxyz-us.png' }, { type: 'blob', path: 'countries/united-kingdom/bbc-one-uk.png' },
  { type: 'blob', path: 'countries/united-kingdom/old/bbc-two-uk.png' }, { type: 'blob', path: 'countries/international/bein-sports-1-int.png' },
  { type: 'blob', path: 'misc/vod/thing.png' }] });
const WTL = 'https://worldwide-tv-logos.github.io/database/logos/';
w('wtl.json', [
  { channel: 'AE.us', feed: null, in_use: true, url: WTL + 'us/AE.us.png', variant: null },
  { channel: 'AE.us', feed: null, in_use: true, url: WTL + 'us/AE.us.white.png', variant: 'white' },
  { channel: 'AE.us', feed: 'East', in_use: true, url: WTL + 'us/AE.us@East.png', variant: null },
  { channel: 'France3.fr', feed: null, in_use: true, url: WTL + 'fr/France3.fr.png', variant: null }]);
cp.execFileSync('node', [path.join(__dirname, '../../scripts/logos/build-index.js'), out, '--from', dir], { stdio: 'pipe' });
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };
const rd = f => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
const ix = rd('index.json'), us = rd('US.json'), uk = rd('UK.json');
const get = (f, k) => f.e.find(e => e[0] === k) || (f.x.find(x => x[0] === k) ? f.e[f.x.find(x => x[0] === k)[1]] : null);
ok('countries listed', ix.countries.US && ix.countries.UK && ix.countries.INT && !ix.countries.GB, JSON.stringify(ix.countries));
ok('no images, only addresses', !fs.readdirSync(out).some(f => !/\.json$/.test(f)));
ok('CNN: own logo (not a feed\'s) and the plain set logo', JSON.stringify(get(us, 'cnn')) === JSON.stringify(['cnn', 'CNN.us', 'https://example.org/cnn.png', 'united-states/cnn-us.png']), JSON.stringify(get(us, 'cnn')));
ok('other names', get(us, 'cablenewsnetwork') && get(us, 'cablenewsnetwork')[1] === 'CNN.us');
ok('A&E: plain beats horizontal', get(us, 'aande')[3] === 'united-states/a-and-e-us.png', JSON.stringify(get(us, 'aande')));
ok('call signs', get(us, 'wxyz') && get(us, 'wxyz')[3] === 'united-states/us-local/abc-7-wxyz-us.png', JSON.stringify(get(us, 'wxyz')));
ok('logos no longer in use and closed channels are left out', !get(us, 'gone') && !get(uk, 'bbcone')[2], JSON.stringify(get(uk, 'bbcone')));
ok('old folders are left out', !get(uk, 'bbctwo'));
const fr = rd('FR.json');
ok('worldwide-tv-logos: the white version for dark screens, the channel\'s own not an edition\'s', get(us, 'aande')[4] === 'us/AE.us.white.png', JSON.stringify(get(us, 'aande')));
ok('worldwide-tv-logos alone is enough for a channel', get(fr, 'france3') && get(fr, 'france3')[4] === 'fr/France3.fr.png' && !get(fr, 'france3')[2], JSON.stringify(get(fr, 'france3')));
ok('where its logos live is in the index', ix.wtl === WTL && ix.sources.length === 3);
console.log(fail ? fail + ' failures' : 'all ' + n + ' logo index tests passed');
process.exit(fail ? 1 : 0);
