/* The phone's Settings while TiviBro is behind another app on the TV (app/js/setsnap.js and service/companion.js):
   TiviBro leaves the helper a copy of its Settings, the phone reads it in its language, a switch changed then waits
   and is made when TiviBro is back.  "Behind another app" is the file service/dev-away (tests/mock/relay_dev.js).
     node tests/mock/mock_provider.js &   node tests/mock/relay_dev.js &   npm run serve &
     node tests/soak/phone-away.js */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = 'http://127.0.0.1:47811';
const AWAY = path.join(process.env.COMPANION_DIR || path.join(__dirname, '../../service'), 'dev-away');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  try { fs.unlinkSync(AWAY); } catch (e) {}
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: true });
  s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Away test' });
  const ask = (a, o) => C.ask(cred, 'settings', a, Object.assign({ seal: true, noOpen: true }, o || {}));
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && window.Phone && Phone.status && Phone.status.on, null, { timeout: 60000 });

  // On screen: TiviBro answers itself, and the phone's German is noted for the copy.
  let r = await ask({ op: 'sections' }, { lang: 'de' });
  ok('on screen: TiviBro answers (not the copy)', Array.isArray(r.data && r.data.sections) && !r.data.away, JSON.stringify(r).slice(0, 200));
  const clock = await ev(() => Store.settings.showClock !== false);
  await ev(() => SetSnap.soon(0));
  await page.waitForFunction(() => SetSnap.made > 0, null, { timeout: 60000 });
  await wait(1500);
  const made = await ev(() => SetSnap.made);
  ok('TiviBro made its copy of Settings', made > 0);

  // Behind another app.
  fs.writeFileSync(AWAY, '1');
  r = await ask({ op: 'sections' });
  ok('away: the sections come from the copy', r.data && r.data.away === true && r.data.sections.some((x) => x.id === 'look'), JSON.stringify(r).slice(0, 200));
  r = await ask({ op: 'page', sec: 'look', path: [] }, { lang: 'de' });
  ok('away: a page in German', !!(r.data && r.data.away && /Darstellung/.test(r.data.title)), r.data && r.data.title);
  r = await ask({ op: 'page', sec: 'look', path: [] });
  const row = r.data.rows.find((x) => x.label === 'Show clock');
  ok('away: the Appearance page with Show clock', !!row && row.on === clock, JSON.stringify(r.data.rows.map((x) => x.label)).slice(0, 200));
  r = await ask({ op: 'toggle', sec: 'look', path: [], i: row.i, on: !clock });
  ok('away: the switch is kept, shown changed and waiting', r.data.page.rows.find((x) => x.i === row.i).on === !clock && r.data.page.rows.find((x) => x.i === row.i).pending && /TiviBro/.test(r.data.msg), JSON.stringify(r).slice(0, 300));
  ok('...and the TV hasn\'t changed yet', (await ev(() => Store.settings.showClock !== false)) === clock);
  const e = await ask({ op: 'action', sec: 'look', path: [], i: 0 }).catch((x) => x);
  ok('away: a button still needs TiviBro', e && (e.closed || e.code === 'closed'), JSON.stringify(e).slice(0, 200));
  r = await ask({ op: 'find', q: 'clock' });
  ok('away: search works from the copy', r.data.hits.some((h) => h.label === 'Show clock'), JSON.stringify(r).slice(0, 200));

  // Back on screen: the change is made.
  fs.unlinkSync(AWAY);
  await ev(() => SetSnap.catchUp());
  await wait(800);
  ok('back on screen: the switch is made on the TV', (await ev(() => Store.settings.showClock !== false)) === !clock);
  ok('...and said so', /phone/.test(await ev(() => document.getElementById('toast').textContent)), await ev(() => document.getElementById('toast').textContent));
  await ev((v) => { Store.settings.showClock = v; Store.saveSettings(); }, clock);
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all away settings checks passed');
  process.exit(fails ? 1 : 0);
})().catch((x) => { try { fs.unlinkSync(AWAY); } catch (e) {} console.error(x); process.exit(1); });
