/* A live channel whose sound is AAC above 48 kHz (a college football game sent AAC 96 kHz mono, November
   2026: the TV played it silent).  On a pretend 2022 C2 the player sees the rate in the stream's media
   info, plays the channel through the audio converter instead, and the converter's output is AC-3 at 48 kHz.
   Headless Chromium can't decode H.264, so the <video> element is stood in for, as in convert-audio.js.
     node tests/mock/mock_provider.js &                       (on :8077)
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg npm run serve &     (app on :8078, dev helper on :47811)
     node tests/soak/convert-live-rate.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const FF = process.env.TIVIBRO_FFMPEG || '/usr/local/bin/ffmpeg';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); if (!c) fails++; };

// The channel: H.264 with AAC LC 96 kHz mono, as MPEG-TS, sent over and over like a live stream.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-soak-rate-'));
const TS = path.join(tmp, 'aac96.ts');
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=96000:duration=10',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '25', '-c:a', 'aac', '-ar', '96000', '-ac', '1', '-b:a', '96k', '-f', 'mpegts', TS]);
const file = fs.readFileSync(TS);
const server = http.createServer((q, s) => {
  if (!/^\/live\/u\/p\/7001\.ts/.test(q.url)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': 'video/mp2t' });
  let n = 0; const t = setInterval(() => { if (s.destroyed || n++ > 30) { clearInterval(t); return s.end(); } s.write(file); }, 1000);
  q.on('close', () => clearInterval(t));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + server.address().port + '/live/u/p/7001.ts';
  const b = await chromium.launch();
  try {
    const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(R.init({ time: Date.now() })[0]);
    await page.goto(APP);
    const ev = (f, a) => page.evaluate(f, a);
    await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 });
    const st = await ev(() => Convert.status(true));
    if (st.state !== 'ready') { ok('the dev helper has a converter (start it with TIVIBRO_FFMPEG=' + FF + ')', false, st); throw new Error('no converter'); }
    await ev(() => {
      Caps._model('OLED65C2PUA');
      Store.settings.convertAudio = 'auto'; Store.settings.engine = 'auto'; Store.saveSettings();
      window.__notices = []; Player.on('notice', function (m) { window.__notices.push(m); });
    });
    // The rule itself, as the app sees this stream's media info.
    ok('AAC at 96 kHz is sound the C2 can\'t play', await ev(() => Caps.unplayable('aac', 1, null, 96000) === 'AAC at 96 kHz' && !Caps.unplayable('aac', 2, null, 48000)));
    // Play it as a live channel through the built-in demuxer: mpegts.js reads the rate, the converter takes over.
    await ev((u) => Player.play({ k: 'rate1', n: 'AAC 96 kHz test', url: u }, { preview: false }), URL);
    await page.waitForFunction(() => Player.converting, null, { timeout: 20000 }).catch(() => {});
    const conv = await ev(() => Player.converting);
    ok('the live channel goes through the converter', conv && conv.codec === 'aac' && conv.fmt === 'ts', conv);
    const src = (conv && conv.url) || '';
    ok('the link asks for AAC mono at 96 kHz', /&c=aac&ch=1&sr=96000/.test(src), src);
    await page.waitForTimeout(1500);
    const notes = await ev(() => window.__notices.slice());
    ok('the viewer is told: "Converting AAC at 96 kHz audio for this TV"', notes.indexOf('Converting AAC at 96 kHz audio for this TV') >= 0, notes);
    // What the helper sends: AC-3 at 48 kHz (a few seconds of it, into ffprobe).
    const link = src;
    await ev(() => Player.stop());
    const out = path.join(tmp, 'out.ts');
    await new Promise((res) => {
      const f = fs.createWriteStream(out); let n = 0;
      http.get(link, (r) => { r.on('data', (d) => { f.write(d); n += d.length; if (n > 600000) { r.destroy(); f.end(); res(); } }); r.on('end', () => { f.end(); res(); }); }).on('error', () => res());
      setTimeout(() => { f.end(); res(); }, 15000);
    });
    const probe = cp.spawnSync(FF, ['-hide_banner', '-i', out]).stderr.toString();
    ok('the helper sends AC-3 at 48 kHz', /Audio: ac3[^\n]*48000 Hz/.test(probe), probe.split('\n').filter((l) => /Stream|Input/.test(l)).join(' | '));
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { if (e.message !== 'no converter') ok('harness: ' + e.message, false); }
  await b.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'all live sample rate checks passed');
  process.exit(fails ? 1 : 0);
})();
