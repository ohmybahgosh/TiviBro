/* Dropbox in My media, in the real app with the real helper code, a pretend Dropbox on localhost
   (TIVIBRO_DROPBOX_API) and the reference phone client:
     node tests/mock/mock_provider.js &
     MOCK_PORT=8088 MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/media-dropbox.js
   The phone's folder picker and Add (sealed asks), the source in Settings, playing a movie from its
   temporary link, a sign-in Dropbox stopped taking, removing (signs out), and the refresh token kept
   out of the log, the helper's log, the problem report, a backup, the web editor and the phone. */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dropbox-soak-'));
const proxy = require('../../service/proxy.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const PORT = 47898;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

const REFRESH = 'rt-SOAK-refresh-token-0123456789abcdef';
const dbx = { refresh: REFRESH, n: 0, valid: {}, links: 0, revoked: 0 };
const tree = [
  ['folder', '/Media'], ['folder', '/Media/Moana 2 (2024)'], ['file', '/Media/Moana 2 (2024)/Moana.2.2024.1080p.mp4', 4e9],
  ['folder', '/Media/Show Name'], ['folder', '/Media/Show Name/Season 01'],
  ['file', '/Media/Show Name/Season 01/Show.Name.S01E01.mkv', 9e8], ['file', '/Media/Show Name/Season 01/Show.Name.S01E02.mkv', 9e8],
  ['folder', '/Media/Frozen (2013)'], ['file', '/Media/Frozen (2013)/FROZEN.mkv', 5e9], ['folder', '/Music']
].map(([tag, p, size]) => ({ '.tag': tag, name: p.split('/').pop(), path_display: p, path_lower: p.toLowerCase(), size, rev: 'r' + p.length, server_modified: '2026-10-01T10:00:00Z' }));
const api = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/oauth2/token') {
      const q = new URLSearchParams(body);
      if (q.get('refresh_token') !== dbx.refresh) return send(400, { error: 'invalid_grant' });
      const t = 'sl.SOAK' + (++dbx.n); dbx.valid[t] = true; return send(200, { access_token: t, expires_in: 14400 });
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !dbx.valid[auth[1]]) return send(401, { error_summary: 'expired_access_token/' });
    const j = body && body !== 'null' ? JSON.parse(body) : {};
    const route = req.url.replace(/^\/2\//, '');
    if (route === 'files/list_folder') {
      const low = String(j.path || '').toLowerCase();
      const list = tree.filter((e) => (!low || e.path_lower.indexOf(low + '/') === 0) && (j.recursive || e.path_lower.slice(low.length + 1).indexOf('/') < 0));
      return send(200, { entries: list, cursor: 'c', has_more: false });
    }
    // A link the browser can play: the mock provider's movie, signed like Dropbox's.
    if (route === 'files/get_temporary_link') { dbx.links++; return send(200, { link: MOCK + '/movie/demo/demo/Moana.2.2024.mp4?sig=SECRETLINK' + dbx.links }); }
    if (route === 'users/get_current_account') return send(200, { name: { display_name: 'Soak Viewer' }, email: 'soak@example.com' });
    if (route === 'auth/token/revoke') { dbx.revoked++; delete dbx.valid[auth[1]]; return send(200, null); }
    send(404, { error_summary: 'unknown' });
  });
});

(async () => {
  await new Promise((f) => api.listen(0, '127.0.0.1', f));
  process.env.TIVIBRO_DROPBOX_API = 'http://127.0.0.1:' + api.address().port;
  let relay = null;
  const companion = require('../../service/companion.js').create({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dropbox-soak-phone-')), log: (o) => proxy.log(o), version: 'dev',
    launch: (p, cb) => cb(null), sysinfo: (cb) => cb({ model: 'DEV', webos: 'dev', name: '' }), app: () => ({ open: true, visible: true }), editor: () => (relay ? relay.editor : null)
  });
  relay = proxy.create({ companion });
  await new Promise((f) => relay.server.listen(PORT, '127.0.0.1', f));
  const ctl = (u, body) => fetch('http://127.0.0.1:' + PORT + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await ctl('/companion/set', { on: true });
  const s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Dropbox soak' });
  const mm = (op, a) => C.ask(cred, 'mymedia', Object.assign({ op }, a || {}), { seal: true }).then((r) => r.data, (e) => ({ err: e.message }));
  const replies = [];
  const mmKeep = (op, a) => mm(op, a).then((r) => { replies.push(r); return r; });

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.addInitScript((p) => localStorage.setItem('tivibro.devRelay', String(p)), PORT);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const ev = (f, a) => page.evaluate(f, a);

  // On the TV: Add media says where Dropbox is added.
  await ev(() => { Views.switchTab('settings'); Settings.section('media'); }); await page.waitForTimeout(300);
  await ev(() => Media.addMenu()); await page.waitForTimeout(300);
  const addText = await page.innerText('#modal');
  ok('Add media on the TV offers Dropbox, through the phone app', /Dropbox/.test(addText) && /Sign in with the TiviBro phone app: Settings > My media > Add media > Dropbox\./.test(addText), addText);
  await page.keyboard.press('Escape');

  // The phone's folder picker.
  let r = await mmKeep('dbfolders', { refresh: REFRESH, path: '' });
  ok('the folder picker starts at the top, with the account', r.folders && r.folders.map((f) => f.name).join() === 'Media,Music' && r.account === 'Soak Viewer (soak@example.com)', JSON.stringify(r));
  r = await mmKeep('dbfolders', { refresh: REFRESH, path: '/Media' });
  ok('and goes into a folder', r.folders && r.folders.map((f) => f.path).join() === '/Media/Frozen (2013),/Media/Moana 2 (2024),/Media/Show Name', JSON.stringify(r));
  r = await mm('dbfolders', { refresh: 'rt-nope-not-this-one', path: '' });
  ok('a sign-in Dropbox refuses, in plain words', r.err === 'Dropbox didn\'t accept that sign-in.  Sign in again.', JSON.stringify(r));

  // Adding the folder.
  r = await mmKeep('adddropbox', { refresh: REFRESH, root: '/Media', name: 'Media' });
  ok('adding it says what it found', r.msg === 'Added: 2 movies and 2 episodes.', JSON.stringify(r));
  const row = (r.sources || []).filter((x) => x.type === 'dropbox')[0];
  ok('the phone\'s list says Dropbox, with its folder and account', row && row.root === '/Media' && row.name === 'Media' && /Soak Viewer/.test(row.account), JSON.stringify(r.sources));
  const sid = row && row.id;
  ok('the TV keeps the token with the source', await ev((t) => MediaStore.sources().some((x) => x.type === 'dropbox' && x.refresh === t), REFRESH));
  await ev(() => { Views.switchTab('settings'); Settings.section('media'); }); await page.waitForTimeout(400);
  ok('Settings > My media shows it as Dropbox', /Dropbox · rescan, content, details or remove/.test(await page.innerText('#setBody')), await page.innerText('#setBody'));
  for (let n = 0; n < 20 && !(await ev(() => MediaStore.movies(null).length)); n++) await page.waitForTimeout(300);
  ok('its movies are in My media', await ev(() => MediaStore.movies(null).map((m) => m.title).sort().join() === 'Frozen,Moana 2'));
  r = await mmKeep('sources');
  ok('sources lists it as dropbox', r.sources && r.sources.length === 1 && r.sources[0].type === 'dropbox', JSON.stringify(r));

  // Playing from a temporary link.
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(500);
  await ev(() => { var original = Player.play; Player.play = function (ch, opts) { window.__mediaPlay = opts; return original.apply(this, arguments); }; });
  await ev(() => Media.playFile(MediaStore.movies(null).filter((m) => m.title === 'Moana 2')[0]));
  await page.waitForFunction(() => window.__mediaPlay, null, { timeout: 10000 }).catch(() => {});
  ok('the movie plays from the temporary link', await ev(() => !!(window.__mediaPlay && /SECRETLINK1/.test(window.__mediaPlay.url) && window.__mediaPlay.live === false)), await ev(() => JSON.stringify(window.__mediaPlay && window.__mediaPlay.url)));
  ok('Dropbox was asked once for it', dbx.links === 1);
  for (let n = 0; n < 3 && await ev(() => document.body.classList.contains('full')); n++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  await ev(() => Views.stopAll());

  // The token in nothing that leaves the TV or is written down for people.
  const appLog = await ev(() => Log.lines ? JSON.stringify(Log.lines()) : JSON.stringify(localStorage.getItem('tivibro.log')));
  const helperLog = await (await fetch('http://127.0.0.1:' + PORT + '/log')).text();
  const report = await ev(() => Diag.report()).then((x) => JSON.stringify(x), (e) => 'report failed: ' + e.message);
  const backup = await C.ask(cred, 'backup', {}, { seal: true }).then((x) => JSON.stringify(x.data), (e) => 'backup failed: ' + e.message);
  const editorList = await ev(() => WebEdit.runData('mediaList', {}).then((x) => JSON.stringify(x)));
  ok('the app\'s log has no refresh token and no signed link', appLog.indexOf(REFRESH) < 0 && appLog.indexOf('SECRETLINK') < 0);
  ok('nor the helper\'s', helperLog.indexOf(REFRESH) < 0 && helperLog.indexOf('SECRETLINK') < 0 && !/sl\.SOAK\d/.test(helperLog), helperLog.slice(0, 200));
  ok('nor the problem report', !/^report failed/.test(report) && report.indexOf(REFRESH) < 0, report.slice(0, 200));
  ok('nor a backup', !/^backup failed/.test(backup) && backup.indexOf(REFRESH) < 0, backup.slice(0, 200));
  ok('nor the web editor\'s list, which says Dropbox', editorList.indexOf(REFRESH) < 0 && /"type":"dropbox"/.test(editorList) && /"root":"\/Media"/.test(editorList), editorList);
  ok('nor any reply to the phone', JSON.stringify(replies).indexOf(REFRESH) < 0);

  // A sign-in Dropbox stopped taking: said plainly, the list stays.
  dbx.refresh = 'rt-changed'; dbx.valid = {};
  r = await mm('rescan', { id: sid });
  ok('a rescan with a refused sign-in says what to do', /Dropbox didn't accept the sign-in\.  Remove this source and add it again from the phone app\./.test(r.err || ''), JSON.stringify(r));
  ok('and keeps the movies', await ev(() => MediaStore.movies(null).length === 2));
  dbx.refresh = REFRESH;

  // Removing it signs out of Dropbox.
  r = await mm('remove', { id: sid });
  for (let n = 0; n < 20 && !dbx.revoked; n++) await new Promise((f) => setTimeout(f, 200));
  ok('removing it from the phone', /removed/.test(r.msg || '') && r.sources.length === 0, JSON.stringify(r));
  ok('signs out of Dropbox', dbx.revoked === 1, dbx.revoked);
  ok('and the token is gone from the TV', await ev((t) => (localStorage.getItem('tivibro.media') || '').indexOf(t) < 0, REFRESH));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await b.close(); relay.server.close(); api.close();
  try { companion.stop && companion.stop(); } catch (e) {}
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
