/* What playback learns, kept across restarts (localStorage tivibro.playMemo, not in backups).

   Per channel (per playlist): the pipeline that last played it when that was not the usual first choice
   (a channel that only plays as HLS, or only on the TV's player, starts that way at once instead of
   spending seconds on the others), and the extra cushion it earned by running dry (so it doesn't have to
   run dry again before the cushion grows).  At most 1,500 channels, the least recently used go first,
   and anything not seen for 30 days.

   Per provider (the stream address's host): how often its channels run dry for each hour watched.  The
   Automatic buffer profile (player.js) starts channels fast on a steady provider and holds a bigger
   cushion on a shaky one.  The counts are halved every 20 hours watched, so it follows a provider that
   changes. */
var PlayMemo = (function () {
  'use strict';
  var KEY = 'tivibro.playMemo', CAP = 1500, OLD = 30 * 86400e3, HOSTS = 50, HALF = 20 * 3600e3, SAVE_MS = 3000;
  var data = null, timer = 0;
  // Automatic: the start-up buffer and the rest of the profile, by how often a provider's channels run dry.
  var LEVELS = [
    { max: 0.5, why: 'steady',       prebuffer: 0.8, ahead: 30, back: 8,  stall: 6,  retries: 8,  stash: 256 },
    { max: 3,   why: 'a few hiccups', prebuffer: 2,   ahead: 30, back: 8,  stall: 6,  retries: 8,  stash: 384 },
    { max: 8,   why: 'shaky',        prebuffer: 4,   ahead: 45, back: 10, stall: 8,  retries: 10, stash: 768 },
    { max: 1e9, why: 'very shaky',   prebuffer: 6,   ahead: 60, back: 12, stall: 10, retries: 12, stash: 1536 }
  ];
  // Until a provider has shown how steady it is: exactly Balanced, the old default.
  var LEARNING = { why: 'still learning', prebuffer: 2, ahead: 30, back: 8, stall: 6, retries: 8, stash: 384 };
  // Enough to judge a provider: a few channel starts and a quarter of an hour watched.
  var MIN_STARTS = 3, MIN_MS = 15 * 60000;

  function now() { return Date.now(); }
  function load() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
    if (!data || data.v !== 1) data = { v: 1, ch: {}, h: {} };
    return data;
  }
  function save() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      trim();
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }, SAVE_MS);
  }
  function trim() {
    var d = load(), t = now(), keys = Object.keys(d.ch);
    keys.forEach(function (k) { if (t - d.ch[k][2] > OLD) delete d.ch[k]; });
    keys = Object.keys(d.ch);
    if (keys.length > CAP) keys.sort(function (a, b) { return d.ch[a][2] - d.ch[b][2]; }).slice(0, keys.length - CAP).forEach(function (k) { delete d.ch[k]; });
    var hs = Object.keys(d.h);
    if (hs.length > HOSTS) hs.sort(function (a, b) { return d.h[a].t - d.h[b].t; }).slice(0, hs.length - HOSTS).forEach(function (k) { delete d.h[k]; });
  }
  function chKey(ch) {
    var k = ch && (ch.k || ch.id || ch.n);
    // Another playlist's channel (several playlists on) already has "<its playlist id>:" in its key.
    if (k && ch.p && ch.k) return ch.k;
    return k ? ((Store.playlist && Store.playlist.id) || '') + ':' + k : '';
  }
  // [engine, extra cushion in seconds, last used, HLS picture height it played at]
  function entry(ch, create) {
    var k = chKey(ch), d = load();
    if (!k) return null;
    if (!d.ch[k] && create) d.ch[k] = ['', 0, now()];
    return d.ch[k] || null;
  }

  /** What this channel needed last time: { engine: 'hls' | 'native' | 'ts' | '', boost: seconds }. */
  function get(ch) {
    var e = entry(ch);
    if (!e || now() - e[2] > OLD) return { engine: '', boost: 0 };
    return { engine: e[0] || '', boost: +e[1] || 0 };
  }
  /** The channel played on [kind]; [usual] is what would have been tried first.  Only an unusual one is kept. */
  function worked(ch, kind, usual) {
    var want = kind && kind !== usual ? kind : '', e = entry(ch, !!want);
    if (!e) return;
    if (e[0] === want && now() - e[2] < 86400e3) return;
    e[0] = want; e[2] = now();
    if (!e[0] && !e[1] && !e[3]) delete load().ch[chKey(ch)];
    save();
  }
  /** The extra cushion this channel has now (0 once it has calmed down). */
  function boost(ch, secs) {
    secs = Math.round((+secs || 0) * 10) / 10;
    var e = entry(ch, secs > 0);
    if (!e || (e[1] === secs && now() - e[2] < 86400e3)) return;
    e[1] = secs; e[2] = now();
    if (!e[0] && !e[1] && !e[3]) delete load().ch[chKey(ch)];
    save();
  }

  /** An HLS channel's picture height last time (1080, 720...), so it starts there, not low and climbing. */
  function level(ch) { var e = entry(ch); return e && now() - e[2] < OLD ? +e[3] || 0 : 0; }
  function setLevel(ch, height) {
    height = +height || 0;
    var e = entry(ch, height > 0);
    if (!e || (+e[3] === height && now() - e[2] < 86400e3)) return;
    e[3] = height; e[2] = now();
    save();
  }

  function host(h) {
    var d = load();
    if (!h) return null;
    var x = d.h[h] || (d.h[h] = { n: 0, d: 0, ms: 0, t: now() });
    x.t = now();
    return x;
  }
  /** A channel from this provider started playing. */
  function started(h) { var x = host(h); if (x) { x.n++; save(); } }
  /** One of its channels ran dry while playing. */
  function ranDry(h) { var x = host(h); if (x) { x.d++; save(); } }
  /** [ms] more of it watched.  Called often with small amounts; saved with the rest. */
  function watched(h, ms) {
    var x = host(h);
    if (!x || !(ms > 0) || ms > 60000) return;
    x.ms += ms;
    if (x.ms > HALF) { x.ms /= 2; x.d /= 2; x.n = Math.max(Math.min(x.n, MIN_STARTS), Math.ceil(x.n / 2)); }
    save();
  }
  /** How often this provider runs dry, per hour watched, or null until there is enough to judge. */
  function dryRate(h) {
    var x = h && load().h[h];
    if (!x || x.n < MIN_STARTS || x.ms < MIN_MS) return null;
    return x.d / (x.ms / 3600e3);
  }
  /** The Automatic profile for this provider: the buffer numbers, and why (for Profile details and Stream info). */
  function auto(h) {
    var r = dryRate(h), lv = LEARNING;
    if (r != null) for (var i = 0; i < LEVELS.length; i++) if (r < LEVELS[i].max) { lv = LEVELS[i]; break; }
    var p = {};
    for (var k in lv) if (k !== 'max') p[k] = lv[k];
    p.rate = r;
    return p;
  }
  /** Profile details for Settings: the providers TiviBro knows, most watched first. */
  function summary() {
    var d = load();
    return Object.keys(d.h).map(function (h) { var a = auto(h); return { host: h, why: a.why, prebuffer: a.prebuffer, hours: d.h[h].ms / 3600e3, dry: d.h[h].d }; })
      .sort(function (a, b) { return b.hours - a.hours; });
  }
  /** Forget everything (Settings > Playback). */
  function reset() { data = { v: 1, ch: {}, h: {} }; try { localStorage.removeItem(KEY); } catch (e) {} }
  /** For tests: write now. */
  function flush() { if (timer) { clearTimeout(timer); timer = 0; } trim(); try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {} }

  return { get: get, worked: worked, boost: boost, level: level, setLevel: setLevel, started: started, ranDry: ranDry, watched: watched, dryRate: dryRate, auto: auto,
    summary: summary, reset: reset, flush: flush, LEVELS: LEVELS, LEARNING: LEARNING };
})();
