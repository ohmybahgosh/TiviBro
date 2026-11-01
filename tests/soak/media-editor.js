/* My media source management in the editor, before the TV media screen is opened.
   Requires npm run serve and MOCK_PORT=8088 node tests/mock/mock_provider.js.
   NODE_PATH=/tmp/tivibro-playwright/node_modules node tests/soak/media-editor.js */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'media-editor-soak-'));
const proxy = require('../../service/proxy');
const R = require('../../scripts/demo/record');
(async () => {
  const browser = await chromium.launch();
  let tv;
  const relay = proxy.create({});
  await new Promise(f => relay.server.listen(0, '127.0.0.1', f));
  try {
    tv = await browser.newPage();
    const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: 'http://127.0.0.1:8088' });
    await tv.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
    await tv.addInitScript(p => localStorage.setItem('tivibro.devRelay', String(p)), relay.server.address().port);
    let failLogin = true, empty = false;
    await tv.route('**/media/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
    await tv.route('**/media/scan', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(failLogin ? { error: 'login', message: 'Wrong login.' } : { movies: empty ? [] : [{ id: 'w:/movie.mkv', title: 'Mock movie', path: '/movie.mkv', file: 'movie.mkv' }] }) }));
    await tv.goto(process.env.APP || 'http://127.0.0.1:8078/index.html');
    await tv.waitForFunction(() => window.Library && Library.count() > 0);
    const status = await tv.evaluate(() => WebEdit.start());
    const password = await tv.evaluate(() => WebEdit.password());
    const ed = await browser.newPage();
    const errors = []; ed.on('pageerror', e => errors.push(e.message));
    await ed.goto('http://127.0.0.1:' + status.port + '/');
    await ed.fill('#pw', password); await ed.click('#loginBtn');
    await ed.click('#nav [data-page="media"]');
    assert.equal(await ed.locator('#nav [data-page="media"] svg').count(), 1);
    assert.equal(await ed.locator('#p-media .phead h1').innerText(), 'My media');
    assert.equal(await ed.locator('#p-media .scroll #mediaAdd.form label.f').count(), 3);
    assert.equal(await ed.inputValue('#mediaAddress'), '');
    console.log('PASS media page uses shared navigation, page and form styling with a generic address');
    assert(await ed.locator('#p-media img[alt="TMDB"]').evaluate(i => i.complete && i.naturalWidth > 0));
    await ed.selectOption('#mediaLanguage', 'nl');
    await ed.selectOption('#mediaSort', 'release');
    await ed.fill('#mediaTmdbToken', 'mock-user-token-123456789012345');
    await ed.click('#mediaPreferences button[type="submit"]');
    await tv.waitForFunction(() => MediaStore.preferences().language === 'nl');
    assert.equal(await tv.evaluate(() => MediaStore.preferences().sort), 'release');
    assert.equal(await tv.evaluate(() => MediaStore.preferences().tmdbConfigured), true);
    assert.equal(await ed.inputValue('#mediaTmdbToken'), '');
    await ed.waitForFunction(() => document.getElementById('mediaTokenLabel').textContent === 'TMDB API token saved on this TV');
    assert((await ed.textContent('#mediaTokenStatus')).includes('Leave the field blank'));
    console.log('PASS language, sort and private user-token settings reach the TV, with clear saved status');
    await ed.fill('#mediaAddress', 'https://example.invalid/');
    await ed.fill('#mediaUser', 'mock-customer'); await ed.fill('#mediaPass', 'mock-key');
    await ed.click('#mediaAdd button');
    await ed.waitForFunction(() => /Wrong login/.test(document.getElementById('mediaMsg').textContent));
    assert.equal(await tv.evaluate(() => MediaStore.sources().length), 0);
    assert.equal(await ed.inputValue('#mediaPass'), '');
    console.log('PASS wrong login is shown and not saved; password field clears');
    failLogin = false;
    await ed.fill('#mediaPass', 'mock-key'); await ed.click('#mediaAdd button');
    await ed.waitForFunction(() => /Mock|example.invalid/.test(document.getElementById('mediaList').textContent));
    assert.equal(await tv.evaluate(() => MediaStore.movies(null).length), 1);
    assert(!/mock-key|mock-customer/.test(await ed.locator('#mediaList').innerText()));
    console.log('PASS editor adds a source before the TV media screen opens');
    if (process.env.SHOTS) {
      await ed.screenshot({ path: process.env.SHOTS + '/media-editor-desktop.png', fullPage: true });
      await ed.setViewportSize({ width: 390, height: 844 });
      await ed.screenshot({ path: process.env.SHOTS + '/media-editor-phone.png', fullPage: true });
      assert(await ed.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone layout fits the screen');
      await ed.setViewportSize({ width: 1280, height: 720 });
    }
    empty = true;
    await ed.locator('#mediaList button', { hasText: 'Rescan' }).click();
    await ed.waitForFunction(() => /list stays/.test(document.getElementById('mediaMsg').textContent));
    assert.equal(await tv.evaluate(() => MediaStore.movies(null).length), 1);
    console.log('PASS empty editor rescan keeps the library');
    await ed.locator('#mediaList button', { hasText: 'Remove' }).click();
    assert.equal(await tv.evaluate(() => MediaStore.sources().length), 1);
    await ed.locator('#modal button', { hasText: /^Remove$/ }).click();
    await tv.waitForFunction(() => MediaStore.sources().length === 0);
    console.log('PASS removal asks first and reaches the TV');
    assert.deepEqual(errors, []);
    console.log('ALL PASS');
  } finally {
    if (tv) await tv.evaluate(() => WebEdit.stop()).catch(() => {});
    await browser.close();
    relay.server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
