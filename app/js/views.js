/* Live, Fullscreen and Guide views.
   Speed rules used throughout:
   - Focus changes repaint at most two rows; the preview starts only after the
     remote has rested on a channel (450ms), so scrolling never spins up streams.
   - Zapping in fullscreen updates the OSD instantly but commits the stream after
     300ms, so CH+ CH+ CH+ opens one stream, not three.
   - Guide data is requested only for rows on screen. */
/* A long channel number ("103560") is drawn smaller so it stays out of the logo (discussion #36).  Shared by the
   channel list (Views) and the guide (Guide), which are separate modules: alpha 164 had it only in the first, and
   opening the playlist stopped with "numLen is not defined" in the guide. */
function chanNumLen(el) { var n = String(el.textContent || '').length, l = n >= 6 ? '6' : n === 5 ? '5' : ''; if ((el.getAttribute('data-l') || '') !== l) { if (l) el.setAttribute('data-l', l); else el.removeAttribute('data-l'); } }

/* "Hide channels with no guide information" waits for the whole guide, public fill-in included: while it
   loads, channels it is about to fill have nothing yet and would be hidden for good.  Shared by the channel
   list (Views) and the guide (Guide): it was inside Views, and the guide's Show or hide channels menu
   stopped with "noGuideHide is not defined". */
function noGuideHide(run) {
  var busy = !!Epg.loading;
  return { label: 'Hide channels with no guide information', sub: busy ? 'Once the guide has finished loading' : '', action: function () {
    if (!Epg.loading) return run();
    U.toast('The guide is still loading.  Try again when it has finished, so channels it fills in stay shown.');
  } };
}

var Views = (function () {
  'use strict';
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var $ = U.$, L = Library;
  var stage = $('stage'), video = $('video');
  var tab = 'live', zone = 'channels', full = false, liveZone = 'channels';
  var groupsVL, chansVL, ovVL, curGroup = null, playing = null, lastPlayed = null;
  var osdT = 0, zapBuf = '', zapT = 0, tabSel = 0, tabs = [];
  var mode = 'live';            // fullscreen mode: live | catchup | vod
  var cu = null;                // catch-up: { c, p, off }
  var lw = false;               // behind live inside a DASH channel's own time-shift window (issue #85)
  var vod = null;               // { meta, onExit }
  var pick = null;              // multi-select: Set of chanKeys, or null
  var overlay = false, ovGroup = null;
  var backT = 0, sleepAt = 0, sleepWarned = false, playStart = 0, recentDone = false;

  // In the language chosen (app/js/i18n.js).
  function T(x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : v ? String(x).replace(/\{([a-z]+)\}/g, function (a, k) { return v[k] != null ? v[k] : a; }) : x; }
  var TAB_LABELS = { live: 'Channels', guide: 'Guide', onnow: 'Movies on now', sports: 'Sports', movies: 'Movies', shows: 'Shows', media: 'My media', recordings: 'Recordings', search: 'Search', editor: 'Edit on phone', settings: 'Settings', report: 'Report a problem' };
  // The guide is home: the app opens on it and Back from any other screen comes back to it.
  function home() { return Store.settings.startTab === 'live' ? 'live' : 'guide'; }
  /* The plain channel list in the menu: most people browse with the guide, so it shows only when
     switched on (Settings > Appearance) or when TiviBro starts on it.  Green in the
     guide still opens it. */
  function channelsInMenu() { var s = Store.settings; return s.channelsTab === true || (s.channelsTab == null && s.startTab === 'live') || home() === 'live'; }
  var fullFrom = 'guide';
  // Simple line icons for the side menu (inline SVG, no image files to load).
  var ICONS = {
    guide: '<path d="M3 5h18M3 12h18M3 19h18M9 3v18"/>',
    live: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    onnow: '<path d="M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 9l1.5-4.5 15 3.5L20 9"/><path d="M9 5.3l1.6 3.4M14 6.4l1.6 2.6"/><path d="M10.5 12.5v5l4-2.5z"/>',
    sports: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 4M17 6h2.5a2.5 2.5 0 0 1-2.6 4M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    media: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 11l5 3-5 3z"/>',
    shows: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    editor: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    recordings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
    report: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  // Movies and Shows appear only when this playlist actually has them (checked in the background).
  function buildTabs() {
    /* The menu open while it is rebuilt (the movie check or My media adding a screen a few seconds after the start):
       the screen you were on in it stays picked and lit.  Before, the highlight went and the next ▲ ▼ counted
       from a place that had moved, so presses seemed not to register. */
    var navOpen = document.body.classList.contains('nav-open'), was = navOpen && tabs ? tabs[tabSel] : null;
    tabs = home() === 'live' ? ['live', 'guide'] : channelsInMenu() ? ['guide', 'live'] : ['guide'];
    // Movies on now (onnow.js): in the menu while a TMDB token is saved and movie details are on.
    if (typeof Movies !== 'undefined' && Movies.on()) tabs.push('onnow');
    // Sports (sportshub.js): scores and your channels for today's games, unless turned off in Settings > Sports.
    if (typeof SportsHub !== 'undefined' && Store.settings.sportsTab !== false) tabs.push('sports');
    // Movies and Shows: an Xtream login's, or an M3U list's own (Vod.m3u: kept by the network helper);
    // several playlists on: any of them (Vod.offered).
    var vk = Vod.offered();
    if (vk.indexOf('movie') >= 0) tabs.push('movies');
    if (vk.indexOf('series') >= 0) tabs.push('shows');
    // My media: in the menu once a media source is added (Settings > My media is the way in before that).
    if (typeof MediaStore !== 'undefined' && MediaStore.sources().length) tabs.push('media');
    // Recordings (recordings.js): once a USB drive is in the TV, or something's been recorded.
    if (typeof Record !== 'undefined' && Record.shown()) tabs.push('recordings');
    tabs.push('search', 'editor', 'settings');
    // Test builds: Report a problem one press away (it also stays in Settings > System).
    if (/alpha|beta/i.test(TIVIBRO_VERSION) || Store.settings.reportInMenu) tabs.push('report');
    var nav = document.querySelector('.tabs');
    nav.innerHTML = '';
    tabs.forEach(function (t) {
      var s = U.el('div', 'tab' + (t === tab ? ' on' : '')); s.setAttribute('data-tab', t);
      s.innerHTML = '<svg viewBox="0 0 24 24" class="ico">' + ICONS[t] + '</svg>';
      s.appendChild(U.el('span', 'lbl', T(TAB_LABELS[t])));
      s.addEventListener('click', function () { closeNav(); if (full) exitFull(true); UI.close(); if (t === 'editor') WebEdit.showJoin(); else if (t === 'report') Diag.openReport(); else switchTab(t); });
      s.addEventListener('mousemove', function () { if (UI.pointer && !document.body.classList.contains('nav-open') && !full) openNavFromPointer(); });
      nav.appendChild(s);
    });
    if (navOpen) { var at = was ? tabs.indexOf(was) : -1; tabSel = at >= 0 ? at : Math.min(tabSel, tabs.length - 1); var els = nav.children; if (els[tabSel]) els[tabSel].classList.add('focus'); }
    if (tabs.indexOf(tab) < 0 && tab !== 'live' && ready()) switchTab(home());
  }
  function ready() { return !!chansVL; }
  // Pointer near the menu: expand it so the labels show; it closes when the pointer leaves.
  var navPointerT = 0;
  function openNavFromPointer() {
    document.body.classList.add('nav-open', 'nav-peek');
    clearTimeout(navPointerT);
  }
  document.getElementById('sidenav').addEventListener('mouseleave', function () {
    if (!document.body.classList.contains('nav-peek')) return;
    navPointerT = setTimeout(function () { document.body.classList.remove('nav-open', 'nav-peek'); }, 250);
  });

  /* ---------- rows ---------- */
  // A playlist's heading (several playlists on, Library.groups(true)): its name, never focused.
  function renderGroup(row, g) {
    if (!row._n) {
      row._n = U.el('span', 'name'); row._t = U.el('span', 'tag');
      var box = U.el('div', 'txt'); box.appendChild(row._n);
      row.appendChild(box); row.appendChild(row._t);
    }
    row.classList.toggle('ghead', !!g.head);
    row._n.textContent = g.name;
    if (g.head) { row._t.textContent = ''; row.classList.remove('hid'); return; }
    row._t.textContent = g.hidden ? 'hidden' : g.blocked ? 'locked' : (g.count != null ? String(g.count) : '');
    row.classList.toggle('hid', !!g.hidden);
  }

  // Logo choice (Settings > Appearance): the playlist's logo or the guide's, falling back to the other,
  // and the logo library (logos.js) for channels with neither, or for every channel it knows.
  /* Bumped when the logo settings change (logosChanged): a row keeps the logo it drew while the address is the same,
     and a logo that failed and stands in from the library (logoFailed) has the same address, so the rows look
     at this too, or a new library style never reached them. */
  var logoRev = 0;
  function logosChanged() { logoRev++; refreshLists(true); }      // the guide draws its rows again as it shows (and now, if it's showing)
  function ownLogo(c) { var g = Epg.icon(Epg.epgId(c)); return Store.settings.logoPref === 'guide' ? (g || c.logo) : (c.logo || g); }
  function logoOf(c) {
    var lib = Logos.mode();
    if (lib === 'all') return Logos.url(c) || ownLogo(c);
    return ownLogo(c) || (lib === 'fill' ? Logos.url(c) : '');
  }
  // A logo that fails to load: try the helper, then the library's logo, then hide it.  A hidden one is asked
  // for once more a minute later: a logo host that said "too many requests" (HTTP 429) usually answers by then,
  // and the helper paces its images meanwhile (service/pace.js).
  function logoFailed(img, c) {
    if (Net.retryImage(img)) return;
    var alt = c && Logos.mode() !== 'off' ? Logos.url(c) : '';
    if (alt && img._alt !== alt && img.src !== alt) { img._alt = alt; img.src = alt; return; }
    img.style.visibility = 'hidden';
    var src = img.src;
    if (!src || img._again === src) return;
    img._again = src;
    setTimeout(function () {
      if (img.src !== src || img.style.visibility !== 'hidden') return;   // the row shows another channel now
      // '' (not 'visible'): back to the row's own, so it stays hidden with the rest of the screen in fullscreen.
      // 'visible' drew the retried logos over the video, on their own (a column of logos over the picture).
      img.style.visibility = '';
      img.removeAttribute('src');
      img.src = src;
    }, 60000);
  }

  // Only what changed: writing the same words again still makes the TV lay the row out again.
  function txt(el, s) { s = s == null ? '' : String(s); if (el.textContent !== s) el.textContent = s; }
  function renderChan(row, c) {
    if (!row._n) {
      row._num = U.el('span', 'num'); row._img = U.el('img', 'logo');
      row._img.decoding = 'async';
      row._img.onerror = function () { logoFailed(this, row._c); };
      var box = U.el('div', 'txt');
      row._n = U.el('span', 'name'); row._s = U.el('span', 'sub'); row._p = U.el('div', 'pbar'); row._pi = U.el('i');
      row._p.appendChild(row._pi);
      box.appendChild(row._n); box.appendChild(row._s); box.appendChild(row._p);
      row._t = U.el('span', 'tag'); row._q = U.el('span', 'qtag');
      row._d = U.el('span', 'deadtag', 'didn\'t play the last 2 times'); row._d.style.display = 'none';
      row.appendChild(row._num); row.appendChild(row._img); row.appendChild(box); row.appendChild(row._d); row.appendChild(row._q); row.appendChild(row._t);
      row.appendChild(U.el('span', 'vbox'));
    }
    var showNum = Store.settings.showNumbers;
    txt(row._num, showNum ? c.num : ''); chanNumLen(row._num);
    row._num.style.display = showNum ? '' : 'none';
    row._c = c;
    var lg = logoOf(c);
    if (row._logo !== lg + '#' + logoRev) {
      row._logo = lg + '#' + logoRev; row._img._alt = '';
      row._img.style.visibility = lg ? '' : 'hidden';
      if (lg) { row._img.removeAttribute('src'); row._img.src = lg; } else row._img.removeAttribute('src');
    }
    var locked = !Parental.blockedOk(c);
    txt(row._n, L.name(c));
    var nn = locked ? null : Epg.nowNext(c);
    if (locked) { txt(row._s, 'Locked'); row._p.style.display = 'none'; }
    else if (nn && nn.now) {
      txt(row._s, nn.now.t);
      var w = Math.round(100 * (Date.now() - nn.now.s) / (nn.now.e - nn.now.s)) + '%'; if (row._pi.style.width !== w) row._pi.style.width = w;
      row._p.style.display = nn.now.up || nn.now.ended ? 'none' : '';
    } else { txt(row._s, nn ? '' : ' '); row._p.style.display = 'none'; }
    var qt = L.versionTag(c);
    if (row._qt !== qt) { row._qt = qt; row._q.textContent = qt; row._q.style.display = qt ? '' : 'none'; }
    // Its last tries failed while other channels play (issue #37); gone once it plays again.
    var dead = typeof DeadList !== 'undefined' && DeadList.marked(c);
    if (row._dd !== dead) { row._dd = dead; row._d.style.display = dead ? '' : 'none'; }
    var tags = [];
    if (L.isFav(c.k)) tags.push('★');
    if (c.arch && Store.settings.showCatchupMark !== false) tags.push('↺');
    if (L.isBlocked(c)) tags.push('lock');
    if (L.isNew(c)) tags.push('NEW');
    txt(row._t, tags.join(' '));
    row.classList.toggle('playing', !!(playing && playing.k === c.k));
    row.classList.toggle('hid', !!Store.edits.hiddenChannels[c.k]);
    row.classList.toggle('picked', !!(pick && pick.has(c.k)));
    row.classList.toggle('moving', moving === c.k);
    row.classList.toggle('vis', !!lvis);
    row.classList.toggle('vis-off', !!lvis && !lvis.on[c.k]);
  }

  /* ---------- live view ---------- */
  function init() {
    groupsVL = new VList($('groupList'), { render: renderGroup, onSel: onGroupSel, empty: 'No groups', visible: 11,
      onHover: function () { if (zone !== 'groups') setZone('groups'); }, onClick: function () { UI.press('ok'); } });
    chansVL = new VList($('chanList'), { render: renderChan, onSel: onChanSel, empty: EMPTY, visible: 11,
      onHover: function () { if (zone !== 'channels') setZone('channels'); }, onClick: function () { UI.press('ok'); } });
    ovVL = new VList($('ovList'), { render: renderChan, empty: 'No channels', visible: 11, onClick: function () { UI.press('ok'); } });
    ovVL.setActive(true);
    Player.bind(video);
    Player.on('state', onPlayerState);
    Player.on('stats', onStats);
    Player.on('notice', function (m) { if (m) U.toast(m, m.length > 40 ? 6000 : 0); });
    Player.on('trouble', function () { downSoon(); });
    // Magic Remote in fullscreen: moving the pointer shows the info panel and its button legend,
    // clicking the picture shows or hides it.
    stage.addEventListener('click', function () { if (!full) { if (pipFull()) return; if (playing && mode === 'live') goFull(); return; } var o = $('osd'); if (o.classList.contains('hidden')) osd(true); else o.classList.add('hidden'); });
    document.addEventListener('mousemove', U.debounce(function () { if (full && UI.pointer && !overlay) osd(true); }, 120));
    // Subtitles on automatically when a stream brings them (Settings > Audio and subtitles), in the chosen language,
    // until the viewer picks in the Subtitles menu: a reconnect's tracks then keep that choice, Off too.
    // Tracks read from MKV and MP4 files (_embedded) are turned on by their reader (embedsubs.js),
    // which also undoes the browser's own pick.
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('addtrack', function (e) {
      var t = e.track;
      if (t && !t._embedded && Subs.autoOn(t, video))
        setTimeout(function () { if (!video._subsChoice && subtitleTracks().every(function (x) { return x.mode !== 'showing'; })) t.mode = 'showing'; }, 0);
    });
    Epg.onUpdate(function (k) {
      if (!k) { chansVL.refresh(); if (overlay) ovVL.refresh(); if (tab === 'guide') Guide.draw(); updateInfo(); return; }
      var hit = function (c) { return c && Epg.keyOf(c) === k; };
      chansVL.refreshWhere(hit);
      if (overlay) ovVL.refreshWhere(hit);
      var cur = chansVL.current();
      if (cur && hit(cur)) updateInfo();
      if (playing && hit(playing) && mode === 'live') osd(false);
      if (tab === 'guide') Guide.rowUpdated(k);
    });
    // A channel gets or loses the "not playing lately" mark (deadlist.js): its rows, wherever they show.
    if (typeof DeadList !== 'undefined' && DeadList.onChange) DeadList.onChange(function (k) {
      var hit = function (c) { return c && c.k === k; };
      chansVL.refreshWhere(hit);
      if (overlay) ovVL.refreshWhere(hit);
      if (tab === 'guide') Guide.draw();
    });
    setInterval(function () { if (tab === 'live' && !full) chansVL.refresh(); }, 60000);
    setInterval(heartbeat, 5000);
    setInterval(function () {
      if (!full) return;
      slowAsk();
      if (mode !== 'live' && !$('osd').classList.contains('hidden')) osd(false);
      if (mode === 'catchup' && cu) cuTick();
    }, 1000);
    applyLook();
  }

  /* Full themes: every colour from one palette (Settings > Appearance > Theme).  '' is "Your own mix", the
     Background (app.css body.theme-*) and Accent settings.  Colours from each theme's published palette. */
  var V = ['ink', 'panel', 'raised', 'line', 'text', 'muted', 'dim', 'accent', 'accent2', 'warn', 'air', 'ok', 'side'];
  var PALETTES = {
    mono:       ['#000000', '#0e0e0e', '#1c1c1c', '#3a3a3a', '#ffffff', '#c4c4c4', '#8a8a8a', '#ffffff', '#d6d6d6', '#e6e6e6', '#ffffff', '#d6d6d6', '#000000'],
    // Crisp darks: near-black grounds, bright text and one clear accent.
    graphite:   ['#0a0a0c', '#141417', '#1f1f24', '#2e2e35', '#f5f5f7', '#c7c7cc', '#8e8e93', '#0a84ff', '#64d2ff', '#ffd60a', '#ff453a', '#30d158', '#000000'],
    github:     ['#0d1117', '#161b22', '#21262d', '#30363d', '#f0f6fc', '#c9d1d9', '#8b949e', '#2f81f7', '#79c0ff', '#d29922', '#f85149', '#3fb950', '#010409'],
    ayu:        ['#0b0e14', '#11151c', '#191e28', '#262c38', '#e6e1cf', '#b3b1ad', '#6c7380', '#e6b450', '#39bae6', '#ffb454', '#f07178', '#aad94c', '#05070a'],
    tokyo:      ['#1a1b26', '#1f2335', '#292e42', '#3b4261', '#c0caf5', '#a9b1d6', '#565f89', '#7aa2f7', '#7dcfff', '#e0af68', '#f7768e', '#9ece6a', '#16161e'],
    dracula:    ['#282a36', '#303341', '#44475a', '#525670', '#f8f8f2', '#c5c8de', '#6272a4', '#bd93f9', '#ff79c6', '#f1fa8c', '#ff5555', '#50fa7b', '#21222c'],
    nord:       ['#2e3440', '#3b4252', '#434c5e', '#4c566a', '#eceff4', '#d8dee9', '#7b88a1', '#88c0d0', '#81a1c1', '#ebcb8b', '#bf616a', '#a3be8c', '#272c36'],
    gruvbox:    ['#282828', '#32302f', '#3c3836', '#504945', '#ebdbb2', '#bdae93', '#7c6f64', '#fabd2f', '#fe8019', '#fe8019', '#fb4934', '#b8bb26', '#1d2021'],
    catppuccin: ['#1e1e2e', '#262637', '#313244', '#45475a', '#cdd6f4', '#a6adc8', '#6c7086', '#cba6f7', '#89b4fa', '#f9e2af', '#f38ba8', '#a6e3a1', '#181825'],
    solarized:  ['#002b36', '#073642', '#0b4250', '#2a5561', '#eee8d5', '#93a1a1', '#657b83', '#268bd2', '#2aa198', '#b58900', '#dc322f', '#859900', '#00212b'],
    onedark:    ['#282c34', '#2c313a', '#353b45', '#3e4451', '#dcdfe4', '#abb2bf', '#5c6370', '#61afef', '#56b6c2', '#e5c07b', '#e06c75', '#98c379', '#21252b'],
    rosepine:   ['#191724', '#1f1d2e', '#26233a', '#403d52', '#e0def4', '#908caa', '#6e6a86', '#c4a7e7', '#ebbcba', '#f6c177', '#eb6f92', '#9ccfd8', '#13111e'],
    everforest: ['#2d353b', '#343f44', '#3d484d', '#475258', '#d3c6aa', '#9da9a0', '#7a8478', '#a7c080', '#83c092', '#dbbc7f', '#e67e80', '#a7c080', '#272e33'],
    kanagawa:   ['#1f1f28', '#2a2a37', '#363646', '#54546d', '#dcd7ba', '#c8c093', '#727169', '#7e9cd8', '#7fb4ca', '#e6c384', '#ff5d62', '#98bb6c', '#16161d'],
    monokai:    ['#272822', '#2f302a', '#3e3d32', '#49483e', '#f8f8f2', '#cfcfc2', '#75715e', '#a6e22e', '#66d9ef', '#e6db74', '#f92672', '#a6e22e', '#1e1f1c'],
    // Terminal: green phosphor on black, with a few extras in app.css (body.pal-terminal).
    terminal:   ['#000000', '#03120a', '#062414', '#0e3a20', '#4dff88', '#2fd16a', '#1d8a46', '#39ff7a', '#00e5ff', '#ffcc33', '#ff4d6d', '#39ff7a', '#000000']
  };
  var PALETTE_NAMES = { mono: 'Black and white', tokyo: 'Tokyo Night', dracula: 'Dracula', nord: 'Nord', gruvbox: 'Gruvbox', catppuccin: 'Catppuccin Mocha', solarized: 'Solarized Dark',
    onedark: 'One Dark', rosepine: 'Rosé Pine', everforest: 'Everforest', kanagawa: 'Kanagawa', monokai: 'Monokai',
    graphite: 'Graphite', github: 'GitHub Dark', ayu: 'Ayu Dark', terminal: 'Terminal' };
  /* Category colours for a theme: the theme's own colours first (its second accent, warning, live and ok
     colours), then a fixed set; each category gets the one whose hue is furthest from the accent (the focused
     programme's colour) and from those already taken, so no two sit close together. */
  var KIND_DEFAULT = ['#b48cff', '#3ddc97', '#f2b33d', '#ff7eb6', '#33c9e1'], KIND_MORE = ['#ff9f43', '#5b8cff', '#a3e635', '#e5484d', '#f472b6', '#14b8a6'];
  function hsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null;
    var n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: s, l: l };
  }
  function hueGap(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function kindColours(pal, acc) {
    var own = pal ? [pal.accent2, pal.warn, pal.air, pal.ok] : [];
    var pool = own.concat(KIND_DEFAULT, KIND_MORE).map(function (c) { return { c: c, x: hsl(c) }; })
      .filter(function (p, i, all) { return p.x && p.x.s > 0.3 && p.x.l > 0.35 && p.x.l < 0.85 && all.findIndex(function (q) { return q.c.toLowerCase() === p.c.toLowerCase(); }) === i; });
    var a = hsl(acc), taken = [], out = [];
    for (var k = 0; k < 5; k++) {
      var best = null, bs = -1;
      // Your own mix: each category keeps its usual colour unless the accent (or one taken) is close to it.
      if (!pal) {
        var d = pool.findIndex(function (p) { return p.c === KIND_DEFAULT[k]; });
        if (d >= 0 && taken.indexOf(d) < 0 && (!a || a.s <= 0.2 || hueGap(pool[d].x.h, a.h) >= 35) && taken.every(function (t) { return hueGap(pool[d].x.h, pool[t].x.h) >= 30; })) { taken.push(d); out.push(pool[d].c); continue; }
      }
      pool.forEach(function (p, i) {
        if (taken.indexOf(i) >= 0) return;
        var gap = Math.min.apply(null, [a && a.s > 0.2 ? hueGap(p.x.h, a.h) : 180].concat(taken.map(function (t) { return hueGap(p.x.h, pool[t].x.h); })));
        var score = Math.min(gap, 60) + (i < own.length ? 8 : 0);       // apart enough; then the theme's own
        if (score > bs) { bs = score; best = i; }
      });
      if (best == null) { out.push(KIND_DEFAULT[k]); continue; }
      taken.push(best); out.push(pool[best].c);
    }
    return out;
  }
  function palette(id) { var p = PALETTES[id]; if (!p) return null; var o = {}; V.forEach(function (k, i) { o[k] = p[i]; }); return o; }
  function applyLook() {
    var pal = palette(Store.settings.palette), root = document.documentElement.style;
    // A full theme sets every colour; your own mix leaves app.css's (and body.theme-*) to it.
    V.forEach(function (k) { if (k !== 'accent') { if (pal) root.setProperty('--' + k, pal[k]); else root.removeProperty('--' + k); } });
    var acc = pal ? pal.accent : Store.settings.accent || '#5b8cff', on = U.onColor(acc);
    root.setProperty('--accent', acc);
    root.setProperty('--on-accent', on.fg);
    root.setProperty('--on-accent-dim', on.dim);
    // Accent used as text on the dark background: lift very dark accents so they stay readable.
    root.setProperty('--accent-text', U.luminance(acc) < 0.12 ? U.mix(acc, '#ffffff', 0.45) : acc);
    // The guide's category colours (movies, sports, news, kids, documentaries) from the theme, apart from its accent.
    kindColours(pal, acc).forEach(function (c, i) {
      root.setProperty('--k-' + 'msncd'.charAt(i), c);
      // The same colour, see-through, for a cell's background (My teams' games on now).
      var m = /^#?([0-9a-f]{6})$/i.exec(c), n = m ? parseInt(m[1], 16) : 0;
      if (m) root.setProperty('--k-' + 'msncd'.charAt(i) + '-tint', 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',.22)');
    });
    document.body.classList.toggle('dimpast', !!Store.settings.dimPast);
    document.body.classList.toggle('guide1', Store.settings.guideLines === 1);
    var s = Store.settings, b = document.body.classList;
    document.body.className.split(/\s+/).forEach(function (c) { if (/^theme-/.test(c)) b.remove(c); });
    ['ts-s', 'ts-l', 'ov-l', 'ov-h', 'now-color', 'now-off', 'gr-l', 'gr-xl', 'sub-yellow', 'sub-gold', 'sub-cyan', 'sub-green', 'sub-s', 'sub-l', 'sub-xl', 'sub-box', 'sub-solid'].forEach(function (c) { b.remove(c); });
    // Subtitle look (discussion #19): colour, size and a box behind the lines, for subtitles TiviBro draws and the TV's own.
    if (/^(yellow|gold|cyan|green)$/.test(s.subColor)) b.add('sub-' + s.subColor);
    if (/^(s|l|xl)$/.test(s.subSize)) b.add('sub-' + s.subSize);
    if (/^(box|solid)$/.test(s.subBack)) b.add('sub-' + s.subBack);
    // Where the lines sit, how bright they are and how heavy (subtitles TiviBro draws; the TV's own keep theirs).
    var st = document.body.style;
    st.setProperty('--sub-bottom', ({ low: '3%', up1: '14%', up2: '22%', up3: '32%' })[s.subPos] || '7%');
    st.setProperty('--sub-op', ({ 90: '0.9', 75: '0.75', 60: '0.6' })[s.subBright] || '1');
    st.setProperty('--sub-weight', s.subBold ? '700' : '400');
    if (s.guideRows === 'l' || s.guideRows === 'xl') b.add('gr-' + s.guideRows);
    if (!pal && s.theme && s.theme !== 'dark') b.add('theme-' + s.theme);
    b.toggle('pal', !!pal);
    b.toggle('pal-terminal', s.palette === 'terminal');
    b.toggle('focus-ring', s.focusStyle === 'ring' || (!pal && s.theme === 'contrast'));
    if (s.textSize === 's' || s.textSize === 'l') b.add('ts-' + s.textSize);
    if (s.overlay === 'l' || s.overlay === 'h') b.add('ov-' + s.overlay);
    // What's on now: the now line and a light shade up to it (as TiviMate draws it; 'off' from before means the
    // same), or also a progress bar in the cell ('fill'), or that and a coloured cell ('color').
    var nst = s.nowStyle === 'fill' || s.nowStyle === 'color' ? s.nowStyle : 'line';
    if (nst === 'line') b.add('now-off'); else if (nst === 'color') b.add('now-color');
    b.toggle('nums-even', s.numFont === 'even');
    b.toggle('nums-mono', s.numFont === 'mono');
    b.toggle('noguidenames', s.guideNames === false);
    b.toggle('twolinenames', !!s.twoLineNames);
    // webOS 6 and older put video on a plane behind the page, and a rounded clip around it can leave
    // the preview window black (reported on a 2019 C9): square corners there.
    var wv = Caps.probe().webos; b.toggle('old-video', !!wv && wv <= 6);
    if (window.Guide && Guide.draw) try { Guide.draw(); } catch (e) {}
    UI.clock();
  }

  // Watch time, recents, reminders and the sleep timer share one slow timer.
  /* A channel taking longer than usual to start, fullscreen (discussion #36): after 12 seconds without a
     picture, say what TiviBro has seen and ask: keep trying, start over, its other versions, or stop.  Once per
     start, then again a while after "Keep trying".  Off in Settings > Playback > Ask when a channel is slow. */
  var slowAt = { k: '', next: 0 }, slowOpen = null;
  function slowAsk() {
    if (mode !== 'live' || !playing || UI.modalOpen || Store.settings.slowAsk === false) return;
    var s = Player.startStatus, now = Date.now();
    if (!s || s.ms < 12000) return;
    var key = playing.k + '|' + (now - s.ms);           // this start of this channel
    if (slowAt.k === key && now < slowAt.next) return;
    if (slowAt.k !== key) { slowAt.k = key; slowAt.next = 0; }
    if (slowAt.next && now < slowAt.next) return;
    slowAt.next = Infinity;                              // until answered
    var c = playing, seen = s.http ? 'The provider answers with an error (HTTP ' + s.http + ').' : s.data ? 'Video arrives, but this TV shows no picture for it yet.' : 'Nothing has come from the provider yet.';
    var sub = seen + (s.tried.length ? '  Tried: ' + s.tried.join(', ') + '.' : '') + (s.retries ? '  ' + s.retries + ' reconnect' + (s.retries === 1 ? '' : 's') + '.' : '');
    var items = [
      { label: 'Keep trying', sub: 'Asks again in a minute if it still hasn\'t started', action: function () { slowAt.next = Date.now() + 60000; } },
      { label: 'Start over', sub: 'From the first player again, as if just picked', action: function () { slowAt.next = Date.now() + 25000; Player.retryNow(); } }
    ];
    if (L.versions && L.versions(c).length) items.push({ label: 'Other versions of this channel', sub: L.versions(c).length + ' more', action: function () { slowAt.next = Date.now() + 60000; versionsMenu(c); } });
    items.push({ label: 'Stop', sub: 'Stops trying this channel', action: function () { Player.stop(); U.toast(L.name(c) + ': stopped trying.', 4000); } });
    Log.info('player', 'Still starting after ' + Math.round(s.ms / 1000) + 's: ' + seen + (s.tried.length ? '  tried ' + s.tried.join(', ') : ''));
    slowOpen = c;
    items.forEach(function (it) { var a = it.action; it.action = function () { slowOpen = null; a(); }; });
    UI.menu(I18n.t('Still starting: {x}', { x: L.name(c) }), items, function () { slowOpen = null; slowAt.next = Date.now() + 60000; }, { sub: sub });
  }
  function heartbeat() {
    var now = Date.now();
    if (playing && mode === 'live' && Player.playing) {
      L.addWatch(playing.k, 5);
      if (!recentDone && now - playStart > 8000) { recentDone = true; L.touchRecent(playing.k); }
    }
    // Reminders are for someone using the TV: they wait while TiviBro is in the background (the TV's
    // own alert covers that, see remind.js), while a menu is open, and when nobody has touched the
    // remote for a while with nothing playing (the TV's screensaver is likely up).  The next press
    // brings the question, with Watch from the start if it began meanwhile.
    var idle = now - UI.lastInput > IDLE && !(playing && Player.playing);
    if (!document.hidden && !UI.modalOpen && !idle) dueReminder(now);
    if (sleepAt) {
      if (now >= sleepAt) { sleepAt = 0; if (full) exitFull(); Player.stop(); playing = null; stage.classList.add('off'); U.toast('Sleep timer: playback stopped'); }
      else if (sleepAt - now < 60000 && !sleepWarned) { sleepWarned = true; U.toast('Sleep timer: stopping in 1 minute'); }
    }
  }

  var IDLE = 10 * 60000;
  function dueReminder(now) {
    var rem = Store.edits.reminders, before = (+Store.settings.remindBefore || 0) * 60000;
    for (var i = 0; i < rem.length; i++) {
      var r = rem[i];
      if (r.s - before > now) continue;
      rem.splice(i, 1); Store.saveEdits();
      if (typeof Watch !== 'undefined' && Watch.doubtful && Watch.doubtful(r)) { Log.info('views', 'Dropped a reminder that was not a programme: ' + r.t); i--; continue; }
      var c = L.find(r.k), p = { s: r.s, e: r.e, t: r.t };
      // A team's game: still on that channel?  Moved: there.  Its slot given to another game: said so.
      var mv = moved(r, now);
      if (mv === 'gone') return;
      if (mv) { c = mv.c; p = mv.p; r = { k: c.k, s: p.s, e: p.e, t: p.t, w: r.w }; }
      if (!c) return;
      var late = r.s < now - 120000;
      // Over while TiviBro was away: offer it from catch-up, otherwise let it go.
      if (r.e <= now) {
        if (c.arch && r.s > now - c.arch * 86400e3) { UI.menu('You missed it:  ' + r.t, [
          { label: 'Watch it from the start', sub: 'catch-up on ' + L.name(c) + ', aired ' + U.hhmm(r.s), action: function () { playCatchup(c, p, 0); } },
          { label: 'Dismiss' }
        ]); closeSoon(r.t); }
        return;
      }
      var watchIt = function () { startChannel(c, false, function () { if (!full) goFull(); else osd(true); }); };
      if (Store.settings.remindAction === 'switch' && !late) { U.toast('Reminder: switching to ' + L.name(c) + ' for ' + r.t, 4000); watchIt(); return; }
      UI.menu((late ? 'Started at ' + U.hhmm(r.s) : 'Starting ' + (r.s > now ? 'at ' + U.hhmm(r.s) : 'now')) + ':  ' + r.t, [
        { label: 'Watch ' + L.name(c), sub: late ? 'live' : '', action: watchIt },
        late && c.arch && { label: 'Watch from the start', sub: 'catch-up', action: function () { playCatchup(c, p, 0); } },
        { label: 'Dismiss' }
      ]);
      closeSoon(r.t);
      return;
    }
  }
  // The reminder question closes by itself after "Reminder question stays for" (10 s unless set), if still up.
  function closeSoon(t) {
    setTimeout(function () { var mt = document.getElementById('modalTitle'); if (UI.modalOpen && mt && mt.textContent.indexOf(t) >= 0) UI.close(); }, (+Store.settings.remindTimeout || 10) * 1000);
  }
  /* Watch pressed on the TV's reminder alert (TiviBro opened or brought forward with launch params). */
  /* A team reminder at its time: the game, where it is now (Teams.recheck).  'gone' when the channel lists
     another game and this one is nowhere in the guide (it was said so), else { c, p } or null. */
  function moved(r, now) {
    if (!r || !/^team:/.test(r.w || '') || typeof Teams === 'undefined' || !Teams.recheck) return null;
    var x = null;
    try { x = Teams.recheck(r, now); } catch (e) {}
    if (!x) return null;
    if (x.c) { Log.info('views', 'Reminder: "' + r.t + '" is on ' + L.name(x.c) + ' now'); U.toast(RAW(I18n.t('{x} is on {y} now', { x: x.p.t, y: L.name(x.c) })), 5000); return x; }
    Log.info('views', 'Reminder: "' + r.t + '" is no longer in the guide' + (x.now ? '; its channel lists ' + x.now : ''));
    U.toast(RAW(I18n.t('{x} is no longer in the guide', { x: r.t }) + (x.now ? '.  ' + I18n.t('The channel lists {x} now.', { x: x.now }) : '')), 7000);
    return 'gone';
  }
  function openReminder(q) {
    var now = Date.now(), rem = Store.edits.reminders;
    var i = rem.findIndex(function (r) { return r.k === q.k && r.s === +q.s; });
    var r = i >= 0 ? rem.splice(i, 1)[0] : null;
    if (r) Store.saveEdits();
    var mv = moved(r, now);
    if (mv === 'gone') return;
    if (mv) { r = { k: mv.c.k, s: mv.p.s, e: mv.p.e, t: mv.p.t, w: r.w }; q = { k: r.k, s: r.s }; }
    var c = L.find(q.k);
    if (!c) { U.toast('That channel is not in this playlist any more'); return; }
    Log.info('views', 'Opened from a reminder: ' + (r ? r.t : q.k));
    var p = r ? { s: r.s, e: r.e, t: r.t } : null;
    if (UI.modalOpen) UI.close();
    if (p && p.e <= now && c.arch) return playCatchup(c, p, 0);
    if (p && p.s < now - 120000 && c.arch) {
      startChannel(c, false, goFull);
      UI.menu('Started at ' + U.hhmm(p.s) + ':  ' + p.t, [{ label: 'Keep watching live' }, { label: 'Watch from the start', sub: 'catch-up', action: function () { playCatchup(c, p, 0); } }]);
      return;
    }
    startChannel(c, false, goFull);
  }

  function reload(keepGroup) {
    buildTabs();
    var gs = L.groups(true);
    var gid = keepGroup && curGroup ? curGroup : startGroup(gs);
    if (!gs.some(function (g) { return g.id === gid; })) gid = firstFilled(gs);
    var gi = Math.max(0, gs.findIndex(function (g) { return g.id === gid; }));
    groupsVL.setItems(gs, gi);
    var g0 = groupsVL.current();
    showGroup(g0 ? g0.id : L.ALL, keepGroup);
  }
  /* The group the lists open on (Settings > Appearance > Lists open on): where you left off, the first group with
     channels, or the one picked (the first one with channels when it's gone or empty). */
  function openOn() { var o = Store.settings.openOn; return o === 'first' || o === 'group' ? o : 'last'; }
  function startGroup(gs) {
    var o = openOn(), want = Store.settings.openGroup;
    if (o === 'first') return firstFilled(gs);
    if (o === 'group') return want && gs.some(function (g) { return g.id === want; }) && L.channels(want).length ? want : firstFilled(gs);
    return Store.edits.lastGroup || L.ALL;
  }
  // First group that actually has channels (an empty Favorites should never be the landing group).
  function firstFilled(gs) {
    gs = gs || L.groups();
    for (var i = 0; i < gs.length; i++) if (!gs[i].head && !gs[i].hidden && L.channels(gs[i].id).length) return gs[i].id;
    return gs[0] ? gs[0].id : L.ALL;
  }
  var EMPTY = 'No channels in this group.  Hold OK on any channel and choose "Copy to group" to add some.';
  // An empty group says why, and what to do about it.
  function emptyFor(gid) {
    if (gid === L.TEAMS && typeof Teams !== 'undefined') return Teams.emptyText();
    if (gid === L.MOVIES && typeof Movies !== 'undefined') return Movies.emptyText();
    if (gid === L.FAV) return 'No Favorites yet.  Hold OK on a channel and choose "Add to Favorites".';
    if (L.isCustom(gid)) return EMPTY;
    var all = L.channels(gid, true);
    if (all.length) return 'Every channel in this group is hidden.  Settings > Channels and groups > Hidden channels shows them again.';
    return 'Your provider sends no channels in this group right now.';
  }
  function showGroup(gid, keepSel) {
    var prev = chansVL.current();
    curGroup = gid;
    var list = L.channels(gid);
    var sel = 0;
    var want = keepSel && prev ? prev.k : (playing ? playing.k : null);
    if (want) { var i = list.findIndex(function (c) { return c.k === want; }); if (i >= 0) sel = i; }
    chansVL.empty = emptyFor(gid);
    chansVL.setItems(list, sel);
    $('chanTitle').textContent = L.groupName(gid) + '  ' + list.length;
    updateInfo();
  }
  function groupLocked(g) { return g && g.blocked && !Parental.blockedOk({ k: '', g: g.id }); }
  var groupDeb = U.debounce(function (g) {
    if (!g || g.id === curGroup) return;
    if (groupLocked(g)) { curGroup = g.id; chansVL.setItems([], 0); $('chanTitle').textContent = g.name + '  locked'; return; }
    showGroup(g.id); Store.edits.lastGroup = g.id; Store.saveEdits();
  }, 220);
  function onGroupSel(i, g) { groupDeb(g); }

  var previewDeb = U.debounce(function () {
    var c = chansVL.current();
    if (!c || full || tab !== 'live' || zone !== 'channels' || pick) return;
    if (!Parental.blockedOk(c)) return;
    if (Store.settings.previewPlay && (!playing || playing.k !== c.k || mode !== 'live')) startChannel(c, true);
  }, 450);
  // While an arrow is held the info panel waits until the remote rests, so the list keeps up.
  var infoT = 0;
  function onChanSel() {
    clearTimeout(infoT);
    if (UI.repeating) infoT = setTimeout(updateInfo, 120); else updateInfo();
    previewDeb();
  }

  function updateInfo() {
    var c = chansVL && chansVL.current();
    var now = $('infoNow'), next = $('infoNext');
    now.innerHTML = ''; next.textContent = '';
    if (!c) return;
    if (!Parental.blockedOk(c)) { now.appendChild(U.el('div', '', L.name(c))); now.appendChild(U.el('small', '', 'Locked.  Press OK and enter the PIN.')); return; }
    var nn = Epg.nowNext(c);
    now.appendChild(U.el('div', '', nn && nn.now ? nn.now.t : L.name(c)));
    if (nn && nn.now) {
      var pg = Epg.pubSource(c);
      now.appendChild(U.el('small', '', (nn.now.up ? T('Starts {x}', { x: Events.when(nn.now.e) }) : nn.now.ended ? T('Ended {x}', { x: Events.when(nn.now.s) }) : T('{x} to {y}', { x: U.hhmm(nn.now.s), y: U.hhmm(nn.now.e) })) + '   ' + L.name(c) + (c.arch ? '   ' + T('catch-up {n} days', { n: c.arch }) : '') + (pg ? '   ' + T('public guide, {x}', { x: pg.name }) : '')));
      var nd = Epg.desc(c, nn.now); if (nd) now.appendChild(U.el('p', '', nd));
    } else {
      // No guide: what the provider wrote in the channel name (often the game or show) is the next best thing.
      var ex = Search.extra(c);
      if (ex) { now.firstChild.textContent = ex; now.appendChild(U.el('small', '', L.name(c) + '   from the channel name, no guide information')); }
      else now.appendChild(U.el('small', '', Library.noGuide(c) ? '' : nn ? 'No guide information' : 'Loading guide'));
    }
    if (nn && nn.next) next.textContent = T('Next') + '  ' + U.hhmm(nn.next.s) + '  ' + nn.next.t;
  }

  function placePreview() {
    var r = $(tab === 'guide' ? 'guidePreview' : tab === 'settings' ? 'setPreview' : tab === 'search' ? 'searchPreview' : 'previewSlot').getBoundingClientRect();
    stage.style.left = r.left + 'px'; stage.style.top = r.top + 'px';
    stage.style.width = r.width + 'px'; stage.style.height = r.height + 'px';
  }

  // Every way of starting a live channel goes through here, so the PIN check can't be skipped.
  /* buffer: a channel you chose to watch in a window (OK in the guide) starts in the rewind buffer as fullscreen would,
     so going fullscreen after doesn't tune it again; a preview while you move through the lists doesn't. */
  function startChannel(c, preview, then, buffer) {
    Parental.gate('channels', c, function () {
      if (!foSwitching) fo = null;            // picking a channel yourself ends a backup chain
      if (playing && playing.k !== c.k) lastPlayed = playing;
      if (tsh && !tsh.keep) tsEnd();
      // From a movie with subtitles downloaded for it (issue #117: they kept showing over live TV): gone.
      if (vod || mode === 'vod') Subs.reset();
      playing = c; mode = 'live'; cu = null; vod = null; lw = false;
      playStart = Date.now(); recentDone = false;
      Store.edits.last = c.k; Store.saveEdits();
      stage.classList.remove('off');
      if (Store.settings.blackSwitch) stage.classList.add('blank');
      video._subsChoice = false; video._subsWantKey = null; video._subsMemo = null; Subs.forget();           // a new playback: subtitles may turn on by themselves again
      if ((!preview || buffer) && tsAlways()) startBuffered(c);
      else Player.play(c, { preview: preview, keepTrying: foSwitching === 'back' });
      chansVL.refreshWhere(function (x) { return x && (x.k === c.k || (lastPlayed && x.k === lastPlayed.k)); });
      if (then) then();
    });
  }

  function setZone(z) {
    zone = z;
    liveZone = z;
    groupsVL.setActive(z === 'groups');
    chansVL.setActive(z === 'channels');
    hintsFor();
  }
  function hintsFor() {
    if (tab !== 'live') return;
    if (pick) UI.hints([['', 'OK  select or unselect'], ['red', 'Actions (' + pick.size + ' selected)'], ['', 'Back  done']]);
    else if (lvis) UI.hints([['', 'OK  tick or untick', 'ok'], ['', 'CH +/−  a page', 'chup'], ['', 'Back  save and finish', 'back'], ['red', 'All, none, no guide']]);
    else {
      var h = [['', zone === 'groups' ? 'OK  open group' : 'OK  watch fullscreen', 'ok'], ['', 'Hold OK  options', 'hold'], ['', zone === 'groups' ? 'Back or ◀  menu bar' : 'Back or ◀  groups', 'back']];
      var vlz = zone === 'groups' ? groupsVL : chansVL;
      if (vlz && vlz.items.length > vlz.visible) h.push(['', 'CH +/−  page', 'chup']);
      ['red', 'green', 'yellow', 'blue'].forEach(function (b) {
        var act = Keymap.get('list', b);
        if (act && act !== 'none') h.push([b, /^(chnext|chprev|last)$/.test(act) ? Keymap.SHORT[act] : Keymap.ACTIONS[act]]);
      });
      UI.hints(h);
    }
  }

  var guideSeen = false;
  function switchTab(t) {
    if (tabs.indexOf(t) < 0 && t !== 'live' && t !== 'recordings') t = home();
    if (t === 'settings' && tab !== 'settings') return Parental.gate('settings', null, function () { doSwitch(t); });
    doSwitch(t);
  }
  function doSwitch(t) {
    if (lvis && t !== 'live') endListVis(true);
    if (tab === 'media' && t !== 'media') Media.leave();
    if (tab === 'onnow' && t !== 'onnow') OnNow.leave();
    if (tab === 'sports' && t !== 'sports' && typeof SportsHub !== 'undefined') SportsHub.leave();
    if (tab === 'recordings' && t !== 'recordings' && typeof Recordings !== 'undefined') Recordings.leave();
    document.body.classList.toggle('media-open', t === 'media');
    if ((tab === 'movies' || tab === 'shows') && t !== 'movies' && t !== 'shows' && typeof VodHome !== 'undefined') VodHome.hide();                 // the clock over a backdrop gets a shadow
    if ((t === 'settings' || t === 'search') && (tab === 'guide' || tab === 'live')) pipFrom = tab;
    tab = t;
    Keymap.setContext(t === 'live' ? 'list' : t === 'guide' ? 'guide' : 'other');
    document.querySelectorAll('.tab').forEach(function (el, i) {
      var on = el.getAttribute('data-tab') === t;
      el.classList.toggle('on', on);
      el.classList.remove('focus');
      if (on) tabSel = i;
    });
    if (t !== 'guide') Guide.leave();
    ['Live', 'Guide', 'Settings', 'Vod', 'Media', 'Onnow', 'Sports', 'Recordings', 'Search'].forEach(function (x) {
      var want = t === 'movies' || t === 'shows' ? 'Vod' : t.charAt(0).toUpperCase() + t.slice(1);
      var v = $('view' + x);
      if (v) v.classList.toggle('hidden', x !== want);
    });
    if (t === 'live' || t === 'guide') {
      // Both keep the picture going: Channels shows it beside the list, the guide in its corner.
      if (playing && mode === 'live') stage.classList.remove('off'); else stage.classList.add('off');
      if (t === 'live') { placePreview(); UI.setHandler(liveKeys); setZone(liveZone); }
      else {
        // First visit after start-up: straight into the grid, on the last channel watched (like
        // TiviMate), so OK previews at once.  Later visits from the menu land on the groups.
        // (Lists open on the first or a picked group: its top, unless a channel already plays.)
        var startKey = playing && mode === 'live' ? playing.k : !guideSeen ? (openOn() === 'last' && Store.edits.last || '-') : null;
        guideSeen = true;
        Guide.open(curGroup, startKey); placePreview();
      }
    } else if ((t === 'settings' || t === 'search') && pipOK()) {
      // Settings and Search: the channel keeps playing in the top corner, like TiviMate (pip, below).
      if (t === 'settings') Settings.open(); else Search.open();
      pipUpdate();
    } else {
      // Other screens get the whole CPU: no preview decoding behind them.
      stage.classList.add('off');
      if (!full) { Player.stop(); playing = null; }
      if (t === 'settings') { Settings.open(); pipUpdate(); }
      else if (t === 'search') { Search.open(); pipUpdate(); }
      else if (t === 'movies' || t === 'shows') Vod.open(t === 'shows' ? 'series' : 'movie');
      else if (t === 'media') Media.open();
      else if (t === 'onnow') OnNow.open();
      else if (t === 'sports') SportsHub.open();
      else if (t === 'recordings') Recordings.open();
      else if (t === 'search') Search.open();
    }
  }

  /* Side menu.  Left from the first column of any screen opens it (labels showing); Up and
     Down choose a screen, OK or Right opens it (or returns to the current one), Back goes home.
     onBack restores the screen's own keys. */
  var navOnBack = null;
  function closeNav() { document.body.classList.remove('nav-open', 'nav-peek'); document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('focus'); }); }
  /* armExit: opened with Back from the home screen's top level.  Then "Press Back again to exit" shows
     at once, and the next Back on the menu bar closes TiviBro (two presses, like TiviMate). */
  function tabBar(onBack, armExit) {
    navOnBack = onBack;
    if (armExit && tab === home() && Store.settings.exitTwice !== false) { armBack(); }
    tabSel = Math.max(0, tabs.indexOf(tab));
    var tabEls = function () { return document.querySelectorAll('.tab'); };
    var paint = function () { tabEls().forEach(function (t, i) { t.classList.toggle('focus', i === tabSel); }); };
    var hintsEl = $('hints'), before = hintsEl.innerHTML;
    var done = function () { closeNav(); hintsEl.innerHTML = before; };
    document.body.classList.remove('nav-peek');
    document.body.classList.add('nav-open');
    paint();
    UI.hints([['', '▲ ▼  choose a screen'], ['', 'OK or ▶  open it', 'ok'], ['', 'Back  ' + (tab !== home() ? TAB_LABELS[home()] : 'exit TiviBro'), 'back']]);
    UI.setHandler(function (a) {
      if (a === 'up') { tabSel = Math.max(0, tabSel - 1); paint(); }
      else if (a === 'down') { tabSel = Math.min(tabs.length - 1, tabSel + 1); paint(); }
      else if (a === 'ok' || a === 'right') {
        // Edit on phone is a shortcut, not a screen: it shows the editor's QR code over the screen you are on.
        if (tabs[tabSel] === 'editor') { if (a === 'ok') { done(); onBack(); WebEdit.showJoin(); } }
        else if (tabs[tabSel] === 'report') { if (a === 'ok') { done(); onBack(); Diag.openReport(); } }
        else { done(); if (tabs[tabSel] === tab) onBack(); else switchTab(tabs[tabSel]); }
      }
      else if (a === 'back') {
        if (tab !== home()) { done(); switchTab(home()); }
        else if (bankedBack()) { /* pressed before the menu bar and its message showed */ }
        else if (Store.settings.exitTwice !== false && Date.now() - backT > 2500 && !sysAsks()) { armBack(); }
        else { done(); askExit(); }
      }
      return true;
    });
  }

  // Back to the top of the home screen arms the exit: one more Back closes TiviBro.
  function armExit() { if (tab === home() && Store.settings.exitTwice !== false) { armBack(); } }
  /* With the TV's own "Do you want to exit the app?" coming (webOS 6 and later), that box is the second
     step, so TiviBro shows no "Press Back again" of its own on top of it: the press that would have
     shown it goes straight to the TV's question. */
  /* A Back pressed before "Press Back again to exit" (or the menu bar it comes with) was on screen was
     waiting in the queue while the TV was busy: it doesn't count as the second press (discussion #36).
     The 2.5 seconds start once it shows. */
  var backSeen = 0;
  function armBack() {
    backT = Date.now(); backSeen = Infinity;
    if (!sysAsks()) U.toast('Press Back again to exit', 2500);
    UI.afterPaint(function (t) { backSeen = t; backT = Date.now(); });
  }
  function bankedBack() { return Date.now() - backT < 2500 && UI.keyAt() < backSeen; }
  function sysBack() {
    var sys = window.webOSSystem || window.PalmSystem;
    return window.webOS && webOS.platformBack ? function () { webOS.platformBack(); } : sys && sys.platformBack ? function () { sys.platformBack(); } : null;
  }
  function sysAsks() { var ver = typeof Caps !== 'undefined' && Caps.webosVersion ? Caps.webosVersion(navigator.userAgent) : 0; return ver >= 6 && !!sysBack(); }
  function exitArmed() { return tab === home() && Date.now() - backT < 2500; }
  function exitApp(confirmFirst) {
    if (bankedBack()) return;
    if ((confirmFirst || Store.settings.exitTwice) && Date.now() - backT > 2500 && !sysAsks()) { armBack(); return; }
    askExit();
  }
  /* Leaving from the remote asks first, the way the TV's own apps do.  webOS 6 and later show the TV's
     "Do you want to exit the app?" when the app hands Back to the system (platformBack); on webOS 4 and 5
     that just goes to the home screen, so TiviBro asks the same question itself. */
  function askExit() {
    var back = sysBack();
    if (sysAsks()) {
      Log.info('views', 'Exit from the remote: the TV asks to confirm');
      Log.closing(true);          // if the answer is yes, the TV closes TiviBro without telling it (issue #62)
      try { back(); return; } catch (e) { Log.stillHere(); }
    }
    UI.menu('Exit TiviBro?', [{ label: 'Exit', action: exitNow }, { label: 'Cancel', current: true }]);
  }
  /* Close TiviBro.  window.close() is how a webOS web app quits; if the TV ignores it, hand Back to the
     system (PalmSystem.platformBack), which leaves the app. */
  function exitNow() {
    Log.info('views', 'Exit from the remote');
    Log.closing();
    try { stopAll(); } catch (e) {}
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      try { if (window.webOS && webOS.platformBack) webOS.platformBack(); else if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (e) {}
    }, 300);
  }

  // Buttons that follow the remote map in the channel list.  Arrows, OK and Back stay fixed.
  function listMapped(a) {
    var b = a === 'hold' ? 'long:ok' : a;
    if (b.indexOf('long:') !== 0 && Keymap.fixed('list', b)) return null;
    if (b.indexOf('num') === 0) return null;
    return Keymap.get('list', b);
  }
  function openNav() { tabBar(function () { UI.setHandler(liveKeys); setZone(liveZone); }); }
  function liveKeys(a) {
    if (pick) return pickKeys(a);
    if (lvis) return listVisKeys(a);
    if (moving) return moveKeys(a);
    if (a.indexOf('num') === 0) return zapDigit(a.slice(3)), true;
    var mapped = listMapped(a);
    if (mapped) { runAction(mapped, 'list'); return true; }
    if (zone === 'groups') {
      if (a === 'up') groupsVL.move(-1, true);              // past the first group: round to the last
      else if (a === 'down') groupsVL.move(1, true);       // past the last group: back to the first
      else if (a === 'left') openNav();
      else if (a === 'chup') groupsVL.page(-1);
      else if (a === 'chdown') groupsVL.page(1);
      else if (a === 'right' || a === 'ok') {
        groupDeb.cancel();
        var g = groupsVL.current();
        if (!g) return true;
        var go = function () { showGroup(g.id); Store.edits.lastGroup = g.id; Store.saveEdits(); setZone('channels'); };
        if (groupLocked(g)) Parental.gate('channels', { k: '', g: g.id }, go);
        else { if (g.id !== curGroup) showGroup(g.id); setZone('channels'); }
      }
      else if (a === 'back') { if (bankedBack()) { /* pressed before the screen caught up */ } else if (exitArmed()) exitApp(true); else tabBar(function () { UI.setHandler(liveKeys); setZone(liveZone); }, true); }
      return true;
    }
    if (a === 'up') chansVL.move(-1, true);
    else if (a === 'down') chansVL.move(1, true);
    else if (a === 'chup') chansVL.page(-1);
    else if (a === 'chdown') chansVL.page(1);
    else if (a === 'left') setZone('groups');
    else if (a === 'ok') {
      previewDeb.cancel();
      var c = chansVL.current();
      if (!c) return true;
      if (!playing || playing.k !== c.k || mode !== 'live') startChannel(c, false, goFull);
      else goFull();
    }
    else if (a === 'back') { setZone('groups'); armExit(); }
    return true;
  }

  /* ---------- remappable actions ---------- */
  function ctxChannel(ctx) { return ctx === 'player' ? playing : (zone === 'channels' ? chansVL.current() : null); }
  function openGroup(gid) {
    if (full) { if (mode !== 'live') return; overlay = true; ovGroup = gid; $('overlay').classList.remove('hidden'); $('osd').classList.add('hidden'); fillOverlay(playing && playing.k); return; }
    var gs = L.groups(true), i = gs.findIndex(function (g) { return g.id === gid; });
    if (i < 0) { U.toast(gid === L.RECENT ? 'No recent channels yet' : 'That group is empty'); return; }
    groupsVL.select(i); showGroup(gid); setZone('channels');
  }
  function leaveTo(t) { if (full) exitFull(true); switchTab(t); }
  function runAction(act, ctx) {
    var c = ctxChannel(ctx);
    switch (act) {
      case 'none': return;
      case 'list': if (full) openOverlay(); return;
      case 'panel': if (full) openPanel(); return;
      // Info again while the panel is up (a live channel): what's on in full, then back to the short panel.
      case 'osd': if (full) { var ob = $('osd'); if (mode !== 'vod' && mode !== 'catchup' && !ob.classList.contains('hidden') && !ob.classList.contains('more')) { ob.classList.add('more'); osdMore(); } else ob.classList.remove('more'); osd(true); } return;
      case 'menu': if (ctx === 'player') playerMenu(); else if (zone === 'groups') groupMenu(groupsVL.current()); else chanMenu(c, curGroup); return;
      case 'chnext': if (full) zap(1); else chansVL.move(1); return;
      case 'chprev': if (full) zap(-1); else chansVL.move(-1); return;
      case 'last': if (!lastPlayed) { U.toast('No previous channel yet'); return; } if (full) lastChannel(); else startChannel(lastPlayed, false, goFull); return;
      case 'rewind':
        // Playing from the drive (live pause, the rewind buffer): ◀ always rewinds, never changes channel.
        if (playing && full && (Player.tshift || (Store.settings.rewindLeft !== false && (playing.arch || Player.liveWindow())))) rewindLive();
        else if (full) lastChannel();
        return;
      case 'restart': if (c && c.arch) watchFromStart(c); else U.toast('No catch-up on this channel'); return;
      // Recording (record.js): the channel's programme on now, or stop it; the Recordings screen.
      case 'record': recordNow(ctx === 'player' ? playing : c); return;
      case 'forward': forward(); return;
      case 'timeline': if (full && !scrubStart()) U.toast(T('Nothing to go back to on this channel')); return;
      case 'recordings': if (typeof Record !== 'undefined') { if (full) exitFull(true); Record.open(); } return;
      case 'playpause': playPause(); return;
      case 'guide': leaveTo('guide'); return;
      case 'search': leaveTo('search'); return;
      case 'settings': leaveTo('settings'); return;
      case 'editor': WebEdit.showJoin(); return;
      case 'movies': if (tabs.indexOf('movies') >= 0) leaveTo('movies'); return;
      case 'shows': if (tabs.indexOf('shows') >= 0) leaveTo('shows'); return;
      case 'live': if (full && (fullFrom === 'onnow' || fullFrom === 'media' || fullFrom === 'sports')) leaveTo('live'); else if (full) exitFull(); else switchTab('live'); return;
      case 'exit': if (full) exitFull(); return;
      case 'fav': if (c) { var on = L.toggleFav(c.k); if (on == null) return; U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); if (full) osd(true); } return;
      case 'favorites': openGroup(L.FAV); return;
      case 'recents': openGroup(L.RECENT); return;
      case 'picture': cyclePicture(); return;
      case 'audio': audioMenu(); return;
      case 'cc': ccToggle(); return;
      case 'subs': subtitleMenu(); return;
      case 'sync': audioSync(); return;
      case 'sleep': sleepMenu(); return;
      case 'reconnect': Player.retryNow(); return;
      case 'buffer': peekMeter(); return;
      case 'streaminfo': streamInfo(); return;
    }
  }
  // Play resumes, Pause pauses, a combined button toggles: Play on a playing stream never pauses it.
  function playPause() {
    var k = UI.playKey;
    // Live pause: paused to the USB drive, Play carries on from there.
    if (tsh && !Player.tshift) { if (k !== 'pause') tsResume(); return; }
    if ((k === 'pause' || (k !== 'play' && !Player.paused)) && livePause()) return;
    if (k === 'play') Player.setPaused(false); else if (k === 'pause') Player.setPaused(true); else Player.togglePause();
    if (full) osd(true);
  }
  /* Aspect (discussion #31): remembered for the channel on live TV and for the movie or episode
     (its "vod:<id>" key) when one is playing; elsewhere it changes the default. */
  function aspectTarget() { return mode === 'live' ? playing : mode === 'vod' ? Player.current : null; }
  function cyclePicture() {
    var k = Player.ASPECTS.map(function (a) { return a[0]; });
    var c = aspectTarget(), on = Player.displayFor(c), i = k.indexOf(on), nk = on, first = {}, look = Player.aspectLooks(on);
    // Skip shapes that come out the same on this picture as one before them, or as the one on (Fill, 16:9 and
    // 4:3 to 16:9 on a 4:3 picture, issue #69).
    k.forEach(function (m) { var l = Player.aspectLooks(m); if (l && !first[l]) first[l] = m; });
    for (var n = 0; n < k.length; n++) {
      nk = k[(i + 1 + n) % k.length]; var l = Player.aspectLooks(nk);
      if (!l || (first[l] === nk && l !== look)) break;
    }
    Player.setAspect(nk, c);
    U.toast('Aspect: ' + Player.aspectName(nk) + (c ? (mode === 'vod' ? ' for this video' : ' for this channel') : ''));
  }
  /* Audio track: each track with its language, its sound (Dolby Digital 5.1, DTS-HD MA 7.1, AAC stereo) and its
     name in the file (Commentary, Descriptive audio), read by the TiviBro service for movies and episodes from files
     (the TV's own list only has a language).  A commentary or a described track says so. */
  var CODEC_NAMES = { ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', mp3: 'MP3', mp2: 'MP2', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', mlp: 'MLP' };
  function chName(n) { return n >= 8 ? '7.1' : n === 7 ? '6.1' : n === 6 ? '5.1' : n === 2 ? 'stereo' : n === 1 ? 'mono' : n ? n + ' channels' : ''; }
  function audioMenu() {
    var tracks = Player.audioTracks();
    if (tracks.length < 2) { U.toast('This stream has one audio track'); return; }
    var show = function (info) {
      var a = info && info.audio && info.audio.length === tracks.length ? info.audio : null;
      UI.menu('Audio track', tracks.map(function (t, i) {
        var x = a && a[i], d = Player.describeTrack ? Player.describeTrack({ label: (t.label || '') + ' ' + (x && x.title || ''), lang: t.lang, kind: t.kind, ch: x ? x.channels : t.ch }) : {};
        var lang = Subs.langName ? Subs.langName(U.lang(x && x.lang || t.lang || t.label) || '') : '';
        var sound = x ? [x.codec === 'dts' && /MA/i.test(x.profile) ? 'DTS-HD MA' : x.codec === 'dts' && /HD|X/i.test(x.profile) ? 'DTS-HD' : CODEC_NAMES[x.codec] || String(x.codec || '').toUpperCase(), chName(x.channels)].filter(Boolean).join(' ') : '';
        var what = d.commentary ? 'Commentary' : d.ad ? 'Descriptive audio' : '';
        var label = [lang || t.label, sound].filter(Boolean).join('  ·  ') || t.label;
        var sub = [t.on ? 'playing' : '', what, x && x.title && !/^(stereo|surround|5\.1|7\.1|english|main)$/i.test(x.title) && x.title.toLowerCase() !== (lang || '').toLowerCase() ? x.title : ''].filter(Boolean).join('  ·  ');
        return { label: label, sub: sub, current: t.on, action: function () { Player.setAudio(t.id); if (mode === 'vod' && vod && Subs.rememberAudio) Subs.rememberAudio(vod.meta, t); } };
      }));
    };
    var src = mode === 'vod' && vod && typeof SeekPrev !== 'undefined' ? SeekPrev._source(vod.url) : '';
    if (!src || typeof Convert === 'undefined' || !Convert.probe) return show(null);
    // The file's own track list (cached after the first time), or the plain one if it takes more than 2 s.
    var done = false, t0 = setTimeout(function () { if (!done) { done = true; show(null); } }, 2000);
    Convert.probe(src).then(function (info) { if (done) return; done = true; clearTimeout(t0); show(info); }, function () { if (done) return; done = true; clearTimeout(t0); show(null); });
  }
  function sleepMenu() {
    UI.menu('Sleep timer', [15, 30, 45, 60, 90, 120].map(function (m) {
      return { label: m + ' minutes', action: function () { sleepAt = Date.now() + m * 60000; sleepWarned = false; U.toast('Playback stops at ' + U.hhmm(sleepAt)); } };
    }).concat([{ label: 'Off', action: function () { sleepAt = 0; U.toast('Sleep timer off'); } }]));
  }

  /* ---------- multi-select ---------- */
  function startPick(first) {
    pick = new Set(first ? [first] : []);
    chansVL.refresh(); hintsFor();
  }
  /* ---------- moving a channel inside its group ----------
     Up and down carry the channel, Channel +/− a page at a time, OK or Back puts it down.
     Works in your groups and in the provider's (Settings keep "Your order" for that group). */
  var moving = null;
  function startMove(c) {
    if (!c || !L.canReorder(curGroup)) return;
    moving = c.k;
    chansVL.refresh();
    UI.hints([['', '▲ ▼  move    CH +/−  a page'], ['', 'OK or Back  done']]);
    U.toast('Moving ' + L.name(c) + '.  ▲ ▼ to move, OK when done.', 4000);
  }
  function endMove() { moving = null; chansVL.refresh(); hintsFor(); U.toast('Channel order saved'); }
  function moveKeys(a) {
    var step = a === 'up' ? -1 : a === 'down' ? 1 : a === 'chup' ? -(chansVL.visible - 1) : a === 'chdown' ? chansVL.visible - 1 : 0;
    if (step) {
      if (L.moveInGroup(curGroup, moving, step)) {
        var list = L.channels(curGroup), i = list.findIndex(function (x) { return x.k === moving; });
        chansVL.setItems(list, Math.max(0, i));
      }
    }
    else if (a === 'ok' || a === 'back' || a === 'hold') endMove();
    return true;
  }
  function pickKeys(a) {
    if (a === 'up') chansVL.move(-1, true);
    else if (a === 'down') chansVL.move(1, true);
    else if (a === 'chup') chansVL.page(-1);
    else if (a === 'chdown') chansVL.page(1);
    else if (a === 'ok') {
      var c = chansVL.current();
      if (c) { if (pick.has(c.k)) pick.delete(c.k); else pick.add(c.k); chansVL.refreshWhere(function (x) { return x === c; }); hintsFor(); }
    }
    else if (a === 'red' || a === 'hold') {
      var keys = Array.from(pick);
      UI.menu(pick.size + ' selected', [
        keys.length && { label: 'Copy to group…', action: function () { endPick(); copyMenu(keys, keys.length + ' channels'); } },
        keys.length && { label: 'Add to Favorites', action: function () { var n = L.copyTo(L.FAV, keys); U.toast(n + ' added to Favorites'); endPick(); } },
        keys.length && { label: 'Hide selected', action: function () { keys.forEach(function (k) { L.hideChannel(k, true); }); U.toast('Hidden.  Restore them in Settings.'); endPick(); } },
        { label: 'Select all in group', action: function () { chansVL.items.forEach(function (c) { pick.add(c.k); }); chansVL.refresh(); hintsFor(); } },
        { label: 'Clear selection', action: function () { pick.clear(); chansVL.refresh(); hintsFor(); } },
        { label: 'Done', action: endPick }
      ]);
    }
    else if (a === 'back') endPick();
    return true;
  }
  function endPick() { pick = null; refreshLists(true); hintsFor(); }

  /* ---------- fullscreen ---------- */
  // A lone press acts at once; presses in quick succession (surfing, holding the button) wait until
  // the remote rests, so a burst opens one stream instead of many.  Busy answers from providers
  // that allow one connection are retried by the player if surfing still trips them.
  function burstCommit(fn, wait) {
    var last = 0, deb = U.debounce(fn, wait);
    return function () {
      var now = Date.now(), lone = now - last > 700;
      last = now;
      if (lone) { deb.cancel(); fn(); } else deb();
    };
  }
  var zapIdx = -1, zapCommit = burstCommit(function () {
    var list = L.channels(curGroup), c = list[zapIdx];
    if (c && (!playing || playing.k !== c.k || mode !== 'live')) startChannel(c, false);
  }, 300);

  /* A channel started from somewhere else (Search, Movies on now, the phone, a reminder): the channel list and
     the guide follow it to its own group, so zapping goes through its neighbours and Back lands on it there,
     not on an empty list or a channel from the group looked at before (issue #63). */
  function followPlaying() {
    if (!playing || mode !== 'live') return;
    var k = playing.k, has = function (gid) { return L.channels(gid).some(function (c) { return c.k === k; }); };
    if (curGroup && has(curGroup)) return;
    var g = playing.g && !Store.edits.hiddenGroups[playing.g] && has(playing.g) ? playing.g : L.ALL;
    showGroup(g);
    Store.edits.lastGroup = g; Store.saveEdits();
    var gi = groupsVL.items.findIndex(function (x) { return x && x.id === g; });
    if (gi >= 0) groupsVL.select(gi);
  }
  function goFull() {
    // From another screen (Search...): Back goes to the start screen, the guide or Channels.  From Movies on
    // now, Back goes back to it, on the same movie.
    if (!full) fullFrom = tab === 'live' || tab === 'guide' || tab === 'onnow' || tab === 'media' || tab === 'sports' ? tab : home() === 'live' ? 'live' : 'guide';
    followPlaying();
    full = true;
    document.body.classList.add('full');
    stage.classList.remove('preview', 'off'); stage.classList.add('full');
    Player.upgrade(false);
    // Rewind buffer on: a channel brought to fullscreen from its window plays from the drive from now on.
    if (mode === 'live' && playing && !tsh && !Player.tshift && tsAlways()) startBuffered(playing);
    zapIdx = L.channels(curGroup).findIndex(function (c) { return playing && c.k === playing.k; });
    UI.setHandler(fullKeys);
    Keymap.setContext('player');
    osd(true);
  }
  /* away: leaving fullscreen for another screen (the side menu, a button for another screen), not Back. */
  function exitFull(away) {
    if ((fullFrom === 'onnow' || fullFrom === 'media' || fullFrom === 'sports') && (away || tab !== fullFrom)) fullFrom = home() === 'live' ? 'live' : 'guide';
    closePanel();
    peekUntil = 0; clearTimeout(peekT);
    full = false; overlay = false;
    Keymap.setContext(tab === 'live' ? 'list' : 'other');
    $('overlay').classList.add('hidden');
    document.body.classList.remove('full');
    stage.classList.remove('full'); stage.classList.add('preview');
    $('osd').classList.add('hidden');
    if (mode === 'vod') {
      var v = vod;
      vodSeekCommit();
      Vod.stopped(); Media.stopped();
      vod = null; mode = 'live'; Player.stop(); playing = null; stage.classList.add('off'); Subs.reset();
      if (v && v.onExit) v.onExit();
      return;
    }
    /* The rewind buffer keeps playing in the guide's (or Channels') window: before, it was stopped and the channel
       tuned again from the provider every time you left fullscreen, and fullscreen again started a new
       buffer.  A pause you made yourself still ends here, back to live. */
    if (tsh && tsh.always && mode === 'live' && playing && tsh.c.k === playing.k && fullFrom !== 'onnow' && fullFrom !== 'media' && fullFrom !== 'sports') { tsCard(null); if (Player.paused && Player.setPaused) Player.setPaused(false); }
    else if (tsh && mode === 'live') { var tpc = tsh.c; tsEnd(); if (playing && playing.k === tpc.k) { Player.stop(); afterTs(function () { if (playing && playing.k === tpc.k && !full) startChannel(tpc, true); }); } }
    // Back to Movies on now (or My media, after a movie on a live channel): no window for the picture, so the channel stops.
    if (fullFrom === 'onnow' || fullFrom === 'media' || fullFrom === 'sports') {
      mode = 'live'; cu = null; Player.stop();
      if (playing) lastPlayed = playing;
      playing = null; stage.classList.add('off');
      Keymap.setContext('other');
      if (fullFrom === 'media') Media.open(true); else if (fullFrom === 'sports') SportsHub.resume(); else OnNow.resume();
      return;
    }
    if (mode === 'catchup' && playing) { mode = 'live'; cu = null; Player.play(playing, { preview: true }); }
    Player.upgrade(true);
    // Back from fullscreen returns to where you came from, with the picture still playing there.
    followPlaying();
    if (fullFrom === 'guide') { if (tab !== 'guide') doSwitch('guide'); else { Guide.resume(playing && playing.k); placePreview(); } return; }
    if (tab !== 'live') doSwitch('live');
    placePreview();
    UI.setHandler(liveKeys);
    if (playing) {
      var i = L.channels(curGroup).findIndex(function (c) { return c.k === playing.k; });
      if (i >= 0) chansVL.select(i);
    }
    setZone('channels');
    updateInfo();
  }

  function fmtDur(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(x); }

  /* The full details of what's on now (Info pressed twice): the programme's kind, year, season and episode,
     TMDB's movie or series line, and the summary (the guide's, else TMDB's), with Hide spoilers kept. */
  function osdMore() {
    var box = $('osdMore'), c = playing; if (!box) return; box.innerHTML = '';
    var nn = c && Epg.nowNext(c), p = nn && nn.now;
    if (!p) { box.appendChild(U.el('p', 'om-desc', 'No guide information for this channel.')); return; }
    var mv = typeof Movies !== 'undefined' ? Movies.of(c, p) : null, sh = !mv && typeof Series !== 'undefined' ? Series.of(c, p) : null;
    var se = sh && p.ep ? Series.episode(sh, p.ep) : null, gd = Epg.desc(c, p) || '';
    var meta = mv ? ['Movie', mv.year, U.runtime(mv.runtime), mv.genre, mv.rating ? '★ ' + mv.rating + ' TMDB' : '']
      : sh ? ['Series', p.ep, se && se.t, sh.network, sh.genre, sh.rating ? '★ ' + sh.rating + ' TMDB' : '']
      : [{ s: 'Sports', n: 'News', c: 'Kids', d: 'Documentary' }[p.k] || '', p.mv ? 'Movie' : '', p.y, p.ep, p.n ? 'New' : ''];
    if ((!gd || gd.length < 60) && mv && mv.plot) gd = mv.plot;
    if ((!gd || gd.length < 60) && sh) gd = (se && se.plot) || sh.plot || gd;
    var now = Date.now(), spoil = Store.settings.noSpoilers && !p.up && (p.n || (p.s > now && !!(sh || mv || p.ep) && p.k !== 'n' && p.k !== 's'));
    if (spoil && gd) gd = 'Summary hidden, a new episode (Hide spoilers is on).';
    var line = meta.filter(Boolean).join('   ·   ');
    if (line) box.appendChild(U.el('div', 'om-meta', line));
    box.appendChild(U.el('p', 'om-desc', gd || 'The guide has no summary for this programme.'));
  }
  function osd(show, ch) {
    if (!full) return;
    if (mode !== 'vod' && typeof SeekPrev !== 'undefined') SeekPrev.hide();
    var o = $('osd'), poster = $('osdPoster');
    o.classList.toggle('vod', mode === 'vod' || mode === 'catchup');
    if (poster) { var want = mode === 'vod' && vod && vod.meta.poster || ''; if ((poster.getAttribute('src') || '') !== want) { if (want) poster.src = want; else poster.removeAttribute('src'); } }
    if (mode === 'vod' && vod) {
      var m = vod.meta;
      $('osdNum').textContent = ''; $('osdName').textContent = m.title; $('osdGroup').textContent = m.sub || '';
      var d = Player.duration, pos = vs.pending != null ? vs.pending : Player.position, jump = vs.pending != null ? vs.pending - Player.position : 0;
      $('osdNow').textContent = fmtDur(pos) + ' / ' + (d ? fmtDur(d) : '--:--') + (vs.pending != null ? '   (' + (jump < 0 ? '−' : '+') + fmtDur(Math.abs(jump)) + ')' : Player.paused ? '   paused' : '') + (d ? '   ends ' + U.hhmm(Date.now() + (d - pos) * 1000) : '');
      $('osdBar').style.width = d ? Math.round(100 * pos / d) + '%' : '0';
      $('osdNext').textContent = [Player.media, 'Keep pressing ◀ ▶ to jump further'].filter(Boolean).join('    ');
      // A picture of the movie where the seek will land (seekprev.js).
      if (typeof SeekPrev !== 'undefined') SeekPrev.show(vs.pending != null ? vs.pending : hoverT, d, vs.pending != null ? vs.dir : 0);
    } else if (mode === 'catchup' && cu) {
      var c0 = cu.c, dur = (cu.p.e - cu.p.s) / 1000, at = cu.pending != null ? cu.pending : cu.off + Player.position;
      $('osdNum').textContent = Store.settings.showNumbers ? c0.num : ''; $('osdName').textContent = L.name(c0); $('osdGroup').textContent = 'Catch-up';
      $('osdNow').textContent = U.hhmm(cu.p.s + at * 1000) + '   ' + cu.p.t + '   (' + fmtDur(at) + ' / ' + fmtDur(dur) + ')';
      $('osdBar').style.width = Math.round(100 * U.clamp(at / dur, 0, 1)) + '%';
      $('osdNext').textContent = 'Left and right skip ' + Store.settings.skip + 's    Yellow or Back returns to live';
    } else {
      var c = ch || playing;
      if (!c) return;
      $('osdNum').textContent = Store.settings.showNumbers ? c.num : '';
      $('osdName').textContent = L.name(c);
      var st = Player.stats, media = '';
      if (Store.settings.osdMedia !== false && c === playing && video.videoHeight) media = '   ·   ' + (Player.mediaInfo ? Caps.label(Object.assign({}, Player.mediaInfo, { height: video.videoHeight })) : video.videoHeight + 'p') + (st && st.engine ? '  ' + st.engine : '') + (c.arch ? '   ·   ↺ catch-up' : '');
      $('osdGroup').textContent = L.groupName(c.g) + (L.isFav(c.k) ? '   ★' : '') + media;
      var nn = Epg.nowNext(c);
      if (nn && nn.now) {
        $('osdNow').textContent = (nn.now.up || nn.now.ended ? '' : T('{x} to {y}', { x: U.hhmm(nn.now.s), y: U.hhmm(nn.now.e) }) + '   ') + nn.now.t;
        $('osdBar').style.width = nn.now.up || nn.now.ended ? '0' : Math.round(100 * (Date.now() - nn.now.s) / (nn.now.e - nn.now.s)) + '%';
      } else { $('osdNow').textContent = Search.extra(c) || (nn && !Library.noGuide(c) ? 'No guide information' : ''); $('osdBar').style.width = '0'; }
      $('osdNext').textContent = nn && nn.next ? T('Next') + '  ' + U.hhmm(nn.next.s) + '  ' + nn.next.t : '';
      // Behind live (live pause's copy on the drive, or a channel's own window): how far, and where in what's kept.
      var win = behindLive();
      if (win) $('osdNow').textContent = T('{t} behind live', { t: fmtDur(win.behind) }) + (Player.paused ? '   ·   ' + T('paused') : '') + (nn && nn.now ? '   ·   ' + nn.now.t : '');
      drawTimeline(c === playing ? timeline() : null);
    }
    if (mode !== 'live') drawTimeline(null);
    osdLegend();
    if (show) {
      if (o.classList.contains('hidden')) o.classList.remove('more');     // shown afresh: the short panel first
      o.classList.remove('hidden');
      clearTimeout(osdT);
      // The full details stay up longer (there's a summary to read); they go with the panel.
      if (ch && ch !== playing) o.classList.remove('more');
      osdT = setTimeout(function () { if (scrub) { scrubEnd(); } o.classList.add('hidden'); o.classList.remove('more'); }, scrub ? 12000 : (+Store.settings.osdTimeout || 5) * (o.classList.contains('more') ? 3 : 1) * 1000);
    }
  }

  /* What every button does right now, at the bottom of the info panel.  Follows the remote map,
     and each chip can be clicked with the Magic Remote pointer. */
  function behindLive() { if (mode !== 'live' || !(lw || Player.tshift)) return null; var w = Player.liveWindow(); return w && w.behind > (Player.tshift ? 10 : 4) ? w : null; }
  function osdLegend() {
    var el = $('osdKeys'), items = [];
    function chip(key, label, color) { items.push([key, label, color]); }
    if (mode === 'vod') { chip('ok', 'Pause'); chip('left', '◀ ▶  Skip ' + Store.settings.skip + 's'); if (typeof SeekPrev !== 'undefined' && SeekPrev.chapters.length > 1) { chip('down', '▼  Chapters'); chip('chup', 'CH  Next chapter'); } else chip('chup', 'CH  Skip 10 min'); chip('red', 'Options', 'red');
      // A recording: Back goes back to Recordings, and one still recording has its channel, live, on yellow.
      var recm = vod && vod.meta.item && vod.meta.item.recording;
      if (recm && vod.meta.liveCh) chip('yellow', 'Live', 'yellow');
      chip('back', recm ? 'Back  Recordings' : 'Back  Stop'); }
    else if (scrub) { chip('left', '◀ ▶  Move'); chip('ok', 'OK  Watch from here'); chip('back', 'Back  Cancel'); }
    else if (behindLive()) { chip('up', '▲  Timeline'); (function () { var ka = Keymap.get('player', 'ok'); if (ka && ka !== 'none') chip('ok', 'OK  ' + (ka === 'panel' ? 'Pause, record, more' : ka === 'playpause' ? (Player.paused ? 'Play' : 'Pause') : Keymap.SHORT[ka] || Keymap.ACTIONS[ka])); })(); chip('left', '◀ ▶  Skip ' + Store.settings.skip + 's'); chip('back', 'Back  Live'); chip('red', 'Options', 'red'); }
    else if (mode === 'catchup') { chip('ok', 'Pause'); chip('left', '◀ ▶  Skip ' + Store.settings.skip + 's'); chip('up', '▲ ▼  Skip 5 min'); chip('yellow', 'Back to live', 'yellow'); chip('red', 'Options', 'red'); }
    else {
      var g = function (b) { var a = Keymap.get('player', b); return a && a !== 'none' ? Keymap.SHORT[a] || Keymap.ACTIONS[a] : ''; };
      // The quick menu starts with Pause, Rewind and Record: said here, as a Magic Remote has no buttons for them.
      if (g('ok')) chip('ok', 'OK  ' + (Keymap.get('player', 'ok') === 'panel' ? 'Pause, record, more' : g('ok')));
      // With the info bar up, ▲ is the timeline (live pause, the rewind buffer or a recording), whatever ▲ is set to.
      // (The legend is drawn before the bar shows, so this can't wait for it: "▲  Recent" once showed with the dot there.)
      var tlUp = canScrub();
      if (tlUp) chip('up', '▲  Timeline');
      if (!tlUp && Keymap.get('player', 'up') === 'chprev' && Keymap.get('player', 'down') === 'chnext') chip('down', '▲ ▼  Change channel');
      else { if (g('up') && !tlUp) chip('up', '▲  ' + g('up')); if (g('down')) chip('down', '▼  ' + g('down')); }
      // ◀ rewinds what's kept (live pause, the rewind buffer, a DASH window) or catch-up, else it's the last channel.
      // (Settings > Playback > ◀ on a live channel with catch-up: Last channel, issue #128: the hint still said Rewind.)
      var canBack = Player.tshift || (Store.settings.rewindLeft !== false && (!!Player.liveWindow() || (playing && playing.arch)));
      if (g('left')) chip('left', '◀  ' + (Keymap.get('player', 'left') === 'rewind' && !canBack ? 'Last channel' : g('left')));
      if (g('right')) chip('right', '▶  ' + g('right'));
      ['red', 'green', 'yellow', 'blue'].forEach(function (b) { if (g(b)) chip(b, g(b), b); });
      chip('back', 'Back  ' + (fullFrom === 'live' ? 'Channels' : fullFrom === 'onnow' ? 'Movies on now' : fullFrom === 'sports' ? 'Sports' : fullFrom === 'media' ? 'My media' : 'Guide'));
    }
    var sig = JSON.stringify(items);
    var lg = typeof I18n !== 'undefined' ? I18n.lang() : '';
    if (el._sig === sig + lg) return;
    el._sig = sig + lg; el.innerHTML = '';
    items.forEach(function (x) {
      var s = U.el('span', 'clickable'); s.setAttribute('data-key', x[0]);
      if (x[2]) s.appendChild(U.el('b', 'k-' + x[2]));
      // The button ("OK", "▲ ▼", "Back") and what it does, each in the language.
      s.appendChild(document.createTextNode(String(x[1]).split('  ').map(function (p) { return T(p); }).join('  ')));
      el.appendChild(s);
    });
  }

  // Feedback while switching: the full info panel, or just the number and name (Settings).
  function zapShow(c) {
    if (Store.settings.osdOnZap !== false) return osd(true, c);
    var z = $('zapNum'); z.textContent = (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c); z.classList.remove('hidden');
    clearTimeout(zapShow.t); zapShow.t = setTimeout(function () { z.classList.add('hidden'); }, 1500);
  }
  /* Zapping goes from the channel playing (discussion #60: after switching to a recent channel, CH+ went on from the
     channel before it).  Between presses of a burst it goes from the one shown, which hasn't started yet. */
  var zapAt = 0;
  function zap(d) {
    var now = Date.now(), burst = now - zapAt < 1500;
    zapAt = now;
    if (!burst && playing && mode === 'live') {
      followPlaying();
      var at = L.channels(curGroup).findIndex(function (c) { return c.k === playing.k; });
      if (at >= 0) zapIdx = at;
    }
    var list = L.channels(curGroup);
    if (!list.length) return;
    if (zapIdx < 0) zapIdx = 0;
    zapIdx = (zapIdx + d + list.length) % list.length;
    zapShow(list[zapIdx]);
    Epg.request(list[zapIdx]);
    zapCommit();
  }
  // Pressing Last repeatedly flips between two channels on screen; only the one you stop on starts.
  var lastTarget = null, lastCommit = burstCommit(function () {
    var c = lastTarget; lastTarget = null;
    if (!c || (playing && playing.k === c.k && mode === 'live')) return;
    startChannel(c, false, function () { zapIdx = L.channels(curGroup).findIndex(function (x) { return x.k === playing.k; }); osd(true); });
  }, 350);
  function lastChannel() {
    if (!lastPlayed && !lastTarget) return;
    lastTarget = lastTarget ? (lastTarget.k === (playing && playing.k) ? lastPlayed : playing) : lastPlayed;
    if (!lastTarget) return;
    zapShow(lastTarget);
    lastCommit();
  }

  /* Seeking in movies and shows.  Presses add up on screen and the player jumps once you stop
     (one seek instead of five), and pressing the same way again and again goes further each
     time, so a long jump doesn't take thirty presses. */
  var vs = { pending: null, t: 0, n: 0, dir: 0, last: 0 };
  function seekAccel(dir) {
    var now = Date.now();
    vs.n = vs.dir === dir && now - vs.last < 900 ? vs.n + 1 : 0;
    vs.dir = dir; vs.last = now;
    return vs.n < 3 ? 1 : vs.n < 6 ? 2 : vs.n < 10 ? 4 : 8;
  }
  function vodSeek(delta, accel) {
    if (accel) delta *= seekAccel(delta > 0 ? 1 : -1);
    var d = Player.duration, base = vs.pending != null ? vs.pending : Player.position, t = base + delta;
    t = d ? U.clamp(t, 0, Math.max(0, d - 3)) : Math.max(0, t);
    vs.pending = t;
    clearTimeout(vs.t); vs.t = setTimeout(vodSeekCommit, 650);
    osd(true);
  }
  function vodSeekCommit() { clearTimeout(vs.t); if (vs.pending == null) return; var t = vs.pending; vs.pending = null; if (vod && vod.meta.local && Media.seeking) Media.seeking(t); Player.seekTo(t); osd(true); }
  function vodSeekCancel() { clearTimeout(vs.t); vs.pending = null; vs.n = 0; osd(true); }
  // Magic Remote: over the bar, the picture where a click would land (seekprev.js); click anywhere on it to jump there.
  var hoverT = null;
  $('osdBar').parentNode.addEventListener('mousemove', function (e) {
    if (mode !== 'vod' || !Player.duration) return;
    var r = this.getBoundingClientRect(); hoverT = U.clamp((e.clientX - r.left) / r.width, 0, 1) * Player.duration; osd(true);
  });
  $('osdBar').parentNode.addEventListener('mouseleave', function () { if (hoverT != null) { hoverT = null; osd(true); } });
  $('osdBar').parentNode.addEventListener('click', function (e) {
    e.stopPropagation();
    var r = this.getBoundingClientRect(), f = U.clamp((e.clientX - r.left) / r.width, 0, 1);
    if (mode === 'vod' && Player.duration) { vs.pending = f * Player.duration; vodSeekCommit(); }
    else if (mode === 'catchup' && cu) { var dur = (cu.p.e - cu.p.s) / 1000, base = cu.pending != null ? cu.pending : cu.off + Player.position; cuSeek(f * dur - base); }
  });

  function fullKeys(a) {
    if (overlay) return overlayKeys(a);
    // Paused to the USB drive (the picture let go): OK or Play carries on, Back or Stop is live again.
    if (tsh && !Player.tshift && mode === 'live') {
      if (a === 'ok' || a === 'playpause') { if (a === 'ok' || UI.playKey !== 'pause') tsResume(); return true; }
      if (a === 'back' || a === 'stop' || a === 'yellow') { var tc = tsh.c; tsEnd(); afterTs(function () { startChannel(tc, false, function () { osd(true); }); }); return true; }
      if (a === 'chup' || a === 'chdown' || a === 'red' || a === 'hold' || a === 'info') tsEnd();
      else return true;
    }
    // The error message says "Press OK to try again", so OK does exactly that.
    if (a === 'ok' && !verr.classList.contains('hidden')) { Player.retryNow(); U.toast('Trying again'); return true; }
    var hidden = $('osd').classList.contains('hidden');
    if (mode === 'vod') {
      // Skip intro or Up next showing (skipper.js): OK does it, Back hides it.
      if (typeof SeekPrev !== 'undefined' && SeekPrev.chapterKey(a)) return true;     // the chapter strip, while open
      if (typeof Skipper !== 'undefined' && vs.pending == null && Skipper.key(a)) return true;
      if (a === 'back') { if (vs.pending != null) { vodSeekCancel(); return true; } if (!hidden) { $('osd').classList.add('hidden'); return true; } exitFull(); }
      else if (a === 'left') vodSeek(-Store.settings.skip, true);
      else if (a === 'stop') exitFull();       // discussion #36: Stop on the remote stops the movie (where it got to is kept)
      // A recording still recording: yellow goes to the channel, live.
      else if (a === 'yellow' && vod && vod.meta.liveCh) { var lc = vod.meta.liveCh; vod.onExit = null; exitFull(); startChannel(lc, false, goFull); }
      else if (a === 'right') vodSeek(+Store.settings.skip, true);
      // CH+ CH−: the next or previous chapter in a file with chapters, else 10 minutes like ▲ ▼.
      else if ((a === 'chdown' || a === 'chup') && typeof SeekPrev !== 'undefined' && SeekPrev.chapters.length > 1) { var ct = SeekPrev.chapterStep(a === 'chup' ? 1 : -1, vs.pending != null ? vs.pending : Player.position); if (ct >= 0) vodSeek(ct - (vs.pending != null ? vs.pending : Player.position)); }
      /* ▲ ▼ don't seek (people press Down by habit, as on Plex): they bring up the bar, and Down with the bar up
         opens the chapters when the file has them.  CH+ CH− still jump 10 minutes (or a chapter). */
      else if (a === 'up' || a === 'down') {
        if (vs.pending != null) return true;
        if (a === 'down' && !hidden && typeof SeekPrev !== 'undefined' && SeekPrev.chapters.length > 1) SeekPrev.openChapters(function (t) { vs.pending = t; vodSeekCommit(); }, function () { osd(true); });
        else osd(true);
      }
      else if (a === 'chdown') vodSeek(-600);
      else if (a === 'rew') vodSeek(-(+Store.settings.ffStep || 120), true);
      else if (a === 'ff') vodSeek(+Store.settings.ffStep || 120, true);
      else if (a === 'chup') vodSeek(600);
      else if (a === 'ok') { Player.togglePause(); osd(true); }
      else if (a === 'playpause') playPause();
      else if (a === 'red' || a === 'hold') playerMenu();
      else if (a === 'info') osd(true);
      else if (Keymap.get('player', a) === 'buffer') peekMeter();
      else if (Keymap.get('player', a) === 'streaminfo') streamInfo();
      return true;
    }
    if (scrub && mode === 'live') {
      if (a === 'left') scrubMove(-Store.settings.skip * seekAccel(-1));
      else if (a === 'right') scrubMove(+Store.settings.skip * seekAccel(1));
      else if (a === 'rew') scrubMove(-(+Store.settings.ffStep || 120) * seekAccel(-1));
      else if (a === 'ff') scrubMove((+Store.settings.ffStep || 120) * seekAccel(1));
      else if (a === 'ok' || a === 'playpause') scrubGo();
      else if (a === 'back' || a === 'down' || a === 'up') { scrubEnd(); osd(true); }
      return true;
    }
    // The info bar up on a channel with something to go back to: ▲ takes the timeline's dot (TiviMate does this).
    if (a === 'up' && mode === 'live' && !hidden && canScrub()) { scrubStart(); return true; }
    /* Behind live (a rewind, a pause carried on, the timeline): ◀ ▶ move back and forth whatever they are set to, so
       a Magic Remote (no ⏪ ⏩ buttons) can go forward again; at the live edge ▶ is what it's set to (Info). */
    if ((lw || behindLive()) && mode === 'live') {
      var step = 0;
      if (a === 'left') step = -Store.settings.skip * seekAccel(-1);
      else if (a === 'right') step = +Store.settings.skip * seekAccel(1);
      else if (a === 'rew') step = -(+Store.settings.ffStep || 120) * seekAccel(-1);
      else if (a === 'ff') step = (+Store.settings.ffStep || 120) * seekAccel(1);
      else if (a === 'back' && !hidden) { $('osd').classList.add('hidden'); return true; }
      else if (a === 'back' || a === 'yellow' || a === 'stop') { lwLive(); return true; }
      // OK does what it's set to (Remote and buttons > In the player; the quick menu at first), not always Pause.
      if (step) { lwSeek(step); return true; }
    }
    if (mode === 'catchup') {
      if (a === 'back') { if (!hidden) { $('osd').classList.add('hidden'); return true; } backToLive(); }
      else if (a === 'left') cuSeek(-Store.settings.skip * seekAccel(-1));
      else if (a === 'right') cuSeek(+Store.settings.skip * seekAccel(1));
      else if (a === 'down' || a === 'chdown') cuSeek(-300);
      else if (a === 'rew') cuSeek(-(+Store.settings.ffStep || 120) * seekAccel(-1));
      else if (a === 'ff') cuSeek((+Store.settings.ffStep || 120) * seekAccel(1));
      else if (a === 'up' || a === 'chup') cuSeek(300);
      else if (a === 'ok') { Player.togglePause(); osd(true); }
      else if (a === 'playpause') playPause();
      else if (a === 'red' || a === 'hold') playerMenu();
      else if (a === 'yellow' || a === 'stop') backToLive();
      else if (a === 'info') osd(true);
      else if (Keymap.get('player', a) === 'buffer') peekMeter();
      else if (Keymap.get('player', a) === 'streaminfo') streamInfo();
      return true;
    }
    if (a === 'back') { if (!hidden) { $('osd').classList.add('hidden'); return true; } exitFull(); return true; }
    if (a.indexOf('num') === 0) { zapDigit(a.slice(3)); return true; }
    var act = Keymap.get('player', a === 'hold' ? 'long:ok' : a);
    if (act) runAction(act, 'player');
    return true;
  }

  /* ---------- the channel guide over the video (channels with what's on now) ---------- */
  function openOverlay() {
    overlay = true;
    ovGroup = curGroup;
    $('overlay').classList.remove('hidden');
    $('osd').classList.add('hidden');
    fillOverlay(playing && playing.k);
  }
  function fillOverlay(selKey) {
    var list = L.channels(ovGroup);
    var i = selKey ? list.findIndex(function (c) { return c.k === selKey; }) : 0;
    $('ovTitle').textContent = '◀  ' + L.groupName(ovGroup) + '  ▶';
    ovVL.setItems(list, Math.max(0, i));
  }
  function overlayKeys(a) {
    if (a === 'up') ovVL.move(-1, true);
    else if (a === 'down') ovVL.move(1, true);
    else if (a === 'chup') ovVL.page(-1);
    else if (a === 'chdown') ovVL.page(1);
    else if (a === 'left' || a === 'right') {
      var gs = L.groups().filter(function (g) { return !groupLocked(g); });
      if (!gs.length) return true;
      var gi = gs.findIndex(function (g) { return g.id === ovGroup; });
      gi = (gi + (a === 'left' ? -1 : 1) + gs.length) % gs.length;
      ovGroup = gs[gi].id; fillOverlay(null);
    }
    else if (a === 'ok') {
      // Like TiviMate: OK switches to the channel and keeps the list up so you can keep
      // surfing; OK on the channel that is already playing closes the list.
      var c = ovVL.current();
      if (!c) return true;
      var idx = ovVL.sel;
      if (playing && playing.k === c.k && mode === 'live') { closeOverlay(); osd(true); return true; }
      startChannel(c, false, function () {
        curGroup = ovGroup; zapIdx = idx;
        ovVL.refresh();
      });
    }
    else if (a === 'red' || a === 'hold' || a === 'info') chanMenu(ovVL.current(), ovGroup);
    else if (a === 'back') closeOverlay();
    else if (a === 'playpause') playPause();
    return true;
  }
  function closeOverlay() { overlay = false; $('overlay').classList.add('hidden'); }

  /* ---------- the live timeline (TiviMate's seek dot) ----------
     On a live channel with something to go back to (live pause or the rewind buffer kept on the drive, a DASH
     window, a recording of it running, or the provider's catch-up), the info bar shows the programme as a line:
     what's aired, what's kept (brighter), what's recorded (red underneath), and a dot where you're watching.  With
     the bar up, ▲ takes the dot: ◀ ▶ move it (30 s, faster held; ◀◀ ▶▶ by the bigger step), OK watches from there,
     Back or ▼ leave it.  Past the end is live.  Before what's kept, a recording of the channel plays from there,
     else the provider's catch-up. */
  var scrub = null;
  function recOfPlaying() { var r = typeof Record !== 'undefined' && playing ? Record.of(playing, null) : null; return r && r.status === 'recording' && r.startedAt ? r : null; }
  function timeline() {
    if (mode !== 'live' || !playing) return null;
    var now = Date.now(), w = Player.liveWindow(), rec = recOfPlaying(), arch = playing.arch;
    if (!w && !rec && !arch) return null;
    var lag = w ? Math.max(0, w.behind) * 1000 : 0;
    var keptFrom = w ? now - (w.end - w.start) * 1000 : now, at = w ? now - lag : now;
    var nn = Epg.nowNext(playing), p = nn && nn.now && nn.now.s <= now && nn.now.e > now ? nn.now : null;
    var from = p ? p.s : Math.min(keptFrom, rec ? rec.startedAt : now, now - 30 * 60000), to = p ? p.e : now + 5 * 60000;
    // How far back the dot can go: the kept window, a recording's start, or the programme's start with catch-up.
    var floor = Math.min(keptFrom, rec ? rec.startedAt : keptFrom, arch ? from : keptFrom);
    return { from: Math.min(from, floor), to: Math.max(to, now + 60000), now: now, keptFrom: keptFrom, at: at, rec: rec, floor: floor, p: p, w: w };
  }
  function tlEls() {
    var bar = $('osdBar').parentNode;
    if (!bar._tl) {
      bar._tl = { kept: U.el('i', 'tl-kept'), recd: U.el('i', 'tl-rec'), dot: U.el('b', 'tl-dot'), ghost: U.el('b', 'tl-ghost'), label: U.el('span', 'tl-label') };
      ['kept', 'recd', 'dot', 'ghost', 'label'].forEach(function (k) { bar.appendChild(bar._tl[k]); });
    }
    return bar._tl;
  }
  function drawTimeline(tl) {
    var o = $('osd'), bar = $('osdBar').parentNode, e = tlEls();
    o.classList.toggle('tl', !!tl); o.classList.toggle('scrub', !!(tl && scrub));
    if (!tl) return;
    var span = Math.max(1, tl.to - tl.from), pc = function (t) { return U.clamp((t - tl.from) / span, 0, 1) * 100 + '%'; };
    $('osdBar').style.width = pc(tl.now);
    e.kept.style.left = pc(tl.keptFrom); e.kept.style.width = 'calc(' + pc(tl.now) + ' - ' + pc(tl.keptFrom) + ')';
    e.kept.style.display = tl.w ? '' : 'none';
    e.recd.style.display = tl.rec ? '' : 'none';
    if (tl.rec) { e.recd.style.left = pc(Math.max(tl.from, tl.rec.startedAt)); e.recd.style.width = 'calc(' + pc(tl.now) + ' - ' + pc(Math.max(tl.from, tl.rec.startedAt)) + ')'; }
    e.dot.style.left = pc(tl.at);
    e.ghost.style.display = scrub ? '' : 'none'; e.label.style.display = scrub ? '' : 'none';
    if (scrub) {
      e.ghost.style.left = pc(scrub.t);
      var behind = Math.round((tl.now - scrub.t) / 1000);
      e.label.textContent = behind < 8 ? T('Live') : U.hhmm(scrub.t) + '  ·  ' + T('{t} behind live', { t: fmtDur(behind) });
      // Over the handle, but kept inside the bar at either end (it ran off the screen's edge near the start).
      var bw = bar.clientWidth, lw = e.label.offsetWidth, x = U.clamp((scrub.t - tl.from) / span, 0, 1) * bw;
      e.label.style.left = (bw && lw ? U.clamp(x, lw / 2, Math.max(lw / 2, bw - lw / 2)) + 'px' : pc(scrub.t));
    }
  }
  function canScrub() { return !!timeline(); }
  function scrubStart() { var tl = timeline(); if (!tl) return false; scrub = { t: tl.at }; osd(true); return true; }
  function scrubEnd() { scrub = null; drawTimeline(timeline()); }
  function scrubMove(sec) {
    var tl = timeline(); if (!tl || !scrub) return;
    scrub.t = U.clamp(scrub.t + sec * 1000, tl.floor, tl.now);
    osd(true);
  }
  function scrubGo() {
    var tl = timeline(), t = scrub && scrub.t; scrub = null;
    if (!tl || t == null) return osd(true);
    if (tl.now - t < 8000) { if (Player.tshift || lw) lwLive(); else U.toast(T('Live')); return osd(true); }
    // In what's kept on the drive (or a DASH window): move there.
    if (tl.w && t >= tl.keptFrom - 2000) { lw = true; Player.liveSeek((t - tl.at) / 1000); osd(true); return; }
    // Before it: the recording of this channel, from that point.
    if (tl.rec && t >= tl.rec.startedAt) { Record.watch(tl.rec, false, null, (t - tl.rec.startedAt) / 1000); return; }
    // Else the provider's catch-up, in the programme that was on then.
    if (playing.arch) {
      var list = Epg.request(playing) || [], q = null;
      for (var i = 0; i < list.length; i++) if (list[i].s <= t && list[i].e > t) { q = list[i]; break; }
      q = q || tl.p || { s: t, e: t + 3600e3, t: L.name(playing) };
      playCatchup(playing, q, (t - q.s) / 1000); return;
    }
    if (tl.w) { lw = true; Player.liveSeek(-1e6); }
    osd(true);
  }
  // ▶▶ / Forward: ahead in what's kept; at the end, live.
  function forward() {
    if (cu) { cuSeek(+(Store.settings.skip || 30)); return; }
    if (lwSeek(+(Store.settings.skip || 30))) return;
    U.toast(T('Live'));
  }
  function recordNow(c) {
    if (!c || typeof Record === 'undefined') return;
    if (!Record.base()) { U.toast(T('Recording needs TiviBro\'s helper, which isn\'t running')); return; }
    var nn = Epg.nowNext(c), p = nn && nn.now && nn.now.s <= Date.now() && nn.now.e > Date.now() ? nn.now : null, r = Record.of(c, p);
    if (r && r.status === 'recording') UI.confirm(T('Stop recording "{x}"?', { x: r.title }), 'Stop recording', function () { Record.stop(r.id).then(function () { U.toast(T('Recording stopped')); }); });
    else Record.now(c, p);
  }
  /* ---------- live pause (to a USB drive, a network share or the TV's storage) ----------
     Pause on a live channel, fullscreen, with a USB drive in (Settings > Recording and live pause > Pause live TV): the recording
     agent starts keeping the channel on the drive (timeshift.js), the player lets go of its own connection (one
     connection to the provider, as before), and Play picks up where it was paused from the drive's copy.  From
     there it's like a channel with a window: ◀ ▶ move in what's been kept, pause holds, Back or ▶ to the end is
     live.  Changing channel, catch-up, a movie or stopping lets the copy go (deleted). */
  var tsh = null;
  function tsOn() { return Store.settings.livePause !== false && typeof Record !== 'undefined' && Record.canPause(); }
  /* Where live pause keeps the channel, for the log and messages: 'usb', 'share' (the network share chosen for
     recordings) or 'tv' (the TV's own storage).  r is the helper's answer to a start, which says; without one, the
     same order the helper uses: a USB drive first, then the share. */
  function tsPlace(r) {
    if (r) return r.share ? 'share' : r.small ? 'tv' : 'usb';
    if (Record.space) return 'usb';
    return Record.pauseShare ? 'share' : 'tv';
  }
  var TS_PLACE = { usb: 'the USB drive', share: 'the network share', tv: 'the TV\'s storage' };
  /* Rewind buffer (Settings > Playback): minutes kept while watching fullscreen, 0 when off.  The channel then
     plays from its copy on the drive the whole time (a few seconds behind live), so ◀ goes back without pausing
     first.  The first piece is cut a second in (timeshift.js), and the drive's playlist waits for it, so a channel
     starts about as fast as it does directly. */
  function tsAlways() { var m = +Store.settings.rewindBuffer || 0; return m > 0 && tsOn() && Record.canBuffer() ? m : 0; }
  function startBuffered(c) {
    var my = tsh = { c: c, at: Date.now(), id: null, always: true };
    Player.stop();
    Record.tsStart(c, tsAlways() * 60).then(function (r) {
      if (tsh !== my) { Record.tsStop(r.id); return; }
      my.id = r.id; my.url = Record.base() + r.playlist;
      my.ping = setInterval(function () {
        if (tsh !== my) return;
        Record.tsPing(my.id).then(function (st) { if (tsh === my && st && st.error) { U.toast(T('Live pause stopped: {e}', { e: st.error }), 6000); backFromPause(); } },
          function (e) { if (tsh === my && e && e.gone) backFromPause(); });
      }, 10000);
      Player.play(c, { url: my.url, tshift: true, tsFrom: -1 });
      Log.info('player', 'Playing ' + L.name(c) + ' from the rewind buffer on ' + TS_PLACE[tsPlace(r)]);
    }, function (e) {
      // No drive or no agent: straight from the provider, as without the buffer.
      Log.warn('player', 'Rewind buffer didn\'t start: ' + (e && e.message || e));
      if (tsh === my) tsh = null;
      if (playing && playing.k === c.k) Player.play(c, { preview: false });
    });
  }
  function tsEnd() {
    if (!tsh) return;
    var t = tsh; tsh = null;
    clearInterval(t.ping); clearTimeout(t.wait);
    tsCard(null);
    // The drive's copy lets go of its provider connection; what's started next waits for that (afterTs), so the
    // provider never sees two at once for a channel going back to live.
    tsStopping = t.id ? Record.tsStop(t.id) : null;
  }
  var tsStopping = null;
  function afterTs(fn) {
    var p = tsStopping; tsStopping = null;
    if (!p) return fn();
    var done = false, go = function () { if (!done) { done = true; fn(); } };
    p.then(go, go); setTimeout(go, 1500);
  }
  function tsCard(c, text) {
    var el = $('tsCard');
    if (!c) { if (el) el.classList.add('hidden'); return; }
    if (!el) { el = U.el('div', 'ts-card hidden'); el.id = 'tsCard'; stage.appendChild(el); }
    if (full) stage.classList.remove('off');             // paused in fullscreen: the card shows, whatever screen it came from
    var logo = logoOf(c);
    el.innerHTML = '';
    if (logo) { var im = U.el('img', 'ts-logo'); im.src = logo; im.onerror = function () { im.remove(); }; el.appendChild(im); }
    el.appendChild(U.el('div', 'ts-title', T('Paused')));
    el.appendChild(U.el('div', 'ts-sub', text || T('{ch}  ·  since {t}', { ch: L.name(c), t: U.hhmm(tsh ? tsh.at : Date.now()) })));
    el.appendChild(U.el('div', 'ts-hint', T('OK or ▶  carry on from here  ·  Back  live')));
    el.classList.remove('hidden');
  }
  function livePause() {
    if (mode !== 'live' || !playing || !full || tsh || Player.tshift || !tsOn()) return false;
    var c = playing;
    /* The player's connection goes first, then the drive's copy opens its own: a provider that allows one connection
       refuses a second (HTTP 418 on some), and the card stands in for the picture meanwhile. */
    Player.stop();
    tsh = { c: c, at: Date.now(), id: null };
    tsCard(c);
    $('osd').classList.add('hidden');
    Record.tsStart(c).then(function (r) {
      if (!tsh || tsh.c !== c) { Record.tsStop(r.id); return; }
      tsh.id = r.id; tsh.url = Record.base() + r.playlist;
      tsh.ping = setInterval(function () {
        if (!tsh) return;
        Record.tsPing(tsh.id).then(function (st) { if (tsh && st && st.error) { U.toast(T('Live pause stopped: {e}', { e: st.error }), 6000); backFromPause(); } },
          function (e) { if (tsh && e && e.gone) backFromPause(); });
      }, 10000);
      Log.info('player', 'Paused to ' + TS_PLACE[tsPlace(r)] + ' (' + L.name(c) + ')');
      if (tsh.resume) tsResume();
    }, function (e) {
      // It didn't start: back to the channel, live, with why.
      var where = tsPlace();
      Log.warn('player', 'Live pause to ' + TS_PLACE[where] + ' didn\'t start: ' + (e && e.message || e));
      // Whole sentences, one for each place, so each translates as a sentence.
      var said = where === 'usb' ? 'Couldn\'t pause to the USB drive: {e}' : where === 'share' ? 'Couldn\'t pause to the network share: {e}' : 'Couldn\'t pause live TV: {e}';
      if (tsh && tsh.c === c) { tsEnd(); U.toast(T(said, { e: e && e.message || '' }), 5000); if (playing && playing.k === c.k) startChannel(c, false, function () { osd(true); }); }
    });
    return true;
  }
  function backFromPause() { var c = tsh && tsh.c; tsEnd(); Player.stop(); afterTs(function () { if (c && playing && playing.k === c.k) startChannel(c, !full, function () { osd(true); }); }); }
  function tsResume() {
    if (!tsh) return;
    if (!tsh.id) { tsh.resume = true; return; }
    var my = tsh;
    // The first piece is a few seconds long: wait for it.
    (function ready(n) {
      if (tsh !== my) return;
      Record.tsPing(my.id).then(function (st) {
        if (tsh !== my) return;
        if (st && st.ready) {
          tsCard(null);
          Player.play(my.c, { url: my.url, tshift: true, tsFrom: 0 });
          lw = true; osd(true);
          return;
        }
        if (st && st.error) { U.toast(T('Live pause stopped: {e}', { e: st.error }), 6000); return backFromPause(); }
        if (n === 0) tsCard(my.c, T('Getting the picture back…'));
        if (n > 40) { U.toast(T('The paused copy didn\'t start; back to live'), 5000); return backFromPause(); }
        my.wait = setTimeout(function () { ready(n + 1); }, 500);
      }, function () { backFromPause(); });
    })(0);
  }

  /* ---------- catch-up ---------- */
  function playCatchup(c, p, offSec) {
    if (!c.arch) { U.toast('This channel has no catch-up'); return; }
    if (p.s < Date.now() - c.arch * 86400e3) { U.toast('That programme is older than the archive'); return; }
    Parental.gate('channels', c, function () {
      if (playing && playing.k !== c.k) lastPlayed = playing;
      tsEnd();
      playing = c; mode = 'catchup';
      cu = { c: c, p: p, off: Math.max(0, offSec || 0), first: true, pending: null };
      stage.classList.remove('off');
      video._subsChoice = false; video._subsWantKey = null; video._subsMemo = null; Subs.forget();
      Player.play(c, { live: false, timeshift: true, urlFn: function () {
        if (!cu) return '';
        if (!cu.first) cu.off += Player.position;     // a reconnect continues from where playback reached
        cu.first = false;
        return Source.catchupUrl(c, p.s + cu.off * 1000, Math.max(p.e, p.s + cu.off * 1000 + 60000));
      } });
      if (!full) goFull(); else osd(true);
    });
  }
  var cuCommit = U.debounce(function () {
    if (!cu || cu.pending == null) return;
    var c = cu.c, p = cu.p, off = cu.pending;
    cu.pending = null;
    playCatchup(c, p, off);
  }, 600);
  function cuSeek(delta) {
    if (!cu) return;
    var dur = (cu.p.e - cu.p.s) / 1000;
    var base = cu.pending != null ? cu.pending : cu.off + Player.position;
    var target = base + delta;
    if (cu.p.s + target * 1000 > Date.now() - 15000) { backToLive(); return; }   // past "now" means live
    cu.pending = U.clamp(target, 0, Math.max(0, dur - 5));
    osd(true);
    cuCommit();
  }
  function cuTick() {
    var dur = (cu.p.e - cu.p.s) / 1000, at = cu.off + Player.position;
    if (cu.pending == null && at >= dur - 1) {
      // Roll into the next programme while it is still in the past, otherwise back to live.
      var list = Epg.request(cu.c) || [], nx = null;
      for (var i = 0; i < list.length; i++) if (list[i].s >= cu.p.e - 1000) { nx = list[i]; break; }
      if (nx && nx.s < Date.now() - 60000) playCatchup(cu.c, nx, 0); else backToLive();
    }
  }
  /* Behind live inside a DASH channel's own window (issue #85): ◀ ▶ (and ⏪ ⏩) move in it, Back, Stop or yellow go
     back to live, and ▶ past the end is live again.  Leaving the window's start falls through to catch-up when the
     channel has it. */
  function lwSeek(delta) {
    if (!playing || mode !== 'live' || !Player.liveWindow()) { lw = false; return false; }
    var w = Player.liveWindow();
    if (delta < 0 && w.at <= w.start + 4 && playing.arch) { lw = false; return false; }
    var r = Player.liveSeek(delta);
    if (!r) { lw = false; return false; }
    lw = !r.edge;
    if (r.edge) U.toast(T('Live'));
    else U.toast(T('{n} s behind live', { n: r.behind }) + (r.first ? '  ·  ' + T('as far back as this channel keeps') : ''), 2500);
    osd(true);
    return true;
  }
  function lwLive() { lw = false; Player.liveSeek(1e6); U.toast(T('Live')); osd(true); }
  function backToLive() {
    var c = cu ? cu.c : playing;
    cu = null; mode = 'live';
    if (c) startChannel(c, !full, function () { osd(true); });
  }
  function rewindLive() {
    if (lwSeek(-Store.settings.skip)) return;
    if (Player.tshift) { U.toast(T('Nothing kept to go back to yet')); return; }
    var nn = Epg.nowNext(playing);
    var p = nn && nn.now ? nn.now : { s: Date.now() - 3600e3, e: Date.now() + 3600e3, t: L.name(playing) };
    var off = Math.max(0, (Date.now() - p.s) / 1000 - Store.settings.skip);
    playCatchup(playing, p, off);
  }
  function watchFromStart(c) {
    var nn = Epg.nowNext(c);
    if (!nn || !nn.now) { U.toast('No guide information to start from'); return; }
    playCatchup(c, nn.now, 0);
  }
  function catchupList(c) {
    var list = (Epg.request(c) || []).filter(function (p) { return p.e < Date.now() && p.s > Date.now() - c.arch * 86400e3; }).reverse();
    if (!list.length) { U.toast(Epg.xml ? 'No past programmes in the guide' : 'Open the Guide and go left to browse older programmes'); return; }
    UI.menu('Catch-up: ' + L.name(c), list.slice(0, 40).map(function (p) {
      return { label: p.t ? RAW(p.t) : 'Programme', sub: new Date(p.s).toLocaleDateString(U.loc ? U.loc() : undefined, { weekday: 'short' }) + ' ' + U.hhmm(p.s), action: function () { playCatchup(c, p, 0); } };
    }));
  }

  /* ---------- VOD playback (called by Vod) ---------- */
  function playVod(meta, url, startAt, onExit) {
    vodSeekCancel();
    tsEnd();
    vod = { meta: meta, onExit: onExit, url: url };
    mode = 'vod'; cu = null; playing = null;
    Subs.reset();
    stage.classList.remove('off');
    video._subsChoice = false; video._subsWantKey = null; Subs.forget();
    video._subsMemo = Subs.memoFor ? Subs.memoFor(meta) : null;   // on or off, as last time for this title
    Player.play({ k: 'vod:' + meta.id, n: meta.title, num: '', p: meta.p || undefined }, { url: url, live: false, startAt: startAt || 0, meta: meta });
    if (typeof SeekPrev !== 'undefined') SeekPrev.start(meta, url);
    Subs.restore(meta);           // subtitles downloaded for it in the last days (discussion #19)
    goFull();
  }

  function zapDigit(d) {
    zapBuf = (zapBuf + d).slice(-5);
    var z = $('zapNum'); z.textContent = zapBuf; z.classList.remove('hidden');
    clearTimeout(zapT);
    // Switch the moment the number can't get any longer; otherwise wait for another digit.
    var done = !L.numberCanGrow(zapBuf);
    zapT = setTimeout(function () {
      if (done) setTimeout(function () { z.classList.add('hidden'); }, 700); else z.classList.add('hidden');
      var n = +zapBuf; zapBuf = '';
      var all = L.data.channels, c = null;
      for (var i = 0; i < all.length; i++) if (all[i].num === n && !Store.edits.hiddenChannels[all[i].k]) { c = all[i]; break; }
      if (!c) { U.toast('No channel ' + n); return; }
      startChannel(c, false, function () {
        if (!L.channels(curGroup).some(function (x) { return x.k === c.k; })) { curGroup = L.ALL; showGroup(L.ALL); }
        if (!full) goFull(); else { zapIdx = L.channels(curGroup).findIndex(function (x) { return x.k === c.k; }); osd(true); }
      });
    }, done ? 0 : 1400);
  }

  /* ---------- backup versions ----------
     A live channel that has run out of retries switches to another version of the same channel
     (Library.versions: other qualities, groups and hidden copies), each tried once.  Settings >
     Playback > When a channel stops working: switch, ask, or keep retrying. */
  var fo = null, foSwitching = false, foFailed = {};
  // The player reports from inside its own retry code: act once it has finished with this channel.
  function downSoon() { var c = playing; setTimeout(function () { if (playing === c) channelDown(); }, 0); }
  function channelDown() {
    var how = Store.settings.backups || 'auto', c = playing, now = Date.now();
    if (how === 'off' || mode !== 'live' || !c || document.body.classList.contains('mv')) return;
    foFailed[c.k] = now;
    if (!fo) fo = { from: c, tried: {} };
    fo.tried[c.k] = 1;
    var next = L.versions(fo.from).concat([fo.from]).filter(function (x) { return !fo.tried[x.k] && !(now - (foFailed[x.k] || 0) < 10 * 60e3); });
    if (!next.length) {
      // Every version failed: most likely the provider itself is down.  Go back to the channel you
      // chose and keep retrying it, so the picture returns by itself when the provider does.
      if (fo.exhausted || Object.keys(fo.tried).length < 2) return;
      fo.exhausted = true;
      Log.warn('player', 'No version of ' + fo.from.n + ' is working; back to it, retrying');
      U.toast('No version of ' + L.name(fo.from) + ' is working right now.  Still trying.', 6000);
      if (c.k !== fo.from.k) {
        var lp0 = lastPlayed;
        foSwitching = 'back';
        try { startChannel(fo.from, !full, function () { if (full) osd(true); else placePreview(); }); }
        finally { foSwitching = false; }
        lastPlayed = lp0;
      }
      return;
    }
    if (how === 'ask' && !UI.modalOpen) {
      UI.menu(L.name(c) + ' stopped working', next.slice(0, 5).map(function (x) {
        return { label: 'Switch to ' + L.name(x), sub: versionSub(x), action: function () { switchVersion(x, c); } };
      }).concat([{ label: 'Keep trying ' + L.name(c), action: function () {} }]));
      return;
    }
    if (how === 'auto') switchVersion(next[0], c);
  }
  function versionSub(x) {
    var q = L.qualityLabel(x);
    return [q, L.groupName(x.g), Store.edits.hiddenChannels[x.k] ? 'hidden' : ''].filter(Boolean).join('  ·  ');
  }
  function switchVersion(x, from) {
    if (!fo) fo = { from: from, tried: {} };
    fo.tried[x.k] = 1;
    var lp = lastPlayed, q = L.qualityLabel(x);
    Log.info('player', L.name(from) + ' stopped working; switching to ' + x.n);
    U.toast(L.name(from) + ' isn\'t working.  Switched to ' + L.name(x) + (q ? ' (' + q + ')' : ''), 6000);
    foSwitching = true;
    try { startChannel(x, !full, function () { if (full) osd(true); else placePreview(); }); }
    finally { foSwitching = false; }
    lastPlayed = lp;                          // "last channel" stays the one you chose before
  }
  function versionsSummary(c) {
    var v = L.versions(c), q = v.map(function (x) { return L.qualityLabel(x) || 'copy'; });
    return q.filter(function (x, i) { return q.indexOf(x) === i; }).join(', ');
  }
  function versionsMenu(c) {
    var v = L.versions(c), mine = v.filter(function (x) { return L.linkedVersion(c.k, x.k); });
    UI.menu('Other versions of ' + L.name(c), v.map(function (x) {
      return { label: RAW(L.name(x)), sub: versionSub(x) + (L.linkedVersion(c.k, x.k) ? '  ·  ' + T('linked by you') : ''), action: function () { startChannel(x, false, function () { if (!full) goFull(); else osd(true); }); } };
    }).concat([{ label: 'Link another version…', sub: 'one TiviBro didn\'t find by its name', action: function () { linkVersionMenu(c); } }],
      mine.length ? [{ label: 'Unlink a version…', action: function () {
        UI.menu('Unlink a version', mine.map(function (x) { return { label: RAW(L.name(x)), sub: versionSub(x), action: function () { L.linkVersion(c.k, x.k, false); U.toast(T('Unlinked')); refreshLists(true); } }; }));
      } }] : []));
  }
  /* Other versions linked by hand (discussion #60: "some can't be found by other version even though they exist"):
     type part of its name, pick it.  Linked both ways; the backup switch (failover) uses them too. */
  function linkVersionMenu(c) {
    var guess = L.name(c).replace(/\b(UHD|FHD|HD|SD|4K|HEVC|H\.?265|RAW|BACKUP|\d{3,4}p)\b/gi, ' ').replace(/^[A-Z]{2,3}\s*[:|-]\s*/, '').replace(/\s+/g, ' ').trim();
    UI.prompt('Link another version of ' + L.name(c), guess, function (q) {
      var not = {}; not[c.k] = 1; L.versions(c).forEach(function (x) { not[x.k] = 1; });
      var found = L.findChannels(q, not);
      if (!found.length) { U.toast(T('No channel named like that')); return; }
      UI.menu('Pick the other version', found.map(function (x) {
        return { label: RAW(L.name(x)), sub: versionSub(x), action: function () { L.linkVersion(c.k, x.k, true); U.toast(T('{x} is another version now', { x: L.name(x) })); refreshLists(true); } };
      }));
    }, 'Part of its name is enough', false, 'Find');
  }

  /* ---------- player feedback ---------- */
  var spin = $('spinner'), spinText = $('spinnerText'), verr = $('vidError');
  function onPlayerState(s, msg) {
    // The question about a slow start goes once the channel plays, or another one is picked.
    if (slowOpen && (s === 'playing' || playing !== slowOpen)) { slowOpen = null; if (UI.modalOpen) UI.close(); }
    if (s === 'playing' || s === 'error' || s === 'idle') stage.classList.remove('blank');
    spin.classList.toggle('hidden', !(s === 'loading' || s === 'buffering'));
    // "Tuning" is a channel's word: a movie, an episode, a recording or My media is "Loading".
    spinText.textContent = s === 'loading' ? (msg || (mode === 'vod' ? 'Loading' : 'Tuning')) : (msg || 'Buffering');
    spinPlain = s === 'buffering' && (!msg || msg === 'Buffering');
    verr.classList.toggle('hidden', s !== 'error');
    if (s === 'error') verr.textContent = msg;
    if (s === 'ended' && mode === 'vod') endVod();
    if (s === 'error' && mode === 'live') downSoon();
    // Playing again: a later failure is a new incident (recent failures are still skipped for 10 min).
    if (s === 'playing' && fo && playing) { foFailed[playing.k] = 0; fo.tried = {}; fo.exhausted = false; }
  }
  /* The buffer pill (discussion #36) is three parts of fixed width, so changing numbers never move the
     bar: the bar with the seconds written inside it (light on the empty part, dark on the filled part,
     so both read), the picture and engine, and the speed. */
  var meter = $('meter'), mFill = $('meterFill'), mRes = $('meterRes'), mRate = $('meterRate'), mSecs = $('meterSecs'), mSecsIn = $('meterSecsIn'), mMost = $('meterMost'), goodSince = 0, spinPlain = false;
  /* Buffer info on demand (Hold Info by default, or any button set to "Show buffer info"): the meter
     shows whatever its setting, for the time in Settings > Playback, or until pressed again.  Pressing
     it while it shows hides it. */
  var peekUntil = 0, peekT = 0;
  function peekMeter(keep) {
    if (!full) return;
    clearTimeout(peekT);
    if (Date.now() < peekUntil && !keep) { peekUntil = 0; meter.classList.add('hidden'); if (Player.stats) onStats(Player.stats); return; }
    var secs = Store.settings.meterPeek == null ? 10 : +Store.settings.meterPeek;
    peekUntil = secs > 0 ? Date.now() + secs * 1000 : Infinity;
    if (secs > 0) peekT = setTimeout(function () { peekUntil = 0; if (Player.stats) onStats(Player.stats); else meter.classList.add('hidden'); }, secs * 1000 + 50);
    if (Player.stats) onStats(Player.stats); else U.toast('No stream playing');
  }
  function onStats(x) {
    // A plain refill shows how far along it is, so a long one doesn't look stuck.
    if (spinPlain && x.state === 'buffering' && x.target) spinText.textContent = 'Buffering  ' + Math.min(99, Math.round(100 * x.ahead / x.target)) + '%';
    var m = Store.settings.meter, peek = full && Date.now() < peekUntil;
    if (!peek && (m === 'off' || (!full && m !== 'always'))) { meter.classList.add('hidden'); return; }
    var ratio = x.target ? x.ahead / Math.max(x.target * 2, 4) : 0;
    // Colours (discussion #36): with the Automatic profile a steady stream often runs on a few seconds, so
    // yellow is for under half the refill goal (at least 1.5 s), red for under a second; green above that.
    var low = x.ahead < Math.max(1.5, x.target * 0.5), crit = x.ahead < 1;
    if (peek) meter.classList.toggle('hidden', x.state === 'idle');
    else if (m === 'auto') {
      if (low || x.state === 'buffering') goodSince = 0; else if (!goodSince) goodSince = Date.now();
      var show = !goodSince || Date.now() - goodSince < 3000;
      meter.classList.toggle('hidden', !show || x.state === 'idle');
    } else meter.classList.toggle('hidden', x.state === 'idle');
    mFill.style.width = Math.round(U.clamp(ratio, 0, 1) * 100) + '%';
    meter.classList.toggle('low', low && !crit);
    meter.classList.toggle('crit', crit);
    var secs = x.ahead.toFixed(1) + 's';
    if (mSecs.textContent !== secs) { mSecs.textContent = secs; mSecsIn.textContent = secs; }
    // "most 34s": how far this stream has got, so a buffer that never reaches the profile's read-ahead shows why.
    var most = x.most >= 1 ? 'most ' + Math.round(x.most) + 's' : '';
    if (mMost && mMost.textContent !== most) mMost.textContent = most;
    mRes.textContent = [x.res, x.engine].filter(Boolean).join('  ');
    mRate.textContent = x.info || '';
    // The TV player never says its speed: no empty box for it.
    mRate.classList.toggle('hidden', !x.info && x.engine === 'Native');
  }

  /* ---------- menus ---------- */
  function copyMenu(keys, label) {
    var items = L.customGroups().map(function (g) {
      return { label: RAW(g.name), sub: g.items.length + ' channels', action: function () {
        var n = L.copyTo(g.id, keys), left = keys.some(function (k) { var c = L.find(k); return c && !L.canGroup(c); });
        if (n || !left) U.toast(n ? 'Copied ' + (n === 1 ? label : n + ' channels') + ' to ' + g.name : 'Already in ' + g.name);   // else copyTo said why
        refreshLists(true);
      } };
    });
    items.push({ label: 'New group…', action: function () {
      UI.prompt('Name the new group', '', function (name) {
        if (!name.trim()) return;
        var g = L.createGroup(name);
        var n = L.copyTo(g.id, keys);
        U.toast('Created ' + g.name + ' with ' + n + (n === 1 ? ' channel' : ' channels'));
        refreshLists(true);
      });
    } });
    UI.menu('Copy to group', items);
  }

  /* Show or hide channels… (Hold OK on a channel or a group): every channel of the group with a tick,
     hidden ones unticked.  Nothing changes until Back; then one save.  Hiding is everywhere, as always. */
  function canManage(gid) { return gid && gid !== L.ALL && gid !== L.RECENT && gid !== L.TEAMS && gid !== L.EVENTS && gid !== L.NEW && gid !== L.MOVIES; }
  function manageVisibility(gid, at) {
    if (!canManage(gid)) return;
    if (!L.channels(gid, true).length) { U.toast('That group is empty'); return; }
    if (tab === 'guide') return Guide.startVis(gid, at);
    startListVis(gid, at);
  }
  /* The same in the channel list (Channels screen): ticks on the rows, OK ticks, Red for all / none /
     no guide, Back saves. */
  var lvis = null;
  function startListVis(gid, at) {
    if (pick) endPick();
    if (curGroup !== gid) { var gi = groupsVL.items.findIndex(function (x) { return x.id === gid; }); if (gi >= 0) { groupsVL.sel = gi; groupsVL.ensure(false); groupsVL.draw(true); } showGroup(gid); }
    lvis = { gid: gid, was: {}, on: {} };
    var all = L.channels(gid, true);
    all.forEach(function (x) { lvis.on[x.k] = lvis.was[x.k] = !L.isHidden(x.k); });
    var i = at ? all.findIndex(function (x) { return x.k === at.k; }) : 0;
    setZone('channels');
    chansVL.setItems(all, Math.max(0, i));
    listVisHead(); hintsFor();
    U.toast('Untick the channels to hide.  Back saves.', 3500);
  }
  function listVisHead() { var all = chansVL.items; $('chanTitle').textContent = L.groupName(lvis.gid) + '  ' + all.filter(function (c) { return lvis.on[c.k]; }).length + ' of ' + all.length + ' shown'; }
  function endListVis(keep) {
    if (!lvis) return;
    var v = lvis, change = {}, hid = 0, shown = 0, cur = chansVL.current();
    lvis = null;
    if (keep) Object.keys(v.on).forEach(function (k) { if (v.on[k] !== v.was[k]) { change[k] = !v.on[k]; if (v.on[k]) shown++; else hid++; } });
    if (hid || shown) { L.hideChannels(change); U.toast([hid ? hid + ' hidden' : '', shown ? shown + ' shown' : ''].filter(Boolean).join(', ') + '.  Hidden channels are hidden in every group.', 4000); }
    else if (!keep) U.toast('Nothing changed');
    refreshLists(true);
    var list = L.channels(curGroup), i = cur ? list.findIndex(function (x) { return x.k === cur.k; }) : -1;
    chansVL.setItems(list, Math.max(0, i));
    hintsFor();
  }
  function listVisAll(f) { chansVL.items.forEach(function (c) { var on = f(c); if (on != null) lvis.on[c.k] = on; }); chansVL.refresh(); listVisHead(); }
  function listVisKeys(a) {
    if (a === 'up') chansVL.move(-1, true);
    else if (a === 'down') chansVL.move(1, true);
    else if (a === 'chup') chansVL.page(-1);
    else if (a === 'chdown') chansVL.page(1);
    else
    if (a === 'ok') { var c = chansVL.current(); if (c) { lvis.on[c.k] = !lvis.on[c.k]; chansVL.refreshWhere(function (x) { return x === c; }); listVisHead(); } }
    else if (a === 'red' || a === 'hold') UI.menu('Show or hide channels', [
      { label: 'Show all', action: function () { listVisAll(function () { return true; }); } },
      { label: 'Hide all', action: function () { listVisAll(function () { return false; }); } },
      noGuideHide(function () { listVisAll(function (c) { return Epg.hasData(c) ? null : false; }); }),
      { label: 'Save and finish', action: function () { endListVis(true); } },
      { label: 'Leave without saving', action: function () { endListVis(false); } }
    ]);
    else if (a === 'back' || a === 'left') endListVis(true);
    return true;
  }
  function chanItems(c, gid) {
    var hidden = !!Store.edits.hiddenChannels[c.k];
    var renamed = !!Store.edits.renames[c.k];
    var inCustom = L.isCustom(gid);
    var fav = L.isFav(c.k);
    var blocked = !!Store.edits.blockedChannels[c.k];
    var team = Teams.ofChannel(c), follow = team && Teams.follows(team.id);
    // A movie on now (Movies on now, or any channel the guide shows a matched movie on): its trailer from TMDB.
    var nnM = Epg.nowNext ? Epg.nowNext(c) : null, onM = nnM && typeof Movies !== 'undefined' ? (nnM.now && Movies.of(c, nnM.now)) || (nnM.next && Movies.of(c, nnM.next)) : null;   // on now, or starting next (Movies on now lists both)
    return [
      onM && onM.id && typeof MediaMoviePage !== 'undefined' && typeof PalmServiceBridge !== 'undefined' && { label: 'Watch the trailer', sub: RAW(onM.title || ''), action: function () { movieTrailer(onM); } },
      // Another playlist not mixed into Favorites and your groups: neither is offered (one already a favorite can still be taken out).
      (fav || L.canGroup(c)) && { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: function () { var on = L.toggleFav(c.k); if (on == null) return; U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); } },
      team && { label: RAW(T(follow ? 'Stop following the {x}' : 'Follow the {x}', { x: team.name })), sub: follow ? '' : 'in My teams, with its games', action: function () {
        Teams.follow(team.id, !follow); refreshLists(true);
        U.toast(follow ? 'Stopped following the ' + team.name : 'Following the ' + team.name + '.  Find them in My teams.');
      } },
      L.canGroup(c) && { label: 'Copy to group…', action: function () { copyMenu([c.k], L.name(c)); } },
      !full && tab === 'live' && { label: 'Select multiple…', sub: 'copy, favorite or hide several', action: function () { startPick(c.k); } },
      L.versions(c).length ? { label: 'Other versions…', sub: versionsSummary(c), action: function () { versionsMenu(c); } } : { label: 'Link another version…', sub: 'a copy of this channel TiviBro didn\'t find', action: function () { linkVersionMenu(c); } },
      Player.canSwitchFormat(c) && { label: 'Stream format…', sub: FORMAT_NAMES[Player.streamFormat(c)], action: function () { formatMenu(c); } },
      typeof Multiview !== 'undefined' && { label: 'Watch in Multiview', sub: playing && playing.k !== c.k ? 'with ' + L.name(playing) : 'with other channels', action: function () { var with_ = playing && playing.k !== c.k ? playing : null; if (with_) Multiview.start(with_, [c]); else Multiview.start(c, lastPlayed ? [lastPlayed] : []); } },
      c.arch && { label: 'Watch from start', action: function () { watchFromStart(c); } },
      c.arch && { label: 'Catch-up…', sub: c.arch + ' days', action: function () { catchupList(c); } },
      inCustom && gid !== L.FAV && { label: 'Remove from ' + L.groupName(gid), action: function () { L.removeFrom(gid, c.k); refreshLists(true); } },
      !full && tab === 'live' && gid === curGroup && L.canReorder(gid) && { label: 'Move…', sub: 'change its place in ' + L.groupName(gid), action: function () { startMove(c); } },
      { label: 'Rename…', sub: renamed ? 'renamed' : '', action: function () {
        UI.prompt('Rename channel', L.name(c), function (v) { L.renameChannel(c.k, v); refreshLists(true); }, 'Original: ' + c.n);
      } },
      renamed && { label: 'Restore original name', action: function () { L.renameChannel(c.k, ''); refreshLists(true); } },
      { label: 'Assign guide…', sub: Store.edits.epgMap[c.k] ? 'assigned' : Epg.pubSource(c) ? 'from the public guide (' + Epg.pubSource(c).name + ')' : Epg.hasData(c) ? '' : 'no guide yet', action: function () { Settings.assignGuide(c); } },
      !Epg.hasData(c) || Library.noGuide(c) ? { label: Library.noGuide(c) ? 'Look for a guide again' : 'No guide for this channel', sub: Library.noGuide(c) ? 'it shows "No guide information" again, and guide matching includes it' : 'stops "No guide information" here, and guide matching leaves it out', action: function () { Library.setNoGuide(c.k, !Library.noGuide(c)); U.toast(Library.noGuide(c) ? 'No guide for ' + Library.name(c) : 'Looking for a guide for ' + Library.name(c) + ' again'); refreshLists(true); } } : null,
      Parental.enabled() && { label: blocked ? 'Unblock channel' : 'Block channel', sub: 'needs the PIN to watch', action: function () {
        var go = function () { L.block('channel', c.k, !blocked); U.toast(blocked ? 'Unblocked' : 'Blocked'); refreshLists(true); stopIfBlocked(); };
        if (blocked) Parental.gate('channels', c, go); else go();
      } },
      canManage(gid) && { label: 'Show or hide channels…', sub: 'tick the channels to keep in ' + L.groupName(gid), action: function () { manageVisibility(gid, c); } },
      hidden ? { label: 'Show channel', action: function () { L.hideChannel(c.k, false); U.toast('Channel restored'); refreshLists(true); } }
             : { label: 'Hide channel', sub: 'restore from Settings', action: function () { L.hideChannel(c.k, true); U.toast('Hidden.  Restore it in Settings, Channels and groups, Hidden channels.'); refreshLists(true); } },
      { label: 'Hide with the content filter', sub: 'gone from everything, not just this list', action: function () { filterOut('channel', c.n, L.name(c)); } }
    ];
  }

  /* The content filter (filter.js, Settings > Parental controls): a channel or group taken out of
     everything, the guide, lists, Search and the phone app.  Asked first, since it is a bigger step
     than hiding. */
  function filterOut(kind, raw, label) {
    UI.menu('Hide "' + label + '" with the content filter?', [
      { label: kind === 'group' ? 'Hide the group and its channels' : 'Hide this channel', sub: 'Bring it back in Settings > Parental controls > Content filter', action: function () {
        if (kind === 'group') Filter.addGroup(raw); else Filter.addChannel(raw);
        filterChanged();
        U.toast('"' + label + '" is hidden by the content filter.', 5000);
      } },
      { label: 'Cancel', current: true }
    ]);
  }
  // After the filter changes: the lists again, and leave a channel the filter just took away.
  function filterChanged() {
    L.refilter();
    if (playing && !L.find(playing.k)) { if (full) exitFull(); stopAll(); }
    refreshLists(true);
    if (typeof Movies !== 'undefined' && Movies.poke) Movies.poke();
    if (window.Guide && Guide.refresh && tab === 'guide') Guide.refresh();
  }
  /* Stream format for one channel (Player.streamFormat): HLS for a channel that stutters as MPEG-TS, or the
     other way round.  Playing it now: it starts again in that format. */
  var FORMAT_NAMES = { '': 'Automatic', hls: 'HLS', ts: 'MPEG-TS' };
  function formatMenu(c) {
    var on = Player.streamFormat(c), dflt = Store.settings.format === 'm3u8' ? 'HLS' : 'MPEG-TS';
    function use(v) {
      Player.setStreamFormat(c, v);
      U.toast(v ? T('{x} for this channel', { x: FORMAT_NAMES[v] }) : T('Stream format back to automatic'));
      if (playing && playing.k === c.k && mode === 'live') startChannel(c, !full);
    }
    UI.menu('Stream format', [
      { label: 'Automatic', sub: T('the playlist\'s setting ({x}), and what plays best here', { x: dflt }), current: !on, action: function () { use(''); } },
      { label: 'HLS', sub: 'copes better with a weak connection', current: on === 'hls', action: function () { use('hls'); } },
      { label: 'MPEG-TS', sub: 'usually switches channels faster', current: on === 'ts', action: function () { use('ts'); } }
    ], null, { sub: RAW(L.name(c)) });
  }
  // A movie's TMDB trailer on YouTube (Hold OK on a channel showing it), or a word when TMDB has none.
  function movieTrailer(m) {
    var back = UI.getHandler();                  // the screen the menu was opened on gets the remote back after
    U.toast('Looking for the trailer…', 4000);
    MediaMoviePage.trailerFor(m.id, function (t) {
      if (!t) { U.toast('TMDB has no trailer for ' + (m.title || 'this movie')); return; }
      MediaMoviePage.watchTrailer(t, function () { if (back) UI.setHandler(back); }, m.title || '');
    });
  }
  function chanMenu(c, gid) {
    if (!c) return;
    UI.menu(RAW(L.name(c)), [{ label: 'Watch', action: function () { startChannel(c, false, function () { if (!full) goFull(); else osd(true); }); } }].concat(chanItems(c, gid)));
  }

  /* ---------- quick panel (OK in fullscreen, like TiviMate) ----------
     Top: channel and what's on.  Row 1: quick actions.  Row 2: recent channels.
     ◀ ▶ move along a row, ▲ ▼ switch rows, OK picks, Back closes.  Clickable with the pointer. */
  var qp = null;                  // { row, col, rows: [[items]], timer }
  // Quick menu buttons.  Each can be switched off in Settings > Remote and buttons > Quick menu buttons.
  var QP_BUTTONS = [['pause', 'Pause and rewind'], ['rec', 'Record'], ['list', 'Channel guide'], ['start', 'Watch from start'], ['fav', 'Favorite'], ['guide', 'TV guide'], ['versions', 'Other versions'], ['multi', 'Multiview'], ['scores', 'My teams\' scores'], ['audio', 'Audio track'], ['sync', 'Audio sync'],
    ['subs', 'Subtitles'], ['cc', 'Closed captions'], ['quality', 'Video quality'], ['picture', 'Aspect'], ['sleep', 'Sleep timer'],
    ['info', 'Stream info'], ['reconnect', 'Reconnect']];
  // Line icons for the quick actions, drawn like the side menu's (24 x 24, stroked).
  var QP_ICONS = {
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    rec: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 5l12 7-12 7z"/>', back10: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>', fwd10: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
    start: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
    fav: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    faved: '<path class="fill" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    guide: '<path d="M3 5h18M3 12h18M3 19h18M9 3v18"/>',
    versions: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M19 9v8a2 2 0 0 1-2 2H8"/><path d="M21 11v6"/>',
    audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    sync: '<path d="M3 12h3l2-5 3 10 2-7 2 4h6"/>',
    subs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h2M11 11h6"/>',
    cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10.5 9.6a2.6 2.6 0 1 0 0 4.8M17 9.6a2.6 2.6 0 1 0 0 4.8"/>',
    quality: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6M11 9v6M7 12h4M14 9h2a3 3 0 0 1 0 6h-2z"/>',
    picture: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9H6v2M16 9h2v2M8 15H6v-2M16 15h2v-2"/>',
    multi: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    scores: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 6v12M7 10v4M17 10v4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    reconnect: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'
  };
  function qpActions() {
    var c = playing, a = [], nn = c && Epg.nowNext(c), now = Date.now(), off = Store.settings.qpHidden || {};
    function add(id, it) { if (!off[id]) { it.id = id; a.push(it); } }
    /* First: Pause (live pause keeps the channel when it's on), Rewind when there's something kept to go back
       to, and Record.  A Magic Remote has no Pause, ◀◀ or REC button, so OK > these is how it gets to them. */
    if (c && mode === 'live') {
      var pz = Player.paused || (tsh && !Player.tshift);
      add('pause', { label: pz ? 'Play' : 'Pause', icon: pz ? 'play' : 'pause', v: pz ? '' : tsOn() ? 'carry on later' : '', run: function () { closePanel(); if (pz) { if (tsh && !Player.tshift) tsResume(); else Player.setPaused(false); } else if (!livePause()) Player.setPaused(true); osd(true); } });
      if (Player.tshift || Player.liveWindow() || c.arch) add('pause', { label: 'Rewind', icon: 'back10', v: Store.settings.skip + 's', run: function () { closePanel(); rewindLive(); } });
      if (behindLive()) add('pause', { label: 'Forward', icon: 'fwd10', v: Store.settings.skip + 's', run: function () { closePanel(); forward(); } });
      if (canScrub()) add('pause', { label: 'Timeline', icon: 'list', v: '◀  ▶', run: function () { closePanel(); scrubStart(); } });
    }
    if (c && mode !== 'vod' && typeof Record !== 'undefined' && Record.base()) {
      var rn = Record.of(c, nn && nn.now), pnow = nn && nn.now && nn.now.s <= now && nn.now.e > now ? nn.now : null;
      add('rec', rn && rn.status === 'recording' ? { label: 'Stop recording', icon: 'rec', v: 'since ' + U.hhmm(rn.startedAt || rn.start), run: function () { closePanel(); Record.stop(rn.id); } }
        : { label: 'Record', icon: 'rec', v: pnow ? 'until ' + U.hhmm(pnow.e) : 'an hour', run: function () { closePanel(); Record.now(c, pnow); } });
    }
    add('list', { label: 'Channel guide', icon: 'list', run: function () { closePanel(); openOverlay(); } });
    if (c && c.arch && nn && nn.now && nn.now.s <= now) add('start', { label: 'From start', icon: 'start', v: 'catch-up', run: function () { closePanel(); watchFromStart(c); } });
    if (c) add('fav', { label: L.isFav(c.k) ? 'Favorite' : 'Add favorite', icon: L.isFav(c.k) ? 'faved' : 'fav', run: function () { var on = L.toggleFav(c.k); if (on == null) return; U.toast(on ? 'Added to Favorites' : 'Removed from Favorites'); refreshLists(true); renderPanel(); } });
    add('guide', { label: 'TV guide', icon: 'guide', run: function () { closePanel(); leaveTo('guide'); } });
    if (c && L.versions(c).length) add('versions', { label: 'Other versions', icon: 'versions', v: versionsSummary(c), run: function () { closePanel(); versionsMenu(c); } });
    if (c && mode === 'live' && typeof Multiview !== 'undefined') add('multi', { label: 'Multiview', icon: 'multi', v: 'more channels', run: function () { closePanel(); Multiview.again(c, lastPlayed); } });
    /* Your teams' score corner, on or off from here (the same switch as Settings > Sports),
       while one of their games is on: the corner can sit over something you want to see. */
    var teamLive = typeof Sports !== 'undefined' && typeof Teams !== 'undefined' && Teams.follows && Sports.all().some(function (g) { return g.state === 'in' && g.teams.some(function (t) { return t.id && Teams.follows(t.id); }); });
    if (teamLive) add('scores', { label: 'Scores', icon: 'scores', v: Store.settings.sportsBar === false ? 'off' : 'on', run: function () {
      Store.settings.sportsBar = Store.settings.sportsBar === false; Store.saveSettings();
      if (typeof SportsLive !== 'undefined' && SportsLive.refresh) SportsLive.refresh();
      U.toast(Store.settings.sportsBar ? 'Your teams\' scores show in the corner' : 'Scores corner off.  OK > Scores, or Settings > Sports, turns it back on.', 5000);
      renderPanel();
    } });
    var tracks = Player.audioTracks();
    if (tracks.length > 1) add('audio', { label: 'Audio', icon: 'audio', v: (tracks.filter(function (t) { return t.on; })[0] || {}).label || '', run: function () { closePanel(); audioMenu(); } });
    if (c || mode === 'vod') add('sync', { label: 'Audio sync', icon: 'sync', v: syncLabel(), run: function () { closePanel(); audioSync(); } });
    // Live captions (CEA-608) have their own switch; Subtitles is for real subtitle tracks.
    var subs = subtitleTracks().filter(function (t) { return mode === 'vod' || t.kind === 'subtitles'; });
    if (subs.length || mode === 'vod') add('subs', { label: 'Subtitles', icon: 'subs', v: (subs.filter(function (t) { return t.mode === 'showing'; })[0] || {}).label || subtitleStatus(), run: function () { closePanel(); subtitleMenu(); } });
    if (mode !== 'vod') add('cc', { label: 'Captions', icon: 'cc', v: ccLabel(), run: function () { ccToggle(); renderPanel(); } });
    if (Player.qualities().length > 1) add('quality', { label: 'Quality', icon: 'quality', v: qualityLabel(), run: function () { closePanel(); qualityMenu(); } });
    add('picture', { label: 'Aspect', icon: 'picture', v: Player.aspectName(Player.displayFor(aspectTarget())), run: function () { closePanel(); pictureMenu(); } });
    add('sleep', { label: 'Sleep timer', icon: 'sleep', v: sleepAt ? U.hhmm(sleepAt) : 'off', run: function () { closePanel(); sleepMenu(); } });
    add('info', { label: 'Stream info', icon: 'info', run: function () { closePanel(); streamInfo(); } });
    add('reconnect', { label: 'Reconnect', icon: 'reconnect', run: function () { closePanel(); Player.retryNow(); U.toast('Reconnecting'); } });
    if (!a.length) a.push({ id: 'list', label: 'Channel guide', icon: 'list', run: function () { closePanel(); openOverlay(); } });
    return qpOrdered(a);
  }
  /* The quick buttons in your order (Settings > Remote and buttons > Quick menu buttons, discussion #36: Stream info
     used often but last).  qpOrder lists button ids; one it doesn't name keeps its usual place among the rest. */
  function qpOrder() {
    var o = (Store.settings.qpOrder || []).filter(function (id) { return QP_BUTTONS.some(function (b) { return b[0] === id; }); });
    QP_BUTTONS.forEach(function (b) { if (o.indexOf(b[0]) < 0) o.push(b[0]); });
    return o;
  }
  function qpOrdered(a) {
    if (!(Store.settings.qpOrder || []).length) return a;
    var o = qpOrder();
    return a.map(function (x, i) { return { x: x, i: i, p: o.indexOf(x.id) }; })
      .sort(function (p, q) { return p.p - q.p || p.i - q.i; }).map(function (y) { return y.x; });
  }
  /* Closed captions: one switch for every channel, like a TV's CC button.  OK on it in the quick menu
     turns them on or off and leaves the menu open, so you can see what changed. */
  function ccLabel() {
    var s = Player.cc;
    if (!s.on) return 'Off';
    if (s.engine && !s.possible) return 'Not with TV player';
    return s.found ? 'On' : s.waited ? 'On, none here' : 'On';
  }
  function ccToggle() {
    var on = !Store.settings.cc;
    Player.setCC(on);
    var s = Player.cc;
    if (!on) U.toast('Closed captions off');
    else if (s.engine && !s.possible) U.toast('Closed captions on.  This channel plays with the TV player, which can\'t show them.  Other channels will.', 7000);
    else if (s.found || !s.waited) U.toast('Closed captions on' + (s.found ? '' : '.  They show when the channel sends them.'), s.found ? 0 : 5000);
    else U.toast('Closed captions on.  This channel doesn\'t send any; channels that do will show them.', 7000);
  }
  function qualityLabel() { if (Player.qualityAuto()) return 'Auto'; var q = Player.qualities().filter(function (x) { return x.on; })[0]; return q ? q.label.split(' ')[0] : 'Auto'; }
  function qualityMenu() {
    var q = Player.qualities();
    UI.menu('Video quality', [{ label: 'Automatic', sub: Player.qualityAuto() ? 'on' : 'adapts to your connection', action: function () { Player.setQuality(-1); } }]
      .concat(q.map(function (x) { return { label: RAW(x.label), sub: x.on ? 'on' : '', action: function () { Player.setQuality(x.id); } }; })));
  }
  /* Aspect for this channel or video only, or for everything (TiviMate's "Apply to all channels").
     The shapes past Zoom scale the picture with CSS; the TV player draws some streams on its own
     video plane, and some TVs then keep the picture as it was, which the menu says. */
  var ASPECT_SUB = { contain: 'the picture\'s own shape', fill: 'stretched to the screen', cover: 'fills the screen, edges cropped', '4:3': 'shown 4:3, bars at the sides',
    '14:9': 'a little wider than 4:3, thin bars at the sides', '16:9': 'a squashed 16:9 picture sent as 4:3', '21:9': 'a 2.35:1 film fills the screen, sides cropped', stretch43: 'a 4:3 picture stretched wide' };
  function pictureMenu() {
    var c = aspectTarget(), own = c && Store.edits.display && Store.edits.display[c.k], what = mode === 'vod' ? 'video' : 'channel';
    var tv = Player.engine === 'TV player', on = Player.displayFor(c), looks = {};
    var items = Player.ASPECTS.map(function (a) {
      var k = a[0], shaped = k !== 'contain' && k !== 'fill' && k !== 'cover', look = Player.aspectLooks(k);
      // On this picture some shapes come out the same (a 4:3 picture: Fill, 16:9 and 4:3 to 16:9, issue #69).
      var same = look && looks[look]; if (look && !same) looks[look] = a[1];
      return { label: a[1], sub: k === on ? 'on' + (same ? ', looks the same as ' + same + ' on this picture' : '') : same ? 'looks the same as ' + same + ' on this picture' : tv && shaped ? 'may not change with the TV player' : ASPECT_SUB[k], action: function () {
        Player.setAspect(k, c);
        if (tv && shaped) U.toast('Aspect ' + a[1] + '.  This ' + what + ' plays with the TV player, which some TVs keep at its own shape.', 6000);
      } };
    });
    // A film shape of your own: IMAX 1.90, 2.39 scope and so on, cropped to fill the screen (discussion #31).
    var film = Player.filmShape(on);
    items.push({ label: 'Film shape…', sub: film ? 'on: ' + Player.aspectName(on) : 'a wide film inside the picture fills the screen: 1.90 IMAX, 2.39 and others', action: function () { filmMenu(c, tv, what); } });
    // Wider by a factor, the height kept: for a picture squeezed sideways (issue #69).
    var wide = Player.wideBy(on);
    items.push({ label: 'Stretch wider…', sub: wide ? 'on: ' + Player.aspectName(on) : 'each pixel drawn wider, the height kept, for a squeezed picture', action: function () { wideMenu(c, tv, what); } });
    items.push({ label: 'Use this aspect for everything', sub: 'currently ' + Player.aspectName(Player.displayFor(null)), action: function () {
      Store.settings.display = Player.displayFor(c); Store.saveSettings(); Store.edits.display = {}; Store.saveEdits(); Player.setAspect(Store.settings.display, null); U.toast('Aspect set for every channel and video');
    } });
    if (own) items.push({ label: 'Forget this ' + what + '\'s aspect', action: function () { delete Store.edits.display[c.k]; Store.saveEdits(); Player.setAspect(Player.displayFor(null), null); } });
    UI.menu('Aspect' + (c ? ':  ' + (mode === 'vod' ? c.n : L.name(c)) : ''), items);
  }
  function filmMenu(c, tv, what) {
    var on = Player.filmShape(Player.displayFor(c));
    function use(r) {
      Player.setAspect('film:' + r, c);
      if (tv) U.toast('Film ' + r.toFixed(2) + ':1.  This ' + what + ' plays with the TV player, which some TVs keep at its own shape.', 6000);
    }
    UI.menu('Film shape', [[1.85, 'Widescreen films'], [1.9, 'IMAX digital'], [2, 'Many series (2:1)'], [2.2, '70 mm'], [2.39, 'Scope (most wide films)'], [2.76, 'Ultra Panavision']].map(function (x) {
      return { label: x[0].toFixed(2) + ':1', sub: Math.abs(on - x[0]) < 0.001 ? 'on' : x[1], action: function () { use(x[0]); } };
    }).concat([{ label: 'Type a shape…', sub: 'From 1.50 to 3.00, or like 64:27', action: function () {
      UI.prompt('Film shape', on ? on.toFixed(2) : '', function (v) {
        var m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[:x\/]\s*(\d+(?:[.,]\d+)?))?\s*(?::1)?\s*$/.exec(v), r = m ? parseFloat(m[1].replace(',', '.')) / (m[2] ? parseFloat(m[2].replace(',', '.')) : 1) : 0;
        r = Math.round(r * 100) / 100;
        if (!(r >= 1.5 && r <= 3)) { U.toast('A shape from 1.50 to 3.00, like 2.39 or 64:27', 5000); return; }
        use(r);
      }, 'Width over height: 2.39, 1.90, or 64:27.', false, 'OK');
    } }]));
  }
  function wideMenu(c, tv, what) {
    var on = Player.wideBy(Player.displayFor(c));
    function use(r) {
      Player.setAspect('wide:' + r, c);
      if (tv) U.toast('Wider ×' + r.toFixed(2) + '.  This ' + what + ' plays with the TV player, which some TVs keep at its own shape.', 6000);
    }
    UI.menu('Stretch wider', [[1.1, 'a little'], [1.2, ''], [1.25, ''], [1.33, '4:3 to 16:9'], [1.5, 'a lot: 4:3 becomes 2:1, sides cropped'], [1.78, '']].map(function (x) {
      return { label: '×' + x[0].toFixed(2), sub: Math.abs(on - x[0]) < 0.001 ? 'on' : x[1], action: function () { use(x[0]); } };
    }).concat([{ label: 'Type a factor…', sub: 'From 1.05 to 2.00', action: function () {
      UI.prompt('Stretch wider', on ? on.toFixed(2) : '', function (v) {
        var r = Math.round(parseFloat(String(v).replace(',', '.').replace(/^\s*[x×]/i, '')) * 100) / 100;
        if (!(r >= 1.05 && r <= 2)) { U.toast('A factor from 1.05 to 2.00, like 1.5', 5000); return; }
        use(r);
      }, 'How much wider to draw each pixel: 1.5 makes it half again as wide.', false, 'OK');
    } }]));
  }
  function speedMenu() {
    UI.menu('Playback speed', [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (r) { return { label: r === 1 ? 'Normal' : r + '×', sub: Math.abs(Player.rate - r) < 0.01 ? 'on' : '', action: function () { Player.setRate(r); } }; }));
  }
  function qpRecents() {
    return L.channels(L.RECENT).filter(function (x) { return Parental.blockedOk(x); }).slice(0, 7).map(function (x) {
      return { ch: x, run: function () { closePanel(); if (!playing || playing.k !== x.k) startChannel(x, false, function () { osd(true); }); } };
    });
  }
  function openPanel() {
    if (mode !== 'live' || !playing) { Player.togglePause(); osd(true); return; }
    $('osd').classList.add('hidden');
    qp = { row: 0, col: 0, rows: [qpActions(), qpRecents()] };
    renderPanel();
    $('qpanel').classList.remove('hidden');
    UI.setHandler(panelKeys);
    armPanel();
  }
  function armPanel() { if (!qp) return; clearTimeout(qp.timer); qp.timer = setTimeout(closePanel, 12000); }
  function closePanel() {
    if (!qp) return;
    clearTimeout(qp.timer); qp = null;
    $('qpanel').classList.add('hidden');
    if (full) UI.setHandler(fullKeys);
  }
  function renderPanel() {
    if (!qp) return;
    var el = $('qpanel'), c = playing, nn = c && Epg.nowNext(c), now = Date.now();
    qp.rows[0] = qpActions();
    el.innerHTML = '';
    var head = U.el('div', 'qp-head');
    head.appendChild(U.el('span', 'n', (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c)));
    head.appendChild(U.el('span', 't', nn && nn.now ? (nn.now.up || nn.now.ended ? '' : U.hhmm(nn.now.s) + ' – ' + U.hhmm(nn.now.e) + '   ') + nn.now.t : L.groupName(c.g)));
    el.appendChild(head);
    var bar = U.el('div', 'qp-bar'), fill = U.el('i'), tl = timeline();
    if (tl) {
      // Live pause, the rewind buffer or a recording: the same timeline as the info bar (what's kept, what's
      // recorded, where you are), and ▲ moves the dot (OK's panel used to have no timeline while ▶'s info bar did).
      var span = Math.max(1, tl.to - tl.from), pc = function (t) { return U.clamp((t - tl.from) / span, 0, 1) * 100; };
      bar.classList.add('tl');
      fill.style.width = pc(tl.now) + '%';
      if (tl.w) { var kp = U.el('i', 'k'); kp.style.left = pc(tl.keptFrom) + '%'; kp.style.width = (pc(tl.now) - pc(tl.keptFrom)) + '%'; bar.appendChild(fill); bar.appendChild(kp); }
      else bar.appendChild(fill);
      if (tl.rec) { var rc = U.el('i', 'r'), r0s = Math.max(tl.from, tl.rec.startedAt); rc.style.left = pc(r0s) + '%'; rc.style.width = (pc(tl.now) - pc(r0s)) + '%'; bar.appendChild(rc); }
      var dot = U.el('b', 'd'); dot.style.left = pc(tl.at) + '%'; bar.appendChild(dot);
    } else {
      fill.style.width = nn && nn.now ? Math.round(100 * (now - nn.now.s) / (nn.now.e - nn.now.s)) + '%' : '0';
      bar.appendChild(fill);
    }
    el.appendChild(bar);
    el.appendChild(U.el('div', 'qp-row-title', 'Quick actions'));
    var r0 = U.el('div', 'qp-actions');
    qp.rows[0].forEach(function (it, i) {
      var b = U.el('div', 'qp-act' + (qp.row === 0 && qp.col === i ? ' focus' : ''));
      var ic = U.el('span', 'i'); ic.innerHTML = '<svg viewBox="0 0 24 24" class="qico">' + (QP_ICONS[it.icon] || '') + '</svg>'; b.appendChild(ic);
      b.appendChild(U.el('span', '', it.label));
      if (it.v) b.appendChild(U.el('span', 'v', it.v));
      hook(b, 0, i);
      r0.appendChild(b);
    });
    el.appendChild(r0);
    if (qp.rows[1].length) {
      el.appendChild(U.el('div', 'qp-row-title', 'Recent channels'));
      var r1 = U.el('div', 'qp-recent');
      qp.rows[1].forEach(function (it, i) {
        var x = it.ch, b = U.el('div', 'qp-ch' + (qp.row === 1 && qp.col === i ? ' focus' : '') + (x.k === c.k ? ' on' : ''));
        var lg = logoOf(x); if (lg) { var im = U.el('img'); im.src = lg; im._c = x; im.onerror = function () { logoFailed(this, this._c); }; b.appendChild(im); }
        b.appendChild(U.el('span', 'nm', L.name(x)));
        var n2 = Epg.nowNext(x); b.appendChild(U.el('span', 'pg', n2 && n2.now ? n2.now.t : L.groupName(x.g)));
        hook(b, 1, i);
        r1.appendChild(b);
      });
      el.appendChild(r1);
    }
    el.appendChild(U.el('div', 'qp-row-title', tl ? '◀ ▶  move      ▲ ▼  switch row, ▲ at the top: timeline      OK  choose      Back  close' : '◀ ▶  move      ▲ ▼  switch row      OK  choose      Back  close'));
    focusPanel();
  }
  function hook(b, row, col) {
    b.addEventListener('mousemove', function () { if (UI.pointer && qp && (qp.row !== row || qp.col !== col)) { qp.row = row; qp.col = col; focusPanel(); armPanel(); } });
    b.addEventListener('click', function () { if (!qp) return; qp.row = row; qp.col = col; panelKeys('ok'); });
  }
  function panelKeys(a) {
    if (!qp) return true;
    armPanel();
    var rowItems = qp.rows[qp.row];
    if (a === 'left') qp.col = Math.max(0, qp.col - 1);
    else if (a === 'right') qp.col = Math.min(rowItems.length - 1, qp.col + 1);
    else if (a === 'down' && qp.rows[1].length && qp.row === 0) { qp.row = 1; qp.col = Math.min(qp.col, qp.rows[1].length - 1); }
    else if (a === 'up' && qp.row === 1) { qp.row = 0; qp.col = Math.min(qp.col, qp.rows[0].length - 1); }
    // ▲ on the top row: the timeline (live pause, the rewind buffer or a recording), as ▲ does on the info bar.
    else if (a === 'up' && qp.row === 0 && canScrub()) { closePanel(); scrubStart(); return true; }
    else if (a === 'ok') { var it = rowItems[qp.col]; if (it) it.run(); return true; }
    else if (a === 'back' || a === 'info') { closePanel(); return true; }
    else if (a === 'chup' || a === 'chdown') { closePanel(); fullKeys(a); return true; }
    focusPanel();
    return true;
  }
  // Moving along the panel only moves the highlight; the panel is built once per opening.
  function focusPanel() {
    var el = $('qpanel'), rs = [el.querySelectorAll('.qp-act'), el.querySelectorAll('.qp-ch')];
    for (var r = 0; r < 2; r++) for (var i = 0; i < rs[r].length; i++) rs[r][i].classList.toggle('focus', qp.row === r && qp.col === i);
    // More buttons than fit across: the row slides to keep the highlighted one in view.
    var f = rs[qp.row][qp.col], box = f && f.parentNode;
    if (box && box.scrollWidth > box.clientWidth) {
      var l = f.offsetLeft - box.offsetLeft, w = f.offsetWidth;
      if (l - box.scrollLeft < 0) box.scrollLeft = Math.max(0, l - 40);
      else if (l + w - box.scrollLeft > box.clientWidth) box.scrollLeft = l + w - box.clientWidth + 40;
    }
  }
  /* The subtitles this video can show.  A captions track only once it has lines: the TV's own player lists the
     closed captions inside a file's video (two "English" ones on a WEB-DL episode) but never hands an app their
     text, so they could be picked and nothing ever showed.  hls.js fills its captions track as they come. */
  function subtitleTracks() {
    var t = video && video.textTracks, out = [];
    for (var i = 0; t && i < t.length; i++) {
      var x = t[i];
      if (x.kind === 'captions' && !(x.cues && x.cues.length)) continue;
      if ((x.kind === 'subtitles' || x.kind === 'captions') && !(window.Subs && Subs.gone(x))) out.push(x);
    }
    return out;
  }
  function subtitleStatus() {
    var state = video && video._mkvSubsState;
    return state === 'discovering' ? 'Finding subtitles…' : state === 'error' ? 'Subtitles unavailable' : state === 'unavailable' ? 'No supported subtitles' : 'Off';
  }
  /* Subtitles: the settings first (for movies and shows Find subtitles from OpenSubtitles, subs.js;
     Timing; Line up with another track), under a Settings heading, then what this video has under its
     own heading.  The settings stay at the top however many languages a file carries, and the menu
     opens on the subtitle that is on (or Off). */
  /* Subtitle size, colour and background from the player (as in Settings > Audio and subtitles), the
     change shown on the picture at once.  For every video, like the setting it is. */
  var SUB_SIZE = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']];
  var SUB_COLOR = [['white', 'White'], ['yellow', 'Yellow'], ['gold', 'Gold'], ['cyan', 'Light blue'], ['green', 'Light green']];
  var SUB_BACK = [['outline', 'Outline'], ['box', 'See-through box'], ['solid', 'Black box']];
  var SUB_POS = [['low', 'Lowest'], ['', 'Normal'], ['up1', 'A little higher'], ['up2', 'Higher'], ['up3', 'Highest']];
  var SUB_BRIGHT = [['', 'Full'], ['90', '90 %'], ['75', '75 %'], ['60', '60 %']];
  var SUB_WEIGHT = [['', 'Regular'], ['bold', 'Bold']];
  function nameIn(list, v, d) { var x = list.filter(function (p) { return p[0] === v; })[0]; return (x || list.filter(function (p) { return p[0] === d; })[0])[1]; }
  function subStyleLine() { var s = Store.settings; return [nameIn(SUB_SIZE, s.subSize, 'm'), nameIn(SUB_COLOR, s.subColor, 'white'), nameIn(SUB_BACK, s.subBack, 'outline')].concat(s.subPos ? [nameIn(SUB_POS, s.subPos, '').toLowerCase()] : [], s.subBright ? [s.subBright + ' %'] : [], s.subBold ? ['bold'] : []).join(', '); }
  function subStyleMenu() {
    var s = Store.settings;
    function pick(title, list, key, d) {
      UI.menu(title, list.map(function (p) { return { label: p[1], sub: (s[key] || d) === p[0] ? 'on' : '', current: (s[key] || d) === p[0], action: function () { s[key] = p[0]; applyLook(); Store.saveSettings(); Subs.refresh(); subStyleMenu(); } }; }), subStyleMenu);
    }
    UI.menu('Size and style', [
      { label: 'Size', sub: nameIn(SUB_SIZE, s.subSize, 'm'), action: function () { pick('Subtitle size', SUB_SIZE, 'subSize', 'm'); } },
      { label: 'Colour', sub: nameIn(SUB_COLOR, s.subColor, 'white'), action: function () { pick('Subtitle colour', SUB_COLOR, 'subColor', 'white'); } },
      { label: 'Background', sub: nameIn(SUB_BACK, s.subBack, 'outline'), action: function () { pick('Subtitle background', SUB_BACK, 'subBack', 'outline'); } },
      { label: 'Position', sub: nameIn(SUB_POS, s.subPos || '', ''), action: function () { pick('Subtitle position', SUB_POS, 'subPos', ''); } },
      { label: 'Brightness', sub: nameIn(SUB_BRIGHT, s.subBright || '', ''), action: function () { pick('Subtitle brightness', SUB_BRIGHT, 'subBright', ''); } },
      { label: 'Weight', sub: s.subBold ? 'Bold' : 'Regular', action: function () { UI.menu('Subtitle weight', SUB_WEIGHT.map(function (p) { var on = !!s.subBold === (p[0] === 'bold'); return { label: p[1], sub: on ? 'on' : '', current: on, action: function () { s.subBold = p[0] === 'bold'; applyLook(); Store.saveSettings(); Subs.refresh(); subStyleMenu(); } }; }), subStyleMenu); } }
    ], subtitleMenu);
  }
  function subtitleMenu() {
    var tr = subtitleTracks().filter(function (t) { return mode === 'vod' || t.kind === 'subtitles'; });
    var settings = [], list = [];
    if (mode === 'vod' && vod) settings.push({ label: 'Find subtitles…', sub: Subs.configured ? 'OpenSubtitles, in ' + Subs.langs().map(Subs.langName).join(', ') : 'from OpenSubtitles, with your free API key', action: function () { Subs.find(vod.meta); } });
    // A subtitle file of your own: from a USB drive or a My media library here, or sent from the phone app or web editor.
    settings.push({ label: 'Load a subtitle file…', sub: 'From a USB drive or a My media library', action: function () { Subs.pickFile(); } });
    if (tr.length || mode === 'vod') settings.push({ label: 'Size and style', sub: subStyleLine(), action: subStyleMenu });
    if (tr.length) settings.push({ label: 'Timing', sub: Subs.timing, action: Subs.timingMenu });
    if (tr.length > 1) settings.push({ label: 'Line up with another track…', sub: 'match a subtitle that is already in time', action: function () { Subs.lineUpMenu(tr); } });
    if (!tr.length) {
      list.push({ label: subtitleStatus() === 'Off' ? 'No subtitles in this ' + (mode === 'vod' ? 'video' : 'stream') : subtitleStatus() });
      if (video._mkvSubsState === 'discovering') {
        var refresh = setInterval(function () {
          if (subtitleTracks().length || video._mkvSubsState !== 'discovering') {
            clearInterval(refresh); UI.onClose = null; subtitleMenu();
          }
        }, 250);
        UI.onClose = function () { clearInterval(refresh); };
      }
    } else {
      var none = tr.every(function (t) { return t.mode !== 'showing'; });
      // Any choice here (Off too) is the viewer's for the rest of this playback: see the addtrack handler.
      list.push({ label: 'Off', sub: none ? 'on' : '', current: none, action: function () { video._subsChoice = true; video._subsRev = (video._subsRev || 0) + 1; video._subsWant = null; video._subsWantKey = ''; tr.forEach(function (t) { t.mode = 'disabled'; }); if (mode === 'vod' && vod && Subs.remember) Subs.remember(vod.meta, null); } });
      tr.forEach(function (t, i) { list.push({ label: RAW(t.label || t.language || 'Track ' + (i + 1)), sub: t.mode === 'showing' ? 'on' : '', current: t.mode === 'showing', action: function () { video._subsChoice = true; video._subsRev = (video._subsRev || 0) + 1; video._subsWant = t; video._subsWantKey = (t.label || '') + '|' + (t.language || ''); tr.forEach(function (x) { x.mode = x === t ? 'showing' : 'disabled'; }); Subs.refresh(); if (mode === 'vod' && vod && Subs.remember) Subs.remember(vod.meta, t); } }); });
    }
    if (!settings.length) return UI.menu('Subtitles', list);
    var it = vod && vod.meta && vod.meta.item || {};
    var here = mode !== 'vod' ? 'In this stream' : it.ep || it.kind === 'episode' ? 'In this episode' : 'In this movie';
    UI.menu('Subtitles', [{ head: true, label: 'Settings' }].concat(settings, [{ head: true, label: here + (tr.length ? ' · ' + tr.length : '') }], list));
  }
  /* Stream info, with buffer info folded in: the rows update every second while it is open, and the
     buffer gauge shows at the top right (as Show buffer info does).  From the quick menu, or any button
     set to "Stream info and buffer", so Magic Remotes without an Info button get there too. */
  function streamInfo() {
    var TT = 'Stream info', live = mode === 'live';
    var rows = {
      name: { label: mode === 'vod' ? 'Playing' : 'Channel' }, engine: { label: 'Player' }, pic: { label: 'Picture' },
      buf: { label: 'Buffered ahead' }, start: { label: 'Started in' }, prof: { label: 'Buffer profile' }, info: { label: 'Details' }, cc: live && { label: 'Closed captions' },
      arch: live && { label: 'Catch-up', sub: playing && playing.arch ? playing.arch + ' days' : 'not available' },
      how: { label: 'Close', sub: Keymap.buttonsFor(['streaminfo', 'buffer']).length ? 'shortcut: ' + Keymap.buttonsFor(['streaminfo', 'buffer'])[0] : '' }
    };
    function fill() {
      var s = Player.stats || {};
      rows.name.sub = mode === 'vod' && vod ? vod.meta.title : playing ? L.name(playing) : '';
      rows.engine.sub = s.engine || '';
      rows.pic.sub = video && video.videoWidth ? video.videoWidth + ' × ' + video.videoHeight : '';
      rows.buf.sub = s.ahead != null ? s.ahead.toFixed(1) + ' s' + (s.target ? ', aiming for ' + Math.round(s.target) + ' s' : '') + (s.most >= 1 ? ', most ' + Math.round(s.most) + ' s' : '') + (s.state === 'buffering' ? ', refilling' : '') : 'nothing playing';
      rows.info.sub = s.info || '';
      // Where the start went: the first video data, the first picture, then the start-up buffer.
      function sec(ms) { return (ms / 1000).toFixed(1) + ' s'; }
      rows.start.sub = s.startMs ? sec(s.startMs) + (s.dataMs ? ': first data ' + sec(s.dataMs) + ', picture ' + sec(s.picMs || s.dataMs) + ', then buffering' : '') : '';
      rows.prof.sub = s.profile || '';
      if (rows.cc) { var c = Player.cc; rows.cc.sub = (c.found ? 'in this stream' : c.possible ? (c.waited ? 'none in this stream' : 'looking…') : 'not with the TV player') + ', ' + (c.on ? 'shown' : 'off'); }
    }
    fill();
    UI.menu(TT, [rows.name, rows.buf, rows.start, rows.prof, rows.engine, rows.pic, rows.info, rows.arch, rows.cc, rows.how]);
    if (full && Player.stats) peekMeter(true);
    clearInterval(streamInfo.t);
    streamInfo.t = setInterval(function () {
      if (!UI.menuOpen(TT)) { clearInterval(streamInfo.t); return; }
      fill(); UI.redrawMenu();
      if (full && Player.stats && Date.now() >= peekUntil) peekMeter(true);
    }, 1000);
  }

  /* Audio sync (avsync.js): the panel over the picture that moves the sound later or earlier, kept for this channel
     or this movie.  The OSD steps aside while it's open so the lips stay in sight. */
  function audioSync() {
    if (typeof AvSync === 'undefined') return;
    if (full) osd(false);
    AvSync.open();
  }
  // The quick button's and the Options row's value: "as sent", or "+120 ms" / "−80 ms".
  function syncLabel() {
    var v = typeof AvSync !== 'undefined' ? AvSync.wanted() : 0;
    return v ? (v > 0 ? '+' : '\u2212') + Math.abs(v) + ' ms' : 'as sent';
  }

  function playerMenu() {
    var items = [];
    if (mode === 'live' && playing) items = items.concat(chanItems(playing, curGroup));
    if (mode === 'catchup') items.push({ label: 'Back to live', action: backToLive });
    if (mode === 'vod' && vod) items.push({ label: 'Restart from beginning', action: function () { if (vod.meta.local && Media.seeking) Media.seeking(0); Player.seek(-1e7); } });
    var tracks = Player.audioTracks();
    if (tracks.length > 1) items.push({ label: 'Audio track', sub: (tracks.filter(function (t) { return t.on; })[0] || {}).label, action: audioMenu });
    items.push({ label: 'Audio sync', sub: syncLabel() + '  ·  when the sound and the lips don\'t match', action: audioSync });
    items.push({ label: 'Aspect', sub: Player.aspectName(Player.displayFor(aspectTarget())), action: pictureMenu });
    if (Player.qualities().length > 1) items.push({ label: 'Video quality', sub: qualityLabel(), action: qualityMenu });
    if (mode === 'vod' && typeof SeekPrev !== 'undefined' && SeekPrev.chapters.length > 1) items.push({ label: 'Chapters', sub: SeekPrev.chapters.length + ' in this ' + (vod && vod.meta && vod.meta.item && vod.meta.item.kind === 'episode' || vod && vod.meta && vod.meta.seriesKey ? 'episode' : 'movie') + '  ·  CH+ CH− go from one to the next', action: function () { SeekPrev.openChapters(function (t) { vs.pending = t; vodSeekCommit(); }); } });
    if (mode === 'vod' && typeof SeekPrev !== 'undefined') items.push({ label: 'Seek previews', sub: ({ auto: 'Automatic', on: 'On', off: 'Off' })[SeekPrev.setting()] + (SeekPrev.available === false ? '  ·  needs the TiviBro update with the new converter' : ''), action: seekPrevMenu });
    if (mode === 'vod' || mode === 'catchup') items.push({ label: 'Playback speed', sub: Player.rate === 1 ? 'Normal' : Player.rate + '×', action: speedMenu });
    // Live captions (CEA-608) have their own switch; Subtitles is for real subtitle tracks.
    var subs = subtitleTracks().filter(function (t) { return mode === 'vod' || t.kind === 'subtitles'; });
    if (subs.length || mode === 'vod') items.push({ label: 'Subtitles', sub: (subs.filter(function (t) { return t.mode === 'showing'; })[0] || {}).label || subtitleStatus(), action: subtitleMenu });
    if (mode !== 'vod') items.push({ label: 'Closed captions', sub: ccLabel(), action: ccToggle });
    items.push({ label: 'Sleep timer', sub: sleepAt ? 'stops at ' + U.hhmm(sleepAt) : 'off', action: sleepMenu });
    items.push({ label: 'Stream info', sub: 'and the buffer', action: function () { streamInfo(); } });
    items.push({ label: 'Reconnect stream', action: function () { Player.retryNow(); } });
    UI.menu(mode === 'vod' && vod ? RAW(vod.meta.title) : playing ? RAW(L.name(playing)) : 'Player', qpSlots(items));
  }
  /* Options (Red) in the order of the quick menu buttons too (discussion #36: Stream info moved to the front there
     stayed near the end here).  The rows that are also quick buttons trade places among themselves; the channel's
     own rows and the movie-only ones (Restart, Chapters, Playback speed) keep theirs. */
  var QP_OF_ROW = { 'Audio track': 'audio', 'Audio sync': 'sync', 'Aspect': 'picture', 'Video quality': 'quality', 'Subtitles': 'subs',
    'Closed captions': 'cc', 'Sleep timer': 'sleep', 'Stream info': 'info', 'Reconnect stream': 'reconnect' };
  function qpSlots(items) {
    if (!(Store.settings.qpOrder || []).length) return items;
    var o = qpOrder(), at = [], mine = [];
    items.forEach(function (it, i) { if (it && QP_OF_ROW[it.label]) { at.push(i); mine.push(it); } });
    mine.sort(function (a, b) { return o.indexOf(QP_OF_ROW[a.label]) - o.indexOf(QP_OF_ROW[b.label]); });
    var out = items.slice();
    at.forEach(function (i, n) { out[i] = mine[n]; });
    return out;
  }

  function groupMenu(g) {
    if (!g) return;
    var custom = L.isCustom(g.id), virtual = L.isVirtual(g.id);
    var hidden = !!Store.edits.hiddenGroups[g.id], blocked = !!Store.edits.blockedGroups[g.id];
    UI.menu(RAW(g.name), [
      !virtual && { label: 'Copy all channels to group…', action: function () { copyMenu(L.channels(g.id).map(function (c) { return c.k; }), g.name); } },
      { label: 'New group…', action: function () {
        UI.prompt('Name the new group', '', function (n) { if (n.trim()) { L.createGroup(n); refreshLists(true); U.toast('Group created.  Hold OK on any channel to copy it in.'); } });
      } },
      custom && { label: 'Rename group…', action: function () { UI.prompt('Rename group', g.name, function (n) { L.renameGroup(g.id, n); refreshLists(true); }); } },
      !virtual && !custom && { label: 'Merge groups into this…', sub: 'several provider groups as one, like four NHL groups', action: function () { mergeMenu(g); } },
      !virtual && !custom && L.mergedFrom(g.id).length && { label: 'Split back into ' + (L.mergedFrom(g.id).length + 1) + ' groups', sub: 'undo the merge', action: function () { L.splitGroup(g.id); refreshLists(true); U.toast('Split back into its groups'); } },
      !virtual && { label: 'Move up', action: function () { L.moveGroup(g.id, -1); refreshLists(true); groupsVL.move(-1); } },
      !virtual && { label: 'Move down', action: function () { L.moveGroup(g.id, 1); refreshLists(true); groupsVL.move(1); } },
      !virtual && { label: 'Sort channels…', sub: sortName(L.sortOf(g.id)), action: function () { sortMenu(g); } },
      L.hasOwnOrder(g.id) && { label: 'Back to the provider\'s channel order', sub: 'undo the channels you moved here', action: function () { L.resetOrder(g.id); refreshLists(true); U.toast('Provider order restored'); } },
      g.id === L.EVENTS && { label: 'Turn off Events by time', sub: 'back on in Settings > Channels and groups', action: function () {
        // Several playlists on: off for each of them (each has its own switch).
        (Store.loaded ? Store.loaded() : [Store.playlist]).forEach(function (p) { p.events = Object.assign({}, p.events, { group: false }); Store.upsertPlaylist(p); });
        Events.reset(); refreshLists(); U.toast('Events by time is off');
      } },
      g.id === L.TEAMS && { label: 'Choose teams…', sub: 'Settings > Sports', action: function () { Settings.openTeams(); } },
      g.id === L.TEAMS && { label: 'Turn off My teams', sub: 'back on in Settings > Sports', action: function () {
        Store.settings.teamsGroup = false; Store.saveSettings(); refreshLists(); U.toast('My teams is off');
      } },
      g.id === L.RECENT && { label: 'Clear recent channels', action: function () { Store.edits.recent = []; Store.saveEdits(); L.dirty(); refreshLists(); } },
      !virtual && Parental.enabled() && { label: blocked ? 'Unblock group' : 'Block group', action: function () {
        var go = function () { L.block('group', g.id, !blocked); refreshLists(true); stopIfBlocked(); };
        if (blocked) Parental.gate('channels', { k: '', g: g.id }, go); else go();
      } },
      canManage(g.id) && { label: 'Show or hide channels…', sub: 'tick the channels to keep', action: function () { manageVisibility(g.id); } },
      !virtual && (hidden ? { label: 'Show group', action: function () { L.hideGroup(g.id, false); U.toast('Group restored'); refreshLists(true); } }
                          : { label: 'Hide group', sub: 'restore from Settings', action: function () { L.hideGroup(g.id, true); U.toast('Hidden.  Restore it in Settings, Channels and groups, Hidden groups.'); refreshLists(); } }),
      !virtual && !custom && { label: 'Hide with the content filter', sub: 'the group and its channels, gone from everything', action: function () { filterOut('group', g.name, L.groupName(g.id)); } },
      custom && { label: 'Delete group', action: function () { UI.confirm('Delete ' + g.name + '?', 'Delete', function () { L.deleteGroup(g.id); refreshLists(); }); } },
      { label: 'Edit on a phone or computer…', sub: 'scan a QR code: rename, hide and sort with a real keyboard', action: function () { WebEdit.showJoin(); } }
    ]);
  }

  /* A group's own channel order (Hold OK on a group > Sort channels): Next event first suits sports and PPV groups,
     where most channels are off air (on now first, then soonest, the ones with nothing on last). */
  var SORT_NAMES = { '': 'as in Settings', provider: 'Provider order', event: 'Next event first', az: 'A to Z', za: 'Z to A', number: 'Channel number', custom: 'Your order' };
  function sortName(m) { return T(SORT_NAMES[m] || SORT_NAMES['']); }
  function sortMenu(g) {
    var cur = L.sortOf(g.id), modes = ['', 'event', 'provider', 'az', 'za', 'number'];
    if (cur === 'custom') modes.push('custom');
    UI.menu('Sort ' + L.groupName(g.id), modes.map(function (m) {
      return { label: (m === cur ? '✓ ' : '') + sortName(m), sub: m === 'event' ? 'on now first, then the soonest; nothing on last' : m === '' ? 'Settings > Channels and groups > Channel order' : '', current: m === cur,
        action: function () { L.setSort(g.id, m); refreshLists(true); U.toast(L.groupName(g.id) + ': ' + sortName(m)); } };
    }));
  }

  /* Merge groups (Hold OK on a provider group): tick the provider groups to show inside this one.  Groups
     that share a word with it come first ("NHL" for "NHL | Teams").  OK on Merge does it; Back cancels. */
  function mergeMenu(g, picked, at) {
    picked = picked || {};
    var words = {};
    L.groupName(g.id).toLowerCase().split(/[^a-z0-9+]+/).forEach(function (w) { w = w.replace(/s$/, ''); if (w.length > 1 && !/^(us|usa|uk|ca|hd|fhd|tv|the|and|of|en|vip|24\/7)$/.test(w)) words[w] = 1; });
    var like = function (x) { return L.groupName(x.id).toLowerCase().split(/[^a-z0-9+]+/).some(function (w) { return words[w.replace(/s$/, '')]; }); };
    var cands = L.allGroups().filter(function (x) { return !x.head && !L.isCustom(x.id) && x.id !== g.id && !L.mergedInto(x.id) && (x.p || '') === (g.p || ''); });
    cands = cands.filter(like).concat(cands.filter(function (x) { return !like(x); }));
    var n = Object.keys(picked).length;
    UI.menu('Merge into ' + L.groupName(g.id), [
      { label: n ? 'Merge ' + n + (n === 1 ? ' group' : ' groups') + ' into ' + L.groupName(g.id) : 'Tick the groups to merge', sub: n ? 'their channels show here; Split undoes it' : 'groups with the same words come first', current: at == null,
        action: function () { if (!n) { mergeMenu(g, picked); return; } var done = L.mergeGroups(g.id, Object.keys(picked)); refreshLists(true); U.toast(done + (done === 1 ? ' group' : ' groups') + ' merged into ' + L.groupName(g.id)); } }
    ].concat(cands.map(function (x) {
      return { label: RAW((picked[x.id] ? '✓ ' : '') + L.groupName(x.id)), sub: L.channels(x.id, true).length + ' channels' + (x.hidden ? ', hidden' : ''), current: at === x.id,
        action: function () { if (picked[x.id]) delete picked[x.id]; else picked[x.id] = 1; mergeMenu(g, picked, x.id); } };
    })));
  }

  function refreshLists(keepSel) {
    L.dirty();
    var gs = L.groups(true);
    if (!gs.some(function (x) { return x.id === curGroup && !x.head; })) { var g0 = gs.filter(function (x) { return !x.head; })[0]; curGroup = g0 ? g0.id : L.ALL; }
    var gsel = Math.max(0, gs.findIndex(function (x) { return x.id === curGroup; }));
    groupsVL.setItems(gs, gsel);
    var oldSel = chansVL.sel;
    var list = L.channels(curGroup, !!lvis);
    chansVL.empty = emptyFor(curGroup);
    chansVL.setItems(list, Math.min(oldSel, list.length - 1));
    $('chanTitle').textContent = L.groupName(curGroup) + '  ' + list.length;
    if (lvis) listVisHead();
    if (tab === 'guide' && !UI.modalOpen && !full) Guide.refresh();
    updateInfo();
  }

  function resume() {
    var k = Store.edits.last, c = k && L.find(k);
    if (c && Store.settings.resumeLast && Parental.blockedOk(c)) {
      var i = L.channels(curGroup).findIndex(function (x) { return x.k === k; });
      if (i >= 0) chansVL.select(i);
      startChannel(c, false, goFull);
    }
  }

  // Blocking what is playing (the preview, say) stops it, so OK can't take it fullscreen without the PIN.
  function stopIfBlocked() { if (playing && mode === 'live' && !Parental.blockedOk(playing)) stopAll(); }
  /* ---------- Settings with the channel still playing ----------
     The same picture as the guide's corner window, moved to the top corner of Settings, with the channel
     and what's on beside it; the settings list sits below it at full width.  Live TV and catch-up only.
     It stops (as Settings always did) when something there needs the whole TV: the set-up screen and
     the tour, the speed test, and on a TV short of memory a channel list or guide reload (pipStop). */
  var pipFrom = '';
  // Hold OK in Settings (or a click on the picture): back to the screen it came from, in fullscreen.
  function pipFull() {
    if (!pipOn()) return false;
    switchTab(pipFrom || (tabs.indexOf('guide') >= 0 ? 'guide' : 'live'));
    if (playing) goFull();
    return true;
  }
  function pipOK() { return !!playing && (mode === 'live' || mode === 'catchup') && !full; }
  function pipTab() { return tab === 'settings' || tab === 'search'; }
  function pipOn() { return pipTab() && pipOK() && !stage.classList.contains('off'); }
  /* Search's corner: right of the search column (1300 px wide), which leaves 400 px at 1920. */
  function searchNow() {
    var v = $('viewSearch'), w = $('srchNow');
    if (!w && v) { w = U.el('div', 'srch-now'); w.id = 'srchNow'; var pv = U.el('div', 'set-preview'); pv.id = 'searchPreview'; w.appendChild(pv); var inf = U.el('div', 'set-now-info'); inf.setAttribute('data-raw', ''); w.appendChild(inf); v.appendChild(w); }
    return w;
  }
  function pipUpdate() {
    ['viewSettings', 'viewSearch'].forEach(function (id) { var e = $(id); if (e) e.classList.toggle('pip', tab === (id === 'viewSearch' ? 'search' : 'settings') && pipOK()); });
    if (full) return;                    // fullscreen (from Settings or Search): the corner box waits, the picture stays
    var on = pipTab() && pipOK(), v = tab === 'search' ? searchNow() : $('viewSettings');
    if (!v) return;
    if (!on) { if (pipTab() && !full) stage.classList.add('off'); return; }
    var c = playing, nn = Epg.nowNext ? Epg.nowNext(c) : null, now = nn && nn.now, box = v.querySelector('.set-now-info');
    var lines = [['sn-l', T(mode === 'catchup' ? 'Catch-up' : 'Now playing')], ['sn-c', (c.num ? c.num + '  ' : '') + L.name(c)]];
    if (now && mode === 'live') lines.push(['sn-p', now.t + '   ' + U.hhmm(now.s) + '–' + U.hhmm(now.e)]);
    lines.push(['sn-h', T(tab === 'search' ? 'Hold OK on the filters  back to fullscreen' : 'Hold OK  back to fullscreen')]);
    var key = JSON.stringify(lines);
    if (box._k !== key) {
      box._k = key; box.innerHTML = '';
      lines.forEach(function (l) { box.appendChild(U.el('div', l[0], l[1])); });
    }
    stage.classList.remove('off');
    placePreview();
  }
  // Something in Settings needs the whole TV (or the memory): the corner picture stops, as Settings used to.
  function pipStop(why) {
    if (!pipOn()) return false;
    Log.info('views', 'Stopped the channel in Settings' + (why ? ': ' + why : ''));
    stage.classList.add('off'); Player.stop(); playing = null;
    pipUpdate();
    return true;
  }
  // A player setting changed (buffer profile, engine, format...): the corner picture starts again with it.
  var pipT = 0;
  function pipRestart() {
    if (!pipOn()) return;
    clearTimeout(pipT);
    pipT = setTimeout(function () { if (pipOn()) Player.retryNow(); }, 1500);
  }
  setInterval(function () { if (pipTab()) try { pipUpdate(); } catch (e) {} }, 15000);

  // Red > Seek previews in the player: the same choice as Settings > Playback > Seek previews.
  function seekPrevMenu() {
    var cur = SeekPrev.setting(), set = function (v) { return function () { Store.settings.seekPreviews = v; Store.saveSettings(); if (v !== 'off' && vod) SeekPrev.start(vod.meta, vod.url); else SeekPrev.stop(); U.toast('Seek previews: ' + ({ auto: 'Automatic', on: 'On', off: 'Off' })[v]); }; };
    UI.menu('Seek previews', [
      { label: (cur === 'auto' ? '✓  ' : '') + 'Automatic', sub: 'A picture of the movie as you seek.  On a TV short of memory, only for movies up to 1080p.', current: cur === 'auto', action: set('auto') },
      { label: (cur === 'on' ? '✓  ' : '') + 'On', sub: 'Always, 4K movies too.', current: cur === 'on', action: set('on') },
      { label: (cur === 'off' ? '✓  ' : '') + 'Off', current: cur === 'off', action: set('off') }
    ]);
  }
  // The movie or episode is over (it ended, or Up next at the credits: skipper.js): My media's or the provider's next step.
  function endVod(force) { if (mode !== 'vod') return; if (vod && vod.meta.local) Media.ended(force === true); else Vod.ended(force === true); }
  function stopAll() { tsEnd(); Subs.reset(); if (typeof SeekPrev !== 'undefined') SeekPrev.stop(); if (full) { full = false; document.body.classList.remove('full'); stage.classList.remove('full'); stage.classList.add('preview'); } Player.stop(); playing = null; mode = 'live'; cu = null; vod = null; stage.classList.add('off');  if (pipTab()) pipUpdate(); }

  return {
    endVod: endVod, get vodMeta() { return mode === 'vod' && vod ? vod.meta : null; },
    pipUpdate: pipUpdate, pipStop: pipStop, pipFull: pipFull, pipRestart: pipRestart, get pipOn() { return pipOn(); },
    init: init, reload: reload, switchTab: switchTab, setZone: setZone, resume: resume, refreshLists: refreshLists,
    closeNav: closeNav, chanMenu: chanMenu, startChannel: startChannel, goFull: goFull, playCatchup: playCatchup, refreshVodMeta:function(){if(mode==='vod')osd(true);}, playVod: playVod,
    manageVisibility: manageVisibility, canManage: canManage, PALETTES: PALETTES, PALETTE_NAMES: PALETTE_NAMES, palette: palette, kindColours: kindColours, emptyFor: emptyFor, TAB_LABELS: TAB_LABELS, QP_BUTTONS: QP_BUTTONS, qpOrder: qpOrder, movieTrailer: movieTrailer, openReminder: openReminder, dueReminder: dueReminder, exitApp: exitApp, armExit: armExit, exitArmed: exitArmed, bankedBack: bankedBack, logoOf: logoOf, ownLogo: ownLogo, logosChanged: logosChanged, get logoRev() { return logoRev; }, logoFailed: logoFailed, tabBar: tabBar, firstFilled: firstFilled, groupMenu: groupMenu, catchupList: catchupList, home: home, get mode() { return mode; }, applyLook: applyLook, buildTabs: buildTabs, placePreview: placePreview, stopAll: stopAll,
    filterChanged: filterChanged,
    get group() { return curGroup; }, set group(g) { curGroup = g; },
    get full() { return full; }, get tab() { return tab; }, get zone() { return zone; }, get playing() { return playing; }, get vod() { return vod; }, runAction: runAction,
    restoreKeys: function () { UI.setHandler(full ? fullKeys : liveKeys); },
    // Read-only state for the speed tests (tests/soak/speed.js).
    __sel: function () { return chansVL ? chansVL.sel : 0; }, __gsel: function () { return groupsVL ? groupsVL.sel : 0; }
  };
})();

/* ---------- Guide (home screen) ----------
   Layout: preview window top left, programme details top right, grid below.
   Zones:
   - groups: side-menu icons plus a groups panel over the left of the grid.  ▲▼ change group
     (the grid follows), ▶ or OK goes into the grid, ◀ opens the side menu.  The guide opens here.
   - grid: the menu and groups hide for a clean full-width guide.  ◀ on what's on now opens
     the groups again; ◀ ▶ on other times move through the schedule; ⏪ ⏩ browse catch-up.
   OK on what's on now plays the channel in the window; OK again goes fullscreen.  Wherever you
   browse to afterwards, the Play button or a click on the window takes that channel fullscreen
   (webOS closes apps on a long Back press, so TiviMate's hold-Back can't be used, and plain
   Back always means "up one level" so it never surprises anyone). */
var Guide = (function () {
  'use strict';
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  function T(x, v) { return typeof I18n !== 'undefined' ? I18n.t(x, v) : v ? String(x).replace(/\{([a-z]+)\}/g, function (a, k) { return v[k] != null ? v[k] : a; }) : x; }
  var $ = U.$, L = Library;
  var view = $('viewGuide'), body = $('guideBody'), timesEl = $('guideTimes'), detail = $('guideDetail'), ghead = $('guideGroup');
  var PEEK = 0, ROW = 100, VIS = 0, WIN = 2.5 * 3600e3, PXW = 0, CHW = 470, MINCELL = 220;      // narrowest a programme is drawn (px)
  var list = [], gid = null, loaded = null, sel = 0, top = 0, t0 = 0, focusT = 0, rows = [], zone = 'groups', groupsVL = null;
  var moving = null;              // the channel being moved up or down its group (Hold OK > Move…)
  var jumpChip = null, jumpChipT = 0;
  var held = { a: '', since: 0, last: 0 }, stepAt = 0, jumpAt = 0;    // a button held down (keys())
  var vis = null;                 // Show or hide channels, right in the list: { gid, was: { k: shown }, on: { k: shown } }

  /* Guide row size (Settings > Guide): taller rows with bigger text, for smaller TVs and across the room. */
  var ROW_SIZES = { m: 100, l: 112, xl: 124 }, GROUP_ROWS = { m: 70, l: 78, xl: 86 }, built = false;
  function build() {
    ROW = ROW_SIZES[Store.settings.guideRows] || 100;
    VIS = Math.max(3, Math.floor(body.clientHeight / ROW) || 6);
    PXW = (body.clientWidth || 1808) - CHW;
    body.innerHTML = '';
    rows = [];
    /* Room left under the last whole row (bigger rows leave most of one): one more row there, cut off and
       faded, so it's clear there are more channels below.  It's never the one you're on. */
    PEEK = body.clientHeight ? body.clientHeight - VIS * ROW : 0;
    body.style.setProperty('--peek', Math.max(0, PEEK) + 'px');
    for (var i = 0; i < VIS + (PEEK > 24 ? 1 : 0); i++) {
      var r = U.el('div', 'grow'), ch = U.el('div', 'gch'), pr = U.el('div', 'gprogs'), pin = U.el('div', 'gpin');
      pr.appendChild(pin);                       // the programmes, in a layer that can slide when the guide scrolls in time
      ch.appendChild(U.el('span', 'num'));
      var img = U.el('img', 'logo'); img.decoding = 'async'; img.onerror = function () { Views.logoFailed(this, this._c); }; ch.appendChild(img);
      ch.appendChild(U.el('span', 'n'));
      var chips = U.el('span', 'gchips'), cuEl = U.el('span', 'cu'), qEl = U.el('span', 'qtag'), dEl = U.el('span', 'deadtag', 'didn\'t play the last 2 times');
      dEl.style.display = 'none';
      chips.appendChild(cuEl); chips.appendChild(qEl); chips.appendChild(dEl); ch.appendChild(chips);
      ch.appendChild(U.el('span', 'vbox'));
      r.appendChild(ch); r.appendChild(pr);
      r.style.transform = 'translateY(' + (i * ROW) + 'px)';
      r.setAttribute('data-slot', i);
      body.appendChild(r);
      rows.push({ el: r, ch: ch, pr: pr, pin: pin, img: img, k: null, slot: i, cells: [], cuEl: cuEl, qEl: qEl, dEl: dEl });
    }
    var nowLine = U.el('div', 'gnow'); nowLine.id = 'gnow'; body.appendChild(nowLine);
    if (built) return;
    jumpChip = U.el('div', 'gjump hidden'); view.appendChild(jumpChip);
    // A series' details came back from TMDB: show them if it's the programme you're on.
    if (typeof Series !== 'undefined') Series.onChange(function () {
      if (Views.tab === 'guide' && !Views.full && rows.length) drawDetail();
      if (panelFill && UI.menuOpen(panelTitle)) panelFill();       // an episode's title came in
    });
    built = true;
    // The groups have rows of their own height: compact, so many more show than channels do.
    var gh = GROUP_ROWS[Store.settings.guideRows] || 70;
    $('guideGroups').style.setProperty('--row', (gh - 8) + 'px');
    groupsVL = new VList($('guideGroupList'), { render: renderGroupRow, onSel: onGroupSel, empty: 'No groups', visible: 10, rowH: gh, noMarquee: true,
      onHover: function () { if (zone !== 'groups') setZone('groups'); }, onClick: function () { enterGrid(); } });
    pointerSetup();
    ghead.addEventListener('click', function () { if (mine()) setZone('groups'); });
    $('guidePreview').addEventListener('click', function () { if (mine()) watchPreview(); });
  }

  /* ---------- zones ---------- */
  function setZone(z) {
    zone = z;
    view.classList.toggle('groups-open', z === 'groups');
    document.body.classList.toggle('nav-hidden', z === 'grid');
    marquee();
    if (z === 'groups') {
      // The panel covers the channel column and no more than it has to of the programmes.
      var want = document.body.classList.contains('noguidenames') ? 260 : 470;
      $('guideGroupList').parentNode.style.width = Math.max(want, 420) + 'px';
      var gs = L.groups(true), i = gs.findIndex(function (g) { return g.id === gid; });
      $('guideGroups').querySelector('.col-title').textContent = T('Groups') + '   ' + gs.filter(function (g) { return !g.head; }).length;
      groupsVL.setItems(gs, Math.max(0, i));
      groupsVL.measure();                // built while the panel was hidden: count the rows that really fit
      groupsVL.setActive(true);
    }
    Views.placePreview();
    for (var r = 0; r < rows.length; r++) drawRow(rows[r], top + r);
    drawDetail();
    hints();
  }
  function enterGrid() { if (loaded !== gid) load(gid, null); toNow(); setZone('grid'); draw(); }
  /* Into the programmes from the groups: at what's on now.  A time looked at earlier had often passed by
     then, and the focus landed on a programme that had ended (and Left went nowhere from there). */
  function toNow() {
    var now = Date.now();
    if (focusT > now + 60e3) return;               // looking ahead: still ahead, kept
    focusT = now;
    if (now < t0 || now >= t0 + WIN - 10 * 60e3) t0 = now - (now % (30 * 60e3));
  }
  function leave() { if (vis) endVis(true); document.body.classList.remove('nav-hidden'); view.classList.remove('groups-open'); }

  // The groups TiviBro makes itself get a small icon in front; the provider's groups are names only.
  var GROUP_ICONS = { c_fav: 'star', recent: 'history', all: 'grid', events: 'day', teams: 'trophy', moviesnow: 'film', 'new': 'sparkle' };
  function renderGroupRow(row, g) {
    if (!row._n) {
      row._ic = U.el('i', 'gic'); var nm = U.el('span', 'name'); row._n = U.el('i'); nm.appendChild(row._n); row._t = U.el('span', 'tag');
      var b = U.el('div', 'txt'); b.appendChild(nm); row.appendChild(row._ic); row.appendChild(b); row.appendChild(row._t);
    }
    row.classList.toggle('ghead', !!g.head);
    row._n.textContent = g.name;
    var ic = g.head ? '' : GROUP_ICONS[g.id] || (g.custom ? 'folder' : '');
    if (row._icn !== ic) { row._icn = ic; row._ic.innerHTML = ic ? UI.icon(ic) : ''; row._ic.style.display = ic ? '' : 'none'; }
    if (g.head) { row._t.textContent = ''; row.classList.remove('hid'); return; }
    var n = L.channels(g.id).length;
    row._t.textContent = g.blocked ? 'locked' : String(n);
    row.classList.toggle('hid', !n);
  }
  var groupDeb = U.debounce(function () { if (loaded !== gid) { load(gid, null); draw(); } }, 240);
  // A group name too long for the panel scrolls across while its row is focused.
  var mqT = 0, mqEl = null, mqStop = null;
  function marquee() {
    clearTimeout(mqT);
    if (mqStop) { mqStop(); mqStop = null; }
    if (mqEl) { mqEl.classList.remove('mq'); mqEl = null; }
    if (zone !== 'groups') return;
    mqT = setTimeout(function () {
      var el = $('guideGroupList').querySelector('.row.sel .name i');
      if (!el) return;
      var over = el.scrollWidth - el.clientWidth;
      if (over <= 2) return;
      mqEl = el; el.classList.add('mq');
      mqStop = UI.marquee(el, over, { speed: 80 });
    }, 900);
  }
  function onGroupSel(i, g) {
    marquee();
    if (!g || g.id === gid) return;
    gid = g.id; remember();
    setHead(L.groupName(gid));
    groupDeb();
  }
  function remember() { Views.group = gid; Store.edits.lastGroup = gid; Store.saveEdits(); }

  /* ---------- Magic Remote ---------- */
  function hit(e) {
    var r = e.target && e.target.closest ? e.target.closest('.grow') : null;
    if (!r) return null;
    var idx = top + (+r.getAttribute('data-slot'));
    var gp = e.target.closest('.gp');
    return { idx: idx, t: gp && gp.getAttribute('data-s') ? +gp.getAttribute('data-s') + 60e3 : null };
  }
  function pointTo(h) {
    if (!h || h.idx >= list.length) return;
    if (h.idx !== sel) selectIdx(h.idx);
    if (h.t && Math.abs(h.t - focusT) > 1000) { focusT = h.t; drawRow(rows[sel - top], sel); drawDetail(); }
  }
  function mine() { return Views.tab === 'guide' && !Views.full && !UI.modalOpen; }
  function pointerSetup() {
    body.addEventListener('mousemove', function (e) { if (UI.pointer && mine() && zone === 'grid') pointTo(hit(e)); });
    body.addEventListener('click', function (e) {
      if (!mine()) return;
      var h = hit(e); if (!h || h.idx >= list.length) return;
      if (zone !== 'grid') setZone('grid');
      pointTo(h); activate();
    });
  }

  function x(t) { return Math.round((t - t0) / WIN * PXW); }

  /* ---------- open / refresh ---------- */
  function load(groupId, key) {
    var to = groupId || L.ALL;
    /* A group opens on the channel playing (in the window or fullscreen) when it's in it, else at the top:
       not where you last were in that group, which was more confusing than useful. */
    if (!key && loaded !== to) key = Views.playing ? Views.playing.k : (Store.edits.recent && Store.edits.recent[0]) || null;
    gid = to; moving = null;
    if (vis && vis.gid !== gid) vis = null;
    list = L.channels(gid, !!vis);
    if (!list.length && zone === 'grid' && gid !== L.TEAMS && gid !== L.MOVIES && !vis) {      // My teams between games says when the next one is
      var alt = Views.firstFilled();
      if (alt !== gid && L.channels(alt).length) { U.toast(L.groupName(gid) + ' is empty, showing ' + L.groupName(alt)); gid = alt; list = L.channels(gid); remember(); }
    }
    loaded = gid;
    var i = rowOf(key);
    sel = i >= 0 ? i : 0;
    top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS));
    head();
    body.classList.toggle('empty', !list.length);
    body.setAttribute('data-empty', I18n.t(Views.emptyFor(gid)));
  }
  /* The row of a channel in the group showing.  A version of it that isn't in this group (hidden, or in
     another group) is on the row of the version that is: the channel switched to by itself when the one you
     picked stopped working, so the guide comes back to where you were, not to the top (issue #73). */
  function rowOf(key) {
    if (!key) return -1;
    var i = list.findIndex(function (c) { return c.k === key; });
    if (i >= 0) return i;
    var c = L.find(key), vs = c ? L.versions(c) : [];
    for (var v = 0; v < vs.length; v++) {
      var vk = vs[v].k, j = list.findIndex(function (x) { return x.k === vk; });
      if (j >= 0) return j;
    }
    return -1;
  }
  function head() {
    setHead(L.groupName(gid) + '   ' + (vis ? list.filter(function (c) { return vis.on[c.k]; }).length + ' of ' + list.length + ' shown' : list.length));
  }
  /* Above the channels, as TiviMate has it: the day and time (the day you're looking at when it isn't today),
     and under it the group and how many channels. */
  var ghWhen = null, ghGrp = null;
  function setHead(t) {
    if (!ghWhen || ghWhen.parentNode !== ghead) { ghead.innerHTML = ''; ghWhen = U.el('b', 'gh-when'); ghGrp = U.el('span', 'gh-grp'); ghead.appendChild(ghWhen); ghead.appendChild(ghGrp); }
    ghGrp.textContent = t; headWhen();
  }
  // Dates are slow to write out on a TV (toLocaleDateString), and this runs on every move: once a day is enough.
  var hwKey = '', hwDate = '';
  function headWhen() {
    if (!ghWhen) return;
    var now = Date.now(), at = t0 || now, dn = dayName(at);
    var day = new Date(at); day.setHours(0, 0, 0, 0);
    var key = day.getTime() + '|' + (U.loc ? U.loc() : '');
    if (key !== hwKey) { hwKey = key; hwDate = new Date(at).toLocaleDateString(U.loc ? U.loc() : undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    var date = hwDate;
    var t = dn === 'Today' ? date + ', ' + U.hhmm(now) : dn === 'Tomorrow' || dn === 'Yesterday' ? dn + ', ' + date : date;
    if (ghWhen.textContent !== t) ghWhen.textContent = t;
  }
  // From the menu: groups panel first.  With a channel playing: straight into the grid on it.
  /* Rows made while the guide was hidden (a row size changed in Settings, or the guide built before it
     was first shown) were counted from a guess: too many, and the last ones sat under the button hints
     (discussion #36).  Count again now that the guide shows, and make the rows again if it differs. */
  function fit() {
    var h = body.clientHeight; if (!h || !rows.length) return;
    var r = ROW_SIZES[Store.settings.guideRows] || 100;
    if (r === ROW && Math.max(3, Math.floor(h / r)) === VIS) return;
    build();
    top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS));
  }
  function open(groupId, key) {
    if (!rows.length) build(); else fit();
    var now = Date.now();
    t0 = now - (now % (30 * 60e3));
    focusT = now;
    zone = key ? 'grid' : 'groups';
    load(groupId, key);
    UI.setHandler(keys);
    setZone(zone);
    draw();
  }
  function resume(key) {
    if (!rows.length) return open(Views.group, key);
    fit();
    UI.setHandler(keys);
    if (key) { var i = rowOf(key); if (i >= 0) { sel = i; top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS)); } }
    focusT = Date.now(); t0 = focusT - (focusT % (30 * 60e3));
    setZone('grid');
    draw();
  }
  // The row size changed: new rows, same channel and time.
  function resize() {
    if (!rows.length) return;
    build();
    top = U.clamp(sel - 2, 0, Math.max(0, list.length - VIS));
    draw();
  }
  function refresh() {
    if (!rows.length) return;
    fit();
    var key = list[sel] && list[sel].k;
    load(gid, key);
    setZone(zone);
    draw();
  }

  /* ---------- drawing ---------- */
  /* A channel's programmes in the guide.  In My teams, a channel that isn't a team's own (a regional sports
     network, ESPN) says what's coming the way team channels do, up to the game: "Next game 9:00pm: Detroit Red
     Wings at Colorado Avalanche", instead of the surfing on before it.  Everywhere else, the guide as it is. */
  var teamCache = {};
  function progsOf(c) {
    var l = Epg.request(c);
    if (gid !== L.TEAMS || !l || !l.length || typeof Teams === 'undefined' || !Teams.gameOn) return l;
    var g = Teams.gameOn(c), now = Date.now();
    if (!g || g.s <= now) return l;
    var hit = teamCache[c.k];
    if (hit && hit.l === l && hit.g === g && now - hit.at < 60000) return hit.out;
    var cur = null, i;
    for (i = 0; i < l.length; i++) if (l[i].s <= now && l[i].e > now) { cur = l[i]; break; }
    if (cur && (cur.up || cur.ev || /^\s*next game/i.test(cur.t || '') || cur === g)) return l;     // a team or event channel already says so
    var out = [], from = cur ? cur.s : now;
    l.forEach(function (p) { if (p.e <= from) out.push(p); });
    var gt = Teams.gameTitle ? Teams.gameTitle(c, g) : g;          // the game's one title and start in My teams
    out.push({ s: from, e: g.s, t: 'Starts ' + Events.when(gt.s) + ': ' + gt.t, k: 's', up: 1, d: 'Then: ' + gt.t + ' on ' + L.name(c) + '.' });
    l.forEach(function (p) { if (p.s >= g.s) out.push(p); else if (p.e > g.s && p.s < g.s && p !== cur) { var q = {}; for (var f in p) q[f] = p[f]; q.s = g.s; out.push(q); } });
    teamCache[c.k] = { l: l, g: g, at: now, out: out };
    return out;
  }
  function progAt(c, t) {
    var l = progsOf(c) || [];
    for (var i = 0; i < l.length; i++) if (l[i].s <= t && l[i].e > t) return { p: l[i], i: i, l: l };
    return { p: null, i: -1, l: l };
  }
  /* A programme's kind (m s n c d) when the guide doesn't say, as on providers' per-channel guides (a local
     channel's): from its title (news; a sport, or a game between two teams), else from what the channel plainly
     is, by its name or its group (ESPN, CNN, Disney Junior, Discovery; a "Sports" or "Kids" group).  Anything
     else stays plain: better no colour than a wrong one. */
  var KIND_NEWS = /\b(news|newscast|noticias|noticiero|nachrichten|journal t[eé]l[eé]vis[eé])\b/i,
    /* News programmes without "news" in the name, from a real US guide with no categories: the networks'
       morning, evening and Sunday shows and the news magazines (not entertainment ones like Inside Edition). */
    KIND_NEWS_SHOWS = /^\s*(good morning america\b|gma3?\b|cbs (saturday|sunday) morning|cbs mornings|today(\s+3rd hour)?\s*$|early today|first look\s*$|nightline|20\/20|dateline|48 hours|60 minutes|face the nation|meet the press|this week with|fox (&|and) friends|morning joe|way too early|squawk box|top story with|hallie jackson now|stay tuned now|livenow from fox|the 11th hour|the last word with|the briefing with|the world today|business today|investigatetv\+|public affairs|world news tonight|nbc nightly)/i,
    KIND_SPORT = /\b(nfl|nba|wnba|nhl|mlb|mls|ncaa[bfmw]?|nascar|ufc|wwe|pga|f1|formula 1|football|f[uú]tbol|basketball|baseball|hockey|soccer|golf|tennis|boxing|cricket|rugby|sportscenter|pregame|postgame|kickoff|grand prix|playoffs?)\b/i,
    KIND_CH = [['n', /\b(news|cnn|msnbc|cnbc|fox news|newsmax|bbc world|sky news|euronews|al jazeera|bloomberg|noticias)\b/i],
      ['s', /\b(sports?|ncaa[bfmw]?|nfl|nba|wnba|nhl|mlb|mls|espn\w*|fs[12]|tsn|sportsnet|bein|dazn|nfl network|nba tv|nhl network|mlb network|golf channel|tennis channel|deportes)\b/i],
      ['c', /\b(kids|children|cartoon|nick(elodeon|jr)?|disney (junior|jr|channel|xd)|boomerang|baby ?tv|pbs kids|universal kids|infantil)\b/i],
      ['m', /\b(movies?|cinema|cin[eé]|films?|cinemax|tcm)\b/i]], kindCh = {};
  function kindOf(c, p) {
    // Documentary isn't coloured: guides file most reality shows under it (Ax Men, American Pickers).
    if (p.k === 'd') return '';
    if (p.k) return p.k;
    var t = p.t || '';
    if (KIND_NEWS.test(t) || KIND_NEWS_SHOWS.test(t)) return 'n';
    if (/^\s*next game\b/i.test(t) || KIND_SPORT.test(t) || (typeof Teams !== 'undefined' && Teams.isGame && Teams.isGame(t, c.n))) return 's';
    if (!(c.k in kindCh)) {
      var n = L.name(c) + ' ' + (c.n || ''), g = L.groupName(c.g) || '', k = '';
      for (var i = 0; i < KIND_CH.length && !k; i++) if (KIND_CH[i][1].test(n)) k = KIND_CH[i][0];
      for (var j = 0; j < KIND_CH.length && !k; j++) if (KIND_CH[j][1].test(g)) k = KIND_CH[j][0];
      kindCh[c.k] = k;
    }
    return kindCh[c.k];
  }
  // Recording now (a red dot) or due to be (a red ring), from the helper's list (Record polls it).
  function recCls(c, p) { var r = window.Record && !p.up && p.e > Date.now() && Record.of(c, p); return r ? (r.status === 'recording' ? ' rec' : ' recsch') : ''; }
  function hasReminder(c, p) { return Store.edits.reminders.some(function (r) { return r.k === c.k && r.s === p.s; }); }
  function isPlaying(c) { var p = Views.playing; return !!(p && c && p.k === c.k && Views.mode === 'live'); }
  function previewing() { var p = Views.playing; return p && Views.mode === 'live' && !Views.full ? p : null; }

  function drawRow(r, idx) {
    if (!r) return;
    var c = list[idx];
    if (!c) { r.el.style.display = 'none'; r.k = null; return; }
    var focus = idx === sel && zone === 'grid';
    r.el.style.display = '';
    r.k = Epg.keyOf(c);
    r.el.classList.toggle('sel', focus);
    r.el.classList.toggle('moving', moving === c.k);
    r.el.classList.toggle('playing', isPlaying(c));
    r.el.classList.toggle('vis', !!vis);
    r.el.classList.toggle('vis-off', !!vis && !vis.on[c.k]);
    var lg = Views.logoOf(c), cuMark = c.arch && Store.settings.showCatchupMark !== false;
    var qt = L.versionTag(c), dead = typeof DeadList !== 'undefined' && DeadList.marked(c);
    var head = (Store.settings.showNumbers ? c.num : '') + '|' + L.name(c) + '|' + (cuMark ? c.arch : '') + '|' + qt + '|' + dead;
    if (r.head !== head) {
      r.head = head;
      r.ch.children[0].textContent = Store.settings.showNumbers ? c.num : ''; chanNumLen(r.ch.children[0]);
      r.ch.children[2].textContent = L.name(c);
      // Catch-up is just the mark here; the days are in the details above the guide.
      r.cuEl.textContent = cuMark ? '↺' : '';
      r.cuEl.style.display = cuMark ? '' : 'none';
      r.qEl.textContent = qt;
      r.qEl.style.display = qt ? '' : 'none';
      r.dEl.style.display = dead ? '' : 'none';         // not playing lately (issue #37)
    }
    r.img._c = c;
    if (r.img._src !== lg + '#' + Views.logoRev) { r.img._src = lg + '#' + Views.logoRev; r.img._alt = ''; r.img.style.visibility = lg ? '' : 'hidden'; if (lg) { r.img.removeAttribute('src'); r.img.src = lg; } }
    var locked = !Parental.blockedOk(c);
    var l = locked ? [] : progsOf(c), t1 = t0 + WIN, n = 0, nowT = Date.now();
    var segs = [];
    // While the guide slides over (draw), the stretch it's leaving is drawn too, so nothing blank slides in.
    var r0 = ext ? ext.a : t0, r1 = ext ? ext.b : t1, xa = x(r0), xb = x(r1);
    if (l) for (var i = 0; i < l.length; i++) {
      var p = l[i];
      if (p.e <= r0 || p.s >= r1 || p.e <= p.s) continue;              // p.e <= p.s: overlapped by the next (Epg.untangle)
      segs.push({ p: p, a: Math.max(xa, x(p.s)), b: Math.min(xb, x(p.e)) });
    }
    // A programme with only minutes showing (one ending just after the guide's start, a short filler)
    // would be a sliver with its title cut to "J…": it borrows width from the next one, which has room.
    for (var q = 0; q < segs.length; q++) {
      var sg = segs[q], need = MINCELL - (sg.b - sg.a), nx2 = segs[q + 1];
      if (need <= 0) continue;
      if (nx2 && nx2.a <= sg.b + 1) { var give = Math.min(need, Math.max(0, nx2.b - nx2.a - MINCELL)); sg.b += give; nx2.a += give; }
      else sg.b = Math.min(xb, sg.b + need);
    }
    var tint = !!Store.settings.guideTint;
    segs.forEach(function (sg) {
      var p = sg.p, a = sg.a, w = Math.max(4, sg.b - sg.a);
      var past = p.e <= nowT, now = p.s <= nowT && p.e > nowT, from = Math.max(p.s, t0);
      var mv = typeof Movies !== 'undefined' && Movies.of(c, p), kind = tint ? (mv ? 'm' : kindOf(c, p)) : '';
      // How much of what's on now has aired, shown inside its cell (by time, as the cell may be wider), up to
      // the window's end for one running on past it, so the bar meets the now line.
      // Running on past either edge of the window: that side is square and its text fades out, so it reads as
      // carrying on rather than cut off.
      var edge = (p.s < t0 && a <= 0 ? ' cl' : '') + (p.e > t1 && sg.b >= PXW ? ' cr' : '');
      // My teams: a game on now stands out in the theme's sports colour; one still to come is quieter.
      if (gid === L.TEAMS) edge += p.up ? ' tm-soon' : now ? ' tm-live' : '';
      // A narrow one (a short filler) whose title won't fit on a line: the title gets both lines, without the times.
      cell(r, n++, 'gp' + (now ? ' now' : past ? ' past' : '') + (focus && p.s <= focusT && p.e > focusT ? ' focus' : '') + (mv ? ' mv' : '') + (kind ? ' k-' + kind : '') + edge + (w < 240 && p.t.length * 12 > w - 40 ? ' nar' : '') + recCls(c, p), a, w,
        (hasReminder(c, p) ? '◷ ' : '') + p.t, past && cuMark, p.up ? 'until ' + Events.when(p.e) : U.hhmm(p.s) + ' – ' + U.hhmm(p.e), now ? U.clamp(Math.round(w * (nowT - from) / Math.max(1, Math.min(p.e, t1) - from)), 0, w) : -1, p.s);
    });
    // Nothing to show: still loading (a soft shimmer), or no information (quiet, as TiviMate has it).
    if (!n) cell(r, n++, 'gp none' + (!locked && !Library.noGuide(c) ? (l ? ' nodata' : ' loading') : '') + (focus ? ' focus' : ''), 0, PXW, locked ? 'Locked' : Library.noGuide(c) ? Library.name(c) : l ? 'No information' : 'Loading…', false, null, -1, '');
    for (var j = n; j < r.cells.length; j++) if (!r.cells[j].off) { r.cells[j].d.style.display = 'none'; r.cells[j].off = true; }
  }
  // Programme cells are kept per row and reused, so scrolling the guide creates no new elements.
  function cell(r, i, cls, left, w, title, cu, time, fill, start) {
    var c = r.cells[i];
    if (!c) {
      c = { d: U.el('div', 'gp'), f: U.el('i', 'gfill'), t: U.el('span', 'gt'), ti: U.el('b'), s: U.el('small', 'gs') };
      c.t.appendChild(c.ti);                     // the title in its own element, so a long one can scroll (marquee)
      c.d.appendChild(c.f); c.d.appendChild(c.t); c.d.appendChild(c.s);
      r.pin.appendChild(c.d); r.cells[i] = c;
    }
    var d = c.d;
    if (c.off) { d.style.display = ''; c.off = false; }
    if (c.cls !== cls) { d.className = cls; c.cls = cls; }
    if (c.l !== left) { d.style.left = left + 'px'; c.l = left; }
    if (c.w !== w) { d.style.width = w + 'px'; c.w = w; }
    if (c.tt !== title) { c.ti.textContent = title; c.tt = title; }
    if (c.cu !== cu) { c.t.className = cu ? 'gt gcu' : 'gt'; c.cu = cu; }
    if (c.ts !== time) { c.s.textContent = time || ''; c.s.style.display = time == null ? 'none' : ''; c.ts = time; }
    if (c.fw !== fill) { c.f.style.display = fill < 0 ? 'none' : ''; if (fill >= 0) c.f.style.width = fill + 'px'; c.fw = fill; }
    if (c.st !== start) { if (start === '') d.removeAttribute('data-s'); else d.setAttribute('data-s', start); c.st = start; }
  }

  function draw() {
    // Logos-only guide (Settings) gives the schedule the room the names used.
    var want = document.body.classList.contains('noguidenames') ? 260 : 470;
    if (want !== CHW || !PXW) { CHW = want; PXW = (body.clientWidth || 1808) - CHW; }
    // Moving along the schedule past the screen's edge: the programmes and times slide over (a short glide
    // from where they were), not a snap.  Not while a button is held, and not for a jump.
    var px = slideFrom != null && !UI.repeating ? (t0 - slideFrom) * PXW / WIN : 0;
    if (Math.abs(px) > PXW / 2) px = 0;
    ext = px ? { a: Math.min(t0, slideFrom), b: Math.max(t0, slideFrom) + WIN } : null;
    slideFrom = null;
    for (var i = 0; i < rows.length; i++) drawRow(rows[i], top + i);
    moreDown();
    var tk = t0 + '|' + CHW + '|' + new Date().toDateString() + (ext ? '|s' : '');
    if (timesKey !== tk) {
      timesKey = tk;
      if (!timesIn) { timesIn = U.el('div', 'gtin'); timesEl.appendChild(timesIn); }
      timesIn.innerHTML = '';
      for (var t = ext ? ext.a : t0; t < (ext ? ext.b : t0 + WIN); t += 30 * 60e3) {
        // The day in front of the first time when it isn't today, and at midnight (#1 and #2 in the ideas).
        var s = U.el('span'), dt = new Date(t), dn = dayName(t);
        if ((t === t0 && dn !== 'Today') || (dt.getHours() === 0 && dt.getMinutes() === 0)) s.appendChild(U.el('b', 'gday', dn));
        s.appendChild(document.createTextNode(U.hhmm(t)));
        s.style.left = (x(t) + 16) + 'px'; timesIn.appendChild(s);
      }
      if (!$('gnowh')) { var mk = U.el('span', 'gnowh'); mk.id = 'gnowh'; timesEl.appendChild(mk); }
    }
    if (px) {
      var lay = rows.map(function (r) { return r.pin; }).concat([timesIn]);
      lay.forEach(function (e) { e.style.transition = 'none'; e.style.transform = 'translateX(' + px + 'px)'; });
      void getComputedStyle(lay[0]).transform;     // start from there (styles only: no need to lay the page out)
      lay.forEach(function (e) { e.style.transition = 'transform .18s ease-out'; e.style.transform = ''; });
    }
    headWhen();
    // Colour by category: what each colour means, at the right above the guide.
    var lg = $('glegend');
    if (Store.settings.guideTint && !lg) {
      lg = U.el('div', 'glegend'); lg.id = 'glegend';
      [['m', 'Movies'], ['s', 'Sports'], ['n', 'News'], ['c', 'Kids']].forEach(function (k) { lg.appendChild(U.el('em', 'k-' + k[0], k[1])); });
      view.appendChild(lg);
    } else if (!Store.settings.guideTint && lg) lg.remove();
    var nl = $('gnow'), nx = x(Date.now());
    if (nl) { nl.style.transition = px ? 'transform .18s ease-out' : 'none'; nl.style.display = nx >= 0 && nx <= PXW ? '' : 'none'; nl.style.transform = 'translateX(' + (CHW + nx) + 'px)'; }
    var nh = $('gnowh'); if (nh) { nh.style.transition = px ? 'left .18s ease-out' : 'none'; nh.style.display = nx >= 0 && nx <= PXW ? '' : 'none'; nh.style.left = nx + 'px'; }
    drawDetail();
  }

  var timesKey = '', timesIn = null, slideFrom = null, ext = null;
  function mins(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' ' + T('h') + (m % 60 ? ' ' + (m % 60) + ' ' + T('min') : '') : m + ' ' + T('min'); }

  // What OK will do for the focused cell, in plain words.
  function okMeaning(c, h) {
    var now = Date.now();
    if (!c) return '';
    if (!h.p || (h.p.s <= now && h.p.e > now)) {
      if (isPlaying(c)) return T('OK  watch fullscreen');
      return T(Store.settings.guideOk === 'full' ? 'OK  watch fullscreen' : 'OK  play in the window, OK again for fullscreen');
    }
    if (h.p.e <= now) return T(c.arch ? 'OK  replay this programme' : 'Already aired.  This channel has no catch-up.');
    return T(hasReminder(c, h.p) ? 'OK  cancel the reminder' : 'OK  remind me when it starts');
  }

  /* The preview window before anything plays in it: the channel you're on, its logo large, rather than a
     blank box.  Whatever plays sits over it. */
  var pvIdle = null;
  function previewIdle(c) {
    var box = $('guidePreview'); if (!box) return;
    if (!pvIdle) { box.innerHTML = ''; pvIdle = { el: U.el('div', 'gpv-idle'), img: U.el('img'), n: U.el('b'), h: U.el('small', '', T('OK plays it here, OK again for fullscreen')) }; pvIdle.img.alt = ''; pvIdle.img.onerror = function () { this.style.display = 'none'; }; pvIdle.el.appendChild(pvIdle.img); pvIdle.el.appendChild(pvIdle.n); pvIdle.el.appendChild(pvIdle.h); box.appendChild(pvIdle.el); }
    var lg = c ? Views.logoOf(c) : '', name = c ? L.name(c) : '';
    pvIdle.h.textContent = T('OK plays it here, OK again for fullscreen');
    if (pvIdle.src !== lg) { pvIdle.src = lg; pvIdle.img.style.display = lg ? '' : 'none'; if (lg) pvIdle.img.src = lg; }
    if (pvIdle.n.textContent !== name) pvIdle.n.textContent = name;
    pvIdle.el.classList.toggle('nologo', !lg);
    pvIdle.h.style.display = c ? '' : 'none';
  }
  /* ESPN's word on a game (Teams.espnOf): "DET 2 – 1 NYI · 2nd 12:31" while it's on, "Final" after, and before it
     both teams with their records and ESPN's start, with the guide's if it says another time. */
  function espnLine(eg, p) {
    var a = eg.teams[0] || {}, b = eg.teams[1] || {};
    if (eg.state === 'in') return a.abbr + ' ' + (a.score != null ? a.score : 0) + ' – ' + (b.score != null ? b.score : 0) + ' ' + b.abbr + (eg.detail ? '   ·   ' + eg.detail : '');
    if (eg.state === 'post') return T('Final') + ':  ' + a.abbr + ' ' + a.score + ' – ' + b.score + ' ' + b.abbr;
    var rec = function (t) { return (t.name || t.abbr) + (t.rec ? ' (' + t.rec + ')' : ''); };
    var off = Math.abs(eg.s - p.s) > 10 * 60000 ? '   ·   ' + T('the guide says {x}', { x: U.hhmm(p.s) }) : '';
    return rec(a) + ' at ' + rec(b) + '   ·   ' + T('starts {x}', { x: U.hhmm(eg.s) }) + off;
  }
  function drawDetail() {
    detail.innerHTML = '';
    var c = zone === 'grid' || list.length ? list[sel] : null;
    previewIdle(c);
    var pv = previewing();
    if (!c) { detail.appendChild(U.el('b', '', L.groupName(gid))); detail.appendChild(U.el('div', 'gd-meta', list.length + ' channels.  ▶ or OK to browse them.')); nowLine(pv); return; }
    var h = progAt(c, focusT), now = Date.now();
    detail.appendChild(U.el('b', '', h.p ? h.p.t : L.name(c)));
    var meta = U.el('div', 'gd-meta');
    function part(t) { meta.appendChild(U.el('span', 'sep', '·')); meta.appendChild(document.createTextNode(t)); }
    if (h.p && (h.p.up || h.p.ended)) {
      // Event channels (events.js): the wait before an event, or the time after it
      meta.appendChild(U.el('span', 'gd-badge', h.p.up ? 'UPCOMING' : 'ENDED'));
      meta.appendChild(document.createTextNode(h.p.up ? 'Starts ' + Events.when(h.p.e) : 'Ended ' + Events.when(h.p.s)));
      if (h.p.up && h.p.e > now) part('in ' + (h.p.e - now > 48 * 3600e3 ? Math.round((h.p.e - now) / 86400e3) + ' days' : mins(h.p.e - now)));
    } else if (h.p) {
      var live = h.p.s <= now && h.p.e > now, past = h.p.e <= now;
      meta.appendChild(U.el('span', 'gd-badge' + (live ? ' live' : past && c.arch ? ' cu' : ''), T(live ? 'LIVE' : past ? (c.arch ? 'CATCH-UP' : 'AIRED') : 'UPCOMING')));
      // What else the guide says (#9 in the ideas): a new episode, a reminder set, its kind, its episode.
      if (h.p.n && !past) meta.appendChild(U.el('span', 'gd-badge new', 'NEW'));
      var rc = !past && window.Record && Record.of(c, h.p);
      if (rc) meta.appendChild(U.el('span', 'gd-badge rec', T(rc.status === 'recording' ? 'REC' : 'WILL RECORD')));
      if (!past && hasReminder(c, h.p)) meta.appendChild(U.el('span', 'gd-badge rem', '◷ REMINDER'));
      var hk = kindOf(c, h.p), kn = { s: 'Sports', n: 'News', c: 'Kids' }[hk];
      if (kn) meta.appendChild(U.el('span', 'gd-badge kind k-' + hk, kn));
      if (h.p.ep) meta.appendChild(U.el('span', 'gd-ep', h.p.ep));
      meta.appendChild(document.createTextNode((dayName(h.p.s) === 'Today' ? '' : dayName(h.p.s) + '  ') + U.hhmm(h.p.s) + ' – ' + U.hhmm(h.p.e)));
      part(mins(h.p.e - h.p.s));
      // TiviMate style: a short bar between the times and what is left.
      if (live) { var mini = U.el('span', 'gd-mini'), mf = U.el('i'); mf.style.width = Math.round(100 * (now - h.p.s) / (h.p.e - h.p.s)) + '%'; mini.appendChild(mf); meta.appendChild(mini); meta.appendChild(document.createTextNode(T('{x} left', { x: mins(h.p.e - now) }))); }
      else if (!past) part(h.p.s - now < 48 * 3600e3 ? 'starts in ' + mins(h.p.s - now) : 'in ' + Math.round((h.p.s - now) / 86400e3) + ' days');
      var ps = Epg.pubSource(c);
      if (ps) part('public guide, ' + ps.name);
    } else meta.appendChild(document.createTextNode(Library.noGuide(c) ? 'No guide wanted for this channel' : Epg.request(c) ? 'No guide information for this time' : 'Loading guide…'));
    detail.appendChild(meta);
    var meta2 = U.el('div', 'gd-meta');
    var dq = L.versionTag(c);
    meta2.textContent = (Store.settings.showNumbers ? c.num + '  ' : '') + L.name(c) + (dq ? ' ' + dq : '') + '   ·   ' + L.groupName(c.g) + (c.arch ? '   ·   ↺ ' + T('catch-up {n} days', { n: c.arch }) : '');
    detail.appendChild(meta2);
    // A game of a team you follow (My teams): what ESPN says of it, the score while it's on, and its real start.
    var eg = h.p && typeof Teams !== 'undefined' && Teams.espnOf ? Teams.espnOf(c, h.p) : null;
    if (eg) { var m4 = U.el('div', 'gd-meta gd-espn'); m4.textContent = espnLine(eg, h.p); detail.appendChild(m4); }
    // A movie (movies.js, TMDB): its poster at the right, a line with the year, genres and rating, and
    // TMDB's plot when the guide has little to say.
    var mv = h.p && typeof Movies !== 'undefined' ? Movies.of(c, h.p) : null, gd = h.p ? Epg.desc(c, h.p) : '';
    detail.classList.toggle('has-poster', !!(mv && mv.poster));
    if (mv) {
      var m3 = U.el('div', 'gd-meta gd-movie');
      m3.textContent = ['Movie', mv.year, U.runtime(mv.runtime), mv.genre, mv.rating ? '★ ' + mv.rating + ' TMDB' : ''].filter(Boolean).join('   ·   ');
      detail.appendChild(m3);
      if (mv.poster) { var pim = U.el('img', 'gd-poster'); pim.src = mv.poster; pim.alt = ''; pim.onerror = function () { this.remove(); detail.classList.remove('has-poster'); }; detail.appendChild(pim); }
      if ((!gd || gd.length < 60) && mv.plot) gd = mv.plot;
    }
    /* A series (series.js, TMDB): its poster, a line with when it started, its network, genres and rating,
       the episode's own title next to its number, and the episode's (else the show's) summary when the
       guide has little to say. */
    var sh = !mv && h.p && typeof Series !== 'undefined' ? Series.of(c, h.p) : null;
    if (sh) {
      var se = h.p.ep ? Series.episode(sh, h.p.ep) : null;
      var m4 = U.el('div', 'gd-meta gd-movie');
      m4.textContent = ['Series', sh.year ? 'since ' + sh.year : '', sh.network, sh.genre, sh.rating ? '★ ' + sh.rating + ' TMDB' : ''].filter(Boolean).join('   ·   ');
      detail.appendChild(m4);
      if (sh.poster) { detail.classList.add('has-poster'); var sim = U.el('img', 'gd-poster'); sim.src = sh.poster; sim.alt = ''; sim.onerror = function () { this.remove(); detail.classList.remove('has-poster'); }; detail.appendChild(sim); }
      if (!gd || gd.length < 60) gd = (se && se.plot) || sh.plot || gd;
    }
    /* Hide spoilers (Settings > Movies and shows, discussion #36): a new episode, or anything not aired yet, keeps only its
       title, season and episode, and when it airs; its summary and episode title stay hidden. */
    // Only a story: a series episode or a movie (not news, sport or the like), or anything marked NEW.
    var spoil = Store.settings.noSpoilers && h.p && !h.p.up && (h.p.n || (h.p.s > now && !!(sh || mv || h.p.ep) && h.p.k !== 'n' && h.p.k !== 's'));
    if (spoil && gd) gd = h.p.s > now ? 'Summary hidden until it airs (Hide spoilers is on).' : 'Summary hidden, a new episode (Hide spoilers is on).';
    var gdEl = U.el('p', 'gd-desc' + (spoil ? ' spoil' : ''), gd);
    // The episode's own title from TMDB, in front of the summary (its season and episode are in the line above).
    if (sh && se && se.t && !spoil) {
      // Guides that run the episode's title into the summary ("Love That Lets Go Lilly finally…"): shown once.
      var low = gdEl.textContent.toLowerCase(), et = se.t.toLowerCase();
      if (low.indexOf(et) === 0 && gdEl.textContent.length > et.length + 20) gdEl.textContent = gdEl.textContent.slice(se.t.length).replace(/^[\s:.\-–]+/, '');
      gdEl.insertBefore(U.el('span', 'gd-eptitle', se.t), gdEl.firstChild);
    }
    detail.appendChild(gdEl);
    if (zone === 'grid') detail.appendChild(U.el('div', 'gd-ok', okMeaning(c, h)));
    // A poster at the right: the colour legend moves to its left rather than under it.
    var lgd = $('glegend'); if (lgd) lgd.classList.toggle('beside', detail.classList.contains('has-poster'));
    nowLine(pv);
    fitSoon(gdEl);
    progMarquee();
  }
  /* The focused programme's title, when it doesn't fit its cell, scrolls across after a moment and
     comes back (#8 in the ideas; ich0x in discussion #36).  Only that one: the rest stay still, cut off. */
  var pmT = 0, pmEl = null, pmStop = null;
  function progMarquee() {
    clearTimeout(pmT);
    if (pmStop) { pmStop(); pmStop = null; }
    if (pmEl) { pmEl.parentNode.classList.remove('mq'); pmEl = null; }
    if (zone !== 'grid' || UI.repeating) return;
    pmT = setTimeout(function () {
      var el = body.querySelector('.grow.sel .gp.focus .gt b');
      if (!el) return;
      var box = el.parentNode, over = box.scrollWidth - box.clientWidth;     // (an inline element's own width reads 0)
      if (over <= 4) return;
      pmEl = el; box.classList.add('mq');
      pmStop = UI.marquee(el, over, { speed: 90, pause: 1600 });
    }, 1100);
  }
  /* The details above the guide have a fixed height.  With a Series or Movie line, an episode title and
     bigger text, everything doesn't always fit: the summary gives up lines (three, two, one) until it
     does, rather than the bottom lines being cut through the middle. */
  // Measured just before the next frame is drawn, so the page lays out once per frame and not once per move
  // (a held button builds the details many times between two frames on a slow TV).
  var fitEl = null, fitRaf = 0;
  function fitSoon(el) {
    fitEl = el;
    if (!fitRaf) fitRaf = requestAnimationFrame(function () { fitRaf = 0; var e = fitEl; fitEl = null; if (e && e.parentNode === detail) fitDetail(e); });
  }
  function fitDetail(gdEl) {
    var kids = detail.children, last = null, i;
    for (i = kids.length - 1; i >= 0; i--) if (!kids[i].classList.contains('gd-poster')) { last = kids[i]; break; }
    if (!last || !gdEl) return;
    var over = function () { return last.getBoundingClientRect().bottom > detail.getBoundingClientRect().bottom + 1; };
    if (!over()) return;
    for (var n = 2; n >= 1; n--) { gdEl.style.webkitLineClamp = n; gdEl.style.lineClamp = n; if (!over()) return; }
    gdEl.style.display = 'none';
  }
  // What's in the window and how to get to it, whatever is highlighted.
  function nowLine(pv) {
    if (!pv) return;
    var d = U.el('div', 'gd-now');
    d.appendChild(document.createTextNode('In the window: ')); d.appendChild(U.el('b', '', L.name(pv)));
    d.appendChild(document.createTextNode('     Play ▶  watch it fullscreen'));
    detail.appendChild(d);
  }

  function hints() {
    if (Views.tab !== 'guide' || Views.full) return;
    if (vis && zone === 'grid') { UI.hints([['', 'OK  tick or untick', 'ok'], ['', 'CH +/−  a page', 'chup'], ['', 'Back  save and finish', 'back'], ['red', 'All, none, no guide']]); return; }
    var pv = previewing();
    if (zone === 'groups') {
      UI.hints([['', '▲ ▼  choose a group'], ['', 'OK or ▶  its channels', 'ok'], ['', '◀  menu', 'left'], ['', 'Hold OK  group options', 'hold'],
        pv ? ['', 'Play ▶  watch ' + L.name(pv), 'playpause'] : null, ['', 'Back  menu', 'back']].filter(Boolean));
      return;
    }
    var g = function (b) { var x = Keymap.get('guide', b); return x && x !== 'none' ? x : ''; };
    var full = ['playpause', 'red', 'green', 'yellow', 'blue', 'info', 'stop'].filter(function (b) { return g(b) === 'full'; })[0];
    // Same order everywhere: the moves, Back, then the colour buttons (a coloured square and what it does).
    var grp = g('yellow') === 'groups';
    UI.hints([['', '◀ on now  groups', grp ? 'yellow' : ''], ['', 'Hold ◀  earlier', 'left'], ['', 'Hold OK  options', 'hold'],
      pv && full ? ['', Keymap.label(full) + '  watch ' + L.name(pv), full] : null, ['', 'Back  groups', 'back']]
      .concat(['red', 'green', 'yellow', 'blue'].map(function (b) { var a = g(b); return a && a !== 'full' && !(b === 'yellow' && grp) ? [b, Keymap.SHORT[a] || Keymap.ACTIONS[a]] : null; })).filter(Boolean));
  }

  function selectIdx(i) {
    var n = list.length; if (!n) return false;
    var s = U.clamp(i, 0, n - 1);
    var old = sel; sel = s;
    var oldTop = top;
    if (sel < top + 1) top = sel - 1;
    if (sel > top + VIS - 2) top = sel - VIS + 2;
    top = U.clamp(top, 0, Math.max(0, n - VIS));
    var d = top - oldTop;
    if (d && Math.abs(d) < VIS) shift(d);
    else if (d) { draw(); return s !== old; }
    if (old >= top && old < top + VIS) drawRow(rows[old - top], old);
    drawRow(rows[sel - top], sel);
    moreDown();
    detailSoon();
    return s !== old;
  }
  // The fade over the cut-off row at the bottom (build PEEK): only while there are channels below.
  function moreDown() { body.classList.toggle('more-down', rows.length > VIS && top + VIS < list.length); }
  // Scrolling by a few rows: the rows that left the screen move to the other end and only they are
  // drawn again.  The rest just move (each row is its own layer, so moving costs no repaint).
  function shift(d) {
    var i;
    if (d > 0) for (i = 0; i < d; i++) rows.push(rows.shift());
    else for (i = 0; i < -d; i++) rows.unshift(rows.pop());
    for (i = 0; i < rows.length; i++) if (rows[i].slot !== i) {
      rows[i].slot = i; rows[i].el.style.transform = 'translateY(' + (i * ROW) + 'px)'; rows[i].el.setAttribute('data-slot', i);
    }
    if (d > 0) for (i = rows.length - d; i < rows.length; i++) drawRow(rows[i], top + i);
    else for (i = 0; i < -d; i++) drawRow(rows[i], top + i);
  }
  // While an arrow is held the details wait until the remote rests: the rows keep up instead.
  var detailT = 0;
  function detailSoon() {
    clearTimeout(detailT);
    if (UI.repeating) detailT = setTimeout(drawDetail, 120);
    else drawDetail();
  }
  /* Down on the last channel goes back to the first, and Up on the first round to the last, like the
     channel list (one press, never while the arrow is held). */
  function moveSel(d) {
    var s2 = sel + d;
    if (s2 >= list.length && d === 1 && list.length > 2 && !UI.repeating) s2 = 0;
    else if (s2 < 0 && d === -1 && list.length > 2 && !UI.repeating) s2 = list.length - 1;
    if (s2 < 0 || s2 >= list.length) return false;
    return selectIdx(s2);
  }

  // Through the schedule.  Programmes that already aired only on channels with catch-up.
  function moveTime(dir, past) {
    var c = list[sel]; if (!c) return false;
    var h = progAt(c, focusT), now = Date.now(), target;
    if (h.p) {
      // The next programme that has time of its own: a guide listing one twice leaves the copy with none, and
      // stepping onto it went nowhere, so Left seemed stuck until you changed rows.  Right also passes a listing
      // inside the one focused (an event channel's "Starts 1:00pm" from 6am with a second from noon, both to 1:00):
      // it landed back on now, inside the first, and Right stayed stuck there.
      var j = h.i + dir, nb = h.l[j];
      while (nb && (nb.e <= nb.s || (dir < 0 ? nb.s >= h.p.s : nb.s <= h.p.s || nb.e <= h.p.e))) { j += dir; nb = h.l[j]; }
      target = nb ? nb.s + 60e3 : (dir > 0 ? h.p.e + 60e3 : h.p.s - 60e3);
      // Back onto what's on now: now, not its start.  A long block (an event channel's "Starts …" from days
      // before) took the guide back to its first day, and Right then Left no longer lined up.
      if (nb && nb.s <= now && nb.e > now) target = now;
    }
    else target = focusT + dir * 30 * 60e3;
    var cur = progAt(c, now).p;
    /* How far back: a channel with catch-up, as far as it keeps; any other only to look at what was on
       (a held Left from now, or already looking back), as far as the guide goes back, at most a day. */
    var back = past || (h.p ? h.p.e <= now : focusT < now - 60e3);
    var earliest = c.arch ? now - c.arch * 86400e3 : back ? now - 86400e3 : (cur ? cur.s : now);
    if (dir < 0 && !c.arch && back && h.p && !h.l[h.i - 1] && target < h.p.s) return false;     // the guide has nothing earlier
    if (target < earliest) return false;
    focusT = target;
    var was = t0;
    if (focusT >= t0 + WIN - 10 * 60e3) t0 += 30 * 60e3 * Math.ceil((focusT - (t0 + WIN - 10 * 60e3)) / (30 * 60e3) + 0.01);
    if (focusT < t0) t0 -= 30 * 60e3 * Math.ceil((t0 - focusT) / (30 * 60e3) + 0.01);
    if (t0 !== was) slideFrom = was;
    draw();
    return true;
  }
  // Where the focus sits in time: 'now', 'future' or 'past'.
  function when() {
    var c = list[sel], now = Date.now(); if (!c) return 'now';
    var h = progAt(c, focusT);
    if (h.p) return h.p.s > now ? 'future' : h.p.e <= now ? 'past' : 'now';
    return focusT > now + 60e3 ? 'future' : focusT < now - 60e3 ? 'past' : 'now';
  }
  function jumpNow() { focusT = Date.now(); t0 = focusT - (focusT % (30 * 60e3)); draw(); }

  /* ---------- jumping through time (Rewind / Fast-forward, Jump to…) ---------- */
  var dnKey = '', dnVal = '';
  function dayName(t) {
    var d = new Date(t), n = new Date(); d.setHours(0, 0, 0, 0); n.setHours(0, 0, 0, 0);
    var diff = Math.round((d.getTime() - n.getTime()) / 86400e3);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    var key = d.getTime() + '|' + (U.loc ? U.loc() : '');
    if (key !== dnKey) { dnKey = key; dnVal = new Date(t).toLocaleDateString(U.loc ? U.loc() : undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    return dnVal;
  }
  // As far ahead as the channels on screen have a guide (at least three hours from now).
  function guideEnd() {
    var end = 0;
    for (var i = 0; i < VIS; i++) { var c = list[top + i], l = c && Parental.blockedOk(c) ? progsOf(c) : null; if (l && l.length) end = Math.max(end, l[l.length - 1].e); }
    return Math.max(end, Date.now() + 3 * 3600e3);
  }
  // A day and time: the focus goes there, with half an hour before it in view.  Never before what the
  // focused channel can play (now, or as far back as its catch-up), never past the guide.
  function jumpTo(t) {
    var c = list[sel], now = Date.now(), half = 30 * 60e3;
    var lo = c && c.arch ? now - c.arch * 86400e3 : now, hi = Math.max(now, guideEnd() - half);
    t = Math.max(lo, Math.min(hi, t));
    if (Math.abs(t - now) < 60e3) { jumpNow(); flashJump(Date.now()); return; }
    focusT = t;
    t0 = t - (t % half) - half;
    if (t >= now && t0 < now - (now % half)) t0 = now - (now % half);
    draw();
    flashJump(t);
  }
  // Rewind and Fast-forward: a screen of the guide at a time.
  function screenJump(dir) {
    var was = focusT, c = list[sel];
    jumpTo(focusT + dir * WIN);
    if (Math.abs(focusT - was) > 60e3) return;
    if (dir < 0) U.toast(c && c.arch ? 'Catch-up on this channel goes back ' + c.arch + (c.arch === 1 ? ' day' : ' days') : 'This channel has no catch-up');
    else U.toast('That is as far as the guide goes');
  }
  // Where a jump landed, for a moment over the guide.
  function flashJump(t) {
    if (!jumpChip) return;
    jumpChip.textContent = dayName(t) + '   ' + U.hhmm(t);
    jumpChip.classList.remove('hidden');
    clearTimeout(jumpChipT);
    jumpChipT = setTimeout(function () { jumpChip.classList.add('hidden'); }, 1400);
  }
  function at(dayOff, h) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOff); d.setHours(h, 0, 0, 0); return d.getTime(); }
  // Hold OK > Jump to…: now, tonight, tomorrow, then each day the guide has, and catch-up days.
  function jumpMenu() {
    var now = Date.now(), c = list[sel], end = guideEnd(), items = [], soon = now + 20 * 60e3;
    function go(t) { return function () { jumpTo(t); }; }
    if (Math.abs(focusT - now) > 60e3) items.push({ label: 'Now', icon: 'now', sub: U.hhmm(now), action: function () { jumpNow(); flashJump(Date.now()); } });
    if (at(0, 20) > soon) items.push({ label: 'Tonight', icon: 'moon', sub: U.hhmm(at(0, 20)), action: go(at(0, 20)) });
    if (at(0, 23) > soon && at(0, 23) < end) items.push({ label: 'Late tonight', icon: 'moon', sub: U.hhmm(at(0, 23)), action: go(at(0, 23)) });
    if (at(1, 8) < end) items.push({ label: 'Tomorrow morning', icon: 'sun', sub: U.hhmm(at(1, 8)), action: go(at(1, 8)) });
    if (at(1, 20) < end) items.push({ label: 'Tomorrow night', icon: 'moon', sub: U.hhmm(at(1, 20)), action: go(at(1, 20)) });
    var later = [];
    for (var d = 2; d < 15 && at(d, 0) < end; d++) later.push(d);
    if (later.length) {
      items.push({ head: true, label: 'Later' });
      later.forEach(function (dd) { items.push({ label: dayName(at(dd, 12)), icon: 'day', sub: 'choose a time', action: function () { timesMenu(dd); } }); });
    }
    if (c && c.arch) {
      items.push({ head: true, label: 'Catch-up on ' + L.name(c) });
      if (now - at(0, 6) > 2 * 3600e3) items.push({ label: 'Earlier today', icon: 'history', sub: 'choose a time', action: function () { timesMenu(0, true); } });
      for (var b = 1; b <= Math.min(c.arch, 7); b++) (function (bb) { items.push({ label: dayName(at(-bb, 12)), icon: 'history', sub: 'choose a time', action: function () { timesMenu(-bb, true); } }); })(b);
    }
    UI.menu('Jump to', items, null, { sub: 'Now showing ' + dayName(focusT) + ', ' + U.hhmm(focusT) });
  }
  // A day's times: morning to late night, only the ones that can be shown (ahead of now, or in catch-up).
  function timesMenu(day, past) {
    var now = Date.now(), c = list[sel], lo = past && c && c.arch ? now - c.arch * 86400e3 : now, end = guideEnd(), items = [];
    [[8, 'Morning', 'sun'], [12, 'Midday', 'sun'], [15, 'Afternoon', 'sun'], [18, 'Evening', 'moon'], [20, 'Prime time', 'moon'], [23, 'Late night', 'moon']].forEach(function (x) {
      var t = at(day, x[0]);
      if (past ? t >= lo && t < now : t > now && t < end) items.push({ label: x[1], icon: x[2], sub: U.hhmm(t), action: function () { jumpTo(t); } });
    });
    UI.menu(dayName(at(day, 12)), items, jumpMenu, { sub: past ? 'catch-up' : 'jump to a time' });
  }

  function toggleReminder(c, p, how) {
    var r = Store.edits.reminders, i = r.findIndex(function (x) { return x.k === c.k && x.s === p.s; });
    if (i >= 0) { r.splice(i, 1); U.toast('Reminder removed'); }
    else { r.push({ k: c.k, s: p.s, e: p.e, t: p.t }); U.toast('Reminder set for ' + U.hhmm(p.s)); }
    // Which press set or removed it, so a reminder nobody remembers setting can be traced in the log.
    Log.info('remind', (i >= 0 ? 'Reminder removed: ' : 'Reminder set: ') + p.t + ' at ' + U.hhmm(p.s) + ' on ' + L.name(c) + ' (' + (how || 'guide menu') + ')');
    Store.saveEdits();
    draw();
  }

  function preview(c, chosen) { Views.startChannel(c, true, function () { Views.placePreview(); draw(); hints(); }, chosen); }
  function watch(c) {
    if (isPlaying(c)) return Views.goFull();
    if (Store.settings.guideOk === 'full') return Views.startChannel(c, false, Views.goFull);
    preview(c, true);
  }
  // The channel in the window, fullscreen, from anywhere in the guide.
  function watchPreview() { if (previewing()) { Views.goFull(); return true; } return false; }
  function activate() {
    var c = list[sel]; if (!c) return;
    if (vis) { vis.on[c.k] = !vis.on[c.k]; head(); draw(); return; }
    var h = progAt(c, focusT), now = Date.now();
    if (!h.p || (h.p.s <= now && h.p.e > now)) return watch(c);
    if (h.p.e <= now) { if (c.arch) Views.playCatchup(c, h.p, 0); else U.toast('This channel has no catch-up'); return; }
    toggleReminder(c, h.p, 'OK on it in the guide');
  }

  function menu() {
    var c = list[sel]; if (!c) return;
    var h = progAt(c, focusT), now = Date.now(), items = [];
    // The channel in the window when you've moved off it: fullscreen without a Play button (discussion #36).
    var pvc = previewing();
    if (pvc && !isPlaying(c)) items.push({ label: T('Watch {x} fullscreen', { x: L.name(pvc) }), sub: T('in the window now'), icon: 'full', action: function () { Views.goFull(); } });
    if (h.p && h.p.e <= now && c.arch) items.push({ label: 'Replay this programme', icon: 'replay', action: function () { Views.playCatchup(c, h.p, 0); } });
    items.push({ label: 'Watch fullscreen', icon: 'full', action: function () { if (isPlaying(c)) Views.goFull(); else Views.startChannel(c, false, Views.goFull); } });
    if (!isPlaying(c)) items.push({ label: 'Play in the window', icon: 'window', action: function () { preview(c, true); } });
    if (h.p && h.p.s <= now && h.p.e > now && c.arch) items.push({ label: 'Watch from the start', icon: 'start', sub: 'catch-up', action: function () { Views.playCatchup(c, h.p, 0); } });
    if (c.arch) items.push({ label: 'Earlier programmes…', icon: 'history', sub: T('catch-up {n} days', { n: c.arch }), action: function () { Views.catchupList(c); } });
    // Recording to a USB drive (record.js): the programme on now or later.
    var recIt = typeof Record !== 'undefined' ? Record.menuItem(c, h.p) : null;
    if (recIt) items.push(recIt);
    // Where new recordings go: the share when one is chosen and there's no drive (or Record to says the share).
    if (typeof Record !== 'undefined' && Record.recs.length) {
      var onShare = !!Record.share && (!Record.space || Store.settings.recTo === 'share');
      items.push({ label: 'Recordings…', icon: 'film', sub: onShare ? 'on the network share' : 'on the USB drive', action: function () { Record.open(); } });
    }
    if (h.p && h.p.s > now) items.push(hasReminder(c, h.p) ? { label: 'Cancel reminder', icon: 'belloff', sub: U.hhmm(h.p.s), action: function () { toggleReminder(c, h.p); } }
      : { label: 'Remind me', icon: 'bell', sub: U.hhmm(h.p.s), action: function () { toggleReminder(c, h.p); } });
    if (h.p && h.p.t && !h.p.up && !h.p.ended) {
      var title = h.p.t;
      items.push({ label: 'Other showings…', icon: 'search', sub: 'search the guide for "' + title + '"', action: function () { Views.switchTab('search'); Search.open(title); } });
      if (!Watch.has(title)) items.push({ label: 'Add to watchlist', icon: 'watch', sub: 'remind me whenever it is on', action: function () { Watch.add(title); } });
    }
    var shw = h.p && typeof Series !== 'undefined' ? Series.of(c, h.p) : null;
    if (shw) items.splice(Math.min(items.length, isPlaying(c) ? 1 : 2), 0, { label: 'About this show…', icon: 'info', sub: [shw.network, shw.seasons ? shw.seasons + (shw.seasons === 1 ? ' season' : ' seasons') : ''].filter(Boolean).join(', '), action: function () { showPanel(c, h.p, shw); } });
    // A movie TiviBro has matched (Movies on now, discussion #36): its trailer, for the programme in focus, now or later.
    var mvT = h.p && typeof Movies !== 'undefined' ? Movies.of(c, h.p) : null;
    if (mvT && mvT.id && typeof MediaMoviePage !== 'undefined' && typeof PalmServiceBridge !== 'undefined') items.splice(Math.min(items.length, isPlaying(c) ? 1 : 2), 0, { label: 'Watch the trailer', icon: 'film', sub: RAW(mvT.title || ''), action: function () { Views.movieTrailer(mvT); } });
    items.push({ label: 'Jump to…', icon: 'jump', sub: 'a day and time', action: jumpMenu });
    if (Math.abs(focusT - now) > 60e3) items.push({ label: 'Jump to now', icon: 'now', sub: U.hhmm(now), action: function () { jumpNow(); flashJump(Date.now()); } });
    if (previewing()) items.push({ label: 'Stop the window', icon: 'stop', sub: L.name(previewing()), action: function () { Views.stopAll(); draw(); hints(); } });
    if (L.canReorder(gid) && list.length > 1) items.push({ label: 'Move…', icon: 'move', sub: 'change its place in ' + L.groupName(gid), action: function () { startMove(c); } });
    if (Views.canManage(gid)) items.push({ label: 'Show or hide channels…', icon: 'eye', sub: 'tick the channels to keep in ' + L.groupName(gid), action: function () { Views.manageVisibility(gid, c); } });
    items.push({ label: 'Channel options…', icon: 'more', sub: 'favorite, copy to group, hide, rename', action: function () { Views.chanMenu(c, gid); } });
    // What it is about under the title: the channel, and the programme's day and time.
    var when2 = h.p && !h.p.up && !h.p.ended ? (dayName(h.p.s) === 'Today' ? '' : dayName(h.p.s) + '  ') + U.hhmm(h.p.s) + ' – ' + U.hhmm(h.p.e) : '';
    UI.menu(RAW(h.p ? h.p.t : L.name(c)), items, null, { sub: RAW(L.name(c) + (when2 ? '   ·   ' + when2 : '')) });
  }

  /* About this show (Info on a series, or Hold OK > About this show…): TMDB's poster, when it started,
     its network, genres, rating, seasons and whether it's still running, its summary and cast, and its
     next showings on this channel this week, each with its episode and TMDB's title for it.  Watch it
     when it's on, or a reminder for the next one.  Episode titles fill in as their season comes back. */
  var panelFill = null, panelTitle = '';
  function same(a, b) { return Series.clean(a).t.toLowerCase() === Series.clean(b).t.toLowerCase(); }
  function showPanel(c, p, sh) {
    var now = Date.now(), list2 = (Epg.request(c) || []).filter(function (q) { return q.e > now && q.s < now + 7 * 86400e3 && same(q.t, p.t); });
    var body = U.el('div', 'sp'), col = U.el('div', 'sp-col');
    if (sh.poster) { var im = U.el('img', 'sp-poster'); im.src = sh.poster; im.alt = ''; im.onerror = function () { this.remove(); }; body.appendChild(im); }
    var status = /ended|canceled/i.test(sh.status || '') ? 'ended' : /returning|production|planned/i.test(sh.status || '') ? 'still running' : '';
    col.appendChild(U.el('div', 'sp-line', [sh.year ? 'Since ' + sh.year : '', sh.network, sh.seasons ? sh.seasons + (sh.seasons === 1 ? ' season' : ' seasons') : '', status, sh.rating ? '★ ' + sh.rating + ' TMDB' : ''].filter(Boolean).join('   ·   ')));
    if (sh.genre) col.appendChild(U.el('div', 'sp-genre', sh.genre));
    col.appendChild(U.el('p', 'sp-plot', sh.plot || 'TMDB has no summary for this show.'));
    if (sh.cast) col.appendChild(U.el('div', 'sp-cast', 'With ' + sh.cast));
    col.appendChild(U.el('div', 'sp-head', 'Coming up on ' + L.name(c)));
    var eps = U.el('div', 'sp-eps'); col.appendChild(eps);
    body.appendChild(col);
    function fill() {
      eps.innerHTML = '';
      var t = Date.now();
      list2.filter(function (q) { return q.e > t; }).slice(0, 6).forEach(function (q) {
        var se = q.ep ? Series.episode(sh, q.ep) : null, row = U.el('div', 'sp-ep' + (q.s <= t ? ' now' : ''));
        row.appendChild(U.el('span', 'sp-when', q.s <= t ? 'Now' : (dayName(q.s) === 'Today' ? '' : dayName(q.s) + '  ') + U.hhmm(q.s)));
        row.appendChild(U.el('span', 'sp-num', q.ep || ''));
        row.appendChild(U.el('span', 'sp-t', se && se.t && !Store.settings.noSpoilers ? se.t : q.n ? 'New episode' : ''));
        if (hasReminder(c, q)) row.appendChild(U.el('span', 'sp-rem', '◷ reminder'));
        eps.appendChild(row);
      });
      if (!eps.children.length) eps.appendChild(U.el('div', 'sp-none', 'Nothing more of it in the guide on this channel this week.'));
    }
    fill();
    var onNow = list2.filter(function (q) { return q.s <= now; })[0], next = list2.filter(function (q) { return q.s > now; })[0], buttons = [];
    if (onNow) buttons.push({ label: isPlaying(c) ? 'Watch fullscreen' : 'Watch now', action: function () { watch(c); } });
    if (next) buttons.push({ label: hasReminder(c, next) ? 'Cancel the reminder for ' + U.hhmm(next.s) : 'Remind me: ' + (dayName(next.s) === 'Today' ? '' : dayName(next.s) + ' ') + U.hhmm(next.s), action: function () { toggleReminder(c, next); } });
    buttons.push({ label: 'Close' });
    panelFill = fill; panelTitle = sh.title || p.t;
    UI.panel(panelTitle, body, buttons, null, { sub: RAW(L.name(c) + '   ·   TMDB') });
    UI.onClose = function () { panelFill = null; };
  }
  // Info on a series opens its panel; on anything else, the options menu as before.
  function details() {
    var c = list[sel]; if (!c) return;
    var h = progAt(c, focusT), sh = h.p && typeof Series !== 'undefined' ? Series.of(c, h.p) : null;
    if (sh) showPanel(c, h.p, sh); else menu();
  }

  // Number keys jump to that channel number (1, 2, 3 for 123).
  var numBuf = '', numT = 0;
  function numJump(d) {
    clearTimeout(numT); numBuf = (numBuf + d).slice(-5);
    var z = $('zapNum'); z.textContent = numBuf; z.classList.remove('hidden');
    numT = setTimeout(function () {
      z.classList.add('hidden');
      var n = +numBuf; numBuf = '';
      var i = list.findIndex(function (c) { return +c.num === n; });
      if (i < 0) {
        var c = L.channels(L.ALL).filter(function (x) { return +x.num === n; })[0];
        if (c) { load(c.g, c.k); setZone('grid'); draw(); return; }
        U.toast('No channel ' + n); return;
      }
      if (zone !== 'grid') setZone('grid');
      selectIdx(i);
    }, L.numberCanGrow(numBuf) ? 1200 : 0);
  }

  var leftTap = 0, leftGroups = 0;
  function backToMenu() { Views.tabBar(function () { UI.setHandler(keys); setZone('groups'); }, true); }
  function groupKeys(a) {
    if (a === 'up') groupsVL.move(-1, true);              // past the first group: round to the last
    else if (a === 'down') groupsVL.move(1, true);       // past the last group: back to the first
    else if (a === 'chup') groupsVL.page(-1);
    else if (a === 'chdown') groupsVL.page(1);
    else if (a === 'right' || a === 'ok') enterGrid();
    else if (a === 'left') {
      // Still the Left that opened the groups, held past the wait above (a slow remote): back to the guide,
      // going back in time as a held Left should.
      if (leftGroups && Date.now() - leftGroups < 4000 && heldFor('left') > 0) { leftGroups = 0; setZone('grid'); moveTime(-1, true); return true; }
      leftGroups = 0; backToMenu();
    }
    else if (a === 'back') { if (Views.bankedBack()) { /* pressed before the screen caught up */ } else if (Views.exitArmed()) Views.exitApp(true); else backToMenu(); }
    else if (a === 'hold' || a === 'red' || a === 'info') { var g = groupsVL.current(); if (g) Views.groupMenu(g); }
    else if (a === 'playpause') watchPreview();
    else if (a.indexOf('num') === 0) numJump(a.slice(3));
    return true;
  }
  /* Moving a channel: ▲ ▼ move it a row, CH +/− a page, OK, Back or Hold OK when done.  The order is
     saved as it goes (Library.moveInGroup), the same as moving it in the channel list. */
  function startMove(c) {
    if (!c || !L.canReorder(gid)) return;
    moving = c.k;
    draw();
    UI.hints([['', '▲ ▼  move    CH +/−  a page'], ['', 'OK or Back  done', 'ok']]);
    U.toast('Moving ' + L.name(c) + '.  ▲ ▼ to move, OK when done.', 4000);
  }
  function endMove() { moving = null; draw(); hints(); U.toast('Channel order saved'); }
  function moveKeys(a) {
    var step = a === 'up' ? -1 : a === 'down' ? 1 : a === 'chup' ? -(VIS - 1) : a === 'chdown' ? VIS - 1 : 0;
    if (step) {
      if (L.moveInGroup(gid, moving, step)) {
        list = L.channels(gid);
        var i = list.findIndex(function (x) { return x.k === moving; });
        if (i >= 0) { sel = i; top = U.clamp(top, Math.max(0, sel - VIS + 2), Math.max(0, Math.min(sel - 1, list.length - VIS))); }
        draw();
      }
    } else if (a === 'ok' || a === 'back' || a === 'hold') endMove();
    return true;
  }
  /* Show or hide channels, in the guide itself: every channel of the group with a tick (hidden ones
     dimmed), OK ticks or unticks, Red for all / none / no guide, Back saves (one save) and leaves. */
  function startVis(g, c) {
    if (!Views.canManage(g)) return;
    vis = { gid: g, was: {}, on: {} };
    if (zone !== 'grid') setZone('grid');
    load(g, c && c.k);
    L.channels(g, true).forEach(function (x) { vis.on[x.k] = vis.was[x.k] = !L.isHidden(x.k); });
    head(); draw(); hints();
    U.toast('Untick the channels to hide.  Back saves.', 3500);
  }
  function endVis(keep) {
    if (!vis) return;
    var v = vis, change = {}, hid = 0, shown = 0, at = list[sel] && list[sel].k;
    vis = null;
    if (keep) Object.keys(v.on).forEach(function (k) { if (v.on[k] !== v.was[k]) { change[k] = !v.on[k]; if (v.on[k]) shown++; else hid++; } });
    if (hid || shown) { L.hideChannels(change); U.toast([hid ? hid + ' hidden' : '', shown ? shown + ' shown' : ''].filter(Boolean).join(', ') + '.  Hidden channels are hidden in every group.', 4000); }
    else if (!keep) U.toast('Nothing changed');
    Views.refreshLists(true);
    load(gid, at); draw(); hints();
  }
  function visAll(f) { list.forEach(function (c) { var on = f(c); if (on != null) vis.on[c.k] = on; }); head(); draw(); }
  function visKeys(a) {
    if (a === 'up') moveSel(-1);
    else if (a === 'down') moveSel(1);
    else if (a === 'chup') selectIdx(sel - (VIS - 1));
    else if (a === 'chdown') selectIdx(sel + (VIS - 1));
    else if (a === 'ok') { var c = list[sel]; if (c) { vis.on[c.k] = !vis.on[c.k]; head(); draw(); } }
    else if (a === 'red' || a === 'hold') UI.menu('Show or hide channels', [
      { label: 'Show all', action: function () { visAll(function () { return true; }); } },
      { label: 'Hide all', action: function () { visAll(function () { return false; }); } },
      noGuideHide(function () { visAll(function (c) { return Epg.hasData(c) ? null : false; }); }),
      { label: 'Save and finish', action: function () { endVis(true); } },
      { label: 'Leave without saving', action: function () { endVis(false); } }
    ]);
    else if (a === 'back') endVis(true);
    return true;
  }
  function keys(a) {
    if (zone === 'groups') return groupKeys(a);
    if (moving) return moveKeys(a);
    if (vis) return visKeys(a);
    if (a === 'up' || a === 'down') {
      // Held: a row at a time, then three at a time after a second and a half (#3 in the ideas).
      var d = a === 'up' ? -1 : 1, ms = heldFor(a);
      if (ms > 1500) selectIdx(sel + d * 3); else moveSel(d);
    }
    else if (a === 'chup') selectIdx(sel - (VIS - 1));
    else if (a === 'chdown') selectIdx(sel + (VIS - 1));
    else if (a === 'left' || a === 'right') {
      // Held: at most about eight programmes a second for the first second, so it can be stopped where
      // you want, then as fast as the remote repeats.  A held Left pauses at now, then keeps going back
      // to what was on (any channel, catch-up or not); only a fresh press at now opens the groups.
      var ms2 = heldFor(a), t = Date.now();
      // A Left still held after the first press: a hold, so the groups it was about to open don't.
      if (ms2 > 0 && leftTap) { clearTimeout(leftTap); leftTap = 0; }
      if (ms2 > 0 && ms2 < 1000 && t - stepAt < 120) return true;
      stepAt = t;
      if (a === 'right') moveTime(1);
      else if (when() !== 'now') moveTime(-1);
      else if (ms2 > 400) moveTime(-1, true);      // held at now: back in time, to see what was on
      /* A fresh Left at now: the groups, but only once it's clear it was a press and not the start of a
         hold.  Opened at once, a held Left went
         to the groups and then, with its repeats, on to the side menu, never back in time. */
      else if (!ms2) {
        // A second press before the first was settled: both presses, the groups and then the menu.
        if (leftTap) { clearTimeout(leftTap); leftTap = 0; setZone('groups'); backToMenu(); return true; }
        /* A quarter second on: let go, it was a press (the groups); still down, it's a hold, going back in
           time at once (some TVs' repeats only start after more than half a second). */
        leftTap = setTimeout(function () {
          leftTap = 0;
          if (zone !== 'grid' || when() !== 'now') return;
          if (UI.isDown && UI.isDown('left')) { moveTime(-1, true); return; }
          setZone('groups'); leftGroups = Date.now();
        }, 250);
      }
    }
    // Rewind and Fast-forward: a whole screen of the guide (two and a half hours), not one programme;
    // held, one jump about every third of a second (#1 in the ideas).
    else if (a === 'rew' || a === 'ff') { var tj = Date.now(); if (tj - jumpAt < 320) return true; jumpAt = tj; screenJump(a === 'ff' ? 1 : -1); }
    else if (a === 'ok') activate();
    else if (a !== 'back' && a.indexOf('num') !== 0) {
      // Every other button does what Settings > Remote and buttons > In the guide says.
      var act = Keymap.get('guide', a === 'hold' ? 'long:ok' : a);
      if (act) mapped(act);
    }
    else if (a === 'back') { if (when() !== 'now') jumpNow(); else { setZone('groups'); Views.armExit(); } }
    else if (a.indexOf('num') === 0) numJump(a.slice(3));
    return true;
  }

  // How long this button has been held: 0 for a fresh press, else the time since the hold began.  A
  // repeat is the same button again within a quarter of a second (some TVs don't flag repeats).
  function heldFor(a) {
    var t = Date.now(), fresh = held.a !== a || t - held.last > 250;
    if (fresh) { held.a = a; held.since = t; }
    held.last = t;
    return fresh ? 0 : Math.max(1, t - held.since);
  }
  function mapped(act) {
    var c = list[sel];
    if (act === 'full') { if (!watchPreview()) { if (c) Views.startChannel(c, false, Views.goFull); } }
    else if (act === 'menu') menu();
    else if (act === 'groups') setZone('groups');
    else if (act === 'now') { jumpNow(); flashJump(Date.now()); }
    else if (act === 'jump') jumpMenu();
    else if (act === 'details') details();
    else if (act === 'stopwin') { if (previewing()) { Views.stopAll(); draw(); hints(); } }
    // ● REC on a programme: record it (on now) or schedule it (later); again: stop or cancel.
    else if (act === 'record') { if (c && typeof Record !== 'undefined') { var rp = progAt(c, focusT).p, ri = Record.menuItem(c, rp); if (ri) { ri.action(); setTimeout(draw, 800); } else U.toast(T(Record.base() ? 'That programme is over' : 'Recording needs TiviBro\'s helper, which isn\'t running')); } }
    else if (act === 'favorites' || act === 'recents') { load(act === 'favorites' ? L.FAV : L.RECENT, null); setZone('grid'); draw(); }
    else if (act === 'fav') { if (c && L.toggleFav(c.k) != null) { U.toast(L.isFav(c.k) ? 'Added to Favorites' : 'Removed from Favorites'); draw(); } }
    else if (act !== 'none') Views.runAction(act, 'guide');
  }
  function rowUpdated(k) {
    for (var i = 0; i < rows.length; i++) if (rows[i].k === k) { drawRow(rows[i], top + i); if (top + i === sel) drawDetail(); }
  }

  return { open: open, resume: resume, refresh: refresh, draw: draw, resize: resize, rowUpdated: rowUpdated, leave: leave, hints: hints, startVis: startVis, endVis: endVis, get vis() { return !!vis; },
    __sel: function () { return sel; }, __gsel: function () { return groupsVL ? groupsVL.sel : 0; }, __focusT: function () { return focusT; }, __t0: function () { return t0; }, __gid: function () { return gid; }, __zone: function () { return zone; }, __list: function () { return list; } };
})();
