/* Edit on a phone or computer.
   Starts the web editor inside the network helper (service/editor.js) on the TV's network
   address, protected by a random password shown on the TV.  While it runs, the app:
   - sends the helper a snapshot of the channel list, guide matching and the user's edits
     (no provider login or stream links; playlists show their host name only), and again
     whenever something changes on the TV;
   - checks every 2 seconds for edits saved in the browser and applies them;
   - runs actions the browser asks for (add or change playlists, guide sources, backup,
     restore) and reports back.
   It is off at every app start; the user switches it on in Settings when needed.  A page
   reload while it runs (restore does that) picks the running editor back up. */
var WebEdit = (function () {
  'use strict';
  var on = false, timer = 0, appliedRev = 0, lastCmd = 0, lastDraft = 0, lastSig = '', status = null, busy = false, onStatus = null;
  var FIELDS = ['hiddenGroups', 'hiddenChannels', 'renames', 'groupRenames', 'custom', 'groupOrder', 'epgMap', 'groupAdd', 'groupRemove', 'groupSort', 'chanOrder', 'watchlist', 'toolSkip'];
  var SORTS = ['provider', 'az', 'za', 'number', 'custom'];
  var SNAP_AUTO = 15, SNAP_NAMED = 30;
  var PORTS = [8787, 8080, 8000, 9090];

  function base() { return Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function call(path, body) {
    if (!base()) return Promise.reject(new Error('The network helper is not running, so the editor cannot start.  See Settings, Diagnostics.'));
    return fetch(base() + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: Net.ctlHeaders(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'helper answered ' + r.status); return j; }); });
  }

  // 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX.
  function generate() {
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = new Uint8Array(8), out = '';
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < 8; i++) out += A[b[i] % A.length];
    return out.slice(0, 4) + '-' + out.slice(4);
  }
  function password() {
    var s = Store.settings;
    if (!s.editorPass) { s.editorPass = generate(); Store.saveSettings(); }
    return s.editorPass;
  }
  function port() { var p = +Store.settings.editorPort; return PORTS.indexOf(p) >= 0 ? p : 8787; }
  function host(u) { var m = /^(?:https?:\/\/)?([^/:?#]+)/i.exec(u || ''); return m ? m[1] : ''; }

  function editsOf() {
    var e = Store.edits, out = {};
    FIELDS.forEach(function (f) { out[f] = e[f] || (f === 'custom' || f === 'groupOrder' || f === 'watchlist' ? [] : {}); });
    return out;
  }
  function sig() { try { return JSON.stringify(draftInfo) + JSON.stringify(editsOf()) + JSON.stringify(Store.playlist.names || null) + JSON.stringify(playlists()) + (Library.data ? Library.data.channels.length : 0) + ':' + (Epg.status && Epg.status.at) + ':' + (Epg.pubStatus && Epg.pubStatus.at); } catch (e) { return String(Date.now()); } }

  // Playlists as the browser sees them: no username, password or full addresses.
  function fileOf(u) { var m = /^[a-z]+:\/\/[^/]+\/(?:[^?#]*\/)?([^/?#]+)/i.exec(String(u || '')); return m && !/[=@]/.test(m[1]) ? decodeURIComponent(m[1]).slice(0, 60) : ''; }
  function playlists() {
    var s = Store.settings;
    return s.playlists.map(function (p) {
      return { id: p.id, name: p.name || (p.type === 'm3u' ? 'M3U playlist' : 'Xtream'), type: p.type, host: host(p.type === 'm3u' ? p.m3u : p.server),
        active: p.id === s.active, ua: p.ua || '', plRefresh: p.plRefresh, epgRefresh: p.epgRefresh, providerEpg: p.providerEpg,
        // Never the address itself (it can hold a login): the host, the file name, and a fingerprint the
        // editor matches against its list of free guides.
        epgSources: (p.epgSources || []).map(function (x) { return { host: host(x.url), file: fileOf(x.url), id: U.hash(String(x.url).trim()), offset: x.offset || 0 }; }) };
    });
  }
  function snapshot() {
    var d = Library.data, p = Store.playlist;
    if (!d) return null;
    var gc = (Epg.guideChannels && Epg.guideChannels()) || [];
    return {
      setup: !Store.settings.playlists.length,     // fresh TV: the editor offers restore or add a playlist
      playlist: { id: p.id, name: p.name || 'Playlist', type: p.type },
      playlists: playlists(),
      groups: d.groups.map(function (g) { return { id: g.id, name: g.name }; }),
      channels: d.channels.map(function (c) { return { k: c.k, n: c.n, g: c.g, num: c.num, logo: c.logo || '', arch: c.arch || 0, epg: Epg.epgId(c) || '', has: !!Epg.hasData(c) }; }),
      guide: { channels: gc.slice(0, 30000).map(function (x) { return [x[0], x[1]]; }), mode: p.providerEpg, sources: (p.epgSources || []).length, xml: !!Epg.xml, loading: !!Epg.loading, status: Epg.status ? { at: Epg.status.at } : null, nameMatch: !!p.nameMatch,
        pub: (function () { var cf = PubEpg.conf(p), ps = Epg.pubStatus; return { on: cf.on, cc: cf.cc, helper: !!Net.active, all: PubEpg.all().map(function (c) { return [c, PubEpg.name(c)]; }),
          status: ps ? { at: ps.at, countries: ps.countries, filled: ps.filled, asked: ps.asked, took: ps.took, none: ps.none || '', sources: ps.sources } : null }; })() },
      gz: Net.canUnzip,
      lastBackup: Store.settings.lastBackup || 0,
      edits: editsOf(),
      names: p.names || null,
      drafts: draftInfo,
      appliedRev: appliedRev
    };
  }
  function push(force) {
    var s = sig();
    if (!force && s === lastSig) return Promise.resolve();
    var snap = snapshot(); if (!snap) return Promise.resolve();
    lastSig = s;
    return call('/editor/snapshot', snap).then(function () { Log.debug('webedit', 'Sent the channel list to the editor (' + snap.channels.length + ' channels)'); })
      .catch(function (e) { lastSig = ''; Log.warn('webedit', 'Could not send the channel list to the editor: ' + e.message); });
  }

  /* ---------- browser edits ---------- */
  function obj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function strs(a) { return Array.isArray(a) ? a.filter(function (k) { return typeof k === 'string'; }) : []; }
  function writeEdits(ed, names) {
    var e = Store.edits, p = Store.playlist, guideChanged = false;
    ['hiddenGroups', 'hiddenChannels', 'renames', 'groupRenames'].forEach(function (f) { if (obj(ed[f])) e[f] = ed[f]; });
    if (Array.isArray(ed.custom)) e.custom = ed.custom.filter(function (g) { return g && typeof g.id === 'string' && g.id.indexOf('c_') === 0 && Array.isArray(g.items); })
      .map(function (g) { var o = { id: g.id, name: String(g.name || 'Group').slice(0, 80), items: strs(g.items) }; if (typeof g.orig === 'string') o.orig = g.orig.slice(0, 80); return o; });
    if (Array.isArray(ed.groupOrder)) e.groupOrder = strs(ed.groupOrder);
    if (obj(ed.groupAdd)) { e.groupAdd = {}; Object.keys(ed.groupAdd).forEach(function (g) { var l = strs(ed.groupAdd[g]); if (l.length) e.groupAdd[g] = l; }); }
    if (obj(ed.groupRemove)) { e.groupRemove = {}; Object.keys(ed.groupRemove).forEach(function (g) { if (obj(ed.groupRemove[g]) && Object.keys(ed.groupRemove[g]).length) e.groupRemove[g] = ed.groupRemove[g]; }); }
    if (Array.isArray(ed.watchlist)) {
      e.watchlist = ed.watchlist.filter(function (w) { return w && typeof w.q === 'string' && w.q.trim().length >= 2; }).slice(0, 100)
        .map(function (w) { return { q: w.q.replace(/\s+/g, ' ').trim().slice(0, 60), at: +w.at || Date.now() }; });
      var words = {}; e.watchlist.forEach(function (w) { words[w.q] = 1; });
      e.reminders = (e.reminders || []).filter(function (r) { return !r.w || words[r.w]; });
      setTimeout(function () { Watch.scan(false); }, 500);
    }
    // Smart clean-up steps you chose to skip: { country: 1, dupes: 1, ... }.
    if (obj(ed.toolSkip)) { e.toolSkip = {}; Object.keys(ed.toolSkip).forEach(function (k) { if (/^[a-z]{2,12}$/.test(k) && ed.toolSkip[k]) e.toolSkip[k] = 1; }); }
    if (obj(ed.chanOrder)) { e.chanOrder = {}; Object.keys(ed.chanOrder).forEach(function (g) { var l = strs(ed.chanOrder[g]); if (l.length) e.chanOrder[g] = l; }); }
    if (obj(ed.groupSort)) { e.groupSort = {}; Object.keys(ed.groupSort).forEach(function (g) { if (SORTS.indexOf(ed.groupSort[g]) >= 0) e.groupSort[g] = ed.groupSort[g]; }); }
    if (obj(ed.epgMap) && JSON.stringify(ed.epgMap) !== JSON.stringify(e.epgMap || {})) { e.epgMap = ed.epgMap; guideChanged = true; }
    if (obj(names)) { p.names = names; Store.upsertPlaylist(p); Names.invalidate(); }
    Store.saveEdits();
    Library.dirty();
    Views.refreshLists(true);
    if (guideChanged) Epg.refresh(Library, false);
  }
  function apply(j) {
    return snap('auto', 'Before changes sent from the computer').catch(function () {}).then(function () {
      writeEdits(j.edits || {}, j.names);
      markSent(j.edits || {});
      appliedRev = j.rev;
      Log.info('webedit', 'Applied changes from the web editor (save ' + j.rev + ')');
      U.toast('Changes from the computer applied');
      return push(true);
    });
  }

  /* ---------- draft history (IndexedDB, per playlist) ----------
     The browser autosaves unsent work a few seconds after each change.  The newest automatic
     version keeps being updated until it is 3 minutes old or 20 changes further along; then a
     new one starts.  Versions you name, and the ones made before sending or discarding, are kept
     apart.  Each version holds only the edits (not the channel list), and the history is capped
     at 8 MB per playlist, oldest automatic versions first. */
  var DRAFT_ROLL_MS = 3 * 60000, DRAFT_ROLL_CHANGES = 20, DRAFT_AUTO = 40, DRAFT_KEEP = 25, DRAFT_BYTES = 8 * 1048576;
  var draftInfo = null, draftQ = Promise.resolve();
  // An index per playlist (small) and each version's edits under its own key, so an autosave
  // writes one version, not the whole history.
  function draftKey(id) { return 'drafts:' + (id || Store.playlist.id); }
  function stateKey(id, rid) { return 'draft:' + (id || Store.playlist.id) + ':' + rid; }
  function drafts(id) { return Store.idbGet(draftKey(id)).then(function (l) { return Array.isArray(l) ? l : []; }, function () { return []; }); }
  function bytes(l) { return l.reduce(function (n, x) { return n + (x.size || 0); }, 0); }
  function editsHash(E) { return U.hash(JSON.stringify(FIELDS.map(function (f) { return E && E[f] != null ? E[f] : null; }))); }
  function summarize(l) {
    var t = l[0];
    draftInfo = { count: l.length, bytes: bytes(l), latest: t ? { id: t.id, at: t.at, changes: t.changes, label: t.label, kind: t.kind, sent: !!t.sent } : null };
    return draftInfo;
  }
  function pruneDrafts(l) {
    var autos = 0, kept = 0;
    l = l.filter(function (x) { return x.kind === 'auto' ? ++autos <= DRAFT_AUTO : ++kept <= DRAFT_KEEP; });
    for (var i = l.length - 1; bytes(l) > DRAFT_BYTES && l.length > 3 && i > 0; i--) if (l[i].kind === 'auto') l.splice(i, 1);
    while (bytes(l) > DRAFT_BYTES && l.length > 3) l.pop();
    return l;
  }
  function saveDraft(d) {
    var id = d.playlist && Store.settings.playlists.some(function (p) { return p.id === d.playlist; }) ? d.playlist : Store.playlist.id;
    draftQ = draftQ.then(function () {
      return drafts(id).then(function (l) {
        var top = l[0], at = d.at || Date.now(), h = U.hash(d.state), eh = '';
        try { eh = editsHash(JSON.parse(d.state).E); } catch (e) {}
        var rec = { id: 'd' + at.toString(36) + Math.floor(Math.random() * 1296).toString(36), at: at, kind: d.kind || 'auto', name: d.name || '', label: d.label || '', changes: +d.changes || 0, size: d.state.length, h: h, eh: eh };
        if (top && top.h === h && rec.kind === 'auto') return;                              // nothing new
        var rolling = top && top.kind === 'auto' && rec.kind === 'auto' && !top.sent && at - (top.started || top.at) < DRAFT_ROLL_MS && Math.abs(rec.changes - (top.startChanges || 0)) < DRAFT_ROLL_CHANGES;
        if (rolling) { rec.id = top.id; rec.started = top.started || top.at; rec.startChanges = top.startChanges || 0; l[0] = rec; }
        else { rec.started = at; rec.startChanges = rec.changes; l.unshift(rec); }
        var kept = pruneDrafts(l.slice()), gone = l.filter(function (x) { return kept.indexOf(x) < 0; });
        return Store.idbSet(stateKey(id, rec.id), d.state).then(function (ok) {
          if (!ok) throw new Error('the TV storage is full');
          return Store.idbSet(draftKey(id), kept);
        }).then(function () {
          gone.forEach(function (x) { Store.idbSet(stateKey(id, x.id), null); });
          if (id === Store.playlist.id) summarize(kept);
        });
      });
    }).catch(function (e) { Log.warn('webedit', 'Could not keep a draft: ' + (e && e.message)); });
    return draftQ;
  }
  // When a save reaches the TV, the newest version that holds exactly it is marked as sent.
  function markSent(edits) {
    var eh = editsHash(edits);
    draftQ = draftQ.then(function () {
      return drafts().then(function (l) {
        var x = l.filter(function (y) { return y.eh === eh; })[0];
        if (x && !x.sent) { x.sent = true; return Store.idbSet(draftKey(), l).then(function () { summarize(l); }); }
      });
    }).catch(function () {});
  }
  function loadDraftInfo() { return drafts().then(summarize); }

  /* ---------- restore points (IndexedDB, per playlist) ---------- */
  function snapKey() { return 'snaps:' + Store.playlist.id; }
  function snaps() { return Store.idbGet(snapKey()).then(function (l) { return Array.isArray(l) ? l : []; }, function () { return []; }); }
  function snap(kind, name) {
    return snaps().then(function (l) {
      var cur = { edits: editsOf(), names: Store.playlist.names || null };
      // Skip an automatic point when nothing changed since the newest one.
      if (kind === 'auto' && l[0] && JSON.stringify(l[0].data) === JSON.stringify(cur)) return l[0];
      var s = { id: 's' + Date.now().toString(36), at: Date.now(), kind: kind, name: String(name || 'Restore point').slice(0, 80), data: JSON.parse(JSON.stringify(cur)),
        stats: { hiddenGroups: Object.keys(cur.edits.hiddenGroups).length, hiddenChannels: Object.keys(cur.edits.hiddenChannels).length, groups: cur.edits.custom.length, renames: Object.keys(cur.edits.renames).length } };
      l.unshift(s);
      var autos = 0, named = 0;
      l = l.filter(function (x) { return x.kind === 'auto' ? ++autos <= SNAP_AUTO : ++named <= SNAP_NAMED; });
      return Store.idbSet(snapKey(), l).then(function () { return s; });
    });
  }
  function snapList() { return snaps().then(function (l) { return l.map(function (x) { return { id: x.id, at: x.at, kind: x.kind, name: x.name, stats: x.stats }; }); }); }

  /* ---------- browser actions ---------- */
  function find(id) { return Store.settings.playlists.filter(function (p) { return p.id === id; })[0]; }
  function clean(v) { return typeof v === 'string' ? v.trim() : ''; }
  function loadAndSave(p) {
    return Source.load(p).then(function (data) {
      var f = data && data.fixed;
      if (f) ['server', 'user', 'pass', 'm3u'].forEach(function (k) { p[k] = f[k]; });
      Store.upsertPlaylist(p);
      return Store.idbSet('playlist:' + p.id, data).then(function () { return data; });
    });
  }
  var RUN = {
    report: function () { return Diag.report().then(function (r) { return { msg: 'ok', data: r }; }); },
    addPlaylist: function (a) {
      var xc = a.type !== 'm3u';
      var p = { id: '', name: clean(a.name), type: xc ? 'xtream' : 'm3u', server: clean(a.server), user: clean(a.user), pass: clean(a.pass), m3u: clean(a.m3u) };
      if (xc && !(p.server && p.user && p.pass) && !Source.credsFromLink(p.server)) throw new Error('Enter the server, username and password.');
      if (!xc && !p.m3u) throw new Error('Enter the playlist address.');
      if (!p.name) p.name = xc ? (p.user || 'Xtream') : 'M3U playlist';
      if (clean(a.epg)) p.epgSources = [{ url: clean(a.epg), offset: 0 }];
      p.id = 'p' + Date.now().toString(36);
      return loadAndSave(p).then(function (data) {
        if (!a.use && Store.settings.playlists.length === 1) { a.use = true; App.tourNext(); }   // first playlist on a fresh TV: then the set-up tour
        if (a.use) App.switchPlaylist(p.id);
        return { msg: 'Added "' + p.name + '" with ' + data.channels.length + ' channels' + (a.use ? '.  The TV switched to it.' : '.') };
      });
    },
    updatePlaylist: function (a) {
      var p = find(a.id); if (!p) throw new Error('That playlist no longer exists.');
      if (clean(a.name)) p.name = clean(a.name);
      if (typeof a.ua === 'string') p.ua = a.ua.trim();
      if (a.plRefresh != null) p.plRefresh = +a.plRefresh;
      if (a.epgRefresh != null) p.epgRefresh = +a.epgRefresh;
      var login = p.type === 'm3u' ? clean(a.m3u) : (clean(a.server) || clean(a.user) || clean(a.pass));
      if (!login) { Store.upsertPlaylist(p); return Promise.resolve({ msg: 'Saved "' + p.name + '"' }); }
      var test = JSON.parse(JSON.stringify(p));
      if (p.type === 'm3u') test.m3u = clean(a.m3u);
      else { if (clean(a.server)) test.server = clean(a.server); if (clean(a.user)) test.user = clean(a.user); if (clean(a.pass)) test.pass = clean(a.pass); }
      return loadAndSave(test).then(function (data) {
        Object.assign(p, test);
        if (p.id === Store.settings.active) App.switchPlaylist(p.id);
        return { msg: 'New login works: ' + data.channels.length + ' channels.  Saved.' };
      });
    },
    deletePlaylist: function (a) {
      var p = find(a.id); if (!p) throw new Error('That playlist no longer exists.');
      if (Store.settings.playlists.length < 2) throw new Error('This is the only playlist.  Add another one first.');
      var wasActive = p.id === Store.settings.active;
      Store.removePlaylist(p.id);
      if (wasActive) App.switchPlaylist(Store.settings.active);
      return { msg: 'Deleted "' + (p.name || 'playlist') + '"' };
    },
    usePlaylist: function (a) {
      var p = find(a.id); if (!p) throw new Error('That playlist no longer exists.');
      App.switchPlaylist(p.id);
      return { msg: 'The TV is now using "' + p.name + '"' };
    },
    refreshPlaylist: function () { return App.refresh(true).then(function () { return { msg: 'Channel list reloaded: ' + Library.count() + ' channels' }; }); },
    addEpgSource: function (a) {
      var p = Store.playlist, url = clean(a.url);
      if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http:// or https:// address.');
      if ((p.epgSources || []).some(function (x) { return x.url === url; })) throw new Error('That guide source is already in the list.');
      p.epgSources = (p.epgSources || []).concat([{ url: url, offset: +a.offset || 0 }]);
      Store.upsertPlaylist(p);
      return bgGuide('Guide source added.');
    },
    removeEpgSource: function (a) {
      var p = Store.playlist, i = +a.index;
      if (!p.epgSources || !p.epgSources[i]) throw new Error('That guide source no longer exists.');
      p.epgSources.splice(i, 1); Store.upsertPlaylist(p);
      return bgGuide('Guide source removed.');
    },
    moveEpgSource: function (a) {
      var p = Store.playlist, i = +a.index, j = i + (+a.dir || 0), l = p.epgSources || [];
      if (!l[i] || !l[j]) throw new Error('Cannot move that guide source.');
      var t = l[i]; l[i] = l[j]; l[j] = t; Store.upsertPlaylist(p);
      return bgGuide('Guide sources reordered.');
    },
    setProviderGuide: function (a) {
      var p = Store.playlist; if (['short', 'xmltv', 'off'].indexOf(a.mode) < 0) throw new Error('bad mode');
      p.providerEpg = a.mode; Store.upsertPlaylist(p);
      return bgGuide({ short: 'Provider guide set to per channel.', xmltv: 'Provider guide set to the full XMLTV file.', off: 'Provider guide switched off.' }[a.mode]);
    },
    reloadGuide: function () { return bgGuide('Reloading the guide.'); },
    setPublicGuide: function (a) {
      var p = Store.playlist, patch = {};
      if (typeof a.on === 'boolean') patch.on = a.on;
      if (Array.isArray(a.cc)) patch.cc = a.cc.map(PubEpg.code).filter(PubEpg.supported).slice(0, 8);
      PubEpg.set(p, patch); Store.upsertPlaylist(p);
      if (a.again) Epg.pubAgain(); else Epg.refresh(Library, false);
      lastSig = '';
      var cf = PubEpg.conf(p);
      return { msg: !cf.on ? 'Public guide fill-in is off.' : a.again ? 'Looking in the public guides again.' : 'Public guide fill-in is on' + (cf.cc.length ? ' for ' + cf.cc.map(PubEpg.name).join(', ') : ', countries picked automatically') + '.' };
    },
    testEpgSource: function (a) {
      var url = clean(a.url);
      if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http:// or https:// address.');
      var t0 = Date.now();
      // Through the helper the guide arrives unzipped, whatever its compression.
      var viaHelper = Net.active;
      // A server that accepts the connection and then goes silent can leave read() pending
      // forever on some TVs' older browser engines.  race() is what actually guarantees giving
      // up -- cancel()/abort() are only best-effort cleanup, since some TVs' 2016-era Streams
      // implementation may not honor either on a pending read.
      var IDLE_MS = 20000, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, rd = null, idle, giveUp, timedOut = false;
      function hangUp() {
        timedOut = true;
        if (ctl) { try { ctl.abort(); } catch (e) {} } else if (rd) { try { rd.cancel(); } catch (e) {} }
        if (giveUp) giveUp(new Error('No data for ' + (IDLE_MS / 1000) + 's.  Check the address and that the server is reachable.'));
      }
      function race(p) {
        clearTimeout(idle);
        var waited = new Promise(function (_, rej) { giveUp = rej; idle = setTimeout(hangUp, IDLE_MS); });
        return Promise.race([p, waited]);
      }
      var size = 0, gz = false, noGzMsg = null;
      return race(fetch(Net.wrap(url, viaHelper ? { unzip: 't' + Date.now().toString(36) } : null), Object.assign({ cache: 'no-store' }, ctl ? { signal: ctl.signal } : null))).then(function (r) {
        if (!r.ok) throw new Error('The server answered ' + r.status + '.  Check the address.');
        var how = r.headers.get('x-unzipped') || '';
        size = +(r.headers.get('x-raw-length') || r.headers.get('content-length')) || 0; gz = !!how || /\.gz($|\?)/.test(url);
        if (!viaHelper && gz && typeof DecompressionStream === 'undefined') { clearTimeout(idle); try { r.body.cancel(); } catch (e) {} noGzMsg = true; return ''; }
        var body = !viaHelper && gz ? r.body.pipeThrough(new DecompressionStream('gzip')) : r.body, dec = new TextDecoder(), txt = '';
        rd = body.getReader();
        function step() {
          return race(rd.read()).then(function (x) {
            if (x.done) { if (timedOut) throw new Error('No data for ' + (IDLE_MS / 1000) + 's.  Check the address and that the server is reachable.'); return txt; }
            txt += dec.decode(x.value, { stream: true });
            if (txt.length > 400000) { try { rd.cancel(); } catch (e) {} return txt; }
            return step();
          });
        }
        return step();
      }).then(function (txt) {
        clearTimeout(idle);
        if (noGzMsg) return { msg: 'Reachable, but this TV can only unzip .gz guides through the network helper.  Set Settings > Playback > Network to Automatic, or use the plain .xml address.', data: { ok: true, size: size, gz: true, noGz: true } };
        if (!/<tv[\s>]/.test(txt) && !/<channel\b/.test(txt)) throw new Error('That address does not return an XMLTV guide.');
        var ch = (txt.match(/<channel\b/g) || []).length, ms = Date.now() - t0;
        return { msg: 'Works.  ' + (size ? (size / 1048576).toFixed(1) + ' MB' + (gz ? ' zipped' : '') + ', ' : '') + 'answered in ' + (ms / 1000).toFixed(1) + ' s.', data: { ok: true, size: size, gz: gz, channelsSeen: ch } };
      }, function (e) {
        clearTimeout(idle);
        throw timedOut ? new Error('No data for ' + (IDLE_MS / 1000) + 's.  Check the address and that the server is reachable.') : e;
      });
    },
    listDrafts: function () {
      return draftQ.then(function () { return drafts(); }).then(function (l) {
        summarize(l);
        return { msg: l.length + ' draft versions', data: { bytes: bytes(l), list: l.map(function (x) { return { id: x.id, at: x.at, started: x.started, kind: x.kind, name: x.name, label: x.label, changes: x.changes, size: x.size, sent: !!x.sent }; }) } };
      });
    },
    getDraft: function (a) {
      return draftQ.then(function () { return drafts(); }).then(function (l) {
        var x = l.filter(function (y) { return y.id === a.id; })[0];
        if (!x) throw new Error('That draft version no longer exists.');
        return Store.idbGet(stateKey(null, x.id)).then(function (state) {
          if (typeof state !== 'string') throw new Error('That draft version could not be read.');
          return { msg: 'Draft version', data: { id: x.id, at: x.at, state: state, changes: x.changes, label: x.label } };
        });
      });
    },
    deleteDraft: function (a) {
      draftQ = draftQ.then(function () { return drafts(); }).then(function (l) {
        l = l.filter(function (x) { return x.id !== a.id; });
        return Store.idbSet(draftKey(), l).then(function () { Store.idbSet(stateKey(null, a.id), null); summarize(l); });
      });
      return draftQ.then(function () { return { msg: 'Draft version deleted' }; });
    },
    listSnaps: function () { return snapList().then(function (l) { return { msg: l.length + ' restore points', data: l }; }); },
    makeSnap: function (a) { return snap('named', clean(a.name) || 'Restore point').then(function (s) { return { msg: 'Restore point "' + s.name + '" saved on the TV', data: { id: s.id } }; }); },
    deleteSnap: function (a) {
      return snaps().then(function (l) { var n = l.filter(function (x) { return x.id !== a.id; }); return Store.idbSet(snapKey(), n).then(function () { return { msg: 'Restore point deleted' }; }); });
    },
    restoreSnap: function (a) {
      return snaps().then(function (l) {
        var s = l.filter(function (x) { return x.id === a.id; })[0];
        if (!s) throw new Error('That restore point no longer exists.');
        return snap('auto', 'Before restoring "' + s.name + '"').then(function () {
          writeEdits(s.data.edits || {}, s.data.names);
          Log.info('webedit', 'Restored "' + s.name + '" from ' + new Date(s.at).toISOString());
          U.toast('Restored "' + s.name + '"');
          return push(true).then(function () { return { msg: 'Restored "' + s.name + '".  The TV is using it now.' }; });
        });
      });
    },
    // The editor's checklist ticks "Download a backup" from this (any phone or computer, any time).
    backup: function () { return Backup.create().then(function (b) { Store.settings.lastBackup = Date.now(); Store.saveSettings(); lastSig = ''; return { msg: 'Backup ready', data: b }; }); },
    restore: function (a) {
      return Backup.restore(a.data).then(function (info) {
        setTimeout(function () { location.reload(); }, 1500);
        return { msg: 'Restored ' + info.playlists + ' playlist(s).  The TV is restarting TiviBro.' };
      });
    }
  };
  // Guide loads can take minutes.  Start them and answer right away; progress reaches the
  // browser on its own (see sendProgress), so the editor never sits on a silent spinner.
  function bgGuide(m) {
    Epg.refresh(Library, true).catch(function (e) { Log.warn('webedit', 'Guide load failed: ' + (e && e.message)); }).then(function () { lastSig = ''; });
    return { msg: m + (Epg.xml ? '  Loading the guide now.' : ''), data: { loading: Epg.xml } };
  }
  var progT = 0, progLast = 0;
  function sendProgress(p, force) {
    if (!on) return;
    clearTimeout(progT);
    var wait = force || !p.active ? 0 : Math.max(0, 900 - (Date.now() - progLast));
    progT = setTimeout(function () { progLast = Date.now(); call('/editor/progress', p).catch(function () {}); }, wait);
  }
  if (typeof Epg !== 'undefined' && Epg.onProgress) Epg.onProgress(function (p) { sendProgress(p); });

  function runCommands(cmds) {
    var chain = Promise.resolve();
    (cmds || []).forEach(function (c) {
      if (c.id <= lastCmd) return;
      lastCmd = c.id;
      chain = chain.then(function () {
        Log.info('webedit', 'Running "' + c.type + '" from the web editor');
        Log.state('editor', 'running "' + c.type + '" from the web editor');
        var fn = RUN[c.type];
        return Promise.resolve().then(function () { if (!fn) throw new Error('Unknown action ' + c.type); return fn(c.args || {}); })
          .then(function (r) { return call('/editor/result', { id: c.id, ok: true, msg: r && r.msg, data: r && r.data }); },
            function (e) { Log.warn('webedit', '"' + c.type + '" failed: ' + (e && e.message)); return call('/editor/result', { id: c.id, ok: false, msg: (e && e.message) || 'failed' }); })
          .then(function () { lastSig = ''; Log.state('editor', ''); });
      });
    });
    return chain;
  }

  function tick() {
    if (!on || busy) return;
    busy = true;
    call('/editor/pending?since=' + appliedRev + '&csince=' + lastCmd + '&dsince=' + lastDraft).then(function (j) {
      var next = j.draft && j.draft.seq > lastDraft ? saveDraft(j.draft).then(function () { lastDraft = j.draft.seq; }) : Promise.resolve();
      next = next.then(function () { return !j.none && j.rev > appliedRev ? apply(j) : null; });
      return next.then(function () { return runCommands(j.commands); }).then(function () { return push(false); });
    }).then(function () { return call('/editor/status'); }).then(function (s) {
      var before = status && status.clients;
      status = s;
      if (!s.running && on) { on = false; clearInterval(timer); U.toast('The web editor stopped'); }
      if (onStatus && (before !== s.clients || !s.running)) onStatus(s);
    }).catch(function (e) { Log.warn('webedit', 'Editor check failed: ' + e.message); })
      .then(function () { busy = false; });
  }

  function begin(s) {
    status = s; on = true; lastSig = '';
    lastDraft = Math.max(lastDraft, s.draftAck || 0);
    if (Epg.progress && Epg.progress.phase) sendProgress(Epg.progress, true);
    clearInterval(timer); timer = setInterval(tick, 2000);
    return loadDraftInfo().catch(function () {}).then(function () { return push(true); }).then(function () { return s; });
  }
  function start() {
    return call('/editor/start', { port: port(), password: password() }).then(function (s) {
      Log.info('webedit', 'Web editor on port ' + s.port + ' at ' + (s.ips || []).join(', '));
      // Saves from an earlier editor session are not ours to apply.
      appliedRev = Math.max(appliedRev, s.pendingRev || 0);
      return begin(s);
    });
  }
  // After a reload (restore restarts the page), carry on if the helper still runs the editor.
  function resume() {
    if (!base()) return;
    call('/editor/status').then(function (s) {
      if (!s.running) return;
      appliedRev = s.appliedRev || s.pendingRev || 0;
      return call('/editor/pending?since=0&csince=0').then(function (j) { (j.commands || []).forEach(function (c) { lastCmd = Math.max(lastCmd, c.id); }); }).then(function () {
        Log.info('webedit', 'Web editor still running on port ' + s.port + '; picked it back up');
        return begin(s);
      });
    }).catch(function () {});
  }
  function stop() {
    on = false; clearInterval(timer);
    return call('/editor/stop', {}).then(function (s) { status = s; Log.info('webedit', 'Web editor stopped'); return s; }, function () { status = null; });
  }
  function restart() { return on ? stop().then(start) : Promise.resolve(status); }
  function newPassword() { Store.settings.editorPass = generate(); Store.saveSettings(); return restart(); }

  /* The QR code and address for a phone or computer (first screen, setup from a computer, the set-up
     tour).  The code opens the editor already signed in, on page (Smart clean-up: 'tools'; empty for
     the start page, which on a fresh TV is the welcome page for adding a playlist or restoring). */
  function drawJoin(qr, txt, page, s, waiting, connected) {
    qr.innerHTML = ''; txt.innerHTML = '';
    var addrs = status && status.ips && status.ips.length ? status.ips.map(function (ip) { return 'http://' + ip + ':' + status.port; }) : [];
    if (!addrs.length) { txt.appendChild(U.el('div', 'msg err', 'No network address found.  Check that the TV is connected to your network.')); return; }
    try {
      var q = qrcode(0, 'M'); q.addData(addrs[0] + '/#k=' + password() + (page ? '/' + page : '')); q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 9, margin: 2, scalable: true });
    } catch (e) { Log.warn('webedit', 'QR code: ' + e.message); }
    txt.appendChild(U.el('div', 'remote-l', 'Address'));
    addrs.forEach(function (a) { txt.appendChild(U.el('div', 'remote-v', a.replace(/^http:\/\//, ''))); });
    txt.appendChild(U.el('div', 'remote-l', 'Password'));
    txt.appendChild(U.el('div', 'remote-v', password()));
    txt.appendChild(U.el('div', 'remote-s', s && s.clients ? connected : waiting));
  }

  /* "Edit on a phone or computer" from anywhere (side menu, hold OK on a group, a remote button):
     starts the editor if it is off and shows its QR code.  It keeps running after Done. */
  function showJoin(page, after, opts) {
    opts = opts || {};
    Parental.gate('settings', null, function () {
      var body = U.el('div', 'edit-join'), qr = U.el('div', 'join-qr'), txt = U.el('div', 'join-txt'), wasOn = on;
      body.appendChild(qr); body.appendChild(txt);
      txt.appendChild(U.el('div', 'remote-s', 'Starting the editor…'));
      var lead = U.el('p', 'edit-join-lead', opts.lead || 'Scan the code with your phone\'s camera, or open the address on a computer on the same network.  Rename, hide, sort and clean up with a real keyboard; changes show up here as you send them.');
      var wrap = U.el('div'); wrap.appendChild(lead); wrap.appendChild(body);
      function show(s) { if (!wrap.parentNode) return; drawJoin(qr, txt, page || '', s, 'Waiting for a phone or computer…', 'Connected.  The editor keeps running until you turn it off or close TiviBro.'); }
      // keepOn: the screen underneath needs the editor (the first screen's own QR code), so no Turn off.
      var btns = [{ label: 'Done' }];
      if (!opts.keepOn) btns.push({ label: 'Turn the editor off', action: function () { stop().then(function () { U.toast('Web editor is off'); if (after) after(); }); } });
      UI.panel(opts.title || 'Edit on a phone or computer', wrap, btns);
      var prev = onStatus;
      UI.onClose = function () { if (onStatus === show) onStatus = prev; if (after) after(); };
      onStatus = show;
      (on ? Promise.resolve(status) : start()).then(function (s) { show(s); if (!wasOn) Log.info('webedit', 'Started from the shortcut'); }, function (e) { txt.innerHTML = ''; txt.appendChild(U.el('div', 'msg err', e.message)); });
    });
  }

  var exports = {
    showJoin: showJoin,
    drawJoin: drawJoin,
    start: start, stop: stop, restart: restart, resume: resume, newPassword: newPassword, password: password, port: port, PORTS: PORTS,
    snap: function (name) { return snap('named', name); },
    get on() { return on; }, get status() { return status; },
    set onStatus(fn) { onStatus = fn; },
    addresses: function () { return status && status.ips && status.ips.length ? status.ips.map(function (ip) { return 'http://' + ip + ':' + status.port; }) : []; },
    _testEpgSource: function (a) { return RUN.testEpgSource(a); }   // test hook only
  };
  return exports;

})();

/* Backup and restore of everything TiviBro keeps: settings, every playlist (with its login),
   and each playlist's groups, favorites, hidden items, renames and guide assignments.
   Channel lists and the guide are not included; they reload from the provider. */
var Backup = (function () {
  'use strict';
  var KEEP_LOCAL = ['editorPass', 'editorPort', 'keyAliases', 'lastBackup'];   // belong to this TV, not the backup

  // Everything needed to rebuild this setup on a fresh TV: settings, every playlist with its login,
  // each playlist's edits, and each playlist's restore points.  The helper encrypts it before it
  // leaves the TV (service/editor.js), so logins never cross the network in the clear.
  function create() {
    var s = JSON.parse(JSON.stringify(Store.settings)), edits = {}, snaps = {};
    s.playlists.forEach(function (p) {
      if (p.id === Store.settings.active) edits[p.id] = JSON.parse(JSON.stringify(Store.edits));
      else { try { edits[p.id] = JSON.parse(localStorage.getItem('tivibro.edits.' + p.id) || 'null'); } catch (e) { edits[p.id] = null; } }
    });
    KEEP_LOCAL.forEach(function (k) { delete s[k]; });
    return Promise.all(s.playlists.map(function (p) {
      return Store.idbGet('snaps:' + p.id).then(function (l) { if (Array.isArray(l) && l.length) snaps[p.id] = l; }, function () {});
    })).then(function () {
      return { app: 'TiviBro', kind: 'backup', format: 2, version: TIVIBRO_VERSION, created: new Date().toISOString(), settings: s, edits: edits, snaps: snaps };
    });
  }
  function check(b) {
    if (!b || b.app !== 'TiviBro' || b.kind !== 'backup') throw new Error('This is not a TiviBro backup file.');
    if (!b.settings || !Array.isArray(b.settings.playlists)) throw new Error('The backup has no playlists.');
    return b;
  }
  function restore(b) {
    check(b);
    Store.freeze();
    var cur = Store.settings, next = JSON.parse(JSON.stringify(b.settings));
    KEEP_LOCAL.forEach(function (k) { if (cur[k] != null) next[k] = cur[k]; });
    if (!next.playlists.some(function (p) { return p.id === next.active; })) next.active = next.playlists[0] ? next.playlists[0].id : '';
    // Old edits for playlists that are not in the backup are left alone; the backup's replace the rest.
    Object.keys(b.edits || {}).forEach(function (id) { if (b.edits[id]) localStorage.setItem('tivibro.edits.' + id, JSON.stringify(b.edits[id])); });
    localStorage.setItem('tivibro.settings', JSON.stringify(next));
    Log.info('backup', 'Restored a backup from ' + b.created + ' with ' + next.playlists.length + ' playlist(s)');
    var snaps = b.snaps || {};
    return Promise.all(Object.keys(snaps).map(function (id) { return Array.isArray(snaps[id]) ? Store.idbSet('snaps:' + id, snaps[id]).catch(function () {}) : null; }))
      .then(function () { return { playlists: next.playlists.length }; });
  }
  return { create: create, restore: restore, check: check };
})();
