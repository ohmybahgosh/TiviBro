/* TiviBro metadata relay: a Cloudflare Worker that asks TheTVDB about TV shows for every TiviBro, so a viewer
   gets a show's poster, backdrop, logo art, summary and episodes without a TMDB token of their own.

   TheTVDB's API key is the project's (free for projects that make no money, with attribution: "Metadata
   provided by TheTVDB").  It lives here as a secret and never reaches a TV, the repo or a log.

   GET /v1/search?q=Slow%20Horses&year=2022&lang=en
     -> { ok, results: [{ id, name, aliases, year, country, network, overview, poster, status, language }] }
   GET /v1/series/372264?lang=de
     -> { ok, show: { id, title, year, plot, genre, network, status, country, originalLanguage, runtime,
                      poster, backdrop, backdropHd, logo, cast, seasons: [{ number }] } }
   GET /v1/series/372264/season/2?lang=de
     -> { ok, episodes: [{ number, season, title, plot, airDate, runtime, still }] }
   GET /  -> { ok, service: 'tivibro-meta', ready }

   Answers are kept in Cloudflare's cache at the edge (search a week, a show 3 days, its episodes a day), so
   most asks never reach TheTVDB.  TheTVDB's login token (valid a month) is kept in the same cache for 20 days.
   Nothing about who asked is stored.  Settings: the secret TVDB_KEY (npx wrangler secret put TVDB_KEY). */

const API = 'https://api4.thetvdb.com/v4', ART = 'https://artworks.thetvdb.com';
const TTL = { search: 7 * 86400, series: 3 * 86400, episodes: 86400, miss: 3600 };
// TiviBro's languages (app/js/i18n.js) as TheTVDB writes them.
const LANGS = { en: 'eng', de: 'deu', es: 'spa', fr: 'fra', pt: 'por', 'pt-BR': 'por', ru: 'rus', it: 'ita', tr: 'tur', pl: 'pol', nl: 'nld' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' };
// Artwork types (GET /artwork/types): poster, background, clear logo.
const POSTER = 2, BACKGROUND = 3, LOGO = 23;

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
// Search: shows named like q.  TheTVDB's own translation of the name and summary into the viewer's language.
async function search(env, q, year, l3) {
  const data = await tvdb(env, '/search?type=series&limit=20&query=' + encodeURIComponent(q) + (year ? '&year=' + year : ''));
  const results = (Array.isArray(data) ? data : []).filter(x => x && /^[1-9][0-9]{0,9}$/.test(String(x.tvdb_id))).map(x => ({
    id: String(x.tvdb_id), name: str((x.translations && x.translations[l3]) || x.name, 200), original: str(x.name, 200),
    aliases: (Array.isArray(x.aliases) ? x.aliases : []).slice(0, 12).map(a => str(a, 200)).filter(Boolean),
    year: str(x.year, 4), country: str(x.country, 3), network: str(x.network, 100), status: str(x.status, 40), language: str(x.primary_language, 3),
    overview: str((x.overviews && x.overviews[l3]) || x.overview, 600), poster: art(x.thumbnail || x.image_url)
  }));
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
async function series(env, id, l3) {
  const x = await tvdb(env, '/series/' + id + '/extended?meta=translations');
  if (!x) return { ok: true, show: null };
  const tr = x.translations || {}, pick = (list, l) => (Array.isArray(list) ? list : []).filter(t => t && t.language === l)[0];
  const nameT = pick(tr.nameTranslations, l3), plotT = pick(tr.overviewTranslations, l3), plotE = pick(tr.overviewTranslations, 'eng');
  const arts = Array.isArray(x.artworks) ? x.artworks : [];
  const poster = best(arts, POSTER, l3), bg = best(arts, BACKGROUND, l3, true), logo = best(arts, LOGO, l3) || null;
  const cast = (Array.isArray(x.characters) ? x.characters : []).filter(c => c && c.peopleType === 'Actor' && c.personName)
    .sort((a, b) => (b.isFeatured - a.isFeatured) || ((a.sort || 99) - (b.sort || 99))).slice(0, 6).map(c => str(c.personName, 100));
  const seasons = (Array.isArray(x.seasons) ? x.seasons : []).filter(s => s && s.type && s.type.type === 'official' && s.number >= 0)
    .map(s => s.number).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b).map(n => ({ number: n }));
  return { ok: true, show: {
    id: String(x.id), title: str((nameT && nameT.name) || x.name, 200), originalTitle: str(x.name, 200), year: str(x.year, 4), releaseDate: str(x.firstAired, 10),
    plot: str((plotT && plotT.overview) || (plotE && plotE.overview) || x.overview, 3000),
    genre: (Array.isArray(x.genres) ? x.genres : []).slice(0, 6).map(g => str(g && g.name, 50)).filter(Boolean).join(', '),
    network: str((x.originalNetwork && x.originalNetwork.name) || (x.latestNetwork && x.latestNetwork.name), 100),
    status: str(x.status && x.status.name, 40), country: str(x.originalCountry, 3), originalLanguage: str(x.originalLanguage, 3),
    runtime: x.averageRuntime > 0 ? Math.min(999, x.averageRuntime) + ' min' : '',
    poster: poster ? art(poster.thumbnail) || art(poster.image) : art(x.image), backdrop: bg ? art(bg.thumbnail) || art(bg.image) : '', backdropHd: bg ? art(bg.image) : '',
    logo: logo ? art(logo.image) : '', cast: cast.join(', '), seasons
  } };
}
/* Every episode of a show in the viewer's language (TheTVDB gives them all at once, 500 a page, whatever season
   is asked for), kept at the edge as one list; a season is cut from it. */
async function episodes(env, id, l3, ctx) {
  const key = new Request('https://tivibro-meta.internal/episodes/' + id + '/' + l3), cache = caches.default, kept = await cache.match(key);
  if (kept) return kept.json();
  const all = [];
  for (let page = 0; page < 6; page++) {
    const d = await tvdb(env, '/series/' + id + '/episodes/default/' + l3 + '?page=' + page);
    const list = d && Array.isArray(d.episodes) ? d.episodes : [];
    list.forEach(e => { if (e && e.number > 0 && e.seasonNumber >= 0) all.push({ number: e.number, season: e.seasonNumber, title: str(e.name, 200), plot: str(e.overview, 1200), airDate: str(e.aired, 10), runtime: e.runtime > 0 ? e.runtime : null, still: art(e.image) }); });
    if (list.length < 500) break;
  }
  const put = cache.put(key, new Response(JSON.stringify(all), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + TTL.episodes } }));
  if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  return all;
}

/* ---------- requests ---------- */
// Answers a GET from the edge cache when it can, else asks TheTVDB and keeps the answer.
async function cached(request, ctx, ttl, make) {
  const cache = caches.default, key = new Request(new URL(request.url).toString(), { method: 'GET' }), hit = await cache.match(key);
  if (hit) return hit;
  const body = await make();
  const res = json(body, 200, body && body.show === null ? TTL.miss : ttl);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
async function route(request, env, ctx) {
  const url = new URL(request.url), p = url.pathname, l3 = lang3(url.searchParams.get('lang'));
  if (p === '/v1/search') {
    const q = (url.searchParams.get('q') || '').trim(), year = url.searchParams.get('year') || '';
    if (!q || q.length > 120 || (year && !/^(19|20)\d\d$/.test(year))) return json({ error: 'bad request' }, 400);
    return cached(request, ctx, TTL.search, () => search(env, q, year, l3));
  }
  let m = /^\/v1\/series\/([1-9][0-9]{0,9})$/.exec(p);
  if (m) return cached(request, ctx, TTL.series, () => series(env, m[1], l3));
  m = /^\/v1\/series\/([1-9][0-9]{0,9})\/season\/([0-9]{1,3})$/.exec(p);
  if (m) {
    const id = m[1], season = +m[2];
    return cached(request, ctx, TTL.episodes, async () => ({ ok: true, episodes: (await episodes(env, id, l3, ctx)).filter(e => e.season === season) }));
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
