/* My teams in the real app (app/js/teams.js).
     MOCK_EVENTS=1 MOCK_TEAMS=1 MOCK_PORT=8089 node tests/mock/mock_provider.js &   (team channels and league pass games)
     npm run serve &                                                              (app on :8078 and the dev relay)
     node tests/soak/my-teams.js [--shots dir]
   Checks the picker (leagues found, teams with their own channel), following from the picker and from
   Hold OK on a team channel, the My teams group's order (games on now, next games, team channels), the
   group's menu, turning it off, and reminders for the games. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8089';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 240) : '')); if (!c) fails++; };
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
  const H = R.helpers(page);

  ok('no My teams group before following a team', await ev(() => !Library.groups().some(g => g.id === Library.TEAMS)));
  // Settings > Channels and groups > My teams
  await H.section('Channels and groups', true, true); await H.row('My teams'); await H.quiet('Enter', 900);
  let st = await page.innerText('#setBody');
  ok('the My teams page lists the leagues found', /NHL/.test(st) && /NFL/.test(st) && !/\bMLB\b/.test(st.split('Leagues')[1] || '') && /and college football \(the FBS schools\)/.test(st) && /College Football\s*Games only/.test(st) && /4 teams have their own channel/.test(st), st.replace(/\s+/g, ' ').slice(0, 300));
  await shot('tv-teams-page');
  await H.row('NHL'); await H.quiet('Enter', 900);
  st = await page.innerText('#setBody');
  ok('the league page lists every team, marking the ones with a channel', /Winnipeg Jets\s*Has its own channel/.test(st) && /Vegas Golden Knights/.test(st), st.replace(/\s+/g, ' ').slice(0, 300));
  await H.row('Winnipeg Jets'); await H.quiet('Enter', 700);
  ok('OK follows the team', await ev(() => Teams.follows('nhl:wpg')));
  await shot('tv-teams-nhl');
  await H.quiet('Escape', 700);
  st = await page.innerText('#setBody');
  ok('back on My teams: 1 followed, and the Following list', /1 followed/.test(st) && /Following/.test(st) && /Winnipeg Jets/.test(st), st.replace(/\s+/g, ' ').slice(0, 300));

  const order = await ev(() => Library.channels(Library.TEAMS).map(c => c.n));
  ok('My teams: the game on now first', /WPG VS CAR/.test(order[0]), order.join(' / '));
  ok('then the next game', /Anaheim Ducks Winnipeg Jets/.test(order[1]), order.join(' / '));
  ok('and no team channel without a game soon', order.indexOf('NHL | WINNIPEG JETS') < 0 && order.length === 2, order.join(' / '));
  // In the guide's My teams, a channel whose game is later says "Next game …" up to it, like team channels,
  // in the sports colour; the same channel elsewhere keeps its guide.
  const ng = await ev(async () => {
    // A channel like a regional sports network: its own programmes on now, the game later tonight.
    const now = Date.now(), c = Library.data.channels.find((x) => { const l = Epg.request(x) || []; return !Events.of(x) && l.filter((p) => p.s > now + 3600e3).length >= 2 && l.some((p) => p.s <= now && p.e > now && !p.up); });
    if (!c) return { none: true };
    const l = Epg.request(c), game = l.find((p) => p.s > now + 3600e3), keepL = Teams.list, keepG = Teams.gameOn;
    Teams.list = () => [c]; Teams.gameOn = (x) => (x.k === c.k ? game : null);
    Store.settings.guideTint = true; Views.switchTab('guide'); Guide.open(Library.TEAMS, c.k); await new Promise((r) => setTimeout(r, 900));
    const cell = document.querySelector('.grow.sel .gp.focus'), t = cell ? cell.textContent : '';
    const green = cell ? /\bk-s\b/.test(cell.className) : false, gameCell = [].some.call(document.querySelectorAll('.grow.sel .gp'), (x) => x.textContent.indexOf(game.t) === 0);
    Guide.open(Library.ALL, c.k); await new Promise((r) => setTimeout(r, 900));
    const plain = (document.querySelector('.grow.sel .gp.focus') || {}).textContent || '';
    Teams.list = keepL; Teams.gameOn = keepG;
    return { name: c.n, game: game.t, t, green, gameCell, plain };
  });
  ok('My teams in the guide: a channel with a game later says Next game up to it, in the sports colour', !ng.none && /^Next game .+: /.test(ng.t) && ng.t.indexOf(ng.game) >= 0 && ng.green, JSON.stringify(ng));
  ok('and in other groups it keeps its own guide', !ng.none && !/^Next game/.test(ng.plain), JSON.stringify(ng));
  const gs = await ev(() => Library.groups().map(g => g.name));
  ok('the group sits near the top', gs.indexOf('My teams') >= 0 && gs.indexOf('My teams') <= 2, gs.slice(0, 5).join(', '));

  // Hold OK on a team channel: Follow.
  const red = await ev(() => { const c = Library.data.channels.find(c => c.n === 'NHL | DETROIT RED WINGS'); Views.chanMenu(c, c.g); return c.k; });
  await page.waitForTimeout(700);
  const menu = await page.innerText('#menu').catch(() => ev(() => document.body.innerText));
  ok('a team channel offers Follow', /Follow the Detroit Red Wings/.test(menu), menu.replace(/\s+/g, ' ').slice(0, 200));
  await shot('tv-teams-follow');
  await ev(() => { const it = [...document.querySelectorAll('.menu .item, #menu .item, .mi')].find(x => /Follow the Detroit/.test(x.innerText)); if (it) it.click(); });
  await page.waitForTimeout(700);
  if (!(await ev(() => Teams.follows('nhl:det')))) { await ev(() => { UI.closeAll && UI.closeAll(); Teams.follow('nhl:det', true); Views.refreshLists(true); }); ok('Follow from the menu (clicked)', false); }
  else ok('Follow from the menu', true);
  await ev(() => { while (UI.modalOpen) { const m = document.querySelector('.modal, #menu'); document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true })); if (!m) break; break; } });
  await page.waitForTimeout(500);
  const order2 = await ev(() => Library.channels(Library.TEAMS).map(c => c.n));
  ok('the Red Wings game joins the group, at the bottom (it starts later)', /Boston Bruins Detroit Red Wings/.test(order2[order2.length - 1]) && order2.indexOf('NHL | DETROIT RED WINGS') < 0, order2.join(' / '));

  // The guide on My teams.
  await ev(() => { Views.switchTab('guide'); }); await page.waitForTimeout(1500);
  // The guide opens on its group list here: up to My teams, then OK.
  for (let n = 0; n < 6; n++) {
    const cur = await ev(() => { const s = document.querySelector('#viewGuide .sel, #viewGuide .selected, #viewGuide .focus'); return s ? s.innerText : ''; });
    if (/My teams/.test(cur)) break;
    await H.quiet('ArrowUp', 400);
  }
  await H.quiet('Enter', 1500);
  const grid = (await page.innerText('#viewGuide').catch(() => '')).replace(/\s+/g, ' ');
  ok('the guide shows My teams', /My teams/.test(grid) && /WPG vs CAR|Hurricanes/.test(grid), grid.slice(0, 300));
  await shot('tv-teams-guide');

  // Reminders for the games: off by default, then on.
  ok('no reminders while that is off', await ev(() => Store.edits.reminders.filter(r => /^team:/.test(r.w || '')).length === 0 && (Watch.scan(true), Store.edits.reminders.filter(r => /^team:/.test(r.w || '')).length === 0)));
  const rem = await ev(() => { Store.settings.teamsRemind = true; Watch.scan(true); return Store.edits.reminders.filter(r => /^team:/.test(r.w || '')).map(r => r.t); });
  ok('with it on, the coming games get reminders (not the one on now)', rem.length === 2 && !rem.some(t => /WPG/.test(t)), rem.join(' / '));
  const left = await ev(() => { Teams.follow('nhl:det', false); return Store.edits.reminders.filter(r => /^team:/.test(r.w || '')).map(r => r.t); });
  ok('unfollowing takes its reminders', left.length === 1 && /Winnipeg/.test(left[0]), left.join(' / '));

  // Reminders an earlier TiviBro set for placeholders and "Next game" blocks are taken off; real ones stay.
  const tidied = await ev(() => {
    const k = Library.data.channels[0].k, t = Date.now() + 3600e3;
    Store.edits.reminders.push({ k, s: t, e: t + 3600e3, t: 'Future Events for Detroit Tigers not found yet', w: 'team:mlb:det' },
      { k, s: t + 60e3, e: t + 3600e3, t: 'Next game: Detroit Red Wings at Florida Panthers at 11/02/2026 07:00 PM (US/Eastern)', w: 'team:nhl:det' },
      { k, s: t + 120e3, e: t + 3600e3, t: 'Boston Bruins at Detroit Red Wings', w: 'team:nhl:det' },
      { k, s: t + 180e3, e: t + 3600e3, t: 'Live: NFL Football', w: 'team:nfl:det', g: Teams.RULES },
      // Set under older rules: a school's basketball game taken for football.  Looked at again, and it goes.
      { k, s: t + 200e3, e: t + 3600e3, t: 'Marquette Golden Eagles vs Michigan Wolverines', w: 'team:ncaaf:mich', g: 1 },
      // Started while TiviBro was closed: these came up on opening alpha 51.
      { k, s: t - 2 * 3600e3, e: t + 3600e3, t: 'Next game: Detroit Pistons at Charlotte Hornets at 11/02/2026 07:30 PM EST', w: 'team:nba:det' },
      // Set by hand on a placeholder.
      { k, s: t + 240e3, e: t + 3600e3, t: 'No future events scheduled' });
    const gone = Watch.tidy();
    return { gone, left: Store.edits.reminders.filter((r) => /^team:/.test(r.w || '')).map((r) => r.t) };
  });
  // And one that slips through is never asked about.
  const asked = await ev(() => {
    const k = Library.data.channels[0].k, t = Date.now() - 600e3, m = UI.menu; let got = [];
    UI.menu = (title) => { got.push(title); };
    Store.edits.reminders.push({ k, s: t, e: t + 7200e3, t: 'Next game: Detroit Red Wings at Florida Panthers', w: 'team:nhl:det' });
    Views.dueReminder(Date.now());
    UI.menu = m;
    return { got, left: Store.edits.reminders.filter((r) => /Florida Panthers/.test(r.t)).length };
  });
  ok('placeholder reminders are not asked about on opening', !asked.got.some((x) => /Next game/.test(x)), JSON.stringify(asked));
  ok('placeholder and "Next game" reminders removed, started or not, and one set under older rules that is no game; games kept', tidied.gone === 5 && tidied.left.indexOf('Marquette Golden Eagles vs Michigan Wolverines') < 0 && tidied.left.indexOf('Boston Bruins at Detroit Red Wings') >= 0 && tidied.left.indexOf('Live: NFL Football') >= 0, JSON.stringify(tidied));

  // Between games the group stays, empty, and says when the next game is.
  const between = await ev(() => {
    const keep = Teams.list; Teams.list = () => [];
    Teams.dirty();
    const inList = Library.groups().some((g) => g.id === Library.TEAMS);
    const ids = Library.groups().map((g) => g.id), pos = ids.indexOf(Library.TEAMS), all = ids.indexOf(Library.ALL), fav = ids.indexOf('c_fav');
    const text = Views.emptyFor(Library.TEAMS);
    Teams.list = keep; Teams.dirty();
    return { inList, text, next: Teams.nextGame() && Teams.nextGame().p.t, below: pos > all && pos > fav };
  });
  ok('with no game in the window the group stays', between.inList, JSON.stringify(between));
  ok('but moves down, under your groups and All channels, out of the way', between.below, JSON.stringify(between));
  ok('and says when the next game is', /^No games on now or in the next 6 hours\.  Next: .+, (Today|Tomorrow|\w{3}) \d+:\d\d[ap]m on .+\.$/.test(between.text), between.text);
  ok('other groups keep their own empty text', /Copy to group/.test(await ev(() => Views.emptyFor('nope'))));

  // The group's menu: turn it off.
  const items = await ev(() => { let got = null; const m = UI.menu; UI.menu = (t, l) => { got = l.filter(Boolean).map(x => x.label); }; Views.groupMenu({ id: Library.TEAMS, name: 'My teams' }); UI.menu = m; return got; });
  ok('the group menu has Choose teams and Turn off', items && items.indexOf('Choose teams…') >= 0 && items.indexOf('Turn off My teams') >= 0, items && items.join(', '));
  await ev(() => { Store.settings.teamsGroup = false; Views.refreshLists(); });
  ok('turned off, the group goes', await ev(() => !Library.groups().some(g => g.id === Library.TEAMS)));
  await ev(() => { Store.settings.teamsGroup = true; Views.refreshLists(); });
  ok('the phone app sees the same pages', await ev(() => { const i = Settings.phone.page('groups', []).rows.findIndex(x => x.label === 'My teams'); const r = Settings.phone.page('groups', [i]).rows; return r.some(x => x.label === 'Remind me before their games') && r.some(x => x.kind === 'page' && x.label === 'NHL'); }).catch(e => e.message));

  // College football: a school's games by its full name in event channels, not its basketball games.
  const cf = await ev(() => {
    Teams.follow('nhl:wpg', false); Teams.follow('ncaaf:mich', true); Teams.dirty(); Views.refreshLists(true);
    const l = Library.channels(Library.TEAMS).map(c => c.n);
    const lg = Teams.leagues().map(x => x.name), names = Teams.inLeague('ncaaf').length;
    Teams.follow('ncaaf:mich', false); Teams.dirty();
    return { l, lg, names, game: Teams.isGame('College Football : Alabama at LSU', 'ESPN'), fcs: Teams.isGame('College Football: Michigan vs. Central Connecticut', 'BTN') };
  });
  ok('college football: the league is offered, with the FBS schools', cf.lg.indexOf('College Football') >= 0 && cf.names > 130, JSON.stringify(cf));
  ok('a followed school\'s game is in My teams, its basketball game is not', cf.l.length === 1 && /Ohio State Buckeyes Michigan Wolverines/.test(cf.l[0]), JSON.stringify(cf.l));
  ok('guide titles by school name are games, against an FCS school too', cf.game && cf.fcs, JSON.stringify(cf));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
