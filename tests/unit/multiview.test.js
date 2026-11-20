/* Multiview's pictures (service/multiview.js): JPEGs cut out of ffmpeg's output however it arrives, the ffmpeg
   command, the key, and (where ffmpeg is installed) a channel's pictures end to end.
     node tests/unit/multiview.test.js */
'use strict';
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const MV = require('../../service/multiview.js'), Convert = require('../../service/convert.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : '  ' + x)); if (!c) fail++; };

// Two JPEGs and a half, cut into odd pieces.
const jpg = (n) => Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.alloc(n, 7), Buffer.from([0xFF, 0xD9])]);
const all = Buffer.concat([Buffer.from('junk'), jpg(10), jpg(300), jpg(5).slice(0, 4)]);
const got = [], feed = MV._splitter((f) => got.push(f.length));
for (let i = 0; i < all.length; i += 3) feed(all.slice(i, i + 3));
ok('pictures are cut out whole, whatever the pieces', got.join(',') === '14,304', got.join(','));

const a = MV._args('in', 640, 15, false).join(' '), s = MV._args('in', 640, 25, true).join(' ');
ok('frames no other frame needs are skipped (never every B-frame: that broke up some channels)', /-skip_frame noref/.test(a) && !/bidir/.test(a));
ok('s=1: every frame', !/skip_frame/.test(s));
ok('no sound, small, JPEGs at the rate asked', /-an /.test(a) && /scale=640:-2/.test(a) && /-c:v mjpeg/.test(a) && /-r 15 /.test(a));

(async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/clip.ts') { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return fs.createReadStream(clip).pipe(res); }
    if (MV.isRoute(req.url)) return MV.handle(req, res, {}, null, srv.address().port);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, get = (p) => new Promise((r) => http.get('http://127.0.0.1:' + port + p, (res) => { let n = 0; const t = setTimeout(() => { res.destroy(); r({ code: res.statusCode, type: res.headers['content-type'], frames: n }); }, 4000); res.on('data', (d) => { n += (d.toString('latin1').match(/--tivibroframe/g) || []).length; }); res.on('end', () => { clearTimeout(t); r({ code: res.statusCode, type: res.headers['content-type'], frames: n }); }); }));
  let r = await get('/mv/' + 'a'.repeat(32) + '/status');
  ok('without the converter\'s key: refused', r.code === 403, r.code);
  const ff = process.env.TIVIBRO_FFMPEG || (cp.spawnSync('which', ['ffmpeg']).stdout || '').toString().trim();
  var clip = path.join(os.tmpdir(), 'mv-test.ts');
  if (ff && cp.spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '3', '-c:v', 'mpeg2video', '-f', 'mpegts', clip]).status === 0) {
    process.env.TIVIBRO_FFMPEG = ff;
    r = await get('/mv/' + Convert.key + '/tile.mjpg?w=320&f=10&u=' + encodeURIComponent('http://127.0.0.1:' + port + '/clip.ts'));
    ok('a channel\'s pictures, one JPEG after another', r.code === 200 && /multipart\/x-mixed-replace/.test(r.type) && r.frames >= 5, JSON.stringify(r));
  } else console.log('SKIP no ffmpeg here: the end-to-end picture check');
  srv.close();
  console.log(fail ? fail + ' failures' : 'all multiview tests passed');
  process.exit(fail ? 1 : 0);
})();
