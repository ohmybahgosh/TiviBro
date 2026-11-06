/* Persistence.  Settings in localStorage, big lists in IndexedDB.
   Multiple playlists: each has its own id, cache and edits (groups, hidden, renames,
   favorites), so two providers' channel ids never mix.  Every playlist that is on is used at
   once: see "several playlists at once" below for how their edits are merged and split. */
var Store = (function () {
  'use strict';

  var DEFAULTS = {
    playlists: [],           // [{ id, name, type, server, user, pass, m3u, epg }]
    active: '',
    engine: 'auto',          // auto | mse | native
    network: 'auto',         // auto | relay | direct   (see net.js)
    format: 'ts',            // ts | m3u8   (Xtream live URL extension)
    buffer: 'auto',          // auto | low | balanced | stable | max | custom  (auto: learns per provider, playmemo.js)
    custom: { prebuffer: 3, ahead: 30, back: 8, stall: 6, retries: 8 },
    meter: 'auto',           // auto | always | off
    meterPeek: 10,           // seconds the buffer meter shows on demand (Hold Info, Stream info); 0 = until pressed again
    previewPlay: true,
    resumeLast: true,
    showHidden: false,
    display: 'contain',      // Aspect: contain (Original) | fill | cover | 4:3 | 16:9 | 21:9 | stretch43
    names: {
      enabled: true, groups: true,
      packs: { country: true, quality: true, tags: true, superscript: true, feeds: false, brackets: false },
      prefixes: '', suffixes: ''
    },
    sortChannels: 'playlist',   // playlist | number | name | watch
    sortGroups: 'playlist',     // playlist | name   (manual moves always win)
    showAll: true, showRecent: true, favFirst: true,
    recentCount: 20,
    cacheHours: 12,
    epgOffset: 0,               // minutes added to every guide time
    epgHours: 12,               // XMLTV refresh interval
    dimPast: true,
    noSpoilers: false,          // Hide spoilers (discussion #36): no summary or episode title for new and not-yet-aired episodes
    accent: '#5b8cff',
    fontScale: 1,
    osdTimeout: 5,
    showNumbers: true,
    showClock: true,
    exitTwice: true,
    rewindLeft: true,           // Left on a live channel with catch-up rewinds instead of last channel
    skip: 30,                   // seconds per Left/Right while watching catch-up or VOD
    remindBefore: 2,            // minutes
    pin: '',                    // hashed parental PIN
    pinScope: 'channels',       // channels | settings | both
    pinStay: true,              // stay unlocked until the app restarts
    keymap: null,               // remote remapping, see keymap.js (null = defaults)
    keyAliases: {},             // learned keyCode -> button name
    // Added after the TiviMate menu review (all off/neutral by default unless noted).
    theme: 'dark',              // dark (Midnight Electric) | black | slate | ocean | forest | plum | mocha | contrast | classic
    palette: '',                // a full theme (views.js PALETTES: tokyo, dracula, nord…); '' = your own mix of theme and accent
    accentMode: '',             // '' (one of the presets) | custom (accentHue + accentLight)
    accentHue: 210, accentLight: 62,
    focusStyle: 'fill',         // fill | ring (white outline as well)
    hdrRoute: 'auto',           // auto (Dolby Vision on the TV player) | tv (all HDR on the TV player) | builtin
    convertAudio: 'auto',       // auto | off  sound the TV can't play converted to AC-3 by the helper (convert.js)
    convertAsked: false,        // the offer to get the audio converter was shown (kept for older backups)
    convertNever: false,        // "Don't ask again" on that offer
    textSize: 'm',              // s | m | l
    clockDate: false,           // show the date next to the clock
    numFont: 'tv',              // tv | even (every digit the same width) | mono (fixed width, slashed zero)
    overlay: 'm',               // l | m | h  transparency of panels over video
    nowStyle: 'line',           // line | fill | color  how what's on now is marked in the guide (the now line and a shade up to it, also a progress bar, also a coloured cell)
    guideNames: true,           // channel names in the guide (off = logos only)
    twoLineNames: false,        // channel names may wrap to two lines
    showCatchupMark: true,      // ↺ marks for catch-up channels and programmes
    logoPref: 'playlist',       // playlist | guide
    logoLib: 'off',             // off | fill | all  logos from the open logo projects (logos.js)
    logoStyle: 'set',           // set (tv-logos, one style) | original (iptv-org)
    logoBase: '',               // logo index address; empty = tivibro.app/logos/
    blackSwitch: false,         // hide the old picture while the next channel tunes
    backups: 'auto',            // a channel that stops: auto (switch to another version) | ask | off
    osdOnZap: true,             // info panel when switching channels
    osdMedia: true,             // resolution and player in the info panel
    autoSubs: false,            // turn subtitles on when a stream has them
    ffStep: 120,                // seconds for RW / FF while watching catch-up or movies
    showFav: true,              // Favorites group in the lists
    newGroups: 'show',          // show | hide  groups the provider adds later
    allHidden: false,           // All channels includes channels from hidden groups
    remindAction: 'ask',        // ask | switch
    remindTimeout: 20,          // seconds the reminder question stays up
    qpHidden: {},               // quick menu buttons switched off
    newDays: 7,                 // days a channel stays in Recently added (0 = no such group)
    audioLang: '',              // preferred audio language ('' = the stream's own choice), see U.lang
    audioFallback: '',          // when the preferred audio language is missing, try this one ('' = keep the track playing)
    audioSurround: false,       // prefer a 5.1 / Dolby track in that language
    subsLang: '',               // with autoSubs: only subtitles in this language ('' = any)
    watchAhead: 24,             // hours ahead the watchlist looks in the guide
    watchAction: 'remind',      // remind (set a reminder) | tell (just a message)
    myTeams: [],                // teams followed, 'league:abbr' (app/js/teams.js), for the My teams group
    teamsGroup: true,           // show the My teams group when teams are followed
    teamsRemind: false,         // reminders for their games, the same way as the watchlist
    teamsAhead: 6               // hours ahead a game counts for the My teams group
  };

  var EDIT_DEFAULTS = {
    hiddenGroups: {}, hiddenChannels: {}, renames: {}, groupRenames: {},
    custom: [{ id: 'c_fav', name: 'Favorites', items: [] }],
    groupOrder: [], last: null, lastGroup: null,
    recent: [],              // chanKeys, newest first
    watch: {},               // chanKey -> seconds watched
    blockedGroups: {}, blockedChannels: {},
    reminders: [],           // [{ k, s, e, t }]
    resume: {},              // vod id -> { pos, dur, at }
    watched: {},             // vod id -> 1: played to the end or marked watched (a ✓ in Movies and Shows)
    myList: [],              // vod ids
    epgMap: {},              // chanKey -> guide channel id chosen by hand
    groupAdd: {},            // provider group id -> [chanKeys] copied or moved into it
    groupRemove: {},         // provider group id -> { chanKey: 1 } taken out of it
    groupSort: {},           // group id -> provider | az | za | number | custom
    chanOrder: {},           // provider group id -> [chanKeys] in your order (groupSort 'custom')
    watchlist: [],           // [{ q, at }] words and names to look for in the guide (watch.js)
    toolSkip: {},            // Smart clean-up steps skipped in the web editor
    guideSkip: {},           // "Clean up your guide" steps skipped in the web editor
    noGuide: {},             // chanKey -> 1: no guide wanted (left out of guide matching, no "No guide information")
    watchSeen: {},           // 'title|start' -> end, programmes the watchlist already reminded about
    lastPlUpdate: 0, lastEpgUpdate: 0
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    var out = Array.isArray(base) ? base.slice() : {};
    if (!Array.isArray(base)) for (var k in base) out[k] = base[k];
    if (over && typeof over === 'object') {
      for (var j in over) {
        if (over[j] && typeof over[j] === 'object' && !Array.isArray(over[j]) && base[j] && typeof base[j] === 'object' && !Array.isArray(base[j]))
          out[j] = merge(base[j], over[j]);
        else out[j] = over[j];
      }
    }
    return out;
  }
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  var raw = read('tivibro.settings') || {};
  var settings = merge(clone(DEFAULTS), raw);
  // The content filter (filter.js): on for a new TV (the set-up tour asks), off for one that already had playlists.
  if (!settings.filter || typeof settings.filter !== 'object') settings.filter = { adult: !((raw.playlists && raw.playlists.length) || (raw.playlist && (raw.playlist.server || raw.playlist.m3u))), words: [], chans: [], groups: [], asked: !!(raw.playlists && raw.playlists.length) };
  // Alpha 78: Automatic becomes the buffer profile for TVs still on the old default, Balanced (one chosen by hand is kept).
  if (!settings.buf2) { if (!raw.buffer || raw.buffer === 'balanced') settings.buffer = 'auto'; settings.buf2 = 1; }
  // 0.6 look: the old amber default becomes Midnight Electric blue (a chosen colour other than the old default is kept).
  if (!settings.look2) { if (!raw.accent || raw.accent === '#f2b33d') settings.accent = '#5b8cff'; settings.look2 = 1; }
  // Alpha 94: what's on now is marked TiviMate's way, with the now line and a light shade up to it.  The old default (a tint or bar in
  // the cell) and Off both become that; a coloured cell chosen by hand is kept.
  if (!settings.now2) { if (settings.nowStyle !== 'color') settings.nowStyle = 'line'; settings.now2 = 1; }
  // v0.1 had a single "playlist" object.
  if (raw.playlist && (raw.playlist.server || raw.playlist.m3u) && !settings.playlists.length) {
    var p0 = raw.playlist; p0.id = 'p' + Date.now().toString(36);
    p0.name = p0.type === 'm3u' ? 'M3U playlist' : (p0.user || 'Xtream');
    settings.playlists = [p0]; settings.active = p0.id;
    var oldEdits = read('tivibro.edits');
    if (oldEdits) lsSet('tivibro.edits.' + p0.id, JSON.stringify(oldEdits));
  }
  delete settings.playlist;

  var edits = null, editsKey = '', editsRev = 0;
  function loadEdits() {
    editsKey = 'tivibro.edits.' + (settings.active || 'none');
    edits = merge(clone(EDIT_DEFAULTS), read(editsKey));
    attached = []; own = {};
    editsRev++;
  }

  /* ---------- several playlists at once ----------
     Every playlist that is on is used at the same time, like TiviMate.  The first playlist
     (settings.active; Settings > Playlists > the playlist > "Make this the first playlist") loads
     exactly as it always has: its channel keys and group ids are the provider's own ("x5761"), and its
     edits are `edits`, read from and saved to tivibro.edits.<its id> as before.  The other playlists'
     channel keys and group ids get their playlist id and a colon in front ("p1abc:x5761", see
     Library.setOther).  Keys from a provider never hold a colon, so the two can't collide.

     Edits stay with their own playlist: merged when a playlist is loaded, split again on every save.
     - attach(id) reads that playlist's edits and adds its per-channel and per-group entries (hidden,
       renamed, locked, moved, guide links, aspect: the fields in KEY_MAPS, GROUP_MAPS, GROUP_LISTS) to
       `edits`, under the prefixed keys.  Its other fields stay in own[id], untouched.
     - Everything else in `edits` belongs to the first playlist: your own groups and Favorites, Recent,
       reminders, the watchlist, the last channel.  They can hold channels of any playlist.
     - A save splits `edits` again (split()): an entry whose channel or group key starts with the id of
       an attached playlist goes to that playlist's file, without the prefix, and the rest to the first
       playlist's file, as it is.
     Every file writes keys the same way: the playlist's own keys bare, another playlist's with that
     playlist's id in front.  So a key names the same channel whichever playlist is first (toMem,
     toFile), and making another playlist the first only changes which prefix memory leaves off.
     With one playlist on nothing is attached and none of this runs: the same code path as before. */
  // resume, watched and myList: Movies and Shows (vod.js), whose other playlists' keys are "<id>:m123".
  var KEY_MAPS = ['hiddenChannels', 'renames', 'watch', 'blockedChannels', 'epgMap', 'noGuide', 'display', 'resume', 'watched'];
  var GROUP_MAPS = ['hiddenGroups', 'groupRenames', 'blockedGroups', 'groupSort', 'groupAdd', 'groupRemove', 'chanOrder'];
  var GROUP_LISTS = ['groupOrder', 'knownGroups', 'myList'];
  var KEYED = { groupAdd: 'list', chanOrder: 'list', groupRemove: 'map' };     // group maps whose values hold channel keys
  var attached = [], own = {};
  function idSet() { var m = {}; settings.playlists.forEach(function (p) { m[p.id] = 1; }); return m; }
  // A key as every file and memory understand it: "<playlist id>:<provider key>".
  function toGlobal(k, home, ids) { var i = k.indexOf(':'); return i > 0 && ids[k.slice(0, i)] ? k : home + ':' + k; }
  function strip(g, home) { return g.indexOf(home + ':') === 0 ? g.slice(home.length + 1) : g; }
  function toMem(k, file, ids) { return typeof k === 'string' ? strip(toGlobal(k, file, ids), settings.active) : k; }
  function toFile(k, file, ids) { return typeof k === 'string' ? strip(toGlobal(k, settings.active, ids), file) : k; }
  // The attached playlist a key (in memory) belongs to, or '' for the first playlist.
  function ownerOf(k) {
    if (!attached.length || typeof k !== 'string') return '';
    var i = k.indexOf(':');
    return i > 0 && attached.indexOf(k.slice(0, i)) >= 0 ? k.slice(0, i) : '';
  }
  // A group map's value with its channel keys turned by fn.
  function mapValue(f, v, fn) {
    var kind = KEYED[f];
    // A show's resume point names the episode it is on ("e45"), a key of the same playlist.
    if (f === 'resume' && v && typeof v.ep === 'string') { var r = {}; for (var x in v) r[x] = v[x]; r.ep = fn(v.ep); return r; }
    if (kind === 'list' && Array.isArray(v)) return v.map(fn);
    if (kind === 'map' && v && typeof v === 'object') { var o = {}; for (var k in v) o[fn(k)] = v[k]; return o; }
    return v;
  }
  function attach(id) {
    if (!id || id === settings.active || attached.indexOf(id) >= 0) return false;
    var mine = merge(clone(EDIT_DEFAULTS), read('tivibro.edits.' + id)), ids = idSet();
    var m = function (k) { return toMem(k, id, ids); };
    attached.push(id);
    KEY_MAPS.concat(GROUP_MAPS).forEach(function (f) {
      var src = mine[f]; delete mine[f];
      if (!src || typeof src !== 'object') return;
      var dst = edits[f] && typeof edits[f] === 'object' ? edits[f] : (edits[f] = {});
      for (var k in src) dst[m(k)] = mapValue(f, src[k], m);
    });
    GROUP_LISTS.forEach(function (f) {
      var src = mine[f]; delete mine[f];
      if (Array.isArray(src) && src.length) edits[f] = (Array.isArray(edits[f]) ? edits[f] : []).concat(src.map(m));
    });
    own[id] = mine;
    editsRev++;
    return true;
  }
  /* `edits` as the files hold it: { '': the first playlist's, <id>: each attached playlist's }. */
  function split() {
    var out = { '': {} }, ids = idSet(), k;
    for (k in edits) out[''][k] = edits[k];
    attached.forEach(function (id) { var o = {}; for (var x in own[id]) o[x] = own[id][x]; out[id] = o; });
    KEY_MAPS.concat(GROUP_MAPS).forEach(function (f) {
      var src = edits[f];
      if (!src || typeof src !== 'object') return;
      var parts = { '': {} };
      attached.forEach(function (id) { parts[id] = {}; });
      for (var key in src) {
        var w = ownerOf(key);
        if (!w) parts[''][key] = src[key];
        else parts[w][toFile(key, w, ids)] = mapValue(f, src[key], function (x) { return toFile(x, w, ids); });
      }
      for (var p in parts) out[p][f] = parts[p];
    });
    GROUP_LISTS.forEach(function (f) {
      var src = edits[f];
      if (!Array.isArray(src)) return;
      var parts = { '': [] };
      attached.forEach(function (id) { parts[id] = []; });
      src.forEach(function (key) { var w = ownerOf(key); parts[w].push(w ? toFile(key, w, ids) : key); });
      for (var p in parts) out[p][f] = parts[p];
    });
    return out;
  }
  // Take a playlist out again (turned off, deleted, or another playlist became the first).
  function detach(id) {
    var i = attached.indexOf(id);
    if (i < 0) return false;
    flushEdits();
    KEY_MAPS.concat(GROUP_MAPS).forEach(function (f) { var o = edits[f]; if (o && typeof o === 'object') for (var k in o) if (ownerOf(k) === id) delete o[k]; });
    GROUP_LISTS.forEach(function (f) { if (Array.isArray(edits[f])) edits[f] = edits[f].filter(function (k) { return ownerOf(k) !== id; }); });
    attached.splice(i, 1); delete own[id];
    editsRev++;
    return true;
  }
  // Write now, without waiting for the pause after the last change.
  function flushEdits() { if (writeEdits.cancel) writeEdits.cancel(); writeAll(); }
  function writeAll() {
    if (frozen) return;
    if (!attached.length) { lsSet(editsKey, JSON.stringify(edits)); return; }
    var parts = split();
    lsSet(editsKey, JSON.stringify(parts['']));
    attached.forEach(function (id) { lsSet('tivibro.edits.' + id, JSON.stringify(parts[id])); });
  }
  // One playlist's edits as its file holds them (backups): from memory when it is loaded.
  function fileEdits(id) {
    if (id === settings.active) return attached.length ? split()[''] : JSON.parse(JSON.stringify(edits));
    if (attached.indexOf(id) >= 0) return split()[id];
    return read('tivibro.edits.' + id);
  }
  // Which playlist a channel (or a key) belongs to, and its key there.
  function home(k) { var w = ownerOf(k); return w ? { id: w, k: k.slice(w.length + 1) } : { id: settings.active || '', k: k }; }
  loadEdits();

  // After a restore has written new data, nothing in this page may save over it before the reload.
  var frozen = false;
  // Saves can fail when the TV's storage is full: say so once instead of losing changes silently.
  var fullWarned = false;
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      if (window.Log) Log.error('store', 'Could not save ' + k + ' (' + v.length + ' bytes): ' + (e && e.name || e));
      if (!fullWarned && window.U && U.toast) { fullWarned = true; U.toast('The TV\'s storage for TiviBro is full, so recent changes could not be saved.  Try clearing old reminders or watch history.', 8000); }
      return false;
    }
  }
  var saveSettings = U.debounce(function () { if (!frozen) lsSet('tivibro.settings', JSON.stringify(settings)); }, 300);
  var writeEdits = U.debounce(writeAll, 400);
  // A count of edit saves, so the web editor can tell the edits changed without comparing them
  // (with 180,000 channels the hidden lists alone are megabytes; issue #14).
  function saveEdits() { editsRev++; writeEdits(); }

  // Fill in every per-playlist option, and carry older single-value settings forward.
  function normalize(p) {
    if (!p || p._v === 3) return p;
    if (!p.epgSources) p.epgSources = p.epg ? [{ url: p.epg, offset: 0 }] : [];
    delete p.epg;
    if (p.providerEpg == null) p.providerEpg = p.type === 'm3u' ? 'xmltv' : 'short';   // short | xmltv | off
    if (p.epgOffset == null) p.epgOffset = +settings.epgOffset || 0;                     // provider guide offset, minutes
    if (p.plRefresh == null) p.plRefresh = +settings.cacheHours || 12;                   // hours, 0 = manual, -1 = every start
    if (p.epgRefresh == null) p.epgRefresh = +settings.epgHours || 12;
    if (p.epgDays == null) p.epgDays = 2;                                                 // past days kept (catch-up)
    if (p.nameMatch == null) p.nameMatch = true;                                          // match guide by name when ids are missing
    if (!p.names) {
      var g = settings.names;
      p.names = typeof Names !== 'undefined' ? Names.defaults() : null;
      // Older global name settings carry over to the first playlist only; new playlists get fresh defaults.
      if (p.names && g && g.packs && !settings.namesMigrated) {
        settings.namesMigrated = true;
        // v0.1/0.2 global name settings become this playlist's settings.
        p.names.enabled = g.enabled !== false; p.names.groups = g.groups !== false;
        p.names.rules = { country: !!g.packs.country, tags: !!g.packs.tags, quality: !!g.packs.quality, symbols: !!g.packs.superscript, feeds: !!g.packs.feeds, brackets: !!g.packs.brackets };
        p.names.prefixes = (g.prefixes || '').split(',').filter(function (x) { return x.trim(); });
        p.names.suffixes = (g.suffixes || '').split(',').filter(function (x) { return x.trim(); });
        saveSettings();
      }
      if (!p.names) return p;                // Names not loaded yet; try again on next access
    }
    p._v = 3;
    return p;
  }
  function byId(id) { for (var i = 0; i < settings.playlists.length; i++) if (settings.playlists[i].id === id) return normalize(settings.playlists[i]); return null; }
  /* The playlist a channel plays from: the other playlists' channels carry their id (c.p, see
     Library.setOther); the first playlist's carry nothing. */
  function plOf(ch) { return (ch && ch.p && byId(ch.p)) || playlist(); }
  // The playlists in use: the first, then every other one that is attached, in settings order.
  function loaded() { var first = playlist(), out = first && first.id ? [first] : []; settings.playlists.forEach(function (p) { if (attached.indexOf(p.id) >= 0) out.push(normalize(p)); }); return out; }
  function playlist() {
    for (var i = 0; i < settings.playlists.length; i++) if (settings.playlists[i].id === settings.active) return normalize(settings.playlists[i]);
    return normalize(settings.playlists[0]) || { id: '', type: 'xtream', server: '', user: '', pass: '', m3u: '', epgSources: [], providerEpg: 'short', epgOffset: 0, plRefresh: 12, epgRefresh: 12, epgDays: 2, nameMatch: true, names: null, name: '' };
  }
  function usePlaylist(id) {
    flushEdits();                               // write what is in memory, to every playlist's own file
    settings.active = id;
    saveSettings();
    loadEdits();
  }
  function upsertPlaylist(p) {
    if (!p.id) p.id = 'p' + Date.now().toString(36);
    normalize(p);
    var i = settings.playlists.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) settings.playlists[i] = p; else settings.playlists.push(p);
    saveSettings();
    return p;
  }
  function removePlaylist(id) {
    detach(id);
    settings.playlists = settings.playlists.filter(function (x) { return x.id !== id; });
    localStorage.removeItem('tivibro.edits.' + id);
    bigSet('playlist:' + id, null); idbSet('epgpub:' + id, null);
    if (kvOn()) fetch('http://127.0.0.1:' + Net.port + '/vod/forget', { method: 'POST', body: JSON.stringify({ pl: id }) }).catch(function () {});
    // Its restore points and draft history (see webedit.js; on the helper's storage, or the browser's) go with it.
    bigSet('snaps:' + id, null);
    bigGet('drafts:' + id).then(function (l) { (Array.isArray(l) ? l : []).forEach(function (x) { bigSet('draft:' + id + ':' + x.id, null); }); bigSet('drafts:' + id, null); });
    if (settings.active === id) { settings.active = settings.playlists[0] ? settings.playlists[0].id : ''; loadEdits(); }
    saveSettings();
  }

  /* ---------- IndexedDB cache ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('tivibro', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idbGet(k) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var q = d.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { res(undefined); };
      });
    }).catch(function () { return undefined; });
  }
  /* A full TV (issue #18, webOS 4 with a big list): free the cached lists of the other playlists and the
     logo cache, which all come back on their own, then try once more.  Settings and edits are never touched. */
  function freeUp(keep) {
    var mine = (settings.active || '') + '';
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), q = st.getAllKeys ? st.getAllKeys() : null, n = 0;
        if (!q) return res(0);
        q.onsuccess = function () {
          (q.result || []).forEach(function (k) {
            k = String(k);
            if (k === keep) return;
            var m = /^(playlist|vod|epg[a-z]*):([^:]+)/.exec(k);
            if ((m && m[2] !== mine) || /^logos:/.test(k)) { st.delete(k); n++; }
          });
        };
        tx.oncomplete = function () { res(n); };
        tx.onerror = tx.onabort = function () { res(n); };
      });
    }).catch(function () { return 0; });
  }
  function idbSet(k, v, again) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction('kv', 'readwrite');
        if (v === null) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(true); };
        // A failed save always ends in onabort below (nothing here stops the error), so it answers there.
        // A full TV (quota exceeded) aborts the transaction without an error event on it.
        tx.onabort = function () {
          var why = tx.error && tx.error.name || 'aborted';
          if (why === 'QuotaExceededError' && !again && v !== null) {
            return freeUp(k).then(function (n) {
              if (window.Log) Log.warn('store', 'The TV is out of storage saving ' + k + ': freed ' + n + ' cached lists, trying again');
              return n ? idbSet(k, v, true) : false;
            }).then(res);
          }
          if (window.Log) Log.warn('store', 'Could not save ' + k + ' (' + why + ')'); res(false);
        };
      });
    }).catch(function () { return false; });
  }

  /* Big things (the playlist): on a TV the helper keeps them on the TV's storage (service/kv.js), which
     an old TV's small browser storage can't hold (issue #18).  A copy still in the browser's storage
     from an older TiviBro is read once, moved to the helper and freed.  Without the helper, or when
     it can't keep it, the browser's storage as before. */
  function kvOn() { return !!(window.Net && Net.active && Net.port && Net.info && Net.info.kv); }
  /* A big text body goes as a Blob: Chromium keeps a copy of every large string it uploads for far too
     long (a few hundred 1 MB saves held 300 MB on a TV and webOS closed TiviBro), while a Blob's data is
     handed over and freed. */
  function kv(path, body) {
    var b = body;
    if (typeof b === 'string' && b.length > 32768 && typeof Blob !== 'undefined') { try { b = new Blob([b], { type: 'application/json' }); } catch (e) { b = body; } }
    return fetch('http://127.0.0.1:' + Net.port + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: b });
  }
  function bigGet(k) {
    if (!kvOn()) return idbGet(k);
    return kv('/kv/get?k=' + encodeURIComponent(k)).then(function (r) {
      if (r.status === 404) return idbGet(k).then(function (v) {
        // Finish the move before another reader migrates it; if the move fails, the value still answers.
        if (v != null) return bigSet(k, v).then(function () { return v; }, function () { return v; });
        return v;
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { if (window.Log) Log.warn('store', 'The helper could not give ' + k + ' (' + (e && e.message || e) + ')'); return idbGet(k); });
  }
  function bigSet(k, v) {
    if (v === null) { if (kvOn()) kv('/kv/del?k=' + encodeURIComponent(k), '').catch(function () {}); return idbSet(k, null); }
    var live = v && v._live;
    if (v && typeof v === 'object' && '_live' in v) delete v._live;      // a draft's state is a string (issue #50)
    if (!kvOn()) return idbSet(k, v);
    /* A channel list the helper loaded and kept (source.js, live.js): only the few other fields go to
       it, and it saves its own copy of the list.  Turning tens of MB of channels into text here was
       what ran a small TV out of memory on a 187,000-channel reload (issues #24, #25). */
    if (live && v.channels) {
      var extra = {};
      Object.keys(v).forEach(function (x) { if (x !== 'groups' && x !== 'channels') extra[x] = v[x]; });
      return kv('/kv/put?k=' + encodeURIComponent(k) + '&from=' + encodeURIComponent(live), JSON.stringify(extra)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (window.Log) Log.info('store', 'The helper saved its copy of ' + v.channels.length + ' channels');
        return idbSet(k, null);
      }).catch(function (e) {
        if (window.Log) Log.warn('store', 'The helper could not save its copy (' + (e && e.message || e) + '); sending the list');
        return bigSet(k, v);
      });
    }
    var text;
    try { text = JSON.stringify(v); } catch (e) { return idbSet(k, v); }
    return kv('/kv/put?k=' + encodeURIComponent(k), text).then(function (r) {
      text = null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return idbSet(k, null);
    }).catch(function (e) {
      text = null;
      if (window.Log) Log.warn('store', 'The helper could not keep ' + k + ' (' + (e && e.message || e) + '), using the browser\'s storage');
      return idbSet(k, v);
    });
  }

  function freeze() { frozen = true; }
  return {
    freeze: freeze,
    get settings() { return settings; },
    get edits() { return edits; },
    get playlist() { return playlist(); },
    normalize: normalize,
    usePlaylist: usePlaylist, upsertPlaylist: upsertPlaylist, removePlaylist: removePlaylist,
    // A key as playlist file's own form has it (a reminder the helper kept for another playlist), in memory's form.
    keyFrom: function (file, k) { return toMem(k, file, idSet()); },
    byId: byId, plOf: plOf, loaded: loaded, attach: attach, detach: detach, ownerOf: ownerOf, home: home, fileEdits: fileEdits, flushEdits: flushEdits,
    get attached() { return attached.slice(); },
    // The other playlists that are on (to be loaded beside the first), in settings order.
    others: function () { return settings.playlists.filter(function (p) { return !p.off && p.id !== settings.active; }).map(normalize); },
    /* When a playlist's subscription ends, as people say it (issue #13): "Expires in 3 days",
       "Expires 19 Nov", "Expired 2 Oct".  Empty when the provider doesn't say. */
    expiry: function (p) {
      var t = p && +p.exp; if (!t) return '';
      var days = Math.ceil((t - Date.now()) / 86400000), d = new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
      if (days < 0) return 'Expired ' + d;
      if (days === 0) return 'Expires today';
      if (days <= 14) return 'Expires in ' + days + (days === 1 ? ' day' : ' days');
      return 'Expires ' + d;
    },
    saveSettings: saveSettings, saveEdits: saveEdits, get editsRev() { return editsRev; },
    // Clear the first playlist's edits; the other playlists keep theirs.
    resetEdits: function () {
      if (!attached.length) { edits = merge(clone(EDIT_DEFAULTS), null); saveEdits(); return; }
      var keep = attached.slice();
      keep.forEach(detach);
      edits = merge(clone(EDIT_DEFAULTS), null); flushEdits();
      keep.forEach(attach);
      editsRev++;
    },
    idbGet: idbGet, idbSet: idbSet, bigGet: bigGet, bigSet: bigSet, DEFAULTS: DEFAULTS
  };
})();
