/* Network routing.
   webOS enforces CORS on installed apps and most IPTV providers send no CORS headers, so
   every provider request the app makes with fetch/XHR goes through the bundled helper
   service (a localhost relay, see /service).  Video handed to the TV's own player is not
   subject to CORS and goes direct.

   Settings > Playback > Connection: Automatic (relay when the helper is running), Always relay,
   or Direct (for providers or proxies like Dispatcharr that already send CORS headers). */
var Net = (function () {
  'use strict';
  var port = 0, bridge = null, state = 'off', waiters = [], lastError = '', t0 = 0, info = null, ctl = '', key = '';

  // Before trusting the helper, prove it answers.  A port with nothing behind it is worse than none.
  function verify(p) {
    return fetch('http://127.0.0.1:' + p + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { info = j || null; Log.info('net', 'Helper answered ping on port ' + p + ' (' + (Date.now() - t0) + 'ms after start)', j && j.node ? 'node ' + j.node : ''); return true; })
      .catch(function (e) { lastError = 'helper started but does not answer on port ' + p + ': ' + (e && e.message); Log.error('net', lastError); return false; });
  }
  /* The DNS for providers (Settings > Playlists and accounts > DNS, service/dns.js): told to the helper when it starts, again
     after it restarts, and when the setting changes.  The TV's own needs nothing said, except after a change. */
  var dnsSaid = 'tv';
  function setDns() {
    var s = Store.settings || {}, m = s.dns || 'tv', srv = m === 'custom' ? String(s.dnsServer || '') : '';
    if (!port || (m === 'tv' && dnsSaid === 'tv')) return Promise.resolve();
    var h = { 'Content-Type': 'application/json' }; if (ctl) h['X-TiviBro-Ctl'] = ctl;
    return fetch('http://127.0.0.1:' + port + '/net/dns', { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify({ mode: m, server: srv }) })
      .then(function (r) { return r.json(); }).then(function (j) { dnsSaid = j && j.mode || m; if (m !== 'tv') Log.info('net', 'Providers are found with ' + (j && j.mode) + (j && j.server ? ' (' + j.server + ')' : '')); },
        function (e) { Log.warn('net', 'Could not set the DNS: ' + (e && e.message)); });
  }
  /* The start is over, with a port or without: a port is checked (verify) before anyone uses it, and without
     one TiviBro goes on with direct requests and asks again later (againLater). */
  function settle() {
    var finish = function () { var w = waiters; waiters = []; w.forEach(function (f) { f(port); }); };
    if (!port) {
      // Simulator / desktop: no webOS service, but `npm run sim` runs the same helper on this
      // computer (tests/mock/relay_dev.js).  Use it if it answers; on a TV nothing listens there.
      var devPort = 47811;
      /* Only off the TV: on a TV the helper's own port is 47811 too, and a busy helper there would hold this
         request (and the start waiting on it) with no end (issue #172). */
      var devPing = typeof PalmServiceBridge === 'undefined' ? fetch('http://127.0.0.1:' + devPort + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }) : Promise.reject(new Error('on a TV'));
      return devPing.then(function (j) {
        if (j && j.ok) { port = devPort; state = 'on'; info = j; Log.info('net', 'Using the development helper on port ' + devPort + ' (webOS service: ' + (lastError || 'not available') + ')'); }
      }).catch(function () {}).then(function () {
        if (!port) Log.warn('net', 'Network helper not available (' + (lastError || 'unknown reason') + ').  Requests go direct.');
        // No answer at all (not "not installed"): asked again later, as after a restart (issue #153).
        if (!port && !restarting && typeof PalmServiceBridge !== 'undefined' && /^no answer/.test(lastError)) againLater();
        finish();
      });
    }
    verify(port).then(function (ok) { if (!ok) { port = 0; state = 'off'; } else { dnsSaid = 'tv'; setDns(); } finish(); });
  }

  /* Is a helper on this port, and how is it (issue #172)?  'ok' it answers, 'gone' nothing there (the connection
     is refused at once), 'busy' its process is there but its work holds it: the TV takes the connection for it
     and no answer comes.  A busy helper is waited for, never started again: on a 1 GB TV, asking webOS to start
     the helper while the old one was still busy froze TiviBro inside that call until webOS closed it. */
  function check(p, ms) {
    if (!p) return Promise.resolve('gone');
    var t = Date.now();
    return Promise.race([
      fetch('http://127.0.0.1:' + p + '/ping', { cache: 'no-store' }).then(function (r) { return r.ok ? 'ok' : 'busy'; },
        function () { return Date.now() - t < 1000 ? 'gone' : 'busy'; }),
      new Promise(function (r) { setTimeout(function () { r('busy'); }, ms || 1500); })
    ]);
  }
  // The helper's port last time (it keeps it from start to start), for check() before the next start.
  function lastPort() { try { return +localStorage.getItem('tivibro.helperPort') || 0; } catch (e) { return 0; } }

  // Start the helper and keep a subscription open: that is what keeps the service alive.
  function start(timeoutMs) {
    return new Promise(function (resolve) {
      if (port) return resolve(port);
      waiters.push(resolve);
      if (state === 'starting') return;
      state = 'starting'; t0 = Date.now(); lastError = ''; var tries = 0;
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
          if (r.returnValue && r.port) {
            if (r.ctl) { ctl = String(r.ctl); key = String(r.key || ''); }
            try { localStorage.setItem('tivibro.helperPort', String(r.port)); } catch (e) {}
            if (state === 'starting') { port = r.port; state = 'on'; clearTimeout(timer); settle(); }
            /* It answered after TiviBro stopped waiting (a TV just switched on or woken can take longer than
               the wait): take it now rather than run the whole session without it, which left the first
               screen with no QR code for the phone and the guide unloaded. */
            else if (state === 'off' && !port && !restarting) late(r.port);
          }
          else if (r.returnValue === false) {
            // Typical texts: "Service does not exist", "Denied method call", "Unknown method".
            lastError = 'helper refused: ' + (r.errorText || r.errorCode || 'no reason given');
            Log.error('net', lastError);
            /* Just after the TV starts or wakes, webOS can turn the helper down for a moment ("... is not
               running", "Message status unknown"; issues #75 and #82): asked again a little later, it starts. */
            if (state === 'starting' && tries < 3 && /not running|status unknown|timeout|try again|busy/i.test(lastError)) {
              tries++; clearTimeout(timer);
              var wait = tries * 2000;
              Log.info('net', 'Asking the helper again in ' + (wait / 1000) + 's (try ' + (tries + 1) + ' of 4)');
              setTimeout(function () {
                if (state !== 'starting') return;
                timer = setTimeout(function () { if (state === 'starting') { lastError = 'no answer from luna://app.tivibro.tv.service within ' + ((timeoutMs || 6000) / 1000) + 's'; state = 'off'; settle(); } }, timeoutMs || 6000);
                try { bridge.call('luna://app.tivibro.tv.service/start', JSON.stringify({ subscribe: true })); } catch (e) { lastError = 'could not call the helper: ' + e.message; state = 'off'; clearTimeout(timer); settle(); }
              }, wait);
              return;
            }
            if (state === 'starting') { state = 'off'; clearTimeout(timer); settle(); }
            else if (state === 'on') { Log.error('net', 'Helper subscription dropped while running'); restart('its subscription dropped'); }
          }
        };
      } catch (e) { lastError = 'could not call the helper: ' + e.message; state = 'off'; clearTimeout(timer); settle(); return; }
      var gen = ++startGen;
      // The helper from before still busy: webOS is asked once it isn't (or after three minutes), not now.
      check(lastPort(), 1500).then(function (how) {
        if (how !== 'busy') return call();
        Log.warn('net', 'The network helper from before is still busy (its port takes the connection but doesn\'t answer); asking webOS for it once it is free');
        var since = Date.now();
        (function wait() {
          setTimeout(function () {
            if (gen !== startGen || port) return;
            check(lastPort(), 3000).then(function (h) { if (h === 'busy' && Date.now() - since < 180000) wait(); else call(); });
          }, 5000);
        })();
      });
      function call() {
        if (gen !== startGen || port) return;
        try {
          Log.info('net', 'Starting network helper (luna://app.tivibro.tv.service/start)');
          bridge.call('luna://app.tivibro.tv.service/start', JSON.stringify({ subscribe: true }));
        } catch (e) { lastError = 'could not call the helper: ' + e.message; if (state === 'starting') { state = 'off'; clearTimeout(timer); settle(); } }
      }
    });
  }
  var startGen = 0;

  /* The helper carries every stream, so it must not stay gone.  When its subscription drops (it exited:
     webOS stopped it, or its own watchdog found it stuck, service/watchdog.js) it is started again at once,
     and whoever listens is told (the player starts the channel again through it).
     Pings every 15 s only watch it.  A helper that misses some is usually busy, not gone: on a 1 GB TV,
     reading a 65,000-show list holds it for half a minute.  Restarting a busy helper (issue #166) left it
     answering nobody, TiviBro ran without it for the rest of the session, and the next starts hung on the
     splash until webOS let go of the old one.  So missed pings only count; after two minutes of them webOS
     is asked whether it still runs (status), and only no answer there starts it again. */
  var misses = 0, restarting = false, probing = false, restartListeners = [], busySince = 0;
  var PROBE_AFTER = 8;            // missed pings (15 s apart) before webOS is asked: two minutes
  function missed(why) {
    misses++;
    if (misses === 2) Log.warn('net', 'The network helper is busy or slow (' + why + '); waiting for it');
    if (misses >= PROBE_AFTER) probe(why);
  }
  // webOS asked whether the helper still runs, without touching TiviBro's subscription: alive, keep waiting.
  function probe(why) {
    if (probing || restarting || typeof PalmServiceBridge === 'undefined') return;
    probing = true;
    var b = null, done = false, t = setTimeout(function () { end(false); }, 15000);
    function end(alive) {
      if (done) return;
      done = true; probing = false; clearTimeout(t);
      try { if (b) b.cancel(); } catch (e) {}
      if (alive) { misses = 2; Log.info('net', 'The network helper still runs (webOS says so); waiting for it'); return; }
      /* No answer from webOS either: gone, or so busy it can't answer webOS.  Busy (its port still takes the
         connection) is waited for, up to ten minutes; it restarts itself if it's stuck (service/watchdog.js). */
      check(port, 4000).then(function (how) {
        if (how === 'busy' && Date.now() - (busySince || (busySince = Date.now())) < 600000) {
          misses = 2;
          Log.warn('net', 'The network helper is busy (its port takes the connection but doesn\'t answer); waiting for it, not starting it again');
          return;
        }
        busySince = 0;
        restart(why + (how === 'busy' ? ', busy for ten minutes' : ', and webOS did not answer for it'));
      });
    }
    try {
      b = new PalmServiceBridge();
      b.onservicecallback = function (msg) { var r = {}; try { r = JSON.parse(msg); } catch (e) {} end(!!(r.returnValue && r.port)); };
      b.call('luna://app.tivibro.tv.service/status', '{}');
    } catch (e) { end(false); }
  }
  // Something that goes through the helper failed (a stream): one ping, and a miss counts like the timer's.
  function suspect(why) {
    if (!port || restarting) return;
    ping(3000).then(function (ok) { if (ok) misses = 0; else missed(why); });
  }
  function ping(ms) {
    if (!port) return Promise.resolve(false);
    return Promise.race([
      fetch('http://127.0.0.1:' + port + '/ping', { cache: 'no-store' }).then(function (r) { return r.ok; }, function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r(false); }, ms || 4000); })
    ]);
  }
  function late(p) {
    state = 'starting';
    verify(p).then(function (ok) {
      if (!ok || port) { if (!port) state = 'off'; return; }
      port = p; state = 'on'; lastError = ''; dnsSaid = 'tv'; setDns();
      Log.info('net', 'The network helper answered late, after ' + (Date.now() - t0) + 'ms; using it now');
      restartListeners.forEach(function (f) { try { f(p); } catch (e) {} });
    });
  }
  /* Issue #153: one try, and a helper that didn't answer it stayed gone for the rest of the session.  Now it
     is asked again 30 s later, then 1, 2 and every 5 minutes, until it answers (a helper stuck for good
     restarts itself, service/watchdog.js, and the next ask starts a fresh one). */
  var againTimer = null, againTries = 0;
  function againLater() {
    var wait = [30, 60, 120, 300][Math.min(againTries++, 3)];
    Log.info('net', 'Asking the network helper again in ' + (wait >= 60 ? wait / 60 + ' min' : wait + ' s'));
    clearTimeout(againTimer);
    againTimer = setTimeout(function () { if (!port) restart('still not answering, try ' + (againTries + 1)); }, wait * 1000);
  }
  function restart(why) {
    if (restarting || +localStorage.getItem('tivibro.devRelay')) return;
    restarting = true; misses = 0; clearTimeout(againTimer);
    Log.warn('net', 'Starting the network helper again (' + why + ')');
    try { if (bridge) bridge.cancel(); } catch (e) {}
    bridge = null; port = 0; state = 'off';
    start(10000).then(function (p) {
      restarting = false;
      if (!p) {
        Log.error('net', 'The network helper did not start again: ' + lastError);
        return againLater();
      }
      againTries = 0;
      Log.info('net', 'The network helper is back on port ' + p);
      restartListeners.forEach(function (f) { try { f(p); } catch (e) {} });
    });
  }
  setInterval(function () {
    if (state !== 'on' || restarting || !bridge || document.hidden) return;
    ping(4000).then(function (ok) {
      if (!ok) return missed('no answer to its pings');
      if (misses >= 2) Log.info('net', 'The network helper answers again');
      misses = 0; busySince = 0;
    });
  }, 15000);

  /* The helper's secret for its control routes (web editor, phone app, channel lists, My media).  webOS can
     restart the helper on its own; it then has a new secret, and every control request was refused until
     TiviBro was opened again.  The helper says which secret it holds (a fingerprint, in /ping and the start
     answer); when it isn't ours, or a request is refused for it, TiviBro asks the helper for it again. */
  var fixing = null;
  function fixCtl(why) {
    if (fixing) return fixing;
    if (typeof PalmServiceBridge === 'undefined') return Promise.resolve(false);
    fixing = new Promise(function (resolve) {
      var b, done = false, t = setTimeout(function () { finish(false); }, 6000);
      function finish(ok) { if (done) return; done = true; clearTimeout(t); fixing = null; resolve(ok); }
      try {
        b = new PalmServiceBridge();
        b.onservicecallback = function (msg) {
          var r = {}; try { r = JSON.parse(msg); } catch (e) {}
          if (r.returnValue && r.ctl) {
            var changed = String(r.ctl) !== ctl;
            ctl = String(r.ctl); key = String(r.key || '');
            if (r.port && r.port !== port) { Log.warn('net', 'The network helper moved to port ' + r.port); port = r.port; }
            Log.info('net', changed ? 'The network helper had a new secret (' + why + '); using it now' : 'Asked the network helper for its secret (' + why + '); it had not changed');
            if (changed) setDns();
            finish(changed);
          } else finish(false);
        };
        b.call('luna://app.tivibro.tv.service/start', JSON.stringify({}));
      } catch (e) { finish(false); }
    });
    return fixing;
  }
  // The helper's own check-in, every 15 s while it runs: its secret's fingerprint against ours.
  setInterval(function () {
    if (state !== 'on' || !port || !key || document.hidden || fixing) return;
    fetch('http://127.0.0.1:' + port + '/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.key && j.key !== key) fixCtl('its fingerprint changed');
    }, function () {});
  }, 15000);
  /* fetch for the helper's control routes: the secret added, and asked for again once when the helper
     refuses it.  init.headers is a plain object. */
  function ctlFetch(url, init) {
    init = init || {};
    var go = function () { var h = {}, k; for (k in (init.headers || {})) h[k] = init.headers[k]; if (ctl) h['X-TiviBro-Ctl'] = ctl; return fetch(url, Object.assign({}, init, { headers: h })); };
    return go().then(function (r) {
      if (r.status !== 403) return r;
      return r.clone().json().then(function (j) { return j && j.code === 'ctl'; }, function () { return false; }).then(function (mine) {
        if (!mine) return r;
        return fixCtl('a request was refused').then(function (changed) { return changed ? go() : r; });
      });
    });
  }

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
  /* later (movie and show posters, issue #126): a poster host that answers only some of many asks at once (most
     covers missing, "a few random ones loaded", never tried again) gets two more tries, 2 and 6 seconds on, a
     few at a time.  Channel logos don't: a dead logo stays dead, and there can be thousands. */
  var laterBusy = 0;
  function retryImage(img, later) {
    var s = img && img.src;
    if (!s) return false;
    // Through the helper first (https everywhere; http too for posters: some hosts want the playlist's User-Agent).
    if (/^https:/i.test(s) || (later && /^http:/i.test(s))) { var w = wrap(s); if (w !== s) { img.src = w; return true; } }
    if (!later) return false;
    var n = img._tries = (img._tries || 0) + 1;
    if (n > 2 || laterBusy >= 40) return false;
    laterBusy++;
    setTimeout(function () {
      laterBusy--;
      if (!img.parentNode && !img._keep) return;
      var u = img.src; img.removeAttribute('src'); img.src = u;
    }, n === 1 ? 2000 : 6000);
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
    return 'http://127.0.0.1:' + port + uaPrefix(opts && opts.ua ? String(opts.ua) : opts && opts.pl ? uaFor(opts.pl) : uaOfUrl(m[2])) + hdrPrefix(opts && opts.hdr) + unz + '/x/' + m[1].toLowerCase() + '/' + m[2] + rest;
  }
  /* Playlist User-Agent (Settings > Playlists and accounts > the playlist): sent by the helper to the provider.
     With several playlists on, each sends its own: the player says which playlist a stream is from
     (opts.pl), and anything else goes by the address's host, the first playlist winning a tie.
     A channel whose M3U line gives its own ("|User-Agent=...", plshape.js) sends that one (opts.ua). */
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
  /* A channel's own Referer and Origin (an M3U line ending "|Referer=...", plshape.js): /hd/<base64url of
     their JSON>, after /ua/.  The helper sends only those two, and for a DRM licence server its own headers
     (h.H, from #KODIPROP license_key, player.js): the browser can't send those to the helper itself. */
  function hdrPrefix(h) {
    var extra = h && h.H && typeof h.H === 'object' && Object.keys(h.H).length ? h.H : null;
    if (!h || (!h.Referer && !h.Origin && !extra)) return '';
    var o = {}; if (h.Referer) o.Referer = String(h.Referer); if (h.Origin) o.Origin = String(h.Origin); if (extra) o.H = extra;
    return '/hd/' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unwrap(url) {
    var m = /^http:\/\/127\.0\.0\.1:\d+(?:\/ua\/[A-Za-z0-9_-]+)?(?:\/hd\/[A-Za-z0-9_-]+)?(?:\/unz\/[A-Za-z0-9_-]+)?\/x\/(https?)\/(.*)$/.exec(url || '');
    return m ? m[1] + '://' + m[2] : url;
  }

  return {
    start: start, wrap: wrap, unwrap: unwrap, ping: ping, restart: restart, suspect: suspect, onRestart: function (f) { restartListeners.push(f); }, retryImage: retryImage, get ua() { return ua(); }, uaFor: uaFor,
    // Guides: the helper unzips .gz on every TV.  Without it, only browsers with DecompressionStream can.
    get canUnzip() { return !!useRelay() || typeof DecompressionStream !== 'undefined'; },
    xfer: function (id) { return port ? 'http://127.0.0.1:' + port + '/xfer/' + id : ''; },
    // The helper's /ping answer: Node version, and sys { bootAt, power } (see service/proxy.js).
    get info() { return info; },
    // Headers for the helper's control routes (web editor, phone app connection): see service/proxy.js.
    setDns: setDns,
    ctlFetch: ctlFetch, fixCtl: fixCtl,
    ctlHeaders: function (h) { h = h || {}; if (ctl) h['X-TiviBro-Ctl'] = ctl; return h; },
    get port() { return port; }, get active() { return !!useRelay(); }, get state() { return state; }, get lastError() { return lastError; },
    status: function () { return port ? 'running on port ' + port : 'not running' + (lastError ? ': ' + lastError : ''); },
    // Recent requests as the helper saw them (status, time, bytes, upstream error codes).
    helperLog: function () { return port ? fetch('http://127.0.0.1:' + port + '/log', { cache: 'no-store' }).then(function (r) { return r.json(); }) : Promise.resolve(null); }
  };
})();
