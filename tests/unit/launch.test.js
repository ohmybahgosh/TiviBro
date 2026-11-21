/* The launch API (app/js/launch.js, docs/launch-api.md): launch params, deep links and the reminder alert all
   become one { action, ... }, and a channel is found by key, number, guide id or name. */
'use strict';
let fail = 0;
function ok(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) fail++; }
const toasts = [], played = [], tabs = [], searched = [], sections = [];
const chans = [
  { k: 'a', n: 'US| FOX 2 Detroit HD', num: 2, epg: 'WJBK.us' },
  { k: 'b', n: 'US| ESPN', num: 206, epg: 'ESPN.us' },
  { k: 'c', n: 'US| ESPN 2', num: 209, epg: 'ESPN2.us' },
  { k: 'd', n: 'US| Hidden One', num: 5, epg: 'H.us' },
  { k: 'e', n: 'UK| BBC One', num: 101, epg: 'BBC1.uk' }
];
global.window = {};
global.Store = { edits: { hiddenChannels: { d: 1 } }, settings: {} };
global.Library = { data: { channels: chans }, count: () => chans.length, find: k => chans.find(c => c.k === k), name: c => c.n.replace(/^[A-Z]{2}\| /, ''), isFav: k => k === 'c', isBlocked: () => false };
global.Parental = { blockedOk: () => true };
global.UI = { modalOpen: false, close() {}, menu(t, items) { global.lastMenu = { t, items }; } };
global.U = { toast: m => toasts.push(m), hhmm: () => '7:30' };
global.Log = { info() {}, warn() {} };
global.Views = { full: false, startChannel: c => played.push(c.k), goFull() {}, switchTab: t => tabs.push(t), runAction: a => played.push('action:' + a), openReminder: r => played.push('rem:' + r.k) };
global.Search = { query: q => searched.push(q) };
global.Settings = { section: s => sections.push(s) };
const now = Date.now();
global.Teams = { team: id => id === 'nhl:det' ? { id, name: 'Detroit Red Wings' } : null, follows: () => true,
  games: () => [{ c: chans[0], p: { s: now - 600000, e: now + 3600000, t: 'Red Wings at Leafs' }, team: { id: 'nhl:det' } },
                { c: chans[1], p: { s: now + 86400000 - 3600000, e: now + 86400000, t: 'Red Wings vs Bruins' }, team: { id: 'nhl:det' } }] };
const L = require('../../app/js/launch.js');

// Parsing: every way in comes out the same.
ok('a URI: path is the action, then its main field, query the rest', JSON.stringify(L.fromUri('tivibro://team/nhl:det?start=1795216200000')) === '{"action":"team","id":"nhl:det","start":"1795216200000"}', L.fromUri('tivibro://team/nhl:det?start=1795216200000'));
ok('encoded names and + for spaces', L.fromUri('tivibro://channel?name=Fox+2%20Detroit').name === 'Fox 2 Detroit');
ok('contentTarget (LG deep link)', L.parse({ contentTarget: 'tivibro://channel/206' }).q === '206');
ok('contentTarget as JSON text', L.parse({ contentTarget: '{"contentTarget":"tivibro://view/guide"}' }).name === 'guide');
ok('launch params as JSON text', L.parse('{"open":{"action":"Channel","number":2}}').action === 'channel');
ok('a bare URI string', L.parse('tivibro://search/lions').q === 'lions');
ok('the reminder alert', JSON.stringify(L.parse({ reminder: { pid: 'p', k: 'a', s: 5 } })) === '{"action":"reminder","pid":"p","k":"a","s":5}');
ok('phone pairing is not ours', L.parse({ companion: { editor: 1 } }) === null);
ok('not a tivibro link', L.parse({ contentTarget: 'https://example.com' }) === null);

// Before the channels: kept, then carried out.
L.handle({ open: { action: 'channel', number: 206 } });
ok('kept until ready', L.pending && L.pending.number === 206 && !played.length);
const realSet = global.setTimeout; global.setTimeout = f => f();
L.ready();
ok('carried out once ready', played[0] === 'b', played);

function go(p) { played.length = 0; toasts.length = 0; L.handle(p); return played.slice(); }
ok('by key', go({ open: { action: 'channel', key: 'e' } })[0] === 'e');
ok('by guide id, any case', go({ contentTarget: 'tivibro://channel?epg=wjbk.us' })[0] === 'a');
ok('by name, exact first', go({ contentTarget: 'tivibro://channel?name=ESPN' })[0] === 'b');
ok('by name, start of a name', go({ contentTarget: 'tivibro://channel?name=Fox 2' })[0] === 'a');
ok('q: a number', go({ contentTarget: 'tivibro://channel/101' })[0] === 'e');
ok('q: a name', go({ contentTarget: 'tivibro://channel/bbc one' })[0] === 'e');
ok('a hidden channel is not opened', !go({ open: { action: 'channel', number: 5 } }).length && /No channel/.test(toasts[0]), toasts);
ok('team: the game on now', go({ contentTarget: 'tivibro://team/nhl:det' })[0] === 'a');
global.lastMenu = null;
ok('team: the game at start (later: asked first)', !go({ contentTarget: 'tivibro://team/nhl:det?start=' + (now + 86400000 - 3600000) }).length && lastMenu && /Watch ESPN now/.test(lastMenu.items[0].label), lastMenu && lastMenu.items[0].label);
ok('team: unknown team', !go({ contentTarget: 'tivibro://team/xyz:abc' }).length && /No team/.test(toasts[0]));
tabs.length = 0; go({ contentTarget: 'tivibro://view/my-media' }); go({ contentTarget: 'tivibro://guide' });
ok('views', tabs.join() === 'media,guide', tabs);
go({ contentTarget: 'tivibro://search/detroit%20lions' });
ok('search with words', tabs[tabs.length - 1] === 'search' && searched[0] === 'detroit lions');
go({ contentTarget: 'tivibro://settings/keys' });
ok('settings on a section', sections[0] === 'keys');
ok('last channel', go({ contentTarget: 'tivibro://last' })[0] === 'action:last');
ok('the reminder goes to the reminder code', go({ reminder: { k: 'a', s: 1 } })[0] === 'rem:a');
ok('an unknown action says so', !go({ contentTarget: 'tivibro://dance' }).length && /can't open "dance"/.test(toasts[0]));
global.setTimeout = realSet;
console.log(fail ? fail + ' failures' : 'all launch tests passed');
process.exit(fail ? 1 : 0);
