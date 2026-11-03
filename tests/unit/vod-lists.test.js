// Movies and Shows lists: the helper's /vod/slim and /vod/list routes (service/vod.js), its store for
// big things (service/kv.js), and the app's language tags (app/js/vodview.js, vod.js).  Self-contained: its own tiny provider, no mock server needed.
const http = require('http'), path = require('path'), fs = require('fs'), vm = require('vm'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-vod-')); process.env.TIVIBRO_GUIDE_DIR = DIR; process.env.TIVIBRO_KV_DIR = DIR;
const proxy = require(path.join(__dirname, '../../service/proxy.js'));
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const post = (url, body) => new Promise((res, rej) => {
  const u = new URL(url), b = JSON.stringify(body);
  const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (r) => {
    let t = ''; r.on('data', d => t += d); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(t); } catch (e) { return null; } })() }));
  });
  q.on('error', rej); q.end(b);
});

const MOVIES = [];
for (let i = 0; i < 3000; i++) MOVIES.push({ num: i, name: i % 3 ? 'SE - Film ' + i : 'EN - Movie ' + i, stream_id: 100 + i, stream_icon: 'http://img/' + i + '.jpg', rating: '7.25', added: '1700000000', category_id: '5', container_extension: 'mkv', direct_source: 'x'.repeat(200), custom_sid: '', tmdb: '' });
const SERIES = [{ series_id: 9, name: '[SE] Nocturne', cover: 'c.jpg', plot: 'p'.repeat(1000), rating: '8', releaseDate: '2026-01-02', category_id: '7', last_modified: '1700000001', backdrop_path: ['a', 'b'], cast: 'x' }];

(async () => {
  let hits = 0, down = false;
  const up = http.createServer((req, res) => {
    if (/get_vod_streams/.test(req.url)) hits++;
    if (down) { res.writeHead(503); return res.end(); }
    if (/categories/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ category_id: '5', category_name: 'Films' }, { category_id: '7', category_name: 'Shows' }])); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(/get_series/.test(req.url) ? SERIES : /get_vod_streams/.test(req.url) ? MOVIES : { user_info: {} }));
  });
  await new Promise(f => up.listen(0, '127.0.0.1', f));
  const U = '127.0.0.1:' + up.address().port;
  const r = proxy.create({}); await new Promise(f => r.server.listen(0, '127.0.0.1', f));
  const P = r.server.address().port, B = 'http://127.0.0.1:' + P;
  const api = a => B + '/x/http/' + U + '/player_api.php?username=u&password=p&action=' + a;

  let a = await post(B + '/vod/slim', { kind: 'movie', u: api('get_vod_streams') });
  ok('movie list slimmed', a.status === 200 && a.json.n === 3000 && a.json.rows.length === 3000, a.status);
  ok('movie row keeps what the lists show', JSON.stringify(a.json.rows[1]) === JSON.stringify([101, 'SE - Film 1', 'http://img/1.jpg', '7.25', 'mkv', '5', 1700000000]), JSON.stringify(a.json.rows[1]));
  ok('slim answer is much smaller', JSON.stringify(a.json).length < JSON.stringify(MOVIES).length / 3);
  a = await post(B + '/vod/slim', { kind: 'series', u: api('get_series') });
  ok('show row, plot trimmed', a.status === 200 && a.json.rows[0][0] === 9 && a.json.rows[0][3].length === 300 && a.json.rows[0][5] === '2026', JSON.stringify(a.json.rows[0]).slice(0, 80));
  a = await post(B + '/vod/slim', { kind: 'movie', u: 'http://' + U + '/player_api.php' });
  ok('only relay addresses on this helper', a.status === 400, a.status);
  a = await post(B + '/vod/slim', { kind: 'movie', u: 'http://127.0.0.1:' + (P + 1) + '/x/http/' + U + '/' });
  ok('not another port either', a.status === 400, a.status);
  const ping = await new Promise(res => http.get(B + '/ping', x => { let t = ''; x.on('data', d => t += d); x.on('end', () => res(JSON.parse(t))); }));
  ok('ping says the helper keeps lists (vod 2, kv)', ping.vod >= 2 && ping.kv === 1);

  // /vod/list: the full list kept on the TV's storage, only what shows sent to the app.
  const q = (o) => Object.assign({ pl: 'p1', sig: 's1', kind: 'movie', u: api('get_vod_streams'), uc: api('get_vod_categories'), navLang: 'en-US', maxAge: 3600e3 }, o);
  hits = 0;
  a = await post(B + '/vod/list', q());
  const j = a.json;
  ok('the list comes back with only the TV\'s language', a.status === 200 && j.total === 3000 && j.rows.length === 1000 && j.langs.SE === 2000 && j.langs.EN === 1000, JSON.stringify(j && { total: j.total, n: j.rows.length, langs: j.langs }));
  ok('rows carry the language, with the code off the name', JSON.stringify(j.rows[0]) === JSON.stringify([100, 'Movie 0', 'http://img/0.jpg', '7.25', 'mkv', '5', 1700000000, 'EN', '', 0, 'EN - ']), JSON.stringify(j.rows[0]));
  ok('and the categories', j.cats.length === 2 && j.cats[0].name === 'Films');
  await new Promise(f => setTimeout(f, 300));
  ok('the full list is kept on the TV\'s storage', fs.readdirSync(path.join(DIR, 'vod')).indexOf('p1-movie.json') >= 0);
  a = await post(B + '/vod/list', q({ picked: ['SE'] }));
  ok('another language comes from the copy kept, not the provider', a.json.rows.length === 2000 && hits === 1, hits);
  a = await post(B + '/vod/list', q({ hidden: ['5'] }));
  ok('hidden categories stay out', a.json.rows.length === 0 && a.json.total === 3000);
  a = await post(B + '/vod/list', q({ refresh: true }));
  ok('a refresh asks the provider again', hits === 2, hits);
  a = await post(B + '/vod/list', q({ sig: 's2' }));
  ok('so does a changed login', hits === 3, hits);
  down = true;
  a = await post(B + '/vod/list', q({ sig: 's2', refresh: true }));
  ok('the provider down: the copy kept answers', a.status === 200 && a.json.rows.length === 1000, a.status);
  a = await post(B + '/vod/list', q({ pl: 'p9' }));
  ok('and with no copy, the reason', a.status === 502 && a.json.error, JSON.stringify(a.json));
  down = false;
  a = await post(B + '/vod/list', q({ u: 'http://' + U + '/player_api.php' }));
  ok('/vod/list takes only relay addresses on this helper', a.status === 400);
  await post(B + '/vod/forget', { pl: 'p1' });
  ok('a removed playlist\'s lists go', fs.readdirSync(path.join(DIR, 'vod')).indexOf('p1-movie.json') < 0);

  // /kv: the playlist on the TV's storage.
  const big = { channels: Array.from({ length: 50000 }, (_, i) => ({ n: 'Channel ' + i, u: 'http://h/live/u/p/' + i + '.ts' })) };
  const raw = (m, u, body, h) => new Promise((res, rej) => { const x = new URL(u); const rq = http.request({ host: x.hostname, port: x.port, path: x.pathname + x.search, method: m, headers: h || {} }, (rs) => { let t = ''; rs.on('data', d => t += d); rs.on('end', () => res({ status: rs.statusCode, text: t })); }); rq.on('error', rej); rq.end(body); });
  let k = await raw('POST', B + '/kv/put?k=playlist:p1', JSON.stringify(big));
  ok('a big playlist is kept', k.status === 200, k.status + ' ' + k.text);
  k = await raw('GET', B + '/kv/get?k=playlist:p1');
  ok('and read back whole', k.status === 200 && JSON.parse(k.text).channels.length === 50000);
  k = await raw('GET', B + '/kv/get?k=playlist:none');
  ok('nothing kept: 404', k.status === 404);
  k = await raw('POST', B + '/kv/put?k=../x', '{}');
  ok('keys can\'t leave the folder', k.status === 400);
  await raw('POST', B + '/kv/del?k=playlist:p1', '');
  k = await raw('GET', B + '/kv/get?k=playlist:p1');
  ok('and it can be removed', k.status === 404);
  r.server.close();
  const r2 = proxy.create({ ctl: 'secret' }); await new Promise(f => r2.server.listen(0, '127.0.0.1', f));
  const B2 = 'http://127.0.0.1:' + r2.server.address().port;
  k = await raw('POST', B2 + '/kv/put?k=playlist:p2', '{"a":1}');
  ok('on the TV only TiviBro can use it (the logins are in it)', k.status === 403, k.status);
  k = await raw('POST', B2 + '/kv/put?k=playlist:p2', '{"a":1}', { 'X-TiviBro-Ctl': 'secret' });
  ok('TiviBro can', k.status === 200, k.status);
  r2.server.close(); up.close();

  // The app's language tags, run in a sandbox with the real names.js and vod.js.
  const ctx = { window: {}, console, navigator: { language: 'en-US' }, Map, Promise, setTimeout, clearTimeout };
  ctx.U = { $: () => null, debounce: (f) => { const g = function () { return f.apply(null, arguments); }; g.cancel = () => {}; return g; }, el: () => ({}) };
  ctx.Store = { settings: {}, edits: { resume: {}, myList: [] }, playlist: { id: 'p', type: 'xtream' } };
  vm.createContext(ctx);
  for (const f of ['names.js', 'vodview.js', 'vod.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\n;this.Names = typeof Names !== "undefined" ? Names : this.Names; this.Vod = typeof Vod !== "undefined" ? Vod : this.Vod; this.VodView = typeof VodView !== "undefined" ? VodView : this.VodView;', ctx, { filename: f });
  const T = ctx.Vod._test;
  ok('test hooks', !!T);
  const t = n => { const it = T.tag({ name: n }); return [it.lang, it.name, it.q || ''].join('|'); };
  ok('SE - Title', t('SE - The Dog Stars') === 'SE|The Dog Stars|', t('SE - The Dog Stars'));
  ok('SE-4K - Title', t('SE-4K - Mutiny') === 'SE|Mutiny|4K', t('SE-4K - Mutiny'));
  ok('[SE] Title', t('[SE] Nocturne') === 'SE|Nocturne|', t('[SE] Nocturne'));
  ok('EN| Title', t('EN| Heat (1995)') === 'EN|Heat (1995)|', t('EN| Heat (1995)'));
  ok('ENG becomes EN', t('ENG - Heat') === 'EN|Heat|', t('ENG - Heat'));
  ok('no tag', t('Viking Uprising (2018)') === '|Viking Uprising (2018)|', t('Viking Uprising (2018)'));
  ok('a title that starts with a word is left alone', t('It - Chapter Two') === '|It - Chapter Two|', t('It - Chapter Two'));
  ok('IN-TM- Title', t("IN-TM- Don't Trouble the Trouble") === "IN|Don't Trouble the Trouble|", t("IN-TM- Don't Trouble the Trouble"));
  ok('4K-SC - Title', t('4K-SC - Verity') === 'SC|Verity|4K', t('4K-SC - Verity'));
  ok('4K - Title: a label, no language', t('4K - Dune') === '|Dune|4K', t('4K - Dune'));
  ok('NF - Title: a service, name kept', t('NF - Under Paris') === '|NF - Under Paris|', t('NF - Under Paris'));
  ok('[X] marks adult', T.tag({ name: '[X][Studio] Something' }).adult === 1);
  { const mi = [{ id: 1, name: 'MI: Impossible', cat: '1' }]; T.view('movie', { at: 1, cats: [], items: mi }); ok('Mission: Impossible is not a tag', mi[0].name === 'MI: Impossible' && mi[0].lang === '', mi[0].name); }

  const items = [];
  for (let i = 0; i < 1000; i++) items.push({ id: i, name: (i % 4 === 0 ? 'EN - ' : i % 4 === 1 ? '' : i % 4 === 2 ? 'SE - ' : 'IN - ') + 'T' + i, cat: String(i % 5) });
  let v = T.view('movie', { at: 1, cats: [], items: items.map(x => Object.assign({}, x)) });
  ok('automatic: the TV language and untagged titles', v.items.length === 500 && v.total === 1000 && v.keep.EN && v.keep[''] && !v.keep.SE, v.items.length);
  ctx.Store.playlist.vodPrefs = { langs: ['SE'] };
  v = T.view('movie', { at: 1, cats: [], items: items.map(x => Object.assign({}, x)) });
  ok('picked languages', v.items.length === 250 && v.items.every(x => x.lang === 'SE'), v.items.length);
  ctx.Store.playlist.vodPrefs = { hide: { movie: ['0'] } };
  v = T.view('movie', { at: 1, cats: [], items: items.map(x => Object.assign({}, x)) });
  ok('hidden category leaves the list', v.items.every(x => x.cat !== '0') && v.items.length === 400, v.items.length);
  ctx.Store.playlist.vodPrefs = {};
  const one = []; for (let i = 0; i < 100; i++) one.push({ id: i, name: 'SE - T' + i, cat: '1' });
  v = T.view('movie', { at: 1, cats: [], items: one });
  ok('one language: everything shows', v.items.length === 100 && !v.keep);
  const few = []; for (let i = 0; i < 1000; i++) few.push({ id: i, name: (i < 5 ? 'EN - ' : 'SE - ') + 'T' + i, cat: '1' });
  v = T.view('movie', { at: 1, cats: [], items: few });
  ok('the TV language matches almost nothing: everything shows', v.items.length === 1000 && !v.keep, v.items.length);

  // A code TiviBro doesn't know: a language only when the provider uses it often.
  const odd = [{ id: 1, name: 'AVP - Alien vs Predator', cat: '1' }];
  for (let i = 0; i < 30; i++) odd.push({ id: 10 + i, name: 'TM - Film ' + i, cat: '1' }, { id: 100 + i, name: 'QQQ - Film ' + i, cat: '1' });
  v = T.view('movie', { at: 1, cats: [], items: odd });
  const avp = odd.find(x => x.id === 1);
  ok('rare unknown code goes back into the title', avp.name === 'AVP - Alien vs Predator' && avp.lang === '', avp.name);
  ok('common unknown code is a language', odd.find(x => x.id === 100).lang === 'QQQ' && odd.find(x => x.id === 100).name === 'Film 0');
  const ad = [{ id: 1, name: 'Film', cat: 'a' }, { id: 2, name: 'Other', cat: 'b' }];
  v = T.view('movie', { at: 1, cats: [{ id: 'a', name: 'FOR ADULTS' }, { id: 'b', name: 'Drama' }], items: ad });
  ok('adult category marks its titles', ad[0].adult === 1 && !ad[1].adult && v.adultCat.a === 1);

  const ct = []; for (let i = 0; i < 20; i++) ct.push({ id: i, name: 'Dizi ' + i, cat: 't' }, { id: 100 + i, name: 'EN - Film ' + i, cat: 'e' });
  v = T.view('movie', { at: 1, cats: [{ id: 't', name: '|TR| DIZI' }, { id: 'e', name: 'Movies' }], items: ct });
  ok('untagged titles take their category language', ct[0].lang === 'TR' && v.langs.TR === 20 && v.items.every(x => x.lang !== 'TR'), JSON.stringify(v.langs));

  // Watched marks: a finished movie or episode keeps a ✓ instead of looking never started.
  {
    const E = ctx.Store.edits; E.resume = {}; delete E.watched; E.myList = []; ctx.Store.saveEdits = () => {};
    T.done('e1', 1190, 1200);
    ok('a finished episode is watched', T.isWatched('e1') && !E.resume.e1, JSON.stringify(E));
    T.done('e2', 600, 1200);
    ok('one stopped part-way is not, and keeps its place', !T.isWatched('e2') && E.resume.e2.pos === 600);
    T.done('e3', 20, 1200);
    ok('a few seconds in counts as nothing', !T.isWatched('e3') && !E.resume.e3);
    T.done('e1', 300, 1200);
    ok('watching it again part-way keeps the mark and the new place', T.isWatched('e1') && E.resume.e1.pos === 300);
    T.mark('e1', false);
    ok('Mark unwatched clears both', !T.isWatched('e1') && !E.resume.e1);
    T.mark('m7', true);
    ok('Mark as watched marks it', T.isWatched('m7'));
    // 90% watched counts (Plex and Jellyfin's default), so stopping at a movie's credits is watched.
    T.done('m8', 6500, 7200);
    ok('stopped at the credits (90%) is watched', T.isWatched('m8') && !E.resume.m8, JSON.stringify(E.resume.m8));
    T.done('m9', 6000, 7200);
    ok('stopped at 83% is not', !T.isWatched('m9') && E.resume.m9.pos === 6000);
    T.done('e9', 250, 300);
    ok('a short clip: its last minute counts too', T.isWatched('e9'));

    // Hold OK offers one of the two, never both.
    const menus = []; ctx.UI = { menu: (t, items) => menus.push(items.filter(Boolean).map(x => x.label)) };
    const labels = (it) => { menus.length = 0; T.itemMenu(it); return menus[0]; };
    E.resume = {}; E.watched = {};
    ok('not started: Mark as watched', labels({ id: 30, name: 'A' }).indexOf('Mark as watched') >= 0 && labels({ id: 30, name: 'A' }).indexOf('Mark unwatched') < 0);
    T.mark('m31', true);
    ok('watched: Mark unwatched', labels({ id: 31, name: 'B' }).indexOf('Mark unwatched') >= 0 && labels({ id: 31, name: 'B' }).indexOf('Mark as watched') < 0);
    E.resume.m31 = { pos: 300, dur: 7200, at: 1 };
    const both = labels({ id: 31, name: 'B' });
    ok('watched and being watched again: only Mark as watched', both.indexOf('Mark as watched') >= 0 && both.indexOf('Mark unwatched') < 0, JSON.stringify(both));
    // On a show, Resume goes to the episode you're on (it used to try to play the show itself).
    const showMenu = () => T.withKind('series', () => labels({ id: 9, name: 'Nocturne' }));
    E.resume = { s9: { pos: 61, dur: 1e6, at: 1, ep: 'e42', l: 'S1 E2' }, e42: { pos: 600, dur: 1200, at: 1 } };
    ok('a show part-way through an episode: Resume S1 E2', showMenu().indexOf('Resume S1 E2') >= 0 && showMenu().indexOf('Resume') < 0, JSON.stringify(showMenu()));
    delete E.resume.e42;
    ok('its episode finished: Play the next one', showMenu().indexOf('Play S1 E2') >= 0, JSON.stringify(showMenu()));
    E.resume = { s9: { pos: 61, dur: 1e6, at: 1 } };
    ok('saved by an older version: no Resume, just Open episodes', !showMenu().some(l => /^(Resume|Play)/.test(l)) && showMenu().indexOf('Open episodes') >= 0, JSON.stringify(showMenu()));

    const fake = () => ({ style: {}, textContent: '', appendChild() {}, removeAttribute() {} });
    const el = ctx.U.el; ctx.U.el = fake;
    const row = (it) => { const r = fake(); T.renderItem(r, it); return r; };
    E.resume = {}; E.watched = {};
    T.mark('e10', true); E.resume.e11 = { pos: 300, dur: 1200, at: 1 };
    let r = row({ ep: true, id: 10, label: 'S1 E1' });
    ok('a watched episode row shows ✓ and no bar', r._t.textContent === '✓' && r._p.style.display === 'none', JSON.stringify([r._t.textContent, r._p.style.display]));
    r = row({ ep: true, id: 11, label: 'S1 E2' });
    ok('one in progress shows its bar, no ✓', r._t.textContent === '' && r._p.style.display === '' && r._pi.style.width === '25%');
    r = row({ ep: true, id: 12, label: 'S1 E3' });
    ok('one not started shows nothing', r._t.textContent === '' && r._p.style.display === 'none');
    T.mark('m20', true); E.myList = ['m20'];
    r = row({ id: 20, name: 'Heat' });
    ok('a watched movie in My list shows both', r._t.textContent === '✓  ★', r._t.textContent);

    // A show's row follows the episode you're on: its progress, and "S1 E2" under the title.
    const sEps = [1, 2, 3].map(n => ({ ep: true, id: 40 + n, season: 1, num: n }));
    const show = { id: 9, name: 'Nocturne', year: '2026' };
    const showRow = () => T.withKind('series', () => row(show));
    E.resume = {}; E.watched = {};
    E.resume.e42 = { pos: 600, dur: 1200, at: 1 };
    T.markShow('s9', sEps[1], sEps);
    ok('stopped part-way: the show remembers that episode', E.resume.s9.ep === 'e42' && E.resume.s9.l === 'S1 E2', JSON.stringify(E.resume.s9));
    r = showRow();
    ok('and its row shows that episode\'s progress', r._p.style.display === '' && r._pi.style.width === '50%', JSON.stringify([r._p.style.display, r._pi.style.width]));
    ok('with the episode under the title', /^S1 E2/.test(r._s.textContent), r._s.textContent);
    delete E.resume.e42; T.mark('e42', true);
    T.markShow('s9', sEps[1], sEps);
    r = showRow();
    ok('finished: the row moves on to the next episode, no bar yet', E.resume.s9.ep === 'e43' && /^S1 E3/.test(r._s.textContent) && r._p.style.display === 'none', JSON.stringify(E.resume.s9));
    T.mark('e43', true); T.markShow('s9', sEps[2], sEps);
    ok('the last one finished: it stays on it', E.resume.s9.ep === 'e43');
    ok('still in Continue watching', E.resume.s9.pos > 60 && E.resume.s9.dur > E.resume.s9.pos * 100);
    E.resume.s9 = { pos: 61, dur: 1e6, at: 1 };
    r = showRow();
    ok('a show saved by an older version shows no empty bar', r._p.style.display === 'none' && r._s.textContent === '2026', JSON.stringify([r._p.style.display, r._s.textContent]));
    ctx.U.el = el;

    const eps = [1, 2, 3, 4].map(id => ({ ep: true, id }));
    E.resume = {}; E.watched = {};
    ok('a new show opens on its first episode', T.openAt(eps) === 0);
    T.mark('e1', true); T.mark('e2', true);
    ok('then on the one after the last watched', T.openAt(eps) === 2, T.openAt(eps));
    E.resume.e3 = { pos: 300, dur: 1200, at: 1 };
    ok('or on the one in progress', T.openAt(eps) === 2);
    E.resume = {}; T.mark('e4', true);
    ok('all watched: the last one', T.openAt(eps) === 3);
    E.watched = {}; T.mark('e3', true);
    ok('an episode watched out of order still moves the start past it', T.openAt(eps) === 3);
  }

  console.log(fail ? fail + ' failures' : 'all movie and show list tests passed');
  process.exit(fail ? 1 : 0);
})();
