/* Start-up guard (app/js/compat.js): a TV never shows just a black screen.
     node tests/soak/boot.js        (mock provider on :8077 and the app served, see tests/soak/chaos.js)
     normal          no error screen
     broken script   a file that fails to load: "TiviBro could not start" with the details
     too old         a browser without modern JavaScript (webOS 3): "This TV is too old" */
'use strict';
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html', RELAY = process.env.RELAY || '47811';
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'short' }], active: 'p1' };
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const mode of ['normal', 'broken script', 'too old']) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.addInitScript(([s, relay]) => { localStorage.setItem('tivibro.devRelay', relay); localStorage.setItem('tivibro.settings', s); }, [JSON.stringify(SETTINGS), RELAY]);
    if (mode === 'broken script') await page.route(/js\/views\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'var Views = (function () { let x = ; })();' }));
    if (mode === 'too old') await page.addInitScript(() => { const F = window.Function; window.Function = function (src) { if (/class K/.test(src)) throw new SyntaxError('Unexpected token let'); return F.apply(this, arguments); }; });
    await page.goto(APP);
    await page.waitForTimeout(5000);
    const txt = await page.evaluate(() => { const d = [].slice.call(document.body.children).filter(e => e.style && e.style.zIndex === '999')[0]; return d ? d.innerText.replace(/\s+/g, ' ') : ''; });
    if (mode === 'normal') ok('normal start: no error screen', !txt, txt.slice(0, 80));
    if (mode === 'broken script') ok('a file that fails to load: says so, with the details', /could not start/.test(txt) && /Missing: Views/.test(txt) && /SyntaxError/.test(txt), txt.slice(0, 120));
    if (mode === 'too old') ok('webOS 3 and older: says the TV is too old', /too old/.test(txt) && /webOS 4/.test(txt), txt.slice(0, 80));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all start-up tests passed');
  process.exit(fails ? 1 : 0);
})();
