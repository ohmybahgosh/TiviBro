/* The content filter (app/js/filter.js): the built-in adult words, your own words and call signs,
   channels and groups hidden by name, and that the playlist kept on the TV stays whole.
     node tests/unit/filter.test.js */
'use strict';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const settings = { filter: { adult: true, words: [], chans: [], groups: [] } };
global.Store = { settings, saveSettings() {} };
const Filter = require('../../app/js/filter.js');

const yes = ['XXX | Hot', 'ADULTS ONLY', 'For Adults', 'Brazzers TV', 'Playboy TV HD', 'Hustler HD', 'Dorcel TV', 'Erotic Channel', 'Erótico', 'Canal para adultos', 'Adultos 1',
  'Penthouse Gold', 'Redlight HD', 'Private TV', 'Venus TV', '18+ Movies', 'Movies +18', 'Эротика', 'Для взрослых', 'Porn Hub TV', 'PORNO', 'Sexy Hot', 'Vivid Red HD', 'Per Adulti', 'Pour adultes'];
const no = ['Adult Swim', 'ADULT SWIM HD', 'Essex TV', 'Sextant Docs', 'Pornography Ban Debate', 'Middlesex News', 'Private Practice 24/7', 'ESPN', 'Channel 18', '18 Kids', 'Erie News', 'Hottest Hits', 'Grown-ups Comedy'];
ok('the built-in list catches adult names in several languages', yes.every((n) => Filter.matches(n)), yes.filter((n) => !Filter.matches(n)).join(', '));
const wrong = no.filter((n) => Filter.matches(n) && n !== 'Pornography Ban Debate');
ok('and leaves ordinary names alone (Adult Swim, Essex, Private Practice)', !wrong.length, wrong.join(', '));

const d = {
  groups: [{ id: 'g1', name: 'USA | News' }, { id: 'g2', name: 'XXX | 18+' }, { id: 'g3', name: 'USA | Locals' }, { id: 'g4', name: 'Shopping' }],
  channels: [
    { k: 'a', n: 'CNN', g: 'g1' }, { k: 'b', n: 'Hot Girls', g: 'g2' }, { k: 'c', n: 'WXYZ Detroit', g: 'g3' }, { k: 'd', n: 'WDIV Detroit', g: 'g3' },
    { k: 'e', n: 'Playboy TV', g: 'g1' }, { k: 'f', n: 'QVC', g: 'g4' }, { k: 'h', n: 'Flagged', g: 'g1', adult: 1 }
  ],
  tz: 'x'
};
let out = Filter.apply(d);
ok('adult groups and their channels go, and adult-named channels in other groups', out.groups.map((g) => g.id).join() === 'g1,g3,g4' && out.channels.map((c) => c.k).join() === 'a,c,d,f', out.channels.map((c) => c.k).join());
ok('a channel the provider marks adult goes too', !out.channels.some((c) => c.k === 'h'));
ok('the kept playlist is untouched (a new object)', d.channels.length === 7 && d.groups.length === 4 && out !== d && out.tz === 'x');
ok('says how much it left out', Filter.last.channels === 3 && Filter.last.groups === 1, JSON.stringify(Filter.last));

Filter.addWord('wxyz'); out = Filter.apply(d);
ok('your own word or call sign, any case, whole words', !out.channels.some((c) => c.k === 'c') && out.channels.some((c) => c.k === 'd'));
Filter.addWord('Shop'); out = Filter.apply(d);
ok('a word is a whole word: "Shop" leaves "Shopping"', out.groups.some((g) => g.id === 'g4'));
Filter.addGroup('Shopping'); Filter.addChannel('CNN'); out = Filter.apply(d);
ok('a group and a channel hidden by name', !out.groups.some((g) => g.id === 'g4') && !out.channels.some((c) => c.k === 'f' || c.k === 'a'), out.channels.map((c) => c.k).join());
Filter.remove('chans', 'CNN'); Filter.remove('groups', 'Shopping'); Filter.remove('words', 'wxyz'); Filter.remove('words', 'Shop'); Filter.setAdult(false);
out = Filter.apply(d);
ok('off again: everything is back, the same object', out === d && Filter.last.channels === 0 && !Filter.active());
ok('turning it off counts as answered', settings.filter.asked === true);
console.log(fails ? fails + ' FAILED' : 'all content filter checks passed');
process.exit(fails ? 1 : 0);
