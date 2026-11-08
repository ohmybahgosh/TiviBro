/* TMDB details in the guide, for the website and the user guide: a movie (tv-guide-movie) and a series
   (tv-guide-series) picked in the guide, each with its poster and the line with year, genres and rating.
   Like onnow-shots.js the films, shows and pictures are made up (posters drawn by tests/android/posters.js),
   so no TMDB token is needed.
     node tests/mock/mock_provider.js &   npm run serve &
     node scripts/demo/tmdb-guide-shots.js     then   bash scripts/demo/site-shots.sh
   PNGs go to docs/screenshots/. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('./record.js');
const P = require('../../tests/android/posters.js');
const PORT = 18793, ART = 'http://127.0.0.1:' + PORT;

const FILMS = [
  ['The Lighthouse Keeper', '2025', 'Thriller, Drama', '1h 58m', '7.6', 'A keeper on a remote island starts receiving signals from a ship that sank forty years ago.'],
  ['Midnight Express Lane', '2024', 'Action, Thriller', '1h 46m', '6.9', 'A night courier has one hour to cross the city with a package everyone wants.'],
  ['Paper Planes', '2025', 'Comedy, Family', '1h 39m', '7.2', 'Two rival grandfathers enter the national paper plane championship.'],
  ['Iron Orchard', '2023', 'Drama', '2h 04m', '7.9', 'A family fights to keep its orchard through the hardest winter in a century.']
];
const SHOWS = [
  ['Harbor Lights', '2021', 'Northline', 'Drama', '8.1', 'A new place, new people and a new story every week.'],
  ['Kitchen Rivals', '2019', 'Channel Five Demo', 'Reality, Food', '7.3', 'Ordinary people take on a big challenge, one episode at a time.'],
  ['The Archive', '2023', 'Northline', 'Mystery', '8.4', 'Each episode follows one case from the first clue to the last.']
];

(async () => {
  await P.serve(PORT);
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' })).newPage();
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(R.APP);
  const shot = async (n) => { await page.addStyleTag({ content: '#toast{display:none!important}' }); await page.screenshot({ path: path.join(R.SHOTS, n + '.png') }); console.log(n); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const films = FILMS.map((f, n) => ({ id: 'tmdb:' + (100 + n), title: f[0], year: f[1], genre: f[2], runtime: f[3], rating: f[4], plot: f[5], poster: ART + '/p/' + n + '.png' }));
  const shows = SHOWS.map((s, n) => ({ id: 'tmdb:tv:' + (200 + n), title: s[0], year: s[1], network: s[2], genre: s[3], rating: s[4], plot: s[5], poster: ART + '/p/' + (5 + n) + '.png' }));
  await page.evaluate(({ films, shows }) => {
    const mv = {}, tv = {};
    let n = 0, k = 0;
    Media.guideLookup = (t) => { if (!(t in mv)) mv[t] = n < films.length * 3 ? films[n++ % films.length] : null; return Promise.resolve(mv[t] ? { metadata: mv[t] } : { miss: true }); };
    Media.tvByName = (t) => { if (!(t in tv)) tv[t] = k < shows.length * 4 ? Object.assign({}, shows[k++ % shows.length], { title: t }) : null; return Promise.resolve(tv[t] ? { metadata: tv[t] } : { miss: true }); };
    Media.tvSeason = () => Promise.resolve({ metadata: { episodes: [] } });
    Movies.reset(); Series.reset();
    MediaStore.setTmdbToken('mock-user-token-123456789012345');
    Movies.poke(); Series.poke();
  }, { films, shows });
  await page.waitForFunction(() => !Movies.pending, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => Views.switchTab('guide')); await page.waitForTimeout(2500);
  const kind = () => page.evaluate(() => { const m = document.querySelector('.gd-movie'), im = document.querySelector('.gd-poster');
    return m && im && im.complete && im.naturalWidth ? m.textContent.split(' ')[0] : ''; });
  // The movie from the Movies group, the series from Entertainment: each opened from the groups, then down its channels.
  const want = { Movie: 'tv-guide-movie', Series: 'tv-guide-series' };
  const hunt = async (k) => {
    for (let i = 0; i < 30 && want[k]; i++) {
      await page.waitForTimeout(900);
      if (await kind() === k) { await page.waitForTimeout(600); await shot(want[k]); delete want[k]; return; }
      await page.keyboard.press('ArrowDown');
    }
  };
  // Back to the groups, then down one group at a time until the one named opens.
  const gname = () => page.evaluate(() => { try { return Library.groupName(Guide.__gid()); } catch (e) { return ''; } });
  const openGroup = async (name) => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
      if (await gname() === name) return;
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400);
    }
  };
  await openGroup('Movies'); await hunt('Movie');
  await openGroup('Entertainment'); await hunt('Series');
  if (Object.keys(want).length) console.log('not found: ' + Object.keys(want).join(', '));
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
