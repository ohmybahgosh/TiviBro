#!/usr/bin/env node
/* Homebrew Channel files for a release.
     node scripts/gen-manifest.js dist/<ipk> <outdir> [owner/repo] [tag]
   Writes:
     <appId>.manifest.json  the package manifest (same fields webosbrew-toolbox-gen-manifest writes);
                            the in-app updater and install.sh read it from the release
     homebrew-entry.json    this build as one Homebrew Channel repository entry, with the manifest
                            inside it; scripts/update-homebrew-repo.js puts it into repo.json and
                            repo-testing.json on the "homebrew" branch
   The Homebrew Channel fetches repositories from the TV like a web page, so they have to come from a
   host that allows that (raw.githubusercontent.com does; github.com release links do not).  With the
   manifest inside the entry it needs that one request; the IPK itself is downloaded by its service. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [ipk, out = 'dist', repo = process.env.GITHUB_REPOSITORY || 'ohmybahgosh/TiviBro', tagArg] = process.argv.slice(2);
if (!ipk || !fs.existsSync(ipk)) { console.error('usage: gen-manifest.js <ipk> <outdir> [owner/repo] [tag]'); process.exit(1); }
const root = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app/appinfo.json'), 'utf8'));
const full = (/TIVIBRO_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'app/js/log.js'), 'utf8')) || [])[1] || app.version;
const tag = tagArg || process.env.TAG || 'v' + full;
const pre = /-/.test(tag);
const buf = fs.readFileSync(ipk);
const raw = `https://raw.githubusercontent.com/${repo}/main`;
const icon = `${raw}/logos/clean/tivibro-icon-512.png`;
const dl = `https://github.com/${repo}/releases/download/${tag}/`;
const manifest = {
  id: app.id,
  version: app.version,                    // what webOS reports once installed (see pkg-version.js)
  type: app.type,
  title: app.title,
  appDescription: (pre ? 'Test build ' + full + '.  ' : 'Version ' + full + '.  ') + 'Free, guide-first IPTV player for your own Xtream Codes or M3U subscription',
  iconUri: icon,
  sourceUrl: `https://github.com/${repo}`,
  rootRequired: false,
  ipkUrl: dl + path.basename(ipk),
  ipkSize: buf.length,
  ipkHash: { sha256: crypto.createHash('sha256').update(buf).digest('hex') }
};
const manifestName = `${app.id}.manifest.json`;
const entry = {
  id: app.id,
  title: app.title,
  iconUri: icon,
  manifestUrl: dl + manifestName,
  manifest: manifest,
  shortDescription: (pre ? 'Test build ' + full + ': ' : '') + 'The IPTV player LG TVs never got',
  // The Homebrew Channel's details page: screenshots and the formatted description (site/hb/description.html).
  fullDescriptionUrl: 'https://tivibro.app/hb/description.html',
  requirements: { webosRelease: '>=4.0' },
  tivibro: { tag: tag, version: full, prerelease: pre }
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, manifestName), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'homebrew-entry.json'), JSON.stringify(entry, null, 2) + '\n');
console.log(`Wrote ${manifestName} and homebrew-entry.json  (${full} as ${manifest.version}, ${(buf.length / 1024).toFixed(0)} KB, sha256 ${manifest.ipkHash.sha256.slice(0, 12)}…)`);
