/* Search across channel names and every programme the guide has loaded, now and to come.
   find() is shared with the watchlist (watch.js). */
var Search = (function () {
  'use strict';
  var $ = U.$, L = Library;
  var input, vl, chipBox, zone = 'input', built = false, filter = 'all';
  var FILTERS = [['all', 'Everything'], ['now', 'On now'], ['later', 'Coming up'], ['replay', 'Replays'], ['channels', 'Channels'], ['movies', 'Movies & Shows']];

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Whole words for the watchlist ("Cars" is not "Oscars"), anywhere for typed searches.
  function matcher(q, word) {
    q = String(q || '').trim().toLowerCase();
    if (!word) return function (t) { return t.toLowerCase().indexOf(q) >= 0; };
    var rx = new RegExp('(^|[^a-z0-9À-￿])' + esc(q) + '($|[^a-z0-9À-￿])', 'i');
    return function (t) { return rx.test(t); };
  }
  function visible(c) {
    var E = Store.edits;
    if (Store.settings.showHidden) return true;
    return !E.hiddenChannels[c.k] && !E.hiddenGroups[c.g];
  }

  /* Programmes whose title matches q: [{ c, p }], one per programme even when several channels
     carry it (the HD and SD copies share a start time; East and West do not), on now first, then
     soonest first, then replays newest first.  opts: word, from, to (ms), limit. */
  function find(q, opts) {
    opts = opts || {};
    var test = matcher(q, opts.word), now = Date.now(), out = [], seen = {};
    var all = L.data.channels, byEpg = {};
    if (Epg.xml) for (var i = 0; i < all.length; i++) { var id = Epg.epgId(all[i]); if (id && !byEpg[id]) byEpg[id] = all[i]; }
    function take(c, p) {
      if (!c || !visible(c) || !p.t) return;
      if (p.e <= now && !c.arch) return;          // past without catch-up is not watchable
      if (opts.from && p.s < opts.from) return;
      if (opts.to && p.s > opts.to) return;
      var key = p.t.toLowerCase() + '|' + p.s, had = seen[key];
      if (had) { if (L.isFav(c.k) && !L.isFav(had.c.k)) had.c = c; return; }    // a Favorite carries it best
      seen[key] = { c: c, p: p };
      out.push(seen[key]);
    }
    Epg.search(test, 4000).forEach(function (r) {
      var c = L.find(r.key) || byEpg[r.key];
      take(c, r.p);
    });
    // Event channels (pay-per-view, league passes): the event in the channel name is the programme.
    if (Events.groupOn()) L.channels(L.EVENTS).forEach(function (c) {
      var ev = Events.of(c);
      if (ev && test(ev.title)) take(c, { s: ev.start, e: ev.end, t: ev.title, ev: 1 });
    });
    var rank = function (x) { return x.p.s <= now && x.p.e > now ? 0 : x.p.s > now ? 1 : 2; };
    out.sort(function (a, b) { var d = rank(a) - rank(b); return d || (rank(a) === 2 ? b.p.s - a.p.s : a.p.s - b.p.s); });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /* What the provider's own channel name says beyond the name TiviBro shows: the game or show that
     providers write into names ("BIG10 10: Michigan vs Ohio State 12:00 PM").  Empty when the raw
     name only adds a country, a quality tag or a number. */
  var TAGS = /^(us|usa|uk|ca|au|de|fr|es|it|hd|fhd|uhd|sd|4k|hevc|h265|raw|live|backup|east|west|ppv|vip|plus|tv|the|and)$/;
  function extra(c) {
    if (!c || !c.n) return '';
    var shown = {}, raw = String(c.n);
    L.name(c).toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) { if (w) shown[w] = 1; });
    var more = raw.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && !shown[w] && !TAGS.test(w) && !/^\d+$/.test(w); });
    if (!more.length) return '';
    var m = /\s*[:|\u2013\u2014]\s*(.{3,})$|\s+-\s+(.{3,})$/.exec(raw);
    return (m ? m[1] || m[2] : raw).replace(/\s+/g, ' ').trim();
  }

  function hasReminder(c, p) { return Store.edits.reminders.some(function (x) { return x.k === c.k && x.s === p.s; }); }

  function render(row, it) {
    if (!row._n) {
      row._img = U.el('img', 'logo'); row._img.onerror = function () { if (!Net.retryImage(this)) this.style.visibility = 'hidden'; };
      var box = U.el('div', 'txt'); row._n = U.el('span', 'name'); row._s = U.el('span', 'sub');
      box.appendChild(row._n); box.appendChild(row._s);
      row._t = U.el('span', 'tag');
      row.appendChild(row._img); row.appendChild(box); row.appendChild(row._t);
    }
    if (it.hist) { row._img.style.visibility = 'hidden'; row._n.textContent = it.hist; row._s.textContent = 'Recent search'; row._t.textContent = ''; return; }
    if (it.v) {
      var v = it.v, img = v.cover || '';
      row._img.style.visibility = img ? 'visible' : 'hidden';
      if (img && row._img.getAttribute('src') !== img) row._img.src = img;
      row._n.textContent = v.name;
      var rt = Math.round(parseFloat(v.rating) * 10) / 10;
      row._s.textContent = [v.year, rt > 0 ? '★ ' + rt : '', v.q].filter(Boolean).join('   ');
      row._t.textContent = it.vkind === 'series' ? 'show' : 'movie';
      return;
    }
    var c = it.c, lg = c.logo || Epg.icon(Epg.epgId(c));
    row._img.style.visibility = lg ? 'visible' : 'hidden';
    if (lg && row._img.getAttribute('src') !== lg) row._img.src = lg;
    if (it.raw) {
      row._n.textContent = it.raw;
      row._s.textContent = L.name(c) + '   ' + L.groupName(c.g);
      row._t.textContent = 'in the name';
    } else if (it.p) {
      var now = Date.now(), p = it.p;
      row._n.textContent = p.t;
      row._s.textContent = U.day(p.s) + ' ' + U.hhmm(p.s) + '   ' + L.name(c) + (it.inDesc ? '   ·   ' + it.inDesc : '');
      row._t.textContent = p.s <= now && p.e > now ? 'on now' : p.e <= now ? 'replay' : hasReminder(c, p) ? 'reminder set' : 'upcoming';
    } else {
      row._n.textContent = L.name(c);
      row._s.textContent = L.groupName(c.g);
      row._t.textContent = 'channel';
    }
  }

  function build() {
    var v = $('viewSearch');
    v.innerHTML = '';
    var wrap = U.el('div', 'search-wrap');
    input = U.el('input', 'search-input');
    input.type = 'text'; input.placeholder = 'Channel, movie, show, team or name'; input.spellcheck = false;
    wrap.appendChild(input);
    chipBox = U.el('div', 'search-chips');
    FILTERS.forEach(function (f) {
      var b = U.el('span', 'schip', f[1]); b.setAttribute('data-f', f[0]);
      b.addEventListener('click', function () { zone = 'chips'; setFilter(f[0]); paint(); });
      chipBox.appendChild(b);
    });
    wrap.appendChild(chipBox);
    var list = U.el('div', 'vlist search-list');
    wrap.appendChild(list);
    v.appendChild(wrap);
    vl = new VList(list, { render: render, empty: 'Type a channel, movie or show name.', visible: 9,
      onHover: function () { if (zone !== 'list') { zone = 'list'; paint(); } }, onClick: function () { UI.press('ok'); } });
    input.addEventListener('input', U.debounce(run, 300));
    built = true;
  }

  function history() {
    var h = Store.settings.searchHistory || [];
    vl.empty = 'Type a channel, movie or show name.';
    vl.setItems(h.map(function (x) { return { hist: x }; }), 0);
  }

  function setFilter(f) { filter = f; paintChips(); if (input.value.trim().length >= 2) run(); }

  /* How well a title matches what was typed: 0 the whole title (a year or 4K after it doesn't count),
     1 it starts with it, 2 a word starts with it, 3 somewhere inside. */
  function quality(name, q, word) {
    var n = String(name || '').toLowerCase().trim(), at = n.indexOf(q);
    if (at < 0) return -1;
    var core = n.replace(/(\s*(\(\d{4}\)|\[\d{4}\]|\d{4}|4k|uhd|hd))+\s*$/, '').replace(/^(the|a|an)\s+/, '');
    if (core === q || n === q) return 0;
    if (at === 0 || core.indexOf(q) === 0) return 1;
    return word.test(n) ? 2 : 3;
  }
  /* Everything, ranked by how well each title matches, then by what you most likely want: something on
     now, a movie or show you can start, a channel, something coming up, a channel whose provider name
     carries it, a replay.  So "batman" shows Batman films before "24/7 Batman" channels, and "CNN"
     still shows the channel first. */
  var TYPE = { now: 0, vod: 1, channel: 2, later: 3, inname: 4, replay: 5 };
  function run() {
    var q = input.value.trim().toLowerCase();
    if (q.length < 2) return history();
    var now = Date.now(), word = new RegExp('(^|[^a-z0-9À-￿])' + esc(q), 'i'), cand = [], n = 0;
    function add(item, title, type, sub) {
      var m = quality(title, q, word);
      if (m < 0) m = 3;                         // matched on the provider's name or a cleaned word: weakest
      cand.push({ it: item, m: m, t: TYPE[type], sub: sub || 0, i: n++ });
    }
    /* Channels by the name shown, then channels whose provider name carries what you typed (a game in
       "BIG10 10: Michigan vs Ohio State"): those show that text, and its time when the name has one,
       so it is clear why they matched. */
    var seenEv = {}, nCh = 0, nIn = 0;
    if (filter === 'all' || filter === 'channels') {
      var all = L.data.channels;
      for (var i = 0; i < all.length && nCh + nIn < 300; i++) {
        var c = all[i];
        if (Store.edits.hiddenChannels[c.k] && !Store.settings.showHidden) continue;
        var nm = L.name(c);
        if (nm.toLowerCase().indexOf(q) >= 0) { if (nCh < 150) { nCh++; add({ c: c }, nm, 'channel'); } continue; }
        if (c.n.toLowerCase().indexOf(q) < 0) continue;
        var ev = Events.of(c), x = extra(c);
        nIn++;
        if (ev && ev.title && ev.start) {
          seenEv[ev.title.toLowerCase() + '|' + ev.start] = 1;
          add({ c: c, p: { s: ev.start, e: ev.end, t: ev.title, ev: 1 } }, ev.title, ev.start <= now && ev.end > now ? 'now' : 'inname', ev.start);
        } else add({ c: c, raw: x || c.n }, x || c.n, 'inname');
      }
    }
    if (filter !== 'channels' && filter !== 'movies') {
      find(q).slice(0, 300).forEach(function (r) {
        if (r.p.ev && seenEv[r.p.t.toLowerCase() + '|' + r.p.s]) return;
        var p = r.p, on = p.s <= now && p.e > now;
        if (filter === 'now' && !on) return;
        if (filter === 'later' && p.s <= now) return;
        if (filter === 'replay' && p.e > now) return;
        add(r, p.t, on ? 'now' : p.s > now ? 'later' : 'replay', p.e <= now ? -p.s : p.s);
      });
    }
    if (filter === 'all' || filter === 'movies') {
      var vs = [];
      Vod.allItems().forEach(function (x) {
        var t = x.it.name || '', m = quality(t, q, word);
        if (m >= 0) vs.push({ x: x, m: m, len: t.length });
      });
      // The best 200: closest match, then the shortest title (the film itself before its sequels and specials).
      vs.sort(function (a, b) { return a.m - b.m || a.len - b.len; });
      vs.slice(0, 200).forEach(function (v) { add({ v: v.x.it, vkind: v.x.kind }, v.x.it.name, 'vod', v.len); });
    }
    cand.sort(function (a, b) { return a.m - b.m || a.t - b.t || a.sub - b.sub || a.i - b.i; });
    var out = cand.slice(0, 400).map(function (x) { return x.it; });
    var vst = Vod.searchState;
    vl.empty = filter === 'channels' ? 'No channel has that name.' :
      filter === 'movies' ? (vst === 'loading' ? 'Loading your movies and shows…' : vst === 'none' ? 'This provider has no movies or shows.' : 'No movie or show has that name.') :
      'Nothing found.  Programmes are searchable once the guide has loaded them' + (Epg.xml ? '.' : ' (add an XMLTV guide in Settings > Playlists to search every channel).');
    vl.setItems(out, 0);
    if (zone === 'list' && !out.length) { zone = 'chips'; paint(); }
    if (filter !== 'channels' && filter !== 'movies') inDescriptions(q, out);
  }
  /* Then programmes that have it only in their description (a local station's "NFL Football" says
     "Minnesota Vikings at Detroit Lions" there).  Found a moment later, and added after the rest. */
  var descGen = 0;
  function inDescriptions(q, shown) {
    var gen = ++descGen, now = Date.now();
    Epg.findDesc([q], 300).then(function (res) {
      if (gen !== descGen || input.value.trim().toLowerCase() !== q) return;
      var seen = {}, more = [], all = L.data.channels, byEpg = {};
      shown.forEach(function (it) { if (it.p) seen[it.p.t.toLowerCase() + '|' + it.p.s] = 1; });
      if (Epg.xml) for (var i = 0; i < all.length; i++) { var id = Epg.epgId(all[i]); if (id && !byEpg[id]) byEpg[id] = all[i]; }
      res.forEach(function (r) {
        var c = L.find(r.key) || byEpg[r.key], p = r.p;
        if (!c || !visible(c) || !p.t) return;
        if (p.e <= now && !c.arch) return;
        var on = p.s <= now && p.e > now;
        if (filter === 'now' && !on) return;
        if (filter === 'later' && p.s <= now) return;
        if (filter === 'replay' && p.e > now) return;
        var k = p.t.toLowerCase() + '|' + p.s;
        if (seen[k]) return;
        seen[k] = 1;
        more.push({ c: c, p: p, d: r.d, on: on });
      });
      if (!more.length) return;
      // On now first, then the next ones, then replays (newest first).
      var rank = function (x) { return x.on ? 0 : x.p.s > now ? 1 : 2; };
      more.sort(function (a, b) { return rank(a) - rank(b) || (rank(a) === 2 ? b.p.s - a.p.s : a.p.s - b.p.s); });
      var keep = vl.sel;
      vl.setItems(shown.concat(more.slice(0, 150).map(function (x) { return { c: x.c, p: x.p, inDesc: snippet(x.d, q) }; })), Math.max(0, keep));
      if (zone === 'chips' && !shown.length) paint();
    });
  }
  // The words around the match: "...Minnesota Vikings at Detroit Lions in a key..."
  function snippet(d, q) {
    d = String(d || '').replace(/\s+/g, ' ');
    var i = d.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return d.slice(0, 70);
    var a = Math.max(0, i - 30), b = Math.min(d.length, i + q.length + 40);
    return (a > 0 ? '…' : '') + d.slice(a, b).trim() + (b < d.length ? '…' : '');
  }

  function remember(q) {
    if (!q) return;
    var h = (Store.settings.searchHistory || []).filter(function (x) { return x !== q; });
    h.unshift(q);
    Store.settings.searchHistory = h.slice(0, 10);
    Store.saveSettings();
  }

  function activate(it) {
    if (it.hist) { input.value = it.hist; run(); return; }
    remember(input.value.trim());
    if (it.v) { Vod.openItem({ it: it.v, kind: it.vkind }); return; }
    var c = it.c, p = it.p, now = Date.now();
    if (!p || (p.s <= now && p.e > now)) { Views.startChannel(c, false, Views.goFull); return; }
    if (p.e <= now) { Views.playCatchup(c, p, 0); return; }
    var r = Store.edits.reminders, i = r.findIndex(function (x) { return x.k === c.k && x.s === p.s; });
    if (i < 0) { r.push({ k: c.k, s: p.s, e: p.e, t: p.t }); U.toast('Reminder set for ' + U.day(p.s).toLowerCase() + ' ' + U.hhmm(p.s)); }
    else { r.splice(i, 1); U.toast('Reminder cancelled'); }
    Store.saveEdits();
    vl.refresh(); hints();
  }

  function addWatch() {
    var q = input.value.trim();
    if (q.length < 2) { U.toast('Type a show, team or name first'); return; }
    remember(q);
    Watch.add(q);
  }

  function paintChips() {
    if (!chipBox) return;
    Array.prototype.forEach.call(chipBox.children, function (b) {
      var on = b.getAttribute('data-f') === filter;
      b.classList.toggle('on', on);
      b.classList.toggle('focus', zone === 'chips' && on);
    });
  }
  function paint() {
    vl.setActive(zone === 'list'); input.classList.toggle('focus', zone === 'input');
    paintChips();
    if (zone === 'input') input.focus(); else input.blur();
    hints();
  }
  function hints() {
    var it = zone === 'list' && vl.current(), now = Date.now(), ok = 'OK  type';
    if (zone === 'chips') ok = '◀ ▶  what to show';
    else if (it && it.hist) ok = 'OK  search again';
    else if (it && it.p && it.p.s > now) ok = hasReminder(it.c, it.p) ? 'OK  cancel the reminder' : 'OK  remind me';
    else if (it && it.p && it.p.e <= now) ok = 'OK  replay';
    else if (it) ok = 'OK  watch';
    var h = [['', ok], ['yellow', 'Add to watchlist']];
    if (it && it.c) h.push(['', 'Hold OK  channel options']);
    UI.hints(h);
  }
  function cycle(d) {
    var i = FILTERS.findIndex(function (f) { return f[0] === filter; });
    setFilter(FILTERS[(i + d + FILTERS.length) % FILTERS.length][0]);
  }

  function keys(a) {
    if (a === 'yellow') { addWatch(); return true; }
    if (zone === 'input') {
      if (a === 'down' || a === 'submit') { zone = 'chips'; paint(); }
      else if (a === 'up') { input.blur(); Views.tabBar(function () { UI.setHandler(keys); zone = 'input'; paint(); }); }
      else if (a === 'ok') input.focus();
      else if (a === 'back') Views.tabBar(function () { UI.setHandler(keys); zone = 'input'; paint(); });
      return true;
    }
    if (zone === 'chips') {
      if (a === 'left') cycle(-1);
      else if (a === 'right') cycle(1);
      else if (a === 'down' || a === 'ok') { if (vl.items.length) { zone = 'list'; paint(); } }
      else if (a === 'up' || a === 'back') { zone = 'input'; paint(); }
      return true;
    }
    if (a === 'up') { if (!vl.move(-1)) { zone = 'chips'; paint(); } else hints(); }
    else if (a === 'down') { vl.move(1); hints(); }
    else if (a === 'chup') { vl.page(-1); hints(); }
    else if (a === 'chdown') { vl.page(1); hints(); }
    else if (a === 'ok') { var it = vl.current(); if (it) activate(it); }
    else if (a === 'red' || a === 'hold') { var x = vl.current(); if (x && x.c) Views.chanMenu(x.c, Views.group); }
    else if (a === 'back') { zone = 'chips'; paint(); }
    return true;
  }

  // q: open with this search already typed (the watchlist's "Show in search").
  function open(q) {
    if (!built) build();
    zone = 'input';
    UI.setHandler(keys);
    if (typeof q === 'string') { input.value = q; filter = 'later'; zone = 'list'; }
    if (!input.value) history(); else run();
    if (zone === 'list' && !vl.items.length) zone = 'chips';
    paint();
    // Movies and shows load in the background; results update when they arrive.
    Vod.prepare().then(function (got) { if (got && input.value.trim().length >= 2) run(); });
  }

  // Text typed on the phone: searches everything for it.
  function query(q) { open(); input.value = String(q || ''); filter = 'all'; paintChips(); run(); zone = vl.items.length ? 'list' : 'input'; paint(); }

  return { open: open, query: query, find: find, matcher: matcher, extra: extra };
})();
