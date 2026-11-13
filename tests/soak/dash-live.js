/* A DASH live channel's own time-shift window (issue #85): ◀ goes back inside it from the same connection, ▶
   moves forward, ▶ at the end and Back are live again, and nothing reconnects or asks the provider for a
   catch-up address.  The live stream is made here by ffmpeg in real time (skipped without it).
     npm run serve &
     node tests/soak/dash-live.js */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const FF = process.env.TIVIBRO_FFMPEG || (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };

(async () => {
  try { cp.execFileSync(FF, ['-version']); } catch (e) { console.log('SKIP no ffmpeg'); process.exit(0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dashlive-'));
  // A live stream with a 60 s window (30 pieces of 2 s), written as it plays.
  const ff = cp.spawn(FF, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '240', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-f', 'dash', '-seg_duration', '2', '-window_size', '30', '-extra_window_size', '5', '-use_template', '1', '-use_timeline', '1',
    '-adaptation_sets', 'id=0,streams=v id=1,streams=a', path.join(tmp, 'live.mpd')], { stdio: 'ignore' });
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (/begin=|utc=|timeshift/.test(req.url)) { srv.catchup = (srv.catchup || 0) + 1; }
    const f = path.join(tmp, path.basename(u));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': /\.mpd$/.test(f) ? 'application/dash+xml' : 'video/mp4', 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  console.log('making 50 s of live stream...');
  await new Promise((f) => setTimeout(f, 50000));

  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    let starts = 0;
    await ev(() => { window.__starts = 0; const o = Log.info; Log.info = function (c, m) { if (c === 'player' && /^Start /.test(m)) window.__starts++; return o.apply(this, arguments); }; });
    // Played the way the app plays a channel, full screen, so the keys go through views.js.
    const ch = { k: 'dl1', n: 'DASH Live', url: BASE + '/live.mpd', dash: 1, g: 'Test', num: 9001 };
    await ev((c) => { Views.startChannel(c, false, Views.goFull); }, ch);
    await page.waitForFunction(() => Player.playing, null, { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const w0 = await ev(() => Player.liveWindow());
    ok('a live DASH channel has a time-shift window', w0 && w0.end - w0.start >= 30, JSON.stringify(w0));
    starts = await ev(() => window.__starts);

    // ◀ on the remote (the Rewind action): back inside the window, said on screen.
    await ev(() => Views.runAction('rewind', 'player'));
    await page.waitForTimeout(1500);
    const k = await ev(() => ({ w: Player.liveWindow(), toast: document.getElementById('toast').textContent, skip: Store.settings.skip }));
    ok('◀ goes back inside the window and says how far', k.w && k.w.behind >= k.skip - 3 && /behind live/.test(k.toast), JSON.stringify(k));
    await ev(() => Player.liveSeek(1e6));
    await page.waitForTimeout(3000);
    const r1 = await ev(() => Player.liveSeek(-20));
    await page.waitForTimeout(5000);
    const w1 = await ev(() => ({ w: Player.liveWindow(), playing: Player.playing, state: Player.state }));
    ok('back 20 s inside the window, still playing', r1 && r1.behind >= 15 && w1.playing && w1.w && w1.w.behind >= 15, JSON.stringify({ r1, w1 }));
    await page.waitForTimeout(8000);
    const w2 = await ev(() => Player.liveWindow());
    ok('it stays behind live (nothing pulls it back to the edge)', w2 && w2.behind >= 12, JSON.stringify(w2));
    const r2 = await ev(() => Player.liveSeek(-1e6));
    ok('back to the start of the window, no further', r2 && r2.first, JSON.stringify(r2));
    await page.waitForTimeout(4000);
    ok('plays from there', await ev(() => Player.playing && Player.liveWindow() && Player.liveWindow().behind > 30));
    const r3 = await ev(() => Player.liveSeek(1e6));
    await page.waitForTimeout(4000);
    const w3 = await ev(() => Player.liveWindow());
    ok('forward past the end is live again', r3 && r3.edge && w3 && w3.behind < 12, JSON.stringify({ r3, w3 }));
    ok('no reconnect, and no catch-up address asked for', (await ev(() => window.__starts)) === starts && !srv.catchup, JSON.stringify({ starts, now: await ev(() => window.__starts), catchup: srv.catchup }));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); srv.close(); try { ff.kill('SIGKILL'); } catch (e) {}
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all DASH live checks passed');
  process.exit(fails ? 1 : 0);
})();
