// My media: with a TMDB token saved, movies without details or a poster are looked up on their own
// (quietly, a week's rest for ones TMDB can't match), and the saved token can be tested.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let token = 'mock-user-token-123456789012345', requests = [], refuse = false;
const now = Date.now();
const movies = [
  { id: 'a', src: 's', title: 'Paper Planes', year: '2025' },                                                    // nothing yet
  { id: 'b', src: 's', title: 'Copper Canyon', metadata: { provider: 'Cinemeta', id: 'tt9', poster: '' } },        // details, no poster
  { id: 'c', src: 's', title: 'Signal Lost', metadata: { provider: 'TMDB', id: 'tmdb:3', poster: 'https://image.tmdb.org/x.jpg', requestedLanguage: 'en' } },  // complete
  { id: 'd', src: 's', title: 'Unknown Home Video', tmdbMiss: now - 86400e3 },                                    // missed yesterday
  { id: 'e', src: 's', title: 'Nothing Found Here' }                                                              // will miss now
];
const notices = [];
const c = { Promise, setTimeout, clearTimeout, Date, Net: { port: 1, ctlHeaders: h => h }, U: { toast: s => notices.push(s) },
  MediaStore: { tmdbToken: () => token, sources: () => [{ id: 's' }], load: () => Promise.resolve(), movies: () => movies, source: () => ({ id: 's' }), preferences: () => ({ language: 'en' }),
    setMetadata: (id, m) => { movies.find(x => x.id === id).metadata = m; return Promise.resolve(); },
    markMissed: (id) => { movies.find(x => x.id === id).tmdbMiss = Date.now(); return Promise.resolve(); } },
  fetch: (url, opts) => { const q = JSON.parse(opts.body); requests.push(q);
    if (q.check) return Promise.resolve({ json: () => Promise.resolve(refuse ? { error: 'metadata', message: 'TMDB refused the token.  Check it in Settings > My media.' } : { ok: true }) });
    const miss = q.title === 'Nothing Found Here';
    return Promise.resolve({ json: () => Promise.resolve(miss ? { matches: [] } : { metadata: { provider: 'TMDB', id: q.id || 'tmdb:1', title: q.title || 'x', poster: 'https://image.tmdb.org/p.jpg', language: 'en', requestedLanguage: 'en' } }) }); }
};
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/media.js', 'utf8'), c);
(async () => {
  const r = await c.Media.autoDetails();
  const asked = requests.filter(q => !q.check).map(q => q.title || q.id);
  assert.deepEqual(asked, ['Paper Planes', 'tt9', 'Nothing Found Here'], 'only movies without details or a poster, not ones missed this week: ' + asked);
  assert.equal(r.updated, 2);
  assert(movies[0].metadata.poster && movies[1].metadata.poster, 'details and posters saved');
  assert(movies[4].tmdbMiss > now - 1000, 'a miss is remembered');
  assert(!notices.some(s => /Movie details: \d+ of/.test(s)), 'no progress toasts when it runs on its own');
  assert(notices.some(s => /added for 2 movies/.test(s)), 'one word at the end: ' + notices.join(' | '));
  requests = []; await c.Media.autoDetails();
  assert.equal(requests.length, 0, 'nothing left to look up');
  token = ''; requests = []; const r2 = await c.Media.autoDetails();
  assert(r2.skipped && !requests.length, 'no token: nothing sent');
  console.log('PASS movies without details or posters are looked up on their own');

  token = 'mock-user-token-123456789012345'; requests = [];
  assert.equal(await c.Media.testTmdbToken(), 'TMDB accepted the saved token.');
  assert(requests[0].check && requests[0].credential === token);
  refuse = true;
  await c.Media.testTmdbToken().then(() => assert.fail('should refuse'), e => assert(/refused the token/.test(e.message)));
  token = '';
  await c.Media.testTmdbToken().then(() => assert.fail('no token'), e => assert(/No TMDB token/.test(e.message)));
  console.log('PASS the saved TMDB token can be tested');
})().catch(e => { console.error(e); process.exitCode = 1; });
