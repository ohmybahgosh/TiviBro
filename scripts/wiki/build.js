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

function fix(md) {
  return md
    .replace(/\]\(#([\w-]+)\)/g, (m, a) => anchors[a] ? '](' + anchors[a] + ')' : m)
    .replace(/(src|href)="(screenshots|media)\//g, '$1="' + RAW + '$2/')
    .replace(/\]\((screenshots|media)\//g, '](' + RAW + '$1/')
    .replace(/\n---\s*$/, '')
    .trim();
}

let n = 0;
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
side += '- [FAQ](FAQ)\n- [Privacy and security](Privacy-and-security)\n\n**Project**\n- [Developing](Developing)\n- [Recording the demo media](Recording-the-demo-media)\n- [Releasing](Releasing)\n';
fs.writeFileSync(path.join(OUT, '_Sidebar.md'), side);
console.log('wiki: ' + n + ' pages from the user guide, plus the sidebar');
