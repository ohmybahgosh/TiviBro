/* A Dolby Vision conversion answers with a length (service/convert.js dvLength): without one, LG's player showed
   the picture black with the sound playing (Nov 28, Plex Dolby Vision 8 with dialogue boost).
     node tests/unit/convert-dv.test.js */
'use strict';
const C = require('../../service/convert.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const S = { dv: true, est: 1000, written: 0, total() { return Math.max(this.est, this.written + 64); } };
let r = C._dvLength(S, 0, null);
ok('from the start: 200 with the guessed total as its length', r && r.code === 200 && r.h['Content-Length'] === 1000, r);
r = C._dvLength(S, 0, 262143);
ok('a probe of the first bytes: 206 with just those', r && r.code === 206 && r.h['Content-Length'] === 262144 && r.h['Content-Range'] === 'bytes 0-262143/1000', r);
r = C._dvLength(S, 400, null);
ok('from a later byte: 206 to the end of the guess', r && r.code === 206 && r.h['Content-Length'] === 600 && r.h['Content-Range'] === 'bytes 400-999/1000', r);
ok('not Dolby Vision: left as it was (no length)', C._dvLength({ dv: false, est: 1000, total() { return 1000; } }, 0, null) === null);
ok('no guess at the size: no length', C._dvLength({ dv: true, est: 0, total() { return 64; } }, 0, null) === null);
console.log(fails ? fails + ' FAILED' : 'all Dolby Vision length checks passed');
process.exit(fails ? 1 : 0);
