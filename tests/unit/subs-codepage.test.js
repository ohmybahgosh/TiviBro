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
// Croatian, Serbian, Bosnian (rogerinho131): 1250 files, and UTF-8 already read as 1252 on the way (OpenSubtitles' conversion).
const hr = 'Ćao, čovječe, šta će žena?  Đak';
const hr1250 = Buffer.from([0xc6, 0x61, 0x6f, 0x2c, 0x20, 0xe8, 0x6f, 0x76, 0x6a, 0x65, 0xe8, 0x65]);
ok('Serbian (Latin) in 1250: Ćao, čovječe', S.decode(hr1250, 'sr') === 'Ćao, čovječe', S.decode(hr1250, 'sr'));
ok('Croatian in 1250', S.decode(hr1250, 'hr') === 'Ćao, čovječe', S.decode(hr1250, 'hr'));
// The same text as its 1250 bytes, then read as 1252 (what the file went through): ć shows as æ, č as è.
const W1252 = '\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178';
const bytes1250 = hr.split('').map((ch) => ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x80 + S.CP1250.indexOf(ch));
const bad = bytes1250.map((b) => b < 0xa0 && b >= 0x80 ? W1252.charAt(b - 0x80) : String.fromCharCode(b)).join('');
ok('the test text really is garbled', /æ/.test(bad) && /è/.test(bad) && !/ć|č/.test(bad), bad);
ok('UTF-8 read as 1252 on the way (æ for ć, è for č): put right for hr, sr and bs', ['hr', 'sr', 'bs'].every((l) => S.decode(Buffer.from(bad, 'utf8'), l) === hr), [bad, S.decode(Buffer.from(bad, 'utf8'), 'hr')]);
ok('real Croatian UTF-8 is left alone', S.decode(Buffer.from(hr, 'utf8'), 'hr') === hr);
ok('only š and ž (the same in both pages): left alone', S.decode(Buffer.from('šuma i žaba', 'utf8'), 'hr') === 'šuma i žaba');
ok('French UTF-8 marked French: never touched', S.decode(Buffer.from('café crème è æ', 'utf8'), 'fr') === 'café crème è æ');
ok('Serbian Cyrillic UTF-8: left alone', S.decode(Buffer.from('Ћао, човече', 'utf8'), 'sr') === 'Ћао, човече');
console.log(fail ? fail + ' FAILED' : 'all code page checks passed'); process.exit(fail ? 1 : 0);
