/* MPEG-TS resync for live streams passing through the helper.
   A TS stream is 188-byte packets, each starting with 0x47.  When a provider's stream picks up
   stray bytes (a restreamer hiccup, a broken proxy, a half-written packet after a reconnect
   upstream), every packet after them is misaligned and the app's demuxer stops decoding until
   the channel is reconnected.  This filter keeps the output aligned: it passes whole packets,
   and when the 0x47 rhythm breaks it drops bytes until three packets in a row line up again.
   If no TS rhythm is found at all in the first 64 KB, the data is passed through untouched (an
   error page, or a different packet size), so nothing is ever made worse.
   Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var stream = require('stream');
var util = require('util');

var PKT = 188, SYNC = 0x47, GIVE_UP = 64 * 1024;

function TsSync(onDrop) {
  stream.Transform.call(this);
  this.carry = null;
  this.synced = false;       // seen the rhythm at least once
  this.passthrough = false;  // not TS: forward as is
  this.seen = 0;
  this.pre = [];             // bytes before the first sync, kept until we know what this is
  this.dropped = 0;
  this.onDrop = onDrop || null;
}
util.inherits(TsSync, stream.Transform);

// Three sync bytes 188 apart from i, or as many as the data holds (at least two).
function lined(b, i) {
  if (b[i] !== SYNC) return false;
  if (i + PKT >= b.length) return null;                  // can't tell yet
  if (b[i + PKT] !== SYNC) return false;
  if (i + 2 * PKT >= b.length) return null;
  return b[i + 2 * PKT] === SYNC;
}

TsSync.prototype._transform = function (chunk, enc, cb) {
  if (this.passthrough) { this.push(chunk); return cb(); }
  // The usual case: the last chunk ended mid-packet and this one carries on in step.  Finish that packet
  // on its own, rather than copying the whole chunk onto it (most chunks, on every live channel).
  var c = this.carry;
  if (c && this.synced && c[0] === SYNC && c.length < PKT) {
    var need = PKT - c.length;
    if (chunk.length >= need && (chunk.length === need || chunk[need] === SYNC)) {
      this.push(Buffer.concat([c, chunk.slice(0, need)]));
      this.carry = null;
      chunk = chunk.slice(need);
      if (!chunk.length) return cb();
    }
  }
  var b = this.carry ? Buffer.concat([this.carry, chunk]) : chunk;
  this.carry = null;
  var i = 0, n = b.length, runStart = -1;
  while (i < n) {
    if (this.synced && b[i] === SYNC && (i + PKT > n || b[i + PKT] === SYNC || i + PKT === n)) {
      if (i + PKT > n) break;                            // partial packet: wait for the rest
      if (runStart < 0) runStart = i;
      i += PKT;
      continue;
    }
    // Out of step (or not started yet): flush the good run, then look for the rhythm.
    if (runStart >= 0) { this.push(b.slice(runStart, i)); runStart = -1; }
    var j = i, found = -1, wait = false;
    for (; j < n; j++) {
      if (b[j] !== SYNC) continue;
      var l = lined(b, j);
      if (l === true) { found = j; break; }
      if (l === null) { wait = true; break; }
    }
    if (found < 0 && !wait) j = n;
    var skip = (found >= 0 ? found : j) - i;
    if (skip > 0) {
      if (this.synced) { this.dropped += skip; if (this.onDrop) this.onDrop(skip); }
      else { this.pre.push(b.slice(i, i + skip)); this.seen += skip; }
    }
    if (found < 0) {
      if (!this.synced && this.seen + (n - j) > GIVE_UP) { this.release(b.slice(j)); return cb(); }
      i = j;
      break;
    }
    i = found;
    if (!this.synced) { this.pre = []; this.synced = true; }
  }
  if (runStart >= 0) { this.push(b.slice(runStart, i)); }
  if (i < n) this.carry = b.slice(i);
  if (!this.synced && this.carry && this.seen + this.carry.length > GIVE_UP) { var c = this.carry; this.carry = null; this.release(c); }
  cb();
};
// Not TS after all: hand over everything held back, then pass the rest straight through.
TsSync.prototype.release = function (rest) {
  this.passthrough = true;
  for (var k = 0; k < this.pre.length; k++) this.push(this.pre[k]);
  this.pre = [];
  if (rest && rest.length) this.push(rest);
};

TsSync.prototype._flush = function (cb) {
  if (!this.synced && !this.passthrough) { this.release(null); }
  if (this.carry && (this.passthrough || !this.synced)) this.push(this.carry);
  this.carry = null;
  cb();
};

/* For a live channel the helper keeps going across reconnects (proxy.js feed): holds back the packets since the
   last start of a video frame (a PES on the video PID), about one frame's worth, and passes them on when the
   next frame starts.  When the provider's connection breaks mid-frame, drop() throws that half frame away: the
   app's demuxer would otherwise hand the TV's decoder a frame with a piece missing, and the decoder fails
   ("PIPELINE_ERROR_DECODE") instead of carrying on from the next connection's keyframe.  Takes TsSync's whole
   packets; anything not in step passes straight through. */
function FrameHold() {
  stream.Transform.call(this);
  this.vpid = -1; this.held = []; this.passthrough = false;
}
util.inherits(FrameHold, stream.Transform);
function pidOf(b, i) { return ((b[i + 1] & 0x1f) << 8) | b[i + 2]; }
function videoStart(b, i) {
  if (!(b[i + 1] & 0x40)) return false;
  var p = i + 4;
  if (b[i + 3] & 0x20) p += 1 + b[i + 4];
  return p + 4 <= i + PKT && b[p] === 0 && b[p + 1] === 0 && b[p + 2] === 1 && b[p + 3] >= 0xe0 && b[p + 3] <= 0xef;
}
FrameHold.prototype._transform = function (b, enc, cb) {
  if (this.passthrough || b.length % PKT) { this.flushHeld(); this.passthrough = true; this.push(b); return cb(); }
  var start = 0;
  for (var i = 0; i < b.length; i += PKT) {
    if (b[i] !== SYNC) { this.flushHeld(); this.passthrough = true; this.push(b); return cb(); }
    var pid = pidOf(b, i);
    if (this.vpid < 0 && videoStart(b, i)) this.vpid = pid;
    if (pid === this.vpid && videoStart(b, i)) {
      // A new frame starts here: the one before it is whole.
      this.flushHeld();
      if (i > start) this.push(b.slice(start, i));
      start = i;
    }
  }
  if (this.vpid < 0) { this.push(b); return cb(); }
  if (start < b.length) this.held.push(b.slice(start));
  // Never more than a few hundred KB held (a stream whose video PID changed): let it go.
  var n = 0; for (var k = 0; k < this.held.length; k++) n += this.held[k].length;
  if (n > 512 * 1024) this.flushHeld();
  cb();
};
FrameHold.prototype.flushHeld = function () { for (var k = 0; k < this.held.length; k++) this.push(this.held[k]); this.held = []; };
// The connection broke: the frame being received will never be whole.
FrameHold.prototype.drop = function () { var n = 0; this.held.forEach(function (x) { n += x.length; }); this.held = []; return n; };
FrameHold.prototype._flush = function (cb) { this.flushHeld(); cb(); };

module.exports = { TsSync: TsSync, FrameHold: FrameHold, PKT: PKT };
