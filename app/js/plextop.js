/* Streaming Top 10s on the Plex tab: yesterday's Top 10s of the streaming services in the TV's region (FlixPatrol,
   fetched and kept by vodhome.js for Movies and shows and My media too), with the titles your Plex servers have.
   Rows: "Streaming Top 10s you have" (every service, best place first) and "Top 10 on Netflix" for each service
   picked in Settings > Plex.  Under each poster: "#3 on Netflix".

   Matching: each chart title is looked up once a day with Plex's own search on every server picked, and taken when
   its TMDB id (Plex's Guid list) is the chart's, or else its kind and name are.  What was found (or not) is kept
   for the day in localStorage 'tivibro.plexTop', so the rows come at once after the first look.
   Chromium 53-compatible. */
var PlexTop = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var KEY = 'tivibro.plexTop', AT_ONCE = 2, TOP_MAX = 40;
  var found = read(), busy = false, waiting = [];

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(found)); } catch (e) {} }
  function norm(t) { return String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }
  function charts() { return typeof VodHome !== 'undefined' && VodHome.top10 ? VodHome.top10(function () { look(); }) : { date: '', charts: [] }; }
  // The services with a chart today, for Settings > Plex.
  function services() { return (charts().charts || []).map(function (c) { return c.service; }).filter(Boolean); }

  /* Every chart title once: { t, tmdb, kind ('movie' | 'show' | ''), key } (key: how it's kept in found). */
  function wanted() {
    var out = [], seen = {};
    (charts().charts || []).forEach(function (c) {
      [['movies', 'movie'], ['shows', 'show'], ['all', '']].forEach(function (p) {
        (c[p[0]] || []).forEach(function (x) {
          var kind = p[1] || (x.k === 'tv' ? 'show' : x.k === 'movie' ? 'movie' : ''), key = (kind || '?') + ':' + (x.tmdb || norm(x.t));
          if (!x.t || seen[key]) return;
          seen[key] = 1; out.push({ t: x.t, tmdb: x.tmdb, kind: kind, key: key });
        });
      });
    });
    return out;
  }
  /* Is this Plex item the chart's title?  The TMDB id when both have one, else the same kind and name. */
  function same(m, w) {
    if (w.kind && m.type !== w.kind) return false;
    var ids = (m.Guid || []).map(function (g) { return String(g.id || ''); });
    var tm = ids.filter(function (g) { return /^tmdb:\/\//.test(g); })[0];
    if (w.tmdb && tm) return tm === 'tmdb://' + w.tmdb;
    return norm(m.title) === norm(w.t);
  }
  // Only what a poster and a page need, kept small in localStorage.
  function slim(m, server) { return { ratingKey: m.ratingKey, type: m.type, title: m.title, year: m.year, thumb: m.thumb, art: m.art, librarySectionID: m.librarySectionID, server: server, Image: (m.Image || []).filter(function (x) { return x.type === 'clearLogo'; }) }; }
  /* One chart title looked up on each server (in order) until one has it. */
  function lookUp(w) {
    var servers = Plex.chosen();
    function on(i) {
      if (i >= servers.length) return Promise.resolve(0);
      var s = servers[i];
      return Plex.call(s.id, '/hubs/search?query=' + encodeURIComponent(w.t) + '&limit=6&includeGuids=1&includeImages=1').then(function (j) {
        var hit = null;
        ((j && j.MediaContainer && j.MediaContainer.Hub) || []).forEach(function (h) { (h.Metadata || []).forEach(function (m) { if (!hit && /^(movie|show)$/.test(m.type) && Plex.libs(s.id).indexOf(String(m.librarySectionID)) >= 0 && same(m, w)) hit = m; }); });
        return hit ? slim(hit, s.id) : on(i + 1);
      }, function () { return on(i + 1); });
    }
    return on(0);
  }
  /* Looks up what today's charts have that isn't known yet, two at a time; done() gets called when it's all known
     (and the rows can be drawn again).  Kept for the chart's date; a new date starts over. */
  function look(done) {
    var day = charts().date || '', ids = Plex.chosen().map(function (s) { return s.id; }).join(',');
    if (!day || !Plex.added()) return;
    if (found.day !== day || found.servers !== ids || !found.hits) found = { day: day, servers: ids, hits: {} };
    if (busy) { if (done) waiting.push(done); return; }
    var todo = wanted().filter(function (w) { return !(w.key in found.hits); });
    if (!todo.length) return;   // all known: what was drawn is right, nothing to call back
    if (done) waiting.push(done);
    busy = true;
    var at = 0, running = 0;
    function next() {
      if (at >= todo.length) { if (!running) { busy = false; save(); flush(); } return; }
      var w = todo[at++]; running++;
      lookUp(w).then(function (hit) { found.hits[w.key] = hit || 0; running--; next(); });
    }
    for (var i = 0; i < AT_ONCE; i++) next();
  }
  function flush() { waiting.splice(0).forEach(function (f) { try { f(); } catch (e) {} }); }

  /* The rows, from what's known now (look() fills in the rest and calls back).  only(m): which titles fit here
     (a library's Recommended keeps to that library).  Settings > Plex: the mixed row and the services picked. */
  function rows(only, then) {
    var c = charts().charts || [], p = Plex.prefs(), out = [];
    look(then);
    if (!c.length || !found.hits) return out;
    function hitsOf(list, svc) {
      var items = [], ranks = {};
      list.forEach(function (x) {
        var kind = x._kind, key = (kind || '?') + ':' + (x.tmdb || norm(x.t)), m = found.hits[key];
        if (!m || (only && !only(m))) return;
        var id = m.server + ':' + m.ratingKey;
        if (ranks[id] && ranks[id].r <= x.r) return;
        if (!ranks[id]) items.push(m);
        ranks[id] = { r: x.r, svc: svc || x._svc };
      });
      items.sort(function (a, b) { return ranks[a.server + ':' + a.ratingKey].r - ranks[b.server + ':' + b.ratingKey].r; });
      items = items.slice(0, TOP_MAX);   // a big library matches 90 and more across every service: the best places
      return { items: items, line: function (m) { var k = ranks[m.server + ':' + m.ratingKey]; return k ? '#' + k.r + ' ' + T('on {x}', { x: k.svc }) : ''; } };
    }
    function entries(ch) {
      var out2 = [];
      [['movies', 'movie'], ['shows', 'show'], ['all', '']].forEach(function (p2) { (ch[p2[0]] || []).forEach(function (x) { out2.push({ t: x.t, tmdb: x.tmdb, r: x.r, _svc: ch.service, _kind: p2[1] || (x.k === 'tv' ? 'show' : x.k === 'movie' ? 'movie' : '') }); }); });
      return out2;
    }
    if (p.topMixed) {
      var all = hitsOf([].concat.apply([], c.map(entries)));
      if (all.items.length) out.push({ title: T('Streaming Top 10s you have'), items: all.items, line: all.line, note: 'FlixPatrol', top: true });
    }
    (p.topServices || []).forEach(function (svc) {
      var ch = c.filter(function (x) { return x.service === svc; })[0]; if (!ch) return;
      var one = hitsOf(entries(ch), svc);
      if (one.items.length) out.push({ title: T('Top 10 on {x}', { x: svc }), items: one.items, line: one.line, note: 'FlixPatrol', top: true });
    });
    return out;
  }

  /* ---------- The Watchlist row ---------- */
  /* Your Plex Watchlist with the titles your servers have (each found by its plex:// guid in the libraries picked),
     newest first as Plex keeps it.  Read again after 10 minutes, or right away after a change (changedWatch). */
  var watch = { at: 0, items: [], busy: false, waiting: [] }, WATCH_AGE = 600e3;
  function watchRow(then) {
    if (!Plex.prefs().watchRow || !Plex.added()) return [];
    if (Date.now() - watch.at > WATCH_AGE) readWatch(then);
    return watch.items.length ? [{ title: T('Watchlist'), items: watch.items }] : [];
  }
  function changedWatch() { watch.at = 0; }
  // Is this server title on the Watchlist (as last read)?
  function onWatch(m) { return watch.items.some(function (x) { return x.guid && x.guid === m.guid; }); }
  function readWatch(then) {
    if (then) watch.waiting.push(then);
    if (watch.busy) return;
    watch.busy = true;
    Plex.watchlist().then(function (list) {
      return Promise.all(list.slice(0, 40).map(findOnServers)).then(function (found2) {
        watch.items = found2.filter(Boolean); watch.at = Date.now(); watch.busy = false;
        watch.waiting.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
      });
    }).catch(function () { watch.busy = false; watch.at = Date.now(); watch.waiting = []; });
  }
  /* A Watchlist title's own copy on a server picked, in a library picked of its kind, or null. */
  function findOnServers(w) {
    var libs = Plex.shownLibraries().filter(function (l) { return l.type === w.type && Plex.libs(l.server).indexOf(l.key) >= 0; });
    function on(i) {
      if (i >= libs.length || !w.guid) return Promise.resolve(null);
      var l = libs[i];
      return Plex.call(l.server, '/library/sections/' + l.key + '/all?guid=' + encodeURIComponent(w.guid)).then(function (j) {
        var m = ((j && j.MediaContainer && j.MediaContainer.Metadata) || [])[0];
        if (!m) return on(i + 1);
        m.server = l.server; return m;
      }, function () { return on(i + 1); });
    }
    return on(0);
  }

  /* The Top 10 tab: one service's chart as two rows, its movies and its shows, with the titles your Plex has, in
     the chart's order, "#3" under each.  then() when the titles not looked for yet are known. */
  function chartRows(svc, then) {
    var ch = (charts().charts || []).filter(function (x) { return x.service === svc; })[0], out = [];
    look(then);
    if (!ch || !found.hits) return out;
    [['movie', 'movies'], ['show', 'shows']].forEach(function (k) {
      var list = (ch[k[1]] && ch[k[1]].length ? ch[k[1]] : (ch.all || []).filter(function (x) { return (x.k === 'tv' ? 'show' : x.k) === k[0]; })), items = [], ranks = {};
      list.forEach(function (x) {
        var m = found.hits[(k[0]) + ':' + (x.tmdb || norm(x.t))] || found.hits['?:' + (x.tmdb || norm(x.t))];
        if (!m || ranks[m.server + ':' + m.ratingKey]) return;
        ranks[m.server + ':' + m.ratingKey] = x.r; items.push(m);
      });
      if (items.length) out.push({ title: k[0] === 'movie' ? T('Top 10 movies on {x}', { x: svc }) : T('Top 10 shows on {x}', { x: svc }), note: 'FlixPatrol', items: items, line: function (m) { var r = ranks[m.server + ':' + m.ratingKey]; return r ? '#' + r : ''; } });
    });
    return out;
  }

  return { rows: rows, chartRows: chartRows, watchRow: watchRow, onWatch: onWatch, changedWatch: changedWatch, services: services, look: look, _test: { same: same, wanted: wanted, norm: norm, reset: function () { found = {}; busy = false; save(); } } };
})();
