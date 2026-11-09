/* Provider status: the provider's server goes down behind Cloudflare (522) while TiviBro runs.  TiviBro says it's
   the provider, once; Settings > Updates, about and diagnostics > Provider status says what's wrong and what to
   tell them, with no login in it; the problem report carries it; and it clears when the server answers again.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/provider-status.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  let down = false;
  // Everything for the mock provider (through the helper or not), while "down": Cloudflare's 522 page.
  await page.route(/127\.0\.0\.1(:|%3A)8077|\/x\/http\/127\.0\.0\.1:8077/, (route) => down
    ? route.fulfill({ status: 522, contentType: 'text/html', body: '<!DOCTYPE html><title>Connection timed out | Error 522</title>' })
    : route.continue());
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await ev(() => { window.__toasts = []; const t = U.toast; U.toast = function (m) { window.__toasts.push(String(m)); return t.apply(U, arguments); }; });
    ok('nothing to say while the provider answers', await ev(() => !ProvStatus.now().length));
    down = true;
    // The app asks the provider for things (the account, a channel or two) and another site answers.
    await ev(() => { ProvStatus.note('https://api.github.com/zen', true); });
    const keys = await ev(() => Library.channels(Library.ALL).slice(0, 3).map((c) => c.k));
    for (const k of keys) { await ev((k) => Views.startChannel(Library.find(k), false), k); await page.waitForTimeout(2500); }
    await ev(() => Source.api ? null : null);
    await ev(() => ProvStatus.checkNow()); await page.waitForTimeout(800);
    const st = await ev(() => ({ now: ProvStatus.now(), toasts: window.__toasts.filter((t) => /not TiviBro/.test(t)) }));
    ok('it says it\'s the provider, once', st.toasts.length === 1 && st.now.length === 1, JSON.stringify(st).slice(0, 300));
    ok('Cloudflare, by its error code', /Cloudflare/.test((st.now[0] || {}).title || '') && /522/.test((st.now[0] || {}).text || ''), JSON.stringify(st.now[0] || {}).slice(0, 300));
    // Settings > Updates, about and diagnostics > Provider status.
    await ev(() => { Views.switchTab('settings'); Settings.open(); Settings.section('about'); }); await page.waitForTimeout(500);
    const row = await ev(() => { const r = Settings.phone.page('about', []).rows; const x = r.find((x) => x.label === 'Provider status'); return { i: x ? x.i : -1, v: x ? x.value : '' }; });
    ok('Settings has a Provider status row saying there\'s a problem', row.i >= 0 && row.v === 'Problem', JSON.stringify(row));
    const pg = await ev((i) => Settings.phone.page('about', [i]).rows.map((r) => r.label + ' | ' + r.sub).join('\n'), row.i);
    ok('its page: what\'s wrong, that the internet works, and what to tell the provider', /Cloudflare/.test(pg) && /internet works/.test(pg) && /What to tell your provider/.test(pg) && /HTTP 522/.test(pg), pg);
    const login = await ev(() => [Store.playlist.user, Store.playlist.pass]);
    ok('no username or password on it', !pg.includes(login[0]) && !pg.includes(login[1]));
    const rep = await ev(() => Diag.report ? Diag.report() : '');
    ok('the problem report says it too', /Provider: Their server is offline behind Cloudflare/.test(typeof rep === 'string' ? rep : JSON.stringify(rep)), String(rep).slice(0, 200));
    // Back up.
    down = false;
    await ev((k) => Views.startChannel(Library.find(k), false), keys[0]); await page.waitForTimeout(4000);
    ok('the provider answers again: back to normal', await ev(() => !ProvStatus.now().length));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all provider status checks passed');
  process.exit(fails ? 1 : 0);
})();
