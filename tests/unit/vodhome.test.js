/* The Movies and Shows home (vodhome.js): TMDB's lists match the provider's titles by name and year
   (providers give no TMDB IDs), language prefixes and quality tags aside, and never show a title twice.
   Synthetic data. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const c = { console, setTimeout, clearTimeout, Promise, document: { getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, Store: { settings: {} }, U: {}, UI: {}, Media: {}, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(c); vm.runInContext(fs.readFileSync('app/js/vodhome.js', 'utf8'), c);
const T = c.VodHome._test;
assert.equal(T.norm('Paper Kings (2025) [4K]'), T.norm('Paper Kings'));
assert.equal(T.norm('Fast & Furious'), T.norm('Fast and Furious'));
const items = [{ id: 1, name: 'Paper Kings (2025)' }, { id: 2, name: 'Paper Kings 4K', year: '2025' }, { id: 3, name: 'Orbit Nine', year: '1999' }, { id: 4, name: 'Glass Coast' }];
const api = { data: () => ({ items }), key: (it) => 'm' + it.id };
vm.runInContext('VodHome._test.lists = { "popular:movie": [{ t: "Paper Kings", y: "2025" }, { t: "Orbit Nine", y: "2026" }, { t: "Le Glass Coast", o: "Glass Coast", y: "2024" }, { t: "Not Here", y: "2020" }] };', c);
// The list as TMDB gave it, and the provider's titles through the arrange hook (no menu on screen).
c.UI.menu = () => {}; c.Store.settings.vodShelves = {}; c.Store.saveSettings = () => {};
c.VodHome.arrange('movie', Object.assign({ cats: () => [] }, api));
const got = T.matched(['popular:movie']).map((it) => it.id);
assert.deepEqual(got, [1, 4], 'Paper Kings once (the first copy), Glass Coast by its original title, not Orbit Nine of another year, nothing for a title not there');
console.log('PASS the Movies and Shows home matches TMDB\'s lists to the provider\'s titles by name and year, once each');
