/* A stand-in TV for the Android app's tests: the real phone app connection (service/companion.js) with
   pairing open, the real web editor running (port 18787), and a pretend TiviBro on top: it answers the
   helper's long poll like the TV app does, sends a channel list when asked, plays what a phone picks and
   says so, has a volume, and answers the phone's questions (guide, favorites, movies, typing, backups).  Prints "host:port:CODE:TVID" once
   ready, and keeps running.
     node tests/android/fake-tv.js > /tmp/fake-tv.txt & */
'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
const Companion = require('../../service/companion.js');
const editor = require('../../service/editor.js').create(() => {});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-fake-tv-'));
const vol = { level: 12, muted: false };
const look = { title: 'Appearance', trail: ['Appearance'], rows: [{ i: 0, kind: 'head', label: 'Look' }, { i: 1, kind: 'toggle', label: 'Show clock', sub: '', on: true }, { i: 2, kind: 'choice', label: 'Numbers', sub: 'Even width lines up channel numbers.', options: ['TV font', 'Even width', 'Fixed width, slashed zero'], cur: 0, value: 'TV font' }, { i: 3, kind: 'page', label: 'Manage groups', sub: '', value: '' }] };
const c = Companion.create({ dir, version: 'fake-tv', log: () => {}, launch: (p, cb) => { console.log('LAUNCHED ' + JSON.stringify(p)); cb(null); }, sysinfo: (cb) => cb({ model: 'FAKE', webos: '0', name: 'Fake TV' }), app: () => ({ open: true }), editor: () => editor,
  volume: (d, cb) => { if (d === 'up') vol.level++; else if (d === 'down') vol.level--; else vol.muted = !vol.muted; cb(null, Object.assign({}, vol)); } });
function ctl(u, body) {
  return new Promise((resolve) => {
    const res = Object.assign(new (require('events'))(), { writeHead() {}, end(b) { resolve(JSON.parse(b)); } });
    const req = new (require('events'))(); req.method = body ? 'POST' : 'GET'; req.url = u;
    c.control(req, res, u.split('?')[0]);
    process.nextTick(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
(async () => {
  await new Promise((r) => editor.start(18787, 'ABCD-EFGH', r));
  await ctl('/companion/set', { on: true });
  const s = await ctl('/companion/pair', { open: true });
  console.log('127.0.0.1:' + s.port + ':' + s.pairing.code.replace(/-/g, '') + ':' + s.id);
  tivibro();
})();

// The pretend TiviBro: 40 channels in three groups, a guide entry on each, and Play on TV.
const NAMES = ['Nova News 24', 'Metro Report', 'Global Desk', 'Capitol Wire', 'Big Ten 10', 'Big Ten 14', 'Arena Sports', 'Goal Line', 'Kitchen Live', 'Wild Planet'];
const SHOWS = ['World Tonight', 'Business Hour', 'Morning Briefing', 'The Debate Room', 'Michigan vs Ohio State', 'Purdue at Iowa', 'Fourth Quarter', 'Matchday', 'Supper Club', 'River Kings'];
const t0 = Date.now() - 20 * 60000;
const chans = Array.from({ length: 40 }, (_, i) => ({ k: 'fake|' + (i + 1), n: NAMES[i % 10] + (i >= 10 ? ' ' + (Math.floor(i / 10) + 1) : ''), num: i + 1, logo: '', fav: i < 3 ? 1 : 0, now: { t: SHOWS[i % 10], s: t0, e: t0 + 60 * 60000 } }));
const groups = [{ id: 'fav', name: 'Favorites', keys: chans.slice(0, 3).map((x) => x.k) }, { id: 'news', name: 'News', keys: chans.filter((x, i) => i % 10 < 4).map((x) => x.k) }, { id: 'sports', name: 'Sports', keys: chans.filter((x, i) => i % 10 >= 4 && i % 10 < 8).map((x) => x.k) }];
let seq = 0, playing = chans[0], paused = false;
function sendState() { return ctl('/companion/state', { state: { tab: 'live', full: true, playing: { k: playing.k, name: playing.n, num: playing.num, logo: '', group: 'News' }, now: playing.now, next: { t: 'Late Edition', s: t0 + 60 * 60000 }, paused, inputs: [{ id: 1, label: 'Rename group', type: 'text', value: 'Sports', submit: 1 }] } }); }
async function tivibro() {
  await sendState();
  for (;;) {
    const j = await ctl('/companion/next?since=' + seq);
    seq = Math.max(seq, j.seq || 0);
    if (j.wantLineup) await ctl('/companion/lineup', { groups, channels: chans });
    for (const cmd of j.cmds || []) {
      if (cmd.type === 'ask') { await answer(cmd); continue; }
      if (cmd.type === 'play') playing = chans.find((x) => x.k === cmd.k) || playing;
      if (cmd.type === 'key' && cmd.key === 'chup') playing = chans[(chans.indexOf(playing) + 1) % chans.length];
      if (cmd.type === 'key' && cmd.key === 'playpause') paused = !paused;
      await sendState();
    }
  }
}

// Questions from the phone (POST /v1/ask), answered like app/js/phone.js does.
const progs = (i) => [0, 1, 2].map((n) => ({ t: SHOWS[(i + n) % 10], s: t0 + n * 60 * 60000, e: t0 + (n + 1) * 60 * 60000 }));
const movies = Array.from({ length: 30 }, (_, i) => ({ id: 5000 + i, n: 'Movie ' + (i + 1), c: '', r: '7.1', y: '2024' }));
let typed = '';
async function answer(cmd) {
  const a = cmd.args || {}, say = (data) => ctl('/companion/answer', { id: cmd.id, ok: true, data }), no = (error) => ctl('/companion/answer', { id: cmd.id, ok: false, error });
  if (cmd.what === 'guide') { const list = a.group ? (groups.find((g) => g.id === a.group) || { keys: [] }).keys : chans.map((c) => c.k); const off = a.offset || 0, lim = a.limit || 60; return say({ total: list.length, offset: off, pending: 0, rows: list.slice(off, off + lim).map((k) => ({ k, p: progs(chans.findIndex((c) => c.k === k)), a: 1 })) }); }
  if (cmd.what === 'schedule') return say({ k: a.k, arch: 3, progs: progs(1).map((p) => Object.assign({ d: 'About ' + p.t }, p)) });
  if (cmd.what === 'fav') { const c = chans.find((x) => x.k === a.k); if (!c) return no('That channel isn\'t in this playlist.'); c.fav = a.on ? 1 : 0; return say({ on: !!c.fav }); }
  if (cmd.what === 'remind') return say({ on: a.on !== false });
  if (cmd.what === 'settings') {
    if (a.op === 'sections') return say({ sections: [{ id: 'playback', title: 'Playback and buffering' }, { id: 'look', title: 'Appearance' }] });
    look.rows[1].on = a.op === 'toggle' && a.i === 1 ? a.on : look.rows[1].on;
    if (a.op === 'choice' && a.i === 2) { look.rows[2].cur = a.v; look.rows[2].value = look.rows[2].options[a.v]; }
    return a.op === 'page' ? say(look) : say({ msg: '', page: look });
  }
  if (cmd.what === 'chan') { const c = chans.find((x) => x.k === a.k); if (!c) return no('That channel isn\'t in this playlist.'); return say({ k: c.k, name: c.n, provider: c.n, renamed: false, hidden: false, group: 'News', groups: [{ id: 'c_mine', name: 'My sports', has: 0 }], team: { id: 'nfl:det', name: 'Detroit Lions', on: a.op === 'follow' && a.on !== false ? 1 : 0 }, msg: a.op === 'info' ? '' : 'Done' }); }
  if (cmd.what === 'vodcats') return say({ cats: [{ id: '_all', n: 'All movies', count: movies.length }, { id: '100', n: 'Action', count: 10 }] });
  if (cmd.what === 'voditems') { const off = a.offset || 0, lim = a.limit || 120; const l = a.q ? movies.filter((m) => m.n.toLowerCase().includes(String(a.q).toLowerCase())) : movies; return say({ total: l.length, offset: off, items: l.slice(off, off + lim) }); }
  if (cmd.what === 'vodinfo') return say(a.kind === 'series' ? { id: a.id, n: 'A Show', plot: 'Things happen.', seasons: [{ s: 1, eps: [{ id: 9001, e: 1, t: 'Pilot', dur: '45 min', pos: 600, len: 2700 }] }] } : { id: a.id, n: 'Movie 1', plot: 'A film.', year: '2024', pos: 0, len: 0 });
  if (cmd.what === 'vodplay') return say({ title: 'Movie 1' });
  if (cmd.what === 'input') { typed = a.value; return say({ ok: true }); }
  if (cmd.what === 'playlist') return a.link && a.link.includes('password=') ? say({ msg: 'Added "Shared" with 40 channels' }) : no('That is only a server address.');
  if (cmd.what === 'backup') return say({ backup: { app: 'TiviBro', kind: 'backup', format: 2, version: 'fake-tv', created: new Date().toISOString(), settings: { playlists: [{ id: 'p1', name: 'Fake', type: 'xtream', pass: 'secret' }] }, edits: {}, snaps: {} } });
  if (cmd.what === 'restore') return a.backup && a.backup.kind === 'backup' ? say({ playlists: a.backup.settings.playlists.length }) : no('This is not a TiviBro backup file.');
  return no('unknown');
}
