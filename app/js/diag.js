/* Diagnostics: a step-by-step connection test and a log viewer, usable from Settings and
   from the setup screen (before any playlist works).  Each step says what it tried, what
   came back, and how long it took, so a photo of the screen is enough to find the cause. */
var Diag = (function () {
  'use strict';
  var $ = U.$;
  var box = null, pre = null, title = null, lines = [], top = 0, VIS = 24, prevHandler = null, busy = false;

  function ensure() {
    if (box) return;
    box = U.el('div', 'diag hidden');
    title = U.el('div', 'diag-title');
    pre = U.el('div', 'diag-body');
    var hint = U.el('div', 'diag-hint', 'Up and down scroll    Channel +/− page    Back closes');
    box.appendChild(title); box.appendChild(pre); box.appendChild(hint);
    document.body.appendChild(box);
  }
  function draw() {
    top = U.clamp(top, 0, Math.max(0, lines.length - VIS));
    pre.innerHTML = '';
    lines.slice(top, top + VIS).forEach(function (l) {
      var d = U.el('div', 'dl' + (/^(✗|ERROR)|  ERROR /.test(l) ? ' bad' : /^(⚠|WARN)|  WARN /.test(l) ? ' warn' : /^✓/.test(l) ? ' good' : /^──/.test(l) ? ' sep' : ''), l);
      pre.appendChild(d);
    });
  }
  function show(t, ls, onRerun) {
    ensure();
    title.textContent = t;
    lines = ls; top = Math.max(0, ls.length - VIS);
    box.classList.remove('hidden');
    draw();
    if (!prevHandler) prevHandler = UI.getHandler();
    UI.setHandler(function (a) {
      if (a === 'up') { top--; draw(); }
      else if (a === 'down') { top++; draw(); }
      else if (a === 'chup' || a === 'left') { top -= VIS - 2; draw(); }
      else if (a === 'chdown' || a === 'right') { top += VIS - 2; draw(); }
      else if ((a === 'red' || a === 'ok') && onRerun && !busy) onRerun();
      else if (a === 'back') close();
      return true;
    });
  }
  function push(l) { lines.push(l); top = Math.max(0, lines.length - VIS); draw(); }
  function close() {
    if (!box) return;
    box.classList.add('hidden');
    if (prevHandler) { UI.setHandler(prevHandler); prevHandler = null; }
  }

  /* ---------- log viewer ---------- */
  function showLog(withPrevious) {
    var ls = Log.lines(withPrevious);
    if (!ls.length) ls = ['(nothing logged yet)'];
    show('App log' + (withPrevious ? ' (this and earlier sessions)' : ''), ls);
  }
  function showHelperLog() {
    Net.helperLog().then(function (j) {
      if (!j) return show('Helper log', ['The network helper is not running: ' + Net.status()]);
      var ls = ['Node ' + j.node + '   requests ' + j.stats.requests + '   errors ' + j.stats.errors + '   active ' + j.stats.active, ''];
      j.log.forEach(function (e) {
        var d = new Date(e.t), ts = U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds());
        if (e.event) ls.push(ts + '  ' + (e.lv === 'error' ? 'ERROR ' : '      ') + e.event + (e.port ? ' port ' + e.port : '') + (e.e ? '  ' + e.e : '') + (e.subscribers != null ? '  subscribers ' + e.subscribers : ''));
        else ls.push(ts + '  ' + (e.e ? 'ERROR ' : e.s >= 400 ? 'WARN  ' : '      ') + (e.s || '---') + '  ' + e.ms + 'ms  ' + Math.round((e.b || 0) / 1024) + 'KB  ' + e.u + (e.redirect ? '  → ' + e.redirect : '') + (e.e ? '  ' + e.e : '') + (e.aborted ? '  (closed by app)' : ''));
      });
      show('Helper log (last ' + j.log.length + ' requests)', ls);
    }).catch(function (e) { show('Helper log', ['Could not read the helper log: ' + e.message]); });
  }

  /* ---------- problem report ----------
     What "Report a problem" (in the web editor) shares: versions, the TV, a few settings, and the
     app and helper logs.  Never logins: the log already masks them, and here every provider and
     guide server's name becomes <provider> or <guide>, and tokens in links become ***. */
  function scrubber() {
    var hosts = [];
    function hostOf(u) { var m = /^(?:[a-z]+:\/\/)?(?:[^@/]*@)?([^/:?#\s]+)/i.exec(String(u || '').trim()); return m ? m[1].toLowerCase() : ''; }
    (Store.settings.playlists || []).forEach(function (p) {
      [p.server, p.m3u].forEach(function (u) { var h = hostOf(u); if (h) hosts.push([h, '<provider>']); });
      // The login itself, wherever it turns up (a link the log did not recognise, a message).
      [p.user, p.pass].forEach(function (x) { x = String(x || '').trim(); if (x.length >= 3) hosts.push([x, '***']); });
      (p.epgSources || []).forEach(function (x) { var h = hostOf(x.url); if (h) hosts.push([h, '<guide>']); });
    });
    hosts.sort(function (a, b) { return b[0].length - a[0].length; });
    // Any other server in a link, say one typed on the first screen and not saved yet, becomes <server>.
    // Kept: TiviBro's own sites, the logo projects, and addresses on this TV or the home network.
    var KEEP = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|(.*\.)?(tivibro\.app|github\.com|githubusercontent\.com|jsdelivr\.net|iptv-org\.github\.io)$)/i;
    return function (s) {
      s = Log.redact(s);
      hosts.forEach(function (h) { s = s.split(h[0]).join(h[1]); s = s.split(h[0].toUpperCase()).join(h[1]); });
      s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)(?:[^\/\s@]*@)?([^\/\s:'"?#<>]+)/gi, function (m, scheme, host) { return KEEP.test(host) ? m : scheme + '<server>'; });
      return s
        .replace(/((?:token|key|auth|sig|signature|hash|session|sid|user|username|u|p)=)[^&\s"']+/gi, '$1***')
        .replace(/\/\/([^/\s:@]+):([^/\s@]+)@/g, '//***:***@');
    };
  }
  function report() {
    var scrub = scrubber(), s = Store.settings, p = Store.playlist || {}, c = Caps.probe();
    var tv = (c.model || 'unknown model') + (c.year ? ' (' + c.year + ')' : '') + ', webOS ' + (c.webos || '?');
    var engine = (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1];
    var facts = [
      ['TiviBro', TIVIBRO_VERSION], ['TV', tv], ['Browser engine', engine ? 'Chromium ' + engine : navigator.userAgent.slice(0, 80)],
      ['Network', (s.network || 'auto') === 'direct' ? 'Direct' : 'Automatic (' + Net.status() + ')'],
      ['Playlist', (p.type === 'm3u' ? 'M3U' : 'Xtream Codes') + ', ' + Library.count() + ' channels, ' + (Store.settings.playlists || []).length + ' playlist(s)'],
      ['Guide', (p.epgSources || []).length + ' extra source(s), provider guide ' + (p.providerEpg || 'auto')],
      ['Public guide', (function () {
        var cf = PubEpg.conf(p), ps = Epg.pubStatus;
        if (!cf.on) return 'off';
        if (!ps || !ps.at) return 'on, not looked yet';
        if (ps.none) return 'on, ' + ps.none;
        return 'on, filled ' + ps.filled + ' of ' + ps.asked + ' (' + (ps.countries.join(', ') || 'no country') + ', ' + Math.round((ps.took || 0) / 1000) + ' s): ' + (ps.sources || []).map(function (r) { return r.url + ' ' + (r.ok ? r.filled : 'failed ' + r.error); }).join('; ');
      })()],
      ['Player', s.engine || 'auto'], ['Start screen', s.startTab || 'guide'],
      ['Detailed logging', Log.verbose ? 'on' : 'off']
    ];
    if (window.Player && Player.current) facts.push(['Playing', scrub([Player.media, Player.engine].filter(Boolean).join('  '))]);
    var app = Log.lines(true).map(scrub);
    var trouble = app.filter(function (l) { return /^\d\d:\d\d:\d\d  (ERROR|WARN)/.test(l); }).slice(-25);
    return Net.helperLog().then(function (j) {
      if (!j) return ['(the network helper is not running: ' + Net.status() + ')'];
      return ['Node ' + j.node + '   requests ' + j.stats.requests + '   errors ' + j.stats.errors].concat(j.log.slice(-150).map(function (e) {
        var d = new Date(e.t), ts = U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds());
        return scrub(ts + '  ' + (e.event ? e.event + (e.e ? '  ' + e.e : '') : (e.s || '---') + '  ' + e.ms + 'ms  ' + e.u + (e.e ? '  ' + e.e : '')));
      }));
    }, function (e) { return ['(could not read the helper log: ' + e.message + ')']; }).then(function (helper) {
      var text = '# TiviBro problem report, ' + new Date().toISOString() + '\n\n' + facts.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') +
        '\n\n## App log (this and earlier sessions)\n' + app.join('\n') + '\n\n## Network helper log (last requests)\n' + helper.join('\n') + '\n';
      Log.info('diag', 'Problem report made for the web editor (' + app.length + ' log lines)');
      return { repo: Update.REPO, version: TIVIBRO_VERSION, tv: tv, facts: facts, trouble: trouble, text: text };
    });
  }

  /* ---------- connection test ---------- */
  function ms(t0) { return (Date.now() - t0) + 'ms'; }
  function step(name, fn) {
    var t0 = Date.now();
    push('…  ' + name);
    return Promise.resolve().then(fn).then(function (r) {
      lines.pop();
      var res = r || {};
      push((res.warn ? '⚠  ' : '✓  ') + name + '  (' + ms(t0) + ')' + (res.msg ? ':  ' + res.msg : ''));
      (res.detail || []).forEach(function (d) { push('       ' + Log.redact(d)); });
      Log[res.warn ? 'warn' : 'info']('diag', name + ': ' + (res.msg || 'ok'));
      return res;
    }, function (e) {
      lines.pop();
      push('✗  ' + name + '  (' + ms(t0) + '):  ' + Source.friendly(e));
      var det = [];
      if (e && e.kind) det.push('type ' + e.kind + (e.status ? ', HTTP ' + e.status : '') + (e.via ? ', via ' + e.via : '') + (e.ctype ? ', ' + e.ctype : ''));
      if (e && e.message && Source.friendly(e) !== e.message) det.push('detail: ' + e.message);
      if (e && e.cause) det.push('browser said: ' + e.cause);
      if (e && e.body) det.push('server sent: ' + JSON.stringify(e.body.slice(0, 160)));
      if (e && e.tried && e.tried.length > 1) e.tried.forEach(function (t) { det.push('tried ' + t); });
      det.forEach(function (d) { push('       ' + Log.redact(d)); });
      Log.error('diag', name + ' failed: ' + (e && e.message), { kind: e && e.kind, status: e && e.status, via: e && e.via, body: e && e.body && e.body.slice(0, 200) });
      throw e;
    });
  }

  // Read the first bytes of a stream to prove it really flows, then hang up.
  function probeStream(url, seconds) {
    var real = Net.wrap(url), t0 = Date.now(), got = 0, first = null, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, firstMs = 0, reader = null;
    // Older TVs have no AbortController: cancelling the reader hangs up instead.
    function hangUp() { if (ctl) ctl.abort(); else if (reader) { try { reader.cancel(); } catch (e) {} } }
    var timer = setTimeout(hangUp, (seconds || 4) * 1000);
    return fetch(real, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' }).then(function (r) {
      var info = { status: r.status, ctype: r.headers.get('content-type') || '', final: Net.unwrap(r.url) };
      if (!r.ok) { clearTimeout(timer); hangUp(); return r.text().then(function (t) { throw Object.assign(new Error('HTTP ' + r.status), { kind: 'http', status: r.status, body: t.slice(0, 200), via: real !== url ? 'helper' : 'direct' }); }); }
      reader = r.body.getReader();
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) return;
          if (!first) { first = x.value.slice(0, 400); firstMs = Date.now() - t0; }
          got += x.value.length;
          if (got > 3e6) { hangUp(); return; }
          return pump();
        });
      }
      return pump().catch(function () {}).then(function () { clearTimeout(timer); info.bytes = got; info.first = first; info.firstMs = firstMs; info.secs = (Date.now() - t0) / 1000; return info; });
    }, function (e) {
      clearTimeout(timer);
      throw Object.assign(new Error(e && e.name === 'AbortError' ? 'No data within ' + (seconds || 4) + 's' : 'Stream unreachable'), { kind: e && e.name === 'AbortError' ? 'timeout' : 'network', via: real !== url ? 'helper' : 'direct', cause: e && e.message });
    });
  }
  function describeStream(i) {
    var b = i.first || new Uint8Array(0), kind = 'unknown data';
    var txt = ''; for (var k = 0; k < Math.min(b.length, 20); k++) txt += String.fromCharCode(b[k]);
    if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) kind = 'MPEG-TS (valid sync bytes)';
    else if (/^#EXTM3U/.test(txt)) kind = 'HLS playlist';
    else if (/ftyp/.test(txt)) kind = 'MP4';
    else if (/^\s*</.test(txt)) kind = 'a web page (not video)';
    var kbps = i.secs ? Math.round(i.bytes * 8 / 1000 / i.secs) : 0;
    return { kind: kind, kbps: kbps };
  }

  function run(p) {
    if (busy) return;
    busy = true;
    p = p || Store.playlist;
    var xc = p.type === 'xtream';
    show('Connection test: ' + (p.name || (xc ? p.user + ' @ ' + p.server : p.m3u)), [], function () { run(p); });
    push('TiviBro ' + (window.TIVIBRO_VERSION || '') + '   ' + navigator.userAgent.replace(/^.*?(Web0S|Chrome\/[\d.]+).*?(Chrome\/[\d.]+)?.*$/, '$1 $2'));
    push('Network setting: ' + (Store.settings.network || 'auto') + '   helper: ' + Net.status());
    push('');
    var ctx = {};
    var chain = step('Network helper', function () {
      if (Store.settings.network === 'direct') return { warn: true, msg: 'Network is set to Direct, so the helper is not used' };
      return Net.start(6000).then(function (port) {
        if (!port) throw Object.assign(new Error(Net.lastError || 'not running'), { kind: 'helper' });
        return fetch('http://127.0.0.1:' + port + '/ping').then(function (r) { return r.json(); }).then(function (j) {
          return { msg: 'running on port ' + port + ', Node ' + j.node, detail: ['so far: ' + j.stats.requests + ' requests, ' + j.stats.errors + ' errors'] };
        });
      });
    }).catch(function () { /* keep going: direct may still work */ });

    if (xc) {
      chain = chain.then(function () {
        return step('Server address', function () {
          var c = Source.candidates(p.server);
          if (!c.length) throw Object.assign(new Error('No server address entered'), { kind: 'auth' });
          var m = /^(https?):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?/.exec(c[0]);
          if (!m) throw Object.assign(new Error('"' + p.server + '" is not a web address'), { kind: 'auth' });
          var linked = Source.credsFromLink(p.server);
          if (linked && (!p.user || !p.pass)) { p = Object.assign({}, p, linked); }
          var det = ['host ' + m[2] + ', ' + (m[3] ? 'port ' + m[3] : 'no port given, so the standard one (80 for http, 443 for https)') + (m[4] && m[4] !== '/' ? ', path ' + m[4] : '')];
          det.push(/^https?:\/\//i.test(Source.clean(p.server)) ? 'will try ' + c[0] + ', then ' + c[1] + ' if that fails' : 'no http or https given, so trying ' + c[0] + ' then ' + c[1]);
          if (linked) det.push('a full link was pasted: using its username and password');
          return { msg: Source.clean(p.server) || p.server, detail: det };
        });
      }).then(function () {
        return step('Login (player_api.php)', function () {
          return Source.detect(p, 'diag-login').then(function (d) {
            ctx.tried = d.tried;
            p = Object.assign({}, p, { server: d.base });
            return d.info;
          }).then(function (info) {
            var ui = info && info.user_info, si = (info && info.server_info) || {};
            if (!ui) throw Object.assign(new Error('The server answered, but not like an Xtream Codes panel'), { kind: 'auth', body: JSON.stringify(info).slice(0, 200) });
            ctx.info = info;
            var d = ['auth ' + ui.auth + ', status ' + ui.status + ', expires ' + (ui.exp_date ? new Date(+ui.exp_date * 1000).toLocaleDateString() : 'never'),
              'connections in use ' + ui.active_cons + ' of ' + ui.max_connections + ', formats ' + JSON.stringify(ui.allowed_output_formats || []),
              'server reports ' + (si.url || '?') + ' port ' + (si.port || '?') + (si.https_port ? ', https ' + si.https_port : '') + ', ' + (si.server_protocol || '?') + ', time zone ' + (si.timezone || '?')];
            if (String(ui.auth) !== '1') throw Object.assign(new Error('Login rejected (auth=' + ui.auth + ').  Username ' + U.secretShape(p.user) + '; password ' + U.secretShape(p.pass) + '.  If these look right, try the same login in a desktop browser.'), { kind: 'auth' });
            var warn = ui.status !== 'Active' || (+ui.max_connections && +ui.active_cons >= +ui.max_connections) || (ui.exp_date && +ui.exp_date * 1000 < Date.now());
            if (warn) d.push(ui.status !== 'Active' ? 'Account is not active.' : (+ui.active_cons >= +ui.max_connections ? 'All connections are in use: streams may be refused until one is freed.' : 'Subscription has expired.'));
            d.unshift('address that works: ' + p.server + (ctx.tried && ctx.tried.length ? '   (did not work: ' + ctx.tried.map(function (x) { return x.split('  →  ')[0]; }).join(', ') + ')' : ''));
            if (si.server_protocol && p.server.indexOf(si.server_protocol + ':') !== 0) d.push('the panel prefers ' + si.server_protocol + (si.https_port ? ' on port ' + si.https_port : '') + ', but ' + p.server.split(':')[0] + ' works fine');
            return { warn: warn, msg: 'accepted', detail: d };
          });
        });
      }).then(function () {
        // Informational: does the provider itself allow app requests?
        if (!Net.active) return;
        return step('Direct access without helper (information only)', function () {
          return fetch(Source.api(p, ''), { cache: 'no-store' }).then(function () { return { msg: 'works too: this server allows app requests' }; },
            function () { return { warn: true, msg: 'blocked, as expected for most providers.  The helper is needed.' }; });
        });
      }).then(function () {
        return step('Channel categories', function () {
          return U.getJSON(Source.api(p, 'get_live_categories'), 30000, 'diag-cats').then(function (c) {
            if (!Array.isArray(c)) throw Object.assign(new Error('Not a list'), { kind: 'parse', body: JSON.stringify(c).slice(0, 200) });
            return { msg: c.length + ' categories' };
          });
        });
      }).then(function () {
        return step('Channel list', function () {
          var t0 = Date.now();
          return U.getJSON(Source.api(p, 'get_live_streams'), 90000, 'diag-streams').then(function (s) {
            if (!Array.isArray(s)) throw Object.assign(new Error('Not a list'), { kind: 'parse', body: JSON.stringify(s).slice(0, 200) });
            ctx.first = s[0];
            return { warn: !s.length, msg: s.length + ' channels in ' + ms(t0) };
          });
        });
      }).then(function () {
        if (!ctx.first) return;
        var ch = { id: ctx.first.stream_id, k: 'x' + ctx.first.stream_id };
        // Build the stream address for the playlist under test, not necessarily the active one.
        var url = Source.base(p.server) + '/live/' + encodeURIComponent(p.user) + '/' + encodeURIComponent(p.pass) + '/' + ch.id + '.' + Store.settings.format;
        return step('Stream test: ' + (ctx.first.name || 'first channel') + ' (' + Store.settings.format + ')', function () {
          return probeStream(url, 5).then(function (i) {
            var d = describeStream(i), det = ['HTTP ' + i.status + ', ' + (i.ctype || 'no content type') + ', first data after ' + i.firstMs + 'ms',
              'received ' + Math.round(i.bytes / 1024) + ' KB in ' + i.secs.toFixed(1) + 's (about ' + d.kbps + ' kbps), looks like ' + d.kind];
            if (i.final && i.final !== url) det.push('redirected to ' + i.final.replace(/^(https?:\/\/[^/]+).*/, '$1/…'));
            var warn = !i.bytes || d.kind === 'a web page (not video)' || d.kind === 'unknown data';
            if (!i.bytes) det.push('No video data arrived.  The channel may be offline, or the provider may refuse this format.');
            return { warn: warn, msg: i.bytes ? 'video is flowing' : 'connected but no data', detail: det };
          });
        }).catch(function () {});
      });
    } else {
      chain = chain.then(function () {
        return step('Playlist download', function () {
          var t0 = Date.now();
          return U.getText(p.m3u.trim(), 90000, 'diag-m3u').then(function (t) {
            var ok = t.indexOf('#EXTINF') >= 0;
            if (!ok) throw Object.assign(new Error('Not an M3U playlist'), { kind: 'parse', body: t.slice(0, 200) });
            var d = Source.parseM3U(t);
            ctx.first = d.channels[0]; ctx.epg = d.epgUrl;
            return { msg: d.channels.length + ' channels, ' + d.groups.length + ' groups, ' + Math.round(t.length / 1024) + ' KB in ' + ms(t0), detail: [d.epgUrl ? 'guide address in playlist: ' + d.epgUrl : 'no guide address in the playlist'] };
          });
        });
      }).then(function () {
        if (!ctx.first) return;
        return step('Stream test: ' + Names.clean(ctx.first.n), function () {
          return probeStream(ctx.first.url, 5).then(function (i) {
            var d = describeStream(i);
            return { warn: !i.bytes, msg: i.bytes ? 'video is flowing' : 'connected but no data', detail: ['HTTP ' + i.status + ', ' + (i.ctype || 'no content type') + ', ' + Math.round(i.bytes / 1024) + ' KB in ' + i.secs.toFixed(1) + 's (' + d.kbps + ' kbps), ' + d.kind] };
          });
        }).catch(function () {});
      });
    }

    // Guide sources: prove each one answers with XMLTV.
    chain = chain.then(function () {
      var srcs = (p.epgSources || []).map(function (s) { return s.url; });
      if (xc && p.providerEpg === 'xmltv') srcs.push(Source.base(p.server) + '/xmltv.php?username=' + encodeURIComponent(p.user) + '&password=' + encodeURIComponent(p.pass));
      if (!xc && p.providerEpg !== 'off' && ctx.epg) srcs.push(ctx.epg);
      var c = Promise.resolve();
      srcs.forEach(function (u, i) {
        c = c.then(function () {
          return step('Guide source ' + (i + 1), function () {
            return probeStream(u, 6).then(function (r) {
              var b = r.first || new Uint8Array(0), head = '';
              for (var k = 0; k < Math.min(b.length, 300); k++) head += String.fromCharCode(b[k]);
              var gz = b[0] === 0x1f && b[1] === 0x8b, xml = /<tv[\s>]|<\?xml/.test(head);
              return { warn: !(xml || gz), msg: gz ? 'compressed XMLTV (.gz)' : xml ? 'XMLTV' : 'not XMLTV', detail: ['HTTP ' + r.status + ', ' + Math.round(r.bytes / 1024) + ' KB read in ' + r.secs.toFixed(1) + 's', u] };
            });
          }).catch(function () {});
        });
      });
      return c;
    });

    // Public guides: can the TV reach the files it would use?
    chain = chain.then(function () {
      if (!PubEpg.conf(p).on) return;
      var ps = Epg.pubStatus, ccs = ps && ps.countries && ps.countries.length ? ps.countries : [PubEpg.code(Tidy.ccOfLocale(navigator.language)) || 'US'];
      var c = Promise.resolve();
      PubEpg.files(ccs.slice(0, 1), !!Net.active, true).forEach(function (f) {
        c = c.then(function () {
          return step('Public guide ' + f.name + ' ' + f.cc, function () {
            return probeStream(f.url, 4).then(function (r) {
              var b = r.first || new Uint8Array(0), gz = b[0] === 0x1f && b[1] === 0x8b;
              return { warn: r.status !== 200, msg: r.status === 200 ? 'reachable' + (gz ? ' (.gz)' : '') : 'HTTP ' + r.status, detail: ['HTTP ' + r.status + ', ' + Math.round(r.bytes / 1024) + ' KB read in ' + r.secs.toFixed(1) + 's', f.url] };
            });
          }).catch(function () {});
        });
      });
      if (!Net.active) c = c.then(function () { push('Public guide iptv-epg.org: skipped, it needs Settings > Playback > Network set to Automatic.'); });
      return c;
    });

    chain.catch(function () {}).then(function () {
      push('');
      push('Done.  OK or Red runs it again.  Settings > Diagnostics shows the full app and helper logs.');
      busy = false;
    });
  }

  /* ---------- speed test ----------
     1. Your internet: a download from Cloudflare's speed test service (only when you run this).
     2. Your provider: a movie downloads as fast as the line allows, so it shows the real speed to
        the provider's server; without movies, a live channel, which only arrives about as fast as
        it plays, so it shows whether the channel keeps up.
     Playback stops while it runs: many providers allow one connection at a time. */
  function measure(url, seconds, cap) {
    var real = Net.wrap(url), t0 = Date.now(), first = 0, got = 0, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, reader = null;
    function hangUp() { if (ctl) ctl.abort(); else if (reader) { try { reader.cancel(); } catch (e) {} } }
    var timer = setTimeout(hangUp, seconds * 1000);
    return fetch(real, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' }).then(function (r) {
      if (!r.ok) { clearTimeout(timer); hangUp(); throw new Error('HTTP ' + r.status); }
      reader = r.body.getReader();
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) return;
          if (!first) first = Date.now();
          got += x.value.length;
          if (got >= cap) { hangUp(); return; }
          return pump();
        });
      }
      return pump().catch(function () {}).then(function () {
        clearTimeout(timer);
        var end = Date.now(), secs = Math.max(0.2, (end - (first || end)) / 1000);
        if (!got) throw new Error('no data within ' + seconds + 's');
        return { bytes: got, secs: secs, mbps: got * 8 / secs / 1e6, firstMs: (first || end) - t0 };
      });
    }, function (e) { clearTimeout(timer); throw new Error(e && e.name === 'AbortError' ? 'no answer within ' + seconds + 's' : 'could not connect'); });
  }
  function verdict(m) {
    return m >= 25 ? 'enough for 4K' : m >= 10 ? 'enough for Full HD, maybe not 4K' : m >= 5 ? 'enough for HD; Full HD may buffer' : 'slow: expect buffering';
  }
  function speedTest() {
    if (busy) return;
    busy = true;
    var p = Store.playlist, xc = p.type === 'xtream', rows = [];
    show('Speed test', [], speedTest);
    if (Player.current) { try { Views.stopAll(); } catch (e) {} push('Playback stopped for the test (many providers allow one stream at a time).'); push(''); }
    push('What streams need:  4K about 25 Mbps,  Full HD 8 to 10,  HD about 5.');
    push('');
    push('… Your internet (Cloudflare speed test, about 8 seconds)');
    var chain = measure('https://speed.cloudflare.com/__down?bytes=50000000', 9, 50e6).then(function (r) {
      rows.push(['internet', r.mbps]);
      push((r.mbps >= 10 ? '✓ ' : '⚠ ') + 'Internet: ' + r.mbps.toFixed(1) + ' Mbps, ' + verdict(r.mbps) + '   (' + (r.bytes / 1e6).toFixed(1) + ' MB in ' + r.secs.toFixed(1) + 's)');
    }, function (e) { push('⚠ Internet: could not test (' + e.message + ').  Your network or the helper may block it; the provider test below still counts.'); });
    chain = chain.then(function () {
      push('');
      // A movie: the first category that has one.
      var movie = !xc || !(p.vod && p.vod.movies) ? Promise.resolve(null) : Source.vodCats('movie').then(function (cats) {
        cats = Array.isArray(cats) ? cats.slice(0, 3) : [];
        var i = 0;
        function next() {
          if (i >= cats.length) return null;
          return U.getJSON(Source.api(p, 'get_vod_streams', '&category_id=' + encodeURIComponent(cats[i++].category_id)), 20000).then(function (l) {
            return Array.isArray(l) && l.length ? l[0] : next();
          }, next);
        }
        return next();
      }).catch(function () { return null; });
      return movie.then(function (m) {
        if (m) {
          push('… Your provider: downloading part of a movie (about 10 seconds)');
          return measure(Source.movieUrl(m.stream_id, m.container_extension), 11, 80e6).then(function (r) {
            rows.push(['provider', r.mbps]);
            push((r.mbps >= 10 ? '✓ ' : '⚠ ') + 'Provider: ' + r.mbps.toFixed(1) + ' Mbps, ' + verdict(r.mbps) + '   (first data after ' + r.firstMs + 'ms)');
          });
        }
        var c = Store.edits.last && Library.find(Store.edits.last) || Library.channels(Library.ALL)[0] || Library.data.channels[0];
        if (!c) { push('⚠ Provider: no channel to test with.'); return; }
        push('… Your provider: playing ' + Library.name(c) + ' for 8 seconds');
        return measure(Source.streamUrl(c), 8, 40e6).then(function (r) {
          rows.push(['live', r.mbps]);
          push('✓ Live channel: ' + r.mbps.toFixed(1) + ' Mbps, first data after ' + r.firstMs + 'ms.');
          push('   A live channel arrives about as fast as it plays, so this is the channel\'s own rate, not your full speed.');
          push('   ' + (r.mbps >= 4 ? 'It keeps up.' : 'Low: this channel may be SD, or the provider is busy right now.'));
        });
      }).catch(function (e) { push('✗ Provider: ' + e.message + '.  The connection test (Settings > Diagnostics) shows why.'); });
    }).then(function () {
      var net = rows.filter(function (r) { return r[0] === 'internet'; })[0], prov = rows.filter(function (r) { return r[0] === 'provider'; })[0];
      push('');
      if (net && prov && prov[1] < net[1] * 0.4 && prov[1] < 15) push('⚠ Your internet is fast but the provider is slow to you.  That is the provider\'s server or its route; a bigger buffer profile (Settings > Playback) helps.');
      else if (net && net[1] < 10) push('⚠ Your internet is the limit.  Wired Ethernet, or moving the router closer, usually helps more than any setting.');
      else if (rows.length) push('If channels still buffer, try Settings > Playback > Buffer profile: Smooth or Rock solid.');
      Log.info('diag', 'Speed test: ' + rows.map(function (r) { return r[0] + ' ' + r[1].toFixed(1) + ' Mbps'; }).join(', '));
      push('');
      push('Done.  OK or Red runs it again.');
      busy = false;
    });
  }

  return { report: report, run: run, speedTest: speedTest, showLog: showLog, showHelperLog: showHelperLog, close: close, get open() { return box && !box.classList.contains('hidden'); } };
})();
