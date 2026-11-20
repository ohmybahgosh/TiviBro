/* Recordings for media servers (service/record.js, discussion #94): a finished one moves to TV/<show> or
   Movies/<title (year)> with a .nfo beside it, and Convert to MP4 joins its parts into one .mp4 with the details
   inside, which the Recordings screen still plays.  Needs a real ffmpeg (TIVIBRO_FFMPEG or one on the PATH): skipped
   without one. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
let ff = process.env.TIVIBRO_FFMPEG || '';
if (!ff) { try { ff = cp.execSync('command -v ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {} }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-reclib-'));
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_REC_PART_MAX = String(60 * 1024);
process.env.TIVIBRO_REC_RETRY_MS = '200';
process.env.TIVIBRO_REC_TICK_MS = '200';
process.env.TIVIBRO_REC_INUSE_MS = '1500';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
if (ff) process.env.TIVIBRO_FFMPEG = ff;
const R = require('../../service/record');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
function call(method, url, body, headers) {
  return new Promise((resolve) => {
    const req = { method, url, headers: headers || {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); } };
    let code = 0, hdr = {}, chunks = [], ls = {};
    const res = { writeHead(c, h) { code = c; hdr = h || {}; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true }, end(c) { if (c) chunks.push(Buffer.from(c)); (ls.finish || []).forEach((f) => f()); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, hdr, body: b, j }); },
      on(ev, f) { (ls[ev] = ls[ev] || []).push(f); return res; }, once() {}, emit() {}, removeListener() {} };
    R.handle(req, res, {}, () => {});
  });
}
// Names and folders, without a drive.
const lp = R._libPlace;
const d0 = new Date(2026, 10, 20, 21, 5).getTime();
ok('a show with the guide\'s episode: TV/<show>, "<show> - s01e02"', JSON.stringify(lp({ title: 'Cunk on Earth', ep: 'S1 E2', startedAt: d0 })) === JSON.stringify({ dir: ['TV', 'Cunk on Earth'], show: 'Cunk on Earth', base: 'Cunk on Earth - s01e02', ep: { s: 1, e: 2 } }), JSON.stringify(lp({ title: 'Cunk on Earth', ep: 'S1 E2', startedAt: d0 })));
ok('no episode number: Plex\'s date-based name', lp({ title: 'NHL: Wings at Leafs', startedAt: d0 }).base === 'NHL Wings at Leafs - 2026-11-20 21.05');
ok('TMDB says movie: Movies/<title (year)>', JSON.stringify(lp({ title: 'Heat', startedAt: d0, meta: { title: 'Heat', year: '1995' } })) === JSON.stringify({ dir: ['Movies', 'Heat (1995)'], base: 'Heat (1995)', movie: true }));
ok('TMDB says show: stays a show', !lp({ title: 'Bluey', startedAt: d0, meta: { title: 'Bluey', kind: 'show' } }).movie);
ok('MKV gets the poster inside, MP4 is marked hvc1 for HEVC', R._convArgs({ title: 'X', channel: 'C' }, 'o', true, '/p.jpg').join(' ').indexOf('-attach /p.jpg') > 0 && R._convArgs({ title: 'X', channel: 'C' }, 'o', false, '', true).join(' ').indexOf('-tag:v hvc1') > 0);

(async () => {
  if (!ff) { console.log('SKIP no ffmpeg: converting not tested'); return done(); }
  // A real 4-second MPEG-TS (H.264 and AAC), served at about its own pace, then held open.
  const src = path.join(tmp, 'src.ts');
  cp.execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mpegts', src]);
  const data = fs.readFileSync(src);
  let served = false;
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    if (served) return;                                    // asked again: nothing more (the channel holds)
    served = true;
    let at = 0; const iv = setInterval(() => { if (at >= data.length) return clearInterval(iv); res.write(data.slice(at, at += 188 * 100)); }, 20);
    req.on('close', () => clearInterval(iv));
  });
  await new Promise((f) => srv.listen(0, '127.0.0.1', f));
  const drive = path.join(tmp, 'usb', 'sda', 'sda'); fs.mkdirSync(drive, { recursive: true });
  R.start({ log: () => {} });
  let r = await call('POST', '/record/start', { url: 'http://127.0.0.1:' + srv.address().port + '/x.ts', title: 'Test Film', channel: 'Movies HD', desc: 'A test card.', end: Date.now() + 2500 });
  const id = r.j.id;
  await wait(3200);
  let rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === id)[0];
  ok('recorded in parts, filed under TV until TMDB says more', rec.status === 'done' && rec.parts >= 2 && rec.folder === 'TV/Test Film', JSON.stringify(rec));
  r = await call('POST', '/record/meta', { id, meta: { title: 'Test Film', year: 2001, plot: 'A film about test cards.', genre: 'Drama' } });
  const mdir = path.join(drive, 'TiviBro Recordings', 'Movies', 'Test Film (2001)');
  const mf = fs.existsSync(mdir) ? fs.readdirSync(mdir) : [];
  ok('TMDB says movie: moved to Movies/<title (year)>, parts as pt1, pt2, with a movie .nfo', mf.includes('Test Film (2001) - pt1.ts') && mf.includes('Test Film (2001) - pt2.ts') && /<movie>[\s\S]*<year>2001<\/year>/.test(fs.readFileSync(path.join(mdir, 'Test Film (2001).nfo'), 'utf8')), mf.join(' | '));
  ok('the old TV folder is gone', !fs.existsSync(path.join(drive, 'TiviBro Recordings', 'TV', 'Test Film')));
  r = await call('GET', '/record/file/' + id, null, { range: 'bytes=0-187' });
  ok('still plays after the move', r.code === 206 && r.body[0] === 0x47, r.code);

  // Watched while it converts: the new file waits until the player has stopped asking.
  const watching = setInterval(() => call('GET', '/record/file/' + id, null, { range: 'bytes=0-187' }), 300);
  r = await call('POST', '/record/convert', { id });
  const started = r;
  await wait(2500);
  rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === id)[0];
  ok('while it\'s watched, the old file stays (the swap waits)', rec.conv.running && rec.kind === 'ts', JSON.stringify(rec.conv));
  clearInterval(watching);
  r = started;
  ok('convert starts', r.code === 200 && r.j.conv && r.j.conv.running, JSON.stringify(r.j));
  for (let i = 0; i < 60; i++) { await wait(250); rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === id)[0]; if (!rec.conv.running) break; }
  ok('converted to MP4', rec.conv.done === 'mp4' && rec.kind === 'mp4' && rec.parts === 1, JSON.stringify(rec.conv));
  const after = fs.readdirSync(mdir).sort();
  ok('one .mp4 replaces the parts, the .nfo follows it', JSON.stringify(after) === JSON.stringify(['Test Film (2001).mp4', 'Test Film (2001).nfo']), after.join(' | '));
  const probe = cp.spawnSync(ff, ['-hide_banner', '-i', path.join(mdir, 'Test Film (2001).mp4')], { encoding: 'utf8' }).stderr;
  ok('the details are inside: title, plot, year, genre, marked a movie', /title\s*: Test Film/.test(probe) && /A film about test cards/.test(probe) && /date\s*: 2001/.test(probe) && /genre\s*: Drama/.test(probe), probe.slice(0, 900));
  ok('all of it: picture and sound, a few seconds', /Video: h264/.test(probe) && /Audio: aac/.test(probe) && /Duration: 00:00:0[1-4]/.test(probe), probe.slice(0, 900));
  r = await call('GET', '/record/file/' + id, null, { range: 'bytes=0-15' });
  ok('the player gets it as MP4', r.code === 206 && r.hdr['Content-Type'] === 'video/mp4' && r.body.slice(4, 8).toString() === 'ftyp', r.hdr['Content-Type']);
  r = await call('POST', '/record/convert', { id });
  ok('a second convert is refused', r.code === 409 && /already/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/delete', { id });
  ok('delete takes its folder too', r.j.ok && !fs.existsSync(mdir));
  srv.close();
  done();
})().catch((e) => { console.log('FAIL ' + (e && e.stack)); fail++; done(); });
function done() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} console.log(fail ? fail + ' recording library test(s) failed' : 'all recording library tests passed'); process.exit(fail ? 1 : 0); }
