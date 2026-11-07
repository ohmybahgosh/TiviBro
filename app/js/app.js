/* Boot sequence, tuned for a fast cold start on a slow TV:
   1. Paint the cached channel list from IndexedDB immediately.
   2. Resume the last channel straight away if that option is on.
   3. Refresh the provider list and guide in the background afterwards. */
var App = (function () {
  'use strict';
  var $ = U.$, setupEl = $('viewSetup');
  var ready = false, wasPlaying = false;

  function cacheKey(p) { return 'playlist:' + (p.id || 'none'); }
  // The loader may have found that the other scheme works, or pulled credentials out of a
  // pasted link.  Save that, so streams and the next launch use the working address.
  function adopt(p, data) {
    var f = data && data.fixed;
    if (!f) return p;
    ['server', 'user', 'pass', 'm3u'].forEach(function (k) { p[k] = f[k]; });
    Log.info('app', 'Saved working address ' + (p.type === 'm3u' ? p.m3u : p.server));
    U.toast(p.type === 'm3u' ? 'Connected using ' + p.m3u.split(':')[0] : 'Connected using ' + p.server, 4000);
    return p;
  }

  /* Recently added channels: a fresh channel list is compared with the one it replaces, and keys that
     were not there before get today's date.  Kept in the cached data, so it survives restarts, for
     two weeks at most.  A list that changed almost completely (another server, a provider rebuild)
     marks nothing: every channel would be "new". */
  // strip: another playlist's (several playlists on): prev's channel keys carry this prefix, data's don't.
  function carryAdded(prev, data, strip) {
    var old = prev && prev.channels, now = Date.now(), keep = {}, a = (prev && prev.added) || {};
    var limit = now - 14 * 86400e3, have = {};
    if (!old || !old.length) { data.added = {}; return data; }
    for (var i = 0; i < data.channels.length; i++) have[data.channels[i].k] = 1;
    Object.keys(a).forEach(function (k) { if (a[k] >= limit && have[k]) keep[k] = a[k]; });
    var was = {}, fresh = [];
    for (var j = 0; j < old.length; j++) was[strip && old[j].k.indexOf(strip) === 0 ? old[j].k.slice(strip.length) : old[j].k] = 1;
    for (var n = 0; n < data.channels.length; n++) { var k = data.channels[n].k; if (!was[k]) fresh.push(k); }
    if (fresh.length > 300 && fresh.length > data.channels.length * 0.4) {
      Log.info('app', fresh.length + ' of ' + data.channels.length + ' channels changed; not marking them as recently added');
    } else {
      fresh.forEach(function (k) { if (!keep[k]) keep[k] = now; });
      if (fresh.length) Log.info('app', fresh.length + ' channel(s) new since the last load');
    }
    data.added = keep;
    return data;
  }

  /* ---------- setup screen ----------
     target: undefined (first run), 'new' (add another), or a playlist id (edit). */
  function setup(target) {
    window.__tbBooted = true;              // the setup screen counts as started
    var editing = target && target !== 'new';
    var existing = editing ? Store.settings.playlists.filter(function (x) { return x.id === target; })[0] : null;
    // A new playlist starts on Full link: paste what the provider sent and TiviBro fills in the rest (#11).
    var p = existing ? JSON.parse(JSON.stringify(existing)) : { id: '', name: '', type: 'link', link: '', server: '', user: '', pass: '', m3u: '', guide: '' };
    var canCancel = !!target && Store.settings.playlists.length > 0;
    setupEl.classList.remove('hidden');
    var fields = [], f = 0, msg, firstDraw = true;
    // Language on the setup screen: Automatic (the TV's), then each one, round.
    function nextLang(d) {
      var l = ['auto'].concat(I18n.langs().map(function (x) { return x.code; })), i = l.indexOf(I18n.setting());
      I18n.set(l[(i + (d || 1) + l.length) % l.length]);
      render();
    }

    function render() {
      setupEl.innerHTML = '';
      setupEl.classList.toggle('withjoin', !target);
      if (!target) { var wb = U.el('img', 'setupbrand'); wb.src = 'img/wordmark.png'; wb.alt = 'TiviBro'; setupEl.appendChild(wb); joinPanel(); }
      setupEl.appendChild(U.el('h1', '', editing ? 'Edit playlist' : target === 'new' ? 'Add a playlist' : 'Add your playlist'));
      setupEl.appendChild(U.el('p', 'lead', 'Paste the full link your provider sent, or choose Xtream Codes or M3U as the type.  A Dispatcharr or other proxy address works with either.'));
      fields = [];
      /* A brand-new TV: the language first, in its own name and "Language" in English too, for when the
         TV's language was read wrong (Settings > Language later). */
      if (!target) {
        var ld = U.el('div', 'field lang');
        ld.appendChild(U.el('label', '', 'Language'));
        ld.appendChild(U.el('div', 'val', I18n.name(I18n.lang()) + (I18n.setting() === 'auto' ? '  (TV)' : '') + '   ◀ ▶'));
        setupEl.appendChild(ld); fields.push({ el: ld, kind: 'lang' });
        if (firstDraw) f = 1;
      }
      firstDraw = false;
      function row(label, key, type) {
        var d = U.el('div', 'field'), l = U.el('label', '', label);
        d.appendChild(l);
        if (key === 'type') {
          d.appendChild(U.el('div', 'val', TYPES[p.type] || 'Xtream Codes'));
          fields.push({ el: d, kind: 'type' });
        } else {
          var i = U.el('input');
          i.type = type || 'text'; i.value = p[key] || ''; i.spellcheck = false; i.autocomplete = 'off';
          i.addEventListener('input', function () { p[key] = i.value; if (key === 'link') showLink(); });
          // Keep the field being typed in above the on-screen keyboard (it covers the bottom ~45%).
          i.addEventListener('focus', function () { kbFocus(d); });
          i.addEventListener('blur', function () { setTimeout(kbBlur, 0); });
          d.appendChild(i);
          var fx = { el: d, kind: 'input', input: i };
          if (type === 'password') {
            // Show/hide so a pasted or typed password can be checked.  Left/Right or click toggles.
            var eye = U.el('span', 'eye', 'Show');
            fx.toggle = function () { var shown = i.type === 'text'; i.type = shown ? 'password' : 'text'; eye.textContent = I18n.t(shown ? 'Show' : 'Hide'); };
            eye.addEventListener('mousedown', function (e) { e.preventDefault(); fx.toggle(); });
            d.appendChild(eye);
          }
          fields.push(fx);
        }
        setupEl.appendChild(d);
      }
      row('Type', 'type');
      row('Name (optional)', 'name');
      if (p.type === 'link') {
        row('Full link', 'link', 'url');
        setupEl.appendChild(U.el('div', 'net', 'Paste the whole link your provider sent, the long one with username and password in it (it often has get.php).  TiviBro fills in the server, username and password for you.'));
        linkNote = U.el('div', 'net linknote'); setupEl.appendChild(linkNote); showLink();
      }
      else if (p.type === 'xtream') { row('Server', 'server', 'url'); row('Username', 'user'); row('Password', 'pass', 'password'); }
      else row('Playlist URL', 'm3u', 'url');
      if (!editing) row('Guide URL (optional)', 'guide', 'url');
      // Network: reachable here so a helper problem can never lock you out of the app.
      // "Network helper": the part of TiviBro that runs in the background on the TV and talks to the
      // provider for the app.  Most people never need to touch it, so it is explained here in plain words.
      var direct = Store.settings.network === 'direct';
      var nd = U.el('div', 'field'); nd.appendChild(U.el('label', '', 'Connection'));
      nd.appendChild(U.el('div', 'val', direct ? 'Direct (without the network helper)' : 'Automatic (recommended)'));
      setupEl.appendChild(nd); fields.push({ el: nd, kind: 'net' });
      setupEl.appendChild(U.el('div', 'net' + (Net.port || direct ? '' : ' err'),
        direct ? 'Direct asks your provider straight from the app.  Most providers block that on webOS; switch back to Automatic if Connect fails.'
          : Net.port ? 'Automatic uses the network helper, a part of TiviBro that runs in the background on the TV and fetches your channels, guide and streams for the app.  Leave it on.'
          : 'The network helper (the part of TiviBro that talks to your provider) is not running: ' + (Net.lastError || 'no reason given') + '.  Restart TiviBro; if it keeps happening, press View log.'));
      var go = U.el('div', 'btn', 'Connect');
      setupEl.appendChild(go);
      fields.push({ el: go, kind: 'go' });
      var test = U.el('div', 'btn', 'Test connection'); setupEl.appendChild(test); fields.push({ el: test, kind: 'test' });
      var lg = U.el('div', 'btn', 'View log'); setupEl.appendChild(lg); fields.push({ el: lg, kind: 'log' });
      var rp = U.el('div', 'btn', 'Report a problem'); setupEl.appendChild(rp); fields.push({ el: rp, kind: 'report' });
      if (!editing) { var rm = U.el('div', 'btn', 'Set up or restore from a phone or computer'); setupEl.appendChild(rm); fields.push({ el: rm, kind: 'remote' }); }
      if (canCancel) { var cancel = U.el('div', 'btn', 'Cancel'); setupEl.appendChild(cancel); fields.push({ el: cancel, kind: 'cancel' }); }
      msg = U.el('div', 'msg'); setupEl.appendChild(msg);
      I18n.page(setupEl);
      var lv = setupEl.querySelector('.field.lang label');
      if (lv && lv.textContent !== 'Language') lv.textContent += '  ·  Language';
      // Magic Remote: click a field or button to use it.
      fields.forEach(function (x, i) {
        x.el.addEventListener('click', function (e) { if (e.target.classList.contains('eye')) return; f = i; paint(); if (x.kind !== 'input' || e.target !== x.input) UI.press('ok'); });
      });
      paint();
    }
    function paint() {
      fields.forEach(function (x, i) { x.el.classList.toggle('focus', i === f); });
      // The buttons sit below the fold on a 1080 screen: keep the focused row in view.
      var el = fields[f] && fields[f].el;
      if (el && !setupEl.classList.contains('kb')) {
        var bottom = el.offsetTop + el.offsetHeight + 60, view = setupEl.clientHeight;
        setupEl.scrollTop = bottom > view ? bottom - view : 0;
      }
    }
    /* A brand-new TV: a QR code beside the form, so the playlist can be typed on a phone (or a backup
       restored) instead of with the remote.  The web editor starts only here, on a TV with no playlist. */
    function joinPanel() {
      var card = U.el('div', 'join'), qr = U.el('div', 'join-qr'), txt = U.el('div', 'join-txt');
      card.appendChild(U.el('div', 'join-h', 'Easier on your phone'));
      card.appendChild(U.el('div', 'join-p', 'Scan with your phone\'s camera to type your login there, or restore a backup.'));
      card.appendChild(qr); card.appendChild(txt);
      setupEl.appendChild(card);
      function show(s) { if (setupEl.contains(card)) { WebEdit.drawJoin(qr, txt, '', s, 'Or open the address on a computer.', 'A phone or computer is connected.  Finish there; this screen moves on by itself.'); I18n.page(card); } }
      txt.appendChild(U.el('div', 'remote-s', 'Starting…'));
      WebEdit.onStatus = show;
      (WebEdit.on ? Promise.resolve(WebEdit.status) : WebEdit.start()).then(show, function (e) { txt.innerHTML = ''; txt.appendChild(U.el('div', 'remote-s', 'The phone option is not available: ' + e.message)); });
    }
    function kbFocus(row) {
      setupEl.classList.add('kb');
      // Scroll so the row sits near the top, well clear of the keyboard.
      setupEl.scrollTop = Math.max(0, row.offsetTop - 140);
    }
    function kbBlur() {
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && setupEl.contains(a)) return;
      setupEl.classList.remove('kb'); setupEl.scrollTop = 0;
    }
    function leave() { setupEl.classList.add('hidden'); if (ready) Views.switchTab('settings'); }

    // Fresh TV: start the web editor so a computer can restore a backup (logins included) or add a playlist.
    function remote() {
      setupEl.innerHTML = '';
      setupEl.classList.remove('withjoin');
      setupEl.appendChild(U.el('h1', '', 'Set up from a phone or computer'));
      setupEl.appendChild(U.el('p', 'lead', 'Scan the code with your phone\'s camera, or open the address on a computer on the same network and type the password.  Add your playlist there with a real keyboard, or restore a backup file.'));
      var box = U.el('div', 'remote-box withqr'), qrEl = U.el('div', 'join-qr'), info = U.el('div', ''); box.appendChild(qrEl); box.appendChild(info); setupEl.appendChild(box);
      var back = U.el('div', 'btn focus', 'Back'); setupEl.appendChild(back);
      back.addEventListener('click', function () { UI.press('back'); });
      function show(s) { WebEdit.drawJoin(qrEl, info, '', s, 'Waiting for a phone or computer…', 'Connected.  Finish there; this screen moves on by itself.'); }
      info.appendChild(U.el('div', 'remote-s', 'Starting the editor…'));
      WebEdit.onStatus = function (s) { if (setupEl.contains(box)) show(s); };
      (WebEdit.on ? Promise.resolve(WebEdit.status) : WebEdit.start()).then(show, function (e) { box.innerHTML = ''; box.appendChild(U.el('div', 'msg err', e.message)); });
      UI.setHandler(function (a) {
        if (a === 'back' || a === 'ok') { WebEdit.onStatus = null; setup(target); }
        return true;
      });
    }

    /* Full link: what TiviBro found in it, as you type or paste. */
    var TYPES = { link: 'Full link (paste from your provider)', xtream: 'Xtream Codes', m3u: 'M3U playlist' };
    var linkNote = null;
    function host(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ''); return m ? m[1] : u; }
    function showLink() {
      if (!linkNote) return;
      var r = Links.parse(p.link);
      linkNote.className = 'net linknote' + (r && !r.bare ? ' ok' : '');
      linkNote.textContent = !r ? '' : r.type === 'xtream' ? 'Found an Xtream Codes login for ' + host(r.server) + ' (username ' + r.user + ').  Connect fills it in and logs in.'
        : r.bare ? 'That is a server address without a login.  Paste the whole link, or choose Xtream Codes as the type and type the username and password.'
        : 'No login in this link, so it will be added as an M3U playlist.';
    }
    // Turns a Full link into an Xtream login or an M3U address, shown in its own section.  False when
    // there is nothing usable, with the reason on screen.
    function useLink() {
      if (p.type !== 'link') return true;
      var r = Links.parse(p.link);
      if (!r || r.bare) { msg.className = 'msg err'; msg.textContent = r ? 'That is a server address without a login.  Paste the whole link from your provider.' : 'Paste the full link from your provider.'; return false; }
      if (r.type === 'xtream') { p.type = 'xtream'; p.server = r.server; p.user = r.user; p.pass = r.pass; }
      else { p.type = 'm3u'; p.m3u = r.m3u; }
      delete p.link;
      Log.info('app', 'Full link read as ' + (r.type === 'xtream' ? 'an Xtream Codes login (' + r.from + ')' : 'an M3U playlist'));
      render();
      return true;
    }
    function nextType() { var order = editing ? ['xtream', 'm3u'] : ['link', 'xtream', 'm3u']; p.type = order[(order.indexOf(p.type) + 1) % order.length]; render(); }
    function current() {
      var t = Object.assign({}, p);
      ['server', 'user', 'pass', 'm3u'].forEach(function (k) { if (t[k]) t[k] = String(t[k]).trim(); });
      if (t.guide && t.guide.trim()) t.epgSources = [{ url: t.guide.trim(), offset: 0 }];
      return Store.normalize(t);
    }
    function toggleNet() {
      Store.settings.network = Store.settings.network === 'direct' ? 'auto' : 'direct';
      Store.saveSettings();
      Log.info('app', 'Network set to ' + Store.settings.network + ' from the setup screen');
      if (Store.settings.network === 'auto') Net.start(6000).then(render); else render();
    }
    function connect() {
      if (!useLink()) return;
      msg.className = 'msg'; msg.textContent = 'Connecting…';
      var test = Object.assign({}, p);
      if (!test.name) test.name = test.type === 'xtream' ? (test.user || 'Xtream') : 'M3U playlist';
      if (test.guide && test.guide.trim()) test.epgSources = [{ url: test.guide.trim(), offset: 0 }];
      delete test.guide;
      ['server', 'user', 'pass', 'm3u'].forEach(function (k) { if (test[k]) test[k] = String(test[k]).trim(); });
      if (test.type === 'xtream' && !(test.server && ((test.user && test.pass) || Source.credsFromLink(test.server)))) { msg.className = 'msg err'; msg.textContent = 'Enter the server, username and password.'; return; }
      if (test.type === 'm3u' && !test.m3u) { msg.className = 'msg err'; msg.textContent = 'Enter the playlist address.'; return; }
      if (!test.id) test.id = 'p' + Date.now().toString(36);
      Source.load(test).then(function (data) {
        adopt(test, data);
        Store.upsertPlaylist(test);
        return Store.bigSet(cacheKey(test), data).then(function () { return data; });
      }).then(function (data) {
        setupEl.classList.add('hidden');
        // Another playlist next to the one already in use: it is added beside it, and the first
        // playlist (with your Favorites and groups) stays first.
        // A changed connection of another playlist that is on: it opens again beside the first one.
        if (ready && Store.playlist.id && Store.playlist.id !== test.id && !test.off) {
          Settings.reset();
          Views.switchTab('settings');
          if (editing) dropOther(test.id);
          else U.toast('"' + (test.name || 'Playlist') + '" added.  Its channels are under its own name in the group list.', 6000);
          // A new playlist: its own set-up tour, for its channels (as for the first one).
          if (addOther(test, data) && !editing) setTimeout(function () { if (!Tour.isOpen) Tour.open({ first: true, from: 'settings', pl: test.id }); }, 400);
          return;
        }
        if (Store.settings.active !== test.id) Store.usePlaylist(test.id);
        Settings.reset();
        start(data, false);
        // A new playlist: the set-up tour (countries, names, East or West, city, logos, look).
        if (!editing) Tour.open({ first: true });
      }).catch(function (e) {
        msg.className = 'msg err';
        msg.textContent = (e.message || String(e)) + '   Press Test connection for details.';
      });
    }

    UI.setHandler(function (a) {
      var cur = fields[f];
      if (a === 'up') { if (f > 0) { f--; paint(); } }
      else if (a === 'down' || a === 'submit') {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (f < fields.length - 1) { f++; paint(); if (a === 'submit' && fields[f].input) fields[f].input.focus(); }
      }
      else if (a === 'left' || a === 'right') {
        if (cur.kind === 'net') toggleNet();
        else if (cur.kind === 'lang') nextLang(a === 'left' ? -1 : 1);
        else if (cur.toggle && document.activeElement !== cur.input) cur.toggle();
        else if (cur.kind === 'type') nextType();
        else if ((cur.kind === 'go' || cur.kind === 'test' || cur.kind === 'log' || cur.kind === 'report') && a === 'right' && fields[f + 1]) { f++; paint(); }
        else if ((cur.kind === 'test' || cur.kind === 'log' || cur.kind === 'report' || cur.kind === 'cancel') && a === 'left') { f--; paint(); }
      }
      else if (a === 'ok') {
        if (cur.kind === 'input') cur.input.focus();
        else if (cur.kind === 'type') nextType();
        else if (cur.kind === 'lang') nextLang(1);
        else if (cur.kind === 'go') connect();
        else if (cur.kind === 'net') toggleNet();
        else if (cur.kind === 'test') { if (useLink()) Diag.run(current()); }
        else if (cur.kind === 'log') Diag.showLog(true);
        else if (cur.kind === 'report') Diag.openReport(true);
        else if (cur.kind === 'remote') remote();
        else if (cur.kind === 'cancel') leave();
      }
      else if (a === 'back' && canCancel) leave();
      else if (a === 'back' && !target) Views.exitApp(true);      // first screen: Back twice closes TiviBro
      return true;
    });
    render();
  }

  function loading(text) {
    setupEl.classList.remove('hidden');
    setupEl.innerHTML = '';
    var lb = U.el('img', 'loadbrand'); lb.src = 'img/wordmark.png'; lb.alt = 'TiviBro'; setupEl.appendChild(lb);
    setupEl.appendChild(U.el('p', 'lead', text));
  }

  /* ---------- start ---------- */
  var tourNext = false;     // the first playlist came from a phone or computer: show the set-up tour once it loads
  /* An M3U list's movies and shows (kept by the network helper when it read the list, service/vod.js):
     Movies and Shows appear when the last load found any, and go when it found none. */
  function noteVod(p, data) {
    if (p.type !== 'm3u' || !data || !data.vod) return false;
    var v = data.vod, was = p.vod || {}, now = { movies: v.movies > 0, series: v.series > 0, m3u: 1, at: data.at || Date.now() };
    if (!!was.m3u && was.movies === now.movies && was.series === now.series) return false;
    p.vod = now; Store.upsertPlaylist(p);
    Log.info('app', 'This M3U list has ' + v.movies + ' movies and ' + v.series + ' shows: they are in Movies and Shows');
    return true;
  }
  function start(data, fromCache) {
    noteVod(Store.playlist, data);
    Source.setTz(data.tz); Events.setProviderTz(data.tz);
    Library.set(data);
    Logos.load(data);
    Vod.reset();
    if (!ready) { Views.init(); Watch.start(); Remind.start(); ready = true; if (typeof Media !== 'undefined' && Media.autoSoon) Media.autoSoon(45000); if (typeof Movies !== 'undefined') Movies.start(); }   // movies still without details or posters
    window.__tbBooted = true;              // compat.js shows an error screen if errors stop the start
    Views.stopAll();
    Views.reload(false);
    Views.switchTab(Views.home());
    Views.setZone('channels');
    setupEl.classList.add('hidden');
    checkVod();
    setTimeout(function () { bigList(Store.playlist); }, 8000);
    // The other playlists that are on, from their kept copies; then the guide, for all of them.  The
    // guide loads after first paint so it never delays the channel list.
    var gen = ++startGen, last = Store.edits.last, later = !!(last && !Library.find(last) && Store.others().length);
    openOthers(gen).then(function () {
      if (gen !== startGen) return;
      if (later) Views.resume();                   // the last channel was one of another playlist's
      setTimeout(function () { Epg.init(Library); }, fromCache ? 1500 : 300);
      // A reminder can be for a channel of another playlist: once they are all in.
      if (pendingRem) { var pr = pendingRem; pendingRem = null; setTimeout(function () { openReminder(pr); }, 600); }
    });
    if (!later) Views.resume();
    if (tourNext) { tourNext = false; setTimeout(function () { if (!Tour.isOpen) Tour.open({ first: true }); }, 400); }
  }

  /* Movies and Shows only appear when the provider actually offers them.  Small requests in the
     background; the menu updates when they answer.  Not offered = hidden.  Some panels list
     categories with nothing in them (a real provider had 41 show categories and no shows), so a
     kind with categories also needs at least one title: up to three categories are asked on
     their own (small answers), and only if all are empty is the whole list asked for, which is
     then small too. */
  // p: another playlist that is on (several playlists on); the first playlist when not given.
  function checkVod(p) {
    p = p || Store.playlist;
    if (p.type !== 'xtream') return;
    var list = function (action, extra) {
      return U.getJSON(Source.api(p, action, extra || ''), extra ? 20000 : 90000).then(function (j) { return Array.isArray(j) ? j : []; }, function () { return null; });
    };
    function offered(cats, listAction) {
      if (cats === null) return Promise.resolve(null);
      if (!cats.length) return Promise.resolve(0);
      var picks = [cats[0], cats[Math.floor(cats.length / 2)], cats[cats.length - 1]].filter(function (c, i, a) { return c && a.indexOf(c) === i; });
      var i = 0;
      function next() {
        if (i >= picks.length) return list(listAction).then(function (all) { return all === null ? null : all.length; });
        var c = picks[i++];
        return list(listAction, '&category_id=' + encodeURIComponent(c.category_id)).then(function (items) { return items && items.length ? items.length : next(); });
      }
      return next();
    }
    Promise.all([list('get_vod_categories'), list('get_series_categories')]).then(function (c) {
      if (c[0] === null && c[1] === null) return;               // could not tell: keep what we knew
      return Promise.all([offered(c[0], 'get_vod_streams'), offered(c[1], 'get_series')]).then(function (r) {
        var old = p.vod || {};
        var v = { movies: r[0] === null ? !!old.movies : !!r[0], series: r[1] === null ? !!old.series : !!r[1], at: Date.now() };
        var say = function (cats, n) { return cats === null ? 'could not tell' : !cats.length ? 'no' : n ? 'yes (' + cats.length + ' categories)' : n === 0 ? 'no (' + cats.length + ' categories, all empty)' : 'could not tell'; };
        Log.info('app', 'Provider offers movies: ' + say(c[0], r[0]) + ', shows: ' + say(c[1], r[1]));
        if (old.movies === v.movies && old.series === v.series) return;
        p.vod = v; Store.upsertPlaylist(p);
        Views.buildTabs();
      });
    });
  }

  /* ---------- the other playlists (several playlists on) ----------
     The first playlist opens as it always has (open, start).  Then every other playlist that is on is
     added from the copy kept of its list (Store.bigGet 'playlist:<id>'), one at a time, and its edits
     are attached (Store.attach): Library.setOther puts its groups under its name.  A playlist with no
     kept copy, or one due for a reload, is loaded from the provider in the background, one at a
     time, through the same guard as Reload channels (refresh).  Together they may not pass
     multiMax() channels: one that would is left out, with a message, so a TV is never run out of memory.
     On a TV with 1 GB of memory, or one that closed TiviBro while playing this week (Player.memSafe),
     the limit is lower and background loads wait until nothing plays. */
  var startGen = 0, otherQ = [];
  function memSafe() { return !!(window.Player && Player.memSafe); }
  // webOS closes an app at about 500 MB whatever the TV has, so more memory does not raise it.
  function multiMax() { return memSafe() ? 120000 : 250000; }
  // What is in the lists now, for the log (and a problem report).
  function loadedLog() {
    var parts = Store.loaded().map(function (p) { var d = Library.partOf(p.id); return (p.name || 'Playlist') + ' ' + (d ? d.channels.length : 0); });
    var skipped = Store.others().filter(function (p) { return Library.otherIds().indexOf(p.id) < 0; }).map(function (p) { return p.name || 'Playlist'; });
    if (parts.length > 1 || skipped.length) Log.info('app', 'Playlists in the lists: ' + parts.join(', ') + ' (' + Library.count() + ' channels of at most ' + multiMax() + (memSafe() ? ', memory-safe' : '') + ')' +
      (skipped.length ? '; not in yet: ' + skipped.join(', ') : ''));
  }
  function openOthers(gen) {
    var list = Store.others(), chain = Promise.resolve(), fresh = false;
    list.forEach(function (p) {
      chain = chain.then(function () {
        if (gen !== startGen || p.off || p.id === Store.settings.active) return;
        // Its size from its last load (p.chans): one that can't fit is not even read into memory.
        if (+p.chans && !fits(p, +p.chans)) return;
        return Store.bigGet(cacheKey(p)).then(function (cached) {
          if (gen !== startGen) return;
          if (cached && cached.sig === Source.sig(p) && cached.channels && cached.channels.length) {
            if (!useOther(p, cached)) return;
            Log.info('app', 'Added ' + cached.channels.length + ' channels of ' + (p.name || 'another playlist') + ' kept from its last load');
            if (plDue(p, cached.at, true)) otherQ.push(p.id);
          } else { otherQ.push(p.id); fresh = true; }       // never loaded on this TV: soon
        }).catch(function (e) { Log.warn('app', 'Could not open ' + (p.name || 'another playlist') + ': ' + (e && e.message || e)); });
      });
    });
    return chain.then(function () {
      if (gen !== startGen) return;
      if (Library.multi) {
        Logos.load(Library.data); Views.refreshLists(true); if (window.Settings && Settings.live) Settings.live();
        // Their movies and shows (Movies and Shows show every playlist's), checked like the first's.
        Library.otherIds().forEach(function (id) { var o = Store.byId(id); if (o) { if (noteVod(o, Library.partOf(id))) Views.buildTabs(); checkVod(o); } });
      }
      loadedLog();
      if (otherQ.length) setTimeout(nextOther, fresh ? 3000 : 15000);
    });
  }
  // Put another playlist's data in the lists, with its edits.  False when it would be too many channels.
  // Would a playlist of n channels fit beside the ones in the lists now?  Says so when it doesn't.
  function fits(p, n) {
    var now = Library.count() - ((Library.partOf(p.id) || { channels: [] }).channels.length);
    if (now + n <= multiMax()) return true;
    Log.warn('app', 'Left out ' + (p.name || 'a playlist') + ': with its ' + n + ' channels the playlists that are on would have ' + (now + n) + ', more than this TV holds (' + multiMax() + (memSafe() ? ', memory-safe' : '') + ')');
    U.toast('"' + (p.name || 'A playlist') + '" is not shown: together the playlists that are on have too many channels for this TV.  Turn one off in Settings > Playlists.', 9000);
    return false;
  }
  function useOther(p, data) {
    if (+p.chans !== data.channels.length) { p.chans = data.channels.length; Store.upsertPlaylist(p); }
    if (!fits(p, data.channels.length)) return false;
    Store.attach(p.id);
    if (typeof Vod !== 'undefined') Vod.reset();          // Movies and Shows load again with it
    Source.setTz(data.tz, p.id); Events.setProviderTz(data.tz, p.id);
    Library.setOther(p.id, data);
    return true;
  }
  // Take another playlist out of the lists (turned off), with its edits.
  function dropOther(id) {
    // What plays from it stops: its channel (or movie) is no longer in the lists.
    var pv = Views.vod && Views.vod.meta;
    if ((Views.playing && Views.playing.p === id) || (Views.mode === 'vod' && pv && pv.p === id)) { Views.stopAll(); Log.info('app', 'Stopped what was playing: its playlist was taken out'); }
    var had = Library.dropOther(id);
    Store.detach(id);
    if (had && typeof Vod !== 'undefined') Vod.reset();
    otherQ = otherQ.filter(function (x) { return x !== id; });
    return had;
  }
  // A playlist just added from the set-up screen, with its first load.
  function addOther(p, data) {
    if (!useOther(p, data)) return false;
    Logos.load(Library.data);
    Views.refreshLists(true);
    if (window.Settings && Settings.live) Settings.live();
    checkVod(p); noteVod(p, data);
    loadedLog();
    setTimeout(function () { Epg.init(Library); }, 300);
    return true;
  }
  // Background loads of the other playlists, one at a time, never while a reload runs.
  function nextOther() {
    if (!otherQ.length) return;
    if (reloading || Source.loading || (memSafe() && Views.playing) || (memSafe() && Views.mode === 'vod')) { setTimeout(nextOther, 20000); return; }
    var id = otherQ.shift();
    refresh(false, id).then(function () { loadedLog(); if (otherQ.length) setTimeout(nextOther, 5000); });
  }
  /* Settings changed which playlists are on: add the ones turned on, take out the ones turned off.
     The first playlist is not touched here (switchPlaylist does that). */
  function playlistsChanged() {
    if (!ready) return Promise.resolve();
    var on = {}, changed = false;
    Store.others().forEach(function (p) { on[p.id] = 1; });
    Library.otherIds().forEach(function (id) { if (!on[id]) { dropOther(id); changed = true; Log.info('app', 'Took a playlist out of the lists (turned off)'); } });
    var have = {}; Library.otherIds().forEach(function (id) { have[id] = 1; });
    var gen = startGen, chain = Promise.resolve();
    Store.others().forEach(function (p) {
      if (have[p.id]) return;
      chain = chain.then(function () {
        return Store.bigGet(cacheKey(p)).then(function (cached) {
          if (gen !== startGen) return;
          if (cached && cached.sig === Source.sig(p) && cached.channels && cached.channels.length) { if (useOther(p, cached)) changed = true; }
          else if (otherQ.indexOf(p.id) < 0) { otherQ.push(p.id); U.toast('Loading the channels of ' + (p.name || 'the playlist'), 4000); }
        });
      });
    });
    return chain.then(function () {
      if (otherQ.length) setTimeout(nextOther, 300);
      if (!changed) return;
      Logos.load(Library.data);
      Views.refreshLists(true);
      if (window.Settings && Settings.live) Settings.live();
      Epg.init(Library);
    });
  }

  /* Reload the channel list.  One at a time: a second ask (Reload channels while the scheduled reload
     runs) waits for that one, with nothing loaded twice (issue #25).
     id: another playlist that is on (several playlists on); the first playlist when not given. */
  var reloading = null;
  function refresh(manual, id) {
    if (id && id !== Store.settings.active) return refreshOther(manual, id);
    if (reloading) { if (manual) U.toast('Already reloading the channels'); return reloading; }
    var p = Store.playlist;
    if (manual) U.toast('Reloading channels');
    Log.info('app', (manual ? 'Reloading' : 'Scheduled reload of') + ' the channel list (' + Library.count() + ' channels now)');
    busyStart(p, 'reloading');
    reloading = Source.load(p).then(function (data) {
      if (data.fixed) Store.upsertPlaylist(adopt(p, data));
      carryAdded(Library.main || Library.data, data);
      Store.bigSet(cacheKey(p), data);
      Source.setTz(data.tz); Events.setProviderTz(data.tz);
      Library.set(data);
      Logos.load(data);
      if (data.vod) { Vod.reset(); if (noteVod(p, data)) Views.buildTabs(); }
      Views.refreshLists(true);
      Settings.live();
      if (manual) U.toast(Library.count() + ' channels loaded');
      bigList(p);
      busyEnd(10000);
    }).catch(function (e) {
      busyEnd(0);
      if (e && e.kind === 'stopped') U.toast('Stopped reloading.  The channels from the last load are still here.', 5000);
      else if (manual) U.toast(e.message || 'Reload failed', 4000);
    }).then(function () { reloading = null; if (window.Settings && Settings.live) Settings.live(); });
    if (window.Settings && Settings.live) Settings.live();
    return reloading;
  }
  // Another playlist's reload: the same guard, its data saved as its own, then put in the lists.
  function refreshOther(manual, id) {
    var p = Store.byId(id);
    if (!p || p.off) return Promise.resolve();
    if (reloading) { if (manual) U.toast('Already reloading the channels'); return reloading; }
    if (manual) U.toast('Reloading ' + (p.name || 'the playlist'));
    Log.info('app', (manual ? 'Reloading' : 'Background load of') + ' the channel list of ' + (p.name || 'another playlist'));
    busyStart(p, 'reloading');
    var gen = startGen, old = Library.partOf(id), freed = false;
    /* Memory-safe (1 GB, or closed while playing): a big list leaves the lists while its new copy
       loads, so the TV never holds both; if the load fails, the kept copy comes back. */
    if (memSafe() && old && old.channels.length > 30000) {
      Log.info('app', 'Memory-safe: taking ' + (p.name || 'the playlist') + ' (' + old.channels.length + ' channels) out while it reloads');
      dropOther(id); Views.refreshLists(true); old = null; freed = true;
    }
    reloading = Source.load(p).then(function (data) {
      if (data.fixed) Store.upsertPlaylist(adopt(p, data));
      carryAdded(old, data, id + ':');
      // Saved before Library.setOther puts the playlist's id in front of its keys.
      return Store.bigSet(cacheKey(p), data).then(function () {
        if (gen !== startGen || p.off || id === Store.settings.active) return;
        if (!useOther(p, data)) return;
        Logos.load(Library.data);
        Views.refreshLists(true);
        if (noteVod(p, data)) Views.buildTabs();
        checkVod(p);                                  // its movies and shows join Movies and Shows
        if (manual) U.toast((p.name || 'Playlist') + ': ' + data.channels.length + ' channels loaded');
        Epg.init(Library);
      });
    }).then(function () { busyEnd(10000); }, function (e) {
      busyEnd(0);
      // Back from its kept copy (only that: no new load, so a failing provider can't loop).
      if (freed) Store.bigGet(cacheKey(p)).then(function (c) {
        if (gen === startGen && !p.off && c && c.channels && c.channels.length && useOther(p, c)) { Views.refreshLists(true); Epg.init(Library); }
      });
      if (e && e.kind === 'stopped') U.toast('Stopped reloading.  The channels from the last load are still here.', 5000);
      else if (manual) U.toast((p.name || 'Playlist') + ': ' + (e.message || 'reload failed'), 5000);
      else Log.warn('app', 'Could not load ' + (p.name || 'another playlist') + ': ' + (e && e.message || e));
    }).then(function () { reloading = null; if (window.Settings && Settings.live) Settings.live(); });
    if (window.Settings && Settings.live) Settings.live();
    return reloading;
  }
  // Stop reloading (Settings > Playlists and guide, issue #25): the channels from the last load stay.
  function stopReload() { return !!reloading && Source.stop(Store.playlist.id); }

  /* ---------- a playlist that keeps closing TiviBro (issue #25) ----------
     While a channel list loads, or a big one is opened, a marker says so.  If TiviBro closes on its own
     during that twice in a row, the playlist's reload is set to Only when I ask and the next start asks
     what to do instead of loading it a third time.  The marker goes once the list has been on screen
     for a few seconds. */
  var BUSY = 'tivibro.plBusy', TRIES = 'tivibro.plCrash', busyT = 0;
  function busyStart(p, how) {
    clearTimeout(busyT);
    try { localStorage.setItem(BUSY, JSON.stringify({ pid: p.id, how: how, t: Date.now() })); } catch (e) {}
    Log.state('playlist', how + ' the channel list of ' + (p.name || 'the playlist'));
  }
  function busyEnd(after) {
    clearTimeout(busyT);
    busyT = setTimeout(function () {
      try { localStorage.removeItem(BUSY); localStorage.removeItem(TRIES); } catch (e) {}
      Log.state('playlist', '');
    }, after || 0);
  }
  /* Closed while playing (issues #42, #46): for a week after, playback holds less video in memory
     (player.js, memory-safe).  Each new close while playing starts the week again. */
  var PLAYSAFE = 'tivibro.playSafe';
  function playSafe(gone) {
    var ps = null;
    try { ps = JSON.parse(localStorage.getItem(PLAYSAFE) || 'null'); } catch (e) {}
    var now = Date.now(), live = ps && ps.until > now;
    if (gone && gone.doing && gone.doing.player) {
      ps = { until: now + 7 * 86400e3, n: (live ? ps.n : 0) + 1 };
      try { localStorage.setItem(PLAYSAFE, JSON.stringify(ps)); } catch (e) {}
      live = true;
    }
    if (live) Player.memorySafe('TiviBro closed while playing ' + (ps.n > 1 ? ps.n + ' times' : 'once') + ' this week');
  }
  function crashGuard(gone) {
    var busy = null, tries = null;
    try { busy = JSON.parse(localStorage.getItem(BUSY) || 'null'); tries = JSON.parse(localStorage.getItem(TRIES) || 'null'); localStorage.removeItem(BUSY); } catch (e) {}
    if (!gone || !busy || !busy.pid) return null;
    var p = Store.settings.playlists.filter(function (x) { return x.id === busy.pid; })[0];
    if (!p) return null;
    var n = tries && tries.pid === busy.pid && Date.now() - (tries.t || 0) < 6 * 3600e3 ? tries.n + 1 : 1;
    try { localStorage.setItem(TRIES, JSON.stringify({ pid: busy.pid, n: n, t: Date.now() })); } catch (e) {}
    Log.warn('app', 'TiviBro closed while ' + busy.how + ' the channel list of ' + (p.name || 'a playlist') + (n > 1 ? ' (' + n + ' times in a row)' : ''));
    if (n < 2) return null;
    var was = +p.plRefresh;
    if (was !== 0) { p.plRefresh = 0; Store.upsertPlaylist(p); Log.warn('app', 'Set ' + (p.name || 'the playlist') + ' to reload only when asked, so it does not close TiviBro again'); }
    return { p: Store.normalize(p), how: busy.how, n: n, was: was };
  }
  function guarded(g) {
    var p = g.p, name = p.name || 'this playlist';
    if (Store.settings.active !== p.id) return open(Store.playlist);
    var title = 'TiviBro closed ' + (g.n > 2 ? g.n + ' times' : 'twice') + ' while ' + g.how + ' ' + name;
    // Reloading broke it: the list from before is still kept, so open that; the next reload waits to be asked.
    if (g.how === 'reloading') {
      return open(p).then(function () {
        setTimeout(function () {
          UI.panel(title, U.el('p', 'panel-text', 'So it doesn\'t happen again, its channel list now reloads only when you ask, and the channels from its last good load are here.  ' +
            'If it has grown too big for this TV, ask your provider for a smaller list.'), [
            { label: 'OK' },
            { label: 'Playlist settings', action: function () { openPlaylistSettings(p.id); } }
          ]);
        }, 800);
      });
    }
    // Loading or opening it is what closes TiviBro: ask before trying again.
    loading(title);
    var others = Store.settings.playlists.filter(function (x) { return x.id !== p.id && !x.off; });
    function ask() {
      UI.menu(title, [
        { label: 'Try loading it again', sub: 'it may close TiviBro again', action: function () { open(p); } },
        { label: 'Change the connection', sub: 'the server, login or playlist address', action: function () { setup(p.id); } }
      ].concat(others.map(function (o) { return { label: 'Use ' + (o.name || 'another playlist'), action: function () { switchPlaylist(o.id); } }; }))
        .concat([{ label: 'Add another playlist', action: function () { setup('new'); } }]), function () { setTimeout(ask, 0); });
    }
    UI.setHandler(function () { ask(); return true; });
    ask();
  }
  function openPlaylistSettings(id) {
    if (!ready) return setup(id);
    Views.switchTab('settings');
    if (Settings.openPlaylist) Settings.openPlaylist(id);
  }
  /* A playlist bigger than a TV comfortably holds (186,928 channels on a 32-inch 2022 set, issues #24
     and #25): say so once, with what helps.  Every reload of such a list is a big moment for the TV. */
  var BIG = 100000;
  function bigList(p) {
    var part = Library.partOf(p.id), n = part ? part.channels.length : Library.count();      // that playlist's own, several on
    if (n < BIG || p.bigNoted) return;
    Log.warn('app', 'This playlist has ' + n + ' channels, more than most TVs comfortably hold.  Reloading it is the hardest moment for the TV.');
    p.bigNoted = 1; Store.upsertPlaylist(p);
    U.toast(n.toLocaleString() + ' channels is a very big playlist for a TV.  If TiviBro closes after reloading it, set Settings > Playlists > ' + (p.name || 'this playlist') + ' > Reload channel list to Only when I ask, or ask your provider for a smaller list.', 14000);
  }

  function open(p) {
    loading('Loading ' + (p.name || 'channels') + '…');
    return Store.bigGet(cacheKey(p)).then(function (cached) {
      if (cached && cached.sig === Source.sig(p) && cached.channels && cached.channels.length) {
        Log.info('app', 'Opened ' + cached.channels.length + ' channels kept from the last load');
        var big = cached.channels.length >= BIG;
        if (big) busyStart(p, 'opening');
        start(cached, true);
        if (big) busyEnd(10000);
        if (plDue(p, cached.at, true)) setTimeout(function () { refresh(false); }, 15000);
        return;
      }
      // Downloading the list: Back offers to stop (a list that is too big, or a server that never answers).
      busyStart(p, 'loading');
      setupEl.appendChild(U.el('p', 'lead', 'Press Back to stop.'));
      UI.setHandler(function (a) { if (a === 'back') askStop(p); return true; });
      return Source.load(p).then(function (data) {
        if (data.fixed) Store.upsertPlaylist(adopt(p, data));
        Store.bigSet(cacheKey(p), data); start(data, false);
        busyEnd(10000);
      });
    }).catch(function (e) {
      busyEnd(0);
      if (e && e.kind === 'stopped') return;           // askStop has already moved on
      Log.error('app', 'Could not open playlist "' + (p.name || p.id) + '": ' + (e && e.message));
      // Other playlists are on: one of them can be first for now (nothing plays by itself).
      var others = Store.others();
      if (others.length && !ready) {
        loading('Could not load ' + (p.name || 'the first playlist') + ': ' + (e.message || 'no answer'));
        var ask = function () {
          UI.menu('Could not load ' + (p.name || 'the first playlist'), [
            { label: 'Try again', action: function () { open(p); } },
            { label: 'Change the connection', sub: 'the server, login or playlist address', action: function () { setup(p.id); } }
          ].concat(others.map(function (o) { return { label: 'Make ' + (o.name || 'another playlist') + ' the first playlist', sub: 'your Favorites and groups are each first playlist\'s own', action: function () { switchPlaylist(o.id); } }; })), function () { setTimeout(ask, 0); });
        };
        UI.setHandler(function () { ask(); return true; });
        return ask();
      }
      setup(p.id);
      U.toast((e.message || 'Could not load the playlist') + '  Test connection shows details.', 7000);
    });
  }
  function askStop(p) {
    if (!Source.loading) return;
    var others = Store.settings.playlists.filter(function (x) { return x.id !== p.id && !x.off; });
    function halt(then) { return function () { Source.stop(p.id); then(); }; }
    UI.menu('Stop loading ' + (p.name || 'this playlist') + '?', [
      { label: 'Keep waiting' },
      { label: 'Stop, and change the connection', sub: 'the server, login or playlist address', action: halt(function () { setup(p.id); }) }
    ].concat(others.map(function (o) { return { label: 'Stop, and use ' + (o.name || 'another playlist'), action: halt(function () { switchPlaylist(o.id); }) }; }))
      .concat([{ label: 'Stop, and add another playlist', action: halt(function () { setup('new'); }) }]));
  }

  // Is a playlist reload due?  hours: -1 every app start, 0 manual only, otherwise an interval.
  function plDue(p, at, atStart) {
    var h = +p.plRefresh;
    if (h === -1) return !!atStart;
    if (h <= 0) return false;
    return Date.now() - (at || 0) > h * 3600e3;
  }
  // While the app stays open (TVs rarely restart apps), check the schedules every 30 minutes.
  setInterval(function () {
    if (!ready || document.hidden) return;
    var p = Store.playlist;
    if (plDue(p, (Library.main || Library.data).at, false)) refresh(false);
    else Library.otherIds().forEach(function (id) {
      var o = Store.byId(id), d = Library.partOf(id);
      if (o && d && plDue(o, d.at, false) && otherQ.indexOf(id) < 0) { otherQ.push(id); setTimeout(nextOther, 1000); }
    });
    var eh = +p.epgRefresh;
    if (Epg.xml && !Epg.loading && eh > 0 && Date.now() - (Epg.status.at || 0) > eh * 3600e3) Epg.refresh(Library, true);
  }, 30 * 60e3);

  // Launch params as an object: webOS hands them over as an object or as JSON text.
  function rawParams(p) { if (typeof p === 'string') { try { p = JSON.parse(p || '{}'); } catch (e) { p = {}; } } return p && typeof p === 'object' ? p : {}; }
  function launchParams() { var sys = window.webOSSystem || window.PalmSystem; return rawParams(sys && sys.launchParams); }

  /* Watch on the TV's reminder alert: TiviBro starts with launch params, or (already running)
     gets them in webOSRelaunch.  A reminder for another playlist switches to it first. */
  var pendingRem = Remind.launchParams();
  function openReminder(r) {
    var other = r.pid && r.pid !== Store.settings.active && Store.byId(r.pid);
    // Set while another playlist was first, and that playlist is on: its channel is in the lists already,
    // under the key it has now (several playlists on), so no switching.
    if (other && !other.off) r = Object.assign({}, r, { k: Store.keyFrom(r.pid, r.k), pid: Store.settings.active });
    else if (other) { pendingRem = r; switchPlaylist(r.pid); return; }
    Views.openReminder(r);
  }
  document.addEventListener('webOSRelaunch', function (e) {
    var sys = window.webOSSystem || window.PalmSystem;
    try { if (sys && sys.activate) sys.activate(); } catch (err) {}
    if (Phone.launched(rawParams(e && e.detail))) return;
    var r = Remind.params(e && e.detail);
    if (!r) return;
    Log.info('app', 'Brought forward by a reminder');
    if (ready && Library.count()) openReminder(r); else pendingRem = r;
  });

  /* Another playlist becomes the first one (or the only one): everything opens again, the others
     beside it. */
  function switchPlaylist(id) {
    if (ready) Views.stopAll();
    setupEl.classList.add('hidden');
    startGen++; otherQ = [];
    Library.clearOthers();
    Store.usePlaylist(id);
    Parental.lock();
    open(Store.playlist);
  }

  /* After a crash: a question, not a toast that is easy to miss.  The report it opens carries the
     log of the session that closed (Log.unclean says what it was doing). */
  function offerReport(gone, crash) {
    if (UI.modalOpen) return setTimeout(function () { offerReport(gone, crash); }, 5000);
    var what = gone ? 'TiviBro closed unexpectedly last time' + (gone.recent > 1 ? ' (' + gone.recent + ' times in the last hour)' : '') : 'TiviBro hit an error last time';
    var sub = gone ? gone.text : crash.m;
    UI.menu(what, [
      { label: 'Send a report now', sub: 'straight from the TV, with the log, logins and server names taken out', action: function () {
        U.toast('Sending the report…', 3000);
        Diag.sendNow(what, sub).then(function (j) { U.toast('Report sent, thank you.  It is issue #' + j.number + ' on GitHub.  TiviBro will tell you when the developer answers.', 8000); },
          function (e) { U.toast('The report could not be sent (' + ((e && e.message) || 'no connection') + ').  Settings > Updates, about and diagnostics > Report a problem sends it from your phone.', 9000); });
      } },
      { label: 'Report with my phone', sub: 'add what you were doing; scan a code with your phone', action: function () { Diag.openReport(); } },
      { label: 'Not now', sub: sub.length > 90 ? sub.slice(0, 88) + '…' : sub }
    ]);
  }

  function boot() {
    loading('Starting…');
    Log.info('app', 'TiviBro ' + TIVIBRO_VERSION + ' starting.  ' + navigator.userAgent);
    langStart();
    Caps.loadSystemInfo();
    Awake.start();                 // the TV's screensaver waits while something plays (issue #37)
    Net.start(6000).then(function () {
      WebEdit.resume();
      Phone.start();
      Phone.launched(launchParams());
      Update.whatsNew();             // the first start of a newer version: its notes, once
      Update.autoCheck();
      Update.countMe();
      Reports.start();
      // Something broke last time (an error, or TiviBro closed on its own): offer to report it, once.
      var crash = Log.lastCrash, gone = Log.settle(Net.info && Net.info.sys), key = gone ? 'u' + gone.s : crash ? crash.s : '';
      playSafe(gone);
      var guard = crashGuard(gone);
      if (key && localStorage.getItem('tivibro.crashSeen') !== key) {
        try { localStorage.setItem('tivibro.crashSeen', key); } catch (e) {}
        setTimeout(function () { offerReport(gone, crash); }, 2000);    // soon: in a loop the next close may not wait
      }
      if (!Store.settings.playlists.length) return setup();
      if (guard) return guarded(guard);
      open(Store.playlist);
    });
  }

  /* Languages (app/js/i18n.js): the fixed titles in the page, the TV's menu language asked and watched,
     everything drawn again after a change, and once, the first time TiviBro starts in a language other
     than English, where to change it. */
  var STATIC = '.col.groups > .col-title, #guideGroups > .col-title, #guidePreview > span, .media-heading, #spinnerText, .meter-label';
  function langStart() {
    try { document.documentElement.lang = I18n.lang(); } catch (e) {}
    var redo = function () { [].forEach.call(document.querySelectorAll(STATIC), function (el) { I18n.page(el); }); };
    redo();
    I18n.onChange(function (l) {
      Log.info('lang', 'Language: ' + l + (I18n.setting() === 'auto' ? ' (the TV\'s)' : ' (chosen)'));
      redo();
      if (ready) { Views.buildTabs(); Views.refreshLists(true); }
      Settings.redraw();
      UI.rehint();
    });
    I18n.askTV();
    setTimeout(function () {
      var s = Store.settings;
      if (s.langTold || I18n.lang() === 'en' || I18n.setting() !== 'auto') return;
      s.langTold = 1; Store.saveSettings();
      U.toast(I18n.t('TiviBro is in {x}, your TV\'s language.  Settings > Language changes it.', { x: I18n.name(I18n.lang()) }), 9000);
    }, 6000);
  }

  // Free the decoder when the TV sends the app to the background; resume on return.
  document.addEventListener('visibilitychange', function () {
    if (!ready) return;
    // Movies and catch-up come back where they were, and the spot is saved first in case the TV
    // closes the app while it is in the background.
    if (document.hidden) { if (Media.pauseScans) Media.pauseScans(); if (Vod.checkpoint) Vod.checkpoint(); Media.checkpoint(); wasPlaying = Player.suspend(); }
    else if (wasPlaying) { wasPlaying = false; Player.resume(); }
  });

  return { boot: boot, setup: setup, refresh: refresh, stopReload: stopReload, playlistsChanged: playlistsChanged,
    // Another playlist's login changed (web editor): open it again from its new copy.
    reopenOther: function (id) { dropOther(id); return playlistsChanged(); }, get reloading() { return !!reloading; }, openPlaylistSettings: openPlaylistSettings, bigList: bigList, switchPlaylist: switchPlaylist, tourNext: function () { tourNext = true; } };
})();

window.addEventListener('load', function () { App.boot(); });
