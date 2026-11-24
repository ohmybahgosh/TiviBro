#!/usr/bin/env node
/* Translations into one language, checked and written where each text is shown.
     node scripts/i18n-import.js de done.json            { "English text": "translation" or [forms] }
     node scripts/i18n-import.js de done.json --replace  also change texts already translated (a fix)
   Each translation is checked (scripts/i18n-lib.js problem: placeholders, HTML tags, plural forms, no em
   dash) and goes into the TV's dictionary, the editor's and phone's, or both, by where the English text is
   shown now.  What fails is listed and left out, so it can be fixed and imported again. */
'use strict';
const fs = require('fs');
const L = require('./i18n-lib.js');
const [code, file] = process.argv.slice(2), replace = process.argv.includes('--replace');
const lg = code && L.lang(code);
if (!lg || !file || code === 'en') { console.error('node scripts/i18n-import.js <code> <translations.json> [--replace]'); process.exit(1); }
const got = JSON.parse(fs.readFileSync(file, 'utf8'));
const res = L.importAll(code, got, replace);
console.log('TV app ' + res.tv + ', editor and phone ' + res.ed + ' written' + (res.unknown.length ? ', ' + res.unknown.length + ' not shown anywhere now (left out)' : '') + (res.bad.length ? ', ' + res.bad.length + ' with problems (left out):' : ''));
res.bad.forEach((b) => console.log('  ' + JSON.stringify(b.key).slice(0, 90) + ': ' + b.why));
// The list of texts for I18n.known (app/js/lang/keys.js) follows the dictionaries' patterns.
cp_keys();
function cp_keys() { require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, 'i18n-keys.js')], { stdio: 'inherit' }); }
process.exitCode = res.bad.length ? 1 : 0;
