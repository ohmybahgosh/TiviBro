#!/usr/bin/env node
/* One file to hand to an AI assistant (Claude, ChatGPT, Gemini, Cursor...) before working on TiviBro.
     npm run ai                        writes tivibro-for-ai.md in the repository (git-ignored)
     node scripts/gen-ai-context.js <file>
   Built from what is already true in the repository, so it never drifts: docs/ai/GUIDE.md (the rules,
   written by hand), docs/ARCHITECTURE.md, the opening comment of every source file, the settings and
   their defaults (Store's DEFAULTS), the remote actions, npm scripts and tests, the compatibility rules,
   the roadmap and the latest changelog entries.  The website workflow publishes it at
   tivibro.app/ai/tivibro-for-ai.md on every deploy. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'tivibro-for-ai.md'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// The opening comment of a source file, without the comment markers (JS, Kotlin, shell).
function header(file) {
  const s = read(file).replace(/^#![^\n]*\n/, '').replace(/^\s+/, '');
  let text = '';
  const m = /^\/\*([\s\S]*?)\*\//.exec(s);
  if (m) text = m[1];
  else {
    const keep = [];
    for (const l of s.split('\n')) { if (/^\s*(\/\/|#)/.test(l)) keep.push(l.replace(/^\s*(\/\/|#)\s?/, '')); else break; }
    text = keep.join('\n');
  }
  return text.split('\n').map(l => l.replace(/^\s*\*?\s?/, '').trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
}
function files(dir, re) {
  if (!exists(dir)) return [];
  return fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).sort().map(f => path.join(dir, f).replace(/\\/g, '/'));
}
function walk(dir, re, acc) {
  acc = acc || [];
  if (!exists(dir)) return acc;
  for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    const p = path.join(dir, f).replace(/\\/g, '/');
    if (fs.statSync(path.join(ROOT, p)).isDirectory()) walk(p, re, acc); else if (re.test(f)) acc.push(p);
  }
  return acc;
}
function section(md, title) {
  const i = md.indexOf('\n## ' + title);
  if (i < 0) return '';
  const j = md.indexOf('\n## ', i + 4);
  return md.slice(i + 1, j < 0 ? md.length : j).trim();
}
function block(title, list) {
  return '## ' + title + '\n\n' + list.map(f => {
    const h = header(f);
    return '### `' + f + '`\n\n' + (h ? h : '(no opening comment)') + '\n';
  }).join('\n');
}
const demote = (md) => md.replace(/^(#{1,5}) /gm, '#$1 ');

let commit = '';
try { commit = cp.execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
const pkg = JSON.parse(read('package.json'));
const parts = [];

parts.push('# TiviBro knowledge base for AI assistants\n\nGenerated ' + new Date().toISOString().slice(0, 10) + (commit ? ' from commit ' + commit : '') + ' by `scripts/gen-ai-context.js`.  Source: <https://github.com/ohmybahgosh/TiviBro>.  Newest copy: <https://tivibro.app/ai/tivibro-for-ai.md>.\n\nContents: the rules and workflow; the architecture; what every source file does; settings and their defaults; remote actions; scripts and tests; compatibility; the roadmap; recent changes.');
parts.push(read('docs/ai/GUIDE.md').split(/\n---\n/).pop().trim().replace(/^/, '## Rules and workflow\n\n').replace(/\n## /g, '\n### '));
parts.push('## Architecture\n\n' + demote(read('docs/ARCHITECTURE.md').replace(/^# .*\n/, '').trim()));

parts.push(block('The TV app: every file (app/js)', files('app/js', /\.js$/)));
parts.push(block('The network helper: every file (service)', files('service', /\.js$/)));
parts.push('## The web editor\n\n`service/editor/index.html` is the whole editor: HTML, CSS and one inline script.  It loads `names.js`, `tidy.js`, `pubepg.js` and `links.js` (build copies of the `app/js/` files).  Pages are `<section class="page" id="p-NAME">`; `show(name)` switches them.  Changes are drafts sent with `/api/save`; actions go through `command(type, args)` to the TV\'s `RUN` table in `app/js/webedit.js`.');
parts.push(block('The Android app (android)', walk('android/app/src/main/java', /\.kt$/)));
parts.push(block('Build, release and tooling scripts', files('scripts', /\.(js|sh)$/).filter(f => !/_common\.sh$/.test(f)).concat(walk('scripts/wiki', /\.(js|sh)$/), walk('scripts/stats', /\.js$/), walk('scripts/companion', /\.js$/))));
parts.push(block('The relay (Cloudflare Worker)', ['relay/worker.js']));

const store = read('app/js/store.js'), d = /var DEFAULTS = \{[\s\S]*?\n  \};/.exec(store);
parts.push('## Settings and their defaults\n\nFrom `Store` (`app/js/store.js`).  Users change them in `app/js/settings.js`; the user guide documents each one.\n\n```js\n' + (d ? d[0] : '(not found)') + '\n```');
const km = read('app/js/keymap.js'), acts = /var ACTIONS = \{[\s\S]*?\n  \};/.exec(km), ctx = /var CONTEXT_ACTIONS = \{[\s\S]*?\n  \};/.exec(km), defs = /var DEFAULTS = \{[\s\S]*?\n  \};/.exec(km);
parts.push('## Remote buttons and actions\n\nFrom `Keymap` (`app/js/keymap.js`).  `Views.runAction(action, context)` carries them out.\n\n```js\n' + [acts, ctx, defs].map(x => x ? x[0] : '').join('\n\n') + '\n```');

parts.push('## npm scripts\n\n```json\n' + JSON.stringify(pkg.scripts, null, 2) + '\n```');
parts.push('## Tests\n\n- **Unit** (`npm test`): ' + files('tests/unit', /\.(js|mjs)$/).map(f => '`' + f + '`').join(', ') + '.\n- **Soak** (Playwright against `tests/mock/mock_provider.js` and `npm run serve`): ' + files('tests/soak', /\.js$/).map(f => '`' + f + '`').join(', ') + '.\n- **Old engines**: `bash tests/engines/run.sh` (Chromium 53 to 87, Node 0.12 to 12).\n- **Android**: `tests/android/` (a stand-in TV running the real `service/companion.js`).\n- **Real providers** (maintainers only, logins outside the repository): ' + files('tests/real', /\.js$/).map(f => '`' + f + '`').join(', ') + '.');

const compat = read('docs/COMPATIBILITY.md');
parts.push('## Compatibility\n\n' + demote(compat.replace(/^# .*\n/, '').trim()));
if (exists('docs/DECISIONS.md')) parts.push('## Decisions\n\n' + demote(read('docs/DECISIONS.md').replace(/^# .*\n/, '').trim()));
if (exists('docs/ROADMAP.md')) parts.push('## Roadmap\n\n' + demote(read('docs/ROADMAP.md').replace(/^# .*\n/, '').trim()));
if (exists('CONTRIBUTING.md')) parts.push('## Contributing\n\n' + demote(read('CONTRIBUTING.md').replace(/^# .*\n/, '').trim()));
if (exists('.github/PULL_REQUEST_TEMPLATE.md')) parts.push('## Pull request template\n\n' + demote(read('.github/PULL_REQUEST_TEMPLATE.md').trim()));

// The latest three versions of the changelog, headlines only (the full text is long).
const log = read('CHANGELOG.md').split('\n'), recent = [];
let versions = 0;
for (const l of log) {
  if (/^## /.test(l)) { if (++versions > 1 && !/Unreleased/.test(l)) break; recent.push('\n' + l.replace(/^## /, '### ')); continue; }
  if (/^### (New in|In) /.test(l)) { if (recent.filter(x => /^#### /.test(x)).length >= 4) break; recent.push('#### ' + l.replace(/^### /, '')); continue; }
  const b = /^- \*\*(.+?)\*\*/.exec(l);
  if (b && versions) recent.push('- ' + b[1]);
}
parts.push('## Recent changes (headlines; full text in CHANGELOG.md)\n' + recent.join('\n'));

const text = parts.join('\n\n') + '\n';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
console.log('Wrote ' + path.relative(process.cwd(), out) + ': ' + Math.round(text.length / 1024) + ' KB, about ' + Math.round(text.length / 4 / 1000) + 'k tokens');
