/* A Stalker portal playlist in the real app (discussion #60): added on the TV with its portal address and MAC,
   its channels load through the helper, a channel plays from the link the portal makes, its guide comes
   from the portal, and the MAC never shows in the log.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/stalker.js            (starts its own mock portal) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const Mock = require('../mock/stalker_mock.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const m = Mock.create({ mac: '00:1A:79:00:00:01' });
  await new Promise((f) => m.server.listen(0, '127.0.0.1', f));
  const portal = 'http://127.0.0.1:' + m.server.address().port + '/stalker_portal/c/';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    // The setup screen offers it: Type cycles to "Stalker portal (MAC address)", with the portal and MAC rows.
    await ev(() => App.setup('new')); await page.waitForTimeout(400);
    let rows = '';
    for (let i = 0; i < 5 && !/Portal address/.test(rows); i++) {
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);      // on Type: the next type
      rows = await ev(() => document.getElementById('viewSetup').innerText);
    }
    ok('the setup screen has a Stalker portal type with portal and MAC rows', /Stalker portal \(MAC address\)/.test(rows) && /Portal address/.test(rows) && /MAC address/.test(rows), rows.slice(0, 400));
    // Fill it in and Connect, as from the remote.
    await ev((a) => {
      const set = (label, v) => { const f = [].slice.call(document.querySelectorAll('#viewSetup .field')).find((d) => d.querySelector('label') && d.querySelector('label').textContent.indexOf(label) === 0); const i = f.querySelector('input'); i.value = v; i.dispatchEvent(new Event('input')); };
      set('Name', 'Mock portal'); set('Portal address', a.portal); set('MAC address', '00-1a-79-00-00-01');
      [].slice.call(document.querySelectorAll('#viewSetup .btn')).find((x) => /Connect/.test(x.textContent)).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, { portal });
    await page.waitForFunction(() => Store.settings.playlists.some((p) => p.type === 'stalker'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const pl = await ev(() => { const p = Store.settings.playlists.find((x) => x.type === 'stalker'); return p ? { mac: p.mac, n: (Library.partOf && Library.partOf(p.id) || Library.dataOf(p.id) || {}).channels } : null; });
    ok('Connect adds it, with the MAC written the usual way', pl && pl.mac === '00:1A:79:00:00:01', JSON.stringify(pl && { mac: pl.mac }));
    const chans = await ev(() => Library.data.channels.filter((c) => /^stalker:/.test(c.url || '')).map((c) => c.n));
    ok('its channels are in the lists', chans.length === 3 && chans.indexOf('Portal News') >= 0, JSON.stringify(chans));

    // Play one: the helper asks the portal for a link, the player follows it.
    const before = m.seen.links;
    await ev(() => Views.startChannel(Library.data.channels.find((c) => c.n === 'Portal News'), false));
    await page.waitForFunction(() => Player.playing, null, { timeout: 40000 }).catch(() => {});
    const st = await ev(() => ({ playing: Player.playing, engine: Player.engine }));
    ok('a portal channel plays, from a link the portal made when it started', st.playing && m.seen.links > before, JSON.stringify(st) + ' links ' + m.seen.links);

    // Issue #88: a portal whose links are HLS playlists, for channels whose command doesn't say so.  (The mock has
    // no real HLS, so this checks the player goes to the channel's HLS version at once, not that it plays.)
    m.setStream((process.env.MOCK || 'http://127.0.0.1:8077') + '/live/demo/demo/2.m3u8');
    await ev(() => Views.startChannel(Library.data.channels.find((c) => c.n === 'Portal Sports'), false));
    await page.waitForFunction(() => Player._test.kind === 'hls', null, { timeout: 15000 }).catch(() => {});
    const sh = await ev(() => ({ engine: Player._test.kind, said: Log.lines().slice(-20).some((l) => /sends this channel as HLS/.test(l)) }));
    ok('a portal that links HLS playlists: the channel goes straight to HLS (issue #88)', sh.engine === 'hls' && sh.said, JSON.stringify(sh));
    await ev(() => Player.stop());
    m.setStream((process.env.MOCK || 'http://127.0.0.1:8077') + '/live/demo/demo/1.ts');

    // The portal's own guide, per channel.
    await page.waitForFunction(() => { const c = Library.data.channels.find((x) => x.n === 'Portal News'); const n = c && Epg.nowNext(c); return n && n.now; }, null, { timeout: 20000 }).catch(() => {});
    const g = await ev(() => { const c = Library.data.channels.find((x) => x.n === 'Portal News'); const n = Epg.nowNext(c); return n && n.now ? n.now.t : ''; });
    ok('its guide comes from the portal', /Show 1 on 101/.test(g), g);

    // From the phone or the web editor (the same action): a Stalker portal, and a wrong MAC said plainly.
    const wr = await ev((a) => WebEdit.run('addPlaylist', { type: 'stalker', name: 'Portal two', portal: a.portal, mac: '001A79000001' }).then((r) => String(r.msg), (e) => 'ERR ' + e.message), { portal });
    ok('the web editor and phone add a Stalker portal too (a MAC without colons is read)', /Added "Portal two" with 3 channels/.test(wr), wr);
    const bad = await ev((a) => WebEdit.run('addPlaylist', { type: 'stalker', name: 'Wrong', portal: a.portal, mac: '00:1A:79:99:99:99' }).then((r) => String(r.msg), (e) => 'ERR ' + e.message), { portal });
    ok('a MAC the portal doesn\'t know: says to check it with the provider', /^ERR .*turned this MAC address down.*Check the MAC address/.test(bad), bad);
    // Issue #118: a big portal's movies take minutes the first time; the Movies screen and the corner chip say how far it has come.
    const m2 = Mock.create({ mac: '00:1A:79:00:00:01', titles: 420, pageMs: 700 });
    await new Promise((f) => m2.server.listen(0, '127.0.0.1', f));
    const portal2 = 'http://127.0.0.1:' + m2.server.address().port + '/stalker_portal/c/';
    const big = await ev((a) => WebEdit.run('addPlaylist', { type: 'stalker', name: 'Big portal', portal: a, mac: '00:1A:79:00:00:01' }).then((r) => String(r.msg), (e) => 'ERR ' + e.message), portal2);
    const bigId = await ev(() => (Store.settings.playlists.find((x) => x.name === 'Big portal') || {}).id);
    await ev((id) => App.switchPlaylist(id), bigId);
    await page.waitForFunction(() => Library.data.channels.some((c) => c.n === 'Portal News') && Views.tabs && true, null, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => (Store.playlist.vod || {}).movies, null, { timeout: 15000 }).catch(() => {});
    const tabsAt = await ev(() => !!(Store.playlist.vod || {}).movies);
    ok('a big portal: the Movies tab is there before its titles are counted', /Added "Big portal"/.test(big) && tabsAt, big + ' ' + tabsAt);
    await ev(() => Views.switchTab('movies'));
    await page.waitForFunction(() => /Loading movies from the portal: \d+ of 420/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const shown = await ev(() => ({ screen: (document.body.innerText.match(/Loading movies from the portal: \d+ of 420[^\n]*/) || [''])[0], chip: Activity.list().join(' | ') }));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    ok('...and while they load, it says how far it has come', /Loading movies from the portal: \d+ of 420/.test(shown.screen) && /Loading movies from the portal: \d+ of 420/.test(shown.chip), JSON.stringify(shown));
    await page.waitForFunction(() => !/Loading movies from the portal/.test(Activity.list().join(' ')), null, { timeout: 60000 }).catch(() => {});
    const after = await ev(() => ({ chip: Activity.list().join(' | '), n: (document.querySelectorAll('#vodItems .row, #vodHome .vh-card').length) }));
    ok('...and the chip goes when they are in', !/Loading movies from the portal/.test(after.chip), JSON.stringify(after));
    // ...and a portal too big to read whole: browsed by category (issue #118; 420 titles count as big here).
    await ev(() => { Store.settings.portalBrowseOver = 100; Store.settings.playlists.forEach((x) => { if (x.name !== 'Big portal') Store.detach(x.id); }); Vod.reset && Vod.reset(); });
    const srcs = await ev(() => (Store.loaded ? Store.loaded() : []).map((x) => x.name + ':' + x.type + ':' + JSON.stringify(x.vod || {})));
    console.log('  sources ' + srcs.join(' | '));
    await ev(() => Views.switchTab('settings')); await page.waitForTimeout(300);
    await ev(() => Views.switchTab('movies')); await page.waitForTimeout(2500);
    await page.waitForFunction(() => /Newest movies/.test(document.getElementById('viewVod').innerText) || /Newest movies/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    const cats = await ev(() => document.body.innerText);
    ok('a big portal: browsed by category (Newest movies, then its categories)', /Newest movies/.test(cats) && /Films/.test(cats), cats.slice(0, 400));
    const first = await ev(() => Vod._test.withKind ? Vod._test.withKind('movie', () => Vod._test.itemsFor('11').length) : -1);
    await page.waitForFunction(() => Vod._test.withKind('movie', () => Vod._test.itemsFor('11').length) > 100, null, { timeout: 40000 }).catch(() => {});
    const later = await ev(() => Vod._test.withKind('movie', () => Vod._test.itemsFor('11').length));
    ok('...a category\'s titles come when it is opened', first === 0 && later > 100, first + ' then ' + later);

    // Issue #173: a copy past its age (two days old here) is still used, its categories read again behind it, and
    // Movies opens again on the category you were on.
    const pid = await ev(() => Store.settings.playlists.filter((x) => x.name === 'Big portal')[0].id);
    await page.waitForTimeout(3500);                                    // the copy is saved 3 s after a change
    await ev(async (id) => { const key = 'vodbrowse:' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + ':movie'; const c = await Store.bigGet(key); c.at -= 2 * 24 * 3600e3; await Store.bigSet(key, c); localStorage.setItem('tivibro.vodCat.movie', '11'); Vod.reset(); }, pid);
    await ev(() => Views.switchTab('settings')); await page.waitForTimeout(300);
    await ev(() => Views.switchTab('movies'));
    await page.waitForFunction(() => Vod._test.withKind('movie', () => Vod._test.itemsFor('11').length) > 100, null, { timeout: 20000 }).catch(() => {});
    const kept = await ev(() => Log.lines().map((l) => l.msg || l).filter((l) => /A big portal/.test(l)).slice(-2).join(' | '));
    ok('a two-day-old copy is still used, with the category read before (issue #173)', /as kept on the TV \(2\d\d\d min old\)/.test(kept) && (await ev(() => Vod._test.withKind('movie', () => Vod._test.itemsFor('11').length))) > 100, kept);
    // Issue #173: a big portal's show categories in Movies go to the end (and the other way round); by language.
    const guess = await ev(() => [Vod._test.nameSays('series', 'HINDI | WEB SERIES'), Vod._test.nameSays('series', 'HINDI | MOVIES'), Vod._test.nameSays('movie', 'TAMIL MOVIES'), Vod._test.nameSays('movie', 'DIZI'), Vod._test.nameSays('series', 'TV SHOWS')]);
    ok('a category\'s name says shows or movies', guess.join() === 'true,false,true,false,true', guess);
    const langs = await ev(() => Vod._test.byLang([{ id: 1, name: 'HINDI | MOVIES' }, { id: 2, name: 'TAMIL | MOVIES' }, { id: 3, name: 'HINDI | 2025' }, { id: 4, name: 'TAMIL | NEW' }, { id: 5, name: 'KIDS' }]).map((c) => c.head ? '#' + c.name : c.id).join(' '));
    ok('a big portal\'s categories by language, with headings', langs === '#Hindi 1 3 #Tamil 2 4 #Other categories 5', langs);
    ok('Movies opens on the category you were on', (await ev(() => Vod._test.curCat())) === '11', await ev(() => Vod._test.curCat()));
    m2.server.close();

    const logs = await ev(() => Log.lines().map((l) => l.msg || l).join('\n'));
    ok('the MAC is never in the log', logs.indexOf('00:1A:79:00:00:01') < 0 && !/stb=[A-Za-z0-9_-]{8}/.test(logs), (logs.match(/.{0,60}00:1A:79.{0,30}/) || [''])[0]);
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); m.server.close();
  console.log(fails ? fails + ' FAILED' : 'all Stalker portal checks passed');
  process.exit(fails ? 1 : 0);
})();
