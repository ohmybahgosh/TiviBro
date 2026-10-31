/* The phone as a remote, and Play on TV, with TiviBro in a browser and the reference client as the phone.
     node tests/soak/phone-remote.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = 'http://127.0.0.1:47811';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: true });
  s = await ctl('/companion/pair', { open: true });
  const T = { host: '127.0.0.1', port: s.port };
  const cred = await C.pair(T, s.pairing.code, { name: 'Remote test' });

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  // The channel list for the phone.
  let l = null;
  for (let i = 0; i < 20 && !(l && l.channels); i++) { l = await C.call(cred, 'GET', '/v1/lineup'); if (!l.channels) await wait(700); }
  const count = await ev(() => Library.channels(Library.ALL).length);
  ok('the phone gets the channel list, as on the TV', l && l.channels && l.channels.length === count && l.groups.length > 0 && l.channels.every((c) => c.k && c.n), l && JSON.stringify({ n: l.channels && l.channels.length, count }));
  ok('with what is on now', l.channels.filter((c) => c.now && c.now.t).length > 0);
  ok('and the groups as shown on the TV', l.groups.every((g) => g.name && g.keys.length));

  // Play on TV.
  const pick = l.channels[5];
  const st0 = await C.call(cred, 'GET', '/v1/state');
  const waiting = C.call(cred, 'GET', '/v1/state?since=' + st0.rev + '&wait=1');
  await C.call(cred, 'POST', '/v1/play', { k: pick.k });
  await page.waitForTimeout(2500);
  const tv = await ev(() => ({ k: Views.playing && Views.playing.k, full: Views.full }));
  ok('Play on TV plays that channel full screen', tv.k === pick.k && tv.full, JSON.stringify(tv));
  let st = await waiting;
  for (let i = 0; i < 6 && !(st.state && st.state.playing && st.state.playing.k === pick.k); i++) st = await C.call(cred, 'GET', '/v1/state?since=' + st.rev + '&wait=1');
  ok('the phone hears what is playing', st.state && st.state.playing && st.state.playing.k === pick.k && st.state.playing.name === pick.n && st.state.full === true, JSON.stringify(st.state));
  ok('with the programme on now', !!(st.state.now && st.state.now.t), JSON.stringify(st.state.now));

  // Keys: Channel + zaps.
  await C.call(cred, 'POST', '/v1/key', { key: 'chup' });
  await page.waitForTimeout(2000);
  const after = await ev(() => Views.playing && Views.playing.k);
  ok('Channel + from the phone changes channel', after && after !== pick.k, after);
  // Back leaves fullscreen.
  // Back from the phone works like Back on the remote: the first may close the info panel a zap opened.
  for (let i = 0; i < 3 && await ev(() => Views.full); i++) { await C.call(cred, 'POST', '/v1/key', { key: 'back' }); await page.waitForTimeout(900); }
  ok('Back from the phone leaves fullscreen', await ev(() => !Views.full));
  // Actions: the guide.
  await C.call(cred, 'POST', '/v1/action', { action: 'guide' });
  await page.waitForTimeout(1000);
  ok('Guide from the phone opens the guide', await ev(() => Views.tab === 'guide'));
  // Text: search on the TV.
  await C.call(cred, 'POST', '/v1/text', { text: 'news' });
  await page.waitForTimeout(1800);
  const q = await ev(() => ({ tab: Views.tab, q: (document.querySelector('.search-input') || {}).value, rows: [].slice.call(document.querySelectorAll('.search-list .row')).filter((r) => r.offsetHeight).length }));
  ok('typing on the phone searches on the TV', q.tab === 'search' && q.q === 'news' && q.rows > 0, JSON.stringify(q));
  ok('TiviBro says who sent it', await ev(() => Log.lines().some((x) => /From Remote test: play/.test(x))));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  for (const p of (await ctl('/companion/status')).phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: false });
  console.log(fails ? fails + ' FAILED' : 'all phone remote checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
