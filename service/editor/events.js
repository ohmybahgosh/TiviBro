/* Event channels: pay-per-view, league passes and one-off games, where the provider puts the whole
   listing in the channel name instead of the guide:
     "NCAAB 001 | NORTH FLORIDA @ CHARLESTON SOUTHERN (M) | 12.18 11:00 AM | ESPN+"
     "PPV 03 | UFC | Makhachev v Machado Garry | Sat 15th Aug 2:00AM UK/9:00PM ET"
     "NBA: Kings vs Pelicans @ Oct 29 7:30 PM :Nbc Sports  04"
   parse() reads such a name into a short channel name ("NCAAB 001"), the matchup, extra details
   and a start time, so the channel list can show a short name and the guide can show the event
   at its time (programmes() makes guide entries when the guide has nothing for the channel).
   Times that carry a zone (ET, EDT, PT, UK, CET...) use it; the others are read in the playlist's
   event time zone (Settings > Playlists > the playlist > Event channels), by default the
   provider's own.  Daylight saving rules are built in, so old TVs without time zone data work. */
var Events = (function () {
  'use strict';

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  var DOW = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?';
  var ZONE = '\\b(ET|EDT|EST|CT|CDT|CST|MT|MDT|MST|PT|PDT|PST|UK|GMT|BST|CET|CEST|UTC)\\b';
  var ZONES = { ET: 'ET', EDT: 'ET', EST: 'ET', CT: 'CT', CDT: 'CT', CST: 'CT', MT: 'MT', MDT: 'MT', MST: 'MT', PT: 'PT', PDT: 'PT', PST: 'PT',
    UK: 'UK', GMT: 'UK', BST: 'UK', CET: 'CET', CEST: 'CET', UTC: 'UTC' };
  var US_STD = { ET: -5, CT: -6, MT: -7, PT: -8 };

  /* ---------- time zones without Intl ---------- */
  function nthSunday(y, m, n) { var d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + (7 - d) % 7 + 7 * (n - 1); }
  function lastSunday(y, m) { var last = new Date(Date.UTC(y, m + 1, 0)); return last.getUTCDate() - last.getUTCDay(); }
  function euSummer(utc) {
    var y = new Date(utc).getUTCFullYear();
    return utc >= Date.UTC(y, 2, lastSunday(y, 2), 1) && utc < Date.UTC(y, 9, lastSunday(y, 9), 1);
  }
  // Wall-clock time in a zone to a timestamp.
  function toTime(y, mo, d, h, mi, zone) {
    var wall = Date.UTC(y, mo, d, h, mi);
    if (US_STD[zone] != null) {
      var summer = wall >= Date.UTC(y, 2, nthSunday(y, 2, 2), 2) && wall < Date.UTC(y, 10, nthSunday(y, 10, 1), 2);
      return wall - (US_STD[zone] + (summer ? 1 : 0)) * 3600e3;
    }
    if (zone === 'UK') return euSummer(wall - 3600e3) ? wall - 3600e3 : wall;
    if (zone === 'CET') return euSummer(wall - 7200e3) ? wall - 7200e3 : wall - 3600e3;
    if (zone === 'UTC') return wall;
    return new Date(y, mo, d, h, mi).getTime();                       // this TV's own time
  }
  // A provider's IANA zone ("America/Toronto") to one of ours; anything else is read as the TV's time.
  function zoneOfIana(tz) {
    tz = String(tz || '');
    if (/^America\/(New_York|Toronto|Detroit|Montreal|Nassau|Iqaluit|Kentucky|Indiana\/(Indianapolis|Vincennes|Petersburg|Winamac|Marengo|Vevay)|Indianapolis|Louisville)|^US\/(Eastern|Michigan)|^EST5EDT/.test(tz)) return 'ET';
    if (/^America\/(Chicago|Winnipeg|Menominee|Indiana\/(Knox|Tell_City)|North_Dakota|Rainy_River|Rankin_Inlet|Resolute|Matamoros)|^US\/Central|^CST6CDT/.test(tz)) return 'CT';
    if (/^America\/(Denver|Edmonton|Boise|Cambridge_Bay|Yellowknife|Inuvik|Ojinaga|Ciudad_Juarez)|^US\/Mountain|^MST7MDT/.test(tz)) return 'MT';
    if (/^America\/(Los_Angeles|Vancouver|Tijuana)|^US\/Pacific|^PST8PDT/.test(tz)) return 'PT';
    if (/^Europe\/(London|Dublin|Lisbon|Belfast|Guernsey|Isle_of_Man|Jersey)|^Atlantic\/(Canary|Faroe|Madeira)|^GB/.test(tz)) return 'UK';
    if (/^Europe\//.test(tz)) return 'CET';
    if (/^(UTC|Etc\/(UTC|GMT|UCT)|GMT|UCT|Zulu)$/.test(tz)) return 'UTC';
    return 'local';
  }
  var providerTz = '';
  function setProviderTz(tz) { providerTz = tz || ''; memo.clear(); }
  function cfg() { var p = (typeof Store !== 'undefined' && Store.playlist) || {}; return p.events || {}; }
  function defaultZone() { var z = cfg().tz || 'auto'; return z === 'auto' ? zoneOfIana(providerTz) : z; }

  /* ---------- reading a name ---------- */
  function clean(s) {
    return String(s || '').replace(/[\u2066-\u2069\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
      .replace(/[\u24B6-\u24FF\u2122\u00AE\u2605\u2606\u25C9\u25CF]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([:,;!?])(?=\s|$)/g, '$1').trim();
  }
  function hour24(h, ap) {
    h = +h;
    if (!ap || h > 12) return h;
    ap = ap.charAt(0).toLowerCase();
    if (ap === 'a') return h === 12 ? 0 : h;
    return h === 12 ? 12 : h + 12;
  }
  // The year that puts month/day closest to now (an event listed in December for January, say).
  function nearestYear(mo, d, now) {
    var y = new Date(now).getFullYear(), best = y, gap = Infinity;
    [y - 1, y, y + 1].forEach(function (yy) { var g = Math.abs(Date.UTC(yy, mo, d) - now); if (g < gap) { gap = g; best = yy; } });
    return best;
  }

  function findDate(s, preferDM) {
    var m, re;
    // 2026-02-08 10:40:00
    if ((m = /\b(20\d\d)-(\d\d)-(\d\d)[ T](\d{1,2}):(\d\d)(?::\d\d)?/.exec(s))) return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5], i: m.index, len: m[0].length, timeToo: true };
    // Sat 15th Aug 2026 / 31 October 2026 / 7 Sep
    re = new RegExp('\\b' + DOW + '(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON + '(?:,?\\s+(20\\d\\d))?\\b', 'i');
    if ((m = re.exec(s))) return { y: m[3] ? +m[3] : 0, mo: MONTHS[m[2].slice(0, 3).toLowerCase()], d: +m[1], i: m.index, len: m[0].length };
    // Oct 29 / Thu Oct 29 / Aug 28 2026 / Feb. 8
    re = new RegExp('\\b' + DOW + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d\\d)\\b)?', 'i');
    if ((m = re.exec(s))) return { y: m[3] ? +m[3] : 0, mo: MONTHS[m[1].slice(0, 3).toLowerCase()], d: +m[2], i: m.index, len: m[0].length };
    // 12.18 (month.day) right before a time
    if ((m = /\b(\d{1,2})\.(\d{1,2})\b(?=\s+\d{1,2}(?::\d\d)?\s*[ap]\.?m)/i.exec(s)) && +m[1] <= 12 && +m[2] <= 31) return { y: 0, mo: +m[1] - 1, d: +m[2], i: m.index, len: m[0].length };
    // 14/08, [07/26], 29/03/2026: day first unless it can't be
    if ((m = /\[?\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b\]?/.exec(s)) && !/24\/7/.test(m[0])) {
      var a = +m[1], b = +m[2], dm = a > 12 || (b <= 12 && preferDM);
      if (b > 12) dm = false;
      var mo = (dm ? b : a) - 1, d = dm ? a : b, y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : 0;
      if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) return { y: y, mo: mo, d: d, i: m.index, len: m[0].length };
    }
    // Fri 4th (no month): the next such day
    if ((m = /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(s))) return { y: 0, mo: -1, d: +m[1], i: m.index, len: m[0].length };
    return null;
  }
  // Times need a colon or am/pm, so channel numbers never count; "17:45 pm" is read as 17:45.
  function findTimes(s) {
    var out = [], re = /\b(\d{1,2})(?::(\d\d))?(?::\d\d)?\s*([ap]\.?m\.?)?(?![\w:])/gi, m;
    while ((m = re.exec(s))) {
      if (m[2] == null && !m[3]) continue;
      var h = +m[1], mi = m[2] != null ? +m[2] : 0;
      if (h > 23 || mi > 59 || (m[3] && h > 12 && h < 13)) continue;
      if (m[2] == null && h > 12) continue;
      if (/^[.\/]/.test(s.charAt(m.index + m[0].length)) || /[.\/]$/.test(s.charAt(m.index - 1))) continue;   // 96.7, 24/7
      out.push({ h: hour24(h, m[3]), mi: mi, ap: !!m[3], i: m.index, len: m[0].length });
    }
    return out;
  }

  var SOCCER = /\b(fc|afc|cf|united|city|epl|efl|spfl|uefa|mls|liga|laliga|serie a|bundesliga|ligue|soccer|football event|copa|premier league|championship|rovers|wanderers|athletic|sporting|real|inter)\b/i;
  var RACING = /\b(racing|raceway|speedway|motocross|nascar|imca|dirtcar|f1|formula|grand prix|motor)\b/i;
  function lengthOf(text) {
    if (/\bprelims?\b/i.test(text)) return 2 * 3600e3;
    if (RACING.test(text)) return 4 * 3600e3;
    if (SOCCER.test(text)) return 2.25 * 3600e3;
    return 3 * 3600e3;
  }

  var memo = new Map();
  var QUICK = /\d:\d\d|\d\s?[ap]\.?m\b/i;                 // no time in the name: not an event, cheaply
  function parse(raw, now) {
    if (!raw || !QUICK.test(raw)) return null;
    now = now || Date.now();
    var key = raw + '|' + defaultZone() + '|' + Math.floor(now / 3600e3);
    var hit = memo.get(key);
    if (hit !== undefined) return hit;
    var r = read(raw, now);
    if (memo.size > 20000) memo.clear();
    memo.set(key, r);
    return r;
  }

  function read(raw, now) {
    var s = clean(raw);
    if (s.length < 8) return null;
    var dt = s, cut = [];                                     // spans of s to drop from the title
    // "// UK Sun 7 Sep 4:30pm // ET Sun 7 Sep 11:30am": read the ET part, drop both
    var dual = /\s*\/\/\s*ET\s+([^/]+)/i.exec(s);
    if (dual) {
      dt = dual[1];
      var first = s.indexOf('//');
      cut.push([first, s.length]);
    }
    // "2:00AM UK/9:00PM ET": the ET one
    var ukEt = /(\d{1,2}(?::\d\d)?\s*[ap]m)\s*UK\s*\/\s*(\d{1,2}(?::\d\d)?\s*[ap]m)\s*ET\b/i.exec(dt);
    if (ukEt) dt = dt.slice(0, ukEt.index) + ukEt[2] + ' ET' + dt.slice(ukEt.index + ukEt[0].length);

    var times = findTimes(dt);
    var date = findDate(dt, times.some(function (t) { return !t.ap; }));
    if (date && date.timeToo) times = [{ h: date.h, mi: date.mi, i: date.i, len: date.len }];
    if (!times.length) return null;
    // The time next to the date, or the first one.
    var t = times[0];
    if (date) times.forEach(function (x) { if (Math.abs(x.i - (date.i + date.len)) < Math.abs(t.i - (date.i + date.len))) t = x; });
    var zm = new RegExp(ZONE).exec(dt.slice(t.i + t.len, t.i + t.len + 6)) || (dual ? ['ET', 'ET'] : null);
    var zone = zm ? ZONES[zm[1].toUpperCase()] : defaultZone();

    // Is it an event at all?  A date, a matchup, or an event or PPV word, or "WORD 12 |" in front.
    var matchup = /\s(vs\.?|v|@|at)\s/i.test(s);
    if (!date && !matchup && !/\b(ppv|events?|live|prelims?|main card|fight|ufc|boxing|wwe|aew|race|grand prix)\b/i.test(s) && !/^[A-Za-z][A-Za-z+ ]{1,20}\s?\d{1,3}\s*[:|]/.test(s)) return null;

    // Start time
    var start;
    if (date && date.mo >= 0) {
      var y = date.y || nearestYear(date.mo, date.d, now);
      start = toTime(y, date.mo, date.d, t.h, t.mi, zone);
      if (!date.y && start - now > 200 * 86400e3) start = toTime(y - 1, date.mo, date.d, t.h, t.mi, zone);
    } else {
      // No month: today (or the given day of the month) in that zone, whichever is nearest to now.
      // The first one that has not been over for long: a name with only a time means today's event.
      var base = new Date(now), best = null;
      for (var k = -1; k <= 1; k++) {
        var dd = new Date(base.getFullYear(), base.getMonth() + (date ? k : 0), date ? date.d : base.getDate() + k);
        var c = toTime(dd.getFullYear(), dd.getMonth(), dd.getDate(), t.h, t.mi, zone);
        if (c > now - 6 * 3600e3 && (best === null || c < best)) best = c;
      }
      start = best;
    }
    if (!isFinite(start)) return null;

    // The title: what is left once the time, date, zone and channel tags are taken out.
    var body = dual ? s.slice(0, s.indexOf('//')) : dt, spans = [];
    if (!dual) {
      var ti = t.i, tj = t.i + t.len;
      var zt = new RegExp('^\\s*' + ZONE).exec(body.slice(tj));
      if (zt) tj += zt[0].length;
      var between = /[A-Za-z]\s*$/.test(body.slice(0, ti)) && /^\s*[A-Za-z]/.test(body.slice(tj)) && !matchup && !(date && Math.abs(date.i + date.len - ti) < 3);
      if (!(date && date.timeToo)) spans.push([ti, tj, between ? ' vs ' : ' | ']);
      if (date) spans.push([date.i, date.i + date.len, ' | ']);
      spans.sort(function (x, y) { return y[0] - x[0]; });
      spans.forEach(function (sp) {
        var i0 = sp[0];
        var back = /(\s[@\-–]|\s)\s*$/.exec(body.slice(0, i0));                 // "... @ Oct 29", "... - Thu Oct 29"
        if (back && sp[2] !== ' vs ') i0 -= back[0].length;
        body = body.slice(0, i0) + sp[2] + body.slice(sp[1]);
      });
    }
    var network = '', short = '';
    // ":ESPN+  20" at the end: the channel is "ESPN+ 20"
    var net = /\s:\s?([A-Za-z][\w+&.' ]{1,24}?)\s+(\d{1,3})\s*$/.exec(body);
    if (net) { network = net[1].trim(); short = network + ' ' + net[2]; body = body.slice(0, net.index); }
    body = body.replace(/[(\[][\s|]*[)\]]/g, ' ');
    // Segments: "NCAAB 001 | NORTH FLORIDA @ ... (M) | ESPN+"
    var segs = body.split(/\s+\|\s+|\s*\|\s*|\s+\/\/\s+/).map(function (x) { return x.replace(/^[\s:\-–—,@]+|[\s:\-–—,@]+$/g, ''); }).filter(Boolean);
    if (!segs.length) return null;
    // A short channel tag in front: "PPV 03", "NCAAB 001", "BigTen 01", "Football Event 01", "EFL01", "US (Peacock 020)"
    var LEAD = /^((?:[A-Z]{2,3}\s)?\(?[A-Za-z][A-Za-z+.&' ]{0,22}?\s?\d{1,3}\)?)\s*[:\-–]\s+(.+)$/;
    var lead = LEAD.exec(segs[0]);
    // "CA | CFL 02: ..." or "DAZN CA | Event 16: ...": a country or service tag, then the real channel tag
    if (!short && !lead && segs.length > 1 && segs[0].length <= 12 && !/\s(vs\.?|v|@|at)\s/i.test(segs[0])) {
      var l2 = LEAD.exec(segs[1]) || /^(Event\s+\d{1,3})\s+(.+)$/i.exec(segs[1]);
      if (l2) { short = (/^[A-Z]{2,3}$/.test(segs[0]) ? '' : segs[0] + ' ') + l2[1]; segs.splice(0, 2, l2[2]); }
    }
    if (!short) {
      if (/^(?:[A-Z]{2,3}\s)?\(?[A-Za-z][A-Za-z+.&' ]{0,22}?\s?\d{1,3}\)?$/.test(segs[0]) && segs.length > 1) short = segs.shift();
      else if (lead) { short = lead[1]; segs[0] = lead[2]; }
      else if (/^[A-Z][A-Z0-9+]{1,8}$/.test(segs[0]) && segs.length > 1) short = segs.shift();
    }
    var inner = /\(([^)]*\d[^)]*)\)/.exec(short);                         // "US (Peacock 020)" -> "Peacock 020"
    short = (inner ? inner[1] : short).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
    // "UEFA | 01 - Ararat vs AZ": the number belongs to the tag
    var numLead = /^(\d{1,3})\s*[-–:]\s+(.+)$/.exec(segs[0] || '');
    if (short && !/\d/.test(short) && numLead) { short += ' ' + numLead[1]; segs[0] = numLead[2]; }
    var evLead = /^(Event\s+\d{1,3})\s*:?\s+(.+)$/i.exec(segs[0] || '');
    if (!short && evLead && segs.length > 1) { short = evLead[1]; segs[0] = evLead[2]; }
    // The matchup is the main title; the rest are details.
    var mi = -1;
    for (var j = 0; j < segs.length; j++) if (/\s(vs\.?|v|@|at)\s/i.test(' ' + segs[j] + ' ')) { mi = j; break; }
    if (mi < 0) { mi = 0; for (j = 1; j < segs.length; j++) if (segs[j].length > segs[mi].length) mi = j; }
    var title = segs[mi].replace(/\s+/g, ' ').replace(/\s(VS\.?|Vs\.?)\s/g, ' vs ').trim();
    // "UFC | Early Prelims": the short tag in front belongs to the title
    if (mi > 0 && !/\s(vs\.?|v|@|at)\s/i.test(' ' + title + ' ') && segs[mi - 1].length <= 12 && segs[mi - 1] !== short) { title = segs[mi - 1] + ': ' + title; segs.splice(mi - 1, 1); mi--; }
    var ev2 = !short && /^(Event\s+\d{1,3})\s*:?\s+(.+)$/i.exec(title);
    if (ev2) { short = ev2[1]; title = ev2[2]; }
    var details = segs.filter(function (x, i) { return i !== mi && x !== short; });
    if (network && details.indexOf(network) < 0) details.push(network);
    if (!title || title.length < 3) return null;
    var len = lengthOf(s);
    return { short: short, title: title, details: details, start: start, end: start + len, zone: zone, raw: raw };
  }

  /* ---------- guide entries ---------- */
  var DAY_S = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "7:30 PM" today, "Sat 7:30 PM" this week, "Dec 18, 11:00 AM" further out (spelled out here, as old TVs lack the locale data).
  function when(t, now) {
    var d = new Date(t), n = new Date(now || Date.now());
    var day = d.toDateString() === n.toDateString() ? '' :
      Math.abs(t - n.getTime()) < 6 * 86400e3 ? DAY_S[d.getDay()] + ' ' : MON_S[d.getMonth()] + ' ' + d.getDate() + ', ';
    return day + (typeof U !== 'undefined' ? U.hhmm(t) : d.toTimeString().slice(0, 5));
  }
  // Before the start: "Starts 7:30 PM: Kings vs Pelicans"; the event itself; a while after: "Ended: ...".
  function programmes(ev) {
    var info = (ev.details.length ? ev.details.join(' · ') + '.  ' : '') + 'Channel name: ' + ev.raw;
    return [
      { s: Math.min(ev.start - 3 * 86400e3, Date.now() - 12 * 3600e3), e: ev.start, t: 'Starts ' + when(ev.start) + ': ' + ev.title, d: info, up: 1 },
      { s: ev.start, e: ev.end, t: ev.title, d: info, ev: 1 },
      // Ended: stays in the guide while the provider keeps the old name, so it never looks like a live event.
      { s: ev.end, e: Math.max(ev.end + 6 * 3600e3, Date.now() + 7 * 86400e3), t: 'Ended ' + when(ev.end) + ': ' + ev.title, d: info, ended: 1 }
    ];
  }

  /* Team channels whose guide only says "Next game: Chicago Blackhawks at Boston Bruins at 10/31/2026
     01:00 PM EDT", in long overlapping blocks.  games() turns those into what is true: "Next game Sat 1:00 PM:
     Blackhawks at Bruins" until the game, the game itself at its time, and nothing about a game that is over.
     Other programmes are kept as they are (the same objects, so descriptions loaded later still reach them). */
  var NEXT = /^\s*next game:?\s*(.+?)\s+(?:at|on)\s+(\d{1,2})\/(\d{1,2})\/(20\d\d)\s+(\d{1,2}):(\d\d)\s*([ap]\.?m\.?)?\s*(?:\(([^)]*)\)|([A-Za-z]{2,4})\b)?/i;
  function nextGame(t) {
    var m = NEXT.exec(t || '');
    if (!m) return null;
    var zone = m[9] && ZONES[m[9].toUpperCase()] ? ZONES[m[9].toUpperCase()] : m[8] ? zoneOfIana(m[8]) : defaultZone();
    if (zone === 'local' && m[8]) zone = defaultZone();
    var start = toTime(+m[4], +m[2] - 1, +m[3], hour24(m[5], m[7]), +m[6], zone);
    return isFinite(start) ? { title: m[1].replace(/\s+/g, ' ').trim(), start: start } : null;
  }
  function games(list) {
    if (!list || !list.length) return list;
    var any = false, i;
    for (i = 0; i < list.length && !any; i++) if (/^\s*next game/i.test(list[i].t || '')) any = true;
    if (!any) return list;
    var now = Date.now(), seen = {}, gl = [], real = [], from = Infinity, to = 0;
    list.forEach(function (p) {
      if (!/^\s*next game/i.test(p.t || '')) { real.push(p); return; }
      from = Math.min(from, p.s); to = Math.max(to, p.e);
      var g = nextGame(p.t);
      if (g && !seen[g.title + '@' + g.start]) { seen[g.title + '@' + g.start] = 1; gl.push(g); }
    });
    gl.sort(function (a, b) { return a.start - b.start; });
    // The game itself, where the guide doesn't already have a programme at that time.
    gl.forEach(function (g) {
      var covered = real.some(function (p) { return p.s <= g.start + 15 * 60e3 && p.e > g.start; });
      if (!covered) real.push({ s: g.start, e: g.start + lengthOf(g.title), t: g.title, d: 'The game, from this channel\'s guide.', ev: 1 });
    });
    real.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    // Overlapping blocks (the provider's run over one another): a later one starts when the earlier ends.
    var out = [];
    real.forEach(function (p) {
      var prev = out[out.length - 1];
      if (prev && p.t === prev.t && p.s <= prev.e) {                  // the same game in two blocks: one
        if (p.e > prev.e) out[out.length - 1] = { s: prev.s, e: p.e, t: prev.t, d: prev.d || p.d, ev: prev.ev };
        return;
      }
      if (prev && p.s < prev.e) {
        if (p.e <= prev.e) return;
        p = { s: prev.e, e: p.e, t: p.t, d: p.d, ev: p.ev };
      }
      out.push(p);
    });
    // The gaps the "Next game" blocks covered: say which game comes next, and when.
    var filled = [], cur = from;
    function gap(a, b) {
      if (b - a < 60e3) return;
      var g = null;
      for (var k = 0; k < gl.length; k++) if (gl[k].start >= b - 60e3) { g = gl[k]; break; }
      if (g) filled.push({ s: a, e: b, t: 'Next game ' + when(g.start, now) + ': ' + g.title, d: 'From this channel\'s guide.', up: 1 });
    }
    out.forEach(function (p) {
      if (p.s > cur && cur < to) gap(cur, Math.min(p.s, Math.max(to, p.s)));
      filled.push(p);
      cur = Math.max(cur, p.e);
    });
    if (cur < to) gap(cur, to);
    return filled;
  }

  function on() { return cfg().on !== false; }
  function of(c) { return c && on() ? parse(c.n) : null; }
  /* An event that is long over: the provider never renamed the channel ("Peacock 001 | ... (2026-02-08
     03:00:00)" in November).  Six hours after its end, so a game that ran long still counts. */
  var ENDED_MS = 6 * 3600e3;
  function endedName(n, now) { now = now || Date.now(); var e = on() ? parse(n, now) : null; return !!(e && e.end + ENDED_MS < now); }

  return {
    parse: parse, of: of, programmes: programmes, games: games, nextGame: nextGame, ended: function (c, now) { return !!c && endedName(c.n, now); }, endedName: endedName, when: when, setProviderTz: setProviderTz, zoneOfIana: zoneOfIana, toTime: toTime,
    on: on, shortNames: function () { return on() && cfg().short !== false; }, groupOn: function () { return on() && cfg().group !== false; },
    zone: defaultZone, reset: function () { memo.clear(); },
    ZONE_CHOICES: ['auto', 'ET', 'CT', 'MT', 'PT', 'UK', 'CET', 'UTC', 'local'],
    ZONE_LABELS: ['The provider\'s time zone', 'US Eastern', 'US Central', 'US Mountain', 'US Pacific', 'UK', 'Central Europe', 'UTC', 'This TV\'s time']
  };
})();
