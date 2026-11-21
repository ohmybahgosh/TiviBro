/* The Sports screen, in the side menu: today's games from ESPN (sports.js) as cards with the two teams' logos,
   records, the score and clock or the start, and which of your channels has it.  Rows: My teams (the games of
   the teams you follow, this week), Live now (every league), then a row per league (today's games, or
   tomorrow's when it has none today).

   OK (or Red, or Info) opens the game's page.  Hold OK asks: remind me (a game not started yet), or watch it on
   one of your channels that has it.  Green follows one of
   the two teams.  Blue picks the leagues.  Scores update every 30 seconds while a game is live. */
var SportsHub = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{([a-z])\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, open_ = false, rows = [], row = 0, pos = {}, timer = null, sig = '', firstLoad = true, touched = false;
  var CARD = 472;                                               // a card and the gap after it, px (app.css .sp-card)

  function build() {
    if (built) return;
    built = true;
    $('viewSports').innerHTML = '<div class="spo-head"><h1>' + T('Sports') + '</h1><span class="sp-sub" id="spSub"></span></div>' +
      '<div class="sp-rows" id="spRows"><div class="sp-stage" id="spStage"></div></div><div class="sp-empty hidden" id="spEmpty"></div><div class="sp-page hidden" id="spPage"></div>';
  }

  /* ---------- what's in the rows (Sports.rows) ---------- */
  function mine(g) { return Sports.follows(g); }
  function data() { return Sports.rows(T); }
  function signature(rs) { return rs.map(function (r) { return r.id + ':' + r.items.map(function (g) { return g.id + g.state + g.detail + (Sports.hidden(g) ? 'H' : '') + g.teams.map(function (t) { return t.score; }).join('-'); }).join(','); }).join('|'); }

  /* ---------- cards ---------- */
  function teamRow(g, t, o) {
    var hide = Sports.hidden(g), lose = !hide && g.state === 'post' && o && t.score != null && o.score != null && t.score < o.score;
    var win = !hide && g.state === 'post' && o && t.score != null && o.score != null && t.score > o.score;
    var el = U.el('div', 'sp-team' + (lose ? ' lose' : '') + (win ? ' win' : ''));
    var lg = U.el('div', 'sp-logo');
    if (t.logo) { var im = new Image(); im.decoding = 'async'; im.alt = ''; im.onerror = function () { this.remove(); lg.textContent = t.abbr; }; im.src = t.logo; lg.appendChild(im); }
    else lg.textContent = t.abbr;
    el.appendChild(lg);
    var n = U.el('div', 'sp-name');
    if (t.rank) n.appendChild(U.el('small', 'sp-rank', String(t.rank)));
    n.appendChild(document.createTextNode(RAW(t.name)));
    if (t.rec) n.appendChild(U.el('span', 'sp-rec', t.rec));
    el.appendChild(n);
    if (g.state !== 'pre' && t.score != null && !hide) el.appendChild(U.el('div', 'sp-score', String(t.score)));
    // The winner of a final: a mark beside the score (the loser is greyed).
    if (g.state === 'post' && !hide && o && t.score != null) el.appendChild(U.el('div', 'sp-win', win ? '◀' : ''));
    return el;
  }
  function status(g) {
    if (g.state !== 'pre' && Sports.hidden(g)) return g.state === 'in' ? T('On now, score hidden') : T('Played, score hidden');
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
    UI.hints([['', 'OK  the game', 'ok'], ['', g.state === 'pre' && g.s > Date.now() ? 'Hold OK  remind me or watch' : 'Hold OK  watch', 'hold'], ['yellow', 'Remind me'], ['green', 'Follow a team'], ['blue', 'Leagues']]);
  }

  /* ---------- doing things ---------- */
  /* Watching: fullscreen, and Back from it comes back here, to the game's page when it was watched from there
     (views.js exitFull calls resume). */
  var backTo = null;
  function play(c, g) { backTo = g ? g.id : null; Views.startChannel(c, false, function () { Views.goFull(); }); }
  function watch(g) {
    touched = true;                                      // Back from the player: the same card
    var cs = Sports.channels(g);
    if (!cs.length) { U.toast(g.nets.length ? T('{x} isn\'t on your channels: it\'s on {y}', { x: Sports.title(g), y: g.nets.slice(0, 3).join(', ') }) : T('{x} isn\'t on your channels', { x: Sports.title(g) }), 6000); return; }
    if (g.state === 'pre' && g.s > Date.now() + 300000) return askRemind(g, cs);
    play(cs[0].c);
  }
  /* Hold OK on a card: watch it or be reminded.  A reminder only for a game that hasn't started, and every
     channel of yours that has it (up to four). */
  function quick(g) {
    touched = true;
    var cs = Sports.channels(g);
    if (!cs.length) return watch(g);
    askRemind(g, cs);
  }
  function askRemind(g, cs) {
    var c = cs[0].c, set = has(g, c), items = [];
    if (g.state === 'pre' && g.s > Date.now()) items.push({ label: set ? T('Cancel the reminder') : T('Remind me at {x}', { x: U.hhmm(g.s) }), sub: T('on {x}', { x: Library.name(c) }), icon: set ? 'belloff' : 'bell', action: function () { remind(g, c); } });
    cs.slice(0, 4).forEach(function (x) { items.push({ label: T('Watch {x} now', { x: Library.name(x.c) }), icon: 'play', action: function () { play(x.c); } }); });
    items.push({ label: T('Cancel'), current: true });
    UI.menu(RAW(Sports.title(g)) + ',  ' + (g.state === 'pre' ? U.day(g.s) + ' ' + U.hhmm(g.s) : status(g)), items);
  }
  function has(g, c) { return Sports.reminded(g, c); }
  function remind(g, c) {
    var on = Sports.remind(g, c);
    U.toast(on ? T('Reminder set for {x} on {y}', { x: U.hhmm(g.s), y: Library.name(c) }) : T('Reminder cancelled'));
    render(true);
  }
  function follow(g) {
    var ts = g.teams.filter(function (t) { return t.id; });
    if (!ts.length) { U.toast(T('These teams can\'t be followed yet')); return; }
    UI.menu(T('Follow a team'), ts.map(function (t) {
      var on = Teams.follows(t.id);
      return { label: RAW(t.full || t.name), sub: on ? T('Following  ·  OK stops') : T('Its games in My teams, with reminders if you want them'), current: false, action: function () { Teams.follow(t.id, !on); if (Views.refreshLists) Views.refreshLists(true); U.toast(on ? T('Not following {x}', { x: t.full || t.name }) : T('Following {x}', { x: t.full || t.name })); render(true); } };
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

  /* ---------- a game's page (OK, Red or Info on a card) ----------
     The score big in the two teams' colours, then buttons: Watch on your best channel, a reminder, follow, hide
     or show the score.  Under them the box score by period with each team's leaders, every channel of yours that
     has the game, and the standings of the teams' division or conference.  ◀ ▶ along the buttons, ▼ to the
     channels, OK, Back to the games. */
  var gp = null;
  function page(g) {
    if (!g) return;
    touched = true;                                      // Back from the page: the same card
    gp = { g: g, zone: 'btns', b: 0, ci: 0, sum: null, t: 0 };
    $('spPage').classList.remove('hidden');
    UI.setHandler(pageKeys);
    drawPage();
    loadPage(true);
  }
  function loadPage(first) {
    if (!gp) return;
    var mine_ = gp;
    Sports.summary(gp.g, !first).then(function (v) { if (gp !== mine_) return; gp.sum = v; drawPage(); });
    clearTimeout(gp.t);
    gp.t = setTimeout(function () {
      if (gp !== mine_) return;
      var nx = Sports.byId(mine_.g.id); if (nx) mine_.g = nx;
      if (mine_.g.state === 'in') { Sports.refreshToday([mine_.g.lg], false).then(function () { var n2 = Sports.byId(mine_.g.id); if (n2 && gp === mine_) mine_.g = n2; loadPage(false); }); } else loadPage(false);
    }, mine_.g.state === 'in' ? Sports.LIVE_MS : 120000);
  }
  // quiet: leaving for the player (nothing to draw behind it).
  function closePage(quiet) { if (gp) clearTimeout(gp.t); gp = null; $('spPage').classList.add('hidden'); $('spPage').innerHTML = ''; if (quiet) return; UI.setHandler(keys); render(true); }
  function buttons(g) {
    var cs = Sports.channels(g), out = [], later = g.state === 'pre' && g.s > Date.now() + 300000;
    if (cs.length) out.push({ label: (later ? T('Watch {x} now', { x: Library.name(cs[0].c) }) : T('Watch on {x}', { x: Library.name(cs[0].c) })), icon: 'play', run: function () { var gg = gp.g; closePage(true); play(cs[0].c, gg); } });
    if (later && cs.length) out.push({ label: has(g, cs[0].c) ? T('Cancel the reminder') : T('Remind me'), icon: 'bell', run: function () { remind(g, cs[0].c); drawPage(); } });
    g.teams.filter(function (t) { return t.id; }).forEach(function (t) {
      var on = Teams.follows(t.id);
      out.push({ label: on ? T('Following {x}', { x: t.name }) : T('Follow {x}', { x: t.name }), icon: 'star', run: function () { Teams.follow(t.id, !on); if (Views.refreshLists) Views.refreshLists(true); drawPage(); } });
    });
    if (g.state !== 'pre') {
      if (Sports.hidden(g)) out.push({ label: T('Show the score'), icon: 'eye', run: function () { Sports.reveal(g); drawPage(); } });
      else if (g.teams.some(function (t) { return t.id && Teams.follows(t.id); })) {
        var ft = g.teams.filter(function (t) { return t.id && Teams.follows(t.id); })[0], hid = Sports.hidesTeam(ft.id);
        out.push({ label: hid ? T('Show {x} scores', { x: ft.name }) : T('Hide {x} scores', { x: ft.name }), icon: 'hide', run: function () { Sports.hideTeam(ft.id, !hid); drawPage(); } });
      }
    } else g.teams.filter(function (t) { return t.id && Teams.follows(t.id); }).slice(0, 1).forEach(function (ft) {
      var hid = Sports.hidesTeam(ft.id);
      out.push({ label: hid ? T('Show {x} scores', { x: ft.name }) : T('Hide {x} scores', { x: ft.name }), icon: 'hide', run: function () { Sports.hideTeam(ft.id, !hid); drawPage(); } });
    });
    return { list: out, cs: cs };
  }
  function abIdx(g, ab) { for (var i = 0; i < g.teams.length; i++) if (g.teams[i].abbr === ab) return i; return 9; }
  function hex(c, a) { return /^[0-9a-f]{6}$/i.test(c || '') ? 'rgba(' + parseInt(c.slice(0, 2), 16) + ',' + parseInt(c.slice(2, 4), 16) + ',' + parseInt(c.slice(4, 6), 16) + ',' + a + ')' : 'rgba(40,50,80,' + a + ')'; }
  function drawPage() {
    if (!gp) return;
    var g = gp.g, el = $('spPage'), hide = Sports.hidden(g), bt = buttons(g), sum = gp.sum;
    gp.btns = bt.list; gp.cs = bt.cs;
    gp.b = Math.min(gp.b, Math.max(0, bt.list.length - 1)); gp.ci = Math.min(gp.ci, Math.max(0, bt.cs.length - 1));
    if (gp.zone === 'chans' && !bt.cs.length) gp.zone = 'btns';
    el.innerHTML = '';
    var a = g.teams[0] || {}, h = g.teams[1] || {};
    // A final with a winner (not a tie, not hidden): { w: 0 | 1 }.
    var fin = g.state === 'post' && !hide && g.teams.length === 2 && a.score != null && h.score != null && a.score !== h.score ? { w: a.score > h.score ? 0 : 1 } : null;
    var hero = U.el('div', 'sp-hero');
    // Each team's side in its colours: its main colour well in, its other colour as a band on the outer edge.
    // Deepened, so a logo in the same colour (UCLA's blue on blue) still stands out.
    var deep = function (c) { if (!/^[0-9a-f]{6}$/i.test(c || '')) return ''; var rgb = [0, 2, 4].map(function (i) { return parseInt(c.slice(i, i + 2), 16); }), l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255, f = l > 0.25 ? 0.5 : l > 0.12 ? 0.75 : 1; return [0, 2, 4].map(function (i) { var v = Math.round(parseInt(c.slice(i, i + 2), 16) * f); return ('0' + v.toString(16)).slice(-2); }).join(''); };
    hero.style.background = 'linear-gradient(100deg,' + hex(deep(a.color), 1) + ' 0%,' + hex(deep(a.color), 0.9) + ' 28%,rgba(11,14,26,.92) 45%,rgba(11,14,26,.92) 55%,' + hex(deep(h.color), 0.9) + ' 72%,' + hex(deep(h.color), 1) + ' 100%)';
    [[a, 'l'], [h, 'r']].forEach(function (x) { var alt = x[0].alt && x[0].alt.toLowerCase() !== (x[0].color || '').toLowerCase() && !/^(ffffff|000000)$/i.test(x[0].alt) ? x[0].alt : ''; if (!alt) return; var bd = U.el('div', 'sp-band ' + x[1]); bd.style.background = hex(alt, 1); hero.appendChild(bd); });
    [a, h].forEach(function (t, i) {
      if (!t.name) return;
      var sd = U.el('div', 'sp-side ' + (i ? 'r' : 'l') + (fin ? (i === fin.w ? ' won' : ' lost') : ''));
      if (t.logo) { var im = new Image(); im.src = t.logo; im.alt = ''; im.onerror = function () { this.remove(); }; sd.appendChild(im); }
      var nm = U.el('b', '', RAW((t.rank ? t.rank + '  ' : '') + t.name)); nm.setAttribute('data-raw', ''); sd.appendChild(nm);
      sd.appendChild(U.el('small', '', [t.rec, i ? T('Home') : T('Away')].filter(Boolean).join('  ·  ')));
      if (fin && i === fin.w) sd.appendChild(U.el('i', 'sp-wbadge', T('Winner')));
      hero.appendChild(sd);
    });
    var mid = U.el('div', 'sp-mid');
    if (g.teams.length === 2 && g.state !== 'pre' && !hide) {
      // A final: the loser's score greyed.
      var big = U.el('div', 'sp-big');
      big.appendChild(U.el('span', fin && fin.w !== 0 ? 'lost' : '', a.score != null ? String(a.score) : ''));
      big.appendChild(document.createTextNode('  –  '));
      big.appendChild(U.el('span', fin && fin.w !== 1 ? 'lost' : '', h.score != null ? String(h.score) : ''));
      mid.appendChild(big);
    }
    else if (g.teams.length !== 2) mid.appendChild(U.el('div', 'sp-big ev', RAW(g.name)));
    else mid.appendChild(U.el('div', 'sp-big pre', g.state === 'pre' ? U.hhmm(g.s) : T('Score hidden')));
    var line = U.el('div', 'sp-wline');
    if (g.state === 'in') line.appendChild(U.el('span', 'sp-live', T('LIVE')));
    line.appendChild(U.el('span', 'sp-whtx', [g.state === 'pre' ? '' : status(g), g.state === 'pre' ? U.day(g.s) : '', Sports.league(g.lg).name, g.nets[0] || ''].filter(Boolean).join('   ·   ')));
    mid.appendChild(line);
    if (g.note) mid.appendChild(U.el('div', 'sp-note', RAW(g.note)));
    hero.appendChild(mid);
    el.appendChild(hero);
    // Buttons.
    var bar = U.el('div', 'sp-btns');
    bt.list.forEach(function (b, i) { var x = U.el('div', 'sp-btn' + (gp.zone === 'btns' && i === gp.b ? ' sel' : ''), b.label); x.onclick = function () { gp.b = i; b.run(); }; bar.appendChild(x); });
    el.appendChild(bar);
    // Left: box score and leaders (not while the score is hidden).
    var left = U.el('div', 'sp-panel sp-box');
    if (hide) left.appendChild(U.el('div', 'sp-muted', T('The score is hidden.  Show the score above when you\'ve watched it.')));
    else if (!sum) left.appendChild(U.el('div', 'sp-muted', g.state === 'pre' ? T('The box score starts with the game.') : T('Loading the box score…')));
    else {
      var lines = sum.lines.filter(function (l) { return l.periods.length; });
      if (lines.length === 2) {
        var n = Math.max(lines[0].periods.length, lines[1].periods.length), tb = U.el('table', 'sp-lscore'), hr = U.el('tr');
        hr.appendChild(U.el('th', '', ''));
        for (var i = 0; i < n; i++) hr.appendChild(U.el('th', '', String(i + 1)));
        hr.appendChild(U.el('th', '', 'T')); tb.appendChild(hr);
        lines.forEach(function (l, k) {
          var tr = U.el('tr', fin ? (k === fin.w ? 'won' : 'lost') : ''), t = g.teams[k] || {}, td = U.el('td');
          if (t.logo) { var im = new Image(); im.src = t.logo; im.className = 'sp-mini'; td.appendChild(im); }
          td.appendChild(document.createTextNode(RAW(t.name || l.abbr))); tr.appendChild(td);
          for (var p = 0; p < n; p++) tr.appendChild(U.el('td', '', l.periods[p] != null ? String(l.periods[p]) : ''));
          tr.appendChild(U.el('td', 'tot', String(l.score != null ? l.score : '') + (fin && k === fin.w ? ' ◀' : ''))); tb.appendChild(tr);
        });
        left.appendChild(tb);
      } else if (g.state === 'pre') left.appendChild(U.el('div', 'sp-muted', T('The box score starts with the game.')));
      if (sum.leaders.length) {
        left.appendChild(U.el('div', 'sp-cap', T('Leaders')));
        sum.leaders.slice().sort(function (x, y) { return abIdx(g, x.abbr) - abIdx(g, y.abbr); }).forEach(function (tl) {
          // A line a leader (football's are long: "16/27, 162 YDS, 1 TD"), the team's abbreviation on its first.
          tl.list.slice(0, 2).forEach(function (x, k) {
            var r = U.el('div', 'sp-lead');
            r.appendChild(U.el('b', '', k ? '' : tl.abbr));
            var c = U.el('span', '', x.who + '   '); c.appendChild(U.el('em', '', x.value)); c.appendChild(U.el('small', '', '   ' + x.what.toLowerCase())); r.appendChild(c);
            left.appendChild(r);
          });
        });
      }
      if (sum.venue) left.appendChild(U.el('div', 'sp-venue2', sum.venue + (sum.city ? ',  ' + sum.city : '')));
    }
    el.appendChild(left);
    // Right: your channels, then the standings.
    var right = U.el('div', 'sp-panel sp-side2');
    right.appendChild(U.el('div', 'sp-cap', T('On your channels')));
    if (!bt.cs.length) right.appendChild(U.el('div', 'sp-muted', g.nets.length ? T('Not on your channels.  It\'s on {x}.', { x: g.nets.join(', ') }) : T('Not on your channels.')));
    var c0 = Math.max(0, Math.min(gp.ci - 1, bt.cs.length - 3));
    bt.cs.slice(c0, c0 + 3).forEach(function (x, j) {
      var r = U.el('div', 'sp-chrow' + (gp.zone === 'chans' && c0 + j === gp.ci ? ' sel' : ''));
      var lg = U.el('div', 'sp-chlogo'), src = Views.logoOf ? Views.logoOf(x.c) : '';
      if (src) { var im = new Image(); im.src = src; im.onerror = function () { this.remove(); }; lg.appendChild(im); }
      r.appendChild(lg);
      var tx = U.el('div', 'sp-chtx'); var nm = U.el('b', '', RAW(Library.name(x.c))); nm.setAttribute('data-raw', ''); tx.appendChild(nm);
      tx.appendChild(U.el('small', '', x.p ? RAW(x.p.t) + '  ·  ' + U.hhmm(x.p.s) : x.net ? T('{x} shows it', { x: x.net }) : ''));
      r.appendChild(tx);
      var q = Library.qualityLabel ? Library.qualityLabel(x.c) : ''; if (q) r.appendChild(U.el('span', 'sp-q', q));
      r.onclick = function () { var gg = gp.g; closePage(true); play(x.c, gg); };
      right.appendChild(r);
    });
    if (sum && sum.standings.length) {
      // The group of a team you follow when the two teams are in different ones (Raptors at Pistons: the Central).
      var nameIs = function (r, t) { return t.loc && r.team && (r.team === t.loc || r.team === t.name || r.team === t.full); };
      var mineT = g.teams.filter(function (t) { return t.id && Teams.follows(t.id); })[0];
      var gr = (mineT && sum.standings.filter(function (x) { return x.rows.some(function (r) { return nameIs(r, mineT); }); })[0]) || sum.standings[0];
      right.appendChild(U.el('div', 'sp-cap', gr.name || T('Standings')));
      var st = U.el('table', 'sp-stand'), hr2 = U.el('tr');
      hr2.appendChild(U.el('th', '', '')); hr2.appendChild(U.el('th', '', T('W-L'))); hr2.appendChild(U.el('th', '', gr.rows[0] && gr.rows[0].extra ? gr.rows[0].extra.k : '')); st.appendChild(hr2);
      // The top of the table, and this game's teams always, below a break when they're further down.
      var whose = function (r) { return g.teams.filter(function (t) { return t.loc && r.team && (r.team === t.loc || r.team === t.name || r.team === t.full); })[0]; }, isMe = function (r) { return !!whose(r); };
      var n = Math.max(3, Math.floor((360 - 80 * Math.min(bt.cs.length, 3)) / 43)), low = gr.rows.slice(n).filter(isMe), top = gr.rows.slice(0, Math.max(n - low.length, 2));
      top.concat(low).forEach(function (r, i) {
        var tr = U.el('tr', (isMe(r) ? 'me' : '') + (low.length && i === top.length ? ' gap' : ''));
        tr.appendChild(U.el('td', '', RAW(r.team))); tr.appendChild(U.el('td', '', hide ? '·' : r.rec)); tr.appendChild(U.el('td', '', hide ? '' : r.extra ? r.extra.v : ''));
        st.appendChild(tr);
      });
      right.appendChild(st);
    }
    el.appendChild(right);
    // Rows that don't fit go, from the bottom of the top part (this game's teams stay).
    var stt = right.querySelector('table.sp-stand');
    for (var guard = 0; stt && guard < 12 && right.scrollHeight > right.clientHeight + 2; guard++) {
      var rs = [].slice.call(stt.querySelectorAll('tr')).slice(1).filter(function (x) { return !/\bme\b/.test(x.className); });
      if (rs.length <= 1) break;
      stt.removeChild(rs[rs.length - 1]);
    }
    UI.hints([['', 'OK  select', 'ok'], ['', '◀ ▶  buttons', ''], ['', '▼  channels', ''], ['', 'Back  games', 'back']]);
  }
  function pageKeys(a) {
    if (!gp) return keys(a);
    if (a === 'back') { closePage(); return true; }
    if (gp.zone === 'btns') {
      if (a === 'left' && gp.b > 0) gp.b--;
      else if (a === 'right' && gp.b < gp.btns.length - 1) gp.b++;
      else if (a === 'down' && gp.cs.length) { gp.zone = 'chans'; gp.ci = 0; }
      else if (a === 'ok') { var b = gp.btns[gp.b]; if (b) b.run(); return true; }
      else return true;
    } else {
      if (a === 'up') { if (gp.ci > 0) gp.ci--; else gp.zone = 'btns'; }
      else if (a === 'down' && gp.ci < gp.cs.length - 1) gp.ci++;
      else if (a === 'ok') { var x = gp.cs[gp.ci]; if (x) { var gg = gp.g; closePage(true); play(x.c, gg); } return true; }
      else return true;
    }
    drawPage();
    return true;
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
    else if (a === 'ok' || a === 'red' || a === 'info') page(r.items[at]);
    else if (a === 'hold') quick(r.items[at]);
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
  function resume() {
    if (!open_) { open(); } else { UI.setHandler(keys); render(true); load(false); }
    // Watched from a game's page: back on that page.
    var id = backTo; backTo = null;
    var g = id && Sports.byId(id);
    if (g) page(g);
  }
  function leave() { open_ = false; clearTimeout(timer); if (gp) { clearTimeout(gp.t); gp = null; var pg = $('spPage'); if (pg) { pg.classList.add('hidden'); pg.innerHTML = ''; } } }

  return { open: open, resume: resume, leave: leave, render: render, get rows() { return rows; } };
})();
