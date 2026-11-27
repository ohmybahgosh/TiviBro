/* Rows of Plex titles inside a title's page (plexpage.js): Cast and crew, Seasons, Episodes, More like this, a
   collection's other titles, Extras.  Built once when the rows come; a key press only moves the ring and slides the
   row (no redraw), and pictures load for the rows near the focus, each asked for once.
   A row: { title, kind: 'poster' | 'wide' | 'person', items }.  Chromium 53-compatible. */
var PlexShelf = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var SIZE = { poster: [214, 321], wide: [380, 214], person: [176, 176] }, GAP = 26, ROW_H = 470;
  // A row's height: its title, its pictures and the two lines under them (people and stills take less room).
  function height(kind) { return (SIZE[kind] || SIZE.poster)[1] + 150; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // One tile: its picture, its name and a line under it (a role, a year, S1 · E2, how much is left).
  function tile(m, kind, i) {
    var sz = SIZE[kind] || SIZE.poster, name, sub, path;
    if (kind === 'person') { name = m.tag; sub = m.role || m.job || ''; path = m.thumb || ''; }
    else {
      var ep = m.type === 'episode';
      name = ep ? m.title : m.title; path = kind === 'wide' ? (Plex.epPic(m) || m.thumb || m.art || '') : (m.thumb || '');
      sub = ep ? 'S' + (m.parentIndex || 0) + ' · E' + (m.index || 0) + (m.duration ? '  ·  ' + T('{n} min', { n: Math.round(m.duration / 60000) }) : '') :
        m.type === 'season' ? (m.leafCount ? (m.leafCount === 1 ? T('1 episode') : T('{n} episodes', { n: m.leafCount })) : '') : m.subtype === 'trailer' ? T('Trailer') : (m.year || '');
    }
    var watched = m.viewCount > 0 && !m.viewOffset, left = m.leafCount && m.viewedLeafCount != null ? m.leafCount - m.viewedLeafCount : 0;
    var prog = m.viewOffset && m.duration ? Math.min(100, Math.round(m.viewOffset / m.duration * 100)) : 0;
    return '<div class="media-tile plex-tile-' + kind + '" style="left:' + (14 + i * (sz[0] + GAP)) + 'px;width:' + sz[0] + 'px">' +
      '<div class="media-art" style="width:' + sz[0] + 'px;height:' + sz[1] + 'px"><img class="media-cover wait" data-pp="' + esc(path) + '" data-w="' + sz[0] + '" data-h="' + sz[1] + '" alt="">' +
      (kind !== 'person' && left > 0 ? '<span class="media-mark">' + left + '</span>' : kind !== 'person' && watched ? '<span class="media-mark done">✓</span>' : '') +
      (prog ? '<div class="media-progress"><i style="width:' + prog + '%"></i></div>' : '') + '</div>' +
      '<div class="media-tile-title">' + esc(name) + '</div><div class="media-tile-year">' + esc(sub) + '</div></div>';
  }

  /* A set of rows in el, for one server.  Returns what the page needs to move around them. */
  function make(el, server, rows) {
    var at = 0, col = {}, asked = {}, tops = [], y = 0;
    rows.forEach(function (r) { tops.push(y); y += height(r.kind); });
    el.innerHTML = rows.map(function (r, ri) {
      return '<div class="media-shelf" style="top:' + tops[ri] + 'px;height:' + height(r.kind) + 'px"><div class="media-shelf-title"><h2>' + esc(r.title) + '</h2></div>' +
        '<div class="media-track">' + r.items.map(function (m, i) { return tile(m, r.kind, i); }).join('') +
        PlexView.ring((SIZE[r.kind] || SIZE.poster)[0], (SIZE[r.kind] || SIZE.poster)[1]) + '</div></div>';
    }).join('');
    // The ring on the focused tile, the row slid so it stays in view, pictures for the rows around.
    function paint(on) {
      var shelves = el.children;
      var old = el.querySelector('.media-tile.sel'); if (old) old.classList.remove('sel');
      for (var ri = 0; ri < shelves.length; ri++) {
        var r = rows[ri], c = col[ri] || 0, step = (SIZE[r.kind] || SIZE.poster)[0] + GAP, track = shelves[ri].lastChild;
        shelves[ri].classList.toggle('active', on && ri === at);
        shelves[ri].classList.toggle('gone', on && ri < at);
        track.style.transform = 'translateX(' + (-Math.max(0, c - 3) * step) + 'px)';
        if (on && ri === at && track.children[c]) track.children[c].classList.add('sel');
        track.lastChild.style.transform = 'translate3d(' + (14 + c * step) + 'px,0,0)';
        if (r.kind === 'person') track.lastChild.classList.add('round');
        if (ri >= at - 1 && ri <= at + 1) pictures(ri, track, c, r.kind);
      }
    }
    function pictures(ri, track, c, kind) {
      for (var i = Math.max(0, c - 3); i < Math.min(track.children.length, c + 9); i++) {
        if (asked[ri + ':' + i]) continue;
        asked[ri + ':' + i] = 1;
        (function (img) {
          if (!img || !img.getAttribute('data-pp')) return;
          var w = +img.getAttribute('data-w'), h = +img.getAttribute('data-h');
          PlexView.picture(server, img.getAttribute('data-pp'), kind === 'person' ? 240 : w, kind === 'person' ? 240 : h).then(function (u) { if (u) { img.onload = function () { img.classList.remove('wait'); }; img.src = u; } });
        })(track.children[i].querySelector('img'));
      }
    }
    paint(false);
    return {
      rows: rows,
      get row() { return at; },
      focused: function () { var r = rows[at]; return r ? { row: r, item: r.items[col[at] || 0] } : null; },
      /* A key while the rows have the focus: true when it was theirs (◀ ▶ along, ▼ down, ▲ up until the top row). */
      move: function (a) {
        var c = col[at] || 0, r = rows[at];
        if (a === 'left' && c > 0) col[at] = c - 1;
        else if (a === 'right' && r && c < r.items.length - 1) col[at] = c + 1;
        else if (a === 'down' && at < rows.length - 1) at++;
        else if (a === 'up' && at > 0) at--;
        else return false;
        paint(true); return true;
      },
      paint: paint,
      // How far the page scrolls up to show the focused row (the header goes off the top).
      scroll: function () { return tops[at] || 0; }
    };
  }

  return { make: make, ROW_H: ROW_H };
})();
