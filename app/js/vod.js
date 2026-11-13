/* Movies and Shows (Xtream VOD).  Lists are cached per playlist like live channels;
   details load only for the title you rest on.  Files play through the TV's own player,
   which seeks well and handles MKV/MP4 without any JS demuxing.

   Several playlists on: every playlist that is on and has movies or shows is loaded, one after the
   other, and shown together.  The categories list has a heading per playlist with its categories under
   it (Continue watching, My list and All stay on top, across all of them).  Another playlist's titles
   carry its id (it.pl) and their category ids get "<playlist id>:" in front; their keys for resume
   points, ✓ and My list ("pB:m123") are kept in that playlist's own edits by Store, as channel edits
   are.  Languages apply to all of them; hiding a category is kept by its own playlist.  With one
   playlist on, everything is as before (data[k] is that playlist's list itself). */
var Vod = (function () {
  'use strict';
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = U.$;
  var kind = 'movie', built = false, zone = 'items';
  var catsVL, itemsVL;
  var data = { movie: null, series: null };
  var raw = { movie: null, series: null };   // without the helper: the whole list, so a language change needs no reload
  var info = new Map();
  var episodes = null, series = null;      // drill-down into a show
  var playingMeta = null;

  var CW = '_cw', MY = '_my', ALL = '_all', LANGS = '_langs', NEW = '_new';

  function E() { return Store.edits; }
  function pre(it) { return it && it.pl ? it.pl + ':' : ''; }
  function key(it) { return pre(it) + (kind === 'series' && !it.ep ? 's' : 'm') + it.id; }
  function resumeOf(id) { return E().resume[id]; }
  function idOf(it) { return it.ep ? pre(it) + 'e' + it.id : key(it); }
  // The playlist a title is from (the first playlist's titles carry nothing).
  function plOf(it) { return (it && it.pl && Store.byId && Store.byId(it.pl)) || Store.playlist; }
  /* Watched: a movie or episode played to its last minute (or marked) keeps a ✓, so a finished one never
     looks like one never started.  id -> 1, in the playlist's edits beside resume, so backups carry it. */
  function seen() { var e = E(); if (!e.watched || typeof e.watched !== 'object') e.watched = {}; return e.watched; }
  function isWatched(id) { return !!seen()[id]; }
  // Watched at 90% (Plex and Jellyfin's default, so a movie stopped at its credits counts), or in a short
  // clip's last minute.  The one rule for the ✓, Continue watching and where a show opens.
  function finished(pos, dur) { return pos >= dur * 0.9 || pos > dur - 60; }
  // Where playback stopped: finished is watched, part-way is a place to resume, the first 30 s is nothing.
  function done(id, pos, dur) {
    if (!(dur > 60)) return;
    var r = E().resume;
    if (finished(pos, dur)) { delete r[id]; seen()[id] = 1; }
    else if (pos > 30) r[id] = { pos: pos, dur: dur, at: Date.now() };
  }
  function mark(id, on) { delete E().resume[id]; if (on) seen()[id] = 1; else delete seen()[id]; Store.saveEdits(); }
  /* A show remembers the episode you're on, for Continue watching and its row: the one you stopped in,
     or the next one once that's finished.  pos/dur only keep it in Continue watching; ep and l are what shows. */
  function markShow(k, it, eps) {
    var i = eps ? eps.indexOf(it) : -1, cur = !E().resume['e' + it.id] && isWatched('e' + it.id) && i >= 0 && eps[i + 1] ? eps[i + 1] : it;
    E().resume[k] = { pos: 61, dur: 1e6, at: Date.now(), ep: idOf(cur), l: 'S' + cur.season + ' E' + (cur.num || '?') };
  }
  // A show opens on the episode after the last one watched or started, or on the one in progress.
  function openAt(eps) {
    var res = E().resume;
    for (var i = eps.length - 1; i >= 0; i--) {
      var id = idOf(eps[i]), x = res[id];
      if (x && !finished(x.pos, x.dur)) return i;
      if (x || isWatched(id)) return Math.min(i + 1, eps.length - 1);
    }
    return 0;
  }

  /* Lists.  The full list (every language) is cached per playlist; only what is shown stays in memory,
     so a 160,000-title library with a dozen languages costs the TV what one language does.  On a TV the
     helper downloads and slims the provider's list (service/vod.js), so the app never parses the
     provider's full answer; without the helper (a browser) the app does it itself. */
  function cacheKey(k, p) { return 'vod:' + (p || Store.playlist).id + ':' + k; }
  // On a TV the helper keeps the full lists on the TV's storage and answers with what shows (issue #18:
  // a full list didn't fit an old TV's browser storage).  In a browser the app keeps them itself.
  function helped(p) { p = p || Store.playlist; return !!(Net.active && Net.port && Net.info && Net.info.vod >= 2 && p && (p.type === 'xtream' || p.type === 'stalker' || Source.m3uVod(p))); }
  // The playlists in use that have this kind (the first one first).
  function sources(k) { var ls = Store.loaded ? Store.loaded() : [Store.playlist]; return ls.filter(function (p) { return offeredBy(p).indexOf(k) >= 0; }); }
  var asking = { movie: null, series: null }, sets = { movie: {}, series: {} }, gen = 0;
  /* Several playlists: at most this many titles of one kind in memory together (the first playlist's
     always load, as before); fewer on a TV with 1 GB, or memory-safe after closing while playing. */
  function vodMax() { return window.Player && Player.memSafe ? 60000 : 200000; }
  function load(k, again) {
    if (data[k] && !again) return Promise.resolve(data[k]);
    if (asking[k] && !again) return asking[k];
    var g = gen;                                  // reset() meanwhile (a playlist added or taken out): load again
    var list = sources(k);
    if (!list.length) list = [Store.playlist];
    // One after the other: two big lists at once could run a TV out of memory.
    var chain = Promise.resolve(), got = {}, held = 0, cap = vodMax();
    list.forEach(function (p, n) {
      chain = chain.then(function () {
        // Another playlist's list only while all of them together stay under vodMax() titles.
        if (n && held >= cap) { Log.warn('vod', 'Left out the ' + (k === 'series' ? 'shows' : 'movies') + ' of ' + (p.name || 'another playlist') + ': ' + held + ' titles are already in memory (at most ' + cap + ' on this TV)'); return; }
        return loadOne(k, p, again).then(function (d) {
          if (n && held + d.items.length > cap) { Log.warn('vod', 'Left out the ' + d.items.length + ' ' + (k === 'series' ? 'shows' : 'movies') + ' of ' + (p.name || 'another playlist') + ': with them ' + (held + d.items.length) + ' titles would be in memory (at most ' + cap + ')'); U.toast('Not every playlist\'s ' + (k === 'series' ? 'shows are' : 'movies are') + ' shown: together they are too many for this TV.', 7000); return; }
          held += d.items.length; got[p.id] = d;
          if (list.length > 1) Log.info('vod', (p.name || 'Playlist') + ': ' + d.items.length + ' ' + (k === 'series' ? 'shows' : 'movies') + ' (' + held + ' in all)');
        }, function (e) { if (!n) throw e; Log.warn('vod', 'The ' + (k === 'series' ? 'shows' : 'movies') + ' of ' + (p.name || 'another playlist') + ' did not load: ' + (e && e.message || e)); });
      });
    });
    var job = asking[k] = chain.then(function () {
      if (asking[k] === job) asking[k] = null;
      if (g !== gen) return load(k);
      sets[k] = got;
      return (data[k] = merge(k, list.filter(function (p) { return got[p.id]; })));
    }, function (e) { if (asking[k] === job) asking[k] = null; throw e; });
    return job;
  }
  /* The lists of several playlists as one: the others' titles marked with their playlist (it.pl) and
     their categories' ids prefixed, so the same category id from two providers stays two categories. */
  function merge(k, list) {
    if (list.length < 2) return list.length ? sets[k][list[0].id] : null;
    var out = { at: 0, cats: [], items: [], langs: {}, keep: {}, total: 0, adultCat: {}, multi: true }, anyAll = false;
    list.forEach(function (p, n) {
      var d = sets[k][p.id], pfx = n ? p.id + ':' : '';
      out.at = Math.max(out.at, d.at || 0); out.total += +d.total || d.items.length;
      d.cats.forEach(function (c) { out.cats.push({ id: pfx + c.id, name: c.name, pl: n ? p.id : '' }); });
      if (d.adultCat) for (var a in d.adultCat) out.adultCat[pfx + a] = d.adultCat[a];
      for (var l in d.langs || {}) out.langs[l] = (out.langs[l] || 0) + d.langs[l];
      if (!d.keep) anyAll = true; else for (var q in d.keep) out.keep[q] = d.keep[q];
      d.items.forEach(function (it) {
        if (n && it.pl !== p.id) { it.pl = p.id; it.cat = pfx + it.cat; }
        out.items.push(it);
      });
    });
    if (anyAll) out.keep = null;
    return out;
  }
  function loadOne(k, p, again) {
    var old = sets[k][p.id];
    if (old && !again) return Promise.resolve(old);
    var rk = raw[k] && raw[k][p.id];
    if (rk && again) return Promise.resolve(view(k, rk, p));
    if (helped(p)) {
      return fromHelper(k, p).then(function (d) {
        Store.idbSet(cacheKey(k, p), null);         // an older copy in the browser's storage: not needed now
        return d;
      }, function (e) {
        if (Source.m3uVod(p)) throw e;               // an M3U list's library lives with the helper only
        Log.warn('vod', 'The helper could not give the ' + (k === 'series' ? 'show' : 'movie') + ' list (' + (e && e.message || e) + '), loading it here');
        return own(k, p);
      });
    }
    if (Source.m3uVod(p)) return Promise.reject(new Error('Movies and shows from an M3U list need the network helper.'));
    return own(k, p);
  }
  function fromHelper(k, p) {
    var h = +p.plRefresh, t0 = Date.now();
    var body = Source.m3uVod(p) ? { pl: p.id, sig: Source.sig(p), kind: k, m3u: 1, picked: prefs(p).langs, navLang: navigator.language, hidden: hiddenCats(k, p) } : {
      pl: p.id, sig: Source.sig(p), kind: k, maxAge: h > 0 ? h * 3600e3 : 0,
      u: Net.wrap(Source.api(p, k === 'series' ? 'get_series' : 'get_vod_streams'), { pl: p }),
      uc: Net.wrap(Source.api(p, k === 'series' ? 'get_series_categories' : 'get_vod_categories'), { pl: p }),
      picked: prefs(p).langs, navLang: navigator.language, hidden: hiddenCats(k, p)
    };
    return postJSON('http://127.0.0.1:' + Net.port + '/vod/list', body, 240000).then(function (j) {
      if (!j || !Array.isArray(j.rows)) throw new Error((j && j.error) || 'no list');
      var base = k === 'series' ? 8 : 7, mk = k === 'series' ? seriesRow : movieRow;
      var items = j.rows.map(function (r) {
        var it = mk(r); it.lang = r[base] || ''; if (r[base + 1]) it.q = r[base + 1]; if (r[base + 2]) it.adult = 1; if (r[base + 3]) it.p = r[base + 3];
        return it;
      });
      Log.info('vod', 'The helper gave ' + items.length + ' of ' + j.total + ' ' + (k === 'series' ? 'shows' : 'movies') + (p.id !== Store.playlist.id ? ' of ' + (p.name || 'another playlist') : '') + ' in ' + (Date.now() - t0) + ' ms');
      return { at: j.at, cats: j.cats, items: items, langs: j.langs, keep: j.keep, total: j.total, adultCat: j.adultCat };
    });
  }
  // Without the helper: the full list is cached in the browser's storage and kept in memory.
  function own(k, p) {
    var ck = cacheKey(k, p);
    function keepRaw(c) { (raw[k] || (raw[k] = {}))[p.id] = c; return view(k, c, p); }
    return Store.idbGet(ck).then(function (c) {
      var h = +p.plRefresh, fresh = c && c.v === 3 && (h <= 0 || Date.now() - c.at < h * 3600e3);
      if (c && fresh) return keepRaw(c);
      return Promise.all([Source.vodCats(k, p), fetchItems(k, p)]).then(function (r) {
        var cats = (r[0] || []).map(function (x) { return { id: String(x.category_id), name: x.category_name || 'Other' }; });
        var d = { v: 3, at: Date.now(), cats: cats, items: r[1] };
        Store.idbSet(ck, d);
        return keepRaw(d);
      }).catch(function (e) { if (c) return keepRaw(c); throw e; });
    });
  }
  function movieRow(x) { return ({ id: x[0], name: x[1], cover: x[2], rating: x[3], ext: x[4] || 'mp4', cat: x[5], added: x[6] }); }
  function seriesRow(x) { return ({ id: x[0], name: x[1], cover: x[2], plot: x[3], rating: x[4], year: x[5], cat: x[6], added: x[7] }); }
  function fetchItems(k, p) {
    var api = Source.api(p, k === 'series' ? 'get_series' : 'get_vod_streams');
    function direct() {
      return Source.vodList(k, p).then(function (list) {
        return (list || []).map(function (x) {
          return k === 'series'
            ? seriesRow([x.series_id, x.name || '', x.cover || '', String(x.plot || '').slice(0, 300), x.rating || '', (x.releaseDate || x.release_date || '').slice(0, 4), String(x.category_id), +x.last_modified || 0])
            : movieRow([x.stream_id, x.name || '', x.stream_icon || '', x.rating || '', x.container_extension || 'mp4', String(x.category_id), +x.added || 0]);
        });
      });
    }
    if (!Net.active || !Net.port || !(Net.info && Net.info.vod)) return direct();
    var t0 = Date.now();
    return postJSON('http://127.0.0.1:' + Net.port + '/vod/slim', { kind: k, u: Net.wrap(api, { pl: p }) }, 240000).then(function (j) {
      if (!j || !Array.isArray(j.rows)) throw new Error((j && j.error) || 'no list');
      Log.info('vod', 'The helper slimmed the ' + (k === 'series' ? 'show' : 'movie') + ' list: ' + j.rows.length + ' in ' + (Date.now() - t0) + ' ms');
      return j.rows.map(k === 'series' ? seriesRow : movieRow);
    }).catch(function (e) {
      Log.warn('vod', 'The helper could not load the ' + (k === 'series' ? 'show' : 'movie') + ' list (' + (e && e.message || e) + '), loading it directly');
      return direct();
    });
  }
  function postJSON(url, body, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }

  function prefs(p) { p = p || Store.playlist; return p.vodPrefs || (p.vodPrefs = {}); }
  function hiddenCats(k, p) { var h = prefs(p).hide || {}; return h[k] || []; }
  var tag = VodView.tag, langName = VodView.langName;
  function view(k, d, p) { return VodView.view(d, { picked: prefs(p).langs, navLang: navigator.language, hidden: hiddenCats(k, p) }); }
  // A category's playlist and its id there (several playlists on: "<playlist id>:<id>").
  function catHome(id) { var w = Store.ownerOf ? Store.ownerOf(String(id)) : ''; return w ? { p: Store.byId(w), id: String(id).slice(w.length + 1) } : { p: Store.playlist, id: String(id) }; }
  // Languages are chosen once for every playlist with movies or shows.
  function vodPls() { var l = sources(kind); return l.length ? l : [Store.playlist]; }
  function saveLangs(next) { vodPls().forEach(function (p) { if (next) prefs(p).langs = next; else delete prefs(p).langs; Store.upsertPlaylist(p); }); }

  // After a language or category change: rebuild from the cache, keep the selected category.
  function reshow() {
    var was = catsVL.current(), wasId = was && was.id;
    // The helper (or the list in memory) answers again for the new choice.  The shown list stays until
    // then, so a button pressed meanwhile never finds it missing (issue #18).
    var other = kind === 'movie' ? 'series' : 'movie';
    if (data[other]) load(other, true).catch(function () {});
    load(kind, true).then(function () {
      var cl = catList(), at = Math.max(0, cl.findIndex(function (c) { return c.id === wasId; }));
      catsVL.setItems(cl, at);
      var c = catsVL.current();
      if (c && c.id !== LANGS) itemsVL.setItems(itemsFor(c.id), 0);
      onItem();
    }).catch(function (e) { U.toast('Could not reload the list: ' + (e && e.message || e), 4000); });
  }
  function langMenu() {
    var d = data[kind]; if (!d) return;
    var counts = d.langs, keep = d.keep;
    var cur = {};
    Object.keys(counts).forEach(function (c) { if (!keep || keep[c]) cur[c] = 1; });
    function save(next) { saveLangs(next); reshow(); }
    var items = [
      { label: 'Automatic', sub: 'your TV\'s language and untagged titles' + (Array.isArray(prefs().langs) ? '' : '   (now)'), action: function () { saveLangs(null); reshow(); } },
      { label: 'Show every language', action: function () { save(Object.keys(counts)); } }
    ];
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (c) {
      items.push({ label: (cur[c] ? '✓ ' : '    ') + langName(c), sub: counts[c].toLocaleString() + (kind === 'series' ? ' shows' : ' movies'), current: c === langMenu.last,
        action: function () {
          if (cur[c]) delete cur[c]; else cur[c] = 1;
          if (!Object.keys(cur).length) { U.toast('Keep at least one language'); cur[c] = 1; }
          langMenu.last = c; save(Object.keys(cur)); setTimeout(langMenu, 50);
        } });
    });
    UI.menu('Languages', items, function () { langMenu.last = null; });
  }
  function catMenu(c) {
    if (!c || c.head) return;
    // Hidden by the category's own playlist (several playlists on).
    var home = catHome(c.id), p = prefs(home.p), h = p.hide || (p.hide = {}), list = h[kind] || (h[kind] = []);
    var items = [];
    if (c.id !== CW && c.id !== MY && c.id !== ALL && c.id !== NEW && c.id !== LANGS) {
      items.push({ label: 'Hide this category', sub: 'its titles leave All and Search too', action: function () { list.push(home.id); Store.upsertPlaylist(home.p); U.toast(c.name + ' hidden'); reshow(); } });
    }
    if (data[kind] && Object.keys(data[kind].langs).filter(Boolean).length > 1) items.push({ label: 'Languages…', action: langMenu });
    var hidAll = 0; vodPls().forEach(function (q) { hidAll += hiddenCats(kind, q).length; });
    if (hidAll) items.push({ label: 'Show hidden categories (' + hidAll + ')', action: function () { vodPls().forEach(function (q) { var x = prefs(q).hide; if (x && x[kind] && x[kind].length) { x[kind] = []; Store.upsertPlaylist(q); } }); U.toast('Hidden categories are back'); reshow(); } });
    if (!items.length) return;
    UI.menu(RAW(c.name), items);
  }

  // Providers send 01:25:00, 85 (minutes) or 0; show 1 h 25 min, 43 min, or nothing.
  function niceDur(d) {
    if (!d) return '';
    var p = String(d).split(':').map(Number), secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : +d * 60;
    if (!(secs >= 60)) return '';
    var h = Math.floor(secs / 3600), m = Math.round(secs % 3600 / 60);
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  // 7.634 -> ★ 7.6; nothing for 0 or a missing rating.
  function stars(r) { r = Math.round(parseFloat(r) * 10) / 10; return r > 0 ? '★ ' + r : ''; }
  function cleanCat(n, pl) { var p = pl && Store.byId ? Store.byId(pl) : null; return p && p.names ? Names.cleanGroupWith(p.names, n) : Names.cleanGroup(n); }

  function renderCat(row, c) {
    if (!row._n) { row._n = U.el('span', 'name'); row._t = U.el('span', 'tag'); var b = U.el('div', 'txt'); b.appendChild(row._n); row.appendChild(b); row.appendChild(row._t); }
    row.classList.toggle('ghead', !!c.head);                    // a playlist's heading (several playlists on)
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
    var d = data[kind], many = d && (!d.keep || Object.keys(d.keep).length > 2) && Object.keys(d.langs || {}).length > 2;
    var id = idOf(it), r = resumeOf(id), show = kind === 'series' && !it.ep;
    // A show's row: the episode you're on, and that episode's progress (none before you start it).
    var at = show ? r && r.l : '', bar = show ? r && r.ep && resumeOf(r.ep) : r;
    var cc = catsVL && catsVL.current(), mixed = !it.ep && cc && (cc.id === ALL || cc.id === NEW || cc.id === MY || cc.id === CW);
    row._s.textContent = it.ep ? niceDur(it.dur) : [at, it.year, stars(it.rating), it.q, many && it.lang, mixed && catName(it)].filter(Boolean).join('   ');
    if (bar && bar.dur) { row._p.style.display = ''; row._pi.style.width = Math.round(100 * bar.pos / bar.dur) + '%'; } else row._p.style.display = 'none';
    // ✓ for watched (not while it's being watched again: the bar shows then), ★ for My list.
    row._t.textContent = [!r && isWatched(id) && '✓', !it.ep && E().myList.indexOf(key(it)) >= 0 && '★'].filter(Boolean).join('  ');
  }

  function build() {
    // TMDB's answer for a show came in (series.js): show it if that show is on screen.
    if (typeof Series !== 'undefined') Series.onChange(function () { if (kind === 'series' && Views.tab === 'shows' && !Views.full && itemsVL) showInfo(); });
    catsVL = new VList($('vodCats'), { render: renderCat, onSel: onCat, empty: 'No categories', visible: 11,
      onHover: function () { if (zone !== 'cats') setZone('cats'); }, onClick: function () { UI.press('ok'); } });
    itemsVL = new VList($('vodItems'), { render: renderItem, onSel: onItem, empty: 'Nothing here', visible: 11,
      onHover: function () { if (zone !== 'items') setZone('items'); }, onClick: function () { UI.press('ok'); } });
    built = true;
  }

  function catList() {
    var d = data[kind], counts = {};
    if (!d) return [];
    d.items.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    var mine = E().myList.filter(function (k) { return k.charAt(k.indexOf(':') + 1) === (kind === 'series' ? 's' : 'm'); }).length;
    var cw = continueList().length;
    var out = [];
    var codes = Object.keys(d.langs || {}).filter(Boolean);
    if (codes.length > 1) {
      var on = d.keep ? Object.keys(d.keep).filter(function (c) { return c && d.langs[c]; }) : codes;
      out.push({ id: LANGS, name: 'Languages', count: on.length === codes.length ? 'all' : on.slice(0, 2).join(', ') + (on.length > 2 ? ' +' + (on.length - 2) : '') + (on.length ? '' : 'untagged') });
    }
    if (cw) out.push({ id: CW, name: 'Continue watching', count: cw });
    out.push({ id: MY, name: 'My list', count: mine });
    out.push({ id: ALL, name: kind === 'series' ? 'All shows' : 'All movies', count: d.items.filter(function (it) { return !it.adult; }).length });
    // Recently added (discussion #60): the newest titles across every category, when the provider says when each was added.
    var fresh = recentList().length;
    if (fresh) out.push({ id: NEW, name: 'Recently added', count: fresh });
    var hid = {}; vodPls().forEach(function (q, n) { hiddenCats(kind, q).forEach(function (c) { hid[(n && d.multi ? q.id + ':' : '') + c] = 1; }); });
    var later = [], section = null;
    d.cats.forEach(function (c) {
      if (!counts[c.id] || hid[c.id]) return;
      var adult = !!(d.adultCat && d.adultCat[c.id]), row = { id: c.id, name: cleanCat(c.name, c.pl), count: counts[c.id], adult: adult, pl: c.pl || '' };
      if (adult) { later.push(row); return; }
      // Several playlists: a heading with the playlist's name above its categories.
      if (d.multi && (c.pl || '') !== section) { section = c.pl || ''; var pp = section ? Store.byId(section) : Store.playlist; out.push({ id: '@' + (section || 'first'), head: true, name: (pp && pp.name) || 'Playlist' }); }
      out.push(row);
    });
    out = out.concat(later);
    return out;
  }
  function continueList() {
    var d = data[kind]; if (!d) return [];
    var r = E().resume, out = [];
    d.items.forEach(function (it) { var x = r[key(it)]; if (x && x.pos > 60 && !finished(x.pos, x.dur)) out.push({ it: it, at: x.at }); });
    return out.sort(function (a, b) { return b.at - a.at; }).map(function (x) { return x.it; });
  }
  function itemsFor(cid) {
    var d = data[kind];
    if (!d) return [];
    if (cid === CW) return continueList();
    if (cid === LANGS) return [];
    if (cid === NEW) return recentList();
    if (cid === MY) { var m = E().myList; return sorted(d.items.filter(function (it) { return m.indexOf(key(it)) >= 0; })); }
    if (cid === ALL) return sorted(d.items.filter(function (it) { return !it.adult; }), 'added');
    return sorted(d.items.filter(function (it) { return it.cat === cid; }));
  }
  // The newest 100 titles, newest first: what Recently added shows.
  function recentList() {
    var d = data[kind]; if (!d) return [];
    return d.items.filter(function (it) { return !it.adult && it.added > 0; }).sort(function (a, b) { return b.added - a.added; }).slice(0, 100);
  }
  /* Settings > Movies and shows > Order movies and shows (discussion #60): the provider's own order (All:
     newest first, as always), recently added, A to Z, or rating. */
  function sorted(list, dflt) {
    var how = Store.settings.vodSort || 'provider';
    if (how === 'provider') how = dflt || '';
    if (how === 'added') return list.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
    if (how === 'name') return list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }); });
    if (how === 'rating') return list.sort(function (a, b) { return (+b.rating || 0) - (+a.rating || 0); });
    return list;
  }
  // A title's category name, shown on its row in All, Recently added, My list and Continue watching (discussion #60).
  var catNames = null, catNamesFor = null;
  function catName(it) {
    var d = data[kind]; if (!d) return '';
    if (catNamesFor !== d) { catNames = {}; catNamesFor = d; d.cats.forEach(function (c) { catNames[c.id] = cleanCat(c.name, c.pl); }); }
    return catNames[it.cat] || '';
  }

  // Movies and shows for Search: whatever is loaded (prepare() loads them when Search opens).
  function allItems() {
    var out = [];
    ['movie', 'series'].forEach(function (k) {
      var d = data[k];
      if (d) d.items.forEach(function (it) { if (!it.adult) out.push({ it: it, kind: k }); });
    });
    return out;
  }
  /* Search looks inside Movies and Shows without opening them first: the lists load from the TV's
     cache (or the provider, once) when Search opens.  Only the kinds the provider offers. */
  var preparing = null;
  function offeredBy(p) { p = p || {}; var v = p.vod || {}; return p.type === 'xtream' || p.type === 'stalker' || v.m3u ? ['movie', 'series'].filter(function (k) { return k === 'movie' ? v.movies : v.series; }) : []; }
  // What any playlist in use offers (several playlists on: all of them together).
  function offered() {
    var out = [], ls = Store.loaded ? Store.loaded() : [Store.playlist || {}];
    ls.forEach(function (p) { offeredBy(p).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); });
    return ['movie', 'series'].filter(function (k) { return out.indexOf(k) >= 0; });
  }
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
    var at = itemsVL.items.findIndex(function (it) { return it === x.it || (it.id === x.it.id && (it.pl || '') === (x.it.pl || '')); });
    if (at >= 0) itemsVL.setItems(itemsVL.items, at);
    setZone('items'); onItem();
    if (k === 'series') openSeries(x.it, x.ep ? function (eps) {
      var e = eps.filter(function (y) { return String(y.id) === String(x.ep); })[0];
      if (e) { itemsVL.setItems(eps, eps.indexOf(e)); onItem(); play(e, !!x.fromStart); }
    } : null);
    else play(x.it, !!x.fromStart);
  }

  var catDeb = U.debounce(function (c) {
    if (!c || c.head || episodes) return;
    var shut = c.adult && !adultOpen();
    itemsVL.empty = c.id === LANGS ? 'Press OK to pick which languages show' : shut ? 'Press OK and enter the PIN' : 'Nothing here';
    itemsVL.setItems(shut ? [] : itemsFor(c.id), 0); onItem();
  }, 200);
  // With a PIN set (Settings > Parental controls, for channels), adult categories open only after it.
  var adultUnlocked = false;
  function adultOpen() { return adultUnlocked || !Parental.enabled() || (Store.settings.pinScope !== 'channels' && Store.settings.pinScope !== 'both'); }
  function onCat(i, c) { catDeb(c); if (zone === 'cats') hints(); }
  var infoDeb = U.debounce(fetchInfo, 400);
  function onItem() { showInfo(); infoDeb(); }

  function fetchInfo() {
    var it = itemsVL.current();
    if (!it || it.ep || kind !== 'movie' || info.has(key(it))) return;
    info.set(key(it), null);
    Source.vodInfo(it.id, plOf(it)).then(function (r) {
      var i = (r && r.info) || {};
      // The provider's trailer: a YouTube id, or a whole YouTube link.
      var yt = String(i.youtube_trailer || i.trailer || '').trim(), ym = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/.exec(yt);
      info.set(key(it), { trailer: ym ? ym[1] : /^[A-Za-z0-9_-]{11}$/.test(yt) ? yt : '', plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '', director: i.director || '', dur: i.duration || '', year: (i.releasedate || i.release_date || '').slice(0, 4), poster: i.movie_image || i.cover_big || '', media: Caps.fromXtream(i) });
      if (itemsVL.current() === it) showInfo();
    }).catch(function () {});
  }

  function mediaOf(it) { var m = it.ep ? null : (kind === 'movie' ? info.get(key(it)) : null); return it.ep ? it.media : m && m.media; }
  function showInfo() {
    var it = itemsVL.current(), box = $('vodInfo');
    box.innerHTML = '';
    if (!it) return;
    var m = it.ep ? null : (kind === 'movie' ? info.get(key(it)) : null);
    /* A show and its episodes, from TMDB (series.js) when you have a token: only what the provider's
       details leave out (a poster, a summary, the rating, genres, cast, an episode's title, summary and
       picture).  The provider's own always come first. */
    var tv = typeof Series !== 'undefined' && kind === 'series' ? (it.ep ? (series ? Series.show(series.name, series.year, 'strong') : null) : Series.show(it.name, it.year, 'strong')) : null;
    var te = tv && it.ep ? Series.episode(tv, it.season, it.num) : null;
    /* Hide spoilers (Settings > Movies and shows, discussion #36): an episode you haven't started keeps its number and air
       date, without its summary, its own title from TMDB, or a picture from it (the show's cover instead). */
    var spoil = !!(Store.settings.noSpoilers && it.ep && !isWatched(idOf(it)) && !resumeOf(idOf(it)));
    if (spoil && te) te = { air: te.air };
    var showCover = series && series.cover;
    var poster = (m && m.poster) || (it.ep ? (spoil ? showCover || (tv && tv.poster) : it.cover && it.cover !== showCover ? it.cover : (te && te.still) || it.cover) : it.cover || (tv && tv.poster)) || showCover || (tv && tv.poster);
    if (poster) { var img = U.el('img', 'vod-poster' + (it.ep && te && poster === te.still ? ' still' : '')); img.src = poster; img.onerror = function () { if (!Net.retryImage(this)) this.remove(); }; box.appendChild(img); }
    box.appendChild(U.el('h2', '', it.ep ? (te && te.t && /^S\d+ E[\d?]+\s*$/.test(it.label) ? it.label + '   ' + te.t : it.label) : it.name));
    var rating = stars(it.rating) || (tv && !it.ep && tv.rating ? '★ ' + tv.rating + ' TMDB' : '');
    var meta = [m && m.year || it.year || (!it.ep && tv && tv.year), niceDur(m && m.dur || it.dur), m && m.genre || (!it.ep && tv && tv.genre), !it.ep && tv && tv.network, it.ep && te && te.air ? 'aired ' + new Date(te.air + 'T12:00:00').toLocaleDateString(U.loc ? U.loc() : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '', rating].filter(Boolean).join('   ');
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
    if (tv && plot.length < 40) plot = (it.ep ? te && te.plot : tv.plot) || plot;
    if (spoil && plot) plot = 'Summary hidden until you watch it (Hide spoilers is on).';
    if (plot) box.appendChild(U.el('p', 'vod-plot' + (spoil ? ' spoil' : ''), plot));
    if (m && m.cast) box.appendChild(U.el('div', 'vod-meta', 'Cast: ' + m.cast));
    else if (tv && !it.ep && tv.cast) box.appendChild(U.el('div', 'vod-meta', 'Cast: ' + tv.cast));
    if (m && m.director) box.appendChild(U.el('div', 'vod-meta', 'Director: ' + m.director));
    var id = idOf(it), r = resumeOf(id);
    // A show: the episode you're on (its own resume point is only there for Continue watching).
    if (kind === 'series' && !it.ep) {
      var er = r && r.ep && resumeOf(r.ep);
      if (er) box.appendChild(U.el('div', 'vod-meta', r.l + ': stopped at ' + Math.floor(er.pos / 60) + ' of ' + Math.floor(er.dur / 60) + ' min'));
      else if (r && r.l) box.appendChild(U.el('div', 'vod-meta', 'Up next: ' + r.l));
      r = null;
    }
    if (r && r.dur) box.appendChild(U.el('div', 'vod-meta', 'Stopped at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min'));
    else if (isWatched(id)) box.appendChild(U.el('div', 'vod-meta', '✓  Watched'));
  }

  /* ---------- series drill-down ---------- */
  function openSeries(s, then) {
    $('vodTitle').textContent = 'Loading ' + s.name;
    Source.seriesInfo(s.id, plOf(s)).then(function (r) {
      var eps = [], byS = (r && r.episodes) || {};
      Object.keys(byS).sort(function (a, b) { return +a - +b; }).forEach(function (sn) {
        (byS[sn] || []).forEach(function (e) {
          var inf = e.info || {};
          eps.push({ ep: true, pl: s.pl, id: e.id, ext: e.container_extension || 'mp4', url: e.direct_source && Source.m3uVod(plOf(s)) ? e.direct_source : '', season: +sn, num: +e.episode_num || 0, media: Caps.fromXtream(inf),
            label: 'S' + sn + ' E' + (e.episode_num || '?') + '   ' + (e.title || '').replace(/^.*? - S\d+E\d+ - /i, ''),
            dur: inf.duration || '', plotEp: inf.plot || '', cover: inf.movie_image || s.cover });
        });
      });
      series = s; episodes = eps;
      $('vodTitle').textContent = s.name + '   ' + eps.length + ' episodes';
      itemsVL.setItems(eps, openAt(eps));
      onItem();
      hints();
      if (then) then(eps);
    }).catch(function () { U.toast('Could not load that show'); $('vodTitle').textContent = s.name; });
  }
  // Open a show's episodes on one of them ('e' + id) and play it from where it stopped.
  function playEpisode(s, epId) {
    openSeries(s, function (eps) {
      var e = eps.filter(function (y) { return idOf(y) === epId; })[0];
      if (e) { itemsVL.setItems(eps, eps.indexOf(e)); onItem(); play(e, false); }
    });
  }
  function closeSeries() {
    var s = series; episodes = null; series = null;
    var c = catsVL.current();
    var list = itemsFor(c ? c.id : ALL);
    itemsVL.setItems(list, Math.max(0, list.findIndex(function (x) { return x === s || (x.id === s.id && (x.pl || '') === (s.pl || '')); })));
    $('vodTitle').textContent = kind === 'series' ? 'Shows' : 'Movies';
    onItem(); hints();
  }

  /* ---------- playback ---------- */
  function play(it, fromStart) {
    var id = idOf(it);
    var r = resumeOf(id), startAt = !fromStart && r && r.pos > 30 && r.pos < r.dur - 60 ? r.pos - 5 : 0;
    var meta = { id: id, media: mediaOf(it), title: it.ep ? (series ? series.name : '') + '   ' + it.label : it.name, sub: it.ep ? '' : it.year || '', item: it, seriesKey: series ? pre(series) + 's' + series.id : null, p: it.pl || '' };
    // An M3U list's episodes carry their own link, and its movies' links are asked for (Source.movieLink).
    var link = it.ep ? Promise.resolve(it.url || Source.episodeUrl(it.id, it.ext, plOf(it))) : Source.movieLink(it.id, it.ext, plOf(it));
    link.then(function (url) {
      playingMeta = meta;
      Views.playVod(meta, url, startAt, function () { open(kind, true); });
    }, function (e) { U.toast((e && e.message) || 'Could not play that', 5000); });
  }
  // Save where playback is without stopping (the app going to the background).
  function checkpoint() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    // In the credits counts as watched too: webOS may close the app in the background, so stopped() never runs.
    if (dur > 60) { done(playingMeta.id, pos, dur); if (playingMeta.seriesKey) markShow(playingMeta.seriesKey, playingMeta.item, episodes); Store.saveEdits(); }
  }
  function stopped() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    if (dur > 60) {
      done(playingMeta.id, pos, dur);
      // A show tracks its latest episode too, for Continue watching.
      if (playingMeta.seriesKey) markShow(playingMeta.seriesKey, playingMeta.item, episodes);
      Store.saveEdits();
    }
    playingMeta = null;
  }
  function ended() {
    var m = playingMeta;
    if (m && m.item && m.item.ep && episodes && Store.settings.autoNext !== false) {
      mark(m.id, true);
      var i = episodes.indexOf(m.item);
      if (i >= 0 && episodes[i + 1]) { playingMeta = null; U.toast('Next episode'); play(episodes[i + 1], true); return; }
    }
    stopped();
    Views.stopAll();
    open(kind, true);
  }

  function itemMenu(it) {
    if (!it) return;
    var id = idOf(it);
    var r = resumeOf(id), mine = E().myList.indexOf(key(it)) >= 0, playable = kind === 'movie' || it.ep, w = isWatched(id);
    var er = !playable && r && r.ep ? resumeOf(r.ep) : null;
    UI.menu(RAW(it.ep ? it.label : it.name), [
      playable && r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(it, false); } },
      // A show: straight into the episode you're on, or the next one.
      !playable && r && r.ep && { label: (er ? 'Resume ' : 'Play ') + r.l, sub: er ? Math.floor(er.pos / 60) + ' min' : '', action: function () { playEpisode(it, r.ep); } },
      playable ? { label: r ? 'Play from beginning' : 'Play', action: function () { play(it, true); } } : { label: 'Open episodes', action: function () { openSeries(it); } },
      trailerOf(it) && { label: 'Watch the trailer', sub: 'YouTube', action: function () { watchTrailer(trailerOf(it)); } },
      !it.ep && { label: mine ? 'Remove from My list' : 'Add to My list', action: function () {
        var l = E().myList, k = key(it);
        if (mine) E().myList = l.filter(function (x) { return x !== k; }); else l.push(k);
        Store.saveEdits(); itemsVL.refresh(); U.toast(mine ? 'Removed from My list' : 'Added to My list');
      } },
      // On a show (no file of its own) it only takes the show off Continue watching, as before.
      (playable ? r || !w : r) && { label: 'Mark as watched', action: function () { if (playable) mark(id, true); else { delete E().resume[id]; Store.saveEdits(); } relist(); } },
      playable && w && !r && { label: 'Mark unwatched', action: function () { mark(id, false); relist(); } }
    ]);
  }

  /* Trailers (discussion #60): the provider's YouTube trailer, opened in the TV's YouTube app; TiviBro comes back
     with the Back button there.  Only on the TV, where TiviBro can ask webOS to open another app. */
  function trailerOf(it) { var m = it && !it.ep && kind === 'movie' ? info.get(key(it)) : null; return m && m.trailer && typeof PalmServiceBridge !== 'undefined' ? m.trailer : ''; }
  function watchTrailer(id) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var r = {}; try { r = JSON.parse(msg); } catch (e) {}
        if (r.returnValue === false) { Log.warn('vod', 'YouTube did not open: ' + (r.errorText || r.errorCode)); U.toast('The TV\'s YouTube app didn\'t open'); }
      };
      b.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: 'https://www.youtube.com/tv?v=' + id } }));
      Log.info('vod', 'Trailer on YouTube: ' + id);
    } catch (e) { U.toast('The TV\'s YouTube app didn\'t open'); }
  }

  // After marking: Continue watching and its count follow (a title marked watched leaves it).
  function relist() {
    if (!episodes) {
      var was = catsVL.current(), cl = catList(), sel = itemsVL.sel;
      catsVL.setItems(cl, Math.max(0, cl.findIndex(function (c) { return was && c.id === was.id; })));
      if (was && was.id === CW) itemsVL.setItems(itemsFor(CW), sel);
    }
    itemsVL.refresh(); onItem();
  }
  function setZone(z) { zone = z; catsVL.setActive(z === 'cats'); itemsVL.setActive(z === 'items'); hints(); }
  function hints() {
    if (episodes) return UI.hints([['', 'OK  play'], ['', 'Hold OK  options', 'hold'], ['', 'Back  all shows', 'back']]);
    if (zone === 'cats') {
      var c = catsVL && catsVL.current();
      return UI.hints(c && c.id === LANGS ? [['', 'OK  pick languages'], ['', 'Back  menu bar', 'back'], ['green', 'Guide'], ['blue', 'Settings']]
        : [['', 'OK  open'], ['', 'Hold OK  hide category', 'hold'], ['', 'Back  menu bar', 'back'], ['red', 'Hide category'], ['green', 'Guide'], ['blue', 'Settings']]);
    }
    UI.hints([['', 'OK  ' + (kind === 'series' ? 'open' : 'play')], ['', 'Hold OK  options', 'hold'], ['', 'Back  menu bar', 'back'], ['red', 'Options'], ['green', 'Guide'], ['blue', 'Settings']]);
  }

  function keys(a) {
    if (zone === 'cats') {
      if (a === 'up') catsVL.move(-1, true);
      else if (a === 'down') catsVL.move(1, true);
      else if (a === 'chup') catsVL.page(-1);
      else if (a === 'chdown') catsVL.page(1);
      else if ((a === 'ok' || a === 'right') && catsVL.current() && catsVL.current().id === LANGS) { if (a === 'ok') langMenu(); }
      else if (a === 'right' || a === 'ok') {
        catDeb.cancel(); var c = catsVL.current();
        var go = function () { if (c) { itemsVL.empty = 'Nothing here'; itemsVL.setItems(itemsFor(c.id), 0); onItem(); } setZone('items'); };
        if (c && c.adult && !adultOpen()) Parental.gate('channels', null, function () { adultUnlocked = true; go(); }); else go();
      }
      else if (a === 'red' || a === 'hold' || a === 'info') catMenu(catsVL.current());
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
      itemsVL.empty = data[k].items.length ? 'Nothing here' : data[k].total ? 'Nothing in the languages picked.  Choose Languages on the left.' : 'This provider has no ' + (k === 'series' ? 'shows' : 'movies') + ' right now';
      itemsVL.setItems(itemsFor(cats[first].id), 0);
      setZone('items');
      onItem();
      openPending(k);
    }).catch(function (e) { itemsVL.empty = 'Could not load ' + (k === 'series' ? 'shows' : 'movies') + ': ' + (e.message || e); itemsVL.setItems([], 0); });
  }

  /* ---------- the phone app (app/js/phone.js) ----------
     Movies and Shows on the phone: categories, titles (a page at a time), details with episodes, and
     playing one on the TV.  Same lists, languages, hidden categories and PIN as the TV shows. */
  function withKind(k, fn) { var was = kind; kind = k; try { return fn(); } finally { kind = was; } }
  // A title's id for the phone: another playlist's carries "<playlist id>:" (several playlists on).
  function phoneId(it) { return it.pl ? it.pl + ':' + it.id : it.id; }
  function byPhoneId(k, id) { return data[k].items.filter(function (x) { return String(phoneId(x)) === String(id); })[0]; }
  function slimItem(k, it) {
    var r = resumeOf(pre(it) + (k === 'series' ? 's' : 'm') + it.id), x = { id: phoneId(it), n: it.name, c: it.cover || '', r: stars(it.rating).replace('★ ', '') };
    if (it.year) x.y = String(it.year).slice(0, 4);
    if (r && r.dur && k === 'movie') x.p = Math.round(100 * r.pos / r.dur);
    return x;
  }
  function phoneKind(k) { if (k !== 'movie' && k !== 'series') throw new Error('Unknown kind'); if (offered().indexOf(k) < 0) return null; return k; }
  var ForPhone = {
    cats: function (k) {
      if (!phoneKind(k)) return Promise.resolve({ none: true, cats: [] });
      return load(k).then(function () {
        // Several playlists: no heading rows; another playlist's categories say whose they are.
        return { cats: withKind(k, catList).filter(function (c) { return c.id !== LANGS && !c.head; }).map(function (c) {
          var pp = c.pl && Store.byId(c.pl);
          return { id: c.id, n: pp ? (pp.name || 'Playlist') + ': ' + c.name : c.name, count: c.count, adult: c.adult ? 1 : 0, locked: c.adult && !adultOpen() ? 1 : 0 };
        }) };
      });
    },
    items: function (k, cid, q, off, lim) {
      if (!phoneKind(k)) return Promise.resolve({ total: 0, items: [] });
      return load(k).then(function () {
        return withKind(k, function () {
          var list;
          q = String(q || '').trim().toLowerCase();
          if (q) {
            list = data[k].items.filter(function (it) { return !it.adult && String(it.name).toLowerCase().indexOf(q) >= 0; });
            list.sort(function (a, b) { return (String(a.name).toLowerCase().indexOf(q) === 0 ? 0 : 1) - (String(b.name).toLowerCase().indexOf(q) === 0 ? 0 : 1); });
          } else {
            var c = catList().filter(function (x) { return x.id === (cid || ALL); })[0];
            if (c && c.adult && !adultOpen()) return { total: 0, items: [], locked: true };
            list = itemsFor(cid || ALL);
          }
          off = Math.max(0, +off || 0); lim = Math.min(300, Math.max(1, +lim || 120));
          return { total: list.length, offset: off, items: list.slice(off, off + lim).map(function (it) { return slimItem(k, it); }) };
        });
      });
    },
    info: function (k, id) {
      if (!phoneKind(k)) return Promise.reject(new Error('This playlist has no ' + (k === 'series' ? 'shows' : 'movies') + '.'));
      return load(k).then(function () {
        var it = byPhoneId(k, id);
        if (!it) throw new Error('That title is no longer in this playlist.');
        var res = E().resume, px = pre(it);
        if (k === 'movie') {
          return Source.vodInfo(it.id, plOf(it)).then(function (r) {
            var i = (r && r.info) || {}, rr = res[px + 'm' + it.id];
            return { id: phoneId(it), n: it.name, c: i.movie_image || i.cover_big || it.cover || '', plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '',
              year: (i.releasedate || i.release_date || '').slice(0, 4), dur: niceDur(i.duration || ''), r: stars(it.rating).replace('★ ', ''), media: Caps.label(Caps.fromXtream(i)) || '',
              pos: rr ? Math.round(rr.pos) : 0, len: rr ? Math.round(rr.dur) : 0, mine: E().myList.indexOf(px + 'm' + it.id) >= 0 };
          }, function () { return { id: phoneId(it), n: it.name, c: it.cover || '', plot: '', r: stars(it.rating).replace('★ ', '') }; });
        }
        return Source.seriesInfo(it.id, plOf(it)).then(function (r) {
          var byS = (r && r.episodes) || {}, seasons = [], inf = (r && r.info) || {};
          Object.keys(byS).sort(function (a, b) { return +a - +b; }).forEach(function (sn) {
            seasons.push({ s: +sn, eps: (byS[sn] || []).map(function (e) {
              var ei = e.info || {}, rr = res[px + 'e' + e.id];
              return { id: e.id, e: +e.episode_num || 0, t: String(e.title || '').replace(/^.*? - S\d+E\d+ - /i, ''), dur: niceDur(ei.duration || ''), plot: ei.plot || '', c: ei.movie_image || '',
                pos: rr ? Math.round(rr.pos) : 0, len: rr ? Math.round(rr.dur) : 0 };
            }) });
          });
          var out = { id: phoneId(it), n: it.name, c: inf.cover || it.cover || '', plot: inf.plot || it.plot || '', genre: inf.genre || '', cast: inf.cast || '', year: String(it.year || inf.releaseDate || '').slice(0, 4),
            r: stars(it.rating).replace('★ ', ''), seasons: seasons, mine: E().myList.indexOf(px + 's' + it.id) >= 0 };
          // What the provider leaves out, from TMDB when it is already known (series.js): no waiting here.
          var tv = typeof Series !== 'undefined' ? Series.show(it.name, it.year, 'strong') : null;
          if (tv) {
            out.c = out.c || tv.poster || ''; if (String(out.plot || '').length < 40) out.plot = tv.plot || out.plot; out.genre = out.genre || tv.genre || ''; out.cast = out.cast || tv.cast || ''; out.r = out.r || tv.rating || '';
            seasons.forEach(function (sn) { sn.eps.forEach(function (e) { var te = Series.episode(tv, sn.s, e.e); if (!te) return; e.t = e.t || te.t; if (!e.plot) e.plot = te.plot; e.c = e.c || te.still; }); });
          }
          return out;
        });
      });
    },
    play: function (k, id, ep, fromStart) {
      if (!phoneKind(k)) return Promise.reject(new Error('This playlist has no ' + (k === 'series' ? 'shows' : 'movies') + '.'));
      return load(k).then(function () {
        var it = byPhoneId(k, id);
        if (!it) throw new Error('That title is no longer in this playlist.');
        if (it.adult && !adultOpen()) throw new Error('That title is locked.  Open it on the TV with the PIN.');
        openItem({ it: it, kind: k, ep: ep || null, fromStart: !!fromStart });
        return { title: it.name };
      });
    }
  };

  return { _test: { catList: catList, itemsFor: itemsFor, catName: catName, trailerOf: trailerOf, tag: tag, view: view, done: done, mark: mark, isWatched: isWatched, openAt: openAt, renderItem: renderItem, itemMenu: itemMenu, markShow: markShow, withKind: withKind }, phone: ForPhone, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, allItems: allItems, openItem: openItem, prepare: prepare, get searchState() { return searchState(); }, offered: offered, reset: function () { gen++; data = { movie: null, series: null }; raw = { movie: null, series: null }; sets = { movie: {}, series: {} }; asking = { movie: null, series: null }; info.clear(); episodes = null; series = null; } };
})();
