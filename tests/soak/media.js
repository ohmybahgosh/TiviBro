/* My media in the real app, with the real helper code and a tiny DLNA server shaped like a Fritz!Box:
     MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/media.js [--shots dir]
   The tab, adding a server, the list, playing, Back, where a movie stopped, a rescan that finds nothing,
   a wrong login.  Remote keys only. */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path');
const R = require('../../scripts/demo/record.js');
const fs = require('fs'), os = require('os');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'media-soak-'));
const proxy = require('../../service/proxy.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 200) : '')); if (!c) fails++; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let empty = false, extra = false, davPassword = 'right';
const fritz = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (req.method === 'GET') { res.writeHead(404); return res.end(); }
    const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], H = '127.0.0.1:' + fritz.address().port;
    const item = (t, u) => `<item id="i${t}"><dc:title>${esc(t)}</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="5000000000">${esc(u.charAt(0) === '\u0000' ? MOCK + '/movie/demo/demo/Moana.2.2024.mp4' : 'http://' + H + u)}</res></item>`;
    const dir = (t, c) => `<container id="${c}"><dc:title>${esc(t)}</dc:title></container>`;
    const tree = { 0: dir('Music', 'm') + dir('Videos', 'v'), v: dir('Folders', 'fl'), fl: dir('Frozen (2013)', 'a') + dir('Moana 2 (2024)', 'b') + (extra ? dir('New movie (2025)', 'c') : ''), c: item('New.movie.2025.mkv', '/VIDEO/new.mkv'),
      a: item('FROZEN 2013 1080p BluRay.mkv', '/VIDEO/Frozen/FROZEN%202013%201080p%20BluRay.mkv'), b: item('Moana.2.2024.mp4', MOCK.replace(/^http:\/\//, '').replace(/^/, '\u0000')) };
    const didl = empty ? '' : (tree[id] || ''), n = (didl.match(/<(item|container) /g) || []).length;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + didl + '</DIDL-Lite>')}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches></Envelope>`);
  });
});
const dav = http.createServer((req, res) => { res.writeHead(req.headers.authorization === 'Basic ' + Buffer.from('cust:' + davPassword).toString('base64') ? 207 : 401); res.end('<multistatus xmlns="DAV:"></multistatus>'); });

(async () => {
  await new Promise(f => fritz.listen(0, '127.0.0.1', f));
  await new Promise(f => dav.listen(0, '127.0.0.1', f));
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47897, '127.0.0.1', f));
  const control = 'http://127.0.0.1:' + fritz.address().port + '/ctl';

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.route('**/mock-poster.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="185" height="278"><rect width="185" height="278" fill="blue"/></svg>' }));
  const metadataRequests = [];
  await page.route('**/media/metadata', route => {
    const q = route.request().postDataJSON();
    if (q.check) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    metadataRequests.push(q);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ metadata: { provider: 'TMDB', id: q.id || 'tmdb:7', title: q.title || 'Localized movie', year: q.year || '2013', language: q.language, requestedLanguage: q.language, fallbackFields: [], plot: 'A mock movie description.', genre: 'Animation', poster: 'http://127.0.0.1:8088/mock-poster.svg', backdrop: 'http://127.0.0.1:8088/mock-poster.svg' } }) });
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47897'));
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 350 : w); };
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const text = sel => page.innerText(sel);
  // Pick a line in a menu with the arrows, the way the remote does.
  const pick = async label => {
    for (let n = 0; n < 12; n++) {
      const cur = await ev(() => { const f = document.querySelector('#modal .mi.focus, #modal .mi.sel, #modal .mi.on'); return f ? f.innerText : ''; });
      if (cur.indexOf(label) >= 0) { await key('Enter', 500); return true; }
      await key('ArrowDown', 200);
    }
    return false;
  };

  ok('My media stays out of the menu until a source is added', await ev(() => !document.querySelector('.tab[data-tab="media"]')));
  // A source that holds nothing yet: the tab joins the menu.
  const placeholder = await ev(() => MediaStore.addSource({ type: 'dlna', name: 'Empty server', control: 'http://127.0.0.1:9/ctl' }));
  await page.waitForTimeout(300);
  ok('My media is in the menu once there is a source', await ev(() => !!document.querySelector('.tab[data-tab="media"]')));
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(500);
  ok('the screen opens', await ev(() => !document.getElementById('viewMedia').classList.contains('hidden')));
  ok('empty library points to Settings', /Settings/.test(await text('#mediaInfo')));
  ok('there is no extra source menu', await ev(() => !document.getElementById('mediaDrawer') && !document.getElementById('mediaShade')));
  await shot('media-empty');
  await key('Escape');
  ok('Back opens the standard main menu directly', await ev(() => document.body.classList.contains('nav-open') && Views.tab === 'media'));
  await key('ArrowRight');
  await key('ArrowLeft');
  ok('Left at the first movie opens the standard main menu', await ev(() => document.body.classList.contains('nav-open')));
  await key('ArrowRight');
  await ev((id) => { MediaStore.removeSource(id); }, placeholder); await page.waitForTimeout(300);
  ok('and leaves the menu when the last source goes', await ev(() => !document.querySelector('.tab[data-tab="media"]')));
  await ev(() => Views.switchTab('settings')); await ev(() => Settings.section('media')); await page.waitForTimeout(300);
  ok('My media is a settings section', /Add media/.test(await text('#setBody')) && /Metadata language/.test(await text('#setBody')));
  await key('Enter');
  ok('Add media in Settings offers generic protocols', /DLNA \/ UPnP/.test(await text('#modal')) && /WebDAV/.test(await text('#modal')));
  await key('Escape');
  await page.locator('#setBody .opt').filter({ hasText: /^Add TMDB API token/ }).click();
  ok('TMDB token entry is masked', await page.locator('#modal input').getAttribute('type') === 'password');
  await page.locator('#modal input').fill('mock-user-token-123456789012345'); await key('Enter');
  await page.waitForFunction(() => MediaStore.preferences().tmdbConfigured);
  await page.waitForFunction(() => /TMDB API token saved/.test(document.querySelector('#setBody').innerText));
  ok('settings clearly show a saved token and replacement help', /Token saved on this TV/.test(await text('#setBody')) && /Select to replace it/.test(await text('#setBody')));
  ok('token is private in settings responses', await ev(() => JSON.stringify(MediaStore.preferences()).indexOf('mock-user-token') < 0));
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(300);

  // Audio preferences apply to My media through the common movie player.
  await ev(() => { Views.switchTab('settings'); Settings.section('playback'); });
  await page.locator('#setBody .opt').filter({ hasText: /^Audio language/ }).click();
  await pick('Dutch');
  ok('preferred audio language can be saved as Dutch', await ev(() => Store.settings.audioLang === 'nl'));
  await page.locator('#setBody .opt').filter({ hasText: /^Fallback audio language/ }).click();
  await pick('English');
  ok('English fallback is shown and saved in playback settings', await ev(() => Store.settings.audioFallback === 'en') && /Fallback audio language/.test(await text('#setBody')));
  await ev(() => Views.switchTab('media'));

  // A wrong login: said plainly, nothing saved.
  davPassword = 'other';
  await ev(a => Media._test.addAddress(a, 'cust', 'wrong'), 'http://127.0.0.1:' + dav.address().port + '/');
  await page.waitForFunction(() => /accept that login/.test(document.body.innerText), null, { timeout: 8000 });
  ok('a wrong login says so', true);
  ok('and adds nothing', await ev(() => MediaStore.sources().length === 0));

  // Adding a server.
  await ev(c => Media._test.addServer({ name: 'FritzBox Server', control: c }), control);
  await page.waitForTimeout(300);
  ok('the first source brings My media into the menu', await ev(() => !!document.querySelector('.tab[data-tab="media"]')));
  await ev(() => Views.switchTab('media'));
  await page.waitForFunction(() => document.querySelector('#mediaItems').innerText.indexOf('Frozen') >= 0, null, { timeout: 8000 });
  const list = await text('#mediaItems');
  ok('folder titles in the list', /Frozen/.test(list) && /Moana 2/.test(list), list);
  ok('the year shows', /2013/.test(list));
  ok('scene names stay off the list', !/BluRay/.test(list));
  ok('Music is not read', await ev(() => MediaStore.movies(null).length === 2));
  await ev(() => Views.switchTab('settings')); await ev(() => Settings.section('media')); await page.waitForTimeout(300);
  ok('sources and their counts are available in Settings', /FritzBox Server/.test(await text('#setBody')) && /2 movies/.test(await text('#setBody')));
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(300);
  ok('movie details fill the header', /Frozen/.test(await text('#mediaInfo')));
  ok('three movie sections are shown', /Continue watching/.test(list) && /Favorites/.test(list) && /All movies/.test(list));
  ok('large poster tiles replace list rows', await ev(() => !!document.querySelector('.media-tile.sel') && document.querySelector('.media-tile.sel .media-art').getBoundingClientRect().width > 200));
  await shot('media-list');

  // Nothing plays by itself.
  ok('nothing has started playing', await ev(() => !document.body.classList.contains('full')));

  // OK plays, with the movie player.
  await ev(() => Media._test.focusItems());
  await key('ArrowRight');
  ok('Right moves between tiles', /Moana 2/.test(await text('#mediaInfo')));
  // Observe the player boundary and request: MSE engines attach a blob to the video.
  const mediaRequests = [];
  page.on('request', r => { if (r.url().indexOf('/movie/demo/demo/Moana.2.2024.mp4') >= 0) mediaRequests.push(r.url()); });
  await ev(() => { var original = Player.play; Player.play = function (ch, opts) { window.__mediaPlay = opts; return original.apply(this, arguments); }; });
  await key('Enter', 900);
  ok('OK opens the player', await ev(() => document.body.classList.contains('full')));
  ok('the DLNA address went to the movie player', await ev(() => window.__mediaPlay && /Moana\.2\.2024\.mp4/.test(window.__mediaPlay.url) && window.__mediaPlay.live === false && window.__mediaPlay.meta.local === true));
  ok('the player requested the movie bytes', mediaRequests.length > 0);
  await shot('media-play');

  // Back returns to the same row and remembers where it stopped.
  await ev(() => { Object.defineProperty(Player, 'position', { configurable: true, get: () => 1000 }); Object.defineProperty(Player, 'duration', { configurable: true, get: () => 6000 }); });
  // Back hides the player's bar first, then leaves, as it does for Movies.
  for (let n = 0; n < 3 && await ev(() => document.body.classList.contains('full')); n++) await key('Escape', 500);
  ok('Back leaves the player', await ev(() => !document.body.classList.contains('full')));
  ok('and shows the same movie', /Moana 2/.test(await text('#mediaInfo')));
  ok('the position is saved', await ev(() => { const m = MediaStore.movies(null).filter(x => x.title === 'Moana 2')[0]; return MediaStore.resume(m.id) && MediaStore.resume(m.id).pos === 1000; }));
  ok('the panel says where it stopped', /Resume at 16 of 100 min/.test(await text('#mediaInfo')), await text('#mediaInfo'));
  ok('Movies did not get the position', await ev(() => Object.keys(Store.edits.resume).length === 0));

  // Options.
  await ev(() => UI.press('red')); await page.waitForTimeout(400);
  const opts = await text('#modal');
  ok('options offer Resume and starting over', /Resume/.test(opts) && /Play from beginning/.test(opts) && /Mark as watched/.test(opts), opts);
  await shot('media-options');
  await key('Escape', 300);

  // A rescan that finds nothing keeps the list.
  empty = true;
  await key('ArrowLeft', 300);
  await ev(() => UI.press('green'));
  await page.waitForFunction(() => /list stays/.test(document.body.innerText), null, { timeout: 8000 });
  ok('an empty rescan says so', true);
  ok('and keeps the movies', await ev(() => MediaStore.movies(null).length === 2));
  empty = false;

  // Survives a restart, and the login never reaches the settings.
  davPassword = 'right';
  await ev(a => Media._test.addAddress(a, 'cust', 'right'), 'http://127.0.0.1:' + dav.address().port + '/');
  await page.waitForFunction(() => MediaStore.sources().length === 2, null, { timeout: 8000 });
  ok('a good login is added', true);
  await page.waitForTimeout(600);
  ok('the login is not in the settings', await ev(() => (localStorage.getItem('tivibro.settings') || '').indexOf('"right"') < 0));
  await page.reload();
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(700);
  ok('the list is back after a restart', /Frozen/.test(await ev(() => document.getElementById('mediaItems').innerText)) || await ev(() => MediaStore.movies(null).length === 2));
  ok('nothing plays after a restart in My media', await ev(() => !document.body.classList.contains('full')));

  ok('continue watching contains the stopped movie', await ev(() => MediaStore.sections(null)[0].movies.length === 1));
  await ev(() => Media._test.focusItems()); await ev(() => UI.press('red')); await page.waitForTimeout(200);
  ok('movie options offer favorites', /Add to Favorites/.test(await text('#modal')));
  await key('Enter');
  ok('favorites section updates', await ev(() => MediaStore.sections(null)[1].movies.length === 1));
  await ev(() => Views.switchTab('settings')); await ev(() => Settings.section('media'));
  await page.waitForTimeout(300);
  // Source management remains in Settings.
  await ev(() => Media.sourceMenu(MediaStore.publicSources()[0])); await page.waitForTimeout(200);
  ok('source settings offer Rescan and Remove', /Rescan/.test(await text('#modal')) && /Remove/.test(await text('#modal')));
  await key('Escape');

  // With a TMDB token saved, movies without details are looked up on their own after a scan.
  await page.waitForFunction(() => MediaStore.movies(null).filter(m => m.metadata).length === 2, null, { timeout: 20000 }).catch(() => {});
  ok('with a token, new movies get details on their own after a scan', metadataRequests.length === 2 && await ev(() => MediaStore.movies(null).filter(m => m.metadata).length === 2), metadataRequests.length);
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(300);
  await ev(() => UI.press('yellow'));
  await page.waitForTimeout(500);
  ok('Yellow then finds nothing left to fetch', metadataRequests.length === 2, metadataRequests.length);
  ok('source scraping saves details', await ev(() => MediaStore.movies(null).every(m => m.metadata.plot === 'A mock movie description.')));
  ok('only titles and years go to the metadata service', metadataRequests.every(q => Object.keys(q).every(k => ['title', 'year', 'auto', 'language', 'credential'].includes(k))));
  await ev(() => Media._test.rescanCurrent()); await page.waitForTimeout(1000);
  await ev(() => Views.switchTab('media')); await page.waitForTimeout(400);
  ok('a rescan keeps matched details', await ev(() => MediaStore.movies(null).every(m => !!m.metadata)));
  ok('artwork appears on the poster shelves', await ev(() => !!document.querySelector('#mediaItems img.media-cover')));
  ok('the detail panel shows the plot', /A mock movie description/.test(await text('#mediaInfo')));

  await ev(() => Media.updatePreferences({ language: 'nl' }));
  await page.waitForFunction(() => MediaStore.movies(null).every(m => m.metadata && m.metadata.requestedLanguage === 'nl'));
  ok('language change refreshes cached movie IDs', metadataRequests.slice(2).every(q => q.id && q.language === 'nl' && !q.title));
  ok('hero backdrop is present', await ev(() => !!document.querySelector('#mediaInfo img.media-hero-art')));
  await ev(() => { const m = MediaStore.movies(null)[0]; MediaStore.setMetadata(m.id, Object.assign({}, m.metadata, { title: 'Corrected movie title' })); Media.refresh(); });
  ok('correcting a match updates the tile title even with the same poster', /Corrected movie title/.test(await text('#mediaItems')));
  extra = true;
  await ev(() => UI.press('green'));
  await page.waitForFunction(() => MediaStore.movies(null).length === 3);
  ok('Green discovers new movies without leaving My media', await ev(() => Views.tab === 'media'));
  await page.waitForTimeout(400);
  const beforeYellow = metadataRequests.length;
  await ev(() => UI.press('yellow'));
  await page.waitForFunction(() => MediaStore.movies(null).every(m => m.metadata));
  ok('Yellow fetches only new or outdated details', metadataRequests.length === beforeYellow + 1);
  ok('Green and Yellow appear in remote hints', /Rescan/.test(await text('#hints')) && /Fetch details/.test(await text('#hints')));
  await shot('media-details');
  await ev(() => {
    const id = MediaStore.addSource({ type: 'dlna', name: 'Large mock library', control: 'http://127.0.0.1/mock' });
    const movies = Array.from({ length: 2000 }, (_, i) => ({ id: 'd:/' + i, title: 'Movie ' + String(i).padStart(4, '0'), year: '2020', file: 'movie.mkv', metadata: { poster: 'http://127.0.0.1:8088/mock-poster.svg', backdrop: 'http://127.0.0.1:8088/mock-poster.svg' } }));
    MediaStore.applyScan(id, { movies });
    const saved = MediaStore.movies(id);
    saved.slice(0, 16).forEach(m => { MediaStore.toggleFavorite(m.id); MediaStore.saveResume(m.id, 500, 6000); });
    Media.refresh(); Media._test.focusItems();
    for (let i = 0; i < 160; i++) UI.press('right');
  });
  await page.waitForTimeout(400);
  ok('large libraries keep at most 21 poster elements', await ev(() => document.querySelectorAll('#mediaItems img').length <= 21));
  ok('selected tile stays inside the movie viewport', await ev(() => { const t = document.querySelector('.media-tile.sel').getBoundingClientRect(), v = document.getElementById('mediaItems').getBoundingClientRect(); return t.left >= v.left && t.right <= v.right && t.bottom <= v.bottom; }));
  await key('ArrowUp');
  ok('Up moves to the Favorites shelf', await ev(() => /Favorites/.test(document.querySelector('.media-tile.sel').closest('.media-shelf').querySelector('h2').textContent)));
  await shot('media-shelves');

  // Back cancels a cloud play request before its signed URL arrives.
  let delayedResolve;
  await page.route('**/media/resolve', async route => {
    delayedResolve = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: MOCK + '/movie/demo/demo/Moana.2.2024.mp4' }) });
  });
  await ev(async () => {
    await MediaStore.load();
    MediaStore.sources().forEach(s => MediaStore.removeSource(s.id));
    const id = MediaStore.addSource({ type: 'webdav', name: 'Slow mock cloud', address: 'http://127.0.0.1/mock' });
    MediaStore.applyScan(id, { movies: [{ id: 'w:/slow.mp4', path: '/slow.mp4', title: 'Slow cloud movie', year: '2024', file: 'slow.mp4' }] });
    Media.refresh(); Media._test.focusItems();
  });
  await key('Enter', 100);
  for (let i = 0; i < 30 && !delayedResolve; i++) await page.waitForTimeout(100);
  ok('cloud movie requested a fresh link', !!delayedResolve);
  await key('Escape', 100);
  if (delayedResolve) await delayedResolve();
  await page.waitForTimeout(500);
  ok('Back cancels playback while a cloud link is resolving', await ev(() => document.body.classList.contains('nav-open') && !document.body.classList.contains('full')));

  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  fritz.close(); dav.close(); relay.server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
