/* The channel library: provider data plus the user's edits.
   Provider data is never mutated; hiding, renaming and custom groups are overlays
   stored by stable key, so a playlist refresh keeps every edit. */
var Library = (function () {
  'use strict';

  var data = { groups: [], channels: [] };
  var byKey = new Map();
  var groupCache = new Map();     // groupId -> channel array (built on demand)
  var groupNames = {};
  var ALL = 'all', RECENT = 'recent', FAV = 'c_fav', EVENTS = 'events', NEW = 'new', TEAMS = 'teams';

  function E() { return Store.edits; }
  function S() { return Store.settings; }

  /* Guide ids that point nowhere useful (issue: a provider's passes all say "0", one sports id given to 24
     different channels).  A placeholder id is dropped; an id shared by many channels with different names
     is kept only by the channel it names ("AandENetwork.us" stays on A&E, not on Cheddar News).  Those
     channels then get their guide by name, or the public guide. */
  var FAKE_ID = /^\s*(?:0+|-+|n\/?a|none|null|undefined|nil|false|no ?epg|epg)\s*$/i;
  function core(n) {
    var s = String(n || '').toLowerCase();
    for (var i = 0; i < 3; i++) s = s.replace(/^[^|]{1,12}\|\s*/, '');
    return s.replace(/&/g, 'and').replace(/\+/g, 'plus').replace(/\b(east|west|hd|fhd|uhd|4k|sd|us|usa|tv)\b/g, '').replace(/[^a-z]+/g, '');
  }
  function fixIds(chans) {
    var by = {}, fixed = 0, i, c;
    for (i = 0; i < chans.length; i++) {
      c = chans[i];
      if (!c.epg) continue;
      if (FAKE_ID.test(c.epg)) { c.epg = ''; fixed++; continue; }
      (by[c.epg] || (by[c.epg] = [])).push(c);
    }
    Object.keys(by).forEach(function (id) {
      var l = by[id];
      if (l.length < 4) return;
      var cores = {}; l.forEach(function (x) { cores[core(x.n)] = 1; });
      if (Object.keys(cores).length < 3) return;                 // "ESPN+ 01" to "ESPN+ 20": one channel family, one guide
      var ic = id.split('.')[0].toLowerCase().replace(/[^a-z]+/g, '');
      l.forEach(function (x) {
        var cc = core(x.n);
        if (cc.length >= 3 && ic.length >= 3 && (ic.indexOf(cc) >= 0 || cc.indexOf(ic) >= 0)) return;
        x.epg = ''; fixed++;
      });
    });
    if (fixed && typeof Log !== 'undefined') Log.info('library', 'Ignored ' + fixed + ' guide ids that were placeholders or shared by unrelated channels');
  }

  function set(d) {
    data = d;
    fixIds(d.channels);
    byKey = new Map();
    groupNames = {};
    for (var i = 0; i < d.channels.length; i++) {
      var c = d.channels[i];
      if (!c.num) c.num = i + 1;
      byKey.set(c.k, c);
    }
    d.groups.forEach(function (g) { groupNames[g.id] = g.name; });
    // Remember when the subscription ends with the playlist, so every playlist can show it (issue #13).
    var pl = typeof Store !== 'undefined' && Store.playlist;
    if (pl && pl.id && d.exp && pl.exp !== d.exp) { pl.exp = d.exp; Store.saveSettings(); }
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
  function dirty() { groupCache.clear(); evCache = null; newCache = null; inShown = null; if (typeof Teams !== 'undefined') Teams.dirty(); }

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

  // Nothing on: the name says so (Off Air, an empty slot) or names an event that is long over.
  function idle(c) { return Names.idle(c.n) || (typeof Events !== 'undefined' && Events.ended(c)); }
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
  /* Recently added: channels that were not in the playlist the last time it loaded (app.js keeps
     data.added = { key: first seen } across reloads).  Newest first, for Settings > Groups days. */
  function newDays() { var d = S().newDays; return d == null ? 7 : +d || 0; }
  function isNew(c) { var a = data.added, d = newDays(); return !!(d && a && c && a[c.k] && Date.now() - a[c.k] < d * 86400e3); }
  var newCache = null;
  function newList() {
    var a = data.added, d = newDays();
    if (!a || !d) return [];
    if (newCache) return newCache;
    var e = E(), showHidden = S().showHidden, since = Date.now() - d * 86400e3, out = [];
    Object.keys(a).forEach(function (k) {
      if (a[k] < since) return;
      var c = byKey.get(k);
      if (!c || (!showHidden && (e.hiddenChannels[k] || e.hiddenGroups[c.g]))) return;
      out.push(c);
    });
    out.sort(function (x, y) { return a[y.k] - a[x.k] || x.num - y.num; });
    return (newCache = out);
  }
  /* Is a channel anywhere in the lists?  Not hidden itself, and its provider group shown, or it is in one
     of your groups (or copied into a provider group) that is shown: the local station you put in "Local
     channels" while its provider group is hidden.  For Search and My teams. */
  var inShown = null;
  function shownAnywhere(c) {
    var e = E();
    if (!c || (!S().showHidden && e.hiddenChannels[c.k])) return false;
    if (S().showHidden || !e.hiddenGroups[c.g]) return true;
    if (!inShown) {
      inShown = {};
      e.custom.forEach(function (g) { if (!e.hiddenGroups[g.id]) g.items.forEach(function (k) { inShown[k] = 1; }); });
      if (e.groupAdd) Object.keys(e.groupAdd).forEach(function (g) { if (!e.hiddenGroups[g]) e.groupAdd[g].forEach(function (k) { inShown[k] = 1; }); });
    }
    return !!inShown[c.k];
  }
  function isVirtual(gid) { return gid === ALL || gid === RECENT || gid === EVENTS || gid === NEW || gid === TEAMS; }
  function isCustom(gid) { return gid && gid.indexOf('c_') === 0; }
  function custom(gid) { return E().custom.filter(function (g) { return g.id === gid; })[0]; }
  function cleanGroup(n) { return Names.groupsOn() ? Names.clean(n) : n; }
  function groupName(gid) {
    if (gid === ALL) return 'All channels';
    if (gid === RECENT) return 'Recent';
    if (gid === NEW) return 'Recently added';
    if (gid === EVENTS) return 'Events by time';
    if (gid === TEAMS) return 'My teams';
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
    // My teams (app/js/teams.js): near the top while it's on, empty between games (it says when the next one is).
    if (typeof Teams !== 'undefined' && Teams.groupOn()) out.push({ id: TEAMS, name: 'My teams', count: Teams.list().length });
    if (s.showRecent && e.recent.length) out.push({ id: RECENT, name: 'Recent', count: e.recent.length });
    var fresh = newList().length;
    if (fresh) out.push({ id: NEW, name: 'Recently added', count: fresh });
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
    try { return groups().filter(function (g) { return !isVirtual(g.id); }); }
    finally { S().showHidden = keep; }
  }

  // withHidden: every channel of the group, hidden ones too (Show or hide channels…).
  function channels(gid, withHidden) {
    if (gid === EVENTS) return eventList();
    if (gid === NEW) return newList();
    if (gid === TEAMS) return typeof Teams !== 'undefined' ? Teams.list() : [];
    var hit = !withHidden && groupCache.get(gid);
    if (hit) return hit;
    var e = E(), showHidden = withHidden || S().showHidden, list;
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
    if (!showHidden && gid !== FAV && Names.hideIdle()) list = list.filter(function (c) { return !idle(c); });
    // Your own order for a provider group (moved on the TV or dragged in the web editor): the
    // channels you placed first, in your order, then any the provider added since, in its order.
    var own = e.groupSort && e.groupSort[gid];
    if (own === 'custom' && !isCustom(gid) && gid !== ALL && e.chanOrder && e.chanOrder[gid]) {
      var pos = {}; e.chanOrder[gid].forEach(function (k, i) { pos[k] = i; });
      list = list.map(function (c, i) { return { c: c, i: i }; })
        .sort(function (x, y) { var a = pos[x.c.k], b = pos[y.c.k]; return (a != null ? a : 1e9 + x.i) - (b != null ? b : 1e9 + y.i); })
        .map(function (x) { return x.c; });
    }
    var mode = own ? { az: 'name', za: 'za', number: 'number', provider: 'playlist', custom: 'playlist' }[own] || 'playlist' : S().sortChannels;
    if ((sortable || own) && mode !== 'playlist') {
      list = list.slice();
      if (mode === 'number') list.sort(function (a, b) { return a.num - b.num; });
      else if (mode === 'name') list.sort(function (a, b) { return name(a).localeCompare(name(b), undefined, { numeric: true }); });
      else if (mode === 'za') list.sort(function (a, b) { return name(b).localeCompare(name(a), undefined, { numeric: true }); });
      else if (mode === 'watch') list.sort(function (a, b) { return (e.watch[b.k] || 0) - (e.watch[a.k] || 0); });
    }
    if (!withHidden) groupCache.set(gid, list);
    return list;
  }

  /* ---------- edits ---------- */
  function commit() { dirty(); Store.saveEdits(); }

  // Many at once, one save: { key: true (hide) | false (show) }.
  function hideChannels(changes) { var h = E().hiddenChannels; Object.keys(changes).forEach(function (k) { if (changes[k]) h[k] = 1; else delete h[k]; }); commit(); }
  function isHidden(k) { return !!E().hiddenChannels[k]; }
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
  // Move a channel up or down inside a group (dir -1 / +1, or more for a page).  Your own groups keep
  // their item list; a provider group gets "Your order" (chanOrder), starting from how it shows now.
  function canReorder(gid) { return !!gid && !isVirtual(gid); }
  function moveInGroup(gid, k, dir) {
    var g = custom(gid), e = E();
    if (!canReorder(gid)) return false;
    // Start from the full group as it shows now, hidden channels included, so they keep their place.
    var keep = S().showHidden; S().showHidden = true; groupCache.delete(gid);
    var now; try { now = channels(gid).map(function (c) { return c.k; }); } finally { S().showHidden = keep; groupCache.delete(gid); }
    var a = now.indexOf(k), b = Math.max(0, Math.min(now.length - 1, a + dir));
    if (a < 0 || a === b) return false;
    now.splice(a, 1); now.splice(b, 0, k);
    if (g) {
      // Your group: its item list becomes what you see (a sort it had becomes your order), plus
      // any channels the playlist no longer has, kept at the end in case they come back.
      var shown = {}; now.forEach(function (x) { shown[x] = 1; });
      g.items = now.concat(g.items.filter(function (x) { return !shown[x]; }));
      if (e.groupSort && e.groupSort[gid]) delete e.groupSort[gid];
      commit();
      return true;
    }
    if (!e.chanOrder) e.chanOrder = {};
    e.chanOrder[gid] = now;
    if (!e.groupSort) e.groupSort = {};
    e.groupSort[gid] = 'custom';
    commit();
    return true;
  }
  // Back to the provider's order (or the sort chosen for all groups).
  function resetOrder(gid) { var e = E(); if (e.chanOrder) delete e.chanOrder[gid]; if (e.groupSort && e.groupSort[gid] === 'custom') delete e.groupSort[gid]; commit(); }
  function hasOwnOrder(gid) { var e = E(); return !isCustom(gid) && !!(e.groupSort && e.groupSort[gid] === 'custom' && e.chanOrder && e.chanOrder[gid]); }
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
    hideChannels: hideChannels, isHidden: isHidden, idle: idle, ALL: ALL, RECENT: RECENT, FAV: FAV, EVENTS: EVENTS, NEW: NEW, TEAMS: TEAMS, set: set, isNew: isNew, isVirtual: isVirtual, canReorder: canReorder, resetOrder: resetOrder, hasOwnOrder: hasOwnOrder, isFav: isFav, toggleFav: toggleFav, touchRecent: touchRecent, addWatch: addWatch,
    shownAnywhere: shownAnywhere, isBlocked: isBlocked, block: block, get data() { return data; }, dirty: dirty, name: name, groups: groups, channels: channels, groupName: groupName,
    isCustom: isCustom, customGroups: function () { return E().custom; }, find: find, count: count, sample: sample,
    hideChannel: hideChannel, hideGroup: hideGroup, renameChannel: renameChannel,
    createGroup: createGroup, renameGroup: renameGroup, deleteGroup: deleteGroup,
    copyTo: copyTo, removeFrom: removeFrom, moveInGroup: moveInGroup, moveGroup: moveGroup,
    hiddenItems: hiddenItems, allGroups: allGroups, versions: versions, versionKey: versionKey, numberCanGrow: numberCanGrow, qualityLabel: qualityLabel, versionTag: versionTag, hideGroups: hideGroups, get epgUrl() { return data.epgUrl; }, get type() { return Store.playlist.type; }
  };
})();
