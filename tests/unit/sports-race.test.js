/* A race weekend in Sports (sports.js race, discussion #200): one item per session with its time, state and first
   three; the championship standings; and each session found in the guide by its name at its time. */
'use strict';
const fs = require('fs'), vm = require('vm');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const now = Date.now(), H = 3600e3, iso = (t) => new Date(t).toISOString();
const chans = [{ k: 'a', n: 'Sky Sports F1 HD', g: 'g' }, { k: 'b', n: 'ESPN', g: 'g' }, { k: 'c', n: 'Sky Sports Main Event', g: 'g' }];
const progs = { a: [{ s: now - 10 * 60000, e: now + H, t: 'F1: Qatar GP Qualifying' }, { s: now - 3 * H, e: now - H, t: 'F1: Qatar GP Practice 3' }],
  b: [{ s: now - 10 * 60000, e: now + H, t: 'SportsCenter' }], c: [{ s: now - 5 * 60000, e: now + H, t: 'F1 Qualifying Highlights' }] };
const ctx = { console, Date, Math, String, JSON, RegExp, Promise, setTimeout, navigator: { language: 'en-GB' },
  Store: { settings: {}, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] } },
  Library: { data: { channels: chans, groups: [] }, find: (k) => chans.find((c) => c.k === k), name: (c) => c.n, isFav: () => false, shownAnywhere: () => true },
  Epg: { search: (test) => { const out = []; Object.keys(progs).forEach((k) => progs[k].forEach((p) => { if (test(p.t)) out.push({ key: k, p }); })); return out; }, epgId: () => '' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/js/sports.js', 'utf8') + '\nthis.Sports = Sports;', ctx);
const S = ctx.Sports, lg = S.league('f1');
const drv = (o, n) => ({ order: o, athlete: { shortName: n } });
const ev = { id: '600', name: 'Qatar Airways Qatar Grand Prix', circuit: { fullName: 'Lusail International Circuit' }, competitions: [
  { id: '1', type: { abbreviation: 'FP3' }, date: iso(now - 3 * H), status: { type: { state: 'post', completed: true, detail: 'Final' } }, competitors: [drv(2, 'G. Russell'), drv(1, 'K. Antonelli'), drv(3, 'L. Norris'), drv(4, 'M. Verstappen')], broadcasts: [{ names: ['Apple TV'] }] },
  { id: '2', type: { abbreviation: 'Qual' }, date: iso(now - 5 * 60000), status: { type: { state: 'in', detail: 'Q2' } }, competitors: [drv(1, 'L. Norris')] },
  { id: '3', type: { abbreviation: 'Race' }, date: iso(now + 22 * H), status: { type: { state: 'pre' } }, competitors: [] }] };
const ss = S._race(lg, ev);
ok('one item per session, with its own time and state', ss.length === 3 && ss.map((g) => g.session + ':' + g.state).join() === 'Practice 3:post,Qualifying:in,Race:pre', ss.map((g) => g.session + ':' + g.state).join());
ok('the first three of a session run, in order', ss[0].top.join('|') === '1 K. Antonelli|2 G. Russell|3 L. Norris', ss[0].top.join('|'));
ok('the circuit and the broadcaster', ss[0].venue === 'Lusail International Circuit' && ss[0].nets[0] === 'Apple TV');
ok('sessions in titles', S._sessionIn('Qualifying', 'F1: Qatar GP Qualifying') && !S._sessionIn('Qualifying', 'F1 Sprint Qualifying') && S._sessionIn('Practice 2', 'Formula 1: FP2') && S._sessionIn('Race', 'Formula 1: Qatar Grand Prix') && !S._sessionIn('Race', 'F1: Practice 1'));
const cs = S.channels(ss[1]).map((x) => x.c.k + ':' + x.how);
ok('qualifying live: the F1 channel showing it, not highlights or another channel', cs.join() === 'a:guide', cs.join());
const st = S._raceStandings({ children: [
  { name: 'Driver Standings', standings: { entries: [{ athlete: { shortName: 'K. Antonelli' }, stats: [{ name: 'rank', displayValue: '1' }, { name: 'championshipPts', displayValue: '402' }] }] } },
  { name: 'Constructor Standings', standings: { entries: [{ team: { displayName: 'Mercedes' }, stats: [{ name: 'points', displayValue: '666' }] }] } }] });
ok('the drivers\' and constructors\' championships, with points', st.length === 2 && st[0].rows[0].team === 'K. Antonelli' && st[0].rows[0].extra.v === '402' && st[1].rows[0].team === 'Mercedes' && st[1].rows[0].extra.v === '666', JSON.stringify(st));
if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all race weekend tests passed');
