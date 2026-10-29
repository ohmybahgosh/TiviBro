/* Channel logos from open logo projects, for channels the provider and the guide have no logo for
   (or, if you like, for every channel, so they all match).  Settings > Appearance > Logo library.
   TiviBro hosts no logo images.  It downloads a small index (tivibro.app/logos/, built by
   scripts/logos/build-index.js) for the countries in your playlist, matches each channel by its guide
   id, its cleaned name and country, or a local station's call sign, and loads the logo from where its
   project keeps it:
     "Matching set"    tv-logo/tv-logos, one style for dark screens (falls back to the original)
     "Original logos"  iptv-org/database, each channel's own logo (falls back to the set)
   The index is kept on the TV for a week. */
var Logos = (function () {
  'use strict';
  var BASE = 'https://tivibro.app/logos/', WEEK = 7 * 86400e3;
  var index = null, lists = {}, memo = new Map(), ctx = null, localGroups = {}, order = [], loading = null, gen = 0, status = { state: 'off', countries: [], entries: 0, at: 0, error: '' };
  // Regions in a playlist that the index keeps under several countries.
  var ALSO = { LAT: ['MX', 'AR', 'CO', 'ES', 'CL', 'PE'], ARAB: ['AE', 'SA', 'EG', 'QA'], EXYU: ['RS', 'HR', 'BA', 'SI', 'MK'], NORDIC: ['SE', 'NO', 'DK', 'FI'], CARIB: ['JM', 'TT', 'DO', 'PR'] };

  function S() { return Store.settings; }
  function mode() { return S().logoLib || 'off'; }                 // off | fill | all
  function style() { return S().logoStyle === 'original' ? 'original' : 'set'; }
  function base() { var b = S().logoBase || BASE; return /\/$/.test(b) ? b : b + '/'; }
  function cc(code) { code = String(code || '').toUpperCase(); return code === 'GB' ? 'UK' : code; }

  function cached(name, maxAge) {
    return Store.idbGet('logos:' + name).then(function (x) {
      if (x && x.base === base() && Date.now() - x.at < maxAge) return x.data;
      return U.getJSON(base() + name + '.json', 30000, 'logos ' + name).then(function (data) {
        Store.idbSet('logos:' + name, { at: Date.now(), base: base(), data: data });
        return data;
      }, function (e) { if (x && x.data) return x.data; throw e; });   // offline: last week's copy beats nothing
    });
  }

  // The countries a playlist needs: those its groups and names belong to, those in its guide ids
  // ("CNN.us"), the TV's own, and international channels.
  function wanted(data) {
    var by = {}, add = function (c, n) { c = cc(c); if (c) by[c] = (by[c] || 0) + n; };
    ctx = Tidy.make(data);
    localGroups = {}; ctx.locals().groups.forEach(function (g) { localGroups[g.id] = 1; });
    ctx.countries().forEach(function (x) { add(x.p, x.chans); (ALSO[x.p] || []).forEach(function (o) { add(o, x.chans / 2); }); });
    data.channels.forEach(function (c) { var m = /\.([a-z]{2})(?:@[^.]*)?$/i.exec(c.epg || ''); if (m) add(m[1], 1); });
    add(Tidy.ccOfLocale(navigator.language), 50);
    var list = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 12);
    if (list.indexOf('INT') < 0) list.push('INT');
    return list;
  }

  function prepare(code, raw) {
    var keys = new Map(), ids = new Map();
    (raw.e || []).forEach(function (e) { keys.set(e[0], e); if (e[1]) ids.set(e[1].toLowerCase(), e); });
    (raw.x || []).forEach(function (x) { var e = raw.e[x[1]]; if (e && !keys.has(x[0])) keys.set(x[0], e); });
    return { keys: keys, ids: ids };
  }

  function load(data) {
    var my = ++gen;
    memo.clear(); lists = {}; order = [];
    if (mode() === 'off' || !data || !data.channels || !data.channels.length) { status = { state: 'off', countries: [], entries: 0, at: 0, error: '' }; return Promise.resolve(); }
    status = { state: 'loading', countries: [], entries: 0, at: 0, error: '' };
    var want = wanted(data);
    loading = cached('index', WEEK).then(function (ix) {
      if (my !== gen) return;
      index = ix;
      var have = want.filter(function (c) { return ix.countries && ix.countries[c]; });
      return Promise.all(have.map(function (c) { return cached(c, WEEK).then(function (raw) { return [c, raw]; }, function () { return null; }); })).then(function (got) {
        if (my !== gen) return;
        var n = 0;
        got.forEach(function (x) { if (!x) return; lists[x[0]] = prepare(x[0], x[1]); order.push(x[0]); n += lists[x[0]].keys.size; });
        memo.clear();
        status = { state: 'ready', countries: order.slice(), entries: n, at: Date.now(), error: '' };
        Log.info('logos', 'Logo library ready: ' + order.join(', ') + ' (' + n + ' names)');
        if (typeof Views !== 'undefined' && Views.refreshLists) Views.refreshLists(true);
      });
    }).catch(function (e) {
      if (my !== gen) return;
      status = { state: 'error', countries: [], entries: 0, at: 0, error: e.message || String(e) };
      Log.warn('logos', 'Logo library not available: ' + status.error);
    });
    return loading;
  }

  function inList(code, key) { var l = lists[code]; return l && key ? l.keys.get(key) : null; }
  // Look a channel up: guide id, then its name in its own country, then the playlist's countries,
  // then a local station's call sign or network.
  function find(c) {
    if (!order.length) return null;
    if (typeof Events !== 'undefined' && Events.of && Events.of(c)) return null;   // "NCAAB 001 | A @ B" is a game, not a channel
    var m = /^(.+?)\.([a-z]{2})(?:@[^.]*)?$/i.exec(c.epg || ''), e;
    if (m) { var l = lists[cc(m[2])]; e = l && l.ids.get((m[1] + '.' + m[2]).toLowerCase()); if (e) return e; }
    var clean = Tidy.cleanDefault(c.n), p = Tidy.prep(clean), key = Tidy.logoKey(clean);
    if (key && key.length >= 2 && !/^\d+$/.test(key)) {
      var tries = [cc(p.country), ctx ? ctx.groupCountry(c.g) : ''].concat(ALSO[ctx ? ctx.groupCountry(c.g) : ''] || [], order), seen = {};
      for (var i = 0; i < tries.length; i++) {
        var code = tries[i]; if (!code || seen[code]) continue; seen[code] = 1;
        if ((e = inList(code, key))) return e;
      }
    }
    // Local stations, only in the provider's local groups: "Global Desk" elsewhere is not the Global network.
    var loc = localGroups[c.g] ? Tidy.parseLocal(c.n) : null;
    if (loc) {
      var call = loc.call ? loc.call.toLowerCase().replace(/[-\s]?(tv|dt|ld|cd|lp)$/, '') : '';
      if (call && ((e = inList('US', call)) || (e = inList('CA', call)))) return e;
      var net = Tidy.prep(loc.net).c;
      if ((e = inList('US', net)) || (e = inList('CA', net))) return e;
    }
    return null;
  }
  function match(c) {
    if (!c || !order.length) return null;
    if (memo.has(c.k)) return memo.get(c.k);
    var e = find(c) || null;
    memo.set(c.k, e);
    return e;
  }
  function urlOf(e, st) {
    if (!e) return '';
    var set = e[3] && index ? index.tvlogos + e[3] : '', orig = e[2] || '';
    return (st || style()) === 'set' ? set || orig : orig || set;
  }
  function url(c) { return mode() === 'off' ? '' : urlOf(match(c)); }

  // How many of these channels the library has a logo for, and how many of those had none before.
  function coverage(channels, own) {
    var n = 0, filled = 0;
    channels.forEach(function (c) { if (match(c)) { n++; if (!own(c)) filled++; } });
    return { found: n, filled: filled, total: channels.length };
  }

  return { load: load, url: url, match: match, urlOf: urlOf, coverage: coverage, mode: mode, style: style,
    get status() { return status; }, get loading() { return loading; }, get ready() { return status.state === 'ready'; }, BASE: BASE };
})();
