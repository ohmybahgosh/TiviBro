#!/usr/bin/env node
/* A reference client for the TiviBro phone app protocol (service/companion.js,
   docs/wiki/Phone-app-protocol.md): what the Android app does, in plain Node, for tests and for
   trying a real TV from a computer.
     node scripts/companion/tb-phone.js discover
     node scripts/companion/tb-phone.js pair 192.168.1.20 ABCD-EFGH-JKMN     (code from the TV)
     node scripts/companion/tb-phone.js info | open | editor | state | lineup | forget
     node scripts/companion/tb-phone.js key ok | action guide | play <key> | text michigan | volume up
   The pairing (TV address, ids and this "phone"'s key) is kept in ~/.tivibro-phone.json (mode 600),
   or TB_PHONE_FILE. */
'use strict';
const crypto = require('crypto');
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 47810, DISCOVER = 'tivibro-discover-v1', KDF_ITER = 100000;
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex');
const sha256 = (buf) => crypto.createHash('sha256').update(buf || '').digest('hex');
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pairKey = (code, tvId) => crypto.pbkdf2Sync(norm(code), 'tivibro-pair-v1:' + tvId, KDF_ITER, 32, 'sha256');

function hostPort(h) { const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(String(h).trim()); return { host: m[1], port: +(m[2] || PORT) }; }

function raw(target, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const req = http.request({ host: target.host, port: target.port, method, path: p, agent: false, timeout: p === '/v1/ask' ? 150000 : 15000,   // questions wait for TiviBro
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, buf, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

// TVs on this network: a broadcast to UDP 47810, answers for `ms`.  `to` overrides the address (tests).
function discover(ms, to) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4'), found = {};
    s.on('message', (m, r) => { try { const j = JSON.parse(m.toString('utf8')); if (j.app === 'TiviBro') found[j.id] = Object.assign(j, { host: r.address }); } catch (e) {} });
    s.on('error', () => {});
    s.bind(0, () => {
      s.setBroadcast(true);
      const msg = Buffer.from(DISCOVER);
      const send = () => s.send(msg, 0, msg.length, (to && to.port) || PORT, (to && to.host) || '255.255.255.255');
      send(); setTimeout(send, 300);
    });
    setTimeout(() => { s.close(); resolve(Object.values(found)); }, ms || 1500);
  });
}

async function hello(target) {
  const r = await raw(target, 'GET', '/v1/hello');
  if (r.status !== 200 || !r.json || r.json.app !== 'TiviBro') throw new Error('No TiviBro at ' + target.host + ':' + target.port);
  return r.json;
}

async function pair(target, code, phone) {
  const h = await hello(target);
  const kp = pairKey(code, h.id), nonce = crypto.randomBytes(18).toString('base64');
  const name = (phone && phone.name) || os.hostname();
  const r = await raw(target, 'POST', '/v1/pair', { nonce, phone: { name, model: (phone && phone.model) || 'Node ' + process.version, platform: (phone && phone.platform) || 'cli' }, proof: hmac(kp, 'tivibro-pair-v1\n' + h.id + '\n' + nonce + '\n' + name) });
  if (r.status !== 200) { const e = new Error((r.json && r.json.error) || 'pairing failed (' + r.status + ')'); e.code = r.json && r.json.code; e.status = r.status; throw e; }
  const j = r.json;
  if (j.proof !== hmac(kp, 'tivibro-paired-v1\n' + j.phone + '\n' + nonce)) throw new Error('The TV did not prove it knows the code.  Not this TV?');
  const d = crypto.createDecipheriv('aes-256-gcm', kp, Buffer.from(j.key.iv, 'base64'));
  d.setAAD(Buffer.from('tivibro-key-v1\n' + j.phone, 'utf8'));
  d.setAuthTag(Buffer.from(j.key.tag, 'base64'));
  const key = Buffer.concat([d.update(Buffer.from(j.key.data, 'base64')), d.final()]);
  return { host: target.host, port: target.port, tv: j.tv, phone: j.phone, key: key.toString('base64'), offset: h.now - Date.now() };
}

// A signed request; checks the TV's signature on the answer.
async function call(cred, method, p, body, opts) {
  opts = opts || {};
  const key = Buffer.from(cred.key, 'base64'), data = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
  const t = opts.time || (Date.now() + (cred.offset || 0)), nonce = opts.nonce || crypto.randomBytes(18).toString('base64');
  const sig = hmac(key, 'tivibro-req-v1\n' + method + '\n' + p + '\n' + t + '\n' + nonce + '\n' + sha256(data));
  const r = await raw({ host: cred.host, port: cred.port }, method, p, body === undefined ? undefined : data.toString('utf8'), { 'X-TiviBro-Phone': cred.phone, 'X-TiviBro-Time': String(t), 'X-TiviBro-Nonce': nonce, 'X-TiviBro-Sig': opts.sig || sig });
  const want = hmac(key, 'tivibro-res-v1\n' + nonce + '\n' + r.status + '\n' + sha256(r.buf));
  r.signed = r.headers['x-tivibro-sig'] === want;
  if (opts.raw) return r;
  /* An unsigned answer can't be trusted.  The one the TV can't sign is "unpaired" (it no longer has
     the key), so its code is passed on, marked unsigned: an app says so, but keeps the TV until the
     user decides, since anyone on the network could send that. */
  if (!r.signed) { const e = new Error('The answer was not signed by this TV' + (r.json && r.json.error ? ': ' + r.json.error : ' (' + r.status + ')')); e.code = r.json && r.json.code; e.unsigned = true; throw e; }
  if (r.status >= 400) { const e = new Error((r.json && r.json.error) || 'failed (' + r.status + ')'); e.code = r.json && r.json.code; throw e; }
  return r.json;
}

/* A question for TiviBro on the TV (POST /v1/ask): the guide, movies and shows, favorites, reminders,
   typing, adding a playlist, backups.  With opts.seal the request and the answer are sealed (AES-256-GCM
   under a key made from the phone's key), for logins and backups. */
const sealKey = (key) => crypto.createHmac('sha256', key).update('tivibro-seal-v1', 'utf8').digest();
const sealAad = (dir, phone, nonce) => Buffer.from('tivibro-seal-' + dir + '-v1\n' + phone + '\n' + nonce, 'utf8');
function seal(obj, key, dir, phone, nonce) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', sealKey(key), iv);
  c.setAAD(sealAad(dir, phone, nonce));
  const data = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return { iv: iv.toString('base64'), data: data.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function unseal(box, key, dir, phone, nonce) {
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(key), Buffer.from(box.iv, 'base64'));
  d.setAAD(sealAad(dir, phone, nonce)); d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}
async function ask(cred, what, args, opts) {
  opts = opts || {};
  const body = { what, args: args || {} };
  if (opts.noOpen) body.noOpen = true;
  if (!opts.seal) return call(cred, 'POST', '/v1/ask', body);
  const key = Buffer.from(cred.key, 'base64'), nonce = crypto.randomBytes(18).toString('base64');
  const r = await call(cred, 'POST', '/v1/ask', { sealed: seal(body, key, 'req', cred.phone, nonce) }, { nonce, raw: true });
  if (!r.signed) { const e = new Error('The answer was not signed by this TV' + (r.json && r.json.error ? ': ' + r.json.error : ' (' + r.status + ')')); e.code = r.json && r.json.code; e.unsigned = true; throw e; }
  // Errors before the TV could open the request come back plain; everything after, sealed.
  const j = r.json && r.json.sealed ? unseal(r.json.sealed, key, 'res', cred.phone, nonce) : r.json;
  if (r.status >= 400) { const e = new Error((j && j.error) || 'failed (' + r.status + ')'); e.code = j && j.code; throw e; }
  return j;
}

module.exports = { discover, hello, pair, call, ask, seal, unseal, pairKey, hmac, sha256, PORT };

if (require.main === module) {
  const FILE = process.env.TB_PHONE_FILE || path.join(os.homedir(), '.tivibro-phone.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { throw new Error('Not paired yet: run  pair <tv address> <code>'); } };
  const [cmd, a, b] = process.argv.slice(2);
  (async () => {
    if (cmd === 'discover') { const l = await discover(2000); if (!l.length) console.log('No TiviBro TVs answered.  Is Settings, Phone app, Phone app connection on?'); l.forEach((t) => console.log(t.name + '  ' + t.host + ':' + t.port + '  TiviBro ' + t.version + '  id ' + t.id)); return; }
    if (cmd === 'pair') { const c = await pair(hostPort(a), b, {}); fs.writeFileSync(FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); console.log('Paired with ' + c.tv.name + ' (' + c.host + ':' + c.port + ').  Saved in ' + FILE); return; }
    const cred = load();
    if (cmd === 'info') return console.log(JSON.stringify(await call(cred, 'GET', '/v1/info'), null, 2));
    if (cmd === 'open') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/open', {})));
    if (cmd === 'editor') {
      for (let i = 0; i < 20; i++) { const r = await call(cred, 'POST', '/v1/editor', {}); if (r.state !== 'starting') return console.log(r.url || JSON.stringify(r)); console.log(r.message); await new Promise((x) => setTimeout(x, 2000)); }
      return console.log('The editor did not start.');
    }
    if (cmd === 'key') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/key', { key: a })));
    if (cmd === 'action') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/action', { action: a })));
    if (cmd === 'play') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/play', { k: a })));
    if (cmd === 'text') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/text', { text: a })));
    if (cmd === 'volume') return console.log(JSON.stringify(await call(cred, 'POST', '/v1/volume', { dir: a })));
    if (cmd === 'state') return console.log(JSON.stringify(await call(cred, 'GET', '/v1/state'), null, 2));
    if (cmd === 'lineup') {
      for (let i = 0; i < 10; i++) { const l = await call(cred, 'GET', '/v1/lineup'); if (l.channels) { l.channels.slice(0, +a || 20).forEach((x) => console.log((x.num + '').padStart(5) + '  ' + x.n + (x.now ? '   ' + x.now.t : '') + '   ' + x.k)); return console.log(l.channels.length + ' channels, ' + l.groups.length + ' groups'); } if (l.closed) return console.log('TiviBro is closed on the TV.'); await new Promise((r) => setTimeout(r, 1500)); }
      return console.log('TiviBro did not send its channel list.');
    }
    if (cmd === 'forget') { await call(cred, 'POST', '/v1/forget', {}); fs.unlinkSync(FILE); return console.log('Removed from the TV.'); }
    console.log('Commands: discover, pair <tv[:port]> <code>, info, open, editor, key <ok|up|...>, action <guide|...>, play <channel key>, text <search>, volume <up|down|mute>, state, lineup [n], forget');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
