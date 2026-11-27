// The helper's My media routes refuse an object's built-in property names (__proto__, constructor, prototype) as a
// key or an ID (service/media.js protoNamed): their IDs are looked up in plain objects, and "constructor" found
// Object itself, "__proto__" the prototype every object shares.
'use strict';
const media = require('../../service/media.js');
const { EventEmitter } = require('events');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
// One POST to a media route with [body]: resolves with the status code.
function post(url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter(); req.method = 'POST'; req.url = url; req.headers = {}; req.setEncoding = () => {};
    const res = { writeHead(code) { this.code = code; }, setHeader() {}, end() { resolve(this.code); } };
    media.handle(req, res, '*', () => {});
    req.emit('data', body); req.emit('end');
  });
}
(async () => {
  ok('a subtitle scan asked for job "constructor" is refused', await post('/media/subs/lines', JSON.stringify({ key: 'constructor' })) === 400);
  ok('a library change for source "__proto__" is refused', await post('/media/library/source', JSON.stringify({ sourceId: '__proto__' })) === 400);
  ok('a body with a __proto__ key is refused', await post('/media/subs/lines', '{"__proto__":{"x":1},"key":"a"}') === 400);
  ok('nothing reached the shared prototype', ({}).x === undefined && ({}).active === undefined);
  console.log(fails ? fails + ' failures' : 'all media proto tests passed');
  process.exit(fails ? 1 : 0);
})();
