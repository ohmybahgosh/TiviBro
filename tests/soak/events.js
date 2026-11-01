/* Event channels in the real app: names that carry the matchup and time (pay-per-view, league passes).
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &      (event channels around now)
     npm run serve &                                                       (app on :8078 and the dev relay)
     node tests/soak/events.js [--shots dir]
   Checks the short names, the Events by time group, the guide entries made from the names (before,
   during and after an event), that a real guide still wins, and the Event channels settings page. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 200) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await page.waitForTimeout(3000);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const ev = (f, a) => page.evaluate(f, a);
  const find = re => ev(r => { const c = Library.data.channels.find(c => new RegExp(r).test(c.n)); return c && c.k; }, re);

  const names = await ev(() => Library.data.channels.filter(c => /PPV|NCAAB|NFL \d/.test(c.n)).map(c => Library.name(c)));
  ok('event channels get short names', ['PPV 01', 'PPV 02', 'NCAAB 002', 'NFL 1'].every(n => names.indexOf(n) >= 0), names.join(', '));
  const g = await ev(() => { const g = Library.groups().find(x => x.id === Library.EVENTS); return g && { count: g.count, list: Library.channels(Library.EVENTS).map(c => Library.name(c)) }; });
  ok('Events by time lists what is on or still to come, soonest first', g && g.count === 9 && g.list[0] === 'PPV 01' && g.list.indexOf('NFL 3') < 0, g && g.list.join(', '));
  const nn = await ev(ks => ks.map(k => { const n = Epg.nowNext(Library.find(k)); return n && n.now ? n.now.t + ' | ' + (n.next ? n.next.t : '') : 'none'; }),
    [await find('^PPV 01'), await find('^PPV 02'), await find('^NFL 3')]);
  ok('on now: the event itself', /^UFC: Prelims \|/.test(nn[0]), nn[0]);
  ok('before it starts: "Starts ...", then the event', /^Starts .*: Main Card: Rivera v Okafor \| Main Card: Rivera v Okafor$/.test(nn[1]), nn[1]);
  ok('long over: says it ended, so it never looks live', /^Ended .*: Desert Hawks @ Summit Miners \| $/.test(nn[2]), nn[2]);
  ok('and with Hide channels with nothing on, it leaves the lists', await ev(k => { const n = Store.playlist.names || (Store.playlist.names = Names.defaults()); n.hideIdle = true; Library.dirty(); const gone = !Library.channels(Library.find(k).g).some(c => c.k === k); n.hideIdle = false; Library.dirty(); return gone; }, await find('^NFL 3')));
  const real = await ev(() => { const c = Library.data.channels.find(c => c.epg); const l = Epg.request(c); return !l || !l.length || !l[0].up; });
  ok('channels with a real guide keep it', real);

  // Channel list in the Events by time group, then the guide.
  await ev(() => { Views.switchTab('live'); Views.group = Library.EVENTS; Views.refreshLists(true); }); await page.waitForTimeout(1500);
  const rows = (await page.innerText('#chanList')).replace(/\n+/g, ' / ');
  ok('the channel list shows the event under the short name', /PPV 02 \/ Starts [^/]*: Main Card: Rivera v Okafor/.test(rows), rows.slice(0, 300));
  await shot('tv-events-list');
  await ev(() => Views.switchTab('guide')); await page.waitForTimeout(2000); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1200);
  const grid = await page.innerText('#viewGuide').catch(() => '');
  ok('the guide shows the events at their times', /Rivera v Okafor/.test(grid) && /NORTH RIVER @ LAKESIDE STATE/.test(grid), grid.replace(/\s+/g, ' ').slice(0, 200));
  await shot('tv-events-guide');

  // Settings > Playlists > the playlist > Event channels
  const H = R.helpers(page);
  await H.section('Playlists and guide', true, true); await H.row('Demo provider'); await H.quiet('Enter', 900);
  await H.row('Event channels'); await H.quiet('Enter', 900);
  const st = await page.innerText('#setBody');
  ok('the Event channels page lists the events and the time zone choice', /Read events from channel names/.test(st) && /Times with no time zone are in/.test(st) && /event channels in this playlist/.test(st), st.replace(/\s+/g, ' ').slice(0, 200));
  await shot('tv-set-events');
  // Switching it off brings the full names back and the group goes.
  await ev(() => { const p = Store.playlist; p.events = { on: false }; Store.upsertPlaylist(p); Events.reset(); Library.dirty(); });
  const off = await ev(() => ({ n: Library.name(Library.data.channels.find(c => /^PPV 02/.test(c.n))), g: Library.groups().some(x => x.id === Library.EVENTS) }));
  ok('off: full names and no Events by time', /Rivera v Okafor/.test(off.n) && !off.g, JSON.stringify(off));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all event channel tests passed');
  process.exit(fails ? 1 : 0);
})();
