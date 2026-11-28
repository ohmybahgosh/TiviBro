/* TiviBro's own screensaver, for OLED TVs (Settings > Appearance > Screensaver).  After some minutes without a key
   press while nothing plays (and, on its own clock, over a paused video), the screen goes
   almost black with the looks turned on in Settings, a new one every 4 minutes when there are several:
     clock    a big, thin, dim clock and the date, wandering slowly round the screen, with your next game under it;
     aurora   very dark coloured glows drifting into each other, with a small clock that changes corner;
     library  a backdrop from your Plex home, dimmed and slowly zooming, with its title;
     teams    your teams' games (live scores first, then what's next) with the clock, wandering like the clock;
     bounce   the TiviBro V gliding corner to corner like the old DVD screensaver, a new colour at each wall.
   A look with nothing to show (no Plex, no game today) is skipped.  Settings: saver ('off' turns it off),
   saverLooks ({ clock, aurora, library, teams, bounce }: false leaves one out), saverAfter and saverPaused (minutes;
   saverPaused 0: never over a paused video), saverHour ('keep': never hand over to the TV).
   Nothing stays in one place (the whole layer also moves a few pixels every minute), there is no white and no fixed
   bar.  The first key press only takes it away (Burnin.activity drops it).  While it shows, and while it waits to
   start, the TV's own screensaver is held off (Awake asks Saver.holds); after an hour, with "Let the TV take over"
   (the default), TiviBro stops holding it, so the TV's screensaver or screen-off takes over for the night.
   'off' leaves the older behaviour: the screen just dims (Burnin).
   saverScreenOff: instead of a look, with nothing playing, the screen is turned off as the TV's own "Screen off" does
   (the helper asks the TV, service.js screen); the first button turns it on again.  Over a paused video the looks
   still show.  Where the TV refuses, the looks show instead. */
var Saver = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var homeRated = true, LOOKS = ['clock', 'aurora', 'library', 'teams', 'bounce'], MIX_MS = 4 * 60000, HOUR = 3600000, SHIFT = [[0, 0], [6, 2], [8, -4], [2, -8], [-4, -6], [-8, 0], [-6, 6], [0, 8]];
  var last = Date.now(), dark = false, el = null, on = false, since = 0, look = '', lookAt = 0, ticks = [], shiftAt = 0, handed = false, home = null, homeAt = 0;

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  function enabled() { return S().saver !== 'off'; }
  // The looks turned on in Settings (all unless one is turned off; never none: the clock then).
  function looksOn() { var o = S().saverLooks || {}, l = LOOKS.filter(function (k) { return o[k] !== false; }); return l.length ? l : ['clock']; }
  function after() { return (+S().saverAfter || 5) * 60000; }
  function pausedAfter() { var v = S().saverPaused; return v === 0 || v === '0' ? 0 : (+v || 5) * 60000; }
  function paused() { return typeof Player !== 'undefined' && !!Player.current && !!Player.userPaused; }
  // Is something playing anywhere: full screen, in the guide's preview, picture-in-picture or Multiview?
  function playing() {
    if (typeof Multiview !== 'undefined' && Multiview.open) return true;
    return typeof Player !== 'undefined' && !!Player.current && !Player.userPaused;
  }

  /* Should it show now, after [idle] ms without a key?  Never while a video plays, wherever it plays (a movie in the
     preview window is still being watched); over a paused one after its own wait (0: never); with nothing playing
     after "Starts after".  Pure, for the tests. */
  function due(o) {
    if (!o.enabled || o.hidden || o.playing) return false;
    if (o.paused) return o.pausedAfter > 0 && o.idle >= o.pausedAfter;
    return o.idle >= o.after;
  }
  function check() {
    var now = Date.now();
    // The screen turned off: something started playing meanwhile (from the phone, a reminder): on again.
    if (dark) { if (playing()) wake('something plays'); return; }
    if (on) { if (now - shiftAt > 60000) nudge(); if (now - lookAt > MIX_MS) pick(); if (!handed && S().saverHour !== 'keep' && now - since > HOUR) handOver(); return; }
    if (due({ enabled: enabled(), hidden: document.hidden, playing: playing(), paused: paused(), idle: now - last, after: after(), pausedAfter: pausedAfter() })) { if (S().saverScreenOff && !paused()) screenOff(); else show(); }
  }

  /* ---------- Turning the screen off instead ---------- */
  // Ask the helper to turn the screen on or off: a promise, refused where the TV won't.
  function screen(onNow) {
    if (typeof Net === 'undefined' || !Net.port || !Net.ctlFetch) return Promise.reject(new Error('no network helper'));
    return Net.ctlFetch('http://127.0.0.1:' + Net.port + '/companion/screen', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: onNow }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); });
  }
  function screenOff() {
    dark = true; since = Date.now();
    if (typeof Log !== 'undefined') Log.info('app', 'Screensaver: turning the screen off (nothing playing)');
    screen(false).catch(function (e) {
      if (!dark) return;
      dark = false;
      if (typeof Log !== 'undefined') Log.warn('app', 'The TV would not turn the screen off (' + (e && e.message) + '); the screensaver shows instead');
      show();
    });
  }
  function wake(why) {
    dark = false; last = Date.now();
    if (typeof Log !== 'undefined') Log.info('app', 'Screen on again (' + why + ') after ' + Math.round((Date.now() - since) / 60000) + ' min');
    screen(true).catch(function () {});        // the TV turns it on by itself for a button: this is for the rest
  }

  /* ---------- Showing ---------- */
  function show() {
    if (on) return;
    on = true; since = Date.now(); handed = false; look = '';
    if (!el) { el = document.createElement('div'); el.id = 'saver'; el.className = 'saver'; document.body.appendChild(el); }
    el.innerHTML = '<div class="saver-layer" id="saverLayer"></div>';
    el.classList.add('on');
    if (typeof Log !== 'undefined') Log.info('app', 'Screensaver on (' + looksOn().join(', ') + ')');
    readHome(); readGames();
    pick(); nudge();
    ticks.push(setInterval(clock, 15000));
  }
  function hide() {
    if (!on) return false;
    on = false; ticks.forEach(clearInterval); ticks = [];
    if (el) { el.classList.remove('on'); el.innerHTML = ''; }
    if (typeof Log !== 'undefined') Log.info('app', 'Screensaver off after ' + Math.round((Date.now() - since) / 60000) + ' min');
    return true;
  }
  // The whole layer a few pixels elsewhere, once a minute (on top of each look's own slow drift).
  function nudge() {
    shiftAt = Date.now();
    var l = document.getElementById('saverLayer'); if (!l) return;
    var p = SHIFT[Math.floor(Math.random() * SHIFT.length)];
    l.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
  }
  /* The looks turned on that have something to show now: the library one needs Plex home titles, the teams one a
     game; aurora's large glows are left out on a TV short of memory.  The clock when none is left. */
  function ready() {
    var out = looksOn().filter(function (k) {
      return k === 'library' ? homeArt().length > 0 : k === 'teams' ? games().length > 0 : k === 'aurora' ? !(typeof Player !== 'undefined' && Player.memSafe) : true;
    });
    return out.length ? out : ['clock'];
  }
  // The next look after the one showing (the same when only one is on, drawn again: a new backdrop).
  function pick() {
    lookAt = Date.now();
    var list = ready();
    look = list[(list.indexOf(look) + 1) % list.length]; draw();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function timeNow() { return typeof U !== 'undefined' && U.hhmm ? U.hhmm(Date.now()) : new Date().toTimeString().slice(0, 5); }
  function dateNow() { try { return new Date().toLocaleDateString(typeof I18n !== 'undefined' && I18n.lang ? I18n.lang() : undefined, { weekday: 'long', month: 'long', day: 'numeric' }); } catch (e) { return new Date().toDateString(); } }
  function clock() {
    [].forEach.call(document.querySelectorAll('#saver .sv-time'), function (x) { x.textContent = timeNow(); });
    [].forEach.call(document.querySelectorAll('#saver .sv-date'), function (x) { x.textContent = dateNow(); });
  }
  // The look itself: one block of markup per look; the slow movement is CSS (app.css, .saver).
  function draw() {
    var l = document.getElementById('saverLayer'); if (!l) return;
    var g = games(), next = g.filter(function (x) { return x.state !== 'post'; })[0];
    var time = '<div class="sv-time">' + esc(timeNow()) + '</div><div class="sv-date">' + esc(dateNow()) + '</div>';
    if (look === 'aurora') {
      l.innerHTML = '<div class="sv-glow g1"></div><div class="sv-glow g2"></div><div class="sv-glow g3"></div><div class="sv-corner">' + time + '</div>';
    } else if (look === 'library') {
      var a = homeArt(), m = a[Math.floor(Math.random() * a.length)];
      l.innerHTML = '<div class="sv-art" id="saverArt"></div><div class="sv-artshade"></div><div class="sv-title"><div class="sv-kicker">' + esc(T('In your Plex')) + '</div><div class="sv-name">' + esc(m.title) + '</div><div class="sv-facts">' + esc([m.year, m.genre].filter(Boolean).join('  ·  ')) + '</div></div><div class="sv-topclock">' + time + '</div>';
      PlexView.picture(m.server, m.art, 1920, 1080).then(function (u) { var x = document.getElementById('saverArt'); if (x && u) { x.style.backgroundImage = 'url("' + u + '")'; x.classList.add('in'); } }, function () {});
    } else if (look === 'bounce') {
      l.innerHTML = '<div class="sv-corner">' + time + '</div><div class="sv-bx"><div class="sv-by">' + V_SVG + '</div></div>';
      bounce(l);
    } else if (look === 'teams') {
      l.innerHTML = '<div class="sv-wander wide"><div class="sv-row">' + time + '</div><div class="sv-games">' + g.slice(0, 4).map(function (x) { return gameCard(x); }).join('') + '</div></div>';
    } else {
      l.innerHTML = '<div class="sv-wander">' + time + (next ? gameCard(next, true) : '') + '</div>';
    }
  }
  /* The bouncing V: the TiviBro mark drawn as two rounded strokes (crisp at any size), its colours set by a class. */
  var V_SVG = '<svg class="sv-v" width="240" height="210" viewBox="0 0 240 210"><defs><linearGradient id="svVg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient></defs>' +
    '<path d="M44 44 L120 166 L196 44" fill="none" stroke="url(#svVg)" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M40 38 L86 112" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="10" stroke-linecap="round"/></svg>';
  var V_COLOURS = 6;
  /* Like the DVD screensaver: one animation slides it across and back, another up and down, at the same speed, so it
     travels on the diagonal and turns at the walls (app.css, svBx and svBy).  Each wall it reaches (an animation
     turning round) gives it the next colour; both walls at once is a corner, and it glows for a moment.  It starts
     at a random point of its path. */
  function bounce(l) {
    var bx = l.querySelector('.sv-bx'), by = l.querySelector('.sv-by'), v = l.querySelector('.sv-v');
    if (!bx || !by || !v) return;
    var c = 0, lastX = 0, lastY = 0;
    bx.style.animationDelay = '-' + (Math.random() * 21).toFixed(2) + 's';
    by.style.animationDelay = '-' + (Math.random() * 10.9).toFixed(2) + 's';
    function wall(x) {
      var now = Date.now();
      if (x) lastX = now; else lastY = now;
      c = (c + 1) % V_COLOURS; v.setAttribute('class', 'sv-v c' + c + (Math.abs(lastX - lastY) < 300 ? ' corner' : ''));
    }
    bx.addEventListener('animationiteration', function () { wall(true); });
    by.addEventListener('animationiteration', function () { wall(false); });
  }
  /* A game as a card: the visiting team (logo, name), the score (or the start time) with the clock, "Final" or the day
     under it, and the home team.  [small]: the single card under the clock look. */
  function gameCard(x, small) {
    var t = x.teams || [], a = t[0] || {}, b = t[1] || {}, on = x.state === 'in', done = x.state === 'post';
    var team = function (m, right) {
      var src = m.logo && Sports.darkLogo ? Sports.darkLogo(m.logo) : m.logo;    // games read before the dark logos came in too
      var logo = src ? '<img class="sv-logo" src="' + esc(src) + '" alt="">' : '';
      return '<div class="sv-team' + (right ? ' r' : '') + '">' + (right ? '<span>' + esc(m.name) + '</span>' + logo : logo + '<span>' + esc(m.name) + '</span>') + '</div>';
    };
    var when = typeof U !== 'undefined' && U.hhmm ? U.hhmm(x.s) : '';
    var mid = on || done ? '<b>' + esc(a.score + ' – ' + b.score) + '</b><small>' + esc(on ? (x.detail || T('Live')) : T('Final')) + '</small>'
      : '<b>' + esc(when) + '</b><small>' + esc(new Date(x.s).toDateString() === new Date().toDateString() ? T('Today') : dayOf(x.s)) + '</small>';
    return '<div class="sv-card' + (on ? ' live' : '') + (small ? ' small' : '') + '">' + team(a) + '<div class="sv-mid">' + mid + '</div>' + team(b, true) + '</div>';
  }
  function dayOf(ms) { try { return new Date(ms).toLocaleDateString(typeof I18n !== 'undefined' && I18n.lang ? I18n.lang() : undefined, { weekday: 'short' }); } catch (e) { return ''; } }

  /* ---------- What the looks show ---------- */
  // Your teams' games the Sports screen knows (on now first, then today's next), read again when the saver starts.
  function games() {
    if (typeof Sports === 'undefined' || !Sports.rows) return [];
    var mine = (Sports.rows() || []).filter(function (r) { return r.id === 'mine'; })[0];
    return mine ? mine.items.filter(function (g) { return g.teams && g.teams.length === 2; }) : [];
  }
  function readGames() {
    if (typeof Sports === 'undefined' || !Sports.refreshToday || !Sports.followedLeagues) return;
    try { Sports.refreshToday(Sports.followedLeagues()).then(function () { if (on && (look === 'teams' || look === 'clock')) draw(); }, function () {}); } catch (e) {}
  }
  /* Family-friendly pictures only (saverRated, on unless turned off): a title rated R, NC-17 or TV-MA, or with no
     rating, is left out.  Plex's own ratings (contentRating); for an episode, its show's when the row has it. */
  var FAMILY = /^(G|PG|PG-13|TV-Y|TV-Y7|TV-Y7-FV|TV-G|TV-PG|TV-14|gb\/(U|PG|12A?)|de\/(0|6|12)|ca\/(G|PG|14A))$/i;
  function rated(m) { return S().saverRated === false || FAMILY.test(String(m.contentRating || m.grandparentContentRating || '').trim()); }
  // Titles from the Plex home rows with a backdrop, read once an hour at most.
  function homeArt() { return home || []; }
  function readHome() {
    if (home && homeRated !== (S().saverRated !== false)) homeAt = 0;   // the switch changed: read again
    homeRated = S().saverRated !== false;
    if (typeof PlexView === 'undefined' || typeof Plex === 'undefined' || !Plex.chosen || !Plex.chosen().length || Date.now() - homeAt < HOUR) return;
    homeAt = Date.now();
    PlexView.read.home().then(function (rows) {
      var seen = {}, out = [];
      (rows || []).forEach(function (r) { (r.items || []).forEach(function (m) {
        var art = m.art || m.grandparentArt, k = m.server + ':' + (m.grandparentRatingKey || m.ratingKey);
        if (!art || seen[k] || !/^(movie|episode|show)$/.test(m.type) || !rated(m)) return;
        seen[k] = 1; out.push({ server: m.server, art: art, title: m.type === 'episode' ? m.grandparentTitle : m.title, year: m.year || '', genre: ((m.Genre || [])[0] || {}).tag || '' });
      }); });
      home = out.slice(0, 60);
    }, function () { homeAt = 0; });
  }

  // An hour in, with "Let the TV take over": TiviBro stops holding the TV's own screensaver back.
  function handOver() { handed = true; if (typeof Log !== 'undefined') Log.info('app', 'Screensaver: an hour on, the TV may take over'); }

  /* ---------- For Burnin, Awake and Settings ---------- */
  // A key or the pointer (Burnin.activity): awake again; true when it only took the screensaver away.
  function activity() { if (dark) { wake('a button'); return true; } last = Date.now(); return hide(); }
  // Whether the TV's own screensaver should wait: while this one is on (until it hands over) or still to come.
  function holds() { return enabled() && !document.hidden && !handed; }
  function start() { setInterval(check, 15000); }
  function preview() { last = 0; show(); }
  return { start: start, activity: activity, holds: holds, enabled: enabled, preview: preview, get on() { return on; }, get dark() { return dark; }, LOOKS: LOOKS, _due: due, _ready: ready, _rated: rated };
})();
