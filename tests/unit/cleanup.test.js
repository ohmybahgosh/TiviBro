// Smart clean-up engine (app/js/tidy.js), shared by the TV's first-run tour and the web editor:
// countries, divider groups, time zone feeds, local channels by city and duplicates, checked against
// sample names shaped like a real provider's.  The editor's copy must be the same file.
const fs = require('fs'), path = require('path');
global.window = global;
eval(fs.readFileSync(path.join(__dirname, '../../app/js/names.js'), 'utf8') + ';global.Names=Names;');
const Tidy = require('../../app/js/tidy.js');
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };
let T;
function load(groups, chans) { T = Tidy.make({ groups, channels: chans }); }
const feedPairs = () => T.feeds(), feedGroups = f => T.feedGroups(f), localIndex = () => T.locals(), parseLocal = Tidy.parseLocal, titleCase = Tidy.titleCase;
const html = fs.readFileSync(path.join(__dirname, '../../service/editor/index.html'), 'utf8');
ok('the editor loads tidy.js', /<script src="tidy.js"><\/script>/.test(html));
ok('the editor copy is current', fs.readFileSync(path.join(__dirname, '../../service/editor/tidy.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '../../app/js/tidy.js'), 'utf8'));
ok('no \\p{} in tidy.js (old TVs cannot parse it)', !/\\p\{/.test(fs.readFileSync(path.join(__dirname, '../../app/js/tidy.js'), 'utf8')));

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
  ['GALAVISION', 'GALAVISION', ''], ['GALAVISION | EAST', 'GALAVISION', ''], ['CW | EAST (PHILLY)', 'CW', 'PHILADELPHIA'], ['ABC | NYC | WABC', 'ABC', 'NEW YORK'], ['USA | FOX | DETROIT | WJBK', 'FOX', 'DETROIT']];
loc.forEach(([name, net, city]) => { const p = parseLocal(name); ok('local: ' + name, p && p.net === net && p.city === city, p ? p.net + ' / ' + p.city : 'null'); });
ok('local: not a local', parseLocal('USA | ESPN') === null && parseLocal('NBC SPORTS').city === '', JSON.stringify(parseLocal('NBC SPORTS')));
load([{ id: 'a', name: 'ABC Locals' }, { id: 'c', name: 'CBS Locals' }, { id: 'x', name: 'USA EAST' }], [
  { k: 'a1', n: 'ABC | DETROIT | WXYZ', g: 'a' }, { k: 'a2', n: 'ABC | LANSING | WLAJ', g: 'a' }, { k: 'c1', n: 'CBS | DETROIT | WWJ', g: 'c' }, { k: 'x1', n: 'USA | ABC NEWS LIVE', g: 'x' }]);
const li = localIndex();
ok('local index: only local groups', li.groups.map(g => g.id).join() === 'a,c' && li.chans.length === 3);
ok('local index: cities with networks', li.cities.map(c => c.city + ':' + Object.keys(c.nets).sort().join('+')).join() === 'DETROIT:ABC+CBS,LANSING:ABC', li.cities.map(c => c.city).join());
ok('title case', titleCase('SALT LAKE CITY') === 'Salt Lake City' && titleCase("COEUR D'ALENE") === "Coeur D'Alene");

// Countries
load([{ id: 'd1', name: '⫘⫘⫘ USA ⫘⫘⫘' }, { id: 'n', name: 'USA | News' }, { id: 'l', name: 'ABC Locals' }, { id: 'd2', name: '⫘⫘⫘ CAN ⫘⫘⫘' }, { id: 't', name: 'TSN +' },
  { id: 'f', name: 'France Cinema' }, { id: 'f2', name: 'FR | Sport' }, { id: 'a', name: 'Latin Sports' }, { id: 'ar', name: 'Futbol' }, { id: 'nfl', name: 'NFL Teams' }, { id: 'e', name: 'Empty one' }],
  [{ k: '1', n: 'US: CNN', g: 'n' }, { k: '2', n: 'ABC | DETROIT | WXYZ', g: 'l' }, { k: '3', n: 'TSN 1', g: 't' }, { k: '4', n: 'TF1', g: 'f' }, { k: '5', n: 'Canal+ Sport', g: 'f2' },
    { k: '6', n: 'ARG | TyC Sports', g: 'ar' }, { k: '7', n: 'ARG | ESPN 2', g: 'ar' }, { k: '8', n: 'ARG | Fox Sports', g: 'ar' }, { k: '9', n: 'Lions', g: 'nfl' }, { k: '10', n: 'placeholder', g: 'd1' }]);
const cm = T.countryMap();
ok('country: code in the group name', cm.n === 'US' && cm.f2 === 'FR');
ok('country: country word', cm.f === 'FR' && cm.a === 'LAT', cm.f + ' ' + cm.a);
ok('country: divider section', cm.l === 'US' && cm.t === 'CA', cm.l + ' ' + cm.t);
ok('country: channel prefixes', cm.ar === 'AR', cm.ar);
ok('country: NFL is not a country', Tidy.ccNorm('NFL') === '' && Tidy.ccNorm('nbc') === '');
const cs = T.countries();
ok('countries: biggest first, with names', cs[0].chans >= cs[1].chans && cs.some(x => x.p === 'AR') && cs.some(x => x.p === 'US' && x.name === 'USA'), cs.map(x => x.p + x.chans).join());
ok('dividers', T.dividers().map(g => g.id).join() === 'd1,d2');
ok('empty groups', T.empty().map(g => g.id).join() === 'd2,a,e', T.empty().map(g => g.id).join());
ok('TV region', Tidy.ccOfLocale('en-US') === 'US' && Tidy.ccOfLocale('en-GB') === 'UK' && Tidy.ccOfLocale('fr-CA') === 'CA' && Tidy.ccOfLocale('en') === '');

// Logo keys: a feed at the end goes, East and West inside a name stay.
ok('logo keys', Tidy.logoKey('USA | HBO (WEST)') === 'hbo' && Tidy.logoKey('Wild West TV') === 'wildwest' && Tidy.logoKey('A&E') === 'aande', Tidy.logoKey('Wild West TV'));

// Duplicates
load([{ id: 'g', name: 'US | Movies' }], [{ k: '1', n: 'US | HBO FHD', g: 'g' }, { k: '2', n: 'US | HBO HD', g: 'g' }, { k: '3', n: 'US | HBO 4K', g: 'g' }, { k: '4', n: 'US | HBO WEST', g: 'g' }, { k: '5', n: 'US | Cinemax', g: 'g' }]);
const ds = T.dupes();
ok('dupes: one set, West kept apart', ds.length === 1 && ds[0].items.length === 3, ds.map(x => x.items.map(c => c.k).join('+')).join());
ok('dupes: keeps Full HD first', ds[0].keep === '1');
ok('dupes: highest quality', T.dupes({ prefer: 'best' })[0].keep === '3');
ok('dupes: skip hidden', T.dupes({ skip: c => c.k === '1' || c.k === '2' }).length === 0);
{
  const P = Tidy.make({ groups: [{ id: 'p', name: 'Peacock Events' }], channels: [
    { k: 'a', n: 'US (Peacock 002) | Milan Cortina 2026 Coverage', g: 'p' }, { k: 'b', n: 'US (Peacock 014) | Milan Cortina 2026 Coverage', g: 'p' },
    { k: 'c', n: 'ESPN HD', g: 'p' }, { k: 'd', n: 'ESPN 4K', g: 'p' }, { k: 'e', n: 'ESPN 2 HD', g: 'p' }] });
  const d = P.dupes().map(s => s.items.map(c => c.k).sort().join(''));
  ok('dupes: numbered event channels are not copies, quality numbers are', d.length === 1 && d[0] === 'cd', JSON.stringify(d));
}
console.log(fail ? fail + ' failures' : 'all ' + n + ' clean-up tests passed');
process.exit(fail ? 1 : 0);
