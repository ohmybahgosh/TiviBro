/* Tags some guides put in titles in tiny raised or small-capital letters ("General Hospital ᴺᵉʷ"): they come
   off the title, and "New" becomes the programme's NEW mark (app/js/epg.js tidyTitles, run on every list).
     node tests/unit/title-tags.test.js */
'use strict';
const fs = require('fs'), path = require('path');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const src = fs.readFileSync(path.join(__dirname, '../../app/js/epg.js'), 'utf8');
const i = src.indexOf('  function tidyTitles('), j = src.indexOf('\n  }\n', i);
const tidy = new Function('return (' + src.slice(i, j + 4).trim() + ')')();
const run = (t) => { const l = [{ s: 0, e: 1, t: t }]; tidy(l); return l[0]; };

let p = run('General Hospital ᴺᵉʷ');
ok('"General Hospital ᴺᵉʷ": the tag comes off, and it is marked NEW', p.t === 'General Hospital' && p.n === 1, p);
p = run('Show ɴᴇᴡ');
ok('small capitals "ɴᴇᴡ" too', p.t === 'Show' && p.n === 1, p);
p = run('ᴺᴱᵂ Series Premiere');
ok('in front of the title too', p.t === 'Series Premiere' && p.n === 1, p);
p = run('NBA ᴸᶦᵛᵉ: Lakers at Celtics');
ok('other tags ("ᴸᶦᵛᵉ") come off without a NEW mark', p.t === 'NBA: Lakers at Celtics' && !p.n, p);
p = run('Movie Night ᴴᴰ');
ok('"ᴴᴰ" too', p.t === 'Movie Night' && !p.n, p);
for (const t of ['CO₂ Rising', 'H₂O: The Molecule', 'Hawaiʻi Five-0', 'Beyond the Gates', 'Ελληνικά Νέα', 'Новости']) {
  p = run(t);
  ok('left as it is: "' + t + '"', p.t === t && !p.n, p);
}
p = run('🏈🎓 [NCAAF] College Football');
ok('EPGTalk: emoji off, the league in brackets in front becomes "NCAAF: "', p.t === 'NCAAF: College Football' && !p.n, p);
p = run('SEC Now [NEW]');
ok('"[NEW]" at the end becomes the NEW mark', p.t === 'SEC Now' && p.n === 1, p);
p = run('Game Night [LIVE]');
ok('"[LIVE]" comes off without a NEW mark', p.t === 'Game Night' && !p.n, p);
p = run('[HD] Movie Night');
ok('"[HD]" in front is not taken for a league', p.t === '[HD] Movie Night', p);
p = run('ᴺᵉʷ');
ok('a title that is only a tag keeps its text rather than going blank', p.t === 'ᴺᵉʷ', p);
// A game's two sides only in the sub-title (EPGTalk's sports guide): into the title, in the helper and the app.
const G = require('../../service/guide.js');
const wi = src.indexOf('    var GAME_T ='), wj = src.indexOf('\n    }\n', src.indexOf('function withSub', wi));
const appSub = new Function('unesc', src.slice(wi, wj + 6) + '; return withSub;')((x) => x.replace(/&amp;/g, '&'));
[['helper', G.withSub], ['app', appSub]].forEach(([who, f]) => {
  ok(who + ': "College Football" and "Dartmouth at Princeton" make the game', f('🏈🎓 [NCAAF] College Football', '<title>x</title><sub-title>Dartmouth at Princeton</sub-title>') === '🏈🎓 [NCAAF] College Football: Dartmouth at Princeton');
  ok(who + ': before a [Live] tag at the end', f('College Football [Live]', '<sub-title>Texas A&amp;M at Texas</sub-title>') === 'College Football: Texas A&M at Texas [Live]');
  ok(who + ': an episode title is left out', f('Friends', '<sub-title>The One at the Beach</sub-title>') === 'Friends' && f('College Football Live', '<sub-title>Week 10 preview</sub-title>') === 'College Football Live');
});
console.log(fails ? fails + ' failures' : 'all title tag tests passed');
process.exit(fails ? 1 : 0);
