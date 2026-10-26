global.window = global;
const fs = require('fs'), path = require('path').join(__dirname, '../../app/js/');
eval(fs.readFileSync(path + 'names.js', 'utf8') + ';global.Names=Names;');
const D = Names.defaults();
const cases = [
  ['USA | ESPN HD', 'ESPN'], ['|US| CNN FHD', 'CNN'], ['US: Fox News ᴴᴰ', 'Fox News'], ['USA Network', 'USA Network'],
  ['[UK] BBC One (1080p)', 'BBC One'], ['VIP | AMC 60FPS', 'AMC'], ['CA - TSN 1 ᴿᴬᵂ', 'TSN 1'], ['WHD Channel', 'WHD Channel'],
  ['US| HBO East', 'HBO East'], ['4K | Nature UHD', 'Nature'], ['EX-YU - RTS 1 HD', 'RTS 1'], ['A&E HEVC', 'A&E'],
  ['ESPN 2 | HD', 'ESPN 2'], ['US| Disney ★', 'Disney'], ['UK Gold', 'UK Gold'], ['US Open Tennis', 'US Open Tennis'],
  ['NBA/NHL Network', 'NBA/NHL Network'], ['NFL | RedZone', 'NFL | RedZone'], ['US: HD', 'HD'], ['US| 4K', '4K'],
  ['HD', 'HD'], ['', ''], ['   ', ''], ['USA | ', 'USA |'], ['AT&T SportsNet', 'AT&T SportsNet'], ['TSN4 HD', 'TSN4'],
  ['Sky Sports Main Event FHD', 'Sky Sports Main Event'], ['ES - Movistar+ LaLiga HD', 'Movistar+ LaLiga'],
  ['US : ABC (WABC) New York HD', 'ABC (WABC) New York'], ['24/7 - Friends', 'Friends'], ['SPORTS: TNT', 'TNT'],
  ['US | ESPN (Backup)', 'ESPN'], ['CNN (East)', 'CNN (East)'], ['HBO 2 FHD H265', 'HBO 2'], ['FOX 5 ⁶⁰ᶠᵖˢ', 'FOX 5'],
  ['IN - Star Plus', 'Star Plus'], ['NO | NRK1', 'NRK1'], ['UK: ITV 1 +1', 'ITV 1 +1'], ['Discovery Channel SD', 'Discovery Channel'],
  ['USA: E! Entertainment', 'E! Entertainment'], ['ENT | Bravo', 'Bravo'], ['LOCALS | NBC 4', 'NBC 4'], ['PPV 12', 'PPV 12'],
];
let fail = 0;
for (const [i, o] of cases) { const r = Names.cleanWith(D, i); if (r !== o) { fail++; console.log('FAIL', JSON.stringify(i), '->', JSON.stringify(r), 'want', JSON.stringify(o)); } }
// feeds + brackets on
const F = JSON.parse(JSON.stringify(D)); F.rules.feeds = true; F.rules.brackets = true;
[['HBO (East)', 'HBO'], ['Starz West', 'Starz'], ['[EN] Sky News', 'Sky News'], ['CNN (E)', 'CNN']].forEach(([i, o]) => { const r = Names.cleanWith(F, i); if (r !== o) { fail++; console.log('FAIL feeds', i, r); } });
// user lists, TiviMate semantics
const C = JSON.parse(JSON.stringify(D)); C.rules = {}; C.prefixes = Names.parseList('NOW: , XX ,USA| ,US| '); C.suffixes = Names.parseList(' HD,| FHD, (Backup)');
[['NOW: Sky', 'Sky'], ['now: sky', 'sky'], ['WHD', 'WHD'], ['ESPN HD', 'ESPN'], ['CNN| FHD', 'CNN'], ['USA| A&E', 'A&E'], ['US| AMC', 'AMC'], ['XX Foo (Backup)', 'Foo'], ['HD', 'HD'], [' HD', 'HD']]
  .forEach(([i, o]) => { const r = Names.cleanWith(C, i); if (r !== o) { fail++; console.log('FAIL user', JSON.stringify(i), JSON.stringify(r), 'want', o); } });
// disabled
if (Names.cleanWith({ enabled: false }, 'USA | ESPN') !== 'USA | ESPN') { fail++; console.log('FAIL disabled'); }
// round trip of list format
if (Names.joinList(Names.parseList('a, b ,c')) !== 'a, b ,c') { fail++; console.log('FAIL roundtrip'); }
console.log(fail ? fail + ' failures' : 'all ' + (cases.length + 16) + ' name tests passed');
process.exit(fail ? 1 : 0);
