/* One connection to the provider per channel, shared by what needs it (recording, live pause): a recording and
   a pause of the same channel used to open two, and a plan that allows one refused the second.
   A feed is opened with a key (the channel, from the app; the address when none) and an address, with another
   format to fall back on (HLS first, MPEG-TS when HLS never starts).  Whoever opens it first decides the address;
   later ones join what's coming.  It reconnects on its own, slower each time (2, 4, 8 ... 30 s) until something
   arrives: a provider that's asked every few seconds blocks the account.  The last one to close it closes the
   connection.
   What each one gets (all optional):
     kind('ts' | 'mp4')       what the bytes are
     data(buf)                MPEG-TS bytes as they come
     init(buf)                fMP4's init segment (HLS with EXT-X-MAP), before its pieces
     piece({ buf, dur, disc })  an HLS piece, in order, once
     down(why)  up()          the connection dropped / is back (data flowing again)
     fatal(why)               it can't be had (encrypted HLS): the feed is closed for everyone
     ended()                  the provider's playlist ended (#EXT-X-ENDLIST)
   Plain ES5 for Node 0.12. */
'use strict';
var URL_ = require('url');

var RETRY_MS = +(process.env.TIVIBRO_FEED_RETRY_MS || process.env.TIVIBRO_REC_RETRY_MS || 2000);
var feeds = {}, io = null, logf = function () {};
function setup(o) { io = o; if (o.log) logf = o.log; }
function note(lv, event, more) { var o = { lv: lv, event: event }; for (var k in more || {}) o[k] = more[k]; logf(o); }

function open(key, url, alt, sub) {
  key = String(key || url);
  var F = feeds[key];
  if (!F) {
    F = feeds[key] = { key: key, url: url, alt: alt && alt !== url ? alt : '', subs: [], stopped: false, fails: 0, swapped: false, got: false, kind: '', init: null, last: null, down: false, gaps: 0, tail: [], tailBytes: 0, lastPiece: null };
    connect(F);
  } else {
    // Joining: what it is, fMP4's init, and the last few seconds already here (a pause or the rewind buffer joining
    // a recording starts at once instead of waiting for the provider's next piece).
    if (F.kind && sub.kind) sub.kind(F.kind);
    if (F.init && sub.init) sub.init(F.init);
    if (F.lastPiece && sub.piece) sub.piece(F.lastPiece);
    if (F.tail.length && sub.data) F.tail.forEach(function (c) { sub.data(c); });
  }
  F.subs.push(sub);
  return {
    close: function () {
      var i = F.subs.indexOf(sub);
      if (i >= 0) F.subs.splice(i, 1);
      if (!F.subs.length) stop(F);
    },
    get shared() { return F.subs.length > 1; }, get url() { return F.url; }
  };
}
function each(F, name, a) { F.subs.slice().forEach(function (s) { if (s[name]) { try { s[name](a); } catch (e) { note('warn', 'feed: ' + name + ' failed', { e: e.message }); } } }); }
function stop(F) {
  F.stopped = true; clearTimeout(F.retry); clearTimeout(F.poll);
  try { if (F.req) F.req.abort(); } catch (e) {}
  if (feeds[F.key] === F) delete feeds[F.key];
}
function fatal(F, why) { each(F, 'fatal', why); F.subs = []; stop(F); }
// MPEG-TS: the last few MB (several seconds, with a keyframe in it) for whoever joins.
var TAIL_MAX = 4 * 1024 * 1024;
function keep(F, c) {
  F.tail.push(c); F.tailBytes += c.length;
  while (F.tailBytes - F.tail[0].length > TAIL_MAX) F.tailBytes -= F.tail.shift().length;
}
function setKind(F, k) { if (F.kind !== k) { F.kind = k; each(F, 'kind', k); } }
function flowing(F) { F.fails = 0; F.got = true; if (F.down) { F.down = false; each(F, 'up'); } }

function again(F, why) {
  if (F.stopped) return;
  if (!F.down) { F.down = true; each(F, 'down', why); }
  F.gaps++;
  F.fails++;
  var ms = Math.min(30000, RETRY_MS * Math.pow(2, F.fails - 1));
  if (/HTTP 4\d\d/.test(why || '')) ms = Math.max(ms, Math.min(30000, 5 * RETRY_MS));
  if (F.gaps === 1 || F.gaps % 5 === 0) note('warn', 'feed reconnecting', { e: why, gaps: F.gaps, inMs: ms, subs: F.subs.length });
  F.retry = setTimeout(function () { connect(F); }, ms);
}
// HLS first, the channel's other format when that never started.
function swap(F, why) {
  if (!F.alt || F.got || F.swapped) return false;
  F.swapped = true; var u0 = F.url; F.url = F.alt; F.alt = u0;
  note('info', 'feed: the other format', { e: why });
  connect(F);
  return true;
}
function connect(F) {
  if (F.stopped) return;
  F.req = io.get(F.url, function (e, res, at) {
    if (F.stopped) { if (res) res.resume(); return; }
    if (e || res.statusCode !== 200) {
      if (res) res.resume();
      var why = e ? e.message : 'HTTP ' + res.statusCode;
      if (swap(F, why)) return;
      return again(F, why);
    }
    if (io.isPlaylist(res, at)) { res.resume(); return hls(F, at); }
    setKind(F, 'ts');
    res.on('data', function (c) { if (F.stopped) return; flowing(F); keep(F, c); each(F, 'data', c); });
    res.on('end', function () { again(F, 'the provider closed the stream'); });
    res.on('error', function (e2) { again(F, e2.message); });
  });
}
/* HLS: the playlist, again and again; each new piece once, in order. */
function hls(F, u) {
  io.getText(u, function (e, text) {
    if (F.stopped) return;
    if (e) return again(F, e.message);
    if (!/^\s*#EXTM3U/.test(text)) { if (swap(F, 'not a playlist')) return; return again(F, 'the provider\'s answer wasn\'t a playlist'); }
    var lines = text.split(/\r?\n/), best = null, bw = -1;
    for (var i = 0; i < lines.length; i++) {
      var m = /^#EXT-X-STREAM-INF:(.*)$/.exec(lines[i]);
      if (m) { var b = +((/BANDWIDTH=(\d+)/.exec(m[1]) || [])[1]) || 0, nx = (lines[i + 1] || '').trim(); if (nx && b > bw) { bw = b; best = nx; } }
    }
    if (best) return hls(F, URL_.resolve(u, best));                       // a master playlist: its best quality
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) return fatal(F, 'this channel is encrypted HLS, which TiviBro can\'t record or pause yet');
    var seq = +((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text) || [])[1]) || 0, target = +((/#EXT-X-TARGETDURATION:(\d+)/.exec(text) || [])[1]) || 6;
    var map = (/#EXT-X-MAP:.*URI="([^"]+)"/.exec(text) || [])[1], queue = [], k = 0, dur = 0, disc = false;
    lines.forEach(function (l) {
      l = l.trim();
      var d = /^#EXTINF:([\d.]+)/.exec(l);
      if (d) dur = +d[1];
      else if (l === '#EXT-X-DISCONTINUITY') disc = true;
      else if (l && l.charAt(0) !== '#') { var n = seq + k++; if (F.last == null || n > F.last) queue.push({ n: n, u: URL_.resolve(u, l), dur: dur || target, disc: disc }); dur = 0; disc = false; }
    });
    var restart = false;
    // The first look: the newest few (live, not the whole window behind).  Numbers that went backwards: the
    // provider's stream restarted, so from its newest again.
    if (F.last != null && seq + k - 1 < F.last) { F.last = null; restart = true; }
    if (F.last == null && queue.length > 2) queue = queue.slice(-2);
    if (restart && queue[0]) queue[0].disc = true;
    var ended = /#EXT-X-ENDLIST/.test(text);
    setKind(F, map ? 'mp4' : 'ts');
    (function initThen(go) {
      if (!map || F.init) return go();
      io.fetchAll(URL_.resolve(u, map), function (e2, buf) { if (e2) return again(F, 'init: ' + e2.message); F.init = buf; each(F, 'init', buf); go(); });
    })(function () {
      (function step() {
        if (F.stopped) return;
        var s = queue.shift();
        if (!s) {
          if (ended) { each(F, 'ended'); return; }
          F.poll = setTimeout(function () { hls(F, u); }, Math.max(1000, target * 500));
          return;
        }
        F.last = s.n;
        io.fetchAll(s.u, function (e3, buf) {
          if (F.stopped) return;
          if (e3) { F.gaps++; each(F, 'piece', { buf: null, dur: s.dur, disc: true, lost: true }); return step(); }     // a lost piece is a short gap
          flowing(F);
          F.lastPiece = { buf: buf, dur: s.dur, disc: true };
          each(F, 'piece', { buf: buf, dur: s.dur, disc: s.disc });
          step();
        });
      })();
    });
  });
}

module.exports = { setup: setup, open: open, _feeds: feeds, _stopAll: function () { Object.keys(feeds).forEach(function (k) { stop(feeds[k]); }); } };
