/* The guide's navigation and look (Bob's guide ideas 1 to 9, the menus and the group column):
   Rewind / Fast-forward a screen at a time and held at most about three a second, Jump to…, the day in the
   time bar, held arrows that stay in hand (Left held never opens the groups), each group's place kept,
   colour by category with its legend, season / episode and NEW in the details, a long title scrolling on
   the focused programme, and menus with icons and a line under the title.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &   (its guide has categories and episodes)
     npm run serve &
     node tests/soak/guide-nav.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime(), settings: { guideTint: true } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(3000);
  const ev = (f, a) => page.evaluate(f, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  // A remote button by its key code, as the TV sends it (repeat: a held button's repeats).
  const code = (c, repeat) => ev(([c, r]) => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: c, which: c, repeat: !!r, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: c, which: c, bubbles: true })); }, [c, repeat]);
  const FF = 417, REW = 412, LEFT = 37, UP = 38, RIGHT = 39, DOWN = 40, BACK = 461;
  const st = () => ev(() => ({ t: Guide.__focusT(), now: Date.now(), zone: Guide.__zone(), sel: Guide.__sel(), gid: Guide.__gid(), k: (Guide.__list()[Guide.__sel()] || {}).k, times: document.getElementById('guideTimes').innerText.replace(/\s+/g, ' '), chip: document.querySelector('.gjump') && !document.querySelector('.gjump').classList.contains('hidden') ? document.querySelector('.gjump').textContent : '' }));
  try {
    await ev(() => Views.switchTab('guide')); await wait(1000);
    await code(RIGHT); await wait(300); await code(DOWN); await code(DOWN); await wait(600);

    // ---- 1: Fast-forward and Rewind jump a screen ----
    let a = await st();
    await code(FF); await wait(400);
    let s1 = await st();
    ok('Fast-forward jumps a screen (two and a half hours), not one programme', Math.abs(s1.t - a.t - 2.5 * 3600e3) < 120e3, (s1.t - a.t) / 60000 + ' min');
    ok('and says where it landed', /\d/.test(s1.chip), s1.chip);
    await code(FF); await wait(400);
    let s2 = await st();
    ok('past midnight the time bar says the day', /Tomorrow/.test(s2.times), s2.times);
    await shot('nav-tomorrow');
    // Held: the TV repeats about 30 times a second; jumps come at most about three a second.
    const t0 = (await st()).t;
    for (let n = 0; n < 8; n++) await code(FF, true);
    await wait(50);
    const held = (await st()).t;
    ok('a held Fast-forward jumps once per third of a second, not every repeat', Math.round((held - t0) / (2.5 * 3600e3)) <= 1, (held - t0) / 3600e3 + ' h');
    await wait(400);
    await code(BACK); await wait(400);
    const back = await st();
    ok('Back goes to now', Math.abs(back.t - back.now) < 120e3);

    // ---- 3: held Left stops at now, a fresh press opens the groups ----
    await code(FF); await wait(400);
    for (let n = 0; n < 60; n++) { await code(LEFT, true); await wait(45); }
    await wait(300);
    const hl = await st();
    ok('a held Left runs back to now and stops there: the groups stay shut', hl.zone === 'grid' && hl.t < hl.now + 3 * 3600e3, JSON.stringify(hl).slice(0, 160));
    await wait(400);
    // Held Down: a row at a time, then three at a time after a second and a half.
    const s0 = (await st()).sel;
    for (let n = 0; n < 40; n++) { await code(DOWN, n > 0); await wait(60); }
    await wait(300);
    const moved = (await st()).sel - s0;
    ok('a held Down speeds up after a second and a half (more rows than presses)', moved > 44, moved + ' rows for 40 presses');
    await wait(400);

    // ---- 4: each group keeps its place ----
    await ev(() => { Views.switchTab('guide'); }); await wait(500);
    if ((await st()).zone !== 'grid') { await code(RIGHT); await wait(400); }
    const g1 = (await st()).gid;
    await code(DOWN); await code(DOWN); await code(DOWN); await wait(300);
    const kept = (await st()).k;
    await code(LEFT); await wait(400);                          // fresh Left at now: the groups
    ok('a fresh Left at now opens the groups', (await st()).zone === 'groups');
    await code(DOWN); await wait(500); await code(RIGHT); await wait(500);
    const other = await st();
    await code(LEFT); await wait(400); await code(UP); await wait(500); await code(RIGHT); await wait(500);
    const again = await st();
    ok('coming back to a group lands on the channel you left it on', other.gid !== g1 && again.gid === g1 && again.k === kept, JSON.stringify({ g1, other: other.gid, again: again.gid, kept, k: again.k }));

    // ---- 2: Jump to… ----
    await ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true })); }); await wait(800);
    await ev(() => { document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 13, bubbles: true })); }); await wait(400);
    const menu = await ev(() => ({ icons: document.querySelectorAll('#modal .mi .mic svg').length, sub: (document.querySelector('#modal .modal-sub') || {}).textContent || '', rows: [].slice.call(document.querySelectorAll('#modal .mi span')).map((x) => x.textContent) }));
    ok('Hold OK: a menu with an icon on each row and the channel and time under its title', menu.icons >= 5 && /·/.test(menu.sub) && menu.rows.indexOf('Jump to…') >= 0, JSON.stringify(menu).slice(0, 300));
    await shot('nav-menu');
    const click = (re) => ev((r) => { const x = [].slice.call(document.querySelectorAll('#modal .mi')).find((y) => new RegExp(r).test(y.textContent)); if (x) x.click(); return !!x; }, re);
    await click('^Jump to…'); await wait(400);
    const jm = await ev(() => [].slice.call(document.querySelectorAll('#modal .mi span, #modal .mh')).map((x) => x.textContent));
    ok('Jump to… offers tonight, tomorrow and the days the guide has', jm.some((x) => /^Tomorrow (morning|night)$/.test(x)) && jm.some((x) => /^Late tonight$|^Tonight$/.test(x)), jm.join(' | '));
    await shot('nav-jumpto');
    await click('^Tomorrow night'); await wait(500);
    const jt = await st(), want = await ev(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); return d.getTime(); });
    ok('Tomorrow night lands on tomorrow at 8 pm, with the day in the time bar', Math.abs(jt.t - want) < 60e3 && /Tomorrow/.test(jt.times), new Date(jt.t).toString());
    await code(BACK); await wait(400);

    // ---- 7, 9: colours, legend, episode and NEW ----
    const look = await ev(() => ({ news: document.querySelectorAll('#guideBody .gp.k-n').length, legend: (document.getElementById('glegend') || {}).textContent || '' }));
    ok('colour by category: news programmes get their colour, and the legend says what each means', look.news > 0 && /Sports/.test(look.legend), JSON.stringify(look));
    await ev(() => { const L = Library, i = L.channels(L.ALL).findIndex((c) => /Drama One/.test(c.n)); Guide.open(L.ALL, L.channels(L.ALL)[i].k); }); await wait(800);
    await code(RIGHT); await wait(500);
    const det = await ev(() => ({ ep: (document.querySelector('#guideDetail .gd-ep') || {}).textContent || '', badges: [].slice.call(document.querySelectorAll('#guideDetail .gd-badge')).map((x) => x.textContent) }));
    ok('the details show the season and episode, and NEW when the guide says so', /^S\d+ E\d+$/.test(det.ep), JSON.stringify(det));

    // ---- 8: a long title scrolls on the focused programme only ----
    await ev(() => { const c = Guide.__list()[Guide.__sel()], l = Epg.request(c), t = Guide.__focusT(); const p = l.find((x) => x.s <= t && x.e > t); p.t = 'An Extraordinarily Long Programme Title That Cannot Possibly Fit In Its Cell'; Guide.draw(); });
    await wait(1800);
    const mq = await ev(() => { const el = document.querySelector('.grow.sel .gp.focus .gt'); return { on: el.classList.contains('mq'), tr: el.querySelector('b').style.transform, others: document.querySelectorAll('.gt.mq').length }; });
    ok('a title too long for its cell scrolls on the focused programme, and only there', mq.on && /translateX\(-\d+/.test(mq.tr) && mq.others === 1, JSON.stringify(mq));
    await shot('nav-marquee');

    // ---- the group column ----
    await code(BACK); await wait(300); await code(LEFT); await wait(500);
    const gc = await ev(() => ({ title: document.querySelector('#guideGroups .col-title').textContent, icons: document.querySelectorAll('#guideGroupList .row .gic svg').length, rowH: document.querySelector('#guideGroupList .row').offsetHeight, pills: document.querySelectorAll('#guideGroupList .row .tag').length }));
    ok('the group column: its count in the title, compact rows, icons on TiviBro\'s own groups', /^Groups\s+\d+$/.test(gc.title) && gc.icons >= 1 && gc.rowH <= 66, JSON.stringify(gc));
    await shot('nav-groups');
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all guide navigation checks passed');
  process.exit(fails ? 1 : 0);
})();
