/* TV shows from TheTVDB, for viewers without a TMDB token (Settings > Movies and shows > Series details from
   TheTVDB).  The helper asks TiviBro's metadata relay (meta/worker.js, a Cloudflare Worker that holds TheTVDB's
   project key), never TheTVDB directly, so no key is on the TV.  Only a show's name (and year, the channel's
   country and your language) leaves the TV.  Metadata provided by TheTVDB.

   lookup(q, cb), the same questions and answers as media-metadata.js's TV lookups:
     q.guide + q.title (q.year, q.country, q.language): a show by name, from the guide or the Shows screen
       -> { metadata } (the show) or { miss: true }
     q.id 'tvdb:372264': the show -> { metadata }
     q.id 'tvdb:372264', q.season 2: that season -> { metadata: { episodes: [...] } }
   ES5 / Node 0.12. */
'use strict';
var https = require('https');
var BASE = 'https://tivibro-meta.theboxmod.workers.dev';
var LANGS = ['en', 'de', 'es', 'fr', 'pt', 'ru', 'it', 'tr', 'pl', 'nl'];
// A channel's country as TheTVDB writes it (three letters).
var CC3 = { US: 'usa', GB: 'gbr', UK: 'gbr', CA: 'can', AU: 'aus', NZ: 'nzl', IE: 'irl', IN: 'ind', DE: 'deu', AT: 'aut', CH: 'che', FR: 'fra', ES: 'esp', MX: 'mex', AR: 'arg',
  IT: 'ita', NL: 'nld', BE: 'bel', PT: 'prt', BR: 'bra', PL: 'pol', RU: 'rus', TR: 'tur', SE: 'swe', NO: 'nor', DK: 'dnk', FI: 'fin', JP: 'jpn', KR: 'kor', ZA: 'zaf' };
// TheTVDB's language of a show, as TiviBro's details write it (Audio language: Original, player.js).
var LANG2 = { eng: 'en', deu: 'de', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja', kor: 'ko', tur: 'tr', pol: 'pl', nld: 'nl', swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', zho: 'zh', hin: 'hi' };

function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
// One GET from the relay: its JSON, or an error a person can read.
function get(url, headers, cb) {
  var done = false;
  function finish(e, data) { if (!done) { done = true; cb(e, data); } }
  var u = require('url').parse(url); u.headers = { Accept: 'application/json' };
  var req = https.get(u, function (res) {
    var body = '', bytes = 0;
    if (res.statusCode !== 200) { res.resume(); var f = new Error(res.statusCode === 429 ? 'TheTVDB is busy.  Please try again later.' : 'TheTVDB could not be reached.  Try again later.'); f.status = res.statusCode; return finish(f); }
    res.setEncoding('utf8');
    res.on('data', function (b) { bytes += Buffer.byteLength(b); if (bytes > 1048576) { finish(new Error('TheTVDB answer is too large.')); req.abort(); } else body += b; });
    res.on('end', function () { try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error('TheTVDB answer could not be read.')); } });
    res.on('error', function () { finish(new Error('TheTVDB connection failed.')); });
  });
  req.on('error', function () { finish(new Error('Could not reach TheTVDB.')); });
  req.setTimeout(12000, function () { finish(new Error('TheTVDB took too long to answer.')); req.abort(); });
  return { cancel: function () { if (!done) { finish(new Error('Metadata request cancelled.')); try { req.abort(); } catch (e) {} } } };
}
// Answers kept a week (the relay keeps them too): one cache for every lookup the helper makes.
var cached = require('./media-metadata-cache').create(function (url, headers, cb) { return api._get(url, headers, cb); }, { maxEntries: 400 });
function ask(path, cb) { return cached(BASE + path, {}, cb); }

/* ---------- matching a name ---------- */
var FOLD = { 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ś': 's', 'ł': 'l', 'ż': 'z', 'ź': 'z', 'ń': 'n', 'ę': 'e', 'ą': 'a', 'ć': 'c', 'ß': 'ss' };
// A name for comparing: lower case, accents folded, without "The" in front, "&" read as "and", letters and digits only.
function key(v) {
  return str(v, 200).toLowerCase().replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\x00-\x7f]/g, function (ch) { return FOLD[ch] || ''; }).replace(/[^a-z0-9]/g, '');
}
// TheTVDB writes a show's country or year after its name when several share it: "The Office (US)", "Shameless (2011)".
function bare(v) { return str(v, 200).replace(/\s*\((?:[A-Z]{2,3}|(?:19|20)\d\d)\)\s*$/, ''); }
function named(r, name) {
  var want = key(name);
  return !!want && [r.name, r.original].concat(r.aliases || []).some(function (n) { return key(n) === want || key(bare(n)) === want; });
}
/* The names to try, in order: the name, the name without a season number after it ("Przyjaciele 8"), the part
   before a colon or dash (guides put the episode there: "Modern Marvels: Ink"). */
function names(title) {
  var out = [title], b = /^(.*\D)\s+\d{1,2}$/.exec(title), main = title.split(/\s*:\s+|\s+[-–]\s+/)[0];
  if (b && (/\s/.test(b[1].trim()) || key(b[1]).length >= 8)) out.push(b[1].trim());
  if (main !== title && key(main).length >= 3) out.push(main);
  return out.filter(function (n, i) { return out.map(key).indexOf(key(n)) === i; });
}
/* Of the shows named exactly so: the one that started in the year given, then the channel's country's, then one
   spelled the same, then TheTVDB's own order (best known first).  A guide that only might be a show (weak) needs one
   with a poster and a summary, and only one such unless the year or country decides: a programme that merely
   shares its name with an obscure show isn't dressed up as it. */
function choose(results, name, year, cc3, strong) {
  var exact = results.filter(function (r) { return named(r, name); });
  if (!strong) exact = exact.filter(function (r) { return r.poster && r.overview; });
  if (!exact.length) return null;
  var rank = exact.map(function (r, i) {
    return { r: r, s: (year && r.year === year ? 8 : 0) + (cc3 && r.country === cc3 ? 4 : 0) + (str(r.name, 200).toLowerCase() === name.toLowerCase() ? 2 : 0) + (r.poster ? 1 : 0), i: i };
  });
  rank.sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); });
  if (!strong && rank.length > 1 && rank[0].s < 4 && !(year && rank[0].r.year === year)) return null;
  return rank[0].r;
}

/* ---------- the answers, in media-metadata.js's shape ---------- */
function show(s, language) {
  return { provider: 'TheTVDB', id: 'tvdb:' + s.id, kind: 'show', language: language, title: bare(s.title) || str(s.title, 200), originalTitle: str(s.originalTitle, 200), plot: str(s.plot, 5000),
    genre: str(s.genre, 300), year: str(s.year, 4), releaseDate: str(s.releaseDate, 10), runtime: str(s.runtime, 20), poster: str(s.poster, 500), backdrop: str(s.backdrop, 500),
    backdropHd: str(s.backdropHd, 500), logo: str(s.logo, 500), rating: '', cast: str(s.cast, 600), network: str(s.network, 100), status: str(s.status, 40),
    originalLanguage: LANG2[s.originalLanguage] || '', seasons: (s.seasons || []).map(function (x) { return { number: x.number }; }), directors: [], fallbackFields: [], v: 2 };
}
function season(id, n, list, language) {
  return { provider: 'TheTVDB', id: 'tvdb:' + id + ':season:' + n, kind: 'season', language: language, episodes: (list || []).map(function (e) {
    return { id: 'tvdb:' + id + ':season:' + n + ':episode:' + e.number, number: e.number, season: e.season, title: str(e.title, 200), plot: str(e.plot, 5000), airDate: str(e.airDate, 10), runtime: e.runtime || null, still: str(e.still, 500) };
  }) };
}

// One question (see the top of this file): a season, a show by its id, or a show by name tried name by name.
function lookup(q, cb) {
  q = q || {};
  var language = LANGS.indexOf(String(q.language || '').slice(0, 2)) >= 0 ? String(q.language).slice(0, 2) : 'en', lang = '?lang=' + language;
  var m = /^tvdb:([1-9][0-9]{0,9})$/.exec(String(q.id || ''));
  if (m && q.season != null) {
    if (typeof q.season !== 'number' || q.season < 0 || Math.floor(q.season) !== q.season) return cb(new Error('Choose a valid season.'));
    return ask('/v1/series/' + m[1] + '/season/' + q.season + lang, function (e, r) { cb(e, e ? null : { metadata: season(m[1], q.season, r && r.episodes, language) }); });
  }
  if (m) return ask('/v1/series/' + m[1] + lang, function (e, r) { if (e) return cb(e); cb(null, r && r.show ? { metadata: show(r.show, language) } : { miss: true }); });
  var title = str(q.title, 200).trim(), year = /^(19|20)\d\d$/.test(q.year || '') ? String(q.year) : '', strong = q.guide === 'strong';
  var cc3 = CC3[String(q.country || '').toUpperCase()] || '';
  if (!title || !key(title)) return cb(null, { miss: true });
  var list = names(title);
  // Each name in turn; a year that finds nothing is tried once without it (a guide's year can be the episode's).
  function tryName(i, withYear) {
    if (i >= list.length) return cb(null, { miss: true });
    ask('/v1/search?q=' + encodeURIComponent(list[i]) + (withYear && year ? '&year=' + year : '') + '&lang=' + language, function (e, r) {
      if (e) return cb(e);
      var pick = choose(r && Array.isArray(r.results) ? r.results : [], list[i], year, cc3, strong);
      if (!pick) return withYear && year ? tryName(i, false) : tryName(i + 1, true);
      lookup({ id: 'tvdb:' + pick.id, language: language }, cb);
    });
  }
  tryName(0, true);
}

var api = module.exports = { lookup: lookup, _get: get, _choose: choose, _names: names, _cache: cached };
