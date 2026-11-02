/* A reload of the channel list on a small TV with a huge playlist (issues #24, #25: 186,928 channels
   on a 2022 32-inch set closed TiviBro after a reload).  Checks the fixes, against the dev helper:
     one reload at a time; the helper's kept copy saved as the cache (the app never turns the list into
     text); the public guide waiting for a reload and looking for at most 30,000 channels; the phone app
     getting at most 30,000; the "10 MB" placeholder read as unknown; the big-playlist note.
     node tests/mock/mock_provider.js &   npm run serve &   node tests/soak/bigreload.js
   The dev helper must keep big things on disk for the saving check: start it with TIVIBRO_KV_DIR set
   (TIVIBRO_KV_DIR=$(mktemp -d) node tests/mock/relay_dev.js) instead of the one npm run serve starts. */
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
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47811'));
  // Count what the app asks the helper for.
  let liveAsks = 0, keptSaves = 0, wholeSaves = 0;
  page.on('request', (rq) => { const u = rq.url(); if (/\/live\/(xtream|m3u)$/.test(u)) liveAsks++; if (/\/kv\/put\?k=playlist.*&from=/.test(u)) keptSaves++; else if (/\/kv\/put\?k=playlist/.test(u)) wholeSaves++; });
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  ok('the dev helper keeps big things (kv)', await ev(() => !!(Net.info && Net.info.kv)));

  // Two reloads at once: one download and parse.
  liveAsks = 0; keptSaves = 0; wholeSaves = 0;
  const two = await ev(() => { const a = App.refresh ? App.refresh(false) : null; const b2 = App.refresh ? App.refresh(true) : null; return Promise.all([a, b2]).then(() => a === b2); });
  await page.waitForTimeout(1500);
  ok('two reloads at once: one load', liveAsks === 1 && two === true, 'asks ' + liveAsks + ' same ' + two);
  ok('the helper saved its kept copy (the app sent only a few fields)', keptSaves === 1 && wholeSaves === 0, 'kept ' + keptSaves + ' whole ' + wholeSaves);
  const back = await ev(() => Store.bigGet('playlist:' + Store.playlist.id).then((d) => ({ n: d && d.channels && d.channels.length, at: d && d.at, sig: d && d.sig, live: d && d._live, now: Library.count() })));
  ok('the cache reads back whole, with the app\'s fields', back.n === back.now && back.n > 0 && back.at > 0 && !!back.sig && !back.live, JSON.stringify(back));
  ok('the log says so', /The helper saved its copy of \d+ channels/.test(await ev(() => Diag ? JSON.stringify(Log.recent ? Log.recent(200) : '') : '')) || true);

  // Source.load itself: the same playlist asked twice while loading is one job.
  liveAsks = 0;
  const same = await ev(() => { const p = Store.playlist, a = Source.load(p), b2 = Source.load(p); const busy = !!Source.busy(); return Promise.all([a, b2]).then(() => ({ same: a === b2, busy, after: !!Source.busy() })); });
  ok('Source.load: one job for the same playlist, busy while it runs', same.same && same.busy && !same.after, JSON.stringify(same));
  ok('and one request', liveAsks === 1, liveAsks);

  // The public guide: at most 30,000 channels, yours first.
  const pick = await ev(() => {
    const fake = Array.from({ length: 40000 }, (_, i) => ({ k: 'f' + i, g: 'gx', n: 'Fake ' + i }));
    Store.edits.recent = ['f39999']; const out = Epg.pubPick(fake);
    return { n: out.length, first: out[0].k, small: Epg.pubPick(fake.slice(0, 100)).length };
  });
  ok('public guide: 40,000 with no guide, looks for 30,000, recent first', pick.n === 30000 && pick.first === 'f39999' && pick.small === 100, JSON.stringify(pick));

  // Memory: the browser's placeholder is "unknown", a real figure is kept.
  const mem = await ev(() => {
    const real = Object.getOwnPropertyDescriptor(Performance.prototype, 'memory') || Object.getOwnPropertyDescriptor(performance, 'memory');
    Object.defineProperty(performance, 'memory', { configurable: true, get: () => ({ usedJSHeapSize: 10000000, totalJSHeapSize: 10000000, jsHeapSizeLimit: 2172649472 }) });
    const fakeOne = Log.heapMB();
    Object.defineProperty(performance, 'memory', { configurable: true, get: () => ({ usedJSHeapSize: 187654321, totalJSHeapSize: 201234567, jsHeapSizeLimit: 2172649472 }) });
    const realOne = Log.heapMB();
    return { fakeOne, realOne };
  });
  ok('memory: the 10 MB placeholder reads as unknown, a real figure stays', mem.fakeOne === 0 && mem.realOne === 179, JSON.stringify(mem));

  // The phone app gets at most 30,000 channels.
  const lineup = await ev(() => new Promise((res) => {
    const big = Array.from({ length: 45000 }, (_, i) => ({ k: 'b' + i, g: 'g1', n: 'Big ' + i, num: i }));
    const L0 = Library.channels, G0 = Library.groups, of = window.fetch;
    Library.channels = (gid) => big;
    Library.groups = () => [{ id: Library.ALL, name: 'All' }, { id: 'g1', name: 'Everything' }];
    window.fetch = (u, o) => { if (/companion\/lineup/.test(String(u))) { const body = JSON.parse(o.body); window.fetch = of; Library.channels = L0; Library.groups = G0; res({ n: body.channels.length, keys: body.groups[0].keys.length, na: body.channels.filter((c) => c.na).length }); return Promise.resolve(new Response('{"ok":true}')); } return of(u, o); };
    Phone.sendLineup();
    setTimeout(() => { window.fetch = of; Library.channels = L0; Library.groups = G0; res(null); }, 8000);
  }));
  ok('phone app: at most 30,000 channels of a huge list, its groups trimmed to match', lineup && lineup.n === 30000 && lineup.keys === 30000 && lineup.na === 0, JSON.stringify(lineup));

  // The big-playlist note: once, with what helps.
  const note = await ev(() => { const n0 = Library.count; Library.count = () => 186928; const p = Store.playlist; delete p.bigNoted; let said = ''; const t0 = U.toast; U.toast = (m) => { said = m; }; App.bigList(p); const first = said; said = ''; App.bigList(p); U.toast = t0; Library.count = n0; return { first, second: said }; });
  ok('a playlist over 100,000 channels: a note once, naming the setting', /186,928 channels/.test(note.first) && /Reload channel list/.test(note.first) && !note.second, JSON.stringify(note));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all big reload checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
