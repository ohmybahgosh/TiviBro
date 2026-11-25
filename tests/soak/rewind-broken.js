/* A rewind buffer that fails (issue #180: a WebDAV share refused its pieces): the channel plays straight from the
   provider, and the buffer rests a while, so the next channel doesn't try it again and stall the same way.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/rewind-broken.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
  try {
    // A buffer that starts, then is gone (the helper stopped it: every piece refused).
    await ev(() => {
      window.__starts = 0; window.__plays = [];
      Store.settings.rewindBuffer = 10; Store.settings.livePause = true;
      Record.canBuffer = () => true; Record.canPause = () => true;
      Record.tsStart = () => { window.__starts++; return Promise.resolve({ id: 'tdead', playlist: '/record/ts/tdead/live.m3u8' }); };
      Record.tsPing = () => Promise.reject(Object.assign(new Error('HTTP 404'), { gone: true }));
      Record.tsStop = () => Promise.resolve({});
      const play = Player.play; Player.play = function (c, o) { window.__plays.push(o && o.tshift ? 'buffer' : 'direct'); return play.apply(this, arguments); };
    });
    const chans = await ev(() => Library.channels(Library.ALL).slice(0, 2).map((c) => c.k));
    await ev((k) => Views.startChannel(Library.find(k), false, function () { Views.goFull(); }), chans[0]);
    await wait(1500);
    ok('the channel starts on the buffer', await ev(() => window.__starts >= 1 && window.__plays.indexOf('buffer') >= 0), await ev(() => JSON.stringify([window.__starts, window.__plays])));
    await wait(4000);
    ok('the buffer gone: the same channel plays straight from the provider', await ev(() => window.__plays[window.__plays.length - 1] === 'direct'), await ev(() => JSON.stringify(window.__plays)));
    const before = await ev(() => window.__starts);
    await ev((k) => Views.startChannel(Library.find(k), false, function () { Views.goFull(); }), chans[1]);
    await wait(2000);
    ok('the next channel doesn\'t try the buffer again (it rests)', await ev((n) => window.__starts === n && window.__plays[window.__plays.length - 1] === 'direct', before), await ev(() => JSON.stringify([window.__starts, window.__plays])));
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all rewind buffer failure checks passed');
  process.exit(fails ? 1 : 0);
})();
