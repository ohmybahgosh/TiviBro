// app/vendor/mpegts.js: a big jump in a channel's sound timestamps (issue #81).  mpegts filled any gap with
// silent frames, one per 21 ms, and added them with push.apply.  A jump of hours made hundreds of thousands
// of them and threw "Maximum call stack size exceeded"; the patched remuxer fills gaps up to 10 s only.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

const src = fs.readFileSync(path.join(__dirname, '../../app/vendor/mpegts.js'), 'utf8');
const hook = 'Oe=i(11),Be=function(){';
ok('the remuxer can be found in the vendor file', src.indexOf(hook) > 0);
const quiet = { log() {}, warn() {}, info() {}, error() {}, debug() {} };
const win = { navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36' },
  location: { href: 'http://localhost/' }, console: quiet, setTimeout, clearTimeout };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(src.replace(hook, 'Oe=i(11),Be=self.__Be=function(){'), win);
const Remuxer = win.__Be;

const FRAME = 1024 / 48;   // AAC at 48 kHz, in ms
function remuxer() {
  const r = new Remuxer({ isLive: true, fixAudioTimestampGap: true });
  r._audioMeta = { codec: 'aac', originalCodec: 'mp4a.40.2', channelCount: 2, refSampleDuration: FRAME, audioSampleRate: 48000, timescale: 1000 };
  r._dtsBase = 0; r._dtsBaseInited = true;
  r.samples = 0;
  r._onMediaSegment = (type, seg) => { r.samples += seg.sampleCount || 0; };
  return r;
}
function track(start, n) {
  const s = [];
  for (let k = 0; k < n; k++) { const d = start + k * FRAME; s.push({ unit: new Uint8Array(10), length: 10, dts: d, pts: d }); }
  return { type: 'audio', id: 2, sequenceNumber: 0, samples: s, length: 10 * n };
}
function run(gapMs) {
  const r = remuxer(); let err = null; const t0 = Date.now();
  try { r._remuxAudio(track(0, 50)); r._remuxAudio(track(50 * FRAME + gapMs, 50)); } catch (e) { err = e; }
  return { r, err, ms: Date.now() - t0 };
}

let x = run(4 * 3600 * 1000);
ok('a 4 hour jump in the sound does not throw', !x.err, x.err && x.err.message);
ok('a 4 hour jump is not filled with silence', x.r._audioNextDts < 10000, Math.round(x.r._audioNextDts));
ok('and is quick', x.ms < 500, x.ms + ' ms');

x = run(30 * 60 * 1000);
ok('a 30 minute jump does not throw', !x.err, x.err && x.err.message);
ok('a 30 minute jump is not filled with silence', x.r._audioNextDts < 10000, Math.round(x.r._audioNextDts));

x = run(2000);
ok('a 2 s gap still does not throw', !x.err, x.err && x.err.message);
ok('a 2 s gap is still filled with silence, as before', x.r._audioNextDts > 100 * FRAME + 1900, Math.round(x.r._audioNextDts));

ok('PATCHES.md tells of the patch', /issue #81/.test(fs.readFileSync(path.join(__dirname, '../../app/vendor/PATCHES.md'), 'utf8')));

console.log(fail ? fail + ' failures' : 'all mpegts timestamp gap tests passed');
process.exit(fail ? 1 : 0);
