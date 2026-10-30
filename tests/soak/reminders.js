/* Reminders and the TV's own alert:
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/reminders.js
   The app hands its reminders to the helper (a stand-in PalmServiceBridge records the calls), keeps
   them while it is in the background, asks about late and missed ones when it comes back, and opens
   the channel when Watch on the TV's alert brings it forward (webOSRelaunch). */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 240) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl], remindBefore: 0 } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await page.waitForTimeout(2500);
  const ev = (f, a) => page.evaluate(f, a);
  // Stand-in for the webOS bus, installed after start-up so the network helper still uses the dev relay.
  await ev(() => {
    window.__luna = [];
    window.PalmServiceBridge = function () { this.call = function (uri, p) { window.__luna.push({ uri: uri, p: JSON.parse(p) }); var self = this; setTimeout(function () { if (self.onservicecallback) self.onservicecallback(JSON.stringify({ returnValue: true, count: 1, scheduled: 1 })); }, 10); }; };
    window.__hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return window.__hidden; } });
  });
  const live = await ev(() => { const c = Library.data.channels.find(x => x.arch > 0); return c.k; });
  const H = 3600e3;

  // 1. Reminders go to the helper.
  await ev(([k, H]) => { Store.edits.reminders.push({ k: k, s: Date.now() + H, e: Date.now() + 2 * H, t: 'Test Show' }); Store.saveEdits(); }, [live, H]);
  await page.waitForTimeout(5600);
  const sent = await ev(() => window.__luna.filter(x => /\/reminders$/.test(x.uri)).pop());
  ok('the reminders reach the helper', sent && sent.p.list.length === 1 && sent.p.list[0].t === 'Test Show' && sent.p.list[0].ch && sent.p.pid === (await ev(() => Store.settings.active)) && sent.p.visible === true, JSON.stringify(sent && sent.p));

  // 2. In the background a due reminder waits; the helper is told TiviBro is not on screen.
  await ev(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await ev(([k, H]) => { Store.edits.reminders = [{ k: k, s: Date.now() - 10 * 60000, e: Date.now() + H, t: 'Late Show' }]; Store.saveEdits(); }, [live, H]);
  await page.waitForTimeout(5600);
  ok('the helper hears TiviBro went to the background', await ev(() => window.__luna.some(x => /\/visible$/.test(x.uri) && x.p.visible === false)));
  ok('a due reminder waits while TiviBro is in the background', await ev(() => Store.edits.reminders.length === 1 && !UI.modalOpen));
  await ev(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(5600);
  const late = await ev(() => UI.modalOpen && document.getElementById('modal').innerText);
  ok('back on screen: it asks, saying when it started, with Watch from the start', late && /Started at/.test(late) && /Late Show/.test(late) && /Watch from the start/.test(late), late);
  await ev(() => UI.close());

  // 3. Over while away, on a catch-up channel.
  await ev(([k, H]) => { Store.edits.reminders = [{ k: k, s: Date.now() - 2 * H, e: Date.now() - H, t: 'Missed Show' }]; Store.saveEdits(); }, [live, H]);
  await page.waitForTimeout(5600);
  const missed = await ev(() => UI.modalOpen && document.getElementById('modal').innerText);
  ok('a missed one is offered from catch-up', missed && /You missed it/.test(missed) && /Watch it from the start/.test(missed), missed);
  await ev(() => UI.close());

  // 4. Watch on the TV's alert: TiviBro brought forward with launch params.
  const s = Date.now() + 60000;
  await ev(([k, s, H]) => { Store.edits.reminders = [{ k: k, s: s, e: s + H, t: 'Alert Show' }]; Store.saveEdits(); Views.stopAll(); }, [live, s, H]);
  await ev(([k, s]) => document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { reminder: { pid: Store.settings.active, k: k, s: s } } })), [live, s]);
  await page.waitForTimeout(2500);
  const st = await ev(k => ({ playing: Player.current && Player.current.k, full: Views.full, left: Store.edits.reminders.length }), live);
  ok('Watch opens TiviBro fullscreen on the channel and uses up the reminder', st.playing === live && st.full && st.left === 0, JSON.stringify(st));
  // A relaunch without a reminder (the TiviBro icon) changes nothing.
  await ev(() => document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: {} }))); await page.waitForTimeout(500);
  ok('an ordinary relaunch leaves playback alone', await ev(k => Player.current && Player.current.k === k, live));
  ok('launch params are read from a string too', await ev(() => { const r = Remind.params('{"reminder":{"pid":"p1","k":"9","s":5}}'); return r && r.k === '9' && !Remind.params('') && !Remind.params('{}'); }));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failure(s)' : 'all reminder checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL harness: ' + e.message); process.exit(1); });
