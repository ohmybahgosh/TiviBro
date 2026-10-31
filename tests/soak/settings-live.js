/* Settings pages show what is true now, not what was true when they opened.
     node tests/soak/settings-live.js      (mock provider on :8077, npm run serve)
   A playlist's page: Reload guide now shows "loading now", then the new Guide last loaded time, without
   leaving the page.  Reload channels now updates Last reloaded the same way. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => Epg.status && Epg.status.at > 0 && !Epg.loading, null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  const row = (label) => ev((l) => { const r = [].slice.call(document.querySelectorAll('.set-scroll .opt')).find((d) => d.querySelector('.ol') && d.querySelector('.ol').firstChild.textContent === l); return r ? r.querySelector('.ov').innerText.trim() : null; }, label);
  const click = (label) => ev((l) => { const r = [].slice.call(document.querySelectorAll('.set-scroll .opt')).find((d) => d.querySelector('.ol') && d.querySelector('.ol').firstChild.textContent === l); if (r) r.click(); return !!r; }, label);

  // Pretend both loaded three hours ago, then open the playlist's page.
  await ev(() => { Epg.status.at = Date.now() - 3 * 3600e3; Library.data.at = Date.now() - 3 * 3600e3; });
  await ev(() => { Views.switchTab('settings'); Settings.open(); Settings.section('playlists'); });
  await page.waitForTimeout(600);
  await ev(() => document.querySelector('.set-scroll .opt').click());
  await page.waitForTimeout(800);
  const before = await row('Guide last loaded'), chBefore = await row('Last reloaded');
  ok('the page shows the old times', !!before && !!chBefore, before + ' / ' + chBefore);

  await click('Reload guide now');
  let sawLoading = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(250);
    const v = await row('Guide last loaded');
    if (v === 'loading now') sawLoading = true;
    if (sawLoading && v && v !== 'loading now') break;
  }
  const after = await row('Guide last loaded');
  const want = await ev(() => { const d = new Date(Epg.status.at); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + U.hhmm(Epg.status.at); });
  ok('Reload guide now: "loading now" while it loads', sawLoading);
  ok('then the new time, on the same page', after === want && after !== before, before + ' -> ' + after + ' (want ' + want + ')');

  await click('Reload channels now');
  let chAfter = chBefore;
  for (let i = 0; i < 60 && chAfter === chBefore; i++) { await page.waitForTimeout(250); chAfter = await row('Last reloaded'); }
  ok('Reload channels now: Last reloaded updates on the same page', chAfter && chAfter !== chBefore, chBefore + ' -> ' + chAfter);
  ok('still on the playlist page', /Guide last loaded/.test(await ev(() => document.querySelector('.set-scroll').innerText)));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all live settings checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
