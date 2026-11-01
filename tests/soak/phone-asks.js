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

  // A group with channels All leaves out (a Local channels group keeps stations whose network group is
  // hidden): the phone gets those channels too, marked as not in All, so the group isn't empty there.
  const loc = await ev(() => {
    var pg = Library.groups().filter(function (g) { return g.id !== Library.ALL && !Library.isCustom(g.id); })[0];
    var keys = Library.channels(pg.id).slice(0, 2).map(function (c) { return c.k; });
    var g = Library.createGroup('Local channels'); Library.copyTo(g.id, keys); Library.hideGroup(pg.id, true);
    Phone.sendLineup();
    return { id: g.id, keys: keys, inGroup: Library.channels(g.id).length };
  });
  let lu = null;
  for (let i = 0; i < 12; i++) { lu = await C.call(cred, 'GET', '/v1/lineup'); if (lu.groups && lu.groups.some((g) => g.id === loc.id)) break; await wait(500); }
  const lg = lu.groups && lu.groups.find((g) => g.id === loc.id);
  const got = lg ? lg.keys.map((k) => lu.channels.find((c) => c.k === k)) : [];
  ok('a group with channels All leaves out still lists them on the phone', loc.inGroup === 2 && got.length === 2 && got.every((c) => c && c.na === 1), JSON.stringify({ loc, lg, got }));
  ok('and All on the phone still matches the TV\'s', lu.channels.filter((c) => !c.na).length === await ev(() => Library.channels(Library.ALL).length));
  await ev((x) => { Library.deleteGroup(x.id); Library.groups().forEach(function (g) { Library.hideGroup(g.id, false); }); }, loc);

  // A channel's options from the phone's long press: what it is, your groups, rename, a new group, hide.
  const ck = g.rows[5].k;
  let ci = await ask('chan', { k: ck, op: 'info' });
  ok('a channel\'s options: its name, provider group and your groups', ci.k === ck && ci.name && ci.group && Array.isArray(ci.groups) && !ci.hidden, JSON.stringify(ci));
  ci = await ask('chan', { k: ck, op: 'rename', name: 'Phone Named' });
  ok('renamed from the phone', ci.name === 'Phone Named' && ci.renamed && await ev((k) => Library.name(Library.find(k)) === 'Phone Named', ck));
  ci = await ask('chan', { k: ck, op: 'rename', name: '' });
  ok('and back to the provider\'s name', !ci.renamed && ci.name !== 'Phone Named');
  ci = await ask('chan', { k: ck, op: 'newgroup', name: 'From the phone' });
  const ng = ci.groups.find((x) => x.name === 'From the phone');
  ok('a new group with the channel in it', ng && ng.has === 1 && await ev((id) => Library.channels(id).length === 1, ng.id), JSON.stringify(ci.groups));
  ci = await ask('chan', { k: ck, op: 'group', group: ng.id, on: false });
  ok('and taken out of it again', ci.groups.find((x) => x.id === ng.id).has === 0);
  ci = await ask('chan', { k: ck, op: 'hide', on: true });
  ok('hidden on the TV from the phone', ci.hidden && await ev((k) => !!Store.edits.hiddenChannels[k], ck));
  await ask('chan', { k: ck, op: 'hide', on: false });
  await ev((id) => Library.deleteGroup(id), ng.id);
  ok('an ordinary channel has no team to follow', ci.team == null || (await ask('chan', { k: ck, op: 'info' })).team === null);
  // A team's own channel: Follow from the phone (My teams).
  const tk = g.rows[6].k;
  const was = await ev((k) => { const c = Library.find(k), n = c.n; c.n = 'NFL | DETROIT LIONS'; Library.data.channels = Library.data.channels.slice(); return n; }, tk);
  ci = await ask('chan', { k: tk, op: 'info' });
  ok('a team channel offers its team', ci.team && ci.team.id === 'nfl:det' && ci.team.on === 0, JSON.stringify(ci.team));
  ci = await ask('chan', { k: tk, op: 'follow', on: true });
  ok('followed from the phone', ci.team.on === 1 && await ev(() => Teams.follows('nfl:det')) && /Following the Detroit Lions/.test(ci.msg), JSON.stringify(ci));
  ci = await ask('chan', { k: tk, op: 'follow', on: false });
  ok('and unfollowed', ci.team.on === 0 && !(await ev(() => Teams.follows('nfl:det'))));
  await ev((x) => { const c = Library.find(x[0]); c.n = x[1]; Library.data.channels = Library.data.channels.slice(); }, [tk, was]);

  // Settings from the phone: every page, the same rows as on the TV, and changes that stick.
  const sa = (o) => ask('settings', o, { seal: true });
  const secs = await sa({ op: 'sections' });
  ok('the phone gets the TV\'s settings pages', secs.sections.some((x) => x.id === 'look' && x.title === 'Appearance') && secs.sections.length >= 8, JSON.stringify(secs.sections));
  let pg = await sa({ op: 'page', sec: 'look' });
  const clock = pg.rows.find((r) => r.label === 'Show clock'), nums = pg.rows.find((r) => r.label === 'Numbers');
  ok('a page comes as rows: toggles, choices with their options', clock && clock.kind === 'toggle' && nums && nums.kind === 'choice' && nums.options.length === 3, JSON.stringify(pg.rows.slice(0, 4)));
  pg = await sa({ op: 'toggle', sec: 'look', i: clock.i, on: !clock.on });
  ok('a toggle from the phone changes the TV', await ev(() => Store.settings.showClock) === !clock.on && pg.page.rows.find((r) => r.label === 'Show clock').on === !clock.on);
  await sa({ op: 'toggle', sec: 'look', i: clock.i, on: clock.on });
  pg = await sa({ op: 'choice', sec: 'look', i: nums.i, v: 1 });
  ok('a choice from the phone changes the TV', await ev(() => Store.settings.numFont) === 'even' && await ev(() => document.body.classList.contains('nums-even')));
  await sa({ op: 'choice', sec: 'look', i: nums.i, v: 0 });
  const grp = await sa({ op: 'page', sec: 'groups' });
  const sub = grp.rows.find((r) => r.kind === 'page');
  if (sub) { const inner = await sa({ op: 'page', sec: 'groups', path: [sub.i] }); ok('and pages inside pages', inner.trail.length === 2 && inner.rows.length > 0, JSON.stringify(inner).slice(0, 200)); }
  let pages = 0, badPages = [];
  for (const sc of secs.sections) {
    const top = await sa({ op: 'page', sec: sc.id }).catch((x) => { badPages.push(sc.id + ': ' + x.message); return null; });
    if (!top) continue; pages++;
    for (const r of top.rows.filter((x) => x.kind === 'page')) { await sa({ op: 'page', sec: sc.id, path: [r.i] }).then(() => pages++, (x) => badPages.push(sc.id + ' > ' + r.label + ': ' + x.message)); }
  }
  ok('every settings page and the pages inside them open on the phone (' + pages + ')', !badPages.length && pages > 15, badPages.join(' | '));
  const e = await C.ask(cred, 'settings', { op: 'sections' }).catch((x) => x);
  ok('settings only travel sealed (the PIN goes with them)', e.code === 'sealed');
  await ev(() => { Store.settings.pin = Parental && (function () { return U.hash('tivibro:1234:pin'); })(); Store.settings.pinScope = 'both'; Parental.lock(); });
  let lk = await sa({ op: 'sections' });
  ok('locked with the TV\'s PIN: the phone is asked for it', lk.locked === true, JSON.stringify(lk));
  lk = await sa({ op: 'sections', pin: '0000' });
  ok('a wrong PIN is refused', lk.locked === true && /Wrong PIN/.test(lk.msg));
  lk = await sa({ op: 'sections', pin: '1234' });
  ok('the right PIN opens it', Array.isArray(lk.sections));
  await ev(() => { delete Store.settings.pin; Store.saveSettings(); });

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
