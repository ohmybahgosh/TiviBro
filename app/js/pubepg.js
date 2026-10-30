/* Public guide fill-in: free XMLTV guides by country, for the channels that still have no guide
   after your own guide sources and the provider's.  Settings > Playlists > the playlist > Guide.
   Two open projects, tried in this order:
     epg.pw          20 countries, lighter files, updated daily
     iptv-epg.org    70 countries, bigger and more complete, updated hourly (needs the helper)
   TiviBro hosts nothing and sends no logins: the TV downloads the files straight from them.  Only
   channels with no guide are looked up, matched by guide id, a local station's call sign, or name.
   Your guide sources and the provider's guide always come first; this only fills the gaps.
   keys() runs on the page and, as source, in the guide worker (epg.js). */
var PubEpg = (function () {
  'use strict';
  var PW = 'AU BR CA CN DE FR GB HK ID IN JP MY NZ PH RU SG TW US VN ZA'.split(' ');
  var IE = ('AL AR AM AU AT BY BE BO BA BR BG CA CL CO CR HR CW CZ DK DO SV FI FR GE DE GH GR GT HN HK HU IS IN ID IL IT JP LV LU MY MT MX ME ' +
    'NL NZ NI NG NO PA PY PE PL PT RO RU RS SG ZA ES SE CH TW TH TR UG GB US UY VE ZW').split(' ');
  var SOURCES = [
    { id: 'epgpw', name: 'epg.pw', site: 'https://epg.pw', cc: PW, base: 'https://epg.pw/xmltv/', file: function (c, gz) { return 'epg_' + c + (gz ? '.xml.gz' : '.xml'); } },
    // No CORS headers: only reachable through the helper (or the dev relay).
    { id: 'iptvepg', name: 'iptv-epg.org', site: 'https://iptv-epg.org', cc: IE, helper: true, base: 'https://iptv-epg.org/files/', file: function (c) { return 'epg-' + c.toLowerCase() + '.xml.gz'; } }
  ];
  // Regions in playlists that are really several countries.
  var ALSO = { LAT: ['MX', 'AR', 'CO'], EXYU: ['RS', 'HR', 'BA'], NORDIC: ['SE', 'NO', 'DK'], CARIB: ['DO'], ARAB: [], AFRICA: ['ZA', 'NG'] };
  var AUTO_MAX = 4, MANUAL_MAX = 8, MIN_MISSING = 3;

  function code(c) { c = String(c || '').toUpperCase(); return c === 'UK' ? 'GB' : c; }
  function supported(c) { c = code(c); return SOURCES.some(function (s) { return s.cc.indexOf(c) >= 0; }); }
  function all() {
    var by = {};
    SOURCES.forEach(function (s) { s.cc.forEach(function (c) { by[c] = 1; }); });
    return Object.keys(by).sort(function (a, b) { return name(a).localeCompare(name(b)); });
  }
  var NAMES = { AL: 'Albania', AR: 'Argentina', AM: 'Armenia', AU: 'Australia', AT: 'Austria', BY: 'Belarus', BE: 'Belgium', BO: 'Bolivia', BA: 'Bosnia and Herzegovina', BR: 'Brazil',
    BG: 'Bulgaria', CA: 'Canada', CL: 'Chile', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', HR: 'Croatia', CW: 'Curaçao', CZ: 'Czechia', DK: 'Denmark', DO: 'Dominican Republic',
    SV: 'El Salvador', FI: 'Finland', FR: 'France', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GR: 'Greece', GT: 'Guatemala', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary',
    IS: 'Iceland', IN: 'India', ID: 'Indonesia', IL: 'Israel', IT: 'Italy', JP: 'Japan', LV: 'Latvia', LU: 'Luxembourg', MY: 'Malaysia', MT: 'Malta', MX: 'Mexico', ME: 'Montenegro',
    NL: 'Netherlands', NZ: 'New Zealand', NI: 'Nicaragua', NG: 'Nigeria', NO: 'Norway', PA: 'Panama', PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PL: 'Poland', PT: 'Portugal',
    RO: 'Romania', RU: 'Russia', RS: 'Serbia', SG: 'Singapore', ZA: 'South Africa', ES: 'Spain', SE: 'Sweden', CH: 'Switzerland', TW: 'Taiwan', TH: 'Thailand', TR: 'Turkey',
    UG: 'Uganda', GB: 'United Kingdom', US: 'United States', UY: 'Uruguay', VE: 'Venezuela', VN: 'Vietnam', ZW: 'Zimbabwe' };
  function name(c) { c = code(c); return NAMES[c] || c; }

  // Per-playlist settings: { on, cc: [codes] }.  Missing means on, countries picked automatically.
  function conf(p) {
    var x = (p && p.pubEpg) || {};
    return { on: x.on !== false, cc: Array.isArray(x.cc) ? x.cc.map(code).filter(supported) : [] };
  }
  function set(p, patch) {
    var x = p.pubEpg || (p.pubEpg = {});
    Object.keys(patch).forEach(function (k) { x[k] = patch[k]; });
  }

  /* Matching keys for one channel name (and guide id), lower rank first:
     cs:WOTV (a local station's call sign, :2 for a subchannel), n:<name> (|w for a West feed).
     "US - A&E Network West" and "A&E (West) US" both give n:aande|w.  country is a "XX - " prefix. */
  function keys(name, id) {
    var out = [], raw = String(name || '').replace(/&amp;/g, '&'), up = raw.toUpperCase(), country = '';
    var full = up, pre = /^\s*([A-Z0-9+]{1,10})\s*(?:-|:|\||»)\s+/.exec(up);
    if (pre) { country = pre[1]; raw = raw.slice(pre[0].length); up = raw.toUpperCase(); }
    var west = /\b(WEST|PACIFIC)\b/.test(up) ? '|w' : '';
    var NET = '(?:ABC|CBS|NBC|FOX|CW|PBS|MNT|MY|MYTV|TELEMUNDO|UNIVISION|UNIMAS|ION|METV|IND|COZI|COMET|GRIT|BOUNCE|LAFF|ANTENNA)';
    var m = /\(([KW][A-Z]{2,3})(?:(?:-(?:DT|LD|TV|CD)|DT)(\d)?)?\b/.exec(up) ||
      new RegExp('\\b' + NET + '\\s+(?:EAST\\s+|WEST\\s+|\\d+\\s+)?([KW][A-Z]{2,3})(?:(?:-(?:DT|LD|TV|CD)|DT)(\\d)?)?\\b').exec(up) ||
      /(?:^|\s)([KW][A-Z]{2,3})(?:-(?:DT|LD|CD)|DT)(\d)?\b/.exec(up) ||
      // "ABC | DETROIT | WXYZ": a call sign on its own between separators, after a network name.
      new RegExp('^\\s*' + NET + '\\b.*(?:^|[|:\\u2013-]\\s*)([KW][A-Z]{2,3})(?:(?:-(?:DT|LD|TV|CD)|DT)(\\d)?)?\\s*$').exec(full);
    if (m && !/^(WEST|WWE|KIDS|WILD|WOW)$/.test(m[1])) out.push(['cs:' + m[1] + (m[2] && m[2] !== '1' ? ':' + m[2] : ''), 1]);
    var s = raw.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
    var t = s.replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|raw|east|eastern|west|pacific|backup|us|usa|uk|ca|network|channel|tv|the)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
    // "USA Network" is all stop words: keep it whole.
    if (t.length < 2) t = s.replace(/\b(hd|fhd|uhd|4k|sd|east|eastern|west|pacific)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
    if (t.length >= 2) out.push(['n:' + t + west, 2]);
    return { keys: out, country: country };
  }

  /* The country of each channel, for picking which files to download: its group's country, a
     country prefix on its name, or its guide id's ending ("CNN.us"). */
  function countryOf(ctx, c) {
    var g = ctx.groupCountry(c.g);
    if (g) return g;
    var p = Tidy.ccNorm(Tidy.prefixOf(c.n));
    if (p) return p;
    var m = /\.([a-z]{2})(?:@[^.]*)?$/i.exec(c.epg || '');
    return m ? Tidy.ccNorm(m[1]) : '';
  }

  /* Which countries to download for these channels with no guide.  Your list when you made one;
     otherwise the countries most of them belong to (up to four), with the TV's own country for
     channels that have none (sports, events and the like). */
  function countriesFor(p, missing, data) {
    var cf = conf(p);
    if (cf.cc.length) return cf.cc.slice(0, MANUAL_MAX);
    var ctx = Tidy.make(data), by = {}, own = code(Tidy.ccOfLocale(navigator.language));
    function add(c, n) { c = code(c); if (supported(c)) by[c] = (by[c] || 0) + n; }
    missing.forEach(function (c) {
      var x = countryOf(ctx, c);
      if (!x) { if (own) add(own, 0.5); return; }
      if (ALSO[x]) ALSO[x].forEach(function (o) { add(o, 0.5); }); else add(x, 1);
    });
    return Object.keys(by).filter(function (c) { return by[c] >= MIN_MISSING; }).sort(function (a, b) { return by[b] - by[a]; }).slice(0, AUTO_MAX);
  }

  /* The files to try, lighter first: each country from each project that has it.  Without the
     helper, iptv-epg.org can't be reached (it sends no CORS headers), and a TV that can't unzip
     gets epg.pw's plain files. */
  function files(ccs, helper, gz) {
    // Tests point this at the mock provider (settings.pubEpgBase): <base><source id>/<file>.
    var test = typeof Store !== 'undefined' && Store.settings && Store.settings.pubEpgBase, out = [];
    function url(s, c) { return (test ? String(test).replace(/\/?$/, '/') + s.id + '/' : s.base) + s.file(c, gz !== false); }
    SOURCES.forEach(function (s) {
      if (s.helper && !helper) return;
      ccs.forEach(function (c) { if (s.cc.indexOf(c) >= 0) out.push({ url: url(s, c), cc: c, src: s.id, name: s.name, prefix: s.id + ':' + c + '/' }); });
    });
    return out;
  }
  function sourceOf(id) { var m = /^(\w+):/.exec(id || ''); return m ? SOURCES.filter(function (s) { return s.id === m[1]; })[0] || null : null; }

  return { SOURCES: SOURCES, conf: conf, set: set, keys: keys, countriesFor: countriesFor, countryOf: countryOf, files: files, supported: supported, all: all, name: name, code: code, sourceOf: sourceOf };
})();
if (typeof module !== 'undefined') module.exports = PubEpg;
