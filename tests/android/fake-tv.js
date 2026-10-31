/* A stand-in TV for the Android app's tests: the real phone app connection (service/companion.js) with
   pairing open, the real web editor running (port 18787), and a pretend TiviBro on top: it answers the
   helper's long poll like the TV app does, sends a channel list when asked, plays what a phone picks and
   says so, and has a volume.  Prints "host:port:CODE:TVID" once
   ready, and keeps running.
     node tests/android/fake-tv.js > /tmp/fake-tv.txt & */
'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
const Companion = require('../../service/companion.js');
const editor = require('../../service/editor.js').create(() => {});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-fake-tv-'));
const vol = { level: 12, muted: false };
const c = Companion.create({ dir, version: 'fake-tv', log: () => {}, launch: (p, cb) => cb(null), sysinfo: (cb) => cb({ model: 'FAKE', webos: '0', name: 'Fake TV' }), app: () => ({ open: true }), editor: () => editor,
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
function sendState() { return ctl('/companion/state', { state: { tab: 'live', full: true, playing: { k: playing.k, name: playing.n, num: playing.num, logo: '', group: 'News' }, now: playing.now, next: { t: 'Late Edition', s: t0 + 60 * 60000 }, paused } }); }
async function tivibro() {
  await sendState();
  for (;;) {
    const j = await ctl('/companion/next?since=' + seq);
    seq = Math.max(seq, j.seq || 0);
    if (j.wantLineup) await ctl('/companion/lineup', { groups, channels: chans });
    for (const cmd of j.cmds || []) {
      if (cmd.type === 'play') playing = chans.find((x) => x.k === cmd.k) || playing;
      if (cmd.type === 'key' && cmd.key === 'chup') playing = chans[(chans.indexOf(playing) + 1) % chans.length];
      if (cmd.type === 'key' && cmd.key === 'playpause') paused = !paused;
      await sendState();
    }
  }
}
