/* TMDB movie details.  The app sends the viewer's locally stored TMDB credential per request.  Only title/year or a chosen movie ID and locale leave
   the TV.  Provider logins and playback links never reach TMDB.  ES5 / Node 0.12. */
'use strict';
var https = require('https');
var BASE = 'https://api.themoviedb.org/3';
var LOCALES = { en: 'en-US', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' };
function json(url, headers, cb) {
  var done = false;
  function finish(e, data) { if (!done) { done = true; cb(e, data); } }
  var u = require('url').parse(url); u.headers = headers;
  var req = https.get(u, function (res) {
    var body = '', bytes = 0;
    if (res.statusCode !== 200) {
      res.resume();
      return finish(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'TMDB refused the token.  Check it in Settings > My media.' : res.statusCode === 429 ? 'TMDB is busy.  Please try again later.' : 'Movie details service returned HTTP ' + res.statusCode + '.  Try again later.'));
    }
    res.setEncoding('utf8');
    res.on('data', function (b) { bytes += Buffer.byteLength(b); if (bytes > 2097152) { finish(new Error('Movie details response is too large.')); req.abort(); } else body += b; });
    res.on('end', function () { try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error('Movie details response could not be read.')); } });
    res.on('error', function () { finish(new Error('Movie details connection failed.')); });
  });
  req.on('error', function () { finish(new Error('Could not reach TMDB.')); });
  req.setTimeout(10000, function () { finish(new Error('Movie details request timed out.')); req.abort(); });
}
function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
function normal(v) { return str(v, 200).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function image(path, size) { return /^\/[a-zA-Z0-9._-]+$/.test(path || '') ? 'https://image.tmdb.org/t/p/' + size + path : ''; }
function art(list, language, fallback) {
  list = Array.isArray(list) ? list : [];
  var langs = [language, null, 'en'];
  for (var i = 0; i < langs.length; i++) {
    var found = list.filter(function (x) { return x && x.iso_639_1 === langs[i] && image(x.file_path, 'w185'); });
    found.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0); });
    if (found.length) return found[0].file_path;
  }
  return fallback || '';
}
function details(m, en, language) {
  var fallbackFields = [], images = m.images || {}, out = { provider: 'TMDB', id: 'tmdb:' + m.id, language: language, requestedLanguage: language };
  function field(name, local, english) {
    if (local) return local;
    if (english && language !== 'en') fallbackFields.push(name);
    return english || '';
  }
  function genres(x) { return (Array.isArray(x.genres) ? x.genres : []).slice(0, 12).map(function (g) { return str(g.name, 50); }).filter(Boolean).join(', '); }
  out.title = field('title', str(m.title, 200), str(en.title, 200));
  out.plot = field('plot', str(m.overview, 5000), str(en.overview, 5000));
  out.genre = field('genre', genres(m), genres(en));
  out.year = str(m.release_date || en.release_date, 4);
  out.releaseDate = str(m.release_date || en.release_date, 10);
  out.runtime = (m.runtime || en.runtime) > 0 ? Math.min(9999, m.runtime || en.runtime) + ' min' : '';
  out.poster = image(art(images.posters, language, m.poster_path || en.poster_path), 'w185');
  out.backdrop = image(art(images.backdrops, language, m.backdrop_path || en.backdrop_path), 'w780');
  out.fallbackFields = fallbackFields;
  return out;
}
function create(opts) {
  opts = opts || {};
  var credential = str(opts.credential, 2048).trim(), read = opts.read || json;
  function request(path, cb) {
    var headers = { Accept: 'application/json' }, url = BASE + path;
    if (/^[a-f0-9]{32}$/i.test(credential)) url += (url.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + encodeURIComponent(credential);
    else headers.Authorization = 'Bearer ' + credential;
    read(url, headers, cb);
  }
  function lookup(q, cb) {
    if (!credential) return cb(new Error('Add your TMDB API key or Read Access Token in Settings > My media.'));
    if (q.check) return request('/configuration', function (e) { cb(e, e ? null : { ok: true }); });
    var language = LOCALES[q.language] ? q.language : 'en', locale = LOCALES[language];
    function byId(id) {
      id = String(id || '');
      if (/^tt[0-9]+$/.test(id)) return request('/find/' + id + '?external_source=imdb_id&language=' + locale, function (e, r) {
        if (e) return cb(e);
        var found = r && r.movie_results || [];
        if (found.length !== 1) return cb(new Error('The saved movie match could not be found on TMDB.  Choose a match manually.'));
        byId('tmdb:' + found[0].id);
      });
      if (!/^tmdb:[1-9][0-9]*$/.test(id)) return cb(new Error('Choose a valid movie match.'));
      var path = '/movie/' + id.slice(5);
      request(path + '?language=' + locale + '&append_to_response=images&include_image_language=' + language + ',en,null', function (e, m) {
        if (e) return cb(e);
        if (!m || !m.id) return cb(new Error('No movie details found.'));
        var needsEnglish = language !== 'en' && (!m.title || !m.overview || !m.genres || !m.genres.length);
        if (!needsEnglish) return cb(null, { metadata: details(m, {}, language) });
        request(path + '?language=en-US', function (e, en) { if (e) return cb(e); cb(null, { metadata: details(m, en || {}, language) }); });
      });
    }
    if (q.id) return byId(q.id);
    var title = str(q.title, 200).trim(), year = /^\d{4}$/.test(q.year || '') ? String(q.year) : '';
    if (!title) return cb(new Error('Enter a movie title.'));
    request('/search/movie?query=' + encodeURIComponent(title) + '&language=' + locale + (year ? '&year=' + year : ''), function (e, r) {
      if (e) return cb(e);
      var matches = (r && Array.isArray(r.results) ? r.results : []).filter(function (m) { return m && /^[1-9][0-9]*$/.test(String(m.id)); }).slice(0, 20).map(function (m) {
        return { id: 'tmdb:' + m.id, title: str(m.title || m.original_title, 200), original: str(m.original_title, 200), year: str(m.release_date, 4) };
      });
      var exact = matches.filter(function (m) { return (normal(m.title) === normal(title) || normal(m.original) === normal(title)) && (!year || m.year === year); });
      if (q.auto && exact.length === 1) return byId(exact[0].id);
      cb(null, { matches: matches });
    });
  }
  return { lookup: lookup, configured: function () { return !!credential; } };
}
module.exports = { lookup: function (q, cb) { return create({ credential: q.credential }).lookup(q, cb); }, create: create };
