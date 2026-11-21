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
const ev = fx.events[0], start = Date.parse(ev.date);
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
console.log(fail ? fail + ' failures' : 'all sports tests passed');
process.exit(fail ? 1 : 0);
