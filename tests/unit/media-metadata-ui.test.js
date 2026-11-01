// Changing metadata language refreshes existing chosen IDs, including Cinemeta matches.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let language = 'nl', requests = [], fail = false;
const movies = [{ id: 'local1', src: 's', title: 'Original file title', metadata: { provider: 'Cinemeta', id: 'tt1', language: 'en' } }, { id: 'local2', src: 's', title: 'Another file', metadata: { provider: 'TMDB', id: 'tmdb:8', language: 'en', requestedLanguage: 'en' } }];
const notices = [];
const c = { Promise, setTimeout, clearTimeout, Net: { port: 1, ctlHeaders: h => h }, U: { toast: s => notices.push(s) },
  MediaStore: { tmdbToken: () => 'mock-user-token-123456789012345', load: () => Promise.resolve(), movies: () => movies, source: () => ({ id: 's' }), preferences: n => { if (n) language = n.language; return { language }; }, setMetadata: (id, m) => { movies.find(x => x.id === id).metadata = m; return Promise.resolve(); } },
  fetch: (url, opts) => { const q = JSON.parse(opts.body); requests.push(q); return Promise.resolve({ json: () => Promise.resolve(fail ? { error: 'metadata', message: 'Mock provider unavailable' } : { metadata: { provider: 'TMDB', id: q.id === 'tt1' ? 'tmdb:7' : q.id, title: 'Localized movie', language: q.language, requestedLanguage: q.language } }) }); }
};
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/media.js', 'utf8'), c);
(async () => {
  const r = await c.Media.refreshMetadata(); assert.equal(r.updated, 2);
  assert.deepEqual(requests.map(q => q.id), ['tt1', 'tmdb:8']); assert(requests.every(q => q.language === 'nl' && !q.title && !q.source));
  assert.equal(movies[0].metadata.id, 'tmdb:7');
  c.Media.updatePreferences({ language: 'de' });
  for (let i = 0; i < 20 && movies.some(m => m.metadata.language !== 'de'); i++) await new Promise(r => setTimeout(r, 100));
  assert(movies.every(m => m.metadata.language === 'de'));
  assert(requests.slice(2).every(q => q.id.startsWith('tmdb:')), 'refresh keeps chosen matches');
  fail = true; await c.Media.refreshMetadata(); // current language is already cached
  c.Media.updatePreferences({ language: 'en' });
  for (let i = 0; i < 20 && !notices.some(s => /Stopped fetching/.test(s)); i++) await new Promise(r => setTimeout(r, 100));
  assert(movies.every(m => m.metadata.language === 'de'), 'failed refresh keeps saved details');
  console.log('PASS language changes refresh selected IDs and failed requests preserve details');
})().catch(e => { console.error(e); process.exitCode = 1; });
