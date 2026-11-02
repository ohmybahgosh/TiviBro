/* Movies on now, as a screen in the side menu: big posters of the movies on your channels right now and
   starting in the next three hours (movies.js finds them, TMDB fills them in with your token), the
   focused one large at the top over its backdrop, with its title logo.  OK watches it; Hold OK or Red
   lists every channel showing it, a reminder for one starting later, or the guide on it. */
var OnNow = (function () {
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
  function chName(g) { return Library.name(g.c) + (g.list.length > 1 ? '  +' + (g.list.length - 1) : ''); }

  function data() {
    var sh = Movies.shelves();
    return [{ id: 'on', title: 'On now', items: sh.on }, { id: 'soon', title: 'Starting soon', items: sh.soon }].filter(function (r) { return r.items.length; });
  }
  function signature(rs) { return rs.map(function (r) { return r.id + ':' + r.items.map(function (g) { return g.m.id + '@' + g.c.k + (g.m.logo ? 'L' : ''); }).join(','); }).join('|'); }

  function render(force) {
    if (!built) return;
    var rs = data(), s = signature(rs);
    if (!force && s === sig) { rows = rs; times(); return; }
    var was = rows[row] && rows[row].items[pos[rows[row].id] || 0];
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
        : 'Save your own free TMDB token in Settings > Guide, start screen, reminders.  Blue opens it.'));
      hints(); return;
    }
    rows.forEach(function (r, ri) {
      var shelf = U.el('div', 'on-shelf'), track = U.el('div', 'on-track');
      shelf.appendChild(U.el('h3', '', r.title + '   ' + r.items.length));
      r.items.forEach(function (g, i) {
        var card = U.el('div', 'on-card'), art = U.el('div', 'on-art');
        if (g.m.poster) { var im = U.el('img'); im.src = g.m.poster; im.alt = ''; im.decoding = 'async'; im.onerror = function () { this.remove(); }; art.appendChild(im); }
        art.appendChild(U.el('span', 'on-ph', g.m.title));
        if (g.live) { var bar = U.el('i', 'on-bar'), f = U.el('b'); bar.appendChild(f); art.appendChild(bar); card._bar = f; }
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
    if (was) rows.forEach(function (r, ri) { var i = r.items.indexOf(r.items.filter(function (g) { return g.m.id === was.m.id; })[0]); if (i >= 0) { row = ri; pos[r.id] = i; } });
    row = Math.min(row, rows.length - 1);
    draw();
  }
  function times() {
    var now = Date.now();
    document.querySelectorAll('#onStage .on-card').forEach(function (card) {
      var g = card._g; if (!g) return;
      card._t.textContent = g.live ? mins(g.p.e - now) + ' left' : (g.p.s - now < 3600e3 ? 'in ' + mins(g.p.s - now) : 'at ' + U.hhmm(g.p.s));
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
    meta.appendChild(U.el('span', 'gd-badge' + (g.live ? ' live' : ''), g.live ? 'LIVE' : 'STARTS ' + U.hhmm(g.p.s).toUpperCase()));
    meta.appendChild(document.createTextNode(U.hhmm(g.p.s) + ' – ' + U.hhmm(g.p.e)));
    if (g.live) {
      var mini = U.el('span', 'gd-mini'), mf = U.el('i'); mf.style.width = Math.round(100 * (now - g.p.s) / (g.p.e - g.p.s)) + '%'; mini.appendChild(mf); meta.appendChild(mini);
      meta.appendChild(document.createTextNode(mins(g.p.e - now) + ' left'));
    } else meta.appendChild(document.createTextNode('   ·   in ' + mins(g.p.s - now)));
    info.appendChild(meta);
    info.appendChild(U.el('div', 'on-where', 'On ' + Library.name(g.c) + (g.list.length > 1 ? ' and ' + (g.list.length - 1) + ' more channel' + (g.list.length > 2 ? 's' : '') : '')));
    info.appendChild(U.el('div', 'on-facts', [m.year, m.runtime, m.genre, m.rating ? '★ ' + m.rating : ''].filter(Boolean).join('   ·   ')));
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
  function options() {
    var g = current(); if (!g) return;
    var items = g.list.map(function (x) {
      return { label: (g.live ? 'Watch on ' : has(x) ? 'Cancel the reminder on ' : 'Remind me on ') + Library.name(x.c), sub: U.hhmm(x.p.s) + ' – ' + U.hhmm(x.p.e) + (g.live ? ',  ' + mins(x.p.e - Date.now()) + ' left' : ''),
        action: function () { if (g.live) watch(g, x); else remind(x); } };
    });
    if (!g.live) items.push({ label: 'Watch the channel now', sub: Library.name(g.c) + ' (the movie starts at ' + U.hhmm(g.p.s) + ')', action: function () { Views.startChannel(g.c, false, function () { Views.goFull(); }); } });
    items.push({ label: 'Show in the guide', action: function () { Views.switchTab('guide'); Guide.open(Library.MOVIES, g.c.k); } });
    UI.menu(g.m.title + (g.m.year ? ' (' + g.m.year + ')' : ''), items);
  }

  function keys(a) {
    var r = rows[row];
    if (a === 'back') { Views.tabBar(restore); return true; }
    if (a === 'blue') { Views.switchTab('settings'); Settings.section('reminders'); return true; }
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
  function open() {
    build(); open_ = true;
    document.body.classList.add('onnow-open');                   // the clock over a backdrop gets a shadow
    UI.setHandler(keys);
    render(true);
    clearInterval(timer);
    timer = setInterval(function () { if (Views.tab === 'onnow' && !Views.full) render(false); }, 30000);
    if (Movies.on() && Date.now() - (Movies.lastScan || 0) > 120000) Movies.scan();
  }
  function leave() { open_ = false; clearInterval(timer); document.body.classList.remove('onnow-open'); }
  function changed() { if (open_ && Views.tab === 'onnow' && !Views.full && !UI.modalOpen) render(false); }

  return { open: open, leave: leave, changed: changed, render: render, get rows() { return rows; } };
})();
