#!/usr/bin/env node
/* The English text in the web editor and the phone app that their languages (service/editor/lang/*.js) don't
   have yet.  The TV app has its own check (scripts/i18n-check.js).
     node scripts/i18n-companion.js            how far each language is, editor and phone apart
     node scripts/i18n-companion.js es         the Spanish that's missing, as lines to paste into service/editor/lang/es.js
     node scripts/i18n-companion.js --json     every English text found, with where it is
   What it finds:
     the editor page (service/editor/index.html): its fixed text, as trPage() translates it: each text node, the
       placeholder, title and aria-label attributes, and the blocks marked data-t whole (their HTML, as written);
       in its script, tr('...') and I18n.t('...'); the same in offline.js (the editor on the phone without the TV)
     the name clean-up rules from app/js/names.js (their label and note), which the editor shows through tr()
     the phone app (android/.../*.kt): tr("...")
   Text under data-raw (names) is left out.  Kotlin keys can't hold $ (a template): tr("{n} hidden", "n" to n). */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), ED = path.join(ROOT, 'service', 'editor');
const KT = path.join(ROOT, 'android', 'app', 'src', 'main', 'java');
const LANGS = ['es', 'fr', 'pt-BR', 'ru'];

const found = new Map();      // text -> Set of places
function note(s, where) {
  s = String(s).trim();
  if (!/[A-Za-z]{2}/.test(s)) return;
  if (!found.has(s)) found.set(s, new Set());
  found.get(s).add(where);
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': '\'', nbsp: ' ', apos: '\'' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (a, e) => ENT[e]).replace(/&#(\d+);/g, (a, n) => String.fromCharCode(+n));

/* The editor's fixed text.  A small walk over the tags: each element open (its data-t and data-raw), text between
   them, void and self-closed tags left out of the nesting. */
const VOID = new Set(['br', 'input', 'img', 'meta', 'link', 'hr', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use']);
function editorHtml(src, where) {
  const body = src.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const stack = [], tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let at = 0, m;
  const inRaw = () => stack.some((e) => e.raw), inT = () => stack.some((e) => e.t);
  function text(t) { if (!inRaw() && !inT()) note(decode(t), where); }
  while ((m = tag.exec(body))) {
    if (m.index > at) text(body.slice(at, m.index));
    at = tag.lastIndex;
    const close = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3];
    if (close) {
      let i = stack.length - 1; while (i >= 0 && stack[i].name !== name) i--;
      if (i < 0) continue;
      const e = stack[i]; stack.length = i;
      if (e.t && !inRaw()) note(src.slice(e.from, m.index), where);
      continue;
    }
    const raw = /\sdata-raw\b/.test(attrs), t = /\sdata-t\b/.test(attrs);
    if (!raw && !inRaw()) attrs.replace(/\s(placeholder|title|aria-label)="([^"]*)"/g, (a, k, v) => note(decode(v), where));
    if (!m[4] && !VOID.has(name)) stack.push({ name, raw, t, from: tag.lastIndex });
  }
}
// A JavaScript or Kotlin string literal, unescaped.
const un = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (a, c) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c === 'n' ? '\n' : c));
const LIT = `(?:'((?:[^'\\\\\\n]|\\\\.)*)'|"((?:[^"\\\\\\n]|\\\\.)*)")`;
const lit = (m, i) => un(m[i] != null ? m[i] : m[i + 1]);
function jsCalls(src, where) {
  const rules = [
    [new RegExp(`\\b(?:tr|I18n\\.t)\\(\\s*${LIT}`, 'g'), [1]],
    // tr(n === 1 ? 'one' : 'other', ...): both
    [new RegExp(`\\btr\\(\\s*(?:[^'"()?]|'[^'\\n]*')*?\\?\\s*${LIT}\\s*:\\s*${LIT}`, 'g'), [1, 3]],
    // trn(n, 'one', 'many'): the dictionaries have the second
    [new RegExp(`\\btrn\\(\\s*[^,]+,\\s*${LIT}\\s*,\\s*${LIT}`, 'g'), [3]]
  ];
  for (const [rx, at] of rules) { let m; while ((m = rx.exec(src))) at.forEach((i) => note(lit(m, i), where)); }
  // plural(n, 'group') is '{n} groups'; plural(n, 'copy', 'copies') is '{n} copies'
  const pl = new RegExp(`\\bplural\\(\\s*[^,]+,\\s*${LIT}(?:\\s*,\\s*${LIT})?\\s*\\)`, 'g');
  let m; while ((m = pl.exec(src))) note('{n} ' + (m[3] != null || m[4] != null ? lit(m, 3) : lit(m, 1) + 's'), where);
  // plural(n, g ? 'group' : 'channel') and plural(n, w ? 'West copy' : 'East copy', w ? 'West copies' : 'East copies')
  const pt = new RegExp(`\\bplural\\(\\s*[^,]+,\\s*[^'"?,]*\\?\\s*${LIT}\\s*:\\s*${LIT}(?:\\s*,\\s*[^'"?,]*\\?\\s*${LIT}\\s*:\\s*${LIT})?`, 'g');
  while ((m = pt.exec(src))) {
    if (m[5] != null || m[6] != null) { note('{n} ' + lit(m, 5), where); note('{n} ' + lit(m, 7), where); }
    else { note('{n} ' + lit(m, 1) + 's', where); note('{n} ' + lit(m, 3) + 's', where); }
  }
}
const bad = [];
function ktCalls(src, where) {
  // trn(n, "{n} playlist", "{n} playlists"): the dictionaries have the second
  const rn = /\btrn\(\s*[^,]+,\s*"(?:[^"\\\n]|\\.)*"\s*,\s*"((?:[^"\\\n]|\\.)*)"/g;
  let n; while ((n = rn.exec(src))) note(un(n[1]), where);
  const rx = /\btr\(\s*"((?:[^"\\\n]|\\.)*)"/g;
  let m; while ((m = rx.exec(src))) {
    if (/(^|[^\\])\$[{\w]/.test(m[1])) { bad.push(where + ': ' + m[1]); continue; }
    note(un(m[1]), where);
  }
}

const page = fs.readFileSync(path.join(ED, 'index.html'), 'utf8');
editorHtml(page.slice(page.indexOf('<body')), 'editor');   // the body: trPage() translates that
(page.match(/<script>[\s\S]*?<\/script>/g) || []).forEach((s) => jsCalls(s, 'editor'));
// The name clean-up rules the editor lists from names.js (Names.RULES): their names and notes, through tr() there.
const names = fs.readFileSync(path.join(ROOT, 'app', 'js', 'names.js'), 'utf8');
{ const rx = new RegExp(`\\{\\s*id:\\s*'\\w+',\\s*label:\\s*${LIT}|\\bnote:\\s*${LIT}`, 'g'); let m; while ((m = rx.exec(names))) note(m[1] != null || m[2] != null ? lit(m, 1) : lit(m, 3), 'editor'); }
const offline = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'offline.js');
if (fs.existsSync(offline)) jsCalls(fs.readFileSync(offline, 'utf8'), 'editor');
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.kt') && f !== 'I18n.kt') ktCalls(fs.readFileSync(p, 'utf8'), 'phone ' + f.replace(/\.kt$/, ''));
  }
})(KT);

// The dictionaries, as the editor loads them.
const dicts = {};
global.I18n = { add(code, d) { dicts[code] = Object.assign(dicts[code] || {}, d); }, variant() {} };
for (const l of LANGS) { const f = path.join(ED, 'lang', l + '.js'); if (fs.existsSync(f)) eval(fs.readFileSync(f, 'utf8')); }

const all = [...found.keys()].sort();
const arg = process.argv[2] || '';
if (bad.length) { console.error('tr() with a $ template (use {n}, {x}):\n  ' + bad.join('\n  ')); process.exitCode = 1; }
if (arg === '--json') { console.log(JSON.stringify(Object.fromEntries(all.map((s) => [s, [...found.get(s)]])), null, 1)); process.exit(); }
const has = (code, s) => Object.prototype.hasOwnProperty.call(dicts[code] || {}, s);
if (LANGS.indexOf(arg) >= 0) {
  const miss = all.filter((s) => !has(arg, s));
  miss.forEach((s) => console.log('  ' + JSON.stringify(s) + ': "",   // ' + [...found.get(s)].join(', ')));
  console.error(miss.length + ' of ' + all.length + ' missing in ' + arg);
  process.exit();
}
const ed = all.filter((s) => [...found.get(s)].some((w) => w === 'editor')), ph = all.filter((s) => [...found.get(s)].some((w) => w !== 'editor'));
console.log(all.length + ' texts (editor ' + ed.length + ', phone ' + ph.length + ')');
for (const code of LANGS) {
  const pc = (list) => list.length ? Math.floor(list.filter((s) => has(code, s)).length / list.length * 100) : 100;
  console.log(code + ': editor ' + pc(ed) + '%, phone ' + pc(ph) + '%  (' + all.filter((s) => !has(code, s)).length + ' missing)');
}
