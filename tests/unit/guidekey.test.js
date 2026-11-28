/* The TV's Guide button opening TiviBro (service/guidekey.sh, rooted TVs): install writes the boot hook (which runs
   the script from TiviBro's folder) and takes away the hand-made setup of Nov 28; status says on or off; remove
   takes the hook away.  Run in a folder of its own (TIVIBRO_GK_ROOT), with no luna-send. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-gk-')), init = path.join(root, 'var/lib/webosbrew/init.d');
fs.mkdirSync(init, { recursive: true }); fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(init, '02-guide-tivibro'), '#!/bin/sh\n');
const sh = (op) => String(cp.execFileSync('sh', [path.join(__dirname, '../../service/guidekey.sh'), op], { env: Object.assign({}, process.env, { TIVIBRO_GK_ROOT: root, PATH: '/usr/bin:/bin' }) })).trim();
ok('off at first', sh('status') === 'off');
ok('install: on', sh('install') === 'on' && sh('status') === 'on');
const hook = fs.readFileSync(path.join(init, '02-tivibro-guide-key'), 'utf8');
ok('the hook runs guidekey.sh from TiviBro\'s folder, only while it is there', /\[ -f ".*service\/guidekey\.sh" \] && \(nohup sh ".*guidekey\.sh" run/.test(hook), hook);
ok('the hand-made setup is gone', !fs.existsSync(path.join(init, '02-guide-tivibro')));
ok('remove: off, the hook gone', sh('remove') === 'off' && !fs.existsSync(path.join(init, '02-tivibro-guide-key')));
setTimeout(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all Guide button tests passed');
}, 2500);   // the watcher started by install sees its hook gone and stops
