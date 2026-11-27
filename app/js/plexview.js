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
  var TILE = 244, GAP = 28, ROW_H = 480, PAGE = 60, COLS = 6;
  var built = false, open_ = false, tabsList = [], tabAt = 0, subAt = 0, zone = 'rows', rows = [], rowAt = 0, colAt = {}, stack = [], loadSeq = 0, prefs = readPrefs();

  function readPrefs() { try { return JSON.parse(localStorage.getItem('tivibro.plexView') || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem('tivibro.plexView', JSON.stringify(prefs)); } catch (e) {} }
  function esc(s) { return U.esc ? U.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function build() {
    if (built) return;
    built = true;
    var v = $('viewPlex');
    v.innerHTML = '<div class="media-bd"><img class="media-hero-art" id="plexArt" alt=""></div><div class="media-fade"></div>' +
      '<div class="media-tabs" id="plexTabs"></div><div class="media-tabs plex-subs" id="plexSubs"></div>' +
      '<div class="media-hero" id="plexHero"></div>' +
      '<div class="media-shelves" id="plexRows"><div class="media-shelf-stage" id="plexStage"></div></div><div class="plex-empty hidden" id="plexEmpty"></div>';
  }

  /* ---------- What the tabs are ---------- */
  // Home, the libraries picked in Settings > Plex, Search.
  function makeTabs() {
    tabsList = [{ id: 'home', label: T('Home') }].concat(Plex.shownLibraries().filter(function (l) { return Plex.libs(l.server).indexOf(l.key) >= 0 && Plex.chosen().some(function (s) { return s.id === l.server; }); })
      .map(function (l) { return { id: 'lib', lib: l, label: l.title }; }), [{ id: 'search', label: T('Search') }]);
    if (tabAt >= tabsList.length) tabAt = 0;
  }
  function tabNow() { return tabsList[tabAt] || tabsList[0]; }

  /* ---------- Pictures: through the door to each server ---------- */
  // A poster (or a wide picture) sized for the screen by the server, so the TV never holds a full-size picture.
  function pic(server, path, w, h) {
    if (!path || !Net.port) return Promise.resolve('');
    return Plex.door(server).then(function (k) {
      return 'http://127.0.0.1:' + Net.port + '/plex/' + k + '/photo/:/transcode?width=' + w + '&height=' + h + '&minSize=1&upscale=1&url=' + encodeURIComponent(path);
    }, function () { return ''; });
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
    var path = m.type === 'collection' ? '/library/collections/' + m.ratingKey + '/children' : m.type === 'playlist' ? '/playlists/' + m.ratingKey + '/items' : '/library/metadata/' + m.ratingKey + '/children';
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
    var seq = ++loadSeq, t = tabNow(), top = stack[stack.length - 1], sub = SUBS[subAt][0];
    var p = top ? childRows(top) : t.id === 'home' ? homeRows() : t.id === 'search' ? searchRows(lastSearch) :
      sub === 'recommended' ? recommendedRows(t.lib) : sub === 'library' ? libraryRows(t.lib) : sub === 'collections' ? collectionRows(t.lib) : sub === 'categories' ? categoryRows(t.lib) : playlistRows();
    empty(T('Loading…'));
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
  function draw() {
    var tabsEl = $('plexTabs'), subsEl = $('plexSubs'), t = tabNow();
    tabsEl.innerHTML = tabsList.map(function (x, i) { return '<div class="media-tab' + (i === tabAt ? ' on' : '') + '">' + esc(x.label) + '</div>'; }).join('');
    tabsEl.classList.toggle('focus', zone === 'tabs');
    var showSubs = t.id === 'lib' && !stack.length;
    subsEl.classList.toggle('hidden', !showSubs);
    subsEl.innerHTML = showSubs ? SUBS.map(function (x, i) { return '<div class="media-tab' + (i === subAt ? ' on' : '') + '">' + esc(T(x[1])) + '</div>'; }).join('') : '';
    subsEl.classList.toggle('focus', zone === 'subs');
    drawRows();
    hero();
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
      (prog ? '<div class="media-progress"><i style="width:' + prog + '%"></i></div>' : '') + '</div>' +
      '<div class="media-tile-title">' + esc(name) + '</div><div class="media-tile-year">' + esc(sub) + '</div></div>';
  }
  function drawRows() {
    var stage = $('plexStage');
    stage.innerHTML = rows.map(function (r, ri) {
      var c = colAt[ri] || 0, step = (r.wide ? 400 : TILE) + GAP, shift = Math.max(0, c - 2) * step;
      return '<div class="media-shelf' + (ri === rowAt && zone === 'rows' ? ' active' : '') + '" style="top:' + (ri * ROW_H) + 'px">' +
        '<div class="media-shelf-title"><h2>' + esc(r.title || '') + '</h2>' + (r.note ? '<span class="media-shelf-count">' + esc(r.note) + '</span>' : '') + '</div><div class="media-track" style="transform:translateX(' + (-shift) + 'px)">' +
        r.items.map(function (m, i) { return tileHtml(m, i, r, ri === rowAt && zone === 'rows' && i === c); }).join('') + '</div></div>';
    }).join('');
    stage.style.transform = 'translateY(' + (-Math.max(0, rowAt) * ROW_H) + 'px)';
    // Pictures for what's on screen and just below.
    [].forEach.call(stage.querySelectorAll('img[data-pp]'), function (img) {
      var pp = img.getAttribute('data-pp'); if (!pp) return;
      pic(img.getAttribute('data-pk'), pp, +img.getAttribute('data-w'), +img.getAttribute('data-h')).then(function (u) { if (u) { img.onload = function () { img.classList.remove('wait'); }; img.src = u; } });
    });
    if (rows[rowAt]) fillLazy(rows[rowAt]);
    if (rows[rowAt + 1]) fillLazy(rows[rowAt + 1]);
  }
  function focused() { var r = rows[rowAt]; return r && r.items[colAt[rowAt] || 0]; }
  // The focused title at the top: its name, year, rating, length and summary, its backdrop behind.
  function hero() {
    var m = zone === 'rows' ? focused() : null, el = $('plexHero'), art = $('plexArt');
    if (!m) { el.innerHTML = ''; art.style.opacity = 0; return; }
    var facts = [m.year, m.contentRating, m.duration ? Math.round(m.duration / 60000) + ' ' + T('min') : '', m.leafCount ? T('{n} episodes', { n: m.leafCount }) : ''].filter(Boolean).join('  ·  ');
    el.innerHTML = '<div class="media-kicker">' + esc(m.type === 'episode' ? 'S' + m.parentIndex + ' · E' + m.index : (rows[rowAt].title || '')) + '</div>' +
      '<div class="media-title">' + esc(m.type === 'episode' ? m.grandparentTitle : m.title) + '</div><div class="media-facts">' + esc(facts) + '</div>' +
      '<div class="media-summary">' + esc(m.summary || '') + '</div>';
    pic(m.server, m.art || m.grandparentArt || m.thumb, 1340, 600).then(function (u) { if (u && focused() === m) { art.style.opacity = 0; art.onload = function () { art.style.opacity = 1; }; art.src = u; } });
  }

  /* ---------- Keys ---------- */
  function keys(a) {
    if (a === 'back') { if (stack.length) { stack.pop(); load(); return true; } Views.tabBar(restore); return true; }
    if (zone === 'tabs') return tabKeys(a);
    if (zone === 'subs') return subKeys(a);
    var r = rows[rowAt], c = colAt[rowAt] || 0;
    if (a === 'left') { if (c > 0) { colAt[rowAt] = c - 1; draw(); } else Views.tabBar(restore); return true; }
    if (a === 'right') { if (r && c < r.items.length - 1) { colAt[rowAt] = c + 1; draw(); } return true; }
    if (a === 'up') { if (rowAt > 0) { rowAt--; colAt[rowAt] = Math.min(colAt[rowAt] || 0, c); } else zone = tabNow().id === 'lib' && !stack.length ? 'subs' : 'tabs'; draw(); return true; }
    if (a === 'down') { if (rowAt < rows.length - 1) { rowAt++; if (!r || r.title === '' || rows[rowAt].title === '') colAt[rowAt] = Math.min(c, rows[rowAt].items.length - 1); draw(); } return true; }
    if (a === 'ok') { var m = focused(); if (m) openItem(m); else if (tabNow().id === 'search') ask(); return true; }
    if (a === 'red' || a === 'hold') { options(); return true; }
    return true;
  }
  function tabKeys(a) {
    if (a === 'left') { if (tabAt > 0) { tabAt--; switched(); } else Views.tabBar(restore); return true; }
    if (a === 'right') { if (tabAt < tabsList.length - 1) { tabAt++; switched(); } return true; }
    if (a === 'down') { zone = tabNow().id === 'lib' ? 'subs' : 'rows'; draw(); return true; }
    if (a === 'ok') { if (tabNow().id === 'search') ask(); else { zone = 'rows'; draw(); } return true; }
    return true;
  }
  function subKeys(a) {
    if (a === 'left') { if (subAt > 0) { subAt--; subSwitched(); } return true; }
    if (a === 'right') { if (subAt < SUBS.length - 1) { subAt++; subSwitched(); } return true; }
    if (a === 'up') { zone = 'tabs'; draw(); return true; }
    if (a === 'down' || a === 'ok') { zone = 'rows'; draw(); return true; }
    return true;
  }
  function switched() { stack = []; rowAt = 0; colAt = {}; rows = []; prefs.tab = tabNow().id === 'lib' ? tabNow().lib.server + ':' + tabNow().lib.key : tabNow().id; savePrefs(); draw(); load(); }
  function subSwitched() { var l = tabNow().lib; if (l) { libPrefs(l).sub = SUBS[subAt][0]; savePrefs(); } rowAt = 0; colAt = {}; rows = []; draw(); load(); }
  function ask() { UI.prompt(T('Search Plex'), lastSearch, function (t) { lastSearch = String(t || '').trim(); zone = 'rows'; rowAt = 0; load(); }); }

  // OK on a title: a show, season, collection or playlist opens in place; a movie or episode opens its page.
  function openItem(m) {
    if (/^(show|season|collection|playlist)$/.test(m.type)) { stack.push(m); rowAt = 0; colAt = {}; load(); return; }
    if (typeof PlexPage !== 'undefined') PlexPage.open(m, restore);
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
    var l = tabNow().lib; subAt = l ? Math.max(0, SUBS.map(function (s) { return s[0]; }).indexOf(libPrefs(l).sub || 'recommended')) : 0;
    zone = 'rows'; stack = []; rowAt = 0; colAt = {};
    UI.setHandler(keys); draw(); load();
  }
  // Back from a title or from watching: the same place, the rows read again (watched marks, Continue watching).
  function resume() { if (!open_) return open(); UI.setHandler(keys); draw(); load(); }
  function leave() { open_ = false; loadSeq++; }

  // A show opened from somewhere else (a title's Go to show): its seasons in place on the Plex tab.
  function openShow(m) { stack = [m]; rowAt = 0; colAt = {}; zone = 'rows'; UI.setHandler(keys); load(); }

  return { open: open, resume: resume, leave: leave, picture: pic, openShow: openShow, editRows: editRows, read: { home: homeRows, children: childRows, search: searchRows }, homeTitles: function () { return lastHome; }, _test: { home: function () { tabAt = 0; switched(); }, tabs: function () { return tabsList; }, rows: function () { return rows; }, keys: keys, focused: focused } };
})();
