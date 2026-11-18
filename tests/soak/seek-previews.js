/* Seek previews right after a movie starts, as a viewer does it: play, then seek straight away to where you left
   off (Bob: "all previews of seek are empty").  Pictures for the movie in eighths are made from a few seconds
   in, a seek shows the nearest one at once (dimmed) and its own when it comes, and fast presses in a row end
   on their own picture.
     node tests/mock/mock_provider.js &
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg npm run serve &
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg node tests/soak/seek-previews.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 }); await page.waitForTimeout(1000);
  const ev = (f, a) => page.evaluate(f, a);
  const state = () => ev(() => { const b = document.querySelector('.seekprev'); const i = b && b.querySelector('img'); return { has: !!(b && b.classList.contains('has')), wait: !!(b && b.classList.contains('wait')), t: i && i._t, hidden: !b || b.classList.contains('hidden') }; });
  try {
    await ev(() => { Store.settings.seekPreviews = 'on'; });
    await ev((m) => Views.playVod({ id: 'seek1', title: 'Seek test', item: { name: 'Seek test' } }, m + '/movie/seek.mp4', 0, function () {}), MOCK);
    await page.waitForFunction(() => Player.playing && document.getElementById('video').currentTime > 1, null, { timeout: 30000 });
    const avail = await page.waitForFunction(() => SeekPrev.available !== null, null, { timeout: 15000 }).then(() => ev(() => SeekPrev.available), () => null);
    if (!avail) { console.log('SKIP the service has no converter that makes pictures here'); await b.close(); process.exit(0); }
    // Seconds after the start: seek to 1:30, in fast presses (as the remote's ◀ ▶ do), and stop there.
    await page.waitForTimeout(6000);
    const d = await ev(() => document.getElementById('video').duration);
    for (let t = 20; t <= 90; t += 10) { await ev((a) => SeekPrev.show(a.t, a.d, 1), { t, d }); await page.waitForTimeout(60); }
    const first = await state();
    ok('a fast seek right after the start shows a picture at once (the nearest one made already)', first.has, JSON.stringify(first));
    await page.waitForFunction(() => { const i = document.querySelector('.seekprev img'); return i && i._t === 90 && !document.querySelector('.seekprev').classList.contains('wait'); }, null, { timeout: 15000 }).catch(() => {});
    const last = await state();
    ok('...and then its own picture, where the presses stopped', last.has && last.t === 90 && !last.wait, JSON.stringify(last));
    await ev(() => SeekPrev.hide());
    // A long jump back to where you left off (the movie in eighths is made by now).
    await page.waitForTimeout(4000);
    await ev((a) => SeekPrev.show(a.t, a.d, -1), { t: 44, d });
    const jump = await state();
    ok('a long jump: a picture straight away', jump.has, JSON.stringify(jump));
    await ev(() => { SeekPrev.hide(); Player.stop(); });
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all seek preview checks passed');
  process.exit(fails ? 1 : 0);
})();
