/* The Sports screen, in the side menu: today's games from ESPN (sports.js) as cards with the two teams' logos,
   records, the score and clock or the start, and which of your channels has it.  Rows: My teams (the games of
   the teams you follow, this week), Live now (every league), then a row per league (today's games, or
   tomorrow's when it has none today).

   OK watches the game on your best channel (a game more than five minutes away asks first: remind me, or watch
   the channel now).  Hold OK or Red: every channel of yours that has it, and a reminder.  Green follows one of
   the two teams.  Blue picks the leagues.  Scores update every 30 seconds while a game is live. */
var SportsHub = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{([a-z])\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, open_ = false, rows = [], row = 0, pos = {}, timer = null, sig = '', firstLoad = true, touched = false;
  var CARD = 432;                                               // a card and the gap after it, px (app.css .sp-card)

  function build() {
    if (built) return;
    built = true;
    $('viewSports').innerHTML = '<div class="sp-head"><h1>' + T('Sports') + '</h1><span class="sp-sub" id="spSub"></span></div>' +
      '<div class="sp-rows" id="spRows"><div class="sp-stage" id="spStage"></div></div><div class="sp-empty hidden" id="spEmpty"></div>';
  }

  /* ---------- what's in the rows ---------- */
  function mine(g) { return g.teams.some(function (t) { return t.id && Teams.follows && Teams.follows(t.id); }); }
  function order(a, b) {
    var ra = a.state === 'in' ? 0 : a.state === 'pre' ? 1 : 2, rb = b.state === 'in' ? 0 : b.state === 'pre' ? 1 : 2;
    return ra - rb || (ra === 2 ? b.s - a.s : a.s - b.s);
  }
  function data() {
    var now = Date.now(), out = [], every = Sports.all(), seen = {};
    // My teams: on now, then what's next this week, and today's finals last.
    var my = every.filter(function (g) { if (seen[g.id] || !mine(g)) return false; seen[g.id] = 1; return g.state !== 'post' || g.s > now - 12 * 3600e3; }).sort(order).slice(0, 14);
    if (my.length) out.push({ id: 'mine', title: T('My teams'), sub: T('on now first, then what\'s next'), items: my });
    seen = {};
    var live = every.filter(function (g) { if (seen[g.id] || g.state !== 'in') return false; seen[g.id] = 1; return true; }).sort(order);
    if (live.length) out.push({ id: 'live', title: T('Live now'), sub: live.length === 1 ? T('1 game') : T('{n} games', { n: live.length }), items: live });
    Sports.leagues().forEach(function (lg) {
      var today = Sports.day(lg.id, 0), when = '', list = today;
      if (today && !today.length) { list = Sports.day(lg.id, 1); when = T('Tomorrow'); }
      if (!list) return;                                      // not loaded yet
      if (!list.length) return;
      out.push({ id: 'lg:' + lg.id, title: lg.name, sub: (when ? when + '  ·  ' : '') + (list.length === 1 ? T('1 game') : T('{n} games', { n: list.length })), items: list.slice().sort(order) });
    });
    return out;
  }
  function signature(rs) { return rs.map(function (r) { return r.id + ':' + r.items.map(function (g) { return g.id + g.state + g.detail + g.teams.map(function (t) { return t.score; }).join('-'); }).join(','); }).join('|'); }

  /* ---------- cards ---------- */
  function teamRow(g, t, o) {
    var lose = g.state === 'post' && o && t.score != null && o.score != null && t.score < o.score;
    var el = U.el('div', 'sp-team' + (lose ? ' lose' : ''));
    var lg = U.el('div', 'sp-logo');
    if (t.logo) { var im = new Image(); im.decoding = 'async'; im.alt = ''; im.onerror = function () { this.remove(); lg.textContent = t.abbr; }; im.src = t.logo; lg.appendChild(im); }
    else lg.textContent = t.abbr;
    el.appendChild(lg);
    var n = U.el('div', 'sp-name');
    if (t.rank) n.appendChild(U.el('small', 'sp-rank', String(t.rank)));
    n.appendChild(document.createTextNode(RAW(t.name)));
    if (t.rec) n.appendChild(U.el('span', 'sp-rec', t.rec));
    el.appendChild(n);
    if (g.state !== 'pre' && t.score != null) el.appendChild(U.el('div', 'sp-score', String(t.score)));
    return el;
  }
  function status(g) {
    if (g.state === 'in') return g.detail.replace(/\s+-\s+/, ' ');
    if (g.state === 'post') return T('Final') + (/OT|SO|\/\d/.test(g.detail) ? ' ' + g.detail.replace(/^Final\/?/i, '') : '');
    var d = U.day(g.s);
    return (d === T('Today') ? '' : d + ' ') + U.hhmm(g.s);
  }
  function card(g, r, ri, i) {
    var cs = Sports.channels(g), best = cs[0];
    var el = U.el('div', 'sp-card' + (g.state === 'in' ? ' live' : g.state === 'post' ? ' post' : ''));
    if (r.id !== 'mine' && mine(g)) el.appendChild(U.el('span', 'sp-mine', T('MY TEAM')));
    if (g.teams.length === 2) { el.appendChild(teamRow(g, g.teams[0], g.teams[1])); el.appendChild(teamRow(g, g.teams[1], g.teams[0])); }
    else { el.appendChild(U.el('div', 'sp-event', RAW(g.name))); if (g.venue) el.appendChild(U.el('div', 'sp-venue', RAW(g.venue))); }
    var meta = U.el('div', 'sp-meta');
    if (g.state === 'in') meta.appendChild(U.el('span', 'sp-live', T('LIVE')));
    if (r.id === 'mine' || r.id === 'live') meta.appendChild(U.el('span', 'sp-lg', Sports.league(g.lg).name));
    meta.appendChild(U.el('span', 'sp-st', status(g)));
    var ch = U.el('span', 'sp-ch' + (best ? '' : ' none'));
    if (best) { ch.appendChild(U.el('i', 'sp-dot')); ch.appendChild(U.el('em', '', RAW(Library.name(best.c)) + (cs.length > 1 ? '  +' + (cs.length - 1) : ''))); }
    else if (g.state !== 'post') ch.appendChild(U.el('em', '', g.nets.length ? RAW(g.nets[0]) + ' · ' + T('not on your channels') : T('not on your channels')));
    meta.appendChild(ch);
    el.appendChild(meta);
    el._g = g;
    el.addEventListener('click', function () { row = ri; pos[r.id] = i; draw(); watch(g); });
    return el;
  }

  function render(force) {
    if (!built) return;
    var rs = data(), s = signature(rs);
    if (!force && s === sig) return;
    // Until you move, the first game of the first row (games arriving while it loads would move you along).
    if (!touched) { row = 0; pos = {}; }
    var wasRow = touched && rows[row] && rows[row].id, was = wasRow && rows[row].items[pos[wasRow] || 0];
    rows = rs; sig = s;
    var stage = $('spStage'); stage.innerHTML = '';
    var empty = !rows.length;
    $('spEmpty').classList.toggle('hidden', !empty);
    $('spRows').classList.toggle('hidden', empty);
    $('spSub').textContent = Sports.leagues().map(function (l) { return l.name; }).join('  ·  ');
    if (empty) {
      var err = Sports.leagues().map(function (l) { return Sports.errOf(l.id); }).filter(Boolean)[0];
      $('spEmpty').innerHTML = '';
      $('spEmpty').appendChild(U.el('b', '', firstLoad ? T('Getting today\'s games…') : err ? T('Scores couldn\'t be loaded') : T('No games today in your leagues')));
      $('spEmpty').appendChild(U.el('p', '', err ? err : T('Blue picks the leagues.  Scores come from ESPN.')));
      hints(); return;
    }
    rows.forEach(function (r, ri) {
      var shelf = U.el('div', 'sp-shelf'), track = U.el('div', 'sp-track');
      var h = U.el('h3', '', r.title); h.appendChild(U.el('span', 'sp-rsub', r.sub)); shelf.appendChild(h);
      r.items.forEach(function (g, i) { track.appendChild(card(g, r, ri, i)); });
      shelf.appendChild(track);
      stage.appendChild(shelf);
    });
    // The same row and game as before an update.
    var same = wasRow ? rows.map(function (r) { return r.id; }).indexOf(wasRow) : -1;
    if (same >= 0) {
      row = same;
      var at = was ? rows[same].items.map(function (g) { return g.id; }).indexOf(was.id) : -1;
      pos[wasRow] = at >= 0 ? at : Math.min(pos[wasRow] || 0, rows[same].items.length - 1);
    } else row = Math.min(row, rows.length - 1);
    draw();
  }
  function current() { var r = rows[row]; return r && r.items[pos[r.id] || 0]; }
  function draw() {
    var shelves = document.querySelectorAll('#spStage .sp-shelf');
    shelves.forEach(function (el, ri) {
      var r = rows[ri], at = pos[r.id] || 0;
      el.querySelectorAll('.sp-card').forEach(function (c, i) { c.classList.toggle('focus', ri === row && i === at); });
      el.querySelector('.sp-track').style.transform = 'translateX(' + (-Math.max(0, at - 2) * CARD) + 'px)';
      el.classList.toggle('active', ri === row);
    });
    var y = 0; for (var i = 0; i < row && i < shelves.length; i++) y += shelves[i].offsetHeight;
    $('spStage').style.transform = 'translateY(' + (-Math.max(0, y - (row ? shelves[row - 1].offsetHeight * 0.35 : 0))) + 'px)';
    hints();
  }
  function hints() {
    if (!open_ || Views.tab !== 'sports') return;
    var g = current();
    if (!g) return UI.hints([['', 'Back  menu', 'back'], ['blue', 'Leagues']]);
    UI.hints([['', g.state === 'pre' && g.s > Date.now() + 300000 ? 'OK  remind me or watch' : 'OK  watch', 'ok'], ['', 'Hold OK  channels', 'hold'], ['yellow', 'Remind me'], ['green', 'Follow a team'], ['blue', 'Leagues']]);
  }

  /* ---------- doing things ---------- */
  function play(c) { Views.startChannel(c, false, function () { Views.goFull(); }); }
  function watch(g) {
    var cs = Sports.channels(g);
    if (!cs.length) { U.toast(g.nets.length ? T('{x} isn\'t on your channels: it\'s on {y}', { x: Sports.title(g), y: g.nets.slice(0, 3).join(', ') }) : T('{x} isn\'t on your channels', { x: Sports.title(g) }), 6000); return; }
    if (g.state === 'pre' && g.s > Date.now() + 300000) return askRemind(g, cs);
    play(cs[0].c);
  }
  function askRemind(g, cs) {
    var c = cs[0].c, set = has(g, c);
    UI.menu(RAW(Sports.title(g)) + ',  ' + U.day(g.s) + ' ' + U.hhmm(g.s), [
      { label: set ? T('Cancel the reminder') : T('Remind me at {x}', { x: U.hhmm(g.s) }), sub: T('on {x}', { x: Library.name(c) }), icon: set ? 'belloff' : 'bell', action: function () { remind(g, c); } },
      { label: T('Watch {x} now', { x: Library.name(c) }), icon: 'play', action: function () { play(c); } },
      { label: T('Cancel'), current: true }
    ]);
  }
  function has(g, c) { return (Store.edits.reminders || []).some(function (r) { return r.k === c.k && Math.abs(r.s - g.s) < 60000; }); }
  function remind(g, c) {
    var rem = Store.edits.reminders, i = rem.findIndex(function (r) { return r.k === c.k && Math.abs(r.s - g.s) < 60000; });
    if (i >= 0) { rem.splice(i, 1); U.toast(T('Reminder cancelled')); }
    else {
      var follow = g.teams.filter(function (t) { return t.id && Teams.follows(t.id); })[0];
      rem.push({ k: c.k, s: g.s, e: g.s + 3 * 3600e3, t: Sports.title(g), w: follow ? 'team:' + follow.id : '' });
      U.toast(T('Reminder set for {x} on {y}', { x: U.hhmm(g.s), y: Library.name(c) }));
      Log.info('remind', 'Reminder set: ' + Sports.title(g) + ' at ' + U.hhmm(g.s) + ' (Sports)');
    }
    Store.saveEdits();
    if (typeof Remind !== 'undefined' && Remind.sync) Remind.sync(true);
    render(true);
  }
  // Hold OK: every channel of yours with the game, then a reminder.
  function options() {
    var g = current(); if (!g) return;
    var cs = Sports.channels(g), later = g.state === 'pre' && g.s > Date.now() + 300000;
    var items = cs.slice(0, 8).map(function (x) {
      return { label: T('Watch on {x}', { x: Library.name(x.c) }), sub: x.p ? RAW(x.p.t) + '  ·  ' + U.hhmm(x.p.s) : x.net ? T('{x} shows it', { x: x.net }) : '', icon: 'play', action: function () { play(x.c); } };
    });
    if (!cs.length) items.push({ head: true, label: T('Not on your channels') + (g.nets.length ? ':  ' + T('it\'s on {x}', { x: g.nets.join(', ') }) : '') });
    if (later && cs.length) items.push({ label: has(g, cs[0].c) ? T('Cancel the reminder') : T('Remind me at {x}', { x: U.hhmm(g.s) }), sub: T('on {x}', { x: Library.name(cs[0].c) }), icon: 'bell', action: function () { remind(g, cs[0].c); } });
    items.push({ label: T('Follow a team…'), icon: 'star', action: function () { follow(g); } });
    UI.menu(RAW(Sports.title(g)), items, null, { sub: Sports.league(g.lg).name + '  ·  ' + status(g) + (g.venue ? '  ·  ' + g.venue : '') });
  }
  function follow(g) {
    var ts = g.teams.filter(function (t) { return t.id; });
    if (!ts.length) { U.toast(T('These teams can\'t be followed yet')); return; }
    UI.menu(T('Follow a team'), ts.map(function (t) {
      var on = Teams.follows(t.id);
      return { label: RAW(t.full || t.name), sub: on ? T('Following  ·  OK stops') : T('Its games in My teams, with reminders if you want them'), current: false, action: function () { Teams.follow(t.id, !on); U.toast(on ? T('Not following {x}', { x: t.full || t.name }) : T('Following {x}', { x: t.full || t.name })); render(true); } };
    }));
  }
  function pickLeagues() {
    var on = Sports.leagues().map(function (l) { return l.id; });
    function menu(at) {
      UI.menu(T('Leagues on Sports'), Sports.LEAGUES.map(function (l, i) {
        var y = on.indexOf(l.id) >= 0;
        return { label: (y ? '✓  ' : '      ') + l.name, current: i === at, action: function () { if (y) on.splice(on.indexOf(l.id), 1); else on.push(l.id); Sports.setLeagues(on); setTimeout(function () { menu(i); }, 0); } };
      }), function () { load(true); });
    }
    menu(0);
  }

  function keys(a) {
    var r = rows[row];
    if (a === 'back') { Views.tabBar(restore); return true; }
    if (a === 'blue') { pickLeagues(); return true; }
    if (!r) { if (a === 'left') Views.tabBar(restore); return true; }
    touched = true;
    var at = pos[r.id] || 0;
    if (a === 'left') { if (at === 0) Views.tabBar(restore); else { pos[r.id] = at - 1; draw(); } }
    else if (a === 'right') { if (at < r.items.length - 1) { pos[r.id] = at + 1; draw(); } }
    else if (a === 'chup' || a === 'chdown') { pos[r.id] = U.clamp(at + (a === 'chup' ? -4 : 4), 0, r.items.length - 1); draw(); }
    else if (a === 'up') { if (row > 0) { row--; draw(); } }
    else if (a === 'down') { if (row < rows.length - 1) { row++; draw(); } }
    else if (a === 'ok') watch(r.items[at]);
    else if (a === 'red' || a === 'hold' || a === 'info') options();
    else if (a === 'yellow') { var g = r.items[at], cs = Sports.channels(g); if (cs.length && g.state === 'pre') remind(g, cs[0].c); else U.toast(T('Reminders are for games that haven\'t started')); }
    else if (a === 'green') follow(r.items[at]);
    return true;
  }
  function restore() { UI.setHandler(keys); hints(); }

  function load(force) {
    Sports.refresh(force, function () { if (open_ && Views.tab === 'sports' && !Views.full && !UI.modalOpen) render(false); }).then(function () {
      firstLoad = false;
      if (open_ && Views.tab === 'sports' && !Views.full && !UI.modalOpen) render(false);
      schedule();
    });
  }
  function schedule() {
    clearTimeout(timer);
    if (!open_) return;
    timer = setTimeout(function () { if (open_ && Views.tab === 'sports' && !Views.full) load(false); else schedule(); }, Sports.anyLive() ? Sports.LIVE_MS : Sports.TODAY_MS);
  }
  function open() {
    build(); open_ = true;
    rows = []; row = 0; pos = {}; sig = ''; touched = false;
    UI.setHandler(keys);
    render(true);
    load(false);
  }
  function resume() { if (!open_) return open(); UI.setHandler(keys); render(true); load(false); }
  function leave() { open_ = false; clearTimeout(timer); }

  return { open: open, resume: resume, leave: leave, render: render, get rows() { return rows; } };
})();
