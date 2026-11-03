// Movies on now: which guide programmes might be movies (app/js/movies.js), the guide's own Movie flag
// (service/guide.js movieFlag), and the TMDB check for them (service/media-metadata.js, guide lookups).
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };

// The guide's flag.
const G = require('../../service/guide.js');
ok('<category>Movie</category> with a year', G.movieFlag('<title>Bridesmaids</title><category lang="en">Movie</category><date>2011</date>') === 'm2011');
ok('Feature Film, TV Movie, Film', ['Feature Film', 'TV Movie', 'Film', 'Movies'].every((c) => G.movieFlag('<category>' + c + '</category>') === 'm'));
ok('a full air date is not a year', G.movieFlag('<category>Movie</category><date>20261101</date>') === 'm');
ok('Series, Film Club, Movie Talk are not', ['Series', 'Film Club', 'Movie Talk', 'Drama'].every((c) => G.movieFlag('<category>' + c + '</category>') === ''));

// Which programmes might be movies.
const c = { Store: { settings: {} }, Events: { of: () => null } };
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/movies.js', 'utf8') + ';this.Movies = Movies;', c);
const M = c.Movies, H = 3600e3, at = (t, mins, extra) => Object.assign({ t, s: 0, e: mins * 60000 }, extra || {});
const chan = (n) => ({ k: n, n, g: 'x' });
ok('cleaned title and year', JSON.stringify(M.clean('Movie: Bridesmaids (2011) [HD]')) === '{"t":"Bridesmaids","y":"2011"}', JSON.stringify(M.clean('Movie: Bridesmaids (2011) [HD]')));
ok('"Couples Retreat  (2009)" has its year', M.clean('Couples Retreat  (2009)').y === '2009');
ok('the guide says Movie: strong', M.strength(chan('ABC'), at('Frozen', 30, { mv: 1 })) === 'strong');
ok('a year in the title: strong', M.strength(chan('ABC'), at('Bridesmaids (2011)', 120)) === 'strong');
ok('a long programme on a movie channel: strong', M.strength(chan('HBO EAST'), at('Dune: Part Two', 166)) === 'strong' && M.strength(chan('Some channel'), at('Dune', 120), 'US| Movies') === 'strong');
ok('a long programme anywhere: weak', M.strength(chan('AMC HD'), at('The Walking Dead', 60)) === '' && M.strength(chan('ABC'), at('Mrs. Doubtfire', 178)) === 'weak');
ok('sport, news, shows and marathons are not', ['NFL Football: Lions at Vikings', 'World News Tonight', 'Saturday Night Live', 'Law & Order Marathon', 'Paid Programming', 'Next game: Red Wings'].every((t) => M.strength(chan('ABC'), at(t, 180)) === ''));
ok('short programmes are not (unless the guide says Movie)', M.strength(chan('HBO'), at('Real Time', 60)) === '' && M.strength(chan('ABC'), at('Movie: Bambi', 70)) === 'strong');
ok('the channel name as the programme is not', M.strength(chan('Starlight Movies'), at('Starlight Movies', 240)) === '');
// The genre shelves under On now and Starting soon.
{
  const g = (id, genre, live) => ({ m: { id, genre }, live, list: [] });
  const sh = { on: [g('a', 'Action, Comedy', true), g('b', 'Drama', true), g('c', 'Action', true)], soon: [g('a', 'Action, Comedy', false), g('d', 'Comedy, Drama', false), g('e', 'Horror', false)] };
  const out = M.genres(sh), txt = out.map((r) => r.title + ':' + r.items.map((x) => x.m.id + (x.live ? '+' : '-')).join(' ')).join(' | ');
  ok('genres with two or more movies, most first, each movie once (the one on now)', txt === 'Action:a+ c+ | Comedy:a+ d- | Drama:b+ d-', txt);
  ok('no genres, no shelves', M.genres({ on: [g('x', '', true)], soon: [] }).length === 0);
}
c.Events.of = () => ({}); ok('event channels are not', M.strength(chan('HBO'), at('Frozen (2013)', 120)) === ''); c.Events.of = () => null;

// The TMDB check.
const MM = require('../../service/media-metadata.js');
function fake(routes) { return (url, headers, cb) => { const r = routes.find(([re]) => re.test(url)); cb(null, r ? r[1] : { results: [] }); }; }
const movie = { id: 7, title: 'Mrs. Doubtfire', original_title: 'Mrs. Doubtfire', release_date: '1993-11-24', popularity: 40, vote_count: 6000, vote_average: 7.1, overview: 'A dad…', genres: [{ name: 'Comedy' }], runtime: 125, poster_path: '/p.jpg', images: {} };
const ask = (routes, q) => new Promise((res) => MM.create({ credential: 'a'.repeat(32), read: fake(routes) }).lookup(Object.assign({ language: 'en' }, q), (e, r) => res(e ? { error: e.message } : r)));
(async () => {
  let r = await ask([[/search\/movie/, { results: [movie] }], [/search\/tv/, { results: [] }], [/movie\/7/, movie]], { guide: 'weak', title: 'Mrs. Doubtfire' });
  ok('a well-known movie of that exact title: found, with poster and rating', r.metadata && r.metadata.title === 'Mrs. Doubtfire' && r.metadata.rating === '7.1' && /p\.jpg/.test(r.metadata.poster), JSON.stringify(r));
  r = await ask([[/search\/movie/, { results: [Object.assign({}, movie, { title: 'Cops', original_title: 'Cops', vote_count: 40 })] }]], { guide: 'weak', title: 'Cops' });
  ok('weak and little known: not a movie', r.miss === true, JSON.stringify(r));
  r = await ask([[/search\/movie/, { results: [Object.assign({}, movie, { title: 'Fargo', original_title: 'Fargo', popularity: 20 })] }], [/search\/tv/, { results: [{ name: 'Fargo', popularity: 90 }] }]], { guide: 'weak', title: 'Fargo' });
  ok('weak, and a better-known TV series of that name: not a movie', r.miss === true, JSON.stringify(r));
  r = await ask([[/search\/movie/, { results: [Object.assign({}, movie, { title: 'Cops', original_title: 'Cops', vote_count: 40 })] }], [/movie\/7/, Object.assign({}, movie, { title: 'Cops' })]], { guide: 'strong', title: 'Cops' });
  ok('strong (the guide said Movie): an exact title is enough', r.metadata && r.metadata.title === 'Cops', JSON.stringify(r));
  r = await ask([[/search\/movie/, { results: [Object.assign({}, movie, { title: 'Mrs. Doubtfire 2', original_title: 'Mrs. Doubtfire 2' })] }]], { guide: 'strong', title: 'Mrs. Doubtfire' });
  ok('not the exact title: not a movie', r.miss === true);
  r = await ask([[/search\/movie/, { results: [movie] }]], { guide: 'strong', title: 'Mrs. Doubtfire', year: '2001' });
  ok('a year that doesn\'t match: not that movie', r.miss === true);
  console.log(fail ? fail + ' FAILED' : 'all movie checks passed');
  process.exit(fail ? 1 : 0);
})();
