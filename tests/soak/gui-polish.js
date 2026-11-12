/* Discussion #36's screen polish in the real app: lists show whole rows (none cut by the button hints),
   Settings shown: Everyday leaves out the rarely changed ones (the TV and the phone alike), and a channel slow
   to start asks what to do.
     npm run serve &
     node tests/soak/gui-polish.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  // A provider that takes the request and never sends anything.
  const hang = http.createServer(() => {}); await new Promise((f) => hang.listen(0, '127.0.0.1', f));
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    // Whole rows: no row of a list goes past the list's bottom (the button hints are right under it).
    const cut = async () => ev(() => [].slice.call(document.querySelectorAll('.vlist')).filter((l) => l.offsetHeight).map((l) => {
      const lb = l.getBoundingClientRect().bottom;
      return [].slice.call(l.querySelectorAll('.row')).filter((r) => r.style.display !== 'none' && r.offsetHeight && r.getBoundingClientRect().bottom > lb + 1).length;
    }).reduce((a, n) => a + n, 0));
    await ev(() => Views.switchTab('live')); await page.waitForTimeout(800);
    ok('Channels screen: no row cut by the bottom of its list', (await cut()) === 0);
    await ev(() => Views.switchTab('search')); await page.waitForTimeout(400);
    await ev(() => { const i = document.querySelector('.search-input'); i.value = 'news'; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(1200);
    ok('Search: no row cut by the bottom of its list', (await cut()) === 0);

    // Settings shown: Everyday.
    await ev(() => { Views.switchTab('settings'); Settings.open(); }); await page.waitForTimeout(400);
    const all = await ev(() => Settings.phone.page('playback', []).rows.map((r) => r.label));
    await ev(() => { Store.settings.setLevel = 'basic'; });
    const basic = await ev(() => Settings.phone.page('playback', []).rows.map((r) => r.label));
    const pl = await ev(() => { const r = Settings.phone.page('playlists', []).rows; const i = r.findIndex((x) => x.page || x.kind === 'page'); return i >= 0 ? Settings.phone.page('playlists', [i]).rows.map((x) => x.label) : []; });
    ok('Everyday leaves out the player engine, the buffer details and the like', all.indexOf('Player engine') >= 0 && basic.indexOf('Player engine') < 0 && basic.indexOf('Read-ahead') < 0 && basic.indexOf('Buffer profile') >= 0, basic.join(', '));
    ok('and says how many more there are in All', basic.some((l) => /^\d+ more in All settings$/.test(l)), basic.slice(-2).join(' | '));
    ok('a playlist still shows its connection', pl.indexOf('Connection') >= 0, pl.join(', '));
    ok('Appearance has the choice', (await ev(() => Settings.phone.page('look', []).rows.map((r) => r.label))).indexOf('Settings shown') >= 0);
    await ev(() => { Store.settings.setLevel = 'all'; UI.close && UI.close(); });

    // A channel slow to start, fullscreen: after 20 s it asks.
    await ev((u) => { const c = Library.data.channels[2]; c.url = u; Views.startChannel(c, false, Views.goFull); }, 'http://127.0.0.1:' + hang.address().port + '/live/x/y/1.ts');
    await page.waitForTimeout(800);
    // Each try after the first says what went wrong and what is tried now, not just "Tuning".
    const first = await ev(() => document.getElementById('spinnerText').textContent);
    await page.waitForFunction(() => /having trouble starting/.test(document.getElementById('spinnerText').textContent), null, { timeout: 40000 }).catch(() => {});
    const tune = await ev(() => document.getElementById('spinnerText').textContent);
    ok('a channel with trouble says so, and what it tries now', /^Tuning/.test(first) && /^This channel is having trouble starting: .+\.\nTrying (?:again \(\d+ of \d+\)|the .+)…$/.test(tune), JSON.stringify({ first, tune }));
    await page.waitForFunction(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') && /Still starting/.test(m.innerText); }, null, { timeout: 45000 }).catch(() => {});
    const q = await ev(() => document.getElementById('modal').innerText);
    ok('after 20 seconds without a picture it asks, saying what it has seen', /Still starting/.test(q) && /Nothing has come from the provider yet|The provider answers with an error \(HTTP 5\d\d\)/.test(q) && /Keep trying/.test(q) && /Start over/.test(q) && /Stop/.test(q), q.slice(0, 300));
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);       // Keep trying (first)
    const closed = await ev(() => document.getElementById('modal').classList.contains('hidden'));
    ok('Keep trying closes it and goes on', closed);

    // A channel that played, then reconnects more than 20 s after it was picked: no question (it flashed open and
    // shut as the picture came back).
    await ev(() => Views.startChannel(Library.data.channels[0], false, Views.goFull));
    await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(21000);
    let asked = false;
    // What the question goes by, read every 20 ms through the reconnect (it is over in a moment against the mock).
    await ev(() => { window.__slow = []; const t = setInterval(() => { const x = Player.startStatus; if (x) window.__slow.push(x.ms); }, 20); setTimeout(() => clearInterval(t), 3000); Player._test.reconnect('test drop'); });
    for (let i = 0; i < 12 && !asked; i++) { await page.waitForTimeout(250); asked = await ev(() => { const m = document.getElementById('modal'); return !!m && !m.classList.contains('hidden') && /Still starting/.test(m.innerText); }); }
    const ss = await ev(() => window.__slow);
    ok('a reconnect after playing does not ask "Still starting"', !asked && !ss.some((ms) => ms >= 20000), JSON.stringify({ asked, slow: ss.slice(0, 5) }));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); hang.close();
  console.log(fails ? fails + ' FAILED' : 'all GUI polish checks passed');
  process.exit(fails ? 1 : 0);
})();
