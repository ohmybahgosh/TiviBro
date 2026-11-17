/* My media: a movie's own page (issue: "a full screen click-through for movies, instead of playing straight
   away").  OK on a movie opens it full screen, laid out like a show's page (media-showpage.js): its backdrop,
   title, details, summary, director and cast, and a row of buttons: Resume (or Play), From the start, Trailer
   (TMDB's, played inside TiviBro), Favorite and More options.  Below them, the other movies of its
   collection you have.  ◀ ▶ move along a row, ▲ ▼ between the buttons and the collection, Back closes. */
var MediaMoviePage = (function () {
  'use strict';
  var $ = U.$, RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var pg = null;   // { m, back, row: 'buttons' | 'more', at, more: [], moreAt, trailer }
  var trailers = {};   // TMDB id -> YouTube id ('' none), for this session

  function box() {
    var b = $('mediaMovie');
    if (!b) { b = U.el('div', 'shp-page mshp mmp'); b.id = 'mediaMovie'; $('viewMedia').appendChild(b); }
    return b;
  }
  function md(m) { return (m && m.metadata) || {}; }
  function rt(min) { var n = parseInt(min, 10); return n > 0 ? (n >= 60 ? Math.floor(n / 60) + ' h ' : '') + (n % 60 ? n % 60 + ' min' : '') : ''; }
  function hm(sec) { sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? h + ':' + (m < 10 ? '0' : '') + m + ' h' : m + ' min'; }
  function resumeOf(m) { var r = MediaStore.resume(m.resumeKey || m.id); return r && r.pos > 30 && r.pos < r.dur - 60 ? r : null; }
  function tv() { return typeof PalmServiceBridge !== 'undefined'; }

  function buttons() {
    var m = pg.m, r = resumeOf(m), out = [];
    out.push(r ? { id: 'resume', label: '▶  Resume', sub: hm(r.dur - r.pos) + ' left' } : { id: 'play', label: '▶  Play', sub: rt(md(m).runtime) });
    if (r) out.push({ id: 'start', label: '↺  From the start' });
    if (pg.more.length > 1) out.push({ id: 'all', label: 'Play the collection', sub: pg.more.length + ' movies, in order' });
    if (pg.trailer) out.push({ id: 'trailer', label: 'Trailer' });
    // Favorite and More options: round buttons, named underneath when focused.
    out.push({ id: 'fav', label: MediaStore.isFavorite(m.id) ? '♥' : '♡', round: true, name: MediaStore.isFavorite(m.id) ? 'In Favorites  ·  OK takes it out' : 'Add to Favorites' });
    out.push({ id: 'more', label: '•••', round: true, name: 'More options' });
    return out;
  }
  // The other movies of its TMDB collection that you have (Mad Max, Mad Max 2, …), oldest first.
  function collection(m) {
    var c = md(m).collection; if (!c || !c.id) return [];
    var seen = {};
    return MediaStore.movies(null).filter(function (x) {
      var xc = md(x).collection, k = md(x).id || x.id;
      if (!xc || xc.id !== c.id || seen[k]) return false; seen[k] = 1; return true;
    }).sort(function (a, b) { return String(md(a).releaseDate || a.year || '') < String(md(b).releaseDate || b.year || '') ? -1 : 1; });
  }

  function open(m, back) {
    pg = { m: m, back: back, row: 'buttons', at: 0, more: collection(m), moreAt: 0, trailer: '' };
    pg.moreAt = Math.max(0, pg.more.indexOf(m));
    $('viewMedia').classList.add('mmp-on');
    UI.setHandler(keys); draw();
    // The trailer, once per movie and session; only on the TV (it opens the YouTube app).
    var id = md(m).id;
    if (tv() && id && /^tmdb:[0-9]+$/.test(id) && MediaStore.tmdbToken()) {
      if (trailers[id] !== undefined) { pg.trailer = trailers[id]; draw(); }
      else Media.request('metadata', { credential: MediaStore.tmdbToken(), videos: id, language: MediaStore.preferences().language }, 20000).then(function (r) {
        trailers[id] = r && r.trailer || '';
        if (pg && pg.m === m && trailers[id]) { pg.trailer = trailers[id]; draw(); }
      }, function () {});
    }
  }
  function close(keepBack) {
    var was = pg; pg = null;
    var b = $('mediaMovie'); if (b) b.innerHTML = '';
    $('viewMedia').classList.remove('mmp-on');
    if (was && was.back && !keepBack) was.back();
  }
  function reopen(m, back) { return function () { open(m, back); }; }

  function img(src, cls) { var i = U.el('img', cls); i.decoding = 'async'; i.src = src; i.onerror = function () { if (!(typeof Net !== 'undefined' && Net.retryImage && Net.retryImage(this))) this.remove(); }; return i; }
  function hints() {
    UI.hints(pg.row === 'more' ? [['', 'OK  open'], ['', '◀ ▶  the collection'], ['', '▲  buttons'], ['', 'Back  close', 'back']]
      : [['', 'OK  choose'], ['', '◀ ▶  buttons'], pg.more.length > 1 ? ['', '▼  the collection'] : null, ['', 'Hold OK  options', 'hold'], ['', 'Back  close', 'back']].filter(Boolean));
  }
  function draw() {
    if (!pg) return;
    var b = box(), m = pg.m, d = md(m);
    b.innerHTML = '';
    var bd = d.backdropHd || d.backdrop || '';
    if (bd) { var bg = U.el('div', 'shp-bd'); bg.style.backgroundImage = 'url("' + String(bd).replace(/"/g, '%22') + '")'; b.appendChild(bg); }
    b.appendChild(U.el('div', 'shp-fade'));
    var info = U.el('div', 'shp-info');
    info.appendChild(U.el('div', 'media-kicker', 'Movie'));
    if (d.logo) { var lg = img(d.logo, 'mmp-logo'); lg.alt = d.title || m.title; info.appendChild(lg); }
    else info.appendChild(U.el('div', 'media-title', RAW(d.title || m.title || '')));
    var px = (m.info || []).filter(function (x) { return /2160p|4K|HDR|Dolby Vision|DV/i.test(x); }).slice(0, 2).join(' ');
    var facts = [d.year || m.year, rt(d.runtime), String(d.genre || '').split(/\s*,\s*/).slice(0, 3).join(', '), d.rating ? '★ ' + d.rating : '', px,
      MediaStore.isWatched && MediaStore.isWatched(m.id) ? '✓ Watched' : ''].filter(Boolean).join('   ·   ');
    if (facts) info.appendChild(U.el('div', 'media-facts', facts));
    if (d.plot) info.appendChild(U.el('div', 'media-summary shp-plot mmp-plot', RAW(d.plot)));
    var who = [(d.directors || []).length ? 'Directed by ' + d.directors.join(', ') : '', d.cast ? 'With ' + d.cast : ''].filter(Boolean).join('   ·   ');
    if (who) info.appendChild(U.el('div', 'mmp-who', RAW(who)));
    b.appendChild(info);
    // The buttons.
    var row = U.el('div', 'mmp-buttons'), bs = buttons();
    pg.at = Math.min(pg.at, bs.length - 1);
    var r = resumeOf(m);
    bs.forEach(function (x, i) {
      var e = U.el('div', 'mmp-btn' + (pg.row === 'buttons' && i === pg.at ? ' sel' : '') + (i === 0 ? ' main' : '') + (x.round ? ' round' : ''));
      e.appendChild(U.el('span', '', x.label));
      if (x.sub) e.appendChild(U.el('small', '', x.sub));
      if (i === 0 && r) { var bar = U.el('div', 'mmp-btn-bar'), f = U.el('i'); f.style.width = Math.min(100, Math.round(100 * r.pos / r.dur)) + '%'; bar.appendChild(f); e.appendChild(bar); }
      e.onclick = function () { pg.row = 'buttons'; pg.at = i; press(x.id); };
      row.appendChild(e);
    });
    b.appendChild(row);
    var on = pg.row === 'buttons' && bs[pg.at];
    if (on && on.name) b.appendChild(U.el('div', 'mmp-btn-name', on.name));
    // The collection.
    if (pg.more.length > 1) {
      b.appendChild(U.el('div', 'mshp-row mmp-more-title', RAW((d.collection && d.collection.name) || 'The collection')));
      var track = U.el('div', 'mmp-more'), from = Math.max(0, Math.min(pg.moreAt - 3, pg.more.length - 8));
      pg.more.slice(from, from + 8).forEach(function (x, j) {
        var i = from + j, c = U.el('div', 'mmp-poster' + (pg.row === 'more' && i === pg.moreAt ? ' sel' : '') + (x === m ? ' this' : ''));
        if (md(x).poster) c.appendChild(img(md(x).poster, 'shp-pic')); else c.appendChild(U.el('span', 'mshp-noart', RAW(md(x).title || x.title)));
        c.onclick = function () { if (x !== m) open(x, pg.back); };
        track.appendChild(c);
      });
      b.appendChild(track);
    }
    hints();
  }
  function press(id) {
    var m = pg.m, back = pg.back;
    // My media's own keys while the movie opens (Back cancels it), then the page again when it ends.
    if (id === 'resume' || id === 'play') { close(true); Media.restore(); Media.playFile(m, false, reopen(m, back)); }
    else if (id === 'start') { close(true); Media.restore(); Media.playFile(m, true, reopen(m, back)); }
    else if (id === 'all') { var list = pg.more; close(true); Media.restore(); Media.playAll(list, reopen(m, back)); }
    else if (id === 'trailer') watchTrailer(pg.trailer);
    else if (id === 'fav') { MediaStore.toggleFavorite(m.id); if (Media.refresh) Media.refresh(); draw(); }
    else if (id === 'more') options();
  }
  function options() { var m = pg.m, back = pg.back; close(true); Media.optionsFor(m, reopen(m, back)); }
  /* The trailer plays inside TiviBro, over the page, through the network helper's small page (YouTube's player
     needs a page with an address: service/proxy.js /trailer).  Back closes it and you are on the movie's page
     again; Yellow opens it in the TV's YouTube app instead.  Without the helper: the YouTube app. */
  var tr = null;
  function watchTrailer(id) {
    if (!(typeof Net !== 'undefined' && Net.port && Net.active)) return youtubeApp(id);
    var box = U.el('div', 'mmp-trailer'), f = U.el('iframe');
    f.src = 'http://127.0.0.1:' + Net.port + '/trailer?v=' + id; f.setAttribute('allow', 'autoplay; encrypted-media; fullscreen'); f.tabIndex = -1;
    box.appendChild(f);
    var tip = U.el('div', 'mmp-trailer-tip', 'Back  returns to the movie      Yellow  open in the YouTube app');
    box.appendChild(tip);
    document.body.appendChild(box);
    // The keys stay with TiviBro (the player never takes the focus), so Back always works.
    f.onload = function () { try { window.focus(); if (document.activeElement === f) f.blur(); } catch (e) {} };
    setTimeout(function () { tip.classList.add('fade'); }, 6000);
    var state = pg;
    tr = { box: box };
    UI.setHandler(function (a) {
      if (a === 'back' || a === 'yellow' || a === 'stop') {
        box.remove(); tr = null;
        if (a === 'yellow') youtubeApp(id);
        if (pg === state) { UI.setHandler(keys); hints(); }
        return true;
      }
      tip.classList.remove('fade'); clearTimeout(tr && tr.t); if (tr) tr.t = setTimeout(function () { tip.classList.add('fade'); }, 4000);
      return true;
    });
    UI.hints([['', 'Back  the movie\'s page', 'back'], ['yellow', 'YouTube app']]);
  }
  function youtubeApp(id) {
    try {
      var bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (msg) { var r = {}; try { r = JSON.parse(msg); } catch (e) {} if (r.returnValue === false) U.toast('The TV\'s YouTube app didn\'t open'); };
      bridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({ id: 'youtube.leanback.v4', params: { contentTarget: 'https://www.youtube.com/tv?v=' + id } }));
    } catch (e) { U.toast('The TV\'s YouTube app didn\'t open'); }
  }
  function keys(a) {
    if (!pg) return false;
    if (a === 'back') { close(); return true; }
    if (a === 'red' || a === 'hold' || a === 'info') { options(); return true; }
    var n = pg.row === 'more' ? pg.more.length : buttons().length;
    if (pg.row === 'buttons') {
      if (a === 'left' && pg.at > 0) pg.at--;
      else if (a === 'right' && pg.at < n - 1) pg.at++;
      else if (a === 'down' && pg.more.length > 1) pg.row = 'more';
      else if (a === 'ok') { press(buttons()[pg.at].id); return true; }
    } else {
      if (a === 'left' && pg.moreAt > 0) pg.moreAt--;
      else if (a === 'right' && pg.moreAt < n - 1) pg.moreAt++;
      else if (a === 'up') pg.row = 'buttons';
      else if (a === 'ok') { var x = pg.more[pg.moreAt]; if (x && x !== pg.m) open(x, pg.back); else pg.row = 'buttons'; }
    }
    if (pg) draw();
    return true;
  }
  return { open: open, close: close, isOpen: function () { return !!pg; } };
})();
