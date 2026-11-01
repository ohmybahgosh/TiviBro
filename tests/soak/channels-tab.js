/* The Channels list in the side menu: off unless switched on (Settings > Guide, start screen,
   reminders) or TiviBro starts on it; Green in the guide still opens it.  And the one page for the
   phone app and the web editor.
     node tests/soak/channels-tab.js      (mock provider on :8077, the dev relay, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const menu = () => ev(() => [].map.call(document.querySelectorAll('.tabs .tab'), (t) => t.getAttribute('data-tab')));
  await ev(() => { delete Store.settings.channelsTab; Store.settings.startTab = 'guide'; Views.buildTabs(); });
  let m = await menu();
  ok('the Channels list is not in the menu by default', m.indexOf('live') < 0 && m[0] === 'guide', m.join(','));
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(500);
  await ev(() => UI.press('right')); await page.waitForTimeout(300);
  await ev(() => UI.press('green')); await page.waitForTimeout(500);
  ok('Green in the guide still opens it', await ev(() => Views.tab) === 'live');
  await ev(() => { Store.settings.channelsTab = true; Views.buildTabs(); });
  m = await menu();
  ok('switched on, it is back after the guide', m[0] === 'guide' && m[1] === 'live', m.join(','));
  await ev(() => { Store.settings.channelsTab = false; Store.settings.startTab = 'live'; Views.buildTabs(); });
  m = await menu();
  ok('starting on it keeps it in the menu', m[0] === 'live', m.join(','));
  await ev(() => { Store.settings.startTab = 'guide'; Views.buildTabs(); Views.switchTab('settings'); Settings.open(); Settings.section('reminders'); }); await page.waitForTimeout(500);
  ok('Settings has the switch', /Channels list in the menu/.test(await ev(() => document.body.innerText)));

  // The phone app and the web editor on one page, each saying what it is.
  await ev(() => { TIVIBRO_VERSION = '0.6.0-alpha.99'; Settings.open(); Settings.section('connect'); }); await page.waitForTimeout(1200);
  const t = await ev(() => document.querySelector('.set-scroll').innerText);
  const nav = await ev(() => [].map.call(document.querySelectorAll('#setNav > div'), (d) => d.innerText.trim()));
  ok('one page for the phone app and the web editor', nav.indexOf('Phone app and web editor') >= 0 && !nav.some((x) => /^Edit on a phone/.test(x) || x === 'Phone app'), nav.join(', '));
  ok('it says the two are different and work without each other', /Each works without the other/.test(t) && /TiviBro phone app/.test(t) && /Web editor/.test(t) && /does not pair the TiviBro app/.test(t), t.slice(0, 600));
  ok('the old section names still lead there', await ev(() => Settings.section('editor') && Settings.section('phone')));
  await page.screenshot({ path: path.join(__dirname, '..', '.shots', 'settings-phone-and-editor.png') });
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all menu and settings checks passed');
  process.exit(fails ? 1 : 0);
})();
