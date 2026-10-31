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
      if (s.on) Log.info('phone', 'Phone app connection is on, port ' + s.port + ', ' + s.phones.length + ' phone(s) paired');
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

  function turn(on) {
    return call('/companion/set', { on: !!on }).then(set).then(function (s) {
      Log.info('phone', 'Phone app connection turned ' + (on ? 'on' : 'off'));
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
    start: start, refresh: refresh, launched: launched, turn: turn, rename: rename, forget: forget, showPair: showPair, ago: ago,
    get status() { return st; },
    set onChange(fn) { onChange = fn; }
  };
})();
