// Sound the TV can't play: which track, convert or not, per TV year (app/js/caps.js, app/js/convert.js).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };
const ctx = { console, setTimeout, clearTimeout, Promise, localStorage: { getItem() { return null; }, setItem() {} } };
ctx.window = ctx;
vm.createContext(ctx);
const src = (f) => fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8');
vm.runInContext(src('util.js') + '\nthis.U = U;', ctx);
vm.runInContext(src('caps.js') + '\nthis.Caps = Caps;', ctx);
vm.runInContext(src('convert.js') + '\nthis.Convert = Convert;', ctx);
const { Caps, Convert } = ctx;

// A TV of a given year: what LG TVs are known to do, on top of a TV that claims everything.
const tv = (year, extra) => Caps.apply(Object.assign({ webos: year >= 2022 ? 22 : 6, year, mse: { ac3: true, eac3: true, dts: true, flac: true }, tv: { dts: true, flac: true }, containers: {} }, extra || {}));
const c2022 = tv(2022), c2020 = tv(2020), c2023 = tv(2023), c2019 = tv(2019);

// Caps.unplayable
ok('2022 (C2): DTS can\'t play', Caps.unplayable('dts', 6, c2022) === 'DTS');
ok('2020: DTS can\'t play', Caps.unplayable('dts', 6, c2020) === 'DTS');
ok('2023: DTS plays again', Caps.unplayable('dts', 6, c2023) === '');
ok('2019: DTS plays', Caps.unplayable('dts', 6, c2019) === '');
ok('ffmpeg\'s name for DTS (dca) is DTS', Caps.unplayable('dca', 6, c2022) === 'DTS');
ok('TrueHD never plays, any year', Caps.unplayable('truehd', 8, c2023) === 'Dolby TrueHD' && Caps.unplayable('truehd', 8, c2019) === 'Dolby TrueHD');
ok('MLP counts as TrueHD', Caps.unplayable('mlp', 6, c2023) === 'Dolby TrueHD');
ok('FLAC surround can\'t play, stereo FLAC can', Caps.unplayable('flac', 8, c2023) === 'FLAC surround' && Caps.unplayable('flac', 2, c2023) === '');
ok('AC-3, E-AC-3 and AAC always play', ['ac3', 'eac3', 'aac', 'mp3'].every((a) => Caps.unplayable(a, 6, c2022) === ''));
ok('the TV\'s route warning agrees', /DTS sound/.test(Caps.route({ audio: ['dts'], channels: 6 }, 'auto', c2022).warn) && Caps.route({ audio: ['dts'] }, 'auto', c2022).unplayable === 'dts' && !Caps.route({ audio: ['dts'] }, 'auto', c2023).warn);
ok('What this TV can play lists converted sound', Caps.report().some((r) => r[0] === 'Converted sound'));

const T = (index, codec, channels, lang, def, title) => ({ index, codec, channels, lang: lang || '', def: !!def, title: title || '' });

// decide
let d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 6, 'eng')], c2022);
ok('2022, DTS default + AC-3 same language: switch to the AC-3 track, no conversion', d.action === 'track' && d.a === 1, d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 6, 'eng')], c2023);
ok('2023: the DTS default plays, nothing to do', d.action === 'play', d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'dts', 2, 'eng', false, 'Commentary')], c2022);
ok('2022, only DTS tracks: convert the default', d.action === 'convert' && d.a === 0 && d.codec === 'dts' && d.channels === 6 && d.why === 'DTS', d);
d = Convert.decide([T(0, 'truehd', 8, 'eng', true), T(1, 'ac3', 6, 'eng')], c2023);
ok('2023, TrueHD + AC-3: the AC-3 track', d.action === 'track' && d.a === 1, d);
d = Convert.decide([T(0, 'truehd', 8, 'eng', true)], c2019);
ok('2019, TrueHD only: convert (7.1 to 5.1 in the helper)', d.action === 'convert' && d.a === 0 && d.channels === 8, d);
d = Convert.decide([T(0, 'flac', 8, '', true)], c2023);
ok('FLAC 7.1 only: convert', d.action === 'convert', d);
d = Convert.decide([T(0, 'flac', 2, '', true)], c2023);
ok('stereo FLAC: plays', d.action === 'play', d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 2, 'spa')], c2022);
ok('only a playable track in another language: convert the English one instead', d.action === 'convert' && d.a === 0, d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 2, 'spa')], c2022, { noConverter: true });
ok('...but with no converter, the Spanish track beats silence', d.action === 'track' && d.a === 1, d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 2, 'spa')], c2022, { lang: 'es' });
ok('preferred language Spanish: the Spanish AC-3 track', d.action === 'track' && d.a === 1, d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'dts', 6, 'fre')], c2022, { lang: 'fr' });
ok('preferred language French, all DTS: convert the French track', d.action === 'convert' && d.a === 1, d);
d = Convert.decide([T(0, 'dts', 6, '', true), T(1, 'aac', 2, '')], c2022);
ok('no languages at all: the playable track', d.action === 'track' && d.a === 1, d);
d = Convert.decide([T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 2, 'eng', false, 'Director\'s commentary'), T(2, 'eac3', 6, 'eng')], c2022);
ok('a commentary track is passed over for the main one', d.action === 'track' && d.a === 2, d);
d = Convert.decide([T(0, 'ac3', 6, 'eng'), T(1, 'dts', 6, 'eng', true)], c2022);
ok('the default track decides, not the first', d.action === 'track' && d.a === 0, d);
d = Convert.decide([], c2022);
ok('no tracks known: play', d.action === 'play', d);
ok('bad list per track', JSON.stringify(Convert.decide([T(0, 'dts', 6, '', true), T(1, 'ac3', 6, '')], c2022).bad) === '["DTS",""]');

// links
ctx.Net = { port: 47811, ua: 'TiviMate/4.7', ctlHeaders: (h) => h || {} };
const link = Convert.link({ src: 'http://prov.invalid/movie/u/p/7.mkv', a: 1, t: 600.25, fmt: 'mkv', codec: 'dts', channels: 6 });
ok('conversion link: helper, key, movie.mkv, url, time, track, codec, User-Agent',
  /^http:\/\/127\.0\.0\.1:47811\/convert\/[a-f0-9]*\/movie\.mkv\?u=http%3A%2F%2Fprov\.invalid%2Fmovie%2Fu%2Fp%2F7\.mkv&t=600\.25&a=1&c=dts&ch=6&ua=TiviMate%2F4\.7$/.test(link), link);
ok('live channels get movie.ts', /\/movie\.ts\?/.test(Convert.link({ src: 'http://x/1.ts', a: 0, t: 0, fmt: 'ts' })));
ok('describe: ready line says size and where', Convert.describe({ state: 'ready', size: 3145728, where: 'TV storage' }) === 'Ready, 3.0 MB, kept on TV storage');
ok('describe: downloading', Convert.describe({ state: 'downloading', percent: 40 }) === 'Downloading 40%');
ok('no-sound notice names the format and the setting', /^DTS sound, which this TV can't play\.  Settings > Audio and subtitles can get the audio converter/.test(Convert.noSound('DTS')));

// plan: what happens before a movie starts, with a helper answering
let probes = 0, statusState = 'ready';
ctx.Store = { settings: {}, saveSettings() {} };
ctx.Log = { warn() {}, info() {} };
ctx.fetch = (url) => {
  const u = String(url);
  const json = (o, code) => Promise.resolve({ ok: !code, status: code || 200, json: () => Promise.resolve(o) });
  if (/\/ffmpeg\/status$/.test(u)) return json({ state: statusState });
  if (/\/convert\/key$/.test(u)) return json({ key: 'f'.repeat(32) });
  if (/\/convert\/probe\?/.test(u)) { probes++; return json(/two/.test(decodeURIComponent(u)) ? { duration: 7200, audio: [T(0, 'dts', 6, 'eng', true), T(1, 'ac3', 6, 'eng')] } : { duration: 7200, audio: [T(0, 'dts', 6, 'eng', true)] }); }
  return json({ error: 'no' }, 404);
};
Caps._model('OLED65C2PUA');
(async () => {
  let r = await Convert.plan({ url: 'http://prov.invalid/movie/1.mkv', media: { audio: ['aac'] } });
  ok('plan: known playable sound, nothing to do, no probe', r === null && probes === 0, r);
  r = await Convert.plan({ url: 'http://prov.invalid/movie/1.mkv', media: null });
  ok('plan: MKV with unknown sound, DTS only: convert, with the notice', r && r.conv && r.conv.a === 0 && r.conv.fmt === 'mkv' && r.conv.dur === 7200 && r.notice === 'Converting DTS audio for this TV' && probes === 1, r);
  await Convert.plan({ url: 'http://prov.invalid/movie/1.mkv', media: null });
  ok('plan: the probe is kept per link', probes === 1, probes);
  r = await Convert.plan({ url: 'http://prov.invalid/movie/two.mkv', media: { audio: ['dts'], channels: 6 } });
  ok('plan: Xtream says DTS, the file also has AC-3: pick that track', r && r.track === 1 && !r.conv, r);
  ctx.Store.settings.convertAudio = 'off';
  r = await Convert.plan({ url: 'http://prov.invalid/movie/3.mkv', media: { audio: ['dts'] } });
  ok('plan: Off does nothing', r === null, r);
  ctx.Store.settings.convertAudio = 'auto';
  statusState = 'none';
  Convert._reset();
  r = await Convert.plan({ url: 'http://prov.invalid/movie/4.mkv', media: { audio: ['dts'], channels: 6 } });
  ok('plan: no converter yet, DTS known: offer it', r && r.offer === 'DTS' && !r.guessed, r);
  r = await Convert.plan({ url: 'http://prov.invalid/movie/5.mkv', media: null, title: 'Some Film 2160p DTS-HD MA' });
  ok('plan: no converter, the name says DTS: offer it as a guess', r && r.offer === 'DTS' && r.guessed, r);
  r = await Convert.plan({ url: 'http://prov.invalid/movie/6.mkv', media: null, title: 'Some Film' });
  ok('plan: no converter, nothing known: play as it is', r === null, r);
  ctx.Net.port = 0;
  r = await Convert.plan({ url: 'http://prov.invalid/movie/4.mkv', media: { audio: ['dts'] } });
  ok('plan: no network helper, nothing to do', r === null, r);
  console.log(fail ? fail + ' failed' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
