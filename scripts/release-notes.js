#!/usr/bin/env node
/* Print the CHANGELOG.md section for one version (used as the GitHub release notes).
     node scripts/release-notes.js 0.6.0
   Exits with an error if CHANGELOG.md has no "## 0.6.0" heading, so a release can't go out without notes. */
'use strict';
const fs = require('fs'), path = require('path');
const ver = (process.argv[2] || '').replace(/^v/, '');
if (!ver) { console.error('usage: release-notes.js X.Y.Z'); process.exit(1); }
const lines = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').split('\n');
const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = lines.findIndex(l => new RegExp('^## v?' + esc + '(\\s|$)').test(l));
if (start < 0) { console.error(`CHANGELOG.md has no "## ${ver}" section.  Rename "## Unreleased" to "## ${ver} (date)" first.`); process.exit(1); }
let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
if (end < 0) end = lines.length;
process.stdout.write(lines.slice(start + 1, end).join('\n').trim() + '\n');
