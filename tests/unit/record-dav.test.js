/* Recording to a WebDAV share (service/record.js, recdav.js, discussion #130): for TVs that aren't rooted.  A small
   WebDAV server here: the recording goes up in parts (each its own upload), a dropped upload starts a new part, the
   finished one is filed (TV/<show>, or Movies/<title (year)> once TMDB says so) with its .nfo, plays back from the
   share with Range, and delete takes its files and empty folders. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tivibro-recdav-'));
process.env.TIVIBRO_USB_DIR = path.join(tmp, 'usb');                 // no drive in it
process.env.TIVIBRO_REC_LIST = path.join(tmp, 'recordings.json');
process.env.TIVIBRO_REC_DAV_PART_MS = '700';
process.env.TIVIBRO_REC_RETRY_MS = '200';
process.env.TIVIBRO_REC_TICK_MS = '200';
process.env.TIVIBRO_KV_DIR = path.join(tmp, 'kv');
const R = require('../../service/record');
let fail = 0;
const ok = (name, cond, info) => { if (cond) console.log('PASS ' + name); else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + info : '')); } };
const wait = (ms) => new Promise((f) => setTimeout(f, ms));
function call(method, url, body, headers) {
  return new Promise((resolve) => {
    const req = { method, url, headers: headers || {}, on(ev, f) { if (ev === 'data' && body) f(JSON.stringify(body)); if (ev === 'end') f(); } };
    let code = 0, hdr = {}, chunks = [], ls = {};
    const res = { writeHead(c, h) { code = c; hdr = h || {}; }, setHeader() {}, write(c) { chunks.push(Buffer.from(c)); return true; }, end(c) { if (c) chunks.push(Buffer.from(c)); (ls.finish || []).forEach((f) => f()); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (e) {} resolve({ code, hdr, body: b, j }); },
      on(ev, f) { (ls[ev] = ls[ev] || []).push(f); return res; }, once() {}, emit() {}, removeListener() {} };
    R.handle(req, res, {}, () => {});
  });
}

// The share: files and folders in memory, under /dav.  Basic login nas:secret.
const files = new Map(), dirs = new Set(['/dav']);
let dropNext = false, puts = 0;
const dec = (p) => decodeURIComponent(p.split('?')[0]).replace(/\/+$/, '');
const dav = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('nas:secret').toString('base64')) { res.writeHead(401); return res.end(); }
  const p = dec(req.url);
  if (req.method === 'MKCOL') { if (dirs.has(p)) { res.writeHead(405); return res.end(); } if (!dirs.has(path.dirname(p))) { res.writeHead(409); return res.end(); } dirs.add(p); res.writeHead(201); return res.end(); }
  if (req.method === 'PUT') {
    if (!dirs.has(path.dirname(p))) { res.writeHead(409); return res.end(); }
    const chunks = []; let n = 0; puts++;
    const drop = dropNext && puts > 3; if (drop) dropNext = false;
    req.on('data', (c) => { chunks.push(c); n += c.length; if (drop && n > 2000) { files.set(p, Buffer.concat(chunks)); req.destroy(); } });
    req.on('end', () => { files.set(p, Buffer.concat(chunks)); res.writeHead(201); res.end(); });
    return;
  }
  if (req.method === 'GET') {
    const f = files.get(p); if (!f) { res.writeHead(404); return res.end(); }
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (m) { const a = +m[1], b = Math.min(+m[2], f.length - 1); res.writeHead(206, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + f.length }); return res.end(f.slice(a, b + 1)); }
    res.writeHead(200); return res.end(f);
  }
  if (req.method === 'MOVE') {
    const to = dec(req.headers.destination.replace(/^https?:\/\/[^/]+/, ''));
    if (!files.has(p) || !dirs.has(path.dirname(to))) { res.writeHead(409); return res.end(); }
    files.set(to, files.get(p)); files.delete(p); res.writeHead(201); return res.end();
  }
  if (req.method === 'DELETE') { if (files.delete(p)) { res.writeHead(204); return res.end(); } if (dirs.has(p)) { for (const k of files.keys()) if (k.startsWith(p + '/')) files.delete(k); for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d); res.writeHead(204); return res.end(); } res.writeHead(404); return res.end(); }
  if (req.method === 'PROPFIND') {
    if (!dirs.has(p)) { res.writeHead(404); return res.end(); }
    const kids = [...files.keys(), ...dirs].filter((k) => path.dirname(k) === p && k !== p);
    const resp = (h) => '<D:response><D:href>' + encodeURI(h) + '</D:href></D:response>';
    res.writeHead(207, { 'Content-Type': 'application/xml' });
    return res.end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' + resp(p + '/') + kids.map(resp).join('') + '</D:multistatus>');
  }
  res.writeHead(405); res.end();
});
// A channel: 188-byte packets, a steady 60 KB/s.
const ch = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  const iv = setInterval(() => res.write(Buffer.alloc(188 * 6, 0x47)), 20);
  req.on('close', () => clearInterval(iv));
});

(async () => {
  await new Promise((f) => dav.listen(0, '127.0.0.1', f));
  await new Promise((f) => ch.listen(0, '127.0.0.1', f));
  const share = 'http://127.0.0.1:' + dav.address().port + '/dav';
  R.start({ log: () => {} });
  let r = await call('POST', '/record/start', { url: 'http://127.0.0.1:' + ch.address().port + '/x.ts', title: 'News', end: Date.now() + 2000 });
  ok('no drive and no share: refused, saying both', r.code === 409 && /network share/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/target', { type: 'webdav', address: share, user: 'nas', pass: 'wrong', name: 'NAS', check: true });
  ok('a wrong login is said when it\'s checked', r.code === 502 && /login/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/target', { type: 'webdav', address: share, user: 'nas', pass: 'secret', name: 'NAS', check: true });
  ok('the share checked and kept: it can write there', r.code === 200 && r.j.ok && dirs.has('/dav/TiviBro Recordings') && ![...files.keys()].some((k) => /check/.test(k)), JSON.stringify(r.j));
  const listed = await call('GET', '/record/list');
  ok('the list says the share (without its login)', listed.j.target && listed.j.target.name === 'NAS' && !JSON.stringify(listed.j).includes('secret'), JSON.stringify(listed.j.target));
  await wait(500);
  ok('the list file is only readable by the helper', (fs.statSync(process.env.TIVIBRO_REC_LIST).mode & 0o077) === 0, (fs.statSync(process.env.TIVIBRO_REC_LIST).mode & 0o777).toString(8));

  dropNext = true;
  r = await call('POST', '/record/start', { url: 'http://127.0.0.1:' + ch.address().port + '/x.ts', title: 'Hockey Night', channel: 'CBC', end: Date.now() + 2600 });
  const id = r.j.id;
  ok('it records to the share', r.code === 200 && r.j.status === 'recording', JSON.stringify(r.j));
  await wait(1700);
  let live = await call('GET', '/record/file/' + id);
  const upNow = [...files.values()].reduce((n, b) => n + b.length, 0);
  ok('while it records: the parts already up play, not the one still going up', live.code === 200 && live.body.length > 0 && live.body.length <= upNow, live.code + ' ' + live.body.length + ' of ' + upNow);
  await wait(3800);
  let rec = (await call('GET', '/record/list')).j.recs.filter((x) => x.id === id)[0];
  ok('done, in parts (a new upload every part, and one more after a dropped upload)', rec.status === 'done' && rec.parts >= 4 && rec.gaps >= 1 && rec.where === 'share', JSON.stringify(rec));
  const show = '/dav/TiviBro Recordings/TV/Hockey Night';
  const there = [...files.keys()].filter((k) => k.startsWith(show + '/')).map((k) => k.slice(show.length + 1)).sort();
  ok('filed on the share as on a drive: TV/<show>, " - pt1"..., and a .nfo', there.some((f) => /^Hockey Night - \d{4}-\d\d-\d\d \d\d\.\d\d - pt1\.ts$/.test(f)) && there.some((f) => / - pt2\.ts$/.test(f)) && there.some((f) => /\.nfo$/.test(f)), there.join(' | '));
  ok('nothing left at the top', ![...files.keys()].some((k) => path.dirname(k) === '/dav/TiviBro Recordings'), [...files.keys()].join(' | '));
  let total = 0; for (const [k, v] of files) if (k.startsWith(show + '/') && k.endsWith('.ts')) total += v.length;
  r = await call('GET', '/record/file/' + id);
  ok('plays back from the share: every part, end to end', r.code === 200 && r.body.length === total && total > 20000, r.body.length + ' of ' + total);
  r = await call('GET', '/record/file/' + id, null, { range: 'bytes=100-299' });
  ok('with Range', r.code === 206 && r.body.length === 200 && r.body[0] === 0x47, r.code + ' ' + r.body.length);
  r = await call('POST', '/record/convert', { id });
  ok('Convert to MP4 is for a USB drive', r.code === 409 && /network share/.test(r.j.error), JSON.stringify(r.j));
  r = await call('POST', '/record/meta', { id, meta: { title: 'Hockey Night', year: 2020, plot: 'A film.' } });
  await wait(600);
  const mdir = '/dav/TiviBro Recordings/Movies/Hockey Night (2020)';
  const mv = [...files.keys()].filter((k) => k.startsWith(mdir + '/'));
  ok('TMDB says movie: moved to Movies on the share, and the old show folder is gone', mv.some((k) => /Hockey Night \(2020\) - pt1\.ts$/.test(k)) && mv.some((k) => /\.nfo$/.test(k)) && !dirs.has(show), mv.join(' | ') + ' / ' + [...dirs].join(' | '));
  r = await call('POST', '/record/delete', { id });
  await wait(1900);
  ok('delete takes its files and its folder', r.j.ok && ![...files.keys()].some((k) => k.startsWith(mdir)) && !dirs.has(mdir), [...files.keys()].join(' | ') + ' / ' + [...dirs].join(' | '));
  r = await call('POST', '/record/target', { type: '' });
  ok('the share can be taken away', r.j.ok && !(await call('GET', '/record/list')).j.target);
  dav.close(); ch.close();
  done();
})().catch((e) => { console.log('FAIL ' + (e && e.stack)); fail++; done(); });
function done() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} console.log(fail ? fail + ' share recording test(s) failed' : 'all share recording tests passed'); process.exit(fail ? 1 : 0); }
