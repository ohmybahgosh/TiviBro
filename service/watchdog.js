/* The helper checks on itself (issue #153).  On a 1 GB TV with a very big playlist the helper could stop
   answering for good: its process still there, so webOS never started a new one, and only turning the TV
   off and on brought it back.  Every 20 s while TiviBro uses it, the helper asks its own relay for /ping.
   When that fails four times in a row (over a minute), or several uncaught errors come within a minute
   (what's left running may be broken), or it has been nearly out of memory for a minute, it logs why and
   exits.  webOS starts a fresh helper the next time TiviBro asks for it (net.js asks again by itself).

   create({ port(), busy(), log(o), exit(code), ping(port, ms, cb), heap() })  all optional but port and ping
     port()   the relay's port now (0 when it isn't listening: nothing to check)
     busy()   true while TiviBro is subscribed (the checks only run then)
   Returns { tick(), error(e), stop() }; tick() is what the timer calls (tests call it directly).
   Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var http = require('http');

var EVERY = 20000, PING_MS = 8000, MISSES = 4, ERRORS = 3, ERROR_WINDOW = 60000, HEAP_SHARE = 0.92, HEAP_TICKS = 3;

// The relay's own /ping, answered or not within ms.
function pingRelay(port, ms, cb) {
  var done = false, t = setTimeout(function () { finish(false); }, ms);
  function finish(ok) { if (done) return; done = true; clearTimeout(t); cb(ok); }
  try {
    var req = http.get({ host: '127.0.0.1', port: port, path: '/ping', agent: false }, function (res) { res.resume(); finish(res.statusCode === 200); });
    req.on('error', function () { finish(false); });
  } catch (e) { finish(false); }
}
// How full the JavaScript heap is (0 to 1), or 0 where Node can't say (0.12 has no v8 module).
function heapShare() {
  try { var s = require('v8').getHeapStatistics(); return s.heap_size_limit ? s.used_heap_size / s.heap_size_limit : 0; } catch (e) { return 0; }
}

// The checks for one helper: tick() every 20 s, error() for each uncaught error, quit() once when stuck.
function create(o) {
  var misses = 0, errors = [], fullTicks = 0, gone = false, checking = false, timer = null;
  var log = o.log || function () {}, exit = o.exit || function (c) { process.exit(c); }, ping = o.ping || pingRelay, heap = o.heap || heapShare;
  function quit(why) {
    if (gone) return;
    gone = true;
    log({ lv: 'error', event: 'helper restarts itself', why: why });
    // A moment for the log line to reach the file, then a fresh helper on the next call.
    setTimeout(function () { exit(1); }, 500);
  }
  function tick() {
    if (gone || checking) return;
    var p = o.port ? o.port() : 0;
    if (!p || (o.busy && !o.busy())) { misses = 0; fullTicks = 0; return; }
    fullTicks = heap() > HEAP_SHARE ? fullTicks + 1 : 0;
    if (fullTicks >= HEAP_TICKS) return quit('nearly out of memory for a minute');
    checking = true;
    ping(p, PING_MS, function (ok) {
      checking = false;
      if (ok) { misses = 0; return; }
      misses++;
      log({ lv: 'warn', event: 'helper did not answer itself', misses: misses });
      if (misses >= MISSES) quit('its relay did not answer for over a minute');
    });
  }
  // An uncaught error: logged by service.js; several close together and the helper starts over.
  function error() {
    var now = Date.now();
    errors = errors.filter(function (t) { return now - t < ERROR_WINDOW; });
    errors.push(now);
    if (errors.length >= ERRORS) quit(errors.length + ' uncaught errors within a minute');
  }
  if (o.timer !== false) { timer = setInterval(tick, EVERY); if (timer.unref) timer.unref(); }
  return { tick: tick, error: error, stop: function () { clearInterval(timer); }, get gone() { return gone; } };
}

module.exports = { create: create, EVERY: EVERY, MISSES: MISSES };
