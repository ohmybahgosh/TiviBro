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
   app that a language doesn't have yet. */
var I18n = (function () {
  'use strict';
  // code, name in its own language, name in English
  var LANGS = [['en', 'English', 'English'], ['es', 'Español', 'Spanish'], ['ru', 'Русский', 'Russian']];
  var dicts = {}, pats = {}, cache = {}, cacheN = 0, tv = '', tvAsked = false, listeners = [];

  function has(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return true; return false; }
  // "es-MX", "ru_RU", "spa" -> "es", "ru"; anything else -> ''
  function base(loc) {
    var m = /^([a-z]{2,3})/i.exec(String(loc || '').trim());
    if (!m) return '';
    var c = m[1].toLowerCase(), three = { spa: 'es', rus: 'ru', eng: 'en' };
    return three[c] || c;
  }
  /* The TV's language, best first.  settingsservice's answer (tv) is the TV menu's own setting; the others
     are what the web engine was started with, which on webOS follows it too. */
  function detected() {
    var l = [tv];
    try { if (typeof webOSSystem !== 'undefined' && webOSSystem.locale) l.push(webOSSystem.locale); } catch (e) {}
    try { if (typeof PalmSystem !== 'undefined' && PalmSystem.locale) l.push(PalmSystem.locale); } catch (e) {}
    try { if (navigator.languages && navigator.languages.length) l = l.concat([].slice.call(navigator.languages)); } catch (e) {}
    l.push(navigator.language, navigator.userLanguage);
    for (var i = 0; i < l.length; i++) { var c = base(l[i]); if (c) return { code: c, locale: String(l[i]), supported: has(c) }; }
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
    return { rx: new RegExp('^' + src + '$'), names: names, v: v, lit: parts.join('').replace(/\{[nxyz]\}/g, '').length };
  }

  /* Plural forms (CLDR): Spanish one/other, Russian one/few/many. */
  function plural(code, n) {
    n = Math.abs(+String(n).replace(/[^\d.-]/g, '')) || 0;
    if (code === 'ru') {
      var i = Math.floor(n), m10 = i % 10, m100 = i % 100;
      if (i !== n) return 1;
      return m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
    }
    return n === 1 ? 0 : 1;
  }
  function pick(code, v, vars) {
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var f = v[plural(code, vars && vars.n != null ? vars.n : 0)];
      v = f != null ? f : v[v.length - 1];
    }
    return String(v).replace(/\{([a-z]+)\}/g, function (a, k) { return vars && vars[k] != null ? vars[k] : a; });
  }

  /** The text in the language chosen.  vars fill {n}, {x}... in the translation (and in English). */
  function t(s, vars) {
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
      if (best && p[i].lit <= best.lit) continue;
      var m = p[i].rx.exec(s);
      if (m) { best = p[i]; bm = m; }
    }
    if (best) {
      var v = {};
      best.names.forEach(function (nm, j) { var x = bm[j + 1]; v[nm] = nm === 'n' ? x : (d.hasOwnProperty(x) ? pick(code, d[x]) : x); });
      out = pick(code, best.v, v);
    }
    if (cacheN > 3000) { cache = {}; cacheN = 0; }
    cache[s] = out; cacheN++;
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
        x._en = x.nodeValue;
      }
      var lead = /^\s*/.exec(x._en)[0], trail = /\s*$/.exec(x._en)[0], core = x._en.trim();
      x.nodeValue = lead + t(core) + trail;
    });
  }

  function set(code) {
    var s = Store.settings;
    s.lang = code === 'auto' || !has(code) ? 'auto' : code;
    Store.saveSettings();
    changed();
  }
  function changed() {
    var was = cur; cur = null; cache = {}; cacheN = 0;
    if (lang() === was) return;
    try { document.documentElement.lang = lang(); } catch (e) {}
    listeners.forEach(function (f) { try { f(lang()); } catch (e) {} });
  }
  function onChange(f) { listeners.push(f); }

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
    t: t, add: add, lang: lang, locale: locale, set: set, setting: function () { return chosen() || 'auto'; }, detected: detected, base: base,
    plural: plural, page: page, onChange: onChange, askTV: askTV, name: name, langs: langs, has: has, changed: changed,
    _dicts: dicts, _setTV: function (l) { tv = l; changed(); }
  };
})();
