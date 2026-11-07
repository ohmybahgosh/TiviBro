/* Merge groups: several provider groups shown as one (four NHL groups as one NHL group), on the TV
   (Hold OK on a group > Merge groups into this) and in the web editor (⋯ on a group), and Split.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/merge-groups.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; tv.on('pageerror', (e) => errs.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP);
  await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await tv.waitForTimeout(2500);
  const ev = (f, a) => tv.evaluate(f, a);
  try {
    // ---- on the TV ----
    const before = await ev(() => ({ sp: Library.channels('x2').length, s10: Library.channels('x10').length, s12: Library.channels('x12').length }));
    const labels = await ev(() => { Views.switchTab('live'); Views.groupMenu(Library.groups().find((g) => g.id === 'x2')); const l = UI.menuLabels; UI.press('back'); return l; });
    ok('Hold OK on a provider group offers Merge groups into this', labels.some((l) => /^Merge groups into this/.test(l)), labels.join(' | '));
    // The picker: groups sharing a word ("Sport") first, ticked with OK, then Merge.
    const pick = await ev(() => {
      Views.groupMenu(Library.groups().find((g) => g.id === 'x2'));
      const i = UI.menuLabels.findIndex((l) => /^Merge groups into this/.test(l));
      for (let k = 0; k < i; k++) UI.press('down');
      UI.press('ok');
      return UI.menuLabels;
    });
    ok('the picker lists the groups with a word in common first', /^Tick the groups/.test(pick[0]) && /^Sport$/.test(pick[1]) && /^Sport$/.test(pick[2]), pick.slice(0, 5).join(' | '));
    const done = await ev(() => { UI.press('down'); UI.press('ok'); UI.press('down'); UI.press('ok'); const l = UI.menuLabels; UI.press('up'); UI.press('up'); UI.press('ok'); return l; });
    ok('ticking two groups offers to merge them', /^Merge 2 groups into Sports/.test(done[0]) && /^✓ Sport/.test(done[1]) && /^✓ Sport/.test(done[2]), done.slice(0, 3).join(' | '));
    await tv.waitForTimeout(500);
    const after = await ev(() => ({ ids: Library.groups().map((g) => g.id), sp: Library.channels('x2').length, via: Library.channels('x10').length, name: Library.groupName('x10'), m: Store.edits.groupMerge }));
    ok('merged: the two groups leave the list, their channels are in Sports', !after.ids.includes('x10') && !after.ids.includes('x12') && after.sp === before.sp + before.s10 + before.s12, JSON.stringify(after));
    ok('a merged group opens as the group it is in, by its name', after.via === after.sp && after.name === 'Sports', JSON.stringify(after));
    const hid = await ev(() => { Library.hideGroup('x2', true); const k = Library.channels('x10', true)[Library.channels('x10', true).length - 1].k; const inAll = Library.channels(Library.ALL).some((c) => c.k === k); Library.hideGroup('x2', false); return inAll; });
    ok('hiding the group hides the channels merged into it too (All channels)', hid === false);
    const sm = await ev(() => { Views.groupMenu(Library.groups().find((g) => g.id === 'x2')); const l = UI.menuLabels; UI.press('back'); return l; });
    ok('and it offers to split back into 3 groups', sm.some((l) => /^Split back into 3 groups/.test(l)), sm.join(' | '));
    await ev(() => { Library.splitGroup('x2'); Views.refreshLists(true); });
    const back = await ev(() => ({ ids: Library.groups().map((g) => g.id), sp: Library.channels('x2').length }));
    ok('split: the groups are back as they were', back.ids.includes('x10') && back.ids.includes('x12') && back.sp === before.sp, JSON.stringify(back));

    // ---- in the web editor ----
    await ev(() => WebEdit.stop()); await tv.waitForFunction(() => window.Net && Net.port, null, { timeout: 30000 });
    const st = await ev(() => WebEdit.start()); const pw = await ev(() => WebEdit.password());
    const ed = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    const eerr = []; ed.on('pageerror', (e) => eerr.push(e.message));
    await ed.goto('http://127.0.0.1:' + st.port + '/'); await ed.waitForTimeout(800);
    await ed.fill('#pw', pw); await ed.click('#loginBtn'); await ed.waitForTimeout(2500);
    await ed.click('#nav [data-page=gc]'); await ed.waitForTimeout(800);
    await ed.hover('#glist .g[data-id="x2"]'); await ed.click('#glist [data-gmore="x2"]', { force: true }); await ed.waitForTimeout(300);
    await ed.locator('#menu .pick', { hasText: 'Merge groups into this' }).click(); await ed.waitForTimeout(400);
    const first = await ed.evaluate(() => [].map.call(document.querySelectorAll('#mgList b'), (x) => x.textContent).slice(0, 2));
    ok('the editor lists the groups with a word in common first', first[0] === 'Sport' && first[1] === 'Sport', first.join(' | '));
    await ed.locator('#mgList input[data-mg="x10"]').check(); await ed.waitForTimeout(200);
    await ed.click('#mgGo'); await ed.waitForTimeout(500);
    const gl = await ed.evaluate(() => ({ x10: !!document.querySelector('#glist .g[data-id="x10"]'), badge: (document.querySelector('#glist .g[data-id="x2"]') || {}).textContent }));
    ok('the editor shows Sports with the merged group, not the merged group itself', !gl.x10 && /\+1 merged/.test(gl.badge), JSON.stringify(gl));
    await ed.click('#cbSend'); await ed.waitForFunction(() => /on the TV|Everything is on the TV/.test(document.getElementById('status').innerText), null, { timeout: 25000 }); await tv.waitForTimeout(800);
    const tvm = await ev(() => ({ m: Store.edits.groupMerge, ids: Library.groups().map((g) => g.id) }));
    ok('sent: the TV shows them merged', tvm.m.x10 === 'x2' && !tvm.ids.includes('x10'), JSON.stringify(tvm));
    ok('no editor page errors', !eerr.length, eerr.join(' | '));
    await ev(() => { Library.splitGroup('x2'); });
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all merge group checks passed');
  process.exit(fails ? 1 : 0);
})();
