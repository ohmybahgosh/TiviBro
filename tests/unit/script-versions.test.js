/* The packaged app loads each script under a name with its contents' hash: js/log.js is packaged as
   js/log.<hash>.js.  webOS keeps compiled scripts by address in its code cache, and an update
   through the Homebrew Channel doesn't clear it: a file that changed but kept its length (log.js,
   whose version stamp is always as long) went on running the old code, so the app kept offering the
   update it had just installed.  The hash goes in the name, not in a ?query: webOS doesn't keep
   compiled code for local scripts loaded with a query, so every start would compile them all again.
   node tests/unit/script-versions.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { versionScripts } = require('../../scripts/script-versions');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
function ok(cond, name, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + extra : '')); if (!cond) fails++; }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

const files = {
  'js/log.js': "var TIVIBRO_VERSION = '0.6.0-alpha.82';",
  'js/app.js': 'App.start();',
  'vendor/hls.min.js': 'var Hls;'
};
const read = f => { if (!(f in files)) throw new Error('missing ' + f); return files[f]; };
const html = '<head><script src="js/log.js"></script>\n<script src="vendor/hls.min.js"></script></head>' +
  '<body><script src="js/app.js"></script><script src="https://example.invalid/x.js"></script></body>';
const name = (r, f) => { const m = r.renames.filter(x => x[0] === f)[0]; return m && m[1]; };

const a = versionScripts(html, read);
ok(/^js\/log\.[0-9a-f]{10}\.js$/.test(name(a, 'js/log.js')) && /^vendor\/hls\.min\.[0-9a-f]{10}\.js$/.test(name(a, 'vendor/hls.min.js')),
  'each local script gets its hash in its name, before .js', JSON.stringify(a.renames));
ok(a.renames.every(x => a.html.indexOf('src="' + x[1] + '"') > 0) && a.html.indexOf('src="js/log.js"') < 0, 'the page loads the new names', a.html);
ok(a.html.indexOf('?') < 0, 'no query in any address: webOS would not keep their compiled code', a.html);
ok(a.html.indexOf('src="https://example.invalid/x.js"') > 0 && a.renames.length === 3, 'a script from elsewhere is left alone', a.html);
let back = a.html; a.renames.forEach(x => { back = back.replace(x[1], x[0]); });
ok(back === html, 'nothing else in the page changes', back);

// The bug: a release changes log.js but not its length.  The address has to change with it.
files['js/log.js'] = "var TIVIBRO_VERSION = '0.6.0-alpha.83';";
const b = versionScripts(html, read);
ok(name(b, 'js/log.js') !== name(a, 'js/log.js'), 'a file changed at the same length gets a new name', name(a, 'js/log.js') + ' ' + name(b, 'js/log.js'));
ok(name(b, 'js/app.js') === name(a, 'js/app.js'), 'an unchanged file keeps its name, and its compiled copy');

ok(throws(() => versionScripts('<script src="js/gone.js"></script>', read)), 'a script that is not there stops the build');

// However the tag is written, it gets its name, or the build stops: never a script left as it was.
const odd = versionScripts("<SCRIPT SRC='js/log.js'></SCRIPT><script defer src = \"js/app.js\"></script>", read);
ok(odd.renames.length === 2 && odd.html.indexOf("SRC='" + name(odd, 'js/log.js') + "'") > 0 && odd.html.indexOf('src = "' + name(odd, 'js/app.js') + '"') > 0,
  'single quotes, capitals and spaces around = are handled too', odd.html);
ok(throws(() => versionScripts('<script src=js/log.js></script>', read)), 'a src without quotes stops the build');
ok(throws(() => versionScripts('<script src="js/log.js?x=1"></script>', read)) && throws(() => versionScripts('<script src="js/log.js#a"></script>', read)),
  'a src that already has ? or # stops the build');
ok(throws(() => versionScripts('<script src="js/app.js"></script><script src="js/app.js"></script>', read)), 'a script loaded twice stops the build');

// The command build.sh runs on its staged copy of the real app/: every script renamed, every new
// name there, the old names gone, and the page loading only those.
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-sv-'));
fs.cpSync(path.join(ROOT, 'app'), path.join(T, 'app'), { recursive: true });
cp.execFileSync(process.execPath, [path.join(ROOT, 'scripts/script-versions.js'), path.join(T, 'app')]);
const page = fs.readFileSync(path.join(T, 'app/index.html'), 'utf8');
const srcs = (page.match(/<script\b[^>]*\ssrc\s*=\s*["'][^"']+["']/gi) || []).map(s => /["']([^"']+)["']$/.exec(s)[1]);
const orig = (fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8').match(/<script\b[^>]*\ssrc\s*=/gi) || []).length;
ok(srcs.length > 40 && srcs.length === orig, 'the real page still loads every script', srcs.length + ' of ' + orig);
ok(srcs.every(s => /\.[0-9a-f]{10}\.js$/.test(s) && fs.existsSync(path.join(T, 'app', s))), 'each one under its new name, and the file is there', srcs.filter(s => !fs.existsSync(path.join(T, 'app', s))).join(' '));
ok(!fs.existsSync(path.join(T, 'app/js/log.js')) && fs.existsSync(path.join(ROOT, 'app/js/log.js')), 'the copy loses the old names, app/ keeps them');
fs.rmSync(T, { recursive: true, force: true });

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
