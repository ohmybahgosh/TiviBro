/* TMDB movie details.  The app sends the viewer's locally stored TMDB credential per request.  Only title/year or a chosen movie ID and locale leave
   the TV.  Provider logins and playback links never reach TMDB.  ES5 / Node 0.12. */
'use strict';
var https = require('https');
var BASE = 'https://api.themoviedb.org/3';
var LOCALES = { en: 'en-US', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' };
function networkJson(url, headers, cb) {
  var done = false;
  function finish(e, data) { if (!done) { done = true; cb(e, data); } }
  var u = require('url').parse(url); u.headers = headers;
  var req = https.get(u, function (res) {
    var body = '', bytes = 0;
    if (res.statusCode !== 200) {
      res.resume();
      var failure = new Error(res.statusCode === 401 || res.statusCode === 403 ? 'TMDB refused the token.  Check it in Settings > My media.' : res.statusCode === 429 ? 'TMDB is busy.  Please try again later.' : 'Movie details service returned HTTP ' + res.statusCode + '.  Try again later.');
      failure.status = res.statusCode;
      var retry = res.headers['retry-after']; failure.retryAfter = /^[0-9]+$/.test(retry || '') ? +retry : Math.max(0,(Date.parse(retry || '') - Date.now()) / 1000);
      return finish(failure);
    }
    res.setEncoding('utf8');
    res.on('data', function (b) { bytes += Buffer.byteLength(b); if (bytes > 2097152) { finish(new Error('Movie details response is too large.')); req.abort(); } else body += b; });
    res.on('end', function () { try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error('Movie details response could not be read.')); } });
    res.on('error', function () { finish(new Error('Movie details connection failed.')); });
  });
  req.on('error', function () { finish(new Error('Could not reach TMDB.')); });
  req.setTimeout(10000, function () { finish(new Error('Movie details request timed out.')); req.abort(); });
  return {cancel:function(){if(done)return;finish(new Error('Metadata request cancelled.'));try{req.abort();}catch(e){}}};
}
var json = require('./media-metadata-cache').create(networkJson);
function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
function normal(v) { return str(v, 200).toLowerCase().replace(/[^a-z0-9]/g, ''); }
// A show's name for comparing: also without "The" in front and with "&" read as "and" ("Big Bang Theory" is
// "The Big Bang Theory" on TMDB, "Rubble and Crew" is "Rubble & Crew").
function showName(v) { return normal(str(v, 200).replace(/&/g, ' and ').replace(/^\s*the\s+/i, '')); }
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
  out.backdropHd = image(art(images.backdrops, language, m.backdrop_path || en.backdrop_path), 'w1280');
  // The title as artwork (Movies on now): in your language, else English; none is fine.
  var logos = (Array.isArray(images.logos) ? images.logos : []).filter(function (x) { return x && image(x.file_path, 'w500'); }), lg = null;
  [language, 'en'].some(function (l) { var f = logos.filter(function (x) { return x.iso_639_1 === l; }); f.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0); }); lg = f[0]; return !!lg; });
  out.logo = lg ? image(lg.file_path, 'w500') : '';
  out.rating = (m.vote_average || en.vote_average) > 0 ? String(Math.round((m.vote_average || en.vote_average) * 10) / 10) : '';
  out.fallbackFields = fallbackFields;
  return out;
}
function create(opts) {
  opts = opts || {};
  var credential = str(opts.credential, 2048).trim(), read = opts.read || json, cancelled=false, jobs=[];
  function request(path, cb) {
    var headers = { Accept: 'application/json' }, url = BASE + path;
    if (/^[a-f0-9]{32}$/i.test(credential)) url += (url.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + encodeURIComponent(credential);
    else headers.Authorization = 'Bearer ' + credential;
    if(cancelled)return;var job=read(url,headers,function(e,r){if(!cancelled)cb(e,r);},opts.refresh || /\/configuration(?:\?|$)/.test(path));if(job&&job.cancel)jobs.push(job);return job;
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
  function tvLookup(q, cb) {
    if (!credential) return cb(new Error('Add your TMDB token first.'));
    var language = LOCALES[q.language] ? q.language : 'en', locale = LOCALES[language];
    var match = /^tmdb:tv:([1-9][0-9]*)$/.exec(String(q.id || ''));
    if (!match) {
      var query = str(q.title,200).trim();
      if (!query) return cb(new Error('Enter a show title.'));
      return request('/search/tv?query='+encodeURIComponent(query)+'&language='+locale+(q.year ? '&first_air_date_year='+encodeURIComponent(q.year) : ''),function (e,r) {
        if (e) return cb(e);
        var matches = (r && Array.isArray(r.results) ? r.results : []).filter(function (m) { return m && /^[1-9][0-9]*$/.test(String(m.id)); }).slice(0,20).map(function (m) { return {id:'tmdb:tv:'+m.id,title:str(m.name || m.original_name,200),original:str(m.original_name,200),year:str(m.first_air_date,4),poster:image(m.poster_path,'w185')}; });
        var exact = matches.filter(function (m) { return (normal(m.title) === normal(query) || normal(m.original) === normal(query)) && (!q.year || m.year === String(q.year)); });
        if (q.auto && exact.length === 1) { var next = {}; Object.keys(q).forEach(function (k) { next[k] = q[k]; }); next.id = exact[0].id; return tvLookup(next,cb); }
        cb(null,{matches:matches});
      });
    }
    var id = match[1], route = '/tv/'+id, suffix = '', key = 'tmdb:tv:'+id;
    if (q.groups) return request(route+'/episode_groups',function (e,r) { cb(e,e ? null : {groups:r && r.results || []}); });
    if (q.groupId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(q.groupId)) return cb(new Error('Choose a valid episode group.'));
      return request('/tv/episode_group/'+q.groupId,function (e,r) { cb(e,e ? null : {group:r}); });
    }
    if (q.season != null) {
      if (typeof q.season !== 'number' || q.season < 0 || Math.floor(q.season) !== q.season) return cb(new Error('Choose a valid season.'));
      suffix += '/season/'+q.season; key += ':season:'+q.season;
      if (q.episode != null) {
        if (typeof q.episode !== 'number' || q.episode < 1 || Math.floor(q.episode) !== q.episode) return cb(new Error('Choose a valid episode.'));
        suffix += '/episode/'+q.episode; key += ':episode:'+q.episode;
      }
    }
    function convert(m, english) {
      function movieShape(x) { var out = {}; Object.keys(x).forEach(function (k) { out[k] = x[k]; }); out.title = x.name; out.release_date = x.first_air_date || x.air_date; out.runtime = x.runtime || (x.episode_run_time || [])[0]; return out; }
      var out = details(movieShape(m),movieShape(english || {}),language);
      out.id = key; out.kind = q.episode != null ? 'episode' : q.season != null ? 'season' : 'show'; out.originalTitle = str(m.original_name,200); out.status = str(m.status,100);
      out.still = image(m.still_path,'w500');
      out.cast = ((m.credits || {}).cast || []).slice(0,20).map(function(person){return str(person.name,100);}).filter(Boolean).join(', ');
      out.network = Array.isArray(m.networks) && m.networks[0] ? str(m.networks[0].name,100) : '';
      if (Array.isArray(m.seasons)) out.seasons = m.seasons.map(function (season) { return {number:season.season_number,title:str(season.name,200),episodeCount:season.episode_count,airDate:str(season.air_date,10),poster:image(season.poster_path,'w185')}; });
      if (Array.isArray(m.episodes)) out.episodes = m.episodes.map(function (episode) { var en={};((english||{}).episodes||[]).some(function(e){if(e.episode_number===episode.episode_number){en=e;return true;}return false;}); return {id:'tmdb:tv:'+id+':season:'+q.season+':episode:'+episode.episode_number,number:episode.episode_number,season:episode.season_number,title:str(episode.name||en.name,200),plot:str(episode.overview||en.overview,5000),airDate:str(episode.air_date,10),runtime:episode.runtime || null,still:image(episode.still_path,'w500')}; });
      return out;
    }
    request(route+suffix+'?language='+locale+'&append_to_response=images,credits&include_image_language='+language+',en,null',function (e,m) {
      if (e) return cb(e);
      if (!m || !m.id) return cb(new Error('No TV details found.'));
      if (language === 'en' || (m.name && m.overview && !(m.episodes||[]).some(function(ep){return !ep.name || !ep.overview;}))) return cb(null,{metadata:convert(m,{})});
      request(route+suffix+'?language=en-US',function (err,en) { if (err) return cb(err); cb(null,{metadata:convert(m,en || {})}); });
    });
  }
  /* A guide programme that may be a movie (app/js/movies.js): its title, maybe a year, and how sure the
     guide is (q.guide: 'strong' when it says Movie or the channel shows films, 'weak' for any long
     programme).  A movie of exactly that title (and year) is the answer; for a weak one it must also be
     well known (200+ votes) and not a better-known TV series of the same name.  { metadata } or { miss }. */
  function guideLookup(q, cb) {
    var language = LOCALES[q.language] ? q.language : 'en', locale = LOCALES[language];
    var title = str(q.title, 200).trim(), year = /^\d{4}$/.test(q.year || '') ? String(q.year) : '', weak = q.guide !== 'strong';
    if (!title || !normal(title)) return cb(null, { miss: true });            // (see guideTvLookup)
    request('/search/movie?query=' + encodeURIComponent(title) + '&language=' + locale + (year ? '&year=' + year : ''), function (e, r) {
      if (e) return cb(e);
      var exact = (r && Array.isArray(r.results) ? r.results : []).filter(function (m) {
        return m && /^[1-9][0-9]*$/.test(String(m.id)) && (normal(m.title) === normal(title) || normal(m.original_title) === normal(title)) && (!year || str(m.release_date, 4) === year);
      });
      exact.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
      var best = exact[0];
      if (!best || (weak && (best.vote_count || 0) < 200)) return cb(null, { miss: true });
      function take() { lookup({ id: 'tmdb:' + best.id, language: language }, function (e2, x) { cb(e2, x && x.metadata ? { metadata: x.metadata } : { miss: true }); }); }
      if (!weak) return take();
      request('/search/tv?query=' + encodeURIComponent(title) + '&language=' + locale, function (e3, tv) {
        if (e3) return cb(e3);
        var show = (tv && Array.isArray(tv.results) ? tv.results : []).filter(function (t) { return t && (normal(t.name) === normal(title) || normal(t.original_name) === normal(title)); })[0];
        if (show && (show.popularity || 0) >= (best.popularity || 0)) return cb(null, { miss: true });
        take();
      });
    });
  }
  /* A TV series by its name, from the guide or the provider's Shows (app/js/series.js): a show of exactly
     that name, the best known one when several have it (a US and a UK version), the one that started in
     q.year when one did.  q.guide 'strong' (the guide gave a season and episode, or it's the provider's
     own show) takes any such show; 'weak' only one with 5+ votes, so a programme that merely shares a
     name with an obscure show isn't dressed up as it.  { metadata } (the show) or { miss }. */
  function guideTvLookup(q, cb) {
    var language = LOCALES[q.language] ? q.language : 'en', locale = LOCALES[language];
    var title = str(q.title, 200).trim(), year = /^\d{4}$/.test(q.year || '') ? String(q.year) : '', strong = q.guide === 'strong';
    // normal() keeps only a-z and 0-9: a title in another script would compare equal to every other one.
    if (!title || !normal(title)) return cb(null, { miss: true });
    /* Only a show of exactly that name.  A guide that said nothing of season and episode (weak) needs a show
       some people know (5 votes), a guide that did (strong) any.  No such show: the part before a colon or a
       dash, as guides often put the episode there ("Modern Marvels: Ink", "Ax Men - Timber Wars"). */
    var main = title.split(/\s*:\s+|\s+[-–]\s+/)[0];
    /* Then the name without its last word or two, when a show of exactly that shorter name is one people
       know (20+ votes): guides add to a name what TMDB doesn't have ("Hannah Montana Forever", the name its
       last season went by, is "Hannah Montana" there).  Never shorter than two words. */
    var words = main.split(/\s+/), names = [{ n: title, min: strong ? 1 : 5 }];
    /* A season number after the name, as some guides give it ("Świnka Peppa 7", "Przyjaciele 8", "Ojciec Mateusz
       2"): the name without it, once a show of the whole name ("Teen Mom 2", "Catch 21") isn't found.  Not down
       to a short single word ("Blue 3" is not the show "Blue"). */
    var bare = /^(.*\D)\s+\d{1,2}$/.exec(title);
    if (bare && (/\s/.test(bare[1].trim()) || normal(bare[1]).length >= 8 || /[^\x00-\x7f]/.test(bare[1]))) names.push({ n: bare[1].trim(), min: strong ? 1 : 5 });
    if (main !== title && normal(main).length >= 3) names.push({ n: main, min: strong ? 1 : 5 });
    for (var cut = 1; cut <= 2 && words.length - cut >= 2; cut++) {
      var shorter = words.slice(0, words.length - cut).join(' ').replace(/[\s,:;&\-–]+$/, '');
      if (normal(shorter).length >= 6 && !/^(the|a|an|and|of|in|on|at|to|for|with|my|your|our)$/i.test(words[words.length - cut - 1])) names.push({ n: shorter, min: 20 });
    }
    // The same name twice (the season number cut, then the last word cut): asked once, at the lower bar.
    var seenName = {};
    names = names.filter(function (x) { var k = showName(x.n); if (seenName[k]) return false; seenName[k] = 1; return true; });
    function ask(i) {
      var name = names[i].n;
      request('/search/tv?query=' + encodeURIComponent(name) + '&language=' + locale, function (e, r) {
        if (e) return cb(e);
        var exact = (r && Array.isArray(r.results) ? r.results : []).filter(function (t) {
          return t && /^[1-9][0-9]*$/.test(String(t.id)) && (showName(t.name) === showName(name) || showName(t.original_name) === showName(name));
        });
        exact.sort(function (a, b) { return (year ? (str(b.first_air_date, 4) === year) - (str(a.first_air_date, 4) === year) : 0) || (b.popularity || 0) - (a.popularity || 0); });
        var best = exact[0];
        if (!best || (best.vote_count || 0) < names[i].min) return i + 1 < names.length ? ask(i + 1) : cb(null, { miss: true });
        tvLookup({ id: 'tmdb:tv:' + best.id, language: language }, function (e2, x) { cb(e2, x && x.metadata ? { metadata: x.metadata } : { miss: true }); });
      });
    }
    ask(0);
  }
  return { cancel:function(){cancelled=true;jobs.forEach(function(job){job.cancel();});jobs=[];}, lookup: function (q, cb) { return q && q.guide ? (q.kind === 'tv' ? guideTvLookup(q, cb) : guideLookup(q, cb)) : q && (q.kind === 'tv' || /^tmdb:tv:/.test(q.id || '')) ? tvLookup(q, cb) : lookup(q, cb); }, configured: function () { return !!credential; } };
}
module.exports = { lookup: function (q, cb) { return create({ credential: q.credential, refresh:!!q.refresh }).lookup(q, cb); }, create: create };
