/* My media's library grid (for big libraries): a whole list as posters, nine to a row, that you scroll down
   through, like Plex's library view.  The letters down the right side jump to the titles starting with one
   (▶ from the last column onto them, ▲ ▼ along them, OK or ◀ back to the posters), ◀ from the first column opens
   the side menu; CH+ and CH− go a page at a
   time; Red sorts and filters (Plex's: watched or not, in progress, recently added, 4K, HDR, Dolby Vision,
   rating, genre, year, decade, director, actor, library; several at once); OK opens the title's page and Back comes
   back to the same place.  Collections open the same way: a grid of collections, then a collection's movies.
   Only the rows on screen are drawn, so 10,000 titles scroll as fast as 10.  Poster size (Red, or Settings >
   My media > Library poster size): small (11 to a row), medium (9), large (7) or extra large (5). */
var MediaGrid = (function () {
  'use strict';
  // Elements with words on them, in the viewer's language (I18n: titles and names come as RAW and stay as they are).
  function tel(tag, cls, text) { return U.el(tag, cls, text == null || typeof I18n === 'undefined' ? text : I18n.t(text)); }
  var $ = U.$, RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var COLS = 9, ROW_H = 336, COL_W = 182, TILE_W = 164, ART_H = 246, VISIBLE = 3, PAGE = 2;
  // The grid's room: 1628 px across (less 16 px each side for the focused poster's grown border), 894 down.
  var WIDTH = 1596, HEIGHT = 894, PAD = 16;
  var SIZES = [['small', 'Small', 11], ['medium', 'Medium', 9], ['large', 'Large', 7], ['xl', 'Extra large', 5]];
  function sizeNow() { var v = typeof Store !== 'undefined' && Store.settings && Store.settings.mediaGridSize; return SIZES.some(function (x) { return x[0] === v; }) ? v : 'medium'; }
  function layout() {
    var sz = sizeNow(); COLS = SIZES.filter(function (x) { return x[0] === sz; })[0][2];
    COL_W = Math.floor(WIDTH / COLS); TILE_W = COL_W - 18; ART_H = Math.round(TILE_W * 1.5);
    ROW_H = ART_H + (sz === 'xl' ? 104 : 90); VISIBLE = Math.ceil(HEIGHT / ROW_H); PAGE = Math.max(1, VISIBLE - 1);
    return sz;
  }
  var LETTERS = ['#'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
  var g = null;   // { title, all, list, sel, top, zone: 'grid' | 'letters', letter, sort, filters: { type: filter }, kind, back, open }
  var last = null;   // the grid the side menu left (My media opens on it again: remember())

  function md(m) { return (m && m.metadata) || {}; }
  function nameOf(m) { return String(md(m).title || m.title || ''); }
  function yearOf(m) { return String(m.year || md(m).year || (md(m).releaseDate || '').slice(0, 4) || ''); }
  function key(m) { return nameOf(m).toLowerCase().replace(/^[^a-z0-9]+(?=[a-z0-9])/, '').replace(/^(the|a|an)\s+(?=\S)/, '').replace(/^[^a-z0-9]+(?=[a-z0-9])/, '').replace(/\d+/g, function (n) { n = n.replace(/^0+(?=\d)/, ''); return '000000000'.slice(n.length) + n; }); }
  function letterOf(m) { var c = key(m).charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; }
  function watched(m) { return m.kind === 'show' ? m.eps > 0 && (m.seen || 0) >= m.eps : !!(MediaStore.isWatched && MediaStore.isWatched(m.id)); }
  function started(m) { return m.kind === 'show' ? m.seen > 0 && m.seen < m.eps : !watched(m) && !!(MediaStore.resume && MediaStore.resume(m.id)); }
  function fresh(m) { return m.kind === 'show' ? !(m.seen > 0) : !watched(m) && !started(m); }
  function added(m) { return Media.addedAt ? Media.addedAt(m) || m.createdAt || 0 : m.newAt || m.createdAt || m.mt || m.addedAt || 0; }
  function pic(m) { var t = Media.pictureInfo ? Media.pictureInfo(m) : ''; return ' ' + t + ' '; }
  function people(m, k) { return String(md(m)[k] || '').split(/\s*,\s*/).filter(Boolean); }
  function directors(m) { return md(m).directors || []; }
  function srcs(m) { return m.sourceIds || (m.src ? [m.src] : m.sourceId ? [m.sourceId] : []); }
  function released(m) { return String(md(m).releaseDate || yearOf(m)); }
  function rating(m) { return +md(m).rating || 0; }
  function genres(m) { return String(md(m).genre || '').split(/\s*,\s*/).filter(Boolean); }
  function decade(m) { var y = +yearOf(m); return y ? (y < 1980 ? 'Before 1980' : Math.floor(y / 10) * 10 + 's') : ''; }

  var SORTS = [['title', 'Title, A to Z'], ['added', 'Date added, newest first'], ['release', 'Release date, newest first'], ['rating', 'Rating, highest first']];
  var SHOW_SORTS = [['title', 'Title, A to Z'], ['added', 'Newest episode added first'], ['release', 'First aired, newest first'], ['rating', 'Rating, highest first'], ['seasons', 'Most seasons first']];
  // Collections: their own sorts (a collection has no date or rating of its own: its movies do).
  var COL_SORTS = [['title', 'Title, A to Z'], ['count', 'Most movies first'], ['newest', 'Newest movie first'], ['added', 'Movie added most recently first']];
  function sorts() { return g.kind === 'collection' ? COL_SORTS : g.kind === 'show' ? SHOW_SORTS : SORTS; }
  function newest(c, f) { var best = 0; (c.list || []).forEach(function (m) { var v = f(m); if (v > best) best = v; }); return best; }
  function sortList(list, by) {
    var k = {}; list.forEach(function (m, i) { k[i] = key(m); m._gi = i; });
    var t = function (a, b) { return k[a._gi] < k[b._gi] ? -1 : k[a._gi] > k[b._gi] ? 1 : 0; };
    if (g.kind === 'collection') {
      var v = {}; list.forEach(function (c) { v[c._gi] = by === 'count' ? c.count || 0 : by === 'newest' ? newest(c, function (m) { return +released(m).replace(/-/g, '') || 0; }) : by === 'added' ? newest(c, added) : 0; });
      return list.sort(by === 'title' ? t : function (a, b) { return (v[b._gi] - v[a._gi]) || t(a, b); });
    }
    return list.sort(by === 'added' ? function (a, b) { return (added(b) - added(a)) || t(a, b); }
      : by === 'release' ? function (a, b) { var x = released(a), y = released(b); return x < y ? 1 : x > y ? -1 : t(a, b); }
        : by === 'rating' ? function (a, b) { return (rating(b) - rating(a)) || t(a, b); }
          : by === 'seasons' ? function (a, b) { return ((b.seasons || 0) - (a.seasons || 0)) || t(a, b); } : t);
  }
  // The sort you chose stays for that kind of grid (All movies, All shows, Collections) until you change it.
  function remembered(kind) { try { return (JSON.parse(localStorage.getItem('tivibro.gridSort') || '{}') || {})[kind] || 'title'; } catch (e) { return 'title'; } }
  function remember(kind, by) { try { var o = JSON.parse(localStorage.getItem('tivibro.gridSort') || '{}') || {}; o[kind] = by; localStorage.setItem('tivibro.gridSort', JSON.stringify(o)); } catch (e) {} }
  /* Filters, one of each type at a time, all of them together (Plex's).  Each: { type, value, name }. */
  var DAY = 864e5;
  function passes(m, f) {
    switch (f.type) {
      case 'state': return f.value === 'unwatched' ? fresh(m) : f.value === 'progress' ? started(m) : watched(m);
      case 'added': return added(m) > Date.now() - f.value * DAY;
      case 'res': return pic(m).indexOf(' ' + f.value + ' ') >= 0 || (f.value === '4K' && (m.info || []).some(function (x) { return /2160p|4K/i.test(x); }));
      case 'range': return f.value === 'hdr' ? / (HDR|HDR10\+?|HLG|Dolby Vision) /.test(pic(m)) : pic(m).indexOf(' Dolby Vision ') >= 0;
      case 'copies': return !!(Media.copyCount && Media.copyCount(m) > 1);
      case 'rating': return rating(m) >= f.value;
      case 'genre': return genres(m).indexOf(f.value) >= 0;
      case 'year': return yearOf(m) === f.value;
      case 'decade': return decade(m) === f.value;
      case 'director': return directors(m).indexOf(f.value) >= 0;
      case 'actor': return people(m, 'cast').indexOf(f.value) >= 0;
      case 'source': return srcs(m).indexOf(f.value) >= 0;
    }
    return true;
  }
  function active() { return Object.keys(g.filters || {}).map(function (k) { return g.filters[k]; }); }
  function apply() {
    var fs = active(), list = g.all.filter(function (m) { for (var i = 0; i < fs.length; i++) if (!passes(m, fs[i])) return false; return true; });
    if (!sorts().some(function (x) { return x[0] === g.sort; })) g.sort = 'title';
    g.list = g.custom ? list : sortList(list, g.sort);
    g.sel = Math.min(g.sel, Math.max(0, g.list.length - 1));
  }

  /* opts: { title, items, kind ('movie', 'show' or 'collection'), back, open(item, back), sort, custom (keep the
     order given: a collection in release order) } */
  function open(opts) {
    g = { title: opts.title, all: (opts.items || []).slice(), kind: opts.kind || 'movie', back: opts.back, open: opts.open, sel: 0, top: 0, zone: 'grid', letter: 0, sort: opts.sort || remembered(opts.kind || 'movie'), filters: {}, custom: !!opts.custom, play: opts.play, spec: opts.spec || null };
    apply();
    $('viewMedia').classList.add('mgr-on');
    UI.setHandler(keys); draw();
  }
  function box() {
    var b = $('mediaGrid');
    if (!b) { b = tel('div', 'mgr'); b.id = 'mediaGrid'; $('viewMedia').appendChild(b); }
    return b;
  }
  function close() {
    var was = g; g = null;
    var b = $('mediaGrid'); if (b) b.innerHTML = '';
    $('viewMedia').classList.remove('mgr-on');
    if (was && was.back) was.back();
  }
  // Back from a title: the grid again, on the same title.
  function resume(state) { return function () { g = state; apply(); $('viewMedia').classList.add('mgr-on'); UI.setHandler(keys); draw(); }; }
  function choose() {
    var m = g.list[g.sel]; if (!m) return;
    var state = g; g = null;
    var b = $('mediaGrid'); if (b) b.innerHTML = '';
    $('viewMedia').classList.remove('mgr-on');
    state.open(m, resume(state));
  }

  function img(src) { var i = tel('img', 'mgr-pic'); i.decoding = 'async'; i.src = src; i.onerror = function () { if (!(typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this))) this.remove(); }; return i; }
  function hints() {
    if (g.zone === 'letters') return UI.hints([['', '▲ ▼  letters'], ['', 'OK  go there'], ['', 'Back  close', 'back']]);
    UI.hints([['', 'OK  open'], ['', 'CH+ CH−  page'], g.custom || g.sort !== 'title' ? null : ['', '▶ at the end  letters'], !titled() ? null : ['', 'Hold OK  options', 'hold'], g.kind === 'movie' ? ['yellow', 'Watched'] : null, ['red', g.custom ? 'Options' : 'Sort, filter, poster size'], ['', 'Back  close', 'back']].filter(Boolean));
  }
  function present() { var have = {}; g.list.forEach(function (m) { have[letterOf(m)] = 1; }); return have; }
  function draw() {
    if (!g) return;
    var sz = layout(), b = box(), n = g.list.length, row = Math.floor(g.sel / COLS);
    // The focused row stays in the middle once there is room above it.
    g.top = Math.max(0, Math.min(row - 1, Math.ceil(n / COLS) - 2));
    b.innerHTML = '';
    var head = tel('div', 'mgr-head');
    head.appendChild(tel('div', 'mgr-title', RAW(g.title)));
    var what = [n + (g.kind === 'category' ? (n === 1 ? ' category' : ' categories') : g.kind === 'collection' ? (n === 1 ? ' collection' : ' collections') : g.kind === 'show' ? (n === 1 ? ' show' : ' shows') : (n === 1 ? ' movie' : ' movies'))];
    if (!g.custom) what.push(sorts().filter(function (s) { return s[0] === g.sort; })[0][1]);
    var fs = active(); if (fs.length) what.push(fs.length > 2 ? fs.length + ' filters' : fs.map(function (f) { return f.name; }).join(' + '));
    head.appendChild(tel('div', 'mgr-sub', what.join('   ·   ')));
    b.appendChild(head);
    if (!n) { b.appendChild(tel('div', 'shp-empty mgr-empty', fs.length ? 'Nothing here with those filters.  Red changes them.' : 'Nothing here yet.')); hints(); return; }
    var grid = tel('div', 'mgr-grid mgr-' + sz);
    for (var r = g.top; r < g.top + VISIBLE + 1; r++) {
      for (var c = 0; c < COLS; c++) {
        var i = r * COLS + c; if (i >= n) break;
        (function (m, i) {
          var t = tel('div', 'mgr-tile' + (g.zone === 'grid' && i === g.sel ? ' sel' : ''));
          // 12 px of room above for the focused poster's grown border.
          t.style.top = ((r - g.top) * ROW_H + 12) + 'px';
          t.style.left = (c * COL_W + PAD) + 'px';   // and 16 px at the left, so the first column's border isn't cut off
          t.style.width = TILE_W + 'px';
          var art = tel('div', 'mgr-art'), pic = md(m).poster || m.poster;
          art.style.width = TILE_W + 'px'; art.style.height = ART_H + 'px';
          // A category: its own colour (from its name, the same every time), as Plex's tinted tiles.
          if (g.kind === 'category') { art.classList.add('mgr-cat'); art.style.background = hue(nameOf(m)); if (pic) art.appendChild(img(pic)); art.appendChild(tel('span', 'mgr-cat-name', RAW(nameOf(m)))); }
          else if (pic) art.appendChild(img(pic)); else art.appendChild(tel('span', 'mshp-noart', RAW(nameOf(m))));
          var mk = Media.posterMark ? Media.posterMark(m) : '';
          if (mk) art.appendChild(tel('span', 'media-mark' + (mk === '✓' ? ' done' : ''), mk));
          if (g.kind === 'collection') art.appendChild(tel('span', 'mgr-count', String(m.count)));
          t.appendChild(art);
          if (g.kind !== 'category') t.appendChild(tel('div', 'mgr-name' + (Media.isNew && Media.isNew(m) ? ' is-new' : ''), RAW(nameOf(m))));
          // Sorted by date added, when each came (Plex's "2 days ago"); else the year, and a show's seasons.
          var sub = g.kind === 'collection' || g.kind === 'category' ? (m.count + (g.kind === 'category' && m.list[0] && m.list[0].kind === 'show' ? (m.count === 1 ? ' show' : ' shows') : (m.count === 1 ? ' movie' : ' movies')))
            : g.sort === 'added' && !g.custom && Media.addedLine ? Media.addedLine(m)
              : g.kind === 'show' && m.seasons ? [yearOf(m), m.seasons + (m.seasons === 1 ? ' season' : ' seasons')].filter(Boolean).join('  ·  ') : yearOf(m);
          if (sub) t.appendChild(tel('div', 'mgr-year', sub));
          t.onclick = function () { g.zone = 'grid'; g.sel = i; choose(); };
          grid.appendChild(t);
        })(g.list[i], i);
      }
    }
    b.appendChild(grid);
    // The letters (sorted by title only: by date or rating they would jump nowhere useful).
    if (!g.custom && g.sort === 'title') {
      var have = present(), rail = tel('div', 'mgr-letters'), cur = letterOf(g.list[g.sel]);
      LETTERS.forEach(function (L, i) {
        var e = tel('div', 'mgr-letter' + (have[L] ? '' : ' none') + (L === cur ? ' cur' : '') + (g.zone === 'letters' && i === g.letter ? ' sel' : ''), L);
        if (have[L]) e.onclick = function () { jump(L); g.zone = 'grid'; draw(); };
        rail.appendChild(e);
      });
      b.appendChild(rail);
    }
    b.appendChild(tel('div', 'mgr-pos', (g.sel + 1) + ' of ' + n));
    hints();
  }
  function jump(L) {
    for (var i = 0; i < g.list.length; i++) if (letterOf(g.list[i]) === L) { g.sel = i; return true; }
    return false;
  }
  /* Red: sort, filter and poster size.  Filters as Plex lists them: the quick ones (watched or not, in progress,
     recently added, picture), then by genre, year, decade, director, actor and library; several at once, one of
     each kind, and OK on a ticked one takes it off. */
  function menu() {
    var state = g, again = function () { if (g === state) draw(); UI.setHandler(keys); };
    var redo = function () { state.sel = 0; apply(); again(); };
    var items = [];
    if (state.play) items.push({ label: '▶  Play the whole collection', sub: 'One movie after another, in order', action: function () {
      g = null; var bx = $('mediaGrid'); if (bx) bx.innerHTML = ''; $('viewMedia').classList.remove('mgr-on');
      state.play(state.list, resume(state));
    } });
    if (!g.custom) {
      var cs = sorts().filter(function (x) { return x[0] === g.sort; })[0];
      items.push({ label: typeof I18n !== 'undefined' ? I18n.t('Sort: {x}…', { x: I18n.t(cs[1]) }) : 'Sort: ' + cs[1] + '…', action: function () {
        UI.menu('Sort', sorts().map(function (x) { return { label: (state.sort === x[0] ? '✓  ' : '') + x[1], current: state.sort === x[0], action: function () { state.sort = x[0]; remember(state.kind, x[0]); redo(); } }; }), again);
      } });
    }
    if (g.kind === 'movie' || g.kind === 'show') {
      var fs = active();
      items.push({ label: 'Filter…', sub: fs.length ? fs.map(function (f) { return f.name; }).join(', ') : 'Not watched, in progress, recently added, 4K, genre, year, actor…', action: function () { filterMenu(state, redo, again); } });
      if (fs.length) items.push({ label: 'Clear filters', sub: fs.length === 1 ? '1 filter on' : fs.length + ' filters on', action: function () { state.filters = {}; redo(); } });
    }
    var cur = SIZES.filter(function (x) { return x[0] === sizeNow(); })[0];
    items.push({ label: 'Poster size: ' + cur[1] + '…', sub: 'Bigger posters, fewer to a row', action: function () {
      UI.menu('Poster size', SIZES.map(function (x) { return { label: (x[0] === cur[0] ? '✓  ' : '') + x[1], sub: x[2] + ' to a row', current: x[0] === cur[0], action: function () {
        var m = state.list[state.sel]; Store.settings.mediaGridSize = x[0]; Store.saveSettings(); if (m) state.sel = state.list.indexOf(m); again();
      } }; }), again);
    } });
    UI.menu(g.custom ? 'Options' : 'Sort and filter', items, again);
  }
  function filterMenu(state, redo, again) {
    var show = state.kind === 'show', all = state.all, back = function () { filterMenu(state, redo, again); };
    var on = function (type, value) { var f = state.filters[type]; return !!f && (value === undefined || f.value === value); };
    // OK: on (replacing another of its kind), or off when it was on.  Back to the grid straight after.
    var pick = function (f) { return function () { if (on(f.type, f.value)) delete state.filters[f.type]; else state.filters[f.type] = f; redo(); }; };
    var tick = function (type, value) { return on(type, value) ? '✓  ' : ''; };
    var n = function (f) { var c = 0; all.forEach(function (m) { if (passes(m, f)) c++; }); return c; };
    var quick = function (f) { var c = n(f); return c ? { label: tick(f.type, f.value) + f.name, sub: c + '', action: pick(f) } : null; };
    // A list of values (genre, year...): each with how many have it, the most first or in its own order.
    var many = function (title, type, valuesOf, order) {
      var c = {}; all.forEach(function (m) { valuesOf(m).forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; }); });
      var keys = Object.keys(c); if (keys.length < 2) return null;
      keys.sort(order || function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
      var name = function (v) { return type === 'source' ? srcName(v) : v; };
      return { label: tick(type) + title + '…', sub: on(type) ? name(state.filters[type].value) : keys.slice(0, 3).map(name).join(', ') + (keys.length > 3 ? ', …' : ''), action: function () {
        UI.menu(title, keys.slice(0, 300).map(function (v) { return { label: tick(type, v) + RAW(name(v)), sub: c[v] + '', current: on(type, v), action: pick({ type: type, value: v, name: name(v) }) }; }), back);
      } };
    };
    var items = [
      quick({ type: 'state', value: 'unwatched', name: show ? 'Not started' : 'Not watched yet' }),
      quick({ type: 'state', value: 'progress', name: show ? 'Started, not finished' : 'In progress' }),
      quick({ type: 'state', value: 'watched', name: 'Watched' }),
      quick({ type: 'added', value: 7, name: show ? 'New episodes this week' : 'Added this week' }),
      quick({ type: 'added', value: 30, name: show ? 'New episodes this month' : 'Added this month' }),
      show ? null : quick({ type: 'res', value: '4K', name: '4K' }),
      show ? null : quick({ type: 'range', value: 'hdr', name: 'HDR' }),
      show ? null : quick({ type: 'range', value: 'dv', name: 'Dolby Vision' }),
      show ? null : quick({ type: 'copies', name: 'More than one copy' }),
      quick({ type: 'rating', value: 7, name: 'Rated 7 or more' }),
      quick({ type: 'rating', value: 8, name: 'Rated 8 or more' }),
      many('Genre', 'genre', genres),
      many('Year', 'year', function (m) { return [yearOf(m)]; }, function (a, b) { return a < b ? 1 : -1; }),
      many('Decade', 'decade', function (m) { return [decade(m)]; }, function (a, b) { return a < b ? 1 : -1; }),
      show ? null : many('Director', 'director', directors),
      many('Actor', 'actor', function (m) { return people(m, 'cast').slice(0, 8); }),
      many('Library', 'source', srcs)
    ].filter(Boolean);
    // Two of a kind (Added this week or this month, Not watched or Watched) share a type: OK on one replaces the other.
    if (active().length) items.push({ label: 'Clear filters', action: function () { state.filters = {}; redo(); } });
    UI.menu('Filter', items, again);
  }
  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return 'linear-gradient(160deg,hsl(' + h + ',45%,38%),hsl(' + ((h + 30) % 360) + ',50%,16%))'; }
  function titled() { return g.kind === 'movie' || g.kind === 'show'; }
  function srcName(id) { var x = MediaStore.source && MediaStore.source(id); return (x && x.name) || 'Library'; }
  function keys(a) {
    if (!g) return false;
    var n = g.list.length;
    if (a === 'back') { if (g.zone === 'letters') g.zone = 'grid'; else { close(); return true; } }
    else if (a === 'red') { menu(); return true; }
    else if (a === 'yellow' && g.zone !== 'letters') { var ym = g.list[g.sel]; if (ym && Media.movieCard && Media.movieCard(ym)) { Media.quickMarkMovie(ym); draw(); } else U.toast('Yellow marks a movie watched.  For a show, open it.'); return true; }
    else if (g.zone === 'letters') {
      var have = present();
      if (a === 'up' || a === 'down') { var i = g.letter; do { i += a === 'up' ? -1 : 1; } while (i >= 0 && i < LETTERS.length && !have[LETTERS[i]]); if (i >= 0 && i < LETTERS.length) { g.letter = i; jump(LETTERS[i]); } }
      else if (a === 'ok' || a === 'left') g.zone = 'grid';
    } else {
      if (!n) return true;
      if (a === 'left' && g.sel % COLS > 0) g.sel--;
      // ◀ from the first column: the side menu, as everywhere else (▶ on My media there comes back to the grid).
      else if (a === 'left') { var st = g; Views.tabBar(function () { if (g === st) { UI.setHandler(keys); draw(); } }); return true; }
      else if (a === 'right') {
        if (g.sel % COLS < COLS - 1 && g.sel < n - 1) g.sel++;
        else if (!g.custom && g.sort === 'title') { g.zone = 'letters'; g.letter = Math.max(0, LETTERS.indexOf(letterOf(g.list[g.sel]))); }
      }
      else if (a === 'up' && g.sel >= COLS) g.sel -= COLS;
      else if (a === 'down') { if (g.sel + COLS < n) g.sel += COLS; else if (Math.floor(g.sel / COLS) < Math.floor((n - 1) / COLS)) g.sel = n - 1; }
      else if (a === 'chup' || a === 'chdown') g.sel = Math.max(0, Math.min(n - 1, g.sel + (a === 'chup' ? -1 : 1) * COLS * PAGE));
      else if (a === 'ok') { choose(); return true; }
      // ▶: straight to playing it (Plex), coming back here after, not to its page.
      else if (a === 'playpause' && titled() && Media.playNow) { var pm = g.list[g.sel], st2 = g; g = null; var gb = $('mediaGrid'); if (gb) gb.innerHTML = ''; $('viewMedia').classList.remove('mgr-on'); var back2 = resume(st2); pm.returnTo = function () { pm.returnTo = null; back2(); }; Media.playNow(pm); return true; }
      else if (a === 'hold' || a === 'info') { var m = g.list[g.sel], state = g; if (m && titled() && Media.optionsFor) { Media.optionsFor(m, function () { if (g === state) { UI.setHandler(keys); draw(); } }); } return true; }
    }
    draw(); return true;
  }
  // Another tab chosen from the side menu while the grid was open: it goes, without its Back (media.js open).
  function dismiss() { if (g && g.spec) last = { state: g, at: Date.now() }; g = null; var b = $('mediaGrid'); if (b) b.innerHTML = ''; $('viewMedia').classList.remove('mgr-on'); }
  /* My media opens on the grid it was showing when you went to another tab (Settings > My media > Open where you
     left off): the same list, sort, filters and poster; Back from it goes to the shelves as usual. */
  function reopen(spec) {
    if (!last || !spec || JSON.stringify(last.state.spec) !== JSON.stringify(spec)) return false;
    var st = last.state; last = null; g = st; apply();
    $('viewMedia').classList.add('mgr-on'); UI.setHandler(keys); draw(); return true;
  }
  function lastSpec() { return last ? last.state.spec : null; }
  return { open: open, dismiss: dismiss, reopen: reopen, lastSpec: lastSpec, isOpen: function () { return !!g; }, _test: { passes: passes, state: function () { return g; } } };
})();
