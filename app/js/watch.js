/* Watchlist: words and names to look for in the guide ("Yankees", "Bluey", "Gordon Ramsay").
   Every few minutes, and whenever the guide loads, programmes coming up in the next hours whose
   title has one of them as a whole word get a reminder (or just a message, Settings > Guide,
   start screen, reminders > Watchlist).  Each programme is handled once: a reminder you cancel
   does not come back.  Lives in the playlist's edits, so a backup and the web editor carry it. */
var Watch = (function () {
  'use strict';
  var L = Library, timer = 0, lastScan = 0, PER_WORD = 5;

  function list() { var e = Store.edits; if (!Array.isArray(e.watchlist)) e.watchlist = []; return e.watchlist; }
  function seen() { var e = Store.edits; if (!e.watchSeen || typeof e.watchSeen !== 'object') e.watchSeen = {}; return e.watchSeen; }
  function ahead() { return (+Store.settings.watchAhead || 24) * 3600e3; }
  function norm(q) { return String(q || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function has(q) { q = norm(q).toLowerCase(); return list().some(function (w) { return w.q.toLowerCase() === q; }); }

  // What is coming up for one word, or for all of them: [{ c, p, w }], soonest first.
  function upcoming(q) {
    var now = Date.now(), words = q ? [{ q: q }] : list(), out = [], dup = {};
    words.forEach(function (w) {
      Search.find(w.q, { word: true, from: now, to: now + ahead() }).forEach(function (r) {
        var k = r.p.t.toLowerCase() + '|' + r.p.s;
        if (dup[k]) return;
        dup[k] = 1; r.w = w.q; out.push(r);
      });
    });
    // Games of the teams you follow (Settings > Groups, sorting, hidden > My teams), when their reminders are on.
    if (!q && typeof Teams !== 'undefined' && Teams.remindOn()) Teams.games(ahead(), true).forEach(function (g) {
      if (g.p.s <= now) return;
      var k = g.p.t.toLowerCase() + '|' + g.p.s;
      if (dup[k]) return;
      dup[k] = 1; out.push({ c: g.c, p: g.p, w: 'team:' + g.team.id });
    });
    out.sort(function (a, b) { return a.p.s - b.p.s; });
    return out;
  }

  function reminded(c, p) { return Store.edits.reminders.some(function (x) { return (x.k === c.k || x.t === p.t) && x.s === p.s; }); }

  // Look now.  quiet: no message (the first look after adding a word says its own thing).
  function scan(quiet) {
    tidy();
    var teams = typeof Teams !== 'undefined' && Teams.remindOn();
    if ((!list().length && !teams) || !L.data.channels.length) return [];
    lastScan = Date.now();
    var s = seen(), now = Date.now(), found = [], remind = Store.settings.watchAction !== 'tell';
    Object.keys(s).forEach(function (k) { if (s[k] < now) delete s[k]; });
    // A word that matches a lot ("News") never floods the TV: at most PER_WORD of its reminders wait at
    // a time; the next ones are set as those go by.
    var pending = {};
    Store.edits.reminders.forEach(function (x) { if (x.w && x.s > now) pending[x.w] = (pending[x.w] || 0) + 1; });
    upcoming().forEach(function (r) {
      var k = r.p.t.toLowerCase() + '|' + r.p.s;
      if (s[k] || !Parental.blockedOk(r.c)) return;
      if (remind) {
        if ((pending[r.w] || 0) >= PER_WORD) return;
        if (!reminded(r.c, r.p)) { Store.edits.reminders.push(mark({ k: r.c.k, s: r.p.s, e: r.p.e, t: r.p.t, w: r.w })); pending[r.w] = (pending[r.w] || 0) + 1; }
      } else if (found.length >= PER_WORD * 2) return;
      s[k] = r.p.e;
      found.push(r);
    });
    Store.saveEdits();
    if (found.length) {
      Log.info('watch', 'Watchlist found ' + found.length + ' programme(s)');
      if (!quiet) {
        var f = found[0], what = '"' + f.p.t + '" ' + U.day(f.p.s).toLowerCase() + ' ' + U.hhmm(f.p.s) + ' on ' + L.name(f.c);
        U.toast('Watchlist: ' + what + (found.length > 1 ? ', and ' + (found.length - 1) + ' more' : '') + (remind ? '.  Reminder' + (found.length > 1 ? 's' : '') + ' set.' : '.'), 7000);
      }
    }
    return found;
  }

  function add(q) {
    q = norm(q);
    if (q.length < 2) return false;
    if (has(q)) { U.toast('"' + q + '" is already on your watchlist'); return false; }
    list().push({ q: q, at: Date.now() });
    Store.saveEdits();
    scan(true);
    var n = upcoming(q).length, h = +Store.settings.watchAhead || 24, tell = Store.settings.watchAction === 'tell';
    U.toast('Added "' + q + '" to your watchlist.  ' + (!n ? 'Nothing in the next ' + h + ' hours yet; TiviBro keeps looking.' :
      n + ' coming up in the next ' + h + ' hours' + (tell ? '.' : n > PER_WORD ? '; reminders set for the next ' + PER_WORD + ', and more as those go by.' : ', reminders set.')), 6000);
    return true;
  }
  function remove(q) {
    var l = list(), i = l.findIndex(function (w) { return w.q === q; });
    if (i < 0) return;
    l.splice(i, 1);
    // Reminders it set for programmes still to come go with it.
    Store.edits.reminders = Store.edits.reminders.filter(function (r) { return r.w !== q; });
    Store.saveEdits();
  }

  /* Team reminders that aren't games: an earlier TiviBro (alpha 45 to 48) set reminders for team
     channels' placeholders ("Future events for Detroit Tigers not found yet", "No future events scheduled")
     and their "Next game: ..." blocks.  Those go, here and on the helper, at every start and look. */
  // A team reminder set now was checked as a game (Teams.games): say so, so tidy() never doubts it.
  function mark(r) { if (/^team:/.test(r.w || '')) r.g = 1; return r; }
  // Not worth a reminder: a guide placeholder, or a team reminder that isn't a game.  Started or not:
  // one that began while TiviBro was closed would otherwise come up the moment it opens.
  function doubtful(r) {
    if (typeof Teams === 'undefined' || !Teams.isGame) return false;
    if (Teams.placeholder(r.t)) return true;
    if (!/^team:/.test(r.w || '') || r.g) return false;          // g: checked as a game when it was set
    var c = L.find(r.k);
    return !Teams.isGame(r.t, c ? c.n : '');
  }
  function tidy() {
    if (typeof Teams === 'undefined' || !Teams.isGame) return 0;
    var rem = Store.edits.reminders, keep = rem.filter(function (r) { return !doubtful(r); });
    var gone = rem.length - keep.length;
    if (!gone) return 0;
    Store.edits.reminders = keep;
    Store.saveEdits();
    Log.info('watch', 'Removed ' + gone + ' reminder(s) that were not programmes or games');
    if (typeof Remind !== 'undefined' && Remind.sync) Remind.sync(true);
    return gone;
  }

  function start() {
    tidy();
    clearInterval(timer);
    timer = setInterval(function () { scan(false); }, 10 * 60000);
    // A guide that just loaded is the best moment to look.
    var soon = U.debounce(function () { if (Date.now() - lastScan > 60000) scan(false); }, 8000);
    Epg.onUpdate(function (k) { if (!k) soon(); });
  }

  return { tidy: tidy, doubtful: doubtful, list: list, add: add, remove: remove, has: has, upcoming: upcoming, scan: scan, start: start };
})();
