/* Discussions #19, #31, #35 and #36 in the real app: the subtitle look (colour, size, a box behind each
   line), notices held while a movie plays and shown after, toasts at the top in full screen, Film shape in
   the Aspect menu, the buffer pill's "most" after the bar, and the web editor's Show button on a phone.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/look-notices.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  try {
    // ---- Subtitle look (#19) ----
    await ev(m => { Views.playVod({ id: 'look1', title: 'Feature', item: { name: 'Feature' } }, m + '/movie/1.mp4', 0, function () {}); }, MOCK);
    await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }); await page.waitForTimeout(800);
    await ev(() => { Player.setPaused(true); Player.seekTo(2.5); }); await page.waitForTimeout(600);
    await ev(() => Subs._test.addTrack('English (test)', 'en', [{ s: 0, e: 600, text: 'First line\nSecond line' }]));
    await ev(() => Subs.draw());
    const plain = await ev(() => { const c = document.querySelector('.subs-captions'), sp = c.querySelectorAll('span'), cs = getComputedStyle(c);
      return { text: c.textContent, spans: sp.length, color: cs.color, size: cs.fontSize, bg: getComputedStyle(sp[0]).backgroundColor }; });
    ok('subtitle lines are drawn one span each, the text unchanged', plain.text === 'First line\nSecond line' && plain.spans === 2, JSON.stringify(plain));
    ok('by default: white, 42 px, no box', plain.color === 'rgb(255, 255, 255)' && plain.size === '42px' && plain.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(plain));
    await ev(() => { Store.settings.subColor = 'yellow'; Store.settings.subSize = 'l'; Store.settings.subBack = 'box'; Views.applyLook(); });
    const styled = await ev(() => { const c = document.querySelector('.subs-captions'), sp = c.querySelector('span'), cs = getComputedStyle(c);
      return { color: cs.color, size: cs.fontSize, bg: getComputedStyle(sp).backgroundColor, shadow: cs.textShadow }; });
    ok('Yellow, Large and a see-through box apply to the lines', styled.color === 'rgb(255, 225, 77)' && styled.size === '52px' && styled.bg === 'rgba(0, 0, 0, 0.6)' && styled.shadow === 'none', JSON.stringify(styled));
    await shot('look-subs-yellow-box');
    await ev(() => { delete Store.settings.subColor; delete Store.settings.subSize; delete Store.settings.subBack; Views.applyLook(); });

    // ---- Toasts at the top in full screen, notices held while a movie plays (#35) ----
    const top = await ev(() => { U.toast('Top test', 3000); const r = document.getElementById('toast').getBoundingClientRect(); return r.top; });
    ok('in full screen a toast shows at the top, clear of the subtitles', top < 200, top);
    const held = await ev(() => { document.getElementById('toast').classList.add('hidden'); return U.notice('Watchlist: "News" 8:00 PM on One.  Reminder set.', 7000); });
    ok('a watchlist notice waits while a movie plays full screen', held === true && await ev(() => document.getElementById('toast').classList.contains('hidden')));
    ev(() => U.notice('Watchlist: "Sports" 9:00 PM on Two.', 7000));
    await ev(() => Views.runAction('exit', 'player')); await page.waitForTimeout(2600);
    const after = await ev(() => { const t = document.getElementById('toast'); return t.classList.contains('hidden') ? '' : t.textContent; });
    ok('and shows once you are back, with how many more', /^While you watched: Watchlist: "News".*And 1 more\.$/.test(after), after);
    const live = await ev(() => U.notice('Right away', 3000));
    ok('outside a movie it shows at once', live === false && await ev(() => document.getElementById('toast').textContent === 'Right away'));

    // ---- Kept subtitles come back (#19) ----
    await ev(m => { Views.playVod({ id: 'look2', title: 'Kept', item: { name: 'Kept' } }, m + '/movie/1.mp4', 0, function () {}); }, MOCK);
    await page.waitForFunction(() => Player.playing, null, { timeout: 30000 });
    await ev(() => { Subs._test.addTrack('Spanish (OpenSubtitles)', 'es', [{ s: 0, e: 600, text: 'Hola' }]); Subs._test.keep('Spanish (OpenSubtitles)', 'es', [{ s: 0, e: 600, text: 'Hola' }]); Subs._test.shift(1); });
    await ev(() => Views.runAction('exit', 'player')); await page.waitForTimeout(500);
    await ev(m => { Views.playVod({ id: 'look2', title: 'Kept', item: { name: 'Kept' } }, m + '/movie/1.mp4', 0, function () {}); }, MOCK);
    await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }); await page.waitForTimeout(500);
    const back = await ev(() => { const t = [].slice.call(document.getElementById('video').textTracks).filter(x => !Subs.gone(x) && /Spanish \(OpenSubtitles\)/.test(x.label)); return { n: t.length, mode: t[0] && t[0].mode, delay: Subs.delay }; });
    ok('a movie played again gets its downloaded subtitles back, on, with its timing', back.n === 1 && back.mode === 'showing' && back.delay === 1, JSON.stringify(back));

    // ---- Film shape (#31) ----
    const clickRow = re => ev(r => { const x = [].slice.call(document.querySelectorAll('#modal .mi')).find(y => new RegExp(r).test(y.textContent)); if (x) x.click(); return !!x; }, re);
    await ev(() => { UI.close(); Views.runAction('menu', 'player'); }); await page.waitForTimeout(400);
    await clickRow('^Aspect'); await page.waitForTimeout(400);
    const pm = await ev(() => document.getElementById('modal').innerText);
    ok('Aspect has Film shape…', /Film shape…/.test(pm), pm);
    await clickRow('^Film shape'); await page.waitForTimeout(400);
    await clickRow('^2\\.39:1'); await page.waitForTimeout(600);
    const fs = await ev(() => ({ d: Player.displayFor(Player.current), tr: document.getElementById('video').style.transform }));
    ok('picking 2.39:1 crops a letterboxed scope film to fill the screen', fs.d === 'film:2.39' && /^scale\(1\.34/.test(fs.tr), JSON.stringify(fs));
    await ev(() => Player.setAspect('contain', Player.current));

    // ---- Buffer pill: "most" right after the bar (#36) ----
    await ev(() => { Store.settings.meter = 'always'; }); await page.waitForTimeout(1500);
    const pill = await ev(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { most: document.getElementById('meterMost').textContent, res: document.getElementById('meterRes').textContent, gap: Math.round(r('meterMost').left - document.getElementById('meterFill').parentNode.getBoundingClientRect().right) }; });
    ok('"most" sits right after the bar, not with the picture and engine', /^most \d+s$/.test(pill.most) && !/most/.test(pill.res) && pill.gap >= 0 && pill.gap < 4, JSON.stringify(pill));
    await shot('look-buffer-pill');
    await ev(() => { delete Store.settings.meter; Views.runAction('exit', 'player'); });

    // ---- Web editor: Show stays inside the password box on a phone (#36) ----
    await ev(() => WebEdit.stop()); await page.waitForTimeout(300);
    await ev(() => WebEdit.start()); await page.waitForTimeout(2500);
    const port = await ev(() => WebEdit.status.port);
    const ph = await (await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })).newPage();
    await ph.goto('http://127.0.0.1:' + port + '/'); await ph.waitForSelector('#pwShow', { state: 'visible', timeout: 15000 });
    const box = await ph.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const p = r('pw'), s = r('pwShow'); return { pw: [p.left, p.right, p.top, p.bottom], show: [s.left, s.right, s.top, s.bottom] }; });
    ok('the Show button sits inside the right end of the password box', box.show[0] > box.pw[0] + box.pw[1] * 0.5 && box.show[1] <= box.pw[1] && box.show[2] >= box.pw[2] && box.show[3] <= box.pw[3], JSON.stringify(box));
    if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, 'look-editor-login-phone.png') });
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all look and notice checks passed');
  process.exit(fails ? 1 : 0);
})();
