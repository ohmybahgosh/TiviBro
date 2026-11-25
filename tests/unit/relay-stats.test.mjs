/* The relay's install numbers (relay/worker.js): counting, once a day per network, and the stats store.
     node tests/unit/relay-stats.test.mjs */
import worker from '../../relay/worker.js';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const kv = new Map();
const env = { STATS_KEY: 'k'.repeat(32), STATS: { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); } } };
const req = (path, opts = {}) => new Request('https://relay.example' + path, Object.assign({ headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) }, opts));
const post = (path, body, ip, headers) => worker.fetch(req(path, { method: 'POST', body: JSON.stringify(body), headers: Object.assign({ 'cf-connecting-ip': ip || '1.2.3.4' }, headers || {}) }), env);

let r = await (await post('/count', { e: 'active', v: '0.6.0-alpha.31', w: '25' })).json();
ok('a TV counts itself', r.counted === true);
r = await (await post('/count', { e: 'active', v: '0.6.0-alpha.31', w: '25' })).json();
ok('once a day per network', r.counted === false);
await post('/count', { e: 'active', v: '0.6.0-alpha.30', w: '6' }, '5.6.7.8');
await post('/count', { e: 'install', v: '0.6.0-alpha.31' }, '5.6.7.8');
r = await post('/count', { e: 'active', v: 'hello' }, '9.9.9.9');
ok('nonsense is refused', r.status === 400);
r = await post('/count', { e: 'delete-everything', v: '0.6.0' }, '9.9.9.9');
ok('so are other kinds', r.status === 400);
const stored = [...kv.keys()];
ok('no address is stored, only a hash that expires', stored.every((k) => !/1\.2\.3\.4|5\.6\.7\.8/.test(k) && !/1\.2\.3\.4|5\.6\.7\.8/.test(kv.get(k))), JSON.stringify(stored));
r = await worker.fetch(req('/stats'), env);
ok('the numbers need the key', r.status === 403);
r = await worker.fetch(req('/stats?k=' + 'x'.repeat(32)), env);
ok('a wrong key gets nothing', r.status === 403);
r = await post('/stats/github', { date: '2026-10-31', repo: { stars: 12 } }, '1.1.1.1', { 'X-Stats-Key': env.STATS_KEY });
ok('the workflow can store the day\'s GitHub numbers', r.status === 200);
const all = await (await worker.fetch(req('/stats?days=30', { headers: { 'X-Stats-Key': env.STATS_KEY } }), env)).json();
const today = all.days.find((d) => d.counts);
// The country Cloudflare saw (request.cf), never a header anyone can send.
const fromCc = (cc, ip) => { const r = req('/count', { method: 'POST', body: JSON.stringify({ e: 'active', v: '0.6.0-alpha.31', w: '6' }), headers: { 'cf-connecting-ip': ip, 'cf-ipcountry': 'FR' } }); if (cc) Object.defineProperty(r, 'cf', { value: { country: cc } }); return worker.fetch(r, env); };
await fromCc('DE', '7.7.7.1'); await fromCc('de', '7.7.7.2'); await fromCc('T1', '7.7.7.3'); await fromCc(null, '7.7.7.4');
const cc = JSON.parse(kv.get('n:' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()))).cc;
ok('countries per kind: from Cloudflare, Tor and none as unknown, a header ignored', cc.active.DE === 2 && cc.active['?'] >= 2 && !cc.active.FR && cc.install['?'] === 1, JSON.stringify(cc));
ok('the dashboard gets them', today && today.counts.active['0.6.0-alpha.31'] >= 1 && today.counts.active['0.6.0-alpha.30'] === 1 && today.counts.webos['25'] === 1 && today.counts.webos['6'] === 1 && today.counts.install['0.6.0-alpha.31'] === 1, JSON.stringify(all));
ok('with GitHub\'s', all.days.some((d) => d.github && d.github.repo.stars === 12));
console.log(fails ? fails + ' FAILED' : 'all relay stats checks passed');
process.exit(fails ? 1 : 0);
