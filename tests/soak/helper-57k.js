/* Issue #178 on a computer: a 1 GB webOS 6 TV with about 57,500 channels, a big movie and show list and the
   provider's full XMLTV guide, whose network helper froze for good a few seconds after it started.  This runs the
   real helper code (tests/mock/relay_dev.js with HELPER_BOX: the lag timer and black box as on the TV) on the Node
   version that TV has, starts TiviBro in Chromium twice (the second start is what the TV does every day: the list
   kept from the last load), and watches the helper the way TiviBro does: a /ping every 250 ms.
   It reports the longest the helper went without answering and when, what its lag timer logged, its memory, and its
   black box, and fails when the helper stops answering for HELPER_FROZEN_S seconds (default 60) or more.

     NODE8=/path/to/node-v8.12.0/bin/node node tests/soak/helper-57k.js
   Optional: H57_CHANNELS (57500), H57_GUIDE (channels with a guide, 20000), H57_VOD (extra movies, 40000),
   H57_SECS (seconds of the second start, 240), H57_HEAP (the helper's --max-old-space-size in MB, none),
   H57_EPG (the playlist's provider guide: xmltv, short or off).
   Stop npm run serve, relay_dev and mock providers first: it starts its own on 8078, 47811 and 8092.
   A computer is not a TV: a pass says the helper's own work doesn't hold it up here, not that webOS won't. */
'use strict';
const { chromium } = require('playwright');
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const R = require('../../scripts/demo/record.js');
const ROOT = path.join(__dirname, '../..');
const NODE8 = process.env.NODE8 || 'node';
const N = +process.env.H57_CHANNELS || 57500, GUIDE = process.env.H57_GUIDE != null ? +process.env.H57_GUIDE : 20000, VOD = process.env.H57_VOD != null ? +process.env.H57_VOD : 40000;
const SECS = +process.env.H57_SECS || 240, FROZEN = +process.env.HELPER_FROZEN_S || 60, EPG = process.env.H57_EPG || 'xmltv';
const MOCK = 8092, APP = 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One GET to the helper or the mock, with a time limit: the body, or null.
function get(port, p, ms) {
  return new Promise((resolve) => {
    const q = http.get({ host: '127.0.0.1', port, path: p, timeout: ms }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve(b)); });
    q.on('timeout', () => { q.destroy(); resolve(null); });
    q.on('error', () => resolve(null));
  });
}
async function until(port, p, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await get(port, p, 2000) != null) return true; await sleep(300); } return false; }

// The helper's memory (Linux), in MB.
function rss(pid) { try { return Math.round(+/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + pid + '/status', 'utf8'))[1] / 1024); } catch (e) { return 0; } }

/* Watches the helper as TiviBro's pings do: one /ping in flight at a time, every 250 ms, noting each answer's time
   and the helper's memory.  stop() gives the gaps (the longest time without an answer, with when it began). */
function watch(pid, t0) {
  const answers = [], mem = [];
  let on = true, last = Date.now();
  (async function loop() {
    while (on) {
      const ok = await get(47811, '/ping', 120000);
      const t = Date.now();
      if (ok != null) { answers.push([last - t0, t - last]); last = t; }
      // With the guide's progress beside it (the provider's guide, the playlist 'big'), every 4th look.
      let g = '';
      if (mem.length % 4 === 0) { try { const j = JSON.parse(await get(47811, '/guide/status?pl=big&kind=main', 3000)); g = j.phase + (j.job ? ' ' + Math.round(j.job.bytes / 1048576) + ' MB read, ' + j.job.programmes + ' programmes' : ''); } catch (e) {} }
      mem.push([t - t0, rss(pid), g]);
      await sleep(250);
    }
  })();
  return { stop: () => { on = false; return { gaps: answers.filter((a) => a[1] > 1500), worst: answers.reduce((a, x) => (x[1] > a[1] ? x : a), [0, 0]), stillOut: Date.now() - last, mem }; } };
}

(async () => {
  const kids = [];
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'h57-'));
  const run = (cmd, args, env, name) => {
    const k = cp.spawn(cmd, args, { cwd: ROOT, env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(path.join(box, name + '.log')); k.stdout.pipe(out); k.stderr.pipe(out);
    kids.push(k); return k;
  };
  const end = async (code) => { kids.forEach((k) => { try { k.kill('SIGTERM'); } catch (e) {} }); await sleep(500); process.exit(code); };
  try {
    // The provider: channels in 25-channel groups, a guide for the first H57_GUIDE of them, and a big movie list.
    run('node', ['tests/mock/mock_provider.js'], { MOCK_PORT: String(MOCK), MOCK_BIG: String(N), MOCK_BIG_EPG: String(GUIDE), MOCK_BIG_VOD: String(VOD) }, 'mock');
    ok('the provider is up', await until(MOCK, '/player_api.php?username=u&password=p', 60000));
    const xml = await get(MOCK, '/xmltv.php?username=u&password=p', 600000);
    console.log('provider guide: ' + (xml ? (xml.length / 1048576).toFixed(0) + ' MB, ' + (xml.match(/<programme /g) || []).length + ' programmes' : 'none'));
    // The helper on the TV's Node, with its black box.
    const heap = process.env.H57_HEAP ? ['--max-old-space-size=' + process.env.H57_HEAP] : [];
    const helper = run(NODE8, heap.concat(['tests/mock/relay_dev.js']), { HELPER_BOX: box, COMPANION_DIR: box, TIVIBRO_GUIDE_DIR: path.join(box, 'guide') }, 'helper');   // a fresh guide every run
    ok('the helper is up', await until(47811, '/ping', 30000));
    console.log('helper: Node ' + String(cp.execFileSync(NODE8, ['-v'])).trim() + (heap.length ? ', heap capped at ' + process.env.H57_HEAP + ' MB' : ''));
    run('python3', ['-m', 'http.server', '8078', '--bind', '127.0.0.1', '--directory', 'app'], {}, 'serve');   // the app only: the helper is ours
    ok('the app is served', await until(8078, '/index.html', 30000));

    const b = await chromium.launch();
    const pl = Object.assign({}, R.SETTINGS.playlists[0], { id: 'big', name: 'Big', server: 'http://127.0.0.1:' + MOCK, providerEpg: EPG, pubEpg: { on: false }, plRefresh: 0 });
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl], active: 'big' } })[0]);
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 }));

    // First start: the list read from the provider and kept, the guide read (as on a TV that has used TiviBro before).
    const t1 = Date.now(), w1 = watch(helper.pid, t1);
    let tv = await ctx.newPage();
    await tv.goto(APP);
    await tv.waitForFunction(() => window.Library && Library.count() > 50000, null, { timeout: 600000 }).catch(() => {});
    await tv.waitForTimeout(90000);
    const first = w1.stop();
    // The biggest answers the helper gave during the first start (what it read or held), by size.
    try {
      const L = JSON.parse(await get(47811, '/log', 10000)).log.filter((e) => e.u && e.b);
      console.log('--- the helper\'s biggest answers in the first start');
      L.sort((a, b) => b.b - a.b).slice(0, 8).forEach((e) => console.log('   ' + String(Math.round(e.b / 1048576)).padStart(5) + ' MB  ' + String(e.ms).padStart(6) + ' ms  ' + String(e.u).replace(/^https?:\/\/[^/]+/, '').slice(0, 90)));
      console.log('--- the helper\'s own routes, with its memory');
      JSON.parse(await get(47811, '/log', 10000)).log.filter((e) => /^route /.test(e.event || '') && !/status/.test(e.event)).slice(0, 25).forEach((e) => console.log('   ' + String(Math.round((e.t - t1) / 1000)).padStart(4) + ' s  ' + e.event + '  ' + JSON.stringify(e.mem)));
    } catch (e) {}
    const firstLines = await tv.evaluate(() => (window.Log ? Log.lines(true) : [])).catch(() => []);
    await tv.close();

    // Second start, what the TV does every day.
    const t2 = Date.now(), w2 = watch(helper.pid, t2);
    tv = await ctx.newPage();
    const errs = []; tv.on('pageerror', (e) => errs.push(e.message));
    await tv.goto(APP);
    await tv.waitForTimeout(SECS * 1000);
    const second = w2.stop();
    const r = await tv.evaluate(() => ({ count: window.Library ? Library.count() : 0, lines: window.Log ? Log.lines(true) : [] })).catch(() => ({ count: 0, lines: [] }));

    const report = (name, w) => {
      const peak = w.mem.reduce((a, x) => (x[1] > a[1] ? x : a), [0, 0]);
      console.log(name + ': longest without an answer ' + (w.worst[1] / 1000).toFixed(1) + ' s, from ' + (w.worst[0] / 1000).toFixed(1) + ' s; helper memory peak ' + peak[1] + ' MB at ' + (peak[0] / 1000).toFixed(0) + ' s');
      // The helper's memory every 10 s, with the guide's progress then.
      for (let x = 0; x < w.mem.length; x += 40) console.log('   ' + String(Math.round(w.mem[x][0] / 1000)).padStart(4) + ' s  ' + String(w.mem[x][1]).padStart(5) + ' MB  ' + (w.mem.slice(x, x + 40).map((m) => m[2]).filter(Boolean).pop() || ''));
      w.gaps.slice(0, 15).forEach((g) => console.log('   no answer for ' + (g[1] / 1000).toFixed(1) + ' s from ' + (g[0] / 1000).toFixed(1) + ' s'));
      if (w.stillOut > 3000) console.log('   still not answering at the end, for ' + (w.stillOut / 1000).toFixed(0) + ' s');
    };
    report('first start', first);
    report('second start', second);
    const hlog = await get(47811, '/log', 10000);
    let held = [];
    try { held = JSON.parse(hlog).log.filter((e) => /held up|stopped|error/i.test(e.event || '') || e.lv === 'error').slice(-20); } catch (e) {}
    console.log('--- what the helper logged about being held up');
    held.forEach((e) => console.log('  ' + new Date(e.t).toISOString().slice(11, 19) + '  ' + (e.event || '') + '  ' + (e.held || '') + '  ' + JSON.stringify(e.doing || e.e || '').slice(0, 200)));
    try { console.log('--- black box: ' + JSON.stringify(JSON.parse(fs.readFileSync(path.join(box, 'helper-state.json'), 'utf8')).shots.slice(-3)).slice(0, 900)); } catch (e) {}
    console.log('--- the app\'s log, helper and guide lines');
    firstLines.concat(['── second start ──'], r.lines).filter((l) => /net |epg |guide|helper|closed|memory|Big list/i.test(l)).slice(-50).forEach((l) => console.log('  ' + String(l).replace(/\s+/g, ' ').slice(0, 160)));
    ok('the second start opens the list', r.count > 50000, r.count);
    ok('the helper never goes ' + FROZEN + ' s without answering', Math.max(first.worst[1], second.worst[1], first.stillOut, second.stillOut) < FROZEN * 1000,
      'first ' + (first.worst[1] / 1000).toFixed(0) + ' s, second ' + (second.worst[1] / 1000).toFixed(0) + ' s');
    ok('no page errors', !errs.length, errs.join(' | '));
    console.log('logs and the black box: ' + box);
    await b.close();
    await end(fails ? 1 : 0);
  } catch (e) { console.error(e); await end(1); }
})();
