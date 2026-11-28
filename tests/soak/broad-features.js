/* Features for everyone (Nov 28): cricket in Sports, the channels before and after while zapping, readable button
   hints, and each movie or show category switched on or off in Settings (so on the phone and in the web editor).
     MOCK_PORT=8077 node tests/mock/mock_provider.js &
     (cd app && python3 -m http.server 8078 --bind 127.0.0.1) &
     node tests/soak/broad-features.js          SHOTS=<folder> keeps the screenshots; needs the internet (ESPN) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const SHOTS = process.env.SHOTS || '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = (n) => SHOTS ? page.screenshot({ path: SHOTS + '/' + n + '.png' }) : null;

  // Cricket: internationals and the big leagues from ESPN's header, scores as cricket writes them.
  const ck = await ev(async () => { await Sports.refreshToday(['cricket'], true); const l = Sports.day('cricket', 0) || []; return { n: l.length, err: Sports.errOf('cricket'), one: l[0] && { teams: l[0].teams.map((t) => [t.name, t.score, typeof t.score]), detail: l[0].detail, note: l[0].note, state: l[0].state } }; });
  ok('cricket: today\'s matches from ESPN (' + ck.n + ')', !ck.err && ck.n >= 0, ck);
  if (ck.n) ok('a cricket score stays as written', ck.one.teams.every((t) => t[1] == null || t[2] === 'string'), ck.one);
  ok('cricket is a league to pick', await ev(() => !!Sports.league('cricket') && Sports.LEAGUES.some((l) => l.id === 'cricket')));
  if (ck.n) {
    await ev(() => { Sports.setLeagues(['cricket']); Views.switchTab('sports'); }); await page.waitForTimeout(2500);
    await shot('cricket');
    ok('the Sports screen draws the cricket cards', await ev(() => document.querySelectorAll('#viewSports .sp-card, #viewSports .sp-game').length) > 0 || /Cricket/.test(await ev(() => document.body.innerText)));
  }

  // Button hints: none cut off on the main screens, at Medium and Large text.
  const cut = [];
  for (const size of ['m', 'l']) {
    await ev((sz) => { Store.settings.textSize = sz; Views.applyLook(); }, size);
    for (const t of ['guide', 'live', 'movies', 'series', 'settings', 'search']) {
      await ev((x) => { try { Views.switchTab(x); } catch (e) {} }, t); await page.waitForTimeout(400);
      const r = await ev(() => [...document.querySelectorAll('.hints')].filter((h) => h.offsetParent && h.scrollWidth > h.clientWidth + 2).map((h) => h.innerText.replace(/\s+/g, ' ').slice(0, 80)));
      r.forEach((x) => cut.push(size + ' ' + t + ': ' + x));
    }
  }
  await ev(() => { Store.settings.textSize = 'm'; Views.applyLook(); Views.switchTab('guide'); });
  await shot('hints');
  ok('the button hints fit on every main screen, Medium and Large text', !cut.length, cut);

  // Zapping: the channel before and after, on the right, then gone.
  await ev(async () => { Views.switchTab('live'); Views.group = Library.ALL; const c = Library.channels(Library.ALL)[3]; await new Promise((r) => Views.startChannel(c, false, () => { Views.goFull(); r(); })); }); await page.waitForTimeout(1500);
  await ev(() => Views.runAction('chnext', 'player')); await page.waitForTimeout(300);
  const zs = await ev(() => { const z = document.getElementById('zapSides'); return z && { shown: !z.classList.contains('hidden') && getComputedStyle(z).display !== 'none', rows: [...z.querySelectorAll('.zs-row')].map((r) => r.innerText.replace(/\s+/g, ' ')), here: (z.querySelector('.here') || {}).innerText }; });
  await shot('zap');
  ok('zapping: the channel before and after show on the right', zs && zs.shown && zs.rows.length === 3, zs);
  await page.waitForTimeout(2300);
  ok('…and go 2 s after the last press', await ev(() => { const z = document.getElementById('zapSides'); return !z || z.classList.contains('hidden'); }));
  await ev(() => { Store.settings.zapSides = false; Views.runAction('chnext', 'player'); });
  ok('switched off in Settings: not shown', await ev(() => { const z = document.getElementById('zapSides'); return !z || z.classList.contains('hidden'); }));
  await ev(() => { delete Store.settings.zapSides; Views.stopAll(); });

  // Movie categories: a switch each, the same rows the phone and the web editor get.
  await ev(() => Views.switchTab('movies')); await page.waitForTimeout(2500);
  const vp = await ev(() => { const p = Settings.phone.page('vod'); const i = p.rows.findIndex((r) => r.label === 'Movie categories'); return { i, value: i >= 0 ? p.rows[i].value : '' }; });
  ok('Settings > Movies and shows has Movie categories', vp.i >= 0, vp);
  const cats = await ev((i) => Settings.phone.page('vod', [i]).rows, vp.i);
  const sw = cats.filter((r) => r.kind === 'toggle');
  ok('a switch for each category (' + sw.length + ')', sw.length > 0 && sw.every((r) => r.on), cats.slice(0, 5));
  if (sw.length) {
    const r = await ev(([i, n]) => Settings.phone.change('vod', [i], n, 'toggle', { on: false }), [vp.i, sw[0].i]);
    const hidden = await ev(() => Vod.catsFor('movie').filter((c) => c.hidden).map((c) => c.name));
    ok('switched off from the phone: that category is hidden', hidden.length === 1 && hidden[0] === sw[0].label, hidden);
    ok('…and the page says so', /1 hidden/.test(JSON.stringify(await ev(() => Settings.phone.page('vod').rows.find((x) => x.label === 'Movie categories').value))));
    await ev(([i, n]) => Settings.phone.change('vod', [i], n, 'toggle', { on: true }), [vp.i, sw[0].i]);
    ok('switched back on', await ev(() => !Vod.catsFor('movie').some((c) => c.hidden)));
  }
  ok('no page errors', !errs.length, errs);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
