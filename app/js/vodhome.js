/* The Movies and Shows screens' home (the provider's titles, vod.js): like My media, the title you're on large
   over its backdrop at the top, and poster shelves under it: Continue watching, My list, Recently added,
   TMDB's lists and holiday lists (only the provider's titles that are on them, matched by name and year:
   providers give no TMDB IDs), then the categories you pin.  Red: sort, go to a shelf, arrange shelves,
   pin a category.  Green: All categories (vod.js's list, where Hold OK pins one too).  A shelf opens as a
   wall of posters (OK on its last tile, or Red > See all).  My media has its own lists (media.js): each
   screen only shows its own titles.
   Settings > Movies and shows > Movies and Shows open on: Home or Categories. */
var VodHome = (function () {
  'use strict';
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, open_ = false, kind = 'movie', A = null, shelves = [], at = 0, pos = {}, views = [], bdImg = null, mode = 'home', wall = null, wallAt = 0, imgs = [], imgBusy = 0;
  var TILE_STEP = 272, POOL = 7, ROW_H = 492, WALL_COLS = 6, WALL_ROW = 470;
  function S() { return Store.settings; }
  function save() { if (Store.saveSettings) Store.saveSettings(); }
  function count(n, one, many) { return n === 1 ? one : many.replace('{n}', n); }
  function wrap(u) { return typeof Net !== 'undefined' && Net.active && Net.wrap ? Net.wrap(u) : u; }
  function word() { return kind === 'series' ? 'show' : 'movie'; }

  /* ---------- sorting (Settings > Movies and shows > Order movies and shows, and Red here) ---------- */
  var SORT = { provider: 'The provider\'s order', added: 'Recently added first', name: 'Title, A to Z', year: 'Release year, newest first', rating: 'Rating, highest first' };
  var SORT_REV = { provider: 'The provider\'s order, turned round', added: 'Added longest ago first', name: 'Title, Z to A', year: 'Release year, oldest first', rating: 'Rating, lowest first' };
  function sortName() { return (S().vodSortReverse ? SORT_REV : SORT)[S().vodSort || 'provider'] || SORT.provider; }

  /* ---------- TMDB's lists, matched against the provider's titles ---------- */
  var LISTS = [
    { key: 'tmdb:trending', title: 'Trending this week', list: 'trending' },
    { key: 'tmdb:popular', title: 'Popular on TMDB', list: 'popular' },
    { key: 'tmdb:top', title: 'Top rated on TMDB', list: 'top_rated' },
    { key: 'tmdb:airing', title: 'Airing today', list: 'airing_today', only: 'series' },
    { key: 'tmdb:now', title: 'Now playing in theaters', list: 'now_playing', only: 'movie', off: true },
    { key: 'tmdb:upcoming', title: 'Upcoming movies', list: 'upcoming', only: 'movie', off: true }];
  function listsFor() { return LISTS.filter(function (l) { return !l.only || l.only === kind; }); }
  var CACHE = 'tivibro.vod.lists', AGE = 12 * 3600e3, tmdb = read(), busy = {};
  function read() { try { var o = JSON.parse(localStorage.getItem(CACHE) || 'null'); return o && o.lists ? o : { lists: {} }; } catch (e) { return { lists: {} }; } }
  function token() { return typeof MediaStore !== 'undefined' && MediaStore.tmdbToken ? MediaStore.tmdbToken() : ''; }
  function fetchLists() {
    var k = kind, tk = k === 'series' ? 'tv' : 'movie', stamp = tmdb['at:' + k] || 0;
    if (busy[k] || !token() || !Media.request || Date.now() - stamp < AGE) return;
    busy[k] = true;
    var jobs = [], got = {}, lang = MediaStore.preferences().language;
    function one(name, q) { q.credential = token(); q.language = lang; return Media.request('metadata', q, 45000).then(function (r) { if (r && r.items) got[name] = r.items.map(function (x) { return { t: x.t, o: x.o, y: x.y }; }); }, function () {}); }
    listsFor().forEach(function (l) { jobs.push(function () { return one(l.list + ':' + tk, { list: l.list, kind: tk }); }); });
    if (k === 'movie' && Media.holidaysNow) Media.holidaysNow().forEach(function (x) {
      jobs.push(function () {
        var i = 0;
        function next() { var w = x.h.words[i++]; return w ? one('holiday:' + x.h.key, { list: 'holiday', keyword: w }).then(function () { if (!(got['holiday:' + x.h.key] || []).length) return next(); }) : null; }
        return next();
      });
    });
    jobs.reduce(function (p, job) { return p.then(job); }, Promise.resolve()).then(function () {
      busy[k] = false;
      if (!Object.keys(got).length) return;
      Object.keys(got).forEach(function (n) { tmdb.lists[n] = got[n]; });
      tmdb['at:' + k] = Date.now();
      try { localStorage.setItem(CACHE, JSON.stringify(tmdb)); } catch (e) {}
      if (open_ && kind === k) refresh();
    });
  }
  // A title's name for matching: no year, no [tags], no quality words, letters and digits only.
  function norm(t) { return String(t || '').toLowerCase().replace(/\((?:19|20)\d\d\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\b(?:4k|uhd|fhd|hd|sd|hevc|multi|sub|dub)\b/g, ' ').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }
  function yearOf(it) { var m = /\((19|20)\d\d\)/.exec(it.name || ''); return String(it.year || (m ? m[0].slice(1, 5) : '')).slice(0, 4); }
  var index = null, indexFor = null;
  function byName() {
    var d = A.data();
    if (indexFor === d && index) return index;
    index = {}; indexFor = d;
    (d ? d.items : []).forEach(function (it) { if (it.adult) return; var n = norm(it.name); if (n) (index[n] = index[n] || []).push(it); });
    return index;
  }
  function matched(names) {
    var ix = byName(), seen = {}, out = [];
    names.forEach(function (n) {
      (tmdb.lists[n] || []).forEach(function (x) {
        var c = (ix[norm(x.t)] || []).concat(x.o && norm(x.o) !== norm(x.t) ? ix[norm(x.o)] || [] : []);
        var hit = c.filter(function (it) { var y = yearOf(it); return !y || !x.y || Math.abs(+y - +x.y) <= 1; })[0];
        if (hit && !seen[A.key(hit)]) { seen[A.key(hit)] = 1; out.push(hit); }
      });
    });
    return out;
  }

  /* ---------- the shelves and their order ---------- */
  function cfg() { var all = S().vodShelves || (S().vodShelves = {}); return all[kind] || (all[kind] = { order: [], off: {} }); }
  function baseOrder() {
    var o = ['continue', 'my', 'recent', 'holidays', 'tmdb:trending', 'tmdb:popular'];
    // The provider's first few categories, until you pin your own.
    A.cats().filter(function (c) { return !c.head && !c.adult && c.count > 0 && c.id.charAt(0) !== '_'; }).slice(0, 6).forEach(function (c) { o.push('cat:' + c.id); });
    return o.concat(listsFor().map(function (l) { return l.key; }).filter(function (k) { return o.indexOf(k) < 0; }));
  }
  function arrangement() {
    var c = cfg(), order = c.order && c.order.length ? c.order.slice() : baseOrder();
    ['continue', 'my', 'recent', 'holidays'].concat(listsFor().map(function (l) { return l.key; })).forEach(function (k, i) { if (order.indexOf(k) < 0) order.splice(Math.min(i, order.length), 0, k); });
    return { order: order, off: function (k) { return c.off && c.off[k] != null ? !!c.off[k] : listsFor().some(function (l) { return l.key === k && l.off; }); } };
  }
  function catById() { var m = {}; A.cats().forEach(function (c) { if (!c.head) m[c.id] = c; }); return m; }
  function build() {
    var d = A.data(); if (!d) return [];
    var ar = arrangement(), cats = catById(), out = [];
    ar.order.forEach(function (k) {
      if (ar.off(k)) return;
      if (k === 'continue') out.push({ id: k, title: 'Continue watching', items: A.items(A.CW) });
      else if (k === 'my') out.push({ id: k, title: 'My list', sub: sortName(), items: A.items(A.MY) });
      else if (k === 'recent') out.push({ id: k, title: 'Recently added', sub: 'Newest first', items: A.items(A.NEW) });
      else if (k === 'holidays') { if (kind === 'movie' && Media.holidaysNow) Media.holidaysNow().forEach(function (x) { var it = matched(['holiday:' + x.h.key]); out.push({ id: 'holiday:' + x.h.key, title: x.h.title, sub: 'Holiday  ·  ' + count(it.length, '1 in your provider\'s movies', '{n} in your provider\'s movies') + '  ·  most popular first', items: it }); }); }
      else if (k.indexOf('tmdb:') === 0) { var l = listsFor().filter(function (x) { return x.key === k; })[0]; if (l) { var it = matched([l.list + ':' + (kind === 'series' ? 'tv' : 'movie')]); out.push({ id: k, title: l.title, sub: count(it.length, '1 in your provider\'s ' + word() + 's', '{n} in your provider\'s ' + word() + 's'), items: it }); } }
      else if (k.indexOf('cat:') === 0) { var c = cats[k.slice(4)]; if (c && !(c.adult && !A.adultOpen())) out.push({ id: k, cat: c.id, title: c.name, sub: 'Category  ·  ' + count(c.count, '1 ' + word(), '{n} ' + word() + 's') + '  ·  ' + sortName(), items: A.items(c.id) }); }
    });
    out = out.filter(function (s) { return s.items.length; });
    /* Nothing on any shelf (issue #110: a provider that doesn't say when titles were added has no Recently
       added, and with no TMDB token, nothing watched and no pinned category, Home was empty): every title. */
    if (!out.length && A.ALL) { var all = A.items(A.ALL); if (all.length) out.push({ id: 'all', title: kind === 'series' ? 'All shows' : 'All movies', sub: count(all.length, '1 ' + word(), '{n} ' + word() + 's') + '  ·  Green: All categories', items: all }); }
    return out;
  }

  /* ---------- drawing ---------- */
  function pump() {
    imgs = imgs.filter(function (q) { return !!q.img.parentNode; });
    while (imgBusy < 3 && imgs.length) {
      var q = imgs.shift(); imgBusy++;
      (function (job) {
        var done = false;
        function fin(bad) { if (done) return; done = true; imgBusy--; job.img.onload = job.img.onerror = null; if (bad && job.img.parentNode) job.img.parentNode.removeChild(job.img); pump(); }
        job.img.onload = function () { fin(false); }; job.img.onerror = function () { var im = job.img; if (Net.retryImage(im, true)) { fin(false); im.onload = null; im.onerror = function () { if (!Net.retryImage(im, true) && im.parentNode) im.parentNode.removeChild(im); }; } else fin(true); };
        job.img.src = job.url;
      })(q);
    }
  }
  function tile() {
    var el = U.el('div', 'media-tile'), art = U.el('div', 'media-art'), name = U.el('div', 'media-tile-title'), sub = U.el('div', 'media-tile-year'), bar = U.el('div', 'media-progress'), fill = U.el('i'), tag = U.el('span', 'media-tag'), mark = U.el('span', 'media-favorite');
    bar.appendChild(fill); el.appendChild(mark); el.appendChild(art); el.appendChild(name); el.appendChild(sub);
    el.setAttribute('role', 'button');
    return { el: el, art: art, name: name, sub: sub, bar: bar, fill: fill, tag: tag, mark: mark, key: '' };
  }
  function fillTile(t, it) {
    var k = A.key(it) + '|' + (it.cover || '');
    if (t.key !== k) {
      t.key = k; t.art.innerHTML = ''; t.art.appendChild(t.bar); t.art.appendChild(t.tag);
      t.art.appendChild(U.el('span', 'media-monogram', String(it.name || '?').slice(0, 1).toUpperCase()));
      if (it.cover) { var img = U.el('img', 'media-cover'); img.alt = ''; img.decoding = 'async'; t.art.appendChild(img); imgs.push({ img: img, url: it.cover }); }
      t.name.textContent = it.name;
    }
    var p = A.progress(it);
    t.fill.style.width = p + '%'; t.bar.classList.toggle('hidden', !p);
    t.sub.textContent = [yearOf(it), A.stars(it), it.q].filter(Boolean).join('   ');
    t.tag.textContent = it.q === '4K' ? '4K' : '';
    t.mark.textContent = A.isMine(it) ? '★' : A.isWatched(it) ? '✓' : '';
    t.el.setAttribute('aria-label', it.name);
  }
  function makeShelf() {
    var el = U.el('section', 'media-shelf'), head = U.el('div', 'media-shelf-title'), h = U.el('h2'), sub = U.el('span', 'media-shelf-count'), track = U.el('div', 'media-track'), pool = [];
    head.appendChild(h); head.appendChild(sub); el.appendChild(head); el.appendChild(track);
    for (var i = 0; i < POOL; i++) {
      var t = tile(); track.appendChild(t.el); pool.push(t);
      (function (t) {
        t.el.addEventListener('click', function () { at = t._row; pos[shelves[at].id] = t._at; draw(); ok(); });
        t.el.addEventListener('mousemove', function () { if (UI.pointer && (at !== t._row || (pos[shelves[t._row].id] || 0) !== t._at)) { at = t._row; pos[shelves[at].id] = t._at; draw(); } });
      })(t);
    }
    $('vodHomeStage').appendChild(el);
    return { el: el, h: h, sub: sub, pool: pool };
  }
  function current() { if (mode === 'wall') return wall && wall.items[wallAt]; var s = shelves[at]; return s && s.items[pos[s.id] || 0]; }
  function draw() {
    var y = 0, focusY = 0;
    while (views.length < shelves.length) views.push(makeShelf());
    views.forEach(function (v, row) {
      var s = shelves[row];
      v.el.classList.toggle('hidden', !s);
      if (!s) return;
      var i0 = Math.max(0, Math.min(pos[s.id] || 0, s.items.length - 1)); pos[s.id] = i0;
      if (row === at) focusY = y;
      v.el.style.transform = 'translateY(' + y + 'px)'; v.el.classList.toggle('active', row === at);
      v.h.textContent = s.title; v.sub.textContent = s.sub || String(s.items.length);
      var near = Math.abs(row - at) <= 1, start = Math.max(0, Math.min(i0 - 1, s.items.length - (POOL - 1))), used = {};
      for (var i = start; near && i < Math.min(s.items.length, start + POOL); i++) {
        var t = v.pool[i % POOL]; used[i % POOL] = 1;
        t.el.style.display = ''; t.el.style.transform = 'translateX(' + (i - start) * TILE_STEP + 'px)'; t._row = row; t._at = i;
        fillTile(t, s.items[i]); t.el.classList.toggle('sel', row === at && i === i0);
      }
      v.pool.forEach(function (t, n) { if (!used[n]) { t.el.style.display = 'none'; t.art.innerHTML = ''; t.key = ''; } });
      y += ROW_H;
    });
    $('vodHomeStage').style.transform = 'translateY(-' + focusY + 'px)';
    heroSoon(); pump(); hints();
  }

  /* The hero: the provider's details (vod.js fetches a movie's on demand), TMDB's for a show (series.js). */
  var heroT = null, bdT = null;
  function heroSoon() { clearTimeout(heroT); heroT = setTimeout(hero, 120); hero(true); }
  function backdrop(u) {
    clearTimeout(bdT);
    bdT = setTimeout(function () {
      if (!bdImg || bdImg._src === u) return; bdImg._src = u; bdImg.classList.remove('on');
      if (!u) { bdImg.removeAttribute('src'); return; }
      bdImg.onload = function () { if (bdImg._src === u) bdImg.classList.add('on'); }; bdImg.onerror = function () { bdImg.classList.remove('on'); };
      bdImg.src = wrap(u);
    }, 160);
  }
  function hero(quick) {
    var it = current(), box = $('vodHomeInfo'), s = mode === 'wall' ? wall : shelves[at];
    if (mode === 'wall') return;
    box.innerHTML = '';
    if (!it) { backdrop(''); box.appendChild(U.el('h1', 'media-title', kind === 'series' ? 'Shows' : 'Movies')); box.appendChild(U.el('p', 'media-summary', A.data() ? 'Nothing to show yet.  Green opens All categories.' : (A.loading && A.loading()) || 'Loading…')); return; }
    var d = A.details(it, quick ? null : function (x) { if (current() === it) hero(true); }) || {};
    backdrop(d.backdrop || '');
    if (s) box.appendChild(U.el('div', 'media-kicker', s.title));
    if (d.logo) { var lg = U.el('img', 'media-logo'); lg.alt = it.name; lg.onerror = function () { if (lg.parentNode) { lg.parentNode.insertBefore(U.el('h1', 'media-title', it.name), lg); lg.parentNode.removeChild(lg); } }; lg.src = wrap(d.logo); box.appendChild(lg); }
    else box.appendChild(U.el('h1', 'media-title', it.name));
    box.appendChild(U.el('div', 'media-facts', [d.year || yearOf(it), d.dur, d.genre, A.stars(it) || (d.rating ? '★ ' + d.rating : ''), d.media, it.lang, A.catName(it)].filter(Boolean).join('   ·   ')));
    if (d.plot) box.appendChild(U.el('p', 'media-summary', d.plot));
    var line = A.where(it) || [d.cast ? 'Cast: ' + d.cast : '', d.director ? 'Director: ' + d.director : ''].filter(Boolean).join('   ·   ');
    if (line) box.appendChild(U.el('div', 'media-caption', line));
  }

  /* ---------- the wall: one shelf's every title as posters ---------- */
  var wallViews = [];
  function openWall(s) {
    wall = { id: s.id, cat: s.cat, title: s.title, items: s.items.slice(), back: s.back || null }; wallAt = Math.max(0, pos[s.id] || 0); mode = 'wall';
    $('vodHome').classList.add('wall'); drawWall();
  }
  function closeWall() {
    var back = wall && wall.back;
    mode = 'home'; wall = null; $('vodHome').classList.remove('wall');
    if (back) return back();                                  // a category opened as posters: back to the categories
    draw();
  }
  // A category from the categories list as a full-screen wall of posters (Settings > Movies and shows > Open a category as).
  function wallOf(k, api, c, items, back) {
    show(k, api, false);
    openWall({ id: 'catwall:' + c.id, cat: c.id, title: c.name, items: items, back: back });
  }
  function drawWall() {
    var box = $('vodWall'), rows = Math.ceil(wall.items.length / WALL_COLS), r = Math.floor(wallAt / WALL_COLS);
    $('vodWallHead').innerHTML = '';
    $('vodWallHead').appendChild(U.el('div', 'media-kicker', (kind === 'series' ? 'Shows' : 'Movies') + '  ›  ' + wall.title));
    $('vodWallHead').appendChild(U.el('h1', 'media-title', wall.title));
    $('vodWallHead').appendChild(U.el('div', 'media-facts', count(wall.items.length, '1 ' + word(), '{n} ' + word() + 's') + (wall.id.indexOf('tmdb:') && wall.id.indexOf('holiday:') && wall.id !== 'recent' && wall.id !== 'continue' ? '   ·   ' + sortName() : '')));
    var first = Math.max(0, Math.min(r - 1, rows - 2)), need = Math.min(rows, first + 3) - first, n = need * WALL_COLS;
    while (wallViews.length < n) { var t = tile(); box.appendChild(t.el); wallViews.push(t); (function (t) { t.el.addEventListener('click', function () { wallAt = t._at; drawWall(); ok(); }); })(t); }
    wallViews.forEach(function (t, i) {
      var idx = first * WALL_COLS + i, it = i < n && wall.items[idx];
      if (!it) { t.el.style.display = 'none'; t.art.innerHTML = ''; t.key = ''; return; }
      t.el.style.display = ''; t._at = idx;
      t.el.style.transform = 'translate(' + (i % WALL_COLS) * TILE_STEP + 'px,' + Math.floor(i / WALL_COLS) * WALL_ROW + 'px)';
      fillTile(t, it); t.el.classList.toggle('sel', idx === wallAt);
    });
    box.style.transform = 'translateY(' + -(r - first) * WALL_ROW + 'px)';
    pump(); hints();
  }

  /* ---------- Red ---------- */
  function sortMenu() {
    var how = S().vodSort || 'provider';
    UI.menu('Order ' + word() + 's', Object.keys(SORT).map(function (k) { return { label: (k === how ? '●  ' : '○  ') + SORT[k], current: k === how, action: function () { S().vodSort = k; save(); changed(); } }; })
      .concat([{ label: 'Reverse the order: ' + (S().vodSortReverse ? 'On' : 'Off'), action: function () { S().vodSortReverse = !S().vodSortReverse; save(); changed(); } }]));
  }
  function names(k) {
    if (k === 'continue') return 'Continue watching'; if (k === 'my') return 'My list'; if (k === 'recent') return 'Recently added';
    if (k === 'holidays') return 'Holiday lists';
    var l = LISTS.filter(function (x) { return x.key === k; })[0]; if (l) return l.title;
    var c = catById()[k.slice(4)]; return c ? 'Category: ' + c.name : 'A category no longer there';
  }
  function setOrder(order, off) { var c = cfg(); c.order = order; c.off = off; save(); changed(); }
  function arrangeMenu(focus) {
    var ar = arrangement(), c = cfg();
    var phone = typeof Settings !== 'undefined' && Settings.capturing && Settings.capturing();
    if (!phone && typeof Arrange !== 'undefined') {
      return Arrange.open({ title: 'Arrange the ' + (kind === 'series' ? 'Shows' : 'Movies') + ' home', focus: focus,
        rows: ar.order.map(function (k) { return { key: k, name: RAW(names(k)), off: ar.off(k) }; }).concat([{ name: 'Pin a category…', action: pinMenu }]),
        save: function (order, off) { setOrder(order, off); }, reset: function () { setOrder([], {}); },
        done: function () { if (open_) restore(); else if (typeof Settings !== 'undefined' && Settings.redraw) Settings.redraw(); } });
    }
    UI.menu('Arrange ' + (kind === 'series' ? 'Shows' : 'Movies') + ' shelves', ar.order.map(function (k, i) {
      var cat = k.indexOf('cat:') === 0;
      return { label: (ar.off(k) ? '○  ' : '●  ') + RAW(names(k)), sub: ar.off(k) ? 'Off' : 'Shelf ' + (i + 1), current: k === focus, action: function () {
        function moved(j) { var o = ar.order.slice(); o.splice(i, 1); o.splice(j, 0, k); setOrder(o, c.off || {}); arrangeMenu(k); }
        UI.menu(RAW(names(k)), [
          i > 0 && { label: 'Move up', action: function () { moved(i - 1); } },
          i < ar.order.length - 1 && { label: 'Move down', action: function () { moved(i + 1); } },
          i > 0 && { label: 'Move to the top', action: function () { moved(0); } },
          cat ? { label: 'Unpin this category', action: function () { setOrder(ar.order.filter(function (x) { return x !== k; }), c.off || {}); arrangeMenu(); } }
            : { label: ar.off(k) ? 'Switch on' : 'Switch off', action: function () { var off = {}; Object.keys(c.off || {}).forEach(function (x) { off[x] = c.off[x]; }); off[k] = !ar.off(k); setOrder(ar.order, off); arrangeMenu(k); } },
          { label: 'Back', action: function () { arrangeMenu(k); } }
        ].filter(Boolean));
      } };
    }).concat([{ label: 'Pin a category…', action: pinMenu }, { label: 'Back to the way it was', action: function () { setOrder([], {}); arrangeMenu(); } }]));
  }
  function pin(id) { var ar = arrangement(), k = 'cat:' + id; if (ar.order.indexOf(k) >= 0) return false; ar.order.push(k); setOrder(ar.order, cfg().off || {}); return true; }
  function pinMenu() {
    var ar = arrangement();
    UI.menu('Pin a category', A.cats().filter(function (c) { return !c.head && c.id.charAt(0) !== '_' && c.count > 0; }).map(function (c) {
      var on = ar.order.indexOf('cat:' + c.id) >= 0;
      return { label: (on ? '★  ' : '    ') + RAW(c.name), sub: String(c.count), action: function () { if (on) setOrder(ar.order.filter(function (x) { return x !== 'cat:' + c.id; }), cfg().off || {}); else { pin(c.id); U.toast(c.name + ' is a shelf now'); } } };
    }));
  }
  function options() {
    var s = mode === 'wall' ? wall : shelves[at], it = current();
    UI.menu(kind === 'series' ? 'Shows' : 'Movies', [
      { label: typeof I18n === 'undefined' ? 'Order: ' + sortName() : I18n.t('Order: {x}', { x: I18n.t(sortName()) }), action: sortMenu },
      mode === 'home' && s && { label: typeof I18n === 'undefined' ? 'See all of ' + RAW(s.title) : I18n.t('See all of {x}', { x: String(s.title) }), sub: count(s.items.length, '1 title', '{n} titles') + ' as posters', action: function () { openWall(s); } },
      mode === 'home' && { label: 'Go to a shelf', action: function () { UI.menu('Go to a shelf', shelves.map(function (x, i) { return { label: RAW(x.title), sub: String(x.items.length), current: i === at, action: function () { at = i; draw(); } }; })); } },
      mode === 'home' && { label: 'Arrange shelves', sub: 'Move, switch off, pin categories', action: function () { arrangeMenu(s && (s.id.indexOf('holiday:') === 0 ? 'holidays' : s.id)); } },
      { label: 'All categories', sub: 'Green', action: function () { A.list(s && s.cat, it); } },
      it && { label: (kind === 'series' ? 'Show' : 'Movie') + ' options', action: function () { A.menu(it); } }
    ].filter(Boolean));
  }

  /* ---------- keys ---------- */
  function ok() { var it = current(); if (it) A.open(it); }
  function hints() {
    if (!open_ || UI.modalOpen) return;
    UI.hints([['', kind === 'series' ? 'OK  open' : 'OK  play'], ['', 'Hold OK  options', 'hold'], ['', mode === 'wall' ? (wall && wall.back ? 'Back  categories' : 'Back  shelves') : 'Back  menu', 'back'], ['red', 'Order and shelves'], ['green', 'All categories'], ['yellow', 'Search'], ['blue', 'Settings']]);
  }
  function keys(a) {
    if (a === 'red') { options(); return true; }
    if (a === 'green') { var s0 = mode === 'wall' ? wall : shelves[at]; A.list(s0 && s0.cat, current()); return true; }
    if (a === 'yellow') { Views.switchTab('search'); return true; }
    if (a === 'blue') { Views.switchTab('settings'); if (Settings.section) Settings.section('vod'); return true; }
    if (a === 'hold' || a === 'info') { if (current()) A.menu(current()); return true; }
    if (a === 'ok') { ok(); return true; }
    if (mode === 'wall') {
      var n = wall.items.length, c = wallAt % WALL_COLS;
      if (a === 'back') closeWall();
      else if (a === 'left') { if (c === 0) closeWall(); else { wallAt--; drawWall(); } }
      else if (a === 'right') { if (wallAt < n - 1) { wallAt++; drawWall(); } }
      else if (a === 'up') { if (wallAt >= WALL_COLS) { wallAt -= WALL_COLS; drawWall(); } }
      else if (a === 'down') { if (wallAt + WALL_COLS < n) wallAt += WALL_COLS; else if (Math.floor(wallAt / WALL_COLS) < Math.floor((n - 1) / WALL_COLS)) wallAt = n - 1; drawWall(); }
      else if (a === 'chup' || a === 'chdown') { wallAt = Math.max(0, Math.min(n - 1, wallAt + (a === 'chup' ? -3 : 3) * WALL_COLS)); drawWall(); }
      return true;
    }
    var s = shelves[at], i = s ? pos[s.id] || 0 : 0;
    if (a === 'back' || (a === 'left' && i === 0)) Views.tabBar(restore);
    else if (a === 'up') { if (at > 0) { at--; draw(); } else if (!UI.repeating && shelves.length > 2) { at = shelves.length - 1; draw(); } }
    else if (a === 'down') { if (at < shelves.length - 1) { at++; draw(); } else if (!UI.repeating && shelves.length > 2) { at = 0; draw(); } }
    else if (s && (a === 'left' || a === 'right' || a === 'chup' || a === 'chdown')) {
      var j = i + (a === 'left' ? -1 : a === 'right' ? 1 : a === 'chup' ? -6 : 6);
      if (a === 'right' && i === s.items.length - 1 && s.items.length > POOL) { openWall(s); return true; }   // past the end: the whole shelf
      pos[s.id] = Math.max(0, Math.min(s.items.length - 1, j)); draw();
    }
    return true;
  }
  function restore() { UI.setHandler(keys); if (mode === 'wall') drawWall(); else draw(); }

  /* ---------- open, leave ---------- */
  function setup() {
    if (built) return;
    built = true;
    var v = $('viewVod'), home = U.el('div', 'vod-home'), bd = U.el('div', 'media-bd'), fade = U.el('div', 'media-fade'), info = U.el('div', 'media-hero'), sh = U.el('div', 'media-shelves'), stage = U.el('div', 'media-shelf-stage');
    home.id = 'vodHome'; info.id = 'vodHomeInfo'; stage.id = 'vodHomeStage';
    bdImg = U.el('img', 'media-hero-art'); bdImg.alt = ''; bd.appendChild(bdImg); bd.appendChild(fade);
    sh.appendChild(stage); home.appendChild(bd); home.appendChild(info); home.appendChild(sh);
    var wh = U.el('div', 'vod-wall-head'), wb = U.el('div', 'vod-wall-box'), w = U.el('div', 'vod-wall'); wh.id = 'vodWallHead'; w.id = 'vodWall'; wb.appendChild(w);
    home.appendChild(wh); home.appendChild(wb);
    v.appendChild(home);
  }
  function refresh() {
    if (!open_) return;
    var was = shelves[at] && shelves[at].id, cur = current();
    shelves = build();
    var i = shelves.map(function (s) { return s.id; }).indexOf(was);
    at = i >= 0 ? i : Math.min(at, Math.max(0, shelves.length - 1));
    var s = shelves[at];
    if (s && cur) { var j = s.items.indexOf(cur); if (j >= 0) pos[s.id] = j; }
    if (mode === 'wall' && wall) { var ws = shelves.filter(function (x) { return x.id === wall.id; })[0]; if (ws) { wall.items = ws.items.slice(); wall.title = ws.title; } drawWall(); } else draw();
  }
  function changed() { if (open_) refresh(); }
  // vod.js calls this once its list is loaded (fresh says it's a new visit: back to the top).
  function show(k, api, fresh) {
    setup(); A = api;
    if (k !== kind || fresh) { at = 0; pos = {}; mode = 'home'; wall = null; $('vodHome').classList.remove('wall'); }
    kind = k; open_ = true;
    $('viewVod').classList.add('home-on'); document.body.classList.add('vod-home-open');
    UI.setHandler(keys);
    refresh(); fetchLists();
  }
  function hide() { open_ = false; if ($('viewVod')) $('viewVod').classList.remove('home-on'); document.body.classList.remove('vod-home-open'); }
  function on() { return S().vodHome !== false; }

  // Settings > Movies and shows > Arrange the Movies (Shows) home.
  function arrange(k, api) { A = api; if (kind !== k) { kind = k; at = 0; pos = {}; } arrangeMenu(); }

  return { show: show, wallOf: wallOf, hide: hide, arrange: arrange, on: on, changed: changed, restore: restore, pin: pin, get open() { return open_; }, _test: { norm: norm, matched: matched, build: build, set lists(v) { tmdb.lists = v; } } };
})();
