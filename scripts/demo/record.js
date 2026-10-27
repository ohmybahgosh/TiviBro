/* Records the demo clips and screenshots used in the README and the user guide.
     node scripts/demo/record.js [scene ...]     (all scenes when none are named)
   Needs, running locally: tests/mock/mock_provider.js (8077), tests/mock/relay_dev.js (47811)
   and a static server for app/ on 8078 (npm run serve does the last two).
   Writes raw recordings to docs/media/raw/ (git-ignored); scripts/demo/encode.sh turns them
   into the GIFs and MP4s.  The clock is set to 8:05pm so the guide looks like prime time, and a
   small banner shows which remote button is pressed. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'docs', 'media', 'raw'), SHOTS = path.join(ROOT, 'docs', 'screenshots');
const APP = process.env.DEMO_APP || 'http://127.0.0.1:8078/index.html';
const EDITOR = process.env.DEMO_EDITOR || 'http://127.0.0.1:8787/';
const want = name => process.argv.length <= 2 || process.argv.indexOf(name) > 1;
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });

function primeTime() { const d = new Date(); d.setHours(20, 4, 30, 0); return d.getTime(); }
const SETTINGS = { meter: 'off', playlists: [{ id: 'p1', name: 'Demo provider', type: 'xtream', server: 'http://127.0.0.1:8077', user: 'demo', pass: 'demo', providerEpg: 'xmltv', epgDays: 1 }], active: 'p1' };
const EDITS = {
  custom: [{ id: 'c_fav', name: 'Favorites', items: ['x1', 'x12', 'x30', 'x44', 'x48', 'x20'] }, { id: 'c_game', name: 'Game Day', items: ['x11', 'x12', 'x13', 'x15', 'x16'] }],
  hiddenGroups: { x13: 1, x14: 1 }, hiddenChannels: { x2: 1, x3: 1 }
};

const KEYS = {
  ArrowRight: '▶', ArrowLeft: '◀', ArrowUp: '▲', ArrowDown: '▼', Enter: 'OK', Escape: 'BACK', PageUp: 'CH +', PageDown: 'CH −',
  g: '<i style="background:#3fa85f"></i>GREEN', m: '<i style="background:#d6453d"></i>RED', y: '<i style="background:#e0b630"></i>YELLOW', b: '<i style="background:#3d79d6"></i>BLUE', i: 'INFO'
};
const CODES = { play: [415, '▶❙❙ PLAY'], rew: [412, '◀◀ REW'], ff: [417, '▶▶ FF'], red: [403, '<i style="background:#d6453d"></i>RED'], green: [404, '<i style="background:#3fa85f"></i>GREEN'], yellow: [405, '<i style="background:#e0b630"></i>YELLOW'], blue: [406, '<i style="background:#3d79d6"></i>BLUE'], info: [457, 'INFO'] };

function init(opts) {
  // Runs in the page before the app: fixed prime-time clock, demo data, and the key banner.
  return [`(() => {
    const OFF = ${opts.time} - Date.now(), RD = Date;
    class D extends RD { constructor(...a) { if (!a.length) super(RD.now() + OFF); else super(...a); } static now() { return RD.now() + OFF; } }
    window.Date = D;
    ${opts.fresh ? `if (!sessionStorage.getItem('demoInit')) { localStorage.clear(); sessionStorage.setItem('demoInit', '1'); }` : `if (!sessionStorage.getItem('demoInit')) { localStorage.clear();
      localStorage.setItem('tivibro.settings', ${JSON.stringify(JSON.stringify(Object.assign({}, SETTINGS, opts.settings || {})))});
      localStorage.setItem('tivibro.edits.p1', ${JSON.stringify(JSON.stringify(EDITS))});
      sessionStorage.setItem('demoInit', '1'); }`}
    localStorage.setItem('tivibro.devRelay', '47811');
    // The recordings are remote-only: keep stray pointer events from opening the side menu.
    ['mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'].forEach(t => addEventListener(t, e => e.stopImmediatePropagation(), true));
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#demoKey{position:fixed;right:56px;top:86px;transform:translateY(-14px);opacity:0;z-index:99999;display:flex;align-items:center;gap:18px;padding:12px 26px 12px 14px;border-radius:999px;background:rgba(11,14,26,.92);border:2px solid #5b8cff;color:#e8ecf8;font:600 30px Inter,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6);transition:opacity .18s,transform .18s;pointer-events:none;white-space:nowrap}' +
        '#demoKey.on{opacity:1;transform:translateY(0)}#demoKey b{display:inline-flex;align-items:center;gap:10px;min-width:64px;justify-content:center;padding:6px 16px;border-radius:14px;background:#e8ecf8;color:#0b0e1a;font-weight:800;font-size:26px}' +
        '#demoKey b i{width:18px;height:18px;border-radius:50%;display:inline-block}#demoKey span:empty{display:none}';
      document.head.appendChild(s);
      const k = document.createElement('div'); k.id = 'demoKey'; k.innerHTML = '<b></b><span></span>'; document.body.appendChild(k);
      let t = 0;
      window.__key = (label, caption) => { k.firstChild.innerHTML = label; k.lastChild.textContent = caption || ''; k.classList.add('on'); clearTimeout(t); t = setTimeout(() => k.classList.remove('on'), caption ? 1900 : 900); };
    });
  })();`];
}

// Remote-control helpers for a TV page: press shows the key banner, quiet does not.
function helpers(page) {
  const press = async (key, caption, wait) => {
    if (CODES[key]) {
      await page.evaluate(([l, c]) => window.__key && window.__key(l, c), [CODES[key][1], caption || '']);
      await page.evaluate(c => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: c, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: c, bubbles: true })); }, CODES[key][0]);
    } else {
      await page.evaluate(([l, c]) => window.__key && window.__key(l, c), [KEYS[key] || key.toUpperCase(), caption || '']);
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(wait == null ? 650 : wait);
  };
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const say = async (caption, ms) => { await page.evaluate(c => window.__key && window.__key('ⓘ', c), caption); await page.waitForTimeout(ms || 1600); };
  const hold = async (caption) => { await page.evaluate(c => window.__key && window.__key('HOLD OK', c), caption || ''); await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); await page.waitForTimeout(700); };
  const quiet = async (key, wait) => { await page.keyboard.press(key); await page.waitForTimeout(wait == null ? 400 : wait); };
  return { press, shot, say, hold, quiet };
}

// A visible mouse pointer for the computer-side recordings (headless recordings show none).
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.7L4 20z" fill="#fff" stroke="#0b0e1a" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:filter .1s;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))';
  document.documentElement.appendChild(c);
  addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 5) + 'px,' + (e.clientY - 3) + 'px)'; }, true);
  addEventListener('mousedown', () => { c.style.filter = 'drop-shadow(0 0 10px #5b8cff) drop-shadow(0 0 4px #5b8cff)'; }, true);
  addEventListener('mouseup', () => { setTimeout(() => { c.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.5))'; }, 160); }, true);
});`;

async function scene(browser, name, opts, fn) {
  if (!want(name)) return;
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit', recordVideo: opts.video === false ? undefined : { dir: RAW, size: { width: 1920, height: 1080 } } });
  const t0 = Date.now();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(init(Object.assign({ time: primeTime() }, opts))[0]);
  await page.goto(opts.url || APP);
  await page.waitForTimeout(opts.settle || 5500);
  let start = (Date.now() - t0) / 1000;
  let end = 0;
  const mark = () => { start = (Date.now() - t0) / 1000; };
  const stop = () => { end = (Date.now() - t0) / 1000; };
  const h = helpers(page);
  await fn(Object.assign({ page, mark, stop }, h));
  const v = page.video();
  await ctx.close();
  if (v) { const src = await v.path(); const dst = path.join(RAW, name + '.webm'); fs.renameSync(src, dst); fs.writeFileSync(dst + '.start', String(start)); if (end) fs.writeFileSync(dst + '.end', String(end)); else try { fs.unlinkSync(dst + '.end'); } catch (e) {} }
  console.log(`${name}: ${errs.length ? 'errors: ' + errs.join(' | ') : 'ok'}  (starts at ${start.toFixed(1)}s)`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  await scene(browser, 'guide', {}, async ({ press, shot, say }) => {
    await say('The guide is home', 1400);
    await press('ArrowRight', 'Into the guide', 900);
    await shot('tv-guide');
    await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown', '', 800);
    await press('ArrowRight', 'Later today'); await press('ArrowRight', '', 900);
    await press('ArrowLeft'); await press('ArrowLeft', 'Back to now', 900);
    await press('Enter', 'Preview in the window', 3200);
    await shot('tv-guide-preview');
    await press('Enter', 'OK again: fullscreen', 3500);
    await shot('tv-fullscreen');
  });

  // Fullscreen: channel up/down, the info bar, the quick menu, last channel and back to the guide.
  await scene(browser, 'zap', {}, async ({ press, shot, mark, quiet }) => {
    await quiet('ArrowUp', 300); await quiet('ArrowUp', 900); await quiet('ArrowRight', 600); await quiet('Enter', 2500); await quiet('Enter', 3000);
    mark();
    await press('PageUp', 'Next channel', 2200);
    await press('PageUp', '', 2200);
    await press('PageDown', 'Previous channel', 2200);
    await press('ArrowRight', 'What\'s on now and next', 2600);
    await shot('tv-info');
    await press('Escape', '', 700);
    await press('Enter', 'Quick menu', 1200);
    await press('ArrowRight'); await press('ArrowRight'); await press('ArrowRight', '', 900);
    await shot('tv-quick-menu');
    await press('Escape', '', 700);
    await press('yellow', 'Last channel', 2400);
    await press('green', 'Guide over the video', 2200);
    await shot('tv-mini-guide');
  });

  // Groups: the panel beside the guide, then the menu.
  await scene(browser, 'groups', {}, async ({ press, shot }) => {
    await press('ArrowDown', 'Groups beside the guide', 1100);
    await press('ArrowDown', '', 1000); await press('ArrowDown', '', 1200);
    await shot('tv-groups');
    await press('ArrowUp', '', 600); await press('ArrowUp', '', 600); await press('ArrowUp', '', 600); await press('ArrowUp', 'Favorites and your own groups', 1300);
    await press('ArrowRight', 'Into the group', 1600);
    await press('ArrowLeft', 'Back to the groups', 1000);
    await press('ArrowLeft', 'Menu', 1300);
    await shot('tv-menu');
    await press('ArrowRight', '', 900);
  });

  // Catch-up: rewind the guide into the past and replay a programme that already aired.
  await scene(browser, 'catchup', {}, async ({ press, shot, hold, stop }) => {
    await press('ArrowRight', '', 700);
    await press('rew', 'Back in time', 900); await press('rew', '', 900); await press('rew', '', 1200);
    await shot('tv-catchup-guide');
    await hold('Programme options');
    await shot('tv-hold-menu');
    await press('Escape', '', 700);
    await press('Enter', 'Replay it from the start', 4500);
    await shot('tv-catchup-play');
    stop();
  });

  // Search across channels, programmes, movies and shows.
  await scene(browser, 'search', {}, async ({ page, press, shot }) => {
    await press('ArrowLeft', 'Menu', 900);
    for (let i = 0; i < 4; i++) await press('ArrowDown', '', 350);
    await press('Enter', 'Search', 1200);
    await page.evaluate(() => window.__key('⌨', 'Type a few letters'));
    await page.keyboard.type('night', { delay: 230 }); await page.waitForTimeout(1800);
    await shot('tv-search');
    await press('ArrowDown', '', 700); await press('ArrowDown', '', 700); await press('ArrowDown', '', 1200);
  });

  // Movies and shows from the provider.
  await scene(browser, 'vod', { settle: 7000 }, async ({ press, shot }) => {
    await press('ArrowLeft', 'Menu', 900);
    await press('ArrowDown', '', 400); await press('ArrowDown', '', 600);
    await press('Enter', 'Movies', 2200);
    await press('ArrowDown', '', 900); await press('ArrowDown', '', 900); await press('ArrowDown', '', 1300);
    await shot('tv-movies');
    await press('ArrowLeft', 'Categories', 800); await press('ArrowDown', '', 900); await press('ArrowDown', '', 1100);
    await press('Escape', 'Menu', 900);
    await press('ArrowDown', '', 600);
    await press('Enter', 'Shows', 2200);
    await press('ArrowDown', '', 900);
    await press('Enter', 'Seasons and episodes', 2200);
    await shot('tv-episodes');
    await press('ArrowDown', '', 800); await press('ArrowDown', '', 1200);
  });

  // Multiview: two channels side by side.
  await scene(browser, 'multiview', {}, async ({ press, shot, mark, quiet }) => {
    await quiet('ArrowUp', 300); await quiet('ArrowUp', 900); await quiet('ArrowRight', 600); await quiet('Enter', 2500); await quiet('Enter', 3000);
    mark();
    await press('blue', 'Multiview', 2500);
    await press('ArrowRight', '', 700);
    await press('Enter', 'Pick a channel', 1200);
    await press('ArrowDown', '', 600);
    await press('Enter', '', 3500);
    await shot('tv-multiview');
    await press('ArrowLeft', 'Sound follows the focus', 2200);
    await press('Enter', 'Fullscreen', 2500);
  });

  // Settings: the sections, and a live look change.
  await scene(browser, 'settings', {}, async ({ press, shot, stop, quiet }) => {
    await press('ArrowLeft', 'Menu', 900);
    for (let i = 0; i < 5; i++) await press('ArrowDown', '', 300);
    await press('Enter', 'Settings', 1400);
    await shot('tv-settings');
    for (let i = 0; i < 5; i++) await press('ArrowDown', '', 650);
    await press('ArrowRight', 'Appearance', 1000);
    await press('ArrowRight', 'Accent color', 1200); await press('ArrowRight', '', 1200); await press('ArrowRight', '', 1400);
    await shot('tv-settings-look');
    await press('ArrowDown', 'Background', 900);
    await press('ArrowRight', '', 1500); await press('ArrowRight', '', 1500); await press('ArrowRight', '', 1500);
    stop();
    await quiet('ArrowRight'); await quiet('ArrowUp');
    for (let i = 0; i < 6; i++) await quiet('ArrowRight', 200);
  });

  // A brand-new TV: the first screen offers setup or restore from a computer.
  await scene(browser, 'firstrun', { fresh: true, settle: 4500 }, async ({ page, press, shot }) => {
    await shot('tv-first-run');
    await toSetupButton(page, (k, w) => press(k, '', w));
    await press('Enter', 'Set up or restore from a computer', 2600);
    await shot('tv-first-run-remote');
  });

  // Fresh TV + computer: restore a locked backup onto a brand-new install.
  const backup = path.join(RAW, 'demo-backup.tivibro'), PASS = 'Lantern-Harbor-Quartz-77';
  if (want('restore') && !fs.existsSync(backup)) await makeBackup(browser, backup, PASS);
  await dual(browser, 'restore', { fresh: true, settle: 4500 }, async ({ tv, ed, mark, stop }) => {
    await toSetupButton(tv.page, tv.quiet);
    mark();
    await tv.say('A brand-new TV', 1500);
    await tv.press('Enter', 'Set up or restore from a computer', 600);
    await tv.page.waitForFunction(() => WebEdit.on, null, { timeout: 15000 });
    await tv.page.waitForTimeout(1800);
    const pw = await tv.page.evaluate(() => WebEdit.password());
    await ed.open();
    await ed.type('#pw', pw);
    await ed.click('#loginBtn', 2200);
    await ed.click('#p-welcome [data-go=backup]', 1200);
    await ed.move('#drop', 600);
    await ed.page.setInputFiles('#bFile', backup); await ed.page.waitForTimeout(1200);
    await ed.type('#rPass', PASS, 45);
    await ed.click('#rUnlock', 2200);
    await ed.click('#rGo', 900);
    await ed.click('#modal .primary, #modal button.danger', 300);
    await tv.page.waitForTimeout(9000);
    await tv.shot('tv-restored');
    stop();
  });

  // The editor and the TV side by side: hide the groups you never watch, send, and the TV follows.
  await dual(browser, 'live-edit', {}, async ({ tv, ed, mark, stop }) => {
    await tv.page.evaluate(() => WebEdit.start()); await tv.page.waitForTimeout(800);
    for (let i = 0; i < 9; i++) await tv.quiet('ArrowDown', 150);
    const pw = await tv.page.evaluate(() => WebEdit.password());
    await ed.open();
    await ed.page.fill('#pw', pw); await ed.page.click('#loginBtn'); await ed.page.waitForTimeout(2500);
    mark();
    await ed.click('#nav [data-page=gc]', 1200);
    for (const id of ['x9', 'x10', 'x11', 'x12']) await ed.click('input[data-vis="' + id + '"]', 450);
    await ed.page.waitForTimeout(600);
    await ed.click('#cbSend', 300);
    await tv.page.waitForTimeout(4500);
    await tv.press('ArrowDown', 'UK, FR and DE groups gone', 450);
    for (let i = 0; i < 9; i++) await tv.press('ArrowDown', '', 380);
    await tv.page.waitForTimeout(1500);
    stop();
  });

  await browser.close();
})();

// First-run screen: walk the focus down to the "Set up or restore from a computer" button.
async function toSetupButton(page, key) {
  const focused = () => page.evaluate(() => { const f = document.querySelector('.focus'); return f ? f.textContent : ''; });
  for (let i = 0; i < 14 && !/^Set up or restore/.test(await focused()); i++) await key(/View log/.test(await focused()) ? 'ArrowRight' : 'ArrowDown', 280);
}

// Makes the locked backup the restore scene loads: a seeded TV, its editor, and the Backup page.
function stopEditor() {
  return new Promise(res => { const r = require('http').request({ host: '127.0.0.1', port: 47811, path: '/editor/stop', method: 'POST', headers: { 'Content-Type': 'application/json' } }, x => { x.resume(); x.on('end', res); }); r.on('error', res); r.end('{}'); });
}

async function makeBackup(browser, file, pass) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit', acceptDownloads: true });
  const tv = await ctx.newPage();
  await tv.addInitScript(init({ time: primeTime() })[0]);
  await tv.goto(APP); await tv.waitForTimeout(5000);
  await tv.evaluate(() => WebEdit.start()); await tv.waitForTimeout(800);
  const pw = await tv.evaluate(() => WebEdit.password());
  const ed = await ctx.newPage();
  await ed.goto(EDITOR); await ed.fill('#pw', pw); await ed.click('#loginBtn'); await ed.waitForTimeout(2000);
  await ed.click('#nav [data-page=backup]'); await ed.fill('#bPass', pass); await ed.fill('#bPass2', pass);
  const [dl] = await Promise.all([ed.waitForEvent('download'), ed.click('#bDown')]);
  await dl.saveAs(file);
  await tv.evaluate(() => WebEdit.stop());
  await ctx.close();
  console.log('backup: ' + path.basename(file));
}

// Two windows recorded together: the TV (1920x1080) and a computer browser (1280x720).
async function dual(browser, name, opts, fn) {
  if (!want(name)) return;
  await stopEditor();   // a TV from an earlier scene may have left it running with its own password
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Detroit', recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } } });
  const tvT0 = Date.now();
  const tvPage = await tvCtx.newPage();
  const errs = []; tvPage.on('pageerror', e => errs.push('tv: ' + e.message));
  await tvPage.addInitScript(init(Object.assign({ time: primeTime() }, opts))[0]);
  await tvPage.goto(APP); await tvPage.waitForTimeout(opts.settle || 5500);
  const edCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'America/Detroit', recordVideo: { dir: RAW, size: { width: 1280, height: 720 } } });
  const edT0 = Date.now();
  const edPage = await edCtx.newPage();
  edPage.on('pageerror', e => errs.push('editor: ' + e.message));
  await edPage.addInitScript(CURSOR);
  await edPage.setContent('<body style="margin:0;background:#0b0e1a"></body>');
  let start = Date.now(), end = 0;
  const tv = Object.assign({ page: tvPage }, helpers(tvPage));
  const at = async (sel) => { const loc = edPage.locator(sel).first(); await loc.scrollIntoViewIfNeeded(); await edPage.waitForTimeout(250); const b = await loc.boundingBox(); if (!b) { await edPage.screenshot({ path: '/tmp/claude-0/demo/probe/ed-fail.png' }); await tvPage.screenshot({ path: '/tmp/claude-0/demo/probe/tv-fail.png' }); throw new Error('not on screen: ' + sel); } return [b.x + b.width / 2, b.y + b.height / 2]; };
  const ed = {
    page: edPage,
    open: async () => { await edPage.goto(EDITOR); await edPage.mouse.move(900, 520); await edPage.waitForTimeout(900); },
    move: async (sel, wait) => { const [x, y] = await at(sel); await edPage.mouse.move(x, y, { steps: 22 }); await edPage.waitForTimeout(wait == null ? 250 : wait); },
    click: async (sel, wait) => { const [x, y] = await at(sel); await edPage.mouse.move(x, y, { steps: 22 }); await edPage.waitForTimeout(220); await edPage.mouse.click(x, y); await edPage.waitForTimeout(wait == null ? 600 : wait); },
    type: async (sel, text, delay) => { await ed.click(sel, 200); await edPage.keyboard.type(text, { delay: delay || 80 }); await edPage.waitForTimeout(400); }
  };
  await fn({ tv, ed, mark: () => { start = Date.now(); }, stop: () => { end = Date.now(); } });
  const tvV = tvPage.video(), edV = edPage.video();
  await edCtx.close(); await tvCtx.close();
  for (const [v, t0, suffix] of [[tvV, tvT0, 'tv'], [edV, edT0, 'ed']]) {
    const dst = path.join(RAW, name + '-' + suffix + '.webm');
    fs.renameSync(await v.path(), dst);
    fs.writeFileSync(dst + '.start', String(Math.max(0, start - t0) / 1000));
    fs.writeFileSync(dst + '.end', String(((end || Date.now()) - t0) / 1000));
  }
  console.log(`${name}: ${errs.length ? 'errors: ' + errs.join(' | ') : 'ok'}`);
}
