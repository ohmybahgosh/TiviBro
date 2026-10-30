// scripts/tv/install.sh, the on-TV installer, run under plain sh against a fake GitHub (local
// server) and a fake luna-send-pub that records what it was asked to do.
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const SCRIPT = path.join(__dirname, '../../scripts/tv/install.sh');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvinst-'));
const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
const calls = path.join(tmp, 'calls.log');
// Fake luna-send-pub: answers getAppInfo, launch and dev/install (installed, or failed when FAKE_FAIL is set).
fs.writeFileSync(path.join(bin, 'luna-send-pub'), `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in
  *getAppInfo*|*launch*) if [ -n "$FAKE_PUB_DENIED" ]; then echo '{"returnValue":false,"errorCode":-1,"errorText":"Denied method call"}'; exit 0; fi ;;
esac
case "$*" in
  *getAppInfo*) echo '{"returnValue":true,"appInfo":{"version":"0.5.0"}}' ;;
  *launch*) echo '{"returnValue":true}' ;;
  *dev/install*)
    for a in "$@"; do case "$a" in *ipkUrl*) f=$(echo "$a" | sed 's/.*"ipkUrl":"\\([^"]*\\)".*/\\1/'); cp "$f" "${tmp}/installed.ipk" ;; esac; done
    echo '{"returnValue":true,"subscribed":true}'
    if [ -n "$FAKE_FAIL" ]; then echo '{"details":{"state":"install failed","reason":"disk full"}}'; else echo '{"details":{"state":"installing"}}'; echo '{"details":{"state":"installed"}}'; fi
    sleep 5 ;;
esac
`, { mode: 0o755 });
// Fake private-bus luna-send, only where a test asks for it (FAKE_PRIV): root on the TV has it.
fs.writeFileSync(path.join(bin, 'luna-send'), `#!/bin/sh
[ -n "$FAKE_PRIV" ] || exit 127
echo "priv $*" >> "${calls}"
case "$*" in
  *getAppInfo*) echo '{"returnValue":true,"appInfo":{"version":"0.5.1"}}' ;;
  *launch*) echo '{"returnValue":true}' ;;
  *) echo '{"returnValue":false}' ;;
esac
`, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });

const IPK_A = Buffer.from('stable ipk ' + 'x'.repeat(5000)), IPK_B = Buffer.from('alpha ipk ' + 'y'.repeat(5000));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const man = (v, ipk, sum) => JSON.stringify({ id: 'app.tivibro.tv', version: v, ipkUrl: 'app.tivibro.tv_' + v + '_all.ipk', ipkHash: { sha256: sum || sha(ipk) } });
let badSum = false, noStable = false;
const server = http.createServer((req, res) => {
  const u = req.url;
  if (noStable && u.indexOf('/rel/latest/') === 0) { res.writeHead(404); return res.end(); }   // only pre-releases so far
  if (u === '/rel/latest/download/app.tivibro.tv.manifest.json') { res.writeHead(302, { Location: '/rel/download/v0.6.0/app.tivibro.tv.manifest.json' }); return res.end(); }
  if (u === '/rel/download/v0.6.0/app.tivibro.tv.manifest.json') return res.end(man('0.6.0', IPK_A, badSum ? 'f'.repeat(64) : null));
  if (u === '/rel/download/v0.7.0-alpha.10/app.tivibro.tv.manifest.json') return res.end(man('0.7.0', IPK_B));
  // Like GitHub: assets resolve under latest/download/ as well as under the tag.
  if (u === '/rel/download/v0.6.0/app.tivibro.tv_0.6.0_all.ipk' || u === '/rel/latest/download/app.tivibro.tv_0.6.0_all.ipk') return res.end(IPK_A);
  if (u === '/rel/download/v0.7.0-alpha.10/app.tivibro.tv_0.7.0_all.ipk') return res.end(IPK_B);
  if (u.indexOf('/api') === 0) return res.end(JSON.stringify([
    { tag_name: 'v0.8.0-draft', draft: true, assets: [{ name: 'app.tivibro.tv.manifest.json' }] },
    // GitHub's order: by tag name, so alpha.9 is listed before the newer alpha.10.
    { tag_name: 'v0.7.0-alpha.9', prerelease: true, published_at: '2026-10-28T10:00:00Z', assets: [{ name: 'app.tivibro.tv.manifest.json' }] },
    { tag_name: 'v0.7.0-alpha.10', prerelease: true, published_at: '2026-10-29T10:00:00Z', assets: [{ name: 'app.tivibro.tv.manifest.json' }] },
    { tag_name: 'v0.6.0', published_at: '2026-10-01T10:00:00Z', assets: [{ name: 'app.tivibro.tv.manifest.json' }] }]));
  res.writeHead(404); res.end();
});

function run(args, extra) {
  try { fs.unlinkSync(calls); } catch (e) {}
  try { fs.unlinkSync(path.join(tmp, 'installed.ipk')); } catch (e) {}
  const B = 'http://127.0.0.1:' + server.address().port;
  const env = Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, TMPDIR: tmp, TIVIBRO_BASE: B + '/rel', TIVIBRO_API: B + '/api',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', HTTP_PROXY: '', http_proxy: '' }, extra || {});
  // Async: the fake GitHub runs in this process, so a blocking spawn would deadlock.
  return new Promise(res => {
    const c = cp.spawn('sh', [SCRIPT].concat(args), { env });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    const t = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.on('close', code => {
      clearTimeout(t);
      const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
      const inst = path.join(tmp, 'installed.ipk');
      res({ code, out, log, installed: fs.existsSync(inst) ? fs.readFileSync(inst) : null });
    });
  });
}

server.listen(0, '127.0.0.1', async () => {
  let r = await run([]);
  ok('latest release installs', r.code === 0 && r.installed && r.installed.equals(IPK_A), r.out.trim().split('\n').pop());
  ok('says what was there before', /Installed now: 0\.5\.0/.test(r.out) && /installed\.\s+\(was 0\.5\.0\)/.test(r.out));
  ok('uses the TV installer with the downloaded file', /appInstallService\/dev\/install/.test(r.log) && /com\.ares\.defaultName/.test(r.log));
  ok('starts TiviBro afterwards', /applicationManager\/launch.*app\.tivibro\.tv/.test(r.log));
  ok('checks the checksum', /Checksum OK/.test(r.out));
  ok('cleans up its temporary files', fs.readdirSync(tmp).filter(f => /^tivibro-install/.test(f)).length === 0);

  r = await run(['--pre']);
  ok('--pre installs the newest test version by date (alpha.10 over alpha.9, though GitHub lists alpha.9 first), skipping drafts', r.code === 0 && r.installed && r.installed.equals(IPK_B) && /0\.7\.0/.test(r.out), r.out.trim().split('\n').pop());
  noStable = true;
  r = await run([]);
  noStable = false;
  ok('with no full release yet, installs the newest test version', r.code === 0 && r.installed && r.installed.equals(IPK_B) && /No full release yet/.test(r.out) && /TiviBro 0\.7\.0-alpha\.10 installed/.test(r.out), r.out.trim().split('\n').pop());
  r = await run(['--tag', 'v0.6.0', '--no-launch']);
  ok('--tag installs that release', r.code === 0 && r.installed && r.installed.equals(IPK_A));
  ok('--no-launch does not start it', !/launch/.test(r.log));

  badSum = true;
  r = await run([]);
  badSum = false;
  ok('a wrong checksum stops before installing', r.code !== 0 && !r.installed && /Checksum mismatch/.test(r.out) && !/dev\/install/.test(r.log));

  const local = path.join(tmp, 'local.ipk'); fs.writeFileSync(local, IPK_B);
  r = await run(['--ipk', local, '--sha256', sha(IPK_B)]);
  ok('--ipk installs a file already on the TV', r.code === 0 && r.installed && r.installed.equals(IPK_B));
  r = await run(['--ipk', local, '--sha256', 'a'.repeat(64)]);
  ok('--ipk with a wrong --sha256 is refused', r.code !== 0 && !r.installed);

  // webOS 25 as root: the public bus is refused for the application manager, the private one works.
  r = await run(['--tag', 'v0.6.0'], { FAKE_PUB_DENIED: '1', FAKE_PRIV: '1' });
  ok('root on webOS 25: reads the version and starts TiviBro over the private bus', r.code === 0 && /Installed now: 0\.5\.1/.test(r.out) && /priv .*applicationManager\/launch/.test(r.log) && /Starting TiviBro/.test(r.out), r.out.trim().split('\n').pop());
  // No private bus and the public one refused: say so instead of claiming it started.
  r = await run(['--tag', 'v0.6.0'], { FAKE_PUB_DENIED: '1' });
  ok('when the TV refuses to start it, it says so', r.code === 0 && r.installed && !/Starting TiviBro/.test(r.out) && /Open TiviBro from the app list/.test(r.out), r.out.trim().split('\n').pop());

  r = await run([], { FAKE_FAIL: '1' });
  ok('an installer failure is reported and exits non-zero', r.code !== 0 && /Install failed/.test(r.out), r.out.trim().split('\n').pop());
  r = await run(['--bogus']);
  ok('unknown options are refused', r.code !== 0 && /Unknown option/.test(r.out));

  const src = fs.readFileSync(SCRIPT, 'utf8');
  ok('no bash-only syntax (TVs have BusyBox sh)', !/\[\[|\bfunction\s+\w+|\$\{\w+\/\/|<<<|\bdeclare\b|\blocal\b/.test(src.replace(/^#.*$/gm, '')));
  const posix = cp.spawnSync('sh', ['-n', SCRIPT]);
  ok('parses under sh -n', posix.status === 0);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' failures' : 'all TV installer tests passed');
  process.exit(fail ? 1 : 0);
});
