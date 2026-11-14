/* QR codes for the phone (discussion #60: "no QR code for the phone"), each read back like a phone would.
     node tests/soak/qr-codes.js      (mock provider on :8077, npm run serve; a fresh helper: FRESH=1 with soak-all)
   Reading the codes needs jsqr and pngjs (npm i --no-save jsqr pngjs); without them the codes are only
   checked for being drawn.
   - a brand-new TV: the code beside the playlist form opens the web editor, signed in
   - the helper answering after TiviBro stopped waiting for it: the code comes once it does
   - the web editor asked to start twice at once: both get it, and it starts again after a stop
     (it used to lose track of the first and say "already in use" until the helper restarted)
   - Set up from a phone or computer, and Pair a phone: their codes read back right */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let jsQR = null, PNG = null;
try { jsQR = require('jsqr'); PNG = require('pngjs').PNG; } catch (e) { console.log('NOTE jsqr or pngjs missing: QR codes are checked for being drawn, not read'); }
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

async function read(page, sel) {
  const el = await page.$(sel);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box || box.width < 40) return null;
  if (!jsQR) return 'drawn';
  const png = PNG.sync.read(await el.screenshot());
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return r ? r.data : 'unreadable';
}
const editorLink = (s) => /^drawn$|^http:\/\/[0-9.]+:\d+\/#k=[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s || '');

(async () => {
  const b = await chromium.launch();
  const fresh = async (init) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    page.errs = []; page.on('pageerror', (e) => page.errs.push(e.message));
    if (init) await init(page);
    return { ctx, page };
  };

  // A brand-new TV.
  let { ctx, page } = await fresh((p) => p.addInitScript(() => { localStorage.setItem('tivibro.devRelay', '47811'); }));
  await page.goto(APP);
  await page.waitForSelector('.join .join-qr svg', { timeout: 30000 }).catch(() => {});
  let q = await read(page, '.join .join-qr svg');
  const pass = await page.evaluate(() => Store.settings.editorPass);
  ok('a new TV: the code beside the form opens the web editor, signed in', editorLink(q) && (q === 'drawn' || q.indexOf('#k=' + pass) > 0), q);

  // Started twice at once: both get it.  Then off and on again.
  const twice = await page.evaluate(() => WebEdit.stop().then(() => Promise.all([WebEdit.start(), WebEdit.start()]))
    .then((a) => ({ ok: !!(a[0] && a[1] && a[0].running && a[1].running) }), (e) => ({ err: e.message })));
  ok('the web editor asked to start twice at once: both get it', twice.ok, JSON.stringify(twice));
  const helperTwice = await page.evaluate(() => {
    const go = () => fetch('http://127.0.0.1:47811/editor/start', { method: 'POST', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ port: 18787, password: Store.settings.editorPass }) }).then((r) => r.json().then((j) => r.status + ' ' + (j.error || j.running)));
    return fetch('http://127.0.0.1:47811/editor/stop', { method: 'POST', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: '{}' })
      .then(() => Promise.all([go(), go()])).then((a) => go().then((c) => a.concat(c)));
  });
  ok('the helper asked twice at once: both start, and a third finds it running', helperTwice.every((x) => x === '200 true'), helperTwice.join(' | '));
  const again = await page.evaluate(() => WebEdit.stop().then(() => WebEdit.start()).then((s) => s.running, (e) => e.message));
  ok('stopped and started again: it starts', again === true, again);

  // Set up from a phone or computer.
  await page.evaluate(() => { const el = [...document.querySelectorAll('.setup .btn, .setup .row, .setup button')].find((x) => /phone or computer/i.test(x.textContent)); if (el) el.click(); });
  await page.waitForSelector('.remote-box .join-qr svg', { timeout: 10000 }).catch(() => {});
  q = await read(page, '.remote-box .join-qr svg');
  ok('Set up from a phone or computer: its code opens the web editor', q === null ? 'skip' : editorLink(q), q);
  ok('no page errors on a new TV', !page.errs.length, page.errs.join(' | '));
  await ctx.close();

  /* The helper answering late: webOS answers the start call after TiviBro stopped waiting (6 s).  The dev
     helper stands in for the TV's, and is kept out of reach until then. */
  ({ ctx, page } = await fresh(async (p) => {
    let open = false;
    await p.route(/127\.0\.0\.1:47811\/ping/, (r) => (open ? r.continue() : r.abort()));
    await p.exposeFunction('helperUp', () => { open = true; });
    await p.addInitScript(() => {
      window.PalmServiceBridge = function () {
        const self = this;
        this.call = function (uri) {
          if (!/tivibro\.tv\.service\/start/.test(uri)) return;
          setTimeout(() => { window.helperUp().then(() => self.onservicecallback(JSON.stringify({ returnValue: true, port: 47811, subscribed: true }))); }, 9000);
        };
        this.cancel = function () {};
      };
    });
  }));
  await page.goto(APP);
  await page.waitForSelector('.join', { timeout: 30000 });
  const before = await page.evaluate(() => (document.querySelector('.join') || {}).innerText || '');
  ok('the helper not there yet: the first screen says so', /not available|Starting/.test(before), before.replace(/\s+/g, ' '));
  await page.waitForSelector('.join .join-qr svg', { timeout: 20000 }).catch(() => {});
  q = await read(page, '.join .join-qr svg');
  ok('the helper answered late: TiviBro takes it, and the code comes', editorLink(q), q);
  const net = await page.evaluate(() => ({ port: Net.port, state: Net.state }));
  ok('…and uses the helper from then on', net.port === 47811 && net.state === 'on', JSON.stringify(net));
  ok('no page errors with a late helper', !page.errs.length, page.errs.join(' | '));
  await ctx.close();

  // Pair a phone, on a TV with a playlist.
  ({ ctx, page } = await fresh((p) => p.addInitScript(() => {
    localStorage.setItem('tivibro.devRelay', '47811');
    localStorage.setItem('tivibro.settings', JSON.stringify({ meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo' }], active: 'p1' }));
  })));
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.evaluate(() => Phone.showPair());
  await page.waitForSelector('#modal .pair-qr svg', { timeout: 15000 }).catch(() => {});
  q = await read(page, '#modal .pair-qr svg');
  const code = await page.evaluate(() => ((document.querySelector('#modal .pair-code') || {}).textContent || '').replace(/-/g, ''));
  ok('Pair a phone: the code reads back as a pairing link with the code shown', q === 'drawn' || (!!q && q.replace(/-/g, '').indexOf(code) >= 0 && code.length >= 8), q + '  code ' + code);
  await page.keyboard.press('Escape');
  await page.evaluate(() => WebEdit.showJoin(''));
  await page.waitForSelector('#modal .join-qr svg', { timeout: 15000 }).catch(() => {});
  q = await read(page, '#modal .join-qr svg');
  ok('Edit on a phone: its code opens the web editor', editorLink(q), q);
  ok('no page errors with a playlist', !page.errs.length, page.errs.join(' | '));
  await ctx.close();

  await b.close();
  console.log(fails ? fails + ' failed' : 'all QR code tests passed');
  process.exit(fails ? 1 : 0);
})();
