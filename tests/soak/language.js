/* Languages in the real app (app/js/i18n.js): a Spanish TV gets TiviBro in Spanish, Settings > Language
   (always also saying "Language") changes it to Russian and back to Automatic, and English stays English.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/language.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'es-ES' })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const navText = () => ev(() => [].map.call(document.querySelectorAll('#setNav > div'), (d) => d.innerText.trim()));
  try {
    ok('a Spanish TV: TiviBro in Spanish', await ev(() => I18n.lang() === 'es' && I18n.setting() === 'auto'));
    const tabs = await ev(() => [].map.call(document.querySelectorAll('.tabs .lbl'), (x) => x.textContent));
    ok('the side menu in Spanish', tabs.indexOf('Guía') >= 0 && tabs.indexOf('Configuración') >= 0, tabs.join(', '));
    ok('the fixed titles too', await ev(() => document.querySelector('.col.groups > .col-title').textContent === 'Grupos'));
    ok('TiviBro\'s own groups too', await ev(() => Library.groupName(Library.ALL) === 'Todos los canales'));
    await page.waitForTimeout(5500);
    ok('the first start says it, and where to change it', /TiviBro está en Español.+Configuración > Idioma/.test(await ev(() => document.getElementById('toast').textContent)));
    await ev(() => { Views.switchTab('settings'); Settings.open(); }); await page.waitForTimeout(600);
    let nav = await navText();
    ok('Settings opens on Playlists, with Language above it, also saying "Language"', /^Idioma\s+·\s+Language$/.test(nav[0]) && nav[1] === 'Listas de reproducción' && /Listas/.test(await ev(() => document.querySelector('#setNav .on').textContent)), nav.join(' | '));
    await ev(() => Settings.section('language')); await page.waitForTimeout(500);
    let body = await ev(() => document.querySelector('.set-scroll').innerText);
    ok('the Language page: Automatic says the TV\'s, languages in their own names', /Automático: el idioma de la TV/.test(body) && /La TV está en Español/.test(body) && /Русский/.test(body) && /English/.test(body), body.slice(0, 400));
    await shot('lang-es');
    // Русский
    await ev(() => { const rows = [].slice.call(document.querySelectorAll('.set-scroll .opt')); const r = rows.find((x) => /^Русский/.test(x.innerText)); r.click(); });
    await page.waitForTimeout(700);
    nav = await navText();
    ok('chosen: Russian everywhere at once', await ev(() => I18n.lang() === 'ru' && Store.settings.lang === 'ru') && /^Язык\s+·\s+Language$/.test(nav[0]) && nav[1] === 'Плейлисты', nav.join(' | '));
    ok('the side menu follows', (await ev(() => [].map.call(document.querySelectorAll('.tabs .lbl'), (x) => x.textContent))).indexOf('Телегид') >= 0);
    ok('the hints at the bottom follow', /выбрать/.test(await ev(() => document.getElementById('hints').innerText)));
    ok('times in 24 hours', await ev(() => /^\d{1,2}:\d\d$/.test(U.hhmm(Date.now()))));
    await shot('lang-ru');
    const menu = await ev(() => { UI.confirm('Delete this playlist', 'Delete', () => {}); const t = document.getElementById('modal').innerText; UI.close(); return t; });
    ok('boxes and menus too', /Удалить этот плейлист/.test(menu) && /Отмена/.test(menu), menu);
    // Back to Automatic: the TV's (Spanish).
    await ev(() => { const rows = [].slice.call(document.querySelectorAll('.set-scroll .opt')); rows.find((x) => /^Автоматически/.test(x.innerText)).click(); });
    await page.waitForTimeout(600);
    ok('Automatic again: Spanish, the TV\'s', await ev(() => I18n.lang() === 'es' && I18n.setting() === 'auto'));
    // English: nothing changes for English.
    await ev(() => I18n.set('en')); await page.waitForTimeout(400);
    nav = await navText();
    ok('English: the menu as it always was', nav[0] === 'Language' && nav[1] === 'Playlists' && await ev(() => /[ap]m$/.test(U.hhmm(Date.now()))), nav.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all language checks passed');
  process.exit(fails ? 1 : 0);
})();
