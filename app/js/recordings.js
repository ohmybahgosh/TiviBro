/* Recordings, as a screen in the side menu (record.js does the asking; service/record.js the recording).
   At the top, the USB drive and its room.  Then the list: Recording now, Scheduled, Recorded (a show recorded more
   than once is one row that opens to its recordings), and Didn't record.  On the right, the focused one: what it is,
   when, how long, how much of it you've watched.
   OK watches (from where you left off), or opens a show's recordings.  Hold OK or Red: Watch from the start, Stop,
   Cancel, Delete, Select several.  Selecting: OK ticks, Red deletes the ticked ones, Back stops selecting.
   Left on the list or Back: the side menu. */
var Recordings = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, open_ = false, items = [], sel = 0, top = 0, openShows = {}, picking = null, timer = null, err = '', loaded = false;
  var VISIBLE = 9;

  function build() {
    if (built) return;
    built = true;
    $('viewRecordings').innerHTML =
      '<div class="rc-main"><div class="rc-head"><h1>' + T('Recordings') + '</h1><div class="rc-drive" id="rcDrive"></div></div>' +
      '<div class="rc-list" id="rcList"></div><div class="rc-empty hidden" id="rcEmpty"></div></div>' +
      '<div class="rc-side" id="rcSide"></div>';
  }

  /* ---------- what's shown ---------- */
  function startOf(r) { return r.startedAt || r.start; }
  function rows(recs) {
    var now = recs.filter(function (r) { return r.status === 'recording'; }).sort(function (a, b) { return startOf(b) - startOf(a); });
    var later = recs.filter(function (r) { return r.status === 'scheduled'; }).sort(function (a, b) { return a.start - b.start; });
    var done = recs.filter(function (r) { return r.status === 'done'; }).sort(function (a, b) { return startOf(b) - startOf(a); });
    var bad = recs.filter(function (r) { return /^(failed|missed|cancelled)$/.test(r.status); }).sort(function (a, b) { return startOf(b) - startOf(a); });
    var out = [];
    function head(t, n) { out.push({ head: true, label: T(t), n: n }); }
    if (now.length) { head('Recording now', now.length); now.forEach(function (r) { out.push({ r: r }); }); }
    if (later.length) { head('Scheduled', later.length); later.forEach(function (r) { out.push({ r: r }); }); }
    if (done.length) {
      head('Recorded', done.length);
      // A show recorded more than once: one row, opened with OK, its recordings newest first under it.
      var byTitle = {}, order = [];
      done.forEach(function (r) { var k = r.title.toLowerCase(); if (!byTitle[k]) { byTitle[k] = []; order.push(k); } byTitle[k].push(r); });
      order.forEach(function (k) {
        var g = byTitle[k];
        if (g.length === 1) { out.push({ r: g[0] }); return; }
        out.push({ show: k, list: g, title: g[0].title });
        if (openShows[k]) g.forEach(function (r) { out.push({ r: r, inShow: k }); });
      });
    }
    if (bad.length) { head('Didn\'t record', bad.length); bad.forEach(function (r) { out.push({ r: r }); }); }
    return out;
  }
  function focusable(i) { return items[i] && !items[i].head; }
  function keyOf(it) { return it ? (it.r ? 'r:' + it.r.id : it.show ? 's:' + it.show : '') : ''; }

  function render() {
    if (!built) return;
    var was = keyOf(items[sel]);
    items = rows(Record.recs);
    var at = -1;
    if (was) items.forEach(function (it, i) { if (at < 0 && keyOf(it) === was) at = i; });
    sel = at >= 0 ? at : Math.min(sel, items.length - 1);
    if (!focusable(sel)) { var n = next(sel, 1); sel = n >= 0 ? n : next(sel, -1); }
    drive();
    var empty = !items.length, em = $('rcEmpty');
    em.classList.toggle('hidden', !empty);
    $('rcSide').classList.toggle('hidden', empty);
    $('rcList').classList.toggle('hidden', empty);
    if (empty) {
      em.innerHTML = '';
      var sp = Record.space;
      em.appendChild(U.el('b', '', !loaded ? T('Looking for recordings…') : err ? T('Recordings aren\'t available') : sp ? T('Nothing recorded yet') : T('Plug in a USB drive to record')));
      em.appendChild(U.el('p', '', err ? err : sp ? T('In the guide, Hold OK on a programme and choose Record.  While watching, the quick menu has Record too.')
        : T('TiviBro records to a USB drive in the TV, into a "TiviBro Recordings" folder.  It needs a rooted TV (the Homebrew Channel): webOS keeps USB drives from apps installed in developer mode.')));
      $('rcSide').innerHTML = '';
      hints();
      return;
    }
    draw();
  }
  function drive() {
    var el = $('rcDrive'), sp = Record.space;
    el.innerHTML = '';
    if (!sp) { el.appendChild(U.el('span', 'rc-nodrive', loaded ? T('No USB drive') : '')); return; }
    var gb = function (mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(0, mb) + ' MB'; };
    el.appendChild(U.el('span', 'rc-dname', T('USB drive')));
    if (sp.totalMB > 0) {
      var bar = U.el('i', 'rc-dbar' + (sp.low ? ' low' : '')), f = U.el('b');
      f.style.width = Math.round(100 * (1 - Math.max(0, sp.freeMB) / sp.totalMB)) + '%';
      bar.appendChild(f); el.appendChild(bar);
      el.appendChild(U.el('span', 'rc-dfree' + (sp.low ? ' low' : ''), T('{x} free of {y}', { x: gb(sp.freeMB), y: gb(sp.totalMB) })));
    }
  }
  function len(s) { if (!s) return ''; var m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.max(1, m) + ' min'; }
  function seen(r) { var p = Record.posOf(r.id), d = r.dur || (p && p.d) || 0; return p && d ? U.clamp(p.t / d, 0, 1) : 0; }
  function subOf(r) {
    var bits = [Record.whenOf(r)];
    if (r.channel && r.channel !== r.title) bits.push(r.channel);
    if (r.status === 'scheduled') bits.push(U.hhmm(r.start) + ' – ' + U.hhmm(r.end));
    else if (r.dur) bits.push(len(r.dur));
    if (r.bytes) bits.push(Record.sizeOf(r.bytes));
    if (r.status !== 'done' && r.status !== 'recording' && r.error) bits.push(r.error);
    return bits.filter(Boolean).join('   ·   ');
  }
  function iconOf(it) {
    if (it.show) return 'folder';
    var s = it.r.status;
    return s === 'recording' ? 'rec' : s === 'scheduled' ? 'history' : s === 'done' ? 'play' : 'warn';
  }
  function draw() {
    var list = $('rcList');
    // Scrolled so the focused row stays in view, a row of context above it.
    if (sel < top + 1) top = Math.max(0, sel - 1);
    if (sel > top + VISIBLE - 2) top = Math.min(Math.max(0, items.length - VISIBLE), sel - VISIBLE + 2);
    list.innerHTML = '';
    items.slice(top, top + VISIBLE).forEach(function (it, k) {
      var i = top + k;
      if (it.head) { var h = U.el('div', 'rc-headrow'); h.appendChild(document.createTextNode(it.label)); h.appendChild(U.el('span', 'rc-n', String(it.n))); list.appendChild(h); return; }
      var row = U.el('div', 'rc-row' + (i === sel ? ' focus' : '') + (it.inShow ? ' sub' : '') + (it.r ? ' st-' + it.r.status : ' show'));
      // Selecting: a box on what can be deleted (not one still recording, not a show's row).
      if (picking) row.appendChild(U.el('span', 'rc-tick' + (it.r && it.r.status !== 'recording' ? (picking[it.r.id] ? ' on' : '') : ' none')));
      // Its poster when TMDB knows it (record.js asks), else what it is.
      var mt = metaOf(it);
      if (mt && mt.poster) { var pw = U.el('span', 'rc-poster'), pim = U.el('img'); pim.src = mt.poster; pim.alt = ''; pim.decoding = 'async'; pim.onerror = function () { pw.innerHTML = UI.icon(iconOf(it)); pw.className = 'rc-ic'; }; pw.appendChild(pim); row.appendChild(pw); }
      else { var ic = U.el('span', 'rc-ic'); ic.innerHTML = UI.icon(iconOf(it)); row.appendChild(ic); }
      var txt = U.el('div', 'rc-txt');
      if (it.show) {
        txt.appendChild(U.el('b', '', RAW(it.title)));
        txt.appendChild(U.el('small', '', T('{n} recordings', { n: it.list.length }) + '   ·   ' + T('newest {x}', { x: Record.whenOf(it.list[0]) })));
      } else {
        txt.appendChild(U.el('b', '', RAW(it.inShow ? Record.whenOf(it.r) : it.r.title)));
        txt.appendChild(U.el('small', '', it.inShow ? [it.r.dur ? len(it.r.dur) : '', it.r.bytes ? Record.sizeOf(it.r.bytes) : ''].filter(Boolean).join('   ·   ') : subOf(it.r)));
        var f = seen(it.r);
        if (it.r.status === 'done' && f > 0.02) { var bar = U.el('i', 'rc-seen'), fill = U.el('b'); fill.style.width = Math.round(f * 100) + '%'; bar.appendChild(fill); txt.appendChild(bar); }
      }
      row.appendChild(txt);
      if (it.r && it.r.status === 'recording') row.appendChild(U.el('span', 'rc-badge rec', T('REC')));
      else if (it.r && it.r.status === 'done' && !Record.posOf(it.r.id)) row.appendChild(U.el('span', 'rc-badge new', T('NEW')));
      else if (it.show) row.appendChild(U.el('span', 'rc-chev', openShows[it.show] ? '▾' : '▸'));
      row.addEventListener('click', function () { sel = i; draw(); ok(); });
      row.addEventListener('mousemove', function () { if (UI.pointer && sel !== i) { sel = i; draw(); } });
      list.appendChild(row);
    });
    side();
    hints();
  }
  function metaOf(it) { var r = it && (it.r || (it.list && it.list[0])); var m = r && r.meta; return m && !m.miss ? m : null; }
  function side() {
    var el = $('rcSide'), it = items[sel];
    el.innerHTML = '';
    if (!it || it.head) return;
    var r = it.r || it.list[0], mt = metaOf(it);
    // TMDB's backdrop behind the top of the panel, and its poster; else the channel's logo.
    var bd = mt && (mt.backdropHd || mt.backdrop);
    if (bd) { var b = U.el('div', 'rc-bd'); b.style.backgroundImage = 'url("' + bd + '")'; el.appendChild(b); el.classList.add('has-bd'); } else el.classList.remove('has-bd');
    if (mt && mt.poster) { var pi = U.el('img', 'rc-bigposter'); pi.src = mt.poster; pi.alt = ''; pi.onerror = function () { this.remove(); }; el.appendChild(pi); }
    else if (r.logo) { var im = U.el('img', 'rc-logo'); im.src = r.logo; im.onerror = function () { this.remove(); }; el.appendChild(im); }
    el.appendChild(U.el('h2', '', RAW(it.show ? it.title : r.title)));
    if (mt) { var f0 = [mt.year, mt.genre, mt.rating ? '★ ' + mt.rating : ''].filter(Boolean).join('   ·   '); if (f0) el.appendChild(U.el('div', 'rc-tmdb', f0)); }
    if (r.ep && !it.show) el.appendChild(U.el('div', 'rc-ep', r.ep));
    if (r.channel && r.channel !== r.title) el.appendChild(U.el('div', 'rc-ch', RAW(r.channel)));
    if (it.show) {
      var total = 0, bytes = 0; it.list.forEach(function (x) { total += x.dur || 0; bytes += x.bytes || 0; });
      el.appendChild(U.el('div', 'rc-facts', T('{n} recordings', { n: it.list.length }) + '   ·   ' + len(total) + '   ·   ' + Record.sizeOf(bytes)));
      if (mt && mt.plot) el.appendChild(U.el('p', 'rc-plot', RAW(mt.plot)));
      return;
    }
    var st = { recording: T('Recording now'), scheduled: T('Scheduled'), done: T('Recorded'), failed: T('Didn\'t record'), missed: T('Missed'), cancelled: T('Cancelled') }[r.status] || r.status;
    var meta = U.el('div', 'rc-meta');
    meta.appendChild(U.el('span', 'gd-badge' + (r.status === 'recording' ? ' rec' : r.status === 'scheduled' ? ' up' : ''), st));
    meta.appendChild(document.createTextNode(Record.whenOf(r)));
    el.appendChild(meta);
    var facts = [];
    if (r.status === 'scheduled') facts.push(U.hhmm(r.start) + ' – ' + U.hhmm(r.end) + '  (' + T('with a few minutes either side') + ')');
    else if (r.status === 'recording') facts.push(T('until {t}', { t: U.hhmm(r.end) }));
    if (r.dur) facts.push(len(r.dur));
    if (r.bytes) facts.push(Record.sizeOf(r.bytes));
    if (r.gaps) facts.push(T('{n} short gaps (the provider dropped the connection)', { n: r.gaps }));
    if (facts.length) el.appendChild(U.el('div', 'rc-facts', facts.join('   ·   ')));
    if (r.error && r.status !== 'done') el.appendChild(U.el('div', 'rc-err', r.error));
    var plot = mt && mt.plot || r.desc;
    if (plot) el.appendChild(U.el('p', 'rc-plot', RAW(plot)));
    var p = Record.posOf(r.id), f = seen(r);
    if (r.status === 'done' && p && f > 0.02) {
      var w = U.el('div', 'rc-watched'), bar = U.el('i', 'rc-seen big'), fill = U.el('b'); fill.style.width = Math.round(f * 100) + '%'; bar.appendChild(fill);
      w.appendChild(bar); w.appendChild(U.el('span', '', f >= (U.watchedFrac ? U.watchedFrac() : 0.9) ? T('Watched') : T('Stopped at {t}', { t: Record.hms(p.t) })));
      el.appendChild(w);
    }
  }
  function hints() {
    if (!open_ || Views.tab !== 'recordings') return;
    if (picking) { var n = Object.keys(picking).length; return UI.hints([['', 'OK  tick or untick', 'ok'], ['red', n ? T('Delete {n}', { n: n }) : 'Delete'], ['', 'Back  done', 'back']]); }
    var it = items[sel];
    if (!it) return UI.hints([['', 'Back  menu', 'back']]);
    var okSay = it.show ? (openShows[it.show] ? 'OK  close' : 'OK  open') : it.r.status === 'scheduled' ? 'OK  options' : it.r.bytes > 0 ? (Record.posOf(it.r.id) && seen(it.r) > 0.02 && seen(it.r) < (U.watchedFrac ? U.watchedFrac() : 0.9) ? 'OK  resume' : 'OK  watch') : 'OK  options';
    UI.hints([['', okSay, 'ok'], ['', 'Hold OK  options', 'hold'], ['', 'Back  menu', 'back'], ['red', 'Options']]);
  }

  /* ---------- doing ---------- */
  function next(from, dir) { for (var i = from + dir; i >= 0 && i < items.length; i += dir) if (focusable(i)) return i; return -1; }
  function ok() {
    var it = items[sel];
    if (!it || it.head) return;
    if (picking) { if (it.r && it.r.status === 'recording') { U.toast(T('Stop a recording before deleting it')); return; } if (it.r) { if (picking[it.r.id]) delete picking[it.r.id]; else picking[it.r.id] = 1; draw(); } else if (it.show) { openShows[it.show] = true; render(); } return; }
    if (it.show) { openShows[it.show] = !openShows[it.show]; render(); return; }
    if (it.r.bytes > 0 && (it.r.status === 'done' || it.r.status === 'recording')) return watch(it.r, false);
    options();
  }
  function watch(r, fromStart) { Record.watch(r, fromStart || r.status === 'recording', resume); }
  function options() {
    var it = items[sel];
    if (!it || it.head) return;
    var out = [];
    if (it.show) {
      out.push({ label: openShows[it.show] ? 'Close' : 'Show its recordings', icon: 'folder', action: function () { openShows[it.show] = !openShows[it.show]; render(); } });
      out.push({ label: T('Delete all {n}', { n: it.list.length }), icon: 'trash', action: function () { ask(it.list); } });
    } else {
      var r = it.r, p = Record.posOf(r.id);
      if (r.bytes > 0 && r.status === 'done') {
        out.push({ label: p && seen(r) > 0.02 && seen(r) < (U.watchedFrac ? U.watchedFrac() : 0.9) ? T('Resume from {t}', { t: Record.hms(p.t) }) : 'Watch', icon: 'play', action: function () { watch(r, false); } });
        if (p && p.t > 30) out.push({ label: 'Watch from the start', icon: 'replay', action: function () { watch(r, true); } });
      }
      if (r.bytes > 0 && r.status === 'recording') out.push({ label: 'Watch from the start', icon: 'play', sub: T('while it records'), action: function () { watch(r, true); } });
      if (r.status === 'recording') out.push({ label: 'Stop recording', icon: 'stop', sub: T('keeps what\'s recorded'), action: function () { Record.stop(r.id).then(render); } });
      if (r.status === 'scheduled') out.push({ label: 'Cancel recording', icon: 'stop', sub: U.hhmm(r.start), action: function () { Record.stop(r.id).then(render); } });
      if (r.status !== 'recording') out.push({ label: 'Delete', icon: 'trash', sub: r.bytes ? T('{x} freed', { x: Record.sizeOf(r.bytes) }) : '', action: function () { ask([r]); } });
      if (p && r.status === 'done') out.push({ label: 'Mark as not watched', icon: 'eye', action: function () { Record.forget(r.id); render(); } });
    }
    out.push({ label: 'Select several…', icon: 'check', sub: T('to delete more than one'), action: function () { picking = {}; if (it.r && it.r.status !== 'recording') picking[it.r.id] = 1; draw(); } });
    UI.menu(RAW(it.show ? it.title : it.r.title), out, null, { sub: it.r ? Record.whenOf(it.r) : '' });
  }
  function ask(list) {
    list = list.filter(function (r) { return r.status !== 'recording'; });
    if (!list.length) { U.toast(T('Stop a recording before deleting it')); return; }
    var bytes = 0; list.forEach(function (r) { bytes += r.bytes || 0; });
    var title = list.length === 1 ? T('Delete "{x}"?', { x: list[0].title }) : T('Delete {n} recordings?', { n: list.length });
    UI.confirm(title + (bytes ? '  (' + Record.sizeOf(bytes) + ')' : ''), 'Delete', function () {
      (function one(i) {
        if (i >= list.length) { picking = null; U.toast(list.length === 1 ? T('Deleted') : T('Deleted {n} recordings', { n: list.length })); return render(); }
        Record.remove(list[i].id).then(function () { one(i + 1); }, function () { one(i + 1); });
      })(0);
    });
  }

  function keys(a) {
    if (a === 'back') { if (picking) { picking = null; draw(); return true; } Views.tabBar(restore); return true; }
    if (a === 'left') { Views.tabBar(restore); return true; }
    if (!items.length) return true;
    if (a === 'up' || a === 'down') { var n = next(sel, a === 'up' ? -1 : 1); if (n >= 0) { sel = n; draw(); } }
    else if (a === 'chup' || a === 'chdown') { var d = a === 'chup' ? -1 : 1, m = sel; for (var k = 0; k < VISIBLE - 2; k++) { var x = next(m, d); if (x < 0) break; m = x; } sel = m; draw(); }
    else if (a === 'ok' || a === 'right') { if (a === 'ok') ok(); }
    else if (a === 'red' || a === 'hold' || a === 'info') {
      if (picking) { var ids = Object.keys(picking); if (ids.length) ask(Record.recs.filter(function (r) { return picking[r.id]; })); else U.toast(T('Tick the ones to delete with OK')); }
      else options();
    }
    return true;
  }
  function restore() { UI.setHandler(keys); hints(); }
  function refresh() {
    return Record.list().then(function () { loaded = true; err = ''; if (open_ && Views.tab === 'recordings' && !Views.full) render(); },
      function (e) { loaded = true; err = e && e.message || ''; if (open_ && Views.tab === 'recordings' && !Views.full) render(); });
  }
  // Back from watching one: the same row, brought up to date.
  function resume() { if (!open_) return open(); UI.setHandler(keys); render(); refresh(); }
  function open() {
    build(); open_ = true; picking = null;
    UI.setHandler(keys);
    render();
    refresh();
    clearInterval(timer);
    // Sizes and lengths grow while something records.
    timer = setInterval(function () { if (open_ && Views.tab === 'recordings' && !Views.full && !UI.modalOpen) refresh(); }, 10000);
  }
  function leave() { open_ = false; picking = null; clearInterval(timer); }

  return { open: open, resume: resume, leave: leave, render: render, get items() { return items; } };
})();
