/* The web editor in another language: every page opened in Spanish (?lang=es, as the phone app opens it) and
   Russian, checking that nothing English is left where the editor writes its own text, that the Settings pages
   come from the TV in that language, and that no page breaks.  Screenshots go to tests/.shots/editor-<lang>-*.png.
     node tests/soak/editor-i18n.js [es ru]      (mock provider on :8077, the app served and the dev relay; see tests/soak/chaos.js)
   English words left in the page are listed by where they are; channel and group names are the mock
   provider's own and are skipped (they never go through the dictionaries). */
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const LANGS = process.argv.slice(2).length ? process.argv.slice(2) : ['es', 'ru'];
const SHOTS = path.join(__dirname, '..', '.shots');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
// Words that say a sentence is still English (the mock channel names use none of them).
const ENGLISH = /\b(the|your|you|and|with|from|this|that|these|channels?|groups?|guide|playlists?|settings|press|click|send|hidden|shown|nothing|every|when)\b/i;

(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const tctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' });
  const tv = await tctx.newPage();
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(6000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  const st = await tv.evaluate(() => WebEdit.start().then((s) => s, (e) => ({ err: e.message })));
  ok('editor starts on the TV', st.running, JSON.stringify(st));
  const pw = await tv.evaluate(() => WebEdit.password());
  for (const lang of LANGS) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const ed = await ctx.newPage(); const errs = [];
    ed.on('pageerror', (e) => errs.push(e.message));
    await ed.goto('http://127.0.0.1:' + st.port + '/?lang=' + lang); await ed.waitForTimeout(800);
    ok(lang + ': the login page is translated', !/Open the editor/.test(await ed.innerText('#login')), await ed.innerText('#login'));
    await ed.fill('#pw', pw); await ed.click('#loginBtn'); await ed.waitForTimeout(3000);
    ok(lang + ': html lang', (await ed.evaluate(() => document.documentElement.lang)) === lang);
    const pages = await ed.evaluate(() => [].map.call(document.querySelectorAll('#nav button[data-page]'), (x) => x.dataset.page + (x.dataset.sub ? '/' + x.dataset.sub : '')));
    const left = {};
    for (const p of pages) {
      await ed.evaluate((p) => { var b = document.querySelector('#nav button[data-page="' + p.split('/')[0] + '"]' + (p.indexOf('/') > 0 ? '[data-sub="' + p.split('/')[1] + '"]' : ':not([data-sub])')); if (b) b.click(); }, p);
      await ed.waitForTimeout(p.indexOf('settings') === 0 ? 3500 : 1500);
      await ed.screenshot({ path: path.join(SHOTS, 'editor-' + lang + '-' + p.replace(/\W+/g, '-') + '.png') });
      // Text the editor shows that still reads as English: visible text nodes outside names (data-raw, .cname, .raw, the group list's names).
      const found = await ed.evaluate((src) => {
        const rx = new RegExp(src, 'i'), out = [];
        const sec = document.querySelector('section.page:not(.hidden)');
        const w = document.createTreeWalker(sec || document.body, 4, null, false); let n;
        while ((n = w.nextNode())) {
          // <provider> and <guide> in the report's note are the tokens the report really uses.
          const t = n.nodeValue.replace(/<[a-z]+>/g, '').trim(), el = n.parentElement;
          if (t.length < 4 || !rx.test(t) || !el || !el.offsetParent) continue;
          if (el.closest('[data-raw],.rpfacts,.cname,.raw,.g .nm,.grp,td.ch,.names,pre,code,.dd .v,#gprev td,#prev td,.hist,.tiny.dim')) continue;
          out.push(t.slice(0, 120));
        }
        return out;
      }, lang === 'fr' ? ENGLISH.source.replace('|guide|', '|') : ENGLISH.source);   // "guide" is French too
      if (found.length) left[p] = found;
    }
    // Help, every section.
    await ed.evaluate(() => { location.hash = '#help'; }); await ed.waitForTimeout(800);
    const helpEn = await ed.evaluate(() => /keep TiviBro open on the TV/.test(document.getElementById('helpBody').innerText));
    ok(lang + ': help is translated', !helpEn);
    const n = Object.keys(left).reduce((a, k) => a + left[k].length, 0);
    if (n) Object.keys(left).forEach((k) => console.log('  ' + lang + ' ' + k + ':\n    ' + left[k].join('\n    ')));
    ok(lang + ': no English left in the editor\'s own text', n === 0, n + ' texts');
    const misses = await ed.evaluate(() => I18n.misses());
    ok(lang + ': every text through tr() has a translation', !misses.length, JSON.stringify(misses));
    ok(lang + ': no page errors', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
