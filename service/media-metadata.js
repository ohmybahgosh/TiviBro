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
/* Accents folded ("Świnka Peppa" is "swinka peppa", "Amélie" is "amelie"), by a table: the helper runs on Node 0.12
   on old TVs, which may have no String.prototype.normalize.  Other scripts have no letters here. */
var FOLD = {};
'àáâãäåāăą:a|çćĉċč:c|ďđ:d|èéêëēĕėęě:e|ĝğġģ:g|ĥħ:h|ìíîïĩīĭįı:i|ĵ:j|ķ:k|ĺļľŀł:l|ñńņňŉ:n|òóôõöøōŏő:o|ŕŗř:r|śŝşšș:s|ţťŧț:t|ùúûüũūŭůűų:u|ŵ:w|ýÿŷ:y|źżž:z|æ:ae|œ:oe|ß:ss|þ:th'.split('|').forEach(function (g) { var p = g.split(':'); p[0].split('').forEach(function (ch) { FOLD[ch] = p[1]; }); });
function normal(v) { return str(v, 200).toLowerCase().replace(/[^\x00-\x7f]/g, function (ch) { return FOLD[ch] || ''; }).replace(/[^a-z0-9]/g, ''); }
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
  // The telling words of a description: four letters or more, without the common ones, each once.
  var COMMON = /^(that|this|with|from|they|their|them|then|than|when|what|where|which|while|who|whose|into|onto|about|after|before|over|under|have|has|had|been|being|were|will|would|could|should|must|just|only|also|very|more|most|some|such|each|every|other|their|there|these|those|your|yours|ours|his|hers|film|movie|story|life|lives|finds|find|tries|must|gets|takes|make|makes|turns|when|year|years|young|first|last|back|down|even|ever|much|many|one|two)$/;
  function words(t) {
    var out = [];
    String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).forEach(function (w) {
      if (w.length < 4 || COMMON.test(w)) return;
      w = w.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '');
      if (w.length >= 4 && out.indexOf(w) < 0) out.push(w);
    });
    return out.slice(0, 60);
  }
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
      /* Several films of that name and no year: the guide's own description says which ("helping his brother win the
         race for governor" is 1996's Black Sheep, not 2006's horror one).  The one whose TMDB summary shares the
         most words with it, when that is clearly the most (2 words, and more than any other). */
      var told = words(q.description);
      if (!year && exact.length > 1 && told.length >= 4) {
        var scored = exact.map(function (m) { var w = words(m.overview), n = 0; told.forEach(function (t) { if (w.indexOf(t) >= 0) n++; }); return { m: m, n: n }; });
        scored.sort(function (a, b) { return b.n - a.n; });
        if (scored[0].n >= 2 && scored[0].n > scored[1].n) best = scored[0].m;
      }
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
    // The channel's country ('US', 'GB'): of two shows with the name, that country's ("Cheaters" and "Deal or No
    // Deal" on a US channel are the US shows, not the better known British ones).
    var cc = /^[A-Za-z]{2}$/.test(q.country || '') ? String(q.country).toUpperCase().replace(/^UK$/, 'GB') : '';
    // normal() keeps only a-z and 0-9: a title in another script would compare equal to every other one.
    if (!title || !normal(title)) return cb(null, { miss: true });
    /* Only a show of exactly that name.  A guide that said nothing of season and episode (weak) needs a show
       some people know (5 votes), a guide that did (strong) any.  No such show: the part before a colon or a
       dash, as guides often put the episode there ("Modern Marvels: Ink", "Ax Men - Timber Wars"). */
    var main = title.split(/\s*:\s+|\s+[-–]\s+/)[0];
    // A host's name after the show's ("Unsolved Mysteries With Robert Stack", "The Joy of Painting with Bob Ross").
    var host = /^(.+?)\s+with\s+[A-Z][a-z]/.exec(main);
    host = host && (/\s/.test(host[1].replace(/^\s*(the|a|an)\s+/i, '')) || normal(host[1]).length >= 6) ? host[1] : '';
    /* Then the name without what guides add at its end that TMDB doesn't have, when a show of exactly that shorter
       name is one people know (20+ votes): "Hannah Montana Forever" (the name its last season went by), "Cops
       Reloaded", "Ghost Adventures Classics".  A country at the end is the country's own show ("Deal or No Deal
       Australia" is the Australian one, never NBC's).  Any other word stays: "Second Chance Pets" is not "Second
       Chance".  Never down to one word. */
    var ADDS = /^(forever|reloaded|classics?|favou?rites|revisited|uncut|remastered|redux|extra|presents|unleashed|tonight|weekend|weekly|daily|marathon|encore|special|specials|rewind|replay|vault|collection)$/i;
    var LANDS = { usa: 'US', us: 'US', america: 'US', american: 'US', uk: 'GB', britain: 'GB', british: 'GB', australia: 'AU', aus: 'AU', canada: 'CA', 'new zealand': 'NZ', nz: 'NZ', ireland: 'IE', india: 'IN', south_africa: 'ZA' };
    var words = main.split(/\s+/), names = [{ n: title, min: strong ? 1 : 5 }];
    /* A season number after the name, as some guides give it ("Świnka Peppa 7", "Przyjaciele 8", "Ojciec Mateusz
       2"): the name without it, once a show of the whole name ("Teen Mom 2", "Catch 21") isn't found.  Not down
       to a short single word ("Blue 3" is not the show "Blue"). */
    var bare = /^(.*\D)\s+\d{1,2}$/.exec(title);
    if (bare && (/\s/.test(bare[1].trim()) || normal(bare[1]).length >= 8 || /[^\x00-\x7f]/.test(bare[1]))) names.push({ n: bare[1].trim(), min: strong ? 1 : 5 });
    if (main !== title && normal(main).length >= 3) names.push({ n: main, min: strong ? 1 : 5 });
    if (host) names.push({ n: host, min: strong ? 1 : 5 });
    /* An owner in front that TMDB leaves out ("Marvel's Spidey and His Amazing Friends" is "Spidey and His Amazing
       Friends" there): the rest, when it is two words or more ("Grey's Anatomy" never becomes "Anatomy"). */
    var owned = /^[A-Z][A-Za-z.\-]+(?:\s+[A-Z][A-Za-z.\-]+){0,2}['’]s\s+(\S+\s+\S.{2,})$/.exec(main);
    if (owned) names.push({ n: owned[1], min: strong ? 1 : 5 });
    // ("The" in front doesn't count: "The Great American Journey" is never cut down to "The Great".)
    var lead = /^(the|a|an)$/i.test(words[0]) ? 1 : 0;
    // A word guides put in front: "Classic Doctor Who", "Best of Cops".
    var front = /^(?:classic|the best of|best of|vintage|retro)\s+(.{4,})$/i.exec(main);
    if (front) names.push({ n: front[1], min: 20, old: /classic|vintage|retro/i.test(main) });
    for (var cut = 1; cut <= 2 && words.length - cut - lead >= 1; cut++) {
      var shorter = words.slice(0, words.length - cut).join(' ').replace(/[\s,:;&\-–]+$/, ''), gone = words.slice(words.length - cut).map(function (w) { return w.replace(/[^\w]/g, ''); });
      var land = LANDS[gone.join(' ').toLowerCase()] || (cut === 1 && LANDS[gone[0].toLowerCase()]) || '';
      if (!land && !gone.every(function (w) { return ADDS.test(w); })) continue;
      // Down to one word only for a name guides add to ("Cops Reloaded" is "Cops"), never for a country.
      if (words.length - cut - lead < 2 && (land || normal(words.slice(0, words.length - cut).join(' ')).length < 4)) continue;
      if (normal(shorter).length >= (land ? 6 : 4) && !/^(the|a|an|and|of|in|on|at|to|for|with|my|your|our)$/i.test(words[words.length - cut - 1])) names.push({ n: shorter, min: 20, cc: land });
    }
    // The same name twice (the season number cut, then the last word cut): asked once, at the lower bar.
    var seenName = {};
    names = names.filter(function (x) { var k = showName(x.n); if (seenName[k]) return false; seenName[k] = 1; return true; });
    /* The same show under the name TMDB gives it: with its owner in front ("Tyler Perry's House of Payne", "Lauren
       Lake's Paternity Court") or as "The ... Show" ("The Tamron Hall Show"), when the guide leaves that out. */
    function sameShow(t, name) {
      var want = showName(name);
      return [t.name, t.original_name].some(function (n) {
        n = str(n, 200);
        if (showName(n) === want) return true;
        var owner = /^[A-Z][A-Za-z.\-]+(?:\s+[A-Z][A-Za-z.\-]+){0,2}['’]s\s+(.+)$/.exec(n);
        if (owner && !/['’]s\s/.test(name) && showName(owner[1]) === want) return true;
        var from = /^(.+?)\s+from\s+\S.*$/i.exec(n);
        if (from && showName(from[1]) === want && want.length >= 10) return true;
        var sh = /^(?:the\s+)?(.+?)\s+show$/i.exec(n);
        return !!(sh && !/\bshow$/i.test(name) && showName(sh[1]) === want);
      });
    }
    // Spelled the same, "The" and all ("War" is WAR before PBS's "The War").
    function literal(t, name) { return normal(t.name) === normal(name) || normal(t.original_name) === normal(name); }
    function exactName(t, name) { return showName(t.name) === showName(name) || showName(t.original_name) === showName(name); }
    /* Names on a channel from another country are in its language ("Świnka Peppa" on a Polish channel): when no
       show is found in yours, they are searched again in the channel's (the details still come in yours). */
    var BY_CC = { PL: 'pl-PL', DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', IT: 'it-IT', NL: 'nl-NL', PT: 'pt-PT', BR: 'pt-BR',
      TR: 'tr-TR', SE: 'sv-SE', NO: 'no-NO', DK: 'da-DK', FI: 'fi-FI', RO: 'ro-RO', HU: 'hu-HU', CZ: 'cs-CZ', SK: 'sk-SK', HR: 'hr-HR', RS: 'sr-RS', AL: 'sq-AL', GR: 'el-GR' };
    var search = locale;
    function ask(i) {
      var name = names[i].n;
      request('/search/tv?query=' + encodeURIComponent(name) + '&language=' + search, function (e, r) {
        if (e) return cb(e);
        var all = (r && Array.isArray(r.results) ? r.results : []).filter(function (t) { return t && /^[1-9][0-9]*$/.test(String(t.id)); });
        // Only when TMDB has no show of exactly this name: one only like it ("Looney Tunes" is the old cartoons, even
        // with few votes, not "The Looney Tunes Show").
        var exact = all.filter(function (t) { return exactName(t, name); });
        if (!exact.length) exact = exact.concat(all.filter(function (t) { return !exactName(t, name) && sameShow(t, name); }));
        /* Of those: one people know (the bar for this name), then the one that started in the year given, then the
           channel's country's, then the best known. */
        /* A long name spelled exactly the same (three words or more besides "The", or 16 letters) is the show
           however few have voted, when TMDB has something to show for it ("Funny You Should Ask", "The Great
           American Journey"): a name that long is not shared by chance.  ("On the Fly" and "Odd One Out" are short.) */
        var long = (name.replace(/^\s*(the|a|an)\s+/i, '').split(/\s+/).length >= 3 && normal(name).length >= 12) || normal(name).length >= 16;
        var known = exact.filter(function (t) {
          var bar = long && literal(t, name) && (t.poster_path || t.overview) ? 0 : names[i].min;
          return (t.vote_count || 0) >= bar && (!names[i].cc || (t.origin_country || []).indexOf(names[i].cc) >= 0);
        });
        known.sort(function (a, b) {
          // "Classic Doctor Who" is the first one.
          if (names[i].old && a.first_air_date && b.first_air_date && a.first_air_date !== b.first_air_date) return a.first_air_date < b.first_air_date ? -1 : 1;
          return (year ? (str(b.first_air_date, 4) === year) - (str(a.first_air_date, 4) === year) : 0) || (literal(b, name) - literal(a, name)) || (exactName(b, name) - exactName(a, name)) ||
            (cc ? ((b.origin_country || []).indexOf(cc) >= 0) - ((a.origin_country || []).indexOf(cc) >= 0) : 0) || (b.popularity || 0) - (a.popularity || 0);
        });
        var best = known[0];
        // A show of exactly this name that few know: this is it, too obscure to be sure, so no shorter name is tried
        // ("The Great American Journey" is not "The Great").
        if (!best && all.some(function (t) { return exactName(t, name); })) return cb(null, { miss: true });
        if (!best) return i + 1 < names.length ? ask(i + 1) : again();
        tvLookup({ id: 'tmdb:tv:' + best.id, language: language }, function (e2, x) { cb(e2, x && x.metadata ? { metadata: x.metadata } : { miss: true }); });
      });
    }
    function again() {
      var other = BY_CC[cc];
      if (!other || other === search || other.slice(0, 2) === locale.slice(0, 2)) return cb(null, { miss: true });
      search = other; ask(0);
    }
    ask(0);
  }
  return { cancel:function(){cancelled=true;jobs.forEach(function(job){job.cancel();});jobs=[];}, lookup: function (q, cb) { return q && q.guide ? (q.kind === 'tv' ? guideTvLookup(q, cb) : guideLookup(q, cb)) : q && (q.kind === 'tv' || /^tmdb:tv:/.test(q.id || '')) ? tvLookup(q, cb) : lookup(q, cb); }, configured: function () { return !!credential; } };
}
module.exports = { lookup: function (q, cb) { return create({ credential: q.credential, refresh:!!q.refresh }).lookup(q, cb); }, create: create };
