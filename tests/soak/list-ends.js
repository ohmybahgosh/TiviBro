/* The ends of lists (discussion #36) and channels that aren't playing lately (issue #37):
     - a long menu whose rows wrap (subtitle search results): the last row shows whole when focused,
       and a panel's buttons always show under long text;
     - the guide after its row size changed in Settings: the last channel sits above the button hints;
     - Down on the last group or the last channel goes back to the first, in the guide and on the
       Channels screen, and Up on the first goes round to the last;
     - a channel that failed twice in a row gets "not playing lately" in the channel list and the
       guide, while the others play, and loses it the moment it plays.
     node tests/soak/list-ends.js [--shots dir]      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const press = async (a, n) => { for (let j = 0; j < (n || 1); j++) await ev((x) => UI.press(x), a); };
  const hintsTop = () => ev(() => Math.round(document.getElementById('hints').getBoundingClientRect().top));

  /* ---------- a long menu with rows that wrap ---------- */
  await ev(() => {
    const items = [];
    for (let j = 0; j < 40; j++) items.push({ label: 'Result ' + (j + 1) + '  Some.Movie.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-GROUP', sub: 'English  ' + (j * 37) + ' downloads  hearing impaired' });
    UI.menu('40 subtitles for "Some Movie"', items);
  });
  await press('down', 39); await page.waitForTimeout(200);
  let m = await ev(() => { const f = document.querySelector('#modalBody .mi.focus'), body = document.getElementById('modalBody'); const fr = f.getBoundingClientRect(), br = body.getBoundingClientRect();
    const cut = [].filter.call(body.children, (e) => e.style.visibility !== 'hidden' && e.getBoundingClientRect().bottom > br.bottom + 1).length;
    return { txt: f.textContent.slice(0, 10), fb: Math.round(fr.bottom), bb: Math.round(br.bottom), cut: cut }; });
  ok('the last result of a long menu shows whole when focused', m.txt === 'Result 40 ' && m.fb <= m.bb, JSON.stringify(m));
  ok('no half rows at the bottom of the menu', m.cut === 0, JSON.stringify(m));
  await shot('long-menu-end');
  await press('up', 20); await page.waitForTimeout(100);
  m = await ev(() => { const f = document.querySelector('#modalBody .mi.focus'), br = document.getElementById('modalBody').getBoundingClientRect(), fr = f.getBoundingClientRect(); return { txt: f.textContent.slice(0, 10), ok: fr.top >= br.top - 1 && fr.bottom <= br.bottom + 1 }; });
  ok('moving back up keeps the focused row whole', m.txt === 'Result 20 ' && m.ok, JSON.stringify(m));
  await press('back');
  const many = []; for (let j = 0; j < 30; j++) many.push('This is a long explanation that goes on and on, line after line.');
  await ev((t) => UI.panel('A long note', U.el('p', 'panel-text', t), [{ label: 'OK' }, { label: 'Another' }]), many.join('  '));
  await page.waitForTimeout(150);
  m = await ev(() => { const btn = document.querySelector('#modalBody .mbtns'), box = document.querySelector('.modal-box').getBoundingClientRect(), r = btn.getBoundingClientRect(); return { b: Math.round(r.bottom), box: Math.round(box.bottom), h: Math.round(r.height) }; });
  ok('a panel with long text still shows its buttons whole', m.h > 30 && m.b <= m.box, JSON.stringify(m));
  await press('back');

  /* ---------- the guide after its row size changed in Settings ---------- */
  await ev(() => Views.switchTab('settings')); await page.waitForTimeout(400);
  await ev(() => { Store.settings.guideRows = 'xl'; Store.saveSettings(); Views.applyLook(); Guide.resize(); });
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(600);
  await ev(() => { const l = Library.channels(Library.ALL); Guide.open(Library.ALL, l[l.length - 1].k); }); await page.waitForTimeout(600);
  let g = await ev(() => { const s = document.querySelector('#guideBody .grow.sel'), l = Library.channels(Library.ALL); return { sel: Guide.__sel(), n: l.length, bottom: Math.round(s.getBoundingClientRect().bottom), rows: document.querySelectorAll('#guideBody .grow').length }; });
  ok('Extra large rows set from Settings: the last channel sits above the button hints', g.sel === g.n - 1 && g.bottom <= await hintsTop() && g.rows >= 3 && g.rows <= 5, JSON.stringify(g));
  await shot('guide-bottom-xl');
  await ev(() => { Store.settings.guideRows = 'm'; Store.saveSettings(); Views.applyLook(); Guide.resize(); }); await page.waitForTimeout(300);
  await ev(() => { const l = Library.channels(Library.ALL); Guide.open(Library.ALL, l[l.length - 1].k); }); await page.waitForTimeout(400);
  g = await ev(() => ({ sel: Guide.__sel(), bottom: Math.round(document.querySelector('#guideBody .grow.sel').getBoundingClientRect().bottom) }));
  ok('Normal rows: the last channel above the hints too', g.bottom <= await hintsTop(), JSON.stringify(g));
  await shot('guide-bottom');

  /* ---------- Down on the last row goes round to the first ---------- */
  await press('down'); await page.waitForTimeout(200);
  ok('guide: Down on the last channel goes to the first', await ev(() => Guide.__sel()) === 0);
  await press('up'); await page.waitForTimeout(200);
  const nAll = await ev(() => Library.channels(Library.ALL).length);
  ok('guide: Up on the first channel goes round to the last', await ev(() => Guide.__sel()) === nAll - 1, await ev(() => Guide.__sel()));
  await press('down'); await page.waitForTimeout(200);
  await press('down', 2); await page.waitForTimeout(100);
  ok('and Down moves on as before', await ev(() => Guide.__sel()) === 2);
  await press('back'); await page.waitForTimeout(300);        // to the groups
  const ng = await ev(() => Library.groups().length);
  await press('down', ng + 3); await page.waitForTimeout(300);   // to the bottom, and round
  let gs = await ev(() => Guide.__gsel());
  ok('guide groups: Down on the last group goes back to the first', gs < ng - 1, gs + ' of ' + ng);
  await ev(() => { while (Guide.__gsel() > 0) UI.press('up'); });
  await press('up'); await page.waitForTimeout(100);
  ok('guide groups: Up on the first group goes round to the last', await ev(() => Guide.__gsel()) === ng - 1, await ev(() => Guide.__gsel()));
  await press('down'); await page.waitForTimeout(100);
  await press('down', ng - 1); await page.waitForTimeout(200);
  ok('guide groups: the last group', await ev(() => Guide.__gsel()) === ng - 1);
  await press('down'); await page.waitForTimeout(200);
  ok('guide groups: one more Down is the first group', await ev(() => Guide.__gsel()) === 0);

  await ev(() => Views.switchTab('live')); await page.waitForTimeout(600);
  const live = () => ev(() => { const s = document.querySelector('#groupList .row.sel .name'); return s ? s.textContent : ''; });
  const names = await ev(() => Library.groups().map((x) => x.name));
  await ev(() => { if (!document.getElementById('groupList').classList.contains('active')) UI.press('left'); });
  await ev((first) => { for (let i = 0; i < 500; i++) { const s = document.querySelector('#groupList .row.sel .name'); if (s && s.textContent === first) break; UI.press('up'); } }, names[0]); await page.waitForTimeout(200);
  ok('Channels screen: on the first group', (await live()) === names[0], await live());
  await press('up'); await page.waitForTimeout(100);
  ok('Channels screen: Up on the first group goes round to the last', (await live()) === names[names.length - 1], await live());
  await press('down'); await page.waitForTimeout(100);
  await press('down', names.length - 1); await page.waitForTimeout(200);
  ok('Channels screen: the last group', (await live()) === names[names.length - 1], await live());
  await press('down'); await page.waitForTimeout(200);
  ok('Channels screen: Down on the last group goes back to the first', (await live()) === names[0], await live());

  /* ---------- not playing lately ---------- */
  const c = await ev(() => { const c = Library.channels(Library.ALL)[3]; return { k: c.k, n: Library.name(c) }; });
  const id = c.k.replace(/^\D+/, '');
  await ctx.route(new RegExp('/live/demo/demo/' + id + '\\.'), (r) => r.fulfill({ status: 404, body: 'gone' }));
  for (let t = 0; t < 2; t++) {
    await ev((k) => Views.startChannel(Library.data.channels.find((x) => x.k === k), true), c.k);
    await page.waitForFunction(() => Player.state === 'error', null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  ok('two failed tries: the channel is marked', await ev((k) => DeadList.marked({ k: k }), c.k));
  await ev(() => { Views.switchTab('live'); }); await page.waitForTimeout(300);
  const ai = await ev(() => Library.groups().findIndex((x) => x.id === Library.ALL));
  await ev(() => { if (!document.getElementById('groupList').classList.contains('active')) UI.press('left'); });
  await ev((first) => { for (let i = 0; i < 500; i++) { const s = document.querySelector('#groupList .row.sel .name'); if (s && s.textContent === first) break; UI.press('up'); } }, names[0]);
  await press('down', ai); await press('right'); await page.waitForTimeout(500);
  const tagIn = (sel) => ev((a) => [].some.call(document.querySelectorAll(a.sel), (r) => r.textContent.indexOf(a.n) >= 0 && r.querySelector('.deadtag') && getComputedStyle(r.querySelector('.deadtag')).display !== 'none'), { sel: sel, n: c.n });
  const tagsShown = (sel) => ev((s) => [].filter.call(document.querySelectorAll(s + ' .deadtag'), (e) => e.style.display !== 'none' && e.offsetParent).length, sel);
  ok('Channels screen: "not playing lately" on its row', await tagIn('#chanList .row'));
  ok('and on no other row', (await tagsShown('#chanList')) === 1);
  await shot('dead-channel-list');
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(300);
  await ev((k) => Guide.open(Library.ALL, k), c.k); await page.waitForTimeout(500);
  ok('guide: "not playing" in its channel column', await tagIn('#guideBody .grow'));
  ok('and on no other channel', (await tagsShown('#guideBody')) === 1);
  await shot('dead-channel-guide');
  await ctx.unroute(new RegExp('/live/demo/demo/' + id + '\\.'));
  await ev((k) => Views.startChannel(Library.data.channels.find((x) => x.k === k), true), c.k);
  await page.waitForFunction(() => Player.state === 'playing', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  ok('it plays again: the mark is gone', !(await ev((k) => DeadList.marked({ k: k }), c.k)) && (await tagsShown('#guideBody')) === 0);

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all list end checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
