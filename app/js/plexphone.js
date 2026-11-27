/* Plex from the phone app (its Plex tab, shown once Plex.added()): the phone asks here (phone.js, the sealed
   'plex' question) and plays on the TV.  Nothing plays on the phone.
     { op: 'libs' }                      -> { libs, pics }  the libraries picked, in order
     { op: 'home' }                      -> { rows, pics }  the Plex tab's Home rows (Continue watching first)
     { op: 'lib', server, key, offset }  -> { items, total, pics }  a library, 60 at a time, newest first
     { op: 'children', server, key }     -> { items, pics }  a show's seasons, a season's episodes, a collection
     { op: 'search', q }                 -> { items, pics }  movies and shows on every server picked
     { op: 'play', server, key, fromStart } -> { title }  opens the title on the TV and plays it (where you stopped)
   pics: { server id: { base, token } } so the phone fetches posters straight from the server (the token in a
   header there, never in an address).  Server tokens only (each for its own server), never the account's.
   Chromium 53-compatible. */
var PlexPhone = (function () {
  'use strict';
  var PAGE = 60;
  function mc(j) { return (j && j.MediaContainer) || {}; }
  // A title as the phone shows it: small, with where you stopped.
  function slim(m) {
    var ep = m.type === 'episode';
    return {
      server: m.server, key: String(m.ratingKey || ''), type: m.type, title: ep ? (m.grandparentTitle || m.title) : m.title,
      sub: ep ? 'S' + (m.parentIndex || 0) + ' · E' + (m.index || 0) + '  ' + (m.title || '') : m.type === 'season' ? (m.title || '') : String(m.year || ''),
      thumb: ep && m.grandparentThumb ? m.grandparentThumb : m.thumb || '', wide: ep ? (m.thumb || '') : '',
      offset: m.viewOffset || 0, duration: m.duration || 0, watched: m.viewCount > 0 && !m.viewOffset ? 1 : 0,
      left: m.leafCount && m.viewedLeafCount != null ? m.leafCount - m.viewedLeafCount : 0, summary: String(m.summary || '').slice(0, 600)
    };
  }
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

  /* One question from the phone (phone.js answers with what this resolves to, or the error's message). */
  function answer(a) {
    if (typeof Plex === 'undefined' || !Plex.added()) return Promise.reject(new Error('Plex isn\'t set up on the TV.  Add a server in Settings > Plex.'));
    var op = String(a.op || 'libs');
    try {
      if (op === 'libs') return Promise.all(Plex.chosen().map(function (s) { return Plex.reach(s.id).catch(function () {}); })).then(function () { return withPics({ libs: libs() }); });
      if (op === 'home') return PlexView.read.home().then(function (rows) { return withPics({ rows: rows.map(function (r) { return { title: r.title, wide: !!r.wide, items: r.items.slice(0, 30).map(slim) }; }) }); });
      if (op === 'lib') {
        known(a.server); var k = okKey(a.key), off = Math.max(0, +a.offset || 0), l = libs().filter(function (x) { return x.server === a.server && x.key === k; })[0];
        if (!l) throw new Error('That library isn\'t picked on the TV.');
        return Plex.call(l.server, '/library/sections/' + k + '/all?type=' + (l.type === 'show' ? 2 : 1) + '&sort=addedAt:desc&X-Plex-Container-Start=' + off + '&X-Plex-Container-Size=' + PAGE).then(function (j) {
          return withPics({ items: (mc(j).Metadata || []).map(function (m) { m.server = l.server; return slim(m); }), total: mc(j).totalSize || 0 });
        });
      }
      if (op === 'children') {
        known(a.server);
        var m = { server: a.server, ratingKey: okKey(a.key), type: String(a.type || '') };
        return PlexView.read.children(m).then(function (rows) { return withPics({ items: [].concat.apply([], rows.map(function (r) { return r.items; })).map(slim) }); });
      }
      if (op === 'search') return PlexView.read.search(String(a.q || '').slice(0, 100)).then(function (rows) { return withPics({ items: [].concat.apply([], rows.map(function (r) { return r.items; })).filter(function (x) { return /^(movie|show|episode)$/.test(x.type); }).slice(0, 60).map(slim) }); });
      if (op === 'play') { known(a.server); return PlexPage.playKey(a.server, okKey(a.key), !!a.fromStart); }
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error('The TV doesn\'t know that Plex question.'));
  }

  return { answer: answer, _test: { slim: slim } };
})();
