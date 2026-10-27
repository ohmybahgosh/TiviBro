// Colour helpers behind the accent picker: custom accents, readable text on any accent.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const ctx = { window: {}, document: {}, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/util.js'), 'utf8') + '\nthis.U = U;', ctx);
const U = ctx.U;
ok('hue 0 is red', /^#e[0-9a-f]1[0-9a-f]1[0-9a-f]$/.test(U.hsl(0, 50)), U.hsl(0, 50));
ok('hue 120 is green', /^#1[0-9a-f]e[0-9a-f]1[0-9a-f]$/.test(U.hsl(120, 50)), U.hsl(120, 50));
ok('every hue gives a valid colour', Array.from({ length: 36 }, (_, i) => U.hsl(i * 10, 62)).every(h => /^#[0-9a-f]{6}$/.test(h)));
ok('white accent gets dark text', U.onColor('#e8ecf8').fg === '#0b0e1a');
ok('electric blue gets dark text', U.onColor('#5b8cff').fg === '#0b0e1a');
ok('deep blue gets white text', U.onColor('#1111d4').fg === '#ffffff');
ok('mixing halfway to white', U.mix('#000000', '#ffffff', 0.5) === '#808080', U.mix('#000000', '#ffffff', 0.5));
ok('dark accents are detected for lifting', U.luminance('#1111d4') < 0.12 && U.luminance('#5b8cff') >= 0.12);
if (fail) { console.log(fail + ' look test(s) failed'); process.exit(1); }
console.log('all look tests passed');
