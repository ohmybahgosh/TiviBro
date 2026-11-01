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
// Shapes seen on a real provider (about 9,800 channels), with the recommended defaults.
const real = [
  ['CAR | METRO TV HND', 'METRO TV HND'], ['ARG | TN HD', 'TN'], ['CO | Caracol FHD', 'Caracol'], ['CR | Repretel 6 FHD', 'Repretel 6'],
  ['AFG | ATN TV', 'ATN TV'], ['MY | ASTRO ARENA', 'ASTRO ARENA'], ['PR | WAPA', 'WAPA'], ['CA-FR | RDS', 'RDS'], ['DEP | TUDN 01', 'TUDN 01'],
  ['DEP |  BEIN LA LIGA FHD ES', 'BEIN LA LIGA FHD ES'], ['UK◈ Sky Store Premiere 3 ᴴᴰ', 'Sky Store Premiere 3'], ['ARG | EL NUEVE SD *', 'EL NUEVE'],
  ['⫘⫘⫘ CAN ⫘⫘⫘', 'CAN'], ['⚽ EPL 1', 'EPL 1'], ['⛹ NBA TEAMS', 'NBA TEAMS'], ['⬬ NFL PASS 1', 'NFL PASS 1'],
  ['EFL04ⓧ| Charlton Athletic 15:00 Derby County (CH) 15/08', 'EFL04 | Charlton Athletic 15:00 Derby County (CH) 15/08'],
  ['FIFA U-15 World Cup 2026™: Pitch 1A', 'FIFA U-15 World Cup 2026: Pitch 1A'],
  ['Pluto US | CNN HEADLINES', 'Pluto US | CNN HEADLINES'], ['TUBI | ION', 'TUBI | ION'], ['FloHockey 39 - Off Air', 'FloHockey 39 - Off Air'],
  ['CBS | DENVER | KCNC', 'CBS | DENVER | KCNC'], ['NHL | Boston Bruins', 'NHL | Boston Bruins'], ['SC: Top 50 Goals of All-Time', 'SC: Top 50 Goals of All-Time'],
  ['USA | A&E', 'A&E'], ['GR | Mega HD', 'Mega'], ['US: PBS - CT - HARTFORD (WEDH)', 'PBS - CT - HARTFORD (WEDH)']
];
real.forEach(([i, o]) => { const r = Names.cleanWith(D, i); if (r !== o) { fail++; console.log('FAIL real', JSON.stringify(i), '->', JSON.stringify(r), 'want', JSON.stringify(o)); } });
// The optional rules
const O = JSON.parse(JSON.stringify(D)); O.rules.services = true; O.rules.countryEnd = true; O.rules.idle = true;
const opt = [
  ['Pluto US | CNN HEADLINES', 'CNN HEADLINES'], ['TUBI | ION', 'ION'], ['Pluto TV | Anime', 'Anime'], ['Samsung TV Plus: Bob Ross', 'Bob Ross'], ['Plex | Docurama', 'Docurama'],
  ['CAR | METRO TV HND', 'METRO TV'], ['CAR | CANAL 4 PAN', 'CANAL 4'], ['DEP | BEIN SPORTS 05 (USA)', 'BEIN SPORTS 05'], ['ARG | TN (Argentina)', 'TN'],
  ['DEP |  BEIN SPORTS N (LATINO AMERICA)', 'BEIN SPORTS N'], ['ESPN Deportes', 'ESPN Deportes'],
  ['FloHockey 39 - Off Air', 'FloHockey 39'], ['PPV 07 | OFFLINE', 'PPV 07'], ['NBA 07 : Offline', 'NBA 07'], ['BigTen 76 | No Event Scheduled', 'BigTen 76'],
  ['GR | PAOK TV HD OFFLINE', 'PAOK TV'], ['Victory+ | No Event Scheduled', 'Victory+'], ['Offline TV', 'Offline TV'], ['Off Air', 'Off Air']
];
opt.forEach(([i, o]) => { const r = Names.cleanWith(O, i); if (r !== o) { fail++; console.log('FAIL optional', JSON.stringify(i), '->', JSON.stringify(r), 'want', JSON.stringify(o)); } });
// Rules added later start at their default for settings saved before them.
if (Names.cleanWith({ enabled: true, rules: { country: true }, prefixes: [], suffixes: [] }, 'UK◈ Sky Store ᴴᴰ') !== 'Sky Store') { fail++; console.log('FAIL old settings get new defaults'); }
// Channels with nothing on
const idle = [['FloHockey 39 - Off Air', true], ['PPV 07 | OFFLINE', true], ['BigTen 76 | No Event Scheduled', true], ['Victory+ | No Event Scheduled', true],
  ['GR | BCI 24 News OFFLINE', true], ['NBA 07 : Offline', true], ['ESPN', false], ['Offline TV', false], ['Liveline', false], ['NFL 01: Bills vs Jets 1:00 PM ET', false],
  // Empty event slots: the tag and nothing after it, or the network tag with nothing before it.
  ['EPL 02:', true], ['PPV09 |', true], ['NFL Game Pass 3 :', true], ['F1 06:  :', true], [' :ESPN+  291', true], [' :FOX ONE  20', true], ['PPV10 | ', true],
  ['MLB 1', false], ['Sky Sports:', false], ['ESPN 2', false], ['NFL | Replay 4', false], ['EPL 01: Liverpool VS Arsenal', false], ['USA | A&E', false]];
idle.forEach(([n, w]) => { if (Names.idle(n) !== w) { fail++; console.log('FAIL idle', n); } });
console.log(fail ? fail + ' failures' : 'all ' + (cases.length + 16 + real.length + opt.length + 1 + idle.length) + ' name tests passed');
process.exit(fail ? 1 : 0);
