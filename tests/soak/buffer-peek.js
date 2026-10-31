/* Buffer info on demand (issue #6): Hold Info in fullscreen shows the buffer meter even when the meter
   is set to Off, for the time in Settings > Playback, and pressing again hides it.
     node tests/soak/buffer-peek.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await ev(() => { Store.settings.meter = 'off'; Store.settings.meterPeek = 2; Store.saveSettings(); });
  await ev(() => { const c = Library.data.channels[0]; Views.startChannel(c, false, function () { Views.goFull(); }); });
  await page.waitForFunction(() => Player.stats && Player.stats.state === 'playing', null, { timeout: 30000 }).catch(() => {});
  const shown = () => ev(() => !document.getElementById('meter').classList.contains('hidden'));
  await page.waitForTimeout(1500);
  ok('meter off: hidden while playing', !(await shown()));
  ok('Hold Info runs buffer info by default', await ev(() => Keymap.get('player', 'long:info') === 'buffer'));
  await ev(() => UI.press('long:info'));
  await page.waitForTimeout(300);
  ok('Hold Info shows the meter', await shown());
  const text = await ev(() => document.getElementById('meterText').textContent);
  ok('it shows the seconds banked', /\d+\.\ds/.test(text), text);
  await page.waitForTimeout(2600);
  ok('it hides itself after the set time', !(await shown()));
  await ev(() => UI.press('long:info'));
  await page.waitForTimeout(300);
  await ev(() => UI.press('long:info'));
  await page.waitForTimeout(300);
  ok('pressing again hides it', !(await shown()));
  await ev(() => { Store.settings.meterPeek = 0; });
  await ev(() => UI.press('long:info'));
  await page.waitForTimeout(3000);
  ok('Until pressed again keeps it up', await shown());
  await ev(() => UI.press('back'));
  await page.waitForTimeout(500);
  ok('leaving fullscreen hides it', !(await shown()));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all buffer info tests passed');
  process.exit(fails ? 1 : 0);
})();
