/* My media: the viewer's own movies, from a home media server (DLNA, like a Fritz!Box) or a cloud
   (WebDAV, like premiumize, or Dropbox, signed in from the phone app).  Full-width poster shelves and the normal movie player.  The helper does the
   network work (service/media.js); MediaStore keeps what is remembered.

   Titles start with folder names.  Explicitly requested TMDB lookups add movie details and posters;
   only titles/years or chosen movie IDs are sent.  A fresh signed link or authenticated
   localhost stream is resolved for every WebDAV play. */
var Media = (function () {
  'use strict';
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = U.$;
  var built = false, playingMeta = null, scanning = {}, scanRuns = {}, pausedScans = {}, playToken = 0, loaded = null, progressTimer = null;

  /* ---------- helper ---------- */
  function ask(route, body, ms) {
    if(route==='library/query'&&body&&body.kind==='show'&&!body.sort){body.sort=MediaStore.preferences().showSort;body.reverse=!!MediaStore.preferences().showSortReverse;}   // Sort TV shows by
    if(route==='library/edit'&&!body.idempotencyKey)body.idempotencyKey='edit_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
    if (!Net.port) return Promise.reject(new Error('The TiviBro helper is not running.  Close TiviBro and open it again.'));
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(error, result) { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(result); }
      var timer = setTimeout(function () { finish(new Error('The media request timed out.  Please try again.')); if (ctl) ctl.abort(); }, ms);
      Net.ctlFetch('http://127.0.0.1:' + Net.port + '/media/' + route, { method: 'POST', cache: 'no-store', headers: ({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json(); }).then(function (j) { finish(null, j); }, function () { finish(new Error('Could not reach the media helper.  Please try again.')); });
    });
  }
  function scanSource(source,restart) { return MediaStore.load().then(function () { return ask('scan', { source: source, restart:!!restart }, 150000); }); }

  function why(e) { return (e && e.message) || 'That did not work.'; }

  /* ---------- the screen: the focused title large over its backdrop, poster shelves below ----------
     Like Movies on now: the backdrop fills the top, with the title's logo (or its name), the facts and the
     plot.  Shelves: Continue watching, holiday lists, Favorites, Recently added, TMDB's lists (what you
     can watch of them), Movies and TV shows in the order you choose (Red sorts, and can turn it round), a
     shelf per genre and Top rated; Red > Arrange shelves moves them and switches them off.  Long shelves draw only the posters on screen (TILE_POOL). */
  var seriesCards = [], reviewCards = [], continuingShows = [], favouriteShows = [], seriesLoading = false, seriesAgain = false;
  var shelves = [], shelfAt = 0, shelfPos = {}, shelfViews = [], posterQueue = [], posterBusy = 0, hero = null;
  // Opening My media focuses the first item on screen; shelves that fill in later (shows and episodes come
  // from the helper) still move it there, until the viewer presses a key.
  var followTop = true;
  var TILE_STEP = 272, TILE_POOL = 7, ROW_H = 492;   // posters drawn only on the focused shelf and the ones next to it
  var itemsVL = { current: function () { var s = shelves[shelfAt]; return s && s.movies[shelfPos[s.id] || 0]; }, refresh: function () { refresh(); } };
  function label(m) { return (m.title || m.label || '') + (m.year ? ' (' + m.year + ')' : ''); }
  function nameOf(m) { return m.metadata && m.metadata.title || m.title || m.label || ''; }
  function size(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : ''; }
  function fileInfo(m) { return (m.info || []).concat(m.ext ? [String(m.ext).toUpperCase()] : []).join('   '); }
  /* The picture first: 4K and Dolby Vision, HDR10 or HLG, from the file's own headers once it has been looked
     at (m.vf, below), else from its name ("2160p", "HDR", "DV").  Then the rest of what the name says. */
  var RANGE = { DV: 'Dolby Vision', HDR10: 'HDR10', HLG: 'HLG' };
  function pictureInfo(m) {
    var info = m.info || [], vf = m.vf || {}, h = vf.h || 0, out = [];
    var res = h >= 1600 ? '4K' : h >= 900 ? '1080p' : h >= 650 ? '720p' : h ? 'SD' : info.indexOf('2160p') >= 0 ? '4K' : info.indexOf('1080p') >= 0 ? '1080p' : info.indexOf('720p') >= 0 ? '720p' : '';
    if (res) out.push(res);
    var range = RANGE[vf.r] || (info.indexOf('Dolby Vision') >= 0 ? 'Dolby Vision' : info.indexOf('HDR') >= 0 ? 'HDR' : '');
    if (range) out.push(range);
    info.forEach(function (t) { if (!/^(2160p|1080p|720p|HDR|Dolby Vision)$/.test(t)) out.push(t); });
    if (m.ext) out.push(String(m.ext).toUpperCase());
    return out.join('   ');
  }
  // Look at a movie's file once for its picture, a moment after it's shown (not for every tile passed on the way).
  var vfTimer = null, vfAsked = {};
  function formatSoon(m, redraw) {
    clearTimeout(vfTimer);
    if (!m || m.vf || vfAsked[m.id] || m.kind === 'live' || m.kind === 'show' || m.kind === 'episode' || m.continueEpisode || !m.path || !(m.size > 0)) return;
    var src = MediaStore.source(m.src); if (!src) return;
    vfTimer = setTimeout(function () {
      vfAsked[m.id] = 1;
      ask('vformat', { source: src, path: m.path, size: m.size, ext: m.ext || '' }, 20000).then(function (f) {
        var vf = f && !f.error ? { h: +f.height || 0, r: f.range || '' } : { e: Date.now() };
        m.vf = vf; MediaStore.setFormat(m.id, vf);
        if (redraw) redraw(m);
      }, function () {});
    }, 700);
  }
  function wrap(url) { return typeof Net !== 'undefined' && Net.active && Net.wrap ? Net.wrap(url) : url; }
  function pumpPosters() {
    posterQueue = posterQueue.filter(function (q) { return !!q.img.parentNode; });
    while (posterBusy < 2 && posterQueue.length) {
      var q = posterQueue.shift(); if (!q.img.parentNode) continue;
      posterBusy++;
      (function (job) {
        var done = false;
        function finish(failed) { if (done) return; done = true; posterBusy--; job.img.onload = job.img.onerror = null; if (failed && job.img.parentNode) job.img.parentNode.removeChild(job.img); pumpPosters(); }
        job.img.onload = function () { finish(false); }; job.img.onerror = function () { finish(true); };
        job.img.src = wrap(job.url);
      })(q);
    }
  }
  function cover(slot, movie) {
    var poster = movie.metadata && movie.metadata.poster || '';
    // On Home (movies and shows together) a tile says which it is.
    var kindTag = split && section === 'home' && movie.kind !== 'live' && movie.kind !== 'section' ? (isShow(movie) ? 'TV' : 'Movie') : '';
    var key = movie.id + '|' + kindTag + '|' + (movie.kind === 'live' ? (movie.live.live ? 1 : 0) + '|' : '') + poster + '|' + nameOf(movie) + '|' + (movie.year || movie.metadata && movie.metadata.year || '');
    if (slot.key === key) return;
    slot.key = key; slot.art.innerHTML = ''; slot.art.appendChild(slot.bar); slot.art.appendChild(slot.tag);
    slot.art.appendChild(U.el('span', 'media-monogram', String(nameOf(movie)).slice(0, 1).toUpperCase()));
    if (poster) {
      var img = U.el('img', 'media-cover'); img.alt = ''; img.width = 240; img.height = 360;
      slot.art.appendChild(img); posterQueue.push({ img: img, url: poster });
    }
    slot.title.textContent = nameOf(movie);
    slot.year.textContent = movie.kind === 'live' ? liveLine(movie.live, true) : movie.continueEpisode && movie.label ? movie.label : movie.year || movie.metadata && movie.metadata.year || '';
    slot.el.classList.toggle('media-live', movie.kind === 'live');
    slot.tag.textContent = movie.kind === 'live' ? (movie.live.live ? 'LIVE' : U.hhmm(movie.live.p.s).toUpperCase()) : kindTag;
    slot.el.classList.toggle('media-section-card', movie.kind === 'section');
    slot.tag.classList.toggle('on', movie.kind === 'live' && movie.live.live);
  }

  /* Sorting.  Movies: Settings > My media > Sort movies by, or Red here.  TV shows: Sort TV shows by. */
  var SORT = { name: 'Title, A to Z', release: 'Release date, newest first', added: 'Date added, newest first', rating: 'Rating, highest first', runtime: 'Running time, longest first' };
  var SORT_REV = { name: 'Title, Z to A', release: 'Release date, oldest first', added: 'Date added, oldest first', rating: 'Rating, lowest first', runtime: 'Running time, shortest first' };
  var SHOW_SORT = { name: 'Title, A to Z', release: 'First aired, newest first', added: 'Date added, newest first', rating: 'Rating, highest first' };
  var SHOW_SORT_REV = { name: 'Title, Z to A', release: 'First aired, oldest first', added: 'Date added, oldest first', rating: 'Rating, lowest first' };
  function sortName(kind) {
    var p = MediaStore.preferences();
    return kind === 'show' ? (p.showSortReverse ? SHOW_SORT_REV : SHOW_SORT)[p.showSort] || SHOW_SORT.name : (p.sortReverse ? SORT_REV : SORT)[p.sort] || SORT.name;
  }
  function sorted(list) { return MediaStore.sortList ? MediaStore.sortList(list) : list; }

  /* TMDB's lists and holiday lists, matched against what you can watch: your library, and movies on your
     live channels now or in the next three hours (Movies on now, movies.js).  Only IDs come from TMDB;
     nothing about your library is sent.  Fetched with your token at most twice a day.  A movie list shows
     only when you have movies, a TV list only when you have shows, and a list with nothing to watch is
     left out. */
  var LISTS = [
    { key: 'tmdb:trending', title: 'Trending this week', list: 'trending', kinds: ['movie', 'tv'] },
    { key: 'tmdb:popular-movie', title: 'Popular movies', list: 'popular', kinds: ['movie'] },
    { key: 'tmdb:popular-tv', title: 'Popular TV shows', list: 'popular', kinds: ['tv'] },
    { key: 'tmdb:airing', title: 'Airing today', list: 'airing_today', kinds: ['tv'] },
    { key: 'tmdb:top-movie', title: 'Top rated movies on TMDB', list: 'top_rated', kinds: ['movie'] },
    { key: 'tmdb:top-tv', title: 'Top rated TV on TMDB', list: 'top_rated', kinds: ['tv'] },
    { key: 'tmdb:now', title: 'Now playing in theaters', list: 'now_playing', kinds: ['movie'], off: true },
    { key: 'tmdb:upcoming', title: 'Upcoming movies', list: 'upcoming', kinds: ['movie'], off: true }];
  // Holidays: shown from a month before the day until a week after, with TMDB's movies tagged for it.
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  function thanksgiving(y) { var d = new Date(y, 10, 1); return new Date(y, 10, 1 + (4 - d.getDay() + 7) % 7 + 21); }
  var HOLIDAYS = [
    { key: 'newyear', title: 'New Year\'s movies', words: ['new year\'s eve', 'new year'], day: function (y) { return new Date(y, 0, 1); } },
    { key: 'valentine', title: 'Valentine\'s Day movies', words: ['valentine\'s day'], day: function (y) { return new Date(y, 1, 14); } },
    { key: 'stpatrick', title: 'St. Patrick\'s Day movies', words: ['st. patrick\'s day', 'saint patrick\'s day'], day: function (y) { return new Date(y, 2, 17); } },
    { key: 'easter', title: 'Easter movies', words: ['easter'], day: easter },
    { key: 'july4', title: 'Fourth of July movies', words: ['independence day (usa)', 'fourth of july', '4th of july'], day: function (y) { return new Date(y, 6, 4); } },
    { key: 'halloween', title: 'Halloween movies', words: ['halloween'], day: function (y) { return new Date(y, 9, 31); } },
    { key: 'thanksgiving', title: 'Thanksgiving movies', words: ['thanksgiving'], day: thanksgiving },
    { key: 'christmas', title: 'Christmas movies', words: ['christmas'], day: function (y) { return new Date(y, 11, 25); } }];
  var DAY = 86400e3;
  function holidaysNow(now) {
    now = now || Date.now();
    var y = new Date(now).getFullYear(), out = [];
    HOLIDAYS.forEach(function (h) {
      [y - 1, y, y + 1].forEach(function (yy) {
        var d = h.day(yy).getTime();
        if (now >= d - 30 * DAY && now < d + 8 * DAY) out.push({ h: h, day: d });
      });
    });
    return out.sort(function (a, b) { return a.day - b.day; });
  }
  var TMDB_KEY = 'tivibro.media.lists', TMDB_AGE = 12 * 3600e3, tmdb = readLists(), tmdbBusy = false;
  function readLists() { try { var o = JSON.parse(localStorage.getItem(TMDB_KEY) || 'null'); return o && o.ids ? o : { at: 0, ids: {} }; } catch (e) { return { at: 0, ids: {} }; } }
  function token() { return MediaStore.tmdbToken ? MediaStore.tmdbToken() : ''; }
  function listsSoon(force) {
    if (tmdbBusy || !token() || (!force && Date.now() - (tmdb.at || 0) < TMDB_AGE)) return;
    tmdbBusy = true;
    var jobs = [], ids = {}, lang = MediaStore.preferences().language;
    function one(name, q) { q.credential = token(); q.language = lang; return ask('metadata', q, 45000).then(function (r) { if (r && r.ids) ids[name] = r.ids; }, function () {}); }
    LISTS.forEach(function (l) { l.kinds.forEach(function (k) { jobs.push(function () { return one(l.list + ':' + k, { list: l.list, kind: k }); }); }); });
    holidaysNow().forEach(function (x) {
      jobs.push(function () {
        var i = 0;
        function next() { var w = x.h.words[i++]; return w ? one('holiday:' + x.h.key, { list: 'holiday', keyword: w }).then(function () { if (!(ids['holiday:' + x.h.key] || []).length) return next(); }) : null; }
        return next();
      });
    });
    // One at a time: TMDB's rate limit, and an old TV's helper.
    jobs.reduce(function (p, job) { return p.then(job); }, Promise.resolve()).then(function () {
      tmdbBusy = false;
      if (!Object.keys(ids).length) return;
      tmdb = { at: Date.now(), ids: ids };
      try { localStorage.setItem(TMDB_KEY, JSON.stringify(tmdb)); } catch (e) {}
      refresh();
    });
  }
  // Movies on your live channels now or soon, as tiles: OK watches (or offers a reminder), like Movies on now.
  function liveMovies() {
    if (typeof Movies === 'undefined' || !Movies.shelves || !Movies.on || !Movies.on()) return [];
    var sh = Movies.shelves();
    return sh.on.concat(sh.soon).map(function (g) {
      var m = g.m;
      return { id: 'live:' + m.id + (g.live ? ':on' : ':soon'), kind: 'live', live: g, title: m.title, year: m.year,
        metadata: { id: m.id, title: m.title, year: m.year, poster: m.poster, backdrop: m.backdrop, backdropHd: m.backdropHd, logo: m.logo, plot: m.plot, genre: m.genre, runtime: m.runtime, rating: m.rating } };
    });
  }
  function liveLine(g, short) {
    var now = Date.now(), ch = typeof Library !== 'undefined' ? Library.name(g.c) : '', mins = function (ms) { var x = Math.max(1, Math.round(ms / 60000)); return x >= 60 ? Math.floor(x / 60) + ' h' + (x % 60 ? ' ' + x % 60 + ' min' : '') : x + ' min'; };
    if (g.live) return (short ? ch : 'Playing now on ' + ch) + '  ·  ' + mins(g.p.e - now) + ' left';
    return (short ? ch + '  ·  ' + U.hhmm(g.p.s) : 'Starts at ' + U.hhmm(g.p.s) + ' on ' + ch + '  ·  in ' + mins(g.p.s - now));
  }
  // A TMDB list's titles you can watch, in TMDB's order.  pool: { 'tmdb:123': item }.
  function listItems(names, pool) {
    var seen = {}, out = [];
    names.forEach(function (n) { (tmdb.ids[n] || []).forEach(function (id, rank) { var m = pool[id]; if (m && !seen[id]) { seen[id] = 1; out.push({ m: m, r: rank }); } }); });
    return out.sort(function (a, b) { return a.r - b.r; }).map(function (x) { return x.m; });
  }

  function genresOf(m) { return String(m.metadata && m.metadata.genre || '').split(/\s*,\s*/).filter(Boolean); }
  function rating(m) { return +(m.metadata && m.metadata.rating) || 0; }
  function count(n, one, many) { return n === 1 ? one : many.replace('{n}', n); }

  /* Copies of one movie on several sources (or twice on one) are one tile: the copy you were watching,
     else your preferred source, else the best picture.  Movie options lists every copy. */
  var copyMap = {};
  function quality(m) { var t = fileInfo(m) + ' ' + (m.file || ''); return /2160|4k|uhd/i.test(t) ? 3 : /1080/.test(t) ? 2 : /720/.test(t) ? 1 : 0; }
  function copies(m) { return m && copyMap[m.id] || (m ? [m] : []); }
  function mergeCopies(all) {
    var by = {}, pref = MediaStore.preferredSource ? MediaStore.preferredSource() : null, rep = {};
    copyMap = {};
    all.forEach(function (m) { var id = m.metadata && m.metadata.provider === 'TMDB' && m.metadata.id; if (id) (by[id] = by[id] || []).push(m); });
    Object.keys(by).forEach(function (id) {
      var g = by[id]; if (g.length < 2) return;
      var best = g.slice().sort(function (a, b) {
        var ra = MediaStore.resume(a.id), rb = MediaStore.resume(b.id);
        return ((rb && rb.at) || 0) - ((ra && ra.at) || 0) || (b.src === pref) - (a.src === pref) || quality(b) - quality(a);
      })[0];
      g.forEach(function (m) { copyMap[m.id] = g; rep[m.id] = best; });
    });
    return function (list) { var seen = {}, out = []; list.forEach(function (m) { var r = rep[m.id] || m; if (!seen[r.id]) { seen[r.id] = 1; out.push(r); } }); return out; };
  }
  /* The shelves and their order (Red > Arrange shelves, saved with the My media preferences).  Groups:
     holidays (each holiday on now), genres (a shelf per genre).  Some lists start switched off. */
  var ORDER = ['continue', 'browse', 'holidays', 'favorites', 'pick', 'recent', 'tmdb:trending', 'all', 'shows', 'unwatched', 'unseen-top', 'tmdb:popular-movie', 'tmdb:popular-tv', 'tmdb:airing', 'collections', 'genres', 'decades', 'directors', 'hdr', 'short', 'long', 'top', 'tmdb:top-movie', 'tmdb:top-tv', 'tmdb:now', 'tmdb:upcoming', 'review'];
  var NAMES = { continue: 'Continue watching', browse: 'Browse (Movies, TV shows, Favorites)', holidays: 'Holiday lists', favorites: 'Favorites', pick: 'Pick of the day', recent: 'Recently added', all: 'Movies', shows: 'TV shows',
    unwatched: 'Not watched yet', 'unseen-top': 'Highly rated you haven\'t seen', collections: 'Collections (a shelf each)', genres: 'Genres (a shelf each)', decades: 'Decades (a shelf each)',
    directors: 'Directors (a shelf each)', hdr: '4K and HDR', short: 'Under 90 minutes', long: 'Long movies', top: 'Top rated in your library', review: 'Needs review' };
  LISTS.forEach(function (l) { NAMES[l.key] = l.title; });
  /* Which shelves fit what you have (Arrange shelves leaves the rest out): TV ones need a source with TV
     shows, the rest a source with movies. */
  var TV_ONLY = { shows: 1, 'tmdb:popular-tv': 1, 'tmdb:airing': 1, 'tmdb:top-tv': 1, review: 1 }, BOTH = { continue: 1, favorites: 1, 'tmdb:trending': 1 };
  function has() { var l = MediaStore.sources(); if (!l.length) return { movies: true, shows: true };   // nothing added yet: every shelf
    return { movies: l.some(function (s) { return s.contentMode !== 'shows'; }), shows: l.some(function (s) { return s.contentMode && s.contentMode !== 'movies'; }) }; }
  function fits(k, h) { h = h || has(); return k === 'browse' ? h.movies && h.shows : BOTH[k] ? h.movies || h.shows : TV_ONLY[k] ? h.shows : h.movies; }
  /* Home, Movies, TV shows and Favorites: with both movies and shows, My media opens on a mixed Home (what
     you're watching, Browse, holiday lists, recently added, trending) and each tab has only its own shelves.
     With one kind there are no tabs: every shelf on one page, as before. */
  var SECTIONS = [['home', 'Home'], ['movies', 'Movies'], ['shows', 'TV shows'], ['favorites', 'Favorites']];
  var section = 'home', split = false, tabsFocus = false, counts = {};
  var HOME = { continue: 1, browse: 1, recent: 1, pick: 1, 'tmdb:trending': 1 };
  function inSection(id, sec) {
    if (sec === 'favorites') return id === 'favorites';
    if (id === 'continue') return true;
    if (id === 'favorites') return false;
    if (sec === 'home') return !!HOME[id] || id === 'holidays' || id.indexOf('holiday:') === 0;
    if (id === 'browse' || id === 'tmdb:trending' || id === 'holidays' || id.indexOf('holiday:') === 0) return false;
    return sec === 'shows' ? !!TV_ONLY[id] : !TV_ONLY[id];
  }
  function isShow(m) { return m && (m.kind === 'show' || !!m.continueEpisode); }
  function arrangement() {
    var p = MediaStore.preferences(), saved = (p.shelfOrder || []).filter(function (k) { return ORDER.indexOf(k) >= 0; }), off = p.shelfOff || {};
    ORDER.forEach(function (k, i) { if (saved.indexOf(k) < 0) saved.splice(Math.min(i, saved.length), 0, k); });
    return { order: saved, off: function (k) { return off[k] != null ? !!off[k] : LISTS.some(function (l) { return l.key === k && l.off; }); } };
  }
  function shelvesNow(opts) {
    opts = opts || {};
    var p = MediaStore.preferences(), src = p.sourceFilter && MediaStore.source(p.sourceFilter) ? p.sourceFilter : '';
    var mine = function (m) { return !src || m.src === src || (m.sourceIds || []).indexOf(src) >= 0 || m.sourceId === src; };
    var base = MediaStore.sections(null), all = (MediaStore.movies ? MediaStore.movies(null) : base[2].movies.slice()).filter(mine);
    var one = mergeCopies(all), shows = opts.phone ? [] : seriesCards.filter(mine), favShows = opts.phone ? [] : favouriteShows.filter(mine);
    var hasMovies = all.length > 0, hasShows = shows.length + favShows.length > 0;
    var built = {};
    built['continue'] = { title: 'Continue watching', movies: one(base[0].movies.filter(mine)).concat(opts.phone ? [] : continuingShows.filter(mine)) };
    built.favorites = { title: 'Favorites', movies: one(base[1].movies.filter(mine)).concat(favShows) };
    var first = Infinity; all.forEach(function (m) { if ((m.addedAt || 0) < first) first = m.addedAt || 0; });
    var recent = one(all.filter(function (m) { return (m.addedAt || 0) > first + 3600e3; }).sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); })).slice(0, 40);
    built.recent = { title: 'Recently added', sub: count(recent.length, '1 new title', '{n} new titles'), movies: recent };
    var movies = one(p.favoritesInLists ? all : all.filter(function (m) { return !MediaStore.isFavorite(m.id); }));
    built.all = { title: 'Movies', sub: count(movies.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: movies };
    built.shows = { title: 'TV shows', sub: count(shows.length, '1 show', '{n} shows') + '  ·  ' + sortName('show'), movies: shows };
    var top = one(all.filter(function (m) { return rating(m) >= 7; }).sort(function (a, b) { return rating(b) - rating(a); })).slice(0, 40);
    built.top = { title: 'Top rated in your library', sub: 'Rated 7 or more on TMDB, highest first', movies: top.length >= 3 ? top : [] };
    built.review = { title: 'Needs review', sub: 'Files TiviBro could not place.  OK to sort them out.', movies: opts.phone || src ? [] : reviewCards };
    // Haven't watched yet: never started and not watched to the end.
    var seen = function (m) { return (MediaStore.isWatched && MediaStore.isWatched(m.id)) || !!MediaStore.resume(m.id); };
    var fresh = one(all.filter(function (m) { return !seen(m); }));
    built.unwatched = { title: 'Not watched yet', sub: count(fresh.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: fresh };
    var good = fresh.filter(function (m) { return rating(m) >= 7; }).sort(function (a, b) { return rating(b) - rating(a); }).slice(0, 60);
    built['unseen-top'] = { title: 'Highly rated you haven\'t seen', sub: 'Rated 7 or more on TMDB, highest first', movies: good.length >= 3 ? good : [] };
    // A few unwatched ones, the same all day, new ones tomorrow.
    var day = new Date(), seed = day.getFullYear() * 400 + day.getMonth() * 32 + day.getDate(), pool2 = fresh.slice();
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (var pi = pool2.length - 1; pi > 0; pi--) { var pj = Math.floor(rnd() * (pi + 1)), pt = pool2[pi]; pool2[pi] = pool2[pj]; pool2[pj] = pt; }
    built.pick = { title: 'Pick of the day', sub: 'Unwatched, a new pick every day', movies: fresh.length >= 20 ? pool2.slice(0, 12) : [] };
    var hdrRx = /2160|\b4k\b|uhd|hdr|dolby ?vision|\bdv\b/i;
    var sharp = one(all.filter(function (m) { return (m.vf && (m.vf.h >= 1600 || RANGE[m.vf.r])) || hdrRx.test(fileInfo(m) + ' ' + (m.file || '')); }));
    built.hdr = { title: '4K and HDR', sub: count(sharp.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: sharp };
    var mins = function (m) { return parseInt(m.metadata && m.metadata.runtime, 10) || 0; };
    var shortL = one(all.filter(function (m) { return mins(m) > 0 && mins(m) < 90; }));
    built.short = { title: 'Under 90 minutes', sub: count(shortL.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: shortL };
    var longL = one(all.filter(function (m) { return mins(m) > 150; }));
    built.long = { title: 'Long movies', sub: 'Over 2 and a half hours  ·  ' + count(longL.length, '1 movie', '{n} movies'), movies: longL };
    // TMDB lists: your movies, your shows, and movies on your live channels.
    var pool = {}, live = opts.phone ? [] : liveMovies();
    live.forEach(function (m) { if (!pool[m.metadata.id]) pool[m.metadata.id] = m; });
    one(all).forEach(function (m) { if (m.metadata && m.metadata.id) pool[m.metadata.id] = m; });
    shows.concat(favShows).forEach(function (m) { if (m.metadata && m.metadata.id) pool[m.metadata.id] = m; });
    LISTS.forEach(function (l) {
      var kinds = l.kinds.filter(function (k) { return k === 'movie' ? hasMovies || live.length : hasShows; });
      var items = listItems(kinds.map(function (k) { return l.list + ':' + k; }), pool);
      built[l.key] = { title: l.title, sub: 'TMDB  ·  ' + count(items.length, '1 you can watch', '{n} you can watch'), movies: items };
    });
    // Browse: one card each for Movies, TV shows and Favorites, each with a poster from it.
    var posterOf = function (list) { for (var i = 0; i < list.length; i++) if (list[i].metadata && list[i].metadata.poster) return list[i]; return null; };
    var favList = built.favorites.movies, mvP = posterOf(recent.concat(movies)), shP = posterOf(shows), fvP = posterOf(favList);
    counts = { movies: one(all).length, shows: shows.length + favShows.length, favorites: favList.length };
    var card = function (sec, title, sub, from) { return { id: 'section:' + sec, kind: 'section', section: sec, title: title, year: sub, metadata: { title: title, poster: from && from.metadata.poster || '', backdrop: from && (from.metadata.backdropHd || from.metadata.backdrop) || '', plot: sub } }; };
    built.browse = { title: 'Browse', sub: 'OK opens it', movies: [card('movies', 'Movies', count(counts.movies, '1 movie', '{n} movies'), mvP), card('shows', 'TV shows', count(counts.shows, '1 show', '{n} shows'), shP)].concat(counts.favorites ? [card('favorites', 'Favorites', count(counts.favorites, '1 favorite', '{n} favorites'), fvP)] : []) };
    var out = [], ar = arrangement(), kinds = has();
    ar.order.forEach(function (k) {
      if (ar.off(k)) return;
      if (k === 'holidays') return holidaysNow().forEach(function (x) {
        var items = hasMovies || live.length ? listItems(['holiday:' + x.h.key], pool) : [];
        var end = new Date(x.day + 7 * DAY);
        out.push({ id: 'holiday:' + x.h.key, title: x.h.title, sub: 'Holiday  ·  until ' + end.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + '  ·  most popular first', movies: items });
      });
      if (!opts.all && !fits(k, kinds)) return;
      if (k === 'decades') {
        var dec = {};
        all.forEach(function (m) { var y = +(m.year || (m.metadata && m.metadata.year) || 0); if (!y) return; var d = y < 1980 ? 1900 : Math.floor(y / 10) * 10; (dec[d] = dec[d] || []).push(m); });
        return Object.keys(dec).map(Number).sort(function (a, b) { return b - a; }).forEach(function (d) {
          var list = one(sorted(dec[d].slice()));
          if (list.length >= 3) out.push({ id: 'decade:' + d, title: d === 1900 ? 'Older than the 1980s' : d < 2000 ? 'The ' + String(d).slice(2) + 's' : 'The ' + d + 's', sub: count(list.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: list });
        });
      }
      if (k === 'collections') {
        var cols = {}, cn = {};
        all.forEach(function (m) { var c = m.metadata && m.metadata.collection; if (c && c.id) { (cols[c.id] = cols[c.id] || []).push(m); cn[c.id] = c.name; } });
        return Object.keys(cols).map(function (id) { return { id: id, list: one(cols[id]) }; }).filter(function (x) { return x.list.length >= 2; })
          .sort(function (a, b) { return b.list.length - a.list.length || (cn[a.id] < cn[b.id] ? -1 : 1); }).slice(0, 30).forEach(function (x) {
            var list = x.list.slice().sort(function (a, b) { var p = String(a.metadata.releaseDate || a.year || ''), q = String(b.metadata.releaseDate || b.year || ''); return p < q ? -1 : p > q ? 1 : 0; });
            out.push({ id: 'collection:' + x.id, title: cn[x.id], sub: 'Collection  ·  ' + count(list.length, '1 movie', '{n} movies') + ', in order', movies: list });
          });
      }
      if (k === 'directors') {
        var dir = {};
        all.forEach(function (m) { ((m.metadata && m.metadata.directors) || []).forEach(function (n) { (dir[n] = dir[n] || []).push(m); }); });
        return Object.keys(dir).map(function (n) { return { n: n, list: one(dir[n]) }; }).filter(function (x) { return x.list.length >= 3; })
          .sort(function (a, b) { return b.list.length - a.list.length || (a.n < b.n ? -1 : 1); }).slice(0, 20).forEach(function (x) {
            out.push({ id: 'director:' + x.n.toLowerCase(), title: 'Directed by ' + x.n, sub: count(x.list.length, '1 movie', '{n} movies') + '  ·  newest first', movies: x.list.slice().sort(function (a, b) { return (+(b.year || 0)) - (+(a.year || 0)); }) });
          });
      }
      if (k === 'genres') {
        var by = {}, names = [];
        all.forEach(function (m) { genresOf(m).forEach(function (g) { if (!by[g]) { by[g] = []; names.push(g); } by[g].push(m); }); });
        return names.filter(function (g) { return by[g].length >= 2; }).sort(function (a, b) { return by[b].length - by[a].length || (a < b ? -1 : 1); }).forEach(function (g) {
          var list = one(sorted(by[g].slice()));
          out.push({ id: 'genre:' + g.toLowerCase(), title: g, sub: count(list.length, '1 movie', '{n} movies') + '  ·  ' + sortName('movie'), movies: list, genre: true });
        });
      }
      var s = built[k]; if (s) { s.id = k; out.push(s); }
    });
    if (opts.phone || opts.all) return out;
    split = hasMovies && hasShows;
    if (!split) return out.filter(function (x) { return x.id !== 'browse'; });
    if (section === 'favorites' && !counts.favorites) section = 'home';      // the last favorite went
    var sec = opts.section || section;
    out = out.filter(function (x) { return inSection(x.id, sec); });
    out.forEach(function (x) {
      if (x.id === 'continue' && sec === 'movies') { x.movies = x.movies.filter(function (m) { return !isShow(m); }); }
      if (x.id === 'continue' && sec === 'shows') { x.movies = x.movies.filter(isShow); x.title = 'Next up'; x.sub = count(x.movies.length, '1 show you are watching', '{n} shows you are watching'); }
      if (x.id === 'recent' && sec === 'movies') x.title = 'Recently added movies';
    });
    if (sec === 'favorites') {
      var f = out[0]; out = [];
      if (f) {
        var fm = f.movies.filter(function (m) { return !isShow(m); }), fs = f.movies.filter(isShow);
        if (fm.length) out.push({ id: 'favorites', title: 'Favorite movies', sub: count(fm.length, '1 movie', '{n} movies'), movies: fm });
        if (fs.length) out.push({ id: 'favorites-shows', title: 'Favorite shows', sub: count(fs.length, '1 show', '{n} shows'), movies: fs });
      }
      if (!out.length) out.push({ id: 'favorites', title: 'Favorites', sub: 'Hold OK on a movie or show and choose Favorite', movies: [] });
    }
    return out;
  }
  function setSection(sec) {
    if (sec === section && !tabsFocus) return;
    section = sec; followTop = true; refresh();
  }
  function drawTabs() {
    var bar = $('mediaTabs'); if (!bar) return;
    $('viewMedia').classList.toggle('split', split);
    bar.classList.toggle('hidden', !split); bar.classList.toggle('focus', tabsFocus);
    if (!split) return;
    bar.innerHTML = '';
    SECTIONS.forEach(function (x) {
      var n = x[0] === 'home' ? '' : counts[x[0]] != null ? String(counts[x[0]]) : '';
      if (x[0] === 'favorites' && !counts.favorites) return;
      var t = U.el('div', 'media-tab' + (x[0] === section ? ' on' : ''), x[1]);
      if (n) t.appendChild(U.el('b', '', n.replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
      t.addEventListener('click', function () { tabsFocus = false; setSection(x[0]); });
      bar.appendChild(t);
    });
  }
  // The phone app's My media: Continue watching, Favorites and Movies first (their ids stay), then the rest.
  function movieShelves() { return shelvesNow({ phone: true }).filter(function (s) { return s.movies.length || s.id === 'all'; }); }

  /* The hero: backdrop, logo or title, facts, plot, and where it stopped. */
  var bdTimer = null;
  function backdrop(url) {
    clearTimeout(bdTimer);
    bdTimer = setTimeout(function () {
      var img = hero && hero.img; if (!img || img._src === url) return;
      img._src = url; img.classList.remove('on');
      if (!url) { if (img.removeAttribute) img.removeAttribute('src'); return; }
      img.onload = function () { if (img._src === url) img.classList.add('on'); }; img.onerror = function () { img.classList.remove('on'); };
      img.src = wrap(url);
    }, 140);
  }
  function showInfo() {
    var m = itemsVL.current(), box = $('mediaInfo'), s = shelves[shelfAt]; box.innerHTML = '';
    if (!m) {
      backdrop('');
      box.appendChild(U.el('h1', 'media-title', 'Your media, your space'));
      box.appendChild(U.el('p', 'media-summary', MediaStore.sources().length ? 'Nothing in your sources yet.  Rescan with Green, or change what a source holds in Settings › My media.' : 'Add a media server in Settings › My media to start your library.'));
      return;
    }
    if (m.kind === 'section') {
      backdrop(m.metadata.backdrop || '');
      box.appendChild(U.el('div', 'media-kicker', 'Browse'));
      box.appendChild(U.el('h1', 'media-title', m.title));
      box.appendChild(U.el('div', 'media-facts', m.year));
      box.appendChild(U.el('p', 'media-summary', m.section === 'shows' ? 'Your shows: what to watch next, every show, and TMDB\'s TV lists.' : m.section === 'favorites' ? 'Your favorite movies and shows.' : 'Your movies: recently added, a pick for today, collections, genres, decades, 4K and HDR, and TMDB\'s lists.'));
      box.appendChild(U.el('div', 'media-caption', 'OK opens it   ·   or ▲ to the tabs'));
      return;
    }
    var md = m.metadata || {}, src = m.kind === 'live' ? null : MediaStore.source(m.src || m.sourceId), r = m.kind === 'show' || m.kind === 'live' || m.continueEpisode ? null : MediaStore.resume(m.id), n = copies(m).length;
    backdrop(md.backdropHd || md.backdrop || '');
    if (s) box.appendChild(U.el('div', 'media-kicker', s.title));
    var title = nameOf(m);
    if (md.logo) {
      var lg = U.el('img', 'media-logo'); lg.alt = title;
      lg.onerror = function () { if (lg.parentNode) { lg.parentNode.insertBefore(U.el('h1', 'media-title', title), lg); lg.parentNode.removeChild(lg); } };
      lg.src = wrap(md.logo); box.appendChild(lg);
    } else box.appendChild(U.el('h1', 'media-title', title));
    var seasons = Array.isArray(md.seasons) ? md.seasons.filter(function (x) { return x.number > 0; }).length : 0;
    var facts = [m.kind === 'show' ? 'TV show' : '', m.year || md.year, md.runtime, seasons ? count(seasons, '1 season', '{n} seasons') : '', genresOf(m).slice(0, 3).join(', '), rating(m) ? '★ ' + md.rating : '', m.kind === 'live' ? '' : pictureInfo(m), n > 1 ? n + ' copies' : '', (m.favourite || MediaStore.isFavorite(m.id)) ? '♥ Favorite' : ''];
    box.appendChild(U.el('div', 'media-facts', facts.filter(Boolean).join('   ·   ')));
    formatSoon(m, function (x) { if (itemsVL.current() === x) showInfo(); });
    box.appendChild(U.el('p', 'media-summary', md.plot || (m.kind === 'show' ? 'Press OK for its seasons and episodes.' : 'Press OK to play.  Red for options.')));
    var bottom = m.kind === 'live' ? liveLine(m.live) + '  ·  ' + (m.live.live ? 'OK to watch' : 'OK for a reminder') : m.continueEpisode ? 'Continue with ' + (m.label || 'the next episode') + (m.progressPercent ? ',  ' + m.progressPercent + '% watched' : '')
      : r ? 'Resume at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min' : m.kind === 'show' ? 'OK for episodes' : 'Ready to watch';
    box.appendChild(U.el('div', 'media-caption', bottom + (src ? '   ·   ' + src.name : '')));
    if (md.provider && ((md.fallbackFields || []).length || MediaStore.preferences().language !== (md.requestedLanguage || md.language || 'en'))) box.appendChild(U.el('span', 'media-language-note', (md.fallbackFields || []).length ? 'English fallback: ' + md.fallbackFields.join(', ') : 'Saved metadata language differs from your preference'));
  }
  function makeShelf() {
    var el = U.el('section', 'media-shelf'), heading = U.el('h2'), count = U.el('span', 'media-shelf-count'), track = U.el('div', 'media-track'), empty = U.el('p', 'media-shelf-empty'), pool = [];
    var title = U.el('div', 'media-shelf-title'); title.appendChild(heading); title.appendChild(count); el.appendChild(title); el.appendChild(track); el.appendChild(empty);
    for (var i = 0; i < TILE_POOL; i++) {
      var tile = U.el('div', 'media-tile'), art = U.el('div', 'media-art'), name = U.el('div', 'media-tile-title'), year = U.el('div', 'media-tile-year'), progress = U.el('i'), favorite = U.el('span', 'media-favorite');
      tile.setAttribute('role', 'button'); var bar = U.el('div', 'media-progress'), tag = U.el('span', 'media-tag'); bar.appendChild(progress); tile.appendChild(favorite); tile.appendChild(art); tile.appendChild(name); tile.appendChild(year);
      (function (node) {
        function focus() { followTop = false; shelfAt = node._row; shelfPos[shelves[shelfAt].id] = node._at; drawShelves(); }
        node.addEventListener('mousemove', function () { if (UI.pointer && (shelfAt !== node._row || (shelfPos[shelves[node._row].id] || 0) !== node._at)) focus(); });
        node.addEventListener('click', function () { focus(); play(itemsVL.current(), false); });
      })(tile);
      track.appendChild(tile); pool.push({ el: tile, art: art, title: name, year: year, progress: progress, bar: bar, tag: tag, favorite: favorite, key: '' });
    }
    $('mediaShelfStage').appendChild(el);
    return { el: el, heading: heading, count: count, pool: pool, empty: empty };
  }
  function drawShelves() {
    var y = 0, focusedY = 0;
    while (shelfViews.length < shelves.length) shelfViews.push(makeShelf());
    shelfViews.forEach(function (view, row) {
      var s = shelves[row];
      view.el.classList.toggle('hidden', !s);
      if (!s) { view.pool.forEach(function (slot) { slot.el.style.display = 'none'; slot.art.innerHTML = ''; slot.key = ''; }); return; }
      var at = Math.max(0, Math.min(shelfPos[s.id] || 0, s.movies.length - 1)); shelfPos[s.id] = at;
      if (row === shelfAt) focusedY = y;
      view.el.style.transform = 'translateY(' + y + 'px)';
      view.el.classList.toggle('active', row === shelfAt);
      view.heading.textContent = s.title; view.count.textContent = s.sub || (s.movies.length ? String(s.movies.length) : '');
      view.empty.textContent = MediaStore.sources().length ? 'Nothing here yet.  Green rescans your sources.' : 'Add your first server in Settings › My media.';
      view.empty.classList.toggle('hidden', s.movies.length > 0);
      var near = Math.abs(row - shelfAt) <= 1;
      var start = Math.max(0, Math.min(at - 1, s.movies.length - (TILE_POOL - 1))), used = {};
      for (var i = start; near && i < Math.min(s.movies.length, start + TILE_POOL); i++) {
        var slot = view.pool[i % TILE_POOL], m = s.movies[i]; used[i % TILE_POOL] = true;
        slot.el.style.display = ''; slot.el.style.transform = 'translateX(' + (i - start) * TILE_STEP + 'px)';
        slot.el._at = i; slot.el._row = row; cover(slot, m);
        slot.el.classList.toggle('sel', row === shelfAt && i === at);
        slot.el.setAttribute('aria-label', label(m));
        var r = MediaStore.resume(m.id), pc = m.progressPercent != null ? m.progressPercent : r && r.dur ? Math.min(100, 100 * r.pos / r.dur) : 0;
        slot.progress.style.width = pc + '%'; slot.bar.classList.toggle('hidden', !pc);
        slot.favorite.textContent = (m.favourite || MediaStore.isFavorite(m.id)) ? '♥' : '';
      }
      view.pool.forEach(function (slot, n) { if (!used[n]) { slot.el.style.display = 'none'; slot.art.innerHTML = ''; slot.key = ''; } });
      y += s.movies.length ? ROW_H : 130;
    });
    $('mediaShelfStage').style.transform = 'translateY(-' + focusedY + 'px)';
    showInfo(); pumpPosters();
  }
  function refresh() {
    if (typeof Settings !== 'undefined' && Settings.live) Settings.live();
    if (!built || $('viewMedia').classList.contains('hidden') || document.body.classList.contains('full')) return;
    var movie = itemsVL.current(), oldShelf = shelves[shelfAt] && shelves[shelfAt].id;
    var list = shelvesNow();
    shelves = list.filter(function (s) { return s.movies.length; });
    if (!shelves.length) shelves = list.filter(function (s) { return s.id === 'all'; });
    if (!shelves.length) shelves = [{ id: 'all', title: 'Movies', movies: [] }];
    if (!split) { section = 'home'; tabsFocus = false; }
    drawTabs();
    if (oldShelf) shelfAt = shelves.map(function (s) { return s.id; }).indexOf(oldShelf);
    if (followTop || shelfAt < 0) shelfAt = 0;
    var active = shelves[shelfAt];
    if (followTop) shelfPos[active.id] = 0;
    else if (movie) { var i = active.movies.findIndex(function (m) { return m.id === movie.id; }); if (i >= 0) shelfPos[active.id] = i; }
    drawShelves(); hints();
  }

  /* ---------- adding and scanning ---------- */
  // What the movie scan left out (service/media.js moviesOf): trailers and extras.  Episodes and season
  // folders aren't left out any more: they are under TV shows.
  function leftOut(sk) {
    var ex = sk && sk.extras || 0;
    return ex ? '  Left out ' + ex + ' trailer' + (ex === 1 ? '' : 's') + ' and extras.' : '';
  }
  // What a scan found on a source: "1 movie and 24 episodes on Home server."  Episodes are counted when
  // the source also looks for TV shows (its content is Automatic or TV shows).
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function foundText(id, name, episodes) {
    var s = MediaStore.source(id) || {}, mode = s.contentMode || 'movies', m = MediaStore.movies(id).length, e = +episodes || 0, parts = [];
    if (mode !== 'shows') parts.push(plural(m, 'movie'));
    if (mode !== 'movies') parts.push(plural(e, 'episode'));
    return parts.join(' and ') + ' on ' + name + '.';
  }
  function found(id, name, r, res) {
    var more = leftOut(res && res.skipped);
    U.toast((r.note || foundText(id, name, res && res.episodeFiles)) + more, r.note || more ? 8000 : 3000);
  }
  function rescan(id,restart) {
    var src = MediaStore.source(id);
    if (!src || scanning[id]) return Promise.resolve({ error: 'busy', message: !src ? 'That media source was removed.' : 'This source is already being scanned.' });
    scanning[id] = 1;pausedScans[id]=false; refresh();
    U.toast('Looking for movies and shows on ' + src.name + '…');
    function slice(first){return scanSource(src,first&&restart).then(function (res) {
      var r = MediaStore.applyScan(id, res);
      if(res.resumable&&!res.error&&!pausedScans[id]&&!document.hidden&&MediaStore.source(id)){refreshSeries();refresh();U.toast('Scan saved.  Continuing '+src.name+'…');return new Promise(function(resolve){setTimeout(function(){resolve(slice(false));},500);});}
      delete scanning[id]; refreshSeries(); refresh();
      found(id, src.name, r, res);
      if (!scanningAll) autoSoon();
      return { error: res.error || '', message: res.message || '', kept: r.kept, note: r.note, count: MediaStore.movies(id).length, episodes: res.episodeFiles || 0, text: foundText(id, src.name, res.episodeFiles), skipped: res.skipped || null };
    }, function (e) { delete scanning[id]; refresh(); U.toast('Could not read ' + src.name + ': ' + why(e), 6000); return { error: 'helper' }; });}
    var job=slice(true);scanRuns[id]=job;job.then(function(){if(scanRuns[id]===job)delete scanRuns[id];},function(){if(scanRuns[id]===job)delete scanRuns[id];});return job;
  }
  function changeSourceMode(id,mode){
    MediaStore.sourceMode(id,mode);pausedScans[id]=true;var old=scanRuns[id]||Promise.resolve();
    return ask('library/source',{action:'configure',sourceId:id,contentMode:mode},30000).then(function(r){if(r.error)throw new Error(r.message);if(scanning[id])ask('scan/control',{sourceId:id},15000).catch(function(){});return old;}).then(function(){return rescan(id,true);});
  }
  function addServer(server) {
    var id;
    try { id = MediaStore.addSource({ type: 'dlna', name: server.name, control: server.control }); } catch (e) { U.toast(e.message, 5000); return Promise.resolve(); }
    return rescan(id);
  }
  function discover() { return ask('discover', {}, 12000).then(function (r) { return (r && r.servers) || []; }); }
  function browseNetwork() {
    U.toast('Looking for media servers on your network…');
    discover().then(function (servers) {
      if (!servers.length) { U.toast('No media servers answered.  Is media sharing on, and is the server on this network?', 6000); return; }
      UI.menu('Media servers', servers.map(function (s) { return { label: RAW(s.name), action: function () { addServer(s); } }; }));
    }, function (e) { U.toast(why(e), 5000); });
  }
  function nameFor(address) {
    var m = /^https?:\/\/([^/:]+)/i.exec(address);
    return !m ? address : /premiumize/i.test(m[1]) ? 'premiumize' : m[1];
  }
  // A new source's first scan answered: save it (with its name set) and what the scan found.
  function addScanned(source, res) {
    if (res.error) { U.toast(res.message, 6000); return { error: res.error, message: res.message }; }
    var id;
    try { id = MediaStore.addSource(source); } catch (e) { U.toast(e.message, 5000); return { error: 'full', message: e.message }; }
    var r = MediaStore.applyScan(id, res);
    if (res.scanHandle) ask('library/adopt', {sourceId:id,scanHandle:res.scanHandle},30000).then(function (saved) { if (saved.error) U.toast(saved.message,6000); refreshSeries(); refresh(); }, function (e) { U.toast(why(e),6000); });
    refresh();
    found(id, source.name, r, res);
    autoSoon();
    return { id: id, movies: MediaStore.movies(id).length, episodes: res.episodeFiles || 0, skipped: res.skipped || null };
  }
  // A new login is checked by scanning before anything is saved.
  function addAddress(address, user, pass) {
    address = String(address || '').trim();
    var source = { contentMode: 'automatic', type: 'webdav', address: address, user: String(user || '').trim(), pass: String(pass || '').trim() };
    U.toast('Checking ' + nameFor(address) + '…');
    return scanSource(source).then(function (res) {
      if (!res.error) source.name = nameFor(address);
      return addScanned(source, res);
    }, function (e) { U.toast(why(e), 6000); return { error: 'helper', message: why(e) }; });
  }
  /* Dropbox, from the phone app: it signed in and chose the folder, and sends only the refresh token
     (a secret, kept like a WebDAV password).  The account is checked, then the folder scanned, before
     anything is saved.  root '' is the whole Dropbox. */
  function dropboxRoot(root) {
    root = String(root || '').trim().replace(/\/+$/, '');
    return !root ? '' : root.charAt(0) === '/' ? root : '/' + root;
  }
  function addDropbox(refresh, root, name) {
    var source = { contentMode: 'automatic', type: 'dropbox', root: dropboxRoot(root), refresh: String(refresh || '').trim(), name: String(name || '').trim().slice(0, 80) || 'Dropbox' };
    U.toast('Checking Dropbox…');
    return ask('dropbox/account', { refresh: source.refresh }, 25000).then(function (a) {
      if (a.error) { U.toast(a.message, 6000); return { error: a.error, message: a.message }; }
      source.account = String(a.account || '');
      return scanSource(source).then(function (res) { return addScanned(source, res); });
    }).catch(function (e) { U.toast(why(e), 6000); return { error: 'helper', message: why(e) }; });
  }
  // The phone app's folder picker: a folder's folders, before the source exists.
  function dropboxFolders(refresh, path) { return ask('dropbox/folders', { refresh: String(refresh || ''), path: String(path || '') }, 25000); }
  // A removed Dropbox source signs out of Dropbox (best effort: the source is gone either way).
  function signOut(source) {
    if (source && source.type === 'dropbox' && source.refresh) ask('dropbox/revoke', { refresh: source.refresh }, 25000).catch(function () {});
  }
  function dropboxHelp() { UI.menu('Dropbox', [{ label: 'Sign in with the TiviBro phone app: Settings > My media > Add media > Dropbox.' }, { label: 'Done' }]); }
  function askAddress() {
    UI.prompt('WebDAV address of your media folder', '', function (address) {
      if (!address.trim()) return;
      UI.prompt(/premiumize/i.test(address) ? 'Customer ID' : 'User name or customer ID', '', function (user) {
        UI.prompt(/premiumize/i.test(address) ? 'API key' : 'Password or API key', '', function (pass) { addAddress(address, user, pass); });
      });
    }, 'Files can be in this folder or its subfolders.  Movies and TV shows are recognised from their names.');
  }
  function addMenu() {
    UI.menu('Add media', [
      { label: 'Browse my network (DLNA / UPnP)', sub: 'Find a home media server with media sharing turned on', action: browseNetwork },
      { label: 'Add a WebDAV server', sub: 'Enter your media folder\'s address and login, or use the web editor', action: askAddress },
      { label: 'Dropbox', sub: 'Sign in with the TiviBro phone app: Settings > My media > Add media > Dropbox.', action: dropboxHelp }
    ]);
  }
  function metadataRequest(q, language) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('Add your TMDB token in Settings > My media first.'));
    q.credential = token;
    q.language = language || MediaStore.preferences().language;
    return ask('metadata', q, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  // A guide programme that may be a movie (movies.js): { metadata } or { miss }.
  // description: the guide's, which tells apart films of one name when there's no year (media-metadata.js).
  function guideLookup(title, year, strength, description) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, guide: strength || 'weak', title: title, year: year || '', description: String(description || '').slice(0, 1500), language: MediaStore.preferences().language }, 25000)
      .then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  // A TV series by name, for the guide and the Shows screen (series.js): { metadata } (the show) or { miss }.
  function tvByName(title, year, strength, country) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, kind: 'tv', guide: strength || 'weak', title: title, year: year || '', country: country || '', language: MediaStore.preferences().language }, 25000)
      .then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  // One season of a show TMDB knows ('tmdb:tv:1399'): { metadata: { episodes: [...] } }.
  function tvSeason(id, season) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, id: id, season: season, language: MediaStore.preferences().language }, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  function movieById(id) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, id: id, language: MediaStore.preferences().language }, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  var tokenVersion = 0;
  function setTmdbToken(value) {
    var version = ++tokenVersion;
    value = String(value || '').trim();
    if (!value) { MediaStore.setTmdbToken(''); refresh(); if (typeof Movies !== 'undefined') Movies.poke(); if (typeof Series !== 'undefined') Series.poke(); return Promise.resolve(MediaStore.preferences()); }
    if (!/^[A-Za-z0-9._-]{24,2048}$/.test(value)) return Promise.reject(new Error('Enter a valid TMDB API key or API Read Access Token.'));
    return ask('metadata', { credential: value, check: true }, 15000).then(function (r) {
      if (version !== tokenVersion) throw new Error('TMDB setup changed while this token was being checked.');
      if (r.error || !r.ok) throw new Error(r.message || 'TMDB did not accept that token.');
      MediaStore.setTmdbToken(value); refresh(); autoSoon(); if (typeof Movies !== 'undefined') Movies.poke(); if (typeof Series !== 'undefined') Series.poke(); return MediaStore.preferences();
    });
  }
  // Settings > My media > Test TMDB token, and the web editor: is the saved token still accepted?
  function testTmdbToken() {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token saved yet.'));
    return ask('metadata', { credential: token, check: true }, 15000).then(function (r) {
      if (r.error || !r.ok) throw new Error(r.message || 'TMDB did not accept the saved token.');
      return 'TMDB accepted the saved token.';
    });
  }
  function needToken() {
    if (MediaStore.tmdbToken()) return false;
    U.toast('Add your own TMDB API token in Settings › My media, or use the web editor.', 6500); return true;
  }
  function findDetails(m) {
    if (needToken()) return;
    UI.confirm('Search TMDB for movie details?  The movie title is sent to TMDB using your saved token.  Images load from image.tmdb.org.', 'Search', function () {
      UI.prompt('Movie title', m.title, function (title) {
        U.toast('Looking for movie details…');
        metadataRequest({ title: title }).then(function (r) {
          if (!r.matches || !r.matches.length) return U.toast('No matching movies found.  Try a different title.', 5000);
          UI.menu('Choose the matching movie', r.matches.map(function (x) { return { label: RAW(x.title + (x.year ? ' (' + x.year + ')' : '')), action: function () {
            metadataRequest({ id: x.id }).then(function (r) { return MediaStore.setMetadata(m.id, r.metadata); }).then(function () { refresh(); U.toast('Movie details saved'); }, function (e) { U.toast(why(e), 6000); });
          } }; }));
        }, function (e) { U.toast(why(e), 6000); });
      });
    });
  }
  var fetchingDetails = false, pendingLanguageRefresh = false;
  /* What to look a movie up by.  Radarr (and Plex's naming) can put the movie's IDs in the folder or file name
     ("{tmdb-1061474}", "[imdbid-tt5950044]"): those are exact.  Otherwise its title and year, and the file's own
     name as a second try: Radarr names the file for TMDB's title even when the folder says otherwise
     ("Minecraft The Movie (2025)/A Minecraft Movie (2025) WEBDL-2160p.mkv"). */
  function namedIn(m) {
    var where = String(m.path || '') + ' ' + String(m.file || '');
    var t = /[{[(]\s*tmdb(?:id)?[-=: ]\s*([1-9][0-9]{0,9})\s*[}\])]/i.exec(where);
    if (t) return { id: 'tmdb:' + t[1] };
    var i = /[{[(]\s*imdb(?:id)?[-=: ]\s*(tt[0-9]{5,10})\s*[}\])]/i.exec(where);
    if (i) return { id: i[1] };
    var alts = [], f = String(m.file || '').replace(/\.[a-z0-9]{2,4}$/i, '');
    var fy = /^(.+?)[\s._-]*[([]?((?:19|20)\d\d)[)\]]?(?:[\s._-]|$)/.exec(f);
    if (fy) { var ft = fy[1].replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(); if (ft) alts.push({ title: ft, year: fy[2] }); }
    return { title: m.title, year: m.year, alts: alts, auto: true };
  }
  function fetchDetails(list, language, quiet) {
    if (fetchingDetails) return Promise.resolve({ busy: true });
    fetchingDetails = true;
    var at = 0, found = 0, missed = 0;
    return new Promise(function (resolve) {
      function done(message, error) {
        fetchingDetails = false; if (MediaStore.flush) MediaStore.flush(); refresh();
        // On its own (autoDetails): a word only when something was found, or it stopped on an error.
        if (!quiet) U.toast(message, 7000);
        else if (error) note('warn', 'Automatic movie details stopped: ' + error);
        else if (found) U.toast('Movie details and posters added for ' + found + (found === 1 ? ' movie.' : ' movies.'), 5000);
        resolve({ updated: found, missed: missed, error: error || '' });
        if (pendingLanguageRefresh) { pendingLanguageRefresh = false; refreshMetadata().catch(function (e) { U.toast(why(e), 6000); }); }
      }
      function next() {
        if (at >= list.length) return done(found + ' movies updated.  ' + missed + ' need a manual match in movie options.');
        var m = list[at++];
        if (!MediaStore.source(m.src)) return next();
        if (!quiet) U.toast('Movie details: ' + at + ' of ' + list.length);
        var id = m.metadata && m.metadata.id;
        var q = id && /^(tmdb:[1-9][0-9]*|tt[0-9]+)$/.test(id) ? { id: id } : namedIn(m);
        metadataRequest(q, language).then(function (r) {
          if (r.metadata) {
            var current = MediaStore.movies(m.src).filter(function (x) { return x.id === m.id; })[0];
            if (!current || (current.metadata && current.metadata.id) !== id) return;
            found++; return MediaStore.setMetadata(m.id, r.metadata, true);
          } missed++;
          return MediaStore.markMissed(m.id, true);
        }).then(function () { setTimeout(next, 350); }, function (e) { done('Stopped fetching details: ' + why(e) + '  Saved matches are kept.', why(e)); });
      }
      next();
    });
  }
  function refreshMetadata() {
    if (fetchingDetails) { pendingLanguageRefresh = true; return Promise.resolve({ queued: true }); }
    if (!MediaStore.tmdbToken()) return Promise.resolve({ needsToken: true });
    return MediaStore.load().then(function () {
      if (fetchingDetails) { pendingLanguageRefresh = true; return { queued: true }; }
      var language = MediaStore.preferences().language;
      var list = MediaStore.movies(null).filter(function (m) { return m.metadata && (m.metadata.provider !== 'TMDB' || (m.metadata.requestedLanguage || m.metadata.language) !== language); });
      return list.length ? fetchDetails(list, language) : { updated: 0 };
    }).then(function(result){return showDetails(false,result);});
  }
  function showDetails(force,result){
    if(typeof MediaSeries==='undefined'||!MediaSeries.fetchDetails||result&&result.error)return Promise.resolve(result);
    return MediaSeries.fetchDetails(force).then(function(shows){if(result)result.shows=shows;return result||shows;});
  }
  function updatePreferences(next) {
    var result = MediaStore.preferences(next);
    if (next && next.language) refreshMetadata().catch(function (e) { U.toast('Language saved.  Movie details could not be refreshed: ' + why(e), 6000); });
    if (next && (typeof next.favoritesInLists === 'boolean' || next.showSort || typeof next.showSortReverse === 'boolean' || next.sourceFilter != null)) refreshSeries();
    refresh(); return result;
  }
  // The phone app's Fetch details for one source (it asks first on the phone).
  // What a source's Fetch details looks up: its movies, its shows (a TV shows only source), or both.
  function detailsKind(s) { var m = s && s.contentMode; return m === 'shows' ? 'shows' : m === 'automatic' ? 'both' : 'movies'; }
  function detailsLabel(s) { var k = detailsKind(s); return k === 'shows' ? 'Fetch show details' : k === 'both' ? 'Fetch movie and show details' : 'Fetch movie details'; }
  function runDetails(s, force) {
    var k = detailsKind(s), shows = function (r) { return typeof MediaSeries !== 'undefined' ? MediaSeries.fetchDetails(true).then(function (x) { return { updated: (r && r.updated || 0) + (x && x.updated || 0), shows: x && x.updated || 0, movies: r && r.updated || 0 }; }) : r; };
    if (k === 'shows') return shows(null);
    return MediaStore.load().then(function () { return fetchDetails(MediaStore.movies(s.id), MediaStore.preferences().language); }).then(function (r) { return k === 'both' ? shows(r) : r; });
  }
  function sourceDetailsNow(id) {
    if (!MediaStore.tmdbToken()) return Promise.reject(new Error('Save your TMDB token first.'));
    var s = MediaStore.source(id);
    if (fetchingDetails && detailsKind(s) !== 'shows') return Promise.reject(new Error('Movie details are already being fetched.'));
    return runDetails(s, true);
  }
  function sourceDetails(s) {
    if (needToken()) return;
    var k = detailsKind(s);
    if (fetchingDetails && k !== 'shows') return U.toast('Movie details are already being fetched.');
    UI.confirm(k === 'shows' ? 'Fetch show details from TMDB?  Show names and years or saved show IDs are sent to TMDB.  Images load from image.tmdb.org.  Your source logins are never sent.'
      : 'Fetch movie details from TMDB?  Titles and years or saved movie IDs are sent to TMDB.  Images load from image.tmdb.org.  Your source logins are never sent.', 'Fetch details', function () {
      runDetails(s).catch(function (e) { U.toast(why(e), 6000); });
    });
  }
  /* Movies without details or a poster are looked up on their own once a TMDB token is saved: after a
     scan and when TiviBro starts.  The token is the go-ahead (the same titles a manual fetch sends).
     One TMDB had no match for waits a week; a manual fetch or Find movie details still tries. */
  var WEEK = 7 * 86400e3, autoTimer = null;
  function note(lv, m) { if (typeof Log !== 'undefined' && Log[lv]) Log[lv]('media', m); }
  function needsDetails(m, now) {
    // (missV 3: missed by the matcher of alpha 145, which also reads TMDB's year filter right; older misses try again)
    if (m.tmdbMiss && m.missV >= 3 && now - m.tmdbMiss < WEEK) return false;
    // Details from before collections, directors and plain backdrops (v 2) are fetched again by their ID.
    return !m.metadata || (!m.metadata.poster && m.metadata.provider !== 'TMDB') || (m.metadata.provider === 'TMDB' && /^tmdb:[0-9]+$/.test(m.metadata.id || '') && (m.metadata.v || 1) < 2);
  }
  function autoDetails() {
    if (!MediaStore.tmdbToken() || fetchingDetails || scanningAll || Object.keys(scanning).length || !MediaStore.sources().length) return Promise.resolve({ skipped: true });
    return MediaStore.load().then(function () {
      var now = Date.now(), list = MediaStore.movies(null).filter(function (m) { return needsDetails(m, now); });
      if (!list.length) return { updated: 0 };
      note('info', 'Looking up details for ' + list.length + ' movie(s) on their own');
      return fetchDetails(list, MediaStore.preferences().language, true);
    }).then(function(result){return showDetails(false,result);}).catch(function (e) { note('warn', 'Automatic media details: ' + why(e)); return { error: why(e) }; });
  }
  function autoSoon(ms) { clearTimeout(autoTimer); autoTimer = setTimeout(function () { try { autoDetails(); } catch (e) { note('warn', 'Automatic movie details: ' + e.message); } }, ms || 3000); }
  var scanningAll = false;
  function rescanAll() {
    if (scanningAll || Object.keys(scanning).length) { U.toast('A media rescan is already running.'); return Promise.resolve(); }
    var sources = MediaStore.sources();
    if (!sources.length) { U.toast('Add a media source in Settings › My media first.', 5000); return Promise.resolve(); }
    scanningAll = true;
    var at = 0, failures = 0, kept = 0;
    return MediaStore.load().then(function next() {
      if (at >= sources.length) return;
      return rescan(sources[at++].id).then(function (r) { if (r && r.error) failures++; if (r && r.kept) kept++; return next(); });
    }).then(function () {
      scanningAll = false; refresh(); autoSoon(8000); U.toast(failures ? 'Rescan finished.  ' + failures + ' sources could not be read; their saved movies are kept.' : kept ? 'Media rescan finished.  The list stays as it was where scans found no movies.' : 'Media rescan finished.  Press Yellow to fetch missing movie details.', 6000);
    }, function (e) { scanningAll = false; U.toast('Could not finish the rescan: ' + why(e), 6000); });
  }
  function fetchMissingDetails() {
    if (needToken()) return Promise.resolve();
    if (scanningAll || Object.keys(scanning).length) { U.toast('Wait for the media rescan to finish, then press Yellow.', 5000); return Promise.resolve(); }
    if (fetchingDetails) { U.toast('Movie details are already being fetched.'); return Promise.resolve(); }
    return MediaStore.load().then(function () {
      var language = MediaStore.preferences().language;
      var list = MediaStore.movies(null).filter(function (m) { return !m.metadata || m.metadata.provider !== 'TMDB' || (m.metadata.requestedLanguage || m.metadata.language) !== language; });
      if (!list.length) return { updated: 0 };
      return fetchDetails(list, language);
    }).then(function(result){return showDetails(true,result);}).catch(function (e) { U.toast(why(e), 6000); });
  }
  function sourceMenu(s) {
    if (!s) return;s=MediaStore.source(s.id)||s;
    UI.menu(RAW(s.name), [
      scanning[s.id]&&{label:'Pause scan',action:function(){pausedScans[s.id]=true;ask('scan/control',{sourceId:s.id},15000).then(function(){U.toast('Scan will pause after the current request.');});}},
      !scanning[s.id]&&{label:'Restart scan',action:function(){rescan(s.id,true);}},
      { label: detailsLabel(s), sub: 'TMDB · uses your saved API token', action: function () { sourceDetails(s); } },
      { label: 'Content: ' + (s.contentMode === 'automatic' ? 'Movies and TV shows' : s.contentMode === 'shows' ? 'TV shows only' : 'Movies only'), action: function () { UI.menu('Source content', ['automatic','movies','shows'].map(function (mode) { return {label:mode === 'automatic' ? 'Movies and TV shows' : mode === 'movies' ? 'Movies only' : 'TV shows only',action:function () { changeSourceMode(s.id,mode).catch(function(e){U.toast(why(e),6000);}); }}; })); } },
      { label:'Review excluded files',action:function(){MediaSeries.excluded();} },
      { label: 'TV shows', action: function () { MediaSeries.open(); } },
      { label: 'Rescan', sub: 'Look for added or removed movies and episodes', action: function () { rescan(s.id); } },
      { label: 'Remove', sub: 'Your files stay where they are', action: function () {
        UI.confirm('Remove ' + s.name + ' from My media?' + (s.type === 'dropbox' ? '  TiviBro signs out of Dropbox on this TV.' : ''), 'Remove', function () { MediaStore.load().then(function () { var gone = MediaStore.source(s.id); MediaStore.removeSource(s.id); signOut(gone); ask('library/source',{sourceId:s.id,action:'remove'},30000).then(function(){refresh();UI.menu(s.name+' removed',(gone && gone.type === 'dropbox' ? [] : [{label:'Undo removal',action:function(){if(MediaStore.restoreSource(s.id))ask('library/source',{sourceId:s.id,action:'activate'},30000).then(function(){refresh();rescan(s.id);});}}]).concat([{label:'Done'}]));},function(e){U.toast(why(e),6000);}); }); });
      } }
    ]);
  }

  /* ---------- playback ---------- */
  function play(m, fromStart) {
    if (!m) return;
    if (m.continueEpisode) return MediaSeries.resume(m);
    if (m.kind === 'live') { if (typeof OnNow !== 'undefined' && OnNow.watch) OnNow.watch(m.live); else Views.startChannel(m.live.c, false, function () { Views.goFull(); }); return; }
    if (m.kind === 'show') return MediaSeries.showItem(m,restore);
    if (m.review && m.review.length) return MediaSeries.correct(m,restore);
    if (typeof MediaSeries !== 'undefined') MediaSeries.leave();
    var token = ++playToken, r = MediaStore.resume(m.resumeKey || m.id);
    var startAt = !fromStart && r && r.pos > (m.kind === 'episode' ? 5 : 30) && r.pos < r.dur - (m.kind === 'episode' ? 1 : 60) ? Math.max(0,r.pos - 5) : 0;
    if (m.startSec != null && (startAt < m.startSec || (m.endSec != null && startAt >= m.endSec))) startAt = m.startSec;
    function go(url) {
      if (token !== playToken || !MediaStore.source(m.src) || $('viewMedia').classList.contains('hidden') || document.body.classList.contains('nav-open')) return;   // moved on while waiting: nothing starts by itself
      if(m.kind==='episode'){try{Log.hideLinksFrom(String(url).split('/')[2]);}catch(e){}}
      var md = m.metadata || {};
      // The player's lines: the name once, then the year, running time, genres and rating (not the year twice).
      playingMeta = { id: m.resumeKey || m.id, media: null, title: m.kind === 'episode' ? label(m) : nameOf(m), sub: m.kind === 'episode' ? m.year || '' : [m.year || md.year, md.runtime, genresOf(m).slice(0, 2).join(', '), rating(m) ? '★ ' + md.rating : ''].filter(Boolean).join('   ·   '), poster: md.poster ? wrap(md.poster) : '', item: m, local: true, lastPos:startAt,lastAt:Date.now(),continuous:0,session:Date.now()+'_'+token,startedAt:Date.now(),sequence:0 };
      m.playStartedAt=playingMeta.startedAt;
      clearInterval(progressTimer);
      if (m.kind === 'episode') progressTimer = setInterval(function () { checkpoint(true); if (playingMeta && !playingMeta.boundaryPending && playingMeta.item.endSec != null && Player.position >= playingMeta.item.endSec) boundary(); },1000);
      Views.playVod(playingMeta, url, startAt, function () { open(true);if(m.returnTo)m.returnTo(); });
    }
    if (m.url) return go(m.url);
    var src = MediaStore.source(m.src);
    if (!src || !m.path) { U.toast('This movie\'s source was removed.'); return; }
    U.toast('Opening ' + m.title + '…');
    ask('resolve', { source: src, path: m.path }, 25000).then(function (res) {
      if (token !== playToken) return;
      if (res.error || !res.url) { U.toast(res.message || 'Could not open that movie.', 6000); return; }
      try { Log.hideLinksFrom(String(res.url).split('/')[2]); } catch (e) {}
      go(res.url);
    }, function (e) { if (token === playToken) U.toast('Could not open that movie: ' + why(e), 6000); });
  }
  function checkpoint(sample) {
    if (!playingMeta) return;
    if (playingMeta.item.kind === 'episode') {
      var now = Date.now(), delta = Player.position - playingMeta.lastPos, elapsed = (now - playingMeta.lastAt) / 1000;
      if (delta > 0 && delta <= elapsed * 1.5 + 2) playingMeta.continuous += Math.min(delta,elapsed);
      else if (delta < -1 || delta > elapsed * 1.5 + 2) playingMeta.continuous = 0;
      playingMeta.lastPos = Player.position; playingMeta.lastAt = now;
      if (!sample || !playingMeta.lastSaved || now - playingMeta.lastSaved >= 10000) { MediaStore.saveEpisodeResume(playingMeta.id,Player.position,Player.duration); playingMeta.lastSaved = now;
        if(Player.duration>0)ask('library/progress',{handle:playingMeta.item.id,position:Player.position,duration:Player.duration,session:playingMeta.session,startedAt:playingMeta.startedAt,sequence:++playingMeta.sequence,final:!sample},15000).catch(function(){});
      }
    } else MediaStore.saveResume(playingMeta.id, Player.position, Player.duration);
  }
  function boundary(){
    if(!playingMeta||playingMeta.boundaryPending)return;
    var meta=playingMeta,file=meta.item,length=(file.endSec||Player.duration)-(file.startSec||0);
    if(meta.continuous<Math.min(30,length*0.1))return ended();
    meta.boundaryPending=true;clearInterval(progressTimer);progressTimer=null;Player.setPaused(true);checkpoint();
    function stop(){if(playingMeta!==meta)return;playingMeta=null;Views.stopAll();open(true);}
    MediaSeries.completed(file,{
      stop:stop,
      cancel:function(){stop();if(file.returnTo)file.returnTo();},
      continue:function(ep,range){
        if(playingMeta!==meta)return;
        file.episodeHandle=ep.handle;file.showId=ep.showId;file.number=ep.number;file.season=ep.season;file.order=ep.order;file.startSec=range.startSec;file.endSec=range.endSec;file.segmented=true;file.libraryRevision=ep.revision;file.playStartedAt=Date.now();
        file.returnTo=ep.originPage||file.returnTo;
        file.title=(ep.metadata&&ep.metadata.title||ep.title||'Episode')+'  '+(ep.label||'');
        meta.title=file.title;meta.continuous=0;meta.lastPos=Player.position;meta.lastAt=Date.now();meta.boundaryPending=false;
        if(Player.position<range.startSec||Player.position>range.startSec+2)Player.seekTo(range.startSec);
        Player.setPaused(false);if(Views.refreshVodMeta)Views.refreshVodMeta();
        progressTimer=setInterval(function(){checkpoint(true);if(playingMeta&&!playingMeta.boundaryPending&&playingMeta.item.endSec!=null&&Player.position>=playingMeta.item.endSec)boundary();},1000);
      }
    });
  }
  function stopped() {
    clearInterval(progressTimer); progressTimer = null;if(typeof MediaSeries!=='undefined')MediaSeries.leave(); if (!playingMeta) return; checkpoint();
    var item = playingMeta.item, length = (item.endSec || Player.duration) - (item.startSec || 0);
    var position = Player.position - (item.startSec || 0);
    if (item.kind === 'episode' && length > 0 && position >= length - Math.min(60,length * 0.1) && playingMeta.continuous >= Math.min(30,length * 0.1)) {
      if (typeof MediaSeries !== 'undefined') MediaSeries.recordCompletion(item);
    }
    playingMeta = null;
  }
  function ended() {
    clearInterval(progressTimer); progressTimer = null;
    checkpoint();
    var finished = playingMeta && playingMeta.item;
    var eligible = !finished || finished.kind !== 'episode' || playingMeta.continuous >= ((finished.endSec || Player.duration) > 0 ? Math.min(30,((finished.endSec || Player.duration) - (finished.startSec || 0)) * 0.1) : 5);
    if (playingMeta) { if (playingMeta.item && playingMeta.item.kind !== 'episode') MediaStore.markWatched(playingMeta.id, true); else MediaStore.clearResume(playingMeta.id); }
    playingMeta = null;
    Views.stopAll();
    open(true);
    if (eligible && typeof MediaSeries !== 'undefined') MediaSeries.completed(finished);
  }
  /* ---------- the phone app (app/js/phone.js) ----------
     My media on the phone, in the same shape as Movies (Vod.phone): the shelves as categories, a page of
     movies, one movie's details, and playing it on the TV (from where it stopped, or from the start). */
  function phoneTitle(m) { return (m.metadata && m.metadata.title) || m.title; }
  function phoneFind(id) {
    var m = MediaStore.movies(null).filter(function (x) { return x.id === String(id); })[0];
    if (!m) throw new Error('That movie is no longer in My media.  Rescan on the TV.');
    return m;
  }
  function phoneSlim(m) {
    var r = MediaStore.resume(m.id), md = m.metadata || {}, x = { id: m.id, n: phoneTitle(m), c: md.poster || '', r: '' };
    if (m.year || md.year) x.y = String(m.year || md.year).slice(0, 4);
    if (r && r.dur) x.p = Math.round(100 * r.pos / r.dur);
    return x;
  }
  var ForPhone = {
    cats: function () {
      if (!MediaStore.sources().length) return Promise.resolve({ none: true, cats: [] });
      return MediaStore.load().then(function () {
        return { cats: movieShelves().map(function (s) { return { id: s.id, n: s.title, count: s.movies.length, adult: 0, locked: 0 }; }) };
      });
    },
    items: function (cid, q, off, lim) {
      return MediaStore.load().then(function () {
        var list;
        q = String(q || '').trim().toLowerCase();
        if (q) list = MediaStore.movies(null).filter(function (m) { return phoneTitle(m).toLowerCase().indexOf(q) >= 0 || String(m.title).toLowerCase().indexOf(q) >= 0; });
        else list = (movieShelves().filter(function (s) { return s.id === (cid || 'all'); })[0] || { movies: [] }).movies;
        off = Math.max(0, +off || 0); lim = Math.min(300, Math.max(1, +lim || 120));
        return { total: list.length, offset: off, items: list.slice(off, off + lim).map(phoneSlim) };
      });
    },
    info: function (id) {
      return MediaStore.load().then(function () {
        var m = phoneFind(id), md = m.metadata || {}, r = MediaStore.resume(m.id), src = MediaStore.source(m.src);
        return { id: m.id, n: phoneTitle(m), c: md.poster || '', plot: md.plot || '', genre: md.genre || '', cast: '', year: String(m.year || md.year || '').slice(0, 4),
          dur: md.runtime || '', r: '', media: [fileInfo(m), m.size ? size(m.size) : '', src ? src.name : ''].filter(Boolean).join('   ·   '),
          pos: r ? Math.round(r.pos) : 0, len: r ? Math.round(r.dur) : 0, fav: MediaStore.isFavorite(m.id) ? 1 : 0 };
      });
    },
    // My media plays from its own screen on the TV, so the TV goes there first (Back then lands on the movie).
    play: function (id, fromStart) {
      return MediaStore.load().then(function () {
        var m = phoneFind(id);
        if (Views.tab !== 'media') Views.switchTab('media');
        if (Views.tab !== 'media') throw new Error('My media could not be opened on the TV.');
        if (document.body.classList.contains('nav-open') && Views.closeNav) Views.closeNav();
        open(true);
        play(m, !!fromStart);
        return { title: phoneTitle(m) };
      });
    }
  };

  function itemMenu(m) {
    if (!m) return;
    if (m.kind === 'show') return MediaSeries.showItem(m,restore);
    if (m.kind === 'live') return play(m);
    if (m.review && m.review.length) return MediaSeries.correct(m,restore);
    var r = MediaStore.resume(m.id);
    UI.menu(RAW(label(m)), [
      { label: MediaStore.isFavorite(m.id) ? 'Remove from Favorites' : 'Add to Favorites', action: function () { MediaStore.toggleFavorite(m.id); refresh(); } },
      r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(m, false); } },
      { label: r ? 'Play from beginning' : 'Play', action: function () { play(m, true); } },
      { label: m.metadata ? 'Change movie details' : 'Find movie details', sub: 'Search TMDB and choose the correct match', action: function () { findDetails(m); } },
      m.metadata && { label: 'Remove movie details', action: function () { MediaStore.setMetadata(m.id, null); refresh(); } },
      { label:'TV shows',action:function () { MediaSeries.open(); } },
      reviewCards.length > 0 && { label:'Needs review',action:function () { MediaSeries.review(); } },
      copies(m).length > 1 && { label: 'Choose a copy', sub: copies(m).length + ' copies of this movie', action: function () { UI.menu('Play which copy?', copies(m).map(function (x) { var src = MediaStore.source(x.src); return { label: RAW((src ? src.name : 'Unknown source') + (fileInfo(x) ? '   ·   ' + fileInfo(x) : '')), sub: x.size ? size(x.size) : '', action: function () { play(x, false); } }; })); } },
      { label: 'File information', sub: pictureInfo(m) + (m.size ? ' · ' + size(m.size) : ''), action: function () { UI.menu('File information', [{ label: RAW(m.file), sub: (MediaStore.source(m.src) || {}).name || '' }]); } },
      !MediaStore.isWatched(m.id) ? { label: 'Mark as watched', action: function () { MediaStore.markWatched(m.id, true); refresh(); } } : { label: 'Mark as not watched', action: function () { MediaStore.markWatched(m.id, false); refresh(); } }
    ]);
  }

  /* ---------- remote and pointer navigation ---------- */
  function hints() {
    if (document.body.classList.contains('nav-open')) return;
    var m = itemsVL.current();
    if (tabsFocus) return UI.hints([['', '◀ ▶  Home, Movies, TV shows'], ['', '▼  shelves'], ['', 'Back  menu', 'back']]);
    if (m && m.kind === 'section') return UI.hints([['', 'OK  open ' + m.title], ['', 'Back  menu', 'back'], ['red', 'Sort and shelves'], ['green', 'Rescan'], ['yellow', 'Fetch details'], ['blue', 'Settings']]);
    UI.hints([['', m && m.kind === 'live' ? 'OK  watch' : 'OK  play'], ['', 'Hold OK  options', 'hold'], ['', 'Back  menu', 'back'], ['red', 'Sort and shelves'], ['green', 'Rescan'], ['yellow', 'Fetch details'], ['blue', 'Settings']]);
  }
  /* Red: sort, go to a shelf, arrange shelves, which source, and the focused title's options. */
  function goShelf(id) { var i = shelves.map(function (s) { return s.id; }).indexOf(id); if (i >= 0) { shelfAt = i; drawShelves(); hints(); } }
  function sortMenu(kind) {
    var p = MediaStore.preferences(), show = kind === 'show', names = show ? SHOW_SORT : SORT, at = show ? p.showSort : p.sort;
    UI.menu(show ? 'Sort TV shows' : 'Sort movies', Object.keys(names).map(function (k) {
      return { label: (k === at ? '●  ' : '○  ') + names[k], current: k === at, action: function () { updatePreferences(show ? { showSort: k } : { sort: k }); } };
    }).concat([{ label: 'Reverse the order: ' + ((show ? p.showSortReverse : p.sortReverse) ? 'On' : 'Off'), sub: show ? 'Z to A, oldest, lowest first' : 'Z to A, oldest, lowest, shortest first', action: function () { updatePreferences(show ? { showSortReverse: !p.showSortReverse } : { sortReverse: !p.sortReverse }); } },
      { label: show ? 'Sort movies…' : 'Sort TV shows…', sub: sortName(show ? 'movie' : 'show'), action: function () { sortMenu(show ? 'movie' : 'show'); } }]));
  }
  /* Arrange shelves: on the TV a board moved with the remote (arrange.js), from the phone app's Settings a
     menu.  Only the shelves that fit what you have (no TV lists with only movies); the others keep their
     place at the end. */
  function arrangeMenu(focus) {
    var ar = arrangement(), p = MediaStore.preferences(), h = has(), mine = ar.order.filter(function (k) { return fits(k, h) && (!split || section === 'favorites' || inSection(k, section)); });
    function save(order, off) { var rest = ar.order.filter(function (k) { return order.indexOf(k) < 0; }); var o = {}; Object.keys(p.shelfOff || {}).forEach(function (x) { o[x] = p.shelfOff[x]; }); Object.keys(off).forEach(function (x) { o[x] = off[x]; }); updatePreferences({ shelfOrder: order.concat(rest), shelfOff: o }); p = MediaStore.preferences(); ar = arrangement(); }
    function label(k) { if (k !== 'holidays') return NAMES[k]; var on = holidaysNow().map(function (x) { return x.h.title.replace(/ movies$/, ''); }); return NAMES[k] + (on.length ? '  (now: ' + on.join(', ') + ')' : ''); }
    var phone = typeof Settings !== 'undefined' && Settings.capturing && Settings.capturing();
    if (!phone && typeof Arrange !== 'undefined') {
      return Arrange.open({ title: split ? 'Arrange ' + (section === 'home' ? 'Home' : section === 'shows' ? 'TV shows' : section === 'favorites' ? 'My media' : 'Movies') : 'Arrange My media', focus: focus, rows: mine.map(function (k) { return { key: k, name: label(k), off: ar.off(k) }; }),
        save: function (order, off) { save(order, off); }, reset: function () { updatePreferences({ shelfOrder: [], shelfOff: {} }); },
        done: function () { if (Views.tab === 'media' && !$('viewMedia').classList.contains('hidden')) restore(); else if (typeof Settings !== 'undefined' && Settings.redraw) Settings.redraw(); } });
    }
    UI.menu('Arrange shelves', mine.map(function (k, i) {
      return { label: (ar.off(k) ? '○  ' : '●  ') + label(k), sub: ar.off(k) ? 'Off' : 'Shelf ' + (i + 1), current: k === focus, action: function () {
        function moved(j) { var o = mine.slice(); o.splice(i, 1); o.splice(j, 0, k); save(o, {}); arrangeMenu(k); }
        UI.menu(label(k), [
          i > 0 && { label: 'Move up', action: function () { moved(i - 1); } },
          i < mine.length - 1 && { label: 'Move down', action: function () { moved(i + 1); } },
          i > 0 && { label: 'Move to the top', action: function () { moved(0); } },
          i < mine.length - 1 && { label: 'Move to the bottom', action: function () { moved(mine.length - 1); } },
          { label: ar.off(k) ? 'Switch on' : 'Switch off', action: function () { var off = {}; off[k] = !ar.off(k); save(mine, off); arrangeMenu(k); } },
          { label: 'Back', action: function () { arrangeMenu(k); } }
        ].filter(Boolean));
      } };
    }).concat([{ label: 'Back to the way it was', sub: 'The first order, with Now playing and Upcoming off', action: function () { updatePreferences({ shelfOrder: [], shelfOff: {} }); arrangeMenu(); } }]));
  }
  function sourceMenuPick() {
    var p = MediaStore.preferences(), list = MediaStore.sources();
    UI.menu('Show', [{ label: (p.sourceFilter ? '○  ' : '●  ') + 'All sources', current: !p.sourceFilter, action: function () { updatePreferences({ sourceFilter: '' }); } }].concat(list.map(function (x) {
      return { label: (p.sourceFilter === x.id ? '●  ' : '○  ') + RAW(x.name), current: p.sourceFilter === x.id, action: function () { updatePreferences({ sourceFilter: x.id }); } };
    })));
  }
  function mediaOptions() {
    var m = itemsVL.current(), s = shelves[shelfAt], p = MediaStore.preferences(), show = s && s.id === 'shows', src = p.sourceFilter && MediaStore.source(p.sourceFilter);
    UI.menu('My media', [
      { label: (show ? 'Sort TV shows: ' : 'Sort movies: ') + sortName(show ? 'show' : 'movie'), action: function () { sortMenu(show ? 'show' : 'movie'); } },
      { label: 'Go to a shelf', sub: count(shelves.length, '1 shelf', '{n} shelves'), action: function () { UI.menu('Go to a shelf', shelves.map(function (x) { return { label: RAW(x.title), sub: String(x.movies.length), current: x === s, action: function () { goShelf(x.id); } }; })); } },
      { label: 'Arrange shelves', sub: 'Move shelves up or down, switch them off', action: function () { arrangeMenu(s && (s.id.indexOf('holiday:') === 0 ? 'holidays' : s.genre ? 'genres' : s.id)); } },
      MediaStore.sources().length > 1 && { label: 'Show: ' + (src ? RAW(src.name) : 'All sources'), action: sourceMenuPick },
      m && { label: m.kind === 'show' ? 'Show options' : m.kind === 'live' ? (m.live.live ? 'Watch now' : 'Remind me') : 'Movie options', action: function () { itemMenu(m); } },
      has().shows && { label: 'TV shows', action: function () { MediaSeries.open(); } },
      reviewCards.length > 0 && { label: 'Needs review', action: function () { MediaSeries.review(); } }
    ].filter(Boolean));
  }
  // Past the last shelf: back to the first, and Up on the first round to the last (one press, not held).
  function moveShelf(d) {
    var row = shelfAt + d;
    if ((row < 0 || row >= shelves.length) && !UI.repeating && shelves.length > 2) row = d > 0 ? 0 : shelves.length - 1;
    if (row >= 0 && row < shelves.length && row !== shelfAt) { shelfAt = row; drawShelves(); hints(); }
  }
  function keys(a) {
    followTop = false;
    if (a !== 'ok') playToken++;
    if (a === 'green') { rescanAll(); return true; }
    if (a === 'yellow') { fetchMissingDetails(); return true; }
    if (a === 'red') { mediaOptions(); return true; }
    if (a === 'blue') { Views.switchTab('settings'); Settings.section('media'); return true; }
    if (tabsFocus) {
      var si = SECTIONS.map(function (x) { return x[0]; }).filter(function (k) { return k !== 'favorites' || counts.favorites; }), cur = si.indexOf(section);
      if (a === 'left' || a === 'right') { setSection(si[(cur + (a === 'left' ? -1 : 1) + si.length) % si.length]); drawTabs(); hints(); }
      else if (a === 'down' || a === 'ok') { tabsFocus = false; drawTabs(); drawShelves(); hints(); }
      else if (a === 'back') { tabsFocus = false; drawTabs(); Views.tabBar(restore); }
      return true;
    }
    var s = shelves[shelfAt], at = s && shelfPos[s.id] || 0;
    if (a === 'up' && split && shelfAt === 0) { tabsFocus = true; drawTabs(); drawShelves(); hints(); return true; }
    if (a === 'up') moveShelf(-1);
    else if (a === 'down') moveShelf(1);
    else if (a === 'back' || (a === 'left' && at === 0)) Views.tabBar(restore);
    else if (s && (a === 'left' || a === 'right' || a === 'chup' || a === 'chdown')) {
      shelfPos[s.id] = Math.max(0, Math.min(s.movies.length - 1, at + (a === 'left' ? -1 : a === 'right' ? 1 : a === 'chup' ? -6 : 6))); drawShelves(); hints();
    } else if (a === 'ok') { var cm = itemsVL.current(); if (cm && cm.kind === 'section') { tabsFocus = false; setSection(cm.section); } else play(cm, false); }
    else if (a === 'hold' || a === 'info') { var hm = itemsVL.current(); if (hm && hm.kind !== 'section') itemMenu(hm); }
    return true;
  }
  function restore() { UI.setHandler(keys);refreshSeries(); if (shelves.length) drawShelves(); hints(); }
  function build() {
    var v = $('viewMedia'), bd = U.el('div', 'media-bd'), img = U.el('img', 'media-hero-art'), fade = U.el('div', 'media-fade');
    img.alt = ''; bd.appendChild(img); bd.appendChild(fade);
    if (v.insertBefore && v.firstChild) v.insertBefore(bd, v.firstChild); else v.appendChild(bd);
    hero = { img: img };
    var tabs = U.el('div', 'media-tabs hidden'); tabs.id = 'mediaTabs'; tabs.setAttribute('role', 'tablist'); v.appendChild(tabs);
    built = true;
  }
  function refreshSeries() {
    if (seriesLoading) { seriesAgain = true; return; }   // asked again mid-load (a setting changed): load once more after
    seriesLoading = true; seriesAgain = false;
    Promise.all([ask('library/query',MediaStore.preferences().favoritesInLists?{kind:'show',limit:300}:{kind:'show',favourite:false,limit:300},30000),ask('library/query',{kind:'review',limit:60},30000),ask('library/continue',{},30000),ask('library/query',{kind:'show',favourite:true,limit:300},30000)]).then(function (results) {
      seriesCards = (results[0].items || []).map(function (r) { r.id = r.handle; return r; });
      reviewCards = (results[1].items || []).map(function (r) { r.id = r.handle; return r; });
      continuingShows = (results[2].items || []).map(function(r){r.id=r.handle;return r;});
      favouriteShows=(results[3].items||[]).map(function(r){r.id=r.handle;return r;});
      seriesLoading = false; refresh();
      if (seriesAgain) refreshSeries();
    },function () { seriesLoading = false; if (seriesAgain) refreshSeries(); });
  }
  function open(keepState) {
    playToken++;
    if (!built) build(); UI.setHandler(keys);
    if (!keepState) { followTop = true; shelfPos = {}; section = 'home'; tabsFocus = false; }
    refreshSeries(); listsSoon();
    if (keepState && loaded) { refresh(); restore(); return; }
    (loaded || (loaded = MediaStore.load())).then(function () {
      if ($('viewMedia').classList.contains('hidden')) return;
      refresh(); restore();
    }).catch(function (e) { U.toast('Could not read My media: ' + why(e), 5000); });
  }

  return {
    reviewCount: function () { return reviewCards.length; },      // how many need a look (the show options offer Needs review)
    refreshShows:refreshSeries, foundText: foundText, discover: discover, addServer: addServer, sourceDetailsNow: sourceDetailsNow, isScanning: function (id) { return !!scanning[id]; }, changeSourceMode:changeSourceMode, pauseScans:function(){Object.keys(scanning).forEach(function(id){pausedScans[id]=true;ask('scan/control',{sourceId:id},15000).catch(function(){});});}, leave: function () { playToken++; stopped(); if (typeof MediaSeries !== 'undefined') MediaSeries.leave(); }, scanSource: scanSource, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, rescan: rescan, addAddress: addAddress, addDropbox: addDropbox, dropboxFolders: dropboxFolders, signOut: signOut,
    rescanAll: rescanAll, guideLookup: guideLookup, movieById: movieById, tvByName: tvByName, tvSeason: tvSeason, autoDetails: autoDetails, autoSoon: autoSoon, testTmdbToken: testTmdbToken, fetchMissingDetails: fetchMissingDetails, setTmdbToken: setTmdbToken, updatePreferences: updatePreferences, arrangeShelves: function () { arrangeMenu(); }, shelfList: function () { var ar = arrangement(), h = has(); return ar.order.filter(function (k) { return fits(k, h); }).map(function (k) { return { key: k, name: NAMES[k], off: ar.off(k) }; }); }, holidaysNow: holidaysNow, refreshMetadata: refreshMetadata, addMenu: addMenu, sourceMenu: sourceMenu,
    watchedReset:function(handle,revision){if(playingMeta&&playingMeta.item.episodeHandle===handle){playingMeta.continuous=0;playingMeta.lastPos=Player.position;playingMeta.lastAt=Date.now();playingMeta.item.libraryRevision=revision;playingMeta.item.playStartedAt=Date.now();}}, seeking: function (target) { if (playingMeta) { playingMeta.continuous = 0; playingMeta.lastPos = target; playingMeta.lastAt = Date.now(); } }, currentFile: function () { return playingMeta && playingMeta.item.id; }, cancelPending: function () { playToken++; }, request: ask, playFile: play, restore: restore, refresh: refresh, leftOut: leftOut, phone: ForPhone,
    _test: { namedIn: namedIn, section: function (x) { if (x) { tabsFocus = false; setSection(x); } return { section: section, split: split, tabs: tabsFocus }; }, goShelf: function (id) { followTop = false; goShelf(id); }, addServer: addServer, addAddress: addAddress, addDropbox: addDropbox, focusItems: function () { restore(); }, rescanCurrent: function () { var s = MediaStore.sources()[0]; return s ? rescan(s.id) : Promise.resolve(); } }
  };
})();
