/* The web editor's step 4 (match channels to the guide): a channel matched to a guide channel with
   nothing scheduled is told apart from one not matched at all ("Guide is empty"), Smart match never
   offers a guide channel with nothing scheduled or a blank id, the "Show unsure guesses" box sits on
   its own line, and Back on a phone (tbBack) closes what is open, then goes back a page.
     node tests/soak/editor-guide-states.js      (mock provider on :8077, the dev relay, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const tvErr = []; tv.on('pageerror', e => tvErr.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(6000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  const st = await tv.evaluate(() => WebEdit.start().then(s => s, e => ({ err: e.message })));
  const pw = await tv.evaluate(() => WebEdit.password());
  const ed = await (await b.newContext({ viewport: { width: 412, height: 900 }, isMobile: true })).newPage();
  const edErr = []; ed.on('pageerror', e => edErr.push(e.message));
  await ed.goto('http://127.0.0.1:' + st.port + '/'); await ed.waitForTimeout(1000);
  await ed.fill('#pw', pw); await ed.click('#loginBtn'); await ed.waitForTimeout(2500);

  const gc = await ed.evaluate(() => (D.guide.channels || []).slice(0, 3));
  ok('the TV says which guide channels have programmes', gc.length && gc.every(x => x.length === 3), JSON.stringify(gc));

  // A guide with one channel that has nothing scheduled, and one with a blank id, as some providers send.
  const r = await ed.evaluate(() => {
    var c = channelsOf(ALL)[0], c2 = channelsOf(ALL)[1];
    D.guide.channels = D.guide.channels.concat([['empty.id', chName(c) + ' HD', 0], ['', chName(c2), 1]]);
    readGuide(); matcherIndex = null;
    E.epgMap[c.k] = 'empty.id';
    show('guide'); renderMatchList();
    var tabs = [].map.call(document.querySelectorAll('#mTabs button'), function (x) { return x.innerText.replace(/\s+/g, ' '); });
    mTab = 'empty'; renderMatchList();
    var row = document.getElementById('mList').innerText;
    return { state: guideState(c), tabs: tabs, row: row, blank: guideName.has(''), sug: suggest(c, 8).map(function (x) { return x.id; }), sug2: suggest(c2, 8).map(function (x) { return x.id; }), has: hasGuide(c), name: chName(c) };
  });
  ok('matched to a guide channel with nothing scheduled: its own state', r.state === 'empty' && !r.has, JSON.stringify(r));
  ok('with its own tab, apart from Needs a guide', r.tabs.some(t => /^Guide is empty ?1/.test(t)) && r.tabs.some(t => /^Needs a guide/.test(t)), r.tabs.join(' | '));
  ok('and the row says so', /matched, nothing scheduled/.test(r.row) && /Find another/.test(r.row), r.row.slice(0, 200));
  ok('a guide channel with a blank id is not offered', !r.blank && r.sug2.indexOf('') < 0, JSON.stringify(r.sug2));
  ok('suggestions skip guide channels with nothing scheduled', r.sug.indexOf('empty.id') < 0, JSON.stringify(r.sug));

  // Smart match's unsure box on its own line, not hanging off the end of the text.
  await ed.evaluate(() => { E.epgMap = {}; var c = channelsOf(ALL)[2]; c.has = false; c.epg = ''; mTab = 'none'; renderMatchList(); });
  await ed.evaluate(() => document.getElementById('smartBtn').click());
  await ed.waitForTimeout(1500);
  const box = await ed.evaluate(() => {
    var cb = document.getElementById('smWeak'); if (!cb) return null;
    var l = cb.closest('label'), p = l.previousElementSibling, a = cb.getBoundingClientRect(), t = l.getBoundingClientRect();
    return { own: l.parentNode.tagName !== 'P', gap: t.left <= a.left + 1 && a.right < t.right - 40, below: p ? p.getBoundingClientRect().bottom <= t.top + 1 : true };
  });
  await ed.screenshot({ path: require('path').join(__dirname, '..', '.shots', 'editor-smart-match-phone.png') }).catch(() => {});
  ok('Show unsure guesses: the box and its words on their own line', box && box.own && box.gap && box.below, JSON.stringify(box));

  // Back on a phone.
  const back = await ed.evaluate(() => {
    var out = [];
    out.push(window.tbBack() && !document.getElementById('modal'));          // closes Smart match
    show('gc'); show('names');
    out.push(window.tbBack() && page === 'gc');
    out.push(window.tbBack() && page === 'guide');
    while (window.tbBack()) {}
    out.push(window.tbBack() === false);
    return out;
  });
  ok('Back closes what is open, then goes back a page at a time, then lets the phone leave', back.every(Boolean), JSON.stringify(back));
  ok('no page errors', !edErr.length && !tvErr.length, edErr.concat(tvErr).join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all guide state checks passed');
  process.exit(fails ? 1 : 0);
})();
