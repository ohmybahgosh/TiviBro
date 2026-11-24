/* Skip times from online databases, for movies and episodes whose files have no chapters (app/js/skipper.js):
   where the intro, the recap and the credits are, from two free community databases that need no account.
     TheIntroDB   api.theintrodb.org/v4/media   by TheTVDB id (its own identity, TheTVDB's numbers), TMDB id (TMDB's
                                                season and episode numbers) or IMDb id
     IntroDB      api.introdb.app/segments      by IMDb id (its data is open, under the ODbL: credited in the app)
   TheIntroDB is asked first; IntroDB fills in what it has not timed (an intro, a recap, the credits).

     POST /media/skipdb { kind: 'movie'|'episode', tvdb, tmdb, imdb, season, episode, dur (seconds), credential }
       tvdb: a title matched on TheTVDB (no TMDB token needed; its imdb comes with it, for IntroDB)
       -> { intro: [s, e] | null, recap: [s, e] | null, credits: s | -1, creditsEnd: e | -1, from: ['TheIntroDB', ...] }
          (seconds; an end of -1 is the end of the file)
   credential: the viewer's TMDB key, only to find a show's or movie's IMDb id for IntroDB when TiviBro knows
   just its TMDB id; nothing else leaves the TV (no file name, no provider, no link).

   Polite: answers are kept on the TV (a week, a missing title 12 hours) so a title is asked once; one question
   at a time for the same title; a database that says "slow down" (429) is left alone for as long as it asks
   (at least a minute); 8 s to answer.  TheIntroDB allows 5,000 questions a day from one address.
   ES5 / Node 0.12. */
'use strict';
var https = require('https'), fs = require('fs'), path = require('path');
var UA = 'TiviBro (LG webOS; https://tivibro.app)';
try { UA = 'TiviBro/' + require('../package.json').version + ' (LG webOS; https://tivibro.app)'; } catch (e) {}

var HIT_MS = 7 * 86400e3, MISS_MS = 12 * 3600e3, KEEP = 3000, TIMEOUT = 8000;
var cache = null, saveT = null, waiting = {}, pausedUntil = {};
var get = getJson;                         // tests put their own in (_test.use)
var file = null;                           // the kept answers: <storage>/skipdb/answers.json

/* ---------- the kept answers ---------- */
function where() {
  if (file !== null) return file;
  file = '';
  try { var S = require('./storage'); if (!S.memory()) file = path.join(S.sub('skipdb'), 'answers.json'); } catch (e) {}
  return file;
}
function load() {
  if (cache) return cache;
  cache = {};
  try { if (where()) cache = JSON.parse(fs.readFileSync(where(), 'utf8')) || {}; } catch (e) { cache = {}; }
  return cache;
}
// Written a few seconds after the last change, the oldest dropped past KEEP.
function save() {
  if (!where() || saveT) return;
  saveT = setTimeout(function () {
    saveT = null;
    var keys = Object.keys(cache);
    if (keys.length > KEEP) keys.sort(function (a, b) { return cache[a].at - cache[b].at; }).slice(0, keys.length - KEEP).forEach(function (k) { delete cache[k]; });
    try { fs.writeFileSync(where(), JSON.stringify(cache)); } catch (e) {}
  }, 3000);
}
function kept(k) {
  var c = load()[k];
  if (!c) return null;
  if (Date.now() - c.at > (c.v ? HIT_MS : MISS_MS)) { delete cache[k]; return null; }
  return c;
}
function keep(k, v) { load()[k] = { at: Date.now(), v: v }; save(); }

/* ---------- asking ---------- */
// One JSON answer: cb(null, { status, json, retry }).  Never throws; a network failure is an error.
function getJson(host, p, headers, cb) {
  var done = false;
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var h = { 'User-Agent': UA, Accept: 'application/json' };
  for (var k in headers) h[k] = headers[k];
  var req = https.get({ hostname: host, path: p, headers: h }, function (res) {
    var chunks = [], n = 0;
    res.on('data', function (b) { n += b.length; if (n > 262144) { req.abort(); return finish(new Error('too much')); } chunks.push(b); });
    res.on('end', function () {
      var json = null;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
      finish(null, { status: res.statusCode, json: json, retry: res.headers['retry-after'] });
    });
    res.on('error', finish);
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(TIMEOUT, function () { req.abort(); finish(new Error('timed out')); });
}
// A database that said 429: left alone for its Retry-After (seconds or a date), at least a minute.
function slowDown(name, retry) {
  var s = /^[0-9]+$/.test(String(retry || '')) ? +retry : Math.max(0, (Date.parse(retry || '') - Date.now()) / 1000 || 0);
  pausedUntil[name] = Date.now() + Math.max(60, Math.min(s || 0, 86400)) * 1000;
}
function paused(name) { return (pausedUntil[name] || 0) > Date.now(); }

// Seconds from milliseconds, to a tenth; null stays null (from the start, or to the end).
function sec(ms) { return ms == null || !isFinite(+ms) ? null : Math.round(+ms / 100) / 10; }
/* A segment as [start, end] in seconds: a start of null is the beginning, an end of null the end (Infinity).
   Null when it makes no sense (ends before it starts). */
function span(s, e) {
  var a = s == null ? 0 : s, b = e == null ? Infinity : e;
  return isFinite(a) && a >= 0 && b > a ? [a, b] : null;
}

/* TheIntroDB: { intro: [{ start_ms, end_ms }], recap: [...], credits: [...], preview: [...] } (lists; the first of
   each is used).  404 is "nobody has timed it", not an error. */
function theIntroDb(q, cb) {
  var name = 'TheIntroDB';
  if (paused(name) || (!q.tvdb && !q.tmdb && !q.imdb)) return cb(null);
  var p = '/v4/media?' + (q.tvdb ? 'tvdb_id=' + q.tvdb : q.tmdb ? 'tmdb_id=' + q.tmdb : 'imdb_id=' + q.imdb) + (q.kind === 'episode' ? '&season=' + q.season + '&episode=' + q.episode : '') + (q.dur ? '&duration_ms=' + Math.round(q.dur * 1000) : '');
  get('api.theintrodb.org', p, {}, function (e, r) {
    if (e || !r) return cb(null, true);
    if (r.status === 429) { slowDown(name, r.retry); return cb(null, true); }
    if (r.status !== 200 || !r.json) return cb(null, r.status !== 404);
    function first(list) { var x = list && list[0]; return x ? span(sec(x.start_ms), sec(x.end_ms)) : null; }
    var j = r.json, cr = first(j.credits);
    cb({ intro: first(j.intro), recap: first(j.recap), credits: cr ? cr[0] : -1, creditsEnd: cr ? cr[1] : -1 });
  });
}
/* IntroDB: { intro: { start_ms, end_ms }, recap, outro, post_credits } (one each, null when nobody timed it;
   no_intro and the like when the community says there is none). */
function introDb(q, cb) {
  var name = 'IntroDB';
  if (paused(name) || !q.imdb) return cb(null);
  var p = '/segments?imdb_id=' + q.imdb + (q.kind === 'episode' ? '&season=' + q.season + '&episode=' + q.episode : '&is_movie=true');
  get('api.introdb.app', p, {}, function (e, r) {
    if (e || !r) return cb(null, true);
    if (r.status === 429) { slowDown(name, r.retry); return cb(null, true); }
    if (r.status !== 200 || !r.json) return cb(null, r.status !== 404);
    function one(x) { return x ? span(sec(x.start_ms), sec(x.end_ms)) : null; }
    var j = r.json, out = one(j.outro);
    var ok = out && !j.no_outro;
    cb({ intro: j.no_intro ? null : one(j.intro), recap: j.no_recap ? null : one(j.recap), credits: ok ? out[0] : -1, creditsEnd: ok ? out[1] : -1 });
  });
}
/* The IMDb id for a TMDB id, from TMDB with the viewer's own key (only when there is one): IntroDB knows titles
   by IMDb id.  Kept like the answers. */
function imdbFor(q, cb) {
  if (q.imdb || !q.tmdb || !q.credential) return cb(q.imdb || '');
  var k = 'imdb:' + (q.kind === 'episode' ? 'tv:' : '') + q.tmdb, c = kept(k);
  if (c) return cb(c.v || '');
  var auth = /^[a-f0-9]{32}$/i.test(q.credential), p = '/3/' + (q.kind === 'episode' ? 'tv' : 'movie') + '/' + q.tmdb + '/external_ids' + (auth ? '?api_key=' + encodeURIComponent(q.credential) : '');
  get('api.themoviedb.org', p, auth ? {} : { Authorization: 'Bearer ' + q.credential }, function (e, r) {
    var id = !e && r && r.status === 200 && r.json && /^tt[0-9]{5,10}$/.test(r.json.imdb_id || '') ? r.json.imdb_id : '';
    if (!e && r && (r.status === 200 || r.status === 404)) keep(k, id);
    cb(id);
  });
}

// What was asked, checked: only numbers and an IMDb id go anywhere.
function clean(q) {
  q = q || {};
  var out = { kind: q.kind === 'episode' ? 'episode' : 'movie', tmdb: /^[1-9][0-9]{0,9}$/.test(String(q.tmdb || '')) ? String(q.tmdb) : '',
    tvdb: /^[1-9][0-9]{0,9}$/.test(String(q.tvdb || '')) ? String(q.tvdb) : '',
    imdb: /^tt[0-9]{5,10}$/.test(String(q.imdb || '')) ? String(q.imdb) : '', season: Math.floor(+q.season), episode: Math.floor(+q.episode),
    dur: +q.dur > 0 && +q.dur < 36000 ? +q.dur : 0, credential: typeof q.credential === 'string' ? q.credential.slice(0, 2048).trim() : '' };
  if (out.kind === 'episode' && !(out.season >= 0 && out.season <= 300 && out.episode >= 1 && out.episode <= 20000)) return null;
  return out.tvdb || out.tmdb || out.imdb ? out : null;
}
// TheIntroDB's answer with IntroDB's for what it lacks.  from: the databases that gave something.
function merge(a, b) {
  var out = { intro: null, recap: null, credits: -1, creditsEnd: -1, from: [] };
  [[a, 'TheIntroDB'], [b, 'IntroDB']].forEach(function (x) {
    var r = x[0], used = false;
    if (!r) return;
    if (!out.intro && r.intro) { out.intro = r.intro; used = true; }
    if (!out.recap && r.recap) { out.recap = r.recap; used = true; }
    if (out.credits < 0 && r.credits >= 0) { out.credits = r.credits; out.creditsEnd = r.creditsEnd; used = true; }
    if (used) out.from.push(x[1]);
  });
  return out;
}
// JSON has no Infinity: an end at the end of the file goes out as -1 (app/js/skipper.js reads it so).
function wire(r) {
  function w(s) { return s ? [s[0], isFinite(s[1]) ? s[1] : -1] : null; }
  return { intro: w(r.intro), recap: w(r.recap), credits: r.credits, creditsEnd: r.credits >= 0 && isFinite(r.creditsEnd) ? r.creditsEnd : -1, from: r.from };
}

/* The skip times for one movie or episode: cb(answer).  Asked once for the same title at a time; kept; a
   database that couldn't be reached (not "has nothing") isn't kept as a miss, so it is asked next time. */
function lookup(q, cb) {
  q = clean(q);
  if (!q) return cb({ error: 'skipdb', message: 'Not a movie or episode the databases know.' });
  var k = (q.tvdb ? 'tvdb:' + (q.kind === 'movie' ? 'movie:' : '') + q.tvdb : q.tmdb ? 'tmdb:' + q.tmdb : q.imdb) + (q.kind === 'episode' ? ':' + q.season + ':' + q.episode : ''), c = kept(k);
  if (c) return cb(c.v || wire(merge(null, null)));
  if (waiting[k]) return waiting[k].push(cb);
  waiting[k] = [cb];
  function done(v, failed) {
    var w = wire(v);                         // kept as sent: JSON on disk has no Infinity either
    if (v.from.length || !failed) keep(k, v.from.length ? w : null);
    var cbs = waiting[k]; delete waiting[k];
    cbs.forEach(function (f) { f(w); });
  }
  theIntroDb(q, function (a, failA) {
    // Everything from TheIntroDB: IntroDB isn't asked.
    if (a && a.intro && a.credits >= 0 && (q.kind === 'movie' || a.recap)) return done(merge(a, null), false);
    imdbFor(q, function (imdb) {
      q.imdb = imdb;
      introDb(q, function (b, failB) { done(merge(a, b), failA || failB); });
    });
  });
}

module.exports = { lookup: lookup, _test: { use: function (f) { get = f || getJson; }, reset: function () { cache = {}; waiting = {}; pausedUntil = {}; file = ''; }, clean: clean, merge: merge, wire: wire } };
