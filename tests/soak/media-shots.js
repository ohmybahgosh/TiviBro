/* Pictures of My media for the user guide, the README and the website, from made-up movies (the demo
   provider's titles and posters), and a check that the screen draws them.
     node tests/mock/mock_provider.js &      (posters on :8077)
     npm run serve &                         (app on :8078 and the dev relay)
     node tests/soak/media-shots.js [--shots docs/screenshots]
   The library is put straight into MediaStore: no media server is needed for the pictures. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// The demo provider's films (tests/mock/mock_provider.js MOVIES), as if they were your own files.
const FILMS = [
  ['The Lighthouse Keeper', 2025, 'Thriller', '1h 58m', 'A keeper on a remote island starts receiving signals from a ship that sank forty years ago.'],
  ['Midnight Express Lane', 2024, 'Action', '1h 46m', 'A night courier has one hour to cross the city with a package everyone wants.'],
  ['Paper Planes', 2025, 'Comedy, Drama', '1h 39m', 'Two rival grandfathers enter the national paper plane championship.'],
  ['Iron Orchard', 2023, 'Drama', '2h 04m', 'A family fights to keep its orchard through the hardest winter in a century.'],
  ['The Last Matinee', 2024, 'Family', '1h 41m', 'Kids stage one last show to save their small-town cinema.'],
  ['Signal Lost', 2025, 'Sci-Fi', '1h 52m', 'A deep-space crew loses contact with Earth and must decide whether to turn back.'],
  ['Copper Canyon', 2022, 'Western', '1h 55m', 'A retired marshal rides out for one last job in the canyon country.'],
  ['Two Left Feet', 2023, 'Comedy', '1h 34m', 'A clumsy accountant is mistaken for a famous dance coach.'],
  ['The Kite Festival', 2025, 'Family', '1h 37m', 'A boy builds the biggest kite his seaside town has ever seen.']
];

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  await ev(([films, mock]) => {
    const id = MediaStore.addSource({ type: 'dlna', name: 'Living room NAS', control: 'http://127.0.0.1:9/ctl' });
    MediaStore.applyScan(id, { movies: films.map((f, n) => ({ id: 'd:/Movies/' + n + '.mkv', title: f[0], year: String(f[1]), file: f[0].replace(/ /g, '.') + '.' + f[1] + '.1080p.mkv',
      size: (6 + n) * 1e9, ext: 'mkv', info: ['1080p', n % 2 ? 'HEVC' : 'H.264'], url: mock + '/movie/demo/demo/' + (5000 + n) + '.mp4' })) });
    MediaStore.movies(null).forEach((m) => {
      const n = films.findIndex((f) => f[0] === m.title);
      MediaStore.setMetadata(m.id, { provider: '', title: films[n][0], year: String(films[n][1]), genre: films[n][2], runtime: films[n][3], plot: films[n][4], poster: mock + '/poster/m' + n + '.svg' });
    });
    const all = MediaStore.movies(null);
    MediaStore.saveResume(all.find((m) => m.title === 'Signal Lost').id, 2700, 6700);
    MediaStore.saveResume(all.find((m) => m.title === 'Paper Planes').id, 1300, 5900);
    MediaStore.toggleFavorite(all.find((m) => m.title === 'The Kite Festival').id);
    MediaStore.toggleFavorite(all.find((m) => m.title === 'Copper Canyon').id);
  }, [FILMS, MOCK]);
  await page.waitForTimeout(800);
  ok('My media joins the menu with a source', await ev(() => !!document.querySelector('.tab[data-tab="media"]')));

  await ev(() => Views.switchTab('media')); await page.waitForTimeout(2500);
  const txt = await page.innerText('#viewMedia');
  ok('the shelves and the movie on top', /Continue watching/.test(txt) && /Favorites/.test(txt) && /All movies/.test(txt) && /Signal Lost/.test(txt), txt.slice(0, 300));
  ok('posters drawn', await ev(() => [].slice.call(document.querySelectorAll('#viewMedia img')).some((im) => im.complete && im.naturalWidth > 0)));
  // Up to Continue watching: the movie you were in the middle of.
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(900);
  await shot('tv-my-media');
  // Down to All movies, a few to the right.
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
  await shot('tv-my-media-all');

  await ev(() => { Views.switchTab('settings'); Settings.section('media'); }); await page.waitForTimeout(900);
  const st = await page.innerText('#setBody');
  ok('Settings > My media says movies only', /Movies only for now/.test(st) && /Add media/.test(st) && /Living room NAS/.test(st), st.slice(0, 300));
  await shot('tv-set-my-media');

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all My media picture checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
