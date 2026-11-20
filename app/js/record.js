/* Recording live channels to a USB drive (the helper does the work: service/record.js).
   From the guide (Hold OK on a programme: Record, or Record from now on what's on) and fullscreen (the quick menu:
   Record), and the list under Recordings… (the guide's Hold OK menu, and the quick menu) to watch, stop or delete.
   The channel's address is the one the player uses (through the helper's relay), so its User-Agent, headers and a
   portal's links all apply.  A recording uses its own connection to the provider. */
var Record = (function () {
  'use strict';
  var L = Library;
  // Minutes before and after a programme (Settings > Recording and live pause), 2 and 5 at first.
  function padB() { var v = Store.settings.recPadBefore; return (v == null ? 2 : +v) * 60000; }
  function padA() { var v = Store.settings.recPadAfter; return (v == null ? 5 : +v) * 60000; }
  var last = { recs: [], at: 0 }, drive = false, space = null, pauseHere = false;

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
  function wrap(ch, u) { return Net.wrap(u, { pl: Store.plOf ? Store.plOf(ch) : Store.playlist, ua: ch.ua || '', hdr: ch.hdr || null, always: true }); }
  function urlFor(ch) { return wrap(ch, Source.streamUrl(ch, Store.settings.format)); }
  /* For a recording: HLS first when the channel has it (a piece that's missed is fetched again, where a dropped
     MPEG-TS connection loses what aired meanwhile), and the other format if HLS never starts (the helper swaps). */
  function recUrls(ch) {
    var h = Source.streamUrl(ch, 'm3u8'), t = Source.streamUrl(ch, 'ts');
    if (h && t && h !== t) return { url: wrap(ch, h), alt: wrap(ch, t) };
    return { url: urlFor(ch), alt: '' };
  }
  function descOf(ch, p) { try { return p && typeof Epg !== 'undefined' && Epg.desc ? Epg.desc(ch, p) || '' : ''; } catch (e) { return ''; } }
  /* What TMDB knows about each recording (with your token): the guide's own match when Movies on now already found
     one, else a look by its title (a show when the guide gave it an episode, else a movie or show by title and
     description).  Kept with the recording, so the Recordings screen shows its poster, backdrop and plot.
     A miss is kept too, so it isn't asked again; a few at a time. */
  var asked = {}, metaBusy = false;
  function lite(m) { return { title: m.title, year: m.year, poster: m.poster, backdrop: m.backdrop, backdropHd: m.backdropHd || '', logo: m.logo || '', plot: String(m.plot || '').slice(0, 1200), genre: m.genre, runtime: m.runtime, rating: m.rating, kind: m.kind || '' }; }
  function tmdbOn() { return typeof Media !== 'undefined' && Media.guideLookup && typeof MediaStore !== 'undefined' && MediaStore.tmdbToken && !!MediaStore.tmdbToken(); }
  function enrich() {
    if (metaBusy || !tmdbOn()) return;
    var r = last.recs.filter(function (x) { return !x.meta && !asked[x.id] && x.status !== 'failed' && x.status !== 'cancelled'; })[0];
    if (!r) return;
    asked[r.id] = 1; metaBusy = true;
    var t = String(r.title || '').replace(/\s*\(\d{4}\)\s*$/, ''), y = (/\((\d{4})\)\s*$/.exec(r.title || '') || [])[1] || '';
    var ask = r.ep && Media.tvByName ? Media.tvByName(t, y, 'weak') : Media.guideLookup(t, y, 'weak', r.desc || '');
    ask.then(function (res) {
      var m = res && res.metadata;
      return api('/record/meta', { id: r.id, meta: m ? lite(m) : { miss: true } }).then(function () { return list(); });
    }, function () {}).then(function () { metaBusy = false; setTimeout(enrich, 1500); });
  }
  // The guide's match for this programme, if Movies on now has one already: no lookup needed.
  function guideMeta(ch, p) { try { var m = typeof Movies !== 'undefined' && Movies.of ? Movies.of(ch, p) : null; return m ? lite(m) : null; } catch (e) { return null; } }
  function logo(ch) { try { return Views.logoOf(ch) || ''; } catch (e) { return ''; } }
  function sig(recs) { return recs.map(function (r) { return r.id + r.status + r.end; }).join(); }
  function list() {
    return api('/record/list').then(function (j) {
      var was = sig(last.recs), had = shown();
      last = { recs: j.recs || [], at: Date.now() }; space = j.drive || null; drive = !!space; pauseHere = !!j.pauseHere;
      // The guide marks what's recording, so it's redrawn when that changes.
      if (shown() !== had && typeof Views !== 'undefined' && Views.buildTabs) Views.buildTabs();
      if (sig(last.recs) !== was && typeof Guide !== 'undefined' && Guide.vis) try { Guide.draw(); } catch (e) {}
      setTimeout(enrich, 500);
      return last.recs;
    });
  }
  function drives() {
    return api('/record/drives').then(function (j) {
      var d = j.drives || [], had = shown();
      drive = d.length > 0;
      if (shown() !== had && typeof Views !== 'undefined' && Views.buildTabs) Views.buildTabs();
      return d;
    });
  }
  // In the side menu once there's a drive to record to, or recordings to watch.
  function shown() { return drive || last.recs.length > 0; }
  function explain(e) {
    if (e && e.code === 'nodrive') return 'Plug a USB drive into the TV to record to.  TiviBro keeps recordings in a "TiviBro Recordings" folder on it.';
    return 'Recording didn\'t start: ' + (e && e.message || 'no answer from the helper');
  }
  function say(e) { U.toast(T(explain(e)), 6000); if (typeof Log !== 'undefined') Log.warn('record', explain(e)); }

  /* From the phone app (q): no toast on the TV, and a failure comes back as an error the phone shows. */
  function fail(q, start) { return q ? function (e) { throw new Error(start ? explain(e) : e && e.code === 'nodrive' ? explain(e) : (e && e.message || 'No answer from the helper')); } : say; }
  /* Now, until the programme ends (with a few minutes after), or for an hour when the guide says nothing. */
  function now(ch, p, q) {
    var end = p && p.e > Date.now() ? p.e + padA() : Date.now() + 60 * 60000;
    var u = recUrls(ch);
    return api('/record/start', { url: u.url, alt: u.alt, key: ch.k, logo: logo(ch), desc: descOf(ch, p), ep: p && p.ep || '', title: p && p.t || L.name(ch), channel: L.name(ch), end: end }).then(function (r) {
      if (!q) U.toast(T('Recording "{x}" until {t}', { x: r.title, t: U.hhmm(end) }), 4000);
      var gm = guideMeta(ch, p); if (gm) api('/record/meta', { id: r.id, meta: gm }).catch(function () {});
      Log.info('record', 'Recording ' + L.name(ch) + ' until ' + U.hhmm(end) + (q ? ' (from the phone app)' : ''));
      return list();
    }, fail(q, true));
  }
  function schedule(ch, p, q) {
    var u = recUrls(ch);
    return api('/record/schedule', { url: u.url, alt: u.alt, key: ch.k, logo: logo(ch), desc: descOf(ch, p), ep: p.ep || '', title: p.t || L.name(ch), channel: L.name(ch), start: p.s - padB(), end: p.e + padA() }).then(function (r) {
      if (!q) U.toast(T('Will record "{x}" at {t}', { x: r.title, t: U.hhmm(p.s) }), 4000);
      var gm = guideMeta(ch, p); if (gm) api('/record/meta', { id: r.id, meta: gm }).catch(function () {});
      return list();
    }, fail(q, true));
  }
  function stop(id, q) { return api('/record/stop', { id: id }).then(list, fail(q)); }
  /* Convert to MP4 (service/record.js): one file with TMDB's details inside, for Plex and Apple TV; MKV when MP4
     can't hold the channel's sound or picture.  Runs on the TV in the background. */
  function canConvert(r) { return r.status === 'done' && r.bytes > 0 && !(r.conv && (r.conv.running || r.conv.done)) && (r.kind === 'ts' || r.kind === '' || (r.kind === 'mp4' && r.parts === 1)); }
  function convert(id, q) {
    return api('/record/convert', { id: id }).then(function () {
      if (!q) U.toast(T('Converting to MP4.  It carries on in the background; the recording plays as it was meanwhile.'), 5000);
      return list();
    }, function (e) { if (q) throw e; U.toast(T('Couldn\'t convert: {x}', { x: e && e.message || '' }), 6000); return list(); });
  }
  function remove(id, q) { forget(id); return api('/record/delete', { id: id }).then(list, fail(q)); }

  // What the guide knows: is this programme being recorded or due to be?
  function of(ch, p) {
    if (!last.recs.length) return null;
    var name = L.name(ch);
    // A recording started partway through ("from now") starts after the programme does, so it covers the programme
    // when it began before the programme ends and runs to its end.
    return last.recs.filter(function (r) {
      if ((r.status !== 'recording' && r.status !== 'scheduled') || r.channel !== name) return false;
      if (!p) return true;
      if (r.end < p.e) return false;
      return r.status === 'recording' ? r.start < p.e : r.start <= p.s + padB() + 1000;
    })[0] || null;
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
    if (typeof Recordings !== 'undefined' && !Views.full) { Views.switchTab('recordings'); return; }
    menuList();
  }
  function menuList() {
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
    if (canConvert(r)) items.push({ label: 'Convert to MP4', icon: 'film', sub: T('one file with its title, plot and poster, for Plex and Apple TV'), action: function () { convert(r.id).then(open); } });
    if (r.status !== 'recording') items.push({ label: 'Delete', icon: 'trash', sub: r.bytes ? sizeOf(r.bytes) + ' freed' : '', action: function () {
      UI.confirm(T('Delete "{x}"?', { x: r.title }), 'Delete', function () { remove(r.id).then(open); });
    } });
    UI.menu(r.title, items, null, { sub: whenOf(r) + '  ·  ' + r.channel });
  }
  /* Where each recording was left (this TV only), for Resume and the bar on the Recordings screen. */
  var POS_KEY = 'tivibro.recPos', pos = {};
  try { pos = JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (e) { pos = {}; }
  function savePos() { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {} }
  function posOf(id) { return pos[id] || null; }
  var watching = null, posT = null;
  // The channel a recording is of (its key, from the app), for yellow > Live while it still records.
  function chOf(r) { var all = L.data && L.data.channels || []; for (var i = 0; i < all.length; i++) if (all[i].k === r.key) return all[i]; return null; }
  // fromAt: a point in it (the live timeline going back past what's kept), else resume or from the start.
  function watch(r, fromStart, onExit, fromAt) {
    var url = base() + '/record/file/' + r.id + '/rec.' + (r.kind === 'mp4' || r.kind === 'mkv' ? r.kind : 'ts');
    var p0 = posOf(r.id), at = fromAt != null ? Math.max(0, fromAt) : !fromStart && p0 && p0.t > 30 && (!r.dur || !(U.isWatchedAt || function (p, d) { return d > 0 && (p >= d * 0.9 || p > d - 60); })(p0.t, r.dur)) ? p0.t : 0;
    if (at && fromAt == null) U.toast(T('Resuming at {t}', { t: hms(at) }), 2500);
    watching = r.id;
    Views.playVod({ id: 'rec:' + r.id, title: r.title, sub: r.channel + '  ·  ' + whenOf(r), dur: r.status === 'recording' ? 0 : r.dur, item: { recording: true }, liveCh: r.status === 'recording' ? chOf(r) : null }, url, at, function () {
      note(); watching = null; clearInterval(posT);
      (onExit || open)();
    });
    clearInterval(posT); posT = setInterval(note, 5000);
    pos[r.id] = { t: at, d: r.dur || 0, at: Date.now() }; savePos();
  }
  // While one plays: where it is, every few seconds (Back stops the player before it could be read).
  function note() {
    if (!watching) return;
    var m = Views.vodMeta;
    if (!m || m.id !== 'rec:' + watching) return;
    var t = Player.position, d = Player.duration;
    if (t > 0) { pos[watching] = { t: t, d: d || (pos[watching] && pos[watching].d) || 0, at: Date.now() }; savePos(); }
  }
  function forget(id) { delete pos[id]; savePos(); }
  function hms(s) { s = Math.round(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  // Known as TiviBro starts and every few minutes (the guide's menu and the quick menu say Record or Stop recording).
  (function poll() { if (base()) { list().catch(function () {}); drives().catch(function () {}); } setTimeout(poll, 120000); })();
  setTimeout(function () { if (base()) { list().catch(function () {}); drives().catch(function () {}); } }, 8000);

  /* Live pause (views.js): the buffer on the drive (service/timeshift.js). */
  function tsStart(ch, max) { return api('/record/ts/start', { url: urlFor(ch), key: ch.k, max: max || 0 }).then(function (r) { if (r.error && !r.id) throw new Error(r.error); return r; }); }
  function tsPing(id) { return api('/record/ts/ping', { id: id }).catch(function (e) { if (/gone|HTTP 404/.test(e && e.message)) e.gone = true; throw e; }); }
  function tsStop(id) { return api('/record/ts/stop', { id: id }).catch(function () {}); }
  // Live pause: to the USB drive, or (no drive, or a TV that isn't rooted) a short one in the TV's own storage.
  function canPause() { return !!base() && (drive || pauseHere); }
  // The always-on rewind buffer: the USB drive only (it writes all the time).
  function canBuffer() { return !!base() && drive; }

  return { now: now, schedule: schedule, convert: convert, canConvert: canConvert, tsStart: tsStart, tsPing: tsPing, tsStop: tsStop, canPause: canPause, canBuffer: canBuffer, enrich: enrich, base: base, stop: stop, remove: remove, list: list, drives: drives, open: open, shown: shown, watch: watch, posOf: posOf, forget: forget, hms: hms, sizeOf: sizeOf, whenOf: whenOf, get space() { return space; }, menuItem: menuItem, of: of, urlFor: urlFor,
    get recs() { return last.recs; } };
})();
