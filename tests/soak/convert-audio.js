/* Sound the TV can't play (app/js/convert.js, service/convert.js), in the real app on a pretend 2022 TV
   (Caps._model('OLED65C2PUA'): no DTS).  A movie whose only sound is DTS 5.1 must play from the helper's
   conversion link, say so once, and keep the right time after a seek (the stream restarts at the seek,
   position = seek + the video's clock, unless the TV's player shows the movie's own times).
   Headless Chromium can't decode H.264 or AC-3, so the <video> element is stood in for (it reports
   playing and a clock); the decisions, links, times and the helper's real output are what is checked.
     node tests/mock/mock_provider.js &                       (on :8077)
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg npm run serve &     (app on :8078, dev helper on :47811)
     node tests/soak/convert-audio.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const FF = process.env.TIVIBRO_FFMPEG || '/usr/local/bin/ffmpeg';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); if (!c) fails++; };

// The movie: 20 s of H.264 with DTS 5.1 as its only sound, from a Range-capable "provider".
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-soak-convert-'));
const MKV = path.join(tmp, 'dts.mkv');
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
  '-filter_complex', '[1:a]pan=5.1(side)|FL=c0|FR=0.8*c0|FC=0.6*c0|LFE=0.3*c0|SL=0.5*c0|SR=0.4*c0[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50',
  '-c:a', 'dca', '-strict', '-2', '-b:a', '768k', '-metadata:s:a:0', 'language=eng', MKV]);
const file = fs.readFileSync(MKV);
const server = http.createServer((q, s) => {
  if (!/^\/movie\/u\/p\/9001\.mkv/.test(q.url)) { s.writeHead(404); return s.end(); }
  const r = /bytes=(\d+)-(\d*)/.exec(q.headers.range || ''), a = r ? +r[1] : 0, b = r && r[2] ? Math.min(+r[2], file.length - 1) : file.length - 1;
  s.writeHead(r ? 206 : 200, Object.assign({ 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 }, r ? { 'Content-Range': 'bytes ' + a + '-' + b + '/' + file.length } : {}));
  s.end(file.subarray(a, b + 1));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const MOVIE = 'http://127.0.0.1:' + server.address().port + '/movie/u/p/9001.mkv';
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

    // A 2022 C2, and a stand-in <video>: it "plays", with a clock the test moves.
    await ev(() => {
      Caps._model('OLED65C2PUA');
      Store.settings.convertAudio = 'auto'; Store.settings.audioLang = ''; Store.saveSettings();
      window.__notices = []; Player.on('notice', function (m) { window.__notices.push(m); });
      var v = document.getElementById('video'), T = 0;
      window.__abs = false; window.__loads = [];
      v.addEventListener('error', function (e) { e.stopImmediatePropagation(); }, true);
      Object.defineProperty(v, 'readyState', { get: function () { return 4; }, configurable: true });
      Object.defineProperty(v, 'paused', { get: function () { return false; }, configurable: true });
      Object.defineProperty(v, 'ended', { get: function () { return false; }, configurable: true });
      Object.defineProperty(v, 'seeking', { get: function () { return false; }, configurable: true });
      Object.defineProperty(v, 'duration', { get: function () { return Infinity; }, configurable: true });
      Object.defineProperty(v, 'currentTime', { get: function () { return T; }, set: function (x) { T = +x; }, configurable: true });
      Object.defineProperty(v, 'buffered', { get: function () { return { length: 1, start: function () { return 0; }, end: function () { return T + 30; } }; }, configurable: true });
      v.play = function () { return Promise.resolve(); };
      v.pause = function () {};
      // A new src: the stream starts at 0, or (window.__abs) at the movie's own time.
      v.load = function () { var c = Player.converting; window.__loads.push(v.getAttribute('src') || ''); T = window.__abs && c ? c.from : 0; };
      window.__tick = setInterval(function () { T += 0.4; }, 400);
    });

    // 1. Play the movie: the plan converts, the player gets the /convert link.
    await ev((u) => Views.playVod({ id: 'soak-dts', title: 'DTS soak movie', sub: '', item: { ext: 'mkv' } }, u, 0, function () {}), MOVIE);
    await page.waitForFunction(() => Player.converting && /\/convert\//.test(document.getElementById('video').getAttribute('src') || ''), null, { timeout: 20000 }).catch(() => {});
    const src0 = await ev(() => document.getElementById('video').getAttribute('src') || '');
    ok('the player got the helper\'s /convert link', /^http:\/\/127\.0\.0\.1:47811\/convert\/[a-f0-9]{32}\/movie\.mkv\?/.test(src0), src0);
    ok('...for this movie, from 0 s, track 0, DTS 5.1', src0.indexOf('u=' + encodeURIComponent(MOVIE)) > 0 && /&t=0&a=0&c=dts&ch=6/.test(src0), src0);
    const conv0 = await ev(() => Player.converting);
    ok('Player says it is converting DTS', conv0 && conv0.codec === 'dts' && conv0.fmt === 'mkv', conv0);
    await page.waitForTimeout(1500);
    const notes = await ev(() => window.__notices.slice());
    ok('the viewer is told once: "Converting DTS audio for this TV"', notes.filter((n) => n === 'Converting DTS audio for this TV').length === 1, notes);
    ok('...and the toast shows it', /Converting DTS audio for this TV|^$/.test(await ev(() => document.getElementById('toast').textContent)));
    ok('the duration comes from the probe (20 s)', Math.abs((await ev(() => Player.duration)) - 20) < 0.5, await ev(() => Player.duration));
    const audio = await ev(() => Player.audioTracks());
    ok('the audio menu lists the movie\'s own track', audio.length === 1 && /DTS 5\.1 \(converted\)/.test(audio[0].label) && audio[0].on, audio);

    // The link really converts: AC-3 out of the dev helper.
    const out = path.join(tmp, 'got.mkv');
    const res = await fetch(src0);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    let codec = ''; try { codec = String(cp.execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', out])).trim(); } catch (e) { codec = 'ffprobe: ' + e.message; }
    ok('the link streams AC-3 5.1 from the helper', codec === 'ac3,6', codec);

    // 2. Seek to 10 s: a new conversion from there, and the time shown is 10 s plus the clock.
    await ev(() => Player.seekTo(10));
    await page.waitForFunction(() => /&t=10&/.test(document.getElementById('video').getAttribute('src') || ''), null, { timeout: 10000 }).catch(() => {});
    const src1 = await ev(() => document.getElementById('video').getAttribute('src') || '');
    ok('seek restarts the conversion at t=10', /&t=10&a=0/.test(src1), src1);
    await page.waitForTimeout(1300);
    const p1 = await ev(() => ({ pos: Player.position, raw: document.getElementById('video').currentTime, off: document.getElementById('video')._tbOffset, conv: Player.converting }));
    ok('position after the seek = 10 + the video\'s clock', Math.abs(p1.pos - (10 + p1.raw)) < 0.01 && p1.pos >= 10 && p1.pos < 13, p1);
    ok('subtitles get the same offset (video._tbOffset = 10)', p1.off === 10, p1);
    await ev(() => Views.refreshVodMeta());
    const shown = await ev(() => document.getElementById('osdNow').textContent);
    ok('the info panel shows 0:1x / 0:20', /^0:1[0-2] \/ 0:20/.test(shown), shown);
    const bar = await ev(() => parseFloat(document.getElementById('osdBar').style.width));
    ok('the progress bar is about half way', bar >= 50 && bar <= 62, bar);

    // 3. A TV player that shows the movie's own times: nothing is added.
    await ev(() => { window.__abs = true; Player.seekTo(12); });
    await page.waitForFunction(() => /&t=12&/.test(document.getElementById('video').getAttribute('src') || ''), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1300);
    const p2 = await ev(() => ({ pos: Player.position, raw: document.getElementById('video').currentTime, off: document.getElementById('video')._tbOffset, base: Player.converting && Player.converting.base }));
    ok('own times: noticed, position = the video\'s clock', p2.base === 0 && p2.off === 0 && Math.abs(p2.pos - p2.raw) < 0.01 && p2.pos >= 12 && p2.pos < 15, p2);
    await ev(() => { window.__abs = false; });

    // 4. Resume points use the movie's time.
    const saved = await ev(() => { var v = Views.vod; return { pos: Player.position, kind: v && v.meta && v.meta.id }; });
    ok('Player.position (what resume points save) is the movie\'s time', saved.pos >= 12, saved);

    // 5. Off: the same movie plays as it is, and says why there is no sound.
    await ev(() => { Player.stop(); window.__notices = []; Store.settings.convertAudio = 'off'; });
    await ev((u) => Views.playVod({ id: 'soak-dts-2', title: 'DTS soak movie', sub: '', item: { ext: 'mkv' }, media: { audio: ['dts'], channels: 6 } }, u, 0, function () {}), MOVIE);
    await page.waitForTimeout(1500);
    const src2 = await ev(() => ({ src: document.getElementById('video').getAttribute('src') || '', conv: Player.converting, notes: window.__notices.slice() }));
    ok('Off: the movie\'s own link, no conversion', !src2.conv && src2.src.indexOf('/convert/') < 0 && src2.src.indexOf('/movie/u/p/9001.mkv') >= 0, src2);
    ok('Off: says it is DTS and the TV can\'t play it', src2.notes.some((n) => /DTS sound, which this TV can't play/.test(n)), src2.notes);

    await ev(() => { Player.stop(); clearInterval(window.__tick); });

    // 6. Settings > Playback shows the switch and the converter.
    await ev(() => { if (UI.modalOpen) UI.close(); Views.switchTab('settings'); Settings.open(); Settings.section('playback'); });
    await page.waitForTimeout(1500);
    const rows = await ev(() => [].map.call(document.querySelectorAll('#setBody .opt'), function (d) { return d.textContent; }).join('\n'));
    ok('Settings > Playback: Convert audio the TV can\'t play, Automatic', /Convert audio the TV can't play[\s\S]*Automatic/.test(rows), rows.slice(0, 200));
    ok('Settings > Playback: the converter\'s status, size and where', /Audio converter[\s\S]*Ready, [\d.]+ MB, set by TIVIBRO_FFMPEG/.test(rows), (rows.match(/Audio converter[^\n]*\n?[^\n]*/) || [''])[0]);
    ok('no page errors', !errs.length, errs);
  } catch (e) { ok('no exception', false, e.stack); }
  await b.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
