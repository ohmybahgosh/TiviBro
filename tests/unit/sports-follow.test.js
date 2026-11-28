/* Following cricket sides and Formula 1 (teams.js, sports.js; discussions #184 and #200): ESPN's cricket sides get My
   teams' ids by name (never by abbreviation), and a race weekend's session counts as followed by the sessions chosen. */
'use strict';
const fs = require('fs'), vm = require('vm');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const ctx = { console, Date, Math, String, JSON, RegExp, Promise, setTimeout, navigator: { language: 'en-IN' },
  Store: { playlist: { events: {} }, settings: { myTeams: [] }, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] }, saveSettings() {}, saveEdits() {} },
  Library: { data: { channels: [], groups: [] }, find: () => null, name: (c) => c.n, isFav: () => false, shownAnywhere: () => true } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/js/teams.js', 'utf8') + '\nthis.Teams = Teams;', ctx);
vm.runInContext(fs.readFileSync('app/js/sports.js', 'utf8') + '\nthis.Sports = Sports;', ctx);
const S = ctx.Sports, T = ctx.Teams;
const side = (name, abbr, home) => ({ displayName: name, abbreviation: abbr, homeAway: home ? 'home' : 'away' });
const hdr = { sports: [{ leagues: [{ name: 'India tour of New Zealand', events: [{ id: '1', name: 'New Zealand v India', date: new Date().toISOString(), status: 'in', class: { internationalClassId: 2 },
  competitors: [side('New Zealand', 'NZ', true), side('India', 'IND')] }, { id: '2', name: 'New Zealand Women v South Africa Women', date: new Date().toISOString(), status: 'pre', class: { internationalClassId: 2 },
  competitors: [side('New Zealand Women', 'NZ', true), side('South Africa Women', 'SA')] }] }] }] };
const gs = vm.runInContext('Sports', ctx) && S._cricket ? S._cricket(hdr) : null;
const list = gs || [];
ok('ESPN\'s cricket sides get My teams\' ids by name', list.length === 2 && list[0].teams.map((t) => t.id).sort().join() === 'cricket:ind,cricket:nz', JSON.stringify(list.map((g) => g.teams.map((t) => t.id))));
ok('a women\'s side is the women\'s team, not the men\'s by its abbreviation', list[1] && list[1].teams.map((t) => t.id).sort().join() === 'cricket:nzw,cricket:saw', list[1] && JSON.stringify(list[1].teams.map((t) => t.id)));
T.follow('cricket:ind', true);
ok('a followed side\'s match is yours', S.follows(list[0]) && !S.follows(list[1]));
const q = { session: 'Qualifying', teams: [] }, p1 = { session: 'Practice 1', teams: [] };
ok('Formula 1 not followed: no session is yours', !S.follows(q));
T.follow(T.F1, true);
ok('Formula 1 followed: qualifying is yours, practice isn\'t (the default)', S.follows(q) && !S.follows(p1));
ctx.Store.settings.f1Sessions = 'all';
ok('...every session when chosen', S.follows(p1));
ok('Cricket and Formula 1 load once followed', S.followedLeagues().join() === 'cricket,f1', S.followedLeagues().join());
if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all following tests passed');
