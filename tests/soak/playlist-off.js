/* A playlist turned off instead of deleted: kept with its login and everything set for it, left out of
   switching, and back with one press.  On the TV's Settings (as the phone app drives it) and in the web editor.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/playlist-off.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; tv.on('pageerror', (e) => errs.push(e.message));
  const one = R.SETTINGS.playlists[0], two = Object.assign({}, one, { id: 'p2', name: 'Second provider' });
  await tv.addInitScript(R.init({ time: R.primeTime(), settings: { playlists: [one, two], active: one.id } })[0]);
  await tv.goto(APP);
  await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await tv.waitForTimeout(1500);
  const ev = (f, a) => tv.evaluate(f, a);
  try {
    const sa = (sec, path, n, op, a) => ev(([sec, path, n, op, a]) => Promise.resolve(n == null ? Settings.phone.page(sec, path) : Settings.phone.change(sec, path, n, op, a || {})), [sec, path, n, op, a]);
    let pls = await sa('playlists', []);
    const second = pls.rows.find((x) => /^Second provider/.test(x.label));
    let pg = await sa('playlists', [second.i]);
    let on = pg.rows.find((x) => x.label === 'Playlist on');
    ok('each playlist has an on switch', on && on.kind === 'toggle' && on.on === true, JSON.stringify(on));
    await sa('playlists', [second.i], on.i, 'toggle', { on: false });
    pg = await sa('playlists', [second.i]);
    ok('turned off: kept, marked Off, no Use this playlist', await ev(() => Store.settings.playlists.some((p) => p.id === 'p2' && p.off && p.server)) && !pg.rows.some((x) => x.label === 'Use this playlist'),
      pg.rows.map((x) => x.label).join(' | '));
    pls = await sa('playlists', []);
    ok('the list says it is off', /^Off/.test(pls.rows.find((x) => /^Second provider/.test(x.label)).sub), pls.rows.find((x) => /^Second provider/.test(x.label)).sub);
    // The one in use can't be turned off while it is the only one on.
    const first = pls.rows.find((x) => x.kind === 'page' && !/^Second provider/.test(x.label));
    pg = await sa('playlists', [first.i]);
    on = pg.rows.find((x) => x.label === 'Playlist on');
    const r = await sa('playlists', [first.i], on.i, 'toggle', { on: false });
    ok('the only playlist on stays on, and says why', await ev(() => !Store.playlist.off) && /only playlist that is on/.test(r.msg || (await ev(() => document.getElementById('toast').textContent))), JSON.stringify(r).slice(0, 200));
    // Back on from the web editor.
    await ev(() => WebEdit.stop()); const st = await ev(() => WebEdit.start()); const pw = await ev(() => WebEdit.password());
    const ed = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); ed.on('pageerror', (e) => errs.push('editor: ' + e.message));
    await ed.goto('http://127.0.0.1:' + st.port + '/#k=' + pw + '/playlists'); await ed.waitForSelector('#plList .card', { timeout: 20000 }); await ed.waitForTimeout(800);
    const card = await ed.innerText('#plList');
    ok('the web editor shows it as Off, with Turn on and no Use on the TV for it', /Second provider\s*Off/.test(card) && /Turn on/.test(card), card.replace(/\s+/g, ' ').slice(0, 300));
    await ed.click('button[data-pl="on"][data-id="p2"]'); await ed.waitForTimeout(2500);
    ok('Turn on in the web editor turns it on again on the TV', await ev(() => !Store.settings.playlists.find((p) => p.id === 'p2').off));
    await ed.click('button[data-pl="off"][data-id="p2"]'); await ed.waitForTimeout(2500);
    ok('and Turn off turns it off', await ev(() => !!Store.settings.playlists.find((p) => p.id === 'p2').off));
    await ev(() => WebEdit.stop());
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all playlist on and off checks passed');
  process.exit(fails ? 1 : 0);
})();
