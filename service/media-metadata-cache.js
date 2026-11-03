/* Bounded metadata request scheduling and cache.  Entries are kept per TMDB credential (a hash of
   it, never the credential itself), so one viewer's token never answers for another's; the key never
   holds the credential either.  Injected transports, clock and timers keep locale caching and
   rate-limit behaviour testable.  ES5 / Node 0.12. */
'use strict';
var crypto = require('crypto');
function create(read, opts) {
  opts = opts || {};
  var now = opts.now || Date.now, later = opts.later || setTimeout, cache = {}, bytes = 0, queue = [], active = 0;
  var maxBytes = opts.maxBytes || 8388608, maxEntries = opts.maxEntries || 128, limit = opts.concurrency || 2;
  function credential(url, headers) {
    var m = /[?&]api_key=([^&]*)/.exec(url), auth = headers && (headers.Authorization || headers.authorization);
    var value = (m ? 'key:' + m[1] : '') + '|' + (auth ? 'auth:' + auth : '');
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
  }
  function key(url, headers) { return credential(url, headers) + ' ' + url.replace(/([?&])api_key=[^&]*&?/g, function (all, separator) { return separator; }).replace(/[?&]$/, ''); }
  function prune() {
    var keys = Object.keys(cache);
    keys.sort(function (a, b) { return cache[a].used - cache[b].used; });
    while (keys.length && (bytes > maxBytes || keys.length > maxEntries)) { var k = keys.shift(); bytes -= cache[k].size; delete cache[k]; }
  }
  function pump() {
    while (active < limit && queue.length) { var job = queue.shift(); if (job.cancelled) continue; active++; run(job); }
  }
  function run(job) {
    job.transport = read(job.url, job.headers, function (e, r) {
      active--;
      if (job.cancelled) { pump(); return; }
      if (e && e.status === 429 && job.attempt < 2) {
        job.attempt++;
        var seconds = e.retryAfter > 0 ? Math.min(60, e.retryAfter) : Math.min(60, Math.pow(2, job.attempt));
        job.retryTimer = later(function () { if (!job.cancelled) { queue.push(job); pump(); } }, seconds * 1000);
        pump(); return;
      }
      if (!e) {
        var value = JSON.stringify(r), size = Buffer.byteLength(value, 'utf8');
        if (size <= maxBytes) {
          if (cache[job.key]) bytes -= cache[job.key].size;
          var negative = r && Array.isArray(r.results) && r.results.length === 0;
          cache[job.key] = { value: value, size: size, used: now(), expires: now() + (negative ? 86400000 : 7 * 86400000) };
          bytes += size; prune();
        }
      }
      job.cb(e, r); pump();
    });
  }
  function request(url, headers, cb, force) {
    var id = key(url, headers), entry = cache[id];
    if (!force && entry && entry.expires > now()) { entry.used = now(); cb(null, JSON.parse(entry.value)); return { cancel: function () {} }; }
    if (queue.length >= 512) { cb(new Error('Metadata queue is full.  Try again after current lookups finish.')); return { cancel: function () {} }; }
    var job = { url: url, headers: headers, key: id, cb: cb, attempt: 0, cancelled: false };
    queue.push(job); pump();
    return { cancel: function () { job.cancelled = true; if (job.retryTimer) (opts.cancelTimer || clearTimeout)(job.retryTimer); if (job.transport && job.transport.cancel) job.transport.cancel(); } };
  }
  request.stats = function () { return { bytes: bytes, entries: Object.keys(cache).length, active: active, queued: queue.length }; };
  request.keyOf = key;
  return request;
}
module.exports = { create: create };
