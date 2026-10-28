/* Zap storm: hundreds of channel changes in fullscreen at random speeds (held CH+, quick taps,
   pauses), then checks the app is still responsive, the last channel actually plays, and memory
   and decoders were released along the way.
     node tests/soak/zap.js [--zaps 300]
   Needs the mock provider and the app being served (see tests/soak/chaos.js). */
'use strict';
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const ZAPS = +opt('zaps', 300);
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([s, relay]) => { if (!sessionStorage.getItem('z')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('z', '1'); } localStorage.setItem('tivibro.devRelay', relay); }, [JSON.stringify(SETTINGS), RELAY]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count && Library.count() > 20, null, { timeout: 30000 });
  await page.evaluate(() => { const c = Library.channels(Library.ALL)[0]; Views.startChannel(c, false, function () { Views.goFull(); }); });
  await page.waitForTimeout(4000);
  const mem = () => page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0; });
  const heap0 = await mem();
  let seed = 7; const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const t0 = Date.now();
  for (let i = 0; i < ZAPS; i++) {
    await page.keyboard.press(rand() < 0.7 ? 'PageUp' : 'PageDown');
    const r = rand();
    await page.waitForTimeout(r < 0.6 ? 60 + r * 150 : r < 0.9 ? 400 + r * 800 : 2500);
  }
  await page.waitForTimeout(6000);
  const end = await page.evaluate(() => ({ playing: Player.playing, pos: Player.position, videos: document.querySelectorAll('video').length, state: (Player.stats || {}).state,
    name: Player.current && Player.current.n, workers: performance.getEntriesByType ? 0 : 0 }));
  await page.waitForTimeout(2000);
  const pos2 = await page.evaluate(() => Player.position);
  const heap1 = await mem();
  const t1 = Date.now();
  await page.keyboard.press('Enter');                       // quick menu should still open promptly
  const qm = await page.waitForFunction(() => !document.getElementById('qpanel') || !document.getElementById('qpanel').classList.contains('hidden'), null, { timeout: 3000 }).then(() => Date.now() - t1, () => -1);
  const log = await page.evaluate(() => Log.lines(false));
  await browser.close();
  const errs = log.filter(l => /Uncaught|Key handler error/.test(l));
  console.log(ZAPS + ' zaps in ' + Math.round((t1 - t0) / 1000) + 's');
  console.log('last channel: ' + end.name + ', state ' + end.state + ', moving ' + (pos2 > end.pos + 0.5 ? 'yes' : 'NO') + ' (' + end.pos.toFixed(1) + ' -> ' + pos2.toFixed(1) + ')');
  console.log('video elements: ' + end.videos + ', JS heap ' + heap0 + ' MB -> ' + heap1 + ' MB, quick menu answered in ' + qm + ' ms');
  console.log('page errors: ' + errors.length + (errors.length ? '  ' + errors.slice(0, 5).join(' | ') : '') + ';  logged errors: ' + errs.length + (errs.length ? '  ' + errs.slice(0, 5).join(' | ') : ''));
  process.exit(errors.length || errs.length || !(pos2 > end.pos + 0.5) ? 1 : 0);
})();
