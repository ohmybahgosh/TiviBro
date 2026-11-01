// My media, helper side (service/media.js): names, junk, the Fritz!Box tree shape, WebDAV logins and
// signed links.  Self-contained: tiny DLNA and WebDAV servers on localhost, no real server or login.
const http = require('http'), path = require('path');
const Media = require(path.join(__dirname, '../../service/media.js'));
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const listen = s => new Promise(f => s.listen(0, '127.0.0.1', () => f(s.address().port)));
const scan = src => new Promise(f => Media.scan(src, f));
const resolve = (src, p) => new Promise(f => Media.resolve(src, p, f));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A DLNA server shaped like the real Fritz!Box: the same file flat under Videos/All videos and in its
   folder under Videos/Folders/Storage, plus containers that must not be walked. */
function dlna(tree, opts) {
  opts = opts || {};
  const browsed = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const id = /<ObjectID>([^<]*)</.exec(b)[1].replace(/&amp;/g, '&');
      const start = +/<StartingIndex>(\d+)/.exec(b)[1], count = +/<RequestedCount>(\d+)/.exec(b)[1];
      browsed.push(id);
      if (opts.failOn === id) { res.writeHead(500); return res.end('nope'); }
      const all = tree[id] || [], page = all.slice(opts.repeatPage ? 0 : start, (opts.repeatPage ? 0 : start) + count);
      const didl = '<DIDL-Lite>' + page.map(n => n.dir
        ? `<container id="${esc(n.id)}" parentID="${esc(id)}"><dc:title>${esc(n.dir)}</dc:title><upnp:class>object.container</upnp:class></container>`
        : `<item id="${esc(n.id)}" parentID="${esc(id)}"><dc:title>${esc(n.title)}</dc:title><upnp:class>object.item</upnp:class><res protocolInfo="${n.proto}" size="${n.size || 0}" duration="0:00:00.000">${esc(n.url)}</res></item>`).join('') + '</DIDL-Lite>';
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<s:Envelope><s:Body><u:BrowseResponse><Result>${esc(didl)}</Result><NumberReturned>${page.length}</NumberReturned><TotalMatches>${all.length}</TotalMatches></u:BrowseResponse></s:Body></s:Envelope>`);
    });
  });
  srv.browsed = browsed;
  return srv;
}
const MKV = 'http-get:*:video/x-matroska:*', MP4 = 'http-get:*:video/mp4:DLNA.ORG_PN=X';
const movieUrl = (host, folder, file) => `http://${host}/VIDEO/DLNA-0-0/Storage/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;

/* WebDAV with Basic login.  tree: href -> children [{href, name?, dir?, size?}] */
function webdav(tree, auth, redirectTo, seen) {
  const expect = 'Basic ' + Buffer.from(auth).toString('base64');
  return http.createServer((req, res) => {
    if (seen) seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (req.headers.authorization !== expect) { res.writeHead(401); return res.end(); }
    if (req.method === 'GET') {
      if (redirectTo) { res.writeHead(302, { Location: redirectTo + req.url }); return res.end(); }
      res.writeHead(200); return res.end('bytes');
    }
    const kids = tree[req.url];
    if (!kids) { res.writeHead(404); return res.end(); }
    const row = (href, name, dir, size) => `<D:response><D:href>${esc(href)}</D:href><D:propstat><D:prop>${name ? `<D:displayname>${esc(name)}</D:displayname>` : ''}${dir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>'}${size ? `<D:getcontentlength>${size}</D:getcontentlength>` : ''}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
    res.writeHead(207, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${row(req.url, '', true)}${kids.map(k => row(k.href, k.name, k.dir, k.size)).join('')}</D:multistatus>`);
  });
}

(async () => {
  // Names
  ok('folder name wins over the file name', same(Media.titleOf('Frozen (2013)', 'FROZEN 2013 1080p BluRay.mkv'), { title: 'Frozen', year: '2013' }));
  ok('scene name when the folder says nothing', same(Media.titleOf('All videos', 'The.Grinch.2018.1080p.BluRay.DTS.x264-CyTSuNee.mkv'), { title: 'The Grinch', year: '2018' }), Media.titleOf('All videos', 'The.Grinch.2018.1080p.BluRay.DTS.x264-CyTSuNee.mkv'));
  ok('no year: cut at the first quality word', same(Media.titleOf('Storage', 'Luca_1080p_DSNP_WEB-DL.mp4'), { title: 'Luca', year: '' }), Media.titleOf('Storage', 'Luca_1080p_DSNP_WEB-DL.mp4'));
  ok('a number in a title is not lost', same(Media.titleOf('Moana 2 (2024)', 'x.mkv'), { title: 'Moana 2', year: '2024' }));
  ok('a title that is only a year keeps it', same(Media.titleOf('', '1917.mkv'), { title: '1917', year: '' }), Media.titleOf('', '1917.mkv'));
  ['$RECYCLE.BIN', 'System Volume Information', 'FRITZ', 'mediabox', '.hidden'].forEach(n => ok('junk: ' + n, Media.isJunk(n)));
  ok('a real folder is not junk', !Media.isJunk('Frozen (2013)'));
  ok('file info from the name', Media.tokens('Hoppers.2026.1080p.HEVC.x265.DD5.1.mkv').indexOf('1080p') >= 0 && Media.tokens('Hoppers.2026.1080p.HEVC.x265.DD5.1.mkv').indexOf('HEVC') >= 0);

  // The real Fritz!Box shape
  const frozen = 'FROZEN 2013 1080p BluRay.mkv', grinch = 'The.Grinch.2018.1080p.BluRay.mkv';
  const tree = {};
  const srv = dlna(tree); const port = await listen(srv), H = '127.0.0.1:' + port;
  Object.assign(tree, {
    0: [{ dir: 'Music', id: 'music' }, { dir: 'Images', id: 'images' }, { dir: 'Videos', id: 'videos' }, { dir: 'File index', id: 'index' }],
    videos: [{ dir: 'All videos', id: 'all' }, { dir: 'Folders', id: 'folders' }],
    all: [
      { id: 'a1', title: 'FROZEN 2013 1080p BluRay', proto: MKV, size: 6555764176, url: movieUrl(H, 'Frozen (2013)', frozen) },
      { id: 'a2', title: 'The.Grinch.2018.1080p.BluRay', proto: MP4, size: 100, url: movieUrl(H, 'The Grinch (2018)', grinch) },
      { id: 'a3', title: 'Only flat 2020 1080p', proto: MKV, size: 5, url: `http://${H}/VIDEO/DLNA-0-0/Storage/Only.flat.2020.1080p.mkv` }
    ],
    folders: [{ dir: 'Storage', id: 'storage' }, { dir: '$RECYCLE.BIN', id: 'junk' }],
    storage: [{ dir: 'Frozen (2013)', id: 'f1' }, { dir: 'The Grinch (2018)', id: 'f2' }],
    f1: [{ id: 'i1', title: frozen, proto: MKV, size: 6555764176, url: movieUrl(H, 'Frozen (2013)', frozen) }],
    f2: [{ id: 'i2', title: grinch, proto: MKV, size: 100, url: movieUrl(H, 'The Grinch (2018)', grinch) }, { id: 'i3', title: 'cover.mp3', proto: 'http-get:*:audio/mpeg:*', url: `http://${H}/AUDIO/cover.mp3` }],
    music: [{ id: 'no', title: 'should not be read', proto: MKV, url: `http://${H}/x.mkv` }],
    index: [{ id: 'idx', title: 'Start Indexing', proto: 'http-get:*:audio/mpeg:*', url: `http://${H}/AUDIO/.start.mp3` }],
    junk: [{ id: 'j', title: 'bin.mkv', proto: MKV, url: `http://${H}/bin.mkv` }]
  });
  const control = `http://${H}/ctl`;
  let r = await scan({ type: 'dlna', control });
  const titles = (r.movies || []).map(m => m.title).sort();
  ok('each movie once, with the folder title', same(titles, ['Frozen', 'Only flat', 'The Grinch']), titles);
  const fz = r.movies.filter(m => m.title === 'Frozen')[0];
  ok('year from the folder', fz.year === '2013');
  ok('size kept above 4 GB', fz.size === 6555764176);
  ok('the file name is the real one', fz.file === frozen);
  ok('playable address kept for DLNA', fz.url === movieUrl(H, 'Frozen (2013)', frozen));
  ok('container from the file', fz.ext === 'mkv');
  ok('id comes from the path, not the host', fz.id.indexOf('d:/VIDEO') === 0 && fz.id.indexOf('127.0.0.1') < 0, fz.id);
  ok('a full walk is not partial', r.partial === false);
  ok('Music is never browsed', srv.browsed.indexOf('music') < 0 && srv.browsed.indexOf('images') < 0);
  ok('junk folders are never browsed', srv.browsed.indexOf('junk') < 0);
  ok('File index is never browsed', srv.browsed.indexOf('index') < 0);

  // Paging
  const big = {}; const bigSrv = dlna(big); const bp = await listen(bigSrv), BH = '127.0.0.1:' + bp;
  big[0] = []; for (let i = 0; i < 450; i++) big[0].push({ id: 'm' + i, title: 'Movie ' + i + ' 1999', proto: MKV, url: `http://${BH}/m${i}.mkv` });
  r = await scan({ type: 'dlna', control: `http://${BH}/ctl` });
  ok('every page of a long folder', r.movies.length === 450, r.movies.length);
  bigSrv.close();

  // A broken folder keeps the rest
  const bt = { 0: [{ dir: 'Good (2001)', id: 'g' }, { dir: 'Bad (2002)', id: 'b' }], g: [{ id: 'x', title: 'a.mkv', proto: MKV, url: 'http://h/a.mkv' }] };
  const brk = dlna(bt, { failOn: 'b' }); const bkp = await listen(brk);
  r = await scan({ type: 'dlna', control: `http://127.0.0.1:${bkp}/ctl` });
  ok('a folder that fails makes it partial', r.partial === true && r.movies.length === 1 && r.errors.length === 1, r.errors);
  brk.close();
  // An odd object id goes into the request safely
  const od = { '0': [{ dir: 'A & B (2000)', id: 'x&y' }], 'x&y': [{ id: 'z', title: 'c.mkv', proto: MKV, url: 'http://h/c.mkv' }] };
  const odd = dlna(od); const op = await listen(odd);
  r = await scan({ type: 'dlna', control: `http://127.0.0.1:${op}/ctl` });
  ok('object ids are escaped', r.movies.length === 1 && r.movies[0].title === 'A & B', r.movies);
  odd.close();
  // Nobody answers at all
  r = await scan({ type: 'dlna', control: 'http://127.0.0.1:1/ctl' });
  ok('nobody home says unreachable', r.error === 'unreachable', r);
  srv.close();

  // WebDAV
  const wt = {
    '/': [{ href: '/Frozen%20(2013)/', name: 'Frozen (2013)', dir: true }, { href: '/%24RECYCLE.BIN/', name: '$RECYCLE.BIN', dir: true }, { href: '/NoName%20(2011)/', dir: true }],
    '/Frozen%20(2013)/': [{ href: '/Frozen%20(2013)/FROZEN.mkv', name: 'FROZEN.mkv', size: 10 }, { href: '/Frozen%20(2013)/FROZEN_dut.srt', name: 'FROZEN_dut.srt', size: 1 }, { href: '/Frozen%20(2013)/sample.mkv', name: 'sample.mkv', size: 1 }],
    '/NoName%20(2011)/': [{ href: '/NoName%20(2011)/movie.mp4', size: 7 }],
    '/%24RECYCLE.BIN/': [{ href: '/%24RECYCLE.BIN/x.mkv', name: 'x.mkv', size: 1 }]
  };
  const wseen = []; const wsrv = webdav(wt, 'cust:key', null, wseen); const wp = await listen(wsrv);
  const src = { type: 'webdav', address: `http://127.0.0.1:${wp}/`, user: 'cust', pass: 'key' };
  r = await scan(src);
  ok('WebDAV finds the movies', same(r.movies.map(m => m.title).sort(), ['Frozen', 'NoName']), r);
  const wm = r.movies.filter(m => m.title === 'Frozen')[0];
  ok('WebDAV keeps the path to play from', wm.path === '/Frozen%20(2013)/FROZEN.mkv' && !wm.url, wm);
  ok('WebDAV id from the path', wm.id === 'w:/Frozen%20(2013)/FROZEN.mkv', wm.id);
  ok('year from the folder over WebDAV', wm.year === '2013');
  ok('junk and subtitles and samples left out', r.movies.length === 2);
  ok('a missing name falls back to the address', r.movies.filter(m => m.title === 'NoName')[0].file === 'movie.mp4');
  ok('junk folder never read over WebDAV', !wseen.some(x => x.url.indexOf('RECYCLE') >= 0));
  r = await scan(Object.assign({}, src, { pass: 'wrong' }));
  ok('a wrong login says so', r.error === 'login', r);
  ok('a wrong login has no movies', !r.movies);
  ok('the password is not in the answer', JSON.stringify(r).indexOf('wrong') < 0);
  wsrv.close();

  // Signed links
  const cdnSeen = [];
  const cdn = http.createServer((q, s) => { cdnSeen.push(q.headers.authorization); s.writeHead(206); s.end('x'); });
  const cp = await listen(cdn);
  const rseen = []; const rsrv = webdav({}, 'cust:key', `http://localhost:${cp}/signed/abc`, rseen); const rp = await listen(rsrv);
  const rsrc = { type: 'webdav', address: `http://127.0.0.1:${rp}/`, user: 'cust', pass: 'key' };
  r = await resolve(rsrc, '/Frozen/FROZEN.mkv');
  ok('the link comes from the redirect', r.url === `http://localhost:${cp}/signed/abc/Frozen/FROZEN.mkv`, r);
  ok('the login never reaches the other host', cdnSeen.length === 0 || cdnSeen.every(a => !a));
  ok('the request asks for almost nothing', rseen.filter(x => x.method === 'GET').length === 1);
  r = await resolve(Object.assign({}, rsrc, { pass: 'bad' }), '/x.mkv');
  ok('resolve: wrong login', r.error === 'login', r);
  rsrv.close(); cdn.close();
  const plain = webdav({}, 'cust:key'); const pp = await listen(plain);
  r = await resolve({ type: 'webdav', address: `http://127.0.0.1:${pp}/`, user: 'cust', pass: 'key' }, '/x.mkv');
  ok('a server with no redirect is not playable yet', r.error === 'noredirect', r);
  plain.close();

  // Finding servers: the Fritz!Box's own description
  const dev = Media.parseDevice('<root><device><friendlyName>FritzBox Server</friendlyName><serviceList><service><serviceType>urn:x:ConnectionManager:1</serviceType><controlURL>/no</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType><controlURL>/MediaServer/ContentDirectory/Control</controlURL></service></serviceList></device></root>', 'http://127.0.0.1:49000/MediaServerDevDesc.xml');
  ok('the control address from a device description', dev.control === 'http://127.0.0.1:49000/MediaServer/ContentDirectory/Control' && dev.name === 'FritzBox Server', dev);

  // The pinned certificates load as separate entries
  const ca = require(path.join(__dirname, '../../service/media-ca.js'));
  ok('one certificate per entry', Array.isArray(ca) && ca.length >= 2 && ca.every(c => (c.match(/BEGIN CERTIFICATE/g) || []).length === 1), ca.length);
  ok('verification is never turned off', require('fs').readFileSync(path.join(__dirname, '../../service/media.js'), 'utf8').indexOf('rejectUnauthorized') < 0);
  ok('a certificate failure is named', Media.errorKind({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }) === 'cert');

  // A broken pager must stop, and depth limits must preserve older entries.
  const repeated = dlna({ 0: Array.from({ length: 201 }, (_, i) => ({ id: 'r' + i, title: 'Movie ' + i, proto: MKV, url: 'http://mock/' + i + '.mkv' })) }, { repeatPage: true });
  const repeatedPort = await listen(repeated);
  r = await scan({ type: 'dlna', control: 'http://127.0.0.1:' + repeatedPort + '/ctl' });
  ok('a DLNA server repeating pages stops after two requests', r.error === 'unreachable' && repeated.browsed.length === 2);
  await new Promise(f => repeated.close(f));
  const deepTree = {}; for (let i = 0; i < 14; i++) deepTree[String(i)] = [{ id: String(i + 1), dir: 'Folder ' + i }];
  const deep = dlna(deepTree), deepPort = await listen(deep);
  r = await scan({ type: 'dlna', control: 'http://127.0.0.1:' + deepPort + '/ctl' });
  ok('hitting the folder-depth limit is an incomplete scan', r.partial === true);
  await new Promise(f => deep.close(f));

  // Routes: the login goes through these, so a web page on the TV must not reach them
  const rl = proxy.create({ ctl: 'secret' }); await new Promise(f => rl.server.listen(0, '127.0.0.1', f));
  const rb = 'http://127.0.0.1:' + rl.server.address().port;
  const post = (p, body, headers) => new Promise((res, rej) => { const q = http.request(rb + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => res({ status: s.statusCode, body: b })); }); q.on('error', rej); q.end(JSON.stringify(body)); });
  let a = await post('/media/scan', { source: { type: 'dlna', control: 'http://127.0.0.1:1/' } });
  ok('no secret, no scan', a.status === 403, a.status);
  a = await post('/media/scan', { source: { type: 'dlna', control: 'http://127.0.0.1:1/' } }, { 'X-TiviBro-Ctl': 'secret' });
  ok('with the secret it answers', a.status === 200 && JSON.parse(a.body).error === 'unreachable', a.body);
  a = await post('/media/scan', { source: { type: 'webdav', address: 'file:///etc/passwd', user: 'a', pass: 'b' } }, { 'X-TiviBro-Ctl': 'secret' });
  ok('only http and https addresses', JSON.parse(a.body).error === 'address', a.body);
  a = await post('/media/nothing', {}, { 'X-TiviBro-Ctl': 'secret' });
  ok('unknown route', a.status === 404);
  a = await post('/media/metadata', null, { 'X-TiviBro-Ctl': 'secret' });
  ok('a null metadata request is refused without stopping the helper', a.status === 400);
  a = await post('/media/resolve', {}, { 'X-TiviBro-Ctl': 'secret' });
  ok('a missing source is refused without stopping the helper', JSON.parse(a.body).error === 'address');
  await new Promise(f => rl.server.close(f));

  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
