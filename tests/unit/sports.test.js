// Sports (app/js/sports.js): ESPN's scoreboard read into games, teams tied to My teams ids, and a game's channels:
// the guide naming it (Teams.games for every team playing), then a national network by its name.
const fs = require('fs'), path = require('path');
global.window = global;
global.U = { hhmm: t => new Date(t).toISOString().slice(11, 16) };
global.Store = { playlist: { events: {} }, settings: { myTeams: ['nhl:det'], teamsAhead: 6 }, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] }, saveSettings() {}, saveEdits() {} };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/events.js'), 'utf8') + ';global.Events=Events;');
let fail = 0;
const ok = (name, c, x) => { if (!c) { fail++; console.log('FAIL ' + name + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } else console.log('PASS ' + name); };
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/espn-nhl-scoreboard.json'), 'utf8'));
// The fixture's game moved to later today (up to two hours from now, before midnight): the guide is searched
// from now on, so a fixed date passed or failed by the time of day the tests ran.
const ev = fx.events[0], midnight = new Date(); midnight.setHours(24, 0, 0, 0);
ev.date = new Date(Math.floor(Math.min(Date.now() + 2 * 3600e3, midnight.getTime() - 120e3) / 60000) * 60000).toISOString().replace(/:00\.000Z$/, 'Z');
const start = Date.parse(ev.date);
let progs = {};
global.Epg = { xml: false, epgId: () => '', onUpdate() {}, findDesc: () => Promise.resolve([]), search(test) { const out = []; Object.keys(progs).forEach(k => progs[k].forEach(p => { if (test(p.t)) out.push({ key: k, p }); })); return out; } };
const groups = [{ id: 'g1', name: 'US Sports' }, { id: 'g2', name: 'US Locals' }, { id: 'g3', name: 'Movies' }];
let num = 0;
const ch = (n, g) => ({ k: 'k' + (++num), n, g, num });
const chans = [ch('US| ESPN+ HD', 'g1'), ch('US| NHL NETWORK HD', 'g1'), ch('FanDuel Sports Detroit', 'g1'), ch('US| ESPN', 'g1'), ch('HBO', 'g3'), ch('FOX 2 DETROIT', 'g2')];
global.Library = { data: { channels: chans, groups }, find: k => chans.find(c => c.k === k), isFav: () => false, name: c => c.n.replace(/^US\| /, '').replace(/ HD$/, ''), shownAnywhere: () => true, mixed: () => true };
eval(fs.readFileSync(path.join(__dirname, '../../app/js/teams.js'), 'utf8') + ';global.Teams=Teams;');
const Sports = require('../../app/js/sports.js');

const lg = Sports.league('nhl'), g = Sports._game(lg, ev);
ok('two teams, visitors first', g.teams.length === 2 && !g.teams[0].home && g.teams[1].home, g.teams.map(t => t.abbr));
ok('teams carry logos and records', g.teams.every(t => /^https:\/\/a\.espncdn\.com\//.test(t.logo) && t.rec), g.teams.map(t => t.rec));
ok('ESPN teams tie to My teams ids', g.teams.some(t => t.id === 'nhl:det') && g.teams.every(t => /^nhl:/.test(t.id)), g.teams.map(t => t.id));
ok('networks read', g.nets.length > 0, g.nets);
ok('start and state', g.s === start && g.state === 'pre');
ok('title is visitors at home', /^.+ at .+$/.test(Sports.title(g)));

// A channel by its network name, quality tags off, ESPN+ is not ESPN.
ok('network by name', Sports.byNet('NHL Net').map(c => c.k).join() === 'k2');
ok('ESPN is ESPN, not ESPN+', Sports.byNet('ESPN').map(c => c.k).join() === 'k4', Sports.byNet('ESPN').map(c => c.n));
ok('a network not on the list finds nothing', Sports.byNet('Scripps Sports').length === 0);

// The guide: the local station lists the game around its start.
const away = g.teams[0].full, home = g.teams[1].full;
progs = { k6: [{ s: start, e: start + 3 * 3600e3, t: 'NHL Hockey: ' + away + ' at ' + home }] };
Sports._store.nhl = {}; Sports._store.nhl[Sports.dayKey(0)] = { at: Date.now(), games: [g] };
Store.settings.sportsLeagues = ['nhl'];
const cs = Sports.channels(g);
ok('the guide finds the game on the local station first', cs.length && cs[0].c.k === 'k6' && cs[0].how === 'guide', cs.map(x => x.c.n + ':' + x.how));
ok('the network channel follows when ESPN names one', !g.nets.some(n => /NHL Net/.test(n)) || cs.some(x => x.c.k === 'k2' && x.how === 'net'));
ok('channels that have nothing to do with it stay out', !cs.some(x => x.c.k === 'k5'));
// A game's page: box score by period, leaders, the division's standings.
const sum = Sports._readSummary(JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/espn-nba-summary.json'), 'utf8')));
ok('box score: visitors first, a line a quarter', sum.lines.length === 2 && !sum.lines[0].home && sum.lines[0].periods.length === 4, sum.lines);
ok('leaders for both teams', sum.leaders.length === 2 && sum.leaders.every(l => l.list.length && l.list[0].who), sum.leaders);
ok('standings with a record and games back', sum.standings.length && sum.standings[0].rows[0].rec && sum.standings[0].rows[0].extra && sum.standings[0].rows[0].extra.k === 'GB', sum.standings[0] && sum.standings[0].rows[0]);
ok('standings name without the season', sum.standings[0].name && !/^\d{4}/.test(sum.standings[0].name), sum.standings[0].name);
// Hiding scores: a followed team's game shows no score until shown once.
Store.settings.sportsHide = [];
const live = Object.assign({}, g, { id: 'x1', state: 'in' });
ok('a game is shown by default', !Sports.hidden(live));
Sports.hideTeam('nhl:det', true);
ok('a hidden team hides the score', Sports.hidden(live));
ok('a game not started has nothing to hide', !Sports.hidden(Object.assign({}, live, { state: 'pre' })));
Sports.reveal(live);
ok('shown once on its page', !Sports.hidden(live));
// The game on a channel: the guide names the two teams.
const liveG = Object.assign({}, g, { state: 'in' });
Sports._store.nhl[Sports.dayKey(0)] = { at: Date.now(), games: [liveG] };
global.Epg.nowNext = c => c.k === 'k6' ? { now: { t: 'NHL Hockey: ' + away + ' at ' + home, s: start, e: start + 3 * 3600e3 } } : null;
ok('the game on the channel the guide says', Sports.gameOn(chans[5]) && Sports.gameOn(chans[5]).id === g.id);
ok('no game on a movie channel', !Sports.gameOn(chans[4]));
// Two games on now that both take in the station, one only by a team its listing names (a description that
// mentions the other game's team in passing): the game the listing names both teams of is the one on it.
{
  const other = Object.assign({}, liveG, { id: 'x2', s: start, teams: [{ id: 'nhl:chi', abbr: 'CHI', full: 'Chicago Blackhawks', name: 'Blackhawks' }, { id: 'nhl:bos', abbr: 'BOS', full: 'Boston Bruins', name: 'Bruins', home: true }], nets: [] });
  progs = { k6: [{ s: start, e: start + 3 * 3600e3, t: 'NHL Hockey: ' + away + ' at ' + home }, { s: start, e: start + 3 * 3600e3, t: 'NHL Hockey: Boston Bruins at Montreal Canadiens' }] };
  Sports._store.nhl[Sports.dayKey(0)] = { at: Date.now(), games: [other, liveG] };
  const saveNN = global.Epg.nowNext;
  global.Epg.nowNext = c => c.k === 'k6' ? { now: { t: 'Live: NHL Hockey', s: start, e: start + 3 * 3600e3 } } : null;
  Library.data.channels = chans.slice();                 // the guide looked at again (its games are kept two minutes per channel list)
  const rk = (gg) => (Sports.channels(gg).find(x => x.c.k === 'k6') || {}).r;
  ok('two games take in the station: the other only by one team', rk(other) === 1 && rk(liveG) === 0, { other: rk(other), mine: rk(liveG) });
  ok('and the game on it is the one its listing names both teams of', (Sports.gameOn(chans[5]) || {}).id === g.id, (Sports.gameOn(chans[5]) || {}).id);
  global.Epg.nowNext = saveNN; Library.data.channels = chans;
  Sports._store.nhl[Sports.dayKey(0)] = { at: Date.now(), games: [liveG] };
}
// Close games near the end, for the alerts (sportslive.js).
global.Sports = Sports;
eval(fs.readFileSync(path.join(__dirname, '../../app/js/sportslive.js'), 'utf8') + ';global.SportsLive=SportsLive;');
const two = (a, b) => [{ score: a }, { score: b }];
ok('NBA: 3 points with 2 minutes left in the 4th is close', SportsLive._close({ lg: 'nba', state: 'in', period: 4, clock: '2:10', teams: two(102, 105) }));
ok('NBA: 15 points is not', !SportsLive._close({ lg: 'nba', state: 'in', period: 4, clock: '2:10', teams: two(90, 105) }));
ok('NBA: close in the 2nd is not near the end', !SportsLive._close({ lg: 'nba', state: 'in', period: 2, clock: '2:10', teams: two(50, 51) }));
ok('NHL: one goal with 4 minutes left in the 3rd', SportsLive._close({ lg: 'nhl', state: 'in', period: 3, clock: '4:00', teams: two(2, 3) }));
ok('soccer: the 85th minute, level', SportsLive._close({ lg: 'epl', state: 'in', period: 2, clock: "85'", teams: two(1, 1) }));
// The corner: a followed team's game, unless that team is turned off for the corner (sportsBarOff) or hidden.
Store.settings.sportsHide = [];
const det = { id: 'x9', teams: [{ id: 'nhl:det' }, { id: 'nhl:nyi' }] }, other = { id: 'x8', teams: [{ id: 'nhl:bos' }, { id: 'nhl:nyr' }] };
ok('the corner: a followed team\'s game', SportsLive._inCorner(det) && !SportsLive._inCorner(other));
Store.settings.sportsBarOff = ['nhl:det'];
ok('the corner: not a team turned off for it', !SportsLive._inCorner(det));
Store.settings.sportsBarOff = [];
ok('a final is not a close game', !SportsLive._close({ lg: 'nba', state: 'post', period: 4, clock: '0:00', teams: two(102, 105) }));
console.log(fail ? fail + ' failures' : 'all sports tests passed');
process.exit(fail ? 1 : 0);
