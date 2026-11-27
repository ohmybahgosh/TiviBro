/* The Plex tab (in the menu once Plex.added()): Home with the rows of your Plex home in Plex's order, then a tab
   per library, in the order picked, each with Plex's own tabs (Recommended, Library, Collections, Categories,
   Playlists), and Search.  Posters come through the helper's door (service/plex.js), sized by the server.
   Drawn with My media's shelf and poster styles (app.css .media-*).
   Keys: ▲ ▼ between rows (and up to the tabs), ◀ ▶ along a row and between tabs, OK opens, Red: filter and sort
   (Library) or rows (Home), Left at a row's start or Back: the side menu.  Chromium 53-compatible. */
var PlexView = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var $ = function (id) { return document.getElementById(id); };
  var SUBS = [['recommended', 'Recommended'], ['library', 'Library'], ['collections', 'Collections'], ['categories', 'Categories'], ['playlists', 'Playlists']];
  var TILE = 244, GAP = 28, ROW_H = 540, PAGE = 60, COLS = 6;
  var built = false, open_ = false, tabsList = [], tabAt = 0, subAt = 0, zone = 'rows', rows = [], rowAt = 0, colAt = {}, stack = [], loadSeq = 0, prefs = readPrefs();

  function readPrefs() { try { return JSON.parse(localStorage.getItem('tivibro.plexView') || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem('tivibro.plexView', JSON.stringify(prefs)); } catch (e) {} }
  function esc(s) { return U.esc ? U.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function build() {
    if (built) return;
    built = true;
    var v = $('viewPlex');
    // Behind everything the backdrop blurred across the whole screen, the sharp one on the right fading into it,
    // and a shade on the left and bottom for the words: no picture with hard edges.
    v.innerHTML = '<div class="plex-bg" id="plexBg"></div><div class="media-bd"><img class="media-hero-art" id="plexArt" alt=""></div><div class="plex-shade"></div>' +
      '<div class="media-tabs" id="plexTabs"></div><div class="media-tabs plex-subs" id="plexSubs"></div>' +
      '<div class="media-hero" id="plexHero"></div>' +
      '<div class="media-shelves" id="plexRows"><div class="media-shelf-stage" id="plexStage"></div></div><div class="plex-empty hidden" id="plexEmpty"></div>';
  }

  /* ---------- What the tabs are ---------- */
  // Home, the libraries picked in Settings > Plex, Search.
  function makeTabs() {
    tabsList = [{ id: 'home', label: T('Home') }].concat(Plex.shownLibraries().filter(function (l) { return Plex.libs(l.server).indexOf(l.key) >= 0 && Plex.chosen().some(function (s) { return s.id === l.server; }); })
      .map(function (l) { return { id: 'lib', lib: l, label: l.title }; }),
      // Top 10: each streaming service's chart (FlixPatrol) with the titles your Plex has, all on one page.
      typeof PlexTop !== 'undefined' && PlexTop.services().length ? [{ id: 'top', label: T('Top 10') }] : [],
      [{ id: 'search', label: T('Search') }]);
    if (tabAt >= tabsList.length) tabAt = 0;
  }
  /* The second row of pills: a library's Plex tabs. */
  function subList() {
    var t = tabNow();
    if (t.id === 'lib') return SUBS;
    return [];
  }
  // Where a tab's pills start: the one picked last time there.
  function firstSub() {
    var t = tabNow(), ids = subList().map(function (x) { return x[0]; });
    if (t.lib) return Math.max(0, ids.indexOf(libPrefs(t.lib).sub || 'recommended'));
    return 0;
  }
  function tabNow() { return tabsList[tabAt] || tabsList[0]; }

  /* ---------- Pictures: through the door to each server ---------- */
  // A poster (or a wide picture) sized for the screen by the server, so the TV never holds a full-size picture.
  // more: Plex's own extras for the resizer, as "&blur=40" (a blurred backdrop).
  function pic(server, path, w, h, more) {
    if (!path || !Net.port) return Promise.resolve('');
    return Plex.door(server).then(function (k) {
      return 'http://127.0.0.1:' + Net.port + '/plex/' + k + '/photo/:/transcode?width=' + w + '&height=' + h + '&minSize=1&upscale=1' + (more || '') + '&url=' + encodeURIComponent(path);
    }, function () { return ''; });
  }
  // A file the server keeps for a title (its title logo, a PNG with a clear background), through the door as it is.
  function raw(server, path) {
    if (!path || !Net.port) return Promise.resolve('');
    return Plex.door(server).then(function (k) { return 'http://127.0.0.1:' + Net.port + '/plex/' + k + path; }, function () { return ''; });
  }
  /* A title's details the rows don't carry (the Top 10's, a hub's short entries): summary, rating, length, and its
     title logo (Plex's clearLogo; an episode's is its show's).  Read once a title, when it's first focused. */
  var details = {};
  function logoOf(m) { var l = (m && m.Image || []).filter(function (x) { return x.type === 'clearLogo'; })[0]; return l ? l.url : ''; }
  function more(m) {
    var k = m.server + ':' + m.ratingKey;
    if (details[k]) return details[k];
    var showKey = m.type === 'episode' ? m.grandparentRatingKey : m.type === 'season' ? m.parentRatingKey : null;
    details[k] = Promise.all([
      Plex.call(m.server, '/library/metadata/' + m.ratingKey).then(function (j) { return (mc(j).Metadata || [])[0] || {}; }, function () { return {}; }),
      showKey ? Plex.call(m.server, '/library/metadata/' + showKey).then(function (j) { return (mc(j).Metadata || [])[0] || {}; }, function () { return {}; }) : Promise.resolve(null)
    ]).then(function (r) { var d = r[0]; d.logo = logoOf(r[1] || d) || logoOf(d); return d; });
    return details[k];
  }

  /* ---------- Reading rows from the servers ---------- */
  function mc(j) { return (j && j.MediaContainer) || {}; }
  function itemsOf(j, server) { return (mc(j).Metadata || []).map(function (m) { m.server = server; return m; }); }
  function shownLib(server, key) { return Plex.libs(server).indexOf(String(key)) >= 0; }
  /* Home: Continue watching across every server, then each server's own home rows in Plex's order, kept to the
     libraries picked. */
  function homeRows() {
    var servers = Plex.chosen();
    var cont = Promise.all(servers.map(function (s) { return Plex.call(s.id, '/hubs/continueWatching?count=20').then(function (j) { return (mc(j).Hub || []).reduce(function (a, h) { return a.concat(itemsOf({ MediaContainer: h }, s.id)); }, []); }, function () { return []; }); }));
    var hubs = Promise.all(servers.map(function (s) { return Plex.call(s.id, '/hubs?count=20&includeGuids=1').then(function (j) { return (mc(j).Hub || []).map(function (h) { return { title: h.title, id: h.hubIdentifier, items: itemsOf({ MediaContainer: h }, s.id) }; }); }, function () { return []; }); }));
    return Promise.all([cont, hubs]).then(function (r) {
      var out = [], seen = {};
      var c = [].concat.apply([], r[0]).filter(function (m) { return shownLib(m.server, m.librarySectionID); }).sort(function (a, b) { return (b.lastViewedAt || 0) - (a.lastViewedAt || 0); });
      if (c.length) out.push({ title: T('Continue watching'), items: c, wide: true });
      var again = function () { if (open_ && tabNow().id === 'home' && !stack.length) load(); };
      if (typeof PlexTop !== 'undefined') out = out.concat(PlexTop.watchRow(again), PlexTop.rows(null, again));
      [].concat.apply([], r[1]).forEach(function (h) {
        if (/continue|ondeck/i.test(h.id || '')) return;
        var items = h.items.filter(function (m) { return m.librarySectionID == null || shownLib(m.server, m.librarySectionID); });
        if (!items.length || seen[h.title]) return;
        seen[h.title] = 1; out.push({ title: h.title, items: items, wide: /episode/.test((items[0] || {}).type) });
      });
      lastHome = out.map(function (x) { return x.title; });
      var off = Plex.prefs().hiddenRows || {};
      return out.filter(function (x) { return !off[x.title]; });
    });
  }
  // A library's Recommended tab: the server's own rows for it (as set in Plex's Manage Recommendations).
  function recommendedRows(l) {
    return Plex.call(l.server, '/hubs/sections/' + l.key + '?count=20&includeGuids=1').then(function (j) {
      var own = (mc(j).Hub || []).map(function (h) { return { title: h.title, items: itemsOf({ MediaContainer: h }, l.server) }; }).filter(function (r) { return r.items.length; });
      // The Top 10 rows too, kept to this library.
      var tops = typeof PlexTop !== 'undefined' ? PlexTop.rows(function (m) { return m.server === l.server && String(m.librarySectionID) === String(l.key); }, function () { if (open_ && tabNow().lib === l && SUBS[subAt][0] === 'recommended' && !stack.length) load(); }) : [];
      return tops.concat(own);
    });
  }
  // Sorts and filters as Plex names them; kept per library.
  var SORTS = [['addedAt:desc', 'Date added'], ['titleSort', 'Title'], ['originallyAvailableAt:desc', 'Release date'], ['rating:desc', 'Critic rating'], ['audienceRating:desc', 'Audience rating'], ['lastViewedAt:desc', 'Last watched'], ['viewCount:desc', 'Plays'], ['duration:desc', 'Length'], ['random', 'Random']];
  function libPrefs(l) { var k = l.server + ':' + l.key; prefs[k] = prefs[k] || {}; return prefs[k]; }
  // Library: everything, in rows of six (the grid), a page at a time.
  function libraryRows(l) {
    var p = libPrefs(l), q = '/library/sections/' + l.key + '/all?type=' + (l.type === 'show' ? 2 : 1) + '&sort=' + encodeURIComponent(p.sort || 'addedAt:desc') + '&X-Plex-Container-Start=0&X-Plex-Container-Size=' + PAGE * 4;
    if (p.unwatched) q += '&unwatched=1';
    if (p.genre) q += '&genre=' + encodeURIComponent(p.genre);
    return Plex.call(l.server, q).then(function (j) {
      var all = itemsOf(j, l.server), out = [];
      for (var i = 0; i < all.length; i += COLS) out.push({ title: i ? '' : T('{n} titles', { n: mc(j).totalSize || all.length }), items: all.slice(i, i + COLS) });
      return out;
    });
  }
  function collectionRows(l) {
    return Plex.call(l.server, '/library/sections/' + l.key + '/collections').then(function (j) {
      var all = itemsOf(j, l.server), out = [];
      for (var i = 0; i < all.length; i += COLS) out.push({ title: i ? '' : T('{n} collections', { n: all.length }), items: all.slice(i, i + COLS) });
      return out;
    });
  }
  // Categories: the library's genres, each a row of its titles (read when the row is reached).
  function categoryRows(l) {
    return Plex.call(l.server, '/library/sections/' + l.key + '/genre').then(function (j) {
      return (mc(j).Directory || []).slice(0, 30).map(function (g) { return { title: g.title, genre: g.title, lib: l, items: [], lazy: true }; });
    });
  }
  function playlistRows() {
    var servers = Plex.chosen();
    return Promise.all(servers.map(function (s) { return Plex.call(s.id, '/playlists?playlistType=video').then(function (j) { return itemsOf(j, s.id); }, function () { return []; }); }))
      .then(function (r) { var all = [].concat.apply([], r); return all.length ? [{ title: T('Playlists'), items: all }] : []; });
  }
  // A show, a season, a collection or a playlist opened: its children as rows.
  function childRows(m) {
    var path = m.type === 'collection' ? '/library/collections/' + m.ratingKey + '/children' : m.type === 'playlist' ? '/playlists/' + m.ratingKey + '/items' :
      m.type === 'filter' ? '/library/sections/' + m.sec + '/all?' + m.field + '=' + encodeURIComponent(m.id) : '/library/metadata/' + m.ratingKey + '/children';
    return Plex.call(m.server, path).then(function (j) {
      var all = itemsOf(j, m.server), out = [];
      for (var i = 0; i < all.length; i += COLS) out.push({ title: i ? '' : m.title, items: all.slice(i, i + COLS), wide: /episode/.test((all[0] || {}).type) });
      return out;
    });
  }
  var lastSearch = '', lastHome = [];
  /* Edit home rows (Red on Home, Settings > Plex): each row of Plex's home on or off; Plex's own order stays. */
  function editRows(after) {
    var off = Plex.prefs().hiddenRows || {};
    var list = lastHome.map(function (t) { return { label: I18n.raw(t), sub: off[t] ? T('Off') : T('On'), action: function () { if (off[t]) delete off[t]; else off[t] = 1; Plex.setPref('hiddenRows', off); editRows(after); } }; });
    if (!list.length) return U.toast(T('Open the Plex tab\'s Home first.'), 5000);
    list.push({ label: T('Show every row, as Plex does'), action: function () { Plex.setPref('hiddenRows', {}); editRows(after); } });
    UI.menu(T('Edit home rows'), list, after || function () { load(); });
  }
  function searchRows(text) {
    if (!text) return Promise.resolve([]);
    return Promise.all(Plex.chosen().map(function (s) { return Plex.call(s.id, '/hubs/search?query=' + encodeURIComponent(text) + '&limit=20').then(function (j) { return (mc(j).Hub || []).map(function (h) { return { title: h.title, items: itemsOf({ MediaContainer: h }, s.id) }; }); }, function () { return []; }); }))
      .then(function (r) { return [].concat.apply([], r).filter(function (h) { return h.items.length && /movie|show|episode|collection|season/.test(h.items[0].type); }); });
  }

  /* ---------- Loading what the current tab shows ---------- */
  function load() {
    if (Object.keys(picCache).length > 1500) picCache = {};
    if (Object.keys(details).length > 600) { details = {}; logos = {}; }   // links to old pictures, let go now and then
    var seq = ++loadSeq, t = tabNow(), top = stack[stack.length - 1], sub = (subList()[subAt] || [])[0];
    var p = top ? childRows(top) : t.id === 'home' ? homeRows() : t.id === 'search' ? searchRows(lastSearch) :
      // Top 10: every service's chart on one page, its movies then its shows, the services in FlixPatrol's order.
      t.id === 'top' ? Promise.resolve([].concat.apply([], PlexTop.services().map(function (svc) { return PlexTop.chartRows(svc, function () { if (open_ && tabNow().id === 'top' && !stack.length) load(); }); }))) :
      sub === 'recommended' ? recommendedRows(t.lib) : sub === 'library' ? libraryRows(t.lib) : sub === 'collections' ? collectionRows(t.lib) : sub === 'categories' ? categoryRows(t.lib) : playlistRows();
    if (!rows.length) empty(T('Loading…'));   // reading again over rows already drawn: no "Loading" on top of them
    p.then(function (r) { if (seq !== loadSeq) return; rows = r; rowAt = Math.min(rowAt, Math.max(0, rows.length - 1)); colAt = {}; empty(rows.length ? '' : t.id === 'search' ? T('Press OK to search Plex') : T('Nothing here yet')); draw(); },
      function (e) { if (seq !== loadSeq) return; rows = []; empty(e && e.message || T('Plex did not answer.')); draw(); });
  }
  function empty(text) { var el = $('plexEmpty'); el.textContent = text; el.classList.toggle('hidden', !text); }
  // A category's row: its titles read when it's first reached.
  function fillLazy(r) {
    if (!r.lazy || r.loading) return;
    r.loading = true;
    Plex.call(r.lib.server, '/library/sections/' + r.lib.key + '/all?type=' + (r.lib.type === 'show' ? 2 : 1) + '&genre=' + encodeURIComponent(r.genre) + '&sort=rating:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=30')
      .then(function (j) { r.items = itemsOf(j, r.lib.server); r.lazy = false; draw(); }, function () { r.loading = false; });
  }

  /* ---------- Drawing ---------- */
  /* draw(): everything, after rows are read.  moved(): after a key press, only what changed (the focus, the
     row's slide, the hero), so moving along a row doesn't rebuild 40 rows of posters and fetch them again. */
  function draw() { drawTabs(); drawRows(); hero(); }
  function moved() { drawTabs(); paintFocus(); heroSoon(); }
  function drawTabs() {
    var tabsEl = $('plexTabs'), subsEl = $('plexSubs'), t = tabNow();
    tabsEl.innerHTML = tabsList.map(function (x, i) { return '<div class="media-tab' + (i === tabAt ? ' on' : '') + '">' + esc(x.label) + '</div>'; }).join('');
    tabsEl.classList.toggle('focus', zone === 'tabs');
    var list = subList(), showSubs = list.length && !stack.length;
    subsEl.classList.toggle('hidden', !showSubs);
    subsEl.innerHTML = showSubs ? list.map(function (x, i) { return '<div class="media-tab' + (i === subAt ? ' on' : '') + '">' + esc(t.id === 'lib' ? T(x[1]) : x[1]) + '</div>'; }).join('') : '';
    subsEl.classList.toggle('focus', zone === 'subs');
  }
  function tileHtml(m, i, r, sel) {
    var wide = r.wide, w = wide ? 400 : TILE, h = wide ? 225 : 366;
    var watched = m.viewCount > 0 && !m.viewOffset, left = m.leafCount && m.viewedLeafCount != null ? m.leafCount - m.viewedLeafCount : 0;
    var prog = m.viewOffset && m.duration ? Math.min(100, Math.round(m.viewOffset / m.duration * 100)) : 0;
    var rank = r.line ? r.line(m) : '';
    var name = m.type === 'episode' ? (m.grandparentTitle || m.title) : m.title, sub = rank ? rank : m.type === 'episode' ? 'S' + (m.parentIndex || 0) + ' · E' + (m.index || 0) + '  ' + (m.title || '') : m.type === 'season' ? (m.leafCount ? T('{n} episodes', { n: m.leafCount }) : '') : (m.year || (m.childCount ? T('{n} titles', { n: m.childCount }) : ''));
    return '<div class="media-tile' + (sel ? ' sel' : '') + '" style="left:' + (14 + i * ((wide ? 400 : TILE) + GAP)) + 'px;width:' + w + 'px">' +
      '<div class="media-art" style="width:' + w + 'px;height:' + h + 'px"><img class="media-cover wait" data-pk="' + esc(m.server) + '" data-pp="' + esc(wide ? (m.art || m.thumb || '') : (m.grandparentThumb && m.type === 'episode' ? m.grandparentThumb : m.thumb || '')) + '" data-w="' + w + '" data-h="' + h + '" alt="">' +
      (left > 0 ? '<span class="media-mark">' + left + '</span>' : watched ? '<span class="media-mark done">✓</span>' : '') +
      (/^#\d+/.test(rank) ? '<span class="plex-rank">' + esc(/^#(\d+)/.exec(rank)[1]) + '</span>' : '') +   // a chart's place, big on the poster
      (prog ? '<div class="media-progress"><i style="width:' + prog + '%"></i></div>' : '') + '</div>' +
      '<div class="media-tile-title">' + esc(name) + '</div><div class="media-tile-year">' + esc(sub) + '</div></div>';
  }
  // The rows, built once per read: posters fill in as rows come near (paintFocus), each picture asked for once.
  function drawRows() {
    var stage = $('plexStage');
    stage.innerHTML = rows.map(function (r, ri) {
      return '<div class="media-shelf" style="top:' + (ri * ROW_H) + 'px">' +
        '<div class="media-shelf-title"><h2>' + esc(r.title || '') + '</h2>' + (r.note ? '<span class="media-shelf-count">' + esc(r.note) + '</span>' : '') + '</div><div class="media-track">' +
        r.items.map(function (m, i) { return tileHtml(m, i, r, false); }).join('') + '</div></div>';
    }).join('');
    paintFocus();
  }
  /* The focus moved: the old tile loses its ring and the new one gets it, the row slides, rows above the focused
     one fade out (their names and lines peeked over the next row), and pictures load for what's near. */
  function paintFocus() {
    var stage = $('plexStage'), shelves = stage.children;
    stage.style.transform = 'translateY(' + (-Math.max(0, rowAt) * ROW_H) + 'px)';
    var old = stage.querySelector('.media-tile.sel'); if (old) old.classList.remove('sel');
    for (var ri = 0; ri < shelves.length; ri++) {
      var sh = shelves[ri], r = rows[ri], c = colAt[ri] || 0, step = (r && r.wide ? 400 : TILE) + GAP;
      sh.classList.toggle('active', ri === rowAt && zone === 'rows');
      sh.classList.toggle('gone', ri < rowAt);
      if (ri < rowAt - 1 || ri > rowAt + 2) continue;
      var track = sh.lastChild; track.style.transform = 'translateX(' + (-Math.max(0, c - 2) * step) + 'px)';
      if (ri === rowAt && zone === 'rows' && track.children[c]) track.children[c].classList.add('sel');
      pictures(track, c);
    }
    if (rows[rowAt]) fillLazy(rows[rowAt]);
    if (rows[rowAt + 1]) fillLazy(rows[rowAt + 1]);
  }
  // A row's pictures from just left of what shows to a screen ahead, each fetched once (picCache keeps the link).
  var picCache = {};
  function pictures(track, c) {
    var tiles = track.children;
    for (var i = Math.max(0, c - 3); i < Math.min(tiles.length, c + 9); i++) {
      var img = tiles[i].querySelector('img[data-pp]');
      if (!img || img._asked) continue;
      img._asked = true;
      (function (img) {
        var k = img.getAttribute('data-pk') + '|' + img.getAttribute('data-pp') + '|' + img.getAttribute('data-w');
        var got = picCache[k] || (picCache[k] = pic(img.getAttribute('data-pk'), img.getAttribute('data-pp'), +img.getAttribute('data-w'), +img.getAttribute('data-h')));
        got.then(function (u) { if (u) { img.onload = function () { img.classList.remove('wait'); }; img.src = u; } });
      })(img);
    }
  }
  function focused() { var r = rows[rowAt]; return r && r.items[colAt[rowAt] || 0]; }
  // The focused title at the top: its name, year, rating, length and summary, its backdrop behind.
  // The hero follows the focus a moment later, so holding ◀ ▶ doesn't fetch a backdrop for every poster passed.
  var heroTimer = 0;
  function heroSoon() { clearTimeout(heroTimer); heroTimer = setTimeout(hero, 160); }
  /* The focused title at the top: its logo (or name), year, rating, length and summary, its backdrop on the right
     and blurred behind.  What the row didn't carry is read once (more()) and filled in. */
  function hero() {
    var m = zone === 'rows' ? focused() : null, el = $('plexHero'), art = $('plexArt'), bg = $('plexBg');
    if (!m) { el.innerHTML = ''; art.style.opacity = 0; bg.style.opacity = 0; return; }
    heroText(m, m);
    more(m).then(function (d) { if (focused() === m) heroText(m, d); });
    var path = m.art || m.grandparentArt || m.thumb;
    pic(m.server, path, 1500, 844).then(function (u) { if (u && focused() === m) { art.style.opacity = 0; art.onload = function () { art.style.opacity = 1; }; art.src = u; } });
    pic(m.server, path, 480, 270, '&blur=36').then(function (u) { if (u && focused() === m) { bg.style.backgroundImage = 'url("' + u + '")'; bg.style.opacity = 1; } });
  }
  /* The words, and the title logo in place of the name.  While the details are being read the name waits unseen
     (it flashed up and then turned into the logo); a title with no logo shows its name once they're in. */
  var logos = {};
  function heroText(m, d) {
    var el = $('plexHero'), ep = m.type === 'episode', name = ep ? m.grandparentTitle : m.title, k = m.server + ':' + m.ratingKey, waiting = d === m && !(k in logos);
    if (d !== m) logos[k] = d.logo || '';
    var facts = [d.year || m.year, d.contentRating || m.contentRating, (d.duration || m.duration) ? Math.round((d.duration || m.duration) / 60000) + ' ' + T('min') : '', (d.leafCount || m.leafCount) ? T('{n} episodes', { n: d.leafCount || m.leafCount }) : ''].filter(Boolean).join('  ·  ');
    el.innerHTML = '<div class="media-kicker">' + esc(ep ? 'S' + m.parentIndex + ' · E' + m.index + '  ' + (m.title || '') : (rows[rowAt].title || '')) + '</div>' +
      '<div class="media-title' + (waiting || logos[k] ? ' unseen' : '') + '" id="plexHeroName">' + esc(name) + '</div><div class="media-facts">' + esc(facts) + '</div>' +
      '<div class="media-summary">' + esc(d.summary || m.summary || '') + '</div>';
    var logo = logos[k];
    if (logo) raw(m.server, logo).then(function (u) {
      var t = $('plexHeroName'); if (!t || focused() !== m) return;
      if (!u) { t.classList.remove('unseen'); return; }
      var lg = U.el('img', 'media-logo'); lg.alt = name || '';
      lg.onload = function () { if (t.parentNode) t.parentNode.replaceChild(lg, t); };
      lg.onerror = function () { t.classList.remove('unseen'); };
      lg.src = u;
    });
  }

  /* ---------- Keys ---------- */
  function keys(a) {
    if (a === 'back') { if (stack.length) { pop(); return true; } Views.tabBar(restore); return true; }
    if (zone === 'tabs') return tabKeys(a);
    if (zone === 'subs') return subKeys(a);
    var r = rows[rowAt], c = colAt[rowAt] || 0;
    if (a === 'left') { if (c > 0) { colAt[rowAt] = c - 1; moved(); } else Views.tabBar(restore); return true; }
    if (a === 'right') { if (r && c < r.items.length - 1) { colAt[rowAt] = c + 1; moved(); } return true; }
    if (a === 'up') { if (rowAt > 0) { rowAt--; colAt[rowAt] = Math.min(colAt[rowAt] || 0, c); } else zone = subList().length && !stack.length ? 'subs' : 'tabs'; moved(); return true; }
    if (a === 'down') { if (rowAt < rows.length - 1) { rowAt++; if (!r || r.title === '' || rows[rowAt].title === '') colAt[rowAt] = Math.min(c, rows[rowAt].items.length - 1); moved(); } return true; }
    if (a === 'ok') { var m = focused(); if (m) openItem(m); else if (tabNow().id === 'search') ask(); return true; }
    if (a === 'hold') { if (focused()) itemOptions(focused()); else options(); return true; }
    if (a === 'red') { options(); return true; }
    return true;
  }
  function tabKeys(a) {
    if (a === 'left') { if (tabAt > 0) { tabAt--; switched(); } else Views.tabBar(restore); return true; }
    if (a === 'right') { if (tabAt < tabsList.length - 1) { tabAt++; switched(); } return true; }
    if (a === 'down') { zone = subList().length ? 'subs' : 'rows'; moved(); return true; }
    if (a === 'ok') { if (tabNow().id === 'search') ask(); else { zone = 'rows'; moved(); } return true; }
    return true;
  }
  function subKeys(a) {
    if (a === 'left') { if (subAt > 0) { subAt--; subSwitched(); } return true; }
    if (a === 'right') { if (subAt < subList().length - 1) { subAt++; subSwitched(); } return true; }
    if (a === 'up') { zone = 'tabs'; moved(); return true; }
    if (a === 'down' || a === 'ok') { zone = 'rows'; moved(); return true; }
    return true;
  }
  function switched() { stack = []; rowAt = 0; colAt = {}; rows = []; subAt = firstSub(); if (zone === 'subs' && !subList().length) zone = 'rows'; prefs.tab = tabNow().id === 'lib' ? tabNow().lib.server + ':' + tabNow().lib.key : tabNow().id; savePrefs(); draw(); load(); }
  function subSwitched() { var l = tabNow().lib; if (l) { libPrefs(l).sub = SUBS[subAt][0]; savePrefs(); } rowAt = 0; colAt = {}; rows = []; draw(); load(); }
  function ask() { UI.prompt(T('Search Plex'), lastSearch, function (t) { lastSearch = String(t || '').trim(); zone = 'rows'; rowAt = 0; load(); }); }

  // OK on a title: a show, season, collection or playlist opens in place; a movie or episode opens its page.
  /* Into a collection, a playlist or a person's titles, and back out: the rows and the place you were come back
     as they were (no reading again), and a person opened from a title's page goes back to that page. */
  function push(m) { m._was = { rows: rows, row: rowAt, col: colAt }; stack.push(m); rowAt = 0; colAt = {}; rows = []; }
  function pop() {
    var m = stack.pop(), w = m._was;
    if (w && w.rows.length) { rows = w.rows; rowAt = w.row; colAt = w.col; empty(''); draw(); } else load();
    if (m.page && typeof PlexPage !== 'undefined' && PlexPage.reshow()) return;
    UI.setHandler(keys);
  }
  function openItem(m) {
    if (/^(collection|playlist|filter)$/.test(m.type)) { push(m); load(); return; }
    // A movie, an episode, a show or a season: its own page, as in Plex.
    if (typeof PlexPage !== 'undefined') PlexPage.open(m, restore);
  }
  /* A person from a page's Cast and crew: their titles in that title's library, in place on the Plex tab. */
  function openPerson(from, p) {
    var m = { type: 'filter', server: from.server, title: p.tag, ratingKey: '', sec: from.librarySectionID, field: p.kind === 'director' ? 'director' : 'actor', id: p.id };
    if (!m.sec || !m.id) return U.toast(T('Plex has no list of titles for {x}', { x: p.tag }), 5000);
    m.page = true; push(m); zone = 'rows'; UI.setHandler(keys); draw(); load();
  }
  // Red: on Library, how it's sorted and filtered (kept per library); elsewhere, the rows' refresh.
  function options() {
    var t = tabNow(), sub = SUBS[subAt][0], top = stack[stack.length - 1];
    if (top && /^(show|season)$/.test(top.type)) return showOptions(top);
    if (t.id !== 'lib' || sub !== 'library' || stack.length) return UI.menu(T('Plex'), [{ label: T('Refresh'), action: function () { load(); } }].concat(t.id === 'home' && !stack.length ? [{ label: T('Edit home rows'), action: function () { editRows(); } }] : []));
    var p = libPrefs(t.lib);
    UI.menu(t.lib.title, [
      { label: T('Sort'), sub: T((SORTS.filter(function (s) { return s[0] === (p.sort || 'addedAt:desc'); })[0] || SORTS[0])[1]), action: function () {
        UI.menu(T('Sort'), SORTS.map(function (s) { return { label: T(s[1]), action: function () { p.sort = s[0]; savePrefs(); rowAt = 0; load(); } }; }));
      } },
      { label: T('Unwatched only'), sub: p.unwatched ? T('On') : T('Off'), action: function () { p.unwatched = !p.unwatched; savePrefs(); rowAt = 0; load(); } },
      { label: T('Genre'), sub: p.genre || T('Any'), action: function () { genres(t.lib, p); } },
      { label: T('Clear filters'), action: function () { delete p.unwatched; delete p.genre; savePrefs(); rowAt = 0; load(); } }
    ]);
  }
  function clock(ms) { var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), x = t % 60; return (h ? h + ':' + (mm < 10 ? '0' : '') : '') + mm + ':' + (x < 10 ? '0' : '') + x; }
  /* Hold OK on a title: what Plex offers for it.  A movie or an episode: Resume, Play from the start, Details,
     Mark watched, Remove from Continue watching, Add to Watchlist (a movie), Go to show and Go to season (an
     episode).  A show or a season: Red's menu for it (Play the next episode, Mark all watched).  A collection or
     a playlist: Open. */
  function itemOptions(m) {
    if (/^(movie|episode)$/.test(m.type) && !m._full) return more(m).then(function (d) { m.guid = m.guid || d.guid; m._full = true; itemOptions(m); }, function () { m._full = true; itemOptions(m); });
    if (/^(show|season)$/.test(m.type)) return showOptions(m);
    if (!/^(movie|episode)$/.test(m.type)) return UI.menu(I18n.raw(m.title), [{ label: T('Open'), action: function () { openItem(m); } }]);
    var list = [], watched = m.viewCount > 0 && !m.viewOffset, play = function (fromStart) { return function () { PlexPage.playKey(m.server, String(m.ratingKey), fromStart).catch(function (e) { U.toast(e.message, 6000); }); }; };
    if (m.viewOffset > 60000) list.push({ label: T('Resume from {x}', { x: clock(m.viewOffset) }), action: play(false) });
    list.push({ label: m.viewOffset > 60000 ? T('Play from the start') : T('Play'), action: play(true) });
    list.push({ label: T('Details'), action: function () { PlexPage.open(m, restore); } });
    list.push({ label: watched ? T('Mark not watched') : T('Mark watched'), action: function () { markOne(m, !watched); } });
    if (m.viewOffset) list.push({ label: T('Remove from Continue watching'), action: function () {
      Plex.call(m.server, '/actions/removeFromContinueWatching?ratingKey=' + m.ratingKey, 'put').then(function () { U.toast(T('Removed from Continue watching')); load(); }, function (e) { U.toast(e.message, 6000); });
    } });
    if (m.type === 'movie' && m.guid && typeof PlexTop !== 'undefined') {
      var on = PlexTop.onWatch(m);
      list.push({ label: on ? T('Remove from Watchlist') : T('Add to Watchlist'), action: function () { Plex.watch(m.guid, !on).then(function () { PlexTop.changedWatch(); U.toast(on ? T('Removed from your Watchlist') : T('Added to your Watchlist')); }, function (e) { U.toast(e.message, 6000); }); } });
    }
    if (m.type === 'episode' && m.grandparentRatingKey) list.push({ label: T('Go to show'), action: function () { PlexPage.open({ ratingKey: m.grandparentRatingKey, type: 'show', title: m.grandparentTitle, server: m.server }, restore); } });
    if (m.type === 'episode' && m.parentRatingKey) list.push({ label: T('Go to season'), action: function () { PlexPage.open({ ratingKey: m.parentRatingKey, type: 'season', title: m.parentTitle, server: m.server }, restore); } });
    UI.menu(I18n.raw(m.type === 'episode' ? (m.grandparentTitle || '') + '  ·  ' + (m.title || '') : m.title), list);
  }
  // One movie or episode watched or not, on the server.
  function markOne(m, on) {
    Plex.call(m.server, (on ? '/:/scrobble' : '/:/unscrobble') + '?identifier=com.plexapp.plugins.library&key=' + m.ratingKey).then(function () { U.toast(on ? T('Marked as watched') : T('Marked as not watched')); load(); }, function (e) { U.toast(e.message, 6000); });
  }
  /* Red on a show or a season: play the next episode (the one you're in, else the first not watched), or mark it
     all watched or not watched, as Plex does. */
  function showOptions(m) {
    Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/allLeaves').then(function (j) {
      var eps = mc(j).Metadata || [], next = eps.filter(function (e) { return e.viewOffset; })[0] || eps.filter(function (e) { return !e.viewCount; })[0];
      var rows = [];
      if (next) rows.push({ label: T('Play S{x} · E{y}', { x: next.parentIndex, y: next.index }), sub: I18n.raw(next.title || ''), action: function () { PlexPage.playKey(m.server, String(next.ratingKey), false).catch(function (e) { U.toast(e.message, 6000); }); } });
      rows.push({ label: T('Mark all watched'), action: function () { markAll(m, true); } }, { label: T('Mark all not watched'), action: function () { markAll(m, false); } }, { label: T('Refresh'), action: function () { load(); } });
      UI.menu(I18n.raw(m.title), rows);
    }, function (e) { U.toast(e.message, 6000); });
  }
  function markAll(m, on) {
    Plex.call(m.server, (on ? '/:/scrobble' : '/:/unscrobble') + '?identifier=com.plexapp.plugins.library&key=' + m.ratingKey).then(function () { U.toast(on ? T('Marked as watched') : T('Marked as not watched')); load(); }, function (e) { U.toast(e.message, 6000); });
  }
  function genres(l, p) {
    Plex.call(l.server, '/library/sections/' + l.key + '/genre').then(function (j) {
      UI.menu(T('Genre'), [{ label: T('Any'), action: function () { delete p.genre; savePrefs(); rowAt = 0; load(); } }].concat((mc(j).Directory || []).map(function (g) {
        return { label: I18n.raw(g.title), action: function () { p.genre = g.title; savePrefs(); rowAt = 0; load(); } };
      })));
    }, function (e) { U.toast(e.message, 6000); });
  }

  function restore() { UI.setHandler(keys); }
  // Opened from the menu: where you were last (the tab), from the top.
  function open() {
    build(); open_ = true; makeTabs();
    if (prefs.tab) tabsList.forEach(function (x, i) { if ((x.id === 'lib' ? x.lib.server + ':' + x.lib.key : x.id) === prefs.tab) tabAt = i; });
    subAt = firstSub();
    zone = 'rows'; stack = []; rowAt = 0; colAt = {};
    UI.setHandler(keys); draw(); load();
  }
  // Back from a title or from watching: the same place, the rows read again (watched marks, Continue watching).
  function resume() { if (!open_) return open(); UI.setHandler(keys); draw(); load(); }
  function leave() { open_ = false; loadSeq++; }

  // A show opened from somewhere else (a title's Go to show): its seasons in place on the Plex tab.
  // A collection (or a show's seasons) from elsewhere: from a title's page it goes on top, so Back returns there.
  function openShow(m) { if (!m.page) stack = []; push(m); zone = 'rows'; UI.setHandler(keys); draw(); load(); }

  return { open: open, resume: resume, leave: leave, picture: pic, file: raw, details: more, openShow: openShow, openPerson: openPerson, itemOptions: itemOptions, editRows: editRows, read: { home: homeRows, children: childRows, search: searchRows }, homeTitles: function () { return lastHome; }, _test: { more: more, tab: function (i) { tabAt = i; switched(); }, home: function () { tabAt = 0; switched(); }, tabs: function () { return tabsList; }, rows: function () { return rows; }, keys: keys, focused: focused } };
})();
