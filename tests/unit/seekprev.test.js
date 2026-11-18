// Seek previews end to end (service/seekprev.js), with the real ffmpeg on this computer (TIVIBRO_FFMPEG, default
// /usr/local/bin/ffmpeg): a 60 s H.264 MKV with a keyframe every 2 s served with Range, a picture at 37 s through
// the helper (a JPEG of the asked width), the same again from memory, the key, a missing file (204), and the
// app's link reading (app/js/seekprev.js source()).  Skipped when there is no ffmpeg with an mjpeg encoder.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

// The app's side first: which link the pictures are made from.
const ctx = { Store: { settings: {} }, Net: { unwrap: (u) => { const m = /^http:\/\/127\.0\.0\.1:\d+\/x\/(https?)\/(.*)$/.exec(u); return m ? m[1] + '://' + m[2] : u; } }, U: {}, document: {}, Log: { info() {} } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/seekprev.js'), 'utf8') + ';this.SeekPrev = SeekPrev;', ctx);
const S = ctx.SeekPrev;
ok('a plain movie link is used as it is', S._source('https://cdn.example/movie/1.mkv') === 'https://cdn.example/movie/1.mkv');
ok('the relay gives back the link inside', S._source('http://127.0.0.1:47811/x/https/cdn.example/movie/1.mkv') === 'https://cdn.example/movie/1.mkv');
ok('the converter\'s stream gives its u=', S._source('http://127.0.0.1:47811/convert/' + 'a'.repeat(32) + '/movie.mkv?u=' + encodeURIComponent('https://cdn.example/a.mkv') + '&t=0') === 'https://cdn.example/a.mkv');
ok('HLS gets no pictures', S._source('https://cdn.example/a/index.m3u8') === '');
ok('setting: Automatic unless On or Off', S.setting() === 'auto');

const FF = process.env.TIVIBRO_FFMPEG || '/usr/local/bin/ffmpeg';
const enc = (() => { try { return String(cp.execFileSync(FF, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { return ''; } })();
if (!/ mjpeg /.test(enc)) { console.log('SKIP the service part: no ffmpeg with an mjpeg encoder at ' + FF); process.exit(fail ? 1 : 0); }
process.env.TIVIBRO_FFMPEG = FF;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-seekprev-'));
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'store');
const MKV = path.join(tmp, 'movie.mkv');
const vcodec = / libx264 /.test(enc) ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50'] : ['-c:v', 'mpeg4', '-g', '50'];
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=60'].concat(vcodec, [MKV]));
const file = fs.readFileSync(MKV);
let reads = 0;
const src = http.createServer((q, s) => {
  if (q.url !== '/movie.mkv') { s.writeHead(404); return s.end(); }
  const r = /bytes=(\d+)-(\d*)/.exec(q.headers.range || ''), start = r ? +r[1] : 0, end = r && r[2] ? +r[2] : file.length - 1;
  reads++;
  s.writeHead(r ? 206 : 200, Object.assign({ 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }, r ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + file.length } : {}));
  s.end(file.subarray(start, end + 1));
});
const proxy = require('../../service/proxy.js'), Convert = require('../../service/convert.js');
const relay = proxy.create({ ctl: 'secret' });
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(c) })); }).on('error', rej));
const dims = (buf) => { const f = path.join(tmp, 'p.jpg'); fs.writeFileSync(f, buf); try { return String(cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width', '-of', 'csv=p=0', f])).trim(); } catch (e) { return ''; } };

(async () => {
  await new Promise((r) => src.listen(0, '127.0.0.1', r));
  await new Promise((r) => relay.server.listen(0, '127.0.0.1', r));
  const hp = relay.server.address().port, sp = src.address().port, key = Convert.key, u = encodeURIComponent('http://127.0.0.1:' + sp + '/movie.mkv');
  const st = JSON.parse((await get(hp, '/preview/' + key + '/status')).body);
  ok('status: this ffmpeg can make pictures', st.ok === true, st);
  ok('a wrong key is turned away', (await get(hp, '/preview/' + 'b'.repeat(32) + '/frame.jpg?u=' + u + '&t=10')).status === 403);
  let t0 = Date.now(), r = await get(hp, '/preview/' + key + '/frame.jpg?u=' + u + '&t=37&w=320'), ms = Date.now() - t0;
  ok('a picture at 37 s: a JPEG', r.status === 200 && r.type === 'image/jpeg' && r.body[0] === 0xff && r.body[1] === 0xd8, { s: r.status, t: r.type });
  ok('320 pixels wide', dims(r.body) === 'mjpeg,320', dims(r.body));
  ok('small (under 40 KB)', r.body.length < 40000, r.body.length);
  const before = reads; t0 = Date.now(); const again = await get(hp, '/preview/' + key + '/frame.jpg?u=' + u + '&t=37&w=320');
  ok('the same picture again comes from memory: nothing read from the source', again.status === 200 && reads === before && Date.now() - t0 < 300, { reads: reads - before });
  const miss = await get(hp, '/preview/' + key + '/frame.jpg?u=' + encodeURIComponent('http://127.0.0.1:' + sp + '/none.mkv') + '&t=5');
  ok('a file that isn\'t there: no picture (204)', miss.status === 204, miss.status);
  console.log('  (first picture in ' + ms + ' ms)');
  relay.server.close(); src.close();
  console.log(fail ? fail + ' FAILED' : 'all seek preview checks passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
