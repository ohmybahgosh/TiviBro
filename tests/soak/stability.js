/* Stability over a long session, the way a 1 GB TV gets used (issues #61, #64): zapping through good channels,
   ones the provider answers 404 for and .m3u8 links that aren't playlists, the guide scrolled and left, fullscreen
   and back, the guide read again, an update check.  Measured after each round (garbage collected first):
   the JavaScript heap, live MediaSource / SourceBuffer / video objects, DOM nodes, event listeners, timers, the
   page's own memory (its renderer process) and the network helper's.  What a round leaves behind shows up as a
   rise from the first measured round to the last.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     MOCK_PORT=8090 MOCK_BIG=6000 MOCK_BIG_EPG=6000 node tests/mock/mock_provider.js &
     npm run serve &
     MINUTES=3 node tests/soak/stability.js
   BIG=1: a playlist the size of the TVs in issues #61 and #64 (6,000 channels, an extra guide of 2 days with
   descriptions), and the peaks too: the most the page held at any moment, and what it was doing then. */
'use strict';
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
const MINUTES = +(process.env.MINUTES || 3), BIG = !!process.env.BIG, BIGMOCK = process.env.BIGMOCK || 'http://127.0.0.1:8090';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const MB = (x) => (x / 1048576).toFixed(1);
const rss = (pattern) => { try { return execSync("ps -eo rss,args | grep -E -- '" + pattern + "' | grep -v grep | awk '{s+=$1} END {print s+0}'").toString().trim() * 1024; } catch (e) { return 0; } };

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // Count timers: setInterval minus clearInterval (a timer left running each round is a leak too).
  await page.addInitScript(() => {
    window.__iv = 0; const si = window.setInterval, ci = window.clearInterval, live = new Set();
    window.setInterval = function () { const id = si.apply(window, arguments); live.add(id); window.__iv = live.size; return id; };
    window.clearInterval = function (id) { live.delete(id); window.__iv = live.size; return ci.apply(window, arguments); };
  });
  const big = BIG ? { settings: { playlists: [Object.assign({}, R.SETTINGS.playlists[0], { server: BIGMOCK, plRefresh: -1, epgDays: 2, providerEpg: 'short',
    epgSources: [{ url: BIGMOCK + '/bigguide.xml?ch=6000&days=2&desc=200', offset: 0 }] })] } } : {};
  await page.addInitScript(R.init(Object.assign({ time: R.primeTime() }, big))[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  // Peaks: the heap and the page's memory every 300 ms, with what was going on then.
  let doing = 'starting', peak = { heap: 0, page: 0 }, byPhase = {};
  const sampler = setInterval(async () => {
    try {
      const m = {}; (await cdp.send('Performance.getMetrics')).metrics.forEach((x) => { m[x.name] = x.value; });
      const pg = rss('--type=renderer'), ph = byPhase[doing] || (byPhase[doing] = { heap: 0, page: 0 });
      if (m.JSHeapUsedSize > peak.heap) peak.heap = m.JSHeapUsedSize; if (pg > peak.page) peak.page = pg;
      if (m.JSHeapUsedSize > ph.heap) ph.heap = m.JSHeapUsedSize; if (pg > ph.page) ph.page = pg;
    } catch (e) {}
  }, 300);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 90000 });
  if (BIG) { doing = 'guide load'; await page.waitForFunction(() => Epg.status && Epg.status.at && !Epg.loading, null, { timeout: 240000 }).catch(() => {}); }
  await page.waitForTimeout(2000);
  async function live(proto) {
    const p = await cdp.send('Runtime.evaluate', { expression: proto });
    if (!p.result || !p.result.objectId) return -1;
    const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId });
    const n = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    await cdp.send('Runtime.releaseObject', { objectId: q.objects.objectId }); await cdp.send('Runtime.releaseObject', { objectId: p.result.objectId });
    return n.result.value;
  }
  async function measure() {
    await ev(() => { if (window.gc) { window.gc(); window.gc(); } }); await page.waitForTimeout(600);
    const m = {}; (await cdp.send('Performance.getMetrics')).metrics.forEach((x) => { m[x.name] = x.value; });
    return {
      heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents,
      ms: await live('MediaSource.prototype'), sb: await live('SourceBuffer.prototype'), video: await live('HTMLVideoElement.prototype'),
      xhr: await live('XMLHttpRequest.prototype'), workers: await live('Worker.prototype'),
      timers: await ev(() => window.__iv), page: rss('--type=renderer'), helper: rss('node .*(service/index|relay_dev)\\.js')
    };
  }
  const fake = (url, k) => ev(([u, k]) => { const c = Object.assign({}, Library.channels(Library.ALL)[0], { k: k, n: 'Test ' + k }); Player.play(c, { url: u }); }, [url, k]);
  try {
    const good = await ev(() => Library.channels(Library.ALL).filter((c) => !/radio/i.test(c.n)).slice(0, 10).map((c) => c.k));
    let round = 0;
    async function oneRound() {
      round++;
      // Zapping, 12 channels about 1.5 s apart: one in three fails (404, or an .m3u8 that isn't a playlist).
      doing = 'zapping';
      await ev(() => Views.switchTab('live'));
      for (let i = 0; i < 12; i++) {
        if (i % 3 === 2) await fake(MOCK + (i % 2 ? '/live/u/p/4040' + (i % 10) + '.ts' : '/live/u/p/4050' + (i % 10) + '.m3u8'), 'dead' + round + '_' + i);
        else await ev((k) => Views.startChannel(Library.find(k), false), good[(round * 5 + i) % good.length]);
        await page.waitForTimeout(1500);
      }
      // Fullscreen, the info bar, back.
      await ev(() => Views.goFull && Views.goFull()); await page.waitForTimeout(1200);
      await page.keyboard.press('Enter'); await page.waitForTimeout(800);
      for (let i = 0; i < 2 && await ev(() => Views.full); i++) { await ev(() => UI.press('back')); await page.waitForTimeout(700); }
      // The guide: down two pages and across, then back to the channels.
      doing = 'guide';
      await ev(() => Views.switchTab('guide')); await page.waitForTimeout(1200);
      for (let i = 0; i < 25; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(60); }
      for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80); }
      // Every third round: the guide read again, and an update check (the releases list from GitHub).
      if (round % 3 === 0) {
        doing = 'guide reload';
        await ev(() => Epg.init(Library, true));
        await page.waitForFunction(() => !Epg.loading, null, { timeout: 120000 }).catch(() => {});
        doing = 'update check';
        await ev(() => window.Update && Update.check && Update.check(true)); await page.waitForTimeout(4000);
      }
      await ev(() => Player.stop()); await page.waitForTimeout(1000);
    }
    if (BIG) {
      /* A 1 GB TV: the guide due to be read again while a channel plays.  It waits (memory stays where it was)
         and is read once nothing plays. */
      const steady = await measure();
      await ev(() => { Player.memorySafe('test: a 1 GB TV'); Store.playlist.epgRefresh = 0.0005; window.__el = []; const i = Log.info; Log.info = function (s, t) { window.__el.push(t); return i.apply(Log, arguments); }; });
      await ev((k) => Views.startChannel(Library.find(k), false), good[0]); await page.waitForTimeout(3000);
      doing = 'guide due while playing (1 GB)'; byPhase[doing] = { heap: 0, page: 0 };
      await ev(() => Epg.init(Library)); await page.waitForTimeout(15000);
      const waited = await ev(() => window.__el.some((t) => /once nothing plays/.test(t)));
      ok('1 GB TV: the guide due while a channel plays waits', waited, (await ev(() => window.__el.filter((t) => /guide|Guide/.test(t)).slice(-4).join(' | '))));
      // (Asking re-reads the stored guide, as at start; reading it again from the sources would hold two.)
      const atStart = (byPhase['guide load'] || { heap: 0 }).heap;
      ok('and memory stays at most where the guide\'s start put it, not the double of a reload', byPhase[doing].heap < Math.max(atStart, steady.heap + 25e6) + 10e6, MB(steady.heap) + ' then at most ' + MB(byPhase[doing].heap) + ' MB (start ' + MB(atStart) + ')');
      doing = 'guide reload after stopping';
      await ev(() => Views.stopAll());
      const read = await page.waitForFunction(() => window.__el.some((t) => /Nothing playing: reading the guide again now/.test(t)), null, { timeout: 40000 }).then(() => true, () => false);
      ok('then it is read once nothing plays', read);
      await page.waitForFunction(() => !Epg.loading, null, { timeout: 120000 }).catch(() => {});
      await ev(() => { Store.playlist.epgRefresh = 0; });
    }
    await oneRound(); await oneRound();
    const first = await measure(), samples = [first];
    const end = Date.now() + MINUTES * 60000;
    while (Date.now() < end) { await oneRound(); samples.push(await measure()); }
    const last = samples[samples.length - 1];
    console.log('rounds ' + round + ' over ' + MINUTES + ' min');
    samples.forEach((s, i) => console.log('  ' + i + ': heap ' + MB(s.heap) + ' MB, page ' + MB(s.page) + ' MB, helper ' + MB(s.helper) + ' MB, nodes ' + s.nodes + ', listeners ' + s.listeners + ', MediaSource ' + s.ms + ', SourceBuffer ' + s.sb + ', video ' + s.video + ', XHR ' + s.xhr + ', workers ' + s.workers + ', timers ' + s.timers));
    const peakHeap = Math.max.apply(null, samples.map((s) => s.heap));
    clearInterval(sampler);
    console.log('peaks: heap ' + MB(peak.heap) + ' MB, page ' + MB(peak.page) + ' MB; by what was going on: ' + Object.keys(byPhase).map((k) => k + ' ' + MB(byPhase[k].heap) + '/' + MB(byPhase[k].page)).join(', '));
    ok('the JavaScript heap stays level (under 10 MB more after ' + round + ' rounds)', last.heap - first.heap < 10e6, MB(first.heap) + ' to ' + MB(last.heap) + ' MB, peak ' + MB(peakHeap));
    ok('no MediaSource, SourceBuffer or video objects left behind', last.ms <= 2 && last.sb <= 4 && last.video <= 3, JSON.stringify({ ms: last.ms, sb: last.sb, video: last.video }));
    ok('no workers or requests left behind', last.workers <= first.workers + 1 && last.xhr <= first.xhr + 5, JSON.stringify({ workers: [first.workers, last.workers], xhr: [first.xhr, last.xhr] }));
    ok('DOM nodes and listeners stay level (under 15% more)', last.nodes < first.nodes * 1.15 + 200 && last.listeners < first.listeners * 1.15 + 50, JSON.stringify({ nodes: [first.nodes, last.nodes], listeners: [first.listeners, last.listeners] }));
    ok('no timers left running each round', last.timers <= first.timers + 2, first.timers + ' to ' + last.timers);
    ok('the page\'s own memory stays level (under 60 MB more)', !first.page || last.page - first.page < 60 * 1048576, MB(first.page) + ' to ' + MB(last.page) + ' MB');
    ok('the network helper\'s memory stays level (under 30 MB more)', !first.helper || last.helper - first.helper < 30 * 1048576, MB(first.helper) + ' to ' + MB(last.helper) + ' MB');
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all stability checks passed');
  process.exit(fails ? 1 : 0);
})();
