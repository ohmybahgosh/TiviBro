/* Streaming services and genres as Movies home shelves (vodhome.js addMenu, discussion #184), in the real app with
   TMDB's answers stood in for: Red on the home offers Add a streaming service, the region's services are listed,
   OK makes one a shelf of the provider's titles TMDB says it has, and OK again in the list takes it off.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/vod-services.js */
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
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2000);
  const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms), key = (a) => ev((x) => UI.press(x), a);
  try {
    // FlixPatrol's Top 10s through TiviBro's relay, stood in for: Netflix's movie chart has two of the provider's
    // movies, at places 3 and 1, and one it hasn't.
    await page.addInitScript(() => {
      const real = window.fetch;
      window.fetch = function (u) {
        if (/v1\/top10/.test(String(u))) {
          window.__top = String(u);
          return Promise.resolve(new Response(JSON.stringify({ ok: true, country: 'US', date: '2026-11-25', charts: [{ service: 'Netflix', movies: [{ r: 1, t: 'Paper Planes' }, { r: 2, t: 'Not On This Provider' }, { r: 3, t: 'The Lighthouse Keeper' }], shows: [], all: [] }] })));
        }
        return real.apply(this, arguments);
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await wait(2000);
    await ev(() => Views.switchTab('movies')); await wait(3000);
    const top = await ev(() => { const s = [...document.querySelectorAll('.media-shelf:not(.hidden)')].find((x) => x.querySelector('h2').textContent === 'Top 10 on Netflix'); return s ? [...s.querySelectorAll('.media-tile')].filter((t) => t.style.display !== 'none').map((t) => t.querySelector('.media-tile-title').textContent + ' ' + t.querySelector('.media-tag').textContent) : null; });
    // SHOT=file.png: a picture of the Top 10 shelf, focused.
    if (process.env.SHOT) { await page.keyboard.press('ArrowDown'); await wait(800); await page.screenshot({ path: process.env.SHOT }); await page.keyboard.press('ArrowUp'); await wait(400); }
    ok('Top 10 on Netflix: the provider\'s titles on the chart, in its order, with their place', JSON.stringify(top) === JSON.stringify(['Paper Planes #1', 'The Lighthouse Keeper #3']), JSON.stringify(top));
    ok('asked of TiviBro\'s relay, for the TV\'s region', /tivibro-meta\.theboxmod\.workers\.dev\/v1\/top10\?country=[A-Z]{2}/.test(await ev(() => window.__top || '')), await ev(() => window.__top));
    const names = await ev(() => Vod.allItems().filter((x) => x.kind === 'movie').slice(0, 4).map((x) => x.it.name));
    // TMDB stood in for: a token, two services in the region, and Netflix "having" the first few provider movies.
    await ev((names) => {
      MediaStore.tmdbToken = () => 'demo';
      const real = Media.request; window.__asks = [];
      Media.request = function (what, q) {
        if (what === 'metadata' && q && q.list) {
          window.__asks.push(q.list + ':' + (q.provider || q.genre || ''));
          if (q.list === 'services') return Promise.resolve({ items: [{ id: 8, name: 'Netflix' }, { id: 119, name: 'Prime Video' }] });
          if (q.list === 'service') return Promise.resolve({ items: names.map((n) => ({ t: n, o: '', y: '' })) });
          return Promise.resolve({ items: [] });
        }
        return real.apply(Media, arguments);
      };
    }, names);
    await key('red'); await wait(500);
    const rows = await ev(() => [...document.querySelectorAll('#modalBody > div')].map((d) => d.textContent.trim()));
    const at = rows.findIndex((t) => /^Add a streaming service/.test(t));
    ok('Red on the home offers Add a streaming service', at >= 0, rows.join(' | '));
    for (let n = 0; n < at; n++) await key('down');
    await key('ok'); await wait(800);
    const list = await ev(() => [...document.querySelectorAll('#modalBody > div')].map((d) => d.textContent.trim()));
    ok('the region\'s services are listed', list.join('|') === 'Netflix|Prime Video', list.join('|'));
    await key('ok'); await wait(1500);
    const shelves = await ev(() => [...document.querySelectorAll('.media-shelf:not(.hidden) .media-shelf-title h2')].map((h) => h.textContent));
    ok('OK makes Netflix a shelf', shelves.indexOf('On Netflix') >= 0, shelves.join(' | '));
    ok('its titles were asked for at once', await ev(() => window.__asks.indexOf('service:8') >= 0), await ev(() => window.__asks.join()));
    ok('the shelf is kept with its name', await ev(() => { const c = Store.settings.vodShelves.movie; return c.order.indexOf('svc:8') >= 0 && c.names['svc:8'] === 'Netflix'; }));
    // Again from the list: ★ on it, and OK takes it off.
    await key('red'); await wait(400);
    for (let n = 0; n < at; n++) await key('down');
    await key('ok'); await wait(800);
    ok('the list marks it a shelf', await ev(() => /★/.test(document.querySelector('#modalBody > div').textContent)));
    await key('ok'); await wait(600); await key('back'); await wait(800);
    const gone = await ev(() => ({ order: Store.settings.vodShelves.movie.order.join(), shelves: [...document.querySelectorAll('.media-shelf:not(.hidden) .media-shelf-title h2')].map((h) => h.textContent).join() }));
    ok('OK again takes the shelf off', gone.order.indexOf('svc:8') < 0 && gone.shelves.indexOf('On Netflix') < 0, JSON.stringify(gone));
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('ran to the end', false, e.message); }
  await b.close();
  if (fails) { console.log(fails + ' check(s) failed'); process.exit(1); }
  console.log('all streaming service shelf checks passed');
})();
