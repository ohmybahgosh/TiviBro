// Caps: platform detection, describing streams from each source, and which pipeline plays them.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/caps.js'), 'utf8') + '\nthis.Caps = Caps;', ctx);
const C = ctx.Caps;

// webOS version from the browser engine
ok('webOS 24 from Chrome 108', C.webosVersion('Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/108.0.5359.211 Safari/537.36') === 24);
ok('webOS 22 from Chrome 87', C.webosVersion('Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88') === 22);
ok('webOS 6 from Chrome 79', C.webosVersion('Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/79.0.3945.79') === 6);
ok('not webOS on a desktop browser', C.webosVersion('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0') === 0);

// model year, for the DTS rule
ok('OLED65C2PUA is a 2022 model', C.modelYear('OLED65C2PUA') === 2022);
ok('OLED55CXPUA is a 2020 model', C.modelYear('OLED55CXPUA') === 2020);
ok('OLED77G4WUA is a 2024 model', C.modelYear('OLED77G4WUA') === 2024);
ok('OLED65C9PUA is a 2019 model', C.modelYear('OLED65C9PUA') === 2019);
ok('65UQ7570PUJ is a 2022 model', C.modelYear('65UQ7570PUJ') === 2022);
ok('unknown model gives 0', C.modelYear('') === 0);

// known LG behaviour on top of what the TV reports
const base = () => ({ webos: 24, year: 2022, mse: { hevc: true, ac3: true, eac3: true, dts: true }, tv: { dts: true }, containers: {} });
let c = C.apply(base());
ok('C2: no DTS whatever the TV says', c.dts === false && c.tv.dts === false && c.mse.dts === false);
ok('C2: Dolby Vision 8 on the TV player', c.tv.dv8 === true);
ok('C2: AV1 on the TV player', c.tv.av1 === true);
c = C.apply(Object.assign(base(), { year: 2023 }));
ok('2023 model keeps DTS when the TV reports it', c.dts === true);

// HLS master playlist variants
const lv = (codecs, range, h, sup) => ({ height: h, attrs: { CODECS: codecs, 'VIDEO-RANGE': range, 'SUPPLEMENTAL-CODECS': sup } });
let m = C.fromHlsLevel(lv('hvc1.2.4.L153.B0,ec-3', 'PQ', 2160));
ok('HLS PQ variant is HDR10', m.range === 'HDR10' && m.video === 'hevc' && m.tenBit && m.audio[0] === 'eac3', JSON.stringify(m));
m = C.fromHlsLevel(lv('hvc1.2.4.L150.90,mp4a.40.2', 'PQ', 2160, 'dvh1.08.06/db1p'));
ok('HLS Dolby Vision 8 from SUPPLEMENTAL-CODECS', m.range === 'DV' && m.dvProfile === 8, JSON.stringify(m));
m = C.fromHlsLevel(lv('dvh1.05.06,ec-3', '', 2160));
ok('HLS Dolby Vision 5 from the codec', m.range === 'DV' && m.dvProfile === 5, JSON.stringify(m));
m = C.fromHlsLevel(lv('hvc1.2.4.L150.90,mp4a.40.2', 'HLG', 1080));
ok('HLS HLG variant', m.range === 'HLG');
m = C.fromHlsLevel(lv('avc1.640028,mp4a.40.2', '', 1080));
ok('plain H.264 is SDR', m.range === 'SDR' && m.video === 'h264' && m.audio[0] === 'aac');
ok('mp4a.40.34 is MP3', C.fromHlsLevel(lv('avc1.4d401f,mp4a.40.34', '', 720)).audio[0] === 'mp3');
m = C.bestHlsLevel([lv('avc1.640028', '', 1080), lv('hvc1.2.4.L153.B0', 'PQ', 2160, 'dvh1.08.06'), lv('hvc1.2.4.L153.B0', 'PQ', 2160)]);
ok('the Dolby Vision variant decides', m && m.range === 'DV', m && m.range);

// mpegts.js media info
m = C.fromMpegts({ videoCodec: 'hvc1.2.4.L153.90', audioCodec: 'ac-3', height: 2160, audioChannelCount: 6 });
ok('10-bit HEVC in TS is taken as HDR', m.range === 'HDR?' && m.audio[0] === 'ac3' && m.channels === 6, JSON.stringify(m));
m = C.fromMpegts({ videoCodec: 'avc1.64002a', audioCodec: 'mp4a.40.2', height: 1080 });
ok('H.264 in TS is SDR', m.range === 'SDR');

// Xtream movie info (ffprobe)
m = C.fromXtream({ video: { codec_name: 'hevc', height: 2160, pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084', side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }] }, audio: { codec_name: 'eac3', channels: 6, profile: 'Dolby Digital Plus + Dolby Atmos' } });
ok('Xtream Dolby Vision 8 with Atmos', m.range === 'DV' && m.dvProfile === 8 && m.atmos && m.audio[0] === 'eac3', JSON.stringify(m));
m = C.fromXtream({ video: { codec_name: 'hevc', height: 2160, pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084' }, audio: { codec_name: 'dts', channels: 6 } });
ok('Xtream HDR10 with DTS', m.range === 'HDR10' && m.audio[0] === 'dts');
ok('Xtream without stream info gives nothing', C.fromXtream({ plot: 'x' }) === null);

// labels
ok('label for a 4K Dolby Vision film', C.label({ height: 2160, video: 'hevc', range: 'DV', dvProfile: 8, audio: ['eac3'], channels: 6, atmos: true }) === '4K  HEVC  Dolby Vision 8  E-AC-3 5.1 Atmos', C.label({ height: 2160, video: 'hevc', range: 'DV', dvProfile: 8, audio: ['eac3'], channels: 6, atmos: true }));

// routing
const tv = { webos: 24, year: 2022, dts: false, mse: { h264: true, hevc: true, hevc10: true, av1: true, aac: true, ac3: true, eac3: true, mpeg2: false }, tv: { h264: true, hevc: true, hevc10: true, ac3: true, eac3: true, truehd: false, mpeg2: true }, containers: {} };
let r = C.route({ video: 'hevc', tenBit: true, range: 'DV', audio: ['eac3'] }, 'auto', tv);
ok('Dolby Vision goes to the TV player', r.engine === 'native', r.reason);
r = C.route({ video: 'hevc', tenBit: true, range: 'DV', audio: ['eac3'] }, 'builtin', tv);
ok('unless the built-in player is chosen', r.engine === null);
r = C.route({ video: 'hevc', tenBit: true, range: 'HDR10', audio: ['aac'] }, 'auto', tv);
ok('HDR10 stays on the built-in player by default', r.engine === null);
r = C.route({ video: 'hevc', tenBit: true, range: 'HDR10', audio: ['aac'] }, 'tv', tv);
ok('HDR10 goes to the TV player when asked', r.engine === 'native');
r = C.route({ video: 'hevc', tenBit: true, range: 'HDR?', audio: ['aac'] }, 'tv', tv);
ok('likely-HDR TS goes to the TV player when asked', r.engine === 'native');
r = C.route({ video: 'mpeg2', range: 'SDR', audio: ['mp2'] }, 'auto', tv);
ok('MPEG-2 goes to the TV player', r.engine === 'native');
r = C.route({ video: 'h264', range: 'SDR', audio: ['ac3'] }, 'auto', Object.assign({}, tv, { mse: Object.assign({}, tv.mse, { ac3: false }) }));
ok('AC-3 the built-in player refuses goes to the TV player', r.engine === 'native', r.reason);
r = C.route({ video: 'hevc', range: 'HDR10', audio: ['dts'], channels: 6 }, 'auto', tv);
ok('DTS-only on a C2 warns about no sound', /DTS/.test(r.warn), r.warn);
r = C.route({ video: 'hevc', range: 'HDR10', audio: ['dts', 'ac3'] }, 'auto', tv);
ok('no warning when another track plays', !r.warn);
r = C.route({ video: 'h264', range: 'SDR', audio: ['flac'], channels: 6 }, 'auto', tv);
ok('surround FLAC warns', /FLAC/.test(r.warn), r.warn);

if (fail) { console.log(fail + ' caps test(s) failed'); process.exit(1); }
console.log('all caps tests passed');
