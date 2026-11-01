/* Questions for TiviBro from the phone (POST /v1/ask in service/companion.js): the phone waits for
   TiviBro's answer, sealed requests get sealed answers, logins and backups only travel sealed, and
   automatic backups never open TiviBro.
     node tests/unit/companion-ask.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Companion = require('../../service/companion.js');
const C = require('../../scripts/companion/tb-phone.js');

let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-ask-'));
const launched = [];
let open = true;
const c = Companion.create({ dir, version: 'test', log: () => {}, launch: (p, cb) => { launched.push(p); cb(null); }, sysinfo: (cb) => cb({ model: 'X', webos: '1', name: 'Den' }), app: () => ({ open }), editor: () => null });
function ctl(u, body) {
  return new Promise((resolve) => {
    const res = Object.assign(new (require('events'))(), { code: 0, writeHead(x) { this.code = x; }, end(b) { resolve({ code: this.code, j: JSON.parse(b) }); } });
    const req = new (require('events'))(); req.method = body ? 'POST' : 'GET'; req.url = u;
    c.control(req, res, u.split('?')[0]);
    process.nextTick(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A pretend TiviBro that answers questions.
let seq = 0, seen = [], stop = false;
async function tivibro() {
  while (!stop) {
    const n = (await ctl('/companion/next?since=' + seq)).j;
    seq = Math.max(seq, n.seq || 0);
    for (const cmd of n.cmds) {
      seen.push(cmd);
      if (cmd.type !== 'ask') continue;
      if (cmd.what === 'fav') await ctl('/companion/answer', { id: cmd.id, ok: true, data: { on: cmd.args.on } });
      else if (cmd.what === 'playlist') await ctl('/companion/answer', { id: cmd.id, ok: false, error: 'The provider said the login is wrong.' });
      else if (cmd.what === 'backup') await ctl('/companion/answer', { id: cmd.id, ok: true, data: { backup: { app: 'TiviBro', kind: 'backup', settings: { playlists: [{ pass: 'secret' }] } } } });
      else if (cmd.what === 'guide') { /* never answers: the phone gets "pending" */ }
    }
  }
}

(async () => {
  await ctl('/companion/set', { on: true });
  const s = (await ctl('/companion/pair', { open: true })).j;
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Asker' });
  tivibro();

  let r = await C.ask(cred, 'fav', { k: 'x|1', on: true });
  ok('a question waits for TiviBro\'s answer', r.ok && r.data && r.data.on === true, JSON.stringify(r));
  ok('TiviBro sees who asked, and what', seen.some((x) => x.type === 'ask' && x.what === 'fav' && x.from === 'Asker' && x.args.k === 'x|1'));

  let e = await C.ask(cred, 'format-the-tv', {}).catch((x) => x);
  ok('unknown questions are refused', e.code === 'bad');
  e = await C.ask(cred, 'backup', {}).catch((x) => x);
  ok('a backup is refused unless sealed', e.code === 'sealed');
  e = await C.ask(cred, 'playlist', { link: 'http://h/get.php?username=a&password=b' }).catch((x) => x);
  ok('so is a provider link', e.code === 'sealed');

  r = await C.ask(cred, 'backup', {}, { seal: true });
  ok('a sealed backup comes back, opened by the phone', r.ok && r.data.backup.settings.playlists[0].pass === 'secret', JSON.stringify(r));
  const raw = await C.call(cred, 'POST', '/v1/ask', { sealed: C.seal({ what: 'backup', args: {} }, Buffer.from(cred.key, 'base64'), 'req', cred.phone, 'n'.repeat(24)) }, { nonce: 'n'.repeat(24), raw: true });
  ok('and nothing in it is readable on the network', raw.signed && raw.json.sealed && !/secret|TiviBro/.test(raw.buf.toString()), raw.buf.toString().slice(0, 200));
  const other = await C.call(cred, 'POST', '/v1/ask', { sealed: C.seal({ what: 'backup', args: {} }, Buffer.from(cred.key, 'base64'), 'req', cred.phone, 'a'.repeat(24)) }, { nonce: 'b'.repeat(24), raw: true });
  ok('a sealed body moved to another request is refused', other.status === 400 && other.json.code === 'sealed', JSON.stringify(other.json));

  e = await C.ask(cred, 'playlist', { link: 'http://h/get.php?username=a&password=b' }, { seal: true }).catch((x) => x);
  ok('TiviBro\'s reason comes back when it can\'t do it', e.code === 'tv' && /login is wrong/.test(e.message), e.message);
  ok('and the link reached TiviBro whole', seen.some((x) => x.what === 'playlist' && /password=b/.test(x.args.link)));

  open = false;
  const before = launched.length;
  r = await C.ask(cred, 'backup', {}, { seal: true, noOpen: true });
  ok('automatic backups never open TiviBro', r.ok && r.closed === true && launched.length === before, JSON.stringify(r));
  open = true;

  const t0 = Date.now();
  stop = true;
  r = await C.ask(cred, 'remind', { k: 'x', s: 1 });
  ok('no answer in time: the phone hears it is still pending', r.ok && r.pending === true && Date.now() - t0 >= 14000, JSON.stringify(r) + ' ' + (Date.now() - t0));

  c.stop();
  console.log(fails ? fails + ' failures' : 'all phone question tests passed');
  process.exit(fails ? 1 : 0);
})();
