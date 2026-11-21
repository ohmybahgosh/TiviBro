/* Sports while you watch (sports.js has the scores):
   - the score bar: a game on the channel you're watching fullscreen (the guide or an event channel naming the two
     teams, or a network ESPN says has a game on) gets a small score in the top corner, kept up to date, and under
     it the league's other games one after another;
   - alerts for the teams you follow, wherever you are in TiviBro: a close game near the end ("Pistons trail the
     Raptors 102 to 105, 2:10 left in the 4th") asks whether to switch to it, and a final score says so.
   Neither for a team whose scores you hide (Sports: Hide its scores).  Each is a switch in Settings > Channels and
   groups > My teams.  Looks every 30 seconds while TiviBro is on screen, and only asks ESPN again when what's
   loaded is old (sports.js: 30 seconds while a game is live, else 5 minutes). */
var SportsLive = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{([a-z])\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var timer = null, bug = null, shown = null, other = 0, lastAlertLook = 0, said = {}, started = false;

  function S() { return Store.settings; }
  function barOn() { return S().sportsBar !== false; }
  function tickerOn() { return S().sportsTicker !== false; }
  function alertsOn() { return S().sportsAlerts !== false; }

  /* ---------- the score bar ---------- */
  function el() {
    if (bug) return bug;
    bug = U.el('div', 'sp-bug hidden'); bug.id = 'spBug';
    document.body.appendChild(bug);
    return bug;
  }
  function side(t) {
    var s = U.el('div', 'sp-bt');
    if (t.logo) { var im = new Image(); im.src = t.logo; im.alt = ''; im.onerror = function () { this.remove(); }; s.appendChild(im); }
    s.appendChild(U.el('span', '', t.abbr));
    s.appendChild(U.el('b', '', t.score != null ? String(t.score) : ''));
    return s;
  }
  function clockOf(g) {
    if (g.state === 'post') return T('Final');
    if (g.state === 'pre') return U.hhmm(g.s);
    var d = g.detail.split(/\s+-\s+/);                    // "2:10 - 4th", "End of 3rd", "Halftime"
    return d.length === 2 ? d[1] + '\n' + d[0] : g.detail;
  }
  function others(g) {
    return Sports.all().filter(function (x) { return x.lg === g.lg && x.id !== g.id && x.state === 'in' && !Sports.hidden(x) && x.teams.length === 2; });
  }
  function drawBug(g) {
    var b = el();
    b.innerHTML = '';
    var top = U.el('div', 'sp-btop');
    top.appendChild(side(g.teams[0])); top.appendChild(side(g.teams[1]));
    var ck = U.el('div', 'sp-bclock' + (g.state === 'in' ? ' live' : ''));
    clockOf(g).split('\n').forEach(function (l, i) { ck.appendChild(U.el(i ? 'small' : 'b', '', l)); });
    top.appendChild(ck);
    b.appendChild(top);
    var os = tickerOn() ? others(g) : [];
    if (os.length) {
      var x = os[other++ % os.length], line = U.el('div', 'sp-bline');
      line.appendChild(U.el('i', '', Sports.league(g.lg).name));
      line.appendChild(document.createTextNode(x.teams[0].abbr + ' ' + x.teams[0].score + '   ' + x.teams[1].abbr + ' ' + x.teams[1].score + '   ' + clockOf(x).replace('\n', ' ')));
      b.appendChild(line);
    }
    b.classList.remove('hidden');
    shown = g.id;
  }
  function hideBug() { if (bug) bug.classList.add('hidden'); shown = null; }
  function watchingLive() { return Views.full && Views.mode === 'live' && Views.playing && !document.body.classList.contains('mv-open'); }
  function lookBar() {
    if (!barOn() || !watchingLive()) return hideBug();
    var g = Sports.gameOn(Views.playing);
    if (!g || g.teams.length !== 2 || Sports.hidden(g)) return hideBug();
    drawBug(g);
  }

  /* ---------- alerts for your teams ---------- */
  var LATE = { nfl: [4, 300, 8], ncaaf: [4, 300, 8], nba: [4, 180, 6], wnba: [4, 180, 6], ncaab: [2, 180, 6], nhl: [3, 300, 1], mlb: [9, 0, 2], mls: [2, 0, 1], epl: [2, 0, 1], ucl: [2, 0, 1] };
  function secs(clock) { var m = /^(\d+):(\d+)/.exec(clock || ''); return m ? +m[1] * 60 + +m[2] : /^\d+(\.\d+)?$/.test(clock || '') ? +clock : 9999; }
  // Close and nearly over: the last period with little time left (soccer: the 80th minute on), a small margin.
  function close(g) {
    var r = LATE[g.lg], a = g.teams[0], h = g.teams[1];
    if (!r || g.state !== 'in' || a.score == null || h.score == null) return false;
    if (Math.abs(a.score - h.score) > r[2]) return false;
    if (/^(mls|epl|ucl)$/.test(g.lg)) { var min = parseInt(g.clock, 10); return g.period >= 2 && min >= 80; }
    if (g.lg === 'mlb') return g.period >= 9;
    return g.period >= r[0] && secs(g.clock) <= r[1];
  }
  function mineIn(g) { return g.teams.filter(function (t) { return t.id && Teams.follows && Teams.follows(t.id) && !Sports.hidesTeam(t.id); })[0]; }
  function lookAlerts() {
    if (!alertsOn() || typeof Teams === 'undefined' || !Teams.followed().length) return;
    var now = Date.now();
    var mine = Sports.all().filter(function (g) { return g.teams.length === 2 && mineIn(g) && !Sports.hidden(g); });
    var soon = mine.some(function (g) { return g.state === 'in' || (g.state === 'pre' && g.s < now + 30 * 60000); });
    // Asked again: every 30 seconds while one of your games is on or about to start, else every 10 minutes.
    if (soon || now - lastAlertLook > 10 * 60000) {
      lastAlertLook = now;
      Sports.refreshToday(Sports.followedLeagues(), false).then(check);
    } else check();
  }
  function check() {
    var now = Date.now();
    Sports.all().forEach(function (g) {
      if (g.teams.length !== 2 || Sports.hidden(g)) return;
      var me = mineIn(g); if (!me) return;
      var foe = g.teams[0] === me ? g.teams[1] : g.teams[0];
      if (close(g) && !said['c' + g.id]) {
        said['c' + g.id] = 1;
        var ahead = me.score > foe.score, tied = me.score === foe.score;
        var what = tied ? T('{x} and the {y} are tied at {n}', { x: me.name, y: foe.name, n: me.score }) : ahead ? T('{x} lead the {y} {a} to {b}', { x: me.name, y: foe.name, a: me.score, b: foe.score }) : T('{x} trail the {y} {a} to {b}', { x: me.name, y: foe.name, a: me.score, b: foe.score });
        ask(g, RAW(what) + ',  ' + g.detail.replace(/\s+-\s+/, ' '));
      }
      if (g.state === 'post' && !said['f' + g.id] && now - g.s < 5 * 3600e3) {
        said['f' + g.id] = 1;
        // Not at start-up for games long over: only one that ended since TiviBro last looked.
        if (said._ready) U.toast(T('Final') + ':  ' + RAW(g.teams[0].name + ' ' + g.teams[0].score + ',  ' + g.teams[1].name + ' ' + g.teams[1].score), 8000);
      }
    });
    said._ready = 1;
  }
  // "Watch it?" unless you're watching it already, or a question is up; it goes by itself after 15 seconds.
  function ask(g, text) {
    if (UI.modalOpen) return;
    var cs = Sports.channels(g), c = cs[0] && cs[0].c;
    if (Views.playing && cs.some(function (x) { return x.c.k === Views.playing.k; }) && Views.full) return;
    Log.info('sports', 'Alert: ' + text);
    if (!c) { U.toast(text, 8000); return; }
    var title = T('Close game');
    UI.menu(title, [
      { label: T('Watch on {x}', { x: Library.name(c) }), sub: text, icon: 'play', action: function () { Views.startChannel(c, false, function () { Views.goFull(); }); } },
      { label: T('Not now'), current: false }
    ], null, { sub: text });
    setTimeout(function () { var mt = document.getElementById('modalTitle'); if (UI.modalOpen && mt && mt.textContent.indexOf(T(title)) >= 0) UI.close(); }, 15000);
  }

  function tick() {
    if (document.hidden) return;
    try {
      if (barOn() && watchingLive()) {
        var ids = Sports.leagues().map(function (l) { return l.id; });
        Sports.refreshToday(ids, false).then(lookBar);
      } else hideBug();
      lookAlerts();
    } catch (e) { Log.warn('sports', 'Live scores: ' + (e && e.message)); }
  }
  function start() {
    if (started) return; started = true;
    clearInterval(timer);
    timer = setInterval(tick, 30000);
    setTimeout(tick, 8000);
    // Fullscreen on or off: the bar follows at once, not at the next look.
    document.addEventListener('keyup', function () { setTimeout(function () { if (!watchingLive()) hideBug(); else if (barOn() && !shown) tick(); }, 300); });
    if (Sports.onChange) Sports.onChange(function () { if (watchingLive()) lookBar(); });
  }
  return { start: start, tick: tick, _close: close };
})();
