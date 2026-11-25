/* Dialogue boost and night mode (app/js/dialog.js), the sound itself, in a real browser's Web Audio (an offline
   context, no speakers): off changes nothing, Low and High lift what both speakers share (voices) over what
   differs (music, effects) and keep left and right apart, a mono stream comes out on both sides, the limiter keeps
   the lift under full scale, and night mode brings a loud part and a quiet part closer together.
     npm run serve &        (or any server on app/ at 8078)
     node tests/soak/dialog.js */
'use strict';
const { chromium } = require('playwright');
const APP = (process.env.APP || 'http://127.0.0.1:8078/index.html').replace(/index\.html$/, '');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(APP + 'js/dialog.js');                 // any page on the same origin; the script is added below
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ url: APP + 'js/dialog.js' });
  // Renders 1 s of a test signal through the chain at a setting: { lvl, night, mid, side, mono, amp }.
  const run = (o) => page.evaluate(async (o) => {
    const rate = 48000, n = rate, ac = new OfflineAudioContext(2, n, rate), buf = ac.createBuffer(o.mono ? 1 : 2, n, rate);
    const L = buf.getChannelData(0), R = o.mono ? null : buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const t = i / rate, amp = o.loudFrom != null && t >= o.loudFrom ? o.loud : (o.amp || 0.3);
      const mid = Math.sin(2 * Math.PI * 2800 * t) * amp * (o.mid != null ? o.mid : 1), side = Math.sin(2 * Math.PI * 440 * t) * amp * (o.side || 0);
      L[i] = mid + side; if (R) R[i] = o.onlyLeft ? 0 : mid - side;
    }
    const src = ac.createBufferSource(); src.buffer = buf;
    Dialog._build(ac, src, ac.destination).set(o.lvl, o.night);
    src.start();
    const out = await ac.startRendering(), a = out.getChannelData(0), c = out.getChannelData(1);
    // Middle and sides of what came out, as RMS, over the second half (after the filters and compressor settle),
    // and of a part (from-to seconds) for night mode.
    const rms = (f, from, to) => { let s = 0, k = 0; for (let i = Math.floor(from * rate); i < Math.floor(to * rate); i++) { const v = f(i); s += v * v; k++; } return Math.sqrt(s / k); };
    const h = [0.5, 1];
    return { mid: rms((i) => (a[i] + c[i]) / 2, ...h), side: rms((i) => (a[i] - c[i]) / 2, ...h), L: rms((i) => a[i], ...h), R: rms((i) => c[i], ...h),
      peak: Math.max(...Array.from(a).map(Math.abs), ...Array.from(c).map(Math.abs)),
      quiet: rms((i) => a[i], 0.3, 0.45), loudPart: rms((i) => a[i], 0.8, 0.95) };
  }, o);
  try {
    const off = await run({ lvl: 'off', night: false, mid: 1, side: 1 });
    const inMid = 0.3 / Math.SQRT2, inSide = 0.3 / Math.SQRT2;
    ok('off: the sound passes unchanged (middle and sides as they went in)', Math.abs(off.mid - inMid) < 0.01 && Math.abs(off.side - inSide) < 0.01, off);
    const low = await run({ lvl: 'low', night: false, mid: 1, side: 1 }), high = await run({ lvl: 'high', night: false, mid: 1, side: 1 });
    const ratio = (r) => r.mid / r.side;
    ok('Low lifts voices over the rest', ratio(low) > ratio(off) * 1.8, { off: ratio(off), low: ratio(low) });
    ok('High more than Low', ratio(high) > ratio(low) * 1.5, { low: ratio(low), high: ratio(high) });
    const left = await run({ lvl: 'high', night: false, onlyLeft: true });
    ok('left and right stay where they were (a sound only on the left stays louder on the left; High narrows it toward the middle on purpose)', left.L > left.R * 1.2, left);
    const mono = await run({ lvl: 'high', night: false, mono: true });
    ok('a mono stream comes out on both speakers, the same', mono.L > 0.05 && Math.abs(mono.L - mono.R) < 0.01, mono);
    const hot = await run({ lvl: 'high', night: true, mid: 1, side: 0, amp: 0.95 });
    ok('the limiter keeps it under full scale, even High with night mode on a loud stream', hot.peak <= 1.0, hot.peak);
    const dynOff = await run({ lvl: 'off', night: false, mid: 1, side: 0, amp: 0.05, loudFrom: 0.5, loud: 0.8 });
    const dynOn = await run({ lvl: 'off', night: true, mid: 1, side: 0, amp: 0.05, loudFrom: 0.5, loud: 0.8 });
    ok('night mode: loud and quiet closer together', dynOn.loudPart / dynOn.quiet < (dynOff.loudPart / dynOff.quiet) * 0.6, { off: dynOff.loudPart / dynOff.quiet, night: dynOn.loudPart / dynOn.quiet });
    ok('night mode: quiet talk comes up', dynOn.quiet > dynOff.quiet, { off: dynOff.quiet, night: dynOn.quiet });
    ok('no page errors', !errs.length, errs);
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all dialogue boost checks passed');
  process.exit(fails ? 1 : 0);
})();
