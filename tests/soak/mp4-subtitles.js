/* MP4 (tx3g) subtitles in the real app, against a Range-capable file server that logs every read:
   the ffmpeg-made file from tests/lib/mp4, a 25-track file with its index at the end (like a big
   release), a pair for Line up, a file with no text tracks, and the mock provider in one-connection
   mode.  Headless Chromium can't decode the video, so the player's state is faked as in
   mkv-subtitles.js; the subtitle reads, menus and overlay are real.
   Start the mock provider and npm run serve, then: node tests/soak/mp4-subtitles.js */
'use strict';
const {chromium} = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), {spawn} = require('child_process');
const {buildMp4} = require('../lib/mp4-fixture');
const R = require('../../scripts/demo/record');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';

// 25 tracks like the big release the design was measured on: names are the release group's tag.
const LANGS = ['eng', 'spa', 'spa', 'por', 'por', 'ara', 'bul', 'dan', 'est', 'fin', 'hrv', 'hun', 'ind', 'ita', 'jpn', 'kor', 'nor', 'pol', 'rus', 'srp', 'swe', 'tha', 'tur', 'ukr', 'vie'];
const TAGS = { 1: 'BTM LA', 2: 'BTM ES', 3: 'BTM BR', 4: 'BTM PT' };
const many = buildMp4({ moovAtEnd: true, virtualBase: 3e6, videoPadding: 200000, tracks: LANGS.map((l, i) => ({
  lang: l, name: TAGS[i] || 'BTM', enabled: i === 0, cues: [[1, 3, l + ' one'], [5, 7, l + ' two'], [100, 102, l + ' late']] })) });
// Line up: Dutch is 2 s late against English.
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lines = []; for (let at = 2; lines.length < 24;) { at += 0.6 + rnd() * 4; const len = 0.8 + rnd() * 2.5; lines.push([at, at + len]); at += len; }
const pair = buildMp4({ tracks: [{ lang: 'eng', cues: lines.map(([s, e], i) => [s, e, 'en ' + i]) }, { lang: 'nld', enabled: false, cues: lines.map(([s, e], i) => [s + 2, e + 2, 'nl ' + i]) }] });
const files = {
  '/fast.mp4': { size: 0, read: null, buf: fs.readFileSync(path.join(__dirname, '../lib/mp4/faststart.mp4')) },
  '/many.mp4': many, '/pair.mp4': pair, '/none.mp4': buildMp4({ tracks: [] })
};
files['/fast.mp4'].size = files['/fast.mp4'].buf.length;
files['/fast.mp4'].read = (a, b) => files['/fast.mp4'].buf.subarray(a, b + 1);

let fails = 0, log = [];
const ok = (n, c, detail) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 500) : '')); if (!c) fails++; };
const server = http.createServer((q, s) => {
  const f = files[q.url];
  const r = /bytes=(\d+)-(\d+)/.exec(q.headers.range || '');
  log.push({ path: q.url, start: r ? +r[1] : 0, end: r ? +r[2] : -1 });
  if (!f) { s.writeHead(404); return s.end(); }
  const start = r ? +r[1] : 0, end = r ? Math.min(+r[2], f.size - 1) : f.size - 1;
  s.writeHead(r ? 206 : 200, Object.assign({ 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' }, r ? { 'Content-Range': `bytes ${start}-${end}/${f.size}` } : {}));
  s.end(Buffer.from(f.read(start, end)));
});
// A track's bytes in buildMp4 files: its samples sit together, track after track, up to the next one's.
function region(f, trackIndex) {
  const rel = f.sampleData[trackIndex + 1], next = f.sampleData[trackIndex + 2];
  return [f.dataStart + rel[0], next ? f.dataStart + next[0] - 1 : f.dataStart + rel[rel.length - 1] + 4096];
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  let oneMock = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(R.init({ time: R.primeTime() })[0]);
    await page.goto(APP);
    await page.waitForFunction(() => window.Library && Library.count() && Net.port, null, { timeout: 60000 });
    await page.evaluate(() => {
      Store.settings.autoSubs = false;
      Views.playVod({ id: 'mock-mp4subs', title: 'Mock movie', item: {} }, 'http://127.0.0.1:8077/mock.mp4', 0, function () {});
      Player.stop();
      var v = document.getElementById('video');
      Object.defineProperty(v, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(v, 'currentTime', { value: 2.5, writable: true, configurable: true });
      Object.defineProperty(v, 'buffered', { value: { length: 1, start: function () { return 0; }, end: function () { return 1e6; } }, configurable: true });
    });
    const open = (name, at) => page.evaluate(({ url, at }) => {
      UI.close();
      if (window.__mp4) window.__mp4.cancel();
      var v = document.getElementById('video'); v.currentTime = at;
      window.__mp4 = Mp4Subs.extract(Net.wrap(url), v);
    }, { url: base + name, at });
    const tracks = () => page.evaluate(() => Array.prototype.map.call(document.getElementById('video').textTracks, t => ({ label: t.label, mode: t.mode, cues: t.cues ? t.cues.length : 0 })));
    const overlay = () => page.evaluate(() => (document.querySelector('.mkv-captions') || {}).textContent);
    const tick = () => page.evaluate(() => document.getElementById('video').dispatchEvent(new Event('timeupdate')));
    // Move the menu focus to the row whose text matches, with the arrow keys, and press OK.
    async function pick(re) {
      const rows = page.locator('#modal .mi'), count = await rows.count();
      let index = -1;
      for (let i = 0; i < count; i++) if (re.test(await rows.nth(i).innerText())) { index = i; break; }
      if (index < 0) return false;
      const current = await page.evaluate(() => [].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x => x.classList.contains('focus')));
      for (let i = 0; i < Math.abs(index - current); i++) { await page.keyboard.press(index > current ? 'ArrowDown' : 'ArrowUp'); await page.waitForTimeout(60); }
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      return true;
    }

    // The ffmpeg file: English and Dutch; Dutch chosen with the remote shows "Hallo" at 2.5 s.
    await open('/fast.mp4', 2.5);
    await page.waitForFunction(() => document.getElementById('video').textTracks.length === 2, null, { timeout: 15000 });
    await page.evaluate(() => Views.runAction('subs', 'player'));
    const menu = await page.innerText('#modal');
    const picked = await pick(/^Dutch/);
    await page.waitForFunction(() => (document.querySelector('.mkv-captions') || {}).textContent === 'Hallo', null, { timeout: 10000 }).catch(() => {});
    ok('Dutch from the ffmpeg file appears in the menu and renders with the remote', /English/.test(menu) && /Dutch/.test(menu) && picked && await overlay() === 'Hallo',
      { menu, overlay: await overlay(), tracks: await tracks() });

    // 25 tracks, listed by language with the release tag.
    log = [];
    await open('/many.mp4', 2);
    await page.waitForFunction(() => document.getElementById('video').textTracks.length === 25, null, { timeout: 15000 });
    const discovery = log.length;
    await page.evaluate(() => Views.runAction('subs', 'player'));
    const big = await page.innerText('#modal'), labels = (await tracks()).map(t => t.label);   // the menu draws only the rows on screen
    const want = ['English · BTM', 'Spanish · BTM LA', 'Spanish · BTM ES', 'Portuguese · BTM BR', 'Arabic · BTM', 'Danish · BTM', 'Thai · BTM', 'Vietnamese · BTM'];
    ok('25 tracks listed with readable labels', want.every(w => labels.indexOf(w) >= 0) && /English · BTM/.test(big) && /Spanish · BTM LA/.test(big) &&
      labels.length === 25 && new Set(labels).size === 25 && discovery <= 12, { missing: want.filter(w => labels.indexOf(w) < 0), discovery });
    await pick(/^Danish · BTM/);
    await page.waitForFunction(() => (document.querySelector('.mkv-captions') || {}).textContent === 'dan one', null, { timeout: 10000 }).catch(() => {});
    const dan = region(many, LANGS.indexOf('dan')), reads = log.slice(discovery);
    ok('only the selected track\'s samples are requested', await overlay() === 'dan one' && reads.length > 0 && reads.every(r => r.start >= dan[0] && r.end <= dan[1]),
      { overlay: await overlay(), reads: reads.slice(0, 5), dan });

    // Three tracks switched on one after another in the same moment (as a menu does): only the last is read.
    const before = log.length;
    await page.evaluate(() => {
      var t = document.getElementById('video').textTracks, by = function (l) { return Array.prototype.filter.call(t, function (x) { return x.label === l; })[0]; };
      ['Finnish · BTM', 'Hungarian · BTM', 'Swedish · BTM'].forEach(function (l) { Array.prototype.forEach.call(t, function (x) { x.mode = x === by(l) ? 'showing' : 'disabled'; }); });
    });
    await page.waitForFunction(() => (document.querySelector('.mkv-captions') || {}).textContent === 'swe one', null, { timeout: 10000 }).catch(() => {});
    const swe = region(many, LANGS.indexOf('swe')), switched = log.slice(before);
    ok('rapid switching reads only the final track', await overlay() === 'swe one' && switched.length > 0 && switched.every(r => r.start >= swe[0] && r.end <= swe[1]),
      { overlay: await overlay(), switched: switched.slice(0, 5) });

    // A seek (reanchor): the same track stays on, its late line is read, the index isn't read again.
    const atSeek = log.length;
    await page.evaluate(url => { var v = document.getElementById('video'); window.__mp4.cancel(); v.currentTime = 101; window.__mp4 = Mp4Subs.extract(Net.wrap(url), v); }, base + '/many.mp4');
    await page.waitForFunction(() => (document.querySelector('.mkv-captions') || {}).textContent === 'swe late', null, { timeout: 10000 }).catch(() => {});
    const afterSeek = log.slice(atSeek), showing = (await tracks()).filter(t => t.mode === 'showing').map(t => t.label);
    ok('seek and reanchor keep the selection with no moov re-read', await overlay() === 'swe late' && showing.join() === 'Swedish · BTM' &&
      afterSeek.every(r => r.start >= swe[0] && r.end <= swe[1]), { overlay: await overlay(), showing, afterSeek: afterSeek.slice(0, 5) });

    // Timing: 2 s later, the line (100-102 s) leaves 101 s and shows at 102.5 s.
    await page.evaluate(() => { Subs._test.shift(2); document.getElementById('video').dispatchEvent(new Event('timeupdate')); });
    const shifted = await overlay();
    await page.evaluate(() => { document.getElementById('video').currentTime = 102.5; document.getElementById('video').dispatchEvent(new Event('timeupdate')); });
    const shiftedLater = await overlay();
    await page.evaluate(() => { Subs._test.shift(-2); document.getElementById('video').currentTime = 101; document.getElementById('video').dispatchEvent(new Event('timeupdate')); });
    ok('Timing shifts the MP4 overlay', shifted === '' && shiftedLater === 'swe late', { shifted, shiftedLater });

    // Exclusive: another language switched on is switched off again, across seeks.
    const exclusive = await page.evaluate(() => {
      var v = document.getElementById('video'), t = v.textTracks, chosen = Array.prototype.filter.call(t, function (x) { return x.mode === 'showing'; })[0], other = t[0], good = true;
      [101, 100.5, 101.5].forEach(function (time) { v.currentTime = time; other.mode = 'showing'; v.dispatchEvent(new Event('seeking')); v.dispatchEvent(new Event('seeked')); good = good && chosen.mode === 'showing' && other.mode === 'disabled'; });
      return good && document.querySelector('.mkv-captions').textContent === 'swe late';
    });
    ok('exclusive selection across seeks', exclusive);

    // Line up: Dutch (2 s late) against English, picked in the menu; English is read only then.
    log = [];
    await open('/pair.mp4', 30);
    await page.waitForFunction(() => document.getElementById('video').textTracks.length === 2, null, { timeout: 15000 });
    await page.waitForTimeout(200);
    // Chromium turns a new English track on by itself once subtitles were shown on this video (they were,
    // above); with subtitles left to the viewer, the reader switches it off again before reading it.
    const selfOn = await page.evaluate(() => Array.prototype.map.call(document.getElementById('video').textTracks, t => t.mode).join());
    ok("the browser's own pick of a new track is undone (nothing read or shown uninvited)", selfOn === 'disabled,disabled' && log.length === 1, { selfOn, reads: log.length });
    await page.evaluate(() => { var t = document.getElementById('video').textTracks; t[0].mode = 'disabled'; t[1].mode = 'showing'; });
    await page.waitForFunction(() => { var t = document.getElementById('video').textTracks[1]; return t.cues && t.cues.length >= 10; }, null, { timeout: 10000 });
    const enRegion = region(pair, 0), englishEarly = log.filter(r => r.start >= enRegion[0] && r.end <= enRegion[1]).length;
    await page.evaluate(() => Views.runAction('subs', 'player'));
    await pick(/^Line up with another track/);
    await pick(/^English/);
    await page.waitForFunction(() => /^Lined up|match well enough|too long/.test(document.getElementById('toast').textContent), null, { timeout: 25000 }).catch(() => {});
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    const tm = await page.evaluate(() => Subs.timing(document.getElementById('video').textTracks[1]));
    ok('Line up with an MP4 reference', englishEarly === 0 && /^Lined up: 2\.00 s earlier/.test(toast) && Math.abs(tm.off + 2) < 0.06, { englishEarly, toast, tm });
    await page.evaluate(() => Subs.reset());

    await open('/none.mp4', 0);
    await page.waitForFunction(() => document.getElementById('video')._mkvSubsState === '', null, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => Views.runAction('subs', 'player'));
    const none = await page.innerText('#modal');
    ok('file without text tracks says "No subtitles in this video"', /No subtitles in this video/.test(none), none);
    await page.evaluate(() => { UI.close(); window.__mp4.cancel(); window.__mp4 = null; });

    // One connection at a time: the video's request is open, the subtitle read gets 503, the video's carries on.
    oneMock = spawn(process.execPath, [path.join(__dirname, '../mock/mock_provider.js')], { env: Object.assign({}, process.env, { MOCK_PORT: '8099', MOCK_ONE_REQUEST: '1' }), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const held = await new Promise((resolve, reject) => {
      const q = http.get({ host: '127.0.0.1', port: 8099, path: '/movie/demo/demo/1.mp4', headers: { Range: 'bytes=0-' } }, res => {
        let got = 0; res.once('data', () => { res.pause(); resolve({ res, status: res.statusCode, total: +res.headers['content-length'], got: () => got }); });
        res.on('data', c => { got += c.length; });
      });
      q.on('error', reject);
    });
    await page.evaluate(() => {
      var v = document.getElementById('video'); v.currentTime = 1; window.__resolved = [];
      window.__mp4 = Mp4Subs.extract(Net.wrap('http://127.0.0.1:8099/movie/demo/demo/1.mp4'), v, function (u) { window.__resolved.push(u); });
    });
    await page.waitForFunction(() => /error|unavailable/.test(document.getElementById('video')._mkvSubsState), null, { timeout: 10000 }).catch(() => {});
    const one = await page.evaluate(() => ({ state: document.getElementById('video')._mkvSubsState, resolved: window.__resolved.length }));
    const done = await new Promise(resolve => { held.res.on('end', () => resolve(held.got())); held.res.resume(); setTimeout(() => resolve(held.got()), 10000); });
    ok('under MOCK_ONE_REQUEST playback keeps going when subtitle reads get 503', held.status === 206 && done === held.total && one.state === 'error' && one.resolved === 1,
      { status: held.status, done, total: held.total, one });
    await page.evaluate(() => { if (window.__mp4) window.__mp4.cancel(); });

    ok('no uncaught app errors', errors.length === 0, errors);
  } finally {
    if (oneMock) oneMock.kill();
    await browser.close(); await new Promise(r => server.close(r));
  }
  if (fails) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
