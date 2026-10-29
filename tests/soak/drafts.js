/* Draft autosave and draft history in the web editor, in a real browser against the TV.
     node tests/soak/drafts.js      (mock provider on :8077, the app served and the dev relay; see tests/soak/chaos.js)
   1. Changes are saved on the TV a few seconds after they are made ("Draft saved on the TV").
   2. An accidental reload offers them back.
   3. A different browser (nothing saved locally) gets them back from the TV.
   4. Draft history: versions, a named version, opening an older one (and undoing that).
   5. Throwing a draft away keeps it in the history.
   6. Sending marks the version as sent, and a reload then offers nothing. */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 160) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; tv.on('pageerror', e => errs.push('tv: ' + e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(6000);
  await tv.evaluate(() => WebEdit.stop()); const st = await tv.evaluate(() => WebEdit.start());
  const pw = await tv.evaluate(() => WebEdit.password()), E = 'http://127.0.0.1:' + st.port + '/';
  async function browser() {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    p.on('pageerror', e => errs.push('editor: ' + e.message)); p.on('dialog', d => d.accept());
    await p.goto(E); await p.fill('#pw', pw); await p.click('#loginBtn'); await p.waitForTimeout(2500);
    return p;
  }
  const offer = p => p.locator('#modal h2', { hasText: 'Unsent changes' }).count();
  let ed = await browser();
  await ed.click('#nav [data-page=gc]'); await ed.waitForTimeout(800);
  for (const id of ['x9', 'x10', 'x11', 'x12', 'x13']) { await ed.click('input[data-vis="' + id + '"]'); await ed.waitForTimeout(250); }
  await ed.waitForFunction(() => /Draft saved on the TV/.test(document.getElementById('cbDraft').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('changes are saved on the TV within seconds', /Draft saved on the TV/.test(await ed.innerText('#cbDraft')), await ed.innerText('#changebar'));
  ok('nothing was sent to the TV', await tv.evaluate(() => !Store.edits.hiddenGroups.x9));

  // 2. accidental reload
  await ed.reload(); await ed.fill('#pw', pw).catch(() => {}); await ed.click('#loginBtn').catch(() => {}); await ed.waitForTimeout(3500);
  ok('a reload offers the unsent changes back', await offer(ed) === 1, await ed.locator('#modal').innerText().catch(() => 'no modal'));
  await ed.locator('#modal button', { hasText: 'Keep working' }).click(); await ed.waitForTimeout(500);
  ok('and they come back', /5 changes/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));
  await ed.context().close();

  // 3. another browser, nothing saved locally
  ed = await browser(); await ed.waitForTimeout(2000);
  ok('another browser gets them back from the TV', await offer(ed) === 1 && /saved on the TV/.test(await ed.locator('#modal').innerText()), await ed.locator('#modal').innerText().catch(() => 'no modal'));
  await ed.locator('#modal button', { hasText: 'Keep working' }).click(); await ed.waitForTimeout(500);
  ok('with all 5 changes', /5 changes/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));

  // 4. draft history
  await ed.click('#nav [data-page=history]'); await ed.waitForTimeout(2500);
  await ed.fill('#dName', 'Five groups hidden'); await ed.click('#dSave'); await ed.waitForTimeout(4000);
  await ed.click('#nav [data-page=gc]'); await ed.waitForTimeout(600);
  for (const id of ['x14', 'x15']) { await ed.click('input[data-vis="' + id + '"]'); await ed.waitForTimeout(250); }
  await ed.waitForTimeout(4000);
  await ed.click('#nav [data-page=history]'); await ed.waitForTimeout(3000);
  const rows = await ed.locator('#dList tr').allInnerTexts();
  ok('draft history lists the versions, the named one too', rows.some(r => /Five groups hidden/.test(r)) && rows.length >= 3, rows.slice(1).map(r => r.replace(/\s+/g, ' ').slice(0, 70)).join(' | '));
  ok('and how much room they take on the TV', /on the TV/.test(await ed.innerText('#dSize')), await ed.innerText('#dSize'));
  const waitText = re => ed.waitForFunction(r => new RegExp(r).test(document.getElementById('cbText').textContent), re, { timeout: 10000 }).catch(() => {});
  await ed.locator('#dList tr', { hasText: 'Five groups hidden' }).locator('[data-dopen]').click(); await waitText('^5 changes');
  ok('opening an older version goes back to it', /5 changes/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));
  await ed.click('#cbUndo'); await ed.waitForTimeout(500);
  ok('and undo returns to the newer work', /7 changes/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));

  // 5. throw away keeps it
  await ed.context().close();
  ed = await browser(); await ed.waitForTimeout(2000);
  if (await offer(ed)) await ed.locator('#modal button', { hasText: 'Throw them away' }).click();
  await ed.waitForTimeout(500);
  ok('throwing away leaves nothing unsent', !(await ed.isVisible('#changebar')) || /0 change/.test(await ed.innerText('#cbText')));
  await ed.click('#nav [data-page=history]'); await ed.waitForTimeout(3000);
  ok('but the work is still in draft history', (await ed.locator('#dList tr').count()) >= 3);
  await ed.locator('#dList tr').nth(1).locator('[data-dopen]').click(); await ed.waitForFunction(() => /^7 changes/.test(document.getElementById('cbText').textContent), null, { timeout: 10000 }).catch(() => {});
  ok('and opens again', /7 changes/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));

  // 6. send
  await ed.click('#cbSend'); await ed.waitForFunction(() => /Everything is on the TV|on the TV/.test(document.getElementById('status').innerText), null, { timeout: 25000 }); await ed.waitForTimeout(3500);
  ok('sending applies it on the TV', await tv.evaluate(() => !!Store.edits.hiddenGroups.x9 && !!Store.edits.hiddenGroups.x15));
  await ed.click('#nav [data-page=history]'); await ed.waitForTimeout(3000);
  ok('the version is marked as sent', /sent to the TV/.test(await ed.innerText('#dList')), (await ed.innerText('#dList')).slice(0, 200));
  await ed.context().close();
  ed = await browser(); await ed.waitForTimeout(2000);
  ok('after sending, a new visit offers nothing', await offer(ed) === 0);
  const size = await tv.evaluate(() => Store.idbGet('drafts:' + Store.playlist.id).then(l => l.reduce((n, x) => n + x.size, 0)));
  ok('drafts take little room on the TV', size < 200000, size + ' bytes');
  ok('no page errors', !errs.length, errs.join(' | '));
  await tv.evaluate(() => WebEdit.stop());
  await b.close();
  console.log(fails ? fails + ' failed' : 'all draft tests passed');
  process.exit(fails ? 1 : 0);
})();
