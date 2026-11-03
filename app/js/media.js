/* My media: the viewer's own movies, from a home media server (DLNA, like a Fritz!Box) or a cloud
   (WebDAV, like premiumize).  Full-width poster shelves and the normal movie player.  The helper does the
   network work (service/media.js); MediaStore keeps what is remembered.

   Titles start with folder names.  Explicitly requested TMDB lookups add movie details and posters;
   only titles/years or chosen movie IDs are sent.  A fresh signed link or authenticated
   localhost stream is resolved for every WebDAV play. */
var Media = (function () {
  'use strict';
  var $ = U.$;
  var built = false, playingMeta = null, scanning = {}, scanRuns = {}, pausedScans = {}, playToken = 0, loaded = null, progressTimer = null;

  /* ---------- helper ---------- */
  function ask(route, body, ms) {
    if(route==='library/query'&&body&&body.kind==='show'&&!body.sort)body.sort=MediaStore.preferences().showSort;   // Sort TV shows by
    if(route==='library/edit'&&!body.idempotencyKey)body.idempotencyKey='edit_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
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
  function scanSource(source,restart) { return MediaStore.load().then(function () { return ask('scan', { source: source, restart:!!restart }, 150000); }); }

  function why(e) { return (e && e.message) || 'That did not work.'; }

  /* ---------- poster shelves ---------- */
  var seriesCards = [], reviewCards = [], continuingShows = [], favouriteShows = [], seriesLoading = false, seriesAgain = false;
  var shelves = [], shelfAt = 2, shelfPos = {}, shelfViews = [], posterQueue = [], posterBusy = 0;
  // Opening My media focuses the first item on screen; shelves that fill in later (shows and episodes come
  // from the helper) still move it there, until the viewer presses a key.
  var followTop = true;
  var TILE_STEP = 260, TILE_POOL = 7;
  var itemsVL = { current: function () { var s = shelves[shelfAt]; return s && s.movies[shelfPos[s.id] || 0]; }, refresh: function () { refresh(); } };
  function label(m) { return (m.title || m.label || '') + (m.year ? ' (' + m.year + ')' : ''); }
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
      box.appendChild(U.el('h1', '', 'Your media, your space'));
      box.appendChild(U.el('p', 'media-summary', MediaStore.sources().length ? 'No movies in this source yet.  Press red for TV shows, or rescan from Settings › My media.' : 'Add a media server in Settings › My media to start your library.'));
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
      var hiddenReview = s.id === 'review' && !s.movies.length;
      view.el.classList.toggle('hidden', hiddenReview);
      if (hiddenReview) return;
      at = Math.max(0, Math.min(at, s.movies.length - 1)); shelfPos[s.id] = at;
      if (row === shelfAt) focusedY = y;
      view.el.style.transform = 'translateY(' + y + 'px)';
      view.heading.textContent = s.title; view.count.textContent = s.movies.length ? String(s.movies.length) : '';
      view.empty.textContent = s.id === 'continue' ? 'Movies you start will be waiting here.' : s.id === 'favorites' ? 'Hold OK on a movie to add it to Favorites.' : s.id === 'shows' ? 'No TV shows yet.  In Settings › My media, set a source\'s Content to Movies and TV shows, then rescan.' : MediaStore.sources().length ? 'No movies in this source.' : 'Add your first server in Settings › My media.';
      view.empty.classList.toggle('hidden', s.movies.length > 0);
      var start = Math.max(0, Math.min(at - 4, s.movies.length - 6)), used = {};
      for (var i = start; i < Math.min(s.movies.length, start + TILE_POOL); i++) {
        var slot = view.pool[i % TILE_POOL], m = s.movies[i]; used[i % TILE_POOL] = true;
        slot.el.style.display = ''; slot.el.style.transform = 'translateX(' + (i - start) * TILE_STEP + 'px)';
        slot.el._at = i; slot.el._row = row; cover(slot, m);
        slot.el.classList.toggle('sel', row === shelfAt && i === at);
        slot.el.setAttribute('aria-label', label(m));
        var r = MediaStore.resume(m.id); slot.progress.style.width = m.progressPercent != null ? m.progressPercent + '%' : r && r.dur ? Math.min(100, 100 * r.pos / r.dur) + '%' : '0%';
        slot.favorite.textContent = (m.favourite || MediaStore.isFavorite(m.id)) ? '★' : '';
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
    shelves = MediaStore.sections(null); shelves[0].movies = shelves[0].movies.concat(continuingShows);shelves[1].movies=shelves[1].movies.concat(favouriteShows);
    shelves = shelves.concat([{id:'shows',title:'TV shows',movies:seriesCards},{id:'review',title:'Needs review',movies:reviewCards}]);
    var top = shelves.findIndex(function (s) { return s.movies.length > 0; });
    if (oldShelf) shelfAt = shelves.findIndex(function (s) { return s.id === oldShelf; });
    if (followTop || shelfAt < 0 || !shelves[shelfAt].movies.length) shelfAt = top < 0 ? 2 : top;
    var active = shelves[shelfAt];
    if (followTop) shelfPos[active.id] = 0;
    else if (movie) { var at = active.movies.findIndex(function (m) { return m.id === movie.id; }); if (at >= 0) shelfPos[active.id] = at; }
    drawShelves(); hints();
  }

  /* ---------- adding and scanning ---------- */
  // What the movie scan left out (service/media.js moviesOf): trailers and extras.  Episodes and season
  // folders aren't left out any more: they are under TV shows.
  function leftOut(sk) {
    var ex = sk && sk.extras || 0;
    return ex ? '  Left out ' + ex + ' trailer' + (ex === 1 ? '' : 's') + ' and extras.' : '';
  }
  function found(id, name, r, res) {
    var more = leftOut(res && res.skipped);
    U.toast((r.note || MediaStore.movies(id).length + ' movies'+(res&&res.episodeFiles?' and '+res.episodeFiles+' episode files':'')+' on ' + name + '.') + more, r.note || more ? 8000 : 3000);
  }
  function rescan(id,restart) {
    var src = MediaStore.source(id);
    if (!src || scanning[id]) return Promise.resolve({ error: 'busy', message: !src ? 'That media source was removed.' : 'This source is already being scanned.' });
    scanning[id] = 1;pausedScans[id]=false; refresh();
    U.toast('Looking for movies and shows on ' + src.name + '…');
    function slice(first){return scanSource(src,first&&restart).then(function (res) {
      var r = MediaStore.applyScan(id, res);
      if(res.resumable&&!res.error&&!pausedScans[id]&&!document.hidden&&MediaStore.source(id)){refreshSeries();refresh();U.toast('Scan saved.  Continuing '+src.name+'…');return new Promise(function(resolve){setTimeout(function(){resolve(slice(false));},500);});}
      delete scanning[id]; refreshSeries(); refresh();
      found(id, src.name, r, res);
      if (!scanningAll) autoSoon();
      return { error: res.error || '', message: res.message || '', kept: r.kept, note: r.note, count: MediaStore.movies(id).length, skipped: res.skipped || null };
    }, function (e) { delete scanning[id]; refresh(); U.toast('Could not read ' + src.name + ': ' + why(e), 6000); return { error: 'helper' }; });}
    var job=slice(true);scanRuns[id]=job;job.then(function(){if(scanRuns[id]===job)delete scanRuns[id];},function(){if(scanRuns[id]===job)delete scanRuns[id];});return job;
  }
  function changeSourceMode(id,mode){
    MediaStore.sourceMode(id,mode);pausedScans[id]=true;var old=scanRuns[id]||Promise.resolve();
    return ask('library/source',{action:'configure',sourceId:id,contentMode:mode},30000).then(function(r){if(r.error)throw new Error(r.message);if(scanning[id])ask('scan/control',{sourceId:id},15000).catch(function(){});return old;}).then(function(){return rescan(id,true);});
  }
  function addServer(server) {
    var id;
    try { id = MediaStore.addSource({ type: 'dlna', name: server.name, control: server.control }); } catch (e) { U.toast(e.message, 5000); return Promise.resolve(); }
    return rescan(id);
  }
  function discover() { return ask('discover', {}, 12000).then(function (r) { return (r && r.servers) || []; }); }
  function browseNetwork() {
    U.toast('Looking for media servers on your network…');
    discover().then(function (servers) {
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
    var source = { contentMode: 'automatic', type: 'webdav', address: address, user: String(user || '').trim(), pass: String(pass || '').trim() };
    U.toast('Checking ' + nameFor(address) + '…');
    return scanSource(source).then(function (res) {
      if (res.error) { U.toast(res.message, 6000); return { error: res.error, message: res.message }; }
      source.name = nameFor(address);
      var id;
      try { id = MediaStore.addSource(source); } catch (e) { U.toast(e.message, 5000); return { error: 'full', message: e.message }; }
      var r = MediaStore.applyScan(id, res);
      if (res.scanHandle) ask('library/adopt', {sourceId:id,scanHandle:res.scanHandle},30000).then(function (saved) { if (saved.error) U.toast(saved.message,6000); refreshSeries(); refresh(); }, function (e) { U.toast(why(e),6000); });
      refresh();
      found(id, source.name, r, res);
      autoSoon();
      return { id: id, movies: MediaStore.movies(id).length, skipped: res.skipped || null };
    }, function (e) { U.toast(why(e), 6000); return { error: 'helper', message: why(e) }; });
  }
  function askAddress() {
    UI.prompt('WebDAV address of your media folder', '', function (address) {
      if (!address.trim()) return;
      UI.prompt(/premiumize/i.test(address) ? 'Customer ID' : 'User name or customer ID', '', function (user) {
        UI.prompt(/premiumize/i.test(address) ? 'API key' : 'Password or API key', '', function (pass) { addAddress(address, user, pass); });
      });
    }, 'Files can be in this folder or its subfolders.  Movies and TV shows are recognised from their names.');
  }
  function addMenu() {
    UI.menu('Add media', [
      { label: 'Browse my network (DLNA / UPnP)', sub: 'Find a home media server with media sharing turned on', action: browseNetwork },
      { label: 'Add a WebDAV server', sub: 'Enter your media folder\'s address and login, or use the web editor', action: askAddress }
    ]);
  }
  function metadataRequest(q, language) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('Add your TMDB token in Settings > My media first.'));
    q.credential = token;
    q.language = language || MediaStore.preferences().language;
    return ask('metadata', q, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  // A guide programme that may be a movie (movies.js): { metadata } or { miss }.
  function guideLookup(title, year, strength) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, guide: strength || 'weak', title: title, year: year || '', language: MediaStore.preferences().language }, 25000)
      .then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  function movieById(id) {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token'));
    return ask('metadata', { credential: token, id: id, language: MediaStore.preferences().language }, 25000).then(function (r) { if (r.error) throw new Error(r.message); return r; });
  }
  var tokenVersion = 0;
  function setTmdbToken(value) {
    var version = ++tokenVersion;
    value = String(value || '').trim();
    if (!value) { MediaStore.setTmdbToken(''); refresh(); if (typeof Movies !== 'undefined') Movies.poke(); return Promise.resolve(MediaStore.preferences()); }
    if (!/^[A-Za-z0-9._-]{24,2048}$/.test(value)) return Promise.reject(new Error('Enter a valid TMDB API key or API Read Access Token.'));
    return ask('metadata', { credential: value, check: true }, 15000).then(function (r) {
      if (version !== tokenVersion) throw new Error('TMDB setup changed while this token was being checked.');
      if (r.error || !r.ok) throw new Error(r.message || 'TMDB did not accept that token.');
      MediaStore.setTmdbToken(value); refresh(); autoSoon(); if (typeof Movies !== 'undefined') Movies.poke(); return MediaStore.preferences();
    });
  }
  // Settings > My media > Test TMDB token, and the web editor: is the saved token still accepted?
  function testTmdbToken() {
    var token = MediaStore.tmdbToken();
    if (!token) return Promise.reject(new Error('No TMDB token saved yet.'));
    return ask('metadata', { credential: token, check: true }, 15000).then(function (r) {
      if (r.error || !r.ok) throw new Error(r.message || 'TMDB did not accept the saved token.');
      return 'TMDB accepted the saved token.';
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
  function fetchDetails(list, language, quiet) {
    if (fetchingDetails) return Promise.resolve({ busy: true });
    fetchingDetails = true;
    var at = 0, found = 0, missed = 0;
    return new Promise(function (resolve) {
      function done(message, error) {
        fetchingDetails = false; refresh();
        // On its own (autoDetails): a word only when something was found, or it stopped on an error.
        if (!quiet) U.toast(message, 7000);
        else if (error) note('warn', 'Automatic movie details stopped: ' + error);
        else if (found) U.toast('Movie details and posters added for ' + found + (found === 1 ? ' movie.' : ' movies.'), 5000);
        resolve({ updated: found, missed: missed, error: error || '' });
        if (pendingLanguageRefresh) { pendingLanguageRefresh = false; refreshMetadata().catch(function (e) { U.toast(why(e), 6000); }); }
      }
      function next() {
        if (at >= list.length) return done(found + ' movies updated.  ' + missed + ' need a manual match in movie options.');
        var m = list[at++];
        if (!MediaStore.source(m.src)) return next();
        if (!quiet) U.toast('Movie details: ' + at + ' of ' + list.length);
        var id = m.metadata && m.metadata.id;
        var q = id && /^(tmdb:[1-9][0-9]*|tt[0-9]+)$/.test(id) ? { id: id } : { title: m.title, year: m.year, auto: true };
        metadataRequest(q, language).then(function (r) {
          if (r.metadata) {
            var current = MediaStore.movies(m.src).filter(function (x) { return x.id === m.id; })[0];
            if (!current || (current.metadata && current.metadata.id) !== id) return;
            found++; return MediaStore.setMetadata(m.id, r.metadata);
          } missed++;
          return MediaStore.markMissed(m.id);
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
    }).then(function(result){return showDetails(false,result);});
  }
  function showDetails(force,result){
    if(typeof MediaSeries==='undefined'||!MediaSeries.fetchDetails||result&&result.error)return Promise.resolve(result);
    return MediaSeries.fetchDetails(force).then(function(shows){if(result)result.shows=shows;return result||shows;});
  }
  function updatePreferences(next) {
    var result = MediaStore.preferences(next);
    if (next && next.language) refreshMetadata().catch(function (e) { U.toast('Language saved.  Movie details could not be refreshed: ' + why(e), 6000); });
    if (next && typeof next.favoritesInLists === 'boolean') refreshSeries();
    refresh(); return result;
  }
  // The phone app's Fetch details for one source (it asks first on the phone).
  function sourceDetailsNow(id) {
    if (!MediaStore.tmdbToken()) return Promise.reject(new Error('Save your TMDB token first.'));
    if (fetchingDetails) return Promise.reject(new Error('Movie details are already being fetched.'));
    return MediaStore.load().then(function () { return fetchDetails(MediaStore.movies(id), MediaStore.preferences().language); });
  }
  function sourceDetails(s) {
    if (needToken()) return;
    if (fetchingDetails) return U.toast('Movie details are already being fetched.');
    UI.confirm('Fetch movie details from TMDB?  Titles and years or saved movie IDs are sent to TMDB.  Images load from image.tmdb.org.  Your source logins are never sent.', 'Fetch details', function () {
      MediaStore.load().then(function () { return fetchDetails(MediaStore.movies(s.id), MediaStore.preferences().language); }).catch(function (e) { U.toast(why(e), 6000); });
    });
  }
  /* Movies without details or a poster are looked up on their own once a TMDB token is saved: after a
     scan and when TiviBro starts.  The token is the go-ahead (the same titles a manual fetch sends).
     One TMDB had no match for waits a week; a manual fetch or Find movie details still tries. */
  var WEEK = 7 * 86400e3, autoTimer = null;
  function note(lv, m) { if (typeof Log !== 'undefined' && Log[lv]) Log[lv]('media', m); }
  function needsDetails(m, now) {
    if (m.tmdbMiss && now - m.tmdbMiss < WEEK) return false;
    return !m.metadata || (!m.metadata.poster && m.metadata.provider !== 'TMDB');
  }
  function autoDetails() {
    if (!MediaStore.tmdbToken() || fetchingDetails || scanningAll || Object.keys(scanning).length || !MediaStore.sources().length) return Promise.resolve({ skipped: true });
    return MediaStore.load().then(function () {
      var now = Date.now(), list = MediaStore.movies(null).filter(function (m) { return needsDetails(m, now); });
      if (!list.length) return { updated: 0 };
      note('info', 'Looking up details for ' + list.length + ' movie(s) on their own');
      return fetchDetails(list, MediaStore.preferences().language, true);
    }).then(function(result){return showDetails(false,result);}).catch(function (e) { note('warn', 'Automatic media details: ' + why(e)); return { error: why(e) }; });
  }
  function autoSoon(ms) { clearTimeout(autoTimer); autoTimer = setTimeout(function () { try { autoDetails(); } catch (e) { note('warn', 'Automatic movie details: ' + e.message); } }, ms || 3000); }
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
      scanningAll = false; refresh(); autoSoon(8000); U.toast(failures ? 'Rescan finished.  ' + failures + ' sources could not be read; their saved movies are kept.' : kept ? 'Media rescan finished.  The list stays as it was where scans found no movies.' : 'Media rescan finished.  Press Yellow to fetch missing movie details.', 6000);
    }, function (e) { scanningAll = false; U.toast('Could not finish the rescan: ' + why(e), 6000); });
  }
  function fetchMissingDetails() {
    if (needToken()) return Promise.resolve();
    if (scanningAll || Object.keys(scanning).length) { U.toast('Wait for the media rescan to finish, then press Yellow.', 5000); return Promise.resolve(); }
    if (fetchingDetails) { U.toast('Movie details are already being fetched.'); return Promise.resolve(); }
    return MediaStore.load().then(function () {
      var language = MediaStore.preferences().language;
      var list = MediaStore.movies(null).filter(function (m) { return !m.metadata || m.metadata.provider !== 'TMDB' || (m.metadata.requestedLanguage || m.metadata.language) !== language; });
      if (!list.length) return { updated: 0 };
      return fetchDetails(list, language);
    }).then(function(result){return showDetails(true,result);}).catch(function (e) { U.toast(why(e), 6000); });
  }
  function sourceMenu(s) {
    if (!s) return;s=MediaStore.source(s.id)||s;
    UI.menu(s.name, [
      scanning[s.id]&&{label:'Pause scan',action:function(){pausedScans[s.id]=true;ask('scan/control',{sourceId:s.id},15000).then(function(){U.toast('Scan will pause after the current request.');});}},
      !scanning[s.id]&&{label:'Restart scan',action:function(){rescan(s.id,true);}},
      { label: 'Fetch movie details', sub: 'TMDB · uses your saved API token', action: function () { sourceDetails(s); } },
      { label: 'Content: ' + (s.contentMode === 'automatic' ? 'Movies and TV shows' : s.contentMode === 'shows' ? 'TV shows only' : 'Movies only'), action: function () { UI.menu('Source content', ['automatic','movies','shows'].map(function (mode) { return {label:mode === 'automatic' ? 'Movies and TV shows' : mode === 'movies' ? 'Movies only' : 'TV shows only',action:function () { changeSourceMode(s.id,mode).catch(function(e){U.toast(why(e),6000);}); }}; })); } },
      { label:'Review excluded files',action:function(){MediaSeries.excluded();} },
      { label: 'TV shows', action: function () { MediaSeries.open(); } },
      { label: 'Rescan', sub: 'Look for added or removed movies', action: function () { rescan(s.id); } },
      { label: 'Remove', sub: 'Your files stay where they are', action: function () {
        UI.confirm('Remove ' + s.name + ' from My media?', 'Remove', function () { MediaStore.load().then(function () { MediaStore.removeSource(s.id); ask('library/source',{sourceId:s.id,action:'remove'},30000).then(function(){refresh();UI.menu(s.name+' removed',[{label:'Undo removal',action:function(){if(MediaStore.restoreSource(s.id))ask('library/source',{sourceId:s.id,action:'activate'},30000).then(function(){refresh();rescan(s.id);});}},{label:'Done'}]);},function(e){U.toast(why(e),6000);}); }); });
      } }
    ]);
  }

  /* ---------- playback ---------- */
  function play(m, fromStart) {
    if (!m) return;
    if (m.continueEpisode) return MediaSeries.resume(m);
    if (m.kind === 'show') return MediaSeries.showItem(m,restore);
    if (m.review && m.review.length) return MediaSeries.correct(m,restore);
    if (typeof MediaSeries !== 'undefined') MediaSeries.leave();
    var token = ++playToken, r = MediaStore.resume(m.resumeKey || m.id);
    var startAt = !fromStart && r && r.pos > (m.kind === 'episode' ? 5 : 30) && r.pos < r.dur - (m.kind === 'episode' ? 1 : 60) ? Math.max(0,r.pos - 5) : 0;
    if (m.startSec != null && (startAt < m.startSec || (m.endSec != null && startAt >= m.endSec))) startAt = m.startSec;
    function go(url) {
      if (token !== playToken || !MediaStore.source(m.src) || $('viewMedia').classList.contains('hidden') || document.body.classList.contains('nav-open')) return;   // moved on while waiting: nothing starts by itself
      if(m.kind==='episode'){try{Log.hideLinksFrom(String(url).split('/')[2]);}catch(e){}}
      playingMeta = { id: m.resumeKey || m.id, media: null, title: label(m), sub: m.year || '', item: m, local: true, lastPos:startAt,lastAt:Date.now(),continuous:0,session:Date.now()+'_'+token,startedAt:Date.now(),sequence:0 };
      m.playStartedAt=playingMeta.startedAt;
      clearInterval(progressTimer);
      if (m.kind === 'episode') progressTimer = setInterval(function () { checkpoint(true); if (playingMeta && !playingMeta.boundaryPending && playingMeta.item.endSec != null && Player.position >= playingMeta.item.endSec) boundary(); },1000);
      Views.playVod(playingMeta, url, startAt, function () { open(true);if(m.returnTo)m.returnTo(); });
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
  function checkpoint(sample) {
    if (!playingMeta) return;
    if (playingMeta.item.kind === 'episode') {
      var now = Date.now(), delta = Player.position - playingMeta.lastPos, elapsed = (now - playingMeta.lastAt) / 1000;
      if (delta > 0 && delta <= elapsed * 1.5 + 2) playingMeta.continuous += Math.min(delta,elapsed);
      else if (delta < -1 || delta > elapsed * 1.5 + 2) playingMeta.continuous = 0;
      playingMeta.lastPos = Player.position; playingMeta.lastAt = now;
      if (!sample || !playingMeta.lastSaved || now - playingMeta.lastSaved >= 10000) { MediaStore.saveEpisodeResume(playingMeta.id,Player.position,Player.duration); playingMeta.lastSaved = now;
        if(Player.duration>0)ask('library/progress',{handle:playingMeta.item.id,position:Player.position,duration:Player.duration,session:playingMeta.session,startedAt:playingMeta.startedAt,sequence:++playingMeta.sequence,final:!sample},15000).catch(function(){});
      }
    } else MediaStore.saveResume(playingMeta.id, Player.position, Player.duration);
  }
  function boundary(){
    if(!playingMeta||playingMeta.boundaryPending)return;
    var meta=playingMeta,file=meta.item,length=(file.endSec||Player.duration)-(file.startSec||0);
    if(meta.continuous<Math.min(30,length*0.1))return ended();
    meta.boundaryPending=true;clearInterval(progressTimer);progressTimer=null;Player.setPaused(true);checkpoint();
    function stop(){if(playingMeta!==meta)return;playingMeta=null;Views.stopAll();open(true);}
    MediaSeries.completed(file,{
      stop:stop,
      cancel:function(){stop();if(file.returnTo)file.returnTo();},
      continue:function(ep,range){
        if(playingMeta!==meta)return;
        file.episodeHandle=ep.handle;file.showId=ep.showId;file.number=ep.number;file.season=ep.season;file.order=ep.order;file.startSec=range.startSec;file.endSec=range.endSec;file.segmented=true;file.libraryRevision=ep.revision;file.playStartedAt=Date.now();
        file.returnTo=ep.originPage||file.returnTo;
        file.title=(ep.metadata&&ep.metadata.title||ep.title||'Episode')+'  '+(ep.label||'');
        meta.title=file.title;meta.continuous=0;meta.lastPos=Player.position;meta.lastAt=Date.now();meta.boundaryPending=false;
        if(Player.position<range.startSec||Player.position>range.startSec+2)Player.seekTo(range.startSec);
        Player.setPaused(false);if(Views.refreshVodMeta)Views.refreshVodMeta();
        progressTimer=setInterval(function(){checkpoint(true);if(playingMeta&&!playingMeta.boundaryPending&&playingMeta.item.endSec!=null&&Player.position>=playingMeta.item.endSec)boundary();},1000);
      }
    });
  }
  function stopped() {
    clearInterval(progressTimer); progressTimer = null;if(typeof MediaSeries!=='undefined')MediaSeries.leave(); if (!playingMeta) return; checkpoint();
    var item = playingMeta.item, length = (item.endSec || Player.duration) - (item.startSec || 0);
    var position = Player.position - (item.startSec || 0);
    if (item.kind === 'episode' && length > 0 && position >= length - Math.min(60,length * 0.1) && playingMeta.continuous >= Math.min(30,length * 0.1)) {
      if (typeof MediaSeries !== 'undefined') MediaSeries.recordCompletion(item);
    }
    playingMeta = null;
  }
  function ended() {
    clearInterval(progressTimer); progressTimer = null;
    checkpoint();
    var finished = playingMeta && playingMeta.item;
    var eligible = !finished || finished.kind !== 'episode' || playingMeta.continuous >= ((finished.endSec || Player.duration) > 0 ? Math.min(30,((finished.endSec || Player.duration) - (finished.startSec || 0)) * 0.1) : 5);
    if (playingMeta) MediaStore.clearResume(playingMeta.id);
    playingMeta = null;
    Views.stopAll();
    open(true);
    if (eligible && typeof MediaSeries !== 'undefined') MediaSeries.completed(finished);
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
    if (m.kind === 'show') return MediaSeries.showItem(m,restore);
    if (m.review && m.review.length) return MediaSeries.correct(m,restore);
    var r = MediaStore.resume(m.id);
    UI.menu(label(m), [
      { label: MediaStore.isFavorite(m.id) ? 'Remove from Favorites' : 'Add to Favorites', action: function () { MediaStore.toggleFavorite(m.id); refresh(); } },
      r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(m, false); } },
      { label: r ? 'Play from beginning' : 'Play', action: function () { play(m, true); } },
      { label: m.metadata ? 'Change movie details' : 'Find movie details', sub: 'Search TMDB and choose the correct match', action: function () { findDetails(m); } },
      m.metadata && { label: 'Remove movie details', action: function () { MediaStore.setMetadata(m.id, null); refresh(); } },
      { label:'TV shows',action:function () { MediaSeries.open(); } },
      reviewCards.length > 0 && { label:'Needs review',action:function () { MediaSeries.review(); } },
      { label: 'File information', sub: fileInfo(m) + (m.size ? ' · ' + size(m.size) : ''), action: function () { UI.menu('File information', [{ label: m.file, sub: (MediaStore.source(m.src) || {}).name || '' }]); } },
      r && { label: 'Mark as watched', action: function () { MediaStore.clearResume(m.id); itemsVL.refresh(); showInfo(); } }
    ]);
  }

  /* ---------- remote and pointer navigation ---------- */
  function hints() {
    if (document.body.classList.contains('nav-open')) return;
    UI.hints([['', 'OK  play'], ['', 'Hold OK  options', 'hold'], ['', 'Back  menu', 'back'], ['red', 'Options'], ['green', 'Rescan'], ['yellow', 'Fetch details'], ['blue', 'Settings']]);
  }
  function moveShelf(d) {
    var row = shelfAt + d;
    while (row >= 0 && row < shelves.length && !shelves[row].movies.length) row += d;
    if (row >= 0 && row < shelves.length) { shelfAt = row; drawShelves(); }
  }
  function keys(a) {
    followTop = false;
    if (a !== 'ok') playToken++;
    if (a === 'green') { rescanAll(); return true; }
    if (a === 'yellow') { fetchMissingDetails(); return true; }
    if (a === 'red') { if (itemsVL.current()) { itemMenu(itemsVL.current()); return true; } UI.menu('My media', [{label:'TV shows',action:function () { MediaSeries.open(); }},reviewCards.length > 0 && {label:'Needs review',action:function () { MediaSeries.review(); }}].filter(Boolean)); return true; }
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
  function restore() { UI.setHandler(keys);refreshSeries(); if (shelves.length) drawShelves(); hints(); }
  function build() {
    ['continue', 'favorites', 'all', 'shows', 'review'].forEach(function () {
      var el = U.el('section', 'media-shelf'), heading = U.el('h2'), count = U.el('span', 'media-shelf-count'), track = U.el('div', 'media-track'), empty = U.el('p', 'media-shelf-empty'), pool = [];
      var title = U.el('div', 'media-shelf-title'); title.appendChild(heading); title.appendChild(count); el.appendChild(title); el.appendChild(track); el.appendChild(empty);
      for (var i = 0; i < TILE_POOL; i++) {
        var tile = U.el('div', 'media-tile'), art = U.el('div', 'media-art'), name = U.el('div', 'media-tile-title'), year = U.el('div', 'media-tile-year'), progress = U.el('i'), favorite = U.el('span', 'media-favorite');
        tile.setAttribute('role', 'button'); var bar = U.el('div', 'media-progress'); bar.appendChild(progress); tile.appendChild(favorite); tile.appendChild(art); tile.appendChild(name); tile.appendChild(year); tile.appendChild(bar);
        (function (node) {
          function focus() { followTop = false; shelfAt = node._row; shelfPos[shelves[shelfAt].id] = node._at; drawShelves(); }
          node.addEventListener('mousemove', function () { if (UI.pointer && (shelfAt !== node._row || (shelfPos[shelves[node._row].id] || 0) !== node._at)) focus(); });
          node.addEventListener('click', function () { focus(); play(itemsVL.current(), false); });
        })(tile);
        track.appendChild(tile); pool.push({ el: tile, art: art, title: name, year: year, progress: progress, favorite: favorite, key: '' });
      }
      $('mediaShelfStage').appendChild(el); shelfViews.push({ el: el, heading: heading, count: count, pool: pool, empty: empty });
    });
    built = true;
  }
  function refreshSeries() {
    if (seriesLoading) { seriesAgain = true; return; }   // asked again mid-load (a setting changed): load once more after
    seriesLoading = true; seriesAgain = false;
    Promise.all([ask('library/query',MediaStore.preferences().favoritesInLists?{kind:'show',limit:60}:{kind:'show',favourite:false,limit:60},30000),ask('library/query',{kind:'review',limit:60},30000),ask('library/continue',{},30000),ask('library/query',{kind:'show',favourite:true,limit:60},30000)]).then(function (results) {
      seriesCards = (results[0].items || []).map(function (r) { r.id = r.handle; return r; });
      reviewCards = (results[1].items || []).map(function (r) { r.id = r.handle; return r; });
      continuingShows = (results[2].items || []).map(function(r){r.id=r.handle;return r;});
      favouriteShows=(results[3].items||[]).map(function(r){r.id=r.handle;return r;});
      seriesLoading = false; refresh();
      if (seriesAgain) refreshSeries();
    },function () { seriesLoading = false; if (seriesAgain) refreshSeries(); });
  }
  function open(keepState) {
    playToken++;
    if (!built) build(); UI.setHandler(keys);
    if (!keepState) { followTop = true; shelfPos = {}; }
    refreshSeries();
    if (keepState && loaded) { refresh(); restore(); return; }
    (loaded || (loaded = MediaStore.load())).then(function () {
      if ($('viewMedia').classList.contains('hidden')) return;
      refresh(); restore();
    }).catch(function (e) { U.toast('Could not read My media: ' + why(e), 5000); });
  }

  return {
    refreshShows:refreshSeries, discover: discover, addServer: addServer, sourceDetailsNow: sourceDetailsNow, isScanning: function (id) { return !!scanning[id]; }, changeSourceMode:changeSourceMode, pauseScans:function(){Object.keys(scanning).forEach(function(id){pausedScans[id]=true;ask('scan/control',{sourceId:id},15000).catch(function(){});});}, leave: function () { playToken++; stopped(); if (typeof MediaSeries !== 'undefined') MediaSeries.leave(); }, scanSource: scanSource, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, rescan: rescan, addAddress: addAddress,
    rescanAll: rescanAll, guideLookup: guideLookup, movieById: movieById, autoDetails: autoDetails, autoSoon: autoSoon, testTmdbToken: testTmdbToken, fetchMissingDetails: fetchMissingDetails, setTmdbToken: setTmdbToken, updatePreferences: updatePreferences, refreshMetadata: refreshMetadata, addMenu: addMenu, sourceMenu: sourceMenu,
    watchedReset:function(handle,revision){if(playingMeta&&playingMeta.item.episodeHandle===handle){playingMeta.continuous=0;playingMeta.lastPos=Player.position;playingMeta.lastAt=Date.now();playingMeta.item.libraryRevision=revision;playingMeta.item.playStartedAt=Date.now();}}, seeking: function (target) { if (playingMeta) { playingMeta.continuous = 0; playingMeta.lastPos = target; playingMeta.lastAt = Date.now(); } }, currentFile: function () { return playingMeta && playingMeta.item.id; }, cancelPending: function () { playToken++; }, request: ask, playFile: play, restore: restore, refresh: refresh, leftOut: leftOut, phone: ForPhone,
    _test: { addServer: addServer, addAddress: addAddress, focusItems: function () { restore(); }, rescanCurrent: function () { var s = MediaStore.sources()[0]; return s ? rescan(s.id) : Promise.resolve(); } }
  };
})();
