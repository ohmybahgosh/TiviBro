/* Skip intro, and Up next at the credits, in movies and episodes from files (My media, the provider's movies and
   shows).  Where the times come from, first to last:
     1. the file's own chapters (seekprev.js reads them through the TiviBro service);
     2. TheIntroDB and IntroDB, two free community databases of skip times (service/skipdb.js), by the title's
        TMDB or IMDb id with its season and episode: only for a file without such chapters, and only with
        Settings > Playback > Skip times from online databases on.

   - An intro (a chapter named Intro, Opening (credits), or the databases' intro): while it plays, a "Skip intro"
     button in the bottom right corner.  A recap (a chapter named Recap or Previously on, or the databases' recap):
     "Skip recap".  OK skips to its end, Back hides it.
   - The credits: a chapter named Credits, End credits or End titles in the last fifth of the file, or where the
     databases put them (in the second half).  An "Up next" card: OK goes straight to the next episode, or the
     next movie of a collection you're playing (the same as when the file ends), Back hides it and the file plays
     on.  Not for a movie with nothing after it.
   Nothing is guessed: a file with neither shows neither.  Settings > Playback > Skip intro and Up next turns both
   off.  Live channels never: only what plays as a movie or an episode (Views.mode 'vod'), not recordings. */
var Skipper = (function () {
  'use strict';
  // Elements with words on them, in the viewer's language (I18n: titles and names come as RAW and stay as they are).
  function tel(tag, cls, text) { return U.el(tag, cls, text == null || typeof I18n === 'undefined' ? text : I18n.t(text)); }
  // Marks a label for the translation check (scripts/i18n-check.js); tel() translates it when it shows.
  function T(s) { return s; }
  var INTRO = /^\s*(intro|introduction|opening( credits| titles| theme)?|recap|previously( on)?|cold open)\b/i;
  var CREDITS = /\b(end(ing)? credits|credits|end titles|closing( credits)?|outro)\b/i;
  var chaps = [], box = null, shown = '', hidden = {}, bound = false;
  /* The databases' times for what plays: { intro: [s, e], recap: [s, e], credits: s } in seconds (an end of -1:
     the end of the file), or null.  dbFor: the movie they were asked for (a newer start drops older answers);
     dbAsk: what to ask, once the file's length is known (tick). */
  var db = null, dbFor = null, dbAsk = null;

  function on() { return !(typeof Store !== 'undefined' && Store.settings && Store.settings.skipIntro === false); }
  // Settings > Playback > Skip times from online databases (on unless turned off).
  function online() { return on() && !(typeof Store !== 'undefined' && Store.settings && Store.settings.skipOnline === false); }
  function video() { return document.getElementById('video'); }
  function chapters(list) { chaps = list || []; hidden = {}; hide(); bind(); }
  function bind() {
    if (bound) return; var v = video(); if (!v) return;
    bound = true;
    v.addEventListener('timeupdate', tick);
  }
  function el() {
    if (box) return box;
    box = tel('div', 'skipper hidden'); document.body.appendChild(box);
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
  /* The databases' intro or recap playing at t: { s, e, t: 'intro'|'recap' } (e at most the file's end d), or null.
     Not while the file's own chapters have an intro: those come first. */
  function dbIntroAt(t, d) {
    if (!db || hasIntroChapter()) return null;
    var list = [['intro', db.intro], ['recap', db.recap]];
    for (var i = 0; i < list.length; i++) {
      var x = list[i][1]; if (!x) continue;
      var e = x[1] < 0 ? d : Math.min(x[1], d);
      if (e - x[0] >= 5 && e - x[0] <= 600 && t >= x[0] + 0.5 && t < e - 2) return { s: x[0], e: e, t: list[i][0] };
    }
    return null;
  }
  function hasIntroChapter() { for (var i = 0; i < chaps.length; i++) if (INTRO.test(chaps[i].t || '')) return true; return false; }
  function introAt(t) { for (var i = 0; i < chaps.length; i++) { var c = chaps[i]; if (INTRO.test(c.t || '') && c.e - c.s >= 10 && c.e - c.s <= 600 && t >= c.s + 0.5 && t < c.e - 3) return c; } return null; }
  function creditsStart(d) {
    for (var i = 0; i < chaps.length; i++) { var c = chaps[i]; if (CREDITS.test(c.t || '') && c.s >= d * 0.8 && c.s < d - 5) return c.s; }
    // The databases' credits, when the file marks none: in the second half (a time from another cut of the film is
    // more likely to be off, so not too early) and before the end.
    if (db && db.credits >= d * 0.5 && db.credits < d - 5) return db.credits;
    return -1;   // only where the file or the databases mark the credits: no guessing
  }
  function tick() {
    var v = video();
    if (!v || !on() || typeof Views === 'undefined' || Views.mode !== 'vod' || !document.body.classList.contains('full') || v.paused || !isFinite(v.duration)) { if (shown) hide(); return; }
    var t = v.currentTime, d = v.duration, intro = introAt(t) || dbIntroAt(t, d);
    if (dbAsk) ask(d);
    if (intro) return show('intro:' + intro.s, /recap|previously/i.test(intro.t) ? T('Skip recap') : T('Skip intro'), '', function () { v.currentTime = intro.e; Log.info('player', 'Skipped the ' + (/recap|previously/i.test(intro.t) ? 'recap' : 'intro') + ' to ' + Math.round(intro.e) + ' s'); });
    var cs = creditsStart(d), nk = cs >= 0 ? nextKind() : '';
    if (nk && t >= cs && t < d - 1) return show('credits', nk === 'collection' ? T('Next movie') : T('Next episode'), T('Up next'), function () { Log.info('player', 'Up next from the credits'); Views.endVod(true); });
    if (shown) hide();
  }

  /* ---------- the databases ---------- */
  /* A movie or episode starts (views.js playVod): what was there before goes, and its times are asked once the
     file's length is known (TheIntroDB matches its times to it).  Nothing for live TV, a recording, or with the
     setting off. */
  function start(meta) {
    db = null; dbFor = meta || null; dbAsk = null;
    if (!meta || !online() || (meta.item && meta.item.recording) || typeof Media === 'undefined' || !Media.request) return;
    dbAsk = meta;
  }
  /* Asked once: the title's ids (idsOf), then the TiviBro service asks the databases (service/skipdb.js).  Its
     answer only counts for the movie still playing. */
  function ask(d) {
    var meta = dbAsk; dbAsk = null;
    idsOf(meta).then(function (q) {
      if (!q || dbFor !== meta) return null;
      q.dur = Math.round(d);
      var key = typeof MediaStore !== 'undefined' && MediaStore.tmdbToken ? MediaStore.tmdbToken() : '';
      if (key && !q.imdb) q.credential = key;      // only to find the IMDb id IntroDB wants (never logged)
      return Media.request('skipdb', q, 20000).then(function (r) {
        if (dbFor !== meta || !r || r.error) return;
        db = { intro: r.intro || null, recap: r.recap || null, credits: r.credits >= 0 ? r.credits : -1 };
        if (r.from && r.from.length) Log.info('player', 'Skip times from ' + r.from.join(' and '));
      });
    }).catch(function () {});
  }
  /* What the databases know the title by: { kind, tmdb, imdb, season, episode }, or null.
     My media: a movie's TMDB id, a show's (its card, else the library) with the episode's season and number.
     The provider's: a show's TMDB id from its details (vod.js), a movie's from its row or details. */
  function idsOf(meta) {
    var it = meta.item || {}, num = function (x) { var m = /^(?:tmdb:(?:tv:)?)?([1-9][0-9]{0,9})$/.exec(String(x || '')); return m ? m[1] : ''; };
    if (meta.local && it.kind === 'episode' && it.showId) {
      var ep = { kind: 'episode', tmdb: num(Media.showTmdb && Media.showTmdb(it.showId)), season: +it.season || 0, episode: +it.number || 0 };
      if (ep.tmdb || !ep.episode) return Promise.resolve(ep.tmdb && ep.episode ? ep : null);
      return Media.request('library/detail', { kind: 'show', handle: it.showId }, 30000).then(function (sh) { ep.tmdb = num(sh && sh.metadata && /^tmdb:tv:/.test(sh.metadata.id || '') ? sh.metadata.id : ''); return ep.tmdb ? ep : null; });
    }
    if (meta.local) { var mid = /^tmdb:([0-9]+)$/.exec(String(it.metadata && it.metadata.id || '')); return Promise.resolve(mid ? { kind: 'movie', tmdb: mid[1] } : null); }
    if (it.ep) return Promise.resolve(meta.showTmdb && +it.num ? { kind: 'episode', tmdb: num(meta.showTmdb), season: +it.season || 0, episode: +it.num } : null);
    if (meta.provider && typeof Vod !== 'undefined' && Vod.movieTmdb) return Vod.movieTmdb(it).then(function (id) { return id ? { kind: 'movie', tmdb: id } : null; });
    return Promise.resolve(null);
  }
  function show(id, label, kicker, act) {
    if (hidden[id]) return;
    var b = el(); b._act = act; b._id = id;
    if (shown === id) return;
    shown = id; b.innerHTML = '';
    if (kicker) b.appendChild(tel('small', '', kicker));
    b.appendChild(tel('b', '', label));
    b.appendChild(tel('span', 'skipper-key', 'OK'));
    b.classList.remove('hidden');
  }
  /* The player's keys first (views.js fullKeys): OK does the button's thing, Back hides it.  True: used. */
  function key(a) {
    if (!shown || !box || box.classList.contains('hidden')) return false;
    if (a === 'ok') { var f = box._act; hidden[box._id] = 1; hide(); if (f) f(); return true; }
    if (a === 'back') { hidden[box._id] = 1; hide(); return true; }
    return false;
  }
  return { chapters: chapters, start: start, key: key, hide: hide, get visible() { return !!shown; },
    _test: { introAt: function (c, t) { chaps = c; return introAt(t); }, dbIntroAt: function (c, x, t, d) { chaps = c; db = x; return dbIntroAt(t, d); }, creditsStart: function (c, x, d) { chaps = c; db = x; return creditsStart(d); }, idsOf: idsOf, INTRO: INTRO, CREDITS: CREDITS } };
})();
