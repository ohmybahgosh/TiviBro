/* What held the helper up (issue #172).  A 1 GB TV's report showed the helper not answering TiviBro for minutes,
   with nothing in its log to say why.  A timer here ticks every second; when it fires late, the helper's own work
   held it up for that long, and it logs how long and what it was doing then: requests in flight, a guide being
   read (and how far), its memory.  Held 20 s or more is logged as an error, so it is also kept in
   helper-errors.json and still in the next problem report after a restart.

   create({ log(o), doing(), every, warn, bad, now })  log and doing are needed; the rest are for tests.
   Returns { tick(), stop() }: tick() is what the timer calls (tests call it with a clock of their own).
   Plain ES5 for Node 0.12 (webOS 4). */
'use strict';

var EVERY = 1000, WARN = 3000, BAD = 20000;

function create(o) {
  var every = o.every || EVERY, warn = o.warn || WARN, bad = o.bad || BAD, now = o.now || Date.now;
  var last = now(), timer = null;
  function tick() {
    var t = now(), late = t - last - every;
    last = t;
    if (late < warn) return;
    var d = {};
    try { d = o.doing() || {}; } catch (e) { d = { error: String(e && e.message || e) }; }
    o.log({ lv: late >= bad ? 'error' : 'warn', event: 'helper was held up', held: Math.round(late / 100) / 10 + ' s', doing: d,
      e: late >= bad ? 'held up ' + Math.round(late / 1000) + ' s: ' + JSON.stringify(d).slice(0, 400) : undefined });
  }
  if (o.timer !== false) { timer = setInterval(tick, every); if (timer.unref) timer.unref(); }
  return { tick: tick, stop: function () { clearInterval(timer); } };
}

// Memory now, in MB (heap and the whole process), for what the helper was doing.
function mem() {
  try { var m = process.memoryUsage(); return { heapMB: Math.round(m.heapUsed / 1048576), rssMB: Math.round(m.rss / 1048576) }; } catch (e) { return {}; }
}

module.exports = { create: create, mem: mem, EVERY: EVERY, WARN: WARN, BAD: BAD };
