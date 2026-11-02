/* Subtitles from OpenSubtitles.com for what's playing (discussion #19).  The app sends the viewer's own
   API key (and login token, if they signed in) with each request, the way it sends the TMDB token;
   only the search words (title, year, season and episode) and the chosen file id leave the TV.
     POST /media/subs/search   { key, token, query, year, season, episode, type, langs: ['en','ea'] }
       -> { results: [{ id, lang, release, downloads, hi, fps, ai, trusted, title }] } | { error, message }
     POST /media/subs/get      { key, token, id } -> { text, name, remaining, reset } | { error, message }
     POST /media/subs/login    { key, user, pass } -> { token, allowed, level } | { error, message }
   OpenSubtitles asks for its query parameters sorted and lower case (it redirects otherwise), and an
   app name in the User-Agent.  Without a login it allows 5 downloads a day per address; with a free
   account, 20.  ES5 / Node 0.12. */
'use strict';
var https = require('https');
var http = require('http');
var URL_ = require('url');
var HOST = process.env.TIVIBRO_OS_BASE || 'https://api.opensubtitles.com/api/v1';     // tests point it at the mock
var UA = 'TiviBro v' + (function () { try { return require('./package.json').version || '0.6'; } catch (e) { return '0.6'; } })();

function str(v, n) { return typeof v === 'string' ? v.slice(0, n || 200) : typeof v === 'number' ? String(v) : ''; }
function message(code, body) {
  var m = body && (body.message || (body.errors && body.errors.join ? body.errors.join('  ') : ''));
  if (code === 401 || code === 403) return 'OpenSubtitles refused the API key.  Check it in Settings > Playback > Subtitles from OpenSubtitles.';
  if (code === 406 || code === 429) return m || 'The daily download limit is reached.  Sign in for more, or try again tomorrow.';
  return m || 'OpenSubtitles answered ' + code + '.';
}
// One HTTPS request, following up to three redirects; JSON answers parsed, text kept as text.
function call(method, url, headers, body, cb, hops, asText) {
  hops = hops || 0;
  var done = false;
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var u = URL_.parse(url), data = body ? JSON.stringify(body) : null;
  var h = { 'User-Agent': UA, Accept: asText ? '*/*' : 'application/json' };
  Object.keys(headers || {}).forEach(function (k) { if (headers[k]) h[k] = headers[k]; });
  if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
  var req = (u.protocol === 'http:' ? http : https).request({ hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h }, function (res) {
    var code = res.statusCode;
    if (code >= 300 && code < 400 && res.headers.location && hops < 3) {
      res.resume();
      var next = URL_.resolve(url, res.headers.location);
      return call(code === 307 || code === 308 ? method : 'GET', next, code === 307 || code === 308 ? headers : (URL_.parse(next).hostname === u.hostname ? headers : {}), code === 307 || code === 308 ? body : null, finish, hops + 1, asText);
    }
    var chunks = [], bytes = 0;
    res.on('data', function (b) { bytes += b.length; if (bytes > 3145728) { req.abort(); finish(new Error('That subtitle file is too large.')); } else chunks.push(b); });
    res.on('end', function () {
      var buf = Buffer.concat(chunks), j = null;
      if (!asText || code !== 200) { try { j = JSON.parse(buf.toString('utf8')); } catch (e) { j = null; } }
      if (code !== 200) { var e = new Error(message(code, j)); e.code = code; return finish(e); }
      finish(null, asText ? buf : j);
    });
    res.on('error', function () { finish(new Error('The connection to OpenSubtitles dropped.')); });
  });
  req.on('error', function () { finish(new Error('Could not reach OpenSubtitles.')); });
  req.setTimeout(15000, function () { req.abort(); finish(new Error('OpenSubtitles did not answer in time.')); });
  if (data) req.write(data);
  req.end();
}
function auth(q) { return { 'Api-Key': str(q.key, 80), Authorization: q.token ? 'Bearer ' + str(q.token, 2048) : '' }; }
function keyOk(q) { return /^[A-Za-z0-9]{16,64}$/.test(str(q.key, 80)); }

// The search address: parameters sorted, values lower case, spaces as "+".
function searchUrl(q) {
  var p = {};
  var query = str(q.query, 120).toLowerCase().replace(/\s+/g, ' ').trim();
  if (query) p.query = query;
  if (/^\d{4}$/.test(str(q.year))) p.year = str(q.year);
  if (+q.season > 0) p.season_number = String(+q.season);
  if (+q.episode > 0) p.episode_number = String(+q.episode);
  if (q.type === 'movie' || q.type === 'episode') p.type = q.type;
  var langs = (Array.isArray(q.langs) ? q.langs : []).map(function (l) { return str(l, 8).toLowerCase(); }).filter(function (l) { return /^[a-z]{2}(-[a-z]{2})?$/.test(l); });
  langs.sort();
  if (langs.length) p.languages = langs.join(',');
  p.order_by = 'download_count';
  return HOST + '/subtitles?' + Object.keys(p).sort().map(function (k) { return k + '=' + encodeURIComponent(p[k]).replace(/%20/g, '+').replace(/%2C/g, ','); }).join('&');
}
function search(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first: Settings > Playback > Subtitles from OpenSubtitles.' });
  if (!str(q.query, 120).trim()) return cb({ error: 'query', message: 'Say what to look for.' });
  call('GET', searchUrl(q), auth(q), null, function (e, j) {
    if (e) return cb({ error: 'search', message: e.message });
    var out = [];
    (j && j.data || []).forEach(function (d) {
      var a = d.attributes || {}, f = (a.files || [])[0], fd = a.feature_details || {};
      if (!f || !f.file_id) return;
      out.push({ id: f.file_id, lang: str(a.language, 8), release: str(a.release || f.file_name, 160), downloads: +a.download_count || 0, hi: !!a.hearing_impaired,
        fps: +a.fps || 0, ai: !!(a.ai_translated || a.machine_translated), trusted: !!a.from_trusted, title: str(fd.title || fd.movie_name, 120),
        season: +fd.season_number || 0, episode: +fd.episode_number || 0, year: +fd.year || 0 });
    });
    cb({ results: out.slice(0, 60), total: j && j.total_count || out.length });
  });
}
function get(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first.' });
  var id = +q.id;
  if (!(id > 0)) return cb({ error: 'id', message: 'Pick a subtitle.' });
  call('POST', HOST + '/download', auth(q), { file_id: id }, function (e, j) {
    if (e) return cb({ error: e.code === 406 || e.code === 429 ? 'limit' : 'download', message: e.message });
    if (!j || !/^https?:\/\//.test(j.link || '')) return cb({ error: 'download', message: 'OpenSubtitles gave no file.' });
    call('GET', j.link, {}, null, function (e2, buf) {
      if (e2) return cb({ error: 'download', message: e2.message });
      cb({ text: decode(buf), name: str(j.file_name, 200), remaining: j.remaining, reset: str(j.reset_time, 80) });
    }, 0, true);
  });
}
// Subtitle files are mostly UTF-8; older ones are Windows-1252 (Latin-1 is close enough for it).
function decode(buf) {
  var s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.indexOf('\ufffd') >= 0) s = buf.toString('binary');        // Latin-1; old Node knows it by this name
  return s;
}
function login(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first.' });
  if (!str(q.user, 100) || !str(q.pass, 200)) return cb({ error: 'login', message: 'Enter the username and password.' });
  call('POST', HOST + '/login', { 'Api-Key': str(q.key, 80) }, { username: str(q.user, 100), password: str(q.pass, 200) }, function (e, j) {
    if (e) return cb({ error: 'login', message: e.code === 401 ? 'OpenSubtitles did not accept that username and password.' : e.message });
    if (!j || !j.token) return cb({ error: 'login', message: 'OpenSubtitles did not sign you in.' });
    cb({ token: j.token, allowed: j.user && j.user.allowed_downloads || 0, level: j.user && str(j.user.level, 40) || '' });
  });
}
module.exports = { search: search, get: get, login: login, _test: { searchUrl: searchUrl, decode: decode, UA: UA } };
