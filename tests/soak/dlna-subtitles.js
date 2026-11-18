/* Subtitles a DLNA server offers with its videos (Jellyfin's own res, minidlna's Samsung caption tag): kept with
   the file at the scan, listed for the episode (library/sidecar) and read through the helper (sidecar/get).
     npm run serve &
     node tests/soak/dlna-subtitles.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '../..');
const R = require(ROOT + '/scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
const proxy = require(ROOT + '/service/proxy.js');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fritz = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  if (req.method === 'GET' && /\.srt$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('1\n00:00:01,000 --> 00:00:03,000\nHello from the server\n'); }
  if (req.method === 'GET') { res.writeHead(404); return res.end(); }
  const id = (/<ObjectID>([^<]*)</.exec(b) || [])[1], H = '127.0.0.1:' + fritz.address().port;
  const item = (t) => `<item id="i${t}"><dc:title>${esc(t)}</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="500000000">http://${H}/V/${esc(t)}</res><res protocolInfo="http-get:*:text/srt:*">http://${H}/S/${esc(t)}.en.srt</res><sec:CaptionInfoEx sec:type="srt">http://${H}/C/${esc(t)}.srt</sec:CaptionInfoEx></item>`;
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
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47888, '127.0.0.1', f));
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(R.init({ time: Date.now() })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47888'));
  await page.goto(process.env.APP || 'http://127.0.0.1:8078/index.html'); await page.waitForFunction(() => window.Library && Library.count() > 0);
  await page.evaluate(c => Media._test.addServer({ name: 'Demo source', control: c }), 'http://127.0.0.1:' + fritz.address().port + '/ctl');
  await page.evaluate(() => Views.switchTab('media')); await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const s = MediaStore.sources()[0], sh = await Media.request('library/query', { kind: 'show' }, 30000);
    const eps = await Media.request('library/query', { kind: 'episode', show: sh.items[0].handle, limit: 10 }, 30000);
    const d = await Media.request('library/detail', { kind: 'episode', handle: eps.items[0].handle }, 30000);
    const sc = await Media.request('library/sidecar', { handle: d.versions[0].handle, source: s }, 30000);
    const got = sc.subs[0] ? await Media.request('sidecar/get', { source: s, path: sc.subs[0].path, lang: sc.subs[0].lang }, 30000) : null;
    const bad = await Media.request('sidecar/get', { source: s, path: 'http://example.com/x.srt' }, 30000);
    return { subs: sc.subs, text: got && got.text, bad: bad };
  });
  ok('the episode\'s subtitles from the server: its own res (English) and the caption tag', r.subs.length === 2 && r.subs[0].lang === 'en' && /\/S\//.test(r.subs[0].path) && /\/C\//.test(r.subs[1].path), JSON.stringify(r.subs));
  ok('read through the helper', /Hello from the server/.test(r.text || ''), r.text);
  ok('only from the server the source is', r.bad && r.bad.error === 'address', JSON.stringify(r.bad));
  ok('no page errors', !errors.length, errors.join(' | '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all DLNA subtitle checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
