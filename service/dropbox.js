/* My media from Dropbox, helper side.  The phone app signs in to Dropbox (PKCE, no app secret) and
   hands the TV only a refresh token, kept with the source like a WebDAV password.  This module turns
   it into short-lived access tokens (cached per token, renewed when under 5 minutes are left), lists
   folders, and asks for the temporary links movies play from (4 hours; reused for 3.5).

   Secrets: the refresh token, the access tokens and the temporary links are never logged or put in
   an answer other than the one that needs them (a link goes to the player).  Caches are keyed by a
   hash of the refresh token, never the token itself.

   Errors are kinds media.js turns into words: login (Dropbox refused the sign-in), unreachable,
   cert, address (the folder or file is not there).  A 429 waits Retry-After (at most 30 s) and tries
   again, three times at most.  Calls time out after 20 s.  Certificates are always checked; an old
   TV that can't check one tries once more with the chain in media-ca.js, like the rest of My media.
   TIVIBRO_DROPBOX_API and TIVIBRO_DROPBOX_CONTENT point the calls at a mock for tests.
   Plain ES5 for Node 0.12 on webOS 4 (see compat.js). */
'use strict';
require('./compat');
var http = require('http');
var https = require('https');
var URL_ = require('url');
var crypto = require('crypto');

var APP_KEY = 'ax8fum67966pyg6';
var TIMEOUT_MS = 20000, BODY_MAX = 32 * 1024 * 1024, EARLY_MS = 5 * 60000, LINK_MS = 3.5 * 3600000, RETRY_MAX = 3, RETRY_CAP_S = 30;
var PAGE_LIMIT = 2000, FOLDER_PAGES = 50;

function api() { return String(process.env.TIVIBRO_DROPBOX_API || 'https://api.dropboxapi.com').replace(/\/+$/, ''); }
function content() { return String(process.env.TIVIBRO_DROPBOX_CONTENT || 'https://content.dropboxapi.com').replace(/\/+$/, ''); }
function str(v) { return v == null ? '' : String(v); }
function hash(refresh) { return crypto.createHash('sha256').update(str(refresh)).digest('hex').slice(0, 32); }
function fail(kind, detail) { var e = new Error(detail || kind); e.kind = kind; return e; }
function certError(e) { return /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test((e && e.code) || '') || /certificate/i.test((e && e.message) || ''); }

/* A folder as Dropbox wants it: '' for the top, else '/A/B' with no trailing slash. */
function folderPath(p) {
  p = str(p).trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (!p || p === '/') return '';
  return p.charAt(0) === '/' ? p : '/' + p;
}

/* ---------- HTTP ---------- */
// opts: url, headers, body; cb(err, status, headers, text).  A certificate the TV can't check is tried
// once more against media-ca.js (still checked, never skipped).
function post(opts, cb) {
  var u; try { u = URL_.parse(opts.url); } catch (e) { return cb(e); }
  var tls = u.protocol === 'https:', done = false;
  function finish(e, s, h, b) {
    if (done) return;
    done = true;
    if (e && tls && !opts.withCa && certError(e)) return post(Object.assign({}, opts, { withCa: true }), cb);
    cb(e, s, h, b);
  }
  var body = opts.body == null ? '' : opts.body, headers = {};
  Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
  headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
  var o = { hostname: u.hostname, port: u.port || (tls ? 443 : 80), path: u.path || '/', method: 'POST', headers: headers, agent: false };
  if (tls && opts.withCa) o.ca = require('./media-ca');
  var req = (tls ? https : http).request(o, function (res) {
    var chunks = [], len = 0;
    res.on('data', function (d) { len += d.length; if (len > BODY_MAX) { finish(new Error('response too large')); try { req.abort(); } catch (x) {} } else chunks.push(d); });
    res.on('end', function () { finish(null, res.statusCode, res.headers, Buffer.concat(chunks).toString('utf8')); });
    res.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(TIMEOUT_MS, function () { finish(new Error('timed out')); try { req.abort(); } catch (x) {} });
  req.write(body);
  req.end();
}
function json(text) { try { return JSON.parse(text); } catch (e) { return null; } }
function retryAfter(h) { var s = parseInt(h && h['retry-after'], 10); return Math.min(RETRY_CAP_S, s >= 0 ? s : 1) * 1000; }
// Same request again after a 429 (Retry-After, at most 30 s), up to RETRY_MAX times.
function postRetry(opts, cb, tries) {
  tries = tries || 0;
  post(opts, function (e, status, h, text) {
    if (!e && status === 429 && tries < RETRY_MAX) return setTimeout(function () { postRetry(opts, cb, tries + 1); }, module.exports._wait(retryAfter(h)));
    cb(e, status, h, text);
  });
}
function networkKind(e) { return certError(e) ? 'cert' : 'unreachable'; }

/* ---------- access tokens ---------- */
var tokens = {};          // hash(refresh) -> { token, until } or { waiting: [cb] }
function accessToken(refresh, cb, fresh) {
  refresh = str(refresh);
  if (!refresh) return cb(fail('login', 'no sign-in'));
  var k = hash(refresh), t = tokens[k];
  if (t && t.waiting) return t.waiting.push(cb);
  if (!fresh && t && t.token && t.until - Date.now() > EARLY_MS) return cb(null, t.token);
  var entry = { waiting: [cb] };
  tokens[k] = entry;
  postRetry({ url: api() + '/oauth2/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh) + '&client_id=' + APP_KEY }, function (e, status, h, text) {
    var j = !e && json(text), err = null, token = '';
    if (e) err = fail(networkKind(e), e.message);
    else if (status === 200 && j && j.access_token) token = String(j.access_token);
    else if (status === 400 || status === 401 || (j && /invalid_grant|invalid_client/.test(str(j.error)))) err = fail('login', 'refresh refused');
    else err = fail('unreachable', 'HTTP ' + status);
    var waiting = entry.waiting;
    if (tokens[k] === entry) {
      if (token) tokens[k] = { token: token, until: Date.now() + (j.expires_in > 0 ? j.expires_in * 1000 : 4 * 3600000) };
      else delete tokens[k];
    }
    waiting.forEach(function (f) { if (err) f(err); else f(null, token); });
  });
}
function forget(refresh) {
  var k = hash(refresh);
  delete tokens[k];
  Object.keys(links).forEach(function (l) { if (l.indexOf(k + '|') === 0) delete links[l]; });
}

/* ---------- API calls ---------- */
// One Dropbox RPC call: cb(err, answer).  A 401 gets one new access token, then counts as login.
function rpc(refresh, endpoint, args, cb, again) {
  accessToken(refresh, function (e, token) {
    if (e) return cb(e);
    postRetry({ url: api() + '/2/' + endpoint, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: args == null ? 'null' : JSON.stringify(args) }, function (err, status, h, text) {
      if (err) return cb(fail(networkKind(err), err.message));
      var j = json(text);
      if (status === 200) return cb(null, j || {});
      if (status === 401) {
        if (!again) return rpc(refresh, endpoint, args, cb, true);
        return cb(fail('login', 'token refused'));
      }
      if (status === 409) {
        var summary = str(j && j.error_summary), x = fail(/reset/.test(summary) ? 'reset' : 'address', summary.slice(0, 120));
        return cb(x);
      }
      if (status === 400 && /invalid_access_token|expired_access_token/.test(str(text))) return cb(fail('login', 'token refused'));
      cb(fail('unreachable', 'HTTP ' + status));
    }, 0);
  }, !!again);
}
function slim(e) {
  return { tag: e['.tag'], name: str(e.name), path_lower: str(e.path_lower), path_display: str(e.path_display), size: +e.size || 0, rev: str(e.rev).slice(0, 64), modified: str(e.server_modified).slice(0, 40) };
}
/* One page of a recursive listing of the source's root (cursor '' starts it).  cb(err, { entries, cursor, more }). */
function listPage(source, cursor, cb) {
  var call = cursor ? rpc.bind(null, source.refresh, 'files/list_folder/continue', { cursor: cursor })
    : rpc.bind(null, source.refresh, 'files/list_folder', { path: folderPath(source.root), recursive: true, include_media_info: false, include_deleted: false, limit: PAGE_LIMIT });
  call(function (e, j) {
    if (e) return cb(e);
    cb(null, { entries: (j.entries || []).map(slim), cursor: str(j.cursor), more: !!j.has_more });
  });
}
/* Everything under the source's root.  opts: cursor and entries (go on from a saved slice), keep(entry)
   (which entries to keep), stop(pages) (true: stop before the next page; the first page is always
   read).  cb(err, { entries, cursor, more, pages }).  An expired cursor starts over once. */
function listAll(source, cb, opts) {
  opts = opts || {};
  var entries = opts.entries || [], pages = 0, restarted = false;
  (function next(cursor, first) {
    if (!first && opts.stop && opts.stop(pages)) return cb(null, { entries: entries, cursor: cursor, more: true, pages: pages });
    listPage(source, cursor, function (e, p) {
      if (e && e.kind === 'reset' && !restarted) { restarted = true; entries = []; return next('', true); }
      if (e) return cb(e, { entries: entries, cursor: cursor, more: true, pages: pages });
      pages++;
      entries = entries.concat(opts.keep ? p.entries.filter(opts.keep) : p.entries);
      if (p.more) return next(p.cursor, false);
      cb(null, { entries: entries, cursor: '', more: false, pages: pages });
    });
  })(str(opts.cursor), true);
}
/* The folders in one folder (not recursive), by name, for the phone's folder picker. */
function listFolder(source, path, cb) {
  var folders = [], pages = 0;
  (function next(cursor) {
    var call = cursor ? rpc.bind(null, source.refresh, 'files/list_folder/continue', { cursor: cursor })
      : rpc.bind(null, source.refresh, 'files/list_folder', { path: folderPath(path), recursive: false, include_media_info: false, limit: PAGE_LIMIT });
    call(function (e, j) {
      if (e) return cb(e);
      (j.entries || []).forEach(function (x) { if (x['.tag'] === 'folder') folders.push({ name: str(x.name), path: str(x.path_display) }); });
      if (j.has_more && ++pages < FOLDER_PAGES) return next(j.cursor);
      folders.sort(function (a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
      cb(null, folders);
    });
  })('');
}
/* The signed-in account, for display: "Name (email)". */
function account(refresh, cb) {
  rpc(refresh, 'users/get_current_account', null, function (e, j) {
    if (e) return cb(e);
    var name = str(j.name && j.name.display_name), mail = str(j.email);
    cb(null, (name && mail ? name + ' (' + mail + ')' : name || mail).slice(0, 200));
  });
}
/* A temporary link to play a file from (Range works on it).  Kept for 3.5 of its 4 hours. */
var links = {};
function tempLink(source, path, cb) {
  var key = hash(source && source.refresh) + '|' + str(path).toLowerCase(), hit = links[key], now = Date.now();
  if (hit && hit.until > now) return cb(null, hit.url);
  Object.keys(links).forEach(function (k) { if (links[k].until <= now) delete links[k]; });
  rpc(source && source.refresh, 'files/get_temporary_link', { path: str(path) }, function (e, j) {
    if (e) return cb(e);
    if (!/^https?:\/\//i.test(str(j.link))) return cb(fail('unreachable', 'no link'));
    links[key] = { url: String(j.link), until: Date.now() + LINK_MS };
    cb(null, String(j.link));
  });
}
/* Sign-out when a source is removed: best effort, and the caches go either way. */
function revoke(refresh, cb) {
  rpc(refresh, 'auth/token/revoke', null, function (e) { forget(refresh); cb(e || null); });
}

module.exports = {
  APP_KEY: APP_KEY, folderPath: folderPath, accessToken: accessToken, listPage: listPage, listAll: listAll, listFolder: listFolder, account: account, tempLink: tempLink, revoke: revoke, forget: forget,
  // For tests: how long a 429 waits (ms in, ms out), and the caches.
  _wait: function (ms) { return ms; }, _tokens: tokens, _links: links, content: content
};
