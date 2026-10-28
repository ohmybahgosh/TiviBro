#!/usr/bin/env node
/* The package version webOS sees for a release tag.
     node scripts/pkg-version.js 0.6.0-alpha.5     ->  0.5.10005
   webOS needs appinfo.json versions to be three numbers, and the Homebrew Channel offers an
   install whenever the repository's version differs from the installed one.  So every build
   needs its own numeric version, and test builds must sort below the release they lead up to:
     X.Y.0            ->  X.Y.0                      (a release keeps its version)
     X.Y.0-alpha.N    ->  X.(Y-1).(10000 + N)
     X.Y.0-beta.N     ->  X.(Y-1).(20000 + N)
     X.Y.0-rc.N       ->  X.(Y-1).(30000 + N)
   (for Y = 0 the line before is (X-1).999).  Test builds are only made for X.Y.0 versions.
   The app itself shows the full tag (TIVIBRO_VERSION), so people still see "0.6.0-alpha.5". */
'use strict';
const KINDS = { alpha: 1, beta: 2, rc: 3 };

function pkgVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(String(v).trim());
  if (!m) throw new Error('Not a version: ' + v + '  (expected X.Y.Z or X.Y.Z-alpha.N / beta.N / rc.N)');
  const [x, y, z] = [+m[1], +m[2], +m[3]];
  if (!m[4]) return x + '.' + y + '.' + z;
  if (!KINDS[m[4]]) throw new Error('Unknown test build kind "' + m[4] + '" (use alpha, beta or rc)');
  if (z !== 0) throw new Error('Test builds are only made for X.Y.0 versions, not ' + v);
  const n = +m[5];
  if (n < 1 || n > 9999) throw new Error('Test build number out of range: ' + n);
  if (x === 0 && y === 0) throw new Error('No version line below 0.0.0 for ' + v);
  const patch = KINDS[m[4]] * 10000 + n;
  return y > 0 ? x + '.' + (y - 1) + '.' + patch : (x - 1) + '.999.' + patch;
}

module.exports = { pkgVersion };
if (require.main === module) {
  try { console.log(pkgVersion(process.argv[2] || '')); }
  catch (e) { console.error(e.message); process.exit(1); }
}
