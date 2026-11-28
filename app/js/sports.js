/* Sports: scores, team logos and what's on today, from ESPN's public scoreboards, tied to your own channels
   (claude/sports-hub-plan.md in the project notes).  The Sports screen (sportshub.js) draws it.

   ESPN's site API needs no key and answers the TV straight (CORS *).  It is unofficial and undocumented, so
   everything about it is in this file: if it changes, only this file does.
     scoreboard  site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard[?dates=YYYYMMDD]
   Each game: the two teams (name, abbreviation, logo, colour, record, ranking), the score, the clock or the
   start, and who shows it ("Fox", "ESPN2", "NHL Net", "MSG2").

   Your channels for a game, best first:
     1. the guide: a programme naming the two teams around the start (My teams' finder, Teams.games, run for
        every team playing today), event channels and league passes included;
     2. a national sports network by its name (ESPN, FS1, NFL Network...): the game is on it whatever the guide
        says.
   A game none of your channels has says so, and is never sent to a channel you don't have.

   Loads only while the Sports screen is open: every 30 seconds while a game you can see is live, else every
   5 minutes; the days ahead once an hour.  Plain ES5 for webOS 4. */
var Sports = (function () {
  'use strict';
  var BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  /* team: the My teams league (teams.js) whose teams these are, for following and the guide. */
  var LEAGUES = [
    { id: 'nfl', name: 'NFL', path: 'football/nfl', team: 'nfl' },
    { id: 'ncaaf', name: 'College football', short: 'NCAAF', path: 'football/college-football', team: 'ncaaf' },
    { id: 'nba', name: 'NBA', path: 'basketball/nba', team: 'nba' },
    { id: 'ncaab', name: 'College basketball', short: 'NCAAB', path: 'basketball/mens-college-basketball', team: 'ncaab' },
    { id: 'wnba', name: 'WNBA', path: 'basketball/wnba', team: 'wnba' },
    { id: 'nhl', name: 'NHL', path: 'hockey/nhl', team: 'nhl' },
    { id: 'mlb', name: 'MLB', path: 'baseball/mlb', team: 'mlb' },
    { id: 'mls', name: 'MLS', path: 'soccer/usa.1', team: 'mls' },
    { id: 'epl', name: 'Premier League', short: 'EPL', path: 'soccer/eng.1' },
    { id: 'ucl', name: 'Champions League', short: 'UCL', path: 'soccer/uefa.champions' },
    { id: 'f1', name: 'Formula 1', short: 'F1', path: 'racing/f1', race: true },
    // Cricket: no single scoreboard, so ESPN's "header" for the sport (every series on now, see cricket()).
    { id: 'cricket', name: 'Cricket', header: 'cricket' }
  ];
  var BY = {}; LEAGUES.forEach(function (l) { BY[l.id] = l; });
  var DEFAULT = ['nfl', 'ncaaf', 'nba', 'nhl', 'mlb'];
  // Cricket shown at first where it's followed most (the TV's language and region: India, Pakistan, the UK...).
  if (/^(hi|ur|bn|si|ta|te|mr|gu|kn|ml|pa)\b|-(in|pk|gb|au|nz|za|lk|bd|jm|tt|bb|af|ie|ae)$/i.test(typeof navigator !== 'undefined' && navigator.language || '')) DEFAULT.push('cricket');
  var LIVE_MS = 30000, TODAY_MS = 5 * 60000, AHEAD_MS = 60 * 60000, AHEAD_DAYS = 6;

  var store = {};          // league id -> { 'YYYYMMDD': { at, games, err } }
  var busy = {}, listeners = [];

  function S() { return typeof Store !== 'undefined' && Store.settings ? Store.settings : {}; }
  // The leagues shown: your choice (Sports > Blue), else the big US ones and those of the teams you follow.
  function leagues() {
    var on = Array.isArray(S().sportsLeagues) ? S().sportsLeagues.slice() : DEFAULT.slice();
    if (!Array.isArray(S().sportsLeagues)) followedLeagues().forEach(function (id) { if (on.indexOf(id) < 0) on.push(id); });
    return LEAGUES.filter(function (l) { return on.indexOf(l.id) >= 0; });
  }
  function setLeagues(ids) { S().sportsLeagues = ids.filter(function (id) { return BY[id]; }); if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings(); changed(); }
  function followedLeagues() {
    if (typeof Teams === 'undefined' || !Teams.followed) return [];
    var out = [];
    Teams.followed().forEach(function (t) { LEAGUES.forEach(function (l) { if (l.team === t.league && out.indexOf(l.id) < 0) out.push(l.id); }); });
    return out;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(t) { var d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function dayKey(off) { return ymd(Date.now() + off * 86400e3); }

  /* ---------- reading ESPN ---------- */
  function num(x) { return x == null || x === '' ? null : +x; }
  /* ESPN's logo for a dark screen (500-dark): the plain one has black lettering on some teams (Ohio State's
     "OHIO STATE" across the O), which vanished on TiviBro's dark cards and in the screensaver. */
  function darkLogo(u) { return String(u || '').replace(/^http:/, 'https:').replace(/(\/teamlogos\/[a-z]+)\/500\//, '$1/500-dark/'); }
  function team(lg, t) {
    var tm = t.team || {}, rec = (t.records || [])[0];
    var o = { abbr: tm.abbreviation || '', name: tm.shortDisplayName || tm.displayName || tm.name || '', full: tm.displayName || '', loc: tm.location || '',
      logo: darkLogo(tm.logo), color: tm.color || '', alt: tm.alternateColor || '', home: t.homeAway === 'home', score: num(t.score),
      rec: rec && rec.summary || '', rank: t.curatedRank && t.curatedRank.current < 26 ? t.curatedRank.current : 0, win: !!t.winner };
    o.id = teamId(lg, o);
    o.eid = String(tm.id || '');           // ESPN's own id (the phone's Sports widget reads ESPN with it)
    return o;
  }
  /* The My teams id ("nhl:det") for an ESPN team: by its full name ("Detroit Red Wings", "Michigan Wolverines"),
     else its abbreviation where the two agree.  ESPN writes some differently (NO for New Orleans, UTAH, WSH). */
  var idCache = {};
  function teamId(lg, o) {
    if (!lg.team || typeof Teams === 'undefined' || !Teams.all) return '';
    var key = lg.team + '|' + o.full + '|' + o.abbr;
    if (idCache[key] != null) return idCache[key];
    var full = Teams.norm(o.full).trim(), id = '';
    Teams.all().some(function (x) { if (x.league === lg.team && x.full.some(function (f) { return f.trim() === full; })) { id = x.id; return true; } return false; });
    if (!id) { var t = Teams.team(lg.team + ':' + o.abbr.toLowerCase()); if (t) id = t.id; }
    return (idCache[key] = id);
  }
  function game(lg, e) {
    var c = (e.competitions || [])[0] || {}, st = (e.status || c.status || {}), ty = st.type || {};
    var teams = (c.competitors || []).filter(function (t) { return t.team; }).map(function (t) { return team(lg, t); });
    // Visitors first, as the guide says it ("Lions at Packers").
    teams.sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); });
    var nets = [];
    (c.broadcasts || []).forEach(function (b) { (b.names || []).forEach(function (n) { if (nets.indexOf(n) < 0) nets.push(n); }); });
    (c.geoBroadcasts || []).forEach(function (b) { var n = b.media && b.media.shortName; if (n && nets.indexOf(n) < 0) nets.push(n); });
    return { id: String(e.id), lg: lg.id, s: Date.parse(e.date || c.date) || 0, state: ty.state || 'pre', done: !!ty.completed,
      detail: ty.shortDetail || ty.detail || '', clock: st.displayClock || '', period: st.period || 0, name: e.name || e.shortName || '',
      teams: teams, nets: nets, venue: c.venue && c.venue.fullName || '', note: (c.notes || [])[0] && c.notes[0].headline || '' };
  }
  /* A race weekend (Formula 1, discussion #200): ESPN's event holds each session (practice, qualifying, the sprint,
     the race) as a competition of its own, with its time, state and broadcasters.  One item per session, so the
     row shows the weekend's times and each session is live, reminded of or found in the guide on its own.  The
     first three of a session run or finished are under it ("1 K. Antonelli  2 G. Russell  3 L. Norris"). */
  // The sessions' names, translated where they're shown (sportshub.js); T() here only marks them for the translations.
  function T(x) { return x; }
  var SESSION = { fp1: T('Practice 1'), fp2: T('Practice 2'), fp3: T('Practice 3'), qual: T('Qualifying'), ss: T('Sprint qualifying'), sq: T('Sprint qualifying'), sprint: T('Sprint'), race: T('Race') };
  function race(lg, e) {
    return (e.competitions || []).map(function (c, i) {
      var ty = (c.status || {}).type || {}, ab = String((c.type || {}).abbreviation || '').toLowerCase(), nets = [];
      (c.broadcasts || []).forEach(function (b) { (b.names || []).forEach(function (n) { if (nets.indexOf(n) < 0) nets.push(n); }); });
      var top = (c.competitors || []).filter(function (x) { return x.athlete && x.order; }).sort(function (a, b) { return a.order - b.order; }).slice(0, 3)
        .map(function (x) { return x.order + ' ' + (x.athlete.shortName || x.athlete.displayName || ''); });
      return { id: String(e.id) + '-' + (c.id || i), ev: String(e.id), lg: lg.id, s: Date.parse(c.date || c.startDate) || 0, state: ty.state || 'pre', done: !!ty.completed,
        detail: ty.shortDetail || ty.detail || '', clock: '', period: 0, name: e.name || e.shortName || '', session: SESSION[ab] || (c.type || {}).text || ab.toUpperCase(),
        teams: [], nets: nets, venue: (e.circuit && e.circuit.fullName) || '', note: '', top: ty.state === 'pre' ? [] : top };
    }).filter(function (g) { return g.s; });
  }
  // The cricket series kept besides internationals: the big T20 leagues and the world events.
  var CRICKET_LEAGUES = /premier league|big bash|super league|the hundred|sa20|international league t20|caribbean premier|major league cricket|world cup|champions trophy|asia cup|world test championship/i;
  /* Cricket from ESPN's header for the sport (site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket): the
     matches on now, just played and next, across every series.  Only internationals (Tests, ODIs, T20Is, men's and
     women's: internationalClassId > 0) and the big T20 leagues are kept; the rest is domestic cricket few follow.
     The score is cricket's own ("245/6 (42.3 ov)", "356 & 120/2"), kept as written; the winner is ESPN's.  The line
     under it says how the match stands ("India trail by 297 runs", "New Zealand won by 6 wickets"). */
  function cricket(lg, j) {
    var out = [];
    ((j.sports || [])[0] || { leagues: [] }).leagues.forEach(function (L) {
      (L.events || []).forEach(function (e) {
        var intl = +((e.class || {}).internationalClassId || 0) > 0;
        if (!intl && !CRICKET_LEAGUES.test(L.name || '')) return;
        if (/under-?19|u19|\ba team\b/i.test((L.name || '') + ' ' + (e.name || ''))) return;
        var fs = e.fullStatus || {}, ty = fs.type || {};
        var teams = (e.competitors || []).map(function (c) {
          return { abbr: c.abbreviation || '', name: c.displayName || c.name || '', full: c.displayName || '', loc: c.location || '', logo: String(c.logo || '').replace(/^http:/, 'https:'),      // cricket has no dark logos (500-dark is a 404)
            color: String(c.color || '').replace('#', ''), alt: '', home: c.homeAway === 'home', score: c.score ? String(c.score) : null, rec: '', rank: 0, win: !!c.winner, id: '', eid: String(c.id || '') };
        }).sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); });
        if (teams.length !== 2) return;
        var state = e.status === 'in' || e.status === 'post' ? e.status : 'pre';
        out.push({ id: String(e.id), lg: lg.id, s: Date.parse(e.date) || 0, state: state, done: state === 'post',
          detail: state === 'pre' ? '' : fs.summary || ty.shortDetail || e.summary || '', clock: '', period: e.period || 0, name: e.name || '',
          teams: teams, nets: [], venue: e.location || '', note: [e.title, (e.class || {}).generalClassCard, L.name].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join('  ·  '), text: true });
      });
    });
    return out;
  }
  function load(lg, key, force) {
    var day = (store[lg.id] || (store[lg.id] = {}))[key], now = Date.now(), today = key === dayKey(0);
    var ttl = !today ? AHEAD_MS : day && day.games.some(function (g) { return g.state === 'in'; }) ? LIVE_MS : TODAY_MS;
    if (!force && day && now - day.at < ttl) return Promise.resolve(day);
    var bk = lg.id + key;
    if (busy[bk]) return busy[bk];
    // Cricket's header has no days: it all comes with today, and the other days are empty.
    if (lg.header && !today) { store[lg.id][key] = { at: now, games: [] }; return Promise.resolve(store[lg.id][key]); }
    var url = lg.header ? 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=' + lg.header + '&lang=en&region=us'
      : BASE + lg.path + '/scoreboard' + (today ? '' : '?dates=' + key) + (lg.id === 'ncaab' || lg.id === 'ncaaf' ? (today ? '?' : '&') + 'limit=100' : '');
    busy[bk] = fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('ESPN said ' + r.status); return r.json(); }).then(function (j) {
      var list = lg.header ? cricket(lg, j) : lg.race ? [].concat.apply([], (j.events || []).map(function (e) { return race(lg, e); }))
        : (j.events || []).map(function (e) { return game(lg, e); }).filter(function (g) { return g.s && g.teams.length === 2; });
      store[lg.id][key] = { at: Date.now(), games: list };
      // Days gone by aren't kept (TiviBro can stay open for days).
      var y = dayKey(-4); Object.keys(store[lg.id]).forEach(function (k) { if (k < y) delete store[lg.id][k]; });
      return store[lg.id][key];
    }, function (e) {
      var old = store[lg.id][key];
      if (typeof Log !== 'undefined') Log.warn('sports', lg.name + ' scores not loaded: ' + (e && e.message));
      store[lg.id][key] = { at: Date.now(), games: old ? old.games : [], err: e && e.message || 'no answer' };
      return store[lg.id][key];
    }).then(function (d) { delete busy[bk]; chanCache = null; return d; });
    return busy[bk];
  }
  /* Today for every league shown and tomorrow (a league with nothing today shows tomorrow), and the week ahead
     for the leagues of the teams you follow (My teams).  Each answer is shown as it comes. */
  // The leagues loaded: the ones shown, and those of the teams you follow (My teams shows them even when their league isn't).
  function loaded() { var l = leagues(), ids = l.map(function (x) { return x.id; }); followedLeagues().forEach(function (id) { if (ids.indexOf(id) < 0 && BY[id]) l.push(BY[id]); }); return l; }
  function refresh(force, then) {
    var jobs = [], mine = followedLeagues();
    loaded().forEach(function (lg) {
      jobs.push(load(lg, dayKey(0), force), load(lg, dayKey(1), force));
      // Yesterday too: last night's finals for Recent results (and a game loaded before it started doesn't stay
      // "7:30pm" for good).  The days ahead only for your teams' leagues.
      jobs.push(load(lg, dayKey(-1), false));
      // Your teams' leagues: three more days back for Recent results.
      if (mine.indexOf(lg.id) >= 0) for (var b = 2; b <= 4; b++) jobs.push(load(lg, dayKey(-b), false));
      if (mine.indexOf(lg.id) >= 0) for (var d = 2; d <= AHEAD_DAYS; d++) jobs.push(load(lg, dayKey(d), false));
    });
    jobs.forEach(function (j) { j.then(function () { if (then) then(); }); });
    return Promise.all(jobs);
  }
  function anyLive() { return all().some(function (g) { return g.state === 'in'; }); }
  /* Every loaded game once.  ESPN's NFL scoreboard for today is the whole week, so a game can be in two days'
     answers: the newer answer wins. */
  function all() {
    var out = [], at = {}, pos = {};
    loaded().forEach(function (lg) {
      var m = store[lg.id] || {};
      Object.keys(m).forEach(function (k) {
        m[k].games.forEach(function (g) {
          if (pos[g.id] == null) { pos[g.id] = out.length; at[g.id] = m[k].at; out.push(g); }
          else if (m[k].at > at[g.id]) { out[pos[g.id]] = g; at[g.id] = m[k].at; }
        });
      });
    });
    return out;
  }
  function day(lgId, off) { var m = store[lgId] || {}, d = m[dayKey(off)]; return d ? d.games : null; }
  function errOf(lgId) { var d = (store[lgId] || {})[dayKey(0)]; return d && d.err || ''; }
  // Today only, for these leagues (the score bar and alerts while you watch: no days ahead).
  function refreshToday(ids, force) { return Promise.all(ids.map(function (id) { return BY[id] ? load(BY[id], dayKey(0), force) : null; })); }
  // A game again from what's loaded (the newest answer), by its id.
  function byId(id) { var g = null; all().forEach(function (x) { if (x.id === id) g = x; }); return g; }

  /* ---------- a game's page: box score by period, leaders, the standings of its division ----------
     .../summary?event=<id>: about 400 KB (it has every play), so only for the page that's open, kept a minute
     (30 seconds while live) and only the parts used. */
  var sums = {};
  function summary(g, force) {
    var lg = BY[g.lg], c = sums[g.id], ttl = g.state === 'in' ? LIVE_MS : 60000;
    if (!lg) return Promise.resolve(null);
    // Cricket: the card has it all (the scores, how it stands, the series); no box score by period.
    if (lg.header) return Promise.resolve({ lines: [], leaders: [], standings: [], venue: g.venue || '', city: '', none: true });
    if (lg.race) return raceStandings(lg, force);
    if (!force && c && Date.now() - c.at < ttl) return Promise.resolve(c.v);
    return fetch(BASE + lg.path + '/summary?event=' + encodeURIComponent(g.id), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('ESPN said ' + r.status); return r.json(); }).then(function (j) {
      var v = readSummary(j);
      Object.keys(sums).forEach(function (k) { if (Date.now() - sums[k].at > 10 * 60000) delete sums[k]; });
      sums[g.id] = { at: Date.now(), v: v };
      return v;
    }, function (e) { if (typeof Log !== 'undefined') Log.warn('sports', 'Game page not loaded: ' + (e && e.message)); return c ? c.v : null; });
  }
  /* A race league's page: the drivers' and the teams' championship, as the standings of a game's page are drawn
     (.../apis/v2/sports/racing/f1/standings), kept an hour. */
  var raceSt = {};
  function raceStandings(lg, force) {
    var c = raceSt[lg.id];
    if (!force && c && Date.now() - c.at < 3600e3) return Promise.resolve(c.v);
    return fetch('https://site.api.espn.com/apis/v2/sports/' + lg.path + '/standings', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('ESPN said ' + r.status); return r.json(); }).then(function (j) {
      var v = { lines: [], leaders: [], venue: '', city: '', standings: readRaceStandings(j) };
      raceSt[lg.id] = { at: Date.now(), v: v };
      return v;
    }, function (e) { if (typeof Log !== 'undefined') Log.warn('sports', lg.name + ' standings not loaded: ' + (e && e.message)); return c ? c.v : null; });
  }
  function readRaceStandings(j) {
    return (j.children || []).map(function (ch) {
      var drivers = /driver/i.test(ch.name || '');
      return { race: 1, name: drivers ? T('Drivers\' championship') : T('Constructors\' championship'), rows: ((ch.standings || {}).entries || []).slice(0, 20).map(function (e) {
        var st = {}; (e.stats || []).forEach(function (x) { st[x.name] = x.displayValue; });
        var who = drivers ? e.athlete && (e.athlete.shortName || e.athlete.displayName) : e.team && (e.team.displayName || e.team.name);
        return { team: who || '', rec: '', extra: { k: 'PTS', v: st.championshipPts || st.points || '0' }, streak: '', logo: '' };
      }) };
    }).filter(function (g) { return g.rows.length; });
  }
  function readSummary(j) {
    var comp = j.header && j.header.competitions && j.header.competitions[0] || {};
    var lines = (comp.competitors || []).map(function (t) {
      return { abbr: t.team && t.team.abbreviation || '', home: t.homeAway === 'home', score: t.score, periods: (t.linescores || []).map(function (l) { return l.displayValue != null ? l.displayValue : l.value; }) };
    }).sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); });
    var leaders = (j.leaders || []).map(function (tl) {
      return { abbr: tl.team && tl.team.abbreviation || '', list: (tl.leaders || []).filter(function (x) { return x.leaders && x.leaders[0]; }).slice(0, 3).map(function (x) {
        var l = x.leaders[0]; return { what: x.displayName || x.name || '', who: l.athlete && (l.athlete.shortName || l.athlete.displayName) || '', value: l.displayValue || '' };
      }) };
    }).filter(function (x) { return x.list.length; });
    var groups = ((j.standings || {}).groups || []).slice(0, 2).map(function (gr) {
      return { name: String(gr.header || '').replace(/^\d{4}(-\d{2})?\s+/, ''), rows: ((gr.standings || {}).entries || []).map(function (e) {
        var st = {}; (e.stats || []).forEach(function (x) { st[x.name] = x.displayValue; });
        var rec = st.wins != null && st.losses != null ? st.wins + '-' + st.losses + (st.otLosses != null ? '-' + st.otLosses : st.ties && st.ties !== '0' ? '-' + st.ties : '') : st.overall || '';
        var extra = st.points != null ? { k: 'PTS', v: st.points } : st.gamesBehind != null ? { k: 'GB', v: st.gamesBehind } : st['vs. Conf.'] != null ? { k: 'CONF', v: st['vs. Conf.'] } : null;
        var lg = (e.logo || []).filter(function (l) { return (l.rel || []).indexOf('dark') >= 0; })[0] || (e.logo || [])[0];
        return { team: e.team || '', rec: rec, extra: extra, streak: st.streak || '', logo: lg && lg.href ? darkLogo(lg.href) : '' };
      }) };
    }).filter(function (gr) { return gr.rows.length; });
    var info = j.gameInfo || {};
    return { lines: lines, leaders: leaders, standings: groups, venue: info.venue && info.venue.fullName || '', city: info.venue && info.venue.address ? [info.venue.address.city, info.venue.address.state].filter(Boolean).join(', ') : '' };
  }

  /* ---------- the game on a channel (so the corner never repeats the game you're watching) ----------
     What's on now names two teams (the guide, or an event channel's name), or the channel is a network ESPN says
     shows a game being played.  Only games loaded already (refreshToday). */
  function gameOn(c) {
    if (!c) return null;
    var now = Date.now(), list = all().filter(function (g) { return g.state === 'in' || (g.state === 'pre' && g.s < now + 15 * 60000) || (g.state === 'post' && g.s > now - 5 * 3600e3 && now - g.s < 4 * 3600e3); });
    if (!list.length) return null;
    var texts = [];
    try { var nn = typeof Epg !== 'undefined' && Epg.nowNext ? Epg.nowNext(c) : null; if (nn && nn.now) texts.push(nn.now.t); } catch (e) {}
    try { var ev = typeof Events !== 'undefined' && Events.of ? Events.of(c) : null; if (ev && ev.title) texts.push(ev.title); } catch (e) {}
    var best = null;
    texts.forEach(function (t) {
      if (best || typeof Teams === 'undefined' || !Teams.named) return;
      var ids = Teams.named(t, c.n, Teams.all(), true).map(function (x) { return x.id; });
      if (ids.length < 2) return;
      list.forEach(function (g) { if (!best && g.teams.length === 2 && g.teams.every(function (x) { return x.id && ids.indexOf(x.id) >= 0; })) best = g; });
    });
    if (best) return best;
    // A listing that names the game only in its description ("Live: College Football" on a local CBS station): the
    // channel is one of the game's own (channels(), from teams.js), so the score corner isn't shown over it.
    /* The closest match wins: a description naming both teams ("The Detroit Lions host the Tampa Bay Buccaneers")
       over one that names a team in passing ("...lost their last game to Chicago"), or the corner showed the
       game being watched and left out the other. */
    var bestR = Infinity;
    list.forEach(function (g) {
      if (g.state !== 'in') return;
      channels(g).forEach(function (x) { if (x.c.k === c.k && x.r < bestR) { bestR = x.r; best = g; } });
    });
    if (best) return best;
    var b = bare(Library.name(c));
    list.forEach(function (g) {
      if (best || g.state !== 'in') return;
      if (g.nets.some(function (n) { var w = NETS[squash(n)] || NETS[squash(n).replace(/hd$/, '')]; return w && w.indexOf(b) >= 0; })) best = g;
    });
    return best;
  }

  /* ---------- hiding scores (recorded games, or a game you'll watch later) ----------
     A team you hide scores for: none of its scores show anywhere until you show that game's on its page (for
     as long as TiviBro is open). */
  var shownOnce = {};
  function hidesTeam(id) { return (S().sportsHide || []).indexOf(id) >= 0; }
  function hideTeam(id, on) { var l = S().sportsHide || (S().sportsHide = []), i = l.indexOf(id); if (on && i < 0) l.push(id); if (!on && i >= 0) l.splice(i, 1); if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings(); changed(); }
  function hidden(g) { return !!g && g.state !== 'pre' && !shownOnce[g.id] && g.teams.some(function (t) { return t.id && hidesTeam(t.id); }); }
  function reveal(g) { shownOnce[g.id] = 1; changed(); }

  /* ---------- your channels for a game ---------- */
  function squash(s) { s = String(s || '').toLowerCase(); if (s.normalize) s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); return s.replace(/&/g, 'and').replace(/\+/g, 'plus').replace(/[^a-z0-9]+/g, ''); }
  /* National networks by name: ESPN's name for it -> how channels are named (squashed, quality and feed tags off).
     Over-the-air networks (FOX, CBS, NBC, ABC) aren't here: which station is yours is the guide's to say. */
  var NETS = {
    espn: ['espn'], espn2: ['espn2'], espnu: ['espnu'], espnews: ['espnews'], espndeportes: ['espndeportes'], sec: ['secnetwork'], secnetwork: ['secnetwork'],
    accn: ['accnetwork'], accnetwork: ['accnetwork'], fs1: ['fs1', 'foxsports1'], fs2: ['fs2', 'foxsports2'], btn: ['bigtennetwork', 'btn'], bigtennetwork: ['bigtennetwork', 'btn'],
    cbssn: ['cbssportsnetwork', 'cbssn'], cbssportsnetwork: ['cbssportsnetwork', 'cbssn'], nflnet: ['nflnetwork'], nflnetwork: ['nflnetwork'], nhlnet: ['nhlnetwork'], nhlnetwork: ['nhlnetwork'],
    nbatv: ['nbatv'], mlbnet: ['mlbnetwork'], mlbnetwork: ['mlbnetwork'], tnt: ['tnt'], tbs: ['tbs'], trutv: ['trutv'], usanet: ['usanetwork', 'usa'], usanetwork: ['usanetwork', 'usa'],
    golf: ['golfchannel', 'golf'], tudn: ['tudn'], universo: ['universo'], fsl: ['foxsportslatino'], beinsports: ['beinsports', 'beinsportsusa'], pac12network: ['pac12network'],
    longhornnetwork: ['longhornnetwork'], marqueesportsnetwork: ['marqueesportsnetwork', 'marquee'], nesn: ['nesn'], yes: ['yesnetwork', 'yes'], sny: ['sny'], msg: ['msg'], msg2: ['msg2'], msgsn: ['msgsportsnet', 'msgsn'],
    mnmt: ['monumentalsportsnetwork', 'monumental', 'mnmt'], altitude: ['altitudesports', 'altitude'], spectrumsportsnet: ['spectrumsportsnet', 'spectrumsportsnetwork'],
    fdsndetroit: ['fanduelsportsdetroit', 'fdsndetroit', 'ballysportsdetroit'], fdsdetroit: ['fanduelsportsdetroit', 'fdsndetroit', 'ballysportsdetroit']
  };
  var netIndex = null;
  function bare(n) { var s = squash(n), was; do { was = s; s = s.replace(/(uhd|fhd|hd|sd|4k|hevc|east|backup|raw|vip)$/, '').replace(/^(us|usa|ca)(?=[a-z])/, ''); } while (s !== was && s); return s; }
  function nets() {
    var chans = Library.data.channels;
    if (netIndex && netIndex.of === chans) return netIndex.map;
    var map = {};
    for (var i = 0; i < chans.length; i++) { var c = chans[i]; if (!shown(c)) continue; var b = bare(Library.name(c)); (map[b] || (map[b] = [])).push(c); }
    netIndex = { of: chans, map: map };
    return map;
  }
  function shown(c) { return Library.shownAnywhere ? Library.shownAnywhere(c) : !(Store.edits.hiddenChannels[c.k] || Store.edits.hiddenGroups[c.g]); }
  function byNet(n) {
    var want = NETS[squash(n)] || NETS[squash(n).replace(/hd$/, '')];
    if (!want) return [];
    var m = nets(), out = [];
    want.forEach(function (w) { (m[w] || []).forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); }); });
    return out;
  }
  // Has ESPN's scoreboard for this league and the day of time t been read (so a team missing from it has no game then)?
  function covered(lg, t) { var m = store[lg]; return !!(m && m[ymd(t)]); }
  // The channels ESPN's broadcast networks for a game are (byNet), for My teams to add a game the guide doesn't name.
  function netChannels(g) {
    var out = [];
    (g && g.nets || []).forEach(function (n) { byNet(n).forEach(function (c) { if (out.indexOf(c) < 0 && shown(c)) out.push(c); }); });
    return out;
  }
  /* The guide's games for every team playing in the next day and a half, worked out at most every two minutes:
     team id -> [{ c, p, pair }]. */
  var chanCache = null, BOOT = Date.now();
  /* The guide's listings of today's and tomorrow's games, by team id: { 'ncaaf:mich': [{ c, p, team, pair }] }, from
     teams.js (titles, event channels, and descriptions).  Kept two minutes, or until new description finds arrive. */
  function guideGames() {
    var now = Date.now();
    var dg = typeof Teams !== 'undefined' ? Teams.descGen : 0;     // new description finds (a game named only there): look again
    if (chanCache && now - chanCache.at < 120000 && chanCache.of === Library.data.channels && chanCache.dg === dg) return chanCache.map;
    var ids = {}, map = {};
    all().forEach(function (g) { if (g.s < now + 36 * 3600e3 && (g.state !== 'post')) g.teams.forEach(function (t) { if (t.id) ids[t.id] = 1; }); });
    var list = [];
    /* Your teams are looked for on their own, with the same words as the guide's My teams group, so a game named
       only in a programme's description (a local CBS station's "College Football") is found the same way there
       and here.  Asked together with every other team, the description search stopped at its limit first. */
    try {
      if (typeof Teams !== 'undefined' && Teams.games && Object.keys(ids).length && typeof Epg !== 'undefined' && Epg.search) {
        var mine = Teams.followed ? Teams.followed().map(function (x) { return x.id; }) : [], rest = Object.keys(ids).filter(function (id) { return mine.indexOf(id) < 0; });
        // Listings that ended in the last 2 hours count too (a game in overtime); channelsOf() keeps them only for a game still on.
        if (mine.length) list = Teams.games(36 * 3600e3, false, null, 2 * 3600e3).filter(function (x) { return ids[x.team.id]; });
        if (rest.length) list = list.concat(Teams.games(36 * 3600e3, false, rest, 2 * 3600e3));
      }
    } catch (e) { if (typeof Log !== 'undefined') Log.warn('sports', 'Finding games in the guide: ' + (e && e.message)); }
    var had = {};
    list.forEach(function (x) { var hk = x.c.k + '|' + x.team.id + '|' + x.p.s; if (had[hk]) return; had[hk] = 1; (map[x.team.id] || (map[x.team.id] = [])).push(x); });
    // Nothing found yet (the guide is still loading after a start): look again in 10 seconds, not 2 minutes.
    chanCache = { at: list.length || now - BOOT > 300000 ? now : now - 110000, of: Library.data.channels, dg: dg, map: map, games: {} };
    return map;
  }
  /* [{ c, p, how: 'guide' | 'net', net }] for a game, best first: the guide naming both teams, then one team at
     the right time, then the networks ESPN names.  A Favorite comes first among equals. */
  function channels(g) {
    if (!g || typeof Library === 'undefined' || !Library.data.channels.length) return [];
    // Worked out once per game until the guide's games are looked at again (cards, the page and the score bar ask
    // many times a second).
    var gm = guideGames(), memo = chanCache && chanCache.games, mk = g.id + '|' + g.s;
    if (memo && memo[mk]) return memo[mk];
    var out = channelsOf(g, gm);
    /* A game that runs long (overtime, extra innings) outlives its listing: the channel's "College Football" ends
       on the hour and the next programme starts in the guide while the game is still on.  The channels found
       for a live game stay its own until it's over, so the page keeps them and the score corner stays off them. */
    if (g.state === 'in') {
      var st = sticky[g.id] || (sticky[g.id] = {});
      out.forEach(function (x) { st[x.c.k] = x; });
      Object.keys(st).forEach(function (k) { if (!out.some(function (x) { return x.c.k === k; })) out.push(st[k]); });
    } else if (sticky[g.id]) delete sticky[g.id];
    if (memo) memo[mk] = out;
    return out;
  }
  var sticky = {};

  /* ---------- cricket in the guide ----------
     ESPN names no broadcaster for cricket, and its teams aren't My teams, so a match is found in the guide
     itself: a programme naming both sides ("New Zealand v India, 2nd Test, Day 3", "IND vs NZ 1st T20I LIVE")
     at the match's time ranks first, a channel named after the match next, then a cricket programme on a cricket
     channel then ("Live Cricket" on Star Sports 1), which may be another match on at the same time. */
  var CRICKET_ALIAS = { india: ['ind'], 'new zealand': ['nz', 'black caps', 'blackcaps'], australia: ['aus'], england: ['eng'], pakistan: ['pak'],
    'south africa': ['sa', 'rsa', 'proteas'], 'sri lanka': ['sl'], bangladesh: ['ban', 'bd'], 'west indies': ['wi', 'windies'], afghanistan: ['afg'],
    zimbabwe: ['zim'], ireland: ['ire'], scotland: ['sco'], netherlands: ['ned'], nepal: ['nep'], 'united arab emirates': ['uae'], 'united states of america': ['usa'] };
  // Channels that show cricket, by the start of their squashed name (after a country tag: "IN: Star Sports 1").
  var CRICKET_CH = /^([a-z]{2,3})?(starsports|sonysports|sonyten|sonysix|ten\d|willow|skysportscricket|skycricket|foxcricket|supersportcricket|ssc|ptvsports|asports|tensports|tsports|sports18|jiostar|jiohotstar|hotstar|gazitv|maasranga|astrocricket|cricket)/;
  function cnorm(t) { return ' ' + String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  // A side's names, whole words: "india", "ind" (a women's side by its country, see below).
  function sideNames(t) {
    var full = cnorm(t.full || t.name).replace(/ women /g, ' ').trim(), out = [full];
    (CRICKET_ALIAS[full] || []).forEach(function (a) { out.push(a); });
    if (t.abbr && t.abbr.length >= 2 && t.abbr.length <= 4) out.push(t.abbr.toLowerCase().replace(/w$/, '') || t.abbr.toLowerCase());
    return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  function names(text, list) { return list.some(function (n) { return text.indexOf(' ' + n + ' ') >= 0; }); }
  // Did programme [p] air at the match's time (now, for one being played)?
  function atMatch(g, p) {
    var now = Date.now();
    if (g.state === 'in') return p.s <= now + 15 * 60000 && p.e > now;
    return (p.s <= g.s && p.e > g.s) || Math.abs(p.s - g.s) < 2 * 3600e3;
  }
  var byGuideId = null;
  // The channel a guide search result is on (its own key, else the channel showing that guide id).
  function chanOf(key) {
    var c = Library.find(key);
    if (c) return c;
    if (!byGuideId || byGuideId.of !== Library.data.channels) {
      var m = {}, cs = Library.data.channels;
      for (var i = 0; i < cs.length; i++) { var id = typeof Epg !== 'undefined' && Epg.epgId ? Epg.epgId(cs[i]) : ''; if (id && (!m[id] || !shown(m[id]))) m[id] = cs[i]; }
      byGuideId = { of: cs, map: m };
    }
    return byGuideId.map[key] || null;
  }
  function cricketChannels(g, add) {
    if (g.teams.length !== 2 || typeof Epg === 'undefined' || !Epg.search) return;
    var a = sideNames(g.teams[0]), b = sideNames(g.teams[1]), women = /women/i.test(g.teams[0].full + ' ' + g.teams[1].full);
    // A men's match isn't the women's one between the same countries, and the other way round.
    var right = function (t) { return women ? / women | w /.test(t) : !/ women /.test(t); };
    // A quick look at the letters first: the guide has every channel's week of programmes.
    var rx = function (l) { return new RegExp('\\b(' + l.map(function (x) { return x.replace(/ /g, '\\W+'); }).join('|') + ')\\b', 'i'); }, qa = rx(a), qb = rx(b);
    Epg.search(function (t) { if (!qa.test(t) || !qb.test(t)) return false; var n = cnorm(t); return right(n) && names(n, a) && names(n, b) && !/ highlights | replay | review | preview /.test(n); }, 300).forEach(function (r) {
      if (atMatch(g, r.p)) add(chanOf(r.key), r.p, 'guide', 0);
    });
    var cs = Library.data.channels;
    for (var i = 0; i < cs.length; i++) { var nm = Library.name(cs[i]); if (!qa.test(nm) || !qb.test(nm)) continue; var n = cnorm(nm); if (names(n, a) && names(n, b) && right(n)) add(cs[i], null, 'guide', 0.5); }
    Epg.search(function (t) { return /cricket|test|odi|t20/i.test(t) && / cricket | test match | odi | t20i? /.test(cnorm(t)); }, 300).forEach(function (r) {
      var c = chanOf(r.key);
      if (c && CRICKET_CH.test(squash(Library.name(c))) && atMatch(g, r.p) && right(cnorm(r.p.t)) && !/ highlights | replay /.test(cnorm(r.p.t))) add(c, r.p, 'net', 2);
    });
  }
  /* A race weekend's session in the guide (ESPN names its broadcasters, but rarely a channel you have: Apple TV,
     F1 TV): a Formula 1 programme at the session's time naming that session ("F1: Qatar GP Qualifying", "Formula
     1 Live: Practice 2") first, then any Formula 1 programme then. */
  var RACE_WORDS = /formula\s*(1|one)|\bf1\b|grand prix|\bgp\b/i, RACE_NOT = /highlights|replay|review|preview|reaction|notebook|classic|rewind|show\b|debrief/i;
  function sessionIn(sess, t) {
    var n = String(sess || '').toLowerCase(), m = /practice (\d)/.exec(n);
    if (m) return new RegExp('practice\\s*' + m[1] + '|\\bfp\\s*' + m[1] + '\\b', 'i').test(t);
    if (n === 'sprint qualifying') return /sprint\s*(qualifying|shootout|quali)/i.test(t);
    if (n === 'sprint') return /sprint/i.test(t) && !/qualifying|shootout|quali/i.test(t);
    if (n === 'qualifying') return /qualifying|\bquali\b|\bqualy\b/i.test(t) && !/sprint/i.test(t);
    if (n === 'race') return /\brace\b|grand prix|\bgp\b/i.test(t) && !/practice|\bfp\d|qualifying|quali|sprint/i.test(t);
    return false;
  }
  function raceChannels(g, add) {
    if (typeof Epg === 'undefined' || !Epg.search) return;
    Epg.search(function (t) { return RACE_WORDS.test(t) && !RACE_NOT.test(t); }, 300).forEach(function (r) {
      if (!atMatch(g, r.p)) return;
      if (sessionIn(g.session, r.p.t)) return add(chanOf(r.key), r.p, 'guide', 0);
      // One that doesn't say the session: only when it's on over the session's start (not the one before).
      if (r.p.s <= g.s + 10 * 60000 && r.p.e > g.s) add(chanOf(r.key), r.p, 'net', 2);
    });
  }
  function channelsOf(g, gm) {
    var out = [], seen = {}, ids = g.teams.map(function (t) { return t.id; }).filter(Boolean);
    function add(c, p, how, rank, net) { if (!c || seen[c.k] || !shown(c)) return; seen[c.k] = 1; out.push({ c: c, p: p || null, how: how, net: net || '', r: rank - (Library.isFav && Library.isFav(c.k) ? 0.5 : 0) }); }
    ids.forEach(function (id) {
      (gm[id] || []).forEach(function (x) {
        if (Math.abs(x.p.s - g.s) > 3 * 3600e3 && !(x.p.s <= g.s && x.p.e > g.s)) return;
        if (x.p.e <= Date.now() && g.state !== 'in') return;          // an ended listing only for a game still on (overtime)
        var other = ids.filter(function (o) { return o !== id; })[0], both = other && (x.pair || '').indexOf(other.split(':')[1]) >= 0;
        add(x.c, x.p, 'guide', both ? 0 : 1);
      });
    });
    g.nets.forEach(function (n) { byNet(n).forEach(function (c) { add(c, null, 'net', 2, n); }); });
    if (g.lg === 'cricket') cricketChannels(g, add);
    else if (BY[g.lg] && BY[g.lg].race) raceChannels(g, add);
    out.sort(function (a, b) { return a.r - b.r || (a.c.num || 9e9) - (b.c.num || 9e9); });
    return out;
  }

  /* ---------- the rows of the Sports screen (and the phone app's Sports tab) ----------
     My teams (the games of the teams you follow this week: on now, what's next, today's finals last), Live now,
     then a row per league shown: today's games, or tomorrow's when it has none today.  t: the words, translated. */
  function follows(g) { return typeof Teams !== 'undefined' && g.teams.some(function (x) { return x.id && Teams.follows(x.id); }); }
  function order(a, b) {
    var ra = a.state === 'in' ? 0 : a.state === 'pre' ? 1 : 2, rb = b.state === 'in' ? 0 : b.state === 'pre' ? 1 : 2;
    return ra - rb || (ra === 2 ? b.s - a.s : a.s - b.s);
  }
  function rows(t) {
    t = t || function (x, v) { return String(x).replace(/\{([a-z])\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
    var now = Date.now(), out = [], every = all(), seen = {};
    var my = every.filter(function (g) { if (seen[g.id] || !follows(g)) return false; seen[g.id] = 1; return g.state === 'pre' ? g.s > now - 6 * 3600e3 : g.state === 'in'; }).sort(order).slice(0, 14);
    if (my.length) out.push({ id: 'mine', title: t('My teams'), sub: t('on now first, then what\'s next'), items: my });
    seen = {};
    var live = every.filter(function (g) { if (seen[g.id] || g.state !== 'in') return false; seen[g.id] = 1; return BY[g.lg] && leagues().indexOf(BY[g.lg]) >= 0 || follows(g); }).sort(order);
    if (live.length) out.push({ id: 'live', title: t('Live now'), sub: live.length === 1 ? t('1 game') : t('{n} games', { n: live.length }), items: live });
    // Your teams' finals of the last four days, the newest first.
    seen = {};
    var recent = every.filter(function (g) { if (seen[g.id] || g.state !== 'post' || g.s < now - 4 * 86400e3) return false; seen[g.id] = 1; return follows(g); })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 20);
    if (recent.length) out.push({ id: 'recent', title: t('Recent results'), sub: t('your teams\' final scores'), items: recent });
    leagues().forEach(function (lg) {
      // ESPN's scoreboard for a league out of season answers with its last game (MLB in November: the World
      // Series).  Only games from the last day and a half and later count, so such a league has no row.
      var fresh = function (l) { return l && l.filter(function (g) { return g.s > now - 36 * 3600e3; }); };
      var today = fresh(day(lg.id, 0)), when = '', list = today;
      if (today && !today.length) { list = fresh(day(lg.id, 1)); when = t('Tomorrow'); }
      if (!list || !list.length) return;                     // not loaded yet, or nothing
        var many = lg.race ? (list.length === 1 ? t('1 session') : t('{n} sessions', { n: list.length })) : list.length === 1 ? t('1 game') : t('{n} games', { n: list.length });
      out.push({ id: 'lg:' + lg.id, title: lg.name, sub: (when ? when + '  ·  ' : '') + many, items: list.slice().sort(order) });
    });
    // Your order of the rows (Blue on Sports), the rest after them as they come.
    var ord = Array.isArray(S().sportsOrder) ? S().sportsOrder : [];
    if (ord.length) out.sort(function (a, b) { var x = ord.indexOf(a.id), y = ord.indexOf(b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    return out;
  }
  /* All the rows that can be on Sports, in your order: [{ id, name, league }]. */
  function rowOrder() {
    var all = [{ id: 'mine', name: 'My teams' }, { id: 'live', name: 'Live now' }, { id: 'recent', name: 'Recent results' }].concat(LEAGUES.map(function (l) { return { id: 'lg:' + l.id, name: l.name, league: l.id }; }));
    var ord = Array.isArray(S().sportsOrder) ? S().sportsOrder : [];
    return all.map(function (r, i) { return { r: r, k: ord.indexOf(r.id) < 0 ? 99 + i : ord.indexOf(r.id) }; }).sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.r; });
  }
  function setOrder(ids) { S().sportsOrder = ids.slice(); if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings(); changed(); }
  // A reminder for a game, on a channel: set or cancelled (true: set now).
  function reminded(g, c) { return (Store.edits.reminders || []).some(function (r) { return r.k === c.k && Math.abs(r.s - g.s) < 60000; }); }
  function remind(g, c) {
    var rem = Store.edits.reminders, i = rem.findIndex(function (r) { return r.k === c.k && Math.abs(r.s - g.s) < 60000; }), on = i < 0;
    if (!on) rem.splice(i, 1);
    // Not "team:" (My teams' own reminders, taken away when those are switched off): one you set yourself.
    else { rem.push({ k: c.k, s: g.s, e: g.s + 3 * 3600e3, t: title(g) }); if (typeof Log !== 'undefined') Log.info('remind', 'Reminder set: ' + title(g) + ' (Sports)'); }
    Store.saveEdits();
    if (typeof Remind !== 'undefined' && Remind.sync) Remind.sync(true);
    return on;
  }

  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function onChange(f) { listeners.push(f); }
  // "Lions at Packers" (the guide's and reminders' way of naming a game); a race weekend's "Qatar Grand Prix: Qualifying".
  function title(g) { return g.teams.length === 2 ? g.teams[0].name + ' at ' + g.teams[1].name : g.session ? g.name + ': ' + g.session : g.name; }

  return { darkLogo: darkLogo, netChannels: netChannels, covered: covered, rowOrder: rowOrder, setOrder: setOrder, rows: rows, follows: follows, reminded: reminded, remind: remind, loaded: loaded, refreshToday: refreshToday, byId: byId, summary: summary, gameOn: gameOn, hidesTeam: hidesTeam, hideTeam: hideTeam, hidden: hidden, reveal: reveal, followedLeagues: followedLeagues, _readSummary: readSummary,
    LEAGUES: LEAGUES, league: function (id) { return BY[id]; }, leagues: leagues, setLeagues: setLeagues, refresh: refresh, anyLive: anyLive, all: all, day: day, errOf: errOf,
    channels: channels, byNet: byNet, title: title, onChange: onChange, dayKey: dayKey, LIVE_MS: LIVE_MS, TODAY_MS: TODAY_MS, _game: game, _squash: squash, _bare: bare, _sideNames: sideNames, _race: race, _raceStandings: readRaceStandings, _sessionIn: sessionIn, _store: store };
})();
if (typeof module !== 'undefined') module.exports = Sports;
