/* Dialogue boost and night mode: the setting (app/js/dialog.js), what the app asks the converter for
   (app/js/convert.js link), and the filters the converter runs (service/convert.js fxChain and args).
   The sound itself was heard through the same chain on a C2 (Nov 25); here, that each part says the right thing.
     node tests/unit/dialog.test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');

// dialog.js on a TV whose saved settings are `settings`; saves are recorded.
function load(settings) {
  const saved = [];
  const ctx = { console, Store: { settings, saveSettings: () => saved.push(JSON.stringify(settings)) } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/dialog.js'), 'utf8') + '\nthis.Dialog = Dialog;', ctx);
  return { D: ctx.Dialog, saved };
}

// The setting: off by default, levels, night mode, saving.
let t = load({});
assert.strictEqual(t.D.wanted(), false, 'nothing set: off');
assert.strictEqual(t.D.fx(), null, 'off: nothing asked of the converter');
assert.strictEqual(t.D.label(), 'Off');
t = load({ dialogBoost: 'high' });
assert.ok(t.D.wanted() && t.D.label() === 'High');
assert.deepStrictEqual(JSON.parse(JSON.stringify(t.D.fx())), { b: 'high', n: false });
t = load({ dialogBoost: 'bogus', nightMode: true });
assert.ok(t.D.level() === 'off' && t.D.wanted(), 'an unknown level reads as off; night mode alone is enough');
assert.deepStrictEqual(JSON.parse(JSON.stringify(t.D.fx())), { b: '', n: true });
assert.strictEqual(t.D.label(), 'Night mode');
t.D.set('low', null);
assert.ok(t.D.label() === 'Low + Night mode' && JSON.parse(t.saved.pop()).dialogBoost === 'low', 'set: kept and saved');
t.D.set(null, false);
assert.ok(t.D.label() === 'Low' && JSON.parse(t.saved.pop()).nightMode === false);
t.D.set('nonsense', null);
assert.ok(t.D.level() === 'off' && t.D.fx() === null, 'a level that isn\'t one: off');

// The link: &b= and &n=1 only when they're on.
const cctx = { console, window: {}, Store: { settings: {} }, Log: { info() {}, warn() {} }, Promise, setTimeout, clearTimeout };
vm.createContext(cctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/convert.js'), 'utf8') + '\nthis.Convert = Convert;', cctx);
const conv = { src: 'http://x.example/a.mkv', fmt: 'mkv', a: 0 };
assert.ok(!/[&?](b|n)=/.test(cctx.Convert.link(conv)), 'no boost: the link as before');
const lk = cctx.Convert.link(Object.assign({ fx: { b: 'low', n: true } }, conv));
assert.ok(/&b=low/.test(lk) && /&n=1/.test(lk), lk);
assert.ok(!/&b=/.test(cctx.Convert.link(Object.assign({ fx: { b: '', n: true } }, conv))), 'night mode alone: no &b=');

// The converter: the chain, and the sound out as stereo Dolby Digital through it.
const C = require('../../service/convert.js');
assert.strictEqual(C.fxChain('', false), '', 'off: no filters');
assert.strictEqual(C.fxChain('loud', false), '', 'an unknown level from a link: no filters');
const low = C.fxChain('low', false), high = C.fxChain('high', false), night = C.fxChain('', true);
assert.ok(/^aresample=48000,aformat=channel_layouts=stereo,pan=stereo/.test(low) && /alimiter=limit=0\.9$/.test(low), low);
assert.ok(/equalizer=f=2800:t=q:w=0\.9:g=5/.test(low) && /equalizer=f=2800:t=q:w=0\.9:g=9/.test(high), 'High lifts the voice band more than Low');
assert.ok(!/pan=/.test(night) && /acompressor=threshold=0\.05:ratio=6/.test(night), 'night mode alone: no voice lift, the stronger compressor');
assert.ok(/ratio=6/.test(C.fxChain('high', true)), 'both: the night compressor');
// Only filters the converter is built with (scripts/ffmpeg/build.sh --enable-filter).
const built = /--enable-filter=([\w,]+)/.exec(fs.readFileSync(path.join(__dirname, '../../scripts/ffmpeg/build.sh'), 'utf8'));
const have = built ? built[1].split(',') : [];
C.fxChain('high', true).split(',').map((f) => f.split('=')[0]).filter((f) => /^[a-z]+$/.test(f)).forEach((f) => assert.ok(have.indexOf(f) >= 0, 'the converter is built with ' + f));
const a = C.args({ input: 'http://x.example/a.mkv', fmt: 'mkv', a: 1, fx: high });
const i = a.indexOf('-af');
assert.ok(i > 0 && a[i + 1] === high && a.slice(i + 2, i + 8).join(' ') === '-c:a ac3 -b:a 224k -ac 2', a.join(' '));
assert.ok(a.indexOf('0:a:1') > 0 && a[a.indexOf('-c:v') + 1] === 'copy', 'the chosen track, the picture untouched');
assert.ok(C.args({ input: 'http://x.example/a.mkv', fmt: 'mkv', a: 0 }).indexOf('-af') < 0, 'off: no -af');
console.log('PASS dialogue boost: off by default, levels, night mode, saving, the link, the converter\'s filters and Dolby Digital out');
