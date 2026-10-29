/* Homebrew Channel release files: package versions per tag, the manifest and repository entry,
   and which build repo.json and repo-testing.json point at.   node tests/unit/homebrew.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { pkgVersion } = require('../../scripts/pkg-version');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
function ok(cond, name, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : '')); if (!cond) fails++; }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

// Package versions: three numbers, unique, and in release order.
ok(pkgVersion('0.6.0') === '0.6.0', 'a release keeps its version');
ok(pkgVersion('0.6.0-alpha.5') === '0.5.10005', 'alpha 5 of 0.6.0', pkgVersion('0.6.0-alpha.5'));
ok(pkgVersion('v0.6.0-beta.1') === '0.5.20001', 'beta 1, with a v', pkgVersion('v0.6.0-beta.1'));
ok(pkgVersion('0.6.0-rc.2') === '0.5.30002', 'release candidate 2');
ok(pkgVersion('1.0.0-beta.3') === '0.999.20003', 'beta of 1.0.0 goes below 1.0.0', pkgVersion('1.0.0-beta.3'));
ok(throws(() => pkgVersion('0.6.1-alpha.1')), 'no test builds of patch versions');
ok(throws(() => pkgVersion('0.6.0-nightly.1')), 'unknown kind refused');
ok(throws(() => pkgVersion('0.6')), 'malformed refused');
// webOS and the Homebrew Channel compare numerically, part by part.
const num = v => v.split('.').map(Number);
const less = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
const order = ['0.5.3', '0.6.0-alpha.1', '0.6.0-alpha.12', '0.6.0-beta.1', '0.6.0-rc.1', '0.6.0', '0.6.2', '0.7.0-alpha.1', '0.7.0'].map(pkgVersion);
ok(order.every((v, i) => i === 0 || less(order[i - 1], v)), 'package versions sort in release order', order.join(' < '));
ok(order.every(v => /^\d+\.\d+\.\d+$/.test(v)), 'all are three plain numbers');

// Manifest and entry from a fake build, in a copy of the bits gen-manifest reads.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
fs.mkdirSync(path.join(tmp, 'app/js'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'scripts'));
fs.copyFileSync(path.join(ROOT, 'scripts/gen-manifest.js'), path.join(tmp, 'scripts/gen-manifest.js'));
fs.writeFileSync(path.join(tmp, 'app/appinfo.json'), JSON.stringify({ id: 'app.tivibro.tv', version: '0.5.10005', type: 'web', title: 'TiviBro' }));
fs.writeFileSync(path.join(tmp, 'app/js/log.js'), "var TIVIBRO_VERSION = '0.6.0-alpha.5';\n");
const ipk = path.join(tmp, 'app.tivibro.tv_0.5.10005_all.ipk'); fs.writeFileSync(ipk, 'fake ipk');
cp.execFileSync('node', [path.join(tmp, 'scripts/gen-manifest.js'), ipk, path.join(tmp, 'dist'), 'me/TiviBro', 'v0.6.0-alpha.5']);
const man = JSON.parse(fs.readFileSync(path.join(tmp, 'dist/app.tivibro.tv.manifest.json'), 'utf8'));
const entry = JSON.parse(fs.readFileSync(path.join(tmp, 'dist/homebrew-entry.json'), 'utf8'));
ok(man.version === '0.5.10005', 'manifest version is what webOS will report');
ok(man.ipkUrl === 'https://github.com/me/TiviBro/releases/download/v0.6.0-alpha.5/app.tivibro.tv_0.5.10005_all.ipk', 'IPK link is absolute and pinned to the tag', man.ipkUrl);
ok(man.ipkHash.sha256 === require('crypto').createHash('sha256').update('fake ipk').digest('hex'), 'SHA-256 of the IPK');
ok(entry.manifest && entry.manifest.ipkUrl === man.ipkUrl, 'entry carries the manifest (one request for the TV)');
ok(/Test build 0\.6\.0-alpha\.5/.test(entry.shortDescription) && entry.tivibro.prerelease === true, 'entry says it is a test build');
ok(/^https:\/\/raw\.githubusercontent\.com\//.test(entry.iconUri), 'icon from a host TVs can load');
ok(entry.fullDescriptionUrl === 'https://tivibro.app/hb/description.html' && fs.existsSync(path.join(ROOT, 'site/hb/description.html')), 'details page: screenshots and description from the website');
ok(entry.requirements && entry.requirements.webosRelease === '>=4.0', 'requires webOS 4 or newer');

// repo.json / repo-testing.json rules.
const dir = path.join(tmp, 'hb'); fs.mkdirSync(dir);
const mk = (version) => { const f = path.join(tmp, version + '.json'); fs.writeFileSync(f, JSON.stringify({ id: 'app.tivibro.tv', tivibro: { tag: 'v' + version, version, prerelease: /-/.test(version) } })); return f; };
const put = v => cp.execFileSync('node', [path.join(ROOT, 'scripts/update-homebrew-repo.js'), mk(v), dir]);
const has = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).packages[0].tivibro.version; } catch (e) { return null; } };
put('0.6.0-alpha.5');
ok(has('repo.json') === '0.6.0-alpha.5' && has('repo-testing.json') === '0.6.0-alpha.5', 'first build fills both files');
put('0.6.0-alpha.6');
ok(has('repo.json') === '0.6.0-alpha.6', 'with no release yet, repo.json follows test builds');
put('0.6.0');
ok(has('repo.json') === '0.6.0' && has('repo-testing.json') === '0.6.0', 'a release takes both');
put('0.7.0-alpha.1');
ok(has('repo.json') === '0.6.0' && has('repo-testing.json') === '0.7.0-alpha.1', 'later test builds only go to repo-testing.json');
put('0.6.0-alpha.6');
ok(has('repo.json') === '0.6.0' && has('repo-testing.json') === '0.7.0-alpha.1', 're-running an old build changes nothing');
put('0.7.0');
ok(has('repo.json') === '0.7.0' && has('repo-testing.json') === '0.7.0', 'next release takes both again');
const repo = JSON.parse(fs.readFileSync(path.join(dir, 'repo.json'), 'utf8'));
ok(repo.paging && repo.packages.length === 1, 'repository shape the Homebrew Channel reads (paging + packages)');

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all homebrew tests passed');
