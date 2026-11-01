/* The TV shows what the phone is doing during set-up (issue #8): a fresh TV's QR code screen says
   when a playlist arrives, when it failed and why, and when it was added.  Nothing plays by itself.
     node tests/soak/setup-feedback.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
function req(url, method, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(url), data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Token': token } : {}) }, (resp) => {
      let b = ''; resp.on('data', d => b += d); resp.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} res({ status: resp.statusCode, json: j }); });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } localStorage.setItem('tivibro.devRelay', '47811'); });
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.WebEdit && WebEdit.on && WebEdit.addresses().length, null, { timeout: 30000 });
  const port = await ev(() => WebEdit.port()), pass = await ev(() => WebEdit.password());
  const E = 'http://127.0.0.1:' + port;
  const T = (await req(E + '/api/login', 'POST', { password: pass })).json.token;
  const card = () => ev(() => { const a = document.querySelector('#viewSetup .join-act'); return a ? a.className + ' | ' + a.textContent : ''; });
  const shot = (n) => page.screenshot({ path: '/tmp/setup-' + n + '.png' });

  // A server that doesn't answer: the TV says so.
  await req(E + '/api/command', 'POST', { type: 'addPlaylist', args: { server: 'http://127.0.0.1:9', user: 'nobody', pass: 'wrong' } }, T);
  await page.waitForFunction(() => document.querySelector('#viewSetup .join-act'), null, { timeout: 15000 }).catch(() => {});
  let seen = await card();
  if (/busy/.test(seen)) { await page.waitForFunction(() => /err|ok/.test((document.querySelector('#viewSetup .join-act') || {}).className || ''), null, { timeout: 30000 }).catch(() => {}); seen = await card(); }
  await shot('error');
  ok('a failed playlist shows on the TV, with the reason', /join-act err/.test(seen) && /didn't work/.test(seen), seen);
  ok('the TV is still on the set-up screen', await ev(() => !document.getElementById('viewSetup').classList.contains('hidden')));

  // A good one: progress, then it was added, then the guide opens.  No video starts.
  await req(E + '/api/command', 'POST', { type: 'addPlaylist', args: { server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo' } }, T);
  await page.waitForFunction(() => /busy|ok/.test(((document.querySelector('#viewSetup .join-act') || {}).className || '')) && !/didn/.test(document.querySelector('#viewSetup .join-act').textContent), null, { timeout: 15000 }).catch(() => {});
  const during = await card();
  await shot('progress');
  ok('the TV shows the playlist arriving', /Checking the login|Added/.test(during), during);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && document.getElementById('viewSetup').classList.contains('hidden'), null, { timeout: 60000 }).catch(() => {});
  ok('then it opens on its own, as before', await ev(() => Library.count() > 0));
  await page.waitForTimeout(1500);
  ok('and nothing plays by itself', await ev(() => { const v = document.getElementById('video'); return !v.src || v.paused; }));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all set-up feedback tests passed');
  process.exit(fails ? 1 : 0);
})();
