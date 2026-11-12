/* Settings > Appearance > Clock (discussion #71), and deleting the only playlist on the TV (discussion #36).
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/clock-delete.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const run = async (locale) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(R.init({ time: Date.now() })[0]);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    return { page, ctx, errs, ev: (f, a) => page.evaluate(f, a) };
  };
  const t = new Date(2026, 10, 11, 19, 30).getTime();
  // An English TV in the US: 12 hours; in Poland or the UK: 24 hours, unless the setting says.
  let x = await run('en-US');
  const us = await x.ev((t) => [U.hhmm(t), (Store.settings.clock = '24', U.hhmm(t)), (Store.settings.clock = '12', U.hhmm(t)), (Store.settings.clock = 'auto', U.hhmm(t))], t);
  ok('Clock: Automatic on a US TV is 12 hours, and 24 or 12 hours when set', us[0] === '7:30pm' && us[1] === '19:30' && us[2] === '7:30pm' && us[3] === '7:30pm', JSON.stringify(us));
  await x.ev(() => { Views.switchTab('settings'); Settings.open(); Settings.section('look'); }); await x.page.waitForTimeout(400);
  const row = await x.ev(() => Settings.phone.page('look', []).rows.find((r) => r.label === 'Clock'));
  ok('Settings > Appearance has the Clock choice', row && /Automatic/.test(row.value || ''), JSON.stringify(row));
  ok('no page errors (US)', !x.errs.length, x.errs.join(' | '));
  await x.ctx.close();
  x = await run('pl-PL');
  const pl = await x.ev((t) => U.hhmm(t), t);
  ok('Clock: Automatic on a TV in Poland is 24 hours, the menus in English', pl === '19:30', pl);

  // Deleting the only playlist: TiviBro starts again on the screen that adds one.
  await x.ev(() => { Views.switchTab('settings'); Settings.open(); Settings.section('playlists'); }); await x.page.waitForTimeout(400);
  // The playlist's own page and its Delete row, as the phone and the TV build them.
  const found = await x.ev(() => {
    const walk = (path, depth) => {
      const rows = Settings.phone.page('playlists', path).rows || [];
      const d = rows.findIndex((r) => r.label === 'Delete this playlist');
      if (d >= 0) return { path, i: d, sub: rows[d].sub };
      if (depth > 2) return null;
      for (let i = 0; i < rows.length; i++) if (rows[i].kind === 'page' || rows[i].page || rows[i].phonePage) { const f = walk(path.concat([i]), depth + 1); if (f) return f; }
      return null;
    };
    return walk([], 0);
  });
  ok('the only playlist has Delete this playlist, saying TiviBro starts again', !!found && /only playlist/.test(found.sub || ''), JSON.stringify(found));
  if (found) {
    // As from the phone: the button, then Yes to the question it asks.
    const asked = await x.ev(async (d) => { const r = await Settings.phone.change('playlists', d.path, d.i, 'action', {}); const q = r && r.dialog; if (q) setTimeout(() => Settings.phone.change('playlists', d.path, d.i, 'answer', { dialog: q.id }), 50); return q ? q.title : JSON.stringify(r).slice(0, 300); }, found);
    ok('it asks first, saying it is the only one', /only one/.test(asked || ''), asked);
    await x.page.waitForTimeout(4000);
    await x.page.waitForFunction(() => window.Store && document.getElementById('viewSetup'), null, { timeout: 30000 });
    const st = await x.ev(() => ({ n: Store.settings.playlists.length, setup: !document.getElementById('viewSetup').classList.contains('hidden') }));
    ok('deleting it starts TiviBro again on the screen that adds a playlist', st.n === 0 && st.setup, JSON.stringify(st));
  }
  ok('no page errors', !x.errs.length, x.errs.join(' | '));
  await x.ctx.close();
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all clock and delete checks passed');
  process.exit(fails ? 1 : 0);
})();
