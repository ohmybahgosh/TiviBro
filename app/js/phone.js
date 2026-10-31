/* The TiviBro phone app, from the TV's side (the helper's service/companion.js does the work).
   Settings, Phone app: switch the connection on, pair a phone with a QR code or a code typed on the
   phone, see and remove paired phones, and name the TV.  While the connection is on, TiviBro checks
   the helper every few seconds: a phone that asked for the web editor gets it started here.
   Plain ES5 for the old Chromium on webOS. */
var Phone = (function () {
  'use strict';
  var st = null, timer = null, fast = null, onChange = null, handled = 0;

  function base() { return Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function call(path, body) {
    if (!base()) return Promise.reject(new Error('The network helper is not running, so phones can\'t connect.  See Settings, Diagnostics.'));
    return fetch(base() + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: Net.ctlHeaders(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'helper answered ' + r.status); return j; }); });
  }
  function set(s) {
    var before = st ? JSON.stringify([st.on, st.phones, st.pairing && st.pairing.paired, st.name, st.running]) : '';
    st = s;
    if (s.wantEditor && s.wantEditor !== handled) { handled = s.wantEditor; editorForPhone(); }
    if (onChange && before !== JSON.stringify([s.on, s.phones, s.pairing && s.pairing.paired, s.name, s.running])) { try { onChange(s); } catch (e) {} }
    return s;
  }
  function refresh() { return call('/companion/status').then(set); }

  // A phone asked for the web editor: start it, then tell the helper (which hands the phone a session).
  function editorForPhone() {
    Log.info('phone', 'A phone asked for the web editor');
    (WebEdit.on ? Promise.resolve() : WebEdit.start()).then(function () { return call('/companion/editor-done', {}); }).then(set)
      .catch(function (e) { Log.warn('phone', 'Could not start the editor for the phone: ' + (e && e.message)); });
  }

  function poll() {
    clearInterval(timer);
    timer = setInterval(function () { if (st && st.on) refresh().catch(function () {}); }, 4000);
  }
  // After the helper is up: tell it our version (phones see it), pick up a request from a phone.
  function start() {
    if (!base()) return;
    call('/companion/set', { version: TIVIBRO_VERSION }).then(set).then(function (s) {
      if (s.on) { Log.info('phone', 'Phone app connection is on, port ' + s.port + ', ' + s.phones.length + ' phone(s) paired'); loop(); }
    }).catch(function (e) { Log.warn('phone', 'Phone app connection: ' + (e && e.message)); });
    poll();
  }
  // Opened by a phone (launch params) or brought forward by one: look now rather than in a few seconds.
  function launched(p) {
    if (!p || !p.companion) return false;
    Log.info('phone', 'Opened from the phone app' + (p.companion.editor ? ' for the web editor' : ''));
    if (base()) refresh().catch(function () {});
    return true;
  }

  /* ---------- the remote and Play on TV ---------- */
  // Waits with the helper for commands from phones, and carries them out.
  var polling = false, lastSeq = 0, lineupAt = 0;
  function loop() {
    if (polling || !base() || !(st && st.on)) return;
    polling = true;
    fetch(base() + '/companion/next?since=' + lastSeq, { cache: 'no-store', headers: Net.ctlHeaders({}) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        polling = false;
        if (j.seq != null) lastSeq = Math.max(lastSeq, +j.seq || 0);
        (j.cmds || []).forEach(function (c) { lastSeq = Math.max(lastSeq, c.id); run(c); });
        if (j.wantLineup) sendLineup();
        if (j.on === false) { if (st) st.on = false; return; }
        loop();
      }, function () { polling = false; setTimeout(loop, 3000); });
  }
  // Commands wait until TiviBro has its channels (a phone may have opened it a moment ago).
  function ready() { return typeof Library !== 'undefined' && Library.count() > 0 && Views.tab; }
  function run(c, tries) {
    if (!ready()) { if ((tries || 0) < 60) setTimeout(function () { run(c, (tries || 0) + 1); }, 500); return; }
    try {
      Log.info('phone', 'From ' + (c.from || 'a phone') + ': ' + c.type + ' ' + (c.key || c.action || c.k || c.text || ''));
      if (c.type === 'key') { UI.press(c.key); }
      else if (c.type === 'action') { if (UI.modalOpen) UI.close(); Views.runAction(c.action, Views.full ? 'player' : 'list'); }
      else if (c.type === 'play') {
        var ch = Library.find(c.k);
        if (!ch) { U.toast('That channel isn\'t in this playlist'); return; }
        if (!Parental.blockedOk(ch)) { U.toast(Library.name(ch) + ' is locked.  Open it on the TV with the PIN.'); return; }
        if (UI.modalOpen) UI.close();
        Views.startChannel(ch, false, Views.goFull);
        U.toast('Playing ' + Library.name(ch) + (c.from ? ', from ' + c.from : ''));
      }
      else if (c.type === 'text') { if (UI.modalOpen) UI.close(); if (Views.full) Views.runAction('exit', 'player'); Views.switchTab('search'); Search.query(c.text); }
      pushState(true);
    } catch (e) { Log.warn('phone', 'Could not carry out ' + c.type + ': ' + (e && e.message)); }
  }

  /* What TiviBro is showing, for the phone's Now playing.  Sent when it changes (checked every second
     and a half, and right after a phone's command). */
  var lastState = '';
  function snapshot() {
    var c = Views.playing, v = Views.vod, video = document.querySelector('video'), out = { tab: Views.tab, full: !!Views.full, mode: Views.mode || '' };
    if (Views.mode === 'vod' && v && v.meta) {
      out.vod = { title: String(v.meta.title || ''), pos: video ? Math.round(video.currentTime) : 0, dur: video && isFinite(video.duration) ? Math.round(video.duration) : 0 };
      out.paused = !!Player.paused;
    } else if (c) {
      var nn = Epg.peek(c), now = nn && nn.now, next = nn && nn.next;
      out.playing = { k: c.k, name: Library.name(c), num: c.num || '', logo: Views.logoOf(c) || '', group: Library.groupName(c.g) };
      if (now) out.now = { t: now.t, s: now.s, e: now.e };
      else { var ex = Search.extra(c); if (ex) out.now = { t: ex }; }
      if (next) out.next = { t: next.t, s: next.s };
      out.paused = !!Player.paused;
    }
    return out;
  }
  function pushState(soon) {
    if (!base() || !(st && st.on) || !ready()) return;
    var s = snapshot(), k = JSON.stringify(s);
    if (k === lastState) return;
    lastState = k;
    var go = function () { call('/companion/state', { state: s }).catch(function () { lastState = ''; }); };
    if (soon) setTimeout(go, 300); else go();
  }
  setInterval(function () { if (st && st.on) pushState(false); }, 1500);

  /* The channel list for the phone: the groups as shown on the TV and every shown channel, with
     what is on now from what the guide already has.  At most once a minute. */
  function sendLineup() {
    if (!ready()) { setTimeout(sendLineup, 1000); return; }
    if (Date.now() - lineupAt < 60000 && lineupAt) return;
    lineupAt = Date.now();
    var groups = [], seen = {}, chans = [];
    Library.groups().forEach(function (g) {
      if (g.id === Library.ALL) return;
      var keys = Library.channels(g.id).map(function (c) { return c.k; });
      if (!keys.length) return;
      groups.push({ id: g.id, name: g.name, keys: keys });
    });
    Library.channels(Library.ALL).forEach(function (c) {
      if (seen[c.k]) return; seen[c.k] = 1;
      var nn = Epg.peek(c), now = nn && nn.now, x = { k: c.k, n: Library.name(c), num: c.num || '', logo: Views.logoOf(c) || '', fav: Library.isFav(c.k) ? 1 : 0 };
      if (now) x.now = { t: now.t, s: now.s, e: now.e };
      else { var ex = Search.extra(c); if (ex) x.now = { t: ex }; }
      chans.push(x);
    });
    call('/companion/lineup', { groups: groups, channels: chans }).then(function (r) {
      Log.info('phone', 'Sent the channel list to the phone app: ' + chans.length + ' channels, ' + groups.length + ' groups');
    }, function (e) { lineupAt = 0; Log.warn('phone', 'Could not send the channel list: ' + (e && e.message)); });
  }

  function turn(on) {
    return call('/companion/set', { on: !!on }).then(set).then(function (s) {
      Log.info('phone', 'Phone app connection turned ' + (on ? 'on' : 'off'));
      if (on) loop();
      return s;
    });
  }
  function rename(name) { return call('/companion/set', { name: String(name || '').trim() }).then(set); }
  function forget(id) { return call('/companion/forget', { id: id }).then(set); }

  function ago(t) {
    if (!t) return 'never';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* Pair a phone: a QR code for the TiviBro phone app (it carries the code), and the code to type.
     A new code comes by itself when one runs out; closing the screen closes pairing. */
  function showPair(after) {
    Parental.gate('settings', null, function () {
      var wrap = U.el('div', 'pair'), qr = U.el('div', 'join-qr pair-qr'), side = U.el('div', 'pair-side');
      var steps = U.el('ol', 'pair-steps');
      ['Open the TiviBro app on your Android phone', 'Tap Add a TV, then Scan the code', 'Or type the code below'].forEach(function (t) { steps.appendChild(U.el('li', '', t)); });
      var codeL = U.el('div', 'remote-l', 'Pairing code'), code = U.el('div', 'pair-code', '…');
      var left = U.el('div', 'pair-left', ''), stat = U.el('div', 'pair-stat', 'Getting a code…');
      side.appendChild(steps); side.appendChild(codeL); side.appendChild(code); side.appendChild(left); side.appendChild(stat);
      wrap.appendChild(qr); wrap.appendChild(side);
      var lead = U.el('p', 'edit-join-lead', 'Your phone and this TV must be on the same network.  The code only works while this screen is open.');
      var box = U.el('div'); box.appendChild(lead); box.appendChild(wrap);
      var shown = '', done = false, opening = false;

      function draw(s) {
        if (!box.parentNode) return;
        var p = s.pairing;
        if (p && p.paired) {
          done = true;
          wrap.classList.add('ok');
          stat.className = 'pair-stat ok';
          stat.textContent = '✓  Paired with ' + p.paired.name + '.  You can close this screen.';
          left.textContent = '';
          return;
        }
        if (!p) {
          if (done || opening) return;
          // Ran out, or too many wrong tries: a fresh code.
          opening = true;
          call('/companion/pair', { open: true }).then(function (n) { opening = false; set(n); draw(n); }, function (e) { opening = false; stat.className = 'pair-stat err'; stat.textContent = e.message; });
          return;
        }
        if (shown !== p.code) {
          shown = p.code;
          code.textContent = p.code;
          try { var q = qrcode(0, 'M'); q.addData(p.link); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { Log.warn('phone', 'QR code: ' + e.message); }
        }
        var secs = Math.max(0, Math.round(p.left / 1000));
        left.textContent = 'Works for ' + Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2);
        stat.className = 'pair-stat';
        stat.textContent = p.tries ? 'A phone tried a wrong code (' + p.tries + ' of 5).  Waiting for your phone…' : 'Waiting for your phone…';
      }

      UI.panel('Pair a phone', box, [{ label: 'Done' }]);
      UI.onClose = function () {
        clearInterval(fast); fast = null;
        if (!done) call('/companion/pair', { open: false }).then(set).catch(function () {});
        if (after) after();
      };
      call('/companion/pair', { open: true }).then(function (s) {
        set(s); draw(s);
        clearInterval(fast);
        fast = setInterval(function () { refresh().then(draw).catch(function () {}); }, 1000);
      }, function (e) { stat.className = 'pair-stat err'; stat.textContent = e.message; });
    });
  }

  return {
    start: start, refresh: refresh, sendLineup: function () { lineupAt = 0; sendLineup(); }, launched: launched, turn: turn, rename: rename, forget: forget, showPair: showPair, ago: ago,
    get status() { return st; },
    set onChange(fn) { onChange = fn; }
  };
})();
