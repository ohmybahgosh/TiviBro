#!/usr/bin/env node
/* TiviBro's languages, from one list (i18n/langs.json) into every place that needs it.
     node scripts/i18n-langs.js            writes them
     node scripts/i18n-langs.js --check    says what is out of step, and fails (tests/unit/i18n.test.js runs it)
   Where they go:
     app/js/i18n.js                 LANGS (code, own name, English name) and PLURAL (each one's plural rule)
     app/index.html                 each dictionary's file for I18n.boot, which loads only the one in use
     service/editor.js              the dictionaries the helper serves to the web editor
     service/editor/index.html      which variant loads which language first
     scripts/build.sh               the variants' files copied into the editor (the TV's word swaps)
     android/.../I18n.kt            the phone app's LANGS, VARIANTS and PLURAL
     android/.../locales_config.xml the languages Android 13 and later offer for the app
   The node scripts (i18n-check.js, i18n-companion.js, the tests) read i18n/langs.json themselves.

   Plural rules (CLDR, the forms a dictionary's list has, in order):
     one  2 forms: n is 1, else the other (English, Spanish, German, Italian, Dutch, Turkish...)
     fr   2 forms: 0 and 1 (and 1.5) singular (French)
     pt   2 forms: 0 and 1 singular (Portuguese)
     fr   is also Hindi's rule (0 and 1 singular)
     ru   3 forms: one (1, 21), few (2-4, 22-24), many (5-20, 25...) (Russian, Ukrainian, Croatian)
     pl   3 forms: one (only 1), few (2-4, 22-24 but not 12-14), many (the rest) (Polish)
     ar   6 forms: zero (0), one (1), two (2), few (3-10, 103-110...), many (11-99, 111-199...), other (100-102...) (Arabic) */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const LIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'langs.json'), 'utf8')).langs;
const PLURALS = { one: 2, fr: 2, pt: 2, ru: 3, pl: 3, ar: 6 };
const KT = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'app', 'tivibro', 'phone', 'I18n.kt');
const XML = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'xml', 'locales_config.xml');

for (const l of LIST) {
  if (!PLURALS[l.plural]) throw new Error(l.code + ': unknown plural rule ' + l.plural + ' (one of ' + Object.keys(PLURALS).join(', ') + ')');
  if (l.from && !LIST.some((x) => x.code === l.from && !x.from)) throw new Error(l.code + ': made from ' + l.from + ', which is not a language here');
}
const dicts = LIST.filter((l) => l.code !== 'en');                // every file under lang/, a language before its variants
const variants = LIST.filter((l) => l.from);
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const kq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Between two marker lines (kept), the new lines; the indent is the begin marker's.
function between(src, begin, end, lines, file) {
  const a = src.indexOf(begin), b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(file + ': markers ' + begin.trim() + ' / ' + end.trim() + ' not found');
  const from = src.indexOf('\n', a) + 1, lineStart = src.lastIndexOf('\n', b) + 1;
  return src.slice(0, from) + lines.map((x) => x + '\n').join('') + src.slice(lineStart);
}
const indent = (src, marker) => { const i = src.indexOf(marker); return src.slice(src.lastIndexOf('\n', i) + 1, i); };

const jobs = [
  ['app/js/i18n.js', (s) => {
    const p = indent(s, '// langs:begin');
    return between(s, '// langs:begin', '// langs:end', [
      p + '// code, name in its own language, name in English (from i18n/langs.json by scripts/i18n-langs.js)',
      p + 'var LANGS = [' + LIST.map((l) => '[' + [l.code, l.name, l.english].map(q).join(', ') + ']').join(', ') + '];',
      p + '// Each one\'s plural rule (see plural below), and the ones made from another (variant)',
      p + 'var PLURAL = { ' + LIST.map((l) => q(l.code) + ': ' + q(l.plural)).join(', ') + ' };',
      p + 'var FROM = { ' + variants.map((l) => q(l.code) + ': ' + q(l.from)).join(', ') + ' };'
    ], 'app/js/i18n.js');
  }],
  // Only the language in use is loaded (I18n.boot, I18n.load): each file by name, renamed with its hash by the build.
  ['app/index.html', (s) => between(s, '<!-- langs:begin', '<!-- langs:end', ['<script src="js/lang/keys.js"></script>',
    '<script>I18n.boot({ ' + dicts.map((l) => q(l.code) + ': \'js/lang/' + l.code + '.js\'').join(', ') + ' });</script>'], 'app/index.html')],
  ['service/editor.js', (s) => between(s, '// langs:begin', '// langs:end',
    [indent(s, '// langs:begin') + '[' + dicts.map((l) => q(l.code)).join(', ') + '].forEach(function (l) { STATIC[\'/lang/\' + l + \'.js\'] = [\'lang/\' + l + \'.js\', \'application/javascript; charset=utf-8\']; });'], 'service/editor.js')],
  ['service/editor/index.html', (s) => between(s, '// langs:begin', '// langs:end',
    [indent(s, '// langs:begin') + 'var from = { ' + variants.map((l) => q(l.code) + ': ' + q(l.from)).join(', ') + ' }[l];'], 'service/editor/index.html')],
  ['scripts/build.sh', (s) => between(s, '# langs:begin', '# langs:end',
    variants.length ? ['cp ' + variants.map((l) => '"$ROOT/app/js/lang/' + l.code + '.js"').join(' ') + ' "$ROOT/service/editor/lang/"'] : [], 'scripts/build.sh')],
  [path.relative(ROOT, KT), (s) => {
    const p = indent(s, '// langs:begin');
    return between(s, '// langs:begin', '// langs:end', [
      p + '/** The languages TiviBro has, as the TV and the web editor name them (i18n/langs.json, by scripts/i18n-langs.js). */',
      p + 'val LANGS = listOf(' + LIST.map((l) => kq(l.code)).join(', ') + ')',
      p + '/** Languages made from another one with their own words swapped (I18n.variant in the files). */',
      p + 'val VARIANTS = mapOf(' + variants.map((l) => kq(l.code) + ' to ' + kq(l.from)).join(', ') + ')',
      p + '/** Each one\'s plural rule (see [plural]). */',
      p + 'val PLURAL = mapOf(' + LIST.map((l) => kq(l.code) + ' to ' + kq(l.plural)).join(', ') + ')'
    ], path.relative(ROOT, KT));
  }],
  [path.relative(ROOT, XML), () => ['<?xml version="1.0" encoding="utf-8"?>',
    '<!-- The languages TiviBro has (I18n.kt), from i18n/langs.json by scripts/i18n-langs.js: Android 13 and later list',
    '     them under the app\'s own language in the phone\'s settings. -->',
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">']
    .concat(LIST.map((l) => '    <locale android:name="' + l.code + '" />'), ['</locale-config>', '']).join('\n')]
];

module.exports = { LIST, PLURALS, dicts, variants };
if (require.main === module) {
const check = process.argv.includes('--check'), stale = [];
for (const [rel, make] of jobs) {
  const file = path.join(ROOT, rel), was = fs.readFileSync(file, 'utf8'), now = make(was);
  if (now === was) continue;
  if (check) stale.push(rel); else { fs.writeFileSync(file, now); console.log('wrote ' + rel); }
}
if (check && stale.length) { console.error('Out of step with i18n/langs.json (run node scripts/i18n-langs.js): ' + stale.join(', ')); process.exit(1); }
if (check) console.log('languages in step: ' + LIST.map((l) => l.code).join(' '));
}
