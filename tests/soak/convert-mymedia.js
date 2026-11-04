/* My media movies whose only sound is DTS, on a pretend 2022 TV (no DTS), from a DLNA server:
   the audio converter is offered before the movie starts when its name says DTS, even after an earlier
   offer; offered as it starts when only the file's own tracks say so (mkvsubs.js reads them); and with
   the converter there, the movie carries on through it.
     MOCK_PORT=8088 node tests/mock/mock_provider.js &
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg npm run serve &
     TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg node tests/soak/convert-mymedia.js */
'use strict';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : '')); if (!c) fails++; };
const { chromium } = require('playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const R = require('../../scripts/demo/record.js');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'media-exp-'));
const proxy = require('../../service/proxy.js');
const MOCK = 'http://127.0.0.1:8088';
let NAME = 'TiviBro DTS test (2026)';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MKV = path.join(process.env.TIVIBRO_KV_DIR, 'dts.mkv');
cp.execFileSync(process.env.TIVIBRO_FFMPEG || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=25:duration=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=10','-filter_complex','[1:a]pan=5.1(side)|FL=c0|FR=c0|FC=c0|LFE=c0|SL=c0|SR=c0[a]','-map','0:v','-map','[a]','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','dca','-strict','-2','-b:a','768k',MKV]);
const file = fs.readFileSync(MKV);
let control = '';
const fritz = http.createServer((req, res) => {
  if (req.method === 'GET') { const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''), a = r ? +r[1] : 0, b = r && r[2] ? Math.min(+r[2], file.length - 1) : file.length - 1;
    res.writeHead(r ? 206 : 200, Object.assign({ 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 }, r ? { 'Content-Range': 'bytes ' + a + '-' + b + '/' + file.length } : {})); return res.end(file.subarray(a, b + 1)); }
  let bd = ''; req.on('data', d => bd += d); req.on('end', () => {
    const id = (/<ObjectID>([^<]*)</.exec(bd) || [])[1], H = '127.0.0.1:' + fritz.address().port;
    const didl = id === '0' ? `<item id="x"><upnp:class>object.item.videoItem</upnp:class><dc:title>${esc(NAME)}.mkv</dc:title><res protocolInfo="http-get:*:video/x-matroska:*" size="198145263">http://${H}/r/${encodeURIComponent(NAME)}.mkv</res></item>` : '';
    const n = (didl.match(/<item /g) || []).length;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<Envelope><Result>${esc('<DIDL-Lite>' + didl + '</DIDL-Lite>')}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches></Envelope>`);
  });
});
async function run(o) {
  NAME = o.name;
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (process.env.DEBUG) page.on('console', m => { if (/player|convert/i.test(m.text())) console.log('  console:', m.text().slice(0, 220)); });
  const pl = Object.assign({}, R.SETTINGS.playlists[0], { server: MOCK });
  await page.addInitScript(R.init({ time: Date.now(), settings: { playlists: [pl] } })[0]);
  await page.addInitScript(() => localStorage.setItem('tivibro.devRelay', '47897'));
  await page.goto('http://127.0.0.1:8078/index.html');
  await page.waitForFunction(() => window.Library && Library.count() > 0, null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  await ev((o) => { Caps._model('OLED65C2PUA'); Store.settings.convertAsked = !!o.asked; window.__n = []; Player.on('notice', m => __n.push(m));
    if (o.noConverter) { var p2 = Convert.plan, n = 0; Convert.plan = function () { return n++ ? p2.apply(this, arguments) : Promise.resolve(null); }; }
    if (o.noConverter && o.dismiss) Convert.offer = function (w, g, cb) { window.__offered = w; cb(false); }; }, o);
  await ev(c => Media._test.addServer({ name: 'DTS server', control: c }), control);
  await ev(() => Views.switchTab('media'));
  await page.waitForFunction(() => !!document.querySelector('.media-tile'), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await ev(() => Media.phone.play(MediaStore.movies(null)[0].id, true));
  await page.waitForFunction((o) => /\/convert\//.test(document.getElementById('video').getAttribute('src') || '') || __n.some(n => /can't play/.test(n)) || (!o.noConverter && /Sound this TV/.test((document.getElementById('modal') || {}).innerText || '')), o, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const r = await ev(() => ({ modal: (document.getElementById('modal') || {}).innerText || '', src: document.getElementById('video').getAttribute('src') || '', conv: Player.converting, notes: __n.slice(), offered: window.__offered || '' }));
  r.errs = errs;
  await b.close();
  return r;
}

(async () => {
  await new Promise(f => fritz.listen(0, '127.0.0.1', f));
  const relay = proxy.create({}); await new Promise(f => relay.server.listen(47897, '127.0.0.1', f));
  control = 'http://127.0.0.1:' + fritz.address().port + '/ctl';
  if (!process.env.TIVIBRO_FFMPEG) { ok('start with TIVIBRO_FFMPEG set (the converter)', false); process.exit(1); }
  try {
    // 1. The converter is there: a DTS movie plays through it from the start.
    let r = await run({ name: 'Plain movie (2026)' });
    ok('converter there: the movie plays through /convert', /\/convert\/[a-f0-9]{32}\/movie\.mkv\?/.test(r.src) && r.conv && r.conv.codec === 'dts', r);
    ok('...and says so', r.notes.indexOf('Converting DTS audio for this TV') >= 0, r.notes);
    // 2. No converter, the name says DTS, and it was offered before: offered again, before it starts.
    const ff = process.env.TIVIBRO_FFMPEG; delete process.env.TIVIBRO_FFMPEG;
    r = await run({ name: 'TiviBro DTS test (2026)', asked: true });
    process.env.TIVIBRO_FFMPEG = ff;
    ok('no converter, offered before: asked again', /Sound this TV can't play/.test(r.modal) && /Get/.test(r.modal) && /Don't ask again/.test(r.modal), r.modal);
    // 3. No converter at first (the plan finds nothing), only the file's tracks say DTS: offered as it
    //    starts, and with the converter it carries on through it.
    r = await run({ name: 'Plain movie (2026)', noConverter: true });
    ok('found while playing: carries on through the converter', /\/convert\//.test(r.src) && r.conv && r.conv.codec === 'dts', r);
    delete process.env.TIVIBRO_FFMPEG;
    r = await run({ name: 'Plain movie (2026)', noConverter: true, dismiss: true });
    process.env.TIVIBRO_FFMPEG = ff;
    ok('found while playing, Not now: offered, then says why there is no sound', r.offered === 'DTS' && r.notes.some(n => /DTS sound, which this TV can't play/.test(n)) && !r.conv, r);
    ok('no page errors', !r.errs.length, r.errs);
  } catch (e) { ok('no exception', false, e.stack); }
  fritz.close(); relay.server.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
