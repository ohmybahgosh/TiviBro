/* Following a report up through the relay (relay/worker.js): the per-report key, /status (the
   developer's newest reply, the version it names, closed or not) and /followup ("Still happening").
     node --no-warnings tests/unit/relay-followup.test.mjs */
import worker from '../../relay/worker.js';
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 400) : '')); if (!c) fails++; };
const kv = new Map();
const env = { GITHUB_TOKEN: 'ghp_test', REPORT_KEY: 'r'.repeat(40), REPO: 'o/r', RATE: { get: async (k) => kv.get(k) || null, put: async (k, v) => { kv.set(k, v); } } };

// A pretend GitHub: issue 7 came from a TV, issue 8 is someone's own.
const issues = {
  7: { number: 7, state: 'open', title: '[Bug]: TiviBro closed unexpectedly', html_url: 'https://github.com/o/r/issues/7', labels: [{ name: 'bug' }, { name: 'from-tv' }], comments: 0 },
  8: { number: 8, state: 'open', title: 'Mine', html_url: 'https://github.com/o/r/issues/8', labels: [{ name: 'bug' }], comments: 0 }
};
const comments = { 7: [], 8: [] };
let nextIssue = 7, calls = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = o.method || 'GET', p = u.pathname.replace('/repos/o/r', '');
  calls.push(m + ' ' + p);
  const j = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  let x;
  if (m === 'POST' && p === '/issues') { const i = issues[nextIssue]; return j(i, 201); }
  if ((x = /^\/issues\/(\d+)$/.exec(p))) {
    const i = issues[x[1]]; if (!i) return j({ message: 'Not Found' }, 404);
    if (m === 'PATCH') { Object.assign(i, JSON.parse(o.body)); return j(i); }
    return j(Object.assign({}, i, { comments: comments[x[1]].length }));
  }
  if ((x = /^\/issues\/(\d+)\/comments$/.exec(p))) {
    if (m === 'POST') { const c = { id: 1000 + comments[x[1]].length, body: JSON.parse(o.body).body, author_association: 'OWNER', created_at: new Date().toISOString(), html_url: 'https://github.com/o/r/issues/' + x[1] + '#c' }; comments[x[1]].push(c); return j(c, 201); }
    return j(comments[x[1]]);
  }
  return j({ message: 'Not Found' }, 404);
};
const req = (path, opts = {}) => new Request('https://relay.example' + path, Object.assign({ headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': opts.ip || '1.2.3.4' } }, opts));
const post = async (path, body, ip) => worker.fetch(req(path, { method: 'POST', body: JSON.stringify(body), ip }), env);
const get = async (path) => (await worker.fetch(req(path), env)).json();
const LOG = '# TiviBro problem report, 2026-11-02\n\nTiviBro: 0.6.0-alpha.56\nhttp://user:secret@my.provider.tv/live/u/p/1.ts';

// 1. A report from the TV gets its key.
let r = await (await post('/report', { title: 'TiviBro closed unexpectedly', area: 'The guide', what: 'it closed', version: '0.6.0-alpha.54', tv: 'OLED', log: LOG })).json();
ok('a report gets a number and a key', r.ok && r.number === 7 && /^[0-9a-f]{32}$/.test(r.key), JSON.stringify(r));
const key = r.key;

// 2. Status before any reply.
let s = await get('/status?n=7,8,99,abc');
const s7 = s.issues.find(i => i.n === 7);
ok('status: open, no reply yet', s7 && s7.state === 'open' && !s7.reply && s7.title === 'TiviBro closed unexpectedly', JSON.stringify(s));
ok('reports the relay did not open, and missing ones, are just "gone"', s.issues.find(i => i.n === 8).gone && s.issues.find(i => i.n === 99).gone && s.issues.length === 3, JSON.stringify(s.issues));

// 3. The developer replies (as the owner); someone else comments too.
comments[7].push({ id: 1, author_association: 'NONE', created_at: '2026-11-02T10:00:00Z', body: 'Me too!  Fixed in 9.9.9?' });
comments[7].push({ id: 2, author_association: 'OWNER', created_at: '2026-11-02T11:00:00Z', body: '## Thanks\n\nThis is **fixed** in [0.6.0-alpha.56](https://github.com/o/r/releases/tag/v0.6.0-alpha.56), after 0.6.0-alpha.55.\n\n```js\ncode()\n```\n- Update it\n- Tell me' });
s = await get('/status?n=7');
let rep = s.issues[0].reply;
ok('the newest reply from the developer, as plain text', rep && rep.id === 2 && /^Thanks\n\nThis is fixed in 0\.6\.0-alpha\.56, after/.test(rep.text) && !/```|code\(\)|\*\*|https:/.test(rep.text) && /• Update it/.test(rep.text), JSON.stringify(rep));
ok('the newest version it names (not a visitor\'s)', s.issues[0].fixed === '0.6.0-alpha.56', s.issues[0].fixed);

// 4. Still happening: needs the key.
r = await post('/followup', { n: 7, key: 'f'.repeat(32), what: 'again', version: '0.6.0-alpha.56', log: LOG });
ok('a wrong key is refused', r.status === 403);
r = await post('/followup', { n: 8, key, what: 'again', version: '0.6.0-alpha.56', log: LOG });
ok('one report\'s key does not open another', r.status === 403);
r = await post('/followup', { n: 7, key, what: 'again', version: 'nope', log: LOG });
ok('nonsense is refused', r.status === 400);
issues[7].state = 'closed'; issues[7].state_reason = 'completed';
r = await (await post('/followup', { n: 7, key, what: 'Still closes, @someone see #3', version: '0.6.0-alpha.56', tv: 'OLED', log: LOG }, '2.2.2.2')).json();
const made = comments[7][comments[7].length - 1];
ok('Still happening adds a comment with the note and a fresh log', r.ok && /Still happening/.test(made.body) && /Still closes/.test(made.body) && /0\.6\.0-alpha\.56 on OLED/.test(made.body) && /# TiviBro problem report/.test(made.body), made.body.slice(0, 300));
ok('logins and servers are masked again', !/secret|my\.provider/.test(made.body) && /<server>/.test(made.body), made.body);
ok('no @mentions or issue links from outside', /@​someone/.test(made.body) && /#​3/.test(made.body));
ok('a closed report is reopened', r.reopened && issues[7].state === 'open');
s = await get('/status?n=7');
ok('the relay\'s own comment is not "a reply from the developer"', s.issues[0].reply.id === 2, JSON.stringify(s.issues[0].reply));
// 5. Rate limits apply to follow-ups too.
for (let i = 0; i < 6; i++) r = await post('/followup', { n: 7, key, what: 'x', version: '0.6.0-alpha.56', log: LOG }, '3.3.3.3');
ok('follow-ups share the hourly limit', r.status === 429);
ok('no token or key leaks into answers', !JSON.stringify(await get('/status?n=7')).includes('ghp_test'));

console.log(fails ? fails + ' FAILED' : 'all relay follow-up checks passed');
process.exit(fails ? 1 : 0);
