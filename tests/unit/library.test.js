// Library: channels copied, moved or taken out of provider groups, and per-group sorting.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const edits = { hiddenGroups: {}, hiddenChannels: {}, renames: {}, groupRenames: {}, custom: [{ id: 'c_fav', name: 'Favorites', items: [] }], groupOrder: [], recent: [], watch: {}, blockedGroups: {}, blockedChannels: {}, epgMap: {}, groupAdd: {}, groupRemove: {}, groupSort: {} };
const ctx = { console, Log: { info() {}, warn() {} }, Store: { edits, settings: { sortChannels: 'playlist', showHidden: false, newGroups: 'show' }, playlist: { names: { enabled: false } }, saveEdits() {} } };
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + f.replace('.js', '').replace(/^./, c => c.toUpperCase()) + ' = ' + f.replace('.js', '').replace(/^./, c => c.toUpperCase()) + ';', ctx);
load('names.js'); load('library.js');
const L = ctx.Library;
L.set({ groups: [{ id: 'a', name: 'News' }, { id: 'b', name: 'Sports' }], channels: [
  { k: '1', n: 'CNN', g: 'a', num: 3 }, { k: '2', n: 'BBC', g: 'a', num: 1 }, { k: '3', n: 'ESPN', g: 'b', num: 2 }, { k: '4', n: 'Abc', g: 'a', num: 4 }] });
const keys = g => L.channels(g).map(c => c.k).join(',');
ok('provider order by default', keys('a') === '1,2,4', keys('a'));
edits.groupAdd = { a: ['3'] }; L.dirty();
ok('copied channel shows in the other group', keys('a') === '1,2,4,3', keys('a'));
ok('and still in its own', keys('b') === '3');
edits.groupRemove = { b: { 3: 1 } }; L.dirty();
ok('moved channel leaves its own group', keys('b') === '', keys('b'));
edits.groupRemove = { a: { 2: 1 } }; L.dirty();
ok('taken-out channel is gone from the group', keys('a') === '1,4,3', keys('a'));
ok('but stays in All channels', L.channels('all').some(c => c.k === '2'));
edits.groupSort = { a: 'az' }; L.dirty();
ok('per-group A to Z', keys('a') === '4,1,3', keys('a'));
edits.groupSort = { a: 'za' }; L.dirty();
ok('per-group Z to A', keys('a') === '3,1,4', keys('a'));
edits.groupSort = { a: 'number' }; L.dirty();
ok('per-group by number', keys('a') === '3,1,4', keys('a'));
edits.custom.push({ id: 'c_x', name: 'Mine', items: ['4', '1', '3'] }); edits.groupSort = { c_x: 'az' }; L.dirty();
ok('your own group can be sorted too', keys('c_x') === '4,1,3', keys('c_x'));
edits.groupSort = {}; L.dirty();
ok('your own group keeps your order', keys('c_x') === '4,1,3');

// Other versions of a channel (backups when one stops working).
L.set({ groups: [{ id: 'us', name: 'US | News' }, { id: 'uk', name: 'UK | News' }, { id: 'x', name: 'Backup' }], channels: [
  { k: 'a', n: 'US| CNN FHD', g: 'us', num: 1 }, { k: 'b', n: 'US| CNN HD', g: 'us', num: 2 }, { k: 'c', n: 'US| CNN SD', g: 'us', num: 3 },
  { k: 'd', n: 'US| CNN 4K', g: 'us', num: 4 }, { k: 'e', n: 'CNN (Backup)', g: 'us', num: 5 }, { k: 'f', n: 'UK: CNN HD', g: 'uk', num: 6 },
  { k: 'g', n: 'US| CNN International', g: 'us', num: 7 }, { k: 'h', n: 'US| HBO East', g: 'us', num: 8 }, { k: 'i', n: 'US| HBO West', g: 'us', num: 9 },
  { k: 'j', n: 'US| HBO (E) HD', g: 'us', num: 10 }, { k: 'k', n: 'US| CNN [1080p]', g: 'x', num: 11 }, { k: 'l', n: 'US| Sky Sports 1', g: 'us', num: 12 },
  { k: 'm', n: 'US| Sky Sports 2', g: 'us', num: 13 }] });
const ver = k => L.versions(L.find(k)).map(c => c.k).join(',');
ok('versions: other qualities and copies, steadiest first', ver('c') === 'a,k,b,e,d', ver('c'));
ok('versions: never another country', !/f/.test(ver('a')));
ok('versions: a different channel with a longer name is not a version', !/g/.test(ver('a')));
ok('versions: East and West feeds stay apart', ver('h') === 'j' && ver('i') === '', ver('h') + ' / ' + ver('i'));
ok('versions: numbered channels stay apart', ver('l') === '' && ver('m') === '');
edits.hiddenChannels = { b: 1 };
ok('versions: hidden copies count (often the spares)', /b/.test(ver('a')));
edits.blockedChannels = { b: 1 };
ok('versions: never a channel locked with the PIN', !/b/.test(ver('a')));
edits.blockedChannels = {}; edits.hiddenChannels = {};
ok('quality labels', L.qualityLabel(L.find('a')) === 'FHD' && L.qualityLabel(L.find('d')) === '4K' && L.qualityLabel(L.find('e')) === '');
console.log(fail ? fail + ' failures' : 'all library tests passed');
process.exit(fail ? 1 : 0);
