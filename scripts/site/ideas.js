#!/usr/bin/env node
// tivibro.app/ideas/: the ideas in GitHub Discussions > Ideas, most wanted first, with what's planned, in
// progress and shipped.  Run by .github/workflows/pages.yml after build-pages.js (it borrows a built page's
// header and footer), every day and on every push, so votes show within a day.
//
//   GITHUB_TOKEN=... node scripts/site/ideas.js _site
//
// Votes are the discussion's upvotes plus 👍 on its first post.  Status comes from the labels planned,
// in progress, shipped and not planned (an idea closed as resolved counts as shipped, closed otherwise as
// not planned).  Without a token, or if GitHub doesn't answer, the page still goes out and points to
// GitHub.  Text people read follows docs/ai/GUIDE.md: plain words, two spaces between sentences, no em dashes.
'use strict';
var fs = require('fs');
var path = require('path');
var https = require('https');

var OUT = process.argv[2] || '_site';
var REPO = (process.env.GITHUB_REPOSITORY || 'ohmybahgosh/TiviBro').split('/');
var TOKEN = process.env.GITHUB_TOKEN || '';
var ORIGIN = 'https://tivibro.app';
var GH = 'https://github.com/' + REPO.join('/');
var NEW = GH + '/discussions/new?category=ideas';
var LIST = GH + '/discussions/categories/ideas?discussions_q=category%3AIdeas+sort%3Atop';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function gql(query, variables) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ query: query, variables: variables });
    var req = https.request({ host: 'api.github.com', path: '/graphql', method: 'POST', headers: {
      Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'tivibro-ideas', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { var j = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (j.errors) return reject(new Error(JSON.stringify(j.errors).slice(0, 300))); resolve(j.data); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('timed out')); });
    req.end(body);
  });
}

function fetchIdeas() {
  var all = [], after = null;
  function page() {
    return gql('query($o:String!,$n:String!,$a:String){repository(owner:$o,name:$n){discussions(first:50,after:$a,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}' +
      'nodes{number title url body createdAt closed closedAt stateReason upvoteCount author{login} category{name} labels(first:10){nodes{name}} comments{totalCount}' +
      ' reactions(content:THUMBS_UP){totalCount}}}}}', { o: REPO[0], n: REPO[1], a: after }).then(function (d) {
      var ds = d.repository.discussions;
      ds.nodes.forEach(function (x) { if (x.category && x.category.name === 'Ideas' && !/^Start here/i.test(x.title)) all.push(x); });   // the how-to post isn't an idea
      after = ds.pageInfo.hasNextPage ? ds.pageInfo.endCursor : null;
      return after ? page() : all;
    });
  }
  return page();
}

// What the idea is about, in a line: the first sentence of "What are you trying to do?" (the form), else of the post.
function gist(body) {
  var b = String(body || '').replace(/\r/g, '');
  var m = b.match(/### What are you trying to do\?\s*\n+([\s\S]*?)(\n###|$)/);
  var t = (m ? m[1] : b.replace(/^#+ .*$/gm, '')).replace(/<!--[\s\S]*?-->/g, '').replace(/!\[[^\]]*\]\([^)]*\)|<img[^>]*>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > 190) t = t.slice(0, 187).replace(/\s+\S*$/, '') + '…';
  return t;
}
function status(x) {
  var l = x.labels.nodes.map(function (n) { return n.name.toLowerCase(); });
  if (l.indexOf('shipped') >= 0 || (x.closed && x.stateReason === 'RESOLVED')) return 'shipped';
  if (l.indexOf('not planned') >= 0 || x.closed) return 'not planned';
  if (l.indexOf('in progress') >= 0) return 'in progress';
  if (l.indexOf('planned') >= 0) return 'planned';
  return 'open';
}
function ago(iso) {
  var d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago';
}
var CHIP = { planned: 'Planned', 'in progress': 'In progress', shipped: 'Shipped', 'not planned': 'Not planned' };
function row(x) {
  var st = status(x), title = x.title.replace(/^\s*\[(Idea|In-Progress)\]:?\s*/i, '').replace(/\[Idea\]:?\s*$/i, '').trim();
  return '<li class="idea"><a class="vote" href="' + esc(x.url) + '" title="Vote on GitHub"><b>▲</b><span>' + x.votes + '</span></a>' +
    '<div class="idea-body"><a class="idea-title" href="' + esc(x.url) + '">' + esc(title) + '</a>' + (CHIP[st] ? ' <span class="chip st-' + st.replace(' ', '-') + '">' + CHIP[st] + '</span>' : '') +
    (x.gist ? '<p>' + esc(x.gist) + '</p>' : '') +
    '<small>' + (x.author ? 'by ' + esc(x.author.login) + ' · ' : '') + x.comments.totalCount + ' comment' + (x.comments.totalCount === 1 ? '' : 's') + ' · ' + ago(x.createdAt) + '</small></div></li>';
}
function section(id, h, note, list, open) {
  if (!list.length) return '';
  var body = '<ol class="ideas">' + list.map(row).join('') + '</ol>';
  if (open === false) return '<details class="ideas-more" id="' + id + '"><summary>' + esc(h) + ' (' + list.length + ')</summary>' + (note ? '<p class="note">' + note + '</p>' : '') + body + '</details>';
  return '<h2 id="' + id + '">' + esc(h) + '</h2>' + (note ? '<p class="note">' + note + '</p>' : '') + body;
}

function render(ideas, failed) {
  ideas.forEach(function (x) { x.votes = (x.upvoteCount || 0) + ((x.reactions && x.reactions.totalCount) || 0); x.gist = gist(x.body); });
  var by = function (s) { return ideas.filter(function (x) { return status(x) === s; }); };
  var top = by('open').sort(function (a, b) { return b.votes - a.votes || b.comments.totalCount - a.comments.totalCount || Date.parse(b.createdAt) - Date.parse(a.createdAt); });
  var shipped = by('shipped').sort(function (a, b) { return Date.parse(b.closedAt || b.createdAt) - Date.parse(a.closedAt || a.createdAt); });
  var when = new Date().toISOString().slice(0, 10);
  var html = '<div class="page-head"><p class="kicker">Ideas</p><h1>What should TiviBro do next?</h1>' +
    '<p class="lead">Ideas live in GitHub Discussions.  Vote with the ▲ on the ones you want, and the most wanted rise to the top here.  Votes help decide what gets built next.</p>' +
    '<div class="cta"><a class="btn primary" href="' + NEW + '">Suggest an idea</a><a class="btn ghost" href="' + LIST + '">All ideas on GitHub</a></div></div>\n' +
    '<div class="answer"><p><b>How to vote.</b>  Open an idea, sign in to GitHub, and press ▲ at its top left (a 👍 on the first post counts too).  One idea per post, so each can be voted on by itself.  Look here first: if it\'s already listed, vote for it instead of posting it again.</p></div>\n' +
    (failed ? '<p class="note">The list couldn\'t be read from GitHub just now.  <a href="' + LIST + '">See the ideas on GitHub</a>.</p>\n' : '') +
    section('vote', 'Vote for what\'s next', 'Open ideas, most votes first.', top) +
    section('in-progress', 'In progress', '', by('in progress')) +
    section('planned', 'Planned', 'Decided on, not started yet.', by('planned')) +
    section('shipped', 'Shipped', 'Ideas that are in TiviBro now.  The <a href="/changelog/">changelog</a> says which version.', shipped.slice(0, 15)) +
    section('not-planned', 'Not planned', 'Each says why on its page.', by('not planned'), false) +
    '<p class="byline">Updated <time datetime="' + when + '">' + when + '</time>.  Votes on GitHub show here within a day.</p>\n';
  return { html: html, count: ideas.length, top: top.slice(0, 10).map(function (x) { return { n: x.number, votes: x.votes, title: x.title, url: x.url }; }) };
}

function page(main) {
  var tpl = fs.readFileSync(path.join(OUT, 'features', 'index.html'), 'utf8');
  var url = ORIGIN + '/ideas/';
  var title = 'Ideas and feature votes: TiviBro', desc = 'Vote on what TiviBro, the free IPTV player for LG webOS TVs, should do next, and see what\'s planned, in progress and shipped.';
  var ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' }, { '@type': 'ListItem', position: 2, name: 'Ideas', item: url }] },
    { '@type': 'WebPage', '@id': url, url: url, name: title, description: desc, inLanguage: 'en', isPartOf: { '@id': ORIGIN + '/#website' } }] };
  return tpl
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(title) + '</title>')
    .replace(/(<meta name="description" content=")[^"]*/, '$1' + esc(desc))
    .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + esc(desc))
    .replace(/(<meta property="og:title" content=")[^"]*/, '$1' + esc('What should TiviBro do next?'))
    .replace(/(<link rel="canonical" href=")[^"]*/, '$1' + url)
    .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + url)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>')
    .replace(/<main class="page">[\s\S]*<\/main>/, '<main class="page">\n<div class="wrap">\n<ol class="crumbs"><li><a href="/">Home</a></li><li><span aria-current="page">Ideas</span></li></ol>' + main + '\n</div>\n</main>');
}

(TOKEN ? fetchIdeas() : Promise.reject(new Error('no GITHUB_TOKEN'))).then(function (ideas) { return render(ideas, false); }, function (e) {
  console.error('ideas: ' + (e.message || e) + '; writing the page without the list');
  return render([], true);
}).then(function (r) {
  var dir = path.join(OUT, 'ideas');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(r.html));
  fs.writeFileSync(path.join(dir, 'top.json'), JSON.stringify({ at: new Date().toISOString(), ideas: r.count, top: r.top }, null, 1));
  console.log('/ideas/: ' + r.count + ' ideas' + (r.top.length ? ', top: ' + r.top.slice(0, 3).map(function (t) { return t.votes + ' ' + t.title; }).join(' | ') : ''));
});
