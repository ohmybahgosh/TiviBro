#!/usr/bin/env node
// Builds tivibro.app's inner pages (guides, comparisons, the video pages) into the assembled site.
// Run by .github/workflows/pages.yml before scripts/site/seo.js, which then lists them in sitemap.xml.
//
//   node scripts/site/build-pages.js _site
//
// The words live in scripts/site/pages.js (one object per page) and scripts/site/videos.js (the demo
// clips from docs/media).  Each page gets the same header and footer as the home page, and structured
// data for search engines: BreadcrumbList, a WebPage or TechArticle, and where it fits FAQPage, HowTo,
// ItemList or VideoObject.  Text people read follows docs/ai/GUIDE.md: plain words, two spaces between
// sentences, no em dashes.
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var PAGES = require('./pages');
var VIDEOS = require('./videos');

var ORIGIN = 'https://tivibro.app';
var APP = { '@id': ORIGIN + '/#app' };
var AUTHOR = { '@type': 'Person', '@id': 'https://ohmybahgosh.dev/#person', name: 'OhMyBahGosh', url: 'https://ohmybahgosh.dev/' };
var out = process.argv[2] || '_site';
var ROOT = path.join(__dirname, '..', '..');

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function text(html) { return String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(); }
function ld(obj) { return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>'; }
function gitDate(rel, first) {
  try {
    var d = cp.execSync('git log ' + (first ? '--diff-filter=A --format=%cs' : '-1 --format=%cs') + ' -- ' + JSON.stringify(rel),
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  } catch (e) { return ''; }
}
function iso(sec) { var m = Math.floor(sec / 60), s = Math.round(sec % 60); return 'PT' + (m ? m + 'M' : '') + s + 'S'; }
function clock(sec) { var m = Math.floor(sec / 60), s = Math.round(sec % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
  '<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>' +
  '<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></symbol>' +
  '<symbol id="i-github" viewBox="0 0 16 16"><path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></symbol>' +
  '</defs></svg>';

function head(p, url, graph) {
  var img = p.image ? ORIGIN + '/' + p.image : ORIGIN + '/img/social-preview.png';
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(p.title) + '</title>\n<meta name="description" content="' + esc(p.description) + '">\n' +
    '<meta name="theme-color" content="#0B0E1A">\n<meta name="color-scheme" content="dark">\n<meta name="ga-id" content="G-63KMVHL4PY">\n' +
    '<link rel="canonical" href="' + url + '">\n<link rel="icon" type="image/png" sizes="32x32" href="/img/icon-32.png">\n<link rel="apple-touch-icon" href="/img/icon-180.png">\n' +
    '<meta property="og:type" content="' + (p.video ? 'video.other' : 'article') + '">\n<meta property="og:site_name" content="TiviBro">\n<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:title" content="' + esc(p.ogTitle || p.h1) + '">\n<meta property="og:description" content="' + esc(p.description) + '">\n' +
    '<meta property="og:image" content="' + img + '">\n' + (p.video ? '<meta property="og:video" content="' + ORIGIN + '/media/' + p.video.id + '.mp4">\n<meta property="og:video:type" content="video/mp4">\n' : '') +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/style.css?v=7">\n<link rel="stylesheet" href="/pages.css?v=1">\n' +
    ld({ '@context': 'https://schema.org', '@graph': graph }) + '\n</head>\n';
}

function header() {
  return '<body>\n' + SPRITE + '\n<header class="top" id="top-bar">\n  <div class="wrap bar">\n' +
    '    <a class="brand" href="/" aria-label="TiviBro home"><img src="/img/wordmark.webp" alt="tiviBro" width="140" height="36"></a>\n' +
    '    <nav class="links" id="links" aria-label="Main">\n' +
    '      <a href="/features/">Features</a>\n      <a href="/tivimate-for-lg-tv/">TiviMate on LG</a>\n      <a href="/videos/">Videos</a>\n' +
    '      <a href="https://github.com/ohmybahgosh/TiviBro/wiki">User guide</a>\n' +
    '      <a class="gh" href="https://github.com/ohmybahgosh/TiviBro" aria-label="TiviBro on GitHub"><svg class="i" width="20" height="20"><use href="#i-github"/></svg></a>\n' +
    '      <a class="btn sm primary" href="/how-to-install/">Install</a>\n    </nav>\n' +
    '    <button class="menu-btn" id="menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="links"><span></span><span></span><span></span></button>\n  </div>\n</header>\n';
}

function footer() {
  return '<footer class="foot">\n  <div class="wrap foot-grid">\n' +
    '    <div><img src="/img/wordmark.webp" alt="tiviBro" width="120" height="31"><p>Made by <a href="https://ohmybahgosh.dev/">OhMyBahGosh</a>.  MIT licensed.</p></div>\n' +
    '    <nav aria-label="Footer">\n' + PAGES.filter(function (p) { return p.footer; }).map(function (p) {
      return '      <a href="/' + p.slug + '/">' + esc(p.footer) + '</a>\n'; }).join('') +
    '      <a href="/videos/">Videos</a>\n      <a href="https://github.com/ohmybahgosh/TiviBro">GitHub</a>\n      <a href="https://github.com/ohmybahgosh/TiviBro/wiki">User guide</a>\n      <a href="/privacy/">Privacy</a>\n' +
    '      <a href="#" id="consentLink" hidden>Cookie settings</a>\n    </nav>\n' +
    '    <p class="legal">TiviBro is an independent project.  It is not affiliated with LG Electronics or TiviMate, and it provides no channels, streams or playlists.</p>\n  </div>\n</footer>\n' +
    '<script src="/analytics.js?v=7" defer></script>\n<script>\n(function () {\n' +
    '  var mb = document.getElementById("menu-btn");\n' +
    '  mb.addEventListener("click", function () { var on = !document.body.classList.contains("menu-open"); document.body.classList.toggle("menu-open", on); mb.setAttribute("aria-expanded", on); });\n' +
    '  [].forEach.call(document.querySelectorAll(".copy button"), function (b) { b.addEventListener("click", function () {\n' +
    '    var t = b.previousElementSibling.textContent; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = "Copied"; }, function () { b.textContent = "Select and copy"; });\n' +
    '    setTimeout(function () { b.textContent = "Copy"; }, 1800); }); });\n' +
    '})();\n</script>\n</body>\n</html>\n';
}

function crumbs(list) {
  return {
    html: '<ol class="crumbs">' + list.map(function (c, i) {
      return '<li>' + (i < list.length - 1 ? '<a href="' + c[1] + '">' + esc(c[0]) + '</a>' : '<span aria-current="page">' + esc(c[0]) + '</span>') + '</li>';
    }).join('') + '</ol>',
    ld: { '@type': 'BreadcrumbList', itemListElement: list.map(function (c, i) {
      return { '@type': 'ListItem', position: i + 1, name: c[0], item: ORIGIN + c[1] }; }) }
  };
}

function faqBlock(faq) {
  return '<h2 id="faq">Questions</h2>\n<div class="faq-list">\n' + faq.map(function (f) {
    return '<details><summary>' + f[0] + '</summary><p>' + f[1] + '</p></details>'; }).join('\n') + '\n</div>\n';
}

function cta() {
  return '<div class="page-cta"><h2>Give your LG TV the IPTV player it deserves.</h2><p>Free, open source, and set up from your phone in minutes.</p>' +
    '<div class="cta"><a class="btn primary" href="/how-to-install/">Install TiviBro <svg class="i" width="18" height="18"><use href="#i-arrow"/></svg></a>' +
    '<a class="btn ghost" href="https://github.com/ohmybahgosh/TiviBro"><svg class="i" width="18" height="18"><use href="#i-github"/></svg> Star it on GitHub</a></div></div>\n';
}

function related(slugs) {
  var all = PAGES.concat([{ slug: 'videos', h1: 'TiviBro videos', description: 'Short clips of every part of TiviBro on a TV.' }]);
  return '<h2>Keep reading</h2>\n<div class="related">' + slugs.map(function (s) {
    var p = all.filter(function (x) { return x.slug === s; })[0];
    return '<a href="/' + s + '/">' + esc(p.h1) + '<small>' + esc(p.short || p.description).slice(0, 110) + '</small></a>'; }).join('') + '</div>\n';
}

function write(slug, html) {
  var dir = path.join(out, slug); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log('/' + slug + '/');
}

// ---------- article pages ----------
PAGES.forEach(function (p) {
  var url = ORIGIN + '/' + p.slug + '/';
  var modified = gitDate('scripts/site/pages.js') || p.published;
  var cr = crumbs([['Home', '/']].concat(p.parent ? [p.parent] : []).concat([[p.crumb || p.h1, '/' + p.slug + '/']]));
  var graph = [cr.ld, {
    '@type': p.articleType || 'TechArticle', '@id': url + '#article', headline: p.h1, description: p.description, url: url,
    mainEntityOfPage: url, inLanguage: 'en', datePublished: p.published, dateModified: modified,
    image: p.image ? ORIGIN + '/' + p.image : ORIGIN + '/img/social-preview.png',
    author: AUTHOR, publisher: AUTHOR, about: APP, isPartOf: { '@id': ORIGIN + '/#website' }
  }];
  if (p.faq) graph.push({ '@type': 'FAQPage', '@id': url + '#faq', mainEntity: p.faq.map(function (f) {
    return { '@type': 'Question', name: text(f[0]), acceptedAnswer: { '@type': 'Answer', text: text(f[1]) } }; }) });
  if (p.howto) graph.push({ '@type': 'HowTo', '@id': url + '#howto', name: p.howto.name, description: p.howto.description,
    totalTime: p.howto.totalTime, tool: (p.howto.tools || []).map(function (t) { return { '@type': 'HowToTool', name: t }; }),
    supply: (p.howto.supplies || []).map(function (t) { return { '@type': 'HowToSupply', name: t }; }),
    step: p.howto.steps.map(function (s, i) { var st = { '@type': 'HowToStep', position: i + 1, name: s[0], text: text(s[1]), url: url + '#step-' + (i + 1) };
      if (s[2]) st.image = ORIGIN + '/' + s[2]; return st; }) });
  if (p.itemList) graph.push({ '@type': 'ItemList', '@id': url + '#list', name: p.itemList.name, itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: p.itemList.items.map(function (it, i) { var li = { '@type': 'ListItem', position: i + 1, name: it[0] }; if (it[1]) li.url = it[1]; return li; }) });
  if (p.videos) p.videos.forEach(function (id) { graph.push(videoLd(VIDEOS.filter(function (v) { return v.id === id; })[0])); });

  var body = '<main class="page' + (p.wide ? ' wide' : '') + '">\n<div class="wrap">\n' + cr.html +
    '<div class="page-head"><p class="kicker">' + esc(p.kicker) + '</p><h1>' + esc(p.h1) + '</h1><p class="lead">' + p.lead + '</p>' +
    '<p class="byline">By <a href="https://ohmybahgosh.dev/about/">OhMyBahGosh</a>, who builds TiviBro · Updated <time datetime="' + modified + '">' + modified + '</time></p></div>\n' +
    (p.answer ? '<div class="answer"><p>' + p.answer + '</p></div>\n' : '') +
    '<article class="prose">\n' + p.body + '\n' + (p.faq ? faqBlock(p.faq) : '') + (p.related ? related(p.related) : '') + '</article>\n' + cta() + '</div>\n</main>\n';
  write(p.slug, head(p, url, graph) + header() + body + footer());
});

// ---------- video pages ----------
function videoLd(v) {
  var page = ORIGIN + '/videos/' + v.id + '/';
  return { '@type': 'VideoObject', '@id': page + '#video', name: v.title, description: v.description,
    thumbnailUrl: [ORIGIN + '/img/video/' + v.id + '.webp'], uploadDate: (gitDate('docs/media/' + v.id + '.mp4', true) || '2026-11-06') + 'T12:00:00Z',
    duration: iso(v.seconds), contentUrl: ORIGIN + '/media/' + v.id + '.mp4', url: page, width: v.width, height: v.height,
    inLanguage: 'en', isFamilyFriendly: true, author: AUTHOR, about: APP };
}

VIDEOS.forEach(function (v) {
  var url = ORIGIN + '/videos/' + v.id + '/';
  var cr = crumbs([['Home', '/'], ['Videos', '/videos/'], [v.title, '/videos/' + v.id + '/']]);
  var p = { title: v.title + ' · TiviBro for LG webOS', description: v.description, h1: v.title, image: 'img/video/' + v.id + '.webp', video: v };
  var graph = [cr.ld, { '@type': 'WebPage', '@id': url, url: url, name: p.title, description: v.description, isPartOf: { '@id': ORIGIN + '/#website' },
    primaryImageOfPage: ORIGIN + '/img/video/' + v.id + '.webp', about: APP }, videoLd(v)];
  var others = VIDEOS.filter(function (x) { return x.id !== v.id; }).slice(0, 6);
  var body = '<main class="page">\n<div class="wrap">\n' + cr.html +
    '<div class="page-head"><p class="kicker">Video · ' + clock(v.seconds) + '</p><h1>' + esc(v.title) + '</h1></div>\n' +
    '<div class="player"><video controls playsinline preload="metadata" poster="/img/video/' + v.id + '.webp" width="' + v.width + '" height="' + v.height + '">' +
    '<source src="/media/' + v.id + '.mp4" type="video/mp4"></video></div>\n' +
    '<article class="prose">\n<p>' + v.long + '</p>\n' +
    '<p class="disclose">Recorded on TiviBro running against a made-up demo provider, so every channel and programme name is invented.  The banner at the top right shows which remote button was pressed.</p>\n' +
    (v.guide ? '<p>More in the user guide: <a href="https://github.com/ohmybahgosh/TiviBro/blob/main/docs/USER-GUIDE.md#' + v.guide + '">' + esc(v.guideName) + '</a>.</p>\n' : '') +
    '<h2>More videos</h2>\n<div class="vgrid">' + others.map(card).join('') + '</div>\n</article>\n' + cta() + '</div>\n</main>\n';
  write('videos/' + v.id, head(p, url, graph) + header() + body + footer());
});

function card(v) {
  return '<a class="vcard" href="/videos/' + v.id + '/"><img loading="lazy" src="/img/video/' + v.id + '.webp" alt="' + esc(v.title) + '" width="640" height="' + Math.round(640 * v.height / v.width) + '">' +
    '<span>' + esc(v.title) + '</span><small>' + clock(v.seconds) + ' · ' + esc(v.short) + '</small></a>';
}

(function () {
  var url = ORIGIN + '/videos/';
  var cr = crumbs([['Home', '/'], ['Videos', '/videos/']]);
  var p = { title: 'TiviBro videos: the LG webOS IPTV player in action', description: 'Short clips of TiviBro on an LG TV: the guide, catch-up, movies and shows, changing channels, groups, search, reminders, parental controls, backups and the web editor.', h1: 'TiviBro in action' };
  var graph = [cr.ld, { '@type': 'CollectionPage', '@id': url, url: url, name: p.title, description: p.description, isPartOf: { '@id': ORIGIN + '/#website' }, about: APP,
    mainEntity: { '@type': 'ItemList', itemListElement: VIDEOS.map(function (v, i) { return { '@type': 'ListItem', position: i + 1, url: ORIGIN + '/videos/' + v.id + '/', name: v.title }; }) } }];
  var body = '<main class="page wide">\n<div class="wrap">\n' + cr.html +
    '<div class="page-head"><p class="kicker">Videos</p><h1>' + esc(p.h1) + '</h1><p class="lead">Every clip is a real recording of TiviBro, driven with the remote, on a made-up demo provider.  ' + VIDEOS.length + ' clips, under a minute each.</p></div>\n' +
    '<div class="vgrid">' + VIDEOS.map(card).join('') + '</div>\n' + cta() + '</div>\n</main>\n';
  write('videos', head(p, url, graph) + header() + body + footer());
})();
