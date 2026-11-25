/* Up next, full screen: when an episode plays to its end (or a movie of a collection you play), the next one fills
   the screen.  Its picture behind everything (the episode's own still, else the show's or movie's backdrop), the
   show's title as artwork from TMDB (its logo; the title in large type when it has none), the season and episode,
   the episode's title and a few lines of its summary.  Play counts down in a ring inside the button and starts it
   at 0; OK starts it at once; Back to episodes (or Back) stops the run.  Skip credits (skipper.js, a button or
   by itself) brings this up too, as if the file had ended.

   The countdown is Settings > Movies and shows > Up next countdown (5, 10, 15 or 20 seconds); with Play the next
   one automatically off there's no countdown and the screen waits for OK.  With Hide spoilers on, an episode you
   haven't seen shows the show's backdrop and no summary (the callers leave them out).

   Used by My media's shows (media-series.js), its collections (media.js) and the provider's series (vod.js).
     UpNext.show({ kicker, image, logo, show, line, title, desc, play, cancel, playLabel, cancelLabel, auto })
   image: the picture behind; logo: the show's title as artwork (TMDB), else show is set in large type.
   auto: false for a screen that only asks (an episode is missing before it).
     UpNext.hold() / UpNext.release(): the curtain (below), for callers between an ending and show(). */
var UpNext = (function () {
  'use strict';
  var timer = null, run = 0, RING = 2 * Math.PI * 20;

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  // The countdown in seconds; 0 when the next one doesn't start by itself.
  function seconds() {
    if (S().autoNext === false) return 0;
    var v = +S().upNextSecs;
    return v === 5 || v === 10 || v === 15 || v === 20 ? v : 10;
  }
  function stop() { clearInterval(timer); timer = null; run++; }
  function T(x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : String(x).replace(/\{([a-z]+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); }
  /* A TMDB picture asked for full screen at 1280 px: episode stills come at 500 px (a card's size), which looked
     blocky stretched across the TV.  Also through the helper's picture link, where the address is encoded. */
  var TMDB_SMALL = /(image\.tmdb\.org(?:\/|%2F)t(?:\/|%2F)p(?:\/|%2F))w(?:92|154|185|300|342|500|780)(?=\/|%2F)/i;
  function sharp(src) { return String(src || '').replace(TMDB_SMALL, '$1w1280'); }
  function pic(src, cls, gone, small) {
    var img = U.el('img', cls); img.decoding = 'async'; img.src = src;
    // The logo (gone given): no second try, the title in type takes its place at once.  A sharper copy (small given)
    // that doesn't load: the size it came in.  A picture: tried again through the helper first (Net.retryImage), as everywhere.
    img.onerror = function () {
      if (small && this.src !== small) { var s = small; small = null; this.src = s; return; }
      if (!gone && typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this, true)) return;
      this.remove(); if (gone) gone();
    };
    return img;
  }

  /* What's on the screen besides the buttons (UI.panel adds those and owns the keys: ◀ ▶ between them, OK, Back):
     the picture and its shade, and the words on the left. */
  function screen(o) {
    var box = U.el('div', 'un-screen');
    var bg = U.el('div', 'un-bg');
    if (o.image) bg.appendChild(pic(sharp(o.image), 'un-bgimg', null, sharp(o.image) !== o.image ? o.image : null));
    box.appendChild(bg);
    box.appendChild(U.el('div', 'un-shade'));
    var words = U.el('div', 'un-words');
    // The show's title: its logo art, or (none, or it doesn't load) the title in large type.
    var name = U.el('div', 'un-name');
    var typed = function () { name.innerHTML = ''; if (o.show) name.appendChild(U.el('div', 'un-showtitle', o.show)); };
    if (o.logo) name.appendChild(pic(o.logo, 'un-logo', typed)); else typed();
    words.appendChild(name);
    if (o.line) words.appendChild(U.el('div', 'un-line', o.line));
    if (o.title) words.appendChild(U.el('div', 'un-title', o.title));
    if (o.desc) words.appendChild(U.el('div', 'un-desc', o.desc));
    box.appendChild(words);
    return box;
  }
  // The Play button with its ring: the ring empties as the seconds go, and the label says how many are left.
  function ring(btn, secs) {
    btn.classList.add('un-has-ring');
    btn.innerHTML = '<svg class="un-ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="un-track" cx="24" cy="24" r="20"/><circle class="un-left" cx="24" cy="24" r="20"/><path class="un-tri" d="M20 16v16l12-8z"/></svg>';
    var label = U.el('span', 'un-play', T('Play in {n}', { n: secs }));
    btn.appendChild(label);
    var left = btn.querySelector('.un-left');
    if (left) { left.style.strokeDasharray = RING; left.style.strokeDashoffset = 0; }
    return function (n) { label.textContent = T('Play in {n}', { n: Math.max(0, n) }); if (left) left.style.strokeDashoffset = RING * (1 - n / secs); };
  }

  /* The curtain: a plain screen in Up next's own dark colour, over the pages and under menus.  It covers the gaps
     where the show's page used to flash by: from the end of an episode until Up next is ready (the next one is
     looked up first), and from Play until the player is fullscreen.  Fullscreen hides it (CSS), playing or an
     error takes it away, and it never stays longer than HOLD_MAX, so a lookup that fails can't leave it up. */
  var curtain = null, curtainTimer = null, HOLD_MAX = 10000, FADE = 300;   // FADE: a little over Up next's fade in (app.css unIn)
  function hold() {
    if (!curtain) {
      curtain = U.el('div', 'un-hold hidden');
      document.body.appendChild(curtain);
      if (typeof Player !== 'undefined' && Player.on) Player.on('state', function (st) { if (st === 'playing' || st === 'error') release(); });
    }
    curtain.classList.remove('hidden');
    clearTimeout(curtainTimer);
    curtainTimer = setTimeout(release, HOLD_MAX);
  }
  function release() {
    clearTimeout(curtainTimer); curtainTimer = null;
    if (curtain) curtain.classList.add('hidden');
  }

  /* Shows the screen for o and starts the countdown; at 0 the next one plays.  A screen closed any other way stops
     it, so nothing starts by itself later.  Play keeps the curtain up until the player takes over; going back
     takes it away. */
  function show(o) {
    stop();
    var secs = o.auto === false ? 0 : seconds(), mine = run, done = false;
    var body = screen(o);
    function finish(fn) { if (done) return; done = true; stop(); if (fn === o.play) hold(); else release(); if (fn) fn(); }
    var buttons = [{ label: o.playLabel || 'Play now', action: function () { finish(o.play); } }, { label: o.cancelLabel || 'Back to episodes', action: function () { finish(o.cancel); } }];
    UI.panel(o.kicker || 'Up next', body, buttons, function () { finish(o.cancel); }, { look: 'upnext' });
    /* Up next covers the screen once it has faded in (unIn, 0.25 s): the curtain stays until then, or the page showed
       through the fade.  Not if it was closed meanwhile (Play puts the curtain up again). */
    setTimeout(function () { if (mine === run) release(); }, FADE);
    if (!secs) return;
    var btn = body.parentNode && body.parentNode.querySelector('.mbtns .btn'), paint = btn ? ring(btn, secs) : function () {};
    var left = secs;
    timer = setInterval(function () {
      // Closed some other way (another menu over it, a channel started): nothing starts by itself.
      if (mine !== run || !document.body.contains(body)) { if (mine === run) stop(); return; }
      left--;
      paint(left);
      if (left <= 0) { hold(); UI.close(); finish(o.play); }
    }, 1000);
  }

  return { show: show, stop: stop, seconds: seconds, hold: hold, release: release, _sharp: sharp };
})();
