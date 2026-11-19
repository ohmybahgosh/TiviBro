/* Seek previews: while you seek in a movie or an episode (◀ ▶, the jumps, the Magic Remote over the bar), a
   picture of the movie at that time shows over the progress bar.  The TV's TiviBro service makes it from the
   movie playing now, one keyframe at a time (service/seekprev.js): nothing of the library is read.

   Settings > Playback > Seek previews, or Red in the player:
     Automatic   pictures as you seek, and a few ahead.  With Memory-safe playback on (1 GB TVs, or after
                 TiviBro closed while playing), only for movies up to 1080p, and nothing made ahead: a 4K frame
                 takes the TV's memory for a moment.
     On          always, 4K too.
     Off         none.
   Movies and episodes from files only (My media, the provider's movies and shows), never live TV or catch-up.
   Pictures come every 10 seconds of the movie (a press lands on the keyframe at or before it).  While the movie
   plays with plenty buffered, or sits paused, a few dozen pictures spread over the movie are made ahead, one
   at a time, so a long jump has one ready. */
var SeekPrev = (function () {
  'use strict';
  // Elements with words on them, in the viewer's language (I18n: titles and names come as RAW and stay as they are).
  function tel(tag, cls, text) { return U.el(tag, cls, text == null || typeof I18n === 'undefined' ? text : I18n.t(text)); }
  var STEP = 10, W = 320;
  var key = '', ok = null, movie = null, box = null, img = null, label = null, shownT = -1, wantT = -1, t0 = 0, timer = null, fill = null, made = {};
  /* Pictures this TV has (an object URL each, kept for the movie), the ones being fetched, and the one fetched for
     "now" (one at a time: presses in a row ask for where they stop, once the last one is in). */
  var ready = {}, readyN = 0, asking = {}, nowBusy = false;

  function setting() { var v = typeof Store !== 'undefined' && Store.settings && Store.settings.seekPreviews; return v === 'on' || v === 'off' ? v : 'auto'; }
  function lean() { return !!(typeof Player !== 'undefined' && Player.memSafe); }
  function base() { return typeof Net !== 'undefined' && Net.port && Net.active ? 'http://127.0.0.1:' + Net.port : ''; }
  // The movie's own link, from what the player was given: the converter's stream carries it as u=, the relay
  // has it inside, a My media file served by the helper (/media-stream/) is read as it is.
  function source(url) {
    url = String(url || '');
    var c = /\/convert\/[a-f0-9]{32}\/movie\.(?:mkv|ts)\?(?:.*&)?u=([^&]+)/.exec(url);
    if (c) { try { url = decodeURIComponent(c[1]); } catch (e) { return ''; } }
    if (typeof Net !== 'undefined' && Net.unwrap) url = Net.unwrap(url);
    if (!/^https?:\/\//i.test(url) || /\.m3u8(\?|$)/i.test(url)) return '';
    // A Stalker portal's movie: each look at it asks the portal for a new link (issue #118: every few seconds while it played).
    if (/\/stalker\/vod\//.test(url)) return '';
    return url;
  }
  function video() { return document.getElementById('video'); }
  // Pictures for this movie?  The setting, the service, and (Automatic with Memory-safe on) no more than 1080p.
  function allowed() {
    if (!movie || !ok || setting() === 'off') return false;
    if (setting() === 'auto' && lean()) { var v = video(); if (v && v.videoHeight > 1088) return false; }
    return true;
  }
  // &l=1: a TV short of memory, so the service keeps less of the movie for the pictures (service/blockcache.js).
  function link(t, ahead) { return base() + '/preview/' + key + '/frame.jpg?u=' + encodeURIComponent(movie.u) + '&t=' + t + '&w=' + W + (movie.ua ? '&ua=' + encodeURIComponent(movie.ua) : '') + (ahead ? '&p=1' : '') + (lean() ? '&l=1' : ''); }
  function bucket(t) { return Math.max(0, Math.round(t / STEP) * STEP); }

  // A movie starts (views.js playVod): its link, and whether this TV's service can make pictures.
  function start(meta, url) {
    stop();
    var u = source(url);
    if (!u || !base() || typeof Convert === 'undefined') return;
    movie = { u: u, ua: meta && meta.ua || '', chapters: [] };
    var m = movie;
    Convert.ensureKey().then(function (k) {
      key = k;
      // The file's chapters (marks on the bar, their names as you seek, Skip intro: skipper.js), with previews on or off.
      fetch(base() + '/preview/' + key + '/chapters?u=' + encodeURIComponent(m.u) + (m.ua ? '&ua=' + encodeURIComponent(m.ua) : ''), { cache: 'no-store' })
        .then(function (r) { return r.json(); }).then(function (j) { if (movie !== m) return; m.chapters = (j.chapters || []).filter(function (c) { return c.e > c.s; }); marksFor = null; if (m.chapters.length) Log.info('player', 'This file has ' + m.chapters.length + ' chapters'); if (typeof Skipper !== 'undefined') Skipper.chapters(m.chapters); }, function () {});
      if (setting() === 'off') return false;
      if (ok !== null) return ok;
      return fetch(base() + '/preview/' + key + '/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { ok = !!j.ok; if (!ok) Log.info('player', 'Seek previews need the newer converter on this TV: it comes with the next TiviBro update'); return ok; });
    }).then(function () { if (movie === m) fillSoon(4000); }, function () {});
  }
  function stop() { if (sheet) { sheet.el.remove(); sheet = null; } movie = null; made = {}; for (var k in ready) URL.revokeObjectURL(ready[k]); ready = {}; tried = {}; readyN = 0; asking = {}; nowBusy = false; if (img) img._t = null; clearTimeout(fill); fill = null; hide(); marksFor = null; if (marksEl) marksEl.innerHTML = ''; if (typeof Skipper !== 'undefined') Skipper.chapters([]); }

  function build() {
    if (box) return box;
    var prog = document.querySelector('#osd .osd-prog'); if (!prog) return null;
    box = tel('div', 'seekprev hidden'); img = tel('img', 'seekprev-pic'); img.alt = ''; label = tel('div', 'seekprev-time');
    box.appendChild(img); box.appendChild(label); prog.appendChild(box);
    return box;
  }
  function hide() { if (box) { box.classList.add('hidden'); box.classList.remove('has', 'wait'); } shownT = -1; wantT = -1; clearTimeout(timer); if (movie && !fill) fillSoon(2000); }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  // The chapter a time is in (its title), or null.
  function chapterAt(t) { var c = movie && movie.chapters || []; for (var i = 0; i < c.length; i++) if (t >= c[i].s && t < c[i].e) return c[i]; return null; }
  // A chapter's own name, or "Chapter 3" for the ones named only by number or time ("Chapter 03", "00:08:43.648").
  function chapterName(c, i) { var t = c && String(c.t || '').trim(); return t && !/^(chapter|chap\.?|part|kapitel|chapitre|cap[ií]tulo)?\s*[\d:.]+$/i.test(t) ? t : 'Chapter ' + (i + 1); }
  // The chapters as small marks on the bar (each chapter's start), drawn again only when the movie or its length changes.
  var marksEl = null, marksFor = null;
  function marks(d) {
    var prog = document.querySelector('#osd .osd-prog'), bar = prog && prog.querySelector('.bar'); if (!bar) return;
    var c = movie && movie.chapters || [], k = movie ? movie.u + '|' + d + '|' + c.length + '|' + bar.offsetWidth : '';
    if (k === marksFor) return;
    marksFor = k;
    if (!marksEl) { marksEl = tel('div', 'chapmarks'); prog.appendChild(marksEl); }
    marksEl.innerHTML = '';
    marksEl.style.left = bar.offsetLeft + 'px'; marksEl.style.width = bar.offsetWidth + 'px'; marksEl.style.top = bar.offsetTop + 'px';
    if (!d || c.length < 2) return;
    c.forEach(function (x) { if (x.s < 1 || x.s > d - 1) return; var e = tel('i'); e.style.left = (100 * x.s / d) + '%'; marksEl.appendChild(e); });
  }

  /* The player's seek (views.js osd): t the time being sought to (null: not seeking), d the length, dir the way. */
  function show(t, d, dir) {
    if (d) marks(d);
    var c = t != null ? chapterAt(t) : null, ci = c ? movie.chapters.indexOf(c) : -1;
    // No pictures (Off, a TV short of memory on a 4K movie, no newer converter): the chapter's name alone, if any.
    if (t != null && d && !allowed() && c && movie.chapters.length > 1 && build()) {
      box.classList.remove('hidden', 'has', 'wait'); box.classList.add('nopic');
      var bar0 = document.querySelector('#osd .osd-prog .bar');
      box.style.left = Math.max(W / 2 + 8, bar0 ? bar0.offsetLeft + Math.max(0, Math.min(1, t / d)) * bar0.offsetWidth : 0) + 'px';
      label.textContent = chapterName(c, ci) + '  ·  ' + fmt(t);
      return;
    }
    if (t == null || !d || !allowed() || !build()) return hide();
    box.classList.remove('hidden', 'nopic');
    // Over the bar (900 px, not the whole width), its middle where the seek lands, kept on the screen.
    var bar = document.querySelector('#osd .osd-prog .bar'), f = Math.max(0, Math.min(1, t / d));
    var x = bar ? bar.offsetLeft + f * bar.offsetWidth : 0;
    box.style.left = Math.max(W / 2 + 8, x) + 'px';
    label.textContent = (c && movie.chapters.length > 1 ? chapterName(c, ci) + '  ·  ' : '') + fmt(t);
    var b = bucket(t);
    if (b === wantT) return;
    wantT = b; t0 = Date.now(); shownT = b;
    // Its own picture if this TV has it, else the nearest one it has (dimmed) until its own comes.
    if (ready[b]) { paint(b, true); return; }
    var n = nearest(b);
    if (n >= 0) paint(n, false); else { box.classList.remove('has'); box.classList.add('wait'); }
    // A short wait: presses in a row ask only for where they stop.
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (wantT !== b || !movie) return;
      askNow();
      // The next two presses the way it's going, asked ahead (not on a TV short of memory).
      if (dir && !lean()) for (var i = 1; i <= 2; i++) ahead(b + dir * i * STEP * Math.max(1, Math.round(Math.abs((+Store.settings.skip || 10) / STEP))), d);
    }, 140);
  }
  function ahead(t, d) {
    t = bucket(t);
    if (t < 0 || t > d || ready[t] || asking[t]) return;
    get(t, true);
  }
  /* One picture into ready[t] (fetched, kept as an object URL).  cb(ok).  A picture that didn't come (the service
     was busy with another, or there is none) isn't marked made, so it can be asked again. */
  function get(t, isAhead, cb) {
    var m = movie;
    if (!m || ready[t]) { if (cb) cb(!!ready[t]); return; }
    if (asking[t]) { asking[t].push(cb); return; }
    asking[t] = [cb];
    fetch(link(t, isAhead), { cache: 'force-cache' }).then(function (r) { return r.status === 200 ? r.blob() : null; }).then(function (b) {
      var w = asking[t] || []; delete asking[t];
      if (movie !== m) return;
      if (b && b.size > 200) {
        ready[t] = URL.createObjectURL(b); readyN++; made[t] = 1;
        // Kept for the movie: at most 200 (80 on a TV short of memory), the ones farthest from here go first.
        var cap = lean() ? 80 : 200;
        if (readyN > cap) { var v = video(), here = v ? v.currentTime : 0, far = Object.keys(ready).map(Number).sort(function (a, b2) { return Math.abs(b2 - here) - Math.abs(a - here); })[0]; if (far !== t) { URL.revokeObjectURL(ready[far]); delete ready[far]; readyN--; } }
      }
      w.forEach(function (f) { if (f) f(!!ready[t]); });
    }, function () { var w = asking[t] || []; delete asking[t]; w.forEach(function (f) { if (f) f(false); }); });
  }
  // The nearest picture this TV has to t, while t's own comes: better than an empty box.
  function nearest(t) {
    var best = -1, bd = Infinity;
    for (var k in ready) { var dd = Math.abs(+k - t); if (dd < bd) { bd = dd; best = +k; } }
    return best;
  }
  function paint(t, exact) {
    if (!img || ready[t] == null) return;
    if (img._t !== t) { img.src = ready[t]; img._t = t; }
    box.classList.add('has'); box.classList.toggle('wait', !exact);
  }
  // "Now": the picture where the seek stops, one fetch at a time; when it's in and the seek has moved on, the latest.
  function askNow() {
    if (nowBusy || !movie || wantT < 0) return;
    var b = wantT;
    if (ready[b]) return paint(b, true);
    nowBusy = true;
    get(b, false, function () {
      nowBusy = false;
      if (!movie) return;
      if (wantT === b) { if (ready[b]) paint(b, true); else box.classList.remove('wait'); }
      else if (wantT >= 0) { var n = nearest(wantT); if (n >= 0) paint(n, n === wantT); askNow(); }
    });
  }

  /* Pictures made ahead one at a time, where the next presses would land and spread over the movie: only while it
     plays with plenty buffered (20 s and more) or sits paused, never with Memory-safe on (Automatic), and not while
     seeking (that one's own pictures first). */
  var SPREAD = 48, tried = {};
  function fillSoon(ms) { clearTimeout(fill); fill = setTimeout(fillOne, ms); }
  function fillOne() {
    fill = null;
    if (!movie || !allowed()) return;
    var v = video(), d = v && v.duration;
    if (!d || !isFinite(d)) return fillSoon(5000);
    var buf = 0; try { for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1 && v.buffered.end(i) > v.currentTime) buf = v.buffered.end(i) - v.currentTime; } catch (e) {}
    /* From a few seconds after the start, not 20 s and plenty buffered as before: you seek back to where you left
       off right away, and every picture was still missing then.  Not while seeking (its own pictures first), and
       not while the movie is short of what it has buffered (8 s). */
    if (wantT >= 0 || nowBusy || (!v.paused && buf < 8)) return fillSoon(3000);
    /* A 4K movie, or one coming through the converter (Dolby Vision 7, TrueHD): pictures made ahead only while
       it is paused.  Each one decodes a 4K frame on the TV's processor, and making them while it played (Dune,
       halfway through) starved the playback until the picture froze and stuttered.  Paused by you, that is:
       the player pauses itself to refill, and pictures made then made the refill slower.  A seek still gets
       its own picture straight away. */
    var heavy = v.videoHeight > 1088 || (typeof Player !== 'undefined' && Player.converting);
    if (heavy && !(v.paused && typeof Player !== 'undefined' && Player.userPaused)) return fillSoon(5000);   // paused by you, not refilling
    /* The next spot not made yet: first the movie in eighths (a long jump, back to where you left off, lands near
       one at once), then where the next presses land from here (◀ ▶ and the 10-minute jumps), each chapter, and
       finer halves after that. */
    var spots = [], seen = {}, here = v.currentTime, skip = +Store.settings.skip || 30;
    for (var e8 = 1; e8 < 8; e8++) { var t8 = bucket(d * e8 / 8); if (!seen[t8]) { seen[t8] = 1; spots.push(t8); } }
    [1, 2, -1, 3, 4, -2].forEach(function (k) { var t = bucket(here + k * skip); if (t > 0 && t < d - 5 && !seen[t]) { seen[t] = 1; spots.push(t); } });
    [600, -600].forEach(function (k) { var t = bucket(here + k); if (t > 0 && t < d - 5 && !seen[t]) { seen[t] = 1; spots.push(t); } });
    (movie.chapters || []).forEach(function (c) { var t = picTime(c); if (!seen[t]) { seen[t] = 1; spots.push(t); } });   // each chapter's picture
    for (var s = 1; s < (lean() ? 24 : SPREAD); s <<= 1) for (var j = 1; j < 2 * s; j += 2) { var t = bucket(d * j / (2 * s)); if (!seen[t]) { seen[t] = 1; spots.push(t); } }
    var next = spots.filter(function (x) { return !ready[x] && !asking[x] && !tried[x]; })[0];
    if (next == null) return;
    var m = movie;
    get(next, true, function (got) { if (!got) tried[next] = 1; if (movie === m) fillSoon(lean() ? 2500 : 1200); });
  }

  /* Chapters with their pictures (Red > Chapters in the player, or CH+ CH− there): a strip of the movie's chapters,
     each with a picture of its first moments (when previews are on), its name and when it starts.  ◀ ▶ move along,
     OK jumps there, Back closes.  The picture is a little after the chapter's start (its very first frame is often
     black). */
  var sheet = null;
  function picTime(c) { return bucket(c.s + Math.min(20, Math.max(2, (c.e - c.s) * 0.1))); }
  function openChapters(onJump, onClose) {
    var c = movie && movie.chapters || []; if (c.length < 2) return false;
    var v = video(), now = v ? v.currentTime : 0, at = 0;
    c.forEach(function (x, i) { if (now >= x.s) at = i; });
    sheet = { at: at, onJump: onJump, onClose: onClose, el: tel('div', 'chapsheet') };
    sheet.el.appendChild(tel('div', 'chapsheet-title', 'Chapters'));
    sheet.track = tel('div', 'chapsheet-track'); sheet.el.appendChild(sheet.track);
    document.body.appendChild(sheet.el);
    drawChapters();
    return true;
  }
  function drawChapters() {
    if (!sheet) return;
    var c = movie && movie.chapters || [], from = Math.max(0, Math.min(sheet.at - 2, c.length - 5)), pics = allowed();
    sheet.track.innerHTML = '';
    for (var i = from; i < Math.min(c.length, from + 5); i++) (function (x, i) {
      var card = tel('div', 'chapcard' + (i === sheet.at ? ' sel' : '') + (pics ? '' : ' nopic'));
      if (pics) { var im = tel('img', 'chapcard-pic'); im.alt = ''; im.onload = function () { card.classList.add('has'); }; im.src = link(picTime(x), i !== sheet.at); card.appendChild(im); made[picTime(x)] = 1; }
      card.appendChild(tel('div', 'chapcard-name', chapterName(x, i)));
      card.appendChild(tel('div', 'chapcard-time', fmt(x.s)));
      card.onclick = function () { sheet.at = i; jumpChapter(); };
      sheet.track.appendChild(card);
    })(c[i], i);
  }
  function closeChapters() { if (!sheet) return; var s0 = sheet; sheet = null; s0.el.remove(); if (s0.onClose) s0.onClose(); }
  function jumpChapter() { if (!sheet) return; var c = movie.chapters[sheet.at], f = sheet.onJump; closeChapters(); if (c && f) f(c.s); }
  // The player's keys while the strip is open (views.js fullKeys).  True: used.
  function chapterKey(a) {
    if (!sheet) return false;
    var n = movie && movie.chapters ? movie.chapters.length : 0;
    if (a === 'left' && sheet.at > 0) { sheet.at--; drawChapters(); }
    else if (a === 'right' && sheet.at < n - 1) { sheet.at++; drawChapters(); }
    else if (a === 'ok') jumpChapter();
    else if (a === 'back' || a === 'red') closeChapters();
    return true;
  }
  // CH+ / CH−: the next or the previous chapter's start (back to this one's start if more than 5 s in).  -1: none.
  function chapterStep(dir, t) {
    var c = movie && movie.chapters || []; if (c.length < 2) return -1;
    if (dir > 0) { for (var i = 0; i < c.length; i++) if (c[i].s > t + 1) return c[i].s; return -1; }
    for (var j = c.length - 1; j >= 0; j--) if (c[j].s < t - 5) return c[j].s;
    return 0;
  }

  return { start: start, stop: stop, show: show, hide: hide, get available() { return ok; }, setting: setting, chapterAt: chapterAt, get chapters() { return movie ? movie.chapters : []; },
    openChapters: openChapters, chapterKey: chapterKey, chapterStep: chapterStep, get chaptersOpen() { return !!sheet; }, _source: source };
})();
