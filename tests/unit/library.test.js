// Library: channels copied, moved or taken out of provider groups, and per-group sorting.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const edits = { hiddenGroups: {}, hiddenChannels: {}, renames: {}, groupRenames: {}, custom: [{ id: 'c_fav', name: 'Favorites', items: [] }], groupOrder: [], recent: [], watch: {}, blockedGroups: {}, blockedChannels: {}, epgMap: {}, groupAdd: {}, groupRemove: {}, groupSort: {} };
const ctx = { console, Log: { info() {}, warn() {} }, Store: { edits, settings: { sortChannels: 'playlist', showHidden: false, newGroups: 'show' }, playlist: { names: { enabled: false } }, saveEdits() {} } };
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + f.replace('.js', '').replace(/^./, c => c.toUpperCase()) + ' = ' + f.replace('.js', '').replace(/^./, c => c.toUpperCase()) + ';', ctx);
vm.runInContext('var U = { hhmm: function () { return ""; } };', ctx); load('names.js'); load('events.js'); load('library.js');
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

// Hide channels with nothing on: by the current name, favorites keep theirs, it comes back when renamed.
L.set({ groups: [{ id: 'ev', name: 'Events' }], channels: [{ k: 'p1', n: 'PPV 01 | UFC 330', g: 'ev', num: 1 }, { k: 'p2', n: 'PPV 02 | OFFLINE', g: 'ev', num: 2 },
  { k: 'p3', n: 'FloHockey 39 - Off Air', g: 'ev', num: 3 }, { k: 'p4', n: 'BigTen 76 | No Event Scheduled', g: 'ev', num: 4 }] });
edits.custom[0].items = ['p3'];
ctx.Store.playlist.names = { enabled: false, hideIdle: false }; L.dirty();
ok('nothing on: off by default', keys('ev') === 'p1,p2,p3,p4', keys('ev'));
ctx.Store.playlist.names.hideIdle = true; L.dirty();
ok('nothing on: hidden while they say so', keys('ev') === 'p1', keys('ev'));
ok('nothing on: a favorite keeps it', keys('c_fav') === 'p3', keys('c_fav'));
L.set({ groups: [{ id: 'ev', name: 'Events' }], channels: [{ k: 'p1', n: 'PPV 01 | UFC 330', g: 'ev', num: 1 }, { k: 'p2', n: 'PPV 02 | Boxing', g: 'ev', num: 2 }] });
ok('nothing on: back once the provider names an event', keys('ev') === 'p1,p2', keys('ev'));
ctx.Store.playlist.names = { enabled: false };

// Event channels: short names and Events by time (soonest first, over ones left out).
const t = h => { const d = new Date(Date.now() + h * 3600e3); return d.toLocaleString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }); };
ctx.Store.playlist.events = { tz: 'local' };
L.set({ groups: [{ id: 'pp', name: 'PPV' }], channels: [{ k: 'e1', n: 'PPV 01 | Late Show | ' + t(5), g: 'pp', num: 1 }, { k: 'e2', n: 'PPV 02 | Early Show | ' + t(1), g: 'pp', num: 2 },
  { k: 'e3', n: 'PPV 03 | Old Show | ' + t(-30), g: 'pp', num: 3 }, { k: 'e4', n: 'Plain Channel', g: 'pp', num: 4 }] });
ok('events: short names', L.name(L.find('e1')) === 'PPV 01' && L.name(L.find('e4')) === 'Plain Channel', L.name(L.find('e1')));
ok('events: Events by time, soonest first, over ones left out', keys(L.EVENTS) === 'e2,e1', keys(L.EVENTS));
ok('events: listed among the groups', L.groups().some(g => g.id === L.EVENTS && g.count === 2));
ok('events: not in Manage groups', !L.allGroups().some(g => g.id === L.EVENTS));
edits.renames = { e1: 'My PPV' };
ok('events: your own name wins', L.name(L.find('e1')) === 'My PPV');
edits.renames = {};
ctx.Store.playlist.events = { short: false, group: false }; L.dirty();
ok('events: short names and the group can be turned off', /Late Show/.test(L.name(L.find('e1'))) && !L.groups().some(g => g.id === L.EVENTS));
ctx.Store.playlist.events = {};

// Recently added: channels new since the last load (app.js marks them in data.added).
const day = 86400e3, now = Date.now();
L.set({ groups: [{ id: 'a', name: 'News' }, { id: 'b', name: 'Sports' }], channels: [
  { k: '1', n: 'CNN', g: 'a', num: 1 }, { k: '2', n: 'BBC', g: 'a', num: 2 }, { k: '3', n: 'ESPN', g: 'b', num: 3 }, { k: '4', n: 'Fox', g: 'b', num: 4 }],
  added: { 3: now - day, 2: now - 2 * day, 4: now - 20 * day } });
ok('new: newest first, old ones left out', keys(L.NEW) === '3,2', keys(L.NEW));
ok('new: a group of its own', L.groups().some(g => g.id === L.NEW && g.count === 2 && g.name === 'Recently added'));
ok('new: tagged', L.isNew(L.find('3')) && !L.isNew(L.find('4')) && !L.isNew(L.find('1')));
edits.hiddenChannels = { 3: 1 }; L.dirty();
ok('new: hidden channels stay hidden', keys(L.NEW) === '2', keys(L.NEW));
edits.hiddenChannels = {};
ctx.Store.settings.newDays = 0; L.dirty();
ok('new: can be turned off', !L.groups().some(g => g.id === L.NEW) && keys(L.NEW) === '');
ctx.Store.settings.newDays = 7; L.dirty();
ok('new: not in Manage groups and not reorderable', !L.allGroups().some(g => g.id === L.NEW) && !L.canReorder(L.NEW));

const customOf = id => edits.custom.filter(g => g.id === id)[0];
// Your order inside a provider group.
edits.groupSort = {}; edits.chanOrder = {}; L.dirty();
ok('order: provider order to start', keys('b') === '3,4');
ok('order: move down in a provider group', L.moveInGroup('b', '3', 1) && keys('b') === '4,3', keys('b'));
ok('order: stored as your order', edits.groupSort.b === 'custom' && edits.chanOrder.b.join() === '4,3' && L.hasOwnOrder('b'));
L.set({ groups: [{ id: 'a', name: 'News' }, { id: 'b', name: 'Sports' }], channels: [
  { k: '5', n: 'NFL', g: 'b', num: 5 }, { k: '1', n: 'CNN', g: 'a', num: 1 }, { k: '3', n: 'ESPN', g: 'b', num: 3 }, { k: '4', n: 'Fox', g: 'b', num: 4 }] });
ok('order: a channel the provider adds goes to the end', keys('b') === '4,3,5', keys('b'));
ok('order: a page at a time stops at the ends', L.moveInGroup('b', '5', -20) && keys('b') === '5,4,3', keys('b'));
ok('order: not past the top', !L.moveInGroup('b', '5', -1));
edits.hiddenChannels = { 4: 1 }; L.dirty();
ok('order: hidden channels keep their place', L.moveInGroup('b', '3', -1) && edits.chanOrder.b.join() === '5,3,4', edits.chanOrder.b.join());
edits.hiddenChannels = {}; L.dirty();
L.resetOrder('b');
ok('order: back to the provider\'s order', keys('b') === '5,3,4' && !L.hasOwnOrder('b'), keys('b'));
edits.custom.push({ id: 'c_y', name: 'Mine2', items: ['4', '3', '9', '1'] }); edits.groupSort = { c_y: 'az' }; L.dirty();
ok('order: your sorted group shows A to Z', keys('c_y') === '1,3,4', keys('c_y'));
ok('order: moving in it starts from what you see', L.moveInGroup('c_y', '4', -1) && keys('c_y') === '1,4,3' && !edits.groupSort.c_y, keys('c_y'));
ok('order: a missing channel is kept for later', customOf('c_y').items.join() === '1,4,3,9', customOf('c_y').items.join());
ok('order: virtual groups cannot be reordered', !L.moveInGroup(L.ALL, '1', 1) && !L.moveInGroup(L.RECENT, '1', 1));

// Guide ids that point nowhere: placeholders, and one id on many unrelated channels.
L.set({ groups: [{ id: 'a', name: 'X' }], channels: [
  { k: 'p1', n: 'NFL 1 | Bills @ Jets', g: 'a', epg: '0' }, { k: 'p2', n: 'NFL 2', g: 'a', epg: 'none' },
  { k: 's1', n: 'USA | A&E', g: 'a', epg: 'AandENetwork.us' }, { k: 's2', n: 'USA | CHEDDAR NEWS', g: 'a', epg: 'AandENetwork.us' },
  { k: 's3', n: 'USA | VSIN', g: 'a', epg: 'AandENetwork.us' }, { k: 's4', n: 'USA | NBC SPORTS BAY AREA+', g: 'a', epg: 'AandENetwork.us' },
  { k: 'f1', n: 'F1 11 :', g: 'a', epg: 'skysportsf1.uk' }, { k: 'f2', n: 'F1 12 :', g: 'a', epg: 'skysportsf1.uk' }, { k: 'f3', n: 'F1 13 :', g: 'a', epg: 'skysportsf1.uk' }, { k: 'f4', n: 'F1 14 :', g: 'a', epg: 'skysportsf1.uk' }] });
const ep = k => L.data.channels.find(c => c.k === k).epg;
ok('placeholder ids ("0", "none") are dropped', ep('p1') === '' && ep('p2') === '');
ok('a shared id stays on the channel it names', ep('s1') === 'AandENetwork.us');
ok('and leaves the unrelated ones', ep('s2') === '' && ep('s3') === '' && ep('s4') === '');
ok('one family of channels keeps its shared id', ep('f1') === 'skysportsf1.uk' && ep('f4') === 'skysportsf1.uk');
console.log(fail ? fail + ' failures' : 'all library tests passed');
process.exit(fail ? 1 : 0);
