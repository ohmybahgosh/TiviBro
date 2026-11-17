/* A movie file's picture: its height, HDR10, HLG or Dolby Vision, read from the file's own headers with a
   few bounded Range requests (as media-chapters.js reads chapters), for My media's "2160p  Dolby Vision".
     MKV  the video track's Colour (TransferCharacteristics 16 is PQ: HDR10; 18 is HLG) and its
          BlockAdditionMapping ("dvcC"/"dvvC": Dolby Vision), from Tracks near the start or where SeekHead says.
     MP4  the moov box (at the start or the end): a dvcC/dvvC box or a dvh1/dvhe sample entry (Dolby Vision),
          a colr nclx box's transfer (16 or 18).
   { height, width, range: 'DV'|'HDR10'|'HLG'|'HDR'|'SDR'|'' } ('' when the file doesn't say; HDR: a 10-bit 4K HEVC
   picture whose header names no colour).  ES5 / Node 0.12. */
'use strict';
var http = require('http'), https = require('https'), URL_ = require('url');

function uint(b, a, z) { var v = 0; for (var i = a; i < z; i++) v = v * 256 + b[i]; return v; }
function num(b, p, keep) {
  if (p >= b.length || !b[p]) throw new Error('Invalid EBML integer.');
  var len = 1, mask = 128; while (!(b[p] & mask)) { len++; mask >>= 1; }
  if (len > 8 || p + len > b.length) throw new Error('Truncated EBML integer.');
  var v = keep ? b[p] : b[p] & (mask - 1), unknown = !keep && v === mask - 1;
  for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; unknown = unknown && b[p + i] === 255; }
  return { value: v, next: p + len, unknown: unknown };
}
function el(b, p) { var id = num(b, p, true), size = num(b, id.next, false); return { id: id.value, start: size.next, end: size.unknown ? b.length : size.next + size.value, unknown: size.unknown }; }
function kids(b, a, z, visit) { z = Math.min(z, b.length); while (a < z) { var e = el(b, a); if (e.end <= a) break; visit(e); a = e.end; } }

// An HEVC configuration record (hvcC: MKV CodecPrivate, or the MP4 box's body): 10 bits or more.
function tenBit(b, a, z) { return z - a > 18 && b[a] === 1 && (b[a + 17] & 7) >= 2; }
// The MKV Tracks element's bytes: the first video track.
function mkvTracks(b) {
  var out = { height: 0, width: 0, range: '' };
  kids(b, 0, b.length, function (t) {
    if (t.id !== 0xae || out.done) return;
    var video = false, h = 0, w = 0, trc = 0, dv = false, mastering = false, deep = false;
    kids(b, t.start, t.end, function (f) {
      if (f.id === 0x83) video = uint(b, f.start, f.end) === 1;
      if (f.id === 0x63a2) deep = tenBit(b, f.start, f.end);
      if (f.id === 0x41e4) kids(b, f.start, f.end, function (g) { if (g.id === 0x41e7) { var v = uint(b, g.start, g.end); if (v === 0x64766343 || v === 0x64767643) dv = true; } });
      if (f.id === 0xe0) kids(b, f.start, f.end, function (g) {
        if (g.id === 0xba) h = uint(b, g.start, g.end);
        if (g.id === 0xb0) w = uint(b, g.start, g.end);
        if (g.id === 0x55b0) kids(b, g.start, g.end, function (c) { if (c.id === 0x55ba) trc = uint(b, c.start, c.end); if (c.id === 0x55d0) mastering = true; });
      });
    });
    if (!video) return;
    out.done = true; out.height = h; out.width = w;
    // No colour in the track's header (many web releases keep it in the video stream): a 10-bit HEVC 4K picture is HDR.
    out.range = dv ? 'DV' : trc === 16 || (mastering && trc !== 18) ? 'HDR10' : trc === 18 ? 'HLG' : trc ? 'SDR' : deep && (h >= 1600 || w >= 3200) ? 'HDR' : '';
  });
  delete out.done;
  return out;
}
// The MP4 moov box's bytes, looked through for the boxes that tell.
function mp4Moov(b) {
  var s = b.toString('binary'), out = { height: 0, width: 0, range: '' };
  var dv = /dvcC|dvvC|dvh1|dvhe/.test(s), trc = 0, i = s.indexOf('colrnclx'), hv = s.indexOf('hvcC'), deep = hv >= 0 && tenBit(b, hv + 4, Math.min(b.length, hv + 40));
  if (i >= 0 && i + 12 <= b.length) trc = b.readUInt16BE(i + 10);
  // tkhd of the video track: its height is the last 4 bytes (16.16 fixed point); the tallest one is the picture.
  // tkhd: width and height are its last 8 bytes (16.16 fixed point), after 84 (version 0) or 96 (version 1) bytes.
  var at = 0; while ((at = s.indexOf('tkhd', at + 1)) >= 0) { var v = b[at + 4], end = at + 4 + (v === 1 ? 96 : 84); if (end <= b.length) { var hh = b.readUInt32BE(end - 4) >>> 16, ww = b.readUInt32BE(end - 8) >>> 16; if (hh > out.height) { out.height = hh; out.width = ww; } } }
  out.range = dv ? 'DV' : trc === 16 ? 'HDR10' : trc === 18 ? 'HLG' : trc ? 'SDR' : deep && (out.height >= 1600 || out.width >= 3200) ? 'HDR' : '';
  return out;
}

function inspect(read, size, ext, cb) {
  var reqs = 0, bytes = 0, done = false;
  function finish(e, r) { if (done) return; done = true; cb(e, r); }
  function range(offset, length, next) {
    length = Math.min(length, size - offset);
    if (offset < 0 || length <= 0 || length > 4194304 || ++reqs > 8 || (bytes += length) > 6291456) return finish(new Error('Format inspection limit reached.'));
    read(offset, length, function (e, b) { if (done) return; if (e) return finish(e); if (!b || b.length !== length) return finish(new Error('Invalid Range response.')); try { next(b); } catch (x) { finish(x); } });
  }
  if (ext === 'mkv' || ext === 'webm') return range(0, Math.min(524288, size), function (head) {
    var p = 0, seg = null;
    while (p < head.length) { var e = el(head, p); if (e.id === 0x18538067) { seg = e; break; } if (e.end > head.length) break; p = e.end; }
    if (!seg) return finish(null, { height: 0, range: '' });
    var tracksAt = -1; p = seg.start;
    while (p < head.length) {
      var c = el(head, p);
      if (c.id === 0x1654ae6b) { if (c.end <= head.length) return finish(null, mkvTracks(head.slice(c.start, c.end))); tracksAt = p; break; }
      if (c.id === 0x114d9b74 && c.end <= head.length) kids(head, c.start, c.end, function (s) {
        if (s.id !== 0x4dbb) return; var id = null, off = null;
        kids(head, s.start, s.end, function (f) { if (f.id === 0x53ab) id = uint(head, f.start, f.end); if (f.id === 0x53ac) off = uint(head, f.start, f.end); });
        if (id === 0x1654ae6b && tracksAt < 0) tracksAt = seg.start + off;
      });
      if (c.end > head.length || c.end <= p) break;
      p = c.end;
    }
    if (tracksAt < 0) return finish(null, { height: 0, range: '' });
    range(tracksAt, 16, function (h) {
      var t = el(h, 0); if (t.id !== 0x1654ae6b || t.unknown || t.end > 4194304) return finish(null, { height: 0, range: '' });
      range(tracksAt + t.start, t.end - t.start, function (b) { finish(null, mkvTracks(b)); });
    });
  });
  if (ext !== 'mp4' && ext !== 'm4v' && ext !== 'mov') return finish(null, { height: 0, range: '' });
  (function atom(offset, n) {
    if (offset >= size || n > 12) return finish(null, { height: 0, range: '' });
    range(offset, Math.min(16, size - offset), function (h) {
      var len = h.readUInt32BE(0), type = h.toString('binary', 4, 8), start = offset + 8;
      if (len === 1) { len = uint(h, 8, 16); start = offset + 16; }
      if (!len) len = size - offset;
      if (len < 8) return finish(null, { height: 0, range: '' });
      if (type === 'moov') return range(start, Math.min(offset + len - start, 4194304), function (b) { finish(null, mp4Moov(b)); });
      atom(offset + len, n + 1);
    });
  })(0, 0);
}
// Over HTTP(S): the resolved link of a movie (Dropbox, WebDAV, a server).  Strict Range, no redirects, 10 s.
function fromUrl(url, size, ext, cb) {
  var end = Date.now() + 10000;
  function read(offset, length, next) {
    var u = URL_.parse(url), finished = false, req;
    function done(e, b) { if (finished) return; finished = true; next(e, b); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return done(new Error('Unsupported media address.'));
    req = (u.protocol === 'https:' ? https : http).get({ hostname: u.hostname, port: u.port, path: u.path, headers: { Range: 'bytes=' + offset + '-' + (offset + length - 1) }, agent: false }, function (res) {
      var m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range'] || '');
      if (res.statusCode !== 206 || !m || +m[1] !== offset) { res.destroy(); return done(new Error('This server cannot provide byte ranges.')); }
      var chunks = [], n = 0;
      res.on('data', function (b) { n += b.length; if (n > length) { res.destroy(); done(new Error('Range response too long.')); } else chunks.push(b); });
      res.on('end', function () { done(n === length ? null : new Error('Truncated range.'), Buffer.concat(chunks)); });
      res.on('error', done);
    });
    req.on('error', function () { done(new Error('Could not read the file.')); });
    req.setTimeout(Math.max(1, Math.min(8000, end - Date.now())), function () { done(new Error('Timed out.')); req.abort(); });
  }
  if (!(size > 0)) return cb(new Error('File size is not known.'));
  inspect(read, size, String(ext || '').toLowerCase(), cb);
}
module.exports = { inspect: inspect, fromUrl: fromUrl, mkvTracks: mkvTracks, mp4Moov: mp4Moov };
