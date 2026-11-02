/* Puts CEA-608 closed captions into a raw H.264 stream (Annex B, one AUD per frame, no B-frames), the
   way US channels carry them: an SEI with "GA94" caption data in every frame.  For the mock provider's
   Captions channel (scripts/demo/make-media.sh) and tests/soak/captions.js.
     node scripts/demo/add-captions.js in.h264 out.h264 <fps> <seconds>
   The captions: pop-on "Caption N at m:ss" every 3 seconds for the first half, then roll-up lines
   "Roll-up line N at m:ss" every 2 seconds, each shown at the time it names. */
'use strict';
const fs = require('fs');
const [, , inFile, outFile, fpsArg, secArg] = process.argv;
const fps = +fpsArg || 25, secs = +secArg || 120;

const par = (b) => { b &= 0x7f; let n = 0; for (let x = b; x; x >>= 1) n += x & 1; return n % 2 ? b : b | 0x80; };
const ctl = (a, b) => [[a, b], [a, b]];                      // control codes go twice
const text = (s) => { const out = []; for (let i = 0; i < s.length; i += 2) out.push([s.charCodeAt(i), i + 1 < s.length ? s.charCodeAt(i + 1) : 0]); return out; };
const clock = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

// The pairs to send, by frame: each caption's last pair lands on its frame.
const frames = Math.round(fps * secs), plan = new Array(frames).fill(null);
function place(t, pairs) {
  let f = Math.round(t * fps) - pairs.length + 1;
  for (const p of pairs) { if (f >= 0 && f < frames && !plan[f]) plan[f] = p; f++; }
}
const half = secs / 2;
let n = 1;
for (let t = 3; t < half; t += 3, n++) {
  place(t, [...ctl(0x14, 0x20), ...ctl(0x14, 0x2e), ...ctl(0x14, 0x60), ...text('Caption ' + n + ' at ' + clock(t)), ...ctl(0x14, 0x2f)]);
}
place(half, [...ctl(0x14, 0x2c), ...ctl(0x14, 0x25), ...ctl(0x14, 0x60)]);
n = 1;
for (let t = half + 2; t < secs - 1; t += 2, n++) place(t, [...ctl(0x14, 0x2d), ...text('Roll-up line ' + n + ' at ' + clock(t))]);

function sei(pair) {
  const a = pair ? par(pair[0]) : 0x80, b = pair ? par(pair[1]) : 0x80;
  const payload = [0xb5, 0x00, 0x31, 0x47, 0x41, 0x39, 0x34, 0x03, 0x40 | 2, 0xff, 0xfc, a, b, 0xfd, 0x80, 0x80, 0xff];
  const rbsp = [0x04, payload.length, ...payload, 0x80];
  const out = [0x06];
  let z = 0;
  for (const x of rbsp) { if (z >= 2 && x <= 3) { out.push(3); z = 0; } out.push(x); z = x === 0 ? z + 1 : 0; }
  return Buffer.from([0, 0, 0, 1, ...out]);
}

const src = fs.readFileSync(inFile), parts = [];
let frame = 0, last = 0;
for (let i = 0; i + 4 < src.length; i++) {
  if (src[i] === 0 && src[i + 1] === 0 && src[i + 2] === 1 && (src[i + 3] & 0x1f) === 9) {      // an access unit delimiter
    const start = i > 0 && src[i - 1] === 0 ? i - 1 : i;
    let end = i + 3;
    while (end < src.length && !(src[end] === 0 && src[end + 1] === 0 && (src[end + 2] === 1 || (src[end + 2] === 0 && src[end + 3] === 1)))) end++;
    parts.push(src.subarray(last, end));                         // everything up to and with the AUD
    parts.push(sei(plan[frame] || null));
    last = end; frame++;
    i = end - 1;
  }
}
parts.push(src.subarray(last));
fs.writeFileSync(outFile, Buffer.concat(parts));
console.log('captions added to ' + frame + ' frames');
