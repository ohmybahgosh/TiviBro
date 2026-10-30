/* Edit on a phone or computer from anywhere: the side menu's Edit on phone turns the web editor on and
   shows its QR code over the screen you are on, Done keeps it running, Turn the editor off stops it, and
   the same panel opens from hold OK on a group.
     node tests/soak/editor-shortcut.js      (the app served on :8078 with the dev relay, mock provider on :8077) */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 220) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(R.init({ time: R.primeTime(), settings: { startTab: 'guide' } })[0]);
  await p.goto(APP); await p.waitForTimeout(6000);
  const key = async (k, w) => { await p.keyboard.press(k); await p.waitForTimeout(w == null ? 250 : w); };
  const state = () => p.evaluate(() => ({ on: WebEdit.on, modal: !document.getElementById('modal').classList.contains('hidden'), qr: !!document.querySelector('.edit-join svg'), tab: Views.tab }));
  await p.evaluate(() => WebEdit.stop()); await p.waitForTimeout(300);
  await key('Escape', 400); await key('ArrowLeft', 400);
  for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const t = document.querySelector('.tab.focus'); return t && t.getAttribute('data-tab'); }) === 'editor') break; await key('ArrowDown', 150); }
  ok('the side menu has Edit on phone', await p.evaluate(() => /Edit on phone/.test(document.querySelector('.tab.focus').textContent)));
  await key('Enter', 2500);
  let s = await state();
  ok('it turns the editor on and shows the QR code over the guide', s.on && s.modal && s.qr && s.tab === 'guide', JSON.stringify(s));
  await key('Enter', 500);
  s = await state();
  ok('Done closes it and the editor keeps running', s.on && !s.modal, JSON.stringify(s));
  await key('ArrowDown', 200);
  ok('the guide takes the remote again', await p.evaluate(() => !document.body.classList.contains('nav-open')));
  await p.evaluate(() => WebEdit.showJoin()); await p.waitForTimeout(800);
  await key('ArrowRight'); await key('Enter', 1200);
  s = await state();
  ok('Turn the editor off stops it', !s.on && !s.modal, JSON.stringify(s));
  ok('the remote button list offers it', await p.evaluate(() => Keymap.CONTEXT_ACTIONS.list.indexOf('editor') >= 0 && Keymap.CONTEXT_ACTIONS.player.indexOf('editor') >= 0));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all editor shortcut tests passed');
  process.exit(fails ? 1 : 0);
})();
