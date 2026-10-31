/* TV fixes found on a real C2 (alpha 22):
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/tvfix.js
   - Holding OK opens the menu and stays there: the repeats while OK is still down, and letting go,
     must not count as OK on the menu (it used to pick "Watch fullscreen").
   - Settings: notes after the last choice scroll into view, a page of facts only scrolls with ▲ ▼,
     and a heading is never drawn as selected.
   - The guide's groups panel reads as a layer: programmes behind it dimmed. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 240) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await page.waitForTimeout(2500);
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, n, w) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(w || 120); } };

  // 1. Hold OK on a channel in the guide grid, with the TV's key repeats, then let go.
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(1200);
  if (await ev(() => document.getElementById('viewGuide').classList.contains('groups-open'))) {
    ok('the groups panel dims the programmes behind it', await ev(() => getComputedStyle(document.getElementById('guideBody')).opacity) < 0.6);
    await key('ArrowRight', 1, 500);
  }
  await page.keyboard.down('Enter'); await page.waitForTimeout(750);
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(40); }    // auto-repeat
  await page.keyboard.up('Enter'); await page.waitForTimeout(600);
  ok('hold OK: the menu opens and stays open', await ev(() => UI.modalOpen), await ev(() => document.getElementById('modalTitle').textContent));
  ok('hold OK: letting go picks nothing (not fullscreen)', await ev(() => !Views.full && !Views.playing));
  await key('Enter', 1, 500);
  ok('the next OK press does pick from the menu', await ev(() => !UI.modalOpen));
  await ev(() => { Views.stopAll && Views.stopAll(); if (UI.modalOpen) UI.close(); });

  // 2. Settings.
  await ev(() => Views.switchTab('settings')); await page.waitForTimeout(600);
  const click = async re => { const h = await page.evaluateHandle(r => [...document.querySelectorAll('#app *')].filter(e => e.children.length < 4 && new RegExp(r).test(e.textContent.trim()) && e.offsetParent).sort((a, c) => a.textContent.length - c.textContent.length)[0], re); const el = h.asElement(); if (!el) throw new Error('no ' + re); await el.click(); await page.waitForTimeout(500); };
  await click('^Guide, start screen, reminders$');
  await key('ArrowRight'); await key('ArrowDown', 30, 60);
  const last = await ev(() => { const body = document.querySelector('.set-body').getBoundingClientRect(), rows = [...document.querySelectorAll('.set-scroll .opt')], r = rows[rows.length - 1].getBoundingClientRect(); return { bottom: r.bottom, limit: body.bottom, text: rows[rows.length - 1].textContent }; });
  ok('the note after the last choice is in view, not under the hint bar', last.bottom <= last.limit + 1, JSON.stringify(last));
  const clock = await ev(() => { const c = document.getElementById('clock').getBoundingClientRect(); return [...document.querySelectorAll('.set-scroll .opt')].every(o => { const r = o.getBoundingClientRect(); return r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right; }); });
  await key('ArrowUp', 40, 40);
  const clockTop = await ev(() => { const c = document.getElementById('clock').getBoundingClientRect(), r = document.querySelector('.set-scroll .opt.focus').getBoundingClientRect(); return r.top >= c.bottom; });
  ok('the top row clears the clock', clockTop);
  await click('^Diagnostics$');
  await click('^What this TV can play');
  ok('a page of facts draws no row as selected', await ev(() => !document.querySelector('.set-scroll .opt.focus')));
  const y0 = await ev(() => document.querySelector('.set-scroll')._y || 0);
  await key('ArrowDown', 2);
  const y1 = await ev(() => document.querySelector('.set-scroll')._y || 0);
  ok('▼ scrolls a page of facts', y1 < y0, y0 + ' -> ' + y1);
  await key('ArrowUp', 4);
  ok('▲ scrolls it back to the top', await ev(() => (document.querySelector('.set-scroll')._y || 0) === 0));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all TV fix checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
