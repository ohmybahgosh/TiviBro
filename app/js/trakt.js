/* Trakt (trakt.tv): sign in with a code on the screen (trakt.tv/activate), mark what you finish as watched on
   Trakt, bring your Trakt watched history in, and Trakt lists as My media shelves (your watchlist, Trakt's
   charts, your own lists and anyone's public list, added like in Radarr and Sonarr: a link, user and list
   name, or a search).  Calls go through the helper (service/trakt.js); the sign-in is kept by mediastore.js.
   Settings > My media > Trakt (settings.js), the phone app (it mirrors those rows) and the web editor (webedit.js).
   Chromium 53-compatible. */
var Trakt = (function () {
  'use strict';
  var ITEMS_KEY = 'tivibro.trakt.items', ITEMS_AGE = 6 * 3600e3, SYNC_EVERY = 6 * 3600e3;
  var CHARTS = [
    ['trending', 'movies', 'Trending movies on Trakt'], ['trending', 'shows', 'Trending shows on Trakt'],
    ['popular', 'movies', 'Popular movies on Trakt'], ['popular', 'shows', 'Popular shows on Trakt'],
    ['anticipated', 'movies', 'Most anticipated movies'], ['anticipated', 'shows', 'Most anticipated shows'],
    ['boxoffice', 'movies', 'Box office this weekend'], ['watched/weekly', 'movies', 'Most watched movies this week'], ['watched/weekly', 'shows', 'Most watched shows this week']];
  var connecting = null, syncing = false, lastSyncError = '', itemsBusy = false, status = '', listeners = [];

  function st() { return MediaStore.trakt ? MediaStore.trakt() : {}; }
  function connected() { var t = st(); return !!(t.token && t.token.access); }
  function user() { return connected() ? (st().user || {}).name || '' : ''; }
  function settings() { var s = st().settings || {}; return { watchedOut: s.watchedOut !== false, historyIn: s.historyIn !== false }; }
  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); if (typeof Settings !== 'undefined' && Settings.live) Settings.live(); }
  function onChange(f) { listeners.push(f); }
  function note(lv, m) { if (typeof Log !== 'undefined' && Log[lv]) Log[lv]('trakt', m); }

  function req(q, ms) {
    return Media.request('trakt', q, ms || 25000).then(function (r) {
      if (r && r.error) { var e = new Error(r.message || 'Trakt did not answer.'); e.status = r.status; e.signedOut = !!r.signedOut; e.stop = !!r.stop; throw e; }
      return r || {};
    });
  }
  // A token good for at least a day more; refreshed (Trakt's last 7 days) when it isn't.
  function token() {
    var t = st().token;
    if (!t || !t.access) return Promise.reject(new Error('Connect Trakt first: Settings > My media > Trakt.'));
    if (t.expires - Date.now() > 86400e3) return Promise.resolve(t.access);
    return req({ op: 'refresh', refresh: t.refresh }).then(function (r) { MediaStore.setTrakt({ token: r.token }); return r.token.access; }, function (e) {
      if (e.signedOut) { MediaStore.setTrakt({ token: null }); changed(); }
      throw e;
    });
  }
  // Signed in when connected (a private list, the watchlist); Trakt's charts and public lists work without.
  function get(path, needSignIn) {
    if (!connected() && !needSignIn) return req({ op: 'get', path: path }).then(function (r) { return r.data; });
    return token().then(function (a) { return req({ op: 'get', path: path, token: a }); }).then(function (r) { return r.data; });
  }
  // Every page of a paged Trakt answer (Trakt pages its watched lists now: 100 a page unless asked for 250).
  function getAll(path, needSignIn, maxPages) {
    var all = [], sep = path.indexOf('?') < 0 ? '?' : '&';
    function page(n) {
      var call = !connected() && !needSignIn ? req({ op: 'get', path: path + sep + 'limit=250&page=' + n }) : token().then(function (a) { return req({ op: 'get', path: path + sep + 'limit=250&page=' + n, token: a }); });
      return call.then(function (r) {
        all = all.concat(r.data || []);
        var count = +((r.headers || {})['x-pagination-page-count'] || 1);
        return n < count && n < (maxPages || 20) ? page(n + 1) : all;
      });
    }
    return page(1);
  }
  function post(path, body) { return token().then(function (a) { return req({ op: 'post', path: path, body: body, token: a }); }).then(function (r) { return r.data; }); }

  /* ---------- connecting ---------- */
  // onCode({ user, url, expires }) to show the code; resolves with the Trakt username.  cancel() stops it.
  function connect(onCode) {
    cancel();
    var me = connecting = { stopped: false };
    return req({ op: 'code' }).then(function (c) {
      if (me.stopped) throw new Error('Stopped.');
      me.code = { user: c.user, url: String(c.url || 'https://trakt.tv/activate'), until: Date.now() + (+c.expires || 600) * 1000 };
      if (onCode) onCode(me.code); changed();
      return new Promise(function (resolve, reject) {
        (function poll() {
          if (me.stopped) return reject(new Error('Stopped.'));
          if (Date.now() > me.code.until) return reject(new Error('The code expired.  Start again.'));
          setTimeout(function () {
            if (me.stopped) return reject(new Error('Stopped.'));
            req({ op: 'poll', code: c.code }).then(function (r) { if (r.token) resolve(r.token); else poll(); }, function (e) { if (e.stop) reject(e); else poll(); });
          }, Math.max(5, +c.interval || 5) * 1000);
        })();
      });
    }).then(function (tok) {
      MediaStore.setTrakt({ token: tok });
      return get('/users/settings', true).then(function (s) {
        var u = s && s.user || {};
        MediaStore.setTrakt({ user: { name: String(u.username || u.name || 'you').slice(0, 60), vip: !!u.vip } });
        if (!st().lists) MediaStore.setTrakt({ lists: defaults(), historyOffered: true });
        if (connecting === me) connecting = null;
        note('info', 'Connected');
        changed(); syncSoon(3000); itemsSoon(true);
        return user();
      });
    }).catch(function (e) { if (connecting === me) connecting = null; changed(); throw e; });
  }
  function cancel() { if (connecting) { connecting.stopped = true; connecting = null; changed(); } }
  function pendingCode() { return connecting && connecting.code && Date.now() < connecting.code.until ? connecting.code : null; }
  function disconnect() {
    var t = st().token;
    if (t && t.access) req({ op: 'revoke', token: t.access }).catch(function () {});
    MediaStore.setTrakt({ token: null, user: null, lastSync: null, lastActivities: null });
    note('info', 'Disconnected'); changed();
  }

  /* ---------- lists as shelves ---------- */
  function letters() { var s = ''; for (var i = 0; i < 8; i++) s += String.fromCharCode(97 + Math.floor(Math.random() * 26)); return s; }
  function tabFor(kind) { return kind === 'shows' ? 'shows' : kind === 'movies' ? 'movies' : 'home'; }
  function list(src, name, kind) { return { id: 'trakt:' + letters(), name: String(name).slice(0, 80), src: src, kind: kind, tab: tabFor(kind), on: true }; }
  function defaults() { return [list({ type: 'history' }, 'Recently watched', 'both'), list({ type: 'watchlist' }, 'Your Trakt watchlist', 'both'), list({ type: 'chart', chart: 'trending', of: 'movies' }, 'Trending movies on Trakt', 'movies'), list({ type: 'chart', chart: 'trending', of: 'shows' }, 'Trending shows on Trakt', 'shows')]; }
  function lists() { return (st().lists || []).slice(); }
  function saveLists(l) { MediaStore.setTrakt({ lists: l.slice(0, 30) }); changed(); if (typeof Media !== 'undefined' && Media.refresh) Media.refresh(); }
  function update(id, patch) { saveLists(lists().map(function (x) { if (x.id !== id) return x; var y = {}; Object.keys(x).forEach(function (k) { y[k] = x[k]; }); Object.keys(patch).forEach(function (k) { y[k] = patch[k]; }); if (patch.kind && !patch.tab) y.tab = tabFor(patch.kind); return y; })); if (patch.kind) itemsSoon(true); }
  function remove(id) { saveLists(lists().filter(function (x) { return x.id !== id; })); }
  function add(l) {
    var have = lists();
    if (have.some(function (x) { return JSON.stringify(x.src) === JSON.stringify(l.src); })) throw new Error('That list is already on My media.');
    if (have.length >= 30) throw new Error('30 Trakt lists at most.');
    have.push(l); saveLists(have); itemsSoon(true); return l;
  }
  // Whether a list is on My media already (the pickers mark it Added).
  function has(src) { var k = JSON.stringify(src); return lists().some(function (x) { return JSON.stringify(x.src) === k; }); }
  function hasChart(chart, of) { return has({ type: 'chart', chart: chart, of: of }); }
  function hasFound(x) { return lists().some(function (l) { return l.src && l.src.type === 'list' && l.src.user === String(x.user).toLowerCase() && l.src.slug === String(x.slug).toLowerCase(); }); }
  function addChart(chart, of) { var c = CHARTS.filter(function (x) { return x[0] === chart && x[1] === of; })[0]; if (!c) throw new Error('Choose a Trakt chart.'); return add(list({ type: 'chart', chart: chart, of: of }, c[2], of)); }
  function addHistory() { return add(list({ type: 'history' }, 'Recently watched', 'both')); }
  function addWatchlist() { return add(list({ type: 'watchlist' }, 'Your Trakt watchlist', 'both')); }
  function addRecommended(of) { return add(list({ type: 'recommended', of: of }, of === 'shows' ? 'Shows Trakt recommends for you' : 'Movies Trakt recommends for you', of)); }
  /* A list typed in the way Radarr and Sonarr take them: its link (trakt.tv/users/NAME/lists/LIST, or
     trakt.tv/lists/ID for an official list), "NAME/LIST", or "NAME LIST".  Its name comes from Trakt. */
  function parse(input) {
    var s = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/^(www\.|app\.)?trakt\.tv\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    var m = /^users\/([^\/\s]+)\/lists\/([^\/\s]+)/i.exec(s) || /^([A-Za-z0-9._-]+)[\/\s]+(?:lists\/)?([A-Za-z0-9._-]+)$/.exec(s);
    if (m && m[1].toLowerCase() !== 'lists') return { type: 'list', user: decodeURIComponent(m[1]).toLowerCase(), slug: decodeURIComponent(m[2]).toLowerCase() };
    m = /^lists\/([0-9]+|[A-Za-z0-9._-]+)$/i.exec(s);
    if (m) return { type: 'official', id: m[1] };
    if (/^users\/[^\/]+\/watchlist$/i.test(s)) { return { type: 'userwatchlist', user: s.split('/')[1].toLowerCase() }; }
    return null;
  }
  // How many movies and shows a list holds (Trakt counts them for a one-item page): the list's tab follows.
  function countOf(path) { var go = connected() ? token().then(function (a) { return req({ op: 'get', path: path + '?limit=1', token: a }); }) : req({ op: 'get', path: path + '?limit=1' }); return go.then(function (r) { return +((r.headers || {})['x-pagination-item-count']) || (r.data || []).length; }, function () { return 0; }); }
  function itemsBase(src) { return src.type === 'list' ? '/users/' + encodeURIComponent(src.user) + '/lists/' + encodeURIComponent(src.slug) + '/items/' : src.type === 'official' ? '/lists/' + encodeURIComponent(src.id) + '/items/' : src.type === 'userwatchlist' ? '/users/' + encodeURIComponent(src.user) + '/watchlist/' : null; }
  function kindsOf(src) {
    var base = itemsBase(src); if (!base) return Promise.resolve({ movies: 0, shows: 0 });
    var plural = src.type === 'userwatchlist';
    return countOf(base + (plural ? 'movies' : 'movie')).then(function (mv) { return countOf(base + (plural ? 'shows' : 'show')).then(function (sh) { return { movies: mv, shows: sh }; }); });
  }
  function kindFor(c) { return c.movies && c.shows ? 'both' : c.shows ? 'shows' : 'movies'; }
  function tabName(kind) { return kind === 'shows' ? 'the TV shows tab' : kind === 'movies' ? 'the Movies tab' : 'Home'; }
  function holds(c) { return [c.movies ? c.movies + (c.movies === 1 ? ' movie' : ' movies') : '', c.shows ? c.shows + (c.shows === 1 ? ' show' : ' shows') : ''].filter(Boolean).join(', ') || 'empty'; }
  // Added with its tab worked out from what it holds (or the one asked for): { list, counts, message }.
  function addSrc(src, name, kind) {
    if (has(src)) return Promise.reject(new Error(name + ' is already on My media.'));
    return kindsOf(src).then(function (c) {
      if (!kind || kind === 'auto') { if (!c.movies && !c.shows) throw new Error(name + ' has no movies or shows on Trakt.'); kind = kindFor(c); }
      var l = add(list(src, name, kind));
      return { list: l, counts: c, message: name + ' (' + holds(c) + ') is on ' + tabName(kind) + '.' };
    });
  }
  function addTyped(input, kind) {
    var src = parse(input);
    if (!src) return Promise.reject(new Error('Paste a Trakt list link (trakt.tv/users/NAME/lists/LIST), or type NAME/LIST.'));
    var path = src.type === 'list' ? '/users/' + encodeURIComponent(src.user) + '/lists/' + encodeURIComponent(src.slug) : src.type === 'official' ? '/lists/' + encodeURIComponent(src.id) : null;
    var named = path ? get(path).then(function (l) { return l && l.name ? l.name : null; }) : Promise.resolve(src.user + '\'s watchlist');
    return named.then(function (name) {
      if (!name) throw new Error('Trakt has no such list.  Check the link: the list must be public.');
      return addSrc(src, name, kind);
    });
  }
  function shapeList(l, likes) { var u = l.user && l.user.ids && l.user.ids.slug || ''; return { name: l.name || '', user: u, slug: l.ids && l.ids.slug || '', count: l.item_count || 0, likes: likes || l.likes || 0 }; }
  // Lists found by name, or Trakt's popular and trending lists; each with what it holds when asked (withKinds).
  function search(q, withKinds) {
    return get('/search/list?query=' + encodeURIComponent(String(q || '').slice(0, 80)) + '&limit=15').then(function (r) {
      return withHolds((r || []).map(function (x) { return shapeList(x.list || {}); }).filter(function (x) { return x.user && x.slug; }), withKinds);
    });
  }
  function browse(which, withKinds) {
    return get('/lists/' + (which === 'trending' ? 'trending' : 'popular') + '?limit=15').then(function (r) {
      return withHolds((r || []).map(function (x) { return shapeList(x.list || {}, x.like_count); }).filter(function (x) { return x.user && x.slug; }), withKinds);
    });
  }
  function withHolds(found, on) {
    found.forEach(function (x) { x.added = hasFound(x); });
    if (!on) return found;
    return found.reduce(function (p, x) { return p.then(function () { return kindsOf({ type: 'list', user: x.user, slug: x.slug }).then(function (c) { x.movies = c.movies; x.shows = c.shows; x.kind = kindFor(c); x.holds = holds(c); }); }); }, Promise.resolve()).then(function () { return found; });
  }
  function addFound(x, kind) {
    x = { user: String(x.user || '').toLowerCase(), slug: String(x.slug || '').toLowerCase(), name: x.name };
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(x.user || '') || !/^[A-Za-z0-9._-]{1,120}$/.test(x.slug || '')) return Promise.reject(new Error('That is not a Trakt list.'));
    return addSrc({ type: 'list', user: x.user, slug: x.slug }, x.name || x.slug, kind);
  }

  // A list's items: { k: 'movie'|'show', tmdb, title, year }.
  function pathsOf(l) {
    var s = l.src || {}, kinds = l.kind === 'movies' ? ['movies'] : l.kind === 'shows' ? ['shows'] : ['movies', 'shows'];
    if (s.type === 'history') return [['/sync/history/movies?limit=60', 'movies', true], ['/sync/history/episodes?limit=200', 'shows', true]];
    if (s.type === 'watchlist') return kinds.map(function (k) { return ['/sync/watchlist/' + k, k, true, 4]; });
    if (s.type === 'userwatchlist') return kinds.map(function (k) { return ['/users/' + encodeURIComponent(s.user) + '/watchlist/' + k, k, false, 4]; });
    if (s.type === 'chart') return [['/' + s.of + '/' + s.chart + '?limit=100', s.of]];
    if (s.type === 'recommended') return [['/recommendations/' + s.of + '?limit=60&ignore_collected=false', s.of, true]];
    if (s.type === 'list') return kinds.map(function (k) { return ['/users/' + encodeURIComponent(s.user) + '/lists/' + encodeURIComponent(s.slug) + '/items/' + k.replace(/s$/, ''), k, false, 4]; });
    if (s.type === 'official') return kinds.map(function (k) { return ['/lists/' + encodeURIComponent(s.id) + '/items/' + k.replace(/s$/, ''), k, false, 4]; });
    return [];
  }
  function normalize(rows, k) {
    var out = [];
    (rows || []).forEach(function (r) {
      var x = r && (r.movie || r.show) || r, kind = r && r.show ? 'show' : r && r.movie ? 'movie' : k === 'shows' ? 'show' : 'movie';
      var id = x && x.ids && x.ids.tmdb;
      if (id && !out.some(function (o) { return o.k === kind && o.tmdb === +id; })) out.push({ k: kind, tmdb: +id, title: String(x.title || '').slice(0, 120), year: x.year || 0, at: r && r.watched_at || '' });
    });
    return out;
  }
  function readItems() { try { var o = JSON.parse(localStorage.getItem(ITEMS_KEY) || 'null'); return o && o.items ? o : { at: {}, items: {} }; } catch (e) { return { at: {}, items: {} }; } }
  var cache = readItems();
  function itemsOf(id) { return cache.items[id] || []; }
  // Each list fetched again after 6 hours (or now, force), one after another; then My media redraws.
  function itemsSoon(force) {
    if (itemsBusy) return;
    var due = lists().filter(function (l) { return l.on !== false && (force || !cache.at[l.id] || Date.now() - cache.at[l.id] > ITEMS_AGE) && (connected() || !pathsOf(l).some(function (p) { return p[2]; })); });
    if (!due.length) return;
    itemsBusy = true;
    (function next(i) {
      if (i >= due.length) {
        itemsBusy = false;
        var keep = {}; lists().forEach(function (l) { keep[l.id] = 1; });
        Object.keys(cache.items).forEach(function (k) { if (!keep[k]) { delete cache.items[k]; delete cache.at[k]; } });
        try { localStorage.setItem(ITEMS_KEY, JSON.stringify(cache)); } catch (e) {}
        if (typeof Media !== 'undefined' && Media.refresh) Media.refresh();
        return;
      }
      var l = due[i], got = [];
      Promise.all(pathsOf(l).map(function (p) { return (p[3] ? getAll(p[0], p[2], p[3]) : get(p[0], p[2])).then(function (rows) { got = got.concat(normalize(rows, p[1])); }); })).then(function () {
        if (l.src && l.src.type === 'history') got.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });   // newest first, movies and shows together
        cache.items[l.id] = got; cache.at[l.id] = Date.now();
      }, function (e) { note('warn', 'List "' + l.name + '": ' + e.message); cache.at[l.id] = Date.now() - ITEMS_AGE + 600e3; }).then(function () { setTimeout(function () { next(i + 1); }, 400); });
    })(0);
  }
  // For My media (media.js shelvesNow): the shelves, with the keys its pool uses ('tmdb:ID', 'tmdb:tv:ID').
  function shelves() {
    return lists().filter(function (l) { return l.on !== false; }).map(function (l) {
      return { id: l.id, title: l.name, tab: l.tab || tabFor(l.kind), kind: l.kind, history: !!(l.src && l.src.type === 'history'), keys: itemsOf(l.id).map(function (x) { return x.k === 'show' ? 'tmdb:tv:' + x.tmdb : 'tmdb:' + x.tmdb; }) };
    });
  }

  /* ---------- watched, out and in ---------- */
  // Finished here: marked watched on Trakt (queued when Trakt can't be reached, sent with the next sync).
  function queue(entry) { var q = (st().queue || []).slice(-199); q.push(entry); MediaStore.setTrakt({ queue: q }); }
  function sendQueue() {
    var q = st().queue || [];
    if (!q.length || !connected()) return Promise.resolve();
    var body = { movies: [], shows: [] };
    q.forEach(function (e) { if (e.movie) body.movies.push({ ids: { tmdb: e.movie }, watched_at: new Date(e.at).toISOString() }); else if (e.show) body.shows.push({ ids: { tmdb: e.show }, seasons: [{ number: e.season, episodes: [{ number: e.episode, watched_at: new Date(e.at).toISOString() }] }] }); });
    return post('/sync/history', body).then(function () { MediaStore.setTrakt({ queue: [] }); note('info', 'Sent ' + q.length + ' watched to Trakt'); setTimeout(historySoon, 5000); });
  }
  function watchedMovie(metadataId) {
    var m = /^tmdb:([0-9]+)$/.exec(String(metadataId || ''));
    if (!m || !connected() || !settings().watchedOut) return;
    queue({ movie: +m[1], at: Date.now() }); sendQueue().catch(function (e) { note('warn', 'Watched not sent yet: ' + e.message); });
  }
  // An episode of My media's TV shows: its show's TMDB id from the library.
  function watchedEpisode(episodeHandle) {
    if (!connected() || !settings().watchedOut || !episodeHandle) return;
    Media.request('library/detail', { kind: 'episode', handle: episodeHandle }, 30000).then(function (ep) {
      if (!ep || ep.error || ep.season == null || !ep.number || !ep.showId) return;
      return Media.request('library/detail', { kind: 'show', handle: ep.showId }, 30000).then(function (sh) {
        var m = /^tmdb:tv:([0-9]+)$/.exec(String(sh && sh.metadata && sh.metadata.id || ''));
        if (!m) return;
        queue({ show: +m[1], season: +ep.season, episode: +ep.number, at: Date.now() });
        return sendQueue();
      });
    }).catch(function (e) { note('warn', 'Watched episode not sent yet: ' + e.message); });
  }
  /* Trakt's watched history, in: movies you have marked watched; episodes of your shows marked watched in the
     library.  Only what changed on Trakt since the last time (its last_activities). */
  function syncNow(manual) {
    if (!connected() || syncing) return Promise.resolve(null);
    syncing = true; status = 'Syncing with Trakt…'; changed();
    var res = { movies: 0, episodes: 0 }, before = st().lastActivities || {};
    return sendQueue().then(function () { return get('/sync/last_activities', true); }).then(function (act) {
      var mv = act && act.movies && act.movies.watched_at || '', ep = act && act.episodes && act.episodes.watched_at || '';
      var jobs = [];
      if (settings().historyIn && (manual || mv !== before.movies)) jobs.push(moviesIn(res));
      if (settings().historyIn && (manual || ep !== before.episodes)) jobs.push(episodesIn(res, manual || !st().episodesSince));
      var pb = (act && act.movies && act.movies.paused_at || '') + '|' + (act && act.episodes && act.episodes.paused_at || '');
      if (settings().historyIn && (manual || pb !== before.paused)) jobs.push(playbackIn(res));
      return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve()).then(function () { MediaStore.setTrakt({ lastActivities: { movies: mv, episodes: ep, paused: (act && act.movies && act.movies.paused_at || '') + '|' + (act && act.episodes && act.episodes.paused_at || '') } }); });
    }).then(function () {
      syncing = false; lastSyncError = ''; status = ''; MediaStore.setTrakt({ lastSync: Date.now() });
      if (res.movies || res.episodes) note('info', 'From Trakt: ' + res.movies + ' movies and ' + res.episodes + ' episodes marked watched');
      if (res.resumed) note('info', 'From Trakt: ' + res.resumed + ' to continue watching');
      if ((res.movies || res.episodes || res.resumed) && Media.refresh) { Media.refresh(); if (res.resumed && Media.refreshShows) Media.refreshShows(); }
      changed(); if (res.movies || res.episodes) historySoon(); return res;
    }, function (e) { syncing = false; lastSyncError = e.message; status = ''; changed(); note('warn', 'Sync: ' + e.message); throw e; });
  }
  function moviesIn(res) {
    return function () {
      return getAll('/sync/watched/movies', true).then(function (rows) {
        var seen = {}; (rows || []).forEach(function (r) { var id = r.movie && r.movie.ids && r.movie.ids.tmdb; if (id) seen['tmdb:' + id] = 1; });
        return MediaStore.load().then(function () {
          MediaStore.movies(null).forEach(function (m) {
            var id = m.metadata && m.metadata.id;
            if (id && seen[id] && MediaStore.isWatched && !MediaStore.isWatched(m.id)) { MediaStore.markWatched(m.id, true, true); res.movies++; }
          });
        });
      });
    };
  }
  /* Episodes: Trakt's watched shows no longer carry their episodes, so each show you have that Trakt says
     you watched since the last sync is asked for its progress (one call each, a short pause between). */
  function episodesIn(res, manual) {
    return function () {
      var since = manual ? '' : (st().episodesSince || '');
      return getAll('/sync/watched/shows', true).then(function (rows) {
        var by = {};
        (rows || []).forEach(function (r) { var ids = r.show && r.show.ids || {}; if (ids.tmdb && ids.trakt && (!since || String(r.last_watched_at || '') > since)) by['tmdb:tv:' + ids.tmdb] = ids.trakt; });
        if (!Object.keys(by).length) return;
        var edits = 0, started = new Date().toISOString();
        function shows(cursor) {
          var q = { kind: 'show', limit: 200 }; if (cursor) q.cursor = cursor;
          return Media.request('library/query', q, 30000).then(function (r) {
            var mine = (r.items || []).filter(function (s) { return s.metadata && by[s.metadata.id]; });
            return mine.reduce(function (p, s) {
              return p.then(function () {
                if (edits >= 3000) return;
                return get('/shows/' + by[s.metadata.id] + '/progress/watched?hidden=false&specials=false', true).then(function (pr) {
                  var done = {};
                  ((pr && pr.seasons) || []).forEach(function (se) { (se.episodes || []).forEach(function (x) { if (x.completed) done[se.number + 'x' + x.number] = 1; }); });
                  if (!Object.keys(done).length) return;
                  return Media.request('library/query', { kind: 'episode', show: s.handle, limit: 200 }, 30000).then(function (er) {
                    var todo = (er.items || []).filter(function (e) { return e.watchState !== 'watched' && done[e.season + 'x' + e.number]; });
                    return todo.reduce(function (q, e) {
                      return q.then(function () { edits++; return Media.request('library/edit', { handle: e.handle, expectedRevision: e.revision, operation: 'setWatched', watched: true }, 30000).then(function (x) { if (!x.error) res.episodes++; }); });
                    }, Promise.resolve());
                  });
                }).then(function () { return new Promise(function (ok) { setTimeout(ok, 250); }); });
              });
            }, Promise.resolve()).then(function () { return r.nextCursor && edits < 3000 ? shows(r.nextCursor) : null; });
          });
        }
        return shows(null).then(function () { MediaStore.setTrakt({ episodesSince: started }); });
      });
    };
  }
  /* Continue watching from other apps: where you paused a movie or episode (Trakt's playback), when it's
     newer than where you stopped here.  Movies keep it on the TV; episodes in the library, so the TV shows
     tab's Continue watching has them. */
  function playbackIn(res) {
    return function () {
      res.resumed = res.resumed || 0;
      return getAll('/sync/playback/movies?extended=full', true, 4).then(function (rows) {
        var by = {}; (rows || []).forEach(function (r) { var id = r.movie && r.movie.ids && r.movie.ids.tmdb; if (id) by['tmdb:' + id] = r; });
        MediaStore.movies(null).forEach(function (m) {
          var r = m.metadata && by[m.metadata.id]; if (!r) return;
          var mins = (r.movie && +r.movie.runtime) || parseInt(m.metadata.runtime, 10) || 0, cur = MediaStore.resume(m.id), dur = cur && cur.dur || mins * 60;
          if (dur > 0 && MediaStore.importResume(m.id, dur * (+r.progress || 0) / 100, dur, Date.parse(r.paused_at) || Date.now())) res.resumed++;
        });
      }).then(function () { return getAll('/sync/playback/episodes?extended=full', true, 4); }).then(function (rows) {
        var want = {};
        (rows || []).forEach(function (r) { var id = r.show && r.show.ids && r.show.ids.tmdb; if (id && r.episode) (want['tmdb:tv:' + id] = want['tmdb:tv:' + id] || []).push(r); });
        if (!Object.keys(want).length) return;
        function shows(cursor) {
          var q = { kind: 'show', limit: 200 }; if (cursor) q.cursor = cursor;
          return Media.request('library/query', q, 30000).then(function (r) {
            var mine = (r.items || []).filter(function (s) { return s.metadata && want[s.metadata.id]; });
            return mine.reduce(function (p, s) {
              return p.then(function () {
                return Media.request('library/query', { kind: 'episode', show: s.handle, limit: 200 }, 30000).then(function (er) {
                  return want[s.metadata.id].reduce(function (q2, pb) {
                    var ep = (er.items || []).filter(function (e) { return e.season === pb.episode.season && e.number === pb.episode.number && e.watchState !== 'watched'; })[0];
                    if (!ep) return q2;
                    return q2.then(function () { return Media.request('library/detail', { kind: 'episode', handle: ep.handle }, 30000); }).then(function (d) {
                      var v = d && d.versions && d.versions[0], dur = (+pb.episode.runtime || parseInt(ep.metadata && ep.metadata.runtime, 10) || 0) * 60, at = Date.parse(pb.paused_at) || Date.now();
                      if (!v || !(dur > 0)) return;
                      return Media.request('library/progress', { handle: v.handle, position: dur * (+pb.progress || 0) / 100, duration: dur, session: 'trakt', sequence: at, startedAt: at, at: at, final: true }, 30000).then(function (x) { if (x && !x.error && !x.ignored) res.resumed++; });
                    });
                  }, Promise.resolve());
                });
              });
            }, Promise.resolve()).then(function () { return r.nextCursor ? shows(r.nextCursor) : null; });
          });
        }
        return shows(null);
      });
    };
  }
  /* Where you stopped, out to Trakt (its playback, so other apps offer to continue): a movie or episode left
     between 2% and 90% in. */
  function paused(item, pct) {
    if (!connected() || !settings().watchedOut || !item || !(pct >= 2 && pct <= 90)) return;
    var send = function (body) { body.progress = Math.round(pct * 100) / 100; return post('/scrobble/pause', body).catch(function (e) { note('warn', 'Where you stopped not sent: ' + e.message); }); };
    if (item.kind !== 'episode') { var m = /^tmdb:([0-9]+)$/.exec(String(item.metadata && item.metadata.id || '')); if (m) send({ movie: { ids: { tmdb: +m[1] } } }); return; }
    if (!item.episodeHandle) return;
    Media.request('library/detail', { kind: 'episode', handle: item.episodeHandle }, 30000).then(function (ep) {
      if (!ep || ep.error || ep.season == null || !ep.number || !ep.showId) return;
      return Media.request('library/detail', { kind: 'show', handle: ep.showId }, 30000).then(function (sh) {
        var m = /^tmdb:tv:([0-9]+)$/.exec(String(sh && sh.metadata && sh.metadata.id || ''));
        if (m) return send({ show: { ids: { tmdb: +m[1] } }, episode: { season: +ep.season, number: +ep.number } });
      });
    }).catch(function () {});
  }
  var syncTimer = null;
  function syncSoon(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(function () { syncNow(false).catch(function () {}); syncSoon(SYNC_EVERY); }, ms || 30000); }
  // Recently watched follows what you watch: fetched again after a sync or something sent.
  function historySoon() { lists().forEach(function (l) { if (l.src && l.src.type === 'history') cache.at[l.id] = 0; }); itemsSoon(false); }
  function start() {
    // Connected before Recently watched existed: it's added once, at the top.
    if (connected() && !st().historyOffered) { MediaStore.setTrakt({ historyOffered: true }); if (!has({ type: 'history' })) { var l = lists(); l.unshift(list({ type: 'history' }, 'Recently watched', 'both')); saveLists(l); } }
    if (connected()) { syncSoon(45000); } itemsSoon(false);
  }
  function setSettings(next) { var s = settings(); Object.keys(next || {}).forEach(function (k) { if (k === 'watchedOut' || k === 'historyIn') s[k] = !!next[k]; }); MediaStore.setTrakt({ settings: s }); changed(); }
  function describe() {
    if (connecting && pendingCode()) return 'Waiting for you to enter ' + pendingCode().user + ' at ' + pendingCode().url.replace(/^https?:\/\//, '');
    if (!connected()) return 'Not connected';
    if (syncing) return status || 'Syncing…';
    var t = st().lastSync;
    return 'Connected as ' + user() + (t ? '  ·  synced ' + U.hhmm(t) : '') + (lastSyncError ? '  ·  ' + lastSyncError : '');
  }

  return { connected: connected, user: user, settings: settings, setSettings: setSettings, connect: connect, cancel: cancel, pendingCode: pendingCode, disconnect: disconnect,
    lists: lists, has: has, hasChart: hasChart, hasFound: hasFound, update: update, remove: remove, addChart: addChart, addWatchlist: addWatchlist, addHistory: addHistory, addRecommended: addRecommended, addTyped: addTyped, search: search, browse: browse, holds: holds, tabName: tabName, addFound: addFound, CHARTS: CHARTS,
    itemsOf: itemsOf, itemsSoon: itemsSoon, shelves: shelves, watchedMovie: watchedMovie, watchedEpisode: watchedEpisode, paused: paused, syncNow: syncNow, start: start, describe: describe, onChange: onChange,
    get syncing() { return syncing; }, get busy() { return itemsBusy; }, _test: { parse: parse, normalize: normalize, pathsOf: pathsOf } };
})();
