/* Key routing and dialogs.
   Keys are delivered as small action names so views never deal with keycodes.
   OK is split into a tap ("ok") and a hold ("hold", 600ms) for the options menu. */
var UI = (function () {
  'use strict';
  var K = U.KEY;
  var handler = null, modalH = null, capture = null;
  var held = null;            // { btn, timer, fired } for the button currently down with a long action
  var playKey = 'toggle';     // which media button sent the last 'playpause': play | pause | toggle

  /* Magic Remote pointer.  "pointer" is true while the user is aiming; any remote key switches
     back to key mode (webOS hides the cursor then too).  Hover only moves focus in pointer mode,
     so a list scrolled with the arrows never jumps under a resting cursor. */
  var pointer = false, lastXY = '', lastInput = Date.now();     // lastInput: someone is using the TV (reminders.js, views.js)
  document.addEventListener('mousemove', function (e) {
    var xy = e.screenX + ',' + e.screenY;
    if (xy !== lastXY) { lastXY = xy; lastInput = Date.now(); if (!pointer) { pointer = true; document.body.classList.add('pointer'); } }
  }, true);
  function keyMode() { lastInput = Date.now(); if (pointer) { pointer = false; document.body.classList.remove('pointer'); } }
  // Wheel on the Magic Remote scrolls whatever has focus.
  var wheelT = 0;
  document.addEventListener('wheel', function (e) {
    if (Date.now() - wheelT < 90) return;
    wheelT = Date.now();
    dispatch(e.deltaY > 0 ? 'down' : 'up', null);
  }, { passive: true });
  // Anything with data-key acts like that remote button when clicked (hint bar, OSD legend, buttons).
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
    if (t) { e.preventDefault(); e.stopPropagation(); dispatch(t.getAttribute('data-key'), null); }
  }, true);

  function action(e) {
    var a = Keymap.alias(e.keyCode);
    if (a) return a;
    switch (e.keyCode) {
      case K.LEFT: return 'left'; case K.RIGHT: return 'right'; case K.UP: return 'up'; case K.DOWN: return 'down';
      case K.BACK: case K.ESC: case K.BKSP: return 'back';
      case K.CH_UP: return 'chup'; case K.CH_DOWN: return 'chdown';
      case K.RED: return 'red'; case K.GREEN: return 'green'; case K.YELLOW: return 'yellow'; case K.BLUE: return 'blue';
      // Play and Pause are separate buttons on LG remotes: remember which one so Play never pauses.
      case K.PLAY: playKey = 'play'; return 'playpause';
      case K.PAUSE: playKey = 'pause'; return 'playpause';
      case K.PLAYPAUSE: playKey = 'toggle'; return 'playpause';
      case K.STOP: return 'stop';
      case 412: return 'rew'; case 417: return 'ff';
      case K.INFO: return 'info';
      // Desktop keyboard equivalents, handy when testing in a browser.
      case 71: return 'green'; case 77: return 'red'; case 89: return 'yellow'; case 66: return 'blue'; case 73: return 'info';
    }
    if (e.keyCode >= 48 && e.keyCode <= 57) return 'num' + (e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return 'num' + (e.keyCode - 96);
    return null;
  }

  function dispatch(a, e) {
    var h = modalH || handler;
    if (!h || typeof a !== 'string' || !a) return;
    if (Log.sinking) Log.debug('key', a + (modalH ? '  (dialog)' : '') + '  tab=' + (window.Views ? Views.tab : '?') + (window.Views && Views.zone ? ' zone=' + Views.zone : '') + (window.Views && Views.full ? ' fullscreen' : ''));
    try { h(a, e); }
    catch (err) {
      if (window.console) console.error('Key handler error', a, err);
      Log.error('ui', 'Key handler error on "' + a + '": ' + (err && err.message) + (err && err.stack ? '  ' + String(err.stack).split('\n').slice(1, 4).join(' | ') : ''));
      U.toast('Something went wrong.  That action was cancelled.');
    }
  }

  // Key repeat on webOS fires ~30/s.  Coalesce arrows to one move per animation frame so a
  // held arrow scrolls smoothly instead of queueing hundreds of renders.
  var pending = null, raf = 0, repeating = false;
  function flush() { raf = 0; if (pending) { var p = pending; pending = null; repeating = true; try { dispatch(p, null); } finally { repeating = false; } } }

  function resetHeld() { if (held) { clearTimeout(held.timer); held = null; } }
  window.addEventListener('blur', resetHeld);
  document.addEventListener('visibilitychange', resetHeld);

  document.addEventListener('keydown', function (e) {
    keyMode();
    if (capture) { e.preventDefault(); var c = capture; capture = null; c(e.keyCode, action(e)); return; }
    var t = e.target;
    if (t && t.tagName === 'INPUT') {
      if (e.keyCode === K.BACK || e.keyCode === K.ESC) { t.blur(); dispatch('back', e); e.preventDefault(); }
      else if (e.keyCode === K.OK) { dispatch('submit', e); e.preventDefault(); }
      else if (e.keyCode === K.UP || e.keyCode === K.DOWN) { t.blur(); dispatch(e.keyCode === K.UP ? 'up' : 'down', e); e.preventDefault(); }
      return;
    }
    playKey = 'toggle';
    var a = e.keyCode === K.OK ? 'ok' : action(e);
    if (!a) return;
    e.preventDefault();
    // Still holding the button that started a hold: every repeat belongs to that hold, even once the
    // menu it opened is up (otherwise the repeats count as OK and pick the menu's first item).
    // Some TVs don't flag repeats, so any keydown of the held button counts until it is let go.
    // A keyup can get lost, though: a press well after the last repeat is a new press.
    if (held && held.btn === a) {
      var t0 = Date.now();
      if (t0 - held.last < 1000) { held.last = t0; return; }   // repeats start within about half a second
      resetHeld();
    }
    // OK always supports hold (options menus everywhere); other buttons only when mapped.
    var longable = !modalH && (a === 'ok' || Keymap.hasLong(a));
    if (longable) {
      resetHeld();
      var h = { btn: a, fired: false, last: Date.now() };
      h.timer = setTimeout(function () { h.fired = true; dispatch(a === 'ok' ? 'hold' : 'long:' + a, null); }, 600);
      held = h;
      return;
    }
    if (a === 'ok') { dispatch('ok', e); return; }           // modal open: no hold needed
    if (e.repeat && (a === 'up' || a === 'down' || a === 'left' || a === 'right')) {
      pending = a;
      if (!raf) raf = requestAnimationFrame(flush);
      return;
    }
    dispatch(a, e);
  }, true);

  document.addEventListener('keyup', function (e) {
    if (!held) return;
    var a = e.keyCode === K.OK ? 'ok' : action(e);
    if (a !== held.btn) return;
    var h = held; held = null;
    clearTimeout(h.timer);
    if (!h.fired) dispatch(a, e);
  }, true);

  /* ---------- modal list ---------- */
  var modal = U.$('modal'), mTitle = U.$('modalTitle'), mBody = U.$('modalBody');
  var mItems = [], mSel = 0, mTop = 0, M_VIS = 9;
  // Magic Remote: clicking outside the box is the same as Back.
  modal.addEventListener('click', function (e) { if (e.target === modal && modalH) dispatch('back', null); });

  function close() { modal.classList.add('hidden'); modal.querySelector('.modal-box').classList.remove('wide'); modalH = null; mBody.innerHTML = ''; if (onClose) { var f = onClose; onClose = null; f(); } }
  var onClose = null;

  function drawMenu() {
    mTop = U.clamp(mTop, Math.max(0, mSel - M_VIS + 1), mSel);
    mBody.innerHTML = '';
    for (var i = mTop; i < Math.min(mItems.length, mTop + M_VIS); i++) {
      var it = mItems[i], d = U.el('div', 'mi' + (i === mSel ? ' focus' : ''));
      d.appendChild(U.el('span', '', it.label));
      if (it.sub) d.appendChild(U.el('small', '', it.sub));
      (function (idx) {
        d.addEventListener('mousemove', function () { if (pointer && mSel !== idx) { mSel = idx; drawMenu(); } });
        d.addEventListener('click', function () { mSel = idx; dispatch('ok', null); });
      })(i);
      mBody.appendChild(d);
    }
  }

  function menu(title, items, onBack) {
    mItems = items.filter(Boolean); mTop = 0;
    mSel = Math.max(0, mItems.findIndex(function (x) { return x.current; }));
    mTitle.textContent = title;
    modal.classList.remove('hidden');
    drawMenu();
    modalH = function (a) {
      if (a === 'up') { if (mSel > 0) { mSel--; drawMenu(); } }
      else if (a === 'down') { if (mSel < mItems.length - 1) { mSel++; drawMenu(); } }
      else if (a === 'ok') { var it = mItems[mSel]; close(); if (it && it.action) it.action(); }
      else if (a === 'back') { close(); if (onBack) onBack(); }
      return true;
    };
  }

  function prompt(title, value, done, hint) {
    mTitle.textContent = title;
    mBody.innerHTML = '';
    var inp = U.el('input');
    inp.type = 'text'; inp.value = value || ''; inp.spellcheck = false;
    mBody.appendChild(inp);
    if (hint) mBody.appendChild(U.el('div', 'mi', hint));
    var ok = U.el('div', 'mi', 'Save'), cancel = U.el('div', 'mi', 'Cancel');
    ok.addEventListener('click', function () { var v = inp.value; close(); done(v); });
    cancel.addEventListener('click', function () { close(); });
    mBody.appendChild(ok); mBody.appendChild(cancel);
    modal.classList.remove('hidden');
    var f = 0;
    function paint() { ok.classList.toggle('focus', f === 1); cancel.classList.toggle('focus', f === 2); if (f === 0) inp.focus(); else inp.blur(); }
    paint();
    modalH = function (a) {
      if (a === 'submit') { var v = inp.value; close(); done(v); }
      else if (a === 'down') { f = Math.min(2, f + 1); paint(); }
      else if (a === 'up') { f = Math.max(0, f - 1); paint(); }
      else if (a === 'ok') {
        if (f === 0) inp.focus();
        else if (f === 1) { var v2 = inp.value; close(); done(v2); }
        else close();
      } else if (a === 'back') close();
      return true;
    };
  }

  // Four digit PIN pad.  Number keys type; Up/Down change a digit for remotes without numbers.
  function pin(title, done, cancel) {
    mTitle.textContent = title;
    mBody.innerHTML = '';
    var row = U.el('div', 'pinrow'), boxes = [], digits = ['', '', '', ''], pos = 0;
    for (var i = 0; i < 4; i++) { var b = U.el('span', 'pinbox'); boxes.push(b); row.appendChild(b); }
    mBody.appendChild(row);
    mBody.appendChild(U.el('div', 'mi', 'Number keys to type, or Up and Down to pick a digit'));
    modal.classList.remove('hidden');
    function paint() { boxes.forEach(function (b, i) { b.textContent = digits[i] ? '•' : ''; b.classList.toggle('focus', i === pos); }); }
    function finish() { var v = digits.join(''); close(); done(v); }
    paint();
    modalH = function (a) {
      if (a.indexOf('num') === 0) { digits[pos] = a.slice(3); if (pos < 3) pos++; else return finish(), true; }
      else if (a === 'up' || a === 'down') { var d = +(digits[pos] || 0); digits[pos] = String((d + (a === 'up' ? 1 : 9)) % 10); }
      else if (a === 'right') pos = Math.min(3, pos + 1);
      else if (a === 'left') pos = Math.max(0, pos - 1);
      else if (a === 'ok') { if (digits.every(Boolean)) return finish(), true; pos = Math.min(3, pos + 1); }
      else if (a === 'back') { close(); if (cancel) cancel(); return true; }
      paint();
      return true;
    };
  }

  /* A box with your own content and a row of buttons (◀ ▶ between them, OK presses one).
     buttons: [{ label, action }]; the first is focused.  Back closes it and calls onBack. */
  var mBox = modal.querySelector('.modal-box');
  function panel(title, body, buttons, onBack) {
    mTitle.textContent = title;
    mBody.innerHTML = '';
    mBox.classList.add('wide');
    mBody.appendChild(body);
    var row = U.el('div', 'mbtns'), els = [], f = 0;
    buttons.forEach(function (b, i) {
      var d = U.el('div', 'btn', b.label); els.push(d); row.appendChild(d);
      d.addEventListener('click', function () { f = i; dispatch('ok', null); });
    });
    mBody.appendChild(row);
    function paint() { els.forEach(function (d, i) { d.classList.toggle('focus', i === f); }); }
    paint();
    modal.classList.remove('hidden');
    modalH = function (a) {
      if (a === 'left' || a === 'up') { f = Math.max(0, f - 1); paint(); }
      else if (a === 'right' || a === 'down') { f = Math.min(els.length - 1, f + 1); paint(); }
      else if (a === 'ok') { var b = buttons[f]; close(); if (b.action) b.action(); }
      else if (a === 'back') { close(); if (onBack) onBack(); }
      return true;
    };
  }

  // Focus starts on Cancel, so a second press of OK by mistake never deletes or restores anything.
  function confirm(title, yesLabel, yes) {
    menu(title, [{ label: yesLabel, action: yes }, { label: 'Cancel', current: true }]);
  }

  /* ---------- chrome ---------- */
  function clock() {
    var c = U.$('clock'), now = new Date();
    c.textContent = (Store.settings.clockDate ? now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' : '') + U.hhmm(Date.now());
    c.style.display = Store.settings.showClock ? '' : 'none';
  }
  setInterval(clock, 15000); clock();

  function hints(list) {
    var h = U.$('hints');
    h.innerHTML = '';
    list.forEach(function (x) {
      var s = U.el('span');
      var key = x[2] || x[0];
      if (key) { s.setAttribute('data-key', key); s.className = 'clickable'; }
      if (x[0]) { var b = U.el('b', 'k-' + x[0]); s.appendChild(b); }
      s.appendChild(document.createTextNode(x[1]));
      h.appendChild(s);
    });
  }

  return {
    setHandler: function (fn) { handler = fn; },
    getHandler: function () { return handler; },
    get modalOpen() { return !!modalH; },
    get pointer() { return pointer; },
    get lastInput() { return lastInput; },
    get repeating() { return repeating; },     // true while a held arrow is auto-repeating
    get playKey() { return playKey; },
    press: function (a) { dispatch(a, null); },
    menu: menu, prompt: prompt, confirm: confirm, pin: pin, clock: clock, panel: panel, set onClose(f) { onClose = f; },
    captureNext: function (fn) { capture = fn; }, close: close, hints: hints
  };
})();
