/* The TiviBro phone app, from the TV's side (the helper's service/companion.js does the work).
   Settings, Phone app: switch the connection on, pair a phone with a QR code or a code typed on the
   phone, see and remove paired phones, and name the TV.  While the connection is on, TiviBro checks
   the helper every few seconds: a phone that asked for the web editor gets it started here.  It also
   carries out the phone's remote presses and answers its questions (ASK: the guide, schedules,
   reminders, favorites, Movies and Shows, typing into text boxes on screen, adding a shared playlist
   link, backups and restores).
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
  // Commands wait until TiviBro has its channels (a phone may have opened it a moment ago).  A few
  // questions work on a TV with no playlist yet: adding one, typing into the set-up screen, backups.
  function ready() { return typeof Library !== 'undefined' && Library.count() > 0 && Views.tab; }
  var EARLY = { playlist: 1, input: 1, backup: 1, restore: 1 };
  function run(c, tries) {
    if (c.type === 'ask' && EARLY[c.what]) return answer(c);
    if (!ready()) {
      if ((tries || 0) < 60) setTimeout(function () { run(c, (tries || 0) + 1); }, 500);
      else if (c.type === 'ask') call('/companion/answer', { id: c.id, ok: false, error: 'TiviBro on the TV has no channels loaded yet.' }).catch(function () {});
      return;
    }
    if (c.type === 'ask') return answer(c);
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

  /* ---------- questions from the phone (POST /v1/ask) ---------- */
  function answer(c) {
    Log.info('phone', 'From ' + (c.from || 'a phone') + ': ' + c.what);
    Promise.resolve().then(function () {
      var fn = ASK[c.what];
      if (!fn) throw new Error('This TiviBro can\'t answer "' + c.what + '".  Update TiviBro on the TV.');
      return fn(c.args || {}, c);
    }).then(function (data) { return call('/companion/answer', { id: c.id, ok: true, data: data === undefined ? null : data }); },
      function (e) {
        Log.warn('phone', c.what + ' for the phone failed: ' + (e && e.message));
        return call('/companion/answer', { id: c.id, ok: false, error: (e && e.message) || 'failed' });
      })
      .then(function () { pushState(true); }, function () {});
  }
  function prog(p) { return { t: p.t, s: p.s, e: p.e }; }
  function hasReminder(k, s) { return (Store.edits.reminders || []).some(function (r) { return r.k === k && r.s === s; }); }
  function chan(k) {
    var c = Library.find(k);
    if (!c) throw new Error('That channel isn\'t in this playlist.');
    return c;
  }
  function vodKind(a) { return a.kind === 'series' ? 'series' : 'movie'; }
  function leaveFull() { if (UI.modalOpen) UI.close(); if (Views.full) Views.runAction('exit', 'player'); }
  var ASK = {
    /* The guide for a page of channels: what is on at `at` and the two after it.  Channels whose guide
       isn't loaded yet come back without programmes (and the guide starts loading them); the phone asks
       again for those. */
    guide: function (a) {
      var gid = a.group || Library.ALL, at = +a.at || Date.now(), list = Library.channels(gid), off = Math.max(0, +a.offset || 0), lim = Math.min(200, Math.max(1, +a.limit || 60)), pending = 0;
      var rows = list.slice(off, off + lim).map(function (c) {
        var l = Epg.request(c);
        if (!l) { pending++; return { k: c.k }; }
        var out = [];
        for (var i = 0; i < l.length && out.length < 3; i++) if (l[i].e > at) { var x = prog(l[i]); if (hasReminder(c.k, l[i].s)) x.r = 1; out.push(x); }
        return { k: c.k, p: out, a: c.arch ? 1 : 0 };
      });
      return { total: list.length, offset: off, rows: rows, pending: pending };
    },
    // One channel's programmes, from as far back as catch-up goes to a week ahead, with descriptions.
    schedule: function (a) {
      var c = chan(a.k), l = Epg.request(c);
      if (!l) return { k: c.k, pending: true, progs: [] };
      var now = Date.now(), from = now - (c.arch ? c.arch * 86400000 : 3 * 3600000), to = now + 8 * 86400000;
      var list = l.filter(function (p) { return p.e > from && p.s < to; }).slice(0, 700);
      if (list.length) Epg.desc(c, list[0]);
      return { k: c.k, arch: c.arch || 0, descPending: !!Epg.inHelper && list.some(function (p) { return p.d == null; }),
        progs: list.map(function (p) { var x = prog(p); if (p.d) x.d = String(p.d).slice(0, 800); if (hasReminder(c.k, p.s)) x.r = 1; return x; }) };
    },
    remind: function (a) {
      var c = chan(a.k), s = +a.s, l = Epg.request(c) || [], p = l.filter(function (x) { return x.s === s; })[0];
      if (!p) throw new Error('That programme is no longer in the guide.');
      var r = Store.edits.reminders, i = r.findIndex(function (x) { return x.k === c.k && x.s === s; }), on = a.on !== false;
      if (on && i < 0) r.push({ k: c.k, s: p.s, e: p.e, t: p.t });
      if (!on && i >= 0) r.splice(i, 1);
      Store.saveEdits();
      if (typeof Remind !== 'undefined' && Remind.sync) Remind.sync(true);
      if (Views.tab === 'guide' && typeof Guide !== 'undefined') Guide.draw();
      U.toast(on ? 'Reminder set for ' + p.t + ', ' + U.hhmm(p.s) : 'Reminder removed');
      return { on: on };
    },
    fav: function (a) {
      var c = chan(a.k), want = a.on !== false;
      if (Library.isFav(c.k) !== want) Library.toggleFav(c.k);
      Views.refreshLists(true);
      lineupAt = 0; sendLineup();
      return { on: Library.isFav(c.k) };
    },
    /* Changes to one channel from the phone's long press: what it is now (op 'info'), hide, rename (an
       empty name goes back to the provider's), put in or take out of one of your groups, or a new group
       with it.  The phone's channel list follows (the lineup is sent again). */
    chan: function (a) {
      var c = chan(a.k), op = String(a.op || 'info'), msg = '';
      var E = Store.edits, mine = function () { return Library.customGroups().map(function (g) { return { id: g.id, name: g.name, has: g.items.indexOf(c.k) >= 0 ? 1 : 0 }; }); };
      if (op === 'hide') { Library.hideChannel(c.k, a.on !== false); msg = a.on !== false ? 'Hidden on the TV.  Bring it back in Settings > Groups, sorting, hidden.' : 'Shown again'; }
      else if (op === 'rename') { var n = String(a.name || '').trim().slice(0, 80); Library.renameChannel(c.k, n); msg = n ? 'Renamed to ' + n : 'Back to the provider\'s name'; }
      else if (op === 'group') {
        var g = Library.customGroups().filter(function (x) { return x.id === a.group; })[0];
        if (!g) throw new Error('That group isn\'t on the TV any more.');
        if (a.on !== false) { Library.copyTo(g.id, [c.k]); msg = 'Added to ' + g.name; } else { Library.removeFrom(g.id, c.k); msg = 'Taken out of ' + g.name; }
      } else if (op === 'newgroup') {
        var nm = String(a.name || '').trim().slice(0, 80); if (!nm) throw new Error('Give the group a name.');
        var ng = Library.createGroup(nm); Library.copyTo(ng.id, [c.k]); msg = 'New group ' + nm + ', with this channel';
      } else if (op !== 'info') throw new Error('Unknown change');
      if (op !== 'info') { Views.refreshLists(true); lineupAt = 0; sendLineup(); }
      return { k: c.k, name: Library.name(c), provider: c.n, renamed: !!E.renames[c.k], hidden: !!E.hiddenChannels[c.k], group: Library.groupName(c.g), groups: mine(), msg: msg };
    },
    vodcats: function (a) { return Vod.phone.cats(vodKind(a)); },
    voditems: function (a) { return Vod.phone.items(vodKind(a), a.cat, a.q, a.offset, a.limit); },
    vodinfo: function (a) { return Vod.phone.info(vodKind(a), a.id); },
    vodplay: function (a, c) {
      leaveFull();
      return Vod.phone.play(vodKind(a), a.id, a.ep, a.fromStart).then(function (r) { U.toast('Playing ' + r.title + (c.from ? ', from ' + c.from : '')); return r; });
    },
    // A provider link shared to the phone app: added like the web editor's Add a playlist.
    playlist: function (a) {
      var l = Links.parse(a.link);
      if (!l) throw new Error('That isn\'t a link TiviBro can use.');
      if (l.type === 'm3u' && l.bare) throw new Error('That is only a server address, without a login.  Share the full link your provider sent.');
      var args = l.type === 'xtream' ? { type: 'xtream', server: l.server, user: l.user, pass: l.pass } : { type: 'm3u', m3u: l.m3u };
      args.name = String(a.name || '').slice(0, 60); args.epg = String(a.epg || ''); if (a.use) args.use = true;
      return WebEdit.run('addPlaylist', args);
    },
    // Typing on the phone into a box on the TV's screen (see inputs()).
    input: function (a) {
      var el = document.querySelector('input[data-tbin="' + String(a.id).replace(/[^0-9]/g, '') + '"]');
      if (!el || el.offsetParent === null) throw new Error('That box is no longer on the TV\'s screen.');
      el.value = String(a.value == null ? '' : a.value).slice(0, 2000);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (a.submit && UI.modalOpen && el.closest('#modal')) UI.press('submit');
      return { ok: true };
    },
    backup: function () {
      return Backup.create().then(function (b) { Store.settings.lastBackup = Date.now(); Store.saveSettings(); return { backup: b }; });
    },
    restore: function (a) {
      return Backup.restore(a.backup).then(function (info) {
        U.toast('Backup restored from your phone: ' + info.playlists + ' playlist' + (info.playlists === 1 ? '' : 's') + '.  Restarting TiviBro…', 4000);
        setTimeout(function () { location.reload(); }, 2000);
        return info;
      });
    }
  };

  /* Text boxes on the TV's screen right now (set-up, search, a rename), so the phone can type into
     them.  Passwords are never sent to the phone: only whether one is filled in. */
  var inSeq = 0;
  function inputs() {
    var out = [];
    [].slice.call(document.querySelectorAll('input')).forEach(function (el) {
      if (el.offsetParent === null || !/^(text|url|password|search|email|)$/.test(el.type)) return;
      var id = el.getAttribute('data-tbin');
      if (!id) { id = String(++inSeq); el.setAttribute('data-tbin', id); }
      var field = el.closest('.field'), modal = el.closest('#modal'), lab = field && field.querySelector('label');
      var label = lab ? lab.textContent : modal ? (document.getElementById('modalTitle') || {}).textContent : el.placeholder || 'Text';
      var secret = el.type === 'password' || (field && field.querySelector('.eye'));
      var x = { id: +id, label: String(label || 'Text').slice(0, 80), type: secret ? 'password' : el.type === 'url' ? 'url' : 'text' };
      if (secret) x.has = el.value ? 1 : 0; else x.value = el.value.slice(0, 500);
      if (modal) x.submit = 1;
      if (document.activeElement === el) x.focus = 1;
      out.push(x);
    });
    return out;
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
    var ins = inputs();
    if (ins.length) out.inputs = ins;
    // Movies and Shows tabs on the phone only when the provider has them.
    var p = Store.playlist || {}, vd = p.vod || {};
    out.vod2 = { movies: p.type === 'xtream' && !!vd.movies, series: p.type === 'xtream' && !!vd.series };
    return out;
  }
  function pushState(soon) {
    if (!base() || !(st && st.on) || !(ready() || document.querySelector('#viewSetup input'))) return;
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
    var groups = [], seen = {}, chans = [], extra = [];
    Library.groups().forEach(function (g) {
      if (g.id === Library.ALL) return;
      var l = Library.channels(g.id);
      if (!l.length) return;
      groups.push({ id: g.id, name: g.name, keys: l.map(function (c) { return c.k; }) });
      extra.push(l);
    });
    // Every channel a group shows, also ones All leaves out (a Local channels group keeps stations
    // whose network groups are hidden), or the phone finds that group empty.
    [Library.channels(Library.ALL)].concat(extra).forEach(function (l, li) { l.forEach(function (c) {
      if (seen[c.k]) return; seen[c.k] = 1;
      var nn = Epg.peek(c), now = nn && nn.now, x = { k: c.k, n: Library.name(c), num: c.num || '', logo: Views.logoOf(c) || '', fav: Library.isFav(c.k) ? 1 : 0 };
      if (li) x.na = 1;                                  // not in All
      if (now) x.now = { t: now.t, s: now.s, e: now.e };
      else { var ex = Search.extra(c); if (ex) x.now = { t: ex }; }
      chans.push(x);
    }); });
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
