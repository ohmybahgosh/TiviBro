/* Logging.  Everything that can go wrong on the way to a picture is written here:
   helper start-up, every provider request (status, time, size, error type), login
   details, player engine choices and failures, guide loading.
   - Kept in memory (last 800 lines) and saved (last 300) so a previous session can be read
     after a restart.
   - Shown in Settings > Diagnostics (and from the setup screen), and mirrored to the
     console for `ares-inspect`.
   - Credentials are masked before anything is stored or shown. */
var TIVIBRO_VERSION = '0.5.0';
var Log = (function () {
  'use strict';
  var buf = [], MAX = 800, KEEP = 300, saved = [];
  var verbose = localStorage.getItem('tivibro.logVerbose') === '1';
  var session = Date.now().toString(36);

  // Mask credentials in URLs and messages.
  function redact(s) {
    s = String(s == null ? '' : s);
    return s
      .replace(/((?:password|pass|pwd)=)[^&\s"']*/gi, '$1***')
      .replace(/(username=)([^&\s"']{0,2})[^&\s"']*/gi, '$1$2***')
      .replace(/\/(live|movie|series|timeshift)\/([^/\s]{0,2})[^/\s]*\/[^/\s]+\//gi, '/$1/$2***/***/');
  }
  function fmt(d) {
    if (d == null) return '';
    if (d instanceof Error) return d.name + ': ' + d.message + (d.kind ? ' [' + d.kind + ']' : '');
    if (typeof d === 'object') { try { return JSON.stringify(d); } catch (e) { return String(d); } }
    return String(d);
  }

  var persist = U.debounce(function () {
    try { localStorage.setItem('tivibro.log', JSON.stringify(saved.concat(buf).slice(-KEEP))); } catch (e) {}
  }, 1500);

  /* Development log sink: when a log receiver answers on 127.0.0.1:47812 (scripts/logsink.js,
     started by `npm run sim` / `npm run serve`), every line, including debug lines and key
     presses, is also written to logs/latest.log on the computer.  On a TV nothing listens
     there, so after one refused connection at start-up this stays off. */
  var SINK = 'http://127.0.0.1:47812', sinkOn = false, sinkQ = [];
  function sinkSend() {
    if (!sinkOn || !sinkQ.length) return;
    var body = sinkQ.join('\n'); sinkQ = [];
    fetch(SINK + '/log', { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
  }
  function sinkStart() {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 1000);
    fetch(SINK + '/ping', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(to);
      if (!j || !j.tivibroSink) return;
      sinkOn = true;
      sinkQ.unshift('==== TiviBro ' + TIVIBRO_VERSION + ' session ' + session + '  ' + new Date().toString() + '  ' + navigator.userAgent);
      buf.forEach(function (e) { sinkQ.push(line(e)); });
      setInterval(sinkSend, 1000);
      window.addEventListener('beforeunload', sinkSend);
      add('info', 'log', 'Writing log to the development log file');
    }).catch(function () { clearTimeout(to); });
  }

  function add(lv, cat, msg, data) {
    if (lv === 'debug' && !verbose && !sinkOn) return;
    var e = { t: Date.now(), lv: lv, c: cat, m: redact(msg + (data != null ? '  ' + fmt(data) : '')).slice(0, 1200), s: session };
    if (sinkOn) sinkQ.push(line(e));
    if (lv === 'debug' && !verbose) return;      // sink-only: keep the on-screen log readable
    buf.push(e);
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    if (window.console) (lv === 'error' ? console.error : lv === 'warn' ? console.warn : console.log)('[tivibro:' + cat + '] ' + e.m);
    if (lv !== 'debug') persist();
  }

  // Previous sessions, read once at start.
  try { saved = (JSON.parse(localStorage.getItem('tivibro.log') || '[]') || []).filter(function (x) { return x && x.t; }); } catch (e) { saved = []; }

  window.addEventListener('error', function (ev) {
    add('error', 'app', 'Uncaught: ' + (ev.message || 'error') + ' at ' + (ev.filename || '').split('/').pop() + ':' + ev.lineno);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    add('error', 'app', 'Unhandled promise rejection: ' + fmt(r));
  });

  function line(e) {
    var d = new Date(e.t);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds()) + '  ' +
      (e.lv === 'error' ? 'ERROR ' : e.lv === 'warn' ? 'WARN  ' : e.lv === 'debug' ? 'debug ' : '      ') + e.c + '  ' + e.m;
  }

  setTimeout(sinkStart, 0);

  return {
    get sinking() { return sinkOn; },
    debug: function (c, m, d) { add('debug', c, m, d); },
    info: function (c, m, d) { add('info', c, m, d); },
    warn: function (c, m, d) { add('warn', c, m, d); },
    error: function (c, m, d) { add('error', c, m, d); },
    redact: redact,
    // This session first-class; earlier sessions available on request.
    lines: function (withPrevious) {
      var all = (withPrevious ? saved : []).concat(buf), out = [], last = null;
      all.forEach(function (e) {
        if (e.s !== last) { out.push('──── session started ' + new Date(e.t).toLocaleString() + ' ────'); last = e.s; }
        out.push(line(e));
      });
      return out;
    },
    clear: function () { buf = []; saved = []; try { localStorage.removeItem('tivibro.log'); } catch (e) {} },
    get verbose() { return verbose; },
    set verbose(v) { verbose = !!v; localStorage.setItem('tivibro.logVerbose', v ? '1' : '0'); },
    get count() { return buf.length; }
  };
})();
