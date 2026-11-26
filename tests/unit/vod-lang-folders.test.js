/* Movies and Shows by language folder (app/js/vod.js inFolders, Settings > Movies and shows > Categories by
   language; issue #173): the language headings become one row each, a folder opens on its own categories with a row
   back, and a list whose names say no language stays as it was.
     node tests/unit/vod-lang-folders.test.js */
'use strict';
const assert = require('assert'), vm = require('vm'), fs = require('fs'), path = require('path');

const ls = {};
const ctx = { console, I18n: { t: (s) => s }, Store: { settings: { vodLangFolders: true } },
  localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
  VodView: { known: (c) => /^(EN|DE)$/.test(c), langName: (c) => ({ EN: 'English', DE: 'German' })[c] || c, tag: () => '' },
  U: { debounce: (f) => { f.cancel = () => {}; return f; }, el: () => ({}) }, window: {},
  // The category column and its heading, which names the open folder.
  document: { getElementById: (id) => (id === 'vodCats' ? { parentNode: { querySelector: () => title } } : null) } };
const title = { textContent: 'Categories' };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/vod.js'), 'utf8') + '\n;this.Vod = Vod;', ctx);
const { byLang, inFolders, forFolders } = ctx.Vod._test;

const cats = [{ id: 1, name: 'HINDI MOVIES' }, { id: 2, name: 'HINDI | ACTION' }, { id: 3, name: 'TAMIL MOVIES' }, { id: 4, name: 'TAMIL | DRAMA' },
  { id: 5, name: '|EN| Action' }, { id: 6, name: '|EN| Comedy' }, { id: 7, name: 'KIDS' }];
const folders = inFolders(byLang(cats));
assert.strictEqual(folders.map((f) => f.name + ':' + f.count).join(), 'Hindi:2,Tamil:2,English:2,Other categories:1', 'one folder per language, with how many categories');
assert.ok(folders.every((f) => f.folder && !f.head), 'folders, not headings');
// Red on a folder hides the whole language (issue #173): each folder carries its categories.
assert.strictEqual(folders.map((f) => f.cats.map((c) => c.id).join('+')).join(), '1+2,3+4,5+6,7', 'each folder knows its categories, for Hide this language');

// Into a folder (kept per kind; whichever kind the module is on): its categories, after a row back.
ctx.localStorage.setItem('tivibro.vodFolder.movie', 'Tamil');
let open = inFolders(byLang(cats));
if (!open[0].up) { ctx.localStorage.setItem('tivibro.vodFolder.series', 'Tamil'); open = inFolders(byLang(cats)); }
assert.ok(open[0].up && open.slice(1).map((c) => c.id).join() === '3,4', 'an open folder: a row back, then its categories: ' + JSON.stringify(open));
assert.strictEqual(title.textContent, 'Tamil', 'the column heading names the open folder, so it stays in sight while scrolling');

// A folder name that no longer exists (the provider renamed it): all folders again.
ctx.localStorage.setItem('tivibro.vodFolder.movie', 'Klingon'); ctx.localStorage.setItem('tivibro.vodFolder.series', 'Klingon');
assert.ok(inFolders(byLang(cats)).every((f) => f.folder), 'a folder that is gone shows every folder');
assert.strictEqual(title.textContent, 'Categories', 'every folder: the heading is Categories again');

// Names that say no language: the plain list, unchanged.
const plain = [{ id: 1, name: 'Action' }, { id: 2, name: 'Drama' }];
assert.strictEqual(JSON.stringify(inFolders(byLang(plain))), JSON.stringify(plain), 'no languages, no folders');
// Issue #173: the language later in the name ("BOLLYWOOD HINDI", "AMAZON PRIME TAMIL") makes folders too, and
// only for folders: the plain list's headings still go by the start of a name.
ctx.localStorage.removeItem('tivibro.vodFolder.movie'); ctx.localStorage.removeItem('tivibro.vodFolder.series');
const later = [{ id: 1, name: 'BOLLYWOOD HINDI' }, { id: 2, name: 'NETFLIX HINDI DUBBED' }, { id: 3, name: 'AMAZON PRIME TAMIL' }, { id: 4, name: 'NEW TAMIL MOVIES' }, { id: 5, name: 'KIDS' }];
assert.strictEqual(inFolders(byLang(later, true)).map((f) => f.name + ':' + f.count).join(), 'Hindi:2,Tamil:2,Other categories:1', 'a language anywhere in the name');
assert.strictEqual(JSON.stringify(byLang(later)), JSON.stringify(later), 'headings alone still need it first');
assert.ok(!inFolders(byLang([{ id: 1, name: 'ENGLISHMAN STORIES' }, { id: 2, name: 'THE ENGLISHMAN' }, { id: 3, name: 'HINDI 1' }, { id: 4, name: 'HINDI 2' }], true)).some((f) => f.name === 'English'), 'whole words only');
// Hide this language (issue #173): with its categories hidden the folder goes too, and a folder counts what it shows.
const hidden = inFolders(forFolders(cats, { 3: 1, 4: 1 }));
assert.strictEqual(hidden.map((f) => f.name + ':' + f.count).join(), 'Hindi:2,English:2,Other categories:1', 'a language hidden whole has no folder left: ' + hidden.map((f) => f.name).join());
console.log('PASS Movies and Shows by language folder: a row per language (named anywhere in a category), a folder opens on its categories, plain lists stay plain');
