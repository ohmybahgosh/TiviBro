/* My media helper routes and scans, the hard cases: WebDAV servers that encode paths differently,
   movie scans while the show library or a checkpoint is unreadable, a failed adopt that is retried,
   bounded scan results and checkpoints, DLNA path collisions, and a migration retried with a newer
   list.  Local servers only, no real provider or login. */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), URL_ = require('url');
const kvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-media-fixes-'));
process.env.TIVIBRO_KV_DIR = kvDir;
const Media = require('../../service/media'), proxy = require('../../service/proxy'), Jobs = require('../../service/media-scan-jobs'), Kv = require('../../service/kv');
const listen = s => new Promise(f => s.listen(0, '127.0.0.1', () => f(s.address().port)));
const scan = src => new Promise(f => Media.scan(src, f));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let passes = 0;
const ok = (name, cond, extra) => { assert(cond, name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); passes++; console.log('PASS ' + name); };

function webdav(tree) {
  return http.createServer((req, res) => {
    const kids = tree[decodeURIComponent(req.url)];
    if (!kids) { res.writeHead(404); return res.end(); }
    const row = (href, name, dir, size) => `<D:response><D:href>${esc(href)}</D:href><D:propstat><D:prop>${name ? `<D:displayname>${esc(name)}</D:displayname>` : ''}${dir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>'}${size ? `<D:getcontentlength>${size}</D:getcontentlength>` : ''}</D:prop></D:propstat></D:response>`;
    res.writeHead(207, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${row(kids.self, '', true)}${kids.items.map(k => row(k.href, k.name, k.dir, k.size)).join('')}</D:multistatus>`);
  });
}
const MKV = 'http-get:*:video/x-matroska:*';
function dlna(tree) {
  return http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const id = /<ObjectID>([^<]*)</.exec(b)[1], all = tree[id] || [];
      const didl = '<DIDL-Lite>' + all.map(n => n.dir ? `<container id="${n.id}"><dc:title>${esc(n.dir)}</dc:title></container>` : `<item id="${n.id}"><dc:title>${esc(n.title)}</dc:title><res protocolInfo="${MKV}" size="${n.size || 0}">${esc(n.url)}</res></item>`).join('') + '</DIDL-Lite>';
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<s:Envelope><s:Body><u:BrowseResponse><Result>${esc(didl)}</Result><NumberReturned>${all.length}</NumberReturned><TotalMatches>${all.length}</TotalMatches></u:BrowseResponse></s:Body></s:Envelope>`);
    });
  });
}
(async () => {
 try {
  // ---------- WebDAV: origin with default ports, decoded path comparisons ----------
  ok('https default port is the same server', Media.originKey(URL_.parse('https://Cloud.example:443/dav/')) === Media.originKey(URL_.parse('https://cloud.example/x')));
  ok('http default port is the same server', Media.originKey(URL_.parse('http://h:80/')) === Media.originKey(URL_.parse('http://h/')));
  ok('another port is another server', Media.originKey(URL_.parse('https://h:8443/')) !== Media.originKey(URL_.parse('https://h/')));
  ok('a bad escape does not throw', Media.samePath('/a%zz/') === '/a%zz');
  const root = '/remote.php/dav/files/demo@home/Films (2020)/Été/';
  const tree = {};
  const srv = webdav(tree), port = await listen(srv), base = 'http://127.0.0.1:' + port;
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  tree[root] = { self: enc(root), items: [
    { href: enc(root + 'Amélie (2001)/'), name: 'Amélie (2001)', dir: true },
    { href: base + enc(root + 'Up (2009).mkv'), name: 'Up (2009).mkv', size: 4e9 },
    { href: enc('/remote.php/dav/files/other/Secret (2000).mkv'), name: 'Secret (2000).mkv', size: 4e9 }
  ] };
  tree[root + 'Amélie (2001)/'] = { self: enc(root + 'Amélie (2001)/'), items: [{ href: enc(root + 'Amélie (2001)/Amelie.2001.mkv'), name: 'Amelie.2001.mkv', size: 5e9 }] };
  const r = await scan({ type: 'webdav', address: base + root, user: 'demo', pass: 'demo' });
  const titles = (r.movies || []).map(m => m.title).sort();
  ok('encoded hrefs under a raw address are inside the library', titles.join('|') === 'Amélie|Up', r);
  ok('an href outside the library root is left out and makes the scan partial', r.partial === true && !titles.includes('Secret'));
  ok('the library folder itself is not walked twice', r.errors.length === 0, r.errors);
  await new Promise(f => srv.close(f));

  // ---------- movie scans do not depend on the show library ----------
  const lib = path.join(kvDir, 'media-v3');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'catalog.json'), '{"broken');
  const jobsDir = Kv.sub('media-scan-jobs');
  const movieTree = { 0: [{ dir: 'Movies', id: 'm' }], m: [{ id: 'a', title: 'Amber.Road.2021.mkv', url: 'http://127.0.0.1:1/Amber.Road.2021.mkv', size: 4e9 }] };
  const dl = dlna(movieTree), dport = await listen(dl), control = 'http://127.0.0.1:' + dport + '/ctl';
  const rl = proxy.create({ ctl: 'secret' }); await new Promise(f => rl.server.listen(0, '127.0.0.1', f));
  const rb = 'http://127.0.0.1:' + rl.server.address().port;
  const post = (p, body) => new Promise((res, rej) => { const q = http.request(rb + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TiviBro-Ctl': 'secret' } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => res({ status: s.statusCode, body: JSON.parse(b) })); }); q.on('error', rej); q.end(JSON.stringify(body)); });
  // An unreadable checkpoint too: the scan starts fresh.
  fs.readdirSync(jobsDir).forEach(n => fs.unlinkSync(path.join(jobsDir, n)));
  let a = await post('/media/scan', { source: { id: 'src1', type: 'dlna', control, contentMode: 'movies' } });
  ok('movies-only scan works with an unreadable show library', a.status === 200 && a.body.movies && a.body.movies.length === 1, a);
  a = await post('/media/scan', { source: { id: 'src1', type: 'dlna', control, contentMode: 'automatic' } });
  ok('a show scan says the library is unavailable instead', a.status === 507, a);
  fs.unlinkSync(path.join(lib, 'catalog.json'));

  // ---------- checkpoints ----------
  const source = { id: 'src2', type: 'webdav', address: 'https://cloud.example/dav/', user: 'viewer', pass: 'secret-pass-123', contentMode: 'automatic' };
  const saved = await new Promise(f => Jobs.save(source, { queue: [{ path: '/dav/x/' }], visited: { '/dav/': true }, discovered: [] }, (e, s) => f(s)));
  ok('a small checkpoint is saved', saved === true);
  const files = fs.readdirSync(jobsDir).filter(n => /^scan_/.test(n)).map(n => fs.readFileSync(path.join(jobsDir, n), 'utf8')).join('');
  ok('the password is never saved', files.indexOf('secret-pass-123') < 0 && files.indexOf('viewer') < 0);
  const resumed = await new Promise(f => Jobs.prepare(Object.assign({}, source, { pass: 'changed' }), false, (e, s) => f(s)));
  ok('a new password keeps the checkpoint', !!resumed._continuation);
  const other = await new Promise(f => Jobs.prepare(Object.assign({}, source, { address: 'https://cloud.example/other/' }), false, (e, s) => f(s)));
  ok('another address does not', !other._continuation);
  const huge = { queue: [], visited: {}, discovered: [] };
  for (let i = 0; i < Jobs.CAP_ITEMS + 10; i++) huge.visited['/dav/' + i] = true;
  const tooBig = await new Promise(f => Jobs.save(source, huge, (e, s) => f(s)));
  const fresh = await new Promise(f => Jobs.prepare(source, false, (e, s) => f(s)));
  ok('an oversized checkpoint is not saved, and the next scan starts fresh', tooBig === false && !fresh._continuation);
  fs.writeFileSync(path.join(jobsDir, fs.readdirSync(jobsDir).filter(n => /^scan_/.test(n))[0] || 'scan_x.json'), '{"broken');
  await new Promise(f => Jobs.save(source, { queue: [], visited: {}, discovered: [] }, f));
  const files2 = fs.readdirSync(jobsDir).filter(n => /^scan_/.test(n));
  files2.forEach(n => fs.writeFileSync(path.join(jobsDir, n), '{"broken'));
  const afterBroken = await new Promise((f, rej) => Jobs.prepare(source, false, (e, s) => e ? rej(e) : f(s)));
  ok('an unreadable checkpoint means a fresh scan, not an error', !afterBroken._continuation);

  // ---------- adopting a scan: kept whole until imported, at most two kept ----------
  const showTree = { 0: [{ dir: 'Harbour', id: 'h' }], h: [{ dir: 'Season 1', id: 's' }], s: [1, 2, 3].map(n => ({ id: 'e' + n, title: 'Harbour.S01E0' + n + '.mkv', url: 'http://127.0.0.1:1/Harbour.S01E0' + n + '.mkv', size: 1e9 })) };
  const sd = dlna(showTree), sport = await listen(sd), showControl = 'http://127.0.0.1:' + sport + '/ctl';
  const handles = [];
  for (let i = 0; i < 3; i++) handles.push((await post('/media/scan', { source: { type: 'dlna', control: showControl, contentMode: 'automatic' } })).body.scanHandle);
  ok('at most two scans wait to be adopted', Object.keys(Media.scanResults).length === 2 && !Media.scanResults[handles[0]]);
  const rename = fs.rename;
  fs.rename = (from, to, cb) => process.nextTick(() => cb(Object.assign(new Error('full'), { code: 'ENOSPC' })));
  try { a = await post('/media/library/adopt', { sourceId: 'src3', scanHandle: handles[2] }); } finally { fs.rename = rename; }
  ok('a failed adopt says so', a.status === 400 && a.body.error === 'ENOSPC', a);
  a = await post('/media/library/adopt', { sourceId: 'src3', scanHandle: handles[2] });
  ok('the same scan adopts on retry', a.status === 200 && a.body.files === 3, a);
  a = await post('/media/library/adopt', { sourceId: 'src3', scanHandle: handles[2] });
  ok('an adopted scan is gone from memory', a.status === 400 && /expired/.test(a.body.message), a);
  a = await post('/media/library/query', { kind: 'episode' });
  ok('episodes from every show page without a show filter', a.status === 200 && a.body.total === 3 && a.body.items.length === 3, a.body);
  a = await post('/media/library/query', { kind: 'episode', limit: 2 });
  ok('pages are bounded', a.body.items.length === 2 && a.body.nextCursor && a.body.nextCursor.offset === 2);

  // ---------- DLNA: one collision reason per file, however often it is seen ----------
  const collide = { 0: ['a', 'b', 'c'].map(k => ({ id: k, title: 'Clip.mkv', url: 'http://127.0.0.1:1/Clip.mkv?v=' + k, size: 1e9 })) };
  const cd = dlna(collide), cport = await listen(cd);
  const cr = await scan({ type: 'dlna', control: 'http://127.0.0.1:' + cport + '/ctl', contentMode: 'automatic' });
  ok('identity collisions are flagged once per file', cr.files.length === 3 && cr.files.every(f => f.classification.review.filter(x => x === 'identityCollision').length === 1), cr.files.map(f => f.classification.review));

  // ---------- migration retried after a failure uses the newer list ----------
  const legacy = Kv.fileOf('media:lib');
  fs.writeFileSync(legacy, JSON.stringify([{ id: 'bad|w:/x.mkv', src: 'not valid!', title: 'X' }]));
  a = await post('/media/library/migrate', {});
  ok('a broken legacy list fails the migration', a.status === 400);
  fs.writeFileSync(legacy, JSON.stringify([1, 2].map(i => ({ id: 'old|w:/M' + i + '.mkv', src: 'old', title: 'Movie ' + i, file: 'M' + i + '.mkv', path: '/M' + i + '.mkv' }))));
  a = await post('/media/library/migrate', {});
  ok('the retry migrates the current list, not the first snapshot', a.status === 200 && a.body.migrated && a.body.count === 2, a.body);

  await new Promise(f => rl.server.close(f)); dl.close(); sd.close(); cd.close();
  console.log(passes + ' passed');
 } finally { fs.rmSync(kvDir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
