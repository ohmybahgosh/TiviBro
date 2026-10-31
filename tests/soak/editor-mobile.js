/* The web editor on phones and tablets (what the set-up tour's QR code opens): every page on several
   screen sizes, checking that nothing is wider than the screen, that the page list opens from the top
   bar, that Groups and channels shows one pane at a time with a way back, that the channel ⋯ menu,
   dropdowns and dialogs stay on screen, that the change bar stays small, and that there are no errors.
     node tests/soak/editor-mobile.js [--shots dir]   (mock provider on :8077, the app served and the dev relay)
   APP=http://127.0.0.1:PORT/index.html for another app address. */
'use strict';
const { chromium, devices } = require('playwright');
const path = require('path');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const i = process.argv.indexOf('--shots'), SHOTS = i > 0 ? process.argv[i + 1] : '';
const DEVICES = ['iPhone SE', 'iPhone 13', 'Pixel 7', 'iPad Mini'];
const PAGES = ['home', 'gc', 'guide', 'names', 'tools', 'playlists', 'history', 'backup', 'report', 'help'];
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 220) : '')); if (!c) fails++; };

// Elements that stick out past the right edge and are not inside a scroller that stays on screen.
const OVER = () => {
  const W = innerWidth, out = [];
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect();
    if (!r.width || r.right <= W + 1 || getComputedStyle(e).visibility === 'hidden') return;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= W + 1) return;
    }
    out.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') + ' to ' + Math.round(r.right));
  });
  return out.slice(0, 6);
};

(async () => {
  const b = await chromium.launch();
  const tv = await (await b.newContext()).newPage();
  await tv.addInitScript(R.init({ time: R.primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(5000);
  await tv.evaluate(() => WebEdit.stop()); await tv.waitForTimeout(300);
  const st = await tv.evaluate(() => WebEdit.start());
  const pw = await tv.evaluate(() => WebEdit.password());
  for (const dev of DEVICES) {
    const d = devices[dev], phone = d.viewport.width <= 700, tag = dev.replace(/\W+/g, '-').toLowerCase();
    const ctx = await b.newContext(Object.assign({}, d, { deviceScaleFactor: 1 }));
    const ed = await ctx.newPage(); const errs = []; ed.on('pageerror', e => errs.push(e.message));
    ed.on('dialog', d => d.accept());            // Discard asks first
    // The QR code's address: signed in and on Smart clean-up.
    await ed.goto('http://127.0.0.1:' + st.port + '/#k=' + pw + '/tools'); await ed.waitForTimeout(3500);
    // The last device's test changes, autosaved on the TV: throw them away.
    await ed.evaluate(() => { const b = [].slice.call(document.querySelectorAll('#modal button')).filter(x => /Throw them away/.test(x.textContent))[0]; if (b) b.click(); }); await ed.waitForTimeout(300);
    const where = await ed.evaluate(() => ({ hash: location.hash, app: !document.getElementById('app').classList.contains('hidden') }));
    ok(dev + ': the QR address signs in and opens Smart clean-up, password gone from the address', where.app && where.hash === '#tools', JSON.stringify(where));
    for (const p of PAGES) {
      await ed.evaluate(p => { document.body.classList.remove('gc-chans'); show(p); }, p); await ed.waitForTimeout(600);
      const o = await ed.evaluate(OVER);
      ok(dev + ': ' + p + ' fits the screen', !o.length, o.join(', '));
      if (SHOTS && phone && dev === 'iPhone 13') await ed.screenshot({ path: path.join(SHOTS, 'editor-phone-' + p + '.png') });
    }
    // Groups and channels
    await ed.evaluate(() => show('gc')); await ed.waitForTimeout(400);
    await ed.tap('#glist .g[data-id]:not([data-id="__all"]) .gname'); await ed.waitForTimeout(600);
    const panes = await ed.evaluate(() => ({ groups: !!document.querySelector('.gc .groups').offsetWidth, chans: !!document.querySelector('.gc .chans').offsetWidth }));
    ok(dev + ': picking a group shows its channels' + (phone ? ' on their own' : ' beside the groups'), panes.chans && panes.groups === !phone, JSON.stringify(panes));
    let o = await ed.evaluate(OVER); ok(dev + ': channel rows fit', !o.length, o.join(', '));
    if (phone) {
      await ed.tap('.c [data-more]'); await ed.waitForTimeout(300);
      const m = await ed.evaluate(() => { const m = document.getElementById('menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { n: m.children.length, t: m.innerText.replace(/\n+/g, ' | '), l: r.left, r: r.right, b: r.bottom, H: innerHeight, W: innerWidth }; });
      ok(dev + ': ⋯ on a channel opens Rename, Copy or move, the moves and Take out, on screen', m && /Rename/.test(m.t) && /Move down one/.test(m.t) && /Move to position/.test(m.t) && /Take out/.test(m.t) && m.l >= 0 && m.r <= m.W && m.b <= m.H, JSON.stringify(m));
      // Phones cannot drag: "Move down one" reorders the group (a provider group gets your order).
      const first = await ed.evaluate(() => document.querySelector('.c').dataset.k);
      await ed.tap('#menu .pick:has-text("Move down one")'); await ed.waitForTimeout(400);
      const second = await ed.evaluate(() => document.querySelectorAll('.c')[1].dataset.k);
      ok(dev + ': Move down one moves the channel', second === first, first + ' / ' + second);
      await ed.evaluate(() => { if (typeof undo === 'function') undo(); }); await ed.waitForTimeout(300);
      await ed.tap('.c [data-more]'); await ed.waitForTimeout(300);
      if (SHOTS && dev === 'iPhone 13') await ed.screenshot({ path: path.join(SHOTS, 'editor-phone-channel-menu.png') });
      await ed.tap('#menu .pick:nth-child(2)'); await ed.waitForTimeout(600);
    } else { await ed.tap('.c [data-add]'); await ed.waitForTimeout(600); }
    o = await ed.evaluate(OVER); ok(dev + ': the copy or move dialog fits', await ed.isVisible('#modal') && !o.length, o.join(', '));
    await ed.evaluate(() => closeModal());
    await ed.tap('#cFilter > button'); await ed.waitForTimeout(300);
    const dm = await ed.evaluate(() => { const m = document.querySelector('.ddm'); if (!m) return null; const r = m.getBoundingClientRect(); return { l: r.left, r: r.right, W: innerWidth }; });
    ok(dev + ': dropdowns open on screen', dm && dm.l >= 0 && dm.r <= dm.W, JSON.stringify(dm));
    await ed.evaluate(() => closeDD());
    await ed.tap('.c [data-vis]'); await ed.waitForTimeout(500);
    const bar = await ed.evaluate(() => { const c = document.getElementById('changebar'); return c && !c.classList.contains('hidden') ? Math.round(c.getBoundingClientRect().height) : 0; });
    ok(dev + ': the change bar shows and stays small', bar > 0 && bar <= (phone ? 120 : 110), bar + 'px');
    if (SHOTS && dev === 'iPhone 13') await ed.screenshot({ path: path.join(SHOTS, 'editor-phone-channels.png') });
    await ed.evaluate(() => { document.getElementById('cbDiscard').click(); });
    await ed.waitForTimeout(300);
    await ed.evaluate(() => { const b = [].slice.call(document.querySelectorAll('#modal button')).filter(x => /discard/i.test(x.textContent))[0]; if (b) b.click(); });
    if (phone) {
      await ed.tap('#gcBack'); await ed.waitForTimeout(300);
      ok(dev + ': ‹ Groups goes back to the groups', await ed.evaluate(() => !!document.querySelector('.gc .groups').offsetWidth && !document.querySelector('.gc .chans').offsetWidth));
      await ed.tap('#navToggle'); await ed.waitForTimeout(300);
      const nav = await ed.evaluate(() => [].slice.call(document.querySelectorAll('#nav button')).filter(x => x.offsetWidth).map(x => x.querySelector('span').textContent.trim()));
      ok(dev + ': the top bar opens every page by name, and Log out', nav.indexOf('Smart clean-up') >= 0 && nav.indexOf('Backup and restore') >= 0 && nav.indexOf('Log out') >= 0, nav.join(', '));
      if (SHOTS && dev === 'iPhone 13') await ed.screenshot({ path: path.join(SHOTS, 'editor-phone-pages.png') });
      await ed.tap('#nav button[data-page="names"]'); await ed.waitForTimeout(400);
      const after = await ed.evaluate(() => ({ open: document.body.classList.contains('navopen'), cur: document.getElementById('navCur').textContent, page: page }));
      ok(dev + ': picking a page closes the list and names it in the top bar', !after.open && after.cur === 'Channel names' && after.page === 'names', JSON.stringify(after));
    }
    // Smart match: long channel names must not push the confidence and approve buttons off screen.
    await ed.evaluate(() => { location.hash = '#guide'; }); await ed.waitForTimeout(800);
    await ed.evaluate(() => document.getElementById('smartBtn').click());
    await ed.waitForSelector('#smBody table, #smBody .empty', { timeout: 30000 });
    const sm = await ed.evaluate(() => {
      const row = document.querySelector('#smBody table tr:nth-child(2)'); if (!row) return { rows: 0 };
      const box = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; };
      return { rows: document.querySelectorAll('#smBody table tr').length - 1, conf: box(row.querySelector('.conf')), yes: box(row.querySelector('[data-yes]')), W: innerWidth };
    });
    o = await ed.evaluate(OVER);
    ok(dev + ': Smart match shows confidence and approve without scrolling sideways', sm.rows > 0 && sm.conf.r <= sm.W && sm.yes.r <= sm.W && sm.conf.l >= 0 && !o.length, JSON.stringify(sm) + ' ' + o.join(', '));
    if (SHOTS && dev === 'iPhone 13') await ed.screenshot({ path: path.join(SHOTS, 'editor-phone-smart-match.png') });
    // Tapping ✓ on a row that is already approved keeps it approved (it used to quietly un-approve it).
    const ap = await ed.evaluate(() => {
      const b = document.querySelector('#smBody button.yes.on'); if (!b) return null;
      const k = b.dataset.yes; b.click();
      const again = document.querySelector('#smBody button[data-yes="' + k + '"]');
      return { still: again.classList.contains('on'), label: again.textContent, go: document.getElementById('smGo').textContent };
    });
    ok(dev + ': tapping ✓ again keeps the row approved', ap && ap.still && /Approved/.test(ap.label) && /Apply \d/.test(ap.go), JSON.stringify(ap));
    const before = await ed.evaluate(() => matchPool().filter(c => guideState(c) === 'none' || guideState(c) === 'prov').length);
    await ed.evaluate(() => document.getElementById('smGo').click()); await ed.waitForTimeout(500);
    const after2 = await ed.evaluate(() => matchPool().filter(c => guideState(c) === 'none' || guideState(c) === 'prov').length);
    ok(dev + ': applied matches leave Needs a guide', after2 < before, before + ' -> ' + after2);
    // Throw the test's changes away so the next device starts clean (drafts are kept on the TV).
    await ed.evaluate(() => { const d = document.getElementById('cbDiscard'); if (d) d.click(); }); await ed.waitForTimeout(3500);
    await ed.evaluate(() => { const b = [].slice.call(document.querySelectorAll('#modal button')).filter(x => /discard/i.test(x.textContent))[0]; if (b) b.click(); }); await ed.waitForTimeout(300);
    ok(dev + ': no page errors', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(fails ? fails + ' failed' : 'all phone and tablet editor checks passed');
  process.exit(fails ? 1 : 0);
})();
