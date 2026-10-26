/* Shared helpers.  Plain ES2018 so it runs on webOS 6 / Chromium 79 and up. */
var U = (function () {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BKSP: 8,
    CH_UP: 33, CH_DOWN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, INFO: 457
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function debounce(fn, ms) {
    var t = 0;
    var d = function () {
      var a = arguments, s = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(s, a); }, ms);
    };
    d.cancel = function () { clearTimeout(t); };
    return d;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + pad(m) + ampm;
  }
  // Small, fast string hash for stable keys (FNV-1a).
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }
  // Xtream returns EPG titles base64 encoded UTF-8.
  function b64utf8(s) {
    if (!s) return '';
    try {
      var bin = atob(s), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return s; }
  }

  // fetch with a hard timeout, detailed error types and logging.
  //   err.kind: 'timeout' | 'network' (unreachable, DNS, or blocked by CORS) | 'http' | 'parse'
  //   err.status, err.body (first 300 chars), err.via ('helper' | 'direct'), err.ms
  var reqId = 0;
  function request(url, opts) {
    opts = opts || {};
    var id = ++reqId, t0 = Date.now();
    var real = typeof Net !== 'undefined' ? Net.wrap(url) : url;
    var via = real !== url ? 'helper' : 'direct';
    var tag = '#' + id + ' ' + (opts.label || 'GET');
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, opts.timeout || 20000);
    if (typeof Log !== 'undefined') Log.debug('http', tag + ' -> ' + url + ' (' + via + ')');
    function fail(kind, msg, extra) {
      var e = new Error(msg);
      e.kind = kind; e.via = via; e.ms = Date.now() - t0;
      if (extra) for (var k in extra) e[k] = extra[k];
      if (typeof Log !== 'undefined') Log.warn('http', tag + ' FAILED ' + kind + ' after ' + e.ms + 'ms via ' + via + ': ' + msg + '  url=' + url + (e.body ? '  body=' + JSON.stringify(e.body.slice(0, 200)) : ''));
      throw e;
    }
    var p = fetch(real, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .catch(function (err) {
        if (timedOut || (err && err.name === 'AbortError')) fail('timeout', 'No answer within ' + Math.round((opts.timeout || 20000) / 1000) + 's');
        // fetch() rejects with TypeError for DNS failure, refused connection, TLS failure and CORS
        // blocks alike; the browser deliberately hides which.  Through the helper, CORS is ruled out.
        fail('network', via === 'helper' ? 'The helper could not be reached' : 'Unreachable, or blocked by webOS because the server does not allow app requests (CORS)', { cause: err && err.message });
      })
      .then(function (r) {
        return r.text().then(function (txt) { return { r: r, txt: txt }; }, function (e) {
          fail(timedOut ? 'timeout' : 'network', 'Connection dropped while downloading (' + (e && e.message) + ')');
        });
      })
      .then(function (x) {
        var r = x.r, txt = x.txt, ms = Date.now() - t0;
        var ct = r.headers.get('content-type') || '';
        if (!r.ok) {
          // The helper answers 502 with the real reason (DNS, refused, TLS, timeout).
          var why = via === 'helper' && r.status === 502 && /^relay error:/.test(txt) ? txt.replace(/^relay error:\s*/, 'helper: ') : 'HTTP ' + r.status + ' ' + (r.statusText || '');
          fail('http', why, { status: r.status, body: txt.slice(0, 300), ctype: ct });
        }
        if (typeof Log !== 'undefined') Log.debug('http', tag + ' <- ' + r.status + ' ' + ct + ' ' + txt.length + ' bytes in ' + ms + 'ms');
        if (opts.text) return txt;
        try { return JSON.parse(txt); }
        catch (e) {
          var looksHtml = /^\s*</.test(txt);
          fail('parse', looksHtml ? 'The server answered with a web page instead of data (wrong address, or blocked by a firewall or Cloudflare)'
            : txt.trim() === '' ? 'The server answered with an empty response (often a wrong username or password on Xtream panels)'
            : 'The server answered with something that is not JSON', { status: r.status, body: txt.slice(0, 300), ctype: ct });
        }
      })
      .finally(function () { clearTimeout(timer); });
    return { promise: p, abort: function () { if (ctl) ctl.abort(); } };
  }
  function getJSON(url, timeout, label) { return request(url, { timeout: timeout, label: label }).promise; }
  function getText(url, timeout, label) { return request(url, { timeout: timeout, text: true, label: label }).promise; }

  var toastT = 0;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  }

  // Run fn in idle time so big data jobs never block a keypress.
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 1); };

    // Describes a secret without revealing it, so a log photo can show a typo:
  // "10 chars: letters, digits" or "11 chars: letters, digits, SPACE, ends with space".
  function secretShape(v) {
    v = String(v || '');
    if (!v) return 'empty';
    var k = [];
    if (/[a-z]/.test(v)) k.push('lower'); if (/[A-Z]/.test(v)) k.push('upper'); if (/[0-9]/.test(v)) k.push('digits');
    if (/[^A-Za-z0-9\s]/.test(v)) k.push('symbols'); if (/\s/.test(v)) k.push('SPACE'); if (/[^\x20-\x7e]/.test(v)) k.push('NON-ASCII');
    var e = /^\s/.test(v) ? ', starts with space' : ''; e += /\s$/.test(v) ? ', ends with space' : '';
    return v.length + ' chars: ' + k.join(', ') + e;
  }
  return {
    secretShape: secretShape, KEY: KEY, $: $, el: el, clamp: clamp, debounce: debounce, hhmm: hhmm, hash: hash,
    b64utf8: b64utf8, request: request, getJSON: getJSON, getText: getText, toast: toast, idle: idle, pad: pad };
})();
