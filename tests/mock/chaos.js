/* Sloppy live streams for testing the player: the kinds of trouble real IPTV providers cause.
   The mock provider adds these as a "TEST | Chaos" group when started with MOCK_CHAOS=1:
     MOCK_CHAOS=1 node tests/mock/mock_provider.js
   and tests/soak/chaos.js plays each one and measures how much of the time the picture moved.

   Every mode is a schedule over the seconds since the connection opened (rate 1 = real time),
   plus events: stalls, dropped connections, refused connections, timestamp jumps, garbage.
   Deterministic per connection number, so runs are comparable. */
'use strict';
const fs = require('fs'), path = require('path');

const MODES = [
  // id, name, description
  [901, 'Chaos Slow Patches', 'drops to a third of real time for 10s every 35s, then catches up'],
  [902, 'Chaos Stalls', 'no data for 8s every 30s, then a burst; one 20s stall at 100s'],
  [903, 'Chaos Drops', 'the connection is cut every 25 to 45s'],
  [904, 'Chaos Busy', 'first two connections refused (503), later ones sometimes 403'],
  [905, 'Chaos Jumps', 'timestamps jump back or ahead every 30s (an upstream restart, same encoding)'],
  [906, 'Chaos Garbage', 'random bytes injected every 15s'],
  [907, 'Chaos Slow Start', 'first byte after 8s, then a slow trickle before normal speed'],
  [908, 'Chaos Storm', 'slow patches, garbage, a 12s stall and a dropped connection'],
  [909, 'Chaos Outage', 'plays 30s, then the provider answers 404 for 60s, then comes back'],
  [910, 'Chaos Trickle', 'never faster than 92% of real time: the buffer always slowly drains'],
  [911, 'Chaos Restart', 'switches to a differently encoded stream every 40s (new codec settings)'],
  [912, 'Chaos Real Time', 'no head start: data arrives at exactly real time from the first byte (how long until a picture?)']
];

const conns = {};          // mode -> connections so far
const started = {};        // mode -> first connection time (for the outage)
const seen = {};           // mode -> last connection time: a new test run starts fresh after 60s idle

function rateAt(mode, t) {
  switch (mode) {
    case 901: case 908: { const c = t % 35; if (t > 20 && c >= 20 && c < 30) return 0.33; if (t > 20 && (c >= 30 || c < 5) ) return 1.7; return 1; }
    case 902: { if (t >= 100 && t < 120) return 0; const c = t % 30; if (t > 15 && c >= 15 && c < 23) return 0; if (t > 15 && c >= 23 && c < 30) return 2.1; return 1; }
    case 907: return t < 8 ? 0 : t < 14 ? 0.6 : 1;
    case 910: return 0.92;
    default: return 1;
  }
}

function serve(id, req, res, media) {
  const mode = +id;
  if (seen[mode] && Date.now() - seen[mode] > 60000) { conns[mode] = 0; started[mode] = 0; }
  seen[mode] = Date.now();
  const n = conns[mode] = (conns[mode] || 0) + 1;
  if (!started[mode]) started[mode] = Date.now();
  const since = (Date.now() - started[mode]) / 1000;
  const err = (code) => { res.writeHead(code, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end('chaos ' + code); };
  if (mode === 904 && (n <= 2 || (n > 3 && n % 3 === 0))) return err(n <= 2 ? 503 : 403);
  if (mode === 909 && since > 30 && since < 90 && n > 1) return err(404);

  const files = ['chaos.ts', 'news.ts', 'sports.ts', 'kids.ts'].map(f => path.join(media, f)).filter(f => fs.existsSync(f));
  if (!files.length) return err(404);
  let fileIdx = 0, fd = fs.openSync(files[0], 'r'), size = fs.statSync(files[0]).size, pos = 0;
  // Every connection starts somewhere new in the long clip, like tuning into live TV.
  if (files[0].endsWith('chaos.ts')) pos = Math.floor((Math.floor(since) * 150000) % Math.max(1, size - 50e6) / 188) * 188;
  // Real-time byte rate of the clip (chaos.ts is 600s long, the category clips 120s).
  const byteRate = size / (files[0].endsWith('chaos.ts') ? 600 : 120);
  const head = mode === 912 ? 0 : byteRate * 3;   // providers send a few seconds up front (912: none)
  const dropAt = mode === 903 ? 25 + (n * 7) % 20 : mode === 908 ? 60 : mode === 909 && n === 1 ? 30 : 0;
  const t0 = Date.now();
  let owed = head, last = t0, timer = null, closed = false, nextJunk = 15, nextJump = 30;

  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.on('close', () => { closed = true; clearTimeout(timer); try { fs.closeSync(fd); } catch (e) {} });

  function chunk(bytes) {
    const buf = Buffer.alloc(bytes);
    let got = fs.readSync(fd, buf, 0, bytes, pos);
    if (got < bytes) { pos = 0; got += fs.readSync(fd, buf, got, bytes - got, 0); }   // loop the clip
    pos += got;
    return buf.slice(0, got);
  }
  function pump() {
    if (closed) return;
    const now = Date.now(), t = (now - t0) / 1000;
    if (dropAt && t >= dropAt) { res.destroy(); return; }
    if (mode === 908 && t >= 40 && t < 52) { last = now; timer = setTimeout(pump, 200); return; }    // 12s stall
    owed += byteRate * rateAt(mode, t) * (now - last) / 1000;
    last = now;
    if ((mode === 906 || mode === 908) && t >= nextJunk) {
      nextJunk += 15;
      const junk = Buffer.alloc(8000 + (n * 997) % 8000);
      for (let i = 0; i < junk.length; i++) junk[i] = (i * 131 + n * 17 + Math.floor(t)) & 255;
      res.write(junk);
    }
    if (mode === 905 && t >= nextJump && files[fileIdx].endsWith('chaos.ts')) {
      // Same encoding, different place in the clip: the timestamps leap back or forward.
      nextJump += 30;
      const leap = (Math.floor(t / 30) % 2 ? -200 : 150) * byteRate;
      pos = Math.floor(((pos + leap) % size + size) % size / 188) * 188;
    }
    if (mode === 911 && t >= nextJump + 10) {
      nextJump += 40;
      fs.closeSync(fd);
      fileIdx = (fileIdx + 1) % files.length;
      fd = fs.openSync(files[fileIdx], 'r'); size = fs.statSync(files[fileIdx]).size; pos = 0;
    }
    const want = Math.floor(owed / 188) * 188;
    if (want >= 188 * 50) { const send = Math.min(want, 2e6); owed -= send; const ok = res.write(chunk(send)); if (!ok) { res.once('drain', () => { timer = setTimeout(pump, 50); }); return; } }
    timer = setTimeout(pump, 100);
  }
  pump();
}

module.exports = { MODES, serve };
