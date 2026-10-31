/* TiviBro report relay: a Cloudflare Worker that turns a "Report a problem" from the web editor
   (on someone's phone or computer) into a GitHub issue, so people don't need a GitHub account.

   POST /report  JSON { title, area, often, what, steps, expected, version, tv, browser, log }
     -> 200 { ok: true, url, number }   the new issue
     -> 4xx/5xx { error }               shown to the person, who can still use the GitHub form
   GET /         -> { ok: true, service: 'tivibro-report' }

   Settings (Workers > tivibro-report > Settings > Variables and secrets, and Bindings):
     GITHUB_TOKEN  secret: fine-grained token for the repo, Issues read and write, nothing else
     REPO          text:   ohmybahgosh/TiviBro
     RATE          KV namespace: counters for the rate limits below
   The TV already masks logins and server names before a report leaves it; this masks them again,
   caps every field, and keeps reports to a few an hour from one network and 60 a day in all.
   Nothing is stored except the counters (a hash of the address, kept for an hour or a day). */

const PER_HOUR = 5, PER_DAY = 60, MAX_BODY = 400000, ISSUE_MAX = 62000;
const AREAS = ['The guide', 'Channels list or groups', 'Watching fullscreen (quick menu, info panel, zapping)', 'Catch-up', 'Movies and shows', 'Search',
  'Set-up tour', 'Settings', 'Channel logos', 'Reminders or parental controls', 'Web editor on a computer', 'Web editor on a phone or tablet',
  'Backup and restore', 'Updates', 'Something else'];
const OFTEN = ['Every time', 'Sometimes', 'Once'];
const KEEP = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|(.*\.)?(tivibro\.app|github\.com|githubusercontent\.com|jsdelivr\.net|iptv-org\.github\.io)$)/i;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
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
  return json({ ok: true, url: issue.html_url, number: issue.number });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return json({ ok: true, service: 'tivibro-report', ready: !!(env.GITHUB_TOKEN && env.REPO) });
    if (request.method === 'POST' && url.pathname === '/report') {
      try { return await report(request, env); } catch (e) { console.log('relay error: ' + (e && e.stack || e)); return json({ error: 'The report relay had a problem.  Please use the GitHub form.' }, 500); }
    }
    return json({ error: 'not found' }, 404);
  }
};
