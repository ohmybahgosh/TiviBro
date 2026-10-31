/* Movies and Shows (Xtream VOD).  Lists are cached per playlist like live channels;
   details load only for the title you rest on.  Files play through the TV's own player,
   which seeks well and handles MKV/MP4 without any JS demuxing. */
var Vod = (function () {
  'use strict';
  var $ = U.$;
  var kind = 'movie', built = false, zone = 'items';
  var catsVL, itemsVL;
  var data = { movie: null, series: null };
  var info = new Map();
  var episodes = null, series = null;      // drill-down into a show
  var playingMeta = null;

  var CW = '_cw', MY = '_my', ALL = '_all';

  function E() { return Store.edits; }
  function key(it) { return (kind === 'series' && !it.ep ? 's' : 'm') + it.id; }
  function resumeOf(id) { return E().resume[id]; }

  function load(k) {
    if (data[k]) return Promise.resolve(data[k]);
    var ck = 'vod:' + Store.playlist.id + ':' + k;
    return Store.idbGet(ck).then(function (c) {
      var h = +Store.playlist.plRefresh, fresh = c && (h <= 0 || Date.now() - c.at < h * 3600e3);
      if (c && fresh) return (data[k] = c);
      return Promise.all([Source.vodCats(k), Source.vodList(k)]).then(function (r) {
        var cats = (r[0] || []).map(function (x) { return { id: String(x.category_id), name: x.category_name || 'Other' }; });
        var items = (r[1] || []).map(function (x) {
          return k === 'series'
            ? { id: x.series_id, name: x.name || '', cover: x.cover || '', plot: x.plot || '', rating: x.rating || '', year: (x.releaseDate || x.release_date || '').slice(0, 4), cat: String(x.category_id), added: +x.last_modified || 0 }
            : { id: x.stream_id, name: x.name || '', cover: x.stream_icon || '', rating: x.rating || '', ext: x.container_extension || 'mp4', cat: String(x.category_id), added: +x.added || 0 };
        });
        var d = { at: Date.now(), cats: cats, items: items };
        Store.idbSet(ck, d);
        return (data[k] = d);
      }).catch(function (e) { if (c) return (data[k] = c); throw e; });
    });
  }

  // Providers send 01:25:00, 85 (minutes) or 0; show 1 h 25 min, 43 min, or nothing.
  function niceDur(d) {
    if (!d) return '';
    var p = String(d).split(':').map(Number), secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : +d * 60;
    if (!(secs >= 60)) return '';
    var h = Math.floor(secs / 3600), m = Math.round(secs % 3600 / 60);
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  function cleanCat(n) { return Names.groupsOn() ? Names.clean(n) : n; }

  function renderCat(row, c) {
    if (!row._n) { row._n = U.el('span', 'name'); row._t = U.el('span', 'tag'); var b = U.el('div', 'txt'); b.appendChild(row._n); row.appendChild(b); row.appendChild(row._t); }
    row._n.textContent = c.name; row._t.textContent = c.count != null ? String(c.count) : '';
  }
  function renderItem(row, it) {
    if (!row._n) {
      row._img = U.el('img', 'poster'); row._img.decoding = 'async'; row._img.onerror = function () { if (!Net.retryImage(this)) this.style.visibility = 'hidden'; };
      var b = U.el('div', 'txt'); row._n = U.el('span', 'name'); row._s = U.el('span', 'sub'); row._p = U.el('div', 'pbar'); row._pi = U.el('i'); row._p.appendChild(row._pi);
      b.appendChild(row._n); b.appendChild(row._s); b.appendChild(row._p);
      row._t = U.el('span', 'tag');
      row.appendChild(row._img); row.appendChild(b); row.appendChild(row._t);
    }
    var img = it.cover || '';
    if (row._src !== img) { row._src = img; row._img.style.visibility = img ? 'visible' : 'hidden'; if (img) row._img.src = img; else row._img.removeAttribute('src'); }
    row._n.textContent = it.ep ? it.label : it.name;
    row._s.textContent = it.ep ? niceDur(it.dur) : [it.year, it.rating ? '★ ' + it.rating : ''].filter(Boolean).join('   ');
    var r = resumeOf(it.ep ? 'e' + it.id : key(it));
    if (r && r.dur) { row._p.style.display = ''; row._pi.style.width = Math.round(100 * r.pos / r.dur) + '%'; } else row._p.style.display = 'none';
    row._t.textContent = E().myList.indexOf(key(it)) >= 0 && !it.ep ? '★' : '';
  }

  function build() {
    catsVL = new VList($('vodCats'), { render: renderCat, onSel: onCat, empty: 'No categories', visible: 11,
      onHover: function () { if (zone !== 'cats') setZone('cats'); }, onClick: function () { UI.press('ok'); } });
    itemsVL = new VList($('vodItems'), { render: renderItem, onSel: onItem, empty: 'Nothing here', visible: 11,
      onHover: function () { if (zone !== 'items') setZone('items'); }, onClick: function () { UI.press('ok'); } });
    built = true;
  }

  function catList() {
    var d = data[kind], counts = {};
    d.items.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    var mine = E().myList.filter(function (k) { return k.charAt(0) === (kind === 'series' ? 's' : 'm'); }).length;
    var cw = continueList().length;
    var out = [];
    if (cw) out.push({ id: CW, name: 'Continue watching', count: cw });
    out.push({ id: MY, name: 'My list', count: mine });
    out.push({ id: ALL, name: kind === 'series' ? 'All shows' : 'All movies', count: d.items.length });
    d.cats.forEach(function (c) { if (counts[c.id]) out.push({ id: c.id, name: cleanCat(c.name), count: counts[c.id] }); });
    return out;
  }
  function continueList() {
    var d = data[kind]; if (!d) return [];
    var r = E().resume, out = [];
    d.items.forEach(function (it) { var x = r[key(it)]; if (x && x.pos > 60 && x.pos < x.dur - 120) out.push({ it: it, at: x.at }); });
    return out.sort(function (a, b) { return b.at - a.at; }).map(function (x) { return x.it; });
  }
  function itemsFor(cid) {
    var d = data[kind];
    if (cid === CW) return continueList();
    if (cid === MY) { var m = E().myList; return d.items.filter(function (it) { return m.indexOf(key(it)) >= 0; }); }
    if (cid === ALL) return d.items.slice().sort(function (a, b) { return b.added - a.added; });
    return d.items.filter(function (it) { return it.cat === cid; });
  }

  // Movies and shows for Search: whatever is loaded (prepare() loads them when Search opens).
  function allItems() {
    var out = [];
    ['movie', 'series'].forEach(function (k) {
      var d = data[k];
      if (d) d.items.forEach(function (it) { out.push({ it: it, kind: k }); });
    });
    return out;
  }
  /* Search looks inside Movies and Shows without opening them first: the lists load from the TV's
     cache (or the provider, once) when Search opens.  Only the kinds the provider offers. */
  var preparing = null;
  function offered() { var p = Store.playlist || {}, v = p.vod || {}; return p.type === 'xtream' ? ['movie', 'series'].filter(function (k) { return k === 'movie' ? v.movies : v.series; }) : []; }
  function prepare() {
    var want = offered().filter(function (k) { return !data[k]; });
    if (!want.length) return Promise.resolve(false);
    if (preparing) return preparing;
    preparing = Promise.all(want.map(function (k) { return load(k).catch(function (e) { Log.warn('vod', 'Search could not load ' + k + ': ' + (e && e.message || e)); }); }))
      .then(function () { preparing = null; return true; });
    return preparing;
  }
  // For Search's empty message: 'none' (the provider has no movies or shows), 'loading' or 'ready'.
  function searchState() { var o = offered(); return !o.length ? 'none' : o.some(function (k) { return !data[k]; }) ? (preparing ? 'loading' : 'none') : 'ready'; }
  /* Open a movie or show found in Search the way the Movies or Shows screen would: that screen opens on
     All, on the title, then a movie plays (Back returns to it there) or a show lists its episodes. */
  var pending = null;
  function openItem(x) {
    pending = x;
    Views.switchTab(x.kind === 'series' ? 'shows' : 'movies');
  }
  function openPending(k) {
    var x = pending;
    if (!x || x.kind !== k) return;
    pending = null;
    var cats = catsVL.items, ai = cats.findIndex(function (c) { return c.id === ALL; });
    if (ai >= 0) { catsVL.setItems(cats, ai); itemsVL.setItems(itemsFor(ALL), 0); }
    var at = itemsVL.items.findIndex(function (it) { return it.id === x.it.id; });
    if (at >= 0) itemsVL.setItems(itemsVL.items, at);
    setZone('items'); onItem();
    if (k === 'series') openSeries(x.it); else play(x.it, false);
  }

  var catDeb = U.debounce(function (c) { if (c && !episodes) { itemsVL.setItems(itemsFor(c.id), 0); onItem(); } }, 200);
  function onCat(i, c) { catDeb(c); }
  var infoDeb = U.debounce(fetchInfo, 400);
  function onItem() { showInfo(); infoDeb(); }

  function fetchInfo() {
    var it = itemsVL.current();
    if (!it || it.ep || kind !== 'movie' || info.has(it.id)) return;
    info.set(it.id, null);
    Source.vodInfo(it.id).then(function (r) {
      var i = (r && r.info) || {};
      info.set(it.id, { plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '', director: i.director || '', dur: i.duration || '', year: (i.releasedate || i.release_date || '').slice(0, 4), poster: i.movie_image || i.cover_big || '', media: Caps.fromXtream(i) });
      if (itemsVL.current() === it) showInfo();
    }).catch(function () {});
  }

  function mediaOf(it) { var m = it.ep ? null : (kind === 'movie' ? info.get(it.id) : null); return it.ep ? it.media : m && m.media; }
  function showInfo() {
    var it = itemsVL.current(), box = $('vodInfo');
    box.innerHTML = '';
    if (!it) return;
    var m = it.ep ? null : (kind === 'movie' ? info.get(it.id) : null);
    var poster = (m && m.poster) || it.cover || (series && series.cover);
    if (poster) { var img = U.el('img', 'vod-poster'); img.src = poster; img.onerror = function () { if (!Net.retryImage(this)) this.remove(); }; box.appendChild(img); }
    box.appendChild(U.el('h2', '', it.ep ? it.label : it.name));
    var meta = [m && m.year || it.year, niceDur(m && m.dur || it.dur), m && m.genre, it.rating ? '★ ' + it.rating : ''].filter(Boolean).join('   ');
    if (meta) box.appendChild(U.el('div', 'vod-meta', meta));
    // What the file is, from the provider's own scan of it: 4K, HDR or Dolby Vision, sound format.
    var md = mediaOf(it);
    if (md) {
      var lbl = Caps.label(md);
      if (lbl) box.appendChild(U.el('div', 'vod-media', lbl));
      var w = Caps.route(md, Store.settings.hdrRoute || 'auto').warn;
      if (w) box.appendChild(U.el('div', 'vod-meta warn', w));
    }
    var plot = (m && m.plot) || it.plot || (it.ep && it.plotEp) || '';
    if (plot) box.appendChild(U.el('p', 'vod-plot', plot));
    if (m && m.cast) box.appendChild(U.el('div', 'vod-meta', 'Cast: ' + m.cast));
    if (m && m.director) box.appendChild(U.el('div', 'vod-meta', 'Director: ' + m.director));
    var r = resumeOf(it.ep ? 'e' + it.id : key(it));
    if (r && r.dur) box.appendChild(U.el('div', 'vod-meta', 'Stopped at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min'));
  }

  /* ---------- series drill-down ---------- */
  function openSeries(s) {
    $('vodTitle').textContent = 'Loading ' + s.name;
    Source.seriesInfo(s.id).then(function (r) {
      var eps = [], byS = (r && r.episodes) || {};
      Object.keys(byS).sort(function (a, b) { return +a - +b; }).forEach(function (sn) {
        (byS[sn] || []).forEach(function (e) {
          var inf = e.info || {};
          eps.push({ ep: true, id: e.id, ext: e.container_extension || 'mp4', season: +sn, num: +e.episode_num || 0, media: Caps.fromXtream(inf),
            label: 'S' + sn + ' E' + (e.episode_num || '?') + '   ' + (e.title || '').replace(/^.*? - S\d+E\d+ - /i, ''),
            dur: inf.duration || '', plotEp: inf.plot || '', cover: inf.movie_image || s.cover });
        });
      });
      series = s; episodes = eps;
      $('vodTitle').textContent = s.name + '   ' + eps.length + ' episodes';
      // Start on the next unwatched episode.
      var res = E().resume, start = 0;
      for (var i = eps.length - 1; i >= 0; i--) if (res['e' + eps[i].id]) { var x = res['e' + eps[i].id]; start = x.pos < x.dur - 120 ? i : Math.min(i + 1, eps.length - 1); break; }
      itemsVL.setItems(eps, start);
      onItem();
      hints();
    }).catch(function () { U.toast('Could not load that show'); $('vodTitle').textContent = s.name; });
  }
  function closeSeries() {
    var s = series; episodes = null; series = null;
    var c = catsVL.current();
    var list = itemsFor(c ? c.id : ALL);
    itemsVL.setItems(list, Math.max(0, list.findIndex(function (x) { return x.id === s.id; })));
    $('vodTitle').textContent = kind === 'series' ? 'Shows' : 'Movies';
    onItem(); hints();
  }

  /* ---------- playback ---------- */
  function play(it, fromStart) {
    var id = it.ep ? 'e' + it.id : key(it);
    var r = resumeOf(id), startAt = !fromStart && r && r.pos > 30 && r.pos < r.dur - 60 ? r.pos - 5 : 0;
    var url = it.ep ? Source.episodeUrl(it.id, it.ext) : Source.movieUrl(it.id, it.ext);
    playingMeta = { id: id, media: mediaOf(it), title: it.ep ? (series ? series.name : '') + '   ' + it.label : it.name, sub: it.ep ? '' : it.year || '', item: it, seriesKey: series ? 's' + series.id : null };
    Views.playVod(playingMeta, url, startAt, function () { open(kind, true); });
  }
  // Save where playback is without stopping (the app going to the background).
  function checkpoint() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    if (dur > 60 && pos > 30 && pos < dur - 60) { E().resume[playingMeta.id] = { pos: pos, dur: dur, at: Date.now() }; Store.saveEdits(); }
  }
  function stopped() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    if (dur > 60) {
      var r = E().resume;
      if (pos > dur - 60) delete r[playingMeta.id];
      else if (pos > 30) r[playingMeta.id] = { pos: pos, dur: dur, at: Date.now() };
      // A show tracks its latest episode too, for Continue watching.
      if (playingMeta.seriesKey) r[playingMeta.seriesKey] = { pos: 61, dur: 1e6, at: Date.now() };
      Store.saveEdits();
    }
    playingMeta = null;
  }
  function ended() {
    var m = playingMeta;
    if (m && m.item && m.item.ep && episodes && Store.settings.autoNext !== false) {
      delete E().resume[m.id]; Store.saveEdits();
      var i = episodes.indexOf(m.item);
      if (i >= 0 && episodes[i + 1]) { playingMeta = null; U.toast('Next episode'); play(episodes[i + 1], true); return; }
    }
    stopped();
    Views.stopAll();
    open(kind, true);
  }

  function itemMenu(it) {
    if (!it) return;
    var id = it.ep ? 'e' + it.id : key(it);
    var r = resumeOf(id), mine = E().myList.indexOf(key(it)) >= 0;
    UI.menu(it.ep ? it.label : it.name, [
      r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(it, false); } },
      kind === 'movie' || it.ep ? { label: r ? 'Play from beginning' : 'Play', action: function () { play(it, true); } } : { label: 'Open episodes', action: function () { openSeries(it); } },
      !it.ep && { label: mine ? 'Remove from My list' : 'Add to My list', action: function () {
        var l = E().myList, k = key(it);
        if (mine) E().myList = l.filter(function (x) { return x !== k; }); else l.push(k);
        Store.saveEdits(); itemsVL.refresh(); U.toast(mine ? 'Removed from My list' : 'Added to My list');
      } },
      r && { label: 'Mark as watched', action: function () { delete E().resume[id]; Store.saveEdits(); itemsVL.refresh(); } }
    ]);
  }

  function setZone(z) { zone = z; catsVL.setActive(z === 'cats'); itemsVL.setActive(z === 'items'); hints(); }
  function hints() {
    UI.hints(episodes ? [['', 'OK  play'], ['', 'Hold OK  options'], ['', 'Back  all shows']]
      : [['', 'OK  ' + (kind === 'series' ? 'open' : 'play')], ['', 'Hold OK or Red  options'], ['', 'Back  menu bar', 'back'], ['green', 'Guide'], ['blue', 'Settings']]);
  }

  function keys(a) {
    if (zone === 'cats') {
      if (a === 'up') catsVL.move(-1);
      else if (a === 'down') catsVL.move(1);
      else if (a === 'chup') catsVL.page(-1);
      else if (a === 'chdown') catsVL.page(1);
      else if (a === 'right' || a === 'ok') { catDeb.cancel(); var c = catsVL.current(); if (c) { itemsVL.setItems(itemsFor(c.id), 0); onItem(); } setZone('items'); }
      else if (a === 'back' || a === 'left') Views.tabBar(restore);
      else if (a === 'green') Views.switchTab('guide');
      else if (a === 'blue') Views.switchTab('settings');
      return true;
    }
    if (a === 'up') itemsVL.move(-1, true);
    else if (a === 'down') itemsVL.move(1, true);
    else if (a === 'chup') itemsVL.page(-1);
    else if (a === 'chdown') itemsVL.page(1);
    else if (a === 'left') { if (episodes) closeSeries(); else setZone('cats'); }
    else if (a === 'ok') {
      var it = itemsVL.current();
      if (!it) return true;
      if (kind === 'series' && !it.ep) openSeries(it); else play(it, false);
    }
    else if (a === 'red' || a === 'hold' || a === 'info') itemMenu(itemsVL.current());
    else if (a === 'back') { if (episodes) closeSeries(); else setZone('cats'); }
    else if (a === 'green') Views.switchTab('guide');
    else if (a === 'blue') Views.switchTab('settings');
    return true;
  }
  function restore() { UI.setHandler(keys); setZone(zone); }

  function open(k, keepState) {
    if (!built) build();
    var changed = k !== kind;
    kind = k;
    UI.setHandler(keys);
    if (changed) { episodes = null; series = null; }
    $('vodTitle').textContent = episodes && series ? series.name : (k === 'series' ? 'Shows' : 'Movies');
    if (keepState && data[k] && !changed && !pending) { var was = catsVL.current(), cl = catList(); catsVL.setItems(cl, Math.max(0, cl.findIndex(function (c) { return was && c.id === was.id; }))); itemsVL.refresh(); showInfo(); setZone(zone); return; }
    catsVL.setItems([], 0); itemsVL.setItems([], 0);
    itemsVL.empty = 'Loading…'; itemsVL.refresh();
    setZone('cats');
    load(k).then(function () {
      if (kind !== k) return;
      var cats = catList();
      var first = Math.max(0, cats.findIndex(function (c) { return c.count > 0; }));   // skip an empty My list
      catsVL.setItems(cats, first);
      itemsVL.empty = data[k].items.length ? 'Nothing here' : 'This provider has no ' + (k === 'series' ? 'shows' : 'movies') + ' right now';
      itemsVL.setItems(itemsFor(cats[first].id), 0);
      setZone('items');
      onItem();
      openPending(k);
    }).catch(function (e) { itemsVL.empty = 'Could not load ' + (k === 'series' ? 'shows' : 'movies') + ': ' + (e.message || e); itemsVL.setItems([], 0); });
  }

  return { open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, allItems: allItems, openItem: openItem, prepare: prepare, get searchState() { return searchState(); }, reset: function () { data = { movie: null, series: null }; info.clear(); episodes = null; series = null; } };
})();
