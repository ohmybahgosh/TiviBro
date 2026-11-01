/* Persistence.  Settings in localStorage, big lists in IndexedDB.
   Multiple playlists: each has its own id, cache and edits (groups, hidden, renames,
   favorites), so switching playlists never mixes channel ids from two providers. */
var Store = (function () {
  'use strict';

  var DEFAULTS = {
    playlists: [],           // [{ id, name, type, server, user, pass, m3u, epg }]
    active: '',
    engine: 'auto',          // auto | mse | native
    network: 'auto',         // auto | relay | direct   (see net.js)
    format: 'ts',            // ts | m3u8   (Xtream live URL extension)
    buffer: 'balanced',      // low | balanced | stable | max | custom
    custom: { prebuffer: 3, ahead: 30, back: 8, stall: 6, retries: 8 },
    meter: 'auto',           // auto | always | off
    meterPeek: 10,           // seconds the buffer meter shows on demand (Hold Info, Stream info); 0 = until pressed again
    previewPlay: true,
    resumeLast: true,
    showHidden: false,
    display: 'contain',      // contain | fill | cover
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
    accentMode: '',             // '' (one of the presets) | custom (accentHue + accentLight)
    accentHue: 210, accentLight: 62,
    focusStyle: 'fill',         // fill | ring (white outline as well)
    hdrRoute: 'auto',           // auto (Dolby Vision on the TV player) | tv (all HDR on the TV player) | builtin
    textSize: 'm',              // s | m | l
    clockDate: false,           // show the date next to the clock
    numFont: 'tv',              // tv | even (every digit the same width) | mono (fixed width, slashed zero)
    overlay: 'm',               // l | m | h  transparency of panels over video
    nowStyle: 'fill',           // fill | color | off  how what's on now is marked in the guide
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
    myList: [],              // vod ids
    epgMap: {},              // chanKey -> guide channel id chosen by hand
    groupAdd: {},            // provider group id -> [chanKeys] copied or moved into it
    groupRemove: {},         // provider group id -> { chanKey: 1 } taken out of it
    groupSort: {},           // group id -> provider | az | za | number | custom
    chanOrder: {},           // provider group id -> [chanKeys] in your order (groupSort 'custom')
    watchlist: [],           // [{ q, at }] words and names to look for in the guide (watch.js)
    toolSkip: {},            // Smart clean-up steps skipped in the web editor
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
  // 0.6 look: the old amber default becomes Midnight Electric blue (a chosen colour other than the old default is kept).
  if (!settings.look2) { if (!raw.accent || raw.accent === '#f2b33d') settings.accent = '#5b8cff'; settings.look2 = 1; }
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
    editsRev++;
  }
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
  var writeEdits = U.debounce(function () { if (!frozen) lsSet(editsKey, JSON.stringify(edits)); }, 400);
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
  function playlist() {
    for (var i = 0; i < settings.playlists.length; i++) if (settings.playlists[i].id === settings.active) return normalize(settings.playlists[i]);
    return normalize(settings.playlists[0]) || { id: '', type: 'xtream', server: '', user: '', pass: '', m3u: '', epgSources: [], providerEpg: 'short', epgOffset: 0, plRefresh: 12, epgRefresh: 12, epgDays: 2, nameMatch: true, names: null, name: '' };
  }
  function usePlaylist(id) {
    lsSet(editsKey, JSON.stringify(edits));     // flush current
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
    settings.playlists = settings.playlists.filter(function (x) { return x.id !== id; });
    localStorage.removeItem('tivibro.edits.' + id);
    bigSet('playlist:' + id, null); idbSet('epgpub:' + id, null);
    if (kvOn()) fetch('http://127.0.0.1:' + Net.port + '/vod/forget', { method: 'POST', body: JSON.stringify({ pl: id }) }).catch(function () {});
    // Its restore points and draft history (see webedit.js) go with it.
    idbSet('snaps:' + id, null);
    idbGet('drafts:' + id).then(function (l) { (Array.isArray(l) ? l : []).forEach(function (x) { idbSet('draft:' + id + ':' + x.id, null); }); idbSet('drafts:' + id, null); });
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
  function kv(path, body) {
    return fetch('http://127.0.0.1:' + Net.port + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: body });
  }
  function bigGet(k) {
    if (!kvOn()) return idbGet(k);
    return kv('/kv/get?k=' + encodeURIComponent(k)).then(function (r) {
      if (r.status === 404) return idbGet(k).then(function (v) {
        if (v != null) bigSet(k, v);                   // moves it to the helper, and frees the browser's copy
        return v;
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { if (window.Log) Log.warn('store', 'The helper could not give ' + k + ' (' + (e && e.message || e) + ')'); return idbGet(k); });
  }
  function bigSet(k, v) {
    if (v === null) { if (kvOn()) kv('/kv/del?k=' + encodeURIComponent(k), '').catch(function () {}); return idbSet(k, null); }
    if (!kvOn()) return idbSet(k, v);
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
    resetEdits: function () { edits = merge(clone(EDIT_DEFAULTS), null); saveEdits(); },
    idbGet: idbGet, idbSet: idbSet, bigGet: bigGet, bigSet: bigSet, DEFAULTS: DEFAULTS
  };
})();
