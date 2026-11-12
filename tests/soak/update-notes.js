/* A long list of what's new in an update offer: Up and Down scroll it, a line says so, and the buttons stay on
   screen (discussion #36's panel: the notes were cut off with no way to read the rest).
     node tests/soak/update-notes.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const lines = []; for (let i = 1; i <= 24; i++) lines.push('Change number ' + i + ': something that got better in this release, said in a line or so.');
  const st = () => page.evaluate(() => {
    const ul = document.querySelector('.upd-notes ul'), btn = document.querySelector('.modal-box .mbtns'), r = btn.getBoundingClientRect();
    return { top: ul.scrollTop, room: ul.clientHeight, all: ul.scrollHeight, hint: getComputedStyle(document.querySelector('.upd-more')).display !== 'none', btnBottom: r.bottom, H: innerHeight, focus: document.querySelector('.mbtns .focus').textContent };
  });
  await page.evaluate((l) => { UI.panel('TiviBro 9.9.9 is out', Update._test.notesBox(l, 'Install it now?'), [{ label: 'Install and restart' }, { label: 'Later' }]); }, lines);
  await page.waitForTimeout(300);
  const a = await st();
  ok('a long list is cut to fit, the buttons whole on screen, and a line says how to read the rest', a.all > a.room && a.btnBottom <= a.H && a.hint, a);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
  const c = await st();
  ok('Down scrolls the list, focus stays on Install and restart', c.top > a.top && c.focus === 'Install and restart', c);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const d = await st();
  ok('at the end of the list, Down moves to Later', d.top + d.room >= d.all - 2 && d.focus === 'Later', d);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => { UI.close(); UI.panel('TiviBro 9.9.9 is out', Update._test.notesBox(['One small fix.'], 'Install it now?'), [{ label: 'Install and restart' }, { label: 'Later' }]); });
  await page.waitForTimeout(300);
  const e = await st();
  ok('a short list says nothing about scrolling', !e.hint, e);
  ok('no page errors', !errs.length, errs);
  await b.close();
  console.log(fails ? fails + ' failures' : 'all update notes checks passed');
  process.exit(fails ? 1 : 0);
})();
