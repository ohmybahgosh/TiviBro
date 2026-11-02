// The helper's extra permissions on rooted TVs: service/grant.sh (run as root) and service/grant.js
// (asks the Homebrew Channel to run it when the TV's manifest for TiviBro doesn't list them yet).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbgrant-'));
fs.mkdirSync(dir + '/manifests.d'); fs.mkdirSync(dir + '/client-permissions.d');
const M = dir + '/manifests.d/app.tivibro.tv.json', P = dir + '/client-permissions.d/app.tivibro.tv.service.perms.json';
const orig = { version: '0.6.0', id: 'app.tivibro.tv', clientPermissionFiles: [dir + '/client-permissions.d/app.tivibro.tv.service.service.json', dir + '/client-permissions.d/app.tivibro.tv.app.json'] };
fs.writeFileSync(M, JSON.stringify(orig));
const SH = path.join(__dirname, '../../service/grant.sh');
const run = () => cp.execFileSync('sh', [SH], { env: Object.assign({}, process.env, { TIVIBRO_LS2_DEV: dir }) }).toString().trim();

const G = require('../../service/grant.js');
let calls = [];
const g = G.create({ dir, call: (uri, params, cb) => { calls.push({ uri, params }); cb({ returnValue: true, stdoutString: run() + '\n' }); } });
ok('before: the permissions are missing', g.missing() === true);
let r; g.ensure((x) => { r = x; });
ok('asks the Homebrew Channel to run grant.sh once', r === 'added' && calls.length === 1 && calls[0].uri === 'luna://org.webosbrew.hbchannel.service/exec' && /grant\.sh"$/.test(calls[0].params.command), JSON.stringify(calls));
const m = JSON.parse(fs.readFileSync(M, 'utf8')), p = JSON.parse(fs.readFileSync(P, 'utf8'));
ok('only the two groups, for the helper only', JSON.stringify(p) === '{"app.tivibro.tv.service*":["tv.management","applications.internal"]}', JSON.stringify(p));
ok('listed in TiviBro\'s manifest, the rest kept', m.clientPermissionFiles.length === 3 && m.clientPermissionFiles[2] === P && m.version === '0.6.0');
ok('after: nothing missing', g.missing() === false);
ok('running it again changes nothing', run() === 'granted' && JSON.parse(fs.readFileSync(M, 'utf8')).clientPermissionFiles.length === 3);
calls = []; g.ensure(); ok('not asked again', calls.length === 0);
// An install writes the manifest afresh: a new helper asks again.
fs.writeFileSync(M, JSON.stringify(orig)); calls = [];
const g2 = G.create({ dir, call: (uri, params, cb) => { calls.push(uri); cb({ returnValue: false, errorText: 'Service does not exist: org.webosbrew.hbchannel.service.' }); } });
g2.ensure((x) => { r = x; });
ok('not rooted: tried once, no harm', r === 'failed' && calls.length === 1);
const g3 = G.create({ dir: dir + '/nope', call: () => { throw new Error('should not call'); } });
g3.ensure((x) => { r = x; });
ok('no manifest to read: does nothing', r === 'unknown');
fs.rmSync(dir + '/manifests.d', { recursive: true });
ok('grant.sh without a manifest: skipped', /skipped/.test(run()));
console.log(fail ? fail + ' failures' : 'all grant tests passed');
process.exit(fail ? 1 : 0);
