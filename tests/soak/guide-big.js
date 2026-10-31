/* A guide far too big to read inside the app (alpha 24 closed on a C2 with a 64 MB extra guide).
     MOCK_PORT=8090 MOCK_BIG=4000 MOCK_BIG_EPG=4000 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/guide-big.js
   About 300 MB of XMLTV (4,000 channels, 3 days, long descriptions).  The helper reads and stores
   it; the app keeps titles and times only, gets descriptions as they are shown, finds programmes on
   any channel, has days of programmes (not hours), and starts again from what the helper stored. */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8090';
const N = +process.env.BIG_CH || 4000;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const settings = { meter: 'off', active: 'p1', playlists: [{ id: 'p1', name: 'Big', type: 'xtream', server: MOCK, user: 'demo', pass: 'demo', providerEpg: 'xmltv', epgDays: 1,
    epgSources: [{ url: MOCK + '/bigguide.xml?ch=' + N + '&days=3&desc=400', offset: 0 }], pubEpg: { on: false } }] };
  await page.addInitScript(([s]) => {
    if (!sessionStorage.getItem('gb')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('gb', '1'); }
    localStorage.setItem('tivibro.devRelay', '47811');
  }, [JSON.stringify(settings)]);
  const t0 = Date.now();
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  let peak = 0;
  const watch = setInterval(() => ev(() => performance.memory && performance.memory.usedJSHeapSize).then(v => { if (v > peak) peak = v; }, () => {}), 500);
  await page.waitForFunction(() => Epg.status.at && !Epg.loading && !Epg.progress.active, null, { timeout: 600000 });
  clearInterval(watch);
  const took = Date.now() - t0;
  ok('the helper read it, not the app', await ev(() => Epg.inHelper));
  const st = await ev(() => { const ch = Library.data.channels.filter(c => /^big\./.test(c.epg || '')); return { all: ch.length, with: ch.filter(c => Epg.hasData(c)).length, report: Epg.status.sources }; });
  ok('every channel has its guide', st.with >= N * 0.98, st.with + ' of ' + st.all + '  ' + JSON.stringify(st.report));
  const mem = await ev(() => { if (window.gc) gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });
  ok('the app stays small while loading and after', peak < 300e6 && mem < 250e6, 'peak ' + Math.round(peak / 1e6) + ' MB, after ' + Math.round(mem / 1e6) + ' MB, ' + Math.round(took / 1000) + ' s');
  const span = await ev(() => { const c = Library.data.channels.find(x => x.epg === 'big.10'), l = Epg.request(c) || []; return { n: l.length, last: l.length ? l[l.length - 1].e - Date.now() : 0, d: l.filter(p => p.d).length }; });
  ok('days of programmes, not hours', span.n > 100 && span.last > 2 * 86400e3, JSON.stringify(span));
  ok('no descriptions held until shown', span.d === 0, span.d);
  // A description when it is shown.
  const d0 = await ev(() => { const c = Library.data.channels.find(x => x.epg === 'big.' + (window.__n - 1)) || Library.data.channels.find(x => x.epg === 'big.3999'); const nn = Epg.nowNext(c); return Epg.desc(c, nn.now); });
  await page.waitForTimeout(800);
  const d1 = await ev(n => { const c = Library.data.channels.find(x => x.epg === 'big.' + (n - 1)); const nn = Epg.nowNext(c); return Epg.desc(c, nn.now); }, N);
  ok('a description arrives when it is shown', d0 === '' && new RegExp('^' + (N - 1) + '-\\d+ Lorem').test(d1), JSON.stringify([d0, d1.slice(0, 40)]));
  const hits = await ev(n => Epg.search('Big show ' + (n - 1) + '-20', 5).map(r => r.key + ' ' + r.p.t), N);
  ok('search finds a programme on the last channel', hits.length && hits[0].indexOf('big.' + (N - 1)) === 0, JSON.stringify(hits));
  // The grid shows it.
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(1500);
  const cells = await ev(() => [].slice.call(document.querySelectorAll('.gp')).filter(e => e.style.display !== 'none' && e.textContent.trim()).length);
  ok('the guide grid fills', cells > 10, cells);
  // Start again: from the helper's storage, no download.
  const at = await ev(() => Epg.status.at);
  const t1 = Date.now();
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Epg.status.at && !Epg.loading, null, { timeout: 120000 });
  const back = await ev(a => ({ same: Epg.status.at === a, n: Library.data.channels.filter(c => /^big\./.test(c.epg || '') && Epg.hasData(c)).length }), at);
  ok('a restart reads what the helper stored, without downloading', back.same && back.n >= N * 0.98, JSON.stringify(back) + ' in ' + Math.round((Date.now() - t1) / 1000) + ' s');
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all big guide checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
