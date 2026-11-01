// Requests must settle on old TVs and a late token validation cannot undo removal.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
function world() {
  const timers = [], notices = [];
  let token = '';
  const c = { Promise, setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {},
    Net: { port: 1, ctlHeaders: h => h }, U: { toast: s => notices.push(s) },
    MediaStore: { load: () => Promise.resolve(), setTmdbToken: v => { token = v; }, preferences: () => ({ tmdbConfigured: !!token }) },
    fetch: () => new Promise(() => {}) };
  vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/media.js', 'utf8'), c);
  return { c, timers };
}
(async () => {
  const { c, timers } = world();
  const scan = c.Media.scanSource({ type: 'dlna', control: 'http://mock/ctl' });
  await Promise.resolve();
  const rejected = assert.rejects(scan, /timed out/);
  timers.shift()(); await rejected;
  console.log('PASS media request times out without AbortController');
  let answer;
  c.fetch = () => new Promise(resolve => { answer = resolve; });
  const pending = c.Media.setTmdbToken('mock-user-token-123456789012345');
  const cancelled = assert.rejects(pending, /setup changed/);
  await c.Media.setTmdbToken('');
  answer({ json: () => Promise.resolve({ ok: true }) });
  await cancelled;
  assert.equal(c.MediaStore.preferences().tmdbConfigured, false);
  console.log('PASS token removal wins over an older validation request');
})().catch(e => { console.error(e); process.exitCode = 1; });
