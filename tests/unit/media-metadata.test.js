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
  console.log('PASS TMDB locale, per-field fallback, artwork, matching, IMDb migration and missing-key behavior');
})().catch(e => { console.error(e); process.exitCode = 1; });
