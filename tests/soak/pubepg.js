/* The public guide fill-in (pubepg.js) against the mock's two public guides:
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/pubepg.js
   Local stations have no guide from the provider; the public pass fills them, half from each
   project (epg.pw style call-sign names, iptv-epg.org style "US - ABC KAXB" names behind no CORS),
   ignores a decoy from another service, and never touches channels the provider already covers. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl], pubEpgBase: MOCK + '/pubepg/' } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => Epg.pubStatus && Epg.pubStatus.at && !Epg.loading, null, { timeout: 60000 });

  const st = await ev(() => Epg.pubStatus);
  ok('it looked up the channels with no guide, in the US guides', st.asked > 0 && st.countries.join() === 'US', JSON.stringify(st));
  ok('both public guides were read', st.sources.length === 2 && st.sources.every(s => s.ok && s.filled > 0), JSON.stringify(st.sources));
  const locals = await ev(() => Library.data.channels.filter(c => /\b[KW][A-Z]X[A-Z]\b/.test(c.n) && !/WEST/.test(c.n)).map(c => {
    const nn = Epg.nowNext(c), src = Epg.pubSource(c);
    return { n: c.n, id: Epg.epgId(c), src: src && src.name, now: nn && nn.now && nn.now.t };
  }));
  const filled = locals.filter(x => x.src);
  ok('local stations got a guide', filled.length >= locals.length - 2 && filled.length > 10, filled.length + ' of ' + locals.length);
  ok('from both projects', filled.some(x => x.src === 'epg.pw') && filled.some(x => x.src === 'iptv-epg.org'), JSON.stringify(filled.slice(0, 4)));
  ok('the programmes are the public ones', filled.every(x => x.now && / Public /.test(x.now) && x.now.indexOf(x.n.match(/\b([KW][A-Z]X[A-Z])\b/)[1]) === 0), JSON.stringify(filled.find(x => !x.now || !/ Public /.test(x.now))));
  ok('a match from another service loses to the country one', !locals.some(x => /decoy/.test(x.id) || x.now === 'WRONG MATCH'));
  const kept = await ev(() => Library.data.channels.filter(c => c.epg && !/^\w+:[A-Z]{2}\//.test(Epg.epgId(c))).length);
  const prov = await ev(() => Library.data.channels.filter(c => c.epg).length);
  ok('channels the provider covers keep the provider guide', kept === prov, kept + ' of ' + prov);
  ok('the public guide channels can be picked by hand', await ev(() => Epg.guideChannels().some(x => /^iptvepg:US\//.test(x[0]))));
  ok('guide search sees public programmes', await ev(() => Epg.search('Public Local News', 5).length > 0));

  // Cached: a restart reads it back without downloading again.
  const at = st.at;
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Epg.pubStatus && Epg.pubStatus.at && !Epg.loading, null, { timeout: 60000 });
  ok('after a restart it comes from the TV, not a new download', await ev(a => Epg.pubStatus.at === a && Epg.pubStatus.filled > 10, at));

  // Reloading your own guide doesn't download the public ones again.
  await ev(() => Epg.refresh(Library, true));
  await page.waitForFunction(() => !Epg.loading && Epg.pubStatus && Epg.pubStatus.at, null, { timeout: 60000 });
  ok('"Reload guide now" leaves the public guides alone', await ev(a => Epg.pubStatus.at === a, at));

  // The sites are down: what the TV had stays.
  await ev(() => { Store.settings.pubEpgBase = 'http://127.0.0.1:9/pubepg/'; return Epg.pubAgain(); });
  await page.waitForFunction(() => !Epg.loading && Epg.pubStatus && Epg.pubStatus.at, null, { timeout: 60000 });
  ok('every file failing keeps the last public guide', await ev(() => Epg.pubStatus.filled > 10 && Library.data.channels.some(c => Epg.pubSource(c))), await ev(() => JSON.stringify(Epg.pubStatus)));
  await ev(m => { Store.settings.pubEpgBase = m + '/pubepg/'; }, MOCK);

  // Turned off while it runs: nothing turns up afterwards.
  await ev(() => { Epg.pubAgain(); PubEpg.set(Store.playlist, { on: false }); return Epg.refresh(Library, false); });
  await page.waitForTimeout(3000);
  ok('switching off mid-run wins', await ev(() => !Library.data.channels.some(c => Epg.pubSource(c))));
  await ev(() => { PubEpg.set(Store.playlist, { on: true }); return Epg.refresh(Library, false); });
  await page.waitForFunction(() => !Epg.loading && Epg.pubStatus && Epg.pubStatus.filled > 10, null, { timeout: 60000 });

  // Off: back to no guide for them.
  await ev(() => { PubEpg.set(Store.playlist, { on: false }); Store.saveSettings && Store.saveSettings(); return Epg.refresh(Library, false); });
  await page.waitForFunction(() => !Epg.loading, null, { timeout: 30000 });
  ok('turned off: no public guide', await ev(() => !Library.data.channels.some(c => Epg.pubSource(c))));

  // Countries by hand.
  await ev(() => { PubEpg.set(Store.playlist, { on: true, cc: ['CA'] }); return Epg.refresh(Library, false); });
  await page.waitForFunction(() => !Epg.loading && Epg.pubStatus, null, { timeout: 30000 });
  ok('a chosen country is used instead', await ev(() => Epg.pubStatus.countries.join() === 'CA'), await ev(() => JSON.stringify(Epg.pubStatus)));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
