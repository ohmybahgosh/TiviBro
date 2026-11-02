/* Local media evidence classifier.  No network or storage: observations and saved rules go in,
   typed candidates and review reasons come out.  ES5 for Node 0.12.  Unknown is never season 1. */
'use strict';
var VIDEO = /\.(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i;
var SEASON = /^(?:season|staffel|saison|temporada|stagione|seizoen|s)[ ._-]*(\d{1,3})$/i;
var GENERIC = /^(library|videos?|all videos|folders?|storage|shows?|tv|tv shows|series|movies?)$/i;
function text(v) { return v == null ? '' : String(v); }
function clean(v) { return text(v).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, ''); }
function base(v) { return text(v).replace(/\.[a-z0-9]{2,4}$/i, ''); }
function title(v) { return clean(v).replace(/\s*\[(?:\d{3,4}p|[a-f0-9]{8})\].*$/i, '').replace(/\s+(?:\d{3,4}p|bluray|web-dl|webrip|hdtv|x26[45]|hevc)\b.*$/i, '').trim(); }
function validDate(y, m, d) { var date = new Date(Date.UTC(+y, +m - 1, +d)); return date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d; }
function context(ancestors) {
  var c = {}, i, name, m;
  for (i = ancestors.length - 1; i >= 0; i--) {
    name = text(typeof ancestors[i] === 'object' ? ancestors[i].name : ancestors[i]);
    m = SEASON.exec(name);
    if (m && c.season == null) { c.season = +m[1]; continue; }
    if (/^specials$/i.test(name)) { if (c.season == null) c.season = 0; continue; }
    if (!GENERIC.test(name) && !m && !c.showTitle) c.showTitle = clean(name);
  }
  return c;
}
function classify(observation, options, overrides) {
  var o = observation || {}, opts = options || {}, file = text(o.basename || o.file), stem = base(file);
  var c = context(o.ancestors || []), r = { kind: 'movie', title: title(stem), season: null, numbers: [], order: null, showTitle: null, evidence: [], review: [] };
  var m, tail, rest, end, n, explicitSeason, rule = {};
  function note(origin, fields) { r.evidence.push({ origin: origin, fields: fields }); }
  function episode(show, season, numbers, origin) { r.kind = 'episode'; r.showTitle = title(show) || c.showTitle || null; r.season = season; r.numbers = numbers; r.order = 'aired'; note(origin, { showTitle: r.showTitle, season: season, numbers: numbers.slice() }); }
  if (!VIDEO.test(file)) { r.kind = 'unclassified'; r.review.push('unsupportedContainer'); return r; }
  m = /(?:^|[ ._\[(-])s(\d{1,3})[ ._-]*e(\d{1,4})((?:[ ._]*e\d{1,4})*|)(?:[ ._]*-[ ._]*(?:e)?(\d{1,4}))?/i.exec(stem);
  if (!m) m = /(?:^|[ ._\[(-])(\d{1,3})x(\d{2,4})(?:[ ._]*-[ ._]*(\d{1,4}))?(?=$|[ ._\])-])/i.exec(stem);
  if (m) {
    explicitSeason = +m[1]; tail = stem.slice(0, m.index); rest = [ +m[2] ];
    if (/s\d/i.test(m[0])) {
      text(m[3]).replace(/e(\d+)/gi, function (all, number) { rest.push(+number); return all; }); end = m[4] ? +m[4] : null;
    } else end = m[3] ? +m[3] : null;
    if (end != null) {
      if (end < rest[rest.length - 1] || end - rest[0] >= 50) r.review.push('invalidEpisodeRange');
      else for (n = rest[rest.length - 1] + 1; n <= end; n++) rest.push(n);
    }
    if (rest.some(function (v) { return v < 1; })) r.review.push('invalidEpisodeNumber');
    episode(tail, explicitSeason, rest, 'filename');
    if (c.season != null && c.season !== explicitSeason) r.review.push('conflictingSeason');
  } else {
    m = /(?:^|[ ._-])(episode|ep)[ ._-]*(\d{1,4})(?=$|[ ._-])/i.exec(stem);
    if (m) episode(stem.slice(0, m.index), c.season == null ? null : c.season, [+m[2]], 'filenameAndAncestors');
    else if (c.season != null && (m = /^(\d{1,3})[ ._-]+(.+)$/.exec(stem))) episode(c.showTitle, c.season, [+m[1]], 'ancestors');
    else if ((m = /(?:^|[ ._-])((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?=$|[ ._-])/.exec(stem))) {
      r.kind = 'unclassified'; r.showTitle = title(stem.slice(0, m.index)) || c.showTitle || null; r.order = 'date';
      if (!validDate(m[1], m[2], m[3])) r.review.push('invalidAirDate');
      else { r.airDate = m[1] + '-' + m[2] + '-' + m[3]; if (r.showTitle && ((title(stem.slice(0, m.index)) && c.showTitle) || opts.order === 'date')) r.kind = 'episode'; else r.review.push('uncertainDateOrder'); }
      note('filename', { airDate: r.airDate || null });
    } else {
      m = /^(?:\[[^\]]+\][ ._-]*)?(.+?)[ ]+-[ ]+(\d{1,4})(?:\.(\d+))?(?=$|[ ._\[-])/.exec(stem);
      if (!m && opts.order === 'absolute') m = /^(.+?)[ ._-]+ep[ ._-]*(\d{1,4})(?=$|[ ._\[-])/i.exec(stem);
      if (m) {
        r.kind = opts.order === 'absolute' || /^\[[^\]]+\]/.test(stem) ? 'episode' : 'unclassified'; r.showTitle = title(m[1]) || c.showTitle || null; r.order = 'absolute'; r.absoluteNumber = +m[2];
        if (m[3]) r.absolutePart = m[3];
        if (!r.absoluteNumber) r.review.push('invalidEpisodeNumber');
        if (r.kind === 'unclassified') r.review.push('uncertainAbsoluteOrder');
        note('filename', { absoluteNumber: r.absoluteNumber });
      }
    }
  }
  if (r.kind === 'movie' && c.season != null) { r.kind = 'unclassified'; r.showTitle = c.showTitle || null; r.season = c.season; r.review.push('missingEpisode'); }
  if (/(?:^|[ ._-])(sample|trailer|teaser|featurette)(?:$|[ ._-])/i.test(stem)) { r.kind = 'extra'; note('filename', { kind: 'extra' }); }
  // Structured server fields are evidence, not arbitrary tags or an assumed season.
  if (o.server && o.server.validated === true) {
    var server = o.server;
    if (server.showTitle && server.number > 0 && Math.floor(server.number) === server.number) {
      if (r.kind === 'episode' && server.season != null && r.season != null && server.season !== r.season) r.review.push('conflictingServerSeason');
      if (r.kind === 'movie') episode(server.showTitle, server.season == null ? null : server.season, [server.number], 'server');
      note('server', { showTitle: server.showTitle, season: server.season, number: server.number });
    }
  }
  // Caller supplies applicable folder rules in least-to-most-specific order, then the file rule.
  (overrides || []).forEach(function (v) { Object.keys(v).forEach(function (k) { rule[k] = v[k]; }); });
  ['kind', 'showTitle', 'season', 'numbers', 'order', 'airDate', 'absoluteNumber', 'absolutePart', 'title'].forEach(function (k) { if (Object.prototype.hasOwnProperty.call(rule, k)) r[k] = Array.isArray(rule[k]) ? rule[k].slice() : rule[k]; });
  if (Object.keys(rule).length) { note('user', rule); r.review = r.review.filter(function (reason) { return !((reason === 'conflictingSeason' || reason === 'conflictingServerSeason') && rule.season != null) && !(reason === 'uncertainAbsoluteOrder' && rule.order === 'absolute') && !(reason === 'uncertainDateOrder' && rule.order === 'date'); }); if (r.kind === 'unclassified' && (rule.order === 'absolute' || rule.order === 'date') && r.showTitle) r.kind = 'episode'; }
  if (r.season != null && (typeof r.season !== 'number' || r.season < 0 || Math.floor(r.season) !== r.season)) r.review.push('invalidSeason');
  if (!Array.isArray(r.numbers)) { r.numbers = []; r.review.push('invalidEpisodeNumber'); }
  if (r.numbers.length > 50) { r.numbers = r.numbers.slice(0, 50); r.review.push('invalidEpisodeRange'); }
  if (r.numbers.some(function (v, i, a) { return typeof v !== 'number' || v < 1 || Math.floor(v) !== v || a.indexOf(v) !== i; })) r.review.push('invalidEpisodeNumber');
  if (r.kind === 'episode') {
    if (!r.showTitle) r.review.push('missingShow');
    if (r.order === 'aired' && r.season == null) r.review.push('missingSeason');
    if (r.order === 'aired' && !r.numbers.length) r.review.push('missingEpisode');
  }
  r.review = r.review.filter(function (reason, i, a) { return a.indexOf(reason) === i; });
  return r;
}
module.exports = { classify: classify, context: context, validDate: validDate };
