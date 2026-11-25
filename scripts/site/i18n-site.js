#!/usr/bin/env node
/* tivibro.app in TiviBro's languages: every page of the built site (_site), copied to /de/, /es/... with its text
   from site/i18n/<code>.json, a dictionary from each English text to its translation.
     node scripts/site/i18n-site.js build _site            writes _site/<code>/... for every language (the Pages workflow)
     node scripts/site/i18n-site.js todo de _site > t.json  what's missing in one language, to translate
     node scripts/site/i18n-site.js import de done.json     checks and adds translations ({ "English": "translation" })
     node scripts/site/i18n-site.js count _site             texts per language, done and missing
   scripts/site/i18n-site-fill.js fills a language with the Anthropic API.

   What a "text" is: a run of words with its inline markup (<b>, <a>, <code>...) between two block-level tags, so a
   sentence with a bold word or a link is translated whole; the translation must keep the same tags.  Also the
   alt, title, aria-label and placeholder attributes, the <title>, the description meta tags, and the feature list
   (allfeatures.js).  A page whose text isn't translated yet keeps that text in English; nothing is left out.
   Links between translated pages stay in the language (/de/how-to-install/), and every version names the others
   (hreflang) so search engines send people to their own language. */
'use strict';
const fs = require('fs'), path = require('path');

const LANGS = [
  { code: 'de', dir: 'de', flag: '🇩🇪', name: 'Deutsch', english: 'German' },
  { code: 'es', dir: 'es', flag: '🇪🇸', name: 'Español', english: 'Spanish' },
  { code: 'fr', dir: 'fr', flag: '🇫🇷', name: 'Français', english: 'French' },
  { code: 'it', dir: 'it', flag: '🇮🇹', name: 'Italiano', english: 'Italian' },
  { code: 'nl', dir: 'nl', flag: '🇳🇱', name: 'Nederlands', english: 'Dutch' },
  { code: 'pl', dir: 'pl', flag: '🇵🇱', name: 'Polski', english: 'Polish' },
  { code: 'pt-BR', dir: 'pt', flag: '🇧🇷', name: 'Português', english: 'Portuguese (Brazil)' },
  { code: 'ru', dir: 'ru', flag: '🇷🇺', name: 'Русский', english: 'Russian' },
  { code: 'tr', dir: 'tr', flag: '🇹🇷', name: 'Türkçe', english: 'Turkish' }
];
const EN = { code: 'en', dir: '', flag: '🇺🇸', name: 'English' };
const ORIGIN = 'https://tivibro.app';
// The pages people read.  Left out: the private stats, the ideas list (people's own words), redirects and tools.
const PAGES = ['index.html', '404.html', 'privacy/index.html', 'android-test/index.html', 'features/index.html', 'how-to-install/index.html',
  'best-iptv-player-lg-tv/index.html', 'tivimate-for-lg-tv/index.html', 'xtream-codes-lg-tv/index.html', 'm3u-lg-tv/index.html',
  'stalker-portal-lg-tv/index.html', 'multiview-lg-tv/index.html', 'record-iptv-lg-tv/index.html', 'my-media-lg-tv/index.html', 'videos/index.html'];
const DICT_DIR = path.join(__dirname, '../../site/i18n');
/* Words that scripts put on the page (the cookie question in analytics.js, Copy buttons, the newest build), swapped
   as they are written in the script (quotes escaped), so they come in the language too. */
const SCRIPT_TEXTS = ['Can we count your visit?', 'tivibro.app uses Google Analytics to see which pages help people.  The TiviBro app on your TV doesn\'t track you.',
  'Privacy', 'Allow', 'No thanks', 'Copied', 'Select and copy', 'Copy', 'Newest: '];
const jsq = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
function scriptTexts(src, dict) {
  SCRIPT_TEXTS.forEach((k) => {
    const v = dict[k.trim()] && (dict[k.trim()] + (/ $/.test(k) ? ' ' : ''));
    if (!v) return;
    [">" + jsq(k) + "<", "'" + jsq(k) + "'", "'" + jsq(k) + "  <", "  " + jsq(k) + "  "].forEach((form) => {
      const to = form.replace(jsq(k), jsq(v));
      src = src.split(form).join(to);
    });
  });
  return src;
}

// Inline tags stay inside a text; any other tag ends it.  Whatever is inside these is never translated.
const INLINE = /^(a|b|strong|i|em|code|span|br|mark|small|sup|sub|kbd|abbr|u|s|wbr)$/;
const SKIP = /^(script|style|svg|pre|code|textarea|noscript)$/;
const ATTRS = /\s(alt|title|aria-label|placeholder)="([^"]*)"/g;
const hasWords = (s) => /[A-Za-z]{2}/.test(s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ''));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/* Walks the HTML and calls back for each text (with its start and end in the string) and each translatable
   attribute.  A hand-rolled scan: the site is our own HTML, so tags are well formed; comments and <!doctype> pass. */
function walk(html, onText) {
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/gi;
  let m, runStart = -1, depthSkip = 0, skipTag = '', last = 0;
  const flush = (end) => {
    if (runStart >= 0) { const raw = html.slice(runStart, end); if (hasWords(raw)) onText(runStart, end, raw); }
    runStart = -1;
  };
  while ((m = re.exec(html))) {
    const tag = (m[1] || '').toLowerCase(), close = m[0][1] === '/';
    if (depthSkip) {
      if (tag === skipTag) depthSkip += close ? -1 : (/\/>$/.test(m[0]) ? 0 : 1);
      last = re.lastIndex; continue;
    }
    // Text before this tag belongs to the current run.
    if (m.index > last && runStart < 0 && /\S/.test(html.slice(last, m.index))) runStart = last;
    if (tag && SKIP.test(tag) && !close) {
      if (tag === 'code' && runStart >= 0) { // <code> inside a sentence stays part of it, untouched
        const endCode = html.indexOf('</code>', re.lastIndex); re.lastIndex = endCode + 7; last = re.lastIndex; continue;
      }
      flush(m.index); depthSkip = 1; skipTag = tag; last = re.lastIndex; continue;
    }
    if (tag && INLINE.test(tag)) { if (runStart < 0 && !close) runStart = m.index; last = re.lastIndex; continue; }
    flush(m.index);
    last = re.lastIndex;
  }
  flush(html.length);
}

// Every translatable piece of a page: texts (with leading and trailing space trimmed) and attribute values.
function pieces(html) {
  const out = [];
  walk(html, (a, b, raw) => { const k = norm(raw); if (k) out.push({ kind: 'text', start: a, end: b, raw, key: k }); });
  let m; ATTRS.lastIndex = 0;
  const head = /<title>([^<]*)<\/title>|<meta (?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)" content="([^"]*)"/g;
  while ((m = head.exec(html))) { const v = m[1] != null ? m[1] : m[2]; if (hasWords(v)) out.push({ kind: 'attr', key: norm(v) }); }
  while ((m = ATTRS.exec(html))) if (hasWords(m[2])) out.push({ kind: 'attr', key: norm(m[2]) });
  return out;
}

// The feature list's names (site/allfeatures.js GROUPS) and its few interface words, translated as texts too.
const AF_UI = ['Search features', 'more', 'less', 'No feature matches that.', 'Only in TiviBro', 'New lately'];
function features(root) {
  const src = fs.readFileSync(path.join(root, 'allfeatures.js'), 'utf8'), m = /var GROUPS = (\[[\s\S]*?\]\]\s*\]);/.exec(src);
  if (!m) return { src, groups: null, keys: [] };
  const groups = Function('return ' + m[1])(), keys = [];
  groups.forEach((g) => { keys.push(g[1]); g[2].forEach((f) => keys.push(f.replace(/^[*+]/, ''))); });
  return { src, literal: m[1], groups, keys: keys.concat(AF_UI.filter((w) => src.indexOf("'" + w) >= 0 || src.indexOf(w + "'") >= 0)) };
}

function load(code) { try { return JSON.parse(fs.readFileSync(path.join(DICT_DIR, code + '.json'), 'utf8')); } catch (e) { return {}; } }
function save(code, d) {
  fs.mkdirSync(DICT_DIR, { recursive: true });
  const o = {}; Object.keys(d).sort().forEach((k) => { o[k] = d[k]; });
  fs.writeFileSync(path.join(DICT_DIR, code + '.json'), JSON.stringify(o, null, 1) + '\n');
}
const tagsOf = (s) => (s.match(/<[^>]+>/g) || []).map((t) => t.replace(/\s+/g, ' ')).sort().join('');
/* Is a translation usable?  The same tags (links, bold, code) in any order, no em dash, nothing empty, and an
   attribute value with no quote or angle bracket. */
function problem(key, val) {
  if (typeof val !== 'string' || !val.trim()) return 'empty';
  if (tagsOf(key) !== tagsOf(val)) return 'its tags differ from the English';
  if (/—/.test(val)) return 'an em dash';
  if (!/</.test(key) && /[<>"]/.test(val)) return 'a quote or angle bracket';
  return '';
}

// Every text the site needs, page by page (each once).
function allKeys(root) {
  const seen = new Set();
  PAGES.forEach((p) => { const f = path.join(root, p); if (fs.existsSync(f)) pieces(fs.readFileSync(f, 'utf8')).forEach((x) => seen.add(x.key)); });
  features(root).keys.forEach((k) => seen.add(k));
  SCRIPT_TEXTS.forEach((k) => seen.add(k.trim()));
  return [...seen];
}

// A page's address in a language: "/" stays "/", "/de/" for German, and so on.
const urlIn = (lang, page) => '/' + (lang.dir ? lang.dir + '/' : '') + page.replace(/index\.html$/, '').replace(/^404\.html$/, '404.html');
function picker(cur, page) {
  const all = [EN].concat(LANGS);
  return '<details class="lang-pick"><summary aria-label="Language">' + cur.flag + '</summary><div class="lang-menu">' +
    all.map((l) => '<a href="' + urlIn(l, page) + '" hreflang="' + (l.code === 'pt-BR' ? 'pt' : l.code) + '"' + (l === cur ? ' aria-current="true"' : '') + '>' + l.flag + ' ' + l.name + '</a>').join('') + '</div></details>';
}
const PICK_CSS = '<style>.links a{white-space:nowrap}@media (min-width:961px) and (max-width:1399px){.links{gap:18px}.links a[href$="/videos/"],.links a[href*="/wiki"]{display:none}}.lang-pick{position:relative;margin-left:6px}.lang-pick summary{list-style:none;cursor:pointer;font-size:20px;line-height:1;padding:6px 8px;border-radius:10px}' +
  '.lang-pick summary::-webkit-details-marker{display:none}.lang-pick summary:hover{background:rgba(255,255,255,.06)}' +
  '.lang-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:50;min-width:170px;background:#11162b;border:1px solid #2d3760;border-radius:14px;padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.45)}' +
  '.lang-menu a{display:block;padding:8px 10px;border-radius:9px;color:#e8ecf8;font-size:15px;white-space:nowrap}.lang-menu a:hover,.lang-menu a[aria-current]{background:#1b2340;text-decoration:none}</style>';

/* One page in one language (or English, for its picker and alternates).  Texts are replaced from the end of the
   page backwards, so earlier positions stay right; then attributes, head tags, links, lang and the picker. */
function translatePage(html, page, lang, dict) {
  const t = (k) => (lang.dir && dict[k]) || null;
  if (lang.dir) {
    const list = pieces(html).filter((x) => x.kind === 'text').sort((a, b) => b.start - a.start);
    list.forEach((x) => {
      const v = t(x.key); if (!v) return;
      const lead = /^\s*/.exec(x.raw)[0], trail = /\s*$/.exec(x.raw)[0];
      html = html.slice(0, x.start) + lead + v + trail + html.slice(x.end);
    });
    html = html.replace(ATTRS, (all, a, v) => { const tv = t(norm(v)); return tv ? ' ' + a + '="' + tv + '"' : all; })
      .replace(/<title>([^<]*)<\/title>/, (all, v) => { const tv = t(norm(v)); return tv ? '<title>' + tv + '</title>' : all; })
      .replace(/(<meta (?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)" content=")([^"]*)"/g, (all, a, v) => { const tv = t(norm(v)); return tv ? a + tv + '"' : all; })
      .replace(/<html lang="en"/, '<html lang="' + lang.code + '"')
      // Links to translated pages stay in the language; everything else (images, videos, the repo) is shared.
      .replace(/(href=")\/([^"#?]*)/g, (all, a, p) => {
        const target = (p === '' ? 'index.html' : p.replace(/\/$/, '/index.html'));
        return PAGES.indexOf(target) >= 0 ? a + urlIn(lang, target) : all;
      })
      // Relative paths (img/..., allfeatures.js) are one folder deeper now.
      .replace(/((?:src|href|poster)=")(?![a-z]+:|\/|#|\.\.\/)([^"]+)/g, (all, a, p) => a + '../'.repeat((lang.dir ? 1 : 0) + (page.split('/').length - 1)) + p)
      .replace(/(<link rel="canonical" href=")[^"]*"/, '$1' + ORIGIN + urlIn(lang, page) + '"')
      .replace(/(<meta property="og:url" content=")[^"]*"/, '$1' + ORIGIN + urlIn(lang, page) + '"');
    // The translated feature list (written next to the language's home page).
    if (page === 'index.html') html = html.replace(/(src=")(?:\.\.\/)*allfeatures\.js/, '$1allfeatures.js');
    // The language's own analytics.js (its cookie question), and the words inside the page's own scripts.
    html = html.replace(/(src=")(?:\.\.\/|\/)*analytics\.js/, '$1/' + lang.dir + '/analytics.js')
      .replace(/<script>([\s\S]*?)<\/script>/g, (all, js) => '<script>' + scriptTexts(js, dict) + '</script>');
  }
  const alts = [EN].concat(LANGS).map((l) => '<link rel="alternate" hreflang="' + (l.code === 'pt-BR' ? 'pt' : l.code) + '" href="' + ORIGIN + urlIn(l, page) + '">').join('') +
    '<link rel="alternate" hreflang="x-default" href="' + ORIGIN + urlIn(EN, page) + '">';
  html = html.replace(/<\/head>/, alts + PICK_CSS + '</head>');
  const i = html.indexOf('</nav>');
  return i >= 0 ? html.slice(0, i) + picker(lang, page) + html.slice(i) : html;
}

// The feature list in a language: the same file with its names and words swapped.
function translateFeatures(f, dict) {
  if (!f.groups) return f.src;
  const g = f.groups.map((x) => [x[0], dict[x[1]] || x[1], x[2].map((n) => { const mark = /^[*+]/.test(n) ? n[0] : '', k = n.replace(/^[*+]/, ''); return mark + (dict[k] || k); })]);
  let out = f.src.replace(f.literal, JSON.stringify(g, null, 1));
  AF_UI.forEach((w) => { if (dict[w]) out = out.split("'" + w + "'").join(JSON.stringify(dict[w])); });
  return out;
}

function build(root) {
  const f = features(root), keys = allKeys(root);   // before the English pages get their picker
  LANGS.forEach((lang) => {
    const dict = load(lang.code);
    PAGES.forEach((p) => {
      const src = path.join(root, p); if (!fs.existsSync(src)) return;
      const out = path.join(root, lang.dir, p);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, translatePage(fs.readFileSync(src, 'utf8'), p, lang, dict));
    });
    fs.writeFileSync(path.join(root, lang.dir, 'allfeatures.js'), translateFeatures(f, dict));
    if (fs.existsSync(path.join(root, 'analytics.js'))) fs.writeFileSync(path.join(root, lang.dir, 'analytics.js'), scriptTexts(fs.readFileSync(path.join(root, 'analytics.js'), 'utf8'), dict));
  });
  // English last: its pages get the picker and the alternates too.
  PAGES.forEach((p) => { const src = path.join(root, p); if (fs.existsSync(src)) fs.writeFileSync(src, translatePage(fs.readFileSync(src, 'utf8'), p, EN, {})); });
  console.log('site in ' + (LANGS.length + 1) + ' languages: ' + LANGS.map((l) => { const d = load(l.code); return l.dir + ' ' + Math.round(100 * keys.filter((k) => d[k]).length / keys.length) + '%'; }).join(', '));
}

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'build') build(a || '_site');
  else if (cmd === 'count') { const keys = allKeys(a || '_site'); LANGS.forEach((l) => { const d = load(l.code); console.log(l.code + ': ' + keys.filter((k) => d[k]).length + ' of ' + keys.length); }); }
  else if (cmd === 'todo') { const d = load(a); console.log(JSON.stringify(allKeys(b || '_site').filter((k) => !d[k]), null, 1)); }
  else if (cmd === 'import') {
    const d = load(a), got = JSON.parse(fs.readFileSync(b, 'utf8')); let n = 0; const bad = [];
    Object.keys(got).forEach((k) => { const why = problem(k, got[k]); if (why) bad.push(k.slice(0, 60) + ': ' + why); else { d[k] = got[k]; n++; } });
    save(a, d); console.log(n + ' added' + (bad.length ? ', ' + bad.length + ' left out:\n  ' + bad.join('\n  ') : ''));
    process.exitCode = bad.length ? 1 : 0;
  } else { console.error('node scripts/site/i18n-site.js build|count|todo|import ...'); process.exit(1); }
}

module.exports = { LANGS, PAGES, pieces, problem, translatePage, translateFeatures, features, allKeys, load, save, urlIn };
