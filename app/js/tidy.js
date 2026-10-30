/* Smart clean-up engine, shared by the TV (the first-run tour) and the web editor (Smart clean-up).
   It only reads the provider's list and answers questions about it; hiding is done by the caller.
     var t = Tidy.make({ groups: [...], channels: [...] });
     t.countries()     groups by country, read from names, channel prefixes and divider sections
     t.dividers()      "⫘⫘⫘ UK ⫘⫘⫘" groups that only split the list into sections
     t.feeds()         channels that come in both an East and a West feed
     t.locals()        local stations by city ("CBS | DENVER | KCNC")
     t.dupes(opts)     the same channel more than once (4K, FHD, HD, SD copies)
   Runs on old TVs (Chromium 53), which cannot read Unicode property classes in regular expressions, so LET below stands in for "any letter". */
var Tidy = (function () {
  'use strict';

  // Letters in the scripts provider lists use (Latin, Greek, Cyrillic, Hebrew, Arabic, Indic, Thai, CJK, Hangul).
  var LET = 'A-Za-z\\u00AA\\u00B5\\u00BA\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02AF\\u0370-\\u03FF\\u0400-\\u052F\\u0531-\\u058F\\u05D0-\\u05EA' +
    '\\u0620-\\u064A\\u066E-\\u06D3\\u0900-\\u0DFF\\u0E00-\\u0E7F\\u1100-\\u11FF\\u1E00-\\u1FFF\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF';
  var LN = LET + '0-9';
  var DIVIDER_RE = new RegExp('^\\s*[^' + LN + '\\s]{2,}.*[^' + LN + '\\s]{2,}\\s*$|^\\s*[-=#*~_•·]{3,}');
  var PLAIN_RE = new RegExp('[^' + LN + '\\s|:\\[\\]()\\/&+-]+', 'g');
  var WORD_RE = new RegExp('[^' + LN + '\\s\\/-]+', 'g');
  var CITY_JUNK_RE = new RegExp('[^' + LET + "\\s.'&-]", 'g');
  var TITLE_RE = new RegExp("(^|[\\s\\-'])[" + LET + ']', 'g');

  /* ---------- names to match on ---------- */
  var STOP = { hd: 1, fhd: 1, uhd: 1, sd: 1, '4k': 1, '8k': 1, hevc: 1, h264: 1, h265: 1, raw: 1, backup: 1, bk: 1, vip: 1, hq: 1, lq: 1, fps: 1, '50fps': 1, '60fps': 1, '1080p': 1, '720p': 1, '1080': 1, '720': 1, live: 1, channel: 1, the: 1, tv: 1 };
  var COUNTRY = { us: 'us', usa: 'us', uk: 'uk', gb: 'uk', ca: 'ca', can: 'ca', au: 'au', nz: 'nz', ie: 'ie', de: 'de', ger: 'de', fr: 'fr', es: 'es', it: 'it', pt: 'pt', nl: 'nl', be: 'be', ch: 'ch', at: 'at', se: 'se', no: 'no', dk: 'dk', fi: 'fi', pl: 'pl', br: 'br', mx: 'mx', ar: 'ar', in: 'in', ind: 'in', za: 'za', tr: 'tr', gr: 'gr', ro: 'ro', ru: 'ru', ae: 'ae', ph: 'ph', latino: 'mx' };
  // A name reduced to what identifies it: "USA | A&E (WEST) FHD" -> { c: 'aande', country: 'us', west: true }.
  function prep(name) {
    var s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), country = '', flags = {};
    var m = /^\s*[\[(]?([a-z]{2,3})[\])]?\s*(?:[|:\-–»]+|\s)\s*/.exec(s);
    if (m && COUNTRY[m[1]]) { country = COUNTRY[m[1]]; s = s.slice(m[0].length); }
    s = s.replace(/[\[(]([^\])]*)[\])]/g, function (a, inner) { inner.split(/\W+/).forEach(function (w) { if (w === 'east' || w === 'west' || w === 'pacific') flags[w === 'pacific' ? 'west' : w] = 1; else if (COUNTRY[w] && !country) country = COUNTRY[w]; }); return ' '; });
    s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ');
    var toks = s.split(/[^a-z0-9]+/).filter(Boolean), out = [];
    toks.forEach(function (w, i) {
      if (w === 'east' || w === 'west' || w === 'pacific') { flags[w === 'pacific' ? 'west' : w] = 1; return; }
      if (COUNTRY[w] && (i === toks.length - 1 || i === 0) && toks.length > 1) { if (!country) country = COUNTRY[w]; return; }
      if (STOP[w]) return;
      out.push(w);
    });
    var call = out.filter(function (w) { return /^[kw][a-z]{2,3}$/.test(w) && !/[aeiou]{2}/.test(w); })[0] || '';
    return { t: out, c: out.join(''), country: country, east: !!flags.east, west: !!flags.west, call: call, nums: out.filter(function (w) { return /^\d+$/.test(w); }).join(',') };
  }

  /* ---------- countries ----------
     Providers say it in different ways, so in order: a code at the start of the group name
     ("US| News", "[UK] Sports"); a country word ("Canada News", "France Cinema", "Latino / Mexico");
     a code most of its channels start with ("CAR | ...", "ARG | ..."); and last, the divider group it
     sits under ("⫘⫘⫘ CAN ⫘⫘⫘" then "TSN +"). */
  var CC_ALIAS = { USA: 'US', CAN: 'CA', AUS: 'AU', GB: 'UK', GBR: 'UK', ENG: 'UK', ARG: 'AR', COL: 'CO', CAR: 'CARIB', MEX: 'MX', BRA: 'BR', AFG: 'AF', PAK: 'PK', IND: 'IN',
    ESP: 'ES', ITA: 'IT', FRA: 'FR', GER: 'DE', DEU: 'DE', POR: 'PT', POL: 'PL', GRE: 'GR', NED: 'NL', SWE: 'SE', NOR: 'NO', DEN: 'DK', FIN: 'FI', BEL: 'BE', SUI: 'CH', AUT: 'AT',
    LATAM: 'LAT', LATINO: 'LAT', HIS: 'LAT', HISP: 'LAT', IRL: 'IE', TUR: 'TR', ROM: 'RO', RUS: 'RU', UKR: 'UA', PHI: 'PH', 'CA-FR': 'CA', 'CA-EN': 'CA', 'FR-CA': 'CA', QC: 'CA',
    'US-ES': 'US', 'US-EN': 'US', 'EX-YU': 'EXYU', KSA: 'SA', UAE: 'AE', RSA: 'ZA', CRI: 'CR', PRI: 'PR', DOM: 'DO', CHL: 'CL', PER: 'PE', VEN: 'VE', ECU: 'EC' };
  var CC_WORDS = { 'united states': 'US', america: 'US', usa: 'US', us: 'US', canada: 'CA', canadian: 'CA', can: 'CA', 'united kingdom': 'UK', uk: 'UK', britain: 'UK', british: 'UK', england: 'UK',
    scotland: 'UK', ireland: 'IE', irish: 'IE', australia: 'AU', aus: 'AU', 'aus/nz': 'AU', 'new zealand': 'NZ', nz: 'NZ', france: 'FR', french: 'FR', italy: 'IT', italia: 'IT', italian: 'IT',
    germany: 'DE', deutschland: 'DE', german: 'DE', spain: 'ES', espana: 'ES', 'españa': 'ES', spanish: 'ES', portugal: 'PT', portuguese: 'PT', brazil: 'BR', brasil: 'BR', mexico: 'MX', 'méxico': 'MX',
    poland: 'PL', polska: 'PL', polish: 'PL', greece: 'GR', greek: 'GR', turkey: 'TR', turkish: 'TR', netherlands: 'NL', holland: 'NL', dutch: 'NL', belgium: 'BE', sweden: 'SE', swedish: 'SE',
    norway: 'NO', denmark: 'DK', finland: 'FI', nordic: 'NORDIC', scandinavia: 'NORDIC', switzerland: 'CH', austria: 'AT', india: 'IN', indian: 'IN', pakistan: 'PK', afghanistan: 'AF',
    bangladesh: 'BD', 'sri lanka': 'LK', nepal: 'NP', 'south asia': 'IN', philippines: 'PH', filipino: 'PH', pinoy: 'PH', argentina: 'AR', colombia: 'CO', columbia: 'CO', chile: 'CL', peru: 'PE',
    venezuela: 'VE', ecuador: 'EC', 'costa rica': 'CR', 'puerto rico': 'PR', dominican: 'DO', caribbean: 'CARIB', jamaica: 'JM', latino: 'LAT', latin: 'LAT', latam: 'LAT', 'lat/his': 'LAT',
    hispanic: 'LAT', arabic: 'ARAB', arab: 'ARAB', africa: 'AFRICA', african: 'AFRICA', 'south africa': 'ZA', nigeria: 'NG', israel: 'IL', iran: 'IR', persian: 'IR', russia: 'RU', russian: 'RU',
    ukraine: 'UA', romania: 'RO', albania: 'AL', 'ex-yu': 'EXYU', exyu: 'EXYU', balkans: 'EXYU', balkan: 'EXYU', hungary: 'HU', czech: 'CZ', bulgaria: 'BG', croatia: 'HR', serbia: 'RS',
    malaysia: 'MY', japan: 'JP', korea: 'KR', china: 'CN', chinese: 'CN', vietnam: 'VN', thailand: 'TH', indonesia: 'ID' };
  var CC_NAME = { US: 'USA', CA: 'Canada', UK: 'UK', IE: 'Ireland', AU: 'Australia', NZ: 'New Zealand', FR: 'France', IT: 'Italy', DE: 'Germany', ES: 'Spain', PT: 'Portugal', BR: 'Brazil',
    MX: 'Mexico', PL: 'Poland', GR: 'Greece', TR: 'Turkey', NL: 'Netherlands', IN: 'India and South Asia', PK: 'Pakistan', AF: 'Afghanistan', PH: 'Philippines', AR: 'Argentina', CO: 'Colombia',
    CR: 'Costa Rica', PR: 'Puerto Rico', CARIB: 'Caribbean', LAT: 'Latino', ARAB: 'Arabic', EXYU: 'Ex-Yu', NORDIC: 'Nordic', AFRICA: 'Africa', MY: 'Malaysia', CL: 'Chile', PE: 'Peru',
    BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', RO: 'Romania', RU: 'Russia', UA: 'Ukraine', HU: 'Hungary', CZ: 'Czechia',
    BG: 'Bulgaria', HR: 'Croatia', RS: 'Serbia', AL: 'Albania', IL: 'Israel', IR: 'Iran', ZA: 'South Africa', NG: 'Nigeria', JM: 'Jamaica', DO: 'Dominican Republic', VE: 'Venezuela',
    EC: 'Ecuador', SA: 'Saudi Arabia', AE: 'UAE', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal', JP: 'Japan', KR: 'Korea', CN: 'China', VN: 'Vietnam', TH: 'Thailand', ID: 'Indonesia' };
  var CC_KNOWN = {};
  [CC_NAME, CC_ALIAS, CC_WORDS].forEach(function (m) { Object.keys(m).forEach(function (k) { CC_KNOWN[m === CC_NAME ? k : m[k]] = 1; }); });
  // The TV's own region ("en-US", "fr-CA") in the codes above.
  function ccOfLocale(lang) { var m = /[-_]([A-Za-z]{2})\b/.exec(String(lang || '')); return m ? ccNorm(m[1] === 'GB' ? 'UK' : m[1]) : ''; }
  // A code only counts when it is a country or region we know, so "NBC Locals" or "NFL Teams" are not countries.
  function ccNorm(code) { code = String(code || '').toUpperCase(); code = CC_ALIAS[code] || code; return CC_KNOWN[code] ? code : ''; }
  function prefixOf(name) { var m = /^\s*[\[(]?([A-Z]{2,3}|[A-Z]{2}-[A-Z]{2})[\])]?\s*(?:[|:\-–»•]+|\s(?=[A-Z0-9]))/.exec(name || ''); return m ? m[1] : ''; }
  function ccWord(name) {
    var w = String(name || '').toLowerCase().replace(WORD_RE, ' ').replace(/\s+/g, ' ').trim();
    if (CC_WORDS[w]) return CC_WORDS[w];
    var t = w.split(' ');
    if (t.length > 1 && CC_WORDS[t[0] + ' ' + t[1]]) return CC_WORDS[t[0] + ' ' + t[1]];
    if (CC_WORDS[t[0]] && t[0].length > 2) return CC_WORDS[t[0]];
    var last = t[t.length - 1];                                    // "Pluto USA", "Sky Sports UK"
    if (t.length > 1 && CC_WORDS[last] && last.length > 1) return CC_WORDS[last];
    return '';
  }
  function isDivider(name) { return DIVIDER_RE.test(String(name || '')); }
  function countryName(code) { return CC_NAME[code] || code; }

  /* ---------- East and West feeds ----------
     "HBO (EAST)" and "HBO (WEST)", "A&E" and "A&E (WEST)", groups like "USA WEST".  A channel's feed
     comes from its name (EAST, WEST or PACIFIC as a word or in brackets at the end; "(E)" and "(W)"
     only when the other feed exists, since "(W)" is also women's sport), or else from its group.
     Unmarked channels count as East when a West copy exists. */
  var FEED_RE = /\s*(?:[\[(]\s*(east|west|pacific|e|w)\s*[\])]|[-|:]?\s+\b(east|west|pacific)\b)\s*$/i;
  function feedOf(name) {
    var m = FEED_RE.exec(String(name || '')); if (!m) return null;
    var f = (m[1] || m[2]).toLowerCase();
    return { feed: f === 'east' || f === 'e' ? 'east' : 'west', short: f.length === 1, base: String(name).slice(0, m.index) };
  }
  /* The key a logo is looked up by: the name reduced like prep(), with a time zone feed at the end
     dropped ("HBO (West)" is HBO's logo) but East and West inside a name kept ("Wild West TV"). */
  function logoKey(name) {
    var f = feedOf(name), base = String(f ? f.base : name || '');
    return prep(base.replace(/\b(east|west|pacific)\b/gi, '$1qq')).c.replace(/(east|west|pacific)qq/g, '$1');
  }
  function groupFeed(name) { var m = /\b(east|west|pacific)\b/i.exec(String(name || '')); return m ? (m[1].toLowerCase() === 'east' ? 'east' : 'west') : ''; }

  /* ---------- local channels ----------
     "CBS | DENVER | KCNC", "US: PBS - CT - HARTFORD (WEDH)", "CW | BOSTON 56 WLVI", "TELEMUNDO | CHICAGO",
     "CA | CTV 2 WINDSOR".  The city is what is left once the country tag, the network, the state code,
     the call sign and channel numbers are taken out. */
  var LOCAL_NETS = ['ABC', 'CBS', 'NBC', 'FOX', 'CW', 'PBS', 'MYTV', 'MY TV', 'MYNETWORKTV', 'MNT', 'ION', 'TELEMUNDO', 'UNIVISION', 'UNIMAS', 'GALAVISION', 'ESTRELLA', 'AZTECA', 'TELEMUNDO LOCAL',
    'CBC', 'CTV 2', 'CTV2', 'CTV', 'GLOBAL', 'CITYTV', 'CITY', 'OMNI', 'ROGERS TV', 'TVA', 'NOOVO', 'ICI RADIO-CANADA', 'RADIO-CANADA', 'ICI', 'INDEPENDENT', 'IND', 'METV', 'MeTV', 'ANTENNA TV', 'COZI', 'BOUNCE'];
  var LOCAL_NET_RE = new RegExp('^(' + LOCAL_NETS.slice().sort(function (a, b) { return b.length - a.length; }).map(function (n) { return n.replace(/[-]/g, '\\-'); }).join('|') + ')\\b\\s*', 'i');
  var CALL_RE = /\b[KW][A-Z]{2,3}(?:[-\s]?(?:TV|DT|LD|CD|LP))?\b/g;
  function parseLocal(name) {
    var s = String(name || '').replace(/^\s*(?:[\[(|]?\s*(?:USA|US|CA|CAN)\s*[\])|]?\s*[|:\-]\s*)/i, '').trim();
    var nm = LOCAL_NET_RE.exec(s); if (!nm) return null;
    var net = nm[1].toUpperCase().replace(/\s+/g, ' ');
    var rest = s.slice(nm[0].length).replace(/^[\s|:\-–]+/, '');
    var call = (rest.match(CALL_RE) || [])[0] || '';
    var st = '', m = /^([A-Z]{2})\s*-\s*(.+)$/.exec(rest);
    if (m) { st = m[1]; rest = m[2]; }
    var city = rest.replace(/\([^)]*\)/g, ' ').replace(CALL_RE, ' ').split(/\s*[|]\s*/)[0]
      .replace(/\b(?:HD|FHD|SD|4K)\b/gi, ' ').replace(/\b\w*\d\w*\b/g, ' ').replace(new RegExp('\\b' + net + '\\b', 'i'), ' ')
      .replace(CITY_JUNK_RE, ' ').replace(/\s+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '').toUpperCase();
    if (!city || city.length < 3 || /^(EAST|WEST|PACIFIC|NATIONAL|NETWORK|NEWS|NEWS NOW|NOW|LIVE|SPORTS|PLUS|HD|CHANNEL|KIDS|LOCAL|LOCALS)$/.test(city)) return { net: net, city: '', st: st, call: call };
    city = city.replace(/^SAINT\b/, 'ST').replace(/^ST\.\s*/, 'ST ').replace(/^FT\.?\s/, 'FORT ');
    return { net: net, city: city, st: st, call: call };
  }
  function isLocalGroup(name) { return /\blocals?\b|\baffiliates?\b|\bnetwork (?:locals|stations)\b/i.test(String(name || '')); }
  function titleCase(s) { return String(s).toLowerCase().replace(TITLE_RE, function (m) { return m.toUpperCase(); }); }

  /* ---------- quality ---------- */
  var QUAL = [[/\b(8k|4k|uhd|2160p?)\b/i, 4], [/\b(fhd|1080[pi]?|full ?hd)\b/i, 3], [/\b(hd|720p?)\b/i, 2], [/\b(sd|480p?|576p?|lq)\b/i, 1]];
  function quality(n) { for (var i = 0; i < QUAL.length; i++) if (QUAL[i][0].test(n)) return QUAL[i][1]; return 2.5; }
  var QNAME = { 4: '4K', 3: 'FHD', 2: 'HD', 1: 'SD', 2.5: 'unmarked' };
  var RANK = {
    best: function (q) { return q; },
    fhd: function (q) { return q === 3 ? 9 : q === 2 ? 8 : q === 2.5 ? 7 : q === 4 ? 6 : q; },
    hd: function (q) { return q === 2 ? 9 : q === 2.5 ? 8 : q === 3 ? 7 : q === 1 ? 6 : q; },
    sd: function (q) { return q === 1 ? 9 : q === 2 ? 8 : q === 2.5 ? 7 : q; }
  };

  // Names cleaned with the default rules, so the answers do not change with the user's own name settings.
  var cleaner = null;
  function cleanDefault(n) {
    if (!cleaner) cleaner = typeof Names !== 'undefined' ? Names.compile(Names.defaults()) : function (x) { return x; };
    return cleaner(n);
  }

  /* ---------- one playlist ---------- */
  function make(data) {
    var groups = data.groups || [], channels = data.channels || [], byGroup = {}, cache = {};
    channels.forEach(function (c) { (byGroup[c.g] || (byGroup[c.g] = [])).push(c); });
    function chansOf(gid) { return byGroup[gid] || []; }
    function once(k, fn) { return k in cache ? cache[k] : (cache[k] = fn()); }

    function countryMap() {
      return once('cc', function () {
        var m = {}, section = '', sec = 0, secOf = {}, own = {};
        groups.forEach(function (g) {
          var plain = String(g.name || '').replace(PLAIN_RE, ' ').trim();
          if (isDivider(g.name)) { section = ccNorm(prefixOf(plain + ' ')) || ccWord(plain); m[g.id] = section; sec++; return; }
          secOf[g.id] = sec;
          var code = ccNorm(prefixOf(plain)) || ccWord(plain);
          if (!code) {
            var by = {}, chans = chansOf(g.id);
            chans.forEach(function (c) { var x = /^\s*[\[(|]?\s*([A-Z]{2,4}(?:-[A-Z]{2})?)\s*[\])|]?\s*[|:\-–◈]/.exec(c.n || ''); if (x) { var k = ccNorm(x[1]); if (k) by[k] = (by[k] || 0) + 1; } });
            var best = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0];
            if (best && chans.length >= 3 && by[best] >= chans.length * 0.6) code = best;
          }
          own[g.id] = code;
          m[g.id] = code || section;
        });
        // A section without a country in its divider (or the groups before the first divider) takes the
        // country most of its groups name, when that is clear: "ABC Locals" among "USA EAST", "USA News"...
        var tally = {};
        Object.keys(secOf).forEach(function (id) { var t = tally[secOf[id]] || (tally[secOf[id]] = { n: 0, by: {} }); t.n++; if (own[id]) t.by[own[id]] = (t.by[own[id]] || 0) + 1; });
        Object.keys(secOf).forEach(function (id) {
          if (m[id]) return;
          var t = tally[secOf[id]], coded = 0, best = '';
          Object.keys(t.by).forEach(function (k) { coded += t.by[k]; if (!best || t.by[k] > t.by[best]) best = k; });
          if (best && t.by[best] >= 3 && t.by[best] >= coded * 0.6 && coded >= t.n * 0.4) m[id] = best;
        });
        return m;
      });
    }
    function groupCountry(gid) { return countryMap()[gid] || ''; }
    // Countries with their groups and channel counts, biggest first.  hidden: { gid: 1 } to count what is shown.
    function countries(hidden) {
      var by = {}, cm = countryMap(); hidden = hidden || {};
      groups.forEach(function (g) {
        var p = cm[g.id]; if (!p) return;
        var x = by[p] || (by[p] = { p: p, name: countryName(p), groups: [], shown: 0, chans: 0 });
        x.groups.push(g.id); if (!hidden[g.id]) x.shown++; x.chans += chansOf(g.id).length;
      });
      return Object.keys(by).map(function (k) { return by[k]; }).filter(function (x) { return x.groups.length >= 2 || CC_NAME[x.p]; }).sort(function (a, b) { return b.chans - a.chans; });
    }
    // Divider groups: "⫘⫘⫘ UK ⫘⫘⫘", "===== SPORTS =====", holding a placeholder channel or none.
    function dividers() { return once('dv', function () { return groups.filter(function (g) { return isDivider(g.name) && chansOf(g.id).length <= 3; }); }); }
    function empty() { return once('em', function () { return groups.filter(function (g) { return !chansOf(g.id).length; }); }); }

    function feedKey(name) { var p = prep(cleanDefault(name)); return p.c ? p.c + (p.country ? '|' + p.country : '') : ''; }
    function feeds() {
      return once('fd', function () {
        var by = {}, gf = {};
        groups.forEach(function (g) { gf[g.id] = groupFeed(g.name); });
        channels.forEach(function (c) {
          var f = feedOf(c.n), feed = f ? f.feed : gf[c.g] || '', key = feedKey(f ? f.base : c.n);
          if (!key) return;
          var x = by[key] || (by[key] = { east: [], west: [], plain: [], short: [] });
          if (f && f.short) x.short.push({ c: c, feed: feed }); else if (feed) x[feed].push(c); else x.plain.push(c);
        });
        var r = { east: [], west: [], pairs: 0, examples: [] };
        Object.keys(by).forEach(function (k) {
          var x = by[k], sw = [], se = [];
          x.short.forEach(function (o) { (o.feed === 'west' ? sw : se).push(o.c); });
          var west = x.west.concat(sw), east = x.east.concat(x.plain, se);
          if (!west.length || !east.length) return;                         // only one feed: nothing to choose
          r.pairs++; r.west = r.west.concat(west); r.east = r.east.concat(east);
          if (r.examples.length < 6) r.examples.push({ east: east[0], west: west[0] });
        });
        return r;
      });
    }
    function feedGroups(feed) { return groups.filter(function (g) { return groupFeed(g.name) === feed && chansOf(g.id).length; }); }

    function locals() {
      return once('lc', function () {
        var lg = groups.filter(function (g) { return isLocalGroup(g.name); }), cities = {}, chans = [];
        lg.forEach(function (g) {
          chansOf(g.id).forEach(function (c) {
            var p = parseLocal(c.n); if (!p) return;
            chans.push({ c: c, p: p });
            if (!p.city) return;
            var x = cities[p.city] || (cities[p.city] = { city: p.city, nets: {}, n: 0, st: p.st });
            x.nets[p.net] = 1; x.n++; if (!x.st && p.st) x.st = p.st;
          });
        });
        lg = lg.filter(function (g) { return chans.some(function (x) { return x.c.g === g.id; }); });
        return { groups: lg, chans: chans, cities: Object.keys(cities).map(function (k) { return cities[k]; }).sort(function (a, b) { return a.city < b.city ? -1 : a.city > b.city ? 1 : 0; }) };
      });
    }
    // Local stations to hide when keeping only these cities.  keepNoCity: keep stations with no city (national feeds).
    function localHide(sel, keepNoCity) { return locals().chans.filter(function (x) { return x.p.city ? !sel[x.p.city] : !keepNoCity; }); }
    // The stations kept for the picked cities, by city, network and channel number: what goes in a "Local channels" group.
    function localKeep(sel, keepNoCity) {
      function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
      return locals().chans.filter(function (x) { return x.p.city ? !!sel[x.p.city] : keepNoCity; })
        .sort(function (a, b) { return cmp(a.p.city || '~', b.p.city || '~') || cmp(String(a.p.net), String(b.p.net)) || (a.c.num || 0) - (b.c.num || 0); });
    }

    /* The same channel more than once.  opts: { same: only within one group, prefer: fhd|best|hd|sd,
       name(c): the name shown, skip(c): leave out (hidden ones) }. */
    function dupes(opts) {
      opts = opts || {};
      var by = {}, name = opts.name || function (c) { return cleanDefault(c.n); }, rank = RANK[opts.prefer || 'fhd'] || RANK.fhd;
      channels.forEach(function (c) {
        if (opts.skip && opts.skip(c)) return;
        var p = prep(name(c)); if (!p.c || p.c.length < 2) return;
        var key = (opts.same !== false ? c.g + '|' : '') + p.c + (p.west ? '|w' : '') + (p.country ? '|' + p.country : '');
        (by[key] || (by[key] = [])).push(c);
      });
      var sets = [];
      Object.keys(by).forEach(function (k) {
        var a = by[k]; if (a.length < 2) return;
        a = a.slice().sort(function (x, y) { return rank(quality(y.n)) - rank(quality(x.n)) || (y.arch || 0) - (x.arch || 0) || (+x.num || 0) - (+y.num || 0); });
        sets.push({ keep: a[0].k, items: a });
      });
      return sets.sort(function (x, y) { return String(name(x.items[0])).localeCompare(name(y.items[0])); });
    }

    return { data: data, chansOf: chansOf, countryMap: countryMap, groupCountry: groupCountry, countries: countries, dividers: dividers, empty: empty,
      feeds: feeds, feedGroups: feedGroups, feedKey: feedKey, locals: locals, localHide: localHide, localKeep: localKeep, dupes: dupes };
  }

  return { make: make, prep: prep, prefixOf: prefixOf, ccNorm: ccNorm, ccWord: ccWord, ccOfLocale: ccOfLocale, countryName: countryName, isDivider: isDivider,
    feedOf: feedOf, groupFeed: groupFeed, logoKey: logoKey, parseLocal: parseLocal, isLocalGroup: isLocalGroup, titleCase: titleCase, quality: quality, QNAME: QNAME,
    cleanDefault: cleanDefault, CC_NAME: CC_NAME, COUNTRY: COUNTRY, STOP: STOP };
})();
if (typeof module !== 'undefined') module.exports = Tidy;
