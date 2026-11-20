/* Multiview: two to four channels on screen at once (quick menu > Multiview, or hold OK > Watch in Multiview).
   webOS gives an app one video decoder, and a second <video> stops the first (multiview-research in the project
   notes).  So the channel you picked plays as video, with its sound, in its own box; the others are live pictures
   the network helper makes (service/multiview.js: ffmpeg on the TV, without their B-frames, as JPEGs an <img>
   shows one after the other).  OK on another box swaps: it becomes the video with sound, and the one before
   becomes pictures.  Each box uses a connection to the provider, so a login allowing one connection can't.

   Keys: arrows move between boxes, OK plays that box's sound (or picks a channel for an empty box), Red changes
   the box's channel, Yellow takes it out, Back (or Play on the box with sound) goes fullscreen on that channel. */
var Multiview = (function () {
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : s; };
  var open = false, boxes = [], sel = 0, main = -1, root = null, key = '', layout = 2, statT = 0;
  var GAP = 16, TOP = 60, HINTS = 56;

  function base() { return typeof Net !== 'undefined' && Net.port && Net.active ? 'http://127.0.0.1:' + Net.port : ''; }
  function can() { return !!base() && typeof Convert !== 'undefined'; }
  function stage() { return document.getElementById('stage'); }

  // Where each box goes: two side by side, three or four in a 2x2 grid (16:9 boxes, the screen's 1920x1080).
  function rects(n) {
    var W = 1920, H = 1080, out = [];
    if (n <= 2) {
      var w = (W - GAP * 3) / 2, h = Math.round(w * 9 / 16), y = Math.round((H - h) / 2);
      out.push([GAP, y, w, h], [GAP * 2 + w, y, w, h]);
    } else {
      var h2 = (H - TOP - HINTS - GAP * 2) / 2, w2 = Math.round(h2 * 16 / 9), x0 = Math.round((W - w2 * 2 - GAP) / 2);
      out.push([x0, TOP + GAP, w2, h2], [x0 + w2 + GAP, TOP + GAP, w2, h2], [x0, TOP + GAP * 2 + h2, w2, h2], [x0 + w2 + GAP, TOP + GAP * 2 + h2, w2, h2]);
    }
    return out.map(function (r) { return r.map(Math.round); });
  }

  function tileUrl(c, w) {
    var u = Source.streamUrl(c, 'ts');
    if (typeof Net !== 'undefined' && Net.unwrap) u = Net.unwrap(u);
    var ua = Store.plOf && Store.plOf(c) && Store.plOf(c).ua || '';
    /* Up to 25 pictures a second for one box beside the video, 15 for three.  Without B-frames either way: on a C2,
       every frame of a 1080p60 channel took more than a whole core (s=1), without them about half of one, for about
       20 pictures a second. */
    var one = boxes.filter(function (b) { return b.c; }).length <= 2;
    return base() + '/mv/' + key + '/tile.mjpg?id=' + encodeURIComponent(c.k).slice(0, 20) + '&w=' + w + '&f=' + (one ? '25' : '15') + '&u=' + encodeURIComponent(u) + (ua ? '&ua=' + encodeURIComponent(ua) : '');
  }

  function build() {
    if (root) root.remove();
    root = U.el('div', 'mv'); root.id = 'mv';
    var title = U.el('div', 'mv-title', T('Multiview'));
    root.appendChild(title);
    var rs = rects(layout);
    boxes.forEach(function (b, i) {
      var r = rs[i], el = U.el('div', 'mv-box');
      el.style.left = r[0] + 'px'; el.style.top = r[1] + 'px'; el.style.width = r[2] + 'px'; el.style.height = r[3] + 'px';
      b.el = el; b.r = r;
      var label = U.el('div', 'mv-label'); label.setAttribute('data-raw', ''); el.appendChild(label); b.label = label;
      root.appendChild(el);
    });
    var hints = U.el('div', 'mv-hints');
    [['', 'OK  sound from this box'], ['red', 'Change channel'], ['yellow', 'Take it out'], layout === 2 ? ['green', 'Four boxes'] : null, ['', 'Back  fullscreen']].forEach(function (h) {
      if (!h) return;
      var sp = U.el('span', h[0] ? 'mv-k ' + h[0] : 'mv-k', T(h[1])); hints.appendChild(sp);
    });
    root.appendChild(hints);
    document.body.appendChild(root);
    boxes.forEach(paint);
  }

  // A box: the video (main: the stage sits in it), pictures, or "Add a channel".
  function paint(b, i) {
    if (b.img && (i === main || !b.c)) { b.img.src = ''; b.img.remove(); b.img = null; }
    b.el.classList.toggle('main', i === main);
    b.el.classList.toggle('on', i === sel);
    b.el.classList.toggle('empty', !b.c);
    var tag = b.c && Library.versionTag ? Library.versionTag(b.c) : '';
    var name = b.c ? Library.name(b.c) + (tag ? '  ' + tag : '') : T('Add a channel');
    b.label.textContent = name;
    if (i === main) b.label.insertAdjacentHTML('afterbegin', '<svg class="mv-snd" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none"/></svg>');
    if (b.c && i !== main && !b.img) {
      var img = new Image(); img.className = 'mv-pic';
      img.onerror = function () { if (b.img === img) { b.el.classList.add('failed'); b.label.textContent = name + '   ' + T('no picture'); } };
      img.src = tileUrl(b.c, filled() <= 2 ? 640 : 480);
      b.el.insertBefore(img, b.label); b.img = img;
    }
  }

  function placeStage() {
    var s = stage(), b = boxes[main];
    if (!b) return;
    s.classList.remove('full', 'preview'); s.classList.add('mv');
    s.style.left = b.r[0] + 'px'; s.style.top = b.r[1] + 'px'; s.style.width = b.r[2] + 'px'; s.style.height = b.r[3] + 'px';
  }

  // The box with sound: its pictures stop first (a provider connection back), then its channel plays as video.
  function makeMain(i) {
    var b = boxes[i];
    if (!b || !b.c || i === main) return;
    var was = main;
    main = i;
    if (b.img) { b.img.src = ''; b.img.remove(); b.img = null; }
    placeStage();
    Views.startChannel(b.c, true);
    Log.info('multiview', 'Sound from ' + Library.name(b.c) + (was >= 0 && boxes[was] && boxes[was].c ? ', pictures for ' + Library.name(boxes[was].c) : ''));
    setTimeout(function () { boxes.forEach(paint); }, was >= 0 ? 400 : 0);   // the old one's pictures after the video let go of its connection
  }

  function pick(i) {
    UI.prompt(T('A channel for this box'), '', function (q) {
      var found = Library.findChannels(q, {});
      if (!found.length) { U.toast(T('No channel named like that')); return; }
      UI.menu(T('Pick a channel'), found.slice(0, 40).map(function (x) {
        return { label: I18n.raw(Library.name(x)), action: function () { setBox(i, x); } };
      }));
    }, T('Part of its name is enough'), false, T('Find'));
  }
  // Two boxes or more of pictures: the smooth one goes lighter (and back), so the TV keeps up.
  function filled() { return boxes.filter(function (b) { return b.c; }).length; }
  function regear(before) {
    if ((before <= 2) === (filled() <= 2)) return;
    boxes.forEach(function (b, i) { if (b.img && i !== main) { b.img.src = ''; b.img.remove(); b.img = null; } });
    boxes.forEach(paint);
  }
  function setBox(i, c) {
    var b = boxes[i], before = filled();
    if (b.img) { b.img.src = ''; b.img.remove(); b.img = null; }
    b.c = c; b.el.classList.remove('failed');
    if (i === main) { Views.startChannel(c, true); }
    paint(b, i);
    if (main < 0) makeMain(i);
    regear(before);
  }
  function remove(i) {
    var b = boxes[i], before = filled();
    if (!b.c) return;
    if (b.img) { b.img.src = ''; b.img.remove(); b.img = null; }
    b.c = null;
    if (i === main) {
      main = -1; Player.stop();
      var next = boxes.findIndex(function (x) { return x.c; });
      if (next >= 0) makeMain(next);
    }
    boxes.forEach(paint);
    regear(before);
  }

  function keys(a) {
    var n = boxes.length, cols = 2, r = Math.floor(sel / cols);
    if (a === 'left' || a === 'right') { var c2 = (sel % cols) + (a === 'right' ? 1 : -1); if (c2 >= 0 && c2 < cols && r * cols + c2 < n) sel = r * cols + c2; }
    else if (a === 'up' || a === 'down') { var s2 = sel + (a === 'down' ? cols : -cols); if (s2 >= 0 && s2 < n) sel = s2; }
    else if (a === 'ok') { if (!boxes[sel].c) pick(sel); else if (sel !== main) makeMain(sel); else return close(true); }
    else if (a === 'red') pick(sel);
    else if (a === 'yellow') remove(sel);
    else if (a === 'green' && n === 2) { layout = 4; boxes.push({ c: null }, { c: null }); build(); placeStage(); }
    else if (a === 'back' || a === 'playpause' || a === 'play') return close(true);
    else return true;
    boxes.forEach(paint);
    return true;
  }

  function start(first, others) {
    if (open) return;
    if (!can()) { U.toast(T('Multiview needs the network helper, which isn\'t running.  Restart TiviBro.'), 6000); return; }
    Convert.ensureKey().then(function (k) {
      key = k; open = true;
      var list = [first].concat((others || []).filter(function (c) { return c && c.k !== first.k; })).slice(0, 4);
      layout = list.length > 2 ? 4 : 2;
      boxes = []; for (var i = 0; i < layout; i++) boxes.push({ c: list[i] || null });
      sel = boxes.length > 1 && !boxes[1].c ? 1 : 0; main = -1;
      document.body.classList.add('mv-open');
      build();
      // The channel playing now stays the video with sound, in the first box (not tuned again).
      main = 0; placeStage();
      if (!Views.playing || Views.playing.k !== first.k) Views.startChannel(first, true);
      boxes.forEach(paint);
      UI.setHandler(keys);
      Log.info('multiview', 'Opened with ' + list.length + ' channel' + (list.length === 1 ? '' : 's'));
      clearInterval(statT);
      statT = setInterval(stats, 30000);
    }, function () { U.toast(T('Multiview needs the network helper, which isn\'t running.  Restart TiviBro.'), 6000); });
  }
  function stats() {
    if (!open) return;
    fetch(base() + '/mv/' + key + '/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      (j.tiles || []).forEach(function (t) { Log.info('multiview', 'Box ' + t.id + ': ' + t.fps + ' pictures a second, ' + t.kbps + ' kb/s, ' + t.dropped + ' dropped'); });
    }, function () {});
  }

  // Back: fullscreen on the box with sound (the others' pictures stop).
  function close(full) {
    if (!open) return true;
    open = false; clearInterval(statT);
    boxes.forEach(function (b) { if (b.img) { b.img.src = ''; b.img.remove(); b.img = null; } });
    if (root) { root.remove(); root = null; }
    document.body.classList.remove('mv-open');
    var s = stage(); s.classList.remove('mv');
    Log.info('multiview', 'Closed');
    if (full !== false && Views.playing) Views.goFull(); else Views.restoreKeys();
    return true;
  }

  // Another channel into the first empty box (two boxes full: four boxes).
  function add(c) {
    if (!open || !c) return false;
    if (boxes.some(function (b) { return b.c && b.c.k === c.k; })) return true;
    var i = boxes.findIndex(function (b) { return !b.c; });
    if (i < 0 && layout === 2) { layout = 4; boxes.push({ c: null }, { c: null }); build(); placeStage(); i = 2; }
    if (i < 0) { U.toast(T('Four boxes are full.  Yellow takes one out.')); return false; }
    setBox(i, c);
    return true;
  }

  return { start: start, close: close, add: add, get open() { return open; }, _rects: rects };
})();
