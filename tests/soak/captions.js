/* Closed captions (CEA-608) on live TV, in the real app with the built-in demuxer.
     bash scripts/demo/make-media.sh                                     (makes tests/mock/media/cc.ts)
     MOCK_CC=1 MOCK_PORT=8090 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/captions.js [--shots dir]
   The clip's captions say when they were sent ("Caption 4 at 0:12"), so the test can tell whether
   they show at the right moment, in fullscreen only, with the switch, and in the quick menu. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8090';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const ccText = () => ev(() => { const e = document.querySelector('#stage .cc'); return e && e.style.display !== 'none' ? e.innerText.trim() : ''; });
  const modal = () => ev(() => { const m = document.getElementById('qpanel'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\n+/g, ' | ') : ''; });

  await ev(() => { Store.settings.cc = false; const c = Library.data.channels.find(c => c.n === 'Caption Test'); Views.startChannel(c, false, Views.goFull); });
  await page.waitForFunction(() => Player.playing, null, { timeout: 30000 });
    await page.waitForTimeout(5000);
  ok('plays with the built-in demuxer', await ev(() => Player.engine) === 'built-in demuxer', await ev(() => Player.engine));
  ok('the captions are found in the stream', await ev(() => Player.cc.found), JSON.stringify(await ev(() => Player.cc)));
  ok('off by default: nothing over the picture', !(await ccText()), await ccText());

  // On from the quick menu.
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  let m = await modal();
  ok('the quick menu has Captions, off', /Captions \| Off/.test(m), m);
  const idx = await ev(() => [].slice.call(document.querySelectorAll('#qpanel .qp-act')).findIndex(x => /Captions/.test(x.textContent)));
  for (let k = 0; k < idx; k++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  m = await modal();
  ok('OK turns them on and the menu says so', /Captions \| On/.test(m) && await ev(() => Store.settings.cc === true), m);
  await page.keyboard.press('Escape'); await page.waitForTimeout(3500);
  // In time: the caption on screen names a time close to where the video is.
  let samples = [];
  for (let k = 0; k < 4; k++) {
    const s = await ev(() => { const e = document.querySelector('#stage .cc'); return { text: e && e.style.display !== 'none' ? e.innerText.trim() : '', t: document.getElementById('video').currentTime }; });
    samples.push(s); await page.waitForTimeout(1300);
  }
  await shot('tv-captions');
  const good = samples.filter(s => { const m2 = /Caption \d+ at (\d+):(\d\d)/.exec(s.text); if (!m2) return false; const at = +m2[1] * 60 + +m2[2]; const loop = s.t % 120.02; return loop - at >= -0.6 && loop - at < 3.6; });
  ok('captions show, in time with the picture', good.length >= 3, JSON.stringify(samples));
  ok('drawn at the bottom rows, as sent', await ev(() => { const l = document.querySelector('#stage .cc-line'); return l && parseFloat(l.style.top) > 80; }));
  // Size.
  const f1 = await ev(() => parseFloat(document.querySelector('#stage .cc').style.fontSize));
  await ev(() => { Store.settings.ccSize = 'l'; }); await page.waitForTimeout(3200);
  const f2 = await ev(() => parseFloat(document.querySelector('#stage .cc').style.fontSize));
  ok('Caption size: Large is bigger', f2 > f1, f1 + ' -> ' + f2);
  // Not in the preview window.
  await ev(() => Views.runAction('exit', 'player')); await page.waitForTimeout(800);
  ok('not over the preview window', !(await ccText()), await ccText());
  await ev(() => Views.goFull()); await page.waitForTimeout(3500);
  ok('back in fullscreen they return', !!(await ccText()));
  // Off again, from the Red options menu.
  await ev(() => Player.setCC(false)); await page.waitForTimeout(500);
  ok('off: gone at once', !(await ccText()));
  // On again from the Red (or hold OK) options menu: they show without reconnecting.
  const before = await ev(() => Player.retries || 0), gen0 = await ev(() => document.getElementById('video').currentSrc);
  await ev(() => Views.runAction('menu', 'player')); await page.waitForTimeout(500);
  const opts = await ev(() => UI.menuLabels);
  const oi = opts.findIndex((t) => /^Closed captions/.test(t || ''));
  ok('the options menu has Closed captions', oi >= 0, JSON.stringify(opts));
  for (let k = 0; k < oi; k++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100); }
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  if (await ev(() => !document.getElementById('modal').classList.contains('hidden'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.waitForTimeout(4000);
  ok('on from the options menu: they show, no reconnect', await ev(() => Store.settings.cc === true) && !!(await ccText()) && await ev(() => document.getElementById('video').currentSrc) === gen0, JSON.stringify({ cc: await ev(() => Store.settings.cc), text: await ccText() }));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all caption checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
