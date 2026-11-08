/* Sports guides (Settings > Guide > Public guide fill-in > Sports guides): EPGTalk and epgshare01 for US sports
   channels, read by the helper.  Against the mock's copies:
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/sports-guides.js
   The provider's guide has two days; a sports guide with more stands in for a sports channel (six days
   from EPGTalk, three from epgshare01) where the two agree on what's on, other channels keep theirs, a
   sports guide with another channel's programmes doesn't win however many days it has, and switching
   it off brings the provider's back.  Only the channels matched are kept. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl], pubEpgBase: MOCK + '/pubepg/' } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  const settled = () => page.waitForFunction(() => Epg.pubStatus && Epg.pubStatus.at && !Epg.loading && !(Epg.progress && Epg.progress.active), null, { timeout: 90000 });
  try {
    await ev(() => Epg.pubAgain()); await settled(); await page.waitForTimeout(1500);
    const look = () => ev(() => {
      const now = Date.now(), one = (n) => {
        const c = Library.data.channels.find((x) => x.n === n), id = Epg.epgId(c), l = Epg.request(c) || [];
        return { n, id, days: l.length ? Math.round((l[l.length - 1].e - now) / 86400e3 * 10) / 10 : 0, t: (l.find((p) => p.s <= now && p.e > now) || {}).t || '' };
      };
      return { s1: one('US| Summit Sports 1 FHD'), arena: one('US| Arena Live HD'), fast: one('US| Fastbreak TV HD'), news: one('US| Nova News 24 FHD'), goal: one('US| Goal Line FHD'), sources: Epg.pubStatus.sources };
    });
    let r = await look();
    ok('the sports guides were read by the helper', r.sources.some((x) => /EPGTalk US/.test(x.url) && x.ok && x.filled >= 2), JSON.stringify(r.sources));
    ok('a sports channel with two days of provider guide gets EPGTalk\'s, as far as Guide days goes', /^epgtalkus:US\//.test(r.s1.id) && r.s1.days > 2.5 && r.s1.t, JSON.stringify(r.s1));
    ok('a sports guide with six days of another channel\'s programmes does not win', !/:US\//.test(r.goal.id) && r.goal.days <= 2.2, JSON.stringify(r.goal));
    ok('matched by its group too (Arena Live in a Sports group)', /^epgtalkus:US\//.test(r.arena.id) && r.arena.days > 2.5, JSON.stringify(r.arena));
    ok('epgshare01\'s three days beat two as well', /^epgshare:US\//.test(r.fast.id) && r.fast.days > 2, JSON.stringify(r.fast));
    ok('a channel that is not sports keeps its own guide', !/:US\//.test(r.news.id) && r.news.days <= 2.2, JSON.stringify(r.news));
    // Switched off: the provider's guide again.
    await ev(() => { PubEpg.set(Store.playlist, { sports: false }); Store.upsertPlaylist(Store.playlist); Epg.refresh(Library, false); });
    await settled(); await page.waitForTimeout(1500);
    r = await look();
    ok('Sports guides off: the provider\'s guide again', !/:US\//.test(r.s1.id) && r.s1.days <= 2.2 && !/epgtalk|epgshare/.test(JSON.stringify(r.sources)), JSON.stringify(r.s1) + ' ' + JSON.stringify(r.sources));
    await ev(() => { PubEpg.set(Store.playlist, { sports: true }); Store.upsertPlaylist(Store.playlist); });
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('harness: ' + e.message, false); }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all sports guide checks passed');
  process.exit(fails ? 1 : 0);
})();
