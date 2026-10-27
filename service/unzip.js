/* Unzipping guide downloads in the helper, so every TV can read .xml.gz guides.
   Browsers on webOS 6 and older (Chromium < 80) have no DecompressionStream, and even where it
   exists, Node's zlib is faster and keeps the work off the app.  The app asks for it with the
   /unz/<id> relay prefix; the helper then:
     - asks the server for gzip or deflate and undoes whatever Content-Encoding comes back,
     - looks at the first bytes and unzips gzip data however it is labelled (.gz files served as
       application/octet-stream, xmltv.php answers that are gzipped without saying so, and files
       that were zipped twice: a .gz file sent with Content-Encoding: gzip),
     - passes anything else through untouched,
     - counts the compressed bytes per <id>, readable at /xfer/<id>, for real download progress.
   Plain ES5 for Node 0.12 (webOS 4).  Uses only zlib and stream, which every webOS Node has. */
'use strict';
var zlib = require('zlib');
var stream = require('stream');

var MAX_LAYERS = 3;
function isGzip(b) { return b && b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b; }

/* decode(src, contentEncoding, cb): cb(err, readable, how) once the first bytes are known.
   how is '' (passed through) or what was undone, e.g. 'gzip' or 'gzip+gzip'. */
function decode(src, encoding, cb) {
  var called = false, final = null;
  function done(err, s, how) { if (!called) { called = true; final = s; cb(err, s, how); } }
  // Any layer can fail later (a file cut short, bad data): the error surfaces on the stream handed out.
  function fail(e) { if (!called) done(e); else if (final) final.emit('error', e); }
  var enc = String(encoding || '').toLowerCase(), first = src, how = [];
  src.on('error', fail);
  if (/gzip/.test(enc)) { first = pipeInto(src, zlib.createGunzip(), fail); how.push('gzip'); }
  else if (/deflate/.test(enc)) { first = pipeInto(src, zlib.createInflate(), fail); how.push('deflate'); }
  sniff(first);

  function sniff(s) {
    var settled = false;
    function onData(chunk) {
      if (settled) return;
      settled = true;
      s.removeListener('data', onData); s.removeListener('end', onEnd);
      s.pause();
      var out = new stream.PassThrough();
      if (isGzip(chunk) && how.length < MAX_LAYERS) {
        var g = zlib.createGunzip();
        how.push('gzip');
        g.on('error', fail);
        out.pipe(g);
        out.write(chunk);
        s.pipe(out);
        s.resume();
        return sniff(g);
      }
      out.write(chunk);
      s.pipe(out);
      s.resume();
      done(null, out, how.join('+'));
    }
    function onEnd() {           // empty body
      if (settled) return;
      settled = true;
      var out = new stream.PassThrough(); out.end();
      done(null, out, how.join('+'));
    }
    s.on('data', onData);
    s.on('end', onEnd);
  }
}
function pipeInto(src, z, fail) {
  z.on('error', fail);
  src.pipe(z);
  return z;
}

/* Download progress per /unz/<id>: compressed bytes seen so far and the size if the server said. */
var xfers = {};
function track(id, total) {
  var x = xfers[id] = { raw: 0, total: total || 0, done: false, at: Date.now() };
  var now = Date.now();
  Object.keys(xfers).forEach(function (k) { if (now - xfers[k].at > 10 * 60000) delete xfers[k]; });
  return x;
}
function progress(id) { return xfers[id] || null; }

module.exports = { decode: decode, track: track, progress: progress, isGzip: isGzip };
