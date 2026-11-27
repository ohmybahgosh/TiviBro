#!/usr/bin/env node
/* A new language, everywhere at once: the TV app, the web editor and the phone app.
     node scripts/i18n-add-lang.js de Deutsch German one
     node scripts/i18n-add-lang.js de-AT "Deutsch (Österreich)" "German (Austria)" one --from de
   code, its name in its own language, in English, and its plural rule (scripts/i18n-langs.js lists them:
   one, fr, pt, ru, pl).  --from makes a variant of another language (its own words swapped, I18n.variant).
   It adds the language to i18n/langs.json, writes it into every place that lists languages
   (scripts/i18n-langs.js), and starts its two dictionaries empty: app/js/lang/<code>.js (the TV) and
   service/editor/lang/<code>.js (the editor and the phone).  Then: node scripts/i18n-todo.js <code>. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'i18n', 'langs.json');
const args = process.argv.slice(2), fi = args.indexOf('--from'), from = fi >= 0 ? args.splice(fi, 2)[1] : '';
const [code, name, english, plural] = args;
const { PLURALS } = require('./i18n-langs.js');
if (!code || !name || !english || !PLURALS[plural]) {
  console.error('node scripts/i18n-add-lang.js <code> <its own name> <English name> <' + Object.keys(PLURALS).join('|') + '> [--from <code>]');
  process.exit(1);
}
if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code)) { console.error(code + ': a code like de, or pt-BR'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (j.langs.some((l) => l.code === code)) { console.error(code + ' is already there'); process.exit(1); }
if (from && !j.langs.some((l) => l.code === from && !l.from)) { console.error('--from ' + from + ': not a language here'); process.exit(1); }
j.langs.push(Object.assign({ code, name, english, plural }, from ? { from } : {}));
// One language a line, as the file is written by hand.
fs.writeFileSync(FILE, '{\n  "_about": ' + JSON.stringify(j._about) + ',\n  "langs": [\n' + j.langs.map((l) => '    ' + JSON.stringify(l).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }')).join(',\n') + '\n  ]\n}\n');

// The dictionaries, empty.  A variant starts with its word swaps (I18n.variant) instead.
const forms = PLURALS[plural] === 6 ? '[zero, one, two, few, many, other]' : PLURALS[plural] === 3 ? '[one, few, many]' : '[one, other]';
function start(file, text) { if (fs.existsSync(file)) return console.log('kept ' + path.relative(ROOT, file)); fs.writeFileSync(file, text); console.log('wrote ' + path.relative(ROOT, file)); }
if (from) {
  start(path.join(ROOT, 'app', 'js', 'lang', code + '.js'), '/* ' + name + ': ' + english + ', made from ' + from + ' (lang/' + from + '.js) with these words swapped (whole words, a capital kept),\n' +
    '   then its own translations on top.  The web editor and the phone app use this file too (scripts/build.sh copies it). */\n' +
    "I18n.variant('" + code + "', '" + from + "', [\n], {\n});\n");
} else {
  start(path.join(ROOT, 'app', 'js', 'lang', code + '.js'), '/* ' + name + '.  The English text is the key (app/js/i18n.js); {n} a number, {x} {y} any text.  A list is the\n' +
    '   plural forms of {n}: ' + forms + '.  node scripts/i18n-check.js ' + code + " lists what's still in English. */\nI18n.add('" + code + "', {\n});\n");
  start(path.join(ROOT, 'service', 'editor', 'lang', code + '.js'), '/* ' + name + ' for the web editor and the TiviBro phone app (the TV app has its own, app/js/lang).  The English text\n' +
    '   is the key (I18n, app/js/i18n.js); {n} a number, {x} {y} {z} any text; a list is the plural forms of {n}: ' + forms + '.\n' +
    '   Plain JSON inside I18n.add (double quotes, no comments, no trailing comma): the phone app reads it as JSON.\n' +
    '   node scripts/i18n-companion.js ' + code + ' lists what is still in English. */\n' + "I18n.add('" + code + "', {\n});\n");
}
cp.execFileSync(process.execPath, [path.join(__dirname, 'i18n-langs.js')], { stdio: 'inherit' });
cp.execFileSync('bash', [path.join(__dirname, 'build.sh')], { stdio: 'ignore' });
console.log('\n' + english + ' added.  Next: node scripts/i18n-todo.js ' + (from || code) + ' > todo.json, translate it, node scripts/i18n-import.js ' + (from ? code : code) + ' done.json');
