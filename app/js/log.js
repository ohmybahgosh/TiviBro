/* Logging.  Everything that can go wrong on the way to a picture is written here:
   helper start-up, every provider request (status, time, size, error type), login
   details, player engine choices and failures, guide loading.
   - Kept in memory (last 800 lines) and saved (last 300) so a previous session can be read
     after a restart.
   - Shown in Settings > Diagnostics (and from the setup screen), and mirrored to the
     console for `ares-inspect`.
   - Credentials are masked before anything is stored or shown. */
var TIVIBRO_VERSION = '0.6.0';
var Log = (function () {
  'use strict';
  var buf = [], MAX = 800, KEEP = 300, saved = [];
  var verbose = localStorage.getItem('tivibro.logVerbose') === '1';
  var session = Date.now().toString(36);

  // Mask credentials in URLs and messages.
  function redact(s) {
    s = String(s == null ? '' : s);
    return s
      .replace(/((?:[a-z0-9-]+\.)*energycdn\.com(?::[0-9]+)?)[/?][^\s\"'<>\\]*/gi, '$1/***')
      .replace(/((?:password|pass|pwd|api_key|access_token)=)[^&\s"']*/gi, '$1***')
      .replace(/(username=)([^&\s"']{0,2})[^&\s"']*/gi, '$1$2***')
      .replace(/\/(live|movie|series|timeshift)\/([^/\s]{0,2})[^/\s]*\/[^/\s]+\//gi, '/$1/$2***/***/');
  }
  function fmt(d) {
    if (d == null) return '';
    if (d instanceof Error) return d.name + ': ' + d.message + (d.kind ? ' [' + d.kind + ']' : '');
    if (typeof d === 'object') { try { return JSON.stringify(d); } catch (e) { return String(d); } }
    return String(d);
  }

  function persistNow() { try { localStorage.setItem('tivibro.log', JSON.stringify(saved.concat(buf).slice(-KEEP))); } catch (e) {} }
  var persist = U.debounce(persistNow, 1500);

  /* Did TiviBro close on its own?  webOS ends an app that runs out of memory without a word, so no
     error is ever logged.  A marker in storage says the app is open and what it is doing (state():
     loading the guide from where, playing what) and how much memory it uses, updated as that
     changes and every 15 s; going to the background or exiting marks it closed.  If the next start
     finds it still open, the last session ended unexpectedly, and the marker says while doing what. */
  var MARK = 'tivibro.alive', doing = {}, lastMark = 0, started = Date.now(), prevRun = null, unclean = null, bootAt = 0, settled = false;
  try { prevRun = JSON.parse(localStorage.getItem(MARK) || 'null'); } catch (e) {}
  function heapMB() { try { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0; } catch (e) { return 0; } }
  function mark(open) {
    lastMark = Date.now();
    try { localStorage.setItem(MARK, JSON.stringify({ s: session, v: TIVIBRO_VERSION, t0: started, t: lastMark, open: open !== false, doing: doing, heap: heapMB(), boot: bootAt })); } catch (e) {}
  }
  function state(key, text) {
    text = text ? redact(String(text)).slice(0, 160) : '';
    if ((doing[key] || '') === text) return;
    if (text) doing[key] = text; else delete doing[key];
    if (Date.now() - lastMark > 2000 || !text) mark(); else { clearTimeout(state.t); state.t = setTimeout(mark, 2000); }
  }
  function describe(run) {
    var d = run.doing || {}, what = Object.keys(d).map(function (k) { return d[k]; }).join('; ');
    return (what ? 'while ' + what : 'doing nothing in particular') + (run.heap ? ', using ' + run.heap + ' MB' : '') +
      ', ' + Math.round((run.t - run.t0) / 1000) + ' s after it started (' + (run.v || '?') + ')';
  }

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
    // Warnings and errors are saved at once: the app may be closed a moment later.
    if (lv === 'warn' || lv === 'error') persistNow(); else if (lv !== 'debug') persist();
  }

  // Previous sessions, read once at start.
  try { saved = (JSON.parse(localStorage.getItem('tivibro.log') || '[]') || []).filter(function (x) { return x && x.t; }); } catch (e) { saved = []; }
  /* The last session was still open when it ended.  Before calling that a crash, rule out the TV
     going off or restarting, and an update (settle(), once the helper has said when the TV started and
     whether it went to standby).  Then say so in this session's log (reports carry it) and keep a
     short history, so several in a row show up as a loop. */
  function settle(sys) {
    if (settled) return unclean;
    settled = true;
    if (sys && sys.bootAt) bootAt = sys.bootAt;
    mark(!document.hidden);
    var run = prevRun;
    if (!run || !run.open || run.s === session) return null;
    var why = '';
    if (run.v && run.v !== TIVIBRO_VERSION) why = 'TiviBro was updated';
    else if (sys && run.boot && Math.abs(sys.bootAt - run.boot) > 120000) why = 'the TV restarted';
    else if (sys && (sys.power || []).some(function (p) { return p.t >= (run.t || 0) - 20000; })) why = 'the TV was turned off';
    if (why) { add('info', 'app', 'The last session ended when ' + why + ', ' + describe(run)); return null; }
    var hist = []; try { hist = JSON.parse(localStorage.getItem('tivibro.crashes') || '[]') || []; } catch (e) {}
    hist = hist.filter(function (t) { return Date.now() - t < 3600e3; }); hist.push(run.t || Date.now());
    try { localStorage.setItem('tivibro.crashes', JSON.stringify(hist.slice(-10))); } catch (e) {}
    unclean = { s: run.s, at: run.t, text: describe(run), doing: run.doing || {}, heap: run.heap || 0, recent: hist.length, checked: !!sys };
    add('error', 'app', 'TiviBro closed unexpectedly last time, ' + unclean.text + (hist.length > 1 ? '.  ' + hist.length + ' times in the last hour.' : '.'));
    return unclean;
  }
  mark(true);
  setInterval(function () { if (!document.hidden) mark(true); }, 15000);
  document.addEventListener('visibilitychange', function () { mark(!document.hidden); persistNow(); });
  window.addEventListener('pagehide', function () { mark(false); persistNow(); });

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
    get count() { return buf.length; },
    // What the app is doing, kept for the next start if TiviBro closes unexpectedly: state('guide', 'loading ...'), state('guide', '') when done.
    state: state,
    // Closing on purpose (Back twice, the update installer): not a crash.
    closing: function () { mark(false); persistNow(); },
    // The last session ended unexpectedly: { text, doing, heap, at, recent (how many in the last hour) } or null.
    get unclean() { return unclean; },
    // Decide about the last session once the helper answered (sys: its /ping sys, or null without it).
    settle: settle,
    // The last earlier session's uncaught error, if it had one: { s: session, m: message }.
    get lastCrash() { var last = saved.length ? saved[saved.length - 1].s : null, hit = null; saved.forEach(function (e) { if (e.s === last && e.lv === 'error' && /^(Uncaught|Unhandled)/.test(e.m)) hit = e; }); return hit; }
  };
})();
