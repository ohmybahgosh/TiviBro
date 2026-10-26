/* Edit on a computer.
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
  var on = false, timer = 0, appliedRev = 0, lastCmd = 0, lastSig = '', status = null, busy = false, onStatus = null;
  var FIELDS = ['hiddenGroups', 'hiddenChannels', 'renames', 'groupRenames', 'custom', 'groupOrder', 'epgMap', 'groupAdd', 'groupRemove', 'groupSort'];
  var SORTS = ['provider', 'az', 'za', 'number', 'custom'];
  var SNAP_AUTO = 15, SNAP_NAMED = 30;
  var PORTS = [8787, 8080, 8000, 9090];

  function base() { return Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function call(path, body) {
    if (!base()) return Promise.reject(new Error('The network helper is not running, so the editor cannot start.  See Settings, Diagnostics.'));
    return fetch(base() + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
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
    FIELDS.forEach(function (f) { out[f] = e[f] || (f === 'custom' || f === 'groupOrder' ? [] : {}); });
    return out;
  }
  function sig() { try { return JSON.stringify(editsOf()) + JSON.stringify(Store.playlist.names || null) + JSON.stringify(playlists()) + (Library.data ? Library.data.channels.length : 0) + ':' + (Epg.status && Epg.status.at); } catch (e) { return String(Date.now()); } }

  // Playlists as the browser sees them: no username, password or full addresses.
  function playlists() {
    var s = Store.settings;
    return s.playlists.map(function (p) {
      return { id: p.id, name: p.name || (p.type === 'm3u' ? 'M3U playlist' : 'Xtream'), type: p.type, host: host(p.type === 'm3u' ? p.m3u : p.server),
        active: p.id === s.active, ua: p.ua || '', plRefresh: p.plRefresh, epgRefresh: p.epgRefresh, providerEpg: p.providerEpg,
        epgSources: (p.epgSources || []).map(function (x) { return { host: host(x.url), offset: x.offset || 0 }; }) };
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
      guide: { channels: gc.slice(0, 30000).map(function (x) { return [x[0], x[1]]; }), mode: p.providerEpg, sources: (p.epgSources || []).length, xml: !!Epg.xml, loading: !!Epg.loading, status: Epg.status ? { at: Epg.status.at } : null, nameMatch: !!p.nameMatch },
      gz: typeof DecompressionStream !== 'undefined',
      edits: editsOf(),
      names: p.names || null,
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
      appliedRev = j.rev;
      Log.info('webedit', 'Applied changes from the web editor (save ' + j.rev + ')');
      U.toast('Changes from the computer applied');
      return push(true);
    });
  }

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
    addPlaylist: function (a) {
      var xc = a.type !== 'm3u';
      var p = { id: '', name: clean(a.name), type: xc ? 'xtream' : 'm3u', server: clean(a.server), user: clean(a.user), pass: clean(a.pass), m3u: clean(a.m3u) };
      if (xc && !(p.server && p.user && p.pass) && !Source.credsFromLink(p.server)) throw new Error('Enter the server, username and password.');
      if (!xc && !p.m3u) throw new Error('Enter the playlist address.');
      if (!p.name) p.name = xc ? (p.user || 'Xtream') : 'M3U playlist';
      if (clean(a.epg)) p.epgSources = [{ url: clean(a.epg), offset: 0 }];
      p.id = 'p' + Date.now().toString(36);
      return loadAndSave(p).then(function (data) {
        if (!a.use && Store.settings.playlists.length === 1) a.use = true;   // first playlist on a fresh TV
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
    testEpgSource: function (a) {
      var url = clean(a.url);
      if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http:// or https:// address.');
      var t0 = Date.now();
      return fetch(Net.wrap(url), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('The server answered ' + r.status + '.  Check the address.');
        var size = +r.headers.get('content-length') || 0, gz = /\.gz($|\?)/.test(url);
        if (gz && typeof DecompressionStream === 'undefined') { try { r.body.cancel(); } catch (e) {} return { msg: 'Reachable, but this TV cannot unzip .gz guides.  Use the plain .xml address if there is one.', data: { ok: true, size: size, gz: true, noGz: true } }; }
        var body = gz ? r.body.pipeThrough(new DecompressionStream('gzip')) : r.body, rd = body.getReader(), dec = new TextDecoder(), txt = '';
        function step() {
          return rd.read().then(function (x) {
            if (!x.done) txt += dec.decode(x.value, { stream: true });
            if (x.done || txt.length > 400000) { try { rd.cancel(); } catch (e) {} return; }
            return step();
          });
        }
        return step().then(function () {
          if (!/<tv[\s>]/.test(txt) && !/<channel\b/.test(txt)) throw new Error('That address does not return an XMLTV guide.');
          var ch = (txt.match(/<channel\b/g) || []).length, ms = Date.now() - t0;
          return { msg: 'Works.  ' + (size ? (size / 1048576).toFixed(1) + ' MB' + (gz ? ' zipped' : '') + ', ' : '') + 'answered in ' + (ms / 1000).toFixed(1) + ' s.', data: { ok: true, size: size, gz: gz, channelsSeen: ch } };
        });
      });
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
    backup: function () { return Backup.create().then(function (b) { return { msg: 'Backup ready', data: b }; }); },
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
        var fn = RUN[c.type];
        return Promise.resolve().then(function () { if (!fn) throw new Error('Unknown action ' + c.type); return fn(c.args || {}); })
          .then(function (r) { return call('/editor/result', { id: c.id, ok: true, msg: r && r.msg, data: r && r.data }); },
            function (e) { Log.warn('webedit', '"' + c.type + '" failed: ' + (e && e.message)); return call('/editor/result', { id: c.id, ok: false, msg: (e && e.message) || 'failed' }); })
          .then(function () { lastSig = ''; });
      });
    });
    return chain;
  }

  function tick() {
    if (!on || busy) return;
    busy = true;
    call('/editor/pending?since=' + appliedRev + '&csince=' + lastCmd).then(function (j) {
      var next = !j.none && j.rev > appliedRev ? apply(j) : Promise.resolve();
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
    if (Epg.progress && Epg.progress.phase) sendProgress(Epg.progress, true);
    clearInterval(timer); timer = setInterval(tick, 2000);
    return push(true).then(function () { return s; });
  }
  function start() {
    return call('/editor/start', { port: port(), password: password() }).then(function (s) {
      Log.info('webedit', 'Web editor on port ' + s.port + ' at ' + (s.ips || []).join(', '));
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

  return {
    start: start, stop: stop, restart: restart, resume: resume, newPassword: newPassword, password: password, port: port, PORTS: PORTS,
    get on() { return on; }, get status() { return status; },
    set onStatus(fn) { onStatus = fn; },
    addresses: function () { return status && status.ips && status.ips.length ? status.ips.map(function (ip) { return 'http://' + ip + ':' + status.port; }) : []; }
  };
})();

/* Backup and restore of everything TiviBro keeps: settings, every playlist (with its login),
   and each playlist's groups, favorites, hidden items, renames and guide assignments.
   Channel lists and the guide are not included; they reload from the provider. */
var Backup = (function () {
  'use strict';
  var KEEP_LOCAL = ['editorPass', 'editorPort', 'keyAliases'];   // belong to this TV, not the backup

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
