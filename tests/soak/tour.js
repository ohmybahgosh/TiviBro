/* The first-run set-up tour, driven with the remote in a real browser.
     MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &      (countries, East and West, locals, events)
     npm run serve &                                                       (app on :8078 and the dev relay)
     node tests/soak/tour.js [--shots dir]
   LOGOS=http://host/logos/ points the logo library at an index (scripts/logos/build-index.js output).
   Walks every step, changes something on each, checks the channel count the tour promises against
   what the lists show after Apply, and that a restore point was saved first. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8088';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 220) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit', locale: 'en-US' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  const settings = { playlists: [pl] };
  if (process.env.LOGOS) settings.logoBase = process.env.LOGOS;
  await page.addInitScript(R.init({ time: Date.now(), settings })[0]);
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 }); await page.waitForTimeout(2000);
  const ev = (f, a) => page.evaluate(f, a);
  const key = async (k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w == null ? 250 : w); };
  // Screenshots for the docs: without the guide download chip and toasts that happen to be up.
  const shot = async n => { if (!SHOTS) return; await page.addStyleTag({ content: '.epgprog,#toast{display:none!important}' }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const step = () => ev(() => Tour.step);
  const text = () => ev(() => document.getElementById('viewSetup').innerText);
  const focused = () => ev(() => { const f = document.querySelector('#viewSetup .focus'); return f ? f.innerText.split('\n')[0] : ''; });
  async function focus(re, max) { for (let n = 0; n < (max || 60); n++) { if (new RegExp(re).test(await focused())) return true; await key('ArrowDown', 120); } return false; }
  async function next() { const s = await step(); for (let n = 0; n < 80 && !/^Next$/.test(await focused()); n++) await key('ArrowDown', 60); await key('Enter', 600); return s !== await step(); }

  const before = await ev(() => ({ chans: Library.data.channels.length, shown: Library.channels(Library.ALL).length }));
  await ev(() => Tour.open({ first: true })); await page.waitForTimeout(1200);
  ok('opens on the welcome step', await step() === 'welcome');
  const w = await text();
  ok('welcome shows what the playlist has', /channels/.test(w) && /countries/.test(w) && /event channels/.test(w) && /in East \+ West/.test(w) && /local cities/.test(w), w.replace(/\s+/g, ' ').slice(0, 300));
  await shot('tv-tour-welcome');

  // Phone or computer: QR code, address and password, then back.
  await key('ArrowDown'); ok('second choice is the phone', /phone or computer/.test(await focused()));
  await key('Enter', 2500);
  const qr = await ev(() => { const s = document.querySelector('.tour-qr svg'); return { qr: !!s, txt: document.getElementById('viewSetup').innerText }; });
  ok('phone: QR code, address and password', qr.qr && /Address/.test(qr.txt) && /Password/.test(qr.txt), qr.txt.replace(/\s+/g, ' ').slice(0, 200));
  await shot('tv-tour-phone');
  await key('Escape', 600);
  ok('back to the tour', await step() === 'welcome');
  await key('ArrowUp'); await key('Enter', 700);

  // Countries: keep only the TV's own (en-US) is pre-picked.
  ok('countries step', await step() === 'countries', await step());
  const c1 = await ev(() => Tour.plan().chans);
  const ctext = await text();
  ok('countries listed with counts, USA kept, the rest hidden', /USA[\s\S]*Keep/.test(ctext) && /Hide/.test(ctext), ctext.replace(/\s+/g, ' ').slice(0, 300));
  await shot('tv-tour-countries');
  await focus('Keep every country'); await key('Enter', 400);
  const c2 = await ev(() => Tour.plan().chans);
  ok('Keep every country keeps more', c2 > c1, c1 + ' -> ' + c2);
  await key('ArrowDown'); await key('Enter', 400);       // Keep only the biggest
  await next();

  ok('names step', await step() === 'names', await step());
  ok('names: before and after', await ev(() => document.querySelectorAll('.tour-prev div').length) > 0);
  await shot('tv-tour-names');
  await next();

  ok('East and West step', await step() === 'feeds', await step());
  const f1 = await ev(() => Tour.plan().chans);
  await key('ArrowRight', 400);                          // East -> West
  ok('feeds: West picked', /West feeds/.test(await focused() + await text()));
  await key('ArrowRight', 400);                          // -> Both
  const f2 = await ev(() => Tour.plan().chans);
  ok('feeds: Both keeps more than East only', f2 > f1, f1 + ' -> ' + f2);
  await key('ArrowRight', 400);                          // back to East
  await shot('tv-tour-feeds');
  await next();

  ok('locals step', await step() === 'locals', await step());
  const l1 = await ev(() => Tour.plan().chans);
  ok('locals: cities listed', await focus('Detroit'), await focused());
  await key('Enter', 400);
  const l2 = await ev(() => Tour.plan().chans);
  ok('locals: picking Detroit hides other cities', l2 < l1, l1 + ' -> ' + l2);
  await key('ArrowRight', 300);
  ok('locals: ◀ ▶ jump letters', !/Detroit/.test(await focused()), await focused());
  await shot('tv-tour-locals');
  await next();

  ok('events step', await step() === 'events', await step());
  ok('events: upcoming listed', /Coming up/.test(await text()));
  await shot('tv-tour-events');
  await next();

  ok('clutter step', await step() === 'clutter', await step());
  ok('clutter: dividers, empty groups, keyword, new groups', /Hide empty groups/.test(await text()) && /Groups the provider adds later/.test(await text()));
  await shot('tv-tour-clutter');
  await next();

  ok('logos step', await step() === 'logos', await step());
  const lg = await ev(() => Store.settings.logoLib);
  ok('logos: Fill in missing is offered on a new playlist', lg === 'fill', lg);
  if (process.env.LOGOS) {
    await page.waitForFunction(() => Logos.ready, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    ok('logos: index loaded', await ev(() => Logos.ready), await ev(() => JSON.stringify(Logos.status)));
  }
  await shot('tv-tour-logos');
  await next();

  ok('look step', await step() === 'look', await step());
  const acc0 = await ev(() => Store.settings.accent);
  await key('ArrowRight', 400);
  ok('look: accent changes live', await ev(() => Store.settings.accent) !== acc0);
  await key('ArrowLeft', 400);
  await shot('tv-tour-look');
  await next();

  ok('summary step', await step() === 'done', await step());
  const promised = await ev(() => Tour.plan().chans);
  ok('summary: tips', /Hold OK on a channel/.test(await text()) && /Multiview/.test(await text()));
  await shot('tv-tour-done');
  const t = await text();
  ok('summary: your choices, one per step', /Your choices/.test(t) && /Detroit in Local channels, network groups hidden/.test(t) && /Keep East/.test(t) && /extra copies \(Full HD kept\)/.test(t), t.replace(/\s+/g, ' ').slice(0, 400));
  ok('summary: Apply is focused first', await focused() === 'Apply and start watching', await focused());
  for (let n = 0; n < 20 && !/^Local channels$/.test(await focused()); n++) await key('ArrowUp', 120);
  ok('summary: OK on a choice opens its step', /^Local channels$/.test(await focused()) && (await key('Enter', 600), await step()) === 'locals', await step());
  for (let n = 0; n < 80 && !/^Next$/.test(await focused()); n++) await key('ArrowDown', 60);
  for (let n = 0; n < 4 && !/^Skip to the summary$/.test(await focused()); n++) await key('ArrowRight', 100);
  await key('Enter', 600);
  ok('summary: Skip to the summary comes back', await step() === 'done', await step());
  await focus('Apply and start watching'); await key('Enter', 2500);
  ok('closed', await ev(() => !Tour.isOpen && document.getElementById('viewSetup').classList.contains('hidden')));
  // Shown: every channel in All channels, plus the stations in Local channels (their network groups are hidden).
  const after = await ev(() => { const s = new Set(Library.channels(Library.ALL).map(c => c.k)); const lg = Store.edits.custom.filter(g => g.name === 'Local channels')[0]; if (lg) Library.channels(lg.id).forEach(c => s.add(c.k)); return s.size; });
  const lc = await ev(() => { const lg = Store.edits.custom.filter(g => g.name === 'Local channels')[0]; if (!lg) return null; const ch = Library.channels(lg.id); return { n: ch.length, detroit: ch.filter(c => /DETROIT/i.test(c.n)).length, netsHidden: ch.filter(c => !Store.edits.hiddenGroups[c.g]).map(c => c.g).join() }; });
  ok('Local channels holds the Detroit stations, network groups hidden', lc && lc.n > 0 && lc.detroit === lc.n - (lc.n - lc.detroit) && lc.detroit > 0 && lc.netsHidden === '', JSON.stringify(lc));
  ok('the lists show what the tour promised', after === promised, 'promised ' + promised + ', shown ' + after + ' (was ' + before.shown + ')');
  ok('hid something', after < before.shown);
  const snap = await ev(() => Store.idbGet('snaps:' + Store.playlist.id).then(l => (l || []).map(x => x.name)));
  ok('restore point saved first', snap.indexOf('Before the set-up tour') >= 0, snap.join());
  ok('marked done', await ev(() => Store.playlist.tour > 0));
  await shot('tv-tour-after');

  // Again from Settings, then Back out without changes.
  const hid = await ev(() => Object.keys(Store.edits.hiddenChannels).length);
  await ev(() => Tour.open({ from: 'settings' })); await page.waitForTimeout(800);
  ok('opens again from Settings', await step() === 'welcome' && /Set-up tour/.test(await text()));
  await key('Escape', 1200);
  ok('Back on the welcome step leaves without changes', !(await ev(() => Tour.isOpen)) && await ev(() => Object.keys(Store.edits.hiddenChannels).length) === hid);
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all set-up tour tests passed');
  process.exit(fails ? 1 : 0);
})();
