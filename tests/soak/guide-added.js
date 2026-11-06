/* Channels added to the list: the guide loads again for them, and only when it needs to.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/guide-added.js
   The helper keeps programmes only for the guide ids it was asked for, so a channel the provider adds
   would show "No information" until the guide's next refresh.  Now:
   - the list reloaded as it was: the stored guide is used, nothing is downloaded;
   - another copy of a channel (an id the guide already has): still nothing downloaded;
   - a channel with a new guide id: the guide loads again, and that channel gets its programmes. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // Count the loads of the playlist's own guide the app asks the helper for (not the public fill-in's).
  await page.addInitScript(() => {
    window.__loads = 0;
    const f = window.fetch;
    window.fetch = function (u, o) { if (/\/guide\/load/.test(String(u)) && o && o.method === 'POST' && /"kind":"main"/.test(String(o.body || ''))) window.__loads++; return f.apply(this, arguments); };
  });
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const settled = () => page.waitForFunction(() => window.Epg && !Epg.loading && !(Epg.progress && Epg.progress.active) && Epg.status && Epg.status.at > 0, null, { timeout: 90000 });
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await settled(); await page.waitForTimeout(1500);
  const has = await ev(() => Library.data.channels.filter((c) => Epg.hasData(c)).length);
  ok('the guide loads', has > 20, has);
  const unknown = await ev(() => { const ids = new Set(Library.data.channels.map((c) => c.epg)); return ['weather.now.us', 'civic.channel.us', 'market.pulse.us'].find((x) => ids.has(x)) || null; });

  // 1. The list as it was: no download.
  let before = await ev(() => window.__loads);
  await ev(() => Epg.refresh(Library, false)); await settled(); await page.waitForTimeout(800);
  ok('the list reloaded unchanged: the stored guide is used, nothing downloaded', (await ev(() => window.__loads)) === before, await ev(() => window.__loads) + ' vs ' + before);

  // 2. Another copy of a channel, with a guide id already asked for: no download either.
  before = await ev(() => window.__loads);
  await ev(() => { const c = Library.data.channels.find((x) => x.epg); Library.data.channels.push(Object.assign({}, c, { k: c.k + 'copy', id: c.id + 'copy', n: c.n + ' backup' })); Epg.refresh(Library, false); });
  await settled(); await page.waitForTimeout(800);
  ok('another copy of a channel (its guide id already asked for): nothing downloaded', (await ev(() => window.__loads)) === before, await ev(() => window.__loads) + ' vs ' + before);

  // 3. A channel with a guide id the stored guide was never asked for: the guide loads again.
  // The mock's guide has every channel; take one out of the list first, so the stored guide doesn't know it.
  await ev((id) => { Library.data.channels = Library.data.channels.filter((c) => c.epg !== id); }, unknown);
  await ev(() => Epg.refresh(Library, true)); await settled(); await page.waitForTimeout(800);
  before = await ev(() => window.__loads);
  await ev((id) => { const c = Library.data.channels.find((x) => x.epg); Library.data.channels.push(Object.assign({}, c, { k: 'x-new-' + id, id: 'new' + id, n: 'Newly added', epg: id })); Epg.refresh(Library, false); }, unknown);
  await settled(); await page.waitForTimeout(1200);
  const after = await ev(() => window.__loads);
  ok('a channel with a new guide id: the guide loads again', after > before, after + ' vs ' + before);
  ok('and the new channel has its programmes', await ev((id) => Epg.hasData(Library.data.channels.find((c) => c.k === 'x-new-' + id)), unknown), unknown);

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all added-channel guide checks passed');
  process.exit(fails ? 1 : 0);
})();
