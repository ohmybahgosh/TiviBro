/* My media's discovery, as Plex: the corner of a poster (a show's episodes not watched yet, ✓ on what's
   watched), New since your last visit (a dot and a shelf, gone once opened), Start watching, the library grid's
   filters (several at once), Categories, search as you type (cast and genre too), and My media opening on the
   tab you left.  The real app and helper, and a tiny DLNA server with 30 movies and one show of 5 episodes.
     npm run serve &
     node tests/soak/media-discovery.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '../..');
const R = require(ROOT + '/scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
const proxy = require(ROOT + '/service/proxy.js');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MOVIES = []; for (let i = 1; i <= 30; i++) MOVIES.push('Film Number ' + i + ' (' + (1990 + i) + ').mkv');
const fritz = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  if (req.method === 'GET') { res.writeHead(404); return res.end(); }
  const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], H = '127.0.0.1:' + fritz.address().port;
  const item = (t) => `<item id="i${esc(t)}"><dc:title>${esc(t)}</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="500000000">http://${H}/V/${esc(t)}</res></item>`;
  const dir = (t, c) => `<container id="${c}"><dc:title>${esc(t)}</dc:title></container>`;
  const tree = { 0: dir('Movies', 'm') + dir('TV', 'tv'), m: MOVIES.map(item).join(''), tv: dir('Harbour', 'show'), show: dir('Season 1', 's1'), s1: [1, 2, 3, 4, 5].map(n => item('Harbour.S01E0' + n + '.mkv')).join('') };
  const didl = tree[id] || '', n = (didl.match(/<(item|container) /g) || []).length;
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + didl + '</DIDL-Lite>')}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches></Envelope>`);
}); });
let fails = 0;
const SHOTS = process.env.SHOTS; let shotN = 0;
const shot = (page, n) => SHOTS ? page.screenshot({ path: path.join(SHOTS, (++shotN) + '-' + n + '.png') }) : null;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  await new Promise(f => fritz.listen(0, '127.0.0.1', f));
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47887, '127.0.0.1', f));
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47887'));
  await page.goto(process.env.APP || 'http://127.0.0.1:8078/index.html'); await page.waitForFunction(() => window.Library && Library.count() > 0);
  await page.evaluate(c => Media._test.addServer({ name: 'Demo source', control: c }), 'http://127.0.0.1:' + fritz.address().port + '/ctl');
  await page.evaluate(() => Views.switchTab('media'));
  await page.waitForFunction(() => MediaStore.movies(null).length === 30, null, { timeout: 30000 }).catch(() => {});
  ok('30 movies in', await page.evaluate(() => MediaStore.movies(null).length) === 30);
  // Details as TMDB would give them: genres, cast and ratings.
  await page.evaluate(() => MediaStore.movies(null).forEach((m, i) => MediaStore.setMetadata(m.id, { id: 'tmdb:movie:' + (i + 1), title: m.title, year: m.year, genre: i % 3 ? 'Drama' : 'Action, Comedy', cast: i === 4 ? 'Jane Example, Sam Sample' : 'Sam Sample', rating: i < 5 ? 8.2 : 6.1, poster: '' })));
  await page.evaluate(() => { Media.refreshShows(); Media.refresh(); }); await page.waitForTimeout(2500);
  const shows = await page.evaluate(() => Media.request('library/query', { kind: 'show' }, 30000));
  const sh = shows.items[0] || {};
  ok('the show counts its episodes for its poster', sh.eps === 5 && sh.seen === 0, JSON.stringify(sh).slice(0, 300));

  // 1. The corner: TV shows tab, the show's poster says 5; a season marked watched makes it ✓.
  await page.evaluate(() => Media._test.setSection('shows')); await page.waitForTimeout(800);
  const mark = () => page.evaluate(() => { const t = [...document.querySelectorAll('#mediaShelfStage .media-tile')].filter(x => x.style.display !== 'none' && /Harbour/.test(x.textContent))[0]; return t ? t.querySelector('.media-mark').textContent : null; });
  await shot(page, 'show-count');
  ok('a show\'s poster: its 5 episodes not watched, in the corner', await mark() === '5', await mark());
  await page.evaluate(h => Media.request('library/edit', { operation: 'setWatched', handle: h, expectedRevision: 0, watched: true, season: '1' }, 30000).catch(e => e), sh.handle);
  const rev = await page.evaluate(() => Media.request('library/query', { kind: 'show' }, 30000)).then(r => r.revision);
  await page.evaluate(a => Media.request('library/edit', { operation: 'setWatched', handle: a.h, expectedRevision: a.r, watched: true, season: '1' }, 30000), { h: sh.handle, r: rev });
  await page.evaluate(() => Media.refreshShows()); await page.waitForTimeout(1500);
  ok('...and ✓ once they are all watched', await mark() === '✓', await mark());
  // A movie you've watched: ✓; one you haven't: nothing.
  await page.evaluate(() => { Media._test.setSection('movies'); MediaStore.movies(null).slice(0, 15).forEach(m => MediaStore.markWatched(m.id, true)); Media.refresh(); }); await page.waitForTimeout(800);
  const marks = await page.evaluate(() => [...document.querySelectorAll('#mediaShelfStage .media-tile')].filter(x => x.style.display !== 'none').map(x => x.querySelector('.media-mark').textContent));
  await shot(page, 'movie-marks');
  ok('a movie: ✓ when watched, nothing when not', marks.indexOf('✓') >= 0 && marks.some(x => x === ''), JSON.stringify(marks));

  // 2. New since your last visit: one movie came two hours after the library (not its first scan).
  const newId = await page.evaluate(() => { const m = MediaStore.movies(null)[20]; m.addedAt = Date.now() + 7200e3; Media._test.visit({ mark: Date.now() - 1000, opened: [] }); Media._test.setSection('home'); Media.refresh(); return m.id; });
  await page.waitForTimeout(800);
  const fresh = await page.evaluate(() => { const s = [...document.querySelectorAll('#mediaShelfStage .media-shelf')].filter(x => !x.classList.contains('hidden') && /New since your last visit/.test(x.textContent))[0]; return s ? { n: s.querySelectorAll('.media-tile-title.is-new').length, t: s.textContent.slice(0, 160) } : null; });
  await shot(page, 'new');
  ok('New since your last visit: a shelf of it, with a dot by its name', fresh && fresh.n >= 1 && /Film Number 21/.test(fresh.t), JSON.stringify(fresh));
  ok('...and only that one (the first scan is never new)', await page.evaluate(() => MediaStore.movies(null).filter(m => Media.isNew(m)).length) === 1);
  await page.evaluate(id => { const m = MediaStore.movies(null).filter(x => x.id === id)[0]; Media.openTitle(m); }, newId); await page.waitForTimeout(500);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok('opened: not new any more', await page.evaluate(id => !Media.isNew(MediaStore.movies(null).filter(x => x.id === id)[0]), newId));
  ok('no toast for it', await page.evaluate(() => !/new/i.test((document.querySelector('.toast:not(.hidden)') || {}).textContent || '')));

  // 3. Start watching (TV shows tab) needs 3 shows: one here, so it stays out.
  await page.evaluate(() => Media._test.setSection('shows')); await page.waitForTimeout(500);
  ok('Start watching stays out with fewer than 3 shows not begun', !(await page.evaluate(() => /Start watching/.test(document.getElementById('mediaShelfStage').textContent))));

  // 4. The grid: All movies, Red > Filter > Rated 7 or more, then Genre > Action: two filters together.
  await page.evaluate(() => { Media._test.setSection('movies'); }); await page.waitForTimeout(500);
  await page.evaluate(() => Media._test.goShelf('library')); await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  ok('All movies opens as a grid', await page.evaluate(() => MediaGrid.isOpen() && /30 movies/.test(document.getElementById('mediaGrid').textContent)));
  // A menu item by its words: Down until it's on screen (long menus show a window of rows), then OK on it.
  const pickItem = async (re) => {
    for (let i = 0; i < 40; i++) {
      const hit = await page.evaluate(r => { const el = [...document.querySelectorAll('#modal .mi')].filter(x => new RegExp(r).test(x.textContent))[0]; if (el) { el.click(); return true; } return false; }, re);
      if (hit) return page.waitForTimeout(350);
      await page.evaluate(() => UI.press('down'));
    }
    throw new Error('no menu item ' + re + ' in ' + await page.evaluate(() => document.getElementById('modal').textContent));
  };
  await page.evaluate(() => UI.press('red')); await page.waitForTimeout(400);
  await pickItem('^Filter'); await pickItem('Rated 7 or more');
  let head = await page.evaluate(() => document.querySelector('#mediaGrid .mgr-sub').textContent);
  ok('Rated 7 or more: 5 movies', /^5 movies/.test(head), head);
  await page.evaluate(() => UI.press('red')); await page.waitForTimeout(400);
  await pickItem('^Filter'); await pickItem('^Genre'); await pickItem('^Action');
  head = await page.evaluate(() => document.querySelector('#mediaGrid .mgr-sub').textContent);
  await shot(page, 'grid-filters');
  ok('...and Action too: both at once (movies 1 and 4)', /^2 movies/.test(head) && /Rated 7 or more \+ Action/.test(head), head);
  await page.evaluate(() => UI.press('red')); await page.waitForTimeout(400);
  await pickItem('^Filter'); await pickItem('^Actor'); await pickItem('Jane Example');
  head = await page.evaluate(() => document.querySelector('#mediaGrid .mgr-sub').textContent);
  ok('an actor: 3 filters, nothing left (Jane is in movie 5, rated 8.2, Drama)', /^0 movies/.test(head) && /3 filters/.test(head), head);
  await page.evaluate(() => UI.press('red')); await page.waitForTimeout(400);
  await pickItem('^Clear filters');
  head = await page.evaluate(() => document.querySelector('#mediaGrid .mgr-sub').textContent);
  ok('Clear filters: all 30', /^30 movies/.test(head), head);

  // 5. Remember: leave My media with the grid open, come back: the grid again, on the Movies tab.
  await page.evaluate(() => Views.switchTab('live')); await page.waitForTimeout(800);
  await page.evaluate(() => Views.switchTab('media')); await page.waitForTimeout(2500);
  ok('back to My media: the grid you left, on the Movies tab', await page.evaluate(() => MediaGrid.isOpen() && /All movies/.test(document.getElementById('mediaGrid').textContent) && Media._test.section().section === 'movies'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);

  // 6. Categories: the Library shelf's Categories tile, Action and Comedy and Drama and the decades.
  await page.evaluate(() => Media._test.goShelf('library')); await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const cats = await page.evaluate(() => MediaGrid.isOpen() ? [...document.querySelectorAll('#mediaGrid .mgr-cat-name')].map(x => x.textContent) : null);
  await shot(page, 'categories');
  ok('Categories: a tile for each genre, then the decades', cats && cats.slice(0, 3).join(',') === 'Action,Comedy,Drama' && cats.indexOf('2010s') > 0, JSON.stringify(cats));
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  head = await page.evaluate(() => document.querySelector('#mediaGrid .mgr-sub').textContent);
  ok('OK on Action: its 10 movies, with sort and filters', /^10 movies/.test(head), head);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(500);

  // 7. Search as you type: "jane" finds movie 5 by its cast, behind the box, with a count.
  await page.evaluate(() => Media._test.askSearch()); await page.waitForTimeout(300);
  await page.fill('#modal input', 'jane'); await page.dispatchEvent('#modal input', 'input'); await page.waitForTimeout(900);
  const live = await page.evaluate(() => ({ hint: (document.querySelector('#modal .prompt-live') || {}).textContent, shelves: document.getElementById('mediaShelfStage').textContent.slice(0, 200) }));
  ok('typing "jane": results behind the box and a count', /1 match so far/.test(live.hint) && /Film Number 5/.test(live.shelves), JSON.stringify(live));
  await page.keyboard.press('Escape');
  ok('no page errors', !errors.length, errors.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all discovery checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
