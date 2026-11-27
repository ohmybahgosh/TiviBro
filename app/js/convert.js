/* Sound the TV can't play.  LG TVs from 2020 to 2022 (webOS 5, 6 and 22, the C2 among them) have no DTS
   at all, no LG TV plays Dolby TrueHD, and surround FLAC fails.  A movie whose only sound is one of those
   plays silent.  The network helper can convert that sound to Dolby Digital (AC-3) with a small audio
   converter (ffmpeg, about 2 MB) that it downloads to the TV's storage the first time it is needed.
   Video is never touched (service/convert.js, service/ffmpeg.js, docs/FFMPEG.md).

   What happens when a movie, episode or My media file starts (Player.play asks plan()):
     - the sound the app already knows plays here (Xtream's movie details): nothing changes;
     - otherwise, with the converter on the TV, the helper reads the file's tracks (/convert/probe);
     - another track this TV plays, in the same language: that track, no conversion;
     - every track is one the TV can't play: the movie plays from a conversion link, and the viewer
       is told once ("Converting DTS audio for this TV");
     - no converter yet: TiviBro offers it once.  Declined, the movie plays as before and says why
       there is no sound.
   Settings > Audio and subtitles > Convert audio the TV can't play: Automatic or Off. */
var Convert = (function () {
  'use strict';
  var NAMES = { dts: 'DTS', truehd: 'Dolby TrueHD', mlp: 'Dolby TrueHD', flac: 'FLAC' };
  var FILE = /\.(mkv|mk3d|mp4|m4v|mov|avi|ts|m2ts|mts|webm)(\?|#|$)/i;
  var HINT = /\b(dts(-?hd)?|true-?hd|atmos)\b/i;
  var key = '', st = null, stAt = 0, probes = {}, getting = null;

  function settings() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  function on() { return settings().convertAudio !== 'off'; }
  function base() { return typeof Net !== 'undefined' && Net.port ? 'http://127.0.0.1:' + Net.port : ''; }
  function ask(path, method) {
    var b = base();
    if (!b) return Promise.reject(new Error('The network helper is not running.'));
    return Net.ctlFetch(b + path, { method: method || 'GET', cache: 'no-store', headers: {} }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || U.httpSays(r.status, 'helper')); return j; });
    });
  }

  /* ---------- the converter itself ---------- */
  function status(fresh) {
    if (!fresh && st && Date.now() - stAt < 30000) return Promise.resolve(st);
    return ask('/ffmpeg/status').then(function (s) { st = s; stAt = Date.now(); return s; }, function (e) { return { state: 'failed', error: e.message }; });
  }
  // Download it (or wait for the download already going).  onProgress(percent) while it comes.
  function get(onProgress) {
    if (getting) return getting;
    getting = ask('/ffmpeg/get', 'POST').then(function () {
      return new Promise(function (resolve, reject) {
        (function poll() {
          status(true).then(function (s) {
            if (s.state === 'downloading') { if (onProgress) onProgress(s.percent || 0); return setTimeout(poll, 700); }
            if (s.state === 'ready') return resolve(s);
            reject(new Error(s.error || 'The audio converter could not be downloaded.'));
          });
        })();
      });
    });
    var done = function () { getting = null; };
    getting.then(done, done);
    return getting;
  }
  function remove() { return ask('/ffmpeg/remove', 'POST').then(function (s) { st = s; stAt = Date.now(); return s; }); }
  // One line for Settings: "Ready: 7.1.1, 3.0 MB, on TV storage".
  function describe(s) {
    if (!s) return 'checking…';
    if (s.state === 'ready' && s.bundled) return 'Built in, ready' + (s.size ? ', ' + (s.size / 1048576).toFixed(1) + ' MB' : '');
    if (s.state === 'ready') return 'Ready' + (s.size ? ', ' + (s.size / 1048576).toFixed(1) + ' MB' : '') + (s.where ? (/^set by/.test(s.where) ? ', ' : ', kept on ') + s.where : '');
    if (s.state === 'downloading') return (s.bundled ? 'Unpacking ' : 'Downloading ') + (s.percent || 0) + '%';
    if (s.bundled && s.state !== 'failed') return 'Built in, unpacked the first time a movie needs it';
    if (s.state === 'failed') return 'Not available: ' + (s.error || 'unknown reason');
    return 'Not on this TV yet (about 2 MB, downloaded when a movie needs it)';
  }

  /* ---------- which track, and convert or not ----------
     tracks: [{ index, codec, channels, lang, def, title }] (the helper's probe).
     Returns { action: 'play' | 'track' | 'convert', a, codec, channels, why, bad: [reason per track] }. */
  function decide(tracks, c, prefs) {
    prefs = prefs || {};
    if (!tracks || !tracks.length) return { action: 'play', bad: [] };
    var bad = tracks.map(function (t) { return Caps.unplayable(t.codec, t.channels, c, t.rate); });
    var def = 0;
    tracks.forEach(function (t, i) { if (t.def && !tracks[def].def) def = i; });
    if (!bad[def]) return { action: 'play', a: def, bad: bad };
    var want = prefs.lang || '', defLang = tracks[def].lang || '', extra = /comment|descri/i;
    function lang(t) { return typeof U !== 'undefined' && U.lang ? U.lang(t.lang) || t.lang : t.lang; }
    /* Between tracks otherwise alike, the richer one: Dolby Atmos (a TrueHD Atmos movie usually carries a Dolby
       Digital Plus Atmos track too, which LG TVs play and pass on to an Atmos soundbar), then E-AC-3 over AC-3, then
       more channels.  The converter can't make Atmos (only Dolby's encoder can), so that track beats converting. */
    function atmos(t) { return /atmos|joc/i.test((t.profile || '') + ' ' + (t.title || '')); }
    function score(t) { return (want && lang(t) === want ? 8 : 0) + (defLang && t.lang === defLang ? 4 : 0) + (extra.test(t.title || '') ? -6 : 0) + (t.channels > 2 ? 1 : 0) + (atmos(t) ? 0.6 : 0) + (t.codec === 'eac3' ? 0.3 : 0) + Math.min(+t.channels || 0, 8) / 100; }
    var good = tracks.filter(function (t, i) { return !bad[i]; }).sort(function (x, y) { return score(y) - score(x) || x.index - y.index; });
    var named = tracks.some(function (t) { return !!t.lang; });
    // A playable track in the language wanted (or the movie's own, or tracks with no language at all):
    // play that one, nothing to convert.
    if (good.length && (prefs.noConverter || !named || score(good[0]) >= 4)) return { action: 'track', a: good[0].index, codec: good[0].codec, bad: bad };
    if (prefs.noConverter) return { action: 'play', a: def, bad: bad };
    var pick = tracks[def];
    if (want) tracks.forEach(function (t, i) { if (bad[i] && lang(t) === want && lang(pick) !== want && !extra.test(t.title || '')) pick = t; });
    return { action: 'convert', a: pick.index, codec: pick.codec, channels: pick.channels, why: bad[pick.index], bad: bad };
  }

  /* ---------- links ---------- */
  // The key is new each time the helper starts: a helper started again (the app's watchdog, or webOS) needs it asked again.
  if (typeof Net !== 'undefined' && Net.onRestart) Net.onRestart(function () { key = ''; });
  function ensureKey(fresh) {
    if (fresh) key = '';
    if (key) return Promise.resolve(key);
    return ask('/convert/key').then(function (j) { key = j.key || ''; if (!key) throw new Error('no key'); return key; });
  }
  // conv: { src, a, t, fmt, codec, channels }
  function link(conv) {
    var ua = typeof Net !== 'undefined' ? Net.ua : '';
    return base() + '/convert/' + key + '/movie.' + (conv.fmt === 'ts' ? 'ts' : 'mkv') + '?u=' + encodeURIComponent(conv.src) +
      '&t=' + (Math.round((conv.t || 0) * 1000) / 1000) + '&a=' + (conv.a | 0) +
      (conv.codec ? '&c=' + encodeURIComponent(conv.codec) + '&ch=' + (conv.channels | 0) + (conv.rate ? '&sr=' + (conv.rate | 0) : '') : '') + (conv.dv === 81 ? '&dv=81' : '') +
      // Dialogue boost and night mode (dialog.js): the converter's filters on the sound (service/convert.js fxChain).
      (conv.fx && conv.fx.b ? '&b=' + conv.fx.b : '') + (conv.fx && conv.fx.n ? '&n=1' : '') + (ua ? '&ua=' + encodeURIComponent(ua) : '');
  }
  // Where the running conversion's picture starts in the movie: { from, first } (service/convert.js firstPts).
  function first() { return ask('/convert/first'); }
  function probe(url) {
    var k = url + '|' + (typeof Net !== 'undefined' ? Net.ua : '');
    if (probes[k]) return Promise.resolve(probes[k]);
    var ua = typeof Net !== 'undefined' ? Net.ua : '';
    return ask('/convert/probe?u=' + encodeURIComponent(url) + (ua ? '&ua=' + encodeURIComponent(ua) : '')).then(function (r) { probes[k] = r; return r; });
  }
  function within(p, ms) { return new Promise(function (resolve, reject) { var t = setTimeout(function () { reject(new Error('timed out')); }, ms); p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); }); }); }

  /* ---------- before a movie starts ----------
     o: { url, media, title, container }.  Resolves with null (play as it is), or
       { conv: { src, a, fmt, codec, channels, tracks, dur }, notice }   play the conversion
       { track: a, tracks, bad }                                         pick audio track a
       { offer: 'DTS' }                                                  the converter would help but isn't here */
  /* How a converted movie travels: MPEG-TS into TiviBro's own MSE player where the TV takes AC-3 there
     (and the video), else MKV for the TV's player.  The TV's player shows no picture from an MKV that
     arrives as an endless stream (a C2: sound, black screen), while the MSE player reads a stream the way
     it reads a live channel. */
  function fmtFor(video) {
    var c = Caps.probe();
    return typeof mpegts !== 'undefined' && c.mse && c.mse.ac3 && (!video || c.mse[video] !== false) ? 'ts' : 'mkv';
  }
  function plan(o) {
    if (!on() || !base() || !o || !o.url || !/^https?:/i.test(o.url)) return Promise.resolve(null);
    var m = o.media || {}, known = m.audio && m.audio.length ? m.audio : null, c = Caps.probe();
    var bad = known && known.every(function (a) { return Caps.unplayable(a, m.channels || 0, c); });
    /* o.sync: Audio sync moves this movie's sound (avsync.js), which only TiviBro's own player can do, so the file
       goes through the converter as MPEG-TS even when the TV plays its sound as it is (the sound copied). */
    /* o.boost: dialogue boost or night mode (dialog.js), which only the converter can do on a TV: the file goes
       through it too, its sound processed (and whatever it finds, the boost goes along: withFx). */
    var fx = o.boost || null;
    if (known && !bad && !o.sync && !fx) return Promise.resolve(null);       // the movie's own sound plays here
    var hint = !known && HINT.test((o.title || '') + ' ' + decodeURIComponentSafe(o.url));
    var fileLike = FILE.test(o.url) || /^(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(o.container || '');
    if (!bad && !hint && !fileLike && !o.sync && !fx) return Promise.resolve(null);
    return status().then(function (s) {
      // A release carries the converter: unpacking it takes a second, so nothing is asked.
      if (s.state !== 'ready' && s.bundled && s.state !== 'failed') return get().catch(function () { return s; });
      return s;
    }).then(function (s) {
      if (s.state !== 'ready') {
        if (!bad && !hint) return null;
        return { offer: NAMES[bad ? known[0] : 'dts'] || 'DTS', guessed: !bad };
      }
      /* A Stalker portal's movie or episode (issue #118): each check is one more link from the portal, which may
         allow one at a time (the player's own was then refused) and rate-limits (HTTP 429).  Not checked first;
         a sound the TV can't play is still found once it plays (the player's late check).  A playlist has no
         sound to check either. */
      if (/\.m3u8(\?|$)/i.test(o.url) || /\/stalker\/vod\//.test(o.url)) return null;
      return within(probe(o.url), 12000).then(function (info) {
        var d = decide(info.audio, c, { lang: settings().audioLang === 'orig' ? '' : settings().audioLang || '' });
        /* Dolby Vision profile 7 (UHD Blu-ray remuxes): LG's player shows only its HDR10 base.  Through the
           converter as profile 8.1 it shows in Dolby Vision (service/convert.js, p81): the sound converted only
           if it needs it, the video copied.  For the TV's own player (MKV): the in-app player has no Dolby Vision. */
        if (dv81(info, c)) {
          var a81 = d.action === 'convert' || d.action === 'track' ? d.a : d.a != null ? d.a : 0, t81 = info.audio[a81] || {};
          return ensureKey().then(function () {
            return { conv: { src: o.url, a: a81, fmt: 'mkv', video: info.video || '', codec: t81.codec || '', channels: t81.channels || 0, rate: t81.rate || 0, tracks: info.audio, bad: d.bad, dur: info.duration || 0, dv: 81 },
              notice: d.action === 'convert' ? 'Dolby Vision 7 as 8.1, and ' + (NAMES[d.codec] || d.codec.toUpperCase()) + ' audio converted' : 'Dolby Vision 7 played as 8.1' };
          });
        }
        if ((d.action === 'play' || d.action === 'track') && fx) return ensureKey().then(function () { return forBoost(info, d, o.url, fx); });
        if ((d.action === 'play' || d.action === 'track') && o.sync) { var sy = forSync(info, d, c, o.url); if (sy) return ensureKey().then(function () { return sy; }); }
        if (d.action === 'play') return null;
        if (d.action === 'track') return { track: d.a, tracks: info.audio, bad: d.bad, dur: info.duration, video: info.video || '' };
        return ensureKey().then(function () {
          return { conv: { src: o.url, a: d.a, fmt: fmtFor(info.video), video: info.video || '', codec: d.codec, channels: d.channels || 0, rate: (info.audio[d.a] || {}).rate || 0, tracks: info.audio, bad: d.bad, dur: info.duration || 0 },
            notice: 'Converting ' + (NAMES[d.codec] || d.why || d.codec.toUpperCase()) + ' audio for this TV' };
        });
      });
    }).then(function (r) { return withFx(r, fx); }).catch(function (e) { if (typeof Log !== 'undefined') Log.warn('convert', 'Could not check the sound: ' + e.message); return null; });
  }
  // A plan that goes through the converter anyway (a sound the TV can't play, Dolby Vision 8.1): the boost along.
  function withFx(r, fx) { if (r && r.conv && fx) r.conv.fx = fx; return r; }
  /* A movie whose sound plays here, with dialogue boost or night mode on: through the converter, the picture copied
     and the chosen sound processed (stereo Dolby Digital out), for the TV's own player (MKV) or TiviBro's (MPEG-TS).
     A Dolby Vision movie always goes to the TV's own player: TiviBro's (the browser's) shows only its HDR10 base,
     so turning the boost on switched the picture from Dolby Vision to HDR. */
  function forBoost(info, d, url, fx) {
    var a = d.a != null ? d.a : Math.max(0, info.audio.map(function (x) { return !!x.def; }).indexOf(true)), t = info.audio[a] || {};
    return { conv: { src: url, a: a, fmt: info.dv ? 'mkv' : fmtFor(info.video), video: info.video || '', codec: t.codec || '', channels: t.channels || 0, rate: t.rate || 0, tracks: info.audio, bad: d.bad || [], dur: info.duration || 0, fx: fx },
      notice: 'Dialogue boost: the sound goes through the audio converter' };
  }
  /* A movie whose sound plays here, with Audio sync on it: through the converter as MPEG-TS, the picture and the
     chosen sound copied, when TiviBro's own player (MSE) takes both.  null: it can't, and plays as it is. */
  function forSync(info, d, c, url) {
    var a = d.a != null ? d.a : Math.max(0, info.audio.map(function (x) { return !!x.def; }).indexOf(true)), t = info.audio[a] || {};
    if (fmtFor(info.video) !== 'ts' || !t.codec || !c.mse || !c.mse[t.codec]) return null;
    return { conv: { src: url, a: a, fmt: 'ts', video: info.video || '', codec: t.codec, channels: t.channels || 0, rate: t.rate || 0, tracks: info.audio, bad: d.bad || [], dur: info.duration || 0, sync: true },
      notice: 'Playing through the converter so its sound can be moved' };
  }
  // Profile 7 as 8.1: the file is profile 7, the converter can (ffmpeg-7.1-tb3), the TV has Dolby Vision, and it isn't off.
  function dv81(info, c) { return !!(info && info.dv === 7 && info.p81 && c && c.tv && c.tv.dv8 && settings().dv7 !== 'off'); }
  // A live channel whose sound turned out to be unplayable (Player's media callback).
  function planLive(url, codec, channels, rate) {
    if (!on() || !base()) return Promise.resolve(null);
    // What it is, for the notice: "DTS", or "AAC at 96 kHz" (Caps.unplayable).
    var what = NAMES[codec] || (typeof Caps !== 'undefined' && Caps.unplayable(codec, channels, null, rate)) || String(codec).toUpperCase();
    return status().then(function (s) {
      if (s.state !== 'ready') return { offer: what };
      return ensureKey().then(function () {
        return { conv: { src: url, a: 0, fmt: 'ts', codec: codec, channels: channels || 0, rate: rate || 0, tracks: [], bad: [], dur: 0, fx: typeof Dialog !== 'undefined' ? Dialog.fx() : null }, notice: 'Converting ' + what + ' audio for this TV' };
      });
    }).catch(function () { return null; });
  }
  /* A live channel with dialogue boost or night mode on (dialog.js), whose sound the TV plays as it is: through the
     converter with the boost.  A release carries the converter, so it's unpacked if needed; without it, null (the
     channel plays as it is, said once in the log). */
  function planBoost(url, codec, channels, rate) {
    var fx = typeof Dialog !== 'undefined' ? Dialog.fx() : null;
    if (!fx || !on() || !base()) return Promise.resolve(null);
    return status().then(function (s) {
      if (s.state !== 'ready' && s.bundled && s.state !== 'failed') return get().then(status, function () { return s; });
      return s;
    }).then(function (s) {
      if (s.state !== 'ready') { if (typeof Log !== 'undefined') Log.warn('convert', 'Dialogue boost needs the audio converter, which isn\'t ready'); return null; }
      return ensureKey().then(function () {
        return { conv: { src: url, a: 0, fmt: 'ts', codec: codec || '', channels: channels || 0, rate: rate || 0, tracks: [], bad: [], dur: 0, fx: fx }, notice: 'Dialogue boost: the sound goes through the audio converter' };
      });
    }).catch(function () { return null; });
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /* ---------- asking, once ---------- */
  // The offer, on the TV's screen.  cb(true) once the converter is ready, cb(false) otherwise.
  /* Offer to get the converter.  what: the sound's name ("DTS"); guessed: not known for sure.  why: instead of the
     sentence about the sound, another reason (a movie the TV refused outright, player.js rescue()). */
  function offer(what, guessed, cb, why) {
    var s = settings();
    // Carried by this build: no question, just unpack it.
    if (st && st.bundled && st.state !== 'failed') return get().then(function () { cb(true); }, function () { cb(false); });
    // Asked every time a movie needs it, until "Don't ask again" (Settings > Audio and subtitles still gets it).
    if (s.convertNever || typeof UI === 'undefined' || !UI.panel) return cb(false);
    s.convertAsked = true;
    try { Store.saveSettings(); } catch (e) {}
    var body = U.el('p', 'panel-text', why ? why + '' : (guessed ? 'This movie\'s sound looks like ' + what + ', which this TV can\'t play.' : 'This movie\'s sound is ' + what + ', which this TV can\'t play.') +
      '  Get the audio converter (2 MB, kept on the TV\'s storage)?  It turns the sound into Dolby Digital, which every LG TV plays.  Settings > Audio and subtitles can remove it again.');
    UI.panel(why ? 'This video won\'t play as it is' : 'Sound this TV can\'t play', body, [
      { label: 'Get', action: function () {
        U.toast('Getting the audio converter…', 30000);
        get(function (p) { U.toast('Getting the audio converter… ' + p + '%', 30000); }).then(function () { U.toast('Audio converter ready', 2500); cb(true); },
          function (e) { U.toast(e.message, 7000); cb(false); });
      } },
      { label: 'Not now', action: function () { cb(false); } },
      { label: 'Don\'t ask again', action: function () { s.convertNever = true; try { Store.saveSettings(); } catch (e) {} cb(false); } }
    ], function () { cb(false); });
  }
  function noSound(what) { return what + ' sound, which this TV can\'t play.  Settings > Audio and subtitles can get the audio converter, or pick another audio track.'; }

  return { first: first, _forSync: forSync, _forBoost: forBoost, fmtFor: fmtFor, on: on, status: status, get: get, remove: remove, describe: describe, decide: decide, link: link, plan: plan, planLive: planLive, planBoost: planBoost, offer: offer, noSound: noSound,
    probe: probe, ensureKey: ensureKey, NAMES: NAMES, _dv81: dv81, get key() { return key; }, _reset: function () { key = ''; st = null; probes = {}; } };
})();
