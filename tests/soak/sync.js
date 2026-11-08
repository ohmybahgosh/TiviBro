/* The TV and the web editor (and the phone app's copy of it) agree on what's hidden, whoever changed it last.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/sync.js
   - A save from the editor puts only its own changes on top of the TV's state: a group hidden (or shown
     again) on the TV a moment before, which the editor never saw, stays that way.
   - Something hidden on the TV reaches the editor within a couple of seconds.
   - Settings > Channels and groups: hidden groups and channels are pages of their own (short page, phone
     too), and the set-up tour's clean-up steps are there one at a time (Tidy up), Apply doing only that step. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; tv.on('pageerror', (e) => errs.push('tv: ' + e.message));
  // The playlist read afresh (the helper keeps the last one, maybe from a mock without East and West feeds).
  await tv.addInitScript(R.init({ time: R.primeTime(), settings: { playlists: [Object.assign({}, R.SETTINGS.playlists[0], { plRefresh: -1 })] } })[0]);
  await tv.goto(APP);
  await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await tv.waitForTimeout(2000);
  await tv.waitForFunction(() => Library.data.channels.some((c) => / \(WEST\)/.test(c.n)), null, { timeout: 45000 }).catch(() => {}); await tv.waitForTimeout(1000);
  const T = (f, a) => tv.evaluate(f, a);
  try {
    await T(() => WebEdit.stop()); await tv.waitForTimeout(300);
    const st = await T(() => WebEdit.start());
    const pw = await T(() => WebEdit.password());
    const ed = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    ed.on('pageerror', (e) => errs.push('editor: ' + e.message)); ed.on('dialog', (d) => d.accept());
    await ed.goto('http://127.0.0.1:' + st.port + '/'); await ed.waitForTimeout(800);
    await ed.fill('#pw', pw); await ed.click('#loginBtn');
    await ed.waitForFunction(() => window.D && window.TVREAD, null, { timeout: 15000 });
    const groups = await T(() => Library.data.groups.filter((g) => !Store.edits.hiddenGroups[g.id] && !/US|WEST|Local/i.test(g.name)).map((g) => g.id).slice(1, 6));
    const [mine, theirs, shownOnTv, mine2] = groups;
    // A group hidden earlier, which the editor has read as hidden.
    await T((g) => { Library.hideGroup(g, true); }, shownOnTv);
    await ed.waitForFunction((g) => TVREAD && TVREAD.E.hiddenGroups[g], shownOnTv, { timeout: 10000 });

    // The race: the TV hides one group and shows another again, and in the same moment the editor sends a
    // save made before it could see that (its page is told it's busy sending, so it doesn't read the TV).
    await T(([a, c]) => { Library.hideGroup(a, true); Library.hideGroup(c, false); }, [theirs, shownOnTv]);
    await ed.evaluate((g) => {
      window.sending = true;
      E.hiddenGroups[g] = 1;
      const body = { edits: {}, names: N, base: TVREAD.E, nbase: TVREAD.N };
      FIELDS.forEach((f) => { body.edits[f] = E[f]; });
      return api('/api/save', { method: 'POST', body });
    }, mine);
    await tv.waitForFunction((g) => Store.edits.hiddenGroups[g], mine, { timeout: 15000 }).catch(() => {});
    await tv.waitForTimeout(500);
    const r = await T(([a, b2, c]) => ({ mine: !!Store.edits.hiddenGroups[a], theirs: !!Store.edits.hiddenGroups[b2], shownAgain: !Store.edits.hiddenGroups[c] }), [mine, theirs, shownOnTv]);
    ok('a save from the editor adds its own change', r.mine, JSON.stringify(r));
    ok('and keeps a group hidden on the TV a moment before, that the editor never saw', r.theirs, JSON.stringify(r));
    ok('and keeps a group shown again on the TV a moment before', r.shownAgain, JSON.stringify(r));
    await ed.evaluate(() => { window.sending = false; });

    // The TV's own change reaches the editor quickly.
    const t0 = Date.now();
    await T((g) => Library.hideGroup(g, true), mine2);
    const seen = await ed.waitForFunction((g) => D && D.edits && D.edits.hiddenGroups[g], mine2, { timeout: 10000 }).then(() => Date.now() - t0, () => -1);
    ok('a group hidden on the TV shows in the editor within a few seconds', seen > 0 && seen < 4500, seen + ' ms');
    await T(() => WebEdit.stop());

    // Settings: the hidden lists are pages, the page itself stays short.
    await T(() => { const ks = Library.data.channels.filter((c) => !/US|WEST|ABC|CBS|NBC|PBS/.test(c.n)).slice(0, 40).map((c) => c.k); ks.forEach((k) => Library.hideChannel(k, true)); });
    await T(() => { Views.switchTab('settings'); Settings.open(); Settings.section('channels'); });
    await tv.waitForTimeout(500);
    const page = await T(() => [].map.call(document.querySelectorAll('.opt .ol'), (e) => (e.innerText || '').trim()).filter(Boolean));
    ok('Channels and groups: hidden channels and groups are pages, not 40 rows', page.some((t) => /^Hidden channels/.test(t)) && page.length < 45, page.length + ' rows: ' + page.slice(-12).join(' | '));
    ok('Channels and groups: Tidy up has the tour\'s clean-up steps', ['Keep the countries you watch', 'East or West feeds', 'Your local channels', 'Clear the clutter'].every((x) => page.some((t) => t.indexOf(x) === 0)), page.join(' | '));

    // Tidy up > East or West, from the phone: that step and the summary; Apply hides West feeds only.
    const tidy = await T(() => {
      const before = { g: Object.keys(Store.edits.hiddenGroups).length, c: Object.keys(Store.edits.hiddenChannels) };
      let rows = Tour.phoneRows(Store.playlist.id, 'feeds');
      const title = rows[0].label;
      Tour.choices.feed = 'east';                      // it opens on what's in effect: both feeds shown
      const next = rows.find((x) => x.label === 'Next');
      if (!next) return { title: rows.map((x) => x.label).join(' | ') + ' hidden groups: ' + Object.keys(Store.edits.hiddenGroups).map((id) => Library.groupName(id)).join(', '), sum: '', before };
      next.action();
      rows = Tour.phoneRows(Store.playlist.id, 'feeds');
      const sum = rows.map((x) => x.label + ' ' + (typeof x.value === 'function' ? x.value() : '')).join(' | ');
      rows.find((x) => x.label === 'Apply').action();
      return { title, sum, before };
    });
    await tv.waitForTimeout(1500);
    const after = await T((before) => {
      const added = Object.keys(Store.edits.hiddenChannels).filter((k) => before.c.indexOf(k) < 0).map((k) => (Library.find(k) || {}).n || k);
      return { added, groups: Object.keys(Store.edits.hiddenGroups).length - before.g, tour: Store.playlist.tour };
    }, tidy.before);
    ok('Tidy up > East or West: one step, then the summary', /Step 1 of 2/.test(tidy.title) && /East and West/.test(tidy.sum) && !/Countries|Clutter/.test(tidy.sum), tidy.title + ' / ' + tidy.sum);
    ok('Apply hides the West feeds and nothing else', after.added.length > 0 && after.added.every((n) => /WEST/i.test(n)), JSON.stringify(after).slice(0, 300));
  } catch (e) { ok('harness: ' + e.message, false); }
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all sync checks passed');
  process.exit(fails ? 1 : 0);
})();
