/* Up next on a provider's show (upnext.js through vod.js), in the real app: after a long menu (its fades are a mask
   on the shared menu body, which once hid Up next but for a strip at the top), the episode ending brings up Up next
   whole, and the dark curtain stays while it fades in, so the show's page never shows through.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/upnext.js [--shots dir] */
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
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(3000);
  const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  try {
    // Harbor Street's page, its first episode played.
    await ev(() => { Store.settings.vodHome = false; Views.switchTab('shows'); }); await wait(1500);
    await page.keyboard.press('ArrowRight'); await wait(300);
    for (let n = 0; n < 12; n++) { if (await ev(() => ((document.querySelector('#vodInfo h2') || {}).textContent || '') === 'Harbor Street')) break; await page.keyboard.press('ArrowDown'); await wait(250); }
    await page.keyboard.press('Enter'); await wait(1500);
    await page.keyboard.press('Enter'); await wait(3000);
    ok('an episode is playing', await ev(() => !!Views.vodMeta));
    // A long menu, then the episode ends.
    await ev(() => { UI.menu('Long', Array.from({ length: 20 }, (_, k) => ({ label: 'Row ' + k })), () => {}); });
    ok('a long menu has its fade', await ev(() => document.getElementById('modalBody').classList.contains('more-down')));
    await ev(() => { UI.close(); Views.endVod(); });
    ok('while Up next fades in, the curtain covers the page', await ev(() => { const c = document.querySelector('.un-hold'); return !!c && !c.classList.contains('hidden') && getComputedStyle(c).display !== 'none'; }));
    await wait(600);
    const s = await ev(() => {
      const body = document.getElementById('modalBody'), w = document.querySelector('.un-words'), btn = document.querySelector('.modal.upnext .mbtns .btn');
      return { look: document.getElementById('modal').classList.contains('upnext'), mask: getComputedStyle(body).webkitMaskImage || getComputedStyle(body).maskImage,
        fades: body.className, words: w ? w.getBoundingClientRect().height : 0, btn: btn ? btn.getBoundingClientRect().top : 0, hold: !document.querySelector('.un-hold') || document.querySelector('.un-hold').classList.contains('hidden') };
    });
    ok('Up next is up, with no menu fades or mask on it', s.look && s.mask === 'none' && !/more-/.test(s.fades), JSON.stringify(s));
    ok('its words and buttons are on the screen', s.words > 100 && s.btn > 800 && s.btn < 1080, JSON.stringify(s));
    ok('the curtain is gone once it has faded in', s.hold, JSON.stringify(s));
    // What's on the screen at the words is Up next's, not the page's.
    const top = await ev(() => { const e = document.elementFromPoint(300, 300); return e && e.closest('.modal') ? 'modal' : (e && e.className) || ''; });
    ok('Up next is what is on top', top === 'modal', top);
    await shot('upnext');
    await ev(() => UI.close());
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all Up next checks passed');
  process.exit(fails ? 1 : 0);
})();
