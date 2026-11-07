/* Settings, all of it: the 15 sections in their order, on the TV and on the phone (ask "settings"),
   every page and the pages inside them, no row that still names an old page, the phone's own and
   TV-only rows marked, and a button's question going to the phone instead of the TV's screen.
     node tests/mock/mock_provider.js &  (on :8077)
     npm run serve &                      (app on :8078, dev helper on :47811)
     node tests/soak/settings-audit.js [--shots dir]   (a picture of every TV settings page) */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = 'http://127.0.0.1:47811';
const i0 = process.argv.indexOf('--shots'), SHOTS = i0 > 0 ? process.argv[i0 + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

const WANT = [['language', 'Language'], ['playlists', 'Playlists'], ['guide', 'Guide'], ['channels', 'Channels and groups'], ['names', 'Channel and group names'], ['reminders', 'Reminders and watchlist'],
  ['playback', 'Playback'], ['media', 'My media'], ['keys', 'API keys'], ['remote', 'Remote and buttons'], ['look', 'Appearance and start screen'], ['parental', 'Parental controls'],
  ['backups', 'Backups and restore points'], ['connect', 'Phone app and web editor'], ['about', 'Updates, about and diagnostics']];
// Page names that are gone: nothing may still send people there.
const OLD = [/Groups, sorting, hidden/, /Guide, start screen, reminders/, /Playlists and guide/, /Channel name editor/, /Settings > Channel names\b/, /Settings > Diagnostics/,
  /Changes and restore points/, /Playback and buffering/, /Settings > Remote control/, /Updates and about/, /movies only for now/, /> Network (set )?to Automatic/];

(async () => {
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: true });
  s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Audit' });
  const sa = (o) => C.ask(cred, 'settings', o, { seal: true }).then((r) => r.data);

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await ev(() => { TIVIBRO_VERSION = '0.6.0-alpha.99'; if (UI.modalOpen) UI.close(); Views.switchTab('settings'); Settings.open(); });
  await page.waitForTimeout(600);

  // 1. The sections, in order, on the TV and the phone.
  const nav = await ev(() => [].map.call(document.querySelectorAll('#setNav > div'), (d) => d.innerText.trim()));
  ok('the TV shows the 15 sections in order', nav.join('|') === WANT.map((w) => w[1]).join('|'), nav.join(' | '));
  const secs = await sa({ op: 'sections' });
  ok('the phone gets the same 15, with their ids', JSON.stringify(secs.sections.map((x) => [x.id, x.title])) === JSON.stringify(WANT), JSON.stringify(secs.sections));
  ok('old section ids still lead somewhere', await ev(() => ['groups', 'updates', 'diag', 'phone', 'editor'].every((id) => Settings.section(id))));

  // 2. Every page and the pages inside them, on the phone (the same code builds them for the TV).
  let pages = 0; const bad = [], stale = [], all = [];
  async function walk(sec, pathTo, trail) {
    const pg = await sa({ op: 'page', sec, path: pathTo }).catch((x) => { bad.push(trail + ': ' + x.message); return null; });
    if (!pg) return;
    pages++;
    for (const r of pg.rows) {
      all.push(Object.assign({ where: trail }, r));
      const txt = r.label + ' ' + r.sub + ' ' + (r.value || '');
      OLD.forEach((re) => { if (re.test(txt)) stale.push(trail + ' > ' + r.label + ': ' + re); });
      if (/  —|—/.test(txt)) stale.push(trail + ' > ' + r.label + ': an em dash');
      if (r.kind === 'page' && pathTo.length < 2) await walk(sec, pathTo.concat([r.i]), trail + ' > ' + r.label);
    }
  }
  for (const w of WANT) await walk(w[0], [], w[1]);
  ok('every page and the pages inside them open (' + pages + ')', !bad.length && pages > 25, bad.join(' | '));
  ok('no row names a page that is gone, and no em dashes', !stale.length, stale.join(' | '));
  const tagged = (name) => all.filter((r) => r.phone === name).map((r) => r.where + ' > ' + r.label);
  ok('the phone does My media, the token, the log, backups and reports itself', tagged('media-add').length && tagged('tmdb-token').length && tagged('log').length && tagged('backups').length && all.some((r) => r.phone === 'editor' && r.epage === 'report'),
    JSON.stringify(all.filter((r) => r.phone).map((r) => r.phone + ':' + r.label)));
  const tvOnly = all.filter((r) => r.tv).map((r) => r.label);
  ok('buttons that only work on the TV\'s screen say so', ['Learn a button', 'Button tester', 'Pair the TiviBro app…'].every((l) => tvOnly.indexOf(l) >= 0), tvOnly.join(', '));
  const guideTop = (await sa({ op: 'page', sec: 'guide', path: [] })).rows.slice(0, 7).map((r) => r.label).join(' ');
  ok('Guide starts by saying how the guide is built, Pluto included', /provider/.test(guideTop) && /i\.mjh\.nz/.test(guideTop) && /No guide for this channel/.test(guideTop), guideTop.slice(0, 300));
  const names = (await sa({ op: 'page', sec: 'names', path: [] })).rows.map((r) => r.label).join(' | ');
  ok('Channel and group names has group prefixes and suffixes', /Group prefixes/.test(names) && /Group suffixes/.test(names) && /Add a group prefix/.test(names), names.slice(0, 400));

  // 3. Reminders: the queued ones, each with Cancel.
  await ev(() => { const c = Library.data.channels[0]; Store.edits.reminders.push({ k: c.k, s: Date.now() + 3600e3, e: Date.now() + 7200e3, t: 'Audit Show' }); Store.saveEdits(); });
  let rp = await sa({ op: 'page', sec: 'reminders', path: [] });
  const rr = rp.rows.find((r) => r.label === 'Audit Show');
  ok('Reminders and watchlist lists a queued reminder', rr && rr.value === 'Cancel', JSON.stringify(rp.rows.map((r) => r.label)));

  // 4. A button's question comes to the phone, not the TV's screen.
  let r = await sa({ op: 'action', sec: 'reminders', path: [], i: rr.i });
  ok('Cancel asks on the phone first (confirm)', r.dialog && r.dialog.kind === 'confirm' && /Audit Show/.test(r.dialog.title) && !(await ev(() => UI.modalOpen)), JSON.stringify(r).slice(0, 300));
  r = await sa({ op: 'answer', sec: 'reminders', path: [], dialog: r.dialog.id });
  ok('answering it cancels the reminder, and the toast comes back as the message', !r.dialog && /cancelled/i.test(r.msg) && !(await ev(() => Store.edits.reminders.some((x) => x.t === 'Audit Show'))), JSON.stringify(r).slice(0, 300));
  const np = (await sa({ op: 'page', sec: 'names', path: [] })).rows.find((x) => x.label === 'Paste a comma separated list…' && /US:/.test(x.sub));
  r = await sa({ op: 'action', sec: 'names', path: [], i: np.i });
  ok('a box the TV would show comes to the phone as a prompt', r.dialog && r.dialog.kind === 'prompt' && !(await ev(() => UI.modalOpen)), JSON.stringify(r).slice(0, 300));
  const before = await ev(() => (Store.playlist.names && Store.playlist.names.prefixes || []).slice());
  r = await sa({ op: 'answer', sec: 'names', path: [], dialog: r.dialog.id, value: 'AUDIT: ,ZZ| ' });
  const after = await ev(() => Store.playlist.names.prefixes.slice());
  ok('the answer typed on the phone is used', after.indexOf('AUDIT: ') >= 0 && after.indexOf('ZZ| ') >= 0, JSON.stringify(after));
  await ev((b4) => { Store.playlist.names.prefixes = b4; Store.upsertPlaylist(Store.playlist); Names.invalidate(); }, before);
  r = await sa({ op: 'answer', sec: 'names', path: [], dialog: 'd999', value: 'x' }).catch((e) => e);
  ok('a stale answer is refused', r instanceof Error || /stopped waiting/.test(r && r.msg || ''), String(r && (r.message || JSON.stringify(r))));
  // OpenSubtitles set up from the phone: the same steps come to the phone, and an answer after a while still counts.
  await ev(() => Subs.setKey(''));
  const keysPage = await sa({ op: 'page', sec: 'keys', path: [] });
  ok('API keys: TMDB and OpenSubtitles on one page', keysPage.rows.some((x) => /TMDB/.test(x.label)) && keysPage.rows.some((x) => /^Set up OpenSubtitles/.test(x.label)), keysPage.rows.map((x) => x.label).join(' | '));
  const os = keysPage.rows.find((x) => /^Set up OpenSubtitles/.test(x.label));
  r = await sa({ op: 'action', sec: 'keys', path: [], i: os.i });
  ok('OpenSubtitles setup comes to the phone, step 1', r.dialog && r.dialog.kind === 'menu' && /step 1 of 3/.test(r.dialog.title), JSON.stringify(r).slice(0, 300));
  r = await sa({ op: 'answer', sec: 'keys', path: [], dialog: r.dialog.id, choice: r.dialog.items.findIndex((x) => /I have an account/.test(x.label)) });
  await ev(() => Settings.phone._timeout());
  r = await sa({ op: 'answer', sec: 'keys', path: [], dialog: r.dialog.id, choice: r.dialog.items.findIndex((x) => /I see my API key/.test(x.label)) });
  ok('step 2 answered after the TV stopped waiting still goes on to step 3', r.dialog && r.dialog.kind === 'prompt' && /step 3 of 3/.test(r.dialog.title) && r.dialog.secret, JSON.stringify(r).slice(0, 300));
  r = await sa({ op: 'answer', sec: 'keys', path: [], dialog: r.dialog.id, cancel: true });
  // Add playlist… opens the web editor's Add a playlist on the phone.
  const ap = (await sa({ op: 'page', sec: 'playlists', path: [] })).rows.find((x) => /^Add playlist/.test(x.label));
  ok('Add playlist on the phone is the phone\'s own form', ap && ap.phone === 'add-playlist', JSON.stringify(ap));
  // The set-up tour from the phone: a page of its own, step by step, nothing on the TV's screen.
  {
    const pls = await sa({ op: 'page', sec: 'playlists', path: [] });
    const plRow = pls.rows.find((x) => x.kind === 'page');
    const plPage = await sa({ op: 'page', sec: 'playlists', path: [plRow.i] });
    const tr = plPage.rows.find((x) => /^Set-up tour/.test(x.label));
    ok('the set-up tour is a page on the phone', tr && tr.kind === 'page' && !tr.tv, JSON.stringify(tr));
    const tp = [plRow.i, tr.i];
    let t = await sa({ op: 'page', sec: 'playlists', path: tp });
    ok('it opens on step 1, without the TV\'s screen', /^Step 1 of \d+/.test(t.rows[0].label) && !(await ev(() => !!document.querySelector('.tour'))), t.rows.slice(0, 3).map((x) => x.label).join(' | '));
    const go = async (re) => { const row = t.rows.find((x) => re.test(x.label)); const r2 = await sa({ op: 'action', sec: 'playlists', path: tp, i: row.i }); t = r2.page || await sa({ op: 'page', sec: 'playlists', path: tp }); return row; };
    await go(/^Tidy up here/);
    ok('Tidy up here goes to step 2, with how many channels it keeps', /^Step 2 of/.test(t.rows[0].label) && t.rows.some((x) => x.label === 'Keeps'), t.rows.slice(0, 3).map((x) => x.label + ' ' + (x.value || '')).join(' | '));
    const cyc = t.rows.find((x) => x.kind === 'cycle');
    if (cyc) { const before2 = cyc.value; t = (await sa({ op: 'cycle', sec: 'playlists', path: tp, i: cyc.i, dir: 1 })).page; ok('a choice on a step changes from the phone', t.rows.find((x) => x.i === cyc.i).value !== before2, before2); }
    await go(/^Skip to the summary/);
    ok('the summary has Apply', t.rows.some((x) => x.label === 'Apply'), t.rows.map((x) => x.label).join(' | ').slice(0, 300));
    await go(/^Close without changes/);
    ok('closing says so and offers to run it again', t.rows.some((x) => /Closed without changes/.test(x.label)) && t.rows.some((x) => /Run the set-up tour again/.test(x.label)) && !(await ev(() => Tour.isOpen)), t.rows.map((x) => x.label).join(' | '));
    await go(/^Run the set-up tour again/); await go(/^Tidy up here/); await go(/^Skip to the summary/);
    const apRow = t.rows.find((x) => x.label === 'Apply');
    const ar = await sa({ op: 'action', sec: 'playlists', path: tp, i: apRow.i });
    ok('Apply from the phone applies it on the TV and says what it kept', /^Done\./.test(ar.msg) && await ev(() => Store.playlist.tour > 0), JSON.stringify(ar).slice(0, 200));
  }
  // An answer after the TV stopped waiting (someone took minutes to copy an API key): asked again behind the scenes, and used.
  r = await sa({ op: 'action', sec: 'names', path: [], i: np.i });
  await ev(() => Settings.phone._timeout());
  r = await sa({ op: 'answer', sec: 'names', path: [], dialog: r.dialog.id, value: 'LATE: ' });
  const late = await ev(() => Store.playlist.names.prefixes.slice());
  ok('an answer after the TV stopped waiting is still used', late.indexOf('LATE: ') >= 0 && !r.dialog, JSON.stringify(late) + ' ' + JSON.stringify(r).slice(0, 200));
  await ev((b4) => { Store.playlist.names.prefixes = b4; Store.upsertPlaylist(Store.playlist); Names.invalidate(); }, before);

  // 5. A picture of every TV page.
  if (SHOTS) {
    for (let n = 0; n < WANT.length; n++) {
      await ev((id) => Settings.section(id), WANT[n][0]); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, 'settings-' + String(n + 1).padStart(2, '0') + '-' + WANT[n][0] + '.png') });
    }
  }
  ok('toasts show on the TV again afterwards', await ev(() => { U.toast('back to normal'); return document.getElementById('toast').textContent === 'back to normal'; }));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all settings audit checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
