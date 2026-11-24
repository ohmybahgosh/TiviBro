/* A 1 GB TV with a big list, started again with its list kept from the last load (where issues #140, #141, #146,
   #153 and #171 close: 15 to 45 s after the start, nothing playing): the page's memory every 250 ms for the
   first 70 s, with what the log says happened when, so the step that costs most stands out.
     MOCK_BIG=57000 MOCK_BIG_EPG=20000 MOCK_BIG_VOD=65000 MOCK_PORT=8092 node tests/mock/mock_provider.js &
     node tests/mock/relay_dev.js &   npm run serve &
     node tests/soak/lowmem-start.js            (LOWMEM_SECS=70, LOWMEM_CEIL_MB to fail above a peak)
   Headless Chromium is not a TV: the numbers are what this page holds, for comparing one build with another. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const SECS = +process.env.LOWMEM_SECS || 70, CEIL = +process.env.LOWMEM_CEIL_MB || 0;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { id: 'big', name: 'Big', server: 'http://127.0.0.1:' + (process.env.MOCK_A || 8092), providerEpg: 'short', pubEpg: { on: false }, plRefresh: 0 });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl], active: 'big' } })[0]);
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 }));
  // First start: the list is read from the provider and kept (as on a TV that has used TiviBro before).
  let tv = await ctx.newPage();
  await tv.goto(APP);
  await tv.waitForFunction(() => window.Library && Library.count() > 50000, null, { timeout: 240000 });
  await tv.waitForTimeout(60000);                  // guide and logos done, everything kept
  await tv.close();
  // Again: what a TV does at every start.  Sampled from inside the page, with the log's lines.
  tv = await ctx.newPage();
  const errs = []; tv.on('pageerror', (e) => errs.push(e.message));
  await tv.addInitScript(() => {
    const t0 = Date.now(); window.__mem = [];
    setInterval(() => { const m = performance.memory; if (m) window.__mem.push([Date.now() - t0, Math.round(m.usedJSHeapSize / 1048576)]); }, 250);
    window.__t0 = t0;
  });
  /* The helper's memory too (LOWMEM_HELPER_PID: relay_dev's process, Linux): on a 1 GB TV it shares the memory
     with the page, and webOS closes the app in front when the TV runs short. */
  const hp = +process.env.LOWMEM_HELPER_PID || 0, fs = require('fs'), helper = [], h0 = Date.now();
  const rss = () => { try { return Math.round(+/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + hp + '/status', 'utf8'))[1] / 1024); } catch (e) { return 0; } };
  const hTimer = hp ? setInterval(() => helper.push([Date.now() - h0, rss()]), 250) : null;
  await tv.goto(APP);
  await tv.waitForTimeout(SECS * 1000);
  if (hTimer) clearInterval(hTimer);
  const r = await tv.evaluate(() => {
    const lines = (window.Log ? Log.lines(true) : []).map((l) => l.replace(/\s+/g, ' ').slice(0, 110));
    return { mem: window.__mem, lines, count: Library.count() };
  });
  // The heap in 5 s steps (the highest in each), and the log lines between.
  const peak = r.mem.reduce((a, x) => (x[1] > a[1] ? x : a), [0, 0]);
  console.log('channels ' + r.count + ', peak ' + peak[1] + ' MB at ' + (peak[0] / 1000).toFixed(1) + ' s');
  for (let s = 0; s < SECS; s += 5) {
    const w = r.mem.filter((x) => x[0] >= s * 1000 && x[0] < (s + 5) * 1000);
    if (w.length) console.log(String(s).padStart(3) + 's  ' + String(Math.max.apply(null, w.map((x) => x[1]))).padStart(4) + ' MB  ' + '#'.repeat(Math.round(Math.max.apply(null, w.map((x) => x[1])) / 10)));
  }
  if (helper.length) {
    const hpk = helper.reduce((a, x) => (x[1] > a[1] ? x : a), [0, 0]);
    console.log('helper: ' + helper[0][1] + ' MB at the start, peak ' + hpk[1] + ' MB at ' + (hpk[0] / 1000).toFixed(1) + ' s');
    for (let s = 0; s < SECS; s += 5) { const w = helper.filter((x) => x[0] >= s * 1000 && x[0] < (s + 5) * 1000); if (w.length) console.log(String(s).padStart(3) + 's  helper ' + String(Math.max.apply(null, w.map((x) => x[1]))).padStart(4) + ' MB'); }
  }
  console.log('--- log');
  r.lines.filter((l) => !/Memory-safe: holding/.test(l)).slice(-60).forEach((l) => console.log('  ' + l));
  ok('the list opens', r.count > 50000, r.count);
  ok('no page errors', !errs.length, errs.join(' | '));
  if (CEIL) ok('the peak stays under ' + CEIL + ' MB', peak[1] <= CEIL, peak[1]);
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
