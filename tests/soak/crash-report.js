/* Crashes get reported (alpha 24 closed over and over on a C2 and nothing said so).
     node tests/soak/crash-report.js      (mock provider on :8077, npm run serve)
   webOS closes an app that runs out of memory without an error, so the app keeps a marker of what it
   is doing.  A session that ends with the marker still open is a crash: the next start asks to report
   it, says what it was doing, and the report carries that.  A normal exit asks nothing.  Test builds
   have Report a problem in the menu. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function start(state, init) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1920, height: 1080 } }, state ? { storageState: state } : {}));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    if (init) await page.addInitScript(init);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    return { ctx, page, ev: (f, a) => page.evaluate(f, a) };
  }
  const menuText = (ev) => ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\n+/g, ' | ') : ''; });

  // 1. A session that dies while loading a guide (as webOS does when memory runs out).
  const a = await start(null, R.init({ time: Date.now() })[0]);
  await a.page.waitForTimeout(1500);
  await a.page.waitForFunction(() => Epg.status.at && !Epg.loading, null, { timeout: 60000 });
  await a.ev(() => Log.state('guide', 'loading the guide from iptv-epg.org (2 of 3), 45%'));
  await a.page.waitForTimeout(2500);
  const crashed = await a.ctx.storageState();             // the storage as it was when the app was killed
  await a.ctx.close();

  const c = await start(crashed);
  ok('the next start knows the last session closed unexpectedly', await c.ev(() => !!Log.unclean && /iptv-epg\.org/.test(Log.unclean.text)), await c.ev(() => JSON.stringify(Log.unclean)));
  await c.page.waitForTimeout(5000);
  const m = await menuText(c.ev);
  ok('it asks to report it, saying what it was doing', /closed unexpectedly/.test(m) && /Report it/.test(m) && /iptv-epg/.test(m), m);
  ok('the log says so too', await c.ev(() => Log.lines().some(l => /ERROR .*closed unexpectedly last time, while loading the guide from iptv-epg\.org/.test(l))));
  const rep = await c.ev(() => Diag.report().then(r => ({ facts: r.facts.map(f => f.join(': ')).join(' | '), log: /closed unexpectedly/.test(r.text) })));
  ok('the report carries it', /Last session: closed unexpectedly, while loading the guide/.test(rep.facts) && rep.log, rep.facts.slice(0, 300));
  await c.page.keyboard.press('Enter'); await c.page.waitForTimeout(1500);
  const qr = await c.ev(() => document.body.innerText);
  ok('Report it opens the Report a problem code', /Report a problem/.test(qr) && /Scan the code/.test(qr), qr.slice(0, 120));
  // Asked once: a restart of this (healthy) session asks nothing.
  await c.ev(() => Log.closing());
  const fine = await c.ctx.storageState(); await c.ctx.close();
  const d = await start(fine);
  await d.page.waitForTimeout(5000);
  ok('a normal exit asks nothing next time', !(await d.ev(() => Log.unclean)) && !/closed unexpectedly/.test(await menuText(d.ev)), await menuText(d.ev));
  // Test builds: Report a problem in the menu.
  await d.ev(() => { TIVIBRO_VERSION = '0.6.0-alpha.99'; Views.buildTabs(); });
  const tabs = await d.ev(() => [].slice.call(document.querySelectorAll('.tab .lbl')).map(x => x.textContent));
  ok('test builds have Report a problem in the menu', tabs.indexOf('Report a problem') >= 0, tabs.join(', '));
  await d.ctx.close();

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all crash report checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
