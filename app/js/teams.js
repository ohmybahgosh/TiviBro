/* My teams: the sports teams you follow, gathered into one group near the top of the guide.
   The group has each team's own channel (providers' "NFL TEAMS", "NHL TEAMS" groups: "NHL | DETROIT RED
   WINGS") and every channel with one of its games on now or starting soon: event channels ("USA NHL 02:
   WPG VS CAR @ 1:00 pm", "NBA 1 | Oct 29 7:55 PM | Atlanta Hawks Cleveland Cavaliers") and guide
   programmes ("Detroit Lions at Minnesota Vikings").  Games on now come first, then the next ones, then
   the team channels.  Followed teams live in the settings, so they stay when you switch playlists.
   Optionally their games get reminders, through the watchlist (app/js/watch.js). */
var Teams = (function () {
  'use strict';

  var LEAGUES = [['nfl', 'NFL'], ['nba', 'NBA'], ['nhl', 'NHL'], ['mlb', 'MLB'], ['wnba', 'WNBA'], ['mls', 'MLS']];
  // [abbreviation, full name, nicknames (comma separated, the first is how it's shown short), other full names]
  var DATA = {
    nfl: [['ARI', 'Arizona Cardinals', 'Cardinals'], ['ATL', 'Atlanta Falcons', 'Falcons'], ['BAL', 'Baltimore Ravens', 'Ravens'], ['BUF', 'Buffalo Bills', 'Bills'],
      ['CAR', 'Carolina Panthers', 'Panthers'], ['CHI', 'Chicago Bears', 'Bears'], ['CIN', 'Cincinnati Bengals', 'Bengals'], ['CLE', 'Cleveland Browns', 'Browns'],
      ['DAL', 'Dallas Cowboys', 'Cowboys'], ['DEN', 'Denver Broncos', 'Broncos'], ['DET', 'Detroit Lions', 'Lions'], ['GB', 'Green Bay Packers', 'Packers'],
      ['HOU', 'Houston Texans', 'Texans'], ['IND', 'Indianapolis Colts', 'Colts'], ['JAX', 'Jacksonville Jaguars', 'Jaguars'], ['KC', 'Kansas City Chiefs', 'Chiefs'],
      ['LV', 'Las Vegas Raiders', 'Raiders'], ['LAC', 'Los Angeles Chargers', 'Chargers'], ['LAR', 'Los Angeles Rams', 'Rams'], ['MIA', 'Miami Dolphins', 'Dolphins'],
      ['MIN', 'Minnesota Vikings', 'Vikings'], ['NE', 'New England Patriots', 'Patriots'], ['NO', 'New Orleans Saints', 'Saints'], ['NYG', 'New York Giants', 'Giants'],
      ['NYJ', 'New York Jets', 'Jets'], ['PHI', 'Philadelphia Eagles', 'Eagles'], ['PIT', 'Pittsburgh Steelers', 'Steelers'], ['SF', 'San Francisco 49ers', '49ers,Niners'],
      ['SEA', 'Seattle Seahawks', 'Seahawks'], ['TB', 'Tampa Bay Buccaneers', 'Buccaneers,Bucs'], ['TEN', 'Tennessee Titans', 'Titans'], ['WAS', 'Washington Commanders', 'Commanders', 'Washington Football Team']],
    nba: [['ATL', 'Atlanta Hawks', 'Hawks'], ['BOS', 'Boston Celtics', 'Celtics'], ['BKN', 'Brooklyn Nets', 'Nets'], ['CHA', 'Charlotte Hornets', 'Hornets'],
      ['CHI', 'Chicago Bulls', 'Bulls'], ['CLE', 'Cleveland Cavaliers', 'Cavaliers,Cavs'], ['DAL', 'Dallas Mavericks', 'Mavericks,Mavs'], ['DEN', 'Denver Nuggets', 'Nuggets'],
      ['DET', 'Detroit Pistons', 'Pistons'], ['GSW', 'Golden State Warriors', 'Warriors'], ['HOU', 'Houston Rockets', 'Rockets'], ['IND', 'Indiana Pacers', 'Pacers'],
      ['LAC', 'Los Angeles Clippers', 'Clippers', 'LA Clippers'], ['LAL', 'Los Angeles Lakers', 'Lakers', 'LA Lakers'], ['MEM', 'Memphis Grizzlies', 'Grizzlies'], ['MIA', 'Miami Heat', 'Heat'],
      ['MIL', 'Milwaukee Bucks', 'Bucks'], ['MIN', 'Minnesota Timberwolves', 'Timberwolves,Wolves'], ['NOP', 'New Orleans Pelicans', 'Pelicans'], ['NYK', 'New York Knicks', 'Knicks'],
      ['OKC', 'Oklahoma City Thunder', 'Thunder'], ['ORL', 'Orlando Magic', 'Magic'], ['PHI', 'Philadelphia 76ers', '76ers,Sixers'], ['PHX', 'Phoenix Suns', 'Suns'],
      ['POR', 'Portland Trail Blazers', 'Trail Blazers,Blazers'], ['SAC', 'Sacramento Kings', 'Kings'], ['SAS', 'San Antonio Spurs', 'Spurs'], ['TOR', 'Toronto Raptors', 'Raptors'],
      ['UTA', 'Utah Jazz', 'Jazz'], ['WAS', 'Washington Wizards', 'Wizards']],
    nhl: [['ANA', 'Anaheim Ducks', 'Ducks'], ['BOS', 'Boston Bruins', 'Bruins'], ['BUF', 'Buffalo Sabres', 'Sabres'], ['CGY', 'Calgary Flames', 'Flames'],
      ['CAR', 'Carolina Hurricanes', 'Hurricanes,Canes'], ['CHI', 'Chicago Blackhawks', 'Blackhawks'], ['COL', 'Colorado Avalanche', 'Avalanche,Avs'], ['CBJ', 'Columbus Blue Jackets', 'Blue Jackets'],
      ['DAL', 'Dallas Stars', 'Stars'], ['DET', 'Detroit Red Wings', 'Red Wings'], ['EDM', 'Edmonton Oilers', 'Oilers'], ['FLA', 'Florida Panthers', 'Panthers'],
      ['LAK', 'Los Angeles Kings', 'Kings', 'LA Kings'], ['MIN', 'Minnesota Wild', 'Wild'], ['MTL', 'Montreal Canadiens', 'Canadiens,Habs'], ['NSH', 'Nashville Predators', 'Predators,Preds'],
      ['NJD', 'New Jersey Devils', 'Devils'], ['NYI', 'New York Islanders', 'Islanders'], ['NYR', 'New York Rangers', 'Rangers'], ['OTT', 'Ottawa Senators', 'Senators,Sens'],
      ['PHI', 'Philadelphia Flyers', 'Flyers'], ['PIT', 'Pittsburgh Penguins', 'Penguins,Pens'], ['SJS', 'San Jose Sharks', 'Sharks'], ['SEA', 'Seattle Kraken', 'Kraken'],
      ['STL', 'St Louis Blues', 'Blues', 'Saint Louis Blues'], ['TBL', 'Tampa Bay Lightning', 'Lightning,Bolts'], ['TOR', 'Toronto Maple Leafs', 'Maple Leafs,Leafs'], ['UTA', 'Utah Mammoth', 'Mammoth', 'Utah Hockey Club'],
      ['VAN', 'Vancouver Canucks', 'Canucks'], ['VGK', 'Vegas Golden Knights', 'Golden Knights'], ['WSH', 'Washington Capitals', 'Capitals,Caps'], ['WPG', 'Winnipeg Jets', 'Jets']],
    mlb: [['ARI', 'Arizona Diamondbacks', 'Diamondbacks,D-backs'], ['ATL', 'Atlanta Braves', 'Braves'], ['BAL', 'Baltimore Orioles', 'Orioles'], ['BOS', 'Boston Red Sox', 'Red Sox'],
      ['CHC', 'Chicago Cubs', 'Cubs'], ['CWS', 'Chicago White Sox', 'White Sox'], ['CIN', 'Cincinnati Reds', 'Reds'], ['CLE', 'Cleveland Guardians', 'Guardians'],
      ['COL', 'Colorado Rockies', 'Rockies'], ['DET', 'Detroit Tigers', 'Tigers'], ['HOU', 'Houston Astros', 'Astros'], ['KC', 'Kansas City Royals', 'Royals'],
      ['LAA', 'Los Angeles Angels', 'Angels'], ['LAD', 'Los Angeles Dodgers', 'Dodgers', 'LA Dodgers'], ['MIA', 'Miami Marlins', 'Marlins'], ['MIL', 'Milwaukee Brewers', 'Brewers'],
      ['MIN', 'Minnesota Twins', 'Twins'], ['NYM', 'New York Mets', 'Mets'], ['NYY', 'New York Yankees', 'Yankees'], ['ATH', 'Athletics', 'Athletics', 'Oakland Athletics,Sacramento Athletics,Las Vegas Athletics'],
      ['PHI', 'Philadelphia Phillies', 'Phillies'], ['PIT', 'Pittsburgh Pirates', 'Pirates'], ['SD', 'San Diego Padres', 'Padres'], ['SF', 'San Francisco Giants', 'Giants'],
      ['SEA', 'Seattle Mariners', 'Mariners'], ['STL', 'St Louis Cardinals', 'Cardinals', 'Saint Louis Cardinals'], ['TB', 'Tampa Bay Rays', 'Rays'], ['TEX', 'Texas Rangers', 'Rangers'],
      ['TOR', 'Toronto Blue Jays', 'Blue Jays'], ['WSH', 'Washington Nationals', 'Nationals,Nats']],
    wnba: [['ATL', 'Atlanta Dream', 'Dream'], ['CHI', 'Chicago Sky', 'Sky'], ['CON', 'Connecticut Sun', 'Sun'], ['DAL', 'Dallas Wings', 'Wings'],
      ['GSV', 'Golden State Valkyries', 'Valkyries'], ['IND', 'Indiana Fever', 'Fever'], ['LVA', 'Las Vegas Aces', 'Aces'], ['LAS', 'Los Angeles Sparks', 'Sparks', 'LA Sparks'],
      ['MIN', 'Minnesota Lynx', 'Lynx'], ['NYL', 'New York Liberty', 'Liberty'], ['PHX', 'Phoenix Mercury', 'Mercury'], ['POR', 'Portland Fire', 'Fire'],
      ['SEA', 'Seattle Storm', 'Storm'], ['TOR', 'Toronto Tempo', 'Tempo'], ['WAS', 'Washington Mystics', 'Mystics']],
    mls: [['ATL', 'Atlanta United', 'Atlanta United', 'Atlanta United FC'], ['ATX', 'Austin FC', 'Austin FC'], ['CLT', 'Charlotte FC', 'Charlotte FC'], ['CHI', 'Chicago Fire', 'Chicago Fire', 'Chicago Fire FC'],
      ['CIN', 'FC Cincinnati', 'FC Cincinnati'], ['COL', 'Colorado Rapids', 'Rapids'], ['CLB', 'Columbus Crew', 'Crew'], ['DC', 'DC United', 'DC United', 'D C United'],
      ['DAL', 'FC Dallas', 'FC Dallas'], ['HOU', 'Houston Dynamo', 'Dynamo', 'Houston Dynamo FC'], ['MIA', 'Inter Miami', 'Inter Miami', 'Inter Miami CF'], ['LA', 'LA Galaxy', 'Galaxy', 'Los Angeles Galaxy'],
      ['LAFC', 'Los Angeles FC', 'LAFC'], ['MIN', 'Minnesota United', 'Minnesota United', 'Minnesota United FC'], ['MTL', 'CF Montreal', 'CF Montreal', 'Club de Foot Montreal'], ['NSH', 'Nashville SC', 'Nashville SC'],
      ['NE', 'New England Revolution', 'Revolution,Revs'], ['NYC', 'New York City FC', 'NYCFC'], ['RBNY', 'New York Red Bulls', 'Red Bulls'], ['ORL', 'Orlando City', 'Orlando City', 'Orlando City SC'],
      ['PHI', 'Philadelphia Union', 'Union'], ['POR', 'Portland Timbers', 'Timbers'], ['RSL', 'Real Salt Lake', 'Real Salt Lake'], ['SD', 'San Diego FC', 'San Diego FC'],
      ['SJ', 'San Jose Earthquakes', 'Earthquakes'], ['SEA', 'Seattle Sounders', 'Sounders', 'Seattle Sounders FC'], ['SKC', 'Sporting Kansas City', 'Sporting KC'], ['STL', 'St Louis City SC', 'St Louis City', 'Saint Louis City SC'],
      ['TOR', 'Toronto FC', 'Toronto FC'], ['VAN', 'Vancouver Whitecaps', 'Whitecaps', 'Vancouver Whitecaps FC']]
  };
  // Words that put a name in a league: "NHL", "Hockey".  Football and soccer stay out (they mean both).
  var LEAGUE_WORDS = { nfl: /\bnfl\b|sunday ticket|red ?zone/, nba: /\bnba\b|league pass/, nhl: /\bnhl\b|hockey|center ice/, mlb: /\bmlb\b|baseball|extra innings/, wnba: /\bwnba\b/, mls: /\bmls\b|season pass/ };

  // "WPG VS CAR", "WPG vs. CAR", "WPG @ CAR": two abbreviations facing each other.
  var MATCHUP = /\b[A-Z]{2,4}\s+(?:[Vv][Ss]?\.?|AT|at)\s+[A-Z]{2,4}\b|\b[A-Z]{2,4}\s*@\s*[A-Z]{2,4}\b/;
  function norm(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[àáâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[ç]/g, 'c').replace(/&/g, ' and ')
      .replace(/\bst\.?\s/g, 'st ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  var ALL = [], BY_ID = {}, NICKS = {};      // nickname -> [team]
  LEAGUES.forEach(function (lg) {
    DATA[lg[0]].forEach(function (r) {
      var t = { id: lg[0] + ':' + r[0].toLowerCase(), league: lg[0], abbr: r[0], name: r[1], nicks: r[2].split(','), full: (/ /.test(r[1]) ? [norm(r[1])] : []).concat(r[3] ? r[3].split(',').map(norm) : []) };
      t.short = t.nicks[0];
      t.nk = t.nicks.map(norm);
      ALL.push(t); BY_ID[t.id] = t;
      t.nk.forEach(function (n) { (NICKS[n] || (NICKS[n] = [])).push(t); });
    });
  });

  function S() { return Store.settings; }
  function mine() { var s = S(); if (!Array.isArray(s.myTeams)) s.myTeams = []; return s.myTeams; }
  function follows(id) { return mine().indexOf(id) >= 0; }
  function followed() { return mine().map(function (id) { return BY_ID[id]; }).filter(Boolean); }
  function groupOn() { return S().teamsGroup !== false && mine().length > 0; }
  function remindOn() { return !!S().teamsRemind && mine().length > 0; }
  function ahead() { return (+S().teamsAhead || 6) * 3600e3; }

  /* Which of the given teams a text names.  Full names always count; a nickname ("Red Wings", "Kings")
     needs the league: a league word in the text or its context (the channel and group names), or another
     team of that league in the same text ("Heat at Magic").  Abbreviations ("WPG VS CAR") count only in
     event titles, with the league in the context.  So "Magic Mike" is never a game. */
  function named(text, ctx, teams, abbrs) {
    var t = norm(text), c = norm(ctx || '') + t, hits = [], lg = {}, k;
    for (k in LEAGUE_WORDS) if (LEAGUE_WORDS[k].test(c)) lg[k] = 1;
    var seen = {};                                 // league -> teams of it named in the text (any team)
    function note(team) { (seen[team.league] || (seen[team.league] = {}))[team.id] = 1; }
    ALL.forEach(function (x) {
      if (x.full.some(function (f) { return t.indexOf(f) >= 0; })) { note(x); x._full = 1; } else x._full = 0;
      x._nick = x.nk.some(function (n) { return t.indexOf(n) >= 0; }) ? 1 : 0;
    });
    Object.keys(NICKS).forEach(function (n) { if (t.indexOf(n) >= 0) NICKS[n].forEach(note); });
    for (k in seen) if (Object.keys(seen[k]).length >= 2) lg[k] = 1;
    var up = abbrs ? ' ' + String(text).replace(/[^A-Za-z0-9]+/g, ' ') + ' ' : '';
    teams.forEach(function (x) {
      var hit = x._full || (x._nick && lg[x.league]);
      if (!hit && abbrs && lg[x.league] && up.indexOf(' ' + x.abbr + ' ') >= 0 && MATCHUP.test(text)) hit = 1;
      if (hit) hits.push(x);
    });
    return hits;
  }

  /* Team channels: a channel whose whole name, less the league, country and quality tags, is a team
     ("NFL | DETROIT LIONS", "USA NHL Carolina Hurricanes", "Detroit Red Wings HD").  Built once per list. */
  var TAGS = /\b(usa|us|ca|uk|nfl|nba|nhl|mlb|wnba|mls|hd|fhd|uhd|sd|4k|hevc|raw|backup|tv|team|teams|network|live|east|west)\b/g;
  var chanCache = null;
  function teamChannels() {
    var chans = Library.data.channels;
    if (chanCache && chanCache.of === chans) return chanCache.map;
    var full = {}, map = {};
    ALL.forEach(function (x) { x.full.forEach(function (f) { (full[f.trim()] || (full[f.trim()] = [])).push(x); }); });
    for (var i = 0; i < chans.length; i++) {
      var n = norm(chans[i].n).replace(TAGS, ' ').replace(/\s+/g, ' ').trim(), l = full[n];
      if (!l) continue;
      // Two teams with one name in different leagues don't happen today; the league tag would decide.
      var tag = norm(chans[i].n), pick = l.length > 1 ? l.filter(function (x) { return LEAGUE_WORDS[x.league].test(tag); })[0] || l[0] : l[0];
      (map[pick.id] || (map[pick.id] = [])).push(chans[i]);
    }
    chanCache = { of: chans, map: map };
    return map;
  }
  // Leagues in this playlist: ones with team channels or a group named for them.  For the picker.
  function leagues() {
    var tc = teamChannels(), out = [];
    var names = norm(Library.data.groups.map(function (g) { return g.name; }).join(' | '));
    LEAGUES.forEach(function (lg) {
      var own = DATA[lg[0]].filter(function (r) { return tc[lg[0] + ':' + r[0].toLowerCase()]; }).length;
      if (own || new RegExp(' ' + lg[0] + ' ').test(names)) out.push({ id: lg[0], name: lg[1], own: own });
    });
    return out;
  }
  function inLeague(lg) { return ALL.filter(function (x) { return x.league === lg; }); }
  function hasChannel(id) { return !!teamChannels()[id]; }

  function shown(c) {
    var e = Store.edits;
    return S().showHidden || (!e.hiddenChannels[c.k] && !e.hiddenGroups[c.g]);
  }

  /* Games of the followed teams on now or starting within the hours given: [{ c, p, team }], soonest first,
     one channel per game (a Favorite, else the first found). */
  function games(within) {
    var teams = followed(), now = Date.now(), to = now + (within || ahead()), out = [], seen = {};
    if (!teams.length || !Library.data.channels.length) return out;
    var gname = {};
    Library.data.groups.forEach(function (g) { gname[g.id] = g.name; });
    function take(c, p, team) {
      if (!c || !shown(c) || !p.t || p.e <= now || p.s > to) return;
      var key = team.id + '|' + p.s;
      if (seen[key]) { if (Library.isFav(c.k) && !Library.isFav(seen[key].c.k)) seen[key].c = c; return; }
      seen[key] = { c: c, p: p, team: team };
      out.push(seen[key]);
    }
    // Words of every followed team, for a quick first look at each title.
    var words = [];
    teams.forEach(function (x) { words = words.concat(x.full, x.nk); });
    var quick = new RegExp(words.map(function (w) { return w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'));
    var byEpg = {}, all = Library.data.channels, i;
    if (Epg.xml) for (i = 0; i < all.length; i++) { var id = Epg.epgId(all[i]); if (id && !byEpg[id]) byEpg[id] = all[i]; }
    Epg.search(function (t) { return quick.test(norm(t)); }, 4000).forEach(function (r) {
      var c = Library.find(r.key) || byEpg[r.key], p = r.p;
      // Team channels' "Next game: Lions at Vikings at 11/02/2026 01:00 PM" blocks: the game is at that time.
      if (/^\s*next game/i.test(p.t)) {
        var g = Events.nextGame(p.t);
        if (!g) return;
        p = { s: g.start, e: g.start + 3 * 3600e3, t: g.title, ev: 1 };
      }
      if (!c || p.e <= now || p.s > to) return;
      named(p.t, c.n + ' | ' + (gname[c.g] || ''), teams, false).forEach(function (x) { take(c, p, x); });
    });
    // Event channels: the game is in the channel name.
    if (Events.on()) for (i = 0; i < all.length; i++) {
      var c = all[i], ev = Events.of(c);
      if (!ev || ev.end <= now || ev.start > to) continue;
      if (!quick.test(norm(ev.title)) && !MATCHUP.test(ev.title)) continue;
      named(ev.title, c.n + ' | ' + (gname[c.g] || ''), teams, true).forEach(function (x) { take(c, { s: ev.start, e: ev.end, t: ev.title, ev: 1 }, x); });
    }
    out.sort(function (a, b) { var an = a.p.s <= now, bn = b.p.s <= now; return (an === bn ? 0 : an ? -1 : 1) || a.p.s - b.p.s || a.c.num - b.c.num; });
    return out;
  }

  /* The My teams group: games on now, the next games, then the teams' own channels.  Kept a few minutes. */
  var listCache = null;
  function list() {
    if (!groupOn()) return [];
    var now = Date.now();
    if (listCache && now - listCache.at < 180000 && listCache.of === Library.data.channels) return listCache.list;
    var out = [], have = {}, tc = teamChannels();
    games().forEach(function (g) { if (!have[g.c.k]) { have[g.c.k] = 1; out.push(g.c); } });
    followed().forEach(function (x) { (tc[x.id] || []).forEach(function (c) { if (!have[c.k] && shown(c)) { have[c.k] = 1; out.push(c); } }); });
    listCache = { at: now, of: Library.data.channels, list: out };
    return out;
  }
  function dirty() { listCache = null; }

  function follow(id, on) {
    var l = mine(), i = l.indexOf(id);
    if (on && i < 0 && BY_ID[id]) l.push(id);
    if (!on && i >= 0) {
      l.splice(i, 1);
      // Reminders it set for games still to come go with it.
      if (Store.edits && Array.isArray(Store.edits.reminders)) Store.edits.reminders = Store.edits.reminders.filter(function (r) { return r.w !== 'team:' + id; });
    }
    Store.saveSettings();
    dirty();
    if (Store.edits) Store.saveEdits();
  }
  // The team a channel belongs to, for Hold OK on a team channel.
  function ofChannel(c) {
    if (!c) return null;
    var tc = teamChannels();
    for (var id in tc) if (tc[id].indexOf(c) >= 0) return BY_ID[id];
    return null;
  }

  return {
    LEAGUES: LEAGUES, all: function () { return ALL; }, team: function (id) { return BY_ID[id]; }, named: named, norm: norm,
    leagues: leagues, inLeague: inLeague, hasChannel: hasChannel, teamChannels: teamChannels, ofChannel: ofChannel,
    follows: follows, followed: followed, follow: follow, groupOn: groupOn, remindOn: remindOn, games: games, list: list, dirty: dirty
  };
})();
