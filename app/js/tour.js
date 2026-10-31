/* First-run tour: right after a new playlist connects, TiviBro walks through tidying it up and
   choosing how it looks, one screen at a time, with the remote.  Every step shows what your own
   playlist has (how many countries, East and West copies, local cities, event channels...), so it
   only asks about what applies.  Nothing changes until the last screen; a restore point is saved
   first, so the web editor can undo it.  Run it again any time from Settings > Playlists and guide >
   the playlist > Set-up tour.
   Steps: welcome, countries, channel names, East and West, local channels, event channels, clutter,
   logos, look, and a summary with tips. */
var Tour = (function () {
  'use strict';
  var root = U.$('viewSetup');
  var st = null;

  function S() { return Store.settings; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function plural(n, a, b) { return fmt(n) + ' ' + (n === 1 ? a : (b || a + 's')); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cyc(list, cur, dir) { var i = list.indexOf(cur); if (i < 0) i = 0; return list[(i + dir + list.length) % list.length]; }

  /* ---------- rows (the same kinds the Settings screen uses) ---------- */
  function choice(label, sub, values, labels, get, set, swatch) {
    return { label: label, sub: sub, swatch: swatch, value: function () { var i = values.indexOf(get()); return i >= 0 ? labels[i] : String(get()); },
      cycle: function (d) { set(cyc(values, get(), d)); } };
  }
  function toggle(label, sub, get, set, on, off) { return { label: label, sub: sub, value: function () { return get() ? on || 'On' : off || 'Off'; }, cycle: function () { set(!get()); } }; }
  function action(label, sub, fn, value) { return { label: label, sub: sub, action: fn, value: value || function () { return ''; } }; }
  function head(t) { return { head: true, label: t }; }
  function info(label, value) { return { label: label, info: true, value: function () { return value || ''; } }; }
  // A short explanation under a choice (what hiding does, what stays a backup).
  function note(text) { var r = info(text, ''); r.note = true; return r; }
  function custom(el) { return { custom: true, el: el }; }

  /* ---------- what the playlist has ---------- */
  function survey() {
    var data = Library.data, t = Tidy.make(data), now = Date.now(), ev = 0, idle = 0, upcoming = [];
    data.channels.forEach(function (c) {
      if (Names.idle(c.n)) idle++;
      var e = Events.parse(c.n, now);
      if (e) { ev++; if (e.end > now && upcoming.length < 200) upcoming.push({ c: c, e: e }); }
    });
    upcoming.sort(function (a, b) { return a.e.start - b.e.start; });
    var fp = t.feeds(), li = t.locals(), cs = t.countries(), dv = t.dividers(), em = t.empty();
    var dupes = t.dupes({ prefer: 'fhd' }), extra = dupes.reduce(function (n, s) { return n + s.items.length - 1; }, 0);
    return { t: t, channels: data.channels.length, groups: data.groups.length, countries: cs, events: ev, upcoming: upcoming.slice(0, 4), idle: idle,
      feeds: fp, locals: li, dividers: dv, empty: em, dupeSets: dupes.length, dupeExtra: extra, logos: data.channels.filter(function (c) { return c.logo; }).length };
  }

  /* ---------- the plan: what Apply would hide ---------- */
  function plan() {
    var key = JSON.stringify(st.ch) + '|' + Object.keys(Store.edits.hiddenGroups).length + '|' + Object.keys(Store.edits.hiddenChannels).length;
    if (st.planned && st.planned.key === key) return st.planned.v;
    var v = makePlan();
    st.planned = { key: key, v: v };
    return v;
  }
  function makePlan() {
    var t = st.sv.t, data = Library.data, E = Store.edits, g = {}, c = {}, ch = st.ch;
    var listed = {}; st.sv.countries.forEach(function (x) { listed[x.p] = 1; });
    data.groups.forEach(function (gr) {
      var code = t.groupCountry(gr.id), keep = listed[code] ? ch.cc[code] !== false : ch.ccNone;
      if (!keep) g[gr.id] = 1;
    });
    if (ch.dividers) st.sv.dividers.forEach(function (gr) { g[gr.id] = 1; });
    if (ch.feed !== 'both') {
      var drop = ch.feed === 'east' ? 'west' : 'east';
      st.sv.feeds[drop].forEach(function (x) { c[x.k] = 1; });
      if (ch.feedGroups) t.feedGroups(drop).forEach(function (gr) { g[gr.id] = 1; });
    }
    var cityKeep = [];
    if (Object.keys(ch.cities).length) {
      t.localHide(ch.cities, ch.cityNone).forEach(function (x) { c[x.c.k] = 1; });
      // Your stations together in one group, and the network groups (ABC Locals, CBS Locals...) out of the way.
      if (ch.cityGroup) { cityKeep = t.localKeep(ch.cities, false).map(function (x) { return x.c.k; }); if (ch.cityHideNets) st.sv.locals.groups.forEach(function (gr) { g[gr.id] = 1; }); }
    }
    var words = ch.words.split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean);
    if (words.length) data.groups.forEach(function (gr) { var n = String(gr.name).toLowerCase(), cn = Names.cleanWith(ch.names, gr.name).toLowerCase(); if (words.some(function (w) { return n.indexOf(w) >= 0 || cn.indexOf(w) >= 0; })) g[gr.id] = 1; });
    if (ch.dupes !== 'off') {
      t.dupes({ prefer: ch.dupes, skip: function (x) { return E.hiddenGroups[x.g] || g[x.g] || E.hiddenChannels[x.k] || c[x.k]; } })
        .forEach(function (s) { s.items.forEach(function (x) { if (x.k !== s.keep) c[x.k] = 1; }); });
    }
    // Groups left with nothing to show.
    var shownIn = {};
    data.channels.forEach(function (x) { if (!E.hiddenChannels[x.k] && !c[x.k]) shownIn[x.g] = 1; });
    if (ch.empty) data.groups.forEach(function (gr) { if (!shownIn[gr.id]) g[gr.id] = 1; });
    // Channels with nothing on stay out of the lists while they say so (not hidden, so not counted as hidden).
    var chans = 0, groups = 0, gs = {}, idle = ch.names.hideIdle, fav = Library.isFav;
    data.groups.forEach(function (gr) { if (!E.hiddenGroups[gr.id] && !g[gr.id]) { gs[gr.id] = 1; groups++; } });
    data.channels.forEach(function (x) { if (gs[x.g] && !E.hiddenChannels[x.k] && !c[x.k] && !(idle && Names.idle(x.n) && !fav(x.k))) chans++; });
    if (cityKeep.length) { groups++; if (ch.cityHideNets) chans += cityKeep.length; }
    return { g: g, c: c, chans: chans, groups: groups, cityKeep: cityKeep, hidG: Object.keys(g).filter(function (id) { return !E.hiddenGroups[id]; }).length, hidC: Object.keys(c).filter(function (k) { return !E.hiddenChannels[k]; }).length };
  }

  /* ---------- steps ---------- */
  var STEPS = [
    { id: 'welcome', title: 'Welcome', rail: 'Welcome', rows: welcomeRows },
    { id: 'countries', title: 'Keep the countries you watch', rail: 'Countries', lead: 'Read from group names, the codes channels start with and the divider sections in the list.  Hide the ones you never watch.', when: function () { return st.sv.countries.length > 1; }, rows: countryRows },
    { id: 'names', title: 'Clean channel names', rail: 'Channel names', lead: 'Providers pack names with tags: "USA | ESPN FHD ◉".  TiviBro shows "ESPN" and leaves your playlist alone.', rows: nameRows },
    { id: 'feeds', title: 'East or West?', rail: 'East and West', lead: function () { return plural(st.sv.feeds.pairs, 'channel') + ' come twice, on East and on West (Pacific) time.  Keep the feed you watch.  Channels that only come in one feed are left alone.'; }, when: function () { return st.sv.feeds.pairs > 0; }, rows: feedRows },
    { id: 'locals', title: 'Your local channels', rail: 'Local channels', lead: function () { return 'Your provider carries ' + plural(st.sv.locals.chans.length, 'local station') + ' for ' + plural(st.sv.locals.cities.length, 'city', 'cities') + '.  Tick yours, or a few nearby: the other cities are hidden, and yours can go together in one Local channels group.  ◀ ▶ jump between letters.'; }, when: function () { return st.sv.locals.cities.length > 1; }, rows: localRows },
    { id: 'events', title: 'Sports and pay-per-view', rail: 'Sports and PPV', lead: function () { return 'Pay-per-view and sports passes put the game and its time in the channel name.  TiviBro reads it and builds the guide from it.  ' + plural(st.sv.events, 'event channel') + ' here.'; }, when: function () { return st.sv.events > 0; }, rows: eventRows },
    { id: 'clutter', title: 'Clear the clutter', rail: 'Clutter', lead: 'Everything hidden stays one click away: Settings > Groups, sorting, hidden, or hold OK on a channel.', rows: clutterRows },
    { id: 'logos', title: 'Channel logos', rail: 'Logos', lead: 'For channels with no logo, from two open projects, iptv-org and tv-logos, matched by guide id, name and country, and a local station\'s call sign.  TiviBro hosts no images: each logo loads from its project.', rows: logoRows },
    { id: 'guide', title: 'A guide for every channel', rail: 'Guide', lead: 'Channels your provider sends no guide for can get one from two free public guides, epg.pw and iptv-epg.org, matched by guide id, a local station\'s call sign or the name.  Your provider\'s guide always comes first.  TiviBro hosts nothing: the TV downloads the files from them.', rows: guideRows },
    { id: 'look', title: 'Make it yours', rail: 'Look and start', lead: 'Colours, text size and what TiviBro opens on.  Buffering, buttons and parental controls are in Settings.', rows: lookRows },
    { id: 'done', title: 'All set', rail: 'Summary', lead: 'Here is what Apply does.  Hidden never means deleted: everything stays one press away in Settings > Groups, sorting, hidden, and a restore point is saved first so the web editor can undo it all.', rows: doneRows }
  ];
  function steps() { return STEPS.filter(function (s) { return !s.when || s.when(); }); }

  function welcomeRows() {
    var sv = st.sv, out = [], p = Store.playlist, cards = U.el('div', 'tour-stats');
    function card(v, l) { var d = U.el('div', 'tour-stat'); d.appendChild(U.el('b', '', v)); d.appendChild(U.el('span', '', l)); cards.appendChild(d); }
    card(fmt(sv.channels), 'channels');
    card(fmt(sv.groups), 'groups');
    if (sv.countries.length) card(fmt(sv.countries.length), sv.countries.length === 1 ? 'country' : 'countries');
    if (sv.events) card(fmt(sv.events), 'event channels');
    if (sv.feeds.pairs) card(fmt(sv.feeds.pairs), 'channels in East + West');
    if (sv.locals.cities.length) card(fmt(sv.locals.cities.length), 'local cities');
    if (sv.dupeExtra) card(fmt(sv.dupeExtra), 'extra copies');
    if (p.vod && (p.vod.movies || p.vod.series)) card(p.vod.movies && p.vod.series ? 'Movies + Shows' : p.vod.movies ? 'Movies' : 'Shows', 'on demand');
    out.push(custom(cards));
    out.push(action('Tidy up here, step by step', 'About two minutes with the remote.  Nothing changes until the last screen.', function () { go(1); }, function () { return '›'; }));
    out.push(action('Tidy up on a phone or computer', 'Scan a code with your phone: Smart clean-up, renaming, sorting and backups with a real keyboard.', remote, function () { return '›'; }));
    out.push(action('Skip, start watching', 'Run this again any time: Settings > Playlists and guide > ' + (p.name || 'the playlist') + ' > Set-up tour.', function () { finish(false); }, function () { return ''; }));
    return out;
  }

  function countryRows() {
    var out = [], ch = st.ch;
    out.push(action('Keep every country', '', function () { st.sv.countries.forEach(function (x) { ch.cc[x.p] = true; }); ch.ccNone = true; draw(); }));
    out.push(action('Keep only ' + (st.sv.countries[0] ? st.sv.countries[0].name : ''), 'The biggest one in this playlist.', function () { st.sv.countries.forEach(function (x, i) { ch.cc[x.p] = i === 0; }); draw(); }));
    out.push(head('Countries and regions, biggest first'));
    st.sv.countries.forEach(function (x) {
      out.push(toggle(x.name, plural(x.chans, 'channel') + ' in ' + plural(x.groups.length, 'group'), function () { return ch.cc[x.p] !== false; }, function (v) { ch.cc[x.p] = v; draw(); }, 'Keep', 'Hide'));
    });
    out.push(head('Everything else'));
    out.push(toggle('Groups with no country', 'Sports, pay-per-view and event groups, 24/7 channels and the like.', function () { return ch.ccNone; }, function (v) { ch.ccNone = v; draw(); }, 'Keep', 'Hide'));
    out.push(note('Hidden groups leave the guide, All channels and Search, and nothing is deleted: bring any back in Settings > Groups, sorting, hidden.'));
    return out;
  }

  function preview() {
    var box = U.el('div', 'prev-table tour-prev'), sample = Library.sample(40);
    var changed = sample.filter(function (c) { return Names.cleanWith(st.ch.names, c.n) !== c.n; }).slice(0, 7);
    if (!changed.length) changed = sample.slice(0, 5);
    changed.forEach(function (c) {
      var r = U.el('div');
      r.appendChild(U.el('span', 'a', c.n));
      r.appendChild(U.el('span', 'b', Names.cleanWith(st.ch.names, c.n)));
      box.appendChild(r);
    });
    return box;
  }
  function nameRows() {
    var n = st.ch.names, out = [];
    out.push(toggle('Clean up channel names', 'Takes country tags, package words, quality tags and symbols off names.  Your playlist itself is not changed.', function () { return n.enabled; }, function (v) { n.enabled = v; draw(); }));
    if (n.enabled) {
      out.push(toggle('Clean group names too', '"USA | Sports" becomes "Sports".', function () { return n.groups; }, function (v) { n.groups = v; draw(); }));
      out.push(head('Rules, recommended ones on'));
      Names.RULES.forEach(function (r) {
        var ex = r.ex.slice(0, 2).map(function (e) { return '"' + e[0] + '" → "' + e[1] + '"'; }).join(',  ');
        out.push(toggle(r.label, ex, function () { return n.rules[r.id] != null ? !!n.rules[r.id] : r.on; }, function (v) { n.rules[r.id] = v; draw(); }));
      });
    }
    out.push(head('Your channels, before and after'));
    out.push(custom(preview()));
    out.push(info('Your own prefixes and suffixes, TiviMate style, are under Settings > Playlists and guide > Channel name editor.', ''));
    return out;
  }

  function feedRows() {
    var fp = st.sv.feeds, ch = st.ch, out = [];
    out.push(choice('Keep', '', ['east', 'west', 'both'], ['East feeds', 'West feeds', 'Both'],
      function () { return ch.feed; }, function (v) { ch.feed = v; draw(); }));
    var drop = ch.feed === 'east' ? 'west' : 'east', gs = st.sv.t.feedGroups(drop);
    if (ch.feed !== 'both' && gs.length) out.push(toggle('Also hide groups named ' + (drop === 'west' ? 'West' : 'East'), gs.slice(0, 4).map(function (g) { return g.name; }).join(', '), function () { return ch.feedGroups; }, function (v) { ch.feedGroups = v; draw(); }));
    if (ch.feed !== 'both') out.push(note('The ' + (drop === 'west' ? 'West' : 'East') + ' feed is not a backup: it runs hours apart, so TiviBro never switches to it by itself.  Your other qualities of the same feed still are.'));
    out.push(head(plural(fp.pairs, 'channel') + ' come in both feeds, for example'));
    fp.examples.forEach(function (x) { out.push(info(x.east.n + '    ⇄    ' + x.west.n, '')); });
    return out;
  }

  function localRows() {
    var li = st.sv.locals, ch = st.ch, out = [], n = Object.keys(ch.cities).length;
    out.push(toggle('Keep stations with no city', 'National feeds in the local groups.', function () { return ch.cityNone; }, function (v) { ch.cityNone = v; draw(); }, 'Keep', 'Hide'));
    out.push(toggle('Put them together in "Local channels"', 'One group with your stations, by city and network.', function () { return ch.cityGroup; }, function (v) { ch.cityGroup = v; draw(); }));
    if (ch.cityGroup) out.push(toggle('Then hide the network groups', li.groups.slice(0, 4).map(function (g) { return g.name; }).join(', ') + (li.groups.length > 4 ? '…' : '') + ': your stations show up once.', function () { return ch.cityHideNets; }, function (v) { ch.cityHideNets = v; draw(); }));
    if (ch.cityGroup && ch.cityHideNets) out.push(note('Hiding the network groups does not hide your stations: they stay in Local channels.'));
    if (n) out.push(action('Clear my cities', 'Keeps every city again.', function () { ch.cities = {}; draw(); }, function () { return plural(n, 'picked', 'picked'); }));
    out.push(head(n ? 'Keeping ' + Object.keys(ch.cities).map(Tidy.titleCase).join(', ') : 'No city picked: every city is kept'));
    li.cities.forEach(function (c) {
      var r = toggle(Tidy.titleCase(c.city) + (c.st ? '  ' + c.st : ''), Object.keys(c.nets).sort().join(' · ') + '  ·  ' + plural(c.n, 'station'), function () { return !!ch.cities[c.city]; },
        function (v) { if (v) ch.cities[c.city] = 1; else delete ch.cities[c.city]; draw(); });
      r.value = function () { return ch.cities[c.city] ? 'Keep' : n ? 'Hide' : ''; };
      r.letter = c.city.charAt(0);
      r.cycle = null; r.action = function () { if (ch.cities[c.city]) delete ch.cities[c.city]; else ch.cities[c.city] = 1; draw(); };
      out.push(r);
    });
    return out;
  }

  function eventRows() {
    var ev = st.ch.events, n = st.ch.names, out = [];
    out.push(toggle('Read events from channel names', 'The guide shows the event at its time, with "Starts 7:30 PM" before it.  A real guide always wins.', function () { return ev.on !== false; }, function (v) { ev.on = v; draw(); }));
    if (ev.on !== false) {
      out.push(toggle('Short channel names', '"NCAAB 001 | NORTH FLORIDA @ CHARLESTON SOUTHERN | 12.18 11:00 AM" shows as "NCAAB 001", the game under it.', function () { return ev.short !== false; }, function (v) { ev.short = v; draw(); }));
      out.push(toggle('Events by time', 'A group with every event on now or in the next two weeks, soonest first.', function () { return ev.group !== false; }, function (v) { ev.group = v; draw(); }));
      out.push(choice('Times with no time zone are in', 'Names that say ET, PT or UK are read that way.', Events.ZONE_CHOICES, Events.ZONE_LABELS, function () { return ev.tz || 'auto'; }, function (v) { ev.tz = v; draw(); }));
    }
    if (st.sv.idle) out.push(toggle('Hide channels with nothing on', plural(st.sv.idle, 'channel') + ' say "Off Air", "Offline" or "No Event Scheduled" right now.  They come back by themselves when an event is on.', function () { return !!n.hideIdle; }, function (v) { n.hideIdle = v; draw(); }));
    if (st.sv.upcoming.length) {
      out.push(head('Coming up'));
      st.sv.upcoming.forEach(function (x) { out.push(info(Events.when(x.e.start) + '   ' + x.e.title, x.e.short || '')); });
    }
    return out;
  }

  var DUPES = ['off', 'fhd', 'best', 'hd', 'sd'], DUPE_L = ['Keep them all', 'Keep Full HD', 'Keep the best (4K first)', 'Keep HD (lighter)', 'Keep SD (slow internet)'];
  function clutterRows() {
    var sv = st.sv, ch = st.ch, out = [], S_ = S();
    if (sv.dividers.length) out.push(toggle('Hide divider groups', plural(sv.dividers.length, 'group') + ' like "' + sv.dividers[0].name + '" that only split the list into sections.', function () { return ch.dividers; }, function (v) { ch.dividers = v; draw(); }, 'Hide', 'Keep'));
    out.push(toggle('Hide empty groups', 'Groups with no channels, or none left after the steps before.', function () { return ch.empty; }, function (v) { ch.empty = v; draw(); }, 'Hide', 'Keep'));
    if (sv.dupeSets) {
      out.push(choice('Same channel more than once', plural(sv.dupeSets, 'channel') + ' come in several qualities or copies (' + fmt(sv.dupeExtra) + ' extra).  Pick which copy shows in your lists.',
        DUPES, DUPE_L, function () { return ch.dupes; }, function (v) { ch.dupes = v; draw(); }));
      if (ch.dupes !== 'off') out.push(note('Hidden copies are still your backups.  If the copy you keep stops working, TiviBro switches to another one by itself, and hold OK > Other versions lists them all.'));
    }
    out.push(action('Hide groups with these words…', 'Comma separated, like PPV, 24/7, Radio, Adult.', function () {
      UI.prompt('Hide groups whose name contains', ch.words, function (v) { ch.words = v; draw(); }, 'Comma separated.  Upper and lower case do not matter.');
    }, function () { return ch.words.trim() || 'None'; }));
    out.push(choice('Groups the provider adds later', 'Hide them keeps a tidy list tidy after the provider adds groups.', ['show', 'hide'], ['Show them', 'Hide them'],
      function () { return S_.newGroups === 'hide' ? 'hide' : 'show'; }, function (v) { S_.newGroups = v; Store.saveSettings(); draw(); }));
    return out;
  }

  function logoStrip() {
    var box = U.el('div', 'tour-logos'), st_ = Logos.status;
    if (Logos.mode() === 'off') { box.appendChild(U.el('div', 'tour-note', 'Off: channels show the playlist\'s and the guide\'s logos only.')); return box; }
    if (st_.state === 'loading') { box.appendChild(U.el('div', 'tour-note', 'Looking up logos for your channels…')); return box; }
    if (st_.state === 'error') {
      if (!st.logoWarned) { st.logoWarned = true; Log.warn('tour', 'Logo library: ' + st_.error); }
      box.appendChild(U.el('div', 'tour-note err', 'The logo library could not be reached just now, so channels keep the logos they have.  Check the TV\'s internet; TiviBro tries again each time it starts.'));
      return box;
    }
    var chans = Library.data.channels, own = function (c) { return Views.ownLogo(c); };
    var cov = st.cov || (st.cov = Logos.coverage(chans, own));
    box.appendChild(U.el('div', 'tour-note', 'Found ' + plural(cov.found, 'logo') + ' for your ' + fmt(cov.total) + ' channels, ' + fmt(cov.filled) + ' of them for channels with none.'));
    var row = U.el('div', 'tour-logo-row'), shown = 0, seen = {};
    for (var i = 0; i < chans.length && shown < 8; i += Math.max(1, Math.floor(chans.length / 400))) {
      var c = chans[i], u = Logos.mode() === 'all' || !own(c) ? Logos.url(c) : '';
      if (!u || seen[u]) continue; seen[u] = 1; shown++;
      var cell = U.el('div', 'tour-logo'), img = U.el('img');
      img.src = u; img.onerror = function () { if (!Net.retryImage(this)) this.parentNode.style.display = 'none'; };
      cell.appendChild(img); cell.appendChild(U.el('span', '', Library.name(c)));
      row.appendChild(cell);
    }
    box.appendChild(row);
    return box;
  }
  function relogo() {
    st.cov = null;
    Logos.load(Library.data).then(function () { st.cov = null; if (st && cur().id === 'logos') draw(); });
    draw();
  }
  function logoRows() {
    var s = S(), out = [];
    // First time here on a new playlist: show what filling in missing logos looks like (one press turns it off).
    if (st.first && !st.logoSeen && (!s.logoLib || s.logoLib === 'off')) { st.logoSeen = true; s.logoLib = 'fill'; Store.saveSettings(); relogo(); }
    st.logoSeen = true;
    out.push(choice('Logo library', '', ['off', 'fill', 'all'], ['Off', 'Fill in missing logos', 'Use for every channel it knows'],
      function () { return s.logoLib || 'off'; }, function (v) { s.logoLib = v; Store.saveSettings(); relogo(); }));
    if (s.logoLib && s.logoLib !== 'off') out.push(choice('Style', 'Matching set: one clean style for dark screens.  Original: each channel\'s own logo.', ['set', 'original'], ['Matching set', 'Original logos'],
      function () { return s.logoStyle === 'original' ? 'original' : 'set'; }, function (v) { s.logoStyle = v; Store.saveSettings(); st.cov = null; draw(); }));
    out.push(choice('When the playlist and the guide both have a logo', '', ['playlist', 'guide'], ['Use the playlist\'s', 'Use the guide\'s'],
      function () { return s.logoPref === 'guide' ? 'guide' : 'playlist'; }, function (v) { s.logoPref = v; Store.saveSettings(); st.cov = null; draw(); }));
    out.push(custom(logoStrip()));
    return out;
  }

  function guideRows() {
    var p = Store.playlist, out = [], cf = PubEpg.conf(p), ps = Epg.pubStatus;
    out.push(toggle('Fill in from public guides', 'Only for channels with no other guide.', function () { return PubEpg.conf(p).on; }, function (v) { PubEpg.set(p, { on: v }); Store.upsertPlaylist(p); Epg.refresh(Library, false); draw(); }));
    if (cf.on) {
      if (ps && ps.at && !ps.none) out.push(info('Filled in so far', plural(ps.filled, 'channel') + ' of ' + ps.asked + ' with no other guide' + (ps.countries.length ? ', from the guides for ' + ps.countries.map(PubEpg.name).join(', ') : '')));
      else if (ps && ps.none) out.push(info('Nothing to fill in', ps.none));
      else out.push(info('Looking', 'TiviBro looks once your own guide has loaded.  It keeps going in the background.'));
      out.push(note('Countries are picked from your channels.  Change them, or turn this off, in Settings > Playlists and guide > ' + (p.name || 'the playlist') + ' > Public guide fill-in.  A wrong match: hold OK on the channel > Assign guide.'));
    }
    return out;
  }

  function lookRows() {
    var s = S(), out = [], K = Settings.LOOK;
    out.push(choice('Accent color', 'The colour of whatever is focused.', K.ACCENTS.slice(0, -1), K.ACCENT_NAMES.slice(0, -1), function () { return s.accent; },
      function (v) { s.accentMode = ''; s.accent = v; Views.applyLook(); Store.saveSettings(); draw(); }, function () { return s.accent; }));
    out.push(choice('Background', '', K.THEMES, K.THEME_NAMES, function () { return s.theme || 'dark'; }, function (v) { s.theme = v; Views.applyLook(); Store.saveSettings(); draw(); },
      function () { return K.THEME_INK[s.theme || 'dark']; }));
    out.push(choice('Text size', '', ['s', 'm', 'l'], ['Small', 'Medium', 'Large'], function () { return s.textSize || 'm'; }, function (v) { s.textSize = v; Views.applyLook(); Store.saveSettings(); draw(); }));
    out.push(choice('Start screen', 'What TiviBro opens on.', ['guide', 'live'], ['Guide', 'Channels list'], function () { return s.startTab === 'live' ? 'live' : 'guide'; }, function (v) { s.startTab = v; Store.saveSettings(); Views.buildTabs(); draw(); }));
    out.push(toggle('Turn on the last channel at launch', '', function () { return !!s.resumeLast; }, function (v) { s.resumeLast = v; Store.saveSettings(); draw(); }));
    out.push(toggle('Preview in the channel list', 'Plays the channel you rest on in a corner window.', function () { return s.previewPlay !== false; }, function (v) { s.previewPlay = v; Store.saveSettings(); draw(); }));
    out.push(choice('When a channel stops working', 'Switches to another version of the same channel, like its HD copy.', ['auto', 'ask', 'off'], ['Switch to another version', 'Ask me', 'Keep retrying'],
      function () { return s.backups || 'auto'; }, function (v) { s.backups = v; Store.saveSettings(); draw(); }));
    return out;
  }

  function doneRows() {
    var pl = plan(), out = [], cards = U.el('div', 'tour-stats');
    function card(v, l) { var d = U.el('div', 'tour-stat'); d.appendChild(U.el('b', '', v)); d.appendChild(U.el('span', '', l)); cards.appendChild(d); }
    card(fmt(pl.chans), 'channels to watch'); card(fmt(pl.groups), 'groups');
    if (pl.hidC) card(fmt(pl.hidC), 'channels hidden');
    if (pl.hidG) card(fmt(pl.hidG), 'groups hidden');
    out.push(custom(cards));
    out.push(head('Your choices: OK on one to change it'));
    choices().forEach(function (x) { out.push(action(x[1], '', function () { jump(x[0]); }, function () { return x[2]; })); });
    out.push(head('Good to know'));
    var tips = U.el('div', 'tour-tips');
    [['Hold OK on a channel', 'Favorites, other versions, reminders, hide, block, assign a guide.'],
      ['OK while watching', 'The quick menu: audio, subtitles, quality, picture, multiview, sleep timer, from start.'],
      ['Multiview', 'Up to four channels at once, from the quick menu.'],
      ['Catch-up', 'Channels marked ↺ replay the last days: go back in the guide and press OK.'],
      ['The web editor', 'Edit on phone in the side menu: Smart clean-up, renaming, your own groups, guide matching, backups.'],
      ['Run this again', 'Settings > Playlists and guide > ' + (Store.playlist.name || 'the playlist') + ' > Set-up tour.']].forEach(function (x) {
      var d = U.el('div', 'tour-tip'); d.appendChild(U.el('b', '', x[0])); d.appendChild(U.el('span', '', x[1])); tips.appendChild(d);
    });
    out.push(custom(tips));
    return out;
  }

  // One line per step for the summary: [step id, label, what it will do].
  function choices() {
    var ch = st.ch, sv = st.sv, s = S(), out = [], ids = steps().map(function (x) { return x.id; });
    function has(id) { return ids.indexOf(id) >= 0; }
    if (has('countries')) {
      var keep = sv.countries.filter(function (x) { return ch.cc[x.p] !== false; }).map(function (x) { return x.name; });
      out.push(['countries', 'Countries', (keep.length === sv.countries.length ? 'Every country' : keep.length ? 'Keep ' + (keep.length > 3 ? plural(keep.length, 'country', 'countries') : keep.join(', ')) : 'None') + (ch.ccNone ? '' : ', no-country groups hidden')]);
    }
    var nr = Names.RULES.filter(function (r) { return ch.names.rules[r.id] != null ? !!ch.names.rules[r.id] : r.on; }).length;
    out.push(['names', 'Channel names', ch.names.enabled ? 'Cleaned, ' + nr + ' of ' + Names.RULES.length + ' rules' + (ch.names.groups ? ', groups too' : '') : 'As the provider sends them']);
    if (has('feeds')) out.push(['feeds', 'East and West', ch.feed === 'both' ? 'Keep both' : 'Keep ' + (ch.feed === 'east' ? 'East' : 'West') + (ch.feedGroups ? ', other feed\'s groups hidden' : '')]);
    if (has('locals')) {
      var cs = Object.keys(ch.cities).map(Tidy.titleCase);
      out.push(['locals', 'Local channels', !cs.length ? 'Every city' : (cs.length > 3 ? plural(cs.length, 'city', 'cities') : cs.join(', ')) + (ch.cityGroup ? ' in Local channels' + (ch.cityHideNets ? ', network groups hidden' : '') : '')]);
    }
    if (has('events')) out.push(['events', 'Sports and PPV', st.ch.events.on === false ? 'Off' : 'Read from names' + (st.ch.events.group !== false ? ', Events by time' : '') + (ch.names.hideIdle ? ', nothing-on hidden' : '')]);
    var cl = [];
    if (sv.dividers.length && ch.dividers) cl.push('dividers');
    if (ch.empty) cl.push('empty groups');
    if (sv.dupeSets && ch.dupes !== 'off') cl.push('extra copies (' + DUPE_L[DUPES.indexOf(ch.dupes)].replace(/^Keep /, '').replace(/ \(.*\)$/, '') + ' shown, the rest kept as backups)');
    if (ch.words.trim()) cl.push('"' + ch.words.trim() + '"');
    out.push(['clutter', 'Clutter', cl.length ? 'Hide ' + cl.join(', ') : 'Nothing hidden']);
    out.push(['logos', 'Logos', !s.logoLib || s.logoLib === 'off' ? 'Playlist and guide logos only' : (s.logoLib === 'all' ? 'Library for every channel' : 'Fill in missing') + ', ' + (s.logoStyle === 'original' ? 'original logos' : 'matching set')]);
    out.push(['guide', 'Guide', PubEpg.conf(Store.playlist).on ? 'Public guides fill in channels with no guide' : 'Your sources and the provider\'s guide only']);
    var K = Settings.LOOK, ai = K.ACCENTS.indexOf(s.accent), ti = K.THEMES.indexOf(s.theme || 'dark');
    out.push(['look', 'Look and start', (ai >= 0 ? K.ACCENT_NAMES[ai] : 'Custom colour') + ' on ' + (ti >= 0 ? K.THEME_NAMES[ti] : 'Midnight') + ', opens on ' + (s.startTab === 'live' ? 'Channels' : 'Guide')]);
    return out;
  }
  function jump(id) {
    var list = steps(), i = list.map(function (x) { return x.id; }).indexOf(id);
    if (i >= 0) go(i - st.step);
  }

  /* ---------- phone or computer ---------- */
  function remote() {
    st.remote = true;
    root.innerHTML = '';
    var wrap = U.el('div', 'tour-remote');
    wrap.appendChild(U.el('h1', '', 'Tidy up on a phone or computer'));
    wrap.appendChild(U.el('p', 'lead', 'Scan the code with your phone\'s camera, or open the address on a computer on the same network.  Smart clean-up opens there, signed in.  Changes show up on the TV as you send them.'));
    var box = U.el('div', 'tour-remote-box'), qr = U.el('div', 'tour-qr'), txt = U.el('div', 'tour-remote-txt');
    box.appendChild(qr); box.appendChild(txt); wrap.appendChild(box);
    var bar = U.el('div', 'tour-foot'), back = U.el('div', 'btn focus', 'Back to the tour'), done = U.el('div', 'btn', 'Done, start watching');
    bar.appendChild(back); bar.appendChild(done); wrap.appendChild(bar);
    root.appendChild(wrap);
    var f = 0;
    function paintB() { back.classList.toggle('focus', f === 0); done.classList.toggle('focus', f === 1); }
    back.addEventListener('click', function () { f = 0; UI.press('ok'); });
    done.addEventListener('click', function () { f = 1; UI.press('ok'); });
    function show(s) { WebEdit.drawJoin(qr, txt, 'tools', s, 'Waiting for a phone or computer…', 'Connected.  Send your changes there, then press Done.'); }
    txt.appendChild(U.el('div', 'remote-s', 'Starting the editor…'));
    WebEdit.onStatus = function (s) { if (st && st.remote) show(s); };
    (WebEdit.on ? Promise.resolve(WebEdit.status) : WebEdit.start()).then(show, function (e) { txt.innerHTML = ''; txt.appendChild(U.el('div', 'msg err', e.message)); });
    UI.setHandler(function (a) {
      if (a === 'left' || a === 'right') { f = a === 'left' ? 0 : 1; paintB(); }
      else if (a === 'ok') { leaveRemote(); if (f === 1) finish(false); else draw(); }
      else if (a === 'back') { leaveRemote(); draw(); }
      return true;
    });
  }
  function leaveRemote() { st.remote = false; WebEdit.onStatus = null; UI.setHandler(keys); }

  /* ---------- drawing ---------- */
  function cur() { return steps()[st.step]; }
  function focusable(it) { return it && !it.head && !it.info && !it.custom; }
  function draw() {
    if (!st) return;
    var list = steps(), step = list[st.step];
    st.items = step.rows();
    var foot = [];
    if (step.id !== 'welcome') foot.push({ btn: true, label: 'Back', action: function () { go(-1); } });
    if (step.id !== 'welcome' && step.id !== 'done') foot.push({ btn: true, label: 'Next', primary: true, action: function () { go(1); } });
    if (step.id === 'done') foot.push({ btn: true, label: 'Apply and start watching', primary: true, action: apply });
    if (step.id !== 'welcome' && step.id !== 'done') foot.push({ btn: true, label: 'Skip to the summary', action: function () { st.step = steps().length - 1; st.sel = -1; draw(); } });
    st.foot = foot;
    st.all = st.items.concat(foot);
    if (st.sel < 0 || st.sel >= st.all.length || !focusable(st.all[st.sel])) {
      var want = st.sel === -2 || step.id === 'done' ? 'end' : 'start';
      st.sel = -1;
      if (want === 'start') { for (var i = 0; i < st.all.length; i++) if (focusable(st.all[i]) && !st.all[i].btn) { st.sel = i; break; } }
      if (st.sel < 0) for (var j = 0; j < st.all.length; j++) if (st.all[j].primary) st.sel = j;
      if (st.sel < 0) for (var k = 0; k < st.all.length; k++) if (focusable(st.all[k])) { st.sel = k; break; }
    }
    root.innerHTML = '';
    var wrap = U.el('div', 'tour');
    // Left: the steps.
    var rail = U.el('div', 'tour-rail'), brand = U.el('img', 'tour-brand'); brand.src = 'img/wordmark.png'; brand.alt = 'TiviBro'; rail.appendChild(brand);
    list.forEach(function (s, i) { rail.appendChild(U.el('div', 'tour-step' + (i === st.step ? ' on' : i < st.step ? ' done' : ''), s.rail)); });
    wrap.appendChild(rail);
    // Right: the step.
    var main = U.el('div', 'tour-main');
    var top = U.el('div', 'tour-top');
    top.appendChild(U.el('div', 'tour-kicker', 'Step ' + (st.step + 1) + ' of ' + list.length));
    if (step.id !== 'welcome') { var pl = plan(); top.appendChild(U.el('div', 'tour-chip', 'Keeps ' + fmt(pl.chans) + ' of ' + fmt(st.sv.channels) + ' channels')); }
    main.appendChild(top);
    main.appendChild(U.el('h1', '', step.id === 'welcome' ? (st.first ? 'Your playlist is in' : 'Set-up tour') : step.title));
    var lead = typeof step.lead === 'function' ? step.lead() : step.lead;
    if (lead) main.appendChild(U.el('p', 'lead', lead));
    if (step.id === 'welcome') main.appendChild(U.el('p', 'lead', st.current ? 'Your setup as it is now is filled in on every step: the countries you kept, your feed, your cities.  Change what you like, then Apply.' :
      (Store.playlist.name || 'Your playlist') + ' loaded.  Here is what it has, and a quick way to make it yours: keep the countries you watch, clean the names, pick East or West and your city, and choose logos and colours.'));
    var view = U.el('div', 'tour-view'), scroll = U.el('div', 'tour-scroll');
    st.rowEls = st.items.map(function (it, i) {
      if (it.custom) return it.el;
      var d = U.el('div', 'opt' + (it.head ? ' head' : '') + (it.info ? ' dim' : '') + (it.note ? ' note' : ''));
      var l = U.el('div', 'ol', it.label);
      if (it.sub) l.appendChild(U.el('small', '', it.sub));
      d.appendChild(l);
      if (!it.head) {
        var v = U.el('div', 'ov');
        if (it.swatch) { var sw = U.el('i', 'sw'); sw.style.background = it.swatch(); v.appendChild(sw); }
        if (it.cycle) v.appendChild(U.el('span', 'ar', '‹'));
        v.appendChild(document.createTextNode(it.value ? it.value() : ''));
        // Rows without ◀ ▶ keep the arrows' room too, so every value lines up.
        var ra = U.el('span', 'ar', '›'); if (!it.cycle) ra.style.visibility = 'hidden'; v.appendChild(ra);
        d.appendChild(v);
      }
      if (focusable(it)) {
        d.addEventListener('mousemove', function () { if (UI.pointer && st.sel !== i) { st.sel = i; paint(); } });
        d.addEventListener('click', function () { st.sel = i; paint(); keys('ok'); });
      }
      return d;
    });
    st.rowEls.forEach(function (e) { scroll.appendChild(e); });
    view.appendChild(scroll);
    main.appendChild(view);
    var bar = U.el('div', 'tour-foot');
    st.footEls = foot.map(function (b, i) {
      var e = U.el('div', 'btn' + (b.primary ? ' primary' : ''), b.label);
      e.addEventListener('click', function () { st.sel = st.items.length + i; paint(); keys('ok'); });
      bar.appendChild(e);
      return e;
    });
    main.appendChild(bar);
    wrap.appendChild(main);
    root.appendChild(wrap);
    st.scroll = scroll; st.view = view;
    paint();
  }
  function paint() {
    var n = st.items.length;
    st.rowEls.forEach(function (e, i) { e.classList.toggle('focus', i === st.sel); });
    st.footEls.forEach(function (e, i) { e.classList.toggle('focus', n + i === st.sel); });
    var f = st.rowEls[st.sel];
    var y = st.scroll._y || 0;
    var h = st.view.clientHeight;
    if (f) {
      var top = f.offsetTop, bottom = top + f.offsetHeight;
      if (top + y < 0) y = -top;
      var room = f === st.rowEls[st.rowEls.length - 1] ? h : h - 40;     // clear of the fade at the bottom
      if (bottom + y > room) y = room - bottom;
      // Near the top of the list, show it from the start when the focused row fits.
      if (bottom <= room) y = 0;
      // Never leave half a row cut off at the top: scroll on to the next whole row (never past the focused one).
      if (y < 0) {
        var snap = top;
        st.rowEls.forEach(function (e) { var t = e.offsetTop; if (t >= -y && t < snap) snap = t; });
        y = -snap;
      }
    }
    y = Math.min(0, y);
    st.scroll._y = y;
    st.scroll.style.transform = 'translateY(' + y + 'px)';
    // A fade at the edge tells you there is more to scroll to.
    st.view.classList.toggle('more-below', st.scroll.offsetHeight + y > h + 2);
    st.view.classList.toggle('more-above', y < 0);
  }

  function go(d) {
    var n = steps().length;
    st.step = U.clamp(st.step + d, 0, n - 1);
    st.sel = d < 0 ? -2 : -1;
    st.scrollY = 0;
    draw();
  }

  function keys(a) {
    if (!st) return false;
    var it = st.all[st.sel], n = st.items.length, i;
    if (a === 'up' || a === 'down') {
      var d = a === 'up' ? -1 : 1;
      if (it && it.btn && d === 1) return true;
      if (it && it.btn && d === -1) { for (i = n - 1; i >= 0 && !focusable(st.all[i]); i--); if (i >= 0) st.sel = i; paint(); return true; }
      i = st.sel + d;
      while (i >= 0 && i < n && !focusable(st.all[i])) i += d;
      if (i >= n) { for (i = 0; i < st.foot.length; i++) if (st.foot[i].primary) break; st.sel = n + (i < st.foot.length ? i : 0); }
      else if (i >= 0) st.sel = i;
      paint();
    }
    else if (a === 'chup' || a === 'chdown') { for (var j = 0; j < 8; j++) keys(a === 'chup' ? 'up' : 'down'); }
    else if (a === 'left' || a === 'right') {
      var dir = a === 'left' ? -1 : 1;
      if (it && it.btn) { var k = st.sel - n + dir; if (k >= 0 && k < st.foot.length) { st.sel = n + k; paint(); } }
      else if (it && it.cycle) it.cycle(dir);
      else if (it && it.letter) {
        // Local cities: jump to the next or previous letter.
        for (i = st.sel + dir; i >= 0 && i < n; i += dir) {
          var x = st.all[i];
          if (x.letter && (dir > 0 ? x.letter > it.letter : x.letter < it.letter)) {
            if (dir < 0) while (i > 0 && st.all[i - 1].letter === x.letter) i--;
            st.sel = i; paint(); break;
          }
        }
      }
      else if (a === 'left' && st.step > 0) go(-1);
    }
    else if (a === 'ok') { if (it && it.action) it.action(); else if (it && it.cycle) it.cycle(1); }
    else if (a === 'back') { if (st.step > 0) go(-1); else finish(false); }
    return true;
  }

  /* ---------- apply ---------- */
  function apply() {
    var pl = plan(), p = Store.playlist, E = Store.edits;
    var save = WebEdit.snap ? WebEdit.snap('Before the set-up tour').catch(function () {}) : Promise.resolve();
    save.then(function () {
      Object.keys(pl.g).forEach(function (id) { E.hiddenGroups[id] = 1; });
      Object.keys(pl.c).forEach(function (k) { E.hiddenChannels[k] = 1; });
      if (pl.cityKeep.length) {
        var lg = E.custom.filter(function (x) { return x.name === 'Local channels'; })[0];
        if (!lg) { lg = { id: 'c_' + Date.now().toString(36), name: 'Local channels', items: [] }; E.custom.push(lg); }
        pl.cityKeep.forEach(function (k) { if (lg.items.indexOf(k) < 0) lg.items.push(k); });
      }
      p.names = st.ch.names; p.events = st.ch.events; p.tour = Date.now();
      Store.upsertPlaylist(p); Store.saveEdits();
      Names.invalidate(); Events.reset(); Library.dirty();
      Log.info('tour', 'Set-up tour applied: hid ' + pl.hidG + ' groups and ' + pl.hidC + ' channels; ' + pl.chans + ' channels in ' + pl.groups + ' groups shown');
      U.toast('Done.  ' + plural(pl.chans, 'channel') + ' in ' + plural(pl.groups, 'group') + '.', 4000);
      finish(true);
    });
  }
  function finish(applied) {
    var p = Store.playlist, done = st && st.done, from = st && st.from;
    if (!applied && p && !p.tour) { p.tour = -1; Store.upsertPlaylist(p); }
    if (st && st.remote) WebEdit.onStatus = null;
    st = null;
    root.classList.add('hidden'); root.classList.remove('tourmode'); root.innerHTML = '';
    UI.setHandler(null);
    Views.reload(false);
    Views.switchTab(from === 'settings' ? 'settings' : Views.home());
    if (done) done(applied);
  }

  /* Run again later, the tour opens on what is in effect now, not on first-run defaults: the
     countries whose groups are shown, the feed you kept, the cities in your local group, whether
     dividers and empty groups are hidden.  Then it reads as updating your setup. */
  function fromCurrent() {
    var E = Store.edits, hg = E.hiddenGroups || {}, hc = E.hiddenChannels || {}, sv = st.sv, ch = st.ch;
    if (!Object.keys(hg).length && !Object.keys(hc).length && !(E.custom || []).some(function (g) { return g.items && g.items.length; })) return;    // nothing done yet
    sv.countries.forEach(function (x) { ch.cc[x.p] = x.groups.some(function (id) { return !hg[id]; }); });
    var cm = sv.t.countryMap(), none = Library.data.groups.filter(function (g) { return !cm[g.id]; });
    ch.ccNone = !none.length || none.some(function (g) { return !hg[g.id]; });
    var vis = function (c) { return !hc[c.k] && !hg[c.g]; };
    if (sv.feeds.pairs) {
      var w = sv.feeds.west.some(vis), e = sv.feeds.east.some(vis);
      ch.feed = w && e ? 'both' : w ? 'west' : 'east';
      ch.feedGroups = sv.t.feedGroups(ch.feed === 'east' ? 'west' : 'east').some(function (g) { return hg[g.id]; });
    }
    var byKey = {}; sv.locals.chans.forEach(function (x) { byKey[x.c.k] = x; });
    var lg = (E.custom || []).filter(function (g) { return g.items && g.items.length && g.items.every(function (k) { return byKey[k]; }); })[0];
    if (lg) { ch.cities = {}; lg.items.forEach(function (k) { var c = byKey[k].p.city; if (c) ch.cities[c] = 1; }); ch.cityGroup = true; ch.cityHideNets = sv.locals.groups.every(function (g) { return hg[g.id]; }); }
    ch.cityNone = sv.locals.chans.some(function (x) { return !x.p.city && vis(x.c); }) || !sv.locals.chans.some(function (x) { return !x.p.city; });
    if (sv.dividers.length) ch.dividers = sv.dividers.every(function (g) { return hg[g.id]; });
    if (sv.empty.length) ch.empty = sv.empty.every(function (g) { return hg[g.id]; });
    st.current = true;
  }

  /* opts: { first: true right after connecting, done(applied) } */
  function open(opts) {
    opts = opts || {};
    var p = Store.playlist;
    st = { step: 0, sel: -1, first: !!opts.first, done: opts.done, from: opts.from, sv: survey(), remote: false };
    var region = Tidy.ccOfLocale(navigator.language), cc = {};
    var inList = st.sv.countries.some(function (x) { return x.p === region; });
    // Pre-ticked: the TV's own country when the playlist has it, otherwise every country.
    st.sv.countries.forEach(function (x) { cc[x.p] = inList ? x.p === region : true; });
    st.ch = { cc: cc, ccNone: true, names: clone(p.names || Names.defaults()), events: clone(p.events || {}), feed: st.sv.feeds.pairs ? 'east' : 'both', feedGroups: true,
      cities: {}, cityNone: true, cityGroup: true, cityHideNets: true, dividers: true, empty: true, dupes: st.sv.dupeSets ? 'fhd' : 'off', words: '' };
    if (!opts.first) fromCurrent();
    if (st.ch.names.enabled === false && opts.first) st.ch.names.enabled = true;
    if (opts.first && st.sv.idle) st.ch.names.hideIdle = true;
    Logos.load(Library.data).then(function () { if (st && cur().id === 'logos') { st.cov = null; draw(); } });
    root.classList.remove('hidden', 'kb');
    root.classList.add('tourmode');
    UI.setHandler(keys);
    Log.info('tour', 'Set-up tour opened (' + st.sv.channels + ' channels, ' + st.sv.countries.length + ' countries, ' + st.sv.feeds.pairs + ' East/West pairs, ' + st.sv.locals.cities.length + ' local cities, ' + st.sv.events + ' event channels)');
    draw();
  }

  return { open: open, get isOpen() { return !!st; }, get choices() { return st && st.ch; }, keys: function (a) { return keys(a); }, plan: function () { return st && plan(); }, go: function (d) { go(d); }, get step() { return st && cur().id; } };
})();
