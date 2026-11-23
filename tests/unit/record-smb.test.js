/* Recording and live pause to a Windows / Samba share (service/recsmb.js through record.js and timeshift.js), with
   the stand-in for tivibro-smb (tests/fixtures/fake-smb.js) writing into a folder here.  A recording goes up in parts
   (each one long "put"), plays while it records (the part being written too), is filed TV/<show> with its .nfo, plays
   back with Range and deletes cleanly; live pause with no USB drive goes to the share, hours instead of 10 minutes,
   its pieces written there, played back from there and cleared when it stops. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-recsmb-'));
const ROOT = path.join(tmp, 'shares'), FAKE = path.join(__dirname, '..', 'fixtures', 'fake-smb.js');
fs.mkdirSync(path.join(ROOT, 'rec'), { recursive: true }); fs.mkdirSync(path.join(ROOT, 'ro'), { recursive: true });
fs.chmodSync(FAKE, 0o755);
process.env.TIVIBRO_SMB = FAKE;
process.env.FAKE_SMB_ROOT = ROOT;
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');                 // no drive in it
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_REC_DAV_PART_MS = '900';
process.env.TIVIBRO_REC_RETRY_MS = '200';
process.env.TIVIBRO_REC_TICK_MS = '200';
process.env.TIVIBRO_REC_SMB_BEHIND = '0';
process.env.TIVIBRO_TS_IDLE_MS = '1500';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
const R = require('../../service/record');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
function call(method, url, body, headers) {
  return new Promise((resolve) => {
    const req = { method, url, headers: headers || {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); }, pause() {}, resume() {} };
    let code = 0, hdr = {}, chunks = [], ls = {}, ended = false;
    const res = { writeHead(c, h) { code = c; hdr = h || {}; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true; },
      end(c) { if (ended) return; ended = true; if (c) chunks.push(Buffer.from(c)); (ls.finish || []).forEach((f) => f()); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, hdr, body: b, j }); },
      on(ev, f) { (ls[ev] = ls[ev] || []).push(f); return res; }, once(ev, f) { return res.on(ev, f); }, emit() { return true; }, removeListener() { return res; } };
    R.handle(req, res, {}, () => {});
  });
}
const onShare = (rel) => path.join(ROOT, 'rec', rel);
function walk(d) { let out = []; try { fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); out = fs.statSync(p).isDirectory() ? out.concat(walk(p)) : out.concat([p]); }); } catch (e) {} return out; }

// A channel: 188-byte packets at a steady 60 KB/s; and an HLS one, for live pause.
const ch = http.createServer((req, res) => {
  if (req.url === '/live.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    const s = Math.floor(Date.now() / 1000);
    return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:' + s + '\n' + [0, 1, 2].map((k) => '#EXTINF:1.0,\nseg' + (s + k) + '.ts\n').join(''));
  }
  const m = /^\/seg(\d+)\.ts$/.exec(req.url);
  if (m) { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end('[piece ' + m[1] + ']'); }
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  const iv = setInterval(() => res.write(Buffer.alloc(188 * 6, 0x47)), 20);
  req.on('close', () => clearInterval(iv));
});

(async () => {
  await new Promise((f) => ch.listen(0, '127.0.0.1', f));
  const chan = 'http://127.0.0.1:' + ch.address().port;
  R.start({ log: () => {} });

  // The share: checked by writing to it, kept without its login going anywhere.
  let r = await call('POST', '/record/target', { type: 'smb', server: 'nas', share: 'rec', user: 'tv', pass: 'wrong', name: 'NAS', check: true });
  ok('a wrong login is said when it\'s checked', r.code === 502 && /user name and password/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/target', { type: 'smb', server: 'nas', share: 'ro', user: 'tv', pass: 'pw', name: 'NAS', check: true });
  ok('a share it can\'t write to is said', r.code === 502 && /can't open this share|permissions/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/target', { type: 'smb', server: 'nas', share: 'rec', user: 'tv', pass: 'pw', name: 'NAS', check: true });
  ok('the share checked and kept: it can write there, and the check file is gone', r.code === 200 && r.j.ok && fs.existsSync(onShare('TiviBro Recordings')) && !fs.existsSync(onShare('TiviBro Recordings/.tivibro-check')), JSON.stringify(r.j));
  await call('GET', '/record/list'); await wait(400);
  let listed = (await call('GET', '/record/list')).j;
  ok('the list says the share, its room and live pause on it (never its password)', listed.target && listed.target.type === 'smb' && listed.target.name === 'NAS' && listed.target.pause === true && listed.target.freeMB > 0 && listed.pauseShare === true && !JSON.stringify(listed).includes('"pw"'), JSON.stringify(listed.target));
  r = await call('POST', '/record/target', { type: 'smb', server: 'nas', share: 'rec', name: 'NAS', keepLogin: true });
  ok('saved again without its login: the one it had is kept', r.code === 200 && JSON.parse(fs.readFileSync(process.env.TIVIBRO_REC_LIST, 'utf8')).target.pass === 'pw');

  // A recording.
  r = await call('POST', '/record/start', { url: chan + '/x.ts', title: 'Hockey Night', channel: 'CBC', end: Date.now() + 3000 });
  const id = r.j.id;
  ok('it records to the share', r.code === 200 && r.j.status === 'recording', JSON.stringify(r.j));
  await wait(1500);
  const live = await call('GET', '/record/file/' + id);
  ok('while it records it plays, the part being written included', live.code === 200 && live.body.length > 40000, live.code + ' ' + live.body.length);
  await wait(3500);
  const rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === id)[0];
  ok('done, in parts', rec && rec.status === 'done' && rec.parts >= 3 && rec.where === 'share', JSON.stringify(rec));
  const show = 'TiviBro Recordings/TV/Hockey Night';
  const there = walk(onShare(show)).map((p) => path.basename(p)).sort();
  ok('filed on the share as on a drive: TV/<show>, " - pt1"..., and a .nfo', there.some((f) => / - pt1\.ts$/.test(f)) && there.some((f) => / - pt2\.ts$/.test(f)) && there.some((f) => /\.nfo$/.test(f)), there.join(' | '));
  const nfo = walk(onShare(show)).filter((p) => /\.nfo$/.test(p))[0];
  ok('its .nfo was written whole', nfo && /Hockey Night/.test(fs.readFileSync(nfo, 'utf8')), nfo);
  let total = 0; walk(onShare(show)).forEach((p) => { if (/\.ts$/.test(p)) total += fs.statSync(p).size; });
  r = await call('GET', '/record/file/' + id);
  ok('plays back from the share: every part, end to end', r.code === 200 && r.body.length === total && total > 100000, r.body.length + ' of ' + total);
  r = await call('GET', '/record/file/' + id, null, { range: 'bytes=100-299' });
  ok('with Range', r.code === 206 && r.body.length === 200 && r.body[0] === 0x47, r.code + ' ' + r.body.length);
  r = await call('POST', '/record/delete', { id });
  await wait(2500);
  ok('delete takes its files and its folder', r.j.ok && !fs.existsSync(onShare(show)), walk(onShare('TiviBro Recordings')).join(' | '));

  // Live pause with no USB drive: on the share.
  r = await call('POST', '/record/ts/start', { url: chan + '/live.m3u8' });
  const tid = r.j.id;
  ok('live pause goes to the share: hours, not the TV\'s 10 minutes', r.code === 200 && r.j.share === true && r.j.small === false && r.j.max === 7200, JSON.stringify(r.j));
  await wait(2500);
  r = await call('POST', '/record/ts/ping', { id: tid });
  ok('pieces arrive', r.j.pieces >= 2, JSON.stringify(r.j));
  const dir = onShare('TiviBro Recordings/.timeshift/' + tid);
  ok('written on the share', fs.existsSync(dir) && fs.readdirSync(dir).length >= 2, fs.existsSync(dir) ? fs.readdirSync(dir).join(' ') : 'none');
  const pl = (await call('GET', '/record/ts/' + tid + '/live.m3u8')).body.toString();
  const first = pl.split('\n').filter((l) => /^\d+\.ts$/.test(l))[0];
  const piece = await call('GET', '/record/ts/' + tid + '/' + first);
  ok('a piece plays back from the share', piece.code === 200 && /^\[piece \d+\]$/.test(piece.body.toString()) && +piece.hdr['Content-Length'] === piece.body.length, piece.code + ' ' + piece.body.toString());
  await call('POST', '/record/ts/stop', { id: tid });
  await wait(4800);
  ok('stopped: its pieces and folder are gone from the share', !fs.existsSync(dir), fs.existsSync(dir) ? fs.readdirSync(dir).join(' ') : '');

  // Live pause on the share turned off: back to the TV's own storage.
  r = await call('POST', '/record/target/pause', { on: false });
  ok('live pause on the share can be turned off', r.j.ok && r.j.pause === false && (await call('GET', '/record/list')).j.pauseShare === false);
  r = await call('POST', '/record/ts/start', { url: chan + '/live.m3u8?x=2' });
  ok('then it\'s the short pause in the TV\'s storage again', r.code === 200 && r.j.small === true && r.j.share === false, JSON.stringify(r.j));
  await call('POST', '/record/ts/stop', { id: r.j.id });
  r = await call('POST', '/record/target', { type: '' });
  ok('the share can be taken away', r.j.ok && !(await call('GET', '/record/list')).j.target);
  ch.close();
  setTimeout(done, 2000);
})().catch((e) => { console.log('FAIL ' + (e && e.stack)); fail++; done(); });
function done() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} console.log(fail ? fail + ' Windows share recording test(s) failed' : 'all Windows share recording tests passed'); process.exit(fail ? 1 : 0); }
