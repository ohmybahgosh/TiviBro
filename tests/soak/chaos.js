/* Plays each sloppy stream from tests/mock/chaos.js in the real app and measures how well the
   player copes: time to first picture, how much of the time the picture moved, every freeze
   longer than a second, reconnects and refills, and whether it ended on an error.
     MOCK_CHAOS=1 node tests/mock/mock_provider.js &      (needs tests/mock/media/chaos.ts, see make-media.sh)
     npm run serve &                                       (app on :8078 and the dev relay)
     node tests/soak/chaos.js [901 902 ...] [--secs 150] [--profile balanced] [--parallel 3] [--json out.json]
   Headless Chromium decodes in software, so absolute numbers differ from a TV; compare runs. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const SECS = +opt('secs', 150), PROFILE = opt('profile', 'balanced'), PAR = +opt('parallel', 3), OUT = opt('json', '');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = process.env.RELAY || '47811';
const ALL = [901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912];
const modes = argv.filter(a => /^9\d\d$/.test(a)).map(Number);
const run = modes.length ? modes : ALL;

const SETTINGS = { meter: 'off', buffer: PROFILE, playlists: [{ id: 'p1', name: 'Chaos', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' };

async function one(browser, id) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([s, relay]) => {
    if (!sessionStorage.getItem('chaosInit')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('chaosInit', '1'); }
    localStorage.setItem('tivibro.devRelay', relay);
  }, [JSON.stringify(SETTINGS), RELAY]);
  await page.goto(APP);
  await page.waitForFunction(k => window.Library && Library.find && Library.find(k), 'x' + id, { timeout: 30000 });
  const t0 = Date.now();
  await page.evaluate(k => { const c = Library.find(k); Views.startChannel(c, false, function () { Views.goFull(); }); }, 'x' + id);
  const samples = [];
  while (Date.now() - t0 < SECS * 1000) {
    await page.waitForTimeout(250);
    let s;
    try { s = await page.evaluate(() => { const st = Player.stats || {}; return { pos: Player.position, ahead: st.ahead || 0, state: st.state || '', playing: Player.playing }; }); }
    catch (e) { errors.push('sample: ' + e.message); break; }
    s.t = (Date.now() - t0) / 1000;
    samples.push(s);
  }
  const log = await page.evaluate(() => Log.lines(false)).catch(() => []);
  await ctx.close();

  // Moving = the playhead advanced since the last sample.
  let first = null, moving = 0, counted = 0, freeze = 0, freezes = [], maxFreeze = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dt = b.t - a.t;
    const moved = b.pos - a.pos > 0.05 || (b.pos < a.pos - 1);       // a jump back is a reconnect that played
    if (moved && first === null) first = a.t;
    if (first === null) continue;
    counted += dt;
    if (moved) { moving += dt; if (freeze >= 1) { freezes.push(+freeze.toFixed(1)); maxFreeze = Math.max(maxFreeze, freeze); } freeze = 0; }
    else freeze += dt;
  }
  if (freeze >= 1) { freezes.push(+freeze.toFixed(1)); maxFreeze = Math.max(maxFreeze, freeze); }
  const count = re => log.filter(l => re.test(l)).length;
  const last = samples[samples.length - 1] || {};
  return {
    id, firstPicture: first === null ? null : +first.toFixed(1),
    moving: counted ? +(100 * moving / counted).toFixed(1) : 0,
    freezes: freezes.length, freezeSecs: +freezes.reduce((a, b) => a + b, 0).toFixed(1), maxFreeze: +maxFreeze.toFixed(1),
    reconnects: count(/Reconnect \d+\//), refills: count(/Buffer ran dry/), engineSwitches: count(/Trying the /), nudges: count(/nudging the decoder/),
    gaveUp: count(/Gave up after|No player could open/), endState: last.state || '', errors,
    tail: log.filter(l => /player/.test(l)).slice(-6)
  };
}

(async () => {
  const MODES = (() => { try { return require('../mock/chaos').MODES; } catch (e) { return []; } })();
  const name = id => (MODES.find(m => m[0] === id) || [id, String(id)])[1];
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (let i = 0; i < run.length; i += PAR) {
    const batch = run.slice(i, i + PAR);
    console.log('playing ' + batch.map(name).join(', ') + ' for ' + SECS + 's (profile ' + PROFILE + ')');
    results.push(...await Promise.all(batch.map(id => one(browser, id).catch(e => ({ id, failed: e.message })))));
  }
  await browser.close();
  console.log('\n' + 'stream'.padEnd(22) + 'first  moving  freezes  total  longest  reconn  refill  switch  end');
  results.forEach(r => {
    if (r.failed) return console.log(name(r.id).padEnd(22) + 'harness failed: ' + r.failed);
    console.log(name(r.id).padEnd(22) + String(r.firstPicture == null ? '-' : r.firstPicture + 's').padEnd(7) + (r.moving + '%').padEnd(8) + String(r.freezes).padEnd(9) +
      (r.freezeSecs + 's').padEnd(7) + (r.maxFreeze + 's').padEnd(9) + String(r.reconnects).padEnd(8) + String(r.refills).padEnd(8) + String(r.engineSwitches).padEnd(8) + r.endState +
      (r.gaveUp ? '  GAVE UP' : '') + (r.errors.length ? '  ERRORS: ' + r.errors.join(' | ').slice(0, 200) : ''));
  });
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
})();
