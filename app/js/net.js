/* Network routing.
   webOS enforces CORS on installed apps and most IPTV providers send no CORS headers, so
   every provider request the app makes with fetch/XHR goes through the bundled helper
   service (a localhost relay, see /service).  Video handed to the TV's own player is not
   subject to CORS and goes direct.

   Settings > Playback > Network: Automatic (relay when the helper is running), Always relay,
   or Direct (for providers or proxies like Dispatcharr that already send CORS headers). */
var Net = (function () {
  'use strict';
  var port = 0, bridge = null, state = 'off', waiters = [], lastError = '', t0 = 0;

  // Before trusting the helper, prove it answers.  A port with nothing behind it is worse than none.
  function verify(p) {
    return fetch('http://127.0.0.1:' + p + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { Log.info('net', 'Helper answered ping on port ' + p + ' (' + (Date.now() - t0) + 'ms after start)', j && j.node ? 'node ' + j.node : ''); return true; })
      .catch(function (e) { lastError = 'helper started but does not answer on port ' + p + ': ' + (e && e.message); Log.error('net', lastError); return false; });
  }
  function settle() {
    var finish = function () { var w = waiters; waiters = []; w.forEach(function (f) { f(port); }); };
    if (!port) {
      // Simulator / desktop: no webOS service, but `npm run sim` runs the same helper on this
      // computer (tests/mock/relay_dev.js).  Use it if it answers; on a TV nothing listens there.
      var devPort = 47811;
      return fetch('http://127.0.0.1:' + devPort + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { port = devPort; state = 'on'; Log.info('net', 'Using the development helper on port ' + devPort + ' (webOS service: ' + (lastError || 'not available') + ')'); }
      }).catch(function () {}).then(function () {
        if (!port) Log.warn('net', 'Network helper not available (' + (lastError || 'unknown reason') + ').  Requests go direct.');
        finish();
      });
    }
    verify(port).then(function (ok) { if (!ok) { port = 0; state = 'off'; } finish(); });
  }

  // Start the helper and keep a subscription open: that is what keeps the service alive.
  function start(timeoutMs) {
    return new Promise(function (resolve) {
      if (port) return resolve(port);
      waiters.push(resolve);
      if (state === 'starting') return;
      state = 'starting'; t0 = Date.now(); lastError = '';
      var dev = +localStorage.getItem('tivibro.devRelay');     // browser testing only
      if (dev) { Log.info('net', 'Using development relay on port ' + dev); port = dev; state = 'on'; return settle(); }
      if (typeof PalmServiceBridge === 'undefined') { lastError = 'PalmServiceBridge is missing (not running on webOS?)'; state = 'off'; return settle(); }
      var timer = setTimeout(function () {
        if (state === 'starting') { lastError = 'no answer from luna://app.tivibro.tv.service within ' + ((timeoutMs || 6000) / 1000) + 's'; state = 'off'; settle(); }
      }, timeoutMs || 6000);
      try {
        bridge = new PalmServiceBridge();
        bridge.onservicecallback = function (msg) {
          var r = {};
          try { r = JSON.parse(msg); } catch (e) { Log.error('net', 'Helper sent something unreadable', String(msg).slice(0, 200)); }
          Log.info('net', 'Helper replied after ' + (Date.now() - t0) + 'ms', msg && String(msg).slice(0, 300));
          if (r.returnValue && r.port) { if (state === 'starting') { port = r.port; state = 'on'; clearTimeout(timer); settle(); } }
          else if (r.returnValue === false) {
            // Typical texts: "Service does not exist", "Denied method call", "Unknown method".
            lastError = 'helper refused: ' + (r.errorText || r.errorCode || 'no reason given');
            Log.error('net', lastError);
            if (state === 'starting') { state = 'off'; clearTimeout(timer); settle(); }
            else if (state === 'on') { Log.error('net', 'Helper subscription dropped while running'); }
          }
        };
        Log.info('net', 'Starting network helper (luna://app.tivibro.tv.service/start)');
        bridge.call('luna://app.tivibro.tv.service/start', JSON.stringify({ subscribe: true }));
      } catch (e) { lastError = 'could not call the helper: ' + e.message; state = 'off'; clearTimeout(timer); settle(); }
    });
  }

  function useRelay() {
    var m = Store.settings.network || 'auto';
    return port && (m === 'auto' || m === 'relay');
  }

  // http://host:81/a/b.m3u8?x -> http://127.0.0.1:PORT/x/http/host:81/a/b.m3u8?x
  // opts.unzip: an id; the helper then unzips gzip/deflate answers (guides) and counts the
  // compressed bytes at xfer(id).  See service/unzip.js.
  function wrap(url, opts) {
    if (!url || !useRelay()) return url;
    var m = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(url);
    if (!m) return url;
    if (m[2] === '127.0.0.1:' + port || m[2] === 'localhost:' + port) return url;   // already relayed
    var rest = m[3] || '/';
    if (rest.charAt(0) !== '/') rest = '/' + rest;
    var unz = opts && opts.unzip ? '/unz/' + String(opts.unzip).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
    return 'http://127.0.0.1:' + port + uaPrefix() + unz + '/x/' + m[1].toLowerCase() + '/' + m[2] + rest;
  }
  // Playlist User-Agent (Settings > Playlists > the playlist): sent by the helper to the provider.
  var uaCache = { ua: null, p: '' };
  function ua() { var p = Store.playlist; return p && p.ua ? String(p.ua).trim() : ''; }
  function uaPrefix() {
    var u = ua(); if (!u) return '';
    if (uaCache.ua !== u) { uaCache.ua = u; uaCache.p = '/ua/' + btoa(unescape(encodeURIComponent(u))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    return uaCache.p;
  }
  function unwrap(url) {
    var m = /^http:\/\/127\.0\.0\.1:\d+(?:\/ua\/[A-Za-z0-9_-]+)?(?:\/unz\/[A-Za-z0-9_-]+)?\/x\/(https?)\/(.*)$/.exec(url || '');
    return m ? m[1] + '://' + m[2] : url;
  }

  return {
    start: start, wrap: wrap, unwrap: unwrap, get ua() { return ua(); },
    // Guides: the helper unzips .gz on every TV.  Without it, only browsers with DecompressionStream can.
    get canUnzip() { return !!useRelay() || typeof DecompressionStream !== 'undefined'; },
    xfer: function (id) { return port ? 'http://127.0.0.1:' + port + '/xfer/' + id : ''; },
    get port() { return port; }, get active() { return !!useRelay(); }, get state() { return state; }, get lastError() { return lastError; },
    status: function () { return port ? 'running on port ' + port : 'not running' + (lastError ? ': ' + lastError : ''); },
    // Recent requests as the helper saw them (status, time, bytes, upstream error codes).
    helperLog: function () { return port ? fetch('http://127.0.0.1:' + port + '/log', { cache: 'no-store' }).then(function (r) { return r.json(); }) : Promise.resolve(null); }
  };
})();
