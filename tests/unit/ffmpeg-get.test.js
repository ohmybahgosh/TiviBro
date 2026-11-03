// The audio converter's download (service/ffmpeg.js): fetched from a local server, checked against its
// SHA-256, unpacked, chmod 700, tried with -version, older versions removed; a bad hash is thrown away.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib'), crypto = require('crypto');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-ffmpeg-'));
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'store');
delete process.env.TIVIBRO_FFMPEG;
const F = require('../../service/ffmpeg.js');

// A stand-in for ffmpeg: answers -version like the real one.
const fake = '#!/bin/sh\necho "ffmpeg version 7.1.1-tb Copyright (c) 2000-2025 the FFmpeg developers"\n';
const gz = zlib.gzipSync(Buffer.from(fake)), sum = crypto.createHash('sha256').update(gz).digest('hex');
const broken = zlib.gzipSync(Buffer.from('#!/bin/sh\nexit 3\n')), brokenSum = crypto.createHash('sha256').update(broken).digest('hex');
let hits = [];
const server = http.createServer((q, s) => {
  hits.push(q.url);
  if (q.url === '/moved/tivibro-ffmpeg-armv7.gz') { s.writeHead(302, { Location: '/rel/tivibro-ffmpeg-armv7.gz' }); return s.end(); }
  if (q.url === '/rel/tivibro-ffmpeg-armv7.gz') { s.writeHead(200, { 'Content-Length': gz.length }); return s.end(gz); }
  if (q.url === '/broken/tivibro-ffmpeg-armv7.gz') { s.writeHead(200, { 'Content-Length': broken.length }); return s.end(broken); }
  s.writeHead(404); s.end();
});
const get = () => new Promise((resolve) => F.get((e, st) => resolve({ e, st })));
const status = () => new Promise((resolve) => F.status(resolve));
const bin = () => path.join(process.env.TIVIBRO_KV_DIR, 'bin');

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  // Which build for which TV
  ok('32-bit Node on an aarch64 kernel (C2): armv7', F.arch('arm', 'aarch64') === 'armv7');
  ok('32-bit Node on armv7l: armv7', F.arch('arm', 'armv7l') === 'armv7');
  ok('64-bit Node: aarch64', F.arch('arm64', 'aarch64') === 'aarch64');
  ok('a computer: none', F.arch('x64', 'x86_64') === '');
  ok('the release hashes are real SHA-256s', ['armv7', 'aarch64'].every((a) => /^[0-9a-f]{64}$/.test(F.SHA256[a])));
  ok('the tag is in the download address', F.BASE === 'https://github.com/ohmybahgosh/TiviBro/releases/download/' + F.TAG + '/' && F.TAG === 'ffmpeg-7.1-tb1');

  F._config({ arch: 'armv7' });
  let st = await status();
  ok('nothing yet: none', st.state === 'none', st);

  // Placeholder hashes: never downloads, never runs anything.
  F._config({ base: base + '/rel/', sums: { armv7: 'TODO-SHA256-ARMV7' } });
  let r = await get();
  ok('placeholder hash: refuses, says it is not published', r.e && /not been published/.test(r.e.message) && hits.length === 0, r.e && r.e.message);

  // A bad hash: downloaded, thrown away, nothing left that could run.
  F._config({ sums: { armv7: 'a'.repeat(64) } });
  r = await get();
  ok('bad hash: failed, says why', r.e && /did not match/.test(r.e.message) && r.st.state === 'failed', r.e && r.e.message);
  ok('bad hash: nothing kept in bin', fs.readdirSync(bin()).length === 0, fs.readdirSync(bin()));

  // An older version and a leftover are cleared once the new one is in place.
  fs.writeFileSync(path.join(bin(), 'ffmpeg-7.0-tb0-armv7'), 'old');
  fs.writeFileSync(path.join(bin(), 'ffmpeg-7.1-tb1-armv7.part'), 'half');
  hits = [];
  F._config({ base: base + '/moved/', sums: { armv7: sum } });
  const progress = [];
  const p = get();
  st = await status();
  progress.push(st.state);
  r = await p;
  ok('good hash (after a redirect): ready', !r.e && r.st.state === 'ready', r);
  ok('it followed the redirect', hits.join(',') === '/moved/tivibro-ffmpeg-armv7.gz,/rel/tivibro-ffmpeg-armv7.gz', hits);
  ok('status said downloading meanwhile', progress[0] === 'downloading', progress);
  ok('version from -version', r.st.version === '7.1.1-tb', r.st);
  ok('size and where', r.st.size === fake.length && r.st.where === 'set by TIVIBRO_KV_DIR', r.st);
  const f = path.join(bin(), 'ffmpeg-7.1-tb1-armv7');
  ok('named with its version, in the storage folder\'s bin', F.binary() === f && fs.existsSync(f), F.binary());
  ok('chmod 700', (fs.statSync(f).mode & 0o777) === 0o700, (fs.statSync(f).mode & 0o777).toString(8));
  ok('unpacked (the binary, not the .gz)', fs.readFileSync(f, 'utf8') === fake);
  ok('older version and leftovers removed', fs.readdirSync(bin()).join(',') === 'ffmpeg-7.1-tb1-armv7', fs.readdirSync(bin()));
  st = await status();
  ok('status: ready afterwards', st.state === 'ready' && st.path === f, st);

  // A binary that doesn't run is not kept.
  F._config({ base: base + '/broken/', sums: { armv7: brokenSum } });
  fs.unlinkSync(f);
  r = await get();
  ok('a binary that does not run: failed, removed', r.e && /does not run/.test(r.e.message) && fs.readdirSync(bin()).length === 0, r.e && r.e.message);

  // Remove
  F._config({ base: base + '/rel/', sums: { armv7: sum } });
  r = await get();
  ok('downloaded again', !r.e && r.st.state === 'ready', r);
  r = await new Promise((resolve) => F.remove((e, s) => resolve({ e, s })));
  ok('remove: gone, status none', !r.e && r.s.state === 'none' && fs.readdirSync(bin()).length === 0, r);

  // Two asks at once: one download.
  hits = [];
  const both = await Promise.all([get(), get()]);
  ok('two asks at once share one download', hits.length === 1 && both.every((x) => x.st.state === 'ready'), hits);

  // TIVIBRO_FFMPEG wins
  process.env.TIVIBRO_FFMPEG = f;
  st = await status();
  ok('TIVIBRO_FFMPEG: ready, where says so', st.state === 'ready' && st.where === 'set by TIVIBRO_FFMPEG', st);
  delete process.env.TIVIBRO_FFMPEG;

  // A computer is no TV: no download.
  F._config({ arch: '' });
  if (F.arch() === '') { r = await get(); ok('not an ARM TV: refuses', r.e && /not an LG TV/.test(r.e.message), r.e && r.e.message); }

  // The routes
  F._config({ arch: 'armv7' });
  const req = (method, url) => new Promise((resolve) => {
    const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; resolve(this); } };
    const q = new (require('events'))(); q.method = method; q.url = url; q.resume = () => {};
    F.handle(q, res, {});
  });
  let rr = await req('GET', '/ffmpeg/status');
  ok('GET /ffmpeg/status answers JSON', rr.code === 200 && JSON.parse(rr.body).state === 'ready', rr.body);
  rr = await req('POST', '/ffmpeg/remove');
  ok('POST /ffmpeg/remove', rr.code === 200 && JSON.parse(rr.body).state === 'none', rr.body);
  rr = await req('GET', '/ffmpeg/nope');
  ok('unknown route: 404', rr.code === 404);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' failed' : 'all passed');
  process.exit(fail ? 1 : 0);
});
