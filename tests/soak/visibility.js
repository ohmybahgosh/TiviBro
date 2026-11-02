/* Show or hide channels (Hold OK on a channel or a group), full themes, and the button hints.
     node tests/mock/mock_provider.js &      (on :8077)
     npm run serve &                         (app on :8078)
     node tests/soak/visibility.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 250 : w); };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // A provider group with a few channels.
  const g = await ev(() => { const gs = Library.groups().filter((x) => Views.canManage(x.id) && Library.channels(x.id).length >= 4); return gs[0] && { id: gs[0].id, name: gs[0].name, n: Library.channels(gs[0].id).length }; });
  ok('a group to try it on', !!g, JSON.stringify(g));
  ok('not offered for All, Recent, My teams, Events', await ev(() => ['all', 'recent', 'teams', 'events', 'new'].every((x) => !Views.canManage(x))));

  // The guide: Hold OK on a channel offers it.
  await ev((id) => { Views.switchTab('guide'); }, g.id); await page.waitForTimeout(800);
  const items = await ev((id) => { let got = null; const m = UI.menu; UI.menu = (t, l) => { got = l.filter(Boolean).map((x) => x.label); }; Views.chanMenu(Library.channels(id)[1], id); UI.menu = m; return got; }, g.id);
  ok('channel options offer Show or hide channels…', items && items.indexOf('Show or hide channels…') >= 0, items && items.join(', '));
  const gitems = await ev((id) => { let got = null; const m = UI.menu; UI.menu = (t, l) => { got = l.filter(Boolean).map((x) => x.label); }; Views.groupMenu({ id, name: 'x' }); UI.menu = m; return got; }, g.id);
  ok('group options offer it too', gitems && gitems.indexOf('Show or hide channels…') >= 0, gitems && gitems.join(', '));

  // In the guide itself: ticks on the rows, opened on the channel held.
  await ev((id) => { Views.switchTab('guide'); Guide.open(id, Library.channels(id)[0].k); }, g.id); await page.waitForTimeout(600);
  await ev((id) => Views.manageVisibility(id, Library.channels(id)[1]), g.id); await page.waitForTimeout(400);
  ok('no popup: it happens in the guide', await ev(() => document.getElementById('modal').classList.contains('hidden') && Guide.vis));
  let head = await page.innerText('#guideGroup');
  ok('the header says how many are shown', new RegExp(g.n + ' of ' + g.n + ' shown').test(head), head);
  ok('a tick on every row', await ev(() => document.querySelectorAll('.grow.vis').length > 0 && !document.querySelector('.grow.vis-off')));
  ok('it starts on the channel held', await ev((id) => document.querySelector('.grow.sel .n').textContent === Library.name(Library.channels(id)[1]), g.id));
  await key('Enter'); await key('ArrowDown'); await key('Enter');
  ok('unticked rows are dimmed', await ev(() => document.querySelectorAll('.grow.vis-off').length) === 2);
  head = await page.innerText('#guideGroup');
  ok('the count follows', new RegExp((g.n - 2) + ' of ' + g.n + ' shown').test(head), head);
  ok('hints for the mode', /tick or untick/.test(await page.innerText('#hints')) && await ev(() => !!document.querySelector('#hints b.k-red')));
  ok('nothing saved before Back', await ev((id) => Library.channels(id).length, g.id) === g.n);
  await shot('tv-show-hide');
  await key('Escape', 500);
  ok('Back saves: two hidden, the mode ends', await ev((id) => Library.channels(id).length, g.id) === g.n - 2 && await ev(() => !Guide.vis));
  ok('the guide hints are back', !/tick or untick/.test(await page.innerText('#hints')));

  // Again: hidden ones are in the list, unticked; Red > Show all brings them back.
  await ev((id) => Views.manageVisibility(id), g.id); await page.waitForTimeout(300);
  ok('hidden ones are listed, dimmed', await ev(() => document.querySelectorAll('.grow.vis-off').length) === 2);
  await ev(() => UI.press('red')); await page.waitForTimeout(200);
  ok('Red: all, none, no guide', /Show all/.test(await page.innerText('#modal')) && /Hide channels with no guide/.test(await page.innerText('#modal')));
  await key('Enter'); await key('Escape', 500);
  ok('Show all brings them back', await ev((id) => Library.channels(id).length, g.id) === g.n);

  // Leave without saving.
  await ev((id) => Views.manageVisibility(id), g.id); await page.waitForTimeout(200);
  await key('Enter');
  await ev(() => UI.press('red')); await page.waitForTimeout(200);
  await ev(() => { for (let i = 0; i < 4; i++) UI.press('down'); UI.press('ok'); }); await page.waitForTimeout(300);
  ok('Leave without saving keeps everything', await ev((id) => Library.channels(id).length, g.id) === g.n && await ev(() => !Guide.vis));

  // The Channels screen: the same, on its rows.
  await ev((id) => { Views.switchTab('live'); }, g.id); await page.waitForTimeout(500);
  await ev((id) => Views.manageVisibility(id, Library.channels(id)[0]), g.id); await page.waitForTimeout(400);
  ok('Channels screen: ticks on its rows, no popup', await ev(() => document.querySelectorAll('#chanList .row.vis').length > 0 && document.getElementById('modal').classList.contains('hidden')));
  await key('Enter');
  ok('its header counts too', new RegExp((g.n - 1) + ' of ' + g.n + ' shown').test(await page.innerText('#chanTitle')), await page.innerText('#chanTitle'));
  await shot('tv-show-hide-list');
  await key('Escape', 500);
  ok('Back saves there too', await ev((id) => Library.channels(id).length, g.id) === g.n - 1);
  await ev((id) => Library.hideChannels({ [Library.channels(id, true)[0].k]: false }), g.id);

  // Hints: colour buttons as a square and a label, the same everywhere.
  await ev((id) => { Views.switchTab('guide'); Guide.open(id, Library.channels(id)[0].k); }, g.id); await page.waitForTimeout(800);
  await ev(() => Guide.hints());
  const words = await page.innerText('#hints');
  ok('no button named by colour in words', !/\b(Red|Green|Yellow|Blue)\b/.test(words), words);
  ok('red shows as a square too', await ev(() => !!document.querySelector('#hints b.k-red')), words);

  // Full themes.
  const pal = await ev(() => { Store.settings.palette = 'dracula'; Views.applyLook(); const cs = getComputedStyle(document.body); return { ink: cs.getPropertyValue('--ink').trim(), acc: cs.getPropertyValue('--accent').trim(), pal: document.body.classList.contains('pal') }; });
  ok('a theme sets every colour (Dracula)', pal.ink === '#282a36' && pal.acc === '#bd93f9' && pal.pal, JSON.stringify(pal));
  await shot('tv-theme-dracula');
  const mono = await ev(() => { Store.settings.palette = 'mono'; Views.applyLook(); const cs = getComputedStyle(document.body); return { ink: cs.getPropertyValue('--ink').trim(), acc: cs.getPropertyValue('--accent').trim(), on: cs.getPropertyValue('--on-accent').trim() }; });
  ok('Black and white: black, white focus, dark text on it', mono.ink === '#000000' && mono.acc === '#ffffff' && /^#0|^#1|rgb\(0|#000/.test(mono.on), JSON.stringify(mono));
  const back = await ev(() => { Store.settings.palette = ''; Store.settings.theme = 'ocean'; Views.applyLook(); const cs = getComputedStyle(document.body); return { ink: cs.getPropertyValue('--ink').trim(), pal: document.body.classList.contains('pal') }; });
  ok('your own mix: the background setting again', back.ink === '#08202d' && !back.pal, JSON.stringify(back));
  const rows = await ev(() => { Store.settings.palette = 'tokyo'; Views.switchTab('settings'); Settings.section('look'); return document.querySelector('#setBody').innerText; });
  ok('Settings > Look: Theme, and no Background row while a theme is on', /Theme/.test(rows) && /Tokyo Night/.test(rows) && !/\bBackground\n/.test(rows.replace('Background and accent', '')), rows.slice(0, 300));
  await ev(() => { Store.settings.palette = ''; Store.settings.theme = 'dark'; Views.applyLook(); });

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all show or hide, theme and hint checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
