/* Several playlists at once, like TiviMate: every playlist that is on is in the lists, each with its own
   section (a heading with its name) in the group column, the remote stepping over the headings, a
   channel playing from its own playlist's server, its edits kept in its own playlist's edits, its guide,
   and Playlist on taking it out again.  A single playlist is unchanged (same keys, no headings).
     node tests/mock/mock_provider.js &
     MOCK_PORT=8091 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/multi-playlist.js
   Delete service/data/kv/playlist~*.json first (kept channel lists). */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const PORT2 = +process.env.MOCK_PORT2 || 8091;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const one = R.SETTINGS.playlists[0];
  const two = Object.assign({}, one, { id: 'p2', name: 'Second provider', server: 'http://127.0.0.1:' + PORT2, user: 'second', pass: 'second' });
  async function open(settings) {
    const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    tv.on('pageerror', (e) => errs.push(e.message));
    await tv.addInitScript(R.init({ time: R.primeTime(), settings })[0]);
    await tv.goto(APP);
    await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    await tv.waitForTimeout(1500);
    return tv;
  }
  try {
    // ---------- one playlist: as before ----------
    const solo = await open({ playlists: [one], active: one.id });
    const single = await solo.evaluate(() => ({ keys: Library.data.channels.slice(0, 40).map((c) => c.k), nums: Library.data.channels.slice(0, 40).map((c) => c.num), groups: Library.data.groups.map((g) => g.id),
      heads: document.querySelectorAll('#groupList .row.ghead').length, multi: Library.multi, p: Library.data.channels.some((c) => c.p) }));
    ok('one playlist: no headings, no playlist marks on channels', !single.heads && !single.multi && !single.p, JSON.stringify(single).slice(0, 200));
    await solo.context().close();

    // ---------- two playlists ----------
    const tv = await open({ playlists: [one, two], active: one.id });
    const ev = (f, a) => tv.evaluate(f, a);
    await tv.waitForFunction(() => Library.multi && Library.otherIds().indexOf('p2') >= 0, null, { timeout: 90000 });
    await tv.waitForTimeout(1500);
    const st = await ev(() => ({ first: Library.main.channels.slice(0, 40).map((c) => c.k), groups: Library.main.groups.map((g) => g.id),
      p2: Library.data.channels.filter((c) => c.p === 'p2').length, p2keys: Library.data.channels.filter((c) => c.p === 'p2').slice(0, 5).map((c) => c.k) }));
    ok('the first playlist keeps exactly the same keys and group ids', JSON.stringify(st.first) === JSON.stringify(single.keys) && JSON.stringify(st.groups) === JSON.stringify(single.groups));
    ok('the second playlist\'s channels are there, with its id in front of their keys', st.p2 > 10 && st.p2keys.every((k) => /^p2:/.test(k)), JSON.stringify(st.p2keys));

    // The group column: a heading per playlist, the special groups on top.
    const col = await ev(() => Array.prototype.map.call(document.querySelectorAll('#groupList .row'), (r) => ({ head: r.classList.contains('ghead'), t: r.textContent })).filter((x) => x.t));
    const items = await ev(() => Library.groups(true).map((g) => ({ id: g.id, head: !!g.head, name: g.name, p: g.p || '' })));
    const heads = items.filter((g) => g.head);
    ok('a heading per playlist, with its name', heads.length === 2 && heads[0].name === one.name && heads[1].name === 'Second provider', JSON.stringify(heads));
    const firstHead = items.findIndex((g) => g.head);
    ok('special groups stay at the top', firstHead > 0 && items.slice(0, firstHead).every((g) => !g.p && !g.head), JSON.stringify(items.slice(0, firstHead + 1)));
    const h2 = items.findIndex((g) => g.head && g.name === 'Second provider');
    ok('the second playlist\'s groups under its heading', items.slice(h2 + 1).every((g) => g.p === 'p2') && items.slice(firstHead + 1, h2).every((g) => !g.p));
    ok('headings drawn in the group column', col.some((x) => x.head), JSON.stringify(col.slice(0, 12)));

    // The remote steps over a heading, both ways.
    await ev(() => { Views.switchTab('live'); Views.setZone('groups'); });
    await tv.waitForTimeout(400);
    const before = h2 - 1;
    // Put the selection on the last group of the first playlist through the remote's own path.
    let sel = await ev(() => Views.__gsel());
    let guard = 0;
    while (sel !== before && guard++ < 200) { await tv.keyboard.press(sel < before ? 'ArrowDown' : 'ArrowUp'); await tv.waitForTimeout(40); sel = await ev(() => Views.__gsel()); }
    ok('reached the last group of the first playlist', sel === before, sel + ' vs ' + before);
    await tv.keyboard.press('ArrowDown'); await tv.waitForTimeout(300);
    sel = await ev(() => Views.__gsel());
    ok('Down steps over the heading to the second playlist\'s first group', sel === h2 + 1, sel + ' vs ' + (h2 + 1));
    await tv.keyboard.press('ArrowUp'); await tv.waitForTimeout(300);
    sel = await ev(() => Views.__gsel());
    ok('Up steps back over it', sel === before, sel);

    // Playing a channel of the second playlist asks the second playlist's server.
    // Whatever was playing (the first playlist's channel, from the start) is stopped first, so its last
    // requests on a slower computer aren't counted (PR #80's notes: one :8077 request on a Mac).
    await ev(() => { if (Views.stopAll) Views.stopAll(); else Player.stop(); }); await tv.waitForTimeout(800);
    const asked = [];
    tv.on('request', (r) => { if (/\/live\//.test(r.url())) asked.push(r.url()); });
    const k2 = await ev(() => { const c = Library.data.channels.find((x) => x.p === 'p2' && !x.url); Views.startChannel(c, false); return c.k; });
    await tv.waitForTimeout(4000);
    ok('playing a channel of the second playlist uses its server and login', asked.some((u) => u.indexOf(':' + PORT2 + '/live/second/second/') >= 0) && !asked.some((u) => /:8077\/live\//.test(u)), asked.slice(0, 3).join(' | '));
    asked.length = 0;
    const k1 = await ev(() => { const c = Library.data.channels.find((x) => !x.p && !x.url); Views.startChannel(c, false); return c.k; });
    await tv.waitForTimeout(3000);
    ok('a channel of the first playlist still uses the first server', asked.some((u) => /:8077\/live\/demo\/demo\//.test(u)), asked.slice(0, 3).join(' | '));
    await ev(() => Views.stopAll());

    // Hiding a channel of the second playlist goes in the second playlist's edits.
    await ev((k) => Library.hideChannel(k, true), k2);
    await tv.waitForTimeout(900);
    const files = await ev((k) => ({ p1: JSON.parse(localStorage.getItem('tivibro.edits.p1') || '{}'), p2: JSON.parse(localStorage.getItem('tivibro.edits.p2') || '{}'), bare: k.slice(3) }), k2);
    ok('hiding its channel stores it in its own edits, without the prefix', files.p2.hiddenChannels && files.p2.hiddenChannels[files.bare] === 1, JSON.stringify(files.p2.hiddenChannels));
    ok('and not in the first playlist\'s', !(files.p1.hiddenChannels || {})[k2] && !(files.p1.hiddenChannels || {})[files.bare]);
    await ev((k) => Library.hideChannel(k, false), k2);

    // The guide has programmes for the second playlist's channels.
    await tv.waitForFunction((k) => { const c = Library.find(k); const nn = c && Epg.nowNext(c); return !!(nn && (nn.now || nn.next)); }, k2, { timeout: 90000 }).catch(() => {});
    const guide = await ev((k) => { const nn = Epg.nowNext(Library.find(k)); return nn && (nn.now || nn.next) ? (nn.now || nn.next).t : ''; }, k2);
    ok('the guide shows programmes for the second playlist\'s channels', !!guide, guide);
    const g1 = await ev((k) => { const nn = Epg.nowNext(Library.find(k)); return nn && (nn.now || nn.next) ? 1 : 0; }, k1);
    ok('and still for the first playlist\'s', g1 === 1);
    // The guide's own group column has the headings too.
    await ev(() => { Views.switchTab('guide'); });
    await tv.waitForTimeout(800);
    await tv.keyboard.press('ArrowLeft'); await tv.waitForTimeout(600);
    const gcol = await ev(() => document.querySelectorAll('#guideGroupList .row.ghead').length);
    ok('the guide\'s group column has the playlist headings', gcol >= 1, gcol);
    await ev(() => Views.switchTab('live'));

    // Channel numbers: the first playlist keeps its own, the second's come after, none twice.
    const nums = await ev(() => ({ first: Library.main.channels.slice(0, 40).map((c) => c.num), all: Library.data.channels.map((c) => c.num), p2: Library.data.channels.filter((c) => c.p).map((c) => c.num) }));
    ok('numbers: the first playlist\'s are unchanged', JSON.stringify(nums.first) === JSON.stringify(single.nums), nums.first.slice(0, 5) + ' vs ' + single.nums.slice(0, 5));
    ok('numbers: the second playlist\'s start after the first\'s, every number once', nums.p2.every((n) => n > 1000) && new Set(nums.all).size === nums.all.length, nums.p2.slice(0, 5).join());
    // Number keys reach the second playlist's channel.
    const n2 = await ev((k) => Library.find(k).num, k2);
    await ev(() => { Views.switchTab('live'); Views.setZone('channels'); });
    for (const d of String(n2)) { await tv.keyboard.press('Digit' + d); await tv.waitForTimeout(120); }
    await tv.waitForTimeout(3500);
    ok('number keys play the second playlist\'s channel by its number', await ev((k) => !!Views.playing && Views.playing.k === k, k2), n2);
    await ev(() => Views.stopAll());

    // The same guide ids in both playlists' guides: each channel gets its own playlist's programmes.
    const ids = await ev(([a, b]) => ({ a: Epg.epgId(Library.find(a)), b: Epg.epgId(Library.find(b)), bn: Library.find(b).epg }), [k1, k2]);
    const twin = await ev(() => { const c = Library.data.channels.find((x) => x.p && x.epg && Library.data.channels.some((y) => !y.p && y.epg === x.epg)); return c ? { k: c.k, id: Epg.epgId(c), epg: c.epg, has: !!(Epg.nowNext(c) || {}).now } : null; });
    ok('a guide id both guides have: the second playlist\'s channel reads its own copy', twin && twin.id === 'p2|' + twin.epg && twin.has, JSON.stringify(twin));
    ok('and the first playlist\'s channel the id itself', ids.a && ids.a.indexOf('|') < 0, ids.a);

    // A reminder for the second playlist's channel opens that channel (as the TV's alert does).
    const s0 = Date.now() - 60000;
    await ev(([k, s]) => { document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { reminder: { pid: 'p1', k: k, s: s } } })); }, [k2, s0]);
    await tv.waitForTimeout(3000);
    ok('a reminder for the second playlist\'s channel opens it', await ev((k) => !!Views.playing && Views.playing.k === k, k2));
    await ev(() => Views.stopAll());
    // One kept while the second playlist was first (its own key, its id): the same channel, no switching.
    await ev(([k, s]) => { document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { reminder: { pid: 'p2', k: k.slice(3), s: s } } })); }, [k2, s0]);
    await tv.waitForTimeout(3000);
    ok('a reminder kept under the second playlist opens its channel without switching', await ev((k) => !!Views.playing && Views.playing.k === k && Store.settings.active === 'p1', k2));
    await ev(() => Views.stopAll());

    // Movies and Shows: each playlist's movies, with a heading per playlist, played from its own server.
    await tv.waitForFunction(() => Vod.offered().indexOf('movie') >= 0 && Store.byId('p2').vod && Store.byId('p2').vod.movies, null, { timeout: 60000 }).catch(() => {});
    await ev(() => Views.switchTab('movies'));
    await tv.waitForFunction(() => document.querySelectorAll('#vodCats .row').length > 3, null, { timeout: 60000 }).catch(() => {});
    await tv.waitForTimeout(800);
    const vheads = await ev(() => Array.prototype.map.call(document.querySelectorAll('#vodCats .row.ghead'), (r) => r.textContent));
    ok('Movies: a heading per playlist', vheads.some((t) => /Second provider/.test(t)), JSON.stringify(vheads) + ' ' + JSON.stringify(await ev(() => ({ v1: Store.playlist.vod, v2: Store.byId('p2').vod, off: Vod.offered(), rows: Array.prototype.map.call(document.querySelectorAll('#vodCats .row'), (r) => r.textContent).slice(0, 12) }))));
    asked.length = 0;
    tv.on('request', (r) => { if (/\/movie\//.test(r.url())) asked.push(r.url()); });
    await ev(() => { const it = Vod.allItems().filter((x) => x.kind === 'movie' && x.it.pl === 'p2')[0]; Vod.openItem(it); });
    await tv.waitForTimeout(4000);
    ok('Movies: a movie of the second playlist plays from its server', asked.some((u) => u.indexOf(':' + PORT2 + '/movie/second/second/') >= 0), asked.slice(0, 3).join(' | '));
    await ev(() => { Vod.stopped(); Views.stopAll(); Views.switchTab('live'); });

    // Its own set-up tour, for its own channels.
    const tour = await ev(() => { const rows = Tour.phoneRows('p2'); const n = Tour.isOpen; return { rows: rows.length, n: n }; });
    ok('the set-up tour opens for the second playlist', tour.rows > 0);
    await ev(() => { try { Tour.keys('back'); } catch (e) {} });

    // The web editor: name rules per playlist.
    await ev(() => WebEdit.stop()); const wst = await ev(() => WebEdit.start()); const wpw = await ev(() => WebEdit.password());
    const ed = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); ed.on('pageerror', (e) => errs.push('editor: ' + e.message));
    await ed.goto('http://127.0.0.1:' + wst.port + '/#k=' + wpw + '/names'); await ed.waitForSelector('#nPl option', { timeout: 20000 }).catch(() => {}); await ed.waitForTimeout(800);
    const opts = await ed.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#nPl option'), (o) => o.textContent));
    ok('web editor: name rules for each playlist', opts.length === 2 && opts[1] === 'Second provider', JSON.stringify(opts));
    await ed.selectOption('#nPl', 'p2'); await ed.waitForTimeout(300);
    await ed.fill('#nPre', 'ZZQ '); await ed.waitForTimeout(400);
    await ed.evaluate(() => send()); await ed.waitForTimeout(3000);
    const pre = await ev(() => ({ two: (Store.byId('p2').names || {}).prefixes, one: (Store.playlist.names || {}).prefixes }));
    ok('web editor: the second playlist\'s rules go to it, not the first\'s', JSON.stringify(pre.two) === '["ZZQ "]' && JSON.stringify(pre.one || []) !== '["ZZQ "]', JSON.stringify(pre));
    // Smart clean-up: one playlist or all of them.
    await ed.goto('http://127.0.0.1:' + wst.port + '/#k=' + wpw + '/tools'); await ed.waitForSelector('#tPl option', { timeout: 20000 }).catch(() => {}); await ed.waitForTimeout(800);
    const topts = await ed.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#tPl option'), (o) => o.value));
    ok('Smart clean-up: every playlist, or one', JSON.stringify(topts) === '["*","","p2"]', JSON.stringify(topts));
    await ed.selectOption('#tPl', 'p2'); await ed.waitForTimeout(500);
    const scoped = await ed.evaluate(() => ({ all: SD().channels.length, mine: SD().channels.every((c) => c.p === 'p2'), groups: scopedGroups().every((g) => g.p === 'p2') }));
    ok('Smart clean-up: picking the second playlist looks at its channels and groups only', scoped.mine && scoped.groups && scoped.all > 10, JSON.stringify(scoped));
    await ed.context().close(); await ev(() => WebEdit.stop());

    // Settings > Guide: the second playlist's guide on a page of its own, with its own channels.
    const sg = (path) => ev((pth) => Promise.resolve(Settings.phone.page('guide', pth)), path);
    const gp = await sg([]);
    const g2 = gp.rows.find((x) => /^Guide for Second provider/.test(x.label));
    ok('Settings > Guide: a page for the second playlist\'s guide', !!g2, gp.rows.map((x) => x.label).join(' | '));
    if (g2) {
      const g2p = await sg([g2.i]), n2c = await ev(() => Library.dataOf('p2').channels.length);
      const cnt = g2p.rows.find((x) => x.label === 'Channels with guide data');
      ok('its page: its own provider guide, reload, and its own channel count', g2p.rows.some((x) => x.label === 'Provider guide') && g2p.rows.some((x) => x.label === 'Reload guide now') && cnt && new RegExp(' of ' + n2c + '$').test(cnt.value || cnt.sub || ''), JSON.stringify(cnt) + ' ' + n2c);
    }

    // Restore points cover the playlists in use when they were made, and say which.
    const k1b = await ev(() => Library.data.channels.filter((c) => !c.p)[3].k), k2b = await ev(() => Library.data.channels.filter((c) => c.p === 'p2')[3].k);
    const hid = () => ev(([a, c]) => [!!Store.edits.hiddenChannels[a], !!Store.edits.hiddenChannels[c]].join(), [k1b, k2b]);
    const setOff = (off) => ev((o) => { const q = Store.byId('p2'); q.off = o; Store.upsertPlaylist(q); return App.playlistsChanged(); }, off);
    await ev(([a, c]) => { Library.hideChannel(a, true); Library.hideChannel(c, true); }, [k1b, k2b]);
    const s1 = await ev(() => WebEdit.runData('makeSnap', { name: 'Both' }).then((r) => r.data.id));
    const list = await ev(() => WebEdit.runData('listSnaps', {}).then((r) => r.data));
    ok('a restore point says which playlists it covers', JSON.stringify((list.find((x) => x.id === s1) || {}).pls) === JSON.stringify([one.name, 'Second provider']), JSON.stringify(list[0]));
    await ev(([a, c]) => { Library.hideChannel(a, false); Library.hideChannel(c, false); }, [k1b, k2b]);
    await ev((id) => WebEdit.runData('restoreSnap', { id: id }), s1); await tv.waitForTimeout(600);
    ok('restoring it puts back both playlists\' edits', await hid() === 'true,true', await hid());
    // Made while the second playlist was off: restoring it leaves the second playlist's edits alone.
    await setOff(true); await tv.waitForTimeout(800);
    await ev((a) => Library.hideChannel(a, false), k1b);
    const s2 = await ev(() => WebEdit.runData('makeSnap', { name: 'First only' }).then((r) => r.data.id));
    await setOff(false); await tv.waitForFunction(() => Library.multi, null, { timeout: 30000 }).catch(() => {}); await tv.waitForTimeout(800);
    ok('turned on again, the second playlist has its own edits', await hid() === 'false,true', await hid());
    await ev(([a, c]) => { Library.hideChannel(a, true); Library.hideChannel(c, false); }, [k1b, k2b]);
    await ev((id) => WebEdit.runData('restoreSnap', { id: id }), s2); await tv.waitForTimeout(600);
    ok('a point made without the second playlist restores only the first\'s', await hid() === 'false,false', await hid());
    await ev(([a, c]) => { Library.hideChannel(a, false); Library.hideChannel(c, false); }, [k1b, k2b]);

    // Settings: the second playlist says it is on, and offers to make it the first.
    const sa = (sec, path, n, op, a) => ev(([sec, path, n, op, a]) => Promise.resolve(n == null ? Settings.phone.page(sec, path) : Settings.phone.change(sec, path, n, op, a || {})), [sec, path, n, op, a]);
    let pls = await sa('playlists', []);
    const row2 = pls.rows.find((x) => /^Second provider/.test(x.label));
    ok('the playlist list says the second one is on, with its channels', /on, \d+ channels/.test(row2.sub), row2.sub);
    let pg = await sa('playlists', [row2.i]);
    ok('its page offers Make this the first playlist and its own Reload', pg.rows.some((x) => x.label === 'Make this the first playlist') && pg.rows.some((x) => x.label === 'Reload channels now'), pg.rows.map((x) => x.label).join(' | '));
    // Turning it off takes its section out.
    const on = pg.rows.find((x) => x.label === 'Playlist on');
    await ev((k) => Views.startChannel(Library.find(k), false), k2); await tv.waitForTimeout(1500);
    await sa('playlists', [row2.i], on.i, 'toggle', { on: false });
    await tv.waitForTimeout(1500);
    const off = await ev(() => ({ multi: Library.multi, p2: Library.data.channels.some((c) => c.p), heads: Library.groups(true).filter((g) => g.head).length, keys: Library.data.channels.slice(0, 40).map((c) => c.k) }));
    ok('turned off: its section and channels are gone', !off.multi && !off.p2 && !off.heads, JSON.stringify(off).slice(0, 200));
    ok('turned off while its channel played: playback stopped', await ev(() => !Views.playing));
    ok('turned off: the first playlist is just as it was alone', JSON.stringify(off.keys) === JSON.stringify(single.keys));
    const kept = await ev(() => JSON.parse(localStorage.getItem('tivibro.edits.p2') || '{}'));
    ok('turned off: its edits are kept', !!kept && typeof kept === 'object' && 'hiddenChannels' in kept);
    // And on again, from its kept copy.
    pg = await sa('playlists', [row2.i]);
    await sa('playlists', [row2.i], pg.rows.find((x) => x.label === 'Playlist on').i, 'toggle', { on: true });
    await tv.waitForFunction(() => Library.multi, null, { timeout: 30000 }).catch(() => {});
    ok('turned on again: back in the lists', await ev(() => Library.multi && Library.groups(true).filter((g) => g.head).length === 2));
    // The first playlist can't load at start-up: another one that is on can be made first.
    const bad = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    bad.on('pageerror', (e) => errs.push('bad: ' + e.message));
    await bad.addInitScript(R.init({ time: R.primeTime(), settings: { playlists: [Object.assign({}, one, { id: 'p9', name: 'Broken', server: 'http://127.0.0.1:9' }), two], active: 'p9' } })[0]);
    await bad.goto(APP);
    await bad.waitForFunction(() => /Make Second provider the first playlist/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
    ok('the first playlist fails at start-up: offers to make another one first', /Make Second provider the first playlist/.test(await bad.evaluate(() => document.body.innerText)));
    await bad.evaluate(() => App.switchPlaylist('p2'));
    await bad.waitForFunction(() => window.Library && Library.count() > 0 && Store.settings.active === 'p2', null, { timeout: 60000 }).catch(() => {});
    ok('and opens it', await bad.evaluate(() => Store.settings.active === 'p2' && Library.count() > 0));
    await bad.context().close();
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all multi-playlist checks passed');
  process.exit(fails ? 1 : 0);
})();
