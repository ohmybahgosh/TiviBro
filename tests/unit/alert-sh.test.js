// service/alert.sh: the root side of reminder alerts on rooted TVs.  The alert text must reach
// luna-send as one argument, untouched, whatever the programme name holds.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbalert-')), bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
fs.copyFileSync(path.join(__dirname, '../../service/alert.sh'), path.join(dir, 'alert.sh'));
const got = path.join(dir, 'got');
fs.writeFileSync(path.join(bin, 'luna-send'), '#!/bin/sh\nprintf "%s\\n" "$#" > "' + got + '"; for a in "$@"; do printf "%s\\n" "$a" >> "' + got + '"; done\necho \'{"returnValue":true,"alertId":"x"}\'\n', { mode: 0o755 });
const run = (arg) => { try { return cp.execFileSync('sh', [path.join(dir, 'alert.sh')].concat(arg === undefined ? [] : [arg]), { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }) }).toString(); } catch (e) { return String(e.stdout); } };
const evil = { sourceId: 'app.tivibro.tv', message: '<h3>Starting now: $(touch ' + dir + '/pwned) `id` "; rm -rf / ; \'x\'</h3>', buttons: [{ label: 'Watch' }, { label: 'Dismiss' }] };
fs.writeFileSync(path.join(dir, 'alert-123.json'), JSON.stringify(evil));
const out = run('123');
const lines = fs.readFileSync(got, 'utf8').split('\n');
ok('sent with luna-send', /"returnValue":true/.test(out), out);
ok('the alert is one argument, untouched', lines[0] === '6' && lines[6] === JSON.stringify(evil), lines.slice(0, 7).join(' | '));
ok('nothing in it ran', !fs.existsSync(path.join(dir, 'pwned')));
ok('the file is removed', !fs.existsSync(path.join(dir, 'alert-123.json')));
ok('only digits are taken as the id', /bad id/.test(run('1;id')) && /bad id/.test(run('../x')) && /bad id/.test(run()));
ok('no file: nothing sent', /no alert/.test(run('999')));
console.log(fail ? fail + ' failures' : 'all alert.sh tests passed');
process.exit(fail ? 1 : 0);
