// The audio converter's probe parser and the ffmpeg command it builds (service/convert.js).
'use strict';
const C = require('../../service/convert.js');
const S = require('../lib/ffmpeg-probe-samples.js');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

let r = C.parseProbe(S.mkvDts);
ok('MKV: matroska format and duration', r.format === 'matroska,webm' && Math.abs(r.duration - 6723.2) < 0.01, r);
ok('MKV: H.264 video', r.video === 'h264', r.video);
ok('MKV: two audio tracks', r.audio.length === 2, r.audio);
ok('MKV: DTS 5.1, English, default, titled', r.audio[0].codec === 'dts' && r.audio[0].channels === 6 && r.audio[0].lang === 'eng' && r.audio[0].def && r.audio[0].title === 'English DTS 5.1', r.audio[0]);
ok('MKV: second track is AC-3 mono, Spanish, not default', r.audio[1].codec === 'ac3' && r.audio[1].channels === 1 && r.audio[1].lang === 'spa' && !r.audio[1].def && r.audio[1].index === 1 && r.audio[1].stream === 2, r.audio[1]);
ok('MKV: one subtitle track counted', r.subs === 1, r.subs);

r = C.parseProbe(S.mp4TrueHd);
ok('MP4: HEVC video', r.video === 'hevc', r.video);
ok('MP4: TrueHD 7.1 default, with the [0x2] container id', r.audio[0].codec === 'truehd' && r.audio[0].channels === 8 && r.audio[0].def && r.audio[0].lang === 'eng', r.audio[0]);
ok('MP4: then AC-3 5.1', r.audio[1].codec === 'ac3' && r.audio[1].channels === 6 && !r.audio[1].def, r.audio[1]);
ok('MP4: the handler name is not a title', r.audio[0].title === '', r.audio[0].title);
ok('MP4: 20 minutes', r.duration === 1200, r.duration);

r = C.parseProbe(S.tsAc3);
ok('TS: no duration (live)', r.duration === 0 && r.format === 'mpegts', r);
ok('TS: AC-3 5.1, made the default when nothing is marked', r.audio.length === 1 && r.audio[0].codec === 'ac3' && r.audio[0].channels === 6 && r.audio[0].def, r.audio);

r = C.parseProbe(S.flac71);
ok('FLAC 7.1: 8 channels, no video', r.video === '' && r.audio[0].codec === 'flac' && r.audio[0].channels === 8, r);

r = C.parseProbe(S.mkvDtsHd);
ok('DTS-HD MA 7.1: profile kept, 8 channels', r.audio[0].codec === 'dts' && r.audio[0].profile === 'DTS-HD MA' && r.audio[0].channels === 8, r.audio[0]);
ok('DTS-HD: the first track is the default when none is marked', r.audio[0].def && !r.audio[1].def, r.audio);
ok('DTS-HD: French track language', r.audio[1].lang === 'fre', r.audio[1]);
ok('a poster image is not the video', r.video === 'hevc', r.video);

r = C.parseProbe(S.notFound);
ok('a 404 gives nothing', !r.audio.length && !r.video, r);

// What the chosen track becomes
ok('DTS 5.1 becomes AC-3 640k', C.audioArgs({ codec: 'dts', channels: 6 }).args.join(' ') === '-c:a ac3 -b:a 640k');
ok('7.1 is mixed down to 5.1 (E-AC-3 in ffmpeg cannot carry 7.1)', C.audioArgs({ codec: 'truehd', channels: 8 }).args.join(' ') === '-c:a ac3 -b:a 640k -ac 6');
ok('stereo FLAC to a smaller AC-3', C.audioArgs({ codec: 'flac', channels: 2 }).args.join(' ') === '-c:a ac3 -b:a 224k');
ok('AC-3 the TV plays is copied, not re-encoded', C.audioArgs({ codec: 'ac3', channels: 6 }).args.join(' ') === '-c:a copy');
ok('an unknown track converts as 5.1', C.audioArgs(null).args.join(' ') === '-c:a ac3 -b:a 640k');

let a = C.args({ input: 'http://127.0.0.1:47811/x/http/h/m.mkv', t: 600, a: 1, fmt: 'mkv', track: { codec: 'dts', channels: 6 } });
const j = a.join(' ');
ok('seek before -i (Range), movie times kept', /-ss 600 -i http:\/\/127\.0\.0\.1:47811\/x\/http\/h\/m\.mkv -copyts -start_at_zero/.test(j), j);
ok('video copied, the chosen audio track mapped', /-map 0:v:0\? -map 0:a:1 -c:v copy -c:a ac3 -b:a 640k/.test(j), j);
ok('no subtitles or data, MKV to stdout, not marked live (LG\'s player stops reading a live MKV)', /-sn -dn .*-f matroska pipe:1$/.test(j) && j.indexOf('-live') < 0, j);
ok('only http for the input', /-protocol_whitelist http,tcp/.test(j), j);
ok('progress every 5 s for the speed log', /-stats -stats_period 5/.test(j), j);
a = C.args({ input: 'pipe:0', pipe: true, t: 30, a: 0, fmt: 'ts', track: { codec: 'dts', channels: 6 } }).join(' ');
ok('pipe: read stdin, seek after -i, MPEG-TS out, live times from zero', /-i pipe:0 -ss 30 /.test(a) && / -f mpegts pipe:1$/.test(a) && !/copyts/.test(a), a);
a = C.args({ input: 'http://x/', t: 0, a: 0, fmt: 'mkv' }).join(' ');
ok('no -ss at the start', !/-ss/.test(a), a);

// Where ffmpeg reads from: the helper's own relay
ok('provider link goes through the relay', C.inputFor('http://prov.invalid:8080/movie/u/p/1.mkv', '', 47811) === 'http://127.0.0.1:47811/x/http/prov.invalid:8080/movie/u/p/1.mkv');
ok('https too (ffmpeg only talks plain http to the helper)', C.inputFor('https://prov.invalid/m.mkv', '', 47811) === 'http://127.0.0.1:47811/x/https/prov.invalid/m.mkv');
ok('with the playlist User-Agent', C.inputFor('http://prov.invalid/m.mkv', 'TiviMate/4.7', 47811) === 'http://127.0.0.1:47811/ua/VGl2aU1hdGUvNC43/x/http/prov.invalid/m.mkv');
ok('a link that is the helper\'s already is read as it is', C.inputFor('http://127.0.0.1:47811/media-stream/abc/movie.mkv', '', 47811) === 'http://127.0.0.1:47811/media-stream/abc/movie.mkv');
ok('anything but http(s) is refused', C.inputFor('file:///etc/passwd', '', 47811) === null && C.inputFor('', '', 47811) === null);
ok('stream links are recognised by shape', C.isStream('/convert/' + 'a'.repeat(32) + '/movie.mkv?u=x') && !C.isStream('/convert/probe?u=x') && !C.isStream('/convert/key'));

console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
