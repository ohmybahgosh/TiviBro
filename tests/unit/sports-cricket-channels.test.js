/* Cricket matches found in the guide (sports.js cricketChannels): ESPN names no broadcaster, so a programme naming
   both sides comes first, then a channel named after the match, then a cricket programme on a cricket channel. */
'use strict';
const fs = require('fs'), vm = require('vm');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const now = Date.now(), H = 3600e3;
const chans = [
  { k: 'a', n: 'Star Sports 1 HD', g: 'g' }, { k: 'b', n: 'IN: Star Sports 2', g: 'g' }, { k: 'c', n: 'Willow HD', g: 'g' },
  { k: 'd', n: 'IND vs NZ LIVE', g: 'g' }, { k: 'e', n: 'Colors', g: 'g' }, { k: 'f', n: 'Sony Sports Ten 1', g: 'g' }];
const progs = { a: [{ s: now - H, e: now + 2 * H, t: 'Live Cricket: New Zealand v India, 2nd Test, Day 3' }],
  b: [{ s: now - H, e: now + 2 * H, t: 'Live Cricket' }], c: [{ s: now - H, e: now + 2 * H, t: 'NZ vs IND Highlights' }],
  e: [{ s: now - H, e: now + 2 * H, t: 'Bigg Boss' }], f: [{ s: now - H, e: now + 2 * H, t: 'India Women v New Zealand Women 1st ODI' }] };
const ctx = { console, Date, Math, String, JSON, RegExp, Promise, setTimeout, navigator: { language: 'en-IN' },
  Store: { settings: {}, edits: { hiddenChannels: {}, hiddenGroups: {}, reminders: [] } },
  Library: { data: { channels: chans, groups: [] }, find: (k) => chans.find((c) => c.k === k), name: (c) => c.n, isFav: () => false, shownAnywhere: () => true },
  Epg: { search: (test, lim) => { const out = []; Object.keys(progs).forEach((k) => progs[k].forEach((p) => { if (test(p.t)) out.push({ key: k, p }); })); return out; }, epgId: () => '' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/js/sports.js', 'utf8') + '\nthis.Sports = Sports;', ctx);
const S = ctx.Sports;
const g = { id: '1', lg: 'cricket', s: now - 5 * H, state: 'in', nets: [], teams: [{ full: 'New Zealand', name: 'New Zealand', abbr: 'NZ', id: '' }, { full: 'India', name: 'India', abbr: 'IND', id: '' }] };
const r = S.channels(g).map((x) => x.c.k + ':' + x.how);
console.log(r);
ok('the programme naming both sides comes first', r[0] === 'a:guide');
ok('a channel named after the match', r.indexOf('d:guide') >= 0);
ok('a cricket programme on a cricket channel, after', r.indexOf('b:net') > r.indexOf('d:guide'));
ok('not highlights, not the women\'s match, not another channel', r.indexOf('c:guide') < 0 && r.indexOf('c:net') < 0 && r.indexOf('f:guide') < 0 && r.indexOf('e:net') < 0);
const gw = Object.assign({}, g, { id: '2', teams: [{ full: 'India Women', abbr: 'INDW', id: '' }, { full: 'New Zealand Women', abbr: 'NZW', id: '' }] });
const rw = S.channels(gw).map((x) => x.c.k + ':' + x.how);
ok('the women\'s match finds its own', rw[0] === 'f:guide' && rw.indexOf('a:guide') < 0, rw.join(' '));
ok('side names', JSON.stringify(S._sideNames({ full: 'South Africa', abbr: 'SA' })) === '["south africa","sa","rsa","proteas"]');
if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all cricket channel tests passed');
