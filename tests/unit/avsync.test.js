// Audio sync (avsync.js, discussion #60): the players' SourceBuffers are wrapped so the sound lands later (the audio
// buffer moved on) or earlier (the video buffer moved on), while each player still reads back the offset it set.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('app/js/avsync.js', 'utf8');
let fails = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { fails++; console.error('FAIL ' + name + ': ' + e.message); } }
// A browser just big enough: MediaSource.addSourceBuffer, SourceBuffer.timestampOffset (refused while updating).
function world() {
  function SourceBuffer() { this._off = 0; this.updating = false; this._ends = []; }
  Object.defineProperty(SourceBuffer.prototype, 'timestampOffset', { configurable: true,
    get() { return this._off; }, set(v) { if (this.updating) throw new Error('InvalidStateError'); this._off = v; } });
  SourceBuffer.prototype.addEventListener = function (e, f) { this._ends.push(f); };
  SourceBuffer.prototype.removeEventListener = function (e, f) { this._ends = this._ends.filter((x) => x !== f); };
  SourceBuffer.prototype.finish = function () { this.updating = false; this._ends.slice().forEach((f) => f()); };
  function MediaSource() { this.readyState = 'open'; }
  MediaSource.prototype.addSourceBuffer = function () { return new SourceBuffer(); };
  const c = { SourceBuffer, MediaSource, Store: { settings: {}, saveSettings() { c.saves++; } }, saves: 0, Math, Object, String, setTimeout, clearTimeout };
  vm.createContext(c); vm.runInContext(src, c);
  return c;
}
const real = (sb) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sb), 'timestampOffset').get.call(sb);

check('nothing set: the offsets are the players\' own', () => {
  const c = world(), ms = new c.MediaSource(), a = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  a.timestampOffset = 12.5;
  assert.strictEqual(a.timestampOffset, 12.5); assert.strictEqual(real(a), 12.5);
});
check('sound 120 ms later: the audio buffer moves, the player still reads its own value', () => {
  const c = world();
  c.AvSync.use('c:abc', 'News'); c.AvSync.set(120);
  const ms = new c.MediaSource(), a = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"'), v = ms.addSourceBuffer('video/mp4; codecs="avc1.64001f"');
  assert.ok(Math.abs(real(a) - 0.12) < 1e-9, real(a)); assert.strictEqual(real(v), 0);
  a.timestampOffset = 10;
  assert.strictEqual(a.timestampOffset, 10); assert.ok(Math.abs(real(a) - 10.12) < 1e-9);
  assert.strictEqual(c.Store.settings.avSync['c:abc'], 120); assert.ok(c.AvSync.movable);
});
check('sound 80 ms earlier: the video buffer moves instead, nothing goes below zero', () => {
  const c = world();
  c.AvSync.use('c:abc'); c.AvSync.set(-80);
  const ms = new c.MediaSource(), a = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"'), v = ms.addSourceBuffer('video/mp4; codecs="avc1.64001f"');
  assert.strictEqual(real(a), 0); assert.ok(Math.abs(real(v) - 0.08) < 1e-9, real(v));
});
check('a buffer busy appending gets the offset when it\'s done', () => {
  const c = world();
  c.AvSync.use('c:x'); c.AvSync.set(200);
  const ms = new c.MediaSource(), a = ms.addSourceBuffer('audio/mp4');
  a.updating = true; a.timestampOffset = 5;
  assert.strictEqual(a.timestampOffset, 5); assert.ok(Math.abs(real(a) - 0.2) < 1e-9);
  a.finish(); assert.ok(Math.abs(real(a) - 5.2) < 1e-9, real(a));
});
check('sound and picture in one buffer can\'t be split, and say so', () => {
  const c = world();
  c.AvSync.use('c:x'); c.AvSync.set(100);
  const ms = new c.MediaSource(), b = ms.addSourceBuffer('video/mp4; codecs="avc1.64001f, mp4a.40.2"');
  assert.strictEqual(real(b), 0); assert.ok(!c.AvSync.movable);
  assert.strictEqual(c.AvSync._test.kindOf('video/mp2t'), 'v'); assert.strictEqual(c.AvSync._test.kindOf('audio/mpeg'), 'a');
});
check('kept per channel or movie: 0 forgets it, another channel starts at 0, steps of 10 ms, at most 2 s', () => {
  const c = world();
  c.AvSync.use('c:a'); c.AvSync.set(133); assert.strictEqual(c.AvSync.wanted(), 130);
  c.AvSync.use('v:9'); assert.strictEqual(c.AvSync.wanted(), 0); c.AvSync.set(-9000); assert.strictEqual(c.AvSync.wanted(), -2000);
  c.AvSync.use('c:a'); assert.strictEqual(c.AvSync.wanted(), 130);
  c.AvSync.set(0); assert.ok(!('c:a' in c.Store.settings.avSync)); assert.strictEqual(c.AvSync.count(), 1);
  assert.strictEqual(c.AvSync.keyFor({ k: 'k1' }, { live: false, meta: { id: 42 } }), 'v:42');
  assert.strictEqual(c.AvSync.keyFor({ k: 'k1' }, {}), 'c:k1');
  c.AvSync.forgetAll(); assert.strictEqual(c.AvSync.count(), 0);
});
check('in words: later, earlier, as sent', () => {
  const c = world();
  assert.strictEqual(c.AvSync.says(120), 'Sound 120 ms later'); assert.strictEqual(c.AvSync.says(-80), 'Sound 80 ms earlier');
  assert.strictEqual(c.AvSync.says(0), 'Sound and picture as they come');
});
if (fails) { console.error(fails + ' failed'); process.exit(1); }
