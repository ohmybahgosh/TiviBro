/* A game on several channels (Views.playChain): a launcher's game, a reminder or Sports' Watch plays the first
   channel showing it, and when that one fails or hasn't started in 12 seconds the next one is tried, with a toast.
     node tests/soak/same-game.js        (mock provider on :8077 and the app served, see tests/soak/chaos.js)
   Two cases, on two of the mock's channels standing in for one game's event channels:
     fails      the first channel answers 404
     stalls     the first channel never answers
   Each should end up playing the second channel and say so, and Options (Channel) offers the first one back. */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' };
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? '  ' + x : '')); if (!c) fails++; };

// One case: the first channel's stream answers 404 (how = 'fails') or never answers (how = 'stalls').
async function run(browser, how) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([s, relay]) => { if (!sessionStorage.getItem('sg')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('sg', '1'); } localStorage.setItem('tivibro.devRelay', relay); }, [JSON.stringify(SETTINGS), RELAY]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.channels && Library.channels(Library.ALL).length > 3, null, { timeout: 30000 });
  // Two channels with no other versions of themselves, so only the chain can move between them.
  const two = await page.evaluate(() => Library.channels(Library.ALL).filter((c) => !Library.versions(c).length && !/radio/i.test(c.n)).slice(0, 2).map((c) => ({ k: c.k, n: Library.name(c), id: String(c.id || c.k).replace(/\D/g, '') })));
  ok(how + ': two channels to use', two.length === 2, JSON.stringify(two));
  const first = two[0].id;
  await page.route(new RegExp('/live/[^/]+/[^/]+/' + first + '\\.(ts|m3u8)'), (r) => (how === 'fails' ? r.fulfill({ status: 404, body: 'gone' }) : undefined));
  await page.evaluate(() => { const toasts = window.__toasts = []; const t = document.getElementById('toast'); new MutationObserver(() => toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
  const t0 = Date.now();
  await page.evaluate((ks) => Views.playChain(ks.map((k) => Library.find(k)), 'test'), two.map((x) => x.k));
  await page.waitForFunction((k) => Views.playing && Views.playing.k === k && Player.position > 1, two[1].k, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => ({ k: Views.playing && Views.playing.k, pos: Player.position, toasts: window.__toasts.join(' / ') }));
  ok(how + ': the second channel plays', r.k === two[1].k && r.pos > 1, (r.k || 'nothing') + ' after ' + Math.round((Date.now() - t0) / 1000) + 's');
  ok(how + ': says so', r.toasts.indexOf("isn't starting.  Trying " + two[1].n + ' (2 of 2)') >= 0, r.toasts.slice(0, 200));
  ok(how + ': within the wait', Date.now() - t0 < 40000, Math.round((Date.now() - t0) / 1000) + 's');
  const others = await page.evaluate(() => Views.chainOthers().map((c) => c.k));
  ok(how + ': the first one stays offered', others.length === 1 && others[0] === two[0].k, JSON.stringify(others));
  // Picking a channel yourself ends it.
  await page.evaluate((k) => Views.startChannel(Library.find(k), false), two[1].k);
  ok(how + ': picking a channel ends it', (await page.evaluate(() => Views.chainOthers().length)) === 0);
  ok(how + ': no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser, 'fails'); await run(browser, 'stalls'); } catch (e) { ok('ran to the end', false, e.message); }
  await browser.close();
  if (fails) { console.log(fails + ' check(s) failed'); process.exit(1); }
  console.log('all same-game checks passed');
})();
