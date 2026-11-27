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
// A movie as MPEG-TS from a seek keeps its own times, so the helper can read where the picture starts (firstPts).
a = C.args({ input: 'http://x/m.mkv', t: 357.591, a: 0, fmt: 'ts', fx: 'x' }).join(' ');
ok('MPEG-TS from a seek: the movie\'s own times kept', / -copyts /.test(a) && / -mpegts_copyts 1 -f mpegts pipe:1$/.test(a) && !/start_at_zero/.test(a), a);
ok('MPEG-TS from the start (a live channel): times from zero as before', !/copyts/.test(C.args({ input: 'http://x/', t: 0, a: 0, fmt: 'ts' }).join(' ')));
{
  // One PES packet's start, as ffmpeg writes it: video stream 0xE0 with a PTS of 354.729 s, after an adaptation field.
  const pkt = Buffer.alloc(188, 0xff), pts = Math.round(354.729 * 90000);
  pkt[0] = 0x47; pkt[1] = 0x41; pkt[2] = 0x00; pkt[3] = 0x30; pkt[4] = 7; pkt[5] = 0x10;
  const o = 12; pkt[o] = 0; pkt[o + 1] = 0; pkt[o + 2] = 1; pkt[o + 3] = 0xe0; pkt[o + 6] = 0x80; pkt[o + 7] = 0x80; pkt[o + 8] = 5;
  pkt[o + 9] = 0x21 | ((Math.floor(pts / 1073741824) & 7) << 1); pkt[o + 10] = (pts >> 22) & 0xff; pkt[o + 11] = (((pts >> 15) & 0x7f) << 1) | 1; pkt[o + 12] = (pts >> 7) & 0xff; pkt[o + 13] = ((pts & 0x7f) << 1) | 1;
  const audio = Buffer.from(pkt); audio[o + 3] = 0xc0; audio[o + 13] = 1;
  const all = Buffer.concat([Buffer.from([1, 2, 3]), audio, pkt]), st = { buf: null, seen: 0, first: null };
  for (let i = 0; i < all.length; i += 50) C.firstPts(st, all.slice(i, i + 50));     // cut anywhere between chunks
  ok('where the picture starts: the first video PES header\'s PTS, across chunks, after an audio one', Math.abs(st.first - 354.729) < 0.001, st.first);
}
a = C.args({ input: 'http://x/', t: 0, a: 0, fmt: 'mkv' }).join(' ');
ok('no -ss at the start', !/-ss/.test(a), a);

// Where ffmpeg reads from: the helper's own relay
ok('provider link goes through the relay', C.inputFor('http://prov.invalid:8080/movie/u/p/1.mkv', '', 47811) === 'http://127.0.0.1:47811/x/http/prov.invalid:8080/movie/u/p/1.mkv');
ok('https too (ffmpeg only talks plain http to the helper)', C.inputFor('https://prov.invalid/m.mkv', '', 47811) === 'http://127.0.0.1:47811/x/https/prov.invalid/m.mkv');
ok('with the playlist User-Agent', C.inputFor('http://prov.invalid/m.mkv', 'TiviMate/4.7', 47811) === 'http://127.0.0.1:47811/ua/VGl2aU1hdGUvNC43/x/http/prov.invalid/m.mkv');
ok('a link that is the helper\'s already is read as it is', C.inputFor('http://127.0.0.1:47811/media-stream/abc/movie.mkv', '', 47811) === 'http://127.0.0.1:47811/media-stream/abc/movie.mkv');
ok('anything but http(s) is refused', C.inputFor('file:///etc/passwd', '', 47811) === null && C.inputFor('', '', 47811) === null);
ok('stream links are recognised by shape', C.isStream('/convert/' + 'a'.repeat(32) + '/movie.mkv?u=x') && !C.isStream('/convert/probe?u=x') && !C.isStream('/convert/key'));

// AAC above 48 kHz (a live college football channel sent AAC 96 kHz mono, which the TV plays silent).
let hz = C.parseProbe('Input #0, mpegts, from \'x\':\n  Duration: N/A, start: 1.0, bitrate: N/A\n  Stream #0:0[0x100]: Video: h264 (High) ([27][0][0][0] / 0x001B), yuv420p, 1920x1080\n  Stream #0:1[0x101]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 96000 Hz, mono, fltp, 101 kb/s\n');
ok('the probe reads the sample rate', hz.audio[0].rate === 96000 && hz.audio[0].channels === 1 && hz.audio[0].codec === 'aac', JSON.stringify(hz.audio));
let aa = C.audioArgs({ codec: 'aac', channels: 1, rate: 96000 });
ok('AAC at 96 kHz: AC-3 at 48 kHz, not copied', aa.args.join(' ') === '-c:a ac3 -b:a 224k -ar 48000' && /96 kHz to 48 kHz/.test(aa.out), JSON.stringify(aa));
ok('AAC at 48 kHz: copied as before', C.audioArgs({ codec: 'aac', channels: 2, rate: 48000 }).args.join(' ') === '-c:a copy');
ok('DTS at 96 kHz: AC-3 at 48 kHz too', /-ar 48000/.test(C.audioArgs({ codec: 'dts', channels: 6, rate: 96000 }).args.join(' ')));

// Dolby Vision profile 7 (a UHD Blu-ray remux): the probe reads the profile, and the stream asks for 8.1 only then.
const dvp = C.parseProbe('Input #0, matroska,webm, from \'x\':\n  Duration: 02:35:00.00, start: 0.000000, bitrate: 50000 kb/s\n  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160, SAR 1:1 DAR 16:9, 23.98 fps\n      Side data:\n        DOVI configuration record: version: 1.0, profile: 7, level: 6, rpu flag: 1, el flag: 1, bl flag: 1, compatibility id: 6, compression: 0\n  Stream #0:1(eng): Audio: truehd, 48000 Hz, 7.1, s32 (24 bit) (default)\n');
ok('the probe reads Dolby Vision profile 7', dvp.dv === 7 && dvp.video === 'hevc', JSON.stringify(dvp));
ok('...and a file without it is 0', C.parseProbe('Input #0, matroska,webm, from \'x\':\n  Stream #0:0: Video: hevc (Main 10), yuv420p10le, 3840x2160\n').dv === 0);
const p81 = C.args({ input: 'http://x/', t: 0, a: 0, fmt: 'mkv', p81: true }).join(' ');
ok('profile 7 as 8.1: the dovi_rpu filter with p81, the video still copied', /-c:v copy -bsf:v dovi_rpu=p81=1/.test(p81), p81);
ok('...and not otherwise', !/dovi_rpu/.test(C.args({ input: 'http://x/', t: 0, a: 0, fmt: 'mkv' }).join(' ')));

console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
