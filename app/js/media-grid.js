/* My media's library grid (for big libraries): a whole list as posters, nine to a row, that you scroll down
   through, like Plex's library view.  The letters down the right side jump to the titles starting with one
   (▶ from the last column onto them, ▲ ▼ along them, OK or ◀ back to the posters); CH+ and CH− go a page at a
   time; Red sorts and filters (genre, decade, not watched yet, 4K); OK opens the title's page and Back comes
   back to the same place.  Collections open the same way: a grid of collections, then a collection's movies.
   Only the rows on screen are drawn, so 10,000 titles scroll as fast as 10. */
var MediaGrid = (function () {
  'use strict';
  var $ = U.$, RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var COLS = 9, ROW_H = 336, COL_W = 182, VISIBLE = 3, PAGE = 2;
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
  function sortList(list, by) {
    var k = {}; list.forEach(function (m, i) { k[i] = key(m); m._gi = i; });
    var t = function (a, b) { return k[a._gi] < k[b._gi] ? -1 : k[a._gi] > k[b._gi] ? 1 : 0; };
    return list.sort(by === 'added' ? function (a, b) { return (added(b) - added(a)) || t(a, b); }
      : by === 'release' ? function (a, b) { var x = released(a), y = released(b); return x < y ? 1 : x > y ? -1 : t(a, b); }
        : by === 'rating' ? function (a, b) { return (rating(b) - rating(a)) || t(a, b); } : t);
  }
  function apply() {
    var f = g.filter, list = g.all.filter(function (m) {
      if (!f) return true;
      if (f.type === 'unwatched') return !watched(m);
      if (f.type === '4k') return (m.info || []).some(function (x) { return /2160p|4K/i.test(x); });
      if (f.type === 'genre') return genres(m).indexOf(f.value) >= 0;
      if (f.type === 'decade') return decade(m) === f.value;
      return true;
    });
    g.list = g.custom ? list : sortList(list, g.sort);
    g.sel = Math.min(g.sel, Math.max(0, g.list.length - 1));
  }

  /* opts: { title, items, kind ('movie', 'show' or 'collection'), back, open(item, back), sort, custom (keep the
     order given: a collection in release order) } */
  function open(opts) {
    g = { title: opts.title, all: (opts.items || []).slice(), kind: opts.kind || 'movie', back: opts.back, open: opts.open, sel: 0, top: 0, zone: 'grid', letter: 0, sort: opts.sort || 'title', filter: null, custom: !!opts.custom };
    apply();
    $('viewMedia').classList.add('mgr-on');
    UI.setHandler(keys); draw();
  }
  function box() {
    var b = $('mediaGrid');
    if (!b) { b = U.el('div', 'mgr'); b.id = 'mediaGrid'; $('viewMedia').appendChild(b); }
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

  function img(src) { var i = U.el('img', 'mgr-pic'); i.decoding = 'async'; i.src = src; i.onerror = function () { if (!(typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this))) this.remove(); }; return i; }
  function hints() {
    if (g.zone === 'letters') return UI.hints([['', '▲ ▼  letters'], ['', 'OK  go there'], ['', 'Back  close', 'back']]);
    UI.hints([['', 'OK  open'], ['', 'CH+ CH−  page'], g.custom ? null : ['', '▶ at the end  letters'], ['', 'Hold OK  options', 'hold'], ['red', 'Sort and filter'], ['', 'Back  close', 'back']].filter(Boolean));
  }
  function present() { var have = {}; g.list.forEach(function (m) { have[letterOf(m)] = 1; }); return have; }
  function draw() {
    if (!g) return;
    var b = box(), n = g.list.length, row = Math.floor(g.sel / COLS);
    // The focused row stays in the middle once there is room above it.
    g.top = Math.max(0, Math.min(row - 1, Math.ceil(n / COLS) - 2));
    b.innerHTML = '';
    var head = U.el('div', 'mgr-head');
    head.appendChild(U.el('div', 'mgr-title', RAW(g.title)));
    var what = [n + (g.kind === 'collection' ? (n === 1 ? ' collection' : ' collections') : g.kind === 'show' ? (n === 1 ? ' show' : ' shows') : (n === 1 ? ' movie' : ' movies'))];
    if (!g.custom) what.push(SORTS.filter(function (s) { return s[0] === g.sort; })[0][1]);
    if (g.filter) what.push(g.filter.name);
    head.appendChild(U.el('div', 'mgr-sub', what.join('   ·   ')));
    b.appendChild(head);
    if (!n) { b.appendChild(U.el('div', 'shp-empty mgr-empty', g.filter ? 'Nothing here with that filter.  Red changes it.' : 'Nothing here yet.')); hints(); return; }
    var grid = U.el('div', 'mgr-grid');
    for (var r = g.top; r < g.top + VISIBLE + 1; r++) {
      for (var c = 0; c < COLS; c++) {
        var i = r * COLS + c; if (i >= n) break;
        (function (m, i) {
          var t = U.el('div', 'mgr-tile' + (g.zone === 'grid' && i === g.sel ? ' sel' : ''));
          t.style.top = ((r - g.top) * ROW_H + 12) + 'px';   // room for the focused one's grown border t.style.left = (c * COL_W) + 'px';
          var art = U.el('div', 'mgr-art'), pic = md(m).poster || m.poster;
          if (pic) art.appendChild(img(pic)); else art.appendChild(U.el('span', 'mshp-noart', RAW(nameOf(m))));
          if (watched(m)) art.appendChild(U.el('span', 'shp-done', '✓'));
          if (g.kind === 'collection') art.appendChild(U.el('span', 'mgr-count', String(m.count)));
          t.appendChild(art);
          t.appendChild(U.el('div', 'mgr-name', RAW(nameOf(m))));
          var sub = g.kind === 'collection' ? (m.count + (m.count === 1 ? ' movie' : ' movies')) : yearOf(m);
          if (sub) t.appendChild(U.el('div', 'mgr-year', sub));
          t.onclick = function () { g.zone = 'grid'; g.sel = i; choose(); };
          grid.appendChild(t);
        })(g.list[i], i);
      }
    }
    b.appendChild(grid);
    // The letters (sorted by title only: by date or rating they would jump nowhere useful).
    if (!g.custom && g.sort === 'title') {
      var have = present(), rail = U.el('div', 'mgr-letters'), cur = letterOf(g.list[g.sel]);
      LETTERS.forEach(function (L, i) {
        var e = U.el('div', 'mgr-letter' + (have[L] ? '' : ' none') + (L === cur ? ' cur' : '') + (g.zone === 'letters' && i === g.letter ? ' sel' : ''), L);
        if (have[L]) e.onclick = function () { jump(L); g.zone = 'grid'; draw(); };
        rail.appendChild(e);
      });
      b.appendChild(rail);
    }
    b.appendChild(U.el('div', 'mgr-pos', (g.sel + 1) + ' of ' + n));
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
    if (!g.custom) SORTS.forEach(function (s) { items.push({ label: (g.sort === s[0] ? '✓  ' : '') + 'Sort: ' + s[1], action: function () { state.sort = s[0]; state.sel = 0; apply(); again(); } }); });
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
    if (!items.length) return;
    UI.menu('Sort and filter', items, again);
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
      else if (a === 'right') {
        if (g.sel % COLS < COLS - 1 && g.sel < n - 1) g.sel++;
        else if (!g.custom && g.sort === 'title') { g.zone = 'letters'; g.letter = Math.max(0, LETTERS.indexOf(letterOf(g.list[g.sel]))); }
      }
      else if (a === 'up' && g.sel >= COLS) g.sel -= COLS;
      else if (a === 'down') { if (g.sel + COLS < n) g.sel += COLS; else if (Math.floor(g.sel / COLS) < Math.floor((n - 1) / COLS)) g.sel = n - 1; }
      else if (a === 'chup' || a === 'chdown') g.sel = Math.max(0, Math.min(n - 1, g.sel + (a === 'chup' ? -1 : 1) * COLS * PAGE));
      else if (a === 'ok') { choose(); return true; }
      else if (a === 'hold' || a === 'info') { var m = g.list[g.sel], state = g; if (m && g.kind !== 'collection' && Media.optionsFor) { Media.optionsFor(m, function () { if (g === state) { UI.setHandler(keys); draw(); } }); } return true; }
    }
    draw(); return true;
  }
  return { open: open, isOpen: function () { return !!g; } };
})();
