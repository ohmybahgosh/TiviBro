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
  // Translated text with values ({x}), for text built here rather than shown as it is.
  function T(x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : x; }
  var $ = function (id) { return document.getElementById(id); };
  var built = false, open_ = false, kind = 'movie', A = null, shelves = [], at = 0, pos = {}, views = [], bdImg = null, mode = 'home', wall = null, wallAt = 0, imgs = [], imgBusy = 0;
  var TILE_STEP = 272, VIS = 7, POOL = VIS + 2, ROW_H = 492, WALL_COLS = 6, WALL_ROW = 470;
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
  /* TMDB's lists for this screen, in the background (with a TMDB token): every 12 hours the lists and holiday lists,
     and at once any service or genre shelf added since, then the home is drawn again. */
  function fetchLists() {
    var k = kind, tk = k === 'series' ? 'tv' : 'movie', stamp = tmdb['at:' + k] || 0, stale = Date.now() - stamp >= AGE;
    // A service or genre shelf added since the lists were last fetched is fetched now, without waiting for the rest.
    var extra = added().filter(function (key) { return stale || !tmdb.lists[key + ':' + tk]; });
    if (busy[k] || !token() || !Media.request || (!stale && !extra.length)) return;
    busy[k] = true;
    var jobs = [], got = {}, lang = MediaStore.preferences().language;
    function one(name, q) { q.credential = token(); q.language = lang; return Media.request('metadata', q, 45000).then(function (r) { if (r && r.items) got[name] = r.items.map(function (x) { return { t: x.t, o: x.o, y: x.y }; }); }, function () {}); }
    if (stale) listsFor().forEach(function (l) { jobs.push(function () { return one(l.list + ':' + tk, { list: l.list, kind: tk }); }); });
    extra.forEach(function (key) {
      var svc = key.indexOf('svc:') === 0, id = key.slice(key.indexOf(':') + 1);
      jobs.push(function () { return one(key + ':' + tk, svc ? { list: 'service', provider: id, region: region(), kind: tk } : { list: 'genre', genre: id, kind: tk }); });
    });
    if (stale && k === 'movie' && Media.holidaysNow) Media.holidaysNow().forEach(function (x) {
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
      if (stale) tmdb['at:' + k] = Date.now();
      try { localStorage.setItem(CACHE, JSON.stringify(tmdb)); } catch (e) {}
      if (open_ && kind === k) refresh();
    });
  }
  /* ---------- streaming Top 10s (discussion #184) ---------- */
  /* Yesterday's Top 10s of the streaming services in the TV's region, from FlixPatrol through TiviBro's metadata
     relay (meta/top10.js, which keeps them for every TiviBro and asks FlixPatrol at most once a day).  A shelf
     "Top 10 on Netflix" ("top:Netflix") shows your provider's titles that are on it, in its order, with their
     place on the poster.  Kept here 6 hours; no token needed. */
  var META = 'https://tivibro-meta.theboxmod.workers.dev', TOP_AGE = 6 * 3600e3, topBusy = false, topWaiting = [];
  function topCharts() { var t = tmdb.lists['top10:' + region()]; return t && t.charts || []; }
  function fetchTop() {
    var rg = region(), have = tmdb.lists['top10:' + rg];
    if (topBusy || (have && Date.now() - (have.got || 0) < TOP_AGE) || typeof fetch === 'undefined') return;
    topBusy = true;
    var u = META + '/v1/top10?country=' + rg, url = typeof Net !== 'undefined' && Net.wrap ? Net.wrap(u, { always: true }) : u;
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      topBusy = false;
      if (!j || !Array.isArray(j.charts)) return;
      tmdb.lists['top10:' + rg] = { got: Date.now(), date: String(j.date || ''), charts: j.charts };
      try { localStorage.setItem(CACHE, JSON.stringify(tmdb)); } catch (e) {}
      if (open_) refresh();
      topWaiting.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
    }, function () { topBusy = false; });
  }
  /* One service's chart for this screen: its own movies or shows chart, else its one chart's titles of this
     kind (or not known).  [{ t, r }], best first. */
  function topList(svc) {
    var c = topCharts().filter(function (x) { return x.service === svc; })[0];
    if (!c) return [];
    var own = kind === 'series' ? c.shows : c.movies, want = kind === 'series' ? 'tv' : 'movie';
    return (own && own.length ? own : (c.all || []).filter(function (x) { return !x.k || x.k === want; })).slice(0, 10);
  }
  /* The shelf: the provider's titles on the chart, in its order, each with its place (shown on its poster). */
  function topShelf(k) {
    var svc = k.slice(4), list = topList(svc), ranks = {}, ix = byName(), items = [];
    list.forEach(function (x) {
      var hit = (ix[norm(x.t)] || [])[0];
      if (hit && !ranks[A.key(hit)]) { ranks[A.key(hit)] = x.r; items.push(hit); }
    });
    var have = tmdb.lists['top10:' + region()] || {};
    return { id: k, title: RAW(T('Top 10 on {x}', { x: svc })), sub: RAW(T('{n} of the 10 in your provider\'s list', { n: items.length }) + '  ·  FlixPatrol' + (have.date ? '  ·  ' + U.dateShort(Date.parse(have.date + 'T12:00:00'), false) : '')), items: items, ranks: ranks };
  }
  /* Red > Add a Top 10…: the services with a chart in your region (★ on the ones already shelves). */
  function topMenu() {
    var cs = topCharts().filter(function (c) { return topList(c.service).length; });
    if (!cs.length) { fetchTop(); return U.toast('No Top 10s for your region yet.  Try again in a moment.'); }
    UI.menu('Add a Top 10', cs.map(function (c) {
      var key = 'top:' + c.service, on = arrangement().order.indexOf(key) >= 0 && !arrangement().off(key);
      return { label: (on ? '★  ' : '    ') + RAW(c.service), sub: on ? T('A shelf now: OK takes it off') : '', action: function () {
        var ar = arrangement(), cfgx = cfg(), off = {}; Object.keys(cfgx.off || {}).forEach(function (x) { off[x] = cfgx.off[x]; });
        if (on) { if (key === 'top:Netflix') off[key] = true; setOrder(key === 'top:Netflix' ? ar.order : ar.order.filter(function (x) { return x !== key; }), off); return topMenu(); }
        off[key] = false; if (ar.order.indexOf(key) < 0) ar.order.push(key); setOrder(ar.order, off);
        U.toast(RAW(T('Top 10 on {x}', { x: c.service }) + '  ·  ' + T('a shelf now')));
      } };
    }));
  }

  /* ---------- streaming services and genres as shelves (discussion #184) ---------- */
  /* Shelves you add from TMDB: a streaming service ("svc:8", what it has in the TV's region) or a genre
     ("genre:27"), each showing your provider's titles that are on it, matched by name like the lists above. */
  function added() { return arrangement().order.filter(function (key) { return /^(svc|genre):\d+$/.test(key); }); }
  // The TV's region for the services ("IN" from en-IN), the US when it can't tell.
  function region() {
    var l = ''; try { l = String((typeof I18n !== 'undefined' && I18n.detected && I18n.detected().locale) || navigator.language || ''); } catch (e) {}
    var m = /[-_]([A-Za-z]{2})(?:$|[-_.@])/.exec(l); return m ? m[1].toUpperCase() : 'US';
  }
  /* What can be added: the region's services, biggest first, or the genres in your language, from TMDB (kept a
     day).  then(list of { id, name }), or an empty list without a token or an answer. */
  function catalog(type, then) {
    var tk = kind === 'series' ? 'tv' : 'movie', lang = MediaStore.preferences().language, name = type + ':' + tk + ':' + (type === 'services' ? region() : lang), have = tmdb.lists[name];
    if (have && Date.now() - (tmdb['at:' + name] || 0) < 24 * 3600e3) return then(have);
    if (!token() || !Media.request) return then([]);
    Media.request('metadata', { list: type, kind: tk, region: region(), credential: token(), language: lang }, 30000).then(function (r) {
      var list = r && r.items || [];
      if (list.length) { tmdb.lists[name] = list; tmdb['at:' + name] = Date.now(); try { localStorage.setItem(CACHE, JSON.stringify(tmdb)); } catch (e) {} }
      then(list);
    }, function () { then(have || []); });
  }
  // A shelf's name, kept when it's added (the catalog may not be loaded later): "On Netflix", "Horror".
  function addedName(key) { var n = (cfg().names || {})[key] || ''; return key.indexOf('svc:') === 0 ? T('On {x}', { x: n }) : n; }
  /* Red > Add a streaming service… / Add a genre…: the list from TMDB, ★ on the ones already shelves.  OK adds one
     (at the end; Arrange moves it) or takes it off. */
  function addMenu(type) {
    if (!token()) return U.toast('Rows from TMDB need a TMDB token (Settings > API keys)');
    U.toast('Loading the list from TMDB…');
    catalog(type, function (list) {
      if (!list.length) return U.toast('TMDB didn\'t answer.  Try again in a moment.');
      var pre = type === 'services' ? 'svc:' : 'genre:';
      UI.menu(type === 'services' ? 'Add a streaming service' : 'Add a genre', list.map(function (x) {
        var key = pre + x.id, on = arrangement().order.indexOf(key) >= 0;
        return { label: (on ? '★  ' : '    ') + RAW(x.name), sub: on ? T('A shelf now: OK takes it off') : '', action: function () {
          var ar = arrangement(), c = cfg();
          if (on) { setOrder(ar.order.filter(function (k) { return k !== key; }), c.off || {}); return addMenu(type); }
          c.names = c.names || {}; c.names[key] = x.name; ar.order.push(key); setOrder(ar.order, c.off || {});
          U.toast(RAW(addedName(key) + '  ·  ' + T('a shelf now'))); fetchLists();
        } };
      }));
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
    var o = ['continue', 'my', 'recent', 'top:Netflix', 'holidays', 'tmdb:trending', 'tmdb:popular'];
    // The provider's first few categories, until you pin your own.
    A.cats().filter(function (c) { return !c.head && !c.adult && c.count > 0 && c.id.charAt(0) !== '_'; }).slice(0, 6).forEach(function (c) { o.push('cat:' + c.id); });
    return o.concat(listsFor().map(function (l) { return l.key; }).filter(function (k) { return o.indexOf(k) < 0; }));
  }
  function arrangement() {
    var c = cfg(), order = c.order && c.order.length ? c.order.slice() : baseOrder();
    ['continue', 'my', 'recent', 'top:Netflix', 'holidays'].concat(listsFor().map(function (l) { return l.key; })).forEach(function (k, i) { if (order.indexOf(k) < 0) order.splice(Math.min(i, order.length), 0, k); });
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
      else if (k.indexOf('top:') === 0) out.push(topShelf(k));
      else if (/^(svc|genre):\d+$/.test(k)) { var ai = matched([k + ':' + (kind === 'series' ? 'tv' : 'movie')]); out.push({ id: k, title: RAW(addedName(k)), sub: count(ai.length, '1 in your provider\'s ' + word() + 's', '{n} in your provider\'s ' + word() + 's') + '  ·  TMDB', items: ai }); }
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
  /* One poster.  mixed: the shelf mixes categories, so with Category under each poster on (discussion #144) the
     title's category joins its year and rating. */
  function fillTile(t, it, mixed, rank) {
    var k = A.key(it) + '|' + (it.cover || '');
    if (t.key !== k) {
      t.key = k; t.art.innerHTML = ''; t.art.appendChild(t.bar); t.art.appendChild(t.tag);
      t.art.appendChild(U.el('span', 'media-monogram', String(it.name || '?').slice(0, 1).toUpperCase()));
      if (it.cover) { var img = U.el('img', 'media-cover wait'); img.alt = ''; img.decoding = 'async'; img.addEventListener('load', function () { this.classList.remove('wait'); }); t.art.appendChild(img); imgs.push({ img: img, url: it.cover }); }
      t.name.textContent = it.name;
    }
    var p = A.progress(it);
    t.fill.style.width = p + '%'; t.bar.classList.toggle('hidden', !p);
    var facts = [yearOf(it), A.stars(it), it.q].filter(Boolean).join('   '), cn = mixed && S().vodPosterCat ? A.catName(it) : '';
    t.sub.textContent = facts + (facts && cn ? '  ·  ' : '') + cn;
    // A Top 10 shelf: the title's place on the chart, where 4K would go.
    t.tag.textContent = rank ? '#' + rank : it.q === '4K' ? '4K' : '';
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
      // The 7 on screen and one more off each side, so the next poster slides in from the edge, loaded (media.js).
      var near = Math.abs(row - at) <= 1, start = Math.max(0, Math.min(i0 - 1, s.items.length - (VIS - 1))), used = {};
      for (var i = Math.max(0, start - 1); near && i < Math.min(s.items.length, start + VIS + 1); i++) {
        var t = v.pool[i % POOL]; used[i % POOL] = 1;
        // A tile reused for another title jumps there; only one keeping its title slides.
        var jump = t._at !== i || t._row !== row || t.el.style.display === 'none';
        if (jump) t.el.style.transition = 'none';
        t.el.style.display = ''; t.el.style.transform = 'translateX(' + (i - start) * TILE_STEP + 'px)'; t._row = row; t._at = i;
        if (jump) { void t.el.offsetWidth; t.el.style.transition = ''; }
        fillTile(t, s.items[i], !s.cat, s.ranks && s.ranks[A.key(s.items[i])]); t.el.classList.toggle('sel', row === at && i === i0);
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
    // A shelf of several categories (Recently added, Continue watching, My list, TMDB's lists): the title's own
    // category up top beside the shelf's name, where it's seen (discussion #60: "on Home the category is not shown").
    var cn = A.catName(it);
    if (s) box.appendChild(U.el('div', 'media-kicker', s.title + (cn && !s.cat ? '  ·  ' + cn : '')));
    if (d.logo) { var lg = U.el('img', 'media-logo'); lg.alt = it.name; lg.onerror = function () { if (lg.parentNode) { lg.parentNode.insertBefore(U.el('h1', 'media-title', it.name), lg); lg.parentNode.removeChild(lg); } }; lg.src = wrap(d.logo); box.appendChild(lg); }
    else box.appendChild(U.el('h1', 'media-title', it.name));
    box.appendChild(U.el('div', 'media-facts', [d.year || yearOf(it), d.dur, d.genre, A.stars(it) || (d.rating ? '★ ' + d.rating : ''), d.media, it.lang, s && !s.cat ? '' : cn].filter(Boolean).join('   ·   ')));
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
  /* The wall's top: the shelf, then the title you're on with its details and summary, as the home's top shows
     (discussion #36: no way to see a movie's details with posters full screen). */
  var wallT = null;
  function wallHeadSoon() { clearTimeout(wallT); wallT = setTimeout(wallHead, 150); wallHead(true); }
  function wallHead(quick) {
    var head = $('vodWallHead'); if (mode !== 'wall' || !wall || !head) return;
    var it = wall.items[wallAt];
    head.innerHTML = '';
    var wcn = !wall.cat && it ? A.catName(it) : '';   // a mixed wall: the focused title's category
    head.appendChild(U.el('div', 'media-kicker', (kind === 'series' ? 'Shows' : 'Movies') + '  ›  ' + wall.title + '  ·  ' + count(wall.items.length, '1 ' + word(), '{n} ' + word() + 's') + (wall.id.indexOf('tmdb:') && wall.id.indexOf('holiday:') && wall.id !== 'recent' && wall.id !== 'continue' ? '  ·  ' + sortName() : '') + (wcn ? '  ·  ' + wcn : '')));
    if (!it) { head.appendChild(U.el('h1', 'media-title', wall.title)); return; }
    var d = A.details(it, quick ? null : function () { if (mode === 'wall' && wall && wall.items[wallAt] === it) wallHead(true); }) || {};
    head.appendChild(U.el('h1', 'media-title', it.name));
    var facts = [d.year || yearOf(it), d.dur, d.genre, A.stars(it) || (d.rating ? '★ ' + d.rating : ''), d.media].filter(Boolean).join('   ·   ');
    if (facts) head.appendChild(U.el('div', 'media-facts', facts));
    if (d.plot) head.appendChild(U.el('p', 'media-summary vod-wall-plot', d.plot));
  }
  function drawWall() {
    var box = $('vodWall'), rows = Math.ceil(wall.items.length / WALL_COLS), r = Math.floor(wallAt / WALL_COLS);
    wallHeadSoon();
    var first = Math.max(0, Math.min(r - 1, rows - 2)), need = Math.min(rows, first + 3) - first, n = need * WALL_COLS;
    while (wallViews.length < n) { var t = tile(); box.appendChild(t.el); wallViews.push(t); (function (t) { t.el.addEventListener('click', function () { wallAt = t._at; drawWall(); ok(); }); })(t); }
    wallViews.forEach(function (t, i) {
      var idx = first * WALL_COLS + i, it = i < n && wall.items[idx];
      if (!it) { t.el.style.display = 'none'; t.art.innerHTML = ''; t.key = ''; return; }
      t.el.style.display = ''; t._at = idx;
      t.el.style.transform = 'translate(' + (i % WALL_COLS) * TILE_STEP + 'px,' + Math.floor(i / WALL_COLS) * WALL_ROW + 'px)';
      fillTile(t, it, !wall.cat); t.el.classList.toggle('sel', idx === wallAt);
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
    if (k.indexOf('top:') === 0) return T('Top 10 on {x}', { x: k.slice(4) });
    if (/^(svc|genre):\d+$/.test(k)) return (k.indexOf('svc:') === 0 ? '' : T('Genre') + ': ') + addedName(k);
    var c = catById()[k.slice(4)]; return c ? 'Category: ' + c.name : 'A category no longer there';
  }
  function setOrder(order, off) { var c = cfg(); c.order = order; c.off = off; save(); changed(); }
  function arrangeMenu(focus) {
    var ar = arrangement(), c = cfg();
    var phone = typeof Settings !== 'undefined' && Settings.capturing && Settings.capturing();
    if (!phone && typeof Arrange !== 'undefined') {
      return Arrange.open({ title: 'Arrange the ' + (kind === 'series' ? 'Shows' : 'Movies') + ' home', focus: focus,
        rows: ar.order.map(function (k) { return { key: k, name: RAW(names(k)), off: ar.off(k) }; }).concat([{ name: 'Pin a category…', action: pinMenu }, { name: 'Add a Top 10…', action: topMenu }, { name: 'Add a streaming service…', action: function () { addMenu('services'); } }, { name: 'Add a genre…', action: function () { addMenu('genres'); } }]),
        save: function (order, off) { setOrder(order, off); }, reset: function () { setOrder([], {}); },
        done: function () { if (open_) restore(); else if (typeof Settings !== 'undefined' && Settings.redraw) Settings.redraw(); } });
    }
    UI.menu('Arrange ' + (kind === 'series' ? 'Shows' : 'Movies') + ' shelves', ar.order.map(function (k, i) {
      var cat = k.indexOf('cat:') === 0 || /^(svc|genre):\d+$/.test(k) || (k.indexOf('top:') === 0 && k !== 'top:Netflix');
      return { label: (ar.off(k) ? '○  ' : '●  ') + RAW(names(k)), sub: ar.off(k) ? 'Off' : 'Shelf ' + (i + 1), current: k === focus, action: function () {
        function moved(j) { var o = ar.order.slice(); o.splice(i, 1); o.splice(j, 0, k); setOrder(o, c.off || {}); arrangeMenu(k); }
        UI.menu(RAW(names(k)), [
          i > 0 && { label: 'Move up', action: function () { moved(i - 1); } },
          i < ar.order.length - 1 && { label: 'Move down', action: function () { moved(i + 1); } },
          i > 0 && { label: 'Move to the top', action: function () { moved(0); } },
          cat ? { label: k.indexOf('cat:') === 0 ? 'Unpin this category' : 'Remove this shelf', action: function () { setOrder(ar.order.filter(function (x) { return x !== k; }), c.off || {}); arrangeMenu(); } }
            : { label: ar.off(k) ? 'Switch on' : 'Switch off', action: function () { var off = {}; Object.keys(c.off || {}).forEach(function (x) { off[x] = c.off[x]; }); off[k] = !ar.off(k); setOrder(ar.order, off); arrangeMenu(k); } },
          { label: 'Back', action: function () { arrangeMenu(k); } }
        ].filter(Boolean));
      } };
    // Adding a service or genre waits for TMDB's list, which a phone asking through Settings can't: on the TV only.
    }).concat([{ label: 'Pin a category…', action: pinMenu }].concat(phone ? [] : [{ label: 'Add a Top 10…', action: topMenu }, { label: 'Add a streaming service…', sub: 'what it has that your provider has too', action: function () { addMenu('services'); } }, { label: 'Add a genre…', sub: 'from TMDB', action: function () { addMenu('genres'); } }]).concat([{ label: 'Back to the way it was', action: function () { setOrder([], {}); arrangeMenu(); } }])));
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
      mode === 'home' && { label: 'Add a Top 10…', sub: 'what\'s most watched on a streaming service in your region', action: topMenu },
      mode === 'home' && token() && { label: 'Add a streaming service…', sub: 'a shelf of what it has that your provider has too', action: function () { addMenu('services'); } },
      mode === 'home' && { label: 'Arrange shelves', sub: 'Move, switch off, pin categories', action: function () { arrangeMenu(s && (s.id.indexOf('holiday:') === 0 ? 'holidays' : s.id)); } },
      { label: 'All categories', sub: 'Green', action: function () { A.list(s && s.cat, it); } },
      it && { label: (kind === 'series' ? 'Show' : 'Movie') + ' options', action: function () { A.menu(it); } },
      A.reload && { label: 'Reload movies and shows', sub: 'New titles from your provider', action: function () { A.reload(); } }
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
    if (a === 'blue') { Settings.openFrom('vod'); return true; }            // Back there comes back here
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
    refresh(); fetchLists(); fetchTop();
  }
  function hide() { open_ = false; if ($('viewVod')) $('viewVod').classList.remove('home-on'); document.body.classList.remove('vod-home-open'); }
  function on() { return S().vodHome !== false; }

  // Settings > Movies and shows > Arrange the Movies (Shows) home.
  function arrange(k, api) { A = api; if (kind !== k) { kind = k; at = 0; pos = {}; } arrangeMenu(); }

  /* The region's Top 10s for My media's shelf (media.js): { date, charts } as kept here (fetched when old), and
     [then] called once newer ones come. */
  function top10(then) {
    if (then && topWaiting.indexOf(then) < 0) topWaiting.push(then);
    fetchTop();
    var t = tmdb.lists['top10:' + region()] || {};
    return { date: t.date || '', charts: t.charts || [] };
  }
  return { top10: top10, show: show, wallOf: wallOf, hide: hide, arrange: arrange, on: on, changed: changed, restore: restore, pin: pin, get open() { return open_; }, _test: { norm: norm, matched: matched, build: build, set lists(v) { tmdb.lists = v; } } };
})();
