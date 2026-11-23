#!/usr/bin/env node
/* What's left to translate into one language, across the TV app, the web editor and the phone app, as one
   file to translate (by hand, by Claude in a session, or by scripts/i18n-fill.js).
     node scripts/i18n-todo.js de > todo.json          what's missing, with the rules and the glossary's words
     node scripts/i18n-todo.js de --count               how many, per part
   Before listing, a text one part already has in this language is copied to the other (the TV's "Guide" is
   the editor's "Guide" too), so only new texts are left.  A variant (es-ES) has nothing of its own to fill:
   its base language does.
   The file: { lang, name, forms, rules, items: [{ key, where, plural, terms }] }.  Translate each key and give
   back { key: translation } (a list of forms where "plural" says so): node scripts/i18n-import.js de done.json */
'use strict';
const L = require('./i18n-lib.js');
const code = process.argv[2], countOnly = process.argv.includes('--count');
const lg = code && L.lang(code);
if (!lg || code === 'en') { console.error('node scripts/i18n-todo.js <' + L.LIST.filter((l) => l.code !== 'en' && !l.from).map((l) => l.code).join('|') + '>'); process.exit(1); }
if (lg.from) { console.error(code + ' is made from ' + lg.from + ': translate ' + lg.from + ', and put ' + code + '\'s own words in app/js/lang/' + code + '.js'); process.exit(1); }

const tvKeys = L.found('tv'), edKeys = L.found('ed');
const tv = L.dict('tv', code), ed = L.dict('ed', code);

// One part's translation for the other part: written straight away (checked like any other).
const toTv = {}, toEd = {};
for (const k of Object.keys(tvKeys)) if (!(k in tv) && k in ed && !L.problem(code, k, ed[k])) toTv[k] = ed[k];
for (const k of Object.keys(edKeys)) if (!(k in ed) && k in tv && !L.problem(code, k, tv[k])) toEd[k] = tv[k];
const reused = L.write('tv', code, toTv) + L.write('ed', code, toEd);
if (reused) console.error('copied ' + reused + ' translations from one part to the other');
Object.assign(tv, toTv); Object.assign(ed, toEd);

const items = {}, g = L.glossary(code), f = L.forms(code);
function add(k, where) {
  if (!items[k]) items[k] = { key: k, where: [], plural: /\{n\}/.test(k) ? f.n : 0 };
  where.forEach((w) => { if (items[k].where.indexOf(w) < 0) items[k].where.push(w); });
}
for (const k of Object.keys(tvKeys)) if (!(k in tv)) add(k, ['tv: ' + tvKeys[k].join(', ')]);
for (const k of Object.keys(edKeys)) if (!(k in ed)) add(k, edKeys[k].map((w) => w === 'editor' ? 'web editor' : w));
// The glossary's own terms first (the rest should use the same words), each text with the words it uses.
const isTerm = (k) => g.terms.indexOf(k) >= 0;
const list = Object.keys(items).sort((a, b) => (isTerm(b) - isTerm(a)) || (a < b ? -1 : 1)).map((k) => {
  const x = items[k], t = L.termsIn(k, g);
  if (isTerm(k)) { x.term = true; if (g.notes[k]) x.note = g.notes[k]; }
  if (Object.keys(t).length) x.terms = t;
  return x;
});

if (countOnly) {
  const tvLeft = Object.keys(tvKeys).filter((k) => !(k in tv)).length, edLeft = Object.keys(edKeys).filter((k) => !(k in ed)).length;
  console.log(lg.english + ': ' + list.length + ' to translate (TV app ' + tvLeft + ' of ' + Object.keys(tvKeys).length + ', editor and phone ' + edLeft + ' of ' + Object.keys(edKeys).length + ')');
  process.exit(0);
}
console.log(JSON.stringify({
  lang: code, name: lg.english,
  forms: { count: f.n, order: f.names, note: 'A text with {n} may be a list of these forms, in this order, each with {n} in it.  A text without {n} is never a list.' },
  rules: [
    'Translate for a TV app and its phone app: short, plain and natural, as the people who use it talk.  Use the glossary\'s words ("terms") for TiviBro\'s own names: the same word every time.',
    'Keep {n}, {x}, {y} and {z} exactly, as many of each as the English has; move them to where they fit the sentence.',
    'Keep HTML tags (<b>, </b>, <a ...>) in the same order around the matching words.',
    'Keep names as they are: TiviBro, Xtream Codes, Stalker, M3U, TMDB, Trakt, YouTube, Dropbox, Google Drive, webOS, EPG and button names on the remote (OK, Red, Green, Yellow, Blue) unless the glossary says otherwise.',
    'Keep the English punctuation style: two spaces after a sentence\'s full stop where the English has two.  Never an em dash.',
    'A text that starts or ends with a space or a punctuation mark is a piece of a longer sentence: keep that space or mark.',
    'Answer with one JSON object: { "English text": "translation", "Text with {n}": ["form", "form"] }.'
  ],
  items: list
}, null, 1));
console.error(list.length + ' texts to translate into ' + lg.english);
