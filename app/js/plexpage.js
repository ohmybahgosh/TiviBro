/* A Plex movie or episode: its page (backdrop, facts, badges, scores, summary, cast, More like this) with Resume,
   Play from the start, Trailer, Watched and More (version, audio, subtitles, Remove from Continue watching, Go to
   show), and playing it in TiviBro's player (Views.playVod) through the helper's door.
   Playing: the file as it is when the TV plays its video (TiviBro's own converter handles DTS or TrueHD sound);
   otherwise the server converts it (Plex's universal converter, HLS).  Progress goes to Plex every 10 s, so
   stopping here and finishing in Plex's app (or the other way) picks up where you were; 90% counts as watched, as
   in Plex.  Skip intro and Skip credits use Plex's own markers (skipper.js); an episode's end brings Up next.
   Chromium 53-compatible. */
var PlexPage = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  var chain = 0;   // episodes started one after another by Up next, for Still watching?
  var item = null, pageArt = null, back = null, btns = [], btnAt = 0, playing = null, timer = 0, session = '', versionOf = {};
  var DIRECT_VIDEO = /^(h264|hevc|h265|vp9|av1|mpeg4)$/i, DIRECT_BOX = /^(mkv|mp4|mov|m4v|mpegts|ts|webm|avi)$/i;

  function mc(j) { return (j && j.MediaContainer) || {}; }
  function mins(ms) { return ms ? Math.round(ms / 60000) : 0; }
  function clock(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  /* ---------- The page ---------- */
  /* A page, as in Plex: a movie, an episode, a show or a season.  Its full details first (markers, chapters, extras,
     related, every version; a show's next episode), then its rows (Cast and crew, Seasons or Episodes, More like
     this, the collection's other titles, Extras).  A title opened from a row comes back here with Back (hist). */
  var hist = [], shelf = null, zone = 'btns';
  function open(m, onBack) { back = onBack; hist = []; show(m); }
  function show(m) {
    item = m; btnAt = 0; zone = 'btns'; shelf = null;
    var q = m.type === 'show' ? '?includeExtras=1&includeRelated=1&includeOnDeck=1&includeGuids=1' : m.type === 'season' ? '' :
      '?includeMarkers=1&includeChapters=1&includeExtras=1&includeRelated=1&includeGuids=1';
    Plex.call(m.server, '/library/metadata/' + m.ratingKey + q).then(function (j) {
      var full = (mc(j).Metadata || [])[0]; if (!full || item !== m) return;
      full.server = m.server; item = full; draw(); UI.setHandler(keys);
      rowsFor(full).then(function (rows) {
        if (item !== full) return;
        var el = $('plexPageRows'); if (!el || !rows.length) return;
        shelf = PlexShelf.make(el, full.server, rows);
      });
    }, function (e) { U.toast(e.message, 6000); });
  }
  // From inside the page: another title (from a row), Back returns here.
  function openFrom(m) { hist.push(item); m.server = m.server || item.server; show(m); }
  // The badges a version earns: 4K, HDR or Dolby Vision, Atmos, the sound's channels.
  function badges(media) {
    var v = media || {}, out = [];
    if (/4k/i.test(v.videoResolution)) out.push('4K'); else if (v.videoResolution) out.push(String(v.videoResolution).toUpperCase() + (/^\d+$/.test(v.videoResolution) ? 'p' : ''));
    var vs = streamsOf(v, 1)[0] || {};
    if (vs.DOVIPresent) out.push('Dolby Vision'); else if (/smpte2084|arib-std-b67/i.test(vs.colorTrc || '')) out.push('HDR');
    var as = streamsOf(v, 2)[0] || {};
    if (/atmos/i.test(as.displayTitle || as.extendedDisplayTitle || '')) out.push('Atmos');
    if (v.audioChannels) out.push(v.audioChannels > 2 ? (v.audioChannels - 1) + '.1' : T('Stereo'));
    return out;
  }
  function streamsOf(media, type) { var p = media && media.Part && media.Part[0]; return ((p && p.Stream) || []).filter(function (s) { return s.streamType === type; }); }
  function version(m) { m = m || item; var list = m.Media || []; return list[Math.min(versionOf[m.ratingKey] || 0, list.length - 1)] || {}; }
  function facts(m) {
    var ep = m.type === 'episode';
    if (m.type === 'show') return [m.year, m.contentRating, m.childCount ? count(m.childCount, T('1 season'), '{n} seasons') : '', m.leafCount ? count(m.leafCount, T('1 episode'), '{n} episodes') : '', m.studio].filter(Boolean).join('  ·  ');
    if (m.type === 'season') return [m.parentTitle, m.leafCount ? T('{n} episodes', { n: m.leafCount }) : ''].filter(Boolean).join('  ·  ');
    return [ep ? 'S' + m.parentIndex + ' · E' + m.index : '', m.year, m.contentRating, mins(m.duration) ? T('{n} min', { n: mins(m.duration) }) : '', m.duration ? T('Ends {x}', { x: U.hhmm ? U.hhmm(Date.now() + (m.duration - (m.viewOffset || 0))) : '' }) : ''].filter(Boolean).join('  ·  ');
  }
  // Draws the page over the Plex tab: the backdrop (fixed), and a part that scrolls: the top, the buttons, the rows.
  function draw() {
    var el = $('plexPage');
    // Built once: the backdrop's two layers stay, so going from page to page cross-fades between their pictures.
    if (!el) { el = U.el('div', 'plex-page'); el.id = 'plexPage'; el.innerHTML = '<div class="plex-shade"></div><div class="plex-page-body" id="plexPageBody"></div>'; $('viewPlex').appendChild(el); pageArt = PlexArt.make(el); }
    el.classList.remove('hidden');
    var m = item, ep = m.type === 'episode', v = version(), plays = /^(movie|episode)$/.test(m.type);
    var scores = (m.rating ? '<span class="plex-score">' + esc(T('Critics {x}', { x: Math.round(m.rating * 10) + '%' })) + '</span>' : '') + (m.audienceRating ? '<span class="plex-score">' + esc(T('Audience {x}', { x: Math.round(m.audienceRating * 10) + '%' })) + '</span>' : '');
    var people = ((m.Director || []).slice(0, 1).map(function (d) { return T('Directed by {x}', { x: d.tag }); }).concat((m.Genre || []).slice(0, 3).map(function (g) { return g.tag; }))).join('  ·  ');
    btns = buttons();
    var kicker = ep ? m.grandparentTitle : m.type === 'season' ? m.parentTitle : (m.librarySectionTitle || 'Plex');
    $('plexPageBody').innerHTML =
      '<div class="plex-page-scroll" id="plexPageScroll"><div class="plex-page-top"><div class="media-kicker" id="plexPageKicker">' + esc(kicker) + '</div>' +
      '<div class="media-title" id="plexPageName">' + esc(m.title) + '</div><div class="media-facts">' + esc(facts(m)) + '</div>' +
      '<div class="plex-badges">' + (plays ? badges(v).map(function (b) { return '<span class="plex-badge">' + esc(b) + '</span>'; }).join('') : '') + scores + '</div>' +
      '<div class="media-summary plex-summary">' + esc(m.summary || (m.type === 'season' ? '' : '')) + '</div><div class="plex-people">' + esc(people) + '</div></div>' +
      '<div class="plex-btns" id="plexPageBtns">' + btns.map(function (b, i) { return '<div class="plex-btn' + (i === btnAt ? ' sel' : '') + (b.main ? ' main' : '') + '">' + esc(b.label) + '</div>'; }).join('') + '</div>' +
      '<div class="plex-page-track">' + (plays ? track() : '') + '</div><div class="plex-page-rows" id="plexPageRows"></div></div>';
    pageArt.show(m.server, m.art || m.grandparentArt || m.parentArt || m.thumb);
    logo(m);
  }
  // "1 season" or "6 seasons" (English has no plural forms in the dictionaries).
  function count(n, one, many) { return n === 1 ? one : T(many, { n: n }); }
  // A key moved the focus: the ring on the button, or the rows scrolled up into view (no redraw of the page).
  function paint() {
    var b = $('plexPageBtns'), sc = $('plexPageScroll');
    if (b) [].forEach.call(b.children, function (x, i) { x.classList.toggle('sel', zone === 'btns' && i === btnAt); });
    if (sc) sc.style.transform = 'translateY(' + (zone === 'rows' && shelf ? -(SCROLL_TOP + shelf.scroll()) : 0) + 'px)';
    var pg = $('plexPage'); if (pg) pg.classList.toggle('rows', zone === 'rows');   // the art dims behind the rows, as on Plex
    if (shelf) shelf.paint(zone === 'rows');
  }
  var SCROLL_TOP = 770;
  /* The page's rows, read when it opens.  A movie: Cast and crew, Extras, each collection it's in, More like this.
     An episode: the rest of its season, Cast and crew.  A show: Seasons, Cast and crew, Extras, More like this.  A
     season: its Episodes. */
  function rowsFor(m) {
    var out = [], jobs = [], people = (m.Director || []).map(function (d) { return { tag: d.tag, job: T('Director'), thumb: d.thumb, id: d.id, kind: 'director' }; })
      .concat((m.Role || []).map(function (r) { return { tag: r.tag, role: r.role, thumb: r.thumb, id: r.id, kind: 'actor' }; })).slice(0, 30);
    var related = ((m.Related && m.Related.Hub) || []).filter(function (h) { return (h.Metadata || []).length; });
    var extras = ((m.Extras && m.Extras.Metadata) || []);
    if (m.type === 'season' || m.type === 'show') jobs.push(Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/children').then(function (j) {
      var kids = mc(j).Metadata || []; if (kids.length) out.push({ order: 0, title: m.type === 'show' ? T('Seasons') : T('Episodes'), kind: m.type === 'show' ? 'poster' : 'wide', items: kids });
    }, function () {}));
    if (m.type === 'episode' && m.parentRatingKey) jobs.push(Plex.call(m.server, '/library/metadata/' + m.parentRatingKey + '/children').then(function (j) {
      var kids = mc(j).Metadata || []; if (kids.length > 1) out.push({ order: 0, title: m.parentTitle || T('Season {n}', { n: m.parentIndex }), kind: 'wide', items: kids });
    }, function () {}));
    if (people.length) out.push({ order: 1, title: T('Cast and crew'), kind: 'person', items: people });
    if (extras.length) out.push({ order: 2, title: T('Extras'), kind: 'wide', items: extras });
    (m.Collection || []).slice(0, 3).forEach(function (c, n) {
      if (!c.id) return;
      jobs.push(Plex.call(m.server, '/library/collections/' + c.id + '/children').then(function (j) {
        var kids = (mc(j).Metadata || []).filter(function (x) { return String(x.ratingKey) !== String(m.ratingKey); });
        if (kids.length) out.push({ order: 3 + n / 10, title: T('More in {x}', { x: c.tag }), kind: 'poster', items: kids });
      }, function () {}));
    });
    related.slice(0, 3).forEach(function (h, n) { out.push({ order: 4 + n / 10, title: h.title || T('More like this'), kind: 'poster', items: h.Metadata }); });
    if (!related.length && /^(movie|show)$/.test(m.type)) jobs.push(Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/similar').then(function (j) {
      var kids = mc(j).Metadata || []; if (kids.length) out.push({ order: 4, title: T('More like this'), kind: 'poster', items: kids });
    }, function () {}));
    return Promise.all(jobs).then(function () { out.sort(function (a, b) { return a.order - b.order; }); out.forEach(function (r) { r.items.forEach(function (x) { x.server = x.server || m.server; }); }); return out; });
  }
  /* The title logo (Plex's clearLogo) in place of the name: a movie's or a show's own; an episode's or a season's
     show's in place of the show's name above. */
  function logo(m) {
    var small = m.type === 'episode' || m.type === 'season', t = $(small ? 'plexPageKicker' : 'plexPageName');
    if (t) t.classList.add('unseen');   // the name waits unseen until it's known whether a logo takes its place
    var showName = function () { if (t) t.classList.remove('unseen'); };
    // A movie's or show's own list of pictures has its logo (no wait for the details); an episode's is its show's.
    var own = small ? '' : PlexView.logoOf(m);
    (own ? Promise.resolve({ logo: own }) : PlexView.details(m)).then(function (d) { return d.logo && item === m ? PlexView.file(m.server, d.logo) : ''; }).then(function (u) {
      if (!u || !t || item !== m) return showName();
      var lg = U.el('img', 'media-logo' + (small ? ' small' : '')); lg.alt = small ? m.grandparentTitle || m.parentTitle || '' : m.title || '';
      lg.onload = function () { if (t.parentNode) t.parentNode.replaceChild(lg, t); };
      lg.onerror = showName;
      lg.src = u;
    }, showName);
  }
  // The track under the buttons: what's playing in it (the version, its sound and subtitles).
  function track() {
    var v = version(), a = streamsOf(v, 2).filter(function (s) { return s.selected; })[0] || streamsOf(v, 2)[0], s = streamsOf(v, 3).filter(function (x) { return x.selected; })[0];
    var bits = [(item.Media || []).length > 1 ? T('Version: {x}', { x: describeVersion(v) }) : '', a ? T('Audio: {x}', { x: a.displayTitle || a.language || '' }) : '', T('Subtitles: {x}', { x: s ? s.displayTitle || s.language : T('Off') })];
    return esc(bits.filter(Boolean).join('    '));
  }
  function describeVersion(v) { return [String(v.videoResolution || '').toUpperCase(), (v.videoCodec || '').toUpperCase(), v.Part && v.Part[0] && v.Part[0].size ? (v.Part[0].size / 1073741824).toFixed(1) + ' GB' : ''].filter(Boolean).join(' · '); }
  /* The buttons.  A movie or an episode: Resume, Play from the start, Trailer, Watched, More.  A show or a season:
     Play (or Resume) its next episode, Watched, More. */
  function buttons() {
    var m = item, out = [];
    if (/^(show|season)$/.test(m.type)) {
      var nx = m.OnDeck && m.OnDeck.Metadata && m.OnDeck.Metadata[0];
      out.push({ label: nx ? (nx.viewOffset > 60000 ? T('Resume S{x} · E{y}', { x: nx.parentIndex, y: nx.index }) : T('Play S{x} · E{y}', { x: nx.parentIndex, y: nx.index })) : T('Play'), main: true, act: function () { playNext(m); } });
      var allSeen = m.leafCount && m.viewedLeafCount >= m.leafCount;
      out.push({ label: allSeen ? T('Mark not watched') : T('Mark watched'), act: function () { mark(!allSeen); } });
      out.push({ label: T('More'), act: more });
      return out;
    }
    if (m.viewOffset > 60000) out.push({ label: T('Resume from {x}', { x: clock(m.viewOffset) }), main: true, act: function () { play(m.viewOffset); } });
    out.push({ label: m.viewOffset > 60000 ? T('Play from the start') : T('Play'), main: !(m.viewOffset > 60000), act: function () { play(0); } });
    var trailer = ((m.Extras && m.Extras.Metadata) || []).filter(function (x) { return x.subtype === 'trailer' || x.extraType === 1; })[0];
    if (trailer) out.push({ label: T('Trailer'), act: function () { trailer.server = m.server; playOther(trailer); } });
    var watched = m.viewCount > 0 && !m.viewOffset;
    out.push({ label: watched ? T('Mark not watched') : T('Mark watched'), act: function () { mark(!watched); } });
    out.push({ label: T('More'), act: more });
    return out;
  }
  // A show's or a season's next episode: the one you're in, else the first not watched, else the first.
  function playNext(m) {
    Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/allLeaves').then(function (j) {
      var eps = mc(j).Metadata || [], nx = eps.filter(function (e) { return e.viewOffset; })[0] || eps.filter(function (e) { return !e.viewCount; })[0] || eps[0];
      if (!nx) return U.toast(T('Nothing to play yet'), 5000);
      playKey(m.server, String(nx.ratingKey), false).catch(function (e) { U.toast(e.message, 6000); });
    }, function (e) { U.toast(e.message, 6000); });
  }
  function mark(on) {
    Plex.call(item.server, (on ? '/:/scrobble' : '/:/unscrobble') + '?identifier=com.plexapp.plugins.library&key=' + item.ratingKey).then(function () {
      if (on) { item.viewCount = (item.viewCount || 0) + 1; item.viewOffset = 0; item.viewedLeafCount = item.leafCount; } else { item.viewCount = 0; item.viewedLeafCount = 0; }
      U.toast(on ? T('Marked as watched') : T('Marked as not watched')); redrawButtons();
    }, function (e) { U.toast(e.message, 6000); });
  }
  // The buttons again (their words changed), the rest of the page as it is.
  function redrawButtons() {
    btns = buttons(); var b = $('plexPageBtns'); if (!b) return;
    btnAt = Math.min(btnAt, btns.length - 1);
    b.innerHTML = btns.map(function (x, i) { return '<div class="plex-btn' + (zone === 'btns' && i === btnAt ? ' sel' : '') + (x.main ? ' main' : '') + '">' + esc(x.label) + '</div>'; }).join('');
  }
  // More: the version, audio and subtitles (Plex remembers them for you), the Watchlist, Continue watching, Go to show.
  function more() {
    var m = item, v = version(), part = v.Part && v.Part[0], rows = [];
    if ((m.Media || []).length > 1) rows.push({ label: T('Version'), sub: RAW(describeVersion(v)), action: function () {
      UI.menu(T('Version'), m.Media.map(function (x, i) { return { label: RAW(describeVersion(x)), sub: RAW(badges(x).join('  ·  ')), action: function () { versionOf[m.ratingKey] = i; draw(); } }; }));
    } });
    if (part) rows.push({ label: T('Audio'), action: function () { pickStream(part, 2); } }, { label: T('Subtitles'), action: function () { pickStream(part, 3); } });
    // The Watchlist (Plex's, the same in every Plex app).
    if (/^(movie|show)$/.test(m.type) && m.guid && typeof PlexTop !== 'undefined') {
      var on = PlexTop.onWatch(m);
      rows.push({ label: on ? T('Remove from Watchlist') : T('Add to Watchlist'), action: function () {
        Plex.watch(m.guid, !on).then(function () { PlexTop.changedWatch(); U.toast(on ? T('Removed from your Watchlist') : T('Added to your Watchlist')); }, function (e) { U.toast(e.message, 6000); });
      } });
    }
    if (m.viewOffset) rows.push({ label: T('Remove from Continue watching'), action: function () {
      Plex.call(m.server, '/actions/removeFromContinueWatching?ratingKey=' + m.ratingKey, 'put').then(function () { m.viewOffset = 0; U.toast(T('Removed from Continue watching')); redrawButtons(); }, function (e) { U.toast(e.message, 6000); });
    } });
    if (m.type === 'episode' && m.grandparentRatingKey) rows.push({ label: T('Go to show'), action: function () { openFrom({ ratingKey: m.grandparentRatingKey, type: 'show', title: m.grandparentTitle, server: m.server }); } });
    if (m.type === 'episode' && m.parentRatingKey) rows.push({ label: T('Go to season'), action: function () { openFrom({ ratingKey: m.parentRatingKey, type: 'season', title: m.parentTitle, server: m.server }); } });
    if (m.type === 'season' && m.parentRatingKey) rows.push({ label: T('Go to show'), action: function () { openFrom({ ratingKey: m.parentRatingKey, type: 'show', title: m.parentTitle, server: m.server }); } });
    UI.menu(RAW(m.title), rows);
  }
  // An audio or subtitle track picked: kept by Plex for this title (and by TiviBro's player while it plays).
  function pickStream(part, type, after, title, up) {
    up = up || (UI.pendingBack ? UI.pendingBack() : null);   // from the player's Options: Back goes back there
    var m = title || item, list = (part.Stream || []).filter(function (s) { return s.streamType === type; });
    var rows = (type === 3 ? [{ label: T('Off'), current: !list.some(function (s) { return s.selected; }), action: function () { choose(0); } }] : []).concat(list.map(function (s) { return { label: RAW(s.displayTitle || s.extendedDisplayTitle || s.language || '?'), sub: RAW(s.title || ''), current: !!s.selected, action: function () { choose(s.id); } }; }));
    // Subtitles: Plex's own search (OpenSubtitles and the others the server has), as Plex's apps have it.
    if (type === 3) rows.push({ label: T('Search for subtitles'), sub: T('Plex looks them up online for this title'), action: function () { searchSubs(m, part, after, function () { pickStream(part, type, after, title, up); }); } });
    function choose(id) {
      var q = type === 2 ? 'audioStreamID=' + id : 'subtitleStreamID=' + id;
      Plex.call(m.server, '/library/parts/' + part.id + '?allParts=1&' + q, 'put').then(function () { list.forEach(function (s) { s.selected = s.id === id; }); if (after) after(id); else { var t = document.querySelector('#plexPage .plex-page-track'); if (t) t.innerHTML = track(); } }, function (e) { U.toast(e.message, 6000); });
    }
    UI.menu(type === 2 ? T('Audio') : T('Subtitles'), rows, up);
  }
  /* Subtitle search through the server: a language (the TV's first, then English and the others TiviBro speaks),
     what Plex found for it, and the one picked is fetched by the server, turned on and (while watching) the title
     starts again from where it was with it.  back(): the Subtitles list again. */
  function searchSubs(m, part, after, back) {
    var mine = (typeof I18n !== 'undefined' && I18n.lang ? I18n.lang() : 'en').split('-')[0], seen = {}, langs = [];
    var all = typeof I18n !== 'undefined' && I18n.langs ? I18n.langs() : [{ code: 'en', name: 'English' }];
    [mine, 'en'].concat(all.map(function (l) { return l.code.split('-')[0]; })).forEach(function (c) {
      if (seen[c]) return; seen[c] = 1;
      var l = all.filter(function (x) { return x.code.split('-')[0] === c; })[0];
      langs.push({ code: c, name: l ? l.name : c });
    });
    function pickLang() { UI.menu(T('Search for subtitles'), langs.map(function (l) { return { label: RAW(l.name), action: function () { look(l); } }; }), back); }
    function look(l) {
      U.toast(T('Looking for subtitles…'), 4000);
      Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/subtitles?language=' + l.code + '&hearingImpaired=0&forced=0').then(function (j) {
        var found = (mc(j).Stream || []).slice(0, 40);
        if (!found.length) { U.toast(T('Plex found no subtitles in {x}', { x: RAW(l.name) }), 6000); return pickLang(); }
        UI.menu(T('Subtitles in {x}', { x: RAW(l.name) }), found.map(function (x) {
          var bits = [x.providerTitle, x.score ? T('match {x}%', { x: Math.round(+x.score) }) : '', x.perfectMatch ? T('made for this file') : '', x.hearingImpaired ? 'SDH' : ''].filter(Boolean).join('  ·  ');
          return { label: RAW(x.title || x.displayTitle || l.name), sub: RAW(bits), action: function () { fetchSub(x, l); } };
        }), pickLang);
      }, function (e) { U.toast(e.message, 6000); });
    }
    // The server fetches it; it shows up among the title's subtitles a moment later, and is turned on.
    function fetchSub(x, l) {
      var had = {}; (part.Stream || []).forEach(function (s) { had[s.id] = 1; });
      var q = '?key=' + encodeURIComponent(x.key || '') + '&codec=' + encodeURIComponent(x.codec || 'srt') + '&language=' + encodeURIComponent(x.languageCode || l.code) +
        '&hearingImpaired=' + (x.hearingImpaired ? 1 : 0) + '&forced=' + (x.forced ? 1 : 0) + '&providerTitle=' + encodeURIComponent(x.providerTitle || '');
      U.toast(T('Getting the subtitles…'), 4000);
      Plex.call(m.server, '/library/metadata/' + m.ratingKey + '/subtitles' + q, 'put').then(function () {
        var tries = 0;
        (function wait() {
          Plex.call(m.server, '/library/metadata/' + m.ratingKey).then(function (j) {
            var md = (mc(j).Metadata || [])[0] || {}, p2 = ((md.Media || [])[0] || {}).Part || [], fresh = null;
            p2.forEach(function (pp) { if (pp.id === part.id) { (pp.Stream || []).forEach(function (s) { if (s.streamType === 3 && !had[s.id]) fresh = fresh || s; }); if (fresh) part.Stream = pp.Stream; } });
            if (!fresh) { if (++tries < 10) return setTimeout(wait, 2000); return U.toast(T('Plex is still getting the subtitles.  Try Subtitles again in a moment.'), 7000); }
            Plex.call(m.server, '/library/parts/' + part.id + '?allParts=1&subtitleStreamID=' + fresh.id, 'put').then(function () {
              part.Stream.forEach(function (s) { if (s.streamType === 3) s.selected = s.id === fresh.id; });
              U.toast(T('Subtitles on'), 3000);
              if (after) after(fresh.id); else { var t = document.querySelector('#plexPage .plex-page-track'); if (t) t.innerHTML = track(); }
            }, function (e) { U.toast(e.message, 6000); });
          }, function () { if (++tries < 10) setTimeout(wait, 2000); });
        })();
      }, function (e) { U.toast(e.message, 6000); });
    }
    pickLang();
  }

  /* Keys: ◀ ▶ along the buttons, ▼ into the rows (the page scrolls up), OK plays or opens, Back goes to the page
     before (a title opened from a row) or out to the Plex tab.  Hold OK or Red: More.  Yellow: watched or not. */
  function keys(a) {
    if (a === 'back') {
      if (zone === 'rows') { zone = 'btns'; paint(); return true; }
      if (hist.length) { show(hist.pop()); return true; }
      close(); if (back) back(); return true;
    }
    if (zone === 'rows' && shelf) {
      if (a === 'up' && shelf.row === 0) { zone = 'btns'; paint(); return true; }
      var f = shelf.focused();
      if (a === 'ok') { if (f && f.item) pick(f.row, f.item); return true; }
      // Hold OK or Red on a title in a row: its options (play, watched, Watchlist...), as on the Plex tab.
      if ((a === 'hold' || a === 'red') && f && f.item && f.row.kind !== 'person' && /^(movie|episode|show|season)$/.test(f.item.type)) { f.item.server = f.item.server || item.server; PlexView.itemOptions(f.item); return true; }
      if (shelf.move(a)) { paint(); return true; }
      return true;
    }
    if (a === 'left') { if (btnAt > 0) { btnAt--; paint(); } return true; }
    if (a === 'right') { if (btnAt < btns.length - 1) { btnAt++; paint(); } return true; }
    if (a === 'down') { if (shelf) { zone = 'rows'; paint(); } return true; }
    if (a === 'ok') { if (btns[btnAt]) btns[btnAt].act(); return true; }
    if (a === 'red' || a === 'hold') { more(); return true; }
    if (a === 'yellow') { if (btns.some(function (b) { return /watched/i.test(b.label); })) mark(!(item.viewCount > 0 && !item.viewOffset)); return true; }
    return true;
  }
  // OK on a row's tile: a person's titles, an extra plays, anything else opens its own page.
  function pick(row, x) {
    if (row.kind === 'person') { hide(); PlexView.openPerson(item, x); return; }
    if (x.type === 'clip' || x.subtype) { x.server = item.server; playOther(x); return; }
    if (x.type === 'collection' || x.type === 'playlist') { hide(); x.page = true; PlexView.openShow(x); return; }
    openFrom(x);
  }
  function close() { hide(); btnAt = 0; zone = 'btns'; }
  // Out of sight while a person's titles or a collection show over the Plex tab; reshow() brings it back as it was.
  function hide() { var el = $('plexPage'); if (el) el.classList.add('hidden'); }
  function reshow() {
    var el = $('plexPage'); if (!el || !item) return false;
    el.classList.remove('hidden'); paint(); UI.setHandler(keys); return true;
  }

  /* ---------- Playing ---------- */
  // The TV plays this version's video as it is (sound is TiviBro's converter's job when the TV can't).
  function direct(v) { return DIRECT_VIDEO.test(v.videoCodec || '') && DIRECT_BOX.test(v.container || ''); }
  function newSession() { session = 'tivibro-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); return session; }
  /* The server converts it when the TV can't play its video, when Settings > Plex says always, or when the file is
     bigger than the quality cap (Plex's "play smaller videos at original quality": a file under the cap plays as is). */
  function converts(v) {
    var cap = quality();
    return !Plex.prefs().direct || !direct(v) || needsBoth(v) || !!(cap && v.bitrate && v.bitrate > cap);
  }
  /* Sound the TV can't play goes through TiviBro's own sound converter, which sends the movie on as MPEG-TS: fine
     for H.264 and HEVC, but AV1, VP9 and MPEG-4 video can't go in MPEG-TS, so the picture stayed black with the
     sound playing (an AV1 movie with Opus sound).  Those go to the server's converter instead. */
  var TV_SOUND = /^(aac|ac3|eac3|mp3|mp2)$/i, TS_VIDEO = /^(h264|hevc|h265)$/i;
  function needsBoth(v) { return !!v.audioCodec && !TV_SOUND.test(v.audioCodec) && !TS_VIDEO.test(v.videoCodec || ''); }
  /* Starts the title at ms: the file through the door, or the server's converter.  Plex's preview pictures, its
     chapters and a subtitle file kept beside the video go to the player too (a file played as it is). */
  function play(ms, fromUpNext) {
    if (!fromUpNext) { chain = 0; forceCap = null; }
    var m = item, v = version(), part = v.Part && v.Part[0];
    if (!part) return U.toast(T('Plex has no file for this one.'), 6000);
    Plex.door(m.server).then(function (key) {
      var base = 'http://127.0.0.1:' + Net.port + '/plex/' + key, url, converting = converts(v), cap = quality();
      if (!converting) url = base + part.key;
      else url = base + '/video/:/transcode/universal/start.m3u8?path=' + encodeURIComponent('/library/metadata/' + m.ratingKey) + '&mediaIndex=' + Math.max(0, (m.Media || []).indexOf(v)) + '&partIndex=0&protocol=hls&fastSeek=1&directPlay=0&directStream=1&directStreamAudio=1&videoQuality=100' + (cap ? '&maxVideoBitrate=' + cap + resFor(cap) : '') + '&subtitles=burn&copyts=1&offset=0&session=' + newSession();
      var meta = { id: 'plex:' + m.server + ':' + m.ratingKey, plex: true, serverConvert: converting, plexNext: m.type === 'episode' ? 'episode' : '', title: m.type === 'episode' ? m.grandparentTitle + '  S' + m.parentIndex + ' · E' + m.index : m.title, sub: m.type === 'episode' ? m.title : [m.year, m.contentRating].filter(Boolean).join('  ·  '), marks: marks(m), chapters: converting ? [] : chapters(m) };
      if (!converting && /(^|,)sd(,|$)/.test(part.indexes || '')) meta.pics = function (t) { return base + '/library/parts/' + part.id + '/indexes/sd/' + Math.round(t * 1000); };
      playing = { item: m, meta: meta, converting: converting, last: 0, scrobbled: false };
      lastPlay = describe(m, v, converting, cap);
      if (typeof Log !== 'undefined') { Log.info('plex', 'Playing: ' + lastPlay); Log.state('plex', 'playing a Plex ' + (m.type || 'title') + (converting ? ', converted by the server' : ', as the file is')); }
      /* The converter's playlist covers the whole title (it converts from wherever the player asks), so both ways
         start the player where you stopped and its times are the title's own (progress to Plex, Skip intro). */
      // Back from watching: to the title's page when it was open (its buttons take the keys again), else the Plex tab.
      var page = $('plexPage'), fromPage = !!(page && !page.classList.contains('hidden'));
      Views.playVod(meta, url, ms / 1000, function () { report('stopped'); stopTimer(); if (typeof Log !== 'undefined') Log.state('plex', 'browsing Plex'); if (fromPage && item) { var el = $('plexPage'); if (el) el.classList.remove('hidden'); paint(); UI.setHandler(keys); } else if (PlexView.resume) PlexView.resume(); });
      startTimer();
      // The title logo over the timeline (an episode shows its show's), once it's known.
      var own = m.type === 'episode' ? '' : PlexView.logoOf(m);
      (own ? Promise.resolve({ logo: own }) : PlexView.details(m)).then(function (d) { if (d.logo && playing && playing.meta === meta) { meta.logo = base + d.logo; if (Views.refreshVodMeta) Views.refreshVodMeta(); } }, function () {});
      if (!converting) { sideSubtitle(base, part, playing); inFileSubtitle(part, playing); }
      // Dolby Vision or HDR converted down: the server turns it into an ordinary picture (tone mapping, when it's on
      // in the server's settings), which is heavy work; Original keeps it.
      var vs1 = ((v.Part && v.Part[0] && v.Part[0].Stream) || []).filter(function (x) { return x.streamType === 1; })[0] || {};
      var hdr = vs1.DOVIPresent || /smpte2084|arib-std-b67/i.test(vs1.colorTrc || '') || /HDR|Dolby Vision/i.test(vs1.displayTitle || '');
      if (converting && hdr) U.toast(T('{x} is converting this {y} movie to a lower quality, so it plays without HDR.  Quality > Original keeps it.', { x: (Plex.server(m.server) || {}).name || 'Plex', y: vs1.DOVIPresent ? 'Dolby Vision' : 'HDR' }), 8000);
      else if (converting) U.toast(T('{x} is converting this one for the TV', { x: (Plex.server(m.server) || {}).name || 'Plex' }), 5000);
      notices(m);
    }, function (e) { U.toast(e.message, 6000); });
  }
  // Plex's chapters as the player takes them (seconds, with their names).
  function chapters(m) { return (m.Chapter || []).map(function (c) { return { s: c.startTimeOffset / 1000, e: c.endTimeOffset / 1000, t: c.tag || '' }; }).filter(function (c) { return c.e > c.s; }); }
  /* The subtitle picked in Plex, when it's a file beside the video (SRT, ASS, VTT): read through the door and given to
     the player.  Subtitles inside the file are the player's own job. */
  function sideSubtitle(base, part, p, wait) {
    var s = (part.Stream || []).filter(function (x) { return x.streamType === 3 && x.selected && x.key; })[0];
    if (!s || !/^(srt|ass|ssa|vtt|webvtt|smi|sub)$/i.test(s.codec || 'srt') || typeof Subs === 'undefined') return;
    setTimeout(function () {
      if (playing !== p) return;
      fetch(base + s.key, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (text) {
        if (!text || playing !== p) return;
        try { Subs.addText((s.language || s.displayTitle || 'Plex') + '.' + (s.codec || 'srt'), text); } catch (e) { if (typeof Log !== 'undefined') Log.warn('plex', 'Plex\'s subtitle file: ' + e.message); }
      }, function () {});
    }, wait == null ? 1500 : wait);
  }
  function playOther(x) { var keep = item; item = x; Plex.call(x.server, '/library/metadata/' + x.ratingKey).then(function (j) { item = (mc(j).Metadata || [])[0] || x; item.server = x.server; play(0); item = keep; }, function (e) { item = keep; U.toast(e.message, 6000); }); }
  // The quality cap for the converter (kbps, 0: Original): Settings > Plex, at home and away.
  function quality() {
    var s = Plex.server(item.server) || {}, p = Plex.prefs(), cap = forceCap != null ? forceCap : +(s.local ? p.homeQuality : p.awayQuality) || 0;
    // Through Plex's relay (the server can't be reached directly), Plex lets through 2 Mbps at most.
    return s.relay ? Math.min(cap || RELAY, RELAY) : cap;
  }
  var RELAY = 2000;
  // The picture size that goes with a quality (Plex's apps send both): "&videoResolution=1920x1080".
  function resFor(cap) { var q = Plex.qualityOf(cap) || Plex.QUALITY.filter(function (x) { return x.b && x.b <= cap; })[0]; return q && q.w ? '&videoResolution=' + q.w + 'x' + q.h : ''; }
  /* Before playing: away from home without Plex Pass, a word on why it may not play (the server owner's Plex Pass
     counts too, which the TV can't see); through the relay, why it's soft.  Once per server a day. */
  var told = {};
  function notices(m) {
    var s = Plex.server(m.server) || {}, day = new Date().toDateString(), k = m.server + day;
    if (told[k]) return; told[k] = 1;
    if (s.relay) U.toast(T('{x} is reached through Plex\'s relay, so video is 2 Mbps at most.  Turning on Remote Access on the server helps.', { x: s.name || 'Plex' }), 8000);
    else if (!s.local && !Plex.user().pass) U.toast(T('Away from home, Plex plays only with Plex Pass (yours or the server owner\'s) or a Remote Watch Pass.'), 8000);
  }
  // Plex's intro and credits markers, as Skip intro and Skip credits take them (seconds).
  function marks(m) {
    var out = { intro: null, recap: null, credits: -1, creditsEnd: -1 };
    (m.Marker || []).forEach(function (k) {
      if (k.type === 'intro' && !out.intro) out.intro = [k.startTimeOffset / 1000, k.endTimeOffset / 1000];
      if (k.type === 'credits' && out.credits < 0) { out.credits = k.startTimeOffset / 1000; out.creditsEnd = k.final ? -1 : k.endTimeOffset / 1000; }
    });
    return out.intro || out.credits >= 0 ? out : null;
  }
  /* Where you are, to Plex every 10 s (and at pause and stop); 90% marks it watched, as Plex does. */
  function startTimer() { stopTimer(); timer = setInterval(function () { report(Player.paused ? 'paused' : 'playing'); }, 10000); }
  function stopTimer() { clearInterval(timer); timer = 0; }
  function report(state) {
    var p = playing; if (!p || typeof Player === 'undefined') return;
    var at = Math.round((Player.position || 0) * 1000), dur = p.item.duration || Math.round((Player.duration || 0) * 1000);
    if (state !== 'stopped' && at === p.last) return;
    p.last = at;
    Plex.call(p.item.server, '/:/timeline?ratingKey=' + p.item.ratingKey + '&key=' + encodeURIComponent('/library/metadata/' + p.item.ratingKey) + '&state=' + state + '&time=' + at + '&duration=' + dur + '&identifier=com.plexapp.plugins.library').catch(function () {});
    if (!p.scrobbled && dur && at >= dur * 0.9) { p.scrobbled = true; Plex.call(p.item.server, '/:/scrobble?identifier=com.plexapp.plugins.library&key=' + p.item.ratingKey).catch(function () {}); }
    if (state === 'stopped') playing = null;
  }

  /* ---------- Options while watching: the player's Options (Red) open on a Plex tab, as in Plex's player ---------- */
  var forceCap = null;   // a quality picked while watching: kept for this title until another is started by hand
  function qLabel(q) { return Plex.qualityName(q); }
  /* For a report: how the last Plex title played, without its name: what kind of title, the file (container,
     codecs, size, bitrate, Dolby Vision or HDR), and whether the TV played it as it is or the server converted it
     (and why: the TV can't play it, the quality cap, or Settings), with the server's own figures once read. */
  var lastPlay = '';
  function describe(m, v, converting, cap) {
    var vs = ((v.Part && v.Part[0] && v.Part[0].Stream) || []).filter(function (x) { return x.streamType === 1; })[0] || {};
    var why = !converting ? '' : !Plex.prefs().direct ? 'Settings: always convert' : !direct(v) ? 'the TV can\'t play ' + (v.videoCodec || '?') + ' in ' + (v.container || '?') : needsBoth(v) ? 'picture and sound both need converting' : 'quality cap ' + cap + ' kbps';
    return [m.type || 'title', v.container, v.videoCodec, v.videoResolution, v.bitrate ? Math.round(v.bitrate / 100) / 10 + ' Mbps' : '', vs.DOVIPresent ? 'Dolby Vision' + (vs.DOVIProfile ? ' ' + vs.DOVIProfile : '') : /smpte2084|arib-std-b67/i.test(vs.colorTrc || '') ? 'HDR' : '', v.audioCodec, v.audioChannels ? v.audioChannels + ' ch' : ''].filter(Boolean).join(' ') +
      '; ' + (converting ? 'converted by the server (' + why + ')' : 'played as the file is') + (Plex.server(m.server) ? ', server ' + (Plex.server(m.server).relay ? 'through relay' : Plex.server(m.server).local ? 'on the home network' : 'over the internet') : '');
  }
  function diag() { return lastPlay || 'nothing yet'; }
  /* The subtitle picked in Plex when it's a track inside the file: on in the player once the TV has found the file's
     tracks (a few seconds in), so what Plex shows is what plays. */
  function inFileSubtitle(part, p) {
    var s = (part.Stream || []).filter(function (x) { return x.streamType === 3 && x.selected && !x.key; })[0], tries = 0;
    if (!s) return;
    (function look() {
      if (playing !== p) return;
      if (Views.subtitleTracks().length) return subChanged(part, s.id);
      if (++tries < 30) setTimeout(look, 500);
    })();
  }
  /* A subtitle picked while watching.  Converted by the server: it's burnt into the picture, so the title starts
     again from where it is.  Played as it is: no restart; a file beside it (or one Plex just fetched) is read and
     shown, a track inside the file is turned on in the player (the TV found them in the file), or none for Off. */
  function subChanged(part, id) {
    if (!playing || playing.converting) return restart();
    var s = (part.Stream || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return Views.showText(null);
    if (s.key) return Plex.door(playing.item.server).then(function (k) { sideSubtitle('http://127.0.0.1:' + Net.port + '/plex/' + k, part, playing, 0); });
    // Inside the file: the same place among the file's subtitles, else the same language.
    var inFile = (part.Stream || []).filter(function (x) { return x.streamType === 3 && !x.key; }), at = inFile.indexOf(s);
    var tracks = Views.subtitleTracks(), lang = String(s.languageCode || s.language || '').slice(0, 2).toLowerCase();
    var t = tracks[at] && tracks.length === inFile.length ? tracks[at] : tracks.filter(function (x) { return lang && String(x.language || x.label || '').toLowerCase().indexOf(lang) === 0; })[0];
    if (t) { Views.showText(t); U.toast(T('Subtitles on'), 2500); } else U.toast(T('The TV is still reading the subtitles in this file.  Try again in a moment.'), 6000);
  }
  // The title again from where it is now, with a new quality, audio or subtitle (Plex keeps the track choices).
  function restart() { var at = Math.round((Player.position || 0) * 1000); U.toast(T('One moment…'), 2000); play(at, true); }
  /* The rows of the Plex tab in the player's Options: Quality (Plex's list, with plain words), Audio and Subtitles
     (with Plex's subtitle search), Playback info, the next and previous episode, Mark watched.  [] when no Plex
     title is playing. */
  function playerItems() {
    var p = playing; if (!p) return [];
    var m = p.item, v = version(m), part = v.Part && v.Part[0], out = [], cap = quality(), srv = (Plex.server(m.server) || {}).name || 'Plex';
    var sel = function (type) { var x = (part && part.Stream || []).filter(function (s) { return s.streamType === type && s.selected; })[0]; return x ? RAW(x.displayTitle || x.language || '') : (type === 3 ? T('Off') : ''); };
    out.push({ label: T('Quality'), sub: p.converting ? (cap ? qLabel(cap) : T('Converted by {x}', { x: RAW(srv) })) : T('Original  ·  plays as it is'), action: function () {
      // Each with a few plain words (what it looks like, what internet it needs), as Plex lists them.
      var now = forceCap != null ? forceCap : cap;
      // Original and the qualities below the file's own (a higher one would be the same file, converted for nothing).
      var own = v.bitrate || 0, list = Plex.QUALITY.filter(function (q) { return !q.b || !own || q.b < own; });
      UI.menu(T('Quality'), list.map(function (q) { return { label: q.b ? qLabel(q.b) : T('Original') + (own ? '  ·  ' + T('{x} Mbps', { x: Math.round(own / 100) / 10 }) + (v.videoResolution ? '  ·  ' + RAW(/^\d+$/.test(v.videoResolution) ? v.videoResolution + 'p' : String(v.videoResolution).toUpperCase()) : '') : ''), sub: T(q.sub), current: now === q.b, action: function () { forceCap = q.b; restart(); } }; }), null,
        { sub: T('Mbps is how much picture comes each second: higher looks sharper, lower plays smoother on slow internet.') });
    } });
    if (part) {
      out.push({ label: T('Audio'), sub: sel(2), action: function () { pickStream(part, 2, restart, m); } });
      out.push({ label: T('Subtitles'), sub: sel(3), action: function () { pickStream(part, 3, function (id) { subChanged(part, id); }, m); } });
    }
    out.push({ label: T('Playback info'), sub: p.converting ? T('Converted by {x}', { x: RAW(srv) }) : T('Direct play'), action: function () { info(p, v, srv); } });
    if (m.type === 'episode') {
      out.push({ label: T('Next episode'), action: function () { step(m, 1); } }, { label: T('Previous episode'), action: function () { step(m, -1); } });
    }
    out.push({ label: T('Mark watched'), sub: T('and stop'), action: function () { Plex.call(m.server, '/:/scrobble?identifier=com.plexapp.plugins.library&key=' + m.ratingKey).then(function () { if (playing) playing.scrobbled = true; U.toast(T('Marked as watched')); Views.stopAll(); if (PlexView.resume) PlexView.resume(); }); } });
    return out;
  }
  // What's playing and how, as Plex's Playback info shows it.
  function info(p, v, srv) {
    var s = Plex.server(p.item.server) || {}, a = streamsOf(v, 2).filter(function (x) { return x.selected; })[0] || streamsOf(v, 2)[0] || {}, vs = streamsOf(v, 1)[0] || {};
    var rows = [
      { label: T('Playing'), sub: p.converting ? T('Converted by {x}', { x: RAW(srv) }) : T('Direct play: the file as it is') },
      { label: T('Video'), sub: RAW([String(v.videoResolution || '').toUpperCase(), (vs.codec || v.videoCodec || '').toUpperCase(), vs.DOVIPresent ? 'Dolby Vision' : '', v.bitrate ? (v.bitrate / 1000).toFixed(1) + ' Mbps' : ''].filter(Boolean).join('  ·  ')) },
      { label: T('Audio'), sub: RAW(a.displayTitle || [a.codec, a.channels].filter(Boolean).join(' ')) },
      { label: T('Server'), sub: RAW(srv) + '  ·  ' + (s.relay ? T('through Plex\'s relay') : s.local ? T('on your network') : T('over the internet')) }
    ];
    if (!p.converting) return UI.menu(T('Playback info'), rows);
    // Converting: what the server does with the picture and the sound, and how fast it keeps up (Plex's dashboard).
    Plex.call(p.item.server, '/transcode/sessions').then(function (j) {
      var t = (mc(j).TranscodeSession || []).filter(function (x) { return String(x.key || '').indexOf(session) >= 0; })[0];
      if (t) {
        lastPlay = lastPlay.replace(/; server said: .*$/, '') + '; server said: video ' + t.videoDecision + ', audio ' + t.audioDecision + ', speed ' + t.speed + (t.throttled ? ' (throttled)' : '') + (t.transcodeHwEncoding || t.transcodeHwDecoding ? ', graphics chip' : ', processor');
        if (typeof Log !== 'undefined') Log.info('plex', 'Converting: ' + JSON.stringify({ video: t.videoDecision, audio: t.audioDecision, from: t.sourceVideoCodec, to: t.videoCodec, size: t.width + 'x' + t.height, speed: t.speed, throttled: t.throttled, hw: t.transcodeHwRequested, hwDecode: t.transcodeHwDecoding, hwEncode: t.transcodeHwEncoding }));
        var how = function (d) { return d === 'copy' ? T('as it is') : d === 'transcode' ? T('converted') : RAW(d || ''); };
        rows.splice(1, 0,
          { label: T('Picture'), sub: RAW([how(t.videoDecision), t.sourceVideoCodec && t.videoCodec && t.videoDecision === 'transcode' ? String(t.sourceVideoCodec).toUpperCase() + ' → ' + String(t.videoCodec).toUpperCase() : '', t.width ? t.width + '×' + t.height : '', t.transcodeHwEncoding || t.transcodeHwDecoding ? T('by the graphics chip') : t.videoDecision === 'transcode' ? T('by the processor') : ''].filter(Boolean).join('  ·  ')) },
          { label: T('Sound'), sub: RAW([how(t.audioDecision), t.audioCodec ? String(t.audioCodec).toUpperCase() : '', t.audioChannels ? t.audioChannels + ' ch' : ''].filter(Boolean).join('  ·  ')) },
          { label: T('Keeping up'), sub: t.speed ? (t.throttled ? T('ahead, resting') : +t.speed >= 1 ? T('{x}× real time', { x: (+t.speed).toFixed(1) }) : T('{x}× real time: too slow, the picture will stop to load', { x: (+t.speed).toFixed(1) })) : '' });
      }
      UI.menu(T('Playback info'), rows);
    }, function () { UI.menu(T('Playback info'), rows); });
  }
  // The episode after or before this one, from the show's list.
  function step(m, d) {
    Plex.call(m.server, '/library/metadata/' + m.grandparentRatingKey + '/allLeaves').then(function (j) {
      var all = mc(j).Metadata || [], i = -1;
      all.forEach(function (x, n) { if (String(x.ratingKey) === String(m.ratingKey)) i = n; });
      var nx = i >= 0 ? all[i + d] : null;
      if (!nx) return U.toast(d > 0 ? T('This is the last episode') : T('This is the first episode'), 4000);
      report('stopped'); playKey(m.server, String(nx.ratingKey), true);
    }, function (e) { U.toast(e.message, 6000); });
  }

  /* The movie or episode ended (views.js endVod): an episode's next one with Up next, else back to the page. */
  function ended(force) {
    var p = playing; report('stopped'); stopTimer();
    if (!p) return;
    var m = p.item;
    if (m.type !== 'episode' || !m.grandparentRatingKey) { Views.stopAll(); if (PlexView.resume) PlexView.resume(); return; }
    Plex.call(m.server, '/library/metadata/' + m.grandparentRatingKey + '/allLeaves').then(function (j) {
      var all = mc(j).Metadata || [], i = -1;
      all.forEach(function (x, n) { if (String(x.ratingKey) === String(m.ratingKey)) i = n; });
      var nx = i >= 0 ? all[i + 1] : null;
      if (!nx) { Views.stopAll(); if (PlexView.resume) PlexView.resume(); return; }
      nx.server = m.server;
      // Still watching?  After the episodes in a row set in Settings > Plex, Up next asks instead of counting down.
      var after = +Plex.prefs().stillAfter || 0, ask = !!after && chain >= after;
      var go = function () { chain = ask ? 0 : chain + 1; item = nx; Plex.call(nx.server, '/library/metadata/' + nx.ratingKey + '?includeMarkers=1').then(function (k) { item = (mc(k).Metadata || [])[0] || nx; item.server = nx.server; play(item.viewOffset > 60000 ? item.viewOffset : 0, true); }); };
      if (force) return go();
      if (typeof UpNext !== 'undefined') UpNext.hold();
      Views.stopAll();
      PlexView.picture(nx.server, nx.thumb, 1280, 720).then(function (img) {
        UpNext.show({ auto: !ask, kicker: ask ? T('Still watching?') : undefined, playLabel: ask ? T('Keep watching') : undefined, image: img, show: nx.grandparentTitle, season: nx.parentIndex, episode: nx.index, line: T('Season {x}, episode {y}', { x: nx.parentIndex, y: nx.index }), title: nx.title, runtime: mins(nx.duration) ? T('{n} min', { n: mins(nx.duration) }) : '', desc: String(nx.summary || '').slice(0, 400), play: go, cancel: function () { if (PlexView.resume) PlexView.resume(); } });
      });
    }, function () { Views.stopAll(); if (PlexView.resume) PlexView.resume(); });
  }

  /* From the phone app (plexphone.js): the Plex tab on the TV, then the title played (where you stopped, unless
     fromStart).  Resolves to { title } once it's starting. */
  function playKey(server, key, fromStart) {
    if (Views.tab !== 'plex') Views.switchTab('plex');
    if (Views.tab !== 'plex') return Promise.reject(new Error('Plex could not be opened on the TV.'));
    if (document.body.classList.contains('nav-open') && Views.closeNav) Views.closeNav();
    return Plex.call(server, '/library/metadata/' + key + '?includeMarkers=1&includeChapters=1&includeGuids=1').then(function (j) {
      var m = (mc(j).Metadata || [])[0];
      if (!m || !/^(movie|episode)$/.test(m.type)) throw new Error('That one doesn\'t play by itself.  Pick a movie or an episode.');
      m.server = server; item = m; back = function () { if (PlexView.resume) PlexView.resume(); };
      play(!fromStart && m.viewOffset > 60000 ? m.viewOffset : 0);
      return { title: m.type === 'episode' ? m.grandparentTitle + ' S' + m.parentIndex + ' · E' + m.index : m.title };
    });
  }

  return { diag: diag, open: open, ended: ended, close: close, reshow: reshow, playKey: playKey, playerItems: playerItems, _test: { quality: quality, marks: marks, badges: badges, direct: direct, converts: converts, chapters: chapters, item: function () { return item; }, keys: keys, buttons: function () { return btns; }, shelf: function () { return shelf; } } };
})();
