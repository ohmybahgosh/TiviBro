/* Search finds movies and shows (issue #2, pull request #3), without opening Movies or Shows first.
     node tests/soak/search-vod.js      (mock provider on :8077, npm run serve)
   Typing finds a movie by any word of its title, titles that start with the text come first, the
   Movies & Shows chip keeps only those, OK on a movie opens Movies on it and plays it (Back lands on
   it there), and OK on a show opens its episodes. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Store.playlist.vod && Store.playlist.vod.movies && Store.playlist.vod.series, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const results = () => ev(() => [].slice.call(document.querySelectorAll('.search-list .row')).filter(r => r.offsetHeight).map(r => (r.querySelector('.name') || {}).textContent + ' | ' + (r.querySelector('.tag') || {}).textContent));
  const type = async t => { await ev(t => { const i = document.querySelector('.search-input'); i.value = t; i.dispatchEvent(new Event('input')); }, t); await page.waitForTimeout(900); };

  ok('Movies and Shows not opened yet', await ev(() => Vod.allItems().length === 0));
  await ev(() => Views.switchTab('search')); await page.waitForTimeout(1500);
  await type('kite');
  let r = await results();
  ok('typing finds a movie without opening Movies first', r.some(x => /^The Kite Festival \| movie$/.test(x)), JSON.stringify(r));
  await type('orbit');
  r = await results();
  ok('and a show', r.some(x => /^Orbit \| show$/.test(x)), JSON.stringify(r));
  await ev(() => [].slice.call(document.querySelectorAll('.schip')).find(c => /Movies/.test(c.textContent)).click()); await page.waitForTimeout(600);
  await type('lig');
  r = await results();
  ok('the Movies & Shows chip keeps only movies and shows', r.length > 0 && r.every(x => / \| (movie|show)$/.test(x)), JSON.stringify(r.slice(0, 4)));
  // "Northern Lights" has a word starting "lig"; "The Lighthouse Keeper" too; a title merely containing it would come last.
  ok('titles with a word that starts with the text come before others', r.length > 1 && r.slice(0, 2).every(x => /\bLig/i.test(x)), JSON.stringify(r));
  await type('the');
  r = await results();
  ok('titles that start with the text come first', r.length > 1 && /^The /.test(r[0]), JSON.stringify(r.slice(0, 4)));

  // OK on a movie: Movies opens on it and it plays; Back lands on it in Movies.
  await type('lighthouse');
  await ev(() => [].slice.call(document.querySelectorAll('.search-list .row')).find(x => /Lighthouse/.test(x.textContent)).click());
  await page.waitForFunction(() => Views.mode === 'vod', null, { timeout: 20000 }).catch(() => {});
  const m = await ev(() => ({ tab: Views.tab, mode: Views.mode, title: (document.querySelector('.osd .t, #osdTitle') || {}).textContent }));
  ok('OK on a movie opens Movies and plays it', m.tab === 'movies' && m.mode === 'vod', JSON.stringify(m));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); await page.keyboard.press('Backspace'); await page.waitForTimeout(1500);
  const back = await ev(() => ({ tab: Views.tab, mode: Views.mode, sel: (document.querySelector('#vodInfo h2') || {}).textContent }));
  ok('Back lands on it in Movies', back.tab === 'movies' && back.mode !== 'vod' && /Lighthouse/.test(back.sel || ''), JSON.stringify(back));

  // OK on a show: its episodes.
  await ev(() => Views.switchTab('search')); await page.waitForTimeout(800);
  await type('harbor');
  await ev(() => [].slice.call(document.querySelectorAll('.search-list .row')).find(x => /Harbor Street/.test(x.textContent)).click());
  await page.waitForFunction(() => /episodes/.test((document.getElementById('vodTitle') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const s = await ev(() => ({ tab: Views.tab, title: document.getElementById('vodTitle').textContent }));
  ok('OK on a show opens its episodes', s.tab === 'shows' && /Harbor Street\s+\d+ episodes/.test(s.title), JSON.stringify(s));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all movie and show search checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
