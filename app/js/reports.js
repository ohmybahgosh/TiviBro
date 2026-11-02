/* Your problem reports: what happened to them.
   A report sent from the TV (or from the web editor) becomes a GitHub issue opened by the report relay,
   so whoever sent it gets no GitHub notifications.  The TV keeps the number and the relay's key for each,
   and asks the relay now and then (GET /status, relay/worker.js) whether the developer has answered.  A
   new reply, or the report being closed, shows once: what the developer said, Update when the fix is in
   a newer version, Still happening (a comment with a fresh log, which reopens a closed report) and a code
   to read the whole thread on a phone.  Settings > Diagnostics > Your problem reports lists them all.
   Nothing but the issue numbers leaves the TV when it asks. */
var Reports = (function () {
  var KEY = 'tivibro.reports', MAX = 20, EVERY = 6 * 3600e3, FIRST = 90e3, KEEP_CLOSED = 60 * 86400e3;
  var list = load(), queue = [], showing = false, timer = null;

  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function find(n) { n = +n; for (var i = 0; i < list.length; i++) if (list[i].n === n) return list[i]; return null; }
  function relay() {
    return fetch((Store.settings.relayConfig || 'https://tivibro.app/relay.json'), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('report service not found'); return r.json(); })
      .then(function (c) { var u = String(c && c.url || ''); if (!/^https:\/\//.test(u) && !/^http:\/\/127\.0\.0\.1/.test(u)) throw new Error('report service not available'); return u.replace(/\/report$/, ''); });
  }

  // A report the relay opened: { number, url, key } from the relay, and what it was about.
  function add(j, title) {
    if (!j || !j.number) return;
    var r = find(j.number) || { n: +j.number, seen: {} };
    r.url = j.url || r.url; r.key = j.key || r.key; r.title = String(title || r.title || '').slice(0, 120);
    r.sent = r.sent || Date.now(); r.version = r.version || TIVIBRO_VERSION;
    if (list.indexOf(r) < 0) list.unshift(r);
    list = list.slice(0, MAX);
    save();
    Log.info('reports', 'Following report #' + r.n + ': the TV will say when the developer answers');
  }

  /* Ask the relay about the reports still worth asking about: open ones, and closed ones for a while
     (a closed report can still get a reply or be reopened). */
  function check(force) {
    var want = list.filter(function (r) { return !r.gone && (r.state !== 'closed' || Date.now() - (r.closedAt || 0) < KEEP_CLOSED); });
    if (!want.length) return Promise.resolve(list);
    var last = +(localStorage.getItem(KEY + '.checked') || 0);
    if (!force && Date.now() - last < EVERY) return Promise.resolve(list);
    try { localStorage.setItem(KEY + '.checked', String(Date.now())); } catch (e) {}
    return relay().then(function (base) {
      return fetch(base + '/status?n=' + want.map(function (r) { return r.n; }).join(','), { cache: 'no-store' });
    }).then(function (x) { return x.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error(j && j.error || 'no answer');
      j.issues.forEach(function (i) {
        var r = find(i.n); if (!r || i.error) return;
        if (i.gone) { r.gone = true; return; }
        if (i.state === 'closed' && r.state !== 'closed') r.closedAt = Date.now();
        r.state = i.state; r.reason = i.reason || ''; r.url = i.url || r.url; r.title = i.title || r.title;
        r.reply = i.reply || null; r.fixed = i.fixed || ''; r.checked = Date.now();
        if (news(r) && queue.indexOf(r.n) < 0) queue.push(r.n);
      });
      save();
      if (queue.length) Log.info('reports', 'News on report' + (queue.length > 1 ? 's' : '') + ' #' + queue.join(', #'));
      next();
      return list;
    }).catch(function (e) { Log.warn('reports', 'Could not ask about the reports: ' + (e && e.message || e)); return list; });
  }
  // Something the viewer hasn't seen: a newer reply, or the report closed since they last looked.
  function news(r) { return !!((r.reply && r.reply.id !== r.seen.reply) || (r.state === 'closed' && r.seen.state !== 'closed')); }

  /* One at a time, and never on top of something: not over a menu, and not while watching fullscreen
     (a short note then, and the full story once they're back in the guide). */
  function next() {
    if (showing || !queue.length) return;
    if (typeof UI !== 'undefined' && UI.modalOpen) return setTimeout(next, 5000);
    var r = find(queue[0]);
    if (!r) { queue.shift(); return next(); }
    if (typeof Views !== 'undefined' && Views.full) {
      if (!r.noted) { r.noted = true; U.toast('Your problem report #' + r.n + ' has ' + (r.reply ? 'a reply from the developer' : 'been closed') + '.  It shows when you leave fullscreen.', 8000); }
      return setTimeout(next, 30000);
    }
    queue.shift();
    show(r.n);
  }

  function statusText(r) {
    var cur = (window.Update && Update.current) || TIVIBRO_VERSION, behind = r.fixed && Update._test.compare(r.fixed, cur) > 0;
    if (r.gone) return 'No longer on GitHub';
    if (r.state === 'closed') return (r.reason === 'not_planned' ? 'Closed, not planned' : r.fixed ? 'Fixed in ' + r.fixed : 'Closed as fixed') + (behind ? '  (you have ' + cur + ')' : '');
    if (r.reply) return 'The developer replied' + (r.fixed ? ', fix in ' + r.fixed : '') + (behind ? '  (you have ' + cur + ')' : '');
    return r.checked ? 'Open, no reply yet' : 'Sent, not checked yet';
  }
  function when(t) { var d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

  // The story of one report, with what can be done about it.
  function show(n) {
    var r = find(n); if (!r) return;
    showing = true;
    r.seen = { reply: r.reply ? r.reply.id : r.seen.reply, state: r.state }; r.noted = false; save();
    var cur = (window.Update && Update.current) || TIVIBRO_VERSION, behind = r.fixed && Update._test.compare(r.fixed, cur) > 0;
    var body = U.el('div', 'rep-box'), txt = U.el('div', 'rep-txt'), qr = U.el('div', 'rep-qr');
    txt.appendChild(U.el('div', 'rep-state', statusText(r)));
    if (r.title) txt.appendChild(U.el('div', 'rep-title', r.title));
    if (r.reply) {
      txt.appendChild(U.el('div', 'remote-l', 'The developer wrote' + (r.reply.at ? ' on ' + when(r.reply.at) : '')));
      txt.appendChild(U.el('div', 'rep-reply', r.reply.text.length > 700 ? r.reply.text.slice(0, 690).replace(/\s+\S*$/, '') + '…' : r.reply.text));
    } else if (r.state === 'closed') txt.appendChild(U.el('div', 'rep-reply', 'The report was closed without a note.'));
    body.appendChild(txt);
    if (r.url) {
      try { var q = qrcode(0, 'M'); q.addData(r.url); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); qr.appendChild(U.el('div', 'remote-s', 'Scan to read it all')); body.appendChild(qr); } catch (e) {}
    }
    var buttons = [];
    if (behind) buttons.push({ label: 'Update to ' + r.fixed, action: function () { showing = false; update(); } });
    buttons.push({ label: 'Still happening', action: function () { showing = false; still(r); } });
    buttons.push({ label: 'OK', action: function () { showing = false; setTimeout(next, 1500); } });
    UI.panel('Your problem report #' + r.n, body, buttons, function () { showing = false; setTimeout(next, 1500); });
  }

  // Update: straight to installing on a rooted TV, or to Settings > Updates and about otherwise.
  function update() {
    U.toast('Looking for the update…', 3000);
    Update.installer().then(function () { return Update.check(true); }).then(function (st) {
      if (st.state === 'available' && st.installer === 'hbchannel') return UI.confirm('Install TiviBro ' + st.latest.version + '?', 'Install and restart', function () { Update.install().catch(function (e) { U.toast(e.message, 6000); }); });
      Views.switchTab('settings'); Settings.section('updates');
      if (st.state !== 'available') U.toast('No newer version found yet.  It may still be on its way.', 6000);
    });
  }

  // Still happening: with the log as it is now, and a note if they want to type one.
  function still(r) {
    if (!r.key) { U.toast('This report can only be followed up on GitHub: scan the code on the report.', 7000); return; }
    var cur = (window.Update && Update.current) || TIVIBRO_VERSION, behind = r.fixed && Update._test.compare(r.fixed, cur) > 0;
    UI.menu('Tell the developer it still happens?', [
      { label: 'Send with the log', sub: (behind ? 'You have ' + cur + '; the fix is in ' + r.fixed + '.  ' : '') + 'The log goes too, with logins and server names taken out.', action: function () { send(r, ''); } },
      { label: 'Add a note first', sub: 'What you were doing, or what is different now', action: function () {
        UI.prompt('What happens now?', '', function (v) { send(r, v); }, 'A sentence is plenty.  The log goes with it.');
      } },
      { label: 'Cancel', current: true }
    ]);
  }
  function send(r, note) {
    U.toast('Sending…', 3000);
    Diag.followup(r.n, r.key, note || 'It still happens on ' + TIVIBRO_VERSION + '.').then(function (j) {
      r.followed = Date.now(); if (j.reopened) r.state = 'open'; save();
      U.toast('Sent, thank you.  The developer sees it on report #' + r.n + (j.reopened ? ', which is open again' : '') + '.', 7000);
    }, function (e) { U.toast('It could not be sent (' + ((e && e.message) || 'no connection') + ').  Scan the code on the report to answer on GitHub.', 9000); });
  }

  // At start (after the guide has settled) and every few hours while TiviBro stays open.
  function start() {
    if (timer) return;
    setTimeout(function () { check(false); }, FIRST);
    timer = setInterval(function () { check(false); }, EVERY);
  }

  return { add: add, check: check, show: show, start: start, statusText: statusText, when: when,
    get list() { return list; }, _test: { news: news, reset: function () { list = []; queue = []; showing = false; save(); try { localStorage.removeItem(KEY + '.checked'); } catch (e) {} }, load: function () { list = load(); return list; } } };
})();
