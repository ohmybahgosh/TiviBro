#!/usr/bin/env node
/* Puts a release into the Homebrew Channel repository files.
     node scripts/update-homebrew-repo.js dist/homebrew-entry.json <dir> [install.sh]
   <dir> is a checkout of the "homebrew" branch.  Writes:
     repo.json          the newest full release; until the first one exists, the newest test build
     repo-testing.json  the newest build of any kind
     install.sh         the on-TV installer from the newest build (when given)
   Users add one of these in the Homebrew Channel settings, through raw.githubusercontent.com:
     https://raw.githubusercontent.com/<owner>/<repo>/homebrew/repo.json
   An older tag never replaces a newer one (re-running an old release build is harmless). */
'use strict';
const fs = require('fs'), path = require('path');
const [entryFile, dir = '.', installer] = process.argv.slice(2);
if (!entryFile) { console.error('usage: update-homebrew-repo.js <homebrew-entry.json> <dir>'); process.exit(1); }
const entry = JSON.parse(fs.readFileSync(entryFile, 'utf8'));

// Order of full versions: 0.6.0-alpha.2 < 0.6.0-beta.1 < 0.6.0-rc.1 < 0.6.0 < 0.6.1
function rank(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(v || '') || [];
  const kind = { alpha: 1, beta: 2, rc: 3 }[m[4]] || (m[4] ? 0 : 9);
  return [+m[1] || 0, +m[2] || 0, +m[3] || 0, kind, +m[5] || 0];
}
function newer(a, b) {
  const x = rank(a), y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function current(file) {
  try { const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).packages[0]; return p && p.tivibro; }
  catch (e) { return null; }
}
function write(file) {
  const repo = { paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1 }, packages: [entry] };
  fs.writeFileSync(path.join(dir, file), JSON.stringify(repo, null, 2) + '\n');
  console.log('  ' + file + ' -> ' + entry.tivibro.version);
}
const mine = entry.tivibro;
const testing = current('repo-testing.json');
if (!testing || !newer(testing.version, mine.version)) {
  write('repo-testing.json');
  if (installer) { fs.copyFileSync(installer, path.join(dir, 'install.sh')); console.log('  install.sh -> ' + mine.version); }
}
const stable = current('repo.json');
// Replace repo.json with a full release unless it already has a newer one; with a test build only
// while it holds no full release yet.
if (!stable || (!newer(stable.version, mine.version) && (!mine.prerelease || stable.prerelease))) write('repo.json');
