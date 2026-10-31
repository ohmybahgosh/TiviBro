/* The web editor on a phone, for the README and the website: the page right after scanning the first
   screen's QR code (editor-phone-welcome), typing the login (editor-phone-add) and Smart clean-up
   (editor-phone-tools).  390x844 at 2x, as a phone shows it.
     node tests/mock/mock_provider.js &   npm run serve &
     node scripts/demo/phone-shots.js     then   bash scripts/demo/site-shots.sh
   PNGs go to docs/screenshots/. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const R = require('./record.js');
const APP = process.env.DEMO_APP || 'http://127.0.0.1:8078/index.html';
const OUT = path.join(__dirname, '../../docs/screenshots');

async function editorFor(b, initOpts) {
  const tv = await (await b.newContext()).newPage();
  await tv.addInitScript(R.init(initOpts)[0]);
  await tv.goto(APP); await tv.waitForTimeout(5000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  const st = await tv.evaluate(() => WebEdit.start()), pw = await tv.evaluate(() => WebEdit.password());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ed = await ctx.newPage();
  return { tv, ed, url: 'http://127.0.0.1:' + st.port + '/#k=' + pw };
}
const shot = (ed, n) => ed.screenshot({ path: path.join(OUT, n + '.png') }).then(() => console.log(n));
const calm = ed => ed.evaluate(() => { const b = [].slice.call(document.querySelectorAll('#modal button')).filter(x => /Throw them away/.test(x.textContent))[0]; if (b) b.click(); });

(async () => {
  const b = await chromium.launch();
  // A new TV: no playlist yet.
  let x = await editorFor(b, { time: R.primeTime(), fresh: true });
  await x.ed.goto(x.url + '/welcome'); await x.ed.waitForTimeout(3000); await calm(x.ed);
  await shot(x.ed, 'editor-phone-welcome');
  await x.ed.evaluate(() => show('playlists')); await x.ed.waitForTimeout(800);
  await x.ed.evaluate(() => { const f = document.getElementById('addForm'); if (f) f.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await x.ed.fill('#aServer', 'http://my.provider.example:8080'); await x.ed.focus('#aServer'); await x.ed.waitForTimeout(500);
  await shot(x.ed, 'editor-phone-add');
  // The demo playlist: Smart clean-up.
  x = await editorFor(b, { time: R.primeTime() });
  await x.ed.goto(x.url + '/tools'); await x.ed.waitForTimeout(3000); await calm(x.ed);
  await shot(x.ed, 'editor-phone-tools');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
