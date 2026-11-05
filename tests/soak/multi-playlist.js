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
    const single = await solo.evaluate(() => ({ keys: Library.data.channels.slice(0, 40).map((c) => c.k), groups: Library.data.groups.map((g) => g.id),
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

    // Settings: the second playlist says it is on, and offers to make it the first.
    const sa = (sec, path, n, op, a) => ev(([sec, path, n, op, a]) => Promise.resolve(n == null ? Settings.phone.page(sec, path) : Settings.phone.change(sec, path, n, op, a || {})), [sec, path, n, op, a]);
    let pls = await sa('playlists', []);
    const row2 = pls.rows.find((x) => /^Second provider/.test(x.label));
    ok('the playlist list says the second one is on, with its channels', /on, \d+ channels/.test(row2.sub), row2.sub);
    let pg = await sa('playlists', [row2.i]);
    ok('its page offers Make this the first playlist and its own Reload', pg.rows.some((x) => x.label === 'Make this the first playlist') && pg.rows.some((x) => x.label === 'Reload channels now'), pg.rows.map((x) => x.label).join(' | '));
    // Turning it off takes its section out.
    const on = pg.rows.find((x) => x.label === 'Playlist on');
    await sa('playlists', [row2.i], on.i, 'toggle', { on: false });
    await tv.waitForTimeout(1500);
    const off = await ev(() => ({ multi: Library.multi, p2: Library.data.channels.some((c) => c.p), heads: Library.groups(true).filter((g) => g.head).length, keys: Library.data.channels.slice(0, 40).map((c) => c.k) }));
    ok('turned off: its section and channels are gone', !off.multi && !off.p2 && !off.heads, JSON.stringify(off).slice(0, 200));
    ok('turned off: the first playlist is just as it was alone', JSON.stringify(off.keys) === JSON.stringify(single.keys));
    const kept = await ev(() => JSON.parse(localStorage.getItem('tivibro.edits.p2') || '{}'));
    ok('turned off: its edits are kept', !!kept && typeof kept === 'object' && 'hiddenChannels' in kept);
    // And on again, from its kept copy.
    pg = await sa('playlists', [row2.i]);
    await sa('playlists', [row2.i], pg.rows.find((x) => x.label === 'Playlist on').i, 'toggle', { on: true });
    await tv.waitForFunction(() => Library.multi, null, { timeout: 30000 }).catch(() => {});
    ok('turned on again: back in the lists', await ev(() => Library.multi && Library.groups(true).filter((g) => g.head).length === 2));
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all multi-playlist checks passed');
  process.exit(fails ? 1 : 0);
})();
