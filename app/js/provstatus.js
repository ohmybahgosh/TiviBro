/* Provider status: is it the provider, or TiviBro?  Every request TiviBro makes is noted here (U.request, and
   the player's streams): those to a playlist's own server count for that provider, any other answer (the guide
   sites, GitHub, logos) shows the TV's internet works.  When a provider's server keeps failing, a minute or more
   with nothing from it going through, TiviBro says so once, in plain words: what the error means, that the TV's
   internet is fine, and a short message to send the provider.  Settings > Updates, about and diagnostics >
   Provider status has the same, any time, with a Check now.
   What happened to a provider: ProvStatus.of(host) -> { state, since, codes, last, text, tell } or null. */
var ProvStatus = (function () {
  'use strict';
  var W = 3 * 60000;                   // what counts as now
  var hosts = {}, otherOk = 0, told = {}, listeners = [];
  function hostOf(u) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase().replace(/^[^@]*@/, '') : ''; }
  // The hosts of the playlists that are on (their own servers; an M3U's too).
  function providers() {
    var out = {};
    ((typeof Store !== 'undefined' && Store.loaded ? Store.loaded() : []) || []).forEach(function (p) {
      [p.server, p.m3u, p.url].forEach(function (u) { var h = hostOf(u); if (h) out[h] = p; });
    });
    return out;
  }
  function H(h) { return hosts[h] || (hosts[h] = { ok: 0, fails: [], n: 0 }); }

  /* What an error means, and what to tell the provider.  code: an HTTP status, or a word for what went wrong
     on the way (dns, refused, timeout, tls, html). */
  var MEAN = {
    cf: ['Their server is offline behind Cloudflare', 'Cloudflare, which sits in front of their server, can\'t reach it (error %c).  Nothing on the TV or your internet can fix that.'],
    down: ['Their server is down or overloaded', 'Their server answers with an error (%c) instead of the channels or the guide.'],
    busy: ['Their server says it\'s busy', 'They answer "busy" (%c) even when nothing else is watching: the account\'s connection limit, or their server overloaded.'],
    auth: ['Your login is refused', 'They refuse the username and password (%c): the subscription may have ended, been suspended, or the login changed.'],
    gone: ['Channels are missing on their side', 'They answer "not found" (%c) for channels in their own list: their channel list and their streams don\'t match right now.'],
    dns: ['Their server address doesn\'t exist right now', 'The name of their server can\'t be looked up (%c).  They may have moved to a new address.'],
    refused: ['Their server refuses connections', 'Their server turns connections away (%c): it is down, or blocks your home\'s internet address.'],
    timeout: ['Their server doesn\'t answer', 'Their server takes too long to answer anything (%c).'],
    html: ['Their server answers with a web page', 'Instead of the channel data, their server sends a web page (%c): often a Cloudflare check or a blocked address.']
  };
  function classify(code) {
    var c = +code;
    if (c >= 520 && c <= 530) return 'cf';
    if (c === 401 || c === 403 || c === 884) return 'auth';
    if (c === 404 || c === 410) return 'gone';
    if (c === 429 || c === 456 || c === 458 || c === 509) return 'busy';
    if (c >= 500) return c === 503 ? 'busy' : 'down';
    if (/ENOTFOUND|EAI_AGAIN|dns/i.test(code)) return 'dns';
    if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|refused/i.test(code)) return 'refused';
    if (/timeout|ETIMEDOUT|quiet/i.test(code)) return 'timeout';
    if (/html/i.test(code)) return 'html';
    return '';
  }

  // A request's outcome.  ok: anything usable came back.  code: see classify.  kind: 'api' | 'stream' | 'guide'.
  function note(url, ok, code, kind) {
    var h = hostOf(url);
    // The helper's own address (a stream's link through it) is not the provider.
    if (!h || (typeof Net !== 'undefined' && Net.port && h === '127.0.0.1:' + Net.port)) return;
    var mine = providers()[h], t = Date.now();
    if (!mine) { if (ok) otherOk = t; return; }
    var x = H(h);
    if (ok) {
      if (x.fails.length && state(h) && told[h]) { told[h] = 0; emit(); }
      x.ok = t; x.fails = []; return;
    }
    var what = classify(code);
    if (!what) return;
    x.fails.push({ t: t, code: String(code), what: what, kind: kind || 'api' });
    if (x.fails.length > 40) x.fails.shift();
    check(h);
  }
  // Is it an outage?  Two minutes of failures with nothing going through, or six in a row of a kind that is
  // never the TV's fault (Cloudflare, login refused, server errors).  "Busy" answers on streams alone are a
  // channel change (the helper waits those out), not an outage.
  function state(h) {
    var x = hosts[h], t = Date.now();
    if (!x || !x.fails.length) return null;
    var f = x.fails.filter(function (e) { return t - e.t < W && e.t > x.ok; });
    if (!f.length) return null;
    var kinds = {}; f.forEach(function (e) { kinds[e.what] = (kinds[e.what] || 0) + 1; });
    var main = Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; })[0];
    if (main === 'busy' && f.every(function (e) { return e.kind === 'stream'; }) && f.length < 8) return null;
    if (main === 'gone' && f.every(function (e) { return e.kind === 'stream'; }) && f.length < 4) return null;     // one channel gone is that channel
    var span = f[f.length - 1].t - f[0].t, sure = { cf: 1, auth: 1, down: 1, dns: 1 };
    if (!(f.length >= 3 && (span > 60000 || (sure[main] && f.length >= 3) || f.length >= 6))) return null;
    var codes = []; f.forEach(function (e) { if (codes.indexOf(e.code) < 0) codes.push(e.code); });
    return { what: main, since: f[0].t, n: f.length, codes: codes, api: f.some(function (e) { return e.kind === 'api' || e.kind === 'guide'; }), streams: f.some(function (e) { return e.kind === 'stream'; }) };
  }
  function check(h) {
    var s = state(h);
    if (!s || (told[h] && Date.now() - told[h] < 30 * 60000)) return;
    told[h] = Date.now();
    var d = describe(h, s);
    if (typeof Log !== 'undefined') Log.warn('provider', d.title + ' (' + s.codes.join(', ') + ', ' + s.n + ' failed requests since ' + U.hhmm(s.since) + ')' + (d.netOk ? '; other sites answer, so the TV\'s internet works' : ''));
    if (typeof U !== 'undefined' && U.toast) U.toast(T('Your provider has a problem, not TiviBro:') + '  ' + d.title + '.  ' + T('Settings > Updates, about and diagnostics > Provider status says what to tell them.'), 12000);
    emit();
  }
  function T(s) { return typeof I18n !== 'undefined' && I18n.t ? I18n.t(s) : s; }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  // Plain words for a provider's trouble, and the message for them.
  function describe(h, s) {
    var m = MEAN[s.what] || MEAN.down, codeText = s.codes.slice(0, 4).map(function (c) { return /^\d+$/.test(c) ? 'HTTP ' + c : c; }).join(', ');
    var netOk = Date.now() - otherOk < W, acc = typeof Source !== 'undefined' && Source.account ? Source.account : null;
    var when = new Date(s.since), at = when.toLocaleDateString() + ' ' + U.hhmm(s.since);
    var tell = 'Hello.  Since ' + at + ' (' + (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '') + ') my TV app can\'t use my subscription: ' +
      (s.api && s.streams ? 'the channel list, guide and streams' : s.api ? 'the channel list and guide' : 'the streams') + ' fail with ' + codeText + ' from ' + h + '.  ' +
      ({ cf: 'Cloudflare reports it can\'t reach your origin server.  ', auth: 'The login is refused.  ', gone: 'Channels in your list answer "not found".  ', busy: 'The server answers "busy" even with nothing else playing on my account.  ' }[s.what] || '') +
      (netOk ? 'My internet connection works (other sites load fine).  ' : '') +
      (acc && acc.max ? 'My account shows ' + acc.active + ' of ' + acc.max + ' connections in use' + (acc.exp ? ', expiring ' + acc.exp : '') + '.  ' : '') + 'Can you check?';
    return { title: T(m[0]), text: T(m[1]).replace('%c', codeText), netOk: netOk, since: s.since, codes: s.codes, n: s.n, tell: tell };
  }
  // Every provider with trouble now: [{ host, title, text, tell, ... }].
  function now() {
    return Object.keys(providers()).map(function (h) { var s = state(h); if (!s) return null; var d = describe(h, s); d.host = h; return d; }).filter(Boolean);
  }
  /* Check now: ask each provider's server for its login page and something else on the internet, then say. */
  function checkNow() {
    var ps = providers(), list = Object.keys(ps);
    var probe = function (u) { return U.request(u, { timeout: 15000, text: true, label: 'provider check' }).promise.then(function () { return { ok: true }; }, function (e) { return { ok: false, code: e.status || (e.kind === 'timeout' ? 'timeout' : (e.message || '').match(/E[A-Z_]+/) ? (e.message || '').match(/E[A-Z_]+/)[0] : e.kind) }; }); };
    var other = probe('https://api.github.com/zen').then(function (r) { if (r.ok) otherOk = Date.now(); return r.ok; });
    return Promise.all(list.map(function (h) {
      var p = ps[h], base = String(p.server || p.m3u || p.url || '').replace(/\/+$/, '');
      var u = p.type === 'xtream' && p.user ? base + '/player_api.php?username=' + encodeURIComponent(p.user) + '&password=' + encodeURIComponent(p.pass || '') : base;
      return probe(u).then(function (r) { note(u, r.ok, r.code, 'api'); return { host: h, ok: r.ok, code: r.code }; });
    }).concat([other])).then(function (rs) { emit(); return { providers: rs.slice(0, -1), internet: rs[rs.length - 1] }; });
  }
  return { note: note, now: now, checkNow: checkNow, classify: classify, hostOf: hostOf, onChange: function (f) { listeners.push(f); },
    get otherOk() { return otherOk; }, _reset: function () { hosts = {}; told = {}; otherOk = 0; } };
})();
