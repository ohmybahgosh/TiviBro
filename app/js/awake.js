/* Keeps the TV's screensaver away while something plays (issue #37).  webOS starts its screensaver
   when no remote button has been pressed for a while, even over video in a web app, so a channel or a
   movie ends up behind the screensaver (or behind a black screen with text, with a homebrew one such as
   Aerial).  The TV's power service asks every app that registered whether it may start:
     luna://com.webos.service.tvpower/power/registerScreenSaverRequest  { subscribe, clientName }
   sends a message with a timestamp when it is about to, and the app answers
     luna://com.webos.service.tvpower/power/responseScreenSaverRequest  { clientName, ack, timestamp }
   ack: false holds it off, ack: true lets it start.  The same calls Kodi, Moonlight and other webOS apps
   use; developer-mode web apps may make them, so no helper and no extra permission are needed.  webOS 4
   leaves out the message's "state" field, so any message with a timestamp is a question.

   TiviBro says no while live TV, a movie or episode, My media or catch-up plays (also while it loads or
   buffers), and yes when nothing plays, playback is paused, or TiviBro is in the background.  Each
   refusal is logged.  On by default, no setting. */
var Awake = (function () {
  'use strict';
  var NAME = 'tivibro', SVC = 'luna://com.webos.service.tvpower/power/';
  var ACTIVE = { playing: 1, loading: 1, buffering: 1 };
  var sub = null, state = 'off', why = '', refused = 0, allowed = 0, lastAsk = 0, pending = [];

  /* Should the screensaver wait?  p: { current, state, userPaused }, hidden: TiviBro in the background.
     A pure function, for the tests. */
  function busy(p, hidden) {
    if (!p || hidden || !p.current || p.userPaused) return false;
    return !!ACTIVE[p.state];
  }
  function playerNow() {
    if (typeof Player === 'undefined') return null;
    return { current: Player.current, state: Player.state, userPaused: Player.userPaused };
  }
  function hiddenNow() { return typeof document !== 'undefined' && !!document.hidden; }

  function bridge() { return typeof PalmServiceBridge !== 'undefined' ? new PalmServiceBridge() : null; }
  function log(lv, msg) { if (typeof Log !== 'undefined' && Log[lv]) Log[lv]('app', msg); }

  // One message from the power service: the answer to registering, an error, or a question.
  function onMessage(msg) {
    var r = msg;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
    if (!r) return;
    if (r.returnValue === false) {
      state = 'refused'; why = String(r.errorText || r.errorCode || 'refused');
      log('warn', 'The TV would not let TiviBro hold off its screensaver: ' + why);
      return;
    }
    if (state !== 'on') { state = 'on'; why = ''; log('info', 'Holding off the TV screensaver while something plays'); }
    if (r.timestamp == null) return;
    lastAsk = Date.now();
    var p = playerNow(), no = busy(p, hiddenNow());
    if (no) {
      refused++;
      var ch = p.current, what = ch && (ch.n || ch.title) ? '"' + (ch.n || ch.title) + '"' : 'a video';
      log('info', 'Screensaver held off: ' + what + ' is playing (' + p.state + ')');
    } else allowed++;
    respond(r.timestamp, !no);
  }
  function respond(timestamp, ack) {
    var b = bridge();
    if (!b) return;
    // A bridge per call: calling again on the subscription's bridge would end the subscription.
    pending.push(b);
    b.onservicecallback = function () { var i = pending.indexOf(b); if (i >= 0) pending.splice(i, 1); };
    try { b.call(SVC + 'responseScreenSaverRequest', JSON.stringify({ clientName: NAME, ack: ack, timestamp: timestamp })); }
    catch (e) { log('warn', 'Could not answer the TV screensaver: ' + e.message); }
  }

  function start() {
    if (sub) return;
    sub = bridge();
    if (!sub) { state = 'unavailable'; return; }        // a desktop browser, the simulator
    state = 'starting';
    sub.onservicecallback = onMessage;                 // the reference stays in `sub`, or the subscription ends
    try { sub.call(SVC + 'registerScreenSaverRequest', JSON.stringify({ subscribe: true, clientName: NAME })); }
    catch (e) { state = 'refused'; why = e.message; log('warn', 'Could not ask the TV about its screensaver: ' + e.message); }
  }

  return {
    start: start, busy: busy, _message: onMessage,
    _reset: function () { sub = null; state = 'off'; why = ''; refused = allowed = lastAsk = 0; pending = []; },
    get status() { return { state: state, why: why, refused: refused, allowed: allowed, lastAsk: lastAsk }; }
  };
})();
if (typeof module !== 'undefined') module.exports = Awake;
