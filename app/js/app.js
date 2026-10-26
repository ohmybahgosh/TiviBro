/* Boot sequence, tuned for a fast cold start on a slow TV:
   1. Paint the cached channel list from IndexedDB immediately.
   2. Resume the last channel straight away if that option is on.
   3. Refresh the provider list and guide in the background afterwards. */
var App = (function () {
  'use strict';
  var $ = U.$, setupEl = $('viewSetup');
  var ready = false, wasPlaying = null;

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

  /* ---------- setup screen ----------
     target: undefined (first run), 'new' (add another), or a playlist id (edit). */
  function setup(target) {
    var editing = target && target !== 'new';
    var existing = editing ? Store.settings.playlists.filter(function (x) { return x.id === target; })[0] : null;
    var p = existing ? JSON.parse(JSON.stringify(existing)) : { id: '', name: '', type: 'xtream', server: '', user: '', pass: '', m3u: '', guide: '' };
    var canCancel = !!target && Store.settings.playlists.length > 0;
    setupEl.classList.remove('hidden');
    var fields = [], f = 0, msg;

    function render() {
      setupEl.innerHTML = '';
      if (!target) { var wb = U.el('img', 'setupbrand'); wb.src = 'img/wordmark.png'; wb.alt = 'TiviBro'; setupEl.appendChild(wb); }
      setupEl.appendChild(U.el('h1', '', editing ? 'Edit playlist' : target === 'new' ? 'Add a playlist' : 'Add your playlist'));
      setupEl.appendChild(U.el('p', 'lead', 'Use your provider\'s Xtream Codes login or an M3U playlist address.  A Dispatcharr or other proxy address works with either.'));
      fields = [];
      function row(label, key, type) {
        var d = U.el('div', 'field'), l = U.el('label', '', label);
        d.appendChild(l);
        if (key === 'type') {
          d.appendChild(U.el('div', 'val', p.type === 'xtream' ? 'Xtream Codes' : 'M3U playlist'));
          fields.push({ el: d, kind: 'type' });
        } else {
          var i = U.el('input');
          i.type = type || 'text'; i.value = p[key] || ''; i.spellcheck = false; i.autocomplete = 'off';
          i.addEventListener('input', function () { p[key] = i.value; });
          // Keep the field being typed in above the on-screen keyboard (it covers the bottom ~45%).
          i.addEventListener('focus', function () { kbFocus(d); });
          i.addEventListener('blur', function () { setTimeout(kbBlur, 0); });
          d.appendChild(i);
          var fx = { el: d, kind: 'input', input: i };
          if (type === 'password') {
            // Show/hide so a pasted or typed password can be checked.  Left/Right or click toggles.
            var eye = U.el('span', 'eye', 'Show');
            fx.toggle = function () { var shown = i.type === 'text'; i.type = shown ? 'password' : 'text'; eye.textContent = shown ? 'Show' : 'Hide'; };
            eye.addEventListener('mousedown', function (e) { e.preventDefault(); fx.toggle(); });
            d.appendChild(eye);
          }
          fields.push(fx);
        }
        setupEl.appendChild(d);
      }
      row('Type', 'type');
      row('Name (optional)', 'name');
      if (p.type === 'xtream') { row('Server', 'server', 'url'); row('Username', 'user'); row('Password', 'pass', 'password'); }
      else row('Playlist URL', 'm3u', 'url');
      if (!editing) row('Guide URL (optional)', 'guide', 'url');
      // Network: reachable here so a helper problem can never lock you out of the app.
      var nd = U.el('div', 'field'); nd.appendChild(U.el('label', '', 'Network'));
      nd.appendChild(U.el('div', 'val', (Store.settings.network === 'direct' ? 'Direct' : 'Automatic (through the helper)')));
      setupEl.appendChild(nd); fields.push({ el: nd, kind: 'net' });
      setupEl.appendChild(U.el('div', 'net', 'Network helper: ' + Net.status()));
      var go = U.el('div', 'btn', 'Connect');
      setupEl.appendChild(go);
      fields.push({ el: go, kind: 'go' });
      var test = U.el('div', 'btn', 'Test connection'); setupEl.appendChild(test); fields.push({ el: test, kind: 'test' });
      var lg = U.el('div', 'btn', 'View log'); setupEl.appendChild(lg); fields.push({ el: lg, kind: 'log' });
      if (!editing) { var rm = U.el('div', 'btn', 'Set up or restore from a computer'); setupEl.appendChild(rm); fields.push({ el: rm, kind: 'remote' }); }
      if (canCancel) { var cancel = U.el('div', 'btn', 'Cancel'); setupEl.appendChild(cancel); fields.push({ el: cancel, kind: 'cancel' }); }
      msg = U.el('div', 'msg'); setupEl.appendChild(msg);
      // Magic Remote: click a field or button to use it.
      fields.forEach(function (x, i) {
        x.el.addEventListener('click', function (e) { if (e.target.classList.contains('eye')) return; f = i; paint(); if (x.kind !== 'input' || e.target !== x.input) UI.press('ok'); });
      });
      paint();
    }
    function paint() { fields.forEach(function (x, i) { x.el.classList.toggle('focus', i === f); }); }
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
      setupEl.appendChild(U.el('h1', '', 'Set up from a computer'));
      setupEl.appendChild(U.el('p', 'lead', 'On a computer or phone on the same network, open the address below and type the password.  Restore a backup file there, or add your playlist with a real keyboard.'));
      var box = U.el('div', 'remote-box'); setupEl.appendChild(box);
      var back = U.el('div', 'btn focus', 'Back'); setupEl.appendChild(back);
      back.addEventListener('click', function () { UI.press('back'); });
      function show(s) {
        box.innerHTML = '';
        var addrs = WebEdit.addresses();
        if (!addrs.length) { box.appendChild(U.el('div', 'msg err', 'No network address found.  Check that the TV is connected to your network.')); return; }
        box.appendChild(U.el('div', 'remote-l', 'Address'));
        addrs.forEach(function (a) { box.appendChild(U.el('div', 'remote-v', a.replace(/^http:\/\//, ''))); });
        box.appendChild(U.el('div', 'remote-l', 'Password'));
        box.appendChild(U.el('div', 'remote-v', WebEdit.password()));
        box.appendChild(U.el('div', 'remote-s', s && s.clients ? 'A computer is connected.  Finish there; this screen moves on by itself.' : 'Waiting for a computer…'));
      }
      box.appendChild(U.el('div', 'remote-s', 'Starting the editor…'));
      WebEdit.onStatus = function (s) { if (setupEl.contains(box)) show(s); };
      (WebEdit.on ? Promise.resolve(WebEdit.status) : WebEdit.start()).then(show, function (e) { box.innerHTML = ''; box.appendChild(U.el('div', 'msg err', e.message)); });
      UI.setHandler(function (a) {
        if (a === 'back' || a === 'ok') { WebEdit.onStatus = null; if (!Store.settings.playlists.length) WebEdit.stop(); setup(target); }
        return true;
      });
    }

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
        return Store.idbSet(cacheKey(test), data).then(function () { return data; });
      }).then(function (data) {
        setupEl.classList.add('hidden');
        if (Store.settings.active !== test.id) Store.usePlaylist(test.id);
        Settings.reset();
        start(data, false);
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
        else if (cur.toggle && document.activeElement !== cur.input) cur.toggle();
        else if (cur.kind === 'type') { p.type = p.type === 'xtream' ? 'm3u' : 'xtream'; render(); }
        else if ((cur.kind === 'go' || cur.kind === 'test' || cur.kind === 'log') && a === 'right' && fields[f + 1]) { f++; paint(); }
        else if ((cur.kind === 'test' || cur.kind === 'log' || cur.kind === 'cancel') && a === 'left') { f--; paint(); }
      }
      else if (a === 'ok') {
        if (cur.kind === 'input') cur.input.focus();
        else if (cur.kind === 'type') { p.type = p.type === 'xtream' ? 'm3u' : 'xtream'; render(); }
        else if (cur.kind === 'go') connect();
        else if (cur.kind === 'net') toggleNet();
        else if (cur.kind === 'test') Diag.run(current());
        else if (cur.kind === 'log') Diag.showLog(true);
        else if (cur.kind === 'remote') remote();
        else if (cur.kind === 'cancel') leave();
      }
      else if (a === 'back' && canCancel) leave();
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
  function start(data, fromCache) {
    Source.setTz(data.tz);
    Library.set(data);
    Vod.reset();
    if (!ready) { Views.init(); ready = true; }
    Views.stopAll();
    Views.reload(false);
    Views.switchTab(Views.home());
    Views.setZone('channels');
    setupEl.classList.add('hidden');
    checkVod();
    // Guide loads after first paint so it never delays the channel list.
    setTimeout(function () { Epg.init(Library); }, fromCache ? 1500 : 300);
    Views.resume();
  }

  /* Movies and Shows only appear when the provider actually offers them.  Two small category
     requests in the background; the menu updates when they answer.  Not offered = hidden. */
  function checkVod() {
    var p = Store.playlist;
    if (p.type !== 'xtream') return;
    var count = function (action) {
      return U.getJSON(Source.api(p, action), 20000).then(function (j) { return Array.isArray(j) ? j.length : 0; }, function () { return null; });
    };
    Promise.all([count('get_vod_categories'), count('get_series_categories')]).then(function (r) {
      if (r[0] === null && r[1] === null) return;               // could not tell: keep what we knew
      var v = { movies: !!r[0], series: !!r[1], at: Date.now() };
      var old = p.vod || {};
      Log.info('app', 'Provider offers movies: ' + (v.movies ? 'yes (' + r[0] + ' categories)' : 'no') + ', shows: ' + (v.series ? 'yes (' + r[1] + ' categories)' : 'no'));
      if (old.movies === v.movies && old.series === v.series) return;
      p.vod = v; Store.upsertPlaylist(p);
      Views.buildTabs();
    });
  }

  function refresh(manual) {
    var p = Store.playlist;
    if (manual) U.toast('Reloading channels');
    return Source.load(p).then(function (data) {
      if (data.fixed) Store.upsertPlaylist(adopt(p, data));
      Store.idbSet(cacheKey(p), data);
      Source.setTz(data.tz);
      Library.set(data);
      Views.refreshLists(true);
      if (manual) U.toast(Library.count() + ' channels loaded');
    }).catch(function (e) { if (manual) U.toast(e.message || 'Reload failed', 4000); });
  }

  function open(p) {
    loading('Loading ' + (p.name || 'channels') + '…');
    return Store.idbGet(cacheKey(p)).then(function (cached) {
      if (cached && cached.sig === Source.sig(p) && cached.channels && cached.channels.length) {
        start(cached, true);
        if (plDue(p, cached.at, true)) setTimeout(function () { refresh(false); }, 15000);
        return;
      }
      return Source.load(p).then(function (data) {
        if (data.fixed) Store.upsertPlaylist(adopt(p, data));
        Store.idbSet(cacheKey(p), data); start(data, false);
      });
    }).catch(function (e) {
      Log.error('app', 'Could not open playlist "' + (p.name || p.id) + '": ' + (e && e.message));
      setup(p.id);
      U.toast((e.message || 'Could not load the playlist') + '  Test connection shows details.', 7000);
    });
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
    if (plDue(p, Library.data.at, false)) refresh(false);
    var eh = +p.epgRefresh;
    if (Epg.xml && !Epg.loading && eh > 0 && Date.now() - (Epg.status.at || 0) > eh * 3600e3) Epg.refresh(Library, true);
  }, 30 * 60e3);

  function switchPlaylist(id) {
    if (ready) Views.stopAll();
    setupEl.classList.add('hidden');
    Store.usePlaylist(id);
    Parental.lock();
    open(Store.playlist);
  }

  function boot() {
    loading('Starting…');
    Log.info('app', 'TiviBro ' + TIVIBRO_VERSION + ' starting.  ' + navigator.userAgent);
    Net.start(6000).then(function () {
      WebEdit.resume();
      if (!Store.settings.playlists.length) return setup();
      open(Store.playlist);
    });
  }

  // Free the decoder when the TV sends the app to the background; resume on return.
  document.addEventListener('visibilitychange', function () {
    if (!ready || Multiview.isOpen) return;
    if (document.hidden) { wasPlaying = Player.live ? Player.current : null; Player.stop(); }
    else if (wasPlaying) { Player.play(wasPlaying, { preview: !document.body.classList.contains('full') }); wasPlaying = null; }
  });

  return { boot: boot, setup: setup, refresh: refresh, switchPlaylist: switchPlaylist };
})();

window.addEventListener('load', function () { App.boot(); });
