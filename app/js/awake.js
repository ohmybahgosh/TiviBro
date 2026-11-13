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
   refusal is logged.  On by default, no setting.
   Two grace periods (issue #58): the screensaver also waits for 90 seconds after something last played,
   so a reconnect or a channel that fails over to the next isn't "nothing playing", and for 3 minutes
   after the last button press, as presses from the phone app reach TiviBro but not the TV's idle timer. */
var Awake = (function () {
  'use strict';
  var BASE = 'tivibro', NAME = BASE, retried = false, SVC = 'luna://com.webos.service.tvpower/power/';
  var ACTIVE = { playing: 1, loading: 1, buffering: 1 };
  var sub = null, state = 'off', why = '', refused = 0, allowed = 0, lastAsk = 0, pending = [];
  var PLAY_GRACE = 90e3, INPUT_GRACE = 180e3, playedAt = 0, inputAt = 0, wasBusy = false;

  /* Should the screensaver wait?  p: { current, state, userPaused }, hidden: TiviBro in the background.
     A pure function, for the tests. */
  function busy(p, hidden) {
    if (!p || hidden || !p.current || p.userPaused) return false;
    return !!ACTIVE[p.state];
  }
  /* The answer, with the grace periods: what busy() says, or something played in the last 90 seconds, or a
     button was pressed in the last 3 minutes.  Never while TiviBro is in the background.  Pure, for the tests. */
  function wait(p, hidden, now, played, input) {
    if (hidden) return false;
    if (busy(p, false)) return true;
    var paused = !!(p && p.current && p.userPaused);
    return (!paused && played > 0 && now - played < PLAY_GRACE) || (input > 0 && now - input < INPUT_GRACE);
  }
  // The player changed state: remember when it was last playing, loading or buffering.
  function onPlayer() {
    var b = busy(playerNow(), false);
    if (b || wasBusy) playedAt = Date.now();
    wasBusy = b;
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
      /* A TiviBro page that started a moment ago (webOS often starts the app twice in a second) still holds
         the name: register again under a name of this page's own, rather than going without (the screensaver
         then came on over a channel playing). */
      if (/already registered/i.test(String(r.errorText || '')) && !retried) {
        retried = true; NAME = BASE + '.' + (Date.now() % 1000000).toString(36);
        log('info', 'The TV still had the screensaver request of an earlier start; asking again');
        sub = null; start(); return;
      }
      state = 'refused'; why = String(r.errorText || r.errorCode || 'refused');
      log('warn', 'The TV would not let TiviBro hold off its screensaver: ' + why);
      return;
    }
    if (state !== 'on') { state = 'on'; why = ''; log('info', 'The TV will ask before its screensaver starts: TiviBro holds it off only while something plays'); }
    if (r.timestamp == null) return;
    lastAsk = Date.now();
    var p = playerNow(), now = Date.now(), hid = hiddenNow(), playing = busy(p, hid);
    if (playing) playedAt = now;
    var no = wait(p, hid, now, playedAt, inputAt);
    if (no) {
      refused++;
      var ch = p && p.current, what = ch && (ch.n || ch.title) ? '"' + (ch.n || ch.title) + '"' : 'a video';
      log('info', 'Screensaver held off: ' + (playing ? what + ' is playing (' + p.state + ')' : now - inputAt < INPUT_GRACE ? 'TiviBro is in use (a button ' + Math.round((now - inputAt) / 1000) + ' s ago)' : 'something played ' + Math.round((now - playedAt) / 1000) + ' s ago'));
    } else { allowed++; log('info', 'Screensaver allowed: nothing playing' + (hid ? ' (TiviBro in the background)' : '')); }
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

  /* Typing (the TV's own keyboard, or the phone filling a box) and the Magic Remote's pointer count as use too,
     not only buttons: they never reach the TV's idle timer as a press. */
  var seen = 0;
  function used() { var t = Date.now(); if (t - seen > 2000) { seen = t; inputAt = t; } }
  function start() {
    if (!start.listening && typeof document !== 'undefined' && document.addEventListener) {
      start.listening = true;
      ['input', 'mousemove', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, used, true); });
    }
    if (sub) return;
    if (!start.hooked && typeof Player !== 'undefined' && Player.on) { start.hooked = true; Player.on('state', onPlayer); }
    sub = bridge();
    if (!sub) { state = 'unavailable'; return; }        // a desktop browser, the simulator
    state = 'starting';
    sub.onservicecallback = onMessage;                 // the reference stays in `sub`, or the subscription ends
    try { sub.call(SVC + 'registerScreenSaverRequest', JSON.stringify({ subscribe: true, clientName: NAME })); }
    catch (e) { state = 'refused'; why = e.message; log('warn', 'Could not ask the TV about its screensaver: ' + e.message); }
  }

  return {
    start: start, busy: busy, wait: wait, _message: onMessage,
    touch: function () { inputAt = Date.now(); },        // a button pressed (the remote or the phone app)
    _reset: function () { sub = null; NAME = BASE; retried = false; state = 'off'; why = ''; refused = allowed = lastAsk = 0; pending = []; playedAt = inputAt = 0; wasBusy = false; },
    _player: onPlayer,
    get status() { return { state: state, why: why, refused: refused, allowed: allowed, lastAsk: lastAsk }; }
  };
})();
if (typeof module !== 'undefined') module.exports = Awake;
