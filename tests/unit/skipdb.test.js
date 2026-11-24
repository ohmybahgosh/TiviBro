// Skip times from TheIntroDB and IntroDB: the helper's side (service/skipdb.js) with the databases answered here
// (no network), and the app's side (app/js/skipper.js): which times it shows, and what it asks them by.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

const D = require('../../service/skipdb.js'), K = D._test;
// The databases, as they answer: by host, a function of the path.  asked: every request, in order.
let asked = [], answers = {};
K.use((host, p, headers, cb) => { asked.push({ host, p, headers }); const f = answers[host]; setImmediate(() => f ? f(p, cb) : cb(new Error('down'))); });
const look = (q) => new Promise((r) => D.lookup(q, r));
const reset = () => { K.reset(); asked = []; answers = {}; };

(async () => {
  // What is asked: only numbers and an IMDb id, a TMDB key never sent to the databases.
  ok('a TMDB id and an episode are clean', JSON.stringify(K.clean({ kind: 'episode', tmdb: '1396', season: '1', episode: '2', dur: 2900.4 })) === JSON.stringify({ kind: 'episode', tmdb: '1396', imdb: '', season: 1, episode: 2, dur: 2900.4, credential: '' }));
  ok('anything else is refused', K.clean({ tmdb: '1396&x=1' }) === null && K.clean({ imdb: 'tt12' }) === null && K.clean({ kind: 'episode', tmdb: '5', season: 1 }) === null);

  // TheIntroDB has it all: IntroDB isn't asked.  null start: from the beginning; null end: to the end (-1).
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 200, json: { intro: [{ start_ms: null, end_ms: 58000 }], recap: [{ start_ms: 0, end_ms: 30500 }], credits: [{ start_ms: 2700000, end_ms: null }] } });
  let r = await look({ kind: 'episode', tmdb: '1396', season: 1, episode: 1, dur: 2900 });
  ok('TheIntroDB: intro, recap and credits in seconds', JSON.stringify(r) === JSON.stringify({ intro: [0, 58], recap: [0, 30.5], credits: 2700, from: ['TheIntroDB'] }), r);
  ok('asked by TMDB id, season, episode and length', asked.length === 1 && asked[0].p === '/v4/media?tmdb_id=1396&season=1&episode=1&duration_ms=2900000', asked);
  r = await look({ kind: 'episode', tmdb: '1396', season: 1, episode: 1 });
  ok('the same title again comes from what was kept', asked.length === 1 && r.credits === 2700);
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 200, json: { intro: [{ start_ms: 1000, end_ms: null }], credits: [{ start_ms: 9000, end_ms: null }] } });
  await look({ kind: 'movie', tmdb: '9' }); r = await look({ kind: 'movie', tmdb: '9' });
  ok('an end "to the end" is -1, the same when kept (JSON has no Infinity)', JSON.stringify(JSON.parse(JSON.stringify(r)).intro) === '[1,-1]', r);

  // TheIntroDB without the credits: IntroDB (by the IMDb id TMDB gives with the viewer's key) fills them in.
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 200, json: { intro: [{ start_ms: 10000, end_ms: 70000 }] } });
  answers['api.themoviedb.org'] = (p, cb) => cb(null, { status: 200, json: { imdb_id: 'tt0903747' } });
  answers['api.introdb.app'] = (p, cb) => cb(null, { status: 200, json: { intro: { start_ms: 1, end_ms: 2 }, recap: null, outro: { start_ms: 3431000, end_ms: 3500000 }, no_recap: true } });
  r = await look({ kind: 'episode', tmdb: '1396', season: 1, episode: 1, credential: 'eyJhbGciOi.token' });
  ok('the intro from TheIntroDB, the credits from IntroDB', JSON.stringify(r) === JSON.stringify({ intro: [10, 70], recap: null, credits: 3431, from: ['TheIntroDB', 'IntroDB'] }), r);
  ok('the IMDb id from TMDB with a Bearer token, IntroDB by it', asked[1].host === 'api.themoviedb.org' && asked[1].p === '/3/tv/1396/external_ids' && asked[1].headers.Authorization === 'Bearer eyJhbGciOi.token' && asked[2].p === '/segments?imdb_id=tt0903747&season=1&episode=1', asked);
  ok('the TMDB key goes to TMDB only', !asked.some((a) => a.host !== 'api.themoviedb.org' && (JSON.stringify(a).indexOf('token') >= 0)));

  // A movie by IMDb id; IntroDB's "none" flags win over a stray segment.
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 404, json: { code: 'no_submissions' } });
  answers['api.introdb.app'] = (p, cb) => cb(null, { status: 200, json: { intro: { start_ms: 0, end_ms: 9000 }, no_intro: true, outro: { start_ms: 7000000, end_ms: 7300000 } } });
  r = await look({ kind: 'movie', imdb: 'tt0371746' });
  ok('a movie: is_movie=true, no intro where IntroDB says there is none', JSON.stringify(r) === JSON.stringify({ intro: null, recap: null, credits: 7000, from: ['IntroDB'] }) && asked[1].p === '/segments?imdb_id=tt0371746&is_movie=true', [r, asked]);

  // Nobody timed it: kept as a miss.  A database that couldn't be reached: not kept, asked again.
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 404, json: {} });
  r = await look({ kind: 'movie', tmdb: '603' });
  await look({ kind: 'movie', tmdb: '603' });
  ok('nothing found, kept: asked once', r.from.length === 0 && r.credits === -1 && asked.length === 1, asked);
  reset();
  await look({ kind: 'movie', tmdb: '603' }); await look({ kind: 'movie', tmdb: '603' });
  ok('no answer (down): asked again next time', asked.length === 2, asked);

  // 429: that database is left alone for a while; the other is still asked.
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 429, retry: '120', json: null });
  answers['api.introdb.app'] = (p, cb) => cb(null, { status: 200, json: { intro: { start_ms: 5000, end_ms: 60000 } } });
  await look({ kind: 'episode', imdb: 'tt0944947', season: 1, episode: 1 });
  r = await look({ kind: 'episode', imdb: 'tt0944947', season: 1, episode: 2 });
  ok('after a 429 TheIntroDB is not asked; IntroDB still is', asked.filter((a) => a.host === 'api.theintrodb.org').length === 1 && r.intro[0] === 5 && r.from[0] === 'IntroDB', asked);

  // Two questions for one title at once: one request.
  reset();
  answers['api.theintrodb.org'] = (p, cb) => cb(null, { status: 200, json: { intro: [{ start_ms: 1000, end_ms: 50000 }], credits: [{ start_ms: 5000000, end_ms: null }] } });
  const both = await Promise.all([look({ kind: 'movie', tmdb: '27205' }), look({ kind: 'movie', tmdb: '27205' })]);
  ok('one request for two questions at once', asked.length === 1 && both[0].intro[1] === 50 && both[1].intro[1] === 50, asked);

  // ---------- the app's side ----------
  const ctx = { Store: { settings: {} }, U: { el: () => ({}) }, document: { getElementById: () => null, body: { classList: { contains: () => true } } }, Log: { info() {} }, I18n: { t: (s) => s } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/skipper.js'), 'utf8') + ';this.Skipper = Skipper;', ctx);
  const S = ctx.Skipper._test;
  const db = { intro: [0, 58], recap: [60, 90], credits: 2700 };
  ok('the databases\' intro while it plays', S.dbIntroAt([], db, 20, 2900).t === 'intro' && S.dbIntroAt([], db, 70, 2900).t === 'recap' && !S.dbIntroAt([], db, 57, 2900) && !S.dbIntroAt([], db, 100, 2900));
  ok('a file with an intro chapter keeps its own', !S.dbIntroAt([{ s: 0, e: 40, t: 'Intro' }], db, 20, 2900));
  ok('an intro "to the end" (-1) stops at the file\'s end, and a too long one is left out', S.dbIntroAt([], { intro: [100, -1] }, 120, 400).e === 400 && !S.dbIntroAt([], { intro: [100, -1] }, 120, 3000));
  ok('the databases\' credits in the second half only', S.creditsStart([], db, 2900) === 2700 && S.creditsStart([], { credits: 600 }, 2900) === -1 && S.creditsStart([], { credits: 2898 }, 2900) === -1);
  ok('a credits chapter comes first', S.creditsStart([{ s: 2600, e: 2900, t: 'End Credits' }], db, 2900) === 2600);

  // What the title is asked by.
  ctx.Media = { showTmdb: () => '1396', request: () => Promise.resolve({ metadata: { id: 'tmdb:tv:42' } }) };
  ctx.Vod = { movieTmdb: (it) => Promise.resolve(it.id === 7 ? '603' : '') };
  const ids = async (m) => JSON.stringify(await S.idsOf(m));
  ok('My media episode: the show\'s TMDB id, season, number', await ids({ local: true, item: { kind: 'episode', showId: 's', season: 2, number: 3 } }) === JSON.stringify({ kind: 'episode', tmdb: '1396', season: 2, episode: 3 }));
  ctx.Media.showTmdb = () => '';
  ok('...from the library when its card isn\'t loaded', await ids({ local: true, item: { kind: 'episode', showId: 's', season: 2, number: 3 } }) === JSON.stringify({ kind: 'episode', tmdb: '42', season: 2, episode: 3 }));
  ok('My media movie: its TMDB id', await ids({ local: true, item: { kind: 'movie', metadata: { id: 'tmdb:27205' } } }) === JSON.stringify({ kind: 'movie', tmdb: '27205' }));
  ok('a provider\'s episode: the show\'s TMDB id from its details', await ids({ provider: true, showTmdb: '1399', item: { ep: true, season: 1, num: 4 } }) === JSON.stringify({ kind: 'episode', tmdb: '1399', season: 1, episode: 4 }));
  ok('a provider\'s movie: from Vod, none when unknown', await ids({ provider: true, item: { id: 7 } }) === JSON.stringify({ kind: 'movie', tmdb: '603' }) && await ids({ provider: true, item: { id: 8 } }) === 'null');
  ok('a recording or a show with no id: nothing', await ids({ item: { recording: true } }) === 'null' && await ids({ provider: true, item: { ep: true, season: 1, num: 4 } }) === 'null');

  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
