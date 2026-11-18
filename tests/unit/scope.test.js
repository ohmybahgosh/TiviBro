/* A function called in one module of a file but declared only inside another module of the same file (views.js holds
   Views and Guide): it works in one and stops the other with "x is not defined".  Alpha 164 opened no playlist
   ("numLen is not defined" in the guide), and the guide's Show or hide channels menu had the same fault
   (noGuideHide).  node --check and the unit tests never ran that path. */
'use strict';
const fs = require('fs'), path = require('path'), acorn = require('acorn');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info ? '  ' + info : '')); } };
function walk(n, f, parent) {
  if (!n || typeof n.type !== 'string') return;
  f(n, parent);
  for (const k in n) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, f, n)); else if (v && typeof v.type === 'string') walk(v, f, n); }
}
const dir = path.join(__dirname, '..', '..', 'app', 'js');
const found = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  let ast; try { ast = acorn.parse(fs.readFileSync(path.join(dir, file), 'utf8'), { ecmaVersion: 2020 }); } catch (e) { continue; }
  const topNames = new Set(), mods = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration') topNames.add(n.id.name);
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => {
      if (d.id.type === 'Identifier') topNames.add(d.id.name);
      const init = d.init; const fn = init && init.type === 'CallExpression' && (init.callee.type === 'FunctionExpression' ? init.callee : null);
      if (fn) mods.push({ name: d.id.name, body: fn });
    });
  }
  if (mods.length < 2) continue;
  mods.forEach((m) => { m.decl = new Set(); walk(m.body, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) m.decl.add(n.id.name);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') m.decl.add(n.id.name);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') && n.params) n.params.forEach((p) => p.type === 'Identifier' && m.decl.add(p.name));
    if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') m.decl.add(n.param.name);
  }); });
  mods.forEach((m) => walk(m.body, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return;
    const nm = n.callee.name;
    if (m.decl.has(nm) || topNames.has(nm)) return;
    const other = mods.find((o) => o !== m && o.decl.has(nm));
    if (other) found.push(file + ': ' + m.name + ' calls ' + nm + '(), declared only in ' + other.name);
  }));
}
ok('no module calls a function declared only in another module of the same file', !found.length, found.join('; '));
if (fail) { console.log(fail + ' scope test(s) failed'); process.exit(1); }
console.log('all scope tests passed');
