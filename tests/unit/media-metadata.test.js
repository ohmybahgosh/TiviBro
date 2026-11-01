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
  console.log('PASS TMDB locale, per-field fallback, artwork, matching, IMDb migration and missing-key behavior');
})().catch(e => { console.error(e); process.exitCode = 1; });
