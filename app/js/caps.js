/* What this TV can decode, and through which pipeline.

   Two pipelines can play a stream:
     built-in   hls.js / mpegts.js feeding Media Source Extensions (MSE).  Fine buffer control,
                but only codecs MSE accepts, and HDR is signalled by the browser engine.
     TV player  the <video src> pipeline (LG's own media player).  Plays raw MPEG-TS, HLS, MKV
                and MP4, switches the panel into HDR10, HLG or Dolby Vision itself, and decodes
                AC-3 / E-AC-3 natively.

   Rules, from what LG TVs are known to do (Jellyfin's webOS device profile is the best public
   record of it):
     - HEVC (also in MPEG-TS), AC-3 and E-AC-3 play on every webOS 4+ TV.
     - AV1 on webOS 5+ (2020 models on).
     - Dolby Vision profiles 5 and 8 play through the TV player on webOS 4+, even where the TV
       does not report it.  Through MSE it is not dependable, so Dolby Vision goes to the TV player.
     - DTS: not on LG TVs from 2020, 2021 and 2022 (webOS 5, 6 and 22, including the C1 and C2),
       whatever webOS version they were later updated to.  Back on 2023 models.
     - FLAC with more than two channels does not play.
   probe() asks the TV as well and keeps both answers, so Settings > Diagnostics can show them. */
var Caps = (function () {
  'use strict';

  var VIDEO = [
    ['h264', 'H.264', 'video/mp4; codecs="avc1.640028"'],
    ['hevc', 'HEVC', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
    ['hevc10', 'HEVC 10-bit (HDR)', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
    ['av1', 'AV1', 'video/mp4; codecs="av01.0.08M.08"'],
    ['av110', 'AV1 10-bit (HDR)', 'video/mp4; codecs="av01.0.12M.10"'],
    ['vp9', 'VP9', 'video/webm; codecs="vp09.00.40.08"'],
    ['dv5', 'Dolby Vision profile 5', 'video/mp4; codecs="dvh1.05.06"'],
    ['dv8', 'Dolby Vision profile 8', 'video/mp4; codecs="dvh1.08.06"']
  ];
  var AUDIO = [
    ['aac', 'AAC', 'audio/mp4; codecs="mp4a.40.2"'],
    ['mp3', 'MP3', 'audio/mpeg'],
    ['ac3', 'Dolby Digital (AC-3)', 'audio/mp4; codecs="ac-3"'],
    ['eac3', 'Dolby Digital Plus (E-AC-3, Atmos)', 'audio/mp4; codecs="ec-3"'],
    ['opus', 'Opus', 'audio/mp4; codecs="opus"'],
    ['flac', 'FLAC', 'audio/mp4; codecs="flac"'],
    ['dts', 'DTS', 'audio/mp4; codecs="dtsc"'],
    ['truehd', 'Dolby TrueHD', 'audio/mp4; codecs="mlpa"']
  ];
  var CONTAINERS = [['ts', 'MPEG-TS', 'video/mp2t'], ['hls', 'HLS', 'application/vnd.apple.mpegurl'], ['mkv', 'Matroska (MKV)', 'video/x-matroska'], ['mp4', 'MP4', 'video/mp4']];
  var NAMES = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg2: 'MPEG-2', aac: 'AAC', mp3: 'MP3', mp2: 'MP2', ac3: 'AC-3', eac3: 'E-AC-3', opus: 'Opus', flac: 'FLAC', dts: 'DTS', truehd: 'TrueHD' };

  /* ---------- the platform ---------- */
  // webOS version from the browser engine.  webOS 22 and later number by year.
  var CHROME_TO_WEBOS = [[132, 26], [120, 25], [108, 24], [94, 23], [87, 22], [79, 6], [68, 5], [53, 4], [38, 3]];
  function webosVersion(ua) {
    if (!/Web0S|webOS/i.test(ua || '')) return 0;
    var m = /Chrome\/(\d+)/.exec(ua || ''), c = m ? +m[1] : 0;
    for (var i = 0; i < CHROME_TO_WEBOS.length; i++) if (c >= CHROME_TO_WEBOS[i][0]) return CHROME_TO_WEBOS[i][1];
    return c ? 3 : 0;
  }
  // The year an LG model came out, from its model name (OLED65C2PUA is a 2022 C2).  0 = can't tell.
  function modelYear(model) {
    var m = /OLED\d{2,3}[A-Z]{1,2}([0-9X])/i.exec(model || '');
    if (m) { var d = m[1].toUpperCase(); return d === 'X' ? 2020 : d === '9' ? 2019 : d === '8' ? 2018 : d === '7' ? 2017 : d === '6' ? 2016 : 2020 + (+d); }
    // LCD lines: UN/UP/UQ/UR/UT (2020 to 2024) and NANO/QNED with the same letter in the series code.
    var l = /(?:^|\d)(?:NANO|QNED)?\d{2}(UN|UP|UQ|UR|UT|NA|QN)/i.exec(model || '');
    var y = l && { UN: 2020, UP: 2021, UQ: 2022, UR: 2023, UT: 2024 }[l[1].toUpperCase()];
    return y || 0;
  }

  var probed = null, sysInfo = { model: '', sdk: '' };

  function test(fn, type) { try { return !!fn(type); } catch (e) { return false; } }
  function probe(force) {
    if (probed && !force) return probed;
    var v = typeof document !== 'undefined' ? document.createElement('video') : null;
    var MS = typeof window !== 'undefined' && window.MediaSource;
    var mse = function (t) { return MS && MS.isTypeSupported && MS.isTypeSupported(t); };
    var nat = function (t) { return v && v.canPlayType && v.canPlayType(t).replace(/no/, ''); };
    var ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    var out = { webos: webosVersion(ua), model: sysInfo.model, year: modelYear(sysInfo.model), mse: {}, tv: {}, containers: {} };
    VIDEO.concat(AUDIO).forEach(function (x) { out.mse[x[0]] = test(mse, x[2]); out.tv[x[0]] = test(nat, x[2]); });
    CONTAINERS.forEach(function (x) { out.containers[x[0]] = test(nat, x[2]); });
    probed = apply(out);
    return probed;
  }
  // Known LG behaviour on top of what the TV reports.
  function apply(c) {
    var w = c.webos;
    if (w >= 4) {
      c.tv.hevc = c.tv.hevc10 = c.tv.ac3 = c.tv.eac3 = true;
      c.tv.dv5 = c.tv.dv8 = true;                     // LG plays these but rarely says so
      c.containers.ts = c.containers.hls = c.containers.mkv = c.containers.mp4 = true;
    }
    if (w >= 5) c.tv.av1 = c.tv.av110 = true;
    // DTS: missing on 2020 to 2022 models whatever they report.  Unknown model: believe the TV.
    if (c.year >= 2020 && c.year <= 2022) c.tv.dts = c.mse.dts = false;
    c.dts = !!c.tv.dts;
    return c;
  }

  // Model name from the TV, for the DTS rule.  Optional: without it the TV's own answer is used.
  function loadSystemInfo() {
    if (typeof PalmServiceBridge === 'undefined') return;
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        try { var r = JSON.parse(msg); if (r && r.returnValue) { sysInfo.model = r.modelName || ''; sysInfo.sdk = r.sdkVersion || ''; probed = null; if (window.Log) Log.info('caps', 'TV model ' + sysInfo.model + ', webOS ' + sysInfo.sdk); } } catch (e) {}
      };
      b.call('luna://com.webos.service.tv.systemproperty/getSystemInfo', JSON.stringify({ keys: ['modelName', 'sdkVersion'] }));
    } catch (e) {}
  }

  /* ---------- describing a stream ----------
     Every source of codec facts (an HLS level, mpegts.js media info, an Xtream movie's ffprobe
     data) is turned into the same small shape:
       { video: 'hevc', tenBit: true, range: 'SDR' | 'HDR10' | 'HLG' | 'DV', dvProfile: 8,
         height: 2160, audio: ['eac3'], channels: 6, atmos: false } */
  function videoCodec(s) {
    s = String(s || '').toLowerCase();
    var r = {};
    if (/^(avc1|avc3)/.test(s) || s === 'h264') r.video = 'h264';
    else if (/^(hvc1|hev1)/.test(s) || s === 'hevc' || s === 'h265') { r.video = 'hevc'; if (/^(hvc1|hev1)\.2\./.test(s)) r.tenBit = true; }
    else if (/^(dvh1|dvhe)/.test(s)) { r.video = 'hevc'; r.tenBit = true; r.range = 'DV'; r.dvProfile = +(/^dv..\.(\d+)/.exec(s) || [])[1] || 0; }
    else if (/^dav1/.test(s)) { r.video = 'av1'; r.tenBit = true; r.range = 'DV'; r.dvProfile = 10; }
    else if (/^av01/.test(s) || s === 'av1') { r.video = 'av1'; var bd = /^av01\.\d+\.\d+[mh]\.(\d+)/.exec(s); if (bd && +bd[1] >= 10) r.tenBit = true; }
    else if (/^vp09|^vp9/.test(s)) { r.video = 'vp9'; if (/^vp09\.0[23]/.test(s)) r.tenBit = true; }
    else if (/mpeg2|mp2v/.test(s)) r.video = 'mpeg2';
    return r;
  }
  function audioCodec(s) {
    s = String(s || '').toLowerCase();
    if (!s) return '';
    if (/^mp4a\.(69|6b)$|^mp3|^mp4a\.40\.34$/.test(s)) return 'mp3';
    if (/^mp4a\.40|^aac/.test(s)) return 'aac';
    if (/^mp2$|mp4a\.6b/.test(s)) return 'mp2';
    if (/^ac-?3$/.test(s)) return 'ac3';
    if (/^ec-?3$|^eac3/.test(s)) return 'eac3';
    if (/opus/.test(s)) return 'opus';
    if (/flac/.test(s)) return 'flac';
    if (/^dts|^dca/.test(s)) return 'dts';
    if (/truehd|mlpa/.test(s)) return 'truehd';
    return s;
  }
  // An HLS variant (hls.js Level): CODECS, VIDEO-RANGE and SUPPLEMENTAL-CODECS (Dolby Vision 8 / 10).
  function fromHlsLevel(l) {
    if (!l) return null;
    var a = l.attrs || {}, codecs = String(a.CODECS || [l.videoCodec, l.audioCodec].filter(Boolean).join(',')).split(/\s*,\s*/);
    var out = { height: l.height || 0, audio: [] };
    codecs.forEach(function (c) { var v = videoCodec(c); if (v.video) { Object.keys(v).forEach(function (k) { out[k] = v[k]; }); } else { var au = audioCodec(c); if (au) out.audio.push(au); } });
    var range = String(a['VIDEO-RANGE'] || '').toUpperCase();
    if (out.range !== 'DV') { if (range === 'PQ') out.range = 'HDR10'; else if (range === 'HLG') out.range = 'HLG'; }
    if (/dvh1|dvhe|dav1/i.test(a['SUPPLEMENTAL-CODECS'] || '')) { out.range = 'DV'; out.dvProfile = +(/dv..\.(\d+)/i.exec(a['SUPPLEMENTAL-CODECS']) || [])[1] || 8; }
    if (!out.range) out.range = 'SDR';
    return out;
  }
  // The richest variant decides: Dolby Vision over HDR over SDR, then the tallest.
  function bestHlsLevel(levels) {
    var rank = { DV: 3, HDR10: 2, HLG: 2, SDR: 1 }, best = null;
    (levels || []).forEach(function (l) {
      var i = fromHlsLevel(l); if (!i) return;
      if (!best || rank[i.range] > rank[best.range] || (rank[i.range] === rank[best.range] && i.height > best.height)) best = i;
    });
    return best;
  }
  // mpegts.js MEDIA_INFO.  It carries codec strings but no colour information, so 10-bit HEVC
  // is taken as HDR: broadcast and IPTV 10-bit HEVC is HDR10 or HLG in practice.
  function fromMpegts(mi) {
    if (!mi) return null;
    var v = videoCodec(mi.videoCodec), out = { video: v.video || '', tenBit: !!v.tenBit, height: mi.height || 0, audio: [] };
    if (v.range) { out.range = v.range; out.dvProfile = v.dvProfile; }
    else out.range = v.tenBit && (v.video === 'hevc' || v.video === 'av1') ? 'HDR?' : 'SDR';
    var au = audioCodec(mi.audioCodec); if (au) out.audio.push(au);
    if (mi.audioChannelCount) out.channels = mi.audioChannelCount;
    return out;
  }
  // Xtream get_vod_info: info.video / info.audio are ffprobe stream records.
  function fromXtream(info) {
    if (!info || (!info.video && !info.audio)) return null;
    var v = info.video || {}, a = info.audio || {}, out = { audio: [] };
    var vc = videoCodec(v.codec_name);
    out.video = vc.video || String(v.codec_name || '').toLowerCase();
    out.height = +v.height || 0;
    out.tenBit = /10|12/.test(v.pix_fmt || '') || +v.bits_per_raw_sample >= 10 || /main ?10/i.test(v.profile || '');
    var trc = String(v.color_transfer || '').toLowerCase(), side = JSON.stringify(v.side_data_list || []);
    if (/dovi|dolby vision/i.test(side) || /dolby vision/i.test(v.codec_long_name || '')) { out.range = 'DV'; out.dvProfile = +(/"dv_profile":\s*(\d+)/.exec(side) || [])[1] || 0; }
    else if (trc === 'smpte2084') out.range = /hdr10\+|smpte2094/i.test(side) ? 'HDR10+' : 'HDR10';
    else if (trc === 'arib-std-b67') out.range = 'HLG';
    else out.range = 'SDR';
    var au = audioCodec(a.codec_name); if (au) out.audio.push(au);
    out.channels = +a.channels || 0;
    out.atmos = /atmos|joc/i.test((a.profile || '') + ' ' + (a.codec_long_name || '') + ' ' + JSON.stringify(a.tags || {}));
    return out;
  }

  // One line for the info panel: "2160p  HEVC  Dolby Vision  E-AC-3 5.1"
  function label(m) {
    if (!m) return '';
    var parts = [];
    if (m.height) parts.push(m.height >= 2000 ? '4K' : m.height + 'p');
    if (m.video) parts.push(NAMES[m.video] || m.video.toUpperCase());
    var r = { DV: 'Dolby Vision' + (m.dvProfile ? ' ' + m.dvProfile : ''), HDR10: 'HDR10', 'HDR10+': 'HDR10+', HLG: 'HLG', 'HDR?': 'HDR' }[m.range];
    if (r) parts.push(r);
    if (m.audio && m.audio.length) {
      var ch = m.channels ? (m.channels >= 8 ? ' 7.1' : m.channels >= 6 ? ' 5.1' : m.channels === 2 ? ' stereo' : '') : '';
      parts.push(m.audio.map(function (x) { return NAMES[x] || x; }).join(' + ') + ch + (m.atmos ? ' Atmos' : ''));
    }
    return parts.join('  ');
  }

  /* ---------- routing ----------
     policy (Settings > Playback > HDR and Dolby Vision):
       tv       HDR10, HLG and Dolby Vision go to the TV player (default)
       dv       only Dolby Vision goes to the TV player
       builtin  never switch for HDR; codecs the built-in player can't take still switch
     Returns { engine: 'native', reason } to switch, or { engine: null } to stay, and a warning
     when the sound is in a format this TV can't decode at all. */
  function route(m, policy, c) {
    c = c || probe();
    var out = { engine: null, reason: '', warn: '' };
    if (!m) return out;
    var hdr = m.range && m.range !== 'SDR';
    if (m.range === 'DV' && policy !== 'builtin') { out.engine = 'native'; out.reason = 'Dolby Vision plays through the TV player'; }
    else if (hdr && policy === 'tv') { out.engine = 'native'; out.reason = (m.range === 'HDR?' ? '10-bit HEVC' : m.range) + ': the TV player switches the screen to HDR itself'; }
    else if (m.video && c.mse[m.video === 'hevc' && m.tenBit ? 'hevc10' : m.video] === false && c.tv[m.video] !== false && m.video !== 'mpeg2') {
      out.engine = 'native'; out.reason = (NAMES[m.video] || m.video) + ' is not supported by the built-in player here';
    } else if (m.video === 'mpeg2') { out.engine = 'native'; out.reason = 'MPEG-2 video plays through the TV player'; }
    else {
      for (var i = 0; i < (m.audio || []).length; i++) {
        var a = m.audio[i];
        if (c.mse[a] === false && c.tv[a] !== false && a !== 'dts' && a !== 'truehd') { out.engine = 'native'; out.reason = (NAMES[a] || a) + ' sound plays through the TV player'; break; }
      }
    }
    var au = m.audio || [];
    if (au.length && au.every(function (a) { return (a === 'dts' && !c.dts) || (a === 'truehd' && !c.tv.truehd) || (a === 'flac' && m.channels > 2); }))
      out.warn = (NAMES[au[0]] || au[0]) + (au[0] === 'flac' ? ' surround' : '') + ' sound, which this TV can\'t play.  If there is no sound, pick another audio track.';
    return out;
  }

  // Rows for Settings > Diagnostics > What this TV can play.
  function report() {
    var c = probe(), rows = [];
    function yn(b) { return b ? 'yes' : 'no'; }
    rows.push(['webOS', c.webos ? String(c.webos) : 'not webOS'], ['TV model', c.model || 'unknown'], ['Model year', c.year ? String(c.year) : 'unknown']);
    VIDEO.concat(AUDIO).forEach(function (x) { rows.push([x[1], 'built-in ' + yn(c.mse[x[0]]) + '   TV player ' + yn(c.tv[x[0]])]); });
    CONTAINERS.forEach(function (x) { rows.push([x[1] + ' files', 'TV player ' + yn(c.containers[x[0]])]); });
    return rows;
  }

  return { probe: probe, apply: apply, loadSystemInfo: loadSystemInfo, webosVersion: webosVersion, modelYear: modelYear,
    videoCodec: videoCodec, audioCodec: audioCodec, fromHlsLevel: fromHlsLevel, bestHlsLevel: bestHlsLevel, fromMpegts: fromMpegts, fromXtream: fromXtream,
    label: label, route: route, report: report };
})();
