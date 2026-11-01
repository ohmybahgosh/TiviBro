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
        if (!reminded(r.c, r.p)) { Store.edits.reminders.push({ k: r.c.k, s: r.p.s, e: r.p.e, t: r.p.t, w: r.w }); pending[r.w] = (pending[r.w] || 0) + 1; }
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

  function start() {
    clearInterval(timer);
    timer = setInterval(function () { scan(false); }, 10 * 60000);
    // A guide that just loaded is the best moment to look.
    var soon = U.debounce(function () { if (Date.now() - lastScan > 60000) scan(false); }, 8000);
    Epg.onUpdate(function (k) { if (!k) soon(); });
  }

  return { list: list, add: add, remove: remove, has: has, upcoming: upcoming, scan: scan, start: start };
})();
