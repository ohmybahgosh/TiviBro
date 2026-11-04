/* Memory while My media looks up details for a big library (1,600 movies from a DLNA server, details from a
   stand-in TMDB).  On a C2, a 1,600-movie Dropbox library grew TiviBro by about 3 MB a second until webOS
   closed it at 950 MB: every movie's details saved the whole library, and Chromium kept a copy of each
   1 MB upload.  Now saves are batched and big uploads go as Blobs.  The check: the page's process grows
   by less than 60 MB in 90 seconds of lookups (it grew by about 300 MB before).
     MOCK_PORT=8088 MOCK_EVENTS=1 node tests/mock/mock_provider.js &
     npm run serve &
     node tests/soak/media-memory.js */
'use strict';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const R = require('../../scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-exp-'));
const proxy = require('../../service/proxy.js');
const MOCK = 'http://127.0.0.1:8088';
const N = +process.env.N || 1600, SECS = +process.env.SECS || 90;
const samples = [];
const poster = Buffer.alloc(200000, 7);   // any bytes: the posters are not drawn here
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let imgHits = 0;
const fritz = http.createServer((req, res) => {
  if (req.method === 'GET') { if (/^\/img\//.test(req.url)) { imgHits++; res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(poster); } res.writeHead(404); return res.end(); }
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], start = +((/<StartingIndex>(\d+)</.exec(b) || [])[1] || 0), cnt = +((/<RequestedCount>(\d+)</.exec(b) || [])[1] || 500), H = '127.0.0.1:' + fritz.address().port;
    let items = [];
    if (id === '0') items = Array.from({ length: N }, (_, i) => `<item id="i${i}"><dc:title>Film Number ${i} (${1950 + i % 70}).mkv</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="5000000000">http://${H}/v/${i}.mkv</res></item>`);
    const page = items.slice(start, start + cnt);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + page.join('') + '</DIDL-Lite>')}</Result><NumberReturned>${page.length}</NumberReturned><TotalMatches>${items.length}</TotalMatches></Envelope>`);
  });
});
(async () => {
  await new Promise(f => fritz.listen(0, '127.0.0.1', f));
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47897, '127.0.0.1', f));
  const H = 'http://127.0.0.1:' + fritz.address().port;
  const b = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  let n = 0;
  await page.route('**/media/metadata', route => {
    const q = route.request().postDataJSON();
    if (q.check) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    if (q.guide) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ miss: true }) });
    n++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ metadata: { provider: 'TMDB', id: 'tmdb:' + n, title: q.title || 'X', year: q.year || '2000', language: 'en', requestedLanguage: 'en', fallbackFields: [], plot: 'A plot. '.repeat(40), genre: 'Drama', cast: 'A, B, C, D', director: 'Z', runtime: 120, poster: H + '/img/p' + n + '.jpg', backdrop: H + '/img/b' + n + '.jpg' } }) });
  });
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47897'));
  await page.goto('http://127.0.0.1:8078/index.html');
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  const rss = () => { const cp = require('child_process'); try { return cp.execSync("ps -eo rss,args | grep -- '--type=renderer' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'").toString().trim(); } catch (e) { return '?'; } };
  const mem = async () => { await ev(() => { if (window.gc) window.gc(); }); const m = (await cdp.send('Performance.getMetrics')).metrics; const g = k => (m.find(x => x.name === k) || {}).value || 0; return { heapMB: Math.round(g('JSHeapUsedSize') / 1048576), totalMB: Math.round(g('JSHeapTotalSize') / 1048576), nodes: g('Nodes'), docs: g('Documents') }; };
  await ev(c => Media._test.addServer({ name: 'Big', control: c }), H + '/ctl');
  await ev(() => Views.switchTab('media'));
  await page.waitForFunction(n => MediaStore.movies(null).length >= n, N, { timeout: 120000 }).catch(() => {});
    await ev(() => MediaStore.setTmdbToken('mock-user-token-123456789012345'));
  await ev(() => Media.refresh && Media.refresh());
  const t0 = Date.now();
  // Kick the automatic lookup as after a scan.
  await ev(() => { if (Media.autoSoon) Media.autoSoon(10); else if (Media._test.autoDetails) Media._test.autoDetails(); });
  for (let s = 0; s <= SECS; s += 10) {
    const m = await mem();
    const r = +rss(); samples.push({ t: Math.round((Date.now() - t0) / 1000), r, n });
    console.log(`t=${Math.round((Date.now() - t0) / 1000)}s details=${n} renderer=${r} MB heap=${m.heapMB} MB`);
    await page.waitForTimeout(10000);
  }
  const first = samples[1] || samples[0], last = samples[samples.length - 1];
  ok('the library is in (' + N + ' movies)', (await ev(() => MediaStore.movies(null).length)) === N);
  ok('details kept arriving (' + last.n + ')', last.n > SECS * 2, last.n);
  ok('memory stays put while details arrive: ' + (last.r - first.r) + ' MB more in ' + (last.t - first.t) + ' s', last.r - first.r < 60, JSON.stringify(samples));
  await ev(() => MediaStore.flush());
  await b.close(); fritz.close(); relay.server.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
