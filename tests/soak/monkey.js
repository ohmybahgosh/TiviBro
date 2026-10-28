/* Remote-control monkey: thousands of random key presses across the whole app (guide, lists,
   fullscreen, menus, settings, search, movies, multiview), looking for crashes and dead ends.
     node tests/soak/monkey.js [--minutes 4] [--seeds 1,2,3] [--rate 8]
   Needs the mock provider and the app being served (see tests/soak/chaos.js).  Reports page
   errors, "Key handler error" log lines, and moments where 40 key presses in a row changed
   nothing on screen (a dead end).  Seeded, so a failing run can be replayed. */
'use strict';
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const MIN = +opt('minutes', 4), RATE = +opt('rate', 8), SEEDS = String(opt('seeds', '1,2,3')).split(',').map(Number);
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' };

// Weighted key list: mostly navigation, some OK/Back, a little of everything else.
const KEYS = [['ArrowDown', 18], ['ArrowUp', 14], ['ArrowRight', 12], ['ArrowLeft', 12], ['Enter', 12], ['Escape', 9], ['PageUp', 3], ['PageDown', 3],
  ['g', 2], ['m', 2], ['y', 2], ['b', 1], ['i', 2], ['1', 1], ['5', 1], ['hold', 3], ['play', 1], ['rew', 1], ['ff', 1]];
const TOTAL = KEYS.reduce((a, k) => a + k[1], 0);
function rng(seed) { let x = seed * 9301 + 49297; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }

async function monkey(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [], rand = rng(seed);
  page.on('pageerror', e => errors.push('page: ' + e.message));
  // Exiting the app would end the run: make the exit paths harmless in the browser.
  await page.addInitScript(([s, relay]) => {
    if (!sessionStorage.getItem('mk')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('mk', '1'); }
    localStorage.setItem('tivibro.devRelay', relay);
    window.close = function () { window.__exitTried = (window.__exitTried || 0) + 1; };
  }, [JSON.stringify(SETTINGS), RELAY]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count && Library.count() > 0, null, { timeout: 30000 });
  const end = Date.now() + MIN * 60000;
  let presses = 0, same = 0, lastSig = '', dead = [], trail = [];
  // What the viewer would see: screen, focus, dialogs, what is playing, and the panels over video.
  const sig = () => page.evaluate(() => {
    const vis = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden') ? id : ''; };
    const foc = Array.prototype.slice.call(document.querySelectorAll('.focus, .sel')).filter(e => e.offsetParent).map(e => e.textContent.slice(0, 30)).join('/');
    return [document.body.className, window.Views ? Views.tab + '|' + Views.zone + '|' + Views.full : '', foc, vis('modal') && document.getElementById('modalTitle').textContent,
      vis('osd'), vis('qpanel'), vis('overlay'), vis('vidError'), Player.current ? Player.current.n : '', Math.round(Player.position || 0)].join('#').slice(0, 400);
  });
  while (Date.now() < end) {
    let r = rand() * TOTAL, key = KEYS[0][0];
    for (const [k, w] of KEYS) { if ((r -= w) < 0) { key = k; break; } }
    trail.push(key); if (trail.length > 40) trail.shift();
    try {
      if (key === 'hold') { await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); }
      else if (key === 'play' || key === 'rew' || key === 'ff') {
        await page.evaluate(c => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: c, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: c, bubbles: true })); }, { play: 415, rew: 412, ff: 417 }[key]);
      } else await page.keyboard.press(key);
    } catch (e) { errors.push('key: ' + e.message); break; }
    presses++;
    await page.waitForTimeout(1000 / RATE + (rand() < 0.05 ? 1500 : 0));     // now and then, linger
    if (presses % 5 === 0) {
      const s = await sig().catch(() => 'gone');
      if (s === lastSig) { same += 5; if (same === 40) dead.push({ at: presses, sig: s.slice(0, 160), keys: trail.slice(-12).join(' ') }); }
      else { same = 0; lastSig = s; }
    }
  }
  const log = await page.evaluate(() => Log.lines(false)).catch(() => []);
  const keyErrors = log.filter(l => /Key handler error|ERROR/.test(l) && !/player|http|net |helper/.test(l));
  const shot = '/tmp/monkey-' + seed + '.png';
  await page.screenshot({ path: shot }).catch(() => {});
  await ctx.close();
  return { seed, presses, errors, keyErrors: keyErrors.slice(-12), dead, shot };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const res = await Promise.all(SEEDS.map(s => monkey(browser, s).catch(e => ({ seed: s, failed: e.message }))));
  await browser.close();
  let bad = 0;
  res.forEach(r => {
    if (r.failed) { bad++; return console.log('seed ' + r.seed + ': harness failed: ' + r.failed); }
    console.log('seed ' + r.seed + ': ' + r.presses + ' presses, ' + r.errors.length + ' page errors, ' + r.keyErrors.length + ' logged errors, ' + r.dead.length + ' dead ends  (' + r.shot + ')');
    r.errors.slice(0, 10).forEach(e => console.log('   ' + e.slice(0, 300)));
    r.keyErrors.forEach(e => console.log('   ' + e.slice(0, 300)));
    r.dead.slice(0, 5).forEach(d => console.log('   dead end after ' + d.at + ': ' + d.sig + '   keys: ' + d.keys));
    bad += r.errors.length + r.keyErrors.length;
  });
  process.exit(bad ? 1 : 0);
})();
