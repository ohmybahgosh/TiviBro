/* Skip intro, and Up next at the credits, in movies and episodes from files (My media, the provider's movies and
   shows), from the file's own chapters (seekprev.js reads them through the TiviBro service).

   - A chapter named Intro, Opening (credits), Recap or Previously on: while it plays, a "Skip intro" button in
     the bottom right corner.  OK skips to the chapter's end, Back hides it.
   - The credits: a chapter named Credits, End credits or End titles in the last fifth of the file.  An "Up next" card: OK goes straight to the next episode, or the
     next movie of a collection you're playing (the same as when the file ends), Back hides it and the file plays
     on.  Not for a movie with nothing after it.
   Nothing is guessed: a file without such chapters shows neither.  Settings > Playback > Skip intro and Up next
   turns both off. */
var Skipper = (function () {
  'use strict';
  var INTRO = /^\s*(intro|introduction|opening( credits| titles| theme)?|recap|previously( on)?|cold open)\b/i;
  var CREDITS = /\b(end(ing)? credits|credits|end titles|closing( credits)?|outro)\b/i;
  var chaps = [], box = null, shown = '', hidden = {}, bound = false;

  function on() { return !(typeof Store !== 'undefined' && Store.settings && Store.settings.skipIntro === false); }
  function video() { return document.getElementById('video'); }
  function chapters(list) { chaps = list || []; hidden = {}; hide(); bind(); }
  function bind() {
    if (bound) return; var v = video(); if (!v) return;
    bound = true;
    v.addEventListener('timeupdate', tick);
  }
  function el() {
    if (box) return box;
    box = U.el('div', 'skipper hidden'); document.body.appendChild(box);
    return box;
  }
  function hide() { if (box) box.classList.add('hidden'); shown = ''; }

  // What's next after this file: 'episode' (My media or a provider's episode), 'collection', or ''.
  function nextKind() {
    if (typeof Views === 'undefined' || Views.mode !== 'vod') return '';
    var meta = Views.vodMeta;
    if (meta && meta.local && typeof Media !== 'undefined' && Media.upNext) return Media.upNext();
    return meta && meta.seriesKey ? 'episode' : '';   // a provider's episode (vod.js plays the next one when it ends)
  }
  function introAt(t) { for (var i = 0; i < chaps.length; i++) { var c = chaps[i]; if (INTRO.test(c.t || '') && c.e - c.s >= 10 && c.e - c.s <= 600 && t >= c.s + 0.5 && t < c.e - 3) return c; } return null; }
  function creditsStart(d) {
    for (var i = 0; i < chaps.length; i++) { var c = chaps[i]; if (CREDITS.test(c.t || '') && c.s >= d * 0.8 && c.s < d - 5) return c.s; }
    return -1;   // only where the file marks its credits: no guessing
  }
  function tick() {
    var v = video();
    if (!v || !on() || typeof Views === 'undefined' || Views.mode !== 'vod' || !document.body.classList.contains('full') || v.paused || !isFinite(v.duration)) { if (shown) hide(); return; }
    var t = v.currentTime, d = v.duration, intro = introAt(t);
    if (intro) return show('intro:' + intro.s, 'Skip ' + (/recap|previously/i.test(intro.t) ? 'recap' : 'intro'), '', function () { v.currentTime = intro.e; Log.info('player', 'Skipped the intro to ' + Math.round(intro.e) + ' s'); });
    var cs = creditsStart(d), nk = cs >= 0 ? nextKind() : '';
    if (nk && t >= cs && t < d - 1) return show('credits', nk === 'collection' ? 'Next movie' : 'Next episode', 'Up next', function () { Log.info('player', 'Up next from the credits'); Views.endVod(true); });
    if (shown) hide();
  }
  function show(id, label, kicker, act) {
    if (hidden[id]) return;
    var b = el(); b._act = act; b._id = id;
    if (shown === id) return;
    shown = id; b.innerHTML = '';
    if (kicker) b.appendChild(U.el('small', '', kicker));
    b.appendChild(U.el('b', '', label));
    b.appendChild(U.el('span', 'skipper-key', 'OK'));
    b.classList.remove('hidden');
  }
  /* The player's keys first (views.js fullKeys): OK does the button's thing, Back hides it.  True: used. */
  function key(a) {
    if (!shown || !box || box.classList.contains('hidden')) return false;
    if (a === 'ok') { var f = box._act; hidden[box._id] = 1; hide(); if (f) f(); return true; }
    if (a === 'back') { hidden[box._id] = 1; hide(); return true; }
    return false;
  }
  return { chapters: chapters, key: key, hide: hide, get visible() { return !!shown; }, _test: { introAt: function (c, t) { chaps = c; return introAt(t); }, INTRO: INTRO, CREDITS: CREDITS } };
})();
