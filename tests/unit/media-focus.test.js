/* Opening My media focuses the first item on screen (the top shelf that has something), keeps doing so
   while TV shows and episodes arrive from the helper, and stops once the viewer moves.  Synthetic data. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function el(tag, cls, text) {
  const e = { tag, children: [], style: {}, attrs: {}, textContent: text || '', clientHeight: 0, parentNode: null,
    classList: { set: new Set(cls ? String(cls).split(' ') : []), toggle(c, on) { if (on === undefined) on = !this.set.has(c); if (on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); }, add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
    appendChild(c) { if (typeof c === 'object') { c.parentNode = e; e.children.push(c); } return c; }, removeChild(c) { e.children = e.children.filter(x => x !== c); },
    setAttribute(k, v) { e.attrs[k] = v; }, addEventListener() {} };
  Object.defineProperty(e, 'innerHTML', { set() { e.children = []; }, get() { return ''; } });
  return e;
}
const ids = { viewMedia: el('div'), mediaShelfStage: el('div'), mediaItems: el('div'), mediaInfo: el('div') };
const movie = (id, title) => ({ id, src: 's', title });
let lib = [], favorites = {}, continuing = [], handler = null;
const c = { Promise, setTimeout, clearTimeout, console, document: { body: el('body'), hidden: false },
  Net: { port: 1, ctlHeaders: h => h },
  U: { $: id => ids[id], el, toast() {} },
  UI: { setHandler: h => { handler = h; }, hints() {}, pointer: false },
  Views: { tabBar() {} }, MediaSeries: new Proxy({}, { get: () => function () {} }),
  MediaStore: { load: () => Promise.resolve(), sources: () => [{ id: 's', name: 'Server' }], source: () => ({ id: 's', name: 'Server' }), resume: () => null,
    isFavorite: id => !!favorites[id], preferences: () => ({ language: 'en', sort: 'name', showSort: 'name' }),
    sections: () => [{ id: 'continue', title: 'Continue watching', movies: [] }, { id: 'favorites', title: 'Favorites', movies: lib.filter(m => favorites[m.id]) }, { id: 'all', title: 'Movies', movies: lib.slice() }] },
  fetch: (url, opts) => Promise.resolve({ json: () => Promise.resolve(/library\/continue$/.test(url) ? { items: continuing.slice() } : { items: [] }) })
};
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/media.js', 'utf8'), c);
const settle = () => new Promise(r => setTimeout(r, 20));
const focused = () => { for (const shelf of ids.mediaShelfStage.children) for (const tile of shelf.children[1].children) if (tile.style.display !== 'none' && tile.classList.contains('sel')) return shelf.children[0].children[0].textContent + ': ' + tile.attrs['aria-label']; return null; };
(async () => {
  lib = [movie('a', 'Alpha'), movie('b', 'Bravo')]; favorites = { b: true };
  c.Media.open(); await settle();
  assert.equal(focused(), 'Favorites: Bravo', 'opening focuses the first item on screen, not the Movies shelf');

  continuing = [{ handle: 'show1', title: 'Harbour', kind: 'show' }];
  c.Media.refreshShows(); await settle();
  assert.equal(focused(), 'Continue watching: Harbour', 'a shelf that fills in above the focus takes it while the viewer has not moved');

  handler('down'); await settle();
  assert.equal(focused(), 'Favorites: Bravo');
  c.Media.refreshShows(); await settle();
  assert.equal(focused(), 'Favorites: Bravo', 'once the viewer moves, new data leaves the focus where it is');

  c.Media.open(); await settle(); handler('ok'); continuing = [{ handle: 'show2', title: 'Lighthouse', kind: 'show' }].concat(continuing); c.Media.refreshShows(); await settle();
  assert.equal(focused(), 'Continue watching: Harbour', 'any key, OK too, ends following the top');
  handler('down'); await settle();
  c.Media.open(true); await settle();
  assert.equal(focused(), 'Favorites: Bravo', 'coming back from a show keeps the place');
  c.Media.open(); await settle();
  assert.equal(focused(), 'Continue watching: Lighthouse', 'opening My media again starts at the top');

  continuing = []; favorites = {}; c.Media.open(); await settle();
  assert.equal(focused(), 'Movies: Alpha', 'with only movies, the first movie');
  console.log('PASS My media opens on the first item on screen and keeps the place once the viewer moves');
})().catch(e => { console.error(e); process.exitCode = 1; });
