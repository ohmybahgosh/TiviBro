/* What the translation scripts share (i18n-todo.js, i18n-import.js, i18n-fill.js, i18n-glossary.js): the
   English texts each part of TiviBro shows, the dictionaries as they stand, the checks a translation must
   pass, and writing translations into the dictionaries.
   Two sets of dictionaries, one key (the English text) each:
     tv   app/js/lang/<code>.js            the TV app            (texts found by scripts/i18n-check.js)
     ed   service/editor/lang/<code>.js    the web editor and the phone app (scripts/i18n-companion.js)
   A text both show is translated once and written into both. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const { LIST, PLURALS } = require('./i18n-langs.js');

const FILES = { tv: (c) => path.join(ROOT, 'app', 'js', 'lang', c + '.js'), ed: (c) => path.join(ROOT, 'service', 'editor', 'lang', c + '.js') };
const lang = (code) => LIST.filter((l) => l.code === code)[0];
// The plural forms a list has in this language, and what each is for.
function forms(code) {
  const n = PLURALS[lang(code).plural];
  return { n, names: n === 3 ? ['one (1, 21, 31...)', 'few (2-4, 22-24...)', 'many (5-20, 25-30...)'] : lang(code).plural === 'one' ? ['one (exactly 1)', 'other'] : ['one (0 and 1)', 'other'] };
}

// Every English text a part shows: { text: [where...] }, as its own check script finds them.
function found(part) {
  const script = part === 'tv' ? 'i18n-check.js' : 'i18n-companion.js';
  return JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, script), '--json'], { maxBuffer: 64 << 20 }).toString());
}
// A dictionary file as it stands: { english: translation or [forms] }.
function dict(part, code) {
  const f = FILES[part](code), d = {};
  if (!fs.existsSync(f)) return d;
  new Function('I18n', fs.readFileSync(f, 'utf8'))({ add(c, x) { Object.assign(d, x); }, variant() {} });
  return d;
}

/* What's wrong with a translation, or '' when it's fine: something there, {n} {x} {y} {z} kept (as many of
   each), the same HTML tags in the same order, a list only where the English has {n} and with this language's
   number of forms, no em dash (TiviBro never uses one), not just the English again for a long text. */
function problem(code, en, v) {
  const want = (en.match(/\{[nxyz]\}/g) || []).sort().join(), tags = (s) => (s.match(/<\/?[a-z][^>]*>/gi) || []).map((t) => t.replace(/\s.*$/, '').toLowerCase()).join();
  const vals = Array.isArray(v) ? v : [v];
  if (Array.isArray(v)) {
    if (!/\{n\}/.test(en)) return 'a list, but the English has no {n}';
    if (v.length !== forms(code).n) return v.length + ' plural forms, ' + forms(code).n + ' wanted';
  } else if (typeof v !== 'string') return 'not text';
  for (const x of vals) {
    if (typeof x !== 'string' || !x.trim()) return 'empty';
    if ((x.match(/\{[nxyz]\}/g) || []).sort().join() !== want) return 'placeholders ' + ((x.match(/\{[nxyz]\}/g) || []).join(' ') || 'none') + ', the English has ' + (want || 'none');
    if (tags(x).replace(/<a/g, '<a') !== tags(en)) return 'HTML tags differ from the English';
    if (/—/.test(x)) return 'an em dash';
  }
  return '';
}

/* Translations into one dictionary file: added before its closing "});", a key already there replaced in
   place.  JSON strings, so the phone app (org.json) reads the editor's files too. */
function write(part, code, entries) {
  const f = FILES[part](code), keys = Object.keys(entries);
  if (!keys.length) return 0;
  let s = fs.readFileSync(f, 'utf8');
  const fresh = [];
  for (const k of keys) {
    const line = JSON.stringify(k) + ': ' + JSON.stringify(entries[k]).replace(/","/g, '", "');
    const at = s.indexOf('\n  ' + JSON.stringify(k) + ': ');
    if (at >= 0) { const end = s.indexOf('\n', at + 1); s = s.slice(0, at + 1) + '  ' + line + (s.slice(at + 1, end).trim().endsWith(',') ? ',' : '') + s.slice(end); }
    else fresh.push(line);
  }
  if (fresh.length) {
    const close = s.lastIndexOf('\n});');
    if (close < 0) throw new Error(path.relative(ROOT, f) + ': no closing });');
    const body = s.slice(0, close).replace(/\s+$/, ''), empty = /\{$/.test(body);
    s = body + (empty ? '\n' : ',\n') + fresh.map((l) => '  ' + l).join(',\n') + s.slice(close);
  }
  // Written beside it, then moved over it: another fill reading every language's file meanwhile never sees half a file.
  fs.writeFileSync(f + '.tmp', s);
  fs.renameSync(f + '.tmp', f);
  return keys.length;
}

// The glossary (i18n/glossary.json): its terms, and this language's word for each from the dictionaries.
const GLOSSARY = path.join(ROOT, 'i18n', 'glossary.json');
function glossary(code) {
  const g = JSON.parse(fs.readFileSync(GLOSSARY, 'utf8')), tv = dict('tv', code), ed = dict('ed', code), words = {};
  g.terms.forEach((t) => { const w = t in tv ? tv[t] : ed[t]; if (typeof w === 'string') words[t] = w; });
  return { terms: g.terms, notes: g.notes || {}, words };
}
// The glossary's terms a text uses (whole words, any case), with this language's word for each it has.
function termsIn(text, g) {
  const out = {};
  for (const t of g.terms) {
    if (t === text || !(t in g.words)) continue;
    if (new RegExp('(^|[^A-Za-z])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z]|$)', 'i').test(text)) out[t] = g.words[t];
  }
  return out;
}

/* Translations into one language, checked and written where each text shows (i18n-import.js, i18n-fill.js): { tv, ed, bad: [{ key, why }], unknown: [key] }.  A variant language (es-ES)
   only has a TV file (the editor copies it), so it all goes there. */
function importAll(code, got, replace) {
  const tvKeys = found('tv'), edKeys = found('ed'), tv = dict('tv', code), ed = dict('ed', code);
  const toTv = {}, toEd = {}, bad = [], unknown = [], variant = !!lang(code).from;
  for (const k of Object.keys(got)) {
    const why = problem(code, k, got[k]);
    if (why) { bad.push({ key: k, why }); continue; }
    const inTv = k in tvKeys, inEd = k in edKeys;
    if (!inTv && !inEd) { unknown.push(k); continue; }
    if ((inTv || variant) && (replace || !(k in tv))) toTv[k] = got[k];
    if (inEd && !variant && (replace || !(k in ed))) toEd[k] = got[k];
  }
  return { tv: write('tv', code, toTv), ed: variant ? 0 : write('ed', code, toEd), bad, unknown };
}

module.exports = { importAll,  ROOT, LIST, lang, forms, found, dict, problem, write, glossary, termsIn, GLOSSARY, FILES };
