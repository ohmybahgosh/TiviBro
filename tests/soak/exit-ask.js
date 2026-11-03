/* Exiting from the remote asks first (views.js askExit): on webOS 6 and later TiviBro hands Back to the TV
   (platformBack), which asks "Do you want to exit the app?"; on webOS 4 and 5, where that only goes to the
   home screen, TiviBro asks itself and closes only on Exit.
     node tests/soak/exit-ask.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  async function tv(chrome) {
    const ua = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + '.0.0.0 Safari/537.36 WebAppManager';
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: ua });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(R.init({ time: Date.now() })[0]);
    await page.addInitScript(() => { window.__back = 0; window.__closed = 0; window.PalmSystem = Object.assign(window.PalmSystem || {}, { platformBack: () => { window.__back++; } }); window.close = () => { window.__closed++; }; });
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    return { page, ctx, errs, ev: (f) => page.evaluate(f) };
  }
  const modal = (t) => t.ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText : ''; });
  // webOS 25 (Chromium 120): the TV's own question.
  let t = await tv(120);
  await t.ev(() => Views.exitApp(true)); await t.page.waitForTimeout(200);
  ok('the first Back says press again', /Press Back again to exit/.test(await t.ev(() => document.body.innerText)));
  await t.ev(() => Views.exitApp(true)); await t.page.waitForTimeout(500);
  ok('webOS 6 and later: the second Back hands it to the TV, which asks', await t.ev(() => window.__back) === 1 && await t.ev(() => window.__closed) === 0 && !(await modal(t)));
  ok('and TiviBro keeps running if the viewer stays', await t.ev(() => Library.count() > 0 && !!document.querySelector('#viewGuide, #viewLive')));
  await t.ctx.close();
  // webOS 4 (Chromium 53 UA): TiviBro asks.
  t = await tv(53);
  await t.ev(() => { Views.exitApp(true); Views.exitApp(true); }); await t.page.waitForTimeout(400);
  let m = await modal(t);
  ok('webOS 4 and 5: TiviBro asks Exit TiviBro?, Cancel picked', /Exit TiviBro\?/.test(m) && /Cancel/.test(m) && await t.ev(() => window.__back) === 0, m);
  await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(300);
  ok('Cancel stays', await t.ev(() => window.__closed) === 0 && !(await modal(t)));
  await t.ev(() => { Views.exitApp(true); Views.exitApp(true); }); await t.page.waitForTimeout(300);
  await t.page.keyboard.press('ArrowUp'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(500);
  ok('Exit closes', await t.ev(() => window.__closed) === 1);
  ok('no page errors', !t.errs.length, t.errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all exit checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
