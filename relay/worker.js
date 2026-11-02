/* TiviBro report relay: a Cloudflare Worker that turns a "Report a problem" from the web editor
   (on someone's phone or computer) into a GitHub issue, so people don't need a GitHub account.

   POST /report  JSON { title, area, often, what, steps, expected, version, tv, browser, log }
     -> 200 { ok: true, url, number }   the new issue
     -> 4xx/5xx { error }               shown to the person, who can still use the GitHub form
   GET /         -> { ok: true, service: 'tivibro-report' }

   Following a report up (TiviBro tells the viewer when the developer answers, see app/js/reports.js):
     /report also answers { key }: a per-report code (an HMAC of the issue number), kept by the TV.
     GET  /status?n=24,25  -> { ok, issues: [{ n, state, reason, url, reply: { id, at, text }, fixed }] }
       the newest reply from the repo's owner or members (not the relay's own follow-ups), plain text,
       and the newest TiviBro version named in those replies.  Only issues the relay opened (from-tv).
     POST /followup JSON { n, key, what, version, tv, log }  -> { ok, url }
       "Still happening": a comment on that issue, with a fresh log, and the issue reopened if it was
       closed.  Needs the issue's key, so nobody can comment on reports that are not theirs.

   Settings (Workers > tivibro-report > Settings > Variables and secrets, and Bindings):
     GITHUB_TOKEN  secret: fine-grained token for the repo, Issues read and write, nothing else
     REPO          text:   ohmybahgosh/TiviBro
     REPORT_KEY    secret: signs the per-report keys (if missing, the GitHub token does)
     RATE          KV namespace: counters for the rate limits below
   The TV already masks logins and server names before a report leaves it; this masks them again,
   caps every field, and keeps reports to a few an hour from one network and 60 a day in all.
   Nothing is stored except the counters (a hash of the address, kept for an hour or a day).

   Install numbers (also here, so there is one small service to look after):
     POST /count  JSON { e: 'install' | 'update' | 'active', v: '0.6.0-alpha.31', w: '25' }
       install.sh counts an install or an update; TiviBro counts itself once a day ("active"),
       unless switched off in Settings, Updates.  Each network is counted once a day per kind; only
       the day's totals are kept (by kind, version and webOS version), never an address or an id.
     POST /stats/github  (the Stats workflow, with X-Stats-Key)  the day's GitHub numbers
     GET  /stats?days=N  (X-Stats-Key, or ?k= from tivibro.app/stats)  everything, for the dashboard
   STATS: KV namespace for those totals.  STATS_KEY: secret shared with the workflow and dashboard. */

const PER_HOUR = 5, PER_DAY = 60, MAX_BODY = 400000, ISSUE_MAX = 62000;
const AREAS = ['The guide', 'Channels list or groups', 'Watching fullscreen (quick menu, info panel, zapping)', 'Catch-up', 'Movies and shows', 'Search',
  'Set-up tour', 'Settings', 'Channel logos', 'Reminders or parental controls', 'Web editor on a computer', 'Web editor on a phone or tablet',
  'Backup and restore', 'Updates', 'Something else'];
const OFTEN = ['Every time', 'Sometimes', 'Once'];
const KEEP = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|(.*\.)?(tivibro\.app|github\.com|githubusercontent\.com|jsdelivr\.net|iptv-org\.github\.io)$)/i;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Stats-Key', 'Access-Control-Max-Age': '86400' };
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }); }

// Logins and servers, once more: query logins and tokens, user:pass@, Xtream stream paths, and any server we don't know.
function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/((?:password|pass|pwd|token|key|auth|sig|signature|hash|session|sid|user|username|u|p)=)[^&\s"'<>]+/gi, '$1***')
    .replace(/\/\/([^/\s:@]+):([^/\s@]+)@/g, '//***:***@')
    .replace(/\/(live|movie|series|timeshift)\/[^/\s]+\/[^/\s]+\//gi, '/$1/***/***/')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)(?:[^/\s@]*@)?([^/\s:'"?#<>)\]]+)/gi, function (m, scheme, host) { return KEEP.test(host) ? m : scheme + '<server>'; });
}
function field(v, max) { return scrub(v).replace(/\r/g, '').trim().slice(0, max); }
// No @mentions or issue references from outside: a zero-width space breaks them.
function quiet(s) { return s.replace(/@(?=\w)/g, '@\u200b').replace(/#(?=\d)/g, '#\u200b'); }

async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function limited(env, ip) {
  if (!env.RATE) return null;
  const now = new Date(), hourKey = 'h:' + await hash(ip) + ':' + now.toISOString().slice(0, 13), dayKey = 'd:' + now.toISOString().slice(0, 10);
  const [h, d] = await Promise.all([env.RATE.get(hourKey), env.RATE.get(dayKey)]);
  if ((+h || 0) >= PER_HOUR) return 'Too many reports from your network in the last hour.  Try again later, or use the GitHub form.';
  if ((+d || 0) >= PER_DAY) return 'The report box is full for today.  Please use the GitHub form instead.';
  await Promise.all([env.RATE.put(hourKey, String((+h || 0) + 1), { expirationTtl: 3700 }), env.RATE.put(dayKey, String((+d || 0) + 1), { expirationTtl: 90000 })]);
  return null;
}

function body(r) {
  const fence = s => '```text\n' + s.replace(/```/g, "'''") + '\n```';
  const head = [
    '### Where is the problem?', r.area, '',
    '### What happened?', quiet(r.what) || '_No answer_', '',
    '### How do you get there?', quiet(r.steps) || '_No answer_', '',
    '### What did you expect?', quiet(r.expected) || '_No answer_', '',
    '### How often?', r.often, '',
    '### TiviBro version', r.version, '',
    '### TV model and webOS version', r.tv || '_Unknown_', ''
  ];
  if (r.browser) head.push('### Web editor problems only - browser and device', r.browser, '');
  head.push('### Log', '');
  const foot = '\n\n<sub>Sent from the TV with Report a problem, through the TiviBro report relay.  Logins and server names were masked on the TV and again here.</sub>';
  let text = head.join('\n');
  let log = r.log;
  const room = ISSUE_MAX - text.length - foot.length - 200;
  let cut = '';
  if (log.length > room) { log = log.slice(log.length - room); log = log.slice(log.indexOf('\n') + 1); cut = 'The start of the log was cut to fit; this is the newest part.\n\n'; }
  text += '<details><summary>Full log (app and network helper)</summary>\n\n' + cut + fence(log) + '\n\n</details>' + foot;
  return text;
}

async function report(request, env) {
  if (!env.GITHUB_TOKEN || !env.REPO) return json({ error: 'The report relay is not set up yet.  Please use the GitHub form.' }, 503);
  const len = +request.headers.get('content-length') || 0;
  if (len > MAX_BODY) return json({ error: 'That report is too big.' }, 413);
  let j;
  try { const t = await request.text(); if (t.length > MAX_BODY) return json({ error: 'That report is too big.' }, 413); j = JSON.parse(t); } catch (e) { return json({ error: 'That report could not be read.' }, 400); }
  const r = {
    title: field(j.title, 120), area: AREAS.indexOf(j.area) >= 0 ? j.area : 'Something else', often: OFTEN.indexOf(j.often) >= 0 ? j.often : 'Once',
    what: field(j.what, 4000), steps: field(j.steps, 3000), expected: field(j.expected, 2000),
    version: field(j.version, 40), tv: field(j.tv, 120), browser: field(j.browser, 200), log: field(j.log, MAX_BODY)
  };
  // Only real TiviBro reports: a version like 0.6.0 or 0.6.0-alpha.15, something said, and the TV's log header.
  if (!/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/.test(r.version)) return json({ error: 'That does not look like a TiviBro report.' }, 400);
  if (r.what.length < 3) return json({ error: 'Say what happened first.' }, 400);
  if (!/^# TiviBro problem report/.test(r.log)) return json({ error: 'That does not look like a TiviBro report.' }, 400);
  const why = await limited(env, request.headers.get('cf-connecting-ip') || 'unknown');
  if (why) return json({ error: why }, 429);
  const res = await fetch('https://api.github.com/repos/' + env.REPO + '/issues', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'tivibro-report-relay', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '[Bug]: ' + quiet(r.title || r.area), body: body(r), labels: ['bug', 'triage', 'from-tv'] })
  });
  if (!res.ok) { const t = await res.text(); console.log('GitHub ' + res.status + ': ' + t.slice(0, 300)); return json({ error: 'GitHub did not take the report (' + res.status + ').  Please use the GitHub form.' }, 502); }
  const issue = await res.json();
  return json({ ok: true, url: issue.html_url, number: issue.number, key: await reportKey(env, issue.number) });
}

/* ---------- following a report up ---------- */
const FOLLOW_MARK = '<!-- tivibro-followup -->';
const gh = (env, path, opts) => fetch('https://api.github.com/repos/' + env.REPO + path, Object.assign({}, opts || {}, {
  headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'tivibro-report-relay', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } }));
async function reportKey(env, n) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.REPORT_KEY || env.GITHUB_TOKEN || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('tivibro-report:' + n));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function vparse(v) { const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(v); return m ? [+m[1], +m[2], +m[3], m[4] ? 0 : 1, m[4] || '', +(m[5] || 0)] : null; }
function vcmp(a, b) { const x = vparse(a), y = vparse(b); for (let i = 0; i < 6; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; }
// What the TV shows: the reply as plain text, without code, pictures, markup or link addresses.
function plain(md) {
  return String(md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, function (m, k) { return /^[-*+]$/.test(k) ? '• ' : ''; })
    .replace(/(\*\*|__|`)/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
async function statusOf(env, n) {
  const r = await gh(env, '/issues/' + n);
  if (r.status === 404 || r.status === 410) return { n, gone: true };
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const i = await r.json();
  if (i.pull_request || !(i.labels || []).some(l => (l.name || l) === 'from-tv')) return { n, gone: true };
  let comments = [];
  if (i.comments) {
    const last = Math.max(1, Math.ceil(i.comments / 100));
    const c = await gh(env, '/issues/' + n + '/comments?per_page=100&page=' + last);
    if (c.ok) comments = await c.json();
  }
  const mine = comments.filter(c => /^(OWNER|MEMBER|COLLABORATOR)$/.test(c.author_association) && String(c.body || '').indexOf(FOLLOW_MARK) < 0);
  const last = mine[mine.length - 1];
  let fixed = '';
  mine.forEach(c => { (String(c.body || '').match(/\b\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/g) || []).forEach(v => { if (vparse(v) && (!fixed || vcmp(v, fixed) > 0)) fixed = v; }); });
  return { n, state: i.state, reason: i.state_reason || '', url: i.html_url, title: String(i.title || '').replace(/^\[Bug\]:\s*/, '').slice(0, 120),
    reply: last ? { id: last.id, at: last.created_at, text: plain(last.body).slice(0, 900) } : null, fixed };
}
async function status(request, env, url) {
  if (!env.GITHUB_TOKEN || !env.REPO) return json({ error: 'not set up' }, 503);
  const ns = String(url.searchParams.get('n') || '').split(',').filter(x => /^\d{1,7}$/.test(x)).slice(0, 10);
  if (!ns.length) return json({ error: 'which reports?' }, 400);
  // The same question from many TVs within a few minutes is answered once.
  const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request('https://relay.cache/status?n=' + ns.join(','));
  if (cache) { const hit = await cache.match(ck); if (hit) return new Response(hit.body, { headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }); }
  const issues = await Promise.all(ns.map(Number).map(n => statusOf(env, n).catch(e => ({ n, error: e.message }))));
  const out = JSON.stringify({ ok: true, issues });
  if (cache) await cache.put(ck, new Response(out, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } }));
  return new Response(out, { headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
async function followup(request, env) {
  if (!env.GITHUB_TOKEN || !env.REPO) return json({ error: 'The report relay is not set up yet.' }, 503);
  let j;
  try { const t = await request.text(); if (t.length > MAX_BODY) return json({ error: 'That is too big.' }, 413); j = JSON.parse(t); } catch (e) { return json({ error: 'That could not be read.' }, 400); }
  const n = /^\d{1,7}$/.test(String(j.n)) ? +j.n : 0;
  if (!n || !same(j.key, await reportKey(env, n))) return json({ error: 'That report is not from this TV.' }, 403);
  const r = { what: field(j.what, 2000), version: field(j.version, 40), tv: field(j.tv, 120), log: field(j.log, MAX_BODY) };
  if (!VER.test(r.version) || !/^# TiviBro problem report/.test(r.log)) return json({ error: 'That does not look like a TiviBro report.' }, 400);
  const why = await limited(env, request.headers.get('cf-connecting-ip') || 'unknown');
  if (why) return json({ error: why }, 429);
  const st = await gh(env, '/issues/' + n);
  if (!st.ok) return json({ error: 'GitHub could not find that report (' + st.status + ').' }, 502);
  const issue = await st.json();
  if (!(issue.labels || []).some(l => (l.name || l) === 'from-tv')) return json({ error: 'That report is not from a TV.' }, 403);
  const fence = s => '```text\n' + s.replace(/```/g, "'''") + '\n```';
  let log = r.log, cut = '';
  const room = ISSUE_MAX - 3000;
  if (log.length > room) { log = log.slice(log.length - room); log = log.slice(log.indexOf('\n') + 1); cut = 'The start of the log was cut to fit; this is the newest part.\n\n'; }
  const text = [FOLLOW_MARK, '### Still happening', '', quiet(r.what) || '_No note_', '', 'TiviBro ' + r.version + (r.tv ? ' on ' + r.tv : '') + '.', '',
    '<details><summary>Log from now (app and network helper)</summary>', '', cut + fence(log), '', '</details>', '',
    '<sub>Sent from the TV with Still happening, through the TiviBro report relay.  Logins and server names were masked on the TV and again here.</sub>'].join('\n');
  const c = await gh(env, '/issues/' + n + '/comments', { method: 'POST', body: JSON.stringify({ body: text }) });
  if (!c.ok) { console.log('GitHub ' + c.status + ': ' + (await c.text()).slice(0, 300)); return json({ error: 'GitHub did not take it (' + c.status + ').' }, 502); }
  const made = await c.json();
  if (issue.state === 'closed') await gh(env, '/issues/' + n, { method: 'PATCH', body: JSON.stringify({ state: 'open' }) });
  return json({ ok: true, url: made.html_url, reopened: issue.state === 'closed' });
}

/* ---------- install numbers ---------- */
const KINDS = ['install', 'update', 'active'];
const VER = /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/;
function day(d) { return (d || new Date()).toISOString().slice(0, 10); }
async function count(request, env) {
  if (!env.STATS) return json({ ok: false }, 503);
  let j;
  try { j = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return json({ error: 'bad' }, 400); }
  const e = KINDS.indexOf(j.e) >= 0 ? j.e : null, v = VER.test(String(j.v || '')) ? String(j.v) : null, w = /^\d{1,2}$/.test(String(j.w || '')) ? String(j.w) : '?';
  if (!e || !v) return json({ error: 'bad' }, 400);
  // Once a day per network and kind: a hash of the address, forgotten after two days.
  const d = day(), seen = 's:' + d + ':' + e + ':' + await hash((request.headers.get('cf-connecting-ip') || '?') + '|' + d);
  if (await env.STATS.get(seen)) return json({ ok: true, counted: false });
  await env.STATS.put(seen, '1', { expirationTtl: 172800 });
  const key = 'n:' + d, cur = JSON.parse(await env.STATS.get(key) || '{}');
  cur[e] = cur[e] || {}; cur[e][v] = (cur[e][v] || 0) + 1;
  if (e === 'active') { cur.webos = cur.webos || {}; cur.webos[w] = (cur.webos[w] || 0) + 1; }
  await env.STATS.put(key, JSON.stringify(cur));
  return json({ ok: true, counted: true });
}
function keyOk(request, env, url) {
  const k = request.headers.get('x-stats-key') || url.searchParams.get('k') || '';
  if (!env.STATS_KEY || k.length !== env.STATS_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ env.STATS_KEY.charCodeAt(i);
  return diff === 0;
}
async function putGithub(request, env) {
  const t = await request.text();
  if (t.length > 2000000) return json({ error: 'too big' }, 413);
  const j = JSON.parse(t), d = /^\d{4}-\d\d-\d\d$/.test(j.date || '') ? j.date : day();
  await env.STATS.put('gh:' + d, t);
  return json({ ok: true, date: d });
}
async function getStats(env, url) {
  const days = Math.min(730, Math.max(1, +url.searchParams.get('days') || 365)), out = [];
  const end = new Date();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) { const d = day(new Date(end.getTime() - i * 86400000)); keys.push(d); }
  // KV reads in parallel, a few dozen at a time.
  for (let i = 0; i < keys.length; i += 50) {
    const part = keys.slice(i, i + 50);
    const got = await Promise.all(part.map(async d => {
      const [n, g] = await Promise.all([env.STATS.get('n:' + d), env.STATS.get('gh:' + d)]);
      return n || g ? { date: d, counts: n ? JSON.parse(n) : null, github: g ? JSON.parse(g) : null } : null;
    }));
    got.forEach(x => { if (x) out.push(x); });
  }
  return json({ ok: true, days: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return json({ ok: true, service: 'tivibro-report', ready: !!(env.GITHUB_TOKEN && env.REPO) });
    if (request.method === 'POST' && url.pathname === '/count') {
      try { return await count(request, env); } catch (e) { console.log('count error: ' + (e && e.message)); return json({ ok: false }, 500); }
    }
    if (url.pathname === '/stats/github' && request.method === 'POST') { if (!keyOk(request, env, url)) return json({ error: 'not allowed' }, 403); return await putGithub(request, env); }
    if (url.pathname === '/stats' && request.method === 'GET') { if (!keyOk(request, env, url)) return json({ error: 'not allowed' }, 403); return await getStats(env, url); }
    if (request.method === 'GET' && url.pathname === '/status') {
      try { return await status(request, env, url); } catch (e) { console.log('status error: ' + (e && e.message)); return json({ error: 'The report relay had a problem.' }, 500); }
    }
    if (request.method === 'POST' && url.pathname === '/followup') {
      try { return await followup(request, env); } catch (e) { console.log('followup error: ' + (e && e.stack || e)); return json({ error: 'The report relay had a problem.' }, 500); }
    }
    if (request.method === 'POST' && url.pathname === '/report') {
      try { return await report(request, env); } catch (e) { console.log('relay error: ' + (e && e.stack || e)); return json({ error: 'The report relay had a problem.  Please use the GitHub form.' }, 500); }
    }
    return json({ error: 'not found' }, 404);
  }
};
