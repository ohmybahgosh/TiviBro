/* The 0.6 alpha 17 features in the real app:
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/features.js [--shots dir]
   Search with filters and future programmes, the watchlist (from Search, the guide and Settings),
   Recently added channels after a reload, moving a channel inside a provider group, the audio and
   subtitle language settings, held arrows speeding up, and the speed test. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 240) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => Epg.status && Epg.status.at > 0 && !Epg.loading, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const ev = (f, a) => page.evaluate(f, a);
  const H = R.helpers(page);
  const key = async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 350 : w); };
  // Settings section by name, a step at a time (the shared helper hurries and can overshoot).
  const section = async name => {
    await ev(() => { if (UI.modalOpen) UI.close(); Views.switchTab('settings'); Settings.reset(); Settings.open(); }); await page.waitForTimeout(700);
    for (let i = 0; i < 14; i++) {
      const cur = await ev(() => (document.querySelector('#setNav .on') || {}).innerText || '');
      if (cur === name) break;
      const names = await ev(() => [].map.call(document.querySelectorAll('#setNav > div'), d => d.innerText.trim()));
      await key(names.indexOf(cur) > names.indexOf(name) ? 'ArrowUp' : 'ArrowDown', 300);
    }
    await key('ArrowRight', 700);
  };

  /* ---------- search: future programmes, filters ---------- */
  // A title that is on later today on some channel.
  const later = await ev(() => { const r = Search.find('', {}).filter(x => x.p.s > Date.now() + 3600e3 && x.p.t.length > 4)[0]; return r && r.p.t; });
  ok('the guide has programmes to come', !!later, later);
  const word = later.split(/[^A-Za-z0-9]+/).filter(w => w.length > 3)[0];
  const all = await ev(w => Search.find(w).map(r => ({ t: r.p.t, s: r.p.s, k: r.c.k })), word);
  const now = Date.now();
  ok('find: upcoming programmes are found, soonest first', all.some(r => r.s > now) && all.filter(r => r.s > now).every((r, i, a) => !i || a[i - 1].s <= r.s), all.length);
  ok('find: one entry per programme, not one per copy of the channel', new Set(all.map(r => r.t + '|' + r.s)).size === all.length);
  await ev(() => Views.switchTab('search')); await page.waitForTimeout(600);
  await page.keyboard.type(word); await page.waitForTimeout(900);
  const chips = await page.innerText('.search-chips');
  ok('search shows filter chips', /Everything/.test(chips) && /Coming up/.test(chips) && /Replays/.test(chips), chips.replace(/\s+/g, ' '));
  await key('ArrowDown'); await key('ArrowRight'); await key('ArrowRight', 900);   // Everything > On now > Coming up
  const rows = await page.innerText('.search-list');
  ok('Coming up: only programmes still to come', /upcoming|reminder set/.test(rows) && !/on now|replay|channel\n/.test(rows), rows.replace(/\s+/g, ' ').slice(0, 200));
  ok('rows say Today or Tomorrow', /(Today|Tomorrow) \d/.test(rows));
  await shot('tv-search-later');
  await key('ArrowDown'); const before = await ev(() => Store.edits.reminders.length);
  await key('Enter', 600);
  ok('OK on an upcoming programme sets a reminder', (await ev(() => Store.edits.reminders.length)) === before + 1);
  ok('and the row says so', /reminder set/.test(await page.innerText('.search-list .row.sel')));
  await key('Enter', 600);
  ok('OK again cancels it', (await ev(() => Store.edits.reminders.length)) === before);

  /* ---------- watchlist ---------- */
  await ev(() => UI.press('yellow')); await page.waitForTimeout(800);
  const wl = await ev(() => Watch.list().map(w => w.q));
  ok('Yellow in Search adds what was typed to the watchlist', wl.length === 1 && wl[0].toLowerCase() === word.toLowerCase(), wl.join());
  const rem = await ev(() => Store.edits.reminders.filter(r => r.w).map(r => r.t));
  ok('the watchlist set reminders for what is coming up', rem.length > 0 && rem.every(t => new RegExp('(^|[^a-z0-9])' + word.toLowerCase() + '($|[^a-z0-9])').test(t.toLowerCase())), rem.slice(0, 3).join(' | '));
  const n1 = rem.length;
  await ev(() => Watch.scan(false)); await page.waitForTimeout(300);
  ok('looking again does not set them twice', (await ev(() => Store.edits.reminders.filter(r => r.w).length)) === n1);
  // A cancelled reminder stays cancelled.
  ok('a busy word waits with at most 5 reminders', n1 <= 5, n1);
  const cancelled = await ev(() => { const i = Store.edits.reminders.findIndex(r => r.w), r = Store.edits.reminders[i]; Store.edits.reminders.splice(i, 1); Watch.scan(false); return r.k + '|' + r.s; });
  ok('a reminder you cancel does not come back', await ev(g => !Store.edits.reminders.some(r => r.k + '|' + r.s === g), cancelled));
  ok('whole words only', await ev(() => { Watch.add('Zzq'); const n = Watch.upcoming('Zzq').length; Watch.remove('Zzq'); return n === 0; }));
  // Settings > Guide, start screen, reminders > Watchlist
  await section('Guide, start screen, reminders'); await H.row('Watchlist'); await H.quiet('Enter', 900);
  const wpage = await page.innerText('#setBody');
  ok('the Watchlist settings page lists the word and what is coming up', new RegExp(word, 'i').test(wpage) && /Coming up/.test(wpage) && /Look ahead/.test(wpage), wpage.replace(/\s+/g, ' ').slice(0, 260));
  await shot('tv-set-watchlist');
  await ev(w => Watch.remove(Watch.list()[0].q), word);
  ok('removing a word takes its reminders with it', (await ev(() => Store.edits.reminders.filter(r => r.w).length)) === 0 && (await ev(() => Watch.list().length)) === 0);
  // From the guide's programme menu.
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(1500);
  await key('ArrowRight', 500); await key('ArrowRight', 500); await key('ArrowRight', 500);
  await ev(() => UI.press('red')); await page.waitForTimeout(600);
  const gm = await page.innerText('#modal');
  ok('the guide\'s programme menu offers Other showings and Add to watchlist', /Other showings/.test(gm) && /Add to watchlist/.test(gm), gm.replace(/\s+/g, ' ').slice(0, 260));
  await shot('tv-guide-menu');
  await key('Escape', 400);

  /* ---------- recently added ---------- */
  // As if three channels were not there at the last load.
  const gone = await ev(() => { const d = Library.data, out = d.channels.slice(3, 6).map(c => c.k); Library.set(Object.assign({}, d, { channels: d.channels.filter(c => out.indexOf(c.k) < 0) })); return out; });
  await ev(() => App.refresh(false));
  const ng = await ev(() => { const g = Library.groups().find(g => g.id === Library.NEW); return g && { n: g.count, keys: Library.channels(Library.NEW).map(c => c.k) }; });
  ok('channels that arrive on a reload are in Recently added', ng && ng.n === 3 && ng.keys.every(k => gone.indexOf(k) >= 0), JSON.stringify(ng));
  await ev(() => { Views.switchTab('live'); Views.group = Library.NEW; Views.refreshLists(true); }); await page.waitForTimeout(1000);
  ok('and tagged NEW in the list', /NEW/.test(await page.innerText('#chanList')));
  await shot('tv-recently-added');
  await ev(() => App.refresh(false)); await page.waitForTimeout(2500);
  ok('a reload that changes nothing keeps them', await ev(() => Library.channels(Library.NEW).length > 0));

  /* ---------- moving a channel in a provider group ---------- */
  const g = await ev(() => { const g = Library.groups().find(x => !Library.isVirtual(x.id) && !Library.isCustom(x.id) && Library.channels(x.id).length > 4); return g.id; });
  await ev(g => { Views.switchTab('live'); Views.group = g; Views.refreshLists(false); Views.setZone('channels'); }, g); await page.waitForTimeout(800);
  const order0 = await ev(g => Library.channels(g).map(c => c.k), g);
  await ev(() => UI.press('red')); await page.waitForTimeout(500);
  await H.pick('Move…', '', 600);
  ok('Move… puts the channel in move mode', await ev(() => !!document.querySelector('#chanList .row.moving')));
  await shot('tv-move');
  await key('ArrowDown'); await key('ArrowDown'); await key('Enter', 600);
  const order1 = await ev(g => Library.channels(g).map(c => c.k), g);
  ok('two down and OK: the channel moved two places', order1[2] === order0[0] && order1[0] === order0[1], order1.slice(0, 4).join());
  ok('the provider group now has your order', await ev(g => Library.hasOwnOrder(g), g));
  await ev(() => UI.press('left')); await page.waitForTimeout(300);
  await ev(() => UI.press('red')); await page.waitForTimeout(500);
  await H.pick('Back to the provider', '', 600);
  ok('and can go back to the provider\'s order', (await ev(g => Library.channels(g).map(c => c.k).join(), g)) === order0.join());

  /* ---------- held arrows speed up ---------- */
  await ev(() => { Views.group = Library.ALL; Views.refreshLists(false); Views.setZone('channels'); }); await page.waitForTimeout(600);
  const s0 = +(await ev(() => document.querySelector('#chanList .row.sel .num').textContent));
  for (let t = Date.now(); Date.now() - t < 3200;) { await page.keyboard.down('ArrowDown'); await page.waitForTimeout(33); }
  await page.keyboard.up('ArrowDown'); await page.waitForTimeout(300);
  const moved = await ev(() => document.querySelector('#chanList .row.sel .num').textContent);
  ok('holding Down for 3 seconds goes a long way', +moved - s0 > 60, moved);

  /* ---------- audio and subtitles ---------- */
  await section('Playback and buffering'); await H.row('Audio language'); await H.quiet('Enter', 600);
  await H.pick('Spanish', '', 500);
  ok('audio language is saved', await ev(() => Store.settings.audioLang === 'es'));
  await H.row('Subtitles automatically'); await H.quiet('Enter', 600);
  await H.pick('English only', '', 500);
  ok('subtitles in one language', await ev(() => Store.settings.autoSubs === true && Store.settings.subsLang === 'en'));
  const pb = await page.innerText('#setBody');
  ok('the Playback page shows both', /Audio language[\s\S]*Spanish/.test(pb) && /Subtitles automatically[\s\S]*English/.test(pb), pb.replace(/\s+/g, ' ').slice(0, 200));
  await shot('tv-set-audio');

  /* ---------- speed test ---------- */
  await section('Diagnostics'); await H.row('Speed test'); await H.quiet('Enter', 500);
  await page.waitForFunction(() => /Done\./.test((document.querySelector('.diag-body') || {}).innerText || ''), null, { timeout: 60000 }).catch(() => {});
  const sp = await page.innerText('.diag');
  ok('the speed test reports the provider\'s speed', /Provider: [\d.]+ Mbps|Live channel: [\d.]+ Mbps/.test(sp), sp.replace(/\s+/g, ' ').slice(0, 300));
  ok('and finishes', /Done\./.test(sp));
  await shot('tv-speedtest');
  await key('Escape', 400);

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failure(s)' : 'all feature checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL harness: ' + e.message); process.exit(1); });
