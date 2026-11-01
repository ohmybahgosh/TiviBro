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
  // Settings > Groups, sorting, hidden > My teams
  await H.section('Groups, sorting, hidden', true, true); await H.row('My teams'); await H.quiet('Enter', 900);
  let st = await page.innerText('#setBody');
  ok('the My teams page lists the leagues found', /NHL/.test(st) && /NFL/.test(st) && !/\bMLB\b/.test(st.split('Leagues')[1] || '') && /main North American leagues only/.test(st) && /4 teams have their own channel/.test(st), st.replace(/\s+/g, ' ').slice(0, 300));
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
  ok('then the next game', /Carolina Hurricanes Winnipeg Jets/.test(order[1]), order.join(' / '));
  ok('and no team channel without a game soon', order.indexOf('NHL | WINNIPEG JETS') < 0 && order.length === 2, order.join(' / '));
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

  // The group's menu: turn it off.
  const items = await ev(() => { let got = null; const m = UI.menu; UI.menu = (t, l) => { got = l.filter(Boolean).map(x => x.label); }; Views.groupMenu({ id: Library.TEAMS, name: 'My teams' }); UI.menu = m; return got; });
  ok('the group menu has Choose teams and Turn off', items && items.indexOf('Choose teams…') >= 0 && items.indexOf('Turn off My teams') >= 0, items && items.join(', '));
  await ev(() => { Store.settings.teamsGroup = false; Views.refreshLists(); });
  ok('turned off, the group goes', await ev(() => !Library.groups().some(g => g.id === Library.TEAMS)));
  await ev(() => { Store.settings.teamsGroup = true; Views.refreshLists(); });
  ok('the phone app sees the same pages', await ev(() => { const i = Settings.phone.page('groups', []).rows.findIndex(x => x.label === 'My teams'); const r = Settings.phone.page('groups', [i]).rows; return r.some(x => x.label === 'Remind me before their games') && r.some(x => x.kind === 'page' && x.label === 'NHL'); }).catch(e => e.message));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
