// My media from Windows and Samba shares (service/smb.js, and its parts in media.js, media-stream.js and
// sidecar.js): the source checked before anything runs, the login kept off the command line, folders and
// shares listed, a scan into movies, a movie served with Range (and HEAD, suffix ranges and 416), the
// change check, subtitle files beside a movie, the errors in words, the limit on runs at once, and the
// bundled program checked against its SHA-256 before it is unpacked and used.  A stand-in program
// (tests/fixtures/fake-smb.js) reads a local folder; the real one is tested by scripts/smb/build.sh test.
//   node tests/unit/smb.test.js
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
process.env.TIVIBRO_KV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-smb-'));
const FAKE = path.join(__dirname, '../fixtures/fake-smb.js');
fs.chmodSync(FAKE, 0o755);
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-smb-share-'));
const LOG = path.join(ROOT, '..', path.basename(ROOT) + '.log');
process.env.TIVIBRO_SMB = FAKE;
process.env.FAKE_SMB_ROOT = ROOT;
process.env.FAKE_SMB_LOG = LOG;
const Smb = require('../../service/smb.js');
const Media = require('../../service/media.js');
const Stream = require('../../service/media-stream.js');
const Sidecar = require('../../service/sidecar.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fail++; };
const p = (f) => new Promise(f);

// The share: Media with a movie, its subtitles, a TV folder, the recycle bin; and a guest share.
const film = crypto.randomBytes(300000);
function put(rel, data) { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }
put('Media/Movies/Heat (1995)/Heat.1995.1080p.mkv', film);
fs.truncateSync(path.join(ROOT, 'Media/Movies/Heat (1995)/Heat.1995.1080p.mkv'), 1.2e9);   // sparse: a movie's size without its bytes
put('Media/Short.2020.mkv', film);
put('Media/Movies/Heat (1995)/Heat.1995.1080p.en.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello\n');
put('Media/Movies/Loose.Film.2019.720p.mp4', 'x');
fs.truncateSync(path.join(ROOT, 'Media/Movies/Loose.Film.2019.720p.mp4'), 9e8);
put('Media/$RECYCLE.BIN/Old.2001.mkv', 'x');
put('Media/readme.txt', 'x');
put('guest/Clip.2020.mkv', 'y');
const SRC = { type: 'smb', server: 'nas.local', share: 'Media', folder: '/', user: 'tv', pass: 'pw', domain: '' };

(async () => {
  // ---------- checked before anything runs ----------
  ok('a host, host:port and [IPv6]:port are servers', !(Smb.parts({ server: 'nas', share: 'a' }) instanceof Error) && !(Smb.parts({ server: '192.168.1.5:4450', share: 'a' }) instanceof Error) && !(Smb.parts({ server: '[fe80::1]:445', share: 'a' }) instanceof Error));
  ok('a server that could pass for an option, has a space or a bad port is refused', ['-x', 'a b', 'nas:0', 'nas:70000', '', 'nas;rm'].every((s) => Smb.parts({ server: s, share: 'a' }).kind === 'address'));
  ok('a share with a slash or starting with "-" is refused', Smb.parts({ server: 'nas', share: 'a/b' }).kind === 'address' && Smb.parts({ server: 'nas', share: '-l' }).kind === 'address');
  ok('a login with a line break is refused (it goes on stdin, a line each)', Smb.parts({ server: 'nas', share: 'a', pass: 'x\ny' }).kind === 'login');
  ok('paths: .. refused, slashes tidied', Smb.cleanPath('a/../b') === null && Smb.cleanPath('\\Movies\\Heat/') === '/Movies/Heat' && Smb.cleanPath('') === '/');

  // ---------- shares, folders, check ----------
  const shares = await p((f) => Smb.shares(SRC, (e, l) => f({ e, l })));
  ok('the disk shares on the server', !shares.e && shares.l.map((s) => s.name).sort().join() === 'Media,guest', shares);
  const top = await p((f) => Smb.list(SRC, '/', (e, l) => f({ e, l })));
  ok('a folder: names, folders, sizes, paths', !top.e && top.l.some((x) => x.name === 'Movies' && x.dir && x.path === '/Movies') && top.l.some((x) => x.name === 'readme.txt' && !x.dir && x.size === 1), top);
  const sub = await p((f) => Smb.list(SRC, '/Movies/Heat (1995)', (e, l) => f({ e, l })));
  ok('a subfolder, its times in ms', !sub.e && sub.l.some((x) => x.path === '/Movies/Heat (1995)/Heat.1995.1080p.mkv' && x.size === 1.2e9 && x.mtime > 1e12), sub);
  const logLine = fs.readFileSync(LOG, 'utf8');
  ok('the password never goes on the command line', !/\bpw\b/.test(logLine) && /ls nas\.local Media \/Movies\/Heat \(1995\)/.test(logLine), logLine.slice(-200));
  const bad = await p((f) => Smb.check(Object.assign({}, SRC, { pass: 'nope' }), (e) => f(e)));
  ok('a wrong password: login, in words', bad && bad.kind === 'login' && /user name and password/.test(Smb.failure(bad).message), bad && bad.kind);
  const noShare = await p((f) => Smb.check(Object.assign({}, SRC, { share: 'Nope' }), (e) => f(e)));
  ok('a missing share: noshare', noShare && noShare.kind === 'noshare' && /no share by that name/.test(Smb.failure(noShare).message));
  const gone = await p((f) => Smb.list(SRC, '/Nope', (e) => f(e)));
  ok('a missing folder: notfound', gone && gone.kind === 'notfound');
  const away = await p((f) => Smb.check(Object.assign({}, SRC, { server: 'nohost' }), (e) => f(e)));
  ok('no server: unreachable, in words', away && away.kind === 'unreachable' && /didn't answer/.test(Smb.failure(away).message));
  const guest = await p((f) => Smb.list({ type: 'smb', server: 'nas', share: 'guest' }, '', (e, l) => f({ e, l })));
  ok('a guest share with no login', !guest.e && guest.l.length === 1, guest);

  // ---------- the scan ----------
  const res = await p((f) => Media.scan(SRC, f));
  const ids = (res.movies || []).map((m) => m.id).sort();
  ok('the scan finds the movies, ids from their paths, not the recycle bin', !res.error && ids.join('|') === 's:/Movies/Heat (1995)/Heat.1995.1080p.mkv|s:/Movies/Loose.Film.2019.720p.mp4', res);
  const heat = (res.movies || []).find((m) => /Heat/.test(m.id)) || {};
  ok('a movie: title and year from its folder, size, type and time', heat.title === 'Heat' && String(heat.year) === '1995' && heat.size === 1.2e9 && heat.ext === 'mkv' && heat.mt > 1e12, heat);
  const scanBad = await p((f) => Media.scan(Object.assign({}, SRC, { pass: 'nope' }), f));
  ok('a scan with a wrong password stops with the login words', scanBad.error === 'login' && /password/.test(scanBad.message), scanBad);
  const folderScan = await p((f) => Media.scan(Object.assign({}, SRC, { folder: '/Movies/Heat (1995)' }), f));
  ok('a source set to a subfolder scans only that', (folderScan.movies || []).length === 1, folderScan);

  // ---------- playing: Range through the localhost link ----------
  const link = await p((f) => Media.resolve(SRC, '/Short.2020.mkv', f));
  ok('the movie gets a temporary localhost link', /^\/media-stream\/[a-f0-9]{48}\/movie\.mkv$/.test(link.url || ''), link);
  const server = http.createServer((req, res) => Stream.handle(req, res, {}));
  await p((f) => server.listen(0, '127.0.0.1', f));
  const get = (range, method) => p((f) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: link.url, method: method || 'GET', headers: range ? { Range: range } : {} }, (res) => {
      const parts = []; res.on('data', (d) => parts.push(d)); res.on('end', () => f({ status: res.statusCode, h: res.headers, body: Buffer.concat(parts) }));
    });
    req.end();
  });
  const whole = await get();
  ok('GET: the whole movie, 200, its length and type', whole.status === 200 && whole.body.equals(film) && +whole.h['content-length'] === film.length && whole.h['content-type'] === 'video/x-matroska' && whole.h['accept-ranges'] === 'bytes', whole.status);
  const mid = await get('bytes=1000-1999');
  ok('a range: 206, Content-Range, the right bytes', mid.status === 206 && mid.h['content-range'] === 'bytes 1000-1999/' + film.length && mid.body.equals(film.slice(1000, 2000)), mid.h);
  const tail = await get('bytes=-500');
  ok('a suffix range: the last 500 bytes', tail.status === 206 && tail.body.equals(film.slice(-500)));
  const open = await get('bytes=299000-');
  ok('an open range to the end', open.status === 206 && open.body.equals(film.slice(299000)));
  const past = await get('bytes=900000-');
  ok('a range past the end: 416 with the size', past.status === 416 && past.h['content-range'] === 'bytes */' + film.length);
  const head = await get('bytes=0-0', 'HEAD');
  ok('HEAD: the length without reading the movie', head.status === 206 && +head.h['content-length'] === 1 && !head.body.length);
  ok('rangeOf: odd ranges', Stream.rangeOf('bytes=5-2', 10) === false && Stream.rangeOf('', 10) === null && Stream.rangeOf('items=1-2', 10) === false && Stream.rangeOf('bytes=3-99', 10).end === 9);
  const missing = await p((f) => Media.resolve(SRC, '/Movies/Nope.mkv', f));
  ok('a movie that isn\'t there any more: no link, in words', !missing.url && missing.error === 'notfound', missing);

  // A player that hangs up mid-movie stops its read at once.
  const big = crypto.randomBytes(8 * 1048576);
  put('Media/Big.2020.mkv', big);
  const bigLink = await p((f) => Media.resolve(SRC, '/Big.2020.mkv', f));
  const stopped = await p((f) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: bigLink.url }, (res) => { res.once('data', () => { req.destroy(); setTimeout(() => f(true), 300); }); });
  });
  ok('a player hanging up stops the read', stopped);
  server.close();

  // ---------- the change check ----------
  const c1 = await p((f) => Media.changeCheck(SRC, '', f));
  const c2 = await p((f) => Media.changeCheck(SRC, c1.token, f));
  put('Media/New.Film.2024.mkv', 'z');
  const c3 = await p((f) => Media.changeCheck(SRC, c2.token, f));
  ok('the change check: same share, same token; a new file, changed', /^smb:/.test(c1.token) && !c2.changed && c3.changed, [c1, c2, c3]);

  // ---------- subtitles beside a movie ----------
  const subs = await p((f) => Sidecar.lookup(SRC, heat.path, f));
  ok('the subtitle file beside the movie is found', subs.subs.length === 1 && subs.subs[0].lang === 'en', subs);
  const text = await p((f) => Sidecar.get(SRC, subs.subs[0] && subs.subs[0].path, 'en', f));
  ok('and read', /Hello/.test(text.text || ''), text);

  // ---------- at most two short runs at once ----------
  process.env.FAKE_SMB_SLOW = '300';
  fs.writeFileSync(LOG, '');
  const t0 = Date.now();
  await Promise.all([1, 2, 3, 4].map(() => p((f) => Smb.check(SRC, f))));
  const took = Date.now() - t0;
  ok('four checks run two at a time (a 1 GB TV isn\'t swamped)', took >= 550 && took < 3000, took);
  delete process.env.FAKE_SMB_SLOW;

  // ---------- the bundled program: checked, unpacked, tried ----------
  delete process.env.TIVIBRO_SMB;
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-smb-bundle-'));
  const gz = zlib.gzipSync(fs.readFileSync(FAKE));
  fs.writeFileSync(path.join(bundle, 'tivibro-smb-armv7.gz'), gz);
  Smb._config({ reset: true });
  Smb._config({ bundle, arch: 'armv7', sums: { armv7: '0'.repeat(64) } });
  const wrong = await p((f) => Smb.program((e, prog) => f({ e, prog })));
  ok('a program that doesn\'t match its checksum is never used', wrong.e && /checksum/.test(wrong.e.message) && !wrong.prog, wrong.e && wrong.e.message);
  Smb._config({ reset: true });
  Smb._config({ bundle, arch: 'armv7', sums: { armv7: crypto.createHash('sha256').update(gz).digest('hex') } });
  const right = await p((f) => Smb.program((e, prog) => f({ e, prog })));
  ok('the bundled program, checked, unpacked onto the TV\'s storage and tried', !right.e && /smb-1-armv7$/.test(right.prog || '') && (fs.statSync(right.prog).mode & 0o777) === 0o700, right.e && right.e.message);
  const again = await p((f) => Smb.list(SRC, '/', (e, l) => f({ e, l })));
  ok('and used from then on', !again.e && again.l.length > 0, again.e && again.e.message);
  fs.unlinkSync(right.prog);
  Smb._config({ reset: true });
  Smb._config({ bundle: fs.mkdtempSync(path.join(os.tmpdir(), 'tb-smb-none-')), arch: 'armv7', sums: { armv7: 'a'.repeat(64) } });
  const none = await p((f) => Smb.check(SRC, (e) => f(e)));
  ok('no program on a build without it: a plain error, nothing crashes', none && none.kind === 'program' && /can't open Windows shares/.test(Smb.failure(none).message), none && none.message);

  console.log(fail ? fail + ' failed' : 'all smb checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + e.stack); process.exit(1); });
