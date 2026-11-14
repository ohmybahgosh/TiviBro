// The guide's category colours follow the theme (views.js kindColours): five different colours, none close to
// the theme's accent (the focused programme) or to each other.
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../app/js/views.js'), 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const V = ['ink', 'panel', 'raised', 'line', 'text', 'muted', 'dim', 'accent', 'accent2', 'warn', 'air', 'ok', 'side'];
const K = {};
new Function('K', cut('  var PALETTES = {', '  var PALETTE_NAMES') + cut('  var KIND_DEFAULT', '  function palette(id)') + ';K.kc = kindColours; K.P = PALETTES; K.hsl = hsl; K.gap = hueGap;')(K);
let fails = 0, n = 0;
const ok = (name, c, x) => { n++; if (!c) { fails++; console.log('FAIL ' + name + (x !== undefined ? '  ' + x : '')); } };
const check = (name, pal, acc) => {
  const c = K.kc(pal, acc), a = K.hsl(acc), hs = c.map(K.hsl);
  ok(name + ': five different colours', new Set(c.map((x) => x.toLowerCase())).size === 5, c.join(' '));
  if (a.s > 0.2) ok(name + ': none close to the accent', hs.every((h) => K.gap(h.h, a.h) >= 30), acc + ' ' + c.join(' '));
  let min = 360; for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) min = Math.min(min, K.gap(hs[i].h, hs[j].h));
  ok(name + ': apart from each other', min >= 25, c.join(' ') + ' min ' + Math.round(min));
};
for (const id of Object.keys(K.P)) { const o = {}; V.forEach((v, i) => { o[v] = K.P[id][i]; }); check(id, o, o.accent); }
['#5b8cff', '#33e1ff', '#8b5cf6', '#c084fc', '#ff5ca8', '#3ddc97', '#14b8a6', '#a3e635', '#f2b33d', '#ff6a3d', '#e5484d'].forEach((acc) => check('your own mix ' + acc, null, acc));
ok('your own mix with the usual accent keeps the usual movie, sports, news and kids colours', K.kc(null, '#5b8cff').slice(0, 4).join() === '#b48cff,#3ddc97,#f2b33d,#ff7eb6', K.kc(null, '#5b8cff').join());
console.log(fails ? fails + ' of ' + n + ' category colour checks failed' : 'all ' + n + ' category colour checks passed');
process.exit(fails ? 1 : 0);
