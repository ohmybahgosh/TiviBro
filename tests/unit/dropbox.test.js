// My media from Dropbox (service/dropbox.js, service/media.js, and the app's side of it): access tokens
// from the refresh token, the recursive listing with /continue, a scan into movies and TV episodes, the
// temporary link a movie plays from, sign-in and rate-limit errors, and the refresh token and temporary
// links kept out of the log, checkpoints, backups and the phone's replies.  A mock Dropbox on
// localhost (TIVIBRO_DROPBOX_API), no real account.
//   node tests/unit/dropbox.test.js
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dropbox-'));
const Dropbox = require('../../service/dropbox.js');
const Media = require('../../service/media.js');
const proxy = require('../../service/proxy.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fail++; };
const scan = (src) => new Promise((f) => Media.scan(src, f));
const resolve = (src, p) => new Promise((f) => Media.resolve(src, p, f));

const REFRESH = 'rt-GOOD-refresh-0123456789abcdefXYZ';
/* ---------- the mock Dropbox ---------- */
const mock = { refresh: REFRESH, expires: 14400, tokenCalls: 0, valid: {}, n: 0, pageSize: 3, limits: [], calls: {}, fail429: {}, retryAfter: '1', links: 0, revoked: 0, expireCursor: false };
const tree = [
  ['folder', '/Media'], ['folder', '/Media/Show Name'], ['folder', '/Media/Show Name/Season 01'],
  ['file', '/Media/Show Name/Season 01/Show.Name.S01E01.mkv', 900e6], ['file', '/Media/Show Name/Season 01/Show.Name.S01E02.mkv', 910e6],
  ['folder', '/Media/Movie (2020)'], ['file', '/Media/Movie (2020)/Movie.2020.1080p.mkv', 4.2e9], ['file', '/Media/Movie (2020)/Movie.2020.1080p.srt', 9e4],
  ['folder', '/Media/$RECYCLE.BIN'], ['file', '/Media/$RECYCLE.BIN/Old.2001.mkv', 3e9],
  ['file', '/Media/Loose.Film.2019.720p.mp4', 2e9], ['file', '/Media/readme.txt', 10],
  ['folder', '/Films'], ['file', '/Films/Outside.2018.mkv', 3e9],
  ['folder', '/Media/Kids'], ['folder', '/Media/Kids/Frozen (2013)'], ['file', '/Media/Kids/Frozen (2013)/FROZEN.mkv', 5e9]
].map(([tag, p, size]) => ({ '.tag': tag, name: p.split('/').pop(), path_display: p, path_lower: p.toLowerCase(), id: 'id:' + p.length, size: size, rev: tag === 'file' ? 'r' + p.length : undefined, server_modified: tag === 'file' ? '2026-10-01T10:00:00Z' : undefined }));
function under(p, recursive) {
  const low = String(p || '').toLowerCase();
  return tree.filter((e) => {
    if (low && e.path_lower.indexOf(low + '/') !== 0) return false;
    const rest = e.path_lower.slice(low.length + 1);
    return recursive || rest.indexOf('/') < 0;
  });
}
function page(list, off, cur) {
  const part = list.slice(off, off + mock.pageSize), more = off + mock.pageSize < list.length;
  return { entries: part, cursor: Buffer.from(JSON.stringify({ p: cur.p, r: cur.r, off: off + mock.pageSize })).toString('base64'), has_more: more };
}
const api = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const route = req.url.replace(/^\/2\//, '');
    mock.calls[route] = (mock.calls[route] || 0) + 1;
    const send = (code, obj, h) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, h || {})); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (mock.fail429[route] > 0) { mock.fail429[route]--; return send(429, { error_summary: 'too_many_requests/' }, { 'Retry-After': mock.retryAfter }); }
    if (req.url === '/oauth2/token') {
      mock.tokenCalls++;
      const q = new URLSearchParams(body);
      if (q.get('grant_type') !== 'refresh_token' || q.get('client_id') !== Dropbox.APP_KEY) return send(400, { error: 'invalid_request' });
      if (q.get('refresh_token') !== mock.refresh) return send(400, { error: 'invalid_grant', error_description: 'refresh token is invalid or revoked' });
      const t = 'sl.AT' + (++mock.n); mock.valid[t] = true;
      return send(200, { access_token: t, expires_in: mock.expires, token_type: 'bearer' });
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !mock.valid[auth[1]]) return send(401, { error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } });
    const j = body && body !== 'null' ? JSON.parse(body) : null;
    if (route === 'files/list_folder') {
      mock.limits.push(j.limit);
      const p = j.path;
      if (p && !tree.some((e) => e.path_lower === p.toLowerCase() && e['.tag'] === 'folder')) return send(409, { error_summary: 'path/not_found/..', error: { '.tag': 'path' } });
      return send(200, page(under(p, j.recursive), 0, { p, r: j.recursive }));
    }
    if (route === 'files/list_folder/continue') {
      if (mock.expireCursor) { mock.expireCursor = false; return send(409, { error_summary: 'reset/...', error: { '.tag': 'reset' } }); }
      const c = JSON.parse(Buffer.from(j.cursor, 'base64').toString());
      return send(200, page(under(c.p, c.r), c.off, c));
    }
    if (route === 'files/get_temporary_link') {
      if (!tree.some((e) => e.path_lower === String(j.path).toLowerCase())) return send(409, { error_summary: 'path/not_found/.', error: { '.tag': 'path' } });
      mock.links++;
      return send(200, { metadata: {}, link: 'https://uc' + mock.links + 'a7f.dl.dropboxusercontent.com/cd/0/get/SECRETLINK' + mock.links + 'abc/file' });
    }
    if (route === 'users/get_current_account') return send(200, { account_id: 'dbid:x', name: { display_name: 'Test Viewer' }, email: 'viewer@example.com' });
    if (route === 'auth/token/revoke') { mock.revoked++; delete mock.valid[auth[1]]; return send(200, null); }
    send(404, { error_summary: 'unknown' });
  });
});
const waits = [];
Dropbox._wait = (ms) => { waits.push(ms); return 5; };
function reset() { Object.keys(Dropbox._tokens).forEach((k) => delete Dropbox._tokens[k]); Object.keys(Dropbox._links).forEach((k) => delete Dropbox._links[k]); }

(async () => {
  await new Promise((f) => api.listen(0, '127.0.0.1', f));
  process.env.TIVIBRO_DROPBOX_API = 'http://127.0.0.1:' + api.address().port;
  const src = { id: 'sdbx1', type: 'dropbox', name: 'Dropbox', root: '/Media', refresh: REFRESH, contentMode: 'automatic' };

  // Access tokens: one refresh for many calls, and a new one when under five minutes are left.
  let calls = await Promise.all([1, 2, 3].map(() => new Promise((f) => Dropbox.accessToken(REFRESH, (e, t) => f(e || t)))));
  ok('one token for calls made together', mock.tokenCalls === 1 && calls.every((t) => t === calls[0]) && /^sl\.AT/.test(calls[0]), calls);
  await new Promise((f) => Dropbox.accessToken(REFRESH, f));
  ok('and it is reused while it lasts', mock.tokenCalls === 1);
  reset(); mock.expires = 200;
  await new Promise((f) => Dropbox.accessToken(REFRESH, f)); await new Promise((f) => Dropbox.accessToken(REFRESH, f));
  ok('a token with under five minutes left is renewed', mock.tokenCalls === 3, mock.tokenCalls);
  reset(); mock.expires = 14400;
  const before = mock.tokenCalls; mock.valid = {};
  const acct = await new Promise((f) => Dropbox.account(REFRESH, (e, a) => f(e || a)));
  ok('a 401 gets a new access token and goes on', acct === 'Test Viewer (viewer@example.com)' && mock.tokenCalls === before + 1, { acct, calls: mock.tokenCalls - before });

  // The listing: recursive, 2000 a page asked, every page through /continue.
  mock.limits = []; mock.calls = {};
  const all = await new Promise((f) => Dropbox.listAll(src, (e, r) => f(e || r)));
  ok('recursive listing reads every page', all.entries.length === under('/Media', true).length && all.more === false, { n: all.entries.length });
  ok('2000 entries a page are asked for', mock.limits[0] === 2000);
  ok('pages after the first come from /continue', mock.calls['files/list_folder'] === 1 && mock.calls['files/list_folder/continue'] === Math.ceil(under('/Media', true).length / 3) - 1, mock.calls);
  mock.expireCursor = true;
  const again = await new Promise((f) => Dropbox.listAll(src, (e, r) => f(e || r)));
  ok('an expired cursor starts the listing over', again.entries.length === all.entries.length, again.entries.length);

  // A scan: movies and TV episodes, the WebDAV rules, Dropbox ids and paths.
  let r = await scan(src);
  ok('a scan answers without an error', !r.error && Array.isArray(r.movies), r);
  const titles = r.movies.map((m) => m.title + '|' + m.year).sort();
  ok('movies with their folder titles', JSON.stringify(titles) === JSON.stringify(['Frozen|2013', 'Loose Film|2019', 'Movie|2020']), titles);
  const mv = r.movies.filter((m) => m.title === 'Movie')[0];
  ok('a movie id is x: + path_lower', mv.id === 'x:/media/movie (2020)/movie.2020.1080p.mkv', mv.id);
  ok('and it plays from path_display', mv.path === '/Media/Movie (2020)/Movie.2020.1080p.mkv' && !mv.url, mv);
  ok('size and file information kept', mv.size === 4.2e9 && mv.ext === 'mkv' && mv.info.indexOf('1080p') >= 0, mv);
  const eps = (r.files || []).filter((f) => f.kind === 'episode');
  ok('both episodes are found', eps.length === 2, (r.files || []).map((f) => f.file + ':' + f.kind));
  const ep = eps.filter((f) => /E02/.test(f.file))[0] || {};
  ok('an episode knows its show and season folders, below the root', JSON.stringify(ep.ancestors) === JSON.stringify(['Show Name', 'Season 01']), ep.ancestors);
  ok('the episode is S01E02', ep.classification && ep.classification.kind === 'episode' && JSON.stringify(ep.classification).indexOf('"season":1') >= 0, ep.classification);
  ok('episode ids and paths are Dropbox ones', ep.id === 'x:/media/show name/season 01/show.name.s01e02.mkv' && ep.path === '/Media/Show Name/Season 01/Show.Name.S01E02.mkv' && ep.etag && ep.modified, ep);
  ok('junk folders, subtitles and files outside the folder are left out', !(r.files || []).concat(r.movies).some((f) => /Old|Outside|\.srt|readme/.test(f.file)));
  ok('a whole scan is not partial', r.partial === false && !r._continuation, r.errors);
  ok('the refresh token is not in the answer', JSON.stringify(r).indexOf(REFRESH) < 0);
  r = await scan(Object.assign({}, src, { contentMode: 'movies' }));
  ok('movies only: the season folder is left out', r.movies.length === 3 && !r.files && r.skipped.tvFolders === 1, r.skipped);
  r = await scan(Object.assign({}, src, { root: '' }));
  ok('the whole Dropbox as the root', r.movies.some((m) => m.title === 'Outside') && r.files.some((f) => f.kind === 'episode' && f.ancestors[0] === 'Media'), r.movies.map((m) => m.title));

  // A big library: a page is a folder for the budget, and the cursor is the continuation.
  let slices = 0, cont = null, last = null;
  do {
    last = await scan(Object.assign({}, src, { scanFolderBudget: 2, _continuation: cont }));
    cont = last._continuation; slices++;
    if (cont) ok('slice ' + slices + ' says it stopped early and keeps a cursor', last.partial === true && cont.cursor && Array.isArray(cont.entries) && cont.entries.every((e) => e.tag === 'file'), cont);
  } while (cont && slices < 20);
  ok('a paused scan goes on from its cursor to the end', slices === Math.ceil(Math.ceil(under('/Media', true).length / 3) / 2) && last.movies.length === 3 && last.files.filter((f) => f.kind === 'episode').length === 2, { slices, movies: last.movies.length });
  const paused = await scan(Object.assign({}, src, { _control: { paused: true } }));
  ok('a paused source stops after one page', !!paused._continuation, paused.errors);

  // Playing: a temporary link, reused while it lasts.
  mock.links = 0;
  let link = await resolve(src, mv.path);
  ok('resolve gives the temporary link, played directly', /^https:\/\/uc1a7f\.dl\.dropboxusercontent\.com\//.test(link.url), link);
  const link2 = await resolve(src, mv.path);
  ok('and the same link again, without asking Dropbox', link2.url === link.url && mock.links === 1, mock.links);
  await resolve(src, ep.path);
  ok('another file gets its own link', mock.links === 2);
  ok('a missing file says so', (await resolve(src, '/Media/gone.mkv')).error === 'address');
  ok('a path that is not one', (await resolve(src, 'Media/x.mkv')).error === 'address');

  // 429: Retry-After, at most 30 s, three tries.
  reset(); waits.length = 0; mock.fail429['files/get_temporary_link'] = 2; mock.retryAfter = '1';
  link = await resolve(src, mv.path);
  ok('429: waits Retry-After and tries again', !link.error && waits.length === 2 && waits.every((w) => w === 1000), { waits, link });
  reset(); waits.length = 0; mock.fail429['files/get_temporary_link'] = 9; mock.retryAfter = '120';
  link = await resolve(src, mv.path);
  ok('429: never waits more than 30 s, and gives up after three tries', link.error === 'unreachable' && waits.length === 3 && waits.every((w) => w === 30000), { waits, link });
  mock.fail429 = {};

  // A sign-in Dropbox no longer takes.
  reset(); mock.refresh = 'rt-other';
  r = await scan(src);
  ok('a refused sign-in is a login failure', r.error === 'login' && !r.movies, r);
  ok('with the Dropbox words', r.message === 'Dropbox didn\'t accept the sign-in.  Remove this source and add it again from the phone app.', r.message);
  ok('resolve too', (await resolve(src, mv.path)).error === 'login');
  mock.refresh = REFRESH; reset();
  ok('a source with no token is a login failure', (await scan(Object.assign({}, src, { refresh: '' }))).error === 'login');
  ok('a folder that is gone says so', (await scan(Object.assign({}, src, { root: '/Nope' }))).error === 'address');
  process.env.TIVIBRO_DROPBOX_API = 'http://127.0.0.1:1';
  ok('no answer is unreachable', (await scan(src)).error === 'unreachable');
  process.env.TIVIBRO_DROPBOX_API = 'http://127.0.0.1:' + api.address().port;

  // The routes, through the real helper, and what its log keeps.
  const relay = proxy.create({}); await new Promise((f) => relay.server.listen(0, '127.0.0.1', f));
  const post = (u, body) => fetch('http://127.0.0.1:' + relay.server.address().port + u, { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  proxy.LOG.length = 0;
  let a = await post('/media/dropbox/folders', { refresh: REFRESH, path: '' });
  ok('folders at the top, by name, with the account', JSON.stringify(a.folders) === JSON.stringify([{ name: 'Films', path: '/Films' }, { name: 'Media', path: '/Media' }]) && a.account === 'Test Viewer (viewer@example.com)', a);
  a = await post('/media/dropbox/folders', { refresh: REFRESH, path: '/Media' });
  ok('folders only, not files, sorted', a.folders.map((f) => f.name).join() === '$RECYCLE.BIN,Kids,Movie (2020),Show Name', a.folders);
  a = await post('/media/dropbox/folders', { refresh: 'rt-not-taken-anymore' });
  ok('folders with a refused sign-in', a.error === 'login' && /Dropbox/.test(a.message), a);
  a = await post('/media/dropbox/account', { refresh: REFRESH });
  ok('the account route', a.account === 'Test Viewer (viewer@example.com)', a);
  a = await post('/media/resolve', { source: src, path: mv.path });
  ok('the resolve route gives the link', /dropboxusercontent\.com/.test(a.url || ''), a);
  const scanned = await post('/media/scan', { source: Object.assign({}, src, { scanFolderBudget: 1 }) });
  ok('the scan route works for Dropbox', !scanned.error && scanned.movies, scanned);
  const logged = JSON.stringify(proxy.LOG);
  ok('the log never has the refresh token', logged.indexOf(REFRESH) < 0 && logged.indexOf('rt-not-taken') < 0);
  ok('nor an access token or a temporary link', !/sl\.AT\d|SECRETLINK/.test(logged), logged.slice(0, 300));
  ok('the log names Dropbox calls by kind', /dropbox folders/.test(logged) && /"host":"dropbox"/.test(logged));
  ok('a temporary link is redacted wherever it is logged', proxy.redact('play ' + a.url + ' now').indexOf('SECRETLINK') < 0 && /dl\.dropboxusercontent\.com\/\*\*\*/.test(proxy.redact(a.url)), proxy.redact(a.url));
  ok('any Dropbox content host counts, learned or not', proxy.redact('https://ucZZZ.dl.dropboxusercontent.com/cd/0/get/SECRETLINKx/file?dl=1').indexOf('SECRETLINK') < 0);

  // A checkpoint (source with an id, stopped early) holds the cursor, never the token.
  const ck = await post('/media/scan', { source: Object.assign({}, src, { contentMode: 'movies', scanFolderBudget: 1 }) });
  ok('a stopped scan is resumable', ck.resumable === true, ck);
  const kvFiles = []; (function walk(d) { fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else kvFiles.push(p); }); })(process.env.TIVIBRO_KV_DIR);
  const kvText = kvFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  ok('the checkpoint has the cursor', kvFiles.some((f) => /scan_/.test(f)) && /"cursor"/.test(kvText));
  ok('the TV\'s storage never has the refresh token or a link', kvText.indexOf(REFRESH) < 0 && kvText.indexOf('SECRETLINK') < 0);
  const resumed = await post('/media/scan', { source: Object.assign({}, src, { contentMode: 'movies' }) });
  ok('the next scan goes on from the checkpoint', !resumed.error && resumed.movies.length === 3 && !resumed.resumable, resumed);

  a = await post('/media/dropbox/revoke', { refresh: REFRESH });
  ok('revoke signs out and forgets the token', a.revoked === true && mock.revoked === 1 && Object.keys(Dropbox._tokens).length === 0, a);
  relay.server.close();

  /* ---------- the app's side ---------- */
  const ls = {};
  const ctx = { console, JSON, Promise, Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    Store: { settings: { playlists: [{ id: 'p1', pass: 'plpass' }], active: 'p1' }, edits: {}, bigGet: () => Promise.resolve(null), bigSet: () => Promise.resolve(true) },
    TIVIBRO_VERSION: 'test' };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/mediastore.js'), 'utf8'), ctx);
  const M = vm.runInContext('MediaStore', ctx);
  const sid = M.addSource({ type: 'dropbox', name: 'Movies', root: '/Media/Movies', refresh: REFRESH, account: 'Test Viewer (viewer@example.com)', contentMode: 'automatic' });
  ok('the app keeps the token with the source', M.source(sid).refresh === REFRESH && M.source(sid).root === '/Media/Movies');
  ok('the list for screens and the web editor leaves it out', JSON.stringify(M.publicSources()).indexOf(REFRESH) < 0 && M.publicSources()[0].root === '/Media/Movies' && M.publicSources()[0].type === 'dropbox');
  ok('Dropbox has its own label', M.typeLabel('dropbox') === 'Dropbox' && M.typeLabel('dlna') === 'DLNA / UPnP' && M.typeLabel('webdav') === 'WebDAV');
  ok('only in the media store, not the settings', Object.keys(ls).join() === 'tivibro.media');
  // A backup (webedit.js Backup) carries the settings, not the media store.
  const web = fs.readFileSync(path.join(__dirname, '../../app/js/webedit.js'), 'utf8');
  vm.runInContext(web.slice(web.indexOf('var Backup = (function')), ctx);
  const backup = await vm.runInContext('Backup.create()', ctx);
  ok('a backup never has the refresh token', backup.kind === 'backup' && JSON.stringify(backup).indexOf(REFRESH) < 0);

  // The phone's My media asks (phone.js), answered through a pretend helper.
  const answers = [], queue = [];
  let seq = 0;
  ctx.Net = { port: 1, ctlHeaders: (h) => h };
  ctx.Log = { info() {}, warn() {} };
  ctx.U = { toast() {} };
  ctx.Media = {
    isScanning: () => false, leftOut: () => '',
    dropboxFolders: (rt, p) => Promise.resolve(rt === REFRESH ? { folders: [{ name: 'Movies', path: (p || '') + '/Movies' }], account: 'Test Viewer (viewer@example.com)' } : { error: 'login', message: 'x' }),
    addDropbox: (rt, root, name) => { M.addSource({ type: 'dropbox', name: name || 'Dropbox', root, refresh: rt }); return Promise.resolve({ id: 'x', movies: 1, episodes: 2, skipped: null }); }
  };
  ctx.fetch = (u, o) => {
    const p = u.replace(/^http:\/\/127\.0\.0\.1:1/, '');
    const reply = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    if (p.indexOf('/companion/set') === 0 || p.indexOf('/companion/status') === 0) return reply({ on: true, port: 2, phones: [] });
    if (p.indexOf('/companion/answer') === 0) { answers.push(JSON.parse(o.body)); return reply({}); }
    if (p.indexOf('/companion/next') === 0) return new Promise((f) => { const take = () => { if (queue.length) { const c = queue.shift(); f({ ok: true, json: () => Promise.resolve({ seq: c.id, cmds: [c] }) }); } else setTimeout(take, 5); }; take(); });
    return reply({});
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/phone.js'), 'utf8'), ctx);
  vm.runInContext('Phone.start()', ctx);
  const askPhone = (args) => new Promise((f) => { const id = ++seq; queue.push({ id, type: 'ask', what: 'mymedia', args }); (function look() { const x = answers.filter((y) => y.id === id)[0]; if (x) f(x); else setTimeout(look, 5); })(); });
  let ans = await askPhone({ op: 'dbfolders', refresh: REFRESH, path: '' });
  ok('dbfolders: folders and the account', ans.ok && JSON.stringify(ans.data.folders) === '[{"name":"Movies","path":"/Movies"}]' && /Test Viewer/.test(ans.data.account), ans);
  ans = await askPhone({ op: 'dbfolders', refresh: 'rt-not-taken-anymore', path: '' });
  ok('dbfolders: a refused sign-in in plain words', !ans.ok && ans.error === 'Dropbox didn\'t accept that sign-in.  Sign in again.', ans);
  ans = await askPhone({ op: 'dbfolders', refresh: 'short', path: '' });
  ok('dbfolders: no token at all', !ans.ok && /Sign in again/.test(ans.error), ans);
  ans = await askPhone({ op: 'adddropbox', refresh: REFRESH, root: '/Media/TV', name: 'TV' });
  ok('adddropbox: what it found', ans.ok && ans.data.msg === 'Added: 1 movie and 2 episodes.' && ans.data.sources.some((s) => s.type === 'dropbox' && s.root === '/Media/TV'), ans);
  ans = await askPhone({ op: 'sources' });
  ok('sources: Dropbox rows say so, with their folder', ans.ok && ans.data.sources.filter((s) => s.type === 'dropbox').length === 2, ans);
  ok('the phone\'s replies never have the refresh token', JSON.stringify(answers).indexOf(REFRESH) < 0);

  api.close();
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
