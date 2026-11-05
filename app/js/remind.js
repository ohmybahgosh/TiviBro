/* Reminders outside the app: hands the reminders to the helper (service/remind.js), which shows a
   webOS alert at reminder time even while TiviBro is closed or another input is on, and opens
   TiviBro on the channel when Watch is pressed.  Also tells the helper whether TiviBro is on
   screen, so the TV never shows the same reminder twice. */
var Remind = (function () {
  'use strict';
  var L = Library, lastSig = '', timer = 0;

  function bridge() { return typeof PalmServiceBridge !== 'undefined' ? new PalmServiceBridge() : null; }
  function luna(method, params) {
    var b = bridge();
    if (!b) return false;
    b.onservicecallback = function (msg) {
      try { var j = JSON.parse(msg); if (j.returnValue === false) Log.warn('remind', method + ' failed: ' + (j.errorText || j.errorCode)); else if (method === 'reminders') Log.debug('remind', 'Helper has ' + j.count + ' reminder(s), ' + j.scheduled + ' newly scheduled'); } catch (e) {}
    };
    b.call('luna://app.tivibro.tv.service/' + method, JSON.stringify(params));
    return true;
  }

  function list() {
    var now = Date.now();
    return (Store.edits.reminders || []).filter(function (r) { return r.e > now; }).map(function (r) {
      var c = L.find(r.k);
      return { k: r.k, s: r.s, e: r.e, t: r.t, ch: c ? L.name(c) : '' };
    });
  }
  // Send when the list (or how early to remind) changed; cheap to call often.
  function sync(force) {
    var l = list(), before = +Store.settings.remindBefore || 0;
    var sig = Store.settings.active + '|' + before + '|' + l.map(function (r) { return r.k + '@' + r.s; }).join(',');
    if (!force && sig === lastSig) return;
    if (luna('reminders', { pid: Store.settings.active, before: before, list: l, visible: !document.hidden })) lastSig = sig;
  }
  function visible() { luna('visible', { visible: !document.hidden }); }

  /* Opened from the TV's alert: launch params { reminder: { pid, k, s } }. */
  function params(raw) {
    var p = raw;
    if (typeof p === 'string') { try { p = JSON.parse(p || '{}'); } catch (e) { p = {}; } }
    return p && p.reminder && p.reminder.k ? p.reminder : null;
  }
  function launchParams() {
    var sys = window.webOSSystem || window.PalmSystem;
    return params(sys && sys.launchParams);
  }

  function start() {
    sync(true);
    clearInterval(timer);
    timer = setInterval(function () { sync(false); }, 5000);
    document.addEventListener('visibilitychange', function () { visible(); if (!document.hidden) sync(false); });
  }

  /* Every reminder still to come (Settings > Reminders and watchlist, the phone's Reminders, the web
     editor), soonest first: the channel's name and logo, the programme, and what set it (w: a
     watchlist word or team, empty when you set it yourself). */
  function list(now) {
    now = now || Date.now();
    // The channel's name is kept on the reminder too (cn), for the phone asking while the TV is still
    // loading its channels, when no channel can be found yet.
    var named = false, have = typeof Library !== 'undefined' && Library.count() > 0;
    var out = (Store.edits.reminders || []).filter(function (r) { return r && r.e > now; }).sort(function (a, b) { return a.s - b.s; }).map(function (r) {
      var c = have ? Library.find(r.k) : null, n = c ? Library.name(c) : '';
      if (c && r.cn !== n) { r.cn = n; named = true; }
      return { k: r.k, ch: n || r.cn || (have ? 'Channel not in this playlist' : 'Channels still loading'), logo: c && typeof Views !== 'undefined' && Views.logoOf ? Views.logoOf(c) || '' : '', s: r.s, e: r.e, t: r.t || '', w: r.w || '', live: r.s <= now ? 1 : 0 };
    });
    if (named) Store.saveEdits();
    return out;
  }
  function cancel(k, s) {
    var rem = Store.edits.reminders || [], i = rem.findIndex(function (r) { return r.k === k && r.s === s; });
    if (i < 0) return false;
    rem.splice(i, 1); Store.saveEdits(); sync(true); return true;
  }
  function clear() { var rem = Store.edits.reminders || []; rem.splice(0, rem.length); Store.saveEdits(); sync(true); }
  return { start: start, sync: sync, params: params, launchParams: launchParams, list: list, cancel: cancel, clear: clear };
})();
