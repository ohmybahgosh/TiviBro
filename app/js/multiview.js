/* Multiview: two channels side by side (quick menu > Multiview, or hold OK > Watch in Multiview), for two games at
   once.  webOS gives an app one video decoder, and a second <video> stops the first (multiview-research in the
   project notes).  So the channel with sound plays as video in its box, and the other one is live video without
   sound that the network helper makes (service/multiview.js: ffmpeg on the TV, every frame, up to 30 a second, as
   JPEGs, sent at an even pace).  OK on the other box swaps them.  Each box uses a connection to the
   provider, so a login allowing one connection can't.  Two boxes only (a solid two rather than a choppy four;
   the helper and the layout could do four).

   Keys: ◀ ▶ move between boxes, OK gives that box the sound (or picks a channel for an empty box: your groups,
   then their channels, as in the guide), Red changes the box's channel, Yellow takes it out, and Blue, Play, Back
   or OK on the box with sound go fullscreen on that channel.  Multiview in the quick menu comes back to the same
   two channels. */
var Multiview = (function () {
  var T = function (s, v) { return typeof I18n !== 'undefined' ? I18n.t(s, v) : s; };
  var last = [], open = false, boxes = [], sel = 0, main = -1, root = null, key = '', layout = 2, statT = 0;
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
    /* Two boxes (one of pictures beside the video): every frame, up to 30 a second, as smooth as the channel allows
       for a game beside a game.  Four: lighter, without the frames nothing needs, up to 20 a second each.
       On a C2 with the 64-bit ffmpeg: a 1080p channel's every frame takes about 0.8 of a core. */
    var one = boxes.filter(function (b) { return b.c; }).length <= 2;
    return base() + '/mv/' + key + '/tile.mjpg?id=' + encodeURIComponent(c.k).slice(0, 20) + '&w=' + w + '&f=' + (one ? '30&s=1' : '20') + '&u=' + encodeURIComponent(u) + (ua ? '&ua=' + encodeURIComponent(ua) : '');
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
    [['', 'OK  sound from this box'], ['red', 'Change channel'], ['yellow', 'Take it out'], ['blue', 'Fullscreen']].forEach(function (h) {
      if (!h) return;
      var sp = U.el('span', h[0] ? 'mv-k ' + h[0] : 'mv-k', T(h[1])); hints.appendChild(sp);
    });
    root.appendChild(hints);
    document.body.appendChild(root);
    boxes.forEach(paint);
  }

  // A box: the video (main: the stage sits in it), pictures, or "Add a channel".
  function paint(b, i) {
    if (b.img && (i === main || !b.c)) { stopPic(b); }
    b.el.classList.toggle('main', i === main);
    b.el.classList.toggle('on', i === sel);
    b.el.classList.toggle('empty', !b.c);
    var tag = b.c && Library.versionTag ? Library.versionTag(b.c) : '';
    var name = b.c ? Library.name(b.c) + (tag ? '  ' + tag : '') : T('Add a channel');
    b.label.textContent = name;
    if (i === main) b.label.insertAdjacentHTML('afterbegin', '<svg class="mv-snd" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none"/></svg>');
    if (b.c && i !== main && !b.img) {
      var pic = Pic(tileUrl(b.c, 640), function () {
        if (b.img !== pic) return;
        // Once: the helper may have started again since (a new key), or the channel stopped for a moment.
        if (!b.retried) {
          b.retried = true;
          Convert.ensureKey(true).then(function (k) { key = k; if (b.img === pic && open) { stopPic(b); paint(b, boxes.indexOf(b)); } });
          return;
        }
        b.el.classList.add('failed'); b.label.textContent = name + '   ' + T('no picture');
      });
      b.el.insertBefore(pic.el, b.label); b.img = pic;
    }
  }

  function stopPic(b) { if (b.img) { b.img.stop(); b.img = null; } }
  // A still of a box's pictures, shown where the video goes until the video plays.
  function hold(b) {
    var img = b.img && b.img.el;
    if (!img || !img.naturalWidth) return;
    var cv = document.createElement('canvas'); cv.className = 'mv-pic mv-still';
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    try { cv.getContext('2d').drawImage(img, 0, 0); } catch (e) { return; }
    // In the video's own box (the stage, over the boxes), under its spinner.
    var st = stage(), v = document.getElementById('video'), done = false;
    st.insertBefore(cv, document.getElementById('spinner'));
    function gone() { if (done) return; done = true; cv.remove(); if (v) v.removeEventListener('playing', gone); }
    if (v) v.addEventListener('playing', gone);
    setTimeout(gone, 8000);
  }

  /* A box's moving pictures: an <img> showing the helper's JPEGs one after another.  The helper sends them at an
     even pace (service/multiview.js), since an <img> shows each one the moment it comes.  A worker decoding them
     onto a canvas, paced here instead, took more than a core more on a C2 than the <img> (the TV's own JPEG
     decoding is far cheaper), and left the pictures less even, not more. */
  function Pic(url, onFail) {
    var img = new Image(); img.className = 'mv-pic'; img.onerror = onFail; img.src = url;
    return { el: img, stop: function () { img.onerror = null; img.src = ''; img.remove(); } };
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
    /* Its last picture stays in the box, still, until the video has its first frame (or 8 seconds), so the box
       doesn't go black while the channel connects; the other box's pictures follow as soon as the video let go. */
    if (b.img) { hold(b); stopPic(b); }
    placeStage();
    Views.startChannel(b.c, true);
    Log.info('multiview', 'Sound from ' + Library.name(b.c) + (was >= 0 && boxes[was] && boxes[was].c ? ', pictures for ' + Library.name(boxes[was].c) : ''));
    setTimeout(function () { boxes.forEach(paint); }, was >= 0 ? 400 : 0);   // the old one's pictures after the video let go of its connection
  }

  /* A channel for a box: a small guide over the boxes, both still playing behind it.  Your groups on the left (as
     the guide has them: Favorites, Recent and your groups first, Search by name at the top), the group's channels
     on the right with their logo, what's on now with how far in it is, and what's next.  It opens on the group of
     the box's channel (or the one with sound), on that channel.  ▲ ▼ move, ◀ ▶ between the two lists, OK picks,
     Back closes. */
  var pk = null, ROWS = 8;
  function pick(i) {
    var gs = Library.groups().filter(function (g) { return !g.head && !g.hidden && !g.blocked; });
    var at = (boxes[i] && boxes[i].c) || (boxes[main] && boxes[main].c) || null, gi = 0, ci = 0;
    if (at) { var k = gs.findIndex(function (g) { return g.id === at.g; }); if (k >= 0) gi = k; }
    pk = { i: i, gs: gs, gi: gi + 1, ci: 0, col: 'ch', el: U.el('div', 'mv-guide') };
    var chs = list();
    if (at) { ci = chs.findIndex(function (c) { return c.k === at.k; }); pk.ci = Math.max(0, ci); }
    if (!chs.length) pk.col = 'gr';
    root.appendChild(pk.el);
    UI.setHandler(pickKeys);
    drawPick();
  }
  // The groups column: Search first, then the groups.
  function list() { var g = pk.gi > 0 ? pk.gs[pk.gi - 1] : null; return g ? Library.channels(g.id).slice(0, 2000) : []; }
  function drawPick() {
    var el = pk.el, chs = list(), shown = {}, now = Date.now();
    boxes.forEach(function (b) { if (b.c) shown[b.c.k] = 1; });
    el.innerHTML = '';
    el.appendChild(U.el('div', 'mv-g-title', T('A channel for this box')));
    var gcol = U.el('div', 'mv-g-groups' + (pk.col === 'gr' ? ' on' : '')), names = [T('Search by name…')].concat(pk.gs.map(function (g) { return I18n.raw(g.name); }));
    var g0 = Math.max(0, Math.min(pk.gi - 4, names.length - 11));
    names.slice(g0, g0 + 11).forEach(function (n, j) { var r = U.el('div', 'mv-g-group' + (g0 + j === pk.gi ? ' sel' : ''), n); r.setAttribute('data-raw', ''); gcol.appendChild(r); });
    el.appendChild(gcol);
    var ccol = U.el('div', 'mv-g-chans' + (pk.col === 'ch' ? ' on' : ''));
    if (!chs.length) ccol.appendChild(U.el('div', 'mv-g-empty', pk.gi ? T('No channels in this group') : T('OK to type a name')));
    var c0 = Math.max(0, Math.min(pk.ci - 3, chs.length - ROWS));
    chs.slice(c0, c0 + ROWS).forEach(function (c, j) {
      var row = U.el('div', 'mv-g-row' + (c0 + j === pk.ci ? ' sel' : '') + (shown[c.k] ? ' shown' : ''));
      var lg = U.el('div', 'mv-g-logo'), src = Views.logoOf ? Views.logoOf(c) : '';
      if (src) { var im = new Image(); im.decoding = 'async'; im.onerror = function () { this.remove(); }; im.src = src; lg.appendChild(im); }
      row.appendChild(lg);
      var tx = U.el('div', 'mv-g-text');
      var nm = U.el('div', 'mv-g-name', (c.num ? c.num + '   ' : '') + Library.name(c) + (shown[c.k] ? '   ·   ' + T('on screen') : '')); nm.setAttribute('data-raw', ''); tx.appendChild(nm);
      var nn = Epg.nowNext ? Epg.nowNext(c) : null, p = nn && nn.now, nx = nn && nn.next;
      var pr = U.el('div', 'mv-g-now', p ? U.hhmm(p.s) + ' – ' + U.hhmm(p.e) + '   ' + p.t : T('No guide information')); pr.setAttribute('data-raw', ''); tx.appendChild(pr);
      if (p) { var bar = U.el('div', 'mv-g-bar'), fill = U.el('i'); fill.style.width = Math.max(0, Math.min(100, (now - p.s) / (p.e - p.s) * 100)) + '%'; bar.appendChild(fill); tx.appendChild(bar); }
      if (nx) { var nt = U.el('div', 'mv-g-next', T('Next') + ':  ' + U.hhmm(nx.s) + '   ' + nx.t); nt.setAttribute('data-raw', ''); tx.appendChild(nt); }
      row.appendChild(tx);
      row.onclick = function () { pk.ci = c0 + j; choose(); };
      ccol.appendChild(row);
    });
    if (chs.length > ROWS) ccol.appendChild(U.el('div', 'mv-g-pos', (pk.ci + 1) + ' / ' + chs.length));
    el.appendChild(ccol);
    var h = U.el('div', 'mv-g-hints', T('OK  pick') + '        ' + T('◀ ▶  groups and channels') + '        ' + T('Back  close'));
    el.appendChild(h);
  }
  function choose() {
    var c = list()[pk.ci], i = pk.i;
    if (!c) return;
    closePick();
    setBox(i, c);
  }
  function closePick() { if (pk && pk.el) pk.el.remove(); pk = null; UI.setHandler(keys); boxes.forEach(paint); }
  function pickKeys(a) {
    if (!pk) return keys(a);
    var n = list().length;
    if (a === 'back') { closePick(); return true; }
    if (pk.col === 'gr') {
      if (a === 'up' && pk.gi > 0) { pk.gi--; pk.ci = 0; }
      else if (a === 'down' && pk.gi < pk.gs.length) { pk.gi++; pk.ci = 0; }
      else if (a === 'chup' || a === 'chdown') { pk.gi = Math.max(0, Math.min(pk.gs.length, pk.gi + (a === 'chup' ? -8 : 8))); pk.ci = 0; }
      else if (a === 'ok' && pk.gi === 0) { var i = pk.i; closePick(); search(i); return true; }
      else if ((a === 'right' || a === 'ok') && n) pk.col = 'ch';
      else return true;
    } else {
      if (a === 'up' && pk.ci > 0) pk.ci--;
      else if (a === 'down' && pk.ci < n - 1) pk.ci++;
      else if (a === 'chup' || a === 'chdown') pk.ci = Math.max(0, Math.min(n - 1, pk.ci + (a === 'chup' ? -ROWS : ROWS)));
      else if (a === 'left') pk.col = 'gr';
      else if (a === 'ok') { choose(); return true; }
      else return true;
    }
    drawPick();
    return true;
  }
  function search(i) {
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
    boxes.forEach(function (b, i) { if (b.img && i !== main) stopPic(b); });
    boxes.forEach(paint);
  }
  function setBox(i, c) {
    var b = boxes[i], before = filled();
    /* Two channels of a playlist whose login allows one connection: the provider refuses the second (or drops the
       first).  Said at once, instead of a box that never starts.  A channel of another playlist is fine. */
    var pl = function (x) { var p = Store.plOf ? Store.plOf(x) : null; return p && p.id || ''; };
    if (c && Library.maxConn && Library.maxConn(pl(c)) === 1 && boxes.some(function (o, k) { return k !== i && o.c && pl(o.c) === pl(c); })) {
      U.toast(T('This login allows one connection, so a second channel from it can\'t play at the same time.  A channel from another playlist can.'), 7000);
      return;
    }
    if (b.img) { stopPic(b); }
    b.c = c; b.retried = false; b.el.classList.remove('failed');
    if (i === main) { Views.startChannel(c, true); }
    paint(b, i);
    if (main < 0) makeMain(i);
    regear(before);
  }
  function remove(i) {
    var b = boxes[i], before = filled();
    if (!b.c) return;
    if (b.img) { stopPic(b); }
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
    else if (a === 'blue' || a === 'play' || a === 'playpause') return close(true);
    else if (a === 'back') return close(true);
    else return true;
    boxes.forEach(paint);
    return true;
  }

  function start(first, others) {
    if (open) return;
    if (!can()) { U.toast(T('Multiview needs the network helper, which isn\'t running.  Restart TiviBro.'), 6000); return; }
    Convert.ensureKey().then(function (k) {
      key = k; open = true;
      var list = [first].concat((others || []).filter(function (c) { return c && c.k !== first.k; })).slice(0, 2);
      layout = 2;
      boxes = []; for (var i = 0; i < layout; i++) boxes.push({ c: list[i] || null });
      sel = boxes.length > 1 && !boxes[1].c ? 1 : 0; main = -1;
      document.body.classList.add('mv-open');
      // The channel playing now stays the video with sound, in the first box (not tuned again).
      main = 0;
      build();
      placeStage();
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
      // behind: dropped because the app hadn't taken the last pictures yet; the rest came from ffmpeg too fast to keep.
      (j.tiles || []).forEach(function (t) { Log.info('multiview', 'Box ' + t.id + ': ' + t.fps + ' pictures a second, ' + t.kbps + ' kb/s, ' + t.dropped + ' dropped (' + (t.behind || 0) + ' with the app behind), ' + (t.queued || 0) + ' waiting, every ' + (t.gapMs || '?') + ' ms give or take ' + (t.jitterMs || '?')); });
    }, function () {});
  }

  // Back: fullscreen on the box with sound (the others' pictures stop).
  function close(full) {
    if (!open) return true;
    if (pk) { pk.el.remove(); pk = null; }
    open = false; clearInterval(statT);
    // Kept for the quick menu's Multiview: back to these boxes, with the channel playing now in the sound box.
    last = boxes.map(function (b, i) { return i === main ? null : b.c; }).filter(Boolean);
    if (main >= 0 && boxes[main] && boxes[main].c) last.unshift(boxes[main].c);
    boxes.forEach(function (b) { if (b.img) { stopPic(b); } });
    if (root) { root.remove(); root = null; }
    document.body.classList.remove('mv-open');
    var s = stage(); s.classList.remove('mv');
    Log.info('multiview', 'Closed');
    if (full !== false && Views.playing) Views.goFull(); else Views.restoreKeys();
    return true;
  }

  // Another channel into the empty box, or in place of the one without sound.
  function add(c) {
    if (!open || !c) return false;
    if (boxes.some(function (b) { return b.c && b.c.k === c.k; })) return true;
    var i = boxes.findIndex(function (b) { return !b.c; });
    if (i < 0) i = main === 0 ? 1 : 0;
    setBox(i, c);
    return true;
  }

  /* The quick menu's Multiview: the boxes you had (the channel playing now takes the sound box), or this channel
     and the one before. */
  function again(c, before) {
    var others = last.filter(function (x) { return x && c && x.k !== c.k; });
    if (!others.length && before) others = [before];
    start(c, others.slice(0, 1));
  }

  return { start: start, again: again, close: close, add: add, get open() { return open; }, _rects: rects };
})();
