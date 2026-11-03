/* What "ffmpeg -hide_banner -i <file>" prints (stderr), for the probe parser in service/convert.js.
   Captured from ffmpeg 6.1 and 7.1 with made-up test files; paths replaced. */
'use strict';
module.exports = {
  // MKV: H.264, DTS 5.1 (English, default, titled), AC-3 mono (Spanish), SubRip subtitle
  mkvDts: [
    "Input #0, matroska,webm, from 'movie.mkv':",
    '  Metadata:',
    '    ENCODER         : Lavf60.16.100',
    '  Duration: 01:52:03.20, start: 0.000000, bitrate: 1513 kb/s',
    '  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 23.98 fps, 23.98 tbr, 1k tbn',
    '    Metadata:',
    '      DURATION        : 01:52:03.200000000',
    '  Stream #0:1(eng): Audio: dts (DTS), 48000 Hz, 5.1(side), fltp, 1536 kb/s (default)',
    '    Metadata:',
    '      title           : English DTS 5.1',
    '      DURATION        : 01:52:03.200000000',
    '  Stream #0:2(spa): Audio: ac3, 44100 Hz, mono, fltp, 96 kb/s',
    '    Metadata:',
    '      DURATION        : 01:52:03.200000000',
    '  Stream #0:3(eng): Subtitle: subrip',
    '    Metadata:',
    '      DURATION        : 00:00:02.000000000',
    'At least one output file must be specified'
  ].join('\n'),
  // MP4: HEVC, TrueHD 7.1 (default), AC-3 5.1, with the container ids newer ffmpeg prints
  mp4TrueHd: [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'movie.mp4':",
    '  Metadata:',
    '    major_brand     : isom',
    '  Duration: 00:20:00.00, start: 0.000000, bitrate: 4045 kb/s',
    '  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160, 643 kb/s, 23.98 fps, 23.98 tbr, 16k tbn (default)',
    '    Metadata:',
    '      handler_name    : VideoHandler',
    '  Stream #0:1[0x2](eng): Audio: truehd (mlpa / 0x61706C6D), 48000 Hz, 7.1, s32 (24 bit), 2902 kb/s (default)',
    '    Metadata:',
    '      handler_name    : SoundHandler',
    '  Stream #0:2[0x3](eng): Audio: ac3 (ac-3 / 0x332D6361), 48000 Hz, 5.1(side), fltp, 448 kb/s',
    '    Metadata:',
    '      handler_name    : SoundHandler',
    '    Side data:',
    '      audio service type: main',
    'At least one output file must be specified'
  ].join('\n'),
  // MPEG-TS: H.264 and AC-3, no languages, a start time
  tsAc3: [
    "Input #0, mpegts, from 'http://127.0.0.1:47811/x/http/example.invalid/live/1.ts':",
    '  Duration: N/A, start: 1.400000, bitrate: N/A',
    '  Program 1 ',
    '    Metadata:',
    '      service_name    : Service01',
    '  Stream #0:0[0x100]: Video: h264 (Constrained Baseline) ([27][0][0][0] / 0x001B), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 90k tbn',
    '  Stream #0:1[0x101](eng): Audio: ac3 (AC-3 / 0x332D4341), 48000 Hz, 5.1(side), fltp, 448 kb/s',
    'At least one output file must be specified'
  ].join('\n'),
  // MKV: FLAC 7.1 only
  flac71: [
    "Input #0, matroska,webm, from 'music.mkv':",
    '  Metadata:',
    '    ENCODER         : Lavf60.16.100',
    '  Duration: 00:00:02.00, start: 0.000000, bitrate: 835 kb/s',
    '  Stream #0:0: Audio: flac, 48000 Hz, 7.1, s16',
    '    Metadata:',
    '      ENCODER         : Lavc60.31.102 flac',
    'At least one output file must be specified'
  ].join('\n'),
  // DTS-HD MA 7.1 with a poster image attached, nothing marked default
  mkvDtsHd: [
    "Input #0, matroska,webm, from 'movie.mkv':",
    '  Duration: 02:10:00.50, start: 0.000000, bitrate: 30000 kb/s',
    '  Stream #0:0(eng): Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160, SAR 1:1 DAR 16:9, 23.98 fps, 23.98 tbr, 1k tbn',
    '  Stream #0:1(eng): Audio: dts (DTS-HD MA), 48000 Hz, 7.1, s32p (24 bit)',
    '  Stream #0:2(fre): Audio: dts (DTS), 48000 Hz, 5.1(side), fltp, 768 kb/s',
    '  Stream #0:3: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x900, 90k tbr, 90k tbn (attached pic)',
    'At least one output file must be specified'
  ].join('\n'),
  // A link that doesn't work
  notFound: [
    '[http @ 0x55] HTTP error 404 Not Found',
    'http://127.0.0.1:47811/x/http/example.invalid/movie/1.mkv: Server returned 404 Not Found'
  ].join('\n')
};
