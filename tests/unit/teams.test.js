// My teams (app/js/teams.js): team channels, and games found in event channel names and guide titles.
// The channel names are the shapes of real providers' "NFL TEAMS", "NHL PASS" and "USA NHL" groups.
const fs = require('fs'), path = require('path');
global.window = global;
global.U = { hhmm: t => new Date(t).toISOString().slice(11, 16) };
global.Store = { playlist: { events: {} }, settings: { myTeams: [], teamsAhead: 6 }, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] }, saveSettings() {}, saveEdits() {} };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/events.js'), 'utf8') + ';global.Events=Events;');
let progs = {};
let descs = [];
let onUpd = [];
global.Epg = { xml: false, epgId: () => '', onUpdate: f => onUpd.push(f), findDesc: () => Promise.resolve(descs), search(test) { const out = []; Object.keys(progs).forEach(k => progs[k].forEach(p => { if (test(p.t)) out.push({ key: k, p }); })); return out; } };
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
const fb = l => ids(l.filter(x => x.league === 'ncaaf')), bb = l => ids(l.filter(x => x.league === 'ncaab'));
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
ok('a game is a game', Teams.isGame('Minnesota Vikings at Detroit Lions', 'NFL | DETROIT LIONS') && Teams.isGame('WPG VS CAR (TVAS Feed )', 'USA NHL 02'));
ok('a placeholder is no game', !Teams.isGame('Future Events for Detroit Tigers not found yet', 'MLB | DETROIT TIGERS') && !Teams.isGame('No Future Events Scheduled', 'NHL | DETROIT RED WINGS'));
ok('a "Next game" block is no game to remind at', !Teams.isGame('Next game: Detroit Red Wings at Florida Panthers at 11/02/2026 07:00 PM (US/Eastern)', 'NHL | FLORIDA PANTHERS'));
// A school's full name doesn't say the sport (a FOX ONE event channel, Nov 11: basketball, Marquette has no football).
ok('a school against a non-FBS school with no football in sight is no football game', fb(Teams.named('Marquette Golden Eagles vs Michigan Wolverines', 'Marquette Golden Eagles vs Michigan Wolverines @ Nov 11 19:00 :FOX ONE  12 | FOX ONE', all, true)) === '' && !Teams.isGame('Marquette Golden Eagles vs Michigan Wolverines', 'Marquette Golden Eagles vs Michigan Wolverines @ Nov 11 19:00 :FOX ONE  12', 'ncaaf'));
ok('the same with football in the channel is', ids(Teams.named('Sacramento State Hornets at Michigan Wolverines', 'NCAAF 2 | Sacramento State Hornets at Michigan Wolverines', all, true)) === 'ncaaf:mich,ncaaf:sac' && Teams.isGame('Sacramento State Hornets at Michigan Wolverines', 'NCAAF 2'));
ok('basketball in the channel is not', fb(Teams.named('Michigan Wolverines vs Ohio State Buckeyes', 'NCAAB 08', all, true)) === '');
ok('it is college basketball', bb(Teams.named('Michigan Wolverines vs Ohio State Buckeyes', 'NCAAB 08', all, true)) === 'ncaab:mich,ncaab:osu');
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
// For reminders, one per game: the same two teams within 12 hours are one game (the one on now and its
// later listing here), and the earliest start is kept.
const one = Teams.games(0, true);
ok('one reminder per game: the same two teams within 12 hours are one game, the earliest kept', one.length === 1 && one[0].p.s < NOW, one.map(g => g.c.n + ' ' + new Date(g.p.s).toISOString()).join(' / '));
ok('an overtime block and a replay are not the game', Teams.aroundGame('Philadelphia 76ers at Detroit Pistons possible Overtime') && Teams.aroundGame('Philadelphia 76ers at Detroit Pistons (Replay)') &&
  !Teams.isGame('Philadelphia 76ers at Detroit Pistons possible Overtime', 'NBA | DETROIT PISTONS') && !Teams.aroundGame('Philadelphia 76ers at Detroit Pistons'));
ok('the same game however a channel titles it', Teams.matchup('NBA Basketball : Philadelphia 76ers at Detroit Pistons', 'USA | ESPN 2') === 'nba:det/nba:phi' &&
  Teams.matchup('Philadelphia 76ers at Detroit Pistons', 'NBA | DETROIT PISTONS') === 'nba:det/nba:phi' && Teams.matchup('Detroit Pistons Postgame', '') === '');
ok('a team channel with no game soon is left out', list.indexOf('NHL | WINNIPEG JETS') < 0, list.join(' / '));
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
ok('the team channel showing its next game is in once', list.filter(x => x === 'NFL | DETROIT LIONS').length === 1, list.join(' / '));
ok('live games at the top, the next ones at the bottom', list[list.length - 1] === 'NFL | DETROIT LIONS', list.join(' / '));
// Not games: a placeholder, a team show with one team named.
const hbo = chans.find(c => c.n === 'HBO');
const tig = ch('MLB | DETROIT TIGERS', 'g1'); chans.push(tig);
progs[tig.k] = [{ s: NOW - H, e: NOW + 5 * H, t: 'Future Events for Detroit Tigers not found yet' }];
progs[hbo.k] = [{ s: NOW - H, e: NOW + H, t: 'Inside the Detroit Lions' }];
Teams.follow('mlb:det', true); Teams.dirty();
list = Teams.list().map(c => c.n);
ok('"not found yet" is no game', list.indexOf('MLB | DETROIT TIGERS') < 0, list.join(' / '));
ok('a show about one team is no game', list.indexOf('HBO') < 0, list.join(' / '));
// The game named only in the description, on a sports title.
const fox = ch('FOX 2 Detroit', 'g5'); chans.push(fox);
const foxGame = { s: NOW - H, e: NOW + 2 * H, t: 'NFL Football' }, foxNews = { s: NOW + H, e: NOW + 2 * H, t: 'FOX 2 News' };
progs[fox.k] = [foxGame, foxNews];
descs = [{ key: fox.k, p: foxGame, d: 'Minnesota Vikings at Detroit Lions.  From Ford Field.' }, { key: fox.k, p: foxNews, d: 'The Detroit Lions beat the Minnesota Vikings.' }];
Teams.dirty(); Teams.list();
(async () => {
for (let w = 0; w < 3; w++) { await new Promise(r => setTimeout(r, 20)); Teams.list(); }
Teams.dirty();
list = Teams.list().map(c => c.n);
ok('a game named only in the description', list.indexOf('FOX 2 Detroit') >= 0, list.join(' / '));
ok('the news after it is not one', Teams.games().filter(x => x.c === fox).length === 1);
// From Bob's TV: the opponent's own channel, a team channel's "Next game" block for tomorrow whose
// description names the game, a postgame show, and a local station in your own group while its provider
// group is hidden.
const vik = tc['nfl:min'][0];
progs[vik.k] = [{ s: NOW - H, e: NOW + 2 * H, t: 'Minnesota Vikings at Detroit Lions' }];
const tomorrow = new Date(NOW + 30 * H), p2 = x => String(x).padStart(2, '0');
const hornets = ch('NBA | CHARLOTTE HORNETS', 'g6'); chans.push(hornets);
const hornNext = { s: NOW - 2 * H, e: NOW + 28 * H, t: 'Next game: Detroit Pistons at Charlotte Hornets at ' + p2(tomorrow.getMonth() + 1) + '/' + p2(tomorrow.getDate()) + '/' + tomorrow.getFullYear() + ' 07:30 PM' };
progs[hornets.k] = [hornNext];
const post = { s: NOW + 2 * H, e: NOW + 3 * H, t: 'Live: NFL on FOX Postgame' };
progs[fox.k].push(post);
const wjbk = ch('US: FOX 2 WJBK Detroit', 'g8'); chans.push(wjbk); groups.push({ id: 'g8', name: 'US Locals' });
const wjbkGame = { s: NOW - H, e: NOW + 2 * H, t: 'Live: NFL Football' };
progs[wjbk.k] = [wjbkGame];
Store.edits.hiddenGroups.g8 = 1;
Library.shownAnywhere = c => !Store.edits.hiddenChannels[c.k] && (!Store.edits.hiddenGroups[c.g] || c === wjbk);   // in "Local channels"
descs = descs.concat([{ key: hornets.k, p: hornNext, d: 'Detroit Pistons at Charlotte Hornets.' }, { key: fox.k, p: post, d: 'Reaction after the Minnesota Vikings and Detroit Lions.' },
  { key: wjbk.k, p: wjbkGame, d: 'The Detroit Lions host the Minnesota Vikings in NFL regular-season play at Ford Field.' }]);
Teams.follow('nba:det', true);
for (let w = 0; w < 3; w++) { await new Promise(r => setTimeout(r, 20)); Teams.dirty(); Teams.list(); }
list = Teams.list().map(c => c.n);
ok('the opponent\'s own channel is left out', list.indexOf('NFL | MINNESOTA VIKINGS') < 0, list.join(' / '));
ok('a "Next game" block for tomorrow is no game now, whatever its description says', list.indexOf('NBA | CHARLOTTE HORNETS') < 0, list.join(' / '));
ok('a postgame show is no game', !Teams.games().some(x => x.p === post));
ok('a local station in your own group, its provider group hidden', list.indexOf('US: FOX 2 WJBK Detroit') >= 0, list.join(' / '));
delete Library.shownAnywhere; delete Store.edits.hiddenGroups.g8;
// The guide arriving after the group was first worked out (TiviBro just started): looked at again.
const late = ch('NFL | CHICAGO BEARS', 'g1'); chans.push(late);
Teams.follow('nfl:chi', true); Teams.list();
progs[late.k] = [{ s: NOW - H, e: NOW + 2 * H, t: 'Green Bay Packers at Chicago Bears' }];
ok('before the guide says so, no Bears game', Teams.list().indexOf(late) < 0);
onUpd.forEach(f => f(null));
ok('the guide loading brings it in at once', onUpd.length === 1 && Teams.list().indexOf(late) >= 0, onUpd.length);
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

// Reminders an earlier TiviBro set for one Pistons game (alpha 83, from the TV): the game at 7 PM on the
// team channel, its "possible Overtime" block, and the same game again on ESPN 2 and a regional channel
// after midnight.  The game at 7 PM is the one kept.
global.Search = { find: () => [] }; global.Log = { info() {}, warn() {} }; global.Remind = { sync() {} };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/watch.js'), 'utf8') + ';global.Watch=Watch;');
const T0 = NOW + 2 * H, w = 'team:nba:det';
Store.edits.reminders = [
  { k: 'kx1', s: T0, e: T0 + 3 * H, t: 'Philadelphia 76ers at Detroit Pistons', w, g: 1 },
  { k: 'kx1', s: T0 + 3 * H, e: T0 + 4 * H, t: 'Philadelphia 76ers at Detroit Pistons possible Overtime', w, g: 1 },
  { k: 'kx2', s: T0 + 7 * H, e: T0 + 9 * H, t: 'NBA Basketball : Philadelphia 76ers at Detroit Pistons', w, g: 1 },
  { k: 'kx3', s: T0 + 8 * H, e: T0 + 9 * H, t: 'Philadelphia 76ers at Detroit Pistons', w, g: 1 },
  { k: 'kx3', s: T0 + 9 * H, e: T0 + 10 * H, t: 'Philadelphia 76ers at Detroit Pistons', w, g: 1 },
  { k: 'kx1', s: T0 + 48 * H, e: T0 + 51 * H, t: 'Philadelphia 76ers at Detroit Pistons', w, g: 1 },
  { k: 'kx9', s: T0 + 3 * H, e: T0 + 4 * H, t: 'Philadelphia 76ers at Detroit Pistons' }
];
Watch.tidy();
const left = Store.edits.reminders.map(r => (r.s - T0) / H + 'h' + (r.w ? '' : ' (yours)')).join(', ');
ok('one reminder per game: the overtime block and the later airings go, the game and the one two days on stay, and one you set yourself is left alone', left === '0h, 3h (yours), 48h', left);

// Bob's TV (Nov 8): the Lions game twice, "Detroit Lions at Miami Dolphins" on the team's channel and
// "Live: NFL Football" on the local CBS station, both at 1:00.  One reminder: the listing that names the game.
const T1 = NOW + 3 * H, wl = 'team:nfl:det';
Store.edits.reminders = [
  { k: 'cbs', s: T1, e: T1 + 3 * H, t: 'Live: NFL Football', w: wl, g: 1 },
  { k: 'lions', s: T1, e: T1 + 3 * H, t: 'Detroit Lions at Miami Dolphins', w: wl, g: 1 },
  { k: 'pistons', s: T1 + 5 * H, e: T1 + 8 * H, t: 'Los Angeles Lakers at Detroit Pistons', w: 'team:nba:det', g: 1 }
];
Watch.tidy();
const left2 = Store.edits.reminders.map(r => r.t).join(' | ');
ok('one team, two listings of one game at the same time: one reminder, the one that names the game', left2 === 'Detroit Lions at Miami Dolphins | Los Angeles Lakers at Detroit Pistons', left2);

// College football: full names anywhere, school names where it's college football, never nicknames alone.
ok('college: full names in an event channel', ids(Teams.named('SMU Mustangs Virginia Tech Hokies', 'NCAAF 1 | ⬬ NCAA Football', all, true)) === 'ncaaf:smu,ncaaf:vt');
ok('college: schools in a college football title', ids(Teams.named('College Football : Alabama at LSU ᴸᶦᵛᵉ', 'ESPN', all)) === 'ncaaf:ala,ncaaf:lsu');
ok('college: the longest school name', ids(Teams.named('College Football: Michigan State at Michigan', '', all)) === 'ncaaf:mich,ncaaf:msu' && ids(Teams.named('College Football: Miami (OH) at Ohio', '', all)) === 'ncaaf:moh,ncaaf:ohio');
ok('college: schools need college football', ids(Teams.named('Michigan at Ohio State', 'ESPN', all)) === '');
ok('college: not another school with the name in it', ids(Teams.named('College Football: Alabama State at Alabama', '', all)) === 'ncaaf:ala' && ids(Teams.named('College Football: Michigan vs. Central Connecticut', '', all)) === 'ncaaf:mich');
ok('college: not the basketball game', fb(Teams.named('Michigan Wolverines vs Duke Blue Devils', 'NCAAB 3 | ⬬ NCAA Basketball', all, true)) === '' && fb(Teams.named('NCAAM: Michigan Wolverines vs Duke Blue Devils', '', all)) === '');
ok('college: no Kansas in Kansas City', ids(Teams.named('Super Bowl LX: Kansas City Chiefs vs Philadelphia Eagles', '', all)) === 'nfl:kc,nfl:phi');
ok('college: Louisville Cardinals are not Arizona\'s', fb(Teams.named('Louisville Cardinals at Clemson Tigers', 'ACC Network', all)) === 'ncaaf:clem,ncaaf:lou');
ok('college: one school against an FCS one is a game', Teams.isGame('College Football: Michigan vs. Central Connecticut', 'BTN') && Teams.matchup('College Football: Michigan vs. Central Connecticut', 'BTN') === 'ncaaf:mich');
ok('college: shows are no games', !Teams.isGame('College Football Live', 'ESPN') && !Teams.isGame('College GameDay', 'ESPN') && !Teams.isGame('College Football Scoreboard', 'CBSSN'));

// College basketball: the same schools and the Division I ones without FBS football, in its own season.
{
  const nb = Teams.inLeague ? Teams.inLeague('ncaab') : all.filter(x => x.league === 'ncaab');
  const ab = {}; nb.forEach(x => { ab[x.abbr] = (ab[x.abbr] || 0) + 1; });
  ok('college basketball: one abbreviation per school', !Object.keys(ab).some(k => ab[k] > 1), Object.keys(ab).filter(k => ab[k] > 1).join());
  ok('college basketball: schools in a basketball title', bb(Teams.named('NCAAB: Purdue at Michigan State', '', all)) === 'ncaab:msu,ncaab:pur' && fb(Teams.named('NCAAB: Purdue at Michigan State', '', all)) === '');
  ok('college basketball: schools without FBS football', bb(Teams.named('Gonzaga Bulldogs vs Saint Mary\'s Gaels', 'NCAAB 4', all, true)) === 'ncaab:gonz,ncaab:smc');
  ok('college basketball: Penn and Penn State apart', bb(Teams.named('College Basketball: Penn State at Penn', '', all)) === 'ncaab:penn,ncaab:psu');
  ok('college basketball: not the women\'s game', bb(Teams.named('NCAAW: Michigan State Spartans vs Purdue Boilermakers', '', all)) === '' && bb(Teams.named('Michigan State Spartans vs Purdue Boilermakers', 'NCAA Women\'s Basketball', all)) === '');
  ok('college basketball: not the hockey game', bb(Teams.named('Michigan State Spartans vs Michigan Wolverines', 'Big Ten Hockey', all)) === '');
  ok('college basketball: a game is a game of its league', Teams.isGame('NCAAB: Purdue at Michigan State', '', 'ncaab') && !Teams.isGame('NCAAB: Purdue at Michigan State', '', 'ncaaf'));
}

// From Bob's TV (a Friday in November): "Purdue Boilermakers vs Michigan State Spartans" on a FOX ONE channel was
// basketball.  A school plays football once a week, so with its football game this week elsewhere, it's left out.
const foxOne = ch('FOX ONE 15', 'g5'), btn = ch('BTN', 'g5'); chans.push(foxOne, btn);
progs[foxOne.k] = [{ s: NOW + H, e: NOW + 3 * H, t: 'Purdue Boilermakers vs Michigan State Spartans' }];
progs[btn.k] = [{ s: NOW + 50 * H, e: NOW + 53 * H, t: 'College Football: Michigan State at Washington' }];
['nhl:wpg', 'nfl:det', 'mlb:det'].forEach(id => Teams.follow(id, false));
Teams.follow('ncaaf:msu', true); Teams.dirty();
const msu = Teams.games().filter(x => x.team.id === 'ncaaf:msu').map(x => x.c.n);
ok('college: a school\'s other game, with football its football game this week elsewhere, is left out', msu.indexOf('FOX ONE 15') < 0, msu.join(' / '));
const msuWeek = Teams.games(7 * 24 * H, true).filter(x => x.team.id === 'ncaaf:msu').map(x => x.p.t);
ok('college: and the football game is kept', msuWeek.some(t => /Michigan State at Washington/.test(t)) && !msuWeek.some(t => /Purdue/.test(t)), msuWeek.join(' / '));
// Without that football game, a weekday game is still out when the school's other one this week is on a Saturday.
const sat = new Date(NOW + H); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(15, 30, 0, 0);
progs[btn.k] = [{ s: +sat, e: +sat + 3 * H, t: 'Michigan State Spartans at Washington Huskies' }];
Teams.dirty();
if (new Date(NOW + H).getDay() !== 6) {
  const msu2 = Teams.games().filter(x => x.team.id === 'ncaaf:msu').map(x => x.c.n);
  ok('college: a weekday game, with the school on a Saturday this week too, is left out', msu2.indexOf('FOX ONE 15') < 0, msu2.join(' / '));
}
progs[btn.k] = []; Teams.dirty();
const msu3 = Teams.games().filter(x => x.team.id === 'ncaaf:msu').map(x => x.c.n);
const d1 = new Date(NOW + H), inSeason = d1.getMonth() >= 8 || (d1.getMonth() === 7 && d1.getDate() >= 15);
if (inSeason) ok('college: alone, two FBS schools in season still count', msu3.indexOf('FOX ONE 15') >= 0, msu3.join(' / '));

// The same Friday game, for Michigan State basketball: it's that game, and the football one isn't.
progs[btn.k] = [{ s: NOW + 50 * H, e: NOW + 53 * H, t: 'College Football: Michigan State at Washington' }];
Teams.follow('ncaaf:msu', false); Teams.follow('ncaab:msu', true); Teams.dirty();
const hoops = Teams.games(7 * 24 * H, true).filter(x => x.team.id === 'ncaab:msu').map(x => x.p.t);
ok('college basketball: the Friday game is basketball, the football game isn\'t', hoops.some(t => /Purdue/.test(t)) && !hoops.some(t => /Washington/.test(t)), hoops.join(' / '));
// A game listed bare and again with its sport at the same time: that sport.
const sat2 = new Date(NOW + H); sat2.setDate(sat2.getDate() + ((6 - sat2.getDay() + 7) % 7 || 7)); sat2.setHours(15, 30, 0, 0);
progs[foxOne.k] = [{ s: +sat2 - 5 * 60e3, e: +sat2 + 3 * H, t: 'Oregon Ducks Michigan State Spartans' }];
progs[btn.k] = [{ s: +sat2, e: +sat2 + 3 * H, t: 'NCAAF: College Football: Michigan State at Oregon' }];
Teams.dirty();
const hoops2 = Teams.games(7 * 24 * H, true).filter(x => x.team.id === 'ncaab:msu').map(x => x.p.t);
ok('college basketball: a bare listing of the football game is left out', !hoops2.some(t => /Oregon/.test(t)), hoops2.join(' / '));
Teams.follow('ncaab:msu', false);

// Reminders: three channels with one game, one of them an hour out: the time two of them give wins.
{
  const fa = ch('FOX 13 Seattle', 'g5'), fb2 = ch('NFL Network', 'g5'), fc = ch('CBS Sports HQ', 'g5'); chans.push(fa, fb2, fc);
  const t1 = NOW + 2 * H, t2 = NOW + 3 * H;
  progs[fa.k] = [{ s: t1, e: t1 + 3 * H, t: 'Denver Broncos at Las Vegas Raiders' }];
  progs[fb2.k] = [{ s: t2, e: t2 + 3 * H, t: 'Denver Broncos at Las Vegas Raiders' }];
  progs[fc.k] = [{ s: t2 + 5 * 60e3, e: t2 + 3 * H, t: 'NFL Football: Broncos at Raiders' }];
  Teams.follow('nfl:den', true); Teams.dirty();
  let g1 = Teams.games(6 * H, true).filter(x => x.team.id === 'nfl:den');
  ok('reminders: the start most channels agree on wins over an odd one out', g1.length === 1 && Math.abs(g1[0].p.s - t2) <= 5 * 60e3, JSON.stringify(g1.map(x => [x.c.n, (x.p.s - NOW) / H])));
  // Two against two: a tie keeps the earliest, so it's never missed.
  const fd = ch('FOX 10 Phoenix', 'g5'); chans.push(fd);
  progs[fd.k] = [{ s: t1, e: t1 + 3 * H, t: 'Denver Broncos at Las Vegas Raiders' }];
  Teams.dirty();
  g1 = Teams.games(6 * H, true).filter(x => x.team.id === 'nfl:den');
  ok('reminders: a tie keeps the earliest', g1.length === 1 && g1[0].p.s === t1, JSON.stringify(g1.map(x => [x.c.n, (x.p.s - NOW) / H])));
  Teams.follow('nfl:den', false);
  [fa, fb2, fc, fd].forEach(c => { delete progs[c.k]; });
}

// A reminder whose channel was given to another game (issue: an event channel slot the provider reused):
// moved to where the game is now, or gone when it's nowhere.
{
  const slot = ch('NBA 07', 'g6'), slot2 = ch('NBA 09', 'g6'); chans.push(slot, slot2);
  Epg.request = (c) => progs[c.k] || null;
  const t = NOW + 4 * H, g = 'Detroit Pistons at Washington Wizards';
  progs[slot.k] = [{ s: t, e: t + 3 * H, t: g }];
  Teams.follow('nba:det', true); Teams.dirty();
  const r = { k: slot.k, s: t, e: t + 3 * H, t: g, w: 'team:nba:det' };
  ok('reminders: still on its channel, nothing to do', Teams.recheck(r) === null);
  progs[slot.k] = [{ s: t, e: t + 3 * H, t: 'Boston Celtics at Miami Heat' }];
  progs[slot2.k] = [{ s: t + 30 * 60e3, e: t + 3 * H, t: g }];
  Teams.dirty();
  const x = Teams.recheck(r);
  ok('reminders: its channel lists another game now, so it moves to where the game is', x && x.c === slot2 && x.p.s === t + 30 * 60e3, JSON.stringify(x && { c: x.c && x.c.n, s: x.p && x.p.s - t, gone: x.gone }));
  progs[slot2.k] = [{ s: t, e: t + 3 * H, t: 'Utah Jazz at Denver Nuggets' }];
  Teams.dirty();
  const y = Teams.recheck(r);
  ok('reminders: nowhere in the guide any more: gone, with what the channel lists', y && y.gone && /Celtics/.test(y.now || ''), JSON.stringify(y));
  Teams.follow('nba:det', false);
  [slot, slot2].forEach(c => { delete progs[c.k]; });
  delete Epg.request;
}

console.log((fail ? fail + ' of ' : 'all ') + n + ' teams checks ' + (fail ? 'failed' : 'passed'));
process.exit(fail ? 1 : 0);
})();
