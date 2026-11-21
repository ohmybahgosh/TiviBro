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
    { id: 'ncaaf', name: 'College football', path: 'football/college-football', team: 'ncaaf' },
    { id: 'nba', name: 'NBA', path: 'basketball/nba', team: 'nba' },
    { id: 'ncaab', name: 'College basketball', path: 'basketball/mens-college-basketball', team: 'ncaab' },
    { id: 'wnba', name: 'WNBA', path: 'basketball/wnba', team: 'wnba' },
    { id: 'nhl', name: 'NHL', path: 'hockey/nhl', team: 'nhl' },
    { id: 'mlb', name: 'MLB', path: 'baseball/mlb', team: 'mlb' },
    { id: 'mls', name: 'MLS', path: 'soccer/usa.1', team: 'mls' },
    { id: 'epl', name: 'Premier League', path: 'soccer/eng.1' },
    { id: 'ucl', name: 'Champions League', path: 'soccer/uefa.champions' },
    { id: 'f1', name: 'Formula 1', path: 'racing/f1', race: true }
  ];
  var BY = {}; LEAGUES.forEach(function (l) { BY[l.id] = l; });
  var DEFAULT = ['nfl', 'ncaaf', 'nba', 'nhl', 'mlb'];
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
  function team(lg, t) {
    var tm = t.team || {}, rec = (t.records || [])[0];
    var o = { abbr: tm.abbreviation || '', name: tm.shortDisplayName || tm.displayName || tm.name || '', full: tm.displayName || '', loc: tm.location || '',
      logo: tm.logo || '', color: tm.color || '', alt: tm.alternateColor || '', home: t.homeAway === 'home', score: num(t.score),
      rec: rec && rec.summary || '', rank: t.curatedRank && t.curatedRank.current < 26 ? t.curatedRank.current : 0, win: !!t.winner };
    o.id = teamId(lg, o);
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
  function load(lg, key, force) {
    var day = (store[lg.id] || (store[lg.id] = {}))[key], now = Date.now(), today = key === dayKey(0);
    var ttl = !today ? AHEAD_MS : day && day.games.some(function (g) { return g.state === 'in'; }) ? LIVE_MS : TODAY_MS;
    if (!force && day && now - day.at < ttl) return Promise.resolve(day);
    var bk = lg.id + key;
    if (busy[bk]) return busy[bk];
    var url = BASE + lg.path + '/scoreboard' + (today ? '' : '?dates=' + key) + (lg.id === 'ncaab' || lg.id === 'ncaaf' ? (today ? '?' : '&') + 'limit=100' : '');
    busy[bk] = fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('ESPN said ' + r.status); return r.json(); }).then(function (j) {
      var list = (j.events || []).map(function (e) { return game(lg, e); }).filter(function (g) { return g.s && (lg.race || g.teams.length === 2); });
      store[lg.id][key] = { at: Date.now(), games: list };
      // Days gone by aren't kept (TiviBro can stay open for days).
      var y = dayKey(-1); Object.keys(store[lg.id]).forEach(function (k) { if (k < y) delete store[lg.id][k]; });
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
      if (mine.indexOf(lg.id) >= 0) for (var d = 2; d <= AHEAD_DAYS; d++) jobs.push(load(lg, dayKey(d), false));
    });
    jobs.forEach(function (j) { j.then(function () { if (then) then(); }); });
    return Promise.all(jobs);
  }
  function anyLive() { return all().some(function (g) { return g.state === 'in'; }); }
  function all() {
    var out = [];
    loaded().forEach(function (lg) { var m = store[lg.id] || {}; Object.keys(m).forEach(function (k) { out = out.concat(m[k].games); }); });
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
    if (!force && c && Date.now() - c.at < ttl) return Promise.resolve(c.v);
    return fetch(BASE + lg.path + '/summary?event=' + encodeURIComponent(g.id), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('ESPN said ' + r.status); return r.json(); }).then(function (j) {
      var v = readSummary(j);
      Object.keys(sums).forEach(function (k) { if (Date.now() - sums[k].at > 10 * 60000) delete sums[k]; });
      sums[g.id] = { at: Date.now(), v: v };
      return v;
    }, function (e) { if (typeof Log !== 'undefined') Log.warn('sports', 'Game page not loaded: ' + (e && e.message)); return c ? c.v : null; });
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
        return { team: e.team || '', rec: rec, extra: extra, streak: st.streak || '' };
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
  /* The guide's games for every team playing in the next day and a half, worked out at most every two minutes:
     team id -> [{ c, p, pair }]. */
  var chanCache = null;
  function guideGames() {
    var now = Date.now();
    if (chanCache && now - chanCache.at < 120000 && chanCache.of === Library.data.channels) return chanCache.map;
    var ids = {}, map = {};
    all().forEach(function (g) { if (g.s < now + 36 * 3600e3 && (g.state !== 'post')) g.teams.forEach(function (t) { if (t.id) ids[t.id] = 1; }); });
    var list = [];
    try { if (typeof Teams !== 'undefined' && Teams.games && Object.keys(ids).length && typeof Epg !== 'undefined' && Epg.search) list = Teams.games(36 * 3600e3, false, Object.keys(ids)); } catch (e) { if (typeof Log !== 'undefined') Log.warn('sports', 'Finding games in the guide: ' + (e && e.message)); }
    list.forEach(function (x) { (map[x.team.id] || (map[x.team.id] = [])).push(x); });
    chanCache = { at: now, of: Library.data.channels, map: map };
    return map;
  }
  /* [{ c, p, how: 'guide' | 'net', net }] for a game, best first: the guide naming both teams, then one team at
     the right time, then the networks ESPN names.  A Favorite comes first among equals. */
  function channels(g) {
    if (!g || typeof Library === 'undefined' || !Library.data.channels.length) return [];
    var out = [], seen = {}, gm = guideGames(), ids = g.teams.map(function (t) { return t.id; }).filter(Boolean);
    function add(c, p, how, rank, net) { if (!c || seen[c.k] || !shown(c)) return; seen[c.k] = 1; out.push({ c: c, p: p || null, how: how, net: net || '', r: rank - (Library.isFav && Library.isFav(c.k) ? 0.5 : 0) }); }
    ids.forEach(function (id) {
      (gm[id] || []).forEach(function (x) {
        if (Math.abs(x.p.s - g.s) > 3 * 3600e3 && !(x.p.s <= g.s && x.p.e > g.s)) return;
        var other = ids.filter(function (o) { return o !== id; })[0], both = other && (x.pair || '').indexOf(other.split(':')[1]) >= 0;
        add(x.c, x.p, 'guide', both ? 0 : 1);
      });
    });
    g.nets.forEach(function (n) { byNet(n).forEach(function (c) { add(c, null, 'net', 2, n); }); });
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
    var my = every.filter(function (g) { if (seen[g.id] || !follows(g)) return false; seen[g.id] = 1; return g.state !== 'post' || g.s > now - 12 * 3600e3; }).sort(order).slice(0, 14);
    if (my.length) out.push({ id: 'mine', title: t('My teams'), sub: t('on now first, then what\'s next'), items: my });
    seen = {};
    var live = every.filter(function (g) { if (seen[g.id] || g.state !== 'in') return false; seen[g.id] = 1; return BY[g.lg] && leagues().indexOf(BY[g.lg]) >= 0 || follows(g); }).sort(order);
    if (live.length) out.push({ id: 'live', title: t('Live now'), sub: live.length === 1 ? t('1 game') : t('{n} games', { n: live.length }), items: live });
    leagues().forEach(function (lg) {
      var today = day(lg.id, 0), when = '', list = today;
      if (today && !today.length) { list = day(lg.id, 1); when = t('Tomorrow'); }
      if (!list || !list.length) return;                     // not loaded yet, or nothing
      out.push({ id: 'lg:' + lg.id, title: lg.name, sub: (when ? when + '  ·  ' : '') + (list.length === 1 ? t('1 game') : t('{n} games', { n: list.length })), items: list.slice().sort(order) });
    });
    return out;
  }
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
  // "Lions at Packers" (the guide's and reminders' way of naming a game).
  function title(g) { return g.teams.length === 2 ? g.teams[0].name + ' at ' + g.teams[1].name : g.name; }

  return { rows: rows, follows: follows, reminded: reminded, remind: remind, loaded: loaded, refreshToday: refreshToday, byId: byId, summary: summary, gameOn: gameOn, hidesTeam: hidesTeam, hideTeam: hideTeam, hidden: hidden, reveal: reveal, followedLeagues: followedLeagues, _readSummary: readSummary,
    LEAGUES: LEAGUES, league: function (id) { return BY[id]; }, leagues: leagues, setLeagues: setLeagues, refresh: refresh, anyLive: anyLive, all: all, day: day, errOf: errOf,
    channels: channels, byNet: byNet, title: title, onChange: onChange, dayKey: dayKey, LIVE_MS: LIVE_MS, TODAY_MS: TODAY_MS, _game: game, _squash: squash, _bare: bare, _store: store };
})();
if (typeof module !== 'undefined') module.exports = Sports;
