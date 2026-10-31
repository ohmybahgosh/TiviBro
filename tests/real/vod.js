/* Checks TiviBro's Movies, Shows and Search against a real Xtream Codes provider with VOD, in headless
   Chromium through the dev relay, driven with the remote's keys.
     node tests/real/vod.js [--login N] [--secs 15]
   --login picks the Nth XC_SERVER/XC_USER/XC_PASS block in the private providers file (TIVIBRO_PROVIDERS,
   default ../tivibro-private/providers.txt); default 1.  Everything written goes beside that file with
   the username and password masked.  One stream plays at a time (many VOD logins allow one connection).
   Headless Chromium can't decode HEVC or AC-3, so some titles fail here that a TV plays. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const NTH = +opt('login', 1), SECS = +opt('secs', 15);
const FILE = process.env.TIVIBRO_PROVIDERS || path.join(ROOT, '../tivibro-private/providers.txt');

function readLogin() {
  const all = []; let cur = null;
  fs.readFileSync(FILE, 'utf8').split(/\r?\n/).forEach(l => {
    const m = /^\s*(XC_SERVER|XC_USER|XC_PASS)\s*=\s*(.*?)\s*$/.exec(l);
    if (!m) return;
    if (m[1] === 'XC_SERVER') all.push(cur = {});
    if (cur) cur[m[1]] = m[2];
  });
  const o = all[NTH - 1];
  if (!o || !o.XC_SERVER || !o.XC_USER || !o.XC_PASS) throw new Error('No complete login number ' + NTH + ' in ' + FILE);
  return { server: o.XC_SERVER, user: o.XC_USER, pass: o.XC_PASS };
}
const L = readLogin();
const enc = s => encodeURIComponent(s);
const mask = s => String(s).split(L.pass).join('<pass>').split(enc(L.pass)).join('<pass>').split(L.user).join('<user>').split(enc(L.user)).join('<user>');
const OUT = process.env.OUT || path.join(path.dirname(FILE), 'vod-run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(OUT, { recursive: true });
const report = { when: new Date().toISOString(), login: NTH };
const say = s => console.log(mask(s));
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), mask(JSON.stringify(report, null, 1)));

function get(url) { return new Promise(r => { http.get(url, res => { res.resume(); r(res.statusCode); }).on('error', () => r(0)); }); }
async function services() {
  const kids = [];
  if (await get('http://127.0.0.1:47811/ping') !== 200) kids.push(cp.spawn(process.execPath, [path.join(ROOT, 'tests/mock/relay_dev.js')], { stdio: 'ignore' }));
  const port = 8094;
  kids.push(cp.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' }));
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await get('http://127.0.0.1:' + port + '/index.html') === 200 && await get('http://127.0.0.1:47811/ping') === 200) break; }
  return { kids, app: 'http://127.0.0.1:' + port + '/index.html' };
}

(async () => {
  const svc = await services();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(mask(e.message)));
  const PL = { id: 'real', name: 'Real XC', type: 'xtream', server: L.server, user: L.user, pass: L.pass, providerEpg: 'short', epgDays: 2 };
  await page.addInitScript(([s]) => {
    if (!sessionStorage.getItem('realInit')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('realInit', '1'); }
    localStorage.setItem('tivibro.devRelay', '47811');
  }, [JSON.stringify({ meter: 'off', playlists: [PL], active: 'real' })]);
  let n = 0;
  const shot = name => page.screenshot({ path: path.join(OUT, String(++n).padStart(2, '0') + '-' + name + '.png') }).catch(() => {});
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, times, wait) => { for (let i = 0; i < (times || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(wait || 250); } };
  const heap = () => ev(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const vodText = () => ev(() => ({ title: (document.getElementById('vodTitle') || {}).textContent, text: (document.getElementById('viewVod') || document.body).innerText.replace(/\s+\n/g, '\n').slice(0, 600) }));
  // Plays what OK started; reports how long until the picture moves, then stops with Back.
  async function playCheck(label) {
    const t0 = Date.now();
    const r = await ev(secs => new Promise(res => {
      const end = Date.now() + secs * 1000;
      (function poll() {
        const v = document.querySelector('video');
        if (v && v.currentTime > 0.5 && !v.paused) return res({ ok: true, t: v.currentTime, w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration || 0) });
        if (Date.now() > end) return res({ ok: false, err: v && v.error ? 'media error ' + v.error.code : 'no picture', state: v ? v.readyState : -1 });
        setTimeout(poll, 200);
      })();
    }), SECS);
    r.secs = (Date.now() - t0) / 1000;
    await page.waitForTimeout(2500);
    await shot(label + '-playing');
    r.osd = await ev(() => (document.getElementById('osd') || document.body).innerText.slice(0, 200));
    await key('Escape', 1, 1500);   // Back stops and returns to the list
    r.back = await ev(() => !document.getElementById('viewVod').classList.contains('hidden'));
    say(label + ': ' + JSON.stringify(r));
    return r;
  }

  try {
    let t0 = Date.now();
    await page.goto(svc.app);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 240000 });
    report.live = { channels: await ev(() => Library.count()), secs: (Date.now() - t0) / 1000, heapMB: await heap() };
    say('live: ' + JSON.stringify(report.live));
    t0 = Date.now();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tab')).some(t => t.getAttribute('data-tab') === 'movies'), null, { timeout: 120000 }).catch(() => {});
    report.tabs = { list: await ev(() => Array.from(document.querySelectorAll('.tab')).map(t => t.getAttribute('data-tab'))), secs: (Date.now() - t0) / 1000 };
    say('tabs: ' + JSON.stringify(report.tabs));

    // Movies: load time, memory, first screen, browse a category, info panel, play.
    t0 = Date.now();
    await ev(() => Views.switchTab('movies'));
    await page.waitForFunction(() => { const e = document.getElementById('viewVod'); return e && !/Loading…/.test(e.innerText) && document.querySelectorAll('#vodItems > *').length > 3; }, null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(3000);
    report.movies = { secs: (Date.now() - t0) / 1000, heapMB: await heap(), first: await vodText() };
    await shot('movies');
    await key('ArrowDown', 6, 120); await page.waitForTimeout(2500); await shot('movies-info');
    report.movies.info = await vodText();
    await key('ArrowLeft'); await key('ArrowDown', 4, 150); await key('ArrowRight', 1, 2500); await shot('movies-other-category');
    report.movies.otherCat = await vodText();
    await key('Enter', 1, 500);
    report.movies.play = await playCheck('movie');
    await page.waitForTimeout(1000); await shot('movies-after-back');
    say('movies: ' + report.movies.secs + 's, heap ' + report.movies.heapMB + ' MB');
    save();

    // Shows: load, open a show, seasons and episodes, play an episode.
    t0 = Date.now();
    await ev(() => Views.switchTab('shows'));
    await page.waitForFunction(() => { const e = document.getElementById('viewVod'); return e && /Shows/.test((document.getElementById('vodTitle') || {}).textContent) && !/Loading…/.test(e.innerText); }, null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(3000);
    report.shows = { secs: (Date.now() - t0) / 1000, heapMB: await heap(), first: await vodText() };
    await shot('shows');
    await key('ArrowDown', 3, 150); await key('Enter', 1, 4000); await shot('show-episodes');
    report.shows.episodes = await vodText();
    await key('ArrowDown', 1, 1500); await key('Enter', 1, 500);
    report.shows.play = await playCheck('episode');
    await key('Escape', 1, 1500); await shot('shows-after-back');
    save();

    // Search across live, movies and shows.
    for (const q of ['batman', 'office']) {
      t0 = Date.now();
      await ev(q => Search.query(q), q); await page.waitForTimeout(3000);
      report['search_' + q] = { secs: (Date.now() - t0) / 1000, text: await ev(() => (document.getElementById('viewSearch') || document.body).innerText.slice(0, 500)) };
      await shot('search-' + q);
    }
    report.heapEndMB = await heap();
  } catch (e) { report.fatal = mask(e.stack || e.message); say('FATAL ' + e.message); await shot('fatal'); }
  report.errors = errors;
  report.log = await ev(() => Log.lines(false)).catch(() => []);
  fs.writeFileSync(path.join(OUT, 'app-log.txt'), mask((report.log || []).join('\n'))); delete report.log;
  save();
  say('page errors: ' + errors.length + '   report: ' + OUT);
  await browser.close(); svc.kids.forEach(k => k.kill());
})();
