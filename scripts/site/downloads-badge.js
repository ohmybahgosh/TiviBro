#!/usr/bin/env node
/* The README's Downloads badge (tivibro.app/badges/downloads.json, read by shields.io's endpoint badge).  shields.io's
   own "total downloads" adds up every release's files itself and, with this many releases, times out (the badge
   showed as a broken image).  Here the Website workflow adds them up once a day, with its token:
     GITHUB_TOKEN=... node scripts/site/downloads-badge.js _site/badges/downloads.json */
'use strict';
const fs = require('fs'), path = require('path');
const out = process.argv[2], repo = process.env.GITHUB_REPOSITORY || 'ohmybahgosh/TiviBro';
if (!out) { console.error('node scripts/site/downloads-badge.js <out.json>'); process.exit(1); }
// 12345 -> "12.3k", as shields.io writes counts.
function short(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }
// Every release's files' download counts, a page of 100 releases at a time.
async function total() {
  let sum = 0;
  for (let page = 1; page < 50; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      { headers: Object.assign({ Accept: 'application/vnd.github+json' }, process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) });
    if (!r.ok) throw new Error('GitHub said ' + r.status);
    const list = await r.json();
    list.forEach((rel) => (rel.assets || []).forEach((a) => { sum += a.download_count || 0; }));
    if (list.length < 100) break;
  }
  return sum;
}
total().then((n) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, label: 'downloads', message: short(n), color: 'F5C451', style: 'flat-square' }));
  console.log('downloads: ' + n);
}, (e) => { console.error('downloads badge: ' + e.message); process.exit(1); });
