/* Skip intro and Skip credits in movies and episodes from files (My media, the provider's movies and shows), as
   Plex Pass does: a button, or by itself.  Where the times come from, first to last:
     1. the file's own chapters (seekprev.js reads them through the TiviBro service);
     2. TheIntroDB and IntroDB, two free community databases of skip times (service/skipdb.js), by the title's
        TMDB or IMDb id with its season and episode: only for a file without such chapters, and only with
        Settings > Playback > Skip times from online databases on.

   - An intro (a chapter named Intro, Opening (credits), or the databases' intro) or a recap (Recap, Previously on):
     "Skip intro" or "Skip recap" in the bottom right corner while it plays.  OK skips to its end, Back hides it.
   - The credits: a chapter named Credits, End credits or End titles in the last fifth of the file, or where the
     databases put them (in the second half).  "Skip credits": with a next episode, or a next movie of a collection
     you play, Up next comes with its countdown (upnext.js, the same as when the file ends); with a scene after the
     credits, it jumps to the scene; otherwise the movie ends.  Back hides it and the credits play on.
   Settings > Playback > Skip intro and Skip credits: Show a button (OK does it), Skip automatically (once per
   intro or credits: seeking back into them plays them), or Off.  Automatically ends a movie only in its last
   quarter, so a credits time from another cut doesn't cut a movie short.
   Nothing is guessed: a file with no marks shows nothing.  Live channels never: only what plays as a movie or an
   episode (Views.mode 'vod'), not recordings. */
var Skipper = (function () {
  'use strict';
  // Elements with words on them, in the viewer's language (I18n: titles and names come as RAW and stay as they are).
  function tel(tag, cls, text) { return U.el(tag, cls, text == null || typeof I18n === 'undefined' ? text : I18n.t(text)); }
  // Marks a label for the translation check (scripts/i18n-check.js); tel() and U.toast translate it when it shows.
  function T(s) { return s; }
  var INTRO = /^\s*(intro|introduction|opening( credits| titles| theme)?|recap|previously( on)?|cold open)\b/i;
  var CREDITS = /\b(end(ing)? credits|credits|end titles|closing( credits)?|outro)\b/i;
  var chaps = [], box = null, shown = '', hidden = {}, bound = false;
  /* The databases' times for what plays: { intro: [s, e], recap: [s, e], credits: s, creditsEnd: e } in seconds (an
     end of -1: the end of the file; credits -1: none), or null.  dbFor: the movie they were asked for (a newer start
     drops older answers); dbAsk: what to ask, once the file's length is known (tick). */
  var db = null, dbFor = null, dbAsk = null;

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  /* Settings > Playback > Skip intro / Skip credits: 'button', 'auto' or 'off'.  Before these, one switch (Skip
     intro and Up next, skipIntro) turned both off. */
  function mode(which) {
    var v = S()[which === 'credits' ? 'skipCreditsMode' : 'skipIntroMode'];
    if (v === 'button' || v === 'auto' || v === 'off') return v;
    return S().skipIntro === false ? 'off' : 'button';
  }
  // Settings > Playback > Skip times from online databases (on unless turned off), while either skip is on.
  function online() { return (mode('intro') !== 'off' || mode('credits') !== 'off') && S().skipOnline !== false; }
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
    if (meta && meta.plex) return meta.plexNext || '';   // a Plex episode (plexpage.js finds the next one when it ends)
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
  /* The credits of a file d seconds long: { s, e } (e: where they end, d when they run to the end), or null.
     The file's chapter first; else the databases', in the second half (a time from another cut of the film is
     more likely to be off, so not too early) and before the end. */
  function credits(d) {
    for (var i = 0; i < chaps.length; i++) { var c = chaps[i]; if (CREDITS.test(c.t || '') && c.s >= d * 0.8 && c.s < d - 5) return { s: c.s, e: Math.min(c.e || d, d) }; }
    if (db && db.credits >= d * 0.5 && db.credits < d - 5) return { s: db.credits, e: db.creditsEnd > db.credits ? Math.min(db.creditsEnd, d) : d };
    return null;   // only where the file or the databases mark the credits: no guessing
  }
  function creditsStart(d) { var c = credits(d); return c ? c.s : -1; }
  /* What Skip credits does, from the credits c of a file d long: { label, kicker, act, end (it ends the file) }.
     A scene after the credits (more than 20 s of file after them) is jumped to; else Up next with its countdown
     (Views.endVod: the same as the file ending), or the movie ends. */
  function creditsAction(c, d, v) {
    if (c.e < d - 20) return { label: T('Skip credits'), kicker: '', end: false, act: function () { v.currentTime = c.e; Log.info('player', 'Skipped the credits to ' + Math.round(c.e) + ' s'); } };
    var nk = nextKind();
    return { label: T('Skip credits'), kicker: nk ? T('Up next') : '', end: true, act: function () { Log.info('player', 'Skipped the credits' + (nk ? ': up next' : '')); Views.endVod(false); } };
  }
  function tick() {
    var v = video();
    if (!v || typeof Views === 'undefined' || Views.mode !== 'vod' || !document.body.classList.contains('full') || v.paused || !isFinite(v.duration)) { if (shown) hide(); return; }
    var t = v.currentTime, d = v.duration, im = mode('intro'), cm = mode('credits');
    if (dbAsk) ask(d);
    var intro = im === 'off' ? null : introAt(t) || dbIntroAt(t, d);
    if (intro) {
      var recap = /recap|previously/i.test(intro.t);
      return offer('intro:' + intro.s, im, recap ? T('Skip recap') : T('Skip intro'), '', recap ? T('Recap skipped') : T('Intro skipped'), function () { v.currentTime = intro.e; Log.info('player', 'Skipped the ' + (recap ? 'recap' : 'intro') + ' to ' + Math.round(intro.e) + ' s'); });
    }
    var c = cm === 'off' ? null : credits(d);
    if (c && t >= c.s && t < c.e - 1) {
      var a = creditsAction(c, d, v);
      // By itself, a movie or episode ends only in its last quarter; earlier, the button.
      return offer('credits:' + c.s, cm === 'auto' && a.end && c.s < d * 0.75 ? 'button' : cm, a.label, a.kicker, T('Credits skipped'), a.act);
    }
    if (shown) hide();
  }
  /* An intro or the credits playing: by itself (once: hidden marks it done, so seeking back into it plays it), with
     a word on the screen; or the button. */
  function offer(id, how, label, kicker, said, act) {
    if (how !== 'auto') return show(id, label, kicker, act);
    if (hidden[id]) return;
    hidden[id] = 1; hide();
    if (typeof U !== 'undefined' && U.toast) U.toast(said, 2500);
    act();
  }

  /* ---------- the databases ---------- */
  /* A movie or episode starts (views.js playVod): what was there before goes, and its times are asked once the
     file's length is known (TheIntroDB matches its times to it).  Nothing for live TV, a recording, or with the
     setting off. */
  function start(meta) {
    db = null; dbFor = meta || null; dbAsk = null;
    // A Plex title brings its own markers (plexpage.js marks): those, and nothing asked of the databases.
    if (meta && meta.marks) { db = meta.marks; return; }
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
        db = { intro: r.intro || null, recap: r.recap || null, credits: r.credits >= 0 ? r.credits : -1, creditsEnd: r.creditsEnd > 0 ? r.creditsEnd : -1 };
        if (r.from && r.from.length) Log.info('player', 'Skip times from ' + r.from.join(' and '));
      });
    }).catch(function () {});
  }
  /* What the databases know the title by: { kind, tvdb, tmdb, imdb, season, episode }, or null.
     My media: a movie's id, a show's (its card, else the library) with the episode's season and number.
     The provider's: a show's TMDB id from its details, else the show series.js matched (vod.js showIds); a
     movie's TMDB id from its row or details, else the movie found by its name (TMDB or TheTVDB).
     A title matched on TheTVDB goes by its TheTVDB id (TheIntroDB's own) and its IMDb id (IntroDB's). */
  function pick(kind, ids, season, episode) {
    var q = { kind: kind, tvdb: ids.tvdb || '', tmdb: ids.tvdb ? '' : ids.tmdb || '', imdb: ids.imdb || '' };
    if (kind === 'episode') { q.season = season; q.episode = episode; if (!(episode > 0)) return null; }
    return q.tvdb || q.tmdb || q.imdb ? q : null;
  }
  function idsOf(meta) {
    var it = meta.item || {}, of = Media.idsOfMeta || function () { return {}; };
    if (meta.local && it.kind === 'episode' && it.showId) {
      var known = Media.showIds ? Media.showIds(it.showId) : {}, se = +it.season || 0, en = +it.number || 0;
      if (known.tvdb || known.tmdb) return Promise.resolve(pick('episode', known, se, en));
      return Media.request('library/detail', { kind: 'show', handle: it.showId }, 30000).then(function (sh) { return pick('episode', of(sh && sh.metadata), se, en); });
    }
    if (meta.local) return Promise.resolve(pick('movie', of(it.metadata)));
    if (it.ep) return Promise.resolve(+it.num ? pick('episode', meta.showIds || { tmdb: meta.showTmdb }, +it.season || 0, +it.num) : null);
    if (meta.provider && typeof Vod !== 'undefined' && Vod.movieTmdb) return Vod.movieTmdb(it).then(function (id) {
      if (id) return { kind: 'movie', tmdb: id };
      // No TMDB id from the provider: the movie by its name (Movies on now's lookup: TMDB with a token, else TheTVDB).
      var c = typeof Movies !== 'undefined' && Movies.clean ? Movies.clean(String(it.name || '')) : { t: it.name, y: '' };
      if (!c.t || !Media.guideLookup || !Media.metaWho || !Media.metaWho('movie')) return null;
      return Media.guideLookup(c.t, it.year || c.y, 'strong').then(function (r) { return r && r.metadata ? pick('movie', of(r.metadata)) : null; }, function () { return null; });
    });
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
    _test: { introAt: function (c, t) { chaps = c; return introAt(t); }, dbIntroAt: function (c, x, t, d) { chaps = c; db = x; return dbIntroAt(t, d); }, creditsStart: function (c, x, d) { chaps = c; db = x; return creditsStart(d); }, credits: function (c, x, d) { chaps = c; db = x; return credits(d); }, mode: mode, tick: tick, setHidden: function (h) { hidden = h; }, idsOf: idsOf, INTRO: INTRO, CREDITS: CREDITS } };
})();
