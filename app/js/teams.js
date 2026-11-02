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
      ['LAFC', 'Los Angeles FC', 'LAFC', 'Los Angeles Football Club'], ['MIN', 'Minnesota United', 'Minnesota United', 'Minnesota United FC'], ['MTL', 'CF Montreal', 'CF Montreal', 'Club de Foot Montreal'], ['NSH', 'Nashville SC', 'Nashville SC'],
      ['NE', 'New England Revolution', 'Revolution,Revs'], ['NYC', 'New York City FC', 'NYCFC'], ['RBNY', 'New York Red Bulls', 'Red Bulls', 'Red Bull New York'], ['ORL', 'Orlando City', 'Orlando City', 'Orlando City SC'],
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

  /* Which of the given teams a text names.  From real providers' lists:
     - Full names always count ("Detroit Lions", "LA Clippers").
     - A nickname ("Red Wings", "Kings") needs the league: a league word in the text or its context (the
       channel and group names: "NHL", "Hockey"), or another team of that league ("Heat at Magic").  So
       "Magic Mike" is never a game.  And it must stand alone: "Parkland Rangers", "Brandon Wheat Kings"
       and "Providence Bruins" are other teams.
     - A city alone ("NHL: Winnipeg vs Carolina") counts with the league named and two of its teams there,
       when only one team of that league has that city.
     - Abbreviations ("WPG VS CAR") count only in event titles, with the league in the context.
     - Junior, minor and youth hockey and the like ("U15", "AAA", "OJHL", "flohockey") only by full name. */
  var CODES = { nfl: /\bnfl\b|sunday ticket|red ?zone/, nba: /\bnba\b|league pass/, nhl: /\bnhl\b|center ice/, mlb: /\bmlb\b|extra innings/, wnba: /\bwnba\b/, mls: /\bmls\b|major league soccer/ };
  var MINOR = /u(?:[89]|1\d|2[01])\b|\baaa\b|\d+aaa\b|\b(?:ojhl|ahl|echl|ohl|whl|qmjhl|bchl|ajhl|sjhl|mjhl|nahl|ushl|nwhl|pwhl|sphl|fphl|junior|jr|midget|bantam|minor|youth|college|ncaa\w*|flohockey|flo ?sports|g ?league|nbl|cfl|xfl|ufl|usl|nwsl)\b/i;
  var BEFORE_OK = /^(vs|v|at|and|the|versus|vs\.|nfl|nba|nhl|mlb|wnba|mls|hockey|football|basketball|baseball|soccer|game|live|watch|preview|pregame|postgame|replay|on|in|night|day|sunday|monday|tuesday|wednesday|thursday|friday|saturday|tonight|today|pass|ticket)$/i;
  function esc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // City words: the full name less the nickname ("winnipeg"), or for clubs less FC, SC, United ("atlanta").
  ALL.forEach(function (x) {
    var f = x.full[0] ? x.full[0].trim() : '', n = x.nk[0].trim();
    var city = f && f.slice(-n.length) === n ? f.slice(0, f.length - n.length).trim() : f;
    if (x.league === 'mls') city = (' ' + (city || f) + ' ').replace(/ (fc|sc|cf|united|city|inter|real|sporting|club de foot) /g, ' ').replace(/\s+/g, ' ').trim();
    x.city = city;
    x.words = {};
    x.full.concat(x.nk).forEach(function (w) { w.trim().split(' ').forEach(function (y) { x.words[y] = 1; }); });
    x.rx = x.nicks.map(function (nk) { return new RegExp('(^|[^A-Za-z0-9])(' + esc(nk).replace(/\s+/g, '\\s+') + ')(?![A-Za-z0-9])', 'gi'); });
  });
  var CITY_N = {};
  ALL.forEach(function (x) { if (x.city) CITY_N[x.league + '|' + x.city] = (CITY_N[x.league + '|' + x.city] || 0) + 1; });
  // A nickname that stands alone in the original text: not "Parkland Rangers".
  function nickAlone(x, text) {
    for (var i = 0; i < x.rx.length; i++) {
      var rx = x.rx[i], m;
      rx.lastIndex = 0;
      while ((m = rx.exec(text))) {
        var before = text.slice(0, m.index + m[1].length), w = /([A-Za-z][A-Za-z.'\u2019-]*)\s+$/.exec(before);
        if (!w || BEFORE_OK.test(w[1]) || x.words[w[1].toLowerCase().replace(/[^a-z0-9]/g, '')]) return true;
      }
    }
    return false;
  }
  function named(text, ctx, teams, abbrs) {
    text = String(text || '');
    var t = norm(text), c = norm(ctx || '') + t, hits = [], code = {}, word = {}, k;
    var minor = MINOR.test(text + ' ' + (ctx || ''));
    for (k in LEAGUE_WORDS) if (LEAGUE_WORDS[k].test(c)) word[k] = 1;
    for (k in CODES) if (CODES[k].test(c)) code[k] = 1;
    var seen = {}, seenCity = {};                    // league -> teams of it named in the text
    function note(m, team) { (m[team.league] || (m[team.league] = {}))[team.id] = 1; }
    ALL.forEach(function (x) {
      x._full = x.full.some(function (f) { return t.indexOf(f) >= 0; }) ? 1 : 0;
      x._nick = !minor && !x._full && x.nk.some(function (n) { return t.indexOf(n) >= 0; }) && nickAlone(x, text) ? 1 : 0;
      x._city = !minor && !x._full && !x._nick && x.city && CITY_N[x.league + '|' + x.city] === 1 && t.indexOf(' ' + x.city + ' ') >= 0 ? 1 : 0;
      if (x._full || x._nick) note(seen, x);
      if (x._full || x._nick || x._city) note(seenCity, x);
    });
    function n(m, l) { return m[l] ? Object.keys(m[l]).length : 0; }
    var up = abbrs ? ' ' + text.replace(/[^A-Za-z0-9]+/g, ' ') + ' ' : '';
    teams.forEach(function (x) {
      var l = x.league, hit = x._full ||
        (x._nick && (word[l] || n(seen, l) >= 2)) ||
        (x._city && (code[l] || n(seen, l) >= 1) && n(seenCity, l) >= 2);
      if (!hit && abbrs && !minor && word[l] && up.indexOf(' ' + x.abbr + ' ') >= 0 && MATCHUP.test(text)) hit = 1;
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
    var full = {}, map = {}, gname = {};
    ALL.forEach(function (x) { x.full.forEach(function (f) { (full[f.trim()] || (full[f.trim()] = [])).push(x); }); });
    Library.data.groups.forEach(function (g) { gname[g.id] = g.name; });
    for (var i = 0; i < chans.length; i++) {
      var n = norm(chans[i].n).replace(TAGS, ' ').replace(/\s+/g, ' ').trim(), l = full[n];
      if (!l) continue;
      // The league or sport has to show in the name or the group: a "Chicago Fire" channel of the TV
      // series is no football club.
      var tag = norm(chans[i].n + ' | ' + (gname[chans[i].g] || ''));
      l = l.filter(function (x) { return LEAGUE_WORDS[x.league].test(tag) || /\b(sports?|teams?)\b/.test(tag); });
      if (!l.length) continue;
      (map[l[0].id] || (map[l[0].id] = [])).push(chans[i]);
    }
    chanCache = { of: chans, map: map };
    return map;
  }
  // Leagues in this playlist: ones with team channels or a group named for them.  For the picker.
  function leagues() {
    var tc = teamChannels(), out = [];
    var names = norm(Library.data.groups.map(function (g) { return g.name; }).join(' | '));
    if (!chanCache.named) {                      // league codes in channel names ("Major League Soccer: ...")
      var chans = Library.data.channels, got = {}, left = LEAGUES.length;
      for (var i = 0; i < chans.length && left; i++) {
        var n = norm(chans[i].n);
        for (var k in CODES) if (!got[k] && CODES[k].test(n)) { got[k] = 1; left--; }
      }
      chanCache.named = got;
    }
    LEAGUES.forEach(function (lg) {
      var own = DATA[lg[0]].filter(function (r) { return tc[lg[0] + ':' + r[0].toLowerCase()]; }).length;
      if (own || new RegExp(' ' + lg[0] + ' ').test(names) || chanCache.named[lg[0]]) out.push({ id: lg[0], name: lg[1], own: own });
    });
    return out;
  }
  function inLeague(lg) { return ALL.filter(function (x) { return x.league === lg; }); }
  function hasChannel(id) { return !!teamChannels()[id]; }

  // In the lists somewhere (a local station in your own "Local channels" group counts).
  function shown(c) { return Library.shownAnywhere ? Library.shownAnywhere(c) : !(Store.edits.hiddenChannels[c.k] || Store.edits.hiddenGroups[c.g]); }

  /* Games of the followed teams on now or starting within the hours given: [{ c, p, team }].  Every
     channel showing a game (a league pass, a sports network, the other team's feed), so one that doesn't
     work has others next to it; one: just one channel per game (a Favorite, else the first found), for
     reminders.  Games on now first, then by start, a game's channels together. */
  function games(within, one) {
    var teams = followed(), now = Date.now(), to = now + (within || ahead()), out = [], seen = {}, mineIds = {};
    if (!teams.length || !Library.data.channels.length) return out;
    teams.forEach(function (x) { mineIds[x.id] = 1; });
    /* Followed teams in a game: two teams of one league named ("Minnesota Vikings at Detroit Lions",
       "WPG VS CAR"), so a team's magazine show, a pregame show or "Future events for the Detroit Tigers
       not found yet" isn't one. */
    function playing(text, ctx, abbrs, title) {
      if (!text || NOGAME.test(title || text)) return [];
      var hits = named(text, ctx, ALL, abbrs), by = {};
      hits.forEach(function (x) { by[x.league] = (by[x.league] || 0) + 1; });
      return hits.filter(function (x) { return mineIds[x.id] && by[x.league] >= 2; });
    }
    var gname = {};
    Library.data.groups.forEach(function (g) { gname[g.id] = g.name; });
    var tc = teamChannels(), whose = {};
    Object.keys(tc).forEach(function (id) { tc[id].forEach(function (c) { whose[c.k] = id; }); });
    function take(c, p, team) {
      if (!c || !shown(c) || !p.t || p.e <= now || p.s > to) return;
      // Another team's own channel (the opponent's) shows the same game: yours is enough.
      if (whose[c.k] && !mineIds[whose[c.k]]) return;
      // One game, however the channels write its start ("12:55 PM" on one, "1:00 PM" on another).
      var key = one ? team.id + '|' + Math.round(p.s / 2700e3) : c.k + '|' + team.id;
      if (seen[key]) { if (one && Library.isFav(c.k) && !Library.isFav(seen[key].c.k)) seen[key].c = c; return; }
      seen[key] = { c: c, p: p, team: team };
      out.push(seen[key]);
    }
    // Words of every followed team, for a quick first look at each title.
    var words = [];
    teams.forEach(function (x) { words = words.concat(x.full, x.nk, x.city ? [x.city] : []); });
    // For descriptions, names only: a city ("Detroit") is in every local news programme.
    var dwords = [];
    teams.forEach(function (x) { dwords = dwords.concat(x.full, x.nk).map(function (w) { return w.trim(); }); });
    var quick = new RegExp(words.map(function (w) { return w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'));
    var byEpg = {}, all = Library.data.channels, i;
    if (Epg.xml) for (i = 0; i < all.length; i++) { var id = Epg.epgId(all[i]); if (id && (!byEpg[id] || (!shown(byEpg[id]) && shown(all[i])))) byEpg[id] = all[i]; }   // one in the lists, if any
    Epg.search(function (t) { return quick.test(norm(t)); }, 4000).forEach(function (r) {
      var c = Library.find(r.key) || byEpg[r.key], p = r.p;
      // Team channels' "Next game: Lions at Vikings at 11/02/2026 01:00 PM" blocks: the game is at that time.
      if (/^\s*next game/i.test(p.t)) {
        var g = Events.nextGame(p.t);
        if (!g) return;
        p = { s: g.start, e: g.start + 3 * 3600e3, t: g.title, ev: 1 };
      }
      if (!c || p.e <= now || p.s > to) return;
      playing(p.t, c.n + ' | ' + (gname[c.g] || ''), false).forEach(function (x) { take(c, p, x); });
    });
    // Programmes that name the game only in the description ("NFL Football" on a local station).
    descHits(dwords).forEach(function (r) {
      var c = Library.find(r.key) || byEpg[r.key], p = r.p;
      if (!c || p.e <= now || p.s > to || !SPORTY.test(p.t) || /\breplay\b/i.test(p.t)) return;
      // A description is loose talk: the team by its full name, or the league named ("NFL Football"), so a
      // college game between the Tigers and the Cardinals isn't the Detroit Tigers.
      var ctx = p.t + ' | ' + c.n + ' | ' + (gname[c.g] || '');
      playing(r.d, ctx, false, p.t).forEach(function (x) { if (x._full || CODES[x.league].test(norm(ctx + ' ' + r.d))) take(c, p, x); });
    });
    // Event channels: the game is in the channel name.
    if (Events.on()) for (i = 0; i < all.length; i++) {
      var c = all[i], ev = Events.of(c);
      if (!ev || ev.end <= now || ev.start > to) continue;
      if (!quick.test(norm(ev.title)) && !MATCHUP.test(ev.title)) continue;
      playing(ev.title, c.n + ' | ' + (gname[c.g] || ''), true).forEach(function (x) { take(c, { s: ev.start, e: ev.end, t: ev.title, ev: 1 }, x); });
    }
    // A game: its team and start (to the half hour); its first start orders it.
    var first = {};
    out.forEach(function (g) { g.gk = g.team.id + '|' + Math.round(g.p.s / 2700e3); if (first[g.gk] == null || g.p.s < first[g.gk]) first[g.gk] = g.p.s; });
    /* At most MAX_FEEDS channels a game (a network game is on dozens of local stations): your team's own
       channel, your Favorites and groups and event channels first, then by number.  Yours are all kept. */
    var mineK = {}, per = {};
    if (Library.customGroups) Library.customGroups().forEach(function (g) { g.items.forEach(function (k) { mineK[k] = 1; }); });
    var rank = function (g) { return whose[g.c.k] ? 0 : mineK[g.c.k] ? 1 : g.p.ev ? 2 : 3; };
    if (!one) {
      out.sort(function (a, b) { return rank(a) - rank(b) || a.c.num - b.c.num; });
      out = out.filter(function (g) { per[g.gk] = (per[g.gk] || 0) + 1; return rank(g) <= 1 || per[g.gk] <= MAX_FEEDS; });
    }
    out.sort(function (a, b) {
      var an = first[a.gk] <= now, bn = first[b.gk] <= now;
      return (an === bn ? 0 : an ? -1 : 1) || first[a.gk] - first[b.gk] || (a.gk < b.gk ? -1 : a.gk > b.gk ? 1 : 0) || rank(a) - rank(b) || a.c.num - b.c.num;
    });
    return out;
  }

  var MAX_FEEDS = 8;
  var SPORTY = /\b(nfl|nba|nhl|mlb|wnba|mls|football|basketball|hockey|baseball|soccer)\b/i;
  // Not the game: placeholders ("not found yet"), and the shows around it.
  // Guide placeholders, never a programme to be reminded of (the helper's remind.js has the same list).
  var PLACEHOLDER = /^\s*next (?:game|event|match)\b|not found|no (?:future |upcoming |more |scheduled )?(?:games?|events?|matches)\b|not scheduled|nothing scheduled/i;
  function placeholder(t) { return PLACEHOLDER.test(t || ''); }
  var NOGAME = /not found|no (?:future |upcoming |more |scheduled )?(?:games?|events?|matches)\b|not scheduled|nothing scheduled|off ?air|to be (?:announced|determined)|\btb[ad]\b|^\s*next game|\b(?:pre|post)[- ]?game\b|\bhighlights\b|\brecap\b|\bcountdown\b|\bgame ?day\b|\bpreview\b|\bfantasy\b|\bnfl sunday\b|\binside the\b|\bshow\b|\bpodcast\b|\btalk\b|\bpress conference\b/i;

  /* Is this a game?  Two teams of one league named, and not a placeholder or a show around the game.  For
     reminders set by an earlier TiviBro, which put team channels' "Future events for Detroit Tigers not
     found yet" and "Next game: ..." blocks on the reminder list (watch.js tidy()). */
  function isGame(title, ctx) {
    if (!title || NOGAME.test(title)) return false;
    var by = {};
    named(title, ctx || '', ALL, true).forEach(function (x) { by[x.league] = (by[x.league] || 0) + 1; });
    for (var k in by) if (by[k] >= 2) return true;
    return false;
  }

  /* Descriptions: looked through in the background (Epg.findDesc, the helper for a big guide), every few
     minutes or when the followed teams change; the group is drawn again when they arrive. */
  var desc = { key: '', at: 0, list: [], busy: false };
  function descHits(words) {
    var key = words.join('|');
    if (!desc.busy && (desc.key !== key || Date.now() - desc.at > 240000) && typeof Epg.findDesc === 'function') {
      desc.busy = true;
      Epg.findDesc(words, 1500).then(function (l) {
        var changed = desc.key !== key || l.length !== desc.list.length;
        desc = { key: key, at: Date.now(), list: l, busy: false };
        if (changed) { dirty(); if (typeof Views !== 'undefined' && Views.refreshLists) Views.refreshLists(true); }
      }, function () { desc.busy = false; desc.at = Date.now(); });
    }
    return desc.key === key ? desc.list : [];
  }

  /* The My teams group: games on now at the top, then the games starting within the hours set (Games
     starting within), soonest first; a game's channels together.  Nothing else, so a team with no game
     soon isn't there.  Kept a few minutes. */
  var listCache = null;
  /* When the guide (re)loads, look again: right after TiviBro starts, the group is first worked out before
     a big guide has arrived from the helper, and would otherwise keep only the event channels for minutes. */
  var hooked = false;
  function hook() {
    if (hooked || typeof Epg === 'undefined' || !Epg.onUpdate) return;
    hooked = true;
    Epg.onUpdate(function (k) {
      if (k || !groupOn()) return;
      dirty();
      if (typeof Views !== 'undefined' && Views.refreshLists) Views.refreshLists(true);
    });
  }
  function list() {
    hook();
    if (!groupOn()) return [];
    var now = Date.now();
    if (listCache && now - listCache.at < 60000 && listCache.of === Library.data.channels) return listCache.list;
    var out = [], have = {};
    games().forEach(function (g) { if (!have[g.c.k]) { have[g.c.k] = 1; out.push(g.c); } });
    listCache = { at: now, of: Library.data.channels, list: out };
    return out;
  }
  function dirty() { listCache = null; desc.at = 0; }       // descriptions looked at again (the guide may have changed)

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
    isGame: isGame, placeholder: placeholder, follows: follows, followed: followed, follow: follow, groupOn: groupOn, remindOn: remindOn, games: games, list: list, dirty: dirty
  };
})();
