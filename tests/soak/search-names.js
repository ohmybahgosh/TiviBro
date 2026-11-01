/* Search finds what providers write into channel names, and says so (Bob: searching "michigan" listed
   BigTen 10, 14, 19... with nothing about Michigan, and opening one didn't say it either).
     node tests/soak/search-names.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Two channels whose provider names carry a game: one without a time, one with a time.
  const ks = await ev(() => {
    const a = Library.data.channels[3], b = Library.data.channels[4];
    // As on Bob's TV: the name shown is short ("BigTen 10"), the provider's name carries the game.
    Store.edits.renames[a.k] = 'BigTen 10'; Store.edits.renames[b.k] = 'BigTen 14';
    a.n = 'BIG10 10: Michigan vs Ohio State';
    const t = new Date(Date.now() + 3 * 3600e3), h = t.getHours();
    b.n = 'BIG10 14: Michigan Wolverines at Purdue ' + ((h % 12) || 12) + ':00 ' + (h >= 12 ? 'PM' : 'AM');
    Library.dirty && Library.dirty();
    return [a.k, b.k, Library.name(a), Library.name(b)];
  });
  await ev(() => Views.switchTab('search')); await page.waitForTimeout(800);
  await ev(() => { const i = document.querySelector('.search-input'); i.value = 'michigan'; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(1200);
  const rows = await ev(() => [].slice.call(document.querySelectorAll('.search-list .row')).filter((r) => r.offsetHeight).map((r) => r.innerText.replace(/\n+/g, ' | ')));
  ok('the game in the channel name is the result, with the channel under it', rows.some((r) => /Michigan vs Ohio State/.test(r) && r.indexOf(ks[2]) >= 0 && /in the name/.test(r)), JSON.stringify(rows));
  ok('a name with a time reads as an event, with its time', rows.some((r) => /Michigan Wolverines at Purdue/.test(r) && /\d:\d\d/.test(r) && r.indexOf(ks[3]) >= 0 && /upcoming|on now/.test(r)), JSON.stringify(rows));
  ok('every result says why it matched', rows.every((r) => /michigan/i.test(r)), JSON.stringify(rows));

  // A word only in programme descriptions ("Morning Briefing": "...weather and traffic in one quick hour").
  await ev(() => { const i = document.querySelector('.search-input'); i.value = 'traffic'; i.dispatchEvent(new Event('input')); });
  let drows = [];
  for (let w = 0; w < 10 && !drows.length; w++) {
    await page.waitForTimeout(800);
    drows = await ev(() => [].slice.call(document.querySelectorAll('.search-list .row')).filter((r) => r.offsetHeight).map((r) => r.innerText.replace(/\n+/g, ' | ')));
  }
  ok('programmes found by their description, with the words around it', drows.length && drows.every((r) => /traffic/i.test(r)) && drows.some((r) => /Morning Briefing/.test(r)), JSON.stringify(drows.slice(0, 3)));

  // On the channel: the info panel says what the name says when there is no guide.
  const info = await ev((k) => { Views.switchTab('channels'); const c = Library.find(k); Library.data.channels.forEach(() => {}); return Search.extra(c); }, ks[0]);
  ok('the channel\'s details show the game when there is no guide', info === 'Michigan vs Ohio State', info);
  const plain = await ev(() => Search.extra({ n: 'US: ESPN HD', k: 'x', g: '' }));
  ok('a name that only adds a country and quality adds nothing', plain === '', plain);

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all search-by-name checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
