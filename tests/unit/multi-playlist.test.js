// Several playlists at once: channel keys, the merged lists, edits kept per playlist, and playback
// from each channel's own playlist.  Runs the real store.js, library.js and source.js in a sandbox.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

function sandbox(ls) {
  const mem = Object.assign({}, ls || {});
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const ctx = { console, localStorage, mem, setTimeout, clearTimeout, Log: { info() {}, warn() {}, error() {}, debug() {} }, window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var U = { debounce: function (fn) { var d = function () { fn.apply(this, arguments); }; d.cancel = function () {}; return d; }, hash: function (s) { return String(s.length); }, hhmm: function () { return ""; }, pad: function (n) { return n < 10 ? "0" + n : "" + n; }, toast: function () {} };', ctx);
  const load = (f, name) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + name + ' = ' + name + ';', ctx);
  load('names.js', 'Names'); load('events.js', 'Events'); load('store.js', 'Store'); load('library.js', 'Library');
  load('plshape.js', 'PlShape');
  vm.runInContext('var Net = { active: false, wrap: function (u) { return u; } };', ctx);
  load('source.js', 'Source');
  return ctx;
}
const A = { id: 'pA', name: 'Alpha', type: 'xtream', server: 'http://a.example:8080', user: 'ua', pass: 'pa' };
const B = { id: 'pB', name: 'Bravo', type: 'xtream', server: 'http://b.example', user: 'ub', pass: 'pb', ua: 'BravoAgent' };
const dataA = () => ({ groups: [{ id: 'x1', name: 'News' }, { id: 'x2', name: 'Sports' }], channels: [
  { k: 'x5761', id: 5761, n: 'CNN', g: 'x1', num: 1 }, { k: 'x2', id: 2, n: 'ESPN', g: 'x2', num: 2, arch: 3 }], tz: 'UTC' });
const dataB = () => ({ groups: [{ id: 'x1', name: 'Movies' }, { id: 'x9', name: 'Kids' }], channels: [
  { k: 'x5761', id: 5761, n: 'HBO', g: 'x1', num: 1 }, { k: 'x7', id: 7, n: 'Cartoons', g: 'x9', num: 2, arch: 2 }, { k: 'x8', id: 8, n: 'Disney', g: 'x9', num: 3 }], tz: 'Europe/London', exp: 1 });

// ---------- one playlist: nothing changes ----------
{
  const ctx = sandbox({ 'tivibro.settings': JSON.stringify({ playlists: [A, Object.assign({ off: true }, B)], active: 'pA' }),
    'tivibro.edits.pA': JSON.stringify({ hiddenChannels: { x2: 1 } }) });
  const S = ctx.Store, L = ctx.Library, d = dataA();
  L.set(d);
  ok('one playlist: no other playlist is on', S.others().length === 0);
  ok('one playlist: the data is the playlist\'s own object', L.data === d);
  ok('one playlist: keys stay the provider\'s', L.find('x5761') && !L.find('x5761').p);
  ok('one playlist: no headings in the group column', !L.groups(true).some(g => g.head));
  ok('one playlist: the first playlist\'s data is the data', L.firstData() === L.data);
  L.hideChannel('x5761', true);
  ok('one playlist: edits saved to its own file as before', JSON.parse(ctx.mem['tivibro.edits.pA']).hiddenChannels.x5761 === 1);
  ok('one playlist: nothing written for the playlist that is off', !ctx.mem['tivibro.edits.pB']);
  ok('one playlist: stream from its server', ctx.Source.streamUrl(L.find('x2'), 'ts') === 'http://a.example:8080/live/ua/pa/2.ts');
}

// ---------- two playlists ----------
const lsTwo = () => ({ 'tivibro.settings': JSON.stringify({ playlists: [A, B], active: 'pA' }),
  'tivibro.edits.pA': JSON.stringify({ hiddenChannels: { x2: 1 }, custom: [{ id: 'c_fav', name: 'Favorites', items: ['x5761', 'pB:x8'] }], groupOrder: ['x2', 'x1'] }),
  'tivibro.edits.pB': JSON.stringify({ hiddenChannels: { x8: 1 }, renames: { x7: 'Toons' }, groupOrder: ['x9', 'x1'], groupAdd: { x9: ['x5761', 'pA:x2'] }, knownGroups: ['x1', 'x9'],
    custom: [{ id: 'c_fav', name: 'Favorites', items: ['x7'] }], groupSort: { x9: 'custom' }, chanOrder: { x9: ['x8', 'x7'] } }) });
{
  const ctx = sandbox(lsTwo());
  const S = ctx.Store, L = ctx.Library;
  ok('two playlists: the other one is on', S.others().map(p => p.id).join() === 'pB');
  L.set(dataA());
  ok('attach merges its edits', S.attach('pB') === true);
  const e = S.edits;
  ok('its hidden channels are prefixed', e.hiddenChannels['pB:x8'] === 1 && e.hiddenChannels.x2 === 1 && !e.hiddenChannels.x8);
  ok('its renames are prefixed', e.renames['pB:x7'] === 'Toons');
  ok('its group order is prefixed and kept after the first\'s', e.groupOrder.join() === 'x2,x1,pB:x9,pB:x1', e.groupOrder.join());
  ok('channel keys inside group maps follow (its own and the first\'s)', e.groupAdd['pB:x9'].join() === 'pB:x5761,x2', JSON.stringify(e.groupAdd));
  ok('its own Favorites stay in its file, not merged', e.custom.length === 1 && e.custom[0].items.join() === 'x5761,pB:x8');
  L.setOther('pB', dataB());
  ok('the same provider key in two playlists: two channels', L.find('x5761').n === 'CNN' && L.find('pB:x5761').n === 'HBO');
  ok('the other playlist\'s channels carry its id', L.find('pB:x7').p === 'pB' && !L.find('x2').p);
  ok('and its groups too', L.data.groups.filter(g => g.p === 'pB').map(g => g.id).join() === 'pB:x1,pB:x9');
  ok('All channels has both, the first playlist first', L.data.channels.map(c => c.k).join() === 'x5761,x2,pB:x5761,pB:x7,pB:x8');
  ok('renamed channel of the other playlist shows its name', L.name(L.find('pB:x7')) === 'Toons');
  const gs = L.groups(true), heads = gs.filter(g => g.head);
  ok('a heading per playlist', heads.map(h => h.name).join() === 'Alpha,Bravo', heads.map(h => h.name).join());
  const ids = gs.map(g => g.head ? '#' + g.name : g.id).join();
  ok('special groups first, then each playlist\'s groups under its heading', ids === 'c_fav,all,#Alpha,x2,x1,#Bravo,pB:x9,pB:x1', ids);
  ok('no headings without asking', !L.groups().some(g => g.head));
  ok('the first playlist\'s data alone, for the set-up tour', L.firstData().channels.map(c => c.k).join() === 'x5761,x2' && L.firstData().groups.length === 2);
  // Its own channel copied in and your order there; the first playlist's x2 is copied in too, but hidden.
  ok('copied in, and your order, inside the other playlist\'s group', L.channels('pB:x9').map(c => c.k).join() === 'pB:x7,pB:x5761', L.channels('pB:x9').map(c => c.k).join());
  ok('with hidden ones, a channel of the first playlist copied in', L.channels('pB:x9', true).map(c => c.k).join() === 'pB:x8,pB:x7,pB:x5761,x2', L.channels('pB:x9', true).map(c => c.k).join());
  ok('Favorites hold channels of both playlists', L.channels('c_fav').map(c => c.k).join() === 'x5761');
  S.edits.hiddenChannels['pB:x8'] = 0; delete S.edits.hiddenChannels['pB:x8']; L.dirty();
  ok('Favorites: the other playlist\'s channel once shown', L.channels('c_fav').map(c => c.k).join() === 'x5761,pB:x8');

  // Writes go to the right file.
  L.hideChannel('pB:x7', true);
  L.renameChannel('pB:x8', 'Mouse');
  L.toggleFav('pB:x7');
  L.hideGroup('pB:x1', true);
  L.moveGroup('pB:x1', -1);
  S.flushEdits();
  const fa = JSON.parse(ctx.mem['tivibro.edits.pA']), fb = JSON.parse(ctx.mem['tivibro.edits.pB']);
  ok('hiding a channel of the other playlist: stored in its edits, bare', fb.hiddenChannels.x7 === 1 && !fa.hiddenChannels['pB:x7'] && !fa.hiddenChannels.x7);
  ok('renaming: stored in its edits', fb.renames.x8 === 'Mouse' && !fa.renames['pB:x8']);
  ok('hiding a group: stored in its edits', fb.hiddenGroups.x1 === 1 && !fa.hiddenGroups['pB:x1']);
  ok('moving a group stays among its own playlist\'s groups', fb.groupOrder.join() === 'x1,x9' && fa.groupOrder.join() === 'x2,x1', fb.groupOrder.join() + ' / ' + fa.groupOrder.join());
  ok('channel keys in its group maps written back as its file holds them', fb.groupAdd.x9.join() === 'x5761,pA:x2' && fb.chanOrder.x9.join() === 'x8,x7');
  ok('its own fields are kept (its Favorites, known groups)', fb.custom[0].items.join() === 'x7' && fb.knownGroups.join() === 'x1,x9');
  ok('Favorites belong to the first playlist, with the prefixed key', fa.custom[0].items.indexOf('pB:x7') >= 0);
  ok('the first playlist\'s own edits stay as they were', fa.hiddenChannels.x2 === 1 && Object.keys(fa.hiddenChannels).length === 1);
  ok('home: a key\'s playlist and its key there', S.home('pB:x7').id === 'pB' && S.home('pB:x7').k === 'x7' && S.home('x2').id === 'pA');
  ok('backup form of each playlist', S.fileEdits('pB').hiddenChannels.x7 === 1 && !S.fileEdits('pA').hiddenChannels['pB:x7']);

  // Playback and catch-up use each channel's own playlist.
  const Src = ctx.Source;
  Src.setTz('UTC'); Src.setTz('Europe/London', 'pB');
  ok('stream of the first playlist: its server and login', Src.streamUrl(L.find('x5761'), 'ts') === 'http://a.example:8080/live/ua/pa/5761.ts');
  ok('stream of the other playlist: its server and login', Src.streamUrl(L.find('pB:x5761'), 'ts') === 'http://b.example/live/ub/pb/5761.ts');
  ok('per-channel guide from its own playlist', /^http:\/\/b\.example\/player_api\.php\?username=ub&password=pb&action=get_short_epg&stream_id=7/.test(Src.shortEpgUrl(L.find('pB:x7'))));
  const t = Date.UTC(2026, 6, 1, 12, 0);
  ok('catch-up from its own server, in its server\'s time zone', Src.catchupUrl(L.find('pB:x7'), t, t + 3600e3) === 'http://b.example/timeshift/ub/pb/60/2026-07-01:13-00/7.ts', Src.catchupUrl(L.find('pB:x7'), t, t + 3600e3));
  ok('catch-up of the first playlist unchanged', Src.catchupUrl(L.find('x2'), t, t + 3600e3) === 'http://a.example:8080/timeshift/ua/pa/60/2026-07-01:12-00/2.ts');
  ok('plOf: the other playlist for its channel (its User-Agent)', S.plOf(L.find('pB:x7')).ua === 'BravoAgent' && S.plOf(L.find('x2')).id === 'pA');

  // Turning it off takes its channels and edits out; its file stays.
  L.dropOther('pB'); S.detach('pB');
  ok('off: its channels leave the lists', !L.find('pB:x7') && L.data.channels.length === 2 && !L.groups(true).some(g => g.head));
  ok('off: its edits leave memory', !Object.keys(S.edits.hiddenChannels).some(k => k.indexOf('pB:') === 0));
  ok('off: its file is kept', JSON.parse(ctx.mem['tivibro.edits.pB']).hiddenChannels.x7 === 1);

  // The other playlist becomes the first: its keys are bare, the old first's get the prefix.
  S.usePlaylist('pB');
  ok('first playlist changed: its edits are bare', S.edits.hiddenChannels.x7 === 1 && S.edits.renames.x8 === 'Mouse');
  S.attach('pA');
  ok('and the old first playlist\'s are prefixed', S.edits.hiddenChannels['pA:x2'] === 1);
  ok('keys pointing back resolve to the new first playlist', S.edits.groupAdd.x9.join() === 'x5761,pA:x2');
  L.clearOthers(); L.set(dataB()); L.setOther('pA', dataA());
  ok('its channels now keep their own keys', L.find('x7') && !L.find('x7').p && L.find('pA:x2').p === 'pA');
  S.flushEdits();
  ok('files unchanged by the swap', JSON.parse(ctx.mem['tivibro.edits.pA']).hiddenChannels.x2 === 1 && JSON.parse(ctx.mem['tivibro.edits.pB']).hiddenChannels.x7 === 1 && !JSON.parse(ctx.mem['tivibro.edits.pB']).hiddenChannels['pA:x2']);
}

// ---------- numbers, events, name rules and Movies and Shows per playlist ----------
{
  const ls = lsTwo(), st = JSON.parse(ls['tivibro.settings']);
  st.playlists[1].names = { enabled: true, groups: true, rules: {}, prefixes: ['BR: '], suffixes: [], hideIdle: true };
  st.playlists[1].events = { on: false };
  ls['tivibro.settings'] = JSON.stringify(st);
  ls['tivibro.edits.pB'] = JSON.stringify({ resume: { m12: { pos: 100, dur: 900, at: 1 }, s4: { pos: 61, dur: 1e6, at: 2, ep: 'e40', l: 'S1 E2' } }, watched: { e39: 1 }, myList: ['m12'] });
  const ctx = sandbox(ls), S = ctx.Store, L = ctx.Library;
  const a = dataA(); a.channels.push({ k: 'x77', id: 77, n: 'Fight 7:00pm', g: 'x1', num: 1523 });
  const b = dataB(); b.channels.push({ k: 'x78', id: 78, n: 'BR: Fight 7:00pm', g: 'x9', num: 0 }, { k: 'x79', id: 79, n: 'BR: Off Air', g: 'x9', num: 0 });
  L.set(a); S.attach('pB'); L.setOther('pB', b);
  ok('numbers: the first playlist keeps its own', L.find('x5761').num === 1 && L.find('x77').num === 1523);
  ok('numbers: the other playlist starts after the next thousand', L.find('pB:x5761').num === 2001 && L.find('pB:x8').num === 2003 && L.find('pB:x78').num === 2004, [L.find('pB:x5761').num, L.find('pB:x8').num, L.find('pB:x78').num].join());
  const nums = L.data.channels.map(c => c.num);
  ok('numbers: every channel has its own number', new Set(nums).size === nums.length, nums.join());
  L.set(a);
  ok('numbers: the same after the lists are built again', L.find('pB:x5761').num === 2001);
  ok('names: each playlist\'s own rules', L.name(L.find('pB:x78')) === 'Fight 7:00pm', L.name(L.find('pB:x78')));
  ok('events: on for the first playlist\'s channel', !!ctx.Events.of(L.find('x77')));
  ok('events: off for the other playlist, which turned them off', !ctx.Events.of(L.find('pB:x78')));
  ok('events: on for some playlist', ctx.Events.onAny() === true);
  ok('nothing on: hidden by the other playlist\'s own rule', !L.channels('pB:x9').some(c => c.k === 'pB:x79') && L.channels('pB:x9', true).some(c => c.k === 'pB:x79'));
  const e = S.edits;
  ok('Movies and Shows: its resume points prefixed', e.resume['pB:m12'] && e.resume['pB:m12'].pos === 100);
  ok('Movies and Shows: a show\'s episode follows', e.resume['pB:s4'].ep === 'pB:e40', e.resume['pB:s4'].ep);
  ok('Movies and Shows: watched and My list prefixed', e.watched['pB:e39'] === 1 && e.myList.indexOf('pB:m12') >= 0);
  e.resume['pB:m13'] = { pos: 5, dur: 9, at: 3 }; e.myList.push('pB:s4'); e.myList.push('m1');
  S.flushEdits();
  const fb = JSON.parse(ctx.mem['tivibro.edits.pB']), fa = JSON.parse(ctx.mem['tivibro.edits.pA']);
  ok('Movies and Shows: written back to its own playlist, bare', fb.resume.m13 && fb.resume.s4.ep === 'e40' && fb.myList.join() === 'm12,s4' && fb.watched.e39 === 1, JSON.stringify(fb.myList));
  ok('Movies and Shows: the first playlist\'s own stay with it', fa.myList.join() === 'm1' && !fa.resume['pB:m13']);
  ok('a reminder key kept in another playlist\'s form, in memory\'s', S.keyFrom('pB', 'x7') === 'pB:x7' && S.keyFrom('pB', 'pA:x2') === 'x2');
  ok('one playlist\'s data alone', L.dataOf('pB').channels.every(c => c.p === 'pB') && L.dataOf('pB').channels.length === 5 && L.dataOf('pA').channels.length === 3);
}

// ---------- new groups of a playlist seen for the first time are not hidden ----------
{
  const ls = lsTwo(); const s = JSON.parse(ls['tivibro.settings']); s.newGroups = 'hide'; ls['tivibro.settings'] = JSON.stringify(s);
  ls['tivibro.edits.pA'] = JSON.stringify({ knownGroups: ['x1', 'x2'] }); ls['tivibro.edits.pB'] = JSON.stringify({});
  const ctx = sandbox(ls), S = ctx.Store, L = ctx.Library;
  L.set(dataA()); S.attach('pB'); L.setOther('pB', dataB());
  ok('newly added groups: a playlist with nothing known yet hides nothing', !S.edits.hiddenGroups['pB:x1'] && !S.edits.hiddenGroups['pB:x9']);
  const d2 = dataA(); d2.groups.push({ id: 'x3', name: 'New' }); L.set(d2);
  ok('newly added groups: still hidden for a playlist that knew its groups', S.edits.hiddenGroups.x3 === 1);
  // Clearing the first playlist's edits leaves the other's alone.
  S.edits.hiddenChannels['pB:x7'] = 1; S.edits.hiddenChannels.x2 = 1; S.flushEdits();
  S.resetEdits();
  ok('Clear all edits: the first playlist\'s go', !S.edits.hiddenChannels.x2);
  ok('Clear all edits: the other playlist keeps its own', S.edits.hiddenChannels['pB:x7'] === 1);
}

console.log(fail ? fail + ' multi-playlist check(s) FAILED' : 'all multi-playlist checks passed');
process.exit(fail ? 1 : 0);
