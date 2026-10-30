#!/usr/bin/env node
/* tivibro.app/view: the README's and the user guide's screenshots, in the order they appear, with
   their alt text as captions.  Pictures in those pages link to tivibro.app/view/#<name>, which
   shows them large (GitHub's Markdown can't), with ← → through the rest.
     node scripts/gen-viewer.js [out.json]      (default: site/view/shots.json; Pages builds it) */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, 'site/view/shots.json');
const seen = new Set(), shots = [];
for (const f of ['README.md', 'docs/USER-GUIDE.md']) {
  const md = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /<img\s[^>]*src="(?:docs\/)?screenshots\/([\w.-]+)\.png"[^>]*>/g;
  let m;
  while ((m = re.exec(md))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const alt = (/alt="([^"]*)"/.exec(m[0]) || [])[1] || m[1];
    shots.push({ n: m[1], alt: alt });
  }
}
const missing = shots.filter(s => !fs.existsSync(path.join(ROOT, 'docs/screenshots', s.n + '.png')));
if (missing.length) { console.error('Missing screenshots: ' + missing.map(s => s.n).join(', ')); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(shots));
console.log(shots.length + ' screenshots -> ' + out);
