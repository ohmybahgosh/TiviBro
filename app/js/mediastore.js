/* My media: what the TV remembers about the viewer's own movies.  Sources and where each movie stopped
   stay in localStorage under their own key, and the library in the helper's persistent storage (IndexedDB in a browser), so all of it belongs to the TV
   rather than a playlist.  Keeping them out of the settings also keeps source logins out of backups and
   problem reports, which carry the settings.  Like playlist logins, they are stored unencrypted.

   A scan that fails, stops early or finds nothing never takes movies away: a disk that is unplugged or
   still being indexed shouldn't empty the list.  Signed links are never kept, they expire. */
var MediaStore = (function () {
  'use strict';
  var KEY = 'tivibro.media', LIB = 'media:lib', MAX_SOURCES = 8;
  var state = read(), lib = [], saving = null, reading = null, revision = 0, migrationChecked = false, migrationError = null;

  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && Array.isArray(o.sources) && o.resume && typeof o.resume === 'object') { delete o.removedSources; return o; }   // (test builds saved removed sources' logins)
    } catch (e) {}
    return { sources: [], resume: {} };
  }
  function preferences(next) {
    var p = state.preferences || (state.preferences = {}), changed = false;
    if (next && /^(en|nl|de|fr|es|it)$/.test(next.language)) { p.language = next.language; changed = true; }
    if (next && /^(name|release|added)$/.test(next.sort)) { p.sort = next.sort; changed = true; }
    if (next && /^(name|release|added)$/.test(next.showSort)) { p.showSort = next.showSort; changed = true; }
    if (next && typeof next.favoritesInLists === 'boolean') { p.favoritesInLists = next.favoritesInLists; changed = true; }
    if (changed) save();
    return { language: p.language || 'en', sort: p.sort || 'name', showSort: p.showSort || 'name', favoritesInLists: p.favoritesInLists !== false, tmdbConfigured: !!state.tmdbToken };
  }
  function setTmdbToken(value) {
    value = String(value || '').trim();
    if (value && !/^[A-Za-z0-9._-]{24,2048}$/.test(value)) throw new Error('Enter a valid TMDB API key or API Read Access Token.');
    var before = state.tmdbToken; state.tmdbToken = value;
    if (!save()) { state.tmdbToken = before; throw new Error('The TV could not save the token.  Check its available storage.'); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } }
  /* Writes to the helper stay ordered, and later loads wait for the newest one.  At most one write runs
     and one waits: a change made while a write is waiting rides along with it, and the copy of the library
     is taken when the write starts, not when it is asked for.  (Copying the whole library for every movie
     whose details arrived, while each 1 MB write was still going, piled up copies of a 1,600-movie Dropbox
     library until webOS closed TiviBro for using 950 MB.) */
  var queued = null;
  function saveLib() {
    revision++;
    if (queued) return queued;
    function write() {
      queued = null;
      var snapshot = lib.map(function (m) { var out = {}; Object.keys(m).forEach(function (k) { out[k] = m[k]; }); return out; });
      return Store.bigSet(LIB, snapshot);
    }
    var job = saving ? saving.then(write, write) : write();
    if (saving) queued = job;
    saving = job;
    job.then(function () { if (saving === job) saving = null; }, function () { if (saving === job) saving = null; });
    return job;
  }
  function sortKey(m) { return String(m.metadata && m.metadata.title || m.title).toLowerCase() + ' ' + (m.year || ''); }
  function byTitle(a, b) { var x = sortKey(a), y = sortKey(b); return x < y ? -1 : x > y ? 1 : 0; }
  function source(id) { return state.sources.filter(function (s) { return s.id === id; })[0] || null; }

  function addSource(s) {
    if (s.type === 'dlna') {
      var same = state.sources.filter(function (x) { return x.type === 'dlna' && x.control === s.control; })[0];
      if (same) { same.name = s.name || same.name; save(); return same.id; }
    }
    if (state.sources.length >= MAX_SOURCES) throw new Error('You can add up to ' + MAX_SOURCES + ' sources.  Remove one first.');
    var id = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    var row = { id: id, type: s.type, name: s.name, control: s.control, address: s.address, user: s.user, pass: s.pass, contentMode: s.contentMode || 'automatic' };
    // Dropbox: its folder, the account it was signed in with (display only) and the refresh token, a secret like pass.
    if (s.type === 'dropbox') { row.root = s.root || ''; row.account = s.account || ''; row.refresh = s.refresh; }
    state.sources.push(row);
    save(); menu();
    return id;
  }
  // The My media tab shows in the menu only while there is a source (views.js buildTabs).
  function menu() { if (typeof Views !== 'undefined' && Views.buildTabs) setTimeout(function () { Views.buildTabs(); }, 0); }
  function removeSource(id) {
    // Kept in memory only, for Undo right after: a removed source's login is never saved.  Not a Dropbox
    // one: removing it signs it out of Dropbox (Media.signOut), so it could not come back.
    var removed = source(id); if (removed && removed.type !== 'dropbox') undoable[id] = removed;
    state.sources = state.sources.filter(function (s) { return s.id !== id; });
    lib = lib.filter(function (m) { return m.src !== id; });
    save(); saveLib(); menu();
  }
  var undoable = {};
  function restoreSource(id) { var s = undoable[id]; if (!s || state.sources.length >= MAX_SOURCES) return false; state.sources.push(s); delete undoable[id]; save(); menu(); return true; }
  // For screens and the web editor: no logins (no pass, no Dropbox refresh token).
  function publicSources() {
    return state.sources.map(function (s) {
      var out = { id: s.id, type: s.type, name: s.name, address: s.address || '', contentMode:s.contentMode||'movies',episodeFiles:state.sourceStats&&state.sourceStats[s.id]?state.sourceStats[s.id].episodeFiles:0, count: lib.filter(function (m) { return m.src === s.id; }).length };
      if (s.type === 'dropbox') { out.root = s.root || ''; out.account = s.account || ''; }
      return out;
    });
  }
  // What a source is, in words: Settings, the phone app and the web editor say the same.

  function sourceMode(id, mode) { var s = source(id); if (!s || !/^(automatic|movies|shows)$/.test(mode)) throw new Error('Choose a valid source mode.'); s.contentMode = mode; save(); }
  function stamp(srcId, m) {
    var src = source(srcId), out = {};
    Object.keys(m).forEach(function (k) { out[k] = m[k]; });
    out.id = srcId + '|' + m.id; out.src = srcId;
    if (!src || src.type !== 'dlna') delete out.url;   // only a DLNA address is stable
    return out;
  }
  // res is what the helper's /media/scan answered.  Says what happened: { changed, kept, note }.
  function applyScan(srcId, res) {
    if (!source(srcId)) return { changed: false, kept: true, note: 'That media source was removed.' };
    if (!res || res.error || !Array.isArray(res.movies)) return { changed: false, kept: true, note: (res && res.message) || 'The scan did not finish.' };
    if(res.episodeFiles!=null){state.sourceStats=state.sourceStats||{};state.sourceStats[srcId]={episodeFiles:res.episodeFiles};save();}
    var mine = lib.filter(function (m) { return m.src === srcId; });
    var others = lib.filter(function (m) { return m.src !== srcId; });
    if (!res.movies.length && mine.length && !res.fileCount) return { changed: false, kept: true, note: 'The server found no movies, so the list stays as it was.  Is its disk connected?' };
    var old = {}; mine.forEach(function (m) { old[m.id] = m; });
    var now = Date.now();
    var next = res.movies.map(function (m) { var n = stamp(srcId, m), previous = old[n.id]; n.addedAt = previous ? previous.addedAt || 0 : now; if (previous && previous.metadata) n.metadata = previous.metadata; return n; });
    if (res.partial) {
      var seen = {};
      next.forEach(function (m) { seen[m.id] = 1; });
      next = next.concat(mine.filter(function (m) { return !seen[m.id]; }));
    }
    lib = others.concat(next).sort(byTitle);
    saveLib();
    return { changed: true, kept: false, note: res.partial ? 'Some folders could not be read, so older entries stay in the list.' : '' };
  }
  function isFavorite(id) { return !!(state.favorites && state.favorites[id]); }
  function toggleFavorite(id) {
    if (!state.favorites) state.favorites = {};
    if (state.favorites[id]) delete state.favorites[id]; else state.favorites[id] = true;
    save(); return isFavorite(id);
  }
  function sections(srcId) {
    var all = movies(srcId), continuing = all.filter(function (m) { return !!state.resume[m.id]; });
    continuing.sort(function (a, b) { return (state.resume[b.id].at || 0) - (state.resume[a.id].at || 0); });
    return [{ id: 'continue', title: 'Continue watching', movies: continuing },
      { id: 'favorites', title: 'Favorites', movies: all.filter(function (m) { return isFavorite(m.id); }) },
      { id: 'all', title: 'Movies', movies: preferences().favoritesInLists ? all : all.filter(function (m) { return !isFavorite(m.id); }) }];
  }
  // TMDB had no match for it (automatic lookups leave it alone for a week).
  /* Details found one movie at a time (Media.fetchDetails) are saved together: within 5 s of the first
     unsaved one, and at the end (flush).  Saving the whole library for each of 1,600 movies was most of
     what ran a TV out of memory. */
  var later = null;
  function saveSoon() { if (!later) later = setTimeout(function () { later = null; saveLib(); }, 5000); return Promise.resolve(); }
  function flush() { if (later) { clearTimeout(later); later = null; return saveLib(); } return saving || Promise.resolve(); }
  function markMissed(id, batch) { var m = lib.filter(function (m) { return m.id === id; })[0]; if (m) { m.tmdbMiss = Date.now(); return batch ? saveSoon() : saveLib(); } return Promise.resolve(); }
  function setMetadata(id, metadata, batch) { var m = lib.filter(function (m) { return m.id === id; })[0]; if (m) { if (metadata) m.metadata = metadata; else delete m.metadata; return batch ? saveSoon() : saveLib(); } return Promise.resolve(); }
  function movies(srcId) {
    var list = lib.filter(function (m) { var s = source(m.src); return (!srcId || m.src === srcId) && (!s || s.contentMode !== 'shows'); }), sort = preferences().sort;
    return list.sort(function (a, b) {
      var d = 0;
      if (sort === 'release') { var ad = a.metadata && a.metadata.releaseDate || a.year || '', bd = b.metadata && b.metadata.releaseDate || b.year || ''; d = ad < bd ? 1 : ad > bd ? -1 : 0; }
      else if (sort === 'added') d = (b.addedAt || 0) - (a.addedAt || 0);
      return d || byTitle(a, b);
    });
  }
  function load() {
    if (reading) return reading;
    var expected = revision;
    var job = (saving || Promise.resolve()).then(function () { return Store.bigGet(LIB); }).then(function (l) {
      // A scan or removal may finish while the helper is reading an older copy.
      if (revision === expected && Array.isArray(l)) lib = l.filter(function (m) { return !!source(m.src); }).sort(byTitle);
      if (!migrationChecked && typeof Media !== 'undefined' && Media.request) {
        return Media.request('library/migrate',{},60000).then(function(r){migrationChecked=!!r.migrated;migrationError=r.error?r.message:null;return lib;},function(e){migrationError=e.message;return lib;});
      }
      return lib;
    });
    reading = job;
    function done() { if (reading === job) reading = null; }
    job.then(done, done);
    return job;
  }

  // Same rule as Movies: short videos and the first seconds don't count, and the end clears it.
  function saveResume(id, pos, dur) {
    if (!(dur > 60)) return;
    if (pos > dur - 60) delete state.resume[id];
    else if (pos > 30) state.resume[id] = { pos: pos, dur: dur, at: Date.now() };
    else return;
    save();
  }
  function saveEpisodeResume(id, pos, dur) {
    if (!(pos >= 5) || !isFinite(pos) || !(dur > 0) || !isFinite(dur)) return;
    state.resume[id] = {pos:pos,dur:dur,at:Date.now()}; save();
  }
  function sourcePreference(id) { state.preferredMediaSource=id;save(); }
  function clearResume(id) { delete state.resume[id]; save(); }

  return {
    preferredSource: function () { return state.preferredMediaSource || null; }, sourcePreference: sourcePreference, migrationError: function () { return migrationError; }, sources: function () { return state.sources.slice(); }, source: source, sourceMode: sourceMode, publicSources: publicSources, addSource: addSource, removeSource: removeSource, restoreSource: restoreSource,
    tmdbToken: function () { return state.tmdbToken || ''; }, setTmdbToken: setTmdbToken, isFavorite: isFavorite, toggleFavorite: toggleFavorite, sections: sections, preferences: preferences, setMetadata: setMetadata, markMissed: markMissed, flush: flush, applyScan: applyScan, movies: movies, load: load,
    resume: function (id) { return state.resume[id] || null; }, saveResume: saveResume, saveEpisodeResume: saveEpisodeResume, clearResume: clearResume
  };
})();
