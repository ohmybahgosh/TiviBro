// Issue #34: a movie paused on the TV goes quiet (the player stops reading, so the provider stops
// sending).  The helper must not cut such a read as a dead server: on play the movie carries on.  A
// request that is not a movie read (no Range) still gives up on a provider that goes silent.
//   node tests/unit/proxy-pause.test.js
const http = require('http'), path = require('path');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const get = (url, headers) => new Promise((res) => {
  const r = http.get(url, { headers: headers || {} }, (rs) => {
    let b = '', ended = false;
    rs.on('data', d => { b += d; });
    rs.on('end', () => { ended = true; res({ status: rs.statusCode, body: b, ended }); });
    rs.on('aborted', () => res({ status: rs.statusCode, body: b, ended: false }));
    rs.on('error', () => res({ status: rs.statusCode, body: b, ended: false }));
  });
  r.on('error', e => res({ status: 0, body: e.message, ended: false }));
});
(async () => {
  // The "provider": sends the first part, goes quiet for 1.2 s (a paused viewer), then the rest.
  const up = http.createServer((req, res) => {
    const range = req.headers.range;
    res.writeHead(range ? 206 : 200, Object.assign({ 'Content-Type': 'video/x-matroska', 'Content-Length': 10 }, range ? { 'Content-Range': 'bytes 0-9/10' } : {}));
    res.write('hello');
    setTimeout(() => { try { res.end('world'); } catch (e) {} }, 1200);
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({ timeout: 300 }); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;
  const movie = await get(B + '/x/http/' + U + '/movie/u/p/1.mkv', { Range: 'bytes=0-' });
  ok('a movie read that goes quiet longer than the timeout is not cut', movie.status === 206 && movie.ended && movie.body === 'helloworld', JSON.stringify(movie));
  const other = await get(B + '/x/http/' + U + '/player_api.php');
  ok('a request without Range that goes quiet is still cut', !(other.ended && other.body === 'helloworld'), JSON.stringify(other));
  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all paused-read relay tests passed');
  process.exit(fail ? 1 : 0);
})();
