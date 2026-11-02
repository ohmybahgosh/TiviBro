// Real HTTP integration: temporary WebDAV streams, seeking, redirects and cancellation.
const http = require('http');
const proxy = require('../../service/proxy');
const streams = require('../../service/media-stream');
let fail = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + s.address().port)));
const get = (url, opts = {}) => new Promise((resolve, reject) => {
  const q = http.request(url, opts, r => { let body = ''; r.on('data', d => body += d); r.on('end', () => resolve({status: r.statusCode, headers: r.headers, body})); });
  q.on('error', reject); q.end(opts.body);
});
(async () => {
  const auth = 'Basic ' + Buffer.from('demo:demo').toString('base64'), seen = [];
  let cdnAuth, redirect = false, closed = false;
  const cdn = http.createServer((q, s) => { cdnAuth = q.headers.authorization; s.end('cdn'); });
  const cb = await listen(cdn);
  const server = http.createServer((q, s) => {
    seen.push({url:q.url, auth:q.headers.authorization, range:q.headers.range});
    if (q.headers.authorization !== auth) { s.writeHead(401); return s.end(); }
    if (q.url === '/same.mkv') { s.writeHead(302, {Location:'/movie.mkv'}); return s.end(); }
    if (q.url === '/loop.mkv') { s.writeHead(302, {Location:'/loop.mkv'}); return s.end(); }
    if (q.url === '/bad.mkv') { s.writeHead(302, {Location:'file:///etc/passwd'}); return s.end(); }
    if (q.url === '/malformed.mkv') { s.writeHead(302, {Location:'http://[invalid'}); return s.end(); }
    if (q.url === '/badport.mkv') { s.writeHead(302, {Location:'http://127.0.0.1:99999/video.mkv'}); return s.end(); }
    if (redirect) { s.writeHead(302, {Location:cb + '/movie.mkv'}); return s.end(); }
    if (q.url === '/pause.mkv') { s.writeHead(200); s.write('before'); return setTimeout(() => s.end('after'), 400); }
    if (q.url === '/silent.mkv') return;                       // never answers
    if (q.url === '/slow.mkv' && q.headers.range !== 'bytes=0-0') {
      s.writeHead(200); s.write('start');
      const timer = setInterval(() => s.write('more'), 20);
      s.on('close', () => { clearInterval(timer); closed = true; }); return;
    }
    if (q.headers.range) { s.writeHead(206, {'Content-Range':'bytes 2-4/10', 'Content-Length':'3', 'Accept-Ranges':'bytes'}); return s.end('234'); }
    s.writeHead(200, {'Content-Length':'10', 'Content-Type':'video/x-matroska'}); s.end('0123456789');
  });
  const base = await listen(server), relay = proxy.create({ctl:'secret'}), rb = await listen(relay.server);
  const body = JSON.stringify({source:{type:'webdav',address:base,user:'demo',pass:'demo'},path:'/movie.mkv'});
  let r = await get(rb + '/media/resolve', {method:'POST',headers:{'X-TiviBro-Ctl':'secret'},body});
  const result = JSON.parse(r.body), url = result.url;
  ok('resolve returns an absolute localhost stream URL', url.startsWith(rb + '/media-stream/'));
  ok('resolve keeps credentials and remote paths out of its answer', !r.body.includes(auth) && !r.body.includes('demo'));
  r = await get(url, {headers:{Range:'bytes=2-4'}});
  ok('seek and subtitle requests keep Range, bytes and headers', r.status === 206 && r.body === '234' && r.headers['content-range'] === 'bytes 2-4/10' && r.headers['accept-ranges'] === 'bytes');
  ok('CORS exposes Content-Range to subtitle discovery', /Content-Range/.test(r.headers['access-control-expose-headers']));
  r = await get(url, {method:'HEAD'});
  ok('HEAD returns metadata without a body', r.status === 200 && r.headers['content-length'] === '10' && r.body === '');
  ok('all original-server requests authenticate', seen.every(x => x.auth === auth));
  r = await get(rb + streams.create(base + '/same.mkv', auth, 'mkv'));
  ok('same-origin redirects retain authentication', r.status === 200 && r.body === '0123456789');
  redirect = true; r = await get(url);
  ok('a later redirect to a file server drops authentication', r.status === 200 && r.body === 'cdn' && cdnAuth === undefined);
  redirect = false;
  r = await get(rb + streams.create(base + '/loop.mkv', auth, 'mkv'));
  ok('redirect loops stop', r.status === 502);
  r = await get(rb + streams.create(base + '/bad.mkv', auth, 'mkv'));
  ok('non-HTTP redirects are rejected', r.status === 502);
  r = await get(rb + streams.create(base + '/malformed.mkv', auth, 'mkv'));
  ok('a malformed redirect cannot stop the helper', r.status === 502);
  r = await get(rb + streams.create(base + '/badport.mkv', auth, 'mkv'));
  ok('an invalid redirect port returns an error without hanging playback', r.status === 502);
  r = await get(rb + '/media-stream/' + '0'.repeat(48) + '/movie.mkv');
  ok('unknown tokens cannot stream a file', r.status === 404);
  r = await get(url, {method:'POST'});
  ok('stream endpoints accept GET and HEAD only', r.status === 405);
  const now = Date.now;
  try {
    Date.now = () => now() + 25 * 3600000;
    r = await get(url);
    ok('an expired stream token stops working', r.status === 404);
  } finally { Date.now = now; }
  const slow = rb + streams.create(base + '/slow.mkv', auth, 'mkv');
  await new Promise(resolve => { const q = http.get(slow, s => { s.once('data', () => { q.destroy(); resolve(); }); }); });
  await new Promise(r => setTimeout(r, 80));
  ok('leaving playback aborts the upstream transfer', closed);
  const first = streams.create(base + '/movie.mkv', auth, 'mkv');
  for (let i = 0; i < 16; i++) streams.create(base + '/movie.mkv', auth, 'mkv');
  r = await get(rb + first);
  ok('old sessions are evicted to bound credential storage', r.status === 404);
  const logs = await get(rb + '/log');
  ok('helper logs contain no stream tokens or credentials', !logs.body.includes(url.split('/')[4]) && !logs.body.includes(auth));
  const token = url.split('/')[4];
  ok('stream capabilities are masked in log messages', !proxy.redact(url).includes(token));
  // The wait for an answer is not a limit on the stream: a pause longer than it doesn't cut the movie.
  streams._wait(150);
  r = await get(rb + streams.create(base + '/pause.mkv', auth, 'mkv'));
  ok('a stream that goes quiet for longer than the answer timeout keeps going', r.status === 200 && r.body === 'beforeafter');
  r = await get(rb + streams.create(base + '/silent.mkv', auth, 'mkv'));
  ok('a server that never answers gets 504', r.status === 504);
  streams._wait(20000);
  server.closeAllConnections && server.closeAllConnections();
  await Promise.all([server, cdn, relay.server].map(s => new Promise(r => s.close(r))));
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
