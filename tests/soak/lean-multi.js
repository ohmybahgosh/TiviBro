/* A 1 GB TV with two playlists of 4,500 channels each (issues #169, #170): neither is over the 8,000-channel line
   on its own, together they are, so the start is lean (the guide after 20 s, the logo library after 40 s), and the
   second playlist joining doesn't load the logo library early.
     MOCK_BIG=4500 MOCK_PORT=8092 node tests/mock/mock_provider.js &
     MOCK_BIG=4500 MOCK_PORT=8093 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/lean-multi.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const one = Object.assign({}, R.SETTINGS.playlists[0], { id: 'p1', name: 'Half one', server: 'http://127.0.0.1:8092', providerEpg: 'short', pubEpg: { on: false }, plRefresh: 0 });
  const two = Object.assign({}, one, { id: 'p2', name: 'Half two', server: 'http://127.0.0.1:8093', user: 'second', pass: 'second' });
  let ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  async function open(gb) {
    const tv = await ctx.newPage(); tv.on('pageerror', (e) => errs.push(e.message));
    if (gb) await tv.addInitScript((g) => Object.defineProperty(navigator, 'deviceMemory', { get: () => g }), gb);
    await tv.goto(APP);
    await tv.waitForFunction(() => window.Library && Library.otherIds && Library.otherIds().indexOf('p2') >= 0, null, { timeout: 180000 });
    return tv;
  }
  const logged = (tv, re) => tv.evaluate((s) => Log.lines(true).filter((l) => new RegExp(s).test(l)), re);
  // First start (a TV with memory to spare): both lists load and are kept, with their sizes.
  await ctx.addInitScript(R.init({ time: Date.now(), settings: { playlists: [one, two], active: 'p1' } })[0]);
  let tv = await open(0);
  const n = await tv.evaluate(() => ({ one: Library.partOf('p1').channels.length, two: Library.partOf('p2').channels.length }));
  ok('two lists of about 4,500 each, both under the line alone', n.one > 4000 && n.one <= 8000 && n.two > 4000 && n.two <= 8000, JSON.stringify(n));
  ok('a TV with memory to spare starts as usual', !(await logged(tv, 'Big list on a TV short of memory')).length);
  await tv.waitForTimeout(2000);
  // The playlists as this TV saved them (with each one's size, p.chans), for the next start.
  const kept = await tv.evaluate(() => JSON.parse(JSON.stringify(Store.settings.playlists)));
  ok('the second list\'s size is kept for the next start', kept.some((p) => p.id === 'p2' && +p.chans > 4000), JSON.stringify(kept.map((p) => p.chans)));
  await tv.close();
  // Again on a 1 GB TV: lean, by the two together.
  ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(R.init({ time: Date.now(), settings: { playlists: kept, active: 'p1' } })[0]);
  tv = await open(1);
  ok('a 1 GB TV: lean, counting both lists', (await logged(tv, 'Big list on a TV short of memory')).length === 1, await logged(tv, 'Big list|Playlists in the lists'));
  await tv.waitForTimeout(3000);
  ok('...and the second list joining doesn\'t load the logo library early', !(await logged(tv, 'Logo library ready')).length, await logged(tv, 'Logo library'));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all lean start checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
