/* Where a converted MKV's picture starts (service/convert.js firstMkv): a seek starts on the keyframe before it, and
   LG's player counts its clock from that picture, so the subtitles need its time.  An MKV made with ffmpeg from a
   seek at 5.2 s with keyframes every 2 s starts at 4 s; read in small pieces as ffmpeg writes them.  Skipped
   without ffmpeg. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const C = require('../../service/convert.js');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const FF = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';
try { cp.execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch (e) { console.log('SKIP no ffmpeg'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-mkv-')), inp = path.join(dir, 'in.mkv'), out = path.join(dir, 'out.mkv');
const enc = String(cp.execFileSync(FF, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }));
const v = / libx264 /.test(enc) ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0'] : ['-c:v', 'mpeg4', '-g', '50'];
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=d=20'].concat(v, ['-c:a', 'aac', inp]));
cp.execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5.2', '-noaccurate_seek', '-i', inp, '-copyts', '-start_at_zero', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'matroska', out]);
const b = fs.readFileSync(out), st = { buf: null, seen: 0, first: null };
for (let i = 0; i < b.length && st.first == null; i += 3000) C.firstMkv(st, b.subarray(i, i + 3000));
ok('a seek to 5.2 s: the picture starts on the keyframe at 4 s', st.first != null && st.first >= 3.99 && st.first < 4.1, st.first);
const none = { buf: null, seen: 0, first: null }; C.firstMkv(none, Buffer.alloc(5000));
ok('no Cluster yet: nothing said', none.first == null);
fs.rmSync(dir, { recursive: true, force: true });
if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all MKV start tests passed');
