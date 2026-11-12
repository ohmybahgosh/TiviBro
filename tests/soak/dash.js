/* DASH channels (discussion #79): an .mpd plays in dash.js, loaded only when one is asked for, through the
   helper; a ClearKey channel from #KODIPROP gives the browser the keys in the playlist; when it can't play it
   says the channel is protected instead of reconnecting and blaming the provider.  The test streams are made here
   with ffmpeg (skipped without it).
     npm run serve &
     node tests/soak/dash.js */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const FF = process.env.TIVIBRO_FFMPEG || (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const KID = '0123456789abcdef0123456789abcdef', KEY = 'fedcba9876543210fedcba9876543210';

function make(dir, enc) {
  fs.mkdirSync(dir, { recursive: true });
  const a = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '40',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-f', 'dash', '-seg_duration', '2', '-use_template', '1', '-use_timeline', '0', '-adaptation_sets', 'id=0,streams=v id=1,streams=a'];
  if (enc) a.push('-format_options', 'encryption_scheme=cenc-aes-ctr:encryption_key=' + KEY + ':encryption_kid=' + KID);
  cp.execFileSync(FF, a.concat([path.join(dir, 'stream.mpd')]));
  if (enc) {   // ffmpeg doesn't write the ContentProtection a player looks for
    const kid = KID.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const f = path.join(dir, 'stream.mpd'), m = fs.readFileSync(f, 'utf8').replace(/(<AdaptationSet id="0"[^>]*>)/, '$1\n<ContentProtection xmlns:cenc="urn:mpeg:cenc:2013" schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="' + kid + '"/>\n<ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e" value="ClearKey1.0"/>');
    fs.writeFileSync(f, m);
  }
}

(async () => {
  try { cp.execFileSync(FF, ['-version']); } catch (e) { console.log('SKIP no ffmpeg'); process.exit(0); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dash-'));
  make(path.join(tmp, 'clear'), false); make(path.join(tmp, 'ck'), true);
  let seenUA = '';
  const srv = http.createServer((req, res) => {
    const f = path.join(tmp, decodeURIComponent(req.url.split('?')[0]).replace(/\.\./g, ''));
    if (/\.mpd$/.test(f)) seenUA = req.headers['user-agent'] || '';
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': /\.mpd$/.test(f) ? 'application/dash+xml' : 'video/mp4' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const BASE = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const scripts = []; page.on('request', (r) => { if (/vendor\/dash/.test(r.url())) scripts.push(r.url()); });
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  try {
    await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await ev(() => { window.__perr = ''; Player.on('state', (st, m) => { if (st === 'error') window.__perr = m || ''; }); });
    ok('dash.js is not loaded until a DASH channel plays', !scripts.length && !(await ev(() => !!window.dashjs)));

    // A clear DASH channel, with its own User-Agent (an M3U line's "|User-Agent=").
    await ev((u) => Player.play({ k: 'dash1', n: 'DASH Clear', url: u, dash: 1, ua: 'DashAgent/1' }), BASE + '/clear/stream.mpd');
    await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }).catch(() => {});
    const a = await ev(() => ({ playing: Player.playing, engine: Player.engine, w: document.getElementById('video').videoWidth, t: document.getElementById('video').currentTime }));
    ok('a DASH channel plays in the DASH player', a.playing && a.engine === 'DASH player' && a.w === 640, JSON.stringify(a));
    ok('dash.js was loaded for it, once', scripts.length === 1, scripts.join(' '));
    ok('through the helper, with the channel\'s User-Agent', seenUA === 'DashAgent/1', seenUA);

    /* ClearKey: the keys written in the playlist (#KODIPROP license_key "kid:key") reach the browser's EME.
       (ffmpeg's encrypted DASH leaves out the per-segment encryption info, so this stream can't decode in any
       player: the check is that the licence is set up, and that the message says protected, not busy.) */
    let keyAsked = null;
    await ev(() => {
      const orig = navigator.requestMediaKeySystemAccess.bind(navigator);
      window.__ks = [];
      navigator.requestMediaKeySystemAccess = (ks, cfg) => { window.__ks.push(ks); return orig(ks, cfg); };
      const upd = MediaKeySession.prototype.update;
      window.__lic = null;
      MediaKeySession.prototype.update = function (r) { try { window.__lic = JSON.parse(new TextDecoder().decode(r)); } catch (e) { window.__lic = 'unreadable'; } return upd.call(this, r); };
    });
    await ev((u) => Player.play({ k: 'dash2', n: 'DASH ClearKey', url: u, dash: 1, drm: { type: 'clearkey', key: '0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210' } }), BASE + '/ck/stream.mpd');
    await page.waitForFunction(() => window.__lic, null, { timeout: 30000 }).catch(() => {});
    const c = await ev(() => ({ ks: window.__ks, lic: window.__lic, mk: !!document.getElementById('video').mediaKeys }));
    keyAsked = c.lic && c.lic.keys && c.lic.keys[0];
    ok('a ClearKey channel: the browser is asked for ClearKey', c.ks.indexOf('org.w3.clearkey') >= 0 && c.mk, JSON.stringify(c));
    ok('and given the playlist\'s key (kid and key in base64url)', keyAsked && keyAsked.kid === 'ASNFZ4mrze8BI0VniavN7w' && keyAsked.k === '_ty6mHZUMhD-3LqYdlQyEA', JSON.stringify(c.lic));

    // Widevine: a licence server from license_key, its User-Agent through the helper, its Content-Type to the browser.
    const wv = await ev(() => Player._dashProtection({ type: 'widevine', key: 'https://lic.example/wv?id=2|User-Agent=LicUA&Content-Type=application%2Foctet-stream&X-Custom-Data=t%3D1|R{SSM}|R' }, { pl: null }));
    const s = wv && wv['com.widevine.alpha'];
    ok('Widevine: the licence server goes through the helper with its User-Agent and own headers, and its Content-Type is sent', s && /^http:\/\/127\.0\.0\.1:\d+\/ua\/[A-Za-z0-9_-]+\/hd\/[A-Za-z0-9_-]+\/x\/https\/lic\.example\/wv\?id=2$/.test(s.serverURL) && JSON.parse(Buffer.from(/\/hd\/([A-Za-z0-9_-]+)/.exec(s.serverURL)[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).H['X-Custom-Data'] === 't=1' && !s.httpRequestHeaders['X-Custom-Data'] && s.httpRequestHeaders && s.httpRequestHeaders['Content-Type'] === 'application/octet-stream' && !s.httpRequestHeaders['User-Agent'], JSON.stringify(wv));
    // A protected channel that doesn't play: it says it's protected (not "Provider busy").
    const logsBefore = await ev(() => Log.lines().length);
    await ev(() => { window.__perr = ''; });
    await ev((u) => Player.play({ k: 'dash3', n: 'DASH Wrong key', url: u, dash: 1, drm: { type: 'clearkey', key: '0123456789abcdef0123456789abcdef:00000000000000000000000000000000' } }), BASE + '/ck/stream.mpd');
    await page.waitForFunction(() => window.__perr, null, { timeout: 90000 }).catch(() => {});
    const w = await ev((n) => ({ state: Player.state, err: window.__perr, t: document.getElementById('video').currentTime, logs: Log.lines().slice(n).map((l) => l.msg || l).filter((l) => /busy|protected|DASH|licen/i.test(l)).slice(-4) }), logsBefore);
    ok('a protected channel that can\'t play: no "Provider busy", and says it\'s protected', !w.logs.some((l) => /busy/i.test(l)) && /protected \(ClearKey\)/.test(w.err), JSON.stringify(w));
    // A licence the playlist doesn't give at all.
    await ev(() => { window.__perr = ''; });
    await ev((u) => Player.play({ k: 'dash4', n: 'DASH No licence', url: u, dash: 1, drm: { type: 'clearkey', key: 'not-a-key' } }), BASE + '/ck/stream.mpd');
    await page.waitForTimeout(4000);
    const n = await ev(() => ({ state: Player.state, err: window.__perr }));
    ok('a licence it can\'t read: says the channel is protected', /protected \(ClearKey\)/.test(JSON.stringify(n)), JSON.stringify(n));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'all DASH checks passed');
  process.exit(fails ? 1 : 0);
})();
