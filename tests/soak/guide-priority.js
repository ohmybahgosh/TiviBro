/* The provider's guide comes first.  An extra guide source takes a channel over only where its programmes
   agree with the provider's (then its extra days are welcome); one with more days of other programmes doesn't.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/guide-priority.js
   Both ways the provider's guide is read: the full XMLTV file (decided when the guide loads) and per channel
   (decided when a channel is first shown, then remembered). */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res(b)); }).on('error', rej));

(async () => {
  const xml = await get(MOCK + '/agreeguide.xml');
  const ids = [...xml.matchAll(/<channel id="([^"]+)"/g)].map((m) => m[1]);
  ok('the extra guide has the two channels', ids.length === 2, xml.slice(0, 200));
  const b = await chromium.launch();
  for (const mode of ['xmltv', 'short']) {
    const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK, providerEpg: mode, epgSources: [{ url: MOCK + '/agreeguide.xml', offset: 0 }], pubEpg: { on: false } });
    await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
    await page.waitForFunction(() => Epg.xml && Epg.status && Epg.status.at && !Epg.loading, null, { timeout: 60000 });
    const ev = (f, a) => page.evaluate(f, a);
    const look = () => ev((ids) => ids.map((id) => {
      const c = Library.data.channels.find((x) => x.epg === id), l = Epg.request(c) || [], now = Date.now();
      return { id, days: l.length ? Math.round((l[l.length - 1].e - now) / 864e5 * 10) / 10 : 0, titles: l.filter((p) => p.e > now).slice(0, 3).map((p) => p.t) };
    }), ids);
    await look(); await page.waitForTimeout(mode === 'short' ? 3000 : 500);
    const [agree, differ] = await look();
    ok(mode + ': a source that agrees with the provider takes the channel, with its extra days', agree.days > 2.5 && !/Wrong/.test(agree.titles.join()), JSON.stringify(agree));
    ok(mode + ': a source with more days of other programmes does not', differ.days < 2.2 && differ.titles.length && !differ.titles.some((t) => /Wrong show/.test(t)), JSON.stringify(differ));
    if (mode === 'xmltv') {
      const rep = await ev(() => (Epg.status.sources || []).map((r) => ({ url: r.url, over: r.over, kept: r.kept })));
      ok('xmltv: the source\'s report says one taken over, one left to the provider', rep.some((r) => /agreeguide/.test(r.url) && r.over === 1 && r.kept === 1), JSON.stringify(rep));
    } else {
      // Remembered: a new start shows the provider's at once for the channel that disagrees.
      await page.waitForTimeout(2500); await page.reload();
      await page.waitForFunction(() => window.Library && Library.count() > 0 && Epg.xml && Epg.status && Epg.status.at && !Epg.loading, null, { timeout: 60000 });
      const id = await ev((x) => Epg.epgId(Library.data.channels.find((c) => c.epg === x)), ids[1]);
      ok('short: remembered after a restart (the provider\'s per-channel guide straight away)', id === '', JSON.stringify(id));
    }
    ok(mode + ': no page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all guide priority checks passed');
  process.exit(fails ? 1 : 0);
})();
