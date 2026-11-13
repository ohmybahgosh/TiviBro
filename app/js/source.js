/* Playlist loading.  Normalises Xtream Codes and M3U into one compact shape:
   channel = { k: stable key, id, n: raw name, g: group id, logo, num, epg, url, arch }
   Kept deliberately flat and short-keyed: a 20k channel list is a lot of objects on a TV. */
var Source = (function () {
  var account = null;      // the login's account facts (status, expiry, connections), for Provider status
  'use strict';

  /* ---------- server address ----------
     Providers hand out every form: http://host, https://host, host:8080, a bare host, or a whole
     get.php link.  clean() reduces any of these to scheme://host[:port][/path]; candidates()
     lists what to try when the scheme was not given (or the given one fails). */
  function clean(server) {
    var s = String(server || '').trim().replace(/\s+/g, '');
    // A pasted M3U or API link: keep only the address part.
    s = s.replace(/\/(get|player_api|panel_api|xmltv)\.php.*$/i, '').replace(/\/c\/?$/i, '');
    return s.replace(/\/+$/, '');
  }
  function hasScheme(s) { return /^https?:\/\//i.test(s); }
  function swapScheme(s) { return /^https:/i.test(s) ? s.replace(/^https:/i, 'http:') : s.replace(/^http:/i, 'https:'); }
  function candidates(server) {
    var s = clean(server);
    if (!s) return [];
    return hasScheme(s) ? [s, swapScheme(s)] : ['http://' + s, 'https://' + s];
  }
  // Credentials pasted inside a get.php / player_api link, e.g. ...?username=a&password=b
  function credsFromLink(server) {
    var m = /[?&]username=([^&]+)/i.exec(server || ''), n = /[?&]password=([^&]+)/i.exec(server || '');
    return m && n ? { user: decodeURIComponent(m[1]), pass: decodeURIComponent(n[1]) } : null;
  }

  function userShape(u) { u = String(u || ''); return u ? u.slice(0, 2) + '*** (' + U.secretShape(u) + ')' : 'no username'; }
  // The address the panel says it is, for the log: "same" when it is the one we logged in to, never the name itself.
  function panelHost(h, found) {
    if (!h) return '?';
    var m = /^[a-z]+:\/\/([^\/:?#]+)/i.exec(found || '');
    return m && m[1].toLowerCase() === String(h).toLowerCase() ? 'same' : 'another address';
  }
  function base(server) {
    server = clean(server);
    if (server && !/^https?:\/\//i.test(server)) server = 'http://' + server;
    return server;
  }
  function api(p, action, extra) {
    // A Stalker portal's movies and shows: the helper answers Xtream's actions for it (service/stalker.js).
    if (p && p.type === 'stalker') return 'http://127.0.0.1:' + Net.port + '/stalker/xc/player_api.php?stb=' + stb(p) + (action ? '&action=' + action : '') + (extra || '');
    return base(p.server) + '/player_api.php?username=' + encodeURIComponent(p.user) +
      '&password=' + encodeURIComponent(p.pass) + (action ? '&action=' + action : '') + (extra || '');
  }

  /* Which failure to show when both http and https failed (issue #87): the same server gave a different error
     depending on which scheme was typed, because the last one tried won.  An answer from the server itself
     (HTTP 404, 403...) says more than a port that doesn't speak https, so it wins whichever order they ran in. */
  function mismatch(e) { return !!(e && /wrong version number|EPROTO|unknown protocol|packet length too long/i.test(e.message || '')); }
  function pick(errs) {
    var said = errs.filter(function (e) { return e && e.kind === 'http' && e.status > 0 && !/^helper: /.test(e.message || ''); })[0];
    if (said) return said;
    var last = errs[errs.length - 1];
    return mismatch(last) && errs.length > 1 ? errs[0] : last;
  }
  // "http, port 8080": what was tried, without the server's name (it can show on the TV's screen).
  function where(b) {
    var m = /^(https?):\/\/[^\/:?#]+(?::(\d+))?/i.exec(b || '');
    if (!m) return 'that address';
    var sc = m[1].toLowerCase();
    return sc + ', port ' + (m[2] || (sc === 'https' ? '443' : '80'));
  }

  // Find the address that really answers as an Xtream panel: as typed first, then the other
  // scheme (http <-> https).  Wrong passwords stop the search; anything network-ish moves on.
  function detect(p, label) {
    var list = candidates(p.server), tried = [], errs = [], each = [];
    if (!list.length) return Promise.reject(Object.assign(new Error('Enter the server address.'), { kind: 'auth' }));
    function attempt(i) {
      var b = list[i];
      var q = Object.assign({}, p, { server: b });
      return U.getJSON(api(q, ''), 15000, label || 'login').then(function (info) {
        if (!info || (!info.user_info && !(Array.isArray(info) && !info.length))) {
          throw Object.assign(new Error('Answered, but not like an Xtream Codes panel'), { kind: 'notxc', body: JSON.stringify(info).slice(0, 200) });
        }
        if (i > 0) Log.info('xc', 'Connected using ' + b + ' after ' + list[0] + ' failed');
        return { base: b, info: info, tried: tried };
      }).catch(function (e) {
        tried.push(b + '  →  ' + friendly(e));
        errs.push(e);
        each.push(where(b) + ': ' + String(friendly(e)).split('.  ')[0].replace(/([^.!?])$/, '$1.'));
        if (e.kind === 'auth' || i + 1 >= list.length) { e = pick(errs); e.tried = tried; e.each = each; throw e; }
        Log.warn('xc', b + ' did not work (' + (e.message || e) + '); trying ' + list[i + 1]);
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  function loadXtream(p) {
    var t0 = Date.now();
    var linked = credsFromLink(p.server);
    if (linked && (!p.user || !p.pass)) { p = Object.assign({}, p, linked); Log.info('xc', 'Took the username and password from the pasted link'); }
    // The username as its first two letters and its shape, like the password (issue #76): a report sent while a
    // new playlist was being added (not saved yet, so the report's own masking didn't know it) showed it whole.
    Log.info('xc', 'Login to ' + clean(p.server) + ' as ' + userShape(p.user) + ' (password ' + U.secretShape(p.pass) + ') via ' + (Net.active ? 'helper :' + Net.port : 'direct') + (hasScheme(clean(p.server)) ? '' : ' (no http/https given: trying both)'));
    var found = '';
    return detect(p, 'login').then(function (d) {
      found = d.base;
      p = Object.assign({}, p, { server: d.base });
      return d.info;
    }).then(function (info) {
      var ui = info && info.user_info, si = (info && info.server_info) || {};
      if (Array.isArray(info) && !info.length) throw Object.assign(new Error('Login rejected: the server returned an empty list.  Check the username and password.'), { kind: 'auth' });
      if (!ui) {
        Log.error('xc', 'Login response has no user_info', info);
        throw Object.assign(new Error('The server answered, but not like an Xtream Codes panel.  Check the server address (include the port, e.g. http://host:8080).'), { kind: 'auth' });
      }
      if (si.server_protocol && found.indexOf(si.server_protocol + ':') !== 0) Log.info('xc', 'Panel says it prefers ' + si.server_protocol + (si.https_port ? ' (https port ' + si.https_port + ')' : '') + '; connected with ' + found.split(':')[0] + ', which works.');
      Log.info('xc', 'Login answer: auth=' + ui.auth + ' status=' + ui.status + ' exp=' + (ui.exp_date ? new Date(+ui.exp_date * 1000).toISOString().slice(0, 10) : 'none') +
        ' connections=' + ui.active_cons + '/' + ui.max_connections + ' formats=' + JSON.stringify(ui.allowed_output_formats || []) +
        ' server=' + panelHost(si.url, found) + ':' + (si.port || '?') + ' https=' + (si.https_port || '-') + ' protocol=' + (si.server_protocol || '?') + ' tz=' + (si.timezone || '?') + ' (' + (Date.now() - t0) + 'ms)');
      if (String(ui.auth) !== '1') throw Object.assign(new Error('Login rejected.  Check the username and password.'), { kind: 'auth' });
      if (ui.status && ui.status !== 'Active') throw Object.assign(new Error('Account status is ' + ui.status + '.'), { kind: 'auth' });
      if (ui.exp_date && +ui.exp_date * 1000 < Date.now()) Log.warn('xc', 'Subscription expiry date is in the past');
      // For Provider status (provstatus.js): what the account looks like, for the message to the provider.
      account = { status: ui.status || '', exp: ui.exp_date ? new Date(+ui.exp_date * 1000).toISOString().slice(0, 10) : '', active: +ui.active_cons || 0, max: +ui.max_connections || 0 };
      if (+ui.max_connections && +ui.active_cons >= +ui.max_connections) Log.warn('xc', 'All ' + ui.max_connections + ' connections are already in use; streams may be refused');
      var fmts = ui.allowed_output_formats || [];
      if (fmts.length && fmts.indexOf(Store.settings.format) < 0) Log.warn('xc', 'Provider does not list "' + Store.settings.format + '" as an allowed format (allows ' + fmts.join(', ') + ').  Change Stream format in Settings if channels fail.');
      return xtreamLists(p, t0)
        .then(function (shaped) {
          var groups = shaped.groups, chans = shaped.channels;
          return { server: found, user: p.user, pass: p.pass, groups: groups, channels: chans, epgUrl: base(p.server) + '/xmltv.php?username=' + encodeURIComponent(p.user) + '&password=' + encodeURIComponent(p.pass),
            tz: (info.server_info && info.server_info.timezone) || '',
            exp: info.user_info.exp_date ? +info.user_info.exp_date * 1000 : 0,
            maxConn: +info.user_info.max_connections || 0, _live: shaped._live || '' };
        });
    });
  }

  var parseM3U = PlShape.parseM3U;

  /* On a TV the helper downloads and shapes the channel list (service/live.js), so the app never
     parses the provider's whole answer; if it can't, the app does it here as before. */
  /* Even with Connection set to Direct (issue #54: a 1 GB TV on Direct closed three times reading a big M3U
     in the app): the list is the one thing that can run the app out of memory, and the helper reads it in
     its own process.  If the helper can't, the app reads it as before. */
  function helperLive() { return !!(Net.port && Net.info && Net.info.live >= 1); }
  function relayed(u) { return Net.wrap(u, { always: true }); }
  // The helper keeps what it loaded for the playlist's cache (Store.bigSet saves it from there), when it
  // keeps the cache at all.
  function keepIt() { return !!(Net.info && Net.info.kv); }
  function viaHelper(path, body) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 240000);
    if (ctl) { aborts.push(ctl); if (aborts.length > 8) aborts.shift(); }
    return fetch('http://127.0.0.1:' + Net.port + path, { method: 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { clearTimeout(t); j._status = r.status; return j; }); }, function (e) { clearTimeout(t); e.dropped = true; throw e; });
  }
  /* The helper read the list and then went quiet (it ran out of memory: a 93 MB list on a 2020 TV, issue
     #26), or said the list is too big.  Reading it in the app instead only closes TiviBro as well, so
     this ends the load with a clear message.  Other helper errors still fall back to the app. */
  function tooBig(e, what) {
    if (!(e && (e.dropped || /too big/i.test(e.message || '')))) return null;
    Log.error(what, 'The network helper stopped while reading the list (' + (e.message || e) + '); not loading it in the app, which would close TiviBro');
    return Object.assign(new Error('This playlist is too big for this TV to read: the network helper stopped while reading it.  Ask your provider for a smaller list (live channels only), or add it as an Xtream Codes login.'), { kind: 'toobig' });
  }
  function xtreamLists(p, t0) {
    function direct() {
      return Promise.all([U.getJSON(api(p, 'get_live_categories'), 30000, 'categories'), U.getJSON(api(p, 'get_live_streams'), 90000, 'channels')]).then(function (r) {
        if (!Array.isArray(r[0])) Log.warn('xc', 'Categories response is not a list', typeof r[0]);
        if (!Array.isArray(r[1])) Log.warn('xc', 'Channel list response is not a list', typeof r[1]);
        Log.info('xc', 'Loaded ' + ((r[0] || []).length) + ' categories and ' + ((r[1] || []).length) + ' channels in ' + (Date.now() - t0) + 'ms');
        return PlShape.xtream(r[0], r[1]);
      });
    }
    if (!helperLive()) return direct();
    return viaHelper('/live/xtream', { u: relayed(api(p, 'get_live_streams')), uc: relayed(api(p, 'get_live_categories')), keep: keepIt() }).then(function (j) {
      if (j._status !== 200 || !Array.isArray(j.channels)) throw new Error(j.error || 'HTTP ' + j._status);
      Log.info('xc', 'The helper loaded ' + j.cats + ' categories and ' + j.channels.length + ' channels in ' + (Date.now() - t0) + 'ms');
      return { groups: j.groups, channels: j.channels, _live: j.live || '' };
    }).catch(function (e) {
      if (stopping) throw stopped();
      var big = tooBig(e, 'xc'); if (big) throw big;
      Log.warn('xc', 'The helper could not load the channel list (' + (e && e.message || e) + '), loading it here');
      return direct();
    });
  }

  function loadM3U(p) {
    var t0 = Date.now(), raw = p.m3u.trim();
    var list = hasScheme(raw) ? [raw, swapScheme(raw)] : ['http://' + raw, 'https://' + raw], used = list[0];
    Log.info('m3u', 'Loading playlist ' + raw + ' via ' + (helperLive() ? 'helper :' + Net.port : 'direct'));
    function fetchList(i) {
      used = list[i];
      if (helperLive()) {
        return viaHelper('/live/m3u', { u: relayed(list[i]), keep: keepIt(), pl: p.id || '', sig: sig(p) }).then(function (j) {
          if (j._status === 422) return { notM3u: j.head || '' };
          if (j._status !== 200 || !Array.isArray(j.channels)) throw new Error(j.error || 'HTTP ' + j._status);
          return { shaped: j };
        }).catch(function (e) {
          if (stopping) throw stopped();
          var big = tooBig(e, 'm3u'); if (big) throw big;
          Log.warn('m3u', 'The helper could not load ' + list[i] + ' (' + (e && e.message || e) + '), loading it here');
          return direct(i);
        });
      }
      return direct(i);
    }
    function direct(i) {
      if (stopping) return Promise.reject(stopped());
      return U.getText(list[i], 90000, 'playlist').catch(function (e) {
        if (stopping) throw stopped();
        if (i + 1 >= list.length || e.kind === 'timeout') throw e;
        Log.warn('m3u', list[i] + ' failed (' + e.message + '); trying ' + list[i + 1]);
        return fetchList(i + 1);
      });
    }
    return fetchList(0).then(function (t) {
      var d, size;
      if (typeof t === 'string') {
        if (t.indexOf('#EXTM3U') < 0 && t.indexOf('#EXTINF') < 0) t = { notM3u: t.slice(0, 200) };
        else { d = parseM3U(t); size = t.length; }
      } else if (t.shaped) { d = t.shaped; size = d.bytes; }
      if (!d) {
        Log.error('m3u', 'Not an M3U playlist.  First 200 characters', t.notM3u);
        throw Object.assign(new Error('That URL did not return an M3U playlist.'), { kind: 'parse' });
      }
      d = { groups: d.groups, channels: d.channels, epgUrl: d.epgUrl || '', _live: t.shaped ? t.shaped.live || '' : '', vodSkipped: +d.vodSkipped || 0, vod: d.vod && d.vod.movies != null ? d.vod : null };
      Log.info('m3u', (t.shaped ? 'The helper parsed ' : 'Parsed ') + d.channels.length + ' channels in ' + d.groups.length + ' groups (' + Math.round(size / 1024) + ' KB, ' + (Date.now() - t0) + 'ms)' + (d.epgUrl ? '; guide address in playlist' : '; no guide address in playlist') +
        (d.vodSkipped ? '; left out ' + d.vodSkipped + ' movies and series episodes (a list this big keeps its live channels)' : '') +
        (d.vod ? '; ' + d.vod.movies + ' movies and ' + d.vod.series + ' shows go to Movies and Shows' : ''));
      if (!d.channels.length) throw Object.assign(new Error('The playlist downloaded but has no channels in it.'), { kind: 'parse' });
      d.m3u = used;
      return d;
    });
  }

  /* One load of a playlist at a time.  A second ask while one runs (the scheduled reload and Reload
     channels, the web editor) gets the same answer instead of a second download and parse: on a
     187,000-channel list two at once ran a small TV out of memory (issue #25).  busy(): the load
     running now, if any (the public guide waits for it). */
  var running = {};
  function busy() { var k = Object.keys(running)[0]; return k ? running[k].job.then(function () {}, function () {}) : null; }
  /* Stop a load (Back on the loading screen, Stop reloading in Settings; issue #25): the helper's
     download is cut off, nothing falls back to loading it here instead, and whoever waits gets a
     'stopped' error at once. */
  var aborts = [], stopping = false;
  function stopped() { return Object.assign(new Error('Stopped loading the channel list.'), { kind: 'stopped' }); }
  function stop(id) {
    var r = running[id || ''] || running[Object.keys(running)[0]];
    if (!r) return false;
    stopping = true;
    aborts.splice(0).forEach(function (c) { try { c.abort(); } catch (e) {} });
    Log.warn('app', 'Stopped loading the channel list');
    r.stop(stopped());
    return true;
  }
  function load(p) {
    var id = (p && p.id) || '', key = id + '|' + sig(p), r = running[id];
    if (r && r.key === key) { Log.info(p.type === 'm3u' ? 'm3u' : 'xc', 'Already loading this playlist; waiting for that load'); return r.job; }
    stopping = false;
    var halt, gate = new Promise(function (res, rej) { halt = rej; });
    var job = Promise.race([load1(p), gate]);
    job.catch(function () {});
    running[id] = { key: key, job: job, stop: halt };
    function done() { if (running[id] && running[id].job === job) delete running[id]; }
    job.then(done, done);
    return job;
  }
  /* ---------- Stalker portals (service/stalker.js, discussion #60) ----------
     The helper talks to the portal as a MAG box would: a browser can't send the box's User-Agent and MAC
     cookie.  Each channel's url is "stalker:<the box's command>", turned into a link at play time (streamUrl). */
  function stalkerMac(m) { m = String(m || '').trim().toUpperCase().replace(/-/g, ':'); if (/^[0-9A-F]{12}$/.test(m)) m = m.replace(/(..)(?!$)/g, '$1:'); return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m) ? m : ''; }
  function stb(p) {
    var o = { portal: String(p.portal || '').trim(), mac: stalkerMac(p.mac) };
    ['sn', 'id1', 'id2', 'sig'].forEach(function (k) { if (p[k]) o[k] = String(p[k]).trim(); });
    try { o.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { o.tz = 'UTC'; }
    return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function loadStalker(p) {
    var t0 = Date.now();
    if (!Net.port) return Promise.reject(Object.assign(new Error('A Stalker portal needs the network helper, which is not running.  Restart TiviBro, or set Connection to Automatic.'), { kind: 'helper' }));
    Log.info('stalker', 'Loading the portal\'s channels via the helper :' + Net.port + ' (MAC ' + String(stalkerMac(p.mac)).slice(0, 8) + ':**:**:**)');
    return viaHelper('/stalker/channels', { stb: stb(p) }).then(function (j) {
      if (j._status === 401) throw Object.assign(new Error('The portal turned this MAC address down: ' + (j.error || 'not allowed') + '.  Check the MAC address with your provider.'), { kind: 'auth' });
      if (j._status !== 200 || !Array.isArray(j.channels)) throw Object.assign(new Error(j.error ? 'The portal: ' + j.error : 'HTTP ' + j._status), { kind: 'http' });
      Log.info('stalker', 'The helper loaded ' + j.channels.length + ' channels in ' + j.groups.length + ' groups in ' + (Date.now() - t0) + 'ms');
      if (!j.channels.length) throw Object.assign(new Error('The portal answered but has no channels for this MAC address.'), { kind: 'parse' });
      return { groups: j.groups, channels: j.channels, epgUrl: '', _live: '' };
    });
  }

  function load1(p) {
    var job = p.type === 'stalker' ? loadStalker(p) : p.type === 'm3u' ? loadM3U(p) : loadXtream(p);
    return job.then(function (data) {
      // Remember the address that actually worked (and credentials taken from a pasted link).
      var q = Object.assign({}, p);
      if (data.server) q.server = data.server;
      if (data.user) { q.user = data.user; q.pass = data.pass; }
      if (data.m3u) q.m3u = data.m3u;
      data.fixed = q.server !== p.server || q.user !== p.user || q.pass !== p.pass || q.m3u !== p.m3u ? q : null;
      data.at = Date.now();
      data.sig = sig(q);
      return data;
    }).catch(function (e) {
      if (stopping || (e && e.kind === 'stopped')) throw stopped();
      var msg = friendly(e);
      var tried = e && e.tried && e.tried.length > 1 ? e.tried : null;
      Log.error(p.type === 'm3u' ? 'm3u' : p.type === 'stalker' ? 'stalker' : 'xc', 'Load failed: ' + msg + (e && e.kind ? '  [kind=' + e.kind + (e.status ? ' status=' + e.status : '') + ' via=' + e.via + ']' : '') + (tried ? '  tried: ' + tried.join(' | ') : ''));
      // Each attempt's answer goes with the message, so the set-up screen, the web editor and the phone app show it (issue #87).
      if (tried && e.kind !== 'auth') msg = 'Tried both http and https.  ' + msg + (e.each && e.each.length > 1 ? '  What each one said: ' + e.each.join('  ') : '');
      throw Object.assign(new Error(msg), { kind: e && e.kind, tried: e && e.tried, each: e && e.each });
    });
  }
  // One readable sentence per failure type, shown on screen; the log keeps the details.
  function friendly(e) {
    if (!e) return 'Unknown error';
    if (e.kind === 'auth' || e.kind === 'notxc' || e.kind === 'toobig' || e.kind === 'parse' && !e.body) return e.message;
    if (e.kind === 'timeout') return 'The server took too long to answer.  ' + (e.via === 'helper' ? 'It may be overloaded or blocking this TV.' : '');
    if (e.kind === 'network') return e.via === 'helper'
      ? 'The network helper stopped responding.  Restart the app; if it keeps happening, see Settings > Updates, about and diagnostics.'
      : (Net.state === 'off' ? 'Could not reach the server.  The network helper is not running, so this only works if the provider allows app requests (CORS).  Run the connection test for details.'
        : 'Could not reach the server, or it does not allow app requests.  Set Settings > Playback > Connection to Automatic, or run the connection test.');
    if (e.kind === 'http') {
      if (/^helper: /.test(e.message)) {
        var m = e.message;
        if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'The server name could not be found (DNS).  Check the address.';
        if (/ECONNREFUSED/.test(m)) return 'The server refused the connection.  Check the address and port.';
        if (/ETIMEDOUT|timeout/i.test(m)) return 'The server did not answer in time.';
        // A plain http port asked for https: not a certificate problem (issue #87).
        if (mismatch(e)) return 'This port doesn\'t use https (it answered in plain http).  Try http:// instead of https://.';
        if (/CERT|SSL|TLS|certificate/i.test(m)) return 'Secure connection failed (certificate problem).  Try http:// instead of https://.';
        if (/ECONNRESET|socket hang up/i.test(m)) return 'The server dropped the connection.  It may be blocking this TV or overloaded.';
        return 'Connection failed: ' + m.replace(/^helper: /, '');
      }
      if (e.status === 401 || e.status === 403) return 'The server refused access (HTTP ' + e.status + ').  Check the username and password, or whether the provider blocks this IP.';
      if (e.status === 404) return 'Not found (HTTP 404).  Check the server address and port.';
      if (e.status === 512 || e.status === 884) return 'The provider rejected this login (HTTP ' + e.status + ').';
      return 'The server returned an error (' + e.message + ').';
    }
    if (e.kind === 'parse') return e.message;
    return e.message || String(e);
  }

  function sig(p) { return U.hash([p.id, p.type, p.server, p.user, p.pass, p.m3u].concat(p.type === 'stalker' ? [p.portal, p.mac, p.sn] : []).join('|')); }

  function cred(p) { return encodeURIComponent(p.user) + '/' + encodeURIComponent(p.pass); }
  /* Every channel plays from its own playlist's server and login (Store.plOf: with several playlists on,
     the other playlists' channels carry their playlist's id). */
  function streamUrl(ch, fmt) {
    if (ch.url && ch.url.indexOf('stalker:') === 0) {
      // The portal makes a link when the channel starts (create_link): the helper asks, then sends the player on.
      var cmd = ch.url.slice(8), ext = (/\.(m3u8|ts|mp4|mkv)(\?|$|\s)/i.exec(cmd) || [])[1] || 'ts';
      return 'http://127.0.0.1:' + Net.port + '/stalker/play/' + String(ch.sid || ch.id).replace(/[^A-Za-z0-9_-]/g, '') + '.' + ext.toLowerCase() + '?stb=' + stb(Store.plOf(ch)) + '&cmd=' + encodeURIComponent(cmd);
    }
    if (ch.url) return ch.url;
    var p = Store.plOf(ch);
    return base(p.server) + '/live/' + cred(p) + '/' + ch.id + '.' + (fmt || 'ts');
  }
  function shortEpgUrl(ch, limit) {
    var sp = Store.plOf(ch);
    if (sp && sp.type === 'stalker') return 'http://127.0.0.1:' + Net.port + '/stalker/epg?stb=' + stb(sp) + '&ch=' + encodeURIComponent(ch.sid || '') + '&limit=' + (limit || 6);
    return api(Store.plOf(ch), 'get_short_epg', '&stream_id=' + ch.id + '&limit=' + (limit || 6));
  }

  /* ---------- catch-up ---------- */
  // Xtream wants the start time written in the server's own time zone (each playlist's server its own).
  var serverTz = '', tzs = {};
  function setTz(tz, id) { if (id) tzs[id] = tz || ''; else serverTz = tz || ''; }
  function parts(ms, tz) {
    var d = new Date(ms);
    if (tz && typeof Intl !== 'undefined') {
      try {
        var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        var o = {};
        f.formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
        return { Y: o.year, m: o.month, d: o.day, H: o.hour === '24' ? '00' : o.hour, M: o.minute, S: o.second };
      } catch (e) {}
    }
    return { Y: '' + d.getFullYear(), m: U.pad(d.getMonth() + 1), d: U.pad(d.getDate()), H: U.pad(d.getHours()), M: U.pad(d.getMinutes()), S: U.pad(d.getSeconds()) };
  }
  // start/end in ms.  Returns a URL or '' when the channel has no archive.
  function catchupUrl(ch, start, end) {
    if (!ch.arch) return '';
    var mins = Math.max(1, Math.ceil((end - start) / 60000));
    // A Stalker portal's archive: the helper finds the programme at that time and asks the portal for its link.
    if (ch.url && ch.url.indexOf('stalker:') === 0) return 'http://127.0.0.1:' + Net.port + '/stalker/archive/' + String(ch.sid || '').replace(/[^A-Za-z0-9_-]/g, '') + '.ts?stb=' + stb(Store.plOf(ch)) + '&start=' + Math.floor(start / 1000) + '&end=' + Math.floor(end / 1000);
    if (!ch.url) {
      var p = Store.plOf(ch), t = parts(start, ch.p ? tzs[ch.p] || '' : serverTz);
      return base(p.server) + '/timeshift/' + cred(p) + '/' + mins + '/' + t.Y + '-' + t.m + '-' + t.d + ':' + t.H + '-' + t.M + '/' + ch.id + '.ts';
    }
    var utc = Math.floor(start / 1000), utcend = Math.floor(end / 1000), now = Math.floor(Date.now() / 1000), lt = parts(start, '');
    var fill = function (tpl) {
      return tpl.replace(/\$?\{(utc|start|timestamp)\}/g, utc).replace(/\$?\{(utcend|end)\}/g, utcend).replace(/\$?\{(lutc|now)\}/g, now)
        .replace(/\$?\{(duration)\}/g, utcend - utc).replace(/\$?\{offset\}/g, now - utc)
        .replace(/\{Y\}/g, lt.Y).replace(/\{m\}/g, lt.m).replace(/\{d\}/g, lt.d).replace(/\{H\}/g, lt.H).replace(/\{M\}/g, lt.M).replace(/\{S\}/g, lt.S)
        .replace(/\{utc:([^}]+)\}/g, function (a, f) { return f.replace('YmdHMS', lt.Y + lt.m + lt.d + lt.H + lt.M + lt.S); });
    };
    var type = (ch.cu || '').toLowerCase();
    if (ch.cus) return type === 'append' ? ch.url + fill(ch.cus) : fill(ch.cus);
    if (type === 'flussonic' || type === 'fs') {
      return /\.m3u8/.test(ch.url) ? ch.url.replace(/[^/]*\.m3u8.*$/, 'archive-' + utc + '-' + (utcend - utc) + '.m3u8')
        : ch.url.replace(/\/[^/]*$/, '/timeshift_abs-' + utc + '.ts');
    }
    return ch.url + (ch.url.indexOf('?') < 0 ? '?' : '&') + 'utc=' + utc + '&lutc=' + now;   // "shift"
  }

  /* ---------- VOD (Xtream) ----------
     p: the playlist the title is from (several playlists on, Vod passes it); the first playlist when not given. */
  function P(p) { return p || Store.playlist; }
  function vodCats(kind, p) { return U.getJSON(api(P(p), kind === 'series' ? 'get_series_categories' : 'get_vod_categories'), 30000); }
  function vodList(kind, p) { return U.getJSON(api(P(p), kind === 'series' ? 'get_series' : 'get_vod_streams'), 90000); }
  /* An M3U playlist's movies and shows are kept by the network helper (service/vod.js): it answers a show's
     episodes in the shape of Xtream's get_series_info, with each episode's link, and a movie's link. */
  function m3uVod(p) { p = P(p); return p && p.type === 'm3u' && p.vod && p.vod.m3u; }
  function helperVod(op, id, p) {
    if (!(Net.active && Net.port)) return Promise.reject(new Error('Movies and shows from an M3U list need the network helper.'));
    return viaHelper('/vod/m3u', { pl: P(p).id, op: op, id: String(id) }).then(function (j) {
      if (j._status !== 200) throw new Error(j.error || 'HTTP ' + j._status);
      return j;
    });
  }
  function vodInfo(id, p) { return m3uVod(p) ? Promise.resolve({ info: {} }) : U.getJSON(api(P(p), 'get_vod_info', '&vod_id=' + id), 15000); }
  function seriesInfo(id, p) { return m3uVod(p) ? helperVod('series', id, p) : U.getJSON(api(P(p), 'get_series_info', '&series_id=' + id), 20000); }
  // The link to play a movie: built from the login, or for an M3U list the one the list gave.
  function movieLink(id, ext, p) { return m3uVod(p) ? helperVod('url', id, p).then(function (j) { return j.url; }) : Promise.resolve(movieUrl(id, ext, p)); }
  function stalkerVod(id, ext, p) { return 'http://127.0.0.1:' + Net.port + '/stalker/vod/' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.' + (ext || 'mp4') + '?stb=' + stb(p); }
  function movieUrl(id, ext, p) { p = P(p); if (p.type === 'stalker') return stalkerVod(id, ext, p); return base(p.server) + '/movie/' + cred(p) + '/' + id + '.' + (ext || 'mp4'); }
  function episodeUrl(id, ext, p) { p = P(p); if (p.type === 'stalker') return stalkerVod(id, ext, p); return base(p.server) + '/series/' + cred(p) + '/' + id + '.' + (ext || 'mp4'); }

  return { get account() { return account; }, load: load, busy: busy, stop: stop, get loading() { return Object.keys(running).length > 0; }, sig: sig, friendly: friendly, api: api, base: base, clean: clean, candidates: candidates, detect: detect, credsFromLink: credsFromLink, userShape: userShape, panelHost: panelHost, streamUrl: streamUrl, shortEpgUrl: shortEpgUrl, parseM3U: parseM3U, stalkerMac: stalkerMac,
    catchupUrl: catchupUrl, setTz: setTz,
    vodCats: vodCats, vodList: vodList, vodInfo: vodInfo, seriesInfo: seriesInfo, movieUrl: movieUrl, movieLink: movieLink, episodeUrl: episodeUrl, m3uVod: m3uVod };
})();
