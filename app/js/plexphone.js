/* Plex from the phone app (its Plex tab, and the Plex shortcut on its home screen, shown once Plex.added()): the
   phone asks here (phone.js, the sealed 'plex' question) and plays on the TV.  Nothing plays on the phone.  The
   phone lays Plex out as the TV's Plex tab does: Home, Top 10 and each library with its own views (Recommended,
   Library, Collections, Categories, Playlists), rows as the TV draws them (wide for Continue watching and episodes,
   "#3 on Netflix" under a Top 10's posters), and a title's page with its rows.
     { op: 'libs' }                        -> { libs, views, top, pics }  the libraries picked, in order; the views a
                                              library has; whether Top 10s are on
     { op: 'home' }                        -> { rows, pics }  the Plex tab's Home rows (Continue watching first)
     { op: 'top' }                         -> { rows, pics }  the Top 10 tab: every service's movies and shows you have
     { op: 'view', server, key, view }     -> { rows, pics } a library's Recommended or Categories (rows with a genre
                                              and no items yet: ask 'genre'); { items, pics } its Collections or Playlists
     { op: 'genre', server, key, genre }   -> { items, pics }  a category's titles
     { op: 'lib', server, key, offset }    -> { items, total, sort, pics }  a library, 60 at a time, sorted as on the TV
     { op: 'children', server, key, type } -> { items, pics }  a show's seasons, a season's episodes, a collection, a
                                              playlist; type 'filter' with sec, field, id: a person's titles
     { op: 'details', server, key }        -> { item, info, rows, pics }  a title's page (PlexPage.pageData)
     { op: 'search', q }                   -> { items, pics }  movies and shows on every server picked
     { op: 'play', server, key, fromStart } -> { title }  opens the title on the TV and plays it (where you stopped)
     { op: 'next', server, key }           -> { ok }  a show's or a season's next episode played on the TV
     { op: 'extra', server, key }          -> { ok }  a trailer or another extra played on the TV
     { op: 'watched', server, key, on }    -> { on }  marked watched or not watched in Plex
   pics: { server id: { base, token } } so the phone fetches posters straight from the server (the token in a
   header there, never in an address).  Server tokens only (each for its own server), never the account's.
   Chromium 53-compatible. */
var PlexPhone = (function () {
  'use strict';
  var PAGE = 60;
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  function mc(j) { return (j && j.MediaContainer) || {}; }
  // A title as the phone shows it: small, with where you stopped, and what its page and its row need.
  function slim(m) {
    var ep = m.type === 'episode';
    return {
      server: m.server, key: String(m.ratingKey || ''), type: m.type, title: ep ? (m.grandparentTitle || m.title) : m.title,
      sub: ep ? 'S' + (m.parentIndex || 0) + ' · E' + (m.index || 0) + '  ' + (m.title || '') : m.type === 'season' ? (m.title || '') : m.type === 'clip' ? (m.subtype || '') : String(m.year || ''),
      thumb: ep && m.grandparentThumb ? m.grandparentThumb : m.thumb || '', wide: ep || m.type === 'clip' ? (Plex.epPic(m) || m.thumb || '') : '',
      art: m.art || m.grandparentArt || m.parentArt || '',
      offset: m.viewOffset || 0, duration: m.duration || 0, watched: m.viewCount > 0 && !m.viewOffset ? 1 : 0,
      left: m.leafCount && m.viewedLeafCount != null ? m.leafCount - m.viewedLeafCount : 0, summary: Plex.spoiler(m) ? '' : String(m.summary || '').slice(0, 600),
      sec: String(m.librarySectionID || '')
    };
  }
  // A row as the TV draws it: its title, wide (pictures in 16:9) or posters, and the line under each title it has.
  function row(r, kind) {
    var wide = kind === 'wide' || !!r.wide;
    return { title: r.title || '', wide: wide, kind: kind || (wide ? 'wide' : 'poster'), note: r.note || '', genre: r.genre || '',
      items: (r.items || []).slice(0, 40).map(function (m) { var x = slim(m); if (r.line && r.line(m)) x.sub = r.line(m); return x; }) };
  }
  // A person in Cast and crew: their picture, their part, and what the phone sends back to list their titles.
  function person(p, m) { return { tag: p.tag || '', role: p.role || p.job || '', thumb: p.thumb || '', id: String(p.id || ''), field: p.kind === 'director' ? 'director' : 'actor', sec: String(m.librarySectionID || '') }; }
  /* Where the phone fetches each server's pictures: the address the TV uses (home network or plex.direct), and the
     server's own token. */
  function pics() {
    var out = {};
    Plex.chosen().forEach(function (s) { if (s.uri) out[s.id] = { base: s.uri, token: s.token }; });
    return out;
  }
  function withPics(o) { o.pics = pics(); return o; }
  function libs() {
    return Plex.shownLibraries().filter(function (l) { return Plex.libs(l.server).indexOf(l.key) >= 0 && Plex.chosen().some(function (s) { return s.id === l.server; }); })
      .map(function (l) { return { server: l.server, key: l.key, title: l.title, type: l.type }; });
  }
  function known(server) { if (!Plex.server(server) || !Plex.chosen().some(function (s) { return s.id === server; })) throw new Error('That Plex server isn\'t picked on the TV.'); }
  function okKey(k) { if (!/^[0-9]{1,12}$/.test(String(k || ''))) throw new Error('That isn\'t a Plex title.'); return String(k); }
  function libOf(a) {
    known(a.server);
    var k = okKey(a.key), l = libs().filter(function (x) { return x.server === a.server && x.key === k; })[0];
    if (!l) throw new Error('That library isn\'t picked on the TV.');
    return l;
  }
  /* The Top 10 tab's rows (PlexTop.chartRows), once the charts and the matches with your libraries are read: the
     charts can still be on their way when the phone asks, so it waits for them (12 s at the most). */
  function topRows() {
    if (typeof PlexTop === 'undefined') return Promise.resolve([]);
    return new Promise(function (resolve) {
      var done = false;
      function now(again) { return [].concat.apply([], PlexTop.services().map(function (svc) { return PlexTop.chartRows(svc, again); })); }
      function finish(r) { if (!done) { done = true; resolve(r); } }
      var first = now(function () { var r = now(null); if (r.length) finish(r); });
      if (first.length) finish(first);
      setTimeout(function () { finish(now(null)); }, 12000);
    });
  }
  /* A library's list, sorted and filtered as on the TV (Red > Sort, Unwatched only there), a page at a time. */
  function libPage(l, off) {
    var p = PlexView.read.libPrefs(l), sort = p.sort || 'addedAt:desc';
    var q = '/library/sections/' + l.key + '/all?type=' + (l.type === 'show' ? 2 : 1) + '&sort=' + encodeURIComponent(sort) + '&X-Plex-Container-Start=' + off + '&X-Plex-Container-Size=' + PAGE + '&includeImages=1';
    if (p.unwatched) q += '&unwatched=1';
    if (p.genre) q += '&genre=' + encodeURIComponent(p.genre);
    return Plex.call(l.server, q).then(function (j) {
      return withPics({ items: (mc(j).Metadata || []).map(function (m) { m.server = l.server; return slim(m); }), total: mc(j).totalSize || 0, sort: sort });
    });
  }
  // A title's page: the details as the TV's page shows them, and its rows (Cast and crew are people, not titles).
  function details(a) {
    known(a.server);
    return PlexPage.pageData(a.server, okKey(a.key)).then(function (d) {
      // The page's own title (an episode's, not its show's: the show is the kicker above it).
      var it = slim(d.m);
      it.title = d.m.title || it.title;
      if (d.m.type === 'episode') it.sub = d.info.facts;
      return withPics({ item: it, info: d.info, rows: d.rows.map(function (r) {
        if (r.kind === 'person') return { title: r.title, kind: 'person', wide: false, people: r.items.map(function (p) { return person(p, d.m); }), items: [] };
        return row({ title: r.title, items: r.items }, r.kind === 'wide' ? 'wide' : 'poster');
      }) });
    });
  }
  // A library's view: Recommended and Categories as rows; Collections and Playlists as one list for the phone's grid.
  function view(a) {
    var l = libOf(a), v = String(a.view || 'recommended'), R = PlexView.read;
    var p = v === 'recommended' ? R.recommended(l) : v === 'collections' ? R.collections(l) : v === 'categories' ? R.categories(l) : v === 'playlists' ? R.playlists() : null;
    if (!p) throw new Error('That isn\'t a view of a Plex library.');
    if (v === 'collections' || v === 'playlists') return p.then(function (rows) { return withPics({ items: [].concat.apply([], rows.map(function (r) { return r.items; })).map(slim) }); });
    return p.then(function (rows) { return withPics({ rows: rows.map(function (r) { return row(r); }) }); });
  }
  // A list of titles under one heading or another (a show's seasons, a person's films...), as one list.
  function flat(rows) { return withPics({ items: [].concat.apply([], rows.map(function (r) { return r.items; })).map(slim) }); }

  /* One question from the phone (phone.js answers with what this resolves to, or the error's message). */
  function answer(a) {
    if (typeof Plex === 'undefined' || !Plex.added()) return Promise.reject(new Error('Plex isn\'t set up on the TV.  Add a server in Settings > Plex.'));
    var op = String(a.op || 'libs');
    try {
      if (op === 'libs') return Promise.all(Plex.chosen().map(function (s) { return Plex.reach(s.id).catch(function () {}); })).then(function () {
        return withPics({ libs: libs(), views: PlexView.read.SUBS.map(function (x) { return { id: x[0], title: T(x[1]) }; }), top: typeof PlexTop !== 'undefined' });
      });
      // Home: "#3 on Netflix" under a Top 10's posters, as on the TV.
      if (op === 'home') return PlexView.read.home().then(function (rows) { return withPics({ rows: rows.map(function (r) { return row(r); }) }); });
      if (op === 'top') return topRows().then(function (rows) { return withPics({ rows: rows.map(function (r) { return row(r); }) }); });
      if (op === 'view') return view(a);
      if (op === 'genre') { var lg = libOf(a); return PlexView.read.genre(lg, String(a.genre || '').slice(0, 80)).then(function (items) { return withPics({ items: items.map(slim) }); }); }
      if (op === 'lib') return libPage(libOf(a), Math.max(0, +a.offset || 0));
      if (op === 'children') {
        known(a.server);
        var m = String(a.type) === 'filter'
          ? { server: a.server, type: 'filter', title: String(a.title || '').slice(0, 80), ratingKey: '', sec: okKey(a.sec), field: a.field === 'director' ? 'director' : 'actor', id: okKey(a.id) }
          : { server: a.server, ratingKey: okKey(a.key), type: String(a.type || '') };
        return PlexView.read.children(m).then(flat);
      }
      if (op === 'details') return details(a);
      if (op === 'search') return PlexView.read.search(String(a.q || '').slice(0, 100)).then(function (rows) { return withPics({ items: [].concat.apply([], rows.map(function (r) { return r.items; })).filter(function (x) { return /^(movie|show|episode)$/.test(x.type); }).slice(0, 60).map(slim) }); });
      if (op === 'play') { known(a.server); return PlexPage.playKey(a.server, okKey(a.key), !!a.fromStart); }
      if (op === 'next') { known(a.server); return PlexPage.playNextKey(a.server, okKey(a.key)); }
      if (op === 'extra') { known(a.server); return PlexPage.playExtra(a.server, okKey(a.key)); }
      if (op === 'watched') { known(a.server); return PlexPage.markKey(a.server, okKey(a.key), !!a.on); }
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error('The TV doesn\'t know that Plex question.'));
  }

  return { answer: answer, _test: { slim: slim, row: row, person: person } };
})();
