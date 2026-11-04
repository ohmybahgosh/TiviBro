/* Subtitles for movies and shows (discussion #19): find them on OpenSubtitles.com, move them earlier or
   later, and line one up with another that is already in time.
   - Find subtitles: a search filled in from what's playing (title, year, season and episode), which you
     can change (for a title the subtitle sites know by another name), in your subtitle languages.
     The helper asks OpenSubtitles (service/subtitles.js) with the viewer's own free API key; with a free
     account too, 20 downloads a day instead of 5.
   - Timing: + / - 0.1 s and 1 s, for subtitles a little early or late (any track whose lines can be read),
     and a frame rate fix (23.976, 24, 25 fps) for lines that drift further out of time as the film goes on.
   - Line up with another track: finds the shift (and a frame-rate difference, 23.976 / 24 / 25 fps)
     that best matches a subtitle already in time, like AutoSubSync does with a reference subtitle.
   - Drawing: TiviBro draws the lines itself (drawLines), exactly the ones whose time includes now, and
     hides the TV's own drawing of them, which could leave a line stuck on screen after its times moved.
   The key and login stay on this TV (localStorage 'tivibro.subs'), out of backups and problem reports. */
var Subs = (function () {
  'use strict';
  var KEY = 'tivibro.subs';
  var EXTRA = [['ea', 'Spanish (Latin America)'], ['pt-br', 'Portuguese (Brazil)'], ['zh-tw', 'Chinese (traditional)']];
  var state = read(), added = [], delay = 0, rate = 1, delayTimer = 0, lastFind = null, version = 0;

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
    cues.forEach(function (c) { try { var p = placed(c.s, c.e), q = new VTTCue(p.s, p.e, c.text); q._s0 = c.s; q._e0 = c.e; tr.addCue(q); } catch (e) {} });
    added.push(tr);
    version++;
    startDrawing();
    drawLines();
    return tr;
  }
  function gone(t) { return dead.indexOf(t) >= 0; }
  function reset() {
    keepTiming();
    subject = '';
    added.forEach(function (t) { try { t.mode = 'disabled'; } catch (e) {} dead.push(t); });
    added = []; delay = 0; rate = 1; clearInterval(delayTimer); delayTimer = 0; lined = {}; version++;
    startDrawing();
  }

  /* ---------- downloads kept for a while (discussion #19) ----------
     A movie stopped on a work night and finished at the weekend gets its subtitles back without another
     download (they count against OpenSubtitles' daily limit).  Downloads are kept per movie or episode,
     with the timing that was set, for Settings > Playback > Keep downloaded subtitles (a week unless
     changed; Off keeps none).  At most 3 per title and about 1.5 MB in all, the oldest go first. */
  var KEPT = 'tivibro.subsKept', KEPT_CHARS = 1500000, subject = '';
  function keepDays() { var d = Store.settings.keepSubs; return d === 0 ? 0 : +d > 0 ? +d : 7; }
  function keptAll() {
    var o = null, days = keepDays(), old = Date.now() - days * 86400e3;
    try { o = JSON.parse(localStorage.getItem(KEPT) || 'null'); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') o = {};
    Object.keys(o).forEach(function (k) { if (!days || !o[k] || !(o[k].at > old)) delete o[k]; });
    return o;
  }
  function keptSave(o) {
    var keys = Object.keys(o).sort(function (a, b) { return o[a].at - o[b].at; }), text = JSON.stringify(o);
    while (keys.length && text.length > KEPT_CHARS) { delete o[keys.shift()]; text = JSON.stringify(o); }
    try { if (keys.length) localStorage.setItem(KEPT, text); else localStorage.removeItem(KEPT); } catch (e) {}
  }
  function keep(label, lang, cues) {
    if (!subject || !keepDays()) return;
    var o = keptAll(), r = o[subject] || { subs: [] };
    r.subs = r.subs.filter(function (x) { return x.label !== label; }).concat([{ label: label, lang: lang, c: cues.map(function (c) { return [c.s, c.e, c.text]; }) }]).slice(-3);
    r.at = Date.now(); r.delay = delay; r.rate = rate;
    o[subject] = r;
    keptSave(o);
  }
  function keepTiming() {
    if (!subject || !added.length || !keepDays()) return;
    var o = keptAll(), r = o[subject];
    if (!r) return;
    r.delay = delay; r.rate = rate; r.at = Date.now();
    keptSave(o);
  }
  /** A movie or episode starts: what was downloaded for it in the last days comes back, the last one on. */
  function restore(meta) {
    subject = meta && meta.id != null ? 'v:' + meta.id : '';
    if (!subject || !keepDays() || typeof document === 'undefined') return 0;
    var r = keptAll()[subject];
    if (!r || !r.subs || !r.subs.length) return 0;
    delay = +r.delay || 0; rate = +r.rate > 0 ? +r.rate : 1; timed();
    var v = video();
    if (v) v._subsChoice = true;
    r.subs.forEach(function (x) { addTrack(x.label, x.lang, x.c.map(function (c) { return { s: c[0], e: c[1], text: c[2] }; })); });
    var last = r.subs[r.subs.length - 1];
    Log.info('subs', 'Kept subtitles back: ' + r.subs.map(function (x) { return x.label; }).join(', '));
    U.toast(last.label + ' is on again, from last time.' + (delay || rate !== 1 ? '  With your timing.' : ''), 5000);
    return r.subs.length;
  }
  /** Settings: how many titles have subtitles kept now. */
  function keptCount() { return Object.keys(keptAll()).length; }
  function forgetKept() { try { localStorage.removeItem(KEPT); } catch (e) {} }

  /* ---------- timing ---------- */
  function cuesOf(t) { var c = t && t.cues, out = []; for (var i = 0; c && i < c.length; i++) out.push(c[i]); return out; }
  // Every cue keeps its own time (_s0) and shows at that time plus the delay.  Tracks that are still
  // filling in (subtitles read from the file as it plays) get the delay as their lines arrive.
  /* A track that was lined up keeps that (by its name and language): subtitles read from a movie file
     come back as new lines, on a new track even, after a seek or reconnect (mkvsubs.js), and get the
     same scale and shift as they arrive (fresh()). */
  var lined = {};
  function trackKey(t) { return (t.label || '') + '|' + (t.language || ''); }
  /* Where a line shows: its own time, scaled for the frame rate fix, plus the delay.  A line moved
     before 0 still ends after it starts. */
  function placed(s0, e0) { var s = Math.max(0, s0 * rate + delay); return { s: s, e: Math.max(s + 0.05, e0 * rate + delay) }; }
  function fix(t) {
    var map = lined[trackKey(t)];
    cuesOf(t).forEach(function (c) {
      if (c._s0 == null) { c._s0 = map ? c.startTime * map.scale + map.off : c.startTime; c._e0 = map ? c.endTime * map.scale + map.off : c.endTime; }
      var p = placed(c._s0, c._e0);
      if (Math.abs(c.startTime - p.s) > 0.001 || Math.abs(c.endTime - p.e) > 0.001) {
        // End first when a line moves later, start first when it moves earlier: it never has its end before its start.
        try { if (p.s > c.startTime) { c.endTime = p.e; c.startTime = p.s; } else { c.startTime = p.s; c.endTime = p.e; } } catch (x) {}
        version++;
      }
    });
  }
  function applyDelay() {
    var v = video(), t = v && v.textTracks;
    for (var i = 0; t && i < t.length; i++) {
      if ((t[i].kind !== 'subtitles' && t[i].kind !== 'captions') || gone(t[i])) continue;
      fix(t[i]);
    }
    drawLines();
  }
  function fresh(t) { if (t && (delay || rate !== 1 || lined[trackKey(t)])) fix(t); }
  function timed() { clearInterval(delayTimer); delayTimer = delay || rate !== 1 || Object.keys(lined).length ? setInterval(applyDelay, 2000) : 0; }
  function setRate(r) { rate = r > 0.5 && r < 2 ? r : 1; applyDelay(); timed(); keepTiming(); return rate; }
  function shift(d) {
    delay = Math.round((delay + d) * 10) / 10;
    applyDelay();
    timed();
    keepTiming();
    return delay;
  }

  /* ---------- drawing the lines (discussion #19) ----------
     The TV drew subtitle lines itself, and a line whose times changed while it was on screen (Timing,
     Line up, or the frame rate fix, every 2 s while lines arrive) could stay there, with newer lines
     drawn over it until the subtitle was switched off and on.  Now TiviBro draws them: four times a
     second, exactly the lines whose start is at or before now and whose end is after it, and the TV's
     own drawing is hidden (video.subs-drawn::cue).  Subtitles read from a movie file have their own
     drawing (mkvsubs.js) and are left to it. */
  var shots = [], board = null, boardText = null, drawTimer = 0;
  // A track's lines as a plain list in start order, rebuilt when the track or its times change.
  function snapshot(t) {
    var c = t.cues, n = c ? c.length : 0, now = Date.now();
    for (var k = 0; k < shots.length; k++) {
      var h = shots[k];
      if (h.t !== t) continue;
      if (h.n === n && h.v === version && now - h.at < 2000) return h;
      shots.splice(k, 1); break;
    }
    var list = [], longest = 0;
    for (var i = 0; i < n; i++) {
      var s = c[i].startTime, e = c[i].endTime;
      if (!(e > s)) continue;                       // a line with its end before its start never shows
      list.push({ s: s, e: e, text: c[i].text });
      if (e - s > longest) longest = e - s;
    }
    list.sort(function (a, b) { return a.s - b.s; });
    var shot = { t: t, n: n, v: version, at: now, list: list, longest: longest };
    shots.unshift(shot); shots.length = Math.min(shots.length, 8);
    return shot;
  }
  // The lines on screen at time t: every line that has started and not yet ended, nothing else.
  function linesAt(list, longest, t) {
    var lo = 0, hi = list.length, out = [];
    while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].s <= t) lo = mid + 1; else hi = mid; }
    for (var i = lo - 1; i >= 0 && list[i].s > t - longest - 0.001; i--) if (list[i].e > t) out.unshift(list[i].text);
    return out;
  }
  function drawLines() {
    var v = video();
    if (!v || !v.textTracks || !v.parentNode) return;
    var stage = v.parentNode, full = !stage.classList || stage.classList.contains('full'), lines = [], drawing = false, t = (v.currentTime || 0) + (v._tbOffset || 0);   // converted sound: see player.js
    for (var i = 0; full && i < v.textTracks.length; i++) {
      var tr = v.textTracks[i];
      if (tr.kind !== 'subtitles' || tr.mode !== 'showing' || tr._tbMkv || gone(tr)) continue;
      drawing = true;
      var sh = snapshot(tr);
      lines = lines.concat(linesAt(sh.list, sh.longest, t));
    }
    if (v.classList) v.classList.toggle('subs-drawn', drawing);
    if (!board && !drawing) return;
    if (!board) { board = document.createElement('div'); board.className = 'subs-captions'; }
    if (board.parentNode !== stage) stage.appendChild(board);
    var text = lines.join('\n').replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi, '');
    if (text !== boardText) { if (U.lines) U.lines(board, text); else board.textContent = text; board.style.display = text ? '' : 'none'; boardText = text; }
  }
  function startDrawing() { if (!drawTimer && typeof document !== 'undefined') drawTimer = setInterval(function () { try { drawLines(); } catch (e) {} }, 250); }

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
  function align(target, ref, total) {
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
    if (typeof total === 'function') total = total(best);
    if (total === undefined) total = b.reduce(function (n, c) { return n + (c.e - c.s); }, 0);
    else best.score = Math.min(best.score, total);
    best.match = total ? best.score / total : 0;
    return best;
  }
  function lineUp(target, ref) {
    var tc = cuesOf(target).map(function (c) { return { s: c._s0 != null ? c._s0 : c.startTime, e: c._e0 != null ? c._e0 : c.endTime, c: c }; });
    var rc = cuesOf(ref).map(function (c) { return { s: c.startTime, e: c.endTime }; });
    var r;
    if (target._embedded || ref._embedded) {
      // A track read from the file as it plays has lines only around where it was watched: score against
      // the reference's lines in the time both have lines for once the target is moved, not the whole
      // film's (the reference a little wider than the target, for the shift search).
      if (!tc.length || !rc.length) return null;
      var t0 = tc[0].s, t1 = tc[tc.length - 1].e;
      var rIn = rc.filter(function (x) { return x.e > Math.min(t0, t0 * 0.95) - 120 && x.s < Math.max(t1, t1 * 1.05) + 120; });
      r = align(tc, rIn, function (best) {
        var lo = Math.max(t0 * best.scale + best.off, rc[0].s), hi = Math.min(t1 * best.scale + best.off, rc[rc.length - 1].e);
        return rc.reduce(function (n, x) { return n + Math.max(0, Math.min(x.e, hi) - Math.max(x.s, lo)); }, 0);
      });
    } else r = align(tc, rc);
    if (!r) return null;
    r.moved = Math.round((r.off - delay) * 100) / 100;           // how far the lines move on screen
    // Shown at _s0 * rate + delay (placed()), which must land on s * scale + off.
    tc.forEach(function (x) { x.c._s0 = (x.s * r.scale + r.off - delay) / rate; x.c._e0 = (x.e * r.scale + r.off - delay) / rate; });
    // On top of an earlier line-up: a line that arrives later gets both.
    var was = lined[trackKey(target)] || { scale: 1, off: 0 };
    lined[trackKey(target)] = { scale: r.scale * was.scale / rate, off: (r.scale * was.off + r.off - delay) / rate };
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
      keep(langName(x.lang) + ' (OpenSubtitles)', x.lang, cues);
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
  /* Frame rate fix: a subtitle made for a video at one frame rate, played with a copy at another (a
     25 fps European copy of a 23.976 fps film, say), drifts further out of time as the film goes on.
     Every line's time is scaled by subtitle fps / video fps. */
  var RATES = [[23.976, 25], [25, 23.976], [24, 25], [25, 24], [23.976, 24], [24, 23.976]];
  function rateName() {
    for (var i = 0; i < RATES.length; i++) if (Math.abs(RATES[i][0] / RATES[i][1] - rate) < 1e-6) return RATES[i][0] + ' to ' + RATES[i][1] + ' fps';
    return rate === 1 ? 'off' : 'fixed by Line up';
  }
  function timingSummary() {
    var d = delay ? (delay > 0 ? '+' : '') + delay.toFixed(1) + ' s' : '';
    return [d, rate !== 1 ? rateName() : ''].filter(Boolean).join(', ') || 'in time';
  }
  function rateMenu() {
    UI.menu('Frame rate fix: ' + rateName(), [{ label: 'Off', sub: rate === 1 ? 'on' : 'lines keep their own times', action: function () { setRate(1); timingMenu(); } }]
      .concat(RATES.map(function (r) {
        var k = r[0] / r[1], on = Math.abs(k - rate) < 1e-6;
        return { label: 'Subtitle for ' + r[0] + ' fps, video at ' + r[1] + ' fps', sub: on ? 'on' : k < 1 ? 'lines come later and later' : 'lines come sooner and sooner', action: function () { setRate(k); timingMenu(); } };
      })).concat([{ label: 'Only some parts out of time?', sub: 'In time, then early or late, then in time again: that subtitle was made for another cut of the film.  Try another download.' }]));
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
      { label: 'Frame rate…', sub: rate === 1 ? 'for lines that drift further out of time as the film goes on' : rateName(), action: rateMenu },
      { label: 'Done', current: true }
    ]);
  }
  function lineUpMenu(tracks) {
    var showing = tracks.filter(function (t) { return t.mode === 'showing'; })[0];
    if (!showing) { U.toast('Turn on the subtitle to fix first.'); return; }
    // A track that is off has no lines to read; "hidden" keeps it off the screen but readable.
    tracks.forEach(function (t) { if (t !== showing && t.mode === 'disabled') t.mode = 'hidden'; });
    // Tracks read from the file as it plays (MP4) are read only when picked (_embedLoad).
    var others = tracks.filter(function (t) { return t !== showing && (cuesOf(t).length || t._embedLoad); });
    if (!others.length) { U.toast('No other subtitle to line it up with.  Movies with built-in subtitles, or a second download, have one.', 7000); return; }
    UI.menu('Line up "' + (showing.label || 'this subtitle') + '" with…', others.map(function (t) {
      return { label: t.label || t.language || 'Track', sub: 'one that is already in time, any language', action: function () {
        U.toast('Lining up…', 2000);
        setTimeout(function () { lineUpNow(showing, t); }, 60);
      } };
    }));
  }
  function lineUpNow(showing, t) {
    if (t._embedLoad) {
      // Read the reference where the target has lines (and 30 s around), within Line up's ±120 s search
      // around now, then match.  Its reading stops once it settles.
      var tl = cuesOf(showing), now = ((video() || {}).currentTime || 0) + ((video() || {})._tbOffset || 0);
      var from = tl.length ? Math.max(tl[0].startTime - 30, now - 150) : now - 150;
      var to = tl.length ? Math.min(tl[tl.length - 1].endTime + 30, now + 180) : now + 180;
      U.toast('Lining up…', 20000);
      t._embedLoad(from, to, 20000).then(function () { match(showing, t); },
        function () { U.toast('That subtitle took too long to read.  Try again, or use Timing.', 6000); });
      return;
    }
    match(showing, t);
  }
  function match(showing, t) {
    {
      {
        var r = lineUp(showing, t);
        if (!r || r.match < 0.25) { U.toast('They don\'t match well enough to line up.  Try Timing instead.', 6000); return; }
        var fps = Math.abs(r.scale - 1) > 0.001 ? ', frame rate fixed' : '';
        U.toast('Lined up: ' + (r.moved > 0 ? r.moved.toFixed(2) + ' s later' : r.moved < 0 ? (-r.moved).toFixed(2) + ' s earlier' : 'already in time') + fps + ' (' + Math.round(r.match * 100) + '% match)', 7000);
      }
    }
  }

  // How a track's lines are shown, for readers that draw them (embedsubs.js): shown time = file time
  // * scale + off + delay (a Line up, the frame rate fix, then Timing; placed() and fix() do the same).
  function timingOf(t) {
    var map = t && lined[trackKey(t)];
    return { scale: (map ? map.scale : 1) * rate, off: (map ? map.off : 0) * rate, delay: delay };
  }
  // Whether a track that just appeared turns on by itself (Settings > Playback): not once the viewer
  // chose in the Subtitles menu during this playback (Off included), and never a forced track.
  function autoOn(t, v) {
    var want = Store.settings.subsLang || '';
    return !!(Store.settings.autoSubs && t && t.kind === 'subtitles' && !t._forced && !(v && v._subsChoice) &&
      (!want || U.lang(t.language || t.label) === want));
  }

  return { find: find, gone: gone, refresh: applyDelay, fresh: fresh, timingOf: timingOf, autoOn: autoOn, timingMenu: timingMenu, lineUpMenu: lineUpMenu, langMenu: langMenu, reset: reset, restore: restore, keptCount: keptCount, forgetKept: forgetKept, setKey: setKey, signIn: signIn, langs: langs, langName: langName,
    get delay() { return delay; }, get rate() { return rate; }, get timing() { return timingSummary(); }, setRate: setRate, draw: drawLines, get configured() { return !!state.key; }, get user() { return state.user || ''; }, get allowed() { return state.allowed || 0; },
    _test: { keep: keep, parse: parse, align: align, clean: clean, guess: guess, shift: shift, addTrack: addTrack, linesAt: linesAt, snapshot: snapshot, setRate: setRate, lineUp: lineUp, applyDelay: applyDelay } };
})();
