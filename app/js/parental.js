/* Parental controls: a 4 digit PIN guarding blocked channels/groups and, optionally, Settings. */
var Parental = (function () {
  'use strict';
  var unlocked = false, fails = 0, lockUntil = 0;

  function hash(pin) { return U.hash('tivibro:' + pin + ':pin'); }
  function enabled() { return !!Store.settings.pin; }
  function scope(kind) { var s = Store.settings.pinScope; return s === 'both' || s === kind; }

  function check(cb, title) {
    if (Date.now() < lockUntil) { U.toast('Too many wrong PINs.  Try again in ' + Math.ceil((lockUntil - Date.now()) / 1000) + 's'); return; }
    UI.pin(title || 'Enter PIN', function (v) {
      if (hash(v) === Store.settings.pin) {
        fails = 0;
        if (Store.settings.pinStay) unlocked = true;
        cb();
      } else {
        fails++;
        if (fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; }
        U.toast('Wrong PIN');
      }
    });
  }

  // Run cb now, or after the PIN, depending on what is being opened.
  function gate(kind, target, cb) {
    if (!enabled() || unlocked || !scope(kind)) return cb();
    if (kind === 'channels' && target && !Library.isBlocked(target)) return cb();
    check(cb, kind === 'settings' ? 'Enter PIN to open Settings' : 'This channel is blocked');
  }

  function setPin(done) {
    UI.pin('Choose a 4 digit PIN', function (a) {
      UI.pin('Enter it again', function (b) {
        if (a !== b) { U.toast('The PINs did not match'); return; }
        Store.settings.pin = hash(a); Store.saveSettings(); unlocked = false;
        U.toast('PIN saved'); if (done) done();
      });
    });
  }
  function change(done) { if (!enabled()) return setPin(done); check(function () { setPin(done); }, 'Enter current PIN'); }
  function remove(done) { check(function () { Store.settings.pin = ''; Store.saveSettings(); U.toast('PIN removed'); if (done) done(); }, 'Enter current PIN'); }

  return { gate: gate, change: change, remove: remove, enabled: enabled, lock: function () { unlocked = false; },
    blockedOk: function (c) { return !enabled() || unlocked || !scope('channels') || !Library.isBlocked(c); } };
})();
