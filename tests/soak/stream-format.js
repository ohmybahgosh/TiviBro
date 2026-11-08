/* A channel's own stream format (Hold OK on a channel > Stream format…): HLS or MPEG-TS for that channel
   whatever Settings > Playback > Stream format says, it starts again in it when it's the one playing,
   Settings lists the channels that have one, and Automatic goes back.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/stream-format.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const asked = []; page.on('request', (r) => { const m = /\/live\/.*?\/(\d+)\.(ts|m3u8)/.exec(r.url()); if (m) asked.push(m[1] + '.' + m[2]); });
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    const c = await ev(() => { Views.switchTab('live'); const c = Library.channels(Library.ALL)[2]; return { k: c.k, id: String(c.id), n: Library.name(c) }; });
    const labels = await ev((k) => { const c = Library.find(k); Views.chanMenu(c, c.g); const l = UI.menuLabels; UI.close(); return l; }, c.k);
    ok('Hold OK on a channel offers Stream format', labels.indexOf('Stream format…') >= 0, labels.join(' | '));
    // HLS for this channel, with the playlist on MPEG-TS.
    await ev(() => { Store.settings.format = 'ts'; });
    const pick = async (label) => {
      await ev((k) => { const c = Library.find(k); Views.chanMenu(c, c.g); }, c.k);
      await ev(() => { const i = UI.menuLabels.indexOf('Stream format…'); for (let n = 0; n < i; n++) UI.press('down'); UI.press('ok'); });
      const l = await ev(() => UI.menuLabels);
      await ev((lb) => { const i = UI.menuLabels.indexOf(lb), cur = UI.menuLabels.findIndex((x, j) => document.querySelectorAll('#modalBody .mi')[j] && document.querySelectorAll('#modalBody .mi')[j].classList.contains('focus')); for (let n = 0; n < Math.abs(i - cur); n++) UI.press(i > cur ? 'down' : 'up'); UI.press('ok'); }, label);
      return l;
    };
    await ev((k) => Views.startChannel(Library.find(k), true), c.k); await page.waitForTimeout(2500);
    asked.length = 0;
    const menu = await pick('HLS');
    ok('the choices: Automatic, HLS, MPEG-TS', menu.join() === 'Automatic,HLS,MPEG-TS', menu.join(' | '));
    await page.waitForTimeout(3000);
    ok('chosen HLS: kept for the channel', await ev((k) => Store.edits.streamFmt[k] === 'hls', c.k));
    ok('and the channel playing starts again as HLS', asked.indexOf(c.id + '.m3u8') >= 0, asked.join(' '));
    // MPEG-TS for this channel, with the playlist on HLS.
    await ev(() => { Store.settings.format = 'm3u8'; });
    asked.length = 0;
    await pick('MPEG-TS'); await page.waitForTimeout(3000);
    ok('MPEG-TS for the channel while the playlist is on HLS', asked[0] === c.id + '.ts', asked.join(' '));
    const sub = await ev((k) => { const c = Library.find(k); Views.chanMenu(c, c.g); const it = [].slice.call(document.querySelectorAll('#modalBody .mi')).map((x) => x.innerText); UI.close(); return it.join(' | '); }, c.k);
    ok('the channel menu says which', /Stream format…\s*MPEG-TS/.test(sub), sub);
    await ev(() => { Views.switchTab('settings'); Settings.open(); Settings.section('playback'); }); await page.waitForTimeout(500);
    const st = await ev(() => document.querySelector('.set-scroll').innerText);
    ok('Settings > Playback lists the channels with their own format', new RegExp('Channels with their own format[\\s\\S]*' + c.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': MPEG-TS').test(st), st.slice(st.indexOf('Stream format'), st.indexOf('Stream format') + 300));
    // Automatic again: the playlist's setting.
    await ev((k) => { Views.switchTab('live'); Views.startChannel(Library.find(k), true); }, c.k); await page.waitForTimeout(2500);
    asked.length = 0;
    await pick('Automatic'); await page.waitForTimeout(3000);
    ok('Automatic: the playlist\'s setting again', await ev((k) => !(k in Store.edits.streamFmt), c.k) && asked[0] === c.id + '.m3u8', asked.join(' '));
    // Not offered where there's only one way: a channel with its own address that isn't Xtream live.
    ok('not offered for a channel that comes one way only', await ev(() => !Player.canSwitchFormat({ k: 'x', url: 'http://example.com/stream/abc.mp4' })));
    await ev(() => { Store.settings.format = 'ts'; Store.edits.streamFmt = {}; Store.saveEdits(); Views.stopAll && Views.stopAll(); });
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all stream format checks passed');
  process.exit(fails ? 1 : 0);
})();
