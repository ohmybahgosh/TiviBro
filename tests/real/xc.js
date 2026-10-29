/* Checks TiviBro against a real Xtream Codes provider, in headless Chromium through the dev relay.
     node tests/real/xc.js [--secs 20] [--channels 8] [--zaps 6] [--no-xmltv] [--format ts|m3u8]
   The login comes from a private file OUTSIDE the repository (TIVIBRO_PROVIDERS, default
   ../tivibro-private/providers.txt next to the repo): XC_SERVER, XC_USER, XC_PASS, MAX_CONNECTIONS.
   The report, log and screenshots go to a folder beside that file, never into the repo, and the
   username and password are masked in everything written.  Streams are played one at a time so the
   account's connection limit is respected. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const FORMAT = opt('format', ''), SECS = +opt('secs', 20), NCH = +opt('channels', 8), ZAPS = +opt('zaps', 6), XMLTV = argv.indexOf('--no-xmltv') < 0;
const FILE = process.env.TIVIBRO_PROVIDERS || path.join(ROOT, '../tivibro-private/providers.txt');

function readLogin() {
  const out = {};
  fs.readFileSync(FILE, 'utf8').split(/\r?\n/).forEach(l => {
    const m = /^\s*(XC_SERVER|XC_USER|XC_PASS)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !out[m[1]]) out[m[1]] = m[2];
  });
  if (!out.XC_SERVER || !out.XC_USER || !out.XC_PASS) throw new Error('XC_SERVER, XC_USER and XC_PASS are needed in ' + FILE);
  return { server: out.XC_SERVER, user: out.XC_USER, pass: out.XC_PASS };
}
const L = readLogin();
const enc = s => encodeURIComponent(s);
const mask = s => String(s).split(L.pass).join('<pass>').split(enc(L.pass)).join('<pass>').split(L.user).join('<user>').split(enc(L.user)).join('<user>');
const OUT = process.env.OUT || path.join(path.dirname(FILE), 'xc-run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(OUT, { recursive: true });
const report = { when: new Date().toISOString(), settings: { format: FORMAT || 'default', secs: SECS, channels: NCH, zaps: ZAPS } };
const say = s => console.log(mask(s));
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), mask(JSON.stringify(report, null, 1)));

function get(url) { return new Promise(r => { http.get(url, res => { res.resume(); r(res.statusCode); }).on('error', () => r(0)); }); }
async function services() {
  const kids = [];
  if (await get('http://127.0.0.1:47811/ping') !== 200) {
    kids.push(cp.spawn(process.execPath, [path.join(ROOT, 'tests/mock/relay_dev.js')], { stdio: 'ignore' }));
  }
  const port = 8093;
  kids.push(cp.spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' }));
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await get('http://127.0.0.1:' + port + '/index.html') === 200 && await get('http://127.0.0.1:47811/ping') === 200) break; }
  return { kids, app: 'http://127.0.0.1:' + port + '/index.html' };
}

(async () => {
  const svc = await services();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(mask(e.message)));
  const PL = { id: 'real', name: 'Real XC', type: 'xtream', server: L.server, user: L.user, pass: L.pass, providerEpg: 'short', epgDays: 2 };
  await page.addInitScript(([s]) => {
    if (!sessionStorage.getItem('realInit')) { localStorage.clear(); localStorage.setItem('tivibro.settings', s); sessionStorage.setItem('realInit', '1'); }
    localStorage.setItem('tivibro.devRelay', '47811');
  }, [JSON.stringify(Object.assign({ meter: 'off', playlists: [PL], active: 'real' }, FORMAT ? { format: FORMAT } : {}))]);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') }).catch(() => {});
  const ev = (f, a) => page.evaluate(f, a);

  try {
    // 1. Login and channel list
    let t0 = Date.now();
    await page.goto(svc.app);
    await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 240000 });
    const boot = await ev(() => {
      const ch = Library.data.channels, gs = Library.groups();
      return { channels: ch.length, groups: gs.length, firstGroups: gs.slice(0, 20).map(g => g.name + ' (' + g.count + ')'),
        catchup: ch.filter(c => c.arch).length, noLogo: ch.filter(c => !c.logo).length, noEpgId: ch.filter(c => !c.epg).length,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
    });
    boot.secs = (Date.now() - t0) / 1000;
    report.boot = boot; say('channel list: ' + boot.channels + ' channels, ' + boot.groups + ' groups in ' + boot.secs + 's, catch-up on ' + boot.catchup + ', heap ' + boot.heapMB + ' MB');
    report.account = await ev(p => U.getJSON(Source.api(p, ''), 20000).then(j => {
      const u = j.user_info || {}, s = j.server_info || {};
      return { status: u.status, expires: u.exp_date ? new Date(u.exp_date * 1000).toISOString().slice(0, 10) : 'never', cons: u.active_cons + '/' + u.max_connections,
        formats: u.allowed_output_formats, trial: u.is_trial, tz: s.timezone, protocol: s.server_protocol };
    }, e => ({ error: e.message })), Object.assign({}, PL));
    say('account: ' + JSON.stringify(report.account));
    await page.waitForTimeout(3000);
    await shot('01-live');

    // 2. Movies and Shows tabs (the app decides from the provider's categories)
    await page.waitForTimeout(20000);
    report.tabs = await ev(() => Array.from(document.querySelectorAll('.tab')).map(t => t.getAttribute('data-tab')));
    report.vodCounts = await ev(p => Promise.all(['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'].map(a =>
      U.getJSON(Source.api(p, a), 90000).then(j => Array.isArray(j) ? j.length : typeof j, e => 'error ' + e.message))), Object.assign({}, PL));
    say('tabs: ' + report.tabs.join(', ') + '   vod cats/streams, series cats/series: ' + report.vodCounts.join(' / '));
    for (const t of ['movies', 'shows']) {
      if (report.tabs.indexOf(t) < 0) continue;
      await ev(t => Views.switchTab(t), t); await page.waitForTimeout(12000);
      report['tab_' + t] = await ev(() => (document.getElementById('vodTitle') || {}).textContent + ' | ' + (document.querySelector('#pageVod') || document.body).innerText.slice(0, 300));
      await shot('02-' + t);
    }
    await ev(() => Views.switchTab('live')); await page.waitForTimeout(1000);

    // 3. Guide from the provider (short EPG, per channel)
    t0 = Date.now();
    await ev(() => Views.switchTab('guide'));
    await page.waitForTimeout(15000);
    report.shortGuide = await ev(() => ({ status: Epg.status, loading: Epg.loading }));
    say('short guide: the provider is asked per channel as rows come into view, see 03-guide-short.png');
    await shot('03-guide-short');

    // 4. Full XMLTV from the provider: time, memory and coverage
    if (XMLTV) {
      t0 = Date.now();
      await ev(() => { const p = Store.playlist; p.providerEpg = 'xmltv'; Store.upsertPlaylist(p); return Epg.refresh(Library, true); }).catch(e => errors.push('xmltv refresh: ' + e.message));
      await page.waitForFunction(() => !Epg.loading, null, { timeout: 600000 }).catch(() => {});
      const secs = (Date.now() - t0) / 1000;
      report.xmltv = await ev(() => {
        const ch = Library.data.channels; let has = 0, nowc = 0;
        ch.forEach(c => { if (Epg.hasData(c)) { has++; const n = Epg.nowNext(c); if (n && n.now) nowc++; } });
        return { channelsWithData: has, withNow: nowc, of: ch.length, status: Epg.status, guideChannels: (Epg.guideChannels() || []).length,
          heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
      });
      report.xmltv.secs = secs;
      say('full XMLTV: ' + secs + 's, ' + report.xmltv.channelsWithData + ' of ' + report.xmltv.of + ' channels have data, ' + report.xmltv.withNow + ' with a programme now, heap ' + report.xmltv.heapMB + ' MB');
      await ev(() => Views.switchTab('guide')); await page.waitForTimeout(3000);
      await shot('04-guide-xmltv');
    }
    await ev(() => Views.switchTab('live')); await page.waitForTimeout(1000);

    // 5. Playback: a spread of well-known channels, one at a time
    const pick = await ev(n => {
      const ch = Library.data.channels, out = [], seen = new Set();
      const want = [/ESPN\b/i, /\bCNN\b/i, /FOX NEWS/i, /\bNBC\b/i, /\bCBS\b/i, /\bABC\b/i, /HBO\b/i, /DISCOVERY/i, /NICK/i, /TSN|SKY SPORTS/i, /BBC ONE/i, /\b4K\b|UHD/i];
      want.forEach(re => { const c = ch.find(c => re.test(c.n) && !seen.has(c.k)); if (c && out.length < n) { seen.add(c.k); out.push(c.k); } });
      for (let i = 0; out.length < n && i < 50; i++) { const c = ch[Math.floor((i + 1) * ch.length / 51)]; if (!seen.has(c.k)) { seen.add(c.k); out.push(c.k); } }
      return out;
    }, NCH);
    report.play = [];
    const watch = async (k, secs) => {
      await ev(k => { const c = Library.find(k); Views.startChannel(c, false, function () { Views.goFull(); }); }, k);
      const s0 = Date.now(); let first = null, moving = 0, counted = 0, last = null, maxFreeze = 0, freeze = 0, info = {};
      while (Date.now() - s0 < secs * 1000) {
        await page.waitForTimeout(250);
        const s = await ev(() => {
          const v = Array.from(document.querySelectorAll('video')).sort((a, b) => b.videoWidth - a.videoWidth)[0];
          const st = Player.stats || {};
          return { pos: Player.position, w: v ? v.videoWidth : 0, h: v ? v.videoHeight : 0, engine: st.engine || '', state: st.state || '', info: st.info || '' };
        }).catch(() => null);
        if (!s) continue;
        const t = (Date.now() - s0) / 1000;
        if (last) {
          const moved = s.pos - last.pos > 0.05 || s.pos < last.pos - 1;
          if (moved && first === null) first = t;
          if (first !== null) { counted += t - last.t; if (moved) { moving += t - last.t; freeze = 0; } else { freeze += t - last.t; maxFreeze = Math.max(maxFreeze, freeze); } }
        }
        s.t = t; last = s; if (s.w) info = s;
      }
      const r = { name: await ev(k => Library.name(Library.find(k)), k), first: first === null ? null : +first.toFixed(1), moving: counted ? +(100 * moving / counted).toFixed(0) : 0,
        maxFreeze: +maxFreeze.toFixed(1), size: info.w ? info.w + 'x' + info.h : '', engine: info.engine || (last && last.engine) || '', state: last ? last.state : '' };
      await ev(() => Views.stopAll()).catch(() => {});
      return r;
    };
    for (let i = 0; i < pick.length; i++) {
      const r = await watch(pick[i], SECS);
      report.play.push(r);
      say('play ' + r.name + ': first picture ' + (r.first == null ? 'never' : r.first + 's') + ', moving ' + r.moving + '%, longest freeze ' + r.maxFreeze + 's, ' + r.size + ' ' + r.engine + ' ' + r.state);
      if (i === 0) await shot('05-playing');
      await page.waitForTimeout(2000);
    }

    // 6. Zapping: neighbours in one group, short visits
    const zapKeys = await ev(n => { const g = Library.groups().find(g => g.count > n + 2 && !g.custom); return g ? Library.channels(g.id).slice(0, n).map(c => c.k) : []; }, ZAPS);
    report.zap = [];
    for (const k of zapKeys) { const r = await watch(k, 8); report.zap.push({ name: r.name, first: r.first }); }
    const firsts = report.zap.map(z => z.first).filter(x => x != null);
    say('zap: ' + report.zap.map(z => z.name + ' ' + (z.first == null ? 'never' : z.first + 's')).join(', ') + (firsts.length ? '   median ' + firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)] + 's' : ''));

    // 7. Search
    report.search = await ev(() => { const q = 'ESPN'; return Library.data.channels.filter(c => Library.name(c).toUpperCase().indexOf(q) >= 0).length; });
  } catch (e) {
    errors.push('harness: ' + mask(e.stack || e.message));
    await shot('99-failure');
  }
  report.log = await ev(() => Log.lines(false)).catch(() => []);
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'app-log.txt'), mask((report.log || []).join('\n')));
  delete report.log;
  save();
  say('page errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  say('report: ' + OUT);
  await browser.close();
  svc.kids.forEach(k => { try { k.kill(); } catch (e) {} });
  process.exit(0);
})();
