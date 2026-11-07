/* Leaving through the TV's "exit the app?" question isn't a crash (issue #62): from asking until a button is
   pressed again, the session counts as closing, so the TV closing TiviBro on "yes" isn't reported next time.
     npm run serve &   (and the mock provider on :8077)
     node tests/soak/exit-mark.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  const ev = (f, a) => page.evaluate(f, a);
  const open = () => ev(() => JSON.parse(localStorage.getItem('tivibro.alive')).open);
  ok('a running session is marked open', await open() === true);
  await ev(() => { Log.closing(true); document.dispatchEvent(new Event('visibilitychange')); });
  ok('the TV asked about exiting: marked closing, and it stays so on the next mark', await open() === false);
  await ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 40, bubbles: true })); });
  ok('a button pressed after that (the answer was no): open again', await open() === true);
  // Closed while the question was up and answered yes: no "closed unexpectedly" next start.
  await ev(() => Log.closing(true));
  const page2 = await ctx.newPage(); await page.close();
  await page2.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page2.goto(APP);
  await page2.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page2.waitForTimeout(3000);
  const un = await page2.evaluate(() => Log.unclean);
  ok('the next start doesn\'t report it as closing unexpectedly', !un, JSON.stringify(un));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all exit mark checks passed');
  process.exit(fails ? 1 : 0);
})();
