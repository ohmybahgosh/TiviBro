/* My media: the viewer's own movies, from a home media server (DLNA, like a Fritz!Box) or a cloud
   (WebDAV, like premiumize).  Full-width poster shelves and the normal movie player.  The helper does the
   network work (service/media.js); MediaStore keeps what is remembered.

   Titles start with folder names.  Explicitly requested TMDB lookups add movie details and posters;
   only titles/years or chosen movie IDs are sent.  A WebDAV signed link is resolved for every play. */
var Media = (function () {
  'use strict';
  var $ = U.$;
  var built = false, playingMeta = null, scanning = {}, playToken = 0, loaded = null;

  /* ---------- helper ---------- */
  function ask(route, body, ms) {
    if (!Net.port) return Promise.reject(new Error('The TiviBro helper is not running.  Close TiviBro and open it again.'));
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(error, result) { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(result); }
      var timer = setTimeout(function () { finish(new Error('The media request timed out.  Please try again.')); if (ctl) ctl.abort(); }, ms);
      fetch('http://127.0.0.1:' + Net.port + '/media/' + route, { method: 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json(); }).then(function (j) { finish(null, j); }, function () { finish(new Error('Could not reach the media helper.  Please try again.')); });
    });
  }
  function scanSource(source) { return MediaStore.load().then(function () { return ask('scan', { source: source }, 150000); }); }

  function why(e) { return (e && e.message) || 'That did not work.'; }

  /* ---------- poster shelves ---------- */
  var shelves = [], shelfAt = 2, shelfPos = {}, shelfViews = [], posterQueue = [], posterBusy = 0;
  var TILE_STEP = 260, TILE_POOL = 7;
  var itemsVL = { current: function () { var s = shelves[shelfAt]; return s && s.movies[shelfPos[s.id] || 0]; }, refresh: function () { refresh(); } };
  function label(m) { return m.title + (m.year ? ' (' + m.year + ')' : ''); }
  function size(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : ''; }
  function fileInfo(m) { return (m.info || []).concat(m.ext ? [String(m.ext).toUpperCase()] : []).join('   '); }
  function pumpPosters() {
    posterQueue = posterQueue.filter(function (q) { return !!q.img.parentNode; });
    while (posterBusy < 2 && posterQueue.length) {
      var q = posterQueue.shift(); if (!q.img.parentNode) continue;
      posterBusy++;
      (function (job) {
        var done = false;
        function finish(failed) { if (done) return; done = true; posterBusy--; job.img.onload = job.img.onerror = null; if (failed && job.img.parentNode) job.img.parentNode.removeChild(job.img); pumpPosters(); }
        job.img.onload = function () { finish(false); }; job.img.onerror = function () { finish(true); };
        job.img.src = Net.active ? Net.wrap(job.url) : job.url;
      })(q);
    }
  }
  function cover(slot, movie) {
    var poster = movie.metadata && movie.metadata.poster || '';
    var key = movie.id + '|' + poster + '|' + (movie.metadata && movie.metadata.title || movie.title) + '|' + (movie.year || movie.metadata && movie.metadata.year || '');
    if (slot.key === key) return;
    slot.key = key; slot.art.innerHTML = '';
    slot.art.appendChild(U.el('span', 'media-monogram', movie.title.slice(0, 1).toUpperCase()));
    if (poster) {
      var img = U.el('img', 'media-cover'); img.alt = ''; img.width = 185; img.height = 278;
      slot.art.appendChild(img); posterQueue.push({ img: img, url: poster });
    }
    slot.title.textContent = movie.metadata && movie.metadata.title || movie.title;
    slot.year.textContent = movie.year || movie.metadata && movie.metadata.year || '';
  }
  function showInfo() {
    var m = itemsVL.current(), box = $('mediaInfo'); box.innerHTML = '';
    if (!m) {
      box.appendChild(U.el('h1', '', 'Your movies, your space'));
      box.appendChild(U.el('p', 'media-summary', MediaStore.sources().length ? 'No movies in this source yet.  Rescan it from Settings › My media.' : 'Add a media server in Settings › My media to start your library.  Movies only for now: TV shows, trailers and extras are left out.'));
      return;
    }
    var md = m.metadata || {}, src = MediaStore.source(m.src), r = MediaStore.resume(m.id);
    if (md.backdrop) {
      var backdrop = U.el('img', 'media-hero-art'); backdrop.alt = ''; backdrop.width = 780; backdrop.height = 439;
      box.appendChild(backdrop); box.appendChild(U.el('div', 'media-hero-wash'));
      posterQueue.push({ img: backdrop, url: md.backdrop });
    }
    box.appendChild(U.el('h1', '', md.title || m.title));
    box.appendChild(U.el('div', 'media-facts', [m.year || md.year, md.genre, md.runtime, fileInfo(m), MediaStore.isFavorite(m.id) ? '★ Favorite' : ''].filter(Boolean).join('   ·   ')));
    box.appendChild(U.el('p', 'media-summary', md.plot || 'Press OK to play.  Hold OK for movie details and favorites.'));
    var bottom = (r ? 'Resume at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min' : 'Ready to watch') + (src ? '   ·   ' + src.name : '');
    box.appendChild(U.el('div', 'media-caption', bottom));
    if (md.provider && ((md.fallbackFields || []).length || MediaStore.preferences().language !== (md.requestedLanguage || md.language || 'en'))) box.appendChild(U.el('span', 'media-language-note', (md.fallbackFields || []).length ? 'English fallback: ' + md.fallbackFields.join(', ') : 'Saved metadata language differs from your preference'));
  }
  function drawShelves() {
    var y = 0, focusedY = 0;
    shelves.forEach(function (s, row) {
      var view = shelfViews[row], at = shelfPos[s.id] || 0;
      at = Math.max(0, Math.min(at, s.movies.length - 1)); shelfPos[s.id] = at;
      if (row === shelfAt) focusedY = y;
      view.el.style.transform = 'translateY(' + y + 'px)';
      view.heading.textContent = s.title; view.count.textContent = s.movies.length ? String(s.movies.length) : '';
      view.empty.textContent = s.id === 'continue' ? 'Movies you start will be waiting here.' : s.id === 'favorites' ? 'Hold OK on a movie to add it to Favorites.' : MediaStore.sources().length ? 'No movies in this source.' : 'Add your first server in Settings › My media.';
      view.empty.classList.toggle('hidden', s.movies.length > 0);
      var start = Math.max(0, Math.min(at - 4, s.movies.length - 6)), used = {};
      for (var i = start; i < Math.min(s.movies.length, start + TILE_POOL); i++) {
        var slot = view.pool[i % TILE_POOL], m = s.movies[i]; used[i % TILE_POOL] = true;
        slot.el.style.display = ''; slot.el.style.transform = 'translateX(' + (i - start) * TILE_STEP + 'px)';
        slot.el._at = i; slot.el._row = row; cover(slot, m);
        slot.el.classList.toggle('sel', row === shelfAt && i === at);
        slot.el.setAttribute('aria-label', label(m));
        var r = MediaStore.resume(m.id); slot.progress.style.width = r && r.dur ? Math.min(100, 100 * r.pos / r.dur) + '%' : '0%';
        slot.favorite.textContent = MediaStore.isFavorite(m.id) ? '★' : '';
      }
      view.pool.forEach(function (slot, n) { if (!used[n]) { slot.el.style.display = 'none'; slot.art.innerHTML = ''; slot.key = ''; } });
      y += s.movies.length ? 440 : 100;
    });
    var height = $('mediaItems').clientHeight || 650;
    $('mediaShelfStage').style.transform = 'translateY(-' + Math.max(0, Math.min(focusedY, y - height + 10)) + 'px)';
    showInfo(); pumpPosters();
  }
  function refresh() {
    if (typeof Settings !== 'undefined' && Settings.live) Settings.live();
    if (!built || $('viewMedia').classList.contains('hidden') || document.body.classList.contains('full')) return;
    var movie = itemsVL.current(), oldShelf = shelves[shelfAt] && shelves[shelfAt].id;
    shelves = MediaStore.sections(null);
    if (oldShelf) shelfAt = shelves.findIndex(function (s) { return s.id === oldShelf; });
    if (shelfAt < 0 || !shelves[shelfAt].movies.length) shelfAt = shelves[0].movies.length ? 0 : 2;
    var active = shelves[shelfAt];
    if (movie) { var at = active.movies.findIndex(function (m) { return m.id === movie.id; }); if (at >= 0) shelfPos[active.id] = at; }
    drawShelves(); hints();
  }

  /* ---------- adding and scanning ---------- */
  // What the scan left out, since My media is for movies only for now (service/media.js moviesOf).
  function leftOut(sk) {
    if (!sk) return '';
    var parts = [], ep = (sk.episodes || 0), tv = (sk.tvFolders || 0), ex = (sk.extras || 0);
    if (ep) parts.push(ep + ' TV episode' + (ep === 1 ? '' : 's'));
    if (tv) parts.push(tv + ' TV season folder' + (tv === 1 ? '' : 's'));
    if (ex) parts.push(ex + ' trailer' + (ex === 1 ? '' : 's') + ' and extras');
    if (!parts.length) return '';
    return '  Left out ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + ': My media is for movies only for now.';
  }
  function found(id, name, r, res) {
    var more = leftOut(res && res.skipped);
    U.toast((r.note || MediaStore.movies(id).length + ' movies on ' + name + '.') + more, r.note || more ? 8000 : 3000);
  }
  function rescan(id) {
    var src = MediaStore.source(id);
    if (!src || scanning[id]) return Promise.resolve({ error: 'busy', message: !src ? 'That media source was removed.' : 'This source is already being scanned.' });
    scanning[id] = 1; refresh();
    U.toast('Looking for movies on ' + src.name + '…');
    return scanSource(src).then(function (res) {
      var r = MediaStore.applyScan(id, res);
      delete scanning[id]; refresh();
      found(id, src.name, r, res);
      return { error: res.error || '', message: res.message || '', kept: r.kept, note: r.note, count: MediaStore.movies(id).length, skipped: res.skipped || null };
    }, function (e) { delete scanning[id]; refresh(); U.toast('Could not read ' + src.name + ': ' + why(e), 6000); return { error: 'helper' }; });
  }
  function addServer(server) {
    var id;
    try { id = MediaStore.addSource({ type: 'dlna', name: server.name, control: server.control }); } catch (e) { U.toast(e.message, 5000); return Promise.resolve(); }
    return rescan(id);
  }
  function browseNetwork() {
    U.toast('Looking for media servers on your network…');
    ask('discover', {}, 12000).then(function (r) {
      var servers = (r && r.servers) || [];
      if (!servers.length) { U.toast('No media servers answered.  Is media sharing on, and is the server on this network?', 6000); return; }
      UI.menu('Media servers', servers.map(function (s) { return { label: s.name, action: function () { addServer(s); } }; }));
    }, function (e) { U.toast(why(e), 5000); });
  }
  function nameFor(address) {
    var m = /^https?:\/\/([^/:]+)/i.exec(address);
    return !m ? address : /premiumize/i.test(m[1]) ? 'premiumize' : m[1];
  }
  // A new login is checked by scanning before anything is saved.
  function addAddress(address, user, pass) {
    address = String(address || '').trim();
    var source = { type: 'webdav', address: address, user: String(user || '').trim(), pass: String(pass || '').trim() };
    U.toast('Checking ' + nameFor(address) + '…');
    return scanSource(source).then(function (res) {
      if (res.error) { U.toast(res.message, 6000); return { error: res.error, message: res.message }; }
      source.name = nameFor(address);
      var id;
      try { id = MediaStore.addSource(source); } catch (e) { U.toast(e.message, 5000); return { error: 'full', message: e.message }; }
      var r = MediaStore.applyScan(id, res);
      refresh();
      found(id, source.name, r, res);
      return { id: id, movies: MediaStore.movies(id).length, skipped: res.skipped || null };
    }, function (e) { U.toast(why(e), 6000); return { error: 'helper', message: why(e) }; });
  }
  function askAddress() {
    UI.prompt('WebDAV address of your movies folder', '', function (address) {
      if (!address.trim()) return;
      UI.prompt(/premiumize/i.test(address) ? 'Customer ID' : 'User name or customer ID', '', function (user) {
        UI.prompt(/premiumize/i.test(address) ? 'API key' : 'Password or API key', '', function (pass) { addAddress(address, user, pass); });
      });
    }, 'Movies only for now: TV shows, trailers and extras are left out.  Point it at your movies folder, for example https://webdav.premiumize.me/Movies/');
  }
  function addMenu() {
    UI.menu('Add movies (movies only for now)', [
      { label: 'Browse my network (DLNA / UPnP)', sub: 'Find a home media server with media sharing turned on', action: browseNetwork },
      { label: 'Add a WebDAV server', sub: 'Enter your movies folder\'s address and login, or use the web editor', action: askAddress }
    ]);
  }
  function metadataRequest(q, language) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('Add your TMDB token in Settings > My media first.'));
    q.credential = token;
    q.language = language || MediaStore.preferences().language;
    return ask('metadata', q, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  var tokenVersion = 0;
  function setTmdbToken(value) {
    var version = ++tokenVersion;
    value = String(value || '').trim();
    if (!value) { MediaStore.setTmdbToken(''); refresh(); return Promise.resolve(MediaStore.preferences()); }
    if (!/^[A-Za-z0-9._-]{24,2048}$/.test(value)) return Promise.reject(new Error('Enter a valid TMDB API key or API Read Access Token.'));
    return ask('metadata', { credential: value, check: true }, 15000).then(function (r) {
      if (version !== tokenVersion) throw new Error('TMDB setup changed while this token was being checked.');
      if (r.error || !r.ok) throw new Error(r.message || 'TMDB did not accept that token.');
      MediaStore.setTmdbToken(value); refresh(); return MediaStore.preferences();
    });
  }
  function needToken() {
    if (MediaStore.tmdbToken()) return false;
    U.toast('Add your own TMDB API token in Settings › My media, or use the web editor.', 6500); return true;
  }
  function findDetails(m) {
    if (needToken()) return;
    UI.confirm('Search TMDB for movie details?  The movie title is sent to TMDB using your saved token.  Images load from image.tmdb.org.', 'Search', function () {
      UI.prompt('Movie title', m.title, function (title) {
        U.toast('Looking for movie details…');
        metadataRequest({ title: title }).then(function (r) {
          if (!r.matches || !r.matches.length) return U.toast('No matching movies found.  Try a different title.', 5000);
          UI.menu('Choose the matching movie', r.matches.map(function (x) { return { label: x.title + (x.year ? ' (' + x.year + ')' : ''), action: function () {
            metadataRequest({ id: x.id }).then(function (r) { return MediaStore.setMetadata(m.id, r.metadata); }).then(function () { refresh(); U.toast('Movie details saved'); }, function (e) { U.toast(why(e), 6000); });
          } }; }));
        }, function (e) { U.toast(why(e), 6000); });
      });
    });
  }
  var fetchingDetails = false, pendingLanguageRefresh = false;
  function fetchDetails(list, language) {
    if (fetchingDetails) return Promise.resolve({ busy: true });
    fetchingDetails = true;
    var at = 0, found = 0, missed = 0;
    return new Promise(function (resolve) {
      function done(message, error) {
        fetchingDetails = false; refresh(); U.toast(message, 7000);
        resolve({ updated: found, missed: missed, error: error || '' });
        if (pendingLanguageRefresh) { pendingLanguageRefresh = false; refreshMetadata().catch(function (e) { U.toast(why(e), 6000); }); }
      }
      function next() {
        if (at >= list.length) return done(found + ' movies updated.  ' + missed + ' need a manual match in movie options.');
        var m = list[at++];
        if (!MediaStore.source(m.src)) return next();
        U.toast('Movie details: ' + at + ' of ' + list.length);
        var id = m.metadata && m.metadata.id;
        var q = id && /^(tmdb:[1-9][0-9]*|tt[0-9]+)$/.test(id) ? { id: id } : { title: m.title, year: m.year, auto: true };
        metadataRequest(q, language).then(function (r) {
          if (r.metadata) {
            var current = MediaStore.movies(m.src).filter(function (x) { return x.id === m.id; })[0];
            if (!current || (current.metadata && current.metadata.id) !== id) return;
            found++; return MediaStore.setMetadata(m.id, r.metadata);
          } missed++;
        }).then(function () { setTimeout(next, 350); }, function (e) { done('Stopped fetching details: ' + why(e) + '  Saved matches are kept.', why(e)); });
      }
      next();
    });
  }
  function refreshMetadata() {
    if (fetchingDetails) { pendingLanguageRefresh = true; return Promise.resolve({ queued: true }); }
    if (!MediaStore.tmdbToken()) return Promise.resolve({ needsToken: true });
    return MediaStore.load().then(function () {
      if (fetchingDetails) { pendingLanguageRefresh = true; return { queued: true }; }
      var language = MediaStore.preferences().language;
      var list = MediaStore.movies(null).filter(function (m) { return m.metadata && (m.metadata.provider !== 'TMDB' || (m.metadata.requestedLanguage || m.metadata.language) !== language); });
      return list.length ? fetchDetails(list, language) : { updated: 0 };
    });
  }
  function updatePreferences(next) {
    var result = MediaStore.preferences(next);
    if (next && next.language) refreshMetadata().catch(function (e) { U.toast('Language saved.  Movie details could not be refreshed: ' + why(e), 6000); });
    refresh(); return result;
  }
  function sourceDetails(s) {
    if (needToken()) return;
    if (fetchingDetails) return U.toast('Movie details are already being fetched.');
    UI.confirm('Fetch movie details from TMDB?  Titles and years or saved movie IDs are sent to TMDB.  Images load from image.tmdb.org.  Your source logins are never sent.', 'Fetch details', function () {
      MediaStore.load().then(function () { return fetchDetails(MediaStore.movies(s.id), MediaStore.preferences().language); }).catch(function (e) { U.toast(why(e), 6000); });
    });
  }
  var scanningAll = false;
  function rescanAll() {
    if (scanningAll || Object.keys(scanning).length) { U.toast('A media rescan is already running.'); return Promise.resolve(); }
    var sources = MediaStore.sources();
    if (!sources.length) { U.toast('Add a media source in Settings › My media first.', 5000); return Promise.resolve(); }
    scanningAll = true;
    var at = 0, failures = 0, kept = 0;
    return MediaStore.load().then(function next() {
      if (at >= sources.length) return;
      return rescan(sources[at++].id).then(function (r) { if (r && r.error) failures++; if (r && r.kept) kept++; return next(); });
    }).then(function () {
      scanningAll = false; refresh(); U.toast(failures ? 'Rescan finished.  ' + failures + ' sources could not be read; their saved movies are kept.' : kept ? 'Media rescan finished.  The list stays as it was where scans found no movies.' : 'Media rescan finished.  Press Yellow to fetch missing movie details.', 6000);
    }, function (e) { scanningAll = false; U.toast('Could not finish the rescan: ' + why(e), 6000); });
  }
  function fetchMissingDetails() {
    if (needToken()) return Promise.resolve();
    if (scanningAll || Object.keys(scanning).length) { U.toast('Wait for the media rescan to finish, then press Yellow.', 5000); return Promise.resolve(); }
    if (fetchingDetails) { U.toast('Movie details are already being fetched.'); return Promise.resolve(); }
    return MediaStore.load().then(function () {
      var language = MediaStore.preferences().language;
      var list = MediaStore.movies(null).filter(function (m) { return !m.metadata || m.metadata.provider !== 'TMDB' || (m.metadata.requestedLanguage || m.metadata.language) !== language; });
      if (!list.length) { U.toast('All movie details are up to date.'); return { updated: 0 }; }
      return fetchDetails(list, language);
    }).catch(function (e) { U.toast(why(e), 6000); });
  }
  function sourceMenu(s) {
    if (!s) return;
    UI.menu(s.name, [
      { label: 'Fetch movie details', sub: 'TMDB · uses your saved API token', action: function () { sourceDetails(s); } },
      { label: 'Rescan', sub: 'Look for added or removed movies', action: function () { rescan(s.id); } },
      { label: 'Remove', sub: 'Your files stay where they are', action: function () {
        UI.confirm('Remove ' + s.name + ' from My media?', 'Remove', function () { MediaStore.load().then(function () { MediaStore.removeSource(s.id); refresh(); U.toast(s.name + ' removed'); }); });
      } }
    ]);
  }

  /* ---------- playback ---------- */
  function play(m, fromStart) {
    if (!m) return;
    var token = ++playToken, r = MediaStore.resume(m.id);
    var startAt = !fromStart && r && r.pos > 30 && r.pos < r.dur - 60 ? r.pos - 5 : 0;
    function go(url) {
      if (token !== playToken || $('viewMedia').classList.contains('hidden') || document.body.classList.contains('nav-open')) return;   // moved on while waiting: nothing starts by itself
      playingMeta = { id: m.id, media: null, title: label(m), sub: m.year || '', item: m, local: true };
      Views.playVod(playingMeta, url, startAt, function () { open(true); });
    }
    if (m.url) return go(m.url);
    var src = MediaStore.source(m.src);
    if (!src || !m.path) { U.toast('This movie\'s source was removed.'); return; }
    U.toast('Opening ' + m.title + '…');
    ask('resolve', { source: src, path: m.path }, 25000).then(function (res) {
      if (token !== playToken) return;
      if (res.error || !res.url) { U.toast(res.message || 'Could not open that movie.', 6000); return; }
      try { Log.hideLinksFrom(String(res.url).split('/')[2]); } catch (e) {}
      go(res.url);
    }, function (e) { if (token === playToken) U.toast('Could not open that movie: ' + why(e), 6000); });
  }
  function checkpoint() { if (playingMeta) MediaStore.saveResume(playingMeta.id, Player.position, Player.duration); }
  function stopped() { if (!playingMeta) return; checkpoint(); playingMeta = null; }
  function ended() {
    if (playingMeta) MediaStore.clearResume(playingMeta.id);
    playingMeta = null;
    Views.stopAll();
    open(true);
  }
  /* ---------- the phone app (app/js/phone.js) ----------
     My media on the phone, in the same shape as Movies (Vod.phone): the shelves as categories, a page of
     movies, one movie's details, and playing it on the TV (from where it stopped, or from the start). */
  function phoneTitle(m) { return (m.metadata && m.metadata.title) || m.title; }
  function phoneFind(id) {
    var m = MediaStore.movies(null).filter(function (x) { return x.id === String(id); })[0];
    if (!m) throw new Error('That movie is no longer in My media.  Rescan on the TV.');
    return m;
  }
  function phoneSlim(m) {
    var r = MediaStore.resume(m.id), md = m.metadata || {}, x = { id: m.id, n: phoneTitle(m), c: md.poster || '', r: '' };
    if (m.year || md.year) x.y = String(m.year || md.year).slice(0, 4);
    if (r && r.dur) x.p = Math.round(100 * r.pos / r.dur);
    return x;
  }
  var ForPhone = {
    cats: function () {
      if (!MediaStore.sources().length) return Promise.resolve({ none: true, cats: [] });
      return MediaStore.load().then(function () {
        return { cats: MediaStore.sections(null).map(function (s) { return { id: s.id, n: s.title, count: s.movies.length, adult: 0, locked: 0 }; }) };
      });
    },
    items: function (cid, q, off, lim) {
      return MediaStore.load().then(function () {
        var list;
        q = String(q || '').trim().toLowerCase();
        if (q) list = MediaStore.movies(null).filter(function (m) { return phoneTitle(m).toLowerCase().indexOf(q) >= 0 || String(m.title).toLowerCase().indexOf(q) >= 0; });
        else list = (MediaStore.sections(null).filter(function (s) { return s.id === (cid || 'all'); })[0] || { movies: [] }).movies;
        off = Math.max(0, +off || 0); lim = Math.min(300, Math.max(1, +lim || 120));
        return { total: list.length, offset: off, items: list.slice(off, off + lim).map(phoneSlim) };
      });
    },
    info: function (id) {
      return MediaStore.load().then(function () {
        var m = phoneFind(id), md = m.metadata || {}, r = MediaStore.resume(m.id), src = MediaStore.source(m.src);
        return { id: m.id, n: phoneTitle(m), c: md.poster || '', plot: md.plot || '', genre: md.genre || '', cast: '', year: String(m.year || md.year || '').slice(0, 4),
          dur: md.runtime || '', r: '', media: [fileInfo(m), m.size ? size(m.size) : '', src ? src.name : ''].filter(Boolean).join('   ·   '),
          pos: r ? Math.round(r.pos) : 0, len: r ? Math.round(r.dur) : 0, fav: MediaStore.isFavorite(m.id) ? 1 : 0 };
      });
    },
    // My media plays from its own screen on the TV, so the TV goes there first (Back then lands on the movie).
    play: function (id, fromStart) {
      return MediaStore.load().then(function () {
        var m = phoneFind(id);
        if (Views.tab !== 'media') Views.switchTab('media');
        if (Views.tab !== 'media') throw new Error('My media could not be opened on the TV.');
        if (document.body.classList.contains('nav-open') && Views.closeNav) Views.closeNav();
        open(true);
        play(m, !!fromStart);
        return { title: phoneTitle(m) };
      });
    }
  };

  function itemMenu(m) {
    if (!m) return;
    var r = MediaStore.resume(m.id);
    UI.menu(label(m), [
      { label: MediaStore.isFavorite(m.id) ? 'Remove from Favorites' : 'Add to Favorites', action: function () { MediaStore.toggleFavorite(m.id); refresh(); } },
      r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(m, false); } },
      { label: r ? 'Play from beginning' : 'Play', action: function () { play(m, true); } },
      { label: m.metadata ? 'Change movie details' : 'Find movie details', sub: 'Search TMDB and choose the correct match', action: function () { findDetails(m); } },
      m.metadata && { label: 'Remove movie details', action: function () { MediaStore.setMetadata(m.id, null); refresh(); } },
      { label: 'File information', sub: fileInfo(m) + (m.size ? ' · ' + size(m.size) : ''), action: function () { UI.menu('File information', [{ label: m.file, sub: (MediaStore.source(m.src) || {}).name || '' }]); } },
      r && { label: 'Mark as watched', action: function () { MediaStore.clearResume(m.id); itemsVL.refresh(); showInfo(); } }
    ]);
  }

  /* ---------- remote and pointer navigation ---------- */
  function hints() {
    if (document.body.classList.contains('nav-open')) return;
    UI.hints([['', 'OK  play'], ['', 'Hold OK or Red  movie options'], ['', 'Back  menu', 'back'], ['green', 'Rescan'], ['yellow', 'Fetch details'], ['blue', 'Settings']]);
  }
  function moveShelf(d) {
    var row = shelfAt + d;
    while (row >= 0 && row < shelves.length && !shelves[row].movies.length) row += d;
    if (row >= 0 && row < shelves.length) { shelfAt = row; drawShelves(); }
  }
  function keys(a) {
    if (a !== 'ok') playToken++;
    if (a === 'green') { rescanAll(); return true; }
    if (a === 'yellow') { fetchMissingDetails(); return true; }
    if (a === 'blue') { Views.switchTab('settings'); Settings.section('media'); return true; }
    var s = shelves[shelfAt], at = s && shelfPos[s.id] || 0;
    if (a === 'up') moveShelf(-1);
    else if (a === 'down') moveShelf(1);
    else if (a === 'back' || (a === 'left' && at === 0)) Views.tabBar(restore);
    else if (s && (a === 'left' || a === 'right' || a === 'chup' || a === 'chdown')) {
      shelfPos[s.id] = Math.max(0, Math.min(s.movies.length - 1, at + (a === 'left' ? -1 : a === 'right' ? 1 : a === 'chup' ? -6 : 6))); drawShelves();
    } else if (a === 'ok') play(itemsVL.current(), false);
    else if (a === 'red' || a === 'hold' || a === 'info') itemMenu(itemsVL.current());
    return true;
  }
  function restore() { UI.setHandler(keys); if (shelves.length) drawShelves(); hints(); }
  function build() {
    ['continue', 'favorites', 'all'].forEach(function () {
      var el = U.el('section', 'media-shelf'), heading = U.el('h2'), count = U.el('span', 'media-shelf-count'), track = U.el('div', 'media-track'), empty = U.el('p', 'media-shelf-empty'), pool = [];
      var title = U.el('div', 'media-shelf-title'); title.appendChild(heading); title.appendChild(count); el.appendChild(title); el.appendChild(track); el.appendChild(empty);
      for (var i = 0; i < TILE_POOL; i++) {
        var tile = U.el('div', 'media-tile'), art = U.el('div', 'media-art'), name = U.el('div', 'media-tile-title'), year = U.el('div', 'media-tile-year'), progress = U.el('i'), favorite = U.el('span', 'media-favorite');
        tile.setAttribute('role', 'button'); var bar = U.el('div', 'media-progress'); bar.appendChild(progress); tile.appendChild(favorite); tile.appendChild(art); tile.appendChild(name); tile.appendChild(year); tile.appendChild(bar);
        (function (node) {
          function focus() { shelfAt = node._row; shelfPos[shelves[shelfAt].id] = node._at; drawShelves(); }
          node.addEventListener('mousemove', function () { if (UI.pointer && (shelfAt !== node._row || (shelfPos[shelves[node._row].id] || 0) !== node._at)) focus(); });
          node.addEventListener('click', function () { focus(); play(itemsVL.current(), false); });
        })(tile);
        track.appendChild(tile); pool.push({ el: tile, art: art, title: name, year: year, progress: progress, favorite: favorite, key: '' });
      }
      $('mediaShelfStage').appendChild(el); shelfViews.push({ el: el, heading: heading, count: count, pool: pool, empty: empty });
    });
    built = true;
  }
  function open(keepState) {
    playToken++;
    if (!built) build(); UI.setHandler(keys);
    if (keepState && loaded) { refresh(); restore(); return; }
    (loaded || (loaded = MediaStore.load())).then(function () {
      if ($('viewMedia').classList.contains('hidden')) return;
      refresh(); restore();
    }).catch(function (e) { U.toast('Could not read My media: ' + why(e), 5000); });
  }

  return {
    leave: function () { playToken++; }, scanSource: scanSource, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, rescan: rescan, addAddress: addAddress,
    rescanAll: rescanAll, fetchMissingDetails: fetchMissingDetails, setTmdbToken: setTmdbToken, updatePreferences: updatePreferences, refreshMetadata: refreshMetadata, addMenu: addMenu, sourceMenu: sourceMenu,
    refresh: refresh, leftOut: leftOut, phone: ForPhone,
    _test: { addServer: addServer, addAddress: addAddress, focusItems: function () { restore(); }, rescanCurrent: function () { var s = MediaStore.sources()[0]; return s ? rescan(s.id) : Promise.resolve(); } }
  };
})();
