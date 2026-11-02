/* Takes logins out of what people post on GitHub (relay/mask.js): issues, issue comments, discussions and
   their comments, whoever wrote them.  Run by the Mask logins workflow:
     on a new or edited issue, comment, discussion or discussion comment: just that one
     node scripts/mask-issues.mjs --all     every issue, discussion and comment (also once a day)
   Needs GITHUB_TOKEN (issues and discussions write) and GITHUB_REPOSITORY.  Changes a text only when
   something in it was masked, and says what it changed (never the login itself). */
import fs from 'node:fs';
import { maskSecrets } from '../relay/mask.js';

const TOKEN = process.env.GITHUB_TOKEN, REPO = process.env.GITHUB_REPOSITORY || 'ohmybahgosh/TiviBro';
const DRY = process.argv.includes('--dry');
if (!TOKEN) { console.error('GITHUB_TOKEN is needed'); process.exit(1); }
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'tivibro-mask' };
let changed = 0;

async function rest(method, path, body) {
  const r = await fetch('https://api.github.com' + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(method + ' ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
async function pages(path) {
  const all = [];
  for (let p = 1; p < 50; p++) { const l = await rest('GET', path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + p); all.push(...l); if (l.length < 100) break; }
  return all;
}
// One text: masked and saved back when that changed anything.
async function fix(what, body, save) {
  const m = maskSecrets(body || '');
  if (m === (body || '')) return;
  changed++;
  console.log('Masked logins in ' + what + (DRY ? ' (dry run, not saved)' : ''));
  if (!DRY) await save(m);
}
const issue = (i) => fix('issue #' + i.number, i.body, (b) => rest('PATCH', `/repos/${REPO}/issues/${i.number}`, { body: b }));
const comment = (c, n) => fix('a comment on #' + n, c.body, (b) => rest('PATCH', `/repos/${REPO}/issues/comments/${c.id}`, { body: b }));
const discussion = (d) => fix('discussion #' + d.number, d.body, (b) => gql('mutation($id:ID!,$b:String!){updateDiscussion(input:{discussionId:$id,body:$b}){discussion{id}}}', { id: d.node_id || d.id, b }));
const dcomment = (c, n) => fix('a comment in discussion #' + n, c.body, (b) => gql('mutation($id:ID!,$b:String!){updateDiscussionComment(input:{commentId:$id,body:$b}){comment{id}}}', { id: c.node_id || c.id, b }));

async function all() {
  for (const i of await pages(`/repos/${REPO}/issues?state=all`)) {
    await issue(i);
    if (i.comments) for (const c of await pages(`/repos/${REPO}/issues/${i.number}/comments`)) await comment(c, i.number);
  }
  const [owner, name] = REPO.split('/');
  let after = null;
  do {
    const d = await gql(`query($o:String!,$n:String!,$a:String){repository(owner:$o,name:$n){discussions(first:30,after:$a){pageInfo{hasNextPage endCursor}
      nodes{id number body comments(first:100){nodes{id body replies(first:100){nodes{id body}}}}}}}}`, { o: owner, n: name, a: after });
    const ds = d.repository.discussions;
    for (const x of ds.nodes) {
      await discussion(x);
      for (const c of x.comments.nodes) { await dcomment(c, x.number); for (const r of c.replies.nodes) await dcomment(r, x.number); }
    }
    after = ds.pageInfo.hasNextPage ? ds.pageInfo.endCursor : null;
  } while (after);
}

async function one() {
  const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (ev.comment && ev.discussion) return dcomment(ev.comment, ev.discussion.number);
  if (ev.comment && ev.issue) return comment(ev.comment, ev.issue.number);
  if (ev.discussion) return discussion(ev.discussion);
  if (ev.issue) return issue(ev.issue);
}

(process.argv.includes('--all') || !process.env.GITHUB_EVENT_PATH ? all() : one())
  .then(() => console.log(changed ? changed + ' text(s) masked' : 'Nothing to mask'))
  .catch((e) => { console.error(e.message || e); process.exit(1); });
