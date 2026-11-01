/* Settings.  Left/right changes a value in place, OK opens or cycles, Back goes up a page. */
var Settings = (function () {
  'use strict';
  var $ = U.$, S = function () { return Store.settings; }, L = Library;
  var nav = $('setNav'), body = $('setBody');
  var SECTIONS = [['playback', 'Playback and buffering'], ['remote', 'Remote control'], ['playlists', 'Playlists and guide'], ['editor', 'Edit on a phone or computer'], ['phone', 'Phone app'],
    ['groups', 'Groups, sorting, hidden'], ['reminders', 'Guide, start screen, reminders'], ['look', 'Appearance'], ['parental', 'Parental controls'], ['updates', 'Updates and about'], ['diag', 'Diagnostics']];
  var sec = 0, zone = 'nav', sel = 0, items = [], scrollEl = null, rowEls = [];
  // Phone app: test builds only while the Android app is in the works.
  function shown(i) { return !!SECTIONS[i] && (SECTIONS[i][0] !== 'phone' || /alpha|beta/i.test(TIVIBRO_VERSION)); }
  function nextSec(d) { var i = sec + d; while (SECTIONS[i] && !shown(i)) i += d; return SECTIONS[i] ? i : sec; }
  var stack = [];               // sub-pages: [{ title, fn, sel }]

  function cyc(list, cur, dir) { var i = list.indexOf(cur); if (i < 0) i = 0; return list[(i + dir + list.length) % list.length]; }
  function choice(label, sub, values, labels, get, set) {
    return { label: label, sub: sub, value: function () { var i = values.indexOf(get()); return i >= 0 ? labels[i] : String(get()); },
      cycle: function (d) { set(cyc(values, get(), d)); } };
  }
  function toggle(label, sub, get, set) {
    return { label: label, sub: sub, value: function () { return get() ? 'On' : 'Off'; }, cycle: function () { set(!get()); } };
  }
  function action(label, sub, fn, value) { return { label: label, sub: sub, action: fn, value: value || function () { return ''; } }; }
  function head(t) { return { head: true, label: t }; }
  function info(label, value) { return { label: label, info: true, value: function () { return value; } }; }
  function page(label, sub, title, fn, value) { return action(label, sub, function () { push(title, fn); }, value || function () { return '›'; }); }
  function save(rebuild) { Store.saveSettings(); if (rebuild) build(); else paint(); }
  function push(title, fn) { stack.push({ title: title, fn: fn, sel: sel }); sel = 0; build(); }
  function pop() { var p = stack.pop(); sel = p ? p.sel : 0; build(); }
  function relist() { L.dirty(); Views.refreshLists(true); }
  function when(t) { if (!t) return 'never'; var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + U.hhmm(t); }

  var REFRESH = [-1, 6, 12, 24, 48, 168, 0], REFRESH_L = ['Every app start', 'Every 6 hours', 'Every 12 hours', 'Every day', 'Every 2 days', 'Every week', 'Only when I ask'];

  /* ---------- playback ---------- */
  function playback() {
    var s = S(), out = [];
    var P = Player.PRESETS;
    out.push(choice('Buffer profile',
      'How much video to hold before and during playback.  More buffer means fewer freezes on shaky streams, but channels take a little longer to start.',
      ['low', 'balanced', 'stable', 'max', 'custom'], [P.low.label, P.balanced.label, P.stable.label, P.max.label, 'Custom'],
      function () { return s.buffer; }, function (v) { s.buffer = v; save(true); }));
    var cur = s.buffer === 'custom' ? null : P[s.buffer];
    if (cur) out.push(info('Profile details', 'starts at ' + cur.prebuffer + 's, holds ' + cur.ahead + 's, refills to ' + Math.max(2, cur.prebuffer * 1.5) + 's'));
    if (s.buffer === 'custom') {
      var c = s.custom;
      out.push(choice('Start-up buffer', 'Seconds buffered before a channel starts playing.', [0.5, 1, 2, 3, 4, 6, 8, 10, 15], ['0.5s', '1s', '2s', '3s', '4s', '6s', '8s', '10s', '15s'], function () { return +c.prebuffer; }, function (v) { c.prebuffer = v; save(); }));
      out.push(choice('Read-ahead', 'How far ahead the player downloads while playing.', [10, 20, 30, 45, 60, 90, 120], ['10s', '20s', '30s', '45s', '60s', '90s', '120s'], function () { return +c.ahead; }, function (v) { c.ahead = v; save(); }));
      out.push(choice('Keep behind playhead', 'Lower saves TV memory on long sessions.', [2, 4, 8, 12, 20, 30], ['2s', '4s', '8s', '12s', '20s', '30s'], function () { return +c.back; }, function (v) { c.back = v; save(); }));
      out.push(choice('Freeze detection', 'How long a frozen picture is tolerated before the player recovers it.', [3, 4, 6, 8, 10, 15, 20], ['3s', '4s', '6s', '8s', '10s', '15s', '20s'], function () { return +c.stall; }, function (v) { c.stall = v; save(); }));
      out.push(choice('Reconnect attempts', 'Tries before giving up on a channel.  The budget resets after 30 seconds of clean playback.', [3, 5, 8, 12, 20, 50], ['3', '5', '8', '12', '20', '50'], function () { return +c.retries; }, function (v) { c.retries = v; save(); }));
    }
    out.push(head('Player'));
    out.push(choice('Player engine',
      'Automatic uses the built-in demuxer for fine buffer control and falls back to the TV player when a server blocks it.  TV player uses the least CPU but ignores buffer settings.',
      ['auto', 'mse', 'native'], ['Automatic', 'Built-in demuxer', 'TV player'], function () { return s.engine; }, function (v) { s.engine = v; save(); }));
    if (Store.playlist.type === 'xtream') out.push(choice('Stream format', 'MPEG-TS usually switches channels faster.  HLS copes better with a weak connection.',
      ['ts', 'm3u8'], ['MPEG-TS', 'HLS'], function () { return s.format; }, function (v) { s.format = v; save(); }));
    out.push(choice('Connection', 'Automatic uses the network helper: a part of TiviBro that runs in the background on the TV and fetches your channels, guide and streams for the app.  webOS needs it for most providers.  Direct asks the provider straight from the app, which only works with servers that allow it.',
      ['auto', 'direct'], ['Automatic (recommended)', 'Direct'], function () { return s.network || 'auto'; }, function (v) { s.network = v; save(); }));
    out.push(info('Network helper', Net.port ? 'running' : 'not running'));
    out.push(choice('Buffer meter', 'Shows how many seconds of video are banked, in fullscreen.', ['auto', 'always', 'off'], ['When low', 'Always', 'Off'], function () { return s.meter; }, function (v) { s.meter = v; save(); }));
    out.push(choice('Buffer info on demand', Keymap.bufferHint() + ' shows the buffer meter and stream info, even with the meter off.  Press again to hide it.  Any button can do this: Settings > Remote control.',
      [5, 10, 30, 0], ['5 seconds', '10 seconds', '30 seconds', 'Until pressed again'], function () { return s.meterPeek == null ? 10 : +s.meterPeek; }, function (v) { s.meterPeek = v; save(); }));
    out.push(toggle('Preview in channel list', 'Plays the channel you rest on.  Turn off on very slow TVs for the snappiest list.', function () { return s.previewPlay; }, function (v) { s.previewPlay = v; save(); }));
    out.push(choice('When a channel stops working', 'Switches to another version of the same channel, such as the HD copy of a Full HD channel, or one you hid.  It only happens once the player has run out of retries.',
      ['auto', 'ask', 'off'], ['Switch to another version', 'Ask me', 'Keep retrying'], function () { return s.backups || 'auto'; }, function (v) { s.backups = v; save(); }));
    out.push(toggle('Turn on last channel at launch', '', function () { return s.resumeLast; }, function (v) { s.resumeLast = v; save(); }));
    out.push(choice('HDR and Dolby Vision', 'Automatic plays Dolby Vision through the TV player, which switches the screen into Dolby Vision itself, and keeps HDR10 and HLG on the built-in player for its steadier buffering.  Choose TV player for all HDR if HDR pictures look washed out or grey.',
      ['auto', 'tv', 'builtin'], ['Automatic', 'TV player for all HDR', 'Built-in player'], function () { return s.hdrRoute || 'auto'; }, function (v) { s.hdrRoute = v; save(); }));
    out.push(choice('Picture', '', ['contain', 'fill', 'cover'], ['Normal', 'Stretch', 'Zoom'], function () { return s.display; }, function (v) { s.display = v; Player.applyDisplay(); save(); }));
    out.push(head('Catch-up, movies and shows'));
    out.push(choice('Skip step', 'For Left and Right while watching catch-up or a movie.', [10, 15, 30, 60, 120], ['10s', '15s', '30s', '1 min', '2 min'], function () { return +s.skip; }, function (v) { s.skip = v; save(); }));
    out.push(choice('Rewind / fast forward step', 'For the ◀◀ and ▶▶ buttons while watching catch-up or a movie.', [30, 60, 120, 300, 600], ['30s', '1 min', '2 min', '5 min', '10 min'], function () { return +s.ffStep || 120; }, function (v) { s.ffStep = v; save(); }));
    out.push(choice('◀ on a live channel with catch-up', 'Without catch-up, ◀ always goes to the last channel.', ['rewind', 'last'], ['Rewind', 'Last channel'], function () { return s.rewindLeft === false ? 'last' : 'rewind'; }, function (v) { s.rewindLeft = v === 'rewind'; save(); }));
    out.push(head('Switching channels'));
    out.push(toggle('Info panel when switching channels', 'Off shows just the number and name.', function () { return s.osdOnZap !== false; }, function (v) { s.osdOnZap = v; save(); }));
    out.push(toggle('Show stream details in the info panel', 'Resolution and which player is in use.', function () { return s.osdMedia !== false; }, function (v) { s.osdMedia = v; save(); }));
    out.push(toggle('Black screen while switching', 'Hides the last picture until the next channel starts.', function () { return !!s.blackSwitch; }, function (v) { s.blackSwitch = v; save(); }));
    out.push(head('Audio and subtitles'));
    out.push(action('Audio language', 'When a channel or movie has more than one audio track, play this one.  Audio description tracks are skipped.', function () {
      langMenu('Audio language', 'The stream\'s own choice', s.audioLang, function (v) { s.audioLang = v; save(); });
    }, function () { return langName(s.audioLang, 'Stream\'s choice'); }));
    out.push(toggle('Prefer surround sound', 'Picks the 5.1 or Dolby track when there is one in that language.  Your soundbar or TV needs to support it.', function () { return !!s.audioSurround; }, function (v) { s.audioSurround = v; save(); }));
    out.push(action('Subtitles automatically', 'Turns subtitles on when a stream includes them.  You can still switch them from OK in fullscreen.', function () {
      UI.menu('Subtitles automatically', [{ label: 'Off', sub: !s.autoSubs ? 'on' : '', action: function () { s.autoSubs = false; save(); } },
        { label: 'Any language', sub: s.autoSubs && !s.subsLang ? 'on' : '', action: function () { s.autoSubs = true; s.subsLang = ''; save(); } }]
        .concat(U.LANGS.map(function (l) { return { label: l[1] + ' only', sub: s.autoSubs && s.subsLang === l[0] ? 'on' : '', action: function () { s.autoSubs = true; s.subsLang = l[0]; save(); } }; })));
    }, function () { return !s.autoSubs ? 'Off' : s.subsLang ? langName(s.subsLang) : 'Any language'; }));
    out.push(toggle('Play next episode automatically', '', function () { return s.autoNext !== false; }, function (v) { s.autoNext = v; save(); }));
    return out;
  }

  /* ---------- remote ---------- */
  function remote() {
    var out = [];
    out.push(page('In the player', 'Fullscreen live TV.', 'Buttons in the player', function () { return keysPage('player'); }));
    out.push(page('In the channel list', 'Arrows, OK and Back stay fixed so you can always get around.', 'Buttons in the channel list', function () { return keysPage('list'); }));
    out.push(page('Quick menu buttons', 'Which buttons show when you press OK in fullscreen.', 'Quick menu buttons', function () {
      var o = [], off = S().qpHidden || (S().qpHidden = {});
      o.push(info('Buttons only appear when they apply, e.g. Audio needs two or more tracks.', ''));
      Views.QP_BUTTONS.forEach(function (b) {
        o.push(toggle(b[1], '', function () { return !off[b[0]]; }, function (v) { if (v) delete off[b[0]]; else off[b[0]] = 1; save(); }));
      });
      return o;
    }));
    out.push(head('Extra buttons'));
    out.push(action('Learn a button', 'For keys the app does not know yet.  Press this, then press the button.', function () {
      U.toast('Press the button to learn', 5000);
      UI.captureNext(function (code, known) {
        if (known && Keymap.BUTTONS.some(function (b) { return b[0] === known; })) { U.toast('That is ' + Keymap.label(known) + ', already supported'); return; }
        Keymap.learn(code); U.toast('Learned button ' + code + '.  Assign it under In the player or In the channel list.'); build();
      });
    }));
    out.push(action('Button tester', 'Shows what the app sees when you press a button.', function () {
      U.toast('Press any button', 5000);
      UI.captureNext(function (code, known) { U.toast('Key code ' + code + (known ? ':  ' + Keymap.label(known) : ':  not assigned'), 4000); });
    }));
    out.push(head(''));
    out.push(action('Restore default buttons', '', function () { UI.confirm('Restore every button to its default?', 'Restore', function () { Keymap.reset(); U.toast('Default buttons restored'); build(); }); }));
    return out;
  }
  function keysPage(ctx) {
    var out = [];
    var acts = Keymap.CONTEXT_ACTIONS[ctx];
    function slot(btn, label) {
      return action(label, '', function () {
        UI.menu(label, acts.map(function (a) {
          return { label: Keymap.ACTIONS[a], sub: Keymap.get(ctx, btn) === a ? 'current' : '', current: Keymap.get(ctx, btn) === a, action: function () { Keymap.set(ctx, btn, a); paint(); } };
        }));
      }, function () { var a = Keymap.get(ctx, btn); return Keymap.ACTIONS[a || 'none']; });
    }
    Keymap.allButtons().forEach(function (b) {
      var arrowish = { up: 1, down: 1, left: 1, right: 1, chup: 1, chdown: 1, back: 1 };
      if (!Keymap.fixed(ctx, b[0])) out.push(slot(b[0], b[1]));
      // Long presses on arrows would break held scrolling in lists.
      if (b[0] !== 'back' && !(ctx === 'list' && arrowish[b[0]])) out.push(slot('long:' + b[0], 'Hold ' + b[1]));
    });
    out.push(head(''));
    out.push(action('Restore defaults for this screen', '', function () { Keymap.reset(ctx); U.toast('Defaults restored'); build(); }));
    return out;
  }

  /* ---------- playlists ---------- */
  function playlists() {
    var s = S(), out = [];
    s.playlists.forEach(function (raw) {
      var p = Store.normalize(raw), active = p.id === s.active;
      out.push(page(p.name || (p.type === 'xtream' ? p.user : 'M3U'), [Store.expiry(p), p.type === 'xtream' ? 'Xtream Codes' : 'M3U playlist', active ? 'in use, ' + L.count() + ' channels' : ''].filter(Boolean).join('   '),
        p.name || 'Playlist', function () { return playlistPage(p); }));
    });
    out.push(action('Add playlist…', 'Each playlist keeps its own groups, favorites, hidden items, guide and name rules.', function () { App.setup('new'); }));
    out.push(head('About'));
    out.push(info('TiviBro ' + TIVIBRO_VERSION, 'hls.js ' + (window.Hls ? Hls.version : '') + '   mpegts.js'));
    return out;
  }

  function persist(p, reloadGuide) {
    Store.upsertPlaylist(p);
    if (p.id === S().active && reloadGuide) Epg.refresh(L, true);
  }

  function playlistPage(p) {
    var s = S(), out = [], active = p.id === s.active, xc = p.type === 'xtream';
    if (!active) out.push(action('Use this playlist', '', function () { stack = []; App.switchPlaylist(p.id); }));
    out.push(action('Name', '', function () { UI.prompt('Playlist name', p.name, function (v) { if (v.trim()) { p.name = v.trim(); persist(p); build(); } }); }, function () { return p.name; }));
    out.push(action('Connection', xc ? 'Server, username and password' : 'Playlist address', function () { App.setup(p.id); }, function () { return xc ? p.server : p.m3u; }));
    out.push(action('User-Agent', 'Only if your provider asks for a specific one.  Sent by the network helper for this playlist.', function () {
      UI.prompt('User-Agent (empty = default)', p.ua || '', function (v) { p.ua = v.trim(); persist(p); build(); U.toast(p.ua ? 'User-Agent set.  Reload channels to use it everywhere.' : 'Default User-Agent'); });
    }, function () { return p.ua ? p.ua.slice(0, 28) + (p.ua.length > 28 ? '…' : '') : 'Default'; }));
    out.push(head('Channel list updates'));
    out.push(choice('Reload channel list', '', REFRESH, REFRESH_L, function () { return +p.plRefresh; }, function (v) { p.plRefresh = v; persist(p); paint(); }));
    if (active) {
      out.push(action('Reload channels now', 'Your groups, renames and hidden items are kept.', function () { App.refresh(true); }));
      out.push(info('Last reloaded', when(L.data.at)));
      if (L.data.exp) out.push(info('Subscription expires', new Date(L.data.exp).toLocaleDateString() + (Store.expiry(p) ? '  (' + Store.expiry(p).replace(/^Expire[sd] /, '') + ')' : '')));
      if (L.data.maxConn) out.push(info('Connections allowed', String(L.data.maxConn)));
    }
    out.push(head('Guide'));
    out.push(choice('Provider guide', xc ? 'Per channel is light and loads as you browse.  The full file also enables guide search and manual assignment.' : 'The guide address inside the playlist, if it has one.',
      xc ? ['short', 'xmltv', 'off'] : ['xmltv', 'off'], xc ? ['Per channel', 'Full XMLTV file', 'Off'] : ['From playlist', 'Off'],
      function () { return p.providerEpg; }, function (v) { p.providerEpg = v; persist(p, true); build(); }));
    var offs = [], offl = [];
    for (var m = -720; m <= 720; m += 30) { offs.push(m); offl.push((m > 0 ? '+' : m < 0 ? '-' : '') + Math.floor(Math.abs(m) / 60) + ':' + U.pad(Math.abs(m) % 60)); }
    if (p.providerEpg !== 'off') out.push(choice('Provider guide time offset', 'Use when every programme is too early or too late.', offs, offl, function () { return +p.epgOffset; }, function (v) { p.epgOffset = v; persist(p, true); paint(); }));
    out.push(page('Guide sources', (p.epgSources || []).length + ' XMLTV address' + ((p.epgSources || []).length === 1 ? '' : 'es') + ', checked before the provider guide', 'Guide sources', function () { return sourcesPage(p); }));
    out.push(choice('Reload guide', '', REFRESH, REFRESH_L, function () { return +p.epgRefresh; }, function (v) { p.epgRefresh = v; persist(p); paint(); }));
    out.push(choice('Keep past days', 'For catch-up browsing.  More days use more TV memory.', [1, 2, 3, 5, 7], ['1 day', '2 days', '3 days', '5 days', '7 days'], function () { return +p.epgDays; }, function (v) { p.epgDays = v; persist(p, true); paint(); }));
    out.push(toggle('Match guide by channel name', 'Links channels that have no guide id to a guide channel with the same name.', function () { return p.nameMatch; }, function (v) { p.nameMatch = v; persist(p, true); paint(); }));
    out.push(page('Public guide fill-in', 'Free guides from epg.pw and iptv-epg.org, only for channels nothing else covers', 'Public guide fill-in', function () { return pubPage(p); }, function () { return PubEpg.conf(p).on ? 'On' : 'Off'; }));
    if (active) {
      out.push(action('Reload guide now', '', function () { Epg.refresh(L, true); U.toast('Reloading guide'); live(); }));
      var st = Epg.status;
      if (Epg.xml) {
        out.push(info('Guide last loaded', Epg.loading || (Epg.progress && Epg.progress.active) ? 'loading now' : when(st.at)));
        (st.sources || []).forEach(function (r) { out.push(info(r.url.replace(/(password|pass)=[^&]+/i, '$1=…'), r.ok ? r.channels + ' channels, ' + r.programmes + ' programmes' : 'failed: ' + r.error)); });
        var all = L.data.channels, n = 0, missing = [];
        all.forEach(function (c) { if (Epg.hasData(c)) n++; else if (missing.length < 300) missing.push(c); });
        out.push(info('Channels with guide data', n + ' of ' + all.length));
        if (missing.length) out.push(action('Assign guide to channels without one', 'Or hold OK on any channel and choose Assign guide.', function () {
          UI.menu('Channels without guide', missing.map(function (c) { return { label: L.name(c), sub: L.groupName(c.g), action: function () { assignGuide(c); } }; }));
        }));
      }
    }
    out.push(head('Channel names'));
    if (active) out.push(action('Set-up tour', 'Countries, channel names, East or West, your city, event channels, clutter, logos and look, one screen at a time.', function () { Tour.open({ from: 'settings' }); }, function () { return p.tour > 0 ? 'done ' + when(p.tour) : '›'; }));
    out.push(page('Channel name editor', p.names && p.names.enabled ? 'On' : 'Off', 'Channel name editor', function () { return namesPage(p); }));
    out.push(page('Event channels', p.events && p.events.on === false ? 'Off' : 'On', 'Event channels', function () { return eventsPage(p); }));
    if (s.playlists.length > 1) {
      out.push(head(''));
      out.push(action('Delete this playlist', 'Removes its groups, favorites, hidden items and cached data.', function () {
        UI.confirm('Delete ' + (p.name || 'this playlist') + '?', 'Delete', function () {
          stack = [];
          Store.removePlaylist(p.id);
          if (active) App.switchPlaylist(Store.settings.active); else build();
        });
      }));
    }
    return out;
  }

  /* Public guide fill-in (pubepg.js): on or off, which countries, and how the last look went. */
  function pubPage(p) {
    var out = [], active = p.id === S().active, cf = PubEpg.conf(p), st = active ? Epg.pubStatus : null;
    function apply(patch) { PubEpg.set(p, patch); Store.upsertPlaylist(p); if (active) Epg.refresh(L, false); build(); }
    out.push(toggle('Fill in from public guides', 'For channels with no guide from your sources or your provider.  Those always come first.', function () { return PubEpg.conf(p).on; }, function (v) { apply({ on: v }); }));
    if (cf.on) {
      var auto = st && st.countries && st.countries.length && !cf.cc.length ? st.countries.map(PubEpg.name).join(', ') : '';
      out.push(action('Countries', cf.cc.length ? 'Your choice' : 'Automatic: the countries of the channels that need a guide' + (auto ? ' (' + auto + ')' : ''), function () { countryMenu(p); },
        function () { return cf.cc.length ? cf.cc.map(PubEpg.name).join(', ') : 'Automatic'; }));
      if (active) {
        if (Epg.loading && (!st || !st.at)) out.push(info('Looking', 'after your own guide loads'));
        else if (st && st.none) out.push(info('Last look', st.none));
        else if (st && st.at) {
          out.push(info('Channels filled in', st.filled + ' of ' + st.asked + ' with no other guide'));
          out.push(info('Last looked', when(st.at) + (st.took ? ', took ' + Math.max(1, Math.round(st.took / 1000)) + ' s' : '')));
          (st.sources || []).forEach(function (r) { out.push(info(r.url, r.skipped ? 'not needed' : r.ok ? r.filled + ' channels' : 'failed: ' + r.error)); });
          if (!Net.active) out.push(info('iptv-epg.org', 'needs Settings > Playback > Network set to Automatic'));
        }
        out.push(action('Look again now', 'Downloads the public guides again.', function () { Epg.pubAgain(); U.toast('Looking in the public guides'); live(); }));
      }
    }
    out.push(action('About these guides', 'Free, community-run guides.  TiviBro hosts nothing and sends no logins: the TV downloads the files straight from them, at most twice a day.  A wrong match?  Hold OK on the channel and choose Assign guide.', function () {}));
    return out;
  }
  function countryMenu(p) {
    var cf = PubEpg.conf(p), pick = {};
    cf.cc.forEach(function (c) { pick[c] = 1; });
    function save() { PubEpg.set(p, { cc: Object.keys(pick) }); Store.upsertPlaylist(p); if (p.id === S().active) Epg.refresh(L, false); build(); }
    var items = [{ label: 'Automatic', sub: cf.cc.length ? '' : 'current', action: function () { pick = {}; save(); } }];
    PubEpg.all().forEach(function (c) {
      items.push({ label: (pick[c] ? '✓ ' : '') + PubEpg.name(c), sub: PubEpg.SOURCES.filter(function (s) { return s.cc.indexOf(c) >= 0; }).map(function (s) { return s.name; }).join(', '),
        action: function () { if (pick[c]) delete pick[c]; else if (Object.keys(pick).length < 8) pick[c] = 1; else { U.toast('Up to 8 countries'); return; } save(); countryMenu(p); } });
    });
    UI.menu('Public guide countries', items);
  }

  function sourcesPage(p) {
    var out = [], list = p.epgSources || (p.epgSources = []);
    if (!list.length) out.push(info('No guide sources yet', ''));
    list.forEach(function (src, i) {
      out.push(action(src.url, 'Priority ' + (i + 1) + (src.offset ? '   offset ' + (src.offset > 0 ? '+' : '') + src.offset + ' min' : ''), function () {
        UI.menu('Guide source ' + (i + 1), [
          { label: 'Edit address…', action: function () { UI.prompt('XMLTV address', src.url, function (v) { if (v.trim()) { src.url = v.trim(); persist(p, true); build(); } }); } },
          { label: 'Time offset…', action: function () {
            var opts = [];
            for (var m = -720; m <= 720; m += 30) opts.push(m);
            UI.menu('Time offset', opts.map(function (m) { return { label: (m > 0 ? '+' : m < 0 ? '-' : '') + Math.floor(Math.abs(m) / 60) + ':' + U.pad(Math.abs(m) % 60), sub: m === (+src.offset || 0) ? 'current' : '', action: function () { src.offset = m; persist(p, true); build(); } }; }));
          } },
          i > 0 && { label: 'Move up', action: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); persist(p, true); build(); } },
          i < list.length - 1 && { label: 'Move down', action: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); persist(p, true); build(); } },
          { label: 'Remove', action: function () { list.splice(i, 1); persist(p, true); build(); } }
        ]);
      }));
    });
    out.push(action('Add guide source…', 'XMLTV format.  .xml and .xml.gz both work.', function () {
      UI.prompt('XMLTV address', 'http://', function (v) { v = v.trim(); if (v && v !== 'http://') { list.push({ url: v, offset: 0 }); persist(p, true); build(); U.toast('Guide source added'); } });
    }));
    return out;
  }

  // Pick a guide channel for a channel, searching the loaded guide sources by name.
  function assignGuide(c) {
    if (!Epg.xml) { U.toast('Add a guide source or turn on the full provider guide first'); return; }
    var cur = Store.edits.epgMap[c.k];
    UI.prompt('Search guide channels', L.name(c), function (q) {
      var nq = Epg.norm(q), raw = q.toLowerCase().trim();
      var hits = Epg.guideChannels().filter(function (x) { return Epg.norm(x[1]).indexOf(nq) >= 0 || x[0].toLowerCase().indexOf(raw) >= 0; }).slice(0, 200);
      var items = hits.map(function (x) { var ps = PubEpg.sourceOf(x[0]); return { label: x[1], sub: ps ? 'public guide, ' + ps.name + ' ' + x[0].split(':')[1].slice(0, 2) : x[0], action: function () { Epg.assign(c, x[0]); U.toast('Guide assigned'); Views.refreshLists(true); } }; });
      if (cur) items.unshift({ label: 'Remove assignment', sub: cur, action: function () { Epg.assign(c, ''); Views.refreshLists(true); } });
      if (!items.length) { U.toast('No guide channels match "' + q + '"'); return; }
      UI.menu('Guide for ' + L.name(c), items);
    }, 'Part of a name is enough.');
  }

  /* ---------- channel name editor ---------- */
  function namesPage(p) {
    var n = p.names || (p.names = Names.defaults()), out = [], active = p.id === S().active;
    function changed(rebuild) { persist(p); Names.invalidate(); if (active) relist(); if (rebuild) build(); else paint(); }
    out.push(toggle('Clean up channel names', 'Your playlist is not changed.  Turn off to see the original names.', function () { return n.enabled; }, function (v) { n.enabled = v; changed(true); }));
    out.push(toggle('Hide channels with nothing on', 'Channels named "Off Air", "Offline" or "No Event Scheduled", empty slots like "PPV 09 |", and events that ended hours ago stay out of the lists until the provider names a new event on them.  Favorites keep theirs.',
      function () { return !!n.hideIdle; }, function (v) { n.hideIdle = v; changed(); }));
    if (!n.enabled) return out.concat([preview(n, active)]);
    out.push(toggle('Clean group names too', 'Turns "USA | Sports" into "Sports" in the group list.', function () { return n.groups; }, function (v) { n.groups = v; changed(); }));
    out.push(head('Default rules, preloaded'));
    out.push(action('Enable recommended defaults', 'Turns on the default rules below.  Your own lists are kept.', function () {
      var d = Names.defaults().rules; n.rules = d; changed(true); U.toast('Recommended defaults on');
    }));
    out.push(action('Turn all default rules off', 'Only your own lists will apply.', function () {
      Names.RULES.forEach(function (r) { n.rules[r.id] = false; }); changed(true);
    }));
    Names.RULES.forEach(function (r) {
      var ex = r.ex.map(function (e) { return '"' + e[0] + '" → "' + e[1] + '"'; }).join(',  ');
      out.push(toggle(r.label, ex + (r.note ? '.  ' + r.note : ''), function () { return n.rules[r.id] != null ? !!n.rules[r.id] : r.on; }, function (v) { n.rules[r.id] = v; changed(); }));
    });
    listSection(out, 'Your prefixes', 'prefix', n.prefixes, changed, 'Removed from the start of a name, any capitalisation.  Example: NOW: ');
    listSection(out, 'Your suffixes', 'suffix', n.suffixes, changed, 'Removed from the end.  A leading space counts, so " HD" will not touch "WHD".');
    out.push(preview(n, active));
    return out;
  }
  /* ---------- event channels ---------- */
  function eventsPage(p) {
    var ev = p.events || (p.events = {}), out = [], active = p.id === S().active;
    function changed(rebuild) { persist(p); Events.reset(); if (active) relist(); if (rebuild) build(); else paint(); }
    out.push(toggle('Read events from channel names', 'For pay-per-view, league passes and one-off games whose name carries the matchup, date and time.  The guide shows the event at its time, with "Starts 7:30 PM" before it.  A real guide for the channel always wins.',
      function () { return ev.on !== false; }, function (v) { ev.on = v; changed(true); }));
    if (ev.on === false) return out;
    out.push(toggle('Short channel names', '"NCAAB 001 | NORTH FLORIDA @ CHARLESTON SOUTHERN (M) | 12.18 11:00 AM" shows as "NCAAB 001"; the game is in the guide line under it.',
      function () { return ev.short !== false; }, function (v) { ev.short = v; changed(); }));
    out.push(toggle('Events by time', 'A group with every event channel that is on now or starts in the next two weeks, soonest first.',
      function () { return ev.group !== false; }, function (v) { ev.group = v; changed(); }));
    var labels = Events.ZONE_LABELS.slice();
    if (active) labels[0] += ' (' + ({ ET: 'US Eastern', CT: 'US Central', MT: 'US Mountain', PT: 'US Pacific', UK: 'UK', CET: 'Central Europe', UTC: 'UTC', local: 'this TV' })[Events.zone()] + ')';
    out.push(choice('Times with no time zone are in', 'Names that say ET, PT or UK are read that way.  This is for the rest.  Shown in this TV\'s own time.',
      Events.ZONE_CHOICES, labels, function () { return ev.tz || 'auto'; }, function (v) { ev.tz = v; changed(true); }));
    if (active) {
      var now = Date.now(), list = L.data.channels.map(function (c) { return { c: c, e: Events.parse(c.n, now) }; }).filter(function (x) { return x.e; });
      out.push(head(list.length ? list.length + ' event channels in this playlist' : 'No event channels found in this playlist'));
      list.filter(function (x) { return x.e.end > now; }).sort(function (a, b) { return a.e.start - b.e.start; }).slice(0, 8).forEach(function (x) {
        out.push(info(Events.when(x.e.start) + '   ' + x.e.title, x.e.short || ''));
      });
    }
    return out;
  }
  function show(e) { return '"' + e.replace(/ /g, '·') + '"'; }    // make meaningful spaces visible
  function listSection(out, title, kind, arr, changed, hint) {
    out.push(head(title + ' (' + arr.length + ')'));
    out.push(action('Add a ' + kind + '…', hint, function () {
      UI.prompt('Add a ' + kind, '', function (v) { if (v.trim()) { arr.push(kind === 'prefix' ? v.replace(/^\s+/, '') : v.replace(/\s+$/, '')); changed(true); } }, 'Spaces count.  Shown with · in the list.');
    }));
    arr.forEach(function (e, i) {
      out.push(action(show(e), '', function () {
        UI.menu(show(e), [
          { label: 'Edit…', action: function () { UI.prompt('Edit ' + kind, e, function (v) { if (v.trim()) arr[i] = v; else arr.splice(i, 1); changed(true); }); } },
          { label: 'Delete', action: function () { arr.splice(i, 1); changed(true); } }
        ]);
      }, function () { return 'Edit'; }));
    });
    out.push(action('Paste a comma separated list…', 'TiviMate format, for example: US: , UK: , NOW | ', function () {
      UI.prompt(title + ', comma separated', Names.joinList(arr), function (v) { arr.length = 0; Names.parseList(v).forEach(function (x) { arr.push(x); }); changed(true); });
    }));
    if (arr.length) out.push(action('Clear ' + title.toLowerCase(), '', function () { UI.confirm('Clear all ' + title.toLowerCase() + '?', 'Clear', function () { arr.length = 0; changed(true); }); }));
  }
  function preview(cfg, active) {
    var box = U.el('div', 'prev-table');
    box.appendChild(U.el('div', 'opt head', active ? 'Preview with your channels' : 'Preview (switch to this playlist to see its channels)'));
    var sample = active ? L.sample(14) : [];
    // Prefer names that actually change, so the preview shows the rules working.
    var changed = sample.filter(function (c) { return Names.cleanWith(cfg, c.n) !== c.n; });
    var rest = sample.filter(function (c) { return changed.indexOf(c) < 0; });
    changed.concat(rest).slice(0, 12).forEach(function (c) {
      var r = U.el('div');
      r.appendChild(U.el('span', 'a', c.n));
      r.appendChild(U.el('span', 'b', Names.cleanWith(cfg, c.n)));
      box.appendChild(r);
    });
    return { preview: true, el: box };
  }

  /* ---------- manage groups: one switch per group ---------- */
  function manageGroups() {
    var out = [], all = L.allGroups();
    function set(g, show) { L.hideGroup(g.id, !show); }
    var shown = all.filter(function (g) { return !Store.edits.hiddenGroups[g.id]; }).length;
    out.push(info('Groups shown', shown + ' of ' + all.length));
    out.push(action('Show all groups', '', function () { L.hideGroups(all.map(function (g) { return g.id; }), false); relist(); build(); U.toast('All groups shown'); }));
    out.push(action('Hide all groups', 'Then switch on just the ones you watch.', function () {
      UI.confirm('Hide all ' + all.length + ' groups?  You can switch them back on here.', 'Hide all', function () { L.hideGroups(all.map(function (g) { return g.id; }), true); relist(); build(); });
    }));
    out.push(head('OK, ◀ or ▶ switches a group on or off'));
    all.forEach(function (g) {
      out.push({ label: g.name, sub: g.custom ? 'your group' : '',
        value: function () { return Store.edits.hiddenGroups[g.id] ? 'Hidden' : 'Shown'; },
        cycle: function () { set(g, !!Store.edits.hiddenGroups[g.id]); relist(); paint(); } });
    });
    return out;
  }

  /* ---------- groups ---------- */
  function groups() {
    var s = S(), out = [], hid = L.hiddenItems();
    function apply() { Store.saveSettings(); relist(); build(); }
    out.push(page('Manage groups', 'Show or hide each group in one list, like TiviMate.  ' + hid.groups.length + ' hidden now.', 'Manage groups', manageGroups));
    out.push(toggle('Show hidden items in lists', 'Hidden groups and channels appear dimmed so you can unhide them from their menu.', function () { return s.showHidden; }, function (v) { s.showHidden = v; apply(); }));
    out.push(head('Sorting'));
    out.push(choice('Channel order', 'For provider groups and All channels.  Your own groups keep the order you set.', ['playlist', 'number', 'name', 'watch'], ['Playlist order', 'Channel number', 'Name', 'Most watched'], function () { return s.sortChannels; }, function (v) { s.sortChannels = v; apply(); }));
    out.push(choice('Group order', 'Groups you moved by hand stay where you put them.', ['playlist', 'name'], ['Playlist order', 'Name'], function () { return s.sortGroups; }, function (v) { s.sortGroups = v; apply(); }));
    out.push(toggle('Your groups first', 'Favorites and your groups above the provider groups.', function () { return s.favFirst; }, function (v) { s.favFirst = v; apply(); }));
    out.push(toggle('Show All channels', '', function () { return s.showAll; }, function (v) { s.showAll = v; apply(); }));
    out.push(toggle('Show Recent channels', '', function () { return s.showRecent; }, function (v) { s.showRecent = v; apply(); }));
    out.push(choice('Recent channels kept', '', [10, 20, 30, 50], ['10', '20', '30', '50'], function () { return +s.recentCount; }, function (v) { s.recentCount = v; save(); }));
    out.push(toggle('Show Favorites group', '', function () { return s.showFav !== false; }, function (v) { s.showFav = v; apply(); }));
    out.push(choice('Recently added channels', 'A group of channels that are new in your playlist since it last loaded, newest first, with a NEW tag in the lists.', [0, 3, 7, 14], ['Off', '3 days', '7 days', '14 days'], function () { return s.newDays == null ? 7 : +s.newDays; }, function (v) { s.newDays = v; L.dirty(); apply(); }));
    out.push(choice('Groups your provider adds later', 'Hide keeps a tidy list tidy after "Hide all groups".', ['show', 'hide'], ['Show them', 'Hide them'], function () { return s.newGroups === 'hide' ? 'hide' : 'show'; }, function (v) { s.newGroups = v; save(); }));
    out.push(toggle('All channels includes hidden groups', 'Channels from groups you hid still appear in All channels.', function () { return !!s.allHidden; }, function (v) { s.allHidden = v; apply(); }));
    out.push(action('Reset watch time', 'Clears the "Most watched" statistics.', function () { UI.confirm('Reset watch time for every channel?', 'Reset', function () { Store.edits.watch = {}; Store.saveEdits(); relist(); U.toast('Watch time reset'); }); }));
    out.push(head('Your groups'));
    out.push(action('New group…', 'Then hold OK on any channel and choose Copy to group.', function () {
      UI.prompt('Name the new group', '', function (n) { if (n.trim()) { L.createGroup(n); relist(); build(); } });
    }));
    L.customGroups().forEach(function (g) {
      out.push(action(g.name, g.items.length + ' channels', function () {
        UI.menu(g.name, [
          g.id !== L.FAV && { label: 'Rename…', action: function () { UI.prompt('Rename group', g.name, function (n) { L.renameGroup(g.id, n); relist(); build(); }); } },
          { label: 'Move up', action: function () { L.moveGroup(g.id, -1); relist(); build(); } },
          { label: 'Move down', action: function () { L.moveGroup(g.id, 1); relist(); build(); } },
          { label: 'Empty this group', action: function () { g.items = []; Store.saveEdits(); relist(); build(); } },
          g.id !== L.FAV && { label: 'Delete group', action: function () { UI.confirm('Delete ' + g.name + '?', 'Delete', function () { L.deleteGroup(g.id); relist(); build(); }); } }
        ]);
      }, function () { return Store.edits.hiddenGroups[g.id] ? 'hidden' : ''; }));
    });
    out.push(head('Hidden groups'));
    if (!hid.groups.length) out.push(info('No hidden groups', ''));
    else {
      out.push(action('Restore all groups', hid.groups.length + ' hidden', function () { hid.groups.forEach(function (g) { L.hideGroup(g.id, false); }); relist(); build(); }));
      hid.groups.forEach(function (g) { out.push(action(g.name, '', function () { L.hideGroup(g.id, false); U.toast(g.name + ' restored'); relist(); build(); }, function () { return 'Restore'; })); });
    }
    out.push(head('Hidden channels'));
    if (!hid.channels.length) out.push(info('No hidden channels', ''));
    else {
      out.push(action('Restore all channels', hid.channels.length + ' hidden', function () { hid.channels.forEach(function (c) { L.hideChannel(c.k, false); }); relist(); build(); }));
      hid.channels.forEach(function (c) { out.push(action(L.name(c), L.groupName(c.g), function () { L.hideChannel(c.k, false); U.toast(L.name(c) + ' restored'); relist(); build(); }, function () { return 'Restore'; })); });
    }
    out.push(head('Reset'));
    out.push(action('Clear all edits for this playlist', 'Removes your groups, renames, guide assignments and hidden items.', function () {
      UI.confirm('Clear every group, rename and hidden item for this playlist?', 'Clear all edits', function () { Store.resetEdits(); relist(); build(); });
    }));
    return out;
  }

  /* ---------- guide display and reminders ---------- */
  function reminders() {
    var s = S(), out = [];
    out.push(choice('Start screen', 'What TiviBro opens on, and where Back from other screens leads.', ['guide', 'live'], ['Guide', 'Channels list'],
      function () { return s.startTab === 'live' ? 'live' : 'guide'; }, function (v) { s.startTab = v; save(); Views.buildTabs(); }));
    out.push(choice('OK on a channel in the Guide', 'Preview first works like TiviMate: the first OK plays it in the corner window, the second goes fullscreen.',
      ['preview', 'full'], ['Preview first, then fullscreen', 'Fullscreen right away'], function () { return s.guideOk === 'full' ? 'full' : 'preview'; }, function (v) { s.guideOk = v; save(); }));
    out.push(toggle('Two-line programmes', 'Shows each programme\'s time under its title in the grid.', function () { return s.guideLines !== 1; }, function (v) { s.guideLines = v ? 2 : 1; Views.applyLook(); save(); }));
    out.push(toggle('Dim past programmes', '', function () { return s.dimPast; }, function (v) { s.dimPast = v; Views.applyLook(); save(); }));
    out.push(choice('Mark what\'s on now', 'How the guide shows programmes airing right now.', ['fill', 'color', 'off'], ['Tint what has aired', 'Colour and tint', 'Off'], function () { return s.nowStyle || 'fill'; }, function (v) { s.nowStyle = v; Views.applyLook(); save(); }));
    out.push(toggle('Channel names in the guide', 'Off shows logos only, leaving more room.', function () { return s.guideNames !== false; }, function (v) { s.guideNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Two-line channel names', 'Long names wrap instead of being cut off.', function () { return !!s.twoLineNames; }, function (v) { s.twoLineNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Mark catch-up channels', 'Shows ↺ on channels and programmes you can replay.', function () { return s.showCatchupMark !== false; }, function (v) { s.showCatchupMark = v; save(); relist(); }));
    out.push(head('Watchlist'));
    out.push(page('Watchlist', 'Shows, teams and names to look for in the guide.  TiviBro sets a reminder when one is coming up.', 'Watchlist', watchlist, function () { var n = Watch.list().length; return n ? n + ' ›' : '›'; }));
    out.push(head('Reminders'));
    out.push(choice('Remind me before start', '', [0, 1, 2, 5, 10], ['At start', '1 min', '2 min', '5 min', '10 min'], function () { return +s.remindBefore; }, function (v) { s.remindBefore = v; save(); }));
    out.push(choice('When a reminder starts', '', ['ask', 'switch'], ['Ask me', 'Switch to the channel'], function () { return s.remindAction === 'switch' ? 'switch' : 'ask'; }, function (v) { s.remindAction = v; save(); }));
    out.push(choice('Reminder question stays for', '', [10, 20, 30, 60], ['10s', '20s', '30s', '1 min'], function () { return +s.remindTimeout || 20; }, function (v) { s.remindTimeout = v; save(); }));
    var rem = Store.edits.reminders.slice().sort(function (a, b) { return a.s - b.s; });
    if (!rem.length) out.push(info('No reminders.  Pick a future programme in the Guide and press OK.', ''));
    rem.forEach(function (r) {
      var c = L.find(r.k);
      out.push(action(r.t, new Date(r.s).toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + U.hhmm(r.s) + (c ? '   ' + L.name(c) : ''), function () {
        Store.edits.reminders = Store.edits.reminders.filter(function (x) { return x !== r; }); Store.saveEdits(); U.toast('Reminder removed'); build();
      }, function () { return 'Remove'; }));
    });
    return out;
  }

  function langName(code, none) { for (var i = 0; i < U.LANGS.length; i++) if (U.LANGS[i][0] === code) return U.LANGS[i][1]; return none || code || ''; }
  function langMenu(title, noneLabel, cur, set) {
    UI.menu(title, [{ label: noneLabel, sub: !cur ? 'on' : '', action: function () { set(''); } }]
      .concat(U.LANGS.map(function (l) { return { label: l[1], sub: cur === l[0] ? 'on' : '', action: function () { set(l[0]); } }; })));
  }
  function watchlist() {
    var s = S(), out = [], words = Watch.list();
    out.push(action('Add a show, team or name…', 'Matched as whole words in programme titles: "Cars" does not find "Oscars".  Yellow in Search adds what you typed.', function () {
      UI.prompt('Look for', '', function (v) { if (Watch.add(v)) build(); }, 'For example Yankees, Bluey, Premier League or Gordon Ramsay');
    }));
    out.push(choice('Look ahead', 'How far into the guide to look.', [6, 12, 24, 48], ['6 hours', '12 hours', '24 hours', '2 days'], function () { return +s.watchAhead || 24; }, function (v) { s.watchAhead = v; save(); Watch.scan(true); build(); }));
    out.push(choice('When something is found', '', ['remind', 'tell'], ['Set a reminder', 'Just tell me'], function () { return s.watchAction === 'tell' ? 'tell' : 'remind'; }, function (v) { s.watchAction = v; save(); }));
    if (!Epg.xml) out.push(info('Tip: with only the provider\'s per-channel guide, TiviBro only knows programmes on channels you have looked at.  An XMLTV guide (Settings > Playlists) lets the watchlist see every channel.', ''));
    if (!words.length) { out.push(info('Nothing on your watchlist yet.', '')); return out; }
    out.push(head('Your watchlist'));
    words.forEach(function (w) {
      var n = Watch.upcoming(w.q).length;
      out.push(action(w.q, n ? n + ' coming up' : 'nothing coming up yet', function () {
        UI.menu(w.q, [
          { label: 'Show in Search', action: function () { Views.switchTab('search'); Search.open(w.q); } },
          { label: 'Remove from watchlist', sub: 'and the reminders it set', action: function () { Watch.remove(w.q); U.toast('Removed "' + w.q + '"'); build(); } }
        ]);
      }, function () { return '›'; }));
    });
    var up = Watch.upcoming().slice(0, 30);
    if (up.length) {
      out.push(head('Coming up'));
      up.forEach(function (r) {
        var set = Store.edits.reminders.some(function (x) { return x.k === r.c.k && x.s === r.p.s; });
        out.push(action(r.p.t, U.day(r.p.s) + ' ' + U.hhmm(r.p.s) + '   ' + L.name(r.c), function () {
          var rem = Store.edits.reminders, i = rem.findIndex(function (x) { return x.k === r.c.k && x.s === r.p.s; });
          if (i >= 0) { rem.splice(i, 1); Store.edits.watchSeen = Store.edits.watchSeen || {}; Store.edits.watchSeen[r.p.t.toLowerCase() + '|' + r.p.s] = r.p.e; U.toast('Reminder cancelled'); } else { rem.push({ k: r.c.k, s: r.p.s, e: r.p.e, t: r.p.t, w: r.w }); U.toast('Reminder set'); }
          Store.saveEdits(); build();
        }, function () { return set ? 'Reminder set' : 'Remind me'; }));
      });
    }
    return out;
  }

  /* Colours.  Backgrounds are whole palettes in app.css (body.theme-*); the accent is one colour
     that focus, progress and highlights share.  "Custom" builds an accent from a hue and a
     brightness, both changed with ◀ ▶, so any colour is reachable from the remote. */
  var ACCENTS = ['#5b8cff', '#33e1ff', '#8b5cf6', '#c084fc', '#ff5ca8', '#3ddc97', '#14b8a6', '#a3e635', '#f2b33d', '#ff6a3d', '#e5484d', '#e8ecf8', 'custom'];
  var ACCENT_NAMES = ['Electric blue', 'Cyan', 'Violet', 'Lavender', 'Pink', 'Mint', 'Teal', 'Lime', 'Amber', 'Ember', 'Red', 'White', 'Custom'];
  var THEMES = ['dark', 'black', 'slate', 'ocean', 'forest', 'plum', 'mocha', 'contrast', 'classic'];
  var THEME_NAMES = ['Midnight', 'Black (OLED)', 'Slate', 'Ocean', 'Forest', 'Plum', 'Mocha', 'High contrast', 'Classic (1.0)'];
  var THEME_INK = { dark: '#141a2e', black: '#000', slate: '#263342', ocean: '#0f2a3a', forest: '#14271d', plum: '#2a1830', mocha: '#2b2019', contrast: '#000', classic: '#18222e' };
  function look() {
    var s = S(), out = [];
    var custom = s.accentMode === 'custom';
    var acc = choice('Accent color', 'The colour of whatever is focused, and of progress bars.', ACCENTS, ACCENT_NAMES,
      function () { return custom ? 'custom' : s.accent; },
      function (v) {
        if (v === 'custom') { s.accentMode = 'custom'; s.accent = U.hsl(s.accentHue == null ? 210 : s.accentHue, s.accentLight || 62); }
        else { s.accentMode = ''; s.accent = v; }
        Views.applyLook(); save(true);
      });
    acc.swatch = function () { return s.accent; };
    out.push(acc);
    if (custom) {
      var hues = [], hueNames = [];
      for (var h = 0; h < 360; h += 10) { hues.push(h); hueNames.push(h + '°'); }
      var hu = choice('Custom hue', 'Around the colour wheel: red, yellow, green, cyan, blue, magenta.', hues, hueNames, function () { return s.accentHue == null ? 210 : s.accentHue; },
        function (v) { s.accentHue = v; s.accent = U.hsl(v, s.accentLight || 62); Views.applyLook(); save(); });
      hu.swatch = function () { return s.accent; };
      out.push(hu);
      out.push(choice('Custom brightness', '', [45, 55, 62, 72, 82], ['Deep', 'Rich', 'Normal', 'Light', 'Pastel'], function () { return s.accentLight || 62; },
        function (v) { s.accentLight = v; s.accent = U.hsl(s.accentHue == null ? 210 : s.accentHue, v); Views.applyLook(); save(); }));
    }
    var bg = choice('Background', '', THEMES, THEME_NAMES, function () { return s.theme || 'dark'; }, function (v) { s.theme = v; Views.applyLook(); save(); });
    bg.swatch = function () { return THEME_INK[s.theme || 'dark'] || THEME_INK.dark; };
    out.push(bg);
    out.push(choice('Focus style', 'How the selected item stands out.  Outline adds a white ring, easier to spot from across the room.', ['fill', 'ring'], ['Filled', 'Filled with outline'], function () { return s.focusStyle || 'fill'; }, function (v) { s.focusStyle = v; Views.applyLook(); save(); }));
    out.push(choice('Text size', 'Guide and channel lists.', ['s', 'm', 'l'], ['Small', 'Medium', 'Large'], function () { return s.textSize || 'm'; }, function (v) { s.textSize = v; Views.applyLook(); save(); }));
    out.push(choice('Panels over video', 'How see-through the info panel, quick menu and channel list are in fullscreen.', ['l', 'm', 'h'], ['Solid', 'Normal', 'See-through'], function () { return s.overlay || 'm'; }, function (v) { s.overlay = v; Views.applyLook(); save(); }));
    out.push(choice('Channel logos', 'Which logo to use when both the playlist and the guide have one.', ['playlist', 'guide'], ['From the playlist', 'From the guide'], function () { return s.logoPref === 'guide' ? 'guide' : 'playlist'; }, function (v) { s.logoPref = v; save(); relist(); }));
    out.push(choice('Logo library', 'Logos from two open projects, iptv-org and tv-logos, matched to your channels by guide id, name and country.  TiviBro hosts no images: each logo loads from its project.',
      ['off', 'fill', 'all'], ['Off', 'Fill in missing logos', 'Use for every channel it knows'], function () { return s.logoLib || 'off'; },
      function (v) { s.logoLib = v; save(true); Logos.load(L.data).then(function () { build(); }); relist(); }));
    if (s.logoLib && s.logoLib !== 'off') {
      out.push(choice('Logo library style', 'Matching set: one clean style for dark screens (tv-logos).  Original: each channel\'s own logo (iptv-org).  Each falls back to the other.',
        ['set', 'original'], ['Matching set', 'Original logos'], function () { return s.logoStyle === 'original' ? 'original' : 'set'; }, function (v) { s.logoStyle = v; save(); relist(); }));
      var ls = Logos.status;
      out.push(info('Logo library status', ls.state === 'ready' ? ls.entries + ' names for ' + ls.countries.join(', ') : ls.state === 'loading' ? 'loading' : ls.state === 'error' ? 'not reachable: ' + ls.error : 'off'));
    }
    out.push(toggle('Show clock', '', function () { return s.showClock; }, function (v) { s.showClock = v; Views.applyLook(); save(); }));
    out.push(toggle('Show the date with the clock', '', function () { return !!s.clockDate; }, function (v) { s.clockDate = v; UI.clock(); save(); }));
    out.push(toggle('Show channel numbers', '', function () { return s.showNumbers; }, function (v) { s.showNumbers = v; Store.saveSettings(); relist(); build(); }));
    out.push(choice('Info panel stays for', '', [3, 5, 8, 12], ['3s', '5s', '8s', '12s'], function () { return +s.osdTimeout; }, function (v) { s.osdTimeout = v; save(); }));
    out.push(toggle('Press Back twice to exit', '', function () { return s.exitTwice; }, function (v) { s.exitTwice = v; save(); }));
    return out;
  }

  function parental() {
    var s = S(), out = [], on = Parental.enabled();
    out.push(action(on ? 'Change PIN' : 'Set a PIN', 'Then hold OK on a channel or group and choose Block.', function () { Parental.change(build); }));
    if (!on) return out;
    out.push(choice('PIN required for', '', ['channels', 'settings', 'both'], ['Blocked channels', 'Settings', 'Both'], function () { return s.pinScope; }, function (v) { s.pinScope = v; save(); }));
    out.push(toggle('Stay unlocked until the app restarts', 'Off asks for the PIN every time.', function () { return s.pinStay; }, function (v) { s.pinStay = v; Parental.lock(); save(); }));
    out.push(action('Lock now', '', function () { Parental.lock(); relist(); U.toast('Locked'); }));
    var e = Store.edits;
    out.push(head('Blocked in this playlist'));
    var any = false;
    Object.keys(e.blockedGroups).forEach(function (id) { any = true; out.push(action(L.groupName(id) || id, 'group', function () { L.block('group', id, false); relist(); build(); }, function () { return 'Unblock'; })); });
    Object.keys(e.blockedChannels).forEach(function (k) { var c = L.find(k); if (!c) return; any = true; out.push(action(L.name(c), 'channel', function () { L.block('channel', k, false); relist(); build(); }, function () { return 'Unblock'; })); });
    if (!any) out.push(info('Nothing blocked yet', ''));
    out.push(head(''));
    out.push(action('Remove PIN', 'Turns parental controls off.', function () { Parental.remove(build); }));
    return out;
  }

  function diag() {
    var out = [];
    out.push(action('Report a problem', 'Scan a QR code: your phone fills in a GitHub issue with this TV\'s details and log, logins and server names taken out.', function () {
      Diag.openReport();
    }, function () { return '›'; }));
    out.push(action('Run connection test', 'Checks the helper, login, channel list, a stream and the guide, step by step.', function () { Diag.run(); }));
    out.push(action('Speed test', 'Your internet speed and your provider\'s, and what that is enough for.  Stops playback while it runs.', function () { Diag.speedTest(); }));
    out.push(action('View app log', 'This session.', function () { Diag.showLog(false); }));
    out.push(action('View app log with earlier sessions', 'Useful after a crash or restart.', function () { Diag.showLog(true); }));
    out.push(action('View network helper log', 'Every request the helper made: status, time, size, and the network error if any.', function () { Diag.showHelperLog(); }));
    out.push(toggle('Detailed logging', 'Also logs every request and buffer event.  Turn on while chasing a problem.', function () { return Log.verbose; }, function (v) { Log.verbose = v; paint(); }));
    out.push(action('Clear log', '', function () { Log.clear(); U.toast('Log cleared'); }));
    out.push(page('What this TV can play', 'Video, HDR and sound formats, for the built-in player and the TV player.', 'What this TV can play', function () {
      var o = [info('From the TV\'s own answers plus what LG TVs are known to do.  Dolby Vision and DTS are not always reported correctly, so the known rules win.', '')];
      Caps.report().forEach(function (r) { o.push(info(r[0], r[1])); });
      return o;
    }));
    if (Player.current) out.push(info('Playing now', [Player.media, Player.engine].filter(Boolean).join('   ') || 'details not known yet'));
    out.push(head('Status'));
    out.push(info('Network helper', Net.status()));
    out.push(info('Network setting', (S().network || 'auto') === 'direct' ? 'Direct' : 'Automatic'));
    out.push(info('TiviBro', TIVIBRO_VERSION));
    out.push(info('Browser engine', (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || navigator.userAgent.slice(0, 60)));
    out.push(info('Channels loaded', String(L.count())));
    out.push(info('Debug from a computer', 'ares-inspect --device <tv> --app app.tivibro.tv --open'));
    return out;
  }

  /* ---------- render ---------- */
  /* ---------- edit on a computer ---------- */
  function editor() {
    var s = S(), out = [], on = WebEdit.on, st = WebEdit.status;
    WebEdit.onStatus = function () { if (Views.tab === 'settings' && SECTIONS[sec][0] === 'editor' && !stack.length) build(); };
    out.push(info('Organise groups and channels from a browser on your computer, phone or tablet: show and hide, reorder, rename, favorites, your own groups and name clean-up.', ''));
    out.push(action('Scan a QR code with your phone', 'Turns the editor on and opens it on your phone, signed in.  Also in the side menu: Edit on phone.', function () { WebEdit.showJoin('', build); }, function () { return '›'; }));
    out.push(toggle('Web editor', on ? 'Running.  Changes appear on the TV within a few seconds.' : 'Off.  It also switches off whenever TiviBro closes.', function () { return WebEdit.on; }, function (v) {
      (v ? WebEdit.start() : WebEdit.stop()).then(function () { build(); if (v) U.toast('Web editor is on'); }, function (e) { U.toast(e.message, 5000); build(); });
    }));
    if (on && st) {
      out.push(head('On your computer'));
      var addrs = WebEdit.addresses();
      if (!addrs.length) out.push(info('Open', 'http://<this TV\'s address>:' + st.port + '   (the TV reported no network address)'));
      addrs.forEach(function (a, i) { var x = info(i ? 'or' : 'Open this address', a); x.big = true; out.push(x); });
      var pw = info('Password', WebEdit.password()); pw.big = true; out.push(pw);
      out.push(info('Browsers connected', String(st.clients || 0)));
      out.push(info('The computer must be on the same network as the TV.', ''));
    }
    out.push(head('Options'));
    out.push(action('New password', 'Logs out every browser.', function () { WebEdit.newPassword().then(function () { build(); U.toast('New password: ' + WebEdit.password(), 5000); }); }, function () { return on ? '' : WebEdit.password(); }));
    // The high ports and the random one are for networks that block the common ports.
    var restartEd = function () { WebEdit.restart().then(build, function (e) { U.toast(e.message, 5000); build(); }); };
    var rnd = s.editorPort === 'random';
    out.push(choice('Port', 'Change it if another device on your network already uses this one, or if your network blocks it: the high ones (18787 and up) or a random high port often get through.',
      WebEdit.PORTS.concat(['random']), WebEdit.PORTS.map(String).concat([rnd ? 'Random: ' + WebEdit.port() : 'Random high port']),
      function () { return rnd ? 'random' : WebEdit.port(); },
      function (v) { s.editorPort = v; Store.saveSettings(); if (v === 'random') WebEdit.port(); restartEd(); }));
    if (rnd) out.push(action('New random port', 'This TV keeps ' + WebEdit.port() + ' until you choose this.  Saved addresses and bookmarks stop working.', function () { WebEdit.newRandomPort(); restartEd(); }, function () { return String(WebEdit.port()); }));
    return out;
  }

  /* Pages show what is true now.  When the guide or the channel list finishes loading (or starts),
     the page on screen is drawn again, so Guide last loaded, Last reloaded, each guide source's
     result, Channels with guide data and the public guide's status never show an old value. */
  var liveT = null, lastProg = '';
  function live() {
    if (Views.tab !== 'settings' || UI.modalOpen) return;
    clearTimeout(liveT);
    liveT = setTimeout(function () { if (Views.tab === 'settings' && !UI.modalOpen) build(); }, 250);
  }
  Epg.onUpdate(function (k) { if (!k) live(); });
  Epg.onProgress(function (p) { var k = (p.active ? 1 : 0) + '|' + p.phase; if (k !== lastProg) { lastProg = k; live(); } });

  /* ---------- the TiviBro phone app ---------- */
  function phone() {
    var out = [], ps = Phone.status, on = !!(ps && ps.on);
    Phone.onChange = function () { if (Views.tab === 'settings' && SECTIONS[sec][0] === 'phone' && !stack.length) build(); };
    if (!ps) { Phone.refresh().catch(function (e) { U.toast(e.message, 5000); }); out.push(info('Checking…', '')); return out; }
    out.push(info('The TiviBro app for Android finds this TV, opens TiviBro and the web editor full screen, and wakes the TV.  Pair a phone once; it stays paired.', ''));
    out.push(toggle('Phone app connection', on ? 'On.  Paired phones can reach this TV on your network, even when TiviBro is closed.' : 'Off.  Phones can\'t find or reach this TV.', function () { return !!(Phone.status && Phone.status.on); }, function (v) {
      var go = function () { Phone.turn(v).then(function () { build(); U.toast(v ? 'Phone app connection is on' : 'Phone app connection is off'); }, function (e) { U.toast(e.message, 5000); build(); }); };
      if (v || !ps.phones.length) return go();
      UI.confirm('Turn off the phone app connection?  Paired phones stay paired, but can\'t reach this TV until you turn it back on.', 'Turn off', go);
    }));
    if (on) {
      out.push(action('Pair a phone…', 'Shows a QR code and a code for the TiviBro app.', function () { Phone.showPair(build); }, function () { return '›'; }));
      out.push(head('Paired phones'));
      if (!ps.phones.length) out.push(info('None yet', ''));
      ps.phones.forEach(function (p) {
        out.push(action(p.name, (p.model ? p.model + '  ·  ' : '') + 'Added ' + when(p.added) + '  ·  Last seen ' + Phone.ago(p.seen), function () {
          UI.menu(p.name, [
            { label: 'Remove this phone', sub: 'it can no longer reach this TV, until you pair it again', action: function () {
              Phone.forget(p.id).then(function () { build(); U.toast(p.name + ' removed'); }, function (e) { U.toast(e.message, 5000); });
            } },
            { label: 'Cancel', current: true }
          ]);
        }, function () { return '›'; }));
      });
      out.push(head('This TV'));
      out.push(action('Name', 'How phones show this TV.', function () {
        UI.prompt('Name this TV', ps.ownName || ps.name, function (n) { Phone.rename(n).then(build, function (e) { U.toast(e.message, 5000); }); });
      }, function () { return Phone.status ? Phone.status.name : ''; }));
      out.push(info('Address', (ps.ips && ps.ips.length ? ps.ips.join(', ') : 'no network address') + ', port ' + ps.port));
      out.push(info('To turn this TV on from the phone, switch on Turn on via Wi-Fi in the TV\'s settings (General, Devices, External devices, or Connection, depending on the model).', ''));
      out.push(info('Only phones you pair here can connect.  The pairing code never crosses the network, and everything a phone sends is signed with a key only that phone and this TV have.', ''));
    }
    return out;
  }

  /* ---------- updates and about ---------- */
  var lastUpd = '';
  Update.onChange(function (st) {
    if (Views.tab !== 'settings' || SECTIONS[sec][0] !== 'updates' || stack.length) return;
    var k = st.state + '|' + st.installer;
    if (k !== lastUpd) { lastUpd = k; build(); } else paint();
  });
  function updates() {
    var s = S(), out = [], st = Update.state, r = st.latest, cur = Update.current;
    Update.installer();          // finds out once whether this TV can install by itself
    out.push(info('TiviBro', cur + (Update.isPre(cur) ? '   (test version)' : '')));
    var stat = info('Status', ''); stat.value = function () { return Update.describe(); }; out.push(stat);
    if (st.state !== 'installing' && st.state !== 'installed') out.push(action('Check for updates', 'Looks for a newer release on GitHub.', function () { Update.check(false); }));
    if ((st.state === 'available' || st.state === 'installing') && r) {
      out.push(head('TiviBro ' + r.version + (r.pre ? '  (test version)' : '')));
      out.push(info('Released', (r.published ? when(Date.parse(r.published)) : '') + (r.size ? '   ' + (r.size / 1048576).toFixed(1) + ' MB' : '')));
      if (st.state === 'available') {
        if (st.installer === 'hbchannel') out.push(action('Install ' + r.version + ' now', 'Downloads it, checks its fingerprint and installs it through the Homebrew Channel.  TiviBro then restarts by itself, with all your settings.', function () {
          UI.confirm('Install TiviBro ' + r.version + '?', 'Install and restart', function () { Update.install().catch(function (e) { U.toast(e.message, 6000); }); });
        }));
        else if (st.installer === '') out.push(info('Install it from a computer or the Homebrew Channel', 'This TV can\'t install updates by itself (that needs a rooted TV with the Homebrew Channel).  The release page has the IPK and instructions: github.com/' + Update.REPO + '/releases'));
      }
      out.push(page('What\'s new', '', 'What\'s new in ' + r.version, function () {
        return (r.notes && r.notes.length ? r.notes : ['No notes for this release.']).map(function (n) { return info(n, ''); });
      }));
    }
    out.push(head('Options'));
    out.push(toggle('Check automatically', 'Once a day when TiviBro starts.  Nothing is installed without asking you.', function () { return s.updateAuto !== false; }, function (v) { s.updateAuto = v; save(); }));
    out.push(toggle('Count this TV in the install numbers', 'Once a day TiviBro says which version it is and which webOS this TV has.  Nothing else: no address is kept, no ID, nothing about your channels or playlists.', function () { return s.countMe !== false; }, function (v) { s.countMe = v; save(); }));
    out.push(toggle('Include test versions', 'Alpha and beta builds: new features first, and some rough edges.', function () { return Update.wantPre; }, function (v) { s.updatePre = v; save(); }));
    var how = info('Installing on this TV', ''); how.value = function () { var i = Update.state.installer; return i === 'hbchannel' ? 'Yes, through the Homebrew Channel' : i === '' ? 'From a computer only (not rooted)' : 'Checking…'; }; out.push(how);
    out.push(head('About'));
    out.push(info('Made by OhMyBahGosh', 'github.com/' + Update.REPO));
    out.push(info('Playback libraries', 'hls.js ' + (window.Hls ? Hls.version : '') + '   mpegts.js'));
    return out;
  }

  // Each section's page, by id, so reordering SECTIONS can never show one section under another's name.
  var BY_ID = { playback: playback, remote: remote, playlists: playlists, editor: editor, phone: phone, groups: groups, reminders: reminders, look: look, parental: parental, updates: updates, diag: diag };
  var FNS = SECTIONS.map(function (x) { return BY_ID[x[0]]; });
  function build() {
    var top = stack[stack.length - 1];
    items = top ? [head(stack.map(function (x) { return x.title; }).join('  ›  '))].concat(top.fn()) : FNS[sec]();
    items = items.filter(Boolean);
    sel = U.clamp(sel, 0, Math.max(0, items.length - 1));
    if (!focusable(sel)) { var i = sel; while (i < items.length && !focusable(i)) i++; if (i >= items.length) { i = sel; while (i > 0 && !focusable(i)) i--; } sel = i; }
    body.innerHTML = '';
    scrollEl = U.el('div', 'set-scroll');
    scrollEl._y = 0;
    rowEls = items.map(function (it, i) {
      if (it.preview) return it.el;
      var d = U.el('div', 'opt' + (it.head ? ' head' : '') + (it.big ? ' big' : it.info ? ' dim' : ''));
      var l = U.el('div', 'ol', it.label);
      if (it.sub) l.appendChild(U.el('small', '', it.sub));
      d.appendChild(l);
      if (!it.head) {
        d._v = U.el('div', 'ov'); d.appendChild(d._v);
        // A value you change with ◀ ▶ shows the arrows on the focused row, and with the Magic
        // Remote each arrow can be clicked.
        if (it.cycle) {
          d.classList.add('cyc');
          var al = U.el('span', 'ar', '‹'), ar = U.el('span', 'ar', '›');
          d._sw = U.el('i', 'sw hidden'); d._t = U.el('span', '');
          [al, d._sw, d._t, ar].forEach(function (x) { d._v.appendChild(x); });
          al.addEventListener('click', function (e) { e.stopPropagation(); zone = 'body'; sel = i; it.cycle(-1); });
          ar.addEventListener('click', function (e) { e.stopPropagation(); zone = 'body'; sel = i; it.cycle(1); });
        }
      }
      // Magic Remote: hover focuses a row, click is OK (or changes the value).
      if (focusable(i)) {
        d.addEventListener('mousemove', function () { if (UI.pointer && (zone !== 'body' || sel !== i)) { zone = 'body'; sel = i; paint(); } });
        d.addEventListener('click', function () { zone = 'body'; sel = i; paint(); keys('ok'); });
      }
      return d;
    });
    rowEls.forEach(function (e) { scrollEl.appendChild(e); });
    body.appendChild(scrollEl);
    paint();
  }
  function paint() {
    nav.innerHTML = '';
    SECTIONS.forEach(function (s, i) {
      if (!shown(i)) return;
      var n = U.el('div', i === sec ? 'on' : '', s[1]);
      n.addEventListener('click', function () { stack = []; sec = i; sel = 0; zone = 'nav'; build(); });
      nav.appendChild(n);
    });
    nav.classList.toggle('active', zone === 'nav');
    rowEls.forEach(function (e, i) {
      var it = items[i];
      if (e._t) {
        e._t.textContent = it.value ? it.value() : '';
        var sw = it.swatch && it.swatch();
        e._sw.classList.toggle('hidden', !sw);
        if (sw) e._sw.style.background = sw;
      } else if (e._v) e._v.textContent = it.value ? it.value() : '';
      e.classList.toggle('focus', zone === 'body' && i === sel && focusable(i));
    });
    var f = rowEls[sel];
    if (f && scrollEl) {
      var y = f.offsetTop, h = body.clientHeight, cur = scrollEl._y || 0;
      if (y + cur < 40) cur = -y + 40;
      if (y + f.offsetHeight + cur > h - 40) cur = h - 40 - y - f.offsetHeight;
      if (zone === 'nav' || sel <= 1) cur = 0;
      // On the last row you can pick, show what comes after it too (notes, results): otherwise text
      // under the last choice could never be scrolled into view.
      if (zone === 'body' && lastFocusable() === sel) cur = Math.min(cur, scrollMin());
      setScroll(cur);
    }
  }
  function scrollMin() { return Math.min(0, body.clientHeight - 24 - scrollEl.scrollHeight); }
  function setScroll(y) { y = Math.max(scrollMin(), Math.min(0, y)); scrollEl._y = y; scrollEl.style.transform = 'translateY(' + y + 'px)'; }
  function lastFocusable() { for (var i = items.length - 1; i >= 0; i--) if (focusable(i)) return i; return -1; }
  function focusable(i) { var it = items[i]; return !!(it && !it.head && !it.info && !it.preview); }

  function keys(a) {
    if (zone === 'nav') {
      if (a === 'up') { if (nextSec(-1) !== sec) { sec = nextSec(-1); sel = 0; build(); } else Views.tabBar(function () { UI.setHandler(keys); paint(); }); }
      else if (a === 'down') { if (nextSec(1) !== sec) { sec = nextSec(1); sel = 0; build(); } }
      else if (a === 'right' || a === 'ok') { zone = 'body'; paint(); }      // pages of facts only scroll
      else if (a === 'left' || a === 'back') Views.tabBar(function () { UI.setHandler(keys); paint(); });
      else if (a === 'green') Views.switchTab('live');
      return true;
    }
    var it = items[sel];
    if (a === 'up' || a === 'down') {
      var d = a === 'up' ? -1 : 1, i = sel + d;
      while (i >= 0 && i < items.length && !focusable(i)) i += d;
      if (i >= 0 && i < items.length) { sel = i; paint(); }
      // Nothing more to pick that way (a page of facts, or notes under the last choice): scroll.
      else if (scrollEl) setScroll((scrollEl._y || 0) - d * Math.round(body.clientHeight * 0.6));
    }
    else if (a === 'chup') { for (var j = 0; j < 8; j++) keys('up'); }
    else if (a === 'chdown') { for (var k = 0; k < 8; k++) keys('down'); }
    else if (a === 'left') { if (it && it.cycle) it.cycle(-1); else if (stack.length) pop(); else { zone = 'nav'; paint(); } }
    else if (a === 'right') { if (it && it.cycle) it.cycle(1); }
    else if (a === 'ok') { if (it && it.action) it.action(); else if (it && it.cycle) it.cycle(1); }
    else if (a === 'back') { if (stack.length) pop(); else { zone = 'nav'; paint(); } }
    return true;
  }

  function open() {
    if (!stack.length) zone = 'nav';
    UI.setHandler(keys);
    UI.hints([['', '◀ ▶  change value'], ['', 'OK  select'], ['', 'Back  up one level, then menu bar']]);
    build();
  }

  // Straight to one section (the phone app's own shortcut, and tests).
  function section(id) { for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === id && shown(i)) { sec = i; stack = []; sel = 0; zone = 'body'; build(); return true; } return false; }

  return { open: open, assignGuide: assignGuide, section: section, live: live, reset: function () { stack = []; sel = 0; },
    LOOK: { ACCENTS: ACCENTS, ACCENT_NAMES: ACCENT_NAMES, THEMES: THEMES, THEME_NAMES: THEME_NAMES, THEME_INK: THEME_INK } };
})();
