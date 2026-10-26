#!/usr/bin/env node
/* Homebrew Channel files for a release.
     node scripts/gen-manifest.js dist/<ipk> <outdir> [owner/repo]
   Writes:
     <appId>.manifest.json  the package manifest the Homebrew Channel installs from
                            (same fields webosbrew-toolbox-gen-manifest writes)
     repo.json              a one-package custom repository that points at the newest release
   The IPK is referenced by file name, so the manifest must sit next to it in the release. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [ipk, out = 'dist', repo = process.env.GITHUB_REPOSITORY || 'ohmybahgosh/TiviBro'] = process.argv.slice(2);
if (!ipk || !fs.existsSync(ipk)) { console.error('usage: gen-manifest.js <ipk> <outdir> [owner/repo]'); process.exit(1); }
const root = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app/appinfo.json'), 'utf8'));
const buf = fs.readFileSync(ipk);
const raw = `https://raw.githubusercontent.com/${repo}/main`;
const icon = `${raw}/logos/clean/tivibro-icon-512.png`;
const manifest = {
  id: app.id,
  version: app.version,
  type: app.type,
  title: app.title,
  appDescription: 'Free, guide-first IPTV player for your own Xtream Codes or M3U subscription',
  iconUri: icon,
  sourceUrl: `https://github.com/${repo}`,
  rootRequired: false,
  ipkUrl: path.basename(ipk),
  ipkSize: buf.length,
  ipkHash: { sha256: crypto.createHash('sha256').update(buf).digest('hex') }
};
const manifestName = `${app.id}.manifest.json`;
const repoJson = {
  paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1 },
  packages: [{
    id: app.id,
    title: app.title,
    iconUri: icon,
    manifestUrl: `https://github.com/${repo}/releases/latest/download/${manifestName}`,
    shortDescription: 'The IPTV player LG TVs never got'
  }]
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, manifestName), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'repo.json'), JSON.stringify(repoJson, null, 2) + '\n');
console.log(`Wrote ${manifestName} and repo.json  (${manifest.version}, ${(buf.length / 1024).toFixed(0)} KB, sha256 ${manifest.ipkHash.sha256.slice(0, 12)}…)`);
