/* Event, team and app channels on a real Xtream Codes provider: empty event slots and old events,
   team channels' "Next game" guide entries, placeholder or shared guide ids, and Pluto TV channels
   filled from Pluto's own guide.  Headless Chromium through the dev relay, the provider's full XMLTV.
     node tests/real/guide-kinds.js
   The login comes from the private file outside the repository (as tests/real/xc.js); the report goes
   beside that file, with the username and password masked. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '../..');
const FILE = process.env.TIVIBRO_PROVIDERS || path.join(ROOT, '../tivibro-private/providers.txt');
const L = {};
fs.readFileSync(FILE, 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*(XC_SERVER|XC_USER|XC_PASS)\s*=\s*(.*?)\s*$/.exec(l); if (m && !L[m[1]]) L[m[1]] = m[2]; });
const mask = s => String(s).split(L.XC_PASS).join('<pass>').split(encodeURIComponent(L.XC_PASS)).join('<pass>').split(L.XC_USER).join('<user>').split(encodeURIComponent(L.XC_USER)).join('<user>');
const OUT = process.env.OUT || path.join(path.dirname(FILE), 'kinds-run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(OUT, { recursive: true });
const say = s => console.log(mask(s));
function get(url) { return new Promise(r => { http.get(url, res => { res.resume(); r(res.statusCode); }).on('error', () => r(0)); }); }

(async () => {
  const kids = [];
  if (await get('http://127.0.0.1:47811/ping') !== 200) kids.push(cp.spawn(process.execPath, [path.join(ROOT, 'tests/mock/relay_dev.js')], { stdio: 'ignore' }));
  kids.push(cp.spawn('python3', ['-m', 'http.server', '8094', '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' }));
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await get('http://127.0.0.1:8094/index.html') === 200 && await get('http://127.0.0.1:47811/ping') === 200) break; }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(mask(e.message)));
  const PL = { id: 'real', name: 'Real XC', type: 'xtream', server: L.XC_SERVER, user: L.XC_USER, pass: L.XC_PASS, providerEpg: 'xmltv', epgDays: 1 };
  await page.addInitScript(([s]) => {
    if (!sessionStorage.getItem('realInit')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('realInit', '1'); }
    localStorage.setItem('tivibro.devRelay', '47811');
  }, [JSON.stringify({ meter: 'off', playlists: [PL], active: 'real' })]);
  const ev = (f, a) => page.evaluate(f, a);
  const report = {};
  try {
    await page.goto('http://127.0.0.1:8094/index.html');
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 240000 });
    say('channels: ' + await ev(() => Library.count()));
    // The guide: the provider's XMLTV, then the public guides (Pluto by id).
    await page.waitForFunction(() => Epg.status && Epg.status.at && !Epg.loading, null, { timeout: 600000 }).catch(() => say('guide still loading'));
    report.counts = await ev(() => {
      const ch = Library.data.channels, now = Date.now();
      const empty = ch.filter(c => Names.empty(c.n)).length, idle = ch.filter(c => Names.idle(c.n)).length, ended = ch.filter(c => Events.ended(c, now)).length;
      const pluto = ch.filter(c => /^Pluto/i.test(c.n));
      const plutoNow = pluto.filter(c => { const n = Epg.nowNext(c); return n && n.now; }).length;
      const plutoPub = pluto.filter(c => Epg.pubSource(c)).length;
      return { channels: ch.length, emptySlots: empty, nothingOn: idle, endedEvents: ended, noGuideId: ch.filter(c => !c.epg).length,
        pluto: pluto.length, plutoOnNow: plutoNow, plutoFromPublicGuide: plutoPub, pub: Epg.pubStatus };
    });
    say(JSON.stringify(report.counts, null, 1));
    // Team channels: what the guide shows now and next.
    report.teams = await ev(() => Library.data.channels.filter(c => /^(NHL|NFL|NBA|MLB) \| /.test(c.n)).slice(0, 8).map(c => {
      const l = Epg.request(c) || [], now = Date.now(), at = l.findIndex(p => p.e > now);
      return c.n + ' -> ' + l.slice(Math.max(0, at), at + 3).map(p => new Date(p.s).toISOString().slice(5, 16) + ' ' + p.t).join(' / ');
    }));
    report.teams.forEach(say);
    // Hide channels with nothing on: what it would take out.
    report.hide = await ev(() => { const n = Store.playlist.names || (Store.playlist.names = Names.defaults()), before = Library.channels(Library.ALL).length; n.hideIdle = true; Library.dirty(); const after = Library.channels(Library.ALL).length; n.hideIdle = false; Library.dirty(); return { before, after }; });
    say('Hide channels with nothing on: ' + report.hide.before + ' -> ' + report.hide.after);
    await ev(() => Views.switchTab('guide')); await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, 'guide.png') });
  } catch (e) { say('FAILED ' + e.message); report.failed = mask(e.message); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'report.json'), mask(JSON.stringify(report, null, 1)));
  say('page errors: ' + errors.length + '   report: ' + OUT);
  await browser.close(); kids.forEach(k => k.kill());
  process.exit(0);
})();
