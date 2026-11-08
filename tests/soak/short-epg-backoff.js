/* Issue #64: a provider whose per-channel guide answers 502 for every channel.  TiviBro stops asking after a few
   failures in a row instead of going through every channel in view (about a hundred requests in seconds).
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/short-epg-backoff.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  let asked = 0, broken = true;
  await page.route(/get_short_epg/, (route) => {
    asked++;
    if (broken) return route.fulfill({ status: 502, contentType: 'text/html', body: '<!DOCTYPE html><html>Bad Gateway</html>' });
    return route.continue();
  });
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK, providerEpg: 'short', epgSources: [], pubEpg: { on: false } });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 20, null, { timeout: 30000 });
    // Every channel's guide asked for at once, as a guide page or the phone's list would.
    const ask = () => ev(() => { Library.data.channels.slice(0, 80).forEach((c) => Epg.request(c)); });
    await ask(); await page.waitForTimeout(3000);
    await ask(); await page.waitForTimeout(3000);
    ok('asking stops after a few failures, not one per channel', asked >= 5 && asked <= 10, asked + ' requests');
    const said = await ev(() => (Log.lines ? Log.lines() : []).filter((l) => /per-channel guide keeps failing/.test(l.msg || l)).length);
    ok('the log says so once', said === 1, said);
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all short guide backoff checks passed');
  process.exit(fails ? 1 : 0);
})();
