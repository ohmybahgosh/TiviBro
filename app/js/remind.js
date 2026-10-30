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

  return { start: start, sync: sync, params: params, launchParams: launchParams };
})();
