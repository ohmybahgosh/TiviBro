// The helper unzips guides for the app (/unz/<id>/x/... prefix): .gz files however they are
// labelled, Content-Encoding gzip and deflate, files zipped twice, plain files passed through,
// broken files reported, and the compressed byte count at /xfer/<id>.  Self-contained.
const http = require('http'), path = require('path'), zlib = require('zlib');
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const get = (url, headers) => new Promise((res, rej) => http.get(url, { headers: headers || {} }, (r) => {
  const parts = []; r.on('data', d => parts.push(d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) }));
}).on('error', rej));

// A guide big enough to arrive in many chunks.
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
for (let i = 0; i < 20000; i++) xml += '<programme start="20261027200000 +0000" stop="20261027210000 +0000" channel="ch' + (i % 50) + '"><title>Show ' + i + ' ünïcödé</title></programme>\n';
xml += '</tv>\n';
const XML = Buffer.from(xml), GZ = zlib.gzipSync(XML), GZ2 = zlib.gzipSync(GZ), DEF = zlib.deflateSync(XML);

(async () => {
  const up = http.createServer((req, res) => {
    const send = (h, body) => { res.writeHead(200, Object.assign({ 'Content-Length': body.length }, h)); res.end(body); };
    if (req.url === '/guide.xml') return send({ 'Content-Type': 'application/xml' }, XML);
    if (req.url === '/guide.xml.gz') return send({ 'Content-Type': 'application/gzip' }, GZ);
    if (req.url === '/xmltv.php') return send({ 'Content-Type': 'text/html' }, GZ);                          // gzipped, says nothing
    if (req.url === '/enc-gzip') return send({ 'Content-Type': 'application/xml', 'Content-Encoding': 'gzip' }, GZ);
    if (req.url === '/enc-deflate') return send({ 'Content-Type': 'application/xml', 'Content-Encoding': 'deflate' }, DEF);
    if (req.url === '/double.xml.gz') return send({ 'Content-Type': 'application/gzip', 'Content-Encoding': 'gzip' }, GZ2);
    if (req.url === '/broken.xml.gz') return send({ 'Content-Type': 'application/gzip' }, Buffer.concat([GZ.slice(0, 2000), Buffer.alloc(3000, 7)]));
    if (req.url === '/empty') return send({ 'Content-Type': 'application/xml' }, Buffer.alloc(0));
    if (req.url === '/move') { res.writeHead(302, { Location: '/guide.xml.gz' }); return res.end(); }
    if (req.url === '/ae') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(req.headers['accept-encoding'] || ''); }
    res.writeHead(404); res.end();
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const B = 'http://127.0.0.1:' + r.server.address().port;
  const unz = (id, p) => get(B + '/unz/' + id + '/x/http/' + U + p);

  let a = await unz('t1', '/guide.xml.gz');
  ok('.xml.gz file comes out as XML', a.status === 200 && a.body.equals(XML), a.body.length + ' bytes');
  ok('marked X-Unzipped: gzip with the zipped size', a.headers['x-unzipped'] === 'gzip' && +a.headers['x-raw-length'] === GZ.length, JSON.stringify([a.headers['x-unzipped'], a.headers['x-raw-length']]));
  ok('no stale Content-Length or Content-Encoding', !a.headers['content-length'] && !a.headers['content-encoding']);
  ok('content type becomes XML', /xml/.test(a.headers['content-type']), a.headers['content-type']);
  ok('CORS exposes the unzip headers', /X-Unzipped/.test(a.headers['access-control-expose-headers']) && a.headers['access-control-allow-origin'] === '*');
  let x = JSON.parse((await get(B + '/xfer/t1')).body);
  ok('/xfer reports the compressed bytes, total and done', x.raw === GZ.length && x.total === GZ.length && x.done === true, JSON.stringify(x));

  a = await unz('t2', '/guide.xml');
  ok('plain XML passes through unchanged', a.body.equals(XML) && !a.headers['x-unzipped'] && +a.headers['content-length'] === XML.length);
  a = await unz('t3', '/xmltv.php');
  ok('gzip with no label is still unzipped', a.body.equals(XML) && a.headers['x-unzipped'] === 'gzip');
  a = await unz('t4', '/enc-gzip');
  ok('Content-Encoding: gzip is undone', a.body.equals(XML) && a.headers['x-unzipped'] === 'gzip');
  a = await unz('t5', '/enc-deflate');
  ok('Content-Encoding: deflate is undone', a.body.equals(XML) && a.headers['x-unzipped'] === 'deflate');
  a = await unz('t6', '/double.xml.gz');
  ok('a .gz file sent gzipped again is unzipped twice', a.body.equals(XML) && a.headers['x-unzipped'] === 'gzip+gzip', a.headers['x-unzipped']);
  a = await unz('t7', '/empty');
  ok('an empty answer stays empty', a.status === 200 && a.body.length === 0);
  a = await unz('t8', '/move');
  ok('redirects keep the unzip prefix', a.status === 302 && a.headers.location === B + '/unz/t8/x/http/' + U + '/guide.xml.gz', a.headers.location);
  a = await unz('t9', '/ae');
  ok('asks the server for gzip or deflate', /gzip/.test(a.body.toString()) && /deflate/.test(a.body.toString()), a.body.toString());
  a = await get(B + '/ua/VGVzdA/unz/t10/x/http/' + U + '/guide.xml.gz');
  ok('works together with a custom User-Agent prefix', a.body.equals(XML));

  const broken = await new Promise(res => {
    http.get(B + '/unz/t11/x/http/' + U + '/broken.xml.gz', (resp) => {
      let n = 0; resp.on('data', d => { n += d.length; }); resp.on('end', () => res({ status: resp.statusCode, n, ended: true })); resp.on('error', () => res({ status: resp.statusCode, n, ended: false }));
      resp.on('aborted', () => res({ status: resp.statusCode, n, ended: false }));
    }).on('error', () => res({ status: 0, n: 0, ended: false }));
  });
  ok('a broken .gz file fails cleanly instead of hanging', broken.status === 502 || !broken.ended || broken.n < XML.length, JSON.stringify(broken));
  a = await get(B + '/ping');
  ok('the helper is still running afterwards', a.status === 200);

  a = await get(B + '/x/http/' + U + '/guide.xml.gz');
  ok('without the prefix, .gz files pass through as they are (video and playlists untouched)', a.body.equals(GZ) && !a.headers['x-unzipped']);
  x = JSON.parse((await get(B + '/xfer/nothing')).body);
  ok('/xfer for an unknown id answers unknown', x.unknown === true);

  r.server.close(); up.close();
  console.log(fail ? fail + ' failures' : 'all unzip tests passed');
  process.exit(fail ? 1 : 0);
})();
