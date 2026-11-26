/* Streaming Top 10s in the metadata relay (meta/top10.js): FlixPatrol's charts slimmed to what TiviBro shows, the
   key sent only to FlixPatrol, each country asked at most once a day and kept in KV, fewer asks as the month's
   calls run low, and what was kept served when FlixPatrol fails.
     node tests/unit/meta-top10.test.mjs */
import worker from '../../meta/worker.js';
import { freshFor, COUNTRIES, SERVICES } from '../../meta/top10.js';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };   // no edge cache here: each ask reaches top10()
const KEY = 'fp_' + 'x'.repeat(26), calls = [];
let left = 900, failNext = false;
const NETFLIX = Object.keys(SERVICES).find((k) => SERVICES[k] === 'Netflix'), PRIME = Object.keys(SERVICES).find((k) => SERVICES[k] === 'Prime Video');
const line = (cmp, type, r, title, tmdb, kind) => ({ type: 'top10s', data: { company: { data: { id: cmp } }, type, ranking: r, note: title,
  movie: { data: { title, tmdbId: tmdb, tmdbLink: tmdb ? 'https://www.themoviedb.org/' + kind + '/' + tmdb : null } } } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), auth: (init.headers || {}).Authorization || '' });
  if (/\/quota$/.test(url)) return new Response(JSON.stringify({ data: { available: left, resetAt: new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 19) } }));
  if (failNext) { failNext = false; return new Response('{}', { status: 503 }); }
  const rows = [];
  for (let r = 12; r >= 1; r--) rows.push(line(NETFLIX, 2, r, 'Movie ' + r, 100 + r, 'movie'));
  rows.push(line(NETFLIX, 3, 1, 'Show One', 500, 'tv'), line(PRIME, 1, 2, 'Prime Two', 0, ''), line(PRIME, 1, 1, 'Prime One', 77, 'tv'), line('cmp_other', 1, 1, 'Nope', 1, 'movie'));
  return new Response(JSON.stringify({ data: rows }));
};
const kv = new Map();
const env = { FLIXPATROL_KEY: KEY, TVDB_KEY: 'k', TOP10: { get: async (k, t) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
const waits = [], ctx = { waitUntil: (p) => waits.push(p) };
const get = async (q) => { const r = await worker.fetch(new Request('https://meta.test/v1/top10' + q), env, ctx); await Promise.all(waits); return r.json(); };

const a = await get('?country=us');
const nf = a.charts.find((c) => c.service === 'Netflix'), pv = a.charts.find((c) => c.service === 'Prime Video');
ok('a country\'s charts, by service', a.ok && a.country === 'US' && nf && pv && a.charts.length === 2, JSON.stringify(a).slice(0, 300));
ok('a service\'s own movie and show charts, top 10 in order', nf.movies.length === 10 && nf.movies[0].r === 1 && nf.movies[0].t === 'Movie 1' && nf.movies[0].tmdb === 101 && nf.shows[0].t === 'Show One');
ok('a one-chart service keeps movies and shows together, marked when known', pv.all.map((x) => x.t).join() === 'Prime One,Prime Two' && pv.all[0].k === 'tv' && !pv.all[1].k && !pv.all[1].tmdb);
ok('services TiviBro doesn\'t show are left out', !a.charts.some((c) => /Nope/.test(JSON.stringify(c))));
const fp = calls.filter((c) => /top10s\?/.test(c.url));
ok('one call to FlixPatrol for the country, yesterday, the services in one ask', fp.length === 1 && fp[0].url.includes(encodeURIComponent(COUNTRIES.US)) && /company%5Bin%5D/.test(fp[0].url), fp.map((c) => c.url).join(' '));
ok('the key goes only to FlixPatrol, as Basic auth', calls.every((c) => /^https:\/\/api\.flixpatrol\.com\//.test(c.url) && c.auth === 'Basic ' + btoa(KEY + ':')) && !JSON.stringify(a).includes(KEY));
ok('kept in KV', kv.has('c:US'));
ok('a 5 minute lock while it asks, so other places don\'t ask too', kv.has('lock:US'));
await get('?country=US'); await get('?country=US');
ok('asked again the same day: from KV, no call', calls.filter((c) => /top10s\?/.test(c.url)).length === 1);
// A day later it's asked again; a failure keeps the old charts and isn't retried for an hour.
const old = JSON.parse(kv.get('c:US')); old.at -= 86400e3 + 1; kv.set('c:US', JSON.stringify(old));
kv.delete('lock:US');
failNext = true;
const b = await get('?country=US');
ok('FlixPatrol failing: the charts kept are served', b.charts.length === 2 && calls.filter((c) => /top10s\?/.test(c.url)).length === 2);
kv.delete('lock:US'); await get('?country=US');
ok('...and not asked again for an hour', calls.filter((c) => /top10s\?/.test(c.url)).length === 2);
// Running low: longer between asks; none left: what's kept, or nothing for a new country.
ok('fresh for a day with plenty left, longer as they run low', freshFor(900, 30) === 86400e3 && freshFor(300, 30) === 2 * 86400e3 && freshFor(60, 20) === 4 * 86400e3 && freshFor(20, 20) === Infinity);
left = 0;
const n = calls.length, c = await get('?country=DE');
ok('no calls left: a new country gets nothing, and no ask is made', c.charts.length === 0 && !calls.slice(n).some((x) => /top10s\?/.test(x.url)));
const d = await get('?country=XX');
ok('a country FlixPatrol doesn\'t know: nothing, no ask', d.ok && d.charts.length === 0);
const e = await worker.fetch(new Request('https://meta.test/v1/top10?country=US'), { TVDB_KEY: 'k' }, ctx).then((r) => r.json());
ok('not set up (no KV): an empty answer, not an error', e.ok && e.charts.length === 0);

if (fails) { console.log(fails + ' Top 10 check(s) failed'); process.exit(1); }
console.log('all Top 10 relay checks passed');
