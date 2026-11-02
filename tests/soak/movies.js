/* Movies on now and movie details in the guide (movies.js), with the TMDB answers made up in the page:
   the group, the guide's poster and Movie line, the grid's Movie tag, and Settings.
     node tests/mock/mock_provider.js &      (on :8077)
     npm run serve &                         (app on :8078)
     node tests/soak/movies.js [--shots dir] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  ok('no token: no group', await ev(() => !Library.groups().some((g) => g.id === Library.MOVIES)));
  // Every long programme on now or soon, as the scan would find them; TMDB (made up) knows two of them.
  const seen = await ev((mock) => {
    const asked = [];
    window.__asked = asked;
    Movies.reset();
    MediaStore.setTmdbToken('mock-user-token-123456789012345');
    let pick = null;
    const now = Date.now();
    const byKey = {}; Library.data.channels.forEach((c) => { const k = Epg.keyOf(c); if (k && !byKey[k]) byKey[k] = c; });
    // One on now that it will ask about first (a strong one), so the made-up answer comes back quickly.
    Epg.during(now, now + 3 * 3600e3, (k, p) => { const c = byKey[k]; if (!pick && c && p.s <= now && p.e - p.s >= 75 * 60000 && Movies.strength(c, p, '') === 'strong') pick = p.t; });
    if (!pick) Epg.during(now, now + 3 * 3600e3, (k, p) => { if (!pick && p.e - p.s >= 75 * 60000 && p.s <= now && !/news|live|show/i.test(p.t)) pick = p.t; });
    window.__pick = pick;
    Media.guideLookup = (t, y, st) => { asked.push(t + '|' + st); return Promise.resolve(t === pick ? { metadata: { id: 'tmdb:1', title: t, year: '2011', poster: mock + '/poster/m0.svg', plot: 'A made-up plot from TMDB that is long enough to show.', genre: 'Comedy, Drama', runtime: '105 min', rating: '7.4' } } : { miss: true }); };
    Movies.poke();
    return pick;
  }, MOCK);
  ok('a long programme on now to try it on', !!seen, seen);
  await page.waitForFunction(() => Library.groups().some((g) => g.id === Library.MOVIES && g.count > 0), null, { timeout: 75000 }).catch(() => {});
  const asked = await ev(() => window.__asked);
  ok('long programmes were asked about, news and shows not', asked.length > 0 && !asked.some((a) => /news|live|show\b/i.test(a)), asked.slice(0, 8).join(', '));
  const g = await ev(() => { const x = Library.groups().find((g) => g.id === Library.MOVIES); return x && { name: x.name, n: Library.channels(Library.MOVIES).length }; });
  ok('the Movies on now group, with the movie\'s channel', g && g.name === 'Movies on now' && g.n >= 1, JSON.stringify(g));
  ok('only confirmed movies are in it', await ev(() => Movies.list().every((x) => x.p.t === window.__pick)));
  ok('the group can\'t be ticked through (virtual)', await ev(() => !Views.canManage(Library.MOVIES)));

  // The guide on that group: the poster, the Movie line, TMDB's plot when the guide has little to say.
  await ev(() => { Views.switchTab('guide'); Guide.open(Library.MOVIES, Library.channels(Library.MOVIES)[0].k); }); await page.waitForTimeout(1200);
  const d = await ev(() => { const el = document.getElementById('guideDetail'); return { poster: !!el.querySelector('img.gd-poster'), movie: (el.querySelector('.gd-movie') || {}).textContent || '', has: el.classList.contains('has-poster') }; });
  ok('the details show the poster', d.poster && d.has, JSON.stringify(d));
  ok('and a Movie line: year, runtime, genres, rating', /^Movie\s+·\s+2011\s+·\s+105 min\s+·\s+Comedy, Drama\s+·\s+★ 7\.4 TMDB$/.test(d.movie), d.movie);
  ok('the grid marks it Movie', await ev(() => !!document.querySelector('#guideBody .gp.mv')));
  await shot('tv-movies-on-now');

  // Settings: the token in the guide's section too, and the switches.
  const st = await ev(() => { Views.switchTab('settings'); Settings.section('reminders'); return document.getElementById('setBody').innerText; });
  ok('Settings > Guide: Movies in the guide, the token rows', /Movies in the guide/.test(st) && /Movie details from TMDB/.test(st) && /TMDB API token saved/.test(st) && /Test TMDB token/.test(st), st.slice(0, 400));
  const gs = await ev(() => { Settings.section('groups'); return document.getElementById('setBody').innerText; });
  ok('Settings > Groups: Show Movies on now', /Show Movies on now/.test(gs));
  const off = await ev(() => { Store.settings.moviesGroup = false; Movies.poke(); return Library.groups().some((g) => g.id === Library.MOVIES); });
  ok('turned off, the group goes', !off);
  const offAll = await ev(() => { Store.settings.moviesGroup = true; Store.settings.guideMovies = false; Movies.poke(); return { g: Library.groups().some((g) => g.id === Library.MOVIES), of: Movies.of({ k: 'x' }, { t: window.__pick, s: 0, e: 7200e3 }) }; });
  ok('movie details off: no group, no posters', !offAll.g && !offAll.of, JSON.stringify(offAll));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all Movies on now checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
