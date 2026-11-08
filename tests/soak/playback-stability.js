/* Playback against a strict provider: one connection per account at a time (MOCK_ONE_REQUEST), the way some
   IPTV panels count them.
     MOCK_ONE_REQUEST=1 MOCK_RADIO=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/playback-stability.js
   - Zapping quickly through channels: each one plays, none refused because the last one still held the
     connection (the helper lets go of an older live channel on the same account; the app's player lets go
     of a stalled request).
   - A radio station (sound only) plays at once, instead of waiting for a picture that never comes. */
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
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [Object.assign({}, R.SETTINGS.playlists[0], { plRefresh: -1 })] } })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => Library.data.channels.some((c) => c.n === 'Radio Test FM'), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Is the picture (or the sound's clock) moving on the channel asked for?
  const moving = (k, ms) => page.waitForFunction(([k, t0]) => {
    const v = document.querySelector('video');
    if (!Views.playing || Views.playing.k !== k || !v) return false;
    if (window.__mv && window.__mv.k === k && v.currentTime > window.__mv.t + 0.5) return true;
    if (!window.__mv || window.__mv.k !== k) window.__mv = { k, t: v.currentTime };
    return false;
  }, [k, Date.now()], { timeout: ms, polling: 250 }).then(() => true, () => false);
  try {
    const keys = await ev(() => Library.channels(Library.ALL).filter((c) => /^US\| /.test(c.n)).slice(0, 6).map((c) => [c.k, c.n]));
    const times = [];
    for (let i = 0; i < keys.length; i++) {
      // Zapping: the next one asked for while the last one is still streaming.
      await ev(() => { window.__mv = null; });
      const t0 = Date.now();
      await ev((k) => { Views.switchTab('live'); Views.startChannel(Library.find(k), false); }, keys[i][0]);
      const ok1 = await moving(keys[i][0], 15000);
      times.push(ok1 ? Date.now() - t0 : -1);
      await page.waitForTimeout(i % 2 ? 400 : 1500);
    }
    ok('zapping on a one-connection provider: every channel plays', times.every((t) => t > 0), JSON.stringify(times));
    ok('and quickly (under 6 s each)', times.every((t) => t > 0 && t < 6000), JSON.stringify(times));
    const refused = await ev(() => (Log.lines ? Log.lines() : []).filter((l) => /HTTP 503/.test(l.msg || l)).length).catch(() => -1);
    ok('none refused as busy along the way', refused === 0, refused);

    // Radio: sound only.
    const radio = await ev(() => { const c = Library.data.channels.find((x) => x.n === 'Radio Test FM'); return c && c.k; });
    if (!radio) ok('the mock has the radio station (MOCK_RADIO=1)', false);
    else {
      await ev(() => { window.__mv = null; });
      const t0 = Date.now();
      await ev((k) => Views.startChannel(Library.find(k), false), radio);
      const played = await moving(radio, 12000);
      ok('a radio station (sound only) plays', played, Date.now() - t0);
      ok('and starts within 5 s, not after a fallback', played && Date.now() - t0 < 5000, Date.now() - t0);
    }
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all playback stability checks passed');
  process.exit(fails ? 1 : 0);
})();
