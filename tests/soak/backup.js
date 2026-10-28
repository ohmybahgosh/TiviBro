/* Backup versions: a channel that stops working switches to another version of itself.
     node tests/soak/backup.js        (mock provider on :8077 and the app served, see tests/soak/chaos.js)
   Two cases on the mock's "Nova News 24" (FHD, HD, SD):
     never starts    the FHD stream answers 404 from the first try
     dies later      the FHD stream plays, then answers 404 for good
   Each should end up playing another version, with a message saying so.
     provider down   every version answers 404 for a while: back on FHD, still retrying, and playing
                     again by itself once the provider returns */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short', epgDays: 1 }], active: 'p1' };
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fails++; };

async function run(browser, label, deadFrom) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([s, relay]) => { if (!sessionStorage.getItem('bk')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('bk', '1'); } localStorage.setItem('tivibro.devRelay', relay); }, [JSON.stringify(SETTINGS), RELAY]);
  let dead = deadFrom === 0;
  await page.route(/\/live\/[^/]+\/[^/]+\/1\.(ts|m3u8)/, r => dead ? r.fulfill({ status: 404, body: 'gone' }) : r.continue());
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.find && Library.find('x1'), null, { timeout: 30000 });
  const v = await page.evaluate(() => Library.versions(Library.find('x1')).map(c => c.n));
  ok(label + ': versions found', v.length === 2 && /HD$/.test(v[0]) && /SD$/.test(v[1]), v.join(', '));
  await page.evaluate(() => { const toasts = window.__toasts = []; const t = document.getElementById('toast'); new MutationObserver(() => toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
  await page.evaluate(() => Views.startChannel(Library.find('x1'), false, () => Views.goFull()));
  if (deadFrom) { await page.waitForTimeout(deadFrom * 1000); ok(label + ': FHD played first', await page.evaluate(() => Player.position > 1)); dead = true; }
  const t0 = Date.now();
  await page.waitForFunction(() => Views.playing && Views.playing.k !== 'x1' && Player.position > 1, null, { timeout: 150000 }).catch(() => {});
  const r = await page.evaluate(() => ({ k: Views.playing && Views.playing.n, pos: Player.position, toasts: window.__toasts.join(' / ') }));
  ok(label + ': now playing another version', /Nova News 24 HD/.test(r.k || '') && r.pos > 1, (r.k || 'nothing') + ' after ' + Math.round((Date.now() - t0) / 1000) + 's');
  ok(label + ': says so', /isn't working\.  Switched to .*HD/.test(r.toasts), r.toasts.slice(0, 120));
  ok(label + ': no page errors', !errors.length, errors.join(' | '));
  if (process.env.LOG) console.log((await page.evaluate(() => Log.lines(false))).filter(l => /player/.test(l)).slice(-40).join('\n'));
  await ctx.close();
}
async function outage(browser) {
  const label = 'provider down';
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([s, relay]) => { if (!sessionStorage.getItem('bk')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('bk', '1'); } localStorage.setItem('tivibro.devRelay', relay); }, [JSON.stringify(SETTINGS), RELAY]);
  let down = false;
  const hits = [];
  await page.route(/\/live\/[^/]+\/[^/]+\/[123]\.(ts|m3u8)/, r => { hits.push((down ? '404 ' : 'ok ') + r.request().url().slice(-8)); return down ? r.fulfill({ status: 404, body: 'gone' }) : r.continue(); });
  page.on('request', q => { if (/\.(ts|m3u8)/.test(q.url())) hits.push('req ' + q.url().slice(-40)); });
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.find && Library.find('x1'), null, { timeout: 30000 });
  await page.evaluate(() => Views.startChannel(Library.find('x1'), false, () => Views.goFull()));
  await page.waitForFunction(() => Player.position > 1, null, { timeout: 20000 });
  down = true;
  await page.evaluate(() => Player.retryNow());            // the provider drops every connection
  await page.waitForFunction(() => Log.lines(false).some(l => /No version of .* is working; back to it/.test(l)), null, { timeout: 240000 }).catch(() => {});
  await page.waitForTimeout(20000);                         // the outage goes on
  const mid = await page.evaluate(() => ({ k: Views.playing && Views.playing.k, st: document.getElementById('spinner').classList.contains('hidden') ? 'no spinner' : 'buffering', err: !document.getElementById('vidError').classList.contains('hidden'), log: Log.lines(false).filter(l => /switching to|No version/.test(l)) }));
  ok(label + ': tried the other versions', mid.log.filter(l => /switching to/.test(l)).length === 2, mid.log.length + ' lines');
  if (process.env.HITS) console.log(hits.slice(-30).join('\n'), JSON.stringify(await page.evaluate(() => ({ pos: Player.position, st: Player.stats }))));
  ok(label + ': back on the channel you chose, still trying', mid.k === 'x1' && mid.st === 'buffering' && !mid.err, mid.k + ' ' + mid.st + (mid.err ? ' (error shown)' : ''));
  down = false;
  await page.waitForFunction(() => Views.playing && Views.playing.k === 'x1' && Player.position > 1 && (Player.stats || {}).state === 'playing', null, { timeout: 90000 }).catch(() => {});
  ok(label + ': playing again when the provider returns', await page.evaluate(() => Views.playing.k === 'x1' && Player.position > 1));
  ok(label + ': no page errors', !errors.length, errors.join(' | '));
  if (process.env.LOG) console.log((await page.evaluate(() => Log.lines(false))).filter(l => /player/.test(l)).slice(-40).join('\n'));
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  if (!process.env.ONLY_LATE && !process.env.ONLY_OUTAGE) await run(browser, 'never starts', 0);
  if (!process.env.ONLY_OUTAGE) await run(browser, 'dies later', 8);
  await outage(browser);
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all backup tests passed');
  process.exit(fails ? 1 : 0);
})();
