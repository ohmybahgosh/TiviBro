/* A Plex movie or episode: its page (backdrop, facts, badges, scores, summary, cast, More like this) with Resume,
   Play from the start, Trailer, Watched and More (version, audio, subtitles, Remove from Continue watching, Go to
   show), and playing it in TiviBro's player (Views.playVod) through the helper's door.
   Playing: the file as it is when the TV plays its video (TiviBro's own converter handles DTS or TrueHD sound);
   otherwise the server converts it (Plex's universal converter, HLS).  Progress goes to Plex every 10 s, so
   stopping here and finishing in Plex's app (or the other way) picks up where you were; 90% counts as watched, as
   in Plex.  Skip intro and Skip credits use Plex's own markers (skipper.js); an episode's end brings Up next.
   Chromium 53-compatible. */
var PlexPage = (function () {
  'use strict';
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); };
  var RAW = function (s) { return typeof I18n !== 'undefined' && I18n.raw ? I18n.raw(s) : s; };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  var item = null, back = null, btns = [], btnAt = 0, playing = null, timer = 0, session = '', versionOf = {};
  var DIRECT_VIDEO = /^(h264|hevc|h265|vp9|av1|mpeg4)$/i, DIRECT_BOX = /^(mkv|mp4|mov|m4v|mpegts|ts|webm|avi)$/i;

  function mc(j) { return (j && j.MediaContainer) || {}; }
  function mins(ms) { return ms ? Math.round(ms / 60000) : 0; }
  function clock(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  /* ---------- The page ---------- */
  /* Opens a movie or an episode: its full details read first (markers, chapters, extras, related, every version). */
  function open(m, onBack) {
    back = onBack; item = m;
    U.toast(T('Opening {x}…', { x: m.title }));
    Plex.call(m.server, '/library/metadata/' + m.ratingKey + '?includeMarkers=1&includeChapters=1&includeExtras=1&includeRelated=1&includeGuids=1').then(function (j) {
      var full = (mc(j).Metadata || [])[0]; if (!full || item !== m) return;
      full.server = m.server; item = full; draw(); UI.setHandler(keys);
    }, function (e) { U.toast(e.message, 6000); });
  }
  // The badges a version earns: 4K, HDR or Dolby Vision, Atmos, the sound's channels.
  function badges(media) {
    var v = media || {}, out = [];
    if (/4k/i.test(v.videoResolution)) out.push('4K'); else if (v.videoResolution) out.push(String(v.videoResolution).toUpperCase() + (/^\d+$/.test(v.videoResolution) ? 'p' : ''));
    var vs = streamsOf(v, 1)[0] || {};
    if (vs.DOVIPresent) out.push('Dolby Vision'); else if (/smpte2084|arib-std-b67/i.test(vs.colorTrc || '')) out.push('HDR');
    var as = streamsOf(v, 2)[0] || {};
    if (/atmos/i.test(as.displayTitle || as.extendedDisplayTitle || '')) out.push('Atmos');
    if (v.audioChannels) out.push(v.audioChannels > 2 ? (v.audioChannels - 1) + '.1' : T('Stereo'));
    return out;
  }
  function streamsOf(media, type) { var p = media && media.Part && media.Part[0]; return ((p && p.Stream) || []).filter(function (s) { return s.streamType === type; }); }
  function version() { var list = item.Media || []; return list[Math.min(versionOf[item.ratingKey] || 0, list.length - 1)] || {}; }
  // Draws the page over the Plex tab: the top, the buttons, then Cast and More like this.
  function draw() {
    var el = $('plexPage');
    if (!el) { el = U.el('div', 'plex-page'); el.id = 'plexPage'; $('viewPlex').appendChild(el); }
    el.classList.remove('hidden');
    var m = item, ep = m.type === 'episode', v = version();
    var facts = [ep ? 'S' + m.parentIndex + ' · E' + m.index : '', m.year, m.contentRating, mins(m.duration) ? T('{n} min', { n: mins(m.duration) }) : '', m.duration ? T('Ends {x}', { x: U.hhmm ? U.hhmm(Date.now() + (m.duration - (m.viewOffset || 0))) : '' }) : ''].filter(Boolean).join('  ·  ');
    var scores = (m.rating ? '<span class="plex-score">' + esc(T('Critics {x}', { x: Math.round(m.rating * 10) + '%' })) + '</span>' : '') + (m.audienceRating ? '<span class="plex-score">' + esc(T('Audience {x}', { x: Math.round(m.audienceRating * 10) + '%' })) + '</span>' : '');
    var people = ((m.Director || []).slice(0, 1).map(function (d) { return T('Directed by {x}', { x: d.tag }); }).concat((m.Role || []).slice(0, 3).map(function (r) { return r.tag; }))).join('  ·  ');
    btns = buttons();
    el.innerHTML = '<div class="media-bd"><img class="media-hero-art" id="plexPageArt" alt=""></div><div class="media-fade"></div>' +
      '<div class="plex-page-top"><div class="media-kicker">' + esc(ep ? m.grandparentTitle : (m.librarySectionTitle || 'Plex')) + '</div>' +
      '<div class="media-title">' + esc(ep ? m.title : m.title) + '</div><div class="media-facts">' + esc(facts) + '</div>' +
      '<div class="plex-badges">' + badges(v).map(function (b) { return '<span class="plex-badge">' + esc(b) + '</span>'; }).join('') + scores + '</div>' +
      '<div class="media-summary plex-summary">' + esc(m.summary || '') + '</div><div class="plex-people">' + esc(people) + '</div></div>' +
      '<div class="plex-btns">' + btns.map(function (b, i) { return '<div class="plex-btn' + (i === btnAt ? ' sel' : '') + (b.main ? ' main' : '') + '">' + esc(b.label) + '</div>'; }).join('') + '</div>' +
      '<div class="plex-page-track">' + track() + '</div>';
    PlexView.picture(m.server, m.art || m.grandparentArt || m.thumb, 1340, 760).then(function (u) { var a = $('plexPageArt'); if (u && a && item === m) { a.onload = function () { a.style.opacity = 1; }; a.src = u; } });
  }
  // The track under the buttons: what's playing in it (the version, its sound and subtitles).
  function track() {
    var v = version(), a = streamsOf(v, 2).filter(function (s) { return s.selected; })[0] || streamsOf(v, 2)[0], s = streamsOf(v, 3).filter(function (x) { return x.selected; })[0];
    var bits = [(item.Media || []).length > 1 ? T('Version: {x}', { x: describeVersion(v) }) : '', a ? T('Audio: {x}', { x: a.displayTitle || a.language || '' }) : '', T('Subtitles: {x}', { x: s ? s.displayTitle || s.language : T('Off') })];
    return esc(bits.filter(Boolean).join('    '));
  }
  function describeVersion(v) { return [String(v.videoResolution || '').toUpperCase(), (v.videoCodec || '').toUpperCase(), v.Part && v.Part[0] && v.Part[0].size ? (v.Part[0].size / 1073741824).toFixed(1) + ' GB' : ''].filter(Boolean).join(' · '); }
  // Resume (when partly watched), Play from the start, Trailer, Watched, More.
  function buttons() {
    var m = item, out = [];
    if (m.viewOffset > 60000) out.push({ label: T('Resume from {x}', { x: clock(m.viewOffset) }), main: true, act: function () { play(m.viewOffset); } });
    out.push({ label: m.viewOffset > 60000 ? T('Play from the start') : T('Play'), main: !(m.viewOffset > 60000), act: function () { play(0); } });
    var trailer = ((m.Extras && m.Extras.Metadata) || []).filter(function (x) { return x.subtype === 'trailer' || x.extraType === 1; })[0];
    if (trailer) out.push({ label: T('Trailer'), act: function () { trailer.server = m.server; playOther(trailer); } });
    var watched = m.viewCount > 0 && !m.viewOffset;
    out.push({ label: watched ? T('Mark not watched') : T('Mark watched'), act: function () { mark(!watched); } });
    out.push({ label: T('More'), act: more });
    return out;
  }
  function mark(on) {
    Plex.call(item.server, (on ? '/:/scrobble' : '/:/unscrobble') + '?identifier=com.plexapp.plugins.library&key=' + item.ratingKey).then(function () {
      if (on) { item.viewCount = (item.viewCount || 0) + 1; item.viewOffset = 0; } else item.viewCount = 0;
      U.toast(on ? T('Marked as watched') : T('Marked as not watched')); draw();
    }, function (e) { U.toast(e.message, 6000); });
  }
  // More: the version, audio and subtitles (Plex remembers them for you), Remove from Continue watching, Go to show.
  function more() {
    var m = item, v = version(), part = v.Part && v.Part[0], rows = [];
    if ((m.Media || []).length > 1) rows.push({ label: T('Version'), sub: RAW(describeVersion(v)), action: function () {
      UI.menu(T('Version'), m.Media.map(function (x, i) { return { label: RAW(describeVersion(x)), sub: RAW(badges(x).join('  ·  ')), action: function () { versionOf[m.ratingKey] = i; draw(); } }; }));
    } });
    if (part) rows.push({ label: T('Audio'), action: function () { pickStream(part, 2); } }, { label: T('Subtitles'), action: function () { pickStream(part, 3); } });
    // The Watchlist (Plex's, the same in every Plex app): for what you haven't watched yet, as Plex offers it.
    if (m.type === 'movie' && m.guid && typeof PlexTop !== 'undefined') {
      var on = PlexTop.onWatch(m);
      rows.push({ label: on ? T('Remove from Watchlist') : T('Add to Watchlist'), action: function () {
        Plex.watch(m.guid, !on).then(function () { PlexTop.changedWatch(); U.toast(on ? T('Removed from your Watchlist') : T('Added to your Watchlist')); }, function (e) { U.toast(e.message, 6000); });
      } });
    }
    if (m.viewOffset) rows.push({ label: T('Remove from Continue watching'), action: function () {
      Plex.call(m.server, '/actions/removeFromContinueWatching?ratingKey=' + m.ratingKey, 'put').then(function () { m.viewOffset = 0; U.toast(T('Removed from Continue watching')); draw(); }, function (e) { U.toast(e.message, 6000); });
    } });
    if (m.type === 'episode' && m.grandparentRatingKey) rows.push({ label: T('Go to show'), action: function () { close(); PlexView.openShow({ ratingKey: m.grandparentRatingKey, type: 'show', title: m.grandparentTitle, server: m.server }); } });
    UI.menu(RAW(m.title), rows);
  }
  // An audio or subtitle track picked: kept by Plex for this title (and by TiviBro's player while it plays).
  function pickStream(part, type) {
    var list = (part.Stream || []).filter(function (s) { return s.streamType === type; });
    var rows = (type === 3 ? [{ label: T('Off'), action: function () { choose(0); } }] : []).concat(list.map(function (s) { return { label: RAW((s.selected ? '✓  ' : '') + (s.displayTitle || s.language || '?')), action: function () { choose(s.id); } }; }));
    function choose(id) {
      var q = type === 2 ? 'audioStreamID=' + id : 'subtitleStreamID=' + id;
      Plex.call(item.server, '/library/parts/' + part.id + '?allParts=1&' + q, 'put').then(function () { list.forEach(function (s) { s.selected = s.id === id; }); draw(); }, function (e) { U.toast(e.message, 6000); });
    }
    UI.menu(type === 2 ? T('Audio') : T('Subtitles'), rows);
  }

  function keys(a) {
    if (a === 'back') { close(); if (back) back(); return true; }
    if (a === 'left') { if (btnAt > 0) { btnAt--; draw(); } return true; }
    if (a === 'right') { if (btnAt < btns.length - 1) { btnAt++; draw(); } return true; }
    if (a === 'ok') { if (btns[btnAt]) btns[btnAt].act(); return true; }
    if (a === 'red' || a === 'hold') { more(); return true; }
    if (a === 'yellow') { mark(!(item.viewCount > 0 && !item.viewOffset)); return true; }
    return true;
  }
  function close() { var el = $('plexPage'); if (el) el.classList.add('hidden'); btnAt = 0; }

  /* ---------- Playing ---------- */
  // The TV plays this version's video as it is (sound is TiviBro's converter's job when the TV can't).
  function direct(v) { return DIRECT_VIDEO.test(v.videoCodec || '') && DIRECT_BOX.test(v.container || ''); }
  function newSession() { session = 'tivibro-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); return session; }
  /* The server converts it when the TV can't play its video, when Settings > Plex says always, or when the file is
     bigger than the quality cap (Plex's "play smaller videos at original quality": a file under the cap plays as is). */
  function converts(v) {
    var cap = quality();
    return !Plex.prefs().direct || !direct(v) || !!(cap && v.bitrate && v.bitrate > cap);
  }
  /* Starts the title at ms: the file through the door, or the server's converter.  Plex's preview pictures, its
     chapters and a subtitle file kept beside the video go to the player too (a file played as it is). */
  function play(ms) {
    var m = item, v = version(), part = v.Part && v.Part[0];
    if (!part) return U.toast(T('Plex has no file for this one.'), 6000);
    Plex.door(m.server).then(function (key) {
      var base = 'http://127.0.0.1:' + Net.port + '/plex/' + key, url, converting = converts(v), cap = quality();
      if (!converting) url = base + part.key;
      else url = base + '/video/:/transcode/universal/start.m3u8?path=' + encodeURIComponent('/library/metadata/' + m.ratingKey) + '&mediaIndex=' + Math.max(0, (m.Media || []).indexOf(v)) + '&partIndex=0&protocol=hls&fastSeek=1&directPlay=0&directStream=1&directStreamAudio=1&videoQuality=100' + (cap ? '&maxVideoBitrate=' + cap : '') + '&subtitles=burn&copyts=1&offset=' + Math.floor(ms / 1000) + '&session=' + newSession();
      var meta = { id: 'plex:' + m.server + ':' + m.ratingKey, plex: true, plexNext: m.type === 'episode' ? 'episode' : '', title: m.type === 'episode' ? m.grandparentTitle + '  S' + m.parentIndex + ' · E' + m.index : m.title, sub: m.type === 'episode' ? m.title : [m.year, m.contentRating].filter(Boolean).join('  ·  '), marks: marks(m), chapters: converting ? [] : chapters(m) };
      if (!converting && /(^|,)sd(,|$)/.test(part.indexes || '')) meta.pics = function (t) { return base + '/library/parts/' + part.id + '/indexes/sd/' + Math.round(t * 1000); };
      playing = { item: m, meta: meta, converting: converting, last: 0, scrobbled: false };
      Views.playVod(meta, url, converting ? 0 : ms / 1000, function () { report('stopped'); stopTimer(); if (PlexView.resume) PlexView.resume(); });
      startTimer();
      if (!converting) sideSubtitle(base, part, playing);
      if (converting) U.toast(T('{x} is converting this one for the TV', { x: (Plex.server(m.server) || {}).name || 'Plex' }), 5000);
      notices(m);
    }, function (e) { U.toast(e.message, 6000); });
  }
  // Plex's chapters as the player takes them (seconds, with their names).
  function chapters(m) { return (m.Chapter || []).map(function (c) { return { s: c.startTimeOffset / 1000, e: c.endTimeOffset / 1000, t: c.tag || '' }; }).filter(function (c) { return c.e > c.s; }); }
  /* The subtitle picked in Plex, when it's a file beside the video (SRT, ASS, VTT): read through the door and given to
     the player.  Subtitles inside the file are the player's own job. */
  function sideSubtitle(base, part, p) {
    var s = (part.Stream || []).filter(function (x) { return x.streamType === 3 && x.selected && x.key; })[0];
    if (!s || !/^(srt|ass|ssa|vtt|webvtt|smi|sub)$/i.test(s.codec || 'srt') || typeof Subs === 'undefined') return;
    setTimeout(function () {
      if (playing !== p) return;
      fetch(base + s.key, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (text) {
        if (!text || playing !== p) return;
        try { Subs.addText((s.language || s.displayTitle || 'Plex') + '.' + (s.codec || 'srt'), text); } catch (e) { if (typeof Log !== 'undefined') Log.warn('plex', 'Plex\'s subtitle file: ' + e.message); }
      }, function () {});
    }, 1500);
  }
  function playOther(x) { var keep = item; item = x; Plex.call(x.server, '/library/metadata/' + x.ratingKey).then(function (j) { item = (mc(j).Metadata || [])[0] || x; item.server = x.server; play(0); item = keep; }, function (e) { item = keep; U.toast(e.message, 6000); }); }
  // The quality cap for the converter (kbps, 0: Original): Settings > Plex, at home and away.
  function quality() {
    var s = Plex.server(item.server) || {}, p = Plex.prefs(), cap = +(s.local ? p.homeQuality : p.awayQuality) || 0;
    // Through Plex's relay (the server can't be reached directly), Plex lets through 2 Mbps at most.
    return s.relay ? Math.min(cap || RELAY, RELAY) : cap;
  }
  var RELAY = 2000;
  /* Before playing: away from home without Plex Pass, a word on why it may not play (the server owner's Plex Pass
     counts too, which the TV can't see); through the relay, why it's soft.  Once per server a day. */
  var told = {};
  function notices(m) {
    var s = Plex.server(m.server) || {}, day = new Date().toDateString(), k = m.server + day;
    if (told[k]) return; told[k] = 1;
    if (s.relay) U.toast(T('{x} is reached through Plex\'s relay, so video is 2 Mbps at most.  Turning on Remote Access on the server helps.', { x: s.name || 'Plex' }), 8000);
    else if (!s.local && !Plex.user().pass) U.toast(T('Away from home, Plex plays only with Plex Pass (yours or the server owner\'s) or a Remote Watch Pass.'), 8000);
  }
  // Plex's intro and credits markers, as Skip intro and Skip credits take them (seconds).
  function marks(m) {
    var out = { intro: null, recap: null, credits: -1, creditsEnd: -1 };
    (m.Marker || []).forEach(function (k) {
      if (k.type === 'intro' && !out.intro) out.intro = [k.startTimeOffset / 1000, k.endTimeOffset / 1000];
      if (k.type === 'credits' && out.credits < 0) { out.credits = k.startTimeOffset / 1000; out.creditsEnd = k.final ? -1 : k.endTimeOffset / 1000; }
    });
    return out.intro || out.credits >= 0 ? out : null;
  }
  /* Where you are, to Plex every 10 s (and at pause and stop); 90% marks it watched, as Plex does. */
  function startTimer() { stopTimer(); timer = setInterval(function () { report(Player.paused ? 'paused' : 'playing'); }, 10000); }
  function stopTimer() { clearInterval(timer); timer = 0; }
  function report(state) {
    var p = playing; if (!p || typeof Player === 'undefined') return;
    var at = Math.round((Player.position || 0) * 1000), dur = p.item.duration || Math.round((Player.duration || 0) * 1000);
    if (state !== 'stopped' && at === p.last) return;
    p.last = at;
    Plex.call(p.item.server, '/:/timeline?ratingKey=' + p.item.ratingKey + '&key=' + encodeURIComponent('/library/metadata/' + p.item.ratingKey) + '&state=' + state + '&time=' + at + '&duration=' + dur + '&identifier=com.plexapp.plugins.library').catch(function () {});
    if (!p.scrobbled && dur && at >= dur * 0.9) { p.scrobbled = true; Plex.call(p.item.server, '/:/scrobble?identifier=com.plexapp.plugins.library&key=' + p.item.ratingKey).catch(function () {}); }
    if (state === 'stopped') playing = null;
  }

  /* The movie or episode ended (views.js endVod): an episode's next one with Up next, else back to the page. */
  function ended(force) {
    var p = playing; report('stopped'); stopTimer();
    if (!p) return;
    var m = p.item;
    if (m.type !== 'episode' || !m.grandparentRatingKey) { Views.stopAll(); if (PlexView.resume) PlexView.resume(); return; }
    Plex.call(m.server, '/library/metadata/' + m.grandparentRatingKey + '/allLeaves').then(function (j) {
      var all = mc(j).Metadata || [], i = -1;
      all.forEach(function (x, n) { if (String(x.ratingKey) === String(m.ratingKey)) i = n; });
      var nx = i >= 0 ? all[i + 1] : null;
      if (!nx) { Views.stopAll(); if (PlexView.resume) PlexView.resume(); return; }
      nx.server = m.server;
      var go = function () { item = nx; Plex.call(nx.server, '/library/metadata/' + nx.ratingKey + '?includeMarkers=1').then(function (k) { item = (mc(k).Metadata || [])[0] || nx; item.server = nx.server; play(item.viewOffset > 60000 ? item.viewOffset : 0); }); };
      if (force) return go();
      if (typeof UpNext !== 'undefined') UpNext.hold();
      Views.stopAll();
      PlexView.picture(nx.server, nx.thumb, 1280, 720).then(function (img) {
        UpNext.show({ image: img, show: nx.grandparentTitle, season: nx.parentIndex, episode: nx.index, line: T('Season {x}, episode {y}', { x: nx.parentIndex, y: nx.index }), title: nx.title, runtime: mins(nx.duration) ? T('{n} min', { n: mins(nx.duration) }) : '', desc: String(nx.summary || '').slice(0, 400), play: go, cancel: function () { if (PlexView.resume) PlexView.resume(); } });
      });
    }, function () { Views.stopAll(); if (PlexView.resume) PlexView.resume(); });
  }

  /* From the phone app (plexphone.js): the Plex tab on the TV, then the title played (where you stopped, unless
     fromStart).  Resolves to { title } once it's starting. */
  function playKey(server, key, fromStart) {
    if (Views.tab !== 'plex') Views.switchTab('plex');
    if (Views.tab !== 'plex') return Promise.reject(new Error('Plex could not be opened on the TV.'));
    if (document.body.classList.contains('nav-open') && Views.closeNav) Views.closeNav();
    return Plex.call(server, '/library/metadata/' + key + '?includeMarkers=1&includeChapters=1&includeGuids=1').then(function (j) {
      var m = (mc(j).Metadata || [])[0];
      if (!m || !/^(movie|episode)$/.test(m.type)) throw new Error('That one doesn\'t play by itself.  Pick a movie or an episode.');
      m.server = server; item = m; back = function () { if (PlexView.resume) PlexView.resume(); };
      play(!fromStart && m.viewOffset > 60000 ? m.viewOffset : 0);
      return { title: m.type === 'episode' ? m.grandparentTitle + ' S' + m.parentIndex + ' · E' + m.index : m.title };
    });
  }

  return { open: open, ended: ended, close: close, playKey: playKey, _test: { quality: quality, marks: marks, badges: badges, direct: direct, converts: converts, chapters: chapters, item: function () { return item; }, keys: keys, buttons: function () { return btns; } } };
})();
