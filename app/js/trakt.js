/* Trakt (trakt.tv): sign in with a code on the screen (trakt.tv/activate), mark what you finish as watched on
   Trakt, bring your Trakt watched history in, and Trakt lists as My media shelves (your watchlist, Trakt's
   charts, your own lists and anyone's public list, added like in Radarr and Sonarr: a link, user and list
   name, or a search).  Calls go through the helper (service/trakt.js); the sign-in is kept by mediastore.js.
   Settings > Trakt (settings.js), the phone app (it mirrors those rows) and the web editor (webedit.js).
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
    if (!t || !t.access) return Promise.reject(new Error('Connect Trakt first: Settings > Trakt.'));
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
        if (!st().lists) MediaStore.setTrakt({ lists: defaults() });
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
  function defaults() { return [list({ type: 'watchlist' }, 'Your Trakt watchlist', 'both'), list({ type: 'chart', chart: 'trending', of: 'movies' }, 'Trending movies on Trakt', 'movies'), list({ type: 'chart', chart: 'trending', of: 'shows' }, 'Trending shows on Trakt', 'shows')]; }
  function lists() { return (st().lists || []).slice(); }
  function saveLists(l) { MediaStore.setTrakt({ lists: l.slice(0, 30) }); changed(); if (typeof Media !== 'undefined' && Media.refresh) Media.refresh(); }
  function update(id, patch) { saveLists(lists().map(function (x) { if (x.id !== id) return x; var y = {}; Object.keys(x).forEach(function (k) { y[k] = x[k]; }); Object.keys(patch).forEach(function (k) { y[k] = patch[k]; }); if (patch.kind && !patch.tab) y.tab = tabFor(patch.kind); return y; })); if (patch.kind) itemsSoon(true); }
  function remove(id) { saveLists(lists().filter(function (x) { return x.id !== id; })); }
  function add(l) {
    var have = lists();
    if (have.some(function (x) { return JSON.stringify(x.src) === JSON.stringify(l.src) && x.kind === l.kind; })) throw new Error('That list is already on My media.');
    if (have.length >= 30) throw new Error('30 Trakt lists at most.');
    have.push(l); saveLists(have); itemsSoon(true); return l;
  }
  function addChart(chart, of) { var c = CHARTS.filter(function (x) { return x[0] === chart && x[1] === of; })[0]; if (!c) throw new Error('Choose a Trakt chart.'); return add(list({ type: 'chart', chart: chart, of: of }, c[2], of)); }
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
  function addTyped(input, kind) {
    var src = parse(input);
    if (!src) return Promise.reject(new Error('Paste a Trakt list link (trakt.tv/users/NAME/lists/LIST), or type NAME/LIST.'));
    var path = src.type === 'list' ? '/users/' + encodeURIComponent(src.user) + '/lists/' + encodeURIComponent(src.slug) : src.type === 'official' ? '/lists/' + encodeURIComponent(src.id) : null;
    var named = path ? get(path).then(function (l) { return l && l.name ? l.name : null; }) : Promise.resolve(src.user + '\'s watchlist');
    return named.then(function (name) {
      if (!name) throw new Error('Trakt has no such list.  Check the link: the list must be public.');
      return add(list(src, name, kind || 'both'));
    });
  }
  function search(q) {
    return get('/search/list?query=' + encodeURIComponent(String(q || '').slice(0, 80)) + '&limit=15').then(function (r) {
      return (r || []).map(function (x) { var l = x.list || {}, u = l.user && l.user.ids && l.user.ids.slug || ''; return { name: l.name || '', user: u, slug: l.ids && l.ids.slug || '', count: l.item_count || 0, likes: l.likes || 0 }; })
        .filter(function (x) { return x.user && x.slug; });
    });
  }
  function addFound(x, kind) { if (!/^[A-Za-z0-9._-]{1,80}$/.test(x.user || '') || !/^[A-Za-z0-9._-]{1,120}$/.test(x.slug || '')) throw new Error('That is not a Trakt list.'); return add(list({ type: 'list', user: x.user, slug: x.slug }, x.name, kind || 'both')); }

  // A list's items: { k: 'movie'|'show', tmdb, title, year }.
  function pathsOf(l) {
    var s = l.src || {}, kinds = l.kind === 'movies' ? ['movies'] : l.kind === 'shows' ? ['shows'] : ['movies', 'shows'];
    if (s.type === 'watchlist') return kinds.map(function (k) { return ['/sync/watchlist/' + k + '?limit=300', k, true]; });
    if (s.type === 'userwatchlist') return kinds.map(function (k) { return ['/users/' + encodeURIComponent(s.user) + '/watchlist/' + k + '?limit=300', k]; });
    if (s.type === 'chart') return [['/' + s.of + '/' + s.chart + '?limit=100', s.of]];
    if (s.type === 'recommended') return [['/recommendations/' + s.of + '?limit=60&ignore_collected=false', s.of, true]];
    if (s.type === 'list') return kinds.map(function (k) { return ['/users/' + encodeURIComponent(s.user) + '/lists/' + encodeURIComponent(s.slug) + '/items/' + k.replace(/s$/, '') + '?limit=500', k]; });
    if (s.type === 'official') return kinds.map(function (k) { return ['/lists/' + encodeURIComponent(s.id) + '/items/' + k.replace(/s$/, '') + '?limit=500', k]; });
    return [];
  }
  function normalize(rows, k) {
    var out = [];
    (rows || []).forEach(function (r) {
      var x = r && (r.movie || r.show) || r, kind = r && r.show ? 'show' : r && r.movie ? 'movie' : k === 'shows' ? 'show' : 'movie';
      var id = x && x.ids && x.ids.tmdb;
      if (id) out.push({ k: kind, tmdb: +id, title: String(x.title || '').slice(0, 120), year: x.year || 0 });
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
      Promise.all(pathsOf(l).map(function (p) { return get(p[0], p[2]).then(function (rows) { got = got.concat(normalize(rows, p[1])); }); })).then(function () {
        cache.items[l.id] = got; cache.at[l.id] = Date.now();
      }, function (e) { note('warn', 'List "' + l.name + '": ' + e.message); cache.at[l.id] = Date.now() - ITEMS_AGE + 600e3; }).then(function () { setTimeout(function () { next(i + 1); }, 400); });
    })(0);
  }
  // For My media (media.js shelvesNow): the shelves, with the keys its pool uses ('tmdb:ID', 'tmdb:tv:ID').
  function shelves() {
    return lists().filter(function (l) { return l.on !== false; }).map(function (l) {
      return { id: l.id, title: l.name, tab: l.tab || tabFor(l.kind), kind: l.kind, keys: itemsOf(l.id).map(function (x) { return x.k === 'show' ? 'tmdb:tv:' + x.tmdb : 'tmdb:' + x.tmdb; }) };
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
    return post('/sync/history', body).then(function () { MediaStore.setTrakt({ queue: [] }); note('info', 'Sent ' + q.length + ' watched to Trakt'); });
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
      if (settings().historyIn && (manual || ep !== before.episodes)) jobs.push(episodesIn(res));
      return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve()).then(function () { MediaStore.setTrakt({ lastActivities: { movies: mv, episodes: ep } }); });
    }).then(function () {
      syncing = false; lastSyncError = ''; status = ''; MediaStore.setTrakt({ lastSync: Date.now() });
      if (res.movies || res.episodes) { note('info', 'From Trakt: ' + res.movies + ' movies and ' + res.episodes + ' episodes marked watched'); if (Media.refresh) Media.refresh(); }
      changed(); return res;
    }, function (e) { syncing = false; lastSyncError = e.message; status = ''; changed(); note('warn', 'Sync: ' + e.message); throw e; });
  }
  function moviesIn(res) {
    return function () {
      return get('/sync/watched/movies', true).then(function (rows) {
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
  function episodesIn(res) {
    return function () {
      return get('/sync/watched/shows', true).then(function (rows) {
        var by = {};
        (rows || []).forEach(function (r) { var id = r.show && r.show.ids && r.show.ids.tmdb; if (!id) return; var e = by['tmdb:tv:' + id] = {}; (r.seasons || []).forEach(function (s) { (s.episodes || []).forEach(function (x) { e[s.number + 'x' + x.number] = 1; }); }); });
        if (!Object.keys(by).length) return;
        return Media.request('library/query', { kind: 'show', limit: 200 }, 30000).then(function first(r) {
          var shows = (r.items || []).filter(function (s) { return s.metadata && by[s.metadata.id]; }), edits = 0;
          return shows.reduce(function (p, s) {
            return p.then(function () {
              if (edits >= 2000) return;
              return Media.request('library/query', { kind: 'episode', show: s.handle, limit: 200 }, 30000).then(function (er) {
                var todo = (er.items || []).filter(function (e) { return e.watchState !== 'watched' && by[s.metadata.id][e.season + 'x' + e.number]; });
                return todo.reduce(function (q, e) {
                  return q.then(function () { edits++; return Media.request('library/edit', { handle: e.handle, expectedRevision: e.revision, operation: 'setWatched', watched: true }, 30000).then(function (x) { if (!x.error) res.episodes++; }); });
                }, Promise.resolve());
              });
            });
          }, Promise.resolve()).then(function () { return r.nextCursor && edits < 2000 ? Media.request('library/query', { kind: 'show', limit: 200, cursor: r.nextCursor }, 30000).then(first) : null; });
        });
      });
    };
  }
  var syncTimer = null;
  function syncSoon(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(function () { syncNow(false).catch(function () {}); syncSoon(SYNC_EVERY); }, ms || 30000); }
  function start() { if (connected()) { syncSoon(45000); } itemsSoon(false); }
  function setSettings(next) { var s = settings(); Object.keys(next || {}).forEach(function (k) { if (k === 'watchedOut' || k === 'historyIn') s[k] = !!next[k]; }); MediaStore.setTrakt({ settings: s }); changed(); }
  function describe() {
    if (connecting && pendingCode()) return 'Waiting for you to enter ' + pendingCode().user + ' at ' + pendingCode().url.replace(/^https?:\/\//, '');
    if (!connected()) return 'Not connected';
    if (syncing) return status || 'Syncing…';
    var t = st().lastSync;
    return 'Connected as ' + user() + (t ? '  ·  synced ' + U.hhmm(t) : '') + (lastSyncError ? '  ·  ' + lastSyncError : '');
  }

  return { connected: connected, user: user, settings: settings, setSettings: setSettings, connect: connect, cancel: cancel, pendingCode: pendingCode, disconnect: disconnect,
    lists: lists, update: update, remove: remove, addChart: addChart, addWatchlist: addWatchlist, addRecommended: addRecommended, addTyped: addTyped, search: search, addFound: addFound, CHARTS: CHARTS,
    itemsOf: itemsOf, itemsSoon: itemsSoon, shelves: shelves, watchedMovie: watchedMovie, watchedEpisode: watchedEpisode, syncNow: syncNow, start: start, describe: describe, onChange: onChange,
    get syncing() { return syncing; }, get busy() { return itemsBusy; }, _test: { parse: parse, normalize: normalize, pathsOf: pathsOf } };
})();
