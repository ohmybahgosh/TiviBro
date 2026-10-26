/* The channel library: provider data plus the user's edits.
   Provider data is never mutated; hiding, renaming and custom groups are overlays
   stored by stable key, so a playlist refresh keeps every edit. */
var Library = (function () {
  'use strict';

  var data = { groups: [], channels: [] };
  var byKey = new Map();
  var groupCache = new Map();     // groupId -> channel array (built on demand)
  var groupNames = {};
  var ALL = 'all', RECENT = 'recent', FAV = 'c_fav';

  function E() { return Store.edits; }
  function S() { return Store.settings; }

  function set(d) {
    data = d;
    byKey = new Map();
    groupNames = {};
    for (var i = 0; i < d.channels.length; i++) {
      var c = d.channels[i];
      if (!c.num) c.num = i + 1;
      byKey.set(c.k, c);
    }
    d.groups.forEach(function (g) { groupNames[g.id] = g.name; });
    trackNewGroups(d.groups);
    Names.invalidate();
    dirty();
  }
  // Groups the provider adds later can arrive hidden (Settings > Groups > Newly added groups),
  // so a tidy "hide all, show a few" setup stays tidy after refreshes.
  function trackNewGroups(groups) {
    try {
      var e = E(), ids = groups.map(function (g) { return g.id; });
      if (e.knownGroups && e.knownGroups.length && S().newGroups === 'hide') {
        var added = ids.filter(function (id) { return e.knownGroups.indexOf(id) < 0; });
        added.forEach(function (id) { e.hiddenGroups[id] = 1; });
        if (added.length) Log.info('library', added.length + ' new group(s) from the provider were hidden (setting: hide newly added groups)');
      }
      e.knownGroups = ids;
      Store.saveEdits();
    } catch (err) { Log.warn('library', 'Could not track new groups: ' + err.message); }
  }
  function dirty() { groupCache.clear(); }

  function name(c) { return (c && (E().renames[c.k] || Names.clean(c.n))) || ''; }
  function isCustom(gid) { return gid && gid.indexOf('c_') === 0; }
  function custom(gid) { return E().custom.filter(function (g) { return g.id === gid; })[0]; }
  function cleanGroup(n) { return Names.groupsOn() ? Names.clean(n) : n; }
  function groupName(gid) {
    if (gid === ALL) return 'All channels';
    if (gid === RECENT) return 'Recent';
    var c = custom(gid);
    return c ? c.name : (E().groupRenames && E().groupRenames[gid]) || cleanGroup(groupNames[gid] || '');
  }

  // Groups in display order: custom groups, All channels, then provider groups.
  function groups() {
    var e = E(), s = S(), showHidden = s.showHidden, out = [];
    var customs = [];
    e.custom.forEach(function (g) {
      if (showHidden || !e.hiddenGroups[g.id]) customs.push({ id: g.id, name: g.name, custom: true, hidden: !!e.hiddenGroups[g.id], count: g.items.length, blocked: !!e.blockedGroups[g.id] });
    });
    if (s.showFav === false) customs = customs.filter(function (g) { return g.id !== FAV; });
    if (s.favFirst) out = out.concat(customs);
    if (s.showRecent && e.recent.length) out.push({ id: RECENT, name: 'Recent', count: e.recent.length });
    if (!s.favFirst) out = out.concat(customs);
    if (s.showAll) out.push({ id: ALL, name: 'All channels', count: data.channels.length });
    var prov = data.groups.slice();
    if (s.sortGroups === 'name') prov.sort(function (a, b) { return cleanGroup(a.name).localeCompare(cleanGroup(b.name)); });
    if (e.groupOrder && e.groupOrder.length) {
      var pos = {};
      e.groupOrder.forEach(function (id, i) { pos[id] = i; });
      prov.sort(function (a, b) { return (pos[a.id] != null ? pos[a.id] : 1e6) - (pos[b.id] != null ? pos[b.id] : 1e6); });
    }
    prov.forEach(function (g) {
      var hid = !!e.hiddenGroups[g.id];
      if (showHidden || !hid) out.push({ id: g.id, name: (e.groupRenames && e.groupRenames[g.id]) || cleanGroup(g.name), hidden: hid, blocked: !!e.blockedGroups[g.id] });
    });
    return out;
  }

  // Every real group (yours, then the provider's in display order), hidden or not, for Manage groups.
  function allGroups() {
    var e = E(), keep = S().showHidden;
    S().showHidden = true;
    try { return groups().filter(function (g) { return g.id !== ALL && g.id !== RECENT; }); }
    finally { S().showHidden = keep; }
  }

  function channels(gid) {
    var hit = groupCache.get(gid);
    if (hit) return hit;
    var e = E(), showHidden = S().showHidden, list;
    var sortable = false;
    if (gid === RECENT) {
      list = e.recent.map(function (k) { return byKey.get(k); }).filter(Boolean);
    } else if (isCustom(gid)) {
      var g = custom(gid);
      list = g ? g.items.map(function (k) { return byKey.get(k); }).filter(Boolean) : [];
    } else if (gid === ALL) {
      sortable = true;
      list = data.channels;
      // "All" also skips channels whose whole group is hidden.
      if (!showHidden && !S().allHidden) list = list.filter(function (c) { return !e.hiddenGroups[c.g]; });
    } else {
      sortable = true;
      // Provider group, minus channels taken out of it, plus channels copied or moved into it.
      var out = (e.groupRemove && e.groupRemove[gid]) || {}, add = (e.groupAdd && e.groupAdd[gid]) || [];
      list = data.channels.filter(function (c) { return c.g === gid && !out[c.k]; });
      if (add.length) {
        var seen = {}; list.forEach(function (c) { seen[c.k] = 1; });
        add.forEach(function (k) { var c = byKey.get(k); if (c && !seen[k] && !out[k]) { list.push(c); seen[k] = 1; } });
      }
    }
    if (!showHidden) list = list.filter(function (c) { return !e.hiddenChannels[c.k]; });
    // A sort picked for this one group (web editor) wins over the global channel order.
    var own = e.groupSort && e.groupSort[gid];
    var mode = own ? { az: 'name', za: 'za', number: 'number', provider: 'playlist', custom: 'playlist' }[own] || 'playlist' : S().sortChannels;
    if ((sortable || own) && mode !== 'playlist') {
      list = list.slice();
      if (mode === 'number') list.sort(function (a, b) { return a.num - b.num; });
      else if (mode === 'name') list.sort(function (a, b) { return name(a).localeCompare(name(b), undefined, { numeric: true }); });
      else if (mode === 'za') list.sort(function (a, b) { return name(b).localeCompare(name(a), undefined, { numeric: true }); });
      else if (mode === 'watch') list.sort(function (a, b) { return (e.watch[b.k] || 0) - (e.watch[a.k] || 0); });
    }
    groupCache.set(gid, list);
    return list;
  }

  /* ---------- edits ---------- */
  function commit() { dirty(); Store.saveEdits(); }

  function hideChannel(k, on) { if (on) E().hiddenChannels[k] = 1; else delete E().hiddenChannels[k]; commit(); }
  function hideGroup(id, on) { if (on) E().hiddenGroups[id] = 1; else delete E().hiddenGroups[id]; commit(); }
  // Bulk version: one save for any number of groups.
  function hideGroups(ids, on) { var h = E().hiddenGroups; ids.forEach(function (id) { if (on) h[id] = 1; else delete h[id]; }); commit(); }
  function renameChannel(k, n) { if (n && n.trim()) E().renames[k] = n.trim(); else delete E().renames[k]; commit(); }

  function createGroup(n) {
    var g = { id: 'c_' + Date.now().toString(36), name: (n || 'New group').trim(), items: [] };
    E().custom.push(g);
    commit();
    return g;
  }
  function renameGroup(id, n) { var g = custom(id); if (g && n && n.trim()) { g.name = n.trim(); commit(); } }
  function deleteGroup(id) {
    E().custom = E().custom.filter(function (g) { return g.id !== id; });
    delete E().hiddenGroups[id];
    commit();
  }
  // Copy, never move: the channel stays in its provider group too.
  function copyTo(gid, keys) {
    var g = custom(gid); if (!g) return 0;
    var have = {}, added = 0;
    g.items.forEach(function (k) { have[k] = 1; });
    keys.forEach(function (k) { if (!have[k]) { g.items.push(k); have[k] = 1; added++; } });
    commit();
    return added;
  }
  function removeFrom(gid, k) { var g = custom(gid); if (g) { g.items = g.items.filter(function (x) { return x !== k; }); commit(); } }
  function moveInGroup(gid, k, dir) {
    var g = custom(gid); if (!g) return;
    var i = g.items.indexOf(k), j = i + dir;
    if (i < 0 || j < 0 || j >= g.items.length) return;
    g.items[i] = g.items[j]; g.items[j] = k; commit();
  }
  function moveGroup(id, dir) {
    var e = E();
    if (isCustom(id)) {
      var i = e.custom.findIndex(function (g) { return g.id === id; }), j = i + dir;
      if (i < 0 || j < 0 || j >= e.custom.length) return;
      var t = e.custom[i]; e.custom[i] = e.custom[j]; e.custom[j] = t;
    } else {
      var order = (e.groupOrder && e.groupOrder.length) ? e.groupOrder.slice() : data.groups.map(function (g) { return g.id; });
      data.groups.forEach(function (g) { if (order.indexOf(g.id) < 0) order.push(g.id); });
      var a = order.indexOf(id), b = a + dir;
      if (a < 0 || b < 0 || b >= order.length) return;
      order[a] = order[b]; order[b] = id;
      e.groupOrder = order;
    }
    commit();
  }

  function isFav(k) { var g = custom(FAV); return !!(g && g.items.indexOf(k) >= 0); }
  function toggleFav(k) {
    var g = custom(FAV);
    if (!g) { g = { id: FAV, name: 'Favorites', items: [] }; E().custom.unshift(g); }
    var on = g.items.indexOf(k) < 0;
    if (on) g.items.push(k); else g.items = g.items.filter(function (x) { return x !== k; });
    commit();
    return on;
  }
  function touchRecent(k) {
    var r = E().recent.filter(function (x) { return x !== k; });
    r.unshift(k);
    E().recent = r.slice(0, S().recentCount || 20);
    groupCache.delete(RECENT);
    Store.saveEdits();
  }
  // Watch time is counted every few seconds but written at most once a minute.
  var watchSaved = 0;
  function addWatch(k, sec) {
    E().watch[k] = (E().watch[k] || 0) + sec;
    if (Date.now() - watchSaved > 60000) { watchSaved = Date.now(); Store.saveEdits(); }
  }
  function isBlocked(c) { var e = E(); return !!(c && (e.blockedChannels[c.k] || e.blockedGroups[c.g])); }
  function block(kind, id, on) { var m = kind === 'group' ? E().blockedGroups : E().blockedChannels; if (on) m[id] = 1; else delete m[id]; commit(); }

  function hiddenItems() {
    var e = E(), gs = [], cs = [];
    Object.keys(e.hiddenGroups).forEach(function (id) { var n = groupName(id); if (n) gs.push({ id: id, name: n }); });
    Object.keys(e.hiddenChannels).forEach(function (k) { var c = byKey.get(k); if (c) cs.push(c); });
    return { groups: gs, channels: cs };
  }

  function find(k) { return byKey.get(k); }
  function count() { return data.channels.length; }
  function sample(n) {
    // A spread of real names for the cleanup preview.
    var out = [], ch = data.channels, step = Math.max(1, Math.floor(ch.length / n));
    for (var i = 0; i < ch.length && out.length < n; i += step) out.push(ch[i]);
    return out;
  }

  return {
    ALL: ALL, RECENT: RECENT, FAV: FAV, set: set, isFav: isFav, toggleFav: toggleFav, touchRecent: touchRecent, addWatch: addWatch,
    isBlocked: isBlocked, block: block, get data() { return data; }, dirty: dirty, name: name, groups: groups, channels: channels, groupName: groupName,
    isCustom: isCustom, customGroups: function () { return E().custom; }, find: find, count: count, sample: sample,
    hideChannel: hideChannel, hideGroup: hideGroup, renameChannel: renameChannel,
    createGroup: createGroup, renameGroup: renameGroup, deleteGroup: deleteGroup,
    copyTo: copyTo, removeFrom: removeFrom, moveInGroup: moveInGroup, moveGroup: moveGroup,
    hiddenItems: hiddenItems, allGroups: allGroups, hideGroups: hideGroups, get epgUrl() { return data.epgUrl; }, get type() { return Store.playlist.type; }
  };
})();
