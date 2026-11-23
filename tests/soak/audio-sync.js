/* Audio sync (discussion #60): OK > Audio sync in fullscreen opens the bar over the picture, ◀ ▶ ▲ ▼ move the sound,
   it's kept for the channel, the stream starts again with it, and the player's audio buffer really carries it.
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/audio-sync.js */
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
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1000);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    const st = await ev(async () => {
      Views.switchTab('live');
      const c = Library.channels(Library.ALL)[0];
      await new Promise((r) => Views.startChannel(c, false, () => { Views.goFull(); r(); }));
      await new Promise((r) => setTimeout(r, 2500));
      return { name: c.n, key: c.k, kind: Player._test.kind };
    });
    console.log('playing', JSON.stringify(st));
    const qp = await ev(() => Views.QP_BUTTONS.map((x) => x[0]));
    ok('Audio sync is a quick menu button', qp.indexOf('sync') >= 0, qp);
    await ev(() => Views.runAction('sync', 'player'));
    let txt = await ev(() => { const e = document.querySelector('.avsync'); return e ? e.innerText : ''; });
    ok('the bar opens, as sent, with the hints', /Sound and picture as they come/.test(txt) && /lips/.test(txt) && /20 ms/.test(txt), txt);
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k); await page.waitForTimeout(120); }
    txt = await ev(() => document.querySelector('.avs-val').innerText);
    ok('▶ ▶ ▲ reads "Sound 140 ms later"', txt === 'Sound 140 ms later', txt);
    const kept = await ev((k) => Store.settings.avSync && Store.settings.avSync['c:' + k], st.key);
    ok('kept for the channel', kept === 140, kept);
    await page.waitForTimeout(4500);
    const real = await ev(() => {
      const d = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'timestampOffset');
      return AvSync._test.pairs().filter((p) => p.src.readyState !== 'closed').map((p) => ({ kind: p.kind, own: p.sb.timestampOffset, real: d.get.call(p.sb) }));
    });
    console.log('buffers', JSON.stringify(real));
    const a = real.find((x) => x.kind === 'a');
    if (st.kind === 'native') console.log('SKIP the buffer check: this Chromium plays the mock on its own player');
    else ok('after the restart, the audio buffer is 140 ms on from the player\'s own offset', a && Math.abs(a.real - a.own - 0.14) < 0.001, JSON.stringify(real));
    for (const k of ['ArrowLeft', 'ArrowDown', 'ArrowDown']) { await page.keyboard.press(k); await page.waitForTimeout(120); }
    txt = await ev(() => document.querySelector('.avs-val').innerText);
    ok('◀ ▼ ▼ goes past 0: "Sound 80 ms earlier"', txt === 'Sound 80 ms earlier', txt);
    await page.waitForTimeout(4500);
    const real2 = await ev(() => {
      const d = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'timestampOffset');
      return AvSync._test.pairs().filter((p) => p.src.readyState !== 'closed').map((p) => ({ kind: p.kind, own: p.sb.timestampOffset, real: d.get.call(p.sb) }));
    });
    const v = real2.find((x) => x.kind === 'v'), a2 = real2.find((x) => x.kind === 'a');
    if (st.kind !== 'native') ok('earlier moves the picture on instead, the sound stays', v && a2 && Math.abs(v.real - v.own - 0.08) < 0.001 && Math.abs(a2.real - a2.own) < 0.001, JSON.stringify(real2));
    const t0 = await ev(() => document.querySelector('video').currentTime); await page.waitForTimeout(1500);
    const t1 = await ev(() => document.querySelector('video').currentTime);
    ok('it keeps playing with the picture moved', t1 > t0 + 0.8, t0 + ' -> ' + t1);
    await page.keyboard.press('Enter');
    ok('OK closes the bar', await ev(() => !document.querySelector('.avsync')));
    const label = await ev(() => { Views.runAction('menu', 'player'); return UI.menuLabels.join(' | '); });
    ok('Options lists Audio sync', /Audio sync/.test(label), label);
    await ev(() => { UI.closeMenu && UI.closeMenu(); AvSync.forgetAll(); Player.stop(); });
    ok('Forget clears them', await ev(() => AvSync.count() === 0));
  } catch (e) { ok('ran', false, e.stack); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
