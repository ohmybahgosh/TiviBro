/* The Movies and Shows home (vodhome.js): getting around and coming back to the same place.  Home, play
   and Back to the same shelf and title; Green to the categories and Back home; See all as a wall, play and
   Back to the same poster; a show's episodes, an episode and Back to them, then home on the same show;
   Hold OK > Open episodes; Search playing a movie while the home is up.  Remote keys only.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/vod-home.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a), w = ms => page.waitForTimeout(ms);
  const state = () => ev(() => ({ home: document.getElementById('viewVod').classList.contains('home-on'), wall: !!document.querySelector('#vodHome.wall'), full: document.body.classList.contains('full'), sel: (document.querySelector(document.querySelector('#vodHome.wall') ? '#vodWall .media-tile.sel' : '#vodHomeStage .media-tile.sel') || {}).ariaLabel || (document.querySelector('#vodHomeStage .media-tile.sel') || { getAttribute: () => '' }).getAttribute('aria-label'), shelf: (document.querySelector('#vodHomeStage .media-shelf.active h2') || {}).textContent, title: (document.getElementById('vodTitle') || {}).textContent, modal: !document.getElementById('modal').classList.contains('hidden') }));
  const backOut = async () => { for (let i = 0; i < 4; i++) { if (!(await ev(() => document.body.classList.contains('full')))) return i; await ev(() => UI.press('back')); await w(900); } return 9; };
  const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) fails++; };
  await ev(() => Views.switchTab('movies')); await w(2500);
  let s = await state(); ok('Movies opens on the home', s.home, s);
  await ev(() => { UI.press('down'); UI.press('right'); }); await w(300);
  const before = await state();
  await ev(() => UI.press('ok')); await w(2500);
  s = await state(); ok('OK plays the movie', s.full, s);
  await backOut(); await w(600);
  s = await state(); ok('Back from the movie: the home, same shelf and title', s.home && s.shelf === before.shelf && s.sel === before.sel, [before, s]);
  await ev(() => UI.press('green')); await w(500);
  s = await state(); ok('Green: the category list', !s.home, s);
  await ev(() => UI.press('back')); await w(300); await ev(() => UI.press('back')); await w(500);
  s = await state(); ok('Back from the list: the home again', s.home, s);
  await ev(() => UI.press('red')); await w(300); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await w(600);
  s = await state(); ok('Red > See all: the wall', s.wall, s);
  await ev(() => UI.press('right')); await w(200); const wb = await state();
  await ev(() => UI.press('ok')); await w(2500); await backOut(); await w(600);
  s = await state(); ok('Back from a movie on the wall: the wall, same title', s.wall && s.sel === wb.sel, [wb, s]);
  await ev(() => UI.press('back')); await w(400);
  s = await state(); ok('Back on the wall: the shelves', s.home && !s.wall, s);
  // Shows
  await ev(() => Views.switchTab('shows')); await w(2500);
  s = await state(); ok('Shows opens on the home', s.home, s);
  const sb = await state();
  await ev(() => UI.press('ok')); await w(2500);
  s = await state(); ok('OK on a show lists its episodes', !s.home && /episodes/.test(s.title), s);
  await ev(() => UI.press('ok')); await w(2500); s = await state(); ok('an episode plays', s.full, s);
  await backOut(); await w(600);
  s = await state(); ok('Back from the episode: its episode list', !s.home && await ev(() => document.querySelectorAll('#vodItems .row').length > 0 && /S\d+ E\d+/.test(document.getElementById('vodItems').innerText)), s);
  await ev(() => UI.press('back')); await w(800);
  s = await state(); ok('Back from the episodes: the home, on the same show', s.home && s.sel === sb.sel, [sb, s]);
  await ev(() => UI.press('hold')); await w(300);
  const labels = await ev(() => UI.menuLabels || []);
  const oi = labels.findIndex(l => /Open episodes/.test(l));
  if (oi >= 0) { for (let i = 0; i < oi; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await w(2500); s = await state(); ok('Hold OK > Open episodes from the home shows them', !s.home && /episodes/.test(s.title), s); await ev(() => UI.press('back')); await w(800); s = await state(); ok('and Back returns home', s.home, s); }
  else ok('Hold OK offers Open episodes', false, labels);
  // Search to a movie while the home is up
  await ev(() => Views.switchTab('movies')); await w(1500);
  await ev(() => { const x = Vod.allItems().filter(y => y.kind === 'movie')[2]; Vod.openItem(x); }); await w(3000);
  s = await state(); ok('Search (or the phone) plays a movie from the Movies home', s.full, s);
  await backOut(); await w(600); s = await state(); ok('and Back lands on Movies (list or home)', !s.full, s);
  ok('no script errors', !errs.length, errs);
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
