#!/usr/bin/env node
/* Package each script the app loads under a name with its contents' hash:  js/log.js -> js/log.<hash>.js.
     node scripts/script-versions.js <app folder>   (build.sh and test-build.sh run it on a copy of app/)
   webOS keeps compiled scripts in a code cache, by address, and an update through the Homebrew
   Channel doesn't clear it.  A cached copy counts as current when the file is no newer than the copy
   (the copy is rewritten every time the app runs, and a release is built before it is installed)
   and V8 only checks it against the file's length.  So a file that changed but kept its length went
   on running the old code: log.js, whose version stamp is the same length every release, kept saying
   the previous version, and the app offered the update it had just installed, again and again.
   A changed file now gets a new name and is compiled again; an unchanged one keeps its name and its
   compiled copy.  The hash goes in the name, not in a ?query: webOS doesn't keep compiled code for a
   local script loaded with a query (CodeCacheFromFileURIsWithQueryStringDisallowed), so each start
   would compile every script again.
   Scripts from elsewhere (http:, https:, //) are left alone.  Anything else stops the build rather
   than ship a script under its old name: a script that isn't there, a src without quotes, a src that
   already has ? or #, or one script loaded twice. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// The page with each local script under its new name, and the [old, new] names to rename.
function versionScripts(html, read) {
  const tags = (html.match(/<script\b[^>]*\ssrc\s*=/gi) || []).length;
  const renames = [];
  let seen = 0;
  const out = html.replace(/(<script\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi, function (all, pre, q, src) {
    seen++;
    if (/^([a-z]+:)?\/\//i.test(src)) return all;
    if (/[?#]/.test(src)) throw new Error('index.html: ' + src + ' has ? or #; load it by its plain path');
    if (!/\.js$/.test(src)) throw new Error('index.html: ' + src + ' does not end in .js');
    if (renames.some(r => r[0] === src)) throw new Error('index.html loads ' + src + ' twice');
    const v = crypto.createHash('sha1').update(read(src)).digest('hex').slice(0, 10);
    const to = src.replace(/\.js$/, '.' + v + '.js');
    renames.push([src, to]);
    return pre + q + to + q;
  });
  if (seen !== tags) throw new Error('index.html has a script tag whose src is not in quotes; it would keep its old name');
  return { html: out, renames: renames };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node scripts/script-versions.js <app folder>'); process.exit(2); }
  const page = path.join(dir, 'index.html');
  const r = versionScripts(fs.readFileSync(page, 'utf8'), f => fs.readFileSync(path.join(dir, f)));
  r.renames.forEach(x => fs.renameSync(path.join(dir, x[0]), path.join(dir, x[1])));
  fs.writeFileSync(page, r.html);
}

module.exports = { versionScripts };
