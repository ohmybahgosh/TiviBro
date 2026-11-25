/* Dialogue boost and night mode (app/js/dialog.js), the logic around the sound: what's on, the menu's words, saving,
   and that nothing touches the video's sound until one is on (the sound itself: tests/soak/dialog.js, in a browser).
     node tests/unit/dialog.test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');

function load(settings, withAudio) {
  const made = [], saved = [];
  // A Web Audio stand-in: every node takes connect() and has the params the chain sets.
  const param = () => ({ value: 0 });
  const node = (kind) => ({ kind, connect() {}, gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  class AC { constructor() { this.sampleRate = 48000; this.destination = node('out'); made.push(this); }
    createGain() { return node('gain'); } createChannelSplitter() { return node('split'); } createChannelMerger() { return node('merge'); }
    createBiquadFilter() { return node('eq'); } createDynamicsCompressor() { return node('comp'); }
    createMediaElementSource(v) { this.source = v; return node('src'); } }
  const ctx = { console, Store: { settings, saveSettings: () => saved.push(JSON.stringify(settings)) }, Log: { info() {}, warn() {} }, window: withAudio ? { AudioContext: AC } : {}, document: null };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/dialog.js'), 'utf8') + '\nthis.Dialog = Dialog;', ctx);
  return { D: ctx.Dialog, made, saved };
}

let t = load({}, true);
assert.strictEqual(t.D.wanted(), false, 'nothing set: off');
assert.strictEqual(t.D.label(), 'Off');
assert.strictEqual(t.D.attach({}), false, 'off: the video is never joined to Web Audio');
assert.strictEqual(t.made.length, 0, '...not even an audio context made');

t = load({ dialogBoost: 'high' }, true);
assert.ok(t.D.wanted() && t.D.level() === 'high' && t.D.label() === 'High');
const video = { id: 'v' };
assert.strictEqual(t.D.attach(video), true, 'on: joined');
assert.ok(t.made.length === 1 && t.made[0].source === video, 'once, on that video');
assert.strictEqual(t.D.attach(video), true, 'a second time: the same chain, no second source (a browser refuses one)');
assert.strictEqual(t.made.length, 1);

t = load({ dialogBoost: 'bogus', nightMode: true }, true);
assert.ok(t.D.level() === 'off' && t.D.wanted(), 'an unknown level reads as off; night mode alone is enough');
assert.strictEqual(t.D.label(), 'Night mode');
t.D.set('low', null);
assert.ok(t.D.label() === 'Low + Night mode' && JSON.parse(t.saved.pop()).dialogBoost === 'low', 'set: kept and saved');
t.D.set(null, false);
assert.ok(t.D.label() === 'Low' && JSON.parse(t.saved.pop()).nightMode === false);
t.D.set('nonsense', null);
assert.strictEqual(t.D.level(), 'off', 'a level that isn\'t one: off');

t = load({ dialogBoost: 'low' }, false);
assert.strictEqual(t.D.attach({}), false, 'a TV without Web Audio: nothing joined');
assert.ok(/no Web Audio/.test(t.D.failed), 'and it says why: ' + t.D.failed);
console.log('PASS dialogue boost: off touches nothing, on joins the video once, levels, night mode, saving, no Web Audio');
