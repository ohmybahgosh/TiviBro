/* Layout in every language: each screen, Settings page, menu and box drawn in English, Spanish and Russian,
   looking for text that doesn't fit.  Longer words (Russian runs a third longer than English) are what
   push a label into the value next to it, under the clock, out of a button or off the screen.
     MOCK_EVENTS=1 MOCK_TEAMS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/i18n-layout.js [--shots dir] [--lang ru]
   Reports, per screen:
     clipped   text cut off with nothing to show it (no … ), in a box that hides what doesn't fit
     overlap   two pieces of text on top of each other
     offscreen text past the edge of the screen
   A screen fails only for what English doesn't already have there (English is the baseline). */
'use strict';
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const ai = process.argv.indexOf('--shots'), SHOTS = ai > 0 ? process.argv[ai + 1] : '';
const li = process.argv.indexOf('--lang'), LANGS = li > 0 ? ['en', process.argv[li + 1]] : ['en', 'es', 'ru'];
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '\n      ' + String(x).slice(0, 1600).split('\n').join('\n      ') : '')); if (!c) fails++; };

// In the page: what doesn't fit.  Each finding is "kind: text" so the same one can be told apart in English.
function scan() {
  const W = innerWidth, H = innerHeight, out = [], seen = new Set();
  const vis = (el) => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const shown = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) if (!vis(e)) return false; return true; };
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const add = (k, el, extra) => { const key = k + ': ' + txt(el) + (extra ? ' | ' + extra : ''); if (!seen.has(key)) { seen.add(key); out.push(key); } };
  // Elements that hold their own text.
  const all = [].filter.call(document.querySelectorAll('body *'), (el) => {
    if (/^(SCRIPT|STYLE|SVG|PATH|VIDEO|IMG|CANVAS|INPUT)$/i.test(el.nodeName) || el.closest('svg')) return false;
    if (![].some.call(el.childNodes, (n) => n.nodeType === 3 && /\S/.test(n.nodeValue))) return false;
    return shown(el);
  });
  // Only text you can see: on top where it is drawn (a menu, the side menu or a panel over a list hides
  // the list's text under it, which is meant).
  const onTop = (el) => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const r = rg.getBoundingClientRect(), xs = [r.left + 3, (r.left + r.right) / 2, r.right - 3], y = (r.top + r.bottom) / 2;
    return xs.some((x) => { if (x < 0 || x > W || y < 0 || y > H) return false; const h = document.elementFromPoint(x, y); return h && (h === el || el.contains(h) || h.contains(el)); });
  };
  const top = all.filter(onTop);
  // Clipped: wider than the box, the box hides it, and no ellipsis shows it.  Marquee lines are meant to.
  all.forEach((el) => {
    for (let e = el, d = 0; e && e !== document.body && d < 3; e = e.parentElement, d++) {
      const s = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 2 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && !e.closest('.marquee,.mq,[data-marquee]') && !/marquee|scroll/.test(e.className)) { add('clipped', el); break; }
      if (e.scrollHeight > e.clientHeight + 3 && /hidden|clip/.test(s.overflowY) && s.textOverflow !== 'ellipsis' && !/-webkit-box/.test(s.display) && e.clientHeight > 0 && e.clientHeight < 200) { add('clipped (height)', el); break; }
    }
  });
  // Cut short with an ellipsis: meant, but a translation that loses its end where English shows whole is
  // worth a shorter word.
  all.forEach((el) => { const s = getComputedStyle(el); if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && onTop(el)) add('truncated', el); });
  // Off the screen.
  all.forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > W + 2 || r.bottom > H + 2 || r.left < -2) { if (!el.closest('.vlist,.set-scroll,.media-shelves,.guide-body,.modal-body,.pscroll,#vodItems')) add('offscreen', el); } });
  // Overlap: two text elements, neither inside the other, whose text boxes cross.
  // The part of the text you can see: its box, cut to every box around it that hides what spills out.
  const seenRect = (el) => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const q = rg.getBoundingClientRect(), r = { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (st.overflow === 'visible' && st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const c = e.getBoundingClientRect();
      r.left = Math.max(r.left, c.left); r.top = Math.max(r.top, c.top); r.right = Math.min(r.right, c.right); r.bottom = Math.min(r.bottom, c.bottom);
    }
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    return r;
  };
  const rects = top.map((el) => ({ el, r: seenRect(el) })).filter((x) => x.r.width > 3 && x.r.height > 3);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 6 && h > 6) add('overlap', a.el, txt(b.el));
  }
  // The hints at the bottom: in one line, none of them off the screen.
  const hb = document.getElementById('hints');
  if (hb && shown(hb)) [].forEach.call(hb.children, (c) => { if (c.style.display !== 'none' && c.getBoundingClientRect().right > W - 4) add('offscreen hint', c); });
  return out;
}

const STEPS = [
  ['guide', async (ev) => ev(() => { UI.close(); Views.switchTab('guide'); })],
  ['channels', async (ev) => ev(() => { UI.close(); Store.settings.channelsTab = true; Views.buildTabs(); Views.switchTab('live'); })],
  ['side menu open', async (ev) => ev(() => { document.body.classList.add('nav-open'); })],
  ['channel menu', async (ev) => ev(() => { document.body.classList.remove('nav-open'); const c = Library.channels(Library.ALL)[3]; Views.chanMenu(c, c.g); })],
  ['group menu', async (ev) => ev(() => { UI.close(); Views.groupMenu(Library.groups().filter((g) => !g.custom)[2]); })],
  ['confirm', async (ev) => ev(() => { UI.close(); UI.confirm('Clear all edits for this playlist', 'Clear all edits', () => {}); })],
  ['prompt', async (ev) => ev(() => { UI.close(); UI.prompt('Name the new group', '', () => {}, 'Paste a comma separated list…'); })],
  ['search', async (ev) => ev(() => { UI.close(); Views.switchTab('search'); })],
  ['movies', async (ev) => ev(() => { UI.close(); Views.switchTab('movies'); })],
  ['settings', null],                           // every section, below
  ['fullscreen', async (ev) => ev(() => { UI.close(); Views.switchTab('guide'); Views.switchTab('live'); const c = Library.channels(Library.ALL)[0]; Views.startChannel(c); Views.goFull(); })],
  ['set-up tour', async (ev) => ev(() => { if (Views.full) UI.press('back'); UI.close(); Tour.open({}); })]
];
const SECTIONS = ['language', 'playlists', 'guide', 'channels', 'names', 'reminders', 'playback', 'media', 'keys', 'remote', 'look', 'parental', 'backups', 'connect', 'about'];

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  let page, ev;
  const found = {}, missed = {};   // lang -> screen -> [findings]; lang -> text still in English
  for (const lang of LANGS) {
    // Each language from a fresh start, as a TV set to it would have it.
    if (page) await page.context().close();
    page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    page.on('pageerror', (e) => errs.push(lang + ': ' + e.message));
    await page.addInitScript(R.init({ time: R.primeTime(), settings: { lang: lang } })[0]);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2500);
    ev = (f, x) => page.evaluate(f, x);
    found[lang] = {};
    const look = async (name) => {
      await page.waitForTimeout(700);
      found[lang][name] = await ev(scan);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, lang + '-' + name.replace(/[^a-z0-9]+/gi, '-') + '.png') });
    };
    for (const [name, go] of STEPS) {
      try {
        if (name === 'settings') {
          await ev(() => { UI.close(); Views.switchTab('settings'); Settings.open(); });
          for (const s of SECTIONS) {
            await ev((id) => Settings.section(id), s); await look('settings ' + s);
            // Down the page: the rows under the first screenful.
            await ev(() => { for (let k = 0; k < 14; k++) UI.press('down'); }); await look('settings ' + s + ' (lower)');
          }
          continue;
        }
        await go(ev); await look(name);
      } catch (e) { found[lang][name] = ['harness: ' + e.message]; }
    }
    if (lang !== 'en') missed[lang] = await ev(() => I18n.misses());
  }
  // Each language against English: more of a kind on a screen than English has there.
  const kinds = (l) => { const c = {}; (l || []).forEach((x) => { const k = x.split(':')[0]; c[k] = (c[k] || 0) + 1; }); return c; };
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    const rows = [];
    Object.keys(found[lang]).forEach((screen) => {
      const k = kinds(found[lang][screen]), e = kinds(found.en[screen]);
      const worse = Object.keys(k).filter((x) => k[x] > (e[x] || 0));
      if (worse.length) rows.push(screen + '\n  ' + found[lang][screen].filter((x) => worse.includes(x.split(':')[0])).slice(0, 10).join('\n  '));
    });
    ok(lang + ': nothing that English doesn\'t have', !rows.length, rows.join('\n'));
  }
  if (found.en) ok('en: the baseline has nothing either', !Object.values(found.en).some((l) => l.length), Object.entries(found.en).filter(([, l]) => l.length).map(([s, l]) => s + '\n  ' + l.slice(0, 8).join('\n  ')).join('\n'));
  // Text still in English on the screens visited (shown, not failed: translations come a little at a time).
  Object.keys(missed).forEach((l) => console.log('NOTE ' + l + ': ' + missed[l].length + ' texts shown still in English' + (missed[l].length ? ':\n      ' + missed[l].slice(0, 400).map((x) => JSON.stringify(x)).join('\n      ') : '')));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all layout checks passed');
  process.exit(fails ? 1 : 0);
})();
