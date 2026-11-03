/* Movies on now, for the README, the user guide and the website: the screen on its On now shelf
   (tv-onnow) and on its first genre shelf (tv-onnow-genre).  The movies and their pictures are made up
   (the demo provider's titles, posters and backdrops drawn by tests/android/posters.js, title logos as
   SVG), so no TMDB token is needed.
     node tests/mock/mock_provider.js &   npm run serve &
     node scripts/demo/onnow-shots.js     then   bash scripts/demo/site-shots.sh
   PNGs go to docs/screenshots/. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('./record.js');
const P = require('../../tests/android/posters.js');
const PORT = 18792, ART = 'http://127.0.0.1:' + PORT;

// The demo provider's films, with genres that overlap so the genre shelves have a few each.
const FILMS = [
  ['The Lighthouse Keeper', 2025, 'Thriller, Drama', '1h 58m', '7.6', 'A keeper on a remote island starts receiving signals from a ship that sank forty years ago.', ['#e8ecf8', 'serif']],
  ['Midnight Express Lane', 2024, 'Action, Thriller', '1h 46m', '6.9', 'A night courier has one hour to cross the city with a package everyone wants.', ['#ffcf4a', 'sans-serif']],
  ['Paper Planes', 2025, 'Comedy, Family', '1h 39m', '7.2', 'Two rival grandfathers enter the national paper plane championship.', ['#ffffff', 'cursive']],
  ['Iron Orchard', 2023, 'Drama', '2h 04m', '7.9', 'A family fights to keep its orchard through the hardest winter in a century.', ['#f2b33d', 'serif']],
  ['Signal Lost', 2025, 'Sci-Fi, Thriller', '1h 52m', '7.4', 'A deep-space crew loses contact with Earth and must decide whether to turn back.', ['#7dd3fc', 'monospace']],
  ['Copper Canyon', 2022, 'Western, Action', '1h 55m', '6.8', 'A retired marshal rides out for one last job in the canyon country.', ['#ff9f5a', 'serif']],
  ['The Last Matinee', 2024, 'Family, Comedy', '1h 41m', '7.0', 'Kids stage one last show to save their small-town cinema.', ['#ffffff', 'sans-serif']],
  ['Two Left Feet', 2023, 'Comedy', '1h 34m', '6.5', 'A clumsy accountant is mistaken for a famous dance coach.', ['#ff5ca8', 'sans-serif']],
  ['The Kite Festival', 2025, 'Family, Comedy', '1h 37m', '7.1', 'A boy builds the biggest kite his seaside town has ever seen.', ['#a3e635', 'cursive']]
];
function logo(title, [color, font]) {
  const words = title.toUpperCase().split(' '), lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [words.join(' ')];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="' + (lines.length * 86 + 10) + '">' + lines.map((l, n) =>
    '<text x="0" y="' + (78 + n * 86) + '" font-family="' + font + '" font-weight="900" font-size="78" letter-spacing="4" fill="' + color + '" stroke="rgba(0,0,0,.35)" stroke-width="2" textLength="' + Math.min(560, l.length * 52) + '">' + l + '</text>').join('') + '</svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

(async () => {
  await P.serve(PORT);
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' })).newPage();
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(R.APP);
  const shot = async (n) => { await page.addStyleTag({ content: '#toast{display:none!important}' }); await page.screenshot({ path: path.join(R.SHOTS, n + '.png') }); console.log(n); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const films = FILMS.map((f, n) => ({ id: 'tmdb:' + (100 + n), title: f[0], year: String(f[1]), genre: f[2], runtime: f[3], rating: f[4], plot: f[5],
    poster: ART + '/p/' + n + '.png', backdrop: ART + '/b/' + n + '.png', backdropHd: ART + '/b/' + n + '.png', logo: logo(f[0], f[6]) }));
  // Every long programme in the next three hours is "a movie": each title gets one of the made-up films.
  await page.evaluate((films) => {
    const by = {};
    let n = 0;
    Media.guideLookup = (t) => { if (!(t in by)) by[t] = n < films.length * 3 ? films[n++ % films.length] : null; return Promise.resolve(by[t] ? { metadata: by[t] } : { miss: true }); };
    Movies.reset();
    MediaStore.setTmdbToken('mock-user-token-123456789012345');
    Movies.poke();
  }, films);
  await page.waitForFunction(() => { const s = Movies.shelves(); return s.on.length >= 3 && !Movies.pending; }, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => Views.switchTab('onnow')); await page.waitForTimeout(2500);
  await shot('tv-onnow');
  const first = await page.evaluate(() => OnNow.rows.findIndex((r) => /^g:/.test(r.id)));
  if (first > 0) {
    for (let n = 0; n < first; n++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500); }
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
    await shot('tv-onnow-genre');
  } else console.log('no genre shelf: tv-onnow-genre kept');
  await b.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
