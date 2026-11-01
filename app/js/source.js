/* Playlist loading.  Normalises Xtream Codes and M3U into one compact shape:
   channel = { k: stable key, id, n: raw name, g: group id, logo, num, epg, url, arch }
   Kept deliberately flat and short-keyed: a 20k channel list is a lot of objects on a TV. */
var Source = (function () {
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

  function base(server) {
    server = clean(server);
    if (server && !/^https?:\/\//i.test(server)) server = 'http://' + server;
    return server;
  }
  function api(p, action, extra) {
    return base(p.server) + '/player_api.php?username=' + encodeURIComponent(p.user) +
      '&password=' + encodeURIComponent(p.pass) + (action ? '&action=' + action : '') + (extra || '');
  }

  // Find the address that really answers as an Xtream panel: as typed first, then the other
  // scheme (http <-> https).  Wrong passwords stop the search; anything network-ish moves on.
  function detect(p, label) {
    var list = candidates(p.server), tried = [];
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
        if (e.kind === 'auth' || i + 1 >= list.length) { e.tried = tried; throw e; }
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
    Log.info('xc', 'Login to ' + clean(p.server) + ' as ' + p.user + ' (password ' + U.secretShape(p.pass) + ') via ' + (Net.active ? 'helper :' + Net.port : 'direct') + (hasScheme(clean(p.server)) ? '' : ' (no http/https given: trying both)'));
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
        ' server=' + (si.url || '?') + ':' + (si.port || '?') + ' https=' + (si.https_port || '-') + ' protocol=' + (si.server_protocol || '?') + ' tz=' + (si.timezone || '?') + ' (' + (Date.now() - t0) + 'ms)');
      if (String(ui.auth) !== '1') throw Object.assign(new Error('Login rejected.  Check the username and password.'), { kind: 'auth' });
      if (ui.status && ui.status !== 'Active') throw Object.assign(new Error('Account status is ' + ui.status + '.'), { kind: 'auth' });
      if (ui.exp_date && +ui.exp_date * 1000 < Date.now()) Log.warn('xc', 'Subscription expiry date is in the past');
      if (+ui.max_connections && +ui.active_cons >= +ui.max_connections) Log.warn('xc', 'All ' + ui.max_connections + ' connections are already in use; streams may be refused');
      var fmts = ui.allowed_output_formats || [];
      if (fmts.length && fmts.indexOf(Store.settings.format) < 0) Log.warn('xc', 'Provider does not list "' + Store.settings.format + '" as an allowed format (allows ' + fmts.join(', ') + ').  Change Stream format in Settings if channels fail.');
      return xtreamLists(p, t0)
        .then(function (shaped) {
          var groups = shaped.groups, chans = shaped.channels;
          return { server: found, user: p.user, pass: p.pass, groups: groups, channels: chans, epgUrl: base(p.server) + '/xmltv.php?username=' + encodeURIComponent(p.user) + '&password=' + encodeURIComponent(p.pass),
            tz: (info.server_info && info.server_info.timezone) || '',
            exp: info.user_info.exp_date ? +info.user_info.exp_date * 1000 : 0,
            maxConn: +info.user_info.max_connections || 0 };
        });
    });
  }

  var parseM3U = PlShape.parseM3U;

  /* On a TV the helper downloads and shapes the channel list (service/live.js), so the app never
     parses the provider's whole answer; if it can't, the app does it here as before. */
  function helperLive() { return !!(Net.active && Net.port && Net.info && Net.info.live >= 1); }
  function viaHelper(path, body) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 240000);
    return fetch('http://127.0.0.1:' + Net.port + path, { method: 'POST', cache: 'no-store', headers: Net.ctlHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { clearTimeout(t); j._status = r.status; return j; }); }, function (e) { clearTimeout(t); throw e; });
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
    return viaHelper('/live/xtream', { u: Net.wrap(api(p, 'get_live_streams')), uc: Net.wrap(api(p, 'get_live_categories')) }).then(function (j) {
      if (j._status !== 200 || !Array.isArray(j.channels)) throw new Error(j.error || 'HTTP ' + j._status);
      Log.info('xc', 'The helper loaded ' + j.cats + ' categories and ' + j.channels.length + ' channels in ' + (Date.now() - t0) + 'ms');
      return { groups: j.groups, channels: j.channels };
    }).catch(function (e) {
      Log.warn('xc', 'The helper could not load the channel list (' + (e && e.message || e) + '), loading it here');
      return direct();
    });
  }

  function loadM3U(p) {
    var t0 = Date.now(), raw = p.m3u.trim();
    var list = hasScheme(raw) ? [raw, swapScheme(raw)] : ['http://' + raw, 'https://' + raw], used = list[0];
    Log.info('m3u', 'Loading playlist ' + raw + ' via ' + (Net.active ? 'helper :' + Net.port : 'direct'));
    function fetchList(i) {
      used = list[i];
      if (helperLive()) {
        return viaHelper('/live/m3u', { u: Net.wrap(list[i]) }).then(function (j) {
          if (j._status === 422) return { notM3u: j.head || '' };
          if (j._status !== 200 || !Array.isArray(j.channels)) throw new Error(j.error || 'HTTP ' + j._status);
          return { shaped: j };
        }).catch(function (e) {
          Log.warn('m3u', 'The helper could not load ' + list[i] + ' (' + (e && e.message || e) + '), loading it here');
          return direct(i);
        });
      }
      return direct(i);
    }
    function direct(i) {
      return U.getText(list[i], 90000, 'playlist').catch(function (e) {
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
      d = { groups: d.groups, channels: d.channels, epgUrl: d.epgUrl || '' };
      Log.info('m3u', (t.shaped ? 'The helper parsed ' : 'Parsed ') + d.channels.length + ' channels in ' + d.groups.length + ' groups (' + Math.round(size / 1024) + ' KB, ' + (Date.now() - t0) + 'ms)' + (d.epgUrl ? '; guide address in playlist' : '; no guide address in playlist'));
      if (!d.channels.length) throw Object.assign(new Error('The playlist downloaded but has no channels in it.'), { kind: 'parse' });
      d.m3u = used;
      return d;
    });
  }

  function load(p) {
    var job = p.type === 'm3u' ? loadM3U(p) : loadXtream(p);
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
      var msg = friendly(e);
      var tried = e && e.tried && e.tried.length > 1 ? e.tried : null;
      Log.error(p.type === 'm3u' ? 'm3u' : 'xc', 'Load failed: ' + msg + (e && e.kind ? '  [kind=' + e.kind + (e.status ? ' status=' + e.status : '') + ' via=' + e.via + ']' : '') + (tried ? '  tried: ' + tried.join(' | ') : ''));
      if (tried && e.kind !== 'auth') msg = 'Tried both http and https.  ' + msg;
      throw Object.assign(new Error(msg), { kind: e && e.kind, tried: e && e.tried });
    });
  }
  // One readable sentence per failure type, shown on screen; the log keeps the details.
  function friendly(e) {
    if (!e) return 'Unknown error';
    if (e.kind === 'auth' || e.kind === 'notxc' || e.kind === 'parse' && !e.body) return e.message;
    if (e.kind === 'timeout') return 'The server took too long to answer.  ' + (e.via === 'helper' ? 'It may be overloaded or blocking this TV.' : '');
    if (e.kind === 'network') return e.via === 'helper'
      ? 'The network helper stopped responding.  Restart the app; if it keeps happening, see Settings > Diagnostics.'
      : (Net.state === 'off' ? 'Could not reach the server.  The network helper is not running, so this only works if the provider allows app requests (CORS).  Run the connection test for details.'
        : 'Could not reach the server, or it does not allow app requests.  Set Network to Automatic, or run the connection test.');
    if (e.kind === 'http') {
      if (/^helper: /.test(e.message)) {
        var m = e.message;
        if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'The server name could not be found (DNS).  Check the address.';
        if (/ECONNREFUSED/.test(m)) return 'The server refused the connection.  Check the address and port.';
        if (/ETIMEDOUT|timeout/i.test(m)) return 'The server did not answer in time.';
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

  function sig(p) { return U.hash([p.id, p.type, p.server, p.user, p.pass, p.m3u].join('|')); }

  function cred(p) { return encodeURIComponent(p.user) + '/' + encodeURIComponent(p.pass); }
  function streamUrl(ch, fmt) {
    if (ch.url) return ch.url;
    var p = Store.playlist;
    return base(p.server) + '/live/' + cred(p) + '/' + ch.id + '.' + (fmt || 'ts');
  }
  function shortEpgUrl(ch, limit) {
    return api(Store.playlist, 'get_short_epg', '&stream_id=' + ch.id + '&limit=' + (limit || 6));
  }

  /* ---------- catch-up ---------- */
  // Xtream wants the start time written in the server's own time zone.
  var serverTz = '';
  function setTz(tz) { serverTz = tz || ''; }
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
    if (!ch.url) {
      var p = Store.playlist, t = parts(start, serverTz);
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

  /* ---------- VOD (Xtream) ---------- */
  function vodCats(kind) { return U.getJSON(api(Store.playlist, kind === 'series' ? 'get_series_categories' : 'get_vod_categories'), 30000); }
  function vodList(kind) { return U.getJSON(api(Store.playlist, kind === 'series' ? 'get_series' : 'get_vod_streams'), 90000); }
  function vodInfo(id) { return U.getJSON(api(Store.playlist, 'get_vod_info', '&vod_id=' + id), 15000); }
  function seriesInfo(id) { return U.getJSON(api(Store.playlist, 'get_series_info', '&series_id=' + id), 20000); }
  function movieUrl(id, ext) { var p = Store.playlist; return base(p.server) + '/movie/' + cred(p) + '/' + id + '.' + (ext || 'mp4'); }
  function episodeUrl(id, ext) { var p = Store.playlist; return base(p.server) + '/series/' + cred(p) + '/' + id + '.' + (ext || 'mp4'); }

  return { load: load, sig: sig, friendly: friendly, api: api, base: base, clean: clean, candidates: candidates, detect: detect, credsFromLink: credsFromLink, streamUrl: streamUrl, shortEpgUrl: shortEpgUrl, parseM3U: parseM3U,
    catchupUrl: catchupUrl, setTz: setTz,
    vodCats: vodCats, vodList: vodList, vodInfo: vodInfo, seriesInfo: seriesInfo, movieUrl: movieUrl, episodeUrl: episodeUrl };
})();
