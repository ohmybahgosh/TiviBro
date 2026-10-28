/* UI speed on a provider-sized playlist, with the CPU slowed to roughly a TV's.
     MOCK_PORT=8088 MOCK_BIG=15000 node tests/mock/mock_provider.js &
     APP=http://127.0.0.1:8079/index.html SERVER=http://127.0.0.1:8088 node tests/soak/speed.js [--cpu 4] [--json out.json]
   Measures, per scenario:
     tap   time from a key press to the next painted frame (median and worst), one press at a time
     hold  a held arrow (key repeat, ~30/s): moves per second and the longest frame during the hold
   plus start-up time (first start, which downloads everything, and a cached start), JS heap and DOM size.
   Headless Chromium, so compare runs with each other; --cpu 4 is about a 2022-2024 LG TV. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const CPU = +opt('cpu', 4), OUT = opt('json', '');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SERVER = process.env.SERVER || 'http://127.0.0.1:8088';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Big', type: 'xtream', server: SERVER, user: 'demo', pass: 'demo', providerEpg: 'xmltv', epgDays: 1 }], active: 'p1' };

const INSTR = () => {
  // Key press -> next painted frame.  rAF runs before the paint; the message after it lands once it is done.
  window.__lat = []; window.__frames = []; window.__long = [];
  const mc = new MessageChannel(); let pend = [];
  mc.port1.onmessage = () => { const t = performance.now(); pend.forEach(p => window.__lat.push({ k: p.k, ms: t - p.t })); pend = []; };
  const mark = (k) => { const t = performance.now(); pend.push({ k, t }); requestAnimationFrame(() => mc.port2.postMessage(0)); };
  window.addEventListener('keydown', e => { if (!e.repeat && e.keyCode !== 13) mark(e.key); }, true);
  window.addEventListener('keyup', e => { if (e.keyCode === 13) mark('Enter'); }, true);
  let last = 0; const loop = (t) => { if (window.__recFrames) { if (last) window.__frames.push(t - last); last = t; } else last = 0; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
};

async function setup(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([s, relay]) => {
    if (!sessionStorage.getItem('sp')) { localStorage.clear(); indexedDB.deleteDatabase && 0; localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('sp', '1'); }
    localStorage.setItem('tivibro.devRelay', relay);
  }, [JSON.stringify(SETTINGS), RELAY]);
  await page.addInitScript(INSTR);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Performance.enable');
  return { ctx, page, cdp, errors };
}
const sleep = (page, ms) => page.waitForTimeout(ms);
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const r = n => Math.round(n);

async function taps(page, label, key, n, gap) {
  await page.evaluate(() => { window.__lat = []; });
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(page, gap || 350); }
  await sleep(page, 300);
  const lat = (await page.evaluate(() => window.__lat)).map(x => x.ms);
  return { label, kind: 'tap', n: lat.length, median: r(med(lat)), worst: r(Math.max(0, ...lat)) };
}
// Held arrow: key repeat at ~30/s for `ms`; counts how far the selection moved.
async function hold(page, label, key, ms, where) {
  const before = await page.evaluate(where);
  await page.evaluate(() => { window.__frames = []; window.__long = []; window.__recFrames = true; });
  await page.keyboard.down(key);
  const end = Date.now() + ms;
  while (Date.now() < end) { await sleep(page, 33); await page.keyboard.down(key); }
  await page.keyboard.up(key);
  await sleep(page, 400);
  const res = await page.evaluate(() => { window.__recFrames = false; return { f: window.__frames, l: window.__long }; });
  const after = await page.evaluate(where);
  const moved = Math.abs(after - before);
  return { label, kind: 'hold', perSec: +(moved / (ms / 1000)).toFixed(1), worstFrame: r(Math.max(0, ...res.f)), jank: res.f.filter(x => x > 50).length, longTasks: res.l.length };
}
async function stats(page, cdp) {
  const m = await cdp.send('Performance.getMetrics');
  const g = k => (m.metrics.find(x => x.name === k) || {}).value || 0;
  return { heapMB: r(g('JSHeapUsedSize') / 1048576), nodes: g('Nodes'), domNow: await page.evaluate(() => document.getElementsByTagName('*').length) };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const { ctx, page, cdp, errors } = await setup(browser);
  const out = { cpu: CPU, results: [] };
  const push = x => { out.results.push(x); console.log(JSON.stringify(x)); };

  // Start-up: first (downloads 15k channels and the guide) and cached.
  let t = Date.now();
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count && Library.count() > 10000, null, { timeout: 180000 });
  push({ label: 'first start: channels ready', ms: Date.now() - t });
  await page.waitForFunction(() => window.Epg && !Epg.loading && Epg.guideChannels().length > 1000, null, { timeout: 240000 }).catch(() => {});
  push({ label: 'first start: guide ready', ms: Date.now() - t });
  await sleep(page, 3000);
  t = Date.now();
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count && Library.count() > 10000 && document.querySelector('#viewGuide:not(.hidden)'), null, { timeout: 120000 });
  push({ label: 'cached start: guide on screen', ms: Date.now() - t });
  await sleep(page, 4000);
  push(Object.assign({ label: 'after start' }, await stats(page, cdp)));

  // Guide: groups panel (614 groups), then the grid of All channels.
  await page.evaluate(() => { Views.switchTab('guide'); });
  await sleep(page, 800);
  push(await taps(page, 'guide groups: Down', 'ArrowDown', 12));
  push(await hold(page, 'guide groups: hold Down', 'ArrowDown', 3000, () => Guide.__gsel()));
  await page.evaluate(() => { Guide.open(Library.ALL, null); });
  await sleep(page, 800);
  push(await taps(page, 'guide: open a group (OK)', 'Enter', 1));
  await page.evaluate(() => { Guide.open(Library.ALL, Library.channels(Library.ALL)[0].k); });
  await sleep(page, 1500);
  push(await taps(page, 'guide grid: Down', 'ArrowDown', 15));
  push(await taps(page, 'guide grid: Right (later)', 'ArrowRight', 8));
  push(await taps(page, 'guide grid: Left (earlier)', 'ArrowLeft', 8));
  push(await taps(page, 'guide grid: page down (CH-)', 'PageDown', 8));
  push(await hold(page, 'guide grid: hold Down', 'ArrowDown', 4000, () => Guide.__sel()));
  push(Object.assign({ label: 'after guide' }, await stats(page, cdp)));

  // Channels screen.
  await page.evaluate(() => { Views.switchTab('live'); });
  await sleep(page, 1200);
  push(await taps(page, 'channels: Down', 'ArrowDown', 15));
  push(await hold(page, 'channels: hold Down', 'ArrowDown', 4000, () => Views.__sel()));
  push(await taps(page, 'channels: Left to groups', 'ArrowLeft', 1));
  push(await hold(page, 'channel groups: hold Down', 'ArrowDown', 3000, () => Views.__gsel()));

  // Search.
  await page.evaluate(() => { Views.switchTab('search'); });
  await sleep(page, 1000);
  await page.evaluate(() => { window.__lat = []; const i = document.querySelector('#viewSearch input'); if (i) i.focus(); });
  const s0 = Date.now();
  await page.keyboard.type('sports', { delay: 180 });
  await page.waitForFunction(() => document.querySelectorAll('#viewSearch .row, #viewSearch .vrow, #viewSearch .item').length > 0, null, { timeout: 20000 }).catch(() => {});
  push({ label: 'search: type "sports" until results', ms: Date.now() - s0 });

  // Settings.
  await page.keyboard.press('Escape'); await sleep(page, 500);
  t = Date.now();
  await page.evaluate(() => { Views.switchTab('settings'); });
  await page.waitForFunction(() => document.querySelector('#viewSettings:not(.hidden)'), null, { timeout: 10000 });
  push({ label: 'settings: open', ms: Date.now() - t });
  push(await taps(page, 'settings: Down', 'ArrowDown', 8));

  // Fullscreen zapping (OSD paint after CH+).
  await page.evaluate(() => { const c = Library.channels(Library.ALL)[0]; Views.startChannel(c, false, function () { Views.goFull(); }); });
  await sleep(page, 3000);
  push(await taps(page, 'fullscreen: CH+ (OSD)', 'PageUp', 10, 600));
  push(await taps(page, 'fullscreen: OK (quick menu)', 'Enter', 1, 800));
  await page.keyboard.press('Escape'); await sleep(page, 600);
  push(Object.assign({ label: 'end' }, await stats(page, cdp)));
  push({ label: 'page errors', n: errors.length, first: errors.slice(0, 3) });
  await browser.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
