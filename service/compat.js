/* Fills in the few Node.js features the helper uses that old webOS versions lack.
   Node by webOS TV version: 4.x and older 0.12, 5.x and 6.x 8.12, 22 and 23 12.x, 24 and 25 16.x,
   26 20.x.  Required first by service.js and proxy.js; does nothing on Node 4.5 and newer.
   Plain ES5: no let/const, arrow functions or other ES2015 syntax (Node 0.12 can't parse them). */
'use strict';
var crypto = require('crypto');

if (typeof Object.assign !== 'function') {
  Object.assign = function (target) {
    if (target == null) throw new TypeError('Cannot convert undefined or null to object');
    var to = Object(target);
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src == null) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) to[k] = src[k];
    }
    return to;
  };
}

// Node 0.12 has no Buffer.from; Node 4.0 to 4.4 inherit Uint8Array.from, which does something else.
if (typeof Buffer.from !== 'function' || (typeof Uint8Array !== 'undefined' && Buffer.from === Uint8Array.from)) {
  Buffer.from = function (value, enc) { return new Buffer(value, enc); };   // eslint-disable-line no-buffer-constructor
}

if (typeof crypto.timingSafeEqual !== 'function') {
  crypto.timingSafeEqual = function (a, b) {
    if (a.length !== b.length) throw new RangeError('Input buffers must have the same length');
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  };
}

module.exports = { node: process.version };
