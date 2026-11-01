/* A live channel that drops for a moment: the last picture stays on screen with a small "Reconnecting"
   instead of a black screen and "Tuning", it goes when the picture is back, a new channel never shows
   the old one's picture, and a channel that keeps dropping on MPEG-TS tries its HLS version early.
     node tests/soak/hold-frame.js      (mock provider on :8077, the dev relay, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await ev(() => { Store.settings.format = 'ts'; Store.settings.engine = 'auto'; var c = Library.channels(Library.ALL)[0]; Views.startChannel(c, false, Views.goFull); });
  const playingNow = () => page.waitForFunction(() => Player.stats && Player.stats.state === 'playing' && document.getElementById('video').currentTime > 0.5, null, { timeout: 30000 }).then(() => true, () => false);
  ok('the channel plays', await playingNow());
  await page.waitForTimeout(1500);
  const kind0 = await ev(() => Player._test.kind);
  await ev(() => Player._test.reconnect('a drop, for the test'));
  await page.waitForTimeout(150);
  const during = await ev(() => ({ held: Player._test.holding, canvas: !!document.querySelector('.vid-hold.on'), text: document.getElementById('spinnerText').textContent, spin: !document.getElementById('spinner').classList.contains('hidden') }));
  ok('a drop keeps the last picture on screen, with a small notice, not Tuning', during.held && during.canvas && during.spin && during.text !== 'Tuning', JSON.stringify(during));
  ok('the picture comes back and the held one goes', await playingNow() && await ev(() => !Player._test.holding && !document.querySelector('.vid-hold.on')));
  // Two more drops within three minutes on MPEG-TS: the HLS version is tried.
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(1500); await ev(() => Player._test.reconnect('another drop')); await page.waitForTimeout(300); if (i === 0) await playingNow(); }
  const lines = await ev(() => Log.lines(false).join('\n'));
  ok('three drops in three minutes on MPEG-TS: its HLS version is tried', kind0 === 'ts' && /dropped 3 times in 3 minutes on MPEG-TS; trying its HLS version/.test(lines), kind0);
  await ev(() => { var c = Library.channels(Library.ALL)[3]; Store.settings.holdFrame = true; Views.startChannel(c, false); });
  await page.waitForTimeout(200);
  ok('a new channel never shows the last one\'s picture', await ev(() => !document.querySelector('.vid-hold.on')));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all held picture checks passed');
  process.exit(fails ? 1 : 0);
})();
