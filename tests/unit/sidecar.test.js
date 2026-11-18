/* Subtitle files beside a video (service/sidecar.js): which belong to it, and their language. */
'use strict';
const S = require('../../service/sidecar.js')._test;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const e = (name, dir) => ({ name, dir: !!dir, path: '/TV/St Denis Medical/Season 3/' + name });
const V = 'St.Denis.Medical.S03E03.1080p.WEB.h264.mkv';
let r = S.pick([e(V), e('St.Denis.Medical.S03E03.1080p.WEB.h264.srt'), e('St.Denis.Medical.S03E03.1080p.WEB.h264.en.forced.srt'), e('St.Denis.Medical.S03E04.1080p.WEB.h264.mkv'), e('St.Denis.Medical.S03E04.1080p.WEB.h264.en.srt')], V);
ok('the episode\'s own .srt and its forced one, not the next episode\'s', r.length === 2 && r[1].forced && r[1].lang === 'en', r);
r = S.pick([e('Movie (2020).mkv'), e('english.srt'), e('Subs', true)], 'Movie (2020).mkv');
ok('a folder with one video: any subtitle file there', r.length === 1, r);
r = S.pick([e('2_English.srt'), e('3_Spanish.srt'), e('4_English.SDH.srt')], V, 'own');
ok('Subs/<video>/2_English.srt: English, Spanish, English SDH', r.map((x) => x.lang + (x.sdh ? '+sdh' : '')).join() === 'en,es,en+sdh', r);
ok('".eng.srt" is English, ".pt-BR.srt" Brazilian', S.describe('Show.S01E01.eng.srt', 'Show.S01E01').lang === 'en' && S.describe('Show.S01E01.pt-br.srt', 'Show.S01E01').lang === 'pt-br');
console.log(fails ? fails + ' FAILED' : 'all sidecar subtitle checks passed'); process.exit(fails ? 1 : 0);
