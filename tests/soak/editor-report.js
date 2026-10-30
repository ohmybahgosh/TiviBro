/* Report a problem: Settings > Diagnostics shows the QR code for the editor's Report a problem page,
   the page reads the TV's report (versions, model, logs), the report has no logins or server names,
   and the GitHub button builds a filled-in bug form address short enough for GitHub.
     node tests/soak/editor-report.js      (the app served on :8078 with the dev relay, mock provider on :8077) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); const errs = []; tv.on('pageerror', e => errs.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(6000);
  // Something in the log that must not leave the TV.
  const pl = await tv.evaluate(() => { const p = Store.playlist; Log.warn('test', 'Request to ' + (p.server || p.m3u) + '/player_api.php?username=secretuser&password=secretpass failed'); Log.warn('test', 'Typed on the first screen: http://unsaved-server.example:8080/get.php?username=x'); Log.error('test', 'Stream http://' + String(p.server || p.m3u).replace(/^https?:\/\//, '') + '/live/secretuser/secretpass/12.ts?token=abc123 stalled'); return { server: p.server || p.m3u, user: p.user || '' }; });
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  await tv.evaluate(() => WebEdit.showJoin('report', null, { title: 'Report a problem', lead: 'x' })); await tv.waitForTimeout(2500);
  const panel = await tv.evaluate(() => ({ title: document.getElementById('modalTitle').textContent, qr: !!document.querySelector('.edit-join svg') }));
  ok('the TV shows a QR code for Report a problem', panel.title === 'Report a problem' && panel.qr, JSON.stringify(panel));
  await tv.keyboard.press('Enter'); await tv.waitForTimeout(400);
  const st = await tv.evaluate(() => WebEdit.status), pw = await tv.evaluate(() => WebEdit.password());
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); const ed = await ctx.newPage(); ed.on('pageerror', e => errs.push('editor: ' + e.message));
  let opened = null; ctx.on('page', p => { if (!opened) opened = p.url(); });
  await ed.goto('http://127.0.0.1:' + st.port + '/#k=' + pw + '/report'); await ed.waitForTimeout(3000);
  await ed.waitForFunction(() => window.RP || document.querySelector('#rpMsg .err'), null, { timeout: 30000 });
  const rp = await ed.evaluate(() => RP);
  ok('the page reads the report from the TV', rp && /TiviBro/.test(rp.text) && rp.facts.length > 5, rp && rp.facts.map(f => f.join(': ')).join(' | '));
  const host = pl.server.replace(/^https?:\/\//, '').split(/[:/]/)[0];
  const leaks = ['secretuser', 'secretpass', 'abc123', 'unsaved-server.example', host].filter(x => x && rp.text.indexOf(x) >= 0);
  if (pl.user) { if (rp.text.indexOf(pl.user) >= 0) leaks.push('the playlist username'); }
  ok('no logins, tokens or provider server in the report', !leaks.length, leaks.join(', '));
  ok('recent errors are picked out', rp.trouble.some(l => /stalled/.test(l)), rp.trouble.join(' / '));
  await ed.fill('#rpTitle', 'Guide froze'); await ed.fill('#rpWhat', 'It froze on Sports.'); await ed.fill('#rpSteps', '1. Open the guide'); await ed.fill('#rpExp', 'No freeze');
  const url = await ed.evaluate(() => rpUrl());
  ok('the GitHub address is the bug form, filled in, and short enough', /issues\/new\?template=1-bug\.yml/.test(url) && /what=It%20froze/.test(url) && /version=/.test(url) && url.length <= 7000 && url.indexOf('secretpass') < 0, url.length + ' ' + url.slice(0, 200));
  // Send report goes through the relay named in tivibro.app/relay.json (both stubbed here).
  let posted = null;
  await ctx.route('https://tivibro.app/relay.json', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ url: 'https://relay.test/report' }) }));
  await ctx.route('https://relay.test/report', r => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } }); posted = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, url: 'https://github.com/ohmybahgosh/TiviBro/issues/7', number: 7 }) }); });
  await ed.click('#rpSend'); await ed.waitForTimeout(1500);
  const sent = await ed.evaluate(() => ({ btn: document.getElementById('rpSend').textContent, msg: document.getElementById('rpSendMsg').textContent }));
  ok('Send report posts to the relay and links the new issue', posted && posted.what === 'It froze on Sports.' && /^# TiviBro problem report/.test(posted.log) && posted.log.indexOf('secretpass') < 0 && /issue #7/.test(sent.msg) && /#7/.test(sent.btn), JSON.stringify(sent));
  await ed.click('#rpGo'); await ed.waitForTimeout(1000);
  ok('the button opens GitHub', !!opened && /github\.com/.test(opened), opened);
  const dl = ed.waitForEvent('download'); await ed.click('#rpSave'); const d = await dl;
  ok('the log file downloads', /^tivibro-report-.*\.txt$/.test(d.suggestedFilename()), d.suggestedFilename());
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all report tests passed');
  process.exit(fails ? 1 : 0);
})();
