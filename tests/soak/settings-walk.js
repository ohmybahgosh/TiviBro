/* Every settings page as the phone app and the web editor get it (Settings.phone), with Plex signed in (the stand-in
   Plex server): each page opens, each row has a name, each choice shows one of its choices, and only the rows that
   need the TV's own screen say so.
     MOCK_PORT=8088 node tests/mock/mock_provider.js &
     (cd app && python3 -m http.server 8078 --bind 127.0.0.1) &
     node tests/soak/settings-walk.js */
'use strict';
const { chromium } = require('playwright');
const R = require('../../scripts/demo/record.js');
const APP = process.env.APP || 'http://127.0.0.1:8078/index.html';
const path = require('path'), fs = require('fs'), os = require('os');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
const proxy = require('../../service/proxy.js');
const PlexHelper = require('../../service/plex.js');
const Mock = require('../mock/mock_plex.js');
(async () => {
  const m = await new Promise((f) => Mock.start(f));
  PlexHelper._test.loopback(true); PlexHelper._test.setPlexTv('http://127.0.0.1:' + m.port);
  const relay = proxy.create({}); await new Promise((f) => relay.server.listen(47897, '127.0.0.1', f));
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: 'http://127.0.0.1:8088' });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  const base = 'http://127.0.0.1:' + m.port;
  await page.addInitScript((o) => {
    localStorage.setItem('tivibro.devRelay', '47897');
    localStorage.setItem('tivibro.plex', JSON.stringify({ cid: 'tivibro-soak-0001', token: o.tok, user: { name: 'hometheater', pass: true, home: true },
      servers: [{ id: o.machine, name: 'Home server', owned: true, online: true, token: o.st, connections: [{ uri: o.base, address: '127.0.0.1', port: o.port, local: true, relay: false }] }],
      chosen: [o.machine], libs: { [o.machine]: ['1'] }, libInfo: [{ key: '1', title: 'Movies', type: 'movie', server: o.machine }] }));
  }, { tok: Mock.TOKEN, st: Mock.SERVER_TOKEN, machine: Mock.MACHINE, base, port: m.port });
  await page.goto(APP);
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async () => {
    const P = Settings.phone; await P.ready();
    const res = { secs: [], pages: 0, rows: 0, problems: [], tv: [], kinds: {}, looks: {} };
    const secs = P.sections();
    res.secs = secs.map((s) => s.id);
    const walk = (sec, path, depth, trail) => {
      let pg; try { pg = P.page(sec, path); } catch (e) { res.problems.push('page fails ' + sec + ' ' + JSON.stringify(path) + ' ' + e.message); return; }
      res.pages++;
      pg.rows.forEach((r) => {
        res.rows++; res.kinds[r.kind] = (res.kinds[r.kind] || 0) + 1; res.looks[r.look] = (res.looks[r.look] || 0) + 1;
        const where = trail + ' › ' + r.label;
        if (r.tv) res.tv.push(where);
        if (r.kind === 'choice' && (r.cur < 0 || !r.options.length)) res.problems.push('choice not set: ' + where + ' = ' + r.value);
        if (!r.label && r.kind !== 'head') res.problems.push('no label: ' + where + ' ' + r.kind);
        if (r.kind === 'page' && depth < 6) walk(sec, path.concat(r.i), depth + 1, where);
      });
    };
    secs.forEach((s) => walk(s.id, [], 0, s.title));
    return res;
  });
  let fails = 0;
  const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 400))); if (!c) fails++; };
  ok('every section is there (' + out.secs.length + ')', ['sports', 'plex', 'look', 'media', 'about'].every((x) => out.secs.indexOf(x) >= 0), out.secs);
  ok('every page opens and every row is whole (' + out.pages + ' pages, ' + out.rows + ' rows)', !out.problems.length && out.pages > 40, out.problems);
  const TV = ['Open it in a phone\'s browser (QR code)', 'Learn a button', 'Button tester', 'Edit on a computer', 'Preview'];
  ok('only the TV\'s own rows are marked for the TV', out.tv.length === TV.length && out.tv.every((x) => TV.some((t) => x.endsWith('› ' + t))), out.tv);
  ok('no page errors', !errs.length, errs);
  await b.close(); process.exit(fails ? 1 : 0);
})();
