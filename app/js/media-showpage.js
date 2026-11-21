/* My media: a show's own page, like Plex's.  OK on a show opens it full screen: its backdrop, details and
   summary, and its seasons as posters.  OK on a season shows the season's episodes as wide cards with their
   picture, title, air date, length and a ✓ once watched, and the focused one's summary underneath; OK plays
   it.  A show with one season opens straight on its episodes.  Red or Hold OK has the show's options (on the
   seasons) or the episode's (on an episode); Back goes from the episodes to the seasons, then closes.
   It looks like the provider Shows page (vod.js, the shp-* classes), drawn here from the library's own data. */
var MediaShowPage = (function () {
  'use strict';
  // Elements with words on them, in the viewer's language (I18n: titles and names come as RAW and stay as they are).
  function tel(tag, cls, text) { return U.el(tag, cls, text == null || typeof I18n === 'undefined' ? text : I18n.t(text)); }
  var $ = U.$, RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var pg = null;   // { card, show, seasons, at, eps, sel, level: 'seasons' | 'eps', loading, back }

  function box() {
    var b = $('mediaShow');
    if (!b) { b = tel('div', 'shp-page mshp'); b.id = 'mediaShow'; $('viewMedia').appendChild(b); }
    return b;
  }
  // "Season 13" as Plex says it; TMDB's own name for it ("Murder House", "13") goes under it.
  function seasonName(show, b) {
    var aired = show.order === 'aired' && (!show.displayOrder || show.displayOrder === 'aired');
    return aired && /^\d+$/.test(b.key) ? (b.key === '0' ? 'Specials' : 'Season ' + b.key) : b.title || b.key;
  }
  function seasonOwn(show, b) { var n = seasonName(show, b); return b.title && b.title !== n && !/^(season|specials)\b/i.test(b.title) ? b.title : ''; }
  /* opts.play: straight to the next episode (▶ on a show's poster, as on Plex): the season you're up to, its first
     episode not watched, played. */
  function open(card, back, opts) {
    pg = { card: card, show: null, seasons: [], at: 0, eps: [], sel: 0, level: 'seasons', loading: true, back: back, autoplay: !!(opts && opts.play) };
    $('viewMedia').classList.add('mshp-on');
    UI.setHandler(keys); draw();
    MediaSeries.showDetail(card.handle || card.id, function (r) {
      if (!pg || pg.card !== card) return;
      pg.show = r; pg.loading = false;
      // The show's trailer (TMDB, with your token): Yellow, or in the season options.
      var cur = pg; if (typeof MediaMoviePage !== 'undefined') MediaMoviePage.trailerFor(r.metadata && r.metadata.id, function (t) { if (pg === cur && t) { pg.trailer = t; draw(); } });
      // Specials last, as Plex lists them.
      pg.seasons = (r.buckets || []).slice().sort(function (a, b) { return (a.key === '0') - (b.key === '0'); });
      // On the season with the episode you're up to (Continue watching), else the first.
      /* From Recently aired or Recently added episodes: on that episode ("S1E5"), as Plex does. */
      var fm = /^S(\d+)E(\d+)/i.exec(card.focusEp || ''); pg.focus = fm ? { s: +fm[1], e: +fm[2] } : null;
      var want = pg.focus ? String(pg.focus.s) : card.continueSeason != null ? String(card.continueSeason) : null;
      pg.at = Math.max(0, want ? pg.seasons.map(function (b) { return b.key; }).indexOf(want) : 0);
      // ▶: the first season with an episode not watched (Specials last), unless Continue watching says which.
      if (pg.autoplay && card.continueSeason == null) { var un = pg.seasons.map(function (b, i) { return { b: b, i: i }; }).filter(function (x) { return x.b.key !== '0' && (x.b.watched == null || x.b.watched < x.b.count); })[0]; if (un) pg.at = un.i; }
      if (pg.seasons.length === 1) return season(0);
      if (pg.autoplay) return season(pg.at);
      if (pg.focus) return season(pg.at);                // straight to that episode
      draw();
    });
  }
  function season(i) {
    if (!pg || !pg.seasons[i]) return;
    pg.at = i; pg.level = 'eps'; pg.eps = []; pg.sel = 0; pg.loading = true; draw();
    var want = pg;
    MediaSeries.episodes({ kind: 'episode', show: pg.show.handle, bucket: pg.seasons[i].key, limit: 200, full: true }, function (r) {
      if (pg !== want || pg.level !== 'eps') return;
      pg.eps = r.items || []; pg.loading = false;
      // On the first episode not watched yet.
      var k = 0; for (var j = 0; j < pg.eps.length; j++) { if (pg.eps[j].watchState !== 'watched') { k = j; break; } k = j; }
      // Or the episode it was opened for (Recently aired), once.
      if (pg.focus) { for (var f = 0; f < pg.eps.length; f++) if (+pg.eps[f].season === pg.focus.s && +pg.eps[f].number === pg.focus.e) { k = f; break; } pg.focus = null; }
      pg.sel = k; draw();
      if (pg.autoplay) { pg.autoplay = false; if (pg.eps.length) play(); }
    });
  }
  function close() {
    var was = pg; pg = null;
    var b = $('mediaShow'); if (b) b.innerHTML = '';
    $('viewMedia').classList.remove('mshp-on');
    if (was && was.back) was.back();
  }
  // Back here after an episode ends or its options close.
  function reopen(state) { return function () { pg = state; $('viewMedia').classList.add('mshp-on'); UI.setHandler(keys); if (pg.level === 'eps') season(pg.at); else draw(); }; }

  function md(x) { return (x && x.metadata) || {}; }
  function niceDate(d) { var t = Date.parse(String(d || '') + 'T12:00:00'); return t ? new Date(t).toLocaleDateString(U.loc ? U.loc() : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
  function img(src, cls) { var i = tel('img', cls); i.decoding = 'async'; i.src = src; i.onerror = function () { if (!(typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this))) this.remove(); }; return i; }

  function logo(m, name, cls) {
    if (!m.logo) return null;
    var lg = tel('img', cls); lg.alt = name; lg.decoding = 'async';
    lg.onerror = function () {
      if (typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this)) return;
      if (lg.parentNode) lg.parentNode.replaceChild(tel('div', /small/.test(cls) ? 'media-kicker' : 'media-title', name), lg);
    };
    lg.src = m.logo; return lg;
  }
  // The show again (after marking a season watched): the season posters' corners follow.
  function refresh(state) {
    MediaSeries.showDetail(state.show.handle, function (r) {
      if (pg !== state || !r || !r.buckets) return;
      var key = pg.seasons[pg.at] && pg.seasons[pg.at].key;
      pg.show = r; pg.seasons = r.buckets.slice().sort(function (a, b) { return (a.key === '0') - (b.key === '0'); });
      var k = pg.seasons.map(function (b) { return b.key; }).indexOf(key); if (k >= 0) pg.at = k;
      if (pg.level === 'seasons') draw();
    });
  }

  function draw() {
    if (!pg) return;
    var b = box(), s = pg.show || pg.card, m = md(s), cm = md(pg.card);
    b.innerHTML = '';
    var bd = m.backdropHd || m.backdrop || cm.backdropHd || cm.backdrop || '';
    if (bd) { var bg = tel('div', 'shp-bd'); bg.style.backgroundImage = 'url("' + String(bd).replace(/"/g, '%22') + '")'; b.appendChild(bg); }
    b.appendChild(tel('div', 'shp-fade'));
    var info = tel('div', 'shp-info'), cur = pg.level === 'eps' ? pg.seasons[pg.at] : null;
    /* The show's logo (fanart.tv / TMDB), as on the home hero: in place of its name on the seasons, and smaller above
       the season's name on its episodes.  Its name in words when there's none or it doesn't load. */
    var name = RAW(m.title || s.title || '');
    if (cur) info.appendChild(logo(m, name, 'shp-logo small') || tel('div', 'media-kicker', name));
    else { info.appendChild(tel('div', 'media-kicker', 'TV show')); info.appendChild(logo(m, name, 'shp-logo') || tel('div', 'media-title', name)); }
    if (cur) info.appendChild(tel('div', 'media-title', RAW(seasonName(s, cur))));
    var n = pg.seasons.filter(function (x) { return x.key !== '0'; }).length;
    var facts = cur ? [seasonOwn(s, cur), cur.count + (cur.count === 1 ? ' episode' : ' episodes')]
      : [m.year, n ? n + (n === 1 ? ' season' : ' seasons') : '', m.genre, m.rating ? '★ ' + m.rating : ''];
    facts = facts.filter(Boolean).join('   ·   ');
    if (facts) info.appendChild(tel('div', 'media-facts', facts));
    var plot = cur ? cur.plot || m.plot : m.plot;
    if (plot) info.appendChild(tel('div', 'media-summary shp-plot', RAW(plot)));
    // The show's trailer, on the seasons: ▲ to it, OK plays it (Yellow from anywhere on the seasons).
    if (pg.trailer) { var tb = tel('div', 'mmp-btn shp-trl' + (pg.zone === 'trl' ? ' sel' : ''), '▶  Trailer'); tb.onclick = function () { trailer(pg); }; info.appendChild(tb); }
    b.appendChild(info);
    hints();
    if (pg.loading) { b.appendChild(tel('div', 'shp-empty', pg.level === 'eps' ? 'Loading episodes…' : 'Loading seasons…')); return; }
    if (pg.level === 'seasons') return drawSeasons(b, s, m);
    drawEpisodes(b, s, m);
  }
  function hints() {
    if (!pg) return;
    UI.hints(pg.zone === 'trl' ? [['', 'OK  play the trailer', 'ok'], ['', 'Down  ' + (pg.level === 'eps' ? 'episodes' : 'seasons')], ['', 'Back  close', 'back']] : pg.level === 'eps' ? [['', 'OK  play'], pg.trailer && pg.seasons.length < 2 ? ['', 'Up  trailer'] : null, ['', '◀ ▶  episodes'], ['', 'Hold OK  episode options', 'hold'], ['', 'Back  ' + (pg.seasons.length > 1 ? 'seasons' : 'close'), 'back']]
      : pg.zone === 'trl' ? [['', 'OK  play the trailer', 'ok'], ['', 'Down  seasons'], ['', 'Back  close', 'back']] : [['', 'OK  episodes'], ['', '▶  play next'], ['', '◀ ▶  seasons'], pg.trailer ? ['', 'Up  trailer'] : null, ['', 'Hold OK  season options', 'hold'], ['', 'Back  close', 'back']].concat(pg.trailer ? [['yellow', 'Trailer']] : []));
  }
  function drawSeasons(b, s, m) {
    if (!pg.seasons.length) { b.appendChild(tel('div', 'shp-empty', 'No episodes found for this show.')); return; }
    b.appendChild(tel('div', 'mshp-row', 'Seasons'));
    var track = tel('div', 'mshp-seasons'), from = Math.max(0, Math.min(pg.at - 2, pg.seasons.length - 7)), to = Math.min(pg.seasons.length, from + 7);
    for (var i = from; i < to; i++) (function (x, i) {
      var c = tel('div', 'mshp-season' + (i === pg.at && pg.zone !== 'trl' ? ' sel' : '')), art = tel('div', 'mshp-poster'), pic = x.poster || m.poster;
      if (pic) art.appendChild(img(pic, 'shp-pic'));
      else art.appendChild(tel('span', 'mshp-noart', seasonName(s, x)));
      // Plex's corner: ✓ once the whole season's watched, else how many episodes are left (once one's watched).
      if (x.watched != null && x.count) { var left = x.count - x.watched; if (!left) art.appendChild(tel('span', 'media-mark', '✓')); else if (x.watched) art.appendChild(tel('span', 'media-mark', String(left))); }
      c.appendChild(art);
      c.appendChild(tel('div', 'shp-name', RAW(seasonName(s, x))));
      c.appendChild(tel('div', 'shp-sub', RAW((seasonOwn(s, x) ? seasonOwn(s, x) + '  ·  ' : '') + x.count + (x.count === 1 ? ' episode' : ' episodes'))));
      c.onclick = function () { pg.at = i; season(i); };
      track.appendChild(c);
    })(pg.seasons[i], i);
    b.appendChild(track);
    b.appendChild(tel('div', 'shp-pos', (pg.at + 1) + ' of ' + pg.seasons.length));
  }
  function drawEpisodes(b, s, m) {
    var list = pg.eps;
    if (!list.length) { b.appendChild(tel('div', 'shp-empty', 'No episodes in this season.')); return; }
    var spoilers = typeof Store !== 'undefined' && Store.settings && Store.settings.noSpoilers;
    var track = tel('div', 'shp-track mshp-eps'), from = Math.max(0, pg.sel - 2), to = Math.min(list.length, from + 8);
    for (var i = from; i < to; i++) (function (e, i) {
      var em = md(e), w = e.watchState === 'watched', hide = spoilers && !w;
      var c = tel('div', 'shp-card' + (i === pg.sel && pg.zone !== 'trl' ? ' sel' : '')), art = tel('div', 'shp-art'), pic = !hide && em.still || em.poster || m.backdrop || m.poster;
      if (pic) art.appendChild(img(pic, 'shp-pic' + (pic === em.still ? '' : ' cover')));
      art.appendChild(tel('span', 'shp-num', e.order === 'date' ? String(e.airDate || '') : 'E' + (e.number != null ? e.number : e.absoluteNumber || '?')));
      if (w) art.appendChild(tel('span', 'shp-done', '✓'));
      c.appendChild(art);
      c.appendChild(tel('div', 'shp-name', RAW((!hide && em.title) || e.title || ('Episode ' + (e.number || '?')))));
      var sub = [em.runtime ? em.runtime + ' min' : '', niceDate(em.airDate || e.airDate), e.versionCount > 1 ? e.versionCount + ' copies' : ''].filter(Boolean).join('   ·   ');
      if (sub) c.appendChild(tel('div', 'shp-sub', sub));
      c.onclick = function () { pg.sel = i; play(); };
      track.appendChild(c);
    })(list[i], i);
    b.appendChild(track);
    var cur = list[pg.sel], cm = md(cur);
    if (cur) {
      var foot = tel('div', 'shp-foot');
      foot.appendChild(tel('b', '', (cur.order === 'date' ? cur.airDate : 'S' + cur.season + ' E' + (cur.number || '?')) + '   '));
      foot.appendChild(document.createTextNode(spoilers && cur.watchState !== 'watched' ? 'Summary hidden until you watch it (Hide spoilers is on).' : RAW(cm.plot || '')));
      b.appendChild(foot);
    }
    b.appendChild(tel('div', 'shp-pos', (pg.sel + 1) + ' of ' + list.length));
  }
  function play() {
    var e = pg && pg.eps[pg.sel]; if (!e) return;
    MediaSeries.playEpisode(e, reopen(pg));
  }
  function options() {
    if (!pg || pg.loading) return;
    var state = pg;
    if (pg.level === 'eps') { var e = pg.eps[pg.sel]; if (e) MediaSeries.episodeMenu(e, reopen(state)); return; }
    /* On a season (Plex's Hold OK on a season): mark it watched or not watched, or the show's own options. */
    var b = pg.seasons[pg.at], sh = pg.show;
    if (!b) return MediaSeries.showItem({ handle: sh.handle }, reopen(state));
    MediaSeries.episodes({ kind: 'episode', show: sh.handle, bucket: b.key, limit: 200 }, function (r) {
      if (pg !== state) return;
      var items = r.items || [], w = items.filter(function (x) { return x.watchState === 'watched'; }).length;
      var menu = MediaSeries.markItems(sh, b.key, { watched: w, unwatched: items.length - w }).map(function (o) { return { label: o.label, action: function () { o.action(function () { reopen(state)(); refresh(state); }); } }; });
      if (state.trailer) menu.push({ label: 'Watch the trailer', icon: 'play', action: function () { trailer(state); } });
      menu.push({ label: 'Show options', sub: 'Favorite, details, episode order and more', action: function () { MediaSeries.showItem({ handle: sh.handle }, reopen(state)); } });
      UI.menu(seasonName(sh, b), menu, reopen(state));
    });
  }
  function trailer(state) { if (state.trailer && typeof MediaMoviePage !== 'undefined') MediaMoviePage.watchTrailer(state.trailer, function () { if (pg === state) { UI.setHandler(keys); hints(); } }, 'the show'); }
  function keys(a) {
    if (!pg) return false;
    if (a === 'yellow' && pg.trailer) { trailer(pg); return true; }
    if (pg.zone === 'trl' && a !== 'up' && a !== 'down' && a !== 'ok' && a !== 'back') return true;
    if (a === 'back') { if (pg.level === 'eps' && pg.seasons.length > 1) { pg.level = 'seasons'; pg.loading = false; draw(); refresh(pg); } else close(); return true; }
    if (a === 'red' || a === 'hold' || a === 'info') { options(); return true; }
    if (pg.loading) return true;
    if (pg.zone === 'trl') {
      if (a === 'down') pg.zone = '';
      else if (a === 'ok') { trailer(pg); return true; }
      draw(); return true;
    }
    if (pg.level === 'seasons') {
      if (a === 'up' && pg.trailer) pg.zone = 'trl';
      else if (a === 'left' && pg.at > 0) pg.at--;
      else if (a === 'right' && pg.at < pg.seasons.length - 1) pg.at++;
      else if (a === 'ok' || a === 'down') return season(pg.at), true;
    } else {
      var n = pg.eps.length;
      if (a === 'left' && pg.sel > 0) pg.sel--;
      else if (a === 'right' && pg.sel < n - 1) pg.sel++;
      else if (a === 'chup' || a === 'chdown') pg.sel = Math.max(0, Math.min(n - 1, pg.sel + (a === 'chup' ? -5 : 5)));
      else if (a === 'up' && pg.seasons.length > 1) { pg.level = 'seasons'; refresh(pg); }
      else if (a === 'up' && pg.trailer) pg.zone = 'trl';
      else if (a === 'ok' || a === 'playpause') { play(); return true; }
    }
    // ▶ on a season: its first episode not watched, played.
    if (a === 'playpause' && pg.level === 'seasons') { pg.autoplay = true; return season(pg.at), true; }
    draw(); return true;
  }
  return { open: open, close: close, isOpen: function () { return !!pg; } };
})();
