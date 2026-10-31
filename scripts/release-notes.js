#!/usr/bin/env node
/* Short release notes for one release, from CHANGELOG.md (the GitHub release page).
     node scripts/release-notes.js 0.6.0-alpha.33     what is new in that test build
     node scripts/release-notes.js 0.6.0              a stable release: everything in its section
   Each change is one line, its bold headline; the full text stays in CHANGELOG.md (linked).
   Exits with an error when there is nothing to say, so a release can't go out without notes. */
'use strict';
const fs = require('fs'), path = require('path');
const arg = (process.argv[2] || '').replace(/^v/, '');
if (!arg) { console.error('usage: release-notes.js X.Y.Z[-alpha.N]'); process.exit(1); }
const FULL = 'https://tivibro.app/changelog';
const lines = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').split('\n');
const m = /^(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(arg);
if (!m) { console.error('Not a version: ' + arg); process.exit(1); }
const ver = m[1], stage = m[2], num = m[3];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const start = lines.findIndex(l => new RegExp('^## v?' + esc(ver) + '(\\s|$)').test(l));
if (start < 0) { console.error(`CHANGELOG.md has no "## ${ver}" section.  Rename "## Unreleased" to "## ${ver} (date)" first.`); process.exit(1); }
let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
if (end < 0) end = lines.length;
let body = lines.slice(start + 1, end);

// A test build: only its own "### New in alpha N" (or, once a later build moved on, "### In alpha N").
if (stage) {
  const h = new RegExp('^### (?:New in|In) ' + stage + ' ' + num + '\\s*$', 'i');
  const s = body.findIndex(l => h.test(l));
  if (s < 0) { console.error(`CHANGELOG.md has no "### New in ${stage} ${num}" under ${ver}.`); process.exit(1); }
  let e = body.findIndex((l, i) => i > s && /^### /.test(l));
  if (e < 0) e = body.length;
  body = body.slice(s + 1, e);
}

// One line per change: the bold headline, or the first sentence when a bullet has none.
function short(text) {
  const b = /^\*\*(.+?)\*\*/.exec(text);
  let t = b ? b[1] : text.split(/(?<=[.!?])\s{1,2}(?=[A-Z])/)[0];
  t = t.replace(/\s+/g, ' ').replace(/[:;,]$/, '').trim();
  if (t.length > 140) t = t.slice(0, 137).replace(/\s+\S*$/, '') + '…';
  return t;
}
const out = [];
let item = null;
body.forEach(l => {
  const b = /^[-*]\s+(.*)$/.exec(l);
  if (b) { if (item) out.push(item); item = b[1]; }
  else if (item && /^\s+\S/.test(l) && !/^\s*[-*]\s/.test(l)) item += ' ' + l.trim();
});
if (item) out.push(item);
if (!out.length) { console.error('No changes listed for ' + arg + ' in CHANGELOG.md.'); process.exit(1); }

const title = stage ? `**New in ${stage} ${num}**` : `**New in ${ver}**`;
process.stdout.write([title, '', ...out.map(t => '- ' + short(t)), '', `Every detail: [changelog](${FULL})`].join('\n') + '\n');
