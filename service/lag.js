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

var BOX_EVERY = 15000, BOX_KEEP = 6;
/* The black box (issues #176-#178): a helper that freezes for good never fires its timer again, so it can't say
   what held it up, and webOS ends it without a word.  Every few seconds the helper writes what it is doing (its
   memory, requests, a guide being read, its latest log events) to a small file; a helper that ends normally marks
   the file closed.  The next helper reads it: still open means the one before was killed (frozen and stopped by
   webOS, or the TV losing power), and its last snapshots are logged as an error (so they reach the next problem report), oldest first to show memory climbing.

   Every 15 s keeps flash writes low (under 6,000 a day) and still holds the minute before a freeze.
   blackbox({ file, spare, doing(), recent(), log(o), every, keep, now, fs })  file, doing and log are needed;
   spare is a second place to write (a temp folder) for a TV where the first can't be written.
   Returns { write(), close(), stop() }: write() is what the timer calls, close() on a normal exit. */
function blackbox(o) {
  var fs = o.fs || require('fs'), every = o.every || BOX_EVERY, keep = o.keep || BOX_KEEP, now = o.now || Date.now, shots = [], timer = null, started = now();
  // What the helper before left: open (it didn't end normally) with its last snapshots.
  var file = o.file;
  try {
    var was = null;
    [o.file, o.spare].forEach(function (f) { if (was || !f) return; try { was = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {} });
    if (was && was.open && Array.isArray(was.shots) && was.shots.length) {
      var last = was.shots[was.shots.length - 1];
      o.log({ lv: 'error', event: 'helper before stopped without ending', shots: was.shots,
        e: 'the helper before ended without closing (frozen and stopped by webOS, or the TV lost power) ' + Math.round((now() - last.t) / 1000) + ' s ago; its last ' + was.shots.length + ' looks, oldest first: ' +
          JSON.stringify(was.shots.map(function (x) { var c = {}; Object.keys(x).forEach(function (k) { if (k !== 't') c[k] = x[k]; }); c.ago = Math.round((last.t - x.t) / 1000) + ' s before'; return c; })).slice(0, 560) });
    }
  } catch (e) {}
  // Write where it can: the helper's own folder, else the spare (once moved there, it stays).
  function save(open) {
    var body = JSON.stringify({ open: open, shots: shots });
    try { fs.writeFileSync(file, body); } catch (e) { if (o.spare && file !== o.spare) { file = o.spare; try { fs.writeFileSync(file, body); } catch (e2) {} } }
  }
  function write() {
    var d = {};
    try { d = o.doing() || {}; } catch (e) { d = { error: String(e && e.message || e) }; }
    d.t = now(); d.up = Math.round((d.t - started) / 1000);
    try { if (o.recent) d.last = o.recent(); } catch (e) {}
    shots.push(d); if (shots.length > keep) shots.shift();
    save(true);
  }
  write();                                   // this helper's own first look at once: what came before is told only once
  if (o.timer !== false) { timer = setInterval(write, every); if (timer.unref) timer.unref(); }
  return { write: write, close: function () { clearInterval(timer); save(false); }, stop: function () { clearInterval(timer); } };
}

// Memory now, in MB (heap and the whole process), for what the helper was doing.
function mem() {
  try { var m = process.memoryUsage(); return { heapMB: Math.round(m.heapUsed / 1048576), rssMB: Math.round(m.rss / 1048576) }; } catch (e) { return {}; }
}

module.exports = { create: create, blackbox: blackbox, mem: mem, EVERY: EVERY, WARN: WARN, BAD: BAD };
