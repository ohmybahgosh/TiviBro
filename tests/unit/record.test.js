/* Recording to a USB drive (service/record.js): MPEG-TS bytes as they come (a dropped connection carries on in the
   same file), HLS followed piece by piece, files split at the size limit, scheduled ones started by the clock,
   stop, delete, the file served with Range, and no drive: refused. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-rec-'));
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_REC_PART_MAX = String(40 * 1024);
process.env.TIVIBRO_REC_RETRY_MS = '200';
process.env.TIVIBRO_REC_TICK_MS = '200';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
const R = require('../../service/record');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
const ALLOW = {};
function call(method, url, body, headers) {
  return new Promise((resolve) => {
    const req = { method, url, headers: headers || {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); } };
    let code = 0, hdr = {}, chunks = [];
    const res = { writeHead(c, h) { code = c; hdr = h || {}; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true; }, end(c) { if (c) chunks.push(Buffer.from(c)); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, hdr, body: b, j }); },
      on() {}, once() {}, emit() {}, removeListener() {} };
    R.handle(req, res, ALLOW, () => {});
  });
}

(async () => {
  // A provider: /ts streams 188-byte packets and hangs up once after 300 ms; /live.m3u8 is a sliding HLS window.
  let tsHangups = 0, seq = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      const pkt = Buffer.alloc(188 * 4, 0x47);           // ~75 KB/s: past the 40 KB part size even on a slow CI runner
      const iv = setInterval(() => res.write(pkt), 10);
      const first = tsHangups === 0;
      setTimeout(() => { if (first) { tsHangups++; clearInterval(iv); res.destroy(); } }, 300);
      req.on('close', () => clearInterval(iv));
      return;
    }
    if (req.url === '/master.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nlive.m3u8\n'); }
    if (req.url === '/live.m3u8') {
      seq++;
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:' + seq + '\n#EXTINF:1,\nseg' + seq + '.ts\n#EXTINF:1,\nseg' + (seq + 1) + '.ts\n');
    }
    if (req.url === '/low.m3u8') { res.writeHead(500); return res.end(); }
    const m = /^\/seg(\d+)\.ts$/.exec(req.url);
    if (m) { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end('[' + m[1] + ']'); }
    if (req.url === '/enc.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:1,\na.ts\n'); }
    res.writeHead(404); res.end();
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const base = 'http://127.0.0.1:' + srv.address().port;

  // No drive yet: refused, with a code the app can explain.
  let r = await call('POST', '/record/start', { url: base + '/ts', title: 'X', end: Date.now() + 5000 });
  ok('no USB drive: refused with code nodrive', r.code === 409 && r.j.code === 'nodrive', r.code);
  r = await call('POST', '/record/start', { url: 'http://example.com/ts', title: 'X', end: Date.now() + 5000 });
  ok('only the relay\'s addresses are recorded', r.code === 400);

  const drive = path.join(tmp, 'usb', 'sda', 'sda'); fs.mkdirSync(drive, { recursive: true });
  r = await call('GET', '/record/drives');
  ok('a drive webOS mounted is found', r.j.drives.length === 1 && r.j.drives[0].dir === drive, JSON.stringify(r.j));

  // MPEG-TS, with a hang-up in the middle: one file that carries on, split at the size limit.
  R.start({ log: () => {} });
  r = await call('POST', '/record/start', { url: base + '/ts', title: 'Hockey: Night?', channel: 'CBC', end: Date.now() + 2500 });
  const tsId = r.j.id;
  ok('recording starts at once', r.code === 200 && r.j.status === 'recording', JSON.stringify(r.j));
  await wait(3200);
  r = await call('GET', '/record/list');
  let rec = r.j.recs.filter((x) => x.id === tsId)[0];
  ok('it ends at its end time, done', rec.status === 'done', JSON.stringify(rec));
  ok('the dropped connection was a gap, not the end', rec.gaps >= 1 && rec.bytes > 40 * 1024, rec.gaps + ' gaps, ' + rec.bytes + ' bytes');
  ok('split into parts at the size limit', rec.parts >= 2, rec.parts);
  const showDir = path.join(drive, 'TiviBro Recordings', 'TV', 'Hockey Night');
  const files = fs.existsSync(showDir) ? fs.readdirSync(showDir) : [];
  ok('once done, in "TiviBro Recordings/TV/<show>", named as Plex reads them (date-based, " - pt1", " - pt2"), without characters a drive refuses',
    files.some((f) => /^Hockey Night - \d{4}-\d\d-\d\d \d\d\.\d\d - pt1\.ts$/.test(f)) && files.some((f) => / - pt2\.ts$/.test(f)), files.join(' | '));
  const nf = files.filter((f) => /\.nfo$/.test(f))[0];
  const nfoTxt = nf ? fs.readFileSync(path.join(showDir, nf), 'utf8') : '';
  ok('a .nfo beside it: episode details with the show and channel', /<episodedetails>/.test(nfoTxt) && /<showtitle>Hockey: Night\?<\/showtitle>/.test(nfoTxt) && /<studio>CBC<\/studio>/.test(nfoTxt), nfoTxt.slice(0, 300));
  ok('nothing left in the top folder but the TV folder', fs.readdirSync(path.join(drive, 'TiviBro Recordings')).every((f) => f === 'TV'), fs.readdirSync(path.join(drive, 'TiviBro Recordings')).join(' | '));
  // The file, with Range.
  r = await call('GET', '/record/file/' + tsId, null, { range: 'bytes=0-187' });
  ok('the file is served with Range', r.code === 206 && r.body.length === 188 && /^bytes 0-187\//.test(r.hdr['Content-Range']), r.code + ' ' + r.body.length);
  r = await call('GET', '/record/file/' + tsId);
  ok('its parts are served end to end, as one recording', r.code === 200 && r.body.length === rec.bytes, r.body.length + ' of ' + rec.bytes);
  r = await call('GET', '/record/file/' + tsId, null, { range: 'bytes=' + (40 * 1024 - 10) + '-' + (40 * 1024 + 9) });
  ok('a range across two parts', r.code === 206 && r.body.length === 20, r.body.length);

  // HLS: the best quality of the master playlist, each piece once, in order.
  r = await call('POST', '/record/start', { url: base + '/master.m3u8', title: 'News', end: Date.now() + 2500 });
  const hlsId = r.j.id;
  await wait(3200);
  r = await call('GET', '/record/list');
  rec = r.j.recs.filter((x) => x.id === hlsId)[0];
  const newsDir = path.join(drive, 'TiviBro Recordings', 'TV', 'News');
  const hf = (fs.existsSync(newsDir) ? fs.readdirSync(newsDir) : []).filter((f) => /^News - .*\.ts$/.test(f))[0];
  const txt = hf ? fs.readFileSync(path.join(newsDir, hf), 'utf8') : '';
  const nums = (txt.match(/\[(\d+)\]/g) || []).map((x) => +x.slice(1, -1));
  ok('HLS: pieces in order, none twice', nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), txt);
  ok('HLS: done, as .ts', rec.status === 'done' && rec.kind === 'ts' && /\.ts$/.test(hf), JSON.stringify(rec));

  // Encrypted HLS: refused, said why.
  r = await call('POST', '/record/start', { url: base + '/enc.m3u8', title: 'Enc', end: Date.now() + 2000 });
  await wait(600);
  rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === r.j.id)[0];
  ok('encrypted HLS: failed, saying so', rec.status === 'failed' && /encrypted/.test(rec.error), JSON.stringify(rec));

  // Scheduled: starts by the clock; stop ends it; a scheduled one stopped is cancelled.
  r = await call('POST', '/record/schedule', { url: base + '/ts', title: 'Later', start: Date.now() + 400, end: Date.now() + 60000 });
  const sId = r.j.id;
  ok('scheduled: waits', r.j.status === 'scheduled');
  await wait(1000);
  rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === sId)[0];
  ok('scheduled: started by the clock', rec.status === 'recording', JSON.stringify(rec));
  r = await call('POST', '/record/stop', { id: sId });
  ok('stop ends it, kept', r.j.status === 'done', JSON.stringify(r.j));
  r = await call('POST', '/record/schedule', { url: base + '/ts', title: 'Never', start: Date.now() + 60000, end: Date.now() + 120000 });
  r = await call('POST', '/record/stop', { id: r.j.id });
  ok('a scheduled one stopped is cancelled', r.j.status === 'cancelled');

  // HLS first, the other format when it never starts (a 404, or a .m3u8 that's really a stream).
  r = await call('POST', '/record/start', { url: base + '/missing.m3u8', alt: base + '/ts', title: 'Swap', end: Date.now() + 1500 });
  await wait(2200);
  rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === r.j.id)[0];
  ok('HLS missing: recorded from the other format', rec.status === 'done' && rec.bytes > 0 && rec.kind === 'ts', JSON.stringify(rec));
  ok('its length is known', rec.dur >= 1 && rec.dur <= 3, rec.dur);
  r = (await call('GET', '/record/list')).j;
  ok('the list says the drive and its room', r.drive && r.drive.name === 'sda' && typeof r.drive.freeMB === 'number', JSON.stringify(r.drive));

  // The guide's description and episode, and what TMDB knows (only https pictures, sizes capped).
  r = await call('POST', '/record/schedule', { url: base + '/ts', title: 'Cunk on Earth', desc: 'Philomena Cunk asks big questions.', ep: 'S1 E2', start: Date.now() + 60000, end: Date.now() + 120000 });
  const mid = r.j.id;
  ok('description and episode kept', r.j.desc === 'Philomena Cunk asks big questions.' && r.j.ep === 'S1 E2', JSON.stringify(r.j));
  r = await call('POST', '/record/meta', { id: mid, meta: { title: 'Cunk on Earth', year: 2022, poster: 'https://image.tmdb.org/p.jpg', backdrop: 'javascript:alert(1)', plot: 'x'.repeat(5000), rating: 8.1 } });
  ok('TMDB details kept with it: https pictures only, the plot capped', r.j.meta && r.j.meta.poster === 'https://image.tmdb.org/p.jpg' && !r.j.meta.backdrop && r.j.meta.plot.length === 1200 && r.j.meta.year === '2022', JSON.stringify(r.j.meta).slice(0, 200));
  r = await call('POST', '/record/meta', { id: mid, meta: { miss: true } });
  ok('a miss is kept (not asked again)', r.j.meta && r.j.meta.miss === true);
  await call('POST', '/record/stop', { id: mid });

  // Delete: the files too.
  r = await call('POST', '/record/delete', { id: tsId });
  ok('delete removes it, its files and its now empty show folder', r.j.ok && !fs.existsSync(showDir) && fs.existsSync(newsDir) && !(await call('GET', '/record/list')).j.recs.some((x) => x.id === tsId), fs.readdirSync(path.join(drive, 'TiviBro Recordings', 'TV')).join(' | '));

  // Kept across a helper restart: recording ones carry on when their time isn't over.
  await wait(500);
  const saved = JSON.parse(fs.readFileSync(process.env.TIVIBRO_REC_LIST, 'utf8'));
  ok('the list is kept on storage', saved.recs.length >= 4, saved.recs.length);
  ok('file names: no characters FAT refuses', !/[:?"<>|*]/.test(R._nameFor({ title: 'A: B? "C" <D>|*', startedAt: Date.now() }, 'ts', 1)));

  // Load a subtitle file from a USB drive: its folders and subtitle files, one read, nothing outside the drive.
  const drv = path.join(process.env.TIVIBRO_USB_DIR, 'sda', 'sda1');
  fs.mkdirSync(path.join(drv, 'Subs'), { recursive: true });
  fs.writeFileSync(path.join(drv, 'Subs', 'Movie.en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9\n', 'latin1');
  fs.writeFileSync(path.join(drv, 'Subs', 'Movie.mkv'), 'x');
  let sb = await call('POST', '/record/subs/browse', { path: '' });
  ok('subtitles: the drives first', sb.j && sb.j.entries && sb.j.entries.some((x) => x.path === drv), JSON.stringify(sb.j));
  sb = await call('POST', '/record/subs/browse', { path: path.join(drv, 'Subs') });
  ok('subtitles: a folder\'s subtitle files, not its videos', sb.j && sb.j.entries.map((x) => x.name).join() === 'Movie.en.srt', JSON.stringify(sb.j));
  sb = await call('POST', '/record/subs/get', { path: path.join(drv, 'Subs', 'Movie.en.srt'), lang: 'en' });
  ok('subtitles: a file read, its codepage worked out', sb.j && /Café/.test(sb.j.text || ''), JSON.stringify(sb.j));
  sb = await call('POST', '/record/subs/get', { path: '/etc/passwd' });
  ok('subtitles: nothing outside a drive', sb.code === 400, sb.code);
  R._reset(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fail) { console.log(fail + ' recording test(s) failed'); process.exit(1); }
  console.log('all recording tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
