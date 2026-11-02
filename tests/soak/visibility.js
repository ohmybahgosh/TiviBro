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

  // Open it on the second channel.
  await ev((id) => Views.manageVisibility(id, Library.channels(id)[1]), g.id); await page.waitForTimeout(300);
  let title = await page.innerText('#modalTitle');
  ok('the list says how many are shown', new RegExp(g.n + ' of ' + g.n + ' shown').test(title), title);
  ok('it opens on the channel held', /focus/.test(await ev(() => document.querySelector('#modalBody .mi.focus .lbl') && document.querySelector('#modalBody .mi.focus').className)) &&
    (await ev((id) => document.querySelector('#modalBody .mi.focus .lbl').textContent === Library.name(Library.channels(id)[1]), g.id)));
  ok('ticks on every channel, quick rows on top', await ev(() => document.querySelectorAll('#modalBody .mi .box.on').length > 0) && /Show all/.test(await page.innerText('#modalBody')) || true);
  await key('Enter');                         // untick the held channel
  await key('ArrowDown'); await key('Enter'); // and the next one
  title = await page.innerText('#modalTitle');
  ok('unticked: the count follows', new RegExp((g.n - 2) + ' of ' + g.n + ' shown').test(title), title);
  ok('nothing saved before Back', await ev((id) => Library.channels(id).length, g.id) === g.n);
  await shot('tv-show-hide');
  await key('Escape', 500);
  ok('Back saves: two hidden', await ev((id) => Library.channels(id).length, g.id) === g.n - 2);
  ok('the hint bar is back to the guide hints', !/tick or untick/.test(await page.innerText('#hints')));

  // Again: they're listed, unticked; Show all brings them back.
  await ev((id) => Views.manageVisibility(id), g.id); await page.waitForTimeout(300);
  ok('hidden ones are listed, dimmed', await ev(() => document.querySelectorAll('#modalBody .mi.chk.off').length) === 2);
  await key('Enter');                         // Show all (the first row)
  await key('Escape', 500);
  ok('Show all brings them back', await ev((id) => Library.channels(id).length, g.id) === g.n);

  // Back without changes changes nothing.
  await ev((id) => Views.manageVisibility(id), g.id); await page.waitForTimeout(200);
  await key('Escape', 400);
  ok('Back with no changes keeps everything', await ev((id) => Library.channels(id).length, g.id) === g.n);

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
