/* A guide too big for the TV (alpha 24 on a C2: a 64 MB extra guide closed TiviBro, and it closed
   again on every start while the load restarted).
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/guide-memory.js
   - Over the memory budget the guide is trimmed (channels left out, a notice), not loaded whole.
   - A load cut short by the app closing is retried once with less memory; after a second one the
     guide is paused with a notice naming the source, and "Reload guide now" tries again. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK, pubEpg: { on: false } });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const ready = () => page.waitForFunction(() => window.Library && Library.count() > 0 && window.Epg && !Epg.loading && Epg.progress && !Epg.progress.active, null, { timeout: 60000 });
  await ready(); await page.waitForTimeout(1500);
  const full = await ev(() => Library.data.channels.filter(c => Epg.hasData(c)).length);
  ok('the guide loads normally', full > 20, full);

  // 1. A tiny budget: trimmed, with a notice, and nothing breaks.
  await ev(() => { Store.settings.guideBudget = 40000; window.__toasts = []; const t = U.toast; U.toast = function (m) { window.__toasts.push(m); return t.apply(U, arguments); }; return Epg.refresh(Library, true); });
  await page.waitForFunction(() => !Epg.loading && !Epg.progress.active, null, { timeout: 60000 });
  const tr = await ev(() => ({ n: Library.data.channels.filter(c => Epg.hasData(c)).length, toasts: window.__toasts }));
  ok('over budget: fewer channels kept', tr.n > 0 && tr.n < full, tr.n + ' of ' + full);
  ok('over budget: says the guide was too big', tr.toasts.some(m => /too big for this TV/.test(m)), JSON.stringify(tr.toasts));
  await ev(() => { delete Store.settings.guideBudget; });

  // 2. The app closes in the middle of a load (twice).  A guide source that never finishes stands in
  //    for the big one; reloading the page is the app being closed under it.
  const runOf = () => ev(() => { try { return JSON.parse(localStorage.getItem('tivibro.guideRun') || '{}').main || null; } catch (e) { return null; } });
  await ev(m => { Store.playlist.epgSources = [{ url: m + '/stall.xml', offset: 0 }]; Store.saveSettings(); return Epg.refresh(Library, true) && null; }, MOCK);
  await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem('tivibro.guideRun') || '{}').main || {}).host; } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => Log.lines().some(l => /did not finish/.test(l)), null, { timeout: 30000 }).catch(() => {});
  const safe = await ev(() => Log.lines().filter(l => /did not finish/.test(l)));
  ok('after one close mid-load: loads again with less memory, naming the guide', safe.length > 0 && /127\.0\.0\.1/.test(safe[0]), JSON.stringify(safe));
  const r1 = await runOf();
  ok('the second try is noted too', r1 && r1.tries === 2, JSON.stringify(r1));
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count() > 0 && window.Epg && Epg.paused, null, { timeout: 30000 }).catch(() => {});
  const pz = await ev(() => ({ paused: Epg.paused, prog: Epg.progress, loading: Epg.loading }));
  ok('after two closes: guide loading paused, not tried again', !!pz.paused && pz.prog.phase === 'error' && /paused/.test(pz.prog.error), JSON.stringify(pz));
  ok('the notice names the guide it was loading', pz.paused && pz.paused.host && pz.prog.error.indexOf(pz.paused.host) >= 0, pz.paused && pz.paused.host);
  // Remove the source and "Reload guide now": loads, and the note is gone.
  await ev(() => { Store.playlist.epgSources = []; Store.saveSettings(); return Epg.refresh(Library, true); });
  await page.waitForFunction(() => !Epg.loading && !Epg.progress.active && Epg.progress.phase === 'done', null, { timeout: 60000 });
  const back = await ev(() => ({ n: Library.data.channels.filter(c => Epg.hasData(c)).length, run: localStorage.getItem('tivibro.guideRun'), paused: Epg.paused }));
  ok('Reload guide now loads it again and clears the note', back.n === full && !/main/.test(back.run || '') && !back.paused, JSON.stringify(back));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all guide memory checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
