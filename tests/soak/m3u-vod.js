/* Movies and shows from an M3U list (plshape.js { vod: true }, service/vod.js, vod.js).  Many providers
   give one M3U link with their films and series in it: those become Movies and Shows, not channels.
     node tests/mock/mock_provider.js &      (on :8077, serves the streams)
     npm run serve &                         (app on :8078, dev helper on :47811)
     node tests/soak/m3u-vod.js [--shots dir]
   Checks: the channel list has only the live channels; Movies and Shows appear in the menu; the movies
   are there by category; a show's episodes come in season order with their own links; playing a movie
   and an episode uses the links from the list; a list without films has no Movies or Shows. */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8077';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

const L = (name, group, url, logo) => '#EXTINF:-1 tvg-name="' + name + '" tvg-logo="' + (logo || '') + '" group-title="' + group + '",' + name + '\n' + url + '\n';
let LIST = '#EXTM3U\n' +
  L('News One', 'News', MOCK + '/live/u/p/1.ts') + L('Sports One', 'Sports', MOCK + '/live/u/p/2.ts') + L('Kids One', 'Kids', MOCK + '/live/u/p/3.ts') +
  L('Big Film (2020)', 'Films | Action', MOCK + '/movie/u/p/11.mp4', MOCK + '/logo/1.svg') + L('Quiet Film (2019)', 'Films | Drama', MOCK + '/movie/u/p/12.mkv') + L('Loud Film (2021)', 'Films | Action', MOCK + '/movie/u/p/13.mp4') +
  L('Test Show S01 E02', 'Series | Drama', MOCK + '/series/u/p/22.mp4') + L('Test Show S01 E01', 'Series | Drama', MOCK + '/series/u/p/21.mp4') + L('Test Show S02 E01', 'Series | Drama', MOCK + '/series/u/p/23.mp4') +
  L('Other Show S01E01', 'Series | Comedy', MOCK + '/series/u/p/31.mp4');
const LIVE_ONLY = '#EXTM3U\n' + L('News One', 'News', MOCK + '/live/u/p/1.ts') + L('Sports One', 'Sports', MOCK + '/live/u/p/2.ts');

(async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }); res.end(/live-only/.test(req.url) ? LIVE_ONLY : LIST); }).listen(8095, '127.0.0.1');
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // An M3U playlist with films and series in it.
  // The demo playlist goes off, so this one is the only playlist in use (every playlist that is on is used at once).
  await ev(() => { const d = Store.byId('p1'); d.off = true; Store.upsertPlaylist(d); Store.upsertPlaylist({ id: 'mv1', name: 'M3U with films', type: 'm3u', m3u: 'http://127.0.0.1:8095/list.m3u' }); App.switchPlaylist('mv1'); });
  await page.waitForFunction(() => Store.settings.active === 'mv1' && window.Library && Library.count() > 0 && document.getElementById('viewSetup').classList.contains('hidden'), null, { timeout: 30000 }).catch(() => {});
  const ch = await ev(() => Library.data.channels.map((c) => c.n));
  ok('the channel list has only the live channels', ch.join() === 'News One,Sports One,Kids One', ch.join());
  const vod = await ev(() => Store.playlist.vod);
  ok('the playlist knows it has movies and shows', vod && vod.m3u && vod.movies && vod.series, JSON.stringify(vod));
  await ev(() => Views.buildTabs());
  const tabs = await ev(() => [].slice.call(document.querySelectorAll('.tab .lbl')).map((x) => x.textContent));
  ok('Movies and Shows are in the menu', tabs.indexOf('Movies') >= 0 && tabs.indexOf('Shows') >= 0, tabs.join(', '));

  // Movies.
  await ev(() => Views.switchTab('movies'));
  await page.waitForFunction(() => /Big Film/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  const mv = await ev(() => document.body.innerText);
  ok('the movies are there, by category', /Big Film/.test(mv) && /Quiet Film/.test(mv) && /Loud Film/.test(mv) && /Films \| Action|Action/.test(mv), mv.slice(0, 300));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'm3u-movies.png') });
  await ev(() => Vod.prepare());
  const all = await ev(() => Vod.allItems().map((x) => x.kind + ':' + x.it.name).sort());
  ok('Search sees them too', all.join() === 'movie:Big Film (2020),movie:Loud Film (2021),movie:Quiet Film (2019),series:Other Show,series:Test Show', all.join());
  // Play a movie: the link from the list.
  let urls = [];
  page.on('request', (q) => { if (/\/(movie|series)\/u\/p\//.test(q.url())) urls.push(q.url()); });
  await ev(() => { const it = Vod.allItems().filter((x) => x.it.name === 'Quiet Film (2019)')[0]; Vod.openItem({ it: it.it, kind: 'movie', fromStart: true }); });
  await page.waitForTimeout(3000);
  ok('playing a movie uses its link from the list', urls.some((u) => /\/movie\/u\/p\/12\.mkv/.test(u)), urls.join(' '));
  await ev(() => Views.stopAll());

  // Shows: episodes in order, each with its own link.
  const eps = await ev(() => { const s = Vod.allItems().filter((x) => x.it.name === 'Test Show')[0].it; return Source.seriesInfo(s.id).then((r) => Object.keys(r.episodes).map((sn) => sn + ':' + r.episodes[sn].map((e) => e.episode_num + '@' + e.direct_source.split('/').pop()).join(','))); });
  ok('a show\'s episodes come by season, in order, with their links', eps.join(' | ') === '1:1@21.mp4,2@22.mp4 | 2:1@23.mp4', eps.join(' | '));
  urls = [];
  await ev(() => { Views.switchTab('shows'); const s = Vod.allItems().filter((x) => x.it.name === 'Test Show')[0].it; Vod.openItem({ it: s, kind: 'series', ep: null, fromStart: true }); });
  await page.waitForTimeout(2500);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'm3u-show.png') });
  const shown = await ev(() => document.body.innerText);
  ok('opening a show lists its episodes', /3 episodes/.test(shown) && /S1 E1/.test(shown), shown.slice(0, 300));
  await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
  ok('playing an episode uses its link from the list', urls.some((u) => /\/series\/u\/p\/2[13]\.mp4/.test(u)), urls.join(' '));
  await ev(() => Views.stopAll());

  // A list with no films: no Movies or Shows.
  await ev(() => { Store.upsertPlaylist({ id: 'mv2', name: 'Live only', type: 'm3u', m3u: 'http://127.0.0.1:8095/live-only.m3u' }); App.switchPlaylist('mv2'); });
  await page.waitForFunction(() => Store.settings.active === 'mv2' && window.Library && Library.count() === 2, null, { timeout: 30000 }).catch(() => {});
  const tabs2 = await ev(() => [].slice.call(document.querySelectorAll('.tab .lbl')).map((x) => x.textContent));
  ok('a list without films has no Movies or Shows', tabs2.indexOf('Movies') < 0 && tabs2.indexOf('Shows') < 0, tabs2.join(', '));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'all M3U movie and show checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
