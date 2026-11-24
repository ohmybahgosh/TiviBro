// A public guide whose times are hours off is left out (service/guide.js saidGap, hoursOff): epg.pw's US file in
// Nov 2026 had every time 8 hours late though marked +0000, and filled Detroit locals with the morning news at noon.
'use strict';
const G = require('../../service/guide');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const at = (h, m) => Date.UTC(2026, 10, 24, h, m || 0);

ok('a title ending with its time: hours between the start (UTC) and that time', G.saidGap('7 News Detroit This Morning at 4:30am', at(9, 30)) === 5, G.saidGap('7 News Detroit This Morning at 4:30am', at(9, 30)));
ok('pm, and a gap across midnight', G.saidGap('Local 4 News at 11pm', at(4)) === 5 && G.saidGap('News at 6 p.m.', at(23)) === 5);
ok('no time, or one in the middle of the title ("Next game ... at 10:00PM EST"): not counted', G.saidGap('Good Morning America', at(12)) === -1 && G.saidGap('Next Game: A @ B on 2026-11-25 at 10:00PM EST', at(3)) === -1);

// US local news, Eastern to Pacific: right times fit; 8 hours late doesn't.
const right = [], late = [];
for (let i = 0; i < 40; i++) { const tz = 5 + (i % 4), h = 4 + (i % 8); right.push(G.saidGap('News at ' + h + 'am', at(h + tz))); late.push(G.saidGap('News at ' + h + 'am', at(h + tz + 8))); }
ok('a US guide with the right times: not off', G.hoursOff(right, 'US') === 0, G.hoursOff(right, 'US'));
ok('a US guide 8 hours late: hours off (left out; how many is a guess, the time zone is not known)', G.hoursOff(late, 'US') >= 5 && G.hoursOff(late, 'US') <= 10, G.hoursOff(late, 'US'));
ok('too few titles with a time: not judged', G.hoursOff(late.slice(0, 10), 'US') === 0);
ok('a country without its time zones listed: not judged', G.hoursOff(late, 'DE') === 0);
ok('a few odd ones in a right guide: not off', G.hoursOff(right.concat([1, 2, 3]), 'US') === 0);

console.log(fails ? fails + ' failures' : 'all guide time checks passed');
process.exit(fails ? 1 : 0);
