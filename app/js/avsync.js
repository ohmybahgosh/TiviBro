/* Audio sync (discussion #60): sound that runs ahead of the picture or behind it, moved by hand, remembered per
   channel (and per movie or episode).

   How the sound is moved: the built-in players (mpegts.js for MPEG-TS, hls.js, dash.js) feed the picture and the
   sound into the video through two SourceBuffers.  Every SourceBuffer made here is wrapped (install): its
   timestampOffset, as the player reads and sets it, stays the player's own, and the real one underneath is that plus
   the delay (on the sound's buffer for later, the picture's for earlier).  So the sound lands that many milliseconds
   later (or earlier) against the picture, frame-exact, with nothing decoded and no extra work.  The TV's own player (native) has no such hook, so a channel with a delay plays
   on the built-in one (Player pickEngine), and a movie file plays through the converter as MPEG-TS (convert.js plan,
   sync), which copies its sound when the TV takes it.

   The panel (open): a bar along the bottom over the picture, so the lips stay in sight.  ◀ ▶ move the sound 20 ms
   earlier or later, ▲ ▼ 100 ms, Yellow back to 0, OK or Back closes.  Each change is heard about a second after
   the last press: the stream starts again with it (Player.resync), the same way for live TV and movies.
   Kept in Store.settings.avSync { key: ms }: 'c:<channel key>', 'v:<movie or episode id>'.
   Plain ES5 for the old Chromium on webOS. */
var AvSync = (function () {
  'use strict';
  var STEP = 20, BIG = 100, MAX = 2000, KEEP = 300;
  var key = '', label = '', ms = 0, pairs = [], el = null, timer = null, prevKeys = null;
  var desc = typeof SourceBuffer !== 'undefined' && Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'timestampOffset');

  function S() { return (typeof Store !== 'undefined' && Store.settings) || {}; }
  function T(s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : String(s).replace(/\{(\w)\}/g, function (a, k) { return v && v[k] != null ? v[k] : a; }); }
  function map() { var m = S().avSync; return m && typeof m === 'object' ? m : {}; }

  /* ---------- the SourceBuffers ---------- */
  /* Once, before any player makes a MediaSource: every SourceBuffer from now on is wrapped.  Sound later moves the
     audio buffer's timestamps on; sound earlier moves the video's on instead, so no timestamp is ever pushed below
     zero (the browser refuses those).  A buffer carrying both (one muxed stream) can't be split, and is left. */
  function install() {
    if (typeof MediaSource === 'undefined' || !desc || !desc.set || MediaSource.prototype._tbSync) return false;
    var add = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype._tbSync = true;
    MediaSource.prototype.addSourceBuffer = function (mime) {
      var sb = add.apply(this, arguments), kind = kindOf(mime);
      if (kind) wrap(this, sb, kind);
      return sb;
    };
    return true;
  }
  // 'a' for sound alone, 'v' for picture alone, '' for both in one buffer.
  function kindOf(mime) {
    var m = String(mime || '').toLowerCase();
    if (/^audio\//.test(m)) return 'a';
    if (!/^video\//.test(m)) return '';
    return /mp4a|ac-3|ec-3|opus|mp3|flac|vorbis/.test(m) ? '' : 'v';
  }
  // How far this kind of buffer moves (seconds): audio for a positive delay, video for a negative one.
  function shift(kind) { return kind === 'a' ? Math.max(0, ms) / 1000 : Math.max(0, -ms) / 1000; }
  // The player's own offset kept apart from the real one, which carries the shift too.
  function wrap(src, sb, kind) {
    var own = 0;
    try { own = desc.get.call(sb) || 0; } catch (e) {}
    try {
      Object.defineProperty(sb, 'timestampOffset', { configurable: true, get: function () { return own; }, set: function (v) { own = +v || 0; put(sb); } });
    } catch (e) { return; }
    sb._tbOwn = function () { return own; };
    sb._tbKind = kind;
    pairs = pairs.filter(function (p) { return p.src.readyState !== 'closed'; }).concat([{ src: src, sb: sb, kind: kind }]);
    put(sb);
  }
  // The real offset: the player's plus the shift, now or as soon as the buffer is free to take it.
  function put(sb) {
    try {
      if (sb.updating) { sb.addEventListener('updateend', function again() { sb.removeEventListener('updateend', again); put(sb); }); return; }
      var v = sb._tbOwn() + shift(sb._tbKind);
      if (Math.abs(desc.get.call(sb) - v) > 0.0005) desc.set.call(sb, v);
    } catch (e) {}
  }
  // Is what plays now on a player whose sound and picture are in buffers of their own (so the sound can move)?
  function movable() { return pairs.some(function (p) { return p.kind === 'a' && p.src.readyState !== 'closed'; }); }

  /* ---------- what plays, and its delay ---------- */
  // Player.play: the channel or the movie that starts now, and its kept delay.
  function use(k, name) { key = k || ''; label = name || ''; ms = key ? +map()[key] || 0 : 0; }
  // The delay of what plays now (0: as it comes).  The players ask it before choosing how to play.
  function wanted() { return ms; }
  function keyFor(ch, opts) {
    var m = opts && opts.meta;
    if (m && m.id != null && opts.live === false) return 'v:' + m.id;
    return ch && ch.k ? 'c:' + ch.k : '';
  }
  /* The delay for what plays now, kept for it (0 forgets it).  It applies to buffers made from now on: the stream
     starts again with it (change), since moving buffers mid-stream leaves a gap or an overlap. */
  function set(v) {
    ms = Math.max(-MAX, Math.min(MAX, Math.round(v / 10) * 10));
    var m = map();
    if (key) {
      if (ms) m[key] = ms; else delete m[key];
      var ks = Object.keys(m);
      if (ks.length > KEEP) ks.slice(0, ks.length - KEEP).forEach(function (x) { delete m[x]; });
      S().avSync = m;
      if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings();
    }
  }
  function count() { return Object.keys(map()).length; }
  function forgetAll() { S().avSync = {}; if (typeof Store !== 'undefined' && Store.saveSettings) Store.saveSettings(); ms = 0; }

  /* ---------- the panel ---------- */
  // "Sound 120 ms later", in words anyone can follow, and which way it was moved.
  function says(v) {
    if (!v) return T('Sound and picture as they come');
    return T(v > 0 ? 'Sound {n} ms later' : 'Sound {n} ms earlier', { n: Math.abs(v) });
  }
  function draw(note) {
    if (!el) return;
    var pos = Math.max(-500, Math.min(500, ms)), pct = 50 + pos / 10;
    el.querySelector('.avs-val').textContent = says(ms);
    el.querySelector('.avs-dot').style.left = pct + '%';
    var block = ms && typeof Player !== 'undefined' ? Player.syncBlock : '';
    if (!note && block) note = T('The sound can\'t be moved here: {x}.', { x: T(block) });
    else if (!note && ms && !movable()) note = T('This one plays on the TV\'s own player, which can\'t move the sound.  For a movie, the converter (Settings > Audio and subtitles) lets it.');
    el.querySelector('.avs-note').textContent = note || (ms ? T('Kept for {x}', { x: label || T('this channel') }) : '');
  }
  var hooked = false;
  /* The bar, over the picture; it takes the remote until closed.  It says what happened once the stream has started
     again with a new delay (moved, or why it couldn't be): hooked on first use, as player.js loads after this file. */
  function open() {
    if (el) return;
    if (!hooked && typeof Player !== 'undefined' && Player.on) { hooked = true; Player.on('state', function (st) { if (el && (st === 'playing' || st === 'error')) draw(); }); }
    var stage = document.body;
    el = U.el('div', 'avsync');
    el.appendChild(U.el('div', 'avs-title', T('Audio sync') + (label ? '  ·  ' + label : '')));
    el.appendChild(U.el('div', 'avs-val', ''));
    var bar = U.el('div', 'avs-bar');
    bar.appendChild(U.el('span', 'avs-l', T('earlier')));
    var track = U.el('div', 'avs-track'); track.appendChild(U.el('i', 'avs-zero')); track.appendChild(U.el('b', 'avs-dot'));
    bar.appendChild(track);
    bar.appendChild(U.el('span', 'avs-r', T('later')));
    el.appendChild(bar);
    el.appendChild(U.el('div', 'avs-how', T('Watch someone talking.  Hear the words before the lips move?  ▶ makes the sound later.  Lips move before you hear them?  ◀ makes it earlier.')));
    el.appendChild(U.el('div', 'avs-keys', T('◀ ▶  20 ms      ▲ ▼  100 ms      Yellow  back to 0      OK  done')));
    el.appendChild(U.el('div', 'avs-note', ''));
    stage.appendChild(el);
    draw();
    prevKeys = UI.handler || null;
    UI.setHandler(keys);
  }
  function close() {
    if (!el) return;
    el.remove(); el = null;
    if (prevKeys) UI.setHandler(prevKeys); else if (typeof Views !== 'undefined' && Views.restoreKeys) Views.restoreKeys();
    prevKeys = null;
  }
  // A change: heard once the presses stop (the stream starts again with it, a second or two).
  function change(v) {
    set(v);
    draw(T('Moving the sound…'));
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (typeof Player !== 'undefined' && Player.resync) Player.resync();
      setTimeout(function () { draw(); }, 1500);
    }, 900);
  }
  function keys(a) {
    if (a === 'right') change(ms + STEP);
    else if (a === 'left') change(ms - STEP);
    else if (a === 'up') change(ms + BIG);
    else if (a === 'down') change(ms - BIG);
    else if (a === 'yellow') change(0);
    else if (a === 'ok' || a === 'back' || a === 'exit') close();
    return true;
  }

  install();
  return { install: install, use: use, wanted: wanted, keyFor: keyFor, set: set, count: count, forgetAll: forgetAll, open: open, close: close, says: says,
    get movable() { return movable(); }, get isOpen() { return !!el; }, _test: { kindOf: kindOf, keys: keys, pairs: function () { return pairs; } } };
})();
