/* Multiview: 2 to 4 channels at once.
   Each tile has its own <video> and a lean player (small buffers, reconnect on error).
   Only the focused tile has sound.  The main player is stopped while this is open so
   the TV's decoders go to the tiles.  Many webOS TVs can decode only two streams at a
   time, so the default is 2 and the setting allows up to 4. */
var Multiview = (function () {
  'use strict';
  var $ = U.$, L = Library;
  var root = null, tiles = [], focus = 0, open = false;

  function lean(tile) {
    var v = tile.video, raw = Source.streamUrl(tile.ch, Store.settings.format), url = tile.native ? raw : Net.wrap(raw);
    if (/^https:/i.test(raw) || Net.ua) raw = Net.wrap(raw);      // TV player with HTTPS or a custom User-Agent: go through the helper
    teardown(tile);
    var retry = function () {
      if (!open || tile.dead) return;
      tile.fails = (tile.fails || 0) + 1;
      if (tile.fails > 6) { tile.msg.textContent = 'Stream stopped responding'; return; }
      tile.msg.textContent = 'Reconnecting';
      clearTimeout(tile.t); tile.t = setTimeout(function () { lean(tile); }, Math.min(8000, 500 * tile.fails));
    };
    try {
      if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()) {
        var h = new Hls({ xhrSetup: function (xhr, u) { xhr.open('GET', Net.wrap(u), true); }, enableWorker: true, maxBufferLength: 12, backBufferLength: 4, capLevelToPlayerSize: true, liveSyncDurationCount: 3 });
        h.on(Hls.Events.ERROR, function (e, d) { if (d.fatal) retry(); });
        h.loadSource(url); h.attachMedia(v);
        tile.kill = function () { try { h.destroy(); } catch (e) {} };
      } else if (window.mpegts && mpegts.getFeatureList().mseLivePlayback && !tile.native) {
        var m = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url }, {
          enableWorker: true, enableStashBuffer: true, stashInitialSize: 256 * 1024, autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 4, autoCleanupMinBackwardDuration: 2, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 6 });
        var got = false;
        m.on(mpegts.Events.MEDIA_INFO, function () { got = true; });
        m.on(mpegts.Events.ERROR, function () { if (!got) tile.native = true; retry(); });
        m.on(mpegts.Events.LOADING_COMPLETE, retry);
        m.attachMediaElement(v); m.load();
        tile.kill = function () { try { m.unload(); m.detachMediaElement(); m.destroy(); } catch (e) {} };
      } else {
        v.src = raw; v.load();
        v.onerror = retry;
        tile.kill = function () { v.onerror = null; };
      }
    } catch (e) { tile.native = true; retry(); return; }
    v.muted = tiles.indexOf(tile) !== focus;
    var p = v.play(); if (p && p.catch) p.catch(function () {});
    v.onplaying = function () { tile.fails = 0; tile.msg.textContent = ''; };
  }
  function teardown(tile) {
    clearTimeout(tile.t);
    if (tile.kill) { tile.kill(); tile.kill = null; }
    tile.video.pause(); tile.video.removeAttribute('src');
    try { tile.video.load(); } catch (e) {}
  }

  function layout() {
    root.className = 'multi n' + tiles.length;
    tiles.forEach(function (t, i) {
      t.el.classList.toggle('focus', i === focus);
      t.video.muted = i !== focus;
      t.label.textContent = t.ch ? L.name(t.ch) : 'Press OK to pick a channel';
    });
  }

  function addTile(ch) {
    var el = U.el('div', 'mtile'), v = U.el('video'), label = U.el('div', 'mlabel'), msg = U.el('div', 'mmsg');
    v.setAttribute('playsinline', '');
    el.appendChild(v); el.appendChild(label); el.appendChild(msg);
    root.appendChild(el);
    var t = { el: el, video: v, label: label, msg: msg, ch: ch || null };
    tiles.push(t);
    if (ch) lean(t);
    return t;
  }

  function pickFor(tile) {
    var list = L.channels(Views.group).filter(function (c) { return Parental.blockedOk(c); });
    UI.menu('Channel for this screen', list.slice(0, 300).map(function (c) {
      return { label: L.name(c), sub: String(c.num), action: function () { tile.ch = c; tile.fails = 0; tile.native = false; lean(tile); layout(); } };
    }));
  }

  function keys(a) {
    if (!open || !tiles.length) { Views.restoreKeys(); return true; }
    var n = tiles.length, cols = n > 1 ? 2 : 1;
    if (a === 'left') focus = Math.max(0, focus - 1);
    else if (a === 'right') focus = Math.min(n - 1, focus + 1);
    else if (a === 'up') focus = Math.max(0, focus - cols);
    else if (a === 'down') focus = Math.min(n - 1, focus + cols);
    else if (a === 'ok') { if (!tiles[focus].ch) pickFor(tiles[focus]); else return toMain(), true; }
    else if (a === 'red' || a === 'hold') {
      var t = tiles[focus];
      UI.menu('Screen ' + (focus + 1), [
        { label: 'Change channel…', action: function () { pickFor(t); } },
        t.ch && { label: 'Watch fullscreen', action: toMain },
        tiles.length < (+Store.settings.multiMax || 2) && { label: 'Add a screen', action: function () { addTile(null); focus = tiles.length - 1; layout(); pickFor(tiles[focus]); } },
        tiles.length > 1 && { label: 'Remove this screen', action: function () { teardown(t); t.el.remove(); tiles.splice(focus, 1); focus = Math.min(focus, tiles.length - 1); layout(); } }
      ]);
    }
    else if (a === 'back') return toMain(), true;
    layout();
    return true;
  }

  // Leave multiview with the focused tile's channel playing in the normal player.
  function toMain() {
    var ch = tiles[focus] && tiles[focus].ch;
    close(true);
    if (ch) Views.startChannel(ch, false, function () { Views.goFull(); });
    else Views.restoreKeys();
  }

  function openMv(seed) {
    if (open) return;
    var max = +Store.settings.multiMax || 2;
    root = $('multi');
    root.innerHTML = '';
    tiles = []; focus = 0; open = true;
    Player.stop();
    root.classList.remove('hidden');
    document.body.classList.add('mv');
    addTile(seed);
    addTile(null);
    if (max >= 4) { addTile(null); addTile(null); }
    layout();
    UI.setHandler(keys);
    UI.hints([['', 'OK  pick or watch fullscreen'], ['red', 'Screen options'], ['', 'Back  leave multiview']]);
    U.toast('Multiview: the focused screen has sound');
  }

  function close(silent) {
    if (!open) return;
    open = false;
    tiles.forEach(teardown);
    tiles = [];
    root.innerHTML = '';
    root.classList.add('hidden');
    document.body.classList.remove('mv');
    if (!silent) Views.restoreKeys();
  }

  return { open: openMv, close: close, get isOpen() { return open; } };
})();
