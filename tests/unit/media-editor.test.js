// Media editor actions must never send source logins back to the browser.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const read = p => fs.readFileSync(p, 'utf8');
const proxy = require('../../service/proxy');
const ctx = { localStorage: { getItem: () => null, setItem() {} }, U: { debounce: f => f }, Date, setTimeout() {}, clearTimeout() {}, setInterval() {}, document: { addEventListener() {} }, window: { addEventListener() {} } };
vm.createContext(ctx); vm.runInContext(read('app/js/log.js'), ctx);
// A signed link's host is learned when it is resolved (no service is named in the code).
ctx.Log.hideLinksFrom('edge.energycdn.com'); require('../../service/media').hideLinksFrom('edge.energycdn.com');
for (const redact of [ctx.Log.redact, proxy.redact]) {
  assert(redact('http://cdn.example/v/1.mp4?sig=abc123&x=1').indexOf('abc123') < 0, 'signature query values hidden');
  assert(redact('http://other.example/private/token.mkv').indexOf('private') >= 0, 'other hosts keep their path');
  assert(!redact('https://api.themoviedb.org/3/movie/7?api_key=mock-secret').includes('mock-secret'));
  for (const url of ['https://edge.energycdn.com/private/token.mkv?key=secret', 'https://edge.energycdn.com?key=secret', 'http://127.0.0.1/x/https/edge.energycdn.com/private/token.mkv?key=secret']) {
    assert(!/private|token|secret/.test(redact(url)), 'CDN path must be hidden');
    assert(redact(url).includes('edge.energycdn.com'), 'keep the host');
  }
}
const source = { id: 's', type: 'webdav', name: 'Cloud', pass: 'private', user: 'customer' };
const c = { Promise, clean: v => String(v || '').trim(), MediaStore: { load: () => Promise.resolve(), publicSources: () => [{ id: 's', name: 'Cloud', count: 2, pass: 'private', user: 'customer', address: 'https://customer:private@example.invalid/' }], source: id => id === 's' ? source : null, removeSource: id => { c.removed = id; } }, Media: { refresh() {}, addAddress: () => Promise.resolve({ error: 'login', message: 'Wrong login' }) } };
vm.createContext(c);
const src = read('app/js/webedit.js'), start = src.indexOf('  var RUN = {'), end = src.indexOf('\n  };', start);
vm.runInContext(src.slice(src.indexOf('  function mediaSource(a)'), end + 5), c);
(async () => {
  const r = await c.RUN.mediaList(); assert(!/private|customer|pass|user/.test(JSON.stringify(r)));
  await assert.rejects(() => c.RUN.mediaAdd({ address: 'https://example.invalid' }), /Wrong login/);
  await c.RUN.mediaRemove({ id: 's' }); assert.equal(c.removed, 's');
  assert.throws(() => c.RUN.mediaRemove({ id: 'missing' }), /no longer/);
  c.Net = { port: 1, ctlHeaders: h => h };
  c.Media.rescan = () => c.fetch().then(r => r.json());
  c.fetch = () => Promise.resolve({ json: () => Promise.resolve({ error: 'login', message: 'Wrong login' }) });
  await assert.rejects(() => c.RUN.mediaRescan({ id: 's' }), /Wrong login/);
  c.MediaStore.applyScan = () => ({ note: 'The list stays.' });
  c.fetch = () => Promise.resolve({ json: () => Promise.resolve({ note: 'The list stays.' }) });
  assert.equal((await c.RUN.mediaRescan({ id: 's' })).msg, 'The list stays.');
  // The editor can add a login before My media has ever been opened on the TV.
  const m = { Promise, setTimeout, clearTimeout, Net: c.Net, U: { toast() {} },
    MediaStore: { load: () => Promise.resolve(), publicSources: () => [], addSource: () => 'new', applyScan: () => ({}), movies: () => [] },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ movies: [] }) }) };
  vm.createContext(m); vm.runInContext(read('app/js/media.js'), m);
  assert.equal((await m.Media.addAddress('https://example.invalid/', 'u', 'p')).id, 'new');
  console.log('PASS media editor privacy, login failure, rescan, removal and adding before opening the screen');
})().catch(e => { console.error(e); process.exitCode = 1; });
