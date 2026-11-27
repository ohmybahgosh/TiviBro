/* The Plex tab in a browser, against the stand-in Plex server (tests/mock/mock_plex.js): out of the menu until a
   library is added, then Home with the server's rows in its order (music left out), a library's Plex tabs
   (Recommended, Library, Collections, Categories, Playlists), sort and filters reaching the server, a collection
   opened in place, posters through the helper's door, and screenshots of each.
     MOCK_PORT=8088 node tests/mock/mock_provider.js &
     (cd app && python3 -m http.server 8078 --bind 127.0.0.1) &
     node tests/soak/plex.js            SHOTS=<folder> keeps the screenshots */
'use strict';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : '')); if (!c) fails++; };
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const R = require('../../scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-soak-'));
const proxy = require('../../service/proxy.js');
const PlexHelper = require('../../service/plex.js');
const Mock = require('../mock/mock_plex.js');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'plex-shots-'));

(async () => {
  const m = await new Promise((f) => Mock.start(f));
  m.state.realPng = true;
  PlexHelper._test.loopback(true); PlexHelper._test.setPlexTv('http://127.0.0.1:' + m.port);
  const relay = proxy.create({}); await new Promise((f) => relay.server.listen(47897, '127.0.0.1', f));
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = global.__errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: 'http://127.0.0.1:8088' });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  const base = 'http://127.0.0.1:' + m.port;
  await page.addInitScript((o) => {
    localStorage.setItem('tivibro.devRelay', '47897');
    localStorage.setItem('tivibro.plex', JSON.stringify({ cid: 'tivibro-soak-0001', token: o.tok, user: { name: 'hometheater', pass: true, home: true },
      servers: [{ id: o.machine, name: 'Home server', owned: true, online: true, token: o.st, connections: [{ uri: o.base, address: '127.0.0.1', port: o.port, local: true, relay: false }] }],
      chosen: [o.machine], libs: o.libs ? { [o.machine]: ['1'] } : {}, libInfo: o.libs ? [{ key: '1', title: 'Movies', type: 'movie', server: o.machine }] : [] }));
  }, { tok: Mock.TOKEN, st: Mock.SERVER_TOKEN, machine: Mock.MACHINE, base, port: m.port, libs: !process.env.NO_LIBS });
  await page.goto('http://127.0.0.1:8078/index.html');
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const key = async (a, n) => { for (let i = 0; i < (n || 1); i++) { await ev((x) => UI.press ? UI.press(x) : PlexView._test.keys(x), a); await page.waitForTimeout(150); } };
  const tiles = () => ev(() => [].map.call(document.querySelectorAll('#viewPlex .media-shelf'), (s) => ({ t: s.querySelector('h2').textContent, n: s.querySelectorAll('.media-tile').length })));
  try {
    ok('Plex is in the menu once a library is added', await ev(() => [].some.call(document.querySelectorAll('.tab'), (t) => t.getAttribute('data-tab') === 'plex')));
    await ev(() => Views.switchTab('plex'));
    await page.waitForFunction(() => document.querySelectorAll('#viewPlex .media-tile').length > 3, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const home = await tiles();
    ok('Home: Continue watching first, your Watchlist, then the server\'s rows in its order', home.map((x) => x.t).join('|') === 'Continue watching|Watchlist|Recently Added in Movies|Friday Night Picks', home);
    ok('Home: music left out', !home.some((x) => /Music/.test(x.t)));
    ok('Home: only the movie library\'s titles in Continue watching', home[0].n === 1, home[0]);
    const posters = await ev(() => [].filter.call(document.querySelectorAll('#viewPlex img.media-cover'), (i) => /\/plex\/[0-9a-f]{48}\/photo\//.test(i.src)).length);
    ok('posters come through the helper\'s door, no token in them', posters > 3 && !(await ev(() => /mock-server-token/.test(document.getElementById('viewPlex').innerHTML))), posters);
    ok('the focused title fills the top', /Northbound/.test(await ev(() => document.getElementById('plexHero').innerText + ' ' + ((document.querySelector('#plexHero img.media-logo') || {}).alt || ''))));
    await shot('1-home');
    // The Movies library: Recommended first, then Library with sort and filter.
    await key('up'); await key('right');
    await page.waitForFunction(() => /Recently Released/.test(document.getElementById('plexStage').innerText), null, { timeout: 8000 });
    ok('a library opens on its Recommended tab: the server\'s rows', (await tiles()).map((x) => x.t).join('|') === 'Recently Released|Top Unwatched');
    await shot('2-recommended');
    await key('down'); await key('right');
    await page.waitForFunction(() => /10 titles/.test(document.getElementById('plexStage').innerText), null, { timeout: 8000 });
    ok('Library: every title, six to a row', (await tiles()).map((x) => x.n).join(',') === '6,4');
    ok('Library: newest first by default', /sort=addedAt%3Adesc/.test(m.state.lastAll), m.state.lastAll);
    await shot('3-library');
    await key('down'); await key('red'); await page.waitForTimeout(300);
    ok('Red on Library: sort and filters', (await ev(() => UI.menuLabels.join('|'))).indexOf('Unwatched only') >= 0, await ev(() => UI.menuLabels));
    await ev(() => { UI.press('down'); UI.press('ok'); });
    await page.waitForFunction(() => /7 titles/.test(document.getElementById('plexStage').innerText), null, { timeout: 8000 }).catch(() => {});
    ok('Unwatched only reaches the server', /unwatched=1/.test(m.state.lastAll), m.state.lastAll);
    await ev(() => UI.close && UI.close());
    await key('up', 3); await key('down'); await key('right');
    await page.waitForFunction(() => /Copper Trilogy/.test(document.getElementById('plexStage').innerText), null, { timeout: 8000 });
    await key('down'); await key('ok');
    await page.waitForFunction(() => /Midnight Ferry/.test(document.getElementById('plexStage').innerText), null, { timeout: 8000 });
    ok('a collection opens in place with its movies', (await tiles())[0].n === 3);
    await key('back'); await page.waitForTimeout(500);
    ok('Back returns to the collections', /Copper Trilogy/.test(await ev(() => document.getElementById('plexStage').innerText)));
    await shot('4-collections');
    await key('up'); await key('right'); await page.waitForTimeout(1500);
    ok('Categories: a row a genre, its titles read when reached', (await tiles()).map((x) => x.t).join('|') === 'Drama|Comedy');
    await key('right'); await page.waitForTimeout(1500);
    ok('Playlists', /Movie Marathon/.test(await ev(() => document.getElementById('plexStage').innerText)));
    await shot('5-playlists');
    // Streaming Top 10s: matched by TMDB id (Northbound), not by a lookalike name (Copper Sky is not "Copper Skies").
    await ev(() => { VodHome.top10 = function () { return { date: '2026-11-26', charts: [{ service: 'Netflix', movies: [{ r: 1, t: 'Copper Skies' }, { r: 3, t: 'Northbound', tmdb: 999 }], shows: [] }] }; }; PlexTop._test.reset(); PlexView.open(); PlexView._test.home(); });
    await page.waitForFunction(() => PlexView._test.rows().some((r) => /Streaming Top 10s you have/.test(r.title) && r.items.length), null, { timeout: 15000 });
    const top = await ev(() => { const r = PlexView._test.rows().filter((x) => /Streaming Top 10s/.test(x.title))[0]; return { names: r.items.map((m) => m.title), line: r.line(r.items[0]), html: document.getElementById('plexStage').innerText }; });
    ok('Streaming Top 10s you have: the Plex titles on the charts, matched by TMDB id', JSON.stringify(top.names) === '["Northbound"]', top);
    ok('"#3 on Netflix" under its poster', top.line === '#3 on Netflix' && /#3 on Netflix/.test(top.html), top);
    const searches = m.state.searches;
    await ev(() => PlexView.resume()); await page.waitForTimeout(1500);
    ok('the matches are kept: no new searches the second time', m.state.searches === searches, [searches, m.state.searches]);
    await ev(() => { Plex.setPref('topServices', ['Netflix']); PlexView.resume(); }); await page.waitForTimeout(1500);
    ok('a Top 10 on Netflix row when picked', (await ev(() => PlexView._test.rows().map((r) => r.title))).indexOf('Top 10 on Netflix') >= 0);
    await shot('5b-top10');
    ok('the Watchlist row: the titles on your Plex Watchlist that your servers have', JSON.stringify(await ev(() => (PlexView._test.rows().filter((r) => r.title === 'Watchlist')[0] || { items: [] }).items.map((x) => x.title))) === '["Northbound"]');
    // Edit home rows: one turned off, then all back.
    const homeT = await ev(() => PlexView.homeTitles());
    await ev((t) => { Plex.setPref('hiddenRows', { [t]: 1 }); PlexView.resume(); }, homeT[homeT.length - 1]); await page.waitForTimeout(1500);
    ok('Edit home rows: a row turned off is gone', (await ev(() => PlexView._test.rows().map((r) => r.title))).indexOf(homeT[homeT.length - 1]) < 0);
    await ev(() => { Plex.setPref('hiddenRows', {}); Plex.setPref('topServices', []); PlexView.resume(); }); await page.waitForTimeout(1500);
    // Moving along a row keeps the row's posters as they are (no rebuild), and the hero shows the title's logo.
    const keep = await ev(() => { window.__tile = document.querySelector('#plexStage .media-tile'); PlexView._test.keys('right'); return document.querySelector('#plexStage .media-tile') === window.__tile; });
    ok('◀ ▶ along a row: the posters stay, nothing is drawn again', keep);
    await page.waitForFunction(() => document.querySelector('#plexHero img.media-logo'), null, { timeout: 8000 }).catch(() => {});
    ok('the hero shows the title\'s logo (Plex\'s clearLogo)', (await ev(() => !!document.querySelector('#plexHero img.media-logo'))) && m.state.logo);
    await page.waitForFunction(() => document.querySelector('#viewPlex > .plex-art.on'), null, { timeout: 8000 }).catch(() => {});
    ok('a blurred backdrop behind it all (the layer showing)', /blur=36/.test(await ev(() => (document.querySelector('#viewPlex > .plex-art.on .plex-bg') || { style: {} }).style.backgroundImage)));
    const glide = await ev(() => {
      let down = 0;
      while (PlexView._test.rows()[down] && PlexView._test.rows()[down].items.length < 2) down++;
      for (let i = 0; i < down; i++) PlexView._test.keys('down');
      const r = document.querySelector('#plexStage .media-shelf.active .plex-ring'), a = r.style.transform;
      PlexView._test.keys('right'); const b = r.style.transform; PlexView._test.keys('left');
      for (let i = 0; i < down; i++) PlexView._test.keys('up');
      return [a, b, PlexView._test.zone()];
    });
    ok('the focus ring glides to the next poster (one ring per row, moved, not redrawn)', /translate3d/.test(glide[0]) && glide[0] !== glide[1], glide);
    await ev(() => UI.press('hold')); await page.waitForTimeout(1200);
    const hold = await ev(() => UI.menuLabels);
    ok('hold OK on a title: its options', hold.indexOf('Details') >= 0 && hold.some((l) => /^Resume from|^Play$/.test(l)) && hold.indexOf('Remove from Watchlist') >= 0, hold);
    await ev(() => UI.press('back')); await page.waitForTimeout(300);
    await shot('5c-hero');
    // The Top 10 tab: a pill per service, its movies and its shows that your Plex has, in the chart's order.
    const t10 = await ev(() => { const tabs = PlexView._test.tabs(); return tabs.map((t) => t.id).indexOf('top'); });
    ok('a Top 10 tab once there are charts', t10 > 0);
    await ev((i) => { PlexView._test.tab(i); }, t10); await page.waitForTimeout(1500);
    const chart = await ev(() => ({ subs: document.getElementById('plexSubs').innerText, rows: PlexView._test.rows().map((r) => r.title + ':' + r.items.map((m) => r.line(m) + ' ' + m.title).join(',')) }));
    ok('Top 10: every service on one page, the chart\'s movies you have with their place', chart.rows[0] === 'Top 10 movies on Netflix:#3 Northbound', JSON.stringify(chart));
    await shot('5d-top10-tab');
    await ev(() => PlexView._test.home()); await page.waitForTimeout(1200);
    // A movie's page and playing it.
    await ev(() => { PlexView._test.home(); }); await page.waitForTimeout(1500);
    await page.waitForFunction(() => (PlexView._test.focused() || {}).title === 'Northbound', null, { timeout: 8000 });
    await key('ok');
    await page.waitForFunction(() => { var p = document.getElementById('plexPage'); return p && !p.classList.contains('hidden') && /Resume from/.test(p.innerText); }, null, { timeout: 8000 });
    const pg = await ev(() => document.getElementById('plexPage').innerText);
    ok('the page: Resume from where you stopped, Play from the start, Trailer', /Resume from 40:00/.test(pg) && /Play from the start/.test(pg) && /Trailer/.test(pg), pg);
    ok('the page: Dolby Vision, 4K, Atmos and the scores', /Dolby Vision/.test(pg) && /4K/.test(pg) && /Atmos/.test(pg) && /Critics 92%/.test(pg), pg);
    await shot('6-movie');
    ok('the page is the title picked', (await ev(() => PlexPage._test.item().title)) === 'Northbound');
    // Its rows, as Plex shows them: Cast and crew, the collection's other titles, More like this.
    await page.waitForFunction(() => PlexPage._test.shelf(), null, { timeout: 8000 }).catch(() => {});
    const prow = await ev(() => (PlexPage._test.shelf() || { rows: [] }).rows.map((r) => r.title + ':' + r.items.length));
    ok('the page\'s rows: Cast and crew, Extras, More in the collection, More like this', JSON.stringify(prow) === JSON.stringify(['Cast and crew:3', 'Extras:1', 'More in The Copper Trilogy:3', 'More like Northbound:2']), prow);
    const keepPage = await ev(() => { const b = document.getElementById('plexPageBtns'); PlexPage._test.keys('right'); PlexPage._test.keys('left'); return document.getElementById('plexPageBtns') === b; });
    ok('◀ ▶ on the buttons doesn\'t draw the page again', keepPage);
    await ev(() => PlexPage._test.keys('down')); await page.waitForTimeout(500);
    await shot('6b-page-rows');
    ok('▼ scrolls the rows into view', /translateY\(-/.test(await ev(() => document.getElementById('plexPageScroll').style.transform)));
    // Hold OK on a title in a row: its options, as on the Plex tab.
    await ev(() => { PlexPage._test.keys('down'); PlexPage._test.keys('down'); PlexPage._test.keys('hold'); }); await page.waitForTimeout(900);
    const holdRows = await ev(() => UI.menuLabels || []);
    ok('hold OK on a title in a row: its options', holdRows.some((x) => /^(Play|Resume from)/.test(x)), holdRows);
    await ev(() => { UI.press('back'); PlexPage._test.keys('up'); PlexPage._test.keys('up'); }); await page.waitForTimeout(300);
    // OK on a person: their titles; Back comes back to the page as it was.
    await ev(() => PlexPage._test.keys('ok')); await page.waitForTimeout(1200);
    const person = await ev(() => ({ hidden: document.getElementById('plexPage').classList.contains('hidden'), rows: PlexView._test.rows().map((r) => r.title) }));
    ok('OK on a person: their titles in the library', person.hidden && person.rows.length > 0, person);
    await ev(() => PlexView._test.keys('back')); await page.waitForTimeout(500);
    const backTo = await ev(() => ({ shown: !document.getElementById('plexPage').classList.contains('hidden'), title: PlexPage._test.item().title, row: PlexPage._test.shelf().row }));
    ok('Back from a person\'s titles: the page again, on the same row', backTo.shown && backTo.title === 'Northbound' && backTo.row === 0, backTo);
    await ev(() => PlexPage._test.keys('up'));
    // More > Remove from Watchlist (it's on it), through Plex's catalogue with its key.
    await ev(() => { PlexPage._test.keys('red'); }); await page.waitForTimeout(400);
    const moreRows = await ev(() => UI.menuLabels);
    ok('More: Remove from Watchlist for a title on it', moreRows.indexOf('Remove from Watchlist') >= 0, moreRows);
    await ev((n) => { for (let i = 0; i < n; i++) UI.press('down'); UI.press('ok'); }, moreRows.indexOf('Remove from Watchlist')); await page.waitForTimeout(800);
    ok('…sent to Plex with the title\'s catalogue key', /removeFromWatchlist\?ratingKey=5d776b59ad5437001f79c6f8/.test(m.state.watchlisted || ''), m.state.watchlisted);
    await key('ok'); await page.waitForTimeout(2500);
    const src = await ev(() => (Views.vod && Views.vod.url) || '');
    ok('Resume plays the file through the door', /\/plex\/[0-9a-f]{48}\/library\/parts\/7\/1700000000\/file\.mkv$/.test(src), src);
    ok('Plex\'s intro and credits markers go to Skip intro', JSON.stringify(await ev(() => Views.vodMeta && Views.vodMeta.marks)) === JSON.stringify({ intro: [5, 65], recap: null, credits: 6900, creditsEnd: -1 }));
    await page.waitForTimeout(10500);
    ok('where you are goes to Plex', /ratingKey=18/.test(m.state.timeline || '') && /state=(playing|paused)/.test(m.state.timeline || ''), m.state.timeline);
    ok('Plex\'s chapters go to the player', JSON.stringify(await ev(() => Views.vodMeta && Views.vodMeta.chapters)) === JSON.stringify([{ s: 0, e: 600, t: 'Opening' }, { s: 600, e: 7200, t: 'The ferry' }]));
    const pic = await ev(() => Views.vodMeta && Views.vodMeta.pics ? Views.vodMeta.pics(125) : '');
    ok('seek previews come from the server\'s own pictures, through the door', /\/plex\/[0-9a-f]{48}\/library\/parts\/7\/indexes\/sd\/125000$/.test(pic), pic);
    ok('the picture is there', (await ev((u) => fetch(u).then((r) => r.status), pic)) === 200 && /indexes\/sd\/125000/.test(m.state.preview || ''));
    ok('the subtitle picked in Plex (a file beside it) is read through the door', !!m.state.subFile);
    // Settings > Plex > Quality away from home: a file bigger than the cap is converted down to it.
    await ev(() => { Views.stopAll(); Plex.setPref('homeQuality', 8000); PlexPage.open({ ratingKey: '18', title: 'Northbound', type: 'movie', server: Plex.chosen()[0].id }, function () {}); });
    await page.waitForFunction(() => (PlexPage._test.item() || {}).Media && PlexPage._test.buttons().length, null, { timeout: 8000 });
    await ev(() => PlexPage._test.keys('ok')); await page.waitForTimeout(2500);
    const capped = await ev(() => (Views.vod && Views.vod.url) || '');
    ok('a 60 Mbps file with an 8 Mbps cap: the server converts it to 8 Mbps', /maxVideoBitrate=8000/.test(capped), capped);
    await ev(() => Plex.setPref('homeQuality', 0));
    // An old MPEG-2 file the TV can't play as is: the server converts it (HLS), from where you start.
    await ev(() => { Views.stopAll(); PlexPage.open({ ratingKey: '13', title: 'Low Tide', type: 'movie', server: Plex.chosen()[0].id }, function () {}); });
    await page.waitForFunction(() => (PlexPage._test.item() || {}).title === 'Low Tide' && (PlexPage._test.item() || {}).Media && PlexPage._test.buttons().length, null, { timeout: 8000 });
    await ev(() => PlexPage._test.keys('ok'));
    await page.waitForFunction(() => /metadata%2F13/.test((Views.vod && Views.vod.url) || ''), null, { timeout: 8000 }).catch(() => {});
    const conv = await ev(() => (Views.vod && Views.vod.url) || '');
    ok('a file the TV can\'t play: the server converts it', /\/plex\/[0-9a-f]{48}\/video\/:\/transcode\/universal\/start\.m3u8\?path=%2Flibrary%2Fmetadata%2F13/.test(conv) && /protocol=hls/.test(m.state.transcode || '') && /protocol=hls&container=mpegts&videoCodec=h264/.test(m.state.profileExtra || ''), conv);
    // An episode ends: Up next counts down to the next one; after the episodes in a row set, Still watching? asks.
    await ev(() => { Views.stopAll(); Plex.setPref('stillAfter', 1); PlexPage.open({ ratingKey: '41', title: 'Episode 1', type: 'episode', server: Plex.chosen()[0].id }, function () {}); });
    await page.waitForFunction(() => (PlexPage._test.item() || {}).Media && PlexPage._test.buttons().length, null, { timeout: 8000 });
    await ev(() => PlexPage._test.keys('ok')); await page.waitForTimeout(2000);
    await ev(() => PlexPage.ended(false)); await page.waitForTimeout(1500);
    const up1 = await ev(() => document.body.innerText);
    ok('an episode ends: Up next with the next one, counting down', /Up next/i.test(up1) && /Episode 2/.test(up1), up1.slice(-400));
    await shot('7-upnext');
    await ev(() => UI.press('ok')); await page.waitForTimeout(2500);
    ok('Play now starts the next episode', /parts\/7/.test(await ev(() => (Views.vod && Views.vod.url) || '')) && (await ev(() => (PlexPage._test.item() || {}).ratingKey)) === '42');
    await ev(() => PlexPage.ended(false)); await page.waitForTimeout(1500);
    const up2 = await ev(() => document.body.innerText);
    ok('after the episodes in a row set: Still watching? waits for OK', /Still watching\?/i.test(up2) && /Keep watching/.test(up2), up2.slice(-400));
    await ev(() => { UI.press('back'); Plex.setPref('stillAfter', 3); }); await page.waitForTimeout(800);
    // A show's page: Play its next episode, Seasons and Cast and crew rows.
    await ev(() => { Views.stopAll(); PlexPage.open({ ratingKey: '40', type: 'show', title: 'The Harbor Lights', server: Plex.chosen()[0].id }, function () {}); });
    await page.waitForFunction(() => PlexPage._test.shelf() && (PlexPage._test.item() || {}).type === 'show', null, { timeout: 8000 }).catch(() => {});
    const sp = await ev(() => ({ btns: PlexPage._test.buttons().map((b) => b.label), rows: PlexPage._test.shelf().rows.map((r) => r.title) }));
    ok('a show\'s page: Resume its next episode, Seasons, Cast and crew', sp.btns[0] === 'Resume S2 · E1' && sp.rows[0] === 'Seasons' && sp.rows.indexOf('Cast and crew') > 0, sp);
    await shot('6c-show');
    await ev(() => PlexPage._test.keys('back'));
    // Red on a show: play the next episode, mark it all watched.
    await ev(() => { Views.stopAll(); UI.close && UI.close(); PlexView.openShow({ ratingKey: '40', type: 'show', title: 'The Harbor Lights', server: Plex.chosen()[0].id }); PlexView._test.keys('red'); });
    await page.waitForTimeout(1200);
    const showMenu = await ev(() => UI.menuLabels);
    ok('Red on a show: Play the next episode, Mark all watched', showMenu.indexOf('Play S2 · E1') >= 0 && showMenu.indexOf('Mark all watched') >= 0, showMenu);
    await ev(() => UI.press('back')); await page.waitForTimeout(300);
    // The phone app's Plex tab (plexphone.js): lists from the TV, posters from the server, playing on the TV.
    const ph = await ev(async () => {
      const libs = await PlexPhone.answer({ op: 'libs' }), home = await PlexPhone.answer({ op: 'home' });
      const lib = await PlexPhone.answer({ op: 'lib', server: libs.libs[0].server, key: libs.libs[0].key, offset: 0 });
      const found = await PlexPhone.answer({ op: 'search', q: 'Northbound' });
      let bad = ''; try { await PlexPhone.answer({ op: 'lib', server: libs.libs[0].server, key: '../x' }); } catch (e) { bad = e.message; }
      const played = await PlexPhone.answer({ op: 'play', server: libs.libs[0].server, key: '18' });
      return { libs: libs.libs.map((l) => l.title), pics: Object.keys(libs.pics).length, rows: home.rows.map((r) => r.title), first: lib.items[0], total: lib.total, found: found.items.map((x) => x.title), bad, played };
    });
    ok('phone: the libraries picked, with where posters come from', JSON.stringify(ph.libs) === '["Movies"]' && ph.pics === 1, ph);
    ok('phone: Home rows, a library a page at a time, search', ph.rows[0] === 'Continue watching' && ph.total === 10 && ph.first && ph.first.key && ph.found.indexOf('Northbound') >= 0, ph);
    ok('phone: a key that isn\'t a Plex title is refused', /isn't a Plex title/.test(ph.bad), ph.bad);
    await page.waitForTimeout(2500);
    ok('phone: Play on TV opens Plex and plays where you stopped', ph.played.title === 'Northbound' && /library\/parts\/7/.test(await ev(() => (Views.vod && Views.vod.url) || '')) && (await ev(() => Views.tab)) === 'plex');
    ok('no page errors', !errs.length, errs);
  } finally { await b.close(); relay.server.close(); m.close(); }
  console.log('screenshots in ' + SHOTS);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); console.error('page errors: ' + JSON.stringify(global.__errs || [])); process.exit(1); });
