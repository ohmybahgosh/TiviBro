/* Full link (issue #11) on the TV's set-up screen and in the web editor: paste the provider's whole
   link, see what was found, and connect with the Xtream Codes section filled in.
     node tests/soak/full-link.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const LINK = 'http://127.0.0.1:8077/get.php?username=demo&password=demo&type=m3u_plus&output=ts';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('tv: ' + e.message));
  await page.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } localStorage.setItem('tivibro.devRelay', '47811'); });
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => document.querySelector('#viewSetup input'), null, { timeout: 30000 });
  const rows = () => ev(() => [].slice.call(document.querySelectorAll('#viewSetup .field label')).map(l => l.textContent));
  const r0 = await rows();
  ok('a new playlist starts on Full link', await ev(() => /Full link/.test(document.querySelector('#viewSetup .field .val').textContent)) && r0.indexOf('Full link') >= 0, r0.join(', '));
  await ev((l) => { const i = [].slice.call(document.querySelectorAll('#viewSetup .field')).find(d => d.querySelector('label').textContent === 'Full link').querySelector('input'); i.value = l; i.dispatchEvent(new Event('input')); }, LINK);
  const note = await ev(() => document.querySelector('#viewSetup .linknote').textContent);
  ok('the TV says what it found as you paste', /Found an Xtream Codes login for 127\.0\.0\.1:8077 \(username demo\)/.test(note), note);
  await page.screenshot({ path: '/tmp/fulllink-tv.png' });
  await ev(() => { const go = [].slice.call(document.querySelectorAll('#viewSetup .btn')).find(x => x.textContent === 'Connect'); go.click(); });
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }).catch(() => {});
  const pl = await ev(() => Store.playlist && { type: Store.playlist.type, server: Store.playlist.server, user: Store.playlist.user, link: Store.playlist.link });
  ok('Connect logs in as an Xtream Codes playlist', pl && pl.type === 'xtream' && /127\.0\.0\.1:8077/.test(pl.server) && pl.user === 'demo' && !pl.link, JSON.stringify(pl));

  // The web editor's Add a playlist form.
  await page.waitForFunction(() => window.WebEdit, null, { timeout: 10000 });
  await ev(() => WebEdit.start());
  const port = await ev(() => WebEdit.port()), pass = await ev(() => WebEdit.password());
  const ed = await ctx.newPage(); ed.on('pageerror', (e) => errs.push('editor: ' + e.message));
  await ed.goto('http://127.0.0.1:' + port + '/#k=' + pass);
  await ed.waitForFunction(() => document.getElementById('aLink'), null, { timeout: 20000 });
  await ed.evaluate(() => { location.hash = '#playlists'; });
  await ed.waitForTimeout(800);
  ok('the editor starts on Full link too', await ed.evaluate(() => document.querySelector('#addSeg .on').dataset.t === 'link' && !document.getElementById('aLink').closest('label').classList.contains('hidden')));
  await ed.evaluate((l) => { const i = document.getElementById('aLink'); i.value = l.replace('demo&', 'other&'); i.dispatchEvent(new Event('input')); }, LINK);
  const en = await ed.evaluate(() => document.getElementById('aLinkNote').textContent);
  ok('the editor says what it found', /username other/.test(en), en);
  await ed.evaluate(() => { document.getElementById('aGo').click(); });
  await ed.waitForTimeout(600);
  const filled = await ed.evaluate(() => ({ t: document.querySelector('#addSeg .on').dataset.t, s: document.getElementById('aServer').value, u: document.getElementById('aUser').value }));
  ok('Add and test shows the Xtream Codes section filled in', filled.t === 'xtream' && filled.s === 'http://127.0.0.1:8077' && filled.u === 'other', JSON.stringify(filled));
  await ed.waitForFunction(() => /Added|didn/.test(document.getElementById('addMsg').textContent), null, { timeout: 60000 }).catch(() => {});
  const res = await ed.evaluate(() => document.getElementById('addMsg').textContent);
  ok('and the TV adds it', /Added/.test(res), res);
  await ed.screenshot({ path: '/tmp/fulllink-editor.png' });
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all full link tests passed');
  process.exit(fails ? 1 : 0);
})();
