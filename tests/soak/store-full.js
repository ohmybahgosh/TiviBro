/* A full TV (issue #18): when a save runs out of storage, the other playlists' cached lists and the logo
   cache are freed and the save tried again; the active playlist's caches stay.
     node tests/soak/store-full.js      (mock provider on :8077, relay_dev on :47811, npm run serve) */
'use strict';
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47811'));
  await p.goto('http://127.0.0.1:8078/index.html');
  await p.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 }).catch(()=>{});
  const r = await p.evaluate(async () => {
    await Store.idbSet('vod:otherpl:movie', { big: 1 }); await Store.idbSet('logos:x', { a: 1 });
    await Store.idbSet('vod:' + Store.settings.active + ':keepme', { a: 1 });
    const put = IDBObjectStore.prototype.put; let once = true;
    IDBObjectStore.prototype.put = function (v, k) {
      if (once && k === 'test:quota') { once = false; const tx = this.transaction; Object.defineProperty(tx, 'error', { get: () => ({ name: 'QuotaExceededError' }) }); const q = put.call(this, v, k); tx.abort(); return q; }
      return put.call(this, v, k);
    };
    const ok = await Store.idbSet('test:quota', { v: 1 });
    return { ok, saved: !!(await Store.idbGet('test:quota')), other: !!(await Store.idbGet('vod:otherpl:movie')), logos: !!(await Store.idbGet('logos:x')), mine: !!(await Store.idbGet('vod:' + Store.settings.active + ':keepme')) };
  });
  let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(r))); if (!c) fails++; };
  ok('a save that runs out of storage is tried again and kept', r.ok && r.saved);
  ok('after freeing other playlists\' lists and the logo cache', !r.other && !r.logos);
  ok('the active playlist\'s caches stay', r.mine);
  ok('no page errors', !errs.length);
  await b.close();
  console.log(fails ? fails + ' failures' : 'all full-storage checks passed'); process.exit(fails ? 1 : 0);
})();
