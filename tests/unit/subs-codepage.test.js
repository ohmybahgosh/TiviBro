// Old subtitle files in their language's Windows code page (service/subtitles.js decode): read right, not as
// Western letters.  UTF-8 stays UTF-8.
'use strict';
const S = require('../../service/subtitles.js')._test;
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const cp = (codes) => Buffer.from(codes);
ok('UTF-8 as it is', S.decode(Buffer.from('Ça va?  Привет', 'utf8'), 'fr') === 'Ça va?  Привет');
ok('Russian in 1251', S.decode(cp([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 'ru') === 'Привет', S.decode(cp([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 'ru'));
ok('Polish in 1250: Łódź', S.decode(cp([0xa3, 0xf3, 0x64, 0x9f]), 'pl') === 'Łódź', S.decode(cp([0xa3, 0xf3, 0x64, 0x9f]), 'pl'));
ok('Greek in 1253', S.decode(cp([0xc3, 0xe5, 0xe9, 0xdc]), 'el') === 'Γειά', S.decode(cp([0xc3, 0xe5, 0xe9, 0xdc]), 'el'));
ok('Turkish in 1254: ğ ş ı', S.decode(cp([0xf0, 0x20, 0xfe, 0x20, 0xfd]), 'tr') === 'ğ ş ı', S.decode(cp([0xf0, 0x20, 0xfe, 0x20, 0xfd]), 'tr'));
ok('French (1252) stays Western', S.decode(Buffer.from('caf\xe9 cr\xe8me', 'binary'), 'fr') === 'café crème');
const ru = Buffer.from(Array(40).fill([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20]).flat());
ok('no language given: Cyrillic told by the text itself', S.decode(ru, '').slice(0, 6) === 'Привет', S.decode(ru, '').slice(0, 10));
console.log(fail ? fail + ' FAILED' : 'all code page checks passed'); process.exit(fail ? 1 : 0);
