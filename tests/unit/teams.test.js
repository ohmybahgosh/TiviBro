// My teams (app/js/teams.js): team channels, and games found in event channel names and guide titles.
// The channel names are the shapes of real providers' "NFL TEAMS", "NHL PASS" and "USA NHL" groups.
const fs = require('fs'), path = require('path');
global.window = global;
global.U = { hhmm: t => new Date(t).toISOString().slice(11, 16) };
global.Store = { playlist: { events: {} }, settings: { myTeams: [], teamsAhead: 6 }, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] }, saveSettings() {}, saveEdits() {} };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/events.js'), 'utf8') + ';global.Events=Events;');
let progs = {};
global.Epg = { xml: false, epgId: () => '', search(test) { const out = []; Object.keys(progs).forEach(k => progs[k].forEach(p => { if (test(p.t)) out.push({ key: k, p }); })); return out; } };
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };

const NOW = Date.now(), H = 3600e3;
const hm = t => { const d = new Date(t); return (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };
const md = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const groups = [{ id: 'g1', name: '⬬ NFL TEAMS' }, { id: 'g2', name: '⛸ NHL TEAMS' }, { id: 'g3', name: '⛸ NHL PASS 1' }, { id: 'g4', name: 'USA NHL' }, { id: 'g5', name: 'Movies' }, { id: 'g6', name: 'USA NBA' }, { id: 'g7', name: 'US Entertainment' }];
let num = 0;
const ch = (n, g) => ({ k: 'k' + (++num), n, g, num });
const chans = [
  ch('NFL | DETROIT LIONS', 'g1'), ch('NFL | MINNESOTA VIKINGS', 'g1'),
  ch('NHL | DETROIT RED WINGS', 'g2'), ch('NHL | WINNIPEG JETS', 'g2'), ch('USA NHL Carolina Hurricanes', 'g4'),
  ch('NHL 1 | ' + md(NOW + H) + ' ' + hm(NOW + H) + ' | Carolina Hurricanes Winnipeg Jets', 'g3'),
  ch('USA NHL 02: WPG VS CAR (TVAS Feed ) @ ' + hm(NOW - H).toLowerCase(), 'g4'),
  ch('USA NBA 02: Magic vs Heat @ ' + hm(NOW + 2 * H), 'g6'),
  ch('HBO', 'g5'), ch('ESPN', 'g5'), ch('Chicago Fire', 'g7'), ch('USA NHL 01: WPG VS CAR (NHLN Feed ) @ ' + hm(NOW - H).toLowerCase(), 'g4')
];
global.Library = { data: { channels: chans, groups }, find: k => chans.find(c => c.k === k), isFav: () => false };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/teams.js'), 'utf8') + ';global.Teams=Teams;');

// Names
const ids = l => l.map(x => x.id).sort().join(',');
const all = Teams.all();
ok('full name', ids(Teams.named('Detroit Lions at Minnesota Vikings', '', all)) === 'nfl:det,nfl:min');
ok('nicknames need the league: Magic Mike is no game', ids(Teams.named('Magic Mike', 'HBO', all)) === '');
ok('two nicknames of one league', ids(Teams.named('Heat at Magic', '', all)) === 'nba:mia,nba:orl');
ok('nickname with the league in the channel', ids(Teams.named('Mammoth @ Penguins', 'NHL 1', all)) === 'nhl:pit,nhl:uta');
ok('ambiguous nickname settled by the other team', ids(Teams.named('Panthers @ Jaguars', 'DAZN CA', all)) === 'nfl:car,nfl:jax');
ok('Jets alone in an NHL channel are Winnipeg', ids(Teams.named('Jets vs Hurricanes', 'USA NHL 01', all)) === 'nhl:car,nhl:wpg');
ok('abbreviations in event titles, with the league', ids(Teams.named('WPG VS CAR (TVAS Feed )', 'USA NHL 02: WPG VS CAR', all, true)) === 'nhl:car,nhl:wpg');
ok('abbreviations need the league', ids(Teams.named('WPG VS CAR', 'Event 3', all, true)) === '');
ok('abbreviations only in event titles', ids(Teams.named('CAR VS WPG', 'NHL', all, false)) === '');
ok('St. Louis', ids(Teams.named('St. Louis Blues at Chicago Blackhawks', '', all)) === 'nhl:chi,nhl:stl');
ok('another team with the same nickname', ids(Teams.named('2026 Parkland Rangers U15 vs Eastman Selects U15', 'Flo Hockey', all)) === '');
ok('minor hockey by nickname', ids(Teams.named('Providence Bruins vs Lehigh Valley Phantoms', 'Hockey', all)) === '');
ok('a city before the nickname that is not the team\'s', ids(Teams.named('Brandon Wheat Kings vs Interlake Lightning', 'NHL', all)) === '');
ok('youth tag in the channel name', ids(Teams.named('Timberwolves vs Hurricanes', 'AEHLU17 | Timberwolves vs Hurricanes', all)) === '');
ok('junior league', ids(Teams.named('Raiders vs Blues', 'OJHL: Raiders vs Blues :Flo Hockey', all)) === '');
ok('cities with the league named', ids(Teams.named('NHL: Winnipeg vs Carolina', 'Sportsnet+ 08', all)) === 'nhl:car,nhl:wpg');
ok('cities need the league named', ids(Teams.named('Winnipeg vs Carolina', 'Sportsnet+ 08', all)) === '');
ok('a city two teams share is not enough', ids(Teams.named('NBA: Los Angeles vs Boston', '', all)) === '');
ok('club cities', ids(Teams.named('MLS on TSN: Atlanta vs. Toronto', '', all)) === 'mls:atl,mls:tor');
ok('nickname after a colon', ids(Teams.named('NFL on TSN: Browns vs. Steelers', '', all)) === 'nfl:cle,nfl:pit');
ok('nickname after its own city', ids(Teams.named('Hockey: Wild vs. Capitals (Capitals Broadcast)', 'USA ESPN+ 133', all)) === 'nhl:min,nhl:wsh');
ok('Athletics alone are no team', ids(Teams.named('World Athletics Championships', '', all)) === '');

// Team channels and leagues
const tc = Teams.teamChannels();
ok('team channel with a league tag', tc['nfl:det'] && tc['nfl:det'][0].n === 'NFL | DETROIT LIONS');
ok('team channel with country and league words', tc['nhl:car'] && tc['nhl:car'][0].n === 'USA NHL Carolina Hurricanes');
ok('event channels are not team channels', !tc['nhl:wpg'] || tc['nhl:wpg'].length === 1);
ok('Red Wings vs Lions kept apart', tc['nhl:det'] && !tc['nhl:det'].some(c => /LIONS/.test(c.n)));
const lg = Teams.leagues().map(l => l.id).join(',');
ok('leagues found', lg === 'nfl,nba,nhl', lg);
ok('a TV series is no team channel', !tc['mls:chi']);
ok('ofChannel', Teams.ofChannel(tc['nhl:det'][0]).id === 'nhl:det');

// The group
ok('no group before a team is followed', Teams.list().length === 0 && !Teams.groupOn());
Teams.follow('nhl:wpg', true);
let list = Teams.list().map(c => c.n);
ok('game on now first', /WPG VS CAR/.test(list[0]), list.join(' / '));
ok('every feed of the game on now, together', /WPG VS CAR/.test(list[1]) && list[0] !== list[1], list.join(' / '));
ok('then the next game', /Carolina Hurricanes Winnipeg Jets/.test(list[2]), list.join(' / '));
ok('one channel per game for reminders', Teams.games(0, true).length === 2);
ok('then the team channel', list[list.length - 1] === 'NHL | WINNIPEG JETS', list.join(' / '));
// Guide titles, including a team channel's "Next game" block.
const lions = tc['nfl:det'][0], espn = chans.find(c => c.n === 'ESPN');
const d = new Date(NOW + 3 * H), pad = x => String(x).padStart(2, '0');
const nextT = 'Next game: Detroit Lions at Minnesota Vikings at ' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + pad(d.getHours() % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
progs = { [lions.k]: [{ s: NOW - 20 * H, e: NOW + 20 * H, t: nextT }], [espn.k]: [{ s: NOW - H / 2, e: NOW + 2 * H, t: 'NFL Football: Lions at Vikings' }, { s: NOW + 30 * H, e: NOW + 33 * H, t: 'Detroit Lions at Chicago Bears' }] };
Teams.follow('nfl:det', true);
const g = Teams.games();
const lionsGames = g.filter(x => x.team.id === 'nfl:det');
ok('guide game on now (nicknames with NFL in the title)', lionsGames.some(x => x.c === espn && x.p.s <= NOW));
ok('next game block counts at its start, not as on now', lionsGames.some(x => x.c === lions && x.p.s > NOW + 2 * H), JSON.stringify(lionsGames.map(x => [x.c.n, x.p.s - NOW])));
ok('games past the window left out', !lionsGames.some(x => x.p.s > NOW + 6 * H));
Teams.dirty();
list = Teams.list().map(c => c.n);
ok('on-now games first, team channels after', list[0] === 'ESPN' || /WPG VS CAR/.test(list[0]), list.join(' / '));
ok('team channel once', list.filter(x => x === 'NFL | DETROIT LIONS').length === 1);
// Hidden channels stay out.
Store.edits.hiddenChannels[espn.k] = 1; Teams.dirty();
ok('hidden channels stay out', Teams.list().indexOf(espn) < 0);
delete Store.edits.hiddenChannels[espn.k];
// Unfollowing takes its reminders.
Store.edits.reminders = [{ k: 'x', s: NOW + H, w: 'team:nfl:det' }, { k: 'y', s: NOW + H, w: 'Bluey' }];
Teams.follow('nfl:det', false);
ok('unfollow removes its reminders', Store.edits.reminders.length === 1 && Store.edits.reminders[0].w === 'Bluey');
Store.settings.teamsGroup = false; Teams.dirty();
ok('group off', Teams.list().length === 0);

console.log((fail ? fail + ' of ' : 'all ') + n + ' teams checks ' + (fail ? 'failed' : 'passed'));
process.exit(fail ? 1 : 0);
