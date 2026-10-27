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
    multiMax: 2,                // multiview tiles (webOS TVs often decode only 2 streams)
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
    overlay: 'm',               // l | m | h  transparency of panels over video
    nowStyle: 'fill',           // fill | color | off  how what's on now is marked in the guide
    guideNames: true,           // channel names in the guide (off = logos only)
    twoLineNames: false,        // channel names may wrap to two lines
    showCatchupMark: true,      // ↺ marks for catch-up channels and programmes
    logoPref: 'playlist',       // playlist | guide
    blackSwitch: false,         // hide the old picture while the next channel tunes
    osdOnZap: true,             // info panel when switching channels
    osdMedia: true,             // resolution and player in the info panel
    autoSubs: false,            // turn subtitles on when a stream has them
    ffStep: 120,                // seconds for RW / FF while watching catch-up or movies
    showFav: true,              // Favorites group in the lists
    newGroups: 'show',          // show | hide  groups the provider adds later
    allHidden: false,           // All channels includes channels from hidden groups
    remindAction: 'ask',        // ask | switch
    remindTimeout: 20,          // seconds the reminder question stays up
    qpHidden: {}                // quick menu buttons switched off
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
    if (oldEdits) localStorage.setItem('tivibro.edits.' + p0.id, JSON.stringify(oldEdits));
  }
  delete settings.playlist;

  var edits = null, editsKey = '';
  function loadEdits() {
    editsKey = 'tivibro.edits.' + (settings.active || 'none');
    edits = merge(clone(EDIT_DEFAULTS), read(editsKey));
  }
  loadEdits();

  // After a restore has written new data, nothing in this page may save over it before the reload.
  var frozen = false;
  var saveSettings = U.debounce(function () { if (!frozen) localStorage.setItem('tivibro.settings', JSON.stringify(settings)); }, 300);
  var saveEdits = U.debounce(function () { if (!frozen) localStorage.setItem(editsKey, JSON.stringify(edits)); }, 400);

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
    localStorage.setItem(editsKey, JSON.stringify(edits));     // flush current
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
    idbSet('playlist:' + id, null);
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
  function idbSet(k, v) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction('kv', 'readwrite');
        if (v === null) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  function freeze() { frozen = true; }
  return {
    freeze: freeze,
    get settings() { return settings; },
    get edits() { return edits; },
    get playlist() { return playlist(); },
    normalize: normalize,
    usePlaylist: usePlaylist, upsertPlaylist: upsertPlaylist, removePlaylist: removePlaylist,
    saveSettings: saveSettings, saveEdits: saveEdits,
    resetEdits: function () { edits = merge(clone(EDIT_DEFAULTS), null); saveEdits(); },
    idbGet: idbGet, idbSet: idbSet, DEFAULTS: DEFAULTS
  };
})();
