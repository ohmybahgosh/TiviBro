/* Movies on now: guide programmes that are movies, confirmed and filled in by TMDB with your own token
   (Settings > Movies and shows).
   Which programmes might be movies:
     strong  the guide says Movie (its <category>), the title has a year or "Movie:", or a movie
             channel (HBO, Cinemax, TCM, a "Movies" group…) shows something 75 minutes or longer
     weak    anything else 80 minutes to 4 hours long that isn't news, sport, a show or a marathon
   Each is looked up once (the helper asks TMDB, media-metadata.js guideLookup): a movie of exactly that
   title, and for a weak one also well known and not a TV series of the same name.  Answers, misses too,
   are kept for 30 days, so after the first day only a few titles an hour go to TMDB.
   What it gives: Movies.of(c, p) for the guide's details (poster, year, genres, rating) and the "Movie"
   tag in the grid, and the Movies on now group (Library.MOVIES): movies on now, most left first, then
   the ones starting within the hour. */
var Movies = (function () {
  // tvmovies2: looked up again with the guide's description (films of one name, issue: Black Sheep was 2006's).
  var KEY = 'tvmovies2', KEEP = 30 * 86400e3, MAX = 4000, MAX_LOW = 1500, SOON = 3600e3, LOOK = 3 * 3600e3, PER_SCAN = 150, GAP = 400;
  var cache = {}, loaded = null, ver = 1, queue = [], queued = {}, busy = false, timer = null, saveT = null, hooked = false;
  var found = [], foundAt = 0, lastScan = 0;
  function S() { return Store.settings; }
  function on() { return S().guideMovies !== false && typeof MediaStore !== 'undefined' && !!MediaStore.tmdbToken(); }
  function groupOn() { return on() && S().moviesGroup !== false; }
  function norm(t) { return String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }

  // "Movie: Bridesmaids (2011) [HD]" -> { t: Bridesmaids, y: 2011 }
  // Superscript tags some guides add ("Mrs. Doubtfire ᴺᵉʷ", "Volleyball ᴸᶦᵛᵉ").
  var SUP = /[\u02b0-\u02ff\u1d2c-\u1d6a\u1d9c-\u1dbf\u2070-\u209f]+/g;
  function clean(t) {
    t = String(t || '').replace(SUP, ' ');
    var m = /\(((?:19|20)\d\d)\)/.exec(t), y = m ? m[1] : '';
    var x = t.replace(/^\s*(?:new\s+)?(?:movie|film|feature|premiere)\s*[:\-–]\s*/i, '').replace(/\((?:19|20)\d\d\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s*[-–|]\s*(?:u?hd|sd|4k|fhd)\s*$/i, '').replace(/\s+(?:u?hd|cc)\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
    return { t: x, y: y };
  }
  var MOVIE_CH = /\b(hbo|cinemax|starz|encore|showtime|mgm\+?|epix|tcm|turner classic|amc|fxm|fx movies?|hallmark (?:movies|mystery)|lifetime movies?|lmn|ifc|sundance|flix|reelz|sony movies?|movies?|cinema|cine|films?|filmes|peliculas|kino)\b/i;
  var NOT = /\b(news|live|tonight|today|morning|show|radio|tv|report|update|countdown|marathon|concert|awards?|idol|dancing|island|vs\.?|football|basketball|hockey|baseball|soccer|volleyball|softball|tennis|cricket|rugby|skating|wrestling|world series|grand prix|gp|qualif\w*|nfl|nba|nhl|mlb|mls|wnba|ncaa[bfmw]?|ufc|wwe|aew|boxing|golf|nascar|racing|paid program(?:ming)?|infomercial|worship|church|sign.?off|off.?air|to be announced|tba|episode|season \d|s\d+\s?e\d+|highlights|weather|next game|pregame|postgame|rewind)\b/i;
  var LIVE_TAG = /\u1d38\u1da6\u1d5b\u1d49/;          // ᴸᶦᵛᵉ
  function strength(c, p, gname) {
    if (!p || !p.t || (typeof Events !== 'undefined' && Events.of && Events.of(c))) return '';
    var len = p.e - p.s, ct = clean(p.t);
    if (!ct.t || norm(ct.t) === norm(c.n)) return '';
    if (p.mv || ct.y || /^\s*(?:new\s+)?(?:movie|film)\s*[:\-–]/i.test(p.t)) return 'strong';
    if (NOT.test(ct.t) || LIVE_TAG.test(p.t)) return '';
    if (typeof Teams !== 'undefined' && Teams.isGame && Teams.isGame(ct.t, c.n + ' | ' + (gname || ''))) return '';
    if (len >= 75 * 60000 && len <= 5 * 3600e3 && (MOVIE_CH.test(c.n) || MOVIE_CH.test(gname || ''))) return 'strong';
    if (len >= 80 * 60000 && len <= 4 * 3600e3) return 'weak';
    return '';
  }
  function keyOf(p) { var ct = clean(p.t); return norm(ct.t) + '|' + (p.y || ct.y || ''); }

  function load() {
    if (loaded) return loaded;
    loaded = (Store.bigGet ? Store.bigGet(KEY) : Promise.resolve(null)).then(function (v) {
      var now = Date.now();
      if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (v[k] && now - v[k].at < KEEP) cache[k] = v[k]; });
      trimCache();
      ver++;
      // The copy from before tvmovies2 (up to 2 MB on the TV's storage): not read any more.
      if (Store.bigSet) try { Store.bigSet('tvmovies', null); } catch (e) {}
    }, function () {});
    return loaded;
  }
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      trimCache();
      if (Store.bigSet) Store.bigSet(KEY, cache);
    }, 5000);
  }

  // The movie a programme is, from what is already known (no lookup): its details, or null.
  function of(c, p) {
    if (!p || !p.t || !on()) return null;
    if (p._mvv === ver) return p._mv;
    var hit = cache[keyOf(p)], m = hit && hit.m && (p.mv || p.e - p.s >= 75 * 60000) ? hit.m : null;
    p._mvv = ver; p._mv = m;
    return m;
  }

  /* Look at what's on now and in the next three hours, and ask TMDB about titles not known yet: the
     ones on now and the surer ones first. */
  function scan() {
    if (!on() || typeof Epg === 'undefined' || !Epg.during) return;
    lastScan = Date.now();
    load().then(function () {
      var now = Date.now(), byKey = {}, gname = {}, want = [], fresh = [];
      Library.data.groups.forEach(function (g) { gname[g.id] = g.name; });
      Library.data.channels.forEach(function (c) {
        if (Library.shownAnywhere && !Library.shownAnywhere(c)) return;
        var k = Epg.keyOf(c); if (k && !byKey[k]) byKey[k] = c;
      });
      Epg.during(now, now + LOOK, function (k, p) {
        var c = byKey[k]; if (!c) return;
        var st = strength(c, p, gname[c.g]); if (!st) return;
        var key = keyOf(p), hit = cache[key];
        if (hit && (hit.m || hit.s === 'strong' || st === 'weak')) {
          if (hit.m && (p.mv || p.e - p.s >= 75 * 60000)) fresh.push({ c: c, p: p, m: hit.m });
          return;
        }
        if (!queued[key]) {
          queued[key] = 1; var ct = clean(p.t);
          if (Epg.desc) Epg.desc(c, p);                  // asks the helper for it now, so it's there when this is looked up
          want.push({ key: key, t: ct.t, y: p.y || ct.y, st: st, c: c, p: p, rank: (p.s <= now ? 0 : 2) + (st === 'strong' ? 0 : 1) });
        }
      });
      found = fresh; foundAt = Date.now();
      want.sort(function (a, b) { return a.rank - b.rank; });
      queue = queue.concat(want.slice(0, PER_SCAN));
      want.slice(PER_SCAN).forEach(function (w) { delete queued[w.key]; });
      changed();
      pump();
    });
  }
  function pump() {
    if (busy || !queue.length || !on() || typeof Media === 'undefined' || !Media.guideLookup) return;
    busy = true;
    var w = queue.shift();
    var d = w.c && Epg.desc ? Epg.desc(w.c, w.p) : '';
    Media.guideLookup(w.t, w.y, w.st, d).then(function (r) {
      var m = r && r.metadata;
      cache[w.key] = { at: Date.now(), s: w.st, m: m ? lite(m) : 0 };
      ver++; save();
      if (m) soon();
    }, function (e) {
      // TMDB refused or can't be reached: stop for now, try these again on the next look.
      queue.forEach(function (x) { delete queued[x.key]; }); queue = [];
      if (typeof Log !== 'undefined') Log.warn('movies', 'TMDB lookups paused: ' + (e && e.message));
    }).then(function () { delete queued[w.key]; busy = false; setTimeout(pump, GAP); });
  }
  var soonT = null;
  function soon() { clearTimeout(soonT); soonT = setTimeout(function () { if (Date.now() - lastScan > 15000) scan(); else { refound(); changed(); } }, 4000); }
  // The group from what is known, without a new look (after lookups come back).
  function refound() {
    var now = Date.now(), byKey = {}, out = [];
    Library.data.channels.forEach(function (c) { if (Library.shownAnywhere && !Library.shownAnywhere(c)) return; var k = Epg.keyOf(c); if (k && !byKey[k]) byKey[k] = c; });
    Epg.during(now, now + LOOK, function (k, p) { var c = byKey[k]; if (!c) return; var m = of(c, p); if (m) out.push({ c: c, p: p, m: m }); });
    found = out; foundAt = now;
  }
  var lastSig = '';
  function changed() {
    if (typeof OnNow !== 'undefined' && OnNow.changed) OnNow.changed();
    var sig = list().map(function (x) { return x.c.k; }).join();
    if (sig === lastSig) return;
    lastSig = sig;
    if (typeof Library !== 'undefined' && Library.dirty) Library.dirty();
    if (typeof Views !== 'undefined' && Views.refreshLists) Views.refreshLists(true);
  }

  // Movies on now (most left first), then the ones starting within the hour (soonest first); a channel once.
  function list() {
    if (!groupOn()) return [];
    var now = Date.now(), seen = {}, onNow = [], next = [];
    found.forEach(function (x) {
      if (x.p.e <= now || x.p.s > now + SOON) return;
      (x.p.s <= now ? onNow : next).push(x);
    });
    onNow.sort(function (a, b) { return (b.p.e - now) - (a.p.e - now); });
    next.sort(function (a, b) { return a.p.s - b.p.s; });
    return onNow.concat(next).filter(function (x) { if (seen[x.c.k]) return false; seen[x.c.k] = 1; return true; });
  }
  function channels() { return list().map(function (x) { return x.c; }); }
  // What is kept of a movie: the details shown, the summary cut to what the guide's panel shows.
  function lite(m) { return { id: m.id, title: m.title, year: m.year, poster: m.poster, backdrop: m.backdrop, backdropHd: m.backdropHd || '', logo: m.logo || '', plot: String(m.plot || '').slice(0, 600), genre: m.genre, runtime: m.runtime, rating: m.rating }; }
  /* At most MAX answers, the oldest going first; fewer on a TV short of memory (1 GB, or TiviBro closed while
     playing lately), where every MB counts. */
  function cap() { return window.Player && Player.memSafe ? MAX_LOW : MAX; }
  function trimCache() {
    var keys = Object.keys(cache), max = cap();
    if (keys.length <= max) return;
    keys.sort(function (a, b) { return cache[a].at - cache[b].at; }).slice(0, keys.length - max).forEach(function (k) { delete cache[k]; });
  }

  /* The Movies on now screen (onnow.js): each movie once, with every channel showing it (the one to
     tune first: a favorite, then the soonest / longest left).  on: playing now, most left first;
     soon: starting within three hours, soonest first.  Whether the group is on doesn't matter here. */
  function shelves() {
    var now = Date.now(), by = {}, out = { on: [], soon: [] };
    if (!on()) return out;
    found.forEach(function (x) {
      if (x.p.e <= now) return;
      var live = x.p.s <= now, id = x.m.id + (live ? '|on' : '|soon'), g = by[id];
      if (!g) { g = by[id] = { m: x.m, live: live, list: [] }; (live ? out.on : out.soon).push(g); }
      g.list.push({ c: x.c, p: x.p });
    });
    function rank(a) { return (Library.isFav && Library.isFav(a.c.k) ? 0 : 1); }
    out.on.concat(out.soon).forEach(function (g) {
      g.list.sort(function (a, b) { return rank(a) - rank(b) || (g.live ? b.p.e - a.p.e : a.p.s - b.p.s); });
      g.c = g.list[0].c; g.p = g.list[0].p;
    });
    out.on.sort(function (a, b) { return b.p.e - a.p.e; });
    out.soon.sort(function (a, b) { return a.p.s - b.p.s; });
    return out;
  }
  /* Genre shelves under On now and Starting soon (onnow.js, and the phone app's On now tab): each genre
     TMDB gave two or more of the movies, most movies first, up to ten.  A movie is in each of its
     genres, once: the showing on now if there is one, else the next.  Genres come in your metadata
     language, as TMDB names them. */
  function genres(sh) {
    var by = {}, names = [];
    sh.on.concat(sh.soon).forEach(function (g) {
      String(g.m.genre || '').split(',').forEach(function (t) {
        t = t.trim(); if (!t) return;
        var k = t.toLowerCase(), r = by[k];
        if (!r) { r = by[k] = { title: t, items: [], seen: {} }; names.push(k); }
        if (!r.seen[g.m.id]) { r.seen[g.m.id] = 1; r.items.push(g); }
      });
    });
    return names.map(function (k) { return by[k]; }).filter(function (r) { return r.items.length >= 2; })
      .sort(function (a, b) { return b.items.length - a.items.length || (a.title < b.title ? -1 : 1); }).slice(0, 10)
      .map(function (r) { return { title: r.title, items: r.items }; });
  }
  /* Movies saved before title logos and large backdrops were kept: ask TMDB by id once, then
     everything showing that movie gets them.  cb when it changed. */
  var filling = {};
  function fill(m, cb) {
    if (!m || m.logo !== undefined && m.backdropHd !== undefined || filling[m.id] || typeof Media === 'undefined' || !Media.movieById) return;
    filling[m.id] = 1;
    Media.movieById(m.id).then(function (r) {
      var x = r && r.metadata; if (!x) return;
      Object.keys(cache).forEach(function (k) { var e = cache[k]; if (e && e.m && e.m.id === m.id) { e.m.logo = x.logo || ''; e.m.backdropHd = x.backdropHd || ''; } });
      m.logo = x.logo || ''; m.backdropHd = x.backdropHd || '';
      ver++; save(); if (cb) cb();
    }, function () {});
  }
  function emptyText() {
    if (!on()) return 'Save a TMDB token in Settings > API keys to find the movies in your guide.';
    return queue.length || busy ? 'Looking through the guide for movies…' : 'No movies on now or starting within the hour.';
  }

  function start() {
    if (hooked) return;
    hooked = true;
    setTimeout(scan, 60000);
    timer = setInterval(function () { if (on()) scan(); }, 10 * 60000);
    if (typeof Epg !== 'undefined' && Epg.onUpdate) Epg.onUpdate(function (k) { if (!k && on() && Date.now() - lastScan > 60000) setTimeout(scan, 5000); });
  }
  // The token or the switch changed: look now, or forget the group.
  function poke() { ver++; lastSig = ''; if (on()) scan(); else { found = []; changed(); } if (typeof Views !== 'undefined' && Views.buildTabs) Views.buildTabs(); }

  // Forget every answer (the tests start from nothing; a different token or language could use it too).
  function reset() { cache = {}; loaded = Promise.resolve(); found = []; ver++; if (Store.bigSet) Store.bigSet(KEY, {}); }
  return { reset: reset, on: on, groupOn: groupOn, of: of, list: list, channels: channels, shelves: shelves, genres: genres, fill: fill, emptyText: emptyText, start: start, scan: scan, poke: poke, clean: clean, strength: strength,
    get pending() { return queue.length + (busy ? 1 : 0); }, get lastScan() { return lastScan; } };
})();
