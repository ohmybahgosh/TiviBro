/* The day's GitHub numbers for the TiviBro stats dashboard (tivibro.app/stats), sent to the relay
   (relay/worker.js) by the Stats workflow every day, because GitHub keeps traffic for 14 days only.
     TB_STATS_TOKEN  fine-grained token, this repo, Administration: read (traffic needs it)
     GITHUB_TOKEN    the workflow's own, used only when TB_STATS_TOKEN is missing (its stargazer list is refused)
     TB_STATS_KEY    the relay's stats key;  STATS_URL  the relay (default below)
     node scripts/stats/collect.js [--dry]     --dry prints instead of sending */
'use strict';
const REPO = process.env.REPO || 'ohmybahgosh/TiviBro';
const RELAY = process.env.STATS_URL || 'https://tivibro-report.theboxmod.workers.dev';
const dry = process.argv.includes('--dry');

async function gh(path, token, accept) {
  const r = await fetch('https://api.github.com' + path, { headers: { Accept: accept || 'application/vnd.github+json', 'User-Agent': 'tivibro-stats', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return { body: await r.json(), link: r.headers.get('link') || '' };
}
async function all(path, token, accept) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const { body, link } = await gh(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page, token, accept);
    out.push(...body);
    if (!/rel="next"/.test(link)) break;
  }
  return out;
}

(async () => {
  const pub = process.env.TB_STATS_TOKEN || process.env.GITHUB_TOKEN, traffic = process.env.TB_STATS_TOKEN;
  const repo = (await gh('/repos/' + REPO, pub)).body;
  const out = {
    date: new Date().toISOString().slice(0, 10), at: new Date().toISOString(),
    repo: { stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count, issues: repo.open_issues_count, size: repo.size },
  };
  // Who starred and forked, and when (for the growth curves): dates only.
  // Star dates: GitHub refuses repo-scoped tokens on this list, so try each token we have.  Without dates
  // the dashboard still charts the daily star count.
  out.stars = [];
  for (const t of [process.env.TB_STATS_TOKEN, process.env.GITHUB_TOKEN]) {
    if (!t) continue;
    try { out.stars = (await all('/repos/' + REPO + '/stargazers', t, 'application/vnd.github.star+json')).map((s) => s.starred_at).filter(Boolean); delete out.starsError; break; }
    catch (e) { out.starsError = e.message.slice(0, 200); }
  }
  out.forks = (await all('/repos/' + REPO + '/forks?sort=oldest', pub)).map((f) => f.created_at);
  // Downloads of every release file: the TV package, the phone app, the installer.
  out.releases = (await all('/repos/' + REPO + '/releases', pub)).map((r) => ({
    tag: r.tag_name, published: r.published_at, pre: r.prerelease,
    assets: (r.assets || []).map((a) => ({ name: a.name, downloads: a.download_count })),
  }));
  // Traffic: the last 14 days, as GitHub has them today.
  if (traffic) {
    const t = (p) => gh('/repos/' + REPO + '/traffic/' + p, traffic).then((x) => x.body);
    const [views, clones, referrers, paths] = await Promise.all([t('views'), t('clones'), t('popular/referrers'), t('popular/paths')]);
    out.views = views.views; out.clones = clones.clones;
    out.referrers = referrers; out.paths = paths.map((p) => ({ path: p.path, title: p.title, count: p.count, uniques: p.uniques }));
  } else out.trafficError = 'TB_STATS_TOKEN is not set';
  const summary = `${out.date}: ${out.repo.stars} stars, ${out.repo.forks} forks, ${out.releases.length} releases, ` +
    (out.views ? `${out.views.reduce((a, v) => a + v.count, 0)} views and ${out.clones.reduce((a, v) => a + v.count, 0)} clones in 14 days` : 'no traffic (' + out.trafficError + ')');
  if (dry) { console.log(JSON.stringify(out, null, 2).slice(0, 3000)); return console.log(summary); }
  const r = await fetch(RELAY + '/stats/github', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stats-Key': process.env.TB_STATS_KEY || '' }, body: JSON.stringify(out) });
  if (!r.ok) throw new Error('The relay said ' + r.status + ': ' + (await r.text()).slice(0, 200));
  console.log(summary + '.  Stored.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
