// Event channels: names that carry the matchup and the time (app/js/events.js).
// The shapes are from a real provider's pay-per-view, league pass and one-off game channels.
const fs = require('fs'), path = require('path');
global.window = global;
global.U = { hhmm: t => new Date(t).toISOString().slice(11, 16) };
global.Store = { playlist: { events: {} } };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/events.js'), 'utf8') + ';global.Events=Events;');
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };
Events.setProviderTz('America/Toronto');
const NOW = Date.parse('2026-10-29T12:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 16) + 'Z';
const cases = [
  // name, short, title, start (UTC)
  ['NCAAB 001 | NORTH FLORIDA @ CHARLESTON SOUTHERN (M) | 12.18 11:00 AM | ESPN+', 'NCAAB 001', 'NORTH FLORIDA @ CHARLESTON SOUTHERN (M)', '2026-12-18T16:00Z'],
  ['PPV 03 ⓧ| UFC | Makhachev v Machado Garry | Sat 15th Aug 2:00AM UK/9:00PM ET', 'PPV 03', 'Makhachev v Machado Garry', '2026-08-16T01:00Z'],
  ['PPV 01 ⓧ| UFC | Early Prelims | Sat 15th Aug 10:30PM UK/5:30PM ET', 'PPV 01', 'UFC: Early Prelims', '2026-08-15T21:30Z'],
  ['NBA: Kings vs Pelicans @ Oct 29 7:30 PM :Nbc Sports  04', 'Nbc Sports 04', 'NBA: Kings vs Pelicans', '2026-10-29T23:30Z'],
  ['Molson Habs Hockey: Canadiens vs. Stars @ Oct 29 20:00 :TSN+  69', 'TSN+ 69', 'Molson Habs Hockey: Canadiens vs. Stars', '2026-10-30T00:00Z'],
  ['BigTen 01 | Iowa v Loyola | Soccer (W) | Sat 15th Aug 8:00PM', 'BigTen 01', 'Iowa v Loyola', '2026-08-16T00:00Z'],
  ['US (Peacock 020) | FRA vs. SWE (W Group B) (2026-02-08 10:40:00)', 'Peacock 020', 'FRA vs. SWE (W Group B)', '2026-02-08T15:40Z'],
  ['DAZN CA | Event 16: Panthers @ Jaguars // UK Sun 7 Sep 6:00pm // ET Sun 7 Sep 1:00pm', 'DAZN CA Event 16', 'Panthers @ Jaguars', '2026-09-07T17:00Z'],
  ['UK: National League | Event 4 Rochdale vs Sutton // UK Mon 25 Aug 3:00pm // ET Mon 25 Aug 10:00am', 'Event 4', 'Rochdale vs Sutton', '2026-08-25T14:00Z'],
  ['CA | CFL 02ⓧ: Toronto Argonauts vs. Edmonton Elks | Sat 15th Aug 3:00PM ET', 'CFL 02', 'Toronto Argonauts vs. Edmonton Elks', '2026-08-15T19:00Z'],
  ['NHL 1 | Mammoth @ Penguins - Thu Oct 29 07:00 PM EDT', 'NHL 1', 'Mammoth @ Penguins', '2026-10-29T23:00Z'],
  ['NBA 1 | Oct 29 7:55 PM | Atlanta Hawks Cleveland Cavaliers', 'NBA 1', 'Atlanta Hawks Cleveland Cavaliers', '2026-10-29T23:55Z'],
  ['UEFA | 01 - Ararat-Armenia vs AZ Alkmaar 17:45 pm', 'UEFA 01', 'Ararat-Armenia vs AZ Alkmaar', '2026-10-29T21:45Z'],
  ['EFL01ⓧ| Wolverhampton Wanderers 20:00 Blackburn Rovers (CH) 14/08', 'EFL01', 'Wolverhampton Wanderers vs Blackburn Rovers (CH)', '2026-08-15T00:00Z'],
  ['Football Event 01ⓧ: Romania, Liga 2 | FC Bihor Oradea vs. AFC ASA Targu Mures | Saturday, 15 August 2026 09:00', 'Football Event 01', 'FC Bihor Oradea vs. AFC ASA Targu Mures', '2026-08-15T13:00Z'],
  ['Sat Oct 31 1:00 PM EDT - Charlotte FC vs. Orlando City', '', 'Charlotte FC vs. Orlando City', '2026-10-31T17:00Z'],
  ['NFL Game Pass 1 : Dallas Cowboys @ Philadelphia Eagles 8:15 PM', 'NFL Game Pass 1', 'Dallas Cowboys @ Philadelphia Eagles', '2026-10-30T00:15Z'],
  ['EVENTS 02: 2pm UFC 333 Volkanovksi v Evloev', 'EVENTS 02', 'UFC 333 Volkanovksi v Evloev', '2026-10-29T18:00Z'],
  ['PPV 15 | 8:00PM |  Illinois v Baylor | Basketball (M)', 'PPV 15', 'Illinois v Baylor', '2026-10-30T00:00Z'],
  ['ECHL | Idaho vs Allen - Oct 29 11:30 AM EDT', 'ECHL', 'Idaho vs Allen', '2026-10-29T15:30Z'],
  ['NCAABASE 001: Maryland vs West Virginia Mar 10 02:00 PM', 'NCAABASE 001', 'Maryland vs West Virginia', '2027-03-10T19:00Z'],
  ['FIFA U-15 World Cup 2026™: Pitch 1A | Day 5: Morning Session @ Oct 29 01:00 :DAZN USA  01', 'DAZN USA 01', 'FIFA U-15 World Cup 2026: Pitch 1A', '2026-10-29T05:00Z']
];
cases.forEach(([name, short, title, start]) => {
  const e = Events.parse(name, NOW);
  ok('read: ' + name, e && e.short === short && e.title === title && iso(e.start) === start, e ? JSON.stringify([e.short, e.title, iso(e.start)]) : 'not read');
});
// Not events
['USA | ESPN', 'FloHockey 39 - Off Air', 'PPV 07 | OFFLINE', 'Victory+ 01 | SPORTSRADIO 96.7 FM & 1310 AM The Ticket', 'F1 | FORMULA 1 Grand Prix 24/24 @ sep 24:26',
  'EPL 01: Liverpool VS Brighton', '24/7 Friends', 'Pluto US | Chef vs Chef by Food Network', 'TSN 1 HD', 'CNN International'].forEach(name => ok('not an event: ' + name, Events.parse(name, NOW) === null));
// Time zones and daylight saving, without Intl
ok('ET summer', iso(Events.toTime(2026, 6, 4, 12, 0, 'ET')) === '2026-07-04T16:00Z');
ok('ET winter', iso(Events.toTime(2026, 11, 25, 12, 0, 'ET')) === '2026-12-25T17:00Z');
ok('ET the day DST starts', iso(Events.toTime(2026, 2, 8, 12, 0, 'ET')) === '2026-03-08T16:00Z' && iso(Events.toTime(2026, 2, 7, 12, 0, 'ET')) === '2026-03-07T17:00Z');
ok('ET the day DST ends', iso(Events.toTime(2026, 10, 1, 12, 0, 'ET')) === '2026-11-01T17:00Z' && iso(Events.toTime(2026, 9, 31, 12, 0, 'ET')) === '2026-10-31T16:00Z');
ok('PT', iso(Events.toTime(2026, 9, 29, 19, 0, 'PT')) === '2026-10-30T02:00Z');
ok('UK summer and winter', iso(Events.toTime(2026, 7, 15, 15, 0, 'UK')) === '2026-08-15T14:00Z' && iso(Events.toTime(2026, 11, 26, 15, 0, 'UK')) === '2026-12-26T15:00Z');
ok('UK clocks change on the last Sunday', iso(Events.toTime(2026, 9, 24, 15, 0, 'UK')) === '2026-10-24T14:00Z' && iso(Events.toTime(2026, 9, 25, 15, 0, 'UK')) === '2026-10-25T15:00Z');
ok('CET', iso(Events.toTime(2026, 7, 15, 20, 45, 'CET')) === '2026-08-15T18:45Z' && iso(Events.toTime(2026, 0, 15, 20, 45, 'CET')) === '2026-01-15T19:45Z');
ok('provider zones', Events.zoneOfIana('America/Toronto') === 'ET' && Events.zoneOfIana('America/Los_Angeles') === 'PT' && Events.zoneOfIana('Europe/London') === 'UK' &&
  Events.zoneOfIana('Europe/Berlin') === 'CET' && Events.zoneOfIana('UTC') === 'UTC' && Events.zoneOfIana('Asia/Tokyo') === 'local');
// The playlist's choice for names without a zone
Store.playlist.events = { tz: 'UK' }; Events.reset();
ok('times without a zone follow the setting', iso(Events.parse('SPFL 05: Dundee 17:30 Rangers 29/03', NOW).start) === '2027-03-29T16:30Z');
ok('a zone in the name still wins', iso(Events.parse('NHL 1 | Mammoth @ Penguins - Thu Oct 29 07:00 PM EDT', NOW).start) === '2026-10-29T23:00Z');
Store.playlist.events = {}; Events.reset();
// Guide entries
const ev = Events.parse('PPV 02 | UFC | Main Card: Rivera v Okafor | Thu Oct 29 9:00 PM ET', NOW), pr = Events.programmes(ev);
ok('guide: before, during, after', pr.length === 3 && /^Starts .*: Main Card: Rivera v Okafor$/.test(pr[0].t) && pr[0].e === ev.start && pr[1].t === 'Main Card: Rivera v Okafor' && pr[1].s === ev.start && /^Ended: /.test(pr[2].t) && pr[2].s === ev.end, JSON.stringify(pr.map(p => p.t)));
ok('guide: the details and the full name are the description', /UFC/.test(pr[1].d) && /Rivera v Okafor \| Thu Oct 29/.test(pr[1].d));
ok('length: soccer about two hours, prelims two, others three', Events.parse('EPL 01: Chelsea FC vs. Manchester United | Saturday, 31 October 2026 12:30', NOW).end - Events.parse('EPL 01: Chelsea FC vs. Manchester United | Saturday, 31 October 2026 12:30', NOW).start === 2.25 * 3600e3 &&
  ev.end - ev.start === 3 * 3600e3);
Store.playlist.events = { on: false };
ok('off: nothing is read', Events.of({ n: 'PPV 02 | UFC | Main Card: Rivera v Okafor | Thu Oct 29 9:00 PM ET' }) === null);
console.log(fail ? fail + ' failures' : 'all ' + n + ' event channel tests passed');
process.exit(fail ? 1 : 0);
