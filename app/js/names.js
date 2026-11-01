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

  // Separators between a prefix and the name, including decorative ones ("UK◈ Sky Store", "FR ▶ TF1").
  var SEP = '[|:\\-–—•»▎┃◈◆◇►▶➤✦❖¦⫸]';
  // Country, region and language codes.  The rules need a separator or brackets after them, so
  // names like "USA Network" or "UK Gold" survive.  Codes that are also common words or channel
  // names on their own (ID, SO, ME, AM, IS) are left out.
  var COUNTRY = ['USA', 'US', 'UK', 'GB', 'CA', 'CAN', 'AU', 'AUS', 'NZ', 'IE', 'IRL', 'DE', 'GER', 'FR', 'ES', 'ESP', 'IT', 'ITA',
    'NL', 'PT', 'BR', 'MX', 'LAT', 'LATINO', 'LATAM', 'IN', 'IND', 'PK', 'AR', 'ARAB', 'TR', 'PL', 'SE', 'NO', 'DK', 'FI', 'BE', 'CH',
    'AT', 'GR', 'RO', 'HU', 'CZ', 'SK', 'HR', 'RS', 'BG', 'EXYU', 'EX-YU', 'AFR', 'AFRICA', 'ASIA', 'CARIB', 'PH', 'EN', 'ENG', 'NA', 'INT', 'NORDIC',
    // Americas and the Caribbean
    'CAR', 'ARG', 'CO', 'COL', 'CL', 'CHL', 'PE', 'PER', 'VE', 'VEN', 'EC', 'ECU', 'UY', 'URU', 'PY', 'PAR', 'BO', 'BOL', 'GT', 'GTM', 'HN', 'HND',
    'SV', 'SLV', 'NI', 'NIC', 'CR', 'CRI', 'PA', 'PAN', 'DO', 'DOM', 'RD', 'PR', 'PRI', 'CU', 'CUB', 'JM', 'JAM', 'TT', 'HT', 'HAITI', 'HIS', 'HISP',
    'CA-FR', 'CA-EN', 'FR-CA', 'QC', 'US-ES', 'US-EN', 'MEX', 'BRA', 'POR', 'ITA', 'POL', 'FRA', 'DEU', 'NED', 'SWE', 'NOR', 'DEN', 'FIN', 'BEL', 'SUI', 'AUT',
    // Europe
    'ALB', 'AL', 'MK', 'MKD', 'SI', 'SLO', 'BA', 'BIH', 'MNE', 'SRB', 'CRO', 'BUL', 'ROM', 'HUN', 'CZE', 'SVK', 'GRE', 'CY', 'CYP', 'MT', 'LU', 'LT', 'LTU', 'LV', 'LVA',
    'EE', 'EST', 'ICE', 'RU', 'RUS', 'UA', 'UKR', 'BY', 'BLR', 'MD', 'GE', 'GEO', 'ARM', 'AZ', 'AZE', 'KZ', 'BALKAN', 'BALKANS', 'SCAN', 'BENELUX', 'EU', 'EUR', 'WAL', 'SCO', 'IRE',
    // Asia, the Middle East and Africa
    'AFG', 'AF', 'BD', 'BAN', 'LK', 'SRI', 'NP', 'NEP', 'PAK', 'MY', 'MAL', 'SG', 'SGP', 'INDO', 'TH', 'THA', 'VN', 'VIE', 'KR', 'KOR', 'JP', 'JPN', 'CN', 'CHN', 'HK', 'TW',
    'PHI', 'IL', 'ISR', 'IR', 'IRN', 'IRAN', 'IQ', 'IRQ', 'KU', 'KURD', 'SA', 'KSA', 'AE', 'UAE', 'QA', 'QAT', 'KW', 'KWT', 'BH', 'OM', 'YE', 'EG', 'EGY', 'MA', 'MAR',
    'DZ', 'ALG', 'TN', 'TUN', 'LY', 'LB', 'LBN', 'JO', 'JOR', 'SY', 'SYR', 'PS', 'ZA', 'RSA', 'NG', 'NGA', 'KE', 'KEN', 'GH', 'GHA', 'UG', 'TZ', 'ZW', 'CM', 'SN', 'CI',
    'PERSIAN', 'FARSI', 'KURDISH', 'TURK', 'HINDI', 'TAMIL', 'TELUGU', 'PUNJABI', 'BANGLA', 'URDU', 'ARABIC', 'SOUTH ASIA', 'MENA', 'CARIBBEAN', 'LATIN'];
  var TAGS = ['VIP', 'PPV', '24/7', '24-7', 'RAW', 'LIVE', 'NEW', 'PRIME', 'PREMIUM', 'SPORTS?', '4K', 'UHD', 'FHD', 'HD', 'SD', 'HEVC',
    'LOCALS?', 'NEWS', 'KIDS', 'MOVIES?', 'DOCS?', 'DOCUMENTARY', 'MUSIC', 'ENT', 'ENTERTAINMENT', 'GENERAL', 'RELIGIOUS',
    'DEP', 'DEPORTES', 'CINE', 'CINEMA', 'NOTICIAS', 'INFANTIL', 'NIÑOS', 'MUSICA', 'SERIES', 'NOVELAS', 'ADULTS?', 'XXX', '18\\+', 'RADIO',
    'BACKUP', 'BKP', 'TEST', 'EVENTS?', 'REPLAY', 'HQ', 'GOLD', 'SILVER', 'PLATINUM', 'MAX', 'FHD/HD', 'HD/FHD'];
  // Free streaming services that providers put in front of their channels ("Pluto US | ...", "TUBI | ...").
  var SERVICES = ['PLUTO(?: ?TV)?(?: [A-Z]{2})?', 'TUBI', 'PLEX(?: ?TV)?', 'SAMSUNG(?: ?TV)?(?: ?PLUS)?', 'SAMSUNG TV\\+', 'ROKU(?: ?CHANNEL)?', 'XUMO(?: ?PLAY)?', 'STIRR',
    'DISTRO(?: ?TV)?', 'LOCAL ?NOW', 'LG(?: ?CHANNELS)?', 'VIZIO(?: ?WATCHFREE\\+?)?', 'WATCHFREE\\+?', 'SLING(?: FREE(?:STREAM)?)?', 'FREEVEE', 'REDBOX', 'CRACKLE', 'VIX',
    'HAYSTACK', 'RAKUTEN(?: ?TV)?', 'RUNTIME', 'TCL(?: ?CHANNEL)?', 'FILMRISE', 'GLEWED(?: ?TV)?', 'FAST', 'FUBO', 'PHILO', 'FRNDLY(?: ?TV)?', 'AMAGI', 'WURL'];
  // Notes some providers keep at the end of a name while a channel has nothing on.
  var IDLE = 'off[\\s-]?air|offline|no events? (?:scheduled|today|live)|no event|no live events?|event (?:ended|over|finished)|not live|no stream|stream offline|currently offline|nothing (?:on|scheduled)';
  var IDLE_RE = new RegExp('(?:^|[\\s|:\\-–—•(\\[])(?:' + IDLE + ')\\s*[\\])]?\\s*[.!]?\\s*$', 'i');
  // Empty event slots: the tag and nothing after it ("EPL 02:", "PPV09 |", "NFL Game Pass 3 :"), or the
  // network tag with nothing before it (" :ESPN+  291", " :FOX ONE  20").
  var EMPTY_RE = /^\s*[^|:]{0,30}\d[^|:]{0,6}\s*[:|](?:\s*[:|])*\s*$|^\s*:\s?[A-Za-z][\w+&.' ]{0,24}?\s+\d{1,4}\s*$/;
  // Country codes and names at the end ("CANAL 4 PAN", "BEIN SPORTS 5 (USA)", "TN HD (Argentina)").
  var COUNTRY_WORDS = ['ARGENTINA', 'BRAZIL', 'BRASIL', 'MEXICO', 'MÉXICO', 'COLOMBIA', 'CHILE', 'PERU', 'PERÚ', 'ECUADOR', 'VENEZUELA', 'URUGUAY', 'PARAGUAY', 'BOLIVIA',
    'ESPAÑA', 'SPAIN', 'PORTUGAL', 'FRANCE', 'ITALIA', 'ITALY', 'GERMANY', 'POLAND', 'GREECE', 'TURKEY', 'INDIA', 'PAKISTAN', 'CANADA', 'LATINO AMERICA', 'LATINOAMERICA', 'LATAM',
    'LATIN', 'LATINO', 'ESPAÑOL', 'ENGLISH', 'FRENCH', 'SPANISH', 'ARABIC', 'HINDI'];
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
    { id: 'brackets', label: 'Any short bracketed tag at the ends', on: false, ex: [['[EN] Sky News', 'Sky News'], ['AMC (Backup)', 'AMC']], note: 'Off by default: can remove useful text like (Sports).' },
    { id: 'services', label: 'Free streaming service prefixes', on: false, ex: [['Pluto US | CNN Headlines', 'CNN Headlines'], ['TUBI | ION', 'ION'], ['Samsung TV Plus: Bob Ross', 'Bob Ross']],
      note: 'Off by default: a Pluto or Tubi copy then looks like the real channel.' },
    { id: 'countryEnd', label: 'Country codes and names at the end', on: false, ex: [['CANAL 4 PAN', 'CANAL 4'], ['BEIN SPORTS 5 (USA)', 'BEIN SPORTS 5'], ['TN (Argentina)', 'TN']],
      note: 'Off by default: channels from different countries can end up with the same name.' },
    { id: 'idle', label: 'Status notes at the end', on: false, ex: [['FloHockey 39 - Off Air', 'FloHockey 39'], ['PPV 07 | OFFLINE', 'PPV 07'], ['BigTen 76 | No Event Scheduled', 'BigTen 76']],
      note: 'Off by default: the note tells you nothing is on.  To hide those channels instead, use Hide channels with nothing on.' }
  ];

  function defaults() {
    var r = {};
    RULES.forEach(function (x) { r[x.id] = x.on; });
    return { enabled: true, groups: true, rules: r, prefixes: [], suffixes: [], hideIdle: false };
  }

  function alt(list) { return list.slice().sort(function (a, b) { return b.length - a.length; }).join('|'); }

  function compile(cfg) {
    var pre = [], suf = [], any = [];
    // Rules added in a later version start at their default until you change them.
    var r = {}, given = cfg.rules || {};
    RULES.forEach(function (x) { r[x.id] = given[x.id] != null ? !!given[x.id] : x.on; });
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
    if (r.services) {
      pre.push(new RegExp('^\\s*[\\[(]?\\s*(?:' + SERVICES.join('|') + ')\\s*[\\])]?\\s*' + SEP + '+\\s*', 'i'));
    }
    if (r.countryEnd) {
      var ends = COUNTRY.filter(function (c) { return c.length >= 2 && !/[^A-Z]/.test(c); });
      suf.push(new RegExp('\\s*[\\[(]\\s*(?:' + alt(COUNTRY_WORDS.concat(ends)) + ')\\s*[\\])]\\s*$', 'i'));
      suf.push(new RegExp('(?:\\s+|\\s*' + SEP + '\\s*)(?:' + alt(COUNTRY_WORDS.concat(ends.filter(function (c) { return c.length === 3; }))) + ')\\s*$'));
    }
    if (r.idle) {
      suf.push(new RegExp('(?:\\s*' + SEP + '\\s*|\\s+)[\\[(]?\\s*(?:' + IDLE + ')\\s*[\\])]?\\s*[.!]?\\s*$', 'i'));
    }
    if (r.brackets) {
      pre.push(/^\s*[\[(][^\])]{1,24}[\])]\s*/);
      suf.push(/\s*[\[(][^\])]{1,24}[\])]\s*$/);
    }
    if (r.symbols) {
      // Superscript tags (\u1D34\u1D30), \u2122 \u00AE \u00A9, arrows, circled letters (\u24E7), shapes (\u25C9 \u25A0 \u25C8), sport and weather
      // symbols (\u26BD \u26F9 \u2605), dingbats (\u2714 \u2728), decorative bars (\u2AD8 \u2B2C), emoji and the joiners between them.
      // Runs after the prefix rules, so a symbol used as a separator ("UK\u25C8 Sky Store") goes with its prefix.
      any.push(/[\u02B0-\u02FF\u1D2C-\u1D6A\u1D9B-\u1DBF\u2070-\u209F\u2122\u00AE\u00A9\u2190-\u21FF\u2300-\u23FF\u24B6-\u24FF\u25A0-\u25FF\u2600-\u27BF\u2900-\u297F\u2A00-\u2BFF\u3030\uFE0F\u200D\u20E3\u{1F000}-\u{1FAFF}]+/gu);
      any.push(/\s\*+\s*$|^\s*\*+\s/g);                            // "EL NUEVE SD *"
    }

    var upre = (cfg.prefixes || []).map(function (s) { return String(s).replace(/^\s+/, '').toLowerCase(); })
      .filter(function (s) { return s.trim().length; }).sort(function (a, b) { return b.length - a.length; });
    var usuf = (cfg.suffixes || []).map(function (s) { return String(s).replace(/\s+$/, '').toLowerCase(); })
      .filter(function (s) { return s.trim().length; }).sort(function (a, b) { return b.length - a.length; });

    function ok(s) { return /[^\s\d|:\-–—•»()[\]]/.test(s); }   // has at least one real character
    function tidy(s) { return s.replace(/\s{2,}/g, ' ').replace(/^[\s|:\-–—•»/]+|[\s|:\-–—•»/]+$/g, ''); }

    // A removed symbol leaves a space, except right before punctuation ("2026™: Pitch" -> "2026: Pitch").
    function gap(m, off, str) { return /^[:,;.!?)\]]/.test(str.charAt(off + m.length)) ? '' : ' '; }

    var memo = new Map();
    function clean(name) {
      if (!name) return name || '';
      var hit = memo.get(name);
      if (hit !== undefined) return hit;
      var s = name, i, next;
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
        for (i = 0; i < any.length; i++) { next = s.replace(any[i], gap); if (next !== s) { next = tidy(next); if (ok(next)) s = next; } }
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
    COUNTRY: COUNTRY,
    parseList: parseList, joinList: joinList,
    groupsOn: function () { var c = cfgOf(); return c.enabled && c.groups; },
    // "Hide channels with nothing on": a channel whose name says it is off air, offline or has no
    // event scheduled.  Checked on the name the provider sends now, so it comes back by itself as
    // soon as the provider names an event on it.
    idle: function (n) { return IDLE_RE.test(n || '') || EMPTY_RE.test(n || ''); },
    empty: function (n) { return EMPTY_RE.test(n || ''); },
    hideIdle: function () { return !!cfgOf().hideIdle; }
  };
})();
if (typeof module !== 'undefined') module.exports = Names;
