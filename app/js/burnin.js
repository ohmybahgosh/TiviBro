/* Burn-in protection for OLED TVs (Settings > Appearance > Burn-in protection).  The guide, the menus and
   the side menu sit in the same place for hours when the TV is left on a screen: every 90 seconds they
   move a few pixels (a small circle around where they belong, never more than 4 pixels), and after 10
   minutes without a key press everything but the picture dims; the first key brings it back (and does
   nothing else).  Fullscreen video is left alone: the picture moves by itself, and the TV has its own
   protection for that.  The video in the guide's window is not moved either (moving it costs the TV's
   video plane). */
var Burnin = (function () {
  'use strict';
  var SHIFT_MS = 90000, DIM_MS = 10 * 60000;
  var ORBIT = [[0, 0], [3, 1], [4, -2], [1, -4], [-2, -3], [-4, 0], [-3, 3], [0, 4], [2, 2]];
  var step = 0, last = Date.now(), dimmed = false, timer = null, veil = null;

  function mode() { var m = typeof Store !== 'undefined' && Store.settings && Store.settings.burnin; return m === 'shift' || m === 'off' ? m : 'on'; }
  function full() { return document.body.classList.contains('full'); }
  function targets() { return ['app', 'sidenav', 'clock'].map(function (id) { return document.getElementById(id); }).filter(Boolean); }
  function place(dx, dy) { var t = dx || dy ? 'translate(' + dx + 'px,' + dy + 'px)' : ''; targets().forEach(function (e) { if (e.style.transform !== t) e.style.transform = t; }); }
  function shift() {
    if (mode() === 'off' || full()) return place(0, 0);
    step = (step + 1) % ORBIT.length;
    place(ORBIT[step][0], ORBIT[step][1]);
  }
  function setDim(on) {
    if (on === dimmed) return;
    dimmed = on;
    if (!veil) { veil = document.createElement('div'); veil.id = 'burnVeil'; veil.className = 'burn-veil'; document.body.appendChild(veil); }
    veil.classList.toggle('on', on);
  }
  function tick() {
    shift();
    if (mode() === 'on' && !full() && Date.now() - last > DIM_MS) setDim(true);
    else if (full() || mode() !== 'on') setDim(false);
  }
  // A key or the pointer: awake again.  True when this key only woke the screen (the caller drops it).
  function activity() {
    last = Date.now();
    if (dimmed) { setDim(false); return true; }
    return false;
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, SHIFT_MS);
    // Dimming is checked more often than the shift, so it comes on close to 10 minutes.
    setInterval(function () { if (mode() === 'on' && !dimmed && !full() && Date.now() - last > DIM_MS) setDim(true); }, 15000);
    document.addEventListener('mousemove', function () { activity(); }, true);
  }
  return { start: start, activity: activity, isDimmed: function () { return dimmed; }, _tick: tick };
})();
