/* Windows and network shares (SMB) in My media, in the real app with the real helper code, a stand-in SMB
   program reading a local folder (tests/fixtures/fake-smb.js) and the reference phone client:
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/media-smb.js
   Add media on the TV offers it and its share and folder pickers list what's there; the phone's shares,
   folders and Add (sealed asks); the source in Settings and the web editor; a movie playing from a
   localhost link; a wrong password in plain words; and the password kept out of the app's and helper's
   logs, the problem report, a backup, the web editor's list and every reply to the phone. */
'use strict';
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smb-soak-'));
const FAKE = path.join(__dirname, '../fixtures/fake-smb.js');
fs.chmodSync(FAKE, 0o755);
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'smb-soak-share-'));
process.env.TIVIBRO_SMB = FAKE;
process.env.FAKE_SMB_ROOT = ROOT;
const proxy = require('../../service/proxy.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const PORT = 47899;
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// The stand-in share's login is tv / pw (fake-smb.js); the soak uses that password and looks for it everywhere.
const PASS = 'pw';
function put(rel, size) { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.truncateSync(f, size); }
put('Media/Movies/Heat (1995)/Heat.1995.1080p.mkv', 4e9);
put('Media/Movies/Moana 2 (2024)/Moana.2.2024.1080p.mp4', 3e9);
put('Media/TV/Show Name/Season 01/Show.Name.S01E01.mkv', 9e8);
put('Media/TV/Show Name/Season 01/Show.Name.S01E02.mkv', 9e8);
put('Photos/a.jpg', 10);

(async () => {
  let relay = null;
  const companion = require('../../service/companion.js').create({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'smb-soak-phone-')), log: (o) => proxy.log(o), version: 'dev',
    launch: (p, cb) => cb(null), sysinfo: (cb) => cb({ model: 'DEV', webos: 'dev', name: '' }), app: () => ({ open: true, visible: true }), editor: () => (relay ? relay.editor : null)
  });
  relay = proxy.create({ companion });
  await new Promise((f) => relay.server.listen(PORT, '127.0.0.1', f));
  const ctl = (u, body) => fetch('http://127.0.0.1:' + PORT + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await ctl('/companion/set', { on: true });
  const s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'SMB soak' });
  const replies = [];
  const mm = (op, a) => C.ask(cred, 'mymedia', Object.assign({ op }, a || {}), { seal: true }).then((r) => { replies.push(r.data); return r.data; }, (e) => ({ err: e.message }));

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

  // On the TV: Add media offers shares, and the pickers list the server's shares, then a share's folders.
  await ev(() => { Views.switchTab('settings'); Settings.section('media'); }); await page.waitForTimeout(300);
  await ev(() => Media.addMenu()); await page.waitForTimeout(300);
  ok('Add media on the TV offers a Windows or network share', /Add a Windows or network share \(SMB\)/.test(await page.innerText('#modal')));
  await page.keyboard.press('Escape');
  ok('a typed server, address or whole path is understood', await ev(() => {
    const a = Media.smbAddress('\\\\NAS\\Movies\\Films'), b = Media.smbAddress('smb://192.168.1.20:4450/Media'), c = Media.smbAddress('NAS');
    return a.server === 'NAS' && a.share === 'Movies' && a.folder === '/Films' && b.server === '192.168.1.20:4450' && b.share === 'Media' && c.server === 'NAS' && !c.share && !Media.smbAddress('bad host');
  }));
  let r = await ev((p) => Media.smbShares({ server: 'nas', user: 'tv', pass: p }), PASS);
  ok('the TV lists the server\'s shares', r.shares && r.shares.map((x) => x.name).sort().join() === 'Media,Photos', JSON.stringify(r));
  r = await ev((p) => Media.smbFolders({ server: 'nas', share: 'Media', user: 'tv', pass: p }, '/'), PASS);
  ok('and a share\'s folders', r.folders && r.folders.map((x) => x.path).join() === '/Movies,/TV', JSON.stringify(r));
  r = await ev(() => Media.smbShares({ server: 'nas', user: 'tv', pass: 'wrong' }));
  ok('a wrong password, in plain words', r.error === 'login' && /didn't accept that user name and password/.test(r.message), JSON.stringify(r));

  // Looking on the network answers with a list (empty here: no SMB servers on the test machine's network).
  r = await mm('smbdiscover');
  ok('the phone can ask the TV to look for shares on its network', Array.isArray(r.servers), JSON.stringify(r));
  // The phone: shares, folders, add.
  r = await mm('smbshares', { server: 'nas', user: 'tv', pass: PASS });
  ok('the phone lists the shares', r.shares && r.shares.length === 2, JSON.stringify(r));
  r = await mm('smbfolders', { server: 'nas', share: 'Media', path: '/Movies', user: 'tv', pass: PASS });
  ok('and a folder\'s folders', r.folders && r.folders.map((x) => x.name).sort().join() === 'Heat (1995),Moana 2 (2024)', JSON.stringify(r));
  r = await mm('smbshares', { server: '-oops', user: 'tv', pass: PASS });
  ok('a server that isn\'t one is refused before anything runs', /server's name or IP address/.test(r.err || ''), JSON.stringify(r));
  r = await mm('addsmb', { server: 'nas', share: 'Media', folder: '/', user: 'tv', pass: PASS, name: 'NAS movies' });
  ok('adding the share says what it found', r.msg === 'Added: 2 movies and 2 episodes.', JSON.stringify(r));
  const row = (r.sources || []).filter((x) => x.type === 'smb')[0];
  ok('the phone\'s list says where it is and who signs in', row && row.name === 'NAS movies' && row.root === '\\\\nas\\Media' && row.account === 'tv', JSON.stringify(r.sources));
  const sid = row && row.id;
  ok('the TV keeps the login with the source', await ev((p) => MediaStore.sources().some((x) => x.type === 'smb' && x.share === 'Media' && x.pass === p), PASS));
  await ev(() => { Views.switchTab('settings'); Settings.section('media'); }); await page.waitForTimeout(400);
  ok('Settings > My media shows it as a Windows share', /Windows share · \\\\nas\\Media/.test(await page.innerText('#setBody')), await page.innerText('#setBody'));
  for (let n = 0; n < 20 && !(await ev(() => MediaStore.movies(null).length)); n++) await page.waitForTimeout(300);
  ok('its movies are in My media', await ev(() => MediaStore.movies(null).map((m) => m.title).sort().join() === 'Heat,Moana 2'), await ev(() => MediaStore.movies(null).map((m) => m.title).join()));

  // Playing from a localhost link.
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(500);
  await ev(() => { var original = Player.play; Player.play = function (ch, opts) { window.__mediaPlay = opts; return original.apply(this, arguments); }; });
  await ev(() => Media.playFile(MediaStore.movies(null).filter((m) => m.title === 'Heat')[0]));
  await page.waitForFunction(() => window.__mediaPlay, null, { timeout: 10000 }).catch(() => {});
  ok('the movie plays from a temporary localhost link', await ev(() => !!(window.__mediaPlay && /^http:\/\/127\.0\.0\.1:\d+\/media-stream\/[a-f0-9]{48}\/movie\.mkv$/.test(window.__mediaPlay.url) && window.__mediaPlay.live === false)), await ev(() => JSON.stringify(window.__mediaPlay && window.__mediaPlay.url)));
  for (let n = 0; n < 3 && await ev(() => document.body.classList.contains('full')); n++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  await ev(() => Views.stopAll());

  // The web editor: its list says Windows share; its share picker works.
  const editorList = await ev(() => WebEdit.runData('mediaList', {}).then((x) => JSON.stringify(x)));
  ok('the web editor\'s list says smb, with where it is', /"type":"smb"/.test(editorList) && /\\\\\\\\nas\\\\Media/.test(editorList), editorList);
  const edShares = await ev((p) => WebEdit.runData('mediaSmbShares', { server: 'nas', user: 'tv', pass: p }).then((x) => JSON.stringify(x), (e) => 'failed: ' + e.message), PASS);
  ok('the web editor lists the shares', /"Media"/.test(edShares), edShares);

  // The password in nothing that leaves the TV or is written down for people.
  const has = (text) => new RegExp('"(pass|password)"\\s*:\\s*"' + PASS + '"').test(text) || text.indexOf('\n' + PASS + '\n') >= 0;
  const appLog = await ev(() => Log.lines ? JSON.stringify(Log.lines()) : JSON.stringify(localStorage.getItem('tivibro.log')));
  const helperLog = await (await fetch('http://127.0.0.1:' + PORT + '/log')).text();
  const report = await ev(() => Diag.report()).then((x) => JSON.stringify(x), (e) => 'report failed: ' + e.message);
  const backup = await C.ask(cred, 'backup', {}, { seal: true }).then((x) => JSON.stringify(x.data), (e) => 'backup failed: ' + e.message);
  ok('the app\'s log has no password', !has(appLog));
  ok('nor the helper\'s', !has(helperLog) && /smb shares/.test(helperLog), helperLog.slice(-300));
  ok('nor the problem report', !/^report failed/.test(report) && !has(report), report.slice(0, 200));
  ok('nor a backup', !/^backup failed/.test(backup) && !has(backup) && backup.indexOf('"type":"smb"') < 0, backup.slice(0, 200));
  ok('nor the web editor\'s list', !has(editorList));
  ok('nor any reply to the phone', !has(JSON.stringify(replies)));

  // A password that stopped working: said plainly, the list stays.
  await ev((id) => { const x = MediaStore.source(id); x.pass = 'changed'; }, sid);
  r = await mm('rescan', { id: sid });
  ok('a rescan with a refused login says so', /didn't accept that user name and password/.test(r.err || r.message || ''), JSON.stringify(r));
  ok('and keeps the movies', await ev(() => MediaStore.movies(null).length === 2));

  r = await mm('remove', { id: sid });
  ok('removing it from the phone', /removed/.test(r.msg || '') && r.sources.length === 0, JSON.stringify(r));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  await b.close(); relay.server.close();
  try { companion.stop && companion.stop(); } catch (e) {}
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
