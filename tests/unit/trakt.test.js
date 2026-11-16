// Trakt: lists typed like Radarr and Sonarr take them, the addresses each list reads, Trakt's rows to TMDB
// ids, and the helper only passing on Trakt addresses TiviBro uses.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const store = {};
const c = { Promise, setTimeout, clearTimeout, Date, JSON, console,
  localStorage: { getItem: () => null, setItem: () => {} },
  U: { hhmm: () => '12:00', toast: () => {} },
  MediaStore: { trakt: () => store, setTrakt: (n) => Object.assign(store, n) },
  Media: { request: () => Promise.resolve({}), refresh: () => {} } };
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/trakt.js', 'utf8') + '\nthis.Trakt = Trakt;', c);
const T = c.Trakt._test;
const p = (s) => JSON.parse(JSON.stringify(T.parse(s)));
assert.deepEqual(p('https://trakt.tv/users/GaryCrawford/lists/Latest-Releases?sort=rank,asc'), { type: 'list', user: 'garycrawford', slug: 'latest-releases' });
assert.deepEqual(p('app.trakt.tv/users/a.b/lists/my-list/'), { type: 'list', user: 'a.b', slug: 'my-list' });
assert.deepEqual(p('someone/top-100'), { type: 'list', user: 'someone', slug: 'top-100' });
assert.deepEqual(p('someone top-100'), { type: 'list', user: 'someone', slug: 'top-100' });
assert.deepEqual(p('trakt.tv/lists/1234567'), { type: 'official', id: '1234567' });
assert.deepEqual(p('trakt.tv/users/bob/watchlist'), { type: 'userwatchlist', user: 'bob' });
assert.equal(T.parse('not a list at all here'), null);
assert.equal(T.parse(''), null);
console.log('PASS Trakt lists typed as a link, NAME/LIST or NAME LIST');

const paths = (src, kind) => T.pathsOf({ src, kind }).map((x) => x[0]);
assert.deepEqual(paths({ type: 'list', user: 'a', slug: 'b' }, 'both'), ['/users/a/lists/b/items/movie', '/users/a/lists/b/items/show']);
assert.deepEqual(paths({ type: 'list', user: 'a', slug: 'b' }, 'shows'), ['/users/a/lists/b/items/show']);
assert.deepEqual(paths({ type: 'chart', chart: 'watched/weekly', of: 'movies' }, 'movies'), ['/movies/watched/weekly?limit=100']);
assert.equal(T.pathsOf({ src: { type: 'watchlist' }, kind: 'both' })[0][2], true, 'the watchlist needs the sign-in');
console.log('PASS each list reads its own Trakt addresses');

const n = JSON.parse(JSON.stringify(T.normalize([{ type: 'movie', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } }, { show: { title: 'Lost', ids: { tmdb: 4607 } } }, { movie: { title: 'No id', ids: {} } }, { title: 'Chart row', ids: { tmdb: 5 } }], 'shows')));
assert.deepEqual(n.map((x) => x.k + ':' + x.tmdb), ['movie:949', 'show:4607', 'show:5']);
console.log('PASS Trakt rows become TMDB ids; ones without are left out');

const A = require('../../service/trakt.js')._test.allowed, P = { test: A };
['/users/a/lists/b/items/movie?limit=250&page=2', '/shows/1390/progress/watched?hidden=false&specials=false', '/sync/history', '/movies/trending?limit=100', '/recommendations/movies?limit=60&ignore_collected=false', '/search/list?query=top%20100&limit=15', '/sync/watched/shows?extended=noseasons']
  .forEach((x) => assert.ok(P.test(x), x));
['/oauth/token', 'https://evil.example/', '//evil.example/x', '/users/../../x', '/users/%2e%2e/x', '/sync/history?x=<script>', '/admin']
  .forEach((x) => assert.ok(!P.test(x), x));
console.log('PASS the helper only passes on Trakt addresses TiviBro uses');
