/* Subtitles from OpenSubtitles in the real app (subs.js, service/subtitles.js; discussion #19): Find
   subtitles from a movie's Subtitles menu, the search filled in from what's playing, a download that
   becomes a subtitle track, Timing, and lining a late subtitle up with one in time.
     node tests/mock/mock_provider.js &                                         (it answers as OpenSubtitles under /os/)
     TIVIBRO_OS_BASE=http://127.0.0.1:8077/os/api/v1 npm run serve &
     node tests/soak/subtitles.js [--shots dir] */
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
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(R.init({ time: R.primeTime() })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0 && Net.port, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const modal = () => ev(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden') ? m.innerText.replace(/\n+/g, ' | ') : ''; });
  const pick = async (re) => {
    const idx = await ev(r => [].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x => new RegExp(r).test(x.textContent)), re);
    if (idx < 0) return false;
    const cur = await ev(() => [].slice.call(document.querySelectorAll('#modal .mi')).findIndex(x => x.classList.contains('focus')));
    for (let k = 0; k < Math.abs(idx - cur); k++) { await page.keyboard.press(idx > cur ? 'ArrowDown' : 'ArrowUp'); await page.waitForTimeout(50); }
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    return true;
  };
  // The menu's grey headings (UI.menu head rows) and the row the highlight is on.
  const heads = () => ev(() => [].slice.call(document.querySelectorAll('#modal .mh')).map(x => x.textContent));
  const rows = () => ev(() => [].slice.call(document.querySelectorAll('#modal .mi, #modal .mh')).map(x => x.classList.contains('mh') ? '# ' + x.textContent : x.querySelector('span').textContent));
  const focused = () => ev(() => { const f = document.querySelector('#modal .mi.focus span'); return f ? f.textContent : ''; });
  const subsMenu = async () => { await ev(() => UI.close && UI.close()); await ev(() => Views.runAction('subs', 'player')); await page.waitForTimeout(400); };

  await ev(m => { Subs.setKey(''); Store.settings.subLangs = ['en', 'es']; Views.playVod({ id: 'm1', title: 'EN - Feature Presentation (2024)', sub: '2024', item: { name: 'EN - Feature Presentation (2024) 4K', year: '2024' } }, m + '/movie/1.mp4', 0, function () {}); }, MOCK);
  await page.waitForFunction(() => Player.playing, null, { timeout: 30000 }); await page.waitForTimeout(1000);
  await subsMenu();
  let m = await modal();
  ok('Subtitles offers Find subtitles in a movie', /No subtitles in this video/.test(m) && /Find subtitles/.test(m), m);
  ok('Subtitles: a Settings heading above Find subtitles, an In this movie heading above what the movie has', JSON.stringify(await heads()) === '["Settings","In this movie"]' && /^# Settings,Find subtitles…,# In this movie,No subtitles in this video$/.test((await rows()).join(',')), (await rows()).join(','));
  await pick('^Find subtitles');
  m = await modal();
  ok('without a key it offers the step-by-step setup', /Set up OpenSubtitles first/.test(m) && /step by step/.test(m), m);
  // The setup, step by step: an account, a key (what to tick), paste it, checked with OpenSubtitles, done.
  await pick('^Set up OpenSubtitles first');
  m = await modal();
  ok('setup step 1: a free account on opensubtitles.com', /step 1 of 3/.test(m) && /opensubtitles\.com/.test(m) && /I have an account/.test(m), m);
  await pick('^I have an account');
  m = await modal();
  ok('setup step 2: the consumers page, the name and what to tick', /step 2 of 3/.test(m) && /opensubtitles\.com\/consumers/.test(m) && /Allow anonymous downloads/.test(m) && /Under dev/.test(m), m);
  await pick('^I see my API key');
  m = await modal();
  ok('setup step 3: paste the key (hidden as typed)', /step 3 of 3/.test(m) && await page.locator('#modal input').getAttribute('type') === 'password', m);
  await page.locator('#modal input').fill('a'.repeat(32)); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /is set up/.test((document.getElementById('modalTitle') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  m = await modal();
  ok('the key is checked with OpenSubtitles, then it is set up, with an optional sign-in', /OpenSubtitles is set up/.test(m) && /Sign in for more downloads/.test(m) && await ev(() => Subs.configured), m);
  await pick('^Done');
  m = await modal();
  ok('the search is filled in from what is playing, in your languages', /Search for "Feature Presentation"\s+\(2024\)/.test(m) && /English, Spanish/.test(m), m);
  await shot('tv-subs-find');
  await pick('^Search for');
  await page.waitForFunction(() => /subtitles for/.test((document.getElementById('modalTitle') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  m = await modal();
  ok('results: under each language (asked one at a time), release, downloads, your first language first', /2 subtitles for "Feature Presentation"/.test(m) && /English\s+·\s+1 \| Feature\.Presentation\.2024\.WEB.*Spanish\s+·\s+1 \| Feature\.Presentation\.2024\.Latino/i.test(m) && /5,000 downloads/.test(m), m);
  await shot('tv-subs-results');
  const asked = await (await fetch(MOCK + '/os-asked')).json();
  ok('OpenSubtitles is asked one language at a time, with sorted, lower-case parameters', ['en', 'es'].every(l => asked.some(a => new RegExp('GET /os/api/v1/subtitles\\?languages=' + l + '&order_by=download_count&query=feature\\+presentation&type=movie&year=2024$').test(a))), asked.join(' | '));
  await pick('^Feature\\.Presentation\\.2024\\.WEB');
  await page.waitForFunction(() => [].slice.call(document.getElementById('video').textTracks).some(t => /OpenSubtitles/.test(t.label) && t.cues && t.cues.length), null, { timeout: 15000 }).catch(() => {});
  const en = await ev(() => { const t = [].slice.call(document.getElementById('video').textTracks).find(t => /English \(OpenSubtitles\)/.test(t.label)); return t && { mode: t.mode, n: t.cues.length, first: t.cues[0].startTime, text: t.cues[0].text }; });
  ok('the download becomes a subtitle track, on', en && en.mode === 'showing' && en.n > 20 && en.first === 2 && en.text === 'Line 1', JSON.stringify(en));
  ok('and says how many downloads are left today', /4 downloads left today/.test(await ev(() => document.body.innerText)));
  // TiviBro draws the lines itself, exactly those whose time includes now (discussion #19: a line stuck on screen).
  const onScreen = () => ev(() => {
    Subs.draw();
    const v = document.getElementById('video'), b = document.querySelector('.subs-captions'), now = v.currentTime;
    const tr = [].slice.call(v.textTracks).find(t => /English \(OpenSubtitles\)/.test(t.label));
    const want = [].slice.call(tr.cues).filter(c => c.startTime <= now && c.endTime > now).map(c => c.text).join('\n');
    return { hidden: v.classList.contains('subs-drawn'), text: b && b.style.display !== 'none' ? b.textContent : '', want, now };
  });
  await ev(() => { Player.setPaused(true); Player.seekTo(2.5); }); await page.waitForTimeout(800);
  let d = await onScreen();
  ok('the line of now is drawn by TiviBro, the TV\'s own drawing hidden', d.hidden && d.text === 'Line 1' && d.text === d.want, JSON.stringify(d));
  await ev(() => Subs._test.shift(1)); d = await onScreen();
  ok('moving the times while a line shows leaves exactly the lines of the new times', d.text === d.want, JSON.stringify(d));
  await ev(() => Subs._test.shift(-1)); await ev(() => Player.setPaused(false));

  // Timing.
  await subsMenu(); await pick('^Timing'); await pick('^Later by 1 s');
  m = await modal();
  ok('Timing: later by 1 s moves every line', /Subtitle timing: \+1\.0 s, later/.test(m) && await ev(() => [].slice.call(document.getElementById('video').textTracks).find(t => /English/.test(t.label)).cues[0].startTime) === 3, m);
  await shot('tv-subs-timing');
  await pick('^Done');

  // A second, late subtitle, lined up with the first.
  await subsMenu(); await pick('^Find subtitles'); await pick('^Search for');
  await page.waitForFunction(() => /subtitles for/.test((document.getElementById('modalTitle') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await pick('^Feature\\.Presentation\\.2024\\.Latino');
  await page.waitForFunction(() => [].slice.call(document.getElementById('video').textTracks).some(t => /Spanish/.test(t.label) && t.cues && t.cues.length), null, { timeout: 15000 }).catch(() => {});
  const late = await ev(() => { const tt = [].slice.call(document.getElementById('video').textTracks); const es = tt.find(t => /Spanish/.test(t.label)); return { es: es.mode, en: tt.find(t => /English/.test(t.label)).mode, first: es.cues[0].startTime }; });
  ok('the new one is shown instead, 2.5 s late (with the 1 s timing)', late.es === 'showing' && late.en === 'disabled' && Math.abs(late.first - 5.5) < 0.01, JSON.stringify(late));
  await subsMenu();
  m = await modal();
  ok('Line up with another track appears with two tracks', /Line up with another track/.test(m), m);
  ok('with subtitles: settings first, then the subtitles under In this movie with their count', /^# Settings,Find subtitles…,Timing,Line up with another track…,# In this movie · 2,Off,English \(OpenSubtitles\),Spanish \(OpenSubtitles\)$/.test((await rows()).join(',')), (await rows()).join(','));
  ok('the menu opens on the subtitle that is on', /^Spanish/.test(await focused()), await focused());
  await shot('tv-subs-menu');
  for (let k = 0; k < 3; k++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(50); }
  ok('the remote steps over a heading: Up from Off goes to Line up', /^Line up with another track/.test(await focused()), await focused());
  await subsMenu();
  await pick('^Line up with another track'); await pick('^English');
  await page.waitForTimeout(1500);
  const lined = await ev(() => { const tt = [].slice.call(document.getElementById('video').textTracks); const es = tt.find(t => /Spanish/.test(t.label)), en = tt.find(t => /English/.test(t.label)); if (en.mode === 'disabled') en.mode = 'hidden'; return { es: es.cues[3].startTime, en: en.cues[3].startTime, toast: document.body.innerText.match(/Lined up[^\n]*/) }; });
  ok('lined up: the Spanish lines start with the English ones', Math.abs(lined.es - lined.en) < 0.06 && lined.toast && /2\.50 s earlier/.test(lined.toast[0]), JSON.stringify(lined));
  // The same subtitle back as new lines on a new track (a movie file's subtitles after a seek, mkvsubs.js):
  // they come lined up too.
  const again = await ev((raw) => { const v = document.getElementById('video'), es = [].slice.call(v.textTracks).find(t => /Spanish/.test(t.label));
    const t2 = v.addTextTrack('subtitles', es.label, es.language); t2.mode = 'hidden'; t2.addCue(new VTTCue(raw, raw + 1.5, 'otra vez')); Subs.fresh(t2); return { now: t2.cues[0].startTime, first: es.cues[0].startTime }; }, late.first - 1);
  ok('lines that arrive later on the same subtitle are lined up too', Math.abs(again.now - again.first) < 0.06 && Math.abs(again.now - (late.first - 1)) > 0.5, JSON.stringify(again));
  // Settings.
  await ev(() => { Views.runAction('exit', 'player'); Views.switchTab('settings'); Settings.section('playback'); }); await page.waitForTimeout(600);
  let set = await ev(() => document.body.innerText);
  ok('Playback has the languages and a way to the key', /Subtitles from OpenSubtitles/.test(set) && /Subtitle languages/.test(set) && /English, Spanish/.test(set) && /OpenSubtitles key and sign-in/.test(set), set.slice(0, 300));
  await ev(() => Settings.section('keys')); await page.waitForTimeout(600);
  set = await ev(() => document.body.innerText);
  ok('Settings has the languages, the key and sign in', /API keys/.test(set) && /OpenSubtitles API key saved/.test(set) && /Test OpenSubtitles key/.test(set) && /Sign in \(optional\)/.test(set) && /TMDB/.test(set), set.slice(0, 200));
  ok('Test OpenSubtitles key says it works', /key works/.test(await ev(() => Subs.test().catch((e) => e.message))));
  await shot('tv-subs-settings');
  ok('the key is not in the settings (so not in backups or reports)', await ev(() => JSON.stringify(Store.settings).indexOf('aaaaaaaaaaaaaaaa') < 0));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all subtitle checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
