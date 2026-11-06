/* What the guide says about a programme (its kind, a new episode, its season and episode) is made in two
   places from the same XML: the helper (service/guide.js movieFlag, written into titles.tsv) and the app's
   own parser (app/js/epg.js progFlag, in its worker).  They must agree, and readFlag reads it back.
     node tests/unit/progflag.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const G = require('../../service/guide.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fails++; };
// The two functions from app/js/epg.js, as the worker gets them (their source).
const src = fs.readFileSync(path.join(__dirname, '../../app/js/epg.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('  function ' + name + '('); const j = src.indexOf('\n  }\n', i); return new Function('return (' + src.slice(i, j + 4).trim() + ')')(); };
const progFlag = grab('progFlag'), readFlag = grab('readFlag');

const CASES = [
  ['<title>Bridesmaids</title><category lang="en">Movie</category><date>2011</date>', 'm2011'],
  ['<category>Sports</category><new /><episode-num system="onscreen">S02E05</episode-num>', 's!~S2 E5'],
  ['<category>Noticias</category>', 'n'],
  ['<category>Fútbol</category><category>Live</category>', 's'],
  ['<category lang="pt">Notícias</category>', 'n'],
  ['<category>Children</category><episode-num system="onscreen">E12</episode-num>', 'c~E12'],
  ['<category>Documentary</category><category>Nature</category>', 'd'],
  ['<episode-num system="xmltv_ns">0.4.0/1</episode-num>', '~S1 E5'],
  ['<episode-num system="xmltv_ns">.9.</episode-num>', '~E10'],
  ['<episode-num system="onscreen">S1 E3</episode-num><episode-num system="xmltv_ns">7.7.</episode-num>', '~S1 E3'],
  ['<category>Drama</category><new/>', '!'],
  ['<category>Series</category>', ''],
  ['<title>Plain</title>', '']
];
CASES.forEach(([xml, want]) => {
  const a = G.movieFlag(xml), b = progFlag(xml);
  ok('"' + want + '" from ' + xml.slice(0, 60), a === want && b === want, 'helper ' + JSON.stringify(a) + ', app ' + JSON.stringify(b));
});
const r = readFlag('s!~S2 E5', {});
ok('readFlag: kind, new, episode', r.k === 's' && r.n === 1 && r.ep === 'S2 E5' && !r.mv, JSON.stringify(r));
const m = readFlag('m2011', {});
ok('readFlag: a movie and its year, as before', m.mv === 1 && m.y === '2011' && !m.k, JSON.stringify(m));
ok('readFlag: nothing from nothing, or from a flag it does not know', JSON.stringify(readFlag('', {})) === '{}' && JSON.stringify(readFlag('zz9', {})) === '{}');
console.log(fails ? fails + ' FAILED' : 'all programme flag checks passed');
process.exit(fails ? 1 : 0);
