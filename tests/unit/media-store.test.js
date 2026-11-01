// My media, app side (app/js/mediastore.js): sources, the library, and where a movie stopped.
// These belong to the TV, not to a playlist, and a failed scan must never lose the library.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const SRC = fs.readFileSync(path.join(__dirname, '../../app/js/mediastore.js'), 'utf8');

function world(saved, now) {
  const ls = saved || { data: {}, idb: {} };
  const ctx = {
    console, JSON, Promise, Date: now ? { now } : Date, Math,
    localStorage: { getItem: k => (k in ls.data ? ls.data[k] : null), setItem: (k, v) => { ls.data[k] = String(v); }, removeItem: k => { delete ls.data[k]; } },
    Store: { bigGet: k => Promise.resolve((ls.big || ls.idb)[k] === undefined ? null : JSON.parse((ls.big || ls.idb)[k])), bigSet: (k, v) => { (ls.big || ls.idb)[k] = JSON.stringify(v); return Promise.resolve(true); }, idbGet: k => Promise.resolve(ls.idb[k] === undefined ? null : JSON.parse(ls.idb[k])), idbSet: (k, v) => { ls.idb[k] = JSON.stringify(v); return Promise.resolve(true); } }
  };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { M: vm.runInContext('MediaStore', ctx), ls, store: ctx.Store };
}
const movie = (title, id, extra) => Object.assign({ id, title, year: '2000', file: title + '.mkv', size: 1, ext: 'mkv', info: [] }, extra || {});
const titles = l => Array.from(l).map(m => m.title);

(async () => {
  let { M, ls } = world();
  ok('nothing to start with', M.sources().length === 0 && M.movies(null).length === 0);

  // Sources
  const a = M.addSource({ type: 'dlna', name: 'FritzBox', control: 'http://f/ctl' });
  ok('a source gets an id', typeof a === 'string' && a.length > 0);
  ok('the same server is not added twice', M.addSource({ type: 'dlna', name: 'FritzBox again', control: 'http://f/ctl' }) === a && M.sources().length === 1);
  const b = M.addSource({ type: 'webdav', name: 'Cloud', address: 'https://w/', user: 'cust', pass: 'secretkey' });
  for (let i = 0; i < 6; i++) M.addSource({ type: 'webdav', name: 'n' + i, address: 'https://w' + i + '/', user: 'u', pass: 'p' });
  let threw = false; try { M.addSource({ type: 'webdav', name: 'nine', address: 'https://z/', user: 'u', pass: 'p' }); } catch (e) { threw = true; }
  ok('at most 8 sources', threw && M.sources().length === 8);

  // Scans
  let r = M.applyScan(a, { movies: [movie('Moana', 'd:/m'), movie('frozen', 'd:/f')], partial: false, errors: [] });
  ok('a scan fills the library', r.changed === true && M.movies(a).length === 2);
  ok('sorted by title, ignoring case', titles(M.movies(a))[0] === 'frozen', titles(M.movies(a)));
  M.applyScan(b, { movies: [movie('Cloud one', 'w:/c')], partial: false, errors: [] });
  ok('All shows every source', M.movies(null).length === 3);
  ok('ids stay apart between sources', M.movies(a)[0].id !== M.movies(b)[0].id && M.movies(a)[0].id.indexOf(a) === 0, M.movies(a)[0].id);
  M.applyScan(a, { movies: [movie('Moana', 'd:/m')], partial: false, errors: [] });
  ok('a full scan removes what is gone', titles(M.movies(a)).join() === 'Moana');
  ok('and only from its own source', M.movies(b).length === 1);
  M.applyScan(a, { movies: [movie('New', 'd:/n')], partial: true, errors: ['x'] });
  ok('a partial scan keeps what it did not reach', titles(M.movies(a)).sort().join() === 'Moana,New');
  r = M.applyScan(a, { error: 'unreachable', message: 'no' });
  ok('a failed scan changes nothing', r.changed === false && M.movies(a).length === 2 && r.note === 'no', r);
  r = M.applyScan(a, { movies: [], partial: false, errors: [] });
  ok('an empty answer never empties the library', M.movies(a).length === 2 && r.kept === true && !!r.note, r);
  M.applyScan(b, { movies: [movie('Signed', 'w:/s', { url: 'https://cdn/signed?x=1', path: '/s' })], partial: false, errors: [] });
  ok('a signed link is never kept', !M.movies(b)[0].url && M.movies(b)[0].path === '/s');
  ok('nor written down', !ls.idb['media:lib'] || ls.idb['media:lib'].indexOf('cdn/signed') < 0);
  M.applyScan(a, { movies: [movie('Lan', 'd:/l', { url: 'http://f/l.mkv' })], partial: false, errors: [] });
  ok('a DLNA address is kept, it is stable', M.movies(a)[0].url === 'http://f/l.mkv');

  // Where a movie stopped
  const id = M.movies(a)[0].id;
  M.saveResume(id, 500, 40);
  ok('a very short video is not remembered', !M.resume(id));
  M.saveResume(id, 20, 6000);
  ok('the first seconds are not remembered', !M.resume(id));
  M.saveResume(id, 1000, 6000);
  ok('where it stopped is remembered', M.resume(id).pos === 1000 && M.resume(id).dur === 6000);
  M.saveResume(id, 5970, 6000);
  ok('the end of a movie clears it', !M.resume(id));
  M.saveResume(id, 2000, 6000);

  // Across a restart, and apart from everything else
  await M.load(); // Wait for all helper writes before simulating a restart.
  const again = world(ls).M; await again.load();
  ok('sources survive a restart', again.sources().length === 8);
  ok('the library survives a restart', again.movies(a).length === 1 && titles(again.movies(a))[0] === 'Lan');
  ok('the position survives a restart', again.resume(id).pos === 2000);
  ok('the login survives a restart', again.sources().filter(s => s.id === b)[0].pass === 'secretkey');
  ok('none of it goes in the settings a backup carries', !ls.data['tivibro.settings'] && Object.keys(ls.data).join() === 'tivibro.media', Object.keys(ls.data));
  ok('the list for screens leaves the login out', JSON.stringify(again.publicSources()).indexOf('secretkey') < 0 && again.publicSources().length === 8);
  ok('the WebDAV address still shows', again.publicSources().filter(s => s.id === b)[0].address === 'https://w/');

  // A TV with a full browser store must keep its library in the helper.
  const full = { data: {}, idb: {}, big: {} };
  const durable = world(full).M, ds = durable.addSource({ type: 'dlna', name: 'Mock server', control: 'http://mock/ctl' });
  durable.applyScan(ds, { movies: [movie('Durable', 'd:/durable')], partial: false });
  const restarted = world(full).M; await restarted.load();
  ok('library uses helper storage when browser storage is full', restarted.movies(ds).length === 1 && !full.idb['media:lib']);

  const mid = durable.movies(ds)[0].id;
  await durable.setMetadata(mid, { id: 'tt1', title: 'Durable', plot: 'Mock plot' });
  durable.applyScan(ds, { movies: [movie('Durable', 'd:/durable')], partial: false });
  const withDetails = world(full).M; await withDetails.load();
  ok('movie details survive rescans and restarts', withDetails.movies(ds)[0].metadata.plot === 'Mock plot');
  await withDetails.setMetadata(mid, null);
  ok('a wrong metadata match can be removed', !withDetails.movies(ds)[0].metadata);

  ok('metadata language defaults to English', world().M.preferences().language === 'en');
  durable.preferences({ language: 'nl' });
  ok('metadata language survives restart', world(full).M.preferences().language === 'nl');

  const shelving = world(full).M; await shelving.load();
  shelving.toggleFavorite(mid);
  shelving.saveResume(mid, 500, 6000);
  const shelfRestart = world(full).M; await shelfRestart.load();
  ok('favorite survives restart', shelfRestart.isFavorite(mid));
  const shelves = shelfRestart.sections(ds);
  ok('sections include Continue watching, Favorites and All movies', shelves.map(s => s.title).join() === 'Continue watching,Favorites,All movies');
  ok('movie appears in continue watching and favorites', shelves[0].movies[0].id === mid && shelves[1].movies[0].id === mid && shelves[2].movies.length === 1);
  shelfRestart.toggleFavorite(mid); shelfRestart.clearResume(mid);
  ok('clearing favorite and resume empties the matching shelves', shelfRestart.sections(ds)[0].movies.length === 0 && shelfRestart.sections(ds)[1].movies.length === 0);
  ok('source filter applies to every section', shelfRestart.sections('missing').every(s => !s.movies.length));

  let clock = 1000;
  const sortingWorld = world(null, () => clock), sorting = sortingWorld.M, sortSource = sorting.addSource({ type: 'dlna', name: 'Mock', control: 'http://mock/sort' });
  sorting.applyScan(sortSource, { movies: [movie('Zulu', 'd:/z', { year: '2024' }), movie('Alpha', 'd:/a', { year: '2000' })] });
  const firstAdded = sorting.movies(null)[0].addedAt;
  sorting.preferences({ sort: 'release' });
  ok('release-date sort puts newest movies first', sorting.movies(null)[0].title === 'Zulu');
  sorting.preferences({ sort: 'name', language: 'nl' });
  ok('name sort puts titles in alphabetical order', sorting.movies(null)[0].title === 'Alpha');
  clock = 2000;
  sorting.applyScan(sortSource, { movies: [movie('Zulu', 'd:/z', { year: '2024' }), movie('Alpha', 'd:/a', { year: '2000' }), movie('New movie', 'd:/n')] });
  ok('rescanning preserves date first added', sorting.movies(null).filter(m => m.title === 'Alpha')[0].addedAt === firstAdded);
  sorting.setTmdbToken('mock-user-token-123456789012345');
  sorting.preferences({ sort: 'added' });
  ok('date-added sort puts newly discovered movies first', sorting.movies(null)[0].title === 'New movie');
  ok('preferences are merged rather than reset', sorting.preferences().language === 'nl');
  ok('token is not returned in public preferences', !JSON.stringify(sorting.preferences()).includes('mock-user-token'));
  ok('token survives a reload of the module', world(sortingWorld.ls).M.tmdbToken() === 'mock-user-token-123456789012345');

  // A helper write can still be pending when Yellow loads the scan result.
  const slow = world();
  let finishWrite;
  slow.store.bigSet = (key, value) => new Promise(resolve => { finishWrite = () => { slow.ls.idb[key] = JSON.stringify(value); resolve(true); }; });
  const slowSource = slow.M.addSource({ type: 'dlna', name: 'Slow mock', control: 'http://mock/ctl' });
  slow.M.applyScan(slowSource, { movies: [movie('Newly discovered', 'd:/new')] });
  let loaded = false;
  const loading = slow.M.load().then(() => { loaded = true; });
  await Promise.resolve();
  ok('loading waits for the pending scan write', !loaded);
  finishWrite(); await loading;
  ok('the next metadata scan sees the newly discovered movie', slow.M.movies().length === 1 && slow.M.movies()[0].title === 'Newly discovered');

  slow.M.applyScan(slowSource, { movies: [movie('First write', 'd:/first')] });
  const firstWrite = finishWrite;
  slow.M.applyScan(slowSource, { movies: [movie('Latest write', 'd:/last')] });
  ok('a newer scan waits behind the earlier helper write', finishWrite === firstWrite);
  firstWrite(); await Promise.resolve(); await Promise.resolve();
  finishWrite(); await slow.M.load();
  ok('ordered writes keep the newest library', slow.M.movies()[0].title === 'Latest write');

  const stale = world();
  const staleSource = stale.M.addSource({ type: 'dlna', name: 'Mock read race', control: 'http://mock/ctl' });
  stale.M.applyScan(staleSource, { movies: [movie('Old', 'd:/old')] });
  await stale.M.load();
  let returnOld;
  stale.store.bigGet = () => new Promise(resolve => { returnOld = resolve; });
  const oldRead = stale.M.load();
  await Promise.resolve();
  stale.M.applyScan(staleSource, { movies: [movie('New', 'd:/new')] });
  returnOld([{ id: staleSource + '|d:/old', src: staleSource, title: 'Old' }]);
  await oldRead;
  ok('a stale helper read cannot overwrite a newer scan', stale.M.movies()[0].title === 'New');
  stale.M.removeSource(staleSource);
  const removedScan = stale.M.applyScan(staleSource, { movies: [movie('Late answer', 'd:/late')] });
  ok('a scan finishing after removal cannot restore its movies', !removedScan.changed && stale.M.movies().length === 0);

  // Broken storage must not stop the app
  ls.data['tivibro.media'] = '{not json';
  const broken = world(ls).M; await broken.load();
  ok('damaged storage starts empty', broken.sources().length === 0);

  // Removing a source
  const c = world().M, s1 = c.addSource({ type: 'dlna', name: 'x', control: 'http://x/' });
  c.applyScan(s1, { movies: [movie('Gone', 'd:/g')], partial: false, errors: [] });
  c.removeSource(s1);
  ok('removing a source removes its movies', c.sources().length === 0 && c.movies(null).length === 0);

  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
