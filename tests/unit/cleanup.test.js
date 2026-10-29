// Smart clean-up helpers from the web editor (service/editor/index.html): time zone feeds and local
// channels by city.  The functions are read out of the page and run here against sample names
// shaped like a real provider's.
const fs = require('fs'), path = require('path');
global.window = global;
eval(fs.readFileSync(path.join(__dirname, '../../app/js/names.js'), 'utf8') + ';global.Names=Names;');
const html = fs.readFileSync(path.join(__dirname, '../../service/editor/index.html'), 'utf8');
const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('not found: ' + from); return html.slice(a, b); };
const code = cut('var STOP = ', 'function prep(') + cut('function prep(', '\n}\n') + '\n}\n' + cut('var FEED_RE', 'function emptyGroups()');
const N = Names.defaults();
global.cleanName = n => Names.cleanWith(N, n);
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };
function load(groups, chans) {
  global.D = { groups, channels: chans };
  global.E = { hiddenGroups: {}, hiddenChannels: {}, groupRenames: {}, groupOrder: [] };
  global.providerGroups = () => D.groups.map(g => ({ id: g.id, name: g.name, raw: g.name }));
  global.channelsOf = id => D.channels.filter(c => c.g === id);
}
(0, eval)(code.replace(/^function (\w+)/gm, 'global.$1 = function $1').replace(/^var (\w+)/gm, 'global.$1'));

// Feeds
load([{ id: 'e', name: 'USA EAST' }, { id: 'w', name: 'USA WEST' }, { id: 'p', name: 'USA Premium Movies EAST' }, { id: 's', name: 'BIG10' }], [
  { k: '1', n: 'USA | A&E', g: 'e' }, { k: '2', n: 'USA | A&E (WEST)', g: 'w' }, { k: '3', n: 'USA | HBO (EAST)', g: 'p' }, { k: '4', n: 'USA | HBO (WEST)', g: 'p' },
  { k: '5', n: 'USA | DISNEY CHANNEL', g: 'e' }, { k: '6', n: 'USA | DISNEY CHANNEL WEST', g: 'e' }, { k: '7', n: 'USA | AXS', g: 'e' },
  { k: '8', n: 'BigTen 05 | Indiana v Youngstown St. | Soccer (W)', g: 's' }, { k: '9', n: 'CNN (E)', g: 'e' }, { k: '10', n: 'CNN (W)', g: 'w' }, { k: '11', n: 'Lonely (W)', g: 's' }]);
const fp = feedPairs();
const ks = l => l.map(c => c.k).sort((a, b) => a - b).join(',');
ok('feeds: pairs found', fp.pairs === 4, fp.pairs);
ok('feeds: West copies', ks(fp.west) === '2,4,6,10', ks(fp.west));
ok('feeds: East and unmarked copies', ks(fp.east) === '1,3,5,9', ks(fp.east));
ok('feeds: a lone (W) is not a feed', !fp.west.some(c => c.k === '11') && !fp.east.some(c => c.k === '8'));
ok('feeds: West groups', feedGroups('west').map(g => g.id).join() === 'w');

// Locals
const loc = [
  ['CBS | DENVER | KCNC', 'CBS', 'DENVER'], ['ABC | SALT LAKE CITY | KTVX', 'ABC', 'SALT LAKE CITY'], ['NBC | NEW BRITAIN | WVIT', 'NBC', 'NEW BRITAIN'],
  ['PBS | MA - BOSTON (WGBH)', 'PBS', 'BOSTON'], ['US: PBS - CT - HARTFORD (WEDH)', 'PBS', 'HARTFORD'], ['CW | BOSTON 56 WLVI', 'CW', 'BOSTON'],
  ['CW | NEW YORK PIX11 WPIX', 'CW', 'NEW YORK'], ['CW | ACADIANA CW', 'CW', 'ACADIANA'], ['FOX | ST LOUIS | KTVI', 'FOX', 'ST LOUIS'],
  ['TELEMUNDO | CHICAGO', 'TELEMUNDO', 'CHICAGO'], ['CA | CTV 2 WINDSOR', 'CTV 2', 'WINDSOR'], ['CA | CBC ST.JOHNS', 'CBC', 'ST JOHNS'],
  ['GALAVISION', 'GALAVISION', ''], ['GALAVISION | EAST', 'GALAVISION', ''], ['CW | EAST (PHILLY)', 'CW', ''], ['USA | FOX | DETROIT | WJBK', 'FOX', 'DETROIT']];
loc.forEach(([name, net, city]) => { const p = parseLocal(name); ok('local: ' + name, p && p.net === net && p.city === city, p ? p.net + ' / ' + p.city : 'null'); });
ok('local: not a local', parseLocal('USA | ESPN') === null && parseLocal('NBC SPORTS').city === '', JSON.stringify(parseLocal('NBC SPORTS')));
load([{ id: 'a', name: 'ABC Locals' }, { id: 'c', name: 'CBS Locals' }, { id: 'x', name: 'USA EAST' }], [
  { k: 'a1', n: 'ABC | DETROIT | WXYZ', g: 'a' }, { k: 'a2', n: 'ABC | LANSING | WLAJ', g: 'a' }, { k: 'c1', n: 'CBS | DETROIT | WWJ', g: 'c' }, { k: 'x1', n: 'USA | ABC NEWS LIVE', g: 'x' }]);
const li = localIndex();
ok('local index: only local groups', li.groups.map(g => g.id).join() === 'a,c' && li.chans.length === 3);
ok('local index: cities with networks', li.cities.map(c => c.city + ':' + Object.keys(c.nets).sort().join('+')).join() === 'DETROIT:ABC+CBS,LANSING:ABC', li.cities.map(c => c.city).join());
ok('title case', titleCase('SALT LAKE CITY') === 'Salt Lake City' && titleCase("COEUR D'ALENE") === "Coeur D'Alene");
console.log(fail ? fail + ' failures' : 'all ' + n + ' clean-up tests passed');
process.exit(fail ? 1 : 0);
