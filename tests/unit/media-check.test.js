// The quick look for new media (service/media.js changeCheck): one small request per library, compared with the
// last answer.  WebDAV by its folder listing, DLNA by SystemUpdateID (or its top level), Dropbox by a cursor.
'use strict';
const assert = require('assert'), http = require('http');
let listing = ['Alien (1979)'], updateId = 5, soapId = true, dbxChanges = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    if (req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      return res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/m/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>"root"</d:getetag></d:prop></d:propstat></d:response>' +
        listing.map((n) => '<d:response><d:href>/m/' + encodeURIComponent(n) + '/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>').join('') + '</d:multistatus>');
    }
    if (/GetSystemUpdateID/.test(body)) {
      if (!soapId) { res.writeHead(500); return res.end('<s:Fault/>'); }
      res.writeHead(200); return res.end('<s:Envelope><s:Body><u:GetSystemUpdateIDResponse><Id>' + updateId + '</Id></u:GetSystemUpdateIDResponse></s:Body></s:Envelope>');
    }
    if (/Browse/.test(body)) {
      res.writeHead(200);
      return res.end('<s:Envelope><s:Body><u:BrowseResponse><Result>' + listing.map((n, i) => '&lt;container id="' + i + '"&gt;&lt;dc:title&gt;' + n + '&lt;/dc:title&gt;&lt;/container&gt;').join('') + '</Result><NumberReturned>' + listing.length + '</NumberReturned><TotalMatches>' + listing.length + '</TotalMatches></u:BrowseResponse></s:Body></s:Envelope>');
    }
    if (/oauth2\/token/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'a', expires_in: 14400 })); }
    if (/get_latest_cursor/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ cursor: 'c1' })); }
    if (/list_folder\/continue/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ cursor: 'c2', entries: dbxChanges, has_more: false })); }
    res.writeHead(404); res.end();
  });
});
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, base = 'http://127.0.0.1:' + port;
  process.env.TIVIBRO_DROPBOX_API = base;
  const M = require('../../service/media.js');
  const check = (s, t) => new Promise((ok) => M.changeCheck(s, t, ok));
  try {
    const dav = { type: 'webdav', address: base + '/m/', user: 'u', pass: 'p' };
    const a = await check(dav, '');
    assert.ok(/^dav:/.test(a.token) && !a.changed, 'first look: a token, nothing to say yet');
    assert.equal((await check(dav, a.token)).changed, false, 'the same folders: no change');
    listing.push('Heat (1995)');
    assert.equal((await check(dav, a.token)).changed, true, 'a folder added: changed');
    console.log('PASS WebDAV: the library folder\'s listing');
    const dlna = { type: 'dlna', control: base + '/ctl' };
    const d = await check(dlna, '');
    assert.equal(d.token, 'upnp:5');
    updateId = 6; assert.equal((await check(dlna, d.token)).changed, true, 'SystemUpdateID went up');
    soapId = false; const t0 = await check(dlna, ''); listing.push('Up (2009)');
    assert.equal((await check(dlna, t0.token)).changed, true, 'no SystemUpdateID: its top level');
    console.log('PASS DLNA: SystemUpdateID, else the top level');
    const dbx = { type: 'dropbox', refresh: 'r', root: '/Movies' };
    const x = await check(dbx, '');
    assert.equal(x.token, 'dbx:c1');
    dbxChanges = [{ '.tag': 'file', name: 'notes.txt' }];
    assert.equal((await check(dbx, x.token)).changed, false, 'a text file: not media');
    dbxChanges = [{ '.tag': 'file', name: 'Heat (1995).mkv' }];
    const y = await check(dbx, x.token);
    assert.ok(y.changed && y.token === 'dbx:c2' && y.count === 1, 'a video added: changed, and the cursor moves on');
    console.log('PASS Dropbox: the changes since its cursor');
  } catch (e) { console.error('FAIL ' + e.message); process.exitCode = 1; }
  srv.close();
});
