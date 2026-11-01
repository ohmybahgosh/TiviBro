/* Movie and show languages and what shows, shared by the app (vod.js) and the helper (service/vod.js,
   which keeps the full lists on the TV's storage and hands the app only what is shown).  Plain ES5. */
var VodView = (function () {
  'use strict';
  /* Languages.  Many providers put a language or country code in front of every title
     ("SE - The Dog Stars", "SE-4K - Mutiny", "[SE] Nocturne", "EN - ...").  The code is taken off the
     name, kept as the title's language, and a 4K tag next to it becomes a 4K label. */
  var N = typeof Names !== 'undefined' ? Names : require('./names.js');
  var CODES = (function () { var o = { EN: 1, ENG: 1 }; (N.COUNTRY || []).forEach(function (c) { o[c] = 1; }); return o; })();
  // A code in front of the title: "EN - ", "SE-4K - ", "IN-TM- ", "4K-SC - ", "EN| ", "[SE] ".
  var PRE = /^\s*(?:\[([A-Za-z]{1,3})\]\s*|([A-Z0-9+]{1,4}(?:-[A-Z0-9+]{1,4})*)\s*(?:[|:]|-\s|\s[-–])\s*)(?=\S)/;
  // Parts of a code that are not a language: quality, services (Netflix, Apple TV+), sport, cam copies.
  var NOTLANG = { '4K': 'q', UHD: 'q', FHD: 1, HD: 1, SD: 1, HEVC: 1, NF: 1, 'A+': 1, TOP: 1, CAM: 1, SPT: 1, WC: 1, X: 1, MULTI: 1, SUB: 1, SUBS: 1, DUB: 1, NEW: 1, VIP: 1 };
  // A code counts as a language only when the provider uses it this often; fewer, and it was part of the title.
  var MIN_KNOWN = 10, MIN_UNKNOWN = 20;
  var ALIAS = { ENG: 'EN', SCA: 'SC', SWE: 'SE', GER: 'DE', DEU: 'DE', FRA: 'FR', ESP: 'ES', ITA: 'IT', NED: 'NL', POR: 'PT', POL: 'PL', TUR: 'TR', NOR: 'NO', DEN: 'DK', FIN: 'FI',
    ARAB: 'AR', ARA: 'AR', RUS: 'RU', IND: 'IN', USA: 'US', GB: 'UK', BRA: 'BR', MEX: 'MX', GRE: 'GR', ROM: 'RO', HUN: 'HU', CZE: 'CZ', KOR: 'KR', JPN: 'JP', CHN: 'CN' };
  var LABEL = { EN: 'English', US: 'English (US)', UK: 'English (UK)', CA: 'Canada', AU: 'Australia', SE: 'Swedish', NO: 'Norwegian', DK: 'Danish', FI: 'Finnish', NL: 'Dutch',
    BE: 'Belgian', DE: 'German', AT: 'Austrian', CH: 'Swiss', FR: 'French', ES: 'Spanish', LAT: 'Latino', MX: 'Mexican', IT: 'Italian', PT: 'Portuguese', BR: 'Brazilian',
    PL: 'Polish', TR: 'Turkish', AR: 'Arabic', IN: 'Indian', PK: 'Pakistani', RU: 'Russian', UA: 'Ukrainian', GR: 'Greek', RO: 'Romanian', HU: 'Hungarian', CZ: 'Czech',
    SK: 'Slovak', HR: 'Croatian', RS: 'Serbian', BG: 'Bulgarian', AL: 'Albanian', EXYU: 'Ex-Yu', KR: 'Korean', JP: 'Japanese', CN: 'Chinese', PH: 'Filipino', IR: 'Persian',
    KU: 'Kurdish', IL: 'Hebrew', TH: 'Thai', VN: 'Vietnamese', AFR: 'African', NORDIC: 'Nordic', SC: 'Scandinavian', SCA: 'Scandinavian', QFR: 'Québécois', QC: 'Québécois',
    TM: 'Tamil', TA: 'Tamil', TE: 'Telugu', TG: 'Telugu', TL: 'Telugu', ML: 'Malayalam', KN: 'Kannada', KD: 'Kannada', BN: 'Bengali', UR: 'Urdu', MR: 'Marathi', PB: 'Punjabi', PU: 'Punjabi', GU: 'Gujarati' };
  // Codes that mean the TV's own language, from its menu language and country (navigator.language).
  var LOCALE = { en: ['EN', 'US', 'UK', 'CA', 'AU', 'NZ', 'IE', 'INT', 'CA-EN', 'US-EN'], sv: ['SE', 'NORDIC', 'SCAN'], nb: ['NO', 'NORDIC'], no: ['NO', 'NORDIC'], da: ['DK', 'NORDIC'],
    fi: ['FI', 'NORDIC'], nl: ['NL', 'BE', 'BENELUX'], de: ['DE', 'AT', 'CH'], fr: ['FR', 'BE', 'CH', 'CA-FR', 'FR-CA', 'QC'], es: ['ES', 'LAT', 'LATINO', 'LATAM', 'MX', 'US-ES', 'HIS', 'HISP'],
    it: ['IT'], pt: ['PT', 'BR'], pl: ['PL'], tr: ['TR', 'TURK'], ar: ['AR', 'MENA'], hi: ['IN', 'HINDI'], ru: ['RU'], uk: ['UA'], el: ['GR'], ro: ['RO'], hu: ['HU'], cs: ['CZ'],
    sk: ['SK'], hr: ['HR', 'EXYU', 'BALKAN'], sr: ['RS', 'EXYU', 'BALKAN'], bg: ['BG'], ko: ['KR'], ja: ['JP'], zh: ['CN', 'HK', 'TW'], he: ['IL'], fa: ['IR', 'PERSIAN', 'FARSI'] };
  function tag(it) {
    it.lang = '';
    var m = PRE.exec(it.name);
    if (!m) return it;
    if (m[1]) {
      if (m[1].toUpperCase() === 'X') { it.adult = 1; return it; }
      var b = ALIAS[m[1].toUpperCase()] || m[1].toUpperCase();
      if (CODES[b] || LABEL[b]) { it.p = m[0]; it.name = it.name.slice(m[0].length); it.lang = b; }
      return it;
    }
    var parts = m[2].split('-'), lang = '', q = '';
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i];
      if (NOTLANG[c]) { if (NOTLANG[c] === 'q') q = '4K'; else if (!lang) return it; continue; }   // "NF - ", "SPT - ": a service, leave the name
      if (!lang && /^[A-Z]{2,3}$/.test(c)) lang = ALIAS[c] || c;
    }
    if (!lang && !q) return it;
    it.p = m[0]; it.name = it.name.slice(m[0].length); it.lang = lang;
    if (q) it.q = q;
    return it;
  }
  function known(c) { return !!(CODES[c] || LABEL[c]); }
  function langName(c) { return c ? (LABEL[c] ? LABEL[c] + '  ' + c : c) : 'No language tag'; }
  // Which languages show: the ones picked in Languages, or by default the TV's own language plus
  // untagged titles.  Everything shows when the library has one language, or the TV's matches little.
  function shownLangs(counts, total, picked, navLang) {
    var codes = Object.keys(counts).filter(Boolean);
    if (codes.length < 2) return null;
    var keep = {};
    if (Array.isArray(picked)) { picked.forEach(function (c) { keep[c] = 1; }); return keep; }
    var loc = String(navLang || 'en-US').split('-'), want = {};
    (LOCALE[loc[0].toLowerCase()] || []).forEach(function (c) { want[c] = 1; });
    if (loc[1]) want[loc[1].toUpperCase()] = 1;
    keep[''] = 1; codes.forEach(function (c) { if (want[c]) keep[c] = 1; });
    var n = Object.keys(keep).reduce(function (a, c) { return a + (counts[c] || 0); }, 0);
    return n >= Math.min(200, total * 0.05) ? keep : null;
  }
  // Adult categories stay out of All and Search; they are listed last and ask for the PIN if one is set.
  var ADULT = /\b(adults?|xxx|porn|erotic|18\s?\+|\+\s?18)(?![a-z])/i;
  /* opts: picked (the languages chosen in Languages, or none for automatic), navLang (the TV's
     language, like navigator.language) and hidden (category ids hidden in this list). */
  function view(d, opts) {
    opts = opts || {};
    var counts = {}, items = d.items, i, it;
    // A title with no code takes its category's: "|TR| DIZI", "|SCA| NORDIC FILMS", "EN - MOVIES".
    var catLang = {};
    d.cats.forEach(function (c) {
      var m = /^\s*[|\[]\s*([A-Za-z]{2,4})\s*[|\]]/.exec(c.name) || /^\s*([A-Z]{2,3})\s*(?:[|:]|\s[-–])\s/.exec(c.name);
      var code = m && m[1].toUpperCase(); code = code && (ALIAS[code] || code);
      if (code && !NOTLANG[code] && known(code)) catLang[c.id] = code;
    });
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.lang === undefined) { tag(it); if (!it.lang && catLang[it.cat]) it.lang = catLang[it.cat]; }
      counts[it.lang] = (counts[it.lang] || 0) + 1;
    }
    // Codes used only a few times were part of the title ("AVP - Alien vs Predator", one "US - " film).
    var undo = {};
    Object.keys(counts).forEach(function (c) { if (c && counts[c] < (known(c) ? MIN_KNOWN : MIN_UNKNOWN)) { undo[c] = 1; counts[''] = (counts[''] || 0) + counts[c]; delete counts[c]; } });
    var adultCat = {};
    d.cats.forEach(function (c) { if (ADULT.test(c.name)) adultCat[c.id] = 1; });
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (undo[it.lang]) { it.name = (it.p || '') + it.name; it.lang = ''; it.p = ''; it.q = ''; }
      if (adultCat[it.cat]) it.adult = 1;
    }
    var keep = shownLangs(counts, items.length, opts.picked, opts.navLang), hid = {}, hidden = opts.hidden || [];
    hidden.forEach(function (c) { hid[c] = 1; });
    var shown = keep || hidden.length ? items.filter(function (x) { return (!keep || keep[x.lang] || x.adult) && !hid[x.cat]; }) : items;
    return { at: d.at, cats: d.cats, items: shown, langs: counts, keep: keep, total: items.length, adultCat: adultCat };
  }
  return { tag: tag, view: view, known: known, langName: langName, shownLangs: shownLangs, ADULT: ADULT };
})();
if (typeof module !== 'undefined') module.exports = VodView;
