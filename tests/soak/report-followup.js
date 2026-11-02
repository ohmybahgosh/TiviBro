/* Following up problem reports (app/js/reports.js): the TV keeps the reports it sent, asks the relay
   for news, shows a reply once (with Update when the fix is newer, Still happening, and a code for the
   phone), sends Still happening with a fresh log, and lists them under Settings > Diagnostics.
     node tests/soak/report-followup.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const setIssue = (n, v) => fetch(MOCK + '/mock-issue?n=' + n + '&v=' + encodeURIComponent(JSON.stringify(v)));
(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function start(state) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1920, height: 1080 } }, state ? { storageState: state } : {}));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    if (!state) await page.addInitScript(R.init({ time: Date.now() })[0]);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    await page.evaluate(m => { Store.settings.relayConfig = m + '/relay.json'; }, MOCK);
    return { ctx, page, ev: (f, a) => page.evaluate(f, a) };
  }
  const modal = (ev) => ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\n+/g, ' | ') : ''; });
  const key = async (page, k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(250); } };

  const a = await start();
  await setIssue(42, {});
  // 1. A report sent from the TV is kept, with the relay's key.
  await a.ev(() => Diag.sendNow('TiviBro closed unexpectedly last time', 'while loading the guide'));
  const kept = await a.ev(() => Reports.list.map(r => ({ n: r.n, key: r.key, title: r.title, version: r.version })));
  ok('a report sent from the TV is kept with its key', kept.length === 1 && kept[0].n === 42 && kept[0].key === 'a'.repeat(32) && /closed unexpectedly/.test(kept[0].title), JSON.stringify(kept));
  // 2. No reply yet: nothing shows.
  await a.ev(() => Reports.check(true)); await a.page.waitForTimeout(800);
  ok('no news, nothing shows', !(await modal(a.ev)), await modal(a.ev));
  const asked = await (await fetch(MOCK + '/status-asked')).json();
  ok('only the report numbers are asked about', asked[asked.length - 1] === '42', JSON.stringify(asked));
  ok('Settings lists it: open, no reply yet', await a.ev(() => Reports.statusText(Reports.list[0])) === 'Open, no reply yet');

  // 3. The developer replies, naming a newer version.
  await setIssue(42, { reply: { id: 101, at: '2026-11-02T11:00:00Z', text: 'Thanks for the report.  This is fixed in 0.9.9-alpha.1: big playlists no longer run the TV out of memory.' }, fixed: '0.9.9-alpha.1' });
  await a.ev(() => Reports.check(true)); await a.page.waitForTimeout(1000);
  let m = await modal(a.ev);
  ok('the reply shows once, by itself', /Your problem report #42/.test(m) && /The developer replied, fix in 0\.9\.9-alpha\.1/.test(m) && /fixed in 0\.9\.9-alpha\.1: big playlists/.test(m), m);
  ok('with Update, Still happening, OK and a code for the phone', /Update to 0\.9\.9-alpha\.1/.test(m) && await a.ev(() => [].slice.call(document.querySelectorAll('#modal .mbtns .btn')).map(x => x.textContent).join('|')) === 'Update to 0.9.9-alpha.1|Still happening|OK' && /Scan to read it all/.test(m) && await a.ev(() => !!document.querySelector('#modal .rep-qr svg')), m);
  // Still happening, with the log.
  await key(a.page, 'ArrowRight'); await key(a.page, 'Enter');
  m = await modal(a.ev);
  ok('Still happening asks first, Cancel focused', /Tell the developer it still happens\?/.test(m) && /Send with the log/.test(m) && /Add a note first/.test(m) && await a.ev(() => /Cancel/.test(document.querySelector('#modal .mi.focus').textContent)), m);
  await key(a.page, 'ArrowUp', 2); await key(a.page, 'Enter');
  await a.page.waitForFunction(() => /Sent, thank you/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  const f = await (await fetch(MOCK + '/last-followup')).json();
  ok('it sends the report\'s number, key and a fresh log', f.n === 42 && f.key === 'a'.repeat(32) && /^# TiviBro problem report/.test(f.log || '') && /still happens/.test(f.what) && /^\d+\.\d+\.\d+/.test(f.version), JSON.stringify(Object.assign({}, f, { log: (f.log || '').slice(0, 40) })));
  ok('and says so', await a.ev(() => /Sent, thank you\.\s+The developer sees it on report #42, which is open again/.test(document.body.innerText)));
  // The same reply never shows twice.
  await a.page.waitForTimeout(1500);
  await a.ev(() => Reports.check(true)); await a.page.waitForTimeout(1000);
  ok('a reply already seen does not show again', !/Your problem report/.test(await modal(a.ev)), await modal(a.ev));

  // 4. Kept across restarts; a newer reply and the close show next time.
  const st = await a.ctx.storageState(); await a.ctx.close();
  await setIssue(42, { state: 'closed', reason: 'completed', reply: { id: 102, at: '2026-11-03T09:00:00Z', text: 'Closing this: the reporter says it is fixed.' }, fixed: '0.9.9-alpha.1' });
  const c = await start(st);
  ok('the reports are kept across restarts', await c.ev(() => Reports.list.length === 1 && Reports.list[0].seen.reply === 101));
  await c.page.waitForTimeout(1500);
  await c.ev(() => { UI.close && UI.close(); return Reports.check(true); }); await c.page.waitForTimeout(1200);
  m = await modal(c.ev);
  ok('a newer reply and the close show', /Fixed in 0\.9\.9-alpha\.1/.test(m) && /Closing this/.test(m), m);
  await key(c.page, 'Escape');
  // A newer version with the fix already in: no Update button.
  await c.ev(() => { Reports.list[0].fixed = '0.0.1'; Reports.list[0].seen = {}; Reports.show(42); }); await c.page.waitForTimeout(600);
  m = await modal(c.ev);
  ok('no Update when this TV already has the fix', !/Update to/.test(m) && /Still happening/.test(m), m);
  await c.ev(() => UI.close && UI.close());
  // 5. Settings > Diagnostics > Your problem reports.
  const rows = await c.ev(() => { Views.switchTab('settings'); Settings.section('diag'); return [].slice.call(document.querySelectorAll('.opt .ol')).map(x => x.textContent); });
  ok('Settings > Diagnostics has Your problem reports', rows.some(t => /^Your problem reports/.test(t)), rows.join(' | ').slice(0, 300));
  // 6. A key that is not the TV's is refused, and the TV says so.
  await c.ev(() => { Reports.list[0].key = 'x'.repeat(32); });
  const bad = await c.ev(() => Diag.followup(42, Reports.list[0].key, 'x').then(() => 'sent', e => e.message));
  ok('a wrong key is refused', /not from this TV/.test(bad), bad);
  await c.ctx.close();

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all report follow-up checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
