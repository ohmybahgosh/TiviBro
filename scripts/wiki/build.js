/* Builds the GitHub wiki pages in docs/wiki/ from docs/USER-GUIDE.md, so the guide and the wiki
   never drift apart.  Each "###" section of the guide becomes a wiki page; the hand-written pages
   (Home, Installing, FAQ, ...) already in docs/wiki/ are left alone.
     node scripts/wiki/build.js            then   bash scripts/wiki/publish.sh
   Images point at the files in the main repository, so the wiki itself holds only text. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'wiki');
const REPO = process.env.WIKI_REPO || 'https://github.com/ohmybahgosh/TiviBro';
const RAW = REPO + '/raw/main/docs/';
const MARK = '<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->';

const guide = fs.readFileSync(path.join(ROOT, 'docs', 'USER-GUIDE.md'), 'utf8');
const slug = t => t.toLowerCase().replace(/[^\w\- ]+/g, '').trim().replace(/ /g, '-');
const page = t => t.replace(/[^\w ,\-]+/g, '').trim().replace(/,/g, '').replace(/ +/g, '-');

// Split into sections: "### X" pages, plus the "## Troubleshooting" page.
const sections = [];
let part = '';
guide.split('\n').forEach(line => {
  const m = /^(##|###) (.+)$/.exec(line);
  if (m && m[2] === 'Troubleshooting') part = 'Troubleshooting';
  if (m && (m[1] === '###' || m[2] === 'Troubleshooting')) sections.push({ title: m[2], part, lines: [] });
  else if (m && m[1] === '##') { part = m[2]; sections.push(null); }
  else if (sections.length && sections[sections.length - 1]) sections[sections.length - 1].lines.push(line);
});
const pages = sections.filter(Boolean);
pages.forEach(p => { p.name = page(p.title); });
// The web editor's opening section has no "###" of its own: attach it to "Turning on the web editor".
const intro = /## From your computer: the web editor\n([\s\S]*?)\n### /.exec(guide);
const turnOn = pages.find(p => p.title === 'Turning on the web editor');
if (intro && turnOn) turnOn.lines = intro[1].trim().split('\n').concat([''], turnOn.lines);

// "Every setting" opens with how Settings works: put that at the top of its first page.
const every = /## Every setting\n([\s\S]*?)\n### /.exec(guide);
const firstSetting = pages.find(p => p.part === 'Every setting');
if (every && firstSetting) firstSetting.lines = every[1].trim().split('\n').concat([''], firstSetting.lines);

const anchors = {};
pages.forEach(p => { anchors[slug(p.title)] = p.name; });
if (firstSetting) anchors['every-setting'] = firstSetting.name;
// A "####" section (a page inside a Settings section, like API keys) is a heading on its page.
pages.forEach(p => { p.lines.forEach(l => { const m = /^#### (.+)$/.exec(l); if (m && !anchors[slug(m[1])]) anchors[slug(m[1])] = p.name + '#' + slug(m[1]); }); });
// Anchors inside a page (<a name="x"></a>) point at that page's own section.
pages.forEach(p => { (p.lines.join('\n').match(/<a name="([\w-]+)"><\/a>/g) || []).forEach(t => { anchors[/name="([\w-]+)"/.exec(t)[1]] = p.name + '#' + /name="([\w-]+)"/.exec(t)[1]; }); });

function fix(md) {
  return md
    .replace(/\]\(#([\w-]+)\)/g, (m, a) => anchors[a] ? '](' + anchors[a] + ')' : m)
    .replace(/(src|href)="(screenshots|media)\//g, '$1="' + RAW + '$2/')
    .replace(/\]\((screenshots|media)\//g, '](' + RAW + '$1/')
    .replace(/\n---\s*$/, '')
    .trim();
}

let n = 0;
const written = new Set();
pages.forEach((p, i) => { written.add(p.name + '.md'); });
pages.forEach((p, i) => {
  const prev = pages[i - 1], next = pages[i + 1];
  const nav = '\n\n---\n\n' + [prev && '← [' + prev.title + '](' + prev.name + ')', '[Home](Home)', next && '[' + next.title + '](' + next.name + ') →'].filter(Boolean).join('  ·  ');
  const body = MARK + '\n\n' + (p.part && p.part !== 'Troubleshooting' ? '*' + p.part.replace(/^From your computer: /, 'Web editor: ') + '*\n\n' : '') + fix(p.lines.join('\n')) + nav + '\n';
  fs.writeFileSync(path.join(OUT, p.name + '.md'), body); n++;
});

// The sidebar lists every page, grouped like the guide.
const groups = {};
pages.forEach(p => { (groups[p.part] = groups[p.part] || []).push(p); });
const label = { 'On the TV': 'On the TV', 'Every setting': 'Every setting', 'From your computer: the web editor': 'Web editor', 'Troubleshooting': 'Help' };
let side = '**[Home](Home)**\n\n**Getting started**\n- [Installing](Installing)\n- [First start](First-start)\n';
Object.keys(groups).forEach(g => {
  side += '\n**' + (label[g] || g) + '**\n' + groups[g].filter(p => p.name !== 'First-start').map(p => '- [' + p.title + '](' + p.name + ')').join('\n') + '\n';
});
side += '- [FAQ](FAQ)\n- [Privacy and security](Privacy-and-security)\n\n**Project**\n- [Developing](Developing)\n- [Phone app protocol](Phone-app-protocol)\n- [Recording the demo media](Recording-the-demo-media)\n- [Releasing](Releasing)\n';
fs.writeFileSync(path.join(OUT, '_Sidebar.md'), side);

/* A page the guide no longer has (a Settings section that became a page inside another, say): a short note
   pointing at where it is now, so old links and bookmarks still lead somewhere. */
let moved = 0;
fs.readdirSync(OUT).forEach(f => {
  if (!/\.md$/.test(f) || written.has(f) || f === '_Sidebar.md') return;
  const old = fs.readFileSync(path.join(OUT, f), 'utf8');
  if (old.indexOf(MARK) !== 0) return;                     // hand-written: left alone
  const name = f.replace(/\.md$/, ''), title = name.replace(/-/g, ' ');
  const OLD = { 'Settings-Updates-about-and-diagnostics': 'Settings-System', 'Settings-Updates-and-about': 'Settings-System', 'Settings-Diagnostics': 'Settings-System', 'Settings-Playlists': 'Settings-Playlists-and-accounts',
    'Settings-Playlists-and-guide': 'Settings-Playlists-and-accounts', 'Settings-Appearance-and-start-screen': 'Settings-Appearance', 'Settings-Playback-and-buffering': 'Settings-Playback', 'Settings-Remote-control': 'Settings-Playback#settings-remote-and-buttons',
    'Settings-Groups-sorting-hidden': 'Settings-Channels-and-groups', 'Settings-Phone-app': 'Settings-Playlists-and-accounts#settings-phone-app-and-web-editor', 'Settings-Edit-on-a-computer': 'Settings-Playlists-and-accounts#settings-phone-app-and-web-editor',
    'Settings-Edit-on-a-phone-or-computer': 'Settings-Playlists-and-accounts#settings-phone-app-and-web-editor', 'Settings-Guide-start-screen-reminders': 'Settings-Guide', 'TV-series-from-TMDB': 'TV-series-in-the-guide' };
  const to = OLD[name] || anchors[slug(title)] || anchors[slug(title.replace(/^Settings /, 'Settings: '))] || (/^Settings-/.test(name) ? 'Settings' : 'Home');
  const body = MARK + '\n\n**This page has moved.**  It is now [here](' + to + ').\n';
  if (old !== body) fs.writeFileSync(path.join(OUT, f), body);
  moved++;
});
console.log('wiki: ' + n + ' pages from the user guide, plus the sidebar, and ' + moved + ' moved-page notes');
