/* A first start reads the guide: the channels get listings, nothing waits forever (alpha 140 stopped
   there, on a name out of reach in loadXml).
     node tests/mock/mock_provider.js &      (on :8077)
     npm run serve &                         (app on :8078)
     node tests/soak/guide-fresh.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const rejected = []; page.on('console', (m) => { if (/Unhandled|ReferenceError|is not defined/.test(m.text())) rejected.push(m.text()); });
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(R.APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  const got = await page.waitForFunction(() => window.Epg && Epg.guideChannels().length > 0, null, { timeout: 60000 }).then(() => true, () => false);
  ok('a first start reads the guide', got, await page.evaluate(() => ({ loading: Epg.loading, n: Epg.guideChannels().length })).then(JSON.stringify));
  await page.evaluate(() => { Views.switchTab('guide'); Guide.open(Library.ALL, Library.channels(Library.ALL)[0].k); });
  await page.waitForTimeout(1500);
  ok('the guide shows listings, not "Loading…"', await page.evaluate(() => document.querySelectorAll('#viewGuide .gp:not(.loading):not(.none)').length > 3));
  ok('no page errors', !errs.length && !rejected.length, errs.concat(rejected).join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
