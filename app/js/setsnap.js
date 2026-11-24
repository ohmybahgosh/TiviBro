/* The phone app's Settings while TiviBro isn't on the TV's screen.  webOS pauses TiviBro behind another app (YouTube),
   so it can't answer the phone then.  Instead TiviBro leaves the network helper a copy of every Settings page as the
   phone sees it (Settings.phone, in the languages phones asked in), and the helper answers from it while TiviBro is
   away (service/companion.js).  A switch or a choice changed on the phone then waits in the helper and is made here
   the next time TiviBro is on screen, in order.  Buttons that do something at once still need TiviBro.

   The copy is made a little after a start, after Settings change (10 s after the last change), and is sent again
   when TiviBro goes to the background.  It is built a few pages at a time, so the TV stays responsive.  Settings
   locked with a PIN: the copy carries the PIN's hash, and the helper asks the phone for the PIN as TiviBro does.
   Plain ES5 for the old Chromium on webOS. */
var SetSnap = (function () {
  'use strict';
  var LANGS = 'tivibro.phoneLangs', MAX_PAGES = 400, MAX_DEPTH = 4;
  var timer = null, building = false, again = false, snap = null;

  function base() { return typeof Net !== 'undefined' && Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function post(path, body) {
    if (!base()) return Promise.reject(new Error('no helper'));
    return Net.ctlFetch(base() + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: (body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); });
  }
  // The languages phones asked Settings in, newest first (at most 3), and English.
  function langs() {
    var l = []; try { l = JSON.parse(localStorage.getItem(LANGS) || '[]') || []; } catch (e) {}
    l = (Array.isArray(l) ? l : []).filter(function (x) { return typeof x === 'string' && /^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(x); });
    if (l.indexOf('en') < 0) l.push('en');
    return l;
  }
  // A phone asked Settings in this language (phone.js): its pages go in the next copy.
  function noteLang(code) {
    if (typeof code !== 'string' || !/^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(code)) return;
    var had = langs(), l = [code].concat(had.filter(function (x) { return x !== code && x !== 'en'; })).slice(0, 3);
    try { localStorage.setItem(LANGS, JSON.stringify(l)); } catch (e) {}
    if (had.indexOf(code) < 0) soon(5000);
  }
  function within(code, fn) { return typeof I18n !== 'undefined' && I18n.within ? I18n.within(code, fn) : fn(); }
  // The PIN's hash when Settings is locked with it, else ''.  The helper checks a phone's PIN against it.
  function pinHash() { var s = Store.settings || {}; return s.pin && (s.pinScope === 'both' || s.pinScope === 'settings') ? String(s.pin) : ''; }

  /* Every page of one language, as Settings.phone.page gives them: { sections, pages: { 'sec|0.2': page } }, walked
     into the pages inside pages (MAX_DEPTH deep, MAX_PAGES at most).  step() runs pages for 20 ms, then rests 80 ms,
     so the copy takes about a fifth of the TV's time while it's made (a C2 with two languages: about 50 s). */
  function buildLang(code, done) {
    // The language's dictionary first: the TV loads only the ones in use.
    if (typeof I18n !== 'undefined' && I18n.need) return I18n.need(code).then(function () { pages(code, done); });
    pages(code, done);
  }
  // The walk itself, a few pages at a time (see buildLang above).
  function pages(code, done) {
    var out = { sections: [], pages: {} }, queue = [], n = 0;
    try { out.sections = within(code, function () { return Settings.phone.sections(); }); } catch (e) { return done(out); }
    // What the helper says to the phone about a change it keeps, in this language.
    out.msgs = within(code, function () { return { saved: T('Saved.  The TV makes this change when TiviBro is next on screen.'), changed: T('That changed on the TV.  Look again.') }; });
    out.sections.forEach(function (s) { queue.push({ sec: s.id, path: [] }); });
    function step() {
      var until = Date.now() + 20;
      while (queue.length && Date.now() < until) {
        var q = queue.shift(), pg = null;
        try { pg = within(code, function () { return Settings.phone.page(q.sec, q.path); }); } catch (e) { pg = null; }
        if (!pg) continue;
        out.pages[q.sec + '|' + q.path.join('.')] = pg; n++;
        // Not a live page (the set-up tour: built from the whole channel list each time, too heavy to make here).
        if (q.path.length < MAX_DEPTH) (pg.rows || []).forEach(function (r) { if (r.kind === 'page' && !r.live && n + queue.length < MAX_PAGES) queue.push({ sec: q.sec, path: q.path.concat(r.i) }); });
      }
      if (queue.length && n < MAX_PAGES) setTimeout(step, 80); else done(out);
    }
    step();
  }
  // All the languages, one after the other: { at, version, pin, langs: { en: {...}, de: {...} } }.
  function build(done) {
    var l = langs(), out = { at: Date.now(), version: typeof TIVIBRO_VERSION !== 'undefined' ? TIVIBRO_VERSION : '', pin: pinHash(), langs: {} };
    (function next(i) {
      if (i >= l.length) return done(out);
      buildLang(l[i], function (x) { out.langs[l[i]] = x; next(i + 1); });
    })(0);
  }
  // Made and sent now (or once the one being made is done).  Only with the phone connection on.
  function run() {
    timer = null;
    if (building) { again = true; return; }
    if (typeof Phone === 'undefined' || !(Phone.status || {}).on || typeof Settings === 'undefined' || !Settings.phone) return;
    building = true;
    build(function (s) {
      snap = s; building = false;
      send();
      if (again) { again = false; soon(2000); }
    });
  }
  function send() { if (snap) post('/companion/snapshot', snap).catch(function () {}); }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? 10000 : ms); }

  /* Changes made on the phone while TiviBro was away, made here now in the order they were made: each through
     Settings.phone.change, as if the phone had asked now.  One that no longer fits (the page changed) is skipped. */
  function catchUp() {
    return post('/companion/pending').then(function (j) {
      var list = Array.isArray(j.changes) ? j.changes : [], made = 0;
      list.forEach(function (c) {
        try { Settings.phone.change(String(c.sec || ''), Array.isArray(c.path) ? c.path.map(Number) : [], +c.i, c.op, c); made++; }
        catch (e) { Log.warn('phone', 'A setting changed on the phone while TiviBro was away could not be made: ' + (e && e.message)); }
      });
      if (!list.length) return;
      Store.saveSettings();
      Log.info('phone', made + ' of ' + list.length + ' settings changed on the phone while TiviBro was away, made now');
      if (made) U.toast(made === 1 ? T('A setting changed on the phone is made now') : T('{n} settings changed on the phone are made now', { n: made }), 5000);
      soon(3000);
    }).catch(function () {});
  }
  function T(s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : s; }

  /* From app.js once TiviBro has started: changes waiting from the phone made, the first copy a minute later, and
     the copy sent again whenever TiviBro goes to the background (made first if there is none yet). */
  function start() {
    setTimeout(catchUp, 3000);
    soon(60000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (snap) send(); else soon(0); }
      else setTimeout(catchUp, 500);
    });
  }
  return { start: start, soon: soon, noteLang: noteLang, catchUp: catchUp, get made() { return snap ? snap.at : 0; }, _test: { build: build, buildLang: buildLang, langs: langs } };
})();
