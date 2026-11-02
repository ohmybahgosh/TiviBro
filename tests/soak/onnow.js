/* The Movies on now screen (onnow.js): big posters, the focused movie over its backdrop with its title
   logo, OK to watch, Hold OK for its channels or a reminder.  The movies and their pictures are made up
   here (made-up titles, posters and backdrops drawn by tests/android/posters.js, title logos as SVG), so
   no TMDB token is needed.
     node tests/mock/mock_provider.js &      (on :8077)
     npm run serve &                         (app on :8078)
     node tests/soak/onnow.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const P = require('../android/posters.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const PORT = 18791, ART = 'http://127.0.0.1:' + PORT;
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// Made-up films (as in tests/soak/media-shots.js), with a logo style each.
const FILMS = [
  ['The Lighthouse Keeper', 2025, 'Thriller', '1h 58m', '7.6', 'A keeper on a remote island starts receiving signals from a ship that sank forty years ago.', ['#e8ecf8', 'serif']],
  ['Midnight Express Lane', 2024, 'Action', '1h 46m', '6.9', 'A night courier has one hour to cross the city with a package everyone wants.', ['#ffcf4a', 'sans-serif']],
  ['Paper Planes', 2025, 'Comedy, Drama', '1h 39m', '7.2', 'Two rival grandfathers enter the national paper plane championship.', ['#ffffff', 'cursive']],
  ['Iron Orchard', 2023, 'Drama', '2h 04m', '7.9', 'A family fights to keep its orchard through the hardest winter in a century.', ['#f2b33d', 'serif']],
  ['Signal Lost', 2025, 'Sci-Fi', '1h 52m', '7.4', 'A deep-space crew loses contact with Earth and must decide whether to turn back.', ['#7dd3fc', 'monospace']],
  ['Copper Canyon', 2022, 'Western', '1h 55m', '6.8', 'A retired marshal rides out for one last job in the canyon country.', ['#ff9f5a', 'serif']],
  ['The Last Matinee', 2024, 'Family', '1h 41m', '7.0', 'Kids stage one last show to save their small-town cinema.', ['#ffffff', 'sans-serif']],
  ['Two Left Feet', 2023, 'Comedy', '1h 34m', '6.5', 'A clumsy accountant is mistaken for a famous dance coach.', ['#ff5ca8', 'sans-serif']],
  ['The Kite Festival', 2025, 'Family', '1h 37m', '7.1', 'A boy builds the biggest kite his seaside town has ever seen.', ['#a3e635', 'cursive']]
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
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 300 : w); };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  ok('no token: no Movies on now in the menu', await ev(() => !document.querySelector('.tab[data-tab="onnow"]')));
  const films = FILMS.map((f, n) => ({ id: 'tmdb:' + (100 + n), title: f[0], year: String(f[1]), genre: f[2], runtime: f[3], rating: f[4], plot: f[5],
    poster: ART + '/p/' + n + '.png', backdrop: ART + '/b/' + n + '.png', backdropHd: ART + '/b/' + n + '.png', logo: n === 4 ? '' : logo(f[0], f[6]) }));
  // Every long programme in the next three hours is "a movie": each title gets one of the made-up films.
  await ev((films) => {
    const by = {};
    let n = 0;
    Media.guideLookup = (t) => { if (!(t in by)) by[t] = n < films.length * 3 ? films[n++ % films.length] : null; return Promise.resolve(by[t] ? { metadata: by[t] } : { miss: true }); };
    Movies.reset();
    MediaStore.setTmdbToken('mock-user-token-123456789012345');
    Movies.poke();
  }, films);
  await page.waitForFunction(() => { const s = Movies.shelves(); return s.on.length >= 3 && !Movies.pending; }, null, { timeout: 60000 }).catch(() => {});
  ok('with a token, Movies on now joins the menu', await ev(() => !!document.querySelector('.tab[data-tab="onnow"]')));
  await ev(() => Views.switchTab('onnow')); await page.waitForTimeout(1500);
  const st = await ev(() => ({ rows: OnNow.rows.map((r) => r.title + ':' + r.items.length), cards: document.querySelectorAll('#onStage .on-card').length, w: document.querySelector('#onStage .on-art').offsetWidth, h: document.querySelector('#onStage .on-art').offsetHeight }));
  ok('shelves: On now and Starting soon', st.rows.length >= 1 && /^On now:/.test(st.rows[0]), JSON.stringify(st));
  ok('big posters (300 x 450)', st.w === 300 && st.h === 450, JSON.stringify(st));
  ok('a movie once, however many channels show it', await ev(() => OnNow.rows.every((r) => new Set(r.items.map((g) => g.m.id)).size === r.items.length)), await ev(() => OnNow.rows.map((r) => r.items.map((g) => g.m.id + '@' + g.p.s).join(',')).join(' | ')));
  const hero = await ev(() => ({ logo: !!document.querySelector('#onInfo img.on-logo'), bd: getComputedStyle(document.getElementById('onBd')).backgroundImage, meta: document.querySelector('#onInfo .on-meta').textContent, where: document.querySelector('#onInfo .on-where').textContent }));
  ok('the focused movie: its title logo over its backdrop', hero.logo && /\/b\/\d+\.png/.test(hero.bd), JSON.stringify(hero));
  ok('LIVE, the times, what is left, and the channel', /LIVE/.test(hero.meta) && /left/.test(hero.meta) && /^On /.test(hero.where), JSON.stringify(hero));
  await page.waitForTimeout(800);
  await shot('tv-onnow');
  // Along the shelf: to the one without a logo (its title instead).
  const noLogo = await ev(() => { const r = OnNow.rows[0]; return r.items.findIndex((g) => !g.m.logo); });
  if (noLogo > 0) { for (let n = 0; n < noLogo; n++) await key('ArrowRight', 150); await page.waitForTimeout(500);
    ok('no title logo: the title in big type', await ev(() => !!document.querySelector('#onInfo h1.on-title') && !document.querySelector('#onInfo img.on-logo')));
    await shot('tv-onnow-title'); }
  // Pictures arriving (a re-draw) keep you where you are, on either shelf.
  await ev(() => OnNow.render(true)); await page.waitForTimeout(200);
  ok('opens on On now and stays there through a re-draw', await ev(() => document.querySelector('#onStage .on-shelf.active h3').textContent.indexOf('On now') === 0));
  // Down to Starting soon.
  if (st.rows.length > 1) {
    await key('ArrowDown', 600);
    const soon = await ev(() => document.querySelector('#onInfo .on-meta').textContent);
    ok('Starting soon: when it starts', /STARTS/.test(soon) && /in /.test(soon), soon);
    await shot('tv-onnow-soon');
    // OK asks first, on Cancel: a stray press sets nothing.
    const before = await ev(() => Store.edits.reminders.length);
    await key('Enter', 300);
    const ask = await page.innerText('#modal');
    ok('OK on one starting later asks first', /Remind me at /.test(ask) && /Watch .+ now/.test(ask) && await ev(() => document.querySelector('#modalBody .mi.focus').textContent === 'Cancel'), ask);
    await key('Enter', 300);
    ok('a second OK (on Cancel) sets nothing', await ev((n) => Store.edits.reminders.length === n && !UI.modalOpen, before));
    await key('Enter', 300); await key('ArrowUp', 100); await key('ArrowUp', 100); await key('Enter', 300);
    ok('Remind me sets it', await ev((n) => Store.edits.reminders.length === n + 1, before));
    await key('Enter', 300);
    ok('asked again, it offers to cancel it', /Cancel the reminder/.test(await page.innerText('#modal')));
    await key('Escape', 200);
    await ev(() => UI.press('hold')); await page.waitForTimeout(300);
    const menu = await page.innerText('#modal');
    ok('Hold OK on one starting later: a reminder on its channel', /Remind me on /.test(menu) && /Show in the guide/.test(menu), menu);
    await key('Enter', 300);
    ok('the reminder is set', await ev((n) => Store.edits.reminders.length >= n, before));
    await key('ArrowUp', 400);
    await ev(() => OnNow.render(true)); await page.waitForTimeout(300);
    ok('Up to On now stays on On now (also when the screen re-draws)', await ev(() => document.querySelector('#onStage .on-shelf.active h3').textContent.indexOf('On now') === 0));
  }
  // OK watches it, fullscreen; Back lands in the guide on that channel.
  const want = await ev(() => OnNow.rows[0].items[0].c.k);
  await ev(() => { const r = OnNow.rows[0]; }); await key('Home', 100);
  for (let n = 0; n < 12; n++) await key('ArrowLeft', 60);
  await ev(() => { if (document.body.classList.contains('nav-open')) UI.press('right'); }); await page.waitForTimeout(300);
  await key('Enter', 1500);
  ok('OK: the movie fullscreen', await ev((k) => Views.full && Views.playing && Views.playing.k === k, want));
  for (let n = 0; n < 3 && await ev(() => Views.full); n++) await key('Escape', 700);
  ok('Back: the guide, on that channel', await ev(() => Views.tab === 'guide' && !Views.full), await ev(() => Views.tab + ' full=' + Views.full + ' modal=' + UI.modalOpen));

  // Turned off (or no token): out of the menu.
  await ev(() => { Store.settings.guideMovies = false; Movies.poke(); });
  ok('movie details off: out of the menu', await ev(() => !document.querySelector('.tab[data-tab="onnow"]')));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all Movies on now screen checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
