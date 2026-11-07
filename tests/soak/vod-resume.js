/* A movie that reconnects continues from where it got to, never from further back (issue #57: a resume at
   3110 s, then every reconnect went back to 2828 s, the time the TV player was reporting).
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/vod-resume.js */
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
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1000);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await ev((m) => { window.__logs = []; const w = Log.warn, i = Log.info; Log.warn = function (s, t) { window.__logs.push(t); return w.apply(Log, arguments); }; Log.info = function (s, t) { window.__logs.push(t); return i.apply(Log, arguments); };
      Views.playVod({ id: 'resume1', title: 'Resume test', item: { name: 'Resume test' } }, m + '/movie/resume.mp4', 40, function () {}); }, MOCK);
    await page.waitForFunction(() => Player.playing && document.getElementById('video').currentTime > 41, null, { timeout: 30000 });
    // The TV player starts reporting a time far behind (as the 32LQ630 did): 30 s behind the real one.
    await ev(() => { const v = document.getElementById('video'), d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(v, 'currentTime', { configurable: true, get() { return Math.max(0, d.get.call(this) - 30); }, set(x) { d.set.call(this, x); } }); });
    await page.waitForTimeout(6000);
    await ev(() => Player._test.reconnect('The provider closed the connection, reconnecting'));
    await page.waitForFunction(() => window.__logs.filter((l) => /^Start ".*Resume test/.test(l)).length >= 2, null, { timeout: 20000 });
    const logs = await ev(() => window.__logs);
    const from = logs.filter((l) => /^Start ".*Resume test/.test(l)).map((l) => +((/from (\d+)s/.exec(l) || [])[1] || 0));
    ok('the reconnect continues from where it got to, not from where the TV player says (about 30 s back)', from.length >= 2 && from[1] >= 45 && from[1] <= 60, JSON.stringify(from) + ' ' + logs.filter((l) => /TV player says/.test(l)).join(' | '));
    ok('and says so in the log', logs.some((l) => /The TV player says \d+s but it has played to about \d+s/.test(l)), logs.slice(-6).join(' | '));
    // You seeking back is honoured: the next reconnect starts there.
    await page.waitForFunction(() => Player.playing, null, { timeout: 20000 });
    await ev(() => { const v = document.getElementById('video'); delete v.currentTime; Player.seekTo(20); });
    await page.waitForTimeout(2500);
    await ev(() => Player._test.reconnect('The provider closed the connection, reconnecting'));
    await page.waitForFunction(() => window.__logs.filter((l) => /^Start ".*Resume test/.test(l)).length >= 3, null, { timeout: 20000 });
    const from2 = (await ev(() => window.__logs)).filter((l) => /^Start ".*Resume test/.test(l)).map((l) => +((/from (\d+)s/.exec(l) || [])[1] || 0));
    ok('after you seek back, a reconnect starts near where you went, not the old place', from2[2] >= 20 && from2[2] < 30, JSON.stringify(from2));
    await ev(() => Player.stop());
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all VOD resume checks passed');
  process.exit(fails ? 1 : 0);
})();
