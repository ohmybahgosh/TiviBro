// One channel that keeps failing while the rest play (issue #37, app/js/deadlist.js): the "not playing
// lately" mark after two failed tries in a row, gone the moment it plays, kept per playlist across a
// restart, forgotten after three days; and the old whole-playlist warning still counts only provider errors.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) fail++; };
const SRC = fs.readFileSync(path.join(__dirname, '../../app/js/deadlist.js'), 'utf8');

const disk = {};
let now = 1.7e12;
function load(pl) {
  const panels = [], logs = [];
  const ctx = {
    console, JSON, Object, Math,
    Date: { now: () => now },
    localStorage: { getItem: k => (k in disk ? disk[k] : null), setItem: (k, v) => { disk[k] = String(v); } },
    Store: { playlist: { id: pl || 'p1', name: 'My list' } },
    Library: { data: {} },
    Log: { info: (t, m) => logs.push(m), warn: (t, m) => logs.push(m) },
    UI: { modalOpen: false, panel: (t) => panels.push(t) },
    U: { el: () => ({}) },
    App: {}, setTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.DeadList = DeadList;', ctx);
  return { D: ctx.DeadList, panels, logs, ctx };
}

{
  const { D, logs } = load();
  const a = { k: 'x:1', n: 'Arena Sports' }, b = { k: 'x:2', n: 'News' };
  const seen = [];
  D.onChange(k => seen.push(k));
  ok('a channel never tried has no mark', !D.marked(a));
  D.failed(a, '', 404);
  ok('one failed try: no mark yet (one bad moment is not a streak)', !D.marked(a) && !seen.length);
  D.played(b, '');
  D.failed(a, '', 0);
  ok('two failed tries in a row: marked, even when the TV could not play it (no provider error)', D.marked(a), disk['tivibro.deadCh']);
  ok('the other channel, which plays, is not', !D.marked(b));
  ok('the lists are told to draw that row again', seen.length === 1 && seen[0] === 'x:1', seen);
  ok('the log says which channel', logs.some(m => /Arena Sports/.test(m) && /not playing lately/.test(m)), logs);
  D.failed(a, '', 503);
  ok('a third failure keeps it marked, without telling the lists again', D.marked(a) && seen.length === 1, seen);

  // TiviBro restarts: the mark is still there.
  const r = load();
  ok('kept across a restart', r.D.marked(a));
  ok('only on its own playlist', !load('p2').D.marked(a));

  // It plays again.
  r.D.onChange(k => seen.push('again:' + k));
  r.D.played(a, '');
  ok('it plays: the mark goes at once, and the lists are told', !r.D.marked(a) && seen.indexOf('again:x:1') >= 0, seen);
  ok('and it stays gone after a restart', !load().D.marked(a));
}

{
  // Failures days apart are not a streak, and a mark fades after three days.
  const { D } = load();
  const c = { k: 'x:9', n: 'Old' };
  D.failed(c, '', 404);
  now += 4 * 24 * 3600e3;
  D.failed(c, '', 404);
  ok('two failures four days apart: no mark', !D.marked(c));
  D.failed(c, '', 404);
  ok('two in a row: marked', D.marked(c));
  now += 3 * 24 * 3600e3 + 1000;
  ok('three days later the mark fades', !D.marked(c));
}

{
  // At most 300 channels are kept per playlist: the oldest go first.
  const { D } = load('big');
  for (let i = 0; i < 320; i++) { now += 1000; D.failed({ k: 'b:' + i }, '', 404); D.failed({ k: 'b:' + i }, '', 404); }
  const kept = Object.keys(JSON.parse(disk['tivibro.deadCh']).big);
  ok('a playlist keeps at most 300 channels', kept.length === 300 && kept.indexOf('b:0') < 0 && kept.indexOf('b:319') >= 0, kept.length);
}

{
  // The whole-playlist warning (issue #25) still counts provider errors only.
  const { D, panels } = load('warn');
  for (let i = 0; i < 6; i++) D.failed({ k: 'w:' + i }, '', 0);
  ok('channels the TV could not decode do not bring the playlist warning', !panels.length);
  for (let i = 0; i < 6; i++) D.failed({ k: 'v:' + i }, '', 404);
  ok('five provider errors and nothing playing still do', panels.length === 1, panels);
}

{
  // The player counts each failed try once, live channels only (not catch-up or movies).
  const src = fs.readFileSync(path.join(__dirname, '../../app/js/player.js'), 'utf8');
  ok('player.js counts every failed live try once', /cur\.live && !cur\.timeshift && !cur\.deadCounted && window\.DeadList/.test(src) && /DeadList\.failed\(cur\.ch, cur\.origUrl \|\| cur\.url, cur\.lastHttp \|\| 0\)/.test(src));
  const views = fs.readFileSync(path.join(__dirname, '../../app/js/views.js'), 'utf8');
  ok('the channel lists and the guide draw the mark', /row\._d = U\.el\('span', 'deadtag', 'not playing lately'\)/.test(views) && /'deadtag', 'not playing'\)/.test(views));
  const phone = fs.readFileSync(path.join(__dirname, '../../app/js/phone.js'), 'utf8');
  ok('the phone app gets it in the channel list and the guide', /x\.dead = 1/.test(phone) && /row\.dead = 1/.test(phone));
}

console.log(fail ? fail + ' failures' : 'all not-playing-lately tests passed');
process.exit(fail ? 1 : 0);
