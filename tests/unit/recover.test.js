/* Putting back what the TV cleared (issue #196): the helper's /kv/list and /kv/peek (service/kv.js), and the
   app's copy of its browser storage and what it offers on a start with no playlist (app/js/recover.js).
     node tests/unit/recover.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-recover-'));
process.env.TIVIBRO_KV_DIR = dir;
const KV = require('../../service/kv.js');

// A request to kv.handle, answered as { code, body }.
function call(method, url, body) {
  return new Promise((done) => {
    const { Readable } = require('stream');
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = method; req.url = url;
    const { Writable } = require('stream'), parts = [];
    const res = new Writable({ write(c, e, cb) { parts.push(Buffer.from(c)); cb(); } });
    res.writeHead = (c) => { res.code = c; };
    res.on('finish', () => { const t = Buffer.concat(parts).toString(); done({ code: res.code, body: t ? JSON.parse(t) : null }); });
    KV.handle(req, res, {}, null);
  });
}

/* The app's side in a page of its own: localStorage, the helper's kv store (these files), a menu that
   records what it offered. */
function page(store, settings) {
  const ls = new Map(Object.entries(store || {}));
  const menus = [], toasts = [];
  const ctx = {
    console, Promise, JSON, setTimeout: (f) => { ctx._timers.push(f); return 1; }, _timers: [],
    TIVIBRO_VERSION: '0.6.0-test',
    localStorage: { get length() { return ls.size; }, key: (i) => [...ls.keys()][i], getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    location: { reload() { ctx.reloaded = true; } },
    Net: { port: 1, info: { kv: 1 }, ctlFetch: (url, o) => {
      const u = url.replace('http://127.0.0.1:1', ''), body = o && o.body;
      return call(o && o.method || 'GET', u, typeof body === 'string' ? body : undefined).then((r) => ({ ok: r.code === 200, status: r.code, json: () => Promise.resolve(r.body) }));
    } },
    Store: { settings: settings || { playlists: [] }, freeze() { ctx.frozen = true; }, saveSettings() {}, upsertPlaylist(p) { this.settings.playlists.push(p); }, bigGet: () => Promise.resolve([]) },
    UI: { menu: (title, items, back) => menus.push({ title, items, back }) },
    U: { toast: (t) => toasts.push(t), hhmm: () => '12:00', loc: () => 'en' },
    I18n: { t: (s, v) => s.replace(/\{(\w)\}/g, (a, k) => (v && v[k] != null ? v[k] : a)), raw: (s) => s },
    Log: { info() {}, warn() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/recover.js'), 'utf8') + ';this.Recover = Recover;', ctx);
  return { ctx, ls, menus, toasts, R: ctx.Recover };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  // peek: the small fields in front, up to the lists.
  ok('peek: an Xtream Codes login in front of the channels', JSON.stringify(KV.peek('{"server":"http://a.b:8080","user":"u\\"1","pass":"p","groups":[{"n":"x"}],"channels":[{"server":"no"}]}')) === '{"server":"http://a.b:8080","user":"u\\"1","pass":"p"}');
  ok('peek: stops at the first list or object', JSON.stringify(KV.peek('{"at":5,"added":{"user":"no"},"user":"later"}')) === '{"at":5}');
  ok('peek: nothing from something that isn\'t JSON', JSON.stringify(KV.peek('not json')) === '{}');

  // list and peek through the routes.
  fs.mkdirSync(path.join(dir, 'kv'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'kv', 'playlist~pold1.json'), '{"server":"http://prov.example:80","user":"me","pass":"secret","groups":[],"channels":[]}');
  fs.writeFileSync(path.join(dir, 'kv', 'playlist~pm3u.json'), '{"groups":[],"channels":[]}');
  fs.writeFileSync(path.join(dir, 'kv', 'live~abcdef12.json'), '{"groups":[]}');
  fs.writeFileSync(path.join(dir, 'kv', 'snaps~pold1.json'), '[]');
  let r = await call('GET', '/kv/list?p=playlist:');
  ok('list: the kept channel lists only (not snaps, not a list still being made)', r.code === 200 && r.body.items.map((x) => x.k).sort().join() === 'playlist:pm3u,playlist:pold1' && r.body.items.every((x) => x.size > 0 && x.at > 0), JSON.stringify(r.body));
  r = await call('GET', '/kv/list?p=../x');
  ok('list: a prefix that isn\'t a key is refused', r.code === 400);
  r = await call('GET', '/kv/peek?k=playlist:pold1');
  ok('peek route: the login', r.code === 200 && r.body.user === 'me' && r.body.pass === 'secret' && !r.body.groups);
  r = await call('GET', '/kv/peek?k=playlist:gone');
  ok('peek route: 404 for nothing', r.code === 404);

  // The copy: never made with no playlist (a cleared TV must not write over it), made 20 s after a save.
  let p = page({ 'tivibro.settings': '{"playlists":[]}' });
  ok('no copy while there is no playlist', (await p.R._test.save()) === false && !fs.existsSync(path.join(dir, 'kv', 'mirror~ls.json')));
  p = page({ 'tivibro.settings': '{"playlists":[{"id":"p1","type":"m3u","m3u":"http://x/y.m3u"}]}', 'tivibro.edits.p1': '{"hidden":["a"]}', 'tivibro.log': '[big]', 'other.app': '1' }, { playlists: [{ id: 'p1' }] });
  p.R.changed(); p.R.changed();
  ok('a save waits (one timer for many saves)', p.ctx._timers.length === 1);
  await p.ctx._timers[0]();
  const copy = JSON.parse(fs.readFileSync(path.join(dir, 'kv', 'mirror~ls.json'), 'utf8'));
  ok('the copy holds TiviBro\'s storage, without the log or anyone else\'s', copy.data['tivibro.edits.p1'] && copy.data['tivibro.settings'] && !copy.data['tivibro.log'] && !copy.data['other.app'] && copy.version === '0.6.0-test');

  // A cleared TV with the copy: offered, and putting it back restores every item and restarts.
  p = page({});
  let next = 0;
  ok('a start with no playlist and a copy: asked', (await p.R.check(() => next++)) === true && p.menus[0].title === 'Your settings on this TV were cleared');
  p.menus[0].items[0].action();
  ok('Put everything back: the items written, saving frozen, a restart', p.ls.get('tivibro.edits.p1') === '{"hidden":["a"]}' && p.ctx.frozen && p.ctx._timers.length === 1);
  p.ctx._timers[0]();
  ok('…and TiviBro restarts', p.ctx.reloaded === true);
  p = page({});
  await p.R.check(() => next++);
  p.menus[0].items[1].action();
  await tick();
  ok('Start fresh: the copy is deleted, the set-up screen next', next === 1 && !fs.existsSync(path.join(dir, 'kv', 'mirror~ls.json')));

  // No copy (an older TiviBro): the Xtream Codes login in a kept list, back under its old id.
  p = page({});
  ok('no copy, a kept Xtream list: asked', (await p.R.check(() => next++)) === true && p.menus[0].title === 'Your playlist from before is still on this TV' && p.menus[0].items.length === 2, JSON.stringify(p.menus[0] && p.menus[0].items.map((x) => x.label)));
  p.menus[0].items[0].action();
  const back = p.ctx.Store.settings.playlists[0];
  ok('the playlist comes back with its old id and login', back && back.id === 'pold1' && back.type === 'xtream' && back.server === 'http://prov.example:80' && back.user === 'me' && back.pass === 'secret' && p.ctx.Store.settings.active === 'pold1');
  ok('…and its restore points are offered after the restart', JSON.parse(p.ls.get('tivibro.recovered')).id === 'pold1');
  fs.unlinkSync(path.join(dir, 'kv', 'playlist~pold1.json'));
  p = page({});
  ok('nothing kept: the set-up screen as always', (await p.R.check(() => next++)) === false && !p.menus.length);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' failures' : 'all recover checks passed');
  process.exit(fails ? 1 : 0);
})();
