/* Channel name editor engine.
   Two layers, applied per playlist:
   1. Default rules, preloaded and on by default.  Regex based, so one rule covers every
      separator style: "USA | ", "|US| ", "[US] ", "US: " and "us- " are all "country prefix".
      Each rule set can be switched on or off, and "recommended defaults" restores them.
   2. Your own prefix and suffix lists, matched literally and case-insensitively at the
      start or end of a name, exactly like TiviMate.  Spaces count: " HD" will not touch "WHD".
   Safety: a step that would leave nothing (or just a number) is undone, so a channel
   is never cleaned into a blank. */
var Names = (function () {
  'use strict';

  var SEP = '[|:\\-–—•»▎┃]';
  var COUNTRY = ['USA', 'US', 'UK', 'GB', 'CA', 'CAN', 'AU', 'AUS', 'NZ', 'IE', 'IRL', 'DE', 'GER', 'FR', 'ES', 'ESP', 'IT', 'ITA',
    'NL', 'PT', 'BR', 'MX', 'LAT', 'LATINO', 'LATAM', 'IN', 'IND', 'PK', 'AR', 'ARAB', 'TR', 'PL', 'SE', 'NO', 'DK', 'FI', 'BE', 'CH',
    'AT', 'GR', 'RO', 'HU', 'CZ', 'SK', 'HR', 'RS', 'BG', 'EXYU', 'EX-YU', 'AFR', 'AFRICA', 'ASIA', 'CARIB', 'PH', 'EN', 'ENG', 'NA', 'INT', 'NORDIC'];
  var TAGS = ['VIP', 'PPV', '24/7', '24-7', 'RAW', 'LIVE', 'NEW', 'PRIME', 'PREMIUM', 'SPORTS?', '4K', 'UHD', 'FHD', 'HD', 'SD', 'HEVC',
    'LOCALS?', 'NEWS', 'KIDS', 'MOVIES?', 'DOCS?', 'DOCUMENTARY', 'MUSIC', 'ENT', 'ENTERTAINMENT', 'GENERAL', 'RELIGIOUS'];
  var QUALITY = ['8K', '4K', 'UHD', 'FHD', 'QHD', 'HD', 'SD', 'HQ', 'LQ', 'HEVC', 'H\\.?265', 'H\\.?264', 'HDR10\\+?', 'HDR',
    '2160P?', '1080P?', '1080I', '720P?', '576P?', '480P?', '50 ?FPS', '60 ?FPS', '25 ?FPS', '30 ?FPS', 'RAW', 'BACKUP', 'BKP', 'ALT', 'MULTI', 'MULTI-?AUDIO',
    'VIP', 'PPV', 'ᴴᴰ', 'ᶠᴴᴰ', 'ᵁᴴᴰ', 'ˢᴰ', '⁴ᴷ'];
  var FEEDS = ['EAST', 'WEST', 'PACIFIC', 'CENTRAL', 'MOUNTAIN', 'ATLANTIC', 'E', 'W', 'ET', 'PT', 'CT', 'MT'];

  var RULES = [
    { id: 'country', label: 'Country and region prefixes', on: true, ex: [['USA | ESPN', 'ESPN'], ['|UK| BBC One', 'BBC One'], ['CA: TSN 1', 'TSN 1']] },
    { id: 'tags', label: 'Category and package prefixes', on: true, ex: [['VIP | AMC', 'AMC'], ['24/7 - Friends', 'Friends'], ['SPORTS: TNT', 'TNT']] },
    { id: 'quality', label: 'Quality and format tags at the end', on: true, ex: [['CNN FHD', 'CNN'], ['Nat Geo (1080p)', 'Nat Geo'], ['AMC | RAW', 'AMC']] },
    { id: 'symbols', label: 'Decorative symbols', on: true, ex: [['Fox News ᴴᴰ', 'Fox News'], ['TNT ★', 'TNT'], ['HBO ◉', 'HBO']] },
    { id: 'feeds', label: 'Time zone feeds', on: false, ex: [['HBO (East)', 'HBO'], ['Starz West', 'Starz']], note: 'Off by default: East and West feeds end up with the same name.' },
    { id: 'brackets', label: 'Any short bracketed tag at the ends', on: false, ex: [['[EN] Sky News', 'Sky News'], ['AMC (Backup)', 'AMC']], note: 'Off by default: can remove useful text like (Sports).' }
  ];

  function defaults() {
    var r = {};
    RULES.forEach(function (x) { r[x.id] = x.on; });
    return { enabled: true, groups: true, rules: r, prefixes: [], suffixes: [] };
  }

  function alt(list) { return list.slice().sort(function (a, b) { return b.length - a.length; }).join('|'); }

  function compile(cfg) {
    var pre = [], suf = [], any = [];
    var r = cfg.rules || {};
    if (r.country) {
      // Requires a separator or brackets, so "USA Network" and "UK Gold" survive.
      pre.push(new RegExp('^\\s*[\\[(|]\\s*(?:' + alt(COUNTRY) + ')\\s*[\\])|]\\s*' + SEP + '?\\s*', 'i'));
      pre.push(new RegExp('^\\s*(?:' + alt(COUNTRY) + ')\\s*' + SEP + '+\\s*', 'i'));
    }
    if (r.tags) {
      pre.push(new RegExp('^\\s*[\\[(|]\\s*(?:' + alt(TAGS) + ')\\s*[\\])|]\\s*' + SEP + '?\\s*', 'i'));
      pre.push(new RegExp('^\\s*(?:' + alt(TAGS) + ')\\s*' + SEP + '+\\s*', 'i'));
    }
    if (r.quality) {
      // Needs a space or separator in front, so "WHD" and "TSN4" are untouched.
      suf.push(new RegExp('(?:\\s+|\\s*' + SEP + '\\s*)[\\[(]?\\s*(?:' + alt(QUALITY) + ')\\s*[\\])]?\\s*$', 'i'));
      suf.push(new RegExp('\\s*[\\[(]\\s*(?:' + alt(QUALITY) + ')\\s*[\\])]\\s*$', 'i'));
    }
    if (r.feeds) {
      suf.push(new RegExp('\\s*[\\[(]\\s*(?:' + alt(FEEDS) + ')\\s*[\\])]\\s*$', 'i'));
      suf.push(new RegExp('\\s+(?:' + alt(FEEDS.filter(function (f) { return f.length > 2; })) + ')\\s*$', 'i'));
    }
    if (r.brackets) {
      pre.push(/^\s*[\[(][^\])]{1,24}[\])]\s*/);
      suf.push(/\s*[\[(][^\])]{1,24}[\])]\s*$/);
    }
    if (r.symbols) {
      any.push(/[\u02B0-\u02FF\u1D2C-\u1D6A\u1D9B-\u1DBF\u2070-\u209F\u2122\u00AE\u25C9\u25CF\u2605\u2606\u25B6\u25BA\u2B50\u26BD\u2714\u2728\u{1F534}\u{1F535}\u{1F7E2}\u{1F525}]+/gu);
    }

    var upre = (cfg.prefixes || []).map(function (s) { return String(s).replace(/^\s+/, '').toLowerCase(); })
      .filter(function (s) { return s.trim().length; }).sort(function (a, b) { return b.length - a.length; });
    var usuf = (cfg.suffixes || []).map(function (s) { return String(s).replace(/\s+$/, '').toLowerCase(); })
      .filter(function (s) { return s.trim().length; }).sort(function (a, b) { return b.length - a.length; });

    function ok(s) { return /[^\s\d|:\-–—•»()[\]]/.test(s); }   // has at least one real character
    function tidy(s) { return s.replace(/\s{2,}/g, ' ').replace(/^[\s|:\-–—•»/]+|[\s|:\-–—•»/]+$/g, ''); }

    var memo = new Map();
    function clean(name) {
      if (!name) return name || '';
      var hit = memo.get(name);
      if (hit !== undefined) return hit;
      var s = name, i, next;
      for (i = 0; i < any.length; i++) { next = s.replace(any[i], ' '); if (next !== s) { next = tidy(next); if (ok(next)) s = next; } }
      var guard = 0, prev;
      do {
        prev = s; guard++;
        // Your lists first: they are the most specific.
        for (i = 0; i < upre.length; i++) if (s.toLowerCase().indexOf(upre[i]) === 0) { next = s.slice(upre[i].length); if (ok(next)) s = next; }
        for (i = 0; i < usuf.length; i++) {
          var t = usuf[i], low = s.toLowerCase();
          if (low.length > t.length && low.slice(-t.length) === t) { next = s.slice(0, s.length - t.length); if (ok(next)) s = next; }
        }
        for (i = 0; i < pre.length; i++) { next = s.replace(pre[i], ''); if (next !== s && ok(next)) s = next; }
        for (i = 0; i < suf.length; i++) { next = s.replace(suf[i], ''); if (next !== s && ok(next)) s = next; }
      } while (s !== prev && guard < 8);
      // Only tidy names a rule actually changed; untouched names keep every character.
      s = s === name ? name.trim() : tidy(s);
      if (!ok(s)) s = name.trim();
      memo.set(name, s);
      return s;
    }
    return clean;
  }

  var cache = { sig: '', fn: null };
  function cfgOf() {
    var p = (typeof Store !== 'undefined' && Store.playlist) || {};
    return p.names || defaults();
  }
  function cleanerFor(cfg) {
    if (!cfg.enabled) return function (n) { return n || ''; };
    var sig = JSON.stringify(cfg);
    if (sig !== cache.sig) { cache.sig = sig; cache.fn = compile(cfg); }
    return cache.fn;
  }

  // "a, b ,c" -> ['a','b','c'] keeping meaningful spaces (TiviMate paste format).
  function parseList(str) { return (str || '').split(',').filter(function (s) { return s.trim().length; }); }
  function joinList(arr) { return (arr || []).join(','); }

  return {
    clean: function (n) { return cleanerFor(cfgOf())(n); },
    cleanWith: function (cfg, n) { return cleanerFor(cfg)(n); },
    compile: compile,
    invalidate: function () { cache.sig = ''; },
    defaults: defaults,
    RULES: RULES,
    parseList: parseList, joinList: joinList,
    groupsOn: function () { var c = cfgOf(); return c.enabled && c.groups; }
  };
})();
