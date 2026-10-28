/* The web editor end to end: every page driven in a real browser against a TV page, checking what
   reaches the TV.  Login and lockout, groups (hide, rename, new group, copy channels, favorite, hide
   channels), channel rename, name rules, guide sources (test and add), smart clean-up, restore
   points and undo, adding a playlist, backup download and unlock, help, log out, and no page errors.
     node tests/soak/editor.js      (mock provider on :8077, the app served and the dev relay; see tests/soak/chaos.js)
   APP=http://127.0.0.1:PORT/index.html for another app address. */
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
let fails = 0, loggedOut = false;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 200) : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const tctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit' });
  const tv = await tctx.newPage(); const tvErr = []; tv.on('pageerror', e => tvErr.push(e.message));
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(6000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  const st = await tv.evaluate(() => WebEdit.start().then(s => s, e => ({ err: e.message })));
  ok('editor starts on the TV', st.running, JSON.stringify(st));
  const pw = await tv.evaluate(() => WebEdit.password());
  const E = 'http://127.0.0.1:' + st.port + '/';
  const ectx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const ed = await ectx.newPage(); const edErr = [];
  ed.on('pageerror', e => edErr.push(e.message)); ed.on('console', m => { if (m.type() === 'error') edErr.push('console: ' + m.text()); });
  ed.on('dialog', d => d.accept());
  const tvState = f => tv.evaluate(f);
  let where = '';
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name + ' @ ' + where, false, e.message.split('\n')[0]); await ed.screenshot({ path: require('path').join(__dirname, '..', '.shots', 'editor-' + name.replace(/\W+/g, '-') + '.png') }); await ed.keyboard.press('Escape'); } };
  const at = w => { where = w; };
  const sendAndWait = async () => { await ed.click('#cbSend'); await ed.waitForFunction(() => /on the TV|Everything is on the TV/.test(document.getElementById('status').innerText), null, { timeout: 25000 }); await tv.waitForTimeout(500); };
  const go = async p => { await ed.click('#nav [data-page=' + p + ']'); await ed.waitForTimeout(800); };
  const modalBtn = async label => { await ed.locator('#modal button', { hasText: label }).first().click(); await ed.waitForTimeout(500); };

  await step('login', async () => {
    await ed.goto(E); await ed.waitForTimeout(1000);
    await ed.fill('#pw', 'WRONG-PASS'); await ed.click('#loginBtn'); await ed.waitForTimeout(800);
    ok('wrong password refused', await ed.isVisible('#pw'));
    await ed.fill('#pw', pw.toLowerCase().replace('-', ' ')); await ed.click('#loginBtn'); await ed.waitForTimeout(2500);
    ok('right password (lower case, space) logs in', await ed.isVisible('#p-home'));
  });

  await step('groups', async () => {
    await go('gc');
    await ed.click('input[data-vis="x9"]'); await ed.waitForTimeout(300);
    ok('hiding a group makes a draft', /1 change/.test(await ed.innerText('#cbText')), await ed.innerText('#cbText'));
    await sendAndWait();
    ok('hidden group reaches the TV', await tvState(() => !!Store.edits.hiddenGroups.x9));
    // rename a group
    at('rename group'); await ed.hover('#glist .g[data-id="x10"]'); await ed.click('#glist [data-ren="x10"]', { force: true }); await ed.waitForTimeout(400);
    await ed.fill('#pbIn', 'World News'); await ed.click('#pbOk'); await ed.waitForTimeout(300);
    // new group
    at('new group'); await ed.click('#newGroup'); await ed.waitForTimeout(400); await ed.fill('#pbIn', 'Audit Group'); await ed.click('#pbOk'); await ed.waitForTimeout(500);
    // copy 2 channels from All channels into it
    await ed.click('#glist .g[data-id="__all"], #glist .g >> nth=2').catch(() => {});
    await ed.waitForTimeout(500);
    at('tick'); const boxes = ed.locator('#clist input[data-sel]');
    await boxes.nth(0).check(); await boxes.nth(1).check();
    await ed.click('[data-bulk=copy]'); await ed.waitForTimeout(500);
    const sel = ed.locator('#modal select'); if (await sel.count()) { const opts = await sel.first().locator('option').allInnerTexts(); const i = opts.findIndex(o => /Audit Group/.test(o)); if (i >= 0) await sel.first().selectOption({ index: i }); }
    else { const dd = ed.locator('#modal .dd').first(); if (await dd.count()) { await dd.click(); await ed.waitForTimeout(300); await ed.locator('text=Audit Group').last().click(); await ed.waitForTimeout(300); } }
    at('copy ok'); await ed.locator('#modal button.primary').last().click(); await ed.waitForTimeout(500);
    // favorite + hide a channel with the row buttons
    at('fav'); await boxes.nth(2).check(); await ed.click('[data-bulk=fav]'); await ed.waitForTimeout(300);
    await boxes.nth(3).check(); await ed.click('[data-bulk=hide]'); await ed.waitForTimeout(300);
    await sendAndWait();
    const s = await tvState(() => ({ ren: Store.edits.groupRenames, custom: Store.edits.custom.map(g => g.name + ':' + g.items.length), hid: Object.keys(Store.edits.hiddenChannels), lib: Library.groups().map(g => Library.groupName(g.id)) }));
    ok('group rename reaches the TV', s.ren && s.ren.x10 === 'World News', JSON.stringify(s.ren));
    ok('new group with copied channels reaches the TV', s.custom.some(x => /^Audit Group:2$/.test(x)), s.custom.join(', '));
    ok('the TV lists the renamed group', s.lib.indexOf('World News') >= 0, s.lib.slice(0, 12).join(', '));
    ok('hidden channel reaches the TV', s.hid.length >= 3, s.hid.join(','));
  });

  await step('channel rename and sort', async () => {
    await ed.locator('#clist [data-ren]').first().click(); await ed.waitForTimeout(300);
    const box = ed.locator('#clist [data-renbox]'); await box.fill('Renamed Channel'); await box.press('Enter'); await ed.waitForTimeout(300);
    await sendAndWait();
    ok('channel rename reaches the TV', await tvState(() => Object.values(Store.edits.renames).indexOf('Renamed Channel') >= 0));
  });

  await step('names', async () => {
    await go('names');
    await ed.fill('#nPre', 'Global '); await ed.waitForTimeout(600);
    await sendAndWait();
    const n = await tvState(() => ({ pre: Store.playlist.names && Store.playlist.names.prefixes, name: Library.name(Library.find('x5')) }));
    ok('own prefix reaches the TV and changes names', JSON.stringify(n.pre).indexOf('Global') >= 0 && n.name === 'Desk', JSON.stringify(n));
  });

  await step('guide', async () => {
    await go('guide');
    await ed.fill('#srcUrl', 'http://127.0.0.1:8077/guide.xml.gz');
    await ed.click('#srcTest'); await ed.waitForTimeout(4000);
    ok('test a guide source', /Works/.test(await ed.innerText('#srcMsg')), await ed.innerText('#srcMsg'));
    await ed.click('#srcAdd'); await ed.waitForTimeout(4000);
    ok('add a guide source reaches the TV', await tvState(() => (Store.playlist.epgSources || []).some(s => /guide\.xml\.gz/.test(s.url))), await ed.innerText('#srcMsg'));
  });

  await step('smart clean-up', async () => {
    await go('tools');
    const before = await tvState(() => Object.keys(Store.edits.hiddenChannels).length);
    at('dupes'); const b2 = ed.locator('#p-tools button', { hasText: /extra cop/ }); if (await b2.count()) { await b2.first().click(); await ed.waitForTimeout(600); if (await ed.locator('#modal').count()) await ed.locator('#modal button.primary, #modal button.danger').last().click(); }
    await ed.waitForTimeout(500); await sendAndWait();
    const after = await tvState(() => Object.keys(Store.edits.hiddenChannels).length);
    ok('duplicate clean-up hides copies on the TV', after > before, before + ' -> ' + after);
  });

  await step('history', async () => {
    await go('history');
    await ed.fill('#snapName', 'Audit point'); await ed.click('#snapGo'); await ed.waitForTimeout(800); if (await ed.locator('#modal').count()) await ed.locator('#modal button.primary').last().click(); await ed.waitForTimeout(3500);
    ok('restore point made on the TV', /Audit point/.test(await ed.innerText('#snapList')), (await ed.innerText('#snapList')).slice(0, 120));
    await ed.click('#hUndo'); await ed.waitForTimeout(400);
    ok('undo makes a draft', /change/.test(await ed.innerText('#cbText')));
    await sendAndWait();
  });

  await step('playlists', async () => {
    await go('playlists');
    await ed.fill('#aName', 'Second'); await ed.fill('#aServer', 'http://127.0.0.1:8077'); await ed.fill('#aUser', 'demo'); await ed.fill('#aPass', 'demo');
    await ed.click('#aGo'); await ed.waitForFunction(() => /Added|channels|failed|Error/i.test(document.getElementById('addMsg').innerText), null, { timeout: 30000 });
    ok('add a playlist (TV tests the login)', await tvState(() => Store.settings.playlists.length === 2), await ed.innerText('#addMsg'));
    const html = await ed.innerHTML('#p-playlists');
    ok('editor never shows the password', html.indexOf('"demo"') < 0 && !/value="demo"/.test(html));
  });

  await step('backup', async () => {
    await go('backup');
    await ed.fill('#bPass', 'audit passphrase 1'); if (await ed.locator('#bPass2').count()) await ed.fill('#bPass2', 'audit passphrase 1');
    const [dl] = await Promise.all([ed.waitForEvent('download', { timeout: 30000 }), ed.click('#bDown')]);
    const f = await dl.path(); const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
    ok('backup downloads, encrypted, no login inside', j.kind === 'backup-encrypted' && JSON.stringify(j).indexOf('demo') < 0, j.cipher);
    await ed.setInputFiles('#bFile', f); await ed.waitForTimeout(800);
    await ed.fill('#rPass', 'audit passphrase 1'); await ed.click('#rUnlock'); await ed.waitForTimeout(3000);
    ok('backup unlocks and lists its playlists', /Demo provider|Second/.test(await ed.innerText('#p-backup')), (await ed.innerText('#rInfo')).slice(0, 120));
  });

  await step('help and logout', async () => {
    await go('help'); ok('help page has content', (await ed.innerText('#helpBody')).length > 500);
    loggedOut = true; await ed.click('#logout'); await ed.waitForTimeout(800); ok('log out returns to the password', await ed.isVisible('#pw'));
  });

  const real = edErr.filter(e => !/401/.test(e) || !loggedOut);
  ok('no editor page errors (401s after logging out are expected)', !real.length, real.join(' | '));
  ok('no TV page errors', !tvErr.length, tvErr.join(' | '));
  await tv.evaluate(() => WebEdit.stop());
  await b.close();
  console.log(fails ? fails + ' failed' : 'all editor audit checks passed');
  process.exit(fails ? 1 : 0);
})();
