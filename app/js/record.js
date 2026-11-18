/* Recording live channels to a USB drive (the helper does the work: service/record.js).
   From the guide (Hold OK on a programme: Record, or Record from now on what's on) and fullscreen (the quick menu:
   Record), and the list under Recordings… (the guide's Hold OK menu, and the quick menu) to watch, stop or delete.
   The channel's address is the one the player uses (through the helper's relay), so its User-Agent, headers and a
   portal's links all apply.  A recording uses its own connection to the provider. */
var Record = (function () {
  'use strict';
  var L = Library;
  var PAD_BEFORE = 2 * 60000, PAD_AFTER = 5 * 60000;
  var last = { recs: [], at: 0 };

  function T(s, o) { var t = typeof I18n !== 'undefined' ? I18n.t(s) : s; return t.replace(/\{(\w+)\}/g, function (a, k) { return o && o[k] != null ? o[k] : a; }); }
  function base() { return Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function api(path, body) {
    if (!base()) return Promise.reject(new Error('TiviBro\'s helper isn\'t running, and it does the recording'));
    var init = body ? { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    return Net.ctlFetch(base() + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j && j.error || 'HTTP ' + r.status); e.code = j && j.code; throw e; }
        return j;
      });
    });
  }
  // The address the player would use for this channel, through the helper.
  function urlFor(ch) {
    var u = Source.streamUrl(ch, Store.settings.format);
    return Net.wrap(u, { pl: Store.plOf ? Store.plOf(ch) : Store.playlist, ua: ch.ua || '', hdr: ch.hdr || null, always: true });
  }
  function list() { return api('/record/list').then(function (j) { last = { recs: j.recs || [], at: Date.now() }; return last.recs; }); }
  function drives() { return api('/record/drives').then(function (j) { return j.drives || []; }); }
  function explain(e) {
    if (e && e.code === 'nodrive') return 'Plug a USB drive into the TV to record to.  TiviBro keeps recordings in a "TiviBro Recordings" folder on it.';
    return 'Recording didn\'t start: ' + (e && e.message || 'no answer from the helper');
  }
  function say(e) { U.toast(T(explain(e)), 6000); if (typeof Log !== 'undefined') Log.warn('record', explain(e)); }

  /* Now, until the programme ends (with a few minutes after), or for an hour when the guide says nothing. */
  function now(ch, p) {
    var end = p && p.e > Date.now() ? p.e + PAD_AFTER : Date.now() + 60 * 60000;
    return api('/record/start', { url: urlFor(ch), title: p && p.t || L.name(ch), channel: L.name(ch), end: end }).then(function (r) {
      U.toast(T('Recording "{x}" until {t}', { x: r.title, t: U.hhmm(end) }), 4000);
      Log.info('record', 'Recording ' + L.name(ch) + ' until ' + U.hhmm(end));
      return list();
    }, say);
  }
  function schedule(ch, p) {
    return api('/record/schedule', { url: urlFor(ch), title: p.t || L.name(ch), channel: L.name(ch), start: p.s - PAD_BEFORE, end: p.e + PAD_AFTER }).then(function (r) {
      U.toast(T('Will record "{x}" at {t}', { x: r.title, t: U.hhmm(p.s) }), 4000);
      return list();
    }, say);
  }
  function stop(id) { return api('/record/stop', { id: id }).then(list, say); }
  function remove(id) { return api('/record/delete', { id: id }).then(list, say); }

  // What the guide knows: is this programme being recorded or due to be?
  function of(ch, p) {
    var name = L.name(ch);
    return last.recs.filter(function (r) { return (r.status === 'recording' || r.status === 'scheduled') && r.channel === name && (!p || (r.start <= p.s + PAD_BEFORE + 1000 && r.end >= p.e)); })[0] || null;
  }
  // For the guide's Hold OK menu: Record or Stop recording, for a programme on now or later.
  function menuItem(ch, p) {
    if (!base()) return null;
    var now0 = Date.now(), r = of(ch, p);
    if (r) return { label: r.status === 'recording' ? 'Stop recording' : 'Cancel recording', icon: 'stop', sub: r.status === 'recording' ? T('since {t}', { t: U.hhmm(r.startedAt || r.start) }) : U.hhmm(r.start), action: function () { stop(r.id); } };
    if (p && p.e > now0 && p.s > now0) return { label: 'Record', icon: 'rec', sub: T('{t}, to a USB drive', { t: U.hhmm(p.s) }), action: function () { schedule(ch, p); } };
    if (p && p.s <= now0 && p.e > now0) return { label: 'Record', icon: 'rec', sub: T('from now until {t}', { t: U.hhmm(p.e) }), action: function () { now(ch, p); } };
    return null;
  }

  function sizeOf(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB'; }
  function whenOf(r) { var t = r.startedAt || r.start, d = new Date(t), today = new Date(); return (d.toDateString() === today.toDateString() ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ') + U.hhmm(t); }
  var STATUS = { recording: 'recording now', scheduled: 'scheduled', done: '', failed: 'failed', missed: 'missed', cancelled: 'cancelled' };

  /* Recordings…: newest first.  OK on one watches it (or, scheduled or recording, offers to stop it). */
  function open() {
    list().then(function (recs) {
      if (!recs.length) return drives().then(function (d) {
        UI.menu('Recordings', [{ label: d.length ? 'Nothing recorded yet' : 'No USB drive', sub: d.length ? 'Hold OK on a programme in the guide > Record.' : 'Plug a USB drive into the TV to record to.' }]);
      });
      recs = recs.slice().sort(function (a, b) { return (b.startedAt || b.start) - (a.startedAt || a.start); });
      UI.menu('Recordings', recs.map(function (r) {
        var st = STATUS[r.status] || r.status;
        var sub = [whenOf(r), r.channel !== r.title ? r.channel : '', r.bytes ? sizeOf(r.bytes) : '', st, r.error && r.status !== 'done' ? r.error : ''].filter(Boolean).join('  ·  ');
        return { label: r.title, icon: r.status === 'recording' ? 'rec' : r.status === 'scheduled' ? 'history' : 'play', sub: sub, action: function () { options(r); } };
      }), null, { sub: T('On the USB drive, in "TiviBro Recordings"') });
    }, function (e) { U.toast(T(explain(e)), 6000); });
  }
  function options(r) {
    var items = [];
    if (r.bytes > 0) items.push({ label: r.status === 'recording' ? 'Watch from the start' : 'Watch', icon: 'play', action: function () { watch(r); } });
    if (r.status === 'recording') items.push({ label: 'Stop recording', icon: 'stop', action: function () { stop(r.id).then(open); } });
    if (r.status === 'scheduled') items.push({ label: 'Cancel recording', icon: 'stop', action: function () { stop(r.id).then(open); } });
    if (r.status !== 'recording') items.push({ label: 'Delete', icon: 'trash', sub: r.bytes ? sizeOf(r.bytes) + ' freed' : '', action: function () {
      UI.confirm(T('Delete "{x}"?', { x: r.title }), 'Delete', function () { remove(r.id).then(open); });
    } });
    UI.menu(r.title, items, null, { sub: whenOf(r) + '  ·  ' + r.channel });
  }
  function watch(r) {
    var url = base() + '/record/file/' + r.id + '/rec.' + (r.kind === 'mp4' ? 'mp4' : 'ts');
    Views.playVod({ id: 'rec:' + r.id, title: r.title, sub: r.channel + '  ·  ' + whenOf(r), item: { recording: true } }, url, 0, function () { open(); });
  }

  // Known as TiviBro starts and every few minutes (the guide's menu and the quick menu say Record or Stop recording).
  (function poll() { if (base()) list().catch(function () {}); setTimeout(poll, 120000); })();
  setTimeout(function () { if (base()) list().catch(function () {}); }, 8000);

  return { now: now, schedule: schedule, stop: stop, remove: remove, list: list, drives: drives, open: open, menuItem: menuItem, of: of, urlFor: urlFor,
    get recs() { return last.recs; } };
})();
