/* A playlist whose channels the provider won't send (issue #25).  A list can log in fine, with an
   account that is active for months, and still have almost nothing behind it: every channel answers
   404 Not Found or 5xx, because the list is out of date or its streams only work from another
   country.  Each channel that fails like that is counted (once per channel), and so is each channel
   that plays.  When five or more have failed and next to none played, TiviBro says so once a day per
   playlist, instead of leaving it to look like one bad channel after another.

   One channel that won't play while the rest do (issue #37): a channel whose last two tries both
   failed, in the last three days, gets a small "not playing lately" mark in the channel lists, the
   guide and the phone app.  The first time it plays again the mark goes.  Kept per playlist on the TV
   (tivibro.deadCh), at most 300 channels each, so it lasts past a restart. */
var DeadList = (function () {
  'use strict';
  var KEY = 'tivibro.deadNoted', MIN = 5;
  var seen = {};          // playlist id → { fails: { channel: http }, ok: { channel: 1 } }
  var SKEY = 'tivibro.deadCh', STREAK = 2, RECENT = 3 * 24 * 3600e3, CAP = 300;
  var streaks = null;     // playlist id → { channel key: [failed tries in a row, when the last failed] }
  var listeners = [];

  function forPl() {
    var id = (Store.playlist && Store.playlist.id) || '';
    return seen[id] || (seen[id] = { fails: {}, ok: {} });
  }
  function keyOf(ch, url) { return ch ? String(ch.k || ch.id || ch.n || '') : String(url || ''); }

  function played(ch, url) {
    var s = forPl(), k = keyOf(ch, url);
    s.ok[k] = 1; delete s.fails[k];
    var m = mine(), was = isMarked(m[k]);
    if (m[k]) { delete m[k]; saveStreaks(); }
    if (was) changed(k);
  }
  // http: the provider's error code, or 0 when it answered but the TV could not play it.
  function failed(ch, url, http) {
    var s = forPl(), k = keyOf(ch, url);
    if (ch && k) streak(k, ch.n);
    if (!http || s.ok[k]) return;
    s.fails[k] = +http;
    check();
  }

  /* ---------- one channel that keeps failing ---------- */
  function now() { return Date.now(); }
  function loadStreaks() {
    if (streaks) return streaks;
    try { streaks = JSON.parse(localStorage.getItem(SKEY) || '{}') || {}; } catch (e) { streaks = {}; }
    if (typeof streaks !== 'object' || Array.isArray(streaks)) streaks = {};
    return streaks;
  }
  function saveStreaks() { try { localStorage.setItem(SKEY, JSON.stringify(streaks || {})); } catch (e) {} }
  function mine() {
    var all = loadStreaks(), id = (Store.playlist && Store.playlist.id) || '';
    return all[id] || (all[id] = {});
  }
  function isMarked(v) { return !!(v && v[0] >= STREAK && now() - v[1] < RECENT); }
  function streak(k, name) {
    var m = mine(), v = m[k], t = now();
    // Failures days apart are not a streak: start again.
    v = v && t - v[1] < RECENT ? [v[0] + 1, t] : [1, t];
    var was = isMarked(m[k]);
    m[k] = v;
    var keys = Object.keys(m);
    if (keys.length > CAP) {
      keys.sort(function (a, b) { return m[a][1] - m[b][1]; });
      for (var i = 0; i < keys.length - CAP; i++) delete m[keys[i]];
    }
    saveStreaks();
    if (isMarked(v) && !was) { changed(k); if (typeof Log !== 'undefined') Log.info('app', '"' + (name || k) + '" is marked as not playing lately: its last ' + v[0] + ' tries failed'); }
  }
  function changed(k) { for (var i = 0; i < listeners.length; i++) try { listeners[i](k); } catch (e) {} }
  // Does this channel get the "not playing lately" mark?  Cheap: called for every row drawn.
  function marked(ch) {
    if (!ch) return false;
    var m = streaks ? streaks[(Store.playlist && Store.playlist.id) || ''] : mine();
    return !!m && isMarked(m[keyOf(ch)]);
  }

  // Five or more failed and at most one in five played.
  function bad(s) {
    var f = Object.keys(s.fails).length, o = Object.keys(s.ok).length;
    return f >= MIN && o * 4 <= f;
  }
  function noted(id) { try { return (JSON.parse(localStorage.getItem(KEY) || '{}') || {})[id] || 0; } catch (e) { return 0; } }
  function note(id) {
    try { var m = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; m[id] = Date.now(); localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }
  function codes(s) {
    var c = {};
    Object.keys(s.fails).forEach(function (k) { var h = s.fails[k]; c[h] = (c[h] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (h) { return h + (NAMES[h] ? ' ' + NAMES[h] : ''); });
  }
  var NAMES = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 410: 'Gone', 451: 'Unavailable here', 500: 'Server error', 502: 'Bad Gateway', 503: 'Unavailable', 504: 'Gateway Timeout', 520: 'Unknown error', 521: 'Server down', 522: 'Timed out', 523: 'Unreachable', 524: 'Timed out' };

  function check() {
    var p = Store.playlist || {}, s = forPl();
    if (!bad(s) || Date.now() - noted(p.id) < 24 * 3600e3) return;
    note(p.id);
    var f = Object.keys(s.fails).length, o = Object.keys(s.ok).length, exp = Library.data && Library.data.exp;
    var name = p.name || 'this playlist';
    Log.warn('app', 'Most channels in ' + name + ' fail: ' + f + ' did not play (' + codes(s).join(', ') + '), ' + o + ' played.  ' + (exp ? 'The account is active until ' + new Date(exp).toISOString().slice(0, 10) + '.' : ''));
    show(name, f, o, codes(s), exp, p.id);
  }
  function show(name, f, o, c, exp, id) {
    if (UI.modalOpen) return setTimeout(function () { show(name, f, o, c, exp, id); }, 4000);
    var why = 'The provider answered with errors (' + c.slice(0, 3).join(', ') + ') for ' + f + ' channels' + (o ? ', and only ' + o + ' played' : '') + '.  ' +
      (exp && exp > Date.now() ? 'The account is active until ' + new Date(exp).toLocaleDateString() + ', so' : 'This usually means') +
      ' the list itself may be out of date, or its channels only work from another country (with a VPN).';
    UI.panel('Most channels in ' + name + ' aren\'t playing', U.el('p', 'panel-text', why), [
      { label: 'OK' },
      { label: 'Reload the channel list', action: function () { App.refresh(true); } },
      { label: 'Playlist settings', action: function () { App.openPlaylistSettings(id); } }
    ]);
  }

  return { played: played, failed: failed, marked: marked, MIN: MIN, STREAK: STREAK, RECENT: RECENT,
    onChange: function (fn) { listeners.push(fn); },
    _reset: function () { seen = {}; streaks = null; } };
})();
if (typeof module !== 'undefined') module.exports = DeadList;
