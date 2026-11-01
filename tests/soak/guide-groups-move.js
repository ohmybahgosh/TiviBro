/* The guide's group panel and moving a channel from the guide.
   - Going down the group list, the highlighted group always stays whole on screen (the panel was
     built while hidden and counted more rows than fit, so one press past the last whole row hid it).
   - Hold OK on a channel > Move… moves it up and down its group, saved like in the channel list.
     node tests/soak/guide-groups-move.js      (mock provider on :8077, the dev relay, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(1200);
  // Group panel open: walk to the bottom and check the highlighted row each step.
  await page.waitForTimeout(400);      // the guide opens on its group panel
  const n = await ev(() => Library.groups().length);
  let worst = null;
  for (let i = 0; i < n + 2; i++) {
    await ev(() => UI.press('down')); await page.waitForTimeout(120);
    const r = await ev(() => {
      var host = document.getElementById('guideGroupList'), s = host.querySelector('.row.sel');
      if (!s) return { none: true };
      // Where the row sits in the list (its transform) against the list's own height: rows are moved,
      // not laid out, so this is what shows.
      var y = +((/translateY\((-?[\d.]+)px\)/.exec(s.style.transform) || [])[1] || 0), rh = 100;
      return { top: y, bottom: host.clientHeight - (y + rh), y: y, h: host.clientHeight };
    });
    if (r.none || r.top < -1 || r.bottom < -1) { worst = r; break; }
  }
  const end = await ev(() => Guide.__gsel());
  ok('the highlighted group stays whole on screen to the bottom of the list (' + n + ' groups)', !worst && end === n - 1, JSON.stringify({ worst, end }));

  // Into the grid, on a provider group, and move its first channel down two places.
  const g = await ev(() => { var g = Library.groups().filter(function (x) { return !Library.isCustom(x.id) && x.id !== Library.ALL && Library.channels(x.id).length > 3; })[0]; return g.id; });
  await ev((id) => { Views.switchTab('live'); Views.switchTab('guide'); }, g);
  await page.waitForTimeout(600);
  await ev((id) => { var gs = Library.groups(), i = gs.findIndex(function (x) { return x.id === id; }); for (var k = 0; k < 60; k++) UI.press('up'); for (var j = 0; j < i; j++) UI.press('down'); UI.press('ok'); }, g);
  await page.waitForTimeout(800);
  const before = await ev((id) => Library.channels(id).map(function (c) { return c.k; }).slice(0, 4), g);
  await ev(() => UI.press('hold')); await page.waitForTimeout(400);
  const items = await ev(() => [].map.call(document.querySelectorAll('#modal .item, #modal .opt, #modal li, #modal [class*=item]'), function (x) { return x.innerText.split('\n')[0]; }));
  const H = R.helpers(page);
  await H.pick('Move…', '', 600);
  ok('Hold OK in the guide offers Move…, and it marks the row', await ev(() => !!document.querySelector('#guideBody .grow.moving')), JSON.stringify(items));
  await ev(() => { UI.press('down'); UI.press('down'); }); await page.waitForTimeout(300);
  await ev(() => UI.press('ok')); await page.waitForTimeout(300);
  const after = await ev((id) => Library.channels(id).map(function (c) { return c.k; }).slice(0, 4), g);
  ok('▲ ▼ moved it, and OK keeps the new order', after[2] === before[0] && after[0] === before[1] && await ev((id) => Store.edits.groupSort[id] === 'custom', g), JSON.stringify({ before, after }));
  ok('the highlight followed it and move mode ended', await ev(() => Guide.__sel()) === 2 && !(await ev(() => !!document.querySelector('#guideBody .grow.moving'))));
  // Remote buttons in the guide can be changed: Red set to watch fullscreen goes fullscreen.
  ok('the guide has its own remote settings, with the old behaviour as defaults', await ev(() => Keymap.get('guide', 'red') === 'menu' && Keymap.get('guide', 'playpause') === 'full' && Keymap.CONTEXT_ACTIONS.guide.indexOf('full') >= 0));
  await ev(() => { Keymap.set('guide', 'red', 'full'); UI.press('red'); });
  await page.waitForFunction(() => Views.full, null, { timeout: 15000 }).catch(() => {});
  ok('a button set to Watch fullscreen does that in the guide', await ev(() => !!Views.full));
  await ev(() => { Keymap.reset('guide'); if (Views.full) Views.runAction('exit', 'player'); Views.switchTab('settings'); Settings.open(); Settings.section('remote'); });
  await page.waitForTimeout(500);
  ok('Settings > Remote control has In the guide', /In the guide/.test(await ev(() => document.body.innerText)));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all guide group and move checks passed');
  process.exit(fails ? 1 : 0);
})();
