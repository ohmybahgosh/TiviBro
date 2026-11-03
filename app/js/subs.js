/* Subtitles for movies and shows (discussion #19): find them on OpenSubtitles.com, move them earlier or
   later, and line one up with another that is already in time.
   - Find subtitles: a search filled in from what's playing (title, year, season and episode), which you
     can change (for a title the subtitle sites know by another name), in your subtitle languages.
     The helper asks OpenSubtitles (service/subtitles.js) with the viewer's own free API key; with a free
     account too, 20 downloads a day instead of 5.
   - Timing: + / - 0.1 s and 1 s, for subtitles a little early or late (any track whose lines can be read).
   - Line up with another track: finds the shift (and a frame-rate difference, 23.976 / 24 / 25 fps)
     that best matches a subtitle already in time, like AutoSubSync does with a reference subtitle.
   The key and login stay on this TV (localStorage 'tivibro.subs'), out of backups and problem reports. */
var Subs = (function () {
  'use strict';
  var KEY = 'tivibro.subs';
  var EXTRA = [['ea', 'Spanish (Latin America)'], ['pt-br', 'Portuguese (Brazil)'], ['zh-tw', 'Chinese (traditional)']];
  var state = read(), added = [], delay = 0, delayTimer = 0, lastFind = null;

  function read() { try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } }
  function langs() {
    var l = Store.settings.subLangs;
    if (Array.isArray(l) && l.length) return l;
    return [Store.settings.subsLang || Store.settings.audioLang || 'en'];
  }
  function langList() { return U.LANGS.map(function (l) { return [l[0], l[1]]; }).concat(EXTRA); }
  function langName(code) { var l = langList().filter(function (x) { return x[0] === code; })[0]; return l ? l[1] : code; }

  /* ---------- the helper ---------- */
  function ask(route, body, ms) {
    if (!Net.port) return Promise.reject(new Error('The TiviBro helper is not running.  Close TiviBro and open it again.'));
    return new Promise(function (resolve, reject) {
      var done = false, timer = setTimeout(function () { if (!done) { done = true; reject(new Error('OpenSubtitles did not answer in time.')); } }, ms || 30000);
      fetch('http://127.0.0.1:' + Net.port + '/media/subs/' + route, { method: 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (done) return; done = true; clearTimeout(timer); if (j && j.error) reject(new Error(j.message || j.error)); else resolve(j); },
          function () { if (done) return; done = true; clearTimeout(timer); reject(new Error('Could not reach the helper.')); });
    });
  }
  // A login token lasts about a day; sign in again when it is older than 20 hours.
  function token() {
    if (!state.user || !state.pass) return Promise.resolve('');
    if (state.token && Date.now() - (state.tokenAt || 0) < 20 * 3600e3) return Promise.resolve(state.token);
    return ask('login', { key: state.key, user: state.user, pass: state.pass }).then(function (j) { state.token = j.token; state.tokenAt = Date.now(); state.allowed = j.allowed; save(); return j.token; },
      function (e) { Log.warn('subs', 'OpenSubtitles sign-in failed: ' + e.message); return ''; });
  }
  function setKey(k) {
    k = String(k || '').trim();
    if (k && !/^[A-Za-z0-9]{16,64}$/.test(k)) throw new Error('That does not look like an OpenSubtitles API key (letters and numbers, from your profile at opensubtitles.com).');
    state.key = k; state.token = ''; save();
  }
  function signIn(user, pass) {
    state.user = String(user || '').trim(); state.pass = String(pass || ''); state.token = ''; save();
    if (!state.user) { state.pass = ''; save(); return Promise.resolve(null); }
    return token().then(function (t) { if (!t) throw new Error('OpenSubtitles did not accept that username and password.'); return state.allowed; });
  }

  /* ---------- what's playing ---------- */
  // "EN - The Matrix (1999) [4K]" -> "The Matrix"
  function clean(t) {
    return String(t || '').replace(/^\s*(\[[^\]]{1,8}\]|\|[^|]{1,8}\||[A-Z]{2,4}\s*[-:|]\s+)/, '')
      .replace(/[([]?\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|multi[- ]?subs?|hevc|x26[45])\b[)\]]?/ig, '').replace(/\s{2,}/g, ' ').trim()
      .replace(/\s*[([]\s*(19|20)\d\d\s*[)\]]\s*$/, '').replace(/[\s\-|:]+$/, '').trim();
  }
  function guess(meta) {
    var it = meta && meta.item || {}, q = { type: 'movie', query: '', year: '', season: 0, episode: 0 };
    if (it.ep) { q.type = 'episode'; q.query = clean(String(meta.title || '').split(/\s{3}/)[0]); q.season = +it.season || 0; q.episode = +it.num || 0; }
    else { q.query = clean(it.name || it.title || meta && meta.title); q.year = String(it.year || meta && meta.sub || '').slice(0, 4); }
    if (!/^\d{4}$/.test(q.year)) { var y = /\b(19|20)\d\d\b/.exec(it.name || it.title || meta && meta.title || ''); q.year = y ? y[0] : ''; }
    return q;
  }

  /* ---------- subtitle files ---------- */
  function time(t) { var m = /(?:(\d+):)?(\d+):(\d+)[,.](\d{1,3})/.exec(t); if (!m) return NaN; return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +('0.' + (m[4] + '00').slice(0, 3)); }
  // SRT or WebVTT (and ASS dialogue lines) to [{ s, e, text }].
  function parse(text) {
    var out = [];
    text = String(text || '').replace(/\r\n?/g, '\n');
    if (/^\[Script Info\]/m.test(text)) {
      text.split('\n').forEach(function (l) {
        var m = /^Dialogue:\s*[^,]*,(\d+:\d\d:\d\d\.\d\d),(\d+:\d\d:\d\d\.\d\d),(?:[^,]*,){6}(.*)$/.exec(l);
        if (m) out.push({ s: time(m[1]), e: time(m[2]), text: m[3].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim() });
      });
    } else {
      text.split(/\n{2,}/).forEach(function (b) {
        var lines = b.split('\n'), i = 0;
        while (i < lines.length && lines[i].indexOf('-->') < 0) i++;
        if (i >= lines.length) return;
        var m = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[i]);
        if (!m) return;
        var t = lines.slice(i + 1).join('\n').replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]+>/gi, '').trim();
        if (t) out.push({ s: time(m[1]), e: time(m[2]), text: t });
      });
    }
    return out.filter(function (c) { return isFinite(c.s) && isFinite(c.e) && c.e > c.s; }).sort(function (a, b) { return a.s - b.s; });
  }
  function video() { return document.getElementById('video'); }
  /* video.addTextTrack: its lines stay put when the player reconnects (a <track> element with no file can
     lose them).  Such a track can't be removed, so when the video ends it is switched off and left out
     of every list (gone()). */
  var dead = [];
  function addTrack(label, lang, cues) {
    var v = video(), tr = v.addTextTrack('subtitles', label, lang || '');
    for (var i = 0; i < v.textTracks.length; i++) if (v.textTracks[i] !== tr && v.textTracks[i].kind === 'subtitles') v.textTracks[i].mode = 'disabled';
    tr.mode = 'showing';
    cues.forEach(function (c) { try { var q = new VTTCue(c.s + delay, c.e + delay, c.text); q._s0 = c.s; q._e0 = c.e; tr.addCue(q); } catch (e) {} });
    added.push(tr);
    return tr;
  }
  function gone(t) { return dead.indexOf(t) >= 0; }
  function reset() {
    added.forEach(function (t) { try { t.mode = 'disabled'; } catch (e) {} dead.push(t); });
    added = []; delay = 0; clearInterval(delayTimer); delayTimer = 0; lined = {};
  }

  /* ---------- timing ---------- */
  function cuesOf(t) { var c = t && t.cues, out = []; for (var i = 0; c && i < c.length; i++) out.push(c[i]); return out; }
  // Every cue keeps its own time (_s0) and shows at that time plus the delay.  Tracks that are still
  // filling in (subtitles read from the file as it plays) get the delay as their lines arrive.
  /* A track that was lined up keeps that (by its name and language): subtitles read from a movie file
     come back as new lines, on a new track even, after a seek or reconnect (mkvsubs.js), and get the
     same scale and shift as they arrive (fresh()). */
  var lined = {};
  function trackKey(t) { return (t.label || '') + '|' + (t.language || ''); }
  function fix(t) {
    var map = lined[trackKey(t)];
    cuesOf(t).forEach(function (c) {
      if (c._s0 == null) { c._s0 = map ? c.startTime * map.scale + map.off : c.startTime; c._e0 = map ? c.endTime * map.scale + map.off : c.endTime; }
      var s = Math.max(0, c._s0 + delay), e = Math.max(s + 0.05, c._e0 + delay);
      if (Math.abs(c.startTime - s) > 0.001) { try { c.startTime = s; c.endTime = e; } catch (x) {} }
    });
  }
  function applyDelay() {
    var v = video(), t = v && v.textTracks;
    for (var i = 0; t && i < t.length; i++) {
      if ((t[i].kind !== 'subtitles' && t[i].kind !== 'captions') || gone(t[i])) continue;
      fix(t[i]);
    }
  }
  function fresh(t) { if (t && (delay || lined[trackKey(t)])) fix(t); }
  function timed() { clearInterval(delayTimer); delayTimer = delay || Object.keys(lined).length ? setInterval(applyDelay, 2000) : 0; }
  function shift(d) {
    delay = Math.round((delay + d) * 10) / 10;
    applyDelay();
    timed();
    return delay;
  }

  /* ---------- line up with a subtitle already in time ----------
     For each frame rate ratio, the shift (to 0.1 s) that makes the two tracks' lines overlap most. */
  function overlap(a, b, scale, off) {
    var i = 0, j = 0, sum = 0;
    while (i < a.length && j < b.length) {
      var s1 = a[i].s * scale + off, e1 = a[i].e * scale + off, s2 = b[j].s, e2 = b[j].e;
      var o = Math.min(e1, e2) - Math.max(s1, s2);
      if (o > 0) sum += o;
      if (e1 < e2) i++; else j++;
    }
    return sum;
  }
  function align(target, ref) {
    var a = target.map(function (c) { return { s: c.s, e: c.e }; }), b = ref.map(function (c) { return { s: c.s, e: c.e }; });
    if (a.length < 5 || b.length < 5) return null;
    var best = { score: -1, scale: 1, off: 0 }, scales = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25];
    scales.forEach(function (sc) {
      var coarse = { score: -1, off: 0 };
      // A near tie goes to the smaller shift: dialogue with a regular rhythm can line up a beat away too.
      var near = function (v, w, o1, o2) { return v > w * 1.02 || (v > w * 0.98 && Math.abs(o1) < Math.abs(o2)); };
      for (var off = -120; off <= 120; off += 0.5) { var v = overlap(a, b, sc, off); if (coarse.score < 0 || near(v, coarse.score, off, coarse.off)) coarse = { score: v, off: off }; }
      for (var f = coarse.off - 0.6; f <= coarse.off + 0.6; f += 0.05) { var w = overlap(a, b, sc, f); if (w > best.score) best = { score: w, scale: sc, off: Math.round(f * 100) / 100 }; }
    });
    var total = b.reduce(function (n, c) { return n + (c.e - c.s); }, 0);
    best.match = total ? best.score / total : 0;
    return best;
  }
  function lineUp(target, ref) {
    var tc = cuesOf(target).map(function (c) { return { s: c._s0 != null ? c._s0 : c.startTime, e: c._e0 != null ? c._e0 : c.endTime, c: c }; });
    var rc = cuesOf(ref).map(function (c) { return { s: c.startTime, e: c.endTime }; });
    var r = align(tc, rc);
    if (!r) return null;
    r.moved = Math.round((r.off - delay) * 100) / 100;           // how far the lines move on screen
    tc.forEach(function (x) { x.c._s0 = x.s * r.scale + r.off - delay; x.c._e0 = x.e * r.scale + r.off - delay; });
    // On top of an earlier line-up: a line that arrives later gets both.
    var was = lined[trackKey(target)] || { scale: 1, off: 0 };
    lined[trackKey(target)] = { scale: r.scale * was.scale, off: r.scale * was.off + r.off - delay };
    applyDelay();
    timed();
    return r;
  }

  /* ---------- the menus ---------- */
  function find(meta) {
    if (!state.key) {
      UI.menu('Find subtitles', [
        { label: 'Add your OpenSubtitles API key first', sub: 'Free: sign up at opensubtitles.com, then Profile > API consumers > New consumer.  Then Settings > Playback > Subtitles from OpenSubtitles.' },
        { label: 'Open Settings', action: function () { Views.runAction('exit', 'player'); Views.switchTab('settings'); Settings.section('playback'); } }
      ]);
      return;
    }
    var q = lastFind && lastFind.id === meta.id ? lastFind.q : guess(meta);
    lastFind = { id: meta.id, q: q };
    var what = '"' + q.query + '"' + (q.type === 'episode' ? '  S' + U.pad(q.season || 0) + 'E' + U.pad(q.episode || 0) : q.year ? '  (' + q.year + ')' : '');
    UI.menu('Find subtitles', [
      { label: 'Search for ' + what, sub: langs().map(langName).join(', '), action: function () { search(meta, q); } },
      { label: 'Change the title…', sub: 'For a title the subtitle sites know by another name', action: function () { UI.prompt('Title to look for', q.query, function (v) { if (v.trim()) q.query = v.trim(); find(meta); }, 'Season and episode, or the year, are asked for next.', false, 'Next'); } },
      q.type === 'episode'
        ? { label: 'Season and episode…', sub: 'S' + U.pad(q.season || 0) + 'E' + U.pad(q.episode || 0), action: function () { UI.prompt('Season and episode', 'S' + U.pad(q.season || 0) + 'E' + U.pad(q.episode || 0), function (v) { var m = /s?(\d+)\D+e?(\d+)/i.exec(v); if (m) { q.season = +m[1]; q.episode = +m[2]; } find(meta); }, 'Like S01E04', false, 'OK'); } }
        : { label: 'Year…', sub: q.year || 'any', action: function () { UI.prompt('Year', q.year, function (v) { q.year = /^\d{4}$/.test(v.trim()) ? v.trim() : ''; find(meta); }, 'Leave empty for any year', false, 'OK'); } },
      { label: 'Languages…', sub: langs().map(langName).join(', '), action: function () { langMenu(function () { find(meta); }); } }
    ]);
  }
  function search(meta, q) {
    U.toast('Looking on OpenSubtitles…', 3000);
    token().then(function (tk) { return ask('search', { key: state.key, token: tk, query: q.query, year: q.year, season: q.season, episode: q.episode, type: q.type, langs: langs() }); })
      .then(function (j) {
        var r = j.results || [];
        if (!r.length) { U.toast('Nothing found for "' + q.query + '".  Change the title or the languages.', 6000); return find(meta); }
        var order = langs();
        r.sort(function (a, b) { return order.indexOf(a.lang) - order.indexOf(b.lang) || b.downloads - a.downloads; });
        UI.menu(r.length + ' subtitles for "' + q.query + '"', r.slice(0, 40).map(function (x) {
          var tags = [x.downloads.toLocaleString() + ' downloads'];
          if (x.fps) tags.push(x.fps + ' fps'); if (x.hi) tags.push('for the deaf and hard of hearing'); if (x.trusted) tags.push('trusted'); if (x.ai) tags.push('machine translated');
          return { label: langName(x.lang) + '  ·  ' + x.release, sub: tags.join('  ·  '), action: function () { fetchOne(x); } };
        }));
      }, function (e) { U.toast(e.message, 7000); });
  }
  function fetchOne(x) {
    U.toast('Downloading…', 3000);
    token().then(function (tk) { return ask('get', { key: state.key, token: tk, id: x.id }); }).then(function (j) {
      var cues = parse(j.text);
      if (!cues.length) throw new Error('That file had no subtitles TiviBro can read.');
      addTrack(langName(x.lang) + ' (OpenSubtitles)', x.lang, cues);
      Log.info('subs', 'OpenSubtitles: ' + cues.length + ' lines in ' + x.lang + ', ' + j.remaining + ' downloads left today');
      U.toast(langName(x.lang) + ' subtitles on.' + (j.remaining != null ? '  ' + j.remaining + ' downloads left today.' : '') + '  Out of time?  Subtitles > Timing.', 7000);
    }).catch(function (e) { U.toast(e.message, 7000); });
  }
  function langMenu(done) {
    var cur = langs().slice();
    function draw() {
      UI.menu('Subtitle languages', [{ label: 'Done', sub: cur.map(langName).join(', ') || 'none', action: function () { if (cur.length) { Store.settings.subLangs = cur; Store.saveSettings(); } if (done) done(); } }]
        .concat(langList().map(function (l) { var on = cur.indexOf(l[0]) >= 0; return { label: l[1], sub: on ? 'on' : '', action: function () { if (on) cur = cur.filter(function (c) { return c !== l[0]; }); else cur.push(l[0]); draw(); } }; })));
    }
    draw();
  }
  function timingMenu() {
    var sign = function (d) { return (d > 0 ? '+' : '') + d.toFixed(1) + ' s'; };
    var step = function (d) { return function () { shift(d); timingMenu(); }; };
    UI.menu('Subtitle timing: ' + sign(delay) + (delay ? (delay > 0 ? ', later' : ', earlier') : ''), [
      { label: 'Later by 0.1 s', sub: 'subtitles come too soon', action: step(0.1) },
      { label: 'Earlier by 0.1 s', sub: 'subtitles come too late', action: step(-0.1) },
      { label: 'Later by 1 s', action: step(1) },
      { label: 'Earlier by 1 s', action: step(-1) },
      delay && { label: 'Back to 0', action: function () { shift(-delay); timingMenu(); } },
      { label: 'Done', current: true }
    ]);
  }
  function lineUpMenu(tracks) {
    var showing = tracks.filter(function (t) { return t.mode === 'showing'; })[0];
    if (!showing) { U.toast('Turn on the subtitle to fix first.'); return; }
    // A track that is off has no lines to read; "hidden" keeps it off the screen but readable.
    tracks.forEach(function (t) { if (t !== showing && t.mode === 'disabled') t.mode = 'hidden'; });
    var others = tracks.filter(function (t) { return t !== showing && cuesOf(t).length; });
    if (!others.length) { U.toast('No other subtitle to line it up with.  Movies with built-in subtitles, or a second download, have one.', 7000); return; }
    UI.menu('Line up "' + (showing.label || 'this subtitle') + '" with…', others.map(function (t) {
      return { label: t.label || t.language || 'Track', sub: 'one that is already in time, any language', action: function () {
        U.toast('Lining up…', 2000);
        setTimeout(function () { lineUpNow(showing, t); }, 60);
      } };
    }));
  }
  function lineUpNow(showing, t) {
    {
      {
        var r = lineUp(showing, t);
        if (!r || r.match < 0.25) { U.toast('They don\'t match well enough to line up.  Try Timing instead.', 6000); return; }
        var fps = Math.abs(r.scale - 1) > 0.001 ? ', frame rate fixed' : '';
        U.toast('Lined up: ' + (r.moved > 0 ? r.moved.toFixed(2) + ' s later' : r.moved < 0 ? (-r.moved).toFixed(2) + ' s earlier' : 'already in time') + fps + ' (' + Math.round(r.match * 100) + '% match)', 7000);
      }
    }
  }

  return { find: find, gone: gone, refresh: applyDelay, fresh: fresh, timingMenu: timingMenu, lineUpMenu: lineUpMenu, langMenu: langMenu, reset: reset, setKey: setKey, signIn: signIn, langs: langs, langName: langName,
    get delay() { return delay; }, get configured() { return !!state.key; }, get user() { return state.user || ''; }, get allowed() { return state.allowed || 0; },
    _test: { parse: parse, align: align, clean: clean, guess: guess, shift: shift, addTrack: addTrack } };
})();
