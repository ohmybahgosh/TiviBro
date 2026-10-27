// Compatibility across webOS versions: syntax, APIs and the shims in app/js/compat.js and service/compat.js.
//   webOS TV:   4.x  5.x  6.x  22  23  24  25   26
//   Chromium:    53   68   79  87  94 108 120  132
//   Node (svc): 0.12 8.12 8.12 12  12  16  16   20
// The app must run on Chromium 53 and the helper on Node 0.12, so both are checked at those levels.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const acorn = require('acorn');
const ROOT = path.join(__dirname, '..', '..');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const files = d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js')).map(f => path.join(d, f));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

function parses(file, ecmaVersion) {
  try { acorn.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'), { ecmaVersion, sourceType: 'script' }); return null; }
  catch (e) { return e.message; }
}

// Syntax: app at ES2015 (Chromium 53 has no async/await, object spread or optional chaining),
// helper at ES5 (Node 0.12 has no let, const or arrow functions).
files('app/js').forEach(f => { const e = parses(f, 2015); ok('Chromium 53 can parse ' + f, !e, e); });
files('service').forEach(f => { const e = parses(f, 5); ok('Node 0.12 can parse ' + f, !e, e); });

// APIs missing on the oldest supported engines, unless guarded with typeof/window checks.
const APP_BANNED = [
  [/\.(flat|flatMap|matchAll|replaceAll|trimStart|trimEnd|at|padStart|padEnd|toggleAttribute|prepend|append|replaceChildren)\(/, 'Chromium 53'],
  [/Object\.(values|entries|fromEntries|hasOwn)\(/, 'Chromium 53'],
  [/\b(globalThis|queueMicrotask|structuredClone|ResizeObserver|WeakRef)\b/, 'Chromium 53'],
  [/Promise\.(allSettled|any)\(/, 'Chromium 53'],
  [/new AbortController\(/, 'Chromium 53 (guard with typeof AbortController)'],
  [/new DecompressionStream\(/, 'Chromium 79 (guard with typeof DecompressionStream)']
];
files('app/js').filter(f => !/compat\.js$/.test(f)).forEach(f => {
  const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  src.split('\n').forEach((line, i) => {
    APP_BANNED.forEach(([re, eng]) => {
      const m = re.exec(line), name = m && /new (\w+)\(/.exec(m[0]);
      if (name && src.indexOf('typeof ' + name[1]) >= 0) return;          // guarded somewhere in the file
      if (m && !/typeof|window\.\w+\s*\?|\?\s*new/.test(line)) ok(f + ':' + (i + 1) + ' uses an API missing on ' + eng, false, line.trim().slice(0, 100));
    });
  });
});
const SVC_BANNED = /\.(includes|startsWith|endsWith|repeat|padStart|find|findIndex|fill|flat|writableEnded)\b|Array\.from|new (Map|Set|WeakMap|Proxy|URL)\b|Symbol\.|Object\.(values|entries)|fs\.promises|\bpipeline\(|\bBuffer\.alloc/;
files('service').filter(f => !/compat\.js$/.test(f)).forEach(f => {
  strip(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n').forEach((line, i) => {
    const m = SVC_BANNED.exec(line);
    if (m && !/!res\.writableEnded && !res\.finished/.test(line)) ok(f + ':' + (i + 1) + ' uses ' + m[0] + ', missing on Node 0.12', false, line.trim().slice(0, 100));
  });
});
const proxySrc = fs.readFileSync(path.join(ROOT, 'service/proxy.js'), 'utf8'), editorSrc = fs.readFileSync(path.join(ROOT, 'service/editor.js'), 'utf8');
ok('proxy.js loads the Node shims first', proxySrc.indexOf("require('./compat')") >= 0 && proxySrc.indexOf("require('./compat')") < proxySrc.indexOf("require('http')"));
ok('editor.js loads the Node shims first', editorSrc.indexOf("require('./compat')") >= 0 && editorSrc.indexOf("require('./compat')") < editorSrc.indexOf("require('crypto')"));

// Helper shims: remove the modern built-ins, load compat.js, and use what it puts back.
const shim = cp.spawnSync(process.execPath, ['-e', `
  const crypto = require('crypto');
  const from = Buffer.from; delete Object.assign; delete crypto.timingSafeEqual;
  require(${JSON.stringify(path.join(ROOT, 'service/compat.js'))});
  const a = Object.assign({ x: 1 }, null, { y: 2 }, { x: 3 });
  const b = Buffer.from('aGk=', 'base64').toString(), c = Buffer.from('hi').toString('hex');
  const eq = crypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abc')), ne = crypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abd'));
  console.log(JSON.stringify({ a, b, c, eq, ne, kept: Buffer.from === from }));`], { encoding: 'utf8' });
let r = {}; try { r = JSON.parse(shim.stdout); } catch (e) { r = { err: shim.stderr }; }
ok('Object.assign shim', r.a && r.a.x === 3 && r.a.y === 2, JSON.stringify(r.a || r.err));
ok('Buffer.from left alone where Node has it', r.kept === true && r.b === 'hi' && r.c === '6869');
ok('timingSafeEqual shim', r.eq === true && r.ne === false);

// App shims: Promise.prototype.finally.
const vm = require('vm');
const sandbox = { Promise: Promise, document: { documentElement: { className: '', appendChild() {}, removeChild() {} }, createElement() { return { style: {}, appendChild(x) { return x; }, scrollHeight: 2 }; } } };
const saved = Promise.prototype.finally;
delete Promise.prototype.finally;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app/js/compat.js'), 'utf8'), sandbox);
const polyfilled = typeof Promise.prototype.finally === 'function' && Promise.prototype.finally !== saved;
ok('compat.js adds Promise.prototype.finally when missing', polyfilled);
ok('compat.js marks <html class="nogap"> when flex gap does not work', /\bnogap\b/.test(sandbox.document.documentElement.className));
let order = [];
Promise.resolve(5).finally(() => order.push('f')).then(v => order.push(v))
  .then(() => Promise.reject(new Error('x')).finally(() => order.push('g')))
  .catch(e => order.push(e.message))
  .then(() => {
    ok('finally polyfill keeps the value and the error', order.join(',') === 'f,5,g,x', order.join(','));
    Promise.prototype.finally = saved;

    // Generated fallback for flex gap is current, and the app loads it with compat.js before anything else.
    const chk = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-nogap.js'), '--check'], { encoding: 'utf8' });
    ok('app/css/nogap.css matches app.css', chk.status === 0, (chk.stdout + chk.stderr).trim());
    const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
    ok('index.html loads nogap.css and compat.js before the libraries', html.indexOf('css/nogap.css') > 0 && html.indexOf('js/compat.js') > 0 && html.indexOf('js/compat.js') < html.indexOf('vendor/'));

    // webOS 26 checks Access Control Groups when requiredACG is present, and 27 requires it.
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/appinfo.json'), 'utf8'));
    ok('appinfo.json declares requiredACG', Array.isArray(info.requiredACG));
    const needs = { 'com.webos.service.tv.systemproperty/getSystemInfo': 'systemconfig.query', 'activityManager.': 'activity.operation' };
    const all = files('app/js').concat(files('service')).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    Object.keys(needs).forEach(k => { if (all.indexOf(k) >= 0) ok('requiredACG has ' + needs[k] + ' (for ' + k.replace(/\.$/, '') + ')', (info.requiredACG || []).indexOf(needs[k]) >= 0); });
    const luna = all.match(/luna:\/\/[\w.]+/g) || [];
    // org.webosbrew.hbchannel.service (in-app updates) only exists on rooted TVs and has no ACG group;
    // update.js treats a refused call as "can't install from the TV".
    const known = ['luna://com.webos.service.tv.systemproperty', 'luna://' + info.id + '.service', 'luna://org.webosbrew.hbchannel'];
    luna.forEach(u => ok('Luna call has a known ACG: ' + u, known.some(k => u.indexOf(k) === 0)));

    console.log(fail ? fail + ' failures' : 'all compatibility tests passed');
    process.exit(fail ? 1 : 0);
  });
