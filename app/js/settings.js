/* Settings.  Left/right changes a value in place, OK opens or cycles, Back goes up a page. */
var Settings = (function () {
  'use strict';
  var $ = U.$, S = function () { return Store.settings; }, L = Library;
  var nav = $('setNav'), body = $('setBody');
  var SECTIONS = [['playlists', 'Playlists'], ['guide', 'Guide'], ['channels', 'Channels and groups'], ['names', 'Channel and group names'], ['reminders', 'Reminders and watchlist'],
    ['playback', 'Playback'], ['media', 'My media'], ['remote', 'Remote and buttons'], ['look', 'Appearance and start screen'], ['parental', 'Parental controls'],
    ['backups', 'Backups and restore points'], ['connect', 'Phone app and web editor'], ['about', 'Updates, about and diagnostics']];
  // Old section ids (links in other screens, tests, older phone apps) still land somewhere sensible.
  var ALIAS = { groups: 'channels', updates: 'about', diag: 'about', phone: 'connect', editor: 'connect', watchlist: 'reminders' };
  var sec = 0, zone = 'nav', sel = 0, items = [], scrollEl = null, rowEls = [];
  // Phone app: test builds only while the Android app is in the works (release builds show the web editor alone).
  function phoneOK() { return /alpha|beta/i.test(TIVIBRO_VERSION); }
  function shown(i) { return !!SECTIONS[i]; }
  function title(sct) { return sct[0] === 'connect' && !phoneOK() ? 'Web editor' : sct[0] === 'about' && typeof Update !== 'undefined' && Update.state && Update.state.state === 'available' ? sct[1] + '  ·  update ready' : sct[1]; }
  function nextSec(d) { var i = sec + d; while (SECTIONS[i] && !shown(i)) i += d; return SECTIONS[i] ? i : sec; }
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
  function head(t) { return { head: true, label: t }; }
  function info(label, value) { return { label: label, info: true, value: function () { return value; } }; }
  function page(label, sub, title, fn, value) { var it = action(label, sub, function () { push(title, fn); }, value || function () { return '›'; }); it.page = { title: title, fn: fn }; return it; }
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
    out.push(choice('Buffer info on demand', Keymap.bufferHint() + ' shows the buffer meter and stream info, even with the meter off.  Press again to hide it.  Any button can do this: Settings > Remote and buttons.',
      [5, 10, 30, 0], ['5 seconds', '10 seconds', '30 seconds', 'Until pressed again'], function () { return s.meterPeek == null ? 10 : +s.meterPeek; }, function (v) { s.meterPeek = v; save(); }));
    out.push(toggle('Preview on the Channels screen', 'Plays the channel you rest on.  Turn off on very slow TVs for the snappiest list.', function () { return s.previewPlay; }, function (v) { s.previewPlay = v; save(); }));
    out.push(choice('When a channel stops working', 'Switches to another version of the same channel, such as the HD copy of a Full HD channel, or one you hid.  It only happens once the player has run out of retries.',
      ['auto', 'ask', 'off'], ['Switch to another version', 'Ask me', 'Keep retrying'], function () { return s.backups || 'auto'; }, function (v) { s.backups = v; save(); }));
    out.push(toggle('Turn on last channel at launch', '', function () { return s.resumeLast; }, function (v) { s.resumeLast = v; save(); }));
    out.push(choice('HDR and Dolby Vision', 'Automatic plays Dolby Vision through the TV player, which switches the screen into Dolby Vision itself, and keeps HDR10 and HLG on the built-in player for its steadier buffering.  Choose TV player for all HDR if HDR pictures look washed out or grey.',
      ['auto', 'tv', 'builtin'], ['Automatic', 'TV player for all HDR', 'Built-in player'], function () { return s.hdrRoute || 'auto'; }, function (v) { s.hdrRoute = v; save(); }));
    out.push(choice('Aspect', 'The shape of the picture for every channel and video: Original, Fill (stretched to the screen), Zoom (fills it, edges cropped), 4:3, 16:9 (for a squashed picture), 21:9 (a 2.35:1 film fills the screen) or 4:3 to 16:9.  A channel or video can have its own from the quick menu.',
      Player.ASPECTS.map(function (a) { return a[0]; }), Player.ASPECTS.map(function (a) { return a[1]; }), function () { return Player.displayFor(null); }, function (v) { Player.setAspect(v, null); save(); }));
    out.push(head('Catch-up, movies and shows'));
    out.push(choice('Skip step', 'For Left and Right while watching catch-up or a movie.', [10, 15, 30, 60, 120], ['10s', '15s', '30s', '1 min', '2 min'], function () { return +s.skip; }, function (v) { s.skip = v; save(); }));
    out.push(choice('Rewind / fast forward step', 'For the ◀◀ and ▶▶ buttons while watching catch-up or a movie.', [30, 60, 120, 300, 600], ['30s', '1 min', '2 min', '5 min', '10 min'], function () { return +s.ffStep || 120; }, function (v) { s.ffStep = v; save(); }));
    out.push(choice('◀ on a live channel with catch-up', 'Without catch-up, ◀ always goes to the last channel.', ['rewind', 'last'], ['Rewind', 'Last channel'], function () { return s.rewindLeft === false ? 'last' : 'rewind'; }, function (v) { s.rewindLeft = v === 'rewind'; save(); }));
    out.push(head('Switching channels'));
    out.push(toggle('Info panel when switching channels', 'Off shows just the number and name.', function () { return s.osdOnZap !== false; }, function (v) { s.osdOnZap = v; save(); }));
    out.push(toggle('Show stream details in the info panel', 'Resolution and which player is in use.', function () { return s.osdMedia !== false; }, function (v) { s.osdMedia = v; save(); }));
    out.push(toggle('Keep the picture while reconnecting', 'When a channel drops for a moment, the last picture stays on screen with a small Reconnecting notice instead of going black.  Not every stream allows it (the TV player draws some itself).', function () { return s.holdFrame !== false; }, function (v) { s.holdFrame = v; save(); }));
    out.push(toggle('Black screen while switching', 'Hides the last picture until the next channel starts.', function () { return !!s.blackSwitch; }, function (v) { s.blackSwitch = v; save(); }));
    out.push(head('Audio and subtitles'));
    out.push(action('Audio language', 'Try this language first when a channel or movie has several audio tracks.  If it is missing, the fallback language below, else the stream\'s own track.  Track language labels must be supplied by the file or stream.', function () {
      langMenu('Audio language', 'The stream\'s own choice', s.audioLang, function (v) { s.audioLang = v; save(); });
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
    out.push(head('Subtitles from OpenSubtitles'));
    out.push(action('Subtitle languages', 'For Find subtitles (Subtitles in a movie or show\'s menu).  Several at once: English and Spanish (Latin America), say.', function () { Subs.langMenu(function () { build(); }); },
      function () { return Subs.langs().map(Subs.langName).join(', '); }));
    out.push(action(Subs.configured ? 'OpenSubtitles API key saved' : 'Add your OpenSubtitles API key', 'Free: sign up at opensubtitles.com, then Profile > API consumers > New consumer, and copy its key here.  It stays on this TV, out of backups.', function () {
      UI.prompt('OpenSubtitles API key', '', function (k) { try { Subs.setKey(k); U.toast(k.trim() ? 'API key saved' : 'API key removed'); build(); } catch (e) { U.toast(e.message, 7000); } }, 'Empty removes it.  Typing is easier from the phone app.', true);
    }, function () { return Subs.configured ? 'Saved' : 'Not set'; }));
    if (Subs.configured) out.push(action(Subs.user ? 'Signed in as ' + Subs.user : 'Sign in (optional)', 'Without an account OpenSubtitles allows 5 downloads a day; with a free one, 20.', function () {
      UI.prompt('OpenSubtitles username', Subs.user, function (u) {
        if (!u.trim()) { Subs.signIn('', ''); U.toast('Signed out'); build(); return; }
        UI.prompt('Password for ' + u.trim(), '', function (p) {
          U.toast('Signing in…');
          Subs.signIn(u, p).then(function (n) { U.toast('Signed in' + (n ? ': ' + n + ' downloads a day' : '')); build(); }, function (e) { U.toast(e.message, 6000); build(); });
        }, 'Kept on this TV only, to sign in again each day.', true);
      }, 'Empty signs out.');
    }, function () { return Subs.user ? (Subs.allowed ? Subs.allowed + ' a day' : 'Signed in') : '5 a day'; }));
    out.push(toggle('Play next episode automatically', '', function () { return s.autoNext !== false; }, function (v) { s.autoNext = v; save(); }));
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
    if (ready && !/TIVIBRO_FFMPEG/.test(convSt.where || '')) out.push(action('Remove the converter', 'Frees about 3 MB of the TV\'s storage.  TiviBro offers it again when a movie needs it.', function () {
      Convert.remove().then(function (x) { convSt = x; s.convertAsked = false; save(); U.toast('Audio converter removed'); build(); }, function (e) { U.toast(e.message, 5000); });
    }));
    else if (!ready) out.push(action('Get the converter now', 'Downloads it (about 2 MB) from TiviBro\'s releases on GitHub, checks its fingerprint and keeps it on the TV\'s storage, so movies don\'t wait for it.', function () {
      if (!Net.port) { U.toast('The network helper is not running', 4000); return; }
      U.toast('Getting the audio converter…', 30000);
      Convert.get(function (pc) { convSt = { state: 'downloading', percent: pc }; paint(); }).then(function (x) { convSt = x; U.toast('Audio converter ready', 3000); build(); },
        function (e) { convAt = 0; convFresh(); U.toast(e.message, 7000); build(); });
    }));
    return out;
  }

  /* A button the phone app does on the phone itself (a form there instead of boxes on the TV), when it
     knows how: rowData sends the name.  Older phone apps run it on the TV as before. */
  function phoneDoes(name, it) { it.phone = name; return it; }
  // A button that only makes sense on the TV's own screen (it waits for a remote button, or shows a QR code).
  function tvOnly(it) { it.tv = 1; return it; }
  /* Your TMDB token: in Settings > My media and in Settings > Guide > Movies in the guide (Movies on now uses it too). */
  function tmdbRows() {
    var hasToken = MediaStore.preferences().tmdbConfigured;
    return [
      phoneDoes('tmdb-token', action(hasToken ? 'TMDB API token saved' : 'Add TMDB API token', hasToken ? 'Token saved on this TV.  Select to replace it, or use the web editor.' : 'Create your own free API key or Read Access Token at themoviedb.org/settings/api.  The web editor is easier for pasting it.  It gives My media its posters and details, and finds the movies in your guide.', function () { UI.prompt(hasToken ? 'Replace TMDB API token' : 'TMDB API key or Read Access Token', '', function (token) { if (!token.trim()) return; U.toast('Checking TMDB access…'); Media.setTmdbToken(token).then(function () { U.toast('TMDB token saved on this TV'); if (typeof Movies !== 'undefined') Movies.poke(); live(); }, function (e) { U.toast(e.message, 6000); }); }, 'The token stays on this TV and is excluded from backups.', true); }, function () { return MediaStore.preferences().tmdbConfigured ? 'Saved' : 'Not set'; })),
      hasToken && action('Test TMDB token', 'Asks TMDB now whether the saved token works.', function () { U.toast('Checking the TMDB token…'); Media.testTmdbToken().then(function (m) { U.toast(m, 5000); }, function (e) { U.toast(e.message, 7000); }); }),
      hasToken && action('Remove TMDB token', 'Saved movie details remain available.', function () { Media.setTmdbToken('').then(function () { if (typeof Movies !== 'undefined') Movies.poke(); live(); }); })
    ].filter(Boolean);
  }
  /* ---------- My media: source management and preferences live outside the movie browser ---------- */
  var mediaLoaded = false;
  function media() {
    if (!mediaLoaded) { mediaLoaded = true; MediaStore.load().then(live); }
    var names = { en: 'English', nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian' };
    var hasToken = MediaStore.preferences().tmdbConfigured;
    var out = [head('Your media library'),
      info('Movies and TV shows from your own media servers (DLNA / UPnP, or a WebDAV folder).  Files can be at the top level or in folders.  Choose what each source holds: movies, TV shows or both.  The phone app does all of this too, with the typing on the phone.', ''),
      phoneDoes('media-add', action('Add media', 'Find a DLNA / UPnP server, or enter a WebDAV folder address and login.  Subfolders are scanned too.', function () { Media.addMenu(); })),
      tvOnly(action('Edit on a computer', 'Shows a code for a computer or phone browser: the web editor\'s My media page, for typing server logins and fixing TV show episodes.', function () { WebEdit.showJoin('media'); })),
      action('Rescan media sources', 'Look for movies and episodes.  Green on the My media screen.', function () { Media.rescanAll(); }),
      action('Fetch media details', 'Look up movies, shows and owned episodes.  Refresh outdated language details.  Yellow on My media.', function () { Media.fetchMissingDetails(); }),
      head('Preferences')].concat(tmdbRows(), [
      choice('Sort movies by', 'Applies to Movies and Favorites.  Continue watching stays ordered by recent playback.', ['name', 'release', 'added'], ['Name (A–Z)', 'Release date (newest first)', 'Date added (newest first)'], function () { return MediaStore.preferences().sort; }, function (v) { Media.updatePreferences({ sort: v }); paint(); }),
      choice('Sort TV shows by', 'Applies to TV shows and favorite shows, on the TV and the phone.  Continue watching stays ordered by recent playback.', ['name', 'release', 'added'], ['Name (A–Z)', 'First aired (newest first)', 'Date added (newest first)'], function () { return MediaStore.preferences().showSort; }, function (v) { Media.updatePreferences({ showSort: v }); Media.refreshShows(); paint(); }),
      toggle('Favorites also in lists', 'On: a favorite movie or show is in Favorites and also in Movies or TV shows.  Off: only in Favorites.', function () { return MediaStore.preferences().favoritesInLists; }, function (v) { Media.updatePreferences({ favoritesInLists: v }); paint(); }),
      choice('Metadata language', 'Shared with the web editor.  Refreshes saved movie and show matches in this language.  Missing translations fall back to English.', Object.keys(names), Object.keys(names).map(function (k) { return names[k]; }), function () { return MediaStore.preferences().language; }, function (v) { Media.updatePreferences({ language: v }); paint(); }),
      head('Media sources')]);
    MediaStore.publicSources().forEach(function (s) {
      var row = phoneDoes('media-source', action(s.name, (s.type === 'dlna' ? 'DLNA / UPnP' : 'WebDAV') + ' · rescan, content, details or remove', function () { Media.sourceMenu(s); }, function () { return MediaStore.movies(s.id).length + ' movies'+(s.episodeFiles?' · '+s.episodeFiles+' episode files':''); }));
      row.sid = s.id; out.push(row);
    });
    if (!MediaStore.sources().length) out.push(info('No media sources yet', 'Choose Add media above'));
    return out;
  }

  /* ---------- remote ---------- */
  function remote() {
    var out = [];
    out.push(page('In the player', 'Fullscreen live TV.', 'Buttons in the player', function () { return keysPage('player'); }));
    out.push(page('In the guide', 'The colour buttons, Play, Info, Stop and Hold OK.  Arrows, OK and Back stay fixed so you can always get around.', 'Buttons in the guide', function () { return keysPage('guide'); }));
    out.push(page('On the Channels screen', 'The plain channel browser.  Arrows, OK and Back stay fixed.', 'Buttons on the Channels screen', function () { return keysPage('list'); }));
    out.push(page('Quick menu buttons', 'Which buttons show when you press OK in fullscreen.', 'Quick menu buttons', function () {
      var o = [], off = S().qpHidden || (S().qpHidden = {});
      o.push(info('Buttons only appear when they apply, e.g. Audio needs two or more tracks.', ''));
      Views.QP_BUTTONS.forEach(function (b) {
        o.push(toggle(b[1], '', function () { return !off[b[0]]; }, function (v) { if (v) delete off[b[0]]; else off[b[0]] = 1; save(); }));
      });
      return o;
    }));
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
      if (b[0] !== 'back' && !((ctx === 'list' || ctx === 'guide') && arrowish[b[0]]) && !(ctx === 'guide' && (b[0] === 'rew' || b[0] === 'ff'))) out.push(slot('long:' + b[0], 'Hold ' + b[1]));
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
    out.push(action('Add playlist…', 'Each playlist keeps its own groups, favorites, hidden items, guide and name rules.  Adding one from the phone app is easier: share your provider\'s link to it.', function () { App.setup('new'); }));
    out.push(info('The guide, names and channels of the playlist in use are under Guide, Channel and group names, and Channels and groups.', ''));
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
      if (App.reloading) out.push(action('Stop reloading', 'The channels from the last load stay.', function () { App.stopReload(); }));
      else out.push(action('Reload channels now', 'Your groups, renames and hidden items are kept.', function () { App.refresh(true); }));
      out.push(info('Last reloaded', when(L.data.at)));
      if (L.data.exp) out.push(info('Subscription expires', new Date(L.data.exp).toLocaleDateString() + (Store.expiry(p) ? '  (' + Store.expiry(p).replace(/^Expire[sd] /, '') + ')' : '')));
      if (L.data.maxConn) out.push(info('Connections allowed', String(L.data.maxConn)));
    }
    out.push(head('This playlist\'s guide, names and events'));
    out.push(page('Guide', 'The provider\'s guide, your guide sources and public fill-in for this playlist', 'Guide: ' + (p.name || 'playlist'), function () { return guideRows(p); }));
    if (active) out.push(tvOnly(action('Set-up tour', 'Countries, channel names, East or West, your city, event channels, clutter, logos and look, one screen at a time.', function () { Tour.open({ from: 'settings' }); }, function () { return p.tour > 0 ? 'done ' + when(p.tour) : '›'; })));
    out.push(page('Channel and group names', p.names && p.names.enabled ? 'On' : 'Off', 'Channel and group names', function () { return namesPage(p); }));
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

  /* One playlist's guide (the Guide section shows the one in use; each playlist's page has its own). */
  function guideRows(p) {
    var out = [], active = p.id === S().active, xc = p.type === 'xtream';
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
    out.push(page('Public guide fill-in', 'Free guides (epg.pw, iptv-epg.org, and Pluto TV\'s own for Pluto channels), only for channels nothing else covers', 'Public guide fill-in', function () { return pubPage(p); }, function () { return PubEpg.conf(p).on ? 'On' : 'Off'; }));
    if (active) {
      out.push(action('Reload guide now', '', function () { Epg.refresh(L, true); U.toast('Reloading guide'); live(); }));
      var st = Epg.status;
      if (Epg.xml) {
        out.push(info('Guide last loaded', Epg.loading || (Epg.progress && Epg.progress.active) ? 'loading now' : when(st.at)));
        (st.sources || []).forEach(function (r) { out.push(info(r.url.replace(/(password|pass)=[^&]+/i, '$1=…'), r.ok ? r.channels + ' channels, ' + r.programmes + ' programmes' : 'failed: ' + r.error)); });
        var all = L.data.channels, n = 0, missing = [];
        all.forEach(function (c) { if (Epg.hasData(c)) n++; else if (!L.noGuide(c) && missing.length < 300) missing.push(c); });
        out.push(info('Channels with guide data', n + ' of ' + all.length));
        if (missing.length) out.push(action('Assign guide to channels without one', 'Or hold OK on any channel and choose Assign guide.  A channel that will never have a guide: hold OK > No guide for this channel.', function () {
          UI.menu('Channels without guide', missing.map(function (c) { return { label: L.name(c), sub: L.groupName(c.g), action: function () { assignGuide(c); } }; }));
        }));
      }
      // Channels you said need no guide (Hold OK > No guide for this channel, or Ignore in the web editor).
      var none = L.data.channels.filter(function (c) { return L.noGuide(c); });
      if (none.length) out.push(page('Channels with no guide wanted', 'Left out of guide matching and public fill-in, and they don\'t say "No guide information".', 'No guide wanted', function () {
        var o = [info('Select one to look for a guide for it again.', '')];
        L.data.channels.filter(function (c) { return L.noGuide(c); }).forEach(function (c) {
          o.push(action(L.name(c), L.groupName(c.g), function () { L.setNoGuide(c.k, false); relist(); U.toast('Looking for a guide for ' + L.name(c) + ' again'); build(); }, function () { return 'Look again'; }));
        });
        return o;
      }, function () { return none.length + ' ›'; }));
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
          if (!Net.active) out.push(info('iptv-epg.org', 'needs Settings > Playback > Connection set to Automatic'));
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
      UI.prompt('Add a ' + kind, '', function (v) { if (v.trim()) { arr.push(/prefix/.test(kind) ? v.replace(/^\s+/, '') : v.replace(/\s+$/, '')); changed(true); } }, 'Spaces count.  Shown with · in the list.');
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

  /* ---------- channels and groups ---------- */
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
    out.push(page('My teams', 'A group with your teams\' own channels and every channel showing one of their games.  For now the NFL, NBA, NHL, MLB, WNBA and MLS only.', 'My teams', teamsPage, function () { var n = Teams.followed().length; return n ? n + ' ›' : '›'; }));
    out.push(toggle('Show Movies on now', 'A group of the movies on now, most left first, then the ones starting within the hour.  Needs a TMDB token (Settings > Guide > Movies in the guide).',
      function () { return s.moviesGroup !== false; }, function (v) { s.moviesGroup = v; apply(); if (typeof Movies !== 'undefined') Movies.poke(); }));
    out.push(page('Event channels', 'Pay-per-view and league pass channels whose names carry the game and its time: read into the guide.', 'Event channels', function () { return eventsPage(Store.playlist); }, function () { var ev = Store.playlist.events; return ev && ev.on === false ? 'Off' : 'On'; }));
    if (Events.on()) out.push(toggle('Show Events by time', 'The group of event channels on now or starting in the next two weeks, soonest first.  The same switch as in Event channels.',
      function () { return Events.groupOn(); }, function (v) { var p = Store.playlist; p.events = Object.assign({}, p.events, { group: v }); Store.upsertPlaylist(p); Events.reset(); apply(); }));
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

  /* ---------- My teams (app/js/teams.js) ---------- */
  function teamsPage() {
    var s = S(), out = [], lgs = Teams.leagues(), mine = Teams.followed();
    function apply() { Teams.dirty(); Store.saveSettings(); relist(); paint(); }
    out.push(info('For now: the main North American leagues only (NFL, NBA, NHL, MLB, WNBA and MLS).  College, junior and minor league teams, and other countries\' leagues, aren\'t in it yet.', ''));
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
    out.push(head('Leagues'));
    if (!lgs.length) out.push(info('No NFL, NBA, NHL, MLB, WNBA or MLS channels found in this playlist.', ''));
    lgs.forEach(function (lg) {
      var n = Teams.inLeague(lg.id).filter(function (x) { return Teams.follows(x.id); }).length;
      out.push(page(lg.name, lg.own ? lg.own + ' teams have their own channel' : 'Games only, no team channels', lg.name + ' teams', function () { return leaguePage(lg.id); },
        function () { return n ? n + ' followed ›' : '›'; }));
    });
    if (mine.length) {
      out.push(head('Following'));
      mine.forEach(function (x) {
        out.push(action(x.name, x.league.toUpperCase() + (Teams.hasChannel(x.id) ? '' : '   ·   no channel of its own here, games only'), function () {
          Teams.follow(x.id, false); U.toast('Stopped following the ' + x.name); relist(); build();
        }, function () { return 'Unfollow'; }));
      });
    }
    return out;
  }
  function leaguePage(lg) {
    var out = [];
    out.push(info('Tick the teams you follow.  Teams with their own channel in this playlist say so.', ''));
    Teams.inLeague(lg).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (x) {
      out.push(toggle(x.name, Teams.hasChannel(x.id) ? 'Has its own channel' : '', function () { return Teams.follows(x.id); }, function (v) {
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
    section('channels'); push('My teams', teamsPage);
  }

  /* ---------- the guide: how it's built, then the playlist in use's guide settings ---------- */
  function guide() {
    var s = S(), p = Store.playlist, out = [];
    out.push(head('How your guide is built, in this order'));
    out.push(info('1.  Your provider\'s guide.', ''));
    out.push(info('2.  Your own guide sources, the first one first.  They win over the provider\'s.', ''));
    out.push(info('3.  Public fill-in, only for channels nothing else covers: epg.pw, iptv-epg.org, and Pluto TV\'s own guide from i.mjh.nz for Pluto channels.', ''));
    out.push(info('4.  Matching: each channel is linked to a guide channel by its guide id, then its name.  A wrong one: Hold OK > Assign guide.', ''));
    out.push(info('A channel that will never have a guide (a radio stream, a camera, an event slot): Hold OK > No guide for this channel.  It drops out of matching and stops saying "No guide information".  The web editor\'s Guide page does many at once (Ignore).', ''));
    out.push(head('Guide for ' + (p.name || 'this playlist')));
    out = out.concat(guideRows(p));
    out.push(head('Movies in the guide'));
    out.push(toggle('Movie details from TMDB', 'Finds the movies in your guide with your TMDB token: a poster, year, genres and rating in the guide, a Movie tag on them, the Movies on now group and the Movies on now screen.  Only programme titles go to TMDB.',
      function () { return s.guideMovies !== false; }, function (v) { s.guideMovies = v; save(true); if (typeof Movies !== 'undefined') Movies.poke(); }));
    out = out.concat(tmdbRows());
    if (!MediaStore.preferences().tmdbConfigured) out.push(info('Needs a TMDB token: add one above, free from themoviedb.org.  The same token gives My media its posters.', ''));
    return out;
  }

  /* ---------- reminders and watchlist ---------- */
  function reminders() {
    var s = S(), out = [], rem = Remind.list();
    out.push(choice('Remind me before start', '', [0, 1, 2, 5, 10], ['At start', '1 min', '2 min', '5 min', '10 min'], function () { return +s.remindBefore; }, function (v) { s.remindBefore = v; save(); }));
    out.push(choice('When a reminder starts', '', ['ask', 'switch'], ['Ask me', 'Switch to the channel'], function () { return s.remindAction === 'switch' ? 'switch' : 'ask'; }, function (v) { s.remindAction = v; save(); }));
    out.push(choice('Reminder question stays for', '', [10, 20, 30, 60], ['10s', '20s', '30s', '1 min'], function () { return +s.remindTimeout || 20; }, function (v) { s.remindTimeout = v; save(); }));
    out.push(head('Watchlist'));
    out.push(page('Watchlist', 'Shows, teams and names to look for in the guide.  TiviBro sets a reminder when one is coming up.', 'Watchlist', watchlist, function () { var n = Watch.list().length; return n ? n + ' ›' : '›'; }));
    out.push(head('Coming up  (' + rem.length + ')'));
    if (!rem.length) out.push(info('No reminders.  Pick a future programme in the Guide and press OK, or add to the watchlist.  The phone app and the web editor list them too.', ''));
    rem.forEach(function (r) {
      out.push(action(r.t || 'Programme', U.day(r.s) + ' ' + U.hhmm(r.s) + '   ' + r.ch + (r.live ? '   on now' : '') + (r.w ? '   from your watchlist: ' + r.w.replace(/^team:/, 'team ') : ''), function () {
        UI.confirm('Cancel the reminder for ' + (r.t || 'this programme') + '?', 'Cancel the reminder', function () { Remind.cancel(r.k, r.s); U.toast('Reminder cancelled'); build(); });
      }, function () { return 'Cancel'; }));
    });
    if (rem.length > 1) out.push(action('Cancel all reminders', rem.length + ' set', function () {
      UI.confirm('Cancel all ' + rem.length + ' reminders?', 'Cancel them all', function () { Remind.clear(); U.toast('All reminders cancelled'); build(); });
    }));
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
    if (!Epg.xml) out.push(info('Tip: with only the provider\'s per-channel guide, TiviBro only knows programmes on channels you have looked at.  An XMLTV guide (Settings > Guide: the full provider guide or a guide source) lets the watchlist see every channel.', ''));
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
  function look() {
    var s = S(), out = [];
    out.push(choice('Start screen', 'What TiviBro opens on, and where Back from other screens leads.', ['guide', 'live'], ['Guide', 'Channels screen'],
      function () { return s.startTab === 'live' ? 'live' : 'guide'; }, function (v) { s.startTab = v; save(); Views.buildTabs(); }));
    out.push(toggle('Channels screen in the menu', s.startTab === 'live' ? 'Always there while TiviBro starts on it.' : 'The plain list of channels, without the guide.  Off, it stays one press away: Green in the guide.',
      function () { return s.startTab === 'live' || s.channelsTab === true; }, function (v) { if (s.startTab === 'live') { U.toast('TiviBro starts on the Channels screen, so it stays in the menu'); return; } s.channelsTab = v; save(); Views.buildTabs(); }));
    out.push(head('The guide'));
    out.push(choice('OK on a channel in the Guide', 'Preview first works like TiviMate: the first OK plays it in the corner window, the second goes fullscreen.',
      ['preview', 'full'], ['Preview first, then fullscreen', 'Fullscreen right away'], function () { return s.guideOk === 'full' ? 'full' : 'preview'; }, function (v) { s.guideOk = v; save(); }));
    out.push(choice('Guide row size', 'A little taller rows with bigger channel names and titles, for smaller TVs or reading from across the room.  One channel fewer fits at once.', ['m', 'l', 'xl'], ['Normal', 'Bigger', 'Biggest'],
      function () { return s.guideRows || 'm'; }, function (v) { s.guideRows = v; Views.applyLook(); if (window.Guide && Guide.resize) Guide.resize(); save(); }));
    out.push(toggle('Two-line programmes', 'Shows each programme\'s time under its title in the grid.', function () { return s.guideLines !== 1; }, function (v) { s.guideLines = v ? 2 : 1; Views.applyLook(); save(); }));
    out.push(toggle('Dim past programmes', '', function () { return s.dimPast; }, function (v) { s.dimPast = v; Views.applyLook(); save(); }));
    out.push(choice('Mark what\'s on now', 'How the guide shows programmes airing right now.', ['fill', 'color', 'off'], ['Tint what has aired', 'Colour and tint', 'Off'], function () { return s.nowStyle || 'fill'; }, function (v) { s.nowStyle = v; Views.applyLook(); save(); }));
    out.push(toggle('Channel names in the guide', 'Off shows logos only, leaving more room.', function () { return s.guideNames !== false; }, function (v) { s.guideNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Two-line channel names', 'Long names wrap instead of being cut off.', function () { return !!s.twoLineNames; }, function (v) { s.twoLineNames = v; Views.applyLook(); save(); }));
    out.push(toggle('Mark catch-up channels', 'Shows ↺ on channels and programmes you can replay.', function () { return s.showCatchupMark !== false; }, function (v) { s.showCatchupMark = v; save(); relist(); }));
    out.push(head('Colours and text'));
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
    out.push(toggle('Press Back twice to exit', 'Then the TV asks whether to exit.', function () { return s.exitTwice; }, function (v) { s.exitTwice = v; save(); }));
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
    (f.words || []).forEach(function (w) { out.push(action('Word: ' + w, 'Select to stop hiding it', function () { Filter.remove('words', w); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
    (f.groups || []).forEach(function (n) { out.push(action('Group: ' + n, 'Hidden with the filter.  Select to bring it back', function () { Filter.remove('groups', n); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
    (f.chans || []).forEach(function (n) { out.push(action('Channel: ' + n, 'Hidden with the filter.  Select to bring it back', function () { Filter.remove('chans', n); Views.filterChanged(); build(); }, function () { return 'Remove'; })); });
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
    var rp = phoneDoes('editor', action('Report a problem', 'Scan a QR code: your phone fills in a GitHub issue with this TV\'s details and log, logins and server names taken out.  In the phone app it opens the report page there.', function () {
      Diag.openReport();
    }, function () { return '›'; }));
    rp.epage = 'report'; out.push(rp);
    if (Reports.list.length) out.push(page('Your problem reports', 'The reports this TV sent, and whether the developer has answered.  TiviBro also tells you when one gets a reply.', 'Your problem reports', function () {
      var o = Reports.list.map(function (r) {
        return action('#' + r.n + '  ' + (r.title || 'Problem report'), 'Sent ' + Reports.when(r.sent) + ' from ' + (r.version || '?') + '.  ' + Reports.statusText(r), function () { Reports.show(r.n); }, function () { return '›'; });
      });
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
    WebEdit.onStatus = function () { if (Views.tab === 'settings' && SECTIONS[sec][0] === 'connect' && !stack.length) build(); };
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
    Phone.onChange = function () { if (Views.tab === 'settings' && SECTIONS[sec][0] === 'connect' && !stack.length) build(); };
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
        out.push(action(p.name, (p.model ? p.model + '  ·  ' : '') + 'Added ' + when(p.added) + '  ·  Last seen ' + Phone.ago(p.seen), function () {
          UI.menu(p.name, [
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
    if (Views.tab !== 'settings' || SECTIONS[sec][0] !== 'about' || stack.length) return;
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
    out.push(toggle('Check automatically', 'When TiviBro starts and every 6 hours while it is open.  Nothing is installed without asking you.', function () { return s.updateAuto !== false; }, function (v) { s.updateAuto = v; save(); }));
    out.push(toggle('Count this TV in the install numbers', 'Once a day, and when a new version first starts, TiviBro says which version it is (and whether it is new or an update) and which webOS this TV has.  Nothing else: no address is kept, no ID, nothing about your channels or playlists.', function () { return s.countMe !== false; }, function (v) { s.countMe = v; save(); }));
    out.push(toggle('Include test versions', 'Alpha and beta builds: new features first, and some rough edges.', function () { return Update.wantPre; }, function (v) { s.updatePre = v; save(); }));
    var how = info('Installing on this TV', ''); how.value = function () { var i = Update.state.installer; return i === 'hbchannel' ? 'Yes, through the Homebrew Channel' : i === '' ? 'From a computer only (not rooted)' : 'Checking…'; }; out.push(how);
    out.push(head('About'));
    var credit = U.el('div', 'tmdb-credit'), logo = U.el('img');
    logo.src = 'img/tmdb.svg'; logo.alt = 'TMDB'; logo.width = 120;
    credit.appendChild(logo); credit.appendChild(U.el('span', '', 'This product uses the TMDB API but is not endorsed or certified by TMDB.'));
    out.push({ preview: true, el: credit });
    out.push(info('Made by OhMyBahGosh', 'github.com/' + Update.REPO));
    out.push(info('Playback libraries', 'hls.js ' + (window.Hls ? Hls.version : '') + '   mpegts.js'));
    return out;
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
      out.push(action(x.name || 'Restore point', when(x.at) + (x.kind === 'auto' ? '   saved by itself' : ''), function () {
        UI.menu(x.name || 'Restore point', [
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
  function about() {
    var out = updates();
    out.push(head('Diagnostics'));
    return out.concat(diag());
  }

  var BY_ID = { playlists: playlists, guide: guide, channels: groups, names: names, reminders: reminders, playback: playback, media: media, remote: remote, look: look, parental: parental, backups: backups, connect: connect, about: about };
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
      var n = U.el('div', i === sec ? 'on' : '', title(s));
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

  // One playlist's page (after it closed TiviBro, or most of its channels fail; issue #25).
  function openPlaylist(id) {
    var raw = S().playlists.filter(function (x) { return x.id === id; })[0];
    if (!raw || !section('playlists')) return false;
    var p = Store.normalize(raw);
    push(p.name || 'Playlist', function () { return playlistPage(p); });
    return true;
  }

  // Straight to one section (the phone app's own shortcut, and tests).
  function section(id) {
    if (id === 'phone' && !phoneOK()) return false;
    if (ALIAS[id]) id = ALIAS[id];
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === id && shown(i)) { sec = i; stack = []; sel = 0; zone = 'body'; build(); return true; } return false; }

  /* Settings from the phone app (ask "settings" in phone.js): the same pages, built by the same code, as
     data the phone draws.  A page is a section plus the page rows followed into it (path, by row).  Each
     row: head, info, toggle, choice (with its choices), cycle (◀ ▶ only), page, or action (which runs on
     the TV, so a box or menu it opens shows there; the phone can type into boxes).  After a change the
     page is built again and sent back, so rows that depend on others appear or go. */
  function rowsOf(secId, path) {
    if (ALIAS[secId]) secId = ALIAS[secId];
    var i = -1; for (var x = 0; x < SECTIONS.length; x++) if (SECTIONS[x][0] === secId) i = x;
    if (i < 0) throw new Error('No such settings page');
    var list = FNS[i](), title = title0(SECTIONS[i]), trail = [title];
    (path || []).forEach(function (n) {
      var it = list[n];
      if (!it || !it.page) throw new Error('That page has changed on the TV.  Go back and open it again.');
      title = it.page.title; trail.push(title); list = it.page.fn();
    });
    return { title: title, trail: trail, list: list };
  }
  function title0(sct) { return title(sct); }
  function rowData(it, n) {
    var v = '';
    try { v = it.value ? String(it.value() || '') : ''; } catch (e) {}
    var r = { i: n, label: String(it.label || ''), sub: it.sub ? String(it.sub) : '' };
    if (it.head) r.kind = 'head';
    else if (it.info) { r.kind = 'info'; r.value = v; }
    else if (it.toggle) { r.kind = 'toggle'; r.on = !!it.get(); }
    else if (it.values) { r.kind = 'choice'; r.options = it.labels.map(String); r.cur = it.values.indexOf(it.get()); r.value = v; }
    else if (it.cycle) { r.kind = 'cycle'; r.value = v; }
    else if (it.page) { r.kind = 'page'; r.value = v === '›' ? '' : v; }
    else if (it.action) { r.kind = 'action'; r.value = v; }
    else { r.kind = 'info'; r.value = v; }
    if (it.swatch) try { r.swatch = it.swatch() || ''; } catch (e) {}
    if (it.phone) { r.phone = it.phone; if (it.sid) r.sid = it.sid; if (it.epage) r.epage = it.epage; }
    if (it.tv) r.tv = 1;
    return r;
  }
  /* A button pressed on the phone asks its questions on the phone.  While it runs (and for a while
     after, as answers can take a moment), a box, menu or "are you sure" it opens, and the toasts it
     shows, go to the phone instead of the TV's screen: the answer carries { dialog } and the phone
     shows it, then answers with op "answer".  Nothing appears on the TV.  Rows the phone does all by
     itself carry phone (phoneDoes); rows that only make sense on the TV's screen carry tv: 1. */
  var cap = null, dlgN = 0;
  function startCapture() {
    endCapture();
    var c = cap = { dialog: null, toasts: [], last: Date.now(), wake: null, orig: { menu: UI.menu, prompt: UI.prompt, confirm: UI.confirm, toast: U.toast } };
    function got(d) { if (cap !== c) return false; d.id = 'd' + (++dlgN); c.dialog = d; c.last = Date.now(); if (c.wake) c.wake(); return true; }
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
    sections: function () { return SECTIONS.filter(function (x, i) { return shown(i); }).map(function (x) { return { id: x[0], title: title(x) }; }); },
    page: function (secId, path) { var p = rowsOf(secId, path); return { title: p.title, trail: p.trail, rows: p.list.map(rowData).filter(function (r, n) { return !p.list[n].preview; }) }; },   // pictures (a preview, the TMDB credit) stay on the TV
    // op: 'toggle' (on), 'choice' (v: the choice's index), 'cycle' (dir), 'action', 'answer' (to a dialog).
    change: function (secId, path, n, op, a) {
      if (op === 'answer') {
        var c = cap, d = c && c.dialog;
        if (!d || d.id !== String(a.dialog || '')) { endCapture(); throw new Error('That question has gone.  Press the button again.'); }
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
      else if (op === 'action' && it2.action && !it2.page) {
        if (it2.tv) { it2.action(); Store.saveSettings(); return { msg: 'On the TV\'s screen now', page: forPhone.page(secId, path) }; }
        var c2 = startCapture();
        try { it2.action(); } catch (e) { endCapture(); throw e; }
        Store.saveSettings();
        return settle(c2, secId, path);
      }
      else throw new Error('That can\'t be changed that way');
      Store.saveSettings();
      return { msg: msg, page: forPhone.page(secId, path) };
    }
  };

  return { open: open, assignGuide: assignGuide, section: section, openPlaylist: openPlaylist, openTeams: openTeams, live: live, reset: function () { stack = []; sel = 0; }, phone: forPhone,
    LOOK: { ACCENTS: ACCENTS, ACCENT_NAMES: ACCENT_NAMES, THEMES: THEMES, THEME_NAMES: THEME_NAMES, THEME_INK: THEME_INK } };
})();
