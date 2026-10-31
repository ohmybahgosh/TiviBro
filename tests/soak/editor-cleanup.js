/* Web editor fixes found on a real TV and phone (alpha 23):
     node tests/soak/editor-cleanup.js      (the app on :8078 with the dev relay, mock provider on :8077)
   Smart clean-up as a checklist (done, skipped, to do, and a badge that agrees), tick all / untick all
   countries, numbered event channels not taken for copies and a clear Keep / Hide / Keep all, the
   local city pick remembered and national feeds kept out of "Local channels", adult groups, shorter
   group names, Start over, the Watchlist page, recommended guides that know they were added, and a
   dropdown that stays open on a phone. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); const errs = []; tv.on('pageerror', e => errs.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await tv.waitForTimeout(3000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  await tv.evaluate(() => WebEdit.start()); await tv.waitForTimeout(2500);
  const st = await tv.evaluate(() => WebEdit.status), pw = await tv.evaluate(() => WebEdit.password());
  const URL = 'http://127.0.0.1:' + st.port + '/#k=' + pw;
  const ed = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); ed.on('pageerror', e => errs.push('editor: ' + e.message));
  await ed.goto(URL + '/tools'); await ed.waitForFunction(() => window.D && D.channels && D.channels.length, null, { timeout: 30000 }); await ed.waitForTimeout(1000);
  const ev = (f, a) => ed.evaluate(f, a);
  const send = async () => { await ev(() => send()); await ed.waitForTimeout(3500); };

  // Smart clean-up checklist.
  ok('the page says how many steps are done', /of \d+<\/b> done/.test(await ev(() => document.getElementById('toolsProg').innerHTML)));
  const todo = await ev(() => TOOLS.filter(t => !toolDone(t[0])).map(t => t[0]));
  ok('steps with work left are marked To do', todo.length && await ev(ids => ids.every(id => /To do/.test(document.getElementById(TOOLS.find(t => t[0] === id)[1]).querySelector('h3').textContent)), todo), todo.join());
  const badge0 = +(await ev(() => document.getElementById('toolsBadge').textContent));
  ok('the menu badge counts the same steps', badge0 === todo.length, badge0 + ' vs ' + todo.length);
  await ed.click('[data-tskip="' + todo[0] + '"]'); await ed.waitForTimeout(400);
  const sk = await ev(id => ({ h: document.getElementById(TOOLS.find(t => t[0] === id)[1]).querySelector('h3').textContent, b: document.getElementById('toolsBadge').textContent }), todo[0]);
  ok('Skip marks a step Skipped and takes it off the badge', /Skipped/.test(sk.h) && +(sk.b || 0) === badge0 - 1, JSON.stringify(sk));
  await send();
  ok('skips are saved on the TV', await tv.evaluate(id => !!(Store.edits.toolSkip || {})[id], todo[0]));

  // Countries: tick all / untick all.
  await ed.click('[data-ccset="0"]'); await ed.waitForTimeout(300);
  ok('Untick all unticks every country', await ev(() => [...document.querySelectorAll('[data-cc]')].every(i => !i.checked)));
  await ed.click('[data-ccset="1"]'); await ed.waitForTimeout(300);
  ok('Tick all ticks them again', await ev(() => [...document.querySelectorAll('[data-cc]')].every(i => i.checked)));

  // Duplicates: Keep / Hide, never "unmarked", and Keep all.
  const dup = await ev(() => { dupeOpts.show = 'all'; renderTools(); const d = document.querySelector('.dset'); return d ? d.textContent : ''; });
  if (dup) {
    ok('a set says Keep and Hide, not "unmarked"', /Keep/.test(dup) && /Hide/.test(dup) && !/unmarked/i.test(dup), dup);
    const before = await ev(() => dupeTarget().length);
    await ed.click('.dset .dskip'); await ed.waitForTimeout(300);
    ok('Keep all leaves that set out of the hide button', await ev(() => dupeTarget().length) === before - 1);
  }

  // Adult groups and shorter group names (an adult group added the way a provider would send it).
  await ev(() => { D.groups.push({ id: 'xx1', name: 'XXX Adult' }); byGroup.set('xx1', []); renderTools(); });
  ok('an adult group is found', /XXX Adult/.test(await ev(() => document.getElementById('tAdult').textContent)));
  await ed.click('#adGo'); await ed.waitForTimeout(300);
  ok('Hide hides it', await ev(() => !!E.hiddenGroups.xx1));
  await ev(() => { D.groups.pop(); byGroup.delete('xx1'); delete E.hiddenGroups.xx1; renderTools(); });
  // Names the way some providers send them, with no separator ("USA News"): the clean-up leaves those.
  await ev(() => { ['USA News', 'USA Kids', 'USA Sports'].forEach((n, i) => { D.groups.push({ id: 'ux' + i, name: n }); byGroup.set('ux' + i, []); }); renderTools(); });
  const pre = await ev(() => groupPrefixes().map(x => x.p));
  ok('a word most group names start with is offered', pre.indexOf('USA') >= 0, pre.join());
  await ed.click('[data-gpre="USA"]'); await ed.waitForTimeout(300);
  ok('taking it off renames those groups', await ev(() => E.groupRenames.ux0 === 'News' && E.groupRenames.ux2 === 'Sports'), await ev(() => JSON.stringify(E.groupRenames)));
  await ev(() => { [0, 1, 2].forEach(i => { D.groups.pop(); byGroup.delete('ux' + i); delete E.groupRenames['ux' + i]; }); renderTools(); });

  // Local channels: national feeds stay out of the group; the pick is remembered.
  await ev(() => { renderTools.local = null; renderTools(); });
  const city = await ev(() => localIndex().cities[0].city);
  await ed.click('[data-city="' + city + '"]'); await ed.waitForTimeout(200);
  await ed.click('#lcGo'); await ed.waitForTimeout(400);
  const grp = await ev(() => { const g = E.custom.find(x => x.name === 'Local channels'); const by = {}; localIndex().chans.forEach(x => { by[x.c.k] = x.p.city; }); return g ? g.items.map(k => by[k]) : null; });
  ok('only that city\'s stations go into Local channels', grp && grp.length && grp.every(c => c === city), JSON.stringify(grp));
  await ev(() => { renderTools.local = null; renderTools(); });
  ok('coming back, the city is still ticked', await ev(c => !!renderTools.local.sel[c] && /earlier pick/.test(document.getElementById('tLocal').textContent), city));
  ok('the city search box does not use a city of yours as its example', !/Lansing/.test(await ev(() => document.getElementById('lcQ').placeholder)));

  // Watchlist has a page of its own.
  await ed.click('#nav button[data-page=watch]'); await ed.waitForTimeout(500);
  ok('the Watchlist page shows its form', await ev(() => !document.getElementById('p-watch').classList.contains('hidden') && !!document.getElementById('wText').offsetParent));

  // Guide page: jump links; recommended guides know what's added.
  await ed.click('#nav button[data-page=guide]'); await ed.waitForTimeout(800);
  ok('the guide page has jump links to each step', await ev(() => document.querySelectorAll('#p-guide .jump [data-jump]').length === 4));
  const url = await ev(() => CATALOG.find(c => c[0] === 'us' && c[3] > 0)[2]);
  await tv.evaluate(u => { Store.playlist.epgSources = [{ url: u, offset: 0 }, { url: 'http://user:pw@example.com/xmltv.php?username=a&password=b', offset: 0 }]; Store.upsertPlaylist(Store.playlist); WebEdit.push && WebEdit.push(true); }, url);
  await ed.waitForTimeout(4000); await ev(() => load(true)); await ed.waitForTimeout(1500); await ev(() => { document.getElementById('catBox').open = true; renderGuide(); });
  const srcs = await ev(() => document.getElementById('srcList').textContent);
  ok('an added free guide shows its name, not just the server', /epgshare01|iptv-epg/.test(srcs) && /\(/.test(srcs), srcs);
  ok('a source with a login shows no login', !/pw|password|username/.test(srcs), srcs);
  ok('the added guide shows Added and Remove instead of Add', await ev(u => { const r = [...document.querySelectorAll('#catList tr')].find(tr => tr.textContent.indexOf(u) >= 0); return !!r && /Added/.test(r.textContent) && !!r.querySelector('[data-catrm]') && !r.querySelector('[data-catadd]'); }, url));
  await tv.evaluate(() => { Store.playlist.epgSources = []; Store.upsertPlaylist(Store.playlist); });

  // Start over.
  await ed.click('#nav button[data-page=history]'); await ed.waitForTimeout(500);
  await ed.click('#hReset'); await ed.waitForTimeout(300);
  await ed.click('#modal .primary, #modal button.danger:not(.ghost)').catch(() => {}); await ed.waitForTimeout(400);
  ok('Start over clears every change in the editor', await ev(() => !Object.keys(E.hiddenGroups).length && !Object.keys(E.groupRenames).length && E.custom.every(g => !g.items.length)), await ev(() => JSON.stringify({ h: Object.keys(E.hiddenGroups).length, r: Object.keys(E.groupRenames).length })));
  ok('and can be undone', await ev(() => hist.length && /Reset this playlist/.test(hist[hist.length - 1].label)));
  ok('undoing the undo is offered after Go back', await ev(() => { undo(); renderHistory(); return /Undo the undo/.test(document.getElementById('hList').textContent); }));

  // A phone: the dropdown stays open while the keyboard would come up.
  const ph = await (await b.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true })).newPage(); ph.on('pageerror', e => errs.push('phone: ' + e.message));
  await ph.goto(URL + '/guide'); await ph.waitForFunction(() => window.D && D.channels && D.channels.length, null, { timeout: 30000 }); await ph.waitForTimeout(800);
  // "Unsent work from another device?" can come up a moment after loading: close it once it has.
  for (let i = 0; i < 10; i++) { await ph.waitForTimeout(300); await ph.evaluate(() => { if (document.getElementById('modal') && typeof closeModal === 'function') closeModal(); }); }
  ok('the phone menu button says Menu', /Menu/.test(await ph.evaluate(() => document.getElementById('navToggle').textContent)));
  await ph.evaluate(() => document.getElementById('mGroup').scrollIntoView({ block: 'center' })); await ph.waitForTimeout(300);
  await ph.tap('#mGroup button'); await ph.waitForTimeout(150);
  await ph.setViewportSize({ width: 412, height: 520 }); await ph.waitForTimeout(400);        // the keyboard coming up
  ok('the dropdown stays open on a phone', await ph.evaluate(() => !!document.querySelector('.ddm')));

  // Leave nothing unsent: the next editor test would open to "unsent work from another device?".
  await send();
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all editor clean-up checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
