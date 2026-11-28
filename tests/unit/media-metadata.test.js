// TMDB requests use the preferred locale, preserve chosen IDs and fall back per field.
const assert = require('assert'), M = require('../../service/media-metadata');
function lookup(client, q) { return new Promise((res, rej) => client.lookup(q, (e, r) => e ? rej(e) : res(r))); }
(async () => {
  const calls = [];
  const client = M.create({ credential: 'mock-application-key', read: (url, headers, cb) => {
    calls.push({ url, headers });
    if (url.includes('/find/tt1')) return cb(null, { movie_results: [{ id: 7 }] });
    if (url.includes('/search/movie')) return cb(null, { results: [{ id: 7, title: 'Mockfilm', original_title: 'Mock Film', release_date: '2001-01-01' }, { id: 8, title: 'Mock Film', release_date: '2002-01-01' }] });
    cb(null, url.includes('language=nl-NL') ? { id: 7, title: 'Mockfilm', overview: '', release_date: '2001-01-01', genres: [{ name: 'Avontuur' }], runtime: 100, images: { posters: [{ file_path: '/dutch.jpg', iso_639_1: 'nl' }], backdrops: [{ file_path: '/scene.jpg', iso_639_1: null }] } } : { id: 7, title: 'Mock Film', overview: 'English fallback plot.', genres: [{ name: 'Adventure' }], runtime: 100 });
  } });
  const r = await lookup(client, { id: 'tt1', language: 'nl' });
  assert.equal(r.metadata.provider, 'TMDB'); assert.equal(r.metadata.id, 'tmdb:7');
  assert.equal(r.metadata.title, 'Mockfilm'); assert.equal(r.metadata.plot, 'English fallback plot.');
  assert.equal(r.metadata.genre, 'Avontuur'); assert.equal(r.metadata.language, 'nl'); assert.deepEqual(r.metadata.fallbackFields, ['plot']);
  assert(r.metadata.poster.endsWith('/w185/dutch.jpg')); assert(r.metadata.backdrop.endsWith('/w780/scene.jpg'));
  assert(calls.some(c => c.url.includes('language=nl-NL'))); assert(calls.some(c => c.url.includes('language=en-US')));
  assert(!calls.some(c => c.url.includes('/search/')), 'existing IMDb match uses ID migration, not title matching');
  const exact = await lookup(client, { title: 'Mock Film', year: '2001', language: 'nl', auto: true });
  assert.equal(exact.metadata.id, 'tmdb:7');
  const ambiguous = await lookup(client, { title: 'Other title', auto: true }); assert.equal(ambiguous.matches.length, 2); assert(!ambiguous.metadata);
  const before = calls.length; await assert.rejects(() => lookup(M.create({ credential: '', read() { throw Error('unexpected network'); } }), { title: 'Film' }), /token|key/i); assert.equal(calls.length, before);
  await assert.rejects(() => lookup(client, { id: 'https://example.invalid' }), /valid movie/i);
  const tvCalls = [];
  const tv = M.create({credential:'demo-token',read:(url,headers,cb) => {
    tvCalls.push(url);
    if (url.includes('/search/tv')&&url.includes('query=Unknown')) return cb(null,{results:[{id:8,name:'Unknown',first_air_date:'2020-01-01'},{id:9,name:'Unknown',first_air_date:'2021-01-01'}]});
    if (url.includes('/search/tv')) return cb(null,{results:[{id:42,name:'Harbour',first_air_date:'2020-01-01'}]});
    if (url.includes('/episode_groups')) return cb(null,{results:[{id:'group_demo',type:2,name:'Absolute'}]});
    if (url.includes('/episode_group/')) return cb(null,{id:'group_demo',groups:[]});
    if (url.includes('/season/1')) return cb(null,{id:10,name:'Season 1',overview:'Season plot',episodes:[{id:11,season_number:1,episode_number:2,name:'Return',overview:'Episode plot',air_date:'2020-01-08'}]});
    cb(null,{id:42,name:'Harbour',overview:'Show plot',first_air_date:'2020-01-01',seasons:[{season_number:1,episode_count:2,name:'Season 1'}]});
  }});
  const show = await lookup(tv,{kind:'tv',title:'Harbour',auto:true}); assert.equal(show.metadata.id,'tmdb:tv:42'); assert.equal(show.metadata.kind,'show');
  const uncertain = await lookup(tv,{kind:'tv',title:'Unknown',auto:true});assert(!uncertain.metadata);assert.equal(uncertain.matches.length,2,'ambiguous TV matches require manual selection');
  const season = await lookup(tv,{id:'tmdb:tv:42',season:1}); assert.equal(season.metadata.episodes[0].id,'tmdb:tv:42:season:1:episode:2');
  assert.equal((await lookup(tv,{id:'tmdb:tv:42',groups:true})).groups[0].id,'group_demo');
  assert.equal((await lookup(tv,{id:'tmdb:tv:42',groupId:'group_demo'})).group.id,'group_demo');
  await assert.rejects(lookup(tv,{id:'tmdb:tv:42',season:-1}),/valid season/);
  assert(!tvCalls.some(url => url.includes('/movie/')));
  // Age ratings (discussion #99): the viewer's region first, else the US; a show's from content_ratings.
  const rated = M.create({ credential: 'demo-token', read: (url, headers, cb) => {
    if (url.includes('/tv/5')) return cb(null, { id: 5, name: 'Show', overview: 'x', content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }, { iso_3166_1: 'GB', rating: '15' }] } });
    cb(null, { id: 3, title: 'Film', overview: 'x', release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 4, certification: '' }, { type: 3, certification: 'PG-13' }] }, { iso_3166_1: 'DE', release_dates: [{ type: 3, certification: '12' }] }] } });
  } });
  assert.equal((await lookup(rated, { id: 'tmdb:3' })).metadata.cert, 'PG-13', 'a movie: the US rating for en');
  assert.equal((await lookup(rated, { id: 'tmdb:3', region: 'DE' })).metadata.cert, '12', 'the viewer\'s region first');
  assert.equal((await lookup(rated, { id: 'tmdb:3', region: 'FR' })).metadata.cert, 'PG-13', 'else the US one');
  assert.equal((await lookup(rated, { id: 'tmdb:tv:5', region: 'GB' })).metadata.cert, '15', 'a show: content_ratings');
  // Shelves from TMDB (discussion #184): a region's streaming services biggest first, genres, and one service's or genre's titles.
  const shelfCalls = [];
  const sh = M.create({ credential: 'demo-token', read: (url, headers, cb) => {
    shelfCalls.push(url);
    if (url.includes('/watch/providers/movie')) return cb(null, { results: [{ provider_id: 119, provider_name: 'Prime Video', display_priorities: { IN: 2 } }, { provider_id: 8, provider_name: 'Netflix', display_priorities: { IN: 1 } }, { provider_id: 'x', provider_name: 'Bad' }] });
    if (url.includes('/genre/movie/list')) return cb(null, { genres: [{ id: 27, name: 'Horror' }, { id: 35, name: 'Comedy' }] });
    if (url.includes('/discover/movie')) return cb(null, { total_pages: 1, results: [{ id: 5, title: 'Scary', original_title: 'Scary', release_date: '2024-02-02' }] });
    cb(new Error('unexpected ' + url));
  } });
  const svcs = await lookup(sh, { list: 'services', kind: 'movie', region: 'IN', language: 'en' });
  assert.deepEqual(svcs.items.map((x) => x.name), ['Netflix', 'Prime Video'], 'services by the region\'s order, bad ids left out');
  assert(shelfCalls.some((u) => u.includes('watch_region=IN')));
  assert.deepEqual((await lookup(sh, { list: 'genres', kind: 'movie', language: 'en' })).items, [{ id: 27, name: 'Horror' }, { id: 35, name: 'Comedy' }]);
  const one = await lookup(sh, { list: 'service', provider: '8', region: 'IN', kind: 'movie', language: 'en' });
  assert.equal(one.items[0].t, 'Scary'); assert(shelfCalls.some((u) => u.includes('with_watch_providers=8') && u.includes('watch_region=IN')));
  await lookup(sh, { list: 'genre', genre: '27', kind: 'movie', language: 'en' }); assert(shelfCalls.some((u) => u.includes('with_genres=27')));
  await assert.rejects(lookup(sh, { list: 'service', provider: '8&x=1', kind: 'movie' }), /streaming service/);
  assert(!shelfCalls.some((u) => /watch_region=(?![A-Z]{2}(&|$))/.test(u)), 'a region is two letters or the US');
  console.log('PASS TMDB locale, per-field fallback, artwork, matching, IMDb migration and missing-key behavior');
})().catch(e => { console.error(e); process.exitCode = 1; });
