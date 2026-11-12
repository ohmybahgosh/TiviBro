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

    // The portal's own guide, per channel.
    await page.waitForFunction(() => { const c = Library.data.channels.find((x) => x.n === 'Portal News'); const n = c && Epg.nowNext(c); return n && n.now; }, null, { timeout: 20000 }).catch(() => {});
    const g = await ev(() => { const c = Library.data.channels.find((x) => x.n === 'Portal News'); const n = Epg.nowNext(c); return n && n.now ? n.now.t : ''; });
    ok('its guide comes from the portal', /Show 1 on 101/.test(g), g);

    // From the phone or the web editor (the same action): a Stalker portal, and a wrong MAC said plainly.
    const wr = await ev((a) => WebEdit.run('addPlaylist', { type: 'stalker', name: 'Portal two', portal: a.portal, mac: '001A79000001' }).then((r) => r.msg, (e) => 'ERR ' + e.message), { portal });
    ok('the web editor and phone add a Stalker portal too (a MAC without colons is read)', /Added "Portal two" with 3 channels/.test(wr), wr);
    const bad = await ev((a) => WebEdit.run('addPlaylist', { type: 'stalker', name: 'Wrong', portal: a.portal, mac: '00:1A:79:99:99:99' }).then((r) => r.msg, (e) => 'ERR ' + e.message), { portal });
    ok('a MAC the portal doesn\'t know: says to check it with the provider', /^ERR .*turned this MAC address down.*Check the MAC address/.test(bad), bad);
    const logs = await ev(() => Log.lines().map((l) => l.msg || l).join('\n'));
    ok('the MAC is never in the log', logs.indexOf('00:1A:79:00:00:01') < 0 && !/stb=[A-Za-z0-9_-]{8}/.test(logs), (logs.match(/.{0,60}00:1A:79.{0,30}/) || [''])[0]);
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); m.server.close();
  console.log(fails ? fails + ' FAILED' : 'all Stalker portal checks passed');
  process.exit(fails ? 1 : 0);
})();
