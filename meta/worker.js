/* TiviBro metadata relay: a Cloudflare Worker that asks TheTVDB about shows and movies for every TiviBro, so a
   viewer gets posters, backdrops, logo art, summaries, cast, trailers and episodes without a TMDB token of their own.

   TheTVDB's API key is the project's (free for projects that make no money, with attribution: "Metadata
   provided by TheTVDB").  It lives here as a secret and never reaches a TV, the repo or a log.

   GET /v1/search?q=Slow%20Horses&year=2022&lang=en[&type=movie]   (shows unless type=movie)
     -> { ok, results: [{ id, name, original, aliases, year, country, network, director, overview, poster, status,
                          language, imdb, tmdb }] }
   GET /v1/series/372264?lang=de
     -> { ok, show: { id, title, year, plot, genre, network, status, country, originalLanguage, runtime,
                      poster, backdrop, backdropHd, logo, cast, seasons: [{ number }], imdb, tmdb, trailer, score } }
   GET /v1/series/372264/season/2?lang=de
     -> { ok, episodes: [{ id, number, season, absolute, title, plot, airDate, runtime, still }] }
   GET /v1/movie/1406?lang=de
     -> { ok, movie: { id, title, year, releaseDate, plot, genre, country, originalLanguage, runtime, poster, backdrop,
                       backdropHd, logo, cast, directors, imdb, tmdb, trailer, score } }
   imdb and tmdb: the same title on IMDb and TMDB (skip times and subtitles are found by them); trailer: a YouTube id.
   GET /v1/top10?country=US -> streaming services' Top 10s in a country, from FlixPatrol (see top10.js)
   GET /  -> { ok, service: 'tivibro-meta', ready }

   Answers are kept in Cloudflare's cache at the edge (search a week, a show 3 days, its episodes a day), so
   most asks never reach TheTVDB.  TheTVDB's login token (valid a month) is kept in the same cache for 20 days.
   Nothing about who asked is stored.  Settings: the secret TVDB_KEY (npx wrangler secret put TVDB_KEY). */

import { top10 } from './top10.js';

const API = 'https://api4.thetvdb.com/v4', ART = 'https://artworks.thetvdb.com', SHAPE = '2';
const TTL = { search: 7 * 86400, series: 3 * 86400, movie: 7 * 86400, episodes: 86400, miss: 3600 };
// TiviBro's languages (app/js/i18n.js) as TheTVDB writes them.
const LANGS = { en: 'eng', de: 'deu', es: 'spa', fr: 'fra', pt: 'por', 'pt-BR': 'por', ru: 'rus', it: 'ita', tr: 'tur', pl: 'pol', nl: 'nld' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };
// Artwork types (GET /artwork/types): a show's poster, background and clear logo, and a movie's.
const ART_TYPES = { series: { poster: 2, background: 3, logo: 23 }, movie: { poster: 14, background: 15, logo: 25 } };

function json(obj, status, maxAge) {
  const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + (maxAge || 0) }, CORS);
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}
function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
function lang3(code) { return LANGS[code] || LANGS[String(code || '').slice(0, 2)] || 'eng'; }
// An artwork path or address on TheTVDB's own image host, else nothing.
function art(v) {
  v = str(v, 500);
  if (/^\/banners\//.test(v)) v = ART + v;
  return /^https:\/\/artworks\.thetvdb\.com\/[\w./-]+$/.test(v) ? v : '';
}

/* ---------- TheTVDB login ---------- */
let token = '', tokenAt = 0;
// The login token: in memory, else from the edge cache, else a new login.  fresh: the old one was refused.
async function login(env, fresh) {
  const key = new Request('https://tivibro-meta.internal/token'), cache = caches.default;
  if (!fresh && token && Date.now() - tokenAt < 20 * 86400e3) return token;
  if (!fresh) {
    const kept = await cache.match(key);
    if (kept) { token = await kept.text(); tokenAt = Date.now(); if (token) return token; }
  }
  if (!env.TVDB_KEY) throw new Error('not configured');
  const r = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ apikey: env.TVDB_KEY }) });
  if (!r.ok) throw new Error('TheTVDB login ' + r.status);
  const j = await r.json();
  token = str(j && j.data && j.data.token, 4000); tokenAt = Date.now();
  if (!token) throw new Error('TheTVDB login gave no token');
  await cache.put(key, new Response(token, { headers: { 'Cache-Control': 'max-age=' + 20 * 86400 } }));
  return token;
}
// One GET from TheTVDB's API, logging in again once when the token is refused.  null when not found.
async function tvdb(env, path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await login(env, attempt > 0);
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/json' } });
    if (r.status === 401 && attempt === 0) continue;
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('TheTVDB ' + r.status);
    const j = await r.json();
    return j && j.data;
  }
  throw new Error('TheTVDB refused the login');
}

/* ---------- answers ---------- */
// The same title on IMDb and TMDB, from TheTVDB's links (search: remote_ids; details: remoteIds).
function ids(list) {
  const out = { imdb: '', tmdb: '' };
  (Array.isArray(list) ? list : []).forEach(r => {
    const id = String(r && r.id || ''), src = String(r && r.sourceName || '');
    if (/^IMDB$/i.test(src) && /^tt[0-9]{5,10}$/.test(id)) out.imdb = out.imdb || id;
    if (/^TheMovieDB/i.test(src) && /^[1-9][0-9]{0,9}$/.test(id)) out.tmdb = out.tmdb || id;
  });
  return out;
}
// A YouTube trailer: in your language, else English, else any.
function trailer(list, l3) {
  const yt = (Array.isArray(list) ? list : []).map(t => ({ l: t && t.language, id: (/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(String(t && t.url || '')) || [])[1] })).filter(t => t.id);
  const hit = yt.filter(t => t.l === l3)[0] || yt.filter(t => t.l === 'eng')[0] || yt[0];
  return hit ? hit.id : '';
}
// Search: shows named like q.  TheTVDB's own translation of the name and summary into the viewer's language.
async function search(env, q, year, l3, type) {
  const data = await tvdb(env, '/search?type=' + type + '&limit=20&query=' + encodeURIComponent(q) + (year ? '&year=' + year : ''));
  const results = (Array.isArray(data) ? data : []).filter(x => x && /^[1-9][0-9]{0,9}$/.test(String(x.tvdb_id))).map(x => Object.assign({
    id: String(x.tvdb_id), name: str((x.translations && x.translations[l3]) || x.name, 200), original: str(x.name, 200),
    aliases: (Array.isArray(x.aliases) ? x.aliases : []).slice(0, 12).map(a => str(a, 200)).filter(Boolean),
    year: str(x.year, 4), country: str(x.country, 3), network: str(x.network, 100), director: str(x.director, 100), status: str(x.status, 40), language: str(x.primary_language, 3),
    overview: str((x.overviews && x.overviews[l3]) || x.overview, 600), poster: art(x.thumbnail || x.image_url)
  }, ids(x.remote_ids)));
  return { ok: true, results };
}
// The best of a kind of artwork: in the viewer's language, then none (no words on it), then English; highest score.
function best(arts, type, l3, plainFirst) {
  const list = arts.filter(a => a && a.type === type && art(a.image));
  const order = plainFirst ? [null, l3, 'eng'] : [l3, null, 'eng'];
  for (const l of order) {
    const f = list.filter(a => (a.language || null) === l).sort((a, b) => (b.score || 0) - (a.score || 0));
    if (f.length) return f[0];
  }
  return list.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}
// One show's details, in the shape TiviBro's details already use (service/media-metadata.js).
/* What shows and movies share: the name and summary in your language, the artwork, the cast, the links and the
   trailer.  kind: 'series' or 'movie' (their artwork types differ). */
function common(x, l3, kind) {
  const tr = x.translations || {}, pick = (list, l) => (Array.isArray(list) ? list : []).filter(t => t && t.language === l)[0];
  const nameT = pick(tr.nameTranslations, l3), plotT = pick(tr.overviewTranslations, l3), plotE = pick(tr.overviewTranslations, 'eng');
  const arts = Array.isArray(x.artworks) ? x.artworks : [], T = ART_TYPES[kind];
  const poster = best(arts, T.poster, l3), bg = best(arts, T.background, l3, true), logo = best(arts, T.logo, l3);
  const people = Array.isArray(x.characters) ? x.characters : [];
  const cast = people.filter(c => c && c.peopleType === 'Actor' && c.personName)
    .sort((a, b) => (b.isFeatured - a.isFeatured) || ((a.sort || 99) - (b.sort || 99))).slice(0, 6).map(c => str(c.personName, 100));
  return Object.assign({
    id: String(x.id), title: str((nameT && nameT.name) || x.name, 200), originalTitle: str(x.name, 200), year: str(x.year, 4),
    plot: str((plotT && plotT.overview) || (plotE && plotE.overview) || x.overview, 3000),
    genre: (Array.isArray(x.genres) ? x.genres : []).slice(0, 6).map(g => str(g && g.name, 50)).filter(Boolean).join(', '),
    country: str(x.originalCountry, 3), originalLanguage: str(x.originalLanguage, 3),
    poster: poster ? art(poster.thumbnail) || art(poster.image) : art(x.image), backdrop: bg ? art(bg.thumbnail) || art(bg.image) : '', backdropHd: bg ? art(bg.image) : '',
    logo: logo ? art(logo.image) : '', cast: cast.join(', '), trailer: trailer(x.trailers, l3), score: +x.score || 0,
    directors: people.filter(c => c && c.peopleType === 'Director' && c.personName).slice(0, 3).map(c => str(c.personName, 100))
  }, ids(x.remoteIds));
}
// A movie's details, in the shape TiviBro's details use.
async function movie(env, id, l3) {
  const x = await tvdb(env, '/movies/' + id + '/extended?meta=translations');
  if (!x) return { ok: true, movie: null };
  const out = common(x, l3, 'movie');
  out.releaseDate = str(x.first_release && x.first_release.date, 10);
  out.runtime = x.runtime > 0 ? Math.min(999, x.runtime) + ' min' : '';
  return { ok: true, movie: out };
}
async function series(env, id, l3) {
  const x = await tvdb(env, '/series/' + id + '/extended?meta=translations');
  if (!x) return { ok: true, show: null };
  const seasons = (Array.isArray(x.seasons) ? x.seasons : []).filter(s => s && s.type && s.type.type === 'official' && s.number >= 0)
    .map(s => s.number).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b).map(n => ({ number: n }));
  const out = common(x, l3, 'series');
  out.releaseDate = str(x.firstAired, 10);
  out.network = str((x.originalNetwork && x.originalNetwork.name) || (x.latestNetwork && x.latestNetwork.name), 100);
  out.status = str(x.status && x.status.name, 40);
  out.runtime = x.averageRuntime > 0 ? Math.min(999, x.averageRuntime) + ' min' : '';
  out.seasons = seasons;
  return { ok: true, show: out };
}
/* Every episode of a show in the viewer's language (TheTVDB gives them all at once, 500 a page, whatever season
   is asked for), kept at the edge as one list; a season is cut from it. */
async function episodes(env, id, l3, ctx) {
  const key = new Request('https://tivibro-meta.internal/episodes/' + SHAPE + '/' + id + '/' + l3), cache = caches.default, kept = await cache.match(key);
  if (kept) return kept.json();
  const all = [];
  for (let page = 0; page < 6; page++) {
    const d = await tvdb(env, '/series/' + id + '/episodes/default/' + l3 + '?page=' + page);
    const list = d && Array.isArray(d.episodes) ? d.episodes : [];
    list.forEach(e => { if (e && e.number > 0 && e.seasonNumber >= 0) all.push({ id: /^[1-9][0-9]{0,9}$/.test(String(e.id)) ? String(e.id) : '', number: e.number, season: e.seasonNumber, absolute: e.absoluteNumber > 0 ? e.absoluteNumber : null, title: str(e.name, 200), plot: str(e.overview, 1200), airDate: str(e.aired, 10), runtime: e.runtime > 0 ? e.runtime : null, still: art(e.image) }); });
    if (list.length < 500) break;
  }
  const put = cache.put(key, new Response(JSON.stringify(all), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + TTL.episodes } }));
  if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  return all;
}

/* ---------- requests ---------- */
// Answers a GET from the edge cache when it can, else asks TheTVDB and keeps the answer.
async function cached(request, ctx, ttl, make) {
  // The answer's shape version in the key: a change to what an answer holds is never served from an older copy.
  const u = new URL(request.url); u.searchParams.set('v', SHAPE);
  const cache = caches.default, key = new Request(u.toString(), { method: 'GET' }), hit = await cache.match(key);
  if (hit) return hit;
  const body = await make();
  const res = json(body, 200, body && (body.show === null || body.movie === null) ? TTL.miss : ttl);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
async function route(request, env, ctx) {
  const url = new URL(request.url), p = url.pathname, l3 = lang3(url.searchParams.get('lang'));
  if (p === '/v1/search') {
    const q = (url.searchParams.get('q') || '').trim(), year = url.searchParams.get('year') || '', type = url.searchParams.get('type') === 'movie' ? 'movie' : 'series';
    if (!q || q.length > 120 || (year && !/^(19|20)\d\d$/.test(year))) return json({ error: 'bad request' }, 400);
    return cached(request, ctx, TTL.search, () => search(env, q, year, l3, type));
  }
  let m = /^\/v1\/movie\/([1-9][0-9]{0,9})$/.exec(p);
  if (m) return cached(request, ctx, TTL.movie, () => movie(env, m[1], l3));
  m = /^\/v1\/series\/([1-9][0-9]{0,9})$/.exec(p);
  if (m) return cached(request, ctx, TTL.series, () => series(env, m[1], l3));
  m = /^\/v1\/series\/([1-9][0-9]{0,9})\/season\/([0-9]{1,3})$/.exec(p);
  if (m) {
    const id = m[1], season = +m[2];
    return cached(request, ctx, TTL.episodes, async () => ({ ok: true, episodes: (await episodes(env, id, l3, ctx)).filter(e => e.season === season) }));
  }
  // Streaming Top 10s by country (top10.js): kept in KV and asked of FlixPatrol at most once a day.
  if (p === '/v1/top10') {
    if (!env.TOP10) return json({ ok: true, country: '', date: '', charts: [] }, 200, 3600);
    // Kept at the edge an hour too, so TVs asking at once when a day's charts are due make one ask per place.
    const c2 = String(url.searchParams.get('country') || '').toUpperCase().slice(0, 2);
    return cached(new Request(url.origin + '/v1/top10?country=' + c2), ctx, 3600, () => top10(env, c2, ctx));
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'not allowed' }, 405);
    const p = new URL(request.url).pathname;
    if (p === '/' || p === '/health') return json({ ok: true, service: 'tivibro-meta', ready: !!env.TVDB_KEY, attribution: 'Metadata provided by TheTVDB (https://thetvdb.com).' });
    try { return await route(request, env, ctx); }
    catch (e) { console.log('meta error: ' + (e && e.message)); return json({ error: 'TheTVDB could not be reached.  Try again later.' }, 502); }
  }
};
