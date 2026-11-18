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
  var STEP = 10, W = 320;
  var key = '', ok = null, movie = null, box = null, img = null, label = null, shownT = -1, wantT = -1, t0 = 0, timer = null, fill = null, made = {};

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
    return url;
  }
  function video() { return document.getElementById('video'); }
  // Pictures for this movie?  The setting, the service, and (Automatic with Memory-safe on) no more than 1080p.
  function allowed() {
    if (!movie || !ok || setting() === 'off') return false;
    if (setting() === 'auto' && lean()) { var v = video(); if (v && v.videoHeight > 1088) return false; }
    return true;
  }
  function link(t, ahead) { return base() + '/preview/' + key + '/frame.jpg?u=' + encodeURIComponent(movie.u) + '&t=' + t + '&w=' + W + (movie.ua ? '&ua=' + encodeURIComponent(movie.ua) : '') + (ahead ? '&p=1' : ''); }
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
    }).then(function () { if (movie === m) fillSoon(20000); }, function () {});
  }
  function stop() { movie = null; made = {}; clearTimeout(fill); fill = null; hide(); marksFor = null; if (marksEl) marksEl.innerHTML = ''; if (typeof Skipper !== 'undefined') Skipper.chapters([]); }

  function build() {
    if (box) return box;
    var prog = document.querySelector('#osd .osd-prog'); if (!prog) return null;
    box = U.el('div', 'seekprev hidden'); img = U.el('img', 'seekprev-pic'); img.alt = ''; label = U.el('div', 'seekprev-time');
    img.onload = function () { box.classList.remove('wait'); box.classList.add('has'); };
    img.onerror = function () { box.classList.remove('wait'); };
    box.appendChild(img); box.appendChild(label); prog.appendChild(box);
    return box;
  }
  function hide() { if (box) { box.classList.add('hidden'); box.classList.remove('has', 'wait'); } shownT = -1; wantT = -1; clearTimeout(timer); }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  // The chapter a time is in (its title), or null.
  function chapterAt(t) { var c = movie && movie.chapters || []; for (var i = 0; i < c.length; i++) if (t >= c[i].s && t < c[i].e) return c[i]; return null; }
  function chapterName(c, i) { return c && (c.t && !/^chapter\s*\d+$/i.test(c.t) ? c.t : 'Chapter ' + (i + 1)); }
  // The chapters as small marks on the bar (each chapter's start), drawn again only when the movie or its length changes.
  var marksEl = null, marksFor = null;
  function marks(d) {
    var prog = document.querySelector('#osd .osd-prog'), bar = prog && prog.querySelector('.bar'); if (!bar) return;
    var c = movie && movie.chapters || [], k = movie ? movie.u + '|' + d + '|' + c.length + '|' + bar.offsetWidth : '';
    if (k === marksFor) return;
    marksFor = k;
    if (!marksEl) { marksEl = U.el('div', 'chapmarks'); prog.appendChild(marksEl); }
    marksEl.innerHTML = '';
    marksEl.style.left = bar.offsetLeft + 'px'; marksEl.style.width = bar.offsetWidth + 'px'; marksEl.style.top = bar.offsetTop + 'px';
    if (!d || c.length < 2) return;
    c.forEach(function (x) { if (x.s < 1 || x.s > d - 1) return; var e = U.el('i'); e.style.left = (100 * x.s / d) + '%'; marksEl.appendChild(e); });
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
    wantT = b; t0 = Date.now();
    if (made[b]) { img.src = link(b); shownT = b; return; }
    box.classList.add('wait');
    // A short wait: presses in a row ask only for where they stop (each asks for one, the service drops the rest).
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (wantT !== b || !movie) return;
      img.src = link(b); shownT = b; made[b] = 1;
      // The next two presses the way it's going, asked ahead (not on a TV short of memory).
      if (dir && !lean()) for (var i = 1; i <= 2; i++) ahead(b + dir * i * STEP * Math.max(1, Math.round(Math.abs((+Store.settings.skip || 10) / STEP))), d);
    }, made[b] ? 0 : 140);
  }
  function ahead(t, d) {
    if (t < 0 || t > d || made[t]) return;
    made[t] = 1;
    var i = new Image(); i.src = link(bucket(t), true);
  }

  /* Pictures made ahead one at a time, where the next presses would land and spread over the movie: only while it
     plays with plenty buffered (20 s and more) or sits paused, never with Memory-safe on (Automatic), and not while
     seeking (that one's own pictures first). */
  var SPREAD = 48;
  function fillSoon(ms) { clearTimeout(fill); fill = setTimeout(fillOne, ms); }
  function fillOne() {
    fill = null;
    if (!movie || !allowed() || (setting() === 'auto' && lean())) return;
    var v = video(), d = v && v.duration;
    if (!d || !isFinite(d)) return fillSoon(10000);
    var buf = 0; try { for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1 && v.buffered.end(i) > v.currentTime) buf = v.buffered.end(i) - v.currentTime; } catch (e) {}
    if (wantT >= 0 || (!v.paused && buf < 20)) return fillSoon(8000);
    // The next spot not made yet: first where the next presses land from here (◀ ▶ and the 10-minute jumps), then
    // halves (1/2, then 1/4 and 3/4, ...), so the movie is covered coarsely soon.
    var spots = [], seen = {}, here = v.currentTime, skip = +Store.settings.skip || 30;
    [1, 2, -1, 3, 4, -2].forEach(function (k) { var t = bucket(here + k * skip); if (t > 0 && t < d - 5 && !seen[t]) { seen[t] = 1; spots.push(t); } });
    [600, -600].forEach(function (k) { var t = bucket(here + k); if (t > 0 && t < d - 5 && !seen[t]) { seen[t] = 1; spots.push(t); } });
    for (var s = 1; s < SPREAD; s <<= 1) for (var j = 1; j < 2 * s; j += 2) { var t = bucket(d * j / (2 * s)); if (!seen[t]) { seen[t] = 1; spots.push(t); } }
    var next = spots.filter(function (x) { return !made[x]; })[0];
    if (next == null) return;
    made[next] = 1;
    var im = new Image(), m = movie;
    im.onload = im.onerror = function () { if (movie === m) fillSoon(1500); };
    im.src = link(next, true);
  }

  return { start: start, stop: stop, show: show, hide: hide, get available() { return ok; }, setting: setting, chapterAt: chapterAt, get chapters() { return movie ? movie.chapters : []; }, _source: source };
})();
