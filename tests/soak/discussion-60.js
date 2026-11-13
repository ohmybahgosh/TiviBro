/* Requests from discussion #60: Recently added in Movies and Shows, an order for them, each title's category on its
   row where categories mix, the provider's trailer in a movie's options (on YouTube), Up and Down in fullscreen the
   other way round, and zapping from the channel playing after switching to a recent one, and DNS on the setup screen.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/discussion-60.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1000);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    // Zapping after switching to another channel (a recent one) goes on from that channel.
    const z = await ev(async () => {
      Views.switchTab('live');
      const list = Library.channels(Library.ALL), a = list[0], c = list[8];
      Views.group = Library.ALL;
      await new Promise((r) => Views.startChannel(a, false, () => { Views.goFull(); r(); }));
      await new Promise((r) => setTimeout(r, 1500));
      await new Promise((r) => Views.startChannel(c, false, r));       // what the recent channels row does
      await new Promise((r) => setTimeout(r, 1800));
      Views.runAction('chnext', 'player');
      await new Promise((r) => setTimeout(r, 1200));
      return { want: list[9].n, got: Views.playing && Views.playing.n, notFrom: list[1].n };
    });
    ok('CH+ after switching to a recent channel goes on from it', z.got === z.want, JSON.stringify(z));
    // Up and Down the other way round.
    const ud = await ev(() => { Views.runAction('exit', 'player'); Player.stop(); Views.switchTab('settings'); Settings.section('remote'); return document.getElementById('setBody').innerText; });
    ok('Settings > Remote and buttons has Up and Down in fullscreen', /Up and Down in fullscreen/.test(ud), ud.slice(0, 300));
    const k = await ev(() => { const b0 = [Keymap.get('player', 'up'), Keymap.get('player', 'down')]; Keymap.set('player', 'up', 'chnext'); Keymap.set('player', 'down', 'chprev'); const b1 = [Keymap.get('player', 'up'), Keymap.get('player', 'down')]; Keymap.reset('player'); return { b0, b1 }; });
    ok('the default is Up to the channel above, and it swaps', k.b0.join() === 'chprev,chnext' && k.b1.join() === 'chnext,chprev', JSON.stringify(k));
    const st = await ev(() => { Settings.section('vod'); return document.getElementById('setBody').innerText; });
    ok('Settings > Movies and shows has Order movies and shows', /Order movies and shows/.test(st), st.slice(0, 200));

    // Movies: Recently added, categories on mixed rows, the order setting, the trailer.
    await ev(() => Vod.prepare());
    await page.waitForFunction(() => Vod.allItems().some((x) => x.kind === 'movie'), null, { timeout: 30000 });
    const v = await ev(() => Vod._test.withKind('movie', () => {
      const T = Vod._test, cats = T.catList(), recent = T.itemsFor('_new'), first = cats.filter((c) => !c.head && c.id.charAt(0) !== '_')[0];
      const byProv = T.itemsFor(first.id).map((x) => x.name);
      Store.settings.vodSort = 'name'; const byName = T.itemsFor(first.id).map((x) => x.name);
      Store.settings.vodSort = 'rating'; const byRating = T.itemsFor(first.id).map((x) => +x.rating);
      Store.settings.vodSort = 'provider';
      return { cats: cats.map((c) => c.name), recent: recent.map((x) => x.added), byProv, byName, byRating, catOf: T.catName(recent[0]), firstCat: first.name };
    }));
    ok('Recently added is in the categories, newest first', v.cats.indexOf('Recently added') >= 0 && v.recent.length > 1 && v.recent.every((a, i) => !i || a <= v.recent[i - 1]), JSON.stringify(v.cats) + ' ' + JSON.stringify(v.recent.slice(0, 5)));
    ok('a title knows its category\'s name (for rows in All, Recently added, My list)', !!v.catOf, v.catOf);
    ok('Name (A–Z) orders a category', v.byName.join('|') === v.byName.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })).join('|') && v.byName.length > 1, v.byName.join('|'));
    ok('Rating orders highest first', v.byRating.every((r, i) => !i || r <= v.byRating[i - 1]), v.byRating.join(','));
    // DNS on the setup screen, before there is a playlist to reach Settings with.
    const d = await ev(async () => {
      const was = Store.settings.dns || 'tv';
      App.setup('new');
      const field = () => [...document.querySelectorAll('#viewSetup .field')].find((f) => /^(DNS|DNS server)/.test(f.querySelector('label').textContent));
      const f0 = field(); if (!f0) return { none: true };
      const t0 = f0.innerText;
      f0.click();                                       // OK: the next choice
      await new Promise((r) => setTimeout(r, 300));
      const after = Store.settings.dns, t1 = field().innerText;
      field().querySelector('.arr').click();             // ◀: back again
      await new Promise((r) => setTimeout(r, 300));
      const back = Store.settings.dns;
      UI.press('back');
      return { was, t0, after, t1, back };
    });
    ok('the setup screen has DNS, and ◀ ▶ change it', !d.none && d.was === 'tv' && d.after === 'cloudflare' && /Cloudflare/.test(d.t1) && d.back === 'tv', JSON.stringify(d));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all discussion #60 checks passed');
  process.exit(fails ? 1 : 0);
})();
