/* Languages: TiviBro in the TV's own language, and Settings > Language to choose another.

   The English text is the key: I18n.t('Settings') is "Ajustes" in Spanish, and anything not translated yet
   stays English.  Most text is translated where it's drawn (Settings rows, menus, boxes, toasts, the side
   menu, hints: see the I18n.t calls in ui.js, settings.js, util.js and views.js), so the code that builds
   it keeps writing plain English.

   Text with numbers or names in it is matched by patterns: '{n} teams have their own channel' matches
   "4 teams have their own channel" and comes back as "4 equipos tienen su propio canal".  {n} is a number,
   {x}, {y} and {z} any text (translated in turn when it's a key itself: a section name, a group name).  A
   value can be a list for the plural forms of {n}: Spanish [one, other], Russian [one, few, many].

   Which language: Settings > Language, or Automatic (the default), which is the TV's menu language.  On
   webOS that's settingsservice's localeInfo.locales.UI ("ru-RU"), asked once and watched (subscribe), so
   changing the TV's language changes TiviBro's; until it answers (and off the TV) webOSSystem.locale,
   PalmSystem.locale, then the browser's languages.  A language TiviBro doesn't have yet is English.

   Dictionaries: app/js/lang/<code>.js, I18n.add('es', { ... }).  node scripts/i18n-check.js lists text in the
   app that a language doesn't have yet.  Only the dictionaries in use are loaded (each is 200 to 350 KB, and a
   1 GB TV has none to spare): the TV's language as the page starts (boot), another one when the language
   changes or a phone or the web editor asks in it (need).  app/js/lang/keys.js lists every text TiviBro
   translates, for known(), whatever is loaded. */
var I18n = (function () {
  'use strict';
  // langs:begin
  // code, name in its own language, name in English (from i18n/langs.json by scripts/i18n-langs.js)
  var LANGS = [['en', 'English', 'English'], ['es', 'Español', 'Spanish'], ['es-ES', 'Español (España)', 'Spanish (Spain)'], ['fr', 'Français', 'French'], ['pt-BR', 'Português (Brasil)', 'Portuguese (Brazil)'], ['pt-PT', 'Português (Portugal)', 'Portuguese (Portugal)'], ['ru', 'Русский', 'Russian'], ['de', 'Deutsch', 'German'], ['it', 'Italiano', 'Italian'], ['tr', 'Türkçe', 'Turkish'], ['pl', 'Polski', 'Polish'], ['nl', 'Nederlands', 'Dutch']];
  // Each one's plural rule (see plural below), and the ones made from another (variant)
  var PLURAL = { 'en': 'one', 'es': 'one', 'es-ES': 'one', 'fr': 'fr', 'pt-BR': 'pt', 'pt-PT': 'pt', 'ru': 'ru', 'de': 'one', 'it': 'one', 'tr': 'one', 'pl': 'pl', 'nl': 'one' };
  var FROM = { 'es-ES': 'es', 'pt-PT': 'pt-BR' };
  // langs:end
  var dicts = {}, pats = {}, cache = {}, cacheN = 0, misses = {}, missN = 0, tv = '', tvAsked = false, listeners = [];
  var files = {}, loading = {}, keySet = null, keyPats = [];

  function has(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return true; return false; }
  // "es-MX", "ru_RU", "spa" -> "es", "ru"; anything else -> ''
  function base(loc) {
    var m = /^([a-z]{2,3})/i.exec(String(loc || '').trim());
    if (!m) return '';
    var c = m[1].toLowerCase(), three = { spa: 'es', rus: 'ru', eng: 'en', por: 'pt', fra: 'fr', fre: 'fr' };
    return three[c] || c;
  }
  /* The TV's language, best first.  settingsservice's answer (tv) is the TV menu's own setting; the others
     are what the web engine was started with, which on webOS follows it too. */
  var seen = null;                 // the answer, until the TV tells us its language (changed() forgets it)
  function detected() { return seen || (seen = look()); }
  /* The language for a locale: the exact one when TiviBro has it ("es-ES": Spain's Spanish, "pt-PT"), else the
     language ("es-MX": Spanish), else its first regional one ("pt": Brazil's Portuguese), else the language
     as it is (one TiviBro doesn't have). */
  function codeOf(loc) {
    var c = base(loc); if (!c) return '';
    var m = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(String(loc).trim()), full = m ? c + '-' + m[1].toUpperCase() : '';
    if (full && has(full)) return full;
    if (has(c)) return c;
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0].indexOf(c + '-') === 0 && !FROM[LANGS[i][0]]) return LANGS[i][0];
    return c;
  }
  function look() {
    var l = [tv];
    try { if (typeof webOSSystem !== 'undefined' && webOSSystem.locale) l.push(webOSSystem.locale); } catch (e) {}
    try { if (typeof PalmSystem !== 'undefined' && PalmSystem.locale) l.push(PalmSystem.locale); } catch (e) {}
    try { if (navigator.languages && navigator.languages.length) l = l.concat([].slice.call(navigator.languages)); } catch (e) {}
    l.push(navigator.language, navigator.userLanguage);
    for (var i = 0; i < l.length; i++) {
      var c = codeOf(l[i]);
      if (c) return { code: c, locale: String(l[i]), supported: has(c) };
    }
    return { code: 'en', locale: 'en-US', supported: true };
  }
  function chosen() { var s = typeof Store !== 'undefined' && Store.settings; return s && s.lang && s.lang !== 'auto' && has(s.lang) ? s.lang : ''; }
  var cur = null;
  function lang() {
    if (cur) return cur;
    var c = chosen(), d = detected(), l = c || (d.supported ? d.code : 'en');
    if (typeof Store !== 'undefined' && Store.settings) cur = l;     // settled once the settings are in
    return l;
  }
  // A locale for dates and numbers: the TV's own when it's this language ("es-MX"), else the language.
  function locale() { var l = lang(), d = detected(); return d.code === l ? d.locale.replace('_', '-') : l; }

  /* A language made from another one with its own words (Spain's Spanish from the Latin American one: "ordenador"
     for "computadora", "pulsa" for "presiona"…): every translation of `from`, with each word in `words` swapped
     (whole words, keeping a capital), then `extra` on top.  Built when the file loads, so it's an ordinary
     dictionary after that. */
  var L_ = 'A-Za-zÀ-ÖØ-öø-ÿ';
  function variant(code, from, words, extra) {
    var rules = words.map(function (w) { return { rx: new RegExp('(^|[^' + L_ + '])(' + esc(w[0]) + ')(?=[^' + L_ + ']|$)', 'gi'), to: w[1] }; });
    function swap(v) {
      if (Object.prototype.toString.call(v) === '[object Array]') return v.map(swap);
      var x = String(v);
      rules.forEach(function (r) { x = x.replace(r.rx, function (a, pre, word) { var to = word === word.toUpperCase() && word !== word.toLowerCase() ? r.to.toUpperCase() : word.charAt(0) !== word.charAt(0).toLowerCase() ? r.to.charAt(0).toUpperCase() + r.to.slice(1) : r.to; return pre + to; }); });
      return x;
    }
    var src = dicts[from] || {}, out = {};
    for (var k in src) if (src.hasOwnProperty(k)) out[k] = swap(src[k]);
    for (var k2 in extra || {}) if (extra.hasOwnProperty(k2)) out[k2] = extra[k2];
    add(code, out);
  }

  function add(code, dict) {
    var d = dicts[code] || (dicts[code] = {}), p = pats[code] || (pats[code] = []);
    for (var k in dict) {
      if (!dict.hasOwnProperty(k)) continue;
      d[k] = dict[k];
      if (/\{[nxyz]\}/.test(k)) p.push(compile(k, dict[k]));
    }
    cache = {}; cacheN = 0;
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function compile(k, v) {
    var names = [], src = '', parts = k.split(/(\{[nxyz]\})/);
    parts.forEach(function (p) {
      var m = /^\{([nxyz])\}$/.exec(p);
      if (m) { names.push(m[1]); src += m[1] === 'n' ? '(-?\\d[\\d,.  ]*)' : '([\\s\\S]+?)'; }
      else src += esc(p);
    });
    var lit = parts.join('').replace(/\{[nxyz]\}/g, '').length;
    /* Matched against text on its own only with a number in it, or enough fixed words that it can't be a
       name by chance ("{x} to {y}" would turn "Welcome to Paradise" into Spanish); the others are used
       with their values given (I18n.t('{x} to {y}', { x: …, y: … })). */
    return { rx: new RegExp('^' + src + '$'), names: names, v: v, lit: lit, auto: names.indexOf('n') >= 0 || lit >= 14 };
  }

  /* Plural forms (CLDR), by each language's rule (PLURAL, from i18n/langs.json): the index into a list in the
     dictionary.  one: one/other.  fr and pt: 0 and 1 singular ("0 heure", "1 hora").  ru: one/few/many
     (1 and 21, 2-4 and 22-24, the rest).  pl: one/few/many (only 1, 2-4 and 22-24 but not 12-14, the rest). */
  function plural(code, n) {
    n = Math.abs(+String(n).replace(/[^\d.-]/g, '')) || 0;
    var rule = PLURAL[code] || 'one', i = Math.floor(n), m10 = i % 10, m100 = i % 100;
    if (rule === 'ru') return i !== n ? 1 : m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
    if (rule === 'pl') return i !== n ? 1 : i === 1 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
    if (rule === 'pt') return i <= 1 ? 0 : 1;
    if (rule === 'fr') return n < 2 ? 0 : 1;
    return n === 1 ? 0 : 1;
  }
  function pick(code, v, vars) {
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var f = v[plural(code, vars && vars.n != null ? vars.n : 0)];
      v = f != null ? f : v[v.length - 1];
    }
    return String(v).replace(/\{([a-z]+)\}/g, function (a, k) { return vars && vars[k] != null ? vars[k] : a; });
  }

  /* A name (a channel, group, playlist, programme or team), never translated even when it's a word the
     dictionaries have: a group called "Sports" or a show called "Today" stay as they are.  I18n.raw(name)
     where a name goes into a menu, a box's title or a Settings row; it reads as the plain text anywhere. */
  function Raw(s) { this.s = String(s == null ? '' : s); }
  Raw.prototype.toString = Raw.prototype.valueOf = function () { return this.s; };
  function raw(s) { return s instanceof Raw ? s : new Raw(s); }

  /** The text in the language chosen.  vars fill {n}, {x}... in the translation (and in English). */
  function t(s, vars) {
    if (s instanceof Raw) return s.s;
    if (s == null || s === '') return s;
    s = String(s);
    var code = lang();
    if (code === 'en') return vars ? pick('en', s, vars) : s;
    var d = dicts[code];
    if (!d) return vars ? pick('en', s, vars) : s;
    if (d.hasOwnProperty(s)) return pick(code, d[s], vars);
    if (vars) return pick('en', s, vars);
    var hit = cache[s];
    if (hit !== undefined) return hit;
    var out = s, p = pats[code] || [], best = null, bm = null;
    // Patterns: the one with the most fixed text that matches ("{n} channels hidden" over "{x} hidden").
    if (/\S\s+\S/.test(s) || /\d/.test(s)) for (var i = 0; i < p.length; i++) {
      if (!p[i].auto || (best && p[i].lit <= best.lit)) continue;
      var m = p[i].rx.exec(s);
      if (m) { best = p[i]; bm = m; }
    }
    if (best) {
      var v = {};
      best.names.forEach(function (nm, j) { var x = bm[j + 1]; v[nm] = nm === 'n' ? x : (d.hasOwnProperty(x) ? pick(code, d[x]) : x); });
      out = pick(code, best.v, v);
    }
    // Spaces around it ("…keyboard.  ") or parts set apart by three spaces ("Expires Sep 3   Xtream Codes   in use, 108 channels").
    else if (s !== s.trim()) { var core = s.trim(), tc = t(core); if (tc !== core) out = s.slice(0, s.indexOf(core)) + tc + s.slice(s.indexOf(core) + core.length); }
    else if (/\S {3,}\S/.test(s)) { var parts = s.split(/( {3,})/), tp = parts.map(function (x) { return /^ +$/.test(x) ? x : t(x); }); if (tp.join('') !== s) out = tp.join(''); }
    if (cacheN > 3000) { cache = {}; cacheN = 0; }
    cache[s] = out; cacheN++;
    // Text that stayed English (tests/soak/i18n-layout.js lists it): the first few hundred.
    if (out === s && missN < 400 && /[a-z]{3}/.test(s)) { misses[s] = 1; missN++; }
    return out;
  }

  /** Fixed text in a part of the page (index.html's titles, the setup screen): each text node keeps its
      English (_en) and shows it in the language, again after a change. */
  function page(root) {
    if (!root) return;
    var w = document.createTreeWalker(root, 4, null, false), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (x) {
      if (x._en == null) {
        if (!/[A-Za-z]/.test(x.nodeValue) || /^(SCRIPT|STYLE|TEXTAREA)$/.test(x.parentNode.nodeName)) return;
        if (x.parentNode.closest && x.parentNode.closest('[data-raw]')) return;      // names: channels, groups
        x._en = x.nodeValue;
      }
      var lead = /^\s*/.exec(x._en)[0], trail = /\s*$/.exec(x._en)[0], core = x._en.trim();
      x.nodeValue = lead + t(core) + trail;
    });
  }

  /* Loading dictionaries.  boot(map) runs as the page starts, from index.html, with each language's file (the
     build gives each a name with its contents' hash, scripts/script-versions.js): the language TiviBro will
     start in is written into the page there, so it's ready before anything is drawn.  The language comes from
     the saved settings, or the TV's, as lang() will find it. */
  function boot(map) {
    files = map || {};
    var s = {}; try { s = JSON.parse(localStorage.getItem('tivibro.settings') || 'null') || {}; } catch (e) {}
    var d = detected(), l = s.lang && s.lang !== 'auto' && has(s.lang) ? s.lang : d.supported ? d.code : 'en';
    [FROM[l], l].forEach(function (c) { if (c && files[c] && !dicts[c]) document.write('<script src="' + files[c] + '"><\/script>'); });
  }
  // A language's dictionary (and the one a variant is made from, first), then done().  At once when it's there.
  function load(code, done) {
    done = done || function () {};
    if (!code || code === 'en' || !has(code) || dicts[code] || !files[code]) return done();
    if (loading[code]) return loading[code].push(done);
    loading[code] = [done];
    load(FROM[code], function () {
      var el = document.createElement('script');
      // Missing or broken: that language stays English, as one without a dictionary always has.
      el.onload = el.onerror = function () { var l = loading[code] || []; delete loading[code]; l.forEach(function (f) { try { f(); } catch (e) {} }); };
      el.src = files[code];
      (document.head || document.documentElement).appendChild(el);
    });
  }
  /** A promise for a language's dictionary: before within() or say() in a language that may not be loaded. */
  function need(code) { return new Promise(function (r) { load(String(code || ''), r); }); }
  /* keys.js: every text TiviBro translates, as hashes (the same sum as U.hash), and the texts with {n}, {x}...
     as patterns, so known() can tell TiviBro's own words from a name whatever language is loaded. */
  function hash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h; }
  function keys(list, patterns) {
    keySet = {};
    for (var i = 0; i < list.length; i++) keySet[list[i]] = 1;
    keyPats = (patterns || []).map(function (k) { return compile(k, k); }).filter(function (p) { return p.auto; });
  }

  function set(code) {
    var s = Store.settings;
    s.lang = code === 'auto' || !has(code) ? 'auto' : code;
    Store.saveSettings();
    changed();
  }
  // The language may be another one now: its dictionary loaded, then everything that draws text told.
  function changed() {
    var was = cur; cur = null; seen = null; cache = {}; cacheN = 0;
    var now = lang();
    if (now === was) return;
    load(now, function () {
      if (lang() !== now) return;                    // changed again meanwhile: that load tells them
      cache = {}; cacheN = 0;
      try { document.documentElement.lang = now; } catch (e) {}
      listeners.forEach(function (f) { try { f(now); } catch (e) {} });
    });
  }
  function onChange(f) { listeners.push(f); }
  /* Text for someone else: the phone app and the web editor ask in their own language (a.lang), which can
     differ from the TV's.  fn runs with that language and the TV's goes back after.  fn must be synchronous:
     a promise it returns resolves after the TV's language is back. */
  function within(code, fn) {
    code = String(code || '');
    if (code !== 'en' && !(has(code) && dicts[code])) return fn();
    var keep = { cur: cur, cache: cache, n: cacheN };
    cur = code; cache = {}; cacheN = 0;
    try { return fn(); } finally { cur = keep.cur; cache = keep.cache; cacheN = keep.n; }
  }

  /* Messages the TV sends to the web editor and the phone app (webedit.js, phone.js).  An answer often comes
     after some waiting, when within() is long over, so msg() makes the English text and keeps its key and
     values, and say() puts it in the asker's language as it goes out.  With no language (an older editor or
     phone app) it stays English, as it always was. */
  function msg(s, vars) { var o = new String(vars ? pick('en', s, vars) : s); o.key = s; o.vars = vars; return o; }
  /** Messages and text put one after the other, each translated on its own by say(). */
  function join() { var parts = [].slice.call(arguments), o = new String(parts.join('')); o.parts = parts; return o; }
  /** A message from msg() or join(), an error (one with msg()'s key, else its message) or plain text, in the
   *  language code. */
  function say(m, code) {
    if (m == null || m === '') return m;
    if (!code) return textOf(m);
    return within(code, function () { return said(m); });
  }
  // An error's message (from any window: instanceof Error isn't enough), else the text.
  function textOf(m) { return String(typeof m === 'object' && !(m instanceof String) && m.message != null ? m.message : m); }
  // say() in the language already set: its parts, its key with its values (messages in turn), or the text as a key.
  function said(m) {
    if (m == null) return '';
    if (m.parts) return m.parts.map(said).join('');
    if (m.key != null) {
      var v = {};
      for (var k in m.vars || {}) { var x = m.vars[k]; v[k] = x != null && (x.key != null || x.parts) ? said(x) : x; }
      return t(m.key, m.vars ? v : undefined);
    }
    var text = textOf(m);
    return /\S/.test(text) ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, function (a, b, c, d) { return b + t(c) + d; }) : text;
  }

  /* The TV's menu language from settingsservice, and again whenever it's changed there. */
  function askTV() {
    if (tvAsked || typeof PalmServiceBridge === 'undefined') return;
    tvAsked = true;
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var j; try { j = JSON.parse(msg); } catch (e) { return; }
        var ui = j && j.settings && j.settings.localeInfo && j.settings.localeInfo.locales && j.settings.localeInfo.locales.UI;
        if (!ui || ui === tv) return;
        tv = ui;
        if (typeof Log !== 'undefined') Log.info('lang', 'The TV\'s menu language is ' + ui + (has(base(ui)) ? '' : ' (not in TiviBro yet: English)'));
        changed();
      };
      b.call('luna://com.webos.settingsservice/getSystemSettings', JSON.stringify({ keys: ['localeInfo'], subscribe: true }));
      askTV.bridge = b;             // kept, or the subscription goes with it
    } catch (e) {}
  }

  function name(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return LANGS[i][1]; return code; }
  function langs() { return LANGS.map(function (x) { return { code: x[0], name: x[1], english: x[2] }; }); }

  return {
    // A string of TiviBro's own (any language has it), not a name from your channels or teams: Search settings.
    known: function (s) {
      s = String(s);
      if (keySet) {
        if (keySet[hash(s)]) return true;
        for (var j = 0; j < keyPats.length; j++) if (keyPats[j].rx.test(s)) return true;
        return false;
      }
      for (var c in dicts) {
        if (dicts[c].hasOwnProperty(s)) return true;
        // Or built from one ("Hold " + a button: "Hold {x}").
        for (var i = 0, p = pats[c] || []; i < p.length; i++) if (p[i].auto && p[i].rx.test(s)) return true;
      }
      return false;
    },
    t: t, raw: raw, add: add, lang: lang, locale: locale, set: set, setting: function () { return chosen() || 'auto'; }, detected: detected, base: base,
    plural: plural, page: page, onChange: onChange, within: within, msg: msg, join: join, say: say, variant: variant, askTV: askTV, name: name, langs: langs, has: has, changed: changed,
    boot: boot, load: load, need: need, keys: keys, hash: hash,
    misses: function () { return Object.keys(misses); }, _dicts: dicts, _setTV: function (l) { tv = l; changed(); }
  };
})();
