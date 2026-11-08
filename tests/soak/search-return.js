/* Issue #63: a channel watched from Search, then Back.  The guide and the channel list are on that channel,
   in its own group (not an empty list, not a channel from the group looked at before), and going back to
   Search lands on the results, not in the keyboard.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/search-return.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  try {
    for (const home of ['guide', 'live']) {
      // Looking at one group; the channel searched for is in another.
      const t = await ev((home) => {
        const gs = Library.groups().filter((g) => g.id !== Library.ALL && !Library.isCustom(g.id) && Library.channels(g.id).length > 1);
        const g1 = gs[0], g2 = gs[gs.length - 1], c = Library.channels(g2.id)[1];
        Views.group = g1.id; Views.switchTab(home);
        if (home === 'guide') Guide.open(g1.id, null);
        return { g1: g1.id, g2: g2.id, k: c.k, name: Library.name(c) };
      }, home);
      await ev(() => Views.switchTab('search')); await page.waitForTimeout(600);
      await ev((q) => { const i = document.querySelector('.search-input'); i.value = q; i.dispatchEvent(new Event('input')); }, t.name);
      await page.waitForTimeout(1200);
      // Down to the first result, OK.
      for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); }      // the filters, then the results
      await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
      const playing = await ev(() => ({ k: Views.playing && Views.playing.k, full: Views.full, group: Views.group }));
      ok(home + ': the result plays fullscreen', playing.k === t.k && playing.full, JSON.stringify(playing) + ' want ' + t.k);
      ok(home + ': zapping goes through its own group', playing.group === t.g2 || playing.group === Library_ALL(), JSON.stringify(playing) + ' want ' + t.g2);
      for (let i = 0; i < 3 && await ev(() => Views.full); i++) { await ev(() => UI.press('back')); await page.waitForTimeout(900); }     // (the first may close the info bar)
      const back = await ev(() => ({ tab: Views.tab, full: Views.full, group: Views.group, guideGid: Guide.__gid(), guideOn: (Guide.__list()[Guide.__sel()] || {}).k, listOn: (Views.__list ? null : null), chans: Library.channels(Views.group).length }));
      const want = t.g2;
      ok(home + ': Back from fullscreen lands on the channel\'s group, not an empty list', !back.full && back.group === want && back.chans > 0, JSON.stringify(back));
      if (back.tab === 'guide') ok(home + ': the guide is on that channel', back.guideGid === want && back.guideOn === t.k, JSON.stringify(back) + ' want ' + t.k);
      // Back to Search: the results, at the one watched; no keyboard.
      await ev(() => Views.switchTab('search')); await page.waitForTimeout(800);
      const s = await ev(() => ({ input: document.activeElement && document.activeElement.classList.contains('search-input'), sel: (document.querySelector('.search-list .row.sel') || {}).innerText || '' }));
      ok(home + ': Search again shows the results, not the keyboard', !s.input && s.sel, JSON.stringify(s));
      await ev(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); });
    }
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all search-return checks passed');
  process.exit(fails ? 1 : 0);
})();
function Library_ALL() { return 'all'; }
