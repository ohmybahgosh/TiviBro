/* Putting back what the TV cleared (issue #196).  TiviBro's settings, playlists with their logins and channel
   edits live in the browser's storage (localStorage), and webOS throws that away with the app's data: some
   installs over an existing TiviBro do it.  The helper's storage (service/storage.js, /media/internal/.tivibro,
   readable by the helper only) is kept, so:
     - a copy of TiviBro's browser storage is kept there (mirror:ls), 20 seconds after anything is saved;
     - a start with no playlist, while that copy has playlists, offers to put everything back;
     - with no copy (a TiviBro from before this kept none), a channel list the helper kept (playlist:<id>)
       still holds its Xtream Codes login: that playlist is offered back under its old id, so its restore points
       (snaps:<id>) line up again, and the newest one is offered once it has loaded. */
var Recover = (function () {
  'use strict';
  var KEY = 'mirror:ls', NOTE = 'tivibro.recovered';
  // Browser storage not worth putting back: the app's log (big, and about those sessions) and what was shown.
  var SKIP = /^tivibro\.(log|crashSeen|recovered)$/;
  var timer = null, off = false;

  function kvOn() { return !!(window.Net && Net.port && Net.info && Net.info.kv); }
  // The helper's kv routes (service/kv.js); a body over 32 KB goes as a Blob, as Store's own saves do.
  function kv(path, body) {
    if (body === undefined) return Net.ctlFetch('http://127.0.0.1:' + Net.port + path, { cache: 'no-store' });
    var b = body;
    if (b.length > 32768 && typeof Blob !== 'undefined') { try { b = new Blob([b], { type: 'application/json' }); } catch (e) { b = body; } }
    return Net.ctlFetch('http://127.0.0.1:' + Net.port + path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: b });
  }
  function json(r) { return r && r.ok ? r.json() : null; }
  function when(t) { var d = new Date(t); return d.toLocaleDateString(U.loc ? U.loc() : undefined, { month: 'short', day: 'numeric' }) + ' ' + U.hhmm(t); }
  function host(s) { return String(s || '').replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, ''); }

  // Everything of TiviBro's in the browser's storage, as text by key.
  function mine() {
    var d = {};
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('tivibro.') === 0 && !SKIP.test(k)) d[k] = localStorage.getItem(k); }
    return d;
  }
  function playlistsIn(data) {
    try { var s = JSON.parse(data['tivibro.settings'] || 'null'); return s && Array.isArray(s.playlists) ? s.playlists : []; } catch (e) { return []; }
  }

  /* The copy on the helper's storage.  Never made while there is no playlist: that is how a cleared TV starts,
     and it must not write over the copy that can put it back.  Removing the last playlist on purpose deletes
     the copy instead (forget, from Store.removePlaylist). */
  function save() {
    timer = null;
    if (off || !kvOn() || !Store.settings.playlists.length) return Promise.resolve(false);
    var body;
    try { body = JSON.stringify({ at: Date.now(), version: TIVIBRO_VERSION, data: mine() }); } catch (e) { return Promise.resolve(false); }
    return kv('/kv/put?k=' + KEY, body).then(function (r) { return r.ok; }, function () { return false; });
  }
  function changed() { if (!timer && !off) timer = setTimeout(save, 20000); }
  function forget() { if (kvOn()) kv('/kv/del?k=' + KEY, '').catch(function () {}); }

  /* A start with no playlist: anything on this TV to put back?  Resolves true when it asked (the answer
     restarts TiviBro, or calls next for the set-up screen), false when there was nothing to offer. */
  function check(next) {
    if (!kvOn()) return Promise.resolve(false);
    return kv('/kv/get?k=' + KEY).then(json).catch(function () { return null; }).then(function (m) {
      if (m && m.data && playlistsIn(m.data).length) { offerCopy(m, next); return true; }
      return logins().then(function (list) {
        if (!list.length) return false;
        offerLogins(list, next);
        return true;
      });
    });
  }

  // Xtream Codes logins at the front of the channel lists the helper kept (playlist:<id>), newest first.
  function logins() {
    return kv('/kv/list?p=playlist:').then(json).then(function (j) {
      var items = ((j && j.items) || []).filter(function (x) { return /^playlist:[A-Za-z0-9_-]+$/.test(x.k) && x.k !== 'playlist:none'; });
      return Promise.all(items.map(function (x) {
        return kv('/kv/peek?k=' + encodeURIComponent(x.k)).then(json).then(function (f) {
          return f && f.server && f.user && f.pass ? { id: x.k.slice(9), server: String(f.server), user: String(f.user), pass: String(f.pass), at: x.at } : null;
        }, function () { return null; });
      }));
    }).then(function (l) { return l.filter(Boolean).sort(function (a, b) { return b.at - a.at; }); }, function () { return []; });
  }

  function offerCopy(m, next) {
    var n = playlistsIn(m.data).length;
    Log.warn('recover', 'No playlist, but a copy of TiviBro\'s settings from ' + new Date(m.at).toISOString() + ' (' + n + ' playlists, ' + (m.version || '?') + ') is on the TV');
    UI.menu('Your settings on this TV were cleared', [
      { label: 'Put everything back', sub: I18n.t('Playlists, logins, channel edits and settings, as they were on {x}', { x: when(m.at) }), current: true, action: function () { putBack(m); } },
      { label: 'Start fresh', sub: 'The copy is deleted and the set-up screen opens', action: function () { Log.info('recover', 'Started fresh instead'); forget(); next(); } }
    ], next);
  }
  function putBack(m) {
    off = true;
    if (Store.freeze) Store.freeze();                    // nothing saves over it before the restart
    var n = 0;
    Object.keys(m.data).forEach(function (k) { if (k.indexOf('tivibro.') === 0) { try { localStorage.setItem(k, m.data[k]); n++; } catch (e) {} } });
    Log.info('recover', 'Put back ' + n + ' saved items from ' + new Date(m.at).toISOString() + ', restarting');
    U.toast('Putting everything back.  TiviBro restarts…', 3000);
    setTimeout(function () { location.reload(); }, 900);
  }

  function offerLogins(list, next) {
    Log.warn('recover', 'No playlist, but ' + list.length + ' kept channel list(s) with an Xtream Codes login are on the TV');
    UI.menu('Your playlist from before is still on this TV', list.map(function (x, i) {
      return { label: I18n.raw ? I18n.raw(host(x.server)) : host(x.server), sub: I18n.t('Xtream Codes, kept on {x}.  Its channel edits come back from its restore points.', { x: when(x.at) }), current: i === 0, action: function () { adopt(x); } };
    }).concat([{ label: 'Set up a new playlist', action: next }]), next);
  }
  // The login back under its old id, so its kept list, restore points and drafts are its own again.
  function adopt(x) {
    var p = { id: x.id, type: 'xtream', name: x.user, server: x.server, user: x.user, pass: x.pass };
    Store.upsertPlaylist(p);
    Store.settings.active = x.id;
    Store.saveSettings();
    try { localStorage.setItem(NOTE, JSON.stringify({ id: x.id, at: Date.now() })); } catch (e) {}
    Log.info('recover', 'Put back the Xtream Codes playlist ' + x.id + ' kept on the TV, restarting');
    U.toast('Putting your playlist back.  TiviBro restarts…', 3000);
    setTimeout(function () { location.reload(); }, 900);
  }

  /* After a start with playlists: keep the copy fresh, and once after adopt(), offer the newest restore point
     of the playlist that came back (its channel edits were in the cleared storage). */
  function start() {
    changed();
    var note = null;
    try { note = JSON.parse(localStorage.getItem(NOTE) || 'null'); localStorage.removeItem(NOTE); } catch (e) {}
    if (!note || !note.id || !window.WebEdit || !WebEdit.runData) return;
    setTimeout(function () {
      Store.bigGet('snaps:' + note.id).then(function (l) {
        var s = (Array.isArray(l) ? l : []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); })[0];
        if (!s) return;
        UI.menu('Put back your channel edits too?', [
          { label: 'Put them back', sub: I18n.t('From the restore point "{x}" of {y}', { x: s.name || 'Restore point', y: when(s.at) }), current: true, action: function () {
            WebEdit.runData('restoreSnap', { id: s.id }).then(function (r) { U.toast(r.msg, 5000); }, function (e) { U.toast(e.message, 5000); });
          } },
          { label: 'Not now', sub: 'Settings > Backups and restore points has them' }
        ]);
      }).catch(function () {});
    }, 5000);
  }

  return { changed: changed, forget: forget, check: check, start: start, _test: { mine: mine, playlistsIn: playlistsIn, save: save, logins: logins } };
})();
