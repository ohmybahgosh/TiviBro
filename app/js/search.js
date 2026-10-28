/* Search across channel names and every programme the guide has loaded. */
var Search = (function () {
  'use strict';
  var $ = U.$, L = Library;
  var input, vl, zone = 'input', built = false;

  function render(row, it) {
    if (!row._n) {
      row._img = U.el('img', 'logo'); row._img.onerror = function () { if (!Net.retryImage(this)) this.style.visibility = 'hidden'; };
      var box = U.el('div', 'txt'); row._n = U.el('span', 'name'); row._s = U.el('span', 'sub');
      box.appendChild(row._n); box.appendChild(row._s);
      row._t = U.el('span', 'tag');
      row.appendChild(row._img); row.appendChild(box); row.appendChild(row._t);
    }
    if (it.hist) { row._img.style.visibility = 'hidden'; row._n.textContent = it.hist; row._s.textContent = 'Recent search'; row._t.textContent = ''; return; }
    var c = it.c, lg = c.logo || Epg.icon(Epg.epgId(c));
    row._img.style.visibility = lg ? 'visible' : 'hidden';
    if (lg && row._img.getAttribute('src') !== lg) row._img.src = lg;
    if (it.p) {
      var now = Date.now(), p = it.p;
      row._n.textContent = p.t;
      row._s.textContent = new Date(p.s).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + U.hhmm(p.s) + '   ' + L.name(c);
      row._t.textContent = p.s <= now && p.e > now ? 'on now' : p.e <= now ? (c.arch ? 'replay' : 'ended') : 'upcoming';
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
    input.type = 'text'; input.placeholder = 'Channel or programme'; input.spellcheck = false;
    wrap.appendChild(input);
    var list = U.el('div', 'vlist search-list');
    wrap.appendChild(list);
    v.appendChild(wrap);
    vl = new VList(list, { render: render, empty: 'Type a channel or programme name.', visible: 10,
      onHover: function () { if (zone !== 'list') { zone = 'list'; paint(); } }, onClick: function () { UI.press('ok'); } });
    input.addEventListener('input', U.debounce(run, 300));
    built = true;
  }

  function history() {
    var h = Store.settings.searchHistory || [];
    vl.empty = 'Type a channel or programme name.';
    vl.setItems(h.map(function (x) { return { hist: x }; }), 0);
  }

  function run() {
    var q = input.value.trim().toLowerCase();
    if (q.length < 2) return history();
    var out = [], seen = {};
    var all = L.data.channels, E = Store.edits;
    for (var i = 0; i < all.length && out.length < 150; i++) {
      var c = all[i];
      if (E.hiddenChannels[c.k] && !Store.settings.showHidden) continue;
      if (L.name(c).toLowerCase().indexOf(q) >= 0 || c.n.toLowerCase().indexOf(q) >= 0) { out.push({ c: c }); seen[c.k] = 1; }
    }
    // Programmes: map guide keys back to channels (XMLTV ids can be shared by several channels).
    var byEpg = {};
    if (Epg.xml) all.forEach(function (c) { var id = Epg.epgId(c); if (id && !byEpg[id]) byEpg[id] = c; });
    var progs = Epg.search(q, 120), now = Date.now();
    progs.forEach(function (r) {
      var c = L.find(r.key) || byEpg[r.key];
      if (!c || (E.hiddenChannels[c.k] && !Store.settings.showHidden)) return;
      if (r.p.e <= now && !c.arch) return;          // past without catch-up is not watchable
      out.push({ c: c, p: r.p });
    });
    // On now first, then upcoming, then replays.
    out.sort(function (a, b) {
      var rank = function (x) { if (!x.p) return 0; if (x.p.s <= now && x.p.e > now) return 1; if (x.p.s > now) return 2; return 3; };
      var d = rank(a) - rank(b);
      return d || (a.p && b.p ? (rank(a) === 3 ? b.p.s - a.p.s : a.p.s - b.p.s) : 0);
    });
    vl.empty = 'Nothing found.  Programmes are searchable once the guide has loaded them.';
    vl.setItems(out, 0);
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
    var c = it.c, p = it.p, now = Date.now();
    if (!p || (p.s <= now && p.e > now)) { Views.startChannel(c, false, Views.goFull); return; }
    if (p.e <= now) { Views.playCatchup(c, p, 0); return; }
    var r = Store.edits.reminders;
    if (!r.some(function (x) { return x.k === c.k && x.s === p.s; })) { r.push({ k: c.k, s: p.s, e: p.e, t: p.t }); Store.saveEdits(); U.toast('Reminder set for ' + U.hhmm(p.s)); }
    else U.toast('Reminder already set');
  }

  function paint() { vl.setActive(zone === 'list'); input.classList.toggle('focus', zone === 'input'); if (zone === 'input') input.focus(); else input.blur(); }

  function keys(a) {
    if (zone === 'input') {
      if (a === 'down' || a === 'submit') { if (vl.items.length) { zone = 'list'; paint(); } }
      else if (a === 'up') { input.blur(); Views.tabBar(function () { UI.setHandler(keys); zone = 'input'; paint(); }); }
      else if (a === 'ok') input.focus();
      else if (a === 'back') Views.tabBar(function () { UI.setHandler(keys); zone = 'input'; paint(); });
      return true;
    }
    if (a === 'up') { if (!vl.move(-1)) { zone = 'input'; paint(); } }
    else if (a === 'down') vl.move(1);
    else if (a === 'chup') vl.page(-1);
    else if (a === 'chdown') vl.page(1);
    else if (a === 'ok') { var it = vl.current(); if (it) activate(it); }
    else if (a === 'red' || a === 'hold') { var x = vl.current(); if (x && x.c) Views.chanMenu(x.c, Views.group); }
    else if (a === 'back') { zone = 'input'; paint(); }
    return true;
  }

  function open() {
    if (!built) build();
    zone = 'input';
    UI.setHandler(keys);
    UI.hints([['', 'OK  type, watch, replay or remind'], ['', 'Down  results'], ['', 'Hold OK  channel options']]);
    if (!input.value) history(); else run();
    paint();
  }

  return { open: open };
})();
