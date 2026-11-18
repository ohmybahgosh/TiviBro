/* Subtitles from OpenSubtitles.com for what's playing (discussion #19).  The app sends the viewer's own
   API key (and login token, if they signed in) with each request, the way it sends the TMDB token;
   only the search words (title, year, season and episode) and the chosen file id leave the TV.
     POST /media/subs/search   { key, token, query, year, season, episode, type, langs: ['en','ea'] }
       -> { results: [{ id, lang, release, downloads, hi, fps, ai, trusted, title }], perLang } | { error, message }
          (one search per language, up to 40 each)
     POST /media/subs/get      { key, token, id } -> { text, name, remaining, reset } | { error, message }
     POST /media/subs/login    { key, user, pass } -> { token, allowed, level } | { error, message }
   OpenSubtitles asks for its query parameters sorted and lower case (it redirects otherwise), and an
   app name in the User-Agent.  Without a login it allows 5 downloads a day per address; with a free
   account, 20.  ES5 / Node 0.12. */
'use strict';
var https = require('https');
var http = require('http');
var URL_ = require('url');
var HOST = process.env.TIVIBRO_OS_BASE || 'https://api.opensubtitles.com/api/v1';     // tests point it at the mock
var UA = 'TiviBro v' + (function () { try { return require('./package.json').version || '0.6'; } catch (e) { return '0.6'; } })();

function str(v, n) { return typeof v === 'string' ? v.slice(0, n || 200) : typeof v === 'number' ? String(v) : ''; }
function message(code, body) {
  var m = body && (body.message || (body.errors && body.errors.join ? body.errors.join('  ') : ''));
  if (code === 401 || code === 403) return 'OpenSubtitles refused the API key.  Check it in Settings > Playback > Subtitles from OpenSubtitles.';
  if (code === 406 || code === 429) return m || 'The daily download limit is reached.  Sign in for more, or try again tomorrow.';
  return m || 'OpenSubtitles answered ' + code + '.';
}
// One HTTPS request, following up to three redirects; JSON answers parsed, text kept as text.
function call(method, url, headers, body, cb, hops, asText) {
  hops = hops || 0;
  var done = false;
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var u = URL_.parse(url), data = body ? JSON.stringify(body) : null;
  var h = { 'User-Agent': UA, Accept: asText ? '*/*' : 'application/json' };
  Object.keys(headers || {}).forEach(function (k) { if (headers[k]) h[k] = headers[k]; });
  if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
  var req = (u.protocol === 'http:' ? http : https).request({ hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h }, function (res) {
    var code = res.statusCode;
    if (code >= 300 && code < 400 && res.headers.location && hops < 3) {
      res.resume();
      var next = URL_.resolve(url, res.headers.location);
      return call(code === 307 || code === 308 ? method : 'GET', next, code === 307 || code === 308 ? headers : (URL_.parse(next).hostname === u.hostname ? headers : {}), code === 307 || code === 308 ? body : null, finish, hops + 1, asText);
    }
    var chunks = [], bytes = 0;
    res.on('data', function (b) { bytes += b.length; if (bytes > 3145728) { req.abort(); finish(new Error('That subtitle file is too large.')); } else chunks.push(b); });
    res.on('end', function () {
      var buf = Buffer.concat(chunks), j = null;
      if (!asText || code !== 200) { try { j = JSON.parse(buf.toString('utf8')); } catch (e) { j = null; } }
      if (code !== 200) { var e = new Error(message(code, j)); e.code = code; return finish(e); }
      finish(null, asText ? buf : j);
    });
    res.on('error', function () { finish(new Error('The connection to OpenSubtitles dropped.')); });
  });
  req.on('error', function () { finish(new Error('Could not reach OpenSubtitles.')); });
  req.setTimeout(15000, function () { req.abort(); finish(new Error('OpenSubtitles did not answer in time.')); });
  if (data) req.write(data);
  req.end();
}
function auth(q) { return { 'Api-Key': str(q.key, 80), Authorization: q.token ? 'Bearer ' + str(q.token, 2048) : '' }; }
function keyOk(q) { return /^[A-Za-z0-9]{16,64}$/.test(str(q.key, 80)); }

// The search address: parameters sorted, values lower case, spaces as "+".
function searchUrl(q) {
  var p = {};
  var query = str(q.query, 120).toLowerCase().replace(/\s+/g, ' ').trim();
  if (query) p.query = query;
  if (/^\d{4}$/.test(str(q.year))) p.year = str(q.year);
  if (+q.season > 0) p.season_number = String(+q.season);
  if (+q.episode > 0) p.episode_number = String(+q.episode);
  if (q.type === 'movie' || q.type === 'episode') p.type = q.type;
  var langs = (Array.isArray(q.langs) ? q.langs : []).map(function (l) { return str(l, 8).toLowerCase(); }).filter(function (l) { return /^[a-z]{2}(-[a-z]{2})?$/.test(l); });
  langs.sort();
  if (langs.length) p.languages = langs.join(',');
  p.order_by = 'download_count';
  return HOST + '/subtitles?' + Object.keys(p).sort().map(function (k) { return k + '=' + encodeURIComponent(p[k]).replace(/%20/g, '+').replace(/%2C/g, ','); }).join('&');
}
function shape(j) {
  var out = [];
  (j && j.data || []).forEach(function (d) {
    var a = d.attributes || {}, f = (a.files || [])[0], fd = a.feature_details || {};
    if (!f || !f.file_id) return;
    out.push({ id: f.file_id, lang: str(a.language, 8), release: str(a.release || f.file_name, 160), downloads: +a.download_count || 0, hi: !!a.hearing_impaired,
      fps: +a.fps || 0, ai: !!(a.ai_translated || a.machine_translated), trusted: !!a.from_trusted, title: str(fd.title || fd.movie_name, 120),
      season: +fd.season_number || 0, episode: +fd.episode_number || 0, year: +fd.year || 0 });
  });
  return out;
}
/* One search per language (discussion #19): OpenSubtitles answers 50 at a time, most downloaded first, so
   English and Spanish together came back as 49 English and one Spanish.  Asked one language at a time,
   each gets its own 50 (40 are kept).  At most five languages, asked together. */
var PER_LANG = 40;
/* OpenSubtitles' text search is loose: "Planes, Trains and Automobiles" also brought back Jack and Jill and
   Withnail and I among the most downloaded.  Each result is scored against what was asked (its film's
   title, else its release name; the year; the season and episode), the ones for the asked film first, and
   ones for another film left out when enough are for the right one. */
function words(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim()
    .replace(/^(the|a|an) /, '');
}
function score(r, q) {
  var want = words(q.query);
  if (!want) return 1;
  var ws = want.split(' '), t = words(r.title), rel = ' ' + words(r.release) + ' ', sc = 0;
  if (t && t === want) sc = 4;
  else if (t && ws.every(function (w) { return (' ' + t + ' ').indexOf(' ' + w + ' ') >= 0; })) sc = 3;
  else if (rel.indexOf(' ' + want + ' ') >= 0) sc = 3;
  else if (ws.length > 1 && ws.filter(function (w) { return w.length > 2; }).every(function (w) { return rel.indexOf(' ' + w + ' ') >= 0; })) sc = 2;
  if (!sc) return 0;
  var y = /^\d{4}$/.test(str(q.year)) ? +q.year : 0;
  if (y && r.year) sc += Math.abs(r.year - y) <= 1 ? 1 : -2;
  if (+q.season > 0 && r.season && r.season !== +q.season) sc -= 3;
  if (+q.episode > 0 && r.episode && r.episode !== +q.episode) sc -= 3;
  return Math.max(sc, 0);
}
function rank(list, q) {
  list.forEach(function (r, i) { r._s = score(r, q); r._i = i; });
  var good = list.filter(function (r) { return r._s > 0; });
  if (good.length >= 3) list = good;
  list.sort(function (a, b) { return b._s - a._s || a._i - b._i; });         // within a score, most downloaded first (as asked)
  return list.map(function (r) { delete r._s; delete r._i; return r; });
}
function search(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first: Settings > Playback > Subtitles from OpenSubtitles.' });
  if (!str(q.query, 120).trim()) return cb({ error: 'query', message: 'Say what to look for.' });
  var langs = [];
  (Array.isArray(q.langs) ? q.langs : []).forEach(function (l) { l = str(l, 8).toLowerCase(); if (/^[a-z]{2}(-[a-z]{2})?$/.test(l) && langs.indexOf(l) < 0) langs.push(l); });
  langs = langs.slice(0, 5);
  if (!langs.length) langs = [''];
  var left = langs.length, got = {}, errs = [], total = 0;
  langs.forEach(function (l) {
    var one = {}; Object.keys(q).forEach(function (k) { one[k] = q[k]; }); one.langs = l ? [l] : [];
    call('GET', searchUrl(one), auth(q), null, function (e, j) {
      if (e) errs.push(e); else { got[l] = rank(shape(j), q).slice(0, PER_LANG); total += j && j.total_count || got[l].length; }
      if (--left) return;
      if (errs.length === langs.length) return cb({ error: 'search', message: errs[0].message });
      var out = [], counts = {};
      langs.forEach(function (x) { (got[x] || []).forEach(function (r) { out.push(r); }); counts[x || 'any'] = (got[x] || []).length; });
      cb({ results: out, total: total, perLang: counts });
    });
  });
}
function get(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first.' });
  var id = +q.id;
  if (!(id > 0)) return cb({ error: 'id', message: 'Pick a subtitle.' });
  call('POST', HOST + '/download', auth(q), { file_id: id }, function (e, j) {
    if (e) return cb({ error: e.code === 406 || e.code === 429 ? 'limit' : 'download', message: e.message });
    if (!j || !/^https?:\/\//.test(j.link || '')) return cb({ error: 'download', message: 'OpenSubtitles gave no file.' });
    call('GET', j.link, {}, null, function (e2, buf) {
      if (e2) return cb({ error: 'download', message: e2.message });
      cb({ text: decode(buf, q.lang), name: str(j.file_name, 200), remaining: j.remaining, reset: str(j.reset_time, 80) });
    }, 0, true);
  });
}
/* Subtitle files are mostly UTF-8.  Older ones (SRT above all) are saved in the Windows code page of their
   language: Central European (Polish, Czech, Hungarian, Croatian, Romanian...) in 1250, Cyrillic 1251, Greek 1253,
   Turkish 1254, Hebrew 1255, Arabic and Persian 1256, Baltic 1257, Western 1252.  Read as 1252, a Polish ł came out
   as ³ and a Russian line as accented Latin letters.  The subtitle's language (lang, from the search) picks the
   page; Serbian, written in both alphabets, and no language at all: the text itself tells (bytes that make
   Cyrillic words, else Western).  The pages' upper halves (0x80 to 0xFF) are below; old Node has no TextDecoder
   for them. */
var CP = {
  '1250': "\u20ac\ufffd\u201a\ufffd\u201e\u2026\u2020\u2021\ufffd\u2030\u0160\u2039\u015a\u0164\u017d\u0179\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\u0161\u203a\u015b\u0165\u017e\u017a\u00a0\u02c7\u02d8\u0141\u00a4\u0104\u00a6\u00a7\u00a8\u00a9\u015e\u00ab\u00ac\u00ad\u00ae\u017b\u00b0\u00b1\u02db\u0142\u00b4\u00b5\u00b6\u00b7\u00b8\u0105\u015f\u00bb\u013d\u02dd\u013e\u017c\u0154\u00c1\u00c2\u0102\u00c4\u0139\u0106\u00c7\u010c\u00c9\u0118\u00cb\u011a\u00cd\u00ce\u010e\u0110\u0143\u0147\u00d3\u00d4\u0150\u00d6\u00d7\u0158\u016e\u00da\u0170\u00dc\u00dd\u0162\u00df\u0155\u00e1\u00e2\u0103\u00e4\u013a\u0107\u00e7\u010d\u00e9\u0119\u00eb\u011b\u00ed\u00ee\u010f\u0111\u0144\u0148\u00f3\u00f4\u0151\u00f6\u00f7\u0159\u016f\u00fa\u0171\u00fc\u00fd\u0163\u02d9",
  '1251': "\u0402\u0403\u201a\u0453\u201e\u2026\u2020\u2021\u20ac\u2030\u0409\u2039\u040a\u040c\u040b\u040f\u0452\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\u0459\u203a\u045a\u045c\u045b\u045f\u00a0\u040e\u045e\u0408\u00a4\u0490\u00a6\u00a7\u0401\u00a9\u0404\u00ab\u00ac\u00ad\u00ae\u0407\u00b0\u00b1\u0406\u0456\u0491\u00b5\u00b6\u00b7\u0451\u2116\u0454\u00bb\u0458\u0405\u0455\u0457\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041a\u041b\u041c\u041d\u041e\u041f\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042a\u042b\u042c\u042d\u042e\u042f\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043a\u043b\u043c\u043d\u043e\u043f\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044a\u044b\u044c\u044d\u044e\u044f",
  '1253': "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\ufffd\u2030\ufffd\u2039\ufffd\ufffd\ufffd\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\ufffd\u203a\ufffd\ufffd\ufffd\ufffd\u00a0\u0385\u0386\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\ufffd\u00ab\u00ac\u00ad\u00ae\u2015\u00b0\u00b1\u00b2\u00b3\u0384\u00b5\u00b6\u00b7\u0388\u0389\u038a\u00bb\u038c\u00bd\u038e\u038f\u0390\u0391\u0392\u0393\u0394\u0395\u0396\u0397\u0398\u0399\u039a\u039b\u039c\u039d\u039e\u039f\u03a0\u03a1\ufffd\u03a3\u03a4\u03a5\u03a6\u03a7\u03a8\u03a9\u03aa\u03ab\u03ac\u03ad\u03ae\u03af\u03b0\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7\u03b8\u03b9\u03ba\u03bb\u03bc\u03bd\u03be\u03bf\u03c0\u03c1\u03c2\u03c3\u03c4\u03c5\u03c6\u03c7\u03c8\u03c9\u03ca\u03cb\u03cc\u03cd\u03ce\ufffd",
  '1254': "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\ufffd\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\ufffd\u0178\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u011e\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u0130\u015e\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u011f\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u0131\u015f\u00ff",
  '1255': "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\ufffd\u2039\ufffd\ufffd\ufffd\ufffd\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\ufffd\u203a\ufffd\ufffd\ufffd\ufffd\u00a0\u00a1\u00a2\u00a3\u20aa\u00a5\u00a6\u00a7\u00a8\u00a9\u00d7\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00f7\u00bb\u00bc\u00bd\u00be\u00bf\u05b0\u05b1\u05b2\u05b3\u05b4\u05b5\u05b6\u05b7\u05b8\u05b9\ufffd\u05bb\u05bc\u05bd\u05be\u05bf\u05c0\u05c1\u05c2\u05c3\u05f0\u05f1\u05f2\u05f3\u05f4\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7\u05d8\u05d9\u05da\u05db\u05dc\u05dd\u05de\u05df\u05e0\u05e1\u05e2\u05e3\u05e4\u05e5\u05e6\u05e7\u05e8\u05e9\u05ea\ufffd\ufffd\u200e\u200f\ufffd",
  '1256': "\u20ac\u067e\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0679\u2039\u0152\u0686\u0698\u0688\u06af\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u06a9\u2122\u0691\u203a\u0153\u200c\u200d\u06ba\u00a0\u060c\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u06be\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u061b\u00bb\u00bc\u00bd\u00be\u061f\u06c1\u0621\u0622\u0623\u0624\u0625\u0626\u0627\u0628\u0629\u062a\u062b\u062c\u062d\u062e\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u00d7\u0637\u0638\u0639\u063a\u0640\u0641\u0642\u0643\u00e0\u0644\u00e2\u0645\u0646\u0647\u0648\u00e7\u00e8\u00e9\u00ea\u00eb\u0649\u064a\u00ee\u00ef\u064b\u064c\u064d\u064e\u00f4\u064f\u0650\u00f7\u0651\u00f9\u0652\u00fb\u00fc\u200e\u200f\u06d2",
  '1257': "\u20ac\ufffd\u201a\ufffd\u201e\u2026\u2020\u2021\ufffd\u2030\ufffd\u2039\ufffd\u00a8\u02c7\u00b8\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\ufffd\u203a\ufffd\u00af\u02db\ufffd\u00a0\ufffd\u00a2\u00a3\u00a4\ufffd\u00a6\u00a7\u00d8\u00a9\u0156\u00ab\u00ac\u00ad\u00ae\u00c6\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00f8\u00b9\u0157\u00bb\u00bc\u00bd\u00be\u00e6\u0104\u012e\u0100\u0106\u00c4\u00c5\u0118\u0112\u010c\u00c9\u0179\u0116\u0122\u0136\u012a\u013b\u0160\u0143\u0145\u00d3\u014c\u00d5\u00d6\u00d7\u0172\u0141\u015a\u016a\u00dc\u017b\u017d\u00df\u0105\u012f\u0101\u0107\u00e4\u00e5\u0119\u0113\u010d\u00e9\u017a\u0117\u0123\u0137\u012b\u013c\u0161\u0144\u0146\u00f3\u014d\u00f5\u00f6\u00f7\u0173\u0142\u015b\u016b\u00fc\u017c\u017e\u02d9"
};
var LANG_CP = { pl: '1250', cs: '1250', sk: '1250', hu: '1250', hr: '1250', sl: '1250', ro: '1250', bs: '1250', sq: '1250',
  ru: '1251', uk: '1251', bg: '1251', mk: '1251', be: '1251', el: '1253', tr: '1254', az: '1254', he: '1255', ar: '1256', fa: '1256', ur: '1256',
  lt: '1257', lv: '1257', et: '1257' };
function singleByte(buf, page) {
  var t = CP[page], out = '';
  for (var i = 0; i < buf.length; i++) { var c = buf[i]; out += c < 0x80 ? String.fromCharCode(c) : t ? t.charAt(c - 0x80) : String.fromCharCode(c); }
  return out;
}
function decode(buf, lang) {
  var s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.indexOf('\ufffd') < 0) return s;                                // UTF-8
  var l = String(lang || '').toLowerCase().slice(0, 2), page = LANG_CP[l];
  if (!page && (!l || l === 'sr')) {
    // Cyrillic letters in 1251 are 0xC0 to 0xFF; Western text has few of them in a row.
    var hi = 0, run = 0, runs = 0;
    for (var i = 0; i < buf.length; i++) { var c = buf[i]; if (c >= 0xc0) { hi++; if (++run === 3) runs++; } else run = 0; }
    if (runs > 20 && hi > buf.length * 0.15) page = '1251';
  }
  return page ? singleByte(buf, page) : buf.toString('binary');        // Latin-1 for 1252; old Node knows it by this name
}
function login(q, cb) {
  if (!keyOk(q)) return cb({ error: 'key', message: 'Add your OpenSubtitles API key first.' });
  if (!str(q.user, 100) || !str(q.pass, 200)) return cb({ error: 'login', message: 'Enter the username and password.' });
  call('POST', HOST + '/login', { 'Api-Key': str(q.key, 80) }, { username: str(q.user, 100), password: str(q.pass, 200) }, function (e, j) {
    if (e) return cb({ error: 'login', message: e.code === 401 ? 'OpenSubtitles did not accept that username and password.' : e.message });
    if (!j || !j.token) return cb({ error: 'login', message: 'OpenSubtitles did not sign you in.' });
    cb({ token: j.token, allowed: j.user && j.user.allowed_downloads || 0, level: j.user && str(j.user.level, 40) || '' });
  });
}
module.exports = { search: search, get: get, login: login, _test: { searchUrl: searchUrl, decode: decode, singleByte: singleByte, UA: UA, score: score, rank: rank } };
