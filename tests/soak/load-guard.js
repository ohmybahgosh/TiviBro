/* A playlist that keeps closing TiviBro, a load that won't finish, and a list with nothing behind it
   (issue #25).
     node tests/soak/load-guard.js [--shots dir]      (mock provider on :8077, npm run serve)
   Checks: TiviBro closing twice in a row while reloading a playlist sets it to reload only when asked
   and says so, with the last good channels on screen; closing twice while loading one with nothing kept
   asks what to do instead of loading it a third time; Back on the loading screen offers to stop, and
   stopping really stops; Settings has Stop reloading while a reload runs; and most channels failing
   with provider errors says the list itself is the problem, once. */
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
  const errs = [];
  let slow = false;
  async function start(state, wait) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1920, height: 1080 } }, state ? { storageState: state } : {}));
    // A provider that takes its time with the channel list, while `slow` is on.
    await ctx.route(/get_live_streams|\/live\/(xtream|m3u)/, async (r) => { if (slow) await new Promise((res) => setTimeout(res, 20000)); r.continue().catch(() => {}); });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    if (!state) await page.addInitScript(R.init({ time: Date.now() })[0]);   // (it fixes the clock: a restart would share the session id)
    await page.goto(APP);
    if (wait !== false) await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    return { ctx, page, ev: (f, a) => page.evaluate(f, a) };
  }
  const modal = (ev) => ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\n+/g, ' | ') : ''; });
  // Leave the app as webOS does when memory runs out: in the middle of what `busy` sets up.
  async function crash(s, busy) {
    await s.ev(busy);
    await s.page.waitForTimeout(2500);
    const st = await s.ctx.storageState(); await s.ctx.close(); return st;
  }
  const reloading = () => { localStorage.setItem('tivibro.plBusy', JSON.stringify({ pid: Store.playlist.id, how: 'reloading', t: Date.now() })); Log.state('playlist', 'reloading the channel list'); };

  // 1. Closing while reloading, twice.
  let s = await start(null);
  const pid = await s.ev(() => Store.playlist.id), n0 = await s.ev(() => Library.count());
  await s.ev(() => { Store.playlist.plRefresh = 12; Store.upsertPlaylist(Store.playlist); });
  let st = await crash(s, reloading);
  s = await start(st);
  await s.page.waitForTimeout(4000);
  ok('once: it says where it closed and changes nothing yet', await s.ev(() => Log.lines().some(l => /closed while reloading the channel list/.test(l)) && +Store.playlist.plRefresh === 12));
  await s.ev(() => UI.close());
  st = await crash(s, reloading);
  s = await start(st);
  await s.page.waitForTimeout(4000);
  const m1 = await modal(s.ev);
  ok('twice: the playlist now reloads only when asked', await s.ev(() => +Store.playlist.plRefresh === 0));
  ok('and it says so, with the last good channels on screen', /closed twice while reloading/.test(m1) && /only when you ask/.test(m1) && await s.ev(() => Library.count()) === n0, m1);
  if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'guard-reloading.png') });
  await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('Enter'); await s.page.waitForTimeout(800);
  ok('Playlist settings opens that playlist\'s page', await s.ev(() => Views.tab === 'settings' && /Reload channel list/.test(document.body.innerText) && /Only when I ask/.test(document.body.innerText)));
  // A good start clears the count: closing once more starts from one again.
  await s.ev(() => { Store.playlist.plRefresh = 12; Store.upsertPlaylist(Store.playlist); });
  await s.ev(() => App.refresh(true)); await s.page.waitForTimeout(12000);
  ok('a load that works clears the count', await s.ev(() => !localStorage.getItem('tivibro.plCrash') && !localStorage.getItem('tivibro.plBusy')));

  // 2. Closing while loading a playlist that has nothing kept, twice in a row: asks instead.
  await s.ev(() => { localStorage.setItem('tivibro.plCrash', JSON.stringify({ pid: Store.playlist.id, n: 1, t: Date.now() })); });
  st = await crash(s, () => { localStorage.setItem('tivibro.plBusy', JSON.stringify({ pid: Store.playlist.id, how: 'loading', t: Date.now() })); Log.state('playlist', 'loading the channel list'); });
  s = await start(st, false);
  await s.page.waitForTimeout(5000);
  const m2 = await modal(s.ev);
  ok('loading it closed TiviBro twice: it asks first', /closed twice while loading/.test(m2) && /Try loading it again/.test(m2) && /Change the connection/.test(m2) && /Add another playlist/.test(m2), m2);
  ok('and has not loaded it a third time', await s.ev(() => !window.Library || !Library.count() || !Source.loading));
  if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'guard-loading.png') });
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }).catch(() => {});
  ok('Try loading it again loads it', await s.ev(() => Library.count() > 0));

  // 3. Back on the loading screen stops a load that won't finish.
  await s.ev((p) => { const q = Object.assign({}, Store.playlist, { id: 'slow1', name: 'Slow list' }); Store.upsertPlaylist(q); }, pid);
  slow = true;
  await s.ev(() => App.switchPlaylist('slow1'));
  await s.page.waitForTimeout(1500);
  ok('the loading screen says Back stops it', /Press Back to stop/.test(await s.ev(() => document.getElementById('viewSetup').innerText)));
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(500);
  const m3 = await modal(s.ev);
  ok('Back asks whether to stop', /Stop loading Slow list\?/.test(m3) && /Keep waiting/.test(m3) && /Stop, and use/.test(m3), m3);
  if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'stop-loading.png') });
  await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('ArrowDown'); await s.page.keyboard.press('Enter');
  await s.page.waitForTimeout(500);
  ok('stopping ends the load at once', await s.ev(() => !Source.loading));
  slow = false;
  await s.page.waitForFunction(() => Store.settings.active !== 'slow1' && window.Library && Library.count() > 0 && document.getElementById('viewSetup').classList.contains('hidden'), null, { timeout: 30000 }).catch(() => {});
  ok('and the other playlist opens', await s.ev(() => Store.settings.active !== 'slow1' && Library.count() > 0));

  // 4. Settings: Stop reloading while a reload runs.
  slow = true;
  await s.ev(() => { App.refresh(true); App.openPlaylistSettings(Store.playlist.id); });
  await s.page.waitForTimeout(1200);
  ok('Settings has Stop reloading while it reloads', /Stop reloading/.test(await s.ev(() => document.body.innerText)));
  await s.ev(() => App.stopReload()); await s.page.waitForTimeout(800);
  ok('which stops it and keeps the channels', await s.ev(() => !App.reloading && Library.count() > 0 && /Stopped reloading/.test(document.body.innerText)));
  slow = false;
  await s.page.waitForTimeout(1500);
  ok('and Reload channels now is back', /Reload channels now/.test(await s.ev(() => document.body.innerText)));

  // 5. Most channels failing with provider errors.  (First out of the way: the offer to report the closes above.)
  for (let k = 0; k < 4; k++) { await s.page.waitForTimeout(2500); await s.ev(() => UI.modalOpen && UI.close()); }
  await s.ev(() => { Views.switchTab('live'); localStorage.removeItem('tivibro.deadNoted'); DeadList._reset(); });
  await s.ev(() => { Library.data.exp = Date.now() + 90 * 864e5; for (let k = 0; k < 4; k++) DeadList.failed({ k: 'c' + k }, '', k % 2 ? 522 : 404); });
  ok('four failures say nothing yet', !(await modal(s.ev)));
  await s.ev(() => DeadList.failed({ k: 'c9' }, '', 404)); await s.page.waitForTimeout(400);
  const m5 = await modal(s.ev);
  ok('five say the list is the problem', /Most channels in .* aren.t playing/.test(m5) && /404 Not Found/.test(m5) && /522 Timed out/.test(m5) && /active until/.test(m5) && /VPN/.test(m5) && /Reload the channel list/.test(m5), m5);
  if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'dead-list.png') });
  await s.ev(() => UI.close());
  await s.ev(() => { for (let k = 10; k < 20; k++) DeadList.failed({ k: 'c' + k }, '', 404); }); await s.page.waitForTimeout(300);
  ok('once a day, not every failure', !(await modal(s.ev)), await modal(s.ev));
  await s.ev(() => { localStorage.removeItem('tivibro.deadNoted'); DeadList._reset(); for (let k = 0; k < 6; k++) DeadList.played({ k: 'p' + k }); for (let k = 0; k < 8; k++) DeadList.failed({ k: 'c' + k }, '', 404); });
  ok('a list where plenty plays says nothing', !(await modal(s.ev)), await modal(s.ev));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all load guard checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
