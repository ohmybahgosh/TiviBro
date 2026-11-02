/* The web editor without the TV (discussion #23): the phone app serves the editor from its own copy
   and this stands in for the TV.  It answers the editor's /api/ calls from the TiviBroOffline bridge
   (OfflineEditorScreen.kt): the channel list kept from the last time the editor was open with the TV,
   and the edits and name rules in the backup being edited.  Send saves into that backup's working copy;
   the app asks before leaving whether to keep it as a new backup.  Things only the TV can do (playlists,
   guide sources, My media, reports) say so. */
(function () {
  'use strict';
  if (!window.TiviBroOffline) return;
  var B = window.TiviBroOffline;
  var D = null, rev = 1, pending = 0, applied = 0, draftSeq = 0, results = {}, cmdSeq = 0;
  var PID = '';
  function state() {
    if (!D) { D = JSON.parse(B.state()); PID = D.playlist && D.playlist.id || 'p'; D.drafts = draftInfo(); }
    return D;
  }
  function json(obj, status) { return Promise.resolve(new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); }
  function key() { return 'tivibro.offline.drafts.' + B.id() + '.' + PID; }
  function drafts() { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch (e) { return []; } }
  function keepDrafts(l) { try { localStorage.setItem(key(), JSON.stringify(l.slice(-40))); } catch (e) {} }
  function draftInfo() { var l = drafts(), x = l[l.length - 1]; return { count: l.length, latest: x ? { id: x.id, at: x.at, changes: x.changes, label: x.label } : null }; }
  var NEEDS_TV = 'That needs the TV.  You are editing a backup on the phone: open the editor with the TV for this.';
  var COMMANDS = {
    listDrafts: function () { var l = drafts(); return { msg: l.length + ' draft versions', data: { bytes: JSON.stringify(l).length, list: l.slice().reverse().map(function (x) { return { id: x.id, at: x.at, started: x.at, kind: x.kind, name: x.name, label: x.label, changes: x.changes, size: x.state.length }; }) } }; },
    getDraft: function (a) { var x = drafts().filter(function (y) { return y.id === a.id; })[0]; if (!x) throw new Error('That draft version no longer exists.'); return { msg: 'Draft version', data: { id: x.id, at: x.at, state: x.state, changes: x.changes, label: x.label } }; },
    deleteDraft: function (a) { keepDrafts(drafts().filter(function (x) { return x.id !== a.id; })); return { msg: 'Draft version deleted' }; },
    listSnaps: function () { return { msg: '0 restore points', data: [] }; }
  };
  function body(o) { try { return o && o.body ? JSON.parse(o.body) : {}; } catch (e) { return {}; } }
  var realFetch = window.fetch;
  window.fetch = function (url, o) {
    var u = String(url && url.url || url), m = /^(?:https?:\/\/[^/]+)?(\/api\/[a-z]+)(?:\?(.*))?$/.exec(u);
    if (!m) return realFetch.apply(this, arguments);
    var path = m[1], q = m[2] || '', method = (o && o.method || 'GET').toUpperCase();
    try {
      if (path === '/api/login') return json({ ok: true, token: 'offline' });
      if (path === '/api/logout') return json({ ok: true });
      if (path === '/api/state') { var d = state(); if (/have=/.test(q) && q.indexOf('have=' + d.chanRev) >= 0) { var c = {}; Object.keys(d).forEach(function (k) { if (k !== 'channels' && k !== 'groups') c[k] = d[k]; }); c.sameChannels = true; return json({ data: c, rev: rev }); } return json({ data: d, rev: rev }); }
      if (path === '/api/rev') return json({ rev: rev, pendingRev: pending, appliedRev: applied, progress: null, tvSeen: Date.now(), now: Date.now(), draftAck: draftSeq });
      if (path === '/api/save' && method === 'POST') {
        var j = body(o), d2 = state();
        B.save(JSON.stringify({ edits: j.edits || {}, names: j.names || null }));
        d2.edits = j.edits || d2.edits; if (j.names) d2.names = j.names;
        pending++; applied = pending; rev++;
        return json({ ok: true, pendingRev: pending });
      }
      if (path === '/api/draft' && method === 'POST') {
        var dj = body(o); draftSeq++;
        var l = drafts(); l.push({ id: 'd' + Date.now().toString(36) + draftSeq, at: Date.now(), kind: dj.kind || 'auto', name: dj.name || '', label: dj.label || '', changes: +dj.changes || 0, state: String(dj.state || '') });
        keepDrafts(l); state().drafts = draftInfo();
        return json({ ok: true, seq: draftSeq });
      }
      if (path === '/api/command' && method === 'POST') {
        var c2 = body(o), id = 'c' + (++cmdSeq), fn = COMMANDS[c2.type];
        try { results[id] = fn ? Object.assign({ done: true, ok: true }, fn(c2.args || {})) : { done: true, ok: false, msg: NEEDS_TV }; }
        catch (e) { results[id] = { done: true, ok: false, msg: e.message }; }
        return json({ id: id });
      }
      if (path === '/api/result') { var rid = (/id=([^&]+)/.exec(q) || [])[1]; return json(results[rid] || { done: true, ok: false, msg: 'Unknown request' }); }
      if (path === '/api/restore') return json({ error: NEEDS_TV }, 400);
      return json({ error: 'Not on the phone' }, 404);
    } catch (e) { return json({ error: e.message }, 500); }
  };

  /* The words: this is a backup on the phone, not the TV.  The editor's own status lines are reworded
     as they are written, and pages that need the TV are left out of the menu. */
  function reword(s) {
    return String(s).replace(/Send to TV/g, 'Save to the backup').replace(/Sending to the TV…/g, 'Saving…').replace(/are on the TV/g, 'are in the backup')
      .replace(/not on the TV yet/g, 'not saved yet').replace(/Everything is on the TV/g, 'Everything is saved').replace(/On the TV/g, 'Saved').replace(/Press Send to TV\./g, 'Press Save.');
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('offline');
    var css = document.createElement('style');
    css.textContent = 'body.offline [data-page="playlists"],body.offline [data-page="backup"],body.offline [data-page="media"],body.offline [data-page="report"],body.offline [data-page="guide"]{display:none!important}' +
      '#offlineBar{position:sticky;top:0;z-index:50;background:#1d2b4f;color:#cfe0ff;font:14px/1.4 system-ui,sans-serif;padding:8px 14px}';
    document.head.appendChild(css);
    var bar = document.createElement('div'); bar.id = 'offlineBar';
    bar.textContent = 'Editing a backup on this phone, without the TV.  Save keeps your changes; the app asks whether to keep them as a new backup when you leave.';
    document.body.insertBefore(bar, document.body.firstChild);
    var obs = new MutationObserver(function (list) {
      list.forEach(function (r) {
        var n = r.target.nodeType === 3 ? r.target : null;
        if (n && /TV/.test(n.nodeValue)) { var v = reword(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
        (r.addedNodes || []).forEach(function (a) {
          var w = document.createTreeWalker(a.nodeType === 1 ? a : a.parentNode || document.body, NodeFilter.SHOW_TEXT), t;
          while ((t = w.nextNode())) if (/TV/.test(t.nodeValue)) { var v2 = reword(t.nodeValue); if (v2 !== t.nodeValue) t.nodeValue = v2; }
        });
      });
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), t0;
    while ((t0 = walker.nextNode())) if (/TV/.test(t0.nodeValue)) t0.nodeValue = reword(t0.nodeValue);
  });
})();
