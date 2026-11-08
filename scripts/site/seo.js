#!/usr/bin/env node
// Search-engine extras for tivibro.app, run by .github/workflows/pages.yml on the assembled site.
//
// 1. FAQ structured data: reads the questions in the home page's "Good to know" section
//    (<details><summary>question</summary><p>answer</p></details>) and puts a schema.org FAQPage
//    in place of the <!-- seo:faq --> marker, so the answers Google shows always match the page.
// 2. sitemap.xml: every page in the site that a search engine should index (not a redirect,
//    not noindex), with the date its source in site/ last changed in git.
//
// Usage: node scripts/site/seo.js _site
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ORIGIN = 'https://tivibro.app';
var out = process.argv[2] || '_site';

function text(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function faq(html) {
  var re = /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, m, items = [];
  while ((m = re.exec(html))) {
    items.push({
      '@type': 'Question',
      name: text(m[1]),
      acceptedAnswer: { '@type': 'Answer', text: text(m[2]) }
    });
  }
  return items;
}

function indexable(html) {
  return !/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) &&
         !/<meta[^>]+http-equiv=["']refresh["']/i.test(html);
}

function lastmod(rel) {
  try {
    var d = cp.execSync('git log -1 --format=%cs -- ' + JSON.stringify(path.join('site', rel)),
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  } catch (e) { return ''; }
}

function pages(dir, base) {
  var list = [];
  fs.readdirSync(dir).forEach(function (name) {
    var full = path.join(dir, name), rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) list = list.concat(pages(full, rel));
    else if (name === 'index.html') list.push(rel);
  });
  return list;
}

// 1. FAQ structured data on the home page
var homeFile = path.join(out, 'index.html');
var home = fs.readFileSync(homeFile, 'utf8');
var questions = faq(home);
if (home.indexOf('<!-- seo:faq -->') === -1) throw new Error('index.html has no <!-- seo:faq --> marker');
if (questions.length < 3) throw new Error('found only ' + questions.length + ' FAQ questions in index.html');
var ld = { '@context': 'https://schema.org', '@type': 'FAQPage', '@id': ORIGIN + '/#faq', mainEntity: questions };
home = home.replace('<!-- seo:faq -->',
  '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>');
fs.writeFileSync(homeFile, home);
console.log('FAQ structured data: ' + questions.length + ' questions');

// 2. sitemap.xml
var urls = pages(out, '').filter(function (rel) {
  return indexable(fs.readFileSync(path.join(out, rel), 'utf8'));
}).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); }).map(function (rel) {
  var loc = ORIGIN + '/' + rel.replace(/index\.html$/, '');
  // Pages built by build-pages.js have no file in site/: their words live in scripts/site/.
  var mod = fs.existsSync(path.join('site', rel)) ? lastmod(rel) : lastmod('../scripts/site');
  return '  <url><loc>' + loc + '</loc>' + (mod ? '<lastmod>' + mod + '</lastmod>' : '') + '</url>';
});
fs.writeFileSync(path.join(out, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.join('\n') + '\n</urlset>\n');
console.log('sitemap.xml: ' + urls.length + ' pages');
urls.forEach(function (u) { console.log(u); });
