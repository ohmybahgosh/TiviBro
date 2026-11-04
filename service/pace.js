/* Pacing image downloads after a host says "too many requests" (HTTP 429).  Channel logos are often all on
   one free host (imgur, for example), and a guide full of them asks for dozens at once: the host then turns
   most of them away and those logos stay blank (issue #45).  After a 429 from an image, the helper waits as
   long as the host asked (Retry-After, 2 to 60 seconds, 10 when it doesn't say), asks for that image once
   more, and for a minute after that sends the host's images one at a time, a little apart, instead of all at
   once.  Streams, playlists and guides are never held back: only image addresses are paced. */
'use strict';

var IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;
var SPACING = 400, COOL = 60000, DEFAULT_WAIT = 10000, MIN_WAIT = 2000, MAX_WAIT = 60000;

function create(clock) {
  var now = (clock && clock.now) || Date.now;
  var later = (clock && clock.later) || setTimeout;
  var hosts = {};     // host -> { until: no request before this, next: next free slot, cool: paced until this }

  /** Is this request an image (by its path, without the query)? */
  function isImage(pathname) { return IMAGE.test(String(pathname || '').split('?')[0]); }

  /** How long a 429's Retry-After asks to wait, in ms: seconds or an HTTP date, kept between 2 and 60 s. */
  function waitFor(retryAfter) {
    var ms = DEFAULT_WAIT, v = retryAfter == null ? '' : String(retryAfter).trim();
    if (/^\d+(\.\d+)?$/.test(v)) ms = parseFloat(v) * 1000;
    else if (v) { var d = Date.parse(v); if (!isNaN(d)) ms = d - now(); }
    return Math.max(MIN_WAIT, Math.min(MAX_WAIT, ms));
  }

  /** The host said 429: hold its images back.  Returns the wait in ms. */
  function backoff(host, retryAfter) {
    var ms = waitFor(retryAfter), t = now(), g = hosts[host] || (hosts[host] = { until: 0, next: 0, cool: 0 });
    g.until = Math.max(g.until, t + ms);
    g.next = Math.max(g.next, g.until);
    g.cool = g.until + COOL;
    return ms;
  }

  /** Runs [go] now, or when this host's image may be asked for.  Returns the delay in ms (0: at once). */
  function wait(host, image, go) {
    var g = hosts[host], t = now();
    if (!image || !g || t >= g.cool) { if (g && t >= g.cool) delete hosts[host]; go(); return 0; }
    var at = Math.max(t, g.until, g.next);
    g.next = at + SPACING;
    if (at <= t) { go(); return 0; }
    later(go, at - t);
    return at - t;
  }

  /** Is this host being paced now?  (For the log.) */
  function paced(host) { var g = hosts[host]; return !!(g && now() < g.cool); }

  return { isImage: isImage, waitFor: waitFor, backoff: backoff, wait: wait, paced: paced };
}

module.exports = { create: create, SPACING: SPACING, COOL: COOL };
