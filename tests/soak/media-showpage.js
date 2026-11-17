/* My media's show page (media-showpage.js), in the real app with the real helper and a tiny DLNA server with
   one show of two seasons: OK on the show opens its seasons as posters, OK on a season its episodes as cards,
   Back goes to the seasons and then closes; and the TV shows tab's Recently added episodes knows the show.
     npm run serve &
     node tests/soak/media-showpage.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '../..');
const R = require(ROOT + '/scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
const proxy = require(ROOT + '/service/proxy.js');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fritz = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  if (req.method === 'GET') { res.writeHead(404); return res.end(); }
  const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], H = '127.0.0.1:' + fritz.address().port;
  const item = (t) => `<item id="i${t}"><dc:title>${esc(t)}</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="500000000">http://${H}/V/${esc(t)}</res></item>`;
  const dir = (t, c) => `<container id="${c}"><dc:title>${esc(t)}</dc:title></container>`;
  const tree = { 0: dir('Videos', 'v'), v: dir('Harbour', 'show'), show: dir('Season 1', 's1') + dir('Season 2', 's2'), s1: item('Harbour.S01E01.mkv') + item('Harbour.S01E02.mkv'), s2: item('Harbour.S02E01.mkv') + item('Harbour.S02E02.mkv') + item('Harbour.S02E03.mkv') };
  const didl = tree[id] || '', n = (didl.match(/<(item|container) /g) || []).length;
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + didl + '</DIDL-Lite>')}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches></Envelope>`);
}); });
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
(async () => {
  await new Promise(f => fritz.listen(0, '127.0.0.1', f));
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47886, '127.0.0.1', f));
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47886'));
  await page.goto(process.env.APP || 'http://127.0.0.1:8078/index.html'); await page.waitForFunction(() => window.Library && Library.count() > 0);
  await page.evaluate(c => Media._test.addServer({ name: 'Demo source', control: c }), 'http://127.0.0.1:' + fritz.address().port + '/ctl');
  await page.evaluate(() => Views.switchTab('media')); await page.waitForTimeout(2500);
  const shows = await page.evaluate(() => Media.request('library/query', { kind: 'show' }, 30000));
  ok('the show is in the library', shows.total === 1, JSON.stringify(shows).slice(0, 200));
  await page.evaluate((h) => Media.playFile({ kind: 'show', handle: h, id: h, title: 'Harbour' }), shows.items[0].handle);
  await page.waitForTimeout(1500);
  let t = (await page.innerText('#mediaShow')).replace(/\s+/g, ' ');
  ok('OK on a show opens its page with the seasons as posters', /Harbour/.test(t) && /2 seasons/.test(t) && /Season 1 2 episodes/.test(t) && /Season 2 3 episodes/.test(t) && (await page.locator('#mediaShow .mshp-season').count()) === 2, t);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  t = (await page.innerText('#mediaShow')).replace(/\s+/g, ' ');
  ok('Right and OK: season 2 with its three episodes as cards', /Season 2/.test(t) && (await page.locator('#mediaShow .shp-card').count()) === 3 && /1 of 3/.test(t), t);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  ok('Back: the seasons again', (await page.locator('#mediaShow .mshp-season').count()) === 2);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  ok('Back again closes it', await page.evaluate(() => !MediaShowPage.isOpen() && !document.getElementById('viewMedia').classList.contains('mshp-on')));
  const nw = await page.evaluate(() => Media.request('library/query', { kind: 'show', sort: 'new' }, 30000));
  ok('Recently added episodes: the show, with its newest episode', nw.total === 1 && /^S\dE\d$/.test(nw.items[0].newEp || ''), JSON.stringify(nw.items[0] || {}).slice(0, 200));
  ok('no page errors', !errors.length, errors.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all show page checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
