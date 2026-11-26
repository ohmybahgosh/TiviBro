/* Opening TiviBro straight onto something: the launch API for home screens, launchers, scripts and Home
   Assistant (docs/LAUNCH-API.md).  Nothing here knows who is asking.

   Two ways in, one result:
     launch params   { "open": { "action": "channel", "number": 5 } }
     a deep link     { "contentTarget": "tivibro://channel/5" }   (appinfo.json deeplinkingParams; also "uri")
   on a cold start (webOSSystem.launchParams) and when TiviBro is already running (webOSRelaunch).
   tivibro://<action>[/<value>][?field=value&...]: the path's first part is the action, a second part is the
   action's main field (team: id, channel: q, search: q, view: name, settings: section), the query the other fields.
   The TV's reminder alert ({ "reminder": { pid, k, s } }) comes through here too.

   Actions (v1):
     channel   key | number | epg | name | q    play a channel; q tries each of the others in turn
     team      id (nhl:det), start, title       play a followed team's game: on now, else the one at start
     guide     -                                the guide
     view      name: live guide movies shows media onnow sports recordings search settings
     search    q                                Search, with the words typed in
     settings  section (keys, recording, ...)   Settings, on that section
     last      -                                the channel watched before
     reminder  pid, k, s                        what the TV's reminder alert sends

   Anything asked before the channels are loaded waits for them (ready()). */
var Launch = (function () {
  'use strict';
  var pending = null, isReady = false, onReminder = null;
  var MAIN = { team: 'id', channel: 'q', search: 'q', view: 'name', settings: 'section' };
  var VIEWS = { live: 'live', channels: 'live', guide: 'guide', movies: 'movies', shows: 'shows', series: 'shows', media: 'media', 'my-media': 'media', onnow: 'onnow', sports: 'sports', recordings: 'recordings', search: 'search', settings: 'settings' };

  // tivibro://team/nhl:det?start=1795216200000 -> { action: 'team', id: 'nhl:det', start: '1795216200000' }
  function fromUri(uri) {
    var m = /^tivibro:\/\/([^?#]*)(?:\?([^#]*))?/i.exec(String(uri || '').trim());
    if (!m) return null;
    var parts = m[1].split('/').filter(Boolean).map(dec), o = { action: (parts[0] || '').toLowerCase() };
    if (!o.action) return null;
    if (parts.length > 1) o[MAIN[o.action] || 'q'] = parts.slice(1).join('/');
    (m[2] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = dec(i < 0 ? kv : kv.slice(0, i)), v = i < 0 ? '' : dec(kv.slice(i + 1));
      if (k && k !== 'action' && !/^__/.test(k)) o[k] = v;
    });
    return o;
  }
  function dec(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }

  /* The launch params, whichever way they came, as one { action, ... } or null.  Phone pairing
     ({ companion }) isn't one of these: phone.js has it. */
  function parse(raw) {
    var p = raw;
    if (typeof p === 'string') { if (/^tivibro:/i.test(p.trim())) return fromUri(p); try { p = JSON.parse(p || '{}'); } catch (e) { return null; } }
    if (!p || typeof p !== 'object') return null;
    if (p.reminder && p.reminder.k) return { action: 'reminder', pid: p.reminder.pid, k: p.reminder.k, s: p.reminder.s };
    if (p.open && typeof p.open === 'object' && p.open.action) { var o = {}; for (var k in p.open) if (!/^__/.test(k)) o[k] = p.open[k]; o.action = String(o.action).toLowerCase(); return o; }
    if (typeof p.open === 'string') return fromUri(p.open);
    var t = p.contentTarget || p.uri || p.target;
    // LG's deep links can arrive with the target as JSON text of its own.
    if (typeof t === 'string' && /^\s*\{/.test(t)) { try { var j = JSON.parse(t); t = j.contentTarget || j.uri || ''; } catch (e) {} }
    return typeof t === 'string' ? fromUri(t) : null;
  }

  /* ---------- finding a channel ---------- */
  function usable(c) { return c && !(Store.edits.hiddenChannels || {})[c.k] && (!Library.isBlocked || !Library.isBlocked(c) || Parental.blockedOk(c)); }
  function squash(s) { s = String(s || '').toLowerCase(); if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); return s.replace(/[^a-z0-9]+/g, ''); }
  function byNumber(n) { var all = Library.data.channels; for (var i = 0; i < all.length; i++) if (all[i].num === n && usable(all[i])) return all[i]; return null; }
  function byEpg(id) {
    var all = Library.data.channels, want = String(id).toLowerCase();
    for (var i = 0; i < all.length; i++) { var c = all[i]; if (!usable(c)) continue; var e = (typeof Epg !== 'undefined' && Epg.epgId ? Epg.epgId(c) : c.epg) || c.epg || ''; if (String(e).toLowerCase() === want || String(c.epg || '').toLowerCase() === want) return c; }
    return null;
  }
  /* By name, as the channel list writes it (Library.name: your renames and the name rules): exactly first, then
     one that starts with it, then one that has it in it.  Among equals, a Favorite, then the first in the list. */
  function byName(n) {
    var want = squash(n); if (!want) return null;
    var best = null, rank = 9;
    Library.data.channels.forEach(function (c) {
      if (!usable(c)) return;
      var have = squash(Library.name(c)), r = have === want ? 0 : have.indexOf(want) === 0 ? 2 : have.indexOf(want) > 0 ? 4 : 9;
      if (r < 9 && Library.isFav(c.k)) r--;
      if (r < rank) { rank = r; best = c; }
    });
    return best;
  }
  function channel(o) {
    var c = null;
    if (o.key) c = Library.find(String(o.key));
    if (!c && o.number != null && o.number !== '') c = byNumber(+o.number);
    if (!c && o.epg) c = byEpg(o.epg);
    if (!c && o.name) c = byName(o.name);
    if (!c && o.q != null && o.q !== '') {
      var q = String(o.q);
      c = Library.find(q) || (/^\d{1,5}$/.test(q) ? byNumber(+q) : null) || byEpg(q) || byName(q);
    }
    return c && usable(c) ? c : null;
  }
  function what(o) { return o.name || o.title || o.q || o.number || o.epg || o.key || ''; }
  // Plays c; more (other channels showing the same game) are tried in turn if c doesn't start (Views.playChain).
  function play(c, more) {
    if (UI.modalOpen) UI.close();
    if (!Parental.blockedOk(c)) { U.toast(Library.name(c) + ' is locked.  Open it on the TV with the PIN.'); return; }
    more = (more || []).filter(function (x) { return x.k !== c.k && Parental.blockedOk(x); });
    if (more.length && Views.playChain) Views.playChain([c].concat(more), 'launch'); else Views.startChannel(c, false, Views.goFull);
  }

  /* ---------- a team's game ---------- */
  function team(o) {
    if (typeof Teams === 'undefined') return U.toast('My teams is not in this version');
    var id = String(o.id || '').toLowerCase(), t = Teams.team(id), name = o.title || (t && t.name) || id;
    if (!t) return U.toast('No team ' + id);
    var start = +o.start || 0, now = Date.now(), list = [];
    // Followed teams' games over the next day, or up to the start asked for (Teams.games only looks for those).
    try { list = Teams.games(Math.max(86400e3, start ? start - now + 3600e3 : 0), false); } catch (e) { list = []; }
    list = list.filter(function (g) { return g.team && g.team.id === id; });
    if (!list.length) return U.toast('No ' + name + ' game in the guide' + (Teams.follows && !Teams.follows(id) ? ' (follow the team in My teams)' : ''));
    var g = null;
    if (start) list.forEach(function (x) { if (!g || Math.abs(x.p.s - start) < Math.abs(g.p.s - start)) g = x; });
    if (!g) g = list.filter(function (x) { return x.p.s <= now + 5 * 60000; })[0] || list[0];
    // A Favorite channel for that game, when it's on several.
    var same = list.filter(function (x) { return x.p.s === g.p.s; }), fav = same.filter(function (x) { return Library.isFav(x.c.k); })[0];
    if (fav) g = fav;
    // The game's other channels, Favorites first, to fall back on.
    var more = same.filter(function (x) { return x !== g; }).sort(function (a, b) { return (Library.isFav(b.c.k) ? 1 : 0) - (Library.isFav(a.c.k) ? 1 : 0); }).map(function (x) { return x.c; });
    if (g.p.s > now + 5 * 60000) {
      UI.menu(g.p.t, [{ label: 'Watch ' + Library.name(g.c) + ' now', sub: 'The game starts at ' + U.hhmm(g.p.s), action: function () { play(g.c, more); } }, { label: 'Not now' }], null, { notice: true });
      return;
    }
    play(g.c, more);
  }

  /* ---------- carrying one out ---------- */
  function run(o) {
    var a = o.action;
    Log.info('app', 'Opened for ' + a + (what(o) ? ' ' + String(what(o)).slice(0, 60) : ''));
    if (Views.full && a !== 'channel' && a !== 'team' && a !== 'last' && a !== 'reminder') Views.runAction('exit', 'player');
    switch (a) {
      case 'reminder': return onReminder ? onReminder({ pid: o.pid, k: o.k, s: +o.s }) : Views.openReminder({ pid: o.pid, k: o.k, s: +o.s });
      case 'channel': { var c = channel(o); return c ? play(c) : U.toast('No channel ' + what(o) + ' in this playlist'); }
      case 'team': return team(o);
      case 'last': return Views.runAction('last', 'list');
      case 'guide': return Views.switchTab('guide');
      case 'search': Views.switchTab('search'); if (o.q) Search.query(String(o.q)); return;
      case 'settings': Views.switchTab('settings'); if (o.section) Settings.section(String(o.section)); return;
      case 'view': {
        var v = VIEWS[String(o.name || '').toLowerCase()];
        if (!v) return U.toast('TiviBro has no view ' + (o.name || ''));
        return Views.switchTab(v);
      }
      default: U.toast('TiviBro can\'t open "' + a + '".  It may need an update.');
    }
  }
  /* Launch params or a relaunch's detail: carried out now, or kept for when the channels are in.  false when it
     wasn't one of these (phone pairing, or nothing). */
  function handle(raw) {
    var o = parse(raw);
    if (!o) return false;
    if (isReady && Library.count()) { try { run(o); } catch (e) { Log.warn('app', 'Could not open ' + o.action + ': ' + (e && e.message)); } }
    else pending = o;
    return true;
  }
  function ready() {
    isReady = true;
    if (!pending) return;
    var o = pending; pending = null;
    setTimeout(function () { try { run(o); } catch (e) { Log.warn('app', 'Could not open ' + o.action + ': ' + (e && e.message)); } }, 600);
  }
  function launchParams() { var sys = window.webOSSystem || window.PalmSystem; return sys && sys.launchParams; }
  return { onReminder: function (fn) { onReminder = fn; }, parse: parse, fromUri: fromUri, handle: handle, ready: ready, launchParams: launchParams, get pending() { return pending; } };
})();
if (typeof module !== 'undefined') module.exports = Launch;
