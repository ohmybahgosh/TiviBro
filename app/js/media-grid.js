/* My media's library grid (for big libraries): a whole list as posters, nine to a row, that you scroll down
   through, like Plex's library view.  The letters down the right side jump to the titles starting with one
   (▶ from the last column onto them, ▲ ▼ along them, OK or ◀ back to the posters), ◀ from the first column opens
   the side menu; CH+ and CH− go a page at a
   time; Red sorts and filters (genre, decade, not watched yet, 4K); OK opens the title's page and Back comes
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
  var g = null;   // { title, all, list, sel, top, zone: 'grid' | 'letters', letter, sort, filter, kind, back, open }

  function md(m) { return (m && m.metadata) || {}; }
  function nameOf(m) { return String(md(m).title || m.title || ''); }
  function yearOf(m) { return String(m.year || md(m).year || (md(m).releaseDate || '').slice(0, 4) || ''); }
  function key(m) { return nameOf(m).toLowerCase().replace(/^[^a-z0-9]+(?=[a-z0-9])/, '').replace(/^(the|a|an)\s+(?=\S)/, '').replace(/^[^a-z0-9]+(?=[a-z0-9])/, '').replace(/\d+/g, function (n) { n = n.replace(/^0+(?=\d)/, ''); return '000000000'.slice(n.length) + n; }); }
  function letterOf(m) { var c = key(m).charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; }
  function watched(m) { return m.kind === 'show' ? false : !!(MediaStore.isWatched && MediaStore.isWatched(m.id)); }
  function added(m) { return m.newAt || m.createdAt || m.mt || m.addedAt || 0; }
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
  function apply() {
    var f = g.filter, list = g.all.filter(function (m) {
      if (!f) return true;
      if (f.type === 'unwatched') return !watched(m);
      if (f.type === '4k') return (m.info || []).some(function (x) { return /2160p|4K/i.test(x); });
      if (f.type === 'genre') return genres(m).indexOf(f.value) >= 0;
      if (f.type === 'decade') return decade(m) === f.value;
      return true;
    });
    if (!sorts().some(function (x) { return x[0] === g.sort; })) g.sort = 'title';
    g.list = g.custom ? list : sortList(list, g.sort);
    g.sel = Math.min(g.sel, Math.max(0, g.list.length - 1));
  }

  /* opts: { title, items, kind ('movie', 'show' or 'collection'), back, open(item, back), sort, custom (keep the
     order given: a collection in release order) } */
  function open(opts) {
    g = { title: opts.title, all: (opts.items || []).slice(), kind: opts.kind || 'movie', back: opts.back, open: opts.open, sel: 0, top: 0, zone: 'grid', letter: 0, sort: opts.sort || remembered(opts.kind || 'movie'), filter: null, custom: !!opts.custom, play: opts.play };
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
    UI.hints([['', 'OK  open'], ['', 'CH+ CH−  page'], g.custom || g.sort !== 'title' ? null : ['', '▶ at the end  letters'], g.kind === 'collection' ? null : ['', 'Hold OK  options', 'hold'], ['red', g.custom ? 'Options' : 'Sort, filter, poster size'], ['', 'Back  close', 'back']].filter(Boolean));
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
    var what = [n + (g.kind === 'collection' ? (n === 1 ? ' collection' : ' collections') : g.kind === 'show' ? (n === 1 ? ' show' : ' shows') : (n === 1 ? ' movie' : ' movies'))];
    if (!g.custom) what.push(sorts().filter(function (s) { return s[0] === g.sort; })[0][1]);
    if (g.filter) what.push(g.filter.name);
    head.appendChild(tel('div', 'mgr-sub', what.join('   ·   ')));
    b.appendChild(head);
    if (!n) { b.appendChild(tel('div', 'shp-empty mgr-empty', g.filter ? 'Nothing here with that filter.  Red changes it.' : 'Nothing here yet.')); hints(); return; }
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
          if (pic) art.appendChild(img(pic)); else art.appendChild(tel('span', 'mshp-noart', RAW(nameOf(m))));
          if (watched(m)) art.appendChild(tel('span', 'shp-done', '✓'));
          if (g.kind === 'collection') art.appendChild(tel('span', 'mgr-count', String(m.count)));
          t.appendChild(art);
          t.appendChild(tel('div', 'mgr-name', RAW(nameOf(m))));
          var sub = g.kind === 'collection' ? (m.count + (m.count === 1 ? ' movie' : ' movies'))
            : g.kind === 'show' && m.seasons ? [yearOf(m), m.seasons + (m.seasons === 1 ? ' season' : ' seasons')].filter(Boolean).join('  ·  ') : yearOf(m);
          if (g.kind === 'show' && m.seasons) art.appendChild(tel('span', 'mgr-count', m.seasons + ' S'));
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
  function menu() {
    var state = g, again = function () { if (g === state) draw(); UI.setHandler(keys); };
    var gs = {}, ds = {};
    g.all.forEach(function (m) { genres(m).forEach(function (x) { gs[x] = (gs[x] || 0) + 1; }); var d = decade(m); if (d) ds[d] = (ds[d] || 0) + 1; });
    var set = function (f) { return function () { state.filter = f; state.sel = 0; apply(); again(); }; };
    var items = [];
    if (state.play) items.push({ label: '▶  Play the whole collection', sub: 'One movie after another, in order', action: function () {
      g = null; var bx = $('mediaGrid'); if (bx) bx.innerHTML = ''; $('viewMedia').classList.remove('mgr-on');
      state.play(state.list, resume(state));
    } });
    if (!g.custom) sorts().forEach(function (s) { items.push({ label: (g.sort === s[0] ? '✓  ' : '') + 'Sort: ' + s[1], current: g.sort === s[0], action: function () { state.sort = s[0]; state.sel = 0; if (!state.custom) remember(state.kind, s[0]); apply(); again(); } }); });
    if (g.kind !== 'collection') {
      items.push({ label: (!g.filter ? '✓  ' : '') + 'Show all', action: set(null) });
      if (g.kind === 'movie') {
        items.push({ label: (g.filter && g.filter.type === 'unwatched' ? '✓  ' : '') + 'Not watched yet', action: set({ type: 'unwatched', name: 'Not watched yet' }) });
        items.push({ label: (g.filter && g.filter.type === '4k' ? '✓  ' : '') + '4K', action: set({ type: '4k', name: '4K' }) });
      }
      var gl = Object.keys(gs).sort();
      if (gl.length) items.push({ label: 'Genre…', sub: gl.slice(0, 4).join(', ') + (gl.length > 4 ? ', …' : ''), action: function () { UI.menu('Genre', gl.map(function (x) { return { label: RAW(x), sub: gs[x] + '', action: set({ type: 'genre', value: x, name: x }) }; }), again); } });
      var dl = Object.keys(ds).sort().reverse();
      if (dl.length > 1) items.push({ label: 'Decade…', action: function () { UI.menu('Decade', dl.map(function (x) { return { label: x, sub: ds[x] + '', action: set({ type: 'decade', value: x, name: x }) }; }), again); } });
    }
    var cur = SIZES.filter(function (x) { return x[0] === sizeNow(); })[0];
    items.push({ label: 'Poster size: ' + cur[1] + '…', sub: 'Bigger posters, fewer to a row', action: function () {
      UI.menu('Poster size', SIZES.map(function (x) { return { label: (x[0] === cur[0] ? '✓  ' : '') + x[1], sub: x[2] + ' to a row', current: x[0] === cur[0], action: function () {
        var m = state.list[state.sel]; Store.settings.mediaGridSize = x[0]; Store.saveSettings(); if (m) state.sel = state.list.indexOf(m); again();
      } }; }), again);
    } });
    UI.menu(g.custom ? 'Options' : 'Sort and filter', items, again);
  }
  function keys(a) {
    if (!g) return false;
    var n = g.list.length;
    if (a === 'back') { if (g.zone === 'letters') g.zone = 'grid'; else { close(); return true; } }
    else if (a === 'red') { menu(); return true; }
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
      else if (a === 'playpause' && g.kind !== 'collection' && Media.playNow) { var pm = g.list[g.sel], st2 = g; g = null; var gb = $('mediaGrid'); if (gb) gb.innerHTML = ''; $('viewMedia').classList.remove('mgr-on'); var back2 = resume(st2); pm.returnTo = function () { pm.returnTo = null; back2(); }; Media.playNow(pm); return true; }
      else if (a === 'hold' || a === 'info') { var m = g.list[g.sel], state = g; if (m && g.kind !== 'collection' && Media.optionsFor) { Media.optionsFor(m, function () { if (g === state) { UI.setHandler(keys); draw(); } }); } return true; }
    }
    draw(); return true;
  }
  // Another tab chosen from the side menu while the grid was open: it goes, without its Back (media.js open).
  function dismiss() { g = null; var b = $('mediaGrid'); if (b) b.innerHTML = ''; $('viewMedia').classList.remove('mgr-on'); }
  return { open: open, dismiss: dismiss, isOpen: function () { return !!g; } };
})();
