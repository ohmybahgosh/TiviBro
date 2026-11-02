/* Content filter (Settings > Parental controls > Content filter; issue/discussion #20).
   Channels and groups it matches are left out of everything, from the moment a playlist loads: the
   guide, every list, Search, the set-up tour, the phone app and the web editor never see them.  It is
   separate from the PIN lock, which still blocks what you choose.  Nothing is deleted: change the
   filter and the channels come back.

   Store.settings.filter = { adult: true|false, words: [..], chans: [..channel names], groups: [..group names], asked }
     adult   the built-in list of adult words, in several languages ("Adult Swim" is left alone)
     words   your own words or call signs, matched as whole words in channel and group names
     chans   channels you hid with the filter ("Hide with the filter" in a channel's options), by name
     groups  groups you hid with the filter, by name
   A new TV starts with adult on; the set-up tour's first screen asks.  TVs that already had a
   playlist before the filter existed start with it off. */
var Filter = (function () {
  'use strict';
  var ADULT = /\b(?:adults?(?!\s*swim)|adultes?|adultos?|adulti|xxx+|porn\w*|er[oó]ti[ckq]\w*|sexy|playboy|hustler|brazzers|penthouse|dorcel|redlight|vivid\s*(?:tv|red|hd)|private\s*(?:tv|hd|spice)|hot\s*club|venus\s*tv|blue\s*hustler|for\s*adults|para\s*adultos|per\s*adulti|pour\s*adultes)\b|(?:^|[^\w])(?:18\s*\+|\+\s*18)(?![\w])|эрот|для\s*взрослых|成人/i;

  function S() { return typeof Store !== 'undefined' ? Store.settings : {}; }
  function conf() { var f = S().filter; return f && typeof f === 'object' ? f : { adult: false, words: [], chans: [], groups: [] }; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var cache = { key: '', test: null };
  // One test for a name, made again only when the filter changes.
  function tester() {
    var f = conf(), key = JSON.stringify([!!f.adult, f.words || [], f.chans || [], f.groups || []]);
    if (cache.key === key) return cache.test;
    var words = (f.words || []).map(function (w) { return String(w).trim(); }).filter(Boolean);
    var wre = words.length ? new RegExp('(?:^|[^\\w])(?:' + words.map(esc).join('|') + ')(?![\\w])', 'i') : null;
    var chans = {}, groups = {};
    (f.chans || []).forEach(function (n) { chans[String(n).toLowerCase()] = 1; });
    (f.groups || []).forEach(function (n) { groups[String(n).toLowerCase()] = 1; });
    var on = !!f.adult || !!wre || (f.chans || []).length > 0 || (f.groups || []).length > 0;
    cache = { key: key, test: on ? {
      name: function (n) { n = String(n || ''); return (f.adult && ADULT.test(n)) || (wre && wre.test(n)) || false; },
      chan: function (n) { return !!chans[String(n || '').toLowerCase()]; },
      group: function (n) { return !!groups[String(n || '').toLowerCase()]; }
    } : null };
    return cache.test;
  }
  function active() { return !!tester(); }

  /* A playlist's data without what the filter takes out: a new object, so the copy kept on the TV
     stays whole and loosening the filter brings everything back. */
  var last = { channels: 0, groups: 0 };
  function apply(d) {
    var t = tester();
    last = { channels: 0, groups: 0 };
    if (!t || !d || !d.channels) return d;
    var out = {}, gone = {};
    Object.keys(d).forEach(function (k) { out[k] = d[k]; });
    out.groups = (d.groups || []).filter(function (g) { if (t.name(g.name) || t.group(g.name)) { gone[g.id] = 1; return false; } return true; });
    out.channels = d.channels.filter(function (c) { return !(gone[c.g] || c.adult || t.name(c.n) || t.chan(c.n)); });
    last = { channels: d.channels.length - out.channels.length, groups: d.groups ? d.groups.length - out.groups.length : 0 };
    if ((last.channels || last.groups) && typeof Log !== 'undefined') Log.info('filter', 'Content filter left out ' + last.channels + ' channels and ' + last.groups + ' groups');
    return out;
  }
  // Does a name match (for the web editor, Movies and the like)?
  function matches(n) { var t = tester(); return !!(t && (t.name(n) || t.chan(n))); }

  function save(f) { S().filter = f; if (typeof Store !== 'undefined') Store.saveSettings(); cache.key = ''; }
  function edit(fn) { var f = JSON.parse(JSON.stringify(conf())); f.words = f.words || []; f.chans = f.chans || []; f.groups = f.groups || []; fn(f); save(f); }
  function setAdult(on) { edit(function (f) { f.adult = !!on; f.asked = true; }); }
  function addChannel(n) { edit(function (f) { if (f.chans.indexOf(n) < 0) f.chans.push(n); }); }
  function addGroup(n) { edit(function (f) { if (f.groups.indexOf(n) < 0) f.groups.push(n); }); }
  function addWord(w) { w = String(w || '').trim(); if (!w) return; edit(function (f) { if (f.words.indexOf(w) < 0) f.words.push(w); }); }
  function remove(kind, v) { edit(function (f) { f[kind] = f[kind].filter(function (x) { return x !== v; }); }); }

  return { apply: apply, matches: matches, active: active, conf: conf, setAdult: setAdult, addChannel: addChannel, addGroup: addGroup, addWord: addWord, remove: remove,
    get last() { return last; }, ADULT: ADULT };
})();
if (typeof module !== 'undefined') module.exports = Filter;
