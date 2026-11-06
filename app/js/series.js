/* TV series from TMDB, with your own token (Settings > Guide > Series details from TMDB): for a series in
   the guide, a poster, year, network, genres and rating in the details above it, and the episode's own
   title and summary when the guide gives its season and episode; and on the Shows screen, what the
   provider's details leave out (a poster, a summary, the rating, genres and cast, each episode's title,
   summary and picture).
   Nothing is scanned ahead: a show is looked up when you land on it (the newest few asks win, so
   scrolling past a hundred programmes asks about the one you stop on), through the helper
   (service/media-metadata.js guideTvLookup: a show of exactly that name, the best known one).  A season's
   episodes come in one ask.  Answers, misses too, are kept for 30 days.
   What it gives: Series.of(c, p) for a guide programme, Series.show(name, year) for a provider's show,
   Series.episode(show, 'S2 E5'), each null until known; onChange(fn) when an answer comes in. */
var Series = (function () {
  var KEY = 'tvseries', KEEP = 30 * 86400e3, MAX_SHOWS = 3000, MAX_SEASONS = 400, GAP = 350, QUEUE = 4;
  var shows = {}, seasons = {}, loaded = null, queue = [], queued = {}, busy = false, saveT = null, listeners = [], paused = 0;
  function S() { return Store.settings; }
  function on() { return S().guideSeries !== false && typeof MediaStore !== 'undefined' && !!MediaStore.tmdbToken(); }
  function norm(t) { return String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }

  /* The show's own name from what providers and guides put around it:
     "EN - Breaking Bad (2008) [4K]", "|US| The Office", "NEW: Severance ᴺᵉʷ", "Slow Horses S03" */
  var SUP = /[ʰ-˿ᴬ-ᵪᶜ-ᶿ⁰-₟]+/g;
  function clean(t) {
    t = String(t || '').replace(SUP, ' ');
    var m = /\(((?:19|20)\d\d)\)/.exec(t), y = m ? m[1] : '';
    // A provider's language or country in front ("EN - ", "US| "), never a title's own colon ("CSI: Miami").
    var x = t.replace(/^\s*(?:\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2,3}\s*[|\-–]\s+)/, '')
      .replace(/^\s*(?:new|premiere|season premiere|series premiere)\s*[:\-–]\s*/i, '')
      .replace(/\((?:19|20)\d\d\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+S\d{1,2}(?:\s*E\d{1,3})?\s*$/i, '').replace(/\s*[-–|]\s*(?:u?hd|sd|4k|fhd|multi[- ]?sub)\s*$/i, '').replace(/\s+(?:u?hd|cc|4k)\s*$/i, '')
      .replace(/\s{2,}/g, ' ').trim();
    return { t: x, y: y };
  }
  function keyOf(t, y) { return norm(t) + '|' + (y || ''); }

  function load() {
    if (loaded) return loaded;
    loaded = (Store.bigGet ? Store.bigGet(KEY) : Promise.resolve(null)).then(function (v) {
      var now = Date.now();
      if (v && typeof v === 'object') {
        Object.keys(v.shows || {}).forEach(function (k) { var e = v.shows[k]; if (e && now - e.at < KEEP) shows[k] = e; });
        Object.keys(v.seasons || {}).forEach(function (k) { var e = v.seasons[k]; if (e && now - e.at < KEEP) seasons[k] = e; });
      }
      changed();
    }, function () {});
    return loaded;
  }
  function trim(map, max) {
    var keys = Object.keys(map);
    if (keys.length <= max) return;
    keys.sort(function (a, b) { return map[a].at - map[b].at; });
    keys.slice(0, keys.length - max).forEach(function (k) { delete map[k]; });
  }
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { trim(shows, MAX_SHOWS); trim(seasons, MAX_SEASONS); if (Store.bigSet) Store.bigSet(KEY, { shows: shows, seasons: seasons }); }, 5000);
  }
  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  // What is kept of a show: enough for the details, small enough for thousands.
  function lite(m) {
    return { id: m.id, title: m.title, year: m.year, poster: m.poster, backdrop: m.backdrop, plot: String(m.plot || '').slice(0, 900), genre: m.genre, rating: m.rating,
      network: m.network || '', status: m.status || '', cast: String(m.cast || '').split(', ').slice(0, 5).join(', ') };
  }

  /* ---------- asking ---------- */
  // The newest asks first, and only a few waiting: the ones you scrolled past are dropped.
  function want(job) {
    if (queued[job.k]) return;
    queued[job.k] = 1;
    queue.unshift(job);
    while (queue.length > QUEUE) delete queued[queue.pop().k];
    pump();
  }
  function pump() {
    if (busy || !queue.length || !on() || typeof Media === 'undefined' || !Media.tvByName || Date.now() < paused) return;
    busy = true;
    var job = queue.shift();
    var ask = job.season != null ? Media.tvSeason(job.id, job.season) : Media.tvByName(job.t, job.y, job.st);
    ask.then(function (r) {
      var m = r && r.metadata;
      if (job.season != null) {
        var eps = {};
        ((m && m.episodes) || []).forEach(function (e) { if (e && e.number) eps[e.number] = { t: e.title || '', plot: String(e.plot || '').slice(0, 600), still: e.still || '', air: e.airDate || '' }; });
        seasons[job.k] = { at: Date.now(), eps: eps };
      } else {
        // A strong ask (the guide gave a season and episode, or the provider says it's a show) replaces an
        // earlier weak miss.
        shows[job.k] = { at: Date.now(), s: job.st, m: m ? lite(m) : 0 };
      }
      save(); changed();
    }, function (e) {
      // TMDB refused or can't be reached: wait a minute before asking again.
      paused = Date.now() + 60000;
      queue.forEach(function (x) { delete queued[x.k]; }); queue = [];
      if (typeof Log !== 'undefined') Log.warn('series', 'TMDB lookups paused: ' + (e && e.message));
    }).then(function () { delete queued[job.k]; busy = false; setTimeout(pump, GAP); });
  }

  // A show by name (and year): its details, or null while unknown (it is asked for) or not found.
  function show(name, year, strength) {
    if (!on()) return null;
    load();
    var ct = clean(name), y = year ? String(year).slice(0, 4) : ct.y;
    if (!ct.t) return null;
    var k = keyOf(ct.t, y), hit = shows[k];
    if (hit && (hit.m || hit.s === 'strong' || strength !== 'strong')) return hit.m || null;
    want({ k: k, t: ct.t, y: y, st: strength || 'weak' });
    return null;
  }
  // An episode of a show ('S2 E5', or season and number): { t, plot, still, air }, or null.
  function episode(sh, se, num) {
    if (!sh || !sh.id || !on()) return null;
    var s = se, n = num;
    if (typeof se === 'string') { var m = /S(\d+)\s*E(\d+)/i.exec(se); if (!m) return null; s = +m[1]; n = +m[2]; }
    if (!(s >= 0) || !(n >= 1)) return null;
    var k = sh.id + ':' + s, hit = seasons[k];
    if (hit) return hit.eps[n] || null;
    want({ k: k, id: sh.id, season: s });
    return null;
  }

  /* ---------- the guide ---------- */
  // Not a series: news, sport, live and paid programming, a game (My teams, event channels), a movie.
  var NOT = /\b(news|noticias|live|en vivo|weather|paid program(?:ming)?|infomercial|sign.?off|off.?air|to be announced|tba|highlights|pregame|postgame|countdown|worship)\b/i;
  function strength(c, p) {
    if (!p || !p.t || p.up || p.ended || p.mv) return '';
    if (p.k === 'n' || p.k === 's' || p.k === 'm') return '';
    if (typeof Movies !== 'undefined' && Movies.of && Movies.of(c, p)) return '';
    if (typeof Events !== 'undefined' && Events.of && Events.of(c)) return '';
    var ct = clean(p.t);
    if (!ct.t || norm(ct.t) === norm(c.n)) return '';
    if (p.ep) return 'strong';
    if (NOT.test(ct.t) || p.e - p.s > 75 * 60000) return '';
    if (typeof Teams !== 'undefined' && Teams.isGame && Teams.isGame(ct.t, c.n)) return '';
    return 'weak';
  }
  // The show a guide programme is: its details, or null (asked for when it might be one).
  function of(c, p) {
    if (!on()) return null;
    var st = strength(c, p);
    return st ? show(p.t, '', st) : null;
  }

  function onChange(f) { listeners.push(f); }
  function poke() { paused = 0; changed(); }
  // Forget every answer (the tests start from nothing; a different token or language could use it too).
  function reset() { shows = {}; seasons = {}; loaded = Promise.resolve(); queue = []; queued = {}; if (Store.bigSet) Store.bigSet(KEY, {}); changed(); }
  return { on: on, of: of, show: show, episode: episode, clean: clean, strength: strength, onChange: onChange, poke: poke, reset: reset,
    get pending() { return queue.length + (busy ? 1 : 0); } };
})();
