/* Settings > Appearance > Lists open on: where you left off (the last group and channel), the top of the first
   group, or the top of a group you pick, after TiviBro starts again.
     node tests/soak/open-on.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } }), page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now(), settings: { resumeLast: false } })[0]);
  const ev = (f, a) => page.evaluate(f, a);
  const boot = async () => { await page.waitForFunction(() => window.Library && Library.count() > 0 && window.Guide && Guide.__list().length > 0, null, { timeout: 60000 }); await page.waitForTimeout(1500); };
  try {
    await page.goto(APP); await boot();
    // Left off on the fourth channel of a group further down.
    const at = await ev(() => {
      const gs = Library.groups().filter((g) => !g.head && !g.hidden && Library.channels(g.id).length > 4);
      const left = gs[gs.length - 1], pick = gs[Math.floor(gs.length / 2)], c = Library.channels(left.id)[3];
      Store.edits.lastGroup = left.id; Store.edits.last = c.k; Store.saveEdits();
      return { left: left.id, pick: pick.id, first: gs[0].id, ch: c.k };
    });
    const where = () => ev(() => { const l = Guide.__list(), s = Guide.__sel(); return { gid: Guide.__gid(), k: l[s] && l[s].k, sel: s, zone: Guide.__zone() }; });
    const restart = async (o) => { await ev((x) => { Object.assign(Store.settings, x); Store.saveSettings(); }, o); await page.waitForTimeout(600); await page.reload(); await boot(); return where(); };

    let w = await restart({ openOn: 'last' });
    ok('Where I left off: the last group, on the last channel', w.gid === at.left && w.k === at.ch, JSON.stringify(w));
    w = await restart({ openOn: 'first' });
    ok('The first group: its top', w.gid !== at.left && w.sel === 0 && w.zone === 'grid', JSON.stringify(w));
    w = await restart({ openOn: 'group', openGroup: at.pick });
    ok('A group I pick: that group, at its top', w.gid === at.pick && w.sel === 0, JSON.stringify(w));
    w = await restart({ openOn: 'group', openGroup: 'no-such-group' });
    ok('a picked group that is gone: the first group instead', w.gid !== 'no-such-group' && w.sel === 0, JSON.stringify(w));
    // The setting itself, as the phone sees it, with the group picker under it.
    const rows = await ev(() => Settings.phone.page('look', []).rows.map((r) => r.label + '=' + (r.value || '')));
    ok('Appearance has "Lists open on" and, for a picked group, "Group to open on"', rows.some((r) => /^Lists open on=A group I pick/.test(r)) && rows.some((r) => /^Group to open on=/.test(r)), rows.slice(0, 8).join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all open-on checks passed');
  process.exit(fails ? 1 : 0);
})();
