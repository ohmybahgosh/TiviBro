/* The channel library: provider data plus the user's edits.
   Provider data is never mutated; hiding, renaming and custom groups are overlays
   stored by stable key, so a playlist refresh keeps every edit. */
var Library = (function () {
  'use strict';

  var data = { groups: [], channels: [] };
  var byKey = new Map();
  var groupCache = new Map();     // groupId -> channel array (built on demand)
  var groupNames = {};
  var ALL = 'all', RECENT = 'recent', FAV = 'c_fav', EVENTS = 'events';

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
    versionIndex = null;
    growable = null;
    dirty();
  }
  // Number keys: can more digits still lead to a channel?  "12" can't when there is no 120-129 or
  // longer number starting 12, so the remote can switch at once instead of waiting for a digit.
  var growable = null;
  function numberCanGrow(prefix) {
    if (!growable) {
      growable = {};
      for (var i = 0; i < data.channels.length; i++) {
        var s = String(data.channels[i].num || '');
        for (var j = 1; j < s.length; j++) growable[s.slice(0, j)] = 1;
      }
    }
    return !!growable[String(prefix)];
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
  function dirty() { groupCache.clear(); evCache = null; }

  /* ---------- other versions of a channel ----------
     The same channel in another quality, group or copy ("ESPN FHD", "ESPN HD", "US| ESPN (Backup)"),
     used when one stops working.  Matched on the provider's name with quality and format tags
     removed, keeping the country and East/West feed apart, so "UK: Sky News" never stands in for a
     US channel.  Hidden copies count: they are often exactly the spares people hid. */
  var versionIndex = null;
  var V_TAGS = /\b(8k|4k|uhd|fhd|qhd|full ?hd|hd|sd|hq|lq|hevc|h\.?26[45]|hdr(10)?\+?|dolby ?vision|dv|raw|backup|alt|alternative|bk|vip|2160p?|1080[pi]?|720p?|576[pi]?|480p?|50 ?fps|60 ?fps)\b/g;
  var V_FEED = /\b(east|west|pacific|mountain|central)\b|\((e|w)\)/i;
  var V_COUNTRY = /^\s*[\[(]\s*([a-z]{2,3})\s*[\])]\s*|^\s*([a-z]{2,3})\s*[:|]\s*/i;
  var V_QUAL = [[/\b(8k|4k|uhd|2160p?)\b/i, 4], [/\b(fhd|1080[pi]?|full ?hd)\b/i, 3], [/\b(hd|720p?)\b/i, 2], [/\b(sd|480p?|576[pi]?|lq)\b/i, 1]];
  function versionKey(c) {
    if (c._vk != null) return c._vk;
    return (c._vk = makeVersionKey(c));
  }
  function makeVersionKey(c) {
    var n = String(c.n || ''), m = V_COUNTRY.exec(n), country = '';
    if (m) { country = (m[1] || m[2]).toUpperCase(); n = n.slice(m[0].length); }
    else { var gm = V_COUNTRY.exec(groupNames[c.g] || ''); if (gm) country = (gm[1] || gm[2]).toUpperCase(); }
    var f = V_FEED.exec(n), feed = f ? (f[1] || f[2]).charAt(0).toLowerCase() : '';
    var base = n.toLowerCase().replace(V_FEED, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(V_TAGS, ' ').replace(/[^a-z0-9\u00c0-\uffff]+/g, '');
    return base.length < 2 ? '' : country + '|' + base + '|' + feed;
  }
  function quality(n) { for (var i = 0; i < V_QUAL.length; i++) if (V_QUAL[i][0].test(n)) return V_QUAL[i][1]; return 2.5; }
  // Steadiest first: Full HD, HD, unmarked, then 4K (the most bandwidth), then SD.
  var Q_ORDER = { 3: 5, 2: 4, 2.5: 3, 4: 2, 1: 1 };
  function versions(c) {
    if (!c) return [];
    if (!versionIndex) {
      versionIndex = new Map();
      for (var i = 0; i < data.channels.length; i++) {
        var x = data.channels[i], k = versionKey(x); if (!k) continue;
        var a = versionIndex.get(k); if (a) a.push(x); else versionIndex.set(k, [x]);
      }
    }
    var list = versionIndex.get(versionKey(c)) || [], e = E();
    return list.filter(function (x) { return x.k !== c.k && !e.blockedChannels[x.k] && !e.blockedGroups[x.g]; })
      .sort(function (a, b) {
        return (Q_ORDER[quality(b.n)] - Q_ORDER[quality(a.n)]) || ((a.g === c.g ? 0 : 1) - (b.g === c.g ? 0 : 1)) ||
          ((e.hiddenChannels[a.k] ? 1 : 0) - (e.hiddenChannels[b.k] ? 1 : 0)) || ((+a.num || 0) - (+b.num || 0));
      });
  }
  function qualityLabel(c) { return { 4: '4K', 3: 'FHD', 2: 'HD', 1: 'SD' }[quality(c.n)] || ''; }
  // The quality tag lists show next to a name, only where the same channel is there more than once.
  function versionTag(c) { return versions(c).length ? qualityLabel(c) : ''; }

  function name(c) {
    if (!c) return '';
    if (E().renames[c.k]) return E().renames[c.k];
    // Event channels: the short tag ("PPV 03", "NCAAB 001"); the event itself is in the guide.
    var ev = Events.shortNames() ? Events.of(c) : null;
    if (ev) return ev.short || ev.title;
    return Names.clean(c.n) || '';
  }
  /* Events by time: every shown event channel whose event is on now or in the next two weeks, soonest first.
     Kept for a few minutes, since it reads every channel name. */
  var evCache = null;
  function eventList() {
    var now = Date.now();
    if (evCache && now - evCache.at < 300000) return evCache.list;
    var e = E(), showHidden = S().showHidden, idle = Names.hideIdle(), out = [];
    if (Events.groupOn()) data.channels.forEach(function (c) {
      if (!showHidden && (e.hiddenChannels[c.k] || e.hiddenGroups[c.g])) return;
      if (idle && Names.idle(c.n)) return;
      var ev = Events.of(c);
      if (ev && ev.end > now && ev.start < now + 14 * 86400e3) out.push({ c: c, s: ev.start });
    });
    out.sort(function (a, b) { return a.s - b.s || a.c.num - b.c.num; });
    evCache = { at: now, list: out.map(function (x) { return x.c; }) };
    return evCache.list;
  }
  function isCustom(gid) { return gid && gid.indexOf('c_') === 0; }
  function custom(gid) { return E().custom.filter(function (g) { return g.id === gid; })[0]; }
  function cleanGroup(n) { return Names.groupsOn() ? Names.clean(n) : n; }
  function groupName(gid) {
    if (gid === ALL) return 'All channels';
    if (gid === RECENT) return 'Recent';
    if (gid === EVENTS) return 'Events by time';
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
    var evs = Events.groupOn() ? eventList().length : 0;
    if (evs) out.push({ id: EVENTS, name: 'Events by time', count: evs });
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
    try { return groups().filter(function (g) { return g.id !== ALL && g.id !== RECENT && g.id !== EVENTS; }); }
    finally { S().showHidden = keep; }
  }

  function channels(gid) {
    if (gid === EVENTS) return eventList();
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
    // Hide channels with nothing on (Settings > Channel names): judged on the name the provider sends
    // now, so a channel comes back by itself once an event is named on it.  Favorites keep theirs.
    if (!showHidden && gid !== FAV && Names.hideIdle()) list = list.filter(function (c) { return !Names.idle(c.n); });
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
    ALL: ALL, RECENT: RECENT, FAV: FAV, EVENTS: EVENTS, set: set, isFav: isFav, toggleFav: toggleFav, touchRecent: touchRecent, addWatch: addWatch,
    isBlocked: isBlocked, block: block, get data() { return data; }, dirty: dirty, name: name, groups: groups, channels: channels, groupName: groupName,
    isCustom: isCustom, customGroups: function () { return E().custom; }, find: find, count: count, sample: sample,
    hideChannel: hideChannel, hideGroup: hideGroup, renameChannel: renameChannel,
    createGroup: createGroup, renameGroup: renameGroup, deleteGroup: deleteGroup,
    copyTo: copyTo, removeFrom: removeFrom, moveInGroup: moveInGroup, moveGroup: moveGroup,
    hiddenItems: hiddenItems, allGroups: allGroups, versions: versions, versionKey: versionKey, numberCanGrow: numberCanGrow, qualityLabel: qualityLabel, versionTag: versionTag, hideGroups: hideGroups, get epgUrl() { return data.epgUrl; }, get type() { return Store.playlist.type; }
  };
})();
