// The /convert endpoint end to end, with the real ffmpeg on this computer (TIVIBRO_FFMPEG, default
// /usr/local/bin/ffmpeg): a 20 s H.264 + DTS 5.1 MKV converted to AC-3 through the helper, a seek, the
// player hanging up, one conversion at a time, the key, and the probe.  Skipped when there is no ffmpeg
// with a DTS encoder.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const FF = process.env.TIVIBRO_FFMPEG || '/usr/local/bin/ffmpeg';
const enc = (() => { try { return String(cp.execFileSync(FF, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { return ''; } })();
if (!/ dca /.test(enc) || !/ ac3 /.test(enc)) { console.log('SKIP no ffmpeg with dca and ac3 encoders at ' + FF); process.exit(0); }
const probeBin = (() => { try { cp.execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return 'ffprobe'; } catch (e) { return ''; } })();
process.env.TIVIBRO_FFMPEG = FF;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-convert-'));
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'store');
const MKV = path.join(tmp, 'dts51.mkv'), FLAC = path.join(tmp, 'flac71.mkv');
const vcodec = / libx264 /.test(enc) ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50'] : ['-c:v', 'mpeg4', '-g', '50'];
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
  '-filter_complex', '[1:a]pan=5.1(side)|FL=c0|FR=0.8*c0|FC=0.6*c0|LFE=0.3*c0|SL=0.5*c0|SR=0.4*c0[a]', '-map', '0:v', '-map', '[a]'].concat(vcodec, ['-c:a', 'dca', '-strict', '-2', '-b:a', '768k', '-metadata:s:a:0', 'language=eng', MKV]));
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=4', '-filter_complex', '[0:a]pan=7.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0|SL=c0|SR=c0[a]', '-map', '[a]', '-c:a', 'flac', FLAC]);
const files = { '/dts51.mkv': fs.readFileSync(MKV), '/flac71.mkv': fs.readFileSync(FLAC) };

// The "provider": Range-capable; /slow/ sends 32 KB every 100 ms, so a conversion takes a while.
const src = http.createServer((q, s) => {
  const slow = q.url.indexOf('/slow/') === 0, b = files[q.url.replace('/slow', '')];
  if (!b) { s.writeHead(404); return s.end(); }
  const r = /bytes=(\d+)-(\d*)/.exec(q.headers.range || ''), start = r ? +r[1] : 0, end = r && r[2] ? +r[2] : b.length - 1;
  s.writeHead(r ? 206 : 200, Object.assign({ 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }, r ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + b.length } : {}));
  if (!slow) return s.end(b.subarray(start, end + 1));
  let at = start;
  const t = setInterval(() => { if (at > end) { clearInterval(t); return s.end(); } s.write(b.subarray(at, Math.min(end + 1, at + 32768))); at += 32768; }, 100);
  s.on('close', () => clearInterval(t));
});

const proxy = require('../../service/proxy.js'), Convert = require('../../service/convert.js');
const relay = proxy.create({ ctl: 'secret' });
const alive = (pid) => { try { process.kill(pid, 0); return !/^Z/.test((fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ')[1] || '')); } catch (e) { return false; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; }
function ffprobe(file, args) { return String(cp.execFileSync(probeBin, ['-v', 'error'].concat(args, [file]))).trim(); }

src.listen(0, '127.0.0.1', () => relay.server.listen(0, '127.0.0.1', async () => {
  const H = 'http://127.0.0.1:' + relay.server.address().port, P = 'http://127.0.0.1:' + src.address().port;
  const ctl = { headers: { 'X-TiviBro-Ctl': 'secret' } };
  try {
    let r = await fetch(H + '/convert/key');
    ok('the key needs TiviBro\'s secret', r.status === 403);
    r = await fetch(H + '/ffmpeg/status');
    ok('the converter routes need it too', r.status === 403);
    const key = (await (await fetch(H + '/convert/key', ctl)).json()).key;
    ok('key: 32 hex characters', /^[a-f0-9]{32}$/.test(key), key);
    const st = await (await fetch(H + '/ffmpeg/status', ctl)).json();
    ok('status: ready, from TIVIBRO_FFMPEG', st.state === 'ready' && st.where === 'set by TIVIBRO_FFMPEG' && st.size > 0, st);

    // Probe
    const u = P + '/dts51.mkv';
    const pr = await (await fetch(H + '/convert/probe?u=' + encodeURIComponent(u), ctl)).json();
    ok('probe: DTS 5.1, English, default, 20 s, video', pr.audio && pr.audio.length === 1 && pr.audio[0].codec === 'dts' && pr.audio[0].channels === 6 && pr.audio[0].lang === 'eng' && pr.audio[0].def && Math.abs(pr.duration - 20) < 0.5 && !!pr.video, pr);
    r = await fetch(H + '/convert/probe?u=' + encodeURIComponent(P + '/missing.mkv'), ctl);
    ok('probe of a missing file: an error, not a crash', r.status === 502, r.status);

    // Wrong key, bad links, byte seeks
    r = await fetch(H + '/convert/' + 'b'.repeat(32) + '/movie.mkv?u=' + encodeURIComponent(u));
    ok('a wrong key: 403', r.status === 403);
    r = await fetch(H + '/convert/' + key + '/movie.mkv?u=' + encodeURIComponent('file:///etc/passwd'));
    ok('not a web address: 400', r.status === 400);
    r = await fetch(H + '/convert/' + key + '/movie.mkv?u=' + encodeURIComponent(u), { headers: { Range: 'bytes=1000-' } });
    ok('a byte seek: 416 (a seek is a new conversion with t=)', r.status === 416);

    // The whole movie
    const link = (t, extra) => H + '/convert/' + key + '/movie.mkv?u=' + encodeURIComponent(u) + '&t=' + t + '&a=0' + (extra || '');
    r = await fetch(link(0));
    ok('answers 200, MKV, no length, not byte-seekable', r.status === 200 && /matroska/.test(r.headers.get('content-type')) && !r.headers.get('content-length') && r.headers.get('accept-ranges') === 'none');
    let out = path.join(tmp, 'out0.mkv');
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    if (probeBin) {
      const a = ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0']);
      ok('output audio: AC-3, 6 channels', a === 'ac3,6', a);
      const v = ffprobe(out, ['-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0']), v0 = ffprobe(MKV, ['-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0']);
      ok('video copied as it was', v === v0, v);
      const lastA = +ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0']).split('\n').pop();
      ok('the whole 20 s', lastA > 19 && lastA < 20.5, lastA);
    }
    await wait(300);
    ok('the log says what was converted', proxy.LOG.some((x) => x.event === 'convert start' && x.from === 'dts 6ch' && /^ac3 640k/.test(x.to)) && proxy.LOG.some((x) => x.event === 'convert done'),
      proxy.LOG.filter((x) => /convert/.test(x.event || '')).slice(-3));

    // Seek: t=10 starts near 10 s (movie times kept)
    r = await fetch(link(10));
    out = path.join(tmp, 'out10.mkv');
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    if (probeBin) {
      const firstV = +ffprobe(out, ['-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'csv=p=0']).split('\n')[0];
      const firstA = +ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'csv=p=0']).split('\n')[0];
      ok('seek to 10 s: video starts at the keyframe before it (8 to 10 s)', firstV >= 7.9 && firstV <= 10.1, firstV);
      ok('seek to 10 s: sound starts at 10 s', Math.abs(firstA - 10) < 0.2, firstA);
      const a = ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0']);
      ok('seek: still AC-3', a === 'ac3', a);
    }

    // The player hangs up: ffmpeg is stopped, nothing left running.
    const slowLink = H + '/convert/' + key + '/movie.mkv?u=' + encodeURIComponent(P + '/slow/dts51.mkv') + '&t=0&a=0&c=dts&ch=6';
    const open = (url) => new Promise((resolve) => { const q = http.get(url, (res) => { res.once('data', () => resolve({ q, res })); }); q.on('error', () => {}); });
    let c1 = await open(slowLink);
    const pid1 = Convert.busy() && Convert.busy().pid;
    ok('converting: a process is running', pid1 > 0 && alive(pid1), pid1);
    c1.q.destroy();
    ok('player hung up: ffmpeg stopped within 3 s', await until(() => !alive(pid1), 3000), pid1);
    ok('...and nothing is converting', Convert.busy() === null);

    // One at a time: a second conversion replaces the first.
    c1 = await open(slowLink);
    const pidA = Convert.busy().pid;
    let ended = false; c1.res.on('end', () => { ended = true; }); c1.res.on('close', () => { ended = true; }); c1.res.resume();
    const c2 = await open(slowLink);
    const pidB = Convert.busy().pid;
    ok('second conversion: a new process', pidB > 0 && pidB !== pidA, [pidA, pidB]);
    ok('the first one is stopped', await until(() => !alive(pidA), 3000), pidA);
    ok('the first player\'s stream ended', await until(() => ended, 3000));
    ok('the second keeps going', alive(pidB));
    c2.q.destroy();
    ok('and stops when its player hangs up', await until(() => !alive(pidB), 3000));

    // &in=pipe: the helper reads the movie itself and feeds ffmpeg.
    r = await fetch(link(0, '&in=pipe'));
    out = path.join(tmp, 'pipe.mkv');
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    if (probeBin) { const a = ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0']); ok('in=pipe: AC-3 5.1 too', a === 'ac3,6', a); }

    // FLAC 7.1 (no video): mixed down to AC-3 5.1; MPEG-TS out for a live channel.
    const fu = P + '/flac71.mkv';
    await fetch(H + '/convert/probe?u=' + encodeURIComponent(fu), ctl);
    r = await fetch(H + '/convert/' + key + '/movie.ts?u=' + encodeURIComponent(fu) + '&t=0&a=0');
    ok('MPEG-TS answers as video/mp2t', r.headers.get('content-type') === 'video/mp2t');
    out = path.join(tmp, 'flac.ts');
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    if (probeBin) { const a = ffprobe(out, ['-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0']).split('\n')[0]; ok('FLAC 7.1: AC-3 5.1 in MPEG-TS', a === 'ac3,6', a); }

    await wait(300);
    const left = cp.execSync('ps -eo pid,args').toString().split('\n').filter((l) => l.indexOf(tmp) < 0 && /ffmpeg .*-f (matroska|mpegts) /.test(l) && l.indexOf(String(src.address().port)) >= 0);
    ok('no ffmpeg left running', left.length === 0, left);
  } catch (e) { ok('no exception', false, e.stack); }
  relay.server.close(); src.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' failed' : 'all passed');
  process.exit(fail ? 1 : 0);
}));
