/* CEA-608 closed captions (app/js/captions.js): reading caption SEIs, pop-on, roll-up and paint-on,
   special characters, out-of-order frames, a clock that jumps back, and the stale screen.
     node tests/unit/captions.test.js */
'use strict';
const Captions = require('../../app/js/captions.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

const par = (b) => { b &= 0x7f; let n = 0; for (let x = b; x; x >>= 1) n += x & 1; return n % 2 ? b : b | 0x80; };
// One SEI NAL (bare, as the demuxer hands it over) with one CC1 pair, plus a field-2 pair that must be ignored.
function sei(a, b, start) {
  const payload = [0xb5, 0x00, 0x31, 0x47, 0x41, 0x39, 0x34, 0x03, 0x40 | 3, 0xff, 0xfc, par(a), par(b), 0xfd, par(0x41), par(0x42), 0xfa, 0, 0, 0xff];
  const rbsp = [0x04, payload.length, ...payload, 0x80], out = [0x06];
  let z = 0;
  for (const x of rbsp) { if (z >= 2 && x <= 3) { out.push(3); z = 0; } out.push(x); z = x === 0 ? z + 1 : 0; }
  return Uint8Array.from(start ? [0, 0, 0, 1, ...out] : out);
}
const ctl = (a, b) => [[a, b], [a, b]];
const txt = (s) => { const o = []; for (let i = 0; i < s.length; i += 2) o.push([s.charCodeAt(i), i + 1 < s.length ? s.charCodeAt(i + 1) : 0]); return o; };
const lines = (sc) => sc ? sc.lines.map(l => l.row + ':' + l.text).join(' / ') : '';
function run(pairs, t0, step, cc, shuffle) {
  cc = cc || Captions.create();
  let items = pairs.map((p, i) => ({ nal: sei(p[0], p[1], i % 2 === 0), t: t0 + i * (step || 33) }));
  if (shuffle) for (let i = 0; i + 2 < items.length; i += 3) { const x = items[i]; items[i] = items[i + 2]; items[i + 2] = x; }   // B-frame order
  items.forEach(x => cc.feed(x.nal, x.t));
  return cc;
}

// Pop-on: nothing until End of caption, then the whole caption at once.
const pop = [...ctl(0x14, 0x20), ...ctl(0x14, 0x2e), ...ctl(0x14, 0x60), ...txt('Hello there.'), ...ctl(0x14, 0x2f)];
let cc = run(pop, 1000);
cc.flush();
const eoc = 1000 + (pop.length - 1) * 33;
ok('pop-on: nothing before End of caption', !lines(cc.at(eoc - 40)), lines(cc.at(eoc - 40)));
ok('pop-on: the whole caption at End of caption, on row 15', lines(cc.at(eoc + 10)) === '15:Hello there.', lines(cc.at(eoc + 10)));
ok('field 2 (CC3) is not mixed in', !/AB/.test(lines(cc.at(eoc + 10))));
ok('feed says how many caption pairs it read', Captions.create().feed(sei(0x41, 0x42), 5) === 1);
ok('SEIs without caption data are ignored', Captions.create().feed(Uint8Array.from([0x06, 0x05, 0x02, 0x11, 0x22, 0x80]), 5) === 0);

// Out of order (B-frames): decoded in presentation order all the same.
cc = run(pop, 1000, 33, null, true); cc.flush();
ok('frames out of order still make the right caption', lines(cc.at(eoc + 10)) === '15:Hello there.', lines(cc.at(eoc + 10)));

// Roll-up: lines appear as they come and scroll up.
const roll = [...ctl(0x14, 0x25), ...ctl(0x14, 0x60), ...txt('First line'), ...ctl(0x14, 0x2d), ...txt('Second line'), ...ctl(0x14, 0x2d), ...txt('Third')];
cc = run(roll, 0); cc.flush();
const end = (roll.length - 1) * 33 + 5;
ok('roll-up: two rows, newest at the bottom', lines(cc.at(end)) === '14:Second line / 15:Third', lines(cc.at(end)));
ok('roll-up: text shows as it arrives', /15:Firs/.test(lines(cc.at(6 * 33 + 5))), lines(cc.at(6 * 33 + 5)));

// Special and accented characters, and the indent of a PAC.
const sp = [...ctl(0x14, 0x29), ...ctl(0x14, 0x74), ...ctl(0x11, 0x37), ...txt(' Caf'), [0x5c, 0x20], ...ctl(0x11, 0x37)];
cc = run(sp, 0); cc.flush();
const spl = cc.at(3000);
ok('music notes and é', spl && spl.lines[0] && spl.lines[0].text === '♪ Café ♪', JSON.stringify(spl && spl.lines));
ok('indent from the preamble code (column 8)', spl && spl.lines[0] && spl.lines[0].col === 8 && spl.lines[0].row === 15, JSON.stringify(spl && spl.lines));
const ext = [...ctl(0x14, 0x29), ...ctl(0x14, 0x60), ...txt('Ni'), [0x6e, 0], ...ctl(0x13, 0x21)];     // "Nin" then extended ã replaces the n
cc = run(ext, 0); cc.flush();
ok('extended characters replace the one before', cc.at(3000) && cc.at(3000).lines[0].text === 'Niã', JSON.stringify(cc.at(3000)));

// Erase displayed memory clears; the copy of a control code is not acted on twice.
cc = run([...pop, ...ctl(0x14, 0x2c)], 0); cc.flush();
ok('Erase displayed memory clears the screen', !lines(cc.at(3000)));
cc = run([...ctl(0x14, 0x29), ...ctl(0x14, 0x60), ...txt('AB'), ...ctl(0x14, 0x21)], 0); cc.flush();
ok('a doubled Backspace removes one character', lines(cc.at(3000)) === '15:A', lines(cc.at(3000)));

// Captions stop: the last one goes after a while.  The clock jumps back: start again.
cc = run(pop, 1000); cc.flush();
ok('stale captions are cleared after 15 s without caption data', !cc.at(eoc + 16000) && !!cc.at(eoc + 2000));
cc = run(pop, 600000); run(pop, 1000, 33, cc); cc.flush();
ok('a clock that jumps back starts again', lines(cc.at(eoc + 10)) === '15:Hello there.' && cc.screens.every(s => s.t < 600000), JSON.stringify(cc.screens.map(s => s.t)));
// The blink between two pop-on captions is skipped.
const two = [...pop, ...ctl(0x14, 0x20), ...ctl(0x14, 0x2e), ...ctl(0x14, 0x60), ...txt('Next.'), ...ctl(0x14, 0x2c), ...ctl(0x14, 0x2f)];
cc = run(two, 0); cc.flush();
const t2 = (two.length - 3) * 33 + 5;
ok('no blank flash between two pop-on captions', lines(cc.at(t2)) === '15:Hello there.', lines(cc.at(t2)));
ok('then the next one', lines(cc.at((two.length - 1) * 33 + 5)) === '15:Next.', lines(cc.at((two.length - 1) * 33 + 5)));
// Length-prefixed NALs (AVC1) read too.
const n = sei(0x14, 0x2c), pre = new Uint8Array(n.length + 4); pre.set([0, 0, 0, n.length], 0); pre.set(n, 4);
ok('length-prefixed NAL units are read too', Captions._test.pairsOf(pre).length === 1);
// A long evening: trim keeps the list short.
cc = Captions.create(); for (let k = 0; k < 300; k++) run([...ctl(0x14, 0x20), ...ctl(0x14, 0x60), ...txt('L' + k), ...ctl(0x14, 0x2f)], k * 1000, 33, cc);
cc.flush(); cc.trim(299000 - 5000);
ok('trim forgets what has passed', cc.screens.length < 20, cc.screens.length);

console.log(fails ? fails + ' FAILED' : 'all caption decoder checks passed');
process.exit(fails ? 1 : 0);
