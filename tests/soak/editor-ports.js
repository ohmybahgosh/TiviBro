/* Web editor ports (issue #7): the high ports and a random high port that stays put.
     node tests/soak/editor-ports.js      (mock provider on :8077, npm run serve) */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const reach = (port) => new Promise(r => http.get('http://127.0.0.1:' + port + '/', x => { x.resume(); r(x.statusCode); }).on('error', () => r(0)));
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.goto(APP);
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  ok('the high ports are offered', await ev(() => [18787, 28787, 38787, 48787, 58787, 61787].every(p => WebEdit.PORTS.indexOf(p) >= 0)));
  await ev(() => { Store.settings.editorPort = 28787; Store.saveSettings(); return WebEdit.start(); });
  await page.waitForTimeout(800);
  ok('the editor answers on 28787', await reach(28787) === 200);
  ok('the address shown uses it', await ev(() => WebEdit.addresses().every(a => /:28787$/.test(a))), await ev(() => WebEdit.addresses().join(' ')));
  const r1 = await ev(() => { Store.settings.editorPort = 'random'; Store.saveSettings(); return WebEdit.restart().then(() => WebEdit.port()); });
  await page.waitForTimeout(800);
  ok('a random high port', r1 >= 10000 && r1 <= 65000 && r1 !== 47810 && r1 !== 47811, r1);
  ok('the editor answers there', await reach(r1) === 200);
  ok('the old port is closed', await reach(28787) === 0);
  const r2 = await ev(() => WebEdit.restart().then(() => WebEdit.port()));
  ok('the random port stays the same', r2 === r1, r1 + ' then ' + r2);
  const r3 = await ev(() => { WebEdit.newRandomPort(); return WebEdit.restart().then(() => WebEdit.port()); });
  await page.waitForTimeout(800);
  ok('New random port picks another', r3 !== r1 && await reach(r3) === 200, r1 + ' then ' + r3);
  await ev(() => { Store.settings.editorPort = 8787; Store.saveSettings(); return WebEdit.stop(); });
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failures' : 'all editor port tests passed');
  process.exit(fails ? 1 : 0);
})();
