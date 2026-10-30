/* Web editor: your own channel order in a provider group (drag, or ⋯ > Move on a phone) and the
   watchlist (Guide page) reach the TV.
     node tests/soak/editor-order.js      (the app served on :8078 with the dev relay, mock provider on :8077) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); const errs = []; tv.on('pageerror', e => errs.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await tv.waitForTimeout(3000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  await tv.evaluate(() => WebEdit.start()); await tv.waitForTimeout(2500);
  const st = await tv.evaluate(() => WebEdit.status), pw = await tv.evaluate(() => WebEdit.password());
  const ed = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); ed.on('pageerror', e => errs.push('editor: ' + e.message));
  await ed.goto('http://127.0.0.1:' + st.port + '/#k=' + pw + '/gc'); await ed.waitForFunction(() => window.D && D.channels && D.channels.length, null, { timeout: 30000 }); await ed.waitForTimeout(800);

  // A provider group with a few channels.
  const g = await ed.evaluate(() => { const g = D.groups.find(x => channelsOf(x.id).length >= 4); return g.id; });
  const before = await tv.evaluate(g => Library.channels(g).map(c => c.k), g);
  await ed.evaluate(g => { curGroup = g; renderChannels(true); }, g); await ed.waitForTimeout(300);
  const opts = await ed.evaluate(() => $('cSort')._dd && $('cSort')._dd.opts ? $('cSort')._dd.opts.map(o => o.v) : null);
  ok('a provider group offers "Your order"', !opts || opts.indexOf('custom') >= 0, JSON.stringify(opts));
  // ⋯ > Move to the bottom on the first channel.
  await ed.hover('.c'); await ed.click('.c [data-more]'); await ed.waitForTimeout(200);
  await ed.click('#menu .pick:has-text("Move to the bottom")'); await ed.waitForTimeout(300);
  const shown = await ed.evaluate(g => channelsOf(g).map(c => c.k), g);
  ok('the channel moves to the bottom in the editor', shown[shown.length - 1] === before[0] && shown[0] === before[1], shown.slice(0, 3).join());
  ok('the group switches to Your order', await ed.evaluate(g => E.groupSort[g] === 'custom' && E.chanOrder[g].length > 0, g));
  ok('the note says what happens to new channels', /go to the end/.test(await ed.innerText('#gNote')));
  // Back to the top (what a drag does).
  await ed.evaluate(([g, k]) => { mut('drag', function () { placeIn(g, k, 0); }); }, [g, before[0]]);
  ok('placing it back at the top restores the order', (await ed.evaluate(g => channelsOf(g).map(c => c.k).join(), g)) === before.join());
  await ed.evaluate(g => mut('move', function () { placeIn(g, channelsOf(g)[0].k, 2); }), g);
  const want = await ed.evaluate(g => channelsOf(g).map(c => c.k), g);

  // Watchlist on the Guide page.
  await ed.click('#nav button[data-page=guide]'); await ed.waitForTimeout(1200);
  await ed.fill('#wText', 'News'); await ed.click('#wAdd'); await ed.waitForTimeout(300);
  await ed.fill('#wText', 'news'); await ed.click('#wAdd'); await ed.waitForTimeout(300);
  ok('the watchlist card lists the word once', (await ed.evaluate(() => E.watchlist.map(w => w.q).join())) === 'News', await ed.evaluate(() => JSON.stringify(E.watchlist)));

  await ed.evaluate(() => send()); await tv.waitForTimeout(6000);
  const tvOrder = await tv.evaluate(g => Library.channels(g).map(c => c.k), g);
  ok('the TV shows the provider group in your order', tvOrder.join() === want.join(), tvOrder.slice(0, 4).join() + ' vs ' + want.slice(0, 4).join());
  ok('the TV has the watchlist', (await tv.evaluate(() => Watch.list().map(w => w.q).join())) === 'News');
  ok('and set reminders from it', await tv.evaluate(() => Store.edits.reminders.some(r => r.w === 'News')));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all editor order checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL harness: ' + e.message); process.exit(1); });
