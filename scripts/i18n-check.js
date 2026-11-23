#!/usr/bin/env node
/* The English text in the app that the languages (app/js/lang/*.js) don't have yet.
     node scripts/i18n-check.js            how far each language is, by file
     node scripts/i18n-check.js es         the Spanish that's missing, as lines to paste into app/js/lang/es.js
     node scripts/i18n-check.js --json     every English text found, with the files it's in
   It finds the text the way the app shows it: Settings rows (toggle, choice, action, page, head, info),
   menu rows ({ label, sub }), titles of menus, boxes and questions, toasts and the bottom hints.  Text
   put together from pieces ('Stopped following the ' + name) isn't found; the dictionaries cover those
   with patterns ('Stopped following the {x}'), which this doesn't count. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), APP = path.join(ROOT, 'app', 'js');
const arg = process.argv[2] || '';

// A JavaScript string literal ('...' or "..."), unescaped.
const STR = `(?:'((?:[^'\\\\\\n]|\\\\.)*)'|"((?:[^"\\\\\\n]|\\\\.)*)")`;
const un = (m1, m2) => (m1 != null ? m1 : m2).replace(/\\(.)/g, (a, c) => (c === 'n' ? '\n' : c));
const RULES = [
  // Settings and the tour: the label, and the line under it.
  new RegExp(`\\b(?:toggle|choice|action|page|tvOnly\\(action|phoneDoes\\('\\w+', action)\\(\\s*${STR}(?:\\s*,\\s*${STR})?`, 'g'),
  new RegExp(`\\b(?:head|info)\\(\\s*${STR}`, 'g'),
  new RegExp(`\\b(?:label|sub|title|hint|empty)\\s*:\\s*${STR}`, 'g'),
  new RegExp(`\\b(?:U|UI)\\.(?:toast|menu|confirm|prompt|panel|pin|notify)\\(\\s*${STR}(?:\\s*,\\s*${STR})?`, 'g'),
  new RegExp(`\\bI18n\\.t\\(\\s*${STR}`, 'g'),
  new RegExp(`\\bT\\(\\s*${STR}`, 'g'),           // the local I18n.t shorthand several files define
  // webedit.js's messages and errors for the editor and the phone, translated as they're sent (I18n.msg, I18n.say)
  new RegExp(`\\b(?:M|fail)\\(\\s*${STR}`, 'g'),
  new RegExp(`\\bMN\\([^,]+,\\s*${STR}\\s*,\\s*${STR}`, 'g'),
  new RegExp(`\\[\\s*'[a-z]*'\\s*,\\s*${STR}\\s*\\]`, 'g'),       // hints: ['ok', 'Play']
  new RegExp(`\\btel\\(\\s*'[a-z]+'\\s*,\\s*'[^']*'\\s*,\\s*${STR}`, 'g')            // tel('div', 'cls', 'Words'): the pages' own elements
];
// choice(label, sub, values, ['3 hours', '6 hours'], ...): the names of the choices.
const CHOICE_LABELS = /\bchoice\([^;]*?\],\s*\[((?:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,?)+)\]/g;

// Names and codes that are the same in every language: brands, leagues, formats, a provider's "EN -" prefix.
const SAME = ['TiviBro', 'YouTube', 'Dropbox', 'Google Drive', 'Trakt', 'TMDB  ·', 'Trakt  ·', 'HLS', 'MPEG-TS', 'NBA', 'NFL', 'NHL', 'MLB', 'MLS', 'WNBA', 'EN -'];
function keep(s) {
  s = s.trim();
  if (!/[A-Za-z]{2}/.test(s)) return false;                 // symbols, numbers, "›"
  if (/^[a-z][a-zA-Z0-9]*$/.test(s)) return false;         // identifiers: 'guide', 'ok'
  if (/^(https?:|\/|#|\.|[a-z]+:\/\/)/.test(s)) return false;
  if (/^[\w-]+\.(js|json|png|svg|html|css)$/.test(s)) return false;
  if (/^[a-z0-9]+(-[a-z0-9]*)+$|^[a-z-]+:$/.test(s)) return false;      // CSS classes and key names: 'focus-ring', 'long:'
  if (SAME.indexOf(s) >= 0) return false;                               // names that stay as they are in every language
  return true;
}
const found = new Map();
function note(s, file) { s = s.trim(); if (!keep(s)) return; if (!found.has(s)) found.set(s, new Set()); found.get(s).add(file); }
const files = fs.readdirSync(APP).filter((f) => f.endsWith('.js') && f !== 'i18n.js');
for (const f of files) {
  const src = fs.readFileSync(path.join(APP, f), 'utf8');
  for (const rx of RULES) {
    rx.lastIndex = 0; let m;
    while ((m = rx.exec(src))) for (let i = 1; i < m.length; i += 2) if (m[i] != null || m[i + 1] != null) note(un(m[i], m[i + 1]), f);
  }
  CHOICE_LABELS.lastIndex = 0; let c;
  while ((c = CHOICE_LABELS.exec(src))) { const lit = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g; let x; while ((x = lit.exec(c[1]))) note(un(x[1], x[2]), f); }
  // The side menu's names.
  const tabs = /TAB_LABELS = \{([^}]*)\}/.exec(src);
  if (tabs) tabs[1].replace(/'([^']+)'/g, (a, s) => (/ |^[A-Z]/.test(s) ? note(s, f) : 0));
}
// Fixed titles in index.html.
const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
html.replace(/>([^<>]*[A-Za-z][^<>]*)</g, (a, s) => { s.split(/<br>/).forEach((x) => note(x.replace(/\s+/g, ' '), 'index.html')); return a; });

// The dictionaries.
global.window = global;
const dicts = {};
global.I18n = { add(code, d) { dicts[code] = Object.assign(dicts[code] || {}, d); } };
// The languages with dictionaries of their own (i18n/langs.json; a variant like es-ES is made from es).
const BASES = require('./i18n-langs.js').LIST.filter((l) => l.code !== 'en' && !l.from).map((l) => l.code);
for (const l of BASES) { const f = path.join(APP, 'lang', l + '.js'); if (fs.existsSync(f)) eval(fs.readFileSync(f, 'utf8')); }
// Covered: the text is a key.  (Patterns, '{n} hours', are for text put together while the app runs, and
// would match text found here only by chance.)
/* Text put together from a piece and a value ('Hidden (' + n + ')') is covered by a pattern that starts with that
   piece ("Hidden ({n})"): the app translates the whole text with it while it runs. */
function covered(d, s) {
  if (Object.prototype.hasOwnProperty.call(d, s)) return true;
  if (!/[(#"]$|\s$|\b(of|to|for|as|at|with)$/.test(s)) return false;
  return Object.keys(d).some((k) => k.indexOf(s) === 0 && /\{[nxyz]\}/.test(k.slice(s.length, s.length + 4)));
}

const all = [...found.keys()].sort();
// Written whole before exiting (a pipe takes it in pieces: process.exit right after console.log cut it short).
if (arg === '--json') { process.stdout.write(JSON.stringify(Object.fromEntries(all.map((s) => [s, [...found.get(s)]])), null, 1) + '\n', () => process.exit(0)); return; }
if (dicts[arg]) {
  const miss = all.filter((s) => !covered(dicts[arg], s));
  miss.forEach((s) => console.log('  ' + JSON.stringify(s) + ': \'\',   // ' + [...found.get(s)].join(', ')));
  console.error(miss.length + ' of ' + all.length + ' missing in ' + arg);
  process.exit(0);
}
console.log(all.length + ' texts in the app');
for (const code of Object.keys(dicts).sort()) {
  const d = dicts[code], have = all.filter((s) => covered(d, s)).length;
  const byFile = {};
  all.forEach((s) => { if (!covered(d, s)) [...found.get(s)].forEach((f) => { byFile[f] = (byFile[f] || 0) + 1; }); });
  console.log(`${code}: ${have} of ${all.length} (${Math.round(have / all.length * 100)}%)  missing most in: ` +
    Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => f + ' ' + n).join(', '));
}
