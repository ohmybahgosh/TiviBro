#!/usr/bin/env node
/* app/js/lang/keys.js: every text the TV app translates, for I18n.known() (Search settings tells TiviBro's own
   rows from ones named after your channels or teams with it).  The TV loads only the dictionary in use, so
   known() can't look in all of them: this file has each text as a hash (the sum I18n.hash makes) and the texts
   with {n}, {x}... as they are, to match as patterns.  About a tenth of a dictionary's size.
     node scripts/i18n-keys.js            writes it (i18n-import.js and build.sh run it too)
     node scripts/i18n-keys.js --check    fails when it's out of date (tests/unit/i18n.test.js) */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./i18n-lib.js');
const FILE = path.join(L.ROOT, 'app', 'js', 'lang', 'keys.js');

// The same sum as I18n.hash in app/js/i18n.js (FNV-1a, with the same double multiply, so both agree).
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h; }

function make() {
  const all = Object.keys(L.found('tv')).sort(), P = /\{[nxyz]\}/;
  // Patterns are also in the dictionaries alone: text put together from pieces ("Hidden ({n})" for 'Hidden (' + n + ')').
  const pats = new Set(all.filter((k) => P.test(k)));
  L.LIST.filter((l) => l.code !== 'en' && !l.from).forEach((l) => Object.keys(L.dict('tv', l.code)).forEach((k) => { if (P.test(k)) pats.add(k); }));
  const plain = all.filter((k) => !P.test(k));
  return '/* Made by scripts/i18n-keys.js: every text TiviBro translates (hashes, then patterns), for I18n.known.  Don\'t edit. */\n' +
    'I18n.keys([' + plain.map(hash).join(',') + '],\n' + JSON.stringify([...pats].sort()) + ');\n';
}
if (require.main === module) {
const text = make();
if (process.argv.includes('--check')) {
  const now = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  if (now !== text) { console.error('app/js/lang/keys.js is out of date: node scripts/i18n-keys.js'); process.exit(1); }
  console.log('keys.js is up to date');
} else if (!fs.existsSync(FILE) || fs.readFileSync(FILE, 'utf8') !== text) { fs.writeFileSync(FILE, text); console.log('wrote app/js/lang/keys.js'); }
}
module.exports = { hash, make, FILE };
