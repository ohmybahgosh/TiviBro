/* My media from Google Drive, helper side.  Google's TV sign-in can't read Drive folders (it only
   allows files an app made itself), so a library signs in with a service account: the viewer makes
   one in Google Cloud, shares the drive or folder with its email (Viewer is enough), and gives the TV
   its JSON key through the web editor or the phone app.  The key is kept with the source like a
   WebDAV password.  This module turns it into short-lived access tokens (a signed JWT, read-only
   scope, renewed when under 5 minutes are left), lists the library, picks folders, looks for changes,
   and gives the stream an Authorization header (media-stream.js plays from localhost, so the token
   never reaches the player).

   Listing: a library inside a shared drive is read with one flat listing of that drive (1000 a page,
   only folders and videos), then the paths are put together from the parents.  A folder outside a
   shared drive (in someone's My Drive, shared with the service account) is read folder by folder,
   40 folders a request.  Either way the state between pages is small and goes in the scan's checkpoint.

   Secrets: the key, the access tokens and stream addresses are never logged or put in an answer other
   than the one that needs them.  Caches are keyed by a hash of the key's id, never the key.

   Errors are kinds media.js turns into words: login (Google refused the key, or the account can't see
   the folder), address (the folder or file is gone), quota (Google's download or rate limit), cert,
   unreachable.  A 429 or a rate-limit 403 waits and tries again, three times at most.  Calls time out
   after 20 s.  Certificates are always checked; an old TV that can't check one tries once more with the
   chain in media-ca.js.  TIVIBRO_GDRIVE_API and TIVIBRO_GDRIVE_TOKEN point the calls at a mock for tests.
   Plain ES5 for Node 0.12 on webOS 4 (see compat.js). */
'use strict';
require('./compat');
var http = require('http');
var https = require('https');
var URL_ = require('url');
var crypto = require('crypto');

var SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
var FOLDER = 'application/vnd.google-apps.folder';
var TIMEOUT_MS = 20000, BODY_MAX = 32 * 1024 * 1024, EARLY_MS = 5 * 60000, RETRY_MAX = 3, RETRY_CAP_S = 30;
var PAGE = 1000, BATCH = 40, FOLDER_PAGES = 20, MAX_ITEMS = 200000;
var VIDEO = /\.(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i;
var KEEP_Q = "trashed=false and (mimeType='" + FOLDER + "' or mimeType contains 'video/' or mimeType='application/octet-stream' or mimeType='application/x-matroska')";
var FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,parents,md5Checksum';

function api() { return String(process.env.TIVIBRO_GDRIVE_API || 'https://www.googleapis.com').replace(/\/+$/, ''); }
function tokenUrl() { return String(process.env.TIVIBRO_GDRIVE_TOKEN || 'https://oauth2.googleapis.com/token'); }
function str(v) { return v == null ? '' : String(v); }
function fail(kind, detail) { var e = new Error(detail || kind); e.kind = kind; return e; }
function certError(e) { return /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test((e && e.code) || '') || /certificate/i.test((e && e.message) || ''); }
function networkKind(e) { return certError(e) ? 'cert' : 'unreachable'; }
function json(text) { try { return JSON.parse(text); } catch (e) { return null; } }
function b64url(buf) { return (Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function validId(id) { return /^[A-Za-z0-9_-]{5,200}$/.test(str(id)); }
function quote(s) { return "'" + str(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

/* ---------- the key ----------
   The service account's JSON key as Google gives it (text or the parsed object).  Only what signing
   needs is kept.  null when it isn't one. */
function parseKey(k) {
  var j = typeof k === 'string' ? json(k.trim()) : k;
  if (!j || typeof j !== 'object') return null;
  var email = str(j.client_email).trim(), pem = str(j.private_key);
  if (str(j.type) && j.type !== 'service_account') return null;
  if (!/^[^@\s]+@[^@\s]+\.[a-z.]+$/i.test(email) || email.length > 300) return null;
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----/.test(pem) || pem.length > 8000) return null;
  return { email: email, keyId: str(j.private_key_id).replace(/[^a-f0-9]/gi, '').slice(0, 80), pem: pem };
}
function keyHash(key) { return crypto.createHash('sha256').update(key.email + '|' + key.keyId + '|' + key.pem.length).digest('hex').slice(0, 32); }
/* The key as it is kept and sent: the four fields Google's signing needs, as JSON. */
function keyText(k) {
  var key = parseKey(k);
  return key ? JSON.stringify({ type: 'service_account', client_email: key.email, private_key_id: key.keyId, private_key: key.pem }) : '';
}

/* ---------- HTTP ---------- */
// opts: url, method, headers, body; cb(err, status, headers, text).
function call(opts, cb) {
  var u; try { u = URL_.parse(opts.url); } catch (e) { return cb(e); }
  var tls = u.protocol === 'https:', done = false;
  function finish(e, s, h, b) {
    if (done) return;
    done = true;
    if (e && tls && !opts.withCa && certError(e)) return call(Object.assign({}, opts, { withCa: true }), cb);
    cb(e, s, h, b);
  }
  var body = opts.body == null ? '' : opts.body, headers = {};
  Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
  if (opts.method === 'POST') headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
  var o = { hostname: u.hostname, port: u.port || (tls ? 443 : 80), path: u.path || '/', method: opts.method || 'GET', headers: headers, agent: false };
  if (tls && opts.withCa) o.ca = require('./media-ca');
  var req = (tls ? https : http).request(o, function (res) {
    var chunks = [], len = 0;
    res.on('data', function (d) { len += d.length; if (len > BODY_MAX) { finish(new Error('response too large')); try { req.abort(); } catch (x) {} } else chunks.push(d); });
    res.on('end', function () { finish(null, res.statusCode, res.headers, Buffer.concat(chunks).toString('utf8')); });
    res.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(TIMEOUT_MS, function () { finish(new Error('timed out')); try { req.abort(); } catch (x) {} });
  if (opts.method === 'POST') req.write(body);
  req.end();
}
function retryAfter(h, tries) { var s = parseInt(h && h['retry-after'], 10); return Math.min(RETRY_CAP_S, s >= 0 ? s : Math.pow(2, tries)) * 1000; }
function rateLimited(status, text) { return status === 429 || (status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(str(text))); }
function callRetry(opts, cb, tries) {
  tries = tries || 0;
  call(opts, function (e, status, h, text) {
    if (!e && rateLimited(status, text) && tries < RETRY_MAX) return setTimeout(function () { callRetry(opts, cb, tries + 1); }, module.exports._wait(retryAfter(h, tries)));
    cb(e, status, h, text);
  });
}

/* ---------- access tokens ---------- */
var tokens = {};          // keyHash -> { token, until } or { waiting: [cb] }
function assertion(key) {
  var now = Math.floor(Date.now() / 1000);
  var head = b64url(JSON.stringify(key.keyId ? { alg: 'RS256', typ: 'JWT', kid: key.keyId } : { alg: 'RS256', typ: 'JWT' }));
  var claims = b64url(JSON.stringify({ iss: key.email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now - 30, exp: now + 3570 }));
  var signer = crypto.createSign('RSA-SHA256');
  signer.update(head + '.' + claims);
  return head + '.' + claims + '.' + b64url(signer.sign(key.pem));
}
function accessToken(k, cb, fresh) {
  var key = parseKey(k);
  if (!key) return cb(fail('login', 'not a service account key'));
  var h = keyHash(key), t = tokens[h];
  if (t && t.waiting) return t.waiting.push(cb);
  if (!fresh && t && t.token && t.until - Date.now() > EARLY_MS) return cb(null, t.token);
  var signed;
  try { signed = assertion(key); } catch (e) { return cb(fail('login', 'the key does not sign')); }
  var entry = { waiting: [cb] };
  tokens[h] = entry;
  callRetry({ url: tokenUrl(), method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(signed) }, function (e, status, hd, text) {
    var j = !e && json(text), err = null, token = '';
    if (e) err = fail(networkKind(e), e.message);
    else if (status === 200 && j && j.access_token) token = String(j.access_token);
    else if (status === 400 || status === 401 || status === 403) err = fail('login', str(j && j.error) || 'key refused');
    else err = fail('unreachable', 'HTTP ' + status);
    var waiting = entry.waiting;
    if (tokens[h] === entry) {
      if (token) tokens[h] = { token: token, until: Date.now() + (j.expires_in > 0 ? j.expires_in * 1000 : 3600000) };
      else delete tokens[h];
    }
    waiting.forEach(function (f) { if (err) f(err); else f(null, token); });
  });
}
function forget(k) { var key = parseKey(k); if (key) delete tokens[keyHash(key)]; }

/* ---------- API calls ---------- */
function qs(params) {
  return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
}
// One GET to the Drive API: cb(err, answer).  A 401 gets one new access token, then counts as login.
function get(k, path, params, cb, again) {
  accessToken(k, function (e, token) {
    if (e) return cb(e);
    callRetry({ url: api() + '/drive/v3/' + path + '?' + qs(params || {}), headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, function (err, status, h, text) {
      if (err) return cb(fail(networkKind(err), err.message));
      var j = json(text);
      if (status === 200) return cb(null, j || {});
      if (status === 401) return again ? cb(fail('login', 'token refused')) : get(k, path, params, cb, true);
      if (status === 404) return cb(fail('address', 'not found'));
      if (status === 403 && /downloadQuotaExceeded|rateLimitExceeded|quotaExceeded/.test(str(text))) return cb(fail('quota', 'quota'));
      if (status === 403) return cb(fail('login', 'no access'));
      if (status === 410) return cb(fail('reset', 'expired'));
      cb(fail('unreachable', 'HTTP ' + status));
    });
  }, !!again);
}
function slim(f) {
  return { i: str(f.id), n: str(f.name), f: f.mimeType === FOLDER ? 1 : 0, s: +f.size || 0, m: str(f.modifiedTime).slice(0, 40), p: str(f.parents && f.parents[0]), r: str(f.md5Checksum).slice(0, 32) };
}
function keep(x) { return x.f || VIDEO.test(x.n); }

/* The service account's email, for display, and a check that the key signs in. */
function account(k, cb) {
  var key = parseKey(k);
  if (!key) return cb(fail('login', 'not a service account key'));
  accessToken(k, function (e) { cb(e, e ? null : key.email); });
}
/* Where a library can be: the shared drives the account was added to, and the folders shared with it.
   cb(err, [{ name, id, driveId, kind: 'drive'|'folder' }]). */
function places(k, cb) {
  var out = [];
  get(k, 'drives', { pageSize: 100, fields: 'drives(id,name)' }, function (e, j) {
    if (e) return cb(e);
    (j.drives || []).forEach(function (d) { if (validId(d.id)) out.push({ name: str(d.name), id: str(d.id), driveId: str(d.id), kind: 'drive' }); });
    get(k, 'files', { q: "sharedWithMe and mimeType='" + FOLDER + "' and trashed=false", pageSize: 200, fields: 'files(id,name,driveId)', supportsAllDrives: true, includeItemsFromAllDrives: true }, function (e2, j2) {
      if (e2) return cb(e2);
      (j2.files || []).forEach(function (f) { if (validId(f.id)) out.push({ name: str(f.name), id: str(f.id), driveId: str(f.driveId), kind: 'folder' }); });
      cb(null, out);
    });
  });
}
/* The folders in one folder, by name, for the folder pickers.  cb(err, [{ name, id }]). */
function folders(k, parent, driveId, cb) {
  if (!validId(parent)) return cb(fail('address', 'bad folder'));
  var out = [], pages = 0;
  (function next(token) {
    var p = { q: quote(parent) + " in parents and mimeType='" + FOLDER + "' and trashed=false", pageSize: PAGE, fields: 'nextPageToken,files(id,name)', orderBy: 'name', pageToken: token, supportsAllDrives: true, includeItemsFromAllDrives: true };
    if (driveId) { p.corpora = 'drive'; p.driveId = driveId; }
    get(k, 'files', p, function (e, j) {
      if (e) return cb(e);
      (j.files || []).forEach(function (f) { if (validId(f.id)) out.push({ name: str(f.name), id: str(f.id) }); });
      if (j.nextPageToken && ++pages < FOLDER_PAGES) return next(j.nextPageToken);
      cb(null, out);
    });
  })('');
}

/* ---------- the whole library ----------
   opts: state (go on from a saved slice), stop(pages) (true: stop before the next page; the first page is
   always read).  cb(err, { entries, more, state, pages }).  entries are like Dropbox's (tag, name,
   path_display relative to the library's folder, size, rev, modified) plus gid, the file's id. */
function entriesUnder(source, items) {
  var dirs = {}, out = [], root = str(source.root);
  items.forEach(function (x) { if (x.f) dirs[x.i] = x; });
  items.forEach(function (x) {
    if (x.f || !VIDEO.test(x.n)) return;
    var segs = [x.n], at = x.p, hops = 0;
    while (at && at !== root && hops++ < 40) { var d = dirs[at]; if (!d) return; segs.unshift(d.n); at = d.p; }
    if (at !== root) return;
    var display = '/' + segs.map(function (s) { return s.replace(/\//g, '∕'); }).join('/');
    out.push({ tag: 'file', name: x.n, gid: x.i, path_display: display, path_lower: display.toLowerCase(), size: x.s, rev: x.r || x.m, modified: x.m });
  });
  return out;
}
function listAll(source, cb, opts) {
  opts = opts || {};
  var k = source.key, root = str(source.root), driveId = str(source.driveId);
  if (!validId(root)) return cb(fail('address', 'no folder'));
  var st = opts.state && typeof opts.state === 'object' ? opts.state : null, pages = 0;
  var items = st && Array.isArray(st.items) ? st.items : [];
  function finish(e, more, state) { cb(e, { entries: entriesUnder(source, items), more: more, state: state, pages: pages }); }
  if (driveId) {
    // One listing of the shared drive, then paths from the parents.
    (function next(token, first) {
      if (!first && opts.stop && opts.stop(pages)) return finish(null, true, { mode: 'drive', token: token, items: items });
      get(k, 'files', { q: KEEP_Q, corpora: 'drive', driveId: driveId, supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: PAGE, pageToken: token, fields: 'nextPageToken,files(' + FILE_FIELDS + ')' }, function (e, j) {
        if (e && e.kind === 'reset' && token) { items = []; return next('', true); }
        if (e) return finish(e, true, { mode: 'drive', token: token, items: items });
        pages++;
        (j.files || []).forEach(function (f) { var x = slim(f); if (keep(x) && items.length < MAX_ITEMS) items.push(x); });
        if (j.nextPageToken) return next(String(j.nextPageToken), false);
        finish(null, false, null);
      });
    })(st && st.mode === 'drive' ? str(st.token) : '', true);
    return;
  }
  // Folder by folder, 40 folders a request.
  var queue = st && st.mode === 'tree' && Array.isArray(st.queue) ? st.queue : [root], pending = st && st.mode === 'tree' ? str(st.token) : '', batch = st && st.mode === 'tree' && Array.isArray(st.batch) ? st.batch : null;
  (function next(first) {
    if (!batch) { if (!queue.length) return finish(null, false, null); batch = queue.splice(0, BATCH); pending = ''; }
    if (!first && opts.stop && opts.stop(pages)) return finish(null, true, { mode: 'tree', queue: queue, batch: batch, token: pending, items: items });
    var q = '(' + batch.map(function (id) { return quote(id) + ' in parents'; }).join(' or ') + ') and ' + KEEP_Q;
    get(k, 'files', { q: q, supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: PAGE, pageToken: pending, fields: 'nextPageToken,files(' + FILE_FIELDS + ')' }, function (e, j) {
      if (e) return finish(e, true, { mode: 'tree', queue: queue, batch: batch, token: pending, items: items });
      pages++;
      (j.files || []).forEach(function (f) {
        var x = slim(f);
        if (batch.indexOf(x.p) < 0) { var all = f.parents || []; for (var i = 0; i < all.length; i++) if (batch.indexOf(all[i]) >= 0) { x.p = all[i]; break; } }
        if (!keep(x) || items.length >= MAX_ITEMS) return;
        items.push(x);
        if (x.f) queue.push(x.i);
      });
      if (j.nextPageToken) pending = String(j.nextPageToken); else batch = null;
      next(false);
    });
  })(true);
}

/* ---------- has anything changed? ----------
   A shared drive keeps its changes: a token for "now", then the changes since it (one page; a rescan reads
   the rest).  A folder elsewhere: its folders and videos, by id, name and date (a new movie folder at the
   top changes it).  cb(err, { token, changed, count }). */
function startToken(source, cb) {
  get(source.key, 'changes/startPageToken', { supportsAllDrives: true, driveId: str(source.driveId) }, function (e, j) { cb(e, e ? null : str(j.startPageToken)); });
}
function changesSince(source, token, cb) {
  get(source.key, 'changes', { pageToken: token, driveId: str(source.driveId), supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: PAGE,
    fields: 'nextPageToken,newStartPageToken,changes(removed,fileId,file(name,mimeType,trashed))' }, function (e, j) {
    if (e) return cb(e);
    var list = j.changes || [], media = 0, any = false;
    list.forEach(function (c) {
      var f = c.file || {};
      if (c.removed || f.trashed || f.mimeType === FOLDER) any = true;
      if (VIDEO.test(str(f.name))) { any = true; media++; }
    });
    cb(null, { token: str(j.newStartPageToken || j.nextPageToken || token), changed: any || !!j.nextPageToken, count: media });
  });
}
function topFingerprint(source, cb) {
  if (!validId(source.root)) return cb(fail('address', 'no folder'));
  get(source.key, 'files', { q: quote(source.root) + ' in parents and ' + KEEP_Q, supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: PAGE, fields: 'files(id,name,modifiedTime)' }, function (e, j) {
    if (e) return cb(e);
    var lines = (j.files || []).map(function (f) { return f.id + '|' + f.name + '|' + f.modifiedTime; }).sort();
    cb(null, crypto.createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 20));
  });
}

/* ---------- playing ----------
   The file's address (the stream adds the header; Range works on it) and the header, fresh each time it is
   asked (media-stream.js asks before each read and again after a 401). */
function fileUrl(id) { return api() + '/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true'; }
function authorizer(k) {
  return function (cb, fresh) { accessToken(k, function (e, t) { cb(e, e ? null : 'Bearer ' + t); }, fresh); };
}
// The file's id from a library path: gd:<id>/<where it is>.
function idOf(path) { var m = /^gd:([A-Za-z0-9_-]{5,200})(\/|$)/.exec(str(path)); return m ? m[1] : ''; }

module.exports = {
  SCOPE: SCOPE, parseKey: parseKey, keyText: keyText, accessToken: accessToken, account: account, places: places, folders: folders, listAll: listAll, entriesUnder: entriesUnder,
  startToken: startToken, changesSince: changesSince, topFingerprint: topFingerprint, fileUrl: fileUrl, authorizer: authorizer, idOf: idOf, validId: validId, forget: forget,
  // For tests: how long a retry waits (ms in, ms out), and the cache.
  _wait: function (ms) { return ms; }, _tokens: tokens
};
