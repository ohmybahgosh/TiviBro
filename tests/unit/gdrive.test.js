// My media from Google Drive (service/gdrive.js, service/media.js): the service account's key signs a
// JWT for a read-only token, a shared drive is listed flat and a folder elsewhere folder by folder, a scan
// finds movies and TV episodes, a file plays through the localhost stream with a fresh token, the change
// check, the folder pickers, and the key kept out of answers and the log.  A mock Drive on localhost
// (TIVIBRO_GDRIVE_API, TIVIBRO_GDRIVE_TOKEN), with a key made here, no real account.
//   node tests/unit/gdrive.test.js
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-gdrive-'));
const Gdrive = require('../../service/gdrive.js');
const Media = require('../../service/media.js');
const proxy = require('../../service/proxy.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fail++; };
const scan = (src) => new Promise((f) => Media.scan(src, f));
const resolve = (src, p) => new Promise((f) => Media.resolve(src, p, f));
const waits = []; Gdrive._wait = (ms) => { waits.push(ms); return 1; };

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const KEY = JSON.stringify({ type: 'service_account', project_id: 'tb-test', private_key_id: 'abc123def456', private_key: PEM, client_email: 'tivibro@tb-test.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://evil.example/token' });
const OTHER = JSON.stringify({ type: 'service_account', private_key_id: 'ffff', private_key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'stranger@x.iam.gserviceaccount.com' });

/* ---------- the mock Drive ---------- */
const F = 'application/vnd.google-apps.folder';
const files = [];
let n = 0;
function add(name, parent, mime, size) { const id = 'id' + String(++n).padStart(6, '0') + 'x'; files.push({ id, name, parents: [parent], mimeType: mime || F, size: size ? String(size) : undefined, modifiedTime: '2026-10-0' + (n % 9 + 1) + 'T10:00:00.000Z', driveId: parent === 'DRIVE00001' || files.some((x) => x.id === parent && x.driveId) ? 'DRIVE00001' : undefined }); return id; }
const M = add('GD-M', 'DRIVE00001'), T = add('GD-T', 'DRIVE00001');
const mov = add('Movie (2020)', M); add('Movie.2020.1080p.mkv', mov, 'video/x-matroska', 4.2e9); add('Movie.2020.srt', mov, 'application/x-subrip', 9e4);
const fro = add('Frozen (2013)', M); add('FROZEN.mkv', fro, 'application/octet-stream', 5e9);
const show = add('Show Name', T), s1 = add('Season 01', show); add('Show.Name.S01E01.mkv', s1, 'video/x-matroska', 9e8); add('Show.Name.S01E02.mkv', s1, 'video/x-matroska', 9.1e8);
add('Outside.2018.mkv', 'DRIVE00001', 'video/x-matroska', 3e9);
const shared = 'SHAREDFOLDER1';   // a My Drive folder shared with the account
const sm = add('Shared Movie (2001)', shared); add('Shared.Movie.2001.mkv', sm, 'video/mp4', 2e9);
const mock = { tokenCalls: 0, valid: {}, n: 0, expires: 3600, pageSize: 3, calls: {}, rate: 0, revoke: false, changes: [], streamAuth: [], expire: false };
function inParents(q) { const m = q.match(/'([A-Za-z0-9_-]+)' in parents/g); return m ? m.map((x) => x.slice(1, x.indexOf("'", 1))) : null; }
const api = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), route = u.pathname;
    mock.calls[route] = (mock.calls[route] || 0) + 1;
    const send = (code, obj, h) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, h || {})); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (route === '/token') {
      mock.tokenCalls++;
      const q = new URLSearchParams(body), jwt = String(q.get('assertion') || '').split('.');
      if (q.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || jwt.length !== 3) return send(400, { error: 'invalid_request' });
      const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
      const good = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), pair.publicKey, Buffer.from(jwt[2], 'base64url'));
      mock.lastClaims = claims;
      if (!good || claims.iss !== 'tivibro@tb-test.iam.gserviceaccount.com' || mock.revoke) return send(400, { error: 'invalid_grant' });
      const t = 'ya29.AT' + (++mock.n); mock.valid[t] = true;
      return send(200, { access_token: t, expires_in: mock.expires, token_type: 'Bearer' });
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (/^\/drive\/v3\/files\/[^/]+$/.test(route) && u.searchParams.get('alt') === 'media') {
      mock.streamAuth.push(auth && auth[1]);
      if (!auth || !mock.valid[auth[1]] || mock.expire) { mock.expire = false; return send(401, { error: { code: 401 } }); }
      const f = files.find((x) => x.id === route.split('/').pop());
      if (!f) return send(404, {});
      res.writeHead(206, { 'Content-Type': 'video/x-matroska', 'Content-Range': 'bytes 0-3/' + f.size, 'Content-Length': 4, 'Accept-Ranges': 'bytes' });
      return res.end('MKV!');
    }
    if (!auth || !mock.valid[auth[1]]) return send(401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (mock.rate > 0) { mock.rate--; return send(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }); }
    const p = u.searchParams;
    if (route === '/drive/v3/drives') return send(200, { drives: [{ id: 'DRIVE00001', name: 'GD-SHARED' }] });
    if (route === '/drive/v3/changes/startPageToken') return send(200, { startPageToken: '100' });
    if (route === '/drive/v3/changes') {
      if (p.get('pageToken') === 'gone') return send(410, {});
      const c = mock.changes; mock.changes = [];
      return send(200, { newStartPageToken: String(+p.get('pageToken') + c.length), changes: c });
    }
    if (route === '/drive/v3/files') {
      const q = p.get('q') || '';
      if (/sharedWithMe/.test(q)) return send(200, { files: [{ id: shared, name: 'Movies from Sam' }] });
      let list = files.filter((f) => !/mimeType='application\/vnd/.test(q) || /contains 'video\//.test(q) || f.mimeType === F);
      if (/contains 'video\//.test(q)) list = list.filter((f) => f.mimeType === F || /^video\//.test(f.mimeType) || f.mimeType === 'application/octet-stream' || f.mimeType === 'application/x-matroska');
      const parents = inParents(q);
      if (parents) list = list.filter((f) => parents.indexOf(f.parents[0]) >= 0);
      else if (p.get('corpora') === 'drive') list = list.filter((f) => f.driveId === p.get('driveId'));
      if (/in parents and mimeType='application\/vnd.google-apps.folder'/.test(q)) list = list.filter((f) => f.mimeType === F);
      if (parents && parents.some((x) => /^NOPE/.test(x))) return send(404, { error: { code: 404 } });
      const off = +(p.get('pageToken') || 0), part = list.slice(off, off + mock.pageSize);
      return send(200, { files: part, nextPageToken: off + mock.pageSize < list.length ? String(off + mock.pageSize) : undefined });
    }
    send(404, {});
  });
});

(async () => {
  await new Promise((f) => api.listen(0, '127.0.0.1', f));
  const base = 'http://127.0.0.1:' + api.address().port;
  process.env.TIVIBRO_GDRIVE_API = base; process.env.TIVIBRO_GDRIVE_TOKEN = base + '/token';
  const src = { id: 'sgd1', type: 'gdrive', name: 'GD-M', root: M, driveId: 'DRIVE00001', key: KEY, contentMode: 'automatic' };

  // The key.
  ok('a service account key is read', Gdrive.parseKey(KEY).email === 'tivibro@tb-test.iam.gserviceaccount.com');
  ok('anything else is not', !Gdrive.parseKey('{"type":"authorized_user"}') && !Gdrive.parseKey('nope') && !Gdrive.parseKey({ client_email: 'a@b.com', private_key: 'x' }));
  ok('the kept key has only what signing needs', JSON.stringify(Object.keys(JSON.parse(Gdrive.keyText(KEY)))) === '["type","client_email","private_key_id","private_key"]');

  // Tokens: a signed JWT, read-only, one for calls made together.
  const calls = await Promise.all([1, 2, 3].map(() => new Promise((f) => Gdrive.accessToken(KEY, (e, t) => f(e || t)))));
  ok('one token for calls made together', mock.tokenCalls === 1 && calls.every((t) => t === calls[0]) && /^ya29\.AT/.test(calls[0]), calls);
  ok('the JWT asks for read-only Drive', mock.lastClaims.scope === 'https://www.googleapis.com/auth/drive.readonly' && mock.lastClaims.exp - mock.lastClaims.iat <= 3600, mock.lastClaims);
  ok('and always goes to Google\'s token address, whatever the key says', mock.lastClaims.aud === 'https://oauth2.googleapis.com/token');
  ok('a key Google refuses is a login failure', (await new Promise((f) => Gdrive.accessToken(OTHER, f))).kind === 'login');

  // The pickers.
  const places = await new Promise((f) => Gdrive.places(KEY, (e, p) => f(e || p)));
  ok('places: the shared drive and the shared folder', JSON.stringify(places.map((p) => p.name + ':' + p.kind)) === '["GD-SHARED:drive","Movies from Sam:folder"]', places);
  const top = await new Promise((f) => Gdrive.folders(KEY, 'DRIVE00001', 'DRIVE00001', (e, p) => f(e || p)));
  ok('folders in the drive, folders only', top.map((x) => x.name).join() === 'GD-M,GD-T', top);

  // A scan of a folder in a shared drive: one flat listing of the drive.
  mock.calls = {};
  let r = await scan(src);
  ok('a scan answers without an error', !r.error && Array.isArray(r.movies), r);
  ok('the movies in GD-M with their folder titles', JSON.stringify(r.movies.map((m) => m.title + '|' + m.year).sort()) === '["Frozen|2013","Movie|2020"]', r.movies.map((m) => m.title));
  const mv = r.movies.find((m) => m.title === 'Movie');
  ok('a movie id is g: + its id, and it plays by id', /^g:id\d+x$/.test(mv.id) && mv.path === 'gd:' + mv.id.slice(2) + '/Movie (2020)/Movie.2020.1080p.mkv', mv);
  ok('a file Drive calls octet-stream still counts by its name', r.movies.some((m) => m.title === 'Frozen'));
  ok('subtitles, other folders and files beside the folder are left out', !JSON.stringify(r).match(/Outside|\.srt|S01E0/));
  ok('the drive is listed flat, not folder by folder', mock.calls['/drive/v3/files'] === Math.ceil(files.filter((f) => f.driveId).length / 3), mock.calls);
  ok('the key is not in the answer', JSON.stringify(r).indexOf('PRIVATE KEY') < 0);
  r = await scan(Object.assign({}, src, { root: T, name: 'GD-T' }));
  const eps = (r.files || []).filter((f) => f.kind === 'episode');
  ok('GD-T: both episodes with their show and season', eps.length === 2 && JSON.stringify(eps[0].ancestors) === '["Show Name","Season 01"]', (r.files || []).map((f) => f.file + ':' + f.kind));
  r = await scan(Object.assign({}, src, { root: 'DRIVE00001' }));
  ok('the whole shared drive as the library', r.movies.length === 3 && (r.files || []).filter((f) => f.kind === 'episode').length === 2, r.movies.map((m) => m.title));

  // A folder elsewhere: folder by folder.
  r = await scan({ id: 'sgd2', type: 'gdrive', name: 'Sam', root: shared, key: KEY, contentMode: 'movies' });
  ok('a shared folder outside a shared drive', r.movies.length === 1 && r.movies[0].title === 'Shared Movie' && r.movies[0].year == 2001, r);
  ok('a folder that is gone says so', (await scan({ id: 'x', type: 'gdrive', root: 'NOPE12345', key: KEY, contentMode: 'movies' })).error === 'address');

  // A big library goes on from where it stopped.
  let slices = 0, cont = null, last = null;
  do { last = await scan(Object.assign({}, src, { scanFolderBudget: 1, _continuation: cont })); cont = last._continuation; slices++; } while (cont && slices < 30);
  ok('a paused scan goes on to the end', slices > 1 && last.movies.length === 2 && !last.partial, { slices, n: last.movies.length });
  slices = 0; cont = null;
  do { last = await scan({ id: 'sgd2', type: 'gdrive', root: shared, key: KEY, contentMode: 'movies', scanFolderBudget: 1, _continuation: cont }); cont = last._continuation; slices++; } while (cont && slices < 30);
  ok('folder by folder too', slices > 1 && last.movies.length === 1, { slices, n: last.movies.length });

  // Rate limits wait and try again.
  waits.length = 0; mock.rate = 2;
  r = await scan(src);
  ok('a rate limit waits and tries again', !r.error && waits.length === 2, { waits, e: r.error });

  // Playing: through localhost, with a fresh token, never in the address.
  const relay = proxy.create({}); await new Promise((f) => relay.server.listen(0, '127.0.0.1', f));
  const port = relay.server.address().port;
  const post = (u, body) => fetch('http://127.0.0.1:' + port + u, { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  proxy.LOG.length = 0;
  let a = await post('/media/resolve', { source: src, path: mv.path });
  ok('resolve gives a localhost stream', /^http:\/\/127\.0\.0\.1:\d+\/media-stream\/[a-f0-9]{48}\/movie\.mkv$/.test(a.url || ''), a);
  ok('with no token in it', !/ya29/.test(a.url));
  let got = await fetch(a.url, { headers: { Range: 'bytes=0-3' } });
  ok('the stream plays the file with the token', got.status === 206 && (await got.text()) === 'MKV!' && /^ya29\.AT/.test(mock.streamAuth.pop()), got.status);
  mock.expire = true; mock.streamAuth = [];
  got = await fetch(a.url, { headers: { Range: 'bytes=0-3' } });
  ok('a token Drive stops taking is renewed once, and the file plays', got.status === 206 && mock.streamAuth.length === 2 && mock.streamAuth[0] !== mock.streamAuth[1], mock.streamAuth);
  ok('a path without an id says so', (await resolve(src, '/Movie (2020)/x.mkv')).error === 'address');
  ok('resolve with a refused key', (await resolve(Object.assign({}, src, { key: OTHER }), mv.path)).error === 'login');

  // The change check.
  const check = (s, t) => new Promise((f) => Media.changeCheck(s, t, f));
  let c = await check(src, '');
  ok('the first check gives a token, no change', c.token === 'gdc:100' && !c.changed, c);
  c = await check(src, c.token);
  ok('nothing new: no change', !c.changed, c);
  mock.changes = [{ fileId: 'n1', file: { name: 'New.Movie.2026.mkv', mimeType: 'video/x-matroska' } }];
  c = await check(src, c.token);
  ok('a new video is a change', c.changed && c.count === 1, c);
  mock.changes = [{ fileId: 'n2', file: { name: 'poster.jpg', mimeType: 'image/jpeg' } }];
  ok('a picture is not', !(await check(src, c.token)).changed);
  c = await check(src, 'gdc:gone');
  ok('an expired token starts over and counts as a change', c.changed && c.token === 'gdc:100', c);
  const own = { type: 'gdrive', root: shared, key: KEY };
  c = await check(own, '');
  const c2 = await check(own, c.token);
  ok('a folder outside a shared drive: its top level', /^gdt:[a-f0-9]{20}$/.test(c.token) && !c2.changed, c);
  add('Brand New (2026)', shared);
  ok('a new folder there is a change', (await check(own, c.token)).changed);

  // The routes and the log.
  a = await post('/media/gdrive/places', { key: KEY });
  ok('the places route, with the account', a.account === 'tivibro@tb-test.iam.gserviceaccount.com' && a.places.length === 2, a);
  a = await post('/media/gdrive/folders', { key: KEY, parent: M, driveId: 'DRIVE00001' });
  ok('the folders route', a.folders.length === 2 && a.folders.some((f) => f.name === 'Movie (2020)'), a);
  a = await post('/media/gdrive/places', { key: '{}' });
  ok('a route without a key', a.error === 'login' && /Google Drive/.test(a.message), a);
  a = await post('/media/scan', { source: src });
  ok('the scan route works for Google Drive', !a.error && a.movies.length === 2, a);
  const logged = JSON.stringify(proxy.LOG);
  ok('the log never has the key or a token', logged.indexOf('PRIVATE') < 0 && !/ya29/.test(logged) && logged.indexOf(PEM.slice(40, 80)) < 0);
  ok('the log names Google Drive calls by kind', /gdrive places/.test(logged) && /"host":"gdrive"/.test(logged), logged.slice(0, 400));

  relay.server.close(); api.close();
  console.log(fail ? fail + ' failed' : 'all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
