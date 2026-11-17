/* Movies on now, as a screen in the side menu: big posters of the movies on your channels right now and
   starting in the next three hours, then the same movies by genre (movies.js finds them, TMDB fills them in with your token), the
   focused one large at the top over its backdrop, with its title logo.  OK watches it; Hold OK or Red
   lists every channel showing it, a reminder for one starting later, or the guide on it. */
var OnNow = (function () {
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{([a-z])\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, rows = [], row = 0, pos = {}, timer = null, open_ = false, sig = '';
  var CARD = 324;                                        // a poster and the gap after it, px (app.css .on-card)

  function build() {
    if (built) return;
    built = true;
    var v = $('viewOnnow');
    v.innerHTML = '<div class="on-hero" id="onHero"><div class="on-bd" id="onBd"></div><div class="on-fade"></div><div class="on-info" id="onInfo"></div></div>' +
      '<div class="on-shelves" id="onShelves"><div class="on-stage" id="onStage"></div></div><div class="on-empty hidden" id="onEmpty"></div>';
  }
  function mins(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  /* When a movie starting later starts, said the same way on its poster, under it and at the top: "in 35 min"
     within the hour, else the clock time. */
  function when(g, now) { return g.p.s - now < 3600e3 ? T('in {x}', { x: mins(g.p.s - now) }) : U.hhmm(g.p.s); }
  function left(g, now) { return T('{x} left', { x: mins(g.p.e - now) }); }
  function chName(g) { return Library.name(g.c) + (g.list.length > 1 ? '  +' + (g.list.length - 1) : ''); }

  /* The shelves, each with a line under its name saying what's in it: Playing now, Starting soon, then the
     same movies by genre (playing now first, then the later ones: Movies.genres keeps that order). */
  function count(n, one, many) { return n === 1 ? T(one) : T(many, { n: n }); }
  function data() {
    var sh = Movies.shelves();
    var out = [];
    if (sh.on.length) out.push({ id: 'on', title: T('Playing now'), sub: count(sh.on.length, '1 movie, join in progress', '{n} movies, join in progress'), items: sh.on });
    if (sh.soon.length) out.push({ id: 'soon', title: T('Starting soon'), sub: count(sh.soon.length, '1 movie in the next 3 hours', '{n} movies in the next 3 hours'), items: sh.soon });
    return out.concat(Movies.genres(sh).map(function (r) {
      var on = r.items.filter(function (g) { return g.live; }).length, later = r.items.length - on;
      var sub = [on ? count(on, '1 playing now', '{n} playing now') : '', later ? count(later, '1 starting soon', '{n} starting soon') : ''].filter(Boolean).join(',  ');
      return { id: 'g:' + r.title.toLowerCase(), title: r.title, sub: sub, items: r.items };
    }));
  }
  function signature(rs) { return rs.map(function (r) { return r.id + ':' + r.items.map(function (g) { return g.m.id + '@' + g.c.k + (g.m.logo ? 'L' : ''); }).join(','); }).join('|'); }

  function render(force) {
    if (!built) return;
    var rs = data(), s = signature(rs);
    if (!force && s === sig) { rows = rs; times(); return; }
    var wasRow = rows[row] && rows[row].id, was = wasRow && rows[row].items[pos[wasRow] || 0];
    rows = rs; sig = s;
    var stage = $('onStage');
    stage.innerHTML = '';
    var empty = !rows.length;
    $('onEmpty').classList.toggle('hidden', !empty);
    $('onShelves').classList.toggle('hidden', empty);
    $('onHero').classList.toggle('hidden', empty);
    if (empty) {
      $('onEmpty').innerHTML = '';
      $('onEmpty').appendChild(U.el('b', '', Movies.on() ? (Movies.pending ? 'Looking through your guide for movies…' : 'No movies on right now') : 'Movies on now needs a TMDB token'));
      $('onEmpty').appendChild(U.el('p', '', Movies.on() ? 'TiviBro looks at what\'s on and the next three hours, and asks TMDB which programmes are movies.  New ones show up here as they are found.'
        : 'Save your own free TMDB token in Settings > API keys.  Blue opens it.'));
      hints(); return;
    }
    rows.forEach(function (r, ri) {
      var shelf = U.el('div', 'on-shelf'), track = U.el('div', 'on-track');
      var h = U.el('h3', '', r.title); h.appendChild(U.el('span', 'on-sub', r.sub)); shelf.appendChild(h);
      r.items.forEach(function (g, i) {
        // Playing now or later, at a glance: the guide's LIVE badge and a progress bar, or the start time on a
        // quieter poster.
        var card = U.el('div', 'on-card' + (g.live ? ' on-live' : ' on-later')), art = U.el('div', 'on-art');
        if (g.m.poster) { var im = U.el('img'); im.src = g.m.poster; im.alt = ''; im.decoding = 'async'; im.onerror = function () { this.remove(); }; art.appendChild(im); }
        art.appendChild(U.el('span', 'on-ph', g.m.title));
        if (g.live) { var bar = U.el('i', 'on-bar'), f = U.el('b'); bar.appendChild(f); art.appendChild(bar); card._bar = f; }
        card._tag = U.el('span', 'on-tag' + (g.live ? ' live' : ''), g.live ? T('LIVE') : ''); art.appendChild(card._tag);
        card.appendChild(art);
        var cap = U.el('div', 'on-cap');
        cap.appendChild(U.el('span', 'on-ch', chName(g)));
        card._t = U.el('span', 'on-t', ''); cap.appendChild(card._t);
        card.appendChild(cap);
        card._g = g;
        card.addEventListener('click', function () { row = ri; pos[r.id] = i; draw(); watch(g); });
        card.addEventListener('mousemove', function () { if (UI.pointer && (row !== ri || pos[r.id] !== i)) { row = ri; pos[r.id] = i; draw(); } });
        track.appendChild(card);
        Movies.fill(g.m, function () { render(true); });
      });
      shelf.appendChild(track);
      stage.appendChild(shelf);
    });
    // Keep the movie you were on.
    // Keep the shelf and the movie you were on.  A movie can be on now and again later: the shelf you're
    // on wins, so new pictures arriving never move you to the other one.
    var same = wasRow ? rows.map(function (r) { return r.id; }).indexOf(wasRow) : -1;
    if (same >= 0) {
      row = same;
      var at = was ? rows[same].items.map(function (g) { return g.m.id; }).indexOf(was.m.id) : -1;
      pos[wasRow] = at >= 0 ? at : Math.min(pos[wasRow] || 0, rows[same].items.length - 1);
    } else row = 0;
    row = Math.min(row, rows.length - 1);
    draw();
  }
  function times() {
    var now = Date.now();
    document.querySelectorAll('#onStage .on-card').forEach(function (card) {
      var g = card._g; if (!g) return;
      card._t.textContent = g.live ? left(g, now) : U.hhmm(g.p.s);          // later: the badge says how soon
      if (!g.live) card._tag.textContent = when(g, now).toUpperCase();
      if (card._bar) card._bar.style.width = Math.round(100 * U.clamp((now - g.p.s) / (g.p.e - g.p.s), 0, 1)) + '%';
    });
  }
  function current() { var r = rows[row]; return r && r.items[pos[r.id] || 0]; }
  function draw() {
    var shelves = document.querySelectorAll('#onStage .on-shelf');
    shelves.forEach(function (el, ri) {
      var r = rows[ri], at = pos[r.id] || 0, cards = el.querySelectorAll('.on-card');
      cards.forEach(function (c, i) { c.classList.toggle('focus', ri === row && i === at); });
      var shift = Math.max(0, at - 1) * CARD;
      el.querySelector('.on-track').style.transform = 'translateX(' + (-shift) + 'px)';
      el.classList.toggle('active', ri === row);
    });
    // The focused shelf at the top of the space under the hero.
    var y = 0; for (var i = 0; i < row; i++) y += shelves[i].offsetHeight;
    $('onStage').style.transform = 'translateY(' + (-y) + 'px)';
    hero();
    times();
    hints();
  }
  function hero() {
    var g = current(), info = $('onInfo'), bd = $('onBd');
    info.innerHTML = '';
    if (!g) return;
    var m = g.m, now = Date.now(), src = m.backdropHd || m.backdrop || '';
    if (bd._src !== src) { bd._src = src; bd.style.backgroundImage = src ? 'url("' + src + '")' : 'none'; }
    if (m.logo) {
      var lg = U.el('img', 'on-logo'); lg.src = m.logo; lg.alt = m.title;
      lg.onerror = function () { this.replaceWith(U.el('h1', 'on-title', m.title)); };
      info.appendChild(lg);
    } else info.appendChild(U.el('h1', 'on-title', m.title));
    var meta = U.el('div', 'on-meta');
    // "Playing now · 8:00pm – 9:30pm · 25 min left", or "Starts at 8:30pm · in 35 min".
    meta.appendChild(U.el('span', 'gd-badge' + (g.live ? ' live' : ' up'), g.live ? T('Playing now') : T('Starts at {x}', { x: U.hhmm(g.p.s) })));
    if (g.live) {
      meta.appendChild(document.createTextNode(U.hhmm(g.p.s) + ' – ' + U.hhmm(g.p.e)));
      var mini = U.el('span', 'gd-mini'), mf = U.el('i'); mf.style.width = Math.round(100 * (now - g.p.s) / (g.p.e - g.p.s)) + '%'; mini.appendChild(mf); meta.appendChild(mini);
      meta.appendChild(document.createTextNode(left(g, now)));
    } else meta.appendChild(document.createTextNode(T('in {x}', { x: mins(g.p.s - now) })));
    info.appendChild(meta);
    info.appendChild(U.el('div', 'on-where', g.list.length > 1 ? T('On {x} and {n} more', { x: Library.name(g.c), n: g.list.length - 1 }) : T('On {x}', { x: Library.name(g.c) })));
    info.appendChild(U.el('div', 'on-facts', [m.year, U.runtime(m.runtime), m.genre, m.rating ? '★ ' + m.rating : ''].filter(Boolean).join('   ·   ')));
    if (m.plot) info.appendChild(U.el('p', 'on-plot', m.plot));
  }
  function hints() {
    if (!open_ || Views.tab !== 'onnow') return;
    if (!rows.length) return UI.hints([['', 'Back  menu', 'back'], ['blue', 'Settings']]);
    var g = current();
    UI.hints([['', g && !g.live ? 'OK  remind me or watch the channel' : 'OK  watch', 'ok'], ['', 'Hold OK  channels, remind', 'hold'], ['', 'Back  menu', 'back'], ['red', 'Options'], ['blue', 'Settings']]);
  }

  function watch(g, x) {
    x = x || g;
    if (!g.live && !x.live && x.p.s > Date.now() + 60000) { askRemind(g, x); return; }
    Views.startChannel(x.c, false, function () { Views.goFull(); });
  }
  /* OK on a movie starting later asks first (an OK pressed by accident sets nothing): Cancel is where
     the cursor starts. */
  function askRemind(g, x) {
    var set = has(x), name = Library.name(x.c);
    UI.menu(g.m.title + (set ? ': reminder set' : ' starts at ' + U.hhmm(x.p.s)), [
      { label: set ? 'Cancel the reminder' : 'Remind me at ' + U.hhmm(x.p.s), sub: 'on ' + name, action: function () { remind(x); } },
      { label: 'Watch ' + name + ' now', sub: 'the movie starts in ' + mins(x.p.s - Date.now()), action: function () { Views.startChannel(x.c, false, function () { Views.goFull(); }); } },
      { label: 'Cancel', current: true }
    ]);
  }
  function remind(x) {
    var rem = Store.edits.reminders, i = rem.findIndex(function (r) { return r.k === x.c.k && r.s === x.p.s; });
    if (i >= 0) { rem.splice(i, 1); U.toast('Reminder cancelled'); }
    else { rem.push({ k: x.c.k, s: x.p.s, e: x.p.e, t: x.p.t }); U.toast('Reminder set for ' + U.hhmm(x.p.s) + ' on ' + Library.name(x.c)); }
    Store.saveEdits();
    if (typeof Remind !== 'undefined' && Remind.sync) Remind.sync(true);
  }
  function has(x) { return Store.edits.reminders.some(function (r) { return r.k === x.c.k && r.s === x.p.s; }); }
  // Hold OK: a row per showing (soonest first), then watching the channel and the guide.  A movie on many
  // channels shows the first few and a row for the rest, so the last rows are never pushed out of view.
  var SHOW_MAX = 4;
  function options() {
    var g = current(); if (!g) return;
    function row(x) {
      return { label: (g.live ? 'Watch on ' : has(x) ? 'Cancel the reminder on ' : 'Remind me on ') + Library.name(x.c), sub: U.hhmm(x.p.s) + ' – ' + U.hhmm(x.p.e) + (g.live ? ',  ' + mins(x.p.e - Date.now()) + ' left' : ''),
        icon: g.live ? 'play' : has(x) ? 'belloff' : 'bell', action: function () { if (g.live) watch(g, x); else remind(x); } };
    }
    var list = g.list.slice().sort(function (a, b) { return a.p.s - b.p.s || Library.name(a.c).localeCompare(Library.name(b.c)); });
    var items = (list.length > SHOW_MAX + 1 ? list.slice(0, SHOW_MAX) : list).map(row);
    if (list.length > SHOW_MAX + 1) items.push({ label: 'All ' + list.length + ' showings…', icon: 'list', action: function () { UI.menu(g.m.title + ': every showing', list.map(row)); } });
    if (!g.live) items.push({ label: 'Watch the channel now', sub: Library.name(g.c) + ' (the movie starts at ' + U.hhmm(g.p.s) + ')', icon: 'play', action: function () { Views.startChannel(g.c, false, function () { Views.goFull(); }); } });
    items.push({ label: 'Show in the guide', icon: 'grid', action: function () { Views.switchTab('guide'); Guide.open(Library.MOVIES, g.c.k); } });
    UI.menu(RAW(g.m.title + (g.m.year ? ' (' + g.m.year + ')' : '')), items);
  }

  function keys(a) {
    var r = rows[row];
    if (a === 'back') { Views.tabBar(restore); return true; }
    if (a === 'blue') { Views.switchTab('settings'); Settings.section('keys'); return true; }
    if (!r) { if (a === 'left') Views.tabBar(restore); return true; }
    var at = pos[r.id] || 0;
    if (a === 'left') { if (at === 0) Views.tabBar(restore); else { pos[r.id] = at - 1; draw(); } }
    else if (a === 'right') { if (at < r.items.length - 1) { pos[r.id] = at + 1; draw(); } }
    else if (a === 'chup' || a === 'chdown') { pos[r.id] = U.clamp(at + (a === 'chup' ? -5 : 5), 0, r.items.length - 1); draw(); }
    else if (a === 'up') { if (row > 0) { row--; draw(); } }
    else if (a === 'down') { if (row < rows.length - 1) { row++; draw(); } }
    else if (a === 'ok') watch(r.items[at]);
    else if (a === 'red' || a === 'hold' || a === 'info') options();
    return true;
  }
  function restore() { UI.setHandler(keys); hints(); }
  /* Back from a movie watched in fullscreen (views.js exitFull): the same shelf and movie, brought up to date. */
  function resume() { if (!open_) return open(); UI.setHandler(keys); render(true); }
  function open() {
    build(); open_ = true;
    rows = []; row = 0; pos = {};                                 // each visit starts at the top: On now, first movie
    document.body.classList.add('onnow-open');                   // the clock over a backdrop gets a shadow
    UI.setHandler(keys);
    render(true);
    clearInterval(timer);
    timer = setInterval(function () { if (Views.tab === 'onnow' && !Views.full) render(false); }, 30000);
    if (Movies.on() && Date.now() - (Movies.lastScan || 0) > 120000) Movies.scan();
  }
  function leave() { open_ = false; clearInterval(timer); document.body.classList.remove('onnow-open'); }
  function changed() { if (open_ && Views.tab === 'onnow' && !Views.full && !UI.modalOpen) render(false); }

  return { open: open, resume: resume, leave: leave, changed: changed, render: render, watch: watch, get rows() { return rows; } };
})();
