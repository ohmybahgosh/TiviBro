/* A big list read as it arrives (issue #166, and the 1 GB TVs of #140 to #167): the provider's answer is a JSON
   array of titles, 60 MB or more for 160,000 movies.  Read whole, it was a 60 MB string and then every title as an
   object, several times its size at once, and JSON.parse held the helper for 25 s on an old TV (Node 8), so it
   answered nothing else and webOS was short of memory for the app.  Here each title is cut out of the stream as
   its bytes come (the brackets and quotes are plain ASCII, so a UTF-8 character split between two pieces is never
   cut), parsed alone and handed to onItem, and the next piece waits for the network: the helper keeps answering.
   cb(err, { array: true, n }) for an array; an answer that isn't one (a provider's error object) is read whole:
   cb(null, { array: false, value }).
   Used for the movie and show lists (vod.js) and the live channel list (live.js).  ES5 for Node 0.12. */
'use strict';
var http = require('http');

// GET url and hand each element of its top-level JSON array to onItem as it arrives (see above).
function streamArray(url, onItem, cb, ms) {
  var done = false;
  function finish(e, v) { if (!done) { done = true; cb(e, v); } }
  var depth = 0, inStr = false, esc = false, top = 0, parts = [], whole = null, n = 0, size = 0;   // top: 0 unknown, 1 array, 2 other
  function emit(buf) {
    var x; try { x = JSON.parse(buf.toString('utf8')); } catch (e) { return; }     // one broken title is left out, not the list
    n++; onItem(x);
  }
  /* One piece of the answer: before the list starts, skip spaces and a BOM and see whether it is an array; then
     follow strings and brackets byte by byte, cutting out each element of the array as it closes.  An element
     still open at the end of the piece is kept and goes on with the next one. */
  function feed(c) {
    var i = 0, start = parts.length ? 0 : -1;
    if (top === 0) {
      while (i < c.length && (c[i] === 0x20 || c[i] === 0x0a || c[i] === 0x0d || c[i] === 0x09 || c[i] === 0xef || c[i] === 0xbb || c[i] === 0xbf)) i++;
      if (i >= c.length) return;
      top = c[i] === 0x5b ? 1 : 2;
      if (top === 2) { whole = [c.slice(i)]; return; }
      depth = 1; i++;
    }
    if (top === 2) { whole.push(c); return; }
    for (; i < c.length; i++) {
      var b = c[i];
      if (inStr) { if (esc) esc = false; else if (b === 0x5c) esc = true; else if (b === 0x22) inStr = false; continue; }
      if (b === 0x22) { inStr = true; continue; }
      if (b === 0x7b || b === 0x5b) { if (depth === 1 && start < 0) start = i; depth++; }
      else if (b === 0x7d || b === 0x5d) {
        depth--;
        if (depth === 1 && start >= 0) { parts.push(c.slice(start, i + 1)); emit(parts.length === 1 ? parts[0] : Buffer.concat(parts)); parts = []; start = -1; }
        else if (depth === 0) top = 3;                                            // the end of the list
      }
    }
    if (start >= 0) parts.push(c.slice(start));                                  // a title that goes on in the next piece
  }
  var req = http.get(url, function (res) {
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
    res.on('data', function (c) { if (done) return; size += c.length; try { feed(c); } catch (e) { req.abort(); finish(new Error('could not read the list: ' + e.message)); } });
    res.on('end', function () {
      if (top === 2) { var v; try { v = JSON.parse(Buffer.concat(whole).toString('utf8')); } catch (e) { return finish(new Error('not JSON (' + size + ' bytes)')); } return finish(null, { array: false, value: v }); }
      if (top !== 3) return finish(new Error(top === 0 ? 'an empty answer' : 'the list stopped part way (' + size + ' bytes)'));
      finish(null, { array: true, n: n });
    });
    res.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(ms || 180000, function () { req.abort(); finish(new Error('timed out')); });
}

module.exports = { streamArray: streamArray };
