/* The content filter in the real app (filter.js, discussion #20): a word, a channel and a group
   taken out of the guide, lists and Search; the channel options; Settings > Parental controls; the
   set-up tour asking first; and a new TV starting with it on, an existing one with it off.
     node tests/soak/filter.js [--shots dir]      (mock provider on :8077, npm run serve) */
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
  const errs = [];
  // A new TV: nothing set up yet.
  const fresh = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); fresh.on('pageerror', e => errs.push(e.message));
  await fresh.addInitScript(R.init({ time: Date.now(), fresh: true })[0]);
  await fresh.goto(APP); await fresh.waitForTimeout(2500);
  ok('a new TV starts with adult channels hidden', await fresh.evaluate(() => Store.settings.filter.adult === true));
  await fresh.close();

  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  ok('a TV that already had a playlist starts with it off', await ev(() => Store.settings.filter.adult === false && Store.settings.filter.asked === true));
  const all = await ev(() => Library.count());

  // A word.
  const nova = await ev(() => Library.data.channels.filter(c => /\bNova\b/i.test(c.n)).length);
  await ev(() => { Filter.addWord('nova'); Views.filterChanged(); });
  ok('a word takes its channels out of the playlist', await ev(() => Library.count()) === all - nova && nova > 0, (await ev(() => Library.count())) + ' of ' + all + ', ' + nova);
  ok('out of Search too', await ev(() => !Library.channels(Library.ALL).some(c => /Nova/.test(c.n))));
  ok('the playlist kept on the TV is whole', await ev(() => Library.raw.channels.length) === all);

  // A channel from its options, in the guide.
  await ev(() => Views.switchTab('guide')); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800);
  const name = await ev(() => Library.name(Library.channels(Views.group)[Guide.__sel()]));
  await ev(() => UI.press('red')); await page.waitForTimeout(600);
  const pick = async (re) => {
    const idx = await ev(r => [].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x => new RegExp(r).test(x.textContent)), re);
    const cur = await ev(() => [].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x => x.classList.contains('focus')));
    for (let k = 0; k < Math.abs(idx - cur); k++) { await page.keyboard.press(idx > cur ? 'ArrowDown' : 'ArrowUp'); await page.waitForTimeout(60); }
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  };
  await pick('^Channel options');
  // Every item, not just the ones drawn (a long menu scrolls).
  const menu = await ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? (UI.menuLabels.length ? UI.menuLabels.join('\n') : m.innerText) : ''; });
  ok('the options menu has Hide with the content filter', /Hide with the content filter/.test(menu), menu.slice(0, 300));
  await pick('Hide with the content filter');
  const ask = await ev(() => document.getElementById('modal').innerText);
  ok('it asks first, Cancel focused', /with the content filter\?/.test(ask) && await ev(() => /Cancel/.test(document.querySelector('#modal .mi.focus').textContent)), ask);
  await shot('tv-filter-ask');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  ok('the channel is gone', await ev(n => !Library.channels(Library.ALL).some(c => Library.name(c) === n), name) && await ev(() => Store.settings.filter.chans.length === 1), name);

  // Settings > Parental controls.
  await ev(() => { Views.switchTab('settings'); Settings.section('parental'); }); await page.waitForTimeout(600);
  const set = await ev(() => document.body.innerText);
  ok('Settings lists the filter: adult switch, the word, the channel, the count', /Content filter/.test(set) && /Hide adult channels/.test(set) && /Word: nova/.test(set) && /Channel: /.test(set) && /Left out of this playlist/.test(set), set.slice(0, 400));
  await shot('tv-filter-settings');
  await ev(() => { Filter.remove('words', 'nova'); Filter.remove('chans', Store.settings.filter.chans[0]); Views.filterChanged(); });
  ok('removing them brings the channels back', await ev(() => Library.count()) === all);
  // A group.
  const g = await ev(() => Library.data.groups[0]);
  await ev(g => { Filter.addGroup(g.name); Views.filterChanged(); }, g);
  ok('a group hidden with the filter takes its channels', await ev(id => !Library.groups().some(x => x.id === id) && !Library.data.channels.some(c => c.g === id), g.id));
  await ev(g => { Filter.remove('groups', g.name); Views.filterChanged(); }, g);

  // The set-up tour asks first.
  await ev(() => Tour.open({ from: 'settings' })); await page.waitForTimeout(800);
  const tour = await ev(() => document.getElementById('viewSetup').innerText);
  const focused = await ev(() => { const f = document.querySelector('#viewSetup .focus'); return f ? f.innerText : ''; });
  ok('the tour\'s first screen asks, and that row is focused', /Hide adult channels/.test(tour) && /Hide adult channels/.test(focused), focused);
  await shot('tv-filter-tour');
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all content filter checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
