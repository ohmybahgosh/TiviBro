/* Network routing.
   webOS enforces CORS on installed apps and most IPTV providers send no CORS headers, so
   every provider request the app makes with fetch/XHR goes through the bundled helper
   service (a localhost relay, see /service).  Video handed to the TV's own player is not
   subject to CORS and goes direct.

   Settings > Playback > Connection: Automatic (relay when the helper is running), Always relay,
   or Direct (for providers or proxies like Dispatcharr that already send CORS headers). */
var Net = (function () {
  'use strict';
  var port = 0, bridge = null, state = 'off', waiters = [], lastError = '', t0 = 0, info = null, ctl = '';

  // Before trusting the helper, prove it answers.  A port with nothing behind it is worse than none.
  function verify(p) {
    return fetch('http://127.0.0.1:' + p + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { info = j || null; Log.info('net', 'Helper answered ping on port ' + p + ' (' + (Date.now() - t0) + 'ms after start)', j && j.node ? 'node ' + j.node : ''); return true; })
      .catch(function (e) { lastError = 'helper started but does not answer on port ' + p + ': ' + (e && e.message); Log.error('net', lastError); return false; });
  }
  function settle() {
    var finish = function () { var w = waiters; waiters = []; w.forEach(function (f) { f(port); }); };
    if (!port) {
      // Simulator / desktop: no webOS service, but `npm run sim` runs the same helper on this
      // computer (tests/mock/relay_dev.js).  Use it if it answers; on a TV nothing listens there.
      var devPort = 47811;
      return fetch('http://127.0.0.1:' + devPort + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { port = devPort; state = 'on'; info = j; Log.info('net', 'Using the development helper on port ' + devPort + ' (webOS service: ' + (lastError || 'not available') + ')'); }
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
          if (r.returnValue && r.port) { if (r.ctl) ctl = String(r.ctl); if (state === 'starting') { port = r.port; state = 'on'; clearTimeout(timer); settle(); } }
          else if (r.returnValue === false) {
            // Typical texts: "Service does not exist", "Denied method call", "Unknown method".
            lastError = 'helper refused: ' + (r.errorText || r.errorCode || 'no reason given');
            Log.error('net', lastError);
            if (state === 'starting') { state = 'off'; clearTimeout(timer); settle(); }
            else if (state === 'on') { Log.error('net', 'Helper subscription dropped while running'); restart('its subscription dropped'); }
          }
        };
        Log.info('net', 'Starting network helper (luna://app.tivibro.tv.service/start)');
        bridge.call('luna://app.tivibro.tv.service/start', JSON.stringify({ subscribe: true }));
      } catch (e) { lastError = 'could not call the helper: ' + e.message; state = 'off'; clearTimeout(timer); settle(); }
    });
  }

  /* The helper carries every stream, so it must not stay gone: while it runs it is asked how it is every
     15 s (and the moment its subscription drops).  Two pings in a row unanswered: start it again, and tell
     whoever listens (the player starts the channel again through it). */
  var misses = 0, restarting = false, restartListeners = [];
  function ping(ms) {
    if (!port) return Promise.resolve(false);
    return Promise.race([
      fetch('http://127.0.0.1:' + port + '/ping', { cache: 'no-store' }).then(function (r) { return r.ok; }, function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r(false); }, ms || 4000); })
    ]);
  }
  function restart(why) {
    if (restarting || +localStorage.getItem('tivibro.devRelay')) return;
    restarting = true; misses = 0;
    Log.warn('net', 'Starting the network helper again (' + why + ')');
    try { if (bridge) bridge.cancel(); } catch (e) {}
    bridge = null; port = 0; state = 'off';
    start(10000).then(function (p) {
      restarting = false;
      if (!p) { Log.error('net', 'The network helper did not start again: ' + lastError); return; }
      Log.info('net', 'The network helper is back on port ' + p);
      restartListeners.forEach(function (f) { try { f(p); } catch (e) {} });
    });
  }
  setInterval(function () {
    if (state !== 'on' || restarting || !bridge || document.hidden) return;
    ping(4000).then(function (ok) { if (ok) misses = 0; else if (++misses >= 2) restart('no answer to two pings'); });
  }, 15000);

  function useRelay() {
    var m = Store.settings.network || 'auto';
    return port && (m === 'auto' || m === 'relay');
  }

  // http://host:81/a/b.m3u8?x -> http://127.0.0.1:PORT/x/http/host:81/a/b.m3u8?x
  // opts.unzip: an id; the helper then unzips gzip/deflate answers (guides) and counts the
  // compressed bytes at xfer(id).  See service/unzip.js.
  // A logo or poster that won't load over https gets one more try through the helper.  Older TVs
  // (2018 to 2020 models without recent updates) don't trust today's Let's Encrypt certificates,
  // which many providers' image hosts use; the helper doesn't depend on the TV's certificate list.
  // The relayed address is plain http on localhost, so this can't loop.
  function retryImage(img) {
    var s = img && img.src;
    if (!s || !/^https:/i.test(s)) return false;
    var w = wrap(s);
    if (w === s) return false;
    img.src = w;
    return true;
  }
  function wrap(url, opts) {
    if (!url || !(useRelay() || (opts && opts.always && port))) return url;     // always: the channel list even on Direct (source.js)
    var m = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(url);
    if (!m) return url;
    if (m[2] === '127.0.0.1:' + port || m[2] === 'localhost:' + port) return url;   // already relayed
    var rest = m[3] || '/';
    if (rest.charAt(0) !== '/') rest = '/' + rest;
    var unz = opts && opts.unzip ? '/unz/' + String(opts.unzip).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
    return 'http://127.0.0.1:' + port + uaPrefix(opts && opts.pl ? uaFor(opts.pl) : uaOfUrl(m[2])) + unz + '/x/' + m[1].toLowerCase() + '/' + m[2] + rest;
  }
  /* Playlist User-Agent (Settings > Playlists > the playlist): sent by the helper to the provider.
     With several playlists on, each sends its own: the player says which playlist a stream is from
     (opts.pl), and anything else goes by the address's host, the first playlist winning a tie. */
  var uaCache = { ua: null, p: '' };
  function uaFor(p) { return p && p.ua ? String(p.ua).trim() : ''; }
  function ua() { return uaFor(Store.playlist); }
  function hostPart(u) { var m = /^(?:[a-z]+:\/\/)?(?:[^@\/]*@)?([^\/:?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : ''; }
  function uaOfUrl(hostPort) {
    var more = Store.others ? Store.others() : [];
    if (!more.length) return ua();
    var list = [Store.playlist].concat(more);
    var h = String(hostPort || '').split(':')[0].toLowerCase();
    for (var i = 0; i < list.length; i++) if (h && hostPart(list[i].type === 'm3u' ? list[i].m3u : list[i].server) === h) return uaFor(list[i]);
    return ua();
  }
  function uaPrefix(u) {
    if (u === undefined) u = ua();
    if (!u) return '';
    if (uaCache.ua !== u) { uaCache.ua = u; uaCache.p = '/ua/' + btoa(unescape(encodeURIComponent(u))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    return uaCache.p;
  }
  function unwrap(url) {
    var m = /^http:\/\/127\.0\.0\.1:\d+(?:\/ua\/[A-Za-z0-9_-]+)?(?:\/unz\/[A-Za-z0-9_-]+)?\/x\/(https?)\/(.*)$/.exec(url || '');
    return m ? m[1] + '://' + m[2] : url;
  }

  return {
    start: start, wrap: wrap, unwrap: unwrap, ping: ping, restart: restart, onRestart: function (f) { restartListeners.push(f); }, retryImage: retryImage, get ua() { return ua(); }, uaFor: uaFor,
    // Guides: the helper unzips .gz on every TV.  Without it, only browsers with DecompressionStream can.
    get canUnzip() { return !!useRelay() || typeof DecompressionStream !== 'undefined'; },
    xfer: function (id) { return port ? 'http://127.0.0.1:' + port + '/xfer/' + id : ''; },
    // The helper's /ping answer: Node version, and sys { bootAt, power } (see service/proxy.js).
    get info() { return info; },
    // Headers for the helper's control routes (web editor, phone app connection): see service/proxy.js.
    ctlHeaders: function (h) { h = h || {}; if (ctl) h['X-TiviBro-Ctl'] = ctl; return h; },
    get port() { return port; }, get active() { return !!useRelay(); }, get state() { return state; }, get lastError() { return lastError; },
    status: function () { return port ? 'running on port ' + port : 'not running' + (lastError ? ': ' + lastError : ''); },
    // Recent requests as the helper saw them (status, time, bytes, upstream error codes).
    helperLog: function () { return port ? fetch('http://127.0.0.1:' + port + '/log', { cache: 'no-store' }).then(function (r) { return r.json(); }) : Promise.resolve(null); }
  };
})();
