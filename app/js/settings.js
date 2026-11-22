/* Settings.  Left/right changes a value in place, OK opens or cycles, Back goes up a page. */
var Settings = (function () {
  'use strict';
  var $ = U.$, S = function () { return Store.settings; }, L = Library;
  // Shown in the language chosen (app/js/i18n.js); the rows themselves are written in English.
  function T(x, v) { return x && typeof x === 'string' && typeof I18n !== 'undefined' ? I18n.t(x, v) : x; }
  var nav = $('setNav'), body = $('setBody');
  /* The sections (the second Settings overhaul: things were "2-3 nested clicks" away): every setting is in a
     section, at most one page down, and a page only holds a list (each playlist, Manage groups, hidden channels, Fix
     a problem).  What used to be a page inside another section (API keys, Audio and subtitles, Remote and buttons,
     Recording, Channel names, Backups) is a section of its own, and a page's advanced settings sit at its bottom
     under an Advanced heading instead of behind another row.  PAGES: old ids that are pages now (none left);
     ALIAS: old ids, so links, older phone apps and tests still land somewhere sensible. */
  var SECTIONS = [['language', 'Language'], ['playlists', 'Playlists and accounts'], ['connect', 'Phone app and web editor'], ['guide', 'Guide'], ['channels', 'Channels and groups'],
    ['sports', 'Sports'], ['names', 'Channel and group names'], ['playback', 'Playback'], ['audio', 'Audio and subtitles'], ['recording', 'Recording and live pause'], ['remote', 'Remote and buttons'],
    ['vod', 'Movies and shows'], ['media', 'My media'], ['reminders', 'Reminders and watchlist'], ['parental', 'Parental controls'], ['look', 'Appearance'], ['keys', 'API keys'],
    ['backups', 'Backups and restore points'], ['about', 'System']];
  var PAGES = {};
  var ALIAS = { lang: 'language', groups: 'channels', updates: 'about', diag: 'about', system: 'about', phone: 'connect', editor: 'connect', watchlist: 'reminders', apikeys: 'keys', tokens: 'keys', subtitles: 'audio',
    movies: 'vod', shows: 'vod', libraries: 'media', accounts: 'playlists', appearance: 'look', trakt: 'media', buttons: 'remote', livepause: 'recording', teams: 'sports', scores: 'sports' };
  var sec = 1, zone = 'nav', sel = 0, items = [], scrollEl = null, rowEls = [];
  // Phone app: test builds only while the Android app is in the works (release builds show the web editor alone).
  function phoneOK() { return /alpha|beta/i.test(TIVIBRO_VERSION); }
  function shown(i) { return !!SECTIONS[i]; }
  /* Advanced settings (was Appearance > Advanced view, and before that Settings shown): the ones people set once or
     only to troubleshoot sit at the bottom of their page under an Advanced heading, always there, never behind
     another row.  The phone and the web editor see the same rows (rowsOf). */
  var ADV = ['Profile details', 'Start learning again', 'Start-up buffer', 'Read-ahead', 'Keep behind playhead', 'Freeze detection', 'Reconnect attempts',
    'Player engine', 'Stream format', 'Channels with their own format', 'Connection', 'Network helper', 'Buffer meter', 'Buffer info on demand', 'When a channel stops working',
    'HDR and Dolby Vision', 'Keep the picture while reconnecting', 'Black screen while switching', 'Show stream details in the info panel', 'Memory-safe playback', 'Fallback audio language',
    'Keep downloaded subtitles', 'Audio converter', 'Learn a button', 'Button tester', 'Restore default buttons', 'Detailed logging', 'User-Agent', 'Provider guide time offset',
    'Reset watch time', 'View network helper log', 'Clear log', 'What this TV can play', 'Report a problem in the menu', 'Count this TV in the install numbers'];
  function advanced(it) { return !!(it && !it.head && !it.preview && !it.keep && ADV.indexOf(it.label) >= 0); }
  /* Headings added before a row, so no part of a page runs long on the TV (where each heading is a part of its
     own in the list on the left).  Only headings: every row stays where it was, and the phone and the web
     editor show the same headings. */
  var SPLIT = { 'Audio language': 'Sound', 'Subtitles automatically': 'Subtitles', 'Subtitle colour': 'How subtitles look',
    'Movies and Shows open on': 'Browsing', 'Order categories': 'Categories', 'Reload movies and shows now': 'Homes and lists', 'Play the next one automatically': 'While watching',
    'Text size': 'Text and panels', 'Channel logos': 'Logos and numbers', 'Show clock': 'Clock and info panel',
    'Library poster size': 'Posters', 'Arrange Home shelves': 'Shelves' };
  function split(list) {
    var out = [];
    list.forEach(function (it, i) {
      var h = it && !it.head && !it.raw && SPLIT[it.label], prev = out[out.length - 1];
      if (h && !(prev && prev.head)) out.push(head(h));
      out.push(it);
    });
    return out;
  }
  function shape(fn) {
    var list = split((fn() || []).filter(Boolean));
    if (fn.adv) return list;
    var out = [], adv = [];
    list.forEach(function (it) { if (advanced(it)) adv.push(it); else out.push(it); });
    if (!adv.length) return list;
    // A heading left with nothing under it goes.
    out = out.filter(function (it, i) { if (!it.head) return true; var nx = out[i + 1]; return !!(it.label === '' || (nx && !nx.head)); });
    return out.concat([head('Advanced')], adv);
  }
  // Only the advanced rows, under the headings they had.
  function keepAdv(list) {
    var out = [], hd = null;
    (list || []).filter(Boolean).forEach(function (it) { if (it.head) hd = it; else if (advanced(it)) { if (hd) { out.push(hd); hd = null; } out.push(it); } });
    return out;
  }
  function title(sct) { if (sct[0] === 'connect' && !phoneOK()) return 'Web editor'; return sct[0] === 'about' && typeof Update !== 'undefined' && Update.state && Update.state.state === 'available' ? sct[1] + '  ·  update ready' : sct[1]; }
  /* In the menu: the section's name in the language, and Language always says "Language" in English too,
     so whoever can't read the language TiviBro is in can still find it. */
  function navTitle(s) {
    var tr = title(s).split('  ·  ').map(T).join('  ·  ');
    return s[0] === 'language' && tr.indexOf('Language') !== 0 ? tr + '  ·  Language' : tr;
  }
  /* sec -1: Search settings, the first row of the menu (findPage). */
  var stack = [];               // sub-pages: [{ title, fn, sel }]

  function cyc(list, cur, dir) { var i = list.indexOf(cur); if (i < 0) i = 0; return list[(i + dir + list.length) % list.length]; }
  function choice(label, sub, values, labels, get, set) {
    return { label: label, sub: sub, value: function () { var i = values.indexOf(get()); return i >= 0 ? labels[i] : String(get()); },
      cycle: function (d) { set(cyc(values, get(), d)); }, values: values, labels: labels, get: get, set: set };
  }
  function toggle(label, sub, get, set) {
    return { label: label, sub: sub, value: function () { return get() ? 'On' : 'Off'; }, cycle: function () { set(!get()); }, toggle: true, get: get, set: set };
  }
  function action(label, sub, fn, value) { return { label: label, sub: sub, action: fn, value: value || function () { return ''; } }; }
  // A heading.  phone: its words on the phone and in the web editor, for one that names the remote's buttons.
  function head(t, phone) { return phone != null ? { head: true, label: t, phoneLabel: phone } : { head: true, label: t }; }
  /* A reload or rescan while the channel plays in Settings' corner (views.js pip): on a TV short of memory
     (Player.memSafe) the channel stops first, as Settings always did, so the two never fill it together. */
  function heavy(fn) { return function () { if (Player.memSafe && Views.pipOn) Views.pipStop('a reload, on a TV short of memory'); return fn.apply(this, arguments); }; }
  function info(label, value) { return { label: label, info: true, value: function () { return value; } }; }
  /* A row that opens another section: the one place a setting lives (the TMDB token is under API keys, not in four
     places).  On the phone it opens that section there (rowData's go). */
  function link(label, sub, id, value) { var it = action(label, sub, function () { section(id); }, value || function () { return '›'; }); it.go = id; it.cls = 'jump'; return it; }
  function page(label, sub, title, fn, value) { var it = action(label, sub, function () { push(title, fn); }, value || function () { return '›'; }); it.page = { title: title, fn: fn }; return it; }
  function save(rebuild) { Store.saveSettings(); if (rebuild) build(); else paint(); }
  function push(title, fn) { stack.push({ title: title, fn: fn, sel: sel }); sel = 0; build(); }
  function pop() { var p = stack.pop(); sel = p ? p.sel : 0; build(); }
  function relist() { L.dirty(); Views.refreshLists(true); }
  function when(t) { if (!t) return 'never'; var d = new Date(t); return d.toLocaleDateString(U.loc ? U.loc() : undefined, { month: 'short', day: 'numeric' }) + ' ' + U.hhmm(t); }

  var REFRESH = [-1, 6, 12, 24, 48, 168, 0], REFRESH_L = ['Every app start', 'Every 6 hours', 'Every 12 hours', 'Every day', 'Every 2 days', 'Every week', 'Only when I ask'];

  /* ---------- playback ---------- */
  function playback() {
    var s = S(), out = [];
    var P = Player.PRESETS;
    out.push(choice('Buffer profile',
      'How much video to hold before and during playback.  More buffer means fewer freezes on shaky streams, but channels take a little longer to start.  Automatic learns from each provider: channels start fast where its streams are steady, and with a bigger cushion where they run dry.  A live channel only banks what the provider sends ahead of real time, often 10 to 40 seconds, so the bigger profiles mostly start safer rather than hold more.  Buffer info shows the most a channel has reached.',
      ['auto', 'low', 'balanced', 'stable', 'max', 'custom'], ['Automatic', P.low.label, P.balanced.label, P.stable.label, P.max.label, 'Custom'],
      function () { return s.buffer; }, function (v) { s.buffer = v; save(true); Views.pipRestart(); }));
    var cur = s.buffer === 'custom' || s.buffer === 'auto' ? null : P[s.buffer];
    if (s.buffer === 'auto' && window.PlayMemo) {
      var known = PlayMemo.summary();
      out.push(info('Profile details', known.length ? known.slice(0, 3).map(function (k) {
        return k.host.replace(/:\d+$/, '') + ': ' + k.why + ', starts at ' + k.prebuffer + 's (' + (k.hours < 1 ? Math.round(k.hours * 60) + ' min' : Math.round(k.hours) + ' h') + ' watched)';
      }).join('; ') : 'Learns as you watch: starts at ' + PlayMemo.LEARNING.prebuffer + 's until a provider has shown how steady it is'));
      out.push(action('Start learning again', 'Forget what TiviBro learned about your providers and channels: how steady each provider is, the cushion each channel earned, and which player each channel needs.', function () { PlayMemo.reset(); U.toast('TiviBro will learn your providers again'); build(); }));
    }
    if (cur) out.push(info('Profile details', 'starts at ' + cur.prebuffer + 's, holds up to ' + cur.ahead + 's, refills to ' + Math.max(2, cur.prebuffer * 1.5) + 's'));
    // Memory-safe changes what a profile can hold: say so here, where the profiles are picked (issue #121).
    if (Player.memSafe) out.push(info('Memory-safe playback is on', Player.memSafe + '.  Each channel holds about 24 MB of video ahead: the full profile on most channels, less on a heavy 4K one.  Settings > Playback > Memory-safe playback.'));
    if (s.buffer === 'custom') {
      var c = s.custom;
      out.push(choice('Start-up buffer', 'Seconds buffered before a channel starts playing.', [0.5, 1, 2, 3, 4, 6, 8, 10, 15], ['0.5s', '1s', '2s', '3s', '4s', '6s', '8s', '10s', '15s'], function () { return +c.prebuffer; }, function (v) { c.prebuffer = v; save(); Views.pipRestart(); }));
      out.push(choice('Read-ahead', 'The most the player downloads ahead while playing.  Movies can fill it; live channels usually stay lower, since the provider only sends a little ahead of real time.', [10, 20, 30, 45, 60, 90, 120], ['10s', '20s', '30s', '45s', '60s', '90s', '120s'], function () { return +c.ahead; }, function (v) { c.ahead = v; save(); Views.pipRestart(); }));
      out.push(choice('Keep behind playhead', 'Lower saves TV memory on long sessions.', [2, 4, 8, 12, 20, 30], ['2s', '4s', '8s', '12s', '20s', '30s'], function () { return +c.back; }, function (v) { c.back = v; save(); Views.pipRestart(); }));
      out.push(choice('Freeze detection', 'How long a frozen picture is tolerated before the player recovers it.', [3, 4, 6, 8, 10, 15, 20], ['3s', '4s', '6s', '8s', '10s', '15s', '20s'], function () { return +c.stall; }, function (v) { c.stall = v; save(); Views.pipRestart(); }));
      out.push(choice('Reconnect attempts', 'Tries before giving up on a channel.  The budget resets after 30 seconds of clean playback.', [3, 5, 8, 12, 20, 50], ['3', '5', '8', '12', '20', '50'], function () { return +c.retries; }, function (v) { c.retries = v; save(); Views.pipRestart(); }));
    }
    out.push(choice('Buffer meter', 'Shows how many seconds of video are banked, in fullscreen.', ['auto', 'always', 'off'], ['When low', 'Always', 'Off'], function () { return s.meter; }, function (v) { s.meter = v; save(); }));
    out.push(choice('Buffer info on demand', Keymap.bufferHint() + ' shows the buffer meter and stream info, even with the meter off.  Press again to hide it.  Any button can do this: Settings > Remote and buttons.',
      [5, 10, 30, 0], ['5 seconds', '10 seconds', '30 seconds', 'Until pressed again'], function () { return s.meterPeek == null ? 10 : +s.meterPeek; }, function (v) { s.meterPeek = v; save(); }));
    out.push(head('Player'));
    out.push(choice('Player engine',
      'Automatic uses the built-in demuxer for fine buffer control and falls back to the TV player when a server blocks it.  TV player uses the least CPU but ignores buffer settings.',
      ['auto', 'mse', 'native'], ['Automatic', 'Built-in demuxer', 'TV player'], function () { return s.engine; }, function (v) { s.engine = v; save(); Views.pipRestart(); }));
    if (Store.playlist.type === 'xtream') out.push(choice('Stream format', 'MPEG-TS usually switches channels faster.  HLS copes better with a weak connection.  One channel can have its own: hold OK on it > Stream format.',
      ['ts', 'm3u8'], ['MPEG-TS', 'HLS'], function () { return s.format; }, function (v) { s.format = v; save(); Views.pipRestart(); }));
    // Channels with a stream format of their own (Hold OK on a channel > Stream format).
    var own = Object.keys(Store.edits.streamFmt || {});
    if (own.length) out.push(action('Channels with their own format', own.slice(0, 4).map(function (k) { var c = L.find(k); return c ? L.name(c) + ': ' + (Store.edits.streamFmt[k] === 'hls' ? 'HLS' : 'MPEG-TS') : ''; }).filter(Boolean).join(',  ') + (own.length > 4 ? '  …' : ''), function () {
      UI.confirm('Use the setting above for every channel?', 'Clear ' + own.length + (own.length === 1 ? ' channel' : ' channels'), function () { Store.edits.streamFmt = {}; Store.saveEdits(); build(); U.toast('Every channel uses the setting above'); });
    }, function () { return String(own.length); }));
    out.push(choice('Connection', 'Automatic uses the network helper: a part of TiviBro that runs in the background on the TV and fetches your channels, guide and streams for the app.  webOS needs it for most providers.  Direct asks the provider straight from the app, which only works with servers that allow it.  Channel lists still load through the helper when it runs, so a big one can\'t close TiviBro.',
      ['auto', 'direct'], ['Automatic (recommended)', 'Direct'], function () { return s.network || 'auto'; }, function (v) { s.network = v; save(); Views.pipRestart(); }));
    out.push(info('Network helper', Net.port ? 'running' : 'not running'));
    out.push(choice('HDR and Dolby Vision', 'Automatic plays Dolby Vision through the TV player, which switches the screen into Dolby Vision itself, and keeps HDR10 and HLG on the built-in player for its steadier buffering.  Choose TV player for all HDR if HDR pictures look washed out or grey.',
      ['auto', 'tv', 'builtin'], ['Automatic', 'TV player for all HDR', 'Built-in player'], function () { return s.hdrRoute || 'auto'; }, function (v) { s.hdrRoute = v; save(); Views.pipRestart(); }));
    // A film shape set from the quick menu (Aspect > Film shape…) shows by its name and stays in the cycle.
    var aspV = Player.ASPECTS.map(function (a) { return a[0]; }), aspL = Player.ASPECTS.map(function (a) { return a[1]; }), aspOn = Player.displayFor(null);
    if (Player.filmShape(aspOn) || Player.wideBy(aspOn)) { aspV.push(aspOn); aspL.push(Player.aspectName(aspOn)); }
    out.push(choice('Aspect', 'The shape of the picture for every channel and video: Original, Fill (stretched to the screen), Zoom (fills it, edges cropped), 4:3, 14:9 (a little wider than 4:3), 16:9 (for a squashed picture), 21:9 (a 2.35:1 film fills the screen) or 4:3 to 16:9.  A channel or video can have its own from the quick menu, which also has Film shape for any wide film (IMAX 1.90, 2.39 and so on) and Stretch wider for a picture squeezed sideways.',
      aspV, aspL, function () { return Player.displayFor(null); }, function (v) { Player.setAspect(v, null); save(); }));
    out.push(head('Catch-up and seeking'));
    out.push(choice('Skip step', 'For Left and Right while watching catch-up or a movie.', [10, 15, 30, 60, 120], ['10s', '15s', '30s', '1 min', '2 min'], function () { return +s.skip; }, function (v) { s.skip = v; save(); }));
    out.push(choice('Rewind / fast forward step', 'For the ◀◀ and ▶▶ buttons while watching catch-up or a movie.', [30, 60, 120, 300, 600], ['30s', '1 min', '2 min', '5 min', '10 min'], function () { return +s.ffStep || 120; }, function (v) { s.ffStep = v; save(); }));
    out.push(choice('◀ on a live channel with catch-up', 'Without catch-up, ◀ always goes to the last channel.', ['rewind', 'last'], ['Rewind', 'Last channel'], function () { return s.rewindLeft === false ? 'last' : 'rewind'; }, function (v) { s.rewindLeft = v === 'rewind'; save(); }));
    // An idea from the GUI thread (discussion #36): the memory-safe mode set by hand, not only when TiviBro decides.
    out.push(choice('Memory-safe playback', 'Holds at most about 24 MB of video ahead (the full buffer profile on most channels, less on a heavy 4K one) so TiviBro doesn\'t close on TVs with 1 or 2 GB.  Automatic turns it on for TVs with 1 GB, and for a few days after TiviBro closed while playing.',
      ['auto', 'on', 'off'], ['Automatic', 'Always on', 'Off'], function () { return s.memSafe || 'auto'; }, function (v) { s.memSafe = v; save(); }));
    out.push(choice('Seek previews', 'A picture of the movie or episode where you\'re seeking to, over the bar, made on the TV from what plays (nothing of your library is read).  Automatic: with Memory-safe playback on, only for movies up to 1080p and nothing made ahead.  Red in the player too.',
      ['auto', 'on', 'off'], ['Automatic', 'On, 4K too', 'Off'], function () { return s.seekPreviews || 'auto'; }, function (v) { s.seekPreviews = v; save(); }));
    out.push(choice('Dolby Vision 7 (UHD Blu-ray)', 'A UHD Blu-ray remux\'s Dolby Vision (profile 7) shows only as HDR10 on LG TVs.  Automatic: played as profile 8.1 through the converter, in Dolby Vision (the base picture with its Dolby Vision brightness data, as dovi_tool makes it).  Off: HDR10, as before.',
      ['auto', 'off'], ['Automatic, in Dolby Vision', 'Off, HDR10'], function () { return s.dv7 === 'off' ? 'off' : 'auto'; }, function (v) { s.dv7 = v; save(); }));
    out.push(toggle('Skip intro and Up next', 'From the file\'s chapters: "Skip intro" while an intro or recap plays, and "Up next" when the credits start (the next episode, or the next movie of a collection you play).  OK does it, Back hides it.', function () { return s.skipIntro !== false; }, function (v) { s.skipIntro = v; save(); }));
    out.push(head('Switching channels'));
    out.push(choice('When a channel stops working', 'Switches to another version of the same channel, such as the HD copy of a Full HD channel, or one you hid.  It only happens once the player has run out of retries.',
      ['auto', 'ask', 'off'], ['Switch to another version', 'Ask me', 'Keep retrying'], function () { return s.backups || 'auto'; }, function (v) { s.backups = v; save(); }));
    out.push(toggle('Ask when a channel is slow to start', 'After 12 seconds without a picture: says what TiviBro has seen, and asks whether to keep trying, start over, try another version or stop.', function () { return s.slowAsk !== false; }, function (v) { s.slowAsk = v; save(); }));
    out.push(toggle('Info panel when switching channels', 'Off shows just the number and name.', function () { return s.osdOnZap !== false; }, function (v) { s.osdOnZap = v; save(); }));
    out.push(toggle('Show stream details in the info panel', 'Resolution and which player is in use.', function () { return s.osdMedia !== false; }, function (v) { s.osdMedia = v; save(); }));
    out.push(toggle('Keep the picture while reconnecting', 'When a channel drops for a moment, the last picture stays on screen with a small Reconnecting notice instead of going black.  Not every stream allows it (the TV player draws some itself).', function () { return s.holdFrame !== false; }, function (v) { s.holdFrame = v; save(); }));
    out.push(toggle('Black screen while switching', 'Hides the last picture until the next channel starts.', function () { return !!s.blackSwitch; }, function (v) { s.blackSwitch = v; save(); }));
    return out;
  }

  /* ---------- Audio and subtitles (out of Playback in the reorganisation) ---------- */
  function audioSubs() {
    var s = S(), out = [];
    out.push(action('Audio language', 'Try this language first when a channel or movie has several audio tracks.  If it is missing, the fallback language below, else the stream\'s own track.  Track language labels must be supplied by the file or stream.', function () {
      langMenu('Audio language', 'The stream\'s own choice', s.audioLang, function (v) { s.audioLang = v; save(); }, true);
    }, function () { return langName(s.audioLang, 'Stream\'s choice'); }));
    out.push(action('Fallback audio language', 'Used when your preferred audio language is missing.  Off keeps the stream\'s own track.', function () {
      langMenu('Fallback audio language', 'Off (the stream\'s own track)', s.audioFallback, function (v) { s.audioFallback = v; save(); });
    }, function () { return langName(s.audioFallback, 'Off'); }));
    out.push(toggle('Prefer surround sound', 'Picks the 5.1 or Dolby track when there is one in that language.  Your soundbar or TV needs to support it.', function () { return !!s.audioSurround; }, function (v) { s.audioSurround = v; save(); }));
    out = out.concat(converterRows());
    out.push(action('Subtitles automatically', 'Turns subtitles on when a stream includes them.  You can still switch them from OK in fullscreen.', function () {
      UI.menu('Subtitles automatically', [{ label: 'Off', sub: !s.autoSubs ? 'on' : '', action: function () { s.autoSubs = false; save(); } },
        { label: 'Any language', sub: s.autoSubs && !s.subsLang ? 'on' : '', action: function () { s.autoSubs = true; s.subsLang = ''; save(); } }]
        .concat(U.LANGS.map(function (l) { return { label: l[1] + ' only', sub: s.autoSubs && s.subsLang === l[0] ? 'on' : '', action: function () { s.autoSubs = true; s.subsLang = l[0]; save(); } }; })));
    }, function () { return !s.autoSubs ? 'Off' : s.subsLang ? langName(s.subsLang) : 'Any language'; }));
    out.push(toggle('Closed captions', 'Live TV in fullscreen, when the channel sends them (most US channels do).  Also in the quick menu (OK in fullscreen), for every channel at once.  Not with the TV player.', function () { return !!s.cc; }, function (v) { Player.setCC(v); }));
    out.push(choice('Caption size', '', ['s', 'm', 'l'], ['Small', 'Medium', 'Large'], function () { return s.ccSize || 'm'; }, function (v) { s.ccSize = v; save(); }));
    out.push(choice('Subtitle colour', 'For subtitles in movies, shows and channels.  Closed captions keep the channel\'s own colours.', ['white', 'yellow', 'gold', 'cyan', 'green'], ['White', 'Yellow', 'Gold', 'Light blue', 'Light green'],
      function () { return s.subColor || 'white'; }, function (v) { s.subColor = v; Views.applyLook(); save(); }));
    out.push(choice('Subtitle size', '', ['s', 'm', 'l', 'xl'], ['Small', 'Medium', 'Large', 'Extra large'], function () { return s.subSize || 'm'; }, function (v) { s.subSize = v; Views.applyLook(); save(); }));
    out.push(choice('Subtitle background', 'Outline keeps the picture clear; a box is easier to read over bright scenes.', ['outline', 'box', 'solid'], ['Outline', 'See-through box', 'Black box'],
      function () { return s.subBack || 'outline'; }, function (v) { s.subBack = v; Views.applyLook(); save(); }));
    out.push(choice('Subtitle position', 'Higher keeps the lines clear of a picture\'s own captions or a score bar.  For subtitles TiviBro draws (most of them); the TV\'s own keep their place.  Also in the player: Subtitles > Size and style.', ['low', '', 'up1', 'up2', 'up3'], ['Lowest', 'Normal', 'A little higher', 'Higher', 'Highest'], function () { return s.subPos || ''; }, function (v) { s.subPos = v; Views.applyLook(); save(); }));
    out.push(choice('Subtitle brightness', 'Dimmer white lines are easier on the eyes in a dark room, and on an OLED.', ['', '90', '75', '60'], ['Full', '90 %', '75 %', '60 %'], function () { return s.subBright || ''; }, function (v) { s.subBright = v; Views.applyLook(); save(); }));
    out.push(toggle('Bold subtitles', '', function () { return !!s.subBold; }, function (v) { s.subBold = v; Views.applyLook(); save(); }));
    out.push(head('Subtitles from OpenSubtitles'));
    out.push(action('Subtitle languages', 'For Find subtitles (Subtitles in a movie or show\'s menu).  Several at once: English and Spanish (Latin America), say.', function () { Subs.langMenu(function () { build(); }); },
      function () { return Subs.langs().map(Subs.langName).join(', '); }));
    // The key and sign-in are under Settings > API keys, with TMDB's token.
    out.push(link('OpenSubtitles key and sign-in', Subs.configured ? (Subs.user ? 'Key saved, signed in as ' + Subs.user : 'Key saved') : 'Not set up yet', 'keys', function () { return Subs.configured ? 'Saved' : 'Not set up'; }));
    out.push(choice('Keep downloaded subtitles', 'A movie or episode you come back to gets its subtitles and timing again, without another download.  Kept on this TV only.', [0, 1, 3, 7], ['Off', '1 day', '3 days', 'A week'],
      function () { return s.keepSubs === 0 ? 0 : +s.keepSubs > 0 ? +s.keepSubs : 7; }, function (v) { s.keepSubs = v; if (!v) Subs.forgetKept(); save(); }));
    return out;
  }

  /* ---------- the audio converter (convert.js) ---------- */
  var convSt = null, convAt = 0;
  function convFresh() {
    if (typeof Convert === 'undefined' || (convAt && Date.now() - convAt < 5000)) return;
    convAt = Date.now();
    Convert.status(true).then(function (x) { convSt = x; live(); });
  }
  function convLine() { var r = info('Audio converter', ''); r.value = function () { return Net.port ? Convert.describe(convSt) : 'needs the network helper'; }; return r; }
  function converterRows() {
    if (typeof Convert === 'undefined') return [];
    var s = S(), out = [];
    convFresh();
    out.push(choice('Convert audio the TV can\'t play', 'Some movies have only sound this TV can\'t decode: DTS on LG TVs from 2020 to 2022, Dolby TrueHD on every LG TV, and FLAC surround.  Automatic turns that sound into Dolby Digital while the movie plays, with a small audio converter kept on the TV.  The picture is not touched.  Off plays them as they are, often without sound.',
      ['auto', 'off'], ['Automatic', 'Off'], function () { return s.convertAudio === 'off' ? 'off' : 'auto'; }, function (v) { s.convertAudio = v; save(); }));
    out.push(convLine());
    var ready = convSt && convSt.state === 'ready';
    if (ready && !convSt.bundled && !/TIVIBRO_FFMPEG/.test(convSt.where || '')) out.push(action('Remove the converter', 'Frees about 3 MB of the TV\'s storage.  TiviBro offers it again when a movie needs it.', function () {
      Convert.remove().then(function (x) { convSt = x; s.convertAsked = false; s.convertNever = false; save(); U.toast('Audio converter removed'); build(); }, function (e) { U.toast(e.message, 5000); });
    }));
    else if (!ready && !(convSt && convSt.bundled)) out.push(action('Get the converter now', 'Downloads it (about 2 MB) from TiviBro\'s releases on GitHub, checks its fingerprint and keeps it on the TV\'s storage, so movies don\'t wait for it.', function () {
      if (!Net.port) { U.toast('The network helper is not running', 4000); return; }
      U.toast('Getting the audio converter…', 30000);
      Convert.get(function (pc) { convSt = { state: 'downloading', percent: pc }; paint(); }).then(function (x) { convSt = x; U.toast('Audio converter ready', 3000); build(); },
        function (e) { convAt = 0; convFresh(); U.toast(e.message, 7000); build(); });
    }));
    // Always three rows, whatever the converter's state (it is read in the background): the phone app opens
    // the pages further down this page by their place in it.
    else out.push(info('The converter comes with TiviBro', ''));
    return out;
  }

  /* A button the phone app does on the phone itself (a form there instead of boxes on the TV), when it
     knows how: rowData sends the name.  Older phone apps run it on the TV as before. */
  function phoneDoes(name, it) { it.phone = name; return it; }
  // A button that only makes sense on the TV's own screen (it waits for a remote button, or shows a QR code).
  function tvOnly(it) { it.tv = 1; return it; }
  /* OpenSubtitles: set up step by step, or the saved key (replace, test, remove) and the sign-in. */
  function osRows() {
    var out = [];
    // Not set up yet: the step-by-step setup (subs.js setup()), which also comes to the phone app.
    if (!Subs.configured) out.push(action('Set up OpenSubtitles (step by step)', 'Free, about two minutes: an account, a key for TiviBro, and you\'re done.  Easiest with the TiviBro phone app open on this page.', function () { Subs.setup(0, function () { build(); }); }, function () { return 'Not set up'; }));
    else out.push(action('OpenSubtitles API key saved', 'Select to replace it.  It stays on this TV, out of backups.', function () {
      UI.prompt('OpenSubtitles API key', '', function (k) { try { Subs.setKey(k); U.toast(k.trim() ? 'API key saved' : 'API key removed'); build(); } catch (e) { U.toast(e.message, 7000); } }, 'Empty removes it.  Typing is easier from the phone app.', true);
    }, function () { return Subs.configured ? 'Saved' : 'Not set'; }));
    if (Subs.configured) out.push(action('Test OpenSubtitles key', 'Asks OpenSubtitles now whether the saved key (and your sign-in) work.', function () { U.toast('Checking with OpenSubtitles…'); Subs.test().then(function (m) { U.toast(m, 7000); live(); }, function (e) { U.toast(e.message, 8000); }); }));
    if (Subs.configured) out.push(action(Subs.user ? 'Signed in as ' + Subs.user : 'Sign in (optional)', 'Without an account OpenSubtitles allows 5 downloads a day; with a free one, 20.', function () {
      UI.prompt('OpenSubtitles username', Subs.user, function (u) {
        if (!u.trim()) { Subs.signIn('', ''); U.toast('Signed out'); build(); return; }
        UI.prompt('Password for ' + u.trim(), '', function (p) {
          U.toast('Signing in…');
          Subs.signIn(u, p).then(function (n) { U.toast('Signed in' + (n ? ': ' + n + ' downloads a day' : '')); build(); }, function (e) { U.toast(e.message, 6000); build(); });
        }, 'Kept on this TV only, to sign in again each day.', true);
      }, 'Empty signs out.');
    }, function () { return Subs.user ? (Subs.allowed ? Subs.allowed + ' a day' : 'Signed in') : '5 a day'; }));
    if (Subs.configured) out.push(action('Remove OpenSubtitles key', 'Downloaded subtitles stay where they are.', function () { Subs.setKey(''); Subs.signIn('', ''); U.toast('OpenSubtitles key removed'); build(); }));
    return out;
  }
  /* Settings > API keys: every key you paste in one place (the TMDB token for posters and details, the
     OpenSubtitles key for Find subtitles), each with Test.  Typing them is easiest from the phone app. */
  function apiKeys() {
    return [info('Paste these from the TiviBro phone app (Settings > API keys): a phone keyboard and copy and paste make it quick.', '')]
      .concat([head('TMDB: movie and show details and posters')]).concat(tmdbRows().filter(Boolean))
      .concat([head('OpenSubtitles: subtitles for movies and shows')]).concat(osRows())
      // Trakt has no key to paste (a code on trakt.tv/activate), but its sign-in belongs with the others.  Its history and lists settings stay on My media.
      .concat(typeof Trakt === 'undefined' ? [] : [head('Trakt: watch history and lists')].concat(traktAccount(), [link('Trakt history and lists', 'What goes to Trakt and comes back, and its lists as shelves: on My media.', 'media')]));
  }
  /* Your TMDB token: in Settings > API keys, linked from My media and Movies and shows (Movies on now uses it too). */
  function tmdbRows() {
    var hasToken = MediaStore.preferences().tmdbConfigured;
    return [
      phoneDoes('tmdb-token', action(hasToken ? 'TMDB API token saved' : 'Add TMDB API token', hasToken ? 'Token saved on this TV.  Select to replace it, or use the web editor.' : 'Create your own free API key or Read Access Token at themoviedb.org/settings/api.  The web editor is easier for pasting it.  It gives My media its posters and details, and finds the movies in your guide.', function () { UI.prompt(hasToken ? 'Replace TMDB API token' : 'TMDB API key or Read Access Token', '', function (token) { if (!token.trim()) return; U.toast('Checking TMDB access…'); Media.setTmdbToken(token).then(function () { U.toast('TMDB token saved on this TV'); if (typeof Movies !== 'undefined') Movies.poke(); live(); }, function (e) { U.toast(e.message, 6000); }); }, 'The token stays on this TV and is excluded from backups.', true); }, function () { return MediaStore.preferences().tmdbConfigured ? 'Saved' : 'Not set'; })),
      hasToken && action('Test TMDB token', 'Asks TMDB now whether the saved token works.', function () { U.toast('Checking the TMDB token…'); Media.testTmdbToken().then(function (m) { U.toast(m, 5000); }, function (e) { U.toast(e.message, 7000); }); }),
      hasToken && action('Remove TMDB token', 'Saved movie details remain available.', function () { Media.setTmdbToken('').then(function () { if (typeof Movies !== 'undefined') Movies.poke(); live(); }); })
    ].filter(Boolean);
  }
  // My media and Movies and shows point to the one place the token lives (API keys).
  function tmdbLink() {
    var has = MediaStore.preferences().tmdbConfigured;
    return link('TMDB API token', has ? 'Saved on this TV.  Test or replace it under API keys.' : 'Not set yet.  It\'s under API keys, with the OpenSubtitles key.', 'keys');
  }
  /* ---------- My media: source management and preferences live outside the movie browser ---------- */
  var mediaLoaded = false;
  function media() {
    if (!mediaLoaded) { mediaLoaded = true; MediaStore.load().then(live); }
    var out = [head('Libraries'),
      info('Each library is one folder on a media server (DLNA / UPnP, WebDAV, Dropbox or Google Drive) holding movies or TV shows, like Plex\'s libraries.  Select one to scan it, fix what didn\'t match, choose whether it shows on Home, or remove it.', '')];
    MediaStore.publicSources().forEach(function (s) {
      var row = page(I18n.raw(s.name), libraryLine(s), I18n.raw(s.name), function () { return library(s.id); }, function () { return libraryValue(s.id); });
      row.sid = s.id; out.push(row);
    });
    if (!MediaStore.sources().length) out.push(info('No libraries yet', 'Choose Add a library below'));
    out.push(phoneDoes('media-add', action('Add a library', 'Movies or TV shows from a DLNA / UPnP server, a WebDAV folder (address and login), Dropbox (signs in from the phone app) or Google Drive (the web editor or the phone app).  Subfolders are scanned too.', function () { Media.addMenu(); })));
    out.push(head('All libraries'),
      action('Scan all libraries', 'Look for added and removed movies and episodes.  Green on the My media screen.', heavy(function () { Media.rescanAll(); })),
      action('Fetch details for all', 'Look up movies, shows and owned episodes on TMDB, and refresh details in another language.  Yellow on My media.', heavy(function () { Media.fetchMissingDetails(); })),
      choice('Look for new files', 'A quick look at each library for files added or removed, like Plex, scanning only one that changed.  Also when TiviBro starts and when My media opens.  Green on My media scans everything now.', [15, 60, 360, 0], ['Every 15 minutes', 'Every hour', 'Every 6 hours', 'Only when I press Green'], function () { return MediaStore.preferences().checkEvery; }, function (v) { Media.updatePreferences({ checkEvery: v }); Media.newMediaSoon(); paint(); }),
      (function () { var it = info('Fetching details now', ''); it.value = function () { return Media.busyText ? (Media.busyText().replace(/^Fetching details: /, '') || 'Nothing running') : ''; }; return it; })(),
      tvOnly(action('Edit on a computer', 'Shows a code for a computer or phone browser: the web editor\'s My media page, for typing server logins, fixing many matches at once and TV show episodes.', function () { WebEdit.showJoin('media'); })),
      tmdbLink());
    // Display and Trakt in place (they were pages of their own).
    out = out.concat([head('Display and shelves')], mediaDisplay());
    if (typeof Trakt !== 'undefined') out = out.concat(trakt().map(function (it) { return it && it.head && it.label === 'Account' ? head('Trakt') : it; }));
    return out;
  }
  function kindName(k) { return k === 'shows' ? 'TV shows' : k === 'automatic' ? 'Movies and TV shows' : 'Movies'; }
  function where(s) { return (s.type === 'dlna' ? 'DLNA / UPnP' : s.type === 'dropbox' ? 'Dropbox' : s.type === 'gdrive' ? 'Google Drive' : 'WebDAV') + (s.type === 'dropbox' || s.type === 'gdrive' ? (s.root ? '  ·  ' + s.root : '') : ''); }
  function libraryLine(s) {
    var st = Media.libraryStats ? Media.libraryStats(s.id) : null;
    if (!st) return kindName(s.contentMode) + '  ·  ' + where(s);
    var bits = [kindName(st.kind), where(s)];
    if (st.homeOff) bits.push('not on Home');
    return bits.join('  ·  ');
  }
  function libraryValue(id) {
    var st = Media.libraryStats(id);
    if (st.scanning) return 'Scanning…';
    var parts = [];
    if (st.kind !== 'shows') parts.push(st.movies + ' movies' + (st.unmatched.length ? ', ' + st.unmatched.length + ' unmatched' : ''));
    if (st.kind !== 'movies') parts.push((st.showsLoading ? 'Counting shows' : st.shows + ' shows') + (st.episodes ? ', ' + st.episodes + ' files' : ''));
    return parts.join('  ·  ');
  }
  // One library's page: what it holds, scanning, matching, Home and removing.
  function library(id) {
    var s = MediaStore.source(id);
    if (!s) return [info('This library was removed.', '')];
    var st = Media.libraryStats(id), pub = MediaStore.publicSources().filter(function (x) { return x.id === id; })[0] || {}, out = [];
    out.push(info(where(pub) + (pub.address ? '  ·  ' + I18n.raw(String(pub.address).replace(/\/\/[^@\/]*@/, '//')) : ''), ''));
    if (st.kind !== 'shows') out.push(info('Movies', st.movies + (st.fourK ? '  (' + st.fourK + ' in 4K)' : '') + '  ·  ' + (st.movies - st.unmatched.length) + ' matched' + (st.waiting ? '  ·  ' + st.waiting + ' not looked up yet' : '')));
    if (st.kind !== 'movies') out.push(info('TV shows', st.shows + ' shows  ·  ' + st.episodes + ' episode files' + (st.unmatchedShows ? '  ·  ' + st.unmatchedShows + ' unmatched' : '')));
    out.push(head('Library'),
      choice('Holds', 'Movies or TV shows decides how files are read and which tab they go to.  Movies and TV shows sorts each file by its name.', ['movies', 'shows', 'automatic'], ['Movies', 'TV shows', 'Movies and TV shows'], function () { return (MediaStore.source(id) || {}).contentMode || 'movies'; }, function (v) { Media.changeSourceMode(id, v).then(function () { live(); }, function (e) { U.toast(e.message, 6000); }); }),
      action('Name', 'What My media and Settings call it.', function () { UI.prompt('Library name', s.name, function (n) { if (!n.trim()) return; try { MediaStore.sourceUpdate(id, { name: n }); Media.refresh(); build(); } catch (e) { U.toast(e.message, 6000); } }); }, function () { return I18n.raw((MediaStore.source(id) || {}).name || ''); }),
      toggle('Show on Home', 'Its Recently added, Continue watching and favorites on My media\'s Home.  Off: only on the Movies and TV shows tabs.', function () { return !(MediaStore.source(id) || {}).homeOff; }, function (v) { try { MediaStore.sourceUpdate(id, { homeOff: !v }); Media.refresh(); paint(); } catch (e) { U.toast(e.message, 6000); } }),
      Media.isScanning(id) ? action('Pause scan', 'Stops after the current request.', function () { Media.sourceMenu(s); }) : action('Scan now', 'Look for added or removed files.', heavy(function () { Media.rescan(id); U.toast('Scanning ' + s.name + '…'); })),
      Media.isScanning(id) ? null : action('Restart scan', 'Starts over from the first folder.', heavy(function () { Media.rescan(id, true); })),
      action(Media.detailsLabel(s), 'From TMDB, with your saved API token.', heavy(function () { Media.libraryDetails(id); })),
      (function () { var c = phoneDoes('media-source', action('More for this library', 'Its folder, Dropbox sign-in, pause or restart a scan.  On the phone: its own form.', function () { Media.sourceMenu(s); })); c.sid = id; return c; })(),
      head('Needs attention'));
    if (st.kind !== 'shows' && st.waiting) out.push(action('Not looked up yet', 'Movies TMDB hasn\'t been asked about yet (a lookup that stopped, or no token then).  OK looks them up now; it also happens by itself.', heavy(function () { Media.lookUpWaiting(id); }), function () { return String(st.waiting); }));
    if (st.kind !== 'shows') out.push(page('Unmatched movies', 'Movies TMDB didn\'t recognise.  Fix match searches by the title you type.', 'Unmatched in ' + I18n.raw(s.name), function () { return unmatched(id); }, function () { var x = Media.libraryStats(id); return String(x.unmatched.length - (x.waiting || 0)); }));
    if (st.kind !== 'movies') out.push(action('Shows that need review', 'Episodes TiviBro couldn\'t place, and shows without a match.  Opens TV shows on My media.', function () { MediaSeries.review(); }, function () { return st.unmatchedShows ? String(st.unmatchedShows) : ''; }));
    out.push(action('Excluded files', 'Trailers, extras and samples left out.  Include one back from here.', function () { MediaSeries.excluded(); }, function () { return '›'; }),
      head('Remove'),
      action('Remove library', 'Takes it off My media.  Your files stay where they are.', function () { Media.removeLibrary(s); }));
    return out.filter(Boolean);
  }
  function unmatched(id) {
    var list = Media.libraryStats(id).unmatched;
    if (!list.length) return [info('Everything in this library matched.', '')];
    return list.slice(0, 200).map(function (m) { return action(I18n.raw(m.title || m.file || '?'), I18n.raw(m.file || m.path || ''), function () { Media.findDetails(m); }, function () { return 'Fix match'; }); })
      .concat(list.length > 200 ? [info(list.length - 200 + ' more', 'The web editor lists them all.')] : []);
  }
  // One setting, in Movies and shows and in My media: the next episode, or the next movie of a collection you play.
  function autoNextRow() {
    var s = S();
    return toggle('Play the next one automatically', 'When an episode ends, the next one starts after 5 seconds; when a movie of a collection you play ends, the next movie after 10.  Back cancels it.', function () { return s.autoNext !== false; }, function (v) { s.autoNext = v; save(); });
  }
  function mediaDisplay() {
    var names = { en: 'English', nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian' };
    return [
      choice('Sort movies by', 'Applies to Movies, Favorites and the genre shelves.  Continue watching stays ordered by recent playback.  Red on My media too.', ['name', 'release', 'added', 'rating', 'runtime'], ['Name (A–Z)', 'Release date (newest first)', 'Date added (newest first)', 'Rating (highest first)', 'Running time (longest first)'], function () { return MediaStore.preferences().sort; }, function (v) { Media.updatePreferences({ sort: v }); paint(); }),
      toggle('Reverse the movie order', 'Turns the movie order round: Z to A, oldest, lowest or shortest first.', function () { return MediaStore.preferences().sortReverse; }, function (v) { Media.updatePreferences({ sortReverse: v }); paint(); }),
      choice('Sort TV shows by', 'Applies to TV shows and favorite shows, on the TV and the phone.  Continue watching stays ordered by recent playback.', ['name', 'release', 'added', 'rating'], ['Name (A–Z)', 'First aired (newest first)', 'Date added (newest first)', 'Rating (highest first)'], function () { return MediaStore.preferences().showSort; }, function (v) { Media.updatePreferences({ showSort: v }); paint(); }),
      toggle('Reverse the TV show order', 'Turns the TV show order round: Z to A, oldest or lowest first.', function () { return MediaStore.preferences().showSortReverse; }, function (v) { Media.updatePreferences({ showSortReverse: v }); paint(); }),
      // With movies and shows, each tab is arranged on its own (its shelves are only on that tab).
      Media.bothKinds && Media.bothKinds() ? action('Arrange Home shelves', 'Continue watching, Browse, holiday lists, Recently added, Pick of the day, Trending and mixed Trakt lists.  Red on My media too.', function () { Media.arrangeShelves('home'); }) : null,
      Media.bothKinds && Media.bothKinds() ? action('Arrange Movies shelves', 'Recently added movies, collections, genres, decades, directors, 4K and HDR, TMDB\'s and Trakt\'s movie lists.', function () { Media.arrangeShelves('movies'); }) : null,
      Media.bothKinds && Media.bothKinds() ? action('Arrange TV shows shelves', 'Next up, every show, Needs review, TMDB\'s and Trakt\'s TV lists.', function () { Media.arrangeShelves('shows'); }) : null,
      Media.bothKinds && Media.bothKinds() ? null : action('Arrange shelves', 'Move My media\'s shelves up or down and switch off the ones you don\'t want: Continue watching, holiday lists, Favorites, Recently added, TMDB\'s and Trakt\'s lists, Movies, TV shows, genres and more.  Red on My media too.', function () { Media.arrangeShelves(); }, function () { var p = MediaStore.preferences(); return p.shelfOrder.length || Object.keys(p.shelfOff).length ? 'Your order' : 'As it comes'; }),
      choice('Library poster size', 'All movies, All shows and Collections: how big the posters are.  Red there too.', ['small', 'medium', 'large', 'xl'], ['Small (11 to a row)', 'Medium (9 to a row)', 'Large (7 to a row)', 'Extra large (5 to a row)'], function () { return S().mediaGridSize || 'medium'; }, function (v) { S().mediaGridSize = v; save(); }),
      toggle('Watched marks on posters', 'As Plex: a show\'s episodes not watched yet in its corner, and ✓ on what you\'ve watched.', function () { return S().mediaMarks !== false; }, function (v) { S().mediaMarks = v; save(); Media.refresh(); }),
      toggle('Mark what\'s new', 'A small dot by what came in since your last visit, and a shelf of them.  Gone once you open it.', function () { return S().mediaNew !== false; }, function (v) { S().mediaNew = v; save(); Media.refresh(); }),
      toggle('Open where you left off', 'My media opens on the tab, and the library grid, you were last on.  Off: always on Home.', function () { return S().mediaResume !== false; }, function (v) { S().mediaResume = v; save(); }),
      autoNextRow(),
      toggle('Favorites also in lists', 'On: a favorite movie or show is in Favorites and also in Movies or TV shows.  Off: only in Favorites.', function () { return MediaStore.preferences().favoritesInLists; }, function (v) { Media.updatePreferences({ favoritesInLists: v }); paint(); }),
      choice('Metadata language', 'Shared with the web editor.  Refreshes saved movie and show matches in this language.  Missing translations fall back to English.', Object.keys(names), Object.keys(names).map(function (k) { return names[k]; }), function () { return MediaStore.preferences().language; }, function (v) { Media.updatePreferences({ language: v }); paint(); })
    ].filter(Boolean);
  }

  /* ---------- Trakt: watch history both ways, and its lists as My media shelves ---------- */
  var KIND_V = ['both', 'movies', 'shows'], KIND_L = ['Movies and TV shows (Home)', 'Movies (Movies tab)', 'TV shows (TV shows tab)'];
  function traktErr(e) { if (e && e.message !== 'Stopped.') U.toast(e.message || 'Trakt did not answer.', 7000); }
  /* Trakt's sign-in (connect with a code, sync, disconnect): on My media's Trakt rows and under API keys. */
  function traktAccount() {
    var out = [], code = Trakt.pendingCode();
    if (code) {
      var go = action('1.  On a phone or computer, open', 'Then sign in to Trakt.  In the phone app, select this to open it.', function () { U.toast('Open ' + code.url.replace(/^https?:\/\//, '') + ' and enter ' + code.user, 8000); }, function () { return code.url.replace(/^https?:\/\//, ''); });
      var link = code.url.replace(/\/+$/, '') + '/' + encodeURIComponent(code.user);   // Trakt fills the code in from this
      go.phone = 'open-url'; go.epage = link;
      // On the TV: a QR code for the phone's camera, opening Trakt with the code already in.
      if (typeof qrcode !== 'undefined') {
        var qb = U.el('div', 'trakt-qr'), qi = U.el('div', 'trakt-qr-img');
        try { var q = qrcode(0, 'M'); q.addData(link); q.make(); qi.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { qi = null; }
        if (qi) { qb.appendChild(qi); var qt = U.el('div', 'trakt-qr-t'); qt.appendChild(U.el('b', '', T('Scan with your phone\'s camera'))); qt.appendChild(U.el('span', '', T('Trakt opens with the code filled in.  Sign in and choose Yes.'))); qb.appendChild(qt); out.push({ preview: true, el: qb }); }
      }
      out.push(go);
      var cd = info('2.  Enter this code', code.user); cd.cls = 'trakt-code'; out.push(cd, info('Waiting for Trakt…', 'This page updates by itself'),
        action('Stop connecting', '', function () { Trakt.cancel(); build(); }));
    } else if (!Trakt.connected()) {
      out.push(action('Connect Trakt', 'Shows a code to enter at trakt.tv/activate on your phone or computer.  No password is typed on the TV.', function () {
        U.toast('Asking Trakt for a code…');
        Trakt.connect(function () { build(); }).then(function (u) { U.toast('Trakt connected as ' + u, 5000); build(); }, function (e) { traktErr(e); build(); });
      }));
    } else {
      out.push(info('Connected as', Trakt.user()),
        action('Sync now', 'Sends what you\'ve watched and brings in what you watched elsewhere.', function () { U.toast('Syncing with Trakt…'); Trakt.syncNow(true).then(function () { U.toast('Synced with Trakt', 4000); paint(); }, traktErr); }, function () { return Trakt.describe().replace(/^Connected as [^·]*·?\s*/, ''); }),
        action('Disconnect Trakt', 'Signs this TV out of Trakt.  Your lists stay on My media without your private ones.', function () { UI.confirm('Disconnect Trakt from this TV?', 'Disconnect', function () { Trakt.disconnect(); build(); }); }));
    }
    return out;
  }
  function trakt() {
    if (typeof Trakt === 'undefined') return [info('Trakt is not available in this version.', '')];
    var out = [info('Trakt keeps what you\'ve watched in step across TiviBro, your phone and other apps, and its lists (your watchlist, your own lists, anyone\'s public list, trending and popular) become shelves on My media that show only what you can watch.  Your Trakt sign-in stays on this TV.  TiviBro uses Trakt but is not endorsed or certified by Trakt.', '')];
    out.push(head('Account'));
    out = out.concat(traktAccount());
    out.push(head('Watch history'),
      toggle('Mark as watched on Trakt', 'When you finish a movie or episode on My media, it goes on your Trakt history (kept and sent later if Trakt can\'t be reached).  Where you stop partway goes to Trakt too, so other apps can continue from there.', function () { return Trakt.settings().watchedOut; }, function (v) { Trakt.setSettings({ watchedOut: v }); paint(); }),
      toggle('Bring my Trakt history in', 'What you watched on other apps shows as watched here, so Next up and Not watched yet follow along, and what you paused elsewhere is in Continue watching.', function () { return Trakt.settings().historyIn; }, function (v) { Trakt.setSettings({ historyIn: v }); paint(); }));
    out.push(head('Lists on My media'));
    var ls = Trakt.lists();
    if (!ls.length) out.push(info('No Trakt lists yet.  Add one below.', ''));
    ls.forEach(function (l) {
      out.push(page(I18n.raw(l.name), (l.on === false ? 'Off  ·  ' : '') + KIND_L[Math.max(0, KIND_V.indexOf(l.kind))] + '  ·  ' + Trakt.itemsOf(l.id).length + ' titles on Trakt', I18n.raw(l.name), function () { return traktList(l.id); }));
    });
    out.push(page('Add a Trakt list', 'Your watchlist, Trakt\'s charts, popular lists, a search, or a list\'s link (like Radarr and Sonarr).  Each goes on the tab for what it holds.', 'Add a Trakt list', traktAdd));
    return out.filter(Boolean);
  }
  // Adding a list: everything in one place, what's on My media already marked, and the tab worked out for you.
  function traktAdded(r) { U.toast(r.message, 6000); build(); }
  function traktFoundMenu(title, found) {
    if (!found.length) return U.toast('No lists found.  Try other words.', 5000);
    UI.menu(title, found.map(function (x) {
      return { label: I18n.raw((x.added ? '✓  ' : '') + x.name), sub: I18n.raw((x.added ? 'On My media  ·  ' : '') + (x.holds || x.count + ' titles') + '  ·  by ' + x.user + (x.kind && !x.added ? '  ·  goes on ' + Trakt.tabName(x.kind) : '')),
        action: x.added ? function () { U.toast(x.name + ' is already on My media'); } : function () { U.toast('Adding ' + x.name + '…'); Trakt.addFound(x).then(traktAdded, traktErr); } };
    }));
  }
  function traktLook(what, fn) { U.toast(what + '…', 8000); fn().then(function (found) { traktFoundMenu(what.replace(/^Looking (up|for) /, ''), found); }, traktErr); }
  function traktAdd() {
    if (typeof Trakt === 'undefined') return [];
    var out = [info('A list goes on the tab for what it holds: movies on Movies, TV shows on TV shows, both on Home.  You can change that on the list\'s page.', '')];
    var row = function (label, sub, on, fn) { return action((on ? '✓  ' : '') + label, on ? 'On My media' : sub, on ? function () { U.toast(label + ' is already on My media'); } : fn); };
    if (Trakt.connected()) {
      out.push(head('From your Trakt account'),
        row('Recently watched', 'What you watched lately, here and in other apps, newest first.  Home.', Trakt.has({ type: 'history' }), function () { try { Trakt.addHistory(); U.toast('Recently watched is on Home'); build(); } catch (e) { traktErr(e); } }),
        row('Your watchlist', 'Movies and shows you saved to watch.  Home.', Trakt.has({ type: 'watchlist' }), function () { try { Trakt.addWatchlist(); U.toast('Your watchlist is on Home'); build(); } catch (e) { traktErr(e); } }),
        row('Movies Trakt recommends for you', 'Movies tab.', Trakt.has({ type: 'recommended', of: 'movies' }), function () { try { Trakt.addRecommended('movies'); build(); } catch (e) { traktErr(e); } }),
        row('Shows Trakt recommends for you', 'TV shows tab.', Trakt.has({ type: 'recommended', of: 'shows' }), function () { try { Trakt.addRecommended('shows'); build(); } catch (e) { traktErr(e); } }));
    }
    ['movies', 'shows'].forEach(function (of) {
      out.push(head(of === 'movies' ? 'Trakt charts: movies' : 'Trakt charts: TV shows'));
      Trakt.CHARTS.filter(function (c) { return c[1] === of; }).forEach(function (c) {
        out.push(row(c[2], of === 'movies' ? 'Movies tab.' : 'TV shows tab.', Trakt.hasChart(c[0], c[1]), function () { try { Trakt.addChart(c[0], c[1]); build(); } catch (e) { traktErr(e); } }));
      });
    });
    out.push(head('Lists other people made'),
      action('Search lists by name', 'Christmas, A24, Oscar winners, 80s horror…  Each result says what it holds.', function () { UI.prompt('Search Trakt lists', '', function (q) { if (q.trim()) traktLook('Looking for "' + q.trim() + '"', function () { return Trakt.search(q, true); }); }, 'Typing is easier from the phone app or the web editor.'); }),
      action('Popular lists', 'The lists most liked on Trakt.', function () { traktLook('Looking up popular lists', function () { return Trakt.browse('popular', true); }); }),
      action('Trending lists', 'Lists people are liking this week.', function () { traktLook('Looking up trending lists', function () { return Trakt.browse('trending', true); }); }),
      action('Paste a list\'s link', 'Like Radarr and Sonarr: a trakt.tv/users/NAME/lists/LIST link, or NAME/LIST.  The list must be public, or yours.', function () {
        UI.prompt('Trakt list link or NAME/LIST', '', function (v) { if (!v.trim()) return; U.toast('Looking up the list…'); Trakt.addTyped(v).then(traktAdded, traktErr); }, 'For example trakt.tv/users/garycrawfordgc/lists/latest-releases.  Typing is easier from the phone app or the web editor.');
      }));
    return out;
  }
  function traktList(id) {
    var l = Trakt.lists().filter(function (x) { return x.id === id; })[0];
    if (!l) return [info('This list was removed.', '')];
    return [
      toggle('On My media', 'Off keeps the list here without its shelf.', function () { var x = Trakt.lists().filter(function (y) { return y.id === id; })[0]; return !!x && x.on !== false; }, function (v) { Trakt.update(id, { on: v }); paint(); }),
      choice('Holds', 'Which titles the shelf shows, and the tab it goes on.', KIND_V, KIND_L, function () { var x = Trakt.lists().filter(function (y) { return y.id === id; })[0]; return x ? x.kind : 'both'; }, function (v) { Trakt.update(id, { kind: v }); paint(); }),
      action('Name', 'The shelf\'s title.', function () { UI.prompt('Shelf name', l.name, function (n) { if (n.trim()) { Trakt.update(id, { name: n.trim().slice(0, 80) }); build(); } }); }, function () { return I18n.raw(l.name); }),
      info('On Trakt', Trakt.itemsOf(id).length + ' titles.  The shelf shows the ones you can watch.'),
      action('Refresh now', 'Lists refresh by themselves every 6 hours.', function () { Trakt.itemsSoon(true); U.toast('Refreshing Trakt lists…'); }),
      action('Remove from My media', 'The list stays on Trakt.', function () { Trakt.remove(id); pop(); })
    ];
  }

  /* ---------- remote ---------- */
  function remote() {
    var out = [];
    // Which way Up and Down change channel in fullscreen (discussion #60): the two buttons of In the player, swapped.
    out.push(choice('Up and Down in fullscreen', 'Up goes to the channel above in the list (a lower number) unless you change it here.  In the player lets you set each button yourself.',
      ['prev', 'next'], ['Up: the channel above', 'Up: the channel below'],
      function () { return Keymap.get('player', 'up') === 'chnext' ? 'next' : 'prev'; },
      function (v) { Keymap.set('player', 'up', v === 'next' ? 'chnext' : 'chprev'); Keymap.set('player', 'down', v === 'next' ? 'chprev' : 'chnext'); }));
    // Each screen's buttons in place (they were four pages).
    out.push(head('In the player')); out = out.concat(keysPage('player'));
    out.push(head('In the guide')); out = out.concat(keysPage('guide'));
    out.push(head('On the Channels screen')); out = out.concat(keysPage('list'));
    out.push(head('Quick menu buttons'));
    out.push(info('Which buttons show when you press OK in fullscreen.  Buttons only appear when they apply, e.g. Audio needs two or more tracks.', ''));
    (function () { var off = S().qpHidden || (S().qpHidden = {});
      Views.QP_BUTTONS.forEach(function (b) { out.push(toggle(b[1], '', function () { return !off[b[0]]; }, function (v) { if (v) delete off[b[0]]; else off[b[0]] = 1; save(); })); }); })();
    out.push(head('Extra buttons'));
    out.push(tvOnly(action('Learn a button', 'For keys the app does not know yet.  Press this, then press the button.  Some buttons belong to the TV (Home, Live TV, the TV\'s own Guide, Input, Settings): webOS acts on them before TiviBro hears them, so they leave TiviBro and can\'t be learned.', function () {
      U.toast('Press the button to learn', 5000);
      UI.captureNext(function (code, known) {
        if (known && Keymap.BUTTONS.some(function (b) { return b[0] === known; })) { U.toast('That is ' + Keymap.label(known) + ', already supported'); return; }
        Keymap.learn(code); U.toast('Learned button ' + code + '.  Assign it under In the player, In the guide or On the Channels screen.'); build();
      });
    })));
    out.push(tvOnly(action('Button tester', 'Shows what the app sees when you press a button.  The TV\'s own buttons (Home, Live TV, Guide, Input) never reach TiviBro.', function () {
      U.toast('Press any button', 5000);
      UI.captureNext(function (code, known) { U.toast('Key code ' + code + (known ? ':  ' + Keymap.label(known) : ':  not assigned'), 4000); });
    })));
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
      if (b[0] !== 'back' && !((ctx === 'list' || ctx === 'guide') && arrowish[b[0]]) && !(ctx === 'guide' && (b[0] === 'rew' || b[0] === 'ff'))) out.push(slot('long:' + b[0], I18n.raw(I18n.t('Hold {x}', { x: I18n.t(b[1]) }))));
    });
    out.push(head(''));
    out.push(action('Restore defaults for this screen', '', function () { Keymap.reset(ctx); U.toast('Defaults restored'); build(); }));
    return out;
  }

  /* ---------- playlists ---------- */
  function playlists() {
    var s = S(), out = [];
    // Several playlists on: all of them are used at once, the first one's groups first.
    var multi = L.multi;
    s.playlists.forEach(function (raw) {
      var p = Store.normalize(raw), active = p.id === s.active, part = !active && L.partOf(p.id);
      var use = active ? (multi && L.main ? 'first, ' + L.main.channels.length + ' channels' : 'in use, ' + L.count() + ' channels') : part ? 'on, ' + part.channels.length + ' channels' : '';
      out.push(page(I18n.raw(p.name || (p.type === 'xtream' ? p.user : 'M3U')), [p.off ? 'Off' : '', Store.expiry(p), p.type === 'xtream' ? 'Xtream Codes' : p.type === 'stalker' ? 'Stalker portal' : 'M3U playlist', use].filter(Boolean).join('   '),
        p.name ? I18n.raw(p.name) : 'Playlist', function () { return playlistPage(p); }));
    });
    // From the phone app: its own Add a playlist form (AddPlaylistDialog), with the playlist type to pick.
    var addPl = phoneDoes('add-playlist', action('Add playlist…', 'Each playlist keeps its own groups, favorites, hidden items, guide and name rules.  Adding one from the phone app is easier: share your provider\'s link to it.', function () { App.setup('new'); }));
    out.push(addPl);
    // Several playlists on: where the others' channels show up (mixPage).
    if (mixable().length) out.push(page('Mixing playlists', 'Where your other playlists\' channels show up: All channels, Favorites and your groups, My teams, Events by time, Movies on now, Recently added and Search.',
      'Mixing playlists', mixOverview, function () { return mixSummary(); }));
    /* How the helper finds your providers' servers (service/dns.js, discussion #60): the TV's DNS, a public one,
       one you type, or DNS over HTTPS, for a provider the TV's DNS doesn't find or blocks. */
    out.push(head('Finding your provider'));
    out.push(choice('DNS', 'Which DNS finds your providers\' servers.  The TV\'s own is right for most.  Try another when a provider\'s address isn\'t found, or is blocked by your internet provider.  Over HTTPS also hides the names you look up from it.  Needs the network helper.',
      DNS_IDS, DNS_NAMES,
      function () { return s.dns || 'tv'; },
      function (v) { if (v === 'custom' && !s.dnsServer) return askDns(); s.dns = v; save(); Net.setDns(); build(); }));
    if (s.dns === 'custom') out.push(action('DNS server', 'One or two addresses, IPv4 or IPv6 (192.168.1.1, 2001:de4::101), or a DNS-over-HTTPS link (https://dns.example/dns-query).', askDns, function () { return s.dnsServer || 'Not set'; }));
    out.push(info(s.playlists.length > 1 ? 'Every playlist that is on is used at once: each has its own section in the group list, under its name.  The first playlist comes first, and your Favorites, your groups and reminders belong to it.  The guide, names and channels of the first playlist are under Guide, Channel and group names, and Channels and groups.'
      : 'The guide, names and channels of the playlist in use are under Guide, Channel and group names, and Channels and groups.', ''));
    return out;
  }

  /* The DNS choices (Settings > Playlists and accounts > DNS, and the first setup screen, discussion #60). */
  var DNS_IDS = ['tv', 'cloudflare', 'google', 'quad9', 'quad101', 'controld', 'controld-uncensored', 'doh-cloudflare', 'doh-google', 'doh-controld', 'doh-controld-uncensored', 'custom'];
  var DNS_NAMES = ['The TV\'s own', 'Cloudflare (1.1.1.1, 1.0.0.1)', 'Google (8.8.8.8)', 'Quad9 (9.9.9.9)', 'Quad101, Taiwan (101.101.101.101)', 'ControlD Unfiltered (76.76.2.0)', 'ControlD Uncensored (76.76.2.5)', 'Cloudflare over HTTPS', 'Google over HTTPS', 'ControlD Unfiltered over HTTPS', 'ControlD Uncensored over HTTPS', 'A DNS server I type (IPv4, IPv6 or over HTTPS)'];
  // after: what to redraw once it is saved (the settings page, or the setup screen).
  function askDns(after) {
    var s = S(); if (typeof after !== 'function') after = build;
    UI.prompt('DNS server', s.dnsServer || '', function (v) {
      v = String(v || '').trim();
      // One or two IPv4 or IPv6 addresses, or a DNS-over-HTTPS link (discussion #60).
      var v4 = function (x) { return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(x) && x.split('.').every(function (n) { return +n <= 255; }); };
      var v6 = function (x) { return /^[0-9a-f:.]*:[0-9a-f:.]*$/i.test(x); };
      var doh = /^https:\/\/[^\s\/?#]+(\/\S*)?$/i.test(v), parts = v.split(/[\s,;]+/).filter(Boolean);
      if (!doh && !(parts.length && parts.length <= 3 && parts.every(function (x) { return v4(x) || v6(x); }))) { U.toast('That isn\'t a DNS address (192.168.1.1, 2001:de4::101) or an https:// link', 6000); return; }
      s.dnsServer = doh ? v : parts.join(', '); s.dns = 'custom'; save(); Net.setDns(); after();
    }, 'Like 192.168.1.1, 2001:de4::101 or https://dns.example/dns-query');
  }
  /* A setting that changes the guide reloads it, but not on every press (discussion #36: stepping Keep past days
     from 1 to 7 started six guide downloads).  It waits until you've moved off that row (or left Settings) and a
     couple of seconds have passed, or 20 seconds at most. */
  var guidePending = null;
  function persist(p, reloadGuide) {
    Store.upsertPlaylist(p);
    if (!((p.id === S().active || L.otherIds().indexOf(p.id) >= 0) && reloadGuide)) return;
    var row = items[sel] && items[sel].label;
    if (guidePending) { guidePending.at = Date.now(); guidePending.row = row; return; }
    guidePending = { at: Date.now(), first: Date.now(), row: row, t: setInterval(function () {
      var g = guidePending, now = Date.now(), here = typeof Views !== 'undefined' && Views.tab === 'settings', cur = items[sel] && items[sel].label;
      if (!g || now - g.at < 2000) return;
      if (here && cur === g.row && now - g.first < 20000) return;
      clearInterval(g.t); guidePending = null;
      Epg.refresh(L, true);
    }, 1000) };
  }

  /* ---------- mixing playlists (library.js mixList) ---------- */
  var MIX_ROWS = [
    ['all', 'In All channels', 'Its channels are in All channels, with the first playlist\'s.  Off: All channels has only the first playlist\'s channels.'],
    ['groups', 'In Favorites and your groups', 'Its channels can go into Favorites and the groups you made.  Off: they can\'t be added, and any already there are kept but not shown until this is on again.'],
    ['teams', 'In My teams', 'Your teams\' games on its channels are in My teams, with one title for each game.'],
    ['events', 'In Events by time', 'The games and pay-per-view on its event channels are in Events by time.'],
    ['movies', 'In Movies on now', 'Movies on its channels are on the Movies on now screen.'],
    ['added', 'In Recently added', 'Channels it added lately are in Recently added.'],
    ['search', 'In Search', 'Search looks through its channels and guide too.']];
  // The other playlists that are on (the first playlist is what they mix into).
  function mixable() { var s = S(); return s.playlists.filter(function (p) { return !p.off && p.id !== s.active; }).length && s.playlists.filter(function (p) { return !p.off; }).length > 1 ? s.playlists.filter(function (p) { return !p.off && p.id !== s.active; }) : []; }
  function mixCount(p) { return MIX_ROWS.filter(function (r) { return !(p.mix && p.mix[r[0]] === false); }).length; }
  function mixValue(p) { var n = mixCount(p); return n === MIX_ROWS.length ? 'All' : n ? I18n.t('{n} of {y}', { n: n, y: MIX_ROWS.length }) : 'Off'; }
  function mixSummary() {
    var l = mixable(), full = l.filter(function (p) { return mixCount(p) === MIX_ROWS.length; }).length, none = l.filter(function (p) { return !mixCount(p); }).length;
    return full === l.length ? 'All mixed in' : none === l.length ? 'Not mixed in' : 'Partly mixed in';
  }
  function mixOverview() {
    var first = Store.byId(S().active), out = [];
    out.push(info(I18n.t('Your other playlists\' channels always have their own section in the group list, under each playlist\'s name.  Here you choose where else they show up, with the channels of your first playlist, {x}.', { x: (first && first.name) || 'Playlist' }), ''));
    mixable().forEach(function (p) { out.push(page(I18n.raw(p.name || 'Playlist'), 'Where its channels show up', I18n.raw(p.name || 'Playlist'), function () { return mixRows(p); }, function () { return mixValue(p); })); });
    return out;
  }
  function mixRows(p) {
    var out = [];
    out.push(info(I18n.t('{x}\'s channels always have their own section in the group list, under its name.  These switches choose where else they show up.  Off only leaves them out: nothing is deleted.', { x: p.name || 'Playlist' }), ''));
    MIX_ROWS.forEach(function (r) {
      out.push(toggle(r[1], r[2], function () { return !(p.mix && p.mix[r[0]] === false); }, function (v) {
        p.mix = p.mix || {};
        if (v) delete p.mix[r[0]]; else p.mix[r[0]] = false;
        if (!Object.keys(p.mix).length) delete p.mix;
        Store.upsertPlaylist(p);
        L.mixChanged(); Views.refreshLists(true); paint();
      }));
    });
    return out;
  }

  function playlistPage(p) {
    var s = S(), out = [], active = p.id === s.active, xc = p.type === 'xtream', part = !active && L.partOf(p.id);
    // Every playlist that is on is in use: this makes it the first one (its groups first, and your
    // Favorites, groups and reminders are its own).  With only one on, it is the old "Use this playlist".
    if (!active && !p.off) out.push(Store.others().length > 1 || L.multi
      ? action('Make this the first playlist', 'Its groups come first.  Your Favorites, your own groups and reminders are kept with each first playlist.', function () { stack = []; App.switchPlaylist(p.id); })
      : action('Use this playlist', '', function () { stack = []; App.switchPlaylist(p.id); }));
    /* Off (instead of Delete): its login, groups, favorites and names are all kept, but it is left out of
       everything (switching, the menus offering another playlist) until it is turned on again. */
    out.push(toggle('Playlist on', p.off ? 'Off: kept with everything you set, out of the way.  Turn it on to use it again.' : 'Turn it off to keep it, with its login and everything you set, without deleting it.',
      function () { return !p.off; }, function (v) {
        if (!v && active) {
          var next = s.playlists.filter(function (x) { return x.id !== p.id && !x.off; })[0];
          if (!next) { U.toast('This is the only playlist that is on.  Turn another one on (or add one) first.', 6000); return paint(); }
          p.off = true; persist(p); stack = []; U.toast('"' + (p.name || 'Playlist') + '" is off.  Switching to "' + (next.name || 'the next playlist') + '".', 5000); App.switchPlaylist(next.id); return;
        }
        p.off = !v; persist(p); build();
        App.playlistsChanged();          // its channels join the lists, or leave them
      }));
    out.push(action('Name', '', function () { UI.prompt('Playlist name', p.name, function (v) { if (v.trim()) { p.name = v.trim(); persist(p); build(); } }); }, function () { return I18n.raw(p.name); }));
    var stk = p.type === 'stalker';
    // On the phone: its own form (AddPlaylistDialog in edit mode), not the TV's setup screen.
    var conn = phoneDoes('edit-playlist', action('Connection', xc ? 'Server, username and password' : stk ? 'Portal address and MAC address' : 'Playlist address', function () { App.setup(p.id); }, function () { return xc ? p.server : stk ? p.portal : p.m3u; }));
    conn.sid = p.id; conn.ptype = p.type;
    out.push(conn);
    out.push(action('User-Agent', 'Only if your provider asks for a specific one.  Sent by the network helper for this playlist.', function () {
      UI.prompt('User-Agent (empty = default)', p.ua || '', function (v) { p.ua = v.trim(); persist(p); build(); U.toast(p.ua ? 'User-Agent set.  Reload channels to use it everywhere.' : 'Default User-Agent'); });
    }, function () { return p.ua ? p.ua.slice(0, 28) + (p.ua.length > 28 ? '…' : '') : 'Default'; }));
    out.push(head('Channel list updates'));
    out.push(choice('Reload channel list', '', REFRESH, REFRESH_L, function () { return +p.plRefresh; }, function (v) { p.plRefresh = v; persist(p); paint(); }));
    if (active) {
      if (App.reloading) out.push(action('Stop reloading', 'The channels from the last load stay.', function () { App.stopReload(); }));
      else out.push(action('Reload channels now', 'Your groups, renames and hidden items are kept.', heavy(function () { App.refresh(true); })));
      out.push(info('Last reloaded', when(L.data.at)));
      if (L.data.exp) out.push(info('Subscription expires', new Date(L.data.exp).toLocaleDateString() + (Store.expiry(p) ? '  (' + Store.expiry(p).replace(/^Expire[sd] /, '') + ')' : '')));
      if (L.data.maxConn) out.push(info('Connections allowed', String(L.data.maxConn)));
      vodCount(p);
    } else if (part) {
      if (App.reloading) out.push(action('Stop reloading', 'The channels from the last load stay.', function () { App.stopReload(); }));
      else out.push(action('Reload channels now', 'Your hidden items and renames are kept.', heavy(function () { App.refresh(true, p.id); })));
      out.push(info('Last reloaded', when(part.at)));
      if (part.exp) out.push(info('Subscription expires', new Date(part.exp).toLocaleDateString() + (Store.expiry(p) ? '  (' + Store.expiry(p).replace(/^Expire[sd] /, '') + ')' : '')));
      if (part.maxConn) out.push(info('Connections allowed', String(part.maxConn)));
      vodCount(p);
    }
    // Its movies and shows, once they've loaded (discussion #134).
    function vodCount(p) {
      var n = typeof Vod !== 'undefined' && Vod.countsFor ? Vod.countsFor(p.id) : null, fmt = function (x) { return Number(x).toLocaleString(); };
      if (!n || (n.movie == null && n.series == null)) return;
      out.push(info('Movies and shows', [n.movie != null ? I18n.t('{x} movies', { x: fmt(n.movie) }) : '', n.series != null ? I18n.t('{x} shows', { x: fmt(n.series) }) : ''].filter(Boolean).join('   ')));
    }
    // Another playlist that is on: where its channels show up besides its own groups (mixRows).
    if (!active && !p.off && mixable().some(function (x) { return x.id === p.id; })) {
      out.push(head('Mix into the first playlist'));
      out = out.concat(mixRows(p));
    }
    out.push(head('This playlist\'s guide, names and events'));
    // The playlist in use: its guide and names are the Guide and Channel and group names sections; another one has its own page.
    if (active) out.push(link('Guide', 'The provider\'s guide, your guide sources and public fill-in: the Guide section', 'guide'));
    else out.push(page('Guide', 'The provider\'s guide, your guide sources and public fill-in for this playlist', 'Guide: ' + (p.name || 'playlist'), function () { return guideRows(p); }));
    // On the phone it is a page of its own (Tour.phoneRows), the same steps without the TV's screen.
    // Several playlists on: each playlist that is on has its own tour, for its own channels.
    if (active || part) { var tourRow = action('Set-up tour', 'Countries, channel names, East or West, your city, event channels, clutter, logos and look, one screen at a time.', function () { Tour.open({ from: 'settings', pl: p.id }); }, function () { return p.tour > 0 ? 'done ' + when(p.tour) : '›'; });
      tourRow.phonePage = { title: 'Set-up tour', fn: function () { return Tour.phoneRows(p.id); } }; out.push(tourRow); }
    if (active) out.push(link('Channel and group names', p.names && p.names.enabled ? 'On' : 'Off', 'names'));
    else out.push(page('Channel and group names', p.names && p.names.enabled ? 'On' : 'Off', 'Channel and group names', function () { return namesPage(p); }));
    out.push(page('Event channels', p.events && p.events.on === false ? 'Off' : 'On', 'Event channels', function () { return eventsPage(p); }));
    out.push(head(''));
    /* The only playlist too (an expired one, discussion #36): TiviBro then starts again on the screen that
       adds a playlist, as on a new TV. */
    var only = s.playlists.length < 2;
    out.push(action('Delete this playlist', only ? 'It is your only playlist: removes it with its groups, favorites, hidden items and cached data, and TiviBro starts again on the screen that adds a playlist.' : 'Removes its groups, favorites, hidden items and cached data.  Turning it off (above) keeps them instead.', function () {
      UI.confirm('Delete ' + (p.name || 'this playlist') + '?' + (only ? '  It is your only one.' : ''), 'Delete', function () {
        stack = [];
        Store.removePlaylist(p.id);
        if (only) { if (window.Views && Views.stopAll) Views.stopAll(); setTimeout(function () { location.reload(); }, 1500); return; }      // after the settings are written (300 ms)
        if (active) App.switchPlaylist(Store.settings.active); else { App.playlistsChanged(); build(); }
      });
    }));
    return out;
  }

  /* One playlist's guide (the Guide section shows the one in use; each playlist's page has its own). */
  /* One playlist's guide.  Several playlists on: every one that is on is in use, so each shows its own
     status (Epg.statusFor) and its own channels; Reload guide now reloads every playlist's guide. */
  function guideRows(p) {
    var out = [], active = p.id === S().active, xc = p.type === 'xtream';
    var inUse = active || L.otherIds().indexOf(p.id) >= 0, mine = L.dataOf(active ? '' : p.id).channels;
    var stk = p.type === 'stalker';
    out.push(choice('Provider guide', xc ? 'Per channel is light and loads as you browse.  The full file also enables guide search and manual assignment.' : stk ? 'The portal\'s own guide, per channel as you browse.  Your guide sources and the public guide fill in the rest.' : 'The guide address inside the playlist, if it has one.',
      xc ? ['short', 'xmltv', 'off'] : stk ? ['short', 'off'] : ['xmltv', 'off'], xc ? ['Per channel', 'Full XMLTV file', 'Off'] : stk ? ['Per channel', 'Off'] : ['From playlist', 'Off'],
      function () { return p.providerEpg; }, function (v) { p.providerEpg = v; persist(p, true); build(); }));
    var offs = [], offl = [];
    for (var m = -720; m <= 720; m += 30) { offs.push(m); offl.push((m > 0 ? '+' : m < 0 ? '-' : '') + Math.floor(Math.abs(m) / 60) + ':' + U.pad(Math.abs(m) % 60)); }
    if (p.providerEpg !== 'off') out.push(choice('Provider guide time offset', 'Use when every programme is too early or too late.', offs, offl, function () { return +p.epgOffset; }, function (v) { p.epgOffset = v; persist(p, true); paint(); }));
    var srcRows = sourcesPage(p);
    out.push(choice('Reload guide', '', REFRESH, REFRESH_L, function () { return +p.epgRefresh; }, function (v) { p.epgRefresh = v; persist(p); paint(); }));
    out.push(choice('Keep past days', 'For catch-up browsing.  More days use more TV memory.', [1, 2, 3, 5, 7], ['1 day', '2 days', '3 days', '5 days', '7 days'], function () { return +p.epgDays; }, function (v) { p.epgDays = v; persist(p, true); paint(); }));
    out.push(toggle('Match guide by channel name', 'Links channels that have no guide id to a guide channel with the same name.', function () { return p.nameMatch; }, function (v) { p.nameMatch = v; persist(p, true); paint(); }));
    var pubRows = pubPage(p);
    if (inUse) {
      out.push(action('Reload guide now', L.multi ? 'Every playlist\'s guide loads again.' : '', heavy(function () { Epg.refresh(L, true); U.toast('Reloading guide'); live(); })));
      var st = active ? Epg.status : Epg.statusFor(p.id) || { at: 0, sources: [] };
      if (Epg.xml) {
        out.push(info('Guide last loaded', Epg.loading || (Epg.progress && Epg.progress.active) ? 'loading now' : st.at ? when(st.at) : (active || sourcesOf(p) ? 'not yet' : 'only the per-channel guide')));
        (st.sources || []).forEach(function (r) { out.push(info(r.url.replace(/(password|pass)=[^&]+/i, '$1=…'), r.ok ? r.channels + ' channels, ' + r.programmes + ' programmes' : 'failed: ' + r.error)); });
        var all = mine, n = 0, missing = [];
        all.forEach(function (c) { if (Epg.hasData(c)) n++; else if (!L.noGuide(c) && missing.length < 300) missing.push(c); });
        out.push(info('Channels with guide data', n + ' of ' + all.length));
        if (missing.length) out.push(action('Assign guide to channels without one', 'Or hold OK on any channel and choose Assign guide.  A channel that will never have a guide: hold OK > No guide for this channel.', function () {
          UI.menu('Channels without guide', missing.map(function (c) { return { label: I18n.raw(L.name(c)), sub: I18n.raw(L.groupName(c.g)), action: function () { assignGuide(c); } }; }));
        }));
      }
      // Channels you said need no guide (Hold OK > No guide for this channel, or Ignore in the web editor).
      var none = mine.filter(function (c) { return L.noGuide(c); });
      if (none.length) out.push(page('Channels with no guide wanted', 'Left out of guide matching and public fill-in, and they don\'t say "No guide information".', 'No guide wanted', function () {
        var o = [info('Select one to look for a guide for it again.', '')];
        mine.filter(function (c) { return L.noGuide(c); }).forEach(function (c) {
          o.push(action(I18n.raw(L.name(c)), I18n.raw(L.groupName(c.g)), function () { L.setNoGuide(c.k, false); relist(); U.toast('Looking for a guide for ' + L.name(c) + ' again'); build(); }, function () { return 'Look again'; }));
        });
        return o;
      }, function () { return none.length + ' ›'; }));
    }
    // Your guide sources and public fill-in in place (they were pages of their own).
    out = out.concat([head('Guide sources'), info((p.epgSources || []).length + ' XMLTV address' + ((p.epgSources || []).length === 1 ? '' : 'es') + ', after the provider guide.  The first one comes first.', '')], srcRows);
    out = out.concat([head('Public guide fill-in')], pubRows);
    return out;
  }

  // Does a playlist have guide files of its own (its sources, or the provider's full XMLTV)?
  function sourcesOf(p) { return (p.epgSources || []).length > 0 || p.providerEpg === 'xmltv'; }
  /* Public guide fill-in (pubepg.js): on or off, which countries, and how the last look went.  Several
     playlists on: one look covers every playlist that has it on, so each shows the same status. */
  function pubPage(p) {
    var inUse = p.id === S().active || L.otherIds().indexOf(p.id) >= 0;
    var out = [], active = inUse, cf = PubEpg.conf(p), st = active ? Epg.pubStatus : null;
    function apply(patch) { PubEpg.set(p, patch); Store.upsertPlaylist(p); if (active) Epg.refresh(L, false); build(); }
    out.push(toggle('Fill in from public guides', 'For channels with no guide from your sources or your provider.  Those always come first.', function () { return PubEpg.conf(p).on; }, function (v) { apply({ on: v }); }));
    if (cf.on) {
      var auto = st && st.countries && st.countries.length && !cf.cc.length ? st.countries.map(PubEpg.name).join(', ') : '';
      out.push(action('Countries', cf.cc.length ? 'Your choice' : 'Automatic: the countries of the channels that need a guide' + (auto ? ' (' + auto + ')' : ''), function () { countryMenu(p); },
        function () { return cf.cc.length ? cf.cc.map(PubEpg.name).join(', ') : 'Automatic'; }));
      out.push(toggle('Sports guides', 'US sports networks (Big Ten, SEC, ACC, ESPN, FS1, regional sports networks) and team channels, from EPGTalk and epgshare01.  They also stand in for a sports channel\'s own guide when theirs reaches further ahead.  Needs the helper.',
        function () { return PubEpg.sportsOn(p); }, function (v) { apply({ sports: v }); }));
      if (active) {
        if (Epg.loading && (!st || !st.at)) out.push(info('Looking', 'after your own guide loads'));
        else if (st && st.none) out.push(info('Last look', st.none));
        else if (st && st.at) {
          out.push(info('Channels filled in', st.filled + ' of ' + st.asked + ' with no other guide'));
          out.push(info('Last looked', when(st.at) + (st.took ? ', took ' + Math.max(1, Math.round(st.took / 1000)) + ' s' : '')));
          (st.sources || []).forEach(function (r) { out.push(info(r.url, r.skipped ? 'not needed' : r.ok ? r.filled + ' channels' : 'failed: ' + r.error)); });
          if (!Net.active) out.push(info('iptv-epg.org and the sports guides', 'need Settings > Playback > Connection set to Automatic'));
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
    function save() { PubEpg.set(p, { cc: Object.keys(pick) }); Store.upsertPlaylist(p); if (p.id === S().active || L.otherIds().indexOf(p.id) >= 0) Epg.refresh(L, false); build(); }
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
      UI.menu(I18n.raw(I18n.t('Guide for {x}', { x: L.name(c) })), items);
    }, 'Part of a name is enough.');
  }

  /* ---------- channel name editor ---------- */
  function namesPage(p) {
    var n = p.names || (p.names = Names.defaults()), out = [], active = p.id === S().active;
    var inUse = active || L.otherIds().indexOf(p.id) >= 0;          // several playlists on: its channels are in the lists too
    function changed(rebuild) { persist(p); Names.invalidate(); if (inUse) relist(); if (rebuild) build(); else paint(); }
    out.push(toggle('Clean up channel names', 'Your playlist is not changed.  Turn off to see the original names.', function () { return n.enabled; }, function (v) { n.enabled = v; changed(true); }));
    out.push(toggle('Hide channels with nothing on', 'Channels named "Off Air", "Offline" or "No Event Scheduled", empty slots like "PPV 09 |", and events that ended hours ago stay out of the lists until the provider names a new event on them.  Favorites keep theirs.',
      function () { return !!n.hideIdle; }, function (v) { n.hideIdle = v; changed(); }));
    if (!n.enabled) return out.concat([preview(n, active)]);
    out.push(toggle('Clean group names too', 'The rules below also tidy group names: "USA | Sports" becomes "Sports".  Your group prefixes and suffixes (further down) apply either way.', function () { return n.groups; }, function (v) { n.groups = v; changed(); }));
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
    listSection(out, 'Your prefixes', 'prefix', n.prefixes, changed, 'Removed from the start of a channel name, any capitalisation.  Example: NOW: ');
    listSection(out, 'Your suffixes', 'suffix', n.suffixes, changed, 'Removed from the end of a channel name.  A leading space counts, so " HD" will not touch "WHD".');
    out.push(preview(n, active));
    // Group names: their own lists, for words only groups carry ("USA ", " Channels").
    if (!n.gprefixes) n.gprefixes = [];
    if (!n.gsuffixes) n.gsuffixes = [];
    listSection(out, 'Group prefixes', 'group prefix', n.gprefixes, changed, 'Removed from the start of a group name only.  Example: USA ');
    listSection(out, 'Group suffixes', 'group suffix', n.gsuffixes, changed, 'Removed from the end of a group name only.  Example: " Channels"');
    out.push(groupPreview(n, active));
    return out;
  }
  /* ---------- event channels ---------- */
  function eventsPage(p) {
    var ev = p.events || (p.events = {}), out = [], active = p.id === S().active;
    var inUse = active || L.otherIds().indexOf(p.id) >= 0;          // several playlists on: its channels are in the lists too
    function changed(rebuild) { persist(p); Events.reset(); if (inUse) relist(); if (rebuild) build(); else paint(); }
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
      UI.prompt('Add a ' + kind, '', function (v) { if (v.trim()) { arr.push(/prefix/.test(kind) ? v.replace(/^\s+/, '') : v.replace(/\s+$/, '')); changed(true); } }, 'Spaces count.  Shown with · in the list.');
    }));
    arr.forEach(function (e, i) {
      out.push(action(show(e), '', function () {
        UI.menu(I18n.raw(show(e)), [
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
  function groupPreview(cfg, active) {
    var box = U.el('div', 'prev-table');
    box.appendChild(U.el('div', 'opt head', active ? 'Group names with your rules' : 'Group names (switch to this playlist to see its groups)'));
    var gs = active ? L.data.groups.slice(0, 400) : [];
    var changed = gs.filter(function (g) { return Names.cleanGroupWith(cfg, g.name) !== g.name; });
    changed.concat(gs.filter(function (g) { return changed.indexOf(g) < 0; })).slice(0, 8).forEach(function (g) {
      var r = U.el('div'), raw = g.name;
      r.appendChild(U.el('span', 'a', raw));
      r.appendChild(U.el('span', 'b', Names.cleanGroupWith(cfg, raw)));
      box.appendChild(r);
    });
    return { preview: true, el: box };
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
  /* Group g moved by places within the list it's shown in (Manage groups: the shown or the hidden ones).  The groups
     it passes in that list may have others between them in the real order (hidden ones among shown, your groups and
     a playlist's), so it goes one step at a time (Library.moveGroup) until it is past the group it was dropped on. */
  function moveAmong(g, list, by) {
    var i = list.indexOf(g), j = Math.max(0, Math.min(list.length - 1, i + by));
    if (i < 0 || i === j) return;
    var target = list[j].id, dir = j < i ? -1 : 1;
    function at(id) { var a = L.allGroups(); for (var n = 0; n < a.length; n++) if (a[n].id === id) return n; return -1; }
    for (var step = 0; step < 2000; step++) {
      var a = at(g.id), b = at(target);
      if (a < 0 || b < 0 || (dir < 0 ? a <= b : a >= b)) break;
      L.moveGroup(g.id, dir);
      if (at(g.id) === a) break;            // can't go further (the start of its own playlist's groups, say)
    }
    relist(); build();
  }
  // Manage groups: show all, hide all, then a switch per group, the shown ones first (and draggable on the phone).
  function manageGroups() {
    var out = [], all = L.allGroups();
    function set(g, show) { L.hideGroup(g.id, !show); }
    var shown = all.filter(function (g) { return !Store.edits.hiddenGroups[g.id]; }).length;
    out.push(info('Groups shown', shown + ' of ' + all.length));
    out.push(action('Show all groups', '', function () { L.hideGroups(all.map(function (g) { return g.id; }), false); relist(); build(); U.toast('All groups shown'); }));
    out.push(action('Hide all groups', 'Then switch on just the ones you watch.', function () {
      UI.confirm('Hide all ' + all.length + ' groups?  You can switch them back on here.', 'Hide all', function () { L.hideGroups(all.map(function (g) { return g.id; }), true); relist(); build(); });
    }));
    /* The groups shown first, then the hidden ones, each in their own order: with most groups hidden, the ones you
       watch are together at the top instead of spread among the rest.  A group switched on or off moves to the
       other list when the page is drawn again. */
    var on = all.filter(function (g) { return !Store.edits.hiddenGroups[g.id]; }), off = all.filter(function (g) { return !!Store.edits.hiddenGroups[g.id]; });
    function rows(list) {
      list.forEach(function (g) {
        out.push({ label: I18n.raw(g.name), sub: g.custom ? 'your group' : '',
          value: function () { return Store.edits.hiddenGroups[g.id] ? 'Hidden' : 'Shown'; },
          cycle: function () { set(g, !!Store.edits.hiddenGroups[g.id]); relist(); paint(); },
          // On the phone: a switch, on for shown.
          toggle: true, get: function () { return !Store.edits.hiddenGroups[g.id]; }, set: function (v) { if (v === !!Store.edits.hiddenGroups[g.id]) { set(g, v); relist(); paint(); } },
          // On the phone and in the web editor: dragged up or down by places in this list (op "move").
          move: function (by) { moveAmong(g, list, by); } });
      });
    }
    if (on.length) { out.push(head('Shown (' + on.length + '): OK, ◀ or ▶ hides a group', 'Shown (' + on.length + '): drag ≡ to move a group')); rows(on); }
    if (off.length) { out.push(head('Hidden (' + off.length + '): OK, ◀ or ▶ shows a group', 'Hidden (' + off.length + ')')); rows(off); }
    return out;
  }

  /* ---------- rename groups: a name of your own for any group ---------- */
  /* Rename groups (Settings > Channels and groups): every group, the shown ones first.  OK asks for the new name (the
     phone types it); an empty name goes back to the provider's.  A renamed provider group says what the provider
     calls it, so it can be found again.  Favorites keeps its name (it's translated). */
  function renamePage() {
    var out = [], gs = L.allGroups().filter(function (g) { return g.id !== L.FAV; });
    var renamed = gs.filter(function (g) { return !L.isCustom(g.id) && L.providerName(g.id) && L.groupName(g.id) !== L.providerName(g.id); }).length;
    out.push(info('Renamed', renamed + ' of ' + gs.length));
    out.push(info('OK on a group to type its new name.  Leave the name empty to go back to the provider\'s.', ''));
    function rows(list) {
      list.forEach(function (g) {
        var own = function () { return L.isCustom(g.id) ? '' : L.providerName(g.id); };
        out.push(action(I18n.raw(L.groupName(g.id)), L.isCustom(g.id) ? 'your group' : (L.groupName(g.id) !== own() ? 'renamed, the provider calls it ' + own() : ''), function () {
          UI.prompt('New name for ' + L.groupName(g.id), L.groupName(g.id), function (n) {
            n = String(n || '').trim();
            if (L.isCustom(g.id) && !n) return;
            L.setGroupName(g.id, n === own() ? '' : n.slice(0, 80));
            relist(); build();
            U.toast(n ? 'Renamed to ' + n : 'Back to ' + own());
          }, L.isCustom(g.id) ? 'Typing is easier from the phone app.' : 'Empty goes back to "' + own() + '".  Typing is easier from the phone app.');
        }, function () { return '›'; }));
      });
    }
    var shown = gs.filter(function (g) { return !g.hidden; }), hidden = gs.filter(function (g) { return g.hidden; });
    if (shown.length) { out.push(head('Shown (' + shown.length + ')')); rows(shown); }
    if (hidden.length) { out.push(head('Hidden (' + hidden.length + ')')); rows(hidden); }
    return out;
  }

  /* ---------- each group's channel order ---------- */
  /* Sort each group (Settings > Channels and groups): the order of the channels in each shown group, the same as Hold
     OK on a group > Sort channels on the TV.  Next event first suits sports and PPV groups.  "As in Settings" follows
     Channel order above; a group whose channels you moved by hand says so and keeps that until it's changed here. */
  function groupSortPage() {
    var out = [], gs = L.allGroups().filter(function (g) { return !g.hidden && g.id !== L.FAV; });
    var vals = ['', 'event', 'provider', 'az', 'za', 'number'], labels = ['As in Settings', 'Next event first', 'Provider order', 'A to Z', 'Z to A', 'Channel number'];
    out.push(info('Next event first puts what\'s on now first, then what starts soonest, and channels with nothing on last: for sports and PPV groups.', ''));
    out.push(head('Shown groups (' + gs.length + ')'));
    gs.forEach(function (g) {
      var mine = L.sortOf(g.id) === 'custom';
      out.push(choice(I18n.raw(L.groupName(g.id)), mine ? 'Your own order now (channels you moved)' : '', mine ? vals.concat('custom') : vals, mine ? labels.concat('Your order') : labels,
        function () { return L.sortOf(g.id); }, function (v) { L.setSort(g.id, v); relist(); build(); }));
    });
    return out;
  }

  /* ---------- merge groups: tick several, then show them as one ---------- */
  var mergePick = {};                         // the groups ticked on the Merge groups page, by id
  /* Merge groups (Settings > Channels and groups): tick provider groups, then merge them into a new group (the first
     one ticked, given the new name), into one of them, or into another group of the same playlist.  The groups
     merged now are listed first, each with Split.  Your own groups aren't merged (they hold channels you picked). */
  function mergePage() {
    var out = [], prov = L.allGroups().filter(function (g) { return !L.isCustom(g.id); });
    var free = prov.filter(function (g) { return !L.mergedInto(g.id); });
    Object.keys(mergePick).forEach(function (id) { if (!free.some(function (g) { return g.id === id; })) delete mergePick[id]; });
    var ticked = free.filter(function (g) { return mergePick[g.id]; });
    var nameOf = function (g) { return L.groupName(g.id); };
    var targets = prov.filter(function (g) { return L.mergedFrom(g.id).length; });
    if (targets.length) {
      out.push(head('Merged now'));
      targets.forEach(function (t) {
        out.push(action('Split ' + nameOf(t), 'Holds ' + L.mergedFrom(t.id).map(function (id) { return L.groupName(id); }).join(', ') + '.  Split puts them back as they were.', function () {
          // Back as they were, the provider's name too (a merge into a new group named it).
          var was = nameOf(t); L.splitGroup(t.id); L.setGroupName(t.id, ''); relist(); build(); U.toast(was + ' split');
        }));
      });
    }
    out.push(head('Merge the ticked groups (' + ticked.length + ')'));
    if (!ticked.length) out.push(info('Tick the groups to merge below, then choose here where they go.', ''));
    else {
      out.push(action('Into a new group…', 'Name it, and the ticked groups show as that one group.', function () {
        UI.prompt('Name for the merged group', '', function (n) { if (n && n.trim()) mergeTicked(ticked[0], ticked, n.trim()); }, 'Typing is easier from the phone app.');
      }));
      if (ticked.length > 1) out.push(action('Into one of them…', 'Pick which ticked group the others go into.', function () {
        UI.menu('Merge into', ticked.map(function (g) { return { label: I18n.raw(nameOf(g)), action: function () { mergeTicked(g, ticked, ''); } }; }));
      }));
      out.push(action('Into another group…', 'Pick a group that isn\'t ticked; the ticked ones go into it.', function () {
        var p0 = ticked[0].p || '';
        var others = free.filter(function (g) { return !mergePick[g.id] && (g.p || '') === p0; });
        UI.menu('Merge into', others.map(function (g) { return { label: I18n.raw(nameOf(g)), sub: g.hidden ? 'hidden' : '', action: function () { mergeTicked(g, ticked, ''); } }; }));
      }));
      out.push(action('Clear the ticks', '', function () { mergePick = {}; build(); }));
    }
    var shown = free.filter(function (g) { return !g.hidden; }), hidden = free.filter(function (g) { return g.hidden; });
    out.push(head('Groups'));
    shown.concat(hidden).forEach(function (g) {
      var on = function () { return !!mergePick[g.id]; }, set = function (v) { if (v) mergePick[g.id] = 1; else delete mergePick[g.id]; build(); };
      out.push({ label: I18n.raw(nameOf(g)), sub: g.hidden ? 'hidden' : '', toggle: true, get: on, set: set,
        value: function () { return on() ? 'Ticked' : ''; }, cycle: function () { set(!on()); } });
    });
    return out;
  }
  /* The ticked groups merged into target (a ticked one or not), which takes the new name when given.  Only groups of
     one playlist go together.  A hidden target is shown again when any shown group went into it. */
  function mergeTicked(target, ticked, name) {
    var p0 = target.p || '';
    if (ticked.some(function (g) { return (g.p || '') !== p0; })) { U.toast('Groups from different playlists can\'t be merged', 5000); return; }
    var n = L.mergeGroups(target.id, ticked.map(function (g) { return g.id; }).filter(function (id) { return id !== target.id; }));
    if (name) L.setGroupName(target.id, name);
    if (target.hidden && ticked.some(function (g) { return !g.hidden; })) L.hideGroup(target.id, false);
    mergePick = {}; relist(); build();
    U.toast(n + (n === 1 ? ' group' : ' groups') + ' merged into ' + L.groupName(target.id));
  }

  /* ---------- channels and groups ---------- */
  function groups() {
    var s = S(), out = [], hid = L.hiddenItems();
    function apply() { Store.saveSettings(); relist(); build(); }
    out.push(page('Manage groups', 'Show or hide each group in one list, like TiviMate.  ' + hid.groups.length + ' hidden now.', 'Manage groups', manageGroups));
    out.push(page('Sort each group', 'The order of the channels in each group, Next event first for sports and PPV included.', 'Sort each group', groupSortPage));
    out.push(page('Rename groups', 'Give any group a name of your own, typed on the TV or the phone.', 'Rename groups', renamePage));
    var merged = L.allGroups().filter(function (g) { return L.mergedFrom(g.id).length; }).length;
    out.push(page('Merge groups', 'Tick several groups and show them as one: in a new group, one of them or another group.' + (merged ? '  ' + merged + ' merged now.' : ''), 'Merge groups', mergePage));
    out.push(toggle('Show hidden items in lists', 'Hidden groups and channels appear dimmed so you can unhide them from their menu.', function () { return s.showHidden; }, function (v) { s.showHidden = v; apply(); }));
    out.push(head('Sorting'));
    out.push(choice('Channel order', 'For provider groups and All channels.  Your own groups keep the order you set.', ['playlist', 'number', 'name', 'watch'], ['Playlist order', 'Channel number', 'Name', 'Most watched'], function () { return s.sortChannels; }, function (v) { s.sortChannels = v; apply(); }));
    out.push(choice('Group order', 'Groups you moved by hand stay where you put them.', ['playlist', 'name'], ['Playlist order', 'Name'], function () { return s.sortGroups; }, function (v) { s.sortGroups = v; apply(); }));
    out.push(toggle('Your groups first', 'Favorites and your groups above the provider groups.', function () { return s.favFirst; }, function (v) { s.favFirst = v; apply(); }));
    function inList() {
      var out = [];
      out.push(toggle('Show All channels', '', function () { return s.showAll; }, function (v) { s.showAll = v; apply(); }));
      out.push(toggle('Show Recent channels', '', function () { return s.showRecent; }, function (v) { s.showRecent = v; apply(); }));
      out.push(choice('Recent channels kept', '', [10, 20, 30, 50], ['10', '20', '30', '50'], function () { return +s.recentCount; }, function (v) { s.recentCount = v; save(); }));
      out.push(toggle('Show Favorites group', '', function () { return s.showFav !== false; }, function (v) { s.showFav = v; apply(); }));
      out.push(toggle('Show Movies on now', 'A group of the movies on now, most left first, then the ones starting within the hour.  Needs a TMDB token (Settings > API keys).',
        function () { return s.moviesGroup !== false; }, function (v) { s.moviesGroup = v; apply(); if (typeof Movies !== 'undefined') Movies.poke(); }));
      if (Events.onAny()) out.push(toggle('Show Events by time', 'The group of event channels on now or starting in the next two weeks, soonest first.  The same switch as in Event channels.',
        // Several playlists on: the same switch for each of them (each playlist's Event channels page has its own).
        function () { return Events.groupOnAny(); }, function (v) { Store.loaded().forEach(function (p) { p.events = Object.assign({}, p.events, { group: v }); Store.upsertPlaylist(p); }); Events.reset(); apply(); }));
      out.push(choice('Recently added channels', 'A group of channels that are new in your playlist since it last loaded, newest first, with a NEW tag in the lists.', [0, 3, 7, 14], ['Off', '3 days', '7 days', '14 days'], function () { return s.newDays == null ? 7 : +s.newDays; }, function (v) { s.newDays = v; L.dirty(); apply(); }));
      out.push(choice('Groups your provider adds later', 'Hide keeps a tidy list tidy after "Hide all groups".', ['show', 'hide'], ['Show them', 'Hide them'], function () { return s.newGroups === 'hide' ? 'hide' : 'show'; }, function (v) { s.newGroups = v; save(); }));
      out.push(toggle('All channels includes hidden groups', 'Channels from groups you hid still appear in All channels.', function () { return !!s.allHidden; }, function (v) { s.allHidden = v; apply(); }));
      return out;
    }
    out.push(page('Groups in the list', 'All channels, Recent, Favorites, Movies on now, events by time and new channels: which show, and how.', 'Groups in the list', inList));
    out.push(link('My teams', 'Your teams, their scores while you watch, alerts and the My teams group: Settings > Sports.', 'sports', function () { var n = Teams.followed().length; return n ? n + ' ›' : '›'; }));
    out.push(page('Event channels', 'Pay-per-view and league pass channels whose names carry the game and its time: read into the guide.', 'Event channels', function () { return eventsPage(Store.playlist); }, function () { var ev = Store.playlist.events; return ev && ev.on === false ? 'Off' : 'On'; }));
    out.push(action('Reset watch time', 'Clears the "Most watched" statistics.', function () { UI.confirm('Reset watch time for every channel?', 'Reset', function () { Store.edits.watch = {}; Store.saveEdits(); relist(); U.toast('Watch time reset'); }); }));
    // Lists that can run to hundreds of rows (your groups, what's hidden) are pages of their own, so this
    // page stays short enough to scroll past them, on the TV and in the phone app.
    out.push(head('Your groups'));
    out.push(action('New group…', 'Then hold OK on any channel and choose Copy to group.', function () {
      UI.prompt('Name the new group', '', function (n) { if (n.trim()) { L.createGroup(n); relist(); build(); } });
    }));
    out.push(page('Your groups', 'Rename, move, empty or delete them.', 'Your groups', yourGroups, function () { return L.customGroups().length + ' ›'; }));
    out.push(head('Hidden'));
    out.push(page('Hidden groups', hid.groups.length ? 'Restore them one by one, or all at once.' : 'None hidden.', 'Hidden groups', hiddenGroupsPage, function () { return L.hiddenItems().groups.length + ' ›'; }));
    out.push(page('Hidden channels', hid.channels.length ? 'Restore them one by one, or all at once.' : 'None hidden.', 'Hidden channels', hiddenChannelsPage, function () { return L.hiddenItems().channels.length + ' ›'; }));
    tidyRows(out);
    out.push(head('Reset'));
    out.push(action('Clear all edits for this playlist', 'Removes your groups, renames, guide assignments and hidden items.', function () {
      UI.confirm('Clear every group, rename and hidden item for this playlist?', 'Clear all edits', function () { Store.resetEdits(); relist(); build(); });
    }));
    return out;
  }

  function yourGroups() {
    var out = [];
    out.push(action('New group…', 'Then hold OK on any channel and choose Copy to group.', function () {
      UI.prompt('Name the new group', '', function (n) { if (n.trim()) { L.createGroup(n); relist(); build(); } });
    }));
    L.customGroups().forEach(function (g) {
      out.push(action(I18n.raw(g.name), g.items.length + ' channels', function () {
        UI.menu(I18n.raw(g.name), [
          g.id !== L.FAV && { label: 'Rename…', action: function () { UI.prompt('Rename group', g.name, function (n) { L.renameGroup(g.id, n); relist(); build(); }); } },
          { label: 'Move up', action: function () { L.moveGroup(g.id, -1); relist(); build(); } },
          { label: 'Move down', action: function () { L.moveGroup(g.id, 1); relist(); build(); } },
          { label: 'Empty this group', action: function () { g.items = []; Store.saveEdits(); relist(); build(); } },
          g.id !== L.FAV && { label: 'Delete group', action: function () { UI.confirm('Delete ' + g.name + '?', 'Delete', function () { L.deleteGroup(g.id); relist(); build(); }); } }
        ]);
      }, function () { return Store.edits.hiddenGroups[g.id] ? 'hidden' : ''; }));
    });
    return out;
  }
  function hiddenGroupsPage() {
    var out = [], hid = L.hiddenItems();
    if (!hid.groups.length) return [info('No hidden groups', '')];
    out.push(action('Restore all groups', hid.groups.length + ' hidden', function () { hid.groups.forEach(function (g) { L.hideGroup(g.id, false); }); relist(); build(); }));
    out.push(head(''));
    hid.groups.forEach(function (g) { out.push(action(I18n.raw(g.name), '', function () { L.hideGroup(g.id, false); U.toast(g.name + ' restored'); relist(); build(); }, function () { return 'Restore'; })); });
    return out;
  }
  function hiddenChannelsPage() {
    var out = [], hid = L.hiddenItems();
    if (!hid.channels.length) return [info('No hidden channels', '')];
    out.push(action('Restore all channels', hid.channels.length + ' hidden', function () { hid.channels.forEach(function (c) { L.hideChannel(c.k, false); }); relist(); build(); }));
    out.push(head(''));
    hid.channels.forEach(function (c) { out.push(action(I18n.raw(L.name(c)), I18n.raw(L.groupName(c.g)), function () { L.hideChannel(c.k, false); U.toast(L.name(c) + ' restored'); relist(); build(); }, function () { return 'Restore'; })); });
    return out;
  }
  /* The set-up tour's clean-up steps, one at a time, any time (they were only in the tour): each opens that
     step and its summary, and Apply hides only what that step says.  On the phone each is a page. */
  var TIDY = [['countries', 'Keep the countries you watch', 'Hide the groups of countries you never watch.'],
    ['feeds', 'East or West feeds', 'Channels that come twice, on East and West time: keep the one you watch.'],
    ['locals', 'Your local channels', 'Keep your city\'s stations, together in one Local channels group.'],
    ['clutter', 'Clear the clutter', 'Divider and empty groups, extra copies of the same channel, groups with words you pick.']];
  function tidyRows(out) {
    var p = Store.playlist;
    out.push(head('Tidy up'));
    TIDY.forEach(function (t) {
      var it = action(t[1], t[2], function () { Tour.open({ from: 'settings', pl: p.id, only: t[0] }); }, function () { return '›'; });
      it.phonePage = { title: t[1], fn: function () { return Tour.phoneRows(p.id, t[0]); } };
      out.push(it);
    });
  }

  /* ---------- My teams (app/js/teams.js) ---------- */
  /* Sports (app/js/teams.js, sports.js, sportslive.js): your teams first, then what shows while you watch,
     then the My teams group in the guide, then the Sports screen.  Its own section so it's easy to find on the
     TV, the phone and the web editor (it used to be a page inside Channels and groups). */
  function teamsPage() {
    var s = S(), out = [], lgs = Teams.leagues(), mine = Teams.followed();
    function apply() { Teams.dirty(); Store.saveSettings(); relist(); paint(); }
    out.push(head('Your teams'));
    if (!lgs.length) out.push(info('No NFL, NBA, NHL, MLB, WNBA, MLS, college football or college basketball channels found in this playlist.', ''));
    lgs.forEach(function (lg) {
      var n = Teams.inLeague(lg.id).filter(function (x) { return Teams.follows(x.id); }).length;
      out.push(page(lg.name, lg.own ? lg.own + ' teams have their own channel' : 'Games only, no team channels', I18n.raw(I18n.t('{x} teams', { x: I18n.t(lg.name) })), function () { return leaguePage(lg.id); },
        function () { return n ? n + ' followed ›' : '›'; }));
    });
    mine.forEach(function (x) {
      out.push(action(I18n.raw(x.name), x.league.toUpperCase() + (Teams.hasChannel(x.id) ? '' : '   ·   no channel of its own here, games only'), function () {
        Teams.follow(x.id, false); U.toast('Stopped following the ' + x.name); relist(); build();
      }, function () { return 'Unfollow'; }));
    });
    out.push(info('The main North American leagues (NFL, NBA, NHL, MLB, WNBA and MLS), college football (the FBS schools) and men\'s college basketball (those schools and the main Division I ones without FBS football).  Other college sports, women\'s college games, junior and minor league teams, and other countries\' leagues, aren\'t in it yet.', ''));
    out.push(head('While you watch'));
    out.push(toggle('My teams\' scores while watching', 'While you watch something else full screen, a live game of a team you follow shows its score in a corner of the screen, kept up to date (several take turns).  Not the game you\'re watching: its broadcast has its own.',
      function () { return s.sportsBar !== false; }, function (v) { s.sportsBar = v; Store.saveSettings(); paint(); }));
    if (s.sportsBar !== false) out.push(choice('Where the scores go', 'The corner of the screen.  Pick one your channels\' own logos and scores don\'t use.', ['tl', 'tr', 'bl', 'br'], ['Top left', 'Top right', 'Bottom left', 'Bottom right'],
      function () { return /^(tl|tr|bl|br)$/.test(s.sportsBarAt || '') ? s.sportsBarAt : 'tr'; }, function (v) { s.sportsBarAt = v; Store.saveSettings(); paint(); }));
    out.push(toggle('Alerts for my teams', 'A close game near the end asks whether to switch to it, and a final score says so, wherever you are in TiviBro.  Never for the game you\'re watching.',
      function () { return s.sportsAlerts !== false; }, function (v) { s.sportsAlerts = v; Store.saveSettings(); paint(); }));
    if (mine.length) out.push(page('Hide scores', (s.sportsHide || []).length ? (s.sportsHide || []).length + ' team(s): no scores anywhere until you show them' : 'For a team you\'ll watch later: no scores anywhere until you show them', 'Hide scores', function () {
      return [info('A team\'s scores stay hidden in Sports, the corner while you watch and alerts.  On a game\'s page, Show the score shows that one.', '')].concat(mine.map(function (t) {
        return toggle(I18n.raw(t.name), '', function () { return Sports.hidesTeam(t.id); }, function (v) { Sports.hideTeam(t.id, v); paint(); });
      }));
    }));
    out.push(head('In the guide'));
    out.push(toggle('Show the My teams group', 'Near the top of the guide: their games on now at the top, then the ones starting within the time below.  A team\'s own channel is there while it shows a game.',
      function () { return s.teamsGroup !== false; }, function (v) { s.teamsGroup = v; apply(); }));
    out.push(choice('Games starting within', 'How soon a game has to start to be in the group.', [3, 6, 12, 24], ['3 hours', '6 hours', '12 hours', '24 hours'],
      function () { return +s.teamsAhead || 6; }, function (v) { s.teamsAhead = v; apply(); }));
    out.push(toggle('Remind me before their games', 'Like the watchlist: how far ahead it looks, and a reminder or just a message, are set in Settings > Reminders and watchlist > Watchlist.',
      function () { return !!s.teamsRemind; }, function (v) {
        s.teamsRemind = v;
        if (!v) { Store.edits.reminders = Store.edits.reminders.filter(function (r) { return !/^team:/.test(r.w || ''); }); Store.saveEdits(); }
        Store.saveSettings(); if (v) Watch.scan(false); paint();
      }));
    out.push(head('Sports screen'));
    out.push(toggle('Sports in the menu', 'A screen of today\'s games with their scores and team logos (from ESPN), your teams first, and which of your channels has each one.  Blue on it picks the leagues.',
      function () { return s.sportsTab !== false; }, function (v) { s.sportsTab = v; Store.saveSettings(); Views.buildTabs(); paint(); }));
    return out;
  }
  function leaguePage(lg) {
    var out = [];
    out.push(info('Tick the teams you follow.  Teams with their own channel in this playlist say so.', ''));
    Teams.inLeague(lg).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (x) {
      out.push(toggle(I18n.raw(x.name), Teams.hasChannel(x.id) ? 'Has its own channel' : '', function () { return Teams.follows(x.id); }, function (v) {
        Teams.follow(x.id, v); relist();
        if (v && Store.settings.teamsRemind) Watch.scan(true);
        paint();
      }));
    });
    return out;
  }
  // Straight to My teams (the My teams group's menu).
  function openTeams() {
    Views.switchTab('settings');
    if (Views.tab !== 'settings') return;
    section('sports');
  }

  /* ---------- the guide: how it's built, then the playlist in use's guide settings ---------- */
  function guide() {
    var s = S(), p = Store.playlist, out = [];
    out.push(head('How your guide is built, in this order'));
    out.push(info('1.  Your provider\'s guide.', ''));
    out.push(info('2.  Your own guide sources, the first one first.  They fill the channels your provider\'s guide leaves empty, and take over one it has only where their programmes agree.', ''));
    out.push(info('3.  Public fill-in, only for channels nothing else covers: epg.pw, iptv-epg.org, epgshare01, and the Pluto TV, Samsung TV Plus, Plex and Roku guides from i.mjh.nz for their channels.', ''));
    out.push(info('4.  Matching: each channel is linked to a guide channel by its guide id, then its name.  A wrong one: Hold OK > Assign guide.', ''));
    out.push(info('A channel that will never have a guide (a radio stream, a camera, an event slot): Hold OK > No guide for this channel.  It drops out of matching and stops saying "No guide information".  The web editor\'s Guide page does many at once (Ignore).', ''));
    out.push(head(I18n.raw(p.name ? I18n.t('Guide for {x}', { x: p.name }) : I18n.t('Guide for this playlist'))));
    out = out.concat(guideRows(p));
    // Several playlists on: each other one's guide, a page each (the same rows as on its own page).
    Store.others().filter(function (q) { return L.otherIds().indexOf(q.id) >= 0; }).forEach(function (q, i) {
      if (!i) out.push(head('The other playlists\' guides'));
      out.push(page(I18n.raw(I18n.t('Guide for {x}', { x: q.name || I18n.t('playlist') })), (q.type === 'xtream' ? { short: 'Per channel', xmltv: 'Full XMLTV file', off: 'Provider guide off' } : { xmltv: 'From playlist', off: 'Provider guide off' })[q.providerEpg] + ', ' + (q.epgSources || []).length + ' source(s), public fill-in ' + (PubEpg.conf(q).on ? 'on' : 'off'),
        'Guide: ' + (q.name || 'playlist'), function () { return guideRows(q); }));
    });
    out.push(head('How it looks'));
    out.push(choice('OK on a channel in the Guide', 'Preview first works like TiviMate: the first OK plays it in the corner window, the second goes fullscreen.',
      ['preview', 'full'], ['Preview first, then fullscreen', 'Fullscreen right away'], function () { return s.guideOk === 'full' ? 'full' : 'preview'; }, function (v) { s.guideOk = v; save(); }));
    out.push(choice('Guide row size', 'A little taller rows with bigger channel names and titles, for smaller TVs or reading from across the room.  One channel fewer fits at once.', ['m', 'l', 'xl'], ['Normal', 'Bigger', 'Biggest'],
      function () { return s.guideRows || 'm'; }, function (v) { s.guideRows = v; Views.applyLook(); if (window.Guide && Guide.resize) Guide.resize(); save(); }));
    out.push(toggle('Two-line programmes', 'Shows each programme\'s time under its title in the grid.', function () { return s.guideLines !== 1; }, function (v) { s.guideLines = v ? 2 : 1; Views.applyLook(); save(); }));
    out.push(toggle('Dim past programmes', '', function () { return s.dimPast; }, function (v) { s.dimPast = v; Views.applyLook(); save(); }));
    out.push(choice('Mark what\'s on now', 'How the guide shows programmes airing right now.', ['line', 'fill', 'color'], ['Line and shade', 'Line, shade and progress bar', 'Coloured cell, shade and bar'], function () { return s.nowStyle === 'fill' || s.nowStyle === 'color' ? s.nowStyle : 'line'; }, function (v) { s.nowStyle = v; Views.applyLook(); save(); }));
    out.push(toggle('Colour by category', 'A coloured bar on movies, sports, news and kids\' programmes, from what your guide says each programme is, or its title or channel.  Anything else stays plain.',
      function () { return !!s.guideTint; }, function (v) { s.guideTint = v; save(); if (window.Guide && Guide.draw) Guide.draw(); }));
    out.push(toggle('Channel names in the guide', 'Off shows logos only, leaving more room.', function () { return s.guideNames !== false; }, function (v) { s.guideNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Two-line channel names', 'Long names wrap instead of being cut off.', function () { return !!s.twoLineNames; }, function (v) { s.twoLineNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Mark catch-up channels', 'Shows ↺ on channels and programmes you can replay.', function () { return s.showCatchupMark !== false; }, function (v) { s.showCatchupMark = v; save(); relist(); }));
    return out;
  }

  /* ---------- Movies and shows: the Movies and Shows screens, and TMDB details for them and the guide ---------- */
  function vodSettings() {
    var s = S(), out = [];
    out.push(choice('Movies and Shows open on', 'Home: the title you\'re on large at the top, with poster shelves (Continue watching, My list, Recently added, TMDB\'s lists of your provider\'s titles, and the categories you pin).  Green there opens all categories.  Categories: the list of categories, as before.',
      ['home', 'list'], ['Home', 'Categories'], function () { return s.vodHome === false ? 'list' : 'home'; }, function (v) { s.vodHome = v === 'home'; save(); }));
    out.push(choice('Order movies and shows', 'In each category, My list and the home\'s category shelves.  All movies and All shows are newest first in the provider\'s order.  Recently added is always newest first.  Red on the home too.',
      ['provider', 'added', 'name', 'year', 'rating'], ['The provider\'s order', 'Recently added first', 'Name (A–Z)', 'Release year (newest first)', 'Rating (highest first)'],
      function () { return s.vodSort || 'provider'; }, function (v) { s.vodSort = v; save(); if (typeof VodHome !== 'undefined') VodHome.changed(); }));
    out.push(toggle('Reverse the order', 'Turns the order round: Z to A, oldest, lowest or added longest ago first.', function () { return !!s.vodSortReverse; }, function (v) { s.vodSortReverse = v; save(); if (typeof VodHome !== 'undefined') VodHome.changed(); }));
    out.push(choice('Count as watched at', 'A movie, an episode or a recording stopped this far in (or in its last minute) is marked watched and leaves Continue watching.  Plex uses 90%.',
      ['85', '90', '95', '98'], ['85%', '90% (as Plex)', '95%', '98%'], function () { return String(+s.watchedAt || 90); }, function (v) { s.watchedAt = +v; save(); }));
    out.push(choice('Order categories', 'The provider\'s order, or by name from A to Z.  Continue watching, My list and the newest titles stay at the top.',
      ['provider', 'name'], ['The provider\'s order', 'Name (A–Z)'], function () { return s.vodCatSort === 'name' ? 'name' : 'provider'; }, function (v) { s.vodCatSort = v; save(); if (typeof Vod !== 'undefined' && Vod.recats) Vod.recats(); }));
    out.push(choice('Open a category as', 'A list beside the categories, or a full-screen wall of posters (Back goes to the categories).',
      ['list', 'wall'], ['List', 'Posters, full screen'], function () { return s.vodCatWall ? 'wall' : 'list'; }, function (v) { s.vodCatWall = v === 'wall'; save(); }));
    out.push(action('Reload movies and shows now', 'Both lists again from your provider, for titles added since they last loaded.  Your channels stay as they are.  Red on the Movies or Shows home too.', function () { Vod.reloadNow(); }));
    out.push(action('Arrange the Movies home', 'Move its shelves up or down, switch them off, and pin categories.  Red on the Movies home too.', function () { Vod.arrange('movie'); }));
    out.push(action('Arrange the Shows home', 'Move its shelves up or down, switch them off, and pin categories.  Red on the Shows home too.', function () { Vod.arrange('series'); }));
    out.push(autoNextRow());
    out.push(toggle('Hide spoilers', 'In the guide, new episodes and episodes or movies that haven\'t aired yet (not news or sport), and on the Shows screen, episodes you haven\'t started, keep only their title, season and episode, and when they air: no summary, episode title or picture from the episode.',
      function () { return !!s.noSpoilers; }, function (v) { s.noSpoilers = v; save(); if (window.Guide && Guide.draw) Guide.draw(); }));
    out.push(head('Details from TMDB'));
    out.push(toggle('Movie details from TMDB', 'Finds the movies in your guide with your TMDB token: a poster, year, genres and rating in the guide, a Movie tag on them, the Movies on now group and the Movies on now screen.  Only programme titles go to TMDB.',
      function () { return s.guideMovies !== false; }, function (v) { s.guideMovies = v; save(true); if (typeof Movies !== 'undefined') Movies.poke(); }));
    out.push(toggle('Series details from TMDB', 'With your TMDB token, for the series in your guide and on the Shows screen: a poster, when it started, its network, genres and rating, and each episode\'s own title and summary (in the guide when it gives the season and episode).  On the Shows screen it fills in what your provider\'s details leave out.  Only a show\'s name and episode numbers go to TMDB.',
      function () { return s.guideSeries !== false; }, function (v) { s.guideSeries = v; save(true); if (typeof Series !== 'undefined') Series.poke(); }));
    out.push(tmdbLink());
    if (!MediaStore.preferences().tmdbConfigured) out.push(info('Needs a TMDB token: add one under API keys (above), free from themoviedb.org.  The same token gives My media its posters.', ''));
    return out;
  }

  /* ---------- reminders and watchlist ---------- */
  function reminders() {
    var s = S(), out = [], rem = Remind.list();
    out.push(choice('Remind me before start', '', [0, 1, 2, 5, 10], ['At start', '1 min', '2 min', '5 min', '10 min'], function () { return +s.remindBefore; }, function (v) { s.remindBefore = v; save(); }));
    out.push(choice('When a reminder starts', '', ['ask', 'switch'], ['Ask me', 'Switch to the channel'], function () { return s.remindAction === 'switch' ? 'switch' : 'ask'; }, function (v) { s.remindAction = v; save(); }));
    out.push(choice('Reminder question stays for', 'Then it closes by itself, in TiviBro and on the TV\'s own alert when TiviBro isn\'t on screen.', [10, 20, 30, 60], ['10s', '20s', '30s', '1 min'], function () { return +s.remindTimeout || 10; }, function (v) { s.remindTimeout = v; save(); }));
    out.push(toggle('Hold notices during movies', 'Watchlist finds and the like wait while a movie or episode plays full screen, and show when you stop or leave full screen.  Reminders you set still come on time.', function () { return s.holdNotices !== false; }, function (v) { s.holdNotices = v; save(); }));
    out.push(head('Watchlist'));
    out.push(page('Watchlist', 'Shows, teams and names to look for in the guide.  TiviBro sets a reminder when one is coming up.', 'Watchlist', watchlist, function () { var n = Watch.list().length; return n ? n + ' ›' : '›'; }));
    out.push(head('Coming up  (' + rem.length + ')'));
    if (!rem.length) out.push(info('No reminders.  Pick a future programme in the Guide and press OK, or add to the watchlist.  The phone app and the web editor list them too.', ''));
    rem.forEach(function (r) {
      out.push(action(r.t ? I18n.raw(r.t) : 'Programme', U.day(r.s) + ' ' + U.hhmm(r.s) + '   ' + r.ch + (r.live ? '   on now' : '') + (r.w ? '   from your watchlist: ' + r.w.replace(/^team:/, 'team ') : ''), function () {
        UI.confirm('Cancel the reminder for ' + (r.t || 'this programme') + '?', 'Cancel the reminder', function () { Remind.cancel(r.k, r.s); U.toast('Reminder cancelled'); build(); });
      }, function () { return 'Cancel'; }));
    });
    if (rem.length > 1) out.push(action('Cancel all reminders', rem.length + ' set', function () {
      UI.confirm('Cancel all ' + rem.length + ' reminders?', 'Cancel them all', function () { Remind.clear(); U.toast('All reminders cancelled'); build(); });
    }));
    return out;
  }

  function langName(code, none) { if (code === 'orig') return 'Original language'; for (var i = 0; i < U.LANGS.length; i++) if (U.LANGS[i][0] === code) return U.LANGS[i][1]; return none || code || ''; }
  // orig: also "Original language" (Audio language: each movie's own, never a dub or a commentary).
  function langMenu(title, noneLabel, cur, set, orig) {
    UI.menu(title, [{ label: noneLabel, sub: !cur ? 'on' : '', action: function () { set(''); } }]
      .concat(orig ? [{ label: 'Original language', sub: cur === 'orig' ? 'on' : 'the movie or show\'s own: no dub, no commentary', action: function () { set('orig'); } }] : [])
      .concat(U.LANGS.map(function (l) { return { label: l[1], sub: cur === l[0] ? 'on' : '', action: function () { set(l[0]); } }; })));
  }
  function watchlist() {
    var s = S(), out = [], words = Watch.list();
    out.push(action('Add a show, team or name…', 'Matched as whole words in programme titles: "Cars" does not find "Oscars".  Yellow in Search adds what you typed.', function () {
      UI.prompt('Look for', '', function (v) { if (Watch.add(v)) build(); }, 'For example Yankees, Bluey, Premier League or Gordon Ramsay');
    }));
    out.push(choice('Look ahead', 'How far into the guide to look.', [6, 12, 24, 48], ['6 hours', '12 hours', '24 hours', '2 days'], function () { return +s.watchAhead || 24; }, function (v) { s.watchAhead = v; save(); Watch.scan(true); build(); }));
    out.push(choice('When something is found', '', ['remind', 'tell'], ['Set a reminder', 'Just tell me'], function () { return s.watchAction === 'tell' ? 'tell' : 'remind'; }, function (v) { s.watchAction = v; save(); }));
    if (!Epg.xml) out.push(info('Tip: with only the provider\'s per-channel guide, TiviBro only knows programmes on channels you have looked at.  An XMLTV guide (Settings > Guide: the full provider guide or a guide source) lets the watchlist see every channel.', ''));
    if (!words.length) { out.push(info('Nothing on your watchlist yet.', '')); return out; }
    out.push(head('Your watchlist'));
    words.forEach(function (w) {
      var n = Watch.upcoming(w.q).length;
      out.push(action(I18n.raw(w.q), n ? n + ' coming up' : 'nothing coming up yet', function () {
        UI.menu(I18n.raw(w.q), [
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
        out.push(action(I18n.raw(r.p.t), U.day(r.p.s) + ' ' + U.hhmm(r.p.s) + '   ' + L.name(r.c), function () {
          var rem = Store.edits.reminders, i = rem.findIndex(function (x) { return x.k === r.c.k && x.s === r.p.s; });
          if (i >= 0) { rem.splice(i, 1); Store.edits.watchSeen = Store.edits.watchSeen || {}; Store.edits.watchSeen[r.p.t.toLowerCase() + '|' + r.p.s] = r.p.e; U.toast('Reminder cancelled'); } else { rem.push({ k: r.c.k, s: r.p.s, e: r.p.e, t: r.p.t, w: r.w, g: /^team:/.test(r.w || '') ? 1 : undefined }); U.toast('Reminder set'); }
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
  // The group the lists open on (Lists open on > A group I pick): any group shown, Favorites and All channels too.
  function pickOpenGroup() {
    var s = S(), gs = L.groups().filter(function (g) { return !g.head && !g.hidden; });
    UI.menu('Group to open on', gs.map(function (g) {
      return { label: I18n.raw(g.name), sub: L.channels(g.id).length + ' channels', current: g.id === s.openGroup, action: function () { s.openGroup = g.id; s.openOn = 'group'; save(); build(); } };
    }));
  }
  function look() {
    var s = S(), out = [];
    out.push(choice('Burn-in protection', 'For OLED TVs left on the guide or a menu: every 90 seconds the screen moves a few pixels, and after 10 minutes without a key press it dims until you press one.  Fullscreen video is left alone.',
      ['on', 'shift', 'off'], ['Pixel shift and dimming', 'Pixel shift only', 'Off'], function () { return s.burnin === 'shift' || s.burnin === 'off' ? s.burnin : 'on'; }, function (v) { s.burnin = v; save(); if (typeof Burnin !== 'undefined') Burnin._tick(); }));
    out.push(head('Start and navigation'));
    out.push(choice('Start screen', 'What TiviBro opens on, and where Back from other screens leads.', ['guide', 'live'], ['Guide', 'Channels screen'],
      function () { return s.startTab === 'live' ? 'live' : 'guide'; }, function (v) { s.startTab = v; save(); Views.buildTabs(); }));
    // Where the lists open (views.js startGroup): where you left off, the top of the first group, or a group you pick.
    out.push(choice('Lists open on', 'Where the selection is when TiviBro opens: the group and channel you were on last, the top of the first group, or the top of a group you pick.',
      ['last', 'first', 'group'], ['Where I left off', 'The first group', 'A group I pick'], function () { return s.openOn === 'first' || s.openOn === 'group' ? s.openOn : 'last'; },
      function (v) { s.openOn = v; save(); if (v === 'group' && !s.openGroup) pickOpenGroup(); else build(); }));
    if (s.openOn === 'group') out.push(action('Group to open on', 'TiviBro opens on the top of this group.', pickOpenGroup, function () { var g = s.openGroup && L.groups().filter(function (x) { return x.id === s.openGroup; })[0]; return g ? I18n.raw(g.name) : 'Pick one'; }));
    out.push(toggle('Channels screen in the menu', s.startTab === 'live' ? 'Always there while TiviBro starts on it.' : 'The plain list of channels, without the guide.  Off, it stays one press away: Green in the guide.',
      function () { return s.startTab === 'live' || s.channelsTab === true; }, function (v) { if (s.startTab === 'live') { U.toast('TiviBro starts on the Channels screen, so it stays in the menu'); return; } s.channelsTab = v; save(); Views.buildTabs(); }));
    out.push(toggle('Turn on last channel at launch', '', function () { return s.resumeLast; }, function (v) { s.resumeLast = v; save(); }));
    out.push(toggle('Preview on the Channels screen', 'Plays the channel you rest on.  Turn off on very slow TVs for the snappiest list.', function () { return s.previewPlay; }, function (v) { s.previewPlay = v; save(); }));
    out.push(toggle('Press Back twice to exit', 'Then the TV asks whether to exit.', function () { return s.exitTwice; }, function (v) { s.exitTwice = v; save(); }));
    out.push(head('Colours and text'));
    out.push(choice('Clock', 'How times show everywhere in TiviBro: the guide, the info panel, reminders.  Automatic follows the TV\'s region.', ['auto', '12', '24'], ['Automatic', '12 hours (7:30pm)', '24 hours (19:30)'],
      function () { return s.clock === '12' || s.clock === '24' ? s.clock : 'auto'; }, function (v) { s.clock = v; save(); if (window.Guide && Guide.draw) Guide.draw(); relist(); }));
    var PIDS = [''].concat(Object.keys(Views.PALETTES)), PNAMES = ['Your own mix'].concat(Object.keys(Views.PALETTES).map(function (k) { return Views.PALETTE_NAMES[k]; }));
    var th = choice('Theme', 'Every colour at once: Black and white, Tokyo Night, Dracula, Nord, Gruvbox and more.  Your own mix: choose a background and an accent below.', PIDS, PNAMES,
      function () { return Views.PALETTES[s.palette] ? s.palette : ''; }, function (v) { s.palette = v; Views.applyLook(); save(true); });
    th.swatch = function () { var p = Views.palette(s.palette); return p ? p.accent : s.accent; };
    out.push(th);
    if (Views.PALETTES[s.palette]) {
      out.push(info('Background and accent', 'From the theme'));
    } else {
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
      // Each hue with a plain name next to its number (discussion #36): "210°  Azure".
      var HUE_NAMES = ['Red', 'Vermilion', 'Red-orange', 'Orange', 'Amber', 'Gold', 'Yellow', 'Lemon-lime', 'Chartreuse', 'Lime', 'Bright green', 'Leaf green',
        'Green', 'Kelly green', 'Emerald', 'Spring green', 'Mint', 'Aquamarine', 'Cyan', 'Sky cyan', 'Sky blue', 'Azure', 'Cornflower', 'Royal blue',
        'Blue', 'Indigo', 'Blue violet', 'Violet', 'Purple', 'Orchid', 'Magenta', 'Fuchsia', 'Hot pink', 'Rose', 'Raspberry', 'Crimson'];
      for (var h = 0; h < 360; h += 10) { hues.push(h); hueNames.push(h + '°  ' + HUE_NAMES[h / 10]); }
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
    }
    out.push(choice('Focus style', 'How the selected item stands out.  Outline adds a white ring, easier to spot from across the room.', ['fill', 'ring'], ['Filled', 'Filled with outline'], function () { return s.focusStyle || 'fill'; }, function (v) { s.focusStyle = v; Views.applyLook(); save(); }));
    out.push(choice('Text size', 'Guide and channel lists.', ['s', 'm', 'l'], ['Small', 'Medium', 'Large'], function () { return s.textSize || 'm'; }, function (v) { s.textSize = v; Views.applyLook(); save(); }));
    out.push(choice('Panels over video', 'How see-through the info panel, quick menu and channel guide are in fullscreen.', ['l', 'm', 'h'], ['Solid', 'Normal', 'See-through'], function () { return s.overlay || 'm'; }, function (v) { s.overlay = v; Views.applyLook(); save(); }));
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
    out.push(choice('Numbers', 'Even width lines up channel numbers and times and keeps the buffer info steady.  Fixed width also crosses the zero.', ['tv', 'even', 'mono'], ['TV font', 'Even width', 'Fixed width, slashed zero'], function () { return s.numFont || 'tv'; }, function (v) { s.numFont = v; Views.applyLook(); save(); }));
    out.push(toggle('Show clock', '', function () { return s.showClock; }, function (v) { s.showClock = v; Views.applyLook(); save(); }));
    out.push(toggle('Show the date with the clock', '', function () { return !!s.clockDate; }, function (v) { s.clockDate = v; UI.clock(); save(); }));
    out.push(toggle('Show channel numbers', '', function () { return s.showNumbers; }, function (v) { s.showNumbers = v; Store.saveSettings(); relist(); build(); }));
    out.push(choice('Info panel stays for', '', [3, 5, 8, 12], ['3s', '5s', '8s', '12s'], function () { return +s.osdTimeout; }, function (v) { s.osdTimeout = v; save(); }));
    return out;
  }

  /* Content filter (filter.js): separate from the PIN, so it comes first. */
  function filterRows(out) {
    var f = Filter.conf();
    out.push(head('Content filter'));
    out.push(toggle('Hide adult channels', 'Channels and groups named Adult, XXX, 18+, Porn, Erotic and the like, in several languages ("Adult Swim" stays).  Gone from the guide, every list, Search and the phone app.  No PIN needed.',
      function () { return !!Filter.conf().adult; }, function (v) { Filter.setAdult(v); Views.filterChanged(); build(); }));
    out.push(action('Add a word or call sign…', 'Hides every channel and group with it in the name, as a whole word: "WXYZ", "Shopping".', function () {
      UI.prompt('Hide channels and groups with this word', '', function (w) { if (!w.trim()) return; Filter.addWord(w); Views.filterChanged(); build(); U.toast(Filter.last.channels + ' channels and ' + Filter.last.groups + ' groups left out now', 5000); },
        'A word, a call sign or a few words together.  Upper or lower case doesn\'t matter.');
    }, function () { return '›'; }));
    // What the filter hides by name: a page of its own when there's more than a few (it can be a long list).
    var fl = function () { var g = Filter.conf(), o = [];
      (g.words || []).forEach(function (w) { o.push(action('Word: ' + w, 'Select to stop hiding it', function () { Filter.remove('words', w); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
      (g.groups || []).forEach(function (n) { o.push(action('Group: ' + n, 'Hidden with the filter.  Select to bring it back', function () { Filter.remove('groups', n); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
      (g.chans || []).forEach(function (n) { o.push(action('Channel: ' + n, 'Hidden with the filter.  Select to bring it back', function () { Filter.remove('chans', n); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
      return o; };
    var nf = (f.words || []).length + (f.groups || []).length + (f.chans || []).length;
    if (nf > 3) out.push(page('Words, groups and channels in the filter', 'Select one to stop hiding it.', 'In the filter', function () { var o = fl(); return o.length ? o : [info('Nothing in the filter', '')]; }, function () { var g = Filter.conf(); return ((g.words || []).length + (g.groups || []).length + (g.chans || []).length) + ' ›'; }));
    else fl().forEach(function (x) { out.push(x); });
    var l = Filter.last;
    out.push(info('Left out of this playlist', Filter.active() ? l.channels.toLocaleString() + ' channels, ' + l.groups.toLocaleString() + ' groups' : 'nothing, the filter is off'));
    out.push(info('Hide a channel or group while watching', 'Its options (Red, or hold OK) > Hide with the content filter'));
    out.push(head('PIN'));
  }
  function parental() {
    var s = S(), out = [], on = Parental.enabled();
    filterRows(out);
    out.push(action(on ? 'Change PIN' : 'Set a PIN', 'Then hold OK on a channel or group and choose Block.', function () { Parental.change(build); }));
    if (!on) return out;
    out.push(choice('PIN required for', '', ['channels', 'settings', 'both'], ['Blocked channels', 'Settings', 'Both'], function () { return s.pinScope; }, function (v) { s.pinScope = v; save(); }));
    out.push(toggle('Stay unlocked until the app restarts', 'Off asks for the PIN every time.', function () { return s.pinStay; }, function (v) { s.pinStay = v; Parental.lock(); save(); }));
    out.push(action('Lock now', '', function () { Parental.lock(); relist(); U.toast('Locked'); }));
    var e = Store.edits;
    out.push(head('Blocked in this playlist'));
    var blocked = function () { var o = [];
      Object.keys(e.blockedGroups).forEach(function (id) { o.push(action(I18n.raw(L.groupName(id) || id), 'group', function () { L.block('group', id, false); relist(); build(); }, function () { return 'Unblock'; })); });
      Object.keys(e.blockedChannels).forEach(function (k) { var c = L.find(k); if (!c) return; o.push(action(I18n.raw(L.name(c)), 'channel', function () { L.block('channel', k, false); relist(); build(); }, function () { return 'Unblock'; })); });
      return o; };
    var bl = blocked();
    if (!bl.length) out.push(info('Nothing blocked yet', ''));
    else if (bl.length > 3) out.push(page('Blocked groups and channels', 'Select one to unblock it.', 'Blocked', function () { var o = blocked(); return o.length ? o : [info('Nothing blocked yet', '')]; }, function () { return blocked().length + ' ›'; }));
    else bl.forEach(function (x) { out.push(x); });
    out.push(head(''));
    out.push(action('Remove PIN', 'Turns parental controls off.', function () { Parental.remove(build); }));
    return out;
  }

  function diag() {
    var out = [];
    var rp = phoneDoes('editor', action('Report a problem', 'Scan a QR code: your phone fills in a GitHub issue with this TV\'s details and log, logins and server names taken out.  In the phone app it opens the report page there.', function () {
      Diag.openReport();
    }, function () { return '›'; }));
    rp.epage = 'report'; out.push(rp);
    if (Reports.list.length) out.push(page('Your problem reports', 'The reports this TV sent, and whether the developer has answered.  TiviBro also tells you when one gets a reply.', 'Your problem reports', function () {
      // Open ones first, then the closed ones under their own heading (discussion #101).
      var row = function (r) { return action('#' + r.n + '  ' + (r.title || 'Problem report'), 'Sent ' + Reports.when(r.sent) + ' from ' + (r.version || '?') + '.  ' + Reports.statusText(r), function () { Reports.show(r.n); }, function () { return '›'; }); };
      var shut = function (r) { return r.state === 'closed' || r.gone; };
      var o = Reports.list.filter(function (r) { return !shut(r); }).map(row), cl = Reports.list.filter(shut);
      if (!o.length) o.push(head('No open reports'));
      if (cl.length) { o.push(head('Closed')); o = o.concat(cl.map(row)); }
      o.push(action('Check now', 'Asks GitHub, through the report relay, for news on these reports.  Only the report numbers are sent.', function () {
        U.toast('Checking…', 2000);
        Reports.check(true).then(function () { build(); U.toast('Checked', 2000); });
      }));
      return o;
    }));
    out.push(action('Run connection test', 'Checks the helper, login, channel list, a stream and the guide, step by step.', function () { Diag.run(); }));
    out.push(action('Speed test', 'Your internet speed and your provider\'s, and what that is enough for.  Stops playback while it runs.', function () { Diag.speedTest(); }));
    out.push(phoneDoes('log', action('View app log', 'This session.  The phone app shows it as text you can read and share.', function () { Diag.showLog(false); })));
    out.push(action('View app log with earlier sessions', 'Useful after a crash or restart.', function () { Diag.showLog(true); }));
    out.push(action('View network helper log', 'Every request the helper made: status, time, size, and the network error if any.', function () { Diag.showHelperLog(); }));
    // Release builds: Report a problem in the menu bar too (test builds always have it).
    if (!/alpha|beta/i.test(TIVIBRO_VERSION)) out.push(toggle('Report a problem in the menu', 'Puts Report a problem at the bottom of the menu bar, one press from anywhere.', function () { return !!S().reportInMenu; }, function (v) { S().reportInMenu = v; save(); Views.buildTabs(); }));
    out.push(toggle('Detailed logging', 'Also logs every request and buffer event.  Turn on while chasing a problem.', function () { return Log.verbose; }, function (v) { Log.verbose = v; paint(); }));
    out.push(action('Clear log', '', function () { Log.clear(); U.toast('Log cleared'); }));
    out.push(page('What this TV can play', 'Video, HDR and sound formats, for the built-in player and the TV player.', 'What this TV can play', function () {
      var o = [info('From the TV\'s own answers plus what LG TVs are known to do.  Dolby Vision and DTS are not always reported correctly, so the known rules win.', '')];
      Caps.report().forEach(function (r) { o.push(info(r[0], r[1])); });
      if (typeof Convert !== 'undefined') { convFresh(); o.push(convLine()); }
      return o;
    }));
    if (Player.current) out.push(info('Playing now', [Player.media, Player.engine].filter(Boolean).join('   ') || 'details not known yet'));
    out.push(head('Status'));
    out.push(info('Network helper', Net.status()));
    // Where playlists, guides and libraries are kept (service/storage.js), and the room left there.
    var st = Net.info && Net.info.store;
    out.push(info('Storage', st ? st.where + (st.freeMB >= 0 ? ', ' + st.freeMB.toLocaleString() + ' MB free' : '') : 'the TV app\'s own'));
    out.push(info('Network setting', (S().network || 'auto') === 'direct' ? 'Direct' : 'Automatic'));
    if (typeof Convert !== 'undefined') { convFresh(); out.push(convLine()); }
    out.push(info('TiviBro', TIVIBRO_VERSION));
    out.push(info('Browser engine', (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || navigator.userAgent.slice(0, 60)));
    out.push(info('Channels loaded', String(L.count())));
    out.push(info('Debug from a computer', 'ares-inspect --device <tv> --app app.tivibro.tv --open'));
    return out;
  }

  /* ---------- render ---------- */
  /* ---------- edit on a computer ---------- */
  function editor(out) {
    var s = S(), on = WebEdit.on, st = WebEdit.status;
    WebEdit.onStatus = function () { if (Views.tab === 'settings' && (SECTIONS[sec] || [])[0] === 'connect' && !stack.length) build(); };
    out.push(head('Web editor  ·  any browser'));
    out.push(info('Groups, channels, names, Smart clean-up, guide matching, reminders and backups from a web browser on a computer, tablet or phone, with a real keyboard.  ' +
      (phoneOK() ? 'The TiviBro app opens it for you (Edit channels) and switches it on by itself: this switch is only for a browser.' : ''), ''));
    out.push(tvOnly(action('Open it in a phone\'s browser (QR code)', 'Turns the editor on and shows a code for the phone\'s camera.  It does not pair the TiviBro app.  Also in the side menu: Edit on phone.', function () { WebEdit.showJoin('', build); }, function () { return '›'; })));
    out.push(toggle('Web editor for browsers', on ? 'Running.  Changes appear on the TV within a few seconds.' : 'Off.  It also switches off whenever TiviBro closes.' + (phoneOK() ? '  The phone app works either way.' : ''), function () { return WebEdit.on; }, function (v) {
      (v ? WebEdit.start() : WebEdit.stop()).then(function () { build(); if (v) U.toast('Web editor is on'); }, function (e) { U.toast(e.message, 5000); build(); });
    }));
    if (on && st) {
      var addrs = WebEdit.addresses();
      if (!addrs.length) out.push(info('Open', 'http://<this TV\'s address>:' + st.port + '   (the TV reported no network address)'));
      addrs.forEach(function (a, i) { var x = info(i ? 'or' : 'Open this address', a); x.big = true; out.push(x); });
      var pw = info('Password', WebEdit.password()); pw.big = true; out.push(pw);
      out.push(info('Browsers connected', String(st.clients || 0)));
      out.push(info('The computer must be on the same network as the TV.', ''));
    }
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

  /* ---------- phone app and web editor: one page ----------
     Two different things that both involve a phone, so they sit together and say which is which:
     the TiviBro app (pair once with its own QR code; a remote, the guide, Movies and Shows, typing,
     backups) and the web editor (any browser).  The app does not need the editor switch on. */
  function connect() {
    var out = [];
    if (phoneOK()) {
      out.push(info('Two ways to use a phone with TiviBro.  The TiviBro app for Android is a remote with the guide, On now, Movies, Shows, My media, reminders, backups and all of these settings; pair it once below.  The web editor works in any browser, for bigger clean-up jobs.  Each works without the other.', ''));
      phone(out);
    }
    editor(out);
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
  function phone(out) {
    var ps = Phone.status, on = !!(ps && ps.on);
    Phone.onChange = function () { if (Views.tab === 'settings' && (SECTIONS[sec] || [])[0] === 'connect' && !stack.length) build(); };
    out.push(head('TiviBro phone app  ·  Android'));
    if (!ps) { Phone.refresh().catch(function (e) { U.toast(e.message, 5000); }); out.push(info('Checking…', '')); return out; }
    out.push(info('Finds this TV, works as a remote with the guide, On now, Movies, Shows and My media, changes every setting here (questions are asked on the phone), lists and cancels reminders, keeps backups, types into the TV, opens the web editor and wakes the TV.  Pair a phone once; it stays paired.', ''));
    out.push(toggle('Phone app connection', on ? 'On.  Paired phones can reach this TV on your network, even when TiviBro is closed.' : 'Off.  Phones can\'t find or reach this TV.', function () { return !!(Phone.status && Phone.status.on); }, function (v) {
      var go = function () { Phone.turn(v).then(function () { build(); U.toast(v ? 'Phone app connection is on' : 'Phone app connection is off'); }, function (e) { U.toast(e.message, 5000); build(); }); };
      if (v || !ps.phones.length) return go();
      UI.confirm('Turn off the phone app connection?  Paired phones stay paired, but can\'t reach this TV until you turn it back on.', 'Turn off', go);
    }));
    // Pairing is the first thing people look for, so it's there even while the connection is off (it turns it on).
    out.push(tvOnly(action('Pair the TiviBro app…', 'Shows the QR code and the code to scan in the TiviBro app (not the phone\'s camera).' + (on ? '' : '  Turns the connection on.'), function () {
      if (on) return Phone.showPair(build);
      Phone.turn(true).then(function () { build(); Phone.showPair(build); }, function (e) { U.toast(e.message, 5000); build(); });
    }, function () { return '›'; })));
    if (on) {
      if (!ps.phones.length) out.push(info('Paired phones', 'none yet'));
      ps.phones.forEach(function (p) {
        out.push(action(I18n.raw(p.name), (p.model ? p.model + '  ·  ' : '') + 'Added ' + when(p.added) + '  ·  Last seen ' + Phone.ago(p.seen), function () {
          UI.menu(I18n.raw(p.name), [
            { label: 'Remove this phone', sub: 'it can no longer reach this TV, until you pair it again', action: function () {
              Phone.forget(p.id).then(function () { build(); U.toast(p.name + ' removed'); }, function (e) { U.toast(e.message, 5000); });
            } },
            { label: 'Cancel', current: true }
          ]);
        }, function () { return '›'; }));
      });
      out.push(action('This TV\'s name', 'How phones show this TV.', function () {
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
    if (Views.tab !== 'settings' || (SECTIONS[sec] || [])[0] !== 'about' || stack.length) return;
    var k = st.state + '|' + st.installer;
    if (k !== lastUpd) { lastUpd = k; build(); } else paint();
  });
  var olderCache = null, olderErr = '';
  function rollbackPage() {
    var out = [];
    out.push(info('Pick a release to go back to.  It\'s checked like an update (its fingerprint and TiviBro\'s signature) and installed through the Homebrew Channel.  Before that, everything TiviBro keeps on this TV (settings, channel edits, favorites, reminders) is saved, and a restore point is made.  Recordings, your playlist and My media stay as they are.  Automatic update checks turn off, so the newer version isn\'t offered straight back.', ''));
    if (Update.state.installer === '') { out.push(info('This TV can\'t install by itself', 'Going back needs a rooted TV with the Homebrew Channel.  The releases page on GitHub has every version.')); return out; }
    if (olderCache === null) {
      out.push(info('Looking for earlier releases…', ''));
      Update.earlier().then(function (l) { olderCache = l; olderErr = ''; build(); }, function (e) { olderCache = []; olderErr = e.message; build(); });
      return out;
    }
    if (olderErr) out.push(info('Couldn\'t list them', olderErr));
    else if (!olderCache.length) out.push(info('No earlier releases to go back to', ''));
    olderCache.slice(0, 15).forEach(function (r) {
      out.push(action('TiviBro ' + r.version + (r.pre ? '  (test version)' : ''), (r.published ? when(Date.parse(r.published)) : '') + (r.notes && r.notes[0] ? '   ·   ' + r.notes[0] : ''), function () {
        UI.confirm(T('Go back to TiviBro {v}?', { v: r.version }), 'Go back and restart', function () { U.toast(T('Saving your settings, then installing {v}…', { v: r.version }), 6000); Update.rollback(r).catch(function (e) { U.toast(e.message, 8000); }); });
      }, function () { return '›'; }));
    });
    out.push(action('Look again', '', function () { olderCache = null; build(); }));
    return out;
  }
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
        // The one thing to do here: in the theme's "go" colour, with a NEW badge, so it isn't missed among the rows.
        if (st.installer === 'hbchannel') { var go = action('Install ' + r.version + ' now', 'Downloads it, checks its fingerprint and installs it through the Homebrew Channel.  TiviBro then restarts by itself, with all your settings.', function () {
          UI.confirm('Install TiviBro ' + r.version + '?', 'Install and restart', function () { Update.install().catch(function (e) { U.toast(e.message, 6000); }); });
        }, function () { return 'NEW'; }); go.attn = true; out.push(go); }
        else if (st.installer === '') out.push((function (x) { x.attn = true; return x; })(info('Install it from a computer or the Homebrew Channel', 'This TV can\'t install updates by itself (that needs a rooted TV with the Homebrew Channel).  The release page has the IPK and instructions: github.com/' + Update.REPO + '/releases')));
      }
      out.push(page('What\'s new', '', 'What\'s new in ' + r.version, function () {
        return (r.notes && r.notes.length ? r.notes : ['No notes for this release.']).map(function (n) { return info(n, ''); });
      }));
    }
    out.push(head('Options'));
    out.push(toggle('Check automatically', 'When TiviBro starts and every 6 hours while it is open.  Nothing is installed without asking you.', function () { return s.updateAuto !== false; }, function (v) { s.updateAuto = v; save(); }));
    out.push(toggle('Count this TV in the install numbers', 'Once a day, and when a new version first starts, TiviBro says which version it is (and whether it is new or an update) and which webOS this TV has.  Nothing else: no address is kept, no ID, nothing about your channels or playlists.', function () { return s.countMe !== false; }, function (v) { s.countMe = v; save(); }));
    out.push(toggle('Include test versions', 'Alpha and beta builds: new features first, and some rough edges.', function () { return Update.wantPre; }, function (v) { s.updatePre = v; save(); }));
    var how = info('Installing on this TV', ''); how.value = function () { var i = Update.state.installer; return i === 'hbchannel' ? 'Yes, through the Homebrew Channel' : i === '' ? 'From a computer only (not rooted)' : 'Checking…'; }; out.push(how);
    // Going back (update.js): an earlier release, installed the same checked way, with your settings saved first.
    if (st.state !== 'installing' && st.state !== 'installed') out.push(page('Go back to an earlier version', 'If an update caused trouble.  Your settings and edits are saved first; recordings and your playlist aren\'t touched.', 'Go back to an earlier version', rollbackPage));
    var sv = Update.snaps();
    if (sv.length) {
      out.push(head('Settings saved before going back'));
      sv.forEach(function (x) {
        out.push(action(T('From {v}', { v: x.from }), when(x.at) + '   ·   ' + T('saved before going back to {v}', { v: x.to }), function () {
          UI.confirm(T('Put back the settings you had in {v}?', { v: x.from }), 'Put back and restart', function () { Update.restore(x).catch(function (e) { U.toast(e.message, 6000); }); });
        }, function () { return T('Put back') + ' ›'; }));
      });
    }
    out.push(head('About'));
    var credit = U.el('div', 'tmdb-credit'), logo = U.el('img');
    logo.src = 'img/tmdb.svg'; logo.alt = 'TMDB'; logo.width = 120;
    credit.appendChild(logo); credit.appendChild(U.el('span', '', 'This product uses the TMDB API but is not endorsed or certified by TMDB.'));
    out.push({ preview: true, el: credit });
    out.push(info('Made by OhMyBahGosh', 'github.com/' + Update.REPO));
    out.push(page('Open-source licenses and credits', 'TiviBro is MIT licensed.  What it is built with, and the services it uses.', 'Open-source licenses and credits', licenses));
    return out;
  }

  /* What TiviBro is built with and their licenses, the same list as THIRD-PARTY-NOTICES.md (which ships beside
     index.html with the license texts it names). */
  function licenses() {
    var L2 = function (name, lic) { var it = info(I18n.raw(name), ''); it.value = function () { return lic; }; it.raw = true; return it; };
    return [
      info('TiviBro is free software under the MIT License, copyright (c) 2026 OhMyBahGosh.  The full texts of every license below are in the app\'s package (THIRD-PARTY-NOTICES.md) and at github.com/' + Update.REPO + '.', ''),
      head('In the app'),
      L2('hls.js ' + (window.Hls && Hls.version || '1.5.20'), 'Apache-2.0'),
      L2('mpegts.js 1.8.0 (with TiviBro\'s changes)', 'Apache-2.0'),
      L2('dash.js 4.7.4', 'BSD-3-Clause'),
      L2('QR Code Generator, Kazuhiko Arase', 'MIT'),
      L2('Roboto and Roboto Mono (digits)', 'Apache-2.0'),
      L2('DejaVu Sans (symbols)', 'Bitstream Vera'),
      head('In the network helper'),
      L2('FFmpeg 7.1.1 (the audio converter)', 'LGPL v3+'),
      L2('Mbed TLS 3.6.5', 'Apache-2.0'),
      info('FFmpeg is unmodified, built from ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz by scripts/ffmpeg/build.sh in TiviBro\'s repository.  It runs as a separate program, which you can replace with your own build.', ''),
      head('Services and data, with thanks'),
      L2('TMDB', 'Movie and show details and posters'),
      info('This product uses the TMDB API but is not endorsed or certified by TMDB.', ''),
      L2('Trakt', 'Watched history and lists'),
      info('TiviBro uses Trakt but is not endorsed or certified by Trakt.', ''),
      L2('OpenSubtitles.com', 'Subtitles'),
      L2('tv-logo/tv-logos', 'Logos, CC BY-SA / BY-NC-SA'),
      L2('iptv-org/database', 'Logos, Unlicense'),
      info('Channel logos are trademarks of their owners.', ''),
      L2('epg.pw, iptv-epg.org, epgshare01, i.mjh.nz, EPGTalk', 'Public guides')
    ];
  }

  // Each section's page, by id, so reordering SECTIONS can never show one section under another's name.
  /* ---------- channel and group names (the playlist in use) ---------- */
  function names() {
    var p = Store.playlist, out = [info('For ' + (p.name || 'this playlist') + '.  Each playlist has its own rules (Playlists > the playlist).  The provider\'s names stay as they are: TiviBro only changes how they show.', '')];
    return out.concat(namesPage(p));
  }

  /* ---------- backups and restore points ---------- */
  var snapsCache = null, snapsAt = 0;
  function loadSnaps() {
    if (snapsAt && Date.now() - snapsAt < 3000) return;
    snapsAt = Date.now();
    WebEdit.runData('listSnaps', {}).then(function (r) { snapsCache = r.data || []; live(); }, function () { snapsCache = []; live(); });
  }
  function backups() {
    var out = [];
    loadSnaps();
    out.push(info('Two kinds of safety net.  A backup holds everything (playlists with their logins, groups, favorites, names, guide matches, settings) and lives off the TV: in the TiviBro phone app, or as a locked file from the web editor.  A restore point lives on this TV and puts back your channel edits (groups, hidden items, names, guide matches) for this playlist.', ''));
    out.push(head('Backups'));
    out.push(phoneDoes('backups', action('In the TiviBro phone app', 'Backups > Back up now, or every week by itself.  Restore puts one back on this TV or a new one.', function () { U.toast('Open the TiviBro app on your phone, then Backups', 5000); })));
    out.push(phoneDoes('editor', action('As a file, from the web editor', 'Backups and restore points > Download a locked backup.  It needs a passphrase you choose.', function () { WebEdit.showJoin('backup', build); }, function () { return '›'; })));
    out[out.length - 1].epage = 'backup';
    out.push(info('Last backup', Store.settings.lastBackup ? when(Store.settings.lastBackup) : 'none yet'));
    out.push(head('Restore points on this TV'));
    out.push(action('Save a restore point now', 'TiviBro also saves one before big changes: Smart clean-up, the set-up tour, changes sent from the web editor.', function () {
      UI.prompt('Name the restore point', '', function (v) { WebEdit.runData('makeSnap', { name: v }).then(function (r) { U.toast(r.msg); snapsAt = 0; loadSnaps(); }, function (e) { U.toast(e.message, 5000); }); }, 'For example: Before hiding sports');
    }));
    if (snapsCache === null) out.push(info('Loading…', ''));
    else if (!snapsCache.length) out.push(info('No restore points yet', ''));
    else snapsCache.slice(0, 40).forEach(function (x) {
      out.push(action(x.name ? I18n.raw(x.name) : 'Restore point', when(x.at) + (x.kind === 'auto' ? '   saved by itself' : ''), function () {
        UI.menu(x.name ? I18n.raw(x.name) : 'Restore point', [
          { label: 'Restore it', sub: 'your current edits are saved as a restore point first', action: function () {
            UI.confirm('Put back "' + (x.name || 'this restore point') + '"?', 'Restore', function () { WebEdit.runData('restoreSnap', { id: x.id }).then(function (r) { U.toast(r.msg, 5000); snapsAt = 0; loadSnaps(); }, function (e) { U.toast(e.message, 5000); }); });
          } },
          { label: 'Delete it', action: function () { WebEdit.runData('deleteSnap', { id: x.id }).then(function (r) { U.toast(r.msg); snapsAt = 0; loadSnaps(); }, function (e) { U.toast(e.message, 5000); }); } },
          { label: 'Cancel', current: true }
        ]);
      }, function () { return '›'; }));
    });
    return out;
  }

  /* ---------- updates, about and diagnostics ---------- */
  /* ---------- Language (app/js/i18n.js) ----------
     Automatic is the TV's menu language.  The languages are listed in their own names (and in English), so
     the right one can be found whatever TiviBro is showing. */
  function language() {
    var out = [], d = I18n.detected(), cur = I18n.setting();
    function pickIt(code) {
      I18n.set(code);
      U.toast(code === 'auto' ? 'Language: automatic, the TV\'s language' : I18n.t('Language: {x}', { x: I18n.name(I18n.lang()) }));
      build();
    }
    out.push(info('TiviBro is in the TV\'s own language unless you choose one here.  Spanish and Russian are new: anything not translated yet shows in English.', ''));
    var tvName = d.supported ? I18n.name(d.code) : d.locale + ' (English: not in TiviBro yet)';
    var auto = action('Automatic: the TV\'s language', 'The TV is set to ' + tvName + '.', function () { pickIt('auto'); }, function () { return cur === 'auto' ? '✓' : ''; });
    out.push(auto);
    out.push(head('Languages'));
    I18n.langs().forEach(function (l) {
      var it = action(l.name, l.code === I18n.lang() ? '' : T(l.english), function () { pickIt(l.code); }, function () { return cur === l.code ? '✓' : ''; });
      it.raw = true;                  // "Español" stays "Español" whatever TiviBro is in
      out.push(it);
    });
    out.push(info('Something reads wrong, or you\'d like TiviBro in your language?  Settings > System > Report a problem, or a discussion on GitHub.', ''));
    return out;
  }

  function about() {
    var out = updates();
    out.push(head('Diagnostics'));
    return out.concat(diag(), [provRow()]);
  }
  /* Provider status (provstatus.js): is it the provider?  What's wrong with it in plain words, and what to send
     them.  Last on the page: the phone app opens the pages above it by their place. */
  function provRow() {
    return page('Provider status', 'Whether your provider\'s server answers, and what to tell them when it doesn\'t.', 'Provider status', provPage, function () {
      return typeof ProvStatus !== 'undefined' && ProvStatus.now().length ? 'Problem' : 'OK';
    });
  }
  function provPage() {
    var out = [], list = typeof ProvStatus !== 'undefined' ? ProvStatus.now() : [];
    if (!list.length) out.push(info('Your provider answers normally', 'Nothing failing in the last few minutes'));
    list.forEach(function (d) {
      out.push(head(I18n.raw(d.host)));
      out.push(info(d.title, U.hhmm(d.since)));
      out.push({ label: d.text, sub: (d.netOk ? T('Other sites answer, so the TV\'s internet works: this is on your provider\'s side.') : T('Other sites haven\'t been checked yet: Check now looks.')) + '  ' + d.n + ' ' + T('failed requests'), info: true, value: function () { return ''; } });
      out.push({ label: 'What to tell your provider', sub: I18n.raw(d.tell), info: true, value: function () { return ''; } });
    });
    out.push(action('Check now', 'Asks your provider\'s server and another site on the internet, then says what it found.', function () {
      U.toast('Checking…', 3000);
      ProvStatus.checkNow().then(function (r) {
        var bad = r.providers.filter(function (x) { return !x.ok; });
        U.toast(bad.length ? (r.internet ? T('Your internet works; your provider\'s server doesn\'t answer') + ' (' + bad.map(function (x) { return x.code; }).join(', ') + ')' : T('Neither your provider nor other sites answer: check the TV\'s internet connection')) : T('Your provider answers normally'), 7000);
        build();
      });
    }));
    return out;
  }

  /* Fix a problem (System, first row): the common problems in plain words, what to try first, and the
     settings that matter for each, one press away (jump: the setting's own row, found like Search finds it). */
  function jump(label, why) {
    var it = action(label, why, function () { var r = findIndex().filter(function (x) { return x.label === label; })[0]; if (r) goFound(r); else U.toast(T('That setting isn\'t on this TV.')); }, function () { return '›'; });
    it.cls = 'jump'; return it;
  }
  function tip(text) { return { label: text, info: true, cls: 'tip', value: function () { return ''; } }; }
  function fixes() {
    // Its rows are what to try, advanced or not: none moves to the Advanced heading here (fixes.adv).
    // Each problem in place, under its own heading (they were a page each).
    function prob(label, sub, rows) { return [head(label)].concat(rows()); }
    return [].concat.apply([], [
      prob('Channels freeze or buffer', 'Pictures stop, or the circle spins.', function () { return [
        tip('Most freezes are the stream itself: try the same channel in another app, or another version of it (HD, FHD, backup).  Then the settings below, one at a time.'),
        jump('Buffer profile', 'More buffer: fewer freezes, a little slower to start.'), jump('Stream format', 'HLS copes better with a weak connection, MPEG-TS switches faster.'),
        jump('Memory-safe playback', 'On a TV with 1 or 2 GB, or when TiviBro closes while playing.'),
        action('Speed test', 'Your internet and your provider\'s speed, and what that is enough for.', function () { Diag.speedTest(); }),
        action('Run connection test', 'Checks the helper, the login, the channel list, a stream and the guide, step by step.', function () { Diag.run(); })]; }),
      prob('A channel won\'t play', 'A black screen, an error, or it keeps reconnecting.', function () { return [
        tip('If several channels fail at once, it is usually the provider: Provider status says so, and what to tell them.'),
        jump('Provider status', 'Whether your provider answers, right now.'), jump('When a channel stops working', 'Switch to another version of the channel by itself.'),
        jump('Player engine', 'The TV player plays some streams the built-in one can\'t, and the other way round.'), jump('Connection', 'Through the network helper (most providers) or straight from the TV.'),
        action('Run connection test', 'Checks the helper, the login, the channel list, a stream and the guide, step by step.', function () { Diag.run(); })]; }),
      prob('No guide, or the wrong programmes', 'Empty rows, or programmes from another channel or time.', function () { return [
        tip('A channel with the wrong programmes: Hold OK on it in the Guide > Choose guide channel.  Every programme too early or late: the time offset below.'),
        jump('Provider guide', 'Per channel, or the full file.'), jump('Guide sources', 'Add an XMLTV address when your provider has none.'), jump('Public guide fill-in', 'Free guides for channels nothing else covers.'),
        jump('Provider guide time offset', 'When every programme is too early or too late.'), jump('Reload guide now', 'Read the guide again now.')]; }),
      prob('No sound, or the wrong language', 'Silence, or another language than you want.', function () { return [
        tip('In fullscreen, OK > Audio picks another track for what is playing.  Movies with DTS sound have no sound on many LG TVs: the converter below fixes that.'),
        jump('Audio language', 'The language tried first.'), jump('Prefer surround sound', 'The 5.1 or Dolby track when there is one.'), jump('Convert audio the TV can\'t play', 'DTS and TrueHD on LG TVs.')]; }),
      prob('Subtitles or captions', 'Missing, too small, or out of time.', function () { return [
        tip('In fullscreen, OK > Subtitles picks a track, Find subtitles gets them from OpenSubtitles, and Timing moves them earlier or later.'),
        jump('Subtitles automatically', 'On whenever a stream has them.'), jump('Closed captions', 'For live TV channels that send them.'), jump('Subtitle size', 'Bigger or smaller.'),
        jump('OpenSubtitles key and sign-in', 'Needed for Find subtitles.')]; }),
      prob('Movies or shows are missing', 'Movies and Shows, or My media, are empty or not all there.', function () { return [
        tip('Movies and Shows come from your provider and load again with the playlist, or on their own with Reload movies and shows now.  My media scans your own libraries: Green on My media scans again.'),
        jump('Reload movies and shows now', 'Titles added since they last loaded.'), jump('Movies and Shows open on', 'Home, or the list of categories.'), jump('Scan all libraries', 'Look for added and removed movies and episodes.'), jump('Fetch details for all', 'Posters and details from TMDB.')]; }),
      prob('TiviBro closed by itself, or is slow', 'It quits while playing, or the screens are slow.', function () { return [
        tip('TiviBro says what it was doing when it closed, and offers to send a report.  On TVs with 1 or 2 GB, these settings help most.'),
        jump('Memory-safe playback', 'Holds less video in memory.'), jump('Seek previews', 'Off frees the memory a 4K movie\'s pictures take.'), jump('Public guide fill-in', 'Fewer countries means less to read.'), jump('Keep past days', 'Fewer days of catch-up guide.'),
        jump('Preview on the Channels screen', 'Off for the snappiest list on slow TVs.'), jump('Report a problem', 'Sends this TV\'s details and log, logins taken out.')]; })
    ]);
  }
  fixes.adv = true;
  /* The twelve sections, from the pages they hold (see SECTIONS and PAGES). */
  function playlistsSection() { return playlists(); }
  function channelsSection() { return groups(); }

  function playbackSection() { return playback(); }

  /* ---------- recording and live pause (record.js, recordings.js, service/record.js, timeshift.js) ---------- */
  function recordingPage() {
    var s = S(), out = [], R = typeof Record !== 'undefined' ? Record : null, sp = R && R.space;
    var gb = function (mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(0, mb) + ' MB'; };
    out.push(info('Where', ''));
    out[out.length - 1].value = function () { var x = R && R.space, sh = R && R.share; return x ? T('USB drive, {x} free of {y}', { x: gb(x.freeMB), y: gb(x.totalMB) }) + (sh ? '  ·  ' + T('Network share: {x}', { x: sh.name || sh.host }) : '') : sh ? T('Network share: {x}', { x: sh.name || sh.host }) : R && R.canPause() ? T('No USB drive: pause uses the TV\'s own storage (10 minutes)') : T('No USB drive'); };
    if (!sp && !(R && R.share)) out.push(info('Record to a USB drive on a rooted TV, or to a network share on any TV.  webOS keeps USB drives from apps installed in developer mode; on a rooted TV (the Homebrew Channel) TiviBro\'s helper reaches them.  A network share (WebDAV, which Synology, QNAP, TrueNAS, Unraid and Nextcloud offer) works without root: add it as a library in My media, then choose it below.  Live pause works without either, for up to 10 minutes in the TV\'s own storage.', ''));
    // A network share: a WebDAV library from My media (its address and login).
    if (R) out.push(action('Network share', 'Record to a WebDAV share on your network (a NAS, Nextcloud): no USB drive or root needed.  Choose one of your My media WebDAV libraries.', function () {
      var libs = typeof MediaStore !== 'undefined' ? MediaStore.sources().filter(function (x) { return x.type === 'webdav'; }) : [];
      var items = libs.map(function (x) { return { label: x.name || x.address, icon: 'folder', sub: x.address, action: function () {
        U.toast(T('Checking that TiviBro can write there…'), 3000);
        R.setShare(MediaStore.source(x.id)).then(function () { U.toast(T('Recording to {x}', { x: x.name || x.address }), 4000); build(); }, function (e) { U.toast(e && e.message || 'No answer from the helper', 7000); });
      } }; });
      if (!libs.length) items.push({ label: 'No WebDAV library yet', sub: 'Settings > My media > Add a library > WebDAV, then come back here.' });
      if (R.share) items.push({ label: 'Stop recording to a share', icon: 'stop', action: function () { R.setShare(null).then(build, function () {}); } });
      UI.menu('Network share', items);
    }, function () { var sh = R.share; return sh ? (sh.name || sh.host) + ' ›' : T('None') + ' ›'; }));
    if (R && R.share && sp) out.push(choice('Record to', 'With both a USB drive and a network share, where new recordings go.', ['', 'share'], ['USB drive', 'Network share'],
      function () { return s.recTo === 'share' ? 'share' : ''; }, function (v) { s.recTo = v; save(); }));
    if (R) out.push(action('Open Recordings', 'Watch, stop, cancel or delete recordings.', function () { Views.switchTab('recordings'); }, function () { var n = R.recs.length; return n ? n + ' ›' : '›'; }));
    out.push(head('Recording'));
    out.push(choice('Start early', 'Minutes before a scheduled programme\'s start, in case it starts early or the guide is off.', [0, 1, 2, 5, 10], ['On time', '1 min', '2 min', '5 min', '10 min'],
      function () { return s.recPadBefore == null ? 2 : +s.recPadBefore; }, function (v) { s.recPadBefore = v; save(); }));
    out.push(choice('Keep going after', 'Minutes after the programme\'s end, for a game or show that runs late.', [0, 2, 5, 10, 15, 30], ['On time', '2 min', '5 min', '10 min', '15 min', '30 min'],
      function () { return s.recPadAfter == null ? 5 : +s.recPadAfter; }, function (v) { s.recPadAfter = v; save(); }));
    if (R) out.push(action('Delete watched recordings', 'The ones you\'ve watched (Settings > Movies and shows > Count as watched at).', function () {
      var done = R.recs.filter(function (r) { var p = R.posOf(r.id); return r.status === 'done' && p && p.d && (U.isWatchedAt || function (p, d) { return d > 0 && (p >= d * 0.9 || p > d - 60); })(p.t, p.d); });
      if (!done.length) { U.toast(T('Nothing watched to the end yet')); return; }
      UI.confirm(T('Delete {n} watched recordings?', { n: done.length }), 'Delete', function () { (function one(i) { if (i >= done.length) { U.toast(T('Deleted {n} recordings', { n: done.length })); return build(); } R.remove(done[i].id).then(function () { one(i + 1); }, function () { one(i + 1); }); })(0); });
    }));
    out.push(head('Live pause'));
    out.push(toggle('Pause live TV', 'Pause keeps the channel, and Play carries on from where you paused, with ◀ ▶ to go back and forth in it.  On a USB drive (a rooted TV) it keeps up to 2 hours; without one, up to 10 minutes in the TV\'s own storage.  Off: pause holds for as long as the player\'s buffer, then Play is live.',
      function () { return s.livePause !== false; }, function (v) { s.livePause = v; save(); }));
    out.push(choice('Rewind buffer', 'Keeps the channel you watch fullscreen on the USB drive the whole time, so ◀ goes back to something you just missed without pausing first (like a DVR).  Channels start a second or two slower, and the drive is written all the time.  Needs a USB drive in the TV and Pause live TV on.',
      [0, 30, 60, 120], ['Off', '30 min', '1 hour', '2 hours'], function () { return +s.rewindBuffer || 0; }, function (v) { s.rewindBuffer = v; save(); }));
    out.push(head('Buttons'));
    out.push(info('A Magic Remote has no Pause or REC button: in fullscreen, OK opens the quick menu, which starts with Pause, Rewind and Record, and in the guide Hold OK has Record.  On a remote with ● REC, it records what\'s on (in the guide, the programme you\'re on).  Any button can be set to Record or Recordings: Remote and buttons.', ''));
    out.push(link('Remote and buttons', 'What each button does in the player, the guide and the lists.', 'remote'));
    return out;
  }
  function systemSection() {
    // An update ready: first thing on the page, in the "go" colour, so it can't be missed (it was one row among many).
    var st = typeof Update !== 'undefined' ? Update.state : null, top = [];
    if (st && st.state === 'available' && st.latest) {
      var v = st.latest.version, ready = st.installer === 'hbchannel'
        ? action('TiviBro ' + v + ' is ready to install', 'Press OK to install it.  TiviBro restarts by itself, with all your settings.', function () { UI.confirm('Install TiviBro ' + v + '?', 'Install and restart', function () { Update.install().catch(function (e) { U.toast(e.message, 6000); }); }); }, function () { return 'NEW'; })
        : info('TiviBro ' + v + ' is out', 'Install it from a computer or the Homebrew Channel');
      ready.attn = true; ready.keep = true; top.push(ready);
    }
    return top.concat([page('Fix a problem', 'Channels freeze, no guide, no sound, TiviBro closed or is slow: what to try first.', 'Fix a problem', fixes)].concat(about(),
      [head('Backups'), link('Backups and restore points', 'Everything saved, to put back on this TV or another one.', 'backups')]));
  }
  var BY_ID = { sports: teamsPage, language: language, playlists: playlists, guide: guide, channels: groups, names: names, reminders: reminders, playback: playback, audio: audioSubs, vod: vodSettings, media: media, keys: apiKeys, remote: remote, recording: recordingPage, look: look, parental: parental, backups: backups, connect: connect, about: about };
  var SEC_FNS = { playlists: playlistsSection, channels: channelsSection, playback: playbackSection, about: systemSection };
  var FNS = SECTIONS.map(function (x) { return SEC_FNS[x[0]] || BY_ID[x[0]]; });
  // An old section that is now a page: its section, and the row's place in it (or -1).
  function pageOf(id) {
    var p = PAGES[id]; if (!p) return null;
    var i = -1; for (var x = 0; x < SECTIONS.length; x++) if (SECTIONS[x][0] === p[0]) i = x;
    if (i < 0) return null;
    var list = shape(FNS[i], SECTIONS[i][1]), n = -1;
    for (var k = 0; k < list.length; k++) if (list[k] && list[k].page && list[k].label === p[1]) { n = k; break; }
    return { i: i, n: n, it: list[n] };
  }
  /* A page's parts (the overhaul): its headings split it, and the list on the left shows those parts instead
     of every section, so a long page is a few short ones.  Only the part you're in is drawn; moving past its
     last row goes on into the next part.  Every row is still there, in the same order (the phone and the web
     editor get the whole page, as before).  Rows before the first heading are the first part. */
  var parts = [], grp = 0, navSel = 0;
  function groupsOf(list) {
    var out = [], cur = null;
    list.forEach(function (it, i) {
      if (it && it.head && it.label) { cur = { title: it.raw ? it.label : T(it.label), start: i + 1, end: i + 1 }; out.push(cur); return; }
      if (!cur) { cur = { title: '', start: i, end: i }; out.push(cur); }
      cur.end = i + 1;
    });
    return out.filter(function (g) { return g.end > g.start; });
  }
  function groupOf(i) { for (var g = 0; g < parts.length; g++) if (i >= parts[g].start && i < parts[g].end) return g; return 0; }
  function firstIn(g, back) {
    var G = parts[g]; if (!G) return 0;
    if (back) { for (var i = G.end - 1; i >= G.start; i--) if (focusable(i)) return i; return G.end - 1; }
    for (var j = G.start; j < G.end; j++) if (focusable(j)) return j; return G.start;
  }
  function pageTitle() { var top = stack[stack.length - 1]; return top ? T(top.title) : sec < 0 ? T('Search settings') : navTitle(SECTIONS[sec]); }
  function build() {
    var top = stack[stack.length - 1];
    items = top ? shape(top.fn, top.title) : sec < 0 ? findPage() : shape(FNS[sec], SECTIONS[sec][1]);
    items = items.filter(Boolean);
    parts = sec < 0 && !top ? [{ title: '', start: 0, end: items.length }] : groupsOf(items);
    if (!parts.length) parts = [{ title: '', start: 0, end: items.length }];
    sel = U.clamp(sel, 0, Math.max(0, items.length - 1));
    grp = groupOf(sel);
    var G = parts[grp];
    if (!focusable(sel) || sel < G.start || sel >= G.end) sel = firstIn(grp);
    if (zone === 'nav') navSel = grp;
    body.innerHTML = '';
    scrollEl = U.el('div', 'set-scroll');
    scrollEl._y = 0;
    rowEls = [];
    items.forEach(function (it, i) {
      if (i < G.start || i >= G.end) return;
      rowEls[i] = drawRow(it, i);
    });
    rowEls.forEach(function (e) { if (e) scrollEl.appendChild(e); });
    body.appendChild(scrollEl);
    paint();
  }
  // One row of the page, with its value, switch or ◀ ▶, and the mouse (Magic Remote) wired to it.
  function drawRow(it, i) {
    if (it.preview) return it.el;
    var k = kindOf(it), tone = k === 'action' && !it.go && !it.raw ? actionTone(it.label) : '';
    var d = U.el('div', 'opt k-' + k + (it.head ? ' head' : '') + (it.big ? ' big' : it.info ? ' dim' : '') + (it.attn ? ' attn' : '') + (it.cls ? ' ' + it.cls : '') + (tone ? ' tone-' + tone : ''));
    var l = U.el('div', 'ol', it.raw ? it.label : T(it.label));
    // Under the name, its first sentence; the whole note, and what the buttons do, show in the panel on the right.
    d._title = it.raw ? it.label : T(it.label); d._how = howTo(k, tone, it);
    if (it.sub) { var full = it.raw ? it.sub : T(it.sub), short = brief(full); l.appendChild(U.el('small', '', short)); d._help = full; }
    d.appendChild(l);
    if (!it.head) {
      d._v = U.el('div', 'ov'); d.appendChild(d._v);
      // On / Off as a switch.
      if (it.toggle) { d._tg = U.el('span', 'tgl'); d._tg.appendChild(U.el('i', '')); d.appendChild(d._tg); }
      // A value you change with ◀ ▶ shows the arrows on the focused row, and with the Magic
      // Remote each arrow can be clicked.
      if (it.cycle && !it.toggle) {
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
  }
  var navKey = '';
  function paint() {
    // The list on the left only changes with the page, its part or the language: rebuilding it on every move
    // made the page lay out again each time (slow on a TV).
    var key = [sec, stack.length, grp, navSel, zone, parts.length, typeof I18n !== 'undefined' ? I18n.lang() : '', pageTitle()].join('|');
    if (key !== navKey || !nav.firstChild) { navKey = key; navList(); }
    nav.classList.toggle('active', zone === 'nav');
    rows();
  }
  /* The list on the left: back (to the page before, or to the Settings home), the page's name, then its parts.
     navSel -1 is back. */
  function navList() {
    nav.innerHTML = '';
    var back = U.el('div', 'nav-back' + (zone === 'nav' && navSel < 0 ? ' on' : ''), '‹  ' + (stack.length ? (stack.length > 1 ? T(stack[stack.length - 2].title) : SECTIONS[sec] ? navTitle(SECTIONS[sec]) : T('Search settings')) : T('All settings')));
    back.addEventListener('click', function () { navBack(); });
    nav.appendChild(back);
    nav.appendChild(U.el('div', 'nav-title', pageTitle()));
    if (parts.length > 1) parts.forEach(function (g, i) {
      var n = U.el('div', i === grp ? 'on' : '', g.title || T('Overview'));
      n.addEventListener('click', function () { openGroup(i); zone = 'body'; build(); });
      nav.appendChild(n);
    });
  }
  // Back from the list on the left: the page before, or the Settings home.
  function navBack() { if (stack.length) { pop(); zone = 'nav'; navSel = grp; paint(); } else { zone = 'nav'; homeShow(true); } }
  function openGroup(i) { grp = U.clamp(i, 0, parts.length - 1); sel = firstIn(grp); navSel = grp; }
  function put(el, s) { s = s == null ? '' : String(s); if (el.textContent !== s) el.textContent = s; }
  /* What kind of row it is, for its look (and the phone's and the web editor's): a setting with choices, an On / Off
     switch, a page, a button, a fact (status), a note or tip, or a heading. */
  function kindOf(it) {
    if (it.head) return 'head';
    if (it.preview) return 'preview';
    if (it.info) { var v = ''; try { v = it.value ? String(it.value() || '') : ''; } catch (e) {} return v && v !== '›' ? 'status' : 'note'; }
    if (it.toggle) return 'toggle';
    if (it.values || it.cycle) return 'choice';
    if (it.page || it.phonePage) return 'page';
    return 'action';
  }
  /* How an action row looks on the phone and in the web editor, from its English label: 'go' for one that
     does its job right now (Reload guide now, Check for updates), 'danger' for one that deletes, clears or
     resets.  Labels are English before translation, so this works in every language. */
  function actionTone(label) {
    if (/^(Delete|Clear|Remove|Reset|Forget|Erase|Unpair|Sign out|Log out|Stop following|Start learning again)\b/i.test(label)) return 'danger';
    if (/\bnow$|^(Check for updates|Install|Reload|Refresh|Update|Scan|Sync|Back up)\b/i.test(label)) return 'go';
    return '';
  }
  // A note's first sentence (sentences end with ".  "), for under the name.
  function brief(t) { t = String(t || ''); var i = t.indexOf('.  '); return i > 0 && i < t.length - 3 ? t.slice(0, i + 1) : t; }
  /* The panel beside the page: the focused setting's name, its whole note, and what the remote does on it,
     so the rows can stay short and anyone can tell what a press will do. */
  function help(e) {
    var h = document.getElementById('setHelp'); if (!h) return;
    var on = e && zone === 'body' && e._title;
    h.classList.toggle('empty', !on);
    if (!on) { if (h._t !== '') { h.innerHTML = ''; h._t = ''; } return; }
    var key = e._title + '|' + (e._help || '') + '|' + e._how;
    if (h._t === key) return;
    h._t = key; h.innerHTML = '';
    h.appendChild(U.el('div', 'sh-k', T('About this')));
    h.appendChild(U.el('b', '', e._title));
    if (e._help) h.appendChild(U.el('p', '', e._help));
    if (e._how) h.appendChild(U.el('div', 'sh-how', e._how));
  }
  // What the remote does on a row, in plain words, for the panel.
  function howTo(k, tone, it) {
    if (tone === 'danger') return T('OK asks first, then does it.');
    if (tone === 'go') return T('OK does it now.');
    if (k === 'toggle') return T('OK or ◀ ▶ switches it on or off.');
    if (k === 'choice') return T('◀ ▶ changes it.');
    if (k === 'page') return T('OK opens it.  Back comes back here.');
    if (k === 'action') return it && it.go ? T('OK goes there.') : T('OK opens it.');
    return '';
  }
  function rows() {
    rowEls.forEach(function (e, i) {
      var it = items[i];
      if (!e) return;
      // Only the words that changed: writing them all again on every move made the page lay out again.
      if (e._t) {
        put(e._t, it.value ? T(it.value()) : '');
        var sw = it.swatch && it.swatch();
        e._sw.classList.toggle('hidden', !sw);
        if (sw && e._swc !== sw) { e._sw.style.background = sw; e._swc = sw; }
      } else if (e._tg) { var on = !!it.get(); e._tg.classList.toggle('on', on); put(e._v, T(on ? 'On' : 'Off')); }
      else if (e._v) { var tv = it.value ? (it.raw ? it.value() : T(it.value())) : ''; if (it.page || it.cls === 'jump') tv = String(tv).replace(/\s*›$/, ''); put(e._v, tv); }
      e.classList.toggle('focus', zone === 'body' && i === sel && focusable(i));
    });
    help(rowEls[sel]);
    var f = rowEls[sel];
    if (f && scrollEl) {
      var y = f.offsetTop, h = body.clientHeight, cur = scrollEl._y || 0;
      if (y + cur < 40) cur = -y + 40;
      if (y + f.offsetHeight + cur > h - 40) cur = h - 40 - y - f.offsetHeight;
      if (zone === 'nav' || sel <= parts[grp].start + 1) cur = 0;
      // On the last row you can pick, show what comes after it too (notes, results): otherwise text
      // under the last choice could never be scrolled into view.
      if (zone === 'body' && lastFocusable() === sel) cur = Math.min(cur, scrollMin());
      setScroll(cur);
    }
  }
  function scrollMin() { return Math.min(0, body.clientHeight - 24 - scrollEl.scrollHeight); }
  function setScroll(y) { y = Math.max(scrollMin(), Math.min(0, y)); scrollEl._y = y; scrollEl.style.transform = 'translateY(' + y + 'px)'; scrollHint(y); }
  /* That a page goes on (asked for after the overhaul): a scroll bar down the right side, and "More below" /
     "More above" with a fade where rows are out of view. */
  function scrollHint(y) {
    var full = scrollEl.scrollHeight, h = body.clientHeight, min = scrollMin(), bar = body._bar;
    if (!bar || bar.parentNode !== body) {
      bar = body._bar = U.el('div', 'set-sbar'); bar.appendChild(U.el('i'));
      body._below = U.el('div', 'set-more below'); body._above = U.el('div', 'set-more above');
      body.appendChild(bar); body.appendChild(body._below); body.appendChild(body._above);
    }
    var long = min < -8;
    bar.classList.toggle('hidden', !long); body._below.classList.toggle('on', long && y > min + 8); body._above.classList.toggle('on', long && y < -8);
    put(body._below, '▼  ' + T('More below')); put(body._above, '▲  ' + T('More above'));
    if (!long) return;
    var th = Math.max(36, Math.round(h * h / full)), top = Math.round((h - th) * (y / min));
    bar.firstChild.style.height = th + 'px'; bar.firstChild.style.transform = 'translateY(' + top + 'px)';
  }
  function lastFocusable() { var G = parts[grp] || { start: 0, end: items.length }; for (var i = G.end - 1; i >= G.start; i--) if (focusable(i)) return i; return -1; }
  function focusable(i) { var it = items[i]; return !!(it && !it.head && !it.info && !it.preview); }

  function keys(a) {
    // The channel playing in the corner (views.js pip): Hold OK goes back to it in fullscreen.
    if (a === 'hold' && Views.pipOn) { Views.pipFull(); return true; }
    if (onHome) return homeKeys(a);
    if (zone === 'nav') {
      var many = parts.length > 1;
      if (a === 'up') { if (navSel >= 0) { navSel--; if (navSel >= 0) { openGroup(navSel); build(); } else paint(); } else Views.tabBar(function () { UI.setHandler(keys); paint(); }); }
      else if (a === 'down') { if (navSel < 0 && many) { openGroup(0); build(); } else if (navSel < 0) { zone = 'body'; paint(); } else if (navSel < parts.length - 1) { openGroup(navSel + 1); build(); } }
      else if (a === 'ok' && navSel < 0) navBack();
      else if (a === 'right' || a === 'ok') { zone = 'body'; paint(); if (sec < 0 && !findQ) askFind(); }      // pages of facts only scroll
      else if (a === 'left' || a === 'back') navBack();
      else if (a === 'green') Views.switchTab('live');
      else if (a === 'yellow' || a === 'search') openFind();
      return true;
    }
    if (a === 'yellow' || a === 'search') { openFind(); return true; }
    var it = items[sel];
    if (a === 'up' || a === 'down') {
      var d = a === 'up' ? -1 : 1, i = sel + d, G = parts[grp];
      while (i >= G.start && i < G.end && !focusable(i)) i += d;
      if (i >= G.start && i < G.end) { sel = i; paint(); }
      // Nothing more to pick that way in this part: notes still below are scrolled to first, then the next part.
      else if (scrollEl && d > 0 && (scrollEl._y || 0) > scrollMin() + 4) setScroll((scrollEl._y || 0) - Math.round(body.clientHeight * 0.6));
      else if (grp + d >= 0 && grp + d < parts.length) { grp += d; sel = firstIn(grp, d < 0); navSel = grp; build(); }
      else if (scrollEl) setScroll((scrollEl._y || 0) - d * Math.round(body.clientHeight * 0.6));
    }
    else if (a === 'chup') { for (var j = 0; j < 8; j++) keys('up'); }
    else if (a === 'chdown') { for (var k = 0; k < 8; k++) keys('down'); }
    else if (a === 'left') { if (it && it.cycle) it.cycle(-1); else { zone = 'nav'; navSel = parts.length > 1 ? grp : -1; paint(); } }
    else if (a === 'right') { if (it && it.cycle) it.cycle(1); }
    else if (a === 'ok') { if (it && it.action) it.action(); else if (it && it.cycle) it.cycle(1); }
    else if (a === 'back') { zone = 'nav'; navSel = parts.length > 1 ? grp : -1; paint(); }
    return true;
  }

  /* ---------- Search settings (discussion #60) ----------
     Yellow anywhere in Settings: type a word, and every setting whose name or note has it is listed with
     where it lives; OK on one goes there, focused.  Every section and the pages in them are looked
     through (what the phone app sees too), in your language and in English.  Long lists of your own
     things (groups, reminders, sources) are left out: they're not settings. */
  var findQ = '', findIx = null, findAt = 0;
  function findIndex() {
    if (findIx && Date.now() - findAt < 60000) return findIx;
    var out = [];
    function walk(secId, list, chain, trail, depth) {
      list = (list || []).filter(Boolean);
      if (list.length > 80) return;                          // a list of your own things, not settings
      list.forEach(function (it) {
        if (it.head || it.info || it.preview || it.raw || !it.label) return;
        /* Only TiviBro's own settings: a row named after one of your channels, teams, sources or groups (a page
           of them, like No guide wanted or a league's teams) isn't one (I18n.known: the translations have it). */
        var own = typeof it.label === 'string' && (!I18n.known || I18n.known(it.label));
        if (own) out.push({ sec: secId, chain: chain, trail: trail, label: it.label, sub: it.sub || '' });
        // A page that is another section (API keys from My media) is found under that section, once.
        if (it.page && depth < 3 && own && FNS.indexOf(it.page.fn) < 0) { var l2; try { l2 = it.page.fn(); } catch (e) { l2 = null; } walk(secId, l2, chain.concat([it.page]), trail.concat([it.page.title]), depth + 1); }
      });
    }
    SECTIONS.forEach(function (x, i) { if (!shown(i)) return; var l; try { l = FNS[i](); } catch (e) { l = null; } walk(x[0], l, [], [title(x)], 0); });
    findIx = out; findAt = Date.now();
    return out;
  }
  function norm1(t) { return ' ' + String(t || '').toLowerCase().replace(/[^0-9a-z\u00c0-\u024f\u0400-\u04ff]+/g, ' ').trim() + ' '; }
  function findPage() {
    var out = [action('Search for', findQ ? '' : 'Type a word: buffer, subtitles, clock, DNS…', askFind, function () { return findQ || '…'; })];
    if (!findQ) return out;
    var q = norm1(findQ).trim(), hits = [], seen = {};
    // The shortest way to each first (Guide before a playlist's own guide page).
    findIndex().slice().sort(function (a, b) { return a.trail.length - b.trail.length; }).forEach(function (r) {
      var name = norm1(T(r.label)) + norm1(r.label), note = norm1(r.sub ? T(r.sub) : '') + norm1(r.sub), key = r.label + '|' + r.sub;
      if (seen[key]) return;
      var w = name.indexOf(q) >= 0 ? 0 : note.indexOf(q) >= 0 ? 1 : -1;
      if (w < 0) return;
      seen[key] = 1; hits.push({ r: r, w: w });
    });
    hits.sort(function (a, b) { return a.w - b.w || a.r.trail.length - b.r.trail.length; });
    out.push(head(I18n.raw(I18n.t(hits.length === 1 ? '{n} setting' : '{n} settings', { n: hits.length }))));
    if (!hits.length) out.push(info('No setting has that in its name or its note.', ''));
    hits.slice(0, 60).forEach(function (h) {
      var r = h.r, it = action(I18n.raw(T(r.label)), I18n.raw(r.trail.map(function (x) { return T(x); }).join('  ›  ')), function () { goFound(r); }, function () { return '›'; });
      it.raw = true; out.push(it);
    });
    return out;
  }
  function askFind() {
    UI.prompt('Search settings', findQ, function (v) { findQ = String(v || '').trim().slice(0, 60); sel = 0; build(); }, 'A word from its name');
  }
  function openFind() {
    findIx = null; stack = []; sec = -1; sel = 0; zone = 'body'; build();
    askFind();
  }
  // To a setting found: its section, the pages above it, and the row itself focused.
  function goFound(r) {
    if (!section(r.sec)) return;
    r.chain.forEach(function (pg) { push(pg.title, pg.fn); });
    function at() { for (var i = 0; i < items.length; i++) if (items[i] && items[i].label === r.label && focusable(i)) return i; return -1; }
    var n = at();
    // An advanced setting with Advanced view off: into the page's Advanced row.
    if (n < 0) for (var j = 0; j < items.length; j++) if (items[j] && items[j].cls === 'adv-row' && items[j].page) { push(items[j].page.title, items[j].page.fn); n = at(); break; }
    if (n >= 0) sel = n;
    zone = 'body'; build();
  }

  /* ---------- Settings home (the overhaul): what needs you, the everyday sections as tiles with their
     current value, and every other section as a chip under them.  Every section shown in the list is on
     it (TILES first, the rest as chips, in SECTIONS order), so nothing is harder to reach than before.
     OK opens a section's page; Back from a section's list comes back here. ---------- */
  var homeEl = null, onHome = false, hsel = -1, hitems = [];
  var TILES = ['guide', 'sports', 'playback', 'audio', 'recording', 'reminders', 'vod', 'media'];
  var TILE_ICON = { guide: 'guide', sports: 'sports', playback: 'play', audio: 'audio', recording: 'rec', reminders: 'bell', vod: 'movies', media: 'media' };
  // One line under a tile: what it's set to now.  Anything that fails says nothing rather than something wrong.
  function tileLine(id) {
    var s = S(), out = '';
    try {
      if (id === 'guide') { var st = Epg.status || {}; out = Epg.loading ? T('Loading now') : st.at ? T('Loaded {x}', { x: when(st.at) }) : ''; }
      else if (id === 'sports') { var n = Teams.followed().length; out = n ? T(n === 1 ? '{n} team' : '{n} teams', { n: n }) + (s.sportsBar !== false ? '  ·  ' + T('scores on') : '') : T('No teams yet'); }
      else if (id === 'playback') out = s.memSafe ? T('Memory-safe') : '';
      else if (id === 'audio') out = s.subsAuto ? T('Subtitles automatically') : T('Subtitles off');
      else if (id === 'recording') { var sp = typeof Record !== 'undefined' && Record.space; out = sp ? T('USB drive, {x} free', { x: Math.round(sp.freeMB / 1024) + ' GB' }) : (typeof Record !== 'undefined' && Record.share ? T('Network share') : T('No USB drive')); }
      else if (id === 'reminders') { var r = (Store.edits.reminders || []).length; out = r ? T(r === 1 ? '{n} reminder' : '{n} reminders', { n: r }) : T('None set'); }
      else if (id === 'media') { var m = typeof MediaStore !== 'undefined' ? MediaStore.sources().length : 0; out = m ? T(m === 1 ? '{n} library' : '{n} libraries', { n: m }) : T('No libraries yet'); }
    } catch (e) { out = ''; }
    return out;
  }
  // What needs you: an update ready, else a short "all good" with the channel count.
  function homeStatus() {
    var up = typeof Update !== 'undefined' && Update.state && Update.state.state === 'available' && Update.state.latest;
    if (up) return { attn: true, title: T('Update ready: {x}', { x: Update.state.latest.version }), sub: T('OK opens it.  TiviBro restarts with all your settings.'), go: 'about' };
    var n = 0; try { n = L.count(); } catch (e) {}
    return { attn: false, title: T('Everything looks good'), sub: n ? T('{n} channels', { n: n }) + (tileLine('guide') ? '  ·  ' + T('Guide') + ': ' + tileLine('guide') : '') : '' };
  }
  function shownIds() { var out = []; SECTIONS.forEach(function (x, i) { if (shown(i)) out.push(x[0]); }); return out; }
  // Draws the home: search, what needs you, the tiles and the chips, each one a stop for the remote (hitems, by row and column).
  function homeBuild() {
    if (!homeEl) { homeEl = U.el('div', 'set-home hidden'); $('viewSettings').appendChild(homeEl); }
    homeEl.innerHTML = ''; hitems = [];
    var ids = shownIds(), st = homeStatus(), row = 0;
    var top = U.el('div', 'sh-top');
    top.appendChild(U.el('div', 'sh-title', T('Settings')));
    var find = U.el('div', 'sh-find'); find.appendChild(U.el('span', '', T('Search: subtitles, buffer, clock…'))); find.appendChild(U.el('b', 'k-yellow')); find.appendChild(U.el('em', '', T('Yellow')));
    top.appendChild(find); homeEl.appendChild(top);
    hitems.push({ el: find, row: row, col: 0, go: function () { onHome = false; openFind(); } });
    row++;
    var card = U.el('div', 'sh-status' + (st.attn ? ' attn' : ''));
    card.appendChild(U.el('b', '', st.title)); if (st.sub) card.appendChild(U.el('span', '', st.sub));
    homeEl.appendChild(card);
    if (st.go) { hitems.push({ el: card, row: row, col: 0, go: function () { goSection(st.go); } }); row++; }
    homeEl.appendChild(U.el('div', 'sh-head', T('Watching')));
    var grid = U.el('div', 'sh-grid'), col = 0;
    TILES.filter(function (id) { return ids.indexOf(id) >= 0; }).forEach(function (id) {
      var i = -1; SECTIONS.forEach(function (x, k) { if (x[0] === id) i = k; });
      var t = U.el('div', 'sh-tile'); t.appendChild(U.el('i', 'sh-ico ico-' + TILE_ICON[id]));
      t.appendChild(U.el('b', '', navTitle(SECTIONS[i]))); t.appendChild(U.el('span', '', tileLine(id)));
      grid.appendChild(t);
      hitems.push({ el: t, row: row + Math.floor(col / 4), col: col % 4, go: function () { goSection(id); } }); col++;
    });
    homeEl.appendChild(grid); row += Math.ceil(col / 4);
    homeEl.appendChild(U.el('div', 'sh-head', T('Everything else')));
    var chips = U.el('div', 'sh-chips'); col = 0;
    ids.filter(function (id) { return TILES.indexOf(id) < 0; }).forEach(function (id) {
      var i = -1; SECTIONS.forEach(function (x, k) { if (x[0] === id) i = k; });
      var c = U.el('div', 'sh-chip', navTitle(SECTIONS[i])); chips.appendChild(c);
      hitems.push({ el: c, row: row + Math.floor(col / 6), col: col % 6, go: function () { goSection(id); } }); col++;
    });
    homeEl.appendChild(chips);
    hitems.forEach(function (h, n) { h.el.addEventListener('click', function () { hsel = n; homePaint(); h.go(); }); h.el.addEventListener('mousemove', function () { if (UI.pointer && hsel !== n) { hsel = n; homePaint(); } }); });
    // First time: on the first tile (the search box is one press up).
    if (hsel < 0) hsel = hitems.findIndex(function (h) { return h.el.classList.contains('sh-tile'); });
    hsel = U.clamp(hsel, 0, hitems.length - 1);
    homePaint();
  }
  function homePaint() { hitems.forEach(function (h, n) { h.el.classList.toggle('focus', n === hsel); }); }
  function homeShow(on) {
    onHome = on;
    if (on) homeBuild(); else if (homeEl) homeEl.classList.add('hidden');
    if (homeEl && on) homeEl.classList.remove('hidden');
    $('viewSettings').classList.toggle('home', on);
  }
  function goSection(id) { homeShow(false); for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === id && shown(i)) { sec = i; stack = []; sel = 0; zone = 'body'; build(); return; } }
  // The remote on the home: arrows move between rows (to the nearest column), OK opens, Back goes to the menu bar.
  function homeKeys(a) {
    var h = hitems[hsel]; if (!h) return true;
    if (a === 'left' || a === 'right') {
      var same = hitems.map(function (x, n) { return n; }).filter(function (n) { return hitems[n].row === h.row; }), k = same.indexOf(hsel) + (a === 'left' ? -1 : 1);
      if (k >= 0 && k < same.length) hsel = same[k]; else if (a === 'left') Views.tabBar(function () { UI.setHandler(keys); homePaint(); });
    } else if (a === 'up' || a === 'down') {
      var r = h.row + (a === 'up' ? -1 : 1), best = -1;
      hitems.forEach(function (x, n) { if (x.row === r && (best < 0 || Math.abs(x.col - h.col) < Math.abs(hitems[best].col - h.col))) best = n; });
      if (best >= 0) hsel = best; else if (a === 'up') Views.tabBar(function () { UI.setHandler(keys); homePaint(); });
    } else if (a === 'ok') { h.go(); return true; }
    else if (a === 'yellow' || a === 'search') { homeShow(false); openFind(); return true; }
    else if (a === 'back') { Views.tabBar(function () { UI.setHandler(keys); homePaint(); }); return true; }
    else if (a === 'green') { Views.switchTab('live'); return true; }
    homePaint();
    return true;
  }

  function open() {
    if (!stack.length) zone = 'nav';
    UI.setHandler(keys);
    UI.hints([['', '◀ ▶  change value'], ['', 'OK  select'], ['', 'Back  the list on the left, then Settings'], ['yellow', 'Search settings']]);
    build();
    // Coming to Settings from the menu: the home first.  A section opened by name (section(), always called
    // after switching to Settings) hides it again.
    if (!stack.length && zone === 'nav') homeShow(true);
  }

  // One playlist's page (after it closed TiviBro, or most of its channels fail; issue #25).
  function openPlaylist(id) {
    var raw = S().playlists.filter(function (x) { return x.id === id; })[0];
    if (!raw || !section('playlists')) return false;
    var p = Store.normalize(raw);
    push(p.name ? I18n.raw(p.name) : 'Playlist', function () { return playlistPage(p); });
    return true;
  }

  // Straight to one section (the phone app's own shortcut, and tests).
  function section(id) {
    if (id === 'phone' && !phoneOK()) return false;
    homeShow(false);
    if (ALIAS[id]) id = ALIAS[id];
    var pg = pageOf(id);
    if (pg && pg.it) { sec = pg.i; stack = []; sel = pg.n; zone = 'body'; push(pg.it.page.title, pg.it.page.fn); return true; }
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === id && shown(i)) { sec = i; stack = []; sel = 0; zone = 'body'; build(); return true; } return false; }

  /* Settings from the phone app (ask "settings" in phone.js): the same pages, built by the same code, as
     data the phone draws.  A page is a section plus the page rows followed into it (path, by row).  Each
     row: head, info, toggle, choice (with its choices), cycle (◀ ▶ only), page, or action (which runs on
     the TV, so a box or menu it opens shows there; the phone can type into boxes).  After a change the
     page is built again and sent back, so rows that depend on others appear or go. */
  function rowsOf(secId, path) {
    if (ALIAS[secId]) secId = ALIAS[secId];
    var pg0 = pageOf(secId);
    if (pg0 && pg0.n >= 0) { secId = SECTIONS[pg0.i][0]; path = [pg0.n].concat(path || []); }
    var i = -1; for (var x = 0; x < SECTIONS.length; x++) if (SECTIONS[x][0] === secId) i = x;
    if (i < 0) throw new Error('No such settings page');
    var list = shape(FNS[i], SECTIONS[i][1]), title = title0(SECTIONS[i]), trail = [title];
    (path || []).forEach(function (n) {
      var it = list[n];
      var pg = it && (it.page || it.phonePage);
      if (!pg) throw new Error('That page has changed on the TV.  Go back and open it again.');
      title = pg.title && typeof pg.title === 'object' && pg.title.s != null ? String(pg.title.s) : pg.title;   // a name kept as written (I18n.raw) is plain text for the phone
      trail.push(title); list = shape(pg.fn, title);
    });
    return { title: title, trail: trail, list: list };
  }
  function title0(sct) { return title(sct); }
  function rowData(it, n) {
    var v = '';
    try { v = it.value ? String(it.value() || '') : ''; } catch (e) {}
    var r = { i: n, label: String(it.phoneLabel != null ? it.phoneLabel : it.label || ''), sub: it.sub ? String(it.sub) : '' };
    if (it.head) r.kind = 'head';
    else if (it.info) { r.kind = 'info'; r.value = v; }
    else if (it.toggle) { r.kind = 'toggle'; r.on = !!it.get(); }
    else if (it.values) { r.kind = 'choice'; r.options = it.labels.map(String); r.cur = it.values.indexOf(it.get()); r.value = v; }
    else if (it.cycle) { r.kind = 'cycle'; r.value = v; }
    else if (it.page || it.phonePage) { r.kind = 'page'; r.value = v === '›' ? '' : v; }
    else if (it.action) { r.kind = 'action'; r.value = v; }
    else { r.kind = 'info'; r.value = v; }
    if (it.swatch) try { r.swatch = it.swatch() || ''; } catch (e) {}
    if (it.phone) { r.phone = it.phone; if (it.sid) r.sid = it.sid; if (it.epage) r.epage = it.epage; if (it.ptype) r.ptype = it.ptype; }
    if (it.tv) r.tv = 1;
    if (it.move) r.move = 1;              // can be dragged to another place (op "move")
    if (it.go) r.go = it.go;                // a row that opens another section (link): the phone opens it there
    // The row's look (the Settings overhaul): its kind, whether it wants you, a tip or a jump, the first sentence.
    r.look = kindOf(it);
    if (it.attn) r.attn = 1;
    if (it.cls === 'tip' || it.cls === 'jump' || it.cls === 'adv-row') r.style = it.cls;
    // Buttons that do something right away look like buttons on the phone and in the web editor: a "now"
    // (Reload guide now) is the main one on its page; one that deletes or resets is red and asks first.
    if (r.look === 'action' && !it.go) { var t = actionTone(r.label); if (t) r.tone = t; }
    if (r.sub) { var b1 = brief(r.sub); if (b1 !== r.sub) r.brief = b1; }
    return r;
  }
  /* A button pressed on the phone asks its questions on the phone.  While it runs (and for a while
     after, as answers can take a moment), a box, menu or "are you sure" it opens, and the toasts it
     shows, go to the phone instead of the TV's screen: the answer carries { dialog } and the phone
     shows it, then answers with op "answer".  Nothing appears on the TV.  Rows the phone does all by
     itself carry phone (phoneDoes); rows that only make sense on the TV's screen carry tv: 1. */
  var cap = null, dlgN = 0, asked = {};          // asked: recent questions by id, to answer one that timed out
  function startCapture() {
    endCapture();
    var c = cap = { dialog: null, toasts: [], last: Date.now(), wake: null, orig: { menu: UI.menu, prompt: UI.prompt, confirm: UI.confirm, toast: U.toast } };
    function got(d) {
      if (cap !== c) return false;
      d.id = 'd' + (++dlgN); c.dialog = d; c.last = Date.now();
      var t = Date.now(); Object.keys(asked).forEach(function (k) { if (t - asked[k].at > 3600e3) delete asked[k]; });
      asked[d.id] = { kind: d.kind, title: d.title, from: c.from, at: t };
      if (c.wake) c.wake(); return true;
    }
    UI.menu = function (title, items, onBack) { var list = (items || []).filter(Boolean); if (!got({ kind: 'menu', title: String(title || ''), items: list.map(function (x) { return { label: String(x.label || ''), sub: x.sub ? String(x.sub) : '', current: !!x.current }; }), _items: list, _back: onBack })) c.orig.menu.apply(UI, arguments); };
    UI.prompt = function (title, value, done, hint, secret, okLabel) { if (!got({ kind: 'prompt', title: String(title || ''), value: String(value == null ? '' : value), hint: hint ? String(hint) : '', secret: !!secret, ok: okLabel ? String(okLabel) : '', _done: done })) c.orig.prompt.apply(UI, arguments); };
    UI.confirm = function (title, yesLabel, yes) { if (!got({ kind: 'confirm', title: String(title || ''), ok: String(yesLabel || 'OK'), _yes: yes })) c.orig.confirm.apply(UI, arguments); };
    U.toast = function (m) { if (cap !== c) return c.orig.toast.apply(U, arguments); c.toasts.push(String(m)); c.last = Date.now(); if (c.wake) c.wake(); };
    c.timer = setTimeout(endCapture, 60000);                       // nobody answered: back to normal
    return c;
  }
  function endCapture() {
    if (!cap) return;
    var o = cap.orig; clearTimeout(cap.timer);
    UI.menu = o.menu; UI.prompt = o.prompt; UI.confirm = o.confirm; U.toast = o.toast;
    cap = null;
  }
  // After a step: wait for a box or menu, or for the toasts to settle (up to 8 s for slow checks).
  function settle(c, secId, path) {
    var started = Date.now();
    return new Promise(function (resolve) {
      function check() {
        c.wake = null;
        var quiet = Date.now() - c.last;
        if (c.dialog || (quiet > 700 && (c.toasts.length || Date.now() - started > 1500)) || Date.now() - started > 8000) return done();
        c.wake = check; setTimeout(check, 250);
      }
      function done() {
        c.wake = null;
        var d = c.dialog, out = { msg: c.toasts.join('  '), page: null };
        c.toasts = [];
        try { out.page = forPhone.page(secId, path); } catch (e) {}
        if (d) out.dialog = { id: d.id, kind: d.kind, title: d.title, items: d.items, value: d.value, hint: d.hint, secret: d.secret, ok: d.ok };
        else endCapture();
        resolve(out);
      }
      setTimeout(check, 120);
    });
  }
  var forPhone = {
    _timeout: function () { endCapture(); },          // tests: as if a minute passed
    _convUnknown: function () { convSt = null; convAt = 0; },     // tests: as if Settings had just started
    /* Before a page goes to the phone: the audio converter's state, read in the background, is known (up to 3 s).
       Without it the phone got "checking…" for good and a "Get the converter now" that, by the time it was
       pressed, had become "The converter comes with TiviBro": "That can't be changed that way". */
    ready: function () {
      if (typeof Convert === 'undefined' || convSt || typeof Net === 'undefined' || !Net.port) return Promise.resolve();
      return Promise.race([Convert.status(true).then(function (x) { convSt = x; convAt = Date.now(); }), new Promise(function (r) { setTimeout(r, 3000); })]);
    },
    sections: function () { return SECTIONS.filter(function (x, i) { return shown(i); }).map(function (x) { return { id: x[0], title: title(x) }; }); },
    /* Search every setting, for the phone and the web editor's search box: each hit with its section and the rows
       to follow to its page (the same path page() takes), best matches first (name before note). */
    find: function (q) {
      q = norm1(q).trim(); if (q.length < 2) return [];
      var hits = [], seen = {};
      findIndex().forEach(function (r) {
        var name = norm1(T(r.label)) + norm1(r.label), note = norm1(r.sub ? T(r.sub) : '') + norm1(r.sub), key = r.label + '|' + r.sub;
        var w = name.indexOf(q) >= 0 ? 0 : note.indexOf(q) >= 0 ? 1 : -1;
        if (w < 0 || seen[key]) return;
        seen[key] = 1; hits.push({ r: r, w: w });
      });
      hits.sort(function (a, b) { return a.w - b.w || a.r.trail.length - b.r.trail.length; });
      return hits.slice(0, 40).map(function (h) {
        var r = h.r, path = [], list = null, i = -1;
        for (var x = 0; x < SECTIONS.length; x++) if (SECTIONS[x][0] === r.sec) i = x;
        try {
          list = shape(FNS[i], SECTIONS[i][1]);
          r.chain.forEach(function (pg) {
            var n = list.findIndex(function (it) { var p = it && (it.page || it.phonePage); return p && p.fn === pg.fn; });
            if (n < 0) throw new Error('moved');
            path.push(n); list = shape(pg.fn, pg.title);
          });
        } catch (e) { return null; }
        return { label: String(T(r.label)), sub: r.sub ? brief(String(T(r.sub))) : '', trail: r.trail.map(function (t) { return String(T(t)); }).join('  ›  '), sec: r.sec, path: path };
      }).filter(Boolean);
    },
    page: function (secId, path) { var p = rowsOf(secId, path); return { title: p.title, trail: p.trail, rows: p.list.map(rowData).filter(function (r, n) { return !p.list[n].preview; }) }; },   // pictures (a preview, the TMDB credit) stay on the TV
    // op: 'toggle' (on), 'choice' (v: the choice's index), 'cycle' (dir), 'action', 'answer' (to a dialog).
    change: function (secId, path, n, op, a) {
      if (op === 'answer') {
        var c = cap, d = c && c.dialog;
        if (!d || d.id !== String(a.dialog || '')) {
          /* The TV stopped waiting after a minute (someone took longer to copy an API key, say): ask the
             same question again behind the scenes and give it this answer, so it isn't lost. */
          var was = asked[String(a.dialog || '')];
          endCapture();
          if (was && was.from && !a.cancel) {
            var again = rowsOf(was.from.sec, was.from.path).list[was.from.n];
            if (again && again.action && !again.page && !again.tv) {
              var c4 = startCapture(); c4.from = was.from;
              try { again.action(); } catch (e) { endCapture(); throw e; }
              var d4 = c4.dialog;
              if (d4 && d4.kind === was.kind && d4.title === was.title) { a.dialog = d4.id; return forPhone.change(secId, path, n, 'answer', a); }
              endCapture();
            }
          }
          throw new Error('The TV stopped waiting for that answer.  Press the button again.');
        }
        c.dialog = null;
        if (!a.cancel) {
          if (d.kind === 'prompt') d._done(String(a.value == null ? '' : a.value).slice(0, 4000));
          else if (d.kind === 'confirm') d._yes();
          else { var it = d._items[+a.choice]; if (!it) throw new Error('Not one of the choices'); if (it.action) it.action(); }
        } else if (d.kind === 'menu' && d._back) d._back();
        Store.saveSettings();
        return settle(c, secId, path);
      }
      var p = rowsOf(secId, path), it2 = p.list[n], msg = '';
      if (!it2) throw new Error('That setting has changed on the TV.  Look again.');
      if (op === 'toggle' && it2.toggle) { if (!!it2.get() !== (a.on !== false)) it2.set(a.on !== false); }
      else if (op === 'choice' && it2.values) { var v = it2.values[+a.v]; if (v === undefined) throw new Error('Not one of the choices'); if (it2.get() !== v) it2.set(v); }
      else if (op === 'cycle' && it2.cycle) it2.cycle(+a.dir < 0 ? -1 : 1);
      else if (op === 'move' && it2.move) it2.move(Math.max(-500, Math.min(500, Math.round(+a.by) || 0)));
      else if (op === 'action' && it2.action && !it2.page) {
        if (it2.tv) { it2.action(); Store.saveSettings(); return { msg: 'On the TV\'s screen now', page: forPhone.page(secId, path) }; }
        var c2 = startCapture(); c2.from = { sec: secId, path: path, n: n };
        try { it2.action(); } catch (e) { endCapture(); throw e; }
        Store.saveSettings();
        return settle(c2, secId, path);
      }
      // The row isn't what the phone showed (it changed on the TV meanwhile): the page as it is now.
      else return { msg: 'That changed on the TV.  Here it is now.', page: forPhone.page(secId, path) };
      Store.saveSettings();
      return { msg: msg, page: forPhone.page(secId, path) };
    }
  };

  // Drawn again in a new language (I18n.onChange in app.js).
  function redraw() { if (!document.getElementById('viewSettings').classList.contains('hidden')) build(); }
  return { capturing: function () { return !!cap; }, dns: { ids: DNS_IDS, names: DNS_NAMES, ask: askDns }, open: open, redraw: redraw, assignGuide: assignGuide, section: section, openPlaylist: openPlaylist, openTeams: openTeams, live: live, reset: function () { stack = []; sel = 0; }, phone: forPhone,
    LOOK: { ACCENTS: ACCENTS, ACCENT_NAMES: ACCENT_NAMES, THEMES: THEMES, THEME_NAMES: THEME_NAMES, THEME_INK: THEME_INK } };
})();
