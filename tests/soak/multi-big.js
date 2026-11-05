/* Two big playlists and two big movie libraries at once: how much memory the page holds, what the log
   says was loaded, and the lower limits of memory-safe mode (a 1 GB TV, or one that closed TiviBro
   while playing this week), where the second playlist and its movies are left out with a message.
     MOCK_BIG=80000 MOCK_BIG_VOD=50000 MOCK_PORT=8092 node tests/mock/mock_provider.js &
     MOCK_BIG=80000 MOCK_BIG_VOD=50000 MOCK_PORT=8093 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/multi-big.js
   Delete service/data/kv/playlist~*.json first.  Headless Chromium is not a TV: the numbers are what
   this page holds, logged for comparison, with a ceiling well under webOS's ~500 MB. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const A = +process.env.MOCK_A || 8092, B = +process.env.MOCK_B || 8093, CEIL = +process.env.CEIL_MB || 450;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const errs = [];
  const one = Object.assign({}, R.SETTINGS.playlists[0], { id: 'p1', name: 'Big one', server: 'http://127.0.0.1:' + A, providerEpg: 'short', pubEpg: { on: false }, plRefresh: 0 });
  const two = Object.assign({}, one, { id: 'p2', name: 'Big two', server: 'http://127.0.0.1:' + B, user: 'second', pass: 'second' });
  async function open(safe) {
    const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    tv.on('pageerror', (e) => errs.push(e.message));
    await tv.addInitScript(R.init({ time: Date.now(), settings: { playlists: [one, two], active: 'p1' } })[0]);
    // Memory-safe: as if TiviBro closed while playing earlier this week (app.js playSafe).
    if (safe) await tv.addInitScript(() => localStorage.setItem('tivibro.playSafe', JSON.stringify({ until: Date.now() + 86400e3, n: 1 })));
    await tv.goto(APP);
    await tv.waitForFunction(() => window.Library && Library.count() > 1000, null, { timeout: 180000 });
    return tv;
  }
  const heap = (tv) => tv.evaluate(() => { if (window.gc) window.gc(); return Math.round(((performance.memory && performance.memory.usedJSHeapSize) || 0) / 1048576); });
  const logged = (tv, re) => tv.evaluate((s) => Log.lines(true).filter((l) => new RegExp(s).test(l)).slice(-3), re);
  try {
    // ---------- normal ----------
    const tv = await open(false);
    await tv.waitForFunction(() => Library.otherIds().indexOf('p2') >= 0, null, { timeout: 240000 });
    await tv.waitForTimeout(3000);
    const n = await tv.evaluate(() => ({ all: Library.count(), one: Library.partOf('p1').channels.length, two: Library.partOf('p2').channels.length }));
    const h1 = await heap(tv);
    console.log('  channels: ' + JSON.stringify(n) + ', heap ' + h1 + ' MB');
    ok('both big playlists are in the lists', n.one > 80000 && n.two > 80000, JSON.stringify(n));
    ok('the log says what was loaded', (await logged(tv, 'Playlists in the lists')).some((l) => /Big one \d+, Big two \d+/.test(l)), JSON.stringify(await logged(tv, 'Playlists in the lists')));
    ok('the page holds less than ' + CEIL + ' MB with both', h1 > 0 && h1 < CEIL, h1 + ' MB');
    await tv.evaluate(() => Vod.prepare());
    await tv.waitForFunction(() => Vod.allItems().length > 90000, null, { timeout: 240000 }).catch(() => {});
    const v = await tv.evaluate(() => ({ all: Vod.allItems().length, two: Vod.allItems().filter((x) => x.it.pl === 'p2').length }));
    const h2 = await heap(tv);
    console.log('  movies: ' + JSON.stringify(v) + ', heap ' + h2 + ' MB');
    ok('both big movie libraries load', v.two > 40000 && v.all > 90000, JSON.stringify(v));
    ok('the page still holds less than ' + CEIL + ' MB with both libraries', h2 < CEIL, h2 + ' MB');
    ok('the log says how many movies each brought', (await logged(tv, 'Big two: \\d+ movies')).length > 0);
    await tv.context().close();

    // ---------- memory-safe ----------
    const safe = await open(true);
    await safe.waitForTimeout(25000);
    const s = await safe.evaluate(() => ({ safe: !!Player.memSafe, others: Library.otherIds(), all: Library.count() }));
    console.log('  memory-safe: ' + JSON.stringify(s) + ', heap ' + (await heap(safe)) + ' MB');
    ok('memory-safe: the second big playlist is left out (120,000 at most)', s.safe && s.others.length === 0 && s.all < 120000, JSON.stringify(s));
    ok('memory-safe: the log says why', (await logged(safe, 'Left out Big two')).length > 0, JSON.stringify(await logged(safe, 'Left out')));
    await safe.evaluate(() => Vod.prepare());
    await safe.waitForTimeout(8000);
    const sv = await safe.evaluate(() => ({ all: Vod.allItems().length, two: Vod.allItems().filter((x) => x.it.pl === 'p2').length }));
    ok('memory-safe: only the first playlist\'s movies (60,000 at most for the others)', sv.two === 0 && sv.all > 40000, JSON.stringify(sv));
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all big multi-playlist checks passed');
  process.exit(fails ? 1 : 0);
})();
