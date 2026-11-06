/* TV series from TMDB (series.js), with TMDB's answers made up in the page: in the guide, a series gets
   a poster, a Series line (when it started, network, genres, rating) and the episode's own title and
   summary; on the Shows screen, what the provider leaves out (a summary, an episode's summary and
   picture) is filled in, and what it has (its cover, its episode titles) stays.
     MOCK_EVENTS=1 node tests/mock/mock_provider.js &      (its guide has categories and episodes)
     npm run serve &
     node tests/soak/series.js [--shots dir] */
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
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }); await page.waitForTimeout(3000);
  const ev = (f, a) => page.evaluate(f, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  try {
    // TMDB, made up: it knows the series on Prime Plaza at the soak's prime time (which one depends on when the
    // mock started, so it's looked up rather than assumed) and the provider's "Harbor Street".
    const SHOW = await ev(() => { const c = Library.channels(Library.ALL).find((x) => /Prime Plaza/.test(x.n)), t = Date.now(); const p = (Epg.request(c) || []).find((q) => q.s <= t && q.e > t); return p ? Series.clean(p.t).t : 'Road Trip Diaries'; });
    await ev(([mock, SHOW]) => {
      window.__asked = [];
      Series.reset(); MediaStore.setTmdbToken('mock-user-token-123456789012345');
      const shows = {
        [SHOW]: { id: 'tmdb:tv:501', title: 'Road Trip Diaries', year: '2016', poster: mock + '/poster/s2.svg', plot: 'Two friends drive every back road in America.', genre: 'Documentary, Travel', rating: '7.8', network: 'Travel Plus', cast: 'Ana Ruiz, Sam Cole', status: 'Returning Series', seasons: [{ number: 0 }, { number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] },
        'Harbor Street': { id: 'tmdb:tv:502', title: 'Harbor Street', year: '2019', poster: mock + '/poster/s5.svg', plot: 'TMDB: a harbour town and its families, over two seasons.', genre: 'Drama', rating: '8.2', network: 'Coastline', cast: 'Mia Park, Leo Brandt, Ada Moss' }
      };
      Media.tvByName = (t, y, st) => { window.__asked.push('show:' + t + '|' + st); return Promise.resolve(shows[t] ? { metadata: shows[t] } : { miss: true }); };
      Media.tvSeason = (id, s) => { window.__asked.push('season:' + id + ':' + s); return Promise.resolve({ metadata: { episodes: Array.from({ length: 10 }, (_, k) => ({ number: k + 1, title: 'TMDB episode ' + s + '.' + (k + 1), plot: 'From TMDB: what happens in episode ' + (k + 1) + ' of season ' + s + ', in more than forty characters.', still: mock + '/poster/s' + (k % 6) + '.svg', airDate: '2019-0' + Math.min(9, s) + '-1' + (k % 9) })) } }); };
      Series.poke();
    }, [MOCK, SHOW]);

    // ---- the guide ----
    await ev(() => { const L = Library, c = L.channels(L.ALL).find((x) => /Prime Plaza/.test(x.n)); Views.switchTab('guide'); Guide.open(L.ALL, c.k); });
    await wait(1500);
    const d = await ev(() => ({ line: [].slice.call(document.querySelectorAll('#guideDetail .gd-movie')).map((x) => x.textContent).join(' | '), poster: !!document.querySelector('#guideDetail .gd-poster'), ep: (document.querySelector('#guideDetail .gd-ep') || {}).textContent || '', et: (document.querySelector('#guideDetail .gd-eptitle') || {}).textContent || '' }));
    ok('a series in the guide: the Series line (when it started, network, genres, rating) and its poster', /^Series\s+·\s+since 2016\s+·\s+Travel Plus\s+·\s+Documentary, Travel\s+·\s+★ 7\.8 TMDB$/.test(d.line) && d.poster, JSON.stringify(d));
    ok('the guide gave its season and episode: TMDB\'s title for that episode in front of its summary', /^S\d+ E\d+$/.test(d.ep) && /^TMDB episode \d+\.\d+$/.test(d.et), JSON.stringify(d));
    await shot('series-guide');
    // Colour by category on: its legend moves to the left of the poster rather than under it.
    await ev(() => { Store.settings.guideTint = true; Guide.draw(); }); await wait(300);
    const lp = await ev(() => { const g = document.getElementById('glegend'), p = document.querySelector('#guideDetail .gd-poster'); if (!g || !p) return null; const a = g.getBoundingClientRect(), b = p.getBoundingClientRect(); return { overlap: a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom, beside: g.classList.contains('beside') }; });
    ok('a poster in the details: the colour legend sits beside it, not under it', !!lp && !lp.overlap && lp.beside, JSON.stringify(lp));
    await ev(() => { Store.settings.guideTint = false; Guide.draw(); });
    // Large text, the Series line, an episode title and the window's line: nothing in the details is cut off at the bottom.
    // The summary gives up lines until it fits, rather than its last line being cut through the middle.
    await ev(() => Views.startChannel(Library.channels(Library.ALL).find((c) => !/Prime Plaza/.test(c.n)), true)); await wait(1500);
    const fit = await ev(() => {
      document.body.classList.add('ts-l');
      const d = document.getElementById('guideDetail'), desc = Epg.desc;
      Epg.desc = () => 'The team and the mayor travel to an island for a festival, and during the visit the group discovers that someone has gone missing, so everyone sets off across the island to look, by boat, by air and on foot, before the storm arrives and the festival has to be called off for the night.';
      Guide.draw();
      const kids = [].filter.call(d.children, (k) => !k.classList.contains('gd-poster') && k.offsetParent);
      const g = d.querySelector('.gd-desc'), lh = parseFloat(getComputedStyle(g).lineHeight), gh = g.offsetParent ? g.getBoundingClientRect().height : 0;
      const r = { cut: kids.filter((k) => k.getBoundingClientRect().bottom > d.getBoundingClientRect().bottom + 1).map((k) => k.className), lines: gh / lh, now: !!d.querySelector('.gd-now'), series: !!d.querySelector('.gd-movie') };
      window.__desc = desc;
      return r;
    });
    await shot('series-fit');
    await ev(() => { Epg.desc = window.__desc; document.body.classList.remove('ts-l'); Views.stopAll(); Guide.draw(); });
    ok('large text with a Series line: the details fit, the summary shortened to whole lines', fit.now && fit.series && !fit.cut.length && Math.abs(fit.lines - Math.round(fit.lines)) < 0.05, JSON.stringify(fit));
    const asked = await ev(() => window.__asked);
    ok('asked about the show once and its season once, nothing about news or sport', asked.filter((a) => a === 'show:' + SHOW + '|strong').length === 1 && asked.filter((a) => /^season:tmdb:tv:501:/.test(a)).length === 1 && !asked.some((a) => /Briefing|World Tonight|Weather|Sports/.test(a)), asked.join(', '));
    // ---- About this show: Info on a series ----
    await ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 457, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 457, bubbles: true })); });
    await wait(1500);
    const pn = await ev(() => ({ title: document.getElementById('modalTitle').textContent, line: (document.querySelector('#modal .sp-line') || {}).textContent || '', poster: !!document.querySelector('#modal .sp-poster'),
      head: (document.querySelector('#modal .sp-head') || {}).textContent || '', eps: [].slice.call(document.querySelectorAll('#modal .sp-ep')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      buttons: [].slice.call(document.querySelectorAll('#modal .mbtns .btn')).map((b) => b.textContent) }));
    ok('Info on a series: About this show, with when it started, network, seasons, still running and rating', pn.title === 'Road Trip Diaries' && /^Since 2016\s+·\s+Travel Plus\s+·\s+4 seasons\s+·\s+still running\s+·\s+★ 7\.8 TMDB$/.test(pn.line) && pn.poster, JSON.stringify(pn).slice(0, 300));
    ok('its next showings on this channel, with TMDB\'s episode titles', /Coming up on Prime Plaza/i.test(pn.head) && pn.eps.length >= 1 && pn.eps.some((e) => /^Now\s*S\d+ E\d+\s*TMDB episode/.test(e)), JSON.stringify(pn.eps));
    ok('and Watch now, a reminder for the next one, Close', pn.buttons[0] === 'Watch now' && pn.buttons[pn.buttons.length - 1] === 'Close', JSON.stringify(pn.buttons));
    await shot('series-panel');
    await ev(() => UI.close()); await wait(300);
    // A news channel: nothing asked, no Series line.
    await ev(() => { const L = Library, c = L.channels(L.ALL).find((x) => /Nova News 24/.test(x.n)); Guide.open(L.ALL, c.k); }); await wait(800);
    ok('news is never looked up as a series', !(await ev(() => window.__asked)).some((a) => /World Tonight|Morning Briefing|Business Hour/.test(a)) && !(await ev(() => !!document.querySelector('#guideDetail .gd-movie'))));

    // ---- the Shows screen ----
    await ev(() => Views.switchTab('shows')); await wait(1500);
    await ev(() => { const r = [].slice.call(document.querySelectorAll('#vodItems .row')); }); 
    const findShow = async (name) => { for (let n = 0; n < 12; n++) { const t = await ev(() => (document.querySelector('#vodInfo h2') || {}).textContent || ''); if (t === name) return true; await page.keyboard.press('ArrowDown'); await wait(250); } return false; };
    await page.keyboard.press('ArrowRight'); await wait(300);
    ok('the Shows screen opens on its shows', await findShow('Harbor Street'), await ev(() => (document.querySelector('#vodInfo h2') || {}).textContent));
    await wait(900);
    const sv = await ev(() => { const b = document.getElementById('vodInfo'); return { img: (b.querySelector('img') || {}).src || '', meta: [].slice.call(b.querySelectorAll('.vod-meta')).map((x) => x.textContent).join(' | '), plot: (b.querySelector('.vod-plot') || {}).textContent || '' }; });
    ok('a show keeps the provider\'s cover and summary, and gets TMDB\'s genres, network and cast', /\/poster\/s0\.svg$/.test(sv.img) && /A small-town harbour/.test(sv.plot) && /Drama/.test(sv.meta) && /Coastline/.test(sv.meta) && /Cast: Mia Park/.test(sv.meta), JSON.stringify(sv));
    await shot('series-show');
    await page.keyboard.press('Enter'); await wait(1500);
    await page.keyboard.press('ArrowDown'); await wait(1200);
    const ep = await ev(() => { const b = document.getElementById('vodInfo'); return { h: (b.querySelector('h2') || {}).textContent || '', img: (b.querySelector('img') || {}).src || '', still: !!b.querySelector('img.still'), meta: [].slice.call(b.querySelectorAll('.vod-meta')).map((x) => x.textContent).join(' | '), plot: (b.querySelector('.vod-plot') || {}).textContent || '' }; });
    ok('an episode keeps the provider\'s title, and gets TMDB\'s summary for a short one, its picture and air date', /New Neighbours/.test(ep.h) && !/TMDB episode/.test(ep.h) && /^From TMDB: what happens in episode 2 of season 1/.test(ep.plot) && ep.still && /aired Jan 11, 2019/.test(ep.meta), JSON.stringify(ep));
    await shot('series-episode');
    // Hide spoilers (discussion #36): an episode you haven't started keeps its title and air date, without its
    // summary or a picture from it.
    await ev(() => { Store.settings.noSpoilers = true; }); await page.keyboard.press('ArrowUp'); await wait(600); await page.keyboard.press('ArrowDown'); await wait(1200);
    const sp = await ev(() => { const b = document.getElementById('vodInfo'); return { h: (b.querySelector('h2') || {}).textContent || '', still: !!b.querySelector('img.still'), meta: [].slice.call(b.querySelectorAll('.vod-meta')).map((x) => x.textContent).join(' | '), plot: (b.querySelector('.vod-plot') || {}).textContent || '' }; });
    ok('Hide spoilers: an episode not started keeps its title and air date, no summary or picture from it', /New Neighbours/.test(sp.h) && /aired Jan 11, 2019/.test(sp.meta) && /^Summary hidden/.test(sp.plot) && !sp.still, JSON.stringify(sp));
    await shot('series-episode-nospoil');
    await ev(() => { Store.settings.noSpoilers = false; });
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all TMDB series checks passed');
  process.exit(fails ? 1 : 0);
})();
