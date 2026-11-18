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

// Marked by hand (Plex-style): a season's episodes go to Trakt as one show with its season, watched ones with when.
const body = JSON.parse(JSON.stringify(T.bodyOf([{ movie: 949, at: 0 }, { show: 4607, season: 1, episode: 1, at: 0 }, { show: 4607, season: 1, episode: 2, at: 0 }, { show: 4607, season: 2, episode: 1, at: 0 }], true)));
assert.deepEqual(body.movies, [{ ids: { tmdb: 949 }, watched_at: '1970-01-01T00:00:00.000Z' }]);
assert.deepEqual(body.shows.map((s) => s.ids.tmdb + ':' + s.seasons.map((x) => x.number + '=' + x.episodes.map((e) => e.number).join('+')).join(',')), ['4607:1=1+2,2=1']);
const rm = JSON.parse(JSON.stringify(T.bodyOf([{ movie: 949, at: 0, rm: true }], false)));
assert.deepEqual(rm.movies, [{ ids: { tmdb: 949 } }], 'taken off the history: no time');
console.log('PASS marked watched or not watched by hand: grouped by show and season for Trakt');

// Trakt's history, in: a show watched on Trakt gets every one of those episodes marked here, not just the first
// (St Denis Medical: 1 of 37, each edit after the first refused for an old revision).
(async () => {
  const st2 = { token: { access: 'tok', expires: Date.now() + 30 * 864e5 }, settings: {} }, edits = [];
  let rev = 7;
  const lib = { revision: 0 };
  const media = {
    refresh: () => {}, refreshShows: () => {},
    request: (route, q) => {
      if (route === 'trakt') {
        const p = q.path;
        if (/^\/sync\/last_activities/.test(p)) return Promise.resolve({ data: { movies: { watched_at: 'a', paused_at: '' }, episodes: { watched_at: 'b', paused_at: '' } } });
        if (/^\/sync\/watched\/movies/.test(p)) return Promise.resolve({ data: [] });
        if (/^\/sync\/watched\/shows/.test(p)) return Promise.resolve({ data: [{ show: { ids: { tmdb: 251941, trakt: 235514 } }, last_watched_at: '2026-11-18T03:08:00Z' }] });
        if (/^\/shows\/235514\/progress/.test(p)) return Promise.resolve({ data: { seasons: [{ number: 1, episodes: [1, 2, 3].map((n) => ({ number: n, completed: true })) }, { number: 2, episodes: [{ number: 1, completed: true }, { number: 2, completed: false }] }] } });
        if (/^\/sync\/playback/.test(p)) return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
      }
      if (route === 'library/status') return Promise.resolve({ revision: rev });
      if (route === 'library/query' && q.kind === 'show') return Promise.resolve({ items: [{ handle: 'show_1', metadata: { id: 'tmdb:tv:251941' } }], revision: rev });
      if (route === 'library/edit') { if (q.expectedRevision !== rev) return Promise.resolve({ error: 'CONFLICT' }); rev++; edits.push(q); return Promise.resolve({ revision: rev, episodes: q.episodes.filter((x) => x[0] < 3) }); }
      return Promise.resolve({});
    } };
  const c2 = { Promise, setTimeout: (f) => setTimeout(f, 0), clearTimeout, Date, JSON, console, localStorage: { getItem: () => null, setItem: () => {} }, U: { hhmm: () => '12:00', toast: () => {} },
    MediaStore: { trakt: () => st2, setTrakt: (n) => Object.assign(st2, n), load: () => Promise.resolve(), movies: () => [], isWatched: () => false }, Media: media };
  vm.createContext(c2); vm.runInContext(fs.readFileSync('app/js/trakt.js', 'utf8') + '\nthis.Trakt = Trakt;', c2);
  const res = await c2.Trakt.syncNow(true);
  assert.equal(edits.length, 1, 'one edit for the show');
  assert.deepEqual(JSON.parse(JSON.stringify(edits[0].episodes)).sort().join(' '), '1,1 1,2 1,3 2,1', 'every episode Trakt says you watched');
  assert.equal(res.episodes, 4, 'all four counted');
  assert.equal(st2.episodesFixed, 2, 'the full pass after the fix is done once');
  console.log('PASS a show watched on Trakt: every one of its watched episodes marked here, in one edit');
})().catch((e) => { console.error(e); process.exit(1); });
