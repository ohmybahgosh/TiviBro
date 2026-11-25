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
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{([a-z]+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var $ = U.$;
  var kind = 'movie', built = false, zone = 'items';
  var catsVL, itemsVL;
  var data = { movie: null, series: null };
  var raw = { movie: null, series: null };   // without the helper: the whole list, so a language change needs no reload
  var info = new Map();
  var episodes = null, series = null;      // drill-down into a show
  /* ---------- the show page (issue #110's P.S., like TiviMate's) ----------
     A show opens full screen: its backdrop and details at the top, its seasons as tabs, and the season's
     episodes as wide cards with their picture, progress and a ✓ when watched.  Up and Down move between the
     tabs and the cards, Left and Right along them, OK plays (or goes from a tab to its episodes), Hold OK has
     the episode's options and Back closes the show.  The season's episodes are itemsVL's items, so playing,
     the menu and Continue watching work as they did with the list. */
  var sp = null;        // { s: the show, rows: seasons, at: season index, zone: 'tabs'|'eps', loading }
  function seasonRows(eps) {
    var by = {}, order = [];
    eps.forEach(function (e) { if (!(e.season in by)) { by[e.season] = 0; order.push(e.season); } by[e.season]++; });
    return order.map(function (sn) { return { season: sn, name: +sn === 0 ? 'Specials' : 'Season ' + sn, count: by[sn] }; });
  }
  function seasonEps(sn) { return (episodes || []).filter(function (e) { return e.season === sn; }); }
  function pageBox() {
    var box = $('vodShow');
    if (!box) { box = U.el('div', 'shp-page'); box.id = 'vodShow'; $('viewVod').appendChild(box); }
    return box;
  }
  // Open the page on a show (loading, while its episodes come), or on an episode of the open one.
  function spStart(s) { sp = { s: s, rows: [], at: 0, zone: 'eps', loading: true }; $('viewVod').classList.add('show-on'); document.body.classList.add('vod-show-open'); spDraw(); }
  function showSeason(ep) {
    if (!episodes) return;
    if (!sp || sp.s !== series) sp = { s: series, rows: [], at: 0, zone: 'eps' };
    sp.loading = false; sp.rows = seasonRows(episodes);
    var sn = ep ? ep.season : sp.rows.length ? sp.rows[0].season : 0;
    sp.at = Math.max(0, sp.rows.findIndex(function (r) { return r.season === sn; }));
    var list = seasonEps(sn);
    itemsVL.setItems(list, Math.max(0, ep ? list.indexOf(ep) : 0));
    $('viewVod').classList.add('show-on'); document.body.classList.add('vod-show-open');
    spDraw();
  }
  function spClose() { var was = sp; sp = null; if (!was) return; var b = $('vodShow'); if (b) b.innerHTML = ''; if ($('viewVod')) $('viewVod').classList.remove('show-on'); document.body.classList.remove('vod-show-open'); }
  function spDraw() {
    if (!sp) return;
    var box = pageBox(), s = sp.s, tv = typeof Series !== 'undefined' ? Series.show(s.name, s.year, 'strong') : null;
    box.innerHTML = '';
    var bd = (tv && (tv.backdropHd || tv.backdrop)) || s.cover || '';
    if (bd) { var b = U.el('div', 'shp-bd'); b.style.backgroundImage = 'url("' + String(bd).replace(/"/g, '%22') + '")'; box.appendChild(b); }
    box.appendChild(U.el('div', 'shp-fade'));
    var info = U.el('div', 'shp-info');
    info.appendChild(U.el('div', 'media-kicker', 'Show'));
    info.appendChild(U.el('div', 'media-title', RAW(s.name)));
    var n = sp.rows.filter(function (r) { return +r.season !== 0; }).length;
    var facts = [s.year || (tv && tv.year), n ? n + (n === 1 ? ' season' : ' seasons') : '', episodes && episodes.length ? episodes.length + ' episodes' : '', stars(s.rating) || (tv && tv.rating ? '★ ' + tv.rating : ''), tv && tv.genre].filter(Boolean).join('   ·   ');
    if (facts) info.appendChild(U.el('div', 'media-facts', facts));
    var plot = s.plot && s.plot.length >= 40 ? s.plot : (tv && tv.plot) || s.plot || '';
    if (plot) info.appendChild(U.el('div', 'media-summary shp-plot', plot));
    var credit = U.tvdbCredit ? U.tvdbCredit(tv) : null; if (credit) info.appendChild(credit);
    // The show's trailer, like a movie's page: ▲ from the seasons, OK plays it.
    var trl = trailerOf(s);
    if (trl) { var tb = U.el('div', 'mmp-btn shp-trl' + (sp.zone === 'trl' ? ' sel' : ''), '▶  Trailer'); tb.onclick = function () { watchTrailer(trl); }; info.appendChild(tb); }
    else if (sp.zone === 'trl') sp.zone = 'tabs';
    box.appendChild(info);
    if (sp.loading) { box.appendChild(U.el('div', 'shp-empty', 'Loading episodes…')); return; }
    if (!episodes || !episodes.length) { box.appendChild(U.el('div', 'shp-empty', 'This show has no episodes from the provider.')); return; }
    // Season tabs: the picked one stays in view.
    var tabs = U.el('div', 'shp-tabs'), first = Math.max(0, Math.min(sp.at - 3, sp.rows.length - 7));
    sp.rows.slice(first, first + 7).forEach(function (r, i) {
      var t = U.el('div', 'shp-tab' + (first + i === sp.at ? ' on' : '') + (sp.zone === 'tabs' && first + i === sp.at ? ' sel' : ''), r.name);
      t.onclick = function () { spSeason(first + i); sp.zone = 'eps'; spDraw(); };
      tabs.appendChild(t);
    });
    if (first > 0) tabs.insertBefore(U.el('div', 'shp-more', '‹'), tabs.firstChild);
    if (first + 7 < sp.rows.length) tabs.appendChild(U.el('div', 'shp-more', '›'));
    box.appendChild(tabs);
    // The season's episodes as cards, the focused one in view, only those near it drawn.
    var list = itemsVL.items, sel = itemsVL.sel, track = U.el('div', 'shp-track'), from = Math.max(0, sel - 2), to = Math.min(list.length, from + 8);
    var shown = tv;
    for (var i = from; i < to; i++) (function (e, i) {
      var id = idOf(e), r = resumeOf(id), w = isWatched(id), te = shown ? Series.episode(shown, e.season, e.num) : null;
      var spoil = !!(Store.settings.noSpoilers && !w && !r);
      var pic = spoil ? s.cover : (e.cover && e.cover !== s.cover ? e.cover : (te && te.still) || e.cover || s.cover);
      var c = U.el('div', 'shp-card' + (sp.zone === 'eps' && i === sel ? ' sel' : '')), art = U.el('div', 'shp-art');
      if (pic) { var img = U.el('img', 'shp-pic' + (pic === s.cover ? ' cover' : '')); img.decoding = 'async'; img.src = pic; img.onerror = function () { if (!Net.retryImage(this, true)) this.remove(); }; art.appendChild(img); }
      art.appendChild(U.el('span', 'shp-num', 'E' + (e.num || '?')));
      if (w && !r) art.appendChild(U.el('span', 'shp-done', '✓'));
      if (r && r.dur) { var bar = U.el('div', 'shp-bar'), fill = U.el('i'); fill.style.width = Math.min(100, Math.round(100 * r.pos / r.dur)) + '%'; bar.appendChild(fill); art.appendChild(bar); }
      c.appendChild(art);
      // The provider's own title always; TMDB's only once you've watched it, with Hide spoilers on.
      var t = e.label.replace(/^S\d+ E[\d?]+\s*/, '').trim() || (!spoil && te && te.t) || '';
      c.appendChild(U.el('div', 'shp-name', t || 'Episode ' + (e.num || '?')));
      var sub = [niceDur(e.dur), te && te.air ? new Date(te.air + 'T12:00:00').toLocaleDateString(U.loc ? U.loc() : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''].filter(Boolean).join('   ·   ');
      if (sub) c.appendChild(U.el('div', 'shp-sub', sub));
      c.onclick = function () { sp.zone = 'eps'; itemsVL.setItems(list, i); onItem(); play(e, false); };
      track.appendChild(c);
    })(list[i], i);
    box.appendChild(track);
    // The focused episode's summary under the cards.
    var cur = itemsVL.current();
    if (cur && sp.zone === 'eps') {
      var cte = shown ? Series.episode(shown, cur.season, cur.num) : null, cspoil = !!(Store.settings.noSpoilers && !isWatched(idOf(cur)) && !resumeOf(idOf(cur)));
      var own = cur.plotEp || '', cp = cspoil ? 'Summary hidden until you watch it (Hide spoilers is on).' : own.length >= 40 ? own : (cte && cte.plot) || own;
      var foot = U.el('div', 'shp-foot');
      foot.appendChild(U.el('b', '', 'S' + cur.season + ' E' + (cur.num || '?') + '   '));
      foot.appendChild(document.createTextNode(cp || whereOf(cur) || ''));
      box.appendChild(foot);
    }
    box.appendChild(U.el('div', 'shp-pos', (sel + 1) + ' of ' + list.length + '   ·   ' + (sp.rows[sp.at] ? sp.rows[sp.at].name : '')));
  }
  function spSeason(i) {
    if (!sp || !sp.rows[i]) return;
    sp.at = i;
    var list = seasonEps(sp.rows[i].season), r = E().resume, at = 0;
    // On the season's next episode to watch, as the show opens on.
    for (var j = list.length - 1; j >= 0; j--) { var x = r[idOf(list[j])]; if (x && !finished(x.pos, x.dur)) { at = j; break; } if (x || isWatched(idOf(list[j]))) { at = Math.min(j + 1, list.length - 1); break; } }
    itemsVL.setItems(list, at); onItem();
  }
  function spKeys(a) {
    if (a === 'back') { closeSeries(); if (showFromHome) toHome(); return true; }
    if (a === 'green') { if (homeOn()) toHome(); else Views.switchTab('guide'); return true; }
    if (a === 'blue') { Views.switchTab('settings'); return true; }
    if (!sp || sp.loading || !episodes || !episodes.length) return true;
    if (sp.zone === 'trl') {
      if (a === 'down') sp.zone = 'tabs';
      else if (a === 'ok') { watchTrailer(trailerOf(sp.s)); return true; }
    } else if (sp.zone === 'tabs') {
      if (a === 'up' && trailerOf(sp.s)) sp.zone = 'trl';
      else if (a === 'left' && sp.at > 0) spSeason(sp.at - 1);
      else if (a === 'right' && sp.at < sp.rows.length - 1) spSeason(sp.at + 1);
      else if (a === 'down' || a === 'ok') sp.zone = 'eps';
    } else {
      var n = itemsVL.items.length, i = itemsVL.sel;
      if (a === 'left') { if (i > 0) { itemsVL.setItems(itemsVL.items, i - 1); onItem(); } }
      else if (a === 'right') { if (i < n - 1) { itemsVL.setItems(itemsVL.items, i + 1); onItem(); } }
      else if (a === 'chup' || a === 'chdown') { itemsVL.setItems(itemsVL.items, Math.max(0, Math.min(n - 1, i + (a === 'chup' ? -5 : 5)))); onItem(); }
      else if (a === 'up') sp.zone = 'tabs';
      else if (a === 'ok') { var it = itemsVL.current(); if (it) play(it, false); }
      else if (a === 'red' || a === 'hold' || a === 'info') { itemMenu(itemsVL.current()); return true; }
      else if (a === 'yellow') { quickMark(itemsVL.current()); return true; }
    }
    spDraw(); hints();
    return true;
  }
  var homeMode = false, showFromHome = false, opens = 0;   // the home with poster shelves (vodhome.js) is on screen; a show was opened from it
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
  function finished(pos, dur) { return (U.isWatchedAt || function (p, d) { return d > 0 && (p >= d * 0.9 || p > d - 60); })(pos, dur); }
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
    if (old && old.browse) return Promise.resolve(old);          // a big portal browsed by category stays so
    var rk = raw[k] && raw[k][p.id];
    if (rk && again) return Promise.resolve(view(k, rk, p));
    // A Stalker portal: how big first.  Over BIG titles it's browsed by category, not read whole (issue #118).
    if (p.type === 'stalker' && helped(p) && sources(k).length <= 1) {
      var fresh = wantFresh(k, p);
      return (fresh ? Promise.resolve(null) : Store.bigGet(browseKey(k, p)).catch(function () { return null; })).then(function (c) {
        var kept = keptBrowse(k, p, c);
        if (kept) { if (kept.stale) refreshBrowse(k, p, kept); return kept; }
        return U.getJSON(Source.api(p, 'count', '&kind=' + k), 30000).then(function (j) {
          var n = +(j && j.total) || 0;
          return n > bigPortal() ? browse(k, p, n).then(function (d) { saveBrowse(k, d); return d; }) : full();
        }, function () { return full(); });
      });
    }
    return full();
    function full() {
    if (helped(p)) {
      return fromHelper(k, p).then(function (d) {
        /* None at all from the helper (before any filter): get the list here once instead, as without the helper.
           A helper that kept an empty list from a provider's outage showed "Nothing" for days (issue #110; the idea
           and a tested patch came from abada89).  A list hidden by filters (total > 0) is left alone. */
        if (!Source.m3uVod(p) && !(+d.total) && !d.items.length) {
          Log.warn('vod', 'The helper has no ' + (k === 'series' ? 'shows' : 'movies') + ' for this playlist; loading the list here');
          return own(k, p, true).then(function (o) { return o && o.items && o.items.length ? o : d; }, function () { return d; });
        }
        Store.idbSet(cacheKey(k, p), null);         // an older copy in the browser's storage: not needed now
        return d;
      }, function (e) {
        if (Source.m3uVod(p)) throw e;               // an M3U list's library lives with the helper only
        if (p.type === 'stalker') throw e;           // a portal's titles come through the helper anyway (issue #118)
        Log.warn('vod', 'The helper could not give the ' + (k === 'series' ? 'show' : 'movie') + ' list (' + (e && e.message || e) + '), loading it here');
        return own(k, p);
      });
    }
    if (Source.m3uVod(p)) return Promise.reject(new Error('Movies and shows from an M3U list need the network helper.'));
    return own(k, p);
    }
  }
  /* ---------- a big portal, browsed by category (issue #118) ----------
     A Stalker portal sends a dozen titles a page: 233,000 shows would take hours to read and more memory than a
     TV has.  So, as other players do: its categories at once, the newest titles (Recently added, the home),
     and a category's titles when you open it (its newest CAT_MAX), kept while you browse. */
  var RECENT_MAX = 300, CAT_MAX = 2000;
  function bigPortal() { return +Store.settings.portalBrowseOver || (window.Player && Player.memSafe ? 20000 : 40000); }   // the setting: tests only
  function browse(k, p, total) {
    var action = k === 'series' ? 'get_series' : 'get_vod_streams';
    Log.info('vod', 'A big portal: ' + total + ' ' + (k === 'series' ? 'shows' : 'movies') + ', so they are browsed by category');
    var stop = watchPortal(k, p);
    return Promise.all([Source.vodCats(k, p), U.getJSON(Source.api(p, action, '&max=' + RECENT_MAX), 10 * 60000)]).then(function (r) {
      stop();
      var cats = (r[0] || []).map(function (x) { return { id: String(x.category_id), name: x.category_name || 'Other' }; });
      var adultCat = {}; cats.forEach(function (c) { if (VodView.ADULT.test(c.name)) adultCat[c.id] = 1; });
      var items = rowsOf(k, r[1] || [], adultCat);
      return { browse: true, p: p, at: Date.now(), cats: cats, items: items, recent: items.slice(), langs: {}, keep: null, total: total, adultCat: adultCat, catItems: {}, catOrder: [] };
    }, function (e) { stop(); throw e; });
  }
  /* A big portal's categories, newest titles and the categories read so far, kept on the TV (issue #118: "after
     the update all movies and series scanning again").  Used again for as long as the playlist's refresh says
     (a day when it has none), unless the playlist was just loaded again from the provider. */
  function browseKey(k, p) { return 'vodbrowse:' + String(p.id).replace(/[^A-Za-z0-9_-]/g, '') + ':' + k; }
  function browseAge(p) { var h = +p.plRefresh; return (h > 0 ? h : 24) * 3600e3; }
  /* Past that age the copy is still used (issue #173: "after an update it starts scanning all over again"): its
     categories and newest titles are read again behind it (refreshBrowse), and the categories already read
     stay.  Only a copy older than a week, or from a playlist that changed, starts over. */
  var BROWSE_KEEP = 7 * 24 * 3600e3;
  function keptBrowse(k, p, c) {
    if (!c || c.v !== 1 || c.sig !== Source.sig(p) || !Array.isArray(c.cats) || !(Date.now() - c.at < BROWSE_KEEP)) return null;
    var items = (c.recent || []).slice(), have = {};
    items.forEach(function (it) { have[it.id] = 1; });
    (c.catOrder || []).forEach(function (cid) { (c.catItems[cid] || []).forEach(function (it) { if (!have[it.id]) { have[it.id] = 1; items.push(it); } }); });
    Log.info('vod', 'A big portal: its ' + (k === 'series' ? 'shows' : 'movies') + ' as kept on the TV (' + Math.round((Date.now() - c.at) / 60000) + ' min old), no new read');
    return { browse: true, p: p, at: c.at, cats: c.cats, items: items, recent: c.recent || [], langs: {}, keep: null, total: c.total, adultCat: c.adultCat || {}, catItems: c.catItems || {}, catOrder: c.catOrder || [], stale: !(Date.now() - c.at < browseAge(p)) };
  }
  /* A stale copy's categories and newest titles, read again a minute after it's shown (so the start isn't
     slowed), and put into it: new titles come in, the categories read before stay as they were. */
  function refreshBrowse(k, p, d) {
    d.stale = false;
    setTimeout(function () {
      browse(k, p, d.total).then(function (f) {
        var have = {};
        d.items.forEach(function (it) { have[it.id] = 1; });
        d.cats = f.cats; d.adultCat = f.adultCat; d.recent = f.recent; d.at = f.at;
        f.recent.forEach(function (it) { if (!have[it.id]) { have[it.id] = 1; d.items.unshift(it); } });
        saveBrowse(k, d);
        Log.info('vod', 'A big portal: its ' + (k === 'series' ? 'shows' : 'movies') + ' categories and newest titles read again');
      }, function (e) { Log.warn('vod', 'A big portal: reading its categories again failed: ' + (e && e.message || e)); });
    }, 60000);
  }
  var saveT = {};
  function saveBrowse(k, d) {
    if (!d || !d.browse || !d.p) return;
    var key = browseKey(k, d.p);
    clearTimeout(saveT[key]);
    saveT[key] = setTimeout(function () {
      var ci = {}, order = d.catOrder.filter(function (cid) { return Array.isArray(d.catItems[cid]); });
      order.forEach(function (cid) { ci[cid] = d.catItems[cid]; });
      Store.bigSet(key, { v: 1, sig: Source.sig(d.p), at: d.at, cats: d.cats, recent: d.recent, total: d.total, adultCat: d.adultCat, catItems: ci, catOrder: order });
    }, 3000);
  }
  // Xtream-shaped titles from the helper to the app's own items.
  function rowsOf(k, list, adultCat) {
    return (list || []).map(function (x) {
      var it = k === 'series'
        ? seriesRow([x.series_id, x.name || '', x.cover || '', String(x.plot || '').slice(0, 300), x.rating || '', (x.releaseDate || x.release_date || '').slice(0, 4), String(x.category_id), +x.last_modified || 0, ytId(x.youtube_trailer || x.trailer)])
        : movieRow([x.stream_id, x.name || '', x.stream_icon || '', x.rating || '', x.container_extension || 'mp4', String(x.category_id), +x.added || 0]);
      if (adultCat && adultCat[it.cat]) it.adult = 1;
      return it;
    });
  }
  // A category's titles, once (the newest CAT_MAX); shown when they come if it's still the one picked.
  function browseCat(d, k, cid) {
    if (d.catItems[cid] || d.catItems[cid] === null) return;
    d.catItems[cid] = null;                                   // being read
    var stop = watchPortal(k, d.p);
    U.getJSON(Source.api(d.p, k === 'series' ? 'get_series' : 'get_vod_streams', '&category_id=' + encodeURIComponent(cid) + '&max=' + CAT_MAX), 15 * 60000).then(function (list) {
      stop();
      var items = rowsOf(k, list, d.adultCat);
      d.catItems[cid] = items; d.catOrder.push(cid);
      // Kept for My list, Continue watching and Search too, within what this TV holds (the oldest category read goes first).
      var have = {}; d.items.forEach(function (it) { have[it.id] = 1; });
      items.forEach(function (it) { if (!have[it.id]) d.items.push(it); });
      while (d.items.length > vodMax() && d.catOrder.length > 1) {
        var gone = d.catOrder.shift(), drop = {}; (d.catItems[gone] || []).forEach(function (it) { drop[it.id] = 1; });
        delete d.catItems[gone];
        d.items = d.items.filter(function (it) { return !drop[it.id] || d.recent.indexOf(it) >= 0; });
      }
      saveBrowse(k, d);
      Log.info('vod', 'Category ' + cid + ': ' + items.length + (items.length >= CAT_MAX ? ' (the newest ' + CAT_MAX + ')' : '') + ' ' + (k === 'series' ? 'shows' : 'movies'));
      if (kind === k && data[k] === d && catsVL) {
        var c = catsVL.current(), cl = catList();
        catsVL.setItems(cl, Math.max(0, cl.findIndex(function (x) { return c && x.id === c.id; })));
        if (c && c.id === cid && zone !== 'items') { itemsVL.empty = 'Nothing here'; itemsVL.setItems(itemsFor(cid), 0); onItem(); }
      }
    }, function (e) {
      stop(); delete d.catItems[cid];
      if (kind === k && data[k] === d) { itemsVL.empty = 'Could not load this category: ' + (e && e.message || e); itemsVL.refresh(); }
    });
  }
  /* The playlist was loaded again from the provider (when TiviBro starts, on its schedule, or Reload channels
     now): its movies and shows are fetched again too, once each.  Before, a playlist set to reload at every
     start (or only when asked) kept the first movie list it ever got (issue #110). */
  var freshAt = 0, freshDone = {};
  function wantFresh(k, p) { var key = k + ':' + p.id; if (!freshAt || freshDone[key] >= freshAt) return false; freshDone[key] = freshAt; return true; }
  function fromHelper(k, p) {
    var t0 = Date.now(), body = listBody(k, p, wantFresh(k, p)), portal = p.type === 'stalker';
    // A Stalker portal sends a dozen titles a page: a big one takes minutes the first time (issue #118), so wait, and say how far it has come.
    var stop = portal ? watchPortal(k, p) : function () {};
    return postJSON('http://127.0.0.1:' + Net.port + '/vod/list', body, portal ? 30 * 60000 : 240000).then(function (j) {
      stop();
      return gotList(k, p, j, t0);
    }, function (e) { stop(); throw e; });
  }
  /* "Loading movies from the portal: 4,200 of 34,384": on the Movies or Shows screen while it waits, and in the
     corner (activity.js) on every other screen, from the helper's count (stalker.js /stalker/progress). */
  var loadingNow = {};
  function watchPortal(k, p) {
    var id = 'portal-' + k, what = k === 'series' ? 'shows' : 'movies', stopped = false, timer = null;
    var fmt = function (n) { return Number(n).toLocaleString(); };
    function say(t, short) {
      loadingNow[k] = t;
      if (typeof Activity !== 'undefined') Activity.set(id, short || '');
      if (kind === k && (!data[k] || (data[k].browse && !itemsVL.items.length))) {
        if (itemsVL) { itemsVL.empty = t || 'Loading…'; itemsVL.refresh(); }
        var sum = document.querySelector('#vodHomeInfo .media-summary'); if (sum) sum.textContent = t || I18n.t('Loading…');
      }
    }
    function tick() {
      if (stopped) return;
      U.getJSON('http://127.0.0.1:' + Net.port + '/stalker/progress?stb=' + Source.stb(p), 5000).then(function (j) {
        if (stopped) return;
        var x = j && (k === 'series' ? j.series || j.movie : j.movie);
        if (!x || x.done || !(x.total > 0)) return;
        var short = I18n.t('Loading {x} from the portal', { x: I18n.t(what) }) + ': ' + I18n.t('{x} of {y}', { x: fmt(Math.min(x.got, x.total)), y: fmt(x.total) });
        say(short + (x.secs > 20 ? '.  ' + I18n.t('A big portal takes a few minutes the first time.') : ''), short);
      }, function () {}).then(function () { if (!stopped) timer = setTimeout(tick, 3000); });
    }
    timer = setTimeout(tick, 1500);
    return function () { stopped = true; clearTimeout(timer); say(''); };
  }
  // What /vod/list and /vod/find are asked with: the playlist's list, and what of it shows.
  function listBody(k, p, again) {
    var h = +p.plRefresh;
    return Source.m3uVod(p) ? { pl: p.id, sig: Source.sig(p), kind: k, m3u: 1, picked: prefs(p).langs, navLang: navigator.language, hidden: hiddenCats(k, p) } : {
      pl: p.id, sig: Source.sig(p), kind: k, maxAge: h > 0 ? h * 3600e3 : 0, refresh: again,
      u: Net.wrap(Source.api(p, k === 'series' ? 'get_series' : 'get_vod_streams'), { pl: p }),
      uc: Net.wrap(Source.api(p, k === 'series' ? 'get_series_categories' : 'get_vod_categories'), { pl: p }),
      picked: prefs(p).langs, navLang: navigator.language, hidden: hiddenCats(k, p)
    };
  }
  function rowItem(k, r) {
    var base = k === 'series' ? 8 : 7, it = (k === 'series' ? seriesRow : movieRow)(r);
    it.lang = r[base] || ''; if (r[base + 1]) it.q = r[base + 1]; if (r[base + 2]) it.adult = 1; if (r[base + 3]) it.p = r[base + 3];
    return it;
  }
  function gotList(k, p, j, t0) {
      if (!j || !Array.isArray(j.rows)) throw new Error((j && j.error) || 'no list');
      var items = j.rows.map(function (r) { return rowItem(k, r); });
      Log.info('vod', 'The helper gave ' + items.length + ' of ' + j.total + ' ' + (k === 'series' ? 'shows' : 'movies') + (p.id !== Store.playlist.id ? ' of ' + (p.name || 'another playlist') : '') + ' in ' + (Date.now() - t0) + ' ms');
      return { at: j.at, cats: j.cats, items: items, langs: j.langs, keep: j.keep, total: j.total, adultCat: j.adultCat };
  }
  /* Search on a TV short of memory (issue #116): the movie and show lists not loaded yet are searched by the
     helper (/vod/find), which hands over only the titles with every word, instead of the app holding every
     title (30,000 movies and 11,000 shows closed a 1 GB TV).  Lists already loaded are searched here. */
  // How many titles each list has (Memwatch: lists big for the TV's memory), whether loaded here or only searched.
  var sizes = {};
  /* How many movies and shows a playlist has, as far as TiviBro knows (discussion #134): the list it has, or what
     the helper said when it searched it.  null for a kind not loaded yet. */
  function countsFor(pid) {
    var out = {};
    ['movie', 'series'].forEach(function (k) {
      var d = sets[k] && sets[k][pid];
      out[k] = d ? (+d.total || d.items.length) : (sizes[k + ':' + pid] != null ? sizes[k + ':' + pid] : null);
    });
    return out;
  }
  function titleCount() {
    var n = 0;
    ['movie', 'series'].forEach(function (k) { if (data[k]) n += data[k].items.length; else Object.keys(sizes).forEach(function (x) { if (x.indexOf(k + ':') === 0) n += sizes[x]; }); });
    return n;
  }
  function lean() {
    if (!(window.Player && Player.memSafe) || !(Net.info && Net.info.vod >= 3)) return false;
    var ks = offered().filter(function (k) { return !data[k]; });
    return ks.length > 0 && ks.every(function (k) { var ps = sources(k); return ps.length > 0 && ps.every(function (p) { return helped(p) && p.type !== 'stalker'; }); });   // a portal: loaded (or browsed by category, issue #118), never read whole to search
  }
  function findRemote(text) {
    var words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    var ks = offered().filter(function (k) { return !data[k]; }), out = [];
    return Promise.all(ks.map(function (k) {
      return Promise.all(sources(k).map(function (p, n) {
        var body = listBody(k, p, false); body.words = words; body.max = 200;
        return postJSON('http://127.0.0.1:' + Net.port + '/vod/find', body, 120000).then(function (j) {
          if (j && j.of) sizes[k + ':' + p.id] = j.of;
          (j && j.rows || []).forEach(function (r) { var it = rowItem(k, r); if (n) it.pl = p.id; out.push({ it: it, kind: k }); });
        }, function (e) { Log.warn('vod', 'Search through the helper: ' + (e && e.message || e)); });
      }));
    })).then(function () { return out; });
  }
  // Without the helper: the full list is cached in the browser's storage and kept in memory.
  // force: ask the provider even when a copy is kept (the helper had none).  An empty copy is never kept as fresh.
  function own(k, p, force) {
    var ck = cacheKey(k, p);
    function keepRaw(c) { (raw[k] || (raw[k] = {}))[p.id] = c; return view(k, c, p); }
    return Store.idbGet(ck).then(function (c) {
      var h = +p.plRefresh, fresh = !force && c && c.v === 3 && c.items && c.items.length && !wantFresh(k, p) && (h <= 0 || Date.now() - c.at < h * 3600e3);
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
  function seriesRow(x) { return ({ id: x[0], name: x[1], cover: x[2], plot: x[3], rating: x[4], year: x[5], cat: x[6], added: x[7], trailer: x[8] || '' }); }
  // A YouTube id from what a provider sends: the id itself or a whole YouTube link.
  function ytId(v) { var yt = String(v || '').trim(), m = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/.exec(yt); return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(yt) ? yt : ''; }
  function fetchItems(k, p) {
    var api = Source.api(p, k === 'series' ? 'get_series' : 'get_vod_streams');
    function direct() {
      return Source.vodList(k, p).then(function (list) {
        return (list || []).map(function (x) {
          return k === 'series'
            ? seriesRow([x.series_id, x.name || '', x.cover || '', String(x.plot || '').slice(0, 300), x.rating || '', (x.releaseDate || x.release_date || '').slice(0, 4), String(x.category_id), +x.last_modified || 0, ytId(x.youtube_trailer || x.trailer)])
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
      onItem(); homeChanged();
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
    if (!c || c.head || c.folder || c.up) return;
    // Hidden by the category's own playlist (several playlists on).
    var home = catHome(c.id), p = prefs(home.p), h = p.hide || (p.hide = {}), list = h[kind] || (h[kind] = []);
    var items = [];
    if (c.id !== CW && c.id !== MY && c.id !== ALL && c.id !== NEW && c.id !== LANGS) {
      if (homeOn()) items.push({ label: 'Pin to the ' + (kind === 'series' ? 'Shows' : 'Movies') + ' home', sub: 'a shelf of its own on the home screen', action: function () { if (VodHome.pin(c.id)) U.toast(c.name + ' is a shelf on the home now'); else U.toast(c.name + ' is already on the home'); } });
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
  // Each category's name as shown: cleaned by the name rules, unless that makes it the same as another's (then the provider's own).
  function catLabels(d) {
    if (d._labels) return d._labels;
    var clean = {}, same = {}, out = {}, key = function (c) { return (c.pl || '') + '|' + String(clean[c.id]).toLowerCase(); };
    d.cats.forEach(function (c) { clean[c.id] = cleanCat(c.name, c.pl); same[key(c)] = (same[key(c)] || 0) + 1; });
    d.cats.forEach(function (c) { out[c.id] = same[key(c)] > 1 ? c.name : clean[c.id]; });
    return (d._labels = out);
  }
  function cleanCat(n, pl) { var p = pl && Store.byId ? Store.byId(pl) : null; return p && p.names ? Names.cleanGroupWith(p.names, n) : Names.cleanGroup(n); }

  function renderCat(row, c) {
    if (!row._n) { row._n = U.el('span', 'name'); row._t = U.el('span', 'tag'); var b = U.el('div', 'txt'); b.appendChild(row._n); row.appendChild(b); row.appendChild(row._t); }
    row.classList.toggle('ghead', !!c.head);                    // a playlist's heading (several playlists on)
    row._n.textContent = c.name; row._t.textContent = c.count != null ? String(c.count) : '';
  }
  function renderItem(row, it) {
    if (!row._n) {
      row._img = U.el('img', 'poster'); row._img.decoding = 'async'; row._img.onerror = function () { if (!Net.retryImage(this, true)) this.style.visibility = 'hidden'; };
      var b = U.el('div', 'txt'); row._n = U.el('span', 'name'); row._s = U.el('span', 'sub'); row._p = U.el('div', 'pbar'); row._pi = U.el('i'); row._p.appendChild(row._pi);
      b.appendChild(row._n); b.appendChild(row._s); b.appendChild(row._p);
      row._t = U.el('span', 'tag');
      row.appendChild(row._img); row.appendChild(b); row.appendChild(row._t);
    }
    var img = it.cover || '';
    if (row._src !== img) { row._src = img; row._img.style.visibility = img ? 'visible' : 'hidden'; row._img._tries = 0; if (img) row._img.src = img; else row._img.removeAttribute('src'); }
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

  /* A big portal lists every category under Movies and Shows alike, and one is only known to be empty here once
     it's been read (issue #173: "series folders in Movies", read for a minute to show 0).  One that looks like the
     other kind goes to the end, under Probably shows / Probably movies, until it's opened: its name says so
     ("HINDI SERIES", "WEB SERIES", "DIZI"), or it has titles in the other list already. */
  var SHOWISH = /\b(series|serie|serial|serials|shows?|tv\s?shows?|web\s?series|dizi|dizileri|novelas?|seasons?|episodes?|s[eé]ries)\b/i;
  var MOVIEISH = /\b(movies?|films?|cinema|kino|filmes?|pel[ií]culas?)\b/i;
  function otherKind(d, c) {
    if (!d.browse || d.catItems[c.id]) return false;                  // read: its own count says
    var o = data[kind === 'series' ? 'movie' : 'series'];
    if (o && o.browse && o.catItems && o.catItems[c.id] && o.catItems[c.id].length) return true;
    return nameSays(kind === 'series' ? 'movie' : 'series', c.name);
  }
  // The category's name says it's this kind only ("WEB SERIES" for series, "HINDI MOVIES" for movie).
  function nameSays(k, name) { var n = String(name || ''); return k === 'series' ? SHOWISH.test(n) && !MOVIEISH.test(n) : MOVIEISH.test(n) && !SHOWISH.test(n); }
  /* A category's language from its name, for a big portal's headings (issue #173: "by language folder"):
     "HINDI | MOVIES", "TAMIL SERIES", "|EN| ...", "DE - ...".  '' when the name doesn't say. */
  var LANG_WORDS = /^\W*(hindi|english|tamil|telugu|malayalam|kannada|marathi|bengali|bangla|gujarati|punjabi|urdu|odia|nepali|sinhala|arabic|turkish|persian|farsi|kurdish|spanish|french|german|italian|portuguese|dutch|polish|russian|ukrainian|romanian|greek|albanian|serbian|croatian|bosnian|bulgarian|hungarian|czech|swedish|norwegian|danish|finnish|korean|japanese|chinese|thai|vietnamese|filipino|tagalog|indonesian|malay)\b/i;
  function catLang(name) {
    var n = String(name || ''), w = LANG_WORDS.exec(n);
    if (w) return w[1].charAt(0).toUpperCase() + w[1].slice(1).toLowerCase();
    var m = /^\s*[|\[]\s*([A-Za-z]{2,4})\s*[|\]]/.exec(n) || /^\s*([A-Z]{2,3})\s*(?:[|:]|\s[-–])\s/.exec(n);
    var code = m && m[1].toUpperCase();
    return code && VodView.known(code) ? VodView.langName(code) : '';
  }
  // A big portal's categories by language, each language where its first category was, with a heading each.
  function byLang(cats) {
    var groups = [], at = {};
    cats.forEach(function (c) { var l = catLang(c.name); if (at[l] === undefined) { at[l] = groups.length; groups.push({ l: l, cats: [] }); } groups[at[l]].cats.push(c); });
    if (groups.filter(function (g) { return g.l && g.cats.length > 1; }).length < 2) return cats;
    var out = [];
    groups.forEach(function (g) { if (g.l) out.push({ id: '@lang:' + g.l, head: true, name: g.l }); else if (out.length) out.push({ id: '@lang:', head: true, name: I18n.t('Other categories') }); out = out.concat(g.cats); });
    return out;
  }
  /* Folders by language (Settings > Movies and shows > Categories by language, off at first; issue #173: "separate
     folders for movies and TV shows based on language").  The language headings above, each turned into one row that
     opens its categories, with a row back to every language.  Only rows change: nothing more is read or kept, so a
     1 GB TV with a 60,000-title portal is no worse off.  The open folder is kept per kind, like the category. */
  var FOLDER = '@folder:', UP = '@up';
  function folderOpen() { try { return localStorage.getItem('tivibro.vodFolder.' + kind) || ''; } catch (e) { return ''; } }
  function setFolder(f) { try { if (f) localStorage.setItem('tivibro.vodFolder.' + kind, f); else localStorage.removeItem('tivibro.vodFolder.' + kind); } catch (e) {} }
  function foldersOn() { return !!Store.settings.vodLangFolders && Store.settings.vodCatSort !== 'name'; }
  // The categories (after byLang) as folders, or one folder's categories when it's open.
  function inFolders(cats) {
    if (!cats.some(function (c) { return c.head; })) return cats;     // no languages found: the plain list
    var groups = [], g = null;
    cats.forEach(function (c) { if (c.head) { g = { name: c.name, cats: [] }; groups.push(g); } else if (g) g.cats.push(c); });
    var open = folderOpen(), mine = groups.filter(function (x) { return x.name === open; })[0];
    if (mine) return [{ id: UP, name: '‹ ' + I18n.t('Every language'), up: true }].concat(mine.cats);
    return groups.map(function (x) { return { id: FOLDER + x.name, name: x.name, folder: x.name, count: x.cats.length }; });
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
    if (d.browse) out.push({ id: ALL, name: kind === 'series' ? 'Newest shows' : 'Newest movies', count: d.recent.filter(function (it) { return !it.adult; }).length });
    else out.push({ id: ALL, name: kind === 'series' ? 'All shows' : 'All movies', count: d.items.filter(function (it) { return !it.adult; }).length });
    // Recently added (discussion #60): the newest titles across every category, when the provider says when each was added.
    var fresh = recentList().length;
    if (fresh) out.push({ id: NEW, name: 'Recently added', count: fresh });
    var hid = {}; vodPls().forEach(function (q, n) { hiddenCats(kind, q).forEach(function (c) { hid[(n && d.multi ? q.id + ':' : '') + c] = 1; }); });
    var later = [], section = null;
    /* The name rules take "HINDI | " off a category, which on a big provider leaves "UPCOMING MOVIES" four
       times, one per language (issue #118).  Names that would come out the same keep the provider's own. */
    var labels = catLabels(d), cats = d.cats;
    // Settings > Movies and shows > Order categories: by name (each playlist's own, several playlists on).
    if (Store.settings.vodCatSort === 'name') cats = d.cats.slice().sort(function (a, b) { return d.multi && (a.pl || '') !== (b.pl || '') ? 0 : String(labels[a.id] || a.name).localeCompare(String(labels[b.id] || b.name), undefined, { sensitivity: 'base', numeric: true }); });
    var elsewhere = [];
    // A big portal by language, when its category names say (no playlist headings then: one portal).
    if (!d.multi && Store.settings.vodCatSort !== 'name' && (d.browse || foldersOn())) cats = byLang(cats);
    if (!d.multi && foldersOn()) cats = inFolders(cats);
    cats.forEach(function (c) {
      if (c.head || c.folder || c.up) { out.push(c); return; }
      if ((!counts[c.id] && !d.browse) || hid[c.id]) return;
      /* A big portal lists every category under both Movies and Shows (issue #118: "ENGLISH | SERIES" in Movies, with
         0 movies, its shows in Shows only): one found empty leaves the list, unless it's the one you're on. */
      if (d.browse && d.catItems[c.id] && !d.catItems[c.id].length && !(catsVL && catsVL.current() && catsVL.current().id === c.id)) return;
      var name = labels[c.id];
      // A big portal browsed by category: every category, its count once it's been opened.
      var n = d.browse ? (d.catItems[c.id] ? d.catItems[c.id].length : '') : counts[c.id];
      var adult = !!(d.adultCat && d.adultCat[c.id]), row = { id: c.id, name: name, count: n, adult: adult, pl: c.pl || '' };
      if (adult) { later.push(row); return; }
      if (otherKind(d, c) && !(catsVL && catsVL.current() && catsVL.current().id === c.id)) { elsewhere.push(row); return; }
      // Several playlists: a heading with the playlist's name above its categories.
      if (d.multi && (c.pl || '') !== section) { section = c.pl || ''; var pp = section ? Store.byId(section) : Store.playlist; out.push({ id: '@' + (section || 'first'), head: true, name: (pp && pp.name) || 'Playlist' }); }
      out.push(row);
    });
    // A heading left with nothing under it (its categories hidden, empty or elsewhere) goes.
    out = out.filter(function (r, i) { return !r.head || (out[i + 1] && !out[i + 1].head); });
    if (elsewhere.length) out = out.concat([{ id: '@elsewhere', head: true, name: kind === 'series' ? I18n.t('Probably movies') : I18n.t('Probably shows') }], elsewhere);
    out = out.concat(later);
    return out;
  }
  function continueList() {
    var d = data[kind]; if (!d) return [];
    var r = E().resume, out = [];
    d.items.forEach(function (it) { var x = r[key(it)]; if (x && x.pos > 60 && !finished(x.pos, x.dur)) out.push({ it: it, at: x.at }); });
    return out.sort(function (a, b) { return b.at - a.at; }).map(function (x) { return x.it; });
  }
  /* A category as a full-screen wall of posters (Hitesh, issue #118).  On a big portal a category not read yet is
     read first (up to a minute); Back on the wall comes back here, on the same category. */
  function asWall(c) {
    var d = data[kind], k = kind, tries = 0;
    (function when() {
      var list = itemsFor(c.id);
      if (!list.length && d && d.browse && d.catItems[c.id] === null && tries++ < 200 && data[k] === d) {
        if (tries === 1) U.toast('Loading ' + c.name + '…');
        return setTimeout(when, 300);
      }
      if (kind !== k || !catsVL || catsVL.current() !== c) return;
      if (!list.length) { itemsVL.empty = 'Nothing here'; itemsVL.setItems([], 0); setZone('items'); return; }
      homeMode = true; showFromHome = false;
      VodHome.wallOf(k, homeApi, c, list, function () {
        homeMode = false; VodHome.hide(); UI.setHandler(keys);
        // Back on the same category (opening a show from the wall builds the list again).
        var i = catsVL.items.findIndex(function (x) { return x.id === c.id; });
        if (i >= 0 && catsVL.current() !== catsVL.items[i]) catsVL.select(i);
        var cc = catsVL.current(); if (cc && cc.id === c.id) { itemsVL.setItems(itemsFor(c.id), 0); onItem(); }
        setZone('cats'); hints();
      });
    })();
  }
  // A folder row or the row back out of one: rows that open other rows, not titles.
  function isNav(cid) { return cid === UP || String(cid).indexOf(FOLDER) === 0; }
  function itemsFor(cid) {
    var d = data[kind];
    if (!d) return [];
    if (cid === CW) return continueList();
    if (cid === LANGS || isNav(cid)) return [];
    if (cid === NEW) return recentList();
    if (cid === MY) { var m = E().myList; return sorted(d.items.filter(function (it) { return m.indexOf(key(it)) >= 0; })); }
    if (cid === ALL) return sorted((d.browse ? d.recent : d.items).filter(function (it) { return !it.adult; }), 'added');
    if (d.browse) {
      if (d.catItems[cid]) return sorted(d.catItems[cid].slice());
      browseCat(d, kind, cid);
      itemsVL.empty = 'Loading this category from the portal…';
      return [];
    }
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
    if (how === 'added') list.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
    else if (how === 'name') list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }); });
    else if (how === 'rating') list.sort(function (a, b) { return (+b.rating || 0) - (+a.rating || 0); });
    else if (how === 'year') list.sort(function (a, b) { return yearOf(b) - yearOf(a); });
    // Reverse the order (Settings > Movies and shows, or Red on the home): any of them turned round.
    if (Store.settings.vodSortReverse) list.reverse();
    return list;
  }
  function yearOf(it) { var m = /\((19|20)\d\d\)/.exec(it.name || ''); return +(it.year || (m ? m[0].slice(1, 5) : 0)) || 0; }
  // A title's category name, shown on its row in All, Recently added, My list and Continue watching (discussion #60).
  var catNames = null, catNamesFor = null;
  function catName(it) {
    var d = data[kind]; if (!d) return '';
    if (catNamesFor !== d) { catNames = catLabels(d); catNamesFor = d; }
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
  function searchState() { var o = offered(); return !o.length ? 'none' : lean() ? 'ready' : o.some(function (k) { return !data[k]; }) ? (preparing ? 'loading' : 'none') : 'ready'; }
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
      if (e) { showSeason(e); onItem(); play(e, !!x.fromStart); }
    } : null);
    else play(x.it, !!x.fromStart);
  }

  var catDeb = U.debounce(function (c) {
    if (episodes) { if (c && c.season != null) { itemsVL.setItems(seasonEps(c.season), 0); onItem(); } return; }
    if (!c || c.head) return;
    var shut = c.adult && !adultOpen();
    itemsVL.empty = c.id === LANGS ? 'Press OK to pick which languages show' : c.folder ? T('OK opens this language\'s categories') : c.up ? T('OK goes back to every language') : shut ? 'Press OK and enter the PIN' : 'Nothing here';
    itemsVL.setItems(shut ? [] : itemsFor(c.id), 0); onItem();
  }, 200);
  // With a PIN set (Settings > Parental controls, for channels), adult categories open only after it.
  var adultUnlocked = false;
  function adultOpen() { return adultUnlocked || !Parental.enabled() || (Store.settings.pinScope !== 'channels' && Store.settings.pinScope !== 'both'); }
  // The category you're on, kept for the next time Movies or Shows opens (issue #173).
  function onCat(i, c) { catDeb(c); if (zone === 'cats') hints(); try { if (c && c.id != null) localStorage.setItem('tivibro.vodCat.' + kind, String(c.id)); } catch (e) {} }
  function keptCat() { try { return localStorage.getItem('tivibro.vodCat.' + kind); } catch (e) { return null; } }
  var infoDeb = U.debounce(fetchInfo, 400);
  function onItem() { showInfo(); infoDeb(); }

  /* A provider's show with no trailer of its own: TMDB's, with your token (series.js finds the show). */
  var tmdbTr = {}, tmdbTrP = {};
  var saidNoToken = false;
  /* The TMDB token as of the last trailer look-up.  One added or changed since (Settings > API keys, the phone or
     the web editor) clears what was found without it, so titles with no trailer look again without a restart
     (discussion #36: trailers only showed up after restarting the app). */
  var trTok = null;
  function tokenCheck() {
    var t = typeof MediaStore !== 'undefined' && MediaStore.tmdbToken ? MediaStore.tmdbToken() : '';
    if (t === trTok) return;
    if (trTok !== null) {
      tmdbTr = {}; tmdbTrP = {}; tmdbMv = {}; trSaid = {}; saidNoToken = false;
      info.forEach(function (m, k) { if (m && !m.trailer) info.delete(k); });
      Log.info('vod', 'TMDB token ' + (t ? 'changed' : 'removed') + ': trailers will be looked up again');
    }
    trTok = t;
  }
  function tmdbOn() {
    tokenCheck();
    // TMDB's or TheTVDB's, as Movies/Shows: details from say (media.js metaWho).
    var on = typeof MediaMoviePage !== 'undefined' && typeof MediaStore !== 'undefined' && typeof Media !== 'undefined' && !!Media.metaWho && !!Media.metaWho();
    // Said once in the log, so a report shows why a title has no trailer (discussion #36).
    if (!on && !saidNoToken) { saidNoToken = true; Log.info('vod', 'Trailers: no TMDB token and TheTVDB off, so only the provider\'s own trailers show'); }
    return on;
  }
  // Why a title has no trailer, in the log (once per title), for problem reports.
  var trSaid = {};
  function trNote(name, why) { if (trSaid[name]) return; trSaid[name] = 1; Log.info('vod', 'No trailer for "' + name + '": ' + why); }
  /* A provider's show with no trailer of its own: TMDB's, with your token.  By the TMDB id the provider gives in
     the show's details, else the one series.js knows, else asked now by name and year (discussion #36: missing on
     some shows, when the name hadn't been looked up yet).  A promise of the YouTube id or ''. */
  function showTrailer(it, passive) {
    if (!it) return Promise.resolve('');
    if (it.trailer) return Promise.resolve(it.trailer);
    var k = it.name + '|' + (it.year || '');
    if (tmdbTr[k]) return Promise.resolve(tmdbTr[k]);
    if (tmdbTrP[k] && !(it.tmdb && !tmdbTrP[k].byId)) return tmdbTrP[k];
    if (!tmdbOn()) return Promise.resolve('');
    // Only moving past a show (the list, the home): no new TMDB search for it, just the id already known.
    if (passive && !/^[0-9]+$/.test(String(it.tmdb || '')) && !(typeof Series !== 'undefined' && (Series.show(it.name, it.year, 'strong') || {}).id)) return Promise.resolve('');
    var p = idFor().then(function (id) {
      if (!id) { trNote(it.name, 'the provider has none, and TMDB found no show by that name' + (it.year ? ' and year (' + it.year + ')' : '')); return ''; }
      return new Promise(function (res) { MediaMoviePage.trailerFor(/^(tmdb|tvdb):/.test(id) ? id : 'tmdb:tv:' + id, function (t) { if (!t) trNote(it.name, 'the provider has none, and TMDB has no YouTube trailer for ' + id); res(t || ''); }); });
    }).then(function (t) { tmdbTr[k] = t; if (!t && tmdbTrP[k] === p) setTimeout(function () { if (tmdbTrP[k] === p) delete tmdbTrP[k]; }, 600000); return t; }, function () { return ''; });
    p.byId = !!it.tmdb;
    return (tmdbTrP[k] = p);
    function idFor() {
      if (/^[0-9]+$/.test(String(it.tmdb || '')) && MediaStore.tmdbToken()) return Promise.resolve('tmdb:tv:' + it.tmdb);
      var tv = typeof Series !== 'undefined' ? Series.show(it.name, it.year, 'strong') : null;
      if (tv && tv.id) return Promise.resolve(tv.id);
      var c = typeof Series !== 'undefined' && Series.clean ? Series.clean(it.name) : { t: it.name, y: '' };
      if (!c.t || !Media.tvByName) return Promise.resolve('');
      return Media.tvByName(c.t, it.year || c.y, 'strong').then(function (r) { return (r && r.metadata && r.metadata.id) || ''; }, function () { return ''; });
    }
  }
  function fetchInfo() {
    var it = itemsVL.current();
    tokenCheck();
    if (it && !it.ep && kind === 'series') showTrailer(it, true);
    if (!it || it.ep || kind !== 'movie' || info.has(key(it))) return;
    loadInfo(it, function () { if (itemsVL.current() === it) showInfo(); });
  }
  /* A movie's details from the provider (its trailer, plot, cast…), then(): for the list, the home and the wall
     alike.  A movie with no trailer from the provider: TMDB's, with your token (discussion #36: none on Recently added). */
  function loadInfo(it, then) {
    var k = key(it), nm = it.name, yr = it.year;
    info.set(k, null);
    return Source.vodInfo(it.id, plOf(it)).then(function (r) {
      var i = (r && r.info) || {}, md = (r && r.movie_data) || {};
      // The provider's trailer: a YouTube id, or a whole YouTube link.
      var m = { trailer: ytId(i.youtube_trailer || i.trailer), plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '', director: i.director || '', dur: i.duration || '', year: (i.releasedate || i.release_date || '').slice(0, 4), poster: i.movie_image || i.cover_big || '', backdrop: [].concat(i.backdrop_path || [])[0] || '', media: Caps.fromXtream(i), tmdb: tmdbOf(i.tmdb_id || i.tmdb || md.tmdb_id) };
      info.set(k, m);
      if (then) then();
      if (!m.trailer) m.tr = new Promise(function (res) { movieTrailer(i.tmdb_id || i.tmdb || md.tmdb_id, nm, m.year || yr, function (t) { if (t && info.get(k) === m) { m.trailer = t; if (then) then(); } res(t || ''); }); });
    }).catch(function () {});
  }
  /* A provider's show's ids for skip times (skipper.js): its TMDB id from the provider, else the show series.js
     matched (TMDB, or TheTVDB with its links). */
  function showIdsOf(series) {
    var t = tmdbOf(series.tmdb);
    if (t) return { tmdb: t };
    var sh = typeof Series !== 'undefined' && series.name ? Series.show(series.name, series.year, 'strong') : null;
    return sh && Media.idsOfMeta ? Media.idsOfMeta(sh) : {};
  }
  // A TMDB id as a provider gives it (a number, a string, sometimes "0" or a link): the number, or ''.
  function tmdbOf(v) { var m = /^\s*([1-9][0-9]{0,9})\s*$/.exec(String(v == null ? '' : v)); return m ? m[1] : ''; }
  /* A provider's movie's TMDB id, for skip times (skipper.js): from its row in the list, its details already
     loaded, or its details asked for now.  '' when the provider doesn't say. */
  function movieTmdb(it) {
    var known = tmdbOf(it.tmdb || it.tmdb_id) || (info.get(key(it)) || {}).tmdb;
    if (known) return Promise.resolve(known);
    return Source.vodInfo(it.id, plOf(it)).then(function (r) { var i = (r && r.info) || {}, md = (r && r.movie_data) || {}; return tmdbOf(i.tmdb_id || i.tmdb || md.tmdb_id); }, function () { return ''; });
  }
  var tmdbMv = {};
  function movieTrailer(tmdbId, name, year, cb) {
    if (!tmdbOn()) return cb('');
    var noted = function (id) { return function (t) { if (!t) trNote(name, 'the provider has none, and TMDB has no YouTube trailer for ' + id); cb(t); }; };
    if (/^[0-9]+$/.test(String(tmdbId || '')) && MediaStore.tmdbToken()) return MediaMoviePage.trailerFor('tmdb:' + tmdbId, noted('tmdb:' + tmdbId));
    var c = typeof Movies !== 'undefined' && Movies.clean ? Movies.clean(String(name || '').replace(/^\s*[A-Z]{2,3}\s*[-|:]\s+/, '')) : { t: name, y: '' };
    var k = c.t + '|' + (year || c.y || '');
    if (!c.t || !Media.guideLookup) return cb('');
    if (tmdbMv[k] !== undefined) return tmdbMv[k] ? MediaMoviePage.trailerFor(tmdbMv[k], noted(tmdbMv[k])) : cb('');
    tmdbMv[k] = '';
    Media.guideLookup(c.t, year || c.y, 'strong').then(function (r) {
      var id = r && r.metadata && r.metadata.id; if (!/^(tmdb|tvdb:movie):[0-9]+$/.test(id || '')) { trNote(name, 'the provider has none, and TMDB found no movie "' + c.t + '"' + (year || c.y ? ' (' + (year || c.y) + ')' : '')); return cb(''); }
      tmdbMv[k] = id; MediaMoviePage.trailerFor(id, noted(id));
    }, function () { cb(''); });
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
    if (poster) { var img = U.el('img', 'vod-poster' + (it.ep && te && poster === te.still ? ' still' : '')); img.src = poster; img.onerror = function () { if (!Net.retryImage(this, true)) this.remove(); }; box.appendChild(img); }
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
    var credit = U.tvdbCredit ? U.tvdbCredit(tv) : null; if (credit) box.appendChild(credit);
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
  var seriesAsk = 0;
  function openSeries(s, then) {
    if (homeMode) { toList(null, s); showFromHome = true; setZone('items'); }   // from the home's menu: the episodes are in the list
    $('vodTitle').textContent = 'Loading ' + s.name;
    var mine = ++seriesAsk;
    series = s; episodes = null; spStart(s); hints();
    Source.seriesInfo(s.id, plOf(s)).then(function (r) {
      if (mine !== seriesAsk) return;                 // closed, or another show opened meanwhile
      if (!s.trailer) s.trailer = ytId(((r && r.info) || {}).youtube_trailer || ((r && r.info) || {}).trailer);   // a show's trailer, from its details
      var sin = (r && r.info) || {}; if (!s.tmdb && /^[0-9]+$/.test(String(sin.tmdb || sin.tmdb_id || ''))) s.tmdb = String(sin.tmdb || sin.tmdb_id);
      if (!s.trailer) showTrailer(s).then(function (t) { if (t && sp && sp.s === s) { spDraw(); hints(); } });
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
      showSeason(eps[openAt(eps)] || null);
      onItem();
      hints();
      if (then) then(eps);
    }).catch(function () { if (mine !== seriesAsk) return; U.toast('Could not load that show'); $('vodTitle').textContent = s.name; episodes = []; if (sp) { sp.loading = false; spDraw(); } });
  }
  // Open a show's episodes on one of them ('e' + id) and play it from where it stopped.
  function playEpisode(s, epId) {
    openSeries(s, function (eps) {
      var e = eps.filter(function (y) { return idOf(y) === epId; })[0];
      if (e) { showSeason(e); onItem(); play(e, false); }
    });
  }
  function closeSeries() {
    var s = series; episodes = null; series = null; seriesAsk++;
    spClose();
    var c = catsVL.current();
    var list = itemsFor(c ? c.id : ALL);
    itemsVL.setItems(list, Math.max(0, s ? list.findIndex(function (x) { return x === s || (x.id === s.id && (x.pl || '') === (s.pl || '')); }) : 0));
    $('vodTitle').textContent = kind === 'series' ? 'Shows' : 'Movies';
    onItem(); hints();
  }

  /* ---------- playback ---------- */
  function play(it, fromStart) {
    var id = idOf(it);
    var r = resumeOf(id), startAt = !fromStart && r && r.pos > 30 && !(U.isWatchedAt || function (p, d) { return d > 0 && (p >= d * 0.9 || p > d - 60); })(r.pos, r.dur) ? r.pos - 5 : 0;
    var meta = { id: id, media: mediaOf(it), title: it.ep ? (series ? series.name : '') + '   ' + it.label : it.name, sub: it.ep ? '' : it.year || '', item: it, seriesKey: series ? pre(series) + 's' + series.id : null, showTmdb: it.ep && series ? tmdbOf(series.tmdb) : '', showIds: it.ep && series ? showIdsOf(series) : null, p: it.pl || '', provider: true };
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
  /* An episode ended: the next one, as on Plex (upnext.js), with its picture, number, title and summary, counting
     down (or waiting, with Play the next one automatically off).  force: Next episode chosen at the credits
     (skipper.js): straight to it. */
  function ended(force) {
    var m = playingMeta, nx = null;
    if (m && m.item && m.item.ep && episodes) { var i = episodes.indexOf(m.item); nx = i >= 0 ? episodes[i + 1] : null; }
    if (nx) mark(m.id, true);
    var playNext = function () {
      if (!episodes || episodes.indexOf(nx) < 0) return;          // left the show meanwhile
      playingMeta = null;
      if (nx.season !== m.item.season) showSeason(nx); else itemsVL.setItems(itemsVL.items, Math.max(0, itemsVL.items.indexOf(nx)));
      play(nx, true);
    };
    if (nx && force) return playNext();
    stopped();
    if (nx) UpNext.hold();   // the curtain (upnext.js): no flash of the page before Up next
    Views.stopAll();
    open(kind, true);
    if (nx) upNext(nx, playNext);
  }
  /* Up next for a provider's episode (upnext.js, full screen): its picture and summary (TMDB's where the provider has
     none) with the show's logo art from TMDB (with your token; else its name in type), or the show's backdrop and no
     summary for one not seen yet with Hide spoilers on. */
  function upNext(nx, playNext) {
    var s = series || {}, tv = typeof Series !== 'undefined' && s.name ? Series.show(s.name, s.year, 'strong') : null, te = tv ? Series.episode(tv, nx.season, nx.num) : null;
    var spoil = !!(Store.settings.noSpoilers && !isWatched(idOf(nx)) && !resumeOf(idOf(nx)));
    var still = spoil ? '' : (nx.cover && nx.cover !== s.cover ? nx.cover : (te && te.still) || '');
    var title = String(nx.label || '').replace(/^S\d+ E\S*\s+/, '') || (!spoil && te && te.t) || '';
    UpNext.show({ image: still || (tv && (tv.backdropHd || tv.backdrop)) || s.cover || '', logo: (tv && tv.logo) || '', show: (tv && tv.title) || s.name || '', line: T('Season {x}, episode {y}', { x: nx.season, y: nx.num || '?' }),
      title: title, desc: spoil ? '' : String(nx.plotEp || (te && te.plot) || '').slice(0, 400), play: playNext, cancel: function () {}, cancelLabel: 'Back to episodes' });
  }

  /* Yellow: watched or not watched in one press, for a movie or an episode (no menu to open and close each time). */
  function quickMark(it) {
    if (!it || !(kind === 'movie' || it.ep)) return U.toast('Yellow marks a movie or an episode watched');
    var id = idOf(it), on = !isWatched(id) || !!resumeOf(id);
    mark(id, on); relist(); if (sp) spDraw();
    U.toast(on ? 'Marked as watched' : 'Marked as not watched');
  }
  function itemMenu(it, fresh) {
    if (!it) return;
    // A movie whose details aren't read yet (the home, the wall): read them first, so its trailer is offered (up to 3 seconds).
    if (!fresh && !trailerOf(it) && typeof PalmServiceBridge !== 'undefined' && tmdbOn()) { findTrailer(it, function () { itemMenu(it, true); }); return; }
    if (!fresh && kind === 'movie' && !it.ep && !info.has(key(it)) && typeof PalmServiceBridge !== 'undefined') { var done = false, go = function () { if (!done) { done = true; itemMenu(it, true); } }; loadInfo(it, null).then(go); setTimeout(go, 3000); return; }
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
        Store.saveEdits(); itemsVL.refresh(); homeChanged(); U.toast(mine ? 'Removed from My list' : 'Added to My list');
      } },
      // On a show (no file of its own) it only takes the show off Continue watching, as before.
      (playable ? r || !w : r) && { label: 'Mark as watched', action: function () { if (playable) mark(id, true); else { delete E().resume[id]; Store.saveEdits(); } relist(); } },
      playable && w && !r && { label: 'Mark unwatched', action: function () { mark(id, false); relist(); } }
    ]);
  }

  /* Trailers (discussion #60): the provider's YouTube trailer, opened in the TV's YouTube app; TiviBro comes back
     with the Back button there.  Only on the TV, where TiviBro can ask webOS to open another app. */
  // A movie's (its details), or a show's (the list or its details; on an episode, its show's).
  function trailerOf(it) {
    if (!it || typeof PalmServiceBridge === 'undefined') return '';
    if (kind === 'series') { var sh = it.ep ? series : it; return (sh && (sh.trailer || tmdbTr[sh.name + '|' + (sh.year || '')])) || ''; }
    var m = !it.ep && kind === 'movie' ? info.get(key(it)) : null; return m && m.trailer ? m.trailer : '';
  }
  /* The trailer, looked up now when it isn't known yet (up to 4 seconds): for the options. */
  function findTrailer(it, cb) {
    var t = trailerOf(it), done = false, fin = function (x) { if (!done) { done = true; cb(x || ''); } };
    if (t || !it || typeof PalmServiceBridge === 'undefined' || !tmdbOn()) return cb(t);
    setTimeout(function () { fin(trailerOf(it)); }, 4000);
    if (kind === 'series') { showTrailer(it.ep ? series : it).then(fin); return; }
    if (it.ep) return fin('');
    var k = key(it);
    var wait = function () { var m = info.get(k); if (m && m.trailer) return fin(m.trailer); if (m && m.tr) m.tr.then(fin); else fin(''); };
    if (!info.has(k)) loadInfo(it, null).then(wait); else if (info.get(k) === null) setTimeout(function () { wait(); }, 1500); else wait();
  }
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
  function homeChanged() { if (homeMode && typeof VodHome !== 'undefined') VodHome.changed(); }
  function relist() {
    homeChanged();
    if (!episodes) {
      var was = catsVL.current(), cl = catList(), sel = itemsVL.sel;
      catsVL.setItems(cl, Math.max(0, cl.findIndex(function (c) { return was && c.id === was.id; })));
      if (was && was.id === CW) itemsVL.setItems(itemsFor(CW), sel);
    }
    itemsVL.refresh(); onItem(); spDraw();
  }
  function setZone(z) { zone = z; catsVL.setActive(z === 'cats'); itemsVL.setActive(z === 'items'); hints(); }
  function hints() {
    if (sp) return UI.hints(sp.zone === 'trl' ? [['', 'OK  play the trailer', 'ok'], ['', 'Down  seasons'], ['', 'Back  ' + (showFromHome ? 'home' : 'all shows'), 'back']] : sp.zone === 'tabs' ? [['', '◀ ▶  season'], ['', 'Down  episodes'], trailerOf(sp.s) ? ['', 'Up  trailer'] : null, ['', 'Back  ' + (showFromHome ? 'home' : 'all shows'), 'back']] : [['', 'OK  play'], ['', 'Up  seasons'], ['', 'Hold OK  options', 'hold'], ['yellow', 'Watched'], ['', 'Back  ' + (showFromHome ? 'home' : 'all shows'), 'back']]);
    if (zone === 'cats') {
      var c = catsVL && catsVL.current();
      return UI.hints(c && c.id === LANGS ? [['', 'OK  pick languages'], ['', homeOn() ? 'Back  home' : 'Back  menu bar', 'back'], ['green', homeOn() ? 'Home' : 'Guide'], ['blue', 'Settings']]
        : [['', 'OK  open'], ['', homeOn() ? 'Hold OK  pin or hide' : 'Hold OK  hide category', 'hold'], ['', homeOn() ? 'Back  home' : 'Back  menu bar', 'back'], ['red', homeOn() ? 'Pin or hide' : 'Hide category'], ['green', homeOn() ? 'Home' : 'Guide'], ['blue', 'Settings']]);
    }
    UI.hints([['', 'OK  ' + (kind === 'series' ? 'open' : 'play')], ['', 'Hold OK  options', 'hold'], ['', episodes && showFromHome ? 'Back  home' : 'Back  categories', 'back'], ['red', 'Options'], kind === 'movie' || episodes ? ['yellow', 'Watched'] : null, ['green', homeOn() ? 'Home' : 'Guide'], ['blue', 'Settings']]);
  }

  function keys(a) {
    if (sp) return spKeys(a);
    if (zone === 'cats' && episodes) {
      if (a === 'up') catsVL.move(-1, true);
      else if (a === 'down') catsVL.move(1, true);
      else if (a === 'right' || a === 'ok') { catDeb.cancel(); var sc = catsVL.current(); if (sc && sc.season != null && (!itemsVL.items.length || itemsVL.items[0].season !== sc.season)) itemsVL.setItems(seasonEps(sc.season), 0); onItem(); setZone('items'); }
      else if (a === 'back' || a === 'left') { closeSeries(); setZone('items'); if (showFromHome) toHome(); }
      else if (a === 'green') { if (homeOn()) toHome(); else Views.switchTab('guide'); }
      else if (a === 'blue') Views.switchTab('settings');
      return true;
    }
    if (zone === 'cats') {
      if (a === 'up') catsVL.move(-1, true);
      else if (a === 'down') catsVL.move(1, true);
      else if (a === 'chup') catsVL.page(-1);
      else if (a === 'chdown') catsVL.page(1);
      else if ((a === 'ok' || a === 'right') && catsVL.current() && catsVL.current().id === LANGS) { if (a === 'ok') langMenu(); }
      else if ((a === 'ok' || a === 'right') && catsVL.current() && (catsVL.current().folder || catsVL.current().up)) openFolder(catsVL.current());
      else if (a === 'right' || a === 'ok') {
        catDeb.cancel(); var c = catsVL.current();
        var go = function () {
          if (c && Store.settings.vodCatWall && typeof VodHome !== 'undefined' && !c.head && [LANGS, CW].indexOf(c.id) < 0) return asWall(c);
          if (c) { itemsVL.empty = 'Nothing here'; itemsVL.setItems(itemsFor(c.id), 0); onItem(); } setZone('items');
        };
        if (c && c.adult && !adultOpen()) Parental.gate('channels', null, function () { adultUnlocked = true; go(); }); else go();
      }
      else if (a === 'red' || a === 'hold' || a === 'info') catMenu(catsVL.current());
      else if (a === 'back' && foldersOn() && folderOpen() && catList().some(function (x) { return x.up; })) openFolder({ up: true });   // out of a language's folder first
      else if (a === 'back' || a === 'left') { if (homeOn()) toHome(); else Views.tabBar(restore); }
      else if (a === 'green') { if (homeOn()) toHome(); else Views.switchTab('guide'); }
      else if (a === 'blue') Views.switchTab('settings');
      return true;
    }
    if (a === 'up') itemsVL.move(-1, true);
    else if (a === 'down') itemsVL.move(1, true);
    else if (a === 'chup') itemsVL.page(-1);
    else if (a === 'chdown') itemsVL.page(1);
    else if (a === 'left') setZone('cats');                   // a show's seasons, or the categories
    else if (a === 'ok') {
      var it = itemsVL.current();
      if (!it) return true;
      if (kind === 'series' && !it.ep) openSeries(it); else play(it, false);
    }
    else if (a === 'red' || a === 'hold' || a === 'info') itemMenu(itemsVL.current());
    else if (a === 'yellow') quickMark(itemsVL.current());
    else if (a === 'back') { if (episodes) { closeSeries(); if (showFromHome) toHome(); } else setZone('cats'); }
    else if (a === 'green') { if (homeOn()) toHome(); else Views.switchTab('guide'); }
    else if (a === 'blue') Views.switchTab('settings');
    return true;
  }
  function restore() { UI.setHandler(keys); setZone(zone); }

  /* ---------- the home (vodhome.js): poster shelves, the list above is All categories ---------- */
  function homeOn() { return typeof VodHome !== 'undefined' && VodHome.on(); }
  function progressOf(it) {
    var r = resumeOf(idOf(it)), bar = kind === 'series' && !it.ep ? r && r.ep && resumeOf(r.ep) : r;
    return bar && bar.dur ? Math.round(100 * bar.pos / bar.dur) : 0;
  }
  function whereOf(it) {
    var r = resumeOf(idOf(it));
    if (kind === 'series' && !it.ep) { var er = r && r.ep && resumeOf(r.ep); return er ? r.l + ': stopped at ' + Math.floor(er.pos / 60) + ' of ' + Math.floor(er.dur / 60) + ' min' : r && r.l ? 'Up next: ' + r.l : ''; }
    return r && r.dur ? 'Stopped at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min' : isWatched(idOf(it)) ? '✓  Watched' : '';
  }
  // What the home's top shows: the provider's details for a movie (asked for once), TMDB's for a show.
  function detailsOf(it, then) {
    if (kind === 'series') {
      if (then) showTrailer(it, true);                  // its trailer from TMDB for the options, as in the list
      var tv = typeof Series !== 'undefined' ? Series.show(it.name, it.year, 'strong') : null;
      return { plot: it.plot && it.plot.length >= 40 ? it.plot : (tv && tv.plot) || it.plot || '', genre: tv && tv.genre, year: it.year || (tv && tv.year), rating: tv && tv.rating, backdrop: tv && (tv.backdropHd || tv.backdrop) || '', logo: tv && tv.logo || '', cast: tv && tv.cast };
    }
    tokenCheck();
    var k = key(it), m = info.get(k);
    if (m === undefined && then) loadInfo(it, then);
    if (!m) return { plot: it.plot || '' };
    return { plot: m.plot, genre: m.genre, cast: m.cast, director: m.director, dur: niceDur(m.dur), year: m.year, backdrop: m.backdrop, media: m.media ? Caps.label(m.media) : '' };
  }
  // Leave the home for the list: on a category (or All), on a title.
  function toList(cid, it) {
    homeMode = false; if (typeof VodHome !== 'undefined') VodHome.hide();
    UI.setHandler(keys);
    var cats = catList(), ci = cats.findIndex(function (c) { return c.id === (cid || ALL); });
    if (ci < 0) ci = Math.max(0, cats.findIndex(function (c) { return c.id === ALL; }));
    catsVL.setItems(cats, ci);
    var list = itemsFor(cats[ci] ? cats[ci].id : ALL), at = it ? list.indexOf(it) : -1;
    itemsVL.setItems(list, Math.max(0, at)); onItem();
    setZone(it && at >= 0 ? 'items' : 'cats');
  }
  function toHome() { if (episodes) closeSeries(); showFromHome = false; homeMode = true; VodHome.show(kind, homeApi, false); }
  var homeApi = {
    CW: CW, MY: MY, NEW: NEW, ALL: ALL,
    data: function () { return data[kind]; }, loading: function () { return loadingNow[kind] || ''; }, cats: function () { return catList(); }, items: function (id) { return itemsFor(id); },
    key: function (it) { return key(it); }, adultOpen: function () { return adultOpen(); }, catName: function (it) { return catName(it); }, stars: function (it) { return stars(it.rating); },
    progress: function (it) { return progressOf(it); }, where: function (it) { return whereOf(it); }, details: function (it, then) { return detailsOf(it, then); },
    isMine: function (it) { return E().myList.indexOf(key(it)) >= 0; }, isWatched: function (it) { return isWatched(idOf(it)); },
    open: function (it) { if (kind === 'series' && !it.ep) { toList(null, it); showFromHome = true; openSeries(it); setZone('items'); } else play(it, false); },
    menu: function (it) { itemMenu(it); }, list: function (cid, it) { toList(cid, it); }, reload: function () { reloadNow(); }
  };

  /* Reload movies and shows now (discussion #36): both lists again from the provider, past the helper's and this
     TV's saved copies, without reloading the channels.  The screen you're on shows them when they're in. */
  var reloading = false;
  function reloadNow() {
    if (reloading) { U.toast('Already reloading movies and shows'); return; }
    var kinds = ['movie', 'series'].filter(function (k) { return sources(k).length; });
    if (!kinds.length) { U.toast('No playlist with movies or shows'); return; }
    reloading = true; Vod.reset(true); U.toast('Reloading movies and shows');
    var counts = [];
    kinds.reduce(function (pr, k) {
      return pr.then(function () { return load(k).then(function (d) { counts.push((d ? d.browse ? d.total : d.items.length : 0) + (k === 'series' ? ' shows' : ' movies')); }, function (e) { Log.warn('vod', 'Reload of the ' + (k === 'series' ? 'shows' : 'movies') + ' failed: ' + (e && e.message || e)); }); });
    }, Promise.resolve()).then(function () {
      reloading = false;
      U.toast(counts.length ? counts.join(' and ') + ' loaded' : 'Movies and shows did not load.  Try again in a moment.');
      var t = typeof Views !== 'undefined' && Views.tab;
      if ((t === 'movies' || t === 'shows') && !UI.modalOpen) open(t === 'shows' ? 'series' : 'movie');
    });
  }
  function open(k, keepState) {
    if (!built) build();
    var changed = k !== kind;
    kind = k;
    UI.setHandler(keys);
    if (homeOn() && keepState && homeMode && data[k] && !changed && !pending) { VodHome.show(k, homeApi, false); return; }
    if (changed) { episodes = null; series = null; seriesAsk++; spClose(); }
    $('vodTitle').textContent = episodes && series ? series.name : (k === 'series' ? 'Shows' : 'Movies');
    if (keepState && data[k] && !changed && !pending && episodes) { itemsVL.refresh(); showInfo(); setZone(zone); if (series) showSeason(itemsVL.current()); return; }
    if (keepState && data[k] && !changed && !pending) { var was = catsVL.current(), cl = catList(); catsVL.setItems(cl, Math.max(0, cl.findIndex(function (c) { return was && c.id === was.id; }))); itemsVL.refresh(); showInfo(); setZone(zone); return; }
    catsVL.setItems([], 0); itemsVL.setItems([], 0);
    itemsVL.empty = 'Loading…'; itemsVL.refresh();
    setZone('cats');
    var mine = ++opens;                                       // only the latest opening sets up the screen
    // The home straight away (Loading… at the top), not the list first.
    if (homeOn() && !(pending && pending.kind === k)) { homeMode = true; showFromHome = false; VodHome.show(k, homeApi, true); }
    load(k).then(function () {
      if (kind !== k || mine !== opens) return;
      var cats = catList();
      // The category you were on last time, else the first with something in it (skip an empty My list).
      var kc = keptCat(), at = kc == null ? -1 : cats.findIndex(function (c) { return String(c.id) === kc; });
      var first = at >= 0 ? at : Math.max(0, cats.findIndex(function (c) { return c.count > 0; }));
      catsVL.setItems(cats, first);
      itemsVL.empty = data[k].items.length ? 'Nothing here' : data[k].total ? 'Nothing in the languages picked.  Choose Languages on the left.' : 'This provider has no ' + (k === 'series' ? 'shows' : 'movies') + ' right now';
      itemsVL.setItems(itemsFor(cats[first].id), 0);
      setZone('items');
      onItem();
      if (homeOn() && !(pending && pending.kind === k)) { homeMode = true; showFromHome = false; VodHome.show(k, homeApi, true); }
      else { homeMode = false; if (typeof VodHome !== 'undefined') VodHome.hide(); }
      openPending(k);
    }).catch(function (e) { itemsVL.empty = 'Could not load ' + (k === 'series' ? 'shows' : 'movies') + ': ' + (e.message || e); itemsVL.setItems([], 0); if (homeMode && mine === opens) { homeMode = false; VodHome.hide(); UI.setHandler(keys); } });
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
            if (/^tvdb:/.test(String(tv.id || ''))) out.tvdb = 1;   // the phone credits TheTVDB under these details
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

  function arrange(k) { U.toast('Loading ' + (k === 'series' ? 'shows' : 'movies') + '…'); load(k).then(function () { kind = k; VodHome.arrange(k, homeApi); }, function (e) { U.toast('Could not load the list: ' + (e && e.message || e), 5000); }); }
  // Settings > Movies and shows > Order categories changed: the list again, on the same category.
  // Into a language's folder (its first category), or back out to the folders (on the one just left).
  function openFolder(c) {
    var left = folderOpen();
    setFolder(c.up ? '' : c.folder);
    var cl = catList(), at = c.up ? cl.findIndex(function (x) { return x.folder === left; }) : cl.findIndex(function (x) { return !x.up && !x.head; });
    catsVL.setItems(cl, Math.max(0, at)); onCat(catsVL.sel, catsVL.current());
  }
  function recats() { if (!catsVL || !data[kind]) return; var c = catsVL.current(), cl = catList(); catsVL.setItems(cl, Math.max(0, cl.findIndex(function (x) { return c && x.id === c.id; }))); }
  return { arrange: arrange, movieTmdb: movieTmdb, recats: recats, reloadNow: reloadNow, homeApi: function () { return homeApi; }, _test: { catLang: catLang, byLang: byLang, inFolders: inFolders, nameSays: nameSays, curCat: function () { var c = catsVL && catsVL.current(); return c ? String(c.id) : ''; }, homeApi: function () { return homeApi; }, catList: catList, itemsFor: itemsFor, catName: catName, trailerOf: trailerOf, tag: tag, view: view, done: done, mark: mark, isWatched: isWatched, openAt: openAt, renderItem: renderItem, itemMenu: itemMenu, markShow: markShow, withKind: withKind }, phone: ForPhone, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, allItems: allItems, openItem: openItem, prepare: prepare, lean: lean, findRemote: findRemote, titleCount: titleCount, countsFor: countsFor, get searchState() { return searchState(); }, offered: offered, reset: function (fresh) { if (fresh) freshAt = Date.now(); gen++; data = { movie: null, series: null }; raw = { movie: null, series: null }; sets = { movie: {}, series: {} }; asking = { movie: null, series: null }; info.clear(); episodes = null; series = null; seriesAsk++; spClose(); } };
})();
