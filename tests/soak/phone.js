/* Settings, Phone app, on the TV, with a "phone" (the reference client, scripts/companion/tb-phone.js).
     node tests/soak/phone.js      (mock provider on :8077, npm run serve)
   Switching the connection on, pairing with the code shown on the TV, the phone listed in Settings,
   the phone asking for the web editor (TiviBro starts it and the phone opens it signed in), opened
   by a phone, renaming the TV, removing the phone, and switching it off. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = 'http://127.0.0.1:47811';
const SHOTS = process.env.SHOTS || '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

(async () => {
  // A clean start: off, nobody paired.
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: false, name: '' });

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const text = () => ev(() => document.body.innerText);
  const row = (re) => ev((src) => { const r = [].slice.call(document.querySelectorAll('.set-scroll .opt')).find((d) => new RegExp(src).test(d.innerText)); if (r) { r.click(); return true; } return false; }, re.source);
  const modal = () => ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText : ''; });

  ok('TiviBro tells the helper its version', (await ctl('/companion/status')).ownName === '' && (await (await fetch(RELAY + '/companion/status')).json()).on === false);
  await ev(() => { if (UI.modalOpen) UI.close(); Views.switchTab('settings'); Settings.open(); }); await page.waitForTimeout(600);
  const navRel = await ev(() => [].map.call(document.querySelectorAll('#setNav > div'), (d) => d.innerText.trim()));
  ok('a release build has no Phone app section yet', navRel.indexOf('Phone app') < 0 && !(await ev(() => Settings.section('phone'))), navRel.join(', '));
  await ev(() => { TIVIBRO_VERSION = '0.6.0-alpha.99'; Settings.open(); Settings.section('phone'); }); await page.waitForTimeout(800);
  const navTest = await ev(() => [].map.call(document.querySelectorAll('#setNav > div'), (d) => d.innerText.trim()));
  ok('test builds have it', navTest.indexOf('Phone app') > 0, navTest.join(', '));
  let t = await text();
  ok('Settings has a Phone app section, off at first', /Phone app/.test(t) && /Phone app connection[^‹]*‹Off›/.test(t) && !/Pair a phone…/.test(t), t.slice(t.indexOf('The TiviBro app'), t.indexOf('The TiviBro app') + 400));
  await row(/^Phone app connection/); await page.waitForTimeout(1200);
  t = await text();
  ok('switching it on shows Pair a phone, no phones yet, and the address', /Phone app connection[^‹]*‹On›/.test(t) && /Pair a phone/.test(t) && /None yet/.test(t) && /, port 47810/.test(t), t.slice(0, 600));
  const h0 = await C.hello({ host: '127.0.0.1', port: 47810 });
  ok('the TV answers on the network, with TiviBro\'s version', h0.app === 'TiviBro' && h0.version && h0.version !== 'dev', JSON.stringify(h0));

  await row(/^Pair a phone…/); await page.waitForTimeout(1500);
  let m = await modal();
  const code = (/([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(m) || [])[1];
  ok('Pair a phone: steps, a code, a QR code and how long it works', !!code && /Open the TiviBro app/.test(m) && /Works for 9:5\d|Works for 10:00/.test(m) && /Waiting for your phone/.test(m) && await ev(() => !!document.querySelector('#modal .pair-qr svg')), m);
  await shot('phone-pair');
  let e = await C.pair({ host: '127.0.0.1', port: 47810 }, 'ZZZZ-ZZZZ-ZZZZ', { name: 'Guess' }).catch((x) => x);
  await page.waitForTimeout(1300);
  ok('a wrong code is refused, and the TV says so', e.code === 'wrong' && /wrong code \(1 of 5\)/.test(await modal()), await modal());
  const cred = await C.pair({ host: '127.0.0.1', port: 47810 }, code, { name: 'Soak Phone', model: 'Pixel 9', platform: 'android' });
  await page.waitForTimeout(1500);
  m = await modal();
  ok('the right code pairs, and the TV shows it at once', !!cred.phone && /Paired with Soak Phone/.test(m), m);
  await shot('phone-paired');
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  t = await text();
  ok('the phone is listed in Settings', /Soak Phone/.test(t) && /Pixel 9/.test(t) && /Last seen just now/.test(t) && !/None yet/.test(t), t.slice(0, 700));
  await shot('phone-settings');

  // The phone asks for the web editor: TiviBro starts it, the phone gets a signed-in address.
  await ev(() => { if (WebEdit.on) return WebEdit.stop(); });
  let r = await C.call(cred, 'POST', '/v1/editor', {});
  ok('editor: the phone is told it is starting', r.state === 'starting', JSON.stringify(r));
  let url = '';
  for (let i = 0; i < 10 && !url; i++) { await page.waitForTimeout(1000); r = await C.call(cred, 'POST', '/v1/editor', {}); if (r.state === 'ready') url = r.url; }
  ok('TiviBro starts the editor for the phone within a few seconds', /#t=[0-9a-f]{48}$/.test(url) && await ev(() => WebEdit.on), url);
  if (url) {
    const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await ph.goto(url); await ph.waitForTimeout(3000);
    const pt = await ph.evaluate(() => ({ login: !!(document.getElementById('loginForm') && document.getElementById('loginForm').offsetParent), hash: location.hash, body: document.body.innerText.slice(0, 200) }));
    ok('the editor opens on the phone signed in, and the session leaves the address bar', !pt.login && !/t=/.test(pt.hash), JSON.stringify(pt));
    await ph.context().close();
  }

  // Opened by a phone while running: handled, not taken for a reminder.
  await ev(() => document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { companion: { open: true } } })));
  await page.waitForTimeout(300);
  ok('brought forward by the phone app', await ev(() => Log.lines().some((l) => /Opened from the phone app/.test(l))));

  // Name the TV.
  await ev(() => Phone.rename('Den TV')); await page.waitForTimeout(500);
  ok('the TV\'s name reaches the phone', (await C.hello({ host: '127.0.0.1', port: 47810 })).name === 'Den TV' && (await C.call(cred, 'GET', '/v1/info')).name === 'Den TV');

  // Remove the phone in Settings.
  await ev(() => Settings.section('phone')); await page.waitForTimeout(600);
  await row(/^Soak Phone/); await page.waitForTimeout(600);
  ok('a phone\'s menu offers Remove', /Remove this phone/.test(await modal()), await modal());
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(200);     // the menu starts on Cancel
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  e = await C.call(cred, 'GET', '/v1/info').catch((x) => x);
  t = await ev(() => [].map.call(document.querySelectorAll('.set-scroll .opt'), (d) => d.innerText).join('\n'));
  ok('removed: gone from Settings, and the phone can no longer connect', !/Soak Phone/.test(t) && /None yet/.test(t) && e.code === 'unpaired', t.slice(0, 300) + ' / ' + e.message);

  // Off.
  await row(/^Phone app connection/); await page.waitForTimeout(1200);
  t = await text();
  e = await C.hello({ host: '127.0.0.1', port: 47810 }).catch((x) => x);
  ok('switching it off: nothing answers on the network', /Phone app connection[^‹]*‹Off›/.test(t) && e instanceof Error, t.slice(0, 300));
  await ctl('/companion/set', { name: '' });

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all phone app checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
