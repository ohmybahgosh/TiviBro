/* Settings with the channel still playing in the corner, Search settings (Yellow, discussion #60), and a held
   ◀ at now in the guide going back in time (not to the side menu).
     node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/settings-pip.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  // Every row's text, whole: nothing cut off (an element whose text is wider than it, clipped), and no row under the picture.
  const audit = () => ev(async () => {
    const bad = [], under = [];
    for (const s of Settings.phone.sections()) {
      Settings.section(s.id); await new Promise((r) => setTimeout(r, 100));
      const st = document.getElementById('stage'), sr = st.getBoundingClientRect(), on = !st.classList.contains('off'), br = document.getElementById('setBody').getBoundingClientRect();
      document.querySelectorAll('#setBody .opt, #setNav > div').forEach((el) => {
        [el, ...el.querySelectorAll('*')].forEach((x) => { if (x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow === 'hidden') bad.push(s.id + ': ' + x.textContent.trim().slice(0, 50)); });
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top, br.top), bot = Math.min(r.bottom, br.bottom);   // the part of the row the list shows
        if (on && el.closest('#setBody') && bot > top && bot > sr.top && top < sr.bottom && r.right > sr.left && r.left < sr.right) under.push(s.id + ': ' + el.textContent.trim().slice(0, 40));
      });
    }
    return { bad, under };
  });
  await ev(() => Views.switchTab('settings'));
  const before = await audit();
  ok('Settings with nothing playing: no corner picture', await ev(() => !document.getElementById('viewSettings').classList.contains('pip') && Player.current == null || !Views.playing));
  await ev(() => { Views.switchTab('guide'); Views.startChannel(Library.channels(Library.ALL)[2], true); });
  await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }); await page.waitForTimeout(1000);
  await ev(() => Views.switchTab('settings')); await page.waitForTimeout(1200);
  const st = await ev(() => ({ pip: Views.pipOn, stage: document.getElementById('stage').getBoundingClientRect().toJSON(), slot: document.getElementById('setPreview').getBoundingClientRect().toJSON(), t0: document.getElementById('video').currentTime, info: document.querySelector('.set-now-info').innerText }));
  ok('Settings: the channel keeps playing in the top corner', st.pip && Math.abs(st.stage.left - st.slot.left) < 2 && Math.abs(st.stage.top - st.slot.top) < 2 && st.stage.width === st.slot.width, JSON.stringify(st));
  ok('with its name and what is on beside it', /Now playing/.test(st.info) && st.info.split('\n').length >= 2, st.info);
  const after = await audit();
  ok('no setting cut off with the picture there (none more than without it)', after.bad.length <= before.bad.length && after.bad.every((x) => before.bad.indexOf(x) >= 0), JSON.stringify(after.bad.filter((x) => before.bad.indexOf(x) < 0)));
  ok('no setting under the picture', !after.under.length, JSON.stringify(after.under.slice(0, 5)));
  await page.waitForTimeout(1500);
  ok('and it is still playing after going through every section', await ev(() => Views.pipOn && document.getElementById('video').currentTime) > st.t0);
  // A player setting starts it again; the set-up screen stops it.
  await ev(() => { Settings.section('playback'); }); await page.waitForTimeout(200);
  await ev(() => { window.__r = 0; const r = Player.retryNow; Player.retryNow = function () { window.__r++; return r.apply(this, arguments); }; Views.pipRestart(); });
  await page.waitForTimeout(1900);
  ok('a player setting changed: the picture starts again with it', await ev(() => window.__r) === 1);
  ok('the corner says how to get back', /Hold OK/.test(await ev(() => document.querySelector('.set-now-info').innerText)));
  // Search settings.
  await ev(() => UI.press('yellow')); await page.waitForTimeout(300);
  ok('Yellow asks what to look for', await ev(() => !!document.querySelector('#modal input')));
  await page.fill('#modal input', 'subtitle'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  const found = await ev(() => [...document.querySelectorAll('#setBody .opt')].map((e) => e.innerText.split('\n')[0]));
  ok('it lists the settings with that word', found.indexOf('Subtitle colour') >= 0 && found.indexOf('Keep downloaded subtitles') >= 0, found.join(' | '));
  await ev(() => [...document.querySelectorAll('#setBody .opt')].find((e) => /^Keep downloaded subtitles/.test(e.innerText)).click()); await page.waitForTimeout(400);
  ok('OK on one goes there, focused', JSON.stringify(await ev(() => [document.querySelector('#setNav .on').innerText, document.querySelector('#setBody .opt.focus').innerText.split('\n')[0]])) === JSON.stringify(['Audio and subtitles', 'Keep downloaded subtitles']));
  await ev(() => UI.press('yellow')); await page.waitForTimeout(300);
  await page.fill('#modal input', 'movies on now'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  await ev(() => [...document.querySelectorAll('#setBody .opt')].find((e) => /^Show Movies on now/.test(e.innerText)).click()); await page.waitForTimeout(400);
  ok('and into the page it is on', JSON.stringify(await ev(() => [document.querySelector('#setBody .opt.head').innerText, document.querySelector('#setBody .opt.focus').innerText.split('\n')[0]])) === JSON.stringify(['Groups in the list', 'Show Movies on now']));
  await ev(() => UI.press('yellow')); await page.waitForTimeout(300);
  await page.fill('#modal input', 'zzqx'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  ok('nothing found says so', /No setting has that/.test(await ev(() => document.getElementById('setBody').innerText)));
  await ev(() => App.setup('new')); await page.waitForTimeout(400);
  ok('the set-up screen stops the corner picture', await ev(() => !Views.playing && !Views.pipOn));
  await ev(() => UI.press('back')); await page.waitForTimeout(500);
  // The guide: a held ◀ at now goes back in time.
  await ev(() => { Views.switchTab('guide'); }); await page.waitForTimeout(1200);
  await ev(() => { Views.closeNav(); UI.press('right'); }); await page.waitForTimeout(500);
  // A remote whose repeats start late: ◀ held down 900 ms before the first repeat.
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(900);
  for (let i = 0; i < 10; i++) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(60); }
  await page.keyboard.up('ArrowLeft'); await page.waitForTimeout(700);
  ok('a held ◀ at now goes back in time, not to the menu', await ev(() => !document.body.classList.contains('nav-open') && !/groups-open/.test(document.getElementById('viewGuide').className) && document.getElementById('gnowh').style.display === 'none'));
  // A quick press of ◀ at now still opens the groups.
  await ev(() => UI.press('back')); await page.waitForTimeout(600);        // Back in the past: to now
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(700);
  ok('a press of ◀ at now opens the groups', /groups-open/.test(await ev(() => document.getElementById('viewGuide').className)));
  // Hold OK in Settings: back to the channel in fullscreen.
  await ev(() => { Views.closeNav(); Views.startChannel(Library.channels(Library.ALL)[2], true); }); await page.waitForTimeout(2500);
  await ev(() => Views.switchTab('settings')); await page.waitForTimeout(800);
  await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); await page.waitForTimeout(800);
  ok('Hold OK in Settings goes back to the channel in fullscreen', await ev(() => Views.full && Views.tab === 'guide' && !!Views.playing), JSON.stringify(await ev(() => ({ full: Views.full, tab: Views.tab }))));

  // Search settings is the first row of the Settings menu too.
  await ev(() => { Views.runAction('exit', 'player'); }); await page.waitForTimeout(500);
  await ev(() => Views.switchTab('settings')); await page.waitForTimeout(500);
  const first = await ev(() => document.querySelector('#setNav > div').innerText.trim());
  ok('the Settings menu starts with Search settings', first === 'Search settings', first);
  await ev(() => document.querySelector('#setNav .nav-find').click()); await page.waitForTimeout(300);
  ok('picking it opens the search (the last one, here)', /Search for/.test(await ev(() => document.getElementById('setBody').innerText)) && await ev(() => document.querySelector('#setNav .nav-find').classList.contains('on')));
  if (await ev(() => !!document.querySelector('#modal input'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  // Search keeps the channel in its corner too, right of the results, and Hold OK on the box goes back.
  await ev(() => Views.switchTab('search')); await page.waitForTimeout(800);
  const sr = await ev(() => ({ pip: Views.pipOn, st: document.getElementById('stage').getBoundingClientRect().toJSON(), wrap: document.querySelector('.search-wrap').getBoundingClientRect().toJSON() }));
  ok('Search: the channel plays in the corner, clear of the results', sr.pip && sr.st.left >= sr.wrap.right, JSON.stringify(sr));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);        // the box to the filters
  const b4 = await ev(() => ({ el: document.activeElement && document.activeElement.tagName, modal: UI.modalOpen }));
  await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); await page.waitForTimeout(800);
  ok('Hold OK on the filters goes back to it in fullscreen', await ev(() => Views.full && !!Views.playing), JSON.stringify(Object.assign(b4, await ev(() => ({ full: Views.full, tab: Views.tab, playing: !!Views.playing, el: document.activeElement && document.activeElement.tagName })))));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
