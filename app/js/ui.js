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
    if (xy !== lastXY) { lastXY = xy; lastInput = Date.now(); if (!pointer) { pointer = true; document.body.classList.add('pointer'); seen('sawPointer'); } }
  }, true);
  // Remembers that this TV has a Magic Remote (pointer) or a remote with an Info button (Keymap.remote).
  function seen(k) { var s = window.Store && Store.settings; if (s && !s[k]) { s[k] = 1; try { Store.saveSettings(); } catch (e) {} } }
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
      case K.INFO: seen('sawInfo'); return 'info';
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

  function close() { modal.classList.add('hidden'); modal.querySelector('.modal-box').classList.remove('wide', 'panel'); modalH = null; mBody.innerHTML = ''; if (onClose) { var f = onClose; onClose = null; f(); } }
  var onClose = null;

  /* Up to M_VIS rows show.  Rows that wrap onto two or three lines (long subtitle names, discussion
     #36) make fewer fit: the list then starts lower until the focused row is whole, and a last row
     that would be cut off by the bottom of the box is left out.  A heading ({ head: true }, grey, as in
     Settings) is never focused: the arrows and the pointer step over it, and it stays in view above the
     row under it. */
  function drawMenu() {
    mTop = U.clamp(mTop, Math.max(0, mSel - M_VIS + 1), mSel > 0 && mItems[mSel - 1].head ? mSel - 1 : mSel);
    fillMenu();
    // 2 px of slack: sizes are rounded to whole pixels, so a row that fits exactly can read 1 px over.
    var h = mBody.clientHeight + 2, f = mBody.children[mSel - mTop], cut = false;
    if (h && f && mBody.scrollHeight > h) {
      while (mTop < mSel && f.offsetTop + f.offsetHeight > h) { mTop++; fillMenu(); f = mBody.children[mSel - mTop]; }
      // A row cut off at the bottom peeks through the fade there, so it's clear there's more; any after it
      // are left out.
      var peek = true;
      for (var k = mBody.children.length - 1; k > 0; k--) {
        var e = mBody.children[k];
        if (e === f || e.offsetTop + e.offsetHeight <= h) break;
        cut = true;
        if (e.offsetTop < h - 24 && peek) { peek = false; continue; }
        e.style.visibility = 'hidden';
      }
    }
    // Fades at the top and bottom when there is more of the list that way.
    var shown = 0; for (var c = 0; c < mBody.children.length; c++) if (mBody.children[c].style.visibility !== 'hidden' && mBody.children[c].offsetTop + mBody.children[c].offsetHeight <= h) shown++;
    mBody.classList.toggle('more-up', mTop > 0);
    mBody.classList.toggle('more-down', cut || mTop + shown < mItems.length);
  }
  /* Line icons for menu rows ({ icon: 'play' }), drawn like the side menu's: 24 x 24, stroked. */
  var MICONS = {
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    window: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',
    start: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
    history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    belloff: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0M4 4l16 16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    watch: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
    jump: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v3.5M10.3 15.3l1.7 1.7 1.7-1.7"/>',
    now: '<circle cx="12" cy="12" r="8.5"/><circle class="fill" cx="12" cy="12" r="3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    move: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    hide: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M4 4l16 16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    sort: '<path d="M4 6h10M4 12h7M4 18h4M18 5v14M15 16l3 3 3-3"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
    day: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 4M17 6h2.5a2.5 2.5 0 0 1-2.6 4M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  };
  function fillMenu() {
    mBody.innerHTML = '';
    var icons = mItems.some(function (x) { return x.icon; });
    for (var i = mTop; i < Math.min(mItems.length, mTop + M_VIS); i++) {
      var it = mItems[i];
      if (it.head) { mBody.appendChild(U.el('div', 'mh' + (icons ? ' ind' : ''), it.label)); continue; }
      // A short note sits at the right ("on", "catch-up"); a longer one goes under the label instead of
      // wrapping into a narrow column there.
      var two = it.sub && (it.stack || String(it.sub).length > 24);
      var d = U.el('div', 'mi' + (it.stack ? ' stack' : '') + (two ? ' two' : '') + (icons ? ' ind' : '') + (it.danger ? ' danger' : '') + (i === mSel ? ' focus' : ''));
      if (icons) { var ic = U.el('i', 'mic'); if (it.icon && MICONS[it.icon]) ic.innerHTML = '<svg viewBox="0 0 24 24">' + MICONS[it.icon] + '</svg>'; d.appendChild(ic); }
      d.appendChild(U.el('span', '', it.label));
      if (it.sub) d.appendChild(U.el('small', '', it.sub));
      (function (idx) {
        d.addEventListener('mousemove', function () { if (pointer && mSel !== idx) { mSel = idx; drawMenu(); } });
        d.addEventListener('click', function () { mSel = idx; dispatch('ok', null); });
      })(i);
      mBody.appendChild(d);
    }
  }

  /* A line under the title (opts.sub: what the menu is about, like the channel and time) and the box
     opening with a short rise. */
  var mSub = null;
  function heading(title, sub) {
    mTitle.textContent = title;
    if (!mSub) { mSub = U.el('div', 'modal-sub'); mTitle.parentNode.insertBefore(mSub, mTitle.nextSibling); }
    mSub.textContent = sub || '';
    mSub.style.display = sub ? '' : 'none';
    if (modal.classList.contains('hidden')) { mBox.classList.remove('enter'); void mBox.offsetWidth; mBox.classList.add('enter'); }
  }
  function menu(title, items, onBack, opts) {
    mItems = items.filter(Boolean); mTop = 0;
    if (!mItems.length) mItems = [{ label: 'Nothing to choose from' }];      // an empty list is never a dead end
    var rows = [];
    mItems.forEach(function (x, i) { if (!x.head) rows.push(i); });
    if (!rows.length) { mItems.push({ label: 'Nothing to choose from' }); rows.push(mItems.length - 1); }
    mSel = mItems.findIndex(function (x) { return x.current && !x.head; });
    if (mSel < 0) mSel = rows[0];
    heading(title, opts && opts.sub);
    mBox.classList.remove('panel');
    modal.classList.remove('hidden');
    drawMenu();
    modalH = function (a) {
      // Past either end of a menu: round to the other end (one press, not while the arrow is held).
      var at = rows.indexOf(mSel);
      if (a === 'up') { if (at > 0) { mSel = rows[at - 1]; drawMenu(); } else if (rows.length > 2 && !repeating) { mSel = rows[rows.length - 1]; drawMenu(); } }
      else if (a === 'down') { if (at < rows.length - 1) { mSel = rows[at + 1]; drawMenu(); } else if (rows.length > 2 && !repeating) { mSel = rows[0]; drawMenu(); } }
      else if (a === 'ok') { var it = mItems[mSel]; close(); if (it && it.action) it.action(); }
      else if (a === 'back') { close(); if (onBack) onBack(); }
      return true;
    };
  }

  function prompt(title, value, done, hint, secret, okLabel) {
    heading(title);
    mBody.innerHTML = '';
    var inp = U.el('input');
    inp.type = secret ? 'password' : 'text'; inp.value = value || ''; inp.spellcheck = false;
    mBody.appendChild(inp);
    if (hint) mBody.appendChild(U.el('div', 'mi', hint));
    var ok = U.el('div', 'mi', okLabel || 'Save'), cancel = U.el('div', 'mi', 'Cancel');
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
    heading(title);
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
  function panel(title, body, buttons, onBack, opts) {
    heading(title, opts && opts.sub);
    mBody.innerHTML = '';
    mBox.classList.add('wide');
    // Long text gives way to the buttons, which always show whole at the bottom (discussion #36).
    mBox.classList.add('panel');
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
    // A menu that shows live values (Stream info) redraws itself while it is the one open.
    menuOpen: function (title) { return !!modalH && !modal.classList.contains('hidden') && mTitle.textContent === title; },
    redrawMenu: function () { if (modalH) drawMenu(); },
    icon: function (n) { return MICONS[n] ? '<svg viewBox="0 0 24 24">' + MICONS[n] + '</svg>' : ''; },
    menu: menu, prompt: prompt, confirm: confirm, pin: pin, clock: clock, panel: panel, set onClose(f) { onClose = f; },
    captureNext: function (fn) { capture = fn; }, close: close, hints: hints
  };
})();
