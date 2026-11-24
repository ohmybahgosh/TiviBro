/* Series details from TheTVDB (service/tvdb.js): a show found by name the way the guide and the Shows screen ask,
   in the same shape as TMDB's details, through the metadata relay only.
     node tests/unit/tvdb.test.js */
'use strict';
const assert = require('assert');
const T = require('../../service/tvdb.js');

const asked = [];
const SH = { id: '372264', title: 'Slow Horses', originalTitle: 'Slow Horses', year: '2022', plot: 'Spies.', genre: 'Thriller', network: 'Apple TV', status: 'Continuing', originalLanguage: 'eng', runtime: '46 min',
  poster: 'https://artworks.thetvdb.com/p.jpg', backdrop: 'https://artworks.thetvdb.com/b_t.jpg', backdropHd: 'https://artworks.thetvdb.com/b.jpg', logo: 'https://artworks.thetvdb.com/l.png', cast: 'Gary Oldman', seasons: [{ number: 0 }, { number: 1 }] };
const R = (id, name, extra) => Object.assign({ id, name, original: name, aliases: [], year: '2010', country: 'usa', poster: 'https://artworks.thetvdb.com/x.jpg', overview: 'Something.' }, extra || {});
// The relay, answering from fixtures.
T._get = function (url, headers, cb) {
  asked.push(url);
  const u = new URL(url), q = u.searchParams.get('q');
  if (u.pathname === '/v1/search' && u.searchParams.get('type') !== 'movie') {
    if (q === 'Slow Horses') return cb(null, { ok: true, results: [R('372264', 'Slow Horses', { year: '2022', country: 'gbr' })] });
    if (q === 'The Office') return cb(null, { ok: true, results: [R('78107', 'The Office (UK)', { year: '2001', country: 'gbr' }), R('73244', 'The Office (US)', { year: '2005', country: 'usa' })] });
    if (q === 'Modern Marvels') return cb(null, { ok: true, results: [R('77467', 'Modern Marvels', { year: '1993' })] });
    if (q === 'Obscure') return cb(null, { ok: true, results: [R('1', 'Obscure', { poster: '', overview: '' })] });
    if (q === 'Twins') return cb(null, { ok: true, results: [R('2', 'Twins', { country: 'can' }), R('3', 'Twins', { country: 'deu' })] });
    if (q === 'Caballos lentos') return cb(null, { ok: true, results: [R('372264', 'Slow Horses', { aliases: ['Caballos lentos'] })] });
    return cb(null, { ok: true, results: [] });
  }
  if (u.pathname === '/v1/search' && u.searchParams.get('type') === 'movie') {
    if (q === 'Dune') return cb(null, { ok: true, results: [R('1406', 'Dune', { year: '1984' }), R('6187', 'Dune: Part One', { year: '2021', aliases: ['Dune'] })] });
    if (q === 'Obscure Film') return cb(null, { ok: true, results: [R('9', 'Obscure Film', { year: '2019' })] });
    return cb(null, { ok: true, results: [] });
  }
  if (/\/v1\/movie\/(1406|6187|9)$/.test(u.pathname)) {
    const id = u.pathname.split('/').pop(), sc = { 1406: 36856, 6187: 900000, 9: 40 }[id];
    return cb(null, { ok: true, movie: { id, title: id === '6187' ? 'Dune: Part One' : id === '9' ? 'Obscure Film' : 'Dune', year: id === '1406' ? '1984' : id === '9' ? '2019' : '2021', score: sc, imdb: 'tt' + (1000000 + +id), tmdb: '7' + id, trailer: 'abcdefghijk', poster: 'https://artworks.thetvdb.com/m.jpg' } });
  }
  if (/\/v1\/series\/\d+\/season\/1$/.test(u.pathname)) return cb(null, { ok: true, episodes: [{ number: 1, season: 1, title: 'Failure', plot: 'Ousted.', airDate: '2022-04-01', runtime: 53, still: 'https://artworks.thetvdb.com/s.jpg' }] });
  if (/\/v1\/series\/\d+$/.test(u.pathname)) return cb(null, { ok: true, show: Object.assign({}, SH, { id: u.pathname.split('/').pop() }) });
  cb(new Error('unexpected ' + url));
};
const look = (q) => new Promise((res, rej) => T.lookup(q, (e, r) => e ? rej(e) : res(r)));

(async () => {
  let r = await look({ kind: 'tv', guide: 'strong', title: 'Slow Horses', language: 'de' });
  const m = r.metadata;
  assert.equal(m.id, 'tvdb:372264');
  assert.equal(m.provider, 'TheTVDB');
  assert.ok(m.title === 'Slow Horses' && m.plot === 'Spies.' && m.logo && m.backdropHd && m.poster && m.network === 'Apple TV', 'the details shape');
  assert.equal(m.originalLanguage, 'en', 'its language as TiviBro writes it');
  assert.ok(asked.every(u => u.indexOf('https://tivibro-meta.theboxmod.workers.dev/') === 0), 'only the relay is asked');
  assert.ok(asked.some(u => /lang=de/.test(u)), 'in your language');

  r = await look({ kind: 'tv', guide: 'weak', title: 'The Office', country: 'US' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:73244', 'of two shows of one name, the channel\'s country\'s');
  r = await look({ kind: 'tv', guide: 'weak', title: 'The Office', year: '2001' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:78107', 'or the one that started that year');
  r = await look({ kind: 'tv', guide: 'weak', title: 'Modern Marvels: Ink' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:77467', 'the episode after a colon is left out');
  r = await look({ kind: 'tv', guide: 'weak', title: 'Obscure' });
  assert.ok(r.miss, 'a weak guess at a show with no poster or summary is a miss');
  r = await look({ kind: 'tv', guide: 'strong', title: 'Obscure' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:1', 'a sure one is taken');
  r = await look({ kind: 'tv', guide: 'weak', title: 'Twins' });
  assert.ok(r.miss, 'two shows of the name and nothing to choose by: a miss');
  r = await look({ kind: 'tv', guide: 'strong', title: 'Caballos lentos' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:372264', 'a name it also goes by');
  r = await look({ kind: 'tv', guide: 'weak', title: 'Nothing Like This' });
  assert.ok(r.miss, 'not found');

  r = await look({ id: 'tvdb:372264', season: 1, language: 'en' });
  const ep = r.metadata.episodes[0];
  assert.ok(ep.number === 1 && ep.title === 'Failure' && ep.still && ep.id === 'tvdb:372264:season:1:episode:1', 'a season\'s episodes in the same shape');

  // Movies: the guide's (Movies on now) and My media's.
  r = await look({ guide: 'strong', title: 'Dune' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:movie:6187', 'of two films of one name, the best known');
  assert.ok(r.metadata.imdb === 'tt1006187' && r.metadata.tmdb === '76187' && r.metadata.trailer === 'abcdefghijk', 'with its IMDb and TMDB links and trailer');
  r = await look({ guide: 'strong', title: 'Dune', year: '1984' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:movie:1406', 'or the one from the year the guide gave');
  r = await look({ guide: 'weak', title: 'Obscure Film' });
  assert.ok(r.miss, 'an unsure guess needs a film people know');
  r = await look({ guide: 'strong', title: 'Obscure Film' });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:movie:9', 'a sure one takes it');
  r = await look({ title: 'Dune', year: '2021', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:movie:6187', 'My media: matched on its own by name and year');
  r = await look({ title: 'Dune' });
  assert.ok(r.matches.length === 2 && r.matches[0].id === 'tvdb:movie:1406', 'My media: a list to pick from');
  r = await look({ id: 'tvdb:movie:1406' });
  assert.equal(r.metadata.title, 'Dune');
  r = await look({ kind: 'tv', title: 'Slow Horses', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tvdb:372264', 'a My media show matched on its own');
  await assert.rejects(look({ id: 'tmdb:603' }), /TMDB token/, 'a TMDB id needs the token');
  await assert.rejects(look({ id: 'tvdb:1', groups: true }), /TMDB token/, 'so do episode groups');

  const n = asked.length;
  await look({ kind: 'tv', guide: 'strong', title: 'Slow Horses', language: 'de' });
  assert.equal(asked.length, n, 'asked again: from what is kept');
  console.log('PASS Details from TheTVDB: movies and shows, the guide and My media, matching by name, country and year, misses, seasons, the shape, only the relay asked');
})().catch(e => { console.error(e); process.exitCode = 1; });
