/* Dialogue boost and night mode (beta plan, as Plex's Boost Dialog and Prime Video's Dialogue Boost): voices
   clearer over music and effects, and loud scenes no louder than talk, for any channel, movie or episode.

   How: the sound goes through a small Web Audio chain in TiviBro.
   - Dialogue boost: the sound is split into what both speakers share (the middle, where voices are mixed, and
     where a surround track's centre channel lands when it's folded to two) and what differs (the sides: music,
     effects, ambience).  The middle is lifted with a presence EQ around 2.8 kHz, where words are made clear, and
     a little under 200 Hz is taken out of it; the sides are turned down.  Low and High are two strengths.
   - Night mode: a compressor that brings loud moments down and quiet talk up, then makes up the level.
   - Always last: a limiter, so the lift never clips.
   Mono and surround are folded to two channels first ('speakers' downmix: a centre channel goes to both sides).

   Only TiviBro's own players feed the sound through the page (MPEG-TS, HLS, DASH); the TV's player (native) plays it
   in hardware.  So, as with Audio sync, a channel with either one on plays on TiviBro's player (Player pickEngine),
   and a movie file through the converter as MPEG-TS (convert.js, its sound copied).  Nothing is set up until one of
   them is turned on: the video element is joined to Web Audio once, for good (a browser can't undo that), so
   afterwards Off is a straight line through, not a way back.
   Settings: Store.settings.dialogBoost ('off' | 'low' | 'high'), Store.settings.nightMode (true / false).
   Plain ES5 for the old Chromium on webOS. */
var Dialog = (function () {
  'use strict';
  var LEVELS = { off: null, low: { presence: 4, sides: 0.75, low: -2 }, high: { presence: 8, sides: 0.45, low: -4 } };
  var ctx = null, src = null, chain = null, el = null, failed = '';

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  function level() { var v = S().dialogBoost; return LEVELS[v] ? v : 'off'; }
  // Either one on: the sound has to come through the page (Player pickEngine, Convert.plan).
  function wanted() { return level() !== 'off' || S().nightMode === true; }

  /* The chain, built on any audio context (the TV's, or an offline one in the tests): input -> ... -> output.
     set(lvl, night) changes it in place; lvl 'off' with night off goes straight through (the dry path). */
  function build(ac, input, output) {
    var fold = ac.createGain(); fold.channelCount = 2; fold.channelCountMode = 'explicit'; fold.channelInterpretation = 'speakers';
    var split = ac.createChannelSplitter(2), merge = ac.createChannelMerger(2);
    var g = function (v) { var n = ac.createGain(); n.gain.value = v; return n; };
    // Middle = (L + R) / 2, sides = (L - R) / 2.
    var midL = g(0.5), midR = g(0.5), sideL = g(0.5), sideR = g(-0.5), mid = g(1), side = g(1);
    var presence = ac.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.9; presence.gain.value = 0;
    var lows = ac.createBiquadFilter(); lows.type = 'lowshelf'; lows.frequency.value = 180; lows.gain.value = 0;
    // Back to left and right: L = middle + sides, R = middle - sides.
    var toL = g(1), toR = g(-1);
    var comp = ac.createDynamicsCompressor(), makeup = g(1), limit = ac.createDynamicsCompressor();
    limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1;
    input.connect(fold); fold.connect(split);
    split.connect(midL, 0); split.connect(midR, 1); split.connect(sideL, 0); split.connect(sideR, 1);
    midL.connect(mid); midR.connect(mid); sideL.connect(side); sideR.connect(side);
    mid.connect(lows); lows.connect(presence);
    presence.connect(merge, 0, 0); presence.connect(merge, 0, 1);
    side.connect(toL); side.connect(toR); toL.connect(merge, 0, 0); toR.connect(merge, 0, 1);
    // Both off: straight through (dry), the chain out of the way; the browser's compressor adds a little level of its
    // own even when set to do nothing.  Either on: the chain (wet).
    var dry = g(1), wet = g(0);
    input.connect(dry); dry.connect(output);
    merge.connect(comp); comp.connect(makeup); makeup.connect(limit); limit.connect(wet); wet.connect(output);
    function set(lvl, night) {
      var L = LEVELS[lvl] || null;
      presence.gain.value = L ? L.presence : 0;
      lows.gain.value = L ? L.low : 0;
      side.gain.value = L ? L.sides : 1;
      // Night mode: loud moments down (from -30 dB, 6:1), the level made up after.  Off: the compressor does nothing.
      if (night) { comp.threshold.value = -30; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.3; makeup.gain.value = 1.8; }
      else { comp.threshold.value = 0; comp.knee.value = 0; comp.ratio.value = 1; makeup.gain.value = 1; }
      var on = !!L || !!night;
      dry.gain.value = on ? 0 : 1; wet.gain.value = on ? 1 : 0;
    }
    set('off', false);
    return { set: set };
  }

  /* The video joined to Web Audio, the first time either is on (once for the page's one video element).  Nothing
     happens otherwise: with both off and never on, the sound never leaves the video's own path. */
  function attach(video) {
    if (!video || failed) return false;
    if (el === video && chain) return true;
    if (!wanted()) return false;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = 'this TV has no Web Audio'; return false; }
      ctx = ctx || new AC();
      src = ctx.createMediaElementSource(video);
      chain = build(ctx, src, ctx.destination);
      el = video;
      if (typeof Log !== 'undefined') Log.info('audio', 'Dialogue boost and night mode ready (Web Audio, ' + ctx.sampleRate + ' Hz)');
      return true;
    } catch (e) {
      failed = (e && e.message) || String(e);
      if (typeof Log !== 'undefined') Log.warn('audio', 'Dialogue boost unavailable: ' + failed);
      return false;
    }
  }
  // The settings as they are now, onto the chain (if there is one); called on a change and when a stream starts.
  function apply(video) {
    if (video && wanted()) attach(video);
    if (!chain) return;
    if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    chain.set(level(), S().nightMode === true);
  }
  function set(lvl, night) {
    var s = S();
    if (lvl != null) s.dialogBoost = LEVELS[lvl] !== undefined ? lvl : 'off';
    if (night != null) s.nightMode = !!night;
    if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings();
    // Joined only while TiviBro's own player has the sound (Player.pageSound); from the TV's player, the stream
    // starts again on TiviBro's first (settings.js dialogMoved, views.js dialogMenu) and the start joins it.
    var page = typeof Player !== 'undefined' && Player.pageSound;
    apply(el || (page && typeof document !== 'undefined' && document && document.querySelector ? document.querySelector('video') : null));
  }
  // For the menus: what's on, in words.
  function T(x) { return typeof I18n !== 'undefined' ? I18n.t(x) : x; }
  function label() {
    var v = level(), n = S().nightMode === true;
    var parts = [v === 'low' ? T('Low') : v === 'high' ? T('High') : '', n ? T('Night mode') : ''].filter(Boolean);
    return parts.length ? parts.join(' + ') : T('Off');
  }

  return { wanted: wanted, level: level, attach: attach, apply: apply, set: set, label: label, LEVELS: LEVELS,
    get failed() { return failed; }, get active() { return !!chain; }, _build: build };
})();
