/* Special thanks: everyone who has helped build TiviBro on GitHub, kept up to date in README.md and on
   tivibro.app (site/index.html), between <!-- thanks:start --> and <!-- thanks:end -->.
     node scripts/gen-thanks.js            write both files
     node scripts/gen-thanks.js --check    exit 1 if they are out of date
   Counts merged pull requests, and issues (ideas and bug reports), from everyone but the owner and
   bots.  GITHUB_TOKEN raises the API's rate limit; REPO overrides the repository.  The Thanks workflow
   runs it when a pull request is merged or an issue is opened, and every day. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const REPO = process.env.REPO || 'ohmybahgosh/TiviBro', OWNER = REPO.split('/')[0].toLowerCase();
const START = '<!-- thanks:start -->', END = '<!-- thanks:end -->';

async function items() {
  const out = [], headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tivibro-thanks' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  for (let page = 1; page < 50; page++) {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/issues?state=all&per_page=100&page=' + page, { headers });
    if (!r.ok) throw new Error('GitHub answered ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const list = await r.json();
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

// [{ login, url, avatar, prs, issues }], most pull requests first, then most issues, then by name.
function people(list) {
  const by = new Map();
  for (const it of list) {
    const u = it.user || {}, login = u.login || '';
    if (!login || login.toLowerCase() === OWNER || u.type === 'Bot' || /\[bot\]$/.test(login)) continue;
    const pr = !!it.pull_request;
    if (pr && !it.pull_request.merged_at) continue;                       // only pull requests that went in
    if (!pr && (it.labels || []).some(l => /^(invalid|spam)$/i.test(l.name))) continue;
    const p = by.get(login) || { login, url: u.html_url || 'https://github.com/' + login, avatar: u.avatar_url || 'https://github.com/' + login + '.png', prs: 0, issues: 0 };
    if (pr) p.prs++; else p.issues++;
    by.set(login, p);
  }
  return [...by.values()].sort((a, b) => b.prs - a.prs || b.issues - a.issues || a.login.localeCompare(b.login));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function what(p) {
  return [p.prs ? plural(p.prs, 'pull request', 'pull requests') : '', p.issues ? plural(p.issues, 'idea or bug report', 'ideas and bug reports') : ''].filter(Boolean).join(', ');
}
function avatar(p, size) { return p.avatar + (p.avatar.indexOf('?') >= 0 ? '&' : '?') + 's=' + size * 2; }

function readme(ps) {
  if (!ps.length) return 'Nobody yet.  Open a pull request, an idea or a bug report and your name goes here.';
  return '<p>\n' + ps.map(p => '  <a href="' + esc(p.url) + '" title="' + esc(p.login + ': ' + what(p)) + '"><img src="' + esc(avatar(p, 48)) + '" width="48" height="48" alt="' + esc(p.login) + '"></a>').join('\n') + '\n</p>\n\n' +
    ps.map(p => '- **[' + p.login + '](' + p.url + ')**: ' + what(p)).join('\n');
}
function site(ps) {
  if (!ps.length) return '<p class="thanks-empty">Nobody yet.  Open a pull request, an idea or a bug report and your name goes here.</p>';
  return '<div class="thanks">\n' + ps.map(p => '        <a class="thank" href="' + esc(p.url) + '"><img loading="lazy" src="' + esc(avatar(p, 56)) + '" width="56" height="56" alt=""><span><b>' + esc(p.login) + '</b><small>' + esc(what(p)) + '</small></span></a>').join('\n') + '\n      </div>';
}

function replace(file, body) {
  const f = path.join(ROOT, file), s = fs.readFileSync(f, 'utf8'), a = s.indexOf(START), b = s.indexOf(END);
  if (a < 0 || b < a) throw new Error(file + ' has no ' + START + ' ... ' + END + ' block');
  const next = s.slice(0, a + START.length) + '\n' + body + '\n' + s.slice(b);
  return { f, s, next, changed: next !== s };
}

(async () => {
  const ps = people(await items());
  const files = [replace('README.md', readme(ps)), replace('site/index.html', '      ' + site(ps))];
  const stale = files.filter(x => x.changed);
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error('Out of date: ' + stale.map(x => path.relative(ROOT, x.f)).join(', ')); process.exit(1); }
    return console.log('Special thanks is up to date (' + ps.length + ' people)');
  }
  stale.forEach(x => fs.writeFileSync(x.f, x.next));
  console.log(ps.length + ' people: ' + ps.map(p => p.login + ' (' + what(p) + ')').join('; ') + (stale.length ? '' : '  (no change)'));
})().catch(e => { console.error(e.message || e); process.exit(1); });
