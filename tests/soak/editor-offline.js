/* The web editor on the phone without the TV (discussion #23): the phone app serves the editor from its
   own copy with android/app/src/main/assets/offline.js standing in for the TV.  This runs that page in a
   browser with a stand-in for the app's TiviBroOffline bridge, and the editor copy taken from a real
   TiviBro (the app on :8078 with the dev relay, mock provider on :8077).
     node tests/soak/editor-offline.js [--shots dir]
   Checks: the phone app gets the channel list gzipped in pieces (190,000 channels too), it opens with the kept channel list and the backup's edits, hiding a group and renaming a
   channel then Save hands the bridge the edits the TV would get, drafts work, TV-only pages are gone,
   and the words say backup, not TV. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const ED = path.join(__dirname, '../../service/editor');
const OFF = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/assets/offline.js'), 'utf8');
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const errs = [];
  // 1. A real editor copy, the way the phone keeps it: the editor's D after it loads with the TV.
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await tv.waitForTimeout(2000);
  await tv.evaluate(() => WebEdit.start()); await tv.waitForTimeout(1500);
  const st = await tv.evaluate(() => WebEdit.status), pw = await tv.evaluate(() => WebEdit.password());
  const on = await (await b.newContext()).newPage();
  await on.goto('http://127.0.0.1:' + st.port + '/#k=' + pw + '/home'); await on.waitForFunction(() => window.D && D.channels && D.channels.length, null, { timeout: 30000 });
  const copy = await on.evaluate(() => JSON.stringify(D));
  const D0 = JSON.parse(copy);
  ok('the editor copy has the channel list and no logins', D0.channels.length > 30 && D0.playlist && D0.playlist.id && !/secret|password/i.test(JSON.stringify(D0.playlists || [])));

  // 1b. How the phone app takes it (EditorScreen.kt KEEP): gzipped, in pieces, so a huge list gets through.
  const kt = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/app/tivibro/phone/ui/EditorScreen.kt'), 'utf8');
  const KEEP = /private const val KEEP = """([\s\S]*?)"""/.exec(kt)[1];
  await on.evaluate(() => { window.__got = { meta: null, parts: [], ends: 0, failed: [] }; window.TiviBroApp = { keepStart: (m) => { __got.meta = JSON.parse(m); __got.parts = []; return true; }, keepPart: (c) => { __got.parts.push(c); return true; }, keepEnd: () => { __got.ends++; return true; }, keepFailed: (w) => { __got.failed.push(w); } }; });
  await on.evaluate(KEEP);
  await on.waitForFunction(() => __got.ends >= 1 || __got.failed.length, null, { timeout: 20000 }).catch(() => {});
  const zlib = require('zlib');
  const got = async () => { const g = await on.evaluate(() => ({ meta: __got.meta, parts: __got.parts, failed: __got.failed })); return { g, text: g.meta && g.meta.gz ? zlib.gunzipSync(Buffer.concat(g.parts.map((p) => Buffer.from(p, 'base64')))).toString('utf8') : g.parts.join('') }; };
  let k = await got();
  ok('the phone gets the channel list gzipped, and it comes out whole', k.g.meta && k.g.meta.gz && k.g.meta.pid === D0.playlist.id && k.g.meta.channels === D0.channels.length && JSON.parse(k.text).channels.length === D0.channels.length, JSON.stringify(k.g.meta) + ' ' + k.g.failed.join());
  // A list the size of the one in issue #25.
  await on.evaluate(() => { const base = D.channels, out = []; for (let i = 0; out.length < 190000; i++) { const c = Object.assign({}, base[i % base.length]); c.k = 'big' + i; c.n = base[i % base.length].n + ' ' + i; out.push(c); } D.channels = out; D.chanRev = 'big'; });
  await on.waitForFunction(() => __got.ends >= 2 || __got.failed.length, null, { timeout: 120000 }).catch(() => {});
  k = await got();
  ok('190,000 channels get through, in pieces of at most 512 KB', k.g.meta && k.g.meta.channels === 190000 && k.g.parts.length > 1 && k.g.parts.every((p) => p.length <= 524288) && JSON.parse(k.text).channels.length === 190000,
    JSON.stringify(k.g.meta) + ' parts ' + k.g.parts.length + ' ' + k.g.failed.join());
  await on.close();

  // 2. The phone's offline page.
  const backupEdits = { hiddenGroups: {}, hiddenChannels: {}, renames: { [D0.channels[0].k]: 'From the backup' }, custom: [], groupOrder: [] };
  const saved = [];
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, isMobile: true });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.exposeFunction('__save', (s) => { saved.push(JSON.parse(s)); });
  await page.addInitScript(({ edits }) => {
    window.TiviBroOffline = { extras: () => JSON.stringify({ edits, names: null }), save: (s) => { window.__save(s); return true; }, id: () => 'tv1' };
  }, { edits: backupEdits });
  await ctx.route('https://tivibro.offline/**', async (r) => {
    const p = new URL(r.request().url()).pathname, f = p === '/' ? 'index.html' : p.slice(1);
    if (f === '__copy.json') return r.fulfill({ status: 200, body: copy, contentType: 'application/json' });     // the app serves the kept list as a file
    if (!fs.existsSync(path.join(ED, f))) return r.fulfill({ status: 404, body: '' });
    let body = fs.readFileSync(path.join(ED, f));
    if (f === 'index.html') body = String(body).replace(/<script/, '<script>' + OFF.replace(/<\/script/g, '<\\/script') + '</script><script');
    r.fulfill({ status: 200, body, contentType: /\.js$/.test(f) ? 'text/javascript' : /\.png$/.test(f) ? 'image/png' : /\.svg$/.test(f) ? 'image/svg+xml' : 'text/html' });
  });
  await page.goto('https://tivibro.offline/#t=' + 'a'.repeat(48) + '/home');
  await page.waitForFunction(() => window.D && D.channels && document.getElementById('app') && !document.getElementById('app').classList.contains('hidden'), null, { timeout: 20000 }).catch(() => {});
  ok('it opens with the kept channel list', await page.evaluate(() => window.D && D.channels.length) === D0.channels.length);
  ok('and the backup\'s edits', await page.evaluate((k) => E.renames[k], D0.channels[0].k) === 'From the backup');
  const text = await page.evaluate(() => document.body.innerText);
  ok('it says this is a backup on the phone', /Editing a backup on this phone, without the TV/.test(text), text.slice(0, 200));
  ok('pages that need the TV are left out', await page.evaluate(() => ['playlists', 'backup', 'media', 'report'].every((p) => { const a = document.querySelector('[data-page="' + p + '"]'); return !a || a.offsetParent === null; })));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-offline-editor.png') });

  // 3. Edit and save.
  const g = D0.groups[1], k2 = D0.channels[2].k;
  await page.evaluate(({ g, k2 }) => { mut('test', function () { E.hiddenGroups[g] = 1; E.renames[k2] = 'Renamed offline'; }); }, { g: g.id, k2 });
  await page.waitForTimeout(400);
  const bar = await page.evaluate(() => document.getElementById('cbText').textContent + ' | ' + document.getElementById('cbSend').textContent);
  ok('the change bar says saved, not sent to a TV', /not saved yet/.test(bar) && !/TV/.test(bar), bar);
  await page.evaluate(() => send()); await page.waitForTimeout(1500);
  const last = saved[saved.length - 1];
  ok('Save hands the app the edits the TV would get', last && last.edits.hiddenGroups[g.id] === 1 && last.edits.renames[k2] === 'Renamed offline' && last.edits.renames[D0.channels[0].k] === 'From the backup' && last.names, JSON.stringify(last || {}).slice(0, 200));
  ok('and then says everything is saved', /Everything is saved|Saved|in the backup/.test(await page.evaluate(() => document.body.innerText)));
  // 4. Drafts and commands.
  const dl = await page.evaluate(() => command('listDrafts', {}, 5000).then(r => r.data.list.length, e => 'err ' + e.message));
  ok('draft history works on the phone', typeof dl === 'number' && dl >= 1, dl);
  const tvOnly = await page.evaluate(() => command('refreshPlaylist', {}, 5000).then(() => 'ran', e => e.message));
  ok('what needs the TV says so', /needs the TV/.test(tvOnly), tvOnly);
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all offline editor checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
