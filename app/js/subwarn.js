/* A warning on the TV before a provider's subscription ends, and once it has ended.

   Each playlist knows when its subscription ends (p.exp, from the provider's login answer: Xtream Codes'
   exp_date, a Stalker portal's end date; Store.expiry words it for Settings).  A few seconds after the
   start, and every 6 hours while TiviBro runs, each playlist that is on is looked at: ending within
   Settings > Playlists and accounts > Warn before a subscription ends (3 days by default; Off turns it off),
   or already ended, gets a message, at most once a day per playlist and never over something else on
   screen (Update.whenFree waits for a quiet moment).  "Not for this playlist" stops it for that playlist
   until its end date changes (a renewal moves it, and the warnings come back for the new date).
   SubWarn.due(now) is the pure part: which playlists to warn about now (tests call it). */
var SubWarn = (function () {
  'use strict';
  var DAY = 86400000, EVERY = 6 * 3600000, T = function (s, v) { return I18n.t(s, v); };
  var timer = null;

  // The day as a key for "once a day" (the TV's own time zone).
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* The playlists to warn about at [now]: on, with an end date, ending within the setting's days (or ended
     less than 30 days ago: an old dead playlist isn't nagged about forever), not told today, and not muted
     for this end date.  Each is { p, days } with days left (0 today, below 0 ended). */
  function due(now) {
    var s = Store.settings, within = +s.subWarnDays, out = [];
    if (!(within > 0)) return out;
    (s.playlists || []).forEach(function (p) {
      var t = +p.exp;
      if (!t || p.off) return;
      var days = Math.ceil((t - now) / DAY);
      if (days > within || days < -30) return;
      if (p.subWarnMuted === t) return;
      if ((s.subWarned || {})[p.id] === dayKey(now)) return;
      out.push({ p: p, days: days });
    });
    return out;
  }

  // The message for one playlist: its name, when it ends (or ended), and what to do.
  function text(x) {
    var name = x.p.name || (x.p.type === 'xtream' ? x.p.user : 'M3U'), when = new Date(+x.p.exp).toLocaleDateString(U.loc ? U.loc() : undefined, { day: 'numeric', month: 'long' });
    if (x.days < 0) return T('The subscription for {x} ended on {y}.  Its channels may stop playing until you renew it with your provider.', { x: name, y: when });
    if (x.days === 0) return T('The subscription for {x} ends today.  Renew it with your provider to keep watching.', { x: name });
    var v = { x: name, n: x.days, y: when };
    return x.days === 1 ? T('The subscription for {x} ends in {n} day ({y}).  Renew it with your provider to keep watching.', v) : T('The subscription for {x} ends in {n} days ({y}).  Renew it with your provider to keep watching.', v);
  }

  // Told today: kept per playlist, so another day (or another playlist) can still be told.
  function told(p, now) {
    var s = Store.settings;
    s.subWarned = s.subWarned || {};
    s.subWarned[p.id] = dayKey(now);
    Store.saveSettings();
  }

  // One message at a time, the next one after it's closed.
  function show(list) {
    var x = list.shift();
    if (!x) return;
    told(x.p, Date.now());
    Log.info('subwarn', 'Told the subscription for ' + (x.p.name || 'a playlist') + (x.days < 0 ? ' ended ' + (-x.days) + ' days ago' : ' ends in ' + x.days + ' days'));
    var box = U.el('div', '');
    box.appendChild(U.el('p', 'panel-text', text(x)));
    UI.panel(x.days < 0 ? T('Subscription ended') : T('Subscription ends soon'), box, [
      { label: 'OK', action: function () { setTimeout(function () { show(list); }, 600); } },
      { label: 'Not for this playlist', action: function () { x.p.subWarnMuted = +x.p.exp; Store.saveSettings(); setTimeout(function () { show(list); }, 600); } }
    ], function () { setTimeout(function () { show(list); }, 600); });
  }

  // A look now: anything due waits for a quiet moment on screen, then shows.
  function check() {
    var list = due(Date.now());
    if (!list.length) return;
    var go = function () { show(due(Date.now())); };      // asked again: a renewal may have come meanwhile
    if (typeof Update !== 'undefined' && Update.whenFree) Update.whenFree(go); else go();
  }

  // From the start (app.js): a first look once the playlists have loaded, then every 6 hours.
  function start() {
    clearInterval(timer);
    setTimeout(check, 20000);
    timer = setInterval(check, EVERY);
  }

  return { start: start, check: check, due: due, text: text };
})();
