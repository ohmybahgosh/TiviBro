/* Dialogue boost and night mode (as Plex's Boost Dialog, free here): voices clearer over music and effects, and
   loud scenes brought down for watching with the volume low.

   How: while either is on, the sound goes through the audio converter (TiviBro's own FFmpeg on the network helper,
   service/convert.js fxChain): folded to stereo, what both speakers share (where voices are mixed, and where a
   surround track's centre lands) lifted over what differs, the low boom trimmed, the voice band brought forward,
   then a compressor and a limiter.  It comes back as stereo Dolby Digital, which every LG TV plays.
   - A movie or episode: through the converter from the start (Convert.plan, o.boost).
   - A live channel: through the converter once its first details are known (Player's media callback), and not
     from the rewind buffer while it's on (the converter reads the channel itself).
   The TV plays the sound in hardware, so the page itself can't change it: Web Audio was tried on a C2 (Nov 25) and
   what it did never reached the speakers.  Changing the setting starts what plays again (Player.resync).
   Settings: Store.settings.dialogBoost ('off' | 'low' | 'high'), Store.settings.nightMode (true / false).
   Plain ES5 for the old Chromium on webOS. */
var Dialog = (function () {
  'use strict';
  var LEVELS = ['off', 'low', 'high'];

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  function level() { var v = S().dialogBoost; return LEVELS.indexOf(v) > 0 ? v : 'off'; }
  function night() { return S().nightMode === true; }
  // Either one on: the sound goes through the converter.
  function wanted() { return level() !== 'off' || night(); }
  // For the converter's link (Convert.link): &b=low|high, &n=1.  null when off.
  function fx() { return wanted() ? { b: level() === 'off' ? '' : level(), n: night() } : null; }
  function set(lvl, nightOn) {
    var s = S();
    if (lvl != null) s.dialogBoost = LEVELS.indexOf(lvl) >= 0 ? lvl : 'off';
    if (nightOn != null) s.nightMode = !!nightOn;
    if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings();
  }
  function T(x) { return typeof I18n !== 'undefined' ? I18n.t(x) : x; }
  // For the menus: what's on, in words.
  function label() {
    var v = level(), parts = [v === 'low' ? T('Low') : v === 'high' ? T('High') : '', night() ? T('Night mode') : ''].filter(Boolean);
    return parts.length ? parts.join(' + ') : T('Off');
  }

  return { wanted: wanted, level: level, night: night, fx: fx, set: set, label: label };
})();
