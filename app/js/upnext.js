/* Up next, as on Plex: when an episode ends (or a movie of a collection you play), a card in the corner shows
   what comes next, with its picture (the episode's still, else the show's or movie's art), the show, its season
   and episode, its title and a line of its summary, and counts down to it.  OK (Play now) starts it at once,
   Back (or Cancel) stops the run.  The countdown is Settings > Movies and shows > Up next countdown (5, 10, 15 or
   20 seconds; Play the next one automatically off: no countdown, the card waits).  With Hide spoilers on, an
   episode you haven't seen shows the show's art and no summary.

   Used by My media's shows (media-series.js), its collections (media.js) and the provider's series (vod.js).
     UpNext.show({ kicker, image, still, show, line, title, desc, play, cancel, playLabel, cancelLabel, auto })
   image: the picture's address; still: true when it's an episode's own frame (16:9), else it's art and is
   shown covering the box.  auto: false for a card that only asks (a missing episode). */
var UpNext = (function () {
  'use strict';
  var timer = null, run = 0;

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  // The countdown in seconds; 0 when the next one doesn't start by itself.
  function seconds() {
    if (S().autoNext === false) return 0;
    var v = +S().upNextSecs;
    return v === 5 || v === 10 || v === 15 || v === 20 ? v : 10;
  }
  function stop() { clearInterval(timer); timer = null; run++; }
  function T(x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : x; }

  /* The card's picture and words: built here and handed to UI.panel, which owns the keys (◀ ▶ between Play now
     and Cancel, OK, Back). */
  function card(o, secs) {
    var box = U.el('div', 'un-card');
    var art = U.el('div', 'un-art' + (o.still ? '' : ' cover'));
    if (o.image) {
      var img = U.el('img'); img.decoding = 'async'; img.src = o.image;
      img.onerror = function () { if (!(typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this, true))) this.remove(); };
      art.appendChild(img);
    }
    box.appendChild(art);
    var words = U.el('div', 'un-words');
    if (o.show) words.appendChild(U.el('div', 'un-show', o.show));
    if (o.line) words.appendChild(U.el('div', 'un-line', o.line));
    if (o.title) words.appendChild(U.el('div', 'un-title', o.title));
    if (o.desc) words.appendChild(U.el('div', 'un-desc', o.desc));
    var count = U.el('div', 'un-count');
    if (secs) {
      // A ring that empties as the seconds go, with the seconds left in it.
      count.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="un-track" cx="22" cy="22" r="19"/><circle class="un-left" cx="22" cy="22" r="19"/></svg>';
      count.appendChild(U.el('b', 'un-n', String(secs)));
      count.appendChild(U.el('span', 'un-in', T('Playing in {n} seconds', { n: secs })));
    }
    words.appendChild(count);
    box.appendChild(words);
    return box;
  }

  /* Shows the card for o (see the top of this file) and starts the countdown: the ring empties a second at a time
     and, at 0, the next one plays.  A card closed any other way stops it, so nothing starts by itself later. */
  function show(o) {
    stop();
    var secs = o.auto === false ? 0 : seconds(), mine = run, done = false;
    var body = card(o, secs);
    function finish(fn) { if (done) return; done = true; stop(); if (fn) fn(); }
    var buttons = [{ label: o.playLabel || 'Play now', action: function () { finish(o.play); } }, { label: o.cancelLabel || 'Cancel', action: function () { finish(o.cancel); } }];
    UI.panel(o.kicker || 'Up next', body, buttons, function () { finish(o.cancel); }, { look: 'upnext' });
    if (!secs) return;
    var left = secs, ring = body.querySelector('.un-left'), n = body.querySelector('.un-n'), said = body.querySelector('.un-in');
    var C = 2 * Math.PI * 19;
    if (ring) { ring.style.strokeDasharray = C; ring.style.strokeDashoffset = 0; }
    timer = setInterval(function () {
      // Closed some other way (another menu over it, a channel started): nothing starts by itself.
      if (mine !== run || !document.body.contains(body)) { if (mine === run) stop(); return; }
      left--;
      if (ring) ring.style.strokeDashoffset = C * (1 - left / secs);
      if (n) n.textContent = String(Math.max(0, left));
      if (said) said.textContent = T('Playing in {n} seconds', { n: Math.max(0, left) });
      if (left <= 0) { UI.close(); finish(o.play); }
    }, 1000);
  }

  return { show: show, stop: stop, seconds: seconds };
})();
