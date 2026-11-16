/* Trakt (trakt.tv) through the helper: the TV app's page can't reach api.trakt.tv itself (no CORS for a
   file:// app), so app/js/trakt.js asks here.  Only api.trakt.tv, only these calls:
     POST /media/trakt { op: 'code' }                          -> the device code to show (user_code, verification_url, ...)
     POST /media/trakt { op: 'poll', code }                    -> { token } when approved, { pending: true } until then
     POST /media/trakt { op: 'refresh', refresh }              -> { token }
     POST /media/trakt { op: 'revoke', token }                 -> {}
     POST /media/trakt { op: 'get'|'post', path, body, token } -> { data, headers } (path under /users, /sync, /movies,
                                                                  /shows, /lists, /search, /recommendations, /scrobble)
   TiviBro's Trakt app signs in with its Client ID alone (Trakt issues no Client Secret for new apps), so
   nothing secret lives here; the user's tokens stay on the TV (mediastore.js) and are never logged.
   ES5 / Node 0.12. */
'use strict';
var https = require('https');
var CLIENT_ID = 's98wypm76isHUv6nmTgHtYaT6K8cR1EjaChOirtlycs';
var REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
var PATHS = /^\/(users|sync|movies|shows|lists|search|recommendations|scrobble|calendars)(\/[A-Za-z0-9._~%:-]*)*(\?[A-Za-z0-9._~%&=,:+-]*)?$/;
var UA = 'TiviBro (LG webOS; https://tivibro.app)';
try { UA = 'TiviBro/' + require('../package.json').version + ' (LG webOS; https://tivibro.app)'; } catch (e) {}

function str(v, n) { return v == null ? '' : String(v).slice(0, n || 2048); }
function call(method, path, body, token, cb) {
  var data = body != null ? JSON.stringify(body) : null, done = false;
  var h = { 'User-Agent': UA, Accept: 'application/json', 'trakt-api-key': CLIENT_ID, 'trakt-api-version': '2' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var req = https.request({ hostname: 'api.trakt.tv', path: path, method: method, headers: h }, function (res) {
    var chunks = [], n = 0;
    res.on('data', function (b) { n += b.length; if (n > 8e6) { req.abort(); return finish(new Error('Trakt answered with too much.')); } chunks.push(b); });
    res.on('end', function () {
      var text = Buffer.concat(chunks).toString('utf8'), json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) {}
      var head = {}; ['x-pagination-page', 'x-pagination-page-count', 'x-pagination-item-count', 'retry-after'].forEach(function (k) { if (res.headers[k] != null) head[k] = res.headers[k]; });
      finish(null, { status: res.statusCode, json: json, headers: head });
    });
    res.on('error', finish);
  });
  req.on('error', function (e) { finish(new Error('Could not reach Trakt: ' + e.message)); });
  req.setTimeout(20000, function () { req.abort(); finish(new Error('Trakt did not answer in time.')); });
  if (data) req.write(data);
  req.end();
}
function why(r) {
  var s = r && r.status;
  return s === 401 ? 'Trakt did not accept the sign-in.  Connect Trakt again.' : s === 403 ? 'Trakt refused this app.' : s === 404 ? 'Trakt has no such list or item.' :
    s === 420 ? 'Your Trakt account is at its limit (lists or items).  Trakt VIP raises it.' : s === 423 ? 'Your Trakt account is locked.' : s === 429 ? 'Trakt asks to slow down.  Try again in a minute.' :
    s >= 500 ? 'Trakt is having trouble (' + s + ').  Try again later.' : 'Trakt answered ' + s + '.';
}
function handle(q, cb) {
  q = q || {};
  var op = str(q.op, 20), token = str(q.token, 4096);
  if (op === 'code') return call('POST', '/oauth/device/code', { client_id: CLIENT_ID }, '', function (e, r) {
    if (e) return cb({ error: 'trakt', message: e.message });
    if (r.status !== 200 || !r.json || !r.json.device_code) return cb({ error: 'trakt', message: why(r) });
    cb({ code: r.json.device_code, user: r.json.user_code, url: r.json.verification_url, expires: r.json.expires_in, interval: r.json.interval });
  });
  if (op === 'poll') return call('POST', '/oauth/device/token', { code: str(q.code, 512), client_id: CLIENT_ID }, '', function (e, r) {
    if (e) return cb({ error: 'trakt', message: e.message });
    if (r.status === 200 && r.json && r.json.access_token) return cb({ token: tokenOf(r.json) });
    // 400 waiting for the person, 429 asked too soon, 404/409/410/418: wrong, used, expired or denied
    if (r.status === 400 || r.status === 429) return cb({ pending: true });
    cb({ error: 'trakt', message: r.status === 410 ? 'The code expired.  Start again.' : r.status === 418 ? 'You chose not to connect.' : r.status === 409 ? 'That code was already used.' : why(r), stop: true });
  });
  if (op === 'refresh') return call('POST', '/oauth/token', { refresh_token: str(q.refresh, 512), client_id: CLIENT_ID, redirect_uri: REDIRECT, grant_type: 'refresh_token' }, '', function (e, r) {
    if (e) return cb({ error: 'trakt', message: e.message });
    if (r.status === 200 && r.json && r.json.access_token) return cb({ token: tokenOf(r.json) });
    cb({ error: 'trakt', message: why(r), signedOut: r.status === 400 || r.status === 401 });
  });
  if (op === 'revoke') return call('POST', '/oauth/revoke', { token: token, client_id: CLIENT_ID }, '', function () { cb({}); });
  if (op === 'get' || op === 'post' || op === 'delete') {
    var path = str(q.path, 600);
    if (!allowed(path)) return cb({ error: 'trakt', message: 'Not a Trakt address TiviBro uses.' });
    return call(op.toUpperCase(), path, op === 'post' ? (q.body || {}) : null, token, function (e, r) {
      if (e) return cb({ error: 'trakt', message: e.message });
      if (r.status >= 200 && r.status < 300) return cb({ data: r.json, headers: r.headers });
      cb({ error: 'trakt', status: r.status, message: why(r) });
    });
  }
  cb({ error: 'trakt', message: 'Unknown Trakt request.' });
}
function tokenOf(j) { return { access: str(j.access_token, 4096), refresh: str(j.refresh_token, 4096), expires: ((+j.created_at || Math.floor(Date.now() / 1000)) + (+j.expires_in || 604800)) * 1000 }; }
function allowed(path) { return PATHS.test(path) && !/(^|\/)\.\.?(\/|\?|$)|%2e|%2f/i.test(path.split('?')[0]); }
module.exports = { handle: handle, CLIENT_ID: CLIENT_ID, _test: { PATHS: PATHS, allowed: allowed, call: call } };
