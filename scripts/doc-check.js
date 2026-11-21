/* Comment check: every function of 20 lines or more should say what it does, in a comment right above it (or on
   its first line), so people new to the code can find their way.  Older code doesn't all do that yet, so this
   only stops it getting worse: scripts/doc-baseline.json holds how many such functions each file has today, and
   lint fails when a file has more.  When you comment old ones, run with --update to lower the numbers.

     node scripts/doc-check.js            check (lint runs this)
     node scripts/doc-check.js --list     every uncommented function of 20+ lines, longest first
     node scripts/doc-check.js --update   write today's numbers into the baseline (only ever lower them) */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = path.join(__dirname, 'doc-baseline.json');
const MIN = 20;
let acorn; try { acorn = require('acorn'); } catch (e) { console.log('doc-check: acorn is not installed (npm install), skipped'); process.exit(0); }

function files() {
  const out = [];
  for (const d of ['app/js', 'service']) for (const f of fs.readdirSync(path.join(ROOT, d))) if (/\.js$/.test(f)) out.push(d + '/' + f);
  return out.sort();
}
// The functions of MIN lines or more in one file with no comment ending on the line above, or on their first line.
function bare(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8'), lines = src.split('\n'), comments = [];
  let ast;
  for (const sourceType of ['script', 'module']) {
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, locations: true, onComment: comments, allowHashBang: true, allowReturnOutsideFunction: true }); break; } catch (e) { comments.length = 0; }
  }
  if (!ast) return [];
  const ends = new Set(comments.map(c => c.loc.end.line)), out = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration') {
      const l = node.loc.start.line, len = node.loc.end.line - l + 1;
      if (len >= MIN && !ends.has(l - 1) && !ends.has(l) && !/\/[/*]/.test(lines[l - 1])) out.push({ name: node.id.name, line: l, len });
    }
    for (const k in node) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return out;
}

const now = {}, found = {};
for (const f of files()) { const b = bare(f); found[f] = b; if (b.length) now[f] = b.length; }
const arg = process.argv[2];
if (arg === '--list') {
  const all = [];
  for (const f in found) for (const x of found[f]) all.push(Object.assign({ f }, x));
  all.sort((a, b) => b.len - a.len).forEach(x => console.log(x.f + ':' + x.line + '  ' + x.name + '  (' + x.len + ' lines)'));
  console.log(all.length + ' functions of ' + MIN + '+ lines without a comment');
  process.exit(0);
}
let base = {}; try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (e) {}
if (arg === '--update') {
  const next = {};
  for (const f in now) next[f] = base[f] === undefined ? now[f] : Math.min(base[f], now[f]);
  fs.writeFileSync(BASE, JSON.stringify(next, null, 1) + '\n');
  console.log('doc-baseline.json: ' + Object.values(next).reduce((a, b) => a + b, 0) + ' functions left to comment');
  process.exit(0);
}
let bad = 0;
for (const f in now) {
  const allowed = base[f] || 0;
  if (now[f] > allowed) {
    bad = 1;
    const names = found[f].map(x => x.name + ' (line ' + x.line + ')').join(', ');
    console.error(f + ': ' + now[f] + ' functions of ' + MIN + '+ lines without a comment (at most ' + allowed + ').  Add a comment above the new one: what it does, and anything a reader wouldn\'t guess.  Candidates: ' + names);
  }
}
process.exit(bad);
