/* Movies and Shows (Xtream VOD).  Lists are cached per playlist like live channels;
   details load only for the title you rest on.  Files play through the TV's own player,
   which seeks well and handles MKV/MP4 without any JS demuxing. */
var Vod = (function () {
  'use strict';
  var $ = U.$;
  var kind = 'movie', built = false, zone = 'items';
  var catsVL, itemsVL;
  var data = { movie: null, series: null };
  var info = new Map();
  var episodes = null, series = null;      // drill-down into a show
  var playingMeta = null;

  var CW = '_cw', MY = '_my', ALL = '_all', LANGS = '_langs';

  function E() { return Store.edits; }
  function key(it) { return (kind === 'series' && !it.ep ? 's' : 'm') + it.id; }
  function resumeOf(id) { return E().resume[id]; }

  /* Lists.  The full list (every language) is cached per playlist; only what is shown stays in memory,
     so a 160,000-title library with a dozen languages costs the TV what one language does.  On a TV the
     helper downloads and slims the provider's list (service/vod.js), so the app never parses the
     provider's full answer; without the helper (a browser) the app does it itself. */
  function cacheKey(k) { return 'vod:' + Store.playlist.id + ':' + k; }
  function load(k) {
    if (data[k]) return Promise.resolve(data[k]);
    var ck = cacheKey(k);
    return Store.idbGet(ck).then(function (c) {
      var h = +Store.playlist.plRefresh, fresh = c && c.v === 3 && (h <= 0 || Date.now() - c.at < h * 3600e3);
      if (c && fresh) return (data[k] = view(k, c));
      return Promise.all([Source.vodCats(k), fetchItems(k)]).then(function (r) {
        var cats = (r[0] || []).map(function (x) { return { id: String(x.category_id), name: x.category_name || 'Other' }; });
        var d = { v: 3, at: Date.now(), cats: cats, items: r[1] };
        Store.idbSet(ck, d);
        return (data[k] = view(k, d));
      }).catch(function (e) { if (c) return (data[k] = view(k, c)); throw e; });
    });
  }
  function movieRow(x) { return ({ id: x[0], name: x[1], cover: x[2], rating: x[3], ext: x[4] || 'mp4', cat: x[5], added: x[6] }); }
  function seriesRow(x) { return ({ id: x[0], name: x[1], cover: x[2], plot: x[3], rating: x[4], year: x[5], cat: x[6], added: x[7] }); }
  function fetchItems(k) {
    var api = Source.api(Store.playlist, k === 'series' ? 'get_series' : 'get_vod_streams');
    function direct() {
      return Source.vodList(k).then(function (list) {
        return (list || []).map(function (x) {
          return k === 'series'
            ? seriesRow([x.series_id, x.name || '', x.cover || '', String(x.plot || '').slice(0, 300), x.rating || '', (x.releaseDate || x.release_date || '').slice(0, 4), String(x.category_id), +x.last_modified || 0])
            : movieRow([x.stream_id, x.name || '', x.stream_icon || '', x.rating || '', x.container_extension || 'mp4', String(x.category_id), +x.added || 0]);
        });
      });
    }
    if (!Net.active || !Net.port || !(Net.info && Net.info.vod)) return direct();
    var t0 = Date.now();
    return postJSON('http://127.0.0.1:' + Net.port + '/vod/slim', { kind: k, u: Net.wrap(api) }, 240000).then(function (j) {
      if (!j || !Array.isArray(j.rows)) throw new Error((j && j.error) || 'no list');
      Log.info('vod', 'The helper slimmed the ' + (k === 'series' ? 'show' : 'movie') + ' list: ' + j.rows.length + ' in ' + (Date.now() - t0) + ' ms');
      return j.rows.map(k === 'series' ? seriesRow : movieRow);
    }).catch(function (e) {
      Log.warn('vod', 'The helper could not load the ' + (k === 'series' ? 'show' : 'movie') + ' list (' + (e && e.message || e) + '), loading it directly');
      return direct();
    });
  }
  function postJSON(url, body, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }

  /* Languages.  Many providers put a language or country code in front of every title
     ("SE - The Dog Stars", "SE-4K - Mutiny", "[SE] Nocturne", "EN - ...").  The code is taken off the
     name, kept as the title's language, and a 4K tag next to it becomes a 4K label. */
  var CODES = (function () { var o = { EN: 1, ENG: 1 }; (Names.COUNTRY || []).forEach(function (c) { o[c] = 1; }); return o; })();
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
  function prefs() { var p = Store.playlist; return p.vodPrefs || (p.vodPrefs = {}); }
  function hiddenCats(k) { var h = prefs().hide || {}; return h[k] || []; }
  // Which languages show: the ones picked in Languages, or by default the TV's own language plus
  // untagged titles.  Everything shows when the library has one language, or the TV's matches little.
  function shownLangs(counts, total) {
    var picked = prefs().langs;
    var codes = Object.keys(counts).filter(Boolean);
    if (codes.length < 2) return null;
    var keep = {};
    if (Array.isArray(picked)) { picked.forEach(function (c) { keep[c] = 1; }); return keep; }
    var loc = String(navigator.language || 'en-US').split('-'), want = {};
    (LOCALE[loc[0].toLowerCase()] || []).forEach(function (c) { want[c] = 1; });
    if (loc[1]) want[loc[1].toUpperCase()] = 1;
    keep[''] = 1; codes.forEach(function (c) { if (want[c]) keep[c] = 1; });
    var n = Object.keys(keep).reduce(function (a, c) { return a + (counts[c] || 0); }, 0);
    return n >= Math.min(200, total * 0.05) ? keep : null;
  }
  // Adult categories stay out of All and Search; they are listed last and ask for the PIN if one is set.
  var ADULT = /\b(adults?|xxx|porn|erotic|18\s?\+|\+\s?18)(?![a-z])/i;
  function view(k, d) {
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
    var keep = shownLangs(counts, items.length), hid = {};
    hiddenCats(k).forEach(function (c) { hid[c] = 1; });
    var shown = keep || hiddenCats(k).length ? items.filter(function (x) { return (!keep || keep[x.lang] || x.adult) && !hid[x.cat]; }) : items;
    return { at: d.at, cats: d.cats, items: shown, langs: counts, keep: keep, total: items.length, adultCat: adultCat };
  }
  // After a language or category change: rebuild from the cache, keep the selected category.
  function reshow() {
    var was = catsVL.current(), wasId = was && was.id;
    data = { movie: null, series: null };
    load(kind).then(function () {
      var cl = catList(), at = Math.max(0, cl.findIndex(function (c) { return c.id === wasId; }));
      catsVL.setItems(cl, at);
      var c = catsVL.current();
      if (c && c.id !== LANGS) itemsVL.setItems(itemsFor(c.id), 0);
      onItem();
    });
  }
  function langMenu() {
    var d = data[kind]; if (!d) return;
    var counts = d.langs, keep = d.keep;
    var cur = {};
    Object.keys(counts).forEach(function (c) { if (!keep || keep[c]) cur[c] = 1; });
    function save(next) { prefs().langs = next; Store.upsertPlaylist(Store.playlist); reshow(); }
    var items = [
      { label: 'Automatic', sub: 'your TV\'s language and untagged titles' + (Array.isArray(prefs().langs) ? '' : '   (now)'), action: function () { delete prefs().langs; Store.upsertPlaylist(Store.playlist); reshow(); } },
      { label: 'Show every language', action: function () { save(Object.keys(counts)); } }
    ];
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (c) {
      items.push({ label: (cur[c] ? '✓ ' : '    ') + langName(c), sub: counts[c].toLocaleString() + (kind === 'series' ? ' shows' : ' movies'), current: c === langMenu.last,
        action: function () {
          if (cur[c]) delete cur[c]; else cur[c] = 1;
          if (!Object.keys(cur).length) { U.toast('Keep at least one language'); cur[c] = 1; }
          langMenu.last = c; save(Object.keys(cur)); setTimeout(langMenu, 50);
        } });
    });
    UI.menu('Languages', items, function () { langMenu.last = null; });
  }
  function catMenu(c) {
    if (!c) return;
    var p = prefs(), h = p.hide || (p.hide = {}), list = h[kind] || (h[kind] = []);
    var items = [];
    if (c.id !== CW && c.id !== MY && c.id !== ALL && c.id !== LANGS) {
      items.push({ label: 'Hide this category', sub: 'its titles leave All and Search too', action: function () { list.push(c.id); Store.upsertPlaylist(Store.playlist); U.toast(c.name + ' hidden'); reshow(); } });
    }
    if (data[kind] && Object.keys(data[kind].langs).filter(Boolean).length > 1) items.push({ label: 'Languages…', action: langMenu });
    if (list.length) items.push({ label: 'Show hidden categories (' + list.length + ')', action: function () { h[kind] = []; Store.upsertPlaylist(Store.playlist); U.toast('Hidden categories are back'); reshow(); } });
    if (!items.length) return;
    UI.menu(c.name, items);
  }

  // Providers send 01:25:00, 85 (minutes) or 0; show 1 h 25 min, 43 min, or nothing.
  function niceDur(d) {
    if (!d) return '';
    var p = String(d).split(':').map(Number), secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : +d * 60;
    if (!(secs >= 60)) return '';
    var h = Math.floor(secs / 3600), m = Math.round(secs % 3600 / 60);
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  // 7.634 -> ★ 7.6; nothing for 0 or a missing rating.
  function stars(r) { r = Math.round(parseFloat(r) * 10) / 10; return r > 0 ? '★ ' + r : ''; }
  function cleanCat(n) { return Names.groupsOn() ? Names.clean(n) : n; }

  function renderCat(row, c) {
    if (!row._n) { row._n = U.el('span', 'name'); row._t = U.el('span', 'tag'); var b = U.el('div', 'txt'); b.appendChild(row._n); row.appendChild(b); row.appendChild(row._t); }
    row._n.textContent = c.name; row._t.textContent = c.count != null ? String(c.count) : '';
  }
  function renderItem(row, it) {
    if (!row._n) {
      row._img = U.el('img', 'poster'); row._img.decoding = 'async'; row._img.onerror = function () { if (!Net.retryImage(this)) this.style.visibility = 'hidden'; };
      var b = U.el('div', 'txt'); row._n = U.el('span', 'name'); row._s = U.el('span', 'sub'); row._p = U.el('div', 'pbar'); row._pi = U.el('i'); row._p.appendChild(row._pi);
      b.appendChild(row._n); b.appendChild(row._s); b.appendChild(row._p);
      row._t = U.el('span', 'tag');
      row.appendChild(row._img); row.appendChild(b); row.appendChild(row._t);
    }
    var img = it.cover || '';
    if (row._src !== img) { row._src = img; row._img.style.visibility = img ? 'visible' : 'hidden'; if (img) row._img.src = img; else row._img.removeAttribute('src'); }
    row._n.textContent = it.ep ? it.label : it.name;
    var d = data[kind], many = d && (!d.keep || Object.keys(d.keep).length > 2) && Object.keys(d.langs || {}).length > 2;
    row._s.textContent = it.ep ? niceDur(it.dur) : [it.year, stars(it.rating), it.q, many && it.lang].filter(Boolean).join('   ');
    var r = resumeOf(it.ep ? 'e' + it.id : key(it));
    if (r && r.dur) { row._p.style.display = ''; row._pi.style.width = Math.round(100 * r.pos / r.dur) + '%'; } else row._p.style.display = 'none';
    row._t.textContent = E().myList.indexOf(key(it)) >= 0 && !it.ep ? '★' : '';
  }

  function build() {
    catsVL = new VList($('vodCats'), { render: renderCat, onSel: onCat, empty: 'No categories', visible: 11,
      onHover: function () { if (zone !== 'cats') setZone('cats'); }, onClick: function () { UI.press('ok'); } });
    itemsVL = new VList($('vodItems'), { render: renderItem, onSel: onItem, empty: 'Nothing here', visible: 11,
      onHover: function () { if (zone !== 'items') setZone('items'); }, onClick: function () { UI.press('ok'); } });
    built = true;
  }

  function catList() {
    var d = data[kind], counts = {};
    d.items.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    var mine = E().myList.filter(function (k) { return k.charAt(0) === (kind === 'series' ? 's' : 'm'); }).length;
    var cw = continueList().length;
    var out = [];
    var codes = Object.keys(d.langs || {}).filter(Boolean);
    if (codes.length > 1) {
      var on = d.keep ? Object.keys(d.keep).filter(function (c) { return c && d.langs[c]; }) : codes;
      out.push({ id: LANGS, name: 'Languages', count: on.length === codes.length ? 'all' : on.slice(0, 2).join(', ') + (on.length > 2 ? ' +' + (on.length - 2) : '') + (on.length ? '' : 'untagged') });
    }
    if (cw) out.push({ id: CW, name: 'Continue watching', count: cw });
    out.push({ id: MY, name: 'My list', count: mine });
    out.push({ id: ALL, name: kind === 'series' ? 'All shows' : 'All movies', count: d.items.filter(function (it) { return !it.adult; }).length });
    var hid = {}; hiddenCats(kind).forEach(function (c) { hid[c] = 1; });
    var later = [];
    d.cats.forEach(function (c) { if (counts[c.id] && !hid[c.id]) (d.adultCat && d.adultCat[c.id] ? later : out).push({ id: c.id, name: cleanCat(c.name), count: counts[c.id], adult: !!(d.adultCat && d.adultCat[c.id]) }); });
    out = out.concat(later);
    return out;
  }
  function continueList() {
    var d = data[kind]; if (!d) return [];
    var r = E().resume, out = [];
    d.items.forEach(function (it) { var x = r[key(it)]; if (x && x.pos > 60 && x.pos < x.dur - 120) out.push({ it: it, at: x.at }); });
    return out.sort(function (a, b) { return b.at - a.at; }).map(function (x) { return x.it; });
  }
  function itemsFor(cid) {
    var d = data[kind];
    if (cid === CW) return continueList();
    if (cid === LANGS) return [];
    if (cid === MY) { var m = E().myList; return d.items.filter(function (it) { return m.indexOf(key(it)) >= 0; }); }
    if (cid === ALL) return d.items.filter(function (it) { return !it.adult; }).sort(function (a, b) { return b.added - a.added; });
    return d.items.filter(function (it) { return it.cat === cid; });
  }

  // Movies and shows for Search: whatever is loaded (prepare() loads them when Search opens).
  function allItems() {
    var out = [];
    ['movie', 'series'].forEach(function (k) {
      var d = data[k];
      if (d) d.items.forEach(function (it) { if (!it.adult) out.push({ it: it, kind: k }); });
    });
    return out;
  }
  /* Search looks inside Movies and Shows without opening them first: the lists load from the TV's
     cache (or the provider, once) when Search opens.  Only the kinds the provider offers. */
  var preparing = null;
  function offered() { var p = Store.playlist || {}, v = p.vod || {}; return p.type === 'xtream' ? ['movie', 'series'].filter(function (k) { return k === 'movie' ? v.movies : v.series; }) : []; }
  function prepare() {
    var want = offered().filter(function (k) { return !data[k]; });
    if (!want.length) return Promise.resolve(false);
    if (preparing) return preparing;
    preparing = Promise.all(want.map(function (k) { return load(k).catch(function (e) { Log.warn('vod', 'Search could not load ' + k + ': ' + (e && e.message || e)); }); }))
      .then(function () { preparing = null; return true; });
    return preparing;
  }
  // For Search's empty message: 'none' (the provider has no movies or shows), 'loading' or 'ready'.
  function searchState() { var o = offered(); return !o.length ? 'none' : o.some(function (k) { return !data[k]; }) ? (preparing ? 'loading' : 'none') : 'ready'; }
  /* Open a movie or show found in Search the way the Movies or Shows screen would: that screen opens on
     All, on the title, then a movie plays (Back returns to it there) or a show lists its episodes. */
  var pending = null;
  function openItem(x) {
    pending = x;
    Views.switchTab(x.kind === 'series' ? 'shows' : 'movies');
  }
  function openPending(k) {
    var x = pending;
    if (!x || x.kind !== k) return;
    pending = null;
    var cats = catsVL.items, ai = cats.findIndex(function (c) { return c.id === ALL; });
    if (ai >= 0) { catsVL.setItems(cats, ai); itemsVL.setItems(itemsFor(ALL), 0); }
    var at = itemsVL.items.findIndex(function (it) { return it.id === x.it.id; });
    if (at >= 0) itemsVL.setItems(itemsVL.items, at);
    setZone('items'); onItem();
    if (k === 'series') openSeries(x.it); else play(x.it, false);
  }

  var catDeb = U.debounce(function (c) {
    if (!c || episodes) return;
    var shut = c.adult && !adultOpen();
    itemsVL.empty = c.id === LANGS ? 'Press OK to pick which languages show' : shut ? 'Press OK and enter the PIN' : 'Nothing here';
    itemsVL.setItems(shut ? [] : itemsFor(c.id), 0); onItem();
  }, 200);
  // With a PIN set (Settings > Parental controls, for channels), adult categories open only after it.
  var adultUnlocked = false;
  function adultOpen() { return adultUnlocked || !Parental.enabled() || (Store.settings.pinScope !== 'channels' && Store.settings.pinScope !== 'both'); }
  function onCat(i, c) { catDeb(c); if (zone === 'cats') hints(); }
  var infoDeb = U.debounce(fetchInfo, 400);
  function onItem() { showInfo(); infoDeb(); }

  function fetchInfo() {
    var it = itemsVL.current();
    if (!it || it.ep || kind !== 'movie' || info.has(it.id)) return;
    info.set(it.id, null);
    Source.vodInfo(it.id).then(function (r) {
      var i = (r && r.info) || {};
      info.set(it.id, { plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '', director: i.director || '', dur: i.duration || '', year: (i.releasedate || i.release_date || '').slice(0, 4), poster: i.movie_image || i.cover_big || '', media: Caps.fromXtream(i) });
      if (itemsVL.current() === it) showInfo();
    }).catch(function () {});
  }

  function mediaOf(it) { var m = it.ep ? null : (kind === 'movie' ? info.get(it.id) : null); return it.ep ? it.media : m && m.media; }
  function showInfo() {
    var it = itemsVL.current(), box = $('vodInfo');
    box.innerHTML = '';
    if (!it) return;
    var m = it.ep ? null : (kind === 'movie' ? info.get(it.id) : null);
    var poster = (m && m.poster) || it.cover || (series && series.cover);
    if (poster) { var img = U.el('img', 'vod-poster'); img.src = poster; img.onerror = function () { if (!Net.retryImage(this)) this.remove(); }; box.appendChild(img); }
    box.appendChild(U.el('h2', '', it.ep ? it.label : it.name));
    var meta = [m && m.year || it.year, niceDur(m && m.dur || it.dur), m && m.genre, stars(it.rating)].filter(Boolean).join('   ');
    if (meta) box.appendChild(U.el('div', 'vod-meta', meta));
    // What the file is, from the provider's own scan of it: 4K, HDR or Dolby Vision, sound format.
    var md = mediaOf(it);
    if (md) {
      var lbl = Caps.label(md);
      if (lbl) box.appendChild(U.el('div', 'vod-media', lbl));
      var w = Caps.route(md, Store.settings.hdrRoute || 'auto').warn;
      if (w) box.appendChild(U.el('div', 'vod-meta warn', w));
    }
    var plot = (m && m.plot) || it.plot || (it.ep && it.plotEp) || '';
    if (plot) box.appendChild(U.el('p', 'vod-plot', plot));
    if (m && m.cast) box.appendChild(U.el('div', 'vod-meta', 'Cast: ' + m.cast));
    if (m && m.director) box.appendChild(U.el('div', 'vod-meta', 'Director: ' + m.director));
    var r = resumeOf(it.ep ? 'e' + it.id : key(it));
    if (r && r.dur) box.appendChild(U.el('div', 'vod-meta', 'Stopped at ' + Math.floor(r.pos / 60) + ' of ' + Math.floor(r.dur / 60) + ' min'));
  }

  /* ---------- series drill-down ---------- */
  function openSeries(s) {
    $('vodTitle').textContent = 'Loading ' + s.name;
    Source.seriesInfo(s.id).then(function (r) {
      var eps = [], byS = (r && r.episodes) || {};
      Object.keys(byS).sort(function (a, b) { return +a - +b; }).forEach(function (sn) {
        (byS[sn] || []).forEach(function (e) {
          var inf = e.info || {};
          eps.push({ ep: true, id: e.id, ext: e.container_extension || 'mp4', season: +sn, num: +e.episode_num || 0, media: Caps.fromXtream(inf),
            label: 'S' + sn + ' E' + (e.episode_num || '?') + '   ' + (e.title || '').replace(/^.*? - S\d+E\d+ - /i, ''),
            dur: inf.duration || '', plotEp: inf.plot || '', cover: inf.movie_image || s.cover });
        });
      });
      series = s; episodes = eps;
      $('vodTitle').textContent = s.name + '   ' + eps.length + ' episodes';
      // Start on the next unwatched episode.
      var res = E().resume, start = 0;
      for (var i = eps.length - 1; i >= 0; i--) if (res['e' + eps[i].id]) { var x = res['e' + eps[i].id]; start = x.pos < x.dur - 120 ? i : Math.min(i + 1, eps.length - 1); break; }
      itemsVL.setItems(eps, start);
      onItem();
      hints();
    }).catch(function () { U.toast('Could not load that show'); $('vodTitle').textContent = s.name; });
  }
  function closeSeries() {
    var s = series; episodes = null; series = null;
    var c = catsVL.current();
    var list = itemsFor(c ? c.id : ALL);
    itemsVL.setItems(list, Math.max(0, list.findIndex(function (x) { return x.id === s.id; })));
    $('vodTitle').textContent = kind === 'series' ? 'Shows' : 'Movies';
    onItem(); hints();
  }

  /* ---------- playback ---------- */
  function play(it, fromStart) {
    var id = it.ep ? 'e' + it.id : key(it);
    var r = resumeOf(id), startAt = !fromStart && r && r.pos > 30 && r.pos < r.dur - 60 ? r.pos - 5 : 0;
    var url = it.ep ? Source.episodeUrl(it.id, it.ext) : Source.movieUrl(it.id, it.ext);
    playingMeta = { id: id, media: mediaOf(it), title: it.ep ? (series ? series.name : '') + '   ' + it.label : it.name, sub: it.ep ? '' : it.year || '', item: it, seriesKey: series ? 's' + series.id : null };
    Views.playVod(playingMeta, url, startAt, function () { open(kind, true); });
  }
  // Save where playback is without stopping (the app going to the background).
  function checkpoint() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    if (dur > 60 && pos > 30 && pos < dur - 60) { E().resume[playingMeta.id] = { pos: pos, dur: dur, at: Date.now() }; Store.saveEdits(); }
  }
  function stopped() {
    if (!playingMeta) return;
    var pos = Player.position, dur = Player.duration;
    if (dur > 60) {
      var r = E().resume;
      if (pos > dur - 60) delete r[playingMeta.id];
      else if (pos > 30) r[playingMeta.id] = { pos: pos, dur: dur, at: Date.now() };
      // A show tracks its latest episode too, for Continue watching.
      if (playingMeta.seriesKey) r[playingMeta.seriesKey] = { pos: 61, dur: 1e6, at: Date.now() };
      Store.saveEdits();
    }
    playingMeta = null;
  }
  function ended() {
    var m = playingMeta;
    if (m && m.item && m.item.ep && episodes && Store.settings.autoNext !== false) {
      delete E().resume[m.id]; Store.saveEdits();
      var i = episodes.indexOf(m.item);
      if (i >= 0 && episodes[i + 1]) { playingMeta = null; U.toast('Next episode'); play(episodes[i + 1], true); return; }
    }
    stopped();
    Views.stopAll();
    open(kind, true);
  }

  function itemMenu(it) {
    if (!it) return;
    var id = it.ep ? 'e' + it.id : key(it);
    var r = resumeOf(id), mine = E().myList.indexOf(key(it)) >= 0;
    UI.menu(it.ep ? it.label : it.name, [
      r && { label: 'Resume', sub: Math.floor(r.pos / 60) + ' min', action: function () { play(it, false); } },
      kind === 'movie' || it.ep ? { label: r ? 'Play from beginning' : 'Play', action: function () { play(it, true); } } : { label: 'Open episodes', action: function () { openSeries(it); } },
      !it.ep && { label: mine ? 'Remove from My list' : 'Add to My list', action: function () {
        var l = E().myList, k = key(it);
        if (mine) E().myList = l.filter(function (x) { return x !== k; }); else l.push(k);
        Store.saveEdits(); itemsVL.refresh(); U.toast(mine ? 'Removed from My list' : 'Added to My list');
      } },
      r && { label: 'Mark as watched', action: function () { delete E().resume[id]; Store.saveEdits(); itemsVL.refresh(); } }
    ]);
  }

  function setZone(z) { zone = z; catsVL.setActive(z === 'cats'); itemsVL.setActive(z === 'items'); hints(); }
  function hints() {
    if (episodes) return UI.hints([['', 'OK  play'], ['', 'Hold OK  options'], ['', 'Back  all shows']]);
    if (zone === 'cats') {
      var c = catsVL && catsVL.current();
      return UI.hints(c && c.id === LANGS ? [['', 'OK  pick languages'], ['', 'Back  menu bar', 'back'], ['green', 'Guide'], ['blue', 'Settings']]
        : [['', 'OK  open'], ['', 'Hold OK or Red  hide category'], ['', 'Back  menu bar', 'back'], ['green', 'Guide'], ['blue', 'Settings']]);
    }
    UI.hints([['', 'OK  ' + (kind === 'series' ? 'open' : 'play')], ['', 'Hold OK or Red  options'], ['', 'Back  menu bar', 'back'], ['green', 'Guide'], ['blue', 'Settings']]);
  }

  function keys(a) {
    if (zone === 'cats') {
      if (a === 'up') catsVL.move(-1);
      else if (a === 'down') catsVL.move(1);
      else if (a === 'chup') catsVL.page(-1);
      else if (a === 'chdown') catsVL.page(1);
      else if ((a === 'ok' || a === 'right') && catsVL.current() && catsVL.current().id === LANGS) { if (a === 'ok') langMenu(); }
      else if (a === 'right' || a === 'ok') {
        catDeb.cancel(); var c = catsVL.current();
        var go = function () { if (c) { itemsVL.empty = 'Nothing here'; itemsVL.setItems(itemsFor(c.id), 0); onItem(); } setZone('items'); };
        if (c && c.adult && !adultOpen()) Parental.gate('channels', null, function () { adultUnlocked = true; go(); }); else go();
      }
      else if (a === 'red' || a === 'hold' || a === 'info') catMenu(catsVL.current());
      else if (a === 'back' || a === 'left') Views.tabBar(restore);
      else if (a === 'green') Views.switchTab('guide');
      else if (a === 'blue') Views.switchTab('settings');
      return true;
    }
    if (a === 'up') itemsVL.move(-1, true);
    else if (a === 'down') itemsVL.move(1, true);
    else if (a === 'chup') itemsVL.page(-1);
    else if (a === 'chdown') itemsVL.page(1);
    else if (a === 'left') { if (episodes) closeSeries(); else setZone('cats'); }
    else if (a === 'ok') {
      var it = itemsVL.current();
      if (!it) return true;
      if (kind === 'series' && !it.ep) openSeries(it); else play(it, false);
    }
    else if (a === 'red' || a === 'hold' || a === 'info') itemMenu(itemsVL.current());
    else if (a === 'back') { if (episodes) closeSeries(); else setZone('cats'); }
    else if (a === 'green') Views.switchTab('guide');
    else if (a === 'blue') Views.switchTab('settings');
    return true;
  }
  function restore() { UI.setHandler(keys); setZone(zone); }

  function open(k, keepState) {
    if (!built) build();
    var changed = k !== kind;
    kind = k;
    UI.setHandler(keys);
    if (changed) { episodes = null; series = null; }
    $('vodTitle').textContent = episodes && series ? series.name : (k === 'series' ? 'Shows' : 'Movies');
    if (keepState && data[k] && !changed && !pending) { var was = catsVL.current(), cl = catList(); catsVL.setItems(cl, Math.max(0, cl.findIndex(function (c) { return was && c.id === was.id; }))); itemsVL.refresh(); showInfo(); setZone(zone); return; }
    catsVL.setItems([], 0); itemsVL.setItems([], 0);
    itemsVL.empty = 'Loading…'; itemsVL.refresh();
    setZone('cats');
    load(k).then(function () {
      if (kind !== k) return;
      var cats = catList();
      var first = Math.max(0, cats.findIndex(function (c) { return c.count > 0; }));   // skip an empty My list
      catsVL.setItems(cats, first);
      itemsVL.empty = data[k].items.length ? 'Nothing here' : data[k].total ? 'Nothing in the languages picked.  Choose Languages on the left.' : 'This provider has no ' + (k === 'series' ? 'shows' : 'movies') + ' right now';
      itemsVL.setItems(itemsFor(cats[first].id), 0);
      setZone('items');
      onItem();
      openPending(k);
    }).catch(function (e) { itemsVL.empty = 'Could not load ' + (k === 'series' ? 'shows' : 'movies') + ': ' + (e.message || e); itemsVL.setItems([], 0); });
  }

  return { _test: { tag: tag, view: view }, open: open, stopped: stopped, checkpoint: checkpoint, ended: ended, allItems: allItems, openItem: openItem, prepare: prepare, get searchState() { return searchState(); }, reset: function () { data = { movie: null, series: null }; info.clear(); episodes = null; series = null; } };
})();
