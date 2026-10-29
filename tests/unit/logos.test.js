// Logo library (app/js/logos.js): which channels get which logo, from a small index shaped like the
// one scripts/logos/build-index.js writes.  No network: the index is answered from memory.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Map, Set, Promise, JSON, navigator: { language: 'en-US' } });
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8'), ctx, { filename: f });
const INDEX = { v: 1, tvlogos: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/', countries: { US: 5, UK: 1, CA: 1, INT: 1 } };
const FILES = {
  index: INDEX,
  US: { e: [['cnn', 'CNN.us', 'https://example.org/cnn.png', 'united-states/cnn-us.png'], ['espn2', 'ESPN2.us', 'https://example.org/espn2.png', ''],
    ['abc7wxyz', '', '', 'united-states/us-local/abc-7-wxyz-us.png'], ['abc', 'ABC.us', 'https://example.org/abc.png', 'united-states/abc-us.png'],
    ['aande', 'AE.us', '', 'united-states/a-and-e-us.png']], x: [['wxyz', 2]] },
  UK: { e: [['skynews', 'SkyNews.uk', 'https://example.org/skynews.png', 'united-kingdom/sky-news-uk.png']], x: [] },
  CA: { e: [['global', 'Global.ca', 'https://example.org/global.png', '']], x: [] },
  INT: { e: [['beinsports1', '', '', 'international/bein-sports-1-int.png']], x: [] }
};
let fetched = [];
vm.runInContext(`
  var Log = { info: function () {}, warn: function () {} };
  var Store = { settings: { logoLib: 'fill', logoStyle: 'set', logoBase: 'https://logos.test/' }, _db: {},
    idbGet: function (k) { return Promise.resolve(this._db[k]); }, idbSet: function (k, v) { this._db[k] = v; return Promise.resolve(); } };
  var Events = { of: function (c) { return /\\| .* @ /.test(c.n) ? { title: 'game' } : null; } };
`, ctx);
ctx.U = { getJSON: url => { const n = url.replace('https://logos.test/', '').replace('.json', ''); fetched.push(n); return FILES[n] ? Promise.resolve(FILES[n]) : Promise.reject(new Error('404')); } };
load('names.js'); load('tidy.js'); load('logos.js');
const Logos = vm.runInContext('Logos', ctx), Store = vm.runInContext('Store', ctx);
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };

const data = {
  groups: [{ id: 'n', name: 'USA | News' }, { id: 's', name: 'USA | Sports' }, { id: 'l', name: 'ABC Locals' }, { id: 'u', name: 'UK | News' }, { id: 'p', name: 'NCAAB' }, { id: 'm', name: 'USA | Misc' }],
  channels: [
    { k: '1', n: 'US: CNN HD', g: 'n', epg: '' }, { k: '2', n: 'USA | ESPN 2 FHD', g: 's', epg: 'ESPN2.us' }, { k: '3', n: 'ABC | DETROIT | WXYZ', g: 'l', epg: '' },
    { k: '4', n: 'UK: Sky News', g: 'u', epg: '' }, { k: '5', n: 'NCAAB 001 | A @ B | 12.18 11:00 AM', g: 'p', epg: '' }, { k: '6', n: 'Global Desk FHD', g: 'm', epg: '' },
    { k: '7', n: 'US| A&E', g: 'n', epg: '' }, { k: '8', n: 'US: Unknown Channel', g: 'n', epg: '' }, { k: '9', n: 'beIN Sports 1', g: 's', epg: '' },
    { k: '10', n: 'ABC | NOWHERE | KZZZ', g: 'l', epg: '' }, { k: '11', n: 'US: Weather', g: 'n', epg: '' }, { k: '12', n: 'US: Fox', g: 'n', epg: '' }, { k: '13', n: 'US: TBS', g: 'n', epg: '' }]
};
(async () => {
  await Logos.load(data);
  ok('ready', Logos.ready, JSON.stringify(Logos.status));
  ok('fetches only the countries it needs', fetched.indexOf('US') >= 0 && fetched.indexOf('UK') >= 0 && fetched.indexOf('INT') >= 0 && fetched.indexOf('CA') < 0, fetched.join());
  const u = k => Logos.url(data.channels.find(c => c.k === k));
  ok('name and country: the matching set', u('1') === INDEX.tvlogos + 'united-states/cnn-us.png', u('1'));
  ok('guide id, set missing: falls back to the original', u('2') === 'https://example.org/espn2.png', u('2'));
  ok('local station by call sign', u('3') === INDEX.tvlogos + 'united-states/us-local/abc-7-wxyz-us.png', u('3'));
  ok('local station without its own: the network', u('10') === INDEX.tvlogos + 'united-states/abc-us.png', u('10'));
  ok('other country', u('4') === INDEX.tvlogos + 'united-kingdom/sky-news-uk.png', u('4'));
  ok('event channels are games, not channels', u('5') === '');
  ok('"Global Desk" outside the local groups is not the Global network', u('6') === '', u('6'));
  ok('A&E', u('7') === INDEX.tvlogos + 'united-states/a-and-e-us.png', u('7'));
  ok('unknown channel: nothing', u('8') === '');
  ok('international set', u('9') === INDEX.tvlogos + 'international/bein-sports-1-int.png', u('9'));
  Store.settings.logoStyle = 'original';
  ok('original style', u('1') === 'https://example.org/cnn.png' && u('7') === INDEX.tvlogos + 'united-states/a-and-e-us.png', u('1') + ' ' + u('7'));
  const cov = Logos.coverage(data.channels, c => c.k === '1');
  ok('coverage', cov.found === 7 && cov.filled === 6 && cov.total === 13, JSON.stringify(cov));
  ok('cached on the TV', !!Store._db['logos:US'] && Store._db['logos:US'].base === 'https://logos.test/');
  fetched = [];
  await Logos.load(data);
  ok('second load from the TV, no downloads', fetched.length === 0, fetched.join());
  Store.settings.logoLib = 'off';
  await Logos.load(data);
  ok('off: nothing', u('1') === '' && !Logos.ready);
  console.log(fail ? fail + ' failures' : 'all ' + n + ' logo tests passed');
  process.exit(fail ? 1 : 0);
})();
