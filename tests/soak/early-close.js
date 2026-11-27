/* TiviBro closed 30 to 60 s after starting, every start, while the last channel played and the guide and the logo
   library loaded (webOS 6 TVs, issues #194 and #195).  The start after such a close loads them first and starts the
   last channel 50 s in; after a close long after starting, the last channel starts at once as before.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/early-close.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// The last session as log.js leaves it when the TV closes TiviBro: still open, playing, up ms after it started.
function closed(up) {
  return `(() => {
    if (sessionStorage.getItem('closedSet')) return;
    sessionStorage.setItem('closedSet', '1');
    const t = Date.now() - 60000;
    localStorage.setItem('tivibro.alive', JSON.stringify({ s: 'old', v: window.TIVIBRO_VERSION, t0: t - ${up}, t: t, open: true, doing: { player: 'Playing x1' }, heap: 0 }));
    const e = JSON.parse(localStorage.getItem('tivibro.edits.p1') || '{}'); e.last = 'x1'; localStorage.setItem('tivibro.edits.p1', JSON.stringify(e));
  })();`;
}
async function start(b, up) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(R.init({ time: Date.now(), settings: { resumeLast: true } })[0]);
  await ctx.addInitScript(closed(up));
  const tv = await ctx.newPage(), errs = [];
  tv.on('pageerror', (e) => errs.push(e.message));
  await tv.goto(APP);
  await tv.waitForFunction(() => window.__tbBooted, null, { timeout: 60000 });
  return { ctx, tv, errs };
}
const playing = (tv) => tv.evaluate(() => !!(window.Views && Views.playing));
const logged = (tv, re) => tv.evaluate((s) => Log.lines(true).filter((l) => new RegExp(s).test(l)), re);

(async () => {
  const b = await chromium.launch();
  // Closed 40 s after starting: the channel waits, the guide and logos go first.
  let s = await start(b, 40000);
  await s.tv.waitForTimeout(8000);
  ok('after an early close: the crash is seen', (await logged(s.tv, 'closed unexpectedly last time')).length === 1);
  ok('…the last channel waits', !(await playing(s.tv)) && (await logged(s.tv, 'the last channel starts in 50 s')).length === 1, (await logged(s.tv, 'app ')).join('\n'));
  await s.tv.waitForTimeout(50000);
  ok('…and starts once the guide and logos are in', await playing(s.tv));
  ok('no page errors', !s.errs.length, s.errs.join('; '));
  await s.ctx.close();
  // Closed ten minutes after starting: the last channel at once, as always.
  s = await start(b, 600000);
  await s.tv.waitForTimeout(8000);
  ok('after a close long after starting: the last channel at once', (await playing(s.tv)) && !(await logged(s.tv, 'the last channel starts in')).length);
  await s.ctx.close();
  await b.close();
  console.log(fails ? fails + ' failures' : 'all early close checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
