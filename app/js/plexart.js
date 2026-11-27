/* The backdrop behind the Plex tab and a title's page: the picture blurred across the whole screen and the sharp
   one top right, fading into it.  Two of them stacked: the next title's is drawn under the one showing and they
   cross-fade once its picture is in, so moving along a row never shows an empty screen in between.

   Kept light for the TV: the sharp picture is read at 1000x563 and scaled up by the graphics chip (the TV spent
   most of a key press decoding the full-size one), and each layer only fades (opacity), which costs no redraw.
   Chromium 53-compatible. */
var PlexArt = (function () {
  'use strict';
  var W = 1000, H = 563, BLUR_W = 480, BLUR_H = 270;

  /* Two layers in el (before the words).  Returns show(server, path) and clear(). */
  function make(el) {
    var sets = [0, 1].map(function () {
      var d = document.createElement('div');
      d.className = 'plex-art';
      d.innerHTML = '<div class="plex-bg"></div><div class="media-bd"><img class="media-hero-art" alt=""></div>';
      el.insertBefore(d, el.firstChild);
      return { el: d, bg: d.firstChild, img: d.lastChild.firstChild };
    });
    var on = 0, seq = 0, shown = '';

    // The picture for path, on the layer not showing; it fades in over the other once the sharp one is loaded.
    function show(server, path) {
      var key = server + '|' + path;
      if (key === shown) { sets[on].el.classList.remove('stale'); return; }
      shown = key;
      var n = ++seq, next = sets[1 - on];
      if (!path) return clear();
      Promise.all([PlexView.picture(server, path, W, H), PlexView.picture(server, path, BLUR_W, BLUR_H, '&blur=36')]).then(function (u) {
        if (n !== seq || !u[0]) return;
        next.img.onload = function () {
          if (n !== seq) return;
          next.bg.style.backgroundImage = u[1] ? 'url("' + u[1] + '")' : '';
          sets[on].el.classList.remove('on');
          next.el.classList.remove('stale');
          next.el.classList.add('on');
          on = 1 - on;
        };
        next.img.src = u[0];
      });
    }
    /* The focus moved on and its picture isn't in yet (moving fast along a row): the picture showing dims, so it
       doesn't stay up as if it were the new title's. */
    function dim() { sets[on].el.classList.add('stale'); }
    // The next titles' pictures fetched ahead (once each), so the backdrop is there at once when they're focused.
    var ahead = {}, aheadN = 0;
    function preload(server, path) {
      if (!path || ahead[server + '|' + path]) return;
      if (aheadN > 120) { ahead = {}; aheadN = 0; }
      ahead[server + '|' + path] = 1; aheadN++;
      Promise.all([PlexView.picture(server, path, W, H), PlexView.picture(server, path, BLUR_W, BLUR_H, '&blur=36')]).then(function (u) {
        // Kept while they load (an Image let go of can stop loading).
        ahead[server + '|' + path] = u.filter(Boolean).map(function (x) { var i = new Image(); i.src = x; return i; });
      });
    }
    // No title in focus: both layers fade out.
    function clear() { seq++; shown = ''; sets.forEach(function (s) { s.el.classList.remove('on'); }); }
    // The layer showing (the soak test reads its pictures).
    function current() { return sets[on]; }
    return { show: show, clear: clear, dim: dim, preload: preload, current: current };
  }

  return { make: make, W: W, H: H };
})();
