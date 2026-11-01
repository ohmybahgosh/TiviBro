/* The phone app's questions for TiviBro (POST /v1/ask), with TiviBro in a browser and the reference
   client as the phone: the guide, a channel's schedule, reminders, favorites, Movies and Shows, typing
   into the TV, a backup, and adding a playlist from a shared link.
     node tests/soak/phone-asks.js      (mock provider on :8077, relay_dev on :47811, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const C = require('../../scripts/companion/tb-phone.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const RELAY = 'http://127.0.0.1:47811';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const ctl = (u, body) => fetch(RELAY + u, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let s = await ctl('/companion/status');
  for (const p of s.phones) await ctl('/companion/forget', { id: p.id });
  await ctl('/companion/set', { on: true });
  s = await ctl('/companion/pair', { open: true });
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Ask test' });
  const ask = (w, a, o) => C.ask(cred, w, a, o).then((r) => r.data);

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  // The guide: a page of channels with what is on at a time, and the two after.
  let g = null;
  for (let i = 0; i < 8; i++) { g = await ask('guide', { offset: 0, limit: 20 }); if (!g.pending) break; await wait(1000); }
  const total = await ev(() => Library.channels(Library.ALL).length);
  ok('the guide comes a page at a time', g.total === total && g.rows.length === Math.min(20, total), JSON.stringify({ total: g.total, rows: g.rows.length }));
  const withProg = g.rows.filter((r) => r.p && r.p.length);
  ok('with programmes, now first', withProg.length > 0 && withProg.every((r) => r.p[0].e > Date.now() && r.p[0].t), JSON.stringify(withProg[0]));
  const later = Date.now() + 3 * 3600e3;
  const g2 = await ask('guide', { offset: 0, limit: 20, at: later });
  const r2 = g2.rows.find((r) => r.p && r.p.length);
  ok('and at a later time', r2 && r2.p[0].e > later, JSON.stringify(r2));

  // One channel's schedule, and a reminder.
  const k = withProg[0].k;
  const sch = await ask('schedule', { k });
  ok('a channel\'s schedule lists its programmes', sch.k === k && sch.progs.length >= 3 && sch.progs.every((p) => p.t && p.s && p.e), JSON.stringify(sch).slice(0, 200));
  const fut = sch.progs.find((p) => p.s > Date.now());
  let rr = await ask('remind', { k, s: fut.s, on: true });
  ok('a reminder from the phone is set on the TV', rr.on && await ev((x) => Store.edits.reminders.some((r) => r.k === x.k && r.s === x.s), { k, s: fut.s }));
  const sch2 = await ask('schedule', { k });
  ok('and shows in the schedule', sch2.progs.find((p) => p.s === fut.s).r === 1);
  await ask('remind', { k, s: fut.s, on: false });
  ok('and comes off again', await ev((x) => !Store.edits.reminders.some((r) => r.k === x.k && r.s === x.s), { k, s: fut.s }));

  // Favorites.
  const fk = g.rows[3].k;
  let f = await ask('fav', { k: fk, on: true });
  ok('a favorite from the phone', f.on && await ev((x) => Library.isFav(x), fk));
  let l = null;
  for (let i = 0; i < 10; i++) { l = await C.call(cred, 'GET', '/v1/lineup'); if (l.channels && l.channels.find((c) => c.k === fk && c.fav)) break; await wait(500); }
  ok('the phone\'s channel list follows', !!(l.channels && l.channels.find((c) => c.k === fk && c.fav)));
  f = await ask('fav', { k: fk, on: false });
  ok('and off again', !f.on && await ev((x) => !Library.isFav(x), fk));

  // Movies and Shows.
  const mc = await ask('vodcats', { kind: 'movie' });
  ok('movie categories, as on the TV', mc.cats.length > 2 && mc.cats.some((c) => c.id === '_all'), JSON.stringify(mc.cats.slice(0, 4)));
  const mi = await ask('voditems', { kind: 'movie', cat: '_all', offset: 0, limit: 5 });
  ok('movies a page at a time', mi.total > 5 && mi.items.length === 5 && mi.items.every((x) => x.id && x.n), JSON.stringify(mi.items[0]));
  const q = mi.items[0].n.split(' ')[0];
  const ms = await ask('voditems', { kind: 'movie', q });
  ok('searching movies', ms.items.length > 0 && ms.items.every((x) => x.n.toLowerCase().includes(q.toLowerCase())), q);
  const info = await ask('vodinfo', { kind: 'movie', id: mi.items[0].id });
  ok('a movie\'s details', info.n === mi.items[0].n && info.plot && info.year, JSON.stringify(info).slice(0, 200));
  const si = await ask('voditems', { kind: 'series', cat: '_all' });
  const sinfo = await ask('vodinfo', { kind: 'series', id: si.items[0].id });
  ok('a show\'s seasons and episodes', sinfo.seasons.length > 0 && sinfo.seasons[0].eps.length > 0 && sinfo.seasons[0].eps[0].id, JSON.stringify(sinfo).slice(0, 200));
  const ep = sinfo.seasons[0].eps[1] || sinfo.seasons[0].eps[0];
  await ask('vodplay', { kind: 'series', id: si.items[0].id, ep: ep.id });
  await page.waitForFunction(() => Views.mode === 'vod', null, { timeout: 15000 }).catch(() => {});
  const playing = await ev(() => Views.vod && Views.vod.meta && Views.vod.meta.title);
  ok('an episode picked on the phone plays on the TV', !!playing && playing.indexOf(sinfo.n) === 0, playing);
  await ev(() => { Views.stopAll(); Views.switchTab('live'); });
  await page.waitForTimeout(800);

  // Typing into the TV: a rename box.
  await ev(() => UI.prompt('Rename group', 'Old name', function (v) { window.__renamed = v; }));
  await page.waitForTimeout(400);
  let st = null;
  for (let i = 0; i < 8; i++) { st = await C.call(cred, 'GET', '/v1/state'); if (st.state && st.state.inputs) break; await wait(500); }
  const box = st.state && st.state.inputs && st.state.inputs[0];
  ok('the phone sees a text box on the TV, with its label and text', box && box.label === 'Rename group' && box.value === 'Old name' && box.submit === 1, JSON.stringify(st.state && st.state.inputs));
  await ask('input', { id: box.id, value: 'Sports I watch', submit: true }, { seal: true });
  await page.waitForTimeout(300);
  ok('typing on the phone fills it and saves', await ev(() => window.__renamed) === 'Sports I watch');

  // Backups.
  const bk = await ask('backup', {}, { seal: true });
  ok('a backup for the phone, with the playlists', bk.backup && bk.backup.kind === 'backup' && bk.backup.settings.playlists.length > 0);

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();

  // A fresh TV: a link shared to the phone adds the playlist, and the set-up boxes can be typed into.
  const b2 = await chromium.launch();
  const p2 = await (await b2.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } localStorage.setItem('tivibro.devRelay', '47811'); });
  await p2.goto(APP);
  await p2.waitForFunction(() => document.querySelector('#viewSetup input') && window.Phone, null, { timeout: 30000 });
  await p2.waitForTimeout(2500);
  for (let i = 0; i < 8; i++) { st = await C.call(cred, 'GET', '/v1/state'); if (st.state && st.state.inputs && st.state.inputs.some((x) => x.label === 'Full link')) break; await wait(700); }
  const fields = (st.state && st.state.inputs) || [];
  ok('a fresh TV\'s set-up boxes reach the phone', fields.some((x) => x.label === 'Full link') && fields.some((x) => x.label === 'Name (optional)'), JSON.stringify(fields));
  const name = fields.find((x) => x.label === 'Name (optional)');
  await ask('input', { id: name.id, value: 'From my phone' }, { seal: true });
  ok('and typing on the phone fills the TV\'s box', await p2.evaluate(() => [].slice.call(document.querySelectorAll('#viewSetup input')).some((i) => i.value === 'From my phone')));
  const add = await ask('playlist', { link: 'http://127.0.0.1:8077/get.php?username=demo&password=demo&type=m3u_plus' }, { seal: true });
  ok('a shared link adds the playlist', add && /Added/.test(add.msg), JSON.stringify(add));
  await p2.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }).catch(() => {});
  ok('and the fresh TV opens on it', await p2.evaluate(() => Store.playlist && Store.playlist.type === 'xtream' && Library.count() > 0));
  const bad = await C.ask(cred, 'playlist', { link: 'http://127.0.0.1:8077' }, { seal: true }).catch((e) => e);
  ok('a bare server address is turned down, with the reason', bad.code === 'tv' && /only a server address/.test(bad.message), bad.message);
  ok('no page errors on the fresh TV', !errs2.length, errs2.join(' | '));
  await b2.close();
  await C.call(cred, 'POST', '/v1/forget', {});
  console.log(fails ? fails + ' failures' : 'all phone question tests passed');
  process.exit(fails ? 1 : 0);
})();
