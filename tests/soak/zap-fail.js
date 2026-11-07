/* Channels that don't play, told quickly (issue #56), and zapping through them with good ones without the
   app holding on to more each time (issue #61: closed on a 1 GB TV after zapping among 404s and bad HLS).
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/zap-fail.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  // A channel object pointing where we want: a copy of a real one with another address.
  const fake = (url, k) => ev(([u, k]) => { const c = Object.assign({}, Library.channels(Library.ALL)[0], { k: k, n: 'Test ' + k }); window.__c = c; Player.play(c, { url: u }); return true; }, [url, k]);
  const until = (pred, ms) => page.waitForFunction(pred, null, { timeout: ms }).then(() => true, () => false);
  try {
    await ev(() => { Store.settings.format = 'ts'; });
    // 1. 404: the provider doesn't have it.  An error within a few seconds, not ~15 s per pipeline.
    await ev(() => { window.__st = ''; Player.on('state', (s) => { window.__st = s; }); window.__logs = []; const w = Log.warn, i = Log.info; Log.warn = function (s, t) { window.__logs.push(t); return w.apply(Log, arguments); }; Log.info = function (s, t) { window.__logs.push(t); return i.apply(Log, arguments); }; });
    let t0 = Date.now();
    await fake(MOCK + '/live/u/p/40401.ts', 'dead404');
    const err404 = await until(() => window.__st === 'error', 20000);
    const t404 = (Date.now() - t0) / 1000;
    const tries404 = (await ev(() => window.__logs)).filter((l) => /^Start "Test dead404"/.test(l));
    ok('a channel the provider answers 404 for is given up within a few seconds: one try, and its HLS version once', err404 && t404 < 8 && tries404.length <= 2, t404.toFixed(1) + ' s, ' + tries404.length + ' tries');
    // 2. An .m3u8 address that sends something that isn't a playlist (HTTP 200): not HLS, no HLS retries.
    await ev(() => { window.__logs = []; window.__st = ''; });
    t0 = Date.now();
    await fake(MOCK + '/live/u/p/40501.m3u8', 'notHls');
    const done2 = await until(() => window.__st === 'error' || window.__st === 'playing', 30000);
    const logs = await ev(() => window.__logs);
    const hlsTries = logs.filter((l) => /^Start .* with hls engine/.test(l)).length;
    ok('an .m3u8 that isn\'t a playlist: HLS is tried once, then the next player', done2 && hlsTries <= 1 && logs.some((l) => /not an HLS playlist/.test(l)), hlsTries + ' hls tries; ' + logs.filter((l) => /hls|HLS/.test(l)).slice(0, 4).join(' | '));
    // 3. Zapping: good and failing channels in turn, 24 times.  Memory and leftovers stay level.
    const good = await ev(() => Library.channels(Library.ALL).slice(0, 6).map((c) => c.k));
    const heap = () => ev(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });
    const zap = async (n) => {
      for (let i = 0; i < n; i++) {
        if (i % 3 === 2) await fake(MOCK + (i % 2 ? '/live/u/p/4040' + (i % 10) + '.ts' : '/live/u/p/4050' + (i % 10) + '.m3u8'), 'dead' + i);
        else await ev((k) => { Player.play(Library.find(k)); }, good[i % good.length]);
        await page.waitForTimeout(1200);
      }
      await ev(() => Player.stop()); await page.waitForTimeout(1500);
    };
    await zap(6);
    const h0 = await heap();
    await zap(24);
    const h1 = await heap();
    const left = await ev(() => ({ videos: document.querySelectorAll('video').length, ms: (window.__msCount || 0), timers: 0 }));
    ok('24 zaps among good and failing channels: memory stays about level', !h0 || h1 - h0 < 12e6, ((h1 - h0) / 1e6).toFixed(1) + ' MB more (' + (h0 / 1e6).toFixed(1) + ' to ' + (h1 / 1e6).toFixed(1) + ')');
    ok('and no video elements left behind', left.videos <= 2, JSON.stringify(left));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all zap failure checks passed');
  process.exit(fails ? 1 : 0);
})();
