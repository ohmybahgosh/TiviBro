/* The metadata relay (meta/worker.js): TheTVDB's answers slimmed to what TiviBro uses, the key never sent
   anywhere but TheTVDB's login, the login kept, and answers kept at the edge.
     node tests/unit/meta-worker.test.mjs */
import worker from '../../meta/worker.js';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

// Cloudflare's edge cache, in memory.
const store = new Map();
globalThis.caches = { default: { match: async (r) => { const v = store.get(typeof r === 'string' ? r : r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(typeof r === 'string' ? r : r.url, res.clone()); } } };
// TheTVDB, answering from fixtures; every call is recorded.
const calls = [], KEY = 'k'.repeat(36);
let refuseOnce = false;
const ART = 'https://artworks.thetvdb.com/banners/v4/series/372264/';
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const reply = (data, status) => new Response(JSON.stringify({ status: 'success', data }), { status: status || 200 });
  if (/\/login$/.test(url)) return reply({ token: 'tok' + calls.length });
  if (refuseOnce) { refuseOnce = false; return new Response('{}', { status: 401 }); }
  if (/\/search\?/.test(url)) return reply([{ tvdb_id: '372264', name: 'Slow Horses', year: '2022', country: 'gbr', network: 'Apple TV', primary_language: 'eng', aliases: ['Caballos lentos'],
    translations: { deu: 'Slow Horses - Ein Fall für Jackson Lamb' }, overviews: { eng: 'Spies.', deu: 'Spione.' }, thumbnail: ART + 'posters/a_t.jpg' }, { tvdb_id: 'nope', name: 'Bad' }]);
  if (/\/series\/372264\/extended/.test(url)) return reply({ id: 372264, name: 'Slow Horses', year: '2022', firstAired: '2022-04-01', averageRuntime: 46, originalCountry: 'gbr', originalLanguage: 'eng',
    status: { name: 'Continuing' }, originalNetwork: { name: 'Apple TV' }, genres: [{ name: 'Thriller' }], image: ART + 'posters/a.jpg',
    translations: { nameTranslations: [{ language: 'deu', name: 'Slow Horses DE' }], overviewTranslations: [{ language: 'eng', overview: 'Spies.' }, { language: 'deu', overview: 'Spione.' }] },
    artworks: [{ type: 2, image: ART + 'posters/a.jpg', thumbnail: ART + 'posters/a_t.jpg', language: 'eng', score: 5 }, { type: 2, image: ART + 'posters/d.jpg', thumbnail: ART + 'posters/d_t.jpg', language: 'deu', score: 1 },
      { type: 3, image: ART + 'backgrounds/t.jpg', thumbnail: ART + 'backgrounds/t_t.jpg', language: 'eng', score: 9 }, { type: 3, image: ART + 'backgrounds/p.jpg', thumbnail: ART + 'backgrounds/p_t.jpg', language: null, score: 2 },
      { type: 23, image: ART + 'clearlogo/l.png', language: 'eng', score: 1 }, { type: 2, image: 'https://evil.example/x.jpg', language: 'deu', score: 99 }],
    characters: [{ personName: 'Jack Lowden', peopleType: 'Actor', sort: 2, isFeatured: true }, { personName: 'Gary Oldman', peopleType: 'Actor', sort: 1, isFeatured: true }, { personName: 'Someone', peopleType: 'Director', sort: 0 }],
    seasons: [{ number: 1, type: { type: 'official' } }, { number: 0, type: { type: 'official' } }, { number: 1, type: { type: 'dvd' } }, { number: 2, type: { type: 'official' } }] });
  if (/\/series\/999\/extended/.test(url)) return new Response('{}', { status: 404 });
  if (/\/series\/372264\/episodes\/default\/deu/.test(url)) return reply({ episodes: [{ seasonNumber: 1, number: 1, name: 'Folge 1', overview: 'Eins.', aired: '2022-04-01', image: '/banners/v4/episode/1/s.jpg', runtime: 50 },
    { seasonNumber: 2, number: 1, name: 'Zwei', aired: '2022-12-02' }, { seasonNumber: 0, number: 1, name: 'Extra' }] });
  return new Response('{}', { status: 500 });
};
const env = { TVDB_KEY: KEY }, waits = [], ctx = { waitUntil: (p) => waits.push(p) };
const get = async (path) => { const r = await worker.fetch(new Request('https://meta.example' + path), env, ctx); await Promise.all(waits.splice(0)); return r; };

let r = await (await get('/')).json();
ok('says it is ready, and credits TheTVDB', r.ok && r.ready && /TheTVDB/.test(r.attribution));
r = await (await get('/v1/search?q=Slow%20Horses&lang=de')).json();
ok('search: the show, its name in your language', r.results.length === 1 && r.results[0].id === '372264' && r.results[0].name === 'Slow Horses - Ein Fall für Jackson Lamb' && r.results[0].overview === 'Spione.', JSON.stringify(r));
ok('only the key goes to the login, and only there', calls.filter(c => (c.init.body || '').includes(KEY)).every(c => /\/login$/.test(c.url)) && calls.every(c => !c.url.includes(KEY)));
r = await (await get('/v1/series/372264?lang=de')).json();
const s = r.show;
ok('a show in the details shape', s && s.title === 'Slow Horses DE' && s.plot === 'Spione.' && s.genre === 'Thriller' && s.network === 'Apple TV' && s.runtime === '46 min' && s.year === '2022', JSON.stringify(s));
ok('artwork: your language first, never another host', s.poster === ART + 'posters/d_t.jpg', s.poster);
ok('a backdrop without words first, with an HD one', s.backdrop === ART + 'backgrounds/p_t.jpg' && s.backdropHd === ART + 'backgrounds/p.jpg', s.backdrop);
ok('the logo art', s.logo === ART + 'clearlogo/l.png');
ok('cast: actors, featured in order', s.cast === 'Gary Oldman, Jack Lowden', s.cast);
ok('official seasons, each once', JSON.stringify(s.seasons) === JSON.stringify([{ number: 0 }, { number: 1 }, { number: 2 }]), JSON.stringify(s.seasons));
r = await (await get('/v1/series/372264/season/1?lang=de')).json();
ok('a season: only its episodes, stills on TheTVDB\'s host', r.episodes.length === 1 && r.episodes[0].title === 'Folge 1' && r.episodes[0].still === 'https://artworks.thetvdb.com/banners/v4/episode/1/s.jpg', JSON.stringify(r));
const before = calls.length;
await get('/v1/series/372264/season/2?lang=de');
ok('another season comes from the kept list', calls.length === before);
await get('/v1/series/372264?lang=de');
ok('an answer asked again comes from the edge cache', calls.length === before);
const logins = calls.filter(c => /\/login$/.test(c.url)).length;
ok('one login for all of that', logins === 1, logins);
refuseOnce = true;
r = await (await get('/v1/search?q=Other')).json();
ok('a refused token: logs in again once and answers', r.ok === true && calls.filter(c => /\/login$/.test(c.url)).length === 2);
r = await (await get('/v1/series/999')).json();
ok('a show TheTVDB doesn\'t have: null', r.ok && r.show === null);
ok('nonsense is refused', (await get('/v1/search?q=')).status === 400 && (await get('/v1/series/abc')).status === 404 && (await get('/v1/search?q=x&year=19')).status === 400);
r = await worker.fetch(new Request('https://meta.example/v1/search?q=x', { method: 'POST', body: '{}' }), env, ctx);
ok('only GET', r.status === 405);
r = await (await worker.fetch(new Request('https://meta.example/'), {}, ctx)).json();
ok('without the key it says it is not ready', r.ok && r.ready === false);
console.log(fails ? fails + ' FAILED' : 'all metadata relay checks passed');
process.exit(fails ? 1 : 0);
