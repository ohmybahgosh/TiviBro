/* Screenshots for the promo video (scripts/promo/): the guide in several themes, playing, and Settings
   with the channel in the corner and Search settings open.
     node scripts/demo/promo-shots.js [out dir]      (default /tmp/promo/shots)
   Needs the same servers as record.js (mock provider on 8077, npm run serve).  My teams comes from
   tests/soak/my-teams.js --shots <dir>, with its own mock on 8089. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const R = require('./record.js');
const OUT = process.argv[2] || '/tmp/promo/shots';
fs.mkdirSync(OUT, { recursive: true });
const THEMES = (process.env.THEMES || 'mono,tokyo,dracula,catppuccin,terminal,gruvbox,nord,rosepine').split(',');

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(R.APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const H = R.helpers(page);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  // A channel playing in the guide's window.
  await H.quiet('ArrowDown', 300); await H.quiet('Enter', 3500);
  for (const t of THEMES) {
    await page.evaluate((p) => { Store.settings.palette = p; Views.applyLook(); }, t);
    await page.waitForTimeout(900);
    await shot('promo-theme-' + t);
  }
  await page.evaluate(() => { Store.settings.palette = 'mono'; Views.applyLook(); });
  // Settings with the channel carrying on in the corner.
  await H.open('Settings', 2500);
  await shot('promo-settings');
  // Search settings (Yellow).
  await H.quiet('y', 900);
  await page.keyboard.type('subtitle', { delay: 60 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot('promo-search-settings');
  console.log(errs.length ? 'page errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
