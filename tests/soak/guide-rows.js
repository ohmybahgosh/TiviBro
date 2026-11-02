/* Guide row size (Settings > Guide, start screen, reminders): Normal, Large and Extra large rows, with
   bigger text, and the same channel still selected after a change.
     node tests/soak/guide-rows.js [--shots dir]      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(3000);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(600);
  const look = () => page.evaluate(() => {
    const r = document.querySelector('.guide-body .grow'), t = document.querySelector('.guide-body .gp .gt'), sel = document.querySelector('.grow.sel .gch .n');
    return { rows: document.querySelectorAll('.guide-body .grow').length, h: r.getBoundingClientRect().height, title: parseFloat(getComputedStyle(t).fontSize), sel: sel && sel.textContent, fits: r.getBoundingClientRect().height * document.querySelectorAll('.guide-body .grow').length <= document.querySelector('.guide-body').clientHeight + 1 };
  });
  const m = await look();
  const out = {};
  for (const v of ['l', 'xl']) {
    await page.evaluate(v => { Store.settings.guideRows = v; Views.applyLook(); Guide.resize(); }, v); await page.waitForTimeout(800);
    out[v] = await look();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tv-guide-rows-' + v + '.png') });
  }
  ok('Normal: 100 px rows', m.h === 100 && m.fits, JSON.stringify(m));
  ok('Large: taller rows, bigger titles, fewer rows that still fit', out.l.h === 120 && out.l.title > m.title && out.l.rows < m.rows && out.l.fits, JSON.stringify(out.l));
  ok('Extra large: taller again', out.xl.h === 150 && out.xl.title > out.l.title && out.xl.rows <= out.l.rows && out.xl.fits, JSON.stringify(out.xl));
  ok('the same channel stays selected', out.l.sel === m.sel && out.xl.sel === m.sel, [m.sel, out.l.sel, out.xl.sel].join(' / '));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
  ok('moving still works after a change', await page.evaluate(() => !!document.querySelector('.grow.sel')) && (await look()).sel !== m.sel);
  await page.evaluate(() => { Store.settings.guideRows = 'm'; Views.applyLook(); Guide.resize(); }); await page.waitForTimeout(500);
  ok('back to Normal', (await look()).h === 100);
  ok('Settings has Guide row size', await page.evaluate(() => { Views.switchTab('settings'); Settings.section('reminders'); return /Guide row size/.test(document.body.innerText); }));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all guide row size checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
